// Shared missed-item policy. Reads saved dated expectations; never builds a
// plan or records expectations. Home and native widgets use the same rows.
// TRUE: this occurrence is still eligible to be done today (calendar day +
// clock window).
function occurrenceStillDoableToday(h,now){
  if(typeof hasDaySchedule === 'function' && hasDaySchedule(h)
    && typeof nextEligibleDistance === 'function' && nextEligibleDistance(h,now) !== 0){
    return false;
  }
  return typeof windowStillDoableToday === 'function' ? windowStillDoableToday(h,now) : true;
}

function missedOccurrenceDayBase(day,now = Date.now()){
  if(typeof day === 'number' && Number.isFinite(day))return dayStart(day);
  if(typeof day === 'string'){
    const parsed = new Date(`${day}T12:00:00`).getTime();
    if(Number.isFinite(parsed))return dayStart(parsed);
  }
  return dayStart(now);
}

function missedOccurrenceResolved(h,expectedDayBase,now){
  if(h.type === 'task')return isTaskDone(h);
  if(typeof completedOnDay === 'function' && completedOnDay(h,expectedDayBase))return true;
  if(typeof actualLogs !== 'function')return completedToday(h,now);
  // This is an actionable catch-up list, not permanent history: a later real
  // completion resolves earlier outstanding expectations for the same item.
  return actualLogs(h.logs || []).some(ts=>ts >= expectedDayBase && ts <= now);
}

function missedOpportunityPassedToday(h,dayBase,now){
  let fixedStart = null;
  if(h.type === 'task' && h.eventTime != null && dateKey(h.eventTime) === dateKey(dayBase)){
    fixedStart = Number(h.eventTime);
  }else if(typeof timedPlanLogForDay === 'function'){
    const plan = timedPlanLogForDay(h,dateKey(dayBase));
    if(plan)fixedStart = logTime(plan);
  }
  if(Number.isFinite(fixedStart)){
    return now >= fixedStart + clampDuration(h.durationMinutes) * 60000;
  }
  return !occurrenceStillDoableToday(h,now);
}

// TRUE only for a dated planner expectation whose usable opportunity passed
// without a completion, including a row actually rendered today and later
// dropped by replanning. This rejects the old broad "everything overdue"
// sweep: an off-day or impossible item has no qualifying planner evidence.
function isMissedOccurrence(h,_laterPlanned,now,expectedDay = null,evidence = null){
  if(isLocalAppointment(h))return false;
  if(isOpportunityHabit(h))return false;
  if(!h || !h.hid)return false;
  if(h.snoozedUntil && now < h.snoozedUntil)return false;
  const expectedDayBase = missedOccurrenceDayBase(expectedDay,now);
  const todayBase = dayStart(now);
  if(expectedDayBase > todayBase)return false;
  if(expectedDayBase < todayBase && habitHasMultipleDailyOccurrences(h))return false;
  if(h.createdAt != null && Number(h.createdAt) >= expectedDayBase + 86400000)return false;
  if(typeof hasDaySchedule === 'function' && hasDaySchedule(h)
    && typeof isDateEligibleForHabit === 'function'
    && !isDateEligibleForHabit(h,expectedDayBase))return false;
  if(missedOccurrenceResolved(h,expectedDayBase,now))return false;
  if(expectedDayBase === todayBase){
    // A row the user actually saw in today's agenda is a commitment, not just
    // a broad eligibility guess. If a later/cold optimization drops that row,
    // preserve it as missed even when its raw clock window is still open. This
    // is intentionally narrower than treating every full-day reconstruction
    // candidate as missed: only snap.hids contains previously rendered rows.
    if(!evidence?.renderedToday
      && !missedOpportunityPassedToday(h,expectedDayBase,now))return false;
  }else if(occurrenceStillDoableToday(h,now)){
    // Midnight is not an opportunity ending. Yesterday's dated row for a
    // daily that is still doable today is the same live occurrence rolling
    // forward, not a miss — otherwise 2am dumps every unfinished meal and
    // prayer into the pill before those windows have even opened.
    return false;
  }
  return true;
}

function missedOccurrenceDayLabel(day,now = Date.now()){
  const base = missedOccurrenceDayBase(day,now);
  const diff = Math.round((dayStart(now) - base) / 86400000);
  if(diff === 0)return 'today';
  if(diff === 1)return 'yesterday';
  if(diff < 7)return new Date(base).toLocaleDateString(undefined,{weekday:'short'}).toLowerCase();
  return new Date(base).toLocaleDateString(undefined,{month:'short',day:'numeric'}).toLowerCase();
}

function collectMissedFromSnapshot(data,todayHids,snap,renderedProjection = {},now = Date.now()){
  const today = dateKey(now);
  const currentSet = new Set(todayHids);
  const droppedMap = new Map();
  const addMissed = (hid, name, emoji, idx, first, expectedDay) => {
    const h = data[idx];
    if(!h)return;
    const renderedToday = expectedDay === today && Boolean(snap.hids?.[hid]);
    if(!isMissedOccurrence(h, null, now, expectedDay, {renderedToday}))return;
    const prior = droppedMap.get(hid);
    if(prior && prior.expectedDay >= expectedDay)return;
    droppedMap.set(hid, {
      hid, name, emoji:emoji || h.emoji, idx, first, expectedDay,
      dayLabel:missedOccurrenceDayLabel(expectedDay, now)
    });
  };

  for(const [expectedDay, entry] of Object.entries(snap.expectations || {})){
    if(expectedDay > today || !entry || !Array.isArray(entry.hids))continue;
    const occurrenceHids = new Set((entry.occurrences || []).map(row=>row.hid));
    for(const hid of occurrenceHids){
      // Daily sessions belong to their calendar day. Keep past expectations
      // as history, but do not turn yesterday's sessions into today's misses.
      if(expectedDay !== today)continue;
      const idx = data.findIndex(h=>h && h.hid === hid);
      const h = data[idx];
      if(!h || !habitHasMultipleDailyOccurrences(h)
        || (h.snoozedUntil && now < h.snoozedUntil))continue;
      const dayBase = missedOccurrenceDayBase(expectedDay,now);
      if(h.createdAt != null && Number(h.createdAt) >= dayBase + 86400000)continue;
      if(hasDaySchedule(h) && !isDateEligibleForHabit(h,dayBase))continue;
      const rows = entry.occurrences.filter(row=>row.hid === hid);
      const unresolved = agendaRowsAfterCompletions(h,rows,dayBase);
      const currentKeys = new Set(renderedProjection[today]?.occurrences.map(row=>row.occurrenceKey) || []);
      for(const row of unresolved){
        const option = normalizeHabitScheduleOptions(h.scheduleOptions).find(option=>option.id === row.scheduleOptionId);
        const subject = option ? habitBoundToScheduleOption(h,option) : h;
        const expired = row.dropAt != null
          ? now >= row.dropAt : !occurrenceStillDoableToday(subject,now);
        const dropped = expectedDay === today && row.rendered && !currentKeys.has(row.occurrenceKey);
        if(!expired && !dropped)continue;
        droppedMap.set(row.occurrenceKey,{hid,name:h.name,emoji:h.emoji,idx,
          first:row.start || entry.recordedAt || now,expectedDay,
          dayLabel:missedOccurrenceDayLabel(expectedDay,now),
          occurrenceKey:row.occurrenceKey,scheduleOptionId:row.scheduleOptionId,
          scheduledDay:expectedDay,start:row.start,end:row.end});
      }
    }
    for(const hid of entry.hids){
      if(occurrenceHids.has(hid))continue;
      if(currentSet.has(hid))continue;
      const idx = data.findIndex(h => h && h.hid === hid);
      if(idx < 0)continue;
      const info = expectedDay === today ? snap.hids[hid] : null;
      addMissed(hid, data[idx].name, data[idx].emoji, idx, info?.first || entry.recordedAt || now, expectedDay);
    }
  }

  return [...droppedMap.values()].sort((a, b) =>
    a.expectedDay.localeCompare(b.expectedDay) || a.first - b.first);
}

function partitionDroppedItems(dropped, now = Date.now()){
  const visible = [];
  const hidden = [];
  for(const row of dropped || []){
    if(typeof missedHideIsActive === 'function' && missedHideIsActive(row, now))hidden.push(row);
    else visible.push(row);
  }
  return {visible, hidden};
}

