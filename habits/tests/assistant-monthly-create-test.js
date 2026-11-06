// Compound creation: monthly calendar rules, session lengths and anchor offsets
// must retain independent ownership. Optional live mode uses pinned WASM assets.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const fs=require('fs');
const cases=[
  {id:'word-number-offset',prompt:'Family night last Friday of every month duration is one hour allowed time from sunset to sunset plus one hundred twenty minutes',endOffset:120},
  {id:'through-bounds',prompt:'Family night last Friday of every month duration is one hour window sunset through two hours after sunset',endOffset:120},
  {id:'reported-plus-dictation',prompt:'Family night happens last Friday of every month duration is one hour and allowed time is from sunset to sunset Plus 2 hours .',endOffset:120},
  {id:'symbol-offset-independent-duration',prompt:'Family night last Friday of every month duration is one hour allowed time from sunset to sunset + 2 hours',endOffset:120},
  {id:'changed-length-independent-offset',prompt:'Family night last Friday of every month duration is two hours allowed time from sunset to sunset plus 90 minutes',duration:120},
  {id:'changed-monthly-rule',prompt:'Family night first Friday of every month duration is one hour allowed time from sunset to sunset plus 90 minutes',ordinal:1},
  {id:'plus-fraction',prompt:'Family night last Friday of every month duration is one hour allowed time from sunset to sunset plus an hour and a quarter',endOffset:75},
  {id:'two-offset-bounds',prompt:'Family night last Friday of every month duration is one hour allowed time from sunset minus 30 minutes to sunset plus 30 minutes',startOffset:-30,endOffset:30},
  {id:'reported-dictation',prompt:'Family night happens last Friday of every month after sunset duration is one hour and they allowed time and one and a half hours after sunset',question:true},
  {id:'reported-window-correction',prompt:'Family night happens last Friday of every month after sunset duration is one hour and they allowed time and one and a half hours after sunset',question:true,correction:'After sunset to two hours after sunset',endOffset:120},
  {id:'monthly-solar-window',prompt:'Family night happens last Friday of every month from sunset to one and a half hours after sunset duration is one hour'},
  {id:'length-before-window',prompt:'Create a habit called Family night, duration is one hour, only on the last Friday of every month, from sunset to one and a half hours after sunset'},
  {id:'offset-before-length',prompt:'Family night on the last Friday of every month one and a half hours after sunset for one hour',offset:90},
  {id:'offset-only',prompt:'Family night on the last Friday of every month one and a half hours after sunset',offset:90,duration:30},
  {id:'offset-with-for',prompt:'Family night on the last Friday of every month for one and a half hours after sunset',offset:90,duration:30},
  {id:'monthly-prayer-offset',prompt:'Family night on the last Friday of every month one and a half hours after isha for one hour',offset:90,anchor:'isha'}
];
(async()=>{
  const live=Boolean(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH);
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  const results=[],errors=[];
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York'});
    page.on('pageerror',e=>errors.push(e.message));
    if(live)await page.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.goto(BASE);await waitForAssistant(page);
    if(live)await page.evaluate(async()=>{patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});await assistantNeedleDownload();});
    for(const test of cases){
      const result=await page.evaluate(async({test,live})=>{
        save([{hid:'existing',name:'Existing',type:'keepup',target:7,durationMinutes:45,logs:[{ts:1}]}]);
        const options=live?{}:{rank:async()=>({rankings:[]}),extract:async spec=>{
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          const args=spec.family==='families'?{evidence:'',outside:''}:spec.family==='completeness'?{missing:''}:{[key]:property.enum?.[0]||''};
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
        }};
        const s=assistantFocusOpen({operation:'create',kind:'habit',draft:{durationMinutes:30},now:new Date('2026-11-01T12:00:00-05:00').getTime()});
        const before=JSON.stringify(load());
        await assistantFocusTurn(s,test.prompt,options);assistantFocusApprove(s);
        const first=assistantFocusMaterialize(s),questions=JSON.parse(JSON.stringify(s.unresolved));
        const originalBlocked=!assistantFocusCanSave(s);
        // The garbled final clause has two competing window starts. Keep the
        // useful fields and ask only about the window, then accept a correction.
        const clarificationOK=!test.question||(originalBlocked&&questions.length===1&&questions[0].field==='allowedWindow'
          &&first.name==='Family night'&&first.durationMinutes===60&&first.allowedOrdinalWeekdays?.[0]?.ordinal===-1);
        if(test.question){await assistantFocusTurn(s,test.correction||'Allowed hours from sunset to one and a half hours after sunset',options);assistantFocusApprove(s);}
        const r=assistantFocusMaterialize(s),rules=r.allowedOrdinalWeekdays;
        const allowed=new Set(['name','allowedOrdinalWeekdays','allowedWindow','durationMinutes']);
        const extras=s.changes.filter(c=>!allowed.has(c.field));
        const expected=r.name==='Family night'&&r.durationMinutes===(test.duration||60)
          &&JSON.stringify(rules)===JSON.stringify([{ordinal:test.ordinal??-1,weekday:5}])
          &&r.allowedTimeStartAnchor===(test.anchor||'maghrib')&&r.allowedTimeStartOffsetMin===(test.startOffset??test.offset??0)
          &&(test.offset?true:r.allowedTimeEndAnchor==='maghrib'&&r.allowedTimeEndOffsetMin===(test.endOffset||90))
          &&!r.allowedWeekdays.length&&!r.allowedMonthDays.length;
        const unchanged=before===JSON.stringify(load()),ready=assistantFocusCanSave(s);
        let committed=null;
        if(expected&&clarificationOK&&ready&&!extras.length)committed=await assistantFocusCommit(s);
        const saved=load().find(row=>row.hid===s.targetId);
        const persistence=Boolean(committed?.ok)&&JSON.stringify(load()[0])===JSON.stringify(JSON.parse(before)[0])
          &&saved?.name===r.name&&saved.durationMinutes===r.durationMinutes
          &&JSON.stringify(saved.allowedOrdinalWeekdays)===JSON.stringify(rules)
          &&saved.allowedTimeStartOffsetMin===r.allowedTimeStartOffsetMin&&saved.allowedTimeEndOffsetMin===r.allowedTimeEndOffsetMin;
        return {ok:expected&&clarificationOK&&unchanged&&ready&&!extras.length&&persistence,record:r,questions,unresolved:s.unresolved,extras,unchanged,ready,committed,trace:s.trace,jobs:s.jobs};
      },{test,live});
      results.push({test,...result});
      console.log(`  ${result.ok?'ok':'FAIL'}: ${live?'live Needle':'host'} ${test.id}`);
      if(!result.ok)console.error(JSON.stringify({record:result.record,questions:result.questions,unresolved:result.unresolved,extras:result.extras,committed:result.committed}));
    }
    fs.writeFileSync(`test-results/needle-monthly-create-${live?'live':'scripted'}.json`,JSON.stringify(results,null,2));
    if(errors.length||results.some(r=>!r.ok))throw Error(`Monthly creation failed: ${results.filter(r=>!r.ok).map(r=>r.test.id).join(', ')}; page errors: ${errors.join('; ')}`);
    console.log(`\n${results.length} passed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
