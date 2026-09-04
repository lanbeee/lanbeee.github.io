// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION PRIMITIVES — PURE. Coercion helpers used by normalize() and
// also called directly from view/settings code. Each is self-contained.
// ─────────────────────────────────────────────────────────────────────────

function sizeKb(data){return Math.round((JSON.stringify(data).length * 2) / 1024);}
function clampRhythmValue(value){
  const n = Number(value);
  if(!Number.isFinite(n))return 7;
  return Math.max(MIN_RHYTHM_DAYS,Math.min(MAX_RHYTHM_DAYS,n));
}
/** PURE: split a (possibly fractional) target into {times, days} for UI. */
function rhythmParts(target){
  const t = clampRhythmValue(target);
  if(Math.abs(t - Math.round(t)) < 0.01)return {times:1,days:Math.max(1,Math.round(t))};
  // Exact rational first: a target like 7/3 must round-trip back to 3×/7d
  // instead of being approximated as 2×/5d by the tolerance pass below.
  for(let times = 2; times <= 30; times += 1){
    const days = Math.round(t * times);
    if(days >= 1 && days <= MAX_RHYTHM_DAYS && Math.abs(days / times - t) < 1e-9){
      return {times,days};
    }
  }
  // Approximate fit for legacy/non-rational targets (smallest times first).
  for(let times = 2; times <= 14; times += 1){
    const days = Math.round(t * times);
    if(days >= 1 && days <= MAX_RHYTHM_DAYS && Math.abs(days / times - t) < 0.051){
      return {times,days};
    }
  }
  const days = Math.max(1,Math.min(MAX_RHYTHM_DAYS,Math.round(t * 2)));
  return {times:2,days};
}
/** PURE: build target days from "times in N days". */
function targetFromRhythmParts(times,days){
  const t = Math.max(1,Math.min(30,parseInt(times,10) || 1));
  const d = Math.max(1,Math.min(MAX_RHYTHM_DAYS,parseInt(days,10) || 7));
  return clampRhythmValue(d / t);
}
/**
 * PURE: integer calendar gap for the next completion in a fractional rhythm.
 * Alternating rounded cumulative boundaries preserves the requested average:
 * 5x/8d becomes 2,1,2,1,2 days instead of rounding 1.6 up to 2 every time.
 * `completionOffset` advances the phase for virtual week-plan placements.
 */
function rhythmCadenceGapDays(h,completionOffset = 0){
  const target = clampRhythmValue(h && h.target);
  const {times,days} = rhythmParts(target);
  if(times <= 1)return Math.max(1,days);
  const storedCount = h && Array.isArray(h.logs)
    ? actualLogs(h.logs).length
    : 0;
  const knownCount = Math.max(storedCount,h && h.lastLog != null ? 1 : 0);
  const offset = Math.max(0,Math.round(Number(completionOffset) || 0));
  const phase = Math.max(0,knownCount - 1 + offset) % times;
  const start = Math.round((phase * days) / times);
  const end = Math.round(((phase + 1) * days) / times);
  return Math.max(1,end - start);
}
/** PURE: cadence gap for the current completion. Flexibility does not move the
 * boundary — this returns the raw rhythmCadenceGapDays. Pull-earlier via flex
 * is handled only by interaction-aware paths (schedule links / optimizer). */
function effectiveRhythmCadenceGapDays(h){
  return rhythmCadenceGapDays(h,0);
}
/** PURE: card/meta label for a rhythm target. */
function formatRhythmLabel(target){
  if(target == null)return '';
  const {times,days} = rhythmParts(target);
  return times === 1 ? `${days}d` : `${times}×/${days}d`;
}
function clampFlexibility(value){
  const n = parseInt(value,10);
  return Math.max(0,Math.min(60,Number.isNaN(n) ? DEFAULT_FLEXIBILITY_DAYS : n));
}
function clampDuration(value){
  return Math.max(1,Math.min(720,parseInt(value,10) || DEFAULT_DURATION_MINUTES));
}
function clampTimes(value){
  return Math.max(1,Math.min(30,parseInt(value,10) || 1));
}
function clampMinChunk(value){
  return Math.max(TIME_PICKER_STEP_MINUTES,Math.min(720,parseInt(value,10) || DEFAULT_MIN_CHUNK_MINUTES));
}
function normalizeTimerAutoStop(value){
  if(value === null || value === undefined || value === '')return null;
  const n = parseInt(value,10);
  if(!Number.isFinite(n) || n <= 0)return null;
  return Math.max(1,Math.min(720,n));
}
// PURE: coercion for the auto-mark-minutes field. Empty/invalid → null (manual).
function normalizeAutoMark(value){
  if(value === null || value === undefined || value === '')return null;
  const n = parseInt(value,10);
  if(!Number.isFinite(n) || n < 0)return null;
  return Math.min(10080,n); // up to a week, in minutes
}
/**
 * PURE: ideal continuous session plan for remaining work (no calendar).
 * Splitting is a placement concern — this returns a single chunk of `total`
 * (or [] when empty). `minChunkMinutes` is unused here but kept for call-site
 * compatibility; the hard floor is enforced by isValidChunkMinutes / placement.
 */
function planChunks(totalMinutes,_minChunkMinutes){
  const total = Math.max(0,Math.round(Number(totalMinutes) || 0));
  if(total <= 0)return [];
  return [clampDuration(total)];
}
/**
 * PURE: whether `piece` is a valid session size for `remaining` given min floor.
 * Finish-up: when remaining < min, only exactly remaining is allowed.
 * Otherwise piece must be in [min, remaining].
 */
function isValidChunkMinutes(piece,remaining,minChunkMinutes){
  const rem = Math.max(0,Math.round(Number(remaining) || 0));
  const min = clampMinChunk(minChunkMinutes);
  const p = Math.round(Number(piece) || 0);
  if(rem <= 0 || p <= 0 || p > rem)return false;
  if(rem < min)return p === rem;
  return p >= min;
}
/** PURE: minutes already logged toward a breakable session (sum of log.minutes). */
function loggedChunkMinutes(h){
  if(!h)return 0;
  return normalizeLogs(h.logs).reduce((sum,log)=>{
    if(isPlanLog(log))return sum;
    const m = Number(log && log.minutes);
    return sum + (Number.isFinite(m) && m > 0 ? m : 0);
  },0);
}
/**
 * PURE: breakable minutes logged on one calendar day (for daily keepup/reduce
 * budgets). Tasks ignore this and use lifetime remaining instead.
 */
function loggedChunkMinutesOnDay(h,dayBase){
  if(!h)return 0;
  const start = dayStart(dayBase != null ? dayBase : Date.now());
  const end = start + 86400000;
  return normalizeLogs(h.logs).reduce((sum,log)=>{
    if(isPlanLog(log))return sum;
    const ts = logTime(log);
    if(!ts || ts < start || ts >= end)return sum;
    const m = Number(log && log.minutes);
    return sum + (Number.isFinite(m) && m > 0 ? m : 0);
  },0);
}
/**
 * PURE: breakable keepup/reduce with a target — place on each rhythm day with
 * a fresh daily duration budget (not a one-shot pool across the week).
 */
function isBreakableRhythmHabit(h){
  return !!(h && h.breakable && h.type !== 'task'
    && Number.isFinite(Number(h && h.target)));
}
/**
 * PURE: minutes of breakable work still needed.
 * - Tasks: lifetime remaining (duration − all logged minutes).
 * - Keepup/reduce: today's budget (duration − minutes logged today).
 */
function breakableBudgetMinutes(h,dayBase){
  const total = clampDuration(h && h.durationMinutes);
  if(!h || !h.breakable)return total;
  if(h.type === 'task')return Math.max(0,total - loggedChunkMinutes(h));
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  return Math.max(0,total - loggedChunkMinutesOnDay(h,base));
}
/** PURE: remaining minutes for a breakable item (full duration when nothing logged). */
function remainingDurationMinutes(h,dayBase){
  if(!h || !h.breakable)return clampDuration(h && h.durationMinutes);
  if(h.type === 'task')return breakableBudgetMinutes(h);
  return breakableBudgetMinutes(h,dayBase != null ? dayBase : dayStart(Date.now()));
}
/**
 * PURE: smallest session that still makes progress on a breakable item.
 * Finish-up when remaining < min; otherwise the min-chunk floor.
 */
function minViableSessionMinutes(h,dayBase){
  const left = remainingDurationMinutes(h,dayBase);
  if(left <= 0)return 0;
  if(!h || !h.breakable)return left;
  const min = clampMinChunk(h.minChunkMinutes);
  return left < min ? left : min;
}
/** PURE: ideal next chunk sizes (continuous: one block of remaining). */
function remainingChunks(h,dayBase){
  const left = remainingDurationMinutes(h,dayBase);
  if(left <= 0)return [];
  if(!h || !h.breakable)return [left];
  return planChunks(left,h.minChunkMinutes);
}
/** PURE: minutes already completed toward the breakable budget. */
function breakableProgressMinutes(h,dayBase){
  if(!h || !h.breakable)return 0;
  if(h.type === 'task')return loggedChunkMinutes(h);
  return loggedChunkMinutesOnDay(h,dayBase != null ? dayBase : dayStart(Date.now()));
}
/** PURE: total breakable budget (duration). */
function breakableTotalMinutes(h){
  return clampDuration(h && h.durationMinutes);
}
/**
 * PURE: instant-tap amount for a breakable log. A placed agenda piece is
 * meaningful, so use it when present — even when it equals the whole remaining
 * budget: the card advertises that piece, so the tap claims it. Only a bare
 * tap (no placed piece) falls back to the minimum as a quick-log step.
 */
function suggestedBreakableLogMinutes(h,chunkMinutes,dayBase){
  if(!h || !h.breakable)return 0;
  const rem = breakableBudgetMinutes(h,dayBase);
  if(rem <= 0)return 0;
  const min = clampMinChunk(h.minChunkMinutes);
  if(rem < min)return rem;
  let suggested = Math.round(Number(chunkMinutes));
  if(!Number.isFinite(suggested) || suggested <= 0){
    suggested = min;
  }
  return Math.max(1,Math.min(suggested,rem));
}
/**
 * PURE: minutes to log when the user dragged the progress slider to a target.
 * Returns delta above committed progress, or 0 when target is not ahead.
 */
function breakableSliderDeltaMinutes(h,targetMinutes,dayBase){
  if(!h || !h.breakable)return 0;
  const total = breakableTotalMinutes(h);
  const done = breakableProgressMinutes(h,dayBase);
  const target = Math.max(0,Math.min(total,Math.round(Number(targetMinutes) || 0)));
  return Math.max(0,target - done);
}
/**
 * PURE: 0–100 progress percent for slider display (committed minutes / total).
 */
function breakableProgressPercent(h,dayBase){
  const total = breakableTotalMinutes(h);
  if(total <= 0)return 0;
  const done = breakableProgressMinutes(h,dayBase);
  return Math.max(0,Math.min(100,Math.round((done / total) * 100)));
}
/**
 * PURE: split committed breakable progress into manual vs calendar-sourced
 * minutes. Used by the 3-color status bar on breakable cards.
 */
function breakableProgressBreakdown(h,dayBase){
  const total = breakableTotalMinutes(h);
  if(!h || !h.breakable || total <= 0)return {manual:0,calendar:0,total:0};
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const start = h.type === 'task' ? 0 : dayStart(base);
  const end = h.type === 'task' ? Infinity : start + 86400000;
  let calendar = 0;
  normalizeLogs(h.logs).forEach(log=>{
    if(isPlanLog(log))return;
    const ts = logTime(log);
    if(!ts || ts < start || ts >= end)return;
    const m = Number(log && log.minutes);
    if(!Number.isFinite(m) || m <= 0)return;
    if(isCalendarCreditLog(log))calendar += m;
  });
  const done = breakableProgressMinutes(h,dayBase);
  const manual = Math.max(0,done - calendar);
  return {manual,calendar,total};
}
/** PURE: minutes for a 0–100 slider percent of the breakable budget. */
function breakableMinutesFromPercent(h,percent){
  const total = breakableTotalMinutes(h);
  const p = Math.max(0,Math.min(100,Number(percent) || 0));
  return Math.max(0,Math.min(total,Math.round(total * p / 100)));
}
/**
 * MUTATES habit logs so breakable progress equals targetMinutes (day scope for
 * keepup/reduce, lifetime for tasks). Returns {mode:'add'|'set'|'noop', delta, minutes}.
 * Caller must save. For mode 'add', caller should logTing the delta instead of
 * using this — this function handles 'set' (rewrite) when target < done, and
 * can also set exactly when building a consolidated entry.
 */
function rewriteBreakableProgress(h,targetMinutes,dayBase){
  if(!h || !h.breakable)return { mode:'noop', delta:0, minutes:0 };
  const total = breakableTotalMinutes(h);
  const target = Math.max(0,Math.min(total,Math.round(Number(targetMinutes) || 0)));
  const done = breakableProgressMinutes(h,dayBase);
  const delta = target - done;
  if(delta === 0)return { mode:'noop', delta:0, minutes:target };
  if(delta > 0)return { mode:'add', delta, minutes:target };
  // Reduce: drop minute-bearing actuals in scope, keep plans + non-minute actuals.
  const logs = normalizeLogs(h.logs);
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const start = dayStart(base);
  const end = start + 86400000;
  const kept = logs.filter(log=>{
    if(isPlanLog(log))return true;
    if(logMinutes(log) === null)return true;
    if(h.type === 'task')return false;
    const ts = logTime(log);
    return !ts || ts < start || ts >= end;
  });
  if(target > 0){
    const ts = (typeof snapLogTimestamp === 'function')
      ? snapLogTimestamp(h,Date.now())
      : Date.now();
    kept.push(makeActualLog(ts,{ minutes:target }));
  }
  h.logs = normalizeLogs(kept);
  h.lastLog = latestActualLog(h.logs);
  return { mode:'set', delta, minutes:target };
}
/** PURE: task fully complete? Breakable tasks need chunk minutes to cover duration
 *  (or a full log without minutes). Non-breakable: any actual log. */
function isTaskDone(h){
  if(!h || h.type !== 'task')return false;
  if(h.lastLog === null)return false;
  if(!h.breakable)return true;
  const logs = normalizeLogs(h.logs).filter(log=>!isPlanLog(log));
  if(!logs.length)return false;
  if(logs.some(log=>logMinutes(log) === null))return true;
  return remainingDurationMinutes(h) <= 0;
}
// PURE: coerce a raw priority into the 0–5 band (P0 critical → P5 someday).
// Missing/out-of-range values fall back to DEFAULT_PRIORITY so legacy records
// migrate seamlessly.
function clampPriority(value){
  const n = parseInt(value,10);
  if(Number.isNaN(n))return DEFAULT_PRIORITY;
  return Math.max(0,Math.min(PRIORITY_LABELS.length - 1,n));
}
// PURE: effective priority for an item, bounded to 0..5.
function effectivePriority(h){
  return clampPriority(h && h.priority);
}
function clampTimestamp(value){
  const n = Number(value);
  if(!Number.isFinite(n) || n <= 0)return null;
  const MS_YEAR = 365 * 86400000;
  if(n < Date.now() - 10 * MS_YEAR || n > Date.now() + 10 * MS_YEAR)return null;
  return Math.round(n);
}
function clampDayTimestamp(value){
  const ts = clampTimestamp(value);
  return ts === null ? null : dayStart(ts);
}
function cleanTopic(value){
  return String(value || '').trim().replace(/\s+/g,' ').slice(0,32);
}
function normalizeTopics(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return items.map(cleanTopic).filter(topic=>{
    const key = topic.toLowerCase();
    if(!topic || seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,24);
}
function normalizeAllowedWeekdays(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const days = items.map(day=>parseInt(day,10)).filter(day=>{
    if(!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day))return false;
    seen.add(day);
    return true;
  }).sort((a,b)=>a-b);
  return days.length === 7 ? [] : days;
}
function normalizeAllowedMonthDays(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const days = items.map(day=>parseInt(day,10)).filter(day=>{
    if(!Number.isInteger(day) || day < 1 || day > 31 || seen.has(day))return false;
    seen.add(day);
    return true;
  }).sort((a,b)=>a-b);
  return days.length === 31 ? [] : days;
}
function normalizeTimeMinutes(value){
  const n = parseInt(value,10);
  if(Number.isNaN(n))return null;
  return Math.max(0,Math.min(1439,n));
}
function normalizeAgendaScoreWeights(value){
  const defaults = (typeof DEFAULT_SORT_SETTINGS !== 'undefined' && DEFAULT_SORT_SETTINGS.agendaScoreWeights)
    ? DEFAULT_SORT_SETTINGS.agendaScoreWeights
    : { travel:1, cluster:1, day:1, asap:0.12, scarce:0.05, preference:1.5 };
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  for(const key of Object.keys(defaults)){
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? n : defaults[key];
  }
  return out;
}
function normalizeAvailability(value){
  const src = Array.isArray(value) ? value : DEFAULT_AVAILABILITY_MINUTES;
  return WEEKDAY_LABELS.map((_,i)=>Math.max(0,Math.min(1440,parseInt(src[i],10) || 0)));
}
function normalizeAvailabilityOverrides(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  return Object.entries(value).reduce((acc,[key,minutes])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return acc;
    acc[key] = Math.max(0,Math.min(1440,parseInt(minutes,10) || 0));
    return acc;
  },{});
}
function normalizeBlockedTimes(value){
  const src = Array.isArray(value) ? value : DEFAULT_BLOCKED_TIMES;
  return src.map((raw,idx)=>{
    const label = cleanTopic(raw?.label || `blocked ${idx + 1}`).slice(0,24) || 'blocked';
    const days = normalizeAllowedWeekdays(raw?.days);
    const start = normalizeTimeMinutes(raw?.start);
    const end = normalizeTimeMinutes(raw?.end);
    if(start === null || end === null || start === end)return null;
    // Optional location tie: a block tagged with a location tells the week
    // agenda where you already are during that span (sleep→Home, work→Office).
    // Stripped to a clean id; absent = location-agnostic (busy, place unknown).
    const locationId = cleanLocationId(raw?.locationId) || null;
    // Prayer anchors mirror habits: when set, the matching start/end is
    // resolved via adhan against the block's locationId — or, when the block
    // has no place, against the home city (Settings → Locations). Blocked
    // times do NOT support habit-anchors (they're a settings-level recurring
    // block, not tied to a habit's log stream).
    const startAnchor = cleanPrayerAnchor(raw?.startAnchor);
    const endAnchor = cleanPrayerAnchor(raw?.endAnchor);
    // Anchors are kept even without a place; resolution falls back to the
    // home city at runtime (see resolveBlockedTimeMinutes). With neither, the
    // resolved value is null and callers use the fixed clock fallback.
    const safeStartAnchor = startAnchor;
    const safeEndAnchor = endAnchor;
    const startCombine = safeStartAnchor && typeof cleanTimeCombine === 'function'
      ? cleanTimeCombine(raw?.startCombine) : null;
    const startAnchor2 = startCombine
      ? (typeof cleanBlockedAnchor2 === 'function'
        ? cleanBlockedAnchor2(raw?.startAnchor2)
        : cleanPrayerAnchor(raw?.startAnchor2))
      : null;
    const endCombine = safeEndAnchor && typeof cleanTimeCombine === 'function'
      ? cleanTimeCombine(raw?.endCombine) : null;
    const endAnchor2 = endCombine
      ? (typeof cleanBlockedAnchor2 === 'function'
        ? cleanBlockedAnchor2(raw?.endAnchor2)
        : cleanPrayerAnchor(raw?.endAnchor2))
      : null;
    const dayOff = typeof normalizeAnchorDayOffset === 'function' ? normalizeAnchorDayOffset : (v => 0);
    return {
      label,days,start,end,locationId,
      startAnchor:safeStartAnchor,
      startOffsetMin:normalizePrayerOffset(raw?.startOffsetMin),
      startCombine:startCombine && startAnchor2 ? startCombine : null,
      startAnchor2,
      startOffsetMin2:startAnchor2 && startAnchor2 !== 'fixed' ? normalizePrayerOffset(raw?.startOffsetMin2) : 0,
      startFixedMin2:startAnchor2 === 'fixed' ? (normalizeTimeMinutes(raw?.startFixedMin2) ?? 1200) : null,
      startDayOffset:dayOff(raw?.startDayOffset),
      startDayOffset2:startAnchor2 && startAnchor2 !== 'fixed' ? dayOff(raw?.startDayOffset2) : 0,
      endAnchor:safeEndAnchor,
      endOffsetMin:normalizePrayerOffset(raw?.endOffsetMin),
      endCombine:endCombine && endAnchor2 ? endCombine : null,
      endAnchor2,
      endOffsetMin2:endAnchor2 && endAnchor2 !== 'fixed' ? normalizePrayerOffset(raw?.endOffsetMin2) : 0,
      endFixedMin2:endAnchor2 === 'fixed' ? (normalizeTimeMinutes(raw?.endFixedMin2) ?? 1200) : null,
      endDayOffset:dayOff(raw?.endDayOffset),
      endDayOffset2:endAnchor2 && endAnchor2 !== 'fixed' ? dayOff(raw?.endDayOffset2) : 0
    };
  }).filter(Boolean).slice(0,24);
}
/** PURE: stable signature for a blocked-time instance on a given day. */
function blockedInstanceKey(label,startMin,endMin){
  return `${String(label || 'blocked').slice(0,24)}|${startMin}|${endMin}`;
}
/** PURE: validate per-day, per-instance blocked-time clock edits. */
function normalizeBlockedTimeOverrides(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  const out = {};
  for(const [dayKey,entries] of Object.entries(value)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !entries || typeof entries !== 'object' || Array.isArray(entries))continue;
    const clean = {};
    for(const [signature,raw] of Object.entries(entries)){
      const start = normalizeTimeMinutes(raw && raw.start);
      const end = normalizeTimeMinutes(raw && raw.end);
      if(!signature || start === null || end === null || start === end)continue;
      clean[String(signature).slice(0,96)] = {start,end};
    }
    if(Object.keys(clean).length)out[dayKey] = clean;
  }
  return out;
}
/** PURE: actual minute span of a blocked-time instance. Overnight blocks
 *  (end <= start, e.g. 22:00→02:00) wrap past midnight and occupy the
 *  complement (1440 − start + end). Same-day blocks are just end − start. */
function blockDurationMinutes(startMin,endMin){
  const s = Math.max(0,Math.min(1440,Number(startMin) || 0));
  const e = Math.max(0,Math.min(1440,Number(endMin) || 0));
  if(s === e)return 0;
  return e > s ? e - s : (1440 - s) + e;
}
/** PURE: coerce cancelled block map; drop keys older than 21 days. */
function normalizeCancelledBlocks(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  const cutoff = dayStart(Date.now()) - 21 * 86400000;
  const out = {};
  for(const [key,list] of Object.entries(value)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key))continue;
    const ts = Date.parse(`${key}T12:00:00`);
    if(!Number.isFinite(ts) || ts < cutoff)continue;
    const items = Array.isArray(list) ? list : [];
    const seen = new Set();
    out[key] = items.map(String).filter(sig=>{
      if(!sig || seen.has(sig))return false;
      seen.add(sig);
      return true;
    }).slice(0,48);
  }
  return out;
}
/** PURE: true if this block instance was cancelled for dayKey. */
function isBlockedCancelled(dayKey,label,startMin,endMin,settings){
  const map = normalizeCancelledBlocks(settings && settings.cancelledBlocks);
  const list = map[dayKey] || [];
  return list.includes(blockedInstanceKey(label,startMin,endMin));
}
/** HYBRID: cancel one block occurrence for a day; frees agenda for that instance. */
function cancelBlockedInstance(dayKey,label,startMin,endMin){
  const settings = loadSortSettings();
  const map = normalizeCancelledBlocks(settings.cancelledBlocks);
  const key = blockedInstanceKey(label,startMin,endMin);
  const list = new Set(map[dayKey] || []);
  list.add(key);
  map[dayKey] = [...list];
  saveSortSettings({...settings,cancelledBlocks:map});
  return true;
}
/** HYBRID: undo a cancel — re-block the instance so the agenda avoids that time again. */
function restoreBlockedInstance(dayKey,label,startMin,endMin){
  const settings = loadSortSettings();
  const map = normalizeCancelledBlocks(settings.cancelledBlocks);
  if(!map[dayKey])return false;
  const key = blockedInstanceKey(label,startMin,endMin);
  map[dayKey] = map[dayKey].filter(k=>k !== key);
  if(!map[dayKey].length)delete map[dayKey];
  saveSortSettings({...settings,cancelledBlocks:map});
  return true;
}

