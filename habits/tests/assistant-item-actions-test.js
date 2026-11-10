// Focused log, undo, and one-day plan. Scripted extracts quote the user's
// sentence; confirmation writes, and the toast that follows only offers undo.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log(`  ok: ${message}`);}
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York',viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const OriginalDate=Date,now=new OriginalDate('2026-11-08T15:00:00-05:00').getTime();
      window.Date=class extends OriginalDate{
        constructor(...args){super(...(args.length?args:[now]));}
        static now(){return now;}
      };
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(()=>{
      const now=new Date('2026-11-08T15:00:00-05:00').getTime();
      window.actionTest={
        now,
        seed(extra, settings){
          settings = settings || {};
          save([{
            hid:'walk',name:'Walk',type:'keepup',target:7,durationMinutes:30,priority:2,logs:[],topics:[],pinned:false,
            links:[{kind:'phone',value:'5551234567'}],
            ...extra
          }, ...(settings.items || [])]);
          saveSortSettings({...loadSortSettings(),locations:settings.locations || [{id:'park',name:'Park',lat:40,lng:-74}]});
        },
        open(extra){
          return assistantFocusOpen({operation:'edit',kind:'habit',targetId:'walk',now,...extra});
        },
        reply(spec){
          if(spec.family==='families')return {confidence:1,function_calls:[{arguments:{evidence:'',outside:''}}]};
          if(spec.family==='completeness'||spec.family==='family-routing')return {confidence:1,function_calls:[{arguments:{family:'conversation',missing:''}}]};
          if(spec.family==='item-action'){
            const evidence=spec.tool.parameters.properties.evidence.enum[0]||'';
            return {confidence:1,function_calls:[{arguments:{evidence}}]};
          }
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
        },
        extract(spec){
          if(actionTest.mode==='decline'&&spec.family==='families')return {confidence:1,function_calls:[{arguments:{evidence:'',outside:'log: please remember yesterday'}}]};
          if(actionTest.mode==='adopt'&&spec.family==='families')return {confidence:1,function_calls:[{arguments:{evidence:'',outside:'log: please remember yesterday'}}]};
          if((actionTest.mode==='decline'||actionTest.mode==='empty')&&spec.family==='item-action')return {confidence:1,function_calls:[{arguments:{evidence:''}}]};
          return actionTest.reply(spec);
        },
        options(){return {extract:async spec=>actionTest.extract(spec),rank:async()=>({rankings:[]})};},
        logs(item){
          return normalizeLogs((item||load()[0]).logs).map(log=>{
            const ts=logTime(log),d=new Date(ts);
            return {key:dateKey(ts),plan:isPlanLog(log),minutes:log.minutes||null,note:log.note||'',value:log.value==null?null:log.value,timed:Boolean(log.timed),locationId:log.locationId||'',hour:d.getHours(),minute:d.getMinutes()};
          });
        },
        toast(){
          const buttons={};
          for(const id of ['action-undo','action-link','action-open','action-plan','snooze-until-planned']){
            const el=document.getElementById(id);
            buttons[id]={text:el?el.textContent.trim():'',hidden:!el||el.hidden};
          }
          return {text:document.getElementById('action-text')?.textContent||'',showing:document.getElementById('action-toast')?.classList.contains('show'),buttons};
        },
        onlyUndo(toast){
          return toast.showing&&toast.buttons['action-undo'].hidden===false&&toast.buttons['action-undo'].text==='undo'
            &&['action-link','action-open','action-plan','snooze-until-planned'].every(id=>toast.buttons[id].hidden);
        }
      };
    });
    const turn=async(prompt,opts={})=>page.evaluate(async({prompt,opts})=>{
      actionTest.mode=opts.mode||'';
      actionTest.seed(opts.seed||{}, opts.settings||{});
      if(opts.logs){const data=load();data[0].logs=opts.logs;save(data);}
      const session=actionTest.open(opts.open||{});
      if(opts.scope) assistantFocusSetScope(session, opts.scope, opts.date||'2026-11-09');
      const before=JSON.stringify(load());
      await assistantFocusTurn(session,prompt,actionTest.options());
      const html=assistantFocusReviewHtml(session);
      const action=(session.itemActions||[])[0]||null;
      const shown=field=>['durationMinutes','allowedWeekdays','preferredWeekdays','places','appointmentStartDate','appointmentRepeat','conditionRadiusM','scheduleLinks','earlyWindowDays','delayAllowanceDays'].includes(field);
      return {
        beforeSame:before===JSON.stringify(load()),
        changes:session.changes.map(change=>({field:change.field,op:change.op,key:change.value!=null&&['dueDate','planByDate'].includes(change.field)?dateKey(change.value):undefined,value:shown(change.field)?change.value:undefined})),
        questions:(session.unresolved||[]).map(row=>({field:row.field,question:row.question,choices:(row.choices||[]).map(choice=>choice.id||choice)})),
        guides:assistantGuideSuggestions(session,session.currentRequest).map(row=>row.id),
        action:action&&{kind:action.kind,ready:Boolean(action.ready),label:action.label||'',summary:action.summary||'',
          complete:action.pendingComplete?{action:action.pendingComplete.action,minutes:action.pendingComplete.minutes||null,value:action.pendingComplete.value??null,note:action.pendingComplete.note||'',at:action.pendingComplete.at||null,day:action.pendingComplete.at?dateKey(action.pendingComplete.at):''}:null,
          plan:action.pendingPlan?{action:action.pendingPlan.action,key:action.pendingPlan.key,timeMin:action.pendingPlan.timeMin,locationId:action.pendingPlan.locationId||''}:null},
        button:html.includes('data-focus-choice="item-action"'),
        skip:html.includes('item-action-skip'),
        actions:(session.itemActions||[]).length
      };
    },{prompt,opts});
    const confirm=async(prompt,opts={})=>page.evaluate(async({prompt,opts})=>{
      actionTest.mode='';
      actionTest.seed(opts.seed||{});
      if(opts.logs){const data=load();data[0].logs=opts.logs;save(data);}
      const session=actionTest.open(opts.open||{});
      const before=JSON.stringify(load());
      await assistantFocusTurn(session,prompt,actionTest.options());
      if(opts.skip){
        assistantFocusSkipAction(session,0);
        return {beforeSame:before===JSON.stringify(load()),skipped:!(session.itemActions||[]).length,logs:actionTest.logs(),toast:actionTest.toast()};
      }
      const wrote=assistantFocusCommitAction(session,0);
      const toast=actionTest.toast();
      const logs=actionTest.logs();
      const changed=before!==JSON.stringify(load());
      if(opts.undoToast)executeUndo();
      return {changed,ok:wrote.ok,error:wrote.error||'',action:wrote.action||'',logs,toast,onlyUndo:actionTest.onlyUndo(toast),afterUndo:opts.undoToast?actionTest.logs():null,remaining:session.itemActions||[]};
    },{prompt,opts});
    const choose=async(prompt,choice,opts={})=>page.evaluate(async({prompt,choice,opts})=>{
      actionTest.mode='';
      actionTest.seed(opts.seed||{}, opts.settings||{});
      const session=actionTest.open(opts.open||{});
      if(opts.scope) assistantFocusSetScope(session, opts.scope, opts.date||'2026-11-09');
      const before=JSON.stringify(load());
      await assistantFocusTurn(session,prompt,actionTest.options());
      const picked=assistantFocusChoose(session,'guidance',choice);
      const html=assistantFocusReviewHtml(session);
      const action=(session.itemActions||[])[0]||null;
      const record=assistantFocusMaterialize(session);
      const occurrence=record.appointment&&record.appointment.exceptions?record.appointment.exceptions[session.occurrenceDate]||null:null;
      const shown=field=>['durationMinutes','allowedWeekdays','preferredWeekdays','places','appointmentStartDate','appointmentRepeat','conditionRadiusM','scheduleLinks','earlyWindowDays','delayAllowanceDays'].includes(field);
      return {
        beforeSame:before===JSON.stringify(load()),
        ok:Boolean(picked&&picked.ok),
        error:picked&&picked.error||'',
        changes:session.changes.map(change=>({field:change.field,op:change.op,key:change.value!=null&&['dueDate','planByDate'].includes(change.field)?dateKey(change.value):undefined,value:shown(change.field)?change.value:undefined})),
        questions:(session.unresolved||[]).map(row=>row.question),
        asked:(session.unresolved||[]).map(row=>row.field),
        action:action&&{kind:action.kind,ready:Boolean(action.ready),plan:action.pendingPlan?{key:action.pendingPlan.key,timeMin:action.pendingPlan.timeMin}:null,
          complete:action.pendingComplete?{day:action.pendingComplete.at?dateKey(action.pendingComplete.at):''}:null,summary:action.summary||''},
        button:html.includes('data-focus-choice="item-action"'),
        exception:occurrence
      };
    },{prompt,choice,opts});

    const yesterday=new Date('2026-11-07T12:00:00-05:00').getTime();
    const today=new Date('2026-11-08T15:00:00-05:00').getTime();
    const tomorrowPlan=new Date('2026-11-09T12:00:00-05:00').getTime();
    const earlierToday=await turn('Log it today at 9am');
    assert(earlierToday.beforeSame&&!earlierToday.actions&&earlierToday.questions.some(q=>/exact clock time/.test(q.question)),
      'an exact log time asks instead of silently snapping it to a different time');
    const futureTime=await turn('Log it today at 4pm');
    assert(futureTime.beforeSame&&!futureTime.actions&&futureTime.questions.some(q=>/exact clock time/.test(q.question)),
      'a completion cannot be logged for a future time today');
    const exactUndo=await turn('Undo yesterday at 9am',{logs:[yesterday]});
    assert(exactUndo.beforeSame&&!exactUndo.actions&&exactUndo.questions.length>0,
      'undo at a specific time asks instead of deleting a different completion');
    const sibling={hid:'water',name:'Water',type:'keepup',target:7,durationMinutes:10,logs:[]};
    for(const prompt of ['Log Water yesterday','Plan Water for tomorrow','Make Water 20 minutes',
      "Set Water's duration to 20 minutes",'For Water, make it 20 minutes',
      'Make it 20 minutes and log Water yesterday','Water should be 20 minutes']){
      const row=await turn(prompt,{settings:{items:[sibling]}});
      assert(row.beforeSame&&!row.actions&&!row.changes.length&&row.questions.some(q=>q.field==='request'),
        `a request for another item cannot change or log the open item: ${prompt}`);
    }
    const noteWithSibling=await turn('Log it yesterday with note: Water was great',{settings:{items:[sibling]}});
    assert(noteWithSibling.beforeSame&&noteWithSibling.action?.ready&&noteWithSibling.action.complete.note==='Water was great',
      'a sibling name inside a log note remains literal text');
    for(const prompt of ['Log it yesterday','Plan it for tomorrow']){
      for(const scenario of ['deleted','replaced','reordered','closed','reading','wrong-id']){
        const row=await page.evaluate(async({prompt,scenario,sibling})=>{
          actionTest.mode='';actionTest.seed({}, {items:[sibling]});
          const s=actionTest.open();await assistantFocusTurn(s,prompt,actionTest.options());
          const offered=Boolean(s.itemActions[0]?.ready);
          if(scenario==='deleted')save(load().filter(item=>item.hid!=='walk'));
          if(scenario==='replaced')save(load().map(item=>item.hid==='walk'?{...item,hid:'replacement'}:item));
          if(scenario==='reordered')save(load().reverse());
          if(scenario==='closed')assistantFocusInvalidate();
          if(scenario==='reading')s._focusInFlight=true;
          if(scenario==='wrong-id'){
            const action=s.itemActions[0];(action.pendingComplete||action.pendingPlan).hid='water';
          }
          const before=JSON.stringify(load()),result=assistantFocusCommitAction(s,0);
          return {offered,ok:result.ok,unchanged:before===JSON.stringify(load()),items:load()};
        },{prompt,scenario,sibling});
        const expected=scenario==='reordered';
        assert(row.offered&&row.ok===expected&&row.unchanged===!expected
          &&(!expected||(row.items.find(item=>item.hid==='walk').logs.length===1
            &&row.items.find(item=>item.hid==='water').logs.length===0)),
          `${prompt}: confirmation stays on the original ID when ${scenario} (${JSON.stringify(row)})`);
      }
    }
    await page.evaluate(()=>hideActionToast());
    const logPrompts=[
      'I forgot to log this yesterday',
      'I didn\'t log it yesterday',
      'log it for yesterday',
      'mark it done yesterday',
      'I already finished this yesterday',
      'check it off for yesterday',
      'got it done yesterday',
      'knocked it out yesterday'
    ];
    for(const prompt of logPrompts){
      const row=await turn(prompt);
      assert(row.beforeSame&&row.action&&row.action.ready&&row.action.kind==='log'&&row.action.label==='log it'&&row.button&&row.skip&&!row.changes.length&&row.action.complete&&row.action.complete.day==='2026-11-07',
        `${prompt} offers a yesterday log and writes nothing yet (${JSON.stringify(row)})`);
    }
    const planPrompts=[
      ['put this on tomorrow\'s plan','2026-11-09',null],
      ['add this to tomorrow','2026-11-09',null],
      ['add a plan for tomorrow','2026-11-09',null],
      ['pencil it in tomorrow','2026-11-09',null],
      ['schedule it for Friday','2026-11-13',null],
      ['book it for Friday at 3pm','2026-11-13',900],
      ['block time tomorrow','2026-11-09',null],
      ['set aside time on Friday','2026-11-13',null],
      ['Can you plan this for tomorrow','2026-11-09',null],
      ['Can we plan it for tomorrow?','2026-11-09',null],
      ['plan it for next week','2026-11-15',null],
      ['plan this for the day after tomorrow','2026-11-10',null],
      ['plan it for five days in the future','2026-11-13',null],
      ['plan this for five days from now','2026-11-13',null],
      ['schedule it in a week','2026-11-15',null],
      ['plan this on November 20, 2026','2026-11-20',null],
      ['plan this for 2026-11-20','2026-11-20',null],
      ['plan this for 11/20/2026','2026-11-20',null],
      ['plan this on next Friday','2026-11-13',null],
      ['book it for a week from today','2026-11-15',null],
      ['plan this in five days','2026-11-13',null],
      ['put this on November 20','2026-11-20',null],
      ['add it for next Friday','2026-11-13',null],
      ['Can you plan this for tomorrow at 3pm','2026-11-09',900]
    ];
    for(const [prompt,key,timeMin] of planPrompts){
      const row=await turn(prompt);
      assert(row.beforeSame&&row.action&&row.action.ready&&row.action.kind==='plan'&&row.action.label==='plan it'&&row.action.plan&&row.action.plan.key===key&&row.action.plan.timeMin===timeMin&&!row.changes.some(change=>change.field==='dueDate'||change.field==='planByDate'),
        `${prompt} offers a one-day plan and does not change a due date (${JSON.stringify(row)})`);
    }

    const due=await turn('Let\'s plan for tomorrow',{open:{kind:'task'},seed:{type:'task'}});
    assert(due.beforeSame&&!due.action&&due.changes.length===1&&due.changes[0].field==='dueDate'&&due.changes[0].key==='2026-11-09',
      `Let's plan for tomorrow stays a due date (${JSON.stringify(due)})`);
    const planOnTask=await turn('Can you plan this for tomorrow',{open:{kind:'task'},seed:{type:'task'}});
    assert(planOnTask.beforeSame&&planOnTask.action&&planOnTask.action.ready&&planOnTask.action.plan&&planOnTask.action.plan.key==='2026-11-09'&&!planOnTask.changes.some(change=>change.field==='dueDate'),
      `planning a task for tomorrow is a one-day plan (${JSON.stringify(planOnTask)})`);
    const planByCases=[
      ['Can you plan this by tomorrow','planByDate','2026-11-09',{}],
      ['Plan this by the day after tomorrow','planByDate','2026-11-10',{}],
      ['Plan by five days from now','planByDate','2026-11-13',{}],
      ['Do this by Friday','planByDate','2026-11-13',{}],
      ['Do this by next Friday','planByDate','2026-11-13',{}],
      ['Can you plan this by next week','planByDate','2026-11-15',{}],
      ['Set the plan-by date to November 20, 2026','planByDate','2026-11-20',{}],
      ['Plan this by tomorrow','dueDate','2026-11-09',{open:{kind:'task'},seed:{type:'task'}}],
      ['Do this by Friday','dueDate','2026-11-13',{open:{kind:'task'},seed:{type:'task'}}],
      ['It is due Friday','dueDate','2026-11-13',{open:{kind:'task'},seed:{type:'task'}}],
      ['The deadline is the day after tomorrow','dueDate','2026-11-10',{open:{kind:'task'},seed:{type:'task'}}],
      ['It is due in five days','dueDate','2026-11-13',{open:{kind:'task'},seed:{type:'task'}}],
      ['Set the due date to 11/20/2026','dueDate','2026-11-20',{open:{kind:'task'},seed:{type:'task'}}]
    ];
    for(const [prompt,field,key,opts] of planByCases){
      const row=await turn(prompt,opts);
      assert(row.beforeSame&&!row.action&&row.changes.length===1&&row.changes[0].field===field&&row.changes[0].key===key,
        `${prompt} stays the ${field} (${JSON.stringify(row)})`);
    }
    const ambiguous=await turn('Plan this day after tomorrow');
    assert(ambiguous.beforeSame&&!ambiguous.action&&ambiguous.questions.length===1&&ambiguous.questions[0].field==='guidance'
      &&ambiguous.questions[0].choices.join()==='action:plan,field:planByDate'
      &&ambiguous.guides.join()==='action:plan,field:planByDate',
      `plan this day after tomorrow asks for the plan or the plan-by date (${JSON.stringify(ambiguous)})`);
    const ambiguousFriday=await turn('plan it next Friday');
    assert(ambiguousFriday.beforeSame&&!ambiguousFriday.action&&ambiguousFriday.questions[0]&&ambiguousFriday.questions[0].choices.join()==='action:plan,field:planByDate',
      `plan it next Friday asks instead of guessing (${JSON.stringify(ambiguousFriday)})`);
    const pickedPlan=await choose('Plan this day after tomorrow','action:plan');
    assert(pickedPlan.beforeSame&&pickedPlan.ok&&pickedPlan.action&&pickedPlan.action.ready&&pickedPlan.action.plan.key==='2026-11-10'&&pickedPlan.button&&!pickedPlan.changes.length,
      `choosing the one-day plan uses the day after tomorrow (${JSON.stringify(pickedPlan)})`);
    const pickedDate=await choose('Plan this day after tomorrow','field:planByDate');
    assert(pickedDate.beforeSame&&pickedDate.ok&&!pickedDate.action&&pickedDate.changes.length===1&&pickedDate.changes[0].field==='planByDate'&&pickedDate.changes[0].key==='2026-11-10',
      `choosing the plan-by date uses the day after tomorrow (${JSON.stringify(pickedDate)})`);
    const pickedDue=await choose('Plan this day after tomorrow','field:dueDate',{open:{kind:'task'},seed:{type:'task'}});
    assert(pickedDue.beforeSame&&pickedDue.ok&&pickedDue.changes.length===1&&pickedDue.changes[0].field==='dueDate'&&pickedDue.changes[0].key==='2026-11-10',
      `choosing the due date uses the day after tomorrow (${JSON.stringify(pickedDue)})`);
    const mixedPlan=await turn('Make it 30 minutes and plan this day after tomorrow');
    assert(mixedPlan.beforeSame&&mixedPlan.changes.length===1&&mixedPlan.changes[0].field==='durationMinutes'&&mixedPlan.changes[0].value===30
      &&mixedPlan.questions.some(row=>row.field==='guidance'&&row.choices.join()==='action:plan,field:planByDate'),
      `a length stays separate from an unclear plan day (${JSON.stringify(mixedPlan)})`);
    const duration=await turn('Make it 45 minutes');
    assert(duration.beforeSame&&!duration.action&&duration.changes.length===1&&duration.changes[0].field==='durationMinutes'&&duration.changes[0].value===45,
      `a length change stays the duration (${JSON.stringify(duration)})`);
    const mixed=await turn('Make it 30 minutes and I forgot to log it yesterday');
    assert(mixed.beforeSame&&mixed.changes.length===1&&mixed.changes[0].field==='durationMinutes'&&mixed.changes[0].value===30&&mixed.action&&mixed.action.ready&&mixed.action.complete.day==='2026-11-07'&&mixed.action.complete.minutes==null,
      `a length and a missed log stay separate (${JSON.stringify(mixed)})`);
    const loggedLength=await turn('log 20 minutes yesterday');
    assert(loggedLength.beforeSame&&!loggedLength.changes.length&&loggedLength.action&&loggedLength.action.complete.minutes===20&&loggedLength.action.complete.day==='2026-11-07',
      `logged minutes stay on the completion (${JSON.stringify(loggedLength)})`);
    const joined=await turn('log one hour and 30 minutes yesterday');
    assert(joined.beforeSame&&joined.action&&joined.action.complete.minutes===90&&joined.action.complete.day==='2026-11-07',
      `an hour and minutes are one logged length (${JSON.stringify(joined)})`);
    const noted=await turn('log 20 minutes yesterday with a note that the park was closed');
    assert(noted.action&&noted.action.complete.minutes===20&&noted.action.complete.note==='the park was closed'&&noted.action.complete.day==='2026-11-07',
      `a note stays on the completion (${JSON.stringify(noted)})`);
    const valued=await turn('log it yesterday with a value of 8');
    assert(valued.action&&valued.action.complete.value===8&&valued.action.complete.day==='2026-11-07',
      `a value stays on the completion (${JSON.stringify(valued)})`);
    const placed=await turn('schedule it for Friday at 3pm at the Park');
    assert(placed.action&&placed.action.plan.key==='2026-11-13'&&placed.action.plan.timeMin===900&&placed.action.plan.locationId==='park',
      `a plan can carry a time and a saved place (${JSON.stringify(placed)})`);

    const future=await turn('log it tomorrow');
    assert(future.beforeSame&&!future.action&&future.questions.some(row=>/today or a past day/.test(row.question)),
      `a future completion asks instead of writing (${JSON.stringify(future)})`);
    const past=await turn('plan it on yesterday');
    assert(past.beforeSame&&!past.action&&past.questions.some(row=>/today or a future day/.test(row.question)),
      `a past plan asks instead of writing (${JSON.stringify(past)})`);
    const twoDays=await turn('I forgot to log it yesterday or last Friday');
    assert(twoDays.beforeSame&&!twoDays.action&&twoDays.questions.some(row=>/Which day/.test(row.question)),
      `two dates ask which day (${JSON.stringify(twoDays)})`);
    const vague=await turn('I forgot to log it a couple of days ago');
    assert(vague.beforeSame&&!vague.action&&vague.questions.some(row=>/Which day/.test(row.question)),
      `a vague day asks which day (${JSON.stringify(vague)})`);
    const noTime=await turn('schedule it at 3pm or 4pm tomorrow');
    assert(noTime.beforeSame&&!noTime.action&&noTime.questions.some(row=>/Which time/.test(row.question)),
      `two times ask which time (${JSON.stringify(noTime)})`);
    const settings=[
      ['log a value when I check it off','trackValue'],
      ['automatically mark it done','autoMarkMinutes'],
      ['start with a tap','tapStartsSession'],
      ['undo the duration','durationMinutes']
    ];
    for(const [prompt,field] of settings){
      const row=await turn(prompt);
      const stayed=!row.action&&(row.changes.every(change=>change.field===field)||row.questions.some(question=>question.field===field)||!row.changes.length&&row.questions.length);
      assert(row.beforeSame&&stayed, `${prompt} stays a setting (${JSON.stringify(row)})`);
    }
    const stop=await turn('put this on tomorrow\'s plan',{seed:{type:'zero',name:'Sugar'}});
    assert(stop.beforeSame&&stop.action&&stop.action.ready===false&&/Stop habits/.test(stop.action.summary)&&!stop.button,
      `a stop habit explains that it cannot be planned (${JSON.stringify(stop)})`);
    const eventPlan=await turn('put this on tomorrow\'s plan',{open:{kind:'event'},seed:{type:'task'}});
    assert(eventPlan.beforeSame&&!eventPlan.action, `an event does not get a one-day plan (${JSON.stringify(eventPlan)})`);
    const eventLog=await turn('I forgot to log this yesterday',{open:{kind:'event'},seed:{type:'task'}});
    assert(eventLog.beforeSame&&eventLog.action&&eventLog.action.ready&&eventLog.action.complete.day==='2026-11-07',
      `an event can still be logged for yesterday (${JSON.stringify(eventLog)})`);
    const created=await turn('I forgot to log this yesterday',{open:{operation:'create',targetId:null}});
    assert(created.beforeSame&&!created.action&&!created.changes.some(change=>change.field==='name'), `creating an item ignores a log request (${JSON.stringify(created)})`);

    const declined=await turn('please remember yesterday',{mode:'decline'});
    assert(declined.beforeSame&&!declined.action&&declined.questions.some(row=>/rephrase/i.test(row.question)),
      `a discovered phrase with no quoted sentence asks and does not write (${JSON.stringify(declined)})`);
    const adopted=await turn('please remember yesterday',{mode:'adopt'});
    assert(adopted.beforeSame&&adopted.action&&adopted.action.ready&&adopted.action.complete.day==='2026-11-07',
      `a discovered phrase logs yesterday when the sentence comes back (${JSON.stringify(adopted)})`);
    const emptyCue=await turn('I forgot to log this yesterday',{mode:'empty'});
    assert(emptyCue.beforeSame&&emptyCue.action&&emptyCue.action.ready&&emptyCue.action.complete.day==='2026-11-07',
      `an explicit log still uses the user's sentence when the model declines (${JSON.stringify(emptyCue)})`);

    const skipped=await confirm('I forgot to log this yesterday',{skip:true});
    assert(skipped.beforeSame&&skipped.skipped&&!skipped.logs.length&&!skipped.toast.showing,
      `never mind writes nothing (${JSON.stringify(skipped)})`);
    const logged=await confirm('I forgot to log this yesterday',{undoToast:true});
    assert(logged.changed&&logged.ok&&logged.logs.length===1&&logged.logs[0].key==='2026-11-07'&&!logged.logs[0].plan&&logged.onlyUndo&&logged.afterUndo.length===0,
      `confirming a log writes that day, shows only undo, and undo removes it (${JSON.stringify(logged)})`);
    const detailed=await confirm('log 20 minutes yesterday with a note "park was closed" and a value of 8');
    assert(detailed.ok&&detailed.onlyUndo&&detailed.logs.length===1&&detailed.logs[0].key==='2026-11-07'&&detailed.logs[0].minutes===20&&detailed.logs[0].note==='park was closed'&&detailed.logs[0].value===8,
      `confirming a detailed log keeps the minutes, note, and value (${JSON.stringify(detailed)})`);
    const planned=await confirm('schedule it for Friday at 3pm at the Park',{undoToast:true});
    assert(planned.ok&&planned.onlyUndo&&planned.logs.length===1&&planned.logs[0].plan&&planned.logs[0].key==='2026-11-13'&&planned.logs[0].timed&&planned.logs[0].hour===15&&planned.logs[0].locationId==='park'&&planned.afterUndo.length===0,
      `confirming a plan writes that day and time, shows only undo, and undo removes it (${JSON.stringify(planned)})`);
    const removed=await confirm('take it off tomorrow\'s plan',{logs:[{ts:tomorrowPlan,plan:true}]});
    assert(removed.ok&&removed.onlyUndo&&!removed.logs.some(log=>log.plan&&log.key==='2026-11-09'),
      `confirming an unplan removes that day's plan and shows only undo (${JSON.stringify(removed)})`);
    const undone=await confirm('undo yesterday\'s log',{logs:[yesterday,today]});
    assert(undone.ok&&undone.action==='undo_today'&&undone.onlyUndo&&undone.logs.length===1&&undone.logs[0].key==='2026-11-08',
      `undo removes the named day's completion and shows only undo (${JSON.stringify(undone)})`);
    const missing=await turn('mark it not done');
    assert(missing.beforeSame&&missing.action&&missing.action.ready===false&&/no completion/.test(missing.action.summary)&&!missing.button,
      `undo with nothing logged explains that and does not write (${JSON.stringify(missing)})`);

    const guidanceIds=row=>{
      const question=(row.questions||[]).find(item=>item.field==='guidance')||{choices:[]};
      return (question.choices||[]).join();
    };
    const places=[{id:'home',name:'Home',lat:40,lng:-74},{id:'work',name:'Work',lat:41,lng:-73}];
    const eventSeed={appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'',exceptions:{}}};
    const framed=[
      ['If possible, plan this for tomorrow','action:plan,field:planByDate',{}],
      ['Ideally, plan this for tomorrow','action:plan,field:planByDate',{}],
      ['I would rather plan this for tomorrow','action:plan,field:planByDate',{}],
      ['If possible, plan this for tomorrow','action:plan,field:dueDate',{open:{kind:'task'},seed:{type:'task'}}]
    ];
    for(const [prompt,ids,opts] of framed){
      const row=await turn(prompt,opts);
      assert(row.beforeSame&&!row.action&&!row.changes.length&&guidanceIds(row)===ids&&row.guides.join()===ids,
        `${prompt} asks instead of planning (${JSON.stringify(row)})`);
    }
    const framedPlan=await choose('If possible, plan this for tomorrow','action:plan');
    assert(framedPlan.beforeSame&&framedPlan.ok&&framedPlan.action&&framedPlan.action.ready&&framedPlan.action.plan.key==='2026-11-09'&&!framedPlan.changes.length,
      `choosing the framed plan uses tomorrow (${JSON.stringify(framedPlan)})`);
    const framedDate=await choose('If possible, plan this for tomorrow','field:planByDate');
    assert(framedDate.beforeSame&&framedDate.ok&&!framedDate.action&&framedDate.changes.length===1&&framedDate.changes[0].field==='planByDate'&&framedDate.changes[0].key==='2026-11-09',
      `choosing the framed do-by date uses tomorrow (${JSON.stringify(framedDate)})`);
    const counted=await turn('Count this as done');
    assert(counted.beforeSame&&!counted.action&&!counted.changes.length&&guidanceIds(counted)==='action:log,field:autoMarkMinutes',
      `count this as done asks for a log or automatic completion (${JSON.stringify(counted)})`);
    const countedDay=await turn('Count this as done yesterday');
    assert(countedDay.beforeSame&&!countedDay.action&&guidanceIds(countedDay)==='action:log,field:autoMarkMinutes',
      `count this as done yesterday asks before logging (${JSON.stringify(countedDay)})`);
    const countedLog=await choose('Count this as done yesterday','action:log');
    assert(countedLog.ok&&countedLog.action&&countedLog.action.ready&&countedLog.action.complete&&countedLog.action.complete.day==='2026-11-07',
      `choosing the log uses yesterday (${JSON.stringify(countedLog)})`);
    const countedMark=await choose('Count this as done','field:autoMarkMinutes');
    assert(!countedMark.action&&!countedMark.changes.length&&countedMark.asked.includes('autoMarkMinutes'),
      `choosing automatic completion asks for a length (${JSON.stringify(countedMark)})`);
    const early=await turn('Make the 25 minute session start early');
    assert(early.beforeSame&&!early.changes.length&&guidanceIds(early)==='field:durationMinutes,field:earlyWindowDays',
      `a session length beside early asks which one (${JSON.stringify(early)})`);
    const earlyLength=await choose('Make the 25 minute session start early','field:durationMinutes');
    assert(earlyLength.ok&&earlyLength.changes.length===1&&earlyLength.changes[0].value===25,
      `choosing duration keeps 25 minutes (${JSON.stringify(earlyLength)})`);
    const earlyAsk=await choose('Make the 25 minute session start early','field:earlyWindowDays');
    assert(!earlyAsk.changes.length&&earlyAsk.asked.includes('earlyWindowDays'),
      `choosing early allowance does not set the duration (${JSON.stringify(earlyAsk)})`);
    const late=await turn('Make it 30 minutes so I am not late');
    assert(late.beforeSame&&!late.changes.length&&guidanceIds(late)==='field:durationMinutes,field:delayAllowanceDays',
      `a length beside late asks which one (${JSON.stringify(late)})`);
    const eitherDays=await turn('Do it on either Monday or Wednesday');
    assert(eitherDays.beforeSame&&!eitherDays.changes.length&&guidanceIds(eitherDays)==='field:allowedWeekdays,field:scheduleOptions',
      `either weekday asks for days or alternatives (${JSON.stringify(eitherDays)})`);
    const pickedDays=await choose('Do it on either Monday or Wednesday','field:allowedWeekdays');
    assert(pickedDays.ok&&pickedDays.changes.length===1&&JSON.stringify(pickedDays.changes[0].value)==='[1,3]',
      `choosing weekdays sets Monday and Wednesday (${JSON.stringify(pickedDays)})`);
    const alternate=await turn('Do this on alternate Mondays');
    assert(alternate.beforeSame&&!alternate.changes.length&&guidanceIds(alternate)==='field:allowedWeekdays,field:scheduleOptions',
      `alternate Mondays asks instead of failing (${JSON.stringify(alternate)})`);
    const eitherPlace=await turn('Do this at Home or at Work',{settings:{locations:places}});
    assert(eitherPlace.beforeSame&&!eitherPlace.changes.length&&guidanceIds(eitherPlace)==='field:places,field:scheduleOptions',
      `Home or Work asks for places or alternatives (${JSON.stringify(eitherPlace)})`);
    const pickedPlaces=await choose('Do this at Home or at Work','field:places',{settings:{locations:places}});
    assert(pickedPlaces.ok&&pickedPlaces.changes.length===1&&JSON.stringify([].concat(pickedPlaces.changes[0].value).sort())==='["home","work"]',
      `choosing places assigns Home and Work (${JSON.stringify(pickedPlaces)})`);
    const distance=await turn('Walk 30 minutes within 2 kilometers of Home',{settings:{locations:places}});
    assert(distance.beforeSame&&!distance.changes.length&&guidanceIds(distance)==='field:durationMinutes,field:places',
      `a walk near Home asks for the length or the place (${JSON.stringify(distance)})`);
    const near=await turn('Only at Home within 300 meters',{seed:{repeatMode:'opportunity',conditionTrigger:'location'},settings:{locations:places}});
    assert(near.beforeSame&&!near.changes.length&&guidanceIds(near)==='field:conditionRadiusM,field:places',
      `Home within 300 meters asks for the place or the radius (${JSON.stringify(near)})`);
    const moved=await turn('Move this date to November 20',{open:{kind:'event'},seed:eventSeed,scope:'series'});
    assert(moved.beforeSame&&!moved.changes.length&&guidanceIds(moved)==='field:appointmentStartDate,field:appointmentStartMinute',
      `moving this date asks for the date or the time (${JSON.stringify(moved)})`);
    const movedDate=await choose('Move this date to November 20','field:appointmentStartDate',{open:{kind:'event'},seed:eventSeed,scope:'series'});
    assert(movedDate.ok&&movedDate.changes.length===1&&movedDate.changes[0].value==='2026-11-20',
      `choosing the start date uses November 20 (${JSON.stringify(movedDate)})`);
    const movedTime=await choose('Move this date to November 20','field:appointmentStartMinute',{open:{kind:'event'},seed:eventSeed,scope:'series'});
    assert(!movedTime.changes.some(change=>change.field==='appointmentStartDate')&&movedTime.asked.includes('appointmentStartMinute'),
      `choosing the start time asks for a clock (${JSON.stringify(movedTime)})`);
    const exceptionSeed={appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'',exceptions:{'2026-11-09':{startMinute:660,durationMinutes:15,emoji:'🌙'}}}};
    const reset=await turn('Move it back to the regular time',{open:{kind:'event'},seed:exceptionSeed,scope:'occurrence'});
    assert(reset.beforeSame&&!reset.changes.length&&guidanceIds(reset)==='field:exceptionReset,field:exceptionTime',
      `the regular time asks for a full reset or only the time (${JSON.stringify(reset)})`);
    const resetAll=await choose('Move it back to the regular time','field:exceptionReset',{open:{kind:'event'},seed:exceptionSeed,scope:'occurrence'});
    assert(resetAll.ok&&resetAll.exception==null,
      `the full reset clears the occurrence (${JSON.stringify(resetAll)})`);
    const resetTime=await choose('Move it back to the regular time','field:exceptionTime',{open:{kind:'event'},seed:exceptionSeed,scope:'occurrence'});
    assert(resetTime.ok&&resetTime.exception&&resetTime.exception.startMinute==null&&resetTime.exception.emoji==='🌙'&&resetTime.exception.durationMinutes===15,
      `only the usual time keeps the emoji and duration (${JSON.stringify(resetTime)})`);
    const once=await turn('Make it a single occurrence',{open:{kind:'event'},seed:eventSeed,scope:'series'});
    assert(once.beforeSame&&once.changes.length===1&&once.changes[0].field==='appointmentRepeat'&&once.changes[0].value==='once'&&!once.questions.some(row=>row.field==='guidance'),
      `a single occurrence becomes once (${JSON.stringify(once)})`);
    const onceSentence=await turn('It is a single occurrence rather than a recurring event now',{open:{kind:'event'},seed:eventSeed,scope:'series'});
    assert(onceSentence.beforeSame&&onceSentence.changes.some(change=>change.field==='appointmentRepeat'&&change.value==='once')&&!onceSentence.questions.some(row=>row.field==='guidance'),
      `the full single-occurrence sentence becomes once (${JSON.stringify(onceSentence)})`);
    const meeting={hid:'meeting',name:'Meeting',type:'keepup',target:7,durationMinutes:30,logs:[]};
    const beforeLink=await turn('It no longer has to follow Meeting',{seed:{scheduleLinks:[{anchorHid:'meeting',direction:'before'}]},settings:{items:[meeting]}});
    assert(beforeLink.beforeSame&&!beforeLink.changes.some(change=>change.field==='scheduleLinks')&&beforeLink.questions.some(row=>/order/i.test(row.question)),
      `a before-link is not reported as removed (${JSON.stringify(beforeLink)})`);
    const afterLink=await turn('It no longer has to follow Meeting',{seed:{scheduleLinks:[{anchorHid:'meeting',direction:'after'}]},settings:{items:[meeting]}});
    assert(afterLink.beforeSame&&afterLink.changes.some(change=>change.field==='scheduleLinks'&&change.op==='clear'),
      `an after-link is removed (${JSON.stringify(afterLink)})`);

    await page.evaluate(async()=>{
      actionTest.mode='';
      actionTest.seed();
      const session=actionTest.open();
      if(!_assistantSession)_assistantSession=assistantCreateSession();
      _assistantSession.focus=session;
      await assistantFocusTurn(session,'If possible, plan this for tomorrow',actionTest.options());
      assistantShowFocusReview(session);
      return openAssistantSheet({skipWelcome:true,focused:true});
    });
    await page.locator('[data-focus-value="action:plan"]').click();
    const guided=await page.evaluate(()=>{
      const action=(_assistantSession.focus.itemActions||[])[0]||null;
      if(typeof closeAssistantSheet==='function')closeAssistantSheet();
      return {ready:Boolean(action&&action.ready),key:action&&action.pendingPlan?action.pendingPlan.key:''};
    });
    assert(guided.ready&&guided.key==='2026-11-09', `the guidance button plans tomorrow (${JSON.stringify(guided)})`);

    await page.evaluate(()=>{
      actionTest.mode='';
      actionTest.seed();
      patchLocalAssistant({localAssistant:true,localAssistantProvider:'ollama'});
      const session=actionTest.open();
      if(!_assistantSession)_assistantSession=assistantCreateSession();
      _assistantSession.focus=session;
      return openAssistantSheet({skipWelcome:true,focused:true});
    });
    await page.evaluate(async()=>{
      const session=_assistantSession.focus;
      await assistantFocusTurn(session,'I forgot to log this yesterday',actionTest.options());
      assistantShowFocusReview(session);
    });
    await page.locator('[data-focus-choice="item-action"]').click();
    await page.waitForFunction(()=>normalizeLogs(load()[0].logs).some(log=>dateKey(logTime(log))==='2026-11-07'));
    const clicked=await page.evaluate(()=>({
      logs:actionTest.logs(),
      toast:actionTest.toast(),
      onlyUndo:actionTest.onlyUndo(actionTest.toast()),
      said:(document.getElementById('assistant-thread')?.innerText||'').includes('Undo is on the toast.'),
      stillOffered:Boolean(document.querySelector('[data-focus-choice="item-action"]'))
    }));
    assert(clicked.logs.length===1&&clicked.logs[0].key==='2026-11-07'&&clicked.onlyUndo&&clicked.said&&!clicked.stillOffered,
      `the confirm button writes the log and leaves undo only on the toast (${JSON.stringify(clicked)})`);
    const card=await page.evaluate(()=>{
      executeUndo();
      actionTest.seed();
      logTing(0);
      return actionTest.toast();
    });
    assert(card.showing&&card.buttons['action-plan'].hidden===false&&card.buttons['action-plan'].text==='plan instead'&&card.buttons['action-link'].hidden===false,
      `a card tap still offers plan instead and the item link (${JSON.stringify(card)})`);
    assert(!errors.length, `no page errors (${errors.join('; ')})`);
    console.log(`item actions: ${passed} checks`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
