// Real Needle inference for focused log, undo, and one-day plan.
// Model output is never replaced. Explicit cues still have to come back as the
// user's sentence, a piece of it, or empty; invented text does not write.
const fs=require('fs');
const crypto=require('crypto');
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const NOW='2026-11-08T15:00:00-05:00';
const cases=[
  {id:'other-item-log',prompt:'Log Water yesterday',kind:'guard'},
  {id:'other-item-edit',prompt:'Make Water 20 minutes',kind:'guard'},
  {id:'future-log',prompt:'Log it tomorrow',kind:'guard'},
  {id:'past-plan',prompt:'Plan it for yesterday',kind:'guard'},
  {id:'future-clock-log',prompt:'Log it today at 4pm',kind:'guard'},
  {id:'earlier-today',prompt:'Log it today at 9am',kind:'guard'},
  {id:'forgot-yesterday',prompt:'I forgot to log this yesterday',kind:'log',day:'2026-11-07'},
  {id:'mark-done',prompt:'mark it done',kind:'log',day:'today'},
  {id:'already-finished',prompt:'I already finished this',kind:'log',day:'today'},
  {id:'last-friday',prompt:'check it off for last Friday',kind:'log',day:'2026-11-06'},
  {id:'minutes-note',prompt:'log 20 minutes yesterday with a note that the park was closed',kind:'log',day:'2026-11-07',minutes:20,note:'the park was closed'},
  {id:'undo-yesterday',prompt:'undo yesterday\'s log',kind:'undo',remain:'2026-11-08',logs:['yesterday','today']},
  {id:'plan-tomorrow',prompt:'put this on tomorrow\'s plan',kind:'plan',day:'2026-11-09'},
  {id:'plan-for-tomorrow',prompt:'Can you plan this for tomorrow',kind:'plan',day:'2026-11-09'},
  {id:'plan-for-day-after',prompt:'plan this for the day after tomorrow',kind:'plan',day:'2026-11-10'},
  {id:'plan-for-five-days',prompt:'plan it for five days in the future',kind:'plan',day:'2026-11-13'},
  {id:'plan-for-date',prompt:'plan this on November 20, 2026',kind:'plan',day:'2026-11-20'},
  {id:'plan-in-five-days',prompt:'plan this in five days',kind:'plan',day:'2026-11-13'},
  {id:'plan-by-day-after',prompt:'Can you plan this by the day after tomorrow',kind:'field',field:'planByDate',day:'2026-11-10'},
  {id:'plan-by-friday',prompt:'Do this by Friday',kind:'field',field:'planByDate',day:'2026-11-13'},
  {id:'due-friday',prompt:'It is due Friday',openKind:'task',seedType:'task',kind:'field',field:'dueDate',day:'2026-11-13'},
  {id:'schedule-friday',prompt:'schedule it for Friday at 3pm',kind:'plan',day:'2026-11-13',timeMin:900},
  {id:'unplan-tomorrow',prompt:'take it off tomorrow\'s plan',kind:'unplan',day:'2026-11-09',logs:['tomorrow-plan']},
  {id:'due-date',prompt:'Let\'s plan for tomorrow',openKind:'task',seedType:'task',kind:'field',field:'dueDate',day:'2026-11-09'},
  {id:'duration',prompt:'Make it 45 minutes',kind:'field',field:'durationMinutes',value:45}
];

(async()=>{
  if(!process.env.NEEDLE_MODEL_PATH||!process.env.NEEDLE_WASM_PATH){
    console.log('skip: real Needle item actions (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');return;
  }
  let browser;
  try{browser=await chromium.launch({headless:true,channel:'chrome'});}
  catch(_){browser=await chromium.launch({headless:true});}
  const results=[],errors=[];
  const report=process.env.ITEM_ACTION_REPORT||'test-results/needle-item-actions-live.json';
  const assets=Object.fromEntries(['NEEDLE_MODEL_PATH','NEEDLE_WASM_PATH'].map(key=>[key,{path:process.env[key],sha256:crypto.createHash('sha256').update(fs.readFileSync(process.env[key])).digest('hex')}]));
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York',viewport:{width:390,height:844}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://huggingface.co/**',route=>route.fulfill({
      body:fs.readFileSync(route.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)
    }));
    await page.addInitScript(now=>{
      const OriginalDate=Date,stamp=new OriginalDate(now).getTime();
      window.Date=class extends OriginalDate{
        constructor(...args){super(...(args.length?args:[stamp]));}
        static now(){return stamp;}
      };
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    },NOW);
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async()=>{
      patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});
      if(!await assistantNeedleDownload())throw new Error('Needle download failed');
    });
    for(const test of cases.filter(row=>!process.env.ITEM_ACTION_CASE||new RegExp(process.env.ITEM_ACTION_CASE).test(row.id))){
      const started=Date.now();
      const result=await page.evaluate(async test=>{
        const now=new Date('2026-11-08T15:00:00-05:00').getTime();
        const stamps={
          yesterday:new Date('2026-11-07T12:00:00-05:00').getTime(),
          today:now,
          'tomorrow-plan':new Date('2026-11-09T12:00:00-05:00').getTime()
        };
        saveSortSettings({...loadSortSettings(),locations:[{id:'park',name:'Park',lat:40,lng:-74}]});
        save([{
          hid:'walk',name:'Walk',type:test.seedType||'keepup',target:7,durationMinutes:30,priority:2,logs:[],topics:[],pinned:false,
          links:[{kind:'phone',value:'5551234567'}]
        },{hid:'water',name:'Water',type:'keepup',target:7,durationMinutes:10,logs:[]}]);
        if(test.logs){const data=load();data[0].logs=test.logs.map(name=>name==='tomorrow-plan'?{ts:stamps[name],plan:true}:stamps[name]);save(data);}
        const before=JSON.stringify(load());
        const session=assistantFocusOpen({operation:'edit',kind:test.openKind||'habit',targetId:'walk',now});
        await assistantFocusTurn(session,test.prompt);
        const action=(session.itemActions||[])[0]||null;
        const unsaved=before===JSON.stringify(load());
        let commit=null,logs=null,toast=null,onlyUndo=null;
        if(action&&action.ready){
          commit=assistantFocusCommitAction(session,0);
          logs=normalizeLogs(load()[0].logs).map(log=>{
            const ts=logTime(log),d=new Date(ts);
            return {key:dateKey(ts),plan:isPlanLog(log),minutes:log.minutes||null,note:log.note||'',timed:Boolean(log.timed),hour:d.getHours(),locationId:log.locationId||''};
          });
          const buttons={};
          for(const id of ['action-undo','action-link','action-open','action-plan','snooze-until-planned']){
            const el=document.getElementById(id);
            buttons[id]={text:el?el.textContent.trim():'',hidden:!el||el.hidden};
          }
          toast={text:document.getElementById('action-text')?.textContent||'',showing:document.getElementById('action-toast')?.classList.contains('show'),buttons};
          onlyUndo=toast.showing&&buttons['action-undo'].hidden===false&&buttons['action-undo'].text==='undo'
            &&['action-link','action-open','action-plan','snooze-until-planned'].every(id=>buttons[id].hidden);
        }
        const todayKey=dateKey(Date.now());
        return {
          unsaved,todayKey,siblingUntouched:load()[1].logs.length===0&&load()[1].durationMinutes===10,
          changes:session.changes.map(change=>({field:change.field,value:change.field==='durationMinutes'?change.value:(change.value!=null&&['dueDate','planByDate'].includes(change.field)?dateKey(change.value):undefined)})),
          questions:session.unresolved.map(row=>({field:row.field,question:row.question})),
          action:action&&{kind:action.kind,ready:Boolean(action.ready),label:action.label||'',summary:action.summary||'',
            complete:action.pendingComplete?{action:action.pendingComplete.action,minutes:action.pendingComplete.minutes||null,note:action.pendingComplete.note||'',day:action.pendingComplete.at?dateKey(action.pendingComplete.at):'today'}:null,
            plan:action.pendingPlan?{action:action.pendingPlan.action,key:action.pendingPlan.key,timeMin:action.pendingPlan.timeMin}:null},
          commit:commit&&{ok:commit.ok,error:commit.error||'',action:commit.action||''},
          logs,toast,onlyUndo,
          evidence:(session.trace||[]).filter(row=>row.family==='item-action'||row.jobId==='log'||row.jobId==='plan'||row.jobId==='undo'||row.jobId==='unplan').map(row=>({family:row.family,jobId:row.jobId,args:row.args,issue:row.issue||''}))
        };
      },test);
      const wantDay=test.day==='today'?result.todayKey:test.day;
      let ok=result.unsaved&&result.siblingUntouched;
      if(test.kind==='guard'){
        ok=ok&&!result.action&&!result.changes.length&&result.questions.length>0;
      }else if(test.kind==='field'){
        ok=ok&&!result.action&&result.changes.length===1&&result.changes[0].field===test.field
          &&(test.value!=null?result.changes[0].value===test.value:result.changes[0].value===wantDay);
      }else{
        ok=ok&&result.action&&result.action.ready&&result.commit&&result.commit.ok&&result.onlyUndo;
        if(test.kind==='log'){
          ok=ok&&result.action.kind==='log'&&result.logs.length===1&&!result.logs[0].plan&&result.logs[0].key===wantDay
            &&(test.hour==null||result.logs[0].hour===test.hour)
            &&(test.minutes==null||result.logs[0].minutes===test.minutes)
            &&(test.note==null||result.logs[0].note===test.note);
        }else if(test.kind==='undo'){
          ok=ok&&result.action.kind==='undo'&&result.logs.length===1&&result.logs[0].key===test.remain&&!result.logs[0].plan;
        }else if(test.kind==='plan'){
          ok=ok&&result.action.kind==='plan'&&result.logs.length===1&&result.logs[0].plan&&result.logs[0].key===wantDay
            &&(test.timeMin==null||(result.logs[0].timed&&result.logs[0].hour===Math.floor(test.timeMin/60)));
        }else if(test.kind==='unplan'){
          ok=ok&&result.action.kind==='unplan'&&!result.logs.some(log=>log.plan&&log.key===wantDay);
        }
      }
      results.push({id:test.id,ok,ms:Date.now()-started,...result});
      fs.mkdirSync(require('path').dirname(report),{recursive:true});
      fs.writeFileSync(report,JSON.stringify({live:true,now:NOW,assets,errors,results},null,2));
      console.log(`${ok?'PASS':'FAIL'} ${test.id} (${Date.now()-started}ms)`);
      if(!ok)console.error(JSON.stringify({changes:result.changes,questions:result.questions,action:result.action,commit:result.commit,logs:result.logs,toast:result.toast,evidence:result.evidence}));
    }
    if(errors.length||results.some(row=>!row.ok))throw new Error(`${results.filter(row=>!row.ok).length} live item-action failures; page errors: ${errors.join('; ')}`);
    console.log(`Real Needle: ${results.length} item actions verified. Report: ${report}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
