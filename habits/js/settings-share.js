function householdAgendaAgeLabel(ts,now = Date.now()){
  if(!ts) return 'never published';
  const mins = Math.max(0,Math.round((now - ts) / 60000));
  if(mins < 1) return 'just now';
  if(mins === 1) return '1 minute ago';
  if(mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if(hours === 1) return '1 hour ago';
  if(hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function syncHouseholdAgendaSettings(){
  const empty = $('settings-agenda-empty');
  const active = $('settings-agenda-active');
  if(!empty || !active) return;
  const feed = agendaFeedRecord();
  empty.hidden = Boolean(feed);
  active.hidden = !feed;
  if(!feed) return;
  const title = $('settings-agenda-title');
  if(title && title !== document.activeElement) title.value = feed.title || '';
  const status = $('settings-agenda-status');
  if(status){
    const provenance = feed.plannerProvenance || '—';
    const paused = feed.paused ? 'paused' : 'publishing';
    status.textContent = `${paused} · revision ${feed.lastRevision || 0} · ${provenance} · ${householdAgendaAgeLabel(feed.lastPublishedAt)}`;
  }
  const reauth = $('settings-agenda-reauth');
  if(reauth && reauth !== document.activeElement) reauth.value = Number(feed.reauthDays) === 7 ? '7' : '30';
  const mode = $('settings-agenda-scope-mode');
  const scopeMode = feed.scopeMode === 'hours' ? 'hours' : 'count';
  if(mode && mode !== document.activeElement) mode.value = scopeMode;
  const value = $('settings-agenda-scope-value');
  if(value && value !== document.activeElement){
    value.max = scopeMode === 'hours' ? '48' : '50';
    value.value = String(Number(feed.scopeValue) || (scopeMode === 'hours' ? 24 : 20));
  }
  const hint = $('settings-agenda-scope-hint');
  if(hint) hint.textContent = scopeMode === 'hours'
    ? '1–48 hours ahead, always cut off at the end of tomorrow; maximum 50 rows.'
    : '1–50 upcoming rows, never beyond tomorrow.';
  const pause = $('settings-agenda-pause');
  if(pause) pause.textContent = feed.paused ? 'resume publishing' : 'pause automatic publishing';
}

function toastShare(ok,good,bad){
  if(typeof showToast === 'function') showToast(ok ? good : bad);
}

function updateHouseholdScope(){
  const feed = agendaFeedRecord();
  if(!feed) return;
  const mode = $('settings-agenda-scope-mode')?.value === 'hours' ? 'hours' : 'count';
  const max = mode === 'hours' ? 48 : 50;
  const fallback = mode === 'hours' ? 24 : 20;
  const value = Math.max(1,Math.min(max,Math.round(Number($('settings-agenda-scope-value')?.value) || fallback)));
  feed.scopeMode = mode;
  feed.scopeValue = value;
  saveAgendaFeedRecord(feed);
  syncHouseholdAgendaSettings();
  scheduleHouseholdAgendaPublish();
}

function bindHouseholdAgendaSettings(){
  $('settings-agenda-create')?.addEventListener('click',async ()=>{
    try{
      await createHouseholdAgendaFeed(($('settings-agenda-title')?.value || '').trim() || 'Household agenda');
      await publishHouseholdAgendaNow(null,{ manual:true });
      toastShare(true,'secure feed created; open the display page and scan its QR','could not create display');
    }catch(_){
      toastShare(false,'',shareConfigured() ? 'could not create display' : 'sharing worker is not configured');
    }
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-title')?.addEventListener('change',()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    feed.title = $('settings-agenda-title').value.trim().slice(0,80) || 'Household agenda';
    saveAgendaFeedRecord(feed);
    scheduleHouseholdAgendaPublish();
  });
  $('settings-agenda-reauth')?.addEventListener('change',()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    feed.reauthDays = Number($('settings-agenda-reauth').value) === 7 ? 7 : 30;
    saveAgendaFeedRecord(feed);
    toastShare(true,'reauthorization period saved for the next QR approval','update failed');
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-scope-mode')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-scope-value')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-publish')?.addEventListener('click',async ()=>{
    try{
      await publishHouseholdAgendaNow(null,{ manual:true });
      toastShare(true,'agenda published','publish failed');
    }catch(_){ toastShare(false,'','publish failed'); }
  });
  $('settings-agenda-pause')?.addEventListener('click',async ()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    try{
      await pauseHouseholdAgendaFeed(!feed.paused);
      const next = agendaFeedRecord();
      toastShare(true,next && next.paused ? 'publishing paused' : 'publishing resumed','update failed');
    }catch(_){ toastShare(false,'','update failed'); }
  });
  $('settings-agenda-revoke')?.addEventListener('click',async ()=>{
    if(!window.confirm('Revoke this feed and every enrolled display? Offline displays erase their cache when they reconnect.')) return;
    try{
      await revokeHouseholdAgendaFeed();
      toastShare(true,'display feed revoked','revoke failed');
    }catch(_){ toastShare(false,'','revoke failed'); }
  });
}

document.addEventListener('DOMContentLoaded',()=>{
  bindHouseholdAgendaSettings();
  syncHouseholdAgendaSettings();
  setInterval(()=>{
    if(document.visibilityState === 'visible') syncHouseholdAgendaSettings();
  },30000);
});
