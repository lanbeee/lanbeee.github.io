function householdAgendaAgeLabel(ts, now = Date.now()){
  if(!ts) return 'never published';
  const mins = Math.max(0, Math.round((now - ts) / 60000));
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
  const pause = $('settings-agenda-pause');
  if(pause) pause.textContent = feed.paused ? 'resume publishing' : 'pause automatic publishing';
}

function toastShare(ok, good, bad){
  if(typeof showToast === 'function') showToast(ok ? good : bad);
}

function bindHouseholdAgendaSettings(){
  $('settings-agenda-create')?.addEventListener('click', async ()=>{
    try{
      await createHouseholdAgendaFeed(($('settings-agenda-title')?.value || '').trim() || 'Household agenda');
      await publishHouseholdAgendaNow(null, { manual:true });
      toastShare(true, 'household display created', 'could not create display');
    }catch(_){
      toastShare(false, '', shareConfigured() ? 'could not create display' : 'sharing worker is not configured');
    }
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-title')?.addEventListener('change', ()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    feed.title = $('settings-agenda-title').value.trim() || 'Household agenda';
    saveAgendaFeedRecord(feed);
    scheduleHouseholdAgendaPublish();
  });
  $('settings-agenda-copy')?.addEventListener('click', async ()=>{
    toastShare(await copyHouseholdAgendaLink(), 'link copied', 'copy failed');
  });
  $('settings-agenda-share')?.addEventListener('click', async ()=>{
    const ok = await shareHouseholdAgendaLink();
    if(ok && !navigator.share) toastShare(true, 'link copied', 'share failed');
  });
  $('settings-agenda-publish')?.addEventListener('click', async ()=>{
    try{
      await publishHouseholdAgendaNow(null, { manual:true });
      toastShare(true, 'agenda published', 'publish failed');
    }catch(_){ toastShare(false, '', 'publish failed'); }
  });
  $('settings-agenda-pause')?.addEventListener('click', async ()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    try{
      await pauseHouseholdAgendaFeed(!feed.paused);
      const next = agendaFeedRecord();
      toastShare(true, next && next.paused ? 'publishing paused' : 'publishing resumed', 'update failed');
    }catch(_){ toastShare(false, '', 'update failed'); }
  });
  $('settings-agenda-rotate')?.addEventListener('click', async ()=>{
    try{
      await rotateHouseholdAgendaAccess();
      toastShare(true, 'viewer access rotated', 'rotate failed');
    }catch(_){ toastShare(false, '', 'rotate failed'); }
  });
  $('settings-agenda-revoke')?.addEventListener('click', async ()=>{
    if(!window.confirm('Revoke the household display link? Existing screens will stop updating.')) return;
    try{
      await revokeHouseholdAgendaFeed();
      toastShare(true, 'display revoked', 'revoke failed');
    }catch(_){ toastShare(false, '', 'revoke failed'); }
  });
}

document.addEventListener('DOMContentLoaded', ()=>{
  bindHouseholdAgendaSettings();
  syncHouseholdAgendaSettings();
});
