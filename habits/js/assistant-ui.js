// Local assistant sheet + settings. Preview never saves until Add.

let _assistantSession = null;
let _assistantBusy = false;
const _assistantActionButtons = new WeakMap();
let _assistantPendingDraft = null;
let _assistantPendingDrafts = null;
let _assistantTurn = 0;
let _assistantExternalReview = false;
let _assistantDebugRevealed = false;
let _assistantTitleTaps = [];

function assistantEnabled(){
  return Boolean(sortSettings && sortSettings.localAssistant);
}

function assistantDebugOn(){
  if(typeof assistantSettings === 'function')return Boolean(assistantSettings().debug);
  return Boolean(sortSettings && sortSettings.localAssistantDebug);
}

function assistantModelOnlyOn(){
  return true;
}

function syncAssistantChrome(){
  const on = assistantEnabled();
  document.body.classList.toggle('assistant-on', on);
  document.body.classList.toggle('assistant-debug-on', on && assistantDebugOn());
  if(typeof syncDetailSearchAssistant === 'function'){
    if($('detail-search-panel').hidden)syncDetailSearchAssistant();
    else renderDetailSearch();
  }
  const needle = typeof assistantSettings === 'function' && assistantSettings().provider === 'needle';
  ['open-assistant','bar-open-assistant'].forEach(id => {
    const btn = $(id);
    if(btn)btn.hidden = !on || needle;
  });
  if(!on){
    assistantAbortInFlight();
    if(!_assistantExternalReview && $('assistant-sheet') && $('assistant-sheet').classList.contains('open'))closeAssistantSheet();
  }
}

function syncLocalAssistantControls(){
  const s = assistantSettings();
  const toggle = $('setting-local-assistant');
  if(toggle)toggle.setAttribute('aria-pressed', String(s.on));
  const debugToggle = $('setting-local-assistant-debug');
  if(debugToggle)debugToggle.setAttribute('aria-pressed', String(s.debug));
  const sheetDebug = $('assistant-debug-toggle');
  const showDebug = s.on && _assistantDebugRevealed;
  if(sheetDebug){
    sheetDebug.setAttribute('aria-pressed', String(s.debug));
    sheetDebug.hidden = !showDebug;
    const dockOpen = showDebug && Boolean($('assistant-debug-dock') && !$('assistant-debug-dock').hidden);
    sheetDebug.classList.toggle('is-open', dockOpen);
    sheetDebug.setAttribute('aria-expanded', String(dockOpen));
    sheetDebug.setAttribute('aria-label', dockOpen ? 'close debug' : 'debug trace');
  }
  if(!showDebug)assistantCloseDebugDock();
  const feedbackBtn = $('assistant-feedback');
  if(feedbackBtn)feedbackBtn.hidden = !s.on || typeof feedbackFormConfigured !== 'function' || !feedbackFormConfigured();
  document.querySelectorAll('#assistant-provider-seg .seg-opt').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.assistantProvider === s.provider);
  });
  document.querySelectorAll('#assistant-reasoning-seg .seg-opt').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.assistantReasoning === s.reasoning);
  });
  if($('assistant-url'))$('assistant-url').value = s.url;
  if($('assistant-model'))$('assistant-model').value = s.model;
  const extras = $('assistant-setup-fields');
  if(extras)extras.hidden = !s.on;
  const needle = s.provider === 'needle';
  if($('assistant-server-fields'))$('assistant-server-fields').hidden = needle;
  if($('assistant-setup-guide'))$('assistant-setup-guide').hidden = needle;
  syncAssistantNeedleControls();
  syncAssistantOriginHelp();
  syncAssistantChrome();
  syncAssistantFocusBar();
}

function syncAssistantOriginHelp(){
  const publicOrigin = typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '';
  const origin = typeof assistantGuideOrigin === 'function' ? assistantGuideOrigin() : (publicOrigin || 'https://lanbeee.github.io');
  const platform = typeof assistantHostPlatform === 'function' ? assistantHostPlatform() : 'mac';
  const cmd = typeof assistantOllamaSetupCommands === 'function'
    ? assistantOllamaSetupCommands(origin, platform)
    : (typeof assistantOllamaOriginsAllowText === 'function' ? assistantOllamaOriginsAllowText(origin, platform) : '');
  const restart = typeof assistantOllamaRestartHint === 'function'
    ? assistantOllamaRestartHint(platform)
    : 'Quit Ollama, then open it again.';
  const lead = $('assistant-reach-lead');
  const allow = $('assistant-reach-step-allow');
  const listen = $('assistant-reach-step-listen');
  const phone = $('assistant-reach-step-phone');
  const quit = $('assistant-reach-step-restart');
  const pre = $('assistant-reach-cmd');
  const copy = $('assistant-copy-origins');
  if(lead){
    lead.textContent = publicOrigin
      ? `Allow this site once, then fully quit and reopen Ollama. For a phone, Tailscale Serve is the reliable route because it gives Ollama an HTTPS address. This page is ${origin}.`
      : 'This local page is already allowed. Keep Ollama running. For a phone, use Tailscale Serve to give Ollama an HTTPS address.';
  }
  if(allow){
    allow.textContent = publicOrigin
      ? `Allow this website. Copy the commands, paste them in ${platform === 'windows' ? 'Command Prompt' : 'Terminal'}, and press Return.`
      : `On the personal clone, allow that website the same way. The first command below uses ${origin}.`;
  }
  if(listen){
    listen.textContent = 'Recommended for a phone: with Tailscale connected on both devices, run “tailscale serve --bg 11434” on the laptop. It privately proxies Ollama over HTTPS; you do not need to expose Ollama to the whole Wi-Fi network.';
  }
  if(phone){
    phone.textContent = 'Copy the exact https://…ts.net URL printed by Tailscale into address on the phone. Leave address blank on the laptop itself.';
  }
  if(quit)quit.textContent = restart;
  if(pre){
    pre.textContent = cmd;
    pre.hidden = !cmd;
  }
  if(copy)copy.hidden = !cmd;
}

function assistantEnabledStatusText(){
  if(assistantSettings().provider === 'needle')return assistantNeedleState().phase === 'downloaded'
    ? 'On. Needle 3 is ready on this device.' : 'On. Download Needle 3 once to use the assistant on this device.';
  const origin = typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '';
  if(origin)return 'On. If list models fails, follow the steps under local assistant.';
  return 'On. Keep Ollama running on this computer.';
}

function patchLocalAssistant(patch){
  const wasEnabled = assistantEnabled();
  if(patch.localAssistantProvider && patch.localAssistantProvider !== assistantSettings().provider)assistantAbortInFlight();
  if(typeof updateSortSetting === 'function')updateSortSetting(patch, {renderNow:false});
  else if(typeof saveSortSettings === 'function')saveSortSettings({...loadSortSettings(), ...patch});
  sortSettings = typeof loadSortSettings === 'function' ? loadSortSettings() : sortSettings;
  syncLocalAssistantControls();
  if(wasEnabled !== assistantEnabled() && typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
  if(assistantEnabled() && assistantSettings().provider === 'needle')void assistantNeedleCheckDownload();
}

function assistantNeedleCanSend(){
  return assistantSettings().provider !== 'needle' || assistantNeedleState().phase === 'downloaded';
}

function syncAssistantNeedleControls(){
  const selected = assistantSettings().provider === 'needle';
  const state = assistantNeedleState();
  const downloading = state.phase === 'downloading';
  const downloaded = state.phase === 'downloaded';
  document.querySelectorAll('[data-needle-panel]').forEach(panel=>{
    const chatReady = panel.closest('#assistant-sheet') && downloaded && !state.error;
    panel.hidden = !selected || !assistantEnabled() || chatReady;
    const status = panel.querySelector('[data-needle-status]');
    if(status)status.textContent = state.error || (downloading ? `Downloading Needle 3… ${state.progress}%`
      : downloaded ? 'Needle 3 is ready, including offline.'
      : 'Needle 3 is 36.3 MB and stays on this device.');
    const progress = panel.querySelector('progress');
    if(progress){ progress.hidden = !downloading; progress.value = state.progress; }
    const download = panel.querySelector('[data-needle-download]');
    if(download){ download.hidden = downloaded || downloading; download.textContent = state.phase === 'error' ? 'retry download' : 'download Needle 3'; }
    const cancel = panel.querySelector('[data-needle-cancel]');
    if(cancel)cancel.hidden = !downloading;
    const remove = panel.querySelector('[data-needle-remove]');
    if(remove){ remove.hidden = !downloaded; remove.disabled = _assistantBusy; }
  });
  assistantSyncSend();
}

function commitAssistantUrlFromInput(){
  const el = $('assistant-url');
  if(!el)return true;
  const raw = el.value;
  const next = typeof normalizeLocalAssistantUrl === 'function' ? normalizeLocalAssistantUrl(raw) : '';
  if(String(raw).trim() && !next){
    assistantSetStatus(typeof assistantRejectedUrlHint === 'function'
      ? assistantRejectedUrlHint()
      : 'That address was not saved.');
    return false;
  }
  if(next !== assistantSettings().url){
    patchLocalAssistant({localAssistantUrl:next});
    if(next && typeof assistantUrlIsLoopback === 'function' && !assistantUrlIsLoopback(next)){
      assistantSetStatus('Saved. Tap list models. Allow local network if the phone asks.');
    }
  }
  else el.value = assistantSettings().url;
  return true;
}

function assistantSetStatus(text){
  const el = $('assistant-conn-status');
  if(el)el.textContent = text || '';
}

function assistantNeedleFocused(opts){
  return Boolean(opts && opts.focused && _assistantSession && _assistantSession.focus && typeof assistantFocusAlive === 'function' && assistantFocusAlive(_assistantSession.focus));
}

function openAssistantSheet(opts){
  const external = Boolean(opts && opts.external && window.TingsNative?.isNative);
  if(!assistantEnabled() && !external){
    if(typeof showToast === 'function')showToast('Turn on local assistant in Settings');
    return false;
  }
  if(assistantSettings().provider === 'needle' && !external && !assistantNeedleFocused(opts)){
    if(typeof showToast === 'function')showToast('Open an item and ask for a change from its details.');
    return false;
  }
  _assistantExternalReview = external;
  const eyebrow = document.querySelector('#assistant-sheet .sheet-eyebrow');
  if(eyebrow)eyebrow.textContent = external ? 'Android assistant' : 'on this device';
  const composer = $('assistant-input')?.closest('.assistant-compose');
  if(composer)composer.hidden = external && !assistantEnabled();
  if(!_assistantSession)_assistantSession = assistantCreateSession();
  if(!(opts && opts.skipWelcome))renderAssistantThread();
  syncAssistantFocusBar();
  openSheet('assistant-sheet');
  syncAssistantNeedleControls();
  if(assistantSettings().provider === 'needle')void assistantNeedleCheckDownload();
  assistantResizeComposer();
  assistantSyncSend();
  const input = $('assistant-input');
  if(input && !(external && !assistantEnabled())){
    input.focus({preventScroll:true});
    setTimeout(() => {
      if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
    }, 260);
  }
  return true;
}

function closeAssistantSheet(){
  _assistantExternalReview = false;
  assistantAbortInFlight();
  assistantShowBusy(false);
  closeSheet('assistant-sheet');
  if(window.tingsExternalAssistant)setTimeout(()=>window.tingsExternalAssistant.drain(),0);
}

function assistantOpenForItem(hid, entry, extra){
  const items = load();
  const index = items.findIndex(item=>item.hid === hid);
  if(index < 0)return false;
  const item = items[index];
  extra = extra || {};
  if(assistantSettings().provider === 'needle' && typeof assistantFocusImported === 'function' && assistantFocusImported(item)){
    if(typeof showToast === 'function')showToast('Imported calendar events stay outside Edit with AI.');
    return false;
  }
  const draft = assistantHabitToDraft(item,index,loadSortSettings());
  return assistantOpenWithInstruction('',{
    draft,
    entry,
    focusOpts:assistantSettings().provider === 'needle' ? {
      operation:'edit',
      kind:typeof assistantFocusKindOf === 'function' ? assistantFocusKindOf(item) : (item.type === 'task' ? 'task' : 'habit'),
      targetId:item.hid,
      entry,
      occurrenceDate:extra.occurrenceDate || ''
    } : null
  });
}

// Entry points (detail search, detail actions, home swipe) start a fresh conversation with the
// intent or item already known, so the model skips classify and extracts
// straight away. All other natural-language turns start with the model too.
async function assistantOpenWithInstruction(text, opts){
  opts = opts || {};
  if(!assistantEnabled()){
    if(typeof showToast === 'function')showToast('Turn on local assistant in Settings');
    return false;
  }
  const value = String(text || '').trim();
  const draft = opts.draft && opts.draft.name ? opts.draft : null;
  if(!value && !draft)return false;
  _assistantTurn += 1;
  assistantAbortInFlight();
  assistantShowBusy(false);
  _assistantPendingDraft = null;
  _assistantPendingDrafts = null;
  _assistantSession = assistantCreateSession();
  _assistantSession.entry = opts.entry || null;
  if(draft)_assistantSession.draft = draft;
  if(assistantSettings().provider === 'needle' && typeof assistantFocusOpen === 'function'){
    const kind = opts.intent === 'create_task' ? 'task' : (opts.intent === 'create_event' ? 'event' : 'habit');
    const spec = opts.focusOpts || (opts.entry === 'add' ? {
      operation:'create',
      kind,
      entry:'add',
      addForm:{record:opts.addRecord || null}
    } : null);
    _assistantSession.focus = spec ? assistantFocusOpen(spec) : null;
    if(!_assistantSession.focus){
      if(typeof showToast === 'function')showToast('Open an item and ask for a change from its details.');
      return false;
    }
  }
  // Add, detail, and a home-card ask each start a blank chat. Earlier turns
  // stay on screen otherwise, and a tiny model will repeat them.
  const thread = assistantThreadEl();
  if(thread)thread.replaceChildren();
  assistantPresentComposer('');
  syncAssistantFocusBar();
  const opened = openAssistantSheet({skipWelcome:true, focused:Boolean(_assistantSession.focus)});
  if(opened === false)return false;
  if(!value){
    // Item entry with no instruction yet: Needle opens on the Edit/New
    // summary. Other providers keep a local intro. No model call until typing.
    if(!assistantShowOpeningFocus()){
      appendAssistantBubble('say', `Working on ${draft.name}. Tell me what to do — change its schedule, log it, plan it, or ask a question.`);
    }
    const input = $('assistant-input');
    if(input)input.focus({preventScroll:true});
    setTimeout(() => {
      if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
    }, 260);
    return true;
  }
  const spoken = value;
  let modelText = String(opts.modelText || '').trim();
  if(!modelText || assistantSettings().provider === 'needle')modelText = spoken;
  await sendAssistantMessage(modelText, {
    startIntent:opts.intent,
    entry:opts.entry,
    displayText:spoken,
    form:opts.form || null
  });
  return true;
}

function assistantWelcomeHtml(){
  if(assistantSettings().provider === 'needle')return `<div class="assistant-bubble assistant-bubble-say"><p>Needle edits one habit, task, or local event at a time. Open an item and use its search box or Edit with AI. Nothing is saved until you confirm.</p></div>`;
  return `<div class="assistant-bubble assistant-bubble-say"><p>Say it like a person. Nothing is saved until you confirm.</p>
      <div class="assistant-suggestions">
        <button type="button" class="assistant-suggest" data-assistant-suggest="Remind me to call mom">Remind me to call mom</button>
        <button type="button" class="assistant-suggest" data-assistant-suggest="What's next?">What's next?</button>
        <button type="button" class="assistant-suggest" data-assistant-suggest="Walk every day after sunset">Walk after sunset</button>
      </div></div>`;
}

function assistantThreadEl(){
  return $('assistant-thread');
}

function assistantAppendActionChoice(bubble, out, request){
  if(!bubble || assistantSettings().provider !== 'needle' || !request || out.partial)return;
  const turn=_assistantTurn;
  const controls=document.createElement('div');controls.className='assistant-suggestions';
  const select=document.createElement('select');select.dataset.assistantAction='true';
  select.setAttribute('aria-label','Choose the action for this request');
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a different action…';select.append(placeholder);
  for(const [name,label] of ASSISTANT_NEEDLE_ACTION_CHOICES){
    const option=document.createElement('option');option.value=name;option.textContent=label;select.append(option);
  }
  const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.dataset.assistantAction='true';
  retry.textContent='retry action';retry.disabled=true;
  select.addEventListener('change',()=>{retry.disabled=!select.value || _assistantBusy || turn !== _assistantTurn;});
  retry.addEventListener('click',()=>{
    if(_assistantBusy || turn !== _assistantTurn || !select.value)return;
    const tool=select.value;
    if(!ASSISTANT_NEEDLE_ACTION_CHOICES.some(([name])=>name === tool))return;
    if(_assistantSession){
      _assistantSession.needleProposal=null;_assistantSession.needleApproved=null;
      _assistantSession.awaiting=null;_assistantSession.clarifyingRequest=null;_assistantSession.clarifyCount=0;
    }
    retry.disabled=true;select.disabled=true;
    void sendAssistantMessage(request,{needleAction:tool,displayText:select.selectedOptions[0].textContent});
  });
  controls.append(select,retry);bubble.append(controls);
}

function assistantFocusedDraft(){
  return (_assistantSession && _assistantSession.draft && _assistantSession.draft.name)
    ? _assistantSession.draft
    : (_assistantPendingDraft && _assistantPendingDraft.name ? _assistantPendingDraft : null);
}

function assistantPendingDrafts(){
  if(Array.isArray(_assistantPendingDrafts) && _assistantPendingDrafts.length)return _assistantPendingDrafts;
  const one = assistantFocusedDraft();
  return one ? [one] : [];
}

function assistantFocusMetaText(draft){
  const drafts = assistantPendingDrafts();
  if(drafts.length > 1){
    const items = drafts.filter(row => row.kind === 'habit' || row.kind === 'task').length;
    const places = drafts.filter(row => row.kind === 'location').length;
    const bits = [];
    const settingsCount = drafts.filter(row => row.kind === 'weather' || row.kind === 'busy' || row.kind === 'topic').length;
    if(items)bits.push(`${items} ${items === 1 ? 'item' : 'items'}`);
    if(places)bits.push(`${places} ${places === 1 ? 'place' : 'places'}`);
    if(settingsCount)bits.push(`${settingsCount} ${settingsCount === 1 ? 'setting' : 'settings'}`);
    return `not saved yet · ${bits.join(', ')}`;
  }
  if(!draft)return '';
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (typeof sortSettings !== 'undefined' ? sortSettings : {});
  const summary = typeof assistantDraftSummary === 'function' ? assistantDraftSummary(draft, settings) : '';
  const rest = summary
    ? summary.replace(new RegExp(`^${String(draft.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*·\\s*`), '')
    : '';
  const status = (draft.hid || draft.settingId) ? 'saved' : 'not saved yet';
  return rest && rest !== draft.name ? `${status} · ${rest}` : status;
}

function assistantNeedleFocusReview(){
  return typeof assistantSettings === 'function'
    && assistantSettings().provider === 'needle'
    && _assistantSession
    && _assistantSession.focus
    && typeof assistantFocusAlive === 'function'
    && assistantFocusAlive(_assistantSession.focus)
    && typeof assistantFocusReviewHtml === 'function';
}

function syncAssistantFocusBar(){
  assistantRenderGuides();
  const bar = $('assistant-focus');
  if(!bar)return;
  // The Edit/New summary already names the item. A second "working on" strip
  // would repeat that name, so Needle keeps the bar hidden.
  if(assistantNeedleFocusReview()){
    bar.hidden = true;
    bar.classList.remove('is-draft');
    const done = $('assistant-focus-done');
    if(done)done.hidden = true;
    return;
  }
  const draft = assistantFocusedDraft();
  if(!draft){
    bar.hidden = true;
    bar.classList.remove('is-draft');
    return;
  }
  bar.hidden = false;
  const name = $('assistant-focus-name');
  const meta = $('assistant-focus-meta');
  const kicker = $('assistant-focus-kicker');
  if(name){
    const drafts = assistantPendingDrafts();
    const items = drafts.filter(row => row.kind === 'habit' || row.kind === 'task');
    name.textContent = drafts.length > 1
      ? (items[0] && items[0].name ? `${items[0].name} +${drafts.length - 1}` : `${drafts.length} drafts`)
      : draft.name;
  }
  if(meta)meta.textContent = assistantFocusMetaText(draft);
  if(kicker)kicker.textContent = (draft.hid || draft.settingId) ? 'working on' : 'draft';
  bar.classList.toggle('is-draft', !(draft.hid || draft.settingId));
  const done = $('assistant-focus-done');
  if(done)done.hidden = typeof assistantSettings === 'function' && assistantSettings().provider === 'needle';
}

function assistantNeedleFocusLock(){
  if(typeof assistantSettings !== 'function' || assistantSettings().provider !== 'needle')return null;
  const focus = _assistantSession && _assistantSession.focus;
  if(!focus)return null;
  return {
    draft:_assistantSession.draft,
    entry:_assistantSession.entry || focus.entry || null,
    spec:{
      operation:focus.operation,
      kind:focus.kind,
      targetId:focus.targetId,
      entry:focus.entry || _assistantSession.entry || null,
      occurrenceDate:focus.occurrenceDate || '',
      addForm:focus.addForm || null
    }
  };
}

function assistantClearFocus(){
  if(assistantNeedleFocusLock()){
    syncAssistantFocusBar();
    return;
  }
  if(_assistantSession){
    _assistantSession.draft = null;
    _assistantSession.pendingEdit = null;
    _assistantSession.pendingComplete = null;
    _assistantSession.pendingPlan = null;
    _assistantSession.pendingDelete = null;
    _assistantSession.pendingActions = [];
    _assistantSession.needleWorkflow = null;
    _assistantSession.needleProposal = null;
    _assistantSession.needleApproved = null;
    _assistantSession.needleStaged = null;
    _assistantSession.drafts = null;
    _assistantSession.turnDrafts = null;
    _assistantSession._focusOnly = true;
    _assistantSession.awaiting = null;
  }
  _assistantPendingDraft = null;
  _assistantPendingDrafts = null;
  syncAssistantFocusBar();
}

function clearAssistantChat(){
  const needleFocus = assistantNeedleFocusLock();
  _assistantTurn += 1;
  assistantAbortInFlight();
  assistantShowBusy(false);
  if(!needleFocus)assistantClearFocus();
  _assistantSession = typeof assistantCreateSession === 'function' ? assistantCreateSession() : null;
  if(needleFocus && _assistantSession && typeof assistantFocusOpen === 'function'){
    _assistantSession.entry = needleFocus.entry;
    _assistantSession.draft = needleFocus.draft;
    _assistantSession.focus = assistantFocusOpen(needleFocus.spec);
    _assistantSession._focusOnly = true;
    _assistantPendingDraft = needleFocus.draft;
    _assistantPendingDrafts = null;
  }
  assistantPresentComposer('');
  $('assistant-input')?.focus({preventScroll:true});
  const thread = assistantThreadEl();
  if(thread){
    thread.replaceChildren();
    if(!assistantShowOpeningFocus()){
      const name = needleFocus && needleFocus.draft && needleFocus.draft.name;
      if(name)appendAssistantBubble('say', `Working on ${name}. Tell me what to change. Several settings in one message are fine. Nothing is saved until you confirm.`);
      else thread.innerHTML = assistantWelcomeHtml();
    }
  }
  assistantResizeComposer();
  assistantSyncSend();
  syncAssistantFocusBar();
  assistantPresentDebug();
  assistantRefreshFeedbackPanel();
}

function assistantThinkHtml(thinking){
  const text = String(thinking || '').trim();
  if(!text)return '';
  return `<details class="assistant-think"><summary>thought</summary><pre>${escapeHtml(text)}</pre></details>`;
}

function assistantDebugPayload(events){
  try{ return JSON.stringify(events || [], null, 2); }catch(_){ return '[]'; }
}

function assistantDebugMeta(events){
  const list = Array.isArray(events) ? events : [];
  if(!list.length)return 'nothing yet';
  let done = null;
  let steps = 0;
  list.forEach(ev => {
    if(!ev)return;
    if(ev.t === 'done')done = ev;
    else if(ev.t !== 'turn')steps += 1;
  });
  const ms = done && done.totalMs;
  if(typeof ms === 'number' && ms >= 0)return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`;
  if(steps)return `${steps} ${steps === 1 ? 'step' : 'steps'}`;
  return 'ready';
}

function assistantDebugHtml(events, extra){
  const text = extra && extra.debugText
    || (typeof assistantFormatDebug === 'function' ? assistantFormatDebug(events) : '');
  if(!text && !(events && events.length))return '';
  return `<details class="assistant-debug">
    <summary><i class="ti ti-chevron-right" aria-hidden="true"></i><span>trace</span><span class="assistant-debug-meta">${escapeHtml(assistantDebugMeta(events))}</span></summary>
    <pre class="assistant-debug-log">${escapeHtml(text)}</pre>
    <textarea class="assistant-debug-json" hidden></textarea>
    <div class="assistant-debug-actions">
      <button type="button" class="btn" data-assistant-copy-debug>copy</button>
    </div>
  </details>`;
}

function assistantShowThink(kind){
  return kind === 'say' || assistantDebugOn();
}

function assistantFillDebugBubble(el, events, extra){
  if(!el)return;
  el.innerHTML = assistantDebugHtml(events, extra);
  const json = extra && extra.debugJson || assistantDebugPayload(events);
  const hold = el.querySelector('.assistant-debug-json');
  if(hold)hold.value = json;
  const thread = assistantThreadEl();
  if(thread)thread.scrollTop = thread.scrollHeight;
}

function assistantEnsureLiveDebug(){
  if(!assistantDebugOn())return null;
  const thread = assistantThreadEl();
  if(!thread)return null;
  let el = thread.querySelector('.assistant-bubble-debug.is-live');
  if(!el){
    thread.querySelectorAll('.assistant-bubble-debug.is-live').forEach(node => node.classList.remove('is-live'));
    el = document.createElement('div');
    el.className = 'assistant-bubble assistant-bubble-debug is-live';
    el.innerHTML = `<details class="assistant-debug"><summary><i class="ti ti-chevron-right" aria-hidden="true"></i><span>trace</span></summary><pre class="assistant-debug-log">starting…</pre></details>`;
    thread.appendChild(el);
  }
  return el;
}

function assistantRenderLiveDebug(events){
  if(assistantDebugOn()){
    const el = assistantEnsureLiveDebug();
    assistantFillDebugBubble(el, events, {
      debugText:typeof assistantFormatDebug === 'function' ? assistantFormatDebug(events) : '',
      debugJson:assistantDebugPayload(events)
    });
  }
  const dock = $('assistant-debug-dock');
  if(dock && !dock.hidden)assistantSyncDebugDock();
}

function assistantCurrentDebugEvents(){
  const focus = _assistantSession && _assistantSession.focus;
  if(focus && typeof assistantFeedbackFocusTrace === 'function'){
    const events = assistantFeedbackFocusTrace(focus);
    if(events.length)return events;
  }
  if(_assistantSession && Array.isArray(_assistantSession.debug) && _assistantSession.debug.length)return _assistantSession.debug;
  return [];
}

function assistantNoteTitleTap(){
  const now = Date.now();
  _assistantTitleTaps = _assistantTitleTaps.filter(stamp => now - stamp < 700);
  _assistantTitleTaps.push(now);
  if(_assistantTitleTaps.length < 3)return;
  _assistantTitleTaps = [];
  _assistantDebugRevealed = true;
  syncLocalAssistantControls();
}

function assistantDebugChrome(open){
  const btn = $('assistant-debug-toggle');
  if(!btn)return;
  btn.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'close debug' : 'debug trace');
}

function assistantCloseDebugDock(){
  const dock = $('assistant-debug-dock');
  if(dock){
    dock.hidden = true;
    dock.classList.remove('is-compact');
  }
  const fold = $('assistant-debug-fold');
  if(fold){
    fold.setAttribute('aria-expanded', 'true');
    fold.setAttribute('aria-label', 'compact trace');
  }
  assistantDebugChrome(false);
}

function assistantDebugKind(ev){
  if(!ev)return '';
  if(ev.t === 'turn')return 'you';
  if(ev.t === 'tool')return ev.name || 'call';
  if(ev.t === 'model')return 'note';
  if(ev.t === 'result')return ev.name || 'result';
  if(ev.t === 'error')return 'error';
  if(ev.t === 'ask')return 'ask';
  if(ev.t === 'done')return 'done';
  return ev.t || 'trace';
}

function assistantDebugDetail(ev){
  if(!ev)return '';
  if(ev.t === 'turn')return ev.text || '';
  if(ev.t === 'tool'){
    const raw = ev.args && typeof ev.args === 'object' ? ev.args : null;
    const inner = raw && raw.args && typeof raw.args === 'object' ? raw.args : raw;
    if(!inner || typeof inner !== 'object')return typeof ev.args === 'string' ? ev.args : '';
    return Object.entries(inner).filter(([, value]) => value != null && value !== '').map(([key, value]) => {
      const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${key} ${shown}`;
    }).join(' · ');
  }
  if(ev.t === 'model')return ev.thinking ? String(ev.thinking).replace(/\s+/g, ' ').trim() : '';
  if(ev.t === 'result')return [ev.preview, ev.ok === false ? 'failed' : ''].filter(Boolean).join(' · ');
  if(ev.t === 'error')return String(ev.error || '');
  if(ev.t === 'ask')return ev.question || '';
  if(ev.t === 'done'){
    const ms = ev.totalMs;
    const time = typeof ms === 'number' && ms >= 0 ? (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`) : '';
    return [ev.text, time].filter(Boolean).join(' · ');
  }
  return typeof assistantFormatDebugLine === 'function' ? assistantFormatDebugLine(ev) : '';
}

function assistantFillDebugLog(log, events){
  if(!log)return;
  log.replaceChildren();
  const list = Array.isArray(events) ? events : [];
  if(!list.length){
    const empty = document.createElement('p');
    empty.className = 'assistant-debug-empty';
    empty.textContent = 'No trace yet. Send a message and this fills in.';
    log.append(empty);
    return;
  }
  list.forEach(ev => {
    const detail = assistantDebugDetail(ev);
    if(!detail && !(ev && ev.t === 'error'))return;
    const row = document.createElement('div');
    row.className = 'assistant-debug-row';
    const kind = document.createElement('span');
    kind.className = 'assistant-debug-kind';
    kind.textContent = assistantDebugKind(ev);
    const body = document.createElement('span');
    body.className = 'assistant-debug-detail';
    body.textContent = detail;
    row.append(kind, body);
    log.append(row);
  });
  if(!log.childElementCount){
    const empty = document.createElement('p');
    empty.className = 'assistant-debug-empty';
    empty.textContent = 'No trace yet. Send a message and this fills in.';
    log.append(empty);
  }
}

function assistantSyncDebugDock(opts){
  const dock = $('assistant-debug-dock');
  if(!dock)return;
  const events = assistantCurrentDebugEvents();
  assistantFillDebugLog(dock.querySelector('.assistant-debug-log'), events);
  const hold = dock.querySelector('.assistant-debug-json');
  if(hold)hold.value = assistantDebugPayload(events);
  const meta = dock.querySelector('.assistant-debug-meta');
  if(meta)meta.textContent = assistantDebugMeta(events);
  if(opts && opts.open){
    dock.hidden = false;
    dock.classList.remove('is-compact');
  }
  const compact = !dock.hidden && dock.classList.contains('is-compact');
  const fold = $('assistant-debug-fold');
  if(fold){
    fold.setAttribute('aria-expanded', String(!dock.hidden && !compact));
    fold.setAttribute('aria-label', compact ? 'expand trace' : 'compact trace');
  }
  assistantDebugChrome(!dock.hidden);
}

function assistantToggleDebugDock(){
  const dock = $('assistant-debug-dock');
  if(!dock)return;
  if(!dock.hidden){
    assistantCloseDebugDock();
    return;
  }
  assistantThreadEl()?.querySelectorAll('.assistant-bubble-debug.is-sheet').forEach(node => node.remove());
  assistantSyncDebugDock({open:true});
}

function assistantToggleDebugCompact(){
  const dock = $('assistant-debug-dock');
  if(!dock || dock.hidden)return;
  dock.classList.toggle('is-compact');
  const compact = dock.classList.contains('is-compact');
  const fold = $('assistant-debug-fold');
  if(fold){
    fold.setAttribute('aria-expanded', String(!compact));
    fold.setAttribute('aria-label', compact ? 'expand trace' : 'compact trace');
  }
}

// The sheet button opens one tray. A later tap, or the tray’s close control,
// removes it. The tray bar only compacts the log.
function assistantPresentDebug(opts){
  const dock = $('assistant-debug-dock');
  if(!dock)return;
  if(dock.hidden && !(opts && opts.open))return;
  assistantSyncDebugDock(opts);
}

function assistantFeedbackSheetBuilder(){
  return typeof assistantFeedbackSheet === 'function' ? assistantFeedbackSheet : assistantFeedbackDetails;
}

function assistantRefreshFeedbackPanel(){
  const panel = $('assistant-feedback-panel');
  const build = assistantFeedbackSheetBuilder();
  if(!panel || panel.hidden || typeof build !== 'function' || typeof assistantActiveFeedback !== 'function')return;
  const diagnostics = panel.querySelector('details');
  const wasOpen = Boolean(diagnostics && diagnostics.open);
  const snap = assistantActiveFeedback();
  panel.replaceChildren(build(snap.out, snap.context));
  const details = panel.querySelector('details');
  if(details)details.open = wasOpen;
}

function assistantToggleFeedbackPanel(){
  const panel = $('assistant-feedback-panel');
  const build = assistantFeedbackSheetBuilder();
  if(!panel || typeof build !== 'function' || typeof assistantActiveFeedback !== 'function')return;
  const btn = $('assistant-feedback');
  if(!panel.hidden){
    panel.hidden = true;
    panel.replaceChildren();
    if(btn)btn.setAttribute('aria-expanded', 'false');
    return;
  }
  const snap = assistantActiveFeedback();
  panel.replaceChildren(build(snap.out, snap.context));
  panel.hidden = false;
  if(btn)btn.setAttribute('aria-expanded', 'true');
}

async function assistantCopyText(text, okToast){
  const payload = String(text || '');
  const ok = okToast || 'copied';
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(payload);
      if(typeof showToast === 'function')showToast(ok);
      return;
    }
  }catch(_){}
  const ta = document.createElement('textarea');
  ta.value = payload;
  ta.setAttribute('readonly','');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand('copy'); if(typeof showToast === 'function')showToast(ok); }
  catch(_){ if(typeof showToast === 'function')showToast('could not copy'); }
  ta.remove();
}

async function assistantCopyDebug(text){
  return assistantCopyText(text, 'debug copied');
}

function assistantPreviewBody(text){
  const parts = String(text || '').split(' · ').map(part => part.trim()).filter(Boolean);
  const name = parts.shift() || text || '';
  const chips = parts.map(part => `<span class="assistant-chip">${escapeHtml(part)}</span>`).join('');
  return `<p class="assistant-preview-name">${escapeHtml(name)}</p>${chips ? `<div class="assistant-chip-row">${chips}</div>` : ''}`;
}

function assistantBatchKicker(drafts){
  const items = (drafts || []).filter(row => row.kind === 'habit' || row.kind === 'task').length;
  const places = (drafts || []).filter(row => row.kind === 'location').length;
  const settingsCount = (drafts || []).filter(row => row.kind === 'weather' || row.kind === 'busy' || row.kind === 'topic').length;
  const bits = [];
  if(items)bits.push(`${items} ${items === 1 ? 'item' : 'items'}`);
  if(places)bits.push(`${places} placeholder ${places === 1 ? 'place' : 'places'}`);
  if(settingsCount)bits.push(`${settingsCount} ${settingsCount === 1 ? 'setting' : 'settings'}`);
  return bits.join(', ') || `${(drafts || []).length} drafts`;
}

function appendAssistantBubble(kind, text, extra){
  const thread = assistantThreadEl();
  if(!thread)return;
  const div = document.createElement('div');
  div.className = `assistant-bubble assistant-bubble-${kind}`;
  const think = assistantShowThink(kind) ? assistantThinkHtml(extra && extra.thinking) : '';
  if(kind === 'preview'){
    const setting = extra && extra.setting;
    const drafts = Array.isArray(extra && extra.drafts) ? extra.drafts.filter(row => row && row.name) : [];
    const batch = drafts.length > 1;
    const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (typeof sortSettings !== 'undefined' ? sortSettings : {});
    const body = batch
      ? `<p class="assistant-preview-kicker">${escapeHtml(assistantBatchKicker(drafts))}</p><div class="assistant-preview-list">${drafts.map(row => assistantPreviewBody(typeof assistantDraftSummary === 'function' ? assistantDraftSummary(row, settings) : row.name)).join('')}</div>`
      : assistantPreviewBody(text);
    div.innerHTML = `${think}${body}
      <div class="btn-row assistant-preview-actions">
        <button type="button" class="btn primary" data-assistant-act="add">${batch ? 'save all' : 'save'}</button>
        ${setting || batch ? '' : '<button type="button" class="btn" data-assistant-act="edit">edit</button>'}
        <button type="button" class="btn" data-assistant-act="discard">never mind</button>
      </div>`;
  }else if(kind === 'complete'){
    const undo = extra && extra.action === 'undo_today';
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>
      <div class="btn-row assistant-preview-actions">
        <button type="button" class="btn primary" data-assistant-act="log">${undo ? 'mark not done' : 'log it'}</button>
        <button type="button" class="btn" data-assistant-act="discard">never mind</button>
      </div>`;
  }else if(kind === 'plan'){
    const remove = extra && extra.action === 'remove';
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>
      <div class="btn-row assistant-preview-actions">
        <button type="button" class="btn primary" data-assistant-act="plan">${remove ? 'remove plan' : 'plan it'}</button>
        <button type="button" class="btn" data-assistant-act="discard">never mind</button>
      </div>`;
  }else if(kind === 'delete'){
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>
      <div class="btn-row assistant-preview-actions">
        <button type="button" class="btn danger-soft" data-assistant-act="remove">remove</button>
        <button type="button" class="btn" data-assistant-act="discard">keep it</button>
      </div>`;
  }else if(kind === 'apply'){
    const drafts = Array.isArray(extra && extra.drafts) ? extra.drafts.filter(row => row && row.name) : [];
    const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (typeof sortSettings !== 'undefined' ? sortSettings : {});
    const list = drafts.length
      ? `<div class="assistant-preview-list">${drafts.map(row => assistantPreviewBody(typeof assistantDraftSummary === 'function' ? assistantDraftSummary(row, settings) : row.name)).join('')}</div>`
      : '';
    const deleteText = extra && extra.deleteText ? `<p>${escapeHtml(extra.deleteText)}</p>` : '';
    div.innerHTML = `${think}${list}${deleteText}
      <div class="btn-row assistant-preview-actions">
        ${drafts.length ? '<button type="button" class="btn primary" data-assistant-act="add">save changes</button>' : ''}
        ${deleteText ? '<button type="button" class="btn danger-soft" data-assistant-act="remove">remove</button>' : ''}
        <button type="button" class="btn" data-assistant-act="discard">never mind</button>
      </div>`;
  }else if(kind === 'actions'){
    const actions = Array.isArray(extra && extra.actions) ? extra.actions : [];
    const rows = actions.map((action, index) => {
      const pending = action && action.pending || {};
      const undo = action && action.kind === 'complete' && pending.action === 'undo_today';
      const removePlan = action && action.kind === 'plan' && pending.action === 'remove';
      const label = action && action.kind === 'complete' ? (undo ? 'mark not done' : 'log it')
        : action && action.kind === 'plan' ? (removePlan ? 'remove plan' : 'plan it')
        : 'remove';
      const buttonClass = action && action.kind === 'delete' ? 'btn danger-soft' : 'btn primary';
      return `<div class="assistant-action-row" data-assistant-action-row="${index}">
        <p>${escapeHtml(action && action.summary || '')}</p>
        <div class="btn-row assistant-preview-actions">
          <button type="button" class="${buttonClass}" data-assistant-act="compound" data-assistant-action-index="${index}">${label}</button>
          <button type="button" class="btn" data-assistant-act="discard-action" data-assistant-action-index="${index}">never mind</button>
        </div>
      </div>`;
    }).join('');
    div.innerHTML = `${think}${rows}`;
  }else if(kind === 'ask'){
    const choices = [...new Set((extra && extra.choices || []).map(choice=>String(choice).trim()).filter(Boolean))].slice(0,4).map(choice =>
      `<button type="button" class="btn" data-assistant-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`
    ).join('');
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>${choices ? `<div class="btn-row assistant-choices">${choices}</div>` : ''}`;
  }else if(kind === 'debug'){
    assistantFillDebugBubble(div, extra && extra.debug, extra);
  }else if(kind === 'user'){
    div.innerHTML = assistantUserMessageHtml(text);
  }else{
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>`;
  }
  if(kind === 'actions'){
    div.querySelectorAll('[data-assistant-action-index]').forEach(button=>{
      _assistantActionButtons.set(button,extra.actions[Number(button.dataset.assistantActionIndex)]);
    });
  }
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return div;
}

function renderAssistantThread(){
  const thread = assistantThreadEl();
  if(!thread)return;
  if(!thread.childElementCount)thread.innerHTML = assistantWelcomeHtml();
}

function assistantComposerValue(){
  return String($('assistant-input')?.value || '').trim() || assistantMentionName();
}

function assistantMentionName(){
  const mention = $('assistant-mention');
  if(!mention || mention.hidden)return '';
  return String($('assistant-mention-label')?.textContent || '').trim();
}

function assistantSetMention(label){
  const mention = $('assistant-mention');
  const text = $('assistant-mention-label');
  const remove = $('assistant-mention-remove');
  const field = $('assistant-field');
  const name = String(label || '').trim();
  if(text)text.textContent = name;
  if(mention){
    mention.hidden = !name;
    if(name)mention.setAttribute('aria-label', name);
    else mention.removeAttribute('aria-label');
  }
  if(field)field.classList.toggle('has-mention', Boolean(name));
  if(remove){
    remove.disabled = Boolean(_assistantBusy);
    remove.setAttribute('aria-label', name ? `Remove ${name}` : 'Remove setting');
  }
}

// A typed "Label: value" is the wire form. The label renders as a tag, and
// only the value stays in the text box. Catalog matching is expensive, so a
// value with no separator, or a separator head already known not to be a
// setting, never enters it.
let assistantGuidePrefixMiss = '';
function assistantGuideSeparated(text, session){
  const raw = String(text || '');
  if(!session || typeof assistantGuideParse !== 'function' || typeof assistantGuidePattern !== 'function')return null;
  const cut = raw.search(/[:\-–—]/);
  if(cut < 0)return null;
  const head = raw.slice(0, cut).trim().toLowerCase();
  if(!head || head.length > 48 || head === assistantGuidePrefixMiss)return null;
  const parsed = assistantGuideParse(raw, session);
  if(!parsed || !new RegExp(`^\\s*${assistantGuidePattern(parsed.label)}\\s*[:\\-–—]\\s*`,'i').test(raw)){
    assistantGuidePrefixMiss = head;
    return null;
  }
  assistantGuidePrefixMiss = '';
  return parsed;
}

function assistantComposerDraft(){
  const rest = String($('assistant-input')?.value || '');
  const session = _assistantSession && _assistantSession.focus;
  if(assistantGuideSeparated(rest, session))return rest.trim();
  const label = assistantMentionName();
  if(!label)return rest;
  const detail = rest.trim();
  return detail ? `${label}: ${detail}` : `${label}: `;
}

function assistantAbsorbGuidePrefix(){
  const input = $('assistant-input');
  const session = _assistantSession && _assistantSession.focus;
  if(!input || !session || typeof assistantFocusAlive !== 'function' || !assistantFocusAlive(session))return;
  const parsed = assistantGuideSeparated(input.value, session);
  if(!parsed)return;
  assistantSetMention(parsed.label);
  input.value = parsed.rest;
}

function assistantPresentComposer(text){
  const input = $('assistant-input');
  if(!input)return;
  assistantSetMention('');
  input.value = text == null ? '' : String(text);
  assistantAbsorbGuidePrefix();
  if(assistantMentionName())return;
  const session = _assistantSession && _assistantSession.focus;
  const parsed = session && typeof assistantGuideParse === 'function' ? assistantGuideParse(input.value, session) : null;
  if(parsed && !parsed.rest && parsed.label.toLowerCase() === input.value.trim().toLowerCase()){
    assistantSetMention(parsed.label);
    input.value = '';
  }
}

function assistantUserMessageHtml(text){
  const session = _assistantSession && _assistantSession.focus;
  const parsed = session && typeof assistantGuideParse === 'function' ? assistantGuideParse(text, session) : null;
  if(!parsed)return `<p>${escapeHtml(text)}</p>`;
  const tag = `<span class="assistant-mention assistant-mention-static"><span class="assistant-mention-label">${escapeHtml(parsed.label)}</span></span>`;
  if(!parsed.rest)return `<p class="assistant-user-line">${tag}</p>`;
  return `<p class="assistant-user-line">${tag} <span class="assistant-user-detail">${escapeHtml(parsed.rest)}</span></p>`;
}

const ASSISTANT_GUIDE_PLACEHOLDER = 'Describe the change';

function assistantGuideHintText(session, active, revising){
  if(active && typeof assistantGuideHelp === 'function'){
    const detail = assistantGuideHelp(active.id);
    return `${detail.description}${detail.example ? ` Example: ${detail.example}.` : ''}`;
  }
  if(revising)return 'Last change undone. Edit it and send.';
  if(session.continuationError)return 'Draft kept. Continue above, or fix the last request.';
  if(session.unresolved?.some(item => item.field === 'guidance'))return 'Choose the field or action that matches.';
  if(session.unresolved?.length)return 'Pick the setting you meant, then add its value.';
  return '';
}

function assistantGuideSearchWrap(){
  return $('assistant-guide-search')?.closest('.assistant-guide-search') || null;
}

function assistantSyncGuideSearchClear(){
  const clear = $('assistant-guide-clear');
  if(clear)clear.hidden = !String($('assistant-guide-search')?.value || '').length;
}

let assistantGuideRenderTimer = 0;
function assistantScheduleGuideRender(){
  clearTimeout(assistantGuideRenderTimer);
  assistantGuideRenderTimer = setTimeout(() => {
    assistantGuideRenderTimer = 0;
    assistantRenderGuides();
  }, 80);
}

function assistantRenderGuides(){
  if(assistantGuideRenderTimer){
    clearTimeout(assistantGuideRenderTimer);
    assistantGuideRenderTimer = 0;
  }
  const row = $('assistant-guides');
  const list = $('assistant-guides-row');
  const input = $('assistant-input');
  if(!row || !list)return;
  const session = _assistantSession && _assistantSession.focus;
  const alive = typeof assistantSettings === 'function' && assistantSettings().provider === 'needle'
    && session && typeof assistantFocusAlive === 'function' && assistantFocusAlive(session)
    && !row.closest('.assistant-compose')?.hidden
    && typeof assistantGuideSuggestions === 'function';
  if(!alive){
    row.hidden = true;
    list.replaceChildren();
    delete row.dataset.guideSignature;
    delete row.dataset.guideSession;
    assistantToggleGuideBrowser(false);
    if(assistantMentionName() && input){
      const draft = assistantComposerDraft().trim();
      input.value = draft.endsWith(':') ? draft.slice(0, -1).trim() : draft;
    }
    assistantSetMention('');
    if(input){
      input.placeholder = 'Remind me, paste a schedule, or change it';
      input.removeAttribute('aria-describedby');
    }
    return;
  }
  const typed = assistantComposerDraft();
  if(row.dataset.guideSession!==session.id){
    row.dataset.guideSession=session.id;
    delete row.dataset.guideRevising;
    assistantToggleGuideBrowser(false);
    if($('assistant-guide-search'))$('assistant-guide-search').value='';
  }
  const hint = typed.trim() || String(session.currentRequest || (session.requests || []).at(-1) || '');
  const active = assistantGuideRead(typed, session, true);
  const hintText = assistantGuideHintText(session, active, row.dataset.guideRevising === 'true');
  if(input){
    input.placeholder = active ? (active.rest ? 'Edit this, then send' : 'Add details, or send') : ASSISTANT_GUIDE_PLACEHOLDER;
    if(hintText)input.setAttribute('aria-describedby', 'assistant-guide-hint');
    else input.removeAttribute('aria-describedby');
  }
  const label=$('assistant-guides-label'),help=$('assistant-guide-hint');
  if(help){
    help.hidden=!hintText;
    help.textContent=hintText;
  }
  const revise=$('assistant-guide-revise');
  if(revise){
    revise.hidden=!assistantGuideCanRevise(session);
    revise.disabled=Boolean(_assistantBusy||typed.trim());
    revise.title=typed.trim()?'Clear the message first.':'Undo the last unsaved change and edit it.';
  }
  if($('assistant-guide-more'))$('assistant-guide-more').disabled=Boolean(_assistantBusy);
  if($('assistant-guide-search'))$('assistant-guide-search').disabled=Boolean(_assistantBusy);
  if($('assistant-guide-clear'))$('assistant-guide-clear').disabled=Boolean(_assistantBusy);
  assistantRenderGuideBrowser();
  const suggestions = assistantGuideSuggestions(session, hint);
  const choosing = suggestions.some(item => /^(?:action|field):/.test(item.id));
  if(label)label.textContent=active?'Change this setting':choosing?'Which one':session.unresolved?.length?'Which setting':'Settings';
  const signature = `${suggestions.map(item => item.id).join(',')}|${active ? active.id : ''}|${_assistantBusy ? 1 : 0}`;
  row.hidden = suggestions.length === 0;
  if(row.dataset.guideSignature === signature)return;
  row.dataset.guideSignature = signature;
  list.replaceChildren();
  for(const item of suggestions){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'assistant-guide';
    button.dataset.assistantGuide = item.id;
    button.textContent = item.label;
    button.title = /^(?:action|field):/.test(item.id) ? item.label : assistantGuideHelp(item.id).description;
    button.setAttribute('aria-pressed', active && active.id === item.id ? 'true' : 'false');
    button.disabled = Boolean(_assistantBusy);
    list.append(button);
  }
}

function assistantToggleGuideBrowser(open){
  const browser=$('assistant-guide-browser'),button=$('assistant-guide-more'),guides=$('assistant-guides');
  const search=assistantGuideSearchWrap();
  if(browser)browser.hidden=!open;
  if(search)search.hidden=!open;
  if(guides)guides.classList.toggle('is-browsing', Boolean(open));
  if(button){
    button.setAttribute('aria-expanded',String(Boolean(open)));
    button.setAttribute('aria-label', open?'Close settings':'All settings');
    const label=button.querySelector('.assistant-guide-more-label');
    if(label)label.textContent=open?'Close':'All settings';
  }
  if(!open){
    if(guides)guides.scrollTop=0;
    const input=$('assistant-guide-search');
    if(input)input.value='';
    assistantSyncGuideSearchClear();
  }
}

function assistantRenderGuideBrowser(){
  const browser=$('assistant-guide-browser'),results=$('assistant-guide-results');
  const session=_assistantSession?.focus;
  if(!browser||browser.hidden||!results||!session)return;
  const rows=assistantGuideBrowse(session,$('assistant-guide-search')?.value);
  const signature=`${session.id}|${rows.map(row=>row.id).join(',')}|${Boolean(_assistantBusy)}`;
  if(results.dataset.signature===signature)return;
  results.dataset.signature=signature;
  results.replaceChildren();
  for(const def of rows){
    const button=document.createElement('button');button.type='button';button.className='assistant-guide';
    button.dataset.assistantGuide=def.id;button.dataset.guideLabel=def.label;button.disabled=Boolean(_assistantBusy);
    const title=document.createElement('span');title.textContent=def.label;
    const detail=document.createElement('span');detail.className='assistant-guide-description';
    detail.textContent=assistantGuideHelp(def.id).description;
    button.append(title,detail);results.append(button);
  }
  if(!rows.length){
    const empty=document.createElement('p');empty.className='assistant-guide-empty';
    empty.textContent='No matching setting.';results.append(empty);
  }
}

function assistantApplyGuide(label){
  const input = $('assistant-input');
  const session = _assistantSession && _assistantSession.focus;
  if(!input || input.disabled || _assistantBusy || !session || !assistantFocusAlive(session) || typeof assistantGuideCompose !== 'function')return;
  assistantToggleGuideBrowser(false);
  assistantPresentComposer(assistantGuideCompose(assistantComposerDraft(), label, session));
  const end = input.value.length;
  input.focus({preventScroll:true});
  try{ input.setSelectionRange(end, end); }catch(_){}
  assistantResizeComposer();
  assistantSyncSend();
  assistantRenderGuides();
  setTimeout(() => {
    if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
  }, 260);
}

function assistantResizeComposer(){
  const input = $('assistant-input');
  if(!input)return;
  if(typeof ASSISTANT_INPUT_MAX === 'number')input.maxLength = ASSISTANT_INPUT_MAX;
  const guided = $('assistant-guides') && !$('assistant-guides').hidden;
  const max = guided ? 88 : 160;
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), max)}px`;
}

function assistantSyncSend(){
  const send = $('assistant-send');
  if(send)send.disabled = _assistantBusy || !assistantComposerValue() || !assistantNeedleCanSend();
}

function assistantShowBusy(on){
  _assistantBusy = on;
  const input = $('assistant-input');
  if(input)input.disabled = on;
  const mentionRemove = $('assistant-mention-remove');
  if(mentionRemove)mentionRemove.disabled = on;
  assistantSyncSend();
  syncAssistantNeedleControls();
  document.querySelectorAll('#assistant-thread .assistant-suggest').forEach(btn => {
    btn.disabled=on || (btn.hasAttribute('data-assistant-proposal') && btn._assistantProposal !== _assistantSession?.needleProposal);
  });
  document.querySelectorAll('#assistant-thread [data-assistant-choice]').forEach(btn => {
    btn.disabled=on || btn.closest('.assistant-bubble') !== assistantThreadEl()?.lastElementChild;
  });
  assistantRenderGuides();
  const wait = $('assistant-waiting');
  if(wait){
    wait.hidden = !on;
    if(on && !wait.textContent.trim())wait.textContent = 'thinking…';
  }
}

async function handleAssistantOutcome(out, feedbackContext){
  if(!out)return;
  await renderAssistantOutcome(out, feedbackContext);
  assistantAppendFeedback(out, feedbackContext);
  assistantRefreshFeedbackPanel();
}

async function renderAssistantOutcome(out, feedbackContext){
  if(!out)return;
  assistantThreadEl()?.querySelectorAll('.assistant-preview-actions button').forEach(button=>{button.disabled=true;});
  if(out.draft)_assistantPendingDraft = out.draft;
  _assistantPendingDrafts = Array.isArray(out.drafts) && out.drafts.length
    ? out.drafts
    : (out.draft ? [out.draft] : null);
  if(out.session)_assistantSession = out.session;
  if(out.draft && _assistantSession && !_assistantSession.draft)_assistantSession.draft = out.draft;
  if(_assistantPendingDrafts && _assistantSession && !_assistantSession.drafts)_assistantSession.drafts = _assistantPendingDrafts;
  syncAssistantFocusBar();
  assistantThreadEl()?.querySelectorAll('[data-assistant-choice], [data-assistant-proposal], [data-assistant-action]').forEach(button=>{button.disabled=true;});
  const live = assistantThreadEl()?.querySelector('.assistant-bubble-debug.is-live');
  if(live && out.debug){
    assistantFillDebugBubble(live, out.debug, {debugText:out.debugText, debugJson:assistantDebugPayload(out.debug)});
    live.classList.remove('is-live');
  }else if(assistantDebugOn() && out.debug && out.debug.length){
    appendAssistantBubble('debug', '', {debug:out.debug, debugText:out.debugText, debugJson:assistantDebugPayload(out.debug)});
  }
  for(const destination of out.navigation || []){
    const bubble=appendAssistantBubble('say','Open '+destination.label+' to continue.');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='open '+destination.label;
    button.addEventListener('click',()=>{
      closeAssistantSheet();openSettingsSheet();
      const section=document.getElementById(destination.section);
      if(!section)return;
      section.hidden=false;
      document.querySelector(`[aria-controls="${destination.section}"]`)?.setAttribute('aria-expanded','true');
      section.scrollIntoView({block:'center'});
    });
    bubble?.append(button);
  }
  if(out.alsoText){
    appendAssistantBubble('say', out.alsoText, {thinking:out.thinking});
  }
  if(out.type === 'preview'){
    const drafts = Array.isArray(out.drafts) ? out.drafts : (out.draft ? [out.draft] : []);
    const batch = drafts.length > 1;
    const setting = !batch && out.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(out.draft.kind);
    const places = drafts.filter(row => row && row.kind === 'location').length;
    const updating = Boolean(out.updating);
    appendAssistantBubble('say', batch
      ? (updating
        ? 'Check these changes, then save all.'
        : (places
          ? 'Check these, then save all. Placeholder places use dummy addresses — set the real ones in Settings → locations.'
          : 'Check these, then save all.'))
      : (setting ? 'Check this, then save.' : 'Check this, then save. Edit opens the full form.'), {thinking:out.thinking});
    appendAssistantBubble('preview', out.summary || (out.draft && out.draft.name) || 'drafts', {thinking:out.thinking, setting, drafts});
    if(out.actions?.length)appendAssistantBubble('actions','Confirm these actions.',{actions:out.actions});
    return;
  }
  if(out.type === 'complete'){
    if(out.alreadyDone){
      appendAssistantBubble('say', out.text || 'Already logged today.', {thinking:out.thinking});
      return;
    }
    appendAssistantBubble('complete', out.text || 'Log it as done?', {thinking:out.thinking, action:out.completeAction});
    return;
  }
  if(out.type === 'plan'){
    appendAssistantBubble('plan', out.text || 'Plan this item?', {thinking:out.thinking, action:out.planAction});
    return;
  }
  if(out.type === 'delete'){
    appendAssistantBubble('delete', out.text || 'Remove this item?', {thinking:out.thinking});
    return;
  }
  if(out.type === 'apply'){
    appendAssistantBubble('say', 'Check these, then confirm.', {thinking:out.thinking});
    appendAssistantBubble('apply', out.summary || '', {
      thinking:out.thinking,
      drafts:out.drafts,
      deleteText:out.deleteText
    });
    return;
  }
  if(out.type === 'actions'){
    appendAssistantBubble('actions', out.text || 'Confirm these actions.', {thinking:out.thinking, actions:out.actions});
    return;
  }
  if(out.type === 'ask'){
    const bubble=appendAssistantBubble('ask', out.question, {choices:out.choices, thinking:out.thinking});
    if(out.proposal){
      const button=document.createElement('button');button.type='button';button.className='btn assistant-suggest';
      button.textContent='use this interpretation';button.dataset.assistantProposal='true';button._assistantProposal=out.proposal;
      button.addEventListener('click',()=>{
        if(_assistantBusy || _assistantSession?.needleProposal !== out.proposal)return;
        _assistantSession.needleApproved=out.proposal;
        button.disabled=true;
        void sendAssistantMessage(out.proposal.request,{displayText:'Use this interpretation'});
      });
      bubble?.append(button);
    }
    assistantAppendActionChoice(bubble,out,feedbackContext?.request);
    return;
  }
  if(out.type === 'today' || out.type === 'say'){
    appendAssistantBubble('say', out.text, {thinking:out.thinking});
    return;
  }
  const failure=appendAssistantBubble('say', out.text || 'Something went wrong.', {thinking:out.thinking});
  if(out.type === 'error' && out.unfinished?.length){
    const retry=document.createElement('button');retry.type='button';retry.className='btn assistant-suggest';retry.textContent='retry unfinished part';
    retry.dataset.assistantSuggest=out.unfinished[0];failure?.append(retry);
  }
}

async function sendAssistantMessage(text, opts){
  opts = opts || {};
  const typed = String(text || '').trim();
  let value = typed;
  const guideSession = _assistantSession && _assistantSession.focus;
  if(guideSession && typeof assistantGuideOutgoing === 'function')value = assistantGuideOutgoing(typed, guideSession);
  if(!value || _assistantBusy)return;
  if(!assistantNeedleCanSend()){
    assistantPresentComposer(text == null ? value : String(text));
    assistantResizeComposer();
    if(typeof showToast === 'function')showToast('Download Needle 3 to use the assistant');
    return;
  }
  const turn = ++_assistantTurn;
  assistantThreadEl()?.querySelectorAll('.assistant-preview-actions button, [data-assistant-choice], [data-assistant-proposal], [data-assistant-action]').forEach(button=>{button.disabled=true;});
  appendAssistantBubble('user', opts.displayText || value);
  if($('assistant-guides'))delete $('assistant-guides').dataset.guideRevising;
  assistantPresentComposer('');
  assistantResizeComposer();
  assistantSyncSend();
  assistantShowBusy(true);
  if(assistantSettings().provider === 'needle' && !opts.needleAction){
    const focus = _assistantSession && _assistantSession.focus;
    if(!focus || typeof assistantFocusAlive !== 'function' || !assistantFocusAlive(focus) || typeof assistantFocusTurn !== 'function'){
      appendAssistantBubble('say', 'Needle changes one item at a time. Open an item and use its search box or Edit with AI on a card.');
      assistantShowBusy(false);
      return;
    }
    // Keep the one summary under the latest message. The turn repaints it.
    assistantShowFocusReview(focus);
    try{
      const out = await assistantFocusTurn(focus, value, {
        onProgress:info => assistantNoteFocusProgress(focus, info, turn)
      });
      if(turn !== _assistantTurn || (out && out.cancelled))return;
      assistantShowFocusReview(focus);
    }catch(err){
      if(turn !== _assistantTurn || (err && err.name === 'AbortError'))return;
      if(focus){
        focus.trace = focus.trace || [];
        focus.trace.push({family:'turn', error:String(err && (err.stack || err.message) || err)});
      }
      appendAssistantBubble('say', err && err.message ? err.message : 'Needle could not read that.');
      assistantPresentDebug();
      assistantRefreshFeedbackPanel();
    }finally{
      if(turn === _assistantTurn)assistantShowBusy(false);
    }
    return;
  }
  try{
    const out = await runAssistantTurn(value, {
      session:_assistantSession || assistantCreateSession(),
      startIntent:opts.startIntent || undefined,
      entry:opts.entry || _assistantSession?.entry || undefined,
      form:opts.form || undefined,
      needleAction:opts.needleAction || undefined,
      onProgress:info => {
        if(turn !== _assistantTurn)return;
        const wait = $('assistant-waiting');
        if(!wait)return;
        if(info && info.phase === 'think')wait.textContent = info.step ? `thinking (${info.step})…` : 'thinking…';
        else wait.textContent = 'working…';
      },
      onDebug:(events, row) => {
        if(turn !== _assistantTurn)return;
        assistantRenderLiveDebug(events);
        const wait = $('assistant-waiting');
        if(wait && row && row.t){
          if(row.t === 'path')wait.textContent = `${row.path || 'path'} · ${row.via || ''}`.trim();
          else if(row.t === 'tool')wait.textContent = `call ${row.name}`;
          else if(row.t === 'model')wait.textContent = `model ${row.step || ''}`.trim();
          else if(row.t === 'step')wait.textContent = `thinking (${row.step})…`;
        }
      }
    });
    if(turn !== _assistantTurn)return;
    await handleAssistantOutcome(out, {request:value});
  }catch(err){
    if(turn !== _assistantTurn)return;
    await handleAssistantOutcome({type:'error', text:assistantFriendlyError(err),
      diagnosticError:String(err.stack || err.message || err), session:_assistantSession}, {request:value});
  }finally{
    if(turn === _assistantTurn)assistantShowBusy(false);
  }
}

function assistantMarkLastActionSpent(kind){
  const thread = assistantThreadEl();
  if(!thread)return;
  const bubbles = thread.querySelectorAll(`.assistant-bubble-${kind}`);
  const last = bubbles[bubbles.length - 1];
  if(!last)return;
  last.querySelector('.assistant-preview-actions')?.remove();
  last.classList.add('is-saved');
}

function assistantKeepWorkingOn(commit){
  if(!_assistantSession)_assistantSession = typeof assistantCreateSession === 'function' ? assistantCreateSession() : {};
  _assistantSession.pendingComplete = null;
  _assistantSession.pendingPlan = null;
  _assistantSession.pendingDelete = null;
  _assistantSession.pendingActions = [];
  _assistantSession.awaiting = null;
  _assistantSession.messages = [];
  _assistantSession.drafts = null;
  _assistantSession.turnDrafts = null;
  _assistantSession._focusOnly = true;
  if(commit && commit.habit && typeof assistantHabitToDraft === 'function'){
    const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (typeof sortSettings !== 'undefined' ? sortSettings : {});
    _assistantSession.draft = assistantHabitToDraft(commit.habit, commit.index, settings);
  }else if(commit && commit.draft && commit.draft.name){
    _assistantSession.draft = commit.draft;
  }else if(_assistantPendingDraft && _assistantPendingDraft.name){
    _assistantSession.draft = _assistantPendingDraft;
  }
  _assistantPendingDraft = _assistantSession.draft;
  syncAssistantFocusBar();
}

function assistantReleaseAddEntry(){
  if(!_assistantSession || _assistantSession.entry !== 'add')return;
  const sheet = $('add-sheet');
  if(!sheet || !sheet.classList.contains('open'))return;
  if(typeof cancelAdd === 'function')cancelAdd();
}

function assistantAfterSave(commit, openForm, toast){
  assistantReleaseAddEntry();
  const actions=_assistantSession?.pendingActions || [];
  assistantKeepWorkingOn(commit);
  _assistantSession.pendingActions=actions;
  if(typeof render === 'function')render();
  if(openForm && typeof openDetailSchedule === 'function' && commit && commit.index != null){
    closeAssistantSheet();
    openDetailSchedule(commit.index);
    return;
  }
  const batchCount = commit && commit.count > 1 ? commit.count : 0;
  if(batchCount){
    const places = commit.places || 0;
    const items = commit.items || batchCount;
    const placeNote = places
      ? ` ${places} placeholder ${places === 1 ? 'place' : 'places'} — set the real addresses in Settings → locations.`
      : '';
    appendAssistantBubble('say', `Saved ${items} ${items === 1 ? 'item' : 'items'}.${placeNote}`);
    assistantClearFocus();
    _assistantSession.pendingActions=actions;
    if(typeof showToast === 'function')showToast(toast || 'saved');
    return;
  }
  const name = (commit && (commit.habit && commit.habit.name || commit.name))
    || (_assistantSession && _assistantSession.draft && _assistantSession.draft.name)
    || 'it';
  appendAssistantBubble('say', `Saved. Still working on ${name}. Say what to change, or tap done.`);
  if(typeof showToast === 'function')showToast(toast || 'saved');
}

async function assistantFillLocationDraft(draft){
  if(!draft || draft.kind !== 'location')return {ok:true, draft};
  if(Number.isFinite(Number(draft.lat)) && Number.isFinite(Number(draft.lng)))return {ok:true, draft};
  const query = String(draft.address || draft.name || '').trim();
  if(!query || typeof geocodeSearch !== 'function'){
    return {ok:false, error:'I need an address or coordinates to pin that place.'};
  }
  const hits = await geocodeSearch(query, {limit:5});
  if(hits.status === 'unavailable'){
    return {ok:false, error:'Search is unavailable right now. Try a fuller address or coordinates.'};
  }
  if(!hits.length)return {ok:false, error:'No places matched that address. Try a fuller address or coordinates.'};
  if(hits.length === 1){
    draft.lat = hits[0].lat;
    draft.lng = hits[0].lng;
    if(!draft.address)draft.address = hits[0].address || '';
    if(hits[0].name && assistantNormText(draft.name) === 'place')draft.name = hits[0].name;
    return {ok:true, draft};
  }
  if(!_assistantSession)_assistantSession = typeof assistantCreateSession === 'function' ? assistantCreateSession() : {};
  _assistantSession.awaiting = 'location-pick';
  _assistantSession.locationHits = hits;
  _assistantSession.draft = draft;
  appendAssistantBubble('ask', 'Which place is that?', {
    choices:hits.map(hit => hit.address || hit.name)
  });
  return {ok:false, waiting:true};
}

async function commitAssistantDraft(openForm){
  const drafts = assistantPendingDrafts();
  if(!drafts.length){
    if(typeof showToast === 'function')showToast('nothing to save');
    return;
  }
  try{
    if(drafts.length > 1){
      const result = typeof assistantCommitDrafts === 'function'
        ? assistantCommitDrafts(drafts)
        : {ok:false, error:'save unavailable'};
      if(!result.ok){
        if(typeof showToast === 'function')showToast(result.error || 'could not save');
        return;
      }
      assistantMarkLastActionSpent('preview');
      assistantAfterSave(result, false, 'saved');
      return;
    }
    const filled = await assistantFillLocationDraft(drafts[0]);
    if(filled.waiting)return;
    if(!filled.ok){
      if(typeof showToast === 'function')showToast(filled.error || 'could not save');
      return;
    }
    const result = assistantCommitDraft(filled.draft || drafts[0]);
    if(!result.ok){
      if(typeof showToast === 'function')showToast(result.error || 'could not save');
      return;
    }
    assistantMarkLastActionSpent('preview');
    assistantAfterSave(result, openForm, result.updated ? 'updated' : 'saved');
  }catch(err){
    if(typeof showToast === 'function')showToast(String(err && err.message || err) || 'could not save');
  }
}

function commitAssistantComplete(){
  const pending = _assistantSession && _assistantSession.pendingComplete;
  if(!pending){
    if(typeof showToast === 'function')showToast('nothing to log');
    return;
  }
  const result = assistantCommitComplete(pending);
  if(!result.ok){
    if(typeof showToast === 'function')showToast(result.error || 'could not log');
    return;
  }
  assistantMarkLastActionSpent('complete');
  assistantKeepWorkingOn(result);
  if(typeof render === 'function')render();
  appendAssistantBubble('say', result.action === 'undo_today'
    ? `Marked ${result.name} not done. You can restore it from the toast.`
    : `Logged ${result.name}. You can undo from the toast.`);
}

function commitAssistantPlan(){
  const pending = _assistantSession && _assistantSession.pendingPlan;
  if(!pending){
    if(typeof showToast === 'function')showToast('nothing to plan');
    return;
  }
  const result = typeof assistantCommitPlan === 'function'
    ? assistantCommitPlan(pending)
    : {ok:false, error:'planning unavailable'};
  if(!result.ok){
    if(typeof showToast === 'function')showToast(result.error || 'could not plan');
    return;
  }
  _assistantSession.pendingPlan = null;
  assistantMarkLastActionSpent('plan');
  assistantKeepWorkingOn(result);
  appendAssistantBubble('say', result.action === 'remove'
    ? `Removed ${result.name}'s one-day plan. You can undo from the toast.`
    : `Planned ${result.name}. You can undo from the toast.`);
}

function commitAssistantDelete(){
  const pending = _assistantSession && _assistantSession.pendingDelete;
  if(!pending){
    if(typeof showToast === 'function')showToast('nothing to remove');
    return;
  }
  const result = typeof assistantCommitDelete === 'function'
    ? assistantCommitDelete(pending)
    : {ok:false, error:'remove unavailable'};
  if(!result.ok){
    if(typeof showToast === 'function')showToast(result.error || 'could not remove');
    return;
  }
  _assistantSession.pendingDelete = null;
  assistantMarkLastActionSpent('delete');
  assistantClearFocus();
  appendAssistantBubble('say', result.count > 1
    ? `Removed ${result.count} items. You can undo from the toast.`
    : `Removed ${result.name}. You can undo from the toast.`);
}

function commitAssistantCompoundAction(index, button){
  const actions = _assistantSession && _assistantSession.pendingActions;
  const action = Array.isArray(actions) ? actions[index] : null;
  if(!action || !action.pending || (button && _assistantActionButtons.get(button) !== action)){
    if(typeof showToast === 'function')showToast('that action is no longer pending');
    return;
  }
  const result = action.kind === 'complete' && typeof assistantCommitComplete === 'function'
    ? assistantCommitComplete(action.pending)
    : action.kind === 'plan' && typeof assistantCommitPlan === 'function'
      ? assistantCommitPlan(action.pending)
      : action.kind === 'delete' && typeof assistantCommitDelete === 'function'
        ? assistantCommitDelete(action.pending)
        : {ok:false, error:'action unavailable'};
  if(!result.ok){
    if(typeof showToast === 'function')showToast(result.error || 'could not complete action');
    return;
  }
  actions[index] = null;
  const row = button && button.closest('[data-assistant-action-row]');
  if(row){
    row.querySelector('.assistant-preview-actions')?.remove();
    row.classList.add('is-saved');
  }
  if(typeof render === 'function')render();
  const text = action.kind === 'complete'
    ? (result.action === 'undo_today' ? `Marked ${result.name} not done.` : `Logged ${result.name}.`)
    : action.kind === 'plan'
      ? (result.action === 'remove' ? `Removed ${result.name}'s one-day plan.` : `Planned ${result.name}.`)
      : `Removed ${result.name}.`;
  appendAssistantBubble('say', `${text} You can undo from the toast.`);
}

function discardAssistantCompoundAction(index, button){
  const actions = _assistantSession && _assistantSession.pendingActions;
  if(Array.isArray(actions) && (!button || _assistantActionButtons.get(button) === actions[index]))actions[index] = null;
  button && button.closest('[data-assistant-action-row]')?.remove();
}

function assistantDiscardPending(){
  const draft = assistantFocusedDraft();
  if(draft && draft.hid && typeof load === 'function' && typeof assistantHabitToDraft === 'function'){
    const data = load();
    const index = data.findIndex(item => item && item.hid === draft.hid);
    if(index >= 0){
      const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
      if(_assistantSession){
        _assistantSession.draft = assistantHabitToDraft(data[index], index, settings);
        _assistantSession.pendingComplete = null;
        _assistantSession.pendingPlan = null;
        _assistantSession.pendingDelete = null;
        _assistantSession.pendingActions = [];
      }
      _assistantPendingDraft = _assistantSession && _assistantSession.draft;
      syncAssistantFocusBar();
      return;
    }
  }
  assistantClearFocus();
}

function assistantRetireFocusControls(keepFields = false){
  const selector = '[data-focus-save],[data-focus-edit],[data-focus-choice]' + (keepFields ? '' : ',[data-focus-field]');
  assistantThreadEl()?.querySelectorAll(selector).forEach(button => {
    button.disabled = true;
  });
}

function assistantNoteFocusProgress(session, info, turn){
  if(turn !== _assistantTurn)return;
  if(info && (info.phase === 'staged' || info.phase === 'think'))assistantShowFocusReview(session, {live:true});
  const wait = $('assistant-waiting');
  if(!wait)return;
  const step = info && info.step ? String(info.step) : '';
  wait.textContent = step ? `reading ${step}` : 'reading…';
}

function assistantShowOpeningFocus(){
  if(!assistantNeedleFocusReview())return false;
  assistantShowFocusReview(_assistantSession.focus);
  return true;
}

function assistantShowFocusReview(session, opts){
  if(!session || typeof assistantFocusReviewHtml !== 'function')return;
  assistantRetireFocusControls();
  const thread = assistantThreadEl();
  const bubble = thread?.querySelector('[data-focus-card]') || document.createElement('div');
  bubble.className = 'assistant-bubble assistant-bubble-say assistant-bubble-review';
  bubble.dataset.focusCard = 'true';
  bubble.innerHTML = assistantFocusReviewHtml(session);
  if(opts && opts.live){
    bubble.dataset.focusLive = 'true';
    bubble.querySelectorAll('button,input').forEach(control => {control.disabled = true;});
  }else delete bubble.dataset.focusLive;
  if(thread){
    thread.append(bubble);
    if(!(opts && opts.live))assistantPresentDebug();
    assistantRefreshFeedbackPanel();
    thread.scrollTop = thread.scrollHeight;
  }
}

async function assistantHandleFocusClick(target){
  const session = _assistantSession && _assistantSession.focus;
  if(!session)return false;
  if(_assistantBusy || target.closest('button')?.disabled)return true;
  const field = target.closest('[data-focus-field]');
  if(field){
    const selector = assistantFocusDetailSelector(field.dataset.focusField, session);
    if(!selector || typeof assistantFocusEditDraft !== 'function')return true;
    const result = assistantFocusEditDraft(session);
    const status = field.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
    if(!result?.ok){
      if(status)status.textContent = result?.error || 'The detail editor is unavailable.';
      return true;
    }
    closeAssistantSheet();
    // Opening details can schedule its default page for the next frame. Jump
    // after that, and use the live control (event editors rebuild their DOM).
    requestAnimationFrame(() => {
      const control = getSheetInner('detail-sheet')?.querySelector(selector);
      if(control)revealDetailSearchEntry({target:control, label:assistantFocusField(field.dataset.focusField)?.label || '', revealHidden:true});
    });
    return true;
  }
  const save = target.closest('[data-focus-save]');
  if(save){
    if(save.disabled || typeof assistantFocusCommit !== 'function')return true;
    save.disabled = true;
    const result = await assistantFocusCommit(session);
    const status = save.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
    if(result && result.ok){
      if(status)status.textContent = 'Saved.';
      assistantRetireFocusControls(true);
      assistantRenderGuides();
      if(session.operation === 'create' && session.entry === 'add' && typeof cancelAdd === 'function')cancelAdd();
      return true;
    }
    if(status)status.textContent = result && result.error || 'Nothing was saved.';
    if(result && result.stale)assistantShowFocusReview(session);
    else save.disabled = typeof assistantFocusCanSave !== 'function' || !assistantFocusCanSave(session);
    return true;
  }
  const edit = target.closest('[data-focus-edit]');
  if(edit){
    if(edit.disabled || typeof assistantFocusEditDraft !== 'function')return true;
    const result = assistantFocusEditDraft(session);
    const status = edit.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
    if(result && result.ok){
      if(typeof closeAssistantSheet === 'function')closeAssistantSheet();
      return true;
    }
    if(status)status.textContent = result && result.error || 'The detail editor is unavailable.';
    return true;
  }
  const choice = target.closest('[data-focus-choice]');
  if(choice){
    const which = choice.dataset.focusChoice;
    const value = choice.dataset.focusValue || '';
    if(which === 'item-action' || which === 'item-action-skip'){
      if(which === 'item-action-skip' && typeof assistantFocusSkipAction === 'function'){
        assistantFocusSkipAction(session, value);
        assistantShowFocusReview(session);
        return true;
      }
      const result = typeof assistantFocusCommitAction === 'function'
        ? assistantFocusCommitAction(session, value)
        : {ok:false, error:'That action is unavailable.'};
      if(!result.ok){
        const status = choice.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
        if(status)status.textContent = result.error || 'Nothing was saved.';
        return true;
      }
      const text = result.action === 'remove'
        ? `Removed the plan for ${result.name}. Undo is on the toast.`
        : result.action === 'undo_today'
          ? `Marked ${result.name} not done. Undo is on the toast.`
          : result.action === 'log'
            ? `Logged ${result.name}. Undo is on the toast.`
            : `Planned ${result.name}. Undo is on the toast.`;
      appendAssistantBubble('say', text);
      assistantShowFocusReview(session);
      if(typeof render === 'function')render();
      return true;
    }
    if(which === 'resume' && typeof assistantFocusTurn === 'function'){
      const turn = ++_assistantTurn;
      assistantRetireFocusControls();
      assistantShowBusy(true);
      try{
        const out = await assistantFocusTurn(session, '', {resume:true, onProgress:info => assistantNoteFocusProgress(session, info, turn)});
        if(turn === _assistantTurn && !out.cancelled)assistantShowFocusReview(session);
      }finally{ if(turn === _assistantTurn)assistantShowBusy(false); }
      return true;
    }
    if((which === 'eventScope' || value === 'series' || value === 'occurrence') && typeof assistantFocusSetScope === 'function' && (value === 'series' || value === 'occurrence')){
      assistantFocusSetScope(session, value, session.occurrenceDate);
      assistantShowFocusReview(session);
      return true;
    }
    if(value === 'series-place' && typeof assistantFocusSetScope === 'function'){
      assistantFocusSetScope(session, 'series');
      session.unresolved = session.unresolved.filter(item => item.field !== 'places');
      assistantShowFocusReview(session);
      return true;
    }
    if(value === 'skip-place'){
      session.changes = session.changes.filter(change => change.field !== 'places');
      session.unresolved = session.unresolved.filter(item => item.field !== 'places');
      assistantShowFocusReview(session);
      return true;
    }
    if(value && typeof assistantFocusChoose === 'function'){
      assistantFocusChoose(session, which, value);
      assistantShowFocusReview(session);
    }
    return true;
  }
  return false;
}

function bindAssistantUi(){
  $('open-assistant')?.addEventListener('click', openAssistantSheet);
  $('bar-open-assistant')?.addEventListener('click', openAssistantSheet);
  $('assistant-clear')?.addEventListener('click', clearAssistantChat);
  $('assistant-title')?.addEventListener('click', assistantNoteTitleTap);
  $('assistant-debug-toggle')?.addEventListener('click', assistantToggleDebugDock);
  $('assistant-debug-fold')?.addEventListener('click', assistantToggleDebugCompact);
  $('assistant-debug-close')?.addEventListener('click', assistantCloseDebugDock);
  $('assistant-debug-copy')?.addEventListener('click', () => {
    assistantCopyDebug($('assistant-debug-json')?.value || '');
  });
  $('assistant-feedback')?.addEventListener('click', assistantToggleFeedbackPanel);
  $('assistant-focus-done')?.addEventListener('click', assistantClearFocus);
  $('assistant-close')?.addEventListener('click', closeAssistantSheet);
  $('assistant-sheet')?.addEventListener('click', e => {
    if(e.target === e.currentTarget)closeAssistantSheet();
  });
  $('assistant-send')?.addEventListener('click', () => sendAssistantMessage(assistantComposerDraft()));
  $('assistant-input')?.addEventListener('input', () => {
    assistantAbsorbGuidePrefix();
    assistantResizeComposer();
    assistantSyncSend();
    assistantScheduleGuideRender();
  });
  $('assistant-mention-remove')?.addEventListener('pointerdown', e => e.preventDefault());
  $('assistant-mention-remove')?.addEventListener('click', () => {
    if(_assistantBusy)return;
    assistantSetMention('');
    const input = $('assistant-input');
    input?.focus({preventScroll:true});
    assistantResizeComposer();
    assistantSyncSend();
    assistantRenderGuides();
  });
  $('assistant-guides')?.addEventListener('click', e => {
    const button = e.target.closest('[data-assistant-guide]');
    if(!button || button.disabled)return;
    e.preventDefault();
    const id = button.dataset.assistantGuide || '';
    if(/^(?:action|field):/.test(id)){
      const session = _assistantSession && _assistantSession.focus;
      if(session && typeof assistantFocusChoose === 'function'){
        assistantFocusChoose(session, 'guidance', id);
        assistantShowFocusReview(session);
        if(typeof render === 'function')render();
        assistantRenderGuides();
      }
      return;
    }
    assistantApplyGuide(button.dataset.guideLabel || button.textContent);
  });
  $('assistant-guide-more')?.addEventListener('click',()=>{
    if(_assistantBusy)return;
    const open=$('assistant-guide-browser')?.hidden;
    assistantToggleGuideBrowser(open);
    if(open){
      assistantRenderGuideBrowser();
      $('assistant-guide-search')?.focus({preventScroll:true});
      const guides=$('assistant-guides'),search=$('assistant-guide-search');
      if(guides&&search)guides.scrollTop+=search.getBoundingClientRect().top-guides.getBoundingClientRect().top;
    }else $('assistant-input')?.focus({preventScroll:true});
    if(typeof updateKeyboardLift==='function')updateKeyboardLift();
  });
  $('assistant-guide-search')?.addEventListener('input',()=>{
    assistantSyncGuideSearchClear();
    assistantRenderGuideBrowser();
  });
  $('assistant-guide-clear')?.addEventListener('click',()=>{
    const input=$('assistant-guide-search');
    if(!input || input.disabled)return;
    input.value='';
    assistantSyncGuideSearchClear();
    assistantRenderGuideBrowser();
    input.focus({preventScroll:true});
  });
  $('assistant-guide-search')?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      e.preventDefault();assistantToggleGuideBrowser(false);$('assistant-input')?.focus({preventScroll:true});
    }
    if(e.key==='Enter'){
      e.preventDefault();
      const first=$('assistant-guide-results')?.querySelector('[data-assistant-guide]:not(:disabled)');
      if(first)assistantApplyGuide(first.dataset.guideLabel || first.querySelector('.focus-field-text')?.textContent || first.textContent);
    }
  });
  $('assistant-guide-revise')?.addEventListener('click',()=>{
    const input=$('assistant-input'),session=_assistantSession?.focus;
    if(_assistantBusy||assistantComposerDraft().trim()||!session||!assistantFocusAlive(session))return;
    const request=assistantGuideRevise(session);
    if(request==null||!input)return;
    $('assistant-guides').dataset.guideRevising='true';
    assistantPresentComposer(request);
    assistantToggleGuideBrowser(false);
    assistantShowFocusReview(session);
    assistantResizeComposer();assistantSyncSend();assistantRenderGuides();
    input.focus({preventScroll:true});
    if(typeof updateKeyboardLift==='function')updateKeyboardLift();
  });
  $('assistant-input')?.addEventListener('keydown', e => {
    if(e.key === 'Backspace' && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey){
      const input = e.currentTarget;
      if(assistantMentionName() && input.selectionStart === 0 && input.selectionEnd === 0){
        e.preventDefault();
        assistantSetMention('');
        assistantSyncSend();
        assistantRenderGuides();
        return;
      }
    }
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendAssistantMessage(assistantComposerDraft());
    }
  });
  $('assistant-thread')?.addEventListener('click', e => {
    if(e.target.closest('[data-focus-save],[data-focus-edit],[data-focus-choice],[data-focus-field]')){
      e.preventDefault();
      void assistantHandleFocusClick(e.target);
      return;
    }
    const suggest = e.target.closest('[data-assistant-suggest]');
    if(suggest){
      sendAssistantMessage(suggest.dataset.assistantSuggest);
      return;
    }
    const act = e.target.closest('[data-assistant-act]');
    if(act){
      const which = act.dataset.assistantAct;
      if(which === 'add')commitAssistantDraft(false);
      else if(which === 'edit')commitAssistantDraft(true);
      else if(which === 'log')commitAssistantComplete();
      else if(which === 'plan')commitAssistantPlan();
      else if(which === 'remove')commitAssistantDelete();
      else if(which === 'compound')commitAssistantCompoundAction(Number(act.dataset.assistantActionIndex), act);
      else if(which === 'discard-action')discardAssistantCompoundAction(Number(act.dataset.assistantActionIndex), act);
      else if(which === 'discard'){
        assistantDiscardPending();
        act.closest('.assistant-bubble')?.remove();
      }
      return;
    }
    const choice = e.target.closest('[data-assistant-choice]');
    if(choice){
      sendAssistantMessage(choice.dataset.assistantChoice);
      return;
    }
    const copy = e.target.closest('[data-assistant-copy-debug]');
    if(copy){
      const hold = copy.closest('.assistant-bubble-debug')?.querySelector('.assistant-debug-json');
      assistantCopyDebug(hold ? hold.value : '');
    }
  });

  $('setting-local-assistant')?.addEventListener('click', () => {
    patchLocalAssistant({localAssistant:!assistantEnabled()});
    assistantSetStatus(assistantEnabled() ? assistantEnabledStatusText() : '');
  });
  $('assistant-copy-origins')?.addEventListener('click', () => {
    const text = typeof assistantOllamaSetupCommands === 'function'
      ? assistantOllamaSetupCommands()
      : (typeof assistantOllamaOriginsAllowText === 'function' ? assistantOllamaOriginsAllowText() : '');
    if(!text){
      if(typeof showToast === 'function')showToast('could not copy');
      return;
    }
    const platform = typeof assistantHostPlatform === 'function' ? assistantHostPlatform() : 'mac';
    assistantCopyText(text, platform === 'windows' ? 'commands copied — paste them in Command Prompt' : 'commands copied — paste them in Terminal');
  });
  $('setting-local-assistant-debug')?.addEventListener('click', () => {
    if(!assistantEnabled())patchLocalAssistant({localAssistant:true, localAssistantDebug:true});
    else patchLocalAssistant({localAssistantDebug:!assistantDebugOn()});
  });
  $('assistant-provider-seg')?.addEventListener('click', e => {
    const opt = e.target.closest('[data-assistant-provider]');
    if(!opt)return;
    patchLocalAssistant({localAssistantProvider:normalizeLocalAssistantProvider(opt.dataset.assistantProvider)});
    assistantSetStatus('');
  });
  $('assistant-reasoning-seg')?.addEventListener('click', e => {
    const opt = e.target.closest('[data-assistant-reasoning]');
    if(!opt)return;
    patchLocalAssistant({localAssistantReasoning:normalizeLocalAssistantReasoning(opt.dataset.assistantReasoning)});
  });
  const urlEl = $('assistant-url');
  if(urlEl){
    const saveUrl = () => commitAssistantUrlFromInput();
    urlEl.addEventListener('change', saveUrl);
    urlEl.addEventListener('blur', saveUrl);
    urlEl.addEventListener('keydown', e => {
      if(e.key === 'Enter'){
        e.preventDefault();
        saveUrl();
        urlEl.blur();
      }
    });
  }
  $('assistant-model')?.addEventListener('change', () => {
    patchLocalAssistant({localAssistantModel:normalizeLocalAssistantModel($('assistant-model').value)});
  });
  $('assistant-refresh-models')?.addEventListener('click', async () => {
    if(!commitAssistantUrlFromInput())return;
    assistantSetStatus('listing models…');
    try{
      const found = await assistantListModels(true);
      const model = pickAssistantModel(found.models, assistantSettings().model);
      patchLocalAssistant({localAssistantModel:model});
      assistantSetStatus(`${found.provider} · ${found.models.length} model${found.models.length === 1 ? '' : 's'} · using ${model}`);
    }catch(err){
      assistantSetStatus(assistantFriendlyError(err));
    }
  });
  $('assistant-test')?.addEventListener('click', async () => {
    if(!commitAssistantUrlFromInput())return;
    if(!assistantEnabled())patchLocalAssistant({localAssistant:true});
    assistantSetStatus(assistantSettings().provider === 'needle' ? 'testing Needle 3 on this device…' : 'testing model (thinking + tool call)…');
    try{
      const result = await assistantTestConnection();
      assistantSetStatus(result.ok
        ? `${result.provider} · ${result.model} · thinking ${result.thinking ? 'on' : 'off'} · ${result.tool}`
        : `${result.model} did not return the expected tool. Try a short request in the chat.`);
    }catch(err){
      assistantSetStatus(assistantFriendlyError(err));
    }
  });
}

bindAssistantUi();
document.addEventListener('tings-needle-state', syncAssistantNeedleControls);
document.addEventListener('click', event=>{
  if(event.target.closest('[data-needle-download]'))void assistantNeedleDownload();
  if(event.target.closest('[data-needle-cancel]'))assistantNeedleCancelDownload();
  if(event.target.closest('[data-needle-remove]'))void assistantNeedleRemove().catch(err=>assistantNeedleState({phase:'error',error:err.message}));
});
assistantResizeComposer();
assistantSyncSend();
syncLocalAssistantControls();
if(assistantEnabled() && assistantSettings().provider === 'needle')void assistantNeedleCheckDownload();
