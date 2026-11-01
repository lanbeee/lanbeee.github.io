// Workflow contracts: lossless model boundaries, continuation, staged writes,
// and current platform capabilities. Real model checks live in needle-test.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log('  ok: '+message);}
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({serviceWorkers:'block'});
    await page.addInitScript(()=>{localStorage.setItem('tings_coach_install_v2','done');localStorage.setItem('tings_coach_essentials_v2','done');});
    await page.goto(BASE);await waitForAssistant(page);
    const slices=await page.evaluate(()=>{
      const text='Add Walk for 20 minutes, and Read for 30 minutes. Show tomorrow. Keep all constraints!';
      const parts=assistantNeedleSlices(text,['Add Walk for 20 minutes','Show tomorrow.','invented text']);
      return {text,parts,joined:parts.join(''),unchanged:assistantNeedleSlices(text,['fabricated']).join('')};
    });
    assert(slices.parts.length===2 && slices.joined===slices.text,'model boundaries preserve omitted clauses and trailing constraints exactly');
    assert(slices.unchanged===slices.text,'hallucinated boundaries cannot replace user text');
    const outcomes=await page.evaluate(async()=>{
      const originalReady=assistantNeedleEnsureReady,originalRequest=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      const requests=Array.from({length:8},(_,i)=>'Add task '+(i+1)+'.');
      assistantNeedleRequest=async()=>({steps:requests});
      const complete=async req=>{
        const request=JSON.parse(req.messages.find(m=>m.role==='user').content).request;
        const done=req.messages.some(m=>m.role==='tool');
        return {message:{role:'assistant',content:'',tool_calls:done ? [] : [{function:{name:'draft_item',arguments:{name:request.slice(4,-1),kind:'task',create:true}}}]}};
      };
      try{
        const before=JSON.stringify(load());
        const steps=[];
        const out=await assistantRunNeedleWorkflow(requests.join(' '),{complete,onProgress:x=>steps.push(x.step)});
        return {type:out.type,names:out.drafts?.map(d=>d.name),unchanged:JSON.stringify(load())===before,steps};
      }finally{assistantNeedleEnsureReady=originalReady;assistantNeedleRequest=originalRequest;}
    });
    assert(outcomes.type==='preview' && outcomes.names?.length===8,'eight requests retain every draft beyond the old four-call budget');
    assert(outcomes.unchanged,'multi-step work does not save before confirmation');
    assert(outcomes.steps.some(s=>s.includes('part 8 of 8')),'progress reports the current part');
    const resume=await page.evaluate(async()=>{
      const originalReady=assistantNeedleEnsureReady,originalRequest=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      assistantNeedleRequest=async()=>({steps:['Add Alpha.','Which one?','Add Omega.']});
      let clarify=true;
      const seen=[];
      const complete=async req=>{
        const request=JSON.parse(req.messages.find(m=>m.role==='user').content).request;seen.push(request);
        const done=req.messages.some(m=>m.role==='tool');
        const tool=request==='Which one?' && clarify ? {name:'ask_user',arguments:{question:'Which name should I use?'}} : {name:'draft_item',arguments:{name:request==='Alpha reply'?'Beta':request.slice(4,-1),kind:'task',create:true}};
        return {message:{role:'assistant',content:'',tool_calls:done ? [] : [{function:tool}]}};
      };
      try{
        const session=assistantCreateSession();
        const first=await assistantRunNeedleWorkflow('Add Alpha. Which one? Add Omega.',{complete,session});
        const pending=session.needleWorkflow?.remaining.slice();clarify=false;
        const second=await assistantRunNeedleWorkflow('Alpha reply',{complete,session});
        return {first:first.type,pending,type:second.type,names:second.drafts?.map(d=>d.name),seen};
      }finally{assistantNeedleEnsureReady=originalReady;assistantNeedleRequest=originalRequest;}
    });
    assert(resume.first==='ask' && resume.pending?.[0]==='Add Omega.','clarification retains the unprocessed request queue');
    assert(resume.type==='preview' && resume.names?.join(',')==='Alpha,Beta,Omega','clarification resumes with earlier and later drafts intact');
    const incomplete=await page.evaluate(async()=>{
      const originalReady=assistantNeedleEnsureReady,originalRequest=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      assistantNeedleRequest=async()=>({steps:['Add Alpha.','Answer the question.']});
      const complete=async req=>{
        const request=JSON.parse(req.messages.find(m=>m.role==='user').content).request;
        return {message:{role:'assistant',content:'',tool_calls:request === 'Add Alpha.' && !req.messages.some(m=>m.role==='tool')
          ? [{function:{name:'draft_item',arguments:{name:'Alpha',kind:'task',create:true}}}] : []}};
      };
      try{
        const out=await assistantRunNeedleWorkflow('Add Alpha. Answer the question.',{complete});
        return {type:out.type,partial:out.partial,drafts:out.session.needleWorkflow?.drafts.length,unfinished:out.unfinished};
      }finally{assistantNeedleEnsureReady=originalReady;assistantNeedleRequest=originalRequest;}
    });
    assert(incomplete.type !== 'preview' && incomplete.partial && incomplete.drafts === 1,'an earlier draft cannot make an unanswered later question appear finished');
    assert(incomplete.unfinished?.[0] === 'Answer the question.','unfinished requests remain available for retry');
    const mixed=await page.evaluate(async()=>{
      save([{hid:'workflow-existing',name:'Existing',type:'task',logs:[],durationMinutes:10}]);
      const originalReady=assistantNeedleEnsureReady,originalRequest=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      assistantNeedleRequest=async()=>({steps:['Complete Existing.','Add Alpha.','Plan Existing tomorrow.']});
      const complete=async req=>{
        const request=JSON.parse(req.messages.find(m=>m.role==='user').content).request;
        let tool=request.startsWith('Complete') ? {name:'complete_item',arguments:{name:'Existing'}}
          : request.startsWith('Plan') ? {name:'plan_item',arguments:{name:'Existing',date:'tomorrow'}}
          : {name:'draft_item',arguments:{name:'Alpha',kind:'task',create:true}};
        return {message:{role:'assistant',content:'',tool_calls:req.messages.some(m=>m.role==='tool') ? [] : [{function:tool}]}};
      };
      try{
        const out=await assistantRunNeedleWorkflow('Complete Existing. Add Alpha. Plan Existing tomorrow.',{complete});
        await handleAssistantOutcome(out);
        const before={type:out.type,drafts:out.drafts?.length,actions:out.actions?.map(a=>a.kind),saved:load().length};
        await commitAssistantDraft(false);
        return {...before,after:load().length,pending:_assistantSession.pendingActions.map(a=>a.kind)};
      }finally{assistantNeedleEnsureReady=originalReady;assistantNeedleRequest=originalRequest;}
    });
    assert(mixed.type==='preview' && mixed.drafts===1 && mixed.actions?.join(',')==='complete,plan','mixed workflows retain separate completion and plan confirmations beside drafts');
    assert(mixed.saved===1 && mixed.after===2 && mixed.pending.join(',')==='complete,plan','saving a draft leaves the other confirmations actionable');
    const stale=await page.evaluate(()=>{
      const button=document.querySelector('[data-assistant-act="compound"]');
      const before=JSON.stringify(load());
      const original=_assistantSession.pendingActions[0];
      _assistantSession.pendingActions[0]={...original,pending:{...original.pending}};
      commitAssistantCompoundAction(0,button);
      return JSON.stringify(load()) === before;
    });
    assert(stale,'an older confirmation cannot execute a later action at the same index');
    const schemas=await page.evaluate(()=>assistantNeedleTools(assistantOllamaTools(Object.keys(ASSISTANT_TOOL_DEFS))).every(tool=>(tool.parameters.required || []).every(key=>Object.hasOwn(tool.parameters.properties,key))));
    assert(schemas,'every Needle alias has valid required fields after fixing its arguments');
    const capabilities=await page.evaluate(async()=>{
      const context=assistantBuildContext(),session=assistantCreateSession();
      const calendar=await assistantExecuteTool('answer_settings',{kind:'calendar'},session,context);
      const reminders=assistantAnswerSettings({kind:'reminders'},context);
      const sharing=assistantAnswerSettings({kind:'sharing'},context);
      patchLocalAssistant({localAssistant:true});
      await openAssistantSheet();
      await handleAssistantOutcome({type:'say',text:calendar.text,navigation:session.navigation});
      return {calendar,reminders,sharing,buttons:[...document.querySelectorAll('#assistant-thread button')].map(b=>b.textContent)};
    });
    assert(capabilities.calendar.text.includes('ICS') && capabilities.calendar.navigation?.section==='settings-calendar-body','calendar import returns verified information and its controls');
    assert(capabilities.reminders.text.includes('unavailable in this browser') && !capabilities.reminders.navigation,'browser does not expose native reminder controls');
    assert(capabilities.sharing.text.includes('QR') && capabilities.sharing.navigation,'pairing preserves the real QR and approval flow');
    assert(capabilities.buttons.includes('open calendar import'),'assistant shows a working navigation button');
    await page.getByRole('button',{name:'open calendar import',exact:true}).click();
    assert(await page.locator('#settings-calendar-body').isVisible(),'calendar button opens the actual import section');
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
