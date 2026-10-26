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
// Preferences are separate from provider-owned event fields and outlive the
// rolling import window. A series key is supplied by Android, never by title.
const DEVICE_CALENDAR_STYLES_KEY='tings_device_calendar_styles_v1';
function deviceCalendarStyles(){
  try{const value=JSON.parse(localStorage.getItem(DEVICE_CALENDAR_STYLES_KEY)||'{}');return value && typeof value==='object' && !Array.isArray(value) ? value : {};}catch{return {};}
}
function deviceCalendarSeriesKey(h){return h?.calendarSeriesId ? `series:${h.calendarSeriesId}` : '';}
function deviceCalendarStyle(h,styles=deviceCalendarStyles()){
  return {...styles[deviceCalendarSeriesKey(h)],...styles[h.externalId]};
}
function applyDeviceCalendarStyle(h,styles){
  const style=deviceCalendarStyle(h,styles);
  h.emoji=typeof style.emoji==='string' ? cleanMark(style.emoji) : '';
  h.emojiBgColor=normalizeEmojiBgColor(style.emojiBgColor);
}
function saveDeviceCalendarStyle(h,scope,patch){
  const styles=deviceCalendarStyles(),key=scope==='series' ? deviceCalendarSeriesKey(h) : h.externalId;
  if(!key)return;
  if(patch===null)delete styles[key];else styles[key]={...styles[key],...patch};
  localStorage.setItem(DEVICE_CALENDAR_STYLES_KEY,JSON.stringify(styles));
  const data=load();for(const item of data)if(isDeviceCalendarTask(item))applyDeviceCalendarStyle(item,styles);
  save(data);
  const scopeOpen=document.getElementById('detail-calendar-personalization')?.querySelector('select')?.value;
  if(typeof refreshOpenViews==='function')refreshOpenViews();
  const panel=document.getElementById('detail-calendar-personalization');
  if(panel && scopeOpen){const select=panel.querySelector('select');select.value=scope;select.dispatchEvent(new Event('change'));}
  showToast('icon saved');
  if(typeof queueNativeBackgroundSnapshot==='function')queueNativeBackgroundSnapshot();
}
// Reuse the detail sheet's icon picker and Save action for local preferences.
function renderDeviceCalendarPersonalization(h){
  document.getElementById('detail-calendar-personalization')?.remove();
  if(!isDeviceCalendarTask(h))return;
  const box=document.createElement('div');box.id='detail-calendar-personalization';box.className='appointment-editor';
  const label=document.createElement('label');label.className='planning-field';label.textContent='edit icon for';
  const scope=document.createElement('select');scope.className='settings-select';scope.setAttribute('aria-label','edit icon for');
  for(const [value,text] of (h.calendarSeriesId ? [['series','all dates'],['occurrence','this date']] : [['occurrence','this date']])){
    const option=document.createElement('option');option.value=value;option.textContent=text;scope.append(option);
  }
  scope.value=h.calendarSeriesId && !deviceCalendarStyles()[h.externalId] ? 'series' : 'occurrence';
  label.append(scope);label.hidden=!h.calendarSeriesId;box.append(label);
  const reset=document.createElement('button');reset.type='button';reset.className='mini-text-btn';reset.textContent='use the usual icon for this date';box.append(reset);
  const paint=()=>{
    const styles=deviceCalendarStyles(),style=scope.value==='series' ? styles[deviceCalendarSeriesKey(h)]||{} : deviceCalendarStyle(h,styles);
    $('detail-emoji').value=style.emoji||'';renderEmojiBgSwatches('detail-emoji-bg',style.emojiBgColor||'');
    reset.hidden=scope.value!=='occurrence' || !h.calendarSeriesId || !styles[h.externalId];
    setDetailDirty(false);
  };
  scope.addEventListener('change',paint);
  reset.addEventListener('click',()=>{saveDeviceCalendarStyle(h,'occurrence',null);refreshDetailView();});
  $('detail-appearance-disclosure').before(box);paint();
  $('detail-appearance-disclosure').open=true;
}
function deviceCalendarDetailDirty(h){
  const scope=$('detail-calendar-personalization')?.querySelector('select')?.value;
  if(!scope)return false;
  const styles=deviceCalendarStyles(),style=scope==='series' ? styles[deviceCalendarSeriesKey(h)]||{} : deviceCalendarStyle(h,styles);
  return cleanMark($('detail-emoji').value)!==(style.emoji||'') || selectedEmojiBgColor('detail-emoji-bg')!==normalizeEmojiBgColor(style.emojiBgColor);
}
function saveDeviceCalendarDetail(h){
  const scope=$('detail-calendar-personalization')?.querySelector('select')?.value;
  if(!scope)return;
  saveDeviceCalendarStyle(h,scope,{emoji:cleanMark($('detail-emoji').value),emojiBgColor:selectedEmojiBgColor('detail-emoji-bg')});
  refreshDetailView();render();
}
function syncDeviceCalendarDetail(h){
  const synced=isDeviceCalendarTask(h),sheet=getSheetInner('detail-sheet');
  for(const nav of ['schedule','identity'])sheet.querySelector(`[data-detail-nav="${nav}"]`).inert=false;
  sheet.querySelector('[data-detail-nav="schedule"]').hidden=synced;
  sheet.querySelector('[data-detail-nav="actions"]').hidden=synced && !window.TingsNative?.isNative;
  for(const id of ['detail-name','detail-habit-message'])$(id).disabled=synced;
  $('detail-delete').disabled=synced;$('detail-mark-edit-emoji').disabled=false;
  let hint=$('detail-device-calendar-hint');
  if(!hint){hint=document.createElement('p');hint.id='detail-device-calendar-hint';hint.className='field-hint';sheet.querySelector('.detail-page-nav').before(hint);}
  hint.textContent='Title, time and links come from your phone calendar. Your icon and reminders are saved here.';
  hint.hidden=!synced;
  renderDeviceCalendarPersonalization(h);
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
      calendarSeriesId:typeof ev.seriesId==='string' && ev.seriesId.startsWith(`device:${ev.calendarId}:`) ? ev.seriesId : null,
      links:typeof ev.joinUrl==='string' && /^https:\/\//i.test(ev.joinUrl) ? normalizeLinks([{kind:'link',value:ev.joinUrl}]) : [],
      showOnSharedDisplay:false,allowSharedDisplayCompletion:false});
    applyDeviceCalendarStyle(mapped,options.styles);
    const existing=byExternal.get(ev.id);
    if(!existing){
      // The foreground and private background mirror must produce the same id.
      mapped.hid=ev.id;
      next.push(normalize([mapped])[0]);added++;
    }else{
      const moved=existing.calendarStart !== ev.start || existing.calendarEnd !== ev.end;
      const changed=moved || existing.name !== mapped.name || existing.eventTime !== mapped.eventTime || JSON.stringify(existing.links)!==JSON.stringify(mapped.links) || existing.calendarSeriesId!==mapped.calendarSeriesId;
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
  if(!host.children.length)host.innerHTML=`${uiSettingsHelpHtml({id:'calendar-device-help',title:'phone calendar sync',body:'<p>Tings reads titles, times and available meeting links locally. Descriptions are scanned on the phone for supported meeting links and are not stored. Events update from your calendar and leave the agenda when they end. Outlook needs “Sync calendars” enabled in its account settings.</p><p>Refreshes on open and on calendar changes while open. For updates while closed, enable “refresh agenda while closed” under phone reminders and choose at least one reminder. Android may delay background updates. Tings reminders start off. Your calendar app may also notify you.</p>'})}
              <p class="field-hint">Meetings from calendars on this phone, for the next two weeks.</p>
              <div class="btn-row">
                <button class="btn primary" id="calendar-device-choose" type="button">choose phone calendars</button>
                <button class="btn" id="calendar-device-refresh" type="button" hidden>refresh</button>
                <button class="btn" id="calendar-device-stop" type="button" hidden>stop</button>
              </div>
              <div id="calendar-device-picker" hidden>
                <div id="calendar-device-list"></div>
                <div class="btn-row">
                  <button class="btn primary" id="calendar-device-save" type="button">save calendars</button>
                  <button class="btn" id="calendar-device-cancel" type="button">cancel</button>
                </div>
              </div>
              <p class="field-hint" id="calendar-device-status" role="status" aria-live="polite"></p><p class="field-hint" id="calendar-device-changes"></p>`;
  host.hidden=false;
  const prefs=deviceCalendarPreferences();
  document.getElementById('calendar-device-refresh').hidden=!prefs.enabled;
  document.getElementById('calendar-device-stop').hidden=!prefs.enabled;
  if(!deviceCalendarRefresh)deviceCalendarStatus(prefs.enabled
    ? `${prefs.calendarIds.length} calendar${prefs.calendarIds.length===1?'':'s'}${prefs.updatedAt ? ' · updated '+new Date(prefs.updatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : ''}`
    : 'Choose which calendars to show in Tings.');
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
      deviceCalendarStatus(`${prefs.calendarIds.length} calendar${prefs.calendarIds.length===1?'':'s'} · updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`);
      const changes=document.getElementById('calendar-device-changes');
      if(changes)changes.textContent=result.added || result.updated || result.removed ? `${result.added} new, ${result.updated} changed, ${result.removed} no longer on the calendar` : '';
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
    if(!window.confirm('Stop phone calendar sync? Upcoming phone meetings leave Tings. Past meetings stay.'))return;
    localStorage.removeItem(DEVICE_CALENDARS_KEY);
    const from=dayStart(Date.now()),to=new Date(new Date(from).setDate(new Date(from).getDate()+14)).getTime();
    applyDeviceCalendarSnapshot({complete:true,calendarIds:[],events:[],from,to},{calendarIds:[]});
    $('calendar-device-changes').textContent='';renderDeviceCalendarControls();if(typeof refreshOpenViews==='function')refreshOpenViews();
    if(typeof queueNativeBackgroundSnapshot==='function')queueNativeBackgroundSnapshot();
  });
  window.TingsNative.calendars.onChange(()=>{if(!document.hidden)void refreshDeviceCalendars();}).catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshDeviceCalendars();});
  setInterval(()=>{if(!document.hidden)void refreshDeviceCalendars();},5*60000);
  void refreshDeviceCalendars();
}
document.addEventListener('DOMContentLoaded',initDeviceCalendars);
