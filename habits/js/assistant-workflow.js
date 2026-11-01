// Needle works on literal slices of the request. The model proposes boundaries;
// only string identity locates them. No generated paraphrase replaces user text.
function assistantNeedleSlices(text, proposals){
  const starts = new Set([0]);
  let cursor = 0;
  let matched = false;
  for(const proposal of Array.isArray(proposals) ? proposals : []){
    if(typeof proposal !== 'string' || !proposal.trim())continue;
    const start = text.indexOf(proposal.trim(), cursor);
    if(start < 0)continue;
    if(matched)starts.add(start);
    matched=true;
    cursor = start + proposal.trim().length;
  }
  const offsets = [...starts].sort((a,b)=>a-b).slice(0,24);
  // Adjacent slices concatenate to the exact original, including constraints
  // the splitter omitted. Invalid model boundaries simply produce fewer steps.
  return offsets.map((start,i)=>text.slice(start, offsets[i+1] ?? text.length));
}

async function assistantRunNeedleWorkflow(text, opts){
  const session = opts.session || assistantCreateSession();
  const progress = opts.onProgress || (()=>{});
  const context = opts.context || assistantBuildContext();
  if(!text)return {type:'error',text:'Type something first.',session};
  let slices;
  const retained = session.needleWorkflow;
  const generation = _assistantNeedleGeneration;
  const oneItem = Boolean(opts.needleAction) || opts.startIntent === 'create_habit' || opts.startIntent === 'create_task' || opts.startIntent === 'create_setting';
  if(oneItem && !retained){
    // The add screen is one new item. A second sentence must not become another draft.
    slices = [text];
  }else if(retained){
    slices = [text,...retained.remaining];
  }else{
    progress({phase:'think',step:'breaking down request'});
    await assistantNeedleEnsureReady();
    // Splitting is optional extraction metadata. A bounded splitter failure
    // must not replace or discard the literal request before the action pass.
    let split;
    try{split=await assistantNeedleRequest('split',{request:text});}
    catch(error){
      if(generation !== _assistantNeedleGeneration)throw error;
      split={steps:[]};
    }
    slices = assistantNeedleSlices(text,split.steps);
  }
  const drafts = retained?.drafts || (Array.isArray(session.drafts) && !session._focusOnly ? session.drafts.slice() : []);
  const actions = retained?.actions || (session.pendingActions || []).slice();
  const answers = retained?.answers || [];
  const trace = (retained?.trace || []).slice();
  const navigation = retained?.navigation || [];
  session.needleWorkflow = null;
  let last;
  for(let i=0;i<slices.length;i++){
    progress({phase:'think',step:`part ${i+1} of ${slices.length}`});
    trace.push({t:'part',index:i+1,total:slices.length,request:slices[i]});
    // Keep the staged library visible for references and links between steps.
    session.needleStaged = drafts;
    session.drafts=null;
    // Prior drafts remain references; only a new validated tool can stage this part.
    session._focusOnly=true;
    try{
      last = await runAssistantTurn(slices[i].trim(), {...opts,context,session,needleStep:true,
        onProgress:info=>progress({...info,step:`part ${i+1} of ${slices.length}: ${info.step || 'thinking'}`})});
    }catch(error){
      last = {type:'error',text:assistantFriendlyError(error),
        diagnosticError:String(error.stack || error.message || error),session};
    }
    if(generation !== _assistantNeedleGeneration){
      session.needleWorkflow=null;session.needleStaged=null;
      return {type:'error',text:'Cancelled.',session};
    }
    trace.push(...(last.debug || []));
    for(const destination of session.navigation || [])if(!navigation.some(row=>row.section === destination.section))navigation.push(destination);
    const staged=(session.turnDrafts || []).concat(last.type === 'preview' || last.type === 'apply' ? (last.drafts || [last.draft]) : []);
    for(const draft of staged){
      if(!draft?.name)continue;
      const identity = draft.hid || draft.pendingHid;
      const key = assistantDraftKey(draft);
      const index = drafts.findIndex(row=>identity ? (row.hid || row.pendingHid) === identity : assistantDraftKey(row) === key);
      if(index < 0)drafts.push(draft); else drafts[index] = draft;
    }
    for(const action of session.pendingActions || []){
      if(action?.pending && !actions.some(row=>row.kind === action.kind && JSON.stringify(row.pending) === JSON.stringify(action.pending)))actions.push(action);
    }
    for(const answer of session.lastReadParts || [])if(answer && !answers.includes(answer))answers.push(answer);
    if(last.type === 'ask' || last.type === 'error' || last.gaveUp){
      session.needleWorkflow = {request:retained?.request || text,remaining:slices.slice(i+1),drafts,actions,answers,navigation,trace:trace.slice()};
      last.partial = drafts.length > 0 || actions.length > 0 || answers.length > 0;
      last.unfinished = slices.slice(i);
      last.alsoText = [answers.join('\n\n'),last.partial ? 'Work so far is kept for review after this part is resolved. Nothing has been saved.' : ''].filter(Boolean).join('\n\n');
      last.navigation=navigation;
      last.debug=trace.slice();
      last.debugText=assistantFormatDebug(trace);
      return last;
    }
  }
  session.needleStaged = null;
  session.pendingActions = actions;
  session.turnDrafts = drafts;
  session.drafts = drafts;
  session._focusOnly = !drafts.length;
  const extra = answers.join('\n\n');
  let out;
  if(drafts.length){
    session.draft = drafts.find(row=>row.kind === 'habit' || row.kind === 'task') || drafts[0];
    out = assistantPreviewResult(session,context);
    out.alsoText = extra;
    out.actions = actions;
  }else out = assistantPendingWriteOutcome(session,null,extra) || (extra ? {type:'say',text:extra,session} : last);
  out.navigation = navigation;
  out.debug = trace;
  out.debugText = assistantFormatDebug(trace);
  assistantRememberTurn(session,retained?.request || text,out);
  return out;
}
