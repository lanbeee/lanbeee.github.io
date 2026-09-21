// Local assistant sheet + settings. Preview never saves until Add.

let _assistantSession = null;
let _assistantBusy = false;
let _assistantPendingDraft = null;
let _assistantPendingDrafts = null;
let _assistantTurn = 0;

function assistantEnabled(){
  return Boolean(sortSettings && sortSettings.localAssistant);
}

function assistantDebugOn(){
  if(typeof assistantSettings === 'function')return Boolean(assistantSettings().debug);
  return Boolean(sortSettings && sortSettings.localAssistantDebug);
}

function assistantModelOnlyOn(){
  if(typeof assistantSettings === 'function')return Boolean(assistantSettings().modelOnly);
  return Boolean(sortSettings && sortSettings.localAssistantModelOnly);
}

function syncAssistantChrome(){
  const on = assistantEnabled();
  document.body.classList.toggle('assistant-on', on);
  document.body.classList.toggle('assistant-debug-on', on && assistantDebugOn());
  ['open-assistant','bar-open-assistant'].forEach(id => {
    const btn = $(id);
    if(btn)btn.hidden = !on;
  });
  if(!on){
    assistantAbortInFlight();
    if($('assistant-sheet') && $('assistant-sheet').classList.contains('open'))closeAssistantSheet();
  }
}

function syncLocalAssistantControls(){
  const s = assistantSettings();
  const toggle = $('setting-local-assistant');
  if(toggle)toggle.setAttribute('aria-pressed', String(s.on));
  const debugToggle = $('setting-local-assistant-debug');
  if(debugToggle)debugToggle.setAttribute('aria-pressed', String(s.debug));
  const modelOnlyToggle = $('setting-local-assistant-model-only');
  if(modelOnlyToggle)modelOnlyToggle.setAttribute('aria-pressed', String(s.modelOnly));
  const sheetDebug = $('assistant-debug-toggle');
  if(sheetDebug){
    sheetDebug.setAttribute('aria-pressed', String(s.debug));
    sheetDebug.hidden = !s.on;
  }
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
  syncAssistantOriginHelp();
  syncAssistantChrome();
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
  const origin = typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '';
  if(origin)return 'On. If list models fails, follow the steps under local assistant.';
  return 'On. Keep Ollama running on this computer.';
}

function patchLocalAssistant(patch){
  if(typeof updateSortSetting === 'function')updateSortSetting(patch, {renderNow:false});
  else if(typeof saveSortSettings === 'function')saveSortSettings({...loadSortSettings(), ...patch});
  sortSettings = typeof loadSortSettings === 'function' ? loadSortSettings() : sortSettings;
  syncLocalAssistantControls();
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

function openAssistantSheet(opts){
  if(!assistantEnabled()){
    if(typeof showToast === 'function')showToast('Turn on local assistant in Settings');
    return;
  }
  if(!_assistantSession)_assistantSession = assistantCreateSession();
  if(!(opts && opts.skipWelcome))renderAssistantThread();
  syncAssistantFocusBar();
  openSheet('assistant-sheet');
  assistantResizeComposer();
  assistantSyncSend();
  const input = $('assistant-input');
  if(input){
    input.focus({preventScroll:true});
    setTimeout(() => {
      if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
    }, 260);
  }
}

function closeAssistantSheet(){
  assistantAbortInFlight();
  assistantShowBusy(false);
  closeSheet('assistant-sheet');
}

// Entry points (add sheet, detail page) start a fresh conversation with the
// intent or item already known, so the model skips classify and extracts
// straight away. The local fast-path gates still run first — the model is
// the fallback, not the default.
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
  if(draft)_assistantSession.draft = draft;
  syncAssistantFocusBar();
  openAssistantSheet({skipWelcome:!value || Boolean(draft)});
  if(!value){
    // Detail entry with no instruction yet: introduce the focus locally —
    // no model call until the user types.
    appendAssistantBubble('say', `Working on ${draft.name}. Tell me what to change — schedule, window, place, duration, anything.`);
    const input = $('assistant-input');
    if(input)input.focus({preventScroll:true});
    setTimeout(() => {
      if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
    }, 260);
    return true;
  }
  await sendAssistantMessage(value, {startIntent:opts.intent, entry:opts.entry});
  return true;
}

function assistantWelcomeHtml(){
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
    if(items)bits.push(`${items} ${items === 1 ? 'item' : 'items'}`);
    if(places)bits.push(`${places} ${places === 1 ? 'place' : 'places'}`);
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

function syncAssistantFocusBar(){
  const bar = $('assistant-focus');
  if(!bar)return;
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
}

function assistantClearFocus(){
  if(_assistantSession){
    _assistantSession.draft = null;
    _assistantSession.pendingEdit = null;
    _assistantSession.pendingComplete = null;
    _assistantSession.pendingPlan = null;
    _assistantSession.pendingDelete = null;
    _assistantSession.awaiting = null;
  }
  _assistantPendingDraft = null;
  _assistantPendingDrafts = null;
  syncAssistantFocusBar();
}

function clearAssistantChat(){
  _assistantTurn += 1;
  assistantAbortInFlight();
  assistantShowBusy(false);
  assistantClearFocus();
  _assistantSession = typeof assistantCreateSession === 'function' ? assistantCreateSession() : null;
  const input = $('assistant-input');
  if(input){
    input.value = '';
    input.focus({preventScroll:true});
  }
  const thread = assistantThreadEl();
  if(thread)thread.innerHTML = assistantWelcomeHtml();
  assistantResizeComposer();
  assistantSyncSend();
  syncAssistantFocusBar();
}

function assistantThinkHtml(thinking){
  const text = String(thinking || '').trim();
  if(!text)return '';
  return `<details class="assistant-think"><summary>thought</summary><pre>${escapeHtml(text)}</pre></details>`;
}

function assistantDebugPayload(events){
  try{ return JSON.stringify(events || [], null, 2); }catch(_){ return '[]'; }
}

function assistantDebugHtml(events, extra){
  const text = extra && extra.debugText
    || (typeof assistantFormatDebug === 'function' ? assistantFormatDebug(events) : '');
  if(!text && !(events && events.length))return '';
  return `<details class="assistant-debug" open>
    <summary>debug</summary>
    <pre class="assistant-debug-log">${escapeHtml(text)}</pre>
    <textarea class="assistant-debug-json" hidden></textarea>
    <div class="assistant-debug-actions">
      <button type="button" class="btn" data-assistant-copy-debug>copy json</button>
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
    el.innerHTML = `<details class="assistant-debug" open><summary>debug</summary><pre class="assistant-debug-log">starting…</pre></details>`;
    thread.appendChild(el);
  }
  return el;
}

function assistantRenderLiveDebug(events){
  if(!assistantDebugOn())return;
  const el = assistantEnsureLiveDebug();
  assistantFillDebugBubble(el, events, {
    debugText:typeof assistantFormatDebug === 'function' ? assistantFormatDebug(events) : '',
    debugJson:assistantDebugPayload(events)
  });
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
  const bits = [];
  if(items)bits.push(`${items} ${items === 1 ? 'item' : 'items'}`);
  if(places)bits.push(`${places} placeholder ${places === 1 ? 'place' : 'places'}`);
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
  }else if(kind === 'ask'){
    const choices = (extra && extra.choices || []).map(choice =>
      `<button type="button" class="btn" data-assistant-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`
    ).join('');
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>${choices ? `<div class="btn-row assistant-choices">${choices}</div>` : ''}`;
  }else if(kind === 'debug'){
    assistantFillDebugBubble(div, extra && extra.debug, extra);
  }else{
    div.innerHTML = `${think}<p>${escapeHtml(text)}</p>`;
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
  return String($('assistant-input')?.value || '').trim();
}

function assistantResizeComposer(){
  const input = $('assistant-input');
  if(!input)return;
  if(typeof ASSISTANT_INPUT_MAX === 'number')input.maxLength = ASSISTANT_INPUT_MAX;
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 220)}px`;
}

function assistantSyncSend(){
  const send = $('assistant-send');
  if(send)send.disabled = _assistantBusy || !assistantComposerValue();
}

function assistantShowBusy(on){
  _assistantBusy = on;
  const input = $('assistant-input');
  if(input)input.disabled = on;
  assistantSyncSend();
  document.querySelectorAll('#assistant-thread .assistant-suggest, #assistant-thread .assistant-retry').forEach(btn => { btn.disabled = on; });
  const wait = $('assistant-waiting');
  if(wait){
    wait.hidden = !on;
    if(on && !wait.textContent.trim())wait.textContent = 'thinking…';
  }
}

// The fast path answered without the model; offer to redo this utterance
// with Qwen instead.
function appendAssistantRetry(text){
  const thread = assistantThreadEl();
  const value = String(text || '').trim();
  if(!thread || !value)return;
  const row = document.createElement('div');
  row.className = 'assistant-retry-row';
  row.innerHTML = `<button type="button" class="btn assistant-retry" data-assistant-retry="${escapeHtml(value)}">use AI instead</button>`;
  thread.appendChild(row);
  thread.scrollTop = thread.scrollHeight;
}

function assistantRetryTextFor(out){
  if(!out || !out.fastPath || assistantModelOnlyOn())return null;
  return out.session && out.session.parsed && out.session.parsed.text || null;
}

async function handleAssistantOutcome(out){
  if(!out)return;
  if(out.draft)_assistantPendingDraft = out.draft;
  _assistantPendingDrafts = Array.isArray(out.drafts) && out.drafts.length
    ? out.drafts
    : (out.draft ? [out.draft] : null);
  if(out.session)_assistantSession = out.session;
  if(out.draft && _assistantSession && !_assistantSession.draft)_assistantSession.draft = out.draft;
  if(_assistantPendingDrafts && _assistantSession && !_assistantSession.drafts)_assistantSession.drafts = _assistantPendingDrafts;
  syncAssistantFocusBar();
  const live = assistantThreadEl()?.querySelector('.assistant-bubble-debug.is-live');
  if(live && out.debug){
    assistantFillDebugBubble(live, out.debug, {debugText:out.debugText, debugJson:assistantDebugPayload(out.debug)});
    live.classList.remove('is-live');
  }else if(assistantDebugOn() && out.debug && out.debug.length){
    appendAssistantBubble('debug', '', {debug:out.debug, debugText:out.debugText, debugJson:assistantDebugPayload(out.debug)});
  }
  const retryText = assistantRetryTextFor(out);
  if(out.type === 'preview'){
    const drafts = Array.isArray(out.drafts) ? out.drafts : (out.draft ? [out.draft] : []);
    const batch = drafts.length > 1;
    const setting = !batch && out.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(out.draft.kind);
    const places = drafts.filter(row => row && row.kind === 'location').length;
    appendAssistantBubble('say', batch
      ? (places
        ? 'Check these, then save all. Placeholder places use dummy addresses — set the real ones in Settings → locations.'
        : 'Check these, then save all.')
      : (setting ? 'Check this, then save.' : 'Check this, then save. Edit opens the full form.'), {thinking:out.thinking});
    appendAssistantBubble('preview', out.summary || (out.draft && out.draft.name) || 'drafts', {thinking:out.thinking, setting, drafts});
    if(retryText)appendAssistantRetry(retryText);
    return;
  }
  if(out.type === 'complete'){
    if(out.alreadyDone){
      appendAssistantBubble('say', out.text || 'Already logged today.', {thinking:out.thinking});
      if(retryText)appendAssistantRetry(retryText);
      return;
    }
    appendAssistantBubble('complete', out.text || 'Log it as done?', {thinking:out.thinking, action:out.completeAction});
    if(retryText)appendAssistantRetry(retryText);
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
  if(out.type === 'ask'){
    appendAssistantBubble('ask', out.question, {choices:out.choices, thinking:out.thinking});
    if(retryText)appendAssistantRetry(retryText);
    return;
  }
  if(out.type === 'today' || out.type === 'say'){
    appendAssistantBubble('say', out.text, {thinking:out.thinking});
    if(retryText)appendAssistantRetry(retryText);
    return;
  }
  appendAssistantBubble('say', out.text || 'Something went wrong.', {thinking:out.thinking});
}

// Redo the last fast-path utterance through the model. A saved item stays
// in focus. An unsaved preview is kept when this is a follow-up on that
// draft ("add the location home"); a first-turn create is dropped so the
// model starts clean.
async function assistantSendWithModel(text){
  const value = String(text || '').trim();
  if(!value || _assistantBusy)return;
  const prior = assistantFocusedDraft();
  const session = assistantCreateSession();
  if(prior && prior.name){
    const keepFollow = (typeof assistantLooksLikeSettingFollowup === 'function' && assistantLooksLikeSettingFollowup(value))
      || (typeof assistantLooksLikeEdit === 'function' && assistantLooksLikeEdit(value));
    if(prior.hid || keepFollow)session.draft = prior;
  }
  const turn = ++_assistantTurn;
  assistantShowBusy(true);
  try{
    const out = await runAssistantTurn(value, {
      forceLlm:true,
      session,
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
    await handleAssistantOutcome(out);
  }catch(err){
    if(turn !== _assistantTurn)return;
    appendAssistantBubble('say', assistantFriendlyError(err));
  }finally{
    if(turn === _assistantTurn)assistantShowBusy(false);
  }
}

async function sendAssistantMessage(text, opts){
  opts = opts || {};
  const value = String(text || '').trim();
  if(!value || _assistantBusy)return;
  const turn = ++_assistantTurn;
  appendAssistantBubble('user', value);
  const input = $('assistant-input');
  if(input){
    input.value = '';
    assistantResizeComposer();
    assistantSyncSend();
  }
  assistantShowBusy(true);
  try{
    const out = await runAssistantTurn(value, {
      session:_assistantSession || assistantCreateSession(),
      startIntent:opts.startIntent || undefined,
      entry:opts.entry || undefined,
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
    await handleAssistantOutcome(out);
  }catch(err){
    if(turn !== _assistantTurn)return;
    appendAssistantBubble('say', assistantFriendlyError(err));
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
  _assistantSession.awaiting = null;
  _assistantSession.messages = [];
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

function assistantAfterSave(commit, openForm, toast){
  assistantKeepWorkingOn(commit);
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
  appendAssistantBubble('say', `Removed ${result.name}. You can undo from the toast.`);
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
      }
      _assistantPendingDraft = _assistantSession && _assistantSession.draft;
      syncAssistantFocusBar();
      return;
    }
  }
  assistantClearFocus();
}

function bindAssistantUi(){
  $('open-assistant')?.addEventListener('click', openAssistantSheet);
  $('bar-open-assistant')?.addEventListener('click', openAssistantSheet);
  $('assistant-clear')?.addEventListener('click', clearAssistantChat);
  $('assistant-debug-toggle')?.addEventListener('click', () => {
    patchLocalAssistant({localAssistantDebug:!assistantDebugOn()});
  });
  $('setting-local-assistant-debug')?.addEventListener('click', () => {
    patchLocalAssistant({localAssistantDebug:!assistantDebugOn()});
  });
  $('setting-local-assistant-model-only')?.addEventListener('click', () => {
    patchLocalAssistant({localAssistantModelOnly:!assistantModelOnlyOn(), localAssistantRoutingVersion:2});
  });
  $('assistant-focus-done')?.addEventListener('click', assistantClearFocus);
  $('assistant-close')?.addEventListener('click', closeAssistantSheet);
  $('assistant-sheet')?.addEventListener('click', e => {
    if(e.target === e.currentTarget)closeAssistantSheet();
  });
  $('assistant-send')?.addEventListener('click', () => sendAssistantMessage($('assistant-input')?.value));
  $('assistant-input')?.addEventListener('input', () => {
    assistantResizeComposer();
    assistantSyncSend();
  });
  $('assistant-input')?.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendAssistantMessage($('assistant-input').value);
    }
  });
  $('assistant-thread')?.addEventListener('click', e => {
    const retry = e.target.closest('[data-assistant-retry]');
    if(retry){
      const row = retry.closest('.assistant-retry-row');
      if(row)row.remove();
      assistantSendWithModel(retry.dataset.assistantRetry);
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
    assistantSetStatus('testing Qwen (thinking + tool call)…');
    try{
      const result = await assistantTestConnection();
      assistantSetStatus(result.ok
        ? `${result.provider} · ${result.model} · thinking ${result.thinking ? 'on' : 'off'} · ${result.tool}`
        : `${result.model} answered without classify_intent`);
    }catch(err){
      assistantSetStatus(assistantFriendlyError(err));
    }
  });
}

bindAssistantUi();
assistantResizeComposer();
assistantSyncSend();
syncAssistantChrome();
syncAssistantOriginHelp();
