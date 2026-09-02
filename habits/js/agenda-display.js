const AGENDA_STALE_MS = 24 * 60 * 60 * 1000;
const AGENDA_POLL_MS = 3 * 60 * 1000;
const AGENDA_PAIR_POLL_MS = 4 * 1000;
const AGENDA_DISPLAY_STORAGE_KEY = typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
  ? AGENDA_DISPLAY_KEY
  : 'tings_agenda_display_v3';
const AGENDA_WALLPAPER_STORAGE_KEY = 'tings_agenda_wallpaper_v1';
const AGENDA_APPEARANCE_STORAGE_KEY = 'tings_agenda_appearance_v1';
// Dark is the deliberate default: these displays live on photo frames and are
// read across the room at night. Light/system stay one tap away in the menu.
// Text size is a percentage on a 5% ladder between 70 and 200 — the range is
// deliberately wide so a small frame can be tuned precisely from across the room.
const AGENDA_APPEARANCE_DEFAULT = { theme:'dark', font:100 };
const AGENDA_FONT_MIN = 70;
const AGENDA_FONT_MAX = 200;
const AGENDA_FONT_STEP = 5;
// The first menu shipped named sizes; map any stored legacy value onto the ladder.
const AGENDA_FONT_LEGACY = { small:90, medium:100, large:115 };
// Some frames stretch their panel vertically; "screen fit" pre-squashes the
// page (85–100%) so geometry looks right on the glass. 100% = untouched.
const AGENDA_FIT_MIN = 85;
const AGENDA_FIT_MAX = 100;
const AGENDA_FIT_STEP = 1;
// A mark-done tap renders the row done immediately but only pushes the
// completion to the feed once this toast expires; tapping Undo cancels the
// push entirely. One pending mark at a time — marking another row pushes the
// previous one right away.
const AGENDA_COMPLETION_UNDO_MS = 5000;
// Upper bound for the delayed push itself: a hung connection must release the
// row back into a tappable, error-marked state instead of spinning forever.
const AGENDA_COMPLETION_TIMEOUT_MS = 15000;

let _displayPollTimer = null;
let _displayPairPollTimer = null;
let _displayPairExpiryTimer = null;
let _displayFeed = null;
let _displayPairing = null;
let _displayProjection = null;
let _displayClockTimer = null;
let _displayTouchStart = null;
let _displaySwipedAt = 0;
let _displayWallpaperTaps = [];
let _displayPendingCompletion = null;
const _displaySavingRowIds = new Set();

function clampDisplayFont(value){
  const stepped = Math.round(value / AGENDA_FONT_STEP) * AGENDA_FONT_STEP;
  return Math.min(AGENDA_FONT_MAX,Math.max(AGENDA_FONT_MIN,stepped));
}

function clampDisplayFit(value){
  const stepped = Math.round(value / AGENDA_FIT_STEP) * AGENDA_FIT_STEP;
  return Math.min(AGENDA_FIT_MAX,Math.max(AGENDA_FIT_MIN,stepped));
}

function syncDisplayFullscreenMenu(){
  const row = $('agenda-menu-fullscreen-row');
  const button = $('agenda-menu-fullscreen');
  const supported = typeof document.documentElement.requestFullscreen === 'function';
  if(row) row.hidden = !supported;
  if(!button || !supported)return;
  const active = Boolean(document.fullscreenElement);
  button.textContent = active ? 'exit full screen' : 'enter full screen';
  button.setAttribute('aria-pressed',String(active));
  button.classList.toggle('is-on',active);
}

async function toggleDisplayFullscreen(){
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI:'hide' });
  }catch(_){
    const button = $('agenda-menu-fullscreen');
    if(button){
      button.classList.add('is-error');
      setTimeout(()=>button.classList.remove('is-error'),1200);
    }
  }finally{
    syncDisplayFullscreenMenu();
  }
}

function displayWallpaperStored(){
  try{ return localStorage.getItem(AGENDA_WALLPAPER_STORAGE_KEY) === 'hidden'; }
  catch(_){ return false; }
}

function displayWriteWallpaper(active){
  try{
    if(active) localStorage.setItem(AGENDA_WALLPAPER_STORAGE_KEY,'hidden');
    else localStorage.removeItem(AGENDA_WALLPAPER_STORAGE_KEY);
  }catch(_){}
}

function readAgendaAppearance(){
  let stored = null;
  try{ stored = JSON.parse(localStorage.getItem(AGENDA_APPEARANCE_STORAGE_KEY) || 'null'); }
  catch(_){ stored = null; }
  const theme = stored && (stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'system')
    ? stored.theme
    : AGENDA_APPEARANCE_DEFAULT.theme;
  const rawFont = stored ? stored.font : null;
  const font = clampDisplayFont(
    typeof rawFont === 'number' ? rawFont
      : typeof rawFont === 'string' && AGENDA_FONT_LEGACY[rawFont] ? AGENDA_FONT_LEGACY[rawFont]
      : AGENDA_APPEARANCE_DEFAULT.font
  );
  const squish = clampDisplayFit(
    stored && typeof stored.squish === 'number' ? stored.squish : AGENDA_FIT_MAX
  );
  return { theme,font,squish };
}

function writeAgendaAppearance(value){
  try{ localStorage.setItem(AGENDA_APPEARANCE_STORAGE_KEY,JSON.stringify(value)); }
  catch(_){}
}

function syncAgendaMenuState(settings){
  document.querySelectorAll('[data-theme-opt]').forEach(button=>{
    button.classList.toggle('is-on',button.dataset.themeOpt === settings.theme);
  });
  const fontValue = $('agenda-font-value');
  if(fontValue) fontValue.textContent = `${settings.font}%`;
  const fontMinus = $('agenda-font-minus');
  if(fontMinus) fontMinus.disabled = settings.font <= AGENDA_FONT_MIN;
  const fontPlus = $('agenda-font-plus');
  if(fontPlus) fontPlus.disabled = settings.font >= AGENDA_FONT_MAX;
  const fitValue = $('agenda-fit-value');
  if(fitValue) fitValue.textContent = `${settings.squish}%`;
  const fitMinus = $('agenda-fit-minus');
  if(fitMinus) fitMinus.disabled = settings.squish <= AGENDA_FIT_MIN;
  const fitPlus = $('agenda-fit-plus');
  if(fitPlus) fitPlus.disabled = settings.squish >= AGENDA_FIT_MAX;
}

function applyAgendaAppearance(settings){
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.font = String(settings.font);
  root.dataset.squish = String(settings.squish);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if(meta) meta.content = settings.theme === 'system' ? 'light dark' : settings.theme;
  syncAgendaMenuState(settings);
}

function setAgendaMenuOpen(open){
  const menu = $('agenda-menu');
  const button = $('agenda-more');
  if(!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded',String(open));
}

function updateDisplayNightClock(){
  const now = new Date();
  const time = $('agenda-wallpaper-time');
  const date = $('agenda-wallpaper-date');
  if(time) time.textContent = now.toLocaleTimeString(undefined,{ hour:'numeric',minute:'2-digit' });
  if(date) date.textContent = now.toLocaleDateString(undefined,{ weekday:'long',month:'long',day:'numeric' });
}

function updateDisplayClocks(){
  const now = new Date();
  const clock = $('agenda-clock');
  if(clock){
    const parts = new Intl.DateTimeFormat(undefined,{ hour:'numeric',minute:'2-digit' }).formatToParts(now);
    const dayPeriod = parts.find(part=>part.type === 'dayPeriod')?.value || '';
    const digits = parts.filter(part=>part.type !== 'dayPeriod').map(part=>part.value).join('').trim();
    clock.innerHTML = `${escapeDisplay(digits)}${dayPeriod ? `<span class="agenda-clock-mer">${escapeDisplay(dayPeriod)}</span>` : ''}`;
  }
  updateDisplayNightClock();
}

function startDisplayClock(){
  if(_displayClockTimer) clearInterval(_displayClockTimer);
  updateDisplayClocks();
  _displayClockTimer = setInterval(updateDisplayClocks,10 * 1000);
}

function setDisplayWallpaper(active,opts = {}){
  const page = $('agenda-page');
  const wallpaper = $('agenda-wallpaper');
  if(!page || !wallpaper) return;
  page.hidden = active;
  wallpaper.hidden = !active;
  // Paint the root black while the night screen is up so the strip reclaimed
  // by the "screen fit" squash stays invisible in every theme.
  document.documentElement.dataset.night = String(active);
  if(!active) _displayWallpaperTaps = [];
  displayWriteWallpaper(active);
  if(active){
    updateDisplayNightClock();
    if(opts.focus !== false) wallpaper.focus({ preventScroll:true });
  }else{
    if(opts.focus !== false) $('agenda-hide')?.focus({ preventScroll:true });
    if(document.visibilityState === 'visible') void refreshDisplay();
  }
}

function displaySwipeFromTouch(dx,dy){
  if(Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.75) return;
  setAgendaMenuOpen(false);
  const wallpaper = $('agenda-wallpaper');
  // A swipe left still tucks the agenda behind the night clock, but a swipe
  // never brings it back — restoring the agenda deliberately requires three
  // taps so a stray brush of the frame cannot flash it.
  if(dx < 0 && wallpaper && wallpaper.hidden){
    _displaySwipedAt = Date.now();
    setDisplayWallpaper(true);
  }
}

document.addEventListener('touchstart',event=>{
  if(!event.touches || event.touches.length !== 1){
    _displayTouchStart = null;
    return;
  }
  const target = event.target;
  if(target && target.closest && target.closest('button,.agenda-menu,a,input,textarea')){
    _displayTouchStart = null;
    return;
  }
  _displayTouchStart = { x:event.touches[0].clientX,y:event.touches[0].clientY };
},{ passive:true });

document.addEventListener('touchend',event=>{
  if(!_displayTouchStart || !event.changedTouches || !event.changedTouches.length){
    _displayTouchStart = null;
    return;
  }
  const touch = event.changedTouches[0];
  const dx = touch.clientX - _displayTouchStart.x;
  const dy = touch.clientY - _displayTouchStart.y;
  _displayTouchStart = null;
  displaySwipeFromTouch(dx,dy);
},{ passive:true });

function purgeLegacyDisplayEnrollments(){
  // v2 was shared by the retired link/code enrollment and the first QR build.
  // Those records have the same fields, so no client-side test can safely tell
  // them apart. Fail closed and require one fresh QR pairing for the v3 key.
  for(const legacyKey of ['tings_agenda_display_v1','tings_agenda_display_v2']){
    if(legacyKey === AGENDA_DISPLAY_STORAGE_KEY) continue;
    try{ localStorage.removeItem(legacyKey); }catch(_){}
  }
}

function displayReadEnrollment(){
  try{ return JSON.parse(localStorage.getItem(AGENDA_DISPLAY_STORAGE_KEY) || 'null'); }
  catch(_){ return null; }
}

function displayWriteEnrollment(value){
  try{
    if(value) localStorage.setItem(AGENDA_DISPLAY_STORAGE_KEY,JSON.stringify(value));
    else localStorage.removeItem(AGENDA_DISPLAY_STORAGE_KEY);
  }catch(_){}
}

function clearAgendaFragment(){
  try{ history.replaceState(null,'',location.pathname + location.search); }
  catch(_){}
}

function displayAge(ts,now = Date.now()){
  if(!ts) return 'waiting for first plan';
  const mins = Math.max(0,Math.round((now - ts) / 60000));
  if(mins < 1) return 'Updated just now';
  if(mins === 1) return 'Updated 1 minute ago';
  if(mins < 60) return `Updated ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if(hours === 1) return 'Updated 1 hour ago';
  if(hours < 24) return `Updated ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Updated 1 day ago' : `Updated ${days} days ago`;
}

function displayTimezone(value){
  const candidate = value || 'UTC';
  try{
    new Intl.DateTimeFormat('en',{ timeZone:candidate }).format(0);
    return candidate;
  }catch(_){ return 'UTC'; }
}

function displayDateKey(ts,timeZone){
  const parts = new Intl.DateTimeFormat('en',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(ts));
  const values = {};
  for(const part of parts) if(part.type !== 'literal') values[part.type] = part.value;
  return `${values.year}-${values.month}-${values.day}`;
}

function displayClockParts(ts,timeZone){
  const value = new Intl.DateTimeFormat(undefined,{
    hour:'numeric',minute:'2-digit',timeZone
  }).formatToParts(new Date(ts));
  const dayPeriod = value.find(part=>part.type === 'dayPeriod')?.value || '';
  const clock = value
    .filter(part=>part.type !== 'dayPeriod')
    .map(part=>part.value)
    .join('')
    .trim();
  return { clock,dayPeriod };
}

// The start time leads in a large, bold line; the end time follows on its own
// smaller, muted line. Duration-only rows fall back to "N min" in the start slot.
function displayRowWhen(row,timeZone){
  if(row.start){
    const start = displayClockParts(row.start,timeZone);
    const startHtml = `<span class="agenda-time-start">${escapeDisplay(start.clock)}${start.dayPeriod ? `<span class="agenda-time-mer">${escapeDisplay(start.dayPeriod)}</span>` : ''}</span>`;
    if(row.end){
      const end = displayClockParts(row.end,timeZone);
      const endLabel = end.dayPeriod ? `${end.clock} ${end.dayPeriod}` : end.clock;
      return `${startHtml}<span class="agenda-time-end">→ ${escapeDisplay(endLabel)}</span>`;
    }
    return startHtml;
  }
  if(row.durationMinutes) return `<span class="agenda-time-start">${escapeDisplay(String(row.durationMinutes))} min</span>`;
  return '';
}

const DISPLAY_EMOJI_BG_TOKENS = new Set(['teal','amber','red','purple','blue','green','pink','orange','indigo','cyan','lime','slate']);

function displayEmojiBgClass(value){
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DISPLAY_EMOJI_BG_TOKENS.has(token) ? ` emoji-bg-${token}` : '';
}

function displayRowMark(row,kind,canComplete,isComplete){
  const symbol = row.emoji || (kind === 'travel' ? '↗' : kind === 'busy' ? '—' : kind === 'open' ? '+' : '•');
  const symbolHtml = `<span class="agenda-mark-symbol" aria-hidden="true">${escapeDisplay(symbol)}</span>`;
  if(canComplete){
    const label = isComplete ? `${row.title} is done` : `Mark ${row.title} done`;
    return `<button type="button" class="agenda-mark is-markable${displayEmojiBgClass(row.emojiBgColor)}${isComplete ? ' is-done' : ''}" data-complete-row="${escapeDisplay(row.rowId)}"${isComplete ? ' disabled' : ''} aria-label="${escapeDisplay(label)}">${symbolHtml}<span class="agenda-mark-check" aria-hidden="true">✓</span></button>`;
  }
  return `<span class="agenda-mark is-view-only${displayEmojiBgClass(row.emojiBgColor)}" aria-hidden="true">${symbolHtml}</span>`;
}

function renderDisplay(projection,meta,completedRowIds = []){
  const now = Date.now();
  const root = $('agenda-root');
  const banner = $('agenda-banner');
  const updated = $('agenda-updated');
  if(!root) return;
  if(meta && meta.error === 'revoked'){
    banner.hidden = false;
    banner.textContent = 'This display was revoked. Scan the fresh QR below from inside Tings on the owner phone to authorize it again.';
  }else if(meta && meta.error === 'reauth'){
    banner.hidden = false;
    banner.textContent = 'Authorization expired or was rotated. Scan the fresh QR below from inside Tings on the owner phone.';
  }else if(meta && meta.error === 'waiting'){
    banner.hidden = false;
    banner.textContent = 'This display is authorized. Waiting for the owner’s app to publish today’s plan.';
  }else if(meta && meta.error === 'error'){
    banner.hidden = false;
    banner.textContent = 'Could not load the agenda. Check the connection and retry.';
  }else if(meta && meta.paused){
    banner.hidden = false;
    banner.textContent = 'This shared display is paused. Marking items done is unavailable until publishing resumes.';
  }else if(meta && meta.generatedAt && now - meta.generatedAt > AGENDA_STALE_MS){
    banner.hidden = false;
    banner.textContent = 'This plan is more than a day old. The owner’s app has not published a newer agenda.';
  }else{
    banner.hidden = true;
    banner.textContent = '';
  }
  if(updated) updated.textContent = displayAge(meta && meta.generatedAt,now);
  if(!projection || !Array.isArray(projection.days)){
    _displayProjection = null;
    dropPendingDisplayCompletion();
    root.innerHTML = '<p class="agenda-empty">No agenda on this display yet.</p>';
    return;
  }
  _displayProjection = projection;
  // The undo toast promises a push that must still be possible: if a refresh
  // made the pending row unmarkable (paused, unpublished, day rolled over),
  // drop it here so the row and the toast can never disagree.
  if(_displayPendingCompletion && !displayMarkableRow(_displayPendingCompletion.rowId)){
    dropPendingDisplayCompletion();
  }
  const completed = new Set(Array.isArray(completedRowIds) ? completedRowIds : []);
  const tz = displayTimezone(projection.timezone);
  const title = $('agenda-title');
  if(title) title.textContent = String(projection.title || 'Shared display').slice(0,80);
  const days = projection.days.slice(0,2);
  const todayKey = displayDateKey(now,tz);
  const currentDayIndex = Math.max(0,days.findIndex(day=>day && day.dateKey === todayKey));
  let renderedRows = 0;
  root.innerHTML = days.map((day,index)=>{
    const current = index === currentDayIndex;
    const safeRows = Array.isArray(day.rows) ? day.rows : [];
    const rows = safeRows.slice(0,Math.max(0,50 - renderedRows)).map(row=>{
      renderedRows += 1;
      const kind = ['item','busy','travel','open'].includes(row.kind) ? row.kind : 'item';
      const when = displayRowWhen(row,tz);
      const extra = kind === 'travel'
        ? [row.travelFromLabel,row.travelToLabel].filter(Boolean).join(' → ')
        : row.locationLabel;
      const currentRow = current && row.start && row.end && now >= row.start && now < row.end;
      const nextRow = current && row.start && now < row.start;
      const canComplete = !meta?.paused && kind === 'item' && row.completable === true && day.dateKey <= todayKey;
      const isComplete = canComplete && (completed.has(row.rowId)
        || (_displayPendingCompletion && _displayPendingCompletion.rowId === row.rowId)
        || _displaySavingRowIds.has(row.rowId));
      return `<article class="agenda-row ${kind}${currentRow ? ' is-now' : ''}${nextRow ? ' is-next' : ''}${isComplete ? ' is-complete' : ''}">
        ${displayRowMark(row,kind,canComplete,isComplete)}
        <div class="agenda-row-copy">
          <b>${escapeDisplay(row.title)}</b>
          ${extra ? `<small>${escapeDisplay(extra)}</small>` : ''}
        </div>
        <time>${when}</time>
      </article>`;
    }).join('') || '<p class="agenda-empty">Nothing planned.</p>';
    return `<section class="agenda-day${current ? ' is-today' : ''}">
      <header><h2>${escapeDisplay(day.weekdayLabel || day.dateLabel)}</h2><p>${escapeDisplay(day.dateLabel)}</p></header>
      ${rows}
    </section>`;
  }).join('');
}

function displayCompletionRow(rowId){
  if(!_displayProjection || !Array.isArray(_displayProjection.days)) return null;
  for(const day of _displayProjection.days){
    const row = Array.isArray(day && day.rows) ? day.rows.find(item=>item && item.rowId === rowId) : null;
    if(row) return { row,day };
  }
  return null;
}

function displayMarkableRow(rowId){
  // Owner projections issue 16-hex row ids; validating here keeps the
  // template-literal querySelectors downstream safe for any input.
  const key = String(rowId || '');
  if(!/^[0-9a-f]{16}$/.test(key)) return null;
  const enrolled = _displayFeed || displayReadEnrollment();
  const target = displayCompletionRow(key);
  if(!enrolled || !enrolled.deviceCredential || !target || target.row.completable !== true) return null;
  if(enrolled.meta && enrolled.meta.paused) return null;
  const tz = displayTimezone(_displayProjection && _displayProjection.timezone);
  if(String(target.day.dateKey || '') > displayDateKey(Date.now(),tz)) return null;
  return target;
}

// The commit captures the enrollment before its network round-trip. If the
// display de-paired or re-paired meanwhile, the enroll screen owns the UI —
// persisting or re-rendering then would resurrect stale credentials.
function displayAuthorizationMatches(candidate){
  const current = _displayFeed || displayReadEnrollment();
  return Boolean(current && candidate
    && current.feedId === candidate.feedId
    && current.deviceCredential === candidate.deviceCredential);
}

function showDisplayUndoToast(text){
  const toast = $('agenda-undo');
  const label = $('agenda-undo-text');
  if(!toast || !label) return;
  label.textContent = text;
  toast.hidden = false;
}

function hideDisplayUndoToast(){
  const toast = $('agenda-undo');
  if(toast) toast.hidden = true;
}

function renderCurrentDisplay(){
  const enrolled = _displayFeed || displayReadEnrollment();
  renderDisplay(_displayProjection,enrolled && enrolled.meta || {},enrolled && enrolled.completionRowIds);
}

function dropPendingDisplayCompletion(){
  const pending = _displayPendingCompletion;
  if(!pending) return;
  if(pending.timer) clearTimeout(pending.timer);
  _displayPendingCompletion = null;
  hideDisplayUndoToast();
}

// Tap-to-undo: the row reads as done right away, the push happens only when
// the toast expires, and Undo restores the row without any request.
function beginDisplayCompletion(rowId){
  if(_displaySavingRowIds.has(rowId)) return; // push already in flight
  const target = displayMarkableRow(rowId);
  if(!target) return;
  if(_displayPendingCompletion && _displayPendingCompletion.rowId !== rowId){
    void commitDisplayCompletion(_displayPendingCompletion.rowId);
  }else if(_displayPendingCompletion){
    dropPendingDisplayCompletion();
  }
  _displayPendingCompletion = {
    rowId,
    timer:setTimeout(()=>void commitDisplayCompletion(rowId),AGENDA_COMPLETION_UNDO_MS)
  };
  renderCurrentDisplay();
  showDisplayUndoToast(`Marked “${target.row.title || 'item'}” done`);
}

function cancelDisplayCompletion(){
  const pending = _displayPendingCompletion;
  if(!pending) return;
  dropPendingDisplayCompletion();
  renderCurrentDisplay();
  document.querySelector(`[data-complete-row="${pending.rowId}"]`)?.focus({ preventScroll:true });
}

async function commitDisplayCompletion(rowId){
  const pending = _displayPendingCompletion && _displayPendingCompletion.rowId === rowId
    ? _displayPendingCompletion
    : null;
  if(pending) dropPendingDisplayCompletion();
  const enrolled = _displayFeed || displayReadEnrollment();
  const target = displayMarkableRow(rowId);
  if(!enrolled || !enrolled.deviceCredential || !target){
    renderCurrentDisplay();
    return;
  }
  _displaySavingRowIds.add(rowId);
  const button = document.querySelector(`[data-complete-row="${rowId}"]`);
  if(button){
    button.disabled = true;
    button.classList.add('is-saving');
    button.setAttribute('aria-label',`Saving ${target.row.title || 'item'} as done`);
  }
  const operationId = shareRandomHex(16);
  const revision = Number(enrolled.meta && enrolled.meta.revision);
  try{
    if(!Number.isInteger(revision) || revision < 1) throw new Error('stale_snapshot');
    const payload = { schemaVersion:1,action:'complete',operationId,rowId };
    const envelope = await shareEncrypt(enrolled.contentKey,payload,{
      schemaVersion:SHARE_SCHEMA_VERSION,
      recordKind:'agenda_completion',
      objectId:enrolled.feedId,
      revision,
      operationId,
      logId:rowId
    });
    await shareFetch(`/v1/agendas/${enrolled.feedId}/completions`,{
      method:'POST',
      credential:enrolled.deviceCredential,
      body:{ completion:envelope },
      timeoutMs:AGENDA_COMPLETION_TIMEOUT_MS
    });
    // Merge into the live enrollment, never the captured one: a refresh may
    // have stored a newer revision or acknowledged other rows meanwhile.
    // And if the display de-paired or re-paired while the push was in flight,
    // the enroll screen owns the UI — stale credentials must not come back.
    if(!displayAuthorizationMatches(enrolled)){
      _displaySavingRowIds.delete(rowId);
      return;
    }
    const stored = _displayFeed || displayReadEnrollment();
    const base = Array.isArray(stored.completionRowIds) ? stored.completionRowIds : [];
    const completionRowIds = [...new Set([...base,rowId])].slice(-50);
    const next = { ...stored,completionRowIds };
    _displayFeed = next;
    displayWriteEnrollment(next);
    _displaySavingRowIds.delete(rowId);
    renderDisplay(_displayProjection,next.meta || {},completionRowIds);
  }catch(error){
    _displaySavingRowIds.delete(rowId);
    // Same guard as the success path: never paint the agenda (or an error
    // state) back over an enroll screen that appeared while we were in flight.
    if(!displayAuthorizationMatches(enrolled)) return;
    renderCurrentDisplay();
    const failed = document.querySelector(`[data-complete-row="${rowId}"]`);
    if(failed){
      failed.disabled = false;
      failed.classList.remove('is-saving');
      failed.classList.add('is-error');
      failed.setAttribute('aria-label',error && error.status === 429 ? 'Please wait, then try marking done again' : `Try marking ${target.row.title || 'item'} done again`);
    }
    if(error && (error.status === 401 || error.status === 410)) clearDisplayAuthorization(error.status === 410 ? 'revoked' : 'reauth');
    else if(error && error.status === 409) void refreshDisplay();
  }
}

function escapeDisplay(value){
  return String(value || '').replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function stopDisplayPairing(){
  if(_displayPairPollTimer) clearInterval(_displayPairPollTimer);
  if(_displayPairExpiryTimer) clearInterval(_displayPairExpiryTimer);
  _displayPairPollTimer = null;
  _displayPairExpiryTimer = null;
  _displayPairing = null;
}

function expireDisplayPairing(message = 'This QR expired. Generate a fresh one when the owner phone is ready.'){
  stopDisplayPairing();
  const qr = $('agenda-pair-qr');
  if(qr) qr.innerHTML = '';
  const code = $('agenda-pair-code');
  if(code) code.textContent = 'expired';
  const expiry = $('agenda-pair-expiry');
  if(expiry) expiry.textContent = '';
  const status = $('agenda-enroll-status');
  if(status) status.textContent = message;
  const button = $('agenda-pair-new');
  if(button) button.hidden = false;
}

function renderDisplayPairingQr(pairing){
  if(typeof qrcode !== 'function') throw new Error('qr_unavailable');
  const qr = qrcode(0,'M');
  qr.addData(agendaPairingOwnerHref(pairing),'Byte');
  qr.make();
  $('agenda-pair-qr').innerHTML = qr.createSvgTag({
    cellSize:6,
    margin:4,
    scalable:true,
    title:'Authorize this shared display',
    alt:'Scan with the owner phone to open Tings'
  });
}

function updateDisplayPairingExpiry(){
  if(!_displayPairing) return;
  const seconds = Math.max(0,Math.ceil((_displayPairing.expiresAt - Date.now()) / 1000));
  const expiry = $('agenda-pair-expiry');
  if(expiry) expiry.textContent = seconds > 0 ? `Expires in ${seconds} seconds` : '';
  if(seconds <= 0) expireDisplayPairing();
}

async function beginDisplayPairing(reason = 'new'){
  stopDisplayPairing();
  const section = $('agenda-enroll');
  if(section) section.hidden = false;
  const root = $('agenda-root');
  if(root) root.innerHTML = '';
  const updated = $('agenda-updated');
  if(updated) updated.textContent = reason === 'new' ? 'Not paired' : 'Reauthorization required';
  const status = $('agenda-enroll-status');
  const button = $('agenda-pair-new');
  if(button) button.hidden = true;
  if(status) status.textContent = 'Creating a 30-second, single-use request…';
  const code = $('agenda-pair-code');
  if(code) code.textContent = '';
  const qr = $('agenda-pair-qr');
  if(qr) qr.innerHTML = '';
  try{
    const pairing = await shareNewAgendaPairingRequest();
    const result = await shareFetch('/v1/agenda-pairings',{
      method:'POST',
      body:{
        pairingId:pairing.pairingId,
        pollCredential:pairing.pollCredential,
        deviceCredentialHash:pairing.deviceCredentialHash,
        confirmationProof:pairing.confirmationProof,
        displayPublicKey:pairing.displayPublicKey
      }
    });
    pairing.expiresAt = Number(result.body && result.body.expiresAt) || (Date.now() + 30 * 1000);
    _displayPairing = pairing;
    renderDisplayPairingQr(pairing);
    if(code) code.textContent = shareFormatAgendaPairCode(pairing.confirmationCode);
    if(status) status.textContent = 'Open Tings on the owner phone and use its “scan display QR” button. Then type this code and approve before 30 seconds pass.';
    updateDisplayPairingExpiry();
    _displayPairExpiryTimer = setInterval(updateDisplayPairingExpiry,1000);
    _displayPairPollTimer = setInterval(()=>void pollDisplayPairing(),AGENDA_PAIR_POLL_MS);
  }catch(error){
    expireDisplayPairing(error && error.status === 429
      ? 'Too many pairing requests. Wait one minute, then generate a fresh QR.'
      : 'Could not create a pairing request. Check the connection and try again.');
  }
}

async function pollDisplayPairing(){
  const pairing = _displayPairing;
  if(!pairing || pairing.expiresAt <= Date.now()) return;
  try{
    const result = await shareFetch(`/v1/agenda-pairings/${pairing.pairingId}/status`,{
      credential:pairing.pollCredential
    });
    if(!result.body || result.body.state !== 'approved') return;
    const feedId = result.body.feedId;
    const contentKey = await shareAgendaPairDecrypt(
      result.body.transfer,
      pairing.privateKey,
      feedId,
      pairing.pairingId
    );
    const enrolled = {
      feedId,
      contentKey,
      deviceCredential:pairing.deviceCredential,
      sessionExpiresAt:Number(result.body.sessionExpiresAt) || null
    };
    _displayFeed = enrolled;
    displayWriteEnrollment(enrolled);
    try{
      await shareFetch(`/v1/agenda-pairings/${pairing.pairingId}/consume`,{
        method:'POST',credential:pairing.pollCredential
      });
    }catch(_){}
    stopDisplayPairing();
    $('agenda-enroll').hidden = true;
    $('agenda-enroll-status').textContent = '';
    await refreshDisplay();
    startDisplayPolling();
  }catch(error){
    if(error && (error.status === 410 || error.message === 'pairing_unavailable')){
      expireDisplayPairing();
    }else if(error && (error.status === 401 || error.message === 'invalid_pairing_transfer' || error.message === 'invalid_pairing_key')){
      expireDisplayPairing('Security verification failed. Generate a fresh QR and scan it again.');
    }else if(error && error.status !== 429){
      const status = $('agenda-enroll-status');
      if(status) status.textContent = 'Waiting for the owner phone. The connection will retry until this QR expires.';
    }
  }
}

async function refreshDisplay(opts = {}){
  const enrolled = _displayFeed || displayReadEnrollment();
  if(!enrolled || !enrolled.deviceCredential) return;
  if(enrolled.sessionExpiresAt && Number(enrolled.sessionExpiresAt) <= Date.now()){
    clearDisplayAuthorization('reauth');
    return;
  }
  try{
    const result = await shareFetch(`/v1/agendas/${enrolled.feedId}`,{ credential:enrolled.deviceCredential });
    if(!result.body || !result.body.snapshot){
      renderDisplay(null,{ error:'waiting' });
      return;
    }
    const projection = await shareDecrypt(enrolled.contentKey,result.body.snapshot);
    const meta = {
      generatedAt:projection.generatedAt,
      revision:result.body.revision,
      paused:result.body.paused,
      error:null
    };
    const next = {
      ...enrolled,
      sessionExpiresAt:Number(result.body.sessionExpiresAt) || enrolled.sessionExpiresAt || null,
      snapshot:result.body.snapshot,
      meta
    };
    const completionRowIds = (Array.isArray(result.body.completions) ? result.body.completions : [])
      .map(record=>record && record.envelope && record.envelope.logId)
      .filter(value=>/^[0-9a-f]{16}$/.test(String(value || '')))
      .slice(-50);
    next.completionRowIds = completionRowIds;
    _displayFeed = next;
    displayWriteEnrollment(next);
    renderDisplay(projection,meta,completionRowIds);
  }catch(error){
    const code = error && error.payload && error.payload.error;
    const revoked = error && error.status === 410;
    const reauth = error && error.status === 401;
    if(revoked || reauth || code === 'reauth_required'){
      clearDisplayAuthorization(revoked ? 'revoked' : 'reauth');
    }else{
      await renderCachedDisplay(enrolled,opts.offline ? 'offline' : 'error');
    }
  }
}

function clearDisplayAuthorization(error){
  dropPendingDisplayCompletion();
  _displaySavingRowIds.clear();
  _displayFeed = null;
  displayWriteEnrollment(null);
  renderDisplay(null,{ error });
  if(navigator.onLine !== false) void beginDisplayPairing(error);
}

async function renderCachedDisplay(enrolled,error){
  let projection = null;
  if(enrolled && enrolled.snapshot){
    try{ projection = await shareDecrypt(enrolled.contentKey,enrolled.snapshot); }
    catch(_){ projection = null; }
  }
  renderDisplay(projection,{ generatedAt:projection && projection.generatedAt,error },enrolled && enrolled.completionRowIds);
}

function startDisplayPolling(){
  if(_displayPollTimer) clearInterval(_displayPollTimer);
  _displayPollTimer = setInterval(()=>{
    if(document.visibilityState === 'visible') void refreshDisplay();
  },AGENDA_POLL_MS);
}

async function bootAgendaDisplay(){
  clearAgendaFragment();
  const stored = displayReadEnrollment();
  if(stored && stored.deviceCredential){
    _displayFeed = stored;
    if(stored.snapshot && stored.contentKey){
      try{
        const projection = await shareDecrypt(stored.contentKey,stored.snapshot);
        renderDisplay(projection,stored.meta || { generatedAt:projection.generatedAt },stored.completionRowIds);
      }catch(_){}
    }
    await refreshDisplay();
    startDisplayPolling();
    return;
  }
  renderDisplay(null,{});
  await beginDisplayPairing();
}

// Scripts sit at the end of <body>, so the root and meta already exist: apply
// the stored appearance now, before the first paint, to avoid a light flash
// on displays configured for the true-dark theme.
applyAgendaAppearance(readAgendaAppearance());

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState === 'visible') void refreshDisplay();
});
window.addEventListener('pageshow',()=>void refreshDisplay());
window.addEventListener('online',()=>void refreshDisplay());
window.addEventListener('focus',()=>void refreshDisplay());
document.addEventListener('DOMContentLoaded',()=>{
  purgeLegacyDisplayEnrollments();
  syncDisplayFullscreenMenu();
  startDisplayClock();
  $('agenda-hide')?.addEventListener('click',()=>setDisplayWallpaper(true));
  $('agenda-wallpaper')?.addEventListener('click',()=>{
    // Ignore the synthetic click that follows a swipe gesture.
    if(Date.now() - _displaySwipedAt < 450) return;
    // Three taps within 900ms bring the agenda back — one accidental tap on
    // the photo frame must not flash the agenda at night.
    const now = Date.now();
    _displayWallpaperTaps = _displayWallpaperTaps.filter(ts => now - ts <= 900);
    _displayWallpaperTaps.push(now);
    if(_displayWallpaperTaps.length >= 3){
      _displayWallpaperTaps = [];
      setDisplayWallpaper(false);
    }
  });
  $('agenda-wallpaper')?.addEventListener('keydown',event=>{
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      setDisplayWallpaper(false);
    }
  });
  $('agenda-more')?.addEventListener('click',()=>{
    const menu = $('agenda-menu');
    if(menu) setAgendaMenuOpen(menu.hidden);
  });
  $('agenda-menu')?.addEventListener('click',event=>{
    const themeOption = event.target.closest('[data-theme-opt]');
    if(themeOption){
      const settings = readAgendaAppearance();
      settings.theme = themeOption.dataset.themeOpt;
      writeAgendaAppearance(settings);
      applyAgendaAppearance(settings);
      return;
    }
    const fontStep = event.target.closest('#agenda-font-minus,#agenda-font-plus');
    if(fontStep){
      const settings = readAgendaAppearance();
      settings.font = clampDisplayFont(settings.font + (fontStep.id === 'agenda-font-plus' ? AGENDA_FONT_STEP : -AGENDA_FONT_STEP));
      writeAgendaAppearance(settings);
      applyAgendaAppearance(settings);
      return;
    }
    const fitStep = event.target.closest('#agenda-fit-minus,#agenda-fit-plus');
    if(fitStep){
      const settings = readAgendaAppearance();
      settings.squish = clampDisplayFit(settings.squish + (fitStep.id === 'agenda-fit-plus' ? AGENDA_FIT_STEP : -AGENDA_FIT_STEP));
      writeAgendaAppearance(settings);
      applyAgendaAppearance(settings);
      return;
    }
    if(event.target.closest('#agenda-menu-fullscreen')) void toggleDisplayFullscreen();
  });
  document.addEventListener('click',event=>{
    const menu = $('agenda-menu');
    if(!menu || menu.hidden) return;
    if(event.target.closest && event.target.closest('.agenda-side')) return;
    setAgendaMenuOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key === 'Escape') setAgendaMenuOpen(false);
  });
  $('agenda-pair-new')?.addEventListener('click',()=>void beginDisplayPairing('new'));
  $('agenda-root')?.addEventListener('click',event=>{
    const button = event.target.closest('[data-complete-row]');
    if(button) beginDisplayCompletion(button.dataset.completeRow);
  });
  $('agenda-undo-button')?.addEventListener('click',()=>cancelDisplayCompletion());
  $('agenda-clear')?.addEventListener('click',()=>{
    stopDisplayPairing();
    _displayFeed = null;
    displayWriteEnrollment(null);
    clearAgendaFragment();
    location.reload();
  });
  if(displayWallpaperStored()) setDisplayWallpaper(true,{ focus:false });
  void bootAgendaDisplay();
});
document.addEventListener('fullscreenchange',syncDisplayFullscreenMenu);
