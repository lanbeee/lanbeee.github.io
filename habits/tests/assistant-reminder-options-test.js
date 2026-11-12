const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const live=Boolean(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH);
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    if(live)await page.route('https://huggingface.co/**',route=>route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async live=>{
      if(live){patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});await assistantNeedleDownload();}
      window.reminderTest={
        seed(kind='task',scope='series'){
          window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
          showActionToast=(message,action)=>reminderTest.snapshot=action.snapshot;
          reconcileNativeRemindersNow=async()=>{};reconcileNativeReminders=async()=>{};refreshOpenViews=()=>{};
          save(normalize([{hid:'target',name:'Report',type:kind==='task'?'task':'keepup',durationMinutes:30,
            dueDate:new Date('2026-11-16T00:00:00-05:00').getTime(),logs:[{ts:1}],
            ...(kind==='event'?{appointment:{repeat:'weekly',startDate:'2026-11-02',weekdays:[1],startMinute:600,exceptions:{}}}:{})}]));
          localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify({version:4,enabled:true,items:{'item:target':{start:'notification',startLeadMinutes:60,startSecond:'notification',secondStartLeadMinutes:1440,due:'notification',dueDaysBefore:0,dueMinute:540},'item:other':{end:'alarm'}}}));
          const s=assistantFocusOpen({operation:'edit',kind,targetId:'target',now:new Date('2026-11-12T08:00:00-05:00').getTime(),occurrenceDate:'2026-11-16'});
          if(kind==='event')assistantFocusSetScope(s,scope,'2026-11-16');return s;
        },
        options:live?{}:{rank:async()=>({rankings:[]}),extract:async spec=>{
          let args={};
          if(spec.family==='families')args={evidence:'',outside:''};
          else if(spec.family==='completeness')args={missing:''};
          else{const [key,property]=Object.entries(spec.tool.parameters.properties)[0];args={[key]:property.enum?.[0]||''};}
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
        }}
      };
    },live);
    const requests=[
      {kind:'task',prompt:'Notify me 1 day before the due date at 9am',expected:{reminderDue:'notification',reminderDueDays:1,reminderDueTime:540}},
      {kind:'task',prompt:'Set duration to 20 minutes, and notify me 1 day before the due date at 9am',expected:{durationMinutes:20,reminderDue:'notification',reminderDueDays:1,reminderDueTime:540}},
      {kind:'event',prompt:'Set the first reminder to notification 1 hour before, and set the second reminder to alarm 1 day before',expected:{reminderStart:'notification',reminderStartLead:60,reminderSecond:'alarm',reminderSecondLead:1440}},
      {kind:'event',scope:'occurrence',prompt:'Set the second reminder to notification 2 days before',expected:{reminderSecond:'notification',reminderSecondLead:2880}}
    ];
    const reports=[];
    for(const test of requests){
      const result=await page.evaluate(async test=>{
        const t=reminderTest,s=t.seed(test.kind,test.scope),before=localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY),record=JSON.stringify(load());
        await assistantFocusTurn(s,test.prompt,t.options);assistantFocusApprove(s);
        const changes=Object.fromEntries(s.changes.map(c=>[c.field,c.value])),review=assistantFocusReviewModel(s);
        openDetail(0);assistantFocusPreviewReminders(s,'target');
        const read=selector=>document.querySelector(`#detail-native-reminders ${selector}`)?.value;
        const preview=test.kind==='task'?{day:read('[aria-label$="due date reminder day"]'),time:read('[aria-label$="due date reminder time"]')}
          :{mode:read('[data-reminder-edge="startSecond"]'),lead:read('[aria-label="second event reminder timing"]')};
        const untouched=before===localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)&&record===JSON.stringify(load());
        let commit=null,undo=null,saved=null;
        if(assistantFocusCanSave(s)){commit=await assistantFocusCommit(s);saved=nativeReminderPreferences();
          const prefs=nativeReminderPreferences();prefs.items['item:later']={start:'notification'};localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify(prefs));
          assistantFocusUndo(t.snapshot);
          undo=nativeReminderPreferences();
        }
        return {changes,review,preview,untouched,commit,saved,undo,unresolved:s.unresolved,jobs:s.jobs,trace:s.trace};
      },test);
      reports.push({test,result});fs.writeFileSync(`test-results/needle-reminder-options-${live?'live':'host'}.json`,JSON.stringify(reports,null,2));
      assert.equal(result.untouched,true,'reminder edit stays staged until Save');
      assert.deepEqual(result.changes,test.expected,JSON.stringify({prompt:test.prompt,changes:result.changes,questions:result.unresolved}));
      assert.equal(result.commit?.ok,true,'Save writes the validated reminder choices');
      assert.deepEqual(result.preview,test.kind==='task'?{day:'1',time:'09:00'}:{mode:test.expected.reminderSecond,lead:String(test.expected.reminderSecondLead)},'Edit preview fills the real reminder controls');
      const choice=result.saved.items['item:target'];
      if(test.scope==='occurrence'){
        assert.equal(choice.secondStartLeadMinutes,1440,'date edit preserves the series');
        assert.equal(choice.dates['2026-11-16'].secondStartLeadMinutes,2880,'date edit updates only that occurrence');
      }else if(test.kind==='task')assert.equal(choice.dueDaysBefore,1,'due offset saves');
      else {assert.equal(choice.startLeadMinutes,60);assert.equal(choice.secondStartLeadMinutes,1440);assert.equal(choice.startSecond,'alarm');}
      assert.deepEqual(result.saved.items['item:other'],{end:'alarm'},'other items keep their reminders');
      assert.equal(result.undo.items['item:target'].dueDaysBefore,0,'undo restores the original deadline offset');
      assert.equal(result.undo.items['item:target'].secondStartLeadMinutes,1440,'undo restores the original second alert');
      assert.deepEqual(result.undo.items['item:later'],{start:'notification'},'undo preserves later reminder changes');
      console.log(`PASS ${live?'Needle':'host'}: ${test.prompt}`);
    }
    const guards=await page.evaluate(async()=>{
      const t=reminderTest,results=[];
      for(const [kind,field,text] of [['task','reminderDueDays','3 days before due'],['event','reminderSecondLead','3 hours before'],['task','reminderDueTime','at 25:00'],['task','reminderDueTime','Do not notify me at 9am'],['task','reminderDueDays','not 1 day before due']]){
        const s=t.seed(kind),before=localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY);
        const def=assistantFieldCatalog(s).find(def=>def.id===field);
        const parsed=assistantFieldNormalize(def,text,s);results.push({ok:!parsed.ok,untouched:before===localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)});
      }
      const s=t.seed('task');assistantFocusCorrect(s,'reminderDue','alarm');assistantFocusApprove(s);
      window.TingsNative.notifications.exactAlarmPermission=async()=>({exact_alarm:'denied'});
      const before=localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY),denied=await assistantFocusCommit(s);
      results.push({ok:!denied.ok,untouched:before===localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)});
      t.seed('task');const data=load();data[0].dueDate=null;data[0].eventTime=null;save(data);
      const missingBefore=JSON.stringify(load());
      const missing=assistantFocusOpen({operation:'edit',kind:'task',targetId:'target'});
      assistantFocusCorrect(missing,'reminderDue','notification');assistantFocusApprove(missing);
      results.push({ok:!(await assistantFocusCommit(missing)).ok,untouched:JSON.stringify(load())===missingBefore});
      for(const kind of ['task','event']){
        const off=t.seed(kind);
        await assistantFocusTurn(off,'Remove all reminders for this',t.options);assistantFocusApprove(off);
        const saved=await assistantFocusCommit(off),choice=nativeReminderPreferences().items['item:target'];
        results.push({ok:saved.ok&&choice[kind==='task'?'due':'startSecond']==='off',untouched:true});
        const reset=t.seed(kind);assistantFocusCorrect(reset,'reminderReset','reset');assistantFocusApprove(reset);
        const cleared=await assistantFocusCommit(reset),after=nativeReminderPreferences().items['item:target'];
        results.push({ok:cleared.ok&&!Object.hasOwn(after,'due')&&!Object.hasOwn(after,'startSecond')&&!Object.hasOwn(after,'dueMinute')&&!Object.hasOwn(after,'secondStartLeadMinutes'),untouched:true});
      }
      return results;
    });
    assert(guards.every(row=>row.ok&&row.untouched),`value guards, missing dates, permissions, all-off and reset: ${JSON.stringify(guards)}`);
    assert.deepEqual(errors,[]);console.log('PASS: reminder staging, date scope, permission and value guards');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
