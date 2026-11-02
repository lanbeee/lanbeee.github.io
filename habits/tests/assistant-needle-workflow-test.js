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
    const recovery=await page.evaluate(async()=>{
      const ready=assistantNeedleEnsureReady,request=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      assistantNeedleRequest=async()=>({steps:['Add Alpha.','Add Beta.','Add Omega.']});
      const session=assistantCreateSession(),before=JSON.stringify(load());
      let fail=true;
      const complete=async req=>{
        const text=JSON.parse(req.messages.find(m=>m.role==='user').content).request;
        if(text==='Add Beta.' && fail){
          // Exercise the runtime fault boundary used by worker errors/timeouts.
          assistantNeedleResetRuntime(new Error('Synthetic worker failure'));
          throw new Error('Synthetic worker failure');
        }
        return {message:{role:'assistant',content:'',tool_calls:req.messages.some(m=>m.role==='tool') ? []
          : [{function:{name:'draft_item',arguments:{name:text.slice(4,-1),kind:'task',create:true}}}]}};
      };
      try{
        const first=await assistantRunNeedleWorkflow('Add Alpha. Add Beta. Add Omega.',{session,complete});
        const paused={type:first.type,partial:first.partial,unfinished:first.unfinished,
          names:session.needleWorkflow?.drafts.map(d=>d.name),remaining:session.needleWorkflow?.remaining};
        fail=false;
        const second=await assistantRunNeedleWorkflow(first.unfinished?.[0] || 'missing retry',{session,complete});
        const generation=_assistantNeedleGeneration;
        assistantNeedleStop();
        return {paused,type:second.type,names:second.drafts?.map(d=>d.name),
          parts:second.debug.filter(row=>row.t==='part').map(row=>row.request.trim()),
          unchanged:before===JSON.stringify(load()),cancelled:_assistantNeedleGeneration!==generation};
      }finally{assistantNeedleEnsureReady=ready;assistantNeedleRequest=request;}
    });
    assert(recovery.paused.type==='error' && recovery.paused.partial && recovery.paused.names?.join(',')==='Alpha',
      'runtime failure preserves earlier work instead of treating the request as cancelled');
    assert(recovery.paused.unfinished?.map(s=>s.trim()).join(',')==='Add Beta.,Add Omega.',
      'runtime failure retains the exact unfinished part and following queue');
    assert(recovery.type==='preview' && recovery.names?.join(',')==='Alpha,Beta,Omega' && recovery.unchanged,
      'retry completes every part once without saving before confirmation');
    assert(recovery.parts.join(',')==='Add Alpha.,Add Beta.,Add Beta.,Add Omega.',
      'retry diagnostics retain both the original attempt and resumed work');
    assert(recovery.cancelled,'explicit cancellation still invalidates the workflow generation');
    const emptyEdit=await page.evaluate(async()=>{
      const before=JSON.stringify(load());
      const out=await runAssistantTurn('Change Gym to 3 times a week',{needleStep:true,
        complete:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:{name:'draft_item',arguments:{name:'Gym',create:false}}}]},
          _needleNeedsConfirmation:true,_needleConfidence:0.01})});
      return {type:out.type,question:out.question,proposal:!!out.proposal,unchanged:before===JSON.stringify(load())};
    });
    assert(emptyEdit.type==='ask' && !emptyEdit.proposal && /setting and new value/.test(emptyEdit.question) && emptyEdit.unchanged,
      'an empty edit asks for a concrete change before offering interpretation approval');
    const confidence=await page.evaluate(async()=>{
      const ready=assistantNeedleEnsureReady,request=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;assistantNeedleRequest=async()=>({steps:[]});
      const before=JSON.stringify(load()),session=assistantCreateSession();
      const complete=async req=>({message:{role:'assistant',content:'',tool_calls:[
        {function:{name:'draft_item',arguments:req.messages.some(m=>m.role==='tool')
          ? {due:'tomorrow',create:true,kind:'task',name:'Confidence task'}
          : {name:'Confidence task',kind:'task',create:true,due:'tomorrow'}}}
      ]},_contextManaged:true,_contextLimit:8192,_needleConfidence:0.07,_needleNeedsConfirmation:true});
      try{
        const first=await assistantRunNeedleWorkflow('Add Confidence task tomorrow',{session,complete});
        await handleAssistantOutcome(first);
        const held={type:first.type,question:first.question,draft:session.draft,pending:session.turnDrafts?.length || 0,
          button:!!document.querySelector('[data-assistant-proposal]'),unchanged:before===JSON.stringify(load())};
        session.needleApproved=first.proposal;
        const approved=await assistantRunNeedleWorkflow(first.proposal.request,{session,complete});
        const due=approved.draft?.dueDate;
        const follow=await assistantRunNeedleWorkflow('Change that to 5pm',{session,complete:async req=>({message:{role:'assistant',content:'',tool_calls:
          req.messages.some(m=>m.role==='tool') ? [] : [{function:{name:'draft_item',arguments:{create:false,dueTime:'5pm'}}}]
        }})});
        return {held,type:approved.type,name:approved.draft?.name,followType:follow.type,followName:follow.draft?.name,
          time:follow.draft?.dueTime,dueRetained:follow.draft?.dueDate===due,drafts:follow.drafts?.length,unchanged:before===JSON.stringify(load())};
      }finally{assistantNeedleEnsureReady=ready;assistantNeedleRequest=request;}
    });
    assert(confidence.held.type==='ask' && confidence.held.question.includes('7%') && confidence.held.button,
      'low-confidence output asks about the specific interpretation and exposes a proceed control');
    assert(!confidence.held.draft && !confidence.held.pending && confidence.held.unchanged,
      'an uncertain interpretation executes no tool and stages or saves nothing');
    assert(confidence.type==='preview' && confidence.name==='Confidence task' && confidence.unchanged,
      'one approval previews without saving or asking again when the model repeats the same call in a different field order');
    assert(confidence.followType==='preview' && confidence.followName==='Confidence task' && confidence.time==='17:00'
      && confidence.dueRetained && confidence.drafts===1,'a second message edits the same unsaved draft and preserves its due date');
    const invalid=await page.evaluate(async()=>{
      const session=assistantCreateSession();session.needleStaged=[];session.requestText='Add a workout habit 3 times a week';
      const result=await assistantExecuteTool('draft_item',{name:'Workout',kind:'habit',create:true,durationMinutes:3},session,assistantBuildContext());
      const missing=await assistantExecuteTool('draft_item',{name:'Workout',kind:'habit',create:true},session,assistantBuildContext());
      const noItem=assistantResolveDraftBase({create:false,durationMinutes:20},session,assistantBuildContext());
      const clock=assistantValidateNeedleDraftArgs({create:true,kind:'task',name:'Walk',dueTime:'20 minute'},'Add a 20 minute Walk habit every day');
      return {result,missing,noItem,clock,draft:session.draft};
    });
    assert(!invalid.result.ok && invalid.result.ask && !invalid.draft,'a repetition count cannot become a saveable three-minute session');
    assert(!invalid.missing.ok && invalid.missing.ask && !invalid.noItem.ok && invalid.noItem.ask,
      'missing frequency or edit target asks a concrete question before staging');
    assert(invalid.clock?.ask,'a duration placed in a clock field asks before an interpretation can be approved');
    const undo=await page.evaluate(async()=>{
      const context=assistantBuildContext();context.data=[{hid:'undo-last',name:'Recent completion',type:'task',logs:[]}];
      const session=assistantCreateSession();
      const empty=await assistantExecuteTool('complete_item',{action:'undo_today',latest:true},session,context);
      context.data[0].logs=[{ts:Date.now()-1000}];
      const before=JSON.stringify(context.data);
      const preview=await assistantExecuteTool('complete_item',{action:'undo_today',latest:true},session,context);
      return {empty,preview,unchanged:before===JSON.stringify(context.data)};
    });
    assert(undo.empty.noChange && undo.empty.text.includes('no completion'),'nameless undo reports an empty history without guessing an item');
    assert(undo.preview.pendingComplete?.hid==='undo-last' && undo.preview.pendingComplete.action==='undo_today' && undo.unchanged,
      'nameless undo targets the latest actual completion and stays confirmation-only');
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
      patchLocalAssistant({localAssistant:true, localAssistantProvider:'auto'});
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
    await page.setViewportSize({width:320,height:700});
    const mobile=await page.evaluate(async()=>{
      closeSettingsSheet();assistantNeedleState({phase:'downloaded'});await openAssistantSheet();
      await handleAssistantOutcome({type:'ask',question:'Which item should I change?',choices:['An old choice']});
      const previous=document.querySelector('[data-assistant-choice="An old choice"]');
      await handleAssistantOutcome({type:'ask',question:'Which item should I change?',choices:[
        'A very long saved item title that needs to wrap onto multiple lines', 'Evening walk', 'Read', 'Gym', 'Journal', 'Walk'
      ]});
      const buttons=[...document.querySelectorAll('.assistant-bubble-ask:last-child [data-assistant-choice]')];
      return {oldDisabled:previous.disabled,count:buttons.length,noOverflow:buttons.every(button=>button.scrollWidth<=button.clientWidth+1)
        && document.documentElement.scrollWidth<=innerWidth};
    });
    await page.locator('#assistant-sheet').evaluate(async element=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
    });
    await page.screenshot({path:'test-results/needle-clarification-mobile.png'});
    assert(mobile.count===4 && mobile.noOverflow && mobile.oldDisabled,'phone clarification choices wrap, stay bounded, and retire earlier answers');
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
