// Public tool allowlist. Packaging evaluates only this declarative prefix.
const ASSISTANT_EXTERNAL_TOOLS = Object.freeze([
  'answer_items','answer_schedule','answer_weather','answer_settings','lookup_item','find_item',
  'draft_item','draft_setting','draft_batch','apply_items','complete_item','plan_item','delete_item'
]);
// Runtime bridge — Android AppFunctions reuse the same validators and previews.
(function(){
  const native = window.TingsNative;
  if(!native || !native.isNative || !native.assistant)return;
  const bridge = native.assistant;
  const reads = new Set(['answer_items','answer_schedule','answer_weather','answer_settings','lookup_item','find_item']);
  let enabled = false;
  let draining = false;
  let drainAgain = false;
  let deferred = null;

  // Check the declared contract before reaching permissive normalization helpers.
  function validate(value, schema, path = 'arguments', depth = 0){
    if(depth > 20)throw new Error('Arguments are nested too deeply.');
    const types = [].concat(schema.type || []);
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if(types.length && !types.includes(type) && !(types.includes('integer') && Number.isInteger(value)))
      throw new Error(`${path} has the wrong type.`);
    if(schema.enum && !schema.enum.includes(value))throw new Error(`${path} has an unsupported value.`);
    if(type === 'object'){
      for(const key of schema.required || [])if(!Object.prototype.hasOwnProperty.call(value,key))throw new Error(`${path}.${key} is required.`);
      for(const key of Object.keys(value)){
        if(['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid argument key.');
        if(schema.properties && !Object.prototype.hasOwnProperty.call(schema.properties,key))throw new Error(`Unknown argument ${path}.${key}.`);
        if(schema.properties && schema.properties[key])validate(value[key],schema.properties[key],`${path}.${key}`,depth+1);
      }
    }
    if(type === 'array' && schema.items)value.forEach((item,i)=>validate(item,schema.items,`${path}[${i}]`,depth+1));
  }
  function checked(tool, args){
    if(!ASSISTANT_EXTERNAL_TOOLS.includes(tool))throw new Error('Unknown Tings tool.');
    if(JSON.stringify(args).length > 24000)throw new Error('Arguments are too long.');
    validate(args,ASSISTANT_TOOL_DEFS[tool].parameters);
    return args;
  }
  async function allowed(){
    enabled = Boolean((await bridge.state()).enabled);
    return enabled;
  }
  async function read(tool, args){
    if(!await allowed())return {status:'disabled',text:'Android assistant access is off in Tings.'};
    if(!reads.has(tool))return {status:'error',text:'Changes require review in Tings.'};
    try{
      checked(tool,args);
      const result = await assistantExecuteTool(tool,args,assistantCreateSession(),assistantBuildContext());
      // Return the authoritative answer only, without the raw record or session payload.
      return {status:result.ok ? 'ok' : 'error',text:result.text || result.ask || result.error || 'No matching results.'};
    }catch(error){ return {status:'error',text:String(error.message || 'Could not answer this query.')}; }
  }
  function openSettings(){
    if(typeof openSettingsSheet === 'function')openSettingsSheet();
    else openSheet('settings-sheet');
    const body = $('settings-android-assistant-body');
    if(body)body.hidden = false;
    $('settings-android-assistant-head')?.setAttribute('aria-expanded','true');
    $('settings-android-assistant')?.scrollIntoView({block:'nearest'});
  }
  async function review(tool, args){
    checked(tool,args);
    const session = assistantCreateSession();
    const context = assistantBuildContext();
    const result = await assistantExecuteTool(tool,args,session,context);
    // Tool execution stages only. Commits remain the existing visible buttons.
    _assistantTurn += 1;
    _assistantSession = session;
    _assistantPendingDraft = null;
    _assistantPendingDrafts = null;
    openAssistantSheet({external:true,skipWelcome:true});
    assistantThreadEl().replaceChildren();
    appendAssistantBubble('say','Request from an Android assistant. Review it below; nothing has been saved.');
    let out;
    if(!result.ok)out = {type:'say',text:result.ask || result.error || 'This request needs more detail.'};
    else if(reads.has(tool))out = {type:'say',text:result.text};
    else if(tool === 'apply_items')out = result.drafts?.length || result.pendingDelete
      ? assistantApplyOutcome(session,context,'',result) : {type:'say',text:result.text || 'No changes to review.'};
    else if(result.pendingComplete)out = {type:'complete',text:result.text || result.pendingComplete.summary,alreadyDone:result.alreadyDone,completeAction:result.pendingComplete.action};
    else if(result.pendingPlan)out = {type:'plan',text:result.text || result.pendingPlan.summary,planAction:result.pendingPlan.action};
    else if(result.pendingDelete)out = {type:'delete',text:result.text || result.pendingDelete.summary};
    else if(result.existing)out = {type:'say',text:result.text || 'That already exists. No changes were made.'};
    else {
      assistantPublishTurnDrafts(session);
      out = assistantPreviewResult(session,context,'');
    }
    await handleAssistantOutcome({...out,session});
  }
  async function drain(){
    if(draining){drainAgain = true;return;}
    if(_assistantBusy || $('assistant-sheet')?.classList.contains('open'))return;
    draining = true;
    try{
      const request = deferred || (await bridge.takeLaunchRequest()).request;
      if(!request)return;
      deferred = null;
      $('android-assistant-review').hidden = true;
      if(request.kind === 'open'){openSettings();return;}
      if(request.kind === 'tool' && !await allowed()){
        deferred = request;
        openSettings();
        $('android-assistant-status').textContent = 'Enable access, then tap review pending request.';
        $('android-assistant-review').hidden = false;
        return;
      }
      if(request.kind === 'search')await review('answer_items',{query:'list',search:request.text});
      else if(request.kind === 'today')await review('answer_schedule',{query:'day',date:'today'});
      else if(request.kind === 'add'){
        // The app's ordinary add form is available without any model or API key.
        $('open-add')?.click();
        document.querySelector('#type-seg [data-v="task"]')?.click();
      }else if(request.kind === 'capture')await review('draft_item',{kind:'task',create:true,name:request.text});
      else if(request.kind === 'tool')await review(request.tool,request.arguments);
    }catch(error){
      if(typeof showToast === 'function')showToast(String(error.message || 'Could not open the assistant request.'));
    }finally{
      draining = false;
      // A native launch can arrive after takeLaunchRequest has observed an empty
      // queue but before its promise resolves. Preserve that wake-up.
      if(drainAgain){drainAgain = false;void drain();}
    }
  }
  async function initialize(){
    const section = $('settings-android-assistant');
    if(section)section.hidden = false;
    const toggle = $('setting-android-assistant');
    await allowed();
    toggle?.setAttribute('aria-pressed',String(enabled));
    toggle?.addEventListener('click',async()=>{
      toggle.disabled = true;
      try{
        await bridge.setEnabled({enabled:!enabled});
        await allowed();
        toggle.setAttribute('aria-pressed',String(enabled));
        $('android-assistant-status').textContent = enabled ? 'Access enabled. Gemini availability depends on Google’s rollout.' : 'Android assistant access is off.';
      }catch(_){$('android-assistant-status').textContent = 'Could not change access. Try again.';}
      finally{toggle.disabled = false;}
    });
    $('android-assistant-review')?.addEventListener('click',()=>void drain());
    await bridge.addListener('launchRequest',()=>void drain());
    await bridge.ready();
    await drain();
  }
  window.tingsExternalAssistant = {read,drain};
  void initialize().catch(()=>{
    const status = $('android-assistant-status');
    if(status)status.textContent = 'Android assistant connection unavailable. Reopen Tings to try again.';
  });
})();
