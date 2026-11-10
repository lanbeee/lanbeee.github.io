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
        seed(extra){
          save([{
            hid:'walk',name:'Walk',type:'keepup',target:7,durationMinutes:30,priority:2,logs:[],topics:[],pinned:false,
            links:[{kind:'phone',value:'5551234567'}],
            ...extra
          }]);
          saveSortSettings({...loadSortSettings(),locations:[{id:'park',name:'Park',lat:40,lng:-74}]});
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
      actionTest.seed(opts.seed||{});
      if(opts.logs){const data=load();data[0].logs=opts.logs;save(data);}
      const session=actionTest.open(opts.open||{});
      const before=JSON.stringify(load());
      await assistantFocusTurn(session,prompt,actionTest.options());
      const html=assistantFocusReviewHtml(session);
      const action=(session.itemActions||[])[0]||null;
      return {
        beforeSame:before===JSON.stringify(load()),
        changes:session.changes.map(change=>({field:change.field,key:change.value!=null&&['dueDate','planByDate'].includes(change.field)?dateKey(change.value):undefined,value:change.field==='durationMinutes'?change.value:undefined})),
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
      actionTest.seed(opts.seed||{});
      const session=actionTest.open(opts.open||{});
      const before=JSON.stringify(load());
      await assistantFocusTurn(session,prompt,actionTest.options());
      const picked=assistantFocusChoose(session,'guidance',choice);
      const html=assistantFocusReviewHtml(session);
      const action=(session.itemActions||[])[0]||null;
      return {
        beforeSame:before===JSON.stringify(load()),
        ok:Boolean(picked&&picked.ok),
        error:picked&&picked.error||'',
        changes:session.changes.map(change=>({field:change.field,key:change.value!=null&&['dueDate','planByDate'].includes(change.field)?dateKey(change.value):undefined})),
        questions:(session.unresolved||[]).map(row=>row.question),
        action:action&&{kind:action.kind,ready:Boolean(action.ready),plan:action.pendingPlan?{key:action.pendingPlan.key,timeMin:action.pendingPlan.timeMin}:null,summary:action.summary||''},
        button:html.includes('data-focus-choice="item-action"')
      };
    },{prompt,choice,opts});

    const yesterday=new Date('2026-11-07T12:00:00-05:00').getTime();
    const today=new Date('2026-11-08T15:00:00-05:00').getTime();
    const tomorrowPlan=new Date('2026-11-09T12:00:00-05:00').getTime();
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
