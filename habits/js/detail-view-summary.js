// Summary is the first detail tab: the item's essentials plus every setting
// that differs from new-item defaults, as pills that open their control.
// With Needle ready, the dock composer edits this item inside the same tab.
// Nothing is written until the proposal's Save; Edit hands the staged values
// to the detail editor unsaved.

const detailSummary = {hid:null, session:null, feedback:null, busy:false, turn:0, occurrenceDate:''};
let detailSummaryLoadPending = false;
let detailSummaryRevising = false;
// Keep unsaved conversations during this visit, including when another item opens.
const detailSummaryDrafts = new Map();

function detailSummaryRecord(){
  if(detailIdx === null)return detailUnsavedCreate || null;
  return load()[detailIdx] || null;
}

function detailSummaryAskReady(){
  return Boolean(detailIdx !== null && sortSettings?.localAssistantProvider === 'needle'
    && detailAssistantAvailable() && typeof assistantFocusOpen === 'function');
}

function detailSummaryCanSend(){
  return typeof assistantNeedleCanSend !== 'function' || assistantNeedleCanSend();
}

function detailSummaryOnScreen(){
  const inner = getSheetInner('detail-sheet');
  if(!inner || inner.classList.contains('detail-search-open'))return false;
  return detailCurrentNav() === 'summary';
}

function detailSummaryPill(chip,session){
  const label = String(chip.label || '');
  const value = String(chip.text || '');
  // Compact rows show the value; the group label gives it context and the
  // accessible name keeps "Label: value". Only bare words that would read
  // ambiguous alone ("on") bring the label back visually.
  const ambiguous = /^(?:on|off|yes|no|none|enabled|disabled)$/i.test(value.trim());
  const text = !value ? (label || 'setting') : ambiguous && label ? `${label} · ${value}` : value;
  const body = `<span class="focus-field-text">${escapeHtml(text)}</span>`;
  if(!detailSummaryFieldSelector(chip.id,session))return `<span class="assistant-chip">${body}</span>`;
  return `<button type="button" class="assistant-chip focus-field" data-summary-field="${escapeHtml(chip.id)}" aria-label="${escapeHtml(`Open ${label || 'setting'}: ${value}`)}">${body}<i class="ti ti-chevron-right" aria-hidden="true"></i></button>`;
}

// ── Summary overview sections ─────────────────────────────────────────────
// Recent activity and grouped settings. The item's state lives in the header
// subtitle (the canonical cardCue); this tab carries history and settings.
// Everything is built from one synchronous snapshot: a single walk over the
// item's already-normalized logs (no storage reads, no re-normalization, no
// extra sorts) plus the settings and location references captured once.
// Dynamic time endpoints resolve through the shared prayer-time helpers with
// this render's dataset threaded in, and every visual keeps the pill it
// replaces informed: same editor destination, same information, or the pill
// stays.

// Field ids a section visual replaces. A visual that cannot render keeps its
// pill — the fallback is unconditional (see detailSummaryGroups).
const DETAIL_SUMMARY_VISUAL_FIELDS = ['allowedWeekdays','allowedWindow','preferredWindow','scheduleOptions','places','anywhereAllowed','locationPrefs'];

function detailSummarySettingsRef(){
  if(typeof sortSettings !== 'undefined' && sortSettings)return sortSettings;
  return typeof loadSortSettings === 'function' ? loadSortSettings() : {};
}

function detailSummaryKind(item){
  if(typeof isLocalAppointment === 'function' && isLocalAppointment(item))return 'appointment';
  if(typeof isEventItem === 'function' && isEventItem(item))return 'event';
  if(item.type === 'task')return 'task';
  if(typeof isOpportunityHabit === 'function' && isOpportunityHabit(item))return 'opportunity';
  return item.type === 'reduce' || item.type === 'zero' ? item.type : 'keepup';
}

function detailSummaryPlaceName(id,registry){
  if(typeof locationById !== 'function')return 'a saved place';
  const loc = locationById(id,registry);
  return (loc && loc.name) || 'a saved place';
}

function detailSummaryFacts(item,items){
  const now = Date.now();
  const dayBase = dayStart(now);
  const settings = detailSummarySettingsRef();
  const registry = Array.isArray(settings.locations) ? settings.locations : null;
  // One walk over raw logs, splitting plans from actual entries with the same
  // semantics actualLogs()/plannedLogs() derive from normalizeLogs: plan
  // objects, future plain-number entries, and future object plans are plans;
  // actual entries are everything else at or before now.
  const logs = Array.isArray(item.logs) ? item.logs : [];
  const actual = [];
  const plans = [];
  for(let i = 0;i < logs.length;i++){
    const log = logs[i];
    const ts = logTime(log);
    if(!ts)continue;
    if(isPlanLog(log) || (typeof log !== 'object' && ts > now)){
      plans.push({ts,timed:planTimed(log)});
      continue;
    }
    if(ts <= now)actual.push(ts);
  }
  // Stored logs are ascending; defend legacy order without re-sorting happily
  // sorted data (the parity test pins this against actualLogs()).
  let ascending = true;
  for(let i = 1;i < actual.length;i++){
    if(actual[i] < actual[i - 1]){ascending = false;break;}
  }
  if(!ascending)actual.sort((a,b)=>a - b);
  const plansToday = [];
  const timedPlansToday = [];
  const todayKey = dateKey(now);
  for(const plan of plans){
    if(dateKey(plan.ts) !== todayKey)continue;
    plansToday.push(plan);
    if(plan.timed)timedPlansToday.push(plan.ts);
  }
  timedPlansToday.sort((a,b)=>a - b);
  // Gap intervals with intervalValues() semantics (consecutive day diffs plus
  // the trailing open gap), consumed by the interval-tone caption.
  const intervals = [];
  for(let i = 1;i < actual.length;i++){
    intervals.push(Math.max(1,Math.round((actual[i] - actual[i - 1]) / 86400000)));
  }
  if(actual.length)intervals.push(Math.max(1,daysSince(actual[actual.length - 1]) || 1));
  return {
    now,dayBase,todayKey,kind:detailSummaryKind(item),registry,settings,
    placeName:id=>detailSummaryPlaceName(id,registry),
    actual,plans,plansToday,timedPlansToday,
    lastActualTs:actual.length ? actual[actual.length - 1] : null,
    activity:detailSummaryActivityBuckets(item,dayBase,actual,plans),
    intervals
  };
}

// One activity bucket per rhythm period, derived from the habit's own saved
// fields — target is the rhythm in days (fractional: 3.5 = 2×/7d; opportunity
// habits use their minimum day gap). Daily-ish rhythms read as days, x-times-
// per-week as weeks, month-day/ordinal schedules as months, and longer
// rhythms as windows of the habit's own period. Nothing is invented here: the
// same target the planner and cue use picks the bucket size.
function detailSummaryCadence(item){
  const monthDays = typeof normalizeAllowedMonthDays === 'function'
    ? normalizeAllowedMonthDays(item.allowedMonthDays) : [];
  const ordinals = typeof normalizeOrdinalWeekdays === 'function'
    ? normalizeOrdinalWeekdays(item.allowedOrdinalWeekdays) : [];
  if(monthDays.length || ordinals.length)return {mode:'month',gap:0};
  const schedule = typeof scheduledDays === 'function' ? scheduledDays(item) : null;
  const days = schedule ? schedule.weekdays : (normalizeAllowedWeekdays(item.allowedWeekdays) || []);
  const subset = days.length >= 1 && days.length < 7;
  const gap = typeof isOpportunityHabit === 'function' && isOpportunityHabit(item)
    ? (typeof opportunityGapDays === 'function' ? opportunityGapDays(item) : 1)
    : (Number(item.target) > 0 ? Number(item.target) : 7);
  if(!subset && gap <= 2)return {mode:'day',gap};
  if(gap <= 7)return {mode:'week',gap};
  return {mode:'period',gap};
}

// Expected entries per bucket — used only to scale dot intensity (never to
// grade). Follows the saved rhythm: sessions per day, per week (capped by
// eligible weekdays), or one per period/month.
function detailSummaryBucketExpect(item,cadence){
  if(cadence.mode === 'day')return Math.max(0.5,1 / cadence.gap);
  if(cadence.mode === 'week'){
    const schedule = typeof scheduledDays === 'function' ? scheduledDays(item) : null;
    const days = schedule ? schedule.weekdays : (normalizeAllowedWeekdays(item.allowedWeekdays) || []);
    const eligible = days.length >= 1 && days.length < 7 ? days.length : 7;
    return Math.max(0.5,Math.min(eligible,7 / cadence.gap));
  }
  if(cadence.mode === 'period')return 1;
  const monthDays = typeof normalizeAllowedMonthDays === 'function'
    ? normalizeAllowedMonthDays(item.allowedMonthDays) : [];
  const ordinals = typeof normalizeOrdinalWeekdays === 'function'
    ? normalizeOrdinalWeekdays(item.allowedOrdinalWeekdays) : [];
  return Math.max(1,monthDays.length + ordinals.length
    || Math.round(30.44 / Math.max(1,cadence.gap)));
}

// Eight stable buckets ending with the current (partial) one. Calendar-date
// arithmetic (Date components, not ms subtraction) keeps boundaries honest
// across DST and month lengths; positions before the item existed — or before
// its first entry when createdAt is missing — stay unavailable so empty
// buckets never read as missed commitments.
function detailSummaryActivityBuckets(item,dayBase,actual,plans){
  const cadence = detailSummaryCadence(item);
  const buckets = [];
  const today = new Date(dayBase);
  if(cadence.mode === 'month'){
    for(let i = 7;i >= 0;i--){
      buckets.push({startMs:new Date(today.getFullYear(),today.getMonth() - i,1).getTime(),
        endMs:new Date(today.getFullYear(),today.getMonth() - i + 1,1).getTime(),
        current:i === 0,actualCount:0,planCount:0,available:true});
    }
  }else if(cadence.mode === 'week'){
    const anchorDay = today.getDate() - today.getDay();
    for(let i = 7;i >= 0;i--){
      buckets.push({startMs:new Date(today.getFullYear(),today.getMonth(),anchorDay - i * 7).getTime(),
        endMs:new Date(today.getFullYear(),today.getMonth(),anchorDay - (i - 1) * 7).getTime(),
        current:i === 0,actualCount:0,planCount:0,available:true});
    }
  }else if(cadence.mode === 'period'){
    const span = Math.max(1,Math.round(cadence.gap));
    for(let i = 7;i >= 0;i--){
      buckets.push({startMs:new Date(today.getFullYear(),today.getMonth(),today.getDate() + 1 - (i + 1) * span).getTime(),
        endMs:new Date(today.getFullYear(),today.getMonth(),today.getDate() + 1 - i * span).getTime(),
        current:i === 0,actualCount:0,planCount:0,available:true});
    }
  }else{
    for(let i = 7;i >= 0;i--){
      buckets.push({startMs:new Date(today.getFullYear(),today.getMonth(),today.getDate() - i).getTime(),
        endMs:new Date(today.getFullYear(),today.getMonth(),today.getDate() - i + 1).getTime(),
        current:i === 0,actualCount:0,planCount:0,available:true});
    }
  }
  for(const ts of actual){
    for(const bucket of buckets){
      if(ts >= bucket.startMs && ts < bucket.endMs){bucket.actualCount += 1;break;}
    }
  }
  for(const plan of plans){
    for(const bucket of buckets){
      if(plan.ts >= bucket.startMs && plan.ts < bucket.endMs){bucket.planCount += 1;break;}
    }
  }
  const firstEntry = actual.length ? actual[0] : (plans.length ? plans[0].ts : null);
  let created = item.createdAt ? dayStart(item.createdAt) : null;
  if(created == null)created = firstEntry;
  if(created != null){
    for(const bucket of buckets){
      if(bucket.endMs <= created)bucket.available = false;
    }
  }
  return {cadence,buckets};
}

function detailSummaryDayLabel(ts){
  return new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
}

// Summary time text trims noise: anything within ten minutes of an hour reads
// as that hour (12:01pm → 12pm, 12:55pm → 1pm); other times stay exact.
function detailSummaryTimeLabel(minute){
  const m = Math.round(minute);
  const hour = Math.floor(m / 60);
  const rem = m % 60;
  if(rem <= 10)return detailSummaryHourLabel(hour);
  if(rem >= 50)return detailSummaryHourLabel(hour + 1);
  return formatTimeShort(m);
}
// Whole hours only, wrapping midnight (24:00 reads 12am, not formatTimeShort's 12pm).
function detailSummaryHourLabel(hour){
  return formatTimeShort((((hour % 24) + 24) % 24) * 60);
}

// Rule text compressed for the strip caption so each band stays on one line:
// "solar noon" reads "noon", "night midpoint" reads "midnight", and a repeated
// end anchor is elided ("noon → noon +2h" becomes "noon → +2h"). The editor
// keeps the full wording; this is the compact legend for the resolved clocks.
function detailSummaryCompactRule(startRule,endRule){
  const short = rule => rule ? rule.replace(/solar noon/g,'noon').replace(/night midpoint/g,'midnight') : '';
  const s = short(startRule);
  const e = short(endRule);
  if(s && e && e.startsWith(s + ' '))return `${s} → ${e.slice(s.length + 1)}`;
  return [s,e].filter(Boolean).join(' → ');
}

// Visible caption for the preview's time span. Period rhythms speak in the
// habit's own unit ("every 20 days"); the rest use plain counts.
function detailSummaryActivitySpan(cadence){
  if(cadence.mode === 'day')return 'last 8 days';
  if(cadence.mode === 'week')return 'last 8 weeks';
  if(cadence.mode === 'month')return 'last 8 months';
  return `every ${Math.max(1,Math.round(cadence.gap))} days`;
}

// Neutral density preview — counts entries, never grades them. Plans stay
// distinct from actual entries and never count as activity. The bucket size
// follows the habit's rhythm (see detailSummaryCadence) so the caption and
// the dots say the same thing.
function detailSummaryActivityRow(item,facts){
  if(facts.kind === 'task' || facts.kind === 'event' || facts.kind === 'appointment' || facts.kind === 'zero')return '';
  if(!facts.actual.length && !facts.plans.length)return '';
  const {cadence,buckets} = facts.activity;
  const expect = detailSummaryBucketExpect(item,cadence);
  const cells = buckets.map(bucket=>{
    if(!bucket.available)return '<span class="detail-activity-dot unavailable" aria-hidden="true"></span>';
    const ratio = bucket.actualCount / expect;
    const intensity = bucket.actualCount >= 1 ? (ratio >= 0.9 ? 'high' : ratio >= 0.45 ? 'mid' : 'low') : 'empty';
    const planned = !bucket.actualCount && bucket.planCount ? ' planned' : '';
    return `<span class="detail-activity-dot ${intensity}${planned}${bucket.current ? ' current' : ''}" aria-hidden="true"></span>`;
  }).join('');
  let gapCaption = null;
  if((facts.kind === 'keepup' || facts.kind === 'reduce') && typeof intervalToneSummary === 'function'){
    const summary = intervalToneSummary(item,facts.intervals.slice(-14));
    if(summary && summary.label && summary.label !== 'no gap history')gapCaption = summary.label;
  }
  const span = detailSummaryActivitySpan(cadence);
  const period = Math.max(1,Math.round(cadence.gap));
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const range = `${detailSummaryDayLabel(first.startMs)} – ${detailSummaryDayLabel(last.endMs - 1)}`;
  const bucketFacts = buckets.map(bucket=>{
    if(!bucket.available)return '';
    const count = `${bucket.actualCount} ${bucket.actualCount === 1 ? 'entry' : 'entries'}`;
    const sofar = bucket.current ? ' so far' : '';
    if(cadence.mode === 'day')return `${detailSummaryDayLabel(bucket.startMs)}: ${count}${sofar}.`;
    if(cadence.mode === 'week')return `Week of ${detailSummaryDayLabel(bucket.startMs)}: ${count}${sofar}.`;
    if(cadence.mode === 'month'){
      return `${new Date(bucket.startMs).toLocaleDateString(undefined,{month:'long',year:'numeric'})}: ${count}${sofar}.`;
    }
    return `${period} days from ${detailSummaryDayLabel(bucket.startMs)}: ${count}${sofar}.`;
  }).filter(Boolean).join(' ');
  const opening = cadence.mode === 'period'
    ? `Recent activity, 8 windows of ${period} days each`
    : `Recent activity, ${span}`;
  const aria = `${opening} ${range}. ${bucketFacts}`
    + `${gapCaption ? ` Recent gaps: ${gapCaption}, judged against the current rhythm settings.` : ''} Opens ${typeof detailPageLabel === 'function' ? detailPageLabel('calendar') : 'history'}.`;
  return `<div class="detail-group"><span class="detail-group-label" aria-hidden="true">Activity</span>
    <button type="button" class="detail-activity" data-summary-history aria-label="${escapeHtml(aria)}">
      <span class="detail-activity-dots" aria-hidden="true">${cells}</span>
      <span class="detail-activity-caption" aria-hidden="true">${escapeHtml(`${span}${gapCaption ? ` · ${gapCaption}` : ''}`)}</span>
    </button>
  </div>`;
}

// Consecutive days collapse into ranges ("sun–thu"), singles stay ("sat").
function detailSummaryWeekdayRangeText(days){
  const sorted = [...days].sort((a,b)=>a - b);
  const parts = [];
  let runStart = null;
  for(let i = 0;i <= sorted.length;i++){
    const day = i < sorted.length ? sorted[i] : null;
    if(runStart === null){runStart = day;continue;}
    if(day !== sorted[i - 1] + 1){
      parts.push(runStart === sorted[i - 1]
        ? WEEKDAY_LABELS[runStart]
        : `${WEEKDAY_LABELS[runStart]}–${WEEKDAY_LABELS[sorted[i - 1]]}`);
      runStart = day;
    }
  }
  return parts.join(' & ');
}

function detailSummaryWeekStrip(item,facts){
  // The general weekday mask only — option rows show their own days, and the
  // all-seven default collapses to [] (nothing to teach). Compact range text
  // keeps the Schedule row one line tall; the accessible name carries the
  // full day names.
  if(typeof normalizeAllowedWeekdays !== 'function')return null;
  const days = normalizeAllowedWeekdays(item.allowedWeekdays) || [];
  if(!days.length || days.length === 7)return null;
  const fullNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const text = detailSummaryWeekdayRangeText(days);
  const label = `Allowed days: ${days.map(d=>fullNames[d]).join(', ')}`;
  return `<button type="button" class="assistant-chip detail-week-text" data-summary-field="allowedWeekdays" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="focus-field-text">${escapeHtml(text)}</span></button>`;
}

// Resolved minutes → day-bounded intervals via the canonical helper (equal
// endpoints read as the full day, overnight windows split at midnight).
function detailSummaryResolvedWindows(item,startField,endField,fixedStart,dayBase,items){
  const rawStart = resolveHabitTimeField(item,startField,dayBase,null,items);
  if(rawStart == null)return null;
  const rawEnd = fixedStart
    ? rawStart + clampDuration(item.durationMinutes)
    : resolveHabitTimeField(item,endField,dayBase,null,items);
  if(rawEnd == null)return null;
  return {rawStart,rawEnd,windows:fillClockWindowOnDay(rawStart,rawEnd,dayBase)};
}

function detailSummaryWindowRule(item,field,fixedStart,items){
  if(fixedStart)return '';
  return typeof habitEndpointLabel === 'function' ? habitEndpointLabel(item,field,items) : '';
}

// Resolved minutes only label the strip when they land inside the calendar
// day; anything outside (next-day expressions, deep negative offsets) keeps
// the pill's rule text instead of a misleading clamped clock.
function detailSummaryInDayMinutes(minute){
  return minute != null && minute >= 0 && minute <= 1440;
}

// Sleep-like night blocks, detected structurally rather than by label: any
// recurring busy block of four hours or more that reaches the deep-night core
// (11pm–5am). Its waking complement is the daytime context the window strip
// cares about, so the track crops to it instead of spending its width on
// empty night hours. A short evening block never qualifies — it has to hold
// four hours that include real night.
// One computation per settings snapshot and day: blocked-time resolution runs
// prayer-anchor math, and the summary sheet can re-render often.
let _detailSummaryWakingCache = null;
function detailSummaryWakingIntervals(facts){
  if(_detailSummaryWakingCache && _detailSummaryWakingCache.dayBase === facts.dayBase
    && _detailSummaryWakingCache.settings === facts.settings)return _detailSummaryWakingCache.value;
  let value = null;
  if(typeof agendaBlockedIntervals === 'function' && typeof mergeMinuteIntervals === 'function'){
    const settings = facts.settings;
    if(settings && Array.isArray(settings.blockedTimes) && settings.blockedTimes.length){
      const rows = agendaBlockedIntervals(facts.todayKey,settings,facts.dayBase,facts.dayBase + 24 * 3600000);
      const seen = new Map();
      for(const row of rows){
        // Overnight blocks arrive as two day-pieces sharing one signature; the
        // wrap-encoded block bounds ride on every piece.
        if(!seen.has(row.blockSignature))seen.set(row.blockSignature,{s:row.effectiveBlockStartMin,e:row.effectiveBlockEndMin});
      }
      const busy = [];
      for(const {s,e} of seen.values()){
        if(s === e)continue; // 24h coverage: nothing waking left to crop toward
        const wrap = e < s;
        const duration = wrap ? 1440 - s + e : e - s;
        if(duration < 4 * 60)continue;
        // Deep-night core [23:00,5:00): wraps cross it by construction; a
        // same-day block reaches it only by starting before 5am or ending after 11pm.
        if(!(wrap || s < 300 || e > 1380))continue;
        busy.push(...(wrap ? [{start:s,end:1440},{start:0,end:e}] : [{start:s,end:e}]));
      }
      if(busy.length){
        const merged = mergeMinuteIntervals(busy);
        const waking = [];
        let cursor = 0;
        for(const win of merged){
          if(win.start > cursor)waking.push({start:cursor,end:win.start});
          cursor = Math.max(cursor,win.end);
          if(cursor >= 1440)break;
        }
        if(cursor < 1440)waking.push({start:cursor,end:1440});
        if(waking.length)value = waking;
      }
    }
  }
  _detailSummaryWakingCache = {dayBase:facts.dayBase,settings:facts.settings,value};
  return value;
}

// Location-derived feasibility: a habit with no time fields of its own still
// inherits every allowed place's open hours — the planner can only place it
// inside those. The union over the allowed places is the effective window;
// anywhere-allowed habits and 24h-or-closed unions carry no constraint worth
// a diagram. Only places actually open today lend their names to the caption.
function detailSummaryLocationWindows(item,facts){
  if(typeof resolveLocationWindow !== 'function' || typeof unwrapMinuteWindow !== 'function' || typeof mergeMinuteIntervals !== 'function')return null;
  if(facts.kind === 'appointment' || facts.kind === 'event')return null;
  if(typeof habitDisplayAnywhereAllowed !== 'function' || habitDisplayAnywhereAllowed(item,facts.registry))return null;
  const ids = typeof habitDisplayLocationIds === 'function' ? habitDisplayLocationIds(item,facts.registry) : [];
  if(!ids.length || !Array.isArray(facts.registry))return null;
  const weekday = new Date(facts.dayBase).getDay();
  const intervals = [];
  const names = [];
  for(const id of ids){
    const loc = facts.registry.find(l => l.id === id);
    if(!loc)continue;
    const win = resolveLocationWindow(loc,weekday);
    if(!win)continue; // closed today: no window, no name
    intervals.push(...unwrapMinuteWindow(win));
    names.push(facts.placeName(id));
  }
  const merged = mergeMinuteIntervals(intervals);
  if(merged.length === 1 && merged[0].start === 0 && merged[0].end >= 1440)return null;
  return merged.length ? {wins:merged,names} : null;
}

function detailSummaryWindowStrip(item,facts,items,session){
  if(typeof fillClockWindowOnDay !== 'function' || typeof resolveHabitTimeField !== 'function')return null;
  const general = typeof hasGeneralAllowedSchedule !== 'function' || hasGeneralAllowedSchedule(item,facts.registry);
  const hasAllowed = general && typeof hasSimpleAllowedTimeWindow === 'function' && hasSimpleAllowedTimeWindow(item);
  const hasPreferred = typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(item);
  // Allowed geometry comes from the canonical planner helper: fixed starts,
  // blocked-time folding, equal-endpoint full days, and overnight splits all
  // follow fillSimpleDayWindows exactly. Raw endpoint clocks label the bands.
  const fixedStart = item.allowedTimeFixedStart === true;
  let allowed = null;
  if(hasAllowed){
    const wins = fillSimpleDayWindows(item,facts.dayBase,null,items);
    if(Array.isArray(wins) && wins.length)allowed = {wins};
  }
  let allowedClocks = null;
  if(allowed){
    const rawStart = resolveHabitTimeField(item,'allowedTimeStart',facts.dayBase,null,items);
    const rawEnd = fixedStart
      ? (rawStart == null ? null : rawStart + clampDuration(item.durationMinutes))
      : resolveHabitTimeField(item,'allowedTimeEnd',facts.dayBase,null,items);
    if(detailSummaryInDayMinutes(rawStart) && detailSummaryInDayMinutes(rawEnd))allowedClocks = {rawStart,rawEnd};
    else allowed = null; // outside the day: retain the pill's rule text
  }
  const preferred = hasPreferred
    ? detailSummaryResolvedWindows(item,'preferredTimeStart','preferredTimeEnd',false,facts.dayBase,items)
    : null;
  if(preferred && (!detailSummaryInDayMinutes(preferred.rawStart) || !detailSummaryInDayMinutes(preferred.rawEnd)))preferred = null;
  const fullDay = wins=>wins.length === 1 && wins[0].start === facts.dayBase && wins[0].end - wins[0].start >= 24 * 3600000;
  if(allowed && fullDay(allowed.wins) && !preferred)return null; // nothing to draw
  // No time fields of the item's own: the allowed places still impose one.
  // The strip draws that effective window instead of staying silent.
  const locationWins = allowed || preferred ? null : detailSummaryLocationWindows(item,facts);
  const replaces = [];
  if(allowed || locationWins)replaces.push('allowedWindow');
  if(preferred)replaces.push('preferredWindow');
  if(!replaces.length)return null;
  // Everything drawn, in day minutes. The view crops to the waking day
  // (sleep-like night blocks removed) but always expands back out to cover
  // any band that reaches past it, so no drawn window is ever clipped.
  const spans = [];
  for(const win of (allowed ? allowed.wins : []))spans.push({start:(win.start - facts.dayBase) / 60000,end:(win.end - facts.dayBase) / 60000,kind:'allowed'});
  for(const win of (locationWins ? locationWins.wins : []))spans.push({start:win.start,end:win.end,kind:'allowed'});
  for(const win of (preferred ? preferred.windows : []))spans.push({start:(win.start - facts.dayBase) / 60000,end:(win.end - facts.dayBase) / 60000,kind:'preferred'});
  for(const ts of facts.timedPlansToday){
    const startMin = (ts - facts.dayBase) / 60000;
    if(startMin < 0 || startMin >= 1440)continue;
    const widthMin = Math.max(8,clampDuration(item.durationMinutes) || 15);
    spans.push({start:startMin,end:Math.min(startMin + widthMin,1440),kind:'plan'});
  }
  if(!spans.length)return null;
  const waking = detailSummaryWakingIntervals(facts);
  let viewStart = 0,viewEnd = 1440;
  if(waking){
    const contentStart = spans.reduce((min,s)=>Math.min(min,s.start),1440);
    const contentEnd = spans.reduce((max,s)=>Math.max(max,s.end),0);
    const pick = waking.find(w => w.start <= contentStart && contentEnd <= w.end)
      || waking.find(w => w.end > contentStart && w.start < contentEnd)
      || waking.reduce((best,w)=> w.end - w.start > best.end - best.start ? w : best,waking[0]);
    viewStart = Math.min(pick.start,contentStart);
    viewEnd = Math.max(pick.end,contentEnd);
  }
  const viewSpan = Math.max(1,viewEnd - viewStart);
  const posPct = minutes=>Math.max(0,Math.min(100,((minutes - viewStart) / viewSpan) * 100));
  const widthPct = width=>Math.max(0,Math.min(100,(width / viewSpan) * 100));
  const bands = [];
  for(const span of spans){
    const left = Math.max(span.start,viewStart);
    const right = Math.min(span.end,viewEnd);
    if(right <= left)continue;
    const cls = span.kind === 'preferred' ? 'detail-track-preferred' : span.kind === 'plan' ? 'detail-track-plan' : 'detail-track-allowed';
    bands.push(`<span class="${cls}" style="left:${posPct(left).toFixed(2)}%;width:${widthPct(right - left).toFixed(2)}%" aria-hidden="true"></span>`);
  }
  // Hour marks keep the cropped scale readable; past eight hours of view the
  // step widens so the marks never crowd.
  const tickStep = viewSpan <= 8 * 60 ? 60 : 120;
  const ticks = [];
  for(let m = (Math.floor(viewStart / tickStep) + 1) * tickStep;m < viewEnd;m += tickStep){
    ticks.push(`<span class="detail-track-tick" style="left:${posPct(m).toFixed(2)}%" aria-hidden="true"></span>`);
  }
  // Scale ends sit on the hour they fall in: 6:38am reads "6am", 11:09pm reads
  // "11pm", so the day edges land on whole hours instead of raw minutes.
  const scaleLabel = minutes=>detailSummaryHourLabel(Math.floor(minutes / 60));
  const lines = [];
  if(locationWins){
    const names = locationWins.names.filter(Boolean);
    const where = names.length === 1 ? `at ${names[0]}`
      : names.length === 2 ? `at ${names[0]} · ${names[1]}`
      : 'at saved places';
    const first = locationWins.wins[0];
    const last = locationWins.wins[locationWins.wins.length - 1];
    lines.push(`<button type="button" class="detail-window-line" data-summary-field="places"><i class="detail-swatch allowed" aria-hidden="true"></i>${escapeHtml(where)} ${escapeHtml(detailSummaryTimeLabel(first.start))}–${escapeHtml(detailSummaryTimeLabel(last.end))}</button>`);
  }
  if(allowed && allowedClocks){
    const rule = detailSummaryCompactRule(
      detailSummaryWindowRule(item,'allowedTimeStart',fixedStart,items),
      detailSummaryWindowRule(item,'allowedTimeEnd',fixedStart,items));
    lines.push(`<button type="button" class="detail-window-line" data-summary-field="allowedWindow"><i class="detail-swatch allowed" aria-hidden="true"></i>${fixedStart ? 'fixed start' : 'allowed'} ${escapeHtml(detailSummaryTimeLabel(allowedClocks.rawStart))}–${escapeHtml(detailSummaryTimeLabel(allowedClocks.rawEnd))}${rule ? ` <span class="detail-window-rule">· ${escapeHtml(rule)}</span>` : ''}</button>`);
  }
  if(preferred){
    const rule = detailSummaryCompactRule(
      detailSummaryWindowRule(item,'preferredTimeStart',false,items),
      detailSummaryWindowRule(item,'preferredTimeEnd',false,items));
    lines.push(`<button type="button" class="detail-window-line" data-summary-field="preferredWindow"><i class="detail-swatch preferred" aria-hidden="true"></i>preferred ${escapeHtml(detailSummaryTimeLabel(preferred.rawStart))}–${escapeHtml(detailSummaryTimeLabel(preferred.rawEnd))}${rule ? ` <span class="detail-window-rule">· ${escapeHtml(rule)}</span>` : ''}</button>`);
  }
  if(facts.timedPlansToday.length){
    const next = facts.timedPlansToday.find(ts=>ts >= facts.now) ?? facts.timedPlansToday[0];
    const planMin = (next - facts.dayBase) / 60000;
    lines.push(`<button type="button" class="detail-window-line" data-summary-history><i class="detail-swatch plan" aria-hidden="true"></i>planned ${escapeHtml(detailSummaryTimeLabel(planMin))}${facts.timedPlansToday.length > 1 ? ` +${facts.timedPlansToday.length - 1} more` : ''}</button>`);
  }
  const ariaBits = [];
  if(locationWins){
    const first = locationWins.wins[0];
    const last = locationWins.wins[locationWins.wins.length - 1];
    const names = locationWins.names.filter(Boolean);
    const where = names.length === 1 ? `at ${names[0]}`
      : names.length === 2 ? `at ${names[0]} · ${names[1]}`
      : 'at saved places';
    ariaBits.push(`Possible ${where} ${detailSummaryTimeLabel(first.start)} to ${detailSummaryTimeLabel(last.end)}`);
  }
  if(allowed && allowedClocks)ariaBits.push(`Allowed today ${detailSummaryTimeLabel(allowedClocks.rawStart)} to ${detailSummaryTimeLabel(allowedClocks.rawEnd)}${fixedStart ? ', fixed start' : ''}`);
  else if(allowed)ariaBits.push('Allowed window open today');
  if(preferred)ariaBits.push(`Preferred today ${detailSummaryTimeLabel(preferred.rawStart)} to ${detailSummaryTimeLabel(preferred.rawEnd)}`);
  if(facts.timedPlansToday.length)ariaBits.push(`planned today ${detailSummaryTimeLabel((facts.timedPlansToday[0] - facts.dayBase) / 60000)}`);
  if(waking && (viewStart > 0 || viewEnd < 1440))ariaBits.push(`Timeline ${scaleLabel(viewStart)} to ${scaleLabel(viewEnd)}`);
  const field = locationWins ? 'places' : allowed ? 'allowedWindow' : 'preferredWindow';
  const openText = locationWins ? 'Opens the places editor.' : 'Opens the time window editor.';
  return {html:`<div class="detail-window" role="group" aria-label="Time windows">
    <button type="button" class="detail-window-track" data-summary-field="${field}" aria-label="${escapeHtml(`${ariaBits.join('. ')}. ${openText}`)}" title="${escapeHtml(ariaBits.join('. '))}">
    <span class="detail-track" aria-hidden="true">${bands.join('')}${ticks.join('')}</span>
    <span class="detail-track-scale" aria-hidden="true"><span>${escapeHtml(scaleLabel(viewStart))}</span><span>${escapeHtml(scaleLabel(viewEnd))}</span></span>
    </button>
    <div class="detail-window-caption">${lines.join('')}</div>
  </div>`,replaces};
}

// One row per option: days → time → place stay together. Dynamic endpoints
// resolve for today on the projected fields (which never carry habit anchors).
function detailSummaryOptionRows(item,facts,items,session){
  if(typeof normalizeHabitScheduleOptions !== 'function' || typeof habitScheduleOptionAllowedTimeFields !== 'function')return [];
  const options = normalizeHabitScheduleOptions(item.scheduleOptions,facts.registry);
  if(!options.length)return [];
  const prefSymbols = {high:'●●',little:'●',avoid:'⊘'};
  const prefWords = {high:'preferred',little:'slightly preferred',avoid:'marked avoid (still allowed)'};
  return options.map(option=>{
    const proj = habitScheduleOptionAllowedTimeFields(option);
    const daysText = option.weekdays.length ? option.weekdays.map(d=>WEEKDAY_LABELS[d]).join(', ') : 'every day';
    const placeName = option.locationId ? facts.placeName(option.locationId) : 'anywhere';
    const pref = option.pref ? prefSymbols[option.pref] || '' : '';
    const prefText = option.pref ? `, ${prefWords[option.pref] || option.pref}` : '';
    let timeText;
    if(proj.allowedTimeFixedStart === true){
      const startMin = resolveHabitTimeField(proj,'allowedTimeStart',facts.dayBase,null,items);
      timeText = startMin == null ? 'fixed start'
        : `fixed ${formatTimeShort(startMin)} · ${typeof compactHomeDuration === 'function' ? compactHomeDuration(item.durationMinutes) : `${item.durationMinutes}m`}`;
    }else{
      const startMin = resolveHabitTimeField(proj,'allowedTimeStart',facts.dayBase,null,items);
      const endMin = resolveHabitTimeField(proj,'allowedTimeEnd',facts.dayBase,null,items);
      const startRule = typeof habitEndpointLabel === 'function' ? habitEndpointLabel(proj,'allowedTimeStart',items) : '';
      const endRule = typeof habitEndpointLabel === 'function' ? habitEndpointLabel(proj,'allowedTimeEnd',items) : '';
      const inDay = v=>v != null && v >= 0 && v <= 1440;
      const clocks = inDay(startMin) && inDay(endMin)
        ? `${formatTimeShort(startMin)}–${formatTimeShort(endMin)}`
        : '';
      const span = clocks || [startRule,endRule].filter(Boolean).join('–') || 'time not set';
      timeText = `${span}${clocks && startRule ? ` (${escapeHtml(startRule)})` : ''}`;
    }
    const label = `${daysText}, ${timeText}, ${placeName}${prefText}. Opens the schedule alternatives editor.`;
    return `<button type="button" class="detail-option-row" data-summary-field="scheduleOptions" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <span class="detail-option-days" aria-hidden="true">${escapeHtml(daysText)}</span>
      <span class="detail-option-time" aria-hidden="true">${timeText}${pref ? ` <i class="detail-pref ${escapeHtml(option.pref)}" aria-hidden="true">${pref}</i>` : ''}</span>
      <span class="detail-option-place" aria-hidden="true">${escapeHtml(placeName)}</span>
    </button>`;
  });
}

function detailSummaryPlaceChips(item,facts,session){
  if(typeof habitDisplayLocationIds !== 'function')return null;
  const directIds = normalizeLocationIds(item.locationIds,facts.registry);
  const optionIds = typeof habitScheduleOptionLocationState === 'function'
    ? habitScheduleOptionLocationState(item.scheduleOptions,facts.registry).locationIds : [];
  const explicitIds = normalizeLocationIds([...directIds,...optionIds],facts.registry);
  const typeKeys = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(item.locationTypes) : [];
  const allIds = habitDisplayLocationIds(item,facts.registry);
  const anywhere = typeof habitDisplayAnywhereAllowed === 'function' && habitDisplayAnywhereAllowed(item,facts.registry);
  const optionsAnywhere = anywhere && typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(item);
  if(!allIds.length && !typeKeys.length && !optionsAnywhere)return null;
  const prefs = typeof normalizeLocationPrefs === 'function'
    ? normalizeLocationPrefs(item.locationPrefs,allIds,item.preferredLocationId) : {};
  const prefDots = {high:'●●',little:'●',avoid:'⊘'};
  const prefWords = {high:'preferred',little:'slightly preferred',avoid:'marked avoid (still allowed)'};
  const canOpen = id => detailSummaryFieldSelector(id,session);
  const chips = explicitIds.map(id=>{
    const name = facts.placeName(id);
    const level = prefs[id];
    const dots = level && prefDots[level] ? `<i class="detail-pref ${escapeHtml(level)}" aria-hidden="true">${prefDots[level]}</i>` : '';
    const levelText = level && prefWords[level] ? `: ${prefWords[level]}` : '';
    const body = `<span class="focus-field-text">${escapeHtml(name)}</span>${dots}`;
    return canOpen('places')
      ? `<button type="button" class="assistant-chip focus-field detail-place-chip" data-summary-field="places" aria-label="${escapeHtml(`${name}${levelText}`)}">${body}</button>`
      : `<span class="assistant-chip detail-place-chip">${body}</span>`;
  });
  for(const key of typeKeys){
    const label = typeof locationTypeKeyLabel === 'function' ? `Any ${locationTypeKeyLabel(key).toLowerCase()}` : key;
    const emoji = typeof locationTypeKeyEmoji === 'function' ? locationTypeKeyEmoji(key) : '';
    const matchCount = (facts.registry || []).filter(loc=>!loc.temporary && locationMatchesTypeKey(loc, key)).length;
    const text = `${emoji ? emoji + ' ' : ''}${label}${matchCount ? ` (${matchCount})` : ''}`;
    const body = `<span class="focus-field-text">${escapeHtml(text)}</span>`;
    chips.push(canOpen('places')
      ? `<button type="button" class="assistant-chip focus-field detail-place-chip" data-summary-field="places" aria-label="${escapeHtml(text)}">${body}</button>`
      : `<span class="assistant-chip detail-place-chip">${body}</span>`);
  }
  if(allIds.length || typeKeys.length || optionsAnywhere){
    const text = anywhere ? 'or anywhere' : 'only the saved places';
    const body = `<span class="focus-field-text">${escapeHtml(text)}</span>`;
    chips.push(canOpen('anywhereAllowed')
      ? `<button type="button" class="assistant-chip focus-field" data-summary-field="anywhereAllowed" aria-label="${escapeHtml(`${text}: open the setting`)}">${body}<i class="ti ti-chevron-right" aria-hidden="true"></i></button>`
      : `<span class="assistant-chip">${body}</span>`);
  }
  return chips.length ? chips.join('') : null;
}

// Stable group order; unknown or future families land in More so no field can
// disappear through a missed route.
function detailSummarySectionFor(chip,kind){
  const id = chip.id;
  if(DETAIL_SUMMARY_VISUAL_FIELDS.includes(id))return id === 'allowedWeekdays' ? 'schedule' : 'window';
  const family = (typeof assistantFocusField === 'function' ? (assistantFocusField(id) || {}).family : '') || '';
  if(kind === 'appointment' || kind === 'event'){
    if(family === 'event')return 'event';
  }
  if(id === 'rhythm' || id === 'durationMinutes' || id === 'priority')return 'schedule';
  if(family === 'recurrence' || family === 'dates' || family === 'schedule' || family === 'effort')return 'schedule';
  if(family === 'weather')return 'weather';
  if(family === 'order' || family === 'alternatives')return 'planning';
  return 'more';
}

function detailSummaryGroups(item,summary,facts,items){
  const session = summary.session;
  const weekStrip = detailSummaryWeekStrip(item,facts);
  const windowStrip = detailSummaryWindowStrip(item,facts,items,session);
  const optionRows = detailSummaryOptionRows(item,facts,items,session);
  const placeChips = detailSummaryPlaceChips(item,facts,session);
  const dropped = new Set();
  if(weekStrip)dropped.add('allowedWeekdays');
  if(windowStrip)windowStrip.replaces.forEach(id=>dropped.add(id));
  if(optionRows.length)dropped.add('scheduleOptions');
  if(placeChips)['places','anywhereAllowed','locationPrefs'].forEach(id=>dropped.add(id));
  const buckets = {schedule:[],window:[],places:[],weather:[],planning:[],event:[],more:[]};
  for(const chip of [...summary.essentials,...summary.custom]){
    if(dropped.has(chip.id))continue;
    const key = detailSummarySectionFor(chip,facts.kind);
    (buckets[key] || buckets.more).push(detailSummaryPill(chip,session));
  }
  const pillRow = (chips,label)=>`<div class="assistant-chip-row" role="group" aria-label="${escapeHtml(label)}">${chips.join('')}</div>`;
  const groups = [];
  if(weekStrip)buckets.schedule.push(weekStrip); // the weekday range sits in the Schedule row
  if(buckets.schedule.length)groups.push({label:'Schedule',body:pillRow(buckets.schedule,'Schedule settings')});
  const windowBody = [
    windowStrip ? windowStrip.html : '',
    optionRows.length ? `<div class="detail-option-rows" role="group" aria-label="Schedule alternatives">${optionRows.join('')}</div>` : '',
    buckets.window.length ? pillRow(buckets.window,'When and where settings') : ''
  ].filter(Boolean).join('');
  if(windowBody)groups.push({label:'When & where',body:windowBody});
  const placesBody = placeChips
    ? (buckets.places.length ? pillRow(buckets.places,'Place settings') : '') + `<div class="assistant-chip-row" role="group" aria-label="Places">${placeChips}</div>`
    : buckets.places.length ? pillRow(buckets.places,'Places') : '';
  if(placesBody)groups.push({label:'Places',body:placesBody});
  for(const [key,label] of [['weather','Weather'],['planning','Planning'],['event','Event'],['more','More']]){
    if(buckets[key].length)groups.push({label,body:pillRow(buckets[key],label)});
  }
  return groups;
}

function renderDetailSummaryOverview(held = null,items = null){
  const host = $('detail-summary');
  if(!host)return;
  const item = held || detailSummaryRecord();
  if(!item){host.replaceChildren();return;}
  if(typeof assistantFocusItemSummary !== 'function'){
    host.innerHTML = '<p class="focus-note">Loading summary…</p>';
    if(!detailSummaryLoadPending && typeof tingsLoadAssistant === 'function'){
      detailSummaryLoadPending = true;
      void tingsLoadAssistant().then(ok=>{
        detailSummaryLoadPending = false;
        if(ok)renderDetailSummary();
        else host.innerHTML = '<p class="focus-note">The summary is unavailable right now. The other tabs have every setting.</p>';
      });
    }
    return;
  }
  // The paint's saved list feeds name lookups without another load().
  const summary = assistantFocusItemSummary(item,items ? {items} : null);
  const facts = detailSummaryFacts(item,items);
  const parts = [];
  const activity = detailSummaryActivityRow(item,facts);
  for(const group of detailSummaryGroups(item,summary,facts,items)){
    parts.push(detailSummaryGroupRow(group.label,group.body));
  }
  if(activity)parts.push(activity);
  host.innerHTML = parts.join('');
}

// Group rows read "label  content" on one grid — the label column replaces
// the old full-width kicker lines. Bodies carry their own group labels for
// assistive tech, so the visual label stays presentational.
function detailSummaryGroupRow(label,body){
  return `<div class="detail-group"><span class="detail-group-label" aria-hidden="true">${escapeHtml(label)}</span><div class="detail-group-body">${body}</div></div>`;
}

function detailSummaryNavPage(nav){
  return [...(getSheetInner('detail-sheet')?.querySelectorAll('.detail-pager .detail-page') || [])]
    .find(page=>page.dataset.detailNav === nav);
}

function detailSummaryThread(){
  return $('detail-summary-thread');
}

let detailSummaryFollowEnd = false;
function detailSummaryKeepEnd(){
  if(!detailSummaryFollowEnd || !detailSummaryOnScreen())return;
  const page = getSheetInner('detail-sheet')?.querySelector('.detail-summary-page');
  const scroller = page;
  if(scroller)scroller.scrollTo({top:scroller.scrollHeight,behavior:'instant'});
}

function detailSummaryScrollToEnd(){
  detailSummaryFollowEnd = true;
  requestAnimationFrame(detailSummaryKeepEnd);
}

// A response stays above the composer/toast through keyboard and footer
// resizing. A reader's own scroll immediately takes ownership of the position.
const detailSummaryPager = $('detail-summary').closest('.detail-pager');
['touchstart','wheel'].forEach(type=>detailSummaryPager.addEventListener(type,()=>{
  detailSummaryFollowEnd = false;
},{passive:true}));
detailSummaryPager.addEventListener('keydown',event=>{
  if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)
    && !event.target.closest('input,textarea,[contenteditable="true"]'))detailSummaryFollowEnd = false;
});
const detailSummaryResizeObserver = new ResizeObserver(detailSummaryKeepEnd);
detailSummaryResizeObserver.observe(detailSummaryPager);
detailSummaryResizeObserver.observe($('detail-summary').closest('.detail-summary-page'));

function detailSummaryBubble(kind,text){
  const thread = detailSummaryThread();
  const bubble = document.createElement('div');
  bubble.className = `assistant-bubble assistant-bubble-${kind}`;
  const line = document.createElement('p');
  line.textContent = text;
  bubble.append(line);
  thread.append(bubble);
  $('detail-summary-chat').hidden = false;
  detailSummaryScrollToEnd();
  return bubble;
}

// One live proposal at a time, kept under the latest message.
function detailSummaryShowProposal(opts){
  const session = detailSummary.session;
  const thread = detailSummaryThread();
  if(!session || !thread)return;
  let card = thread.querySelector('[data-detail-proposal]:not(.is-retired)');
  if(!card){
    card = document.createElement('div');
    card.className = 'assistant-bubble assistant-bubble-say assistant-bubble-review';
    card.dataset.detailProposal = 'true';
  }
  card.innerHTML = assistantFocusReviewHtml(session,{
    embedded:true,
    canOpenNav:nav=>Boolean(detailSummaryNavPage(nav)),
    navLabel:nav=>typeof detailPageLabel === 'function' ? detailPageLabel(nav) : nav
  });
  if(opts?.live)card.querySelectorAll('button,input,select').forEach(control=>{control.disabled = true;});
  thread.append(card);
  $('detail-summary-chat').hidden = false;
  if(!opts?.live)detailSummary.feedback = session;
  if(!opts?.live)syncDetailSummaryDock();
  detailSummaryScrollToEnd();
}

function detailSummaryRetireProposal(label){
  const card = detailSummaryThread()?.querySelector('[data-detail-proposal]:not(.is-retired)');
  if(!card)return;
  card.classList.add('is-retired');
  const heading = card.querySelector('.focus-kicker');
  if(heading && label)heading.textContent = label;
  card.querySelectorAll('.btn-row,[data-focus-drop]').forEach(row=>row.remove());
  card.querySelectorAll('button,input,select').forEach(control=>{control.disabled = true;});
}

function detailSummaryHasWork(){
  const session = detailSummary.session;
  return Boolean(session && (session.changes.length || session.unresolved.length || session.continuationError || session.pendingFamilies.length || (session.itemActions || []).length));
}

// Setting chips answer a clarification; a notice (another item, a question)
// is not answered by picking one of this item's settings.
function detailSummaryNeedsPick(session){
  return Boolean(session?.unresolved?.some(item=>!item.notice));
}

function detailSummaryEnsureSession(){
  const current = detailSummary.session;
  if(detailIdx !== null && current && detailSummary.hid && current.targetId === detailSummary.hid && assistantFocusAlive(current))return current;
  const item = detailSummaryRecord();
  if(!item)return null;
  if(current && current.targetId === item.hid && assistantFocusAlive(current))return current;
  detailSummary.session = assistantFocusOpen({
    operation:'edit', kind:assistantFocusKindOf(item), targetId:item.hid,
    entry:'detail', occurrenceDate:detailSummary.occurrenceDate || ''
  });
  return detailSummary.session;
}

function detailSummaryReset(hid = null,preserve = false){
  if(preserve && detailSummary.busy && detailSummary.session){
    const session = detailSummary.session;
    // Invalidate late replies before reopening can renew the session's epoch.
    session.requestRevision = (session.requestRevision || 0) + 1;
    if(session._fieldState){
      const state = {...session._fieldState,revision:session.requestRevision,
        jobs:session.jobs.map(job=>({...job,status:['running','queued','waiting'].includes(job.status) ? 'retryable_failed' : job.status}))};
      Object.defineProperty(state,'session',{value:session});
      session._fieldState = state;session.jobs = state.jobs;
    }
    session.continuationError = 'Request paused when this item closed. Continue to finish reading.';
  }
  if(preserve && detailSummary.hid && (detailSummary.busy || detailSummaryHasWork() || detailSummaryDraft().trim())){
    detailSummaryDrafts.set(detailSummary.hid,{session:detailSummary.session,
      feedback:detailSummary.feedback,
      nodes:[...detailSummaryThread().childNodes],draft:detailSummaryDraft(),
      occurrenceDate:detailSummary.occurrenceDate});
  }else if(!preserve && detailSummary.hid)detailSummaryDrafts.delete(detailSummary.hid);
  if(detailSummary.busy && typeof assistantAbortInFlight === 'function')assistantAbortInFlight();
  detailSummary.turn += 1;
  detailSummary.busy = false;
  detailSummary.session = null;
  detailSummary.feedback = null;
  detailSummary.hid = hid;
  detailSummary.occurrenceDate = '';
  detailSummaryRevising = false;
  detailSummaryPrefixMiss = '';
  clearTimeout(detailSummaryGuidesTimer);
  detailSummaryGuidesTimer = 0;
  detailSummaryThread()?.replaceChildren();
  if($('detail-summary-chat'))$('detail-summary-chat').hidden = true;
  const input = $('detail-ask-input');
  if(input){
    const hadDraft = input.value || detailSummaryTagName();
    input.value = '';detailSummarySetTag('');
    // An already-empty composer keeps its resting height; re-measuring it
    // costs a sheet layout pass on every item switch.
    if(hadDraft || !input.style.height)detailSummaryResizeComposer();
  }
}

// Called on every detail paint. A new item starts over; the same item keeps
// its conversation, and an idle session rebuilds from the saved record.
function renderDetailSummary(held = null,items = null){
  const item = held || detailSummaryRecord();
  const hid = item?.hid || null;
  if(detailIdx === null || hid !== detailSummary.hid){
    detailSummaryReset(hid,true);
    const kept = hid && detailSummaryDrafts.get(hid);
    if(kept){
      detailSummaryDrafts.delete(hid);
      detailSummary.session = kept.session;
      detailSummary.feedback = kept.feedback || kept.session;
      detailSummary.occurrenceDate = kept.occurrenceDate;
      if(kept.session){
        kept.session.epoch = assistantFocusOpen({operation:'edit',kind:kept.session.kind,targetId:hid}).epoch;
        kept.session._focusInFlight = false;
      }
      detailSummaryThread().replaceChildren(...kept.nodes);
      $('detail-summary-chat').hidden = !kept.nodes.length;
      detailSummaryComposer(kept.draft);
      if(kept.session)detailSummaryShowProposal();
    }
  }
  else if(detailSummary.session && !detailSummary.busy && !detailSummaryHasWork())detailSummary.session = null;
  renderDetailSummaryOverview(item,items);
  syncDetailSummaryDock();
}

const detailComposerSizesToContent = CSS.supports('field-sizing','content');
function detailSummaryResizeComposer(){
  const input = $('detail-ask-input');
  if(!input || detailComposerSizesToContent)return;
  input.style.height = 'auto';
  const minHeight = getSheetInner('detail-sheet')?.classList.contains('detail-ask-typing') ? 36 : 44;
  input.style.height = `${Math.min(Math.max(input.scrollHeight,minHeight),108)}px`;
}

// Older WebViews need to remeasure wrapped lines when Search or Send changes
// the space available. Height-only notifications are our own resize.
if(!detailComposerSizesToContent){
  let lastWidth = 0;
  new ResizeObserver(([entry])=>{
    const width = entry.contentRect.width;
    if(width !== lastWidth && width > 0)detailSummaryResizeComposer();
    lastWidth = width;
  }).observe($('detail-ask-input'));
}

// The composer holds "Label: value" as a setting tag plus the typed value.
function detailSummaryTagName(){
  const tag = $('detail-ask-tag');
  return tag && !tag.hidden ? $('detail-ask-tag-label').textContent.trim() : '';
}

function detailSummarySetTag(label){
  const name = String(label || '').trim();
  const tag = $('detail-ask-tag');
  $('detail-ask-tag-label').textContent = name;
  tag.hidden = !name;
  tag.setAttribute('aria-label',name ? `Setting: ${name}` : 'Setting');
}

function detailSummaryDraft(){
  const rest = String($('detail-ask-input')?.value || '');
  const label = detailSummaryTagName();
  if(!label)return rest;
  return rest.trim() ? `${label}: ${rest.trim()}` : label;
}

function detailSummaryComposer(value){
  const input = $('detail-ask-input');
  const session = value && typeof assistantGuideParse === 'function' && detailSummaryAskReady() ? detailSummaryEnsureSession() : null;
  const parsed = session ? assistantGuideParse(String(value || ''),session) : null;
  detailSummarySetTag(parsed ? parsed.label : '');
  input.value = parsed ? parsed.rest : String(value || '');
  detailSummaryResizeComposer();
  syncDetailSummaryDock();
}

// A typed "Label:" becomes the tag once the label names a setting.
let detailSummaryPrefixMiss = '';
function detailSummaryAbsorbTag(){
  const input = $('detail-ask-input');
  if(detailSummaryTagName() || typeof assistantGuideParse !== 'function' || !detailSummaryAskReady())return;
  const raw = input.value;
  const cut = raw.search(/[:\-–—]/);
  if(cut < 1 || cut > 48)return;
  const head = raw.slice(0,cut).trim().toLowerCase();
  if(!head || head === detailSummaryPrefixMiss)return;
  const session = detailSummaryEnsureSession();
  const parsed = session && assistantGuideParse(raw,session);
  if(!parsed || !new RegExp(`^\\s*${assistantGuidePattern(parsed.label)}\\s*[:\\-–—]`,'i').test(raw)){
    detailSummaryPrefixMiss = head;
    return;
  }
  detailSummaryPrefixMiss = '';
  detailSummarySetTag(parsed.label);
  input.value = parsed.rest;
  detailSummaryResizeComposer();
}

function syncDetailSummaryInputChrome(){
  const inner = getSheetInner('detail-sheet');
  const input = $('detail-ask-input');
  if(!inner || !input)return;
  const draft = detailSummaryDraft();
  const hasText = Boolean(draft.trim());
  const show = inner.classList.contains('detail-ask-on');
  if(!inner.classList.contains('detail-search-open')){
    $('detail-cool').setAttribute('aria-label',show && draft ? 'clear change' : 'close details');
  }
  $('detail-ask-send').disabled = input.disabled || !detailSummaryCanSend() || !hasText;
  const revise = $('detail-ask-revise');
  if(revise && !revise.hidden){
    revise.disabled = hasText;
    revise.title = hasText ? 'Clear the message first.' : 'Take back the last unsaved request and edit it.';
  }
}

// The dock is the composer only while the summary is on screen; other tabs keep
// search. Search stays one tap away from the composer through its loupe.
function syncDetailSummaryDock(){
  const inner = getSheetInner('detail-sheet');
  const ask = $('detail-ask');
  if(!inner || !ask)return;
  const ready = detailSummaryAskReady();
  const onSummary = detailSummaryOnScreen();
  const canSend = detailSummaryCanSend();
  const show = ready && onSummary && (canSend || Boolean(detailSummaryDraft()));
  inner.classList.toggle('detail-summary-active',onSummary);
  inner.classList.toggle('detail-ask-on',show);
  ask.hidden = !show;
  if(!inner.classList.contains('detail-search-open'))$('detail-cool').setAttribute('aria-label',show && detailSummaryDraft() ? 'clear change' : 'close details');
  ask.classList.toggle('is-busy',detailSummary.busy);
  const input = $('detail-ask-input');
  const dirty = inner.classList.contains('tune-dirty');
  const askEntry = $('detail-summary-ask');
  askEntry.hidden = !onSummary || sortSettings.localAssistantProvider === 'needle' || !detailAssistantAvailable();
  askEntry.disabled = dirty;
  input.disabled = detailSummary.busy || dirty;
  input.placeholder = detailSummary.busy ? 'Assistant is reading…'
    : dirty ? 'Save or cancel first'
    : !canSend ? 'Download the assistant first'
    : detailSummaryTagName() ? 'Type the new value'
    : 'Ask assistant';
  $('detail-ask-tag-remove').disabled = input.disabled;
  $('detail-ask-send').disabled = input.disabled || !canSend || !detailSummaryDraft().trim();
  if(!show && document.activeElement === input)input.blur();
  $('detail-summary-setup').hidden = !ready || canSend;
  const feedback = $('detail-summary-feedback');
  feedback.hidden = !detailSummary.feedback || typeof feedbackFormConfigured !== 'function' || !feedbackFormConfigured();
  feedback.disabled = detailSummary.busy;
  renderDetailSummaryGuides();
}

// X clears a message in progress. An empty composer leaves the normal
// one-tap detail dismissal intact; prior conversation and proposals stay put.
function detailSummaryClearDraft(){
  const inner = getSheetInner('detail-sheet');
  if(!inner?.classList.contains('detail-ask-on') || !detailSummaryDraft())return false;
  $('detail-ask-input').blur();
  detailSummaryComposer('');
  $('detail-cool').focus({preventScroll:true});
  return true;
}

function detailSummaryOpenFeedback(){
  const focus = detailSummary.feedback;
  if(!focus || detailSummary.busy || !feedbackFormConfigured())return;
  const snap = assistantFeedbackFromFocus(focus);
  const transcript = assistantFeedbackTranscript(detailSummaryThread());
  snap.out.text = transcript.filter(turn=>turn.role === 'assistant').at(-1)?.text || snap.out.text;
  // Use this item's visible conversation, never the separate chat page.
  const report = assistantFeedbackReport(snap.out,{...snap.context,thread:detailSummaryThread()});
  document.activeElement?.blur?.();
  openFeedbackForm({note:assistantFeedbackExpectation(snap.out),context:report,assistant:true});
}

// Guides from the chat composer, shown while the user is composing or Needle
// waits on a choice: setting chips, one line of help, and Edit last request.
function detailSummaryGuideHint(session,active,draft){
  if(active){
    const help = assistantGuideHelp(active.id);
    return `${help.description}${help.example ? ` Example: ${help.example}.` : ''}`;
  }
  if(detailSummaryRevising)return 'Last request taken back. Edit it and send.';
  if(session.continuationError)return 'Draft kept. Continue, or edit the last request.';
  if(session.unresolved?.some(item=>item.field === 'guidance'))return 'Choose the setting or action you meant.';
  if(session.unresolved?.some(item=>assistantFocusQuestionPicker(session,item)))return 'Choose a value above, or type your answer.';
  if(detailSummaryNeedsPick(session))return 'Pick the setting you meant, then add its value.';
  return '';
}

let detailSummaryGuidesTimer = 0;
function detailSummaryScheduleGuides(){
  clearTimeout(detailSummaryGuidesTimer);
  detailSummaryGuidesTimer = setTimeout(()=>{
    detailSummaryGuidesTimer = 0;
    renderDetailSummaryGuides();
  },80);
}

function renderDetailSummaryGuides(){
  if(detailSummaryGuidesTimer){
    clearTimeout(detailSummaryGuidesTimer);
    detailSummaryGuidesTimer = 0;
  }
  const tray = $('detail-ask-guides');
  const list = $('detail-ask-guides-row');
  const inner = getSheetInner('detail-sheet');
  const input = $('detail-ask-input');
  if(!tray || !inner)return;
  const draft = detailSummaryDraft();
  const base = !$('detail-ask').hidden && !input.disabled && detailSummaryCanSend()
    && typeof assistantGuideSuggestions === 'function';
  const existing = detailSummary.session && assistantFocusAlive(detailSummary.session) ? detailSummary.session : null;
  const canRevise = Boolean(base && assistantGuideCanRevise(existing));
  // Chips and help only while composing or when Needle needs a pick; an idle
  // tray keeps just Edit last request so it never covers the proposal.
  const noticeOnly = existing?.unresolved?.length && !detailSummaryNeedsPick(existing) && !draft.trim();
  const guiding = base && !noticeOnly && Boolean(draft.trim() || detailSummaryNeedsPick(existing) || detailSummaryRevising);
  const session = guiding || canRevise ? detailSummaryEnsureSession() : null;
  if(!session){
    tray.hidden = true;
    tray.dataset.layoutSig = '';
    detailSummaryGuidesHeight(inner,0);
    return;
  }
  const hintSource = draft.trim() || String(session.currentRequest || (session.requests || []).at(-1) || '');
  const active = guiding ? assistantGuideRead(draft,session,true) : null;
  const suggestions = guiding ? assistantGuideSuggestions(session,hintSource) : [];
  const choosing = suggestions.some(item=>/^(?:action|field):/.test(item.id));
  const hint = guiding ? detailSummaryGuideHint(session,active,draft) : '';
  const labelText = active ? 'Change this setting'
    : choosing ? 'Which one?' : detailSummaryNeedsPick(session) ? 'Which setting?' : 'Settings you can change';
  $('detail-ask-guides-label').hidden = !guiding;
  $('detail-ask-guides-label').textContent = labelText;
  $('detail-ask-hint').hidden = !hint;
  $('detail-ask-hint').textContent = hint;
  const revise = $('detail-ask-revise');
  revise.hidden = !canRevise;
  revise.disabled = Boolean(draft.trim());
  revise.title = draft.trim() ? 'Clear the message first.' : 'Take back the last unsaved request and edit it.';
  const signature = `${suggestions.map(item=>item.id).join(',')}|${active ? active.id : ''}`;
  if(list.dataset.signature !== signature){
    list.dataset.signature = signature;
    const frag = document.createDocumentFragment();
    for(const item of suggestions){
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'assistant-guide';
      button.dataset.detailGuide = item.id;
      button.dataset.guideLabel = item.label;
      button.textContent = item.label;
      button.title = /^(?:action|field):/.test(item.id) ? item.label : assistantGuideHelp(item.id).description;
      button.setAttribute('aria-pressed',active && active.id === item.id ? 'true' : 'false');
      frag.append(button);
    }
    list.replaceChildren(frag);
  }
  list.hidden = !suggestions.length;
  tray.hidden = !suggestions.length && !hint && !canRevise;
  if(hint)input.setAttribute('aria-describedby','detail-ask-hint');
  else input.removeAttribute('aria-describedby');
  const layoutSig = tray.hidden ? '' : `${guiding?1:0}|${labelText}|${hint}|${canRevise?1:0}|${signature}`;
  if(tray.dataset.layoutSig !== layoutSig){
    const h = tray.hidden ? 0 : tray.offsetHeight;
    if(tray.hidden || h > 0){
      tray.dataset.layoutSig = layoutSig;
      detailSummaryGuidesHeight(inner,h);
    }
  }
}

// The page reserves the tray's height; a reader at the end stays at the end.
function detailSummaryGuidesHeight(inner,height){
  const before = parseFloat(inner.style.getPropertyValue('--detail-ask-guides-h')) || 0;
  if(before === height)return;
  const page = inner.querySelector('.detail-summary-page');
  const scroller = page;
  const atEnd = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  inner.style.setProperty('--detail-ask-guides-h',`${height}px`);
  if(atEnd && height > before)scroller.scrollTop = scroller.scrollHeight;
}

function detailSummaryApplyGuide(button){
  const session = detailSummary.session;
  const input = $('detail-ask-input');
  if(!session || input.disabled || detailSummary.busy)return;
  const id = button.dataset.detailGuide || '';
  if(/^(?:action|field):/.test(id)){
    assistantFocusChoose(session,'guidance',id);
    detailSummaryShowProposal();
    syncDetailSummaryDock();
    return;
  }
  detailSummaryComposer(assistantGuideCompose(detailSummaryDraft(),button.dataset.guideLabel,session));
  input.focus({preventScroll:true});
  try{ input.setSelectionRange(input.value.length,input.value.length); }catch(_){}
}

function detailSummaryReviseLast(){
  const session = detailSummary.session;
  if(!session || detailSummary.busy || detailSummaryDraft().trim())return;
  const request = assistantGuideRevise(session);
  if(request == null)return;
  detailSummaryRevising = true;
  detailSummaryThread().querySelector(`[data-detail-edit-request="${session.id}:${session.requests.length}"]`)?.remove();
  if(detailSummaryHasWork())detailSummaryShowProposal();
  else detailSummaryThread().querySelector('[data-detail-proposal]:not(.is-retired)')?.remove();
  if(!detailSummaryThread().children.length)$('detail-summary-chat').hidden = true;
  detailSummaryComposer(request);
  $('detail-ask-input').focus({preventScroll:true});
}

function detailSummarySetBusy(on){
  detailSummary.busy = on;
  syncDetailSummaryDock();
}

async function detailSummaryRead(session,text,opts){
  const turn = ++detailSummary.turn;
  detailSummarySetBusy(true);
  detailSummaryShowProposal({live:true});
  try{
    const out = await assistantFocusTurn(session,text,{
      ...opts,
      onProgress:info=>{
        if(turn === detailSummary.turn && info && (info.phase === 'staged' || info.phase === 'think'))detailSummaryShowProposal({live:true});
      }
    });
    if(turn === detailSummary.turn && !out?.cancelled)detailSummaryShowProposal();
  }catch(error){
    if(turn !== detailSummary.turn || error?.name === 'AbortError')return;
    detailSummaryShowProposal();
    detailSummaryBubble('say',error?.message || 'The assistant could not read that.');
  }finally{
    if(turn === detailSummary.turn)detailSummarySetBusy(false);
  }
}

async function detailSummarySend(text){
  const value = String(text || '').trim();
  if(!value || detailSummary.busy || !detailSummaryAskReady())return false;
  if(getSheetInner('detail-sheet')?.classList.contains('tune-dirty')){
    showToast('Save or cancel your edits before asking for a change.');
    return false;
  }
  if(!detailSummaryCanSend()){
    detailSummaryComposer(value);
    showToast('Download the assistant to ask for changes');
    return false;
  }
  const session = detailSummaryEnsureSession();
  if(!session)return false;
  const outgoing = typeof assistantGuideOutgoing === 'function' ? assistantGuideOutgoing(value,session) : value;
  const bubble = detailSummaryUserBubble(outgoing,session);
  const requestIndex = session.requests.length;
  detailSummaryRevising = false;
  detailSummaryComposer('');
  await detailSummaryRead(session,outgoing);
  if(session.requests.length > requestIndex)bubble.dataset.detailEditRequest = `${session.id}:${requestIndex}`;
  return true;
}

function detailSummaryUserBubble(text,session){
  const bubble = detailSummaryBubble('user',text);
  const parsed = typeof assistantGuideParse === 'function' ? assistantGuideParse(text,session) : null;
  if(!parsed)return bubble;
  const tag = `<span class="assistant-mention assistant-mention-static"><span class="assistant-mention-label">${escapeHtml(parsed.label)}</span></span>`;
  bubble.innerHTML = `<p class="assistant-user-line">${tag}${parsed.rest ? ` <span class="assistant-user-detail">${escapeHtml(parsed.rest)}</span>` : ''}</p>`;
  return bubble;
}

function detailSummaryFieldSelector(field,session){
  if(field === 'name')return '#detail-habit-message';
  if(field === 'planByDate')return '#detail-calendar';
  return assistantFocusDetailSelector(field,session);
}

function detailSummaryOpenHistory(){
  if(detailStripOffset !== 0){
    detailStripOffset = 0;
    const item = detailSummaryRecord();
    if(item)renderCalendar(item);
  }
  const calendar = getSheetInner('detail-sheet')?.querySelector('#detail-calendar');
  if(calendar)revealDetailSearchEntry({target:calendar,label:'Activity',revealHidden:true,focus:false});
}

function detailSummaryReveal(field,session,focus = true){
  if(field === 'planByDate'){
    const item = detailSummaryRecord();
    const date = item && habitPlanByDate(item);
    if(Number.isFinite(date)){
      const {start,days} = detailStripWindow();
      detailStripOffset += Math.floor((date - start) / (days * 86400000));
      renderCalendar(item);
    }
  }
  const selector = detailSummaryFieldSelector(field,session);
  const control = selector && getSheetInner('detail-sheet')?.querySelector(selector);
  if(control)revealDetailSearchEntry({target:control,label:assistantFocusField(field)?.label || '',revealHidden:true,focus});
}

async function detailSummaryHandleProposal(target){
  const session = detailSummary.session;
  const button = target.closest('button');
  if(!session || detailSummary.busy || !button || button.disabled)return;
  const status = text=>{
    const line = button.closest('[data-focus-review]')?.querySelector('[data-focus-status]');
    if(line)line.textContent = text;
  };
  const picked = assistantFocusPickerClick(target);
  if(picked){
    if(!picked.values)return;
    const result = assistantFocusPickValues(session,picked.field,picked.values,picked.preferenceLevel);
    if(result.ok)detailSummaryShowProposal();
    else status(result.error);
    return;
  }
  const openItem = target.closest('[data-focus-open-item]');
  if(openItem){
    const index = load().findIndex(row=>row && row.hid === openItem.dataset.focusOpenItem);
    if(index < 0){status('That item is no longer available.');return;}
    const request = String(session.currentRequest || '');
    openDetail(index);
    detailSummaryComposer(request);
    syncDetailSummaryDock();
    return;
  }
  const openNav = target.closest('[data-focus-open-nav]');
  if(openNav){
    const nav = openNav.dataset.focusOpenNav;
    const page = detailSummaryNavPage(nav);
    if(page)page.hidden = false;
    scrollDetailToNav(nav,'smooth');
    return;
  }
  const drop = target.closest('[data-focus-drop]');
  if(drop){
    const fields = drop.dataset.focusDrop === 'rhythm' ? ['timesPerPeriod','periodDays','repeatMode'] : [drop.dataset.focusDrop];
    session.changes = session.changes.filter(change=>!fields.includes(change.field));
    session.unresolved = session.unresolved.filter(issue=>!fields.includes(issue.field));
    if(fields.includes('places'))assistantFocusAskAnywhere(session);
    if(fields.includes('topics'))session.dependencies.topics = [];
    if(fields.includes('weatherRules'))session.dependencies.weatherProfile = null;
    session.savedFingerprint = '';session.interpretationApproved = null;
    detailSummaryShowProposal();
    return;
  }
  const field = target.closest('[data-focus-field]');
  if(field || target.closest('[data-focus-edit]')){
    const fieldId = field ? field.dataset.focusField
      : session.changes.map(change=>change.field).find(id=>assistantFocusDetailSelector(id,session));
    if(field && !assistantFocusDetailSelector(fieldId,session))return;
    if(!session.changes.length){status('There are no staged changes to open.');return;}
    const result = assistantFocusEditDraft(session);
    if(!result?.ok){status(result?.error || 'The detail editor is unavailable.');return;}
    detailSummaryRetireProposal('In editor');
    detailSummary.session = null;
    detailSummaryBubble('say','Opened in the editor with these changes. Save or cancel at the top.');
    if(fieldId)requestAnimationFrame(()=>detailSummaryReveal(fieldId,session));
    else if(session.changes.some(change=>change.field === 'name'))requestAnimationFrame(()=>openDetailNameEditor());
    return;
  }
  if(target.closest('[data-focus-save]')){
    button.disabled = true;
    const result = await assistantFocusCommit(session);
    if(result?.ok){
      detailSummaryRetireProposal('Saved');
      if(detailSummary.session === session)detailSummary.session = null;
      detailSummaryBubble('say','Saved. Undo is on the toast.');
      renderDetailSummaryOverview();
      return;
    }
    status(result?.error || 'Nothing was saved.');
    if(result?.stale)detailSummaryShowProposal();
    else button.disabled = !assistantFocusCanSave(session);
    return;
  }
  const choice = target.closest('[data-focus-choice]');
  if(!choice)return;
  const which = choice.dataset.focusChoice;
  const value = choice.dataset.focusValue || '';
  // A confirmed or dismissed action with nothing else staged ends that card.
  const settleAction = ()=>{
    if(detailSummaryHasWork()){detailSummaryShowProposal();return;}
    detailSummaryThread()?.querySelector('[data-detail-proposal]:not(.is-retired)')?.remove();
    detailSummary.session = null;
    syncDetailSummaryDock();
  };
  if(which === 'item-action-skip'){
    assistantFocusSkipAction(session,value);
    settleAction();
    if(!detailSummaryHasWork())detailSummaryBubble('say','Okay, nothing was logged or planned.');
    return;
  }
  if(which === 'item-action'){
    const result = assistantFocusCommitAction(session,value);
    if(!result.ok){status(result.error || 'Nothing was saved.');return;}
    settleAction();
    detailSummaryBubble('say',assistantFocusActionDoneText(result));
    refreshOpenViews();
    return;
  }
  if(which === 'resume'){
    await detailSummaryRead(session,'',{resume:true});
    return;
  }
  if(assistantFocusApplyChoice(session,which,value))detailSummaryShowProposal();
}

// Entry from search's Ask, the actions row and a home card. Opens the summary
// tab; an instruction is sent at once when Needle is ready, otherwise it waits
// in the composer.
function detailSummaryStart(instruction = '',opts = {}){
  if(!detailSummaryAskReady())return false;
  if(opts.occurrenceDate !== undefined && opts.occurrenceDate !== detailSummary.occurrenceDate && !detailSummary.busy){
    detailSummary.occurrenceDate = opts.occurrenceDate || '';
    if(!detailSummaryHasWork())detailSummary.session = null;
  }
  scrollDetailToNav('summary','auto');
  syncDetailSummaryDock();
  const text = String(instruction || '').trim();
  if(text && detailSummaryCanSend() && !detailSummary.busy){
    void detailSummarySend(text);
    return true;
  }
  if(text)detailSummaryComposer(text);
  requestAnimationFrame(()=>{
    const input = $('detail-ask-input');
    if(!input.disabled && !$('detail-ask').hidden)input.focus({preventScroll:true});
  });
  return true;
}

$('detail-summary-ask').addEventListener('click',()=>void openDetailAssistant());

$('detail-summary').addEventListener('click',event=>{
  const pill = event.target.closest('[data-summary-field]');
  const item = detailSummaryRecord();
  if(!item)return;
  if(!pill){
    if(event.target.closest('[data-summary-history]') && typeof scrollDetailToNav === 'function'){
      detailSummaryOpenHistory();
    }
    return;
  }
  if(typeof assistantFocusSummarySession !== 'function')return;
  detailSummaryReveal(pill.dataset.summaryField,assistantFocusSummarySession(item),event.detail === 0);
});
detailSummaryThread().addEventListener('input',event=>assistantFocusPickerFilter(event.target));
detailSummaryThread().addEventListener('click',event=>{
  if(!event.target.closest('[data-focus-save],[data-focus-edit],[data-focus-choice],[data-focus-field],[data-focus-open-item],[data-focus-open-nav],[data-focus-drop],[data-focus-pick],[data-focus-option]'))return;
  event.preventDefault();
  void detailSummaryHandleProposal(event.target);
});
$('detail-summary-clear').addEventListener('click',()=>{
  detailSummaryReset(detailSummary.hid);
  renderDetailSummaryOverview();
  syncDetailSummaryDock();
  if(!$('detail-ask').hidden)$('detail-ask-input').focus({preventScroll:true});
});
$('detail-summary-feedback').addEventListener('click',detailSummaryOpenFeedback);
$('detail-ask-input').addEventListener('input',()=>{
  detailSummaryAbsorbTag();
  detailSummaryResizeComposer();
  syncDetailSummaryInputChrome();
  detailSummaryScheduleGuides();
});
$('detail-ask-input').addEventListener('keydown',event=>{
  const input = event.currentTarget;
  if(event.key === 'Backspace' && detailSummaryTagName() && input.selectionStart === 0 && input.selectionEnd === 0
    && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey){
    event.preventDefault();
    detailSummarySetTag('');
    syncDetailSummaryDock();
    return;
  }
  if(event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229)return;
  event.preventDefault();
  void detailSummarySend(detailSummaryDraft());
});
$('detail-ask-send').addEventListener('pointerdown',event=>{if(event.pointerType !== 'touch')event.preventDefault();});
$('detail-ask-send').addEventListener('click',()=>void detailSummarySend(detailSummaryDraft()));
$('detail-ask-tag-remove').addEventListener('pointerdown',event=>{if(event.pointerType !== 'touch')event.preventDefault();});
$('detail-ask-tag-remove').addEventListener('click',()=>{
  detailSummarySetTag('');
  syncDetailSummaryDock();
  $('detail-ask-input').focus({preventScroll:true});
});
// Guide taps keep the keyboard up, so the tray stays put while choosing.
$('detail-ask-guides').addEventListener('pointerdown',event=>{
  if(event.pointerType !== 'touch' && event.target.closest('button'))event.preventDefault();
});
$('detail-ask-guides').addEventListener('click',event=>{
  const guide = event.target.closest('[data-detail-guide]');
  if(guide && !guide.disabled){detailSummaryApplyGuide(guide);return;}
  if(event.target.closest('#detail-ask-revise'))detailSummaryReviseLast();
});
// Keep compact chrome through the keyboard's closing animation. Restoring it
// on blur would move the composer while the keyboard is still on screen.
function syncDetailSummaryTyping(keyboardVisible){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const wasTyping = inner.classList.contains('detail-ask-typing');
  const active = document.activeElement;
  const typing = inner.classList.contains('detail-ask-on')
    && (active === $('detail-ask-input') || (wasTyping && (keyboardVisible || $('detail-ask').contains(active))));
  if(wasTyping === typing)return;
  inner.classList.toggle('detail-ask-typing',typing);
  detailSummaryResizeComposer();
  renderDetailSummaryGuides();
}
// The dock follows viewport events. Focusing it must not start a delayed
// conversation scroll partway through the OS keyboard animation.
// iOS's native tap-to-focus centers even a fixed input before viewport events
// arrive. A body lock cannot stop that visual pan. Own the initial tap, focus
// synchronously inside the gesture, and keep only the textarea above the
// viewport during Safari's focus calculation. Restore it before the next paint;
// its in-flow composer and the rest of detail never move for this workaround.
// Same approach as React Aria's mobile Safari focus guard:
// https://github.com/adobe/react-spectrum/blob/@react-aria/overlays@3.24.0/packages/@react-aria/overlays/src/usePreventScroll.ts
let detailSummaryFocusRestore = null;
let detailSummaryFocusTouch = null;
function detailSummaryGuardIOSFocus(){
  return !paneTierActive() && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
function detailSummaryPrepareFocus(){
  if(!detailSummaryGuardIOSFocus() || detailSummaryFocusRestore !== null)return;
  const input = $('detail-ask-input');
  const transform = input.style.transform;
  input.style.transform = 'translateY(-200vh)';
  detailSummaryFocusRestore = requestAnimationFrame(()=>{
    input.style.transform = transform;
    detailSummaryFocusRestore = null;
  });
}
$('detail-ask-input').addEventListener('touchstart',event=>{
  const touch = event.touches.length === 1 ? event.touches[0] : null;
  detailSummaryFocusTouch = detailSummaryGuardIOSFocus() && touch
    ? {id:touch.identifier,x:touch.clientX,y:touch.clientY} : null;
},{passive:true});
$('detail-ask-input').addEventListener('touchmove',event=>{
  const touch = event.touches[0],start = detailSummaryFocusTouch;
  if(!start || event.touches.length !== 1 || touch.identifier !== start.id
    || Math.hypot(touch.clientX-start.x,touch.clientY-start.y) > 8)detailSummaryFocusTouch = null;
},{passive:true});
$('detail-ask-input').addEventListener('touchcancel',()=>{detailSummaryFocusTouch = null;},{passive:true});
$('detail-ask-input').addEventListener('touchend',event=>{
  const start = detailSummaryFocusTouch;
  detailSummaryFocusTouch = null;
  const input = event.currentTarget;
  if(!start || event.touches.length || !event.cancelable || event.defaultPrevented
    || !Array.from(event.changedTouches).some(touch=>touch.identifier === start.id)
    || input.disabled || document.activeElement === input)return;
  event.preventDefault();
  detailSummaryPrepareFocus();
  input.focus({preventScroll:true});
},{passive:false});
$('detail-ask-input').addEventListener('focus',()=>{
  // Also cover focus restored by a guide, tag removal or hardware keyboard.
  detailSummaryPrepareFocus();
  updateKeyboardLift();
});
$('detail-ask-input').addEventListener('blur',()=>{
  requestAnimationFrame(()=>{
    if(document.activeElement === $('detail-ask-input'))return;
    renderDetailSummaryGuides();
    updateKeyboardLift();
  });
});
document.addEventListener('tings-needle-state',()=>{
  if(detailSummary.hid)renderDetailSummaryOverview();
  syncDetailSummaryDock();
});
