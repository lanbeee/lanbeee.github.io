function updateSortSetting(patch,options = {}){
  const {sync = true,renderNow = true} = options;
  saveSortSettings({...sortSettings,...patch});
  if(sync)syncSettingsControls();
  if(sortSettings.reachAssist === false)document.body.classList.remove('reach-pad');
  if(renderNow)render();
}

/** PURE: human summary for a retention cleanup result. */
function retentionCleanupSummary(result,{automatic = false} = {}){
  if(!result || !result.changed){
    return automatic ? '' : 'nothing to clean';
  }
  const parts = [];
  const removed = (result.removedTasks || []).length;
  if(removed)parts.push(`removed ${removed} old completed task${removed === 1 ? '' : 's'}`);
  if(result.trimmedHabits > 0){
    parts.push(`trimmed history on ${result.trimmedHabits} habit${result.trimmedHabits === 1 ? '' : 's'}`);
  }
  const body = parts.join(' · ') || 'cleaned up';
  return automatic ? `Automatic cleanup — ${body}` : `Cleanup — ${body}`;
}

/**
 * HYBRID: run retention cleanup, persist when needed, show a clear notice.
 * @param {{force?:boolean,automatic?:boolean}} options
 *   force — ignore the monthly gate (Clean now)
 *   automatic — monthly boot path; stamps lastRetentionCleanupAt even if empty
 */
function applyRetentionCleanup(options = {}){
  const {force = false,automatic = false} = options;
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (sortSettings || {});
  const now = Date.now();
  if(automatic && !force && typeof shouldRunRetentionCleanup === 'function'
    && !shouldRunRetentionCleanup(settings,now)){
    return {ran:false,changed:false};
  }
  if(typeof runRetentionCleanup !== 'function' || typeof load !== 'function'){
    return {ran:false,changed:false};
  }
  let openHid = null;
  if(typeof detailIdx !== 'undefined' && detailIdx != null){
    const cur = load()[detailIdx];
    openHid = cur ? cleanHabitId(cur.hid) : null;
  }
  const result = runRetentionCleanup(load(),settings,now);
  if(result.changed && typeof save === 'function'){
    const removedHids = new Set((result.removedTasks || []).map(h=>cleanHabitId(h.hid)));
    (result.removedTasks || []).forEach(removed=>{
      if(typeof cancelPush === 'function' && typeof reminderSignature === 'function' && removed.type === 'task'){
        try{ cancelPush(reminderSignature(removed)); }catch(_){}
      }
      if(typeof pruneOrderConstraintsForHabit === 'function'){
        try{ pruneOrderConstraintsForHabit(removed,[],now); }catch(_){}
      }
    });
    if(openHid){
      if(removedHids.has(openHid)){
        detailIdx = null;
        if(typeof closeSheet === 'function'){
          try{ closeSheet('detail-sheet'); }catch(_){}
        }
      }else{
        const newIdx = result.data.findIndex(h=>cleanHabitId(h.hid) === openHid);
        if(newIdx >= 0)detailIdx = newIdx;
      }
    }
    save(result.data);
    const creditId = cleanHabitId(settings.calendarCreditHabitId);
    if(creditId && removedHids.has(creditId)){
      saveSortSettings({...loadSortSettings(),calendarCreditHabitId:null});
    }
  }
  if(automatic){
    saveSortSettings({...loadSortSettings(),lastRetentionCleanupAt:now});
  }
  const summary = retentionCleanupSummary(result,{automatic});
  const status = $('retention-cleanup-status');
  if(status)status.textContent = summary || (force ? 'nothing to clean' : '');
  if(summary && typeof showToast === 'function')showToast(summary,5200);
  else if(force && !result.changed && typeof showToast === 'function')showToast('nothing to clean',1800);
  if(result.changed && typeof render === 'function')render();
  return {ran:true,changed:result.changed,result,summary};
}

/** Schedule the monthly retention pass after first paint (near-zero cost when gated). */
function scheduleMonthlyRetentionCleanup(){
  const run = ()=>{
    try{ applyRetentionCleanup({automatic:true}); }
    catch(_){}
  };
  if(typeof requestIdleCallback === 'function'){
    requestIdleCallback(()=>setTimeout(run,0),{timeout:4000});
  }else{
    setTimeout(run,1800);
  }
}

// PURE: check if key is a sort setting
function isSortSettingKey(key){
  return ['plansFirst','planWindowDays','planWeight','dueWeight','progressWeight','trendWeight','rhythmWeight','buildWeight','limitWeight','stopWeight','newWeight','newBuildMode','dueMode','buildLookAheadDays','buildRiseAt','limitMode','stopMode','rhythmBias','focus'].includes(key);
}

// HANDLER: toggle a boolean app setting
function toggleAppSettingButton(btn){
  if(!btn)return;
  const key = btn.dataset.settingToggle;
  if(!key)return;
  if(key === 'reminders'){toggleReminders();return;}
  const patch = {[key]:!Boolean(sortSettings[key])};
  if(isSortSettingKey(key))patch.preset = 'custom';
  // Presentation-only: reuse the mounted week plan (same pattern as homeExtraMode).
  // A full render() would still be cheap once the planner key ignores minimalMode,
  // but presentation-only avoids even entering the async planner coordinator.
  if(key === 'minimalMode'){
    updateSortSetting(patch,{renderNow:false});
    if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
    else render();
    if(typeof renderOverview === 'function' && $('overview-sheet')?.classList.contains('open'))renderOverview();
    return;
  }
  updateSortSetting(patch);
  if(key === 'agendaOptimizer' && patch.agendaOptimizer && typeof preloadAgendaOptimizer === 'function'
    && typeof agendaPlannerWorkerAvailable === 'function' && !agendaPlannerWorkerAvailable()){
    preloadAgendaOptimizer();
  }
  if(key === 'prayerIslamicNames'){
    document.querySelectorAll('.time-anchor[data-populated]').forEach(sel=>{delete sel.dataset.populated;});
    if(typeof populateAnchorOptions === 'function')populateAnchorOptions();
    renderBlockedTimeControls();
  }
}

// HANDLER: enable/disable reminders. On enable, ask for notification permission
// from this user gesture. The in-app banner works without any permission, so we
// always enable it; system notifications are a best-effort layer on top.
// RENDER: populate + sync the prayer-times sub-section (method dropdown and
// madhab seg). Idempotent — options are populated once, then values synced.
function renderPrayerTimesControls(){
  const sel = document.getElementById('setting-prayer-method');
  if(sel){
    if(!sel.dataset.populated){
      sel.innerHTML = PRAYER_METHODS.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
      sel.dataset.populated = '1';
    }
    sel.value = normalizePrayerMethod(sortSettings.prayerMethod);
  }
  const madhab = normalizePrayerMadhab(sortSettings.prayerMadhab);
  document.querySelectorAll('#prayer-madhab-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.prayerMadhab === madhab);
  });
}

async function toggleReminders(){
  const turningOn = !Boolean(sortSettings.reminders);
  if(!turningOn){
    if(typeof unsubscribeFromPush === 'function')unsubscribeFromPush();
    updateSortSetting({reminders:false});
    if(typeof hideReminderBanner === 'function')hideReminderBanner();
    showToast('reminders off');
    return;
  }
  let perm = 'unsupported';
  if(typeof requestReminderPermission === 'function')perm = await requestReminderPermission();
  updateSortSetting({reminders:true});
  showToast(perm === 'granted' ? 'reminders on' : 'reminders on · in-app banner');
  if(perm === 'granted' && typeof initPush === 'function')initPush();
  setTimeout(()=>{if(typeof checkReminders === 'function')checkReminders();},120);
}


// PURE: count sample habits in list
