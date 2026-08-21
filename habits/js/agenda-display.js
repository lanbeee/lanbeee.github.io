const AGENDA_STALE_MS = 24 * 60 * 60 * 1000;
const AGENDA_POLL_MS = 3 * 60 * 1000;
const AGENDA_DISPLAY_STORAGE_KEY = typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
  ? AGENDA_DISPLAY_KEY
  : 'tings_agenda_display_v2';

let _displayPollTimer = null;
let _displayFeed = null;
let _displayInvite = null;

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

function parseAgendaFragment(hash){
  const params = new URLSearchParams(String(hash || '').replace(/^#/,''));
  const feedId = params.get('feed') || '';
  const inviteId = params.get('invite') || '';
  const salt = params.get('salt') || '';
  const nonce = params.get('nonce') || '';
  const wrappedKey = params.get('wrap') || '';
  if(!/^[0-9a-f]{32}$/.test(feedId)
    || !/^[0-9a-f]{32}$/.test(inviteId)
    || !/^[0-9a-f]{32}$/.test(salt)
    || !/^[0-9a-f]{24}$/.test(nonce)
    || !/^[A-Za-z0-9+/]{40,128}={0,2}$/.test(wrappedKey)) return null;
  return { feedId, inviteId, salt, nonce, wrappedKey };
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

function clockLabel(ts,timeZone){
  if(!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined,{ hour:'numeric',minute:'2-digit',timeZone });
}

function renderDisplay(projection,meta){
  const now = Date.now();
  const root = $('agenda-root');
  const banner = $('agenda-banner');
  const updated = $('agenda-updated');
  if(!root) return;
  if(meta && meta.error === 'revoked'){
    banner.hidden = false;
    banner.textContent = 'This display was revoked. Clear it after you no longer need the cached plan.';
  }else if(meta && meta.error === 'reauth'){
    banner.hidden = false;
    banner.textContent = 'Authorization expired or was rotated. Ask the owner for a new one-time link and separate code.';
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
    root.innerHTML = '<p class="agenda-empty">No agenda on this display yet.</p>';
    return;
  }
  const tz = displayTimezone(projection.timezone);
  const title = $('agenda-title');
  if(title) title.textContent = String(projection.title || 'Household agenda').slice(0,80);
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
      const when = row.start ? `${clockLabel(row.start,tz)}${row.end ? `–${clockLabel(row.end,tz)}` : ''}` : '';
      const extra = kind === 'travel'
        ? [row.travelFromLabel,row.travelToLabel].filter(Boolean).join(' → ')
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
      <header><h2>${escapeDisplay(day.weekdayLabel || day.dateLabel)}</h2><p>${escapeDisplay(day.dateLabel)}</p></header>
      ${rows}
    </section>`;
  }).join('');
}

function escapeDisplay(value){
  return String(value || '').replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function showEnrollment(invite){
  _displayInvite = invite;
  const section = $('agenda-enroll');
  if(section) section.hidden = false;
  const banner = $('agenda-banner');
  if(banner) banner.hidden = true;
  const root = $('agenda-root');
  if(root) root.innerHTML = '';
  const updated = $('agenda-updated');
  if(updated) updated.textContent = 'One-time invitation · expires in 15 minutes';
  setTimeout(()=>$('agenda-enroll-code')?.focus(),0);
}

async function enrollAgendaDisplay(code){
  if(!_displayInvite) throw new Error('invite_missing');
  const status = $('agenda-enroll-status');
  const button = $('agenda-enroll-form')?.querySelector('button');
  if(button) button.disabled = true;
  if(status) status.textContent = 'Checking code…';
  try{
    // A wrong code fails locally at AES-GCM authentication, before the Worker is
    // contacted. This prevents accidental typos from consuming server attempts.
    const contentKey = await shareAgendaUnwrapKey(
      _displayInvite,
      _displayInvite.feedId,
      _displayInvite.inviteId,
      code
    );
    const enrollmentProof = await shareAgendaEnrollmentProof(
      _displayInvite.feedId,
      _displayInvite.inviteId,
      code
    );
    const deviceCredential = shareRandomHex(SHARE_KEY_BYTES);
    const result = await shareFetch(`/v1/agendas/${_displayInvite.feedId}/enroll`,{
      method:'POST',
      body:{ inviteId:_displayInvite.inviteId,enrollmentProof,deviceCredential }
    });
    _displayFeed = {
      feedId:_displayInvite.feedId,
      contentKey,
      deviceCredential,
      sessionExpiresAt:Number(result.body && result.body.expiresAt) || null
    };
    displayWriteEnrollment(_displayFeed);
    _displayInvite = null;
    clearAgendaFragment();
    $('agenda-enroll').hidden = true;
    if(status) status.textContent = '';
    await refreshDisplay();
    startDisplayPolling();
  }catch(error){
    if(status){
      if(error && (error.message === 'invite_unavailable' || error.status === 410)){
        status.textContent = 'This invitation expired or was already used. Ask for a new one.';
      }else if(error && error.message === 'invalid_enrollment'){
        status.textContent = 'The code was rejected. Ask the owner to create a new invitation.';
      }else{
        status.textContent = 'That code does not match this link. Check it and try again.';
      }
    }
  }finally{
    if(button) button.disabled = false;
  }
}

async function refreshDisplay(opts = {}){
  const enrolled = _displayFeed || displayReadEnrollment();
  if(!enrolled || !enrolled.deviceCredential) return;
  if(enrolled.sessionExpiresAt && Number(enrolled.sessionExpiresAt) <= Date.now()){
    await renderCachedDisplay(enrolled,'reauth');
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
    _displayFeed = next;
    displayWriteEnrollment(next);
    renderDisplay(projection,meta);
  }catch(error){
    const code = error && error.payload && error.payload.error;
    const revoked = error && error.status === 410;
    const reauth = error && error.status === 401;
    await renderCachedDisplay(enrolled,revoked ? 'revoked' : (reauth || code === 'reauth_required' ? 'reauth' : (opts.offline ? 'offline' : 'error')));
  }
}

async function renderCachedDisplay(enrolled,error){
  let projection = null;
  if(enrolled && enrolled.snapshot){
    try{ projection = await shareDecrypt(enrolled.contentKey,enrolled.snapshot); }
    catch(_){ projection = null; }
  }
  renderDisplay(projection,{ generatedAt:projection && projection.generatedAt,error });
}

function startDisplayPolling(){
  if(_displayPollTimer) clearInterval(_displayPollTimer);
  _displayPollTimer = setInterval(()=>{
    if(document.visibilityState === 'visible') void refreshDisplay();
  },AGENDA_POLL_MS);
}

async function bootAgendaDisplay(){
  const fromHash = parseAgendaFragment(location.hash);
  if(fromHash){
    showEnrollment(fromHash);
    return;
  }
  const stored = displayReadEnrollment();
  if(stored && stored.deviceCredential){
    _displayFeed = stored;
    if(stored.snapshot && stored.contentKey){
      try{
        const projection = await shareDecrypt(stored.contentKey,stored.snapshot);
        renderDisplay(projection,stored.meta || { generatedAt:projection.generatedAt });
      }catch(_){}
    }
    await refreshDisplay();
    startDisplayPolling();
    return;
  }
  renderDisplay(null,{});
  $('agenda-banner').hidden = false;
  $('agenda-banner').textContent = 'Ask the owner for a one-time display link and a separate enrollment code.';
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState === 'visible') void refreshDisplay();
});
window.addEventListener('pageshow',()=>void refreshDisplay());
window.addEventListener('online',()=>void refreshDisplay());
window.addEventListener('focus',()=>void refreshDisplay());
document.addEventListener('DOMContentLoaded',()=>{
  // v1 stored the permanent viewer credential and raw content key from the old
  // all-in-one URL. It is intentionally not migrated into the secure protocol.
  if(AGENDA_DISPLAY_STORAGE_KEY !== 'tings_agenda_display_v1'){
    try{ localStorage.removeItem('tings_agenda_display_v1'); }catch(_){}
  }
  $('agenda-enroll-code')?.addEventListener('input',event=>{
    const raw = shareNormalizeAgendaCode(event.target.value).slice(0,AGENDA_CODE_CHARS);
    event.target.value = raw.length > 5 ? `${raw.slice(0,5)}-${raw.slice(5)}` : raw;
  });
  $('agenda-enroll-form')?.addEventListener('submit',event=>{
    event.preventDefault();
    void enrollAgendaDisplay($('agenda-enroll-code')?.value || '');
  });
  $('agenda-clear')?.addEventListener('click',()=>{
    _displayFeed = null;
    _displayInvite = null;
    displayWriteEnrollment(null);
    clearAgendaFragment();
    location.reload();
  });
  void bootAgendaDisplay();
});
