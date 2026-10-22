// Android supplies complete, read-only snapshots. This merge also runs in the
// background planner's private mirror; it never needs OAuth or a Tings server.
const DEVICE_CALENDARS_KEY = 'tings_device_calendars_v1';
function deviceCalendarPreferences(){
  try{
    const p = JSON.parse(localStorage.getItem(DEVICE_CALENDARS_KEY) || '{}');
    return {enabled:p.enabled === true,calendarIds:Array.isArray(p.calendarIds)
      ? [...new Set(p.calendarIds.filter(id=>typeof id === 'string' && /^\d{1,20}$/.test(id)))] : [],updatedAt:Number(p.updatedAt) || 0};
  }catch{return {enabled:false,calendarIds:[],updatedAt:0};}
}
function isDeviceCalendarTask(h){return h?.source === 'device';}
function syncDeviceCalendarDetail(h){
  const synced=isDeviceCalendarTask(h),sheet=document.getElementById('detail-sheet');
  for(const section of sheet.querySelectorAll('[data-detail-nav="schedule"],[data-detail-nav="effort"],[data-detail-nav="identity"]'))section.inert=synced;
  for(const id of ['detail-name','detail-delete','detail-mark-edit-emoji'])document.getElementById(id).disabled=synced;
  let hint=document.getElementById('detail-device-calendar-hint');
  if(!hint){hint=document.createElement('p');hint.id='detail-device-calendar-hint';hint.className='field-hint';sheet.querySelector('.detail-page-nav').before(hint);}
  hint.textContent='Synced from your phone calendar. Edit the meeting there; use calendar import settings to stop syncing.';
  hint.hidden=!synced;
  if(synced)document.getElementById('detail-save').disabled=true;
}
function reconcileDeviceCalendarSnapshot(data,snapshot,options={}){
  const ids = options.calendarIds || snapshot?.calendarIds;
  if(!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.calendarIds)
    || !Array.isArray(ids) || !Number.isFinite(snapshot.from) || !Number.isFinite(snapshot.to) || snapshot.to <= snapshot.from
    || ids.length !== snapshot.calendarIds.length || ids.some(id=>!snapshot.calendarIds.includes(id))){
    throw new Error('Calendar refresh was incomplete. Existing meetings were kept.');
  }
  const now = options.now ?? Date.now(), selected = new Set(ids), seen = new Set(), imported = new Set();
  const before = JSON.stringify(data), next = data.map(h=>({...h,logs:[...(h.logs || [])]}));
  const byExternal = new Map(next.filter(isDeviceCalendarTask).map(h=>[h.externalId,h]));
  let added=0,updated=0,removed=0;
  for(const ev of snapshot.events){
    if(!ev || typeof ev.id !== 'string' || !ev.id.startsWith('device:') || !selected.has(ev.calendarId)
      || !Number.isFinite(ev.start) || !Number.isFinite(ev.end) || ev.end <= ev.start
      || ev.end <= snapshot.from || ev.start >= snapshot.to || seen.has(ev.id)){
      throw new Error('Calendar refresh contained invalid meetings. Existing meetings were kept.');
    }
    seen.add(ev.id);
    if(ev.isAllDay && options.allDayMode !== 'tasks')continue;
    imported.add(ev.id);
    const mapped=mapEventToTask(ev,'device');
    Object.assign(mapped,{calendarId:ev.calendarId,calendarStart:ev.start,calendarEnd:ev.end,
      showOnSharedDisplay:false,allowSharedDisplayCompletion:false});
    const existing=byExternal.get(ev.id);
    if(!existing){
      // The foreground and private background mirror must produce the same id.
      mapped.hid=ev.id;
      next.push(normalize([mapped])[0]);added++;
    }else{
      const moved=existing.calendarStart !== ev.start || existing.calendarEnd !== ev.end;
      const changed=moved || existing.name !== mapped.name || existing.eventTime !== mapped.eventTime;
      const logs=moved && ev.end > now ? [] : existing.logs;
      Object.assign(existing,mapped,{hid:existing.hid,logs,importedAt:changed ? now : existing.importedAt});
      existing.lastLog=latestActualLog(logs);
      if(changed)updated++;
    }
  }
  const kept=next.filter(h=>{
    if(!isDeviceCalendarTask(h))return true;
    const start=h.calendarStart ?? h.eventTime ?? h.dueDate;
    const end=h.calendarEnd ?? (start + (h.durationMinutes || 30)*60000);
    // Keep completed history and its work credit as the rolling window advances.
    if(end <= now)return true;
    const inWindow=start < snapshot.to && end > snapshot.from;
    const missing=!selected.has(h.calendarId) || (inWindow && !imported.has(h.externalId));
    const skippedAllDay=h.eventTime == null && options.allDayMode !== 'tasks';
    if(missing || skippedAllDay){removed++;return false;}
    return true;
  });
  rebuildCalendarCredits(kept,options.creditHabitId,{preserveBefore:snapshot.from});
  const normalized=normalize(kept);
  return {data:normalized,added,updated,removed,changed:before !== JSON.stringify(normalized)};
}
function applyDeviceCalendarSnapshot(snapshot,options={}){
  const settings=loadSortSettings();
  const result=reconcileDeviceCalendarSnapshot(load(),snapshot,{allDayMode:settings.calendarAllDayMode,
    creditHabitId:settings.calendarCreditHabitId,...options});
  if(result.changed)save(result.data);
  return result;
}

let deviceCalendarRefresh=null,deviceCalendarRefreshAgain=false,deviceCalendarChoices=[];
function deviceCalendarStatus(message){const el=document.getElementById('calendar-device-status');if(el)el.textContent=message;}
function renderDeviceCalendarControls(){
  const host=document.getElementById('calendar-device-controls');
  if(!host || !window.TingsNative?.isNative || !window.TingsNative.calendars)return;
  if(!host.children.length)host.innerHTML=`${uiSettingsHelpHtml({id:'calendar-device-help',title:'phone calendar sync',body:'<p>Tings reads titles and times locally. Appointments update from your calendar and clear after they end. Outlook needs “Sync calendars” enabled in its account settings.</p><p>Refreshes on open and on calendar changes while open. For updates while closed, enable “refresh agenda while closed” under phone reminders and choose at least one habit reminder. Android may delay background updates. Imported meetings start with Tings reminders off.</p>'})}
              <div class="btn-row">
                <button class="btn primary" id="calendar-device-choose" type="button">choose phone calendars</button>
                <button class="btn" id="calendar-device-refresh" type="button" hidden>refresh now</button>
                <button class="btn" id="calendar-device-stop" type="button" hidden>stop sync &amp; remove upcoming</button>
              </div>
              <div id="calendar-device-picker" hidden>
                <div id="calendar-device-list"></div>
                <div class="btn-row">
                  <button class="btn primary" id="calendar-device-save" type="button">save calendars</button>
                  <button class="btn" id="calendar-device-cancel" type="button">cancel</button>
                </div>
              </div>
              <p class="field-hint" id="calendar-device-status" role="status" aria-live="polite"></p>`;
  host.hidden=false;
  const prefs=deviceCalendarPreferences();
  document.getElementById('calendar-device-refresh').hidden=!prefs.enabled;
  document.getElementById('calendar-device-stop').hidden=!prefs.enabled;
  if(!deviceCalendarRefresh)deviceCalendarStatus(prefs.enabled
    ? `${prefs.calendarIds.length} calendar${prefs.calendarIds.length===1?'':'s'} selected${prefs.updatedAt ? ' · refreshed '+new Date(prefs.updatedAt).toLocaleString() : ''}.`
    : 'Choose calendars to automatically import the next two weeks.');
}
async function refreshDeviceCalendars(){
  const api=window.TingsNative?.calendars,prefs=deviceCalendarPreferences();
  if(!api || !prefs.enabled || !prefs.calendarIds.length)return;
  if(deviceCalendarRefresh){deviceCalendarRefreshAgain=true;return deviceCalendarRefresh;}
  const selection=JSON.stringify(prefs.calendarIds);
  deviceCalendarRefresh=(async()=>{
    deviceCalendarStatus('Refreshing calendars…');
    try{
      const snapshot=await api.read(prefs.calendarIds);
      const current=deviceCalendarPreferences();
      if(!current.enabled || JSON.stringify(current.calendarIds)!==selection)return;
      const result=applyDeviceCalendarSnapshot(snapshot,{calendarIds:prefs.calendarIds});
      localStorage.setItem(DEVICE_CALENDARS_KEY,JSON.stringify({...current,updatedAt:Date.now()}));
      if(result.changed){
        if(typeof sweepAutoDoneTasks==='function')sweepAutoDoneTasks();
        if(typeof refreshOpenViews==='function')refreshOpenViews();
      }
      if(typeof queueNativeBackgroundSnapshot==='function')queueNativeBackgroundSnapshot();
      deviceCalendarStatus(`Refreshed ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · ${result.added} added, ${result.updated} updated, ${result.removed} removed.`);
    }catch(error){deviceCalendarStatus(error.message || 'Calendar refresh failed. Existing meetings were kept.');}
    finally{deviceCalendarRefresh=null;}
  })();
  await deviceCalendarRefresh;
  if(deviceCalendarRefreshAgain){deviceCalendarRefreshAgain=false;return refreshDeviceCalendars();}
}
async function chooseDeviceCalendars(){
  const api=window.TingsNative?.calendars;if(!api)return;
  try{
    if(!(await api.requestAccess()).granted)throw new Error('Calendar access is off. Allow it in Android app settings to connect.');
    const result=await api.list();deviceCalendarChoices=result.calendars || [];
    const selected=new Set(deviceCalendarPreferences().calendarIds),list=document.getElementById('calendar-device-list');
    list.replaceChildren();
    for(const calendar of deviceCalendarChoices){
      const label=document.createElement('label');label.className='calendar-device-option';
      const input=document.createElement('input');input.type='checkbox';input.value=calendar.id;input.checked=selected.has(calendar.id);
      const body=document.createElement('span'),name=document.createElement('strong'),account=document.createElement('small');
      name.textContent=calendar.name || 'Calendar';account.textContent=calendar.account || '';
      body.append(name,account);label.append(input,body);list.append(label);
    }
    document.getElementById('calendar-device-picker').hidden=false;
    deviceCalendarStatus(deviceCalendarChoices.length ? 'Select calendars, then save.' : 'No phone calendars found. Enable calendar sync for your Google or Outlook account first.');
  }catch(error){deviceCalendarStatus(error.message);}
}
function initDeviceCalendars(){
  if(!window.TingsNative?.isNative || !window.TingsNative.calendars)return;
  renderDeviceCalendarControls();
  document.getElementById('calendar-device-choose').addEventListener('click',()=>void chooseDeviceCalendars());
  document.getElementById('calendar-device-save').addEventListener('click',()=>{
    const calendarIds=[...document.querySelectorAll('#calendar-device-list input:checked')].map(el=>el.value);
    if(!calendarIds.length){deviceCalendarStatus('Choose at least one calendar, or use stop sync.');return;}
    localStorage.setItem(DEVICE_CALENDARS_KEY,JSON.stringify({enabled:true,calendarIds,updatedAt:0}));
    document.getElementById('calendar-device-picker').hidden=true;renderDeviceCalendarControls();void refreshDeviceCalendars();
  });
  document.getElementById('calendar-device-cancel').addEventListener('click',()=>{document.getElementById('calendar-device-picker').hidden=true;renderDeviceCalendarControls();});
  document.getElementById('calendar-device-refresh').addEventListener('click',()=>void refreshDeviceCalendars());
  document.getElementById('calendar-device-stop').addEventListener('click',()=>{
    localStorage.removeItem(DEVICE_CALENDARS_KEY);
    const from=dayStart(Date.now()),to=new Date(new Date(from).setDate(new Date(from).getDate()+14)).getTime();
    applyDeviceCalendarSnapshot({complete:true,calendarIds:[],events:[],from,to},{calendarIds:[]});
    renderDeviceCalendarControls();if(typeof refreshOpenViews==='function')refreshOpenViews();
    if(typeof queueNativeBackgroundSnapshot==='function')queueNativeBackgroundSnapshot();
  });
  window.TingsNative.calendars.onChange(()=>{if(!document.hidden)void refreshDeviceCalendars();}).catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshDeviceCalendars();});
  setInterval(()=>{if(!document.hidden)void refreshDeviceCalendars();},5*60000);
  void refreshDeviceCalendars();
}
document.addEventListener('DOMContentLoaded',initDeviceCalendars);
