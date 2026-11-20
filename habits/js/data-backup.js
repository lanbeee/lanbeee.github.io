// ─────────────────────────────────────────────────────────────────────────
// BACKUP — export/import durable local data as a portable JSON file.
// Everything else in this app lives only in this browser's localStorage, so
// this is the sole way data survives clearing site data, a new phone, or a
// browser switch. Treat the shape as a small versioned contract.
// ─────────────────────────────────────────────────────────────────────────
const BACKUP_VERSION = 1;
const RESTORED_DEVICE_CALENDAR_KEY = 'tings_restored_device_calendar_v1';

function isPhoneCalendarSnapshotRow(h,today){
  if(h.source!=='device')return false;
  const start=h.eventTime ?? h.dueDate;
  const end=h.calendarEnd ?? (Number.isFinite(start) ? start+(h.durationMinutes || 30)*60000 : null);
  return Number.isFinite(end) && end>today;
}

// PURE: build a plain-object snapshot of everything worth backing up.
function buildBackup(){
  const exportedAt=Date.now(),today=dayStart(exportedAt);
  return {
    app:'tings',
    version:BACKUP_VERSION,
    exportedAt,
    // Phone sync can rebuild its current window, even when the provider IDs
    // or event times change after a reinstall. Keep historical rows and file imports.
    habits:load().filter(h=>!isPhoneCalendarSnapshotRow(h,today)),
    settings:loadSortSettings(),
    calendarDeviceSourceId:typeof deviceCalendarPreferences==='function' ? deviceCalendarPreferences().sourceId : ''
  };
}

// PURE: validate a parsed backup payload (accepts either the wrapped
// {habits,settings} shape or a bare habits array from an older export).
// Returns {ok:true,habits,settings} or {ok:false,reason}.
function parseBackup(raw){
  let obj;
  try{ obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch{ return {ok:false,reason:'That file is not valid JSON.'}; }
  if(!obj || typeof obj !== 'object')return {ok:false,reason:'That file is not a valid backup.'};
  const habitsRaw = Array.isArray(obj.habits) ? obj.habits : (Array.isArray(obj) ? obj : null);
  if(!habitsRaw)return {ok:false,reason:'No habits found in that file.'};
  let habits;
  try{ habits = normalize(habitsRaw); }
  catch{ return {ok:false,reason:'That file could not be read as habits.'}; }
  const settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : null;
  const calendarDeviceSourceId=typeof obj.calendarDeviceSourceId==='string' && /^[0-9a-f]{16}$/.test(obj.calendarDeviceSourceId) ? obj.calendarDeviceSourceId : '';
  return {ok:true,habits,settings,calendarDeviceSourceId};
}

// HYBRID: replace all local data with a validated backup. Returns
// {ok:true,count} or {ok:false,reason}.
function restoreBackup(raw,{keepCalendarHides=true,keepPhoneCalendarCopies=true}={}){
  const parsed = parseBackup(raw);
  if(!parsed.ok)return parsed;
  if(!keepPhoneCalendarCopies){
    const today=dayStart(Date.now());
    parsed.habits=parsed.habits.filter(h=>!isPhoneCalendarSnapshotRow(h,today));
  }
  const settings=parsed.settings ? {...parsed.settings} : loadSortSettings();
  if(parsed.settings && !keepCalendarHides)settings.calendarIgnores=normalizeCalendarIgnores(settings.calendarIgnores).filter(r=>r.scope==='item');
  const creditHabitId=cleanHabitId(settings.calendarCreditHabitId);
  if(creditHabitId && typeof rebuildCalendarCredits==='function'){
    rebuildCalendarCredits(parsed.habits,creditHabitId,{settings:{...settings,calendarIgnores:normalizeCalendarIgnores(settings.calendarIgnores)},preserveBefore:dayStart(Date.now())});
  }
  if(!save(parsed.habits))return {ok:false,reason:'Could not save that backup on this device.'};
  if(parsed.settings)saveSortSettings(settings);
  // Mark restored provider rows locally. Reconnect only after the phone returns
  // a matching occurrence, since provider IDs can be reused on another phone.
  const restoredIds=parsed.habits.filter(h=>h.source==='device' && h.externalId &&
    (!parsed.calendarDeviceSourceId || h.calendarDeviceId===parsed.calendarDeviceSourceId)).map(h=>h.hid);
  try{
    if(restoredIds.length)Storage.write(RESTORED_DEVICE_CALENDAR_KEY,restoredIds);
    else localStorage.removeItem(RESTORED_DEVICE_CALENDAR_KEY);
  }catch{}
  return {ok:true,count:parsed.habits.length};
}

function clearAllLocalTingsData(){
  try{ localStorage.clear(); }catch(_){}
  try{ sessionStorage.clear(); }catch(_){}
  const next = new URL('index.html', location.href);
  next.search = '';
  next.hash = '';
  location.replace(next.href);
}

// Ephemeral agenda commitments used by breakable auto-log. This is kept out of
// the habit backup intentionally: it is a device-local snapshot of what this
// particular agenda showed, not user-authored history.
