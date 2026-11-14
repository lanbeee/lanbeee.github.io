// Summary is the first detail tab: the item's essentials plus every setting
// that differs from new-item defaults, as pills that open their control.
// With Needle ready, the dock composer edits this item inside the same tab.
// Nothing is written until the proposal's Save; Edit hands the staged values
// to the detail editor unsaved.

const detailSummary = {hid:null, session:null, feedback:null, busy:false, turn:0, occurrenceDate:''};
let detailSummaryLoadPending = false;
let detailSummaryRevising = false;
// Keep unsaved conversations during this visit, including when another item opens.
const detailSummaryDrafts = new Map();

function detailSummaryRecord(){
  if(detailIdx === null)return detailUnsavedCreate || null;
  return load()[detailIdx] || null;
}

function detailSummaryAskReady(){
  return Boolean(detailIdx !== null && sortSettings?.localAssistantProvider === 'needle'
    && detailAssistantAvailable() && typeof assistantFocusOpen === 'function');
}

function detailSummaryCanSend(){
  return typeof assistantNeedleCanSend !== 'function' || assistantNeedleCanSend();
}

function detailSummaryOnScreen(){
  const inner = getSheetInner('detail-sheet');
  if(!inner || inner.classList.contains('detail-search-open'))return false;
  return detailCurrentNav() === 'summary';
}

function detailSummaryPill(chip,session){
  const label = String(chip.label || '');
  const value = String(chip.text || '');
  const text = !label || value.toLowerCase().includes(label.toLowerCase()) ? value : `${label} · ${value}`;
  const body = `<span class="focus-field-text">${escapeHtml(text)}</span>`;
  if(!assistantFocusDetailSelector(chip.id,session))return `<span class="assistant-chip">${body}</span>`;
  return `<button type="button" class="assistant-chip focus-field" data-summary-field="${escapeHtml(chip.id)}" aria-label="${escapeHtml(`Open ${label || 'setting'}: ${value}`)}">${body}<i class="ti ti-chevron-right" aria-hidden="true"></i></button>`;
}

function renderDetailSummaryOverview(){
  const host = $('detail-summary');
  if(!host)return;
  const item = detailSummaryRecord();
  if(!item){host.replaceChildren();return;}
  if(typeof assistantFocusItemSummary !== 'function'){
    host.innerHTML = '<p class="focus-note">Loading summary…</p>';
    if(!detailSummaryLoadPending && typeof tingsLoadAssistant === 'function'){
      detailSummaryLoadPending = true;
      void tingsLoadAssistant().then(ok=>{
        detailSummaryLoadPending = false;
        if(ok)renderDetailSummary();
        else host.innerHTML = '<p class="focus-note">The summary is unavailable right now. The other tabs have every setting.</p>';
      });
    }
    return;
  }
  const summary = assistantFocusItemSummary(item);
  const row = (chips,label)=>`<div class="assistant-chip-row" role="group" aria-label="${label}">${chips.map(chip=>detailSummaryPill(chip,summary.session)).join('')}</div>`;
  const parts = [row([...summary.essentials,...summary.custom],'Item settings')];
  const hint = !detailSummaryAskReady() ? 'Tap a setting to edit.'
    : detailSummaryCanSend() ? 'Tap a setting or describe a change.'
    : 'Download Needle 3 to describe changes.';
  parts.push(`<p class="focus-note">${hint}</p>`);
  host.innerHTML = parts.join('');
}

function detailSummaryNavPage(nav){
  return [...(getSheetInner('detail-sheet')?.querySelectorAll('.detail-pager > .detail-page') || [])]
    .find(page=>page.dataset.detailNav === nav);
}

function detailSummaryThread(){
  return $('detail-summary-thread');
}

let detailSummaryFollowEnd = false;
function detailSummaryKeepEnd(){
  if(!detailSummaryFollowEnd || !detailSummaryOnScreen())return;
  const page = getSheetInner('detail-sheet')?.querySelector('.detail-summary-page');
  const scroller = detailIsSingleView() ? page?.closest('.detail-pager') : page;
  if(scroller)scroller.scrollTo({top:scroller.scrollHeight,behavior:'instant'});
}

function detailSummaryScrollToEnd(){
  detailSummaryFollowEnd = true;
  requestAnimationFrame(detailSummaryKeepEnd);
}

// A response stays above the composer/toast through keyboard and footer
// resizing. A reader's own scroll immediately takes ownership of the position.
const detailSummaryPager = $('detail-summary').closest('.detail-pager');
['touchstart','wheel'].forEach(type=>detailSummaryPager.addEventListener(type,()=>{
  detailSummaryFollowEnd = false;
},{passive:true}));
detailSummaryPager.addEventListener('keydown',event=>{
  if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)
    && !event.target.closest('input,textarea,[contenteditable="true"]'))detailSummaryFollowEnd = false;
});
const detailSummaryResizeObserver = new ResizeObserver(detailSummaryKeepEnd);
detailSummaryResizeObserver.observe(detailSummaryPager);
detailSummaryResizeObserver.observe($('detail-summary').closest('.detail-summary-page'));

function detailSummaryBubble(kind,text){
  const thread = detailSummaryThread();
  const bubble = document.createElement('div');
  bubble.className = `assistant-bubble assistant-bubble-${kind}`;
  const line = document.createElement('p');
  line.textContent = text;
  bubble.append(line);
  thread.append(bubble);
  $('detail-summary-chat').hidden = false;
  detailSummaryScrollToEnd();
  return bubble;
}

// One live proposal at a time, kept under the latest message.
function detailSummaryShowProposal(opts){
  const session = detailSummary.session;
  const thread = detailSummaryThread();
  if(!session || !thread)return;
  let card = thread.querySelector('[data-detail-proposal]:not(.is-retired)');
  if(!card){
    card = document.createElement('div');
    card.className = 'assistant-bubble assistant-bubble-say assistant-bubble-review';
    card.dataset.detailProposal = 'true';
  }
  card.innerHTML = assistantFocusReviewHtml(session,{
    embedded:true,
    canOpenNav:nav=>Boolean(detailSummaryNavPage(nav)),
    navLabel:nav=>typeof detailPageLabel === 'function' ? detailPageLabel(nav) : nav
  });
  if(opts?.live)card.querySelectorAll('button').forEach(button=>{button.disabled = true;});
  thread.append(card);
  $('detail-summary-chat').hidden = false;
  if(!opts?.live)detailSummary.feedback = session;
  if(!opts?.live)syncDetailSummaryDock();
  detailSummaryScrollToEnd();
}

function detailSummaryRetireProposal(label){
  const card = detailSummaryThread()?.querySelector('[data-detail-proposal]:not(.is-retired)');
  if(!card)return;
  card.classList.add('is-retired');
  const heading = card.querySelector('.focus-kicker');
  if(heading && label)heading.textContent = label;
  card.querySelectorAll('.btn-row,[data-focus-drop]').forEach(row=>row.remove());
  card.querySelectorAll('button').forEach(button=>{button.disabled = true;});
}

function detailSummaryHasWork(){
  const session = detailSummary.session;
  return Boolean(session && (session.changes.length || session.unresolved.length || session.continuationError || session.pendingFamilies.length || (session.itemActions || []).length));
}

// Setting chips answer a clarification; a notice (another item, a question)
// is not answered by picking one of this item's settings.
function detailSummaryNeedsPick(session){
  return Boolean(session?.unresolved?.some(item=>!item.notice));
}

function detailSummaryEnsureSession(){
  const item = detailSummaryRecord();
  if(!item)return null;
  const current = detailSummary.session;
  if(current && current.targetId === item.hid && assistantFocusAlive(current))return current;
  detailSummary.session = assistantFocusOpen({
    operation:'edit', kind:assistantFocusKindOf(item), targetId:item.hid,
    entry:'detail', occurrenceDate:detailSummary.occurrenceDate || ''
  });
  return detailSummary.session;
}

function detailSummaryReset(hid = null,preserve = false){
  if(preserve && detailSummary.busy && detailSummary.session){
    const session = detailSummary.session;
    // Invalidate late replies before reopening can renew the session's epoch.
    session.requestRevision = (session.requestRevision || 0) + 1;
    if(session._fieldState){
      const state = {...session._fieldState,revision:session.requestRevision,
        jobs:session.jobs.map(job=>({...job,status:['running','queued','waiting'].includes(job.status) ? 'retryable_failed' : job.status}))};
      Object.defineProperty(state,'session',{value:session});
      session._fieldState = state;session.jobs = state.jobs;
    }
    session.continuationError = 'Request paused when this item closed. Continue to finish reading.';
  }
  if(preserve && detailSummary.hid && (detailSummary.busy || detailSummaryHasWork() || detailSummaryDraft().trim())){
    detailSummaryDrafts.set(detailSummary.hid,{session:detailSummary.session,
      feedback:detailSummary.feedback,
      nodes:[...detailSummaryThread().childNodes],draft:detailSummaryDraft(),
      occurrenceDate:detailSummary.occurrenceDate});
  }else if(!preserve && detailSummary.hid)detailSummaryDrafts.delete(detailSummary.hid);
  if(detailSummary.busy && typeof assistantAbortInFlight === 'function')assistantAbortInFlight();
  detailSummary.turn += 1;
  detailSummary.busy = false;
  detailSummary.session = null;
  detailSummary.feedback = null;
  detailSummary.hid = hid;
  detailSummary.occurrenceDate = '';
  detailSummaryRevising = false;
  detailSummaryThread()?.replaceChildren();
  if($('detail-summary-chat'))$('detail-summary-chat').hidden = true;
  const input = $('detail-ask-input');
  if(input){input.value = '';detailSummarySetTag('');detailSummaryResizeComposer();}
}

// Called on every detail paint. A new item starts over; the same item keeps
// its conversation, and an idle session rebuilds from the saved record.
function renderDetailSummary(){
  const item = detailSummaryRecord();
  const hid = item?.hid || null;
  if(detailIdx === null || hid !== detailSummary.hid){
    detailSummaryReset(hid,true);
    const kept = hid && detailSummaryDrafts.get(hid);
    if(kept){
      detailSummaryDrafts.delete(hid);
      detailSummary.session = kept.session;
      detailSummary.feedback = kept.feedback || kept.session;
      detailSummary.occurrenceDate = kept.occurrenceDate;
      if(kept.session){
        kept.session.epoch = assistantFocusOpen({operation:'edit',kind:kept.session.kind,targetId:hid}).epoch;
        kept.session._focusInFlight = false;
      }
      detailSummaryThread().replaceChildren(...kept.nodes);
      $('detail-summary-chat').hidden = !kept.nodes.length;
      detailSummaryComposer(kept.draft);
      if(kept.session)detailSummaryShowProposal();
    }
  }
  else if(detailSummary.session && !detailSummary.busy && !detailSummaryHasWork())detailSummary.session = null;
  renderDetailSummaryOverview();
  syncDetailSummaryDock();
}

function detailSummaryResizeComposer(){
  const input = $('detail-ask-input');
  if(!input)return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight,44),124)}px`;
}

// The composer holds "Label: value" as a setting tag plus the typed value.
function detailSummaryTagName(){
  const tag = $('detail-ask-tag');
  return tag && !tag.hidden ? $('detail-ask-tag-label').textContent.trim() : '';
}

function detailSummarySetTag(label){
  const name = String(label || '').trim();
  const tag = $('detail-ask-tag');
  $('detail-ask-tag-label').textContent = name;
  tag.hidden = !name;
  tag.setAttribute('aria-label',name ? `Setting: ${name}` : 'Setting');
}

function detailSummaryDraft(){
  const rest = String($('detail-ask-input')?.value || '');
  const label = detailSummaryTagName();
  if(!label)return rest;
  return rest.trim() ? `${label}: ${rest.trim()}` : label;
}

function detailSummaryComposer(value){
  const input = $('detail-ask-input');
  const session = value && typeof assistantGuideParse === 'function' && detailSummaryAskReady() ? detailSummaryEnsureSession() : null;
  const parsed = session ? assistantGuideParse(String(value || ''),session) : null;
  detailSummarySetTag(parsed ? parsed.label : '');
  input.value = parsed ? parsed.rest : String(value || '');
  detailSummaryResizeComposer();
  syncDetailSummaryDock();
}

// A typed "Label:" becomes the tag once the label names a setting.
function detailSummaryAbsorbTag(){
  const input = $('detail-ask-input');
  if(detailSummaryTagName() || typeof assistantGuideParse !== 'function' || !detailSummaryAskReady())return;
  const raw = input.value;
  const cut = raw.search(/[:\-–—]/);
  if(cut < 1 || cut > 48)return;
  const session = detailSummaryEnsureSession();
  const parsed = session && assistantGuideParse(raw,session);
  if(!parsed || !new RegExp(`^\\s*${assistantGuidePattern(parsed.label)}\\s*[:\\-–—]`,'i').test(raw))return;
  detailSummarySetTag(parsed.label);
  input.value = parsed.rest;
  detailSummaryResizeComposer();
}

// The dock is the composer only while the summary is on screen; other tabs keep
// search. Search stays one tap away from the composer through its loupe.
function syncDetailSummaryDock(){
  const inner = getSheetInner('detail-sheet');
  const ask = $('detail-ask');
  if(!inner || !ask)return;
  const ready = detailSummaryAskReady();
  const show = ready && detailSummaryOnScreen();
  inner.classList.toggle('detail-ask-on',show);
  ask.hidden = !show;
  if(!inner.classList.contains('detail-search-open'))$('detail-cool').setAttribute('aria-label',show && detailSummaryDraft() ? 'clear change' : 'close details');
  ask.classList.toggle('is-busy',detailSummary.busy);
  const input = $('detail-ask-input');
  const dirty = inner.classList.contains('tune-dirty');
  const canSend = detailSummaryCanSend();
  input.disabled = detailSummary.busy || dirty;
  input.placeholder = detailSummary.busy ? 'Needle is reading…'
    : dirty ? 'Save or cancel first'
    : !canSend ? 'Download Needle 3 first'
    : detailSummaryTagName() ? 'Type the new value'
    : 'Describe a change';
  $('detail-ask-tag-remove').disabled = input.disabled;
  $('detail-ask-send').disabled = input.disabled || !canSend || !detailSummaryDraft().trim();
  if(!show && document.activeElement === input)input.blur();
  $('detail-summary-setup').hidden = !ready;
  const feedback = $('detail-summary-feedback');
  feedback.hidden = !detailSummary.feedback || typeof feedbackFormConfigured !== 'function' || !feedbackFormConfigured();
  feedback.disabled = detailSummary.busy;
  renderDetailSummaryGuides();
}

// X clears a message in progress. An empty composer leaves the normal
// one-tap detail dismissal intact; prior conversation and proposals stay put.
function detailSummaryClearDraft(){
  const inner = getSheetInner('detail-sheet');
  if(!inner?.classList.contains('detail-ask-on') || !detailSummaryDraft())return false;
  $('detail-ask-input').blur();
  detailSummaryComposer('');
  $('detail-cool').focus({preventScroll:true});
  return true;
}

function detailSummaryOpenFeedback(){
  const focus = detailSummary.feedback;
  if(!focus || detailSummary.busy || !feedbackFormConfigured())return;
  const snap = assistantFeedbackFromFocus(focus);
  const transcript = assistantFeedbackTranscript(detailSummaryThread());
  snap.out.text = transcript.filter(turn=>turn.role === 'assistant').at(-1)?.text || snap.out.text;
  // Use this item's visible conversation, never the separate chat page.
  const report = assistantFeedbackReport(snap.out,{...snap.context,thread:detailSummaryThread()});
  document.activeElement?.blur?.();
  openFeedbackForm({note:assistantFeedbackExpectation(snap.out),context:report,assistant:true});
}

// Guides from the chat composer, shown while the user is composing or Needle
// waits on a choice: setting chips, one line of help, and Edit last request.
function detailSummaryGuideHint(session,active,draft){
  if(active){
    const help = assistantGuideHelp(active.id);
    return `${help.description}${help.example ? ` Example: ${help.example}.` : ''}`;
  }
  if(detailSummaryRevising)return 'Last request taken back. Edit it and send.';
  if(session.continuationError)return 'Draft kept. Continue, or edit the last request.';
  if(session.unresolved?.some(item=>item.field === 'guidance'))return 'Choose the setting or action you meant.';
  if(detailSummaryNeedsPick(session))return 'Pick the setting you meant, then add its value.';
  return '';
}

function renderDetailSummaryGuides(){
  const tray = $('detail-ask-guides');
  const list = $('detail-ask-guides-row');
  const inner = getSheetInner('detail-sheet');
  const input = $('detail-ask-input');
  if(!tray || !inner)return;
  const draft = detailSummaryDraft();
  const base = !$('detail-ask').hidden && !input.disabled && detailSummaryCanSend()
    && typeof assistantGuideSuggestions === 'function';
  const existing = detailSummary.session && assistantFocusAlive(detailSummary.session) ? detailSummary.session : null;
  const canRevise = Boolean(base && existing && assistantGuideCanRevise(existing));
  // Chips and help only while composing or when Needle needs a pick; an idle
  // tray keeps just Edit last request so it never covers the proposal.
  const noticeOnly = existing?.unresolved?.length && !detailSummaryNeedsPick(existing) && !draft.trim();
  const guiding = base && !noticeOnly && Boolean(draft.trim() || detailSummaryNeedsPick(existing) || detailSummaryRevising);
  const session = guiding || canRevise ? detailSummaryEnsureSession() : null;
  if(!session){
    tray.hidden = true;
    detailSummaryGuidesHeight(inner,0);
    return;
  }
  const hintSource = draft.trim() || String(session.currentRequest || (session.requests || []).at(-1) || '');
  const active = guiding ? assistantGuideRead(draft,session,true) : null;
  const suggestions = guiding ? assistantGuideSuggestions(session,hintSource) : [];
  const choosing = suggestions.some(item=>/^(?:action|field):/.test(item.id));
  const hint = guiding ? detailSummaryGuideHint(session,active,draft) : '';
  $('detail-ask-guides-label').hidden = !guiding;
  $('detail-ask-guides-label').textContent = active ? 'Change this setting'
    : choosing ? 'Which one?' : detailSummaryNeedsPick(session) ? 'Which setting?' : 'Settings you can change';
  $('detail-ask-hint').hidden = !hint;
  $('detail-ask-hint').textContent = hint;
  const revise = $('detail-ask-revise');
  revise.hidden = !canRevise;
  revise.disabled = Boolean(draft.trim());
  revise.title = draft.trim() ? 'Clear the message first.' : 'Take back the last unsaved request and edit it.';
  const signature = `${suggestions.map(item=>item.id).join(',')}|${active ? active.id : ''}`;
  if(list.dataset.signature !== signature){
    list.dataset.signature = signature;
    list.replaceChildren(...suggestions.map(item=>{
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'assistant-guide';
      button.dataset.detailGuide = item.id;
      button.dataset.guideLabel = item.label;
      button.textContent = item.label;
      button.title = /^(?:action|field):/.test(item.id) ? item.label : assistantGuideHelp(item.id).description;
      button.setAttribute('aria-pressed',active && active.id === item.id ? 'true' : 'false');
      return button;
    }));
  }
  list.hidden = !suggestions.length;
  tray.hidden = !suggestions.length && !hint && !canRevise;
  if(hint)input.setAttribute('aria-describedby','detail-ask-hint');
  else input.removeAttribute('aria-describedby');
  detailSummaryGuidesHeight(inner,tray.hidden ? 0 : tray.offsetHeight);
}

// The page reserves the tray's height; a reader at the end stays at the end.
function detailSummaryGuidesHeight(inner,height){
  const before = parseFloat(inner.style.getPropertyValue('--detail-ask-guides-h')) || 0;
  if(before === height)return;
  const page = inner.querySelector('.detail-summary-page');
  const scroller = detailIsSingleView() ? page?.closest('.detail-pager') : page;
  const atEnd = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  inner.style.setProperty('--detail-ask-guides-h',`${height}px`);
  if(atEnd && height > before)scroller.scrollTop = scroller.scrollHeight;
}

function detailSummaryApplyGuide(button){
  const session = detailSummary.session;
  const input = $('detail-ask-input');
  if(!session || input.disabled || detailSummary.busy)return;
  const id = button.dataset.detailGuide || '';
  if(/^(?:action|field):/.test(id)){
    assistantFocusChoose(session,'guidance',id);
    detailSummaryShowProposal();
    syncDetailSummaryDock();
    return;
  }
  detailSummaryComposer(assistantGuideCompose(detailSummaryDraft(),button.dataset.guideLabel,session));
  input.focus({preventScroll:true});
  try{ input.setSelectionRange(input.value.length,input.value.length); }catch(_){}
}

function detailSummaryReviseLast(){
  const session = detailSummary.session;
  if(!session || detailSummary.busy || detailSummaryDraft().trim())return;
  const request = assistantGuideRevise(session);
  if(request == null)return;
  detailSummaryRevising = true;
  [...detailSummaryThread().querySelectorAll('.assistant-bubble-user')].at(-1)?.remove();
  if(detailSummaryHasWork())detailSummaryShowProposal();
  else detailSummaryThread().querySelector('[data-detail-proposal]:not(.is-retired)')?.remove();
  if(!detailSummaryThread().children.length)$('detail-summary-chat').hidden = true;
  detailSummaryComposer(request);
  $('detail-ask-input').focus({preventScroll:true});
}

function detailSummarySetBusy(on){
  detailSummary.busy = on;
  syncDetailSummaryDock();
}

async function detailSummaryRead(session,text,opts){
  const turn = ++detailSummary.turn;
  detailSummarySetBusy(true);
  detailSummaryShowProposal({live:true});
  try{
    const out = await assistantFocusTurn(session,text,{
      ...opts,
      onProgress:info=>{
        if(turn === detailSummary.turn && info && (info.phase === 'staged' || info.phase === 'think'))detailSummaryShowProposal({live:true});
      }
    });
    if(turn === detailSummary.turn && !out?.cancelled)detailSummaryShowProposal();
  }catch(error){
    if(turn !== detailSummary.turn || error?.name === 'AbortError')return;
    detailSummaryShowProposal();
    detailSummaryBubble('say',error?.message || 'Needle could not read that.');
  }finally{
    if(turn === detailSummary.turn)detailSummarySetBusy(false);
  }
}

async function detailSummarySend(text){
  const value = String(text || '').trim();
  if(!value || detailSummary.busy || !detailSummaryAskReady())return false;
  if(getSheetInner('detail-sheet')?.classList.contains('tune-dirty')){
    showToast('Save or cancel your edits before asking for a change.');
    return false;
  }
  if(!detailSummaryCanSend()){
    detailSummaryComposer(value);
    showToast('Download Needle 3 to ask for changes');
    return false;
  }
  const session = detailSummaryEnsureSession();
  if(!session)return false;
  const outgoing = typeof assistantGuideOutgoing === 'function' ? assistantGuideOutgoing(value,session) : value;
  detailSummaryUserBubble(outgoing,session);
  detailSummaryRevising = false;
  detailSummaryComposer('');
  await detailSummaryRead(session,outgoing);
  return true;
}

function detailSummaryUserBubble(text,session){
  const bubble = detailSummaryBubble('user',text);
  const parsed = typeof assistantGuideParse === 'function' ? assistantGuideParse(text,session) : null;
  if(!parsed)return;
  const tag = `<span class="assistant-mention assistant-mention-static"><span class="assistant-mention-label">${escapeHtml(parsed.label)}</span></span>`;
  bubble.innerHTML = `<p class="assistant-user-line">${tag}${parsed.rest ? ` <span class="assistant-user-detail">${escapeHtml(parsed.rest)}</span>` : ''}</p>`;
}

function detailSummaryReveal(field,session,focus = true){
  const selector = assistantFocusDetailSelector(field,session);
  const control = selector && getSheetInner('detail-sheet')?.querySelector(selector);
  if(control)revealDetailSearchEntry({target:control,label:assistantFocusField(field)?.label || '',revealHidden:true,focus});
}

async function detailSummaryHandleProposal(target){
  const session = detailSummary.session;
  const button = target.closest('button');
  if(!session || detailSummary.busy || !button || button.disabled)return;
  const status = text=>{
    const line = button.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
    if(line)line.textContent = text;
  };
  const openItem = target.closest('[data-focus-open-item]');
  if(openItem){
    const index = load().findIndex(row=>row && row.hid === openItem.dataset.focusOpenItem);
    if(index < 0){status('That item is no longer available.');return;}
    const request = String(session.currentRequest || '');
    openDetail(index);
    detailSummaryComposer(request);
    syncDetailSummaryDock();
    return;
  }
  const openNav = target.closest('[data-focus-open-nav]');
  if(openNav){
    const nav = openNav.dataset.focusOpenNav;
    const page = detailSummaryNavPage(nav);
    if(page)page.hidden = false;
    scrollDetailToNav(nav,'smooth');
    return;
  }
  const drop = target.closest('[data-focus-drop]');
  if(drop){
    const fields = drop.dataset.focusDrop === 'rhythm' ? ['timesPerPeriod','periodDays','repeatMode'] : [drop.dataset.focusDrop];
    session.changes = session.changes.filter(change=>!fields.includes(change.field));
    session.unresolved = session.unresolved.filter(issue=>!fields.includes(issue.field));
    if(fields.includes('topics'))session.dependencies.topics = [];
    if(fields.includes('weatherRules'))session.dependencies.weatherProfile = null;
    session.savedFingerprint = '';session.interpretationApproved = null;
    detailSummaryShowProposal();
    return;
  }
  const field = target.closest('[data-focus-field]');
  if(field || target.closest('[data-focus-edit]')){
    const fieldId = field ? field.dataset.focusField
      : session.changes.map(change=>change.field).find(id=>assistantFocusDetailSelector(id,session));
    if(field && !assistantFocusDetailSelector(fieldId,session))return;
    if(!session.changes.length){status('There are no staged changes to open.');return;}
    const result = assistantFocusEditDraft(session);
    if(!result?.ok){status(result?.error || 'The detail editor is unavailable.');return;}
    detailSummaryRetireProposal('In editor');
    detailSummary.session = null;
    detailSummaryBubble('say','Opened in the editor with these changes. Save or cancel at the top.');
    if(fieldId)requestAnimationFrame(()=>detailSummaryReveal(fieldId,session));
    else if(session.changes.some(change=>change.field === 'name'))requestAnimationFrame(()=>openDetailNameEditor());
    return;
  }
  if(target.closest('[data-focus-save]')){
    button.disabled = true;
    const result = await assistantFocusCommit(session);
    if(result?.ok){
      detailSummaryRetireProposal('Saved');
      if(detailSummary.session === session)detailSummary.session = null;
      detailSummaryBubble('say','Saved. Undo is on the toast.');
      renderDetailSummaryOverview();
      return;
    }
    status(result?.error || 'Nothing was saved.');
    if(result?.stale)detailSummaryShowProposal();
    else button.disabled = !assistantFocusCanSave(session);
    return;
  }
  const choice = target.closest('[data-focus-choice]');
  if(!choice)return;
  const which = choice.dataset.focusChoice;
  const value = choice.dataset.focusValue || '';
  // A confirmed or dismissed action with nothing else staged ends that card.
  const settleAction = ()=>{
    if(detailSummaryHasWork()){detailSummaryShowProposal();return;}
    detailSummaryThread()?.querySelector('[data-detail-proposal]:not(.is-retired)')?.remove();
    detailSummary.session = null;
    syncDetailSummaryDock();
  };
  if(which === 'item-action-skip'){
    assistantFocusSkipAction(session,value);
    settleAction();
    if(!detailSummaryHasWork())detailSummaryBubble('say','Okay, nothing was logged or planned.');
    return;
  }
  if(which === 'item-action'){
    const result = assistantFocusCommitAction(session,value);
    if(!result.ok){status(result.error || 'Nothing was saved.');return;}
    settleAction();
    detailSummaryBubble('say',assistantFocusActionDoneText(result));
    refreshOpenViews();
    return;
  }
  if(which === 'resume'){
    await detailSummaryRead(session,'',{resume:true});
    return;
  }
  if(assistantFocusApplyChoice(session,which,value))detailSummaryShowProposal();
}

// Entry from search's Ask, the actions row and a home card. Opens the summary
// tab; an instruction is sent at once when Needle is ready, otherwise it waits
// in the composer.
function detailSummaryStart(instruction = '',opts = {}){
  if(!detailSummaryAskReady())return false;
  if(opts.occurrenceDate !== undefined && opts.occurrenceDate !== detailSummary.occurrenceDate && !detailSummary.busy){
    detailSummary.occurrenceDate = opts.occurrenceDate || '';
    if(!detailSummaryHasWork())detailSummary.session = null;
  }
  scrollDetailToNav('summary','auto');
  syncDetailSummaryDock();
  const text = String(instruction || '').trim();
  if(text && detailSummaryCanSend() && !detailSummary.busy){
    void detailSummarySend(text);
    return true;
  }
  if(text)detailSummaryComposer(text);
  requestAnimationFrame(()=>{
    const input = $('detail-ask-input');
    if(!input.disabled && !$('detail-ask').hidden)input.focus({preventScroll:true});
  });
  return true;
}

$('detail-summary').addEventListener('click',event=>{
  const pill = event.target.closest('[data-summary-field]');
  const item = detailSummaryRecord();
  if(!pill || !item || typeof assistantFocusSummarySession !== 'function')return;
  detailSummaryReveal(pill.dataset.summaryField,assistantFocusSummarySession(item),false);
});
detailSummaryThread().addEventListener('click',event=>{
  if(!event.target.closest('[data-focus-save],[data-focus-edit],[data-focus-choice],[data-focus-field],[data-focus-open-item],[data-focus-open-nav],[data-focus-drop]'))return;
  event.preventDefault();
  void detailSummaryHandleProposal(event.target);
});
$('detail-summary-clear').addEventListener('click',()=>{
  detailSummaryReset(detailSummary.hid);
  renderDetailSummaryOverview();
  syncDetailSummaryDock();
  if(!$('detail-ask').hidden)$('detail-ask-input').focus({preventScroll:true});
});
$('detail-summary-feedback').addEventListener('click',detailSummaryOpenFeedback);
$('detail-ask-input').addEventListener('input',()=>{
  detailSummaryAbsorbTag();
  detailSummaryResizeComposer();
  syncDetailSummaryDock();
});
$('detail-ask-input').addEventListener('keydown',event=>{
  const input = event.currentTarget;
  if(event.key === 'Backspace' && detailSummaryTagName() && input.selectionStart === 0 && input.selectionEnd === 0
    && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey){
    event.preventDefault();
    detailSummarySetTag('');
    syncDetailSummaryDock();
    return;
  }
  if(event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229)return;
  event.preventDefault();
  void detailSummarySend(detailSummaryDraft());
});
$('detail-ask-send').addEventListener('pointerdown',event=>{if(event.pointerType !== 'touch')event.preventDefault();});
$('detail-ask-send').addEventListener('click',()=>void detailSummarySend(detailSummaryDraft()));
$('detail-ask-tag-remove').addEventListener('pointerdown',event=>{if(event.pointerType !== 'touch')event.preventDefault();});
$('detail-ask-tag-remove').addEventListener('click',()=>{
  detailSummarySetTag('');
  syncDetailSummaryDock();
  $('detail-ask-input').focus({preventScroll:true});
});
// Guide taps keep the keyboard up, so the tray stays put while choosing.
$('detail-ask-guides').addEventListener('pointerdown',event=>{
  if(event.pointerType !== 'touch' && event.target.closest('button'))event.preventDefault();
});
$('detail-ask-guides').addEventListener('click',event=>{
  const guide = event.target.closest('[data-detail-guide]');
  if(guide && !guide.disabled){detailSummaryApplyGuide(guide);return;}
  if(event.target.closest('#detail-ask-revise'))detailSummaryReviseLast();
});
// Keep compact chrome through the keyboard's closing animation. Restoring it
// on blur would move the composer while the keyboard is still on screen.
function syncDetailSummaryTyping(keyboardVisible){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const typing = inner.classList.contains('detail-ask-on')
    && (document.activeElement === $('detail-ask-input')
      || (inner.classList.contains('detail-ask-typing') && keyboardVisible));
  if(inner.classList.contains('detail-ask-typing') === typing)return;
  inner.classList.toggle('detail-ask-typing',typing);
  detailSummaryResizeComposer();
  renderDetailSummaryGuides();
}
// The dock follows viewport events. Focusing it must not start a delayed
// conversation scroll partway through the OS keyboard animation.
// iOS's native tap-to-focus centers even a fixed input before viewport events
// arrive. A body lock cannot stop that visual pan. Own the initial tap, focus
// synchronously inside the gesture, and keep only the textarea above the
// viewport during Safari's focus calculation. Restore it before the next paint;
// its in-flow composer and the rest of detail never move for this workaround.
// Same approach as React Aria's mobile Safari focus guard:
// https://github.com/adobe/react-spectrum/blob/@react-aria/overlays@3.24.0/packages/@react-aria/overlays/src/usePreventScroll.ts
let detailSummaryFocusRestore = null;
let detailSummaryFocusTouch = null;
function detailSummaryGuardIOSFocus(){
  return !paneTierActive() && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
function detailSummaryPrepareFocus(){
  if(!detailSummaryGuardIOSFocus() || detailSummaryFocusRestore !== null)return;
  const input = $('detail-ask-input');
  const transform = input.style.transform;
  input.style.transform = 'translateY(-200vh)';
  detailSummaryFocusRestore = requestAnimationFrame(()=>{
    input.style.transform = transform;
    detailSummaryFocusRestore = null;
  });
}
$('detail-ask-input').addEventListener('touchstart',event=>{
  const touch = event.touches.length === 1 ? event.touches[0] : null;
  detailSummaryFocusTouch = detailSummaryGuardIOSFocus() && touch
    ? {id:touch.identifier,x:touch.clientX,y:touch.clientY} : null;
},{passive:true});
$('detail-ask-input').addEventListener('touchmove',event=>{
  const touch = event.touches[0],start = detailSummaryFocusTouch;
  if(!start || event.touches.length !== 1 || touch.identifier !== start.id
    || Math.hypot(touch.clientX-start.x,touch.clientY-start.y) > 8)detailSummaryFocusTouch = null;
},{passive:true});
$('detail-ask-input').addEventListener('touchcancel',()=>{detailSummaryFocusTouch = null;},{passive:true});
$('detail-ask-input').addEventListener('touchend',event=>{
  const start = detailSummaryFocusTouch;
  detailSummaryFocusTouch = null;
  const input = event.currentTarget;
  if(!start || event.touches.length || !event.cancelable || event.defaultPrevented
    || !Array.from(event.changedTouches).some(touch=>touch.identifier === start.id)
    || input.disabled || document.activeElement === input)return;
  event.preventDefault();
  detailSummaryPrepareFocus();
  input.focus({preventScroll:true});
},{passive:false});
$('detail-ask-input').addEventListener('focus',()=>{
  // Also cover focus restored by a guide, tag removal or hardware keyboard.
  detailSummaryPrepareFocus();
  updateKeyboardLift();
});
$('detail-ask-input').addEventListener('blur',()=>{
  requestAnimationFrame(()=>{
    if(document.activeElement === $('detail-ask-input'))return;
    renderDetailSummaryGuides();
    updateKeyboardLift();
  });
});
document.addEventListener('tings-needle-state',()=>{
  if(detailSummary.hid)renderDetailSummaryOverview();
  syncDetailSummaryDock();
});
