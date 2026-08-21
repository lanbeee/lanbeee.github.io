const AGENDA_STALE_MS = 24 * 60 * 60 * 1000;
const AGENDA_POLL_MS = 3 * 60 * 1000;
const AGENDA_PAIR_POLL_MS = 4 * 1000;
const AGENDA_DISPLAY_STORAGE_KEY = typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
  ? AGENDA_DISPLAY_KEY
  : 'tings_agenda_display_v3';

let _displayPollTimer = null;
let _displayPairPollTimer = null;
let _displayPairExpiryTimer = null;
let _displayFeed = null;
let _displayPairing = null;

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
    title:'Authorize this household agenda display',
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
    _displayFeed = next;
    displayWriteEnrollment(next);
    renderDisplay(projection,meta);
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
  renderDisplay(projection,{ generatedAt:projection && projection.generatedAt,error });
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
        renderDisplay(projection,stored.meta || { generatedAt:projection.generatedAt });
      }catch(_){}
    }
    await refreshDisplay();
    startDisplayPolling();
    return;
  }
  renderDisplay(null,{});
  await beginDisplayPairing();
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState === 'visible') void refreshDisplay();
});
window.addEventListener('pageshow',()=>void refreshDisplay());
window.addEventListener('online',()=>void refreshDisplay());
window.addEventListener('focus',()=>void refreshDisplay());
document.addEventListener('DOMContentLoaded',()=>{
  // Earlier versions accepted reusable or link-based enrollment material.
  // Never migrate those credentials into QR-bound v3 sessions.
  for(const legacyKey of ['tings_agenda_display_v1','tings_agenda_display_v2']){
    if(legacyKey !== AGENDA_DISPLAY_STORAGE_KEY){
      try{ localStorage.removeItem(legacyKey); }catch(_){}
    }
  }
  $('agenda-pair-new')?.addEventListener('click',()=>void beginDisplayPairing('new'));
  $('agenda-clear')?.addEventListener('click',()=>{
    stopDisplayPairing();
    _displayFeed = null;
    displayWriteEnrollment(null);
    clearAgendaFragment();
    location.reload();
  });
  void bootAgendaDisplay();
});
