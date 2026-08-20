// ─────────────────────────────────────────────────────────────────────────
// BACKUP — export/import the full local dataset as a portable JSON file.
// Everything else in this app lives only in this browser's localStorage, so
// this is the sole way data survives clearing site data, a new phone, or a
// browser switch. Treat the shape as a small versioned contract.
// ─────────────────────────────────────────────────────────────────────────
const BACKUP_VERSION = 1;

// PURE: build a plain-object snapshot of everything worth backing up.
function buildBackup(){
  return {
    app:'tings',
    version:BACKUP_VERSION,
    exportedAt:Date.now(),
    habits:load(),
    settings:loadSortSettings()
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
  return {ok:true,habits,settings};
}

// HYBRID: replace all local data with a validated backup. Returns
// {ok:true,count} or {ok:false,reason}.
function restoreBackup(raw){
  const parsed = parseBackup(raw);
  if(!parsed.ok)return parsed;
  const trimmed = parsed.habits.slice(0,MAX_TINGS);
  if(!save(trimmed))return {ok:false,reason:'Could not save that backup on this device.'};
  if(parsed.settings)saveSortSettings(parsed.settings);
  return {ok:true,count:trimmed.length};
}

// Ephemeral agenda commitments used by breakable auto-log. This is kept out of
// the habit backup intentionally: it is a device-local snapshot of what this
// particular agenda showed, not user-authored history.
