// Real Needle inference throughout. Historical field-edit failures are replayed
// before an explicit guide correction; model outputs are never substituted.
const fs=require('fs');
const crypto=require('crypto');
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const cases=[
  {id:'historical-name',prompt:'Call it Evening Walk',label:'Name',detail:'Evening Walk',expected:{name:'Evening Walk'}},
  {id:'literal-title',prompt:'Rename it Every day',label:'Name',detail:'Every day',expected:{name:'Every day'}},
  {id:'literal-kind',prompt:'Make it a task',label:'Habit or task',detail:'task',expected:{kind:'task'}},
  {id:'historical-topic',prompt:'Put this under Health',label:'Topics',detail:'Health',expected:{topics:['Health']}},
  {id:'historical-frequency',prompt:'I want to do this every third day',label:'Frequency',detail:'Once every 3 days',expected:{timesPerPeriod:1,periodDays:3}},
  {id:'historical-monthdays',prompt:'Only on the first and fifteenth of each month',label:'Allowed month days',detail:'The 1st and 15th',expected:{allowedMonthDays:[1,15]}},
  {id:'historical-preferred-days',prompt:'Prefer Monday and Wednesday',label:'Preferred weekdays',detail:'Monday and Wednesday',expected:{preferredWeekdays:[1,3]}},
  {id:'historical-early',prompt:'Allow 3 days early',label:'Early allowance',detail:'3 days early',expected:{earlyWindowDays:3}},
  {id:'historical-delay',kind:'task',prompt:'Allow a delay of two weeks',label:'Late allowance',detail:'14 days',expected:{delayAllowanceDays:14}},
  {id:'historical-chunk',seed:{breakable:true},prompt:'Set minimum chunk to 15 minutes',label:'Shortest session',detail:'15 minutes',expected:{minChunkMinutes:15}},
  {id:'historical-due-correction',kind:'task',prompt:'Tomorrow instead, please',label:'Due date',detail:'Tomorrow',expected:{dueDate:new Date('2026-11-02T00:00:00-05:00').getTime()}},
  {id:'historical-clock-correction',kind:'task',prompt:'Start at 6pm instead',label:'Start time',detail:'6 pm',expected:{dueTime:1080}},
  {id:'ambiguous-length',prompt:'Make it a bit shorter',label:'Duration',detail:'20 minutes',bareRetry:true,expected:{durationMinutes:20}},
  {id:'ambiguous-weekdays',prompt:'Tuesday plus Thursday',label:'Preferred weekdays',detail:'Tuesday plus Thursday',expected:{preferredWeekdays:[2,4]}},
  {id:'conflicting-length',prompt:'Make it 20 minutes or 40 minutes',label:'Duration',detail:'20 minutes',expected:{durationMinutes:20}},
  {id:'missing-place',prompt:'Use the park',label:'Places',detail:'Home',expected:{places:['home']}},
  {id:'live-solar-recurrence',prompt:'Every other day before sunset',label:'Frequency',detail:'Once every 2 days',
    followup:{label:'Allowed hours',detail:'Before sunset'},expected:{timesPerPeriod:1,periodDays:2},extraFields:['allowedWindow'],record:{allowedTimeEndAnchor:'maghrib'}}
];

(async()=>{
  if(!process.env.NEEDLE_MODEL_PATH||!process.env.NEEDLE_WASM_PATH){
    console.log('skip: real Needle guide recovery (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');return;
  }
  let browser;
  try{browser=await chromium.launch({headless:true,channel:'chrome'});}
  catch(_){browser=await chromium.launch({headless:true});}
  const results=[],ui=[],errors=[];
  const report=process.env.GUIDE_REPORT||'test-results/needle-guide-recovery-live.json';
  const assets=Object.fromEntries(['NEEDLE_MODEL_PATH','NEEDLE_WASM_PATH'].map(key=>[key,{path:process.env[key],sha256:crypto.createHash('sha256').update(fs.readFileSync(process.env[key])).digest('hex')} ]));
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York',viewport:{width:390,height:844}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://huggingface.co/**',route=>route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async()=>{
      patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});
      if(!await assistantNeedleDownload())throw new Error('Needle download failed');
    });
    for(const test of cases.filter(row=>!process.env.GUIDE_CASE||new RegExp(process.env.GUIDE_CASE).test(row.id))){
      const started=Date.now();
      const result=await page.evaluate(async test=>{
        saveSortSettings({...loadSortSettings(),locations:[{id:'home',name:'Home',lat:40,lng:-74}]});
        save([
          {hid:'target',name:'Walk',type:test.kind==='task'?'task':'keepup',target:7,durationMinutes:30,priority:2,logs:[{ts:1}],topics:[],pinned:false,
            ...(test.kind==='task'?{dueDate:new Date('2026-11-20T00:00:00-05:00').getTime()}:{}),...test.seed},
          {hid:'other',name:'Other item',type:'keepup',target:7,durationMinutes:15,logs:[]}
        ]);
        const before=JSON.stringify(load());
        const session=assistantFocusOpen({operation:'edit',kind:test.kind||'habit',targetId:'target',now:new Date('2026-11-01T12:00:00-05:00').getTime()});
        await assistantFocusTurn(session,'Pin it');
        const prior=assistantFocusClone(session.changes);
        if(!prior.some(change=>change.field==='pinned'&&change.value===true))throw new Error('Real model did not stage the prior pin edit');
        const matches=()=>Object.entries(test.expected).every(([field,value])=>session.changes.some(change=>change.field===field&&JSON.stringify(change.value)===JSON.stringify(value)))
          &&session.changes.every(change=>change.field==='pinned'||Object.hasOwn(test.expected,change.field)||(test.extraFields||[]).includes(change.field))
          &&Object.entries(test.record||{}).every(([key,value])=>JSON.stringify(assistantFocusMaterialize(session)[key])===JSON.stringify(value));
        const snapshot=()=>({changes:assistantFocusClone(session.changes),questions:assistantFocusClone(session.unresolved),ready:assistantFocusCanSave(session),matched:matches()});
        await assistantFocusTurn(session,test.prompt);
        const baseline=snapshot();
        const request=assistantGuideRevise(session);
        const rewound=request===test.prompt&&JSON.stringify(prior)===JSON.stringify(session.changes);
        const unsaved=before===JSON.stringify(load());
        const guided=assistantGuideCompose(test.detail,test.label,session);
        await assistantFocusTurn(session,guided);
        if(test.followup)await assistantFocusTurn(session,assistantGuideCompose(test.followup.detail,test.followup.label,session));
        if(test.bareRetry){
          await assistantFocusTurn(session,test.label);
          await assistantFocusTurn(session,test.label);
        }
        const recovery=snapshot();
        const stillUnsaved=before===JSON.stringify(load());
        // Approving the reviewed values is distinct from saving them.
        assistantFocusApprove(session);
        const ready=assistantFocusCanSave(session);
        let commit=null,preserved=false,reviseAfterSave=null;
        if(matches()&&ready){
          // A real later log and another item's edit must survive this save.
          const data=load();data[0].logs.push({ts:2});data[1].name='Other item changed';save(data);
          const latest=load();
          commit=await assistantFocusCommit(session);
          const saved=load();
          preserved=JSON.stringify(saved[0].logs)===JSON.stringify(latest[0].logs)
            &&saved[1].name==='Other item changed'&&saved[0].pinned;
          reviseAfterSave=assistantGuideCanRevise(session);
        }
        return {baseline,recovery,guided,rewound,unsaved,stillUnsaved,ready,commit,preserved,reviseAfterSave,trace:session.trace};
      },test);
      const ok=result.rewound&&result.unsaved&&result.stillUnsaved&&result.recovery.matched&&result.ready&&result.commit?.ok&&result.preserved&&result.reviseAfterSave===false;
      results.push({...test,...result,ok,ms:Date.now()-started});
      fs.writeFileSync(report,JSON.stringify({live:true,assets,errors,results,ui},null,2));
      console.log(`${ok?'PASS':'FAIL'} ${test.id}: baseline=${result.baseline.matched&&result.baseline.ready?'correct':'needs recovery'}, guided=${result.recovery.matched&&result.ready?'correct':'unresolved'} (${Date.now()-started}ms)`);
      if(!ok)console.error(JSON.stringify({recovery:result.recovery,rewound:result.rewound,commit:result.commit,preserved:result.preserved}));
    }
    for(const test of cases.filter(row=>['ambiguous-length','ambiguous-weekdays','conflicting-length'].includes(row.id))){
      await page.evaluate(()=>{
        save([{hid:'target',name:'Walk',type:'keepup',target:7,durationMinutes:30,priority:2,logs:[],topics:[],pinned:false}]);
        assistantOpenForItem('target','home');
      });
      const before=await page.evaluate(()=>JSON.stringify(load()));
      const send=async text=>{
        await page.locator('#assistant-input').fill(text);
        await page.locator('#assistant-send').click();
        await page.waitForFunction(()=>!_assistantBusy&&!_assistantSession.focus._focusInFlight,null,{timeout:120000});
      };
      await send('Pin it');
      await send(test.prompt);
      const baseline=await page.evaluate(()=>({changes:assistantFocusClone(_assistantSession.focus.changes),questions:assistantFocusClone(_assistantSession.focus.unresolved)}));
      await page.locator('#assistant-guide-revise').click();
      const rewound=await page.evaluate(()=>_assistantSession.focus.changes.length===1&&_assistantSession.focus.changes[0].field==='pinned');
      if(!rewound)throw new Error('UI revise did not preserve only the prior pin edit');
      await page.locator('#assistant-guide-more').click();
      await page.locator('#assistant-input').fill(test.label);
      const traceBefore=await page.evaluate(()=>_assistantSession.focus.trace.length);
      await page.locator(`#assistant-guide-results [data-guide-label="${test.label}"]`).click();
      const guided=await page.evaluate(()=>assistantComposerDraft());
      if(!guided.startsWith(`${test.label}:`)||traceBefore!==await page.evaluate(()=>_assistantSession.focus.trace.length))throw new Error('Guide tap sent a request or lost its label');
      if(!(await page.locator('#assistant-guide-hint').textContent()).includes('Example:'))throw new Error('Selected field has no example');
      await send(`${test.label}: ${test.detail}`);
      const recovery=await page.evaluate(expected=>{
        const session=_assistantSession.focus;
        return {changes:assistantFocusClone(session.changes),questions:assistantFocusClone(session.unresolved),
          matched:Object.entries(expected).every(([field,value])=>session.changes.some(change=>change.field===field&&JSON.stringify(change.value)===JSON.stringify(value)))
            &&session.changes.every(change=>change.field==='pinned'||Object.hasOwn(expected,change.field)),
          ready:assistantFocusCanSave(session),trace:session.trace};
      },test.expected);
      if(before!==await page.evaluate(()=>JSON.stringify(load())))throw new Error('UI recovery wrote before Save');
      if(!recovery.matched||recovery.questions.length||!recovery.ready)throw new Error(`UI recovery failed: ${JSON.stringify(recovery)}`);
      await page.locator('[data-focus-save]').click();
      await page.waitForFunction(()=>load()[0].pinned===true);
      const saved=await page.evaluate(()=>load()[0]);
      ui.push({id:test.id,baseline,rewound,guided,recovery,saved,ok:true});
      fs.writeFileSync(report,JSON.stringify({live:true,assets,errors,results,ui},null,2));
      console.log(`PASS real mobile UI: ${test.id} → Fix last request → field guide → Save`);
    }
    await page.screenshot({path:'test-results/needle-guide-recovery-mobile.png'});
    if(errors.length||results.some(row=>!row.ok))throw new Error(`${results.filter(row=>!row.ok).length} recovery failures; page errors: ${errors.join('; ')}`);
    console.log(`Real Needle: ${results.length} guide corrections and ${ui.length} mobile flows verified; ${results.filter(row=>!row.baseline.matched||!row.baseline.ready).length} needed recovery. Report: ${report}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
