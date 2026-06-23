// Add-habit defaults, settings controls, topic management, availability defaults, and sort lab samples.
//
// RN PORT NOTES:
//   - This file manages the settings sheet (sort presets, toggles, topics, availability, sort lab).
//   - RENDER functions become React form components.
//   - HANDLER functions become onPress/onChange callbacks that update the Zustand settings store.

// HANDLER: cancel add sheet and reset form
function cancelAdd(){
  closeSheet('add-sheet');
  applyAddDefaults();
}

// HYBRID: reset add-form fields and selected type
function applyAddDefaults(){
  const settings = loadSortSettings();
  $('ting-message').value = '';
  $('ting-emoji').value = '';
  selectedType = settings.defaultType || 'keepup';
  const target = clampRhythm(settings.defaultTarget || 7);
  syncRhythm('ting',target);
  renderTopicChips('ting-topic-chips',[]);
  const topicsWrap = $('add-topics-section');
  if(topicsWrap)topicsWrap.hidden = false;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o.dataset.v === selectedType));
  const dueInput = $('ting-due-date');
  const eventInput = $('ting-event-time');
  if(dueInput)dueInput.value = '';
  if($('ting-hard-due'))$('ting-hard-due').checked = false;
  if(eventInput)eventInput.value = '';
  syncAddTypeUi(selectedType);
  if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
}

// HYBRID: sync settings UI from stored state
function syncSettingsControls(){
  sortSettings = loadSortSettings();
  const resetConfirm = $('settings-reset-confirm');
  if(resetConfirm)resetConfirm.hidden = true;
  updateSortSampleCount();
  renderSortLabPreview();
  renderTopicList();
  renderAvailabilityControls();
  document.querySelectorAll('#sort-preset-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.preset === (sortSettings.preset || 'custom'));
  });
  document.querySelectorAll('#plan-window-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.window,10) === (sortSettings.planWindowDays ?? 1));
  });
  document.querySelectorAll('#new-build-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.newBuild === (sortSettings.newBuildMode || 'gentle'));
  });
  document.querySelectorAll('#due-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.dueMode === (sortSettings.dueMode || 'relative'));
  });
  document.querySelectorAll('#build-window-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.buildWindow,10) === (sortSettings.buildLookAheadDays ?? 3));
  });
  document.querySelectorAll('#limit-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.limitMode === (sortSettings.limitMode || 'overdue'));
  });
  document.querySelectorAll('#stop-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.stopMode === (sortSettings.stopMode || 'quiet'));
  });
  document.querySelectorAll('#default-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.defaultType === sortSettings.defaultType);
  });
  document.querySelectorAll('[data-setting-toggle]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(Boolean(sortSettings[btn.dataset.settingToggle])));
  });
  syncSettingRange('plan-weight',sortSettings.planWeight,'%');
  syncSettingRange('due-weight',sortSettings.dueWeight,'%');
  syncSettingRange('progress-weight',sortSettings.progressWeight,'%');
  syncSettingRange('trend-weight',sortSettings.trendWeight,'%');
  syncSettingRange('rhythm-weight',sortSettings.rhythmWeight,'%');
  syncSettingRange('build-weight',sortSettings.buildWeight,'%');
  syncSettingRange('limit-weight',sortSettings.limitWeight,'%');
  syncSettingRange('stop-weight',sortSettings.stopWeight,'%');
  syncSettingRange('new-weight',sortSettings.newWeight,'%');
  syncSettingRange('build-start',sortSettings.buildRiseAt,'%');
  syncSettingRange('rhythm-bias',sortSettings.rhythmBias,'');
  syncSettingRange('default-target',sortSettings.defaultTarget,'d');
}

// RENDER: draw weekday availability inputs
function renderAvailabilityControls(){
  const wrap = $('availability-grid');
  if(!wrap)return;
  const availability = normalizeAvailability(sortSettings.availabilityMinutes);
  wrap.innerHTML = WEEKDAY_LABELS.map((label,i)=>`
    <label>
      <span>${label}</span>
      <input type="number" min="0" max="1440" inputmode="numeric" data-availability-day="${i}" value="${availability[i]}" />
    </label>
  `).join('');
}

// HANDLER: save edited availability day value
function saveAvailabilityDay(index,value){
  const availability = normalizeAvailability(sortSettings.availabilityMinutes);
  availability[index] = Math.max(0,Math.min(1440,parseInt(value,10) || 0));
  updateSortSetting({availabilityMinutes:availability},{renderNow:false});
  renderAvailabilityControls();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayAvailability(dayLogsKey);
}

// HYBRID: patch sort state and re-sync UI
function updateSortSetting(patch,options = {}){
  const {sync = true,renderNow = true} = options;
  saveSortSettings({...sortSettings,...patch});
  if(sync)syncSettingsControls();
  if(sortSettings.reachAssist === false)document.body.classList.remove('reach-pad');
  if(renderNow)render();
}

// PURE: check if key is a sort setting
function isSortSettingKey(key){
  return ['plansFirst','planWindowDays','planWeight','dueWeight','progressWeight','trendWeight','rhythmWeight','buildWeight','limitWeight','stopWeight','newWeight','newBuildMode','dueMode','buildLookAheadDays','buildRiseAt','limitMode','stopMode','rhythmBias','focus'].includes(key);
}

// HANDLER: apply a named sort preset
function applySortPreset(name){
  if(name === 'custom'){
    updateSortSetting({preset:'custom'});
    showToast('custom settings');
    return;
  }
  const preset = SORT_PRESETS[name];
  if(!preset)return;
  updateSortSetting({...preset,preset:name});
  showToast('preset applied');
}

// RENDER: highlight active preset button
function markPresetButton(name){
  document.querySelectorAll('#sort-preset-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.preset === name);
  });
}

// HANDLER: toggle a boolean app setting
function toggleAppSettingButton(btn){
  if(!btn)return;
  const key = btn.dataset.settingToggle;
  if(!key)return;
  if(key === 'reminders'){toggleReminders();return;}
  const patch = {[key]:!Boolean(sortSettings[key])};
  if(isSortSettingKey(key))patch.preset = 'custom';
  updateSortSetting(patch);
}

// HANDLER: enable/disable reminders. On enable, ask for notification permission
// from this user gesture. The in-app banner works without any permission, so we
// always enable it; system notifications are a best-effort layer on top.
async function toggleReminders(){
  const turningOn = !Boolean(sortSettings.reminders);
  if(!turningOn){
    updateSortSetting({reminders:false});
    if(typeof hideReminderBanner === 'function')hideReminderBanner();
    showToast('reminders off');
    return;
  }
  let perm = 'unsupported';
  if(typeof requestReminderPermission === 'function')perm = await requestReminderPermission();
  updateSortSetting({reminders:true});
  showToast(perm === 'granted' ? 'reminders on' : 'reminders on · in-app banner');
  setTimeout(()=>{if(typeof checkReminders === 'function')checkReminders();},120);
}

// PURE: count sample habits in list
function sortSampleCount(){
  return load().filter(h=>h.sample).length;
}

// RENDER: update sample count label text
function updateSortSampleCount(){
  const label = $('sort-sample-count');
  if(label)label.textContent = sortSampleCount() ? `${sortSampleCount()} sample habits currently in the list.` : 'No sample habits are in the list.';
}

// PURE: build settings object for preset
function sortSettingsForPreset(name){
  if(name === 'custom')return {...DEFAULT_SORT_SETTINGS,...sortSettings,preset:'custom'};
  return {...DEFAULT_SORT_SETTINGS,...(SORT_PRESETS[name] || SORT_PRESETS.balanced),preset:name};
}

// PURE: strip sample prefix from name
function sampleDisplayName(name){
  return String(name || '').replace(/^Sample:\s*/,'');
}

// RENDER: draw sort lab preview cards
function renderSortLabPreview(){
  const wrap = $('sort-lab-preview');
  if(!wrap)return;
  const samples = normalize(buildSortSamples());
  const previewItems = [
    {name:'current',settings:{...DEFAULT_SORT_SETTINGS,...sortSettings},note:'your setup'},
    ...['balanced','build','planned','todayFirst'].map(name=>({name,settings:sortSettingsForPreset(name)}))
  ];
  wrap.innerHTML = previewItems.map(item=>{
    const {name,settings} = item;
    const orderIndices = visibleIndices(samples,settings)
      .filter(i=>!samples[i].pinned && !(samples[i].snoozedUntil && Date.now() < samples[i].snoozedUntil));
    const order = orderIndices
      .slice(0,6)
      .map(i=>{
        const h = samples[i];
        const type = h.type === 'keepup' ? 'build' : h.type === 'reduce' ? 'limit' : h.type === 'task' ? 'task' : h.type === 'event' ? 'event' : 'stop';
        return `<li><span>${escapeHtml(sampleDisplayName(h.name))}</span><b class="${h.type}">${type}</b></li>`;
      }).join('');
    const freshStop = orderIndices.findIndex(i=>samples[i].type === 'zero' && daysSince(samples[i].lastLog) !== null && daysSince(samples[i].lastLog) < 3);
    const quietStop = orderIndices.findIndex(i=>samples[i].type === 'zero' && daysSince(samples[i].lastLog) !== null && daysSince(samples[i].lastLog) >= 14);
    const newStop = orderIndices.findIndex(i=>samples[i].type === 'zero' && samples[i].lastLog === null);
    const stopLine = `fresh reset #${freshStop + 1 || '-'} · clear stretch #${quietStop + 1 || '-'} · no entry #${newStop + 1 || '-'}`;
    const overdueLimit = orderIndices.findIndex(i=>samples[i].type === 'reduce' && sampleDisplayName(samples[i].name).includes('ready to review'));
    const tooOftenLimit = orderIndices.findIndex(i=>samples[i].type === 'reduce' && sampleDisplayName(samples[i].name).includes('too often'));
    const limitLine = `limit overdue #${overdueLimit + 1 || '-'} · too often #${tooOftenLimit + 1 || '-'}`;
    const note = item.note || (name === 'planned'
        ? 'plans lead'
        : name === 'build'
          ? 'builds lead'
          : name === 'todayFirst'
            ? 'today & overdue first'
            : 'mixed signals');
    const activeClass = name === 'current' ? 'current' : name === (sortSettings.preset || 'balanced') ? 'on' : '';
    return `<article class="sort-preview-card ${activeClass}">
      <div><strong>${escapeHtml(name)}</strong><small>${note}</small></div>
      <ol>${order}</ol>
      <p class="sort-stop-line">${escapeHtml(limitLine)}</p>
      <p class="sort-stop-line">${escapeHtml(stopLine)}</p>
    </article>`;
  }).join('');
}

// PURE: build a sample habit object
function sortSampleHabit(name,type,target,logs,options = {}){
  return {
    name:`Sample: ${name}`,
    type,
    target:(type === 'zero' || type === 'task' || type === 'event') ? null : target,
    dueDate:type === 'task' ? (options.dueDate ?? null) : null,
    hardDue:type === 'task' ? Boolean(options.hardDue) : false,
    eventTime:type === 'event' ? (options.eventTime ?? null) : null,
    createdAt:options.createdAt || Date.now(),
    logs,
    emoji:options.emoji || '',
    pinned:Boolean(options.pinned),
    sample:true,
    snoozedUntil:options.snoozedUntil || null,
    topics:normalizeTopics(options.topics),
    allowedWeekdays:normalizeAllowedWeekdays(options.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(options.allowedMonthDays),
    preferredWeekdays:normalizeAllowedWeekdays(options.preferredWeekdays),
    preferredMonthDays:normalizeAllowedMonthDays(options.preferredMonthDays),
    allowedTimeStart:normalizeTimeMinutes(options.allowedTimeStart),
    allowedTimeEnd:normalizeTimeMinutes(options.allowedTimeEnd),
    preferredTimeStart:normalizeTimeMinutes(options.preferredTimeStart),
    preferredTimeEnd:normalizeTimeMinutes(options.preferredTimeEnd),
    flexibilityDays:clampFlexibility(options.flexibilityDays),
    durationMinutes:clampDuration(options.durationMinutes)
  };
}

// PURE: build array of sample habits
function buildSortSamples(){
  return [
    sortSampleHabit('daily walk overdue','keepup',1,sampleLogs([9,7,5,2]),{emoji:'🚶',topics:['health'],durationMinutes:25,allowedTimeStart:390,allowedTimeEnd:600}),
    sortSampleHabit('call family due soon','keepup',7,sampleLogs([34,21,14,6]),{emoji:'☎️',topics:['relationships'],allowedWeekdays:[2,4]}),
    sortSampleHabit('movie night just done','keepup',7,sampleLogs([22,15,8,1]),{emoji:'🎬',topics:['rest'],allowedWeekdays:[5,6],durationMinutes:120}),
    sortSampleHabit('new meditation habit','keepup',7,[],{emoji:'🧘',topics:['health','calm'],durationMinutes:10}),
    sortSampleHabit('40 day habit mid cycle','keepup',40,sampleLogs([97,57,17]),{emoji:'🌿',topics:['home'],flexibilityDays:5}),
    sortSampleHabit('monthly date night close','keepup',30,sampleLogs([91,61,28]),{emoji:'💙',durationMinutes:150,flexibilityDays:4,topics:['relationships']}),
    sortSampleHabit('quarterly mini trip overdue','keepup',90,sampleLogs([190,91]),{emoji:'🧳',durationMinutes:240,flexibilityDays:14,topics:['adventure']}),
    sortSampleHabit('long flexible home reset','keepup',60,sampleLogs([180,122,68]),{emoji:'🧹',durationMinutes:180,flexibilityDays:10,topics:['home']}),
    sortSampleHabit('planned today workout','keepup',3,sampleLogs([11,8,5],[0]),{emoji:'🏋️',topics:['health'],durationMinutes:50}),
    sortSampleHabit('planned weekend check-in','keepup',14,sampleLogs([42,28,15],[3]),{emoji:'🗓️',topics:['planning'],allowedWeekdays:[0,6]}),
    sortSampleHabit('weekend-only yard work','keepup',7,sampleLogs([17,10]),{emoji:'🌱',allowedWeekdays:[0,6],durationMinutes:90}),
    sortSampleHabit('first of month money review','keepup',30,sampleLogs([92,61,31]),{emoji:'💵',allowedMonthDays:[1],durationMinutes:45}),
    sortSampleHabit('15th-only insurance paperwork','keepup',30,sampleLogs([104,74,44]),{emoji:'📄',allowedMonthDays:[15],topics:['admin'],durationMinutes:35}),
    sortSampleHabit('weekday guitar practice with long title','keepup',2,sampleLogs([12,9,6,3]),{emoji:'🎸',allowedWeekdays:[1,2,3,4,5],preferredWeekdays:[1,3,5],topics:['creative','practice'],durationMinutes:20}),
    sortSampleHabit('pinned water habit','keepup',1,sampleLogs([4,3,1]),{emoji:'💧',pinned:true,topics:['health']}),
    sortSampleHabit('slipping reading rhythm','keepup',7,sampleLogs([45,34,23,13,8]),{emoji:'📖',topics:['learning']}),
    sortSampleHabit('improving stretch routine','keepup',7,sampleLogs([32,20,11,5,1]),{emoji:'🤸',topics:['health'],durationMinutes:15}),
    sortSampleHabit('video games too recent','reduce',7,sampleLogs([1]),{emoji:'🎮',topics:['screen time']}),
    sortSampleHabit('limit habit too often','reduce',7,sampleLogs([5,3,1]),{emoji:'🎯',topics:['focus'],allowedWeekdays:[1,3,5]}),
    sortSampleHabit('takeout good spacing','reduce',14,sampleLogs([42,25,18]),{emoji:'🥡',topics:['food','budget']}),
    sortSampleHabit('social media ready to review','reduce',3,sampleLogs([11,8,5]),{emoji:'📱',topics:['screen time'],durationMinutes:20}),
    sortSampleHabit('late-night snacks close','reduce',5,sampleLogs([9,6,3]),{emoji:'🍪',topics:['food']}),
    sortSampleHabit('coffee only on office days','reduce',2,sampleLogs([6,4,2]),{emoji:'☕',topics:['health'],allowedWeekdays:[1,3],durationMinutes:5}),
    sortSampleHabit('stop smoking reset today','zero',null,sampleLogs([0]),{emoji:'🚭'}),
    sortSampleHabit('no soda clear stretch','zero',null,sampleLogs([35,18]),{emoji:'🥤',topics:['health']}),
    sortSampleHabit('old stop habit no entries','zero',null,[],{emoji:'⛔',topics:['avoid']}),
    sortSampleHabit('snoozed build habit','keepup',7,sampleLogs([12]),{emoji:'😴',snoozedUntil:samplePlan(3,8),topics:['rest']}),
    sortSampleHabit('overdue hard-deadline task','task',null,[],{emoji:'⚠️',dueDate:sampleActual(2),hardDue:true,topics:['admin'],durationMinutes:20}),
    sortSampleHabit('task due today','task',null,[],{emoji:'📞',dueDate:sampleActual(0),topics:['relationships'],durationMinutes:15}),
    sortSampleHabit('task due next week','task',null,[],{emoji:'📝',dueDate:samplePlan(6),topics:['learning'],durationMinutes:45,flexibilityDays:3}),
    sortSampleHabit('someday task no date','task',null,[],{emoji:'🗂️',topics:['someday']}),
    sortSampleHabit('dentist appointment event','event',null,[],{emoji:'🦷',eventTime:Date.now() + 4 * 3600000,durationMinutes:60,topics:['health']})
  ];
}

// HANDLER: add sample habits to list
function addSortSamples(){
  const current = load().filter(h=>!h.sample);
  const samples = buildSortSamples();
  if(current.length + samples.length > MAX_TINGS){
    alert(`${MAX_TINGS} habits max`);
    return;
  }
  const next = [...current,...samples].map(h=>({...h,lastLog:latestActualLog(h.logs)}));
  if(save(next)){
    updateSortSampleCount();
    closeSheet('settings-sheet');
    render();
    showToast('samples added');
  }
}

// HANDLER: remove sample habits from list
function removeSortSamples(){
  const current = load();
  const next = current.filter(h=>!h.sample);
  if(next.length === current.length){
    showToast('no samples');
    return;
  }
  if(save(next)){
    updateSortSampleCount();
    render();
    showToast('samples removed');
  }
}

// RENDER: expand or collapse advanced settings
function setAdvancedSettingsOpen(open){
  const block = $('settings-advanced');
  const body = $('settings-advanced-body');
  body.hidden = !open;
  block.classList.toggle('open',open);
  $('settings-advanced-toggle').setAttribute('aria-expanded',String(open));
}

// HANDLER: toggle advanced settings section
function toggleAdvancedSettings(){
  setAdvancedSettingsOpen($('settings-advanced-body').hidden);
}

// RENDER: sync range field value and label
function syncSettingRange(name,value,suffix){
  const field = $(`setting-${name}`);
  const label = $(`setting-${name}-label`);
  if(!field || !label)return;
  field.value = value;
  if(name === 'rhythm-bias'){
    const num = parseInt(value,10) || 0;
    label.textContent = num === 0 ? 'even' : num > 0 ? `short +${num}` : `long +${Math.abs(num)}`;
  }else{
    label.textContent = `${value}${suffix}`;
  }
}

// WIRE: attach input and change listeners to range
function bindSettingRange(name,key,suffix,options = {}){
  const field = $(`setting-${name}`);
  if(!field)return;
  field.addEventListener('input',e=>{
    const value = parseInt(e.target.value,10);
    syncSettingRange(name,value,suffix);
    const patch = {[key]:value};
    if(options.custom !== false && isSortSettingKey(key))patch.preset = 'custom';
    updateSortSetting(patch,{sync:false,renderNow:false});
    if(patch.preset)markPresetButton(patch.preset);
    renderSortLabPreview();
  });
  field.addEventListener('change',()=>{
    render();
  });
}
