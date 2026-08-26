function buildDayAgenda(data,settings,dayBase,opts = {}){
  const dayKey = dateKey(dayBase);
  const weekday = new Date(dayBase).getDay();
  const isToday = dayStart(Date.now()) === dayBase;
  const scheduled = collectScheduledAgendaEvents(data,dayKey,settings);
  const totalMinutes = effectiveAvailabilityMinutes(dayKey,settings);
  const clipAfter = isToday ? ceilToMinutes(Date.now(),5) : dayBase + dayFirstOpenMinute(normalizeBlockedTimes(settings.blockedTimes),weekday,dayBase) * 60000;
  const slots = buildOpenAgendaSlots(dayKey,scheduled,settings,{clipAfter});
  const slotMinutes = slots.reduce((sum,slot)=>sum + Math.max(0,(slot.end - slot.start) / 60000),0);
  const totalCap = Math.min(totalMinutes,slotMinutes);
  const agendaItems = [];
  if(isToday && !opts.weekMode){
    // Classic single-day agenda: every due/early item competes for today.
    const candidates = [];
    let homeRank = 0;
    for(const i of visibleIndices(data,settings)){
      const h = data[i];
      if(h.type === 'task' && isTaskDone(h))continue;
      if(h.type === 'task' && h.eventTime !== null)continue;
      if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayBase))continue;
      const dueToday = includeInTodayAgenda(h,settings);
      const earlyOk = !dueToday && typeof earlyReason === 'function' && Boolean(earlyReason(data,i,settings));
      if(!dueToday && !earlyOk)continue;
      candidates.push({h,i,priority:effectivePriority(h),rank:homeRank++});
    }
    const scarcityState = createDayPlacementState(
      {scheduled,agendaItems:[],totalMinutes:totalCap,slots,dayBase,weekday,isToday:true},
      settings,
      {dayBase,now:Date.now()}
    );
    for(const c of candidates)c.scarcity = scarcityScore(c,[scarcityState]);
    candidates.sort(compareScarcityThenPriority);
    agendaItems.push(...candidates.map(({h,i,priority,scarcity})=>({h,i,priority,scarcity})));
  }
  return { scheduled, agendaItems, totalMinutes:totalCap, usedMinutes:0, remainingMinutes:totalCap, slots, dayKey, weekday, dayBase, isToday };
}

// PURE: hard pins for week mode — planned-for-today, and hard-deadline tasks
// already due/overdue. Soft due/overdue work stays in the unified score.
function isWeekPinnedToday(h,settings){
  if(!h || h.type === 'zero')return false;
  if(h.type === 'task' && isTaskDone(h))return false;
  if(h.type === 'task' && h.eventTime !== null)return false;
  if(typeof completedOnDay === 'function' && completedOnDay(h,dayStart(Date.now())))return false;
  if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayStart(Date.now())))return false;
  if(hasPlannedToday(h) && settings.showPlannedItemsInAgenda !== false)return true;
  if(h.type === 'task' && h.hardDue && h.dueDate !== null && settings.showDueTasksInAgenda !== false){
    const left = daysUntil(h.dueDate);
    return left !== null && left <= 0;
  }
  return false;
}

// PURE: urgency weight for week day preference (higher → prefer earlier days).
function weekUrgency(h){
  if(!h)return 0;
  if(h.type === 'task'){
    if(h.dueDate === null)return 10;
    const left = daysUntil(h.dueDate);
    if(left === null)return 10;
    if(left < 0)return h.hardDue ? 200 : 140;
    if(left === 0)return h.hardDue ? 180 : 110;
    if(left <= 2)return 70;
    return 30;
  }
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const left = daysUntil(planBy);
    if(left === null)return 30;
    if(left < 0)return 140;
    if(left === 0)return 110;
    if(left <= 2)return 70;
    return 35;
  }
  const days = daysSince(h.lastLog);
  const target = typeof effectiveRhythmCadenceGapDays === 'function'
    ? effectiveRhythmCadenceGapDays(h)
    : effectiveTarget(h);
  if(days === null)return 10;
  if(days > target)return 130;
  if(days >= target)return 100;
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(flex > 0 && days >= target - flex)return 40;
  return 20;
}

// PURE: day-offset cost. High-flex keepup/reduce barely care which day;
// hard/urgent work prefers earlier. Travel/cluster still dominate.
function flexAwareDayPenalty(h,offset,urgency,pinned){
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(pinned && offset > 0)return 50000;
  if((h.type === 'keepup' || h.type === 'reduce') && flex >= 4)return offset * 5;
  if((h.type === 'keepup' || h.type === 'reduce') && flex > 0)return offset * Math.max(8, 70 - urgency / 2);
  if(urgency >= 180)return offset * 220;
  if(urgency >= 130)return offset * 50;
  return offset * Math.max(15, 140 - urgency);
}

// PURE: is a habit/task a viable candidate for assignment to a day in the
// week window? Soft overdue/due items may land on any feasible day; upcoming
// items may pull forward within flexibility / readiness.
function isWeekCandidate(h,settings,dayBase,weekday){
  if(h.type === 'zero')return false;
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return false;
  // Already logged on this day — a leftover plan entry must not re-offer it.
  if(typeof completedOnDay === 'function' && completedOnDay(h,dayBase))return false;
  if(h.type === 'task'){
    if(isTaskDone(h))return false;
    if(h.eventTime !== null)return false;         // timed → fixed to its day
    if(h.dueDate === null)return false;            // someday → not week-planned
    if(settings.showDueTasksInAgenda === false)return false;
    if(hasDaySchedule(h) && !isDateEligibleForHabit(h,dayBase))return false;
    const dueBase = dayStart(h.dueDate);
    const todayBase = dayStart(Date.now());
    // Overdue: catch up any day in the week.
    if(dueBase < todayBase)return true;
    // On/before deadline only — don't schedule past the due date.
    if(dayBase > dueBase)return false;
    const ready = typeof taskReadyDate === 'function' ? taskReadyDate(h) : dueBase;
    if(ready !== null && dayBase < dayStart(ready))return false;
    return true;
  }
  // Habit: both weekday and month-day gates must allow this calendar date.
  if(hasDaySchedule(h) && !isDateEligibleForHabit(h,dayBase))return false;
  // Timed day plans are hard scheduled rows for that day — not soft week fills.
  if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayBase))return false;
  if(hasPlannedForDay(h,dayBase))return settings.showPlannedItemsInAgenda !== false;
  if(settings.showDueHabitsInAgenda === false)return false;
  // One-off soft plan-by: eligible any day from today through the deadline
  // (and any remaining week day once overdue) — week placement picks the day.
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const dueBase = dayStart(planBy);
    const todayBase = dayStart(Date.now());
    if(dueBase < todayBase)return true;
    if(dayBase > dueBase)return false;
    if(dayBase < todayBase)return false;
    return true;
  }
  const days = daysSince(h.lastLog);
  const target = typeof effectiveRhythmCadenceGapDays === 'function'
    ? effectiveRhythmCadenceGapDays(h)
    : effectiveTarget(h);
  // Never-logged habits are due immediately (treated as infinitely overdue) so
  // a freshly created habit enters the week plan. Future-dated logs (days < 0)
  // are not yet due. After the first log, the normal rhythm applies.
  if(days !== null && days < 0)return false;
  if(days === null)return true;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days + offsetDays;
  // Breakable daily rhythm: after a partial log, today's budget is still open
  // even though lastLog reset the rhythm clock (days < target). Keep placing
  // the leftover so one pulse cannot wipe every chunk off the timeline. This
  // must precede the rhythmFillsEveryEligibleDay early-return below, which
  // would otherwise exclude today for a daily breakable that logged a chunk.
  if(typeof isBreakableRhythmHabit === 'function' && isBreakableRhythmHabit(h)
    && typeof breakableBudgetMinutes === 'function'
    && breakableBudgetMinutes(h,dayBase) > 0
    && typeof loggedChunkMinutesOnDay === 'function'
    && loggedChunkMinutesOnDay(h,dayBase) > 0){
    return true;
  }
  // When every allowed calendar date is needed to meet the requested rate, each
  // later eligible day is a candidate regardless of the raw calendar gap.
  // Do not offer another session on the same day it was completed.
  if(typeof rhythmFillsEveryEligibleDay === 'function'
    && rhythmFillsEveryEligibleDay(h))return ageOnDay > 0;
  if(ageOnDay >= target)return true;               // due/overdue by this day
  // Flex never pulls a habit earlier on its own ("on its own it continues with
  // the N days"). Only interaction-aware paths (schedule links / optimizer
  // clustering) may spend flex as a pull-earlier allowance — see
  // scheduleLinkFlexAllowsDay and the GLPK day packer.
  return false;
}

// Flex window for schedule-link pull. Keepup effectiveTarget is (raw+flex), so
// isWeekCandidate only opens at the raw target — too late for "do early with
// my linked habit". This mirrors canDoEarlyToday: raw target − flex.
function scheduleLinkFlexAllowsDay(h,dayBase,weekday,settings,opts){
  if(!h || dayBase == null)return false;
  if(h.type === 'zero')return false;
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return false;
  if(hasDaySchedule(h)){
    const schedule = scheduledDays(h);
    if(schedule.weekdays.length && !schedule.weekdays.includes(weekday))return false;
    if(schedule.monthDays.length){
      const dom = new Date(dayBase).getDate();
      if(!schedule.monthDays.includes(dom))return false;
    }
  }
  if(typeof isWeekCandidate === 'function' && isWeekCandidate(h,settings || {},dayBase,weekday)){
    return true;
  }
  if(h.type === 'task'){
    if(isTaskDone(h) || h.eventTime !== null || h.dueDate === null)return false;
    const dueBase = dayStart(h.dueDate);
    const todayBase = dayStart(Date.now());
    if(dayBase > dueBase)return false;
    const ready = typeof taskReadyDate === 'function' ? taskReadyDate(h) : dueBase;
    if(ready !== null && dayBase < dayStart(ready))return false;
    return dayBase >= todayBase || dueBase < todayBase;
  }
  const days = daysSince(h.lastLog);
  if(days !== null && days < 0)return false;
  if(days === null)return true;
  // When a scarce must-do partner is present, a build (keepup) habit may join
  // regardless of its own cadence. Open reduce partners (eligible every day
  // until done) must not unlock this — they would flood daily extras.
  if(opts && opts.partnerPresent && h.type === 'keepup')return true;
  const rawTarget = Math.max(MIN_RHYTHM_DAYS,Number(h.target) || 7);
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days + offsetDays;
  if(ageOnDay >= rawTarget)return true;
  if(flex > 0 && ageOnDay >= rawTarget - flex)return true;
  return false;
}

/**
 * PURE: whether a must-do partner may unlock unlimited keepup extras on its days.
 * Keepup and day-pinned habits are scarce; open reduce (eligible every day until
 * done) is not — joining those days still uses the subject's own flex/rhythm.
 */
function scheduleLinkPartnerAllowsKeepupExtra(anchorH){
  if(!anchorH)return false;
  if(anchorH.type === 'keepup')return true;
  if(typeof scheduledDays === 'function'){
    const schedule = scheduledDays(anchorH);
    const days = schedule && Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
    if(days.length >= 1 && days.length <= 6)return true;
  }else if(Array.isArray(anchorH.allowedWeekdays)){
    const n = anchorH.allowedWeekdays.length;
    if(n >= 1 && n <= 6)return true;
  }
  return false;
}

/**
 * PURE: scarce partner *occurrence* on dayBase — day-pinned weekday, or the
 * keepup's first due day in the horizon (not every overdue day after).
 */
function scheduleLinkPartnerScarceOnDay(anchorH,dayBase,weekday){
  if(!scheduleLinkPartnerAllowsKeepupExtra(anchorH) || dayBase == null)return false;
  if(typeof scheduledDays === 'function'){
    const schedule = scheduledDays(anchorH);
    const days = schedule && Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
    if(days.length >= 1 && days.length <= 6){
      return weekday == null || days.includes(weekday);
    }
  }else if(Array.isArray(anchorH.allowedWeekdays) && anchorH.allowedWeekdays.length){
    const pinned = anchorH.allowedWeekdays;
    if(pinned.length >= 1 && pinned.length <= 6){
      return weekday == null || pinned.includes(weekday);
    }
  }
  if(anchorH.type !== 'keepup')return false;
  const days = daysSince(anchorH.lastLog);
  if(days !== null && days < 0)return false;
  if(days === null){
    // Never logged: only the first horizon day, not the whole week.
    return Math.round((dayBase - dayStart(Date.now())) / 86400000) === 0;
  }
  const rawTarget = Math.max(MIN_RHYTHM_DAYS,Number(anchorH.target) || 7);
  const today = dayStart(Date.now());
  const offsetDays = Math.round((dayBase - today) / 86400000);
  const firstDueOffset = rawTarget - days;
  return offsetDays === firstDueOffset;
}

/** Subjects that list `anchorHid` in a same-day schedule link. */
function sameDaySubjectsForAnchor(anchorHid,candidates){
  const hid = cleanHabitId(anchorHid);
  if(!hid || !Array.isArray(candidates))return [];
  const out = [];
  for(const candidate of candidates){
    if(!candidate || !candidate.h || candidate.h.hid === hid)continue;
    const links = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(candidate.h)
      : normalizeScheduleLinks(candidate.h.scheduleLinks,candidate.h.hid).filter(l=>l && l.requireSameDay);
    for(const link of links){
      if(link && link.anchorHid === hid)out.push({candidate,link});
    }
  }
  return out;
}

// Cadence OR for keepup extras: a scarce must-do partner *occurrence* on this
// day unlocks an extra build rep. Open reduce and overdue-every-day keepups do
// not keep unlocking extras after their first due day.
function sameDayPartnerEligibleOnDay(h,dayBase,candidates){
  if(!h || !h.hid || dayBase == null || !Array.isArray(candidates))return false;
  const byHid = new Map(candidates.filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]));
  const weekday = new Date(dayBase).getDay();
  // h as a must-do subject: any scarce-on-day anchor eligible on dayBase.
  const links = typeof sameDayScheduleLinks === 'function'
    ? sameDayScheduleLinks(h)
    : normalizeScheduleLinks(h.scheduleLinks,h.hid).filter(l=>l && l.requireSameDay);
  for(const link of links){
    const anchor = byHid.get(link.anchorHid);
    if(!anchor){
      // Anchor dropped out of the candidate set because it is already done
      // on this day — it is still the partner this extra rep pairs with.
      if(typeof scheduleAnchorCommitForDay === 'function'
        && scheduleAnchorCommitForDay(link.anchorHid,dayBase))return true;
      continue;
    }
    if(!anchor.eligible || !anchor.eligible.has(dayBase))continue;
    if(scheduleLinkPartnerScarceOnDay(anchor.h,dayBase,weekday))return true;
  }
  // Do not grant extras to anchors just because a subject is present — that
  // reverse-fed Exercise onto every Shower day.
  return false;
}

// A keepup habit may place an extra rep on a day a scarce must-do partner is
// eligible — the OR between rhythm and must-do links (more is fine for build).
function keepupAllowsLinkExtraOnDay(h,dayBase,candidates){
  if(!h || h.type !== 'keepup' || dayBase == null)return false;
  return sameDayPartnerEligibleOnDay(h,dayBase,candidates);
}

// ─── Flexibility pull-earlier for location clustering ──────────────────────
// Flex never pulls a habit earlier on its own. It MAY be spent (up to `flex`
// days before the raw rhythm due day) to join a day where a NATIVE-due partner
// shares a nearby location — saving a separate trip / merging an errand. Only
// keepup (build) habits opt in; reduce is never pulled earlier. Pull never
// cascades: only partners that are due by their own raw rhythm/schedule/plan
// unlock it (not partners that only exist via another flex pull).
const CLUSTER_FLEX_NEAR_SECONDS = 15 * 60;
function locationsShareCluster(aIds,bIds,registry,mode){
  if(!Array.isArray(aIds) || !Array.isArray(bIds) || !aIds.length || !bIds.length)return false;
  for(const a of aIds){
    if(!a)continue;
    for(const b of bIds){
      if(!b)continue;
      if(a === b)return true;
      if(typeof travelEdgeBetweenIds === 'function'){
        let sec = 0;
        try{ sec = Number(travelEdgeBetweenIds(a,b,registry,mode,{allowNetwork:false}).seconds) || 0; }catch(_){ sec = 0; }
        if(sec > 0 && sec <= CLUSTER_FLEX_NEAR_SECONDS)return true;
      }
    }
  }
  return false;
}
// Native (non-flex) eligibility of candidate p on a day — by raw rhythm,
// schedule, plan, or task due-date. Reads the habit directly (not p.eligible)
// so cluster pull-early cannot cascade from another pulled habit.
function clusterNativeDueOnDay(p,dayBase,weekday,cfg){
  const h = p && p.h;
  if(!h || h.type === 'zero')return false;
  if(typeof completedOnDay === 'function' && completedOnDay(h,dayBase))return false;
  if(typeof hasPlannedForDay === 'function' && hasPlannedForDay(h,dayBase))return true;
  if(h.type === 'task'){
    if(typeof isTaskDone === 'function' && isTaskDone(h))return false;
    if(h.eventTime !== null || h.dueDate === null)return false;
    const dueBase = dayStart(h.dueDate);
    const todayBase = dayStart(Date.now());
    if(dayBase < todayBase || dayBase > dueBase)return false;
    const ready = typeof taskReadyDate === 'function' ? taskReadyDate(h) : dueBase;
    if(ready !== null && dayBase < dayStart(ready))return false;
    return true;
  }
  if(typeof hasDaySchedule === 'function' && hasDaySchedule(h)
    && typeof isDateEligibleForHabit === 'function'
    && !isDateEligibleForHabit(h,dayBase))return false;
  const days = daysSince(h.lastLog);
  if(days !== null && days < 0)return false;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days === null ? offsetDays : days + offsetDays;
  const target = typeof effectiveRhythmCadenceGapDays === 'function'
    ? effectiveRhythmCadenceGapDays(h) : (h.target || 7);
  return ageOnDay >= target;
}
// Mutates candidate eligible Sets. A keepup habit inside its flex window may
// add a day where a native-due partner shares a nearby location. The GLPK /
// placement scorer (travel-based clusterBonus + colocateHintBonus) then decides
// whether clustering actually wins — this only opens the door.
function applyClusterFlexEligibility(candidates,dayStates,settings){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return candidates;
  const cfg = settings || {};
  const registry = typeof normalizeLocationRegistry === 'function'
    ? normalizeLocationRegistry(cfg.locations)
    : (Array.isArray(cfg.locations) ? cfg.locations : []);
  const mode = cfg && cfg.travel && cfg.travel.mode ? cfg.travel.mode : undefined;
  const todayBase = dayStart(Date.now());
  const dayMeta = dayStates.map(item=>{
    const dayBase = item && (item.dayBase != null ? item.dayBase : (item.day && item.day.dayBase));
    const day = item && item.day ? item.day : item;
    const weekday = day && day.weekday != null ? day.weekday
      : (dayBase != null ? new Date(dayBase).getDay() : null);
    return {dayBase,weekday};
  }).filter(d=>d.dayBase != null);
  for(const c of candidates){
    const h = c && c.h;
    if(!h || h.type !== 'keepup' || !c.eligible)continue;
    const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
    if(flex <= 0)continue;
    const days = daysSince(h.lastLog);
    if(days === null || days < 0)continue;
    const rawTarget = typeof rhythmCadenceGapDays === 'function'
      ? rhythmCadenceGapDays(h,0) : (h.target || 7);
    const myLocs = typeof normalizeLocationIds === 'function'
      ? normalizeLocationIds(h.locationIds,registry)
      : (Array.isArray(h.locationIds) ? h.locationIds.filter(Boolean) : []);
    if(!myLocs.length)continue; // anywhere-allowed: no fixed cluster anchor
    for(const {dayBase,weekday} of dayMeta){
      if(c.eligible.has(dayBase))continue;
      const ageOnDay = days + Math.round((dayBase - todayBase) / 86400000);
      if(ageOnDay >= rawTarget)continue;        // already natively due → already eligible
      if(ageOnDay < rawTarget - flex)continue;  // outside flex pull window
      let partner = false;
      for(const p of candidates){
        if(p === c || !p.h)continue;
        if(!clusterNativeDueOnDay(p,dayBase,weekday,cfg))continue;
        const pLocs = typeof normalizeLocationIds === 'function'
          ? normalizeLocationIds(p.h.locationIds,registry)
          : (Array.isArray(p.h.locationIds) ? p.h.locationIds.filter(Boolean) : []);
        if(pLocs.length && locationsShareCluster(myLocs,pLocs,registry,mode)){ partner = true; break; }
      }
      if(partner)c.eligible.add(dayBase);
    }
  }
  return candidates;
}

// Mutates each candidate's derived eligible Set.
// Must-do links are OR'd; pull is forward-primary:
//  1) Reverse pull: subject days may attract anchors only within the anchor's
//     own flex/rhythm (never unlimited keepup bypass — that made Exercise daily).
//  2) Forward pull: scarce partner *occurrences* attract subjects with keepup
//     extras; open reduce / post-due keepup days only pull within subject flex.
// Subjects may still appear alone on other days (must-do does not gate them off).
function applyPersistentLinkEligibility(candidates,dayStates,settings){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return candidates;
  const cfg = settings || (typeof sortSettings !== 'undefined' ? sortSettings : {});
  const byHid = new Map(candidates.filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]));
  const dayHolders = dayStates.map(item=>{
    const dayBase = item && (item.dayBase != null ? item.dayBase : (item.day && item.day.dayBase));
    const day = item && item.day ? item.day : item;
    return {dayBase,day,weekday:day && day.weekday != null ? day.weekday : (dayBase != null ? new Date(dayBase).getDay() : null)};
  }).filter(item=>item.dayBase != null);

  const dayMeta = (dayBase)=>dayHolders.find(d=>d.dayBase === dayBase) || {
    dayBase,
    weekday:new Date(dayBase).getDay(),
    day:null
  };

  const anchorPresent = (anchorHid,dayBase)=>{
    if(scheduleAnchorCommitForDay(anchorHid,dayBase))return true;
    const anchorCandidate = byHid.get(anchorHid);
    return Boolean(anchorCandidate && anchorCandidate.eligible && anchorCandidate.eligible.has(dayBase));
  };

  // Days this habit is already logged/committed on. Such a day is no longer
  // in the habit's eligible set — it needs no planning — but it is still a day
  // the habit occupies, so its links must keep pulling partners onto it.
  const committedDays = (hid)=>{
    if(!hid)return [];
    return dayHolders
      .filter(({dayBase})=>Boolean(scheduleAnchorCommitForDay(hid,dayBase)))
      .map(({dayBase})=>dayBase);
  };

  const subjectDays = (candidate)=>{
    const days = new Set(committedDays(candidate.h && candidate.h.hid));
    if(candidate.eligible && candidate.eligible.size){
      for(const dayBase of candidate.eligible)days.add(dayBase);
      return [...days];
    }
    // Day-pinned subjects may still be week-candidates on sparse days even
    // when an earlier empty eligible set was seeded for reverse pull.
    for(const {dayBase,weekday} of dayHolders){
      if(typeof isWeekCandidate === 'function' && isWeekCandidate(candidate.h,cfg,dayBase,weekday)){
        days.add(dayBase);
      }
    }
    return [...days];
  };

  const pullAnchorsOntoSubjectDays = (subjectH,days)=>{
    if(!subjectH || !days.length)return;
    const links = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(subjectH)
      : normalizeScheduleLinks(subjectH.scheduleLinks,subjectH.hid).filter(l=>l && l.requireSameDay);
    if(!links.length)return;
    for(const dayBase of days){
      const {weekday} = dayMeta(dayBase);
      for(const link of links){
        const anchor = byHid.get(link.anchorHid);
        if(!anchor)continue;
        if(!anchor.eligible)anchor.eligible = new Set();
        if(anchor.eligible.has(dayBase))continue;
        // No partnerPresent bypass: anchors keep their own rhythm/flex.
        if(scheduleLinkFlexAllowsDay(anchor.h,dayBase,weekday,cfg)){
          anchor.eligible.add(dayBase);
        }
      }
    }
  };

  // Pass 1 — reverse pull: subject days attract anchors within anchor cadence.
  for(const subject of candidates){
    if(!subject || !subject.h)continue;
    pullAnchorsOntoSubjectDays(subject.h,subjectDays(subject));
  }
  // A subject with nothing left to plan drops out of `candidates` entirely,
  // but the day it pulled its anchor onto has not changed. Without this the
  // anchor loses that day the moment the subject is logged, so finishing the
  // first half of a chain erased the second half from the plan.
  for(const h of (typeof plannerSolveHabits === 'function' ? plannerSolveHabits() : [])){
    if(!h || !h.hid || byHid.has(h.hid))continue;
    pullAnchorsOntoSubjectDays(h,committedDays(h.hid));
  }

  // Pass 2 — forward pull: scarce anchor occurrences attract flexible subjects.
  for(const candidate of candidates){
    const subjectHid = candidate && candidate.h && candidate.h.hid;
    if(!subjectHid)continue;
    if(!candidate.eligible)candidate.eligible = new Set();
    const sameDayLinks = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(candidate.h)
      : normalizeScheduleLinks(candidate.h.scheduleLinks,subjectHid).filter(l=>l && l.requireSameDay);
    if(!sameDayLinks.length)continue;

    for(const {dayBase,weekday} of dayHolders){
      const present = sameDayLinks.filter(link=>anchorPresent(link.anchorHid,dayBase));
      if(!present.length)continue;
      if(candidate.eligible.has(dayBase))continue;
      const scarcePartner = present.some(link=>{
        const anchor = byHid.get(link.anchorHid);
        // No candidate but anchorPresent said yes → the anchor is already
        // logged/committed on this day, which is as scarce as it gets.
        if(!anchor)return true;
        return scheduleLinkPartnerScarceOnDay(anchor.h,dayBase,weekday);
      });
      if(scheduleLinkFlexAllowsDay(candidate.h,dayBase,weekday,cfg,
        scarcePartner ? {partnerPresent:true} : null)){
        candidate.eligible.add(dayBase);
      }
    }
  }

  // Pass 3 — non-build anchors must not burn a later must-do partner day.
  // Example: reduce every 3 days linked before a Friday-only partner — drop
  // Thursday (gap 1 < target) so solvers do not place Thu and leave Fri bare.
  // Keepup/build skips this: extra reps for partners are fine, so an earlier
  // due day (Mon) must not be dropped just because a Wed exercise also needs it.
  for(const anchor of candidates){
    if(!anchor || !anchor.h || !anchor.eligible || !anchor.eligible.size)continue;
    if(anchor.h.type === 'keepup')continue;
    const subjects = sameDaySubjectsForAnchor(anchor.h.hid,candidates);
    if(!subjects.length)continue;
    const partnerDays = new Set();
    for(const {candidate:subject} of subjects){
      for(const dayBase of subjectDays(subject)){
        const {weekday} = dayMeta(dayBase);
        if(scheduleLinkFlexAllowsDay(anchor.h,dayBase,weekday,cfg)){
          partnerDays.add(dayBase);
        }
      }
    }
    if(!partnerDays.size)continue;
    const rawTarget = Math.max(1,Number(anchor.h.target) || 7);
    for(const dayBase of [...anchor.eligible]){
      if(partnerDays.has(dayBase))continue;
      let burnsPartner = false;
      for(const partnerDay of partnerDays){
        if(partnerDay <= dayBase)continue;
        const gap = Math.round((partnerDay - dayBase) / 86400000);
        // Match rhythmEligibleOnDay: a log on dayBase blocks partnerDay when
        // gap < raw target (flex does not reopen a second placement that soon).
        if(gap < rawTarget){
          burnsPartner = true;
          break;
        }
      }
      if(burnsPartner)anchor.eligible.delete(dayBase);
    }
  }
  return candidates;
}

// PURE helper: planned-for-day predicate. hasPlannedToday checks today; this
// generalises to any day. Mirrors the actualLogs/plannedLogs intersection.
function hasPlannedForDay(h,dayBase){
  const key = dateKey(dayBase);
  const planned = plannedLogs(h.logs || []);
  if(!planned.length)return false;
  return planned.some(ts=>dateKey(ts) === key);
}

// PURE: locations already committed on a day before fills — scheduled-task
// locations + location-tied blocks. Used by tests and as a cluster seed view.
function daySeedLocationSet(day,settings,registry){
  const set = new Set();
  for(const ev of day.scheduled || []){
    const ids = normalizeLocationIds(ev.h.locationIds,registry);
    const locId = primaryPreferredLocationId(ev.h.locationPrefs,ids) || normalizePreferredLocation(ev.h.preferredLocationId,ids) || ids[0];
    if(locId)set.add(locId);
  }
  for(const block of normalizeBlockedTimes(settings.blockedTimes)){
    if(block.days.length && !block.days.includes(day.weekday))continue;
    if(block.locationId)set.add(block.locationId);
  }
  return set;
}

// PURE: soft preference miss costs for week scoring (never veto placement).
function weekPreferencePenalty(h,fit,day,registry){
  let penalty = 0;
  const ids = normalizeLocationIds(h.locationIds,registry);
  const pref = primaryPreferredLocationId(h.locationPrefs,ids) || normalizePreferredLocation(h.preferredLocationId,ids);
  if(pref && fit.locId && pref !== fit.locId)penalty += 120;
  // Honor avoid/little/high levels: reward high/little, strongly penalize avoid.
  if(fit.locId){
    const level = locationPrefLevel(h,fit.locId);
    if(level === 'high')penalty -= 60;
    else if(level === 'little')penalty -= 20;
    else if(level === 'avoid')penalty += 80;
  }
  if(fit.preferredHit)penalty -= 40;
  else{
    const loc = fit.locId ? registry.find(l=>l.id === fit.locId) : null;
    const locPref = loc && Number.isFinite(loc.preferredTimeStart) ? day.dayBase + loc.preferredTimeStart * 60000 : null;
    // Only score a habit preferred-time miss when the habit actually has one.
    // fillPreferredStart used to return midnight for unset preferences
    // (Number(null)===0), which falsely penalised any later placement.
    const habitPref = (typeof hasPreferredTimeWindow === 'function' && !hasPreferredTimeWindow(h))
      ? null
      : fillPreferredStart(h,day.dayBase);
    const prefTs = locPref || habitPref;
    if(prefTs != null && Math.abs(fit.placeStart - prefTs) > 30 * 60000)penalty += 60;
  }
  // Mild prefer preferred weekdays when set.
  if(typeof hasPreferredDays === 'function' && hasPreferredDays(h) && typeof isPreferredDay === 'function'){
    if(!isPreferredDay(h,day.dayBase))penalty += 35;
  }
  return penalty;
}

// PURE: place-then-commit week assignment. A day wins only if tryPlaceOnDay
// succeeds under hard constraints; score then picks among feasible days.
// Breakable tasks place one chunk per pass — each chunk is scored and
// committed independently so a long task can spread across days/time.
//
// locHints (optional): Map<dayBase, Array<{locId, idx}>> captured from a prior
// greedy pass. When set, a co-location bonus pulls each candidate toward a day
// where that pass already sent a NEARBY place — so two far-from-home but close-
// to-each-other errands share one trip even when one is day-pinned and the
// flexible one is processed before its partner (the case a single greedy pass
// can't see). The bonus is the commute saved (daySeed→loc minus the inter-hop),
// and only fires when the partner is genuinely closer than the day's origin, so
// near-home work is completely unaffected.
//
// Rhythm habits (non-task, non-breakable keepup/reduce) are placed on EACH
// eligible day their rhythm allows. Daily rhythms (target ≤ 1) walk the week
// chronologically so an earlier feasible day is never skipped forever once
// virtualLastLog advances. Sparse rhythms (target > 1) still shop for a
// best-scoring day first so a weekly far habit can defer to cluster with a
// co-located partner. After every commit the virtual lastLog advances, so
// target:1 lands every day, target:3 every third day, etc. Tasks and
// breakable habits keep one-shot best-day scoring.

// PURE: rhythm check for multi-day week placement. Given a habit and the
// timestamp it was last "completed" (real lastLog, or a virtual one advanced
// after each prior placement this pass), is it due again on dayBase? Mirrors
// the rhythm logic in isWeekCandidate but accepts a lastLog override so the
// placement loop can simulate "if I did this on Tuesday, am I due again on
// Wednesday?". Schedule calendar-date gates still apply. Flexibility pull-forward
// is intentionally NOT consulted here — flex only widens the INITIAL eligible
// set (via isWeekCandidate); spacing between successive placements uses the
// raw target so a daily habit lands on every day, not every (target+flex) days.
function rhythmEligibleOnDay(h,lastLogTs,dayBase,weekday,completionOffset = 0){
  if(!h)return false;
  if(typeof hasDaySchedule === 'function' && hasDaySchedule(h)
    && typeof isDateEligibleForHabit === 'function'
    && !isDateEligibleForHabit(h,dayBase))return false;
  const target = typeof rhythmCadenceGapDays === 'function'
    ? rhythmCadenceGapDays(h,completionOffset)
    : Math.max(1,Number(h && h.target) || 7);
  if(lastLogTs == null)return true; // never completed → due immediately
  const ageDays = Math.round((dayBase - dayStart(lastLogTs)) / 86400000);
  if(typeof rhythmFillsEveryEligibleDay === 'function'
    && rhythmFillsEveryEligibleDay(h))return ageDays > 0;
  return ageDays >= target;
}
function assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints){
  const todayBase = dayStates[0] ? dayStates[0].dayBase : dayStart(Date.now());
  const registry = dayStates[0] ? dayStates[0].registry : normalizeLocationRegistry(settings.locations);
  const mode = dayStates[0] ? dayStates[0].mode : normalizeTravelMode(settings.defaultTravelMode);
  const weights = resolveAgendaScoreWeights(settings);
  // Live presence only: within equal scarcity, place at-live-location work
  // before away work so the week path does not away-and-back (priority alone
  // would otherwise claim the early slot). Gated so static/preview seeds are
  // unchanged.
  const liveLocId = typeof liveLocationId === 'function' ? liveLocationId() : null;
  for(const c of candidates){
    if(c.scarcity == null)c.scarcity = scarcityScore(c,dayStates);
    c.atLiveLocation = !!(liveLocId && c.h && Array.isArray(c.h.locationIds)
      && c.h.locationIds.includes(liveLocId));
  }
  const compareWeekPlacement = (a,b)=>{
    const pinA = a.pinned === true;
    const pinB = b.pinned === true;
    if(pinA !== pinB)return pinA ? -1 : 1;
    const sa = a.scarcity != null ? a.scarcity : SCARCITY_UNBOUNDED;
    const sb = b.scarcity != null ? b.scarcity : SCARCITY_UNBOUNDED;
    if(sa !== sb)return sa - sb;
    if(liveLocId){
      const la = a.atLiveLocation === true;
      const lb = b.atLiveLocation === true;
      if(la !== lb)return la ? -1 : 1;
    }
    return compareScarcityThenPriority(a,b);
  };
  candidates.sort(compareWeekPlacement);
  // Soft boost: place "before" sides of same-day order links earlier in the
  // assignment loop so their successors can sit after them.
  const doingRaw = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const doing = doingRaw
    && (typeof isDoingNowActive !== 'function' || isDoingNowActive(doingRaw))
    ? doingRaw : null;
  if(typeof plannerOrderConstraintsForDay === 'function' || doing){
    const beforeBoost = new Map();
    for(const state of dayStates){
      for(const e of plannerOrderConstraintsForDay(state.dayBase)){
        beforeBoost.set(e.beforeHid,(beforeBoost.get(e.beforeHid) || 0) + (e.adjacency === 'direct' ? 2 : 1));
      }
    }
    candidates.sort((a,b)=>{
      const ah = a && a.h && a.h.hid;
      const bh = b && b.h && b.h.hid;
      if(doing && ah === doing.hid && bh !== doing.hid)return -1;
      if(doing && bh === doing.hid && ah !== doing.hid)return 1;
      const criticalA = mustPlaceCriticalOccurrence(a);
      const criticalB = mustPlaceCriticalOccurrence(b);
      if(criticalA !== criticalB)return criticalA ? -1 : 1;
      const wa = beforeBoost.get(ah) || 0;
      const wb = beforeBoost.get(bh) || 0;
      if(wa !== wb)return wb - wa;
      return compareWeekPlacement(a,b);
    });
  }
  let totalAssigned = 0;
  // Daily recurring breakables (e.g. "Work 6h every weekday") fill LAST so that
  // movable candidates (plan-by errands, one-shot tasks, sparse rhythms) can
  // claim a gap on a quiet day before the breakable greedy-splits the window
  // into pieces too small for them. A capacity guard (fastPathDefersMovable)
  // keeps movables out of a busy day's breakable reservation, so this is the
  // fast-path equivalent of the GLPK reservation, not a free-for-all.
  const isDailyBreakable = c => !!(c && c.h && c.h.breakable && c.h.type !== 'task'
    && Number.isFinite(Number(c.h.target)) && Number(c.h.target) <= 1);
  let ordered = [];
  for(const c of candidates){ if(!isDailyBreakable(c))ordered.push(c); }
  for(const c of candidates){ if(isDailyBreakable(c))ordered.push(c); }
  // The daily-breakable pass normally runs last for capacity protection, but
  // an explicit drag order wins. Reapply each day's precedence graph after
  // building that default order so A → breakable X → B is actually assigned
  // in that sequence instead of merely receiving a soft score.
  for(const state of dayStates){
    ordered = reorderAgendaItemsByOrderConstraints(ordered,state.dayBase);
  }
  // Topological order normally puts predecessors first. A critical successor
  // such as Friday-only Juma must claim its one window first; tryPlaceOnDay can
  // then backfill Shower/Exercise before the committed successor via the order
  // ceiling. Otherwise a flexible predecessor chain can greedily consume the
  // only Juma window before Juma is attempted.
  ordered.sort((a,b)=>{
    const ah = a && a.h && a.h.hid;
    const bh = b && b.h && b.h.hid;
    if(doing && ah === doing.hid && bh !== doing.hid)return -1;
    if(doing && bh === doing.hid && ah !== doing.hid)return 1;
    const criticalA = mustPlaceCriticalOccurrence(a);
    const criticalB = mustPlaceCriticalOccurrence(b);
    if(criticalA !== criticalB)return criticalA ? -1 : 1;
    return 0;
  });
  for(const c of ordered){
    const pinned = c.pinned === true;
    // Breakable tasks: one-shot continuous-first pool across the week.
    // Breakable keepup/reduce: still rhythm (daily/sparse) with a fresh
    // duration budget each eligible day — continuous-first / adaptive split
    // within that day only (so "work 7h every day" lands today + every day,
    // not once on the emptiest tomorrow).
    if(c.h && c.h.breakable && c.h.type === 'task'){
      totalAssigned += placeBreakableAcrossWeek(c,dayStates,settings,locHints,{
        todayBase,registry,mode,weights,candidates,pinned
      });
      continue;
    }
    const rhythmHabit = !!(c.h && c.h.type !== 'task'
      && Number.isFinite(Number(c.h && c.h.target)));
    const breakableRhythm = !!(c.h && c.h.breakable && rhythmHabit);
    let virtualLastLog = rhythmHabit && c.h ? c.h.lastLog : null;
    let rhythmPlacementCount = 0;
    const dailyRhythm = rhythmHabit && Number(c.h && c.h.target) <= 1;
    if(dailyRhythm){
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        if(rhythmPlacementCount > 0 && virtualLastLog != null
          && !rhythmEligibleOnDay(c.h,virtualLastLog,state.dayBase,state.weekday,rhythmPlacementCount)
          && !(state.dayBase > dayStart(virtualLastLog)
            && keepupAllowsLinkExtraOnDay(c.h,state.dayBase,candidates)))continue;
        const fill = { h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned)
        };
        if(doing && c.h && c.h.hid === doing.hid && doing.dayBase === state.dayBase){
          dayOpts.doingNowStart = Math.min(Number(doing.startedAt) || Date.now(), Date.now());
        }
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        if(breakableRhythm){
          const before = state.fills.length;
          if(placeBreakableSessions(state,fill,{...dayOpts, allowNetwork:true})){
            const added = state.fills.slice(before);
            for(const entry of added){
              state.day.agendaItems.push({
                h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
                locationId:entry.fit.locId,
                chunkMinutes:entry.fit.durMin,
                chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
              });
              totalAssigned += 1;
            }
            virtualLastLog = state.dayBase;
            rhythmPlacementCount += 1;
          }
          continue;
        }
        const fit = tryPlaceOnDay(state,fill,{...dayOpts, allowNetwork:true});
        if(!fit)continue;
        commitPlacement(state,fill,fit);
        state.day.agendaItems.push({
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:fit.locId
        });
        totalAssigned += 1;
        virtualLastLog = state.dayBase;
        rhythmPlacementCount += 1;
      }
      continue;
    }
    // Sparse rhythm / one-shot: pick the best-scoring feasible day, then
    // (for rhythm) advance and repeat for later eligible days only.
    // Due days (age ≥ raw target) compete without schedule-link bonuses so a
    // 3-day Shower still lands on Monday before a Friday Juma co-place; early
    // flex days keep the link bonus so partners can pull forward.
    while(true){
      let dueBest = null;
      let earlyBest = null;
      const rawTarget = rhythmHabit
        ? Math.max(1,Number(c.h && c.h.target) || 7) : null;
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        if(rhythmHabit && rhythmPlacementCount > 0 && virtualLastLog != null){
          const afterLast = state.dayBase > dayStart(virtualLastLog);
          const spaced = rhythmEligibleOnDay(c.h,virtualLastLog,state.dayBase,state.weekday,rhythmPlacementCount);
          const linkExtra = afterLast && keepupAllowsLinkExtraOnDay(c.h,state.dayBase,candidates);
          if(!spaced && !linkExtra)continue;
        }
        // Reservation: defer this movable to a quieter eligible day when placing
        // it here would breach a daily breakable's target. No-alternative and
        // higher-priority cases still place here (handled inside the helper).
        if(typeof fastPathDefersMovable === 'function'
          && fastPathDefersMovable(c,state,candidates,dayStates))continue;
        const fill = { h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const resWindows = (typeof dailyBreakableReservations === 'function'
          && typeof breakableReservationWindows === 'function')
          ? dailyBreakableReservations(state,candidates).flatMap(r=>breakableReservationWindows(r))
          : [];
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned),
          reservationWindows:resWindows
        };
        if(doing && c.h && c.h.hid === doing.hid && doing.dayBase === state.dayBase){
          dayOpts.doingNowStart = Math.min(Number(doing.startedAt) || Date.now(), Date.now());
        }
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        const consider = (cand,withLink,linkBonus)=>{
          if(!rhythmHabit){
            // One-shots: shop with link bonus.
            if(!earlyBest || cand.score < earlyBest.score)earlyBest = cand;
            return;
          }
          const refLog = virtualLastLog;
          const isDue = refLog == null
            || Math.round((state.dayBase - dayStart(refLog)) / 86400000) >= rawTarget;
          if(isDue){
            if(!withLink && (!dueBest || cand.score < dueBest.score))dueBest = cand;
            return;
          }
          if(!withLink)return;
          // Early flex: prefer linked partner days; among those, earliest so
          // Wed exercise+shower is not skipped for a later Fri Juma bonus.
          const bonus = Number(linkBonus) || 0;
          const tagged = {...cand, linkBonus:bonus};
          if(!earlyBest){ earlyBest = tagged; return; }
          const bestBonus = Number(earlyBest.linkBonus) || 0;
          if(bonus > 0 && bestBonus <= 0){ earlyBest = tagged; return; }
          if(bonus <= 0 && bestBonus > 0)return;
          if(bonus > 0 && bestBonus > 0){
            if(state.dayBase < earlyBest.state.dayBase)earlyBest = tagged;
            return;
          }
          if(cand.score < earlyBest.score)earlyBest = tagged;
        };
        if(breakableRhythm){
          // Dry-run continuous-first / largest piece for scoring without commit.
          const clone = clonePlacementState(state);
          const probeFill = {...fill};
          const placed = placeBreakableSessions(clone,probeFill,{...dayOpts, allowNetwork:true});
          if(!placed || !clone.fills.length)continue;
          const first = clone.fills[clone.fills.length - 1];
          const fitProbe = first.fit;
          const travel = fitProbe.edge.seconds || 0;
          const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
          const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
          const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
          const scoreTerms = {
            travelSeconds:travel,
            coLocHint,
            dayOffsetPenalty:dayOpts.dayOffsetPenalty,
            asapDelayMin:0,
            scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
            preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
            urgency:c.urgency
          };
          const dueCand = {
            state, fill, dayOpts, breakable:true,
            score:scoreAgendaPlacement({...scoreTerms,clusterBonus},weights)
          };
          const earlyCand = {
            state, fill, dayOpts, breakable:true,
            score:scoreAgendaPlacement({
              ...scoreTerms,clusterBonus:clusterBonus + linkDayBonus
            },weights)
          };
          consider(dueCand,false,0);
          consider(earlyCand,true,linkDayBonus);
          continue;
        }
        const fitProbe = tryPlaceOnDay(state,fill,{...dayOpts, allowNetwork:true});
        if(!fitProbe)continue;
        const travel = fitProbe.edge.seconds || 0;
        const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
        const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
        const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
        const scoreTerms = {
          travelSeconds:travel,
          coLocHint,
          dayOffsetPenalty:dayOpts.dayOffsetPenalty,
          asapDelayMin:0,
          scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
          preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
          urgency:c.urgency
        };
        const dueCand = {
          state, fill, fit:fitProbe,
          score:scoreAgendaPlacement({...scoreTerms,clusterBonus},weights)
        };
        const earlyCand = {
          state, fill, fit:fitProbe,
          score:scoreAgendaPlacement({
            ...scoreTerms,clusterBonus:clusterBonus + linkDayBonus
          },weights)
        };
        consider(dueCand,false,0);
        consider(earlyCand,true,linkDayBonus);
      }
      // Earliest of due vs early-link wins so a Wed partner is not deferred
      // behind a later due day (Thu) that would then block it.
      let best = null;
      if(dueBest && earlyBest){
        best = earlyBest.state.dayBase < dueBest.state.dayBase ? earlyBest : dueBest;
      }else{
        best = dueBest || earlyBest;
      }
      if(!best)break;
      if(best.breakable){
        const before = best.state.fills.length;
        if(!placeBreakableSessions(best.state,best.fill,{...best.dayOpts, allowNetwork:true}))break;
        const added = best.state.fills.slice(before);
        for(const entry of added){
          best.state.day.agendaItems.push({
            h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
            locationId:entry.fit.locId,
            chunkMinutes:entry.fit.durMin,
            chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
          });
          totalAssigned += 1;
        }
      }else{
        commitPlacement(best.state,best.fill,best.fit);
        best.state.day.agendaItems.push({
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:best.fit.locId
        });
        totalAssigned += 1;
      }
      if(rhythmHabit){
        virtualLastLog = best.state.dayBase;
        rhythmPlacementCount += 1;
      }
      if(!rhythmHabit)break;
    }
  }
  totalAssigned += rebalanceScarcePlacements(candidates,dayStates,settings,locHints);
  totalAssigned += rescueLeftoverWeekFits(candidates,dayStates,settings);
  // Week-holistic: if daily Work is still short, peel can-wait movables to
  // other days and refill — maximize placed hours across the week.
  if(typeof repairWeekPlacedHours === 'function'){
    totalAssigned += repairWeekPlacedHours(candidates,dayStates,settings);
  }
  compactFastTravelRoutes(dayStates,candidates,settings);
  enforcePersistentLinkInvariants(dayStates,candidates,settings);
  // Rebuild/link cleanup can uncover a gap after the normal rescue already
  // ran. Give fixed daily obligations one final exact-gap chance.
  totalAssigned += rescueDailyGapFits(candidates,dayStates,settings);
  enforcePersistentLinkInvariants(dayStates,candidates,settings);
  return totalAssigned;
}

/**
 * PURE: week placement for one breakable candidate — try full remaining on the
 * best day, then largest valid pieces. Prefer continuing on the same day.
 */
function placeBreakableAcrossWeek(c,dayStates,settings,locHints,ctx){
  if(!c || !c.h || !c.h.breakable)return 0;
  const {todayBase,registry,mode,weights,candidates,pinned} = ctx;
  const min = typeof clampMinChunk === 'function'
    ? clampMinChunk(c.h.minChunkMinutes)
    : (c.h.minChunkMinutes || 30);
  let left = breakableMinutesLeft(c.h,c.i,dayStates);
  let chunkIndex = 0;
  let preferredState = null;
  let gained = 0;
  while(left > 0){
    const orderedStates = preferredState
      ? [preferredState,...dayStates.filter(s=>s !== preferredState)]
      : dayStates.slice();
    let best = null;
    // Pass 1: continuous full remaining.
    for(const state of orderedStates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(pinned && !state.isTodayDay)continue;
      const fill = {
        h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
        chunkMinutes:left, chunkIndex, placeKey:`${c.i}:${chunkIndex}`
      };
      const offset = Math.round((state.dayBase - todayBase) / 86400000);
      const dayOpts = {
        settings,
        weights,
        urgency:c.urgency,
        dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned),
        allowNetwork:true
      };
      if(!isScarceScore(c.scarcity)){
        const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
        if(spare.length)dayOpts.spareWindows = spare;
      }
      const fitProbe = tryPlaceOnDay(state,fill,dayOpts);
      if(!fitProbe)continue;
      const travel = fitProbe.edge.seconds || 0;
      const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
      const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
      const sameDayBonus = preferredState && state === preferredState ? 200 : 0;
      const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
      const score = scoreAgendaPlacement({
        travelSeconds:travel,
        clusterBonus:clusterBonus + sameDayBonus + linkDayBonus,
        coLocHint,
        dayOffsetPenalty:dayOpts.dayOffsetPenalty,
        asapDelayMin:0,
        scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
        preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
        urgency:c.urgency
      },weights);
      const cand = { state, fill, fit:fitProbe, score, durMin:fitProbe.durMin };
      if(!best || score < best.score)best = cand;
    }
    // Pass 2: adaptive largest valid piece when full remaining will not fit.
    if(!best){
      for(const state of orderedStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        const fill = {
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
          chunkMinutes:left, chunkIndex, placeKey:`${c.i}:${chunkIndex}`
        };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned),
          allowNetwork:true
        };
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        const largest = largestFeasibleBreakableFit(state,fill,left,min,dayOpts);
        if(!largest || !largest.fit)continue;
        const fitProbe = largest.fit;
        const travel = fitProbe.edge.seconds || 0;
        const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
        const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
        const sameDayBonus = preferredState && state === preferredState ? 200 : 0;
        const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
        const score = scoreAgendaPlacement({
          travelSeconds:travel,
          clusterBonus:clusterBonus + sameDayBonus + linkDayBonus,
          coLocHint,
          dayOffsetPenalty:dayOpts.dayOffsetPenalty,
          asapDelayMin:0,
          scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
          preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
          urgency:c.urgency
        },weights);
        // Prefer larger pieces, then better soft score.
        const cand = { state, fill, fit:fitProbe, score, durMin:fitProbe.durMin };
        if(!best
          || cand.durMin > best.durMin
          || (cand.durMin === best.durMin && score < best.score)){
          best = cand;
        }
      }
    }
    if(!best)break;
    best.fill.chunkMinutes = best.fit.durMin;
    best.fill.chunkIndex = chunkIndex;
    best.fill.placeKey = `${c.i}:${chunkIndex}`;
    best.fit.placeKey = best.fill.placeKey;
    commitPlacement(best.state,best.fill,best.fit);
    best.state.placed.add(c.i);
    best.state.day.agendaItems.push({
      h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:best.fit.locId,
      chunkMinutes:best.fit.durMin,
      chunkIndex
    });
    left -= best.fit.durMin;
    preferredState = best.state;
    chunkIndex += 1;
    gained += 1;
  }
  return gained;
}

// PURE: after greedy + scarce rebalance, fill any remaining due habits that
// still fit on a day with leftover budget/open gaps. Catches order/budget
// misses where rem > 0 (or a later gap is free) but the habit never got a
// commit — the "blank all week until I plan it" failure mode.
function rescueLeftoverWeekFits(candidates,dayStates,settings,opts = {}){
  let gained = 0;
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return 0;
  // Full week pool for reservation / deferral checks (caller may pass only
  // non-breakables to place — without the daily breakables in-scope, spare
  // looks infinite and packed lower-priority items steal Work chunks).
  const deferPool = Array.isArray(opts.allCandidates) && opts.allCandidates.length
    ? opts.allCandidates
    : candidates;
  for(const c of candidates){
    if(!c || !c.h)continue;
    // Breakable tasks: one-shot leftover pool across days.
    if(c.h.breakable && c.h.type === 'task'){
      gained += placeBreakableAcrossWeek(c,dayStates,settings,null,{
        todayBase:dayStates[0] ? dayStates[0].dayBase : dayStart(Date.now()),
        registry:dayStates[0] ? dayStates[0].registry : normalizeLocationRegistry(settings.locations),
        mode:dayStates[0] ? dayStates[0].mode : normalizeTravelMode(settings.defaultTravelMode),
        weights:resolveAgendaScoreWeights(settings),
        candidates:deferPool,
        pinned:c.pinned === true
      });
      continue;
    }
    const rhythmHabit = !!(c.h.type !== 'task'
      && Number.isFinite(Number(c.h.target)));
    const breakableRhythm = !!(c.h.breakable && rhythmHabit);
    const fillsEveryEligibleDay = rhythmHabit && (
      (typeof rhythmFillsEveryEligibleDay === 'function' && rhythmFillsEveryEligibleDay(c.h))
      || Number(c.h.target) <= 1
    );
    // Some reconstructed/optimized states use a custom placeKey. The fills are
    // the source of truth for whether this occurrence already exists; relying
    // only on state.placed can rescue the same item into the same day twice.
    const hasOccurrence = state=>Boolean(state
      && (state.fills || []).some(entry=>entry && entry.fill && entry.fill.i === c.i));
    let lastPlaced = rhythmHabit ? c.h.lastLog : null;
    let rhythmPlacementCount = 0;
    let alreadyOneShot = false;
    // A daily/every-eligible-day rhythm is a separate obligation on each day.
    // Walk it chronologically below. Preloading a later placement as lastPlaced
    // makes the earlier missed occurrence look ineligible ("assigned tomorrow").
    if(!fillsEveryEligibleDay){
      for(const state of dayStates){
        if(hasOccurrence(state)){
          lastPlaced = state.dayBase;
          if(rhythmHabit)rhythmPlacementCount += 1;
          if(!rhythmHabit)alreadyOneShot = true;
        }
      }
    }
    if(alreadyOneShot)continue;
    for(const state of dayStates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(c.pinned && !state.isTodayDay)continue;
      if(hasOccurrence(state)){
        lastPlaced = state.dayBase;
        if(fillsEveryEligibleDay)rhythmPlacementCount += 1;
        continue;
      }
      if(rhythmHabit && lastPlaced != null
        && !rhythmEligibleOnDay(c.h,lastPlaced,state.dayBase,state.weekday,rhythmPlacementCount))continue;
      // Same week-holistic rule as the ILP reserve: can-wait yields; packed
      // equal/lower priority must not steal a daily breakable chunk.
      if(typeof fastPathDefersMovable === 'function'
        && fastPathDefersMovable(c,state,deferPool,dayStates))continue;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      if(breakableRhythm){
        const before = state.fills.length;
        if(!placeBreakableSessions(state,fill,{settings,allowNetwork:true}))continue;
        const added = state.fills.slice(before);
        for(const entry of added){
          state.day.agendaItems.push({
            h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:entry.fit.locId,
            chunkMinutes:entry.fit.durMin,
            chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
          });
          gained += 1;
        }
        lastPlaced = state.dayBase;
        continue;
      }
      const resWindows = (typeof dailyBreakableReservations === 'function'
        && typeof breakableReservationWindows === 'function')
        ? dailyBreakableReservations(state,deferPool).flatMap(r=>breakableReservationWindows(r))
        : [];
      const fit = tryPlaceOnDay(state,fill,{settings,allowNetwork:true,reservationWindows:resWindows});
      if(!fit)continue;
      commitPlacement(state,fill,fit);
      state.day.agendaItems.push({
        h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:fit.locId
      });
      lastPlaced = state.dayBase;
      if(rhythmHabit)rhythmPlacementCount += 1;
      gained += 1;
      if(!rhythmHabit)break;
    }
  }
  return gained;
}

// MUTATE: final hard-gap rescue for fixed daily/every-eligible-day rhythms.
// Uses the same exact-gap probe as the audit, with a private probe placeKey, so
// a stale/custom placement key cannot hide an otherwise feasible occurrence.
function rescueDailyGapFits(candidates,dayStates,settings){
  let gained = 0;
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return gained;
  const daily = candidates.filter(c=>{
    if(!c || !c.h || c.h.breakable || c.h.type === 'task')return false;
    const target = Number(c.h.target);
    return (Number.isFinite(target) && target <= 1)
      || (typeof rhythmFillsEveryEligibleDay === 'function'
        && rhythmFillsEveryEligibleDay(c.h));
  });
  for(const state of dayStates){
    if(!state)continue;
    for(const c of daily){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(c.pinned && !state.isTodayDay)continue;
      if((state.fills || []).some(entry=>entry && entry.fill && entry.fill.i === c.i))continue;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      const needed = todayCandidateLoadMinutes(c.h,state.dayBase);
      for(const gap of remainingPlacementGaps(state)){
        const fit = auditFillFitInGap(state,fill,gap,needed,false);
        if(!fit)continue;
        fit.placeKey = c.i;
        commitPlacement(state,fill,fit);
        state.day.agendaItems.push({
          h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:fit.locId
        });
        gained += 1;
        break;
      }
    }
  }
  return gained;
}

// PURE: total committed fill+travel minutes across the week (hours-first score).
function weekPlacedMinutes(dayStates){
  if(!Array.isArray(dayStates))return 0;
  let total = 0;
  for(const state of dayStates){
    if(!state || !Array.isArray(state.fills))continue;
    for(const entry of state.fills){
      total += Number(entry && entry.fit && entry.fit.durMin) || 0;
      total += Number(entry && entry.fit && entry.fit.travelMin) || 0;
    }
  }
  return total;
}

// PURE: soft tiebreak — lower travel seconds across fills is better.
function weekTravelSecondsFromStates(dayStates){
  if(!Array.isArray(dayStates))return 0;
  let total = 0;
  for(const state of dayStates){
    if(!state || !Array.isArray(state.rows))continue;
    for(const row of state.rows){
      if(row && row.kind === 'travel')total += Number(row.seconds) || 0;
    }
  }
  return total;
}

// PURE: rebuild a day state's fills from a keep-list (scheduled rows preserved).
// Used by week hours repair when peeling a movable to another day.
function rebuildDayFromFills(state,fillsToKeep,candidates,opts = {}){
  const clean = clonePlacementState(state);
  clean.rows = state.rows.filter(r=>r.kind === 'scheduled');
  clean.fills = [];
  clean.placed = new Set();
  clean.usedMinutes = 0;
  clean.remaining = Math.max(0,Number(state.totalMinutes) || 0);
  clean.prevLocId = state.seedLocId;
  const scoreOpts = {
    settings:state.settings || opts.settings,
    weights:typeof resolveAgendaScoreWeights === 'function'
      ? resolveAgendaScoreWeights(state.settings || opts.settings) : null,
    allowNetwork:opts.allowNetwork !== false,
    spareWindows:typeof scarceWindowsToSpare === 'function'
      ? scarceWindowsToSpare(candidates || [],clean.dayBase,clean.seedLocId,clean.dayBase)
      : null
  };
  for(const fill of fillsToKeep){
    if(!fill || !fill.h)continue;
    if(fill.h.breakable){
      const before = clean.fills.length;
      if(!placeBreakableSessions(clean,fill,scoreOpts))return null;
      // placeBreakableSessions may split; ok
      void before;
      continue;
    }
    const fit = tryPlaceOnDay(clean,fill,scoreOpts);
    if(!fit)return null;
    commitPlacement(clean,fill,fit);
  }
  clean.day = state.day;
  syncDayAgendaItemsFromFills(clean);
  return clean;
}

function syncDayAgendaItemsFromFills(state){
  if(!state || !state.day)return;
  state.day.agendaItems = (state.fills || []).map(f=>({
    h:f.fill.h,i:f.fill.i,priority:f.fill.priority,scarcity:f.fill.scarcity,
    locationId:f.fit.locId,
    chunkMinutes:f.fill.chunkMinutes != null ? f.fill.chunkMinutes : null,
    chunkIndex:f.fill.chunkIndex != null ? f.fill.chunkIndex : null
  }));
}

function applyPlacementState(target,source){
  target.rows = source.rows;
  target.fills = source.fills;
  target.placed = source.placed;
  target.remaining = source.remaining;
  target.usedMinutes = source.usedMinutes;
  target.prevLocId = source.prevLocId;
  if(target.day && source.day)target.day.agendaItems = source.day.agendaItems;
  else syncDayAgendaItemsFromFills(target);
}

// PURE: compare the work retained by two day states. Route compaction is only
// allowed to change the order/times of already-accepted fills, never which
// candidate (or how many of its minutes) survived placement.
function dayFillMinuteSignature(state){
  const totals = new Map();
  for(const entry of (state && state.fills) || []){
    const fill = entry && entry.fill;
    const fit = entry && entry.fit;
    if(!fill || !fit)continue;
    const key = fill.i;
    totals.set(key,(totals.get(key) || 0) + Math.max(0,Number(fit.durMin) || 0));
  }
  return [...totals.entries()]
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
    .map(([key,minutes])=>`${key}:${minutes}`)
    .join('|');
}

function dayTravelSecondsFromState(state){
  return ((state && state.rows) || []).reduce(
    (sum,row)=>sum + (row && row.kind === 'travel' ? Number(row.seconds) || 0 : 0),0);
}

// PURE: nearest-neighbour replay order for fills already selected on one day.
// The actual replay still goes through tryPlaceOnDay, so allowed windows,
// scheduled rows, capacity, and persistent order constraints remain hard gates.
function routeCompactFillOrder(state){
  const left = (state && state.fills ? state.fills : []).map(entry=>entry.fill);
  const out = [];
  let anchor = state && state.seedLocId || null;
  while(left.length){
    let bestIdx = 0;
    let bestSeconds = Infinity;
    for(let i = 0;i < left.length;i += 1){
      const fill = left[i];
      const locId = fill.locationId
        || pickHabitLocationId(fill.h,anchor,state.registry,state.mode,state.dayBase);
      const seconds = travelEdgeBetweenIds(
        anchor,locId,state.registry,state.mode,{allowNetwork:false}
      ).seconds || 0;
      if(seconds < bestSeconds){
        bestSeconds = seconds;
        bestIdx = i;
      }
    }
    const picked = left.splice(bestIdx,1)[0];
    out.push(picked);
    const locId = picked.locationId
      || pickHabitLocationId(picked.h,anchor,state.registry,state.mode,state.dayBase);
    if(locId)anchor = locId;
  }
  return reorderAgendaItemsByOrderConstraints(out,state.dayBase);
}

// MUTATE: make a bounded, deterministic route improvement after Fast has
// decided what belongs on each day. This closes the common greedy artifact
// "far errand → flexible home task → nearby far errand". A replay is adopted
// only when it preserves the exact per-candidate minutes and strictly reduces
// travel, so placement coverage cannot regress.
function compactFastTravelRoutes(dayStates,candidates,settings){
  let improved = 0;
  for(const state of dayStates || []){
    if(!state || !Array.isArray(state.fills) || state.fills.length < 2)continue;
    const beforeSignature = dayFillMinuteSignature(state);
    const beforeTravel = dayTravelSecondsFromState(state);
    if(beforeTravel <= 0)continue;
    const order = routeCompactFillOrder(state);
    const isolated = {
      ...state,
      day:{...state.day,agendaItems:(state.day.agendaItems || []).slice()}
    };
    const rebuilt = rebuildDayFromFills(
      isolated,order,candidates,{settings,allowNetwork:false}
    );
    if(!rebuilt)continue;
    if(dayFillMinuteSignature(rebuilt) !== beforeSignature)continue;
    if(dayTravelSecondsFromState(rebuilt) >= beforeTravel)continue;
    applyPlacementState(state,rebuilt);
    improved += 1;
  }
  return improved;
}

function addScheduleLinkOmission(day,subjectHid,reason){
  if(!day || !subjectHid || !reason)return;
  if(!Array.isArray(day.linkOmissions))day.linkOmissions = [];
  if(day.linkOmissions.some(item=>item.subjectHid === subjectHid && item.reason === reason))return;
  day.linkOmissions.push({subjectHid,reason});
}

// Soft preference: prefer days that share a same-day OR partner (either my
// linked anchors, or subjects that same-day-link to me). Scarce partners
// (few eligible days, e.g. Friday-only Juma) get a stronger pull so a flexible
// Shower chooses Friday over an earlier empty flex day.
function scheduleLinkDayBonus(h,dayBase,candidates){
  if(!h || dayBase == null)return 0;
  const byHid = Array.isArray(candidates)
    ? new Map(candidates.filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]))
    : null;
  let best = 0;
  const bump = (partner,base)=>{
    if(!partner)return;
    const scarce = partner.eligible && partner.eligible.size > 0 && partner.eligible.size <= 2;
    best = Math.max(best, scarce ? base + 220 : base);
  };
  const sameDayLinks = typeof sameDayScheduleLinks === 'function'
    ? sameDayScheduleLinks(h)
    : normalizeScheduleLinks(h.scheduleLinks,h.hid).filter(l=>l && l.requireSameDay);
  for(const link of sameDayLinks){
    if(typeof scheduleAnchorCommitForDay === 'function' && scheduleAnchorCommitForDay(link.anchorHid,dayBase)){
      best = Math.max(best,400);
      continue;
    }
    const anchor = byHid && byHid.get(link.anchorHid);
    if(anchor && anchor.eligible && anchor.eligible.has(dayBase)){
      bump(anchor,180);
    }
  }
  for(const {candidate,link} of sameDaySubjectsForAnchor(h.hid,candidates)){
    if(!candidate.eligible || !candidate.eligible.has(dayBase))continue;
    // Direction from the subject's link: if they are "after" me, I am before them.
    const base = link && link.direction === 'after' ? 280 : 240;
    bump(candidate,base);
  }
  return best;
}

function persistentLinkViolationsForState(state){
  const violations = new Map();
  if(!state)return violations;
  const edges = typeof persistentOrderConstraintsForDay === 'function'
    ? persistentOrderConstraintsForDay(state.dayBase) : [];
  const chron = (state.fills || []).slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  const bounds = new Map();
  const chunksByHid = new Map();
  for(const entry of chron){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(!hid || !entry.fit)continue;
    const prev = bounds.get(hid);
    bounds.set(hid,{
      start:prev ? Math.min(prev.start,entry.fit.placeStart) : entry.fit.placeStart,
      end:prev ? Math.max(prev.end,entry.fit.placeEnd) : entry.fit.placeEnd
    });
    if(!chunksByHid.has(hid))chunksByHid.set(hid,[]);
    chunksByHid.get(hid).push(entry);
  }
  const resolveAnchor = (anchorHid)=>
    bounds.get(anchorHid) || scheduleAnchorCommitForDay(anchorHid,state.dayBase);

  // An anchor that is already logged for this day settles the link: the
  // same-day requirement is met, and no ordering rule can be repaired by
  // moving work into the past. Treating it as a live constraint dropped the
  // rest of a chain the moment its first step was ticked off. The exception
  // is "right before a finished anchor" — that pairing genuinely expired, so
  // the subject is still reported as omitted.
  const anchorAlreadyDone = (edge)=>{
    if(!edge || !edge.anchorHid)return false;
    if(edge.adjacency === 'direct' && edge.direction === 'before')return false;
    if(bounds.has(edge.anchorHid))return false;
    const commit = scheduleAnchorCommitForDay(edge.anchorHid,state.dayBase);
    return Boolean(commit && commit.kind === 'completed');
  };

  // Direct adjacency: use the latest before-chunk that ends at/before the
  // after start (so a morning keepup shower does not "span" through Work to
  // afternoon Juma). Empty multi-hour gaps also fail — right-after means the
  // next feasible slot, not same calendar day with idle hours between.
  const DIRECT_EMPTY_GAP_MAX_MIN = 90;
  const directAdjacencyOk = (beforeHid,afterHid,afterStart)=>{
    const chunks = (chunksByHid.get(beforeHid) || [])
      .filter(entry=>entry.fit.placeEnd <= afterStart + 60000)
      .sort((a,b)=>b.fit.placeEnd - a.fit.placeEnd);
    if(!chunks.length){
      const committed = scheduleAnchorCommitForDay(beforeHid,state.dayBase);
      if(!committed || committed.end > afterStart + 60000)return false;
      const gapMin = Math.max(0,(afterStart - committed.end) / 60000);
      return gapMin <= DIRECT_EMPTY_GAP_MAX_MIN;
    }
    const predEnd = chunks[0].fit.placeEnd;
    const interloper = chron.some(entry=>{
      const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
      if(!hid || hid === beforeHid || hid === afterHid || !entry.fit)return false;
      return entry.fit.placeStart + 60000 >= predEnd && entry.fit.placeEnd <= afterStart + 60000;
    });
    if(interloper)return false;
    const gapMin = Math.max(0,(afterStart - predEnd) / 60000);
    return gapMin <= DIRECT_EMPTY_GAP_MAX_MIN;
  };

  // Must-do (requiresPair) edges: when a partner is present the subject must
  // also be placed and satisfy order (+ direct when required). OR'd across
  // partners — subject alone on a day with no partner is fine.
  const sameDayBySubject = new Map();
  for(const edge of edges){
    if(!edge.requiresPair || !edge.subjectHid)continue;
    if(!sameDayBySubject.has(edge.subjectHid))sameDayBySubject.set(edge.subjectHid,[]);
    sameDayBySubject.get(edge.subjectHid).push(edge);
  }
  for(const [subjectHid,subjectEdges] of sameDayBySubject){
    const subject = bounds.get(subjectHid);
    const present = subjectEdges.filter(edge=>resolveAnchor(edge.anchorHid));
    if(!present.length)continue;
    if(!subject){
      violations.set(subjectHid,'must do on days with its linked habit');
      continue;
    }
    // OR: satisfied if any present partner meets order (+ direct when required).
    let anyOk = false;
    let bestReason = null;
    for(const edge of present){
      if(anchorAlreadyDone(edge)){ anyOk = true; break; }
      const anchor = resolveAnchor(edge.anchorHid);
      const beforeHid = edge.direction === 'before' ? edge.subjectHid : edge.anchorHid;
      const afterHid = edge.direction === 'before' ? edge.anchorHid : edge.subjectHid;
      const before = edge.direction === 'before' ? subject : anchor;
      const after = edge.direction === 'before' ? anchor : subject;
      if(before.end > after.start + 60000){
        bestReason = bestReason || `cannot be ${edge.direction} its anchor`;
        continue;
      }
      if(edge.adjacency === 'direct'){
        if(directAdjacencyOk(beforeHid,afterHid,after.start)){ anyOk = true; break; }
        bestReason = `no right-${edge.direction} slot is available`;
        continue;
      }
      anyOk = true;
      break;
    }
    if(!anyOk && bestReason)violations.set(subjectHid,bestReason);
  }

  // Order-only edges are OR'd per subject when both sides are placed: satisfied
  // if any present partner meets order (+ direct). AND would make multi-parent
  // right-after (shower after exercise OR haircut) impossible on shared days.
  const orderOnlyBySubject = new Map();
  for(const edge of edges){
    if(edge.requiresPair || !edge.subjectHid)continue;
    if(!orderOnlyBySubject.has(edge.subjectHid))orderOnlyBySubject.set(edge.subjectHid,[]);
    orderOnlyBySubject.get(edge.subjectHid).push(edge);
  }
  for(const [subjectHid,subjectEdges] of orderOnlyBySubject){
    const subject = bounds.get(subjectHid);
    if(!subject)continue;
    const present = subjectEdges.filter(edge=>resolveAnchor(edge.anchorHid));
    if(!present.length)continue;
    let anyOk = false;
    let bestReason = null;
    for(const edge of present){
      if(anchorAlreadyDone(edge)){ anyOk = true; break; }
      const anchor = resolveAnchor(edge.anchorHid);
      const beforeHid = edge.direction === 'before' ? edge.subjectHid : edge.anchorHid;
      const afterHid = edge.direction === 'before' ? edge.anchorHid : edge.subjectHid;
      const before = edge.direction === 'before' ? subject : anchor;
      const after = edge.direction === 'before' ? anchor : subject;
      if(before.end > after.start + 60000){
        bestReason = bestReason || `cannot be ${edge.direction} its anchor`;
        continue;
      }
      if(edge.adjacency === 'direct'){
        if(directAdjacencyOk(beforeHid,afterHid,after.start)){ anyOk = true; break; }
        bestReason = `no right-${edge.direction} slot is available`;
        continue;
      }
      anyOk = true;
      break;
    }
    if(!anyOk && bestReason)violations.set(subjectHid,bestReason);
  }
  return violations;
}

// Try moving a flexible keepup/task predecessor to abut its direct successor
// (Shower just before Juma) before dropping either side.
function tryRelocateDirectBeforeAnchor(state,edge,candidates,settings){
  if(!state || !edge || edge.adjacency !== 'direct')return false;
  const beforeHid = edge.beforeHid;
  const afterHid = edge.afterHid;
  if(!beforeHid || !afterHid)return false;
  if(!(state.fills || []).some(entry=>entry && entry.fill && entry.fill.h && entry.fill.h.hid === afterHid)){
    return false;
  }
  const beforeCand = (candidates || []).find(c=>c && c.h && c.h.hid === beforeHid);
  if(!beforeCand || !beforeCand.h)return false;
  if(beforeCand.h.type !== 'keepup' && beforeCand.h.type !== 'task')return false;

  // Reuse committed fits for fixed items — a full re-place often fails when
  // Lunch/Work/prayer order is fragile, which left morning Shower + Juma intact.
  const fixedEntries = (state.fills || [])
    .filter(entry=>{
      const h = entry && entry.fill && entry.fill.h;
      return h && h.hid !== beforeHid && !h.breakable && entry.fit;
    })
    .slice()
    .sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  const breakableByIndex = new Map();
  for(const entry of state.fills || []){
    const h = entry && entry.fill && entry.fill.h;
    if(!h || !h.breakable || h.hid === beforeHid)continue;
    if(!breakableByIndex.has(entry.fill.i))breakableByIndex.set(entry.fill.i,entry.fill);
  }
  const scoreOpts = {
    settings,
    allowNetwork:false,
    weights:typeof resolveAgendaScoreWeights === 'function'
      ? resolveAgendaScoreWeights(settings) : null
  };
  const trial = clonePlacementState(state);
  trial.fills = [];
  trial.placed = new Set();
  trial.usedMinutes = 0;
  trial.remaining = Math.max(0,Number(state.totalMinutes) || 0);
  trial.prevLocId = state.seedLocId;
  trial.rows = (state.rows || []).filter(r=>r && r.kind === 'scheduled');
  for(const entry of fixedEntries){
    commitPlacement(trial,entry.fill,entry.fit);
  }
  const fill = {
    h:beforeCand.h,i:beforeCand.i,
    priority:beforeCand.priority,scarcity:beforeCand.scarcity
  };
  const fit = tryPlaceOnDay(trial,fill,scoreOpts);
  if(!fit)return false;
  commitPlacement(trial,fill,fit);
  for(const bFill of breakableByIndex.values()){
    if(!bFill || !bFill.h)continue;
    if(typeof placeBreakableSessions === 'function'){
      placeBreakableSessions(trial,bFill,scoreOpts);
    }else{
      const bFit = tryPlaceOnDay(trial,bFill,scoreOpts);
      if(bFit)commitPlacement(trial,bFill,bFit);
    }
  }
  syncDayAgendaItemsFromFills(trial);
  const stillBad = persistentLinkViolationsForState(trial);
  if(edge.subjectHid && stillBad.has(edge.subjectHid))return false;
  applyPlacementState(state,trial);
  syncDayAgendaItemsFromFills(state);
  return true;
}

// Final invariant pass shared by Fast and GLPK. Repair/rescue stages are free
// to move unrelated work, but may never leave a visibly linked subject in a
// violating position.
function enforcePersistentLinkInvariants(dayStates,candidates,settings){
  if(!Array.isArray(dayStates))return;
  const byHid = new Map((candidates || []).filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]));
  for(const state of dayStates){
    let guard = 0;
    while(guard++ < 8){
      const violations = persistentLinkViolationsForState(state);
      if(!violations.size)break;
      // Prefer relocating flexible direct predecessors over dropping Juma.
      let relocated = false;
      const edges = typeof persistentOrderConstraintsForDay === 'function'
        ? persistentOrderConstraintsForDay(state.dayBase) : [];
      for(const edge of edges){
        if(!edge || edge.adjacency !== 'direct')continue;
        const subjectHit = edge.subjectHid && violations.has(edge.subjectHid);
        if(!subjectHit)continue;
        if(tryRelocateDirectBeforeAnchor(state,edge,candidates,settings)){
          relocated = true;
          break;
        }
      }
      if(relocated)continue;

      // Must-do: partner present but subject missing — try to place the subject
      // once. If it cannot fit, record an omission and stop (do not loop).
      let placedMissing = false;
      for(const [hid,reason] of violations){
        const alreadyPlaced = (state.fills || []).some(entry=>
          entry && entry.fill && entry.fill.h && entry.fill.h.hid === hid
        );
        if(alreadyPlaced)continue;
        if(!/must do on days/.test(reason || ''))continue;
        addScheduleLinkOmission(state.day,hid,reason);
        const cand = byHid.get(hid);
        if(!cand || state.placed.has(cand.i))continue;
        const fill = {
          h:cand.h,i:cand.i,
          priority:cand.priority,scarcity:cand.scarcity
        };
        const scoreOpts = {settings,allowNetwork:false,candidates};
        const fit = typeof tryPlaceOnDay === 'function'
          ? tryPlaceOnDay(state,fill,scoreOpts)
          : null;
        if(fit){
          commitPlacement(state,fill,fit);
          syncDayAgendaItemsFromFills(state);
          placedMissing = true;
        }
      }
      if(placedMissing)continue;

      // Drop placed habits that still violate (bad order / adjacency).
      const placedViolations = [...violations].filter(([hid])=>
        (state.fills || []).some(entry=>
          entry && entry.fill && entry.fill.h && entry.fill.h.hid === hid
        )
      );
      if(!placedViolations.length)break;
      for(const [hid,reason] of placedViolations)addScheduleLinkOmission(state.day,hid,reason);
      const drop = new Set(placedViolations.map(([hid])=>hid));
      const keep = (state.fills || [])
        .filter(entry=>!drop.has(entry && entry.fill && entry.fill.h && entry.fill.h.hid))
        .map(entry=>entry.fill);
      const rebuilt = rebuildDayFromFills(state,keep,candidates,{settings,allowNetwork:false});
      if(!rebuilt)break;
      applyPlacementState(state,rebuilt);
    }

    // Must-do subject alone while a same-day partner was attempted today but
    // failed to place (e.g. Haircut no longer fits): drop the subject. Solo is
    // only allowed when no linked partner was on this day's candidate set.
    dropSubjectsWithFailedSameDayPartners(state,candidates,byHid,settings);
  }
}

/** PURE/HYBRID: drop must-do subjects left alone after a failed partner attempt. */
function dropSubjectsWithFailedSameDayPartners(state,candidates,byHid,settings){
  if(!state || !byHid || !byHid.size)return;
  const placedHids = new Set();
  for(const entry of state.fills || []){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(hid)placedHids.add(hid);
  }
  const partnerPlaced = (anchorHid)=>
    placedHids.has(anchorHid)
    || (typeof scheduleAnchorCommitForDay === 'function'
      && Boolean(scheduleAnchorCommitForDay(anchorHid,state.dayBase)));
  const partnerAttemptedToday = (anchorHid)=>{
    if(partnerPlaced(anchorHid))return false;
    const partner = byHid.get(anchorHid);
    if(!partner)return false;
    if(partner.eligible)return partner.eligible.has(state.dayBase);
    // Single-day pass: candidates are today's attempted fills.
    return true;
  };
  const drop = new Set();
  for(const cand of candidates || []){
    const h = cand && cand.h;
    if(!h || !h.hid || !state.placed.has(cand.i))continue;
    const links = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(h)
      : (typeof normalizeScheduleLinks === 'function'
        ? normalizeScheduleLinks(h.scheduleLinks,h.hid).filter(l=>l && l.requireSameDay)
        : []);
    if(!links.length)continue;
    if(links.some(link=>partnerPlaced(link.anchorHid)))continue;
    if(!links.some(link=>partnerAttemptedToday(link.anchorHid)))continue;
    drop.add(h.hid);
    addScheduleLinkOmission(state.day,h.hid,'linked partner could not fit today');
  }
  if(!drop.size)return;
  const keep = (state.fills || [])
    .filter(entry=>!drop.has(entry && entry.fill && entry.fill.h && entry.fill.h.hid))
    .map(entry=>entry.fill);
  const rebuilt = rebuildDayFromFills(state,keep,candidates,{settings,allowNetwork:false});
  if(rebuilt)applyPlacementState(state,rebuilt);
}

// Week-holistic repair: when a daily breakable (e.g. Work) is short and a
// can-wait movable sits in its window, peel that movable to another eligible
// day and refill Work. Accept only if week placed minutes do not drop (hours
// first); soft travel is a tiebreak. Bounded attempts — mirrors
// rebalanceScarcePlacements.
function repairWeekPlacedHours(candidates,dayStates,settings,options = {}){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates) || !dayStates.length)return 0;
  const MAX_ATTEMPTS = 16;
  let attempts = 0;
  let moves = 0;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));

  const shortBreakableOn = (state)=>{
    const reservations = dailyBreakableReservations(state,candidates);
    for(const r of reservations){
      if(r.deficit <= 0)continue;
      const c = byIndex.get(r.i);
      if(c)return {c,r};
    }
    return null;
  };

  const isDeferrableFrom = (c,fromState)=>{
    if(!isMovableWeekCandidate(c))return false;
    const dur = clampDuration(c.h.durationMinutes);
    for(const other of dayStates){
      if(other === fromState)continue;
      if(c.eligible && !c.eligible.has(other.dayBase))continue;
      if(c.pinned && !other.isTodayDay)continue;
      if(other.placed.has(c.i))continue;
      const cap = movableCapacityForDay(other,candidates);
      if(!Number.isFinite(cap) || cap >= dur)return true;
      // Even if other day has a breakable, tryPlace may still fit outside its window.
      if(typeof tryPlaceOnDay === 'function'){
        const probe = clonePlacementState(other);
        const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
        if(tryPlaceOnDay(probe,fill,{allowNetwork:false,settings}))return true;
      }
    }
    return false;
  };

  while(attempts < MAX_ATTEMPTS){
    let short = null;
    for(const state of dayStates){
      const hit = shortBreakableOn(state);
      if(hit){ short = {state,...hit}; break; }
    }
    if(!short)break;

    const windows = breakableReservationWindows(short.r);
    const victims = short.state.fills.filter(entry=>{
      if(!entry || !entry.fill || !entry.fit)return false;
      const c = byIndex.get(entry.fill.i);
      if(!c || !isDeferrableFrom(c,short.state))return false;
      if(!windows.some(win=>
        entry.fit.placeEnd > win.start && entry.fit.placeStart < win.end))return false;
      return true;
    });
    // Prefer longer victims first — more likely to unlock a Work chunk.
    victims.sort((a,b)=>(Number(b.fit.durMin) || 0) - (Number(a.fit.durMin) || 0));

    let improved = false;
    for(const victim of victims){
      if(attempts >= MAX_ATTEMPTS)break;
      const vc = byIndex.get(victim.fill.i);
      if(!vc)continue;
      for(const other of dayStates){
        if(attempts >= MAX_ATTEMPTS)break;
        if(other === short.state)continue;
        if(vc.eligible && !vc.eligible.has(other.dayBase))continue;
        if(vc.pinned && !other.isTodayDay)continue;
        if(other.placed.has(vc.i))continue;
        attempts += 1;

        const beforeMinutes = weekPlacedMinutes(dayStates);
        const beforeTravel = weekTravelSecondsFromStates(dayStates);
        const beforeDeficit = short.r.deficit;

        const keepFills = short.state.fills
          .filter(f=>f !== victim)
          .map(f=>({...f.fill}));
        // Collapse breakable chunks for the same habit into one fill seed so
        // placeBreakableSessions can re-split cleanly.
        const collapsed = [];
        const seenBreak = new Set();
        for(const f of keepFills){
          if(f.h && f.h.breakable){
            if(seenBreak.has(f.i))continue;
            seenBreak.add(f.i);
            collapsed.push({h:f.h,i:f.i,priority:f.priority,scarcity:f.scarcity});
          }else{
            // Re-run location choice from the habit constraints. Adding an
            // `undefined` locationId property here used to mean "force none"
            // and silently removed Grocery/Home travel during hours repair.
            collapsed.push({h:f.h,i:f.i,priority:f.priority,scarcity:f.scarcity});
          }
        }

        const sourceClean = rebuildDayFromFills(short.state,collapsed,candidates,{settings,allowNetwork:true});
        if(!sourceClean)continue;

        // Ensure the short breakable is represented so it can reclaim gaps.
        if(!collapsed.some(f=>f.i === short.c.i)){
          const bf = {h:short.c.h,i:short.c.i,priority:short.c.priority,scarcity:short.c.scarcity};
          placeBreakableSessions(sourceClean,bf,{
            settings,allowNetwork:true,
            weights:typeof resolveAgendaScoreWeights === 'function'
              ? resolveAgendaScoreWeights(settings) : null
          });
          syncDayAgendaItemsFromFills(sourceClean);
        }else{
          // Already re-placed via rebuild; try to fill any remaining deficit.
          const left = breakableMinutesLeft(short.c.h,short.c.i,sourceClean);
          if(left > 0){
            placeBreakableSessions(sourceClean,{
              h:short.c.h,i:short.c.i,priority:short.c.priority,scarcity:short.c.scarcity
            },{settings,allowNetwork:true});
            syncDayAgendaItemsFromFills(sourceClean);
          }
        }

        const targetClean = clonePlacementState(other);
        const movableFill = {h:vc.h,i:vc.i,priority:vc.priority,scarcity:vc.scarcity};
        const movedFit = tryPlaceOnDay(targetClean,movableFill,{
          settings,allowNetwork:true,
          weights:typeof resolveAgendaScoreWeights === 'function'
            ? resolveAgendaScoreWeights(settings) : null
        });
        if(!movedFit)continue;
        commitPlacement(targetClean,movableFill,movedFit);
        targetClean.day = other.day;
        syncDayAgendaItemsFromFills(targetClean);

        // Score hypothetical week with source/target replaced.
        const hypo = dayStates.map(st=>{
          if(st === short.state)return sourceClean;
          if(st === other)return targetClean;
          return st;
        });
        const afterMinutes = weekPlacedMinutes(hypo);
        const afterTravel = weekTravelSecondsFromStates(hypo);
        const afterRes = dailyBreakableReservations(sourceClean,candidates)
          .find(r=>r.i === short.c.i);
        const afterDeficit = afterRes ? afterRes.deficit : 0;

        // Hours-first: reject any move that lowers week placed minutes.
        if(afterMinutes < beforeMinutes)continue;
        // Prefer moves that reduce this day's Work deficit.
        if(afterDeficit > beforeDeficit && afterMinutes === beforeMinutes)continue;
        if(afterMinutes === beforeMinutes && afterDeficit === beforeDeficit
          && afterTravel > beforeTravel)continue;

        applyPlacementState(short.state,sourceClean);
        applyPlacementState(other,targetClean);
        moves += 1;
        improved = true;
        break;
      }
      if(improved)break;
    }
    if(!improved)break;
  }
  // A one-at-a-time repair cannot cross a contiguity valley: removing one
  // 30-minute blocker may still leave every opening below Work's 45-minute
  // minimum chunk, so that individually neutral move is rejected even though
  // moving a second blocker would recover the whole deficit. The background
  // exact refinement enables a bounded 2/3-item neighborhood search for that
  // case. Keep it out of the first-paint pass so heavy users still get a quick
  // feasible incumbent.
  if(options && options.deep){
    moves += repairBreakableContiguityNeighborhood(candidates,dayStates,settings,options);
  }
  return moves;
}

// HYBRID: jointly relocate a small set of flexible blockers so a daily
// breakable can reclaim contiguous chunks. This is deliberately a bounded
// neighborhood repair rather than an item-name rule or an unbounded power set.
// Persistent order-link participants are never victims: their coupled timing
// must be handled by the link invariant machinery.
function repairBreakableContiguityNeighborhood(candidates,dayStates,settings,options = {}){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates) || !dayStates.length)return 0;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));
  const maxTrials = Math.max(1,Math.min(64,Number(options.maxContiguityTrials) || 28));
  const maxVictims = Math.max(2,Math.min(3,Number(options.maxContiguityVictims) || 3));
  let trials = 0;
  let moves = 0;

  const deficitFor = (state,idx)=>{
    const hit = dailyBreakableReservations(state,candidates).find(r=>r.i === idx);
    return hit ? hit.deficit : 0;
  };
  const linkedHidsFor = state=>{
    const out = new Set();
    const edges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
    for(const edge of edges || []){
      if(edge && edge.beforeHid)out.add(edge.beforeHid);
      if(edge && edge.afterHid)out.add(edge.afterHid);
    }
    return out;
  };
  const collapsedKeepFills = (state,removed)=>{
    const out = [];
    const seenBreak = new Set();
    for(const entry of state.fills || []){
      const fill = entry && entry.fill;
      if(!fill || !fill.h || removed.has(fill.i))continue;
      if(fill.h.breakable){
        if(seenBreak.has(fill.i))continue;
        seenBreak.add(fill.i);
        out.push({h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity});
      }else{
        out.push({h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity});
      }
    }
    return out;
  };
  const combinations = (items,size)=>{
    const out = [];
    const walk = (at,pick)=>{
      if(out.length >= maxTrials)return;
      if(pick.length === size){ out.push(pick.slice()); return; }
      for(let i = at;i < items.length;i += 1){
        pick.push(items[i]);
        walk(i + 1,pick);
        pick.pop();
        if(out.length >= maxTrials)return;
      }
    };
    walk(0,[]);
    return out;
  };
  const placeVictims = (victims,sourceIndex,sourceClean)=>{
    const working = new Map([[sourceIndex,sourceClean]]);
    const scoreOpts = state=>({
      settings:state.settings || settings,
      weights:typeof resolveAgendaScoreWeights === 'function'
        ? resolveAgendaScoreWeights(state.settings || settings) : null,
      allowNetwork:true,
      candidates
    });
    const walk = pos=>{
      if(pos >= victims.length)return working;
      const victim = victims[pos];
      const c = victim.c;
      // Prefer retaining the item today outside the now-protected Work chunks;
      // otherwise use its earliest eligible future day.
      const targetIndexes = [sourceIndex];
      for(let i = 0;i < dayStates.length;i += 1){
        if(i !== sourceIndex)targetIndexes.push(i);
      }
      for(const targetIndex of targetIndexes){
        const targetBase = working.get(targetIndex) || dayStates[targetIndex];
        if(!targetBase)continue;
        if(c.eligible && !c.eligible.has(targetBase.dayBase))continue;
        if(c.pinned && !targetBase.isTodayDay)continue;
        if(targetBase.placed && targetBase.placed.has(c.i))continue;
        const trial = clonePlacementState(targetBase);
        trial.day = targetBase.day;
        const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
        const fit = tryPlaceOnDay(trial,fill,scoreOpts(trial));
        if(!fit)continue;
        commitPlacement(trial,fill,fit);
        syncDayAgendaItemsFromFills(trial);
        working.set(targetIndex,trial);
        const solved = walk(pos + 1);
        if(solved)return solved;
        if(targetBase === dayStates[targetIndex])working.delete(targetIndex);
        else working.set(targetIndex,targetBase);
      }
      return null;
    };
    return walk(0);
  };

  while(trials < maxTrials){
    let improved = false;
    for(let sourceIndex = 0;sourceIndex < dayStates.length && !improved;sourceIndex += 1){
      const state = dayStates[sourceIndex];
      const reservations = dailyBreakableReservations(state,candidates)
        .filter(r=>r.deficit > 0 && byIndex.has(r.i));
      for(const reservation of reservations){
        const short = byIndex.get(reservation.i);
        if(!short)continue;
        const linked = linkedHidsFor(state);
        const windows = breakableReservationWindows(reservation);
        const victims = (state.fills || []).map(entry=>{
          const c = entry && entry.fill ? byIndex.get(entry.fill.i) : null;
          return {entry,c};
        }).filter(({entry,c})=>{
          if(!entry || !entry.fit || !c || !c.h || c.i === short.i)return false;
          if(!isMovableWeekCandidate(c) || c.pinned)return false;
          if(c.h.hid && linked.has(c.h.hid))return false;
          if(typeof mustPlaceCriticalOccurrence === 'function'
            && mustPlaceCriticalOccurrence(c))return false;
          return windows.some(win=>entry.fit.placeEnd > win.start && entry.fit.placeStart < win.end);
        }).sort((a,b)=>{
          const pri = (Number(b.c.priority) || 0) - (Number(a.c.priority) || 0);
          if(pri)return pri;
          return (Number(b.entry.fit.durMin) || 0) - (Number(a.entry.fit.durMin) || 0);
        }).slice(0,8);
        if(victims.length < 2)continue;

        const beforeMinutes = weekPlacedMinutes(dayStates);
        const beforeTravel = weekTravelSecondsFromStates(dayStates);
        const beforeDeficit = reservation.deficit;
        for(let size = 2;size <= Math.min(maxVictims,victims.length) && !improved;size += 1){
          for(const combo of combinations(victims,size)){
            if(trials++ >= maxTrials)break;
            const removed = new Set(combo.map(v=>v.c.i));
            const sourceClean = rebuildDayFromFills(
              state,
              collapsedKeepFills(state,removed),
              candidates,
              {settings,allowNetwork:true}
            );
            if(!sourceClean)continue;
            const reclaimedDeficit = deficitFor(sourceClean,short.i);
            if(reclaimedDeficit >= beforeDeficit)continue;
            const placed = placeVictims(combo,sourceIndex,sourceClean);
            if(!placed)continue;
            const hypothetical = dayStates.map((original,index)=>placed.get(index) || original);
            const afterMinutes = weekPlacedMinutes(hypothetical);
            const afterTravel = weekTravelSecondsFromStates(hypothetical);
            const finalSource = placed.get(sourceIndex) || sourceClean;
            const afterDeficit = deficitFor(finalSource,short.i);
            if(afterDeficit >= beforeDeficit)continue;
            if(afterMinutes < beforeMinutes)continue;
            if(afterMinutes === beforeMinutes && afterDeficit === beforeDeficit
              && afterTravel > beforeTravel)continue;
            for(const [index,replacement] of placed){
              applyPlacementState(dayStates[index],replacement);
              syncDayAgendaItemsFromFills(dayStates[index]);
            }
            moves += combo.length;
            improved = true;
            break;
          }
        }
        if(improved)break;
      }
    }
    if(!improved)break;
  }
  return moves;
}

// PURE: after greedy scarcity placement, try to free a scarce unplaced item by
// temporarily removing one flexible fill and re-fitting both. Bounded attempts.
function rebalanceScarcePlacements(candidates,dayStates,_settings,_locHints){
  const MAX_ATTEMPTS = 8;
  let gained = 0;
  let attempts = 0;
  const scarce = candidates.filter(c=>isScarceScore(c.scarcity));
  for(const c of scarce){
    if(attempts >= MAX_ATTEMPTS)break;
    for(const state of dayStates){
      if(attempts >= MAX_ATTEMPTS)break;
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(state.placed.has(c.i))continue;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      const earlyFit = tryPlaceOnDay(state,fill);
      if(earlyFit){
        commitPlacement(state,fill,earlyFit);
        state.day.agendaItems.push({h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:earlyFit.locId});
        gained += 1;
        continue;
      }
      const flexibleFills = state.fills.filter(f=>f.fill && !isScarceScore(f.fill.scarcity)
        && !(typeof hasTimeWindow === 'function' && hasTimeWindow(f.fill.h))
        && !(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(f.fill.h)));
      for(const victim of flexibleFills){
        if(attempts >= MAX_ATTEMPTS)break;
        attempts += 1;
        const others = state.fills.filter(f=>f !== victim).map(f=>f.fill);
        const clean = clonePlacementState(state);
        clean.rows = state.rows.filter(r=>r.kind === 'scheduled');
        clean.fills = [];
        clean.placed = new Set();
        // Restore remaining from scheduled-only baseline.
        let used = 0;
        for(const r of clean.rows){
          if(r.kind === 'scheduled')used += Math.max(0,(r.end - r.start) / 60000);
        }
        clean.usedMinutes = 0;
        clean.remaining = Math.max(0,(Number(state.totalMinutes) || 0));
        clean.prevLocId = state.seedLocId;
        let ok = true;
        const scoreOpts = {
          settings:state.settings,
          weights:resolveAgendaScoreWeights(state.settings),
          spareWindows:scarceWindowsToSpare(candidates,clean.dayBase,clean.seedLocId,clean.dayBase)
        };
        for(const other of others){
          const refit = tryPlaceOnDay(clean,other,scoreOpts);
          if(!refit){ ok = false; break; }
          commitPlacement(clean,other,refit);
        }
        if(!ok)continue;
        const scarceFit = tryPlaceOnDay(clean,fill,scoreOpts);
        if(!scarceFit)continue;
        commitPlacement(clean,fill,scarceFit);
        const victimFit = tryPlaceOnDay(clean,victim.fill,scoreOpts);
        if(victimFit)commitPlacement(clean,victim.fill,victimFit);
        state.rows = clean.rows;
        state.fills = clean.fills;
        state.placed = clean.placed;
        state.remaining = clean.remaining;
        state.usedMinutes = clean.usedMinutes;
        state.prevLocId = clean.prevLocId;
        state.day.agendaItems = state.fills.map(f=>({
          h:f.fill.h,i:f.fill.i,priority:f.fill.priority,scarcity:f.fill.scarcity,
          locationId:f.fit.locId,
          chunkMinutes:f.fill.chunkMinutes != null ? f.fill.chunkMinutes : null,
          chunkIndex:f.fill.chunkIndex != null ? f.fill.chunkIndex : null
        }));
        gained += 1;
        break;
      }
    }
  }
  return gained;
}

// PURE: co-location hint bonus for placing at locId on this day. Rewards joining
// a day where a prior pass placed a NEARBY place (a different candidate), by the
// commute that would be saved. Ignores the candidate's own prior placement so it
// can move toward a partner rather than just staying put. Returns 0 when there
// is no day origin to measure a commute against.
function colocateHintBonus(state,locId,ownIdx,locHints,registry,mode){
  if(!locId || !locHints)return 0;
  const arr = locHints.get(state.dayBase);
  if(!arr || !arr.length)return 0;
  const origin = state.seedLocId;
  if(!origin)return 0;
  const homeCommute = travelEdgeBetweenIds(origin,locId,registry,mode).seconds;
  if(homeCommute <= 0)return 0;
  let best = 0;
  for(const ent of arr){
    if(ent.idx === ownIdx)continue;               // ignore our own prior placement
    if(ent.locId === locId){ best = Math.max(best, homeCommute); continue; }
    const inter = travelEdgeBetweenIds(ent.locId,locId,registry,mode).seconds;
    // Co-located only when the partner is much closer than the day's origin.
    if(inter < homeCommute * 0.5)best = Math.max(best, homeCommute - inter);
  }
  return best;
}

// PURE: capture, per day, the locations a placement pass committed (with the
// candidate data-index so a candidate can ignore its own prior spot). Feeds the
// co-location hint used by the second pass.
function collectLocationHints(dayStates){
  const map = new Map();
  for(const state of dayStates){
    for(const f of state.fills){
      if(!f.fit.locId)continue;
      let arr = map.get(state.dayBase);
      if(!arr){ arr = []; map.set(state.dayBase, arr); }
      arr.push({ locId:f.fit.locId, idx:f.fill.i });
    }
  }
  return map;
}

// PURE: build a 7-day agenda via placement-backed assignment. Every timed row
// on a day satisfied hard constraints at commit time.
//
// Two passes: (1) a greedy placement to discover where each location tends to
// land, then (2) a fresh placement biased toward days that sent a co-located
// partner. The second pass is what makes two far-from-home but close-together
// errands share one trip even when one errand is day-pinned and the flexible
// one is processed first — a single greedy pass cannot see a partner that has
// not been placed yet. Pass 2 reuses the same eligibility/priority/feasibility
// gates, only the day-preference score changes, so nothing gets placed that
// wouldn't have been placeable before.
