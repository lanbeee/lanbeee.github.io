const AGENDA_STALE_MS = 24 * 60 * 60 * 1000;
const AGENDA_POLL_MS = 3 * 60 * 1000;
const AGENDA_PAIR_POLL_MS = 4 * 1000;
const AGENDA_DISPLAY_STORAGE_KEY = typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
  ? AGENDA_DISPLAY_KEY
  : 'tings_agenda_display_v4';
const AGENDA_WALLPAPER_STORAGE_KEY = 'tings_agenda_wallpaper_v1';
const AGENDA_APPEARANCE_STORAGE_KEY = 'tings_agenda_appearance_v1';
const AGENDA_PASSCODE_STORAGE_KEY = 'tings_agenda_passcode_v1';
const AGENDA_PASSCODE_DIGITS = 4;
const AGENDA_PASSCODE_MAX_FAILURES = 3;
const AGENDA_PASSCODE_PBKDF2_ITERATIONS = 120000;
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
let _displayPasscodeMode = null;
let _displayPasscodeBusy = false;
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

function displayNormalizePasscode(value){
  return String(value || '').replace(/[^0-9]/g,'').slice(0,AGENDA_PASSCODE_DIGITS);
}

function readDisplayPasscode(){
  let stored = null;
  try{ stored = JSON.parse(localStorage.getItem(AGENDA_PASSCODE_STORAGE_KEY) || 'null'); }
  catch(_){ stored = null; }
  if(!stored || !/^[0-9a-f]{32}$/.test(String(stored.salt || '')) || !/^[0-9a-f]{64}$/.test(String(stored.hash || ''))) return null;
  return {
    salt:String(stored.salt),
    hash:String(stored.hash),
    iterations:AGENDA_PASSCODE_PBKDF2_ITERATIONS,
    failures:Math.max(0,Math.min(AGENDA_PASSCODE_MAX_FAILURES,Math.round(Number(stored.failures) || 0)))
  };
}

function writeDisplayPasscode(value){
  try{
    if(value) localStorage.setItem(AGENDA_PASSCODE_STORAGE_KEY,JSON.stringify(value));
    else localStorage.removeItem(AGENDA_PASSCODE_STORAGE_KEY);
  }catch(_){}
  syncDisplayPasscodeUi();
}

function syncDisplayPasscodeUi(){
  const configured = Boolean(readDisplayPasscode());
  const set = $('agenda-passcode-set');
  const remove = $('agenda-passcode-remove');
  const wallpaper = $('agenda-wallpaper');
  if(set) set.textContent = configured ? 'change passcode' : 'add 4-digit passcode';
  if(remove) remove.hidden = !configured;
  if(wallpaper) wallpaper.setAttribute('aria-label',configured
    ? 'Agenda hidden. Tap three times, then enter the passcode to show it.'
    : 'Agenda hidden. Tap three times to show it again.');
}

async function displayPasscodeHash(salt,passcode,iterations = AGENDA_PASSCODE_PBKDF2_ITERATIONS){
  const material = await crypto.subtle.importKey(
    'raw',new TextEncoder().encode(`tings-agenda-passcode-v1|${passcode}`),'PBKDF2',false,['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name:'PBKDF2',hash:'SHA-256',salt:shareHexToBytes(salt),iterations
  },material,256);
  return shareBytesToHex(bits);
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
  syncDisplayPasscodeUi();
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

function displayLongDateLabel(now){
  return now.toLocaleDateString(undefined,{ weekday:'long',month:'long',day:'numeric' });
}

function updateDisplayNightClock(){
  const now = new Date();
  const time = $('agenda-wallpaper-time');
  const date = $('agenda-wallpaper-date');
  if(time) time.textContent = now.toLocaleTimeString(undefined,{ hour:'numeric',minute:'2-digit' });
  if(date) date.textContent = displayLongDateLabel(now);
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
  const date = $('agenda-date');
  if(date) date.textContent = displayLongDateLabel(now);
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
  if(active) closeDisplayPasscodeModal({ focus:false });
  displayWriteWallpaper(active);
  if(active){
    updateDisplayNightClock();
    if(opts.focus !== false) wallpaper.focus({ preventScroll:true });
  }else{
    if(opts.focus !== false) $('agenda-hide')?.focus({ preventScroll:true });
    if(opts.refresh !== false && document.visibilityState === 'visible') void refreshDisplay();
  }
}

function openDisplayPasscodeModal(mode){
  const modal = $('agenda-passcode-modal');
  const title = $('agenda-passcode-title');
  const status = $('agenda-passcode-status');
  const input = $('agenda-passcode-input');
  const confirmRow = $('agenda-passcode-confirm-row');
  const confirm = $('agenda-passcode-confirm');
  const submit = $('agenda-passcode-submit');
  if(!modal || !title || !status || !input || !confirmRow || !confirm || !submit) return;
  if(mode === 'unlock' && !readDisplayPasscode()){
    setDisplayWallpaper(false);
    return;
  }
  _displayPasscodeMode = mode === 'set' ? 'set' : 'unlock';
  _displayPasscodeBusy = false;
  setAgendaMenuOpen(false);
  input.value = '';
  confirm.value = '';
  confirmRow.hidden = _displayPasscodeMode !== 'set';
  title.textContent = _displayPasscodeMode === 'set'
    ? (readDisplayPasscode() ? 'Change passcode' : 'Add passcode')
    : 'Unlock agenda';
  status.textContent = _displayPasscodeMode === 'set'
    ? 'Choose a 4-digit passcode. You will need it after the three-tap privacy screen.'
    : 'Enter the 4-digit passcode.';
  submit.textContent = _displayPasscodeMode === 'set' ? 'save passcode' : 'unlock';
  submit.disabled = false;
  modal.hidden = false;
  input.focus({ preventScroll:true });
}

function closeDisplayPasscodeModal(opts = {}){
  const modal = $('agenda-passcode-modal');
  if(modal) modal.hidden = true;
  const mode = _displayPasscodeMode;
  _displayPasscodeMode = null;
  _displayPasscodeBusy = false;
  if(opts.focus === false) return;
  if(mode === 'unlock' && !$('agenda-wallpaper')?.hidden) $('agenda-wallpaper')?.focus({ preventScroll:true });
  else $('agenda-more')?.focus({ preventScroll:true });
}

async function saveDisplayPasscode(){
  const input = $('agenda-passcode-input');
  const confirm = $('agenda-passcode-confirm');
  const status = $('agenda-passcode-status');
  const submit = $('agenda-passcode-submit');
  const passcode = displayNormalizePasscode(input && input.value);
  const repeated = displayNormalizePasscode(confirm && confirm.value);
  if(passcode.length !== AGENDA_PASSCODE_DIGITS){
    if(status) status.textContent = 'Enter exactly 4 digits.';
    input?.focus({ preventScroll:true });
    return;
  }
  if(passcode !== repeated){
    if(status) status.textContent = 'The passcodes do not match.';
    if(confirm) confirm.value = '';
    confirm?.focus({ preventScroll:true });
    return;
  }
  if(_displayPasscodeBusy) return;
  _displayPasscodeBusy = true;
  if(submit) submit.disabled = true;
  try{
    const salt = shareRandomHex(16);
    const hash = await displayPasscodeHash(salt,passcode);
    writeDisplayPasscode({ salt,hash,iterations:AGENDA_PASSCODE_PBKDF2_ITERATIONS,failures:0 });
    closeDisplayPasscodeModal();
  }catch(_){
    _displayPasscodeBusy = false;
    if(submit) submit.disabled = false;
    if(status) status.textContent = 'Could not save the passcode on this display.';
  }
}

async function revokeDisplayAfterPasscodeFailures(){
  const enrolled = _displayFeed || displayReadEnrollment();
  const status = $('agenda-passcode-status');
  if(status) status.textContent = 'Three incorrect attempts. Access revoked; pair this display again.';
  try{
    if(enrolled && enrolled.feedId && enrolled.deviceCredential){
      await shareFetch(`/v1/agendas/${enrolled.feedId}/display-access`,{
        method:'DELETE',credential:enrolled.deviceCredential,timeoutMs:AGENDA_COMPLETION_TIMEOUT_MS
      });
    }
  }catch(_){ /* Local credentials are erased even if the display is offline. */ }
  closeDisplayPasscodeModal({ focus:false });
  clearDisplayAuthorization('locked');
  setDisplayWallpaper(false,{ focus:false,refresh:false });
}

async function unlockDisplayWithPasscode(){
  const input = $('agenda-passcode-input');
  const status = $('agenda-passcode-status');
  const submit = $('agenda-passcode-submit');
  const passcode = displayNormalizePasscode(input && input.value);
  const stored = readDisplayPasscode();
  if(!stored){
    closeDisplayPasscodeModal({ focus:false });
    setDisplayWallpaper(false);
    return;
  }
  if(passcode.length !== AGENDA_PASSCODE_DIGITS){
    if(status) status.textContent = 'Enter exactly 4 digits.';
    input?.focus({ preventScroll:true });
    return;
  }
  if(_displayPasscodeBusy) return;
  _displayPasscodeBusy = true;
  if(submit) submit.disabled = true;
  let hash;
  try{ hash = await displayPasscodeHash(stored.salt,passcode,stored.iterations); }
  catch(_){
    _displayPasscodeBusy = false;
    if(submit) submit.disabled = false;
    if(status) status.textContent = 'Could not check the passcode on this display.';
    return;
  }
  if(hash === stored.hash){
    writeDisplayPasscode({ ...stored,failures:0 });
    closeDisplayPasscodeModal({ focus:false });
    setDisplayWallpaper(false);
    return;
  }
  const failures = stored.failures + 1;
  writeDisplayPasscode({ ...stored,failures });
  if(failures >= AGENDA_PASSCODE_MAX_FAILURES){
    await revokeDisplayAfterPasscodeFailures();
    return;
  }
  _displayPasscodeBusy = false;
  if(submit) submit.disabled = false;
  if(input) input.value = '';
  const remaining = AGENDA_PASSCODE_MAX_FAILURES - failures;
  if(status) status.textContent = `Incorrect passcode. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
  input?.focus({ preventScroll:true });
}

function submitDisplayPasscode(){
  if(_displayPasscodeMode === 'set') void saveDisplayPasscode();
  else if(_displayPasscodeMode === 'unlock') void unlockDisplayWithPasscode();
}

function requestShowDisplayAgenda(){
  if(readDisplayPasscode()) openDisplayPasscodeModal('unlock');
  else setDisplayWallpaper(false);
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
  // v2 mixed retired link/code enrollment with the first QR build. v3 stored a
  // working session across browsers, so a laptop that was never re-paired could
  // keep decrypting after a later tablet approval. Fail closed: every older key
  // is deleted and the current display must complete one fresh QR pairing.
  for(const legacyKey of [
    'tings_agenda_display_v1',
    'tings_agenda_display_v2',
    'tings_agenda_display_v3'
  ]){
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

function displayWeatherHtml(weather, withCity = false){
  if(!weather || typeof weather !== 'object') return '';
  const emoji = String(weather.emoji || '').slice(0,8);
  const temperature = String(weather.temperature || '').slice(0,16);
  const city = withCity ? String(weather.city || '').trim().slice(0,80) : '';
  if(!emoji && !temperature && !city) return '';
  const label = [emoji, temperature, city].filter(Boolean).join(' ');
  return `<span class="agenda-weather-cue" title="${escapeDisplay(label)}" role="img" aria-label="${escapeDisplay(label)}">${emoji ? `<span class="agenda-weather-emoji" aria-hidden="true">${escapeDisplay(emoji)}</span>` : ''}${temperature ? `<span class="agenda-weather-temp">${escapeDisplay(temperature)}</span>` : ''}${city ? `<span class="agenda-weather-city">${escapeDisplay(city)}</span>` : ''}</span>`;
}

// The header's ambient line is emoji + feels-like only: the owner knows which
// city they live in, so the location never renders even if an older published
// snapshot still carries it.
function renderDisplayCurrentWeather(weather){
  const node = $('agenda-weather');
  if(!node) return;
  const emoji = weather && String(weather.emoji || '').slice(0,8);
  const temperature = weather && String(weather.temperature || '').slice(0,16);
  const ambient = node.closest('.agenda-ambient');
  if(!emoji && !temperature){
    node.hidden = true;
    node.textContent = '';
    node.removeAttribute('aria-label');
    if(ambient) ambient.classList.remove('has-weather');
    return;
  }
  const label = [emoji, temperature ? `feels like ${temperature}` : ''].filter(Boolean).join(' · ');
  node.hidden = false;
  node.setAttribute('aria-label',label);
  node.innerHTML = `${emoji ? `<span class="agenda-weather-emoji" aria-hidden="true">${escapeDisplay(emoji)}</span>` : ''}${temperature ? `<span class="agenda-weather-temp">${escapeDisplay(temperature)}</span>` : ''}`;
  if(ambient) ambient.classList.add('has-weather');
}

function displayKnownRowIds(projection){
  const ids = new Set();
  for(const day of (projection && projection.days) || []){
    for(const row of (day && day.rows) || []){
      const rowId = String(row && row.rowId || '');
      if(/^[0-9a-f]{16}$/.test(rowId)) ids.add(rowId);
    }
  }
  return ids;
}

function mergeDisplayCompletionRowIds(local, remote, projection, extras = []){
  const known = displayKnownRowIds(projection);
  const extra = new Set((extras || []).filter(id=>/^[0-9a-f]{16}$/.test(String(id || ''))));
  return [...new Set([
    ...(Array.isArray(local) ? local : []),
    ...(Array.isArray(remote) ? remote : []),
    ...extra
  ].map(id=>String(id || '')).filter(id=>/^[0-9a-f]{16}$/.test(id) && (known.has(id) || extra.has(id))))].slice(-50);
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
  }else if(meta && meta.error === 'locked'){
    banner.hidden = false;
    banner.textContent = 'Three incorrect passcode attempts revoked this display. Scan the fresh QR below from inside Tings on the owner phone.';
  }else if(meta && meta.error === 'reauth'){
    banner.hidden = false;
    banner.textContent = 'Authorization expired or was rotated. Scan the fresh QR below from inside Tings on the owner phone.';
  }else if(meta && meta.error === 'waiting'){
    banner.hidden = false;
    banner.textContent = 'This display is authorized. Waiting for the owner’s app to publish today’s plan.';
  }else if(meta && meta.error === 'error'){
    banner.hidden = false;
    banner.textContent = 'Could not load the agenda. Check the connection and retry.';
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
    renderDisplayCurrentWeather(null);
    root.innerHTML = '<p class="agenda-empty">No agenda on this display yet.</p>';
    return;
  }
  _displayProjection = projection;
  renderDisplayCurrentWeather(projection.currentWeather);
  // The undo toast promises a push that must still be possible: if a refresh
  // made the pending row unmarkable (unpublished, day rolled over),
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
      const weather = displayWeatherHtml(row.weather);
      const currentRow = current && row.start && row.end && now >= row.start && now < row.end;
      const nextRow = current && row.start && now < row.start;
      const canComplete = kind === 'item' && row.completable === true
        && (day.dateKey <= todayKey || row.allowEarlyCompletion === true);
      const isComplete = canComplete && (completed.has(row.rowId)
        || (_displayPendingCompletion && _displayPendingCompletion.rowId === row.rowId)
        || _displaySavingRowIds.has(row.rowId));
      return `<article class="agenda-row ${kind}${currentRow ? ' is-now' : ''}${nextRow ? ' is-next' : ''}${isComplete ? ' is-complete' : ''}">
        ${displayRowMark(row,kind,canComplete,isComplete)}
        <div class="agenda-row-copy">
          <div class="agenda-row-title">
            <b>${escapeDisplay(row.title)}</b>
            ${weather}
          </div>
          ${extra ? `<small>${escapeDisplay(extra)}</small>` : ''}
        </div>
        <time>${when}</time>
      </article>`;
    }).join('') || '<p class="agenda-empty">Nothing planned.</p>';
    // The header's date line already shows today's date, so the today section
    // header stays weekday-only; later days still carry their own date label.
    const dayDate = current ? '' : `<p>${escapeDisplay(day.dateLabel)}</p>`;
    return `<section class="agenda-day${current ? ' is-today' : ''}">
      <header><h2>${escapeDisplay(day.weekdayLabel || day.dateLabel)}</h2>${dayDate}</header>
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
  const tz = displayTimezone(_displayProjection && _displayProjection.timezone);
  if(String(target.day.dateKey || '') > displayDateKey(Date.now(),tz) && target.row.allowEarlyCompletion !== true) return null;
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
  renderDisplayCurrentWeather(null);
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
      pairingId:pairing.pairingId,
      sessionExpiresAt:Number(result.body.sessionExpiresAt) || null
    };
    _displayFeed = enrolled;
    displayWriteEnrollment(enrolled);
    const passcode = readDisplayPasscode();
    if(passcode && passcode.failures) writeDisplayPasscode({ ...passcode,failures:0 });
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
  if(!enrolled.pairingId){
    clearDisplayAuthorization('reauth');
    return;
  }
  if(enrolled.sessionExpiresAt && Number(enrolled.sessionExpiresAt) <= Date.now()){
    clearDisplayAuthorization('reauth');
    return;
  }
  try{
    const result = await shareFetch(`/v1/agendas/${enrolled.feedId}`,{ credential:enrolled.deviceCredential });
    const remotePairingId = result.body && result.body.pairingId;
    if(remotePairingId && remotePairingId !== enrolled.pairingId){
      clearDisplayAuthorization('reauth');
      return;
    }
    if(!result.body || !result.body.snapshot){
      renderDisplay(null,{ error:'waiting' });
      return;
    }
    let projection;
    try{
      projection = await shareDecrypt(enrolled.contentKey,result.body.snapshot);
    }catch(_){
      // A rotated content key must not fall back to the previous plaintext cache.
      renderDisplay(null,{ error:'waiting' });
      return;
    }
    const meta = {
      generatedAt:projection.generatedAt,
      revision:result.body.revision,
      error:null
    };
    const next = {
      ...enrolled,
      sessionExpiresAt:Number(result.body.sessionExpiresAt) || enrolled.sessionExpiresAt || null,
      snapshot:result.body.snapshot,
      meta
    };
    const remoteCompletionRowIds = (Array.isArray(result.body.completions) ? result.body.completions : [])
      .map(record=>record && record.envelope && record.envelope.logId)
      .filter(value=>/^[0-9a-f]{16}$/.test(String(value || '')));
    const extras = [..._displaySavingRowIds];
    if(_displayPendingCompletion && _displayPendingCompletion.rowId) extras.push(_displayPendingCompletion.rowId);
    const completionRowIds = mergeDisplayCompletionRowIds(
      enrolled.completionRowIds,
      remoteCompletionRowIds,
      projection,
      extras
    );
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
    }else if(opts.offline){
      await renderCachedDisplay(enrolled,'offline');
    }else{
      renderDisplay(null,{ error:'error' });
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
  if(stored && stored.deviceCredential && stored.pairingId){
    _displayFeed = stored;
    const passcode = readDisplayPasscode();
    if(passcode && passcode.failures >= AGENDA_PASSCODE_MAX_FAILURES){
      await revokeDisplayAfterPasscodeFailures();
      return;
    }
    // Online boots must confirm the current pairing before painting. A cached
    // snapshot is only shown when the device is already offline, and even then
    // a later 401/410 still erases it.
    if(navigator.onLine === false && stored.snapshot && stored.contentKey){
      try{
        const projection = await shareDecrypt(stored.contentKey,stored.snapshot);
        renderDisplay(projection,{ ...(stored.meta || { generatedAt:projection.generatedAt }),error:'offline' },stored.completionRowIds);
      }catch(_){}
    }
    await refreshDisplay({ offline:navigator.onLine === false });
    startDisplayPolling();
    return;
  }
  if(stored) displayWriteEnrollment(null);
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
      requestShowDisplayAgenda();
    }
  });
  $('agenda-wallpaper')?.addEventListener('keydown',event=>{
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      requestShowDisplayAgenda();
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
  $('agenda-passcode-set')?.addEventListener('click',()=>openDisplayPasscodeModal('set'));
  $('agenda-passcode-remove')?.addEventListener('click',()=>{
    writeDisplayPasscode(null);
    setAgendaMenuOpen(false);
    $('agenda-more')?.focus({ preventScroll:true });
  });
  for(const input of [$('agenda-passcode-input'),$('agenda-passcode-confirm')]){
    input?.addEventListener('input',()=>{ input.value = displayNormalizePasscode(input.value); });
    input?.addEventListener('keydown',event=>{
      if(event.key === 'Enter'){
        event.preventDefault();
        submitDisplayPasscode();
      }
    });
  }
  $('agenda-passcode-submit')?.addEventListener('click',submitDisplayPasscode);
  $('agenda-passcode-cancel')?.addEventListener('click',()=>closeDisplayPasscodeModal());
  document.addEventListener('click',event=>{
    const menu = $('agenda-menu');
    if(!menu || menu.hidden) return;
    if(event.target.closest && event.target.closest('.agenda-heading-actions')) return;
    setAgendaMenuOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key === 'Escape'){
      if(!$('agenda-passcode-modal')?.hidden) closeDisplayPasscodeModal();
      else setAgendaMenuOpen(false);
    }
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
