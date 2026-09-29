// Shared agenda-to-reminder projection; OS delivery is supplied by the native shell.
// Preferences are device-local and intentionally separate from clone settings.
const NATIVE_REMINDERS_KEY = 'tings_native_reminders_v1';
const NATIVE_REMINDER_DEFAULTS = {version:2,enabled:false,items:{}};
const NATIVE_REMINDER_EDGES = [['start','start'],['end','end'],['travelStart','travel: time to leave'],['travelEnd','travel: arrival']];
function nativeBusyReminderKey(block,index){
  return block ? `busy:${block.reminderId || JSON.stringify([index,block.label,block.start,block.end,block.days])}` : '';
}
function nativeReminderPreferences(){
  try{
    const saved = JSON.parse(localStorage.getItem(NATIVE_REMINDERS_KEY) || 'null');
    if(!saved)return {...NATIVE_REMINDER_DEFAULTS,items:{}};
    if(saved.version === 2)return {...NATIVE_REMINDER_DEFAULTS,...saved};
    // Materialize the old blanket choices once. New items never inherit them.
    const legacy = {taskStart:true,habitStart:true,travelStart:true,...saved};
    const items = {};
    const modes = kind=>Object.fromEntries(NATIVE_REMINDER_EDGES.map(([edge])=>{
      const oldKey = edge.startsWith('travel') ? edge : kind + edge[0].toUpperCase() + edge.slice(1);
      return [edge,legacy[oldKey] ? (legacy.alarmTypes?.[oldKey] ? 'alarm' : 'notification') : 'off'];
    }));
    for(const h of load())items[`item:${h.hid}`] = modes(h.type === 'task' ? 'task' : 'habit');
    normalizeBlockedTimes(sortSettings.blockedTimes).forEach((block,i)=>items[nativeBusyReminderKey(block,i)] = modes('busy'));
    const next = {version:2,enabled:Boolean(saved.enabled),items};
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(next));return next;
  }catch(_){return {...NATIVE_REMINDER_DEFAULTS,items:{}};}
}
function nativeReminderOwner(row,data,settings){
  if(!row)return '';
  if(row.kind === 'blocked')return nativeBusyReminderKey(normalizeBlockedTimes(settings.blockedTimes)[row.blockIndex],row.blockIndex);
  const hid = row.h?.hid || data[row.i]?.hid;
  return hid && data.some(h=>h.hid === hid) ? `item:${hid}` : '';
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
function nativeItemReminderControls(owner,name){
  const box = document.createElement('div');box.className = 'habit-options-block';
  const heading = document.createElement('span');heading.className = 'settings-sublabel';heading.textContent = 'phone reminders';box.append(heading);
  const grid = document.createElement('div');grid.className = 'planning-grid';
  for(const [edge,title] of NATIVE_REMINDER_EDGES){
    const label = document.createElement('label');label.className = 'planning-field';label.append(document.createTextNode(title));
    const select = document.createElement('select');select.className = 'mini-select';select.setAttribute('aria-label',`${name}: ${title} reminder`);
    select.dataset.reminderOwner = owner;select.dataset.reminderEdge = edge;
    for(const [value,text] of [['off','off'],['notification','notification'],['alarm','ringing alarm']]){
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
        showToast(prefs.enabled ? 'phone reminder saved' : 'saved — enable phone reminders in Settings to receive it');
      }catch(error){select.value = nativeReminderPreferences().items[owner]?.[edge] || 'off';showToast(error.message);}
      finally{select.disabled = false;}
    });label.append(select);grid.append(label);
  }
  const hint = document.createElement('p');hint.className = 'field-hint';hint.textContent = 'Saved immediately for this phone. Travel reminders follow the journey to this item; start and end follow its latest agenda times.';
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
    if(row)row.append(nativeItemReminderControls(nativeBusyReminderKey(block,i),block.label));
  });
}
function nativeReminderEvents(week,data,settings,prefs,now = Date.now()){
  const events = new Map();
  if(!prefs.enabled || !week || !Array.isArray(week.days))return [];
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
      const h = data.find(item=>item.hid === hid);
      if(h && !(h.type === 'task' && isTaskDone(h)))active.push(...agendaRowsAfterCompletions(h,items,day.dayBase));
    }
    // Resolve busy-time overrides/relative clocks without Home's 'clip to now'.
    const sequence = homeDaySequence({...day,timeline:active},{...settings,homeExtraMode:'cards'});
    sequence.forEach((row,i)=>{
      if(row.kind !== 'travel')return;
      const destination = sequence.slice(i+1).find(next=>next.kind !== 'travel' && next.start === row.end && next.locationId === row.to);
      active.push({...row,reminderOwner:nativeReminderOwner(destination,data,settings)});
    });
    active.push(...blockedTimelineRows(day.dayKey || dateKey(day.dayBase),settings,day.dayBase,{clipAfter:null}));
    for(const row of active){
      if(!row || !['fill','scheduled','blocked','travel'].includes(row.kind))continue;
      let owner = row.kind === 'travel' ? row.reminderOwner : nativeReminderOwner(row,data,settings);
      if(!owner)continue;
      let kind = 'busy', title = row.label || 'Busy time', identity = `busy:${row.label || ''}:${row.start}`;
      if(row.kind === 'travel'){
        kind = 'travel';
        const destination = row.toName || settings.locations?.find(location=>location.id === row.to)?.name;
        title = destination ? `Travel to ${destination}` : 'Time to leave';
        identity = `travel:${row.from || ''}:${row.to || ''}:${row.start}`;
      }else if(row.kind !== 'blocked'){
        // Never bind a removed item's stale row to a new item at the same index.
        const hid = row.h?.hid || data[row.i]?.hid;
        const h = data.find(item=>item.hid === hid);
        if(!h || h.type === 'zero')continue;
        if(h.type === 'task' && isTaskDone(h))continue;
        kind = h.type === 'task' ? 'task' : 'habit';
        title = h.name || 'Ting';
        identity = `${h.hid}:${row.occurrenceKey || day.dayKey || day.dayBase}:${row.start}`;
      }
      for(const edge of ['Start','End']){
        const at = Number(row[edge.toLowerCase()]);
        const mode = prefs.items?.[owner]?.[kind === 'travel' ? 'travel' + edge : edge.toLowerCase()] || 'off';
        if(!['notification','alarm'].includes(mode) || !Number.isFinite(at) || at <= now || at > now + 7*86400000)continue;
        const key = `${owner}:${kind}:${identity}:${edge}`;
        events.set(key,{key,at,title,owner,reminderEdge:kind === 'travel' ? 'travel' + edge : edge.toLowerCase(),delivery:mode,body:kind === 'travel' && edge === 'Start' ? 'Leave now to follow your agenda' : edge === 'Start' ? 'Scheduled to start' : 'Scheduled to end'});
      }
    }
  }
  return [...events.values()].sort((a,b)=>a.at-b.at || a.key.localeCompare(b.key));
}
let nativeReminderTimer;
let nativeReminderLastSignature = '';
let nativeReminderLastWeek = null;
function queueNativeReminders(){
  if(!window.TingsNative?.isNative)return;
  clearTimeout(nativeReminderTimer);
  nativeReminderTimer = setTimeout(()=>void reconcileNativeReminders(),250);
}
let nativeReminderReconcileQueue = Promise.resolve();
function reconcileNativeReminders(){
  nativeReminderReconcileQueue = nativeReminderReconcileQueue.catch(()=>{}).then(reconcileNativeRemindersNow);
  return nativeReminderReconcileQueue;
}
async function reconcileNativeRemindersNow(){
  const api = window.TingsNative?.notifications;
  if(!api || !window.TingsNative.isNative)return;
  try{
    const prefs = nativeReminderPreferences();
    const mounted = typeof _homeRenderedWeek !== 'undefined' ? _homeRenderedWeek : null;
    if(mounted)nativeReminderLastWeek = mounted;
    const week = mounted || nativeReminderLastWeek;
    // Preserve OS alarms during temporary render transitions and while closed.
    if(prefs.enabled && !week)return;
    const events = nativeReminderEvents(week,load(),sortSettings,prefs);
    const signature = JSON.stringify({events,enabled:prefs.enabled,items:prefs.items});
    if(signature !== nativeReminderLastSignature){
      // Ringing alarms require exact access. Do not silently downgrade them.
      const alarms = window.TingsNative.alarms;
      const ringing = events.filter(e=>e.delivery === 'alarm');
      if(ringing.length && !alarms)throw new Error('Update the Android app to use ringing alarms.');
      if(alarms)await alarms.replaceAgenda(ringing,prefs.enabled,prefs.items);
      await api.replaceAgenda(events.filter(e=>e.delivery !== 'alarm'));
      nativeReminderLastSignature = signature;
      localStorage.setItem('tings_native_reminders_updated',String(Date.now()));
    }
    await renderNativeReminderStatus();
  }catch(error){
    const status = document.getElementById('native-reminder-status');
    if(status)status.textContent = `Reminders need attention: ${error.message}`;
  }
}
async function renderNativeReminderStatus(){
  const node = document.getElementById('native-reminder-status');
  if(!node)return;
  const api = window.TingsNative.notifications;
  const permission = await api.permissions();
  const exact = await api.exactAlarmPermission();
  const pending = await api.pending();
  const updated = Number(localStorage.getItem('tings_native_reminders_updated'));
  const count = pending.notifications.filter(n=>n.extra?.tingsAgenda === true).length;
  const alarms = window.TingsNative.alarms ? await window.TingsNative.alarms.status() : null;
  node.textContent = `${permission.display === 'granted' ? `${count} notifications${alarms ? ` and ${alarms.pending} alarms` : ''} scheduled` : 'Notification permission needed'} · ${exact.exact_alarm === 'granted' ? 'exact timing allowed' : 'timing may be delayed'}${updated ? ` · updated ${new Date(updated).toLocaleString()}` : ''}${alarms && !alarms.fullScreen ? ' · Allow full-screen alarms for the lock-screen controls' : ''}. Uses the last saved agenda when this app is closed.`;
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
      if(enabled && (await window.TingsNative.notifications.requestPermissions()).display !== 'granted')throw new Error('Allow notifications in Android settings.');
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({...current,enabled}));
      input.setAttribute('aria-pressed',String(enabled));nativeReminderLastSignature = '';await reconcileNativeReminders();
    }catch(error){showToast(error.message);}finally{input.disabled = false;}
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
      await window.TingsNative.notifications.schedule({id:900001,title:'Tings test',body:'Phone notifications are working.',at:Date.now()+10000});
      showToast('Test scheduled in 10 seconds');
    }catch(error){showToast(error.message);}
  });
  const status = document.createElement('p');status.id = 'native-reminder-status';status.className = 'field-hint';
  const actions = document.createElement('div');actions.className = 'btn-row';actions.style.flexWrap = 'wrap';actions.append(exact,test);panel.append(actions);
  if(window.TingsNative.alarms){
    const hint = document.createElement('p');hint.className = 'field-hint';
    hint.textContent = 'Ringing alarms use your phone’s alarm volume and continue until Snooze (5 minutes) or Dismiss. Dismiss does not mark a task or habit done.';
    const fullScreen = document.createElement('button');fullScreen.type = 'button';fullScreen.className = 'mini-text-btn';fullScreen.textContent = 'Allow full-screen alarms';
    fullScreen.addEventListener('click',async ()=>{try{await window.TingsNative.alarms.requestFullScreen();}catch(error){showToast(error.message);}});
    const alarmTest = document.createElement('button');alarmTest.type = 'button';alarmTest.className = 'mini-text-btn';alarmTest.textContent = 'Test ringing alarm in 10 seconds';
    alarmTest.addEventListener('click',async ()=>{
      try{await window.TingsNative.notifications.requestPermissions();await window.TingsNative.alarms.test();showToast('Alarm will ring in 10 seconds. Snooze or dismiss to stop it.');}
      catch(error){showToast(error.message);}
    });panel.append(hint);actions.append(fullScreen,alarmTest);
  }
  panel.append(status);host.replaceChildren(panel);
  nativeEnsureBusyReminderIds();
  renderBlockedTimeControls();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){nativeReminderLastSignature = '';queueNativeReminders();}});
  window.addEventListener('focus',queueNativeReminders);
  // Covers edits received by clone reconciliation and same-plan provenance updates.
  setInterval(()=>{if(!document.hidden)queueNativeReminders();},15000);
  queueNativeReminders();
  void renderNativeReminderStatus().catch(()=>{});
}
document.addEventListener('DOMContentLoaded',initNativeReminders);
