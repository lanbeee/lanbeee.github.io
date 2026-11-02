// Save/undo regressions run with scripted extracts and with the pinned Needle 3
// assets when supplied. Native permission responses are stubbed, never inference.
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
const fs = require('fs');
let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log(`  ok: ${message}`);
}

(async()=>{
  let browser;
  try{browser = await chromium.launch({headless:true, channel:'chrome'});}
  catch(_){browser = await chromium.launch({headless:true});}
  try{
    const modes = ['scripted'];
    if(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH)modes.push('live');
    if(process.env.FOCUS_LIVE_ONLY)modes.shift();
    for(const mode of modes){
      const page = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if(mode === 'live')await page.route('https://huggingface.co/**', route => route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm') ? process.env.NEEDLE_WASM_PATH : process.env.NEEDLE_MODEL_PATH)}));
      await page.goto(BASE, {waitUntil:'load'});
      await waitForAssistant(page);
      await page.evaluate(async live => {
        if(live){patchLocalAssistant({localAssistant:true, localAssistantProvider:'needle'}); await assistantNeedleDownload();}
        window.focusTest = {
          live, traces:[], snapshot:null,
          seed(){
            save(normalize([
              {hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, priority:1, logs:[], breakable:true},
              {hid:'event', name:'Meeting', type:'keepup', target:null, durationMinutes:45, logs:[], appointment:{repeat:'weekly', startDate:'2026-11-02', weekdays:[1], startMinute:540, until:'', exceptions:{}}}
            ]));
            saveSortSettings({...loadSortSettings(), topics:['Original'], locations:[
              {id:'home', name:'Home', lat:40, lng:-74},
              {id:'gym-east', name:'Gym East', lat:40, lng:-74},
              {id:'gym-west', name:'Gym West', lat:40, lng:-74}
            ], weatherProfiles:[{id:'dry', name:'Dry', rules:[{metric:'precipitation', max:1}]}]});
            localStorage.removeItem(ASSISTANT_FOCUS_REMINDER_KEY);
            window.showActionToast = (message, action) => {focusTest.snapshot = action.snapshot;};
            window.refreshOpenViews = () => {};
            window.reconcileNativeRemindersNow = async () => {};
            window.reconcileNativeReminders = async () => {};
          },
          open(kind='habit', operation='edit'){
            return assistantFocusOpen({operation, kind, targetId:kind === 'event' ? 'event' : 'gym', occurrenceDate:'2026-11-09', now:new Date('2026-11-01T12:00:00').getTime()});
          },
          async turn(session, text, families, fields, missing=''){
            let completeness = false;
            const extract = async spec => {
              let args;
              if(spec.family === 'families')args = {evidence:families};
              else if(spec.family === 'completeness'){completeness = true; args = {missing};}
              else args = typeof fields[spec.family] === 'function' ? fields[spec.family](completeness) : fields[spec.family] || {};
              return {confidence:0.95, function_calls:[{arguments:args}]};
            };
            await assistantFocusTurn(session, text, this.live ? {} : {extract,familyExtract:true});
            while(session.pendingFamilies.length)await assistantFocusTurn(session, '', this.live ? {resume:true} : {resume:true, extract,familyExtract:true});
            this.traces.push({text, changes:assistantFocusClone(session.changes), unresolved:assistantFocusClone(session.unresolved), trace:assistantFocusClone(session.trace)});
            console.log(text, JSON.stringify(session.changes.map(row => [row.field,row.value])), JSON.stringify(session.unresolved));
            return session;
          },
          async commit(session){
            assistantFocusReviewModel(session);
            assistantFocusApprove(session);
            const result = await assistantFocusCommit(session);
            if(!result.ok)throw new Error(JSON.stringify({result, changes:session.changes, unresolved:session.unresolved}));
            return result;
          }
        };
      }, mode === 'live');
      // Print each live result as it finishes and retain the full model trace.
      page.on('console', message => {if(message.type() === 'log')console.log(`  ${mode}: ${message.text()}`);});
      const cases = [
        ['every registered field has a working value normalizer', async()=>page.evaluate(()=>{
          const t=focusTest;t.seed();const s=t.open();
          const values={name:'Walk',kind:'task',habitKind:'limit',emoji:'🌟',emojiBgColor:'blue',priority:'3',
            timesPerPeriod:'3',periodDays:'7',repeatMode:'opportunity',conditionTrigger:'location',conditionRadiusM:'300',
            dueDate:'2026-11-09',dueTime:'9am',hardDue:'yes',planByDate:'2026-11-09',earlyWindowDays:'2',delayAllowanceDays:'2',
            allowedWeekdays:'Monday',allowedMonthDays:'1, 15',allowedWindow:'6pm to 8pm',allowedTimeFixedStart:'yes',
            preferredWeekdays:'Monday',preferredMonthDays:'1, 15',preferredWindow:'6pm to 8pm',
            durationMinutes:'30 minutes',breakable:'yes',minChunkMinutes:'15 minutes',minGapMinutes:'20 minutes',
            timerAutoStopMinutes:'30 minutes',autoMarkMinutes:'5 minutes',trackValue:'yes',places:'Home',anywhereAllowed:'no',locationPrefs:'prefer Home',
            weatherProfile:'Dry',weatherRules:'temperature above 10 C',showWeather:'yes',showWeatherAtLocation:'yes',weatherLocationId:'Home',
            scheduleOptions:'Monday from 6pm to 8pm',scheduleLinks:'after Meeting',topics:'Fitness',pinned:'yes',snoozedUntil:'tomorrow',sharedDisplay:'view',links:'https://example.com',
            appointmentRepeat:'weekly',appointmentStartDate:'2026-11-09',appointmentWeekdays:'Monday',appointmentUntil:'2026-12-01',appointmentStartMinute:'9am',
            exceptionTime:'10am',exceptionDuration:'30 minutes',exceptionEmoji:'🌟',exceptionColor:'blue',exceptionCancelled:'cancel',exceptionReset:'reset',
            reminderStart:'alarm',reminderEnd:'off',reminderTravelStart:'notification',reminderTravelEnd:'off',reminderMissed:'notification',
            reminderTravelLead:'15',reminderStartLead:'15',reminderMissedLead:'15',reminderReset:'reset'};
          const failed=ASSISTANT_FOCUS_FIELDS.flatMap(field=>{
            const value=values[field.id], parsed=value && assistantFocusNormalize(field.id,value,s);
            return parsed && parsed.ok ? [] : [{field:field.id,value,parsed}];
          });
          if(failed.length)throw new Error(JSON.stringify(failed));
          return true;
        })],
        ['advanced field corrections persist with the normal record shapes', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Make this 30 minutes','effort: 30 minutes',{effort:{phrase:'30 minutes',duration:'30 minutes'}});
          const corrections={links:'https://example.com',scheduleOptions:'Monday from 6pm to 8pm',locationPrefs:'prefer Home',
            weatherProfile:'Dry',weatherLocationId:'Home',scheduleLinks:'after Meeting',topics:'Fitness'};
          for(const [field,value] of Object.entries(corrections)){
            const result=assistantFocusCorrect(s,field,value);
            if(!result.ok)throw new Error(`${field}: ${result.error}`);
          }
          await t.commit(s);
          const h=load()[0];
          if(h.links[0]?.value!=='https://example.com/' || h.scheduleOptions[0]?.weekdays.join()!=='1' || h.locationPrefs.home!=='high'
            || !h.locationIds.includes('home') || h.weatherProfileId!=='dry' || h.weatherLocationId!=='home' || h.scheduleLinks[0]?.anchorHid!=='event' || !h.topics.includes('Fitness'))throw new Error(JSON.stringify(h));
          const event=t.open('event');assistantFocusSetScope(event,'occurrence','2026-11-09');
          if(!assistantFocusCorrect(event,'exceptionEmoji','🌟').ok)return false;
          await t.commit(event);
          const saved=load().find(row=>row.hid==='event');
          return saved.emoji==='' && saved.appointment.exceptions['2026-11-09'].emoji==='🌟';
        })],
        ['save preserves concurrent edits and undo preserves subsequent edits', async()=>{
          return page.evaluate(async()=>{
            const t=focusTest;t.seed();const s=t.open();
            await t.turn(s,'Make this 30 minutes','effort: 30 minutes',{effort:{phrase:'30 minutes',duration:'30 minutes'}});
            assistantFocusReviewModel(s);
            let data=load();data[0].priority=5;save(data);
            await t.commit(s);
            const saved=load()[0];
            data=load();data[0].emoji='✅';save(data);
            const undo=assistantFocusUndo(t.snapshot), after=load()[0];
            return saved.durationMinutes===30 && saved.priority===5 && undo.ok && after.durationMinutes===45 && after.priority===5 && after.emoji==='✅';
          });
        }],
        ['same-field conflict requires review instead of overwriting', async()=>page.evaluate(async()=>{
          const t=focusTest;
          for(const minutes of [30,45]){
            t.seed();const s=t.open();
            await t.turn(s,`Make this ${minutes} minutes`,`effort: ${minutes} minutes`,{effort:{phrase:`${minutes} minutes`,duration:`${minutes} minutes`}});
            assistantFocusReviewModel(s);assistantFocusApprove(s);
            const data=load();data[0].durationMinutes=75;save(data);
            const result=await assistantFocusCommit(s);
            if(!result.stale || load()[0].durationMinutes!==75)return false;
          }
          return true;
        })],
        ['occurrence changes preserve series and other dates', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open('event');
          await t.turn(s,'Make this 30 minutes','effort: 30 minutes',{effort:{phrase:'30 minutes',duration:'30 minutes'}});
          assistantFocusSetScope(s,'occurrence','2026-11-09');
          await t.commit(s);
          const event=load().find(row=>row.hid==='event');
          return event.durationMinutes===45 && event.appointment.exceptions['2026-11-09'].durationMinutes===30 && appointmentOccurrence(event,'2026-11-02').durationMinutes===45;
        })],
        ['new topic saves and undo preserves later topics and profiles', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Set topics to Fitness','organization: Fitness',{organization:{phrase:'Fitness',topics:'Fitness'}});
          await t.commit(s);
          const saved=load()[0].topics.includes('Fitness') && loadSortSettings().topics.includes('Fitness') && !load()[0].links.length;
          saveSortSettings({...loadSortSettings(), topics:loadSortSettings().topics.concat('Later'), weatherProfiles:loadSortSettings().weatherProfiles.concat({id:'later',name:'Later',rules:[]})});
          assistantFocusUndo(t.snapshot);
          const settings=loadSortSettings();
          return saved && settings.topics.includes('Later') && !settings.topics.includes('Fitness') && settings.weatherProfiles.some(row=>row.id==='later');
        })],
        ['new weather rules save and undo preserves a later profile', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Only when temperature is above 10 C','weather: temperature is above 10 C',{weather:{phrase:'temperature is above 10 C',rules:'temperature is above 10 C'}});
          await t.commit(s);
          const id=load()[0].weatherProfileId, saved=loadSortSettings().weatherProfiles.some(row=>row.id===id);
          saveSortSettings({...loadSortSettings(), weatherProfiles:loadSortSettings().weatherProfiles.concat({id:'later',name:'Later',rules:[]})});
          assistantFocusUndo(t.snapshot);
          const profiles=loadSortSettings().weatherProfiles;
          return saved && profiles.some(row=>row.id==='later') && !profiles.some(row=>row.id===id);
        })],
        ['duration and gap both stage from the same family', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'30 minutes with a 20 minute gap','effort: 30 minutes',{effort:missing=>missing ? {phrase:'20 minute gap',gap:'20 minute'} : {phrase:'30 minutes',duration:'30 minutes'}},'effort: 20 minute gap');
          const after=assistantFocusMaterialize(s);
          return after.durationMinutes===30 && after.minGapMinutes===20 && !s.unresolved.length;
        })],
        ['a new event has a valid save scope', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open('event','create');
          await t.turn(s,'Meeting once on 2026-11-09 at 9am','identity: Meeting; event: once on 2026-11-09 at 9am',{
            identity:{phrase:'Meeting',name:'Meeting'}, event:{phrase:'once on 2026-11-09 at 9am',repeat:'once',date:'2026-11-09',time:'9am'}
          });
          await t.commit(s);
          return load().filter(row=>row.name==='Meeting').length===2 && s.eventScope==='series';
        })],
        ['follow-up replaces a staged duration', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Make this 30 minutes','effort: 30 minutes',{effort:{phrase:'30 minutes',duration:'30 minutes'}});
          await t.turn(s,'Actually make it 60 minutes','effort: 60 minutes',{effort:{phrase:'60 minutes',duration:'60 minutes'}});
          await t.commit(s);
          return load()[0].durationMinutes===60;
        })],
        ['choosing an ambiguous place applies it before saving', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Set the place to Gym','places: Gym',{places:{phrase:'Gym',places:'Gym'}});
          const question=s.unresolved.find(row=>row.field==='places');
          if(!question || !question.choices.some(row=>row.id==='gym-west'))return false;
          _assistantSession = {focus:s};
          assistantShowFocusReview(s);
          const choice=assistantThreadEl().querySelector('[data-focus-value="gym-west"]');
          await assistantHandleFocusClick(choice);
          await t.commit(s);
          return load()[0].locationIds.join()==='gym-west';
        })],
        ['the summary keeps save and edit, without a separate interpretation step', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Three times a week, 30 minutes each','recurrence: Three times a week; effort: 30 minutes each',{
            recurrence:{phrase:'Three times a week',times:'3',period:'a week'}, effort:{phrase:'30 minutes each',duration:'30 minutes'}
          });
          if(s.changes.length<2)return false;
          s.changes.forEach(row=>row.uncertain=true);
          _assistantSession = {focus:s};assistantShowFocusReview(s);
          const review=assistantThreadEl().lastElementChild.querySelector('[data-focus-review]');
          const html=review.innerHTML;
          const note=html.indexOf('Settings outside this request stay as they are.');
          const buttons=html.indexOf('data-focus-save');
          return Boolean(review.querySelector('[data-focus-save]') && review.querySelector('[data-focus-edit]')
            && !review.querySelector('[data-focus-approve]')
            && !html.includes('never mind') && !html.includes('correct a value')
            && note>=0 && buttons>note && assistantFocusCanSave(s));
        })],
        ['edit opens detail with the staged values and does not save', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          await t.turn(s,'Make this 30 minutes','effort: 30 minutes',{effort:{phrase:'30 minutes',duration:'30 minutes'}});
          _assistantSession={focus:s};
          const result=assistantFocusEditDraft(s);
          const sheet=getSheetInner('detail-sheet');
          return result.ok && load()[0].durationMinutes===45 && Number($('detail-duration').value)===30
            && sheet.classList.contains('tune-dirty') && $('detail-sheet').classList.contains('open');
        })],
        ['reminder reset clears its scope and keeps explicit replacements and other dates', async()=>page.evaluate(async()=>{
          const t=focusTest,native=window.TingsNative;
          window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
          try{
            for(const scope of ['series','occurrence']){
              t.seed();
              const original={start:'notification',end:'alarm',travelLeadMinutes:60,dates:{'2026-11-09':{start:'notification',end:'alarm'},'2026-11-16':{end:'notification'}}};
              localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify({version:4,enabled:true,items:{'item:event':original,'item:other':{start:'alarm'}}}));
              const s=t.open('event');assistantFocusSetScope(s,scope,'2026-11-09');
              if(!assistantFocusCorrect(s,'reminderReset','reset').ok||!assistantFocusCorrect(s,'reminderStart','alarm').ok)return false;
              await t.commit(s);
              const prefs=JSON.parse(localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)),choice=prefs.items['item:event'];
              if(prefs.items['item:other'].start!=='alarm'||choice.dates['2026-11-16'].end!=='notification')return false;
              if(scope==='series'){
                if(choice.start!=='alarm'||choice.end!==undefined||choice.travelLeadMinutes!==undefined||choice.dates['2026-11-09'].end!=='alarm')return false;
              }else if(choice.start!=='notification'||choice.end!=='alarm'||choice.dates['2026-11-09'].start!=='alarm'||choice.dates['2026-11-09'].end!==undefined)return false;
            }
            return true;
          }finally{window.TingsNative=native;}
        })],
        ['reminder review shows mode and undo preserves other owners', async()=>page.evaluate(async()=>{
          const t=focusTest;t.seed();const s=t.open();
          const native=window.TingsNative;
          window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
          try{
            await t.turn(s,'Set the start reminder to alarm','reminders: start reminder to alarm',{reminders:{phrase:'start reminder to alarm',start:'alarm'}});
            const review=assistantFocusReviewModel(s), row=review.rows.find(row=>row.id==='reminderStart' && row.origin==='extracted');
            if(s.changes.some(change=>change.field!=='reminderStart') || !row || row.before!=='off' || row.after!=='ringing alarm')throw new Error(JSON.stringify({row,review}));
            await t.commit(s);
            const prefs=nativeReminderPreferences();prefs.items['item:event']={start:'notification'};localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify(prefs));
            assistantFocusUndo(t.snapshot);
            const after=nativeReminderPreferences();
            if(!(after.enabled && after.items['item:event'].start==='notification' && !after.items['item:gym']?.start))throw new Error(JSON.stringify({after,snapshot:t.snapshot}));return true;
          }finally{window.TingsNative=native;}
        })]
      ];
      const failures=[];
      for(const [name, run] of cases.filter(([name])=>!process.env.FOCUS_CASE || new RegExp(process.env.FOCUS_CASE).test(name))){
        try{assert(await run(), `${mode}: ${name}`);}
        catch(error){failures.push(`${name}: ${error.message}`); console.error(`  FAIL ${mode}: ${name}: ${error.message}`);}
        fs.writeFileSync(`test-results/needle-focus-regressions-${mode}.json`, JSON.stringify(await page.evaluate(()=>focusTest.traces),null,2));
      }
      assert(!errors.length, `${mode}: no page errors (${errors.join('; ')})`);
      await page.close();
      assert(!failures.length, `${mode}: ${failures.length} failing regressions\n${failures.join('\n')}`);
    }
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
