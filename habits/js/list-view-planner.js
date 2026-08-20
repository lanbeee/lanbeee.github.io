function homeListFingerprint(now = Date.now()){
  const data = typeof load === 'function' ? load() : [];
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  // Live-coord freshness — only changes when the user has crossed a coarse
  // ~100m bucket or the current-coord travel cache updated (e.g., an OSRM
  // result refined a haversine floor). Skips renders for sub-bucket GPS
  // jitter so the list doesn't thrash on every watch tick.
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const habitSig = data.map(h=>[
    h.name, h.type, h.lastLog, h.dueDate, h.eventTime,
    h.pinned ? 1 : 0, h.snoozedUntil || '',
    (h.locationIds || []).join(','),
    h.durationMinutes, h.priority, h.flexibilityDays,
    h.breakable ? 1 : 0,
    h.minChunkMinutes || '',
    typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0,
    h.allowedTimeStart, h.allowedTimeEnd,
    h.allowedTimeStartAnchor || '', h.allowedTimeStartOffsetMin || 0,
    h.allowedTimeEndAnchor || '', h.allowedTimeEndOffsetMin || 0,
    (h.allowedWeekdays || []).join(','),
    (h.preferredWeekdays || []).join(',')
  ].join('~')).join(';');
  return [
    Math.floor(now / 60000),
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    s.preset || '',
    weekOnHomeEnabled(s) ? 1 : 0,
    s.agendaOptimizer ? 1 : 0,
    s.showSnoozed ? 1 : 0,
    typeof searchQuery === 'string' ? searchQuery : '',
    typeof homeTopicFilter === 'string' ? homeTopicFilter : '',
    typeof homeLocationFilter === 'string' ? homeLocationFilter : '',
    travelSig,
    coordSig,
    currentEdgeSig,
    habitSig,
    (typeof habitTimer !== 'undefined' && habitTimer) ? `timer:${habitTimer.idx}:${habitTimer.startedAt}` : '',
    JSON.stringify(s.cancelledBlocks || {}),
    JSON.stringify(s.blockedTimeOverrides || {}),
    JSON.stringify(s.availabilityOverrides || {}),
    JSON.stringify(s.availabilityMinutes || []),
    JSON.stringify(s.blockedTimes || []),
    s.prayerMethod || '', s.prayerMadhab || ''
  ].join('\n');
}

let _homeListFingerprint = '';
let _homeRenderedWeek = null;
let _fastHomeRefreshToken = 0;
let _optimizerHomeRequestKey = '';
let _optimizerHomeRequestToken = 0;
let _optimizerHomeReadyKey = '';
let _optimizerHomeReadyWeek = null;
let _optimizerHomeReadyDirtyKey = '';
let _optimizerHomeRefinementKey = '';
let _optimizerHomeRefinementDoneKey = '';
let _optimizerHomeRefinementToken = 0;
let _idlePlannerRefreshTimer = null;
let _homeEarlyMapCache = {key:'',map:null};

// PURE: the visible scheduling result, without solver bookkeeping. Comparing
// this after a background solve lets the current DOM stay mounted when GLPK
// returns the same days, order, and times as the plan already on screen.
function homeAgendaPlanSignature(week,data = (typeof load === 'function' ? load() : [])){
  if(!week || !Array.isArray(week.days))return '';
  return week.days.map(day=>{
    const rows = Array.isArray(day.timeline) ? day.timeline : [];
    const rowSig = rows.map(row=>{
      const h = row && row.i != null ? data[row.i] : null;
      return [
        row && row.kind || '',
        h && h.hid || '',
        Number.isFinite(Number(row && row.start)) ? Math.round(Number(row.start) / 60000) : '',
        Number.isFinite(Number(row && row.end)) ? Math.round(Number(row.end) / 60000) : '',
        row && row.from || '',
        row && row.to || '',
        row && row.locationId || '',
        row && row.label || '',
        row && row.chunkMinutes != null ? Math.round(Number(row.chunkMinutes) || 0) : ''
      ].join('~');
    }).join(';');
    return `${day.dayKey || dateKey(day.dayBase)}:${rowSig}`;
  }).join('\n');
}

// PURE: quality tuple for accepting a background refinement. Hard recurring
// P0/pinned rows already visible anywhere in the week may never vanish, and
// total week work may not shrink. An in-progress row may only be extended,
// never moved, truncated, or dropped. Today's P0 breakable minutes then
// outrank today's raw minutes; travel is only a final tiebreak.
function homeAgendaRefinementQuality(week,data,settings){
  const days = week && Array.isArray(week.days) ? week.days : [];
  const required = new Map();
  let p0BreakableMinutes = 0;
  let totalFillMinutes = 0;
  let weekTotalFillMinutes = 0;
  let overdueMinutes = 0;
  let travelSeconds = 0;
  const activeRows = [];
  const now = Date.now();
  for(let dayOffset = 0;dayOffset < days.length;dayOffset += 1){
    const rows = Array.isArray(days[dayOffset].timeline) ? days[dayOffset].timeline : [];
    for(const row of rows){
      if(!row)continue;
      if(row.kind === 'travel'){
        travelSeconds += Number(row.seconds)
          || Math.max(0,(Number(row.end) - Number(row.start)) / 1000);
        continue;
      }
      if(row.kind !== 'fill' || row.i == null)continue;
      const h = data[row.i];
      if(!h)continue;
      const minutes = Math.max(0,(Number(row.end) - Number(row.start)) / 60000);
      weekTotalFillMinutes += minutes;
      if(dayOffset === 0)totalFillMinutes += minutes;
      const priority = typeof effectivePriority === 'function'
        ? effectivePriority(h) : Math.max(0,Math.min(5,Number(h.priority) || 2));
      if(dayOffset === 0 && priority === 0 && h.breakable)p0BreakableMinutes += minutes;
      const pinned = typeof isWeekPinnedToday === 'function'
        ? isWeekPinnedToday(h,settings || {}) : Boolean(h.pinned);
      if((priority === 0 && !h.breakable) || pinned){
        const key = `${dayOffset}:${row.i}`;
        required.set(key,(required.get(key) || 0) + minutes);
      }
      const urgency = typeof weekUrgency === 'function' ? weekUrgency(h) : 0;
      if(dayOffset === 0 && urgency >= 100)overdueMinutes += minutes;
      if(dayOffset === 0 && Number(row.start) <= now + 1000 && Number(row.end) > now){
        activeRows.push({
          i:row.i,
          start:Math.round(Number(row.start) / 60000),
          end:Math.round(Number(row.end) / 60000),
          loc:row.locationId || ''
        });
      }
    }
  }
  return {
    required,p0BreakableMinutes,totalFillMinutes,weekTotalFillMinutes,
    overdueMinutes,travelSeconds,activeRows
  };
}

// PURE: a baseline in-progress row survives into a candidate when the same
// habit keeps running from the same start at the same location. Extending the
// end is allowed (more of the ongoing session); moving, truncating, or
// dropping it is not.
function homeAgendaActiveRowPreserved(before,candidate){
  return candidate.i === before.i
    && candidate.start === before.start
    && candidate.loc === before.loc
    && candidate.end >= before.end;
}

function homeAgendaRefinementIsBetter(baseline,candidate,data,settings){
  if(!baseline || !candidate)return false;
  const before = homeAgendaRefinementQuality(baseline,data,settings);
  const after = homeAgendaRefinementQuality(candidate,data,settings);
  if(before.activeRows.some(row=>
    !after.activeRows.some(candidateRow=>homeAgendaActiveRowPreserved(row,candidateRow))
  ))return false;
  for(const [idx,minutes] of before.required){
    if((after.required.get(idx) || 0) + 0.01 < minutes)return false;
  }
  if(after.weekTotalFillMinutes + 0.01 < before.weekTotalFillMinutes)return false;
  if(Math.abs(after.p0BreakableMinutes - before.p0BreakableMinutes) > 0.01){
    return after.p0BreakableMinutes > before.p0BreakableMinutes;
  }
  if(Math.abs(after.totalFillMinutes - before.totalFillMinutes) > 0.01){
    return after.totalFillMinutes > before.totalFillMinutes;
  }
  if(Math.abs(after.overdueMinutes - before.overdueMinutes) > 0.01){
    return after.overdueMinutes > before.overdueMinutes;
  }
  if(Math.abs(after.travelSeconds - before.travelSeconds) > 0.5){
    return after.travelSeconds < before.travelSeconds;
  }
  return false;
}

function homeAgendaNeedsBackgroundRefinement(week,data,settings){
  if(!week || !week.optimized || week.refined)return false;
  if(week.plannerSolveStatus && week.plannerSolveStatus !== 'optimal')return true;
  const day = week.days && week.days[0];
  if(!day)return false;
  const placed = new Map();
  for(const row of day.timeline || []){
    if(row && row.kind === 'fill' && row.i != null){
      placed.set(row.i,(placed.get(row.i) || 0)
        + Math.max(0,(Number(row.end) - Number(row.start)) / 60000));
    }
  }
  for(let i = 0;i < data.length;i += 1){
    const h = data[i];
    if(!h || !h.breakable)continue;
    const priority = typeof effectivePriority === 'function' ? effectivePriority(h) : Number(h.priority);
    if(priority !== 0)continue;
    const eligible = typeof isWeekCandidate === 'function'
      ? isWeekCandidate(h,settings,day.dayBase,day.weekday) : true;
    if(!eligible)continue;
    const need = typeof todayCandidateLoadMinutes === 'function'
      ? todayCandidateLoadMinutes(h,day.dayBase) : Number(h.durationMinutes) || 0;
    if((placed.get(i) || 0) + 0.01 < need)return true;
  }
  return false;
}

function homeAgendaRefinementBudgetMs(week){
  const now = Date.now();
  const day = week && week.days && week.days[0];
  const nextHardStart = (day && day.timeline || [])
    .filter(row=>row && row.kind === 'scheduled' && Number(row.start) > now)
    .reduce((best,row)=>Math.min(best,Number(row.start)),Infinity);
  const untilBoundary = Number.isFinite(nextHardStart)
    ? nextHardStart - now - 5000 : 30000;
  if(untilBoundary < 6000)return 0;
  return Math.max(5000,Math.min(30000,Math.round(untilBoundary)));
}

function scheduleHomeAgendaRefinement(data,settings,baselineWeek){
  if(!homeAgendaNeedsBackgroundRefinement(baselineWeek,data,settings))return false;
  if(typeof buildWeekAgendaOffMain !== 'function')return false;
  const dirtyKey = homePlannerDirtyKey(data);
  const refinementKey = `${dateKey(Date.now())}\n${dirtyKey}`;
  if(_optimizerHomeRefinementKey === refinementKey
    || _optimizerHomeRefinementDoneKey === refinementKey)return false;
  const budgetMs = homeAgendaRefinementBudgetMs(baselineWeek);
  if(budgetMs <= 0)return false;
  const token = ++_optimizerHomeRefinementToken;
  _optimizerHomeRefinementKey = refinementKey;
  const deadline = Date.now() + budgetMs + 3000;
  const run = ()=>{
    if(token !== _optimizerHomeRefinementToken)return;
    if(typeof document !== 'undefined' && document.visibilityState === 'hidden'){
      _optimizerHomeRefinementKey = '';
      return;
    }
    if(homePlannerDirtyKey(load()) !== dirtyKey){
      _optimizerHomeRefinementKey = '';
      return;
    }
    const refineSettings = {...settings};
    void buildWeekAgendaOffMain(data,refineSettings,7,'exact',{
      dirtyKey,
      day0Only:false,
      refine:true,
      refineBudgetMs:budgetMs
    }).then(week=>{
      if(token !== _optimizerHomeRefinementToken)return;
      _optimizerHomeRefinementKey = '';
      _optimizerHomeRefinementDoneKey = refinementKey;
      if(Date.now() > deadline || homePlannerDirtyKey(load()) !== dirtyKey)return;
      if(!week || !Array.isArray(week.days))return;
      const liveData = load();
      if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,liveData);
      const incumbent = _homeRenderedWeek || baselineWeek;
      if(!homeAgendaRefinementIsBetter(incumbent,week,liveData,sortSettings || settings)){
        // A proof/status improvement with identical placements is still useful
        // audit/cache metadata, but it should not repaint the DOM.
        if(homeAgendaPlanSignature(incumbent,liveData) === homeAgendaPlanSignature(week,liveData)){
          _homeRenderedWeek = week;
          _optimizerHomeReadyWeek = week;
          _optimizerHomeReadyKey = optimizerHomeStateKey(liveData);
          _optimizerHomeReadyDirtyKey = dirtyKey;
          saveHomeAgendaCache(liveData,week);
        }
        return;
      }
      render({__fromBackgroundRefresh:true,__fromOptimizer:true,__optimizedWeek:week});
      const stableData = load();
      _optimizerHomeReadyWeek = week;
      _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
      _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
      saveHomeAgendaCache(stableData,week);
      _homeListFingerprint = homeListFingerprint();
    }).catch(()=>{
      if(token !== _optimizerHomeRefinementToken)return;
      _optimizerHomeRefinementKey = '';
      _optimizerHomeRefinementDoneKey = refinementKey;
    });
  };
  setTimeout(run,0);
  return true;
}

// Phone browsers may otherwise keep the nested GLPK worker consuming battery
// after the user locks the screen. Only refinement is cancelled here; the
// first usable agenda is already mounted by the time this flag is set.
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden || !_optimizerHomeRefinementKey)return;
    ++_optimizerHomeRefinementToken;
    _optimizerHomeRefinementKey = '';
    if(typeof cancelAgendaPlannerWorkerRequests === 'function'){
      cancelAgendaPlannerWorkerRequests('background refinement paused while hidden');
    }
  });
}

function homeReadingScrollHost(list){
  if(!list)return null;
  const pane = list.closest('.pane-list');
  return pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : null;
}

function homeReadingElementKey(el){
  if(!el)return '';
  if(el.classList.contains('swipe-row')){
    return `row:${el.dataset.hid || el.dataset.realIdx || ''}:${el.dataset.dayBase || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.classList.contains('section-header')){
    return `section:${el.dataset.capacityDay || el.dataset.label || ''}`;
  }
  if(el.classList.contains('travel-card') || el.classList.contains('travel-text')){
    return `travel:${el.dataset.travelFrom || ''}:${el.dataset.travelTo || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.dataset && el.dataset.blockedGroup)return `blocked:${el.dataset.blockedGroup}`;
  return '';
}

// READ: remember the item the user is currently reading and its viewport
// offset. The raw scroll position is retained as a fallback if that item is
// legitimately removed by the new plan.
function captureHomeReadingPosition(list){
  if(!list || !list.children.length)return null;
  const host = homeReadingScrollHost(list);
  const scrollTop = host ? host.scrollTop : window.scrollY;
  if(scrollTop <= 1)return null;
  const hostRect = host ? host.getBoundingClientRect() : {top:0,bottom:window.innerHeight};
  const top = Math.max(0,hostRect.top);
  const bottom = Math.min(window.innerHeight,hostRect.bottom);
  const candidates = Array.from(list.children);
  const anchor = candidates.find(el=>{
    const rect = el.getBoundingClientRect();
    return rect.bottom > top + 1 && rect.top < bottom;
  });
  if(!anchor)return {host,scrollTop,key:'',offset:0};
  return {
    host,
    scrollTop,
    key:homeReadingElementKey(anchor),
    hid:anchor.dataset && anchor.dataset.hid || '',
    dayKey:anchor.dataset && (anchor.dataset.capacityDay || (anchor.dataset.dayBase ? dateKey(Number(anchor.dataset.dayBase)) : '')) || '',
    offset:anchor.getBoundingClientRect().top - top
  };
}

// WRITE: put the same semantic row back under the user's eyes after a genuine
// plan change. This prevents a background refresh from jumping them to the top
// or losing tomorrow while still allowing rows to move when the plan changed.
function restoreHomeReadingPosition(snapshot,list){
  if(!snapshot || !list)return;
  const host = homeReadingScrollHost(list);
  const top = Math.max(0,host ? host.getBoundingClientRect().top : 0);
  const children = Array.from(list.children);
  let anchor = snapshot.key
    ? children.find(el=>homeReadingElementKey(el) === snapshot.key)
    : null;
  if(!anchor && snapshot.hid){
    anchor = children.find(el=>el.dataset && el.dataset.hid === snapshot.hid);
  }
  if(!anchor && snapshot.dayKey){
    anchor = children.find(el=>el.dataset && (
      el.dataset.capacityDay === snapshot.dayKey
      || (el.dataset.dayBase && dateKey(Number(el.dataset.dayBase)) === snapshot.dayKey)
    ));
  }
  if(anchor){
    const delta = anchor.getBoundingClientRect().top - top - snapshot.offset;
    if(Math.abs(delta) > 0.5){
      if(host)host.scrollTop += delta;
      else window.scrollBy({top:delta,left:0,behavior:'instant'});
    }
    return;
  }
  if(host)host.scrollTop = Math.min(snapshot.scrollTop,Math.max(0,host.scrollHeight - host.clientHeight));
  else window.scrollTo({
    top:Math.min(snapshot.scrollTop,Math.max(0,document.documentElement.scrollHeight - window.innerHeight)),
    left:0,
    behavior:'instant'
  });
}

const HOME_PLANNER_ALGORITHM_VERSION = 9;

// PURE: planner dirty signature without the wall-clock minute bucket. Background
// refreshes use this so a clock tick alone cannot force a full worker replan.
function homePlannerDirtyKey(data = (typeof load === 'function' ? load() : [])){
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const rev = typeof plannerDataRevision === 'function' ? plannerDataRevision() : 0;
  // Planner-relevant settings only — presentation (minimalMode, homeExtraMode,
  // showScheduledTasksInAgenda, showStatusOnCards, …) omitted.
  const settingsSig = JSON.stringify({
    agendaOptimizer:Boolean(s.agendaOptimizer),
    showWeekOnHome:Boolean(s.showWeekOnHome),
    // Candidate gates (isWeekCandidate) — toggles must invalidate the plan.
    showDueTasksInAgenda:s.showDueTasksInAgenda !== false,
    showPlannedItemsInAgenda:s.showPlannedItemsInAgenda !== false,
    showDueHabitsInAgenda:s.showDueHabitsInAgenda !== false,
    availabilityMinutes:s.availabilityMinutes || [],
    availabilityOverrides:s.availabilityOverrides || {},
    blockedTimes:s.blockedTimes || [],
    cancelledBlocks:s.cancelledBlocks || {},
    blockedTimeOverrides:s.blockedTimeOverrides || {},
    agendaScoreWeights:s.agendaScoreWeights || null,
    prayerMethod:s.prayerMethod || '',
    prayerMadhab:s.prayerMadhab || '',
    // Prayer/location windows resolve from home city coords.
    homeCityLat:Number.isFinite(s.homeCityLat) ? s.homeCityLat : null,
    homeCityLng:Number.isFinite(s.homeCityLng) ? s.homeCityLng : null,
    focus:s.focus || '',
    defaultTravelMode:s.defaultTravelMode || '',
    locations:(s.locations || []).map(l=>`${l.id}:${l.lat}:${l.lng}`).join('|'),
    // attentionScore / sort-lab inputs (isSortSettingKey list).
    plansFirst:Boolean(s.plansFirst),
    planWindowDays:s.planWindowDays || 0,
    planWeight:s.planWeight || 0,
    dueWeight:s.dueWeight || 0,
    progressWeight:s.progressWeight || 0,
    trendWeight:s.trendWeight || 0,
    rhythmWeight:s.rhythmWeight || 0,
    buildWeight:s.buildWeight || 0,
    limitWeight:s.limitWeight || 0,
    stopWeight:s.stopWeight || 0,
    newWeight:s.newWeight || 0,
    newBuildMode:s.newBuildMode || '',
    dueMode:s.dueMode || '',
    buildLookAheadDays:s.buildLookAheadDays || 0,
    buildRiseAt:s.buildRiseAt || 0,
    limitMode:s.limitMode || '',
    stopMode:s.stopMode || '',
    rhythmBias:s.rhythmBias || 0
  });
  return [
    `algorithm:${HOME_PLANNER_ALGORITHM_VERSION}`,
    rev,
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    travelSig,
    coordSig,
    currentEdgeSig,
    settingsSig,
    Array.isArray(data) ? data.length : 0
  ].join('\n');
}

// The lightweight home fingerprint deliberately omits some low-frequency
// fields. Optimizer reuse needs an exact key so edits to any habit, window,
// location, score weight, or travel edge can never reuse a stale schedule.
// Prefer the dirty-counter + live sig for request dedupe; keep a compact
// persisted digest for same-day disk cache identity (day-stable via dayStart).
function homePlannerStateKey(data,fingerprintNow = Date.now()){
  const dirty = homePlannerDirtyKey(data);
  // Include a coarse time bucket only for live optimizer keys (not dayStart),
  // so a genuine "now moved" reopen can still refresh day 0 via day0Only.
  const isDayStable = fingerprintNow === dayStart(fingerprintNow);
  const timePart = isDayStable ? 'day' : String(Math.floor(fingerprintNow / 60000));
  return `${dirty}\n${timePart}`;
}

function optimizerHomeStateKey(data){
  return homePlannerStateKey(data);
}

const HOME_AGENDA_CACHE_VERSION = 3;
const HOME_AGENDA_CACHE_KEY = 'tings_home_agenda_cache_v3';
const HOME_AGENDA_CACHE_FRESH_MS = 10 * 60 * 1000;
const HOME_COLD_BOOT_SKELETON_MAX_MS = 60 * 1000;

// Older keys may contain a week solved by a previous Worker even when the page
// scripts have updated. They are derived data only, so remove them eagerly.
try{
  localStorage.removeItem('tings_home_agenda_cache_v1');
  localStorage.removeItem('tings_home_agenda_cache_v2');
}catch(_){}

function showHomeAgendaLoading(){
  const list = $('list');
  if(!list || list.querySelector('.home-loading'))return;
  list.innerHTML = '<div class="home-loading" role="status" aria-label="loading agenda"><span></span><span></span><span></span></div>';
}

function homeAgendaCacheStateKey(data){
  return homePlannerStateKey(data,dayStart(Date.now()));
}

function readHomeAgendaCacheRecord(data){
  try{
    const cached = Storage.read(HOME_AGENDA_CACHE_KEY);
    if(!cached || cached.version !== HOME_AGENDA_CACHE_VERSION || !cached.week)return null;
    if(cached.key !== homeAgendaCacheStateKey(data))return null;
    if(dateKey(cached.savedAt) !== dateKey(Date.now()))return null;
    return cached;
  }catch(_){
    return null;
  }
}

function cachedHomeAgenda(data){
  try{
    const cached = readHomeAgendaCacheRecord(data);
    if(!cached)return null;
    const week = cached.week;
    for(const day of week.days || []){
      for(const row of day.timeline || []){
        if(row && row.i != null)row.h = data[row.i] || null;
      }
      for(const item of day.agendaItems || []){
        if(item && item.i != null)item.h = data[item.i] || null;
      }
    }
    return week;
  }catch(_){
    return null;
  }
}

function homeAgendaCacheIsFresh(data){
  const cached = readHomeAgendaCacheRecord(data);
  if(!cached)return false;
  return (Date.now() - Number(cached.savedAt || 0)) <= HOME_AGENDA_CACHE_FRESH_MS;
}

function saveHomeAgendaCache(data,week){
  if(!week || !Array.isArray(week.days))return;
  try{
    plannerPerfMark('planner-cache-write-start');
    // Habit records are already persisted once and every planner row carries
    // its stable data index. Omitting repeated `h` objects keeps this cache
    // small even for histories with hundreds of logs.
    const leanWeek = week.__lean ? week : leanAgendaWeek(week);
    if(leanWeek && leanWeek.__lean)delete leanWeek.__lean;
    Storage.write(HOME_AGENDA_CACHE_KEY,{
      version:HOME_AGENDA_CACHE_VERSION,
      savedAt:Date.now(),
      key:homeAgendaCacheStateKey(data),
      week:leanWeek
    });
    plannerPerfMark('planner-cache-write-end');
  }catch(_){}
}

// View-only state such as an expanded blocked group does not change placement.
// Repaint from the already solved week so the interaction responds immediately
// even if travel-cache background writes changed the next optimizer key.
function renderHomePresentationOnly(){
  if(!sortSettings && typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  if(_homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
    render({__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
    return;
  }
  render();
}

// ASYNC COORDINATOR: keep week planning outside the UI thread in both modes.
// A same-day cached or currently mounted week provides a stable view while the
// worker solves. A first-ever cold open keeps its skeleton until that result.
function scheduleIdlePlannerWarmAndBuild(data,opts){
  if(_idlePlannerRefreshTimer != null)return;
  const run = ()=>{
    _idlePlannerRefreshTimer = null;
    // Warm is fire-and-forget and exact-mode only — never block the replan
    // behind a GLPK compile (especially in fast mode).
    const exact = Boolean(
      (typeof sortSettings !== 'undefined' && sortSettings && sortSettings.agendaOptimizer)
      && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())
    );
    if(exact && typeof warmAgendaPlannerWorker === 'function'){
      void warmAgendaPlannerWorker();
    }
    queueOptimizedHomeRender(typeof load === 'function' ? load() : data,{
      ...(opts || {}),
      __backgroundRefresh:true,
      __fromIdleRefresh:true,
      __skipFreshnessGate:true,
      __forceReplan:true
    });
  };
  if(typeof requestIdleCallback === 'function'){
    _idlePlannerRefreshTimer = requestIdleCallback(run,{timeout:200});
  }else{
    _idlePlannerRefreshTimer = setTimeout(run,50);
  }
}

function queueOptimizedHomeRender(data,opts){
  plannerPerfMark('planner-queue-start');
  const key = optimizerHomeStateKey(data);
  const dirtyKey = homePlannerDirtyKey(data);
  const exactMode = Boolean(sortSettings && sortSettings.agendaOptimizer);
  const refinementKey = `${dateKey(Date.now())}\n${dirtyKey}`;
  // A real edit/location change invalidates an in-flight refinement. Kill the
  // old worker so the new foreground plan never queues behind up to 30 seconds
  // of obsolete work. Merely crossing a minute keeps the same dirty revision.
  if(_optimizerHomeRefinementKey && _optimizerHomeRefinementKey !== refinementKey){
    ++_optimizerHomeRefinementToken;
    _optimizerHomeRefinementKey = '';
    if(typeof cancelAgendaPlannerWorkerRequests === 'function'){
      cancelAgendaPlannerWorkerRequests('planner state changed during refinement');
    }
  }
  if(_optimizerHomeReadyKey === key && _optimizerHomeReadyWeek){
    if(opts && opts.__backgroundRefresh
      && homeAgendaPlanSignature(_homeRenderedWeek,data) === homeAgendaPlanSignature(_optimizerHomeReadyWeek,data)){
      _homeRenderedWeek = _optimizerHomeReadyWeek;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(data,_homeRenderedWeek);
      _homeListFingerprint = homeListFingerprint();
      return false;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:_optimizerHomeReadyWeek});
    _homeListFingerprint = homeListFingerprint();
    return true;
  }
  // Background tick: dirty key unchanged → skip the worker entirely.
  // Forced reopen (hidden ≥60s) still replans; may use day0Only when dirty matches.
  if(opts && opts.__backgroundRefresh && !opts.__forceReplan
    && _optimizerHomeReadyDirtyKey
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek){
    _homeListFingerprint = homeListFingerprint();
    return false;
  }
  if(_optimizerHomeRequestKey === key){
    // Request de-dupe must not swallow a foreground presentation change made
    // while that solve is active. Repaint from the stable mounted plan; do not
    // start or publish another scheduling result.
    if(!(opts && opts.__backgroundRefresh)
      && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
      render({...opts,__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
      _homeListFingerprint = homeListFingerprint();
      return true;
    }
    return false;
  }
  // A save/log/add can invalidate an exact solve that is still running. Do not
  // queue the user's new plan behind obsolete work: terminate it and let this
  // foreground request start a fresh solve.
  if(_optimizerHomeRequestKey && _optimizerHomeRequestKey !== key
    && (!(opts && opts.__backgroundRefresh) || (opts && opts.__locationChanged))){
    ++_optimizerHomeRequestToken;
    _optimizerHomeRequestKey = '';
    if(typeof cancelAgendaPlannerWorkerRequests === 'function'){
      cancelAgendaPlannerWorkerRequests('planner state changed during solve');
    }
  }

  // Background refreshes keep the current DOM. Direct/cold renders use the
  // latest compatible plan, avoiding both a blank launch and reordered phases.
  let paintedFromFreshCache = false;
  if(!(opts && opts.__backgroundRefresh)){
    plannerPerfMark('planner-cache-read');
    const cached = cachedHomeAgenda(data);
    if(cached){
      render({...opts,__fromOptimizer:true,__optimizedWeek:cached});
      paintedFromFreshCache = !(opts && opts.__skipFreshnessGate) && homeAgendaCacheIsFresh(data);
    }else if(_homeRenderedWeek && $('list')?.querySelector('.ting-card')){
      // A done/log/add render keeps the existing agenda mounted. The action has
      // already been persisted; replace the agenda only when its new solve is
      // ready instead of flashing an unplanned intermediate list.
    }else if(!$('list')?.querySelector('.home-loading')){
      // No compatible agenda exists to keep mounted. Stay in the intentional
      // boot animation until planning resolves instead of flashing an unordered
      // due-list between two planned states.
      showHomeAgendaLoading();
    }
    // Cold open with no cache keeps the HTML skeleton until the worker result.
    _homeListFingerprint = homeListFingerprint();
    plannerPerfMark('planner-first-paint');
  }

  // Fresh same-day cache: let idle warm+build own the refresh so cold open
  // does not immediately pay a full worker replan.
  if(paintedFromFreshCache && !(opts && opts.__skipFreshnessGate)){
    scheduleIdlePlannerWarmAndBuild(data,opts);
    return true;
  }

  const token = ++_optimizerHomeRequestToken;
  _optimizerHomeRequestKey = key;
  const settings = {...(sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {}))};
  // The planner runs in a Worker, where the page's ephemeral GPS coordinate is
  // intentionally unavailable. Carry only its matched saved-place id across
  // the boundary so a plan requested after "I'm at Walmart" starts there
  // immediately, even before lastKnownLocationId has been persisted.
  const livePlannerLocationId = typeof liveLocationId === 'function' ? liveLocationId() : null;
  if(livePlannerLocationId)settings._plannerLiveLocationId = livePlannerLocationId;
  const livePlannerCoord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  if(livePlannerCoord && typeof isCurrentCoordAwayFromSaved === 'function'
    && isCurrentCoordAwayFromSaved(settings.locations)){
    settings._plannerCurrentCoord = {lat:livePlannerCoord.lat,lng:livePlannerCoord.lng};
  }
  const day0Only = Boolean(
    opts && opts.__forceReplan
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek
  );
  const buildOpts = {dirtyKey,day0Only};
  const optimizerBuild = typeof buildWeekAgendaOffMain === 'function'
    ? buildWeekAgendaOffMain(data,settings,7,exactMode ? 'exact' : 'fast',buildOpts)
    : buildWeekAgendaAsync(data,settings,7,buildOpts);
  // Keep the intentional cold-open animation, but never indefinitely. If a
  // phone's Worker/WASM bring-up stalls, reveal the usable grouped list after
  // a bounded wait; the exact result still replaces it when it arrives.
  const coldBootTimer = $('list')?.querySelector('.home-loading')
    ? setTimeout(()=>{
        if(token !== _optimizerHomeRequestToken)return;
        if($('list')?.querySelector('.home-loading'))render({...opts,deferAgenda:true});
      },HOME_COLD_BOOT_SKELETON_MAX_MS)
    : null;
  void optimizerBuild.then(week=>{
    if(coldBootTimer != null)clearTimeout(coldBootTimer);
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    const live = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : null);
    if(!live)return;
    if(key !== optimizerHomeStateKey(load())){
      if(opts && opts.__backgroundRefresh)queueOptimizedHomeRender(load(),opts);
      else render(opts);
      return;
    }
    if(!week || !Array.isArray(week.days))return;
    const liveData = load();
    // Worker posts a lean week (no `h`). Re-attach before any consumer reads names.
    if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,liveData);
    // In exact mode a timed-out solve returns the heuristic fallback. A cached
    // planned week can stay mounted; on a first-ever load, use that fallback
    // rather than leaving the user on the unplanned basic list.
    if(exactMode && !week.optimized){
      if(!_homeRenderedWeek){
        render({...opts,__fromOptimizer:true,__optimizedWeek:week});
        // Rendering may persist automatic chunk plans and bump the planner
        // revision. Cache only after those writes so the record is not stale
        // the instant it is created.
        saveHomeAgendaCache(load(),week);
        _homeListFingerprint = homeListFingerprint();
      }
      return;
    }
    _optimizerHomeReadyWeek = week;
    if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
      _homeRenderedWeek = week;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
      const stableData = load();
      _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
      _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
      saveHomeAgendaCache(stableData,week);
      _homeListFingerprint = homeListFingerprint();
      if(exactMode)scheduleHomeAgendaRefinement(stableData,settings,week);
      if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
      return;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:week});
    const stableData = load();
    // Rendering can persist automatic chunk plans. Claim/cache the state after
    // that revision bump so a background tick or location refresh does not
    // immediately launch the same solve again.
    _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
    _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
    saveHomeAgendaCache(stableData,week);
    _homeListFingerprint = homeListFingerprint();
    if(exactMode)scheduleHomeAgendaRefinement(stableData,settings,week);
    if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
  }).catch(()=>{
    if(coldBootTimer != null)clearTimeout(coldBootTimer);
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    // Keep the fast planner already on screen. A cold open still sitting on
    // the skeleton animation gets the basic list instead of loading forever.
    // (If the skeleton behavior is disabled above, this guard never fires:
    // the deferAgenda paint has already replaced the skeleton.)
    if($('list')?.querySelector('.home-loading'))render({...opts,deferAgenda:true});
  });
  return true;
}

// Immediate feedback for a saved travel override. The optimized replan still
// runs, but the tapped edge shows its edited value while GLPK is working.
function markHomeTravelEdgeEdited(fromId,toId,minutes){
  const mins = Math.max(1,Math.round(Number(minutes) || 1));
  document.querySelectorAll('#list .travel-card').forEach(card=>{
    const sameEdge = (card.dataset.travelFrom === fromId && card.dataset.travelTo === toId)
      || (card.dataset.travelFrom === toId && card.dataset.travelTo === fromId);
    if(!sameEdge)return;
    card.classList.add('is-edited');
    const copy = card.querySelector('span');
    if(copy)copy.textContent = copy.textContent.replace(/\b\d+\s+min\b/,`${mins} min`);
    if(!card.querySelector('.travel-edit-mark')){
      const icon = document.createElement('i');
      icon.className = 'ti ti-pencil travel-edit-mark';
      icon.setAttribute('aria-hidden','true');
      card.appendChild(icon);
    }
  });
}

// RENDER: sync home list only when the freshness key moved. Background paths
// (travel refresh, while-open loop, quiet location updates) should call this
// instead of render() so an unchanged agenda never rebuilds the DOM.
function renderHomeIfChanged(force,opts = {}){
  const fp = homeListFingerprint();
  if(!force && fp === _homeListFingerprint)return false;
  const data = load();
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const canCompareWeek = Boolean(
    _homeRenderedWeek
    && Array.isArray(_homeRenderedWeek.days)
    && settings
    && settings.preset === 'todayFirst'
    && weekOnHomeEnabled(settings)
    && !(typeof searchQuery === 'string' && searchQuery.trim())
  );

  if(canCompareWeek){
    // Claim this state before starting work so a travel burst or visibility
    // event cannot enqueue the same recalculation repeatedly.
    _homeListFingerprint = fp;
    if(settings.agendaOptimizer && typeof buildWeekAgendaAsync === 'function'){
      queueOptimizedHomeRender(data,{
        __backgroundRefresh:true,
        __forceReplan:Boolean(force),
        __locationChanged:Boolean(opts.locationChanged)
      });
      return true;
    }
    if(!settings.agendaOptimizer && typeof buildWeekAgendaOffMain === 'function'){
      const token = ++_fastHomeRefreshToken;
      const requestedFingerprint = fp;
      const settingsSnapshot = {...settings};
      void buildWeekAgendaOffMain(data,settingsSnapshot,7,'fast').then(week=>{
        if(token !== _fastHomeRefreshToken || !week || !Array.isArray(week.days))return;
        const liveData = load();
        // A real edit/location update arrived while the worker was planning.
        // Discard this stale result and let the latest state schedule its own.
        if(requestedFingerprint !== homeListFingerprint()){
          renderHomeIfChanged();
          return;
        }
        if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
          _homeRenderedWeek = week;
          if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
          _homeListFingerprint = homeListFingerprint();
          return;
        }
        render({__fromBackgroundRefresh:true,__optimizedWeek:week});
        _homeListFingerprint = homeListFingerprint();
      }).catch(()=>{
        if(token !== _fastHomeRefreshToken)return;
        // Workers are widely available in the supported browsers. If creation
        // is blocked, keep the current plan instead of freezing touch input
        // with the old synchronous comparison path.
      });
      return true;
    }
  }
  const didRender = render();
  if(didRender !== false)_homeListFingerprint = homeListFingerprint();
  return true;
}

// Compat alias — progressive two-phase paint was retired because phase-1 order
// differed from agenda order and caused visible flicker. Callers that still
// name renderProgressive get a single sync render.
