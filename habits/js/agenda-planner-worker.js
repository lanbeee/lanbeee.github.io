// Planner execution boundary. All expensive week construction happens in this
// dedicated worker so refreshes cannot block scrolling or settings controls.

const plannerStore = new Map();
self.localStorage = {
  getItem(key){
    return plannerStore.has(String(key)) ? plannerStore.get(String(key)) : null;
  },
  setItem(key,value){
    plannerStore.set(String(key),String(value));
  },
  removeItem(key){
    plannerStore.delete(String(key));
  },
  clear(){
    plannerStore.clear();
  },
  key(index){
    return [...plannerStore.keys()][index] ?? null;
  },
  get length(){
    return plannerStore.size;
  }
};

importScripts(
  './config.js',
  './storage.js',
  '../lib/js/adhan.umd.min.js',
  './data.js',
  './locations.js',
  './prayer-times.js',
  './scoring.js'
);

// These three pure helpers normally live in detail-view.js. Loading that UI
// module in a worker would also load its DOM wiring, so keep the tiny planner
// dependency here instead.
function hasPlannedEntryForDay(h,key){
  return plannedLogs(h.logs).some(ts=>dateKey(ts) === key);
}

function hasScheduledMarkerForDay(h,key){
  if(typeof habitPlanMarkers === 'function'){
    return habitPlanMarkers(h).some(marker=>dateKey(marker.ts) === key);
  }
  return (
    (isTimedTask(h) && h.lastLog === null && dateKey(h.eventTime) === key)
    || (h.type === 'task' && h.eventTime === null && h.dueDate !== null
      && h.lastLog === null && dateKey(h.dueDate) === key)
    || ((h.type === 'keepup' || h.type === 'reduce') && h.planByDate
      && dateKey(h.planByDate) === key)
  );
}

function hasPlannedToday(h){
  const today = dateKey(Date.now());
  return hasPlannedEntryForDay(h,today) || hasScheduledMarkerForDay(h,today);
}

function nextPlannedLog(h){
  return plannedLogs(h.logs)[0] || null;
}

function progressScore(h){
  if(h.type === 'task'){
    if(h.breakable && h.lastLog !== null){
      const total = clampDuration(h.durationMinutes);
      const done = loggedChunkMinutes(h);
      if(total <= 0)return 100;
      return Math.max(0,Math.min(100,Math.round((done / total) * 100)));
    }
    if(h.lastLog !== null)return 100;
    const when = taskWhen(h);
    if(when === null)return null;
    const left = daysUntil(when);
    if(left === null)return null;
    const windowDays = Math.max(1,h.flexibilityDays || 3);
    if(left <= 0)return Math.max(0,Math.round(30 - Math.min(30,Math.abs(left) * 6)));
    return Math.round(Math.min(100,100 - (left / windowDays) * 50));
  }
  const days = daysSince(h.lastLog);
  if(days === null || days < 0)return null;
  const target = effectiveTarget(h);
  if(h.type === 'keepup'){
    if(days <= target * 0.75)return 100;
    if(days <= target)return Math.round(100 - ((days / target - 0.75) / 0.25) * 25);
    if(days <= target * 1.35)return Math.round(74 - ((days / target - 1) / 0.35) * 29);
    return Math.max(0,Math.round(44 - Math.min(1,(days / target - 1.35) / 0.65) * 44));
  }
  if(h.type === 'reduce'){
    if(days >= target)return Math.min(100,Math.round(75 + Math.min(1,(days / target - 1) / 0.75) * 25));
    if(days >= target * 0.65)return Math.round(45 + ((days / target - 0.65) / 0.35) * 29);
    return Math.max(0,Math.round((days / (target * 0.65)) * 44));
  }
  if(days >= 14)return Math.min(100,Math.round(75 + Math.min(1,(days - 14) / 16) * 25));
  if(days >= 4)return Math.round(45 + ((days - 4) / 10) * 29);
  return Math.max(0,Math.round((days / 4) * 44));
}

function intervalValues(h,limit = null){
  const logs = actualLogs(h.logs);
  if(!logs.length)return [];
  const intervals = [];
  for(let i = 1;i < logs.length;i += 1){
    intervals.push(Math.max(1,Math.round((logs[i] - logs[i - 1]) / 86400000)));
  }
  intervals.push(Math.max(1,daysSince(logs[logs.length - 1]) || 1));
  return limit ? intervals.slice(-limit) : intervals;
}

function intervalToneSummary(h){
  const intervals = intervalValues(h,14);
  if(!intervals.length)return {hit:0,warn:0,miss:0,label:'no gap history'};
  const counts = intervals.reduce((acc,days)=>{
    const cls = intervalTone(h,days) || 'miss';
    acc[cls] = (acc[cls] || 0) + 1;
    return acc;
  },{hit:0,warn:0,miss:0});
  const total = intervals.length || 1;
  const hit = Math.round(counts.hit / total * 100);
  const warn = Math.round(counts.warn / total * 100);
  const miss = Math.max(0,100 - hit - warn);
  const label = counts.hit >= counts.warn + counts.miss
    ? 'mostly good'
    : counts.miss > counts.hit ? 'needs care' : 'mixed';
  return {hit,warn,miss,label};
}

importScripts(
  './agenda-order.js',
  './today-view.js',
  './agenda-optimizer.js'
);

let plannerQueue = Promise.resolve();
let _workerGlpkWarmed = false;

function stripWeekHabitRefs(week){
  if(typeof leanAgendaWeek === 'function')return leanAgendaWeek(week);
  if(!week || !Array.isArray(week.days))return week;
  const strip = row=>{
    if(!row || typeof row !== 'object')return row;
    const out = {...row};
    delete out.h;
    return out;
  };
  return {
    ...week,
    days:week.days.map(day=>({
      ...day,
      timeline:Array.isArray(day.timeline) ? day.timeline.map(strip) : day.timeline,
      agendaItems:Array.isArray(day.agendaItems) ? day.agendaItems.map(strip) : day.agendaItems
    })),
    __lean:true
  };
}

async function runPlannerMessage(message){
  const id = message.id;
  try{
    if(message.warm){
      if(!_workerGlpkWarmed && typeof ensureGlpk === 'function'){
        try{
          if(typeof withTimeout === 'function'){
            await withTimeout(ensureGlpk(),AGENDA_OPTIMIZER_LOAD_TIMEOUT_MS);
          }else{
            await ensureGlpk();
          }
          _workerGlpkWarmed = true;
        }catch(_){}
      }
      self.postMessage({id,ready:true});
      return;
    }

    plannerStore.clear();
    for(const [key,value] of Object.entries(message.storage || {})){
      plannerStore.set(String(key),String(value));
    }
    Storage.write(KEY,Array.isArray(message.data) ? message.data : []);
    Storage.write(SORT_SETTINGS_KEY,message.settings || {});
    sortSettings = loadSortSettings();
    // Raw GPS coordinates are normally page-local. Receive an ephemeral copy
    // for this one solve so a user near (but outside the geofence of) a saved
    // place begins from "here" instead of lastKnownLocationId. Never persist it.
    if(typeof setPlannerCurrentCoord === 'function'){
      setPlannerCurrentCoord(sortSettings._plannerCurrentCoord || null);
    }

    const count = Math.max(1,Math.min(14,Math.round(message.numDays) || 7));
    const buildOpts = {
      dirtyKey:message.dirtyKey || '',
      day0Only:Boolean(message.day0Only)
    };
    const data = load();
    const week = message.mode === 'exact' && typeof buildWeekAgendaAsync === 'function'
      ? await buildWeekAgendaAsync(data,sortSettings,count,buildOpts)
      : buildWeekAgenda(data,sortSettings,count,buildOpts);
    self.postMessage({id,week:stripWeekHabitRefs(week)});
  }catch(error){
    self.postMessage({
      id,
      error:error && error.message ? error.message : String(error)
    });
  }
}

self.addEventListener('message',event=>{
  // GLPK yields while its nested solve worker runs. Serialize messages so a
  // newer request cannot replace the storage/settings globals underneath an
  // older in-flight build.
  const message = event.data || {};
  plannerQueue = plannerQueue.then(()=>runPlannerMessage(message));
});
