const RETENTION_TIME_FIELDS = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];

/** PURE: habit ids referenced as dynamic-time or schedule-link anchors. */
function collectReferencedHabitIds(data,settings = null){
  const refs = new Set();
  const credit = cleanHabitId(settings && settings.calendarCreditHabitId);
  if(credit)refs.add(credit);
  (Array.isArray(data) ? data : []).forEach(h=>{
    if(!h)return;
    RETENTION_TIME_FIELDS.forEach(field=>{
      const id1 = cleanHabitId(h[field + 'AnchorHabitId']);
      const id2 = cleanHabitId(h[field + 'AnchorHabitId2']);
      if(id1)refs.add(id1);
      if(id2)refs.add(id2);
    });
    const links = normalizeScheduleLinks(h.scheduleLinks,h.hid);
    links.forEach(link=>{ if(link && link.anchorHid)refs.add(link.anchorHid); });
  });
  return refs;
}

/** PURE: drop schedule-link / habit-anchor pointers to removed habit ids. */
function scrubRemovedHabitReferences(data,removedIds){
  const gone = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
  if(!gone.size)return Array.isArray(data) ? data : [];
  return (Array.isArray(data) ? data : []).map(h=>{
    if(!h)return h;
    let next = h;
    let touched = false;
    RETENTION_TIME_FIELDS.forEach(field=>{
      ['','2'].forEach(suffix=>{
        const key = field + 'AnchorHabitId' + suffix;
        const id = cleanHabitId(next[key]);
        if(id && gone.has(id)){
          if(!touched){ next = {...next}; touched = true; }
          next[key] = null;
          if(next[field + 'Anchor' + suffix] === 'habit')next[field + 'Anchor' + suffix] = null;
        }
      });
    });
    const links = normalizeScheduleLinks(next.scheduleLinks,next.hid);
    const scrubbed = links.filter(link=>link && !gone.has(link.anchorHid));
    if(scrubbed.length !== links.length){
      if(!touched){ next = {...next}; touched = true; }
      next.scheduleLinks = scrubbed;
    }
    return next;
  });
}

/** PURE: keep newest N actual log entries; always preserve plan logs. */
function trimHabitActualLogs(h,keepCount){
  if(!h || h.type === 'task' || !(keepCount > 0))return {habit:h,trimmed:0};
  const logs = normalizeLogs(h.logs);
  const actual = [];
  const plans = [];
  logs.forEach(log=>{
    if(isPlanLog(log))plans.push(log);
    else actual.push(log);
  });
  if(actual.length <= keepCount)return {habit:h,trimmed:0};
  actual.sort((a,b)=>logTime(a) - logTime(b));
  const kept = actual.slice(-keepCount);
  const nextLogs = normalizeLogs([...kept,...plans]);
  return {
    habit:{...h,logs:nextLogs,lastLog:latestActualLog(nextLogs)},
    trimmed:actual.length - keepCount
  };
}

/**
 * PURE: hard-delete expired completed tasks and trim non-task habit logs.
 * Protects habits still used as dynamic-time or schedule-link anchors.
 * @returns {{data:Habit[],changed:boolean,removedTasks:Habit[],trimmedLogs:number,trimmedHabits:number}}
 */
function runRetentionCleanup(data,settings,now = Date.now()){
  const retentionDays = normalizeCompletedTaskRetentionDays(settings && settings.completedTaskRetentionDays);
  const keepCount = normalizeHabitLogKeepCount(settings && settings.habitLogKeepCount);
  const cutoff = now - retentionDays * 86400000;
  const items = Array.isArray(data) ? data : [];
  const protectedIds = collectReferencedHabitIds(items,settings);
  const removedTasks = [];
  const survivors = [];
  items.forEach(h=>{
    if(!h)return;
    if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)){
      const doneAt = Number(h.lastLog) || 0;
      const hid = cleanHabitId(h.hid);
      if(doneAt > 0 && doneAt <= cutoff && hid && !protectedIds.has(hid)){
        removedTasks.push(h);
        return;
      }
    }
    survivors.push(h);
  });
  let next = survivors;
  if(removedTasks.length){
    next = scrubRemovedHabitReferences(survivors,new Set(removedTasks.map(h=>cleanHabitId(h.hid))));
  }
  let trimmedLogs = 0;
  let trimmedHabits = 0;
  if(keepCount > 0){
    next = next.map(h=>{
      const result = trimHabitActualLogs(h,keepCount);
      if(result.trimmed > 0){
        trimmedLogs += result.trimmed;
        trimmedHabits += 1;
      }
      return result.habit;
    });
  }
  return {
    data:next,
    changed:removedTasks.length > 0 || trimmedLogs > 0,
    removedTasks,
    trimmedLogs,
    trimmedHabits
  };
}
function effectiveAvailabilityMinutes(key,settings = sortSettings){
  const normalized = {...DEFAULT_SORT_SETTINGS,...settings};
  const overrides = normalizeAvailabilityOverrides(normalized.availabilityOverrides);
  // Weekly availabilityMinutes is unused for packing — default is a full day
  // (1440). Open slots after busy times still cap via min(budget, slots).
  if(Object.prototype.hasOwnProperty.call(overrides,key))return overrides[key];
  return 1440;
}
function retentionWeight(h,log){
  if(isPlanLog(log))return Infinity;
  const ageDays = Math.max(0,calendarDayDiff(logTime(log)) * -1);
  const target = h.target || (h.type === 'zero' ? 30 : 7);
  const actualCount = actualLogs(h.logs).length;
  if(ageDays <= 120)return Infinity;
  const rareBonus = Math.min(220,target * 3) + Math.max(0,16 - actualCount) * 18;
  const densePenalty = Math.max(0,actualCount - 36) * 7;
  return rareBonus - densePenalty - ageDays;
}
function pruneForStorage(items,targetKb){
  const next = normalize(items).map(h=>({...h,logs:normalizeLogs(h.logs)}));
  let guard = 0;
  while(sizeKb(next) > targetKb && guard < 5000){
    guard += 1;
    let candidate = null;
    next.forEach((h,habitIndex)=>{
      const logs = normalizeLogs(h.logs);
      if(actualLogs(logs).length <= 12)return;
      logs.forEach((log,logIndex)=>{
        if(isPlanLog(log))return;
        const weight = retentionWeight({...h,logs},log);
        if(weight === Infinity)return;
        if(!candidate || weight < candidate.weight){
          candidate = {habitIndex,logIndex,weight};
        }
      });
    });
    if(!candidate)break;
    next[candidate.habitIndex].logs.splice(candidate.logIndex,1);
    next[candidate.habitIndex].lastLog = latestActualLog(next[candidate.habitIndex].logs);
  }
  return next;
}
