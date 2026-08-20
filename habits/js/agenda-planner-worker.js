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
  './data-schemas.js',
  './data-storage.js',
  './data-normalize.js',
  './data-backup.js',
  './data-planner-state.js',
  './data-primitives.js',
  './data-locations.js',
  './data-retention.js',
  './data-logs.js',
  './data-schedules.js',
  './data-format.js',
  './locations.js',
  './prayer-times.js',
  './scoring.js'
);

importScripts(
  './agenda-order.js',
  './today-view-fits.js',
  './today-view-reservations.js',
  './today-view-week.js',
  './today-view-today.js',
  './agenda-optimizer.js',
  './agenda-optimizer-ilp.js'
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
    const requestSettings = message.settings && typeof message.settings === 'object'
      ? message.settings : {};
    const requestCurrentCoord = requestSettings._plannerCurrentCoord || null;
    const requestLiveLocationId = requestSettings._plannerLiveLocationId || null;
    const persistedSettings = {...requestSettings};
    delete persistedSettings._plannerCurrentCoord;
    delete persistedSettings._plannerLiveLocationId;
    Storage.write(SORT_SETTINGS_KEY,persistedSettings);
    sortSettings = loadSortSettings();
    if(requestLiveLocationId)sortSettings._plannerLiveLocationId = requestLiveLocationId;
    // Raw GPS coordinates are normally page-local. Receive an ephemeral copy
    // for this one solve so a user near (but outside the geofence of) a saved
    // place begins from "here" instead of lastKnownLocationId. Never persist it.
    if(typeof setPlannerCurrentCoord === 'function'){
      setPlannerCurrentCoord(requestCurrentCoord);
    }

    const count = Math.max(1,Math.min(14,Math.round(message.numDays) || 7));
    const buildOpts = {
      dirtyKey:message.dirtyKey || '',
      day0Only:Boolean(message.day0Only),
      refine:Boolean(message.refine),
      refineBudgetMs:Math.max(0,Math.round(Number(message.refineBudgetMs) || 0))
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
