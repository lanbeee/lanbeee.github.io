// Shared agenda-to-reminder projection; OS delivery is supplied by the native shell.
// Preferences are device-local and intentionally separate from clone settings.
const NATIVE_REMINDERS_KEY = 'tings_native_reminders_v1';
const NATIVE_REMINDER_DEFAULTS = {version:3,enabled:false,items:{}};
const NATIVE_REMINDER_EDGES = [['start','start'],['end','end'],['travelStart','travel: departure'],['travelEnd','travel: arrival'],['missed','drop warning (15 min)']];
function nativeBusyReminderKey(block,index){
  return block ? `busy:${block.reminderId || JSON.stringify([index,block.label,block.start,block.end,block.days])}` : '';
}
function nativeReminderPreferences(){
  try{
    const saved = JSON.parse(localStorage.getItem(NATIVE_REMINDERS_KEY) || 'null');
    if(!saved)return {...NATIVE_REMINDER_DEFAULTS,items:{}};
    if(saved.version === 3)return {...NATIVE_REMINDER_DEFAULTS,...saved};
    if(saved.version === 2){
      const items=Object.fromEntries(Object.entries(saved.items || {}).map(([owner,choice])=>
        [owner,{...choice,...(choice.missed==='notification' ? {missed:'alarm'} : {})}]));
      const next={...NATIVE_REMINDER_DEFAULTS,...saved,version:3,items};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(next));
      localStorage.setItem('tings_drop_alarm_migration','1');return next;
    }
    // Materialize the old blanket choices once. New items never inherit them.
    const legacy = {taskStart:true,habitStart:true,travelStart:true,...saved};
    const items = {};
    const modes = kind=>Object.fromEntries(NATIVE_REMINDER_EDGES.map(([edge])=>{
      const oldKey = edge.startsWith('travel') ? edge : kind + edge[0].toUpperCase() + edge.slice(1);
      return [edge,legacy[oldKey] ? (legacy.alarmTypes?.[oldKey] ? 'alarm' : 'notification') : 'off'];
    }));
    for(const h of load())items[`item:${h.hid}`] = modes(h.type === 'task' ? 'task' : 'habit');
    normalizeBlockedTimes(sortSettings.blockedTimes).forEach((block,i)=>items[nativeBusyReminderKey(block,i)] = modes('busy'));
    for(const choice of Object.values(items))if(choice.missed==='notification')choice.missed='alarm';
    const next = {version:3,enabled:Boolean(saved.enabled),items};
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(next));return next;
  }catch(_){return {...NATIVE_REMINDER_DEFAULTS,items:{}};}
}
let _nativeDeliveryPrefs={key:'',value:null};
function nativeReminderDeliveryPreferences(data,prefs,now=Date.now()){
  const rev=typeof plannerDataRevision==='function'?plannerDataRevision():(data||[]).length;
  const key=`${rev}\n${dateKey(now)}\n${prefs.enabled}\n${JSON.stringify(prefs.items||{})}`;
  if(_nativeDeliveryPrefs.key===key)return _nativeDeliveryPrefs.value;
  const items={};
  for(const [owner,choices] of Object.entries(prefs.items || {})){
    if(!owner.startsWith('item:')){items[owner]=choices;continue;}
    const h=data.find(h=>`item:${h.hid}`===owner);
    if(!h || h.type==='zero' || (h.type==='task' && isTaskDone(h)))continue;
    const resolvedDays=[];
    const separate=normalizeHabitScheduleOptions(h.scheduleOptions).some(o=>habitScheduleOptionSameDayMode(o)==='separate');
    for(let offset=-7;offset<=7;offset++){
      const day=dayStart(now)+offset*86400000;
      if(!separate && completedOnDay(h,day))resolvedDays.push(dateKey(day));
    }
    const resolvedOccurrences=normalizeLogs(h.logs).filter(log=>!isPlanLog(log)).map(logOccurrenceKey).filter(Boolean);
    items[owner]={...choices,resolvedDays,resolvedOccurrences};
  }
  const value={...prefs,items};
  _nativeDeliveryPrefs={key,value};
  return value;
}
function nativeReminderOwner(row,data,settings,dataById=null){
  if(!row)return '';
  if(row.kind === 'blocked')return nativeBusyReminderKey(normalizeBlockedTimes(settings.blockedTimes)[row.blockIndex],row.blockIndex);
  const hid = row.h?.hid || data[row.i]?.hid;
  return hid && (dataById ? dataById.has(hid) : data.some(h=>h.hid === hid)) ? `item:${hid}` : '';
}
// Give busy times a stable identity without tying reminders to names or list positions.
function nativeEnsureBusyReminderIds(){
  if(!window.TingsNative?.isNative)return;
  const prefs = nativeReminderPreferences();
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  let changed = false;
  blocks.forEach((block,i)=>{
    if(block.reminderId)return;
    const old = nativeBusyReminderKey(block,i);
    block.reminderId = crypto.randomUUID();changed = true;
    if(prefs.items[old]){prefs.items[nativeBusyReminderKey(block,i)] = prefs.items[old];delete prefs.items[old];}
  });
  if(changed){
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
    updateSortSetting({blockedTimes:blocks},{renderNow:false});
  }
}
function nativeItemReminderControls(owner,name,opts = {}){
  const box = document.createElement('div');
  box.className = 'habit-options-block' + (opts.compact ? ' native-busy-reminders' : '');
  const heading = document.createElement('span');heading.className = 'settings-sublabel';heading.textContent = 'phone reminders';box.append(heading);
  const grid = document.createElement('div');grid.className = 'planning-grid' + (opts.compact ? ' native-busy-reminder-grid' : '');
  for(const [edge,title] of NATIVE_REMINDER_EDGES){
    if(edge==='missed' && !owner.startsWith('item:'))continue;
    const label = document.createElement('label');label.className = 'planning-field';label.append(document.createTextNode(title));
    const select = document.createElement('select');select.className = 'mini-select';select.setAttribute('aria-label',`${name}: ${title} reminder`);
    select.dataset.reminderOwner = owner;select.dataset.reminderEdge = edge;
    for(const [value,text] of (edge==='missed' ? [['off','off'],['alarm','ringing alarm']] : [['off','off'],['notification','notification'],['alarm','ringing alarm']])){
      const option = document.createElement('option');option.value = value;option.textContent = text;select.append(option);
    }
    select.value = nativeReminderPreferences().items[owner]?.[edge] || 'off';
    select.addEventListener('change',async ()=>{
      select.disabled = true;
      try{
        if(select.value === 'alarm' && (await window.TingsNative.notifications.exactAlarmPermission()).exact_alarm !== 'granted')
          throw new Error('Allow exact timing in Settings → reminders before choosing a ringing alarm.');
        const prefs = nativeReminderPreferences();
        prefs.items[owner] = {...prefs.items[owner],[edge]:select.value};
        localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
        nativeReminderLastSignature = '';await reconcileNativeReminders();
        showToast(prefs.enabled ? 'phone reminder saved' : 'saved — enable phone reminders in Settings to receive it', 2800);
      }catch(error){select.value = nativeReminderPreferences().items[owner]?.[edge] || 'off';showToast(error.message, 5000);}
      finally{select.disabled = false;}
    });label.append(select);grid.append(label);
  }
  const leadLabel=document.createElement('label');leadLabel.className='planning-field';leadLabel.append(document.createTextNode('departure reminder'));
  const lead=document.createElement('select');lead.className='mini-select';lead.dataset.reminderLead=owner;
  lead.setAttribute('aria-label',`${name}: departure reminder lead time`);
  for(const minutes of [0,5,10,15,30,60]){
    const option=document.createElement('option');option.value=String(minutes);option.textContent=minutes ? `${minutes} min before travel` : 'when travel starts';lead.append(option);
  }
  lead.value=String(nativeReminderLeadMinutes(nativeReminderPreferences().items[owner]));
  lead.addEventListener('change',async()=>{
    lead.disabled=true;
    try{
      const prefs=nativeReminderPreferences();prefs.items[owner]={...prefs.items[owner],travelLeadMinutes:Number(lead.value)};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));nativeReminderLastSignature='';await reconcileNativeReminders();
      showToast('departure reminder timing saved');
    }finally{lead.disabled=false;}
  });leadLabel.append(lead);grid.append(leadLabel);
  const hint = document.createElement('p');hint.className = 'field-hint';hint.textContent = 'Sets estimated drop alarms early, including tomorrow morning, then adjusts every 15 minutes. Estimates can be wrong. Sudden drops alert too. Saved on this phone.';
  box.append(grid,hint);return box;
}
function renderNativeDetailReminders(h){
  document.getElementById('detail-native-reminders')?.remove();
  if(!window.TingsNative?.isNative || h.type === 'zero')return;
  const host = document.querySelector('[data-detail-nav="actions"]');
  if(host){const controls = nativeItemReminderControls(`item:${h.hid}`,h.name);controls.id = 'detail-native-reminders';host.querySelector('.section-label').after(controls);}
}
function renderNativeBusyReminders(wrap,blocks){
  if(!window.TingsNative?.isNative)return;
  blocks.forEach((block,i)=>{
    const row = wrap.querySelector(`[data-blocked-row="${i}"]`);
    if(row)row.append(nativeItemReminderControls(nativeBusyReminderKey(block,i),block.label,{compact:true}));
  });
}
function nativeReminderAnyOn(owner){
  const choice = nativeReminderPreferences().items[owner];
  if(!choice)return false;
  return NATIVE_REMINDER_EDGES.some(([edge])=>choice[edge] && choice[edge] !== 'off');
}
function nativeReminderUsesAlarm(owner){
  const choice = nativeReminderPreferences().items[owner];
  if(!choice)return false;
  return NATIVE_REMINDER_EDGES.some(([edge])=>choice[edge] === 'alarm');
}
function nativeReminderCardPill(h){
  if(!window.TingsNative?.isNative || !h || !h.hid || h.type === 'zero')return '';
  if(sortSettings && sortSettings.showRemindersOnCards === false)return '';
  const owner = `item:${h.hid}`;
  if(!nativeReminderAnyOn(owner))return '';
  const alarm = nativeReminderUsesAlarm(owner);
  const label = alarm ? 'ringing alarm on' : 'notification on';
  return `<button type="button" class="context-pill reminder-pill icon-only" data-action="reminders-off" aria-label="turn off ${label}" title="${label} — tap to turn off"><i class="ti ${alarm ? 'ti-bell-ringing' : 'ti-bell'}" aria-hidden="true"></i></button>`;
}
function nativeClearItemReminders(owner){
  if(!owner)return;
  const prefs = nativeReminderPreferences();
  const blank = {travelLeadMinutes:0};
  for(const [edge] of NATIVE_REMINDER_EDGES)blank[edge] = 'off';
  prefs.items[owner] = blank;
  localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
  nativeReminderLastSignature = '';
  void reconcileNativeReminders();
  if(typeof render === 'function')render();
  showToast('phone reminders off for this item', 2800);
}
function nativeReminderLeadMinutes(choices){
  const minutes=Number(choices?.travelLeadMinutes);
  return [0,5,10,15,30,60].includes(minutes) ? minutes : 0;
}
function nativeReminderMissedLeadMinutes(){return AGENDA_DROP_WARNING_MINUTES;}
// A simple window check, never placement or a planner build on the UI thread.
function nativeReminderAllowedWarningAt(h,row,day,settings,now){
  const option=normalizeHabitScheduleOptions(h.scheduleOptions).find(o=>o.id===row.scheduleOptionId);
  const subject=option ? habitBoundToScheduleOption(h,option) : h;
  const loc=(settings.locations || []).find(place=>place.id===row.locationId) || null;
  const intervals=effectiveLocationWindow(subject,loc,new Date(day.dayBase).getDay(),day.dayBase);
  const relevant=intervals.map(w=>({start:day.dayBase+w.start*60000,end:day.dayBase+w.end*60000}))
    .filter(w=>w.end>now);
  const opening=relevant.length ? Math.min(...relevant.map(w=>w.start)) : Infinity;
  const fixed=h.type==='task' && !h.breakable && Number.isFinite(h.eventTime) ? h.eventTime : null;
  return Math.max(opening,fixed || day.dayBase)-60*60000;
}
function nativeReminderOccurrence(row,data,day,dataById = null){
  const dayKey=day.dayKey || dateKey(day.dayBase);
  if(row?.kind==='blocked')return `busy:${dayKey}`;
  const hid=row?.h?.hid || data[row?.i]?.hid;
  const h=dataById ? dataById.get(hid) : data.find(item=>item.hid===hid);
  if(!h)return '';
  // A dismissal is for this occurrence, even if the next rebuild moves it.
  // Split chunks remain separate appointments; their clocks distinguish them.
  return `${h.hid}:${dayKey}:${row.occurrenceKey || row.scheduleOptionId || 'main'}${h.breakable ? ':'+row.start : ''}`;
}
function nativeReminderEvents(week,data,settings,prefs,now = Date.now(),previousWeek = null,warningNow = now){
  const events = new Map();
  if(!prefs.enabled || !week || !Array.isArray(week.days))return [];
  const dataById=new Map(data.map(h=>[h.hid,h]));
  const todayBase=dayStart(now),forecast=week.dropForecast;
  const tomorrow=new Date(todayBase);tomorrow.setDate(tomorrow.getDate()+1);
  const morningEnd=new Date(tomorrow);morningEnd.setHours(12,0,0,0);
  const planKey=agendaForecastPlanKey(week,data);
  const validForecast=Boolean(forecast?.futureWeek && forecast.revision===week.forecastRevision
    && forecast.targetAt>warningNow && forecast.checkedAt<=warningNow
    && forecast.targetAt-forecast.checkedAt>0 && forecast.targetAt-forecast.checkedAt<=AGENDA_DROP_WARNING_MINUTES*60000+1
    && forecast.planKey===planKey);
  for(const day of week.days){
    const rows = (day.timeline || []).filter(row=>row && ['fill','scheduled'].includes(row.kind));
    const groups = new Map();
    for(const row of rows){
      const hid = row.h?.hid || data[row.i]?.hid;
      if(!groups.has(hid))groups.set(hid,[]);
      groups.get(hid).push(row);
    }
    const active = [];
    for(const [hid,items] of groups){
      const h = dataById.get(hid);
      if(h && !(h.type === 'task' && isTaskDone(h)))active.push(...agendaRowsAfterCompletions(h,items,day.dayBase));
    }
    // Resolve busy-time overrides/relative clocks without Home's 'clip to now'.
    const sequence = homeDaySequence({...day,timeline:active},{...settings,homeExtraMode:'cards'});
    sequence.forEach((row,i)=>{
      if(row.kind !== 'travel')return;
      const destination = sequence.slice(i+1).find(next=>next.kind !== 'travel' && next.start === row.end && next.locationId === row.to);
      active.push({...row,reminderOwner:nativeReminderOwner(destination,data,settings,dataById),reminderOccurrence:nativeReminderOccurrence(destination,data,day,dataById)});
    });
    active.push(...blockedTimelineRows(day.dayKey || dateKey(day.dayBase),settings,day.dayBase,{clipAfter:null}));
    const lastStarts=new Map();
    for(const r of active){
      if(!['fill','scheduled'].includes(r.kind))continue;
      const item=dataById.get(r.h?.hid || data[r.i]?.hid);if(!item)continue;
      const key=`${item.hid}:${item.breakable ? 'remaining' : r.scheduleOptionId || 'main'}`;
      lastStarts.set(key,Math.max(lastStarts.get(key) ?? -Infinity,r.start));
    }
    for(const row of active){
      if(!row || !['fill','scheduled','blocked','travel'].includes(row.kind))continue;
      const destinationHabit=row.kind==='travel' ? dataById.get(row.reminderOwner?.slice(5)) : null;
      let owner = row.kind === 'travel' ? row.reminderOwner : nativeReminderOwner(row,data,settings,dataById);
      if(!owner)continue;
      let kind = 'busy', title = row.label || 'Busy time', identity = nativeReminderOccurrence(row,data,day,dataById);
      if(row.kind === 'travel'){
        kind = 'travel';
        const destination = row.toName || settings.locations?.find(location=>location.id === row.to)?.name;
        title = destination ? `Travel to ${destination}` : 'Time to leave';
        identity = `travel:${row.reminderOccurrence}`;
      }else if(row.kind !== 'blocked'){
        // Never bind a removed item's stale row to a new item at the same index.
        const hid = row.h?.hid || data[row.i]?.hid;
        const h = dataById.get(hid);
        if(!h || h.type === 'zero')continue;
        if(h.type === 'task' && isTaskDone(h))continue;
        kind = h.type === 'task' ? 'task' : 'habit';
        title = h.name || 'Ting';
        identity = nativeReminderOccurrence(row,data,day,dataById);
      }
      const h=kind==='habit' || kind==='task' ? dataById.get(owner.slice(5)) : null;
      const completion=h ? {hid:h.hid,dayKey:day.dayKey || dateKey(day.dayBase),
        occurrenceKey:row.occurrenceKey || '',scheduleOptionId:row.scheduleOptionId || '',
        minutes:h.breakable ? Math.max(1,Math.round((row.end-row.start)/60000)) : 0} : null;
      const choices=prefs.items?.[owner];
      const morningCushion=day.dayBase===tomorrow.getTime() && row.start<morningEnd.getTime();
      if(h && ['notification','alarm'].includes(choices?.missed) && (day.dayBase===todayBase || morningCushion)){
        const forecastKey=agendaForecastIdentity(row,data),risk=validForecast && !morningCushion ? forecast.risks?.[forecastKey] : null;
        // A later sample can restore an item after an earlier opportunity
        // has already passed. Never postpone the current estimate merely
        // because that future pack still contains it; adopt that pack first.
        const estimate=row.dropAt;
        // Every enabled displayed occurrence gets an early schedule. If the
        // constraint-aware estimate is unavailable, its latest displayed start
        // is the provisional opportunity. No placement runs in projection.
        const fallback=lastStarts.get(`${h.hid}:${h.breakable ? 'remaining' : row.scheduleOptionId || 'main'}`);
        const agendaAt=risk?.at ?? (Number.isFinite(estimate) && estimate>warningNow ? estimate : fallback);
        const earliest=nativeReminderAllowedWarningAt(h,row,day,settings,now);
        const at=Math.max(risk ? (forecast.warningAt ?? forecast.checkedAt+2000)
          : Math.max(agendaAt-AGENDA_DROP_WARNING_MINUTES*60000,warningNow+2000),earliest,Number(h.snoozedUntil) || 0);
        if(Number.isFinite(agendaAt) && agendaAt>at && (!morningCushion || agendaAt<morningEnd.getTime())){
          const occurrence=h.breakable ? `${h.hid}:${day.dayKey || dateKey(day.dayBase)}:remaining` : identity;
          const key=`${owner}:${kind}:${occurrence}:Missed`;
          const clock=new Date(agendaAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
          const event={key,at,agendaAt,title,owner,dayKey:day.dayKey || dateKey(day.dayBase),
            reminderEdge:'missed',delivery:'alarm',upNext:false,estimated:!risk,expiresAt:agendaAt+15*60000,
            notificationGroup:`${owner}:${day.dayKey || dateKey(day.dayBase)}:missed`,
            ...(!h.breakable && completion ? {completion} : {}),
            body:risk ? 'Drops within 15 min' : `May drop around ${clock}`};
          // Split work has one remaining-opportunity alarm, using the latest
          // available provisional start if no shared estimate exists.
          events.set(key,event);
        }
      }
      for(const edge of ['Start','End']){
        const agendaAt=Number(row[edge.toLowerCase()]);
        const lead=kind==='travel' && edge==='Start' ? nativeReminderLeadMinutes(prefs.items?.[owner]) : 0;
        const desiredAt=agendaAt-lead*60000;
        // Enabling a warning after its lead window starts still warns before
        // departure; native delivery remembers that occurrence after a replan.
        const at=kind==='travel' && edge==='Start' && agendaAt>now ? Math.max(desiredAt,now+2000) : desiredAt;
        const mode = prefs.items?.[owner]?.[kind === 'travel' ? 'travel' + edge : edge.toLowerCase()] || 'off';
        if(!['notification','alarm'].includes(mode) || !Number.isFinite(at) || at <= now || at > now + 7*86400000)continue;
        const key = `${owner}:${kind}:${identity}:${edge}`;
        const movableStart=edge==='Start' && (kind==='travel' ? destinationHabit && !(destinationHabit.type==='task' && !destinationHabit.breakable && Number.isFinite(destinationHabit.eventTime)) : h && !(h.type==='task' && !h.breakable && Number.isFinite(h.eventTime)) && row.hard!==true && row.kind!=='scheduled');
        const clock=new Date(agendaAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
        events.set(key,{key,at,agendaAt,title,owner,
          upNext:Boolean(movableStart),upNextBody:`Up next · ${clock}`,notificationGroup:`${owner}:${day.dayKey || dateKey(day.dayBase)}:${kind === 'travel' ? 'travel'+edge : edge.toLowerCase()}`,
          expiresAt:edge==='Start' && kind!=='travel' ? Math.max(at,Number(row.end))+15*60000 : agendaAt+15*60000,
          dayKey:day.dayKey || dateKey(day.dayBase),...(completion ? {completion} : {}),reminderEdge:kind === 'travel' ? 'travel' + edge : edge.toLowerCase(),delivery:mode,body:`${kind === 'travel' ? edge==='Start' ? 'Leave' : 'Arrive' : edge==='Start' ? 'Start' : 'End'} · ${clock}`});
      }
    }
  }
  // A saved, displayed item can enter Missed immediately when a new pack drops
  // it, even with an open clock window. Warn once while it is still actionable.
  const today=dayStart(now),currentDay=week.days.find(day=>day.dayBase===today);
  const priorDay=previousWeek?.days?.find(day=>day.dayBase===today);
  if(currentDay && priorDay){
    const present=new Set((currentDay.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
      .map(r=>r.h?.hid || data[r.i]?.hid));
    for(const row of priorDay.timeline || []){
      if(!['fill','scheduled'].includes(row.kind))continue;
      const hid=row.hid || row.h?.hid || data[row.i]?.hid,h=dataById.get(hid),owner=`item:${hid}`;
      if(!h || h.type==='zero' || present.has(hid) || !['notification','alarm'].includes(prefs.items?.[owner]?.missed)
        || completedOnDay(h,today) || Number(h.snoozedUntil)>now
        || (hasDaySchedule(h) && !isDateEligibleForHabit(h,today))
        || !windowStillDoableToday(h,now,settings))continue;
      if(now+2000<nativeReminderAllowedWarningAt(h,row,currentDay,settings,now))continue;
      // A predicted drop already warned; reserve this alert for sudden losses.
      if(Number.isFinite(row.warnedDropAt) && row.warnedDropAt<=now+60000)continue;
      const missedAt=now+15*60000;
      const key=`${owner}:Slipped:${dateKey(today)}`;
      events.set(key,{key,at:now+2000,agendaAt:missedAt,title:h.name || 'Ting',body:'Slipped · still time',owner,
        dayKey:dateKey(today),reminderEdge:'missed',delivery:'alarm',upNext:false,slipped:true,expiresAt:missedAt,
        notificationGroup:`${owner}:${dateKey(today)}:missedDrop`,
        ...(!h.breakable ? {completion:{hid,dayKey:dateKey(today),minutes:0}} : {})});
    }
  }
  // The future normal result also prepares ordinary edges beyond its clock.
  // Current edges due before that clock retain their existing schedule.
  if(validForecast){
    const futurePrefs={...prefs,items:Object.fromEntries(Object.entries(prefs.items || {})
      .map(([owner,choice])=>[owner,{...choice,missed:'off'}]))};
    const futureEvents=nativeReminderEvents({...forecast.futureWeek,dropForecast:null},data,settings,futurePrefs,now,null,warningNow);
    for(const [key,event] of events)if(event.reminderEdge!=='missed' && event.at>=forecast.targetAt)events.delete(key);
    for(const event of futureEvents){
      if(event.at<forecast.targetAt || events.has(event.key))continue;
      events.set(event.key,event);
    }
  }
  return [...events.values()].sort((a,b)=>a.at-b.at || a.key.localeCompare(b.key));
}
let nativeReminderTimer;
let nativeReminderLastSignature = '';
let nativeReminderLastWeek = null;
let nativeReminderPublishedWeek = null;
let nativeBackgroundSnapshotTimer;
let nativeBackgroundInputSignature = '';
let nativeBackgroundLastApplied = 0;
let nativeBackgroundLastPlan = 0;
let nativeAgendaChannelEnabled = true;
let nativeBackgroundWaitingWeek = null;
let nativeBackgroundWaitingSince = 0;
let nativeForecastTimer;
let nativeBackgroundStatusAt = 0;
function nativeReminderSettingsOpen(){
  const host=document.getElementById('settings-reminders-body');
  return Boolean(host && !host.hidden);
}
function scheduleNativeAgendaForecast(week,data,settings,prefs,revision){
  if(!prefs.enabled || typeof forecastAgendaOffMain!=='function')return;
  if(document.visibilityState==='hidden' || _optimizerHomeRequestKey || _optimizerHomeRefinementKey)return;
  const owners=data.filter(h=>['notification','alarm'].includes(prefs.items?.[`item:${h.hid}`]?.missed)).map(h=>h.hid);
  if(!owners.length || reusableAgendaDropForecast(week,data,revision))return;
  clearTimeout(nativeForecastTimer);
  nativeForecastTimer=setTimeout(async()=>{
    if(document.visibilityState==='hidden' || _optimizerHomeRequestKey || _optimizerHomeRefinementKey)return;
    const mode=settings.agendaOptimizer===false || agendaPlannerForcedFast() ? 'fast' : 'exact';
    const forecastSettings={...settings,_plannerLiveLocationId:typeof liveLocationId==='function' ? liveLocationId() : null,
      _plannerCurrentCoord:typeof currentCoordLocation==='function' ? currentCoordLocation() : null,
      _weatherContext:typeof weatherPlannerContext==='function' ? weatherPlannerContext(settings) : null};
    const forecast=await forecastAgendaOffMain(week,data,forecastSettings,mode,revision,owners);
    if(!forecast?.futureWeek || document.visibilityState==='hidden' || homePlannerDirtyKey(load())!==revision
      || _homeRenderedWeek!==week || forecast.targetAt<=Date.now())return;
    applyAgendaRiskForecast(week,forecast,data);week.forecastRevision=revision;
    saveHomeAgendaCache(data,week);
    void reconcileNativeReminders();
  },400);
}
function nativeBackgroundSnapshot(){
  const storage = {};
  for(const key of [KEY,SORT_SETTINGS_KEY,...PLANNER_WORKER_STORAGE_KEYS,WEATHER_CACHE_KEY]){
    const value = localStorage.getItem(key);if(value != null)storage[key] = value;
  }
  const data=load(),mounted=typeof _homeRenderedWeek !== 'undefined' ? _homeRenderedWeek : null;
  // Memoized future days are safe only when this agenda matches saved inputs.
  const compatible=mounted && typeof _optimizerHomeReadyDirtyKey !== 'undefined'
    && _optimizerHomeReadyDirtyKey === homePlannerDirtyKey(data);
  const saved=nativeReminderDeliveryPreferences(data,nativeReminderPreferences());
  const owners=new Set(data.filter(h=>h.type!=='zero' && !(h.type==='task' && isTaskDone(h))).map(h=>`item:${h.hid}`));
  normalizeBlockedTimes(sortSettings.blockedTimes).forEach((block,i)=>owners.add(nativeBusyReminderKey(block,i)));
  const prefs={...saved,items:Object.fromEntries(Object.entries(saved.items).filter(([owner])=>owners.has(owner)))};
  return {storage,prefs,week:compatible ? leanAgendaWeek(mounted) : null,
    weatherRevision:sortSettings?._weatherContext?.revision || '',
    coord:typeof currentCoordLocation === 'function' ? currentCoordLocation() : null};
}
function nativeBackgroundSnapshotKey(){
  const data=typeof load==='function'?load():[];
  const prefs=nativeReminderPreferences();
  const mounted=typeof _homeRenderedWeek!=='undefined'?_homeRenderedWeek:null;
  return [
    typeof homePlannerDirtyKey==='function'?homePlannerDirtyKey(data):'',
    prefs.enabled,
    JSON.stringify(prefs.items||{}),
    typeof _optimizerHomeReadyDirtyKey!=='undefined'?_optimizerHomeReadyDirtyKey:'',
    sortSettings?._weatherContext?.revision||'',
    mounted && typeof homeAgendaPlanSignature==='function'?homeAgendaPlanSignature(mounted,data):''
  ].join('\n');
}
function queueNativeBackgroundSnapshot(){
  if(!window.TingsNative?.isNative || !window.TingsNative.background)return;
  clearTimeout(nativeBackgroundSnapshotTimer);
  nativeBackgroundSnapshotTimer=setTimeout(()=>{
    const key=nativeBackgroundSnapshotKey();
    if(key===nativeBackgroundInputSignature)return;
    const snapshot=nativeBackgroundSnapshot();
    window.TingsNative.background.snapshot(snapshot).then(()=>{nativeBackgroundInputSignature=key;})
      .catch(()=>{});
  },100);
}
async function refreshNativeBackgroundStatus(force=false){
  const api=window.TingsNative?.background;if(!api)return;
  if(!force && !nativeBackgroundWaitingSince && Date.now()-nativeBackgroundStatusAt<60000
    && !nativeReminderSettingsOpen())return;
  nativeBackgroundStatusAt=Date.now();
  const state=await api.status(),node=document.getElementById('native-background-status');
  nativeAgendaChannelEnabled=state.notificationChannelEnabled!==false;
  const toggle=document.getElementById('native-background-toggle');
  toggle?.setAttribute('aria-pressed',String(state.enabled));
  if(node)node.textContent=state.enabled
    ? `Closed refresh: about 15 minutes with drop reminders enabled; 30 minutes otherwise. Android may delay it.${state.background ? ' Background location is allowed.' : ' Uses the last saved place. Allow background location to detect movement.'}${state.plannedAt ? ` Last background update: ${new Date(state.plannedAt).toLocaleString()}.` : ''}${state.dropEstimated ? ` ${state.dropEstimated} estimated drop alarms.` : ''}${state.dropConfirmed ? ` ${state.dropConfirmed} confirmed drop alarms.` : ''}${state.exact===false && state.dropEstimated+state.dropConfirmed>0 ? ' Drop alarms are saved but need exact timing access to ring.' : ''}${state.error ? ` ${state.error}` : ''}`
    : 'Background refresh is off. The phone follows its last saved agenda.';
  const fix=state.location;
  if(!sortSettings.pinnedLocationId && fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && Date.now()-fix.at<=10*60000 && fix.at>nativeBackgroundLastApplied){
    nativeBackgroundLastApplied=fix.at;
    applyGeoPosition({coords:{latitude:fix.lat,longitude:fix.lng}},{updateAnchor:true});
  }
  // Returning to a background-updated schedule must not immediately replace
  // it with yesterday's mounted UI cache. Wait for the foreground rebuild.
  const updated=Number(localStorage.getItem('tings_native_reminders_updated'));
  if(state.plannedAt>updated && state.plannedAt>nativeBackgroundLastPlan){
    nativeBackgroundLastPlan=state.plannedAt;
    if(!sortSettings.pinnedLocationId && state.lastLocationId && !(fix?.at> Date.now()-10*60000))setAutoLocationId(state.lastLocationId);
    nativeBackgroundWaitingWeek=typeof _homeRenderedWeek !== 'undefined' ? _homeRenderedWeek : null;
    nativeBackgroundWaitingSince=Date.now();
    if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged(true,{locationChanged:true,__forceReplan:true});
  }
}
function queueNativeReminders(){
  if(!window.TingsNative?.isNative)return;
  queueNativeBackgroundSnapshot();
  clearTimeout(nativeReminderTimer);
  nativeReminderTimer = setTimeout(()=>void reconcileNativeReminders(),250);
}
let nativeReminderReconcileQueue = Promise.resolve();
function reconcileNativeReminders(){
  nativeReminderReconcileQueue = nativeReminderReconcileQueue.catch(()=>{}).then(reconcileNativeRemindersNow);
  return nativeReminderReconcileQueue;
}
// Native actions stay queued until the shared completion has been saved. A
// durable operation ID in the log prevents duplicates after an interrupted ack.
async function consumeNativeAlarmCompletions(){
  const api=window.TingsNative?.alarms;
  if(!api?.completions || !api.acknowledge)return;
  const {actions}=await api.completions();let changed=false;
  for(const action of actions || []){
    if(!/^[0-9a-f]{32}$/.test(action.id) || !/^\d{4}-\d{2}-\d{2}$/.test(action.dayKey)){
      await api.acknowledge(action.id);continue;
    }
    const data=load(),i=data.findIndex(h=>h.hid===action.hid),h=data[i];
    if(!h || h.type==='zero'){await api.acknowledge(action.id);continue;}
    const logs=normalizeLogs(h.logs);
    const row={kind:'fill',i,h,start:new Date(`${action.dayKey}T12:00:00`).getTime(),
      occurrenceKey:action.occurrenceKey || '',scheduleOptionId:action.scheduleOptionId || ''};
    const already=logs.some(log=>log?.source==='native_alarm' && log.operationId===action.id)
      || (h.type==='task' && isTaskDone(h))
      || (!h.breakable && (action.occurrenceKey
        ? logs.some(log=>!isPlanLog(log) && logOccurrenceKey(log)===action.occurrenceKey && dateKey(logTime(log))===action.dayKey)
        : completedOnDay(h,dayStart(row.start))));
    if(already)changed=true;
    if(!already){
      const remaining=h.breakable ? Math.max(0,breakableTotalMinutes(h)-breakableProgressMinutes(h,dayStart(row.start))) : 0;
      if(h.breakable && remaining===0){await api.acknowledge(action.id);continue;}
      const minutes=h.breakable ? Math.min(Math.max(1,Number(action.minutes) || 1),remaining) : undefined;
      const at=Math.min(Number(action.at),Date.now(),new Date(`${action.dayKey}T23:59:59.999`).getTime());
      if(!Number.isFinite(at) || at<=0)throw new Error('Invalid alarm completion time.');
      if(!logTing(i,{at,minutes,
        occurrenceKey:action.occurrenceKey || undefined,scheduleOptionId:action.scheduleOptionId || undefined,
        scheduledDay:action.dayKey,source:'native_alarm',operationId:action.id,feedback:false}))
        throw new Error('Alarm stopped; open this item to finish marking it done.');
      changed=true;
    }
    await api.acknowledge(action.id);
  }
  if(changed){nativeReminderLastSignature='';refreshOpenViews();queueNativeBackgroundSnapshot();}
}
async function reconcileNativeRemindersNow(){
  const api = window.TingsNative?.notifications;
  if(!api || !window.TingsNative.isNative)return;
  try{
    await consumeNativeAlarmCompletions();
    await refreshNativeBackgroundStatus();
    const prefs = nativeReminderDeliveryPreferences(load(),nativeReminderPreferences());
    const mounted = typeof _homeRenderedWeek !== 'undefined' ? _homeRenderedWeek : null;
    if(mounted)nativeReminderLastWeek = mounted;
    if(prefs.enabled && nativeBackgroundWaitingSince && (!mounted || mounted===nativeBackgroundWaitingWeek)){
      if(Date.now()-nativeBackgroundWaitingSince<70000){
        clearTimeout(nativeReminderTimer);nativeReminderTimer=setTimeout(()=>void reconcileNativeReminders(),1000);
      }
      return;
    }
    nativeBackgroundWaitingWeek=null;
    nativeBackgroundWaitingSince=0;
    const week = mounted || nativeReminderLastWeek;
    // Preserve OS alarms during temporary render transitions and while closed.
    if(prefs.enabled && !week)return;
    const liveData=load(),revision=homePlannerDirtyKey(liveData);
    // Mirrored selections cancel done/deleted/disabled work immediately. Keep
    // the remaining native schedules while the mounted pack has old inputs;
    // projecting new settings onto old rows can move an alarm speculatively.
    if(prefs.enabled && mounted && _optimizerHomeReadyDirtyKey!==revision){
      queueNativeBackgroundSnapshot();await renderNativeReminderStatus();return;
    }
    if(week)week.forecastRevision=revision;
    const events = nativeReminderEvents(week,liveData,sortSettings,prefs,Date.now(),nativeReminderPublishedWeek);
    const signature = JSON.stringify({events,enabled:prefs.enabled,items:prefs.items});
    if(signature !== nativeReminderLastSignature){
      // Ringing alarms require exact access. Do not silently downgrade them.
      const alarms = window.TingsNative.alarms;
      const ringing = events.filter(e=>e.delivery === 'alarm');
      if(ringing.length && !alarms)throw new Error('Update the Android app to use ringing alarms.');
      if(window.TingsNative.background)await window.TingsNative.background.publish(nativeBackgroundSnapshot(),events);
      else{
        if(alarms)await alarms.replaceAgenda(ringing,prefs.enabled,prefs.items);
        await api.replaceAgenda(events.filter(e=>e.delivery !== 'alarm'));
      }
      nativeReminderLastSignature = signature;
      // Keep stable item identities across delete/reorder edits.
      nativeReminderPublishedWeek = {forecastRevision:revision,days:(week?.days || []).map(day=>({dayBase:day.dayBase,dayKey:day.dayKey,
        timeline:(day.timeline || []).filter(row=>['fill','scheduled'].includes(row.kind)).map(row=>({
          kind:row.kind,hid:row.hid || row.h?.hid,i:row.i,start:row.start,end:row.end,
          occurrenceKey:row.occurrenceKey,scheduleOptionId:row.scheduleOptionId,
          riskCheckedAt:row.riskCheckedAt,
          warnedDropAt:events.find(e=>e.owner===`item:${row.hid || row.h?.hid}` && e.reminderEdge==='missed' && !e.slipped
            && (e.completion?.scheduleOptionId || 'main')===(row.scheduleOptionId || 'main'))?.agendaAt,
          riskAt:events.find(e=>e.owner===`item:${row.hid || row.h?.hid}` && e.reminderEdge==='missed' && !e.slipped
            && (e.completion?.scheduleOptionId || 'main')===(row.scheduleOptionId || 'main'))?.agendaAt ?? row.riskAt ?? row.dropAt
        }))}))};
      localStorage.setItem('tings_native_reminders_updated',String(Date.now()));
    }
    await renderNativeReminderStatus();
    if(week)scheduleNativeAgendaForecast(week,liveData,sortSettings,prefs,revision);
  }catch(error){
    const status = document.getElementById('native-reminder-status');
    if(status)status.textContent = `Reminders need attention: ${error.message}`;
  }
}
async function renderNativeReminderStatus(){
  const node = document.getElementById('native-reminder-status');
  if(!node || !nativeReminderSettingsOpen())return;
  const api = window.TingsNative.notifications;
  const permission = await api.permissions();
  const exact = await api.exactAlarmPermission();
  const pending = await api.pending();
  const updated = Number(localStorage.getItem('tings_native_reminders_updated'));
  const count = pending.notifications.filter(n=>n.extra?.tingsAgenda === true).length;
  const alarms = window.TingsNative.alarms ? await window.TingsNative.alarms.status() : null;
  node.textContent = `${permission.display === 'granted' ? `${count} notifications${alarms ? ` and ${alarms.pending} alarms` : ''} scheduled` : 'Notification permission needed'} · ${exact.exact_alarm === 'granted' ? 'exact timing allowed' : 'timing may be delayed'}${updated ? ` · updated ${new Date(updated).toLocaleString()}` : ''}${alarms && !alarms.fullScreen ? ' · Allow full-screen alarms for the lock-screen controls' : ''}${window.TingsNative.background && nativeAgendaChannelEnabled===false ? ' · Agenda notifications are off in Android settings' : ''}. Reminders follow the latest saved agenda.`;
}
function openBackgroundLocationDisclosure(){
  const copy = document.getElementById('background-location-disclosure-copy');
  if(copy && typeof BACKGROUND_LOCATION_DISCLOSURE === 'string')copy.textContent = BACKGROUND_LOCATION_DISCLOSURE;
  if(typeof openSheet === 'function')openSheet('background-location-disclosure-sheet');
}
function closeBackgroundLocationDisclosure(){
  if(typeof closeSheet === 'function')closeSheet('background-location-disclosure-sheet');
}
async function requestBackgroundLocationFromUser(){
  const api = window.TingsNative && window.TingsNative.background;
  if(!api || !api.requestLocation)return;
  try{
    const state = typeof api.status === 'function' ? await api.status() : {};
    if(state.background){
      showToast('Background location is already allowed.');
      if(typeof refreshNativeBackgroundStatus === 'function')await refreshNativeBackgroundStatus(true);
      return;
    }
    openBackgroundLocationDisclosure();
  }catch(error){showToast(error.message);}
}
async function confirmBackgroundLocationDisclosure(){
  const api = window.TingsNative && window.TingsNative.background;
  if(!api || !api.requestLocation){
    closeBackgroundLocationDisclosure();
    return;
  }
  try{
    const state = await api.requestLocation();
    closeBackgroundLocationDisclosure();
    if(!state.fine){showToast('Allow precise location to use saved-place detection.');return;}
    if(state.background){
      showToast('Background location is already allowed.');
      if(typeof refreshNativeBackgroundStatus === 'function')await refreshNativeBackgroundStatus(true);
      return;
    }
    showToast('In Android settings → Permissions → Location, choose Allow all the time.');
    if(typeof api.openLocationSettings === 'function')await api.openLocationSettings();
  }catch(error){
    closeBackgroundLocationDisclosure();
    showToast(error.message);
  }
}
function initNativeReminders(){
  if(!window.TingsNative?.isNative)return;
  const host = document.getElementById('settings-reminders-body');
  if(!host)return;
  const panel = document.createElement('div');
  panel.id = 'native-reminder-controls';
  const heading = document.createElement('p');heading.className = 'settings-sublabel';
  heading.textContent = 'Phone notifications and alarms';
  panel.append(heading);
  const prefs = nativeReminderPreferences();
  const toggle = document.createElement('div');
  const title = document.createElement('span');title.textContent = 'enable phone reminders';
  const input = document.createElement('button');input.type = 'button';input.className = 'setting-toggle setting-switch compact-toggle';input.setAttribute('aria-pressed',String(prefs.enabled));input.setAttribute('aria-label','enable phone reminders');
  input.append(title);
  input.insertAdjacentHTML('beforeend','<span class="switch-ui" aria-hidden="true"></span>');
  input.addEventListener('click',async ()=>{
    input.disabled = true;
    try{
      const current = nativeReminderPreferences(),enabled = !current.enabled;
      if(enabled){
        const permission = await window.TingsNative.notifications.requestPermissions();
        if(permission.display !== 'granted'){
          showToast('Notifications were not allowed. You can turn them on in Android settings if you change your mind.',5000);
          return;
        }
      }
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({...current,enabled}));
      input.setAttribute('aria-pressed',String(enabled));nativeReminderLastSignature = '';await reconcileNativeReminders();
      showToast(enabled ? 'phone reminders on' : 'phone reminders off');
    }catch(error){showToast(error.message,5000);}finally{input.disabled = false;}
  });toggle.append(input);panel.append(toggle);
  const explanation = document.createElement('p');explanation.className = 'field-hint';explanation.textContent = 'Choose reminders in each habit or task’s Actions tab, or under each busy time. New items start with reminders off. These choices stay on this phone.';panel.append(explanation);
  const exact = document.createElement('button');exact.type = 'button';exact.className = 'mini-text-btn';exact.textContent = 'Allow exact timing';
  exact.addEventListener('click',async ()=>{
    try{await window.TingsNative.notifications.requestExactAlarmPermission();}
    catch(error){showToast(error.message);}
  });
  const test = document.createElement('button');test.type = 'button';test.className = 'mini-text-btn';test.textContent = 'Test notification in 10 seconds';
  test.addEventListener('click',async ()=>{
    try{
      await window.TingsNative.notifications.requestPermissions();
      if(window.TingsNative.notifications.testAgenda)await window.TingsNative.notifications.testAgenda();
      else await window.TingsNative.notifications.schedule({id:900001,title:'Tings test',body:'Phone notifications are working.',at:Date.now()+10000});
      showToast('Test scheduled in 10 seconds');
    }catch(error){showToast(error.message);}
  });
  const policy = document.createElement('p');policy.className='field-hint';policy.textContent='When a flexible start or departure stays within 5 minutes, its notification keeps the earlier reminder time and shows the latest agenda time. Each occurrence alerts once; repeat notifications for the same item and reminder type are quiet for 30 minutes. Remind in 5 min is your explicit exception.';panel.append(policy);
  const status = document.createElement('p');status.id = 'native-reminder-status';status.className = 'field-hint';
  const actions = document.createElement('div');actions.className = 'btn-row';actions.style.flexWrap = 'wrap';actions.append(exact,test);
  if(window.TingsNative.notifications.openSettings){
    const settings=document.createElement('button');settings.type='button';settings.className='mini-text-btn';settings.textContent='Android notification settings';
    settings.addEventListener('click',()=>window.TingsNative.notifications.openSettings().catch(error=>showToast(error.message)));actions.append(settings);
  }
  panel.append(actions);
  if(window.TingsNative.alarms){
    const hint = document.createElement('p');hint.className = 'field-hint';
    hint.textContent = 'Ringing alarms use your phone’s alarm volume and continue until you act. Snooze rings again in 5 minutes. Notifications have Remind in 5 minutes, Dismiss for today, and Mark done. Stop/Dismiss for today silences this item’s reminders today, even if its schedule moves. Stop & mark done opens Tings and records completion; split habits log only this session. Travel and busy-time reminders have no completion action.';
    const fullScreen = document.createElement('button');fullScreen.type = 'button';fullScreen.className = 'mini-text-btn';fullScreen.textContent = 'Allow full-screen alarms';
    fullScreen.addEventListener('click',async ()=>{try{await window.TingsNative.alarms.requestFullScreen();}catch(error){showToast(error.message);}});
    const alarmTest = document.createElement('button');alarmTest.type = 'button';alarmTest.className = 'mini-text-btn';alarmTest.textContent = 'Test ringing alarm in 10 seconds';
    alarmTest.addEventListener('click',async ()=>{
      try{await window.TingsNative.notifications.requestPermissions();await window.TingsNative.alarms.test();showToast('Alarm will ring in 10 seconds. Snooze or stop to end it.');}
      catch(error){showToast(error.message);}
    });panel.append(hint);actions.append(fullScreen,alarmTest);
  }
  panel.append(status);
  if(window.TingsNative.background){
    const background=document.createElement('button');background.id='native-background-toggle';background.type='button';
    background.className='setting-toggle setting-switch compact-toggle';background.setAttribute('aria-pressed','false');
    background.innerHTML='<span>refresh agenda while closed</span><span class="switch-ui" aria-hidden="true"></span>';
    background.addEventListener('click',async()=>{
      background.disabled=true;
      try{
        const state=await window.TingsNative.background.status();
        await window.TingsNative.background.snapshot(nativeBackgroundSnapshot());
        await window.TingsNative.background.configure(!state.enabled);
        await refreshNativeBackgroundStatus(true);
      }catch(error){showToast(error.message);await refreshNativeBackgroundStatus(true);}finally{background.disabled=false;}
    });
    const hint=document.createElement('p');hint.className='field-hint';
    hint.textContent='Updates the agenda and your chosen reminders using time, saved data, and weather. One brief location check can update your place. No continuous GPS tracking. Turn on phone reminders and choose at least one item reminder to use this.';
    const location=document.createElement('button');location.id='native-background-location';location.type='button';location.className='mini-text-btn';location.textContent='Allow background location';
    location.addEventListener('click',()=>{void requestBackgroundLocationFromUser();});
    const backgroundStatus=document.createElement('p');backgroundStatus.id='native-background-status';backgroundStatus.className='field-hint';
    panel.append(background,hint,location,backgroundStatus);
    let inputRevision=homePlannerDirtyKey(load());
    window.addEventListener('tings-native-input',()=>queueMicrotask(()=>{
      const revision=homePlannerDirtyKey(load());
      if(revision!==inputRevision){
        cancelAgendaRiskForecast('saved inputs changed');inputRevision=revision;
        if(_optimizerHomeReadyDirtyKey!==revision && typeof renderHomeIfChanged==='function')
          renderHomeIfChanged(true,{__forceReplan:true});
      }
      queueNativeReminders();
    }));
  }
  host.replaceChildren(panel);
  nativeEnsureBusyReminderIds();
  renderBlockedTimeControls();
  document.getElementById('settings-reminders-head')?.addEventListener('click',()=>{
    queueMicrotask(()=>{
      if(!nativeReminderSettingsOpen())return;
      void renderNativeReminderStatus().catch(()=>{});
      void refreshNativeBackgroundStatus(true).catch(()=>{});
    });
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){nativeReminderLastSignature = '';nativeBackgroundStatusAt=0;queueNativeReminders();}});
  window.addEventListener('focus',queueNativeReminders);
  // Covers edits received by clone reconciliation and same-plan provenance updates.
  // Completions stay cheap; placement/forecast work is cached after the first pass.
  setInterval(()=>{if(!document.hidden)queueNativeReminders();},15000);
  queueNativeReminders();
  if(localStorage.getItem('tings_drop_alarm_migration')){
    localStorage.removeItem('tings_drop_alarm_migration');
    showToast('Drop warnings now use ringing alarms, estimated early and adjusted every 15 minutes.');
  }
  void refreshNativeBackgroundStatus(true).catch(()=>{});
}
document.addEventListener('DOMContentLoaded',initNativeReminders);
