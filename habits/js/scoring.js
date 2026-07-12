// ─────────────────────────────────────────────────────────────────────────
// scoring.js — Planner-ready priority scoring, rhythm signals, and search.
//
// Pure module: every function here takes data in and returns data out. The
// only impurities are reads of the `sortSettings` global (passed in by
// attentionScore/visibleIndices via settingsOverride or default) and reads of
// `searchQuery` / `homeTopicFilter` in filteredVisibleIndices. None of these
// functions touch the DOM except `updateQuotaBar`, which is grouped separately
// at the bottom for easy extraction.
//
// Port target: src/logic/scoring.ts — types only, no logic changes.
// ─────────────────────────────────────────────────────────────────────────

// ─── Visual metadata: tones, colors, icons ───
// Map habit state → CSS class tokens used by the view layer. Pure.

function currentRun(h){
  const logs = actualLogs(h.logs).sort((a,b)=>b-a);
  const days = daysSince(h.lastLog);
  if(h.type === 'task'){
    if(h.lastLog !== null)return {num:Math.max(0,days),label:'since done'};
    const when = taskWhen(h);
    if(when === null)return {num:'-',label:'someday'};
    const left = daysUntil(when);
    if(left === null)return {num:'-',label:'when'};
    if(left < 0)return {num:Math.abs(left),label:'days ago'};
    if(left === 0)return {num:0,label:isTimedTask(h) ? 'today' : 'due'};
    return {num:left,label:'days away'};
  }
  if(h.type !== 'keepup'){
    return {num:days === null ? '-' : Math.max(0,days),label:'clear'};
  }
  if(!logs.length)return {num:'-',label:'run'};
  const targetMs = effectiveTarget(h) * 86400000;
  if(days !== null && days > effectiveTarget(h))return {num:0,label:'run'};
  let run = 1;
  for(let i=0;i<logs.length - 1;i++){
    if(logs[i] - logs[i + 1] <= targetMs)run += 1;
    else break;
  }
  return {num:run,label:'run'};
}

// ─── UI side-effect — DOM-aware (the one impure function in this file) ───
// updateQuotaBar reads QUOTA_WARN_KB and mutates #quota-bar. It lives here
// because save() in data.js calls it directly. In the RN port this becomes a
// React state update triggered by the store, not a function in scoring.ts.

function updateQuotaBar(kb){
  const bar = $('quota-bar');
  if(kb >= QUOTA_WARN_KB){
    bar.style.display = 'block';
    bar.textContent = `storage: ~${kb} KB. Old dense activity may be compacted before saves are blocked.`;
  }else{
    bar.style.display = 'none';
  }
}

function defaultIcon(type){
  if(type === 'zero')return 'ti-flame-off';
  if(type === 'reduce')return 'ti-trending-down';
  if(type === 'task')return 'ti-checkbox';
  return 'ti-heart';
}

function tone(days,target,type){
  if(type === 'task'){
    if(days === null)return 'quiet';
    return 'teal';
  }
  if(type === 'zero'){
    if(days === null)return 'purple';
    if(days === 0)return 'red';
    if(days < 3)return 'amber';
    return 'teal';
  }
  if(days === null)return 'quiet';
  const ratio = days / target;
  if(type === 'keepup')return ratio < 0.75 ? 'teal' : ratio < 1.1 ? 'amber' : 'red';
  return ratio > 1.5 ? 'teal' : ratio > 0.9 ? 'amber' : 'red';
}

function colors(days,target,type){
  const t = tone(days,target,type);
  const map = {
    teal:{bg:'var(--teal-bg)',icon:'var(--teal-icon)'},
    amber:{bg:'var(--amber-bg)',icon:'var(--amber-icon)'},
    red:{bg:'var(--red-bg)',icon:'var(--red-icon)'},
    purple:{bg:'var(--purple-bg)',icon:'var(--purple-icon)'},
    quiet:{bg:'var(--bg2)',icon:'var(--text3)'}
  };
  return map[t];
}

function visualClassColor(cls){
  if(cls === 'hit')return 'var(--teal-icon)';
  if(cls === 'warn')return 'var(--amber-icon)';
  if(cls === 'miss')return 'var(--red-icon)';
  if(cls === 'plan')return 'var(--purple-icon)';
  return 'var(--text3)';
}

function scoreTone(score){
  if(score === null || score === undefined)return 'empty';
  if(score >= 75)return 'hit';
  if(score >= 45)return 'warn';
  return 'miss';
}

function intervalTone(h,days){
  if(days === null || days === undefined)return '';
  const target = effectiveTarget(h);
  if(h.type === 'keepup'){
    if(days <= target)return 'hit';
    if(days <= target * 1.35)return 'warn';
    return 'miss';
  }
  if(h.type === 'reduce'){
    if(days >= target)return 'hit';
    if(days >= target * 0.65)return 'warn';
    return 'miss';
  }
  if(days >= 14)return 'hit';
  if(days >= 4)return 'warn';
  return 'miss';
}

function logToneMap(h){
  const actual = actualLogs(h.logs);
  const map = new Map();
  actual.forEach((ts,i)=>{
    const days = i === 0 ? Math.max(1,daysSince(ts) || 1) : Math.max(1,Math.round((ts - actual[i - 1]) / 86400000));
    map.set(dateKey(ts),intervalTone(h,days));
  });
  plannedLogs(h.logs).forEach(ts=>{
    const key = dateKey(ts);
    if(!map.has(key))map.set(key,'plan');
  });
  return map;
}

function metaLine(h){
  const days = daysSince(h.lastLog);
  const parts = [];
  if(hasPlannedToday(h))parts.push('planned today');
  if(h.snoozedUntil && Date.now() < h.snoozedUntil){
    parts.push(`hidden ${Math.ceil((h.snoozedUntil - Date.now()) / 86400000)}d`);
  }else{
    parts.push(entryWhen(h.lastLog));
    if(h.type !== 'zero' && h.target)parts.push(`every ${h.target}d`);
  }
  if(h.durationMinutes)parts.push(`${h.durationMinutes}m`);
  if(hasDaySchedule(h)){
    const distance = nextEligibleDistance(h);
    if(distance === 0)parts.push('available today');
    else if(distance === 1)parts.push('available tomorrow');
    else if(distance !== null)parts.push(`available in ${distance}d`);
  }
  return parts;
}

// ─── Numeric primitives ───

function settingScale(value){
  return Math.max(0,Math.min(2,(parseInt(value,10) || 0) / 100));
}

function clampNumber(value,min,max,fallback){
  const num = parseInt(value,10);
  if(Number.isNaN(num))return fallback;
  return Math.max(min,Math.min(max,num));
}

// ─── Effective target & urgency curves ───
// effectiveTarget applies flexibility; buildUrgency maps a days/target ratio
// into 0..1+ according to dueMode. buildDueScore turns that into a 0..110
// attention score using a piecewise curve tuned by buildRiseAt.

function rhythmBiasScore(target,settings){
  const bias = clampNumber(settings.rhythmBias, -100, 100, 0) / 100;
  if(!bias)return 0;
  const normalized = Math.max(0,Math.min(1,(target || 7) / MAX_RHYTHM_DAYS));
  if(bias > 0)return (1 - normalized) * 34 * bias;
  return normalized * 34 * Math.abs(bias);
}

function buildUrgency(days,target,settings){
  const mode = settings.dueMode || 'relative';
  if(days === null)return null;
  const ratio = days / target;
  if(mode === 'date' || mode === 'short'){
    const remaining = target - days;
    if(remaining <= 0)return 1 + Math.min(0.75,Math.abs(remaining) / Math.max(3,target));
    const lookAhead = clampNumber(settings.buildLookAheadDays,1,14,3);
    const dateUrgency = Math.max(0,1 - remaining / lookAhead);
    if(mode === 'short')return dateUrgency + Math.max(0,(14 - Math.min(target,14)) / 14) * 0.32;
    return dateUrgency;
  }
  return ratio;
}

/**
 * Effective rhythm in days, accounting for flexibility.
 * For build habits flexibility extends the target; for limit habits it shortens it;
 * for stop habits flexibility is ignored.
 * @param {Habit} h
 * @returns {number}
 */
function effectiveTarget(h){
  const target = h.target || 7;
  const flex = clampFlexibility(h.flexibilityDays);
  if(h.type === 'keepup')return target + flex;
  if(h.type === 'reduce')return Math.max(1,target - flex);
  return target;
}

function buildDueScore(urgency,riseAt){
  if(urgency >= 1)return 88 + Math.min(22,(urgency - 1) * 40);
  if(urgency >= riseAt)return 42 + ((urgency - riseAt) / Math.max(0.05,1 - riseAt)) * 46;
  const early = clamp01(urgency / Math.max(0.1,riseAt));
  return Math.pow(early,2.2) * 26;
}

function plannedWithinWindow(h,windowDays){
  const plan = nextPlannedLog(h);
  if(!plan || h.type === 'zero')return false;
  const dist = dayDistance(plan);
  return dist !== null && dist <= 0 && Math.abs(dist) <= windowDays;
}

function clamp01(value){
  return Math.max(0,Math.min(1,value));
}

function calendarDayDiff(ts){
  return Math.round((dayStart(ts) - dayStart(Date.now())) / 86400000);
}

// ─── Location signal — the one geography-aware score component ───
// Modest, capped, opt-in via settings.locationWeight (0..200 → 0..2 scale).
// Three effects, all small so this nudges rather than dominates the home order:
//   • cluster bonus  — other due/active habits share this location → +per peer
//   • open bonus     — at least one allowed location is open right now → +
//   • closed penalty — every allowed location is closed today → −
// "anywhere" habits (no locationIds) score 0: locations stay invisible for
// users who never set them up, matching the LOCATIONS.md design principle that
// home scoring changes should be a tiebreaker near the agenda, not a rewrite.
//
// IMPURE: reads `load()` for the cluster map (same posture as the sortSettings
// global read). Memoised by a cheap data+settings fingerprint so a single
// visibleIndices() pass pays the cluster computation once.

let _locationAffinityCache = { key:null, byId:null };

function locationAffinityFingerprint(data,settings){
  let h = (data?.length || 0) * 1000003;
  // Last 64 entries are enough to detect a re-sort after a log/plan/snooze.
  for(let i = Math.max(0,(data?.length || 0) - 64);i < (data?.length || 0);i += 1){
    h = (h * 31 + (data[i].lastLog || 0)) | 0;
    h = (h * 31 + (data[i].preferredLocationId ? 1 : 0)) | 0;
  }
  h = (h * 31 + ((settings.locations || []).length)) | 0;
  return h;
}

// Returns Map<locationId, number> — the sum of each peer habit's dueSignal/100,
// so a location shared by two overdue habits carries roughly 2× the weight of
// one with a single mid-cycle habit. Tasks count via their urgency; someday
// tasks (null urgency) contribute nothing.
function locationAffinityMap(data,settings){
  const key = locationAffinityFingerprint(data,settings);
  if(_locationAffinityCache.key === key && _locationAffinityCache.byId)return _locationAffinityCache.byId;
  const registry = normalizeLocationRegistry(settings.locations);
  const byId = new Map();
  if(!registry.length){ _locationAffinityCache = { key, byId }; return byId; }
  for(const h of (Array.isArray(data) ? data : [])){
    if(h.type === 'zero')continue;
    const ids = normalizeLocationIds(h.locationIds,registry);
    if(!ids.length)continue;
    let weight = 0;
    if(h.type === 'task'){
      const u = taskUrgency(h);
      weight = u === null ? 0 : Math.max(0,u);
    }else{
      weight = Math.max(0,dueSignal(h,settings)) / 100;
    }
    if(weight <= 0)continue;
    for(const id of ids)byId.set(id,(byId.get(id) || 0) + weight);
  }
  _locationAffinityCache = { key, byId };
  return byId;
}

// Reset the affinity cache (used by tests + after a save() that changes data).
function invalidateLocationAffinity(){ _locationAffinityCache = { key:null, byId:null }; }

// PURE-ish: the per-habit location score, in the same 0..~110 range as the
// other components. Capped to [-12, +14] so it can only break ties / nudge.
function locationSignal(h,settings){
  if(h.type === 'zero')return 0;
  const registry = normalizeLocationRegistry(settings.locations);
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return 0;                                // anywhere → neutral
  const weekday = new Date().getDay();
  const aff = locationAffinityMap(typeof load === 'function' ? load() : [],settings);
  let signal = 0;
  let anyOpen = false, allClosed = true;
  for(const id of ids){
    const loc = registry.find(l=>l.id === id);
    const win = loc ? resolveLocationWindow(loc,weekday) : {start:0,end:1440};
    if(win){ anyOpen = true; allClosed = false; }
    const peers = aff.get(id) || 0;
    signal += Math.min(12,peers * 3);                      // cluster bonus (gradual, cap 12)
  }
  if(anyOpen)signal += 2;                                  // reachable bonus
  if(allClosed)signal -= 8;                                // unreachable penalty
  // Average over allowed locations so multi-location habits don't double-count.
  signal = signal / ids.length;
  return Math.max(-12,Math.min(16,signal));
}

// ─── Score components: plan / new / due / progress / trend / rhythm / location ───
// Each returns a 0..~110 contribution for one habit. Mixed together by
// priorityComponents() and weighted by the user's setting scales.

function planSignal(h,settings){
  const plan = nextPlannedLog(h);
  if(!settings.plansFirst || !plan || h.type === 'zero')return 0;
  const daysUntil = calendarDayDiff(plan);
  const windowDays = clampNumber(settings.planWindowDays,1,14,1);
  if(daysUntil <= 0)return 120;
  if(daysUntil > windowDays)return 0;
  return 100 - (daysUntil / Math.max(1,windowDays)) * 45;
}

function newHabitSignal(h,settings){
  if(h.lastLog !== null)return 0;
  if(h.type === 'task')return 0;
  if(h.type === 'zero')return 8;
  if(h.type === 'reduce')return 16;
  const mode = settings.newBuildMode || 'gentle';
  if(mode === 'quiet')return 18;
  if(mode === 'rise')return 82;
  return 48;
}

function stopPolicy(settings){
  return STOP_MODE_POLICY[settings.stopMode || 'watch'] || STOP_MODE_POLICY.watch;
}

function stopDueScore(days,settings){
  const policy = stopPolicy(settings);
  const step = policy.steps.find(([limit])=>days < limit);
  return step ? step[1] : policy.fallback;
}

function limitPolicy(settings){
  return LIMIT_MODE_POLICY[settings.limitMode || 'overdue'] || LIMIT_MODE_POLICY.overdue;
}

function limitDueScore(ratio,policy){
  if(ratio < policy.readyAt){
    return policy.earlyBase + clamp01(ratio / Math.max(0.1,policy.readyAt)) * policy.earlyRise;
  }
  if(ratio < policy.threshold){
    const readySpan = Math.max(0.05,policy.threshold - policy.readyAt);
    return policy.base + ((ratio - policy.readyAt) / readySpan) * (38 - policy.base);
  }
  return 38 + clamp01((ratio - policy.threshold) / Math.max(0.45,policy.threshold)) * (policy.ceiling - 38);
}

function dueSignal(h,settings){
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  if(days === null)return 0;
  if(days < 0)return 8;

  if(h.type === 'keepup'){
    const urgency = buildUrgency(days,target,settings);
    const riseAt = clampNumber(settings.buildRiseAt,40,110,75) / 100;
    return buildDueScore(urgency,riseAt);
  }

  if(h.type === 'reduce'){
    const ratio = days / target;
    return limitDueScore(ratio,limitPolicy(settings));
  }

  if(h.type === 'zero'){
    return stopDueScore(days,settings);
  }

  return 0;
}

function progressConcern(h,settings){
  const score = progressScore(h);
  if(score === null)return 0;
  const raw = 100 - score;
  if(h.type === 'keepup')return raw;
  if(h.type === 'reduce'){
    const days = daysSince(h.lastLog);
    const target = effectiveTarget(h);
    const ratio = days === null ? 0 : days / target;
    const policy = limitPolicy(settings);
    return raw * (ratio < policy.readyAt ? policy.progressEarly : policy.progress);
  }
  return raw * stopPolicy(settings).progress;
}

function trendConcern(h,settings){
  const summary = intervalToneSummary(h);
  const hasHistory = intervalValues(h,6).length >= 2;
  if(!hasHistory)return 0;
  if(h.type === 'keepup')return summary.miss + summary.warn * 0.45 - summary.hit * 0.12;
  if(h.type === 'reduce'){
    const days = daysSince(h.lastLog);
    const ratio = days === null ? 0 : days / effectiveTarget(h);
    const policy = limitPolicy(settings);
    const multiplier = ratio < policy.readyAt ? policy.trendEarly : policy.trend;
    return Math.max(0,summary.miss * 0.42 + summary.warn * 0.16 - summary.hit * 0.18) * multiplier;
  }
  return Math.max(0,summary.miss * 0.22 + summary.warn * 0.1 - summary.hit * 0.16);
}

function rhythmSignal(h,settings){
  if(h.type === 'zero')return 0;
  const target = effectiveTarget(h);
  const days = daysSince(h.lastLog);
  const tieBias = rhythmBiasScore(target,settings);
  if(days === null)return tieBias * 0.5;
  if((settings.dueMode || 'relative') === 'short'){
    return tieBias + Math.max(0,(21 - Math.min(target,21)) / 21) * 18;
  }
  if((settings.dueMode || 'relative') === 'date'){
    const daysLeft = Math.max(0,target - days);
    return tieBias + Math.max(0,(7 - Math.min(daysLeft,7)) / 7) * 10;
  }
  return tieBias;
}

// ─── Task urgency (one-off countdown, not a recurring ratio) ───
// taskUrgency mirrors buildUrgency's shape (0..1+ ramp, escalating past the
// threshold) so it can reuse buildDueScore directly. null = someday task.
function taskUrgency(h){
  if(h.type !== 'task')return null;
  const when = taskWhen(h);
  if(when === null)return null;
  const daysLeft = daysUntil(when);
  if(daysLeft === null)return null;
  const window = Math.max(1,h.flexibilityDays || 3);
  if(daysLeft <= 0){
    const overdueBoost = h.hardDue ? 1.4 : 1;
    return (1 + Math.min(0.75,Math.abs(daysLeft) / window)) * overdueBoost;
  }
  return Math.max(0,1 - daysLeft / window);
}

// Someday tasks (no dueDate) get a quiet baseline with a short "just added"
// nudge, mirroring the gentle new-build handling. Unscaled by dueWeight so a
// zero dueWeight setting doesn't erase them entirely.
function taskSomedayScore(h){
  const base = 22;
  if(h.createdAt){
    const ageDays = (Date.now() - h.createdAt) / 86400000;
    if(ageDays < 7)return base + (1 - ageDays / 7) * 30;
  }
  return base;
}

function taskDueSignal(h,settings){
  const urgency = taskUrgency(h);
  if(urgency === null)return 0;
  const riseAt = clampNumber(settings.buildRiseAt,40,110,75) / 100;
  return buildDueScore(urgency,riseAt);
}

// ─── Priority composition ───
// priorityComponents gathers every signal for a habit; attentionScore merges
// them with BASE_SORT_MIX (or stop-mode mix), applies focus/type scaling,
// damping for early build/limit habits, and returns the final sort key.

function typeSettingScale(h,settings){
  if(h.type === 'keepup')return settingScale(settings.buildWeight);
  if(h.type === 'reduce')return settingScale(settings.limitWeight);
  if(h.type === 'zero')return settingScale(settings.stopWeight);
  return 1; // task — not gated by a per-type weight in v1
}

/**
 * Per-component priority breakdown for a habit. Each key is a 0..~110 score
 * that attentionScore merges with BASE_SORT_MIX. Used by the sort lab preview
 * and by debug tooling.
 * @param {Habit} h
 * @param {Settings} settings
 * @returns {Object} {now,plan,due,progress,trend,rhythm,newness,duration,availability,flexibility,schedule,preferred,location}
 */
function priorityComponents(h,settings){
  if(h.type === 'task')return taskPriorityComponents(h,settings);
  const plannerFit = plannerFitSignal(h,settings);
  return {
    now:todayActionSignal(h,settings),
    plan:planSignal(h,settings) * settingScale(settings.planWeight),
    due:dueSignal(h,settings) * settingScale(settings.dueWeight),
    progress:progressConcern(h,settings) * settingScale(settings.progressWeight),
    trend:Math.max(0,trendConcern(h,settings)) * settingScale(settings.trendWeight),
    rhythm:rhythmSignal(h,settings) * settingScale(settings.rhythmWeight),
    newness:newHabitSignal(h,settings) * settingScale(settings.newWeight) * (h.lastLog === null ? 0.75 : 0),
    duration:plannerFit.duration,
    availability:plannerFit.availability,
    flexibility:plannerFit.flexibility,
    schedule:scheduleSignal(h),
    preferred:preferredSignal(h),
    location:locationSignal(h,settings) * settingScale(settings.locationWeight)
  };
}

// Tasks have no rhythm/history, so only the due signal (or a someday baseline)
// plus the planner-fit/schedule adjustments contribute. Same shape as the
// habit components so attentionScore's mix + scaling paths are reused verbatim.
// Completed tasks (lastLog !== null) sink to the bottom but stay findable.
function taskPriorityComponents(h,settings){
  const plannerFit = plannerFitSignal(h,settings);
  const location = locationSignal(h,settings) * settingScale(settings.locationWeight);
  if(h.lastLog !== null){
    return {
      now:0,plan:0,due:0,progress:0,trend:0,rhythm:0,newness:0,
      duration:plannerFit.duration,
      availability:plannerFit.availability,
      flexibility:plannerFit.flexibility,
      schedule:scheduleSignal(h),
      preferred:preferredSignal(h),
      location
    };
  }
  const due = h.dueDate === null
    ? taskSomedayScore(h)
    : taskDueSignal(h,settings) * settingScale(settings.dueWeight);
  return {
    now:0,
    plan:0,
    due,
    progress:0,
    trend:0,
    rhythm:0,
    newness:0,
    duration:plannerFit.duration,
    availability:plannerFit.availability,
    flexibility:plannerFit.flexibility,
    schedule:scheduleSignal(h),
    preferred:preferredSignal(h),
    location
  };
}

function plannerFitSignal(h,settings){
  const duration = clampDuration(h.durationMinutes);
  const todayMinutes = effectiveAvailabilityMinutes(todayIso(),settings);
  const availability = todayMinutes <= 0
    ? -18
    : duration > todayMinutes
      ? -32
      : duration > todayMinutes * 0.75
        ? -12
        : 0;
  const flex = clampFlexibility(h.flexibilityDays);
  const flexibility = flex ? -Math.min(18,flex * 1.4) : 0;
  const durationSignal = duration >= 120 ? -6 : duration >= 60 ? -2 : 0;
  return {duration:durationSignal,availability,flexibility};
}

function scheduleSignal(h){
  if(!hasDaySchedule(h))return 0;
  const distance = nextEligibleDistance(h);
  if(distance === null)return -90;
  if(distance === 0)return 18;
  if(distance === 1)return -8;
  if(distance <= 3)return -24;
  if(distance <= 7)return -42;
  return -68;
}
function preferredSignal(h){
  if(!hasPreferredDays(h))return 0;
  return isPreferredDay(h) ? 8 : -4;
}

function todayActionSignal(h,settings){
  if(h.type === 'zero')return 0;
  const plan = nextPlannedLog(h);
  const planDist = plan ? calendarDayDiff(plan) : null;
  const scheduleDistance = hasDaySchedule(h) ? nextEligibleDistance(h) : 0;
  let signal = 0;

  if(planDist === 0)signal += 80;
  else if(planDist > 0)signal += Math.max(0,18 - planDist * 3);

  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  if(h.type === 'keepup'){
    if(days === null){
      signal += scheduleDistance === 0 ? 10 : 0;
    }else{
      const urgency = buildUrgency(days,target,settings);
      const riseAt = clampNumber(settings.buildRiseAt,40,110,75) / 100;
      if(urgency >= 1)signal += 54 + Math.min(28,(urgency - 1) * 28);
      else if(urgency >= riseAt)signal += 22 + ((urgency - riseAt) / Math.max(0.05,1 - riseAt)) * 32;
      else if(scheduleDistance === 0)signal += Math.pow(clamp01(urgency / Math.max(0.1,riseAt)),2.4) * 12;
    }
  }else if(h.type === 'reduce' && days !== null){
    const ratio = days / target;
    const policy = limitPolicy(settings);
    if(ratio >= policy.readyAt)signal += 22 + clamp01((ratio - policy.readyAt) / Math.max(0.4,policy.threshold - policy.readyAt)) * 30;
    else signal -= (1 - clamp01(ratio / Math.max(0.1,policy.readyAt))) * 14;
  }

  if(scheduleDistance === null)signal -= 60;
  else if(scheduleDistance > 0)signal -= scheduleDistance === 1 ? 14 : scheduleDistance <= 3 ? 22 : scheduleDistance <= 7 ? 32 : 46;

  const todayMinutes = effectiveAvailabilityMinutes(todayIso(),settings);
  const duration = clampDuration(h.durationMinutes);
  if(todayMinutes <= 0)signal -= 18;
  else if(duration > todayMinutes)signal -= 20;
  return signal;
}

function todayReadinessScale(h){
  if(h.type === 'zero')return 1;
  const distance = hasDaySchedule(h) ? nextEligibleDistance(h) : 0;
  if(distance === null)return 0.22;
  if(distance === 0)return 1.06;
  const plan = nextPlannedLog(h);
  const planDist = plan ? calendarDayDiff(plan) : null;
  const base = distance === 1 ? 0.78 : distance <= 3 ? 0.58 : distance <= 7 ? 0.42 : 0.28;
  if(planDist !== null && planDist >= 0 && planDist <= distance){
    return Math.max(base,0.66 - Math.min(planDist,7) * 0.035);
  }
  return base;
}

function earlyBuildDamping(h,settings){
  if(h.type !== 'keepup' || hasPlannedToday(h))return 1;
  const days = daysSince(h.lastLog);
  if(days === null || days < 0)return 1;
  const urgency = buildUrgency(days,effectiveTarget(h),settings);
  const riseAt = clampNumber(settings.buildRiseAt,40,110,75) / 100;
  if(urgency >= riseAt)return 1;
  const progress = clamp01(urgency / Math.max(0.1,riseAt));
  return 0.28 + Math.pow(progress,1.7) * 0.54;
}

function earlyLimitDamping(h,settings){
  if(h.type !== 'reduce' || hasPlannedToday(h))return 1;
  const days = daysSince(h.lastLog);
  if(days === null || days < 0)return 1;
  const ratio = days / effectiveTarget(h);
  const policy = limitPolicy(settings);
  if(ratio >= policy.readyAt)return 1;
  return 0.22 + clamp01(ratio / Math.max(0.1,policy.readyAt)) * 0.35;
}

function recentLimitPenalty(h,settings){
  if(h.type !== 'reduce')return 0;
  const days = daysSince(h.lastLog);
  if(days === null || days < 0)return 0;
  const target = effectiveTarget(h);
  const ratio = days / target;
  const policy = limitPolicy(settings);
  if(ratio >= policy.readyAt)return 0;
  const logs = actualLogs(h.logs);
  if(logs.length < 2)return 0;
  const recentWindow = Math.max(3,Math.min(14,target));
  const recentCount = logs.filter(ts=>Date.now() - ts <= recentWindow * 86400000).length;
  const extra = Math.max(0,recentCount - 1);
  const modeFactor = (settings.limitMode || 'overdue') === 'quiet' ? 1.3 : (settings.limitMode || 'overdue') === 'overdue' ? 1 : 0.45;
  return extra * modeFactor * settingScale(settings.limitWeight) * 1.8;
}

function mixedPriorityScore(parts,mix){
  return Object.entries(mix).reduce((sum,[key,weight])=>sum + (parts[key] || 0) * weight,0);
}

/**
 * Final attention score used for home ordering. Higher = earlier on the list.
 * Snoozed habits return a large negative so they sort last. The score
 * combines every signal in priorityComponents(), applies focus/type scaling,
 * early-cycle damping, today readiness, and a tiny index tiebreak.
 *
 * IMPURE: reads the `sortSettings` global if settingsOverride is null. In the
 * RN port, callers always pass settings explicitly.
 *
 * @param {Habit} h
 * @param {number} index    — original array index, used as a tiebreak (-index/100)
 * @param {Settings|null} [settingsOverride]
 * @returns {number}
 */
function attentionScore(h,index,settingsOverride = null){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return -1000 - index;
  const settings = settingsOverride || sortSettings || DEFAULT_SORT_SETTINGS;
  const focus = settings.focus || 'balanced';
  const parts = priorityComponents(h,settings);
  let score = mixedPriorityScore(parts,BASE_SORT_MIX);
  if(h.type === 'zero'){
    const policy = stopPolicy(settings);
    score = mixedPriorityScore(parts,policy.mix);
    if(Number.isFinite(policy.cap))score = Math.min(score,policy.cap);
    score += policy.offset || 0;
  }
  score += parts.duration + parts.availability + parts.flexibility + parts.schedule + parts.preferred + parts.location;

  const focusScale = FOCUS_TYPE_SCALE[focus] || FOCUS_TYPE_SCALE.balanced;
  score *= focusScale[h.type] || 1;
  if(h.type === 'zero')score *= stopPolicy(settings).focus;
  score *= earlyBuildDamping(h,settings);
  score *= earlyLimitDamping(h,settings);
  score *= todayReadinessScale(h);
  score -= recentLimitPenalty(h,settings);

  score *= typeSettingScale(h,settings);
  return score - index / 100;
}

// ─── Categorization & visible-sort ───
// todayCategory buckets habits into today/overdue/upcoming/other.
// visibleIndices returns the full ordering, accounting for pins, snooze,
// todayFirst preset, and the attentionScore tiebreak.

/**
 * Bucket a habit into a today-first category. Lower = more urgent.
 *   0 = today (planned, or due and eligible today)
 *   1 = overdue but not eligible today
 *   2 = upcoming
 *   3 = snoozed or stop-type (always deprioritized in todayFirst)
 * @param {Habit} h
 * @param {Settings} settings
 * @returns {0|1|2|3}
 */
function todayCategory(h,settings){
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  const scheduleDistance = hasDaySchedule(h) ? nextEligibleDistance(h) : 0;
  // isAvailableToday folds in the strict allowedTimeStart/End window so the
  // home list agrees with the Today agenda: a habit whose window has already
  // closed for today (e.g. a morning-only walk at 3pm) is not "today", it is
  // overdue. preferredTimeStart/End is soft and does not affect this.
  const isAvailableToday = scheduleDistance === 0 && windowStillDoableToday(h);

  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 3;
  if(h.type === 'zero')return 3;

  if(hasPlannedToday(h) && h.type !== 'zero')return 0;

  if(h.type === 'task'){
    const when = taskWhen(h);
    if(when !== null){
      const daysLeft = daysUntil(when);
      if(daysLeft !== null && daysLeft <= 0)return isAvailableToday ? 0 : 1;
    }
  }

  if(h.type === 'keepup' && days !== null && days >= target){
    return isAvailableToday ? 0 : 1;
  }
  if(h.type === 'reduce' && days !== null && days >= target){
    return isAvailableToday ? 0 : 1;
  }

  return 2;
}

/**
 * Sorted indices into the habits array, respecting pins, snooze visibility,
 * the todayFirst preset (if active), and attentionScore for the final order.
 *
 * IMPURE: reads `sortSettings` if settingsOverride is null.
 *
 * @param {Habit[]} data
 * @param {Settings|null} [settingsOverride]
 * @returns {number[]} indices into `data`, best-first
 */
function visibleIndices(data,settingsOverride = null){
  const settings = settingsOverride || sortSettings || DEFAULT_SORT_SETTINGS;
  const todayFirst = settings.preset === 'todayFirst';
  const indices = data.map((_,i)=>i).filter(i=>{
    const h = data[i];
    if(h.type === 'task' && h.lastLog !== null)return false;
    return !(h.snoozedUntil && Date.now() < h.snoozedUntil && !settings.showSnoozed);
  });
  indices.sort((a,b)=>{
    if(data[a].pinned && data[b].pinned)return a - b;
    const pin = Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned));
    if(pin)return pin;
    if(todayFirst){
      const catA = todayCategory(data[a],settings);
      const catB = todayCategory(data[b],settings);
      if(catA !== catB)return catA - catB;
    }
    return attentionScore(data[b],b,settings) - attentionScore(data[a],a,settings);
  });
  return indices;
}

// ─── Search filtering ─── IMPURE: reads `searchQuery` and `homeTopicFilter`
// globals from config.js. searchText() itself is pure and produces the
// haystack; filtering happens here. In the RN port, pass these as args.

function searchText(h){
  const typeLabel = h.type === 'keepup' ? 'build routine keepup'
    : h.type === 'reduce' ? 'limit reduce less'
    : h.type === 'task' ? (isTimedTask(h) ? 'task appointment scheduled fixed time' : 'task todo one-off due someday')
    : 'stop quit zero';
  const schedule = scheduledDays(h);
  const pref = preferredDays(h);
  const when = taskWhen(h);
  const dueText = h.type === 'task' && when
    ? (isTimedTask(h)
        ? `when ${dateKey(when)} ${new Date(when).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`
        : `due ${dateKey(when)}`)
    : '';
  const scheduleText = [
    ...schedule.weekdays.flatMap(day=>[weekdayShort(day),new Date(2024,0,7 + day).toLocaleDateString(undefined,{weekday:'long'})]),
    ...schedule.monthDays.flatMap(day=>[String(day),monthOrdinal(day)]),
    ...pref.weekdays.flatMap(day=>[weekdayShort(day),'preferred']),
    ...pref.monthDays.flatMap(day=>[String(day),'preferred'])
  ].join(' ');
  return `${h.name || ''} ${h.emoji || ''} ${typeLabel} ${(h.topics || []).join(' ')} ${locationSearchNames(h)} ${scheduleText} ${dueText}`.toLowerCase();
}

function locationSearchNames(h){
  const registry = typeof locationOptions === 'function' ? locationOptions() : normalizeLocationRegistry((sortSettings || {}).locations);
  return normalizeLocationIds(h.locationIds,registry)
    .map(id=>{
      const loc = registry.find(l=>l.id === id);
      return loc ? `${loc.name} ${loc.address || ''}` : '';
    })
    .join(' ');
}

// PURE: lower is better — exact/prefix name hits before fuzzy field matches.
function searchRank(h,query){
  const name = (h.name || '').toLowerCase();
  if(name === query)return 0;
  if(name.startsWith(query))return 1;
  if(name.includes(query))return 2;
  const emoji = (h.emoji || '').toLowerCase();
  if(emoji && emoji.includes(query))return 3;
  const topics = (h.topics || []).join(' ').toLowerCase();
  if(topics.includes(query))return 4;
  return 5;
}

function filteredVisibleIndices(data){
  const indices = visibleIndices(data);
  const query = searchQuery.trim().toLowerCase();
  const topic = typeof homeTopicFilter !== 'undefined' ? homeTopicFilter : 'all';
  const location = typeof homeLocationFilter !== 'undefined' ? homeLocationFilter : 'all';
  let base = indices;
  if(topic && topic !== 'all' && typeof matchesHomeTopic === 'function'){
    base = base.filter(i=>matchesHomeTopic(data[i],topic));
  }
  if(location && location !== 'all' && typeof matchesHomeLocation === 'function'){
    base = base.filter(i=>matchesHomeLocation(data[i],location));
  }
  if(!query)return base;
  const matches = base
    .filter(i=>searchText(data[i]).includes(query))
    .sort((a,b)=>{
      const ra = searchRank(data[a],query);
      const rb = searchRank(data[b],query);
      if(ra !== rb)return ra - rb;
      return indices.indexOf(a) - indices.indexOf(b);
    });
  const completedTasks = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>h.type === 'task' && h.lastLog !== null)
    .filter(({h})=>!topic || topic === 'all' || typeof matchesHomeTopic !== 'function' || matchesHomeTopic(h,topic))
    .filter(({h})=>!location || location === 'all' || typeof matchesHomeLocation !== 'function' || matchesHomeLocation(h,location))
    .filter(({h})=>searchText(h).includes(query))
    .sort(({h:a},{h:b})=>{
      const ra = searchRank(a,query);
      const rb = searchRank(b,query);
      if(ra !== rb)return ra - rb;
      return (b.lastLog || 0) - (a.lastLog || 0);
    })
    .map(({i})=>i);
  const seen = new Set(matches);
  completedTasks.forEach(i=>{if(!seen.has(i)){seen.add(i);matches.push(i);}});
  return matches;
}
