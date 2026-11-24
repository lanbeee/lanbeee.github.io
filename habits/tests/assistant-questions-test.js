// Focused-session question answering. Editing stays the primary job: every
// case asserts what the answer said AND what was staged/persisted after each
// turn. Pure reads run with zero model passes; polite edits and mixed requests
// keep the existing extraction pipeline (scripted adapters, or the real pinned
// Needle runtime when NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH are set).
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
const fs = require('fs');
let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log(`  ok: ${message}`);
}
// Frozen clock so history and plan answers are deterministic. Timers stay real.
// Monday 2026-11-02 noon EST: inside the fixture's allowed days, outside its
// 6pm-8pm window, so the planner-why evidence check names the window.
const NOW = new Date('2026-11-02T12:00:00-05:00').getTime();
const FREEZE = `(() => {
  const RealDate = Date, now = ${NOW};
  class FrozenDate extends RealDate {
    constructor(...args){ super(...(args.length ? args : [now])); }
    static now(){ return now; }
  }
  window.Date = FrozenDate;
})()`;

(async()=>{
  let browser;
  try{browser = await chromium.launch({headless:true, channel:'chrome'});}
  catch(_){browser = await chromium.launch({headless:true});}
  const live = Boolean(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH);
  try{
    // ---------- corpus over the production functions (scripted + live) ----------
    for(const mode of live ? ['scripted', 'live'] : ['scripted']){
      const page = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block', timezoneId:'America/New_York'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if(mode === 'live')await page.route('https://huggingface.co/**', route => route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm') ? process.env.NEEDLE_WASM_PATH : process.env.NEEDLE_MODEL_PATH)}));
      await page.addInitScript(FREEZE);
      await page.goto(BASE);await waitForAssistant(page);
      await page.evaluate(async isLive => {
        if(isLive){patchLocalAssistant({localAssistant:true, localAssistantProvider:'needle'}); await assistantNeedleDownload();}
        window.qaOptions = test => isLive ? {} : {rank:async()=>({rankings:[]}), extract:async spec=>{
          let args={};
          if(spec.family==='families')args={evidence:'',outside:''};
          else if(spec.family==='completeness')args={missing:''};
          else if(spec.family==='reference')args={field:spec.tool.parameters.properties.field.enum[0]};
          else if(spec.family==='field-routing')args={field:''};
          else if(spec.family==='family-routing')args={family:''};
          else if(test && test.fields && test.fields[spec.jobId])args={...test.fields[spec.jobId]};
          else{
            const key=Object.keys(spec.tool.parameters.properties)[0];
            const choices=spec.tool.parameters.properties[key].enum||[];
            args={[key]:choices[0] || ''};
          }
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
        }};
        window.qaSeed = spec => {
          if(spec && spec.native){
            window.TingsNative={isNative:true,quiet:{status:async()=>({granted:true})},
              notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
          }else{
            delete window.TingsNative;
          }
          window.reconcileNativeQuiet=async()=>{};window.reconcileNativeReminders=async()=>{};window.reconcileNativeRemindersNow=async()=>{};window.refreshOpenViews=()=>{};
          localStorage.removeItem(ASSISTANT_FOCUS_REMINDER_KEY);
          if(spec && spec.nativeReminders)localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify({version:4,enabled:true,items:{'item:qa-habit':{start:'notification',startLeadMinutes:10}}}));
          const day = offset => Date.now() + offset * 86400000;
          saveSortSettings({...loadSortSettings(), topics:['Fitness'],
            locations:[{id:'home',name:'Home',lat:40,lng:-74},{id:'gym-east',name:'Gym East',lat:40,lng:-74},{id:'gym-west',name:'Gym West',lat:40,lng:-74}]});
          save(normalize([
            {hid:'qa-habit',name:'Gym',type:'keepup',target:7,durationMinutes:30,priority:1,topics:['Fitness'],
              allowedWeekdays:[1,3],allowedTimeStart:1080,allowedTimeEnd:1200,anywhereAllowed:false,locationIds:['home'],
              breakable:true,minChunkMinutes:15,earlyWindowDays:2,delayAllowanceDays:0,
              logs:[day(-2),day(-3),day(-5),{ts:day(1),plan:true}]},
            {hid:'qa-task',name:'File report',type:'task',target:null,durationMinutes:60,priority:2,logs:[],
              dueDate:day(3),eventTime:day(3) + 14 * 3600000,delayAllowanceDays:2},
            {hid:'qa-empty',name:'Stretch',type:'keepup',target:1,durationMinutes:15,logs:[]},
            {hid:'qa-nodue',name:'Call bank',type:'task',target:null,durationMinutes:20,earlyWindowDays:3,
              delayAllowanceDays:0,logs:[]},
            {hid:'qa-legacy',name:'Old stretch',type:'keepup',target:1,durationMinutes:10,flexibilityDays:4,logs:[]},
            {hid:'qa-event',name:'Physio',type:'keepup',target:null,durationMinutes:45,logs:[],
              appointment:{repeat:'weekly',startDate:'2026-11-02',weekdays:[1],startMinute:1080,until:'',exceptions:{}}}
          ]));
          const target = (spec && spec.openTarget) || 'qa-habit';
          return assistantFocusOpen({operation:'edit',
            kind:target === 'qa-task' || target === 'qa-nodue' ? 'task' : target === 'qa-event' ? 'event' : 'habit',
            targetId:target, now:Date.now()});
        };
      }, mode === 'live');
      const drive = async cases => await page.evaluate(async specs => {
        const out = [];
        for(const spec of specs){
          const s = qaSeed(spec);
          const storageBefore = JSON.stringify(load());
          const remindersBefore = localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY);
          const turns = [];
          let saved = null;
          try{
            for(const step of spec.steps){
              const passesBefore = (s.timing.passes || []).length;
              if(step.fix){
                // The Fix-last-request control: revise only the preceding
                // editable request, ignoring any question turns since.
                const canRevise = assistantGuideCanRevise(s);
                const fixRequest = assistantGuideRevise(s);
                turns.push({send:'[fix]', fixRequest, canRevise,
                  passes:(s.timing.passes || []).length - passesBefore,
                  answer:s.answer ? s.answer.text : null,
                  changes:s.changes.map(row => [row.field, row.op || 'set', row.value]),
                  unresolved:s.unresolved.map(row => row.field),
                  itemActions:[], canSave:assistantFocusCanSave(s), requests:s.requests.slice()});
                continue;
              }
              if(step.pick){
                const [field, values] = step.pick;
                const picked = assistantFocusPickValues(s, field, values);
                if(!picked.ok)throw new Error(`picker: ${picked.error}`);
                turns.push({
                  send:`pick ${field}: ${values.join(', ')}`,
                  passes:(s.timing.passes || []).length - passesBefore,
                  answer:s.answer ? s.answer.text : null,
                  changes:s.changes.map(row => [row.field, row.op || 'set', row.value]),
                  unresolved:s.unresolved.map(row => row.field),
                  itemActions:[], canSave:assistantFocusCanSave(s)
                });
                continue;
              }
              await assistantFocusTurn(s, typeof step === 'string' ? step : step.send, qaOptions(spec));
              while(s.pendingFamilies.length)await assistantFocusTurn(s, '', {resume:true, ...(qaOptions(spec))});
              turns.push({
                send:typeof step === 'string' ? step : step.send,
                passes:(s.timing.passes || []).length - passesBefore,
                answer:s.answer ? s.answer.text : null,
                changes:s.changes.map(row => [row.field, row.op || 'set', row.value]),
                unresolved:s.unresolved.map(row => row.field),
                itemActions:(s.itemActions || []).filter(row => row && row.ready).map(row => row.kind),
                canSave:assistantFocusCanSave(s),
                requests:s.requests.slice()
              });
            }
            if(spec.save){
              assistantFocusReviewModel(s);
              assistantFocusApprove(s);
              const result = await assistantFocusCommit(s);
              saved = {ok:!!result.ok, error:result && result.error, item:load().find(row => row.hid === (result && result.hid))};
            }
          }catch(error){
            out.push({id:spec.id, error:String(error.message || error), turns});
            continue;
          }
          out.push({id:spec.id, turns, saved,
            storageUnchanged:JSON.stringify(load()) === storageBefore && localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY) === remindersBefore});
        }
        return out;
      }, cases);
      const runs = await drive([
        {id:'read-duration', openTarget:'qa-habit', steps:[{send:'How long is this set for?'}]},
        {id:'read-duration-paraphrase', openTarget:'qa-habit', steps:[{send:'How much time does one session take?'}]},
        {id:'read-days', openTarget:'qa-habit', steps:[{send:'Which days is this set for?'}]},
        {id:'read-places', openTarget:'qa-habit', steps:[{send:'Where can I do this?'}]},
        {id:'read-topics', openTarget:'qa-habit', steps:[{send:'What topics did I pick?'}]},
        {id:'read-frequency', openTarget:'qa-habit', steps:[{send:'How often is this?'}]},
        {id:'polite-edit-stays-edit', openTarget:'qa-habit', save:true, steps:[{send:'Could you set it to 20 minutes?'}]},
        {id:'question-mark-alone', openTarget:'qa-habit', steps:[{send:'set it to 20 minutes?'}]},
        {id:'staged-and-saved-read', openTarget:'qa-habit', save:true, steps:[{send:'make it 20 minutes'}, {send:'What’s the duration?'}]},
        {id:'mixed-read-and-edit', openTarget:'qa-habit', save:true, fields:{durationMinutes:{phrase:'can you change it to 20 minutes', duration:'20 minutes'}}, steps:[{send:'What’s the duration, and can you change it to 20 minutes?'}]},
        {id:'pending-clarification-preserved', openTarget:'qa-habit', save:true,
          steps:[{send:'change the location to gym'}, {send:'What does Anywhere mean?'}, {pick:['places', ['gym-east']]}]},
        {id:'history-last', openTarget:'qa-habit', steps:[{send:'When did I last complete this?'}]},
        {id:'history-count', openTarget:'qa-habit', steps:[{send:'How many times did I do it this week?'}]},
        {id:'history-count-today', openTarget:'qa-habit', steps:[{send:'How many times did I do it today?'}]},
        {id:'history-today', openTarget:'qa-habit', steps:[{send:'Did I log this today?'}]},
        {id:'history-empty', openTarget:'qa-empty', steps:[{send:'When did I last complete this?'}]},
        {id:'plan-tomorrow', openTarget:'qa-habit', steps:[{send:'Is this planned for tomorrow?'}]},
        {id:'plan-not-tomorrow', openTarget:'qa-task', steps:[{send:'Is this planned for tomorrow?'}]},
        {id:'log-question-stays-action', openTarget:'qa-habit', steps:[{send:'Can you log this for today?'}, {send:'Did I log this today?'}]},
        {id:'capability-intro', openTarget:'qa-habit', steps:[{send:'What can you do?'}, {send:'What can I do here?'}]},
        {id:'help-summary-edit', openTarget:'qa-habit', steps:[{send:'How do I change a setting from Summary?'}]},
        {id:'unsupported-truthful', openTarget:'qa-habit', steps:[{send:'What’s the airspeed velocity of an unladen swallow?'}]},
        {id:'bare-value-followup-stays-edit', openTarget:'qa-habit', steps:[{send:'make it 20 minutes'}, {send:'What about 30 minutes?'}]},
        {id:'read-reminder-native', openTarget:'qa-habit', native:true, nativeReminders:true, steps:[{send:'Is there a reminder?'}]},
        {id:'read-reminder-browser', openTarget:'qa-habit', native:false, steps:[{send:'Is there a reminder?'}]},
        {id:'why-not-scheduled-window', openTarget:'qa-habit', steps:[{send:'Why isn’t this scheduled right now?'}]},
        {id:'due-task', openTarget:'qa-task', steps:[{send:'When is it due?'}]},
        {id:'no-unconfirmed-write-on-question', openTarget:'qa-habit', steps:[{send:'What’s the duration?'}, {send:'How many times did I do it this week?'}]},
        {id:'define-early-window', openTarget:'qa-habit', steps:[{send:'What does Early window mean?'}]},
        {id:'read-early-window', openTarget:'qa-habit', steps:[{send:'What’s my early window?'}]},
        {id:'read-delay-staged', openTarget:'qa-habit', save:true, fields:{delayAllowanceDays:{late:'allow 2 days late'}},
          steps:[{send:'allow 2 days late'}, {send:'What’s my delay allowance?'}]},
        {id:'compare-early-delay', openTarget:'qa-habit', steps:[{send:'What’s the difference between Early window and Delay allowance?'}]},
        {id:'how-change-early-window', openTarget:'qa-habit', steps:[{send:'How do I change Early window?'}]},
        {id:'flexibility-habit', openTarget:'qa-habit', steps:[{send:'How flexible is this?'}]},
        {id:'flexibility-legacy', openTarget:'qa-legacy', steps:[{send:'How flexible is this?'}]},
        {id:'flexibility-task-no-due', openTarget:'qa-nodue', steps:[{send:'How flexible is this?'}]},
        {id:'flexibility-event', openTarget:'qa-event', steps:[{send:'How flexible is this?'}]},
        {id:'flexible-start-wording', openTarget:'qa-habit', steps:[{send:'What does a flexible start time mean?'}]},
        {id:'define-splitting', openTarget:'qa-habit', steps:[{send:'What does Splitting mean?'}]},
        {id:'read-na-min-chunk', openTarget:'qa-empty', steps:[{send:'What’s my shortest session?'}]},
        {id:'mixed-question-first', openTarget:'qa-habit', save:true,
          steps:[{send:'What does Early window mean, and set it to 2 days early?'}]},
        {id:'mixed-edit-first', openTarget:'qa-habit', save:true,
          steps:[{send:'Set early window to 2 days early, and what does Delay allowance mean?'}]},
        {id:'mixed-invalid-stays-open', openTarget:'qa-habit', fields:{durationMinutes:{duration:'banana'}},
          steps:[{send:'What does Early window mean, and set duration to banana?'}]},
        {id:'other-item-question', openTarget:'qa-habit', steps:[{send:'What is File report’s duration?'}]},
        {id:'computed-streak-read', openTarget:'qa-habit', steps:[{send:'What’s my streak?'}]},
        {id:'computed-values', steps:[{send:'What are my total entries?'}, {send:'What does Since last mean?'},
          {send:'What does the pace strip show?'}, {send:'What does the last 30 days chip show?'}]},
        {id:'derived-deadline', openTarget:'qa-task', steps:[{send:'allow 0 days late'}, {send:'What’s my hard deadline?'}]},
        {id:'named-native-reminder', openTarget:'qa-task', native:true, steps:[{send:'What does the due-date reminder do?'},
          {send:'What’s my due-date reminder?'}]},
        {id:'mixed-question-then-edit', save:true,
          steps:[{send:'What does Early window mean? Make it 20 minutes.'}]},
        {id:'log-polite-keeps-confirmation', steps:[{send:'Can you log a completion for yesterday?'}]},
        {id:'fix-targets-edit', openTarget:'qa-habit',
          steps:[{send:'set early window to 2 days early'}, {send:'What’s my early window?'}, {fix:true}]},
        {id:'pending-action-preserved', openTarget:'qa-habit',
          steps:[{send:'Can you log this for today?'}, {send:'What does Delay allowance mean?'}]}
      ]);
      for(const run of runs){
        if(run.error)throw new Error(`${run.id} threw: ${run.error}`);
        const turn = index => run.turns[index] || {};
        switch(run.id){
          case 'read-duration':
            assert(turn(0).answer && /30 min/.test(turn(0).answer), `${mode}: duration read returns the saved value (${turn(0).answer})`);
            assert(!turn(0).changes.length && !turn(0).unresolved.length, `${mode}: duration read stages nothing`);
            assert(turn(0).passes === 0, `${mode}: duration read uses zero model passes`);
            assert(run.storageUnchanged, `${mode}: duration read writes nothing`);
            break;
          case 'read-duration-paraphrase':
            assert(turn(0).answer && /30 min/.test(turn(0).answer), `${mode}: duration paraphrase answers (${turn(0).answer})`);
            assert(turn(0).passes === 0, `${mode}: paraphrase uses zero model passes`);
            break;
          case 'read-days':
            assert(turn(0).answer && /Mon/.test(turn(0).answer) && /Wed/.test(turn(0).answer), `${mode}: weekday read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: weekday read is read-only`);
            break;
          case 'read-places':
            assert(turn(0).answer && /Home/.test(turn(0).answer), `${mode}: place read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: place read is read-only`);
            break;
          case 'read-topics':
            assert(turn(0).answer && /Fitness/.test(turn(0).answer), `${mode}: topics read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: topics read is read-only`);
            break;
          case 'read-frequency':
            assert(turn(0).answer && /(daily|1×|1x|once|every day|7)/i.test(turn(0).answer), `${mode}: frequency read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: frequency read is read-only`);
            break;
          case 'polite-edit-stays-edit':
            assert(!turn(0).answer, `${mode}: polite edit does not answer`);
            assert(turn(0).changes.some(([field]) => field === 'durationMinutes'), `${mode}: polite edit stages duration`);
            assert(turn(0).canSave, `${mode}: polite edit enables Save`);
            assert(run.saved && run.saved.ok && run.saved.item.durationMinutes === 20, `${mode}: polite edit saves 20`);
            break;
          case 'question-mark-alone':
            assert(!turn(0).answer, `${mode}: trailing question mark does not answer`);
            assert(turn(0).changes.some(([field]) => field === 'durationMinutes'), `${mode}: trailing question mark still stages the edit`);
            break;
          case 'staged-and-saved-read':
            assert(turn(0).changes.some(([field]) => field === 'durationMinutes'), `${mode}: first turn staged the edit`);
            assert(turn(1).answer && /30 min/.test(turn(1).answer) && /20 min/.test(turn(1).answer), `${mode}: staged read reports both values (${turn(1).answer})`);
            assert(turn(1).changes.some(([field, , value]) => field === 'durationMinutes' && value === 20), `${mode}: question did not erase the staged edit`);
            assert(JSON.stringify(turn(1).requests) === JSON.stringify(turn(0).requests), `${mode}: question stays out of edit history`);
            assert(run.saved && run.saved.ok && run.saved.item.durationMinutes === 20, `${mode}: save still applies the staged 20`);
            break;
          case 'mixed-read-and-edit':
            assert(turn(0).changes.some(([field]) => field === 'durationMinutes'), `${mode}: mixed request staged the edit`);
            assert(turn(0).answer && /30 min/.test(turn(0).answer) && /20 min/.test(turn(0).answer), `${mode}: mixed request answered the read (${turn(0).answer})`);
            assert(run.saved && run.saved.ok && run.saved.item.durationMinutes === 20, `${mode}: mixed request saved the requested value`);
            break;
          case 'pending-clarification-preserved':
            assert(turn(0).unresolved.some(field => field === 'places'), `${mode}: tied place name asked (${turn(0).unresolved})`);
            assert(turn(1).answer && /saved places/i.test(turn(1).answer), `${mode}: Anywhere question answered (${turn(1).answer})`);
            assert(turn(1).unresolved.some(field => field === 'places'), `${mode}: question preserved the pending choice`);
            assert(!turn(1).changes.length, `${mode}: question staged nothing`);
            assert(turn(2).changes.some(([field, , value]) => field === 'places' && String(value).includes('gym-east')), `${mode}: picker still stages after the interruption (${JSON.stringify(turn(2).changes)})`);
            assert(!turn(2).unresolved.some(field => field === 'places'), `${mode}: clarification retired after answer`);
            assert(run.saved && run.saved.ok, `${mode}: save completed after interruption`);
            break;
          case 'history-last':
            assert(turn(0).answer && /Last completed/i.test(turn(0).answer) && /2d ago/.test(turn(0).answer), `${mode}: last completion (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: history read is read-only`);
            break;
          case 'history-count':
            assert(turn(0).answer && /No completions this week/.test(turn(0).answer), `${mode}: calendar week excludes last week's completions (${turn(0).answer})`);
            assert(turn(0).passes === 0, `${mode}: week count uses zero model passes`);
            break;
          case 'history-count-today':
            assert(/No completions today/.test(turn(0).answer) && run.storageUnchanged, `${mode}: today’s count excludes older completions`);
            break;
          case 'history-today':
            assert(turn(0).answer && /Not yet today/.test(turn(0).answer), `${mode}: logged-today read (${turn(0).answer})`);
            assert(!turn(0).itemActions.length, `${mode}: history question did not start an action`);
            break;
          case 'history-empty':
            assert(turn(0).answer && /haven’t logged|have not logged/i.test(turn(0).answer), `${mode}: empty history (${turn(0).answer})`);
            break;
          case 'plan-tomorrow':
            assert(turn(0).answer && /Planned for/.test(turn(0).answer), `${mode}: plan read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: plan read is read-only`);
            break;
          case 'plan-not-tomorrow':
            assert(turn(0).answer && /Not planned/.test(turn(0).answer), `${mode}: no-plan read (${turn(0).answer})`);
            break;
          case 'log-question-stays-action':
            assert(!turn(0).answer, `${mode}: log request is not answered as a question`);
            assert(turn(0).itemActions.length, `${mode}: log request offers the normal confirmation`);
            assert(!turn(0).changes.length, `${mode}: log confirmation stages no edit`);
            assert(turn(1).answer && /Not yet today/.test(turn(1).answer), `${mode}: a pending log is not reported as saved`);
            assert(turn(1).itemActions.includes('log') && run.storageUnchanged, `${mode}: reading history preserves the confirmation and writes nothing`);
            break;
          case 'capability-intro':
            assert(turn(0).answer && /mainly help you edit this item/.test(turn(0).answer), `${mode}: capability intro (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: capability intro is read-only`);
            assert(turn(1).answer === turn(0).answer, `${mode}: first-use wording gives the same introduction`);
            break;
          case 'help-summary-edit':
            assert(/Tap a setting on Summary/.test(turn(0).answer) && run.storageUnchanged, `${mode}: Summary help points to manual editing, Search, and Needle`);
            break;
          case 'unsupported-truthful':
            assert(turn(0).answer && /don’t know|mainly help you edit/i.test(turn(0).answer), `${mode}: unsupported question declines truthfully (${turn(0).answer})`);
            assert(!turn(0).changes.length && !turn(0).unresolved.length, `${mode}: decline stages nothing and blocks nothing`);
            break;
          case 'bare-value-followup-stays-edit':
            assert(!turn(1).answer, `${mode}: quantity follow-up is not answered`);
            assert(turn(1).changes.some(([field, , value]) => field === 'durationMinutes' && value === 30), `${mode}: quantity follow-up stages 30 (${JSON.stringify(turn(1).changes)})`);
            break;
          case 'read-reminder-native':
            assert(turn(0).answer && /notification/i.test(turn(0).answer), `${mode}: native reminder read (${turn(0).answer})`);
            break;
          case 'read-reminder-browser':
            assert(turn(0).answer && /mobile app/i.test(turn(0).answer), `${mode}: browser reminder read (${turn(0).answer})`);
            break;
          case 'why-not-scheduled-window':
            assert(turn(0).answer && /allowed hours/i.test(turn(0).answer), `${mode}: planner-why names the evidence (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: planner-why is read-only`);
            break;
          case 'due-task':
            assert(turn(0).answer && /[Dd]ue/.test(turn(0).answer) && /Nov/.test(turn(0).answer), `${mode}: task due read (${turn(0).answer})`);
            break;
          case 'no-unconfirmed-write-on-question':
            assert(turn(0).passes === 0 && turn(1).passes === 0, `${mode}: question turns use zero model passes`);
            assert(run.storageUnchanged, `${mode}: repeated questions write nothing`);
            break;
          case 'define-early-window':
            assert(turn(0).answer && /how many days before its date/i.test(turn(0).answer), `${mode}: early window definition (${turn(0).answer})`);
            assert(/0 gives it no early allowance|never lets work move later|never lets work/i.test(turn(0).answer), `${mode}: early window definition explains zero (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length && !turn(0).unresolved.length && run.storageUnchanged, `${mode}: definition is read-only and stages nothing`);
            break;
          case 'read-early-window':
            assert(turn(0).answer && /up to 2 calendar days/i.test(turn(0).answer), `${mode}: early window read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: early window read is read-only`);
            break;
          case 'read-delay-staged':
            assert(turn(0).changes.some(([field, , value]) => field === 'delayAllowanceDays' && value === 2), `${mode}: edit staged 2 late days`);
            assert(turn(1).answer && /Saved:/i.test(turn(1).answer) && /2 calendar days/i.test(turn(1).answer), `${mode}: staged delay read shows saved and staged (${turn(1).answer})`);
            assert(turn(1).changes.some(([field]) => field === 'delayAllowanceDays'), `${mode}: the question kept the staged edit`);
            assert(run.saved && run.saved.ok && run.saved.item.delayAllowanceDays === 2, `${mode}: save applied 2 late days`);
            break;
          case 'compare-early-delay':
            assert(turn(0).answer && /opposite/i.test(turn(0).answer)
              && /[Ee]arly window/.test(turn(0).answer) && /[Dd]elay allowance/.test(turn(0).answer), `${mode}: comparison names both directions (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: comparison is read-only`);
            break;
          case 'how-change-early-window':
            assert(turn(0).answer && /Summary/.test(turn(0).answer) && /2 days early/.test(turn(0).answer), `${mode}: how-to-change names the control and an example ask (${turn(0).answer})`);
            assert(!turn(0).changes.length && !turn(0).unresolved.length && run.storageUnchanged, `${mode}: how-to-change leaves the draft alone`);
            break;
          case 'flexibility-habit':
            assert(turn(0).answer && /Early window is 2/.test(turn(0).answer) && /pull an occurrence forward/i.test(turn(0).answer), `${mode}: flexibility names the early allowance (${turn(0).answer})`);
            assert(/Delay allowance is 0/.test(turn(0).answer) && /overdue|no late days/i.test(turn(0).answer), `${mode}: flexibility names the strict late side (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length && run.storageUnchanged, `${mode}: flexibility answer is read-only`);
            break;
          case 'flexibility-legacy':
            assert(turn(0).answer && /Early window is 4/.test(turn(0).answer), `${mode}: legacy flexibilityDays counts as the early allowance (${turn(0).answer})`);
            assert(turn(0).passes === 0, `${mode}: legacy flexibility read is local`);
            break;
          case 'flexibility-task-no-due':
            assert(turn(0).answer && /Early window is 3/.test(turn(0).answer) && /no due date/i.test(turn(0).answer), `${mode}: no-due task explains the configured allowances without a deadline (${turn(0).answer})`);
            break;
          case 'flexibility-event':
            assert(turn(0).answer && /fixed time|does not move/i.test(turn(0).answer), `${mode}: event flexibility explains the fixed schedule (${turn(0).answer})`);
            break;
          case 'flexible-start-wording':
            assert(turn(0).answer && /fixed start/i.test(turn(0).answer) && /window|range/i.test(turn(0).answer), `${mode}: flexible-start wording explains Fixed start vs time window (${turn(0).answer})`);
            assert(turn(0).passes === 0, `${mode}: flexible-start answer is local`);
            break;
          case 'define-splitting':
            assert(turn(0).answer && /split/i.test(turn(0).answer), `${mode}: splitting definition (${turn(0).answer})`);
            break;
          case 'read-na-min-chunk':
            assert(turn(0).answer && /does not apply/i.test(turn(0).answer) && /splitting/i.test(turn(0).answer), `${mode}: conditional field explains when it applies (${turn(0).answer})`);
            assert(!turn(0).changes.length && run.storageUnchanged, `${mode}: not-applicable read stages nothing`);
            break;
          case 'mixed-question-first':
            assert(turn(0).answer && /how many days before its date/i.test(turn(0).answer), `${mode}: mixed request answered the question alongside the edit (${turn(0).answer})`);
            assert(turn(0).changes.some(([field, , value]) => field === 'earlyWindowDays' && value === 2), `${mode}: mixed request staged the edit`);
            assert(run.saved && run.saved.ok && run.saved.item.earlyWindowDays === 2, `${mode}: mixed request saved 2 early days`);
            break;
          case 'mixed-edit-first':
            assert(turn(0).changes.some(([field, , value]) => field === 'earlyWindowDays' && value === 2), `${mode}: edit-first mixed staged the edit`);
            assert(turn(0).answer && /days after|late/i.test(turn(0).answer), `${mode}: edit-first mixed answered the question (${turn(0).answer})`);
            assert(run.saved && run.saved.ok && run.saved.item.earlyWindowDays === 2, `${mode}: edit-first mixed saved`);
            break;
          case 'mixed-invalid-stays-open':
            assert(turn(0).answer && /how many days before/i.test(turn(0).answer), `${mode}: invalid mixed still answered the question`);
            assert(!turn(0).canSave, `${mode}: the invalid edit blocks Save`);
            assert(run.storageUnchanged, `${mode}: invalid edit wrote nothing`);
            break;
          case 'other-item-question':
            assert(turn(0).answer && /only answers for Gym/i.test(turn(0).answer) && /File report/i.test(turn(0).answer), `${mode}: question about another item answers through the open-item guard (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length && run.storageUnchanged, `${mode}: other-item question is read-only`);
            break;
          case 'computed-streak-read':
            assert(turn(0).answer && /streak.*3 right now/i.test(turn(0).answer), `${mode}: streak read (${turn(0).answer})`);
            assert(turn(0).passes === 0 && !turn(0).changes.length, `${mode}: streak read is read-only`);
            break;
          case 'computed-values':
            assert(/has 3/i.test(turn(0).answer), `${mode}: total entries excludes the plan (${turn(0).answer})`);
            assert(/2 right now/i.test(turn(1).answer), `${mode}: since last reads the latest completion (${turn(1).answer})`);
            assert(/mostly good/i.test(turn(2).answer), `${mode}: pace uses the formatted summary (${turn(2).answer})`);
            assert(/3\/5/.test(turn(3).answer), `${mode}: recent activity reads the displayed ratio (${turn(3).answer})`);
            assert(run.turns.every(row => row.passes === 0 && !row.changes.length) && run.storageUnchanged, `${mode}: computed reads stay local and read-only`);
            break;
          case 'derived-deadline':
            assert(/Saved: late days allowed.*Staged for this save: firm due date/i.test(turn(1).answer), `${mode}: deadline read reflects staged delay allowance (${turn(1).answer})`);
            assert(turn(1).passes === 0 && run.storageUnchanged, `${mode}: derived deadline read stages no additional change`);
            break;
          case 'named-native-reminder':
            assert(/deadline alert/i.test(turn(0).answer), `${mode}: named reminder explains the due-date alert (${turn(0).answer})`);
            assert(turn(1).answer === 'Off.', `${mode}: due-date read selects the due-date reminder (${turn(1).answer})`);
            assert(run.turns.every(row => row.passes === 0) && run.storageUnchanged, `${mode}: named reminders stay local`);
            break;
          case 'mixed-question-then-edit':
            assert(/how many days before/i.test(turn(0).answer), `${mode}: full question before a second sentence is answered (${turn(0).answer})`);
            assert(run.saved?.ok && run.saved.item.durationMinutes === 20, `${mode}: edit after question punctuation is saved`);
            break;
          case 'log-polite-keeps-confirmation':
            assert(!turn(0).answer && turn(0).itemActions.includes('log') && run.storageUnchanged, `${mode}: polite logging request preserves confirmation`);
            break;
          case 'fix-targets-edit':
            assert(turn(0).changes.some(([field]) => field === 'earlyWindowDays'), `${mode}: edit staged before the question`);
            assert(turn(1).answer && /2/.test(turn(1).answer) && turn(1).canSave, `${mode}: question kept the proposal usable`);
            assert(turn(2).canRevise, `${mode}: Fix stays available after a question`);
            assert(turn(2).fixRequest === 'set early window to 2 days early', `${mode}: Fix targets the edit, not the question (${turn(2).fixRequest})`);
            assert(!turn(2).requests.includes('What’s my early window?'), `${mode}: the question never entered edit history`);
            break;
          case 'pending-action-preserved':
            assert(turn(0).itemActions.length, `${mode}: log confirmation offered`);
            assert(turn(1).answer && /late|days after/i.test(turn(1).answer), `${mode}: interruption answered (${turn(1).answer})`);
            assert(turn(1).itemActions.length, `${mode}: confirmation still ready after the question`);
            assert(!turn(1).changes.length && run.storageUnchanged, `${mode}: interruption staged and wrote nothing`);
            break;
          default:
            throw new Error(`unhandled case ${run.id}`);
        }
      }
      assert(!errors.length, `${mode}: no page errors (${errors.slice(0, 3).join(' | ')})`);
      await page.close();
    }
    // ---------- real Summary flow, phone viewport, full + minimal ----------
    for(const minimal of [false, true]){
      const page = await browser.newPage({viewport:{width:390, height:844}, hasTouch:true, serviceWorkers:'block', timezoneId:'America/New_York'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(FREEZE);
      await page.goto(BASE);await waitForAssistant(page);
      await page.evaluate(isMinimal => {
        const settings = loadSortSettings();
        settings.minimal = isMinimal;
        saveSortSettings(settings);
        window.reconcileNativeQuiet=async()=>{};window.reconcileNativeReminders=async()=>{};window.reconcileNativeRemindersNow=async()=>{};window.refreshOpenViews=()=>{};
        const day = offset => Date.now() + offset * 86400000;
        save(normalize([{hid:'ui-habit',name:'Gym',type:'keepup',target:7,durationMinutes:30,priority:1,logs:[day(-2)]}]));
        // Scripted production adapter so the UI edit step is deterministic.
        assistantNeedleCanSend = () => true;
        const turn = assistantFocusTurn;
        assistantFocusTurn = (s, text, opts) => turn(s, text, {...opts, rank:async()=>({rankings:[]}),
          extract:async spec => {
            let args = {};
            const key = Object.keys(spec.tool.parameters.properties)[0];
            if(spec.family === 'families')args = {evidence:'', outside:''};
            else if(spec.family === 'completeness')args = {missing:''};
            else args = {[key]:spec.tool.parameters.properties[key].enum ? spec.tool.parameters.properties[key].enum[0] : (spec.jobId === 'durationMinutes' ? '20 minutes' : '')};
            return {confidence:1, function_calls:[{name:spec.tool.name, arguments:args}]};
          }});
        render();
      }, minimal);
      await page.locator('#launch-screen').waitFor({state:'hidden'}).catch(() => {});
      await page.locator('#list .ting-name').filter({hasText:'Gym'}).first().tap();
      await page.waitForFunction(() => typeof detailSummaryOnScreen === 'function' && detailSummaryOnScreen());
      const input = page.locator('#detail-ask-input');
      const proposal = '#detail-summary-thread [data-detail-proposal]:not(.is-retired)';
      // 1) ask a question through the composer
      await input.fill('How long is this set for?');
      await page.locator('#detail-ask-send').tap();
      await page.waitForFunction(() => {
        const card = document.querySelector('#detail-summary-thread [data-detail-proposal]:not(.is-retired)');
        return card && card.textContent.includes('30 min');
      }, null, {timeout:20000});
      const answerShown = await page.evaluate(() => {
        const card = document.querySelector('#detail-summary-thread [data-detail-proposal]:not(.is-retired)');
        return {text:(card.querySelector('.focus-answer') || {}).textContent || '',
          kicker:(card.querySelector('.focus-kicker') || {}).textContent || '',
          saveCount:card.querySelectorAll('[data-focus-save]').length};
      });
      assert(answerShown.text && /30 min/.test(answerShown.text), `${minimal ? 'minimal' : 'full'} UI: question answer rendered (${answerShown.text})`);
      assert(answerShown.kicker === 'Question', `${minimal ? 'minimal' : 'full'} UI: question kicker (${answerShown.kicker})`);
      assert(!answerShown.saveCount, `${minimal ? 'minimal' : 'full'} UI: no Save on a pure answer`);
      // 2) edit through the same box
      await input.fill('make it 20 minutes');
      await page.locator('#detail-ask-send').tap();
      await page.waitForFunction(() => {
        const card = document.querySelector('#detail-summary-thread [data-detail-proposal]:not(.is-retired)');
        return card && card.querySelector('[data-focus-save]') && !card.querySelector('[data-focus-save]').disabled;
      }, null, {timeout:20000});
      // 3) ask again with the edit staged: both values, then save
      await input.fill('What’s the duration?');
      await page.locator('#detail-ask-send').tap();
      await page.waitForFunction(() => {
        const card = document.querySelector('#detail-summary-thread [data-detail-proposal]:not(.is-retired)');
        return card && card.textContent.includes('Saved: 30 min') && card.textContent.includes('20 min');
      }, null, {timeout:20000});
      const saveEnabled = await page.evaluate(sel => {
        const card = document.querySelector(sel);
        const button = card.querySelector('[data-focus-save]');
        return button && !button.disabled;
      }, proposal);
      assert(saveEnabled, `${minimal ? 'minimal' : 'full'} UI: Save still available after the question`);
      await page.locator(`${proposal} [data-focus-save]`).tap();
      await page.waitForFunction(() => load().some(row => row.hid === 'ui-habit' && row.durationMinutes === 20), null, {timeout:15000});
      assert(true, `${minimal ? 'minimal' : 'full'} UI: save applied the staged 20`);
      // 4) undo from the toast
      const undoVisible = await page.evaluate(() => {
        const undo = document.querySelector('#action-undo');
        const toast = undo ? undo.closest('div') : null;
        return undo && undo.offsetParent !== null ? undo.textContent : (toast ? toast.textContent : '');
      });
      assert(/undo/i.test(undoVisible), `${minimal ? 'minimal' : 'full'} UI: undo offered on toast (${undoVisible.slice(0, 60)})`);
      // 5) return to Summary
      const back = await page.evaluate(() => typeof detailSummaryOnScreen === 'function' && detailSummaryOnScreen());
      assert(back, `${minimal ? 'minimal' : 'full'} UI: back on Summary`);
      await input.fill('Did you already save that?');
      await page.locator('#detail-ask-send').tap();
      await page.locator(`${proposal} .focus-answer`).filter({hasText:'no edit waiting to be saved'}).waitFor({timeout:10000});
      await input.fill('make it 25 minutes');
      await page.locator('#detail-ask-send').tap();
      await page.locator(`${proposal} [data-focus-save]:enabled`).waitFor();
      await input.fill('What does Duration mean?');
      await page.locator('#detail-ask-send').tap();
      await page.locator(`${proposal} .focus-answer`).filter({hasText:'one session lasts'}).waitFor();
      await page.locator('#detail-ask-revise').tap();
      assert(await input.inputValue() === 'make it 25 minutes', 'UI Fix restores the latest edit text');
      const userMessages = await page.locator('#detail-summary-thread .assistant-bubble-user').allTextContents();
      assert(userMessages.includes('What does Duration mean?') && !userMessages.includes('make it 25 minutes'), 'UI Fix keeps the intervening question in the chat');
      assert(!errors.length, `${minimal ? 'minimal' : 'full'} UI: no page errors (${errors.slice(0, 3).join(' | ')})`);
      await page.close();
    }
    console.log(`assistant-questions-test: ${passed} assertions passed`);
    process.exit(0);
  }catch(error){
    console.error(`assistant-questions-test FAILED after ${passed} assertions: ${error.message}`);
    process.exit(1);
  }finally{
    await browser.close().catch(() => {});
  }
})();
