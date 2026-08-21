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

function householdAgendaInviteLabel(invite,now = Date.now()){
  if(!invite || !invite.expiresAt) return 'No active invitation. Create one when the display is ready.';
  const seconds = Math.max(0,Math.ceil((Number(invite.expiresAt) - now) / 1000));
  if(seconds <= 0) return 'Invitation expired. Create a new one.';
  const minutes = Math.ceil(seconds / 60);
  return `One-time invitation expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
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
  if(feed.currentInvite && Number(feed.currentInvite.expiresAt) <= Date.now()){
    feed.currentInvite = null;
    saveAgendaFeedRecord(feed);
  }
  const invite = feed.currentInvite;
  const inviteBox = $('settings-agenda-invite');
  if(inviteBox) inviteBox.hidden = !invite;
  const code = $('settings-agenda-code');
  if(code) code.textContent = invite && invite.code ? invite.code : '';
  const inviteStatus = $('settings-agenda-invite-status');
  if(inviteStatus) inviteStatus.textContent = householdAgendaInviteLabel(invite);
  const liveInvite = Boolean(invite && invite.url && Number(invite.expiresAt) > Date.now());
  if($('settings-agenda-copy')) $('settings-agenda-copy').disabled = !liveInvite;
  if($('settings-agenda-copy-code')) $('settings-agenda-copy-code').disabled = !liveInvite;
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
      toastShare(true,'secure display created; send link and code separately','could not create display');
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
    toastShare(true,'reauthorization period saved for the next invitation','update failed');
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-scope-mode')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-scope-value')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-share')?.addEventListener('click',async ()=>{
    try{
      await issueHouseholdAgendaInvite({ rotateKey:true,publish:true });
      toastShare(true,'new link and separate code ready; prior display access revoked','invitation failed');
    }catch(_){ toastShare(false,'','invitation failed'); }
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-copy')?.addEventListener('click',async ()=>{
    toastShare(await copyHouseholdAgendaLink(),'invitation link copied; send the code another way','create a fresh invitation first');
  });
  $('settings-agenda-copy-code')?.addEventListener('click',async ()=>{
    toastShare(await copyHouseholdAgendaCode(),'code copied; do not send it with the link','create a fresh invitation first');
  });
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
