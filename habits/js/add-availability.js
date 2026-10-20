// Add stays a single action. Fixed clocks get a cheap overlap note; the more
// expensive week preview runs only when requested, using the ordinary planner.
let _addRoomRun = null;
let _addRoomSignature = '';
let _addFixedSignature = '';

function addNextDay(ts,offset = 1){
  const day = new Date(ts);
  day.setDate(day.getDate() + offset);
  day.setHours(0,0,0,0);
  return day.getTime();
}

// Fixed-start breakables reserve their first minimum session, exactly as the
// planner does. Later chunks may move. Include adjacent dates for overnight
// appointments and use the shared busy-time cancellation/override resolver.
function addFixedConflict(record,data,settings){
  if(record.type !== 'task' || record.eventTime == null)return null;
  const start = record.eventTime;
  const end = start + scheduledEventDuration({h:record,eventTime:start,breakableStart:record.breakable}) * 60000;
  const firstDay = dayStart(start);
  for(let day = addNextDay(firstDay,-1);day < end;day = addNextDay(day)){
    const nextDay = addNextDay(day);
    if(day >= firstDay){
      const block = agendaBlockedIntervals(dateKey(day),settings,day,nextDay)
        .find(row=>row.start < end && row.end > start);
      if(block)return {name:block.label || 'busy time',start:block.start,end:block.end};
    }
    const event = collectScheduledAgendaEvents(data,dateKey(day),settings).find(row=>{
      const eventEnd = row.eventTime + scheduledEventDuration(row) * 60000;
      return row.eventTime < end && eventEnd > start;
    });
    if(event)return {name:event.h.name,start:event.eventTime,end:event.eventTime + scheduledEventDuration(event) * 60000};
  }
  return null;
}

function addRoomSignature(record = readAddRecord(),plannerKey = homePlannerDirtyKey([])){
  // createdAt is read anew; it must not make an unchanged draft look edited.
  const {createdAt,...draft} = record;
  return JSON.stringify([draft,plannerKey,Math.floor(Date.now() / 60000)]);
}

function stopAddRoomCheck(){
  if(_addRoomRun){
    _addRoomRun.worker?.terminate();
    _addRoomRun.cancel?.();
    _addRoomRun = null;
  }
  $('add-check-room').disabled = false;
  $('add-check-room').textContent = 'preview schedule';
}

function showAddRoomResult(text,tone = ''){
  const result = $('add-room-result');
  result.textContent = text;
  result.dataset.tone = tone;
  result.hidden = !text;
}

function refreshAddAvailability(){
  // Some callers open a sheet solely to inspect its controls, before a fresh
  // creation profile exists. There is no draft to check until defaults apply.
  if(!addActiveDefaults)return;
  const record = readAddRecord();
  const optional = isOpportunityHabit(record);
  const hasTrigger = record.conditionTrigger === 'location' ? record.locationIds.length>0 : weatherHabitHasActiveGuidance(record,sortSettings);
  const needsCity = optional && hasTrigger && !record.locationIds.length && !record.weatherLocationId
    && !weatherHomeCoords(sortSettings);
  $('ting-weather-city').hidden = !needsCity;
  $('add-condition-hint').textContent = typeof opportunitySetupHint === 'function'
    ? opportunitySetupHint(hasTrigger, needsCity)
    : '';
  if(typeof syncOpportunityAnywhereChip === 'function')syncOpportunityAnywhereChip('ting-tag-chips');
  $('add-condition-hint').hidden = !optional || (hasTrigger && !needsCity);
  $('do-save').disabled = optional && !hasTrigger;
  const plannerKey = homePlannerDirtyKey([]);
  const signature = addRoomSignature(record,plannerKey);
  if(signature !== _addRoomSignature){
    stopAddRoomCheck();
    showAddRoomResult('');
    _addRoomSignature = signature;
  }
  // Name/emoji typing must not repeatedly normalize the saved history just
  // to rediscover the same clock overlap.
  const fixedSignature = JSON.stringify([record.type,record.eventTime,record.durationMinutes,
    record.breakable,record.minChunkMinutes,plannerKey]);
  if(fixedSignature === _addFixedSignature)return;
  _addFixedSignature = fixedSignature;
  const note = $('add-conflict-note');
  const fixed = record.type === 'task' && record.eventTime != null
    ? addFixedConflict(record,load(),loadSortSettings()) : null;
  note.textContent = fixed
    ? `Overlaps ${fixed.name}. ${record.breakable ? 'The first session needs this time.' : 'This start time is fixed.'} You can still add it.`
    : '';
  note.hidden = !fixed;
}

function addRoomMinutes(week){
  const minutes = new Map();
  for(const day of week?.days || []){
    for(const row of day.timeline || []){
      if(!['fill','scheduled'].includes(row.kind) || row.i == null)continue;
      minutes.set(row.i,(minutes.get(row.i) || 0) + Math.max(0,Math.round((row.end - row.start) / 60000)));
    }
  }
  return minutes;
}

function addRoomPreviewCopy(before,after,data,record){
  const minutes = addRoomMinutes(after);
  const draftMinutes = minutes.get(data.length) || 0;
  const lost = [...addRoomMinutes(before)].filter(([i,total])=>(minutes.get(i) || 0) < total)
    .map(([i])=>data[i]?.name).filter(Boolean);
  if(!draftMinutes)return isOpportunityHabit(record)
    ? {tone:'',text:'Nothing fits in the next 7 days. It waits until you’re at the place, or the weather matches.'}
    : {tone:'warning',text:'No room found in the next 7 days with these settings. You can still add it and adjust its schedule in details.'};
  const days = (after.days || []).filter(day=>(day.timeline || []).some(row=>row.i === data.length && ['fill','scheduled'].includes(row.kind))).length;
  const partial = record.type === 'task' && draftMinutes < record.durationMinutes;
  const preview = `Preview: ${formatFreeDuration(draftMinutes)}${partial ? ` of ${formatFreeDuration(record.durationMinutes)}` : ''} across ${days === 1 ? '1 day' : `${days} days`} in the next 7 days.`;
  const impact = lost.length ? ` ${lost.slice(0,2).join(' and ')}${lost.length > 2 ? ` and ${lost.length - 2} more` : ''} may lose planned time.` : '';
  return {tone:lost.length || partial ? 'warning' : '',text:`${preview}${impact} ${partial || lost.length ? 'You can still add it.' : 'Times may change when you save.'}`};
}

// A separate instance of the existing worker keeps draft checks out of the
// home/refinement queue. Terminating it on edit never cancels the real agenda.
function addRoomWorkerWeek(run,data,settings,mode,id){
  return new Promise((resolve,reject)=>{
    const finish = (error,week)=>{
      clearTimeout(timer);
      run.worker.removeEventListener('message',onMessage);
      run.worker.removeEventListener('error',onError);
      run.cancel = null;
      if(error)reject(error);else resolve(week);
    };
    const onMessage = event=>{
      if(event.data?.id !== id)return;
      finish(event.data.error ? new Error(event.data.error) : null,event.data.week);
    };
    const onError = ()=>finish(new Error('room check unavailable'));
    const timer = setTimeout(()=>finish(new Error('room check timed out')),AGENDA_PLANNER_WORKER_REQUEST_TIMEOUT_MS);
    run.cancel = ()=>finish(new Error('draft changed'));
    run.worker.addEventListener('message',onMessage);
    run.worker.addEventListener('error',onError);
    try{
      run.worker.postMessage({id,data,settings,numDays:7,mode,storage:plannerWorkerStorageSnapshot()});
    }catch(error){finish(error);}
  });
}

async function checkAddRoom(){
  refreshAddAvailability();
  const record = readAddRecord();
  const settings = {...(sortSettings || loadSortSettings())};
  if(record.type === 'zero' || record.type === 'reduce'){
    showAddRoomResult('This kind tracks a limit rather than reserving time.');
    return;
  }
  if(record.type === 'task' && record.dueDate == null){
    showAddRoomResult('Add a due date or start time to check room.');
    return;
  }
  if(record.type === 'task' && dayStart(record.dueDate) >= addNextDay(dayStart(Date.now()),7)){
    showAddRoomResult('Room previews cover the next 7 days. Fixed-time overlaps are still checked on your chosen date.');
    return;
  }
  const data = load();
  const fixed = addFixedConflict(record,data,settings);
  if(fixed){
    showAddRoomResult(`Overlaps ${fixed.name}. Change the start time or add it as planned.`, 'warning');
    return;
  }
  const run = {signature:addRoomSignature(record),worker:null,cancel:null};
  stopAddRoomCheck();
  _addRoomRun = run;
  $('add-check-room').disabled = true;
  $('add-check-room').textContent = 'checking…';
  showAddRoomResult('Checking the next 7 days. You can keep editing or add now.');
  try{
    if(!agendaPlannerWorkerAvailable())throw new Error('worker unavailable');
    run.worker = new Worker(`./js/agenda-planner-worker.js?${AGENDA_PLANNER_WORKER_ASSET_VERSION}`);
    const place = liveLocationId();
    if(place)settings._plannerLiveLocationId = place;
    const coord = currentCoordLocation();
    if(coord)settings._plannerCurrentCoord = {lat:coord.lat,lng:coord.lng};
    const mode = settings.agendaOptimizer && !agendaPlannerForcedFast() ? 'exact' : 'fast';
    const before = await addRoomWorkerWeek(run,data,settings,mode,1);
    if(_addRoomRun !== run)return;
    const draft = {...record,hid:generateHabitId(),name:record.name || 'New item'};
    const after = await addRoomWorkerWeek(run,[...data,draft],settings,mode,2);
    if(_addRoomRun !== run || !$('add-sheet').classList.contains('open'))return;
    if(run.signature !== addRoomSignature()){
      showAddRoomResult('Your draft or schedule changed. Check room again for an updated preview.');
      return;
    }
    const result = addRoomPreviewCopy(before,after,data,record);
    showAddRoomResult(result.text,result.tone);
  }catch(_){
    if(_addRoomRun === run)showAddRoomResult('Couldn’t check room right now. You can still add it.');
  }finally{
    if(_addRoomRun === run)stopAddRoomCheck();
  }
}

$('add-check-room').addEventListener('click',()=>void checkAddRoom());
for(const event of ['input','change','click']){
  $('add-sheet').addEventListener(event,e=>{
    if(e.target.closest('#add-check-room'))return;
    // Run after the existing type/place/splitting handlers update the draft.
    queueMicrotask(refreshAddAvailability);
  });
}
new MutationObserver(()=>{
  if(!$('add-sheet').classList.contains('open'))stopAddRoomCheck();
  else refreshAddAvailability();
}).observe($('add-sheet'),{attributes:true,attributeFilter:['class']});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopAddRoomCheck();showAddRoomResult('');}
});
