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
    if(feed.lastSyncError === 'replica_too_large'){
      status.textContent = `sync paused · this Tings library is too large for one encrypted update · last complete sync ${householdAgendaAgeLabel(feed.lastPublishedAt)}`;
    }else{
      const provenance = feed.plannerProvenance || '—';
      status.textContent = `syncing · revision ${feed.lastRevision || 0} · ${provenance} · ${householdAgendaAgeLabel(feed.lastPublishedAt)}`;
    }
  }
  const reauth = $('settings-agenda-reauth');
  if(reauth && reauth !== document.activeElement) reauth.value = Number(feed.reauthDays) === 7 ? '7' : '30';
  const style = householdAgendaSyncMode(feed);
  const syncMode = $('settings-agenda-sync-mode');
  if(syncMode && syncMode !== document.activeElement) syncMode.value = style;
  const syncHint = $('settings-agenda-sync-hint');
  if(syncHint){
    if(style === 'selected'){
      syncHint.textContent = 'Only items set to view or mark done are copied. This device keeps its own planner settings and agenda.';
    }else if(style === 'glance'){
      syncHint.textContent = 'Shows an agenda you can read across the room and mark done. The display does not run the full app, so it stays fast on older screens.';
    }else{
      syncHint.textContent = 'Copies every task and habit, logs, and planner settings. Add, edit, complete, or remove items on either device; changes sync automatically.';
    }
  }
  const scopeLabel = $('settings-agenda-scope-label');
  if(scopeLabel) scopeLabel.textContent = style === 'glance' ? 'how much to show' : 'glance-view compatibility';
  const mode = $('settings-agenda-scope-mode');
  const scopeMode = feed.scopeMode === 'hours' ? 'hours' : 'count';
  if(mode && mode !== document.activeElement) mode.value = scopeMode;
  const value = $('settings-agenda-scope-value');
  if(value && value !== document.activeElement){
    value.max = scopeMode === 'hours' ? '48' : '50';
    value.value = String(Number(feed.scopeValue) || (scopeMode === 'hours' ? 24 : 20));
  }
  const hint = $('settings-agenda-scope-hint');
  if(hint){
    const range = scopeMode === 'hours'
      ? '1–48 hours ahead, always cut off at the end of tomorrow; maximum 50 rows.'
      : '1–50 upcoming rows, never beyond tomorrow.';
    hint.textContent = style === 'glance'
      ? `How much of the agenda this display shows. ${range}`
      : `Older display builds receive at most 50 upcoming rows. ${range}`;
  }
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
      await createHouseholdAgendaFeed(($('settings-agenda-title')?.value || '').trim() || 'Shared display');
      await publishHouseholdAgendaNow(null,{ manual:true,forceCompletionSync:true });
      toastShare(true,'secure feed created; open the display page and scan its QR','could not create display');
    }catch(_){
      toastShare(false,'',shareConfigured() ? 'could not create display' : 'sharing worker is not configured');
    }
    syncHouseholdAgendaSettings();
  });
  $('settings-agenda-title')?.addEventListener('change',()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    feed.title = $('settings-agenda-title').value.trim().slice(0,80) || 'Shared display';
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
  $('settings-agenda-sync-mode')?.addEventListener('change',()=>{
    const feed = agendaFeedRecord();
    if(!feed) return;
    feed.syncMode = householdAgendaSyncMode({ syncMode:$('settings-agenda-sync-mode').value });
    saveAgendaFeedRecord(feed);
    syncHouseholdAgendaSettings();
    scheduleHouseholdAgendaPublish(null,{ forceCompletionSync:true });
  });
  $('settings-agenda-scope-mode')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-scope-value')?.addEventListener('change',updateHouseholdScope);
  $('settings-agenda-publish')?.addEventListener('click',async ()=>{
    try{
      await publishHouseholdAgendaNow(null,{ manual:true,forceCompletionSync:true });
      toastShare(true,'shared display synced','sync failed');
    }catch(error){
      toastShare(false,'',error && error.message === 'replica_too_large'
        ? 'sync paused: the library is too large for one encrypted update'
        : 'sync failed');
    }
  });
  $('settings-agenda-revoke')?.addEventListener('click',async ()=>{
    if(!window.confirm('Revoke this display? It will sign out immediately. Scan a new QR to add a display again. Offline screens erase their cache when they reconnect.')) return;
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
