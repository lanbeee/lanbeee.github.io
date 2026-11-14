// Complete bounded instructions may finish after their real field reads.
// Unknown words retain the full audit; uncertain values retain their review.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const fs=require('fs');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log(`  ok: ${message}`);}
const cases=[
  ['Make each session 20 minutes',{durationMinutes:20}],
  ['Please make it half an hour',{durationMinutes:30}],
  ['Duration: one and a half hours',{durationMinutes:90}],
  ['Monday to Friday and make it 20 minutes',{allowedWeekdays:[1,2,3,4,5],durationMinutes:20}],
  ['Set priority P1 and pin it',{priority:1,pinned:true}],
  ['Only on Tuesdays and Thursdays',{allowedWeekdays:[2,4]}],
  ['Unpin it',{pinned:false}]
];
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(()=>{
      window.latencyTest={
        open(){save([{hid:'latency',name:'Gym',type:'keepup',target:7,durationMinutes:45,priority:2,logs:[{ts:1}],pinned:true}]);return assistantFocusOpen({operation:'edit',kind:'habit',targetId:'latency'});},
        reply(spec){
          if(spec.family==='families')return {confidence:1,function_calls:[{arguments:{evidence:'',outside:''}}]};
          if(spec.family==='completeness')return {confidence:1,function_calls:[{arguments:{missing:''}}]};
          if(spec.family==='family-routing')return {confidence:1,function_calls:[{arguments:{family:''}}]};
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
        }
      };
    });
    for(const [prompt,expected] of cases){
      const result=await page.evaluate(async({prompt,expected})=>{
        const t=latencyTest,s=t.open(),before=JSON.stringify(load()),seen=[];
        await assistantFocusTurn(s,prompt,{extract:async spec=>{seen.push(spec.jobId||spec.family);return t.reply(spec);},rank:async()=>{seen.push('retrieval');return {rankings:[]};}});
        const record=assistantFocusMaterialize(s),fields=Object.keys(expected);
        return {correct:fields.every(id=>JSON.stringify(record[id])===JSON.stringify(expected[id])),
          onlyReads:seen.length===fields.length&&fields.every(id=>seen.includes(id)),
          audited:s.trace.some(row=>row.method==='closed-instructions'),canSave:assistantFocusCanSave(s),
          unchanged:before===JSON.stringify(load()),logs:record.logs.length,seen};
      },{prompt,expected});
      assert(result.correct&&result.onlyReads&&result.audited&&result.canSave&&result.unchanged&&result.logs===1,
        `bounded edit reads every field once and finishes without extra inference: ${prompt} (${JSON.stringify(result)})`);
    }
    const adversarial=[
      'Make it 20 minutes before sunset',
      'Make it 20 minutes and only when dry',
      'Make it 20 minutes; include a quantitative reading at check-in',
      'Make it 20 minutes unless I am travelling',
      'Make it 20 minutes or 30 minutes',
      'Make it 20 minutes, not 30 minutes',
      'Make it 20 minutes; make it 30 minutes',
      'Make it 20 minutes / pin it',
      'Make it 20 minutes but not on Fridays',
      'Only on Mondays except the first week',
      'Prefer Mondays and Wednesdays',
      'Set priority P1 tomorrow',
      'Pin it and log it for yesterday',
      'Duration: 20 minutes and remind me when it starts',
      'Set priority P1?'
    ];
    for(const prompt of adversarial){
      const result=await page.evaluate(async prompt=>{
        const t=latencyTest,s=t.open(),before=JSON.stringify(load()),seen=[];
        await assistantFocusTurn(s,prompt,{extract:async spec=>{seen.push(spec.family);return t.reply(spec);},rank:async()=>{seen.push('retrieval');return {rankings:[]};}});
        return {full:seen.includes('families')&&seen.includes('retrieval')&&seen.includes('completeness'),
          shortcut:s.trace.some(row=>row.method==='closed-instructions'),unchanged:before===JSON.stringify(load())};
      },prompt);
      assert(result.full&&!result.shortcut&&result.unchanged,`extra, conflicting or ambiguous wording retains the full audit: ${prompt}`);
    }
    for(const mode of ['decline','shortened','uncertain','suppressed','invalid','failure']){
      const result=await page.evaluate(async mode=>{
        const t=latencyTest,s=t.open(),before=JSON.stringify(load()),seen=[];
        await assistantFocusTurn(s,mode==='invalid'?'Make it 99999 minutes':'Make it 20 minutes',{
          extract:async spec=>{
            seen.push(spec.jobId||spec.family);
            if(spec.jobId==='durationMinutes'){
              if(mode==='failure')throw new Error('Worker interrupted');
              const reply=t.reply(spec),call=reply.function_calls[0],key=Object.keys(call.arguments)[0];
              if(mode==='decline')call.arguments[key]='';
              if(mode==='shortened')call.arguments[key]='20';
              if(mode==='uncertain')reply.confidence=0.4;
              if(mode==='suppressed'){reply.suppressed_calls=reply.function_calls;reply.function_calls=[];}
              return reply;
            }
            return t.reply(spec);
          },rank:async()=>{seen.push('retrieval');return {rankings:[]};}
        });
        return {full:seen.includes('families')&&seen.includes('retrieval'),shortcut:s.trace.some(row=>row.method==='closed-instructions'),
          uncertain:assistantFocusReviewModel(s).needsInterpretation,
          blocked:!assistantFocusCanSave(s),unchanged:before===JSON.stringify(load())};
      },mode);
      assert(result.unchanged&&(mode==='uncertain'?result.shortcut&&result.uncertain
        :result.full&&!result.shortcut&&(mode==='suppressed'?result.uncertain:result.blocked)),
        `${mode} field read preserves uncertainty review or restores the full audit`);
    }
    const completion=await page.evaluate(async()=>{
      const t=latencyTest,s=t.open(),before=JSON.stringify(load());let release;
      const gate=new Promise(resolve=>{release=resolve;});
      const pending=assistantFocusTurn(s,'Set priority P1 and pin it',{extract:async spec=>{if(spec.jobId==='pinned')await gate;return t.reply(spec);}});
      await new Promise(resolve=>setTimeout(resolve,0));
      const blocked=!assistantFocusCanSave(s)&&before===JSON.stringify(load());
      release();await pending;
      const ready=assistantFocusCanSave(s),result=await assistantFocusCommit(s),saved=load()[0];
      return blocked&&ready&&result.ok&&saved.priority===1&&saved.pinned&&saved.logs.length===1;
    });
    assert(completion,'a visible first result cannot Save until sibling reads finish; confirmed save preserves unrelated state');
    const retainedContexts=await page.evaluate(async()=>{
      const t=latencyTest,runs=[];
      for(const mode of ['create','event','history','question','unfinished']){
        let s=t.open();
        if(mode==='create')s=assistantFocusOpen({operation:'create',kind:'habit'});
        if(mode==='event'){
          save([{hid:'latency',name:'Meeting',type:'appointment',durationMinutes:45,logs:[],appointment:{repeat:'once',startDate:'2026-11-13',startMinute:540}}]);
          s=assistantFocusOpen({operation:'edit',kind:'event',targetId:'latency'});
        }
        if(mode==='history')s.requests.push('Hello');
        if(mode==='question')s.unresolved.push({field:'priority',family:'identity',question:'Which priority?'});
        const seen=[],options={extract:async spec=>{seen.push(spec.jobId||spec.family);return t.reply(spec);},rank:async()=>{seen.push('retrieval');return {rankings:[]};}};
        if(mode==='unfinished'){
          await assistantFocusTurn(s,'Set priority P1',{...options,extract:async spec=>{if(spec.jobId==='priority')throw new Error('Worker interrupted');return t.reply(spec);}});
          seen.length=0;
        }
        const before=JSON.stringify(load());
        await assistantFocusTurn(s,'Make it 20 minutes',options);
        runs.push({mode,full:seen.includes('families')&&seen.includes('retrieval'),unchanged:before===JSON.stringify(load()),shortcut:s.trace.some(row=>row.method==='closed-instructions')});
      }
      return runs;
    });
    assert(retainedContexts.every(row=>row.full&&row.unchanged&&!row.shortcut),
      `creation, events, history, open questions and unfinished work retain the full pipeline (${JSON.stringify(retainedContexts)})`);
    if(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH){
      await page.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
      await page.evaluate(async()=>{patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});await assistantNeedleDownload();});
      const results=[];
      for(const [prompt,expected] of cases){
        const row=await page.evaluate(async({prompt,expected})=>{
          assistantNeedleStop();const s=latencyTest.open(),before=JSON.stringify(load()),started=performance.now();
          await assistantFocusTurn(s,prompt);
          const record=assistantFocusMaterialize(s),fields=Object.keys(expected);
          const correct=fields.every(id=>JSON.stringify(record[id])===JSON.stringify(expected[id]));
          const noExtras=s.changes.every(change=>fields.includes(change.field));
          const unchanged=before===JSON.stringify(load()),ready=assistantFocusCanSave(s);
          const shortcut=s.trace.some(row=>row.method==='closed-instructions');
          const ms=performance.now()-started;
          assistantFocusApprove(s);
          const result=correct&&noExtras&&ready&&shortcut?await assistantFocusCommit(s):null;
          const saved=load().find(item=>item.hid===s.targetId);
          const baseline=JSON.parse(before).find(item=>item.hid===s.targetId);
          const persisted=Boolean(result?.ok&&saved&&fields.every(id=>JSON.stringify(saved[id])===JSON.stringify(expected[id]))
            &&saved.name===baseline.name&&JSON.stringify(saved.logs)===JSON.stringify(baseline.logs));
          return {prompt,ms,correct,noExtras,unchanged,ready,shortcut,persisted,committed:result?.ok,trace:s.trace,timing:s.timing};
        },{prompt,expected});
        results.push(row);fs.writeFileSync('test-results/needle-latency-live.json',JSON.stringify(results,null,2));
        assert(row.correct&&row.noExtras&&row.unchanged&&row.ready&&row.shortcut&&row.persisted&&row.committed,
          `live bounded edit takes the shortcut and persists every expected value after confirmation: ${prompt} (${Math.round(row.ms)} ms)`);
      }
    }else console.log('  skip: live latency cases (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');
    assert(!errors.length,`no page errors (${errors.join('; ')})`);
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
