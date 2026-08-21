const AGENDA_STALE_MS = 24 * 60 * 60 * 1000;
const AGENDA_POLL_MS = 3 * 60 * 1000;
const AGENDA_DISPLAY_STORAGE_KEY = typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
  ? AGENDA_DISPLAY_KEY
  : 'tings_agenda_display_v1';

let _displayPollTimer = null;
let _displayFeed = null;

function displayReadEnrollment(){
  try{ return JSON.parse(localStorage.getItem(AGENDA_DISPLAY_STORAGE_KEY) || 'null'); }
  catch(_){ return null; }
}

function displayWriteEnrollment(value){
  try{
    if(value) localStorage.setItem(AGENDA_DISPLAY_STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(AGENDA_DISPLAY_STORAGE_KEY);
  }catch(_){}
}

function parseAgendaFragment(hash){
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const feedId = params.get('feed') || '';
  const contentKey = params.get('key') || '';
  const viewer = params.get('viewer') || '';
  if(!/^[0-9a-f]{32}$/.test(feedId) || !/^[0-9a-f]{64}$/.test(contentKey) || !/^[0-9a-f]{64}$/.test(viewer)){
    return null;
  }
  return { feedId, contentKey, viewerCredential:viewer };
}

function clearAgendaFragment(){
  try{ history.replaceState(null, '', location.pathname + location.search); }
  catch(_){}
}

function displayAge(ts, now = Date.now()){
  if(!ts) return 'waiting for first plan';
  const mins = Math.max(0, Math.round((now - ts) / 60000));
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
    new Intl.DateTimeFormat('en', { timeZone:candidate }).format(0);
    return candidate;
  }catch(_){ return 'UTC'; }
}

function displayDateKey(ts, timeZone){
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(new Date(ts));
  const values = {};
  for(const part of parts){
    if(part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function clockLabel(ts, timeZone){
  if(!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit', timeZone });
}

function renderDisplay(projection, meta){
  const now = Date.now();
  const root = $('agenda-root');
  const banner = $('agenda-banner');
  const updated = $('agenda-updated');
  if(!root) return;
  if(meta && meta.error === 'revoked'){
    banner.hidden = false;
    banner.textContent = 'This display link was revoked. The last plan is still on this device until you clear it.';
  }else if(meta && meta.error === 'waiting'){
    banner.hidden = false;
    banner.textContent = 'This display is enrolled. Waiting for the owner’s app to publish today’s plan.';
  }else if(meta && meta.error === 'error'){
    banner.hidden = false;
    banner.textContent = 'Could not load the agenda. Check the link and that this origin is allowed, then retry.';
  }else if(meta && meta.generatedAt && now - meta.generatedAt > AGENDA_STALE_MS){
    banner.hidden = false;
    banner.textContent = 'This plan is more than a day old. The owner’s app has not published a newer agenda.';
  }else{
    banner.hidden = true;
    banner.textContent = '';
  }
  if(updated) updated.textContent = displayAge(meta && meta.generatedAt, now);
  if(!projection || !Array.isArray(projection.days)){
    root.innerHTML = '<p class="agenda-empty">No agenda on this display yet.</p>';
    return;
  }
  const tz = displayTimezone(projection.timezone);
  const title = $('agenda-title');
  if(title) title.textContent = projection.title || 'Household agenda';
  const days = projection.days.slice(0, 7);
  const todayKey = displayDateKey(now, tz);
  const currentDayIndex = Math.max(0, days.findIndex(day=>day && day.dateKey === todayKey));
  root.innerHTML = days.map((day, index)=>{
    const current = index === currentDayIndex;
    const rows = (Array.isArray(day.rows) ? day.rows : []).slice(0, 256).map(row=>{
      const kind = ['item','busy','travel','open'].includes(row.kind) ? row.kind : 'item';
      const when = row.start ? `${clockLabel(row.start, tz)}${row.end ? `–${clockLabel(row.end, tz)}` : ''}` : '';
      const extra = kind === 'travel'
        ? [row.travelFromLabel, row.travelToLabel].filter(Boolean).join(' → ')
        : row.locationLabel;
      const currentRow = current && row.start && row.end && now >= row.start && now < row.end;
      const nextRow = current && row.start && now < row.start;
      return `<article class="agenda-row ${kind}${currentRow ? ' is-now' : ''}${nextRow ? ' is-next' : ''}">
        <time>${when || (row.durationMinutes ? `${row.durationMinutes} min` : '')}</time>
        <div>
          <b>${escapeDisplay(row.emoji ? `${row.emoji} ${row.title}` : row.title)}</b>
          ${extra ? `<small>${escapeDisplay(extra)}</small>` : ''}
        </div>
      </article>`;
    }).join('') || '<p class="agenda-empty">Nothing planned.</p>';
    return `<section class="agenda-day${current ? ' is-today' : ''}">
      <header>
        <h2>${escapeDisplay(day.weekdayLabel || day.dateLabel)}</h2>
        <p>${escapeDisplay(day.dateLabel)}</p>
      </header>
      ${rows}
    </section>`;
  }).join('');
}

function escapeDisplay(value){
  return String(value || '').replace(/[&<>"']/g, ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

async function refreshDisplay(opts = {}){
  const enrolled = _displayFeed || displayReadEnrollment();
  if(!enrolled) return;
  try{
    const result = await shareFetch(`/v1/agendas/${enrolled.feedId}`, { credential:enrolled.viewerCredential });
    if(!result.body || !result.body.snapshot){
      renderDisplay(null, { error:'waiting' });
      return;
    }
    const projection = await shareDecrypt(enrolled.contentKey, result.body.snapshot);
    const meta = {
      generatedAt:projection.generatedAt,
      revision:result.body.revision,
      paused:result.body.paused,
      error:null
    };
    displayWriteEnrollment({ ...enrolled, snapshot:result.body.snapshot, meta });
    renderDisplay(projection, meta);
  }catch(error){
    const cached = displayReadEnrollment();
    let projection = null;
    if(cached && cached.feedId === enrolled.feedId && cached.snapshot){
      try{ projection = await shareDecrypt(cached.contentKey, cached.snapshot); }
      catch(_){ projection = null; }
    }
    const revoked = error && (error.status === 410 || error.status === 401);
    renderDisplay(projection, {
      generatedAt:projection && projection.generatedAt,
      error:revoked ? 'revoked' : (opts.offline ? 'offline' : 'error')
    });
  }
}

function startDisplayPolling(){
  if(_displayPollTimer) clearInterval(_displayPollTimer);
  _displayPollTimer = setInterval(()=>{
    if(document.visibilityState === 'visible') refreshDisplay();
  }, AGENDA_POLL_MS);
}

function enrollFromLocation(){
  const fromHash = parseAgendaFragment(location.hash);
  if(fromHash){
    _displayFeed = fromHash;
    clearAgendaFragment();
    return fromHash;
  }
  const stored = displayReadEnrollment();
  if(stored){
    _displayFeed = stored;
    return stored;
  }
  return null;
}

async function bootAgendaDisplay(){
  const enrolled = enrollFromLocation();
  const cached = displayReadEnrollment();
  if(cached && (!enrolled || cached.feedId === enrolled.feedId) && cached.snapshot && cached.contentKey){
    try{
      const projection = await shareDecrypt(cached.contentKey, cached.snapshot);
      renderDisplay(projection, cached.meta || { generatedAt:projection.generatedAt });
    }catch(_){}
  }
  if(!enrolled){
    renderDisplay(null, {});
    $('agenda-banner').hidden = false;
    $('agenda-banner').textContent = 'Open a household display link from Tings to enroll this screen.';
    return;
  }
  await refreshDisplay();
  startDisplayPolling();
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') refreshDisplay();
});
window.addEventListener('pageshow', ()=>refreshDisplay());
window.addEventListener('online', ()=>refreshDisplay());
window.addEventListener('focus', ()=>refreshDisplay());
document.addEventListener('DOMContentLoaded', ()=>{
  $('agenda-clear')?.addEventListener('click', ()=>{
    _displayFeed = null;
    displayWriteEnrollment(null);
    location.reload();
  });
  void bootAgendaDisplay();
});
