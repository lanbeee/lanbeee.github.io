// Add-habit defaults, settings controls, topic management, availability defaults, and sort lab samples.

function cancelAdd(){
  closeSheet('add-sheet');
  applyAddDefaults();
}

function applyAddDefaults(){
  const settings = loadSortSettings();
  $('ting-message').value = '';
  $('ting-emoji').value = '';
  $('ting-duration').value = DEFAULT_DURATION_MINUTES;
  $('ting-flexibility').value = DEFAULT_FLEXIBILITY_DAYS;
  selectedType = settings.defaultType || 'keepup';
  const target = clampRhythm(settings.defaultTarget || 7);
  syncRhythm('ting',target);
  renderTopicChips('ting-topic-chips',[]);
  renderScheduleChips('ting',{});
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o.dataset.v === selectedType));
  $('target-slider-row').style.display = selectedType === 'zero' ? 'none' : 'flex';
  $('target-help').style.display = selectedType === 'zero' ? 'none' : 'block';
  $('target-help').textContent = rhythmHelp(selectedType);
}

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

function saveAvailabilityDay(index,value){
  const availability = normalizeAvailability(sortSettings.availabilityMinutes);
  availability[index] = Math.max(0,Math.min(1440,parseInt(value,10) || 0));
  updateSortSetting({availabilityMinutes:availability},{renderNow:false});
  renderAvailabilityControls();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayAvailability(dayLogsKey);
}

function updateSortSetting(patch,options = {}){
  const {sync = true,renderNow = true} = options;
  saveSortSettings({...sortSettings,...patch});
  if(sync)syncSettingsControls();
  if(sortSettings.reachAssist === false)document.body.classList.remove('reach-pad');
  if(renderNow)render();
}

function isSortSettingKey(key){
  return ['plansFirst','planWindowDays','planWeight','dueWeight','progressWeight','trendWeight','rhythmWeight','buildWeight','limitWeight','stopWeight','newWeight','newBuildMode','dueMode','buildLookAheadDays','buildRiseAt','limitMode','stopMode','rhythmBias','focus'].includes(key);
}

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

function markPresetButton(name){
  document.querySelectorAll('#sort-preset-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.preset === name);
  });
}

function toggleAppSettingButton(btn){
  if(!btn)return;
  const key = btn.dataset.settingToggle;
  if(!key)return;
  const patch = {[key]:!Boolean(sortSettings[key])};
  if(isSortSettingKey(key))patch.preset = 'custom';
  updateSortSetting(patch);
}

function sortSampleCount(){
  return load().filter(h=>h.sample).length;
}

function updateSortSampleCount(){
  const label = $('sort-sample-count');
  if(label)label.textContent = sortSampleCount() ? `${sortSampleCount()} sample habits currently in the list.` : 'No sample habits are in the list.';
}

function sortSettingsForPreset(name){
  if(name === 'custom')return {...DEFAULT_SORT_SETTINGS,...sortSettings,preset:'custom'};
  return {...DEFAULT_SORT_SETTINGS,...(SORT_PRESETS[name] || SORT_PRESETS.balanced),preset:name};
}

function sampleDisplayName(name){
  return String(name || '').replace(/^Sample:\s*/,'');
}

function renderSortLabPreview(){
  const wrap = $('sort-lab-preview');
  if(!wrap)return;
  const samples = normalize(buildSortSamples());
  const previewItems = [
    {name:'current',settings:{...DEFAULT_SORT_SETTINGS,...sortSettings},note:'your setup'},
    ...['balanced','build','planned'].map(name=>({name,settings:sortSettingsForPreset(name)}))
  ];
  wrap.innerHTML = previewItems.map(item=>{
    const {name,settings} = item;
    const orderIndices = visibleIndices(samples,settings)
      .filter(i=>!samples[i].pinned && !(samples[i].snoozedUntil && Date.now() < samples[i].snoozedUntil));
    const order = orderIndices
      .slice(0,6)
      .map(i=>{
        const h = samples[i];
        const type = h.type === 'keepup' ? 'build' : h.type === 'reduce' ? 'limit' : 'stop';
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

function sortSampleHabit(name,type,target,logs,options = {}){
  return {
    name:`Sample: ${name}`,
    type,
    target:type === 'zero' ? null : target,
    logs,
    emoji:options.emoji || '',
    pinned:Boolean(options.pinned),
    sample:true,
    snoozedUntil:options.snoozedUntil || null,
    topics:normalizeTopics(options.topics),
    allowedWeekdays:normalizeAllowedWeekdays(options.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(options.allowedMonthDays),
    flexibilityDays:clampFlexibility(options.flexibilityDays),
    durationMinutes:clampDuration(options.durationMinutes)
  };
}

function buildSortSamples(){
  return [
    sortSampleHabit('daily walk overdue','keepup',1,sampleLogs([9,7,5,2]),{emoji:'🚶',topics:['health'],durationMinutes:25}),
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
    sortSampleHabit('weekday guitar practice with long title','keepup',2,sampleLogs([12,9,6,3]),{emoji:'🎸',allowedWeekdays:[1,2,3,4,5],topics:['creative','practice'],durationMinutes:20}),
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
    sortSampleHabit('snoozed build habit','keepup',7,sampleLogs([12]),{emoji:'😴',snoozedUntil:samplePlan(3,8),topics:['rest']})
  ];
}

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

function setAdvancedSettingsOpen(open){
  const block = $('settings-advanced');
  const body = $('settings-advanced-body');
  body.hidden = !open;
  block.classList.toggle('open',open);
  $('settings-advanced-toggle').setAttribute('aria-expanded',String(open));
}

function toggleAdvancedSettings(){
  setAdvancedSettingsOpen($('settings-advanced-body').hidden);
}

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
