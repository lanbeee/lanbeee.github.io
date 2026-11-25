// Shared by live GPS and the native headless runner. Coordinates stay out of logs.
const LOCATION_VISIT_STATE_KEY = 'tings_location_visits_v1';
const LOCATION_VISIT_EPOCH_KEY = 'tings_location_visit_epoch_v1';

function locationVisitEpoch(){
  let epoch = localStorage.getItem(LOCATION_VISIT_EPOCH_KEY);
  if(!/^[0-9a-f]{32}$/.test(epoch || '')){
    epoch = locationVisitOperationId();
    localStorage.setItem(LOCATION_VISIT_EPOCH_KEY,epoch);
  }
  return epoch;
}

function locationVisitSupported(h){
  return Boolean(h && ['keepup','task'].includes(h.type) && !h.breakable && !h.trackValue
    && !isEventItem(h) && !isOpportunityHabit(h));
}

function locationVisitState(){
  try{
    const stored = JSON.parse(localStorage.getItem(LOCATION_VISIT_STATE_KEY));
    if(!stored || typeof stored !== 'object' || Array.isArray(stored))return {};
    return Object.fromEntries(Object.entries(stored).filter(([,stay])=>stay
      && /^[0-9a-f]{32}$/.test(stay.id || '') && Array.isArray(stay.credited)));
  }catch{return {};}
}

function locationVisitOperationId(){
  return crypto.randomUUID().replace(/-/g,'');
}

// A whole uncertainty circle must fit inside one saved fence. Exit uses a
// wider boundary so an imprecise fix cannot manufacture another visit.
function observeLocationVisit(fix,settings,state,now = Date.now()){
  if(!settings.locationOptIn || !fix || !Number.isFinite(fix.at)
    || now - fix.at > 120000 || fix.at > now + 5000
    || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100
    || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng))return null;
  const places = normalizeLocationRegistry(settings.locations);
  for(const id of Object.keys(state)){
    const place = places.find(p=>p.id === id);
    if(!place){delete state[id];continue;}
    const distance = haversineMetres(fix.lat,fix.lng,place.lat,place.lng);
    if(distance - fix.accuracy > (place.radiusM || DEFAULT_LOCATION_RADIUS_M) + 30)delete state[id];
  }
  const matches = places.filter(place=>haversineMetres(fix.lat,fix.lng,place.lat,place.lng)
    + fix.accuracy <= (place.radiusM || DEFAULT_LOCATION_RADIUS_M));
  if(matches.length !== 1)return null;
  const place = matches[0];
  if(!state[place.id])state[place.id] = {id:locationVisitOperationId(),credited:[]};
  return {place,stay:state[place.id],at:fix.at};
}

// Evaluate each explicit place rule independently. The general Anywhere
// fallback must never turn a detected saved place into completion permission.
function locationVisitEligibility(h,place,at,settings){
  if(!h.autoCompleteOnVisit || !locationVisitSupported(h) || habitIsSnoozed(h,at)
    || (typeof replicaDeviceBlocksCompletion === 'function' && replicaDeviceBlocksCompletion(h.hid))
    || (h.type === 'task' && isTaskDone(h)))return null;
  if(normalizeLogs(h.logs).some(log=>!isPlanLog(log) && logTime(log) > at))return null;
  const base = dayStart(at);
  if(completedOnDay(h,base))return null;
  const actualToday = normalizeLogs(h.logs).filter(log=>!isPlanLog(log)
    && dateKey(logTime(log)) === dateKey(at) && logTime(log) <= at).length;
  if(h.type !== 'task' && actualToday >= habitOccurrenceTargetForDay(h,base))return null;
  const reference = latestActualLog(h.logs) ?? h.lastLog;
  let due = h.type === 'task' ? h.dueDate : habitPlanByDate(h);
  if(h.type !== 'task' && due == null && reference != null){
    due = Number(h.target) <= 1 ? base : offsetCalendarDay(reference,rhythmCadenceGapDays(h));
  }
  if(reference != null && Number(h.minGapMinutes) > 0 && at - reference < h.minGapMinutes * 60000)return null;
  if(due == null)due = base;
  due = dayStart(due);
  if(base < offsetCalendarDay(due,-habitEarlyWindowDays(h)) || habitIsSnoozedOnDay(h,due,at))return null;
  const variants = [];
  const explicitGeneral = normalizeLocationIds(h.locationIds,settings.locations).includes(place.id)
    || (!place.temporary && normalizeLocationTypes(h.locationTypes).some(type=>locationMatchesTypeKey(place,type)));
  if(explicitGeneral && hasGeneralAllowedSchedule(h,settings.locations)){
    variants.push({h:habitBoundToGeneralSchedule(h),id:'general'});
  }
  // Use the same local-day interpretation of overnight windows as the planner.
  for(const option of normalizeHabitScheduleOptions(h.scheduleOptions)){
    if(option.locationId === place.id)variants.push({h:habitBoundToScheduleOption(h,option),id:option.id});
  }
  const hits = [];
  for(const variant of variants){
    if(!isDateEligibleForGeneralSchedule(variant.h,base))continue;
    const windows = effectiveLocationWindow(variant.h,place,new Date(at).getDay(),base);
    const clock = new Date(at);
    const minute = clock.getHours() * 60 + clock.getMinutes() + clock.getSeconds() / 60;
    if(!windows.some(w=>minute >= w.start && minute < w.end))continue;
    if(typeof weatherFitAssessment === 'function'){
      const weatherSettings = {...settings,_weatherContext:settings._weatherContext || weatherPlannerContext(settings)};
      const assessment = weatherFitAssessment({h:variant.h},
        {locId:place.id,placeStart:at,placeEnd:at + 1000},{dayBase:base},weatherSettings);
      if(assessment?.hardFail)continue;
    }
    hits.push(variant);
  }
  if(!hits.length)return null;
  // Separate schedule lanes need an unambiguous lane; ordinary alternatives
  // share the same occurrence and therefore cannot double-credit a visit.
  const separate = hits.filter(v=>v.h._scheduleOptionSameDayMode === 'separate');
  if(separate.length && hits.length > 1)return null;
  const chosen = hits[0];
  const occurrenceDay = h.type !== 'task' && Number(h.target) <= 1 ? base : due;
  let occurrenceKey = separate.length ? `${h.hid}:${dateKey(occurrenceDay)}:${chosen.id}`
    : `${h.hid}:${dateKey(occurrenceDay)}:${habitHasMultipleDailyOccurrences(h) && hasHabitScheduleOptions(h) ? 'ordinary' : 'general'}`;
  if(!hasHabitScheduleOptions(h) && habitDailyOccurrenceTarget(h) > 1){
    const completed = habitCompletedGeneralOccurrenceKeys(h,base);
    occurrenceKey = habitGeneralOccurrenceKeys(h,base).find(key=>!completed.has(key));
  }
  if(!occurrenceKey || normalizeLogs(h.logs).some(log=>!isPlanLog(log) && logOccurrenceKey(log) === occurrenceKey))return null;
  return {occurrenceKey,scheduleOptionId:chosen.id,scheduledDay:dateKey(occurrenceDay)};
}

function locationVisitActions(data,fix,settings,state,now = Date.now()){
  // Do not credit a stay for evidence the completion writer cannot accept yet.
  if(fix?.at > Date.now())return [];
  const visit = observeLocationVisit(fix,settings,state,now);
  if(!visit)return [];
  const actions = [];
  for(const h of data){
    if(visit.stay.credited.includes(h.hid))continue;
    const eligible = locationVisitEligibility(h,visit.place,visit.at,settings);
    if(!eligible)continue;
    const action = {...eligible,id:locationVisitOperationId(),hid:h.hid,at:visit.at,
      dayKey:dateKey(visit.at),source:'location_visit',visitId:visit.stay.id,locationId:visit.place.id,placeSignature:JSON.stringify(visit.place),epoch:locationVisitEpoch()};
    actions.push(action);
    visit.stay.credited.push(h.hid);
  }
  return actions;
}

function applyLocationVisitCompletion(h,action){
  if(!h || !locationVisitSupported(h) || !h.autoCompleteOnVisit || action.epoch !== locationVisitEpoch())return null;
  if(!Number.isFinite(action.at) || action.at > Date.now() || !/^[0-9a-f]{32}$/.test(action.visitId || ''))return null;
  const settings = loadSortSettings();
  const place = normalizeLocationRegistry(settings.locations).find(p=>p.id === action.locationId);
  if(action.placeSignature !== JSON.stringify(place))return null;
  const eligible = place && locationVisitEligibility(h,place,action.at,settings);
  if(!eligible || eligible.occurrenceKey !== action.occurrenceKey)return null;
  const logs = normalizeLogs(h.logs);
  if(logs.some(log=>log.operationId === action.id || log.visitId === action.visitId
    || (!isPlanLog(log) && logOccurrenceKey(log) === action.occurrenceKey))
    || (h.type === 'task' && isTaskDone(h)) || completedOnDay(h,dayStart(action.at)))return null;
  const orderBefore = loadOrderConstraintStore();
  const before = {planByDate:h.planByDate,snoozedUntil:h.snoozedUntil,snoozedDates:h.snoozedDates,
    scheduleLinks:h.scheduleLinks};
  const consumedPlans = logs.filter(log=>isPlanLog(log)
    && dateKey(logTime(log)) === action.scheduledDay
    && (!log.scheduleOptionId || log.scheduleOptionId === action.scheduleOptionId));
  h.logs = logs.filter(log=>!consumedPlans.includes(log));
  const result = recordHabitCompletion(h,{...action,at:action.at,operationId:action.id,preserveTimestamp:true,consumePlan:false});
  const remainingEdges = new Set(loadOrderConstraintStore().edges.map(edge=>edge.id));
  const removedEdges = orderBefore.edges.filter(edge=>!remainingEdges.has(edge.id));
  return {...result,before,consumedPlans,removedEdges};
}

let locationVisitQueue = Promise.resolve();
function queueLocationVisit(pos){
  const fix = {lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,at:pos.timestamp};
  const run = async()=>{
    const data = load(), settings = loadSortSettings(), state = locationVisitState();
    const actions = locationVisitActions(data,fix,settings,state);
    const changes = [];
    for(const action of actions){
      const h = data.find(item=>item.hid === action.hid);
      const result = applyLocationVisitCompletion(h,action);
      if(result)changes.push({hid:h.hid,action,...result});
    }
    if(changes.length && !save(data))return;
    localStorage.setItem(LOCATION_VISIT_STATE_KEY,JSON.stringify(state));
    if(!changes.length)return;
    for(const change of changes){
      const index = data.findIndex(h=>h.hid === change.hid);
      onHabitCompletionSaved(data[index],index);
    }
    showActionToast(`Visit marked ${changes.map(c=>data.find(h=>h.hid === c.hid).name).join(', ')} done`,
      {type:'location-visit',changes,toastOnlyUndo:true});
    if(typeof refreshOpenViews === 'function')refreshOpenViews();
    if(typeof queueNativeBackgroundSnapshot === 'function')queueNativeBackgroundSnapshot();
  };
  locationVisitQueue = locationVisitQueue.catch(()=>{}).then(()=>navigator.locks
    ? navigator.locks.request('tings-location-completion',run) : run());
  return locationVisitQueue;
}

function undoLocationVisit(changes){
  const data = load(), order = loadOrderConstraintStore();
  for(const change of changes){
    const h = data.find(item=>item.hid === change.hid);
    if(!h)continue;
    if(!normalizeLogs(h.logs).some(log=>log.operationId === change.action.id))continue;
    h.logs = normalizeLogs(h.logs).filter(log=>log.operationId !== change.action.id);
    for(const plan of change.consumedPlans){
      if(!h.logs.some(log=>isPlanLog(log) && logTime(log) === logTime(plan)))h.logs.push(plan);
    }
    h.lastLog = latestActualLog(h.logs);
    if(!completedToday(h))for(const edge of change.removedEdges || []){
      const partnerIds = [edge.beforeHid,edge.afterHid];
      const stillExists = partnerIds.every(id=>data.some(item=>item.hid === id));
      const changedAgain = order.edges.some(current=>current.dayBase === edge.dayBase
        && (partnerIds.includes(current.beforeHid) || partnerIds.includes(current.afterHid)));
      if(stillExists && !changedAgain)order.edges.push(edge);
    }
    if(!h.lastLog || h.lastLog <= change.entryTs){
      if(h.planByDate == null)h.planByDate = change.before.planByDate;
      if(!h.snoozedUntil)h.snoozedUntil = change.before.snoozedUntil;
      if(!h.snoozedDates?.length)h.snoozedDates = change.before.snoozedDates;
      if(!h.scheduleLinks?.length)h.scheduleLinks = change.before.scheduleLinks;
    }
  }
  if(!save(data))return false;
  saveOrderConstraintStore(order);
  return true;
}
