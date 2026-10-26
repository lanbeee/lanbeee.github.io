// Shared agenda-to-reminder projection; OS delivery is supplied by the native shell.
// Preferences are device-local and intentionally separate from clone settings.
const NATIVE_REMINDERS_KEY = 'tings_native_reminders_v1';
const NATIVE_REMINDER_DEFAULTS = {version:4,enabled:false,items:{}};
const NATIVE_REMINDER_EDGES = [['start','start'],['end','end'],['travelStart','travel: departure'],['travelEnd','travel: arrival'],['missed','drop warning']];
function nativeBusyReminderKey(block,index){
  return block ? `busy:${block.reminderId || JSON.stringify([index,block.label,block.start,block.end,block.days])}` : '';
}
function nativeReminderPreferences(){
  try{
    const saved = JSON.parse(localStorage.getItem(NATIVE_REMINDERS_KEY) || 'null');
    if(!saved)return {...NATIVE_REMINDER_DEFAULTS,items:{}};
    if(saved.version === 4)return {...NATIVE_REMINDER_DEFAULTS,...saved};
    if(saved.version === 2 || saved.version === 3){
      // Version 3 always used fifteen minutes, ignoring older stored leads.
      // Preserve that effective timing and the existing delivery choice.
      const items=Object.fromEntries(Object.entries(saved.items || {}).map(([owner,choice])=>
        [owner,{...choice,missedLeadMinutes:15,dates:Object.fromEntries(Object.entries(choice.dates || {})
          .map(([day,patch])=>[day,{...patch,...('missedLeadMinutes' in patch ? {missedLeadMinutes:15} : {})}]))}]));
      const next={...NATIVE_REMINDER_DEFAULTS,...saved,version:4,items};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(next));return next;
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
    const next = {version:4,enabled:Boolean(saved.enabled),items};
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(next));return next;
  }catch(_){return {...NATIVE_REMINDER_DEFAULTS,items:{}};}
}
let _nativeDeliveryPrefs={key:'',value:null};
// Resolve series inheritance at delivery time, including instances first seen
// by the background worker. Never persist expanded defaults as overrides.
function nativeCalendarReminderPreferences(prefs,data){
  const items={...prefs.items},raw=prefs.calendarOverrides || prefs.items || {};
  if(prefs.calendarOverrides)for(const owner of Object.keys(items))if(owner.startsWith('item:device:'))delete items[owner];
  for(const h of data || []){
    if(h.source!=='device')continue;
    const owner=`item:${h.hid}`,series=h.calendarSeriesId ? raw[`calendar-series:${h.calendarSeriesId}`] : null;
    if(series || raw[owner])items[owner]={...series,...raw[owner]};
  }
  return {...prefs,items};
}
function nativeCalendarReminderScope(h){
  const body=document.createElement('div');
  const label=document.createElement('label');label.className='planning-field';label.textContent='edit reminders for';
  const scope=document.createElement('select');scope.className='mini-select';scope.setAttribute('aria-label','edit reminders for');
  for(const [value,text] of [['series','all dates'],['occurrence','this date']]){
    const option=document.createElement('option');option.value=value;option.textContent=text;scope.append(option);
  }
  label.append(scope);body.append(label);
  const controls=document.createElement('div');body.append(controls);
  const paint=()=>controls.replaceChildren(nativeItemReminderControls(scope.value==='series' ? `calendar-series:${h.calendarSeriesId}` : `item:${h.hid}`,h.name,{meeting:true,hideMissed:true}));
  scope.addEventListener('change',paint);paint();
  const reset=document.createElement('button');reset.type='button';reset.className='btn';reset.textContent='use the usual reminders for this date';
  reset.addEventListener('click',async()=>{
    const prefs=nativeReminderPreferences();delete prefs.items[`item:${h.hid}`];
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
    nativeReminderLastSignature='';await reconcileNativeReminders();paint();showToast('reminders reset');
  });body.append(reset);
  const hint=document.createElement('p');hint.className='field-hint';hint.textContent='Your calendar app may also notify you.';body.append(hint);
  return body;
}
function nativeReminderDeliveryPreferences(data,prefs,now=Date.now()){
  prefs=nativeCalendarReminderPreferences(prefs,data);
  const rev=typeof plannerDataRevision==='function'?plannerDataRevision():(data||[]).length;
  const key=`${rev}\n${dateKey(now)}\n${prefs.enabled}\n${JSON.stringify(prefs.items||{})}\n${JSON.stringify(prefs.calendarOverrides||{})}`;
  if(_nativeDeliveryPrefs.key===key)return _nativeDeliveryPrefs.value;
  const items={};
  for(const [owner,choices] of Object.entries(prefs.items || {})){
    if(!owner.startsWith('item:')){items[owner]=choices;continue;}
    const h=data.find(h=>`item:${h.hid}`===owner);
    if(!h || h.type==='zero' || (h.type==='task' && isTaskDone(h)))continue;
    const resolvedDays=[];
    const separate=!isOpportunityHabit(h) && normalizeHabitScheduleOptions(h.scheduleOptions).some(o=>habitScheduleOptionSameDayMode(o)==='separate');
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
// Date patches replace individual edges; the owner and event identity never change.
function nativeReminderChoices(prefs,owner,dayKey){
  const h=owner.startsWith('item:device:') ? load().find(h=>`item:${h.hid}`===owner) : null;
  const choice={...(h?.calendarSeriesId ? prefs.items?.[`calendar-series:${h.calendarSeriesId}`] : {}),...prefs.items?.[owner]};
  return {...choice,...(dayKey ? choice.dates?.[dayKey] : {})};
}
function nativeSaveReminderPatch(prefs,owner,patch,dayKey){
  const choice={...prefs.items[owner]};
  if(dayKey)choice.dates={...choice.dates,[dayKey]:{...choice.dates?.[dayKey],...patch}};
  else Object.assign(choice,patch);
  prefs.items[owner]=choice;
  localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
}
async function nativeResetReminderDate(owner,dayKey,{travelOnly=false}={}){
  const prefs=nativeReminderPreferences(),choice={...prefs.items[owner]},dates={...choice.dates};
  const patch={...dates[dayKey]};
  for(const edge of travelOnly ? ['travelStart','travelEnd','travelLeadMinutes'] : ['start','end','startLeadMinutes','travelStart','travelEnd','travelLeadMinutes','missed','missedLeadMinutes'])delete patch[edge];
  if(Object.keys(patch).length)dates[dayKey]=patch;else delete dates[dayKey];
  prefs.items[owner]={...choice,dates};localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
  nativeReminderLastSignature='';await reconcileNativeReminders();
}
function nativeCardReminderControls(owner,name,dayKey,{travelOnly=false}={}){
  const host=document.createElement('details');host.className='utility-sheet-disclosure native-card-reminders';
  const summary=document.createElement('summary');
  const title=document.createElement('span');title.textContent='phone reminders';
  const chevron=document.createElement('i');chevron.className='ti ti-chevron-down';chevron.setAttribute('aria-hidden','true');
  summary.append(title,chevron);host.append(summary);
  const content=document.createElement('div');content.className='utility-disclosure-body';host.append(content);
  const label=document.createElement('label');label.className='planning-field';label.textContent='edit reminders for';
  const scope=document.createElement('select');scope.className='mini-select';scope.dataset.reminderScope=owner;
  scope.setAttribute('aria-label','edit reminders for');
  const dateLabel=new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  for(const [value,text] of [['date',`this date · ${dateLabel}`],['series','all dates']]){
    const option=document.createElement('option');option.value=value;option.textContent=text;scope.append(option);
  }
  label.append(scope);content.append(label);
  const body=document.createElement('div');content.append(body);
  const paint=()=>{
    body.replaceChildren(nativeItemReminderControls(owner,name,{compact:true,travelOnly,
      dayKey:scope.value==='date' ? dayKey : null}));
    if(scope.value!=='date')return;
    const reset=document.createElement('button');reset.type='button';reset.className='mini-text-btn';reset.textContent='use the usual reminders for this date';
    reset.addEventListener('click',async()=>{
      reset.disabled=true;
      try{
        await nativeResetReminderDate(owner,dayKey,{travelOnly});paint();showToast('reminders reset');
      }finally{reset.disabled=false;}
    });body.append(reset);
  };
  scope.addEventListener('change',paint);paint();return host;
}
function renderNativeBlockEditorReminders(block,dayKey){
  document.getElementById('block-edit-reminders')?.remove();
  if(!window.TingsNative?.isNative || !block)return;
  const controls=nativeCardReminderControls(nativeBusyReminderKey(block),block.label,dayKey);
  controls.id='block-edit-reminders';
  document.querySelector('#block-edit-sheet .utility-sheet-actions')?.before(controls);
}
function renderNativeTravelEditorReminders(destination,dayKey){
  document.getElementById('travel-edit-reminders')?.remove();
  if(!window.TingsNative?.isNative || !destination || !dayKey)return;
  nativeEnsureBusyReminderIds();
  const data=load(),owner=nativeReminderOwner(destination,data,sortSettings);
  if(!owner)return;
  const name=destination.kind==='blocked' ? destination.label : (destination.h?.name || data[destination.i]?.name || 'destination');
  const controls=nativeCardReminderControls(owner,name,dayKey,{travelOnly:true});controls.id='travel-edit-reminders';
  const hint=document.createElement('p');hint.className='field-hint';hint.textContent=`Departure and arrival reminders for ${name}.`;controls.querySelector('.utility-disclosure-body').prepend(hint);
  document.querySelector('#travel-edit-sheet .utility-sheet-actions')?.before(controls);
}
function nativeItemReminderControls(owner,name,opts = {}){
  const box = document.createElement('div');
  box.className = 'habit-options-block' + (opts.compact ? ' native-busy-reminders' : '');
  const heading = document.createElement('span');heading.className = 'settings-sublabel';heading.textContent = 'phone reminders';box.append(heading);
  const grid = document.createElement('div');grid.className = 'planning-grid' + (opts.compact ? ' native-busy-reminder-grid' : '');
  const choices=()=>nativeReminderChoices(nativeReminderPreferences(),owner,opts.dayKey);
  const optionalItem = opts.hideMissed ?? (owner.startsWith('item:')
    && isOpportunityHabit(load().find(h=>`item:${h.hid}` === owner)));
  for(const [edge,title] of NATIVE_REMINDER_EDGES){
    if(opts.travelOnly && !edge.startsWith('travel'))continue;
    if(opts.meeting && !['start','end'].includes(edge))continue;
    if(edge==='missed' && !owner.startsWith('item:'))continue;
    if(edge==='missed' && optionalItem)continue;
    const label = document.createElement('label');label.className = 'planning-field';label.append(document.createTextNode(opts.meeting ? (edge==='start'?'when it starts':'when it ends') : title));
    const select = document.createElement('select');select.className = 'mini-select';select.setAttribute('aria-label',`${name}: ${opts.meeting ? edge==='start'?'when it starts':'when it ends' : title} reminder`);
    select.dataset.reminderOwner = owner;select.dataset.reminderEdge = edge;
    for(const [value,text] of [['off','off'],['notification','notification'],['alarm','ringing alarm']]){
      const option = document.createElement('option');option.value = value;option.textContent = text;select.append(option);
    }
    select.value = choices()[edge] || 'off';
    select.addEventListener('change',async ()=>{
      select.disabled = true;
      try{
        const mode = select.value;
        if(mode !== 'off'){
          const api = window.TingsNative.notifications;
          let permission = await api.permissions();
          if(permission.display !== 'granted')permission = await api.requestPermissions();
          if(permission.display !== 'granted')throw new Error('Notifications were not allowed. The reminder was not changed.');
          if(mode === 'alarm' || edge === 'missed'){
            let exact = await api.exactAlarmPermission();
            if(exact.exact_alarm !== 'granted')exact = await api.requestExactAlarmPermission();
            if(exact.exact_alarm !== 'granted')throw new Error('Exact timing access was not allowed. The reminder was not changed.');
          }
        }
        // Permission screens can suspend the app. Merge into the latest saved
        // choices on return so another control's edits are not overwritten.
        const prefs = nativeReminderPreferences();
        if(mode !== 'off')prefs.enabled = true;
        nativeSaveReminderPatch(prefs,owner,{[edge]:mode},opts.dayKey);
        document.querySelector('#native-reminder-controls [aria-label="enable phone reminders"]')?.setAttribute('aria-pressed',String(prefs.enabled));
        nativeReminderLastSignature = '';await reconcileNativeReminders();
        showToast('reminder saved', 2800);
      }catch(error){select.value = choices()[edge] || 'off';showToast(error.message, 5000);}
      finally{select.disabled = false;}
    });label.append(select);grid.append(label);
  }
  const leadLabel=document.createElement('label');leadLabel.className='planning-field';leadLabel.append(document.createTextNode('departure reminder'));
  const lead=document.createElement('select');lead.className='mini-select';lead.dataset.reminderLead=owner;
  lead.setAttribute('aria-label',`${name}: departure reminder lead time`);
  for(const minutes of [0,5,10,15,30,60]){
    const option=document.createElement('option');option.value=String(minutes);option.textContent=minutes ? `${minutes} min before travel` : 'when travel starts';lead.append(option);
  }
  lead.value=String(nativeReminderLeadMinutes(choices()));
  lead.addEventListener('change',async()=>{
    lead.disabled=true;
    try{
      const prefs=nativeReminderPreferences();nativeSaveReminderPatch(prefs,owner,{travelLeadMinutes:Number(lead.value)},opts.dayKey);
      nativeReminderLastSignature='';await reconcileNativeReminders();
      showToast('departure reminder timing saved');
    }finally{lead.disabled=false;}
  });leadLabel.append(lead);if(!opts.meeting)grid.append(leadLabel);
  if(opts.meeting){
    const label=document.createElement('label');label.className='planning-field';label.textContent='remind me';
    const select=document.createElement('select');select.className='mini-select';select.setAttribute('aria-label','event reminder timing');
    for(const n of [0,5,10,15,30,60]){const option=document.createElement('option');option.value=String(n);option.textContent=n ? `${n} min before` : 'at the start';select.append(option);}
    select.value=String(nativeMeetingLeadMinutes(choices()));
    select.addEventListener('change',async()=>{
      nativeSaveReminderPatch(nativeReminderPreferences(),owner,{startLeadMinutes:Number(select.value)},opts.dayKey);
      nativeReminderLastSignature='';await reconcileNativeReminders();showToast('reminder saved');
    });label.append(select);grid.append(label);
  }
  if(owner.startsWith('item:') && !optionalItem && !opts.travelOnly){
    const label=document.createElement('label');label.className='planning-field';label.append(document.createTextNode('drop warning timing'));
    const select=document.createElement('select');select.className='mini-select';select.dataset.reminderMissedLead=owner;
    select.setAttribute('aria-label',`${name}: drop warning lead time`);
    for(const minutes of [5,15]){
      const option=document.createElement('option');option.value=String(minutes);option.textContent=`${minutes} min before drop`;select.append(option);
    }
    select.value=String(nativeReminderMissedLeadMinutes(choices()));
    select.addEventListener('change',async()=>{
      select.disabled=true;
      try{
        nativeSaveReminderPatch(nativeReminderPreferences(),owner,{missedLeadMinutes:Number(select.value)},opts.dayKey);
        nativeReminderLastSignature='';await reconcileNativeReminders();showToast('drop warning timing saved');
      }finally{select.disabled=false;}
    });label.append(select);grid.append(label);
  }
  const hint = document.createElement('p');hint.className = 'field-hint';hint.textContent = opts.compact || optionalItem ? 'Reminders save immediately on this phone.' : 'Warns before the estimated last chance to fit this item, which can differ from its suggested start. Choose 5 or 15 minutes and notification or ringing alarm. Both use exact timing access. Sudden drops alert promptly. Saved on this phone.';
  box.append(grid,hint);return box;
}
function renderNativeDetailReminders(h){
  document.getElementById('detail-native-reminders')?.remove();
  if(!window.TingsNative?.isNative || h.type === 'zero')return;
  const host = document.querySelector('[data-detail-nav="actions"]');
  if(host){
    const section = document.createElement('details');section.className = 'detail-disclosure';section.id = 'detail-native-reminders';
    section.open = nativeReminderAnyOn(`item:${h.hid}`);
    const summary = document.createElement('summary');summary.textContent = 'phone notifications & alarms';
    section.append(summary,h.source==='device' && h.calendarSeriesId ? nativeCalendarReminderScope(h) : nativeItemReminderControls(`item:${h.hid}`,h.name,{hideMissed:isEventItem(h) || isOpportunityHabit(h),meeting:isEventItem(h)}));
    // Detail pages no longer carry a section-label header (the page nav names
    // the section), so lead the actions page with the controls instead.
    host.prepend(section);
  }
}
function renderNativeBusyReminders(wrap,blocks){
  if(!window.TingsNative?.isNative)return;
  blocks.forEach((block,i)=>{
    const row = wrap.querySelector(`[data-blocked-row="${i}"]`);
    if(row)row.append(nativeItemReminderControls(nativeBusyReminderKey(block,i),block.label,{compact:true}));
  });
}
function nativeReminderAnyOn(owner){
  const choice = nativeReminderChoices(nativeReminderPreferences(),owner);
  if(!choice)return false;
  return [choice,...Object.values(choice.dates || {})].some(c=>NATIVE_REMINDER_EDGES.some(([edge])=>c[edge] && c[edge] !== 'off'));
}
function nativeReminderUsesAlarm(owner){
  const choice = nativeReminderChoices(nativeReminderPreferences(),owner);
  if(!choice)return false;
  return [choice,...Object.values(choice.dates || {})].some(c=>NATIVE_REMINDER_EDGES.some(([edge])=>c[edge] === 'alarm'));
}
function nativeReminderCardPill(h){
  if(!window.TingsNative?.isNative || !h || !h.hid || h.type === 'zero')return '';
  if(sortSettings && sortSettings.showRemindersOnCards === false)return '';
  const owner = `item:${h.hid}`;
  if(!nativeReminderAnyOn(owner))return '';
  const alarm = nativeReminderUsesAlarm(owner);
  const label = alarm ? 'ringing alarm on' : 'notification on';
  return `<span class="context-pill reminder-pill icon-only" aria-label="${label}" title="${label}"><i class="ti ${alarm ? 'ti-bell-ringing' : 'ti-bell'}" aria-hidden="true"></i></span>`;
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
function nativeMeetingLeadMinutes(choices){const n=Number(choices?.startLeadMinutes);return [0,5,10,15,30,60].includes(n)?n:0;}
function nativeReminderLeadMinutes(choices){
  const minutes=Number(choices?.travelLeadMinutes);
  return [0,5,10,15,30,60].includes(minutes) ? minutes : 0;
}
function nativeReminderMissedLeadMinutes(choices){return Number(choices?.missedLeadMinutes)===5 ? 5 : 15;}
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
// Missing worker annotations must not turn a suggested start into a deadline.
// Keep week-wide coverage with a cheap estimate of the last contiguous window
// around the saved commitments. No placement, travel lookup or solve in paint.
function nativeReminderProvisionalDropAt(h,row,day,settings,data,dataById){
  const base=day.dayBase;
  if(h.type==='task' && !h.breakable && Number.isFinite(h.eventTime))
    return h.eventTime+clampDuration(h.durationMinutes)*60000;
  const plan=timedPlanLogForDay(h,dateKey(base));
  if(plan)return logTime(plan)+clampDuration(h.durationMinutes)*60000;
  // Window geometry cannot prove a later opportunity for linked, traveling or
  // weather-guided work. Keep its existing early coverage until worker refresh.
  if(plannerOrderConstraintsForDay(base).some(e=>e.beforeHid===h.hid || e.afterHid===h.hid)
    || (day.timeline || []).some(r=>r.kind==='travel')
    || weatherHabitHasActiveGuidance(h,settings))return row.start;
  const option=normalizeHabitScheduleOptions(h.scheduleOptions).find(o=>o.id===row.scheduleOptionId);
  const subject=option && habitScheduleOptionSameDayMode(option)==='separate' ? habitBoundToScheduleOption(h,option) : h;
  const loc=(settings.locations || []).find(place=>place.id===row.locationId) || null;
  const windows=effectiveLocationWindow(subject,loc,new Date(base).getDay(),base);
  const cost=(h.breakable ? minViableSessionMinutes(h,base) : clampDuration(h.durationMinutes))*60000;
  if(cost<=0)return null;
  const blockers=(day.timeline || []).filter(r=>{
    if(!['fill','scheduled'].includes(r.kind))return false;
    const other=dataById.get(r.hid || r.h?.hid || data[r.i]?.hid);
    return other && other.hid!==h.hid
      && (r.kind==='scheduled' || r.hard || effectivePriority(other)<=effectivePriority(h));
  });
  const state={slots:buildOpenAgendaSlots(dateKey(base),[],settings,{clipAfter:base}),
    rows:[],fills:blockers.map(r=>({fit:{placeStart:r.start,placeEnd:r.end}}))};
  let latest=null;
  for(const window of windows){
    const segments=freeSegmentsInWindow(state,base+window.start*60000,base+window.end*60000);
    for(const segment of segments){
      if(segment.end-segment.start<cost)continue;
      const start=Math.floor((segment.end-cost)/(5*60000))*(5*60000);
      latest=Math.max(latest ?? -Infinity,start+1);
    }
  }
  // A saved feasible row still gets coverage if its windows cannot be resolved.
  return latest ?? (Number.isFinite(row.start) ? row.start : null);
}
function nativeReminderOccurrence(row,data,day,dataById = null){
  const dayKey=day.dayKey || dateKey(day.dayBase);
  if(row?.kind==='blocked')return `busy:${dayKey}`;
  const hid=row?.h?.hid || data[row?.i]?.hid;
  const h=dataById ? dataById.get(hid) : data.find(item=>item.hid===hid);
  if(!h)return '';
  // A dismissal is for this occurrence, even if the next rebuild moves it.
  // Split chunks remain separate appointments; their clocks distinguish them.
  const occurrenceDay=isLocalAppointment(h) ? dateKey(row.start) : dayKey;
  return `${h.hid}:${occurrenceDay}:${row.occurrenceKey || row.scheduleOptionId || 'main'}${h.breakable ? ':'+row.start : ''}`;
}
function nativeReminderEvents(week,data,settings,prefs,now = Date.now(),previousWeek = null,warningNow = now){
  prefs=nativeCalendarReminderPreferences(prefs,data);
  const events = new Map();
  if(!prefs.enabled || !week || !Array.isArray(week.days))return [];
  const dataById=new Map(data.map(h=>[h.hid,h]));
  const todayBase=dayStart(now),forecast=week.dropForecast;
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
    const sequence = homeDaySequence({...day,timeline:active},settings);
    sequence.forEach((row,i)=>{
      if(row.kind !== 'travel')return;
      const destination = sequence.slice(i+1).find(next=>next.kind !== 'travel' && next.start === row.end && next.locationId === row.to);
      active.push({...row,reminderOwner:nativeReminderOwner(destination,data,settings,dataById),
        reminderOccurrence:nativeReminderOccurrence(destination,data,day,dataById),
        reminderFixedStart:destination?.kind==='scheduled' || destination?.hard===true});
    });
    active.push(...blockedTimelineRows(day.dayKey || dateKey(day.dayBase),settings,day.dayBase,{clipAfter:null}));
    const provisionalDrops=new Map();
    for(const r of active){
      if(!['fill','scheduled'].includes(r.kind))continue;
      const item=dataById.get(r.h?.hid || data[r.i]?.hid);if(!item || isLocalAppointment(item) || isOpportunityHabit(item))continue;
      if(!['notification','alarm'].includes(nativeReminderChoices(prefs,`item:${item.hid}`,day.dayKey || dateKey(day.dayBase)).missed)
        || (Number.isFinite(r.dropAt) && r.dropAt>warningNow))continue;
      const key=`${item.hid}:${item.breakable ? 'remaining' : r.scheduleOptionId || 'main'}`;
      const cutoff=nativeReminderProvisionalDropAt(item,r,{...day,timeline:active},settings,data,dataById);
      if(Number.isFinite(cutoff))provisionalDrops.set(key,Math.max(provisionalDrops.get(key) ?? -Infinity,cutoff));
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
      const reminderDayKey=isLocalAppointment(h) ? dateKey(row.start) : day.dayKey || dateKey(day.dayBase);
      const completion=h && !isEventItem(h) ? {hid:h.hid,dayKey:reminderDayKey,
        occurrenceKey:row.occurrenceKey || '',scheduleOptionId:row.scheduleOptionId || '',
        minutes:h.breakable ? Math.max(1,Math.round((row.end-row.start)/60000)) : 0} : null;
      const choices=nativeReminderChoices(prefs,owner,reminderDayKey);
      const currentDay=day.dayBase===todayBase;
      if(h && !isEventItem(h) && !isOpportunityHabit(h) && ['notification','alarm'].includes(choices?.missed) && day.dayBase>=todayBase && day.dayBase<now+7*86400000){
        const forecastKey=agendaForecastIdentity(row,data),risk=validForecast && currentDay ? forecast.risks?.[forecastKey] : null;
        // A later sample can restore an item after an earlier opportunity
        // has already passed. Never postpone the current estimate merely
        // because that future pack still contains it; adopt that pack first.
        const estimate=row.dropAt;
        // Every enabled displayed occurrence gets an early schedule. If the
        // constraint-aware estimate is unavailable, the last compatible window
        // is the provisional opportunity. Future days need no extra cutoff
        // probes or solves: pre-arm from their saved rows, then refine when
        // each day becomes current. No placement runs in projection.
        const fallback=provisionalDrops.get(`${h.hid}:${h.breakable ? 'remaining' : row.scheduleOptionId || 'main'}`);
        const estimatedAt=Number.isFinite(estimate) && estimate>warningNow ? estimate : fallback;
        // The forecast sample is an upper bound on loss, not its exact instant.
        // Never replace an earlier usable cutoff with that later sample clock.
        const agendaAt=risk ? Math.min(risk.at,Number.isFinite(estimatedAt) ? estimatedAt : Infinity) : estimatedAt;
        const leadMinutes=nativeReminderMissedLeadMinutes(choices);
        const earliest=nativeReminderAllowedWarningAt(h,row,day,settings,now);
        // A lookahead confirms loss at its sample clock; it must still honor
        // the selected lead. Keep a due confirmed trigger stable across polls.
        const at=Math.max(agendaAt-leadMinutes*60000,
          risk ? (forecast.warningAt ?? forecast.checkedAt+2000) : warningNow+2000,
          earliest,Number(h.snoozedUntil) || 0);
        if(Number.isFinite(agendaAt) && agendaAt>at && at<=now+7*86400000){
          const occurrence=h.breakable ? `${h.hid}:${reminderDayKey}:remaining` : identity;
          const key=`${owner}:${kind}:${occurrence}:Missed`;
          const clock=new Date(agendaAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
          const event={key,at,agendaAt,title,owner,dayKey:reminderDayKey,
            reminderEdge:'missed',delivery:choices.missed,leadMinutes,upNext:false,estimated:!risk,expiresAt:agendaAt+15*60000,
            notificationGroup:`${owner}:${reminderDayKey}:missed`,
            ...(!h.breakable && completion ? {completion} : {}),
            body:risk ? `May drop by ${clock}` : `May drop around ${clock}`};
          // Split work has one remaining-opportunity alarm, using the latest
          // available provisional start if no shared estimate exists.
          events.set(key,event);
        }
      }
      for(const edge of ['Start','End']){
        const agendaAt=Number(row[edge.toLowerCase()]);
        const lead=edge==='Start' ? (kind==='travel' ? nativeReminderLeadMinutes(choices) : isEventItem(h) ? nativeMeetingLeadMinutes(choices) : 0) : 0;
        const desiredAt=agendaAt-lead*60000;
        // Enabling a warning after its lead window starts still warns before
        // departure; native delivery remembers that occurrence after a replan.
        const at=lead>0 && edge==='Start' && agendaAt>now ? Math.max(desiredAt,now+2000) : desiredAt;
        const mode = choices[kind === 'travel' ? 'travel' + edge : edge.toLowerCase()] || 'off';
        if(!['notification','alarm'].includes(mode) || !Number.isFinite(at) || at <= now || at > now + 7*86400000)continue;
        const key = `${owner}:${kind}:${identity}:${edge}`;
        const movableStart=edge==='Start' && (kind==='travel' ? !row.reminderFixedStart && destinationHabit && !(destinationHabit.type==='task' && !destinationHabit.breakable && Number.isFinite(destinationHabit.eventTime)) : h && !(h.type==='task' && !h.breakable && Number.isFinite(h.eventTime)) && row.hard!==true && row.kind!=='scheduled');
        const clock=new Date(agendaAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
        events.set(key,{key,at,agendaAt,title,owner,
          upNext:Boolean(movableStart),upNextBody:`Up next · ${clock}`,notificationGroup:`${owner}:${reminderDayKey}:${kind === 'travel' ? 'travel'+edge : edge.toLowerCase()}`,
          expiresAt:edge==='Start' && kind!=='travel' ? Math.max(at,Number(row.end))+15*60000 : agendaAt+15*60000,
          dayKey:reminderDayKey,...(completion ? {completion} : {}),reminderEdge:kind === 'travel' ? 'travel' + edge : edge.toLowerCase(),delivery:mode,body:`${kind === 'travel' ? edge==='Start' ? 'Leave' : 'Arrive' : edge==='Start' ? 'Start' : 'End'} · ${clock}`});
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
      const choices=nativeReminderChoices(prefs,owner,dateKey(today));
      if(!h || isOpportunityHabit(h) || h.type==='zero' || present.has(hid) || !['notification','alarm'].includes(choices.missed)
        || completedOnDay(h,today) || Number(h.snoozedUntil)>now
        || (hasDaySchedule(h) && !isDateEligibleForHabit(h,today))
        || !windowStillDoableToday(h,now,settings))continue;
      if(now+2000<nativeReminderAllowedWarningAt(h,row,currentDay,settings,now))continue;
      // A predicted drop already warned; reserve this alert for sudden losses.
      if(Number.isFinite(row.warnedDropAt) && row.warnedDropAt<=now+60000)continue;
      const missedAt=now+15*60000;
      const key=`${owner}:Slipped:${dateKey(today)}`;
      events.set(key,{key,at:now+2000,agendaAt:missedAt,title:h.name || 'Ting',body:'Slipped · still time',owner,
        dayKey:dateKey(today),reminderEdge:'missed',delivery:choices.missed,upNext:false,slipped:true,expiresAt:missedAt,
        notificationGroup:`${owner}:${dateKey(today)}:missedDrop`,
        ...(!h.breakable ? {completion:{hid,dayKey:dateKey(today),minutes:0}} : {})});
    }
  }
  // The future normal result also prepares ordinary edges beyond its clock.
  // Current edges due before that clock retain their existing schedule.
  if(validForecast){
    const futurePrefs={...prefs,items:Object.fromEntries(Object.entries(prefs.items || {})
      .map(([owner,choice])=>[owner,{...choice,missed:'off',dates:Object.fromEntries(Object.entries(choice.dates || {}).map(([day,patch])=>[day,{...patch,missed:'off'}]))}]))};
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
  const owners=data.filter(h=>!isOpportunityHabit(h) && Object.values({series:prefs.items?.[`item:${h.hid}`],...prefs.items?.[`item:${h.hid}`]?.dates}).some(choice=>['notification','alarm'].includes(choice?.missed))).map(h=>h.hid);
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
  for(const key of [KEY,SORT_SETTINGS_KEY,...PLANNER_WORKER_STORAGE_KEYS,WEATHER_CACHE_KEY,'tings_device_calendars_v1','tings_device_calendar_styles_v1']){
    const value = localStorage.getItem(key);if(value != null)storage[key] = value;
  }
  // Last-refresh display text is not a planner input.
  if(typeof deviceCalendarPreferences==='function'){
    const {enabled,calendarIds}=deviceCalendarPreferences();
    storage.tings_device_calendars_v1=JSON.stringify({enabled,calendarIds});
  }
  const data=load(),mounted=typeof _homeRenderedWeek !== 'undefined' ? _homeRenderedWeek : null;
  // Memoized future days are safe only when this agenda matches saved inputs.
  const compatible=mounted && typeof _optimizerHomeReadyDirtyKey !== 'undefined'
    && _optimizerHomeReadyDirtyKey === homePlannerDirtyKey(data);
  const rawPrefs=nativeReminderPreferences();
  const saved=nativeReminderDeliveryPreferences(data,rawPrefs);
  const owners=new Set(data.filter(h=>h.type!=='zero' && !(h.type==='task' && isTaskDone(h))).map(h=>`item:${h.hid}`));
  normalizeBlockedTimes(sortSettings.blockedTimes).forEach((block,i)=>owners.add(nativeBusyReminderKey(block,i)));
  // Native cancellation uses resolved current choices. Background imports use
  // the raw overrides so new/moved occurrences inherit without stale completion.
  const calendarOverrides=Object.fromEntries(Object.entries(rawPrefs.items).filter(([owner])=>owner.startsWith('calendar-series:') || owner.startsWith('item:device:')));
  const prefs={...saved,calendarOverrides,items:Object.fromEntries(Object.entries(saved.items).filter(([owner])=>owners.has(owner) || owner.startsWith('calendar-series:')))};
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
    typeof deviceCalendarPreferences==='function'
      ? JSON.stringify([deviceCalendarPreferences().enabled,deviceCalendarPreferences().calendarIds,deviceCalendarStyles()]) : '',
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
  const detail=document.getElementById('native-background-detail');
  if(detail)detail.textContent=state.enabled
    ? `Closed refresh: about 15 minutes with drop reminders enabled; 30 minutes otherwise. Android may delay it.${state.background ? ' Background location is allowed.' : ' Uses the last saved place. Allow background location to detect movement.'}${state.plannedAt ? ` Last background update: ${new Date(state.plannedAt).toLocaleString()}.` : ''}${state.dropEstimated ? ` ${state.dropEstimated} estimated drop warnings.` : ''}${state.dropConfirmed ? ` ${state.dropConfirmed} confirmed drop warnings.` : ''}${state.exact===false && state.dropEstimated+state.dropConfirmed>0 ? ' Exact timing access is off: ringing drops cannot fire and drop notifications may arrive late.' : ''}${state.error ? ` ${state.error}` : ''}`
    : 'Background refresh is off. The phone follows its last saved agenda.';
  if(node)node.textContent=state.error ? `Refresh needs attention: ${state.error}` : state.enabled
    ? `Updates about every 15–30 min · ${state.background ? 'background location allowed' : 'uses saved place'}${state.exact===false && state.dropEstimated+state.dropConfirmed>0 ? ' · allow exact timing for drop alerts' : ''}`
    : 'Off · reminders use the last saved agenda.';
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
  const detail=document.getElementById('native-reminder-detail');
  if(detail)detail.textContent = `${exact.exact_alarm === 'granted' ? 'Exact timing allowed' : 'Timing may be delayed'}${updated ? ` · updated ${new Date(updated).toLocaleString()}` : ''}. Reminders follow the latest saved agenda.`;
  node.textContent = `${permission.display === 'granted' ? `${count} notifications${alarms ? ` · ${alarms.pending} alarms` : ''} scheduled` : 'Notification permission needed'}${exact.exact_alarm !== 'granted' ? ' · allow exact timing' : ''}${alarms && !alarms.fullScreen ? ' · allow full-screen alarms for lock-screen controls' : ''}${window.TingsNative.background && nativeAgendaChannelEnabled===false ? ' · agenda notifications are off in Android settings' : ''}`;
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
  panel.insertAdjacentHTML('beforeend',uiSettingsHelpHtml({id:'native-reminders-help',title:'phone notifications & alarms',body:'<p>Choose reminders in each habit or task’s Actions tab, or under each busy time. New items start with reminders off. These choices stay on this phone.</p><p id="native-reminder-detail"></p>'}));
  const help = panel.querySelector('#native-reminders-help');
  const prefs = nativeReminderPreferences();
  const toggle = document.createElement('div');
  const title = document.createElement('span');title.innerHTML = '<b>enable phone reminders</b><small>Use the reminders chosen on each item.</small>';
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
  const explanation = document.createElement('p');explanation.className = 'field-hint';explanation.textContent = 'Choose reminders in an item’s Actions tab or a busy time.';panel.append(explanation);
  const exact = document.createElement('button');exact.type = 'button';exact.className = 'mini-text-btn';exact.textContent = 'Allow exact timing';
  exact.addEventListener('click',async ()=>{
    try{await window.TingsNative.notifications.requestExactAlarmPermission();}
    catch(error){showToast(error.message);}
  });
  const test = document.createElement('button');test.type = 'button';test.className = 'mini-text-btn';test.textContent = 'Test notification · 10s';
  test.addEventListener('click',async ()=>{
    try{
      await window.TingsNative.notifications.requestPermissions();
      if(window.TingsNative.notifications.testAgenda)await window.TingsNative.notifications.testAgenda();
      else await window.TingsNative.notifications.schedule({id:900001,title:'Tings test',body:'Phone notifications are working.',at:Date.now()+10000});
      showToast('Test scheduled in 10 seconds');
    }catch(error){showToast(error.message);}
  });
  const policy = document.createElement('p');policy.textContent='When a flexible start or departure stays within 5 minutes, its notification keeps the earlier reminder time and shows the latest agenda time. Each occurrence alerts once; repeat notifications for the same item and reminder type are quiet for 30 minutes. Remind in 5 min is your explicit exception.';help.append(policy);
  const status = document.createElement('p');status.id = 'native-reminder-status';status.className = 'field-hint';
  const actions = document.createElement('div');actions.className = 'settings-actions';actions.append(exact,test);
  if(window.TingsNative.notifications.openSettings){
    const settings=document.createElement('button');settings.type='button';settings.className='mini-text-btn';settings.textContent='Android notification settings';
    settings.addEventListener('click',()=>window.TingsNative.notifications.openSettings().catch(error=>showToast(error.message)));actions.append(settings);
  }
  const tools = document.createElement('details');tools.className = 'settings-disclosure';
  tools.innerHTML = '<summary>permissions & tests</summary>';
  tools.append(actions);
  if(window.TingsNative.alarms){
    const hint = document.createElement('p');hint.className = 'field-hint';
    hint.textContent = 'Ringing alarms use your phone’s alarm volume and continue until you act. Snooze rings again in 5 minutes. Notifications have Remind in 5 minutes, Dismiss for today, and Mark done. Stop/Dismiss for today silences this item’s reminders today, even if its schedule moves. Mark done works without unlocking or opening Tings: it saves the completion and silences today’s reminders. History updates when you next open Tings; split habits log only this session. Events, travel and busy time have no completion action.';
    const fullScreen = document.createElement('button');fullScreen.type = 'button';fullScreen.className = 'mini-text-btn';fullScreen.textContent = 'Allow full-screen alarms';
    fullScreen.addEventListener('click',async ()=>{try{await window.TingsNative.alarms.requestFullScreen();}catch(error){showToast(error.message);}});
    const alarmTest = document.createElement('button');alarmTest.type = 'button';alarmTest.className = 'mini-text-btn';alarmTest.textContent = 'Test ringing alarm · 10s';
    alarmTest.addEventListener('click',async ()=>{
      try{await window.TingsNative.notifications.requestPermissions();await window.TingsNative.alarms.test();showToast('Alarm will ring in 10 seconds. Snooze or stop to end it.');}
      catch(error){showToast(error.message);}
    });help.append(hint);actions.append(fullScreen,alarmTest);
  }
  panel.append(status,tools);
  if(window.TingsNative.background){
    const background=document.createElement('button');background.id='native-background-toggle';background.type='button';
    background.className='setting-toggle setting-switch compact-toggle';background.setAttribute('aria-pressed','false');
    background.innerHTML='<span><b>refresh agenda while closed</b><small>Update your saved agenda.</small></span><span class="switch-ui" aria-hidden="true"></span>';
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
    const backgroundRow=document.createElement('div');backgroundRow.className='settings-toggle-row native-background-row';
    backgroundRow.append(background);
    backgroundRow.insertAdjacentHTML('beforeend',uiSettingsHelpButtonHtml('native-background-help','closed-app refresh')+'<div class="settings-help-body" id="native-background-help" hidden><p id="native-background-detail"></p></div>');
    backgroundRow.querySelector('.settings-help-body').prepend(hint);
    panel.append(backgroundRow,location,backgroundStatus);
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
    showToast('Drop warnings now offer notification or ringing alarm, with 5 or 15 minutes of notice.');
  }
  void refreshNativeBackgroundStatus(true).catch(()=>{});
}
document.addEventListener('DOMContentLoaded',initNativeReminders);
