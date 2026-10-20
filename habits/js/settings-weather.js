function isLocationConditionControl(node){
  const sheet = node?.closest('.opportunity-mode');
  return Boolean(sheet && $(sheet.id === 'add-sheet' ? 'ting-condition-trigger' : 'detail-condition-trigger')?.value === 'location');
}
function syncConditionTriggerControls(){
  for(const prefix of ['ting','detail']){
    const location = $(prefix+'-condition-trigger').value === 'location';
    $(prefix+'-condition-radius-row').hidden = !location;
    const select = $(prefix+'-weather-profile');
    const optional = Boolean(select.closest('.opportunity-mode'));
    select.previousElementSibling.textContent = optional && !location ? 'Weather rules' : 'weather guidance';
  }
}

// Weather profile controls and per-habit profile selectors.

const WEATHER_PROFILE_NONE_VALUE='__none__';

function weatherMetricOptions(selected){
  return Object.entries(WEATHER_METRICS).map(([key,meta])=>{
    const unit=weatherMetricUnitLabel(key) || meta.unit;
    return `<option value="${key}"${key===selected?' selected':''}>${escapeHtml(meta.label)}${unit ? ` (${escapeHtml(unit)})` : ''}</option>`;
  }).join('');
}

// Every metric has an unfamiliar scale (UV 0–11, AQI 0–300, …). Show the
// bands inline so min/max need no external lookup, and flag rules that do
// nothing yet instead of letting them look configured but inert. Bands follow
// the display unit (weatherMetricHintText) so they match what the user types.
function weatherRuleHintText(rule){
  const scale=weatherMetricHintText(rule && rule.metric);
  if(rule && rule.boundMode==='percentile'){
    const relative='percentiles use this place’s available 7-day forecast · 0 = lowest, 100 = highest';
    return weatherRuleActive(rule) ? relative : `inactive — set min %, max %, or a preference · ${relative}`;
  }
  return weatherRuleActive(rule) ? scale : `inactive — set min, max, or a preference${scale ? ' · ' + scale : ''}`;
}

function weatherProfileSelectValue(mode,profileId){
  const normalized=typeof normalizeWeatherProfileMode==='function'
    ? normalizeWeatherProfileMode(mode,profileId)
    : (mode==='none'?'none':(profileId?'profile':'inherit'));
  if(normalized==='none')return WEATHER_PROFILE_NONE_VALUE;
  return normalized==='profile' ? cleanWeatherProfileId(profileId) : '';
}

function weatherProfileChoiceFromValue(value){
  if(value===WEATHER_PROFILE_NONE_VALUE)return {weatherProfileMode:'none',weatherProfileId:null};
  const id=cleanWeatherProfileId(value);
  return id
    ? {weatherProfileMode:'profile',weatherProfileId:id}
    : {weatherProfileMode:'inherit',weatherProfileId:null};
}

function readWeatherProfileChoice(id){
  return weatherProfileChoiceFromValue($(id)?.value || '');
}

function weatherProfileOptionsHtml(value='',inheritLabel='use the place’s weather'){
  const profiles=normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles);
  const selected=String(value || '');
  const missing=selected && selected!==WEATHER_PROFILE_NONE_VALUE && !profiles.some(profile=>profile.id===selected);
  return `<option value=""${selected===''?' selected':''}>${escapeHtml(inheritLabel)}</option>`
    +`<option value="${WEATHER_PROFILE_NONE_VALUE}"${selected===WEATHER_PROFILE_NONE_VALUE?' selected':''}>ignore weather rules</option>`
    +profiles.map(profile=>
      `<option value="${escapeHtml(profile.id)}"${profile.id===selected?' selected':''}>${escapeHtml(profile.name)}</option>`
    ).join('')
    +(missing?`<option value="${escapeHtml(selected)}" selected>missing profile · choose again</option>`:'');
}

function renderWeatherProfileSelect(id,value = ''){
  const select=$(id);
  if(!select)return;
  select.innerHTML=weatherProfileOptionsHtml(value,weatherInheritLabel(id));
  select.value=value;
}

function weatherProfileName(id,settings=sortSettings || loadSortSettings()){
  return weatherProfileById(id,settings)?.name || '';
}

function selectedWeatherLocationIds(selectId){
  if(selectId==='detail-weather-profile' && typeof selectedLocationIdsFrom==='function'){
    return selectedLocationIdsFrom('detail-place-chips');
  }
  if(selectId==='ting-weather-profile' && typeof selectedLocationIds==='function')return selectedLocationIds();
  return [];
}

function weatherInheritLabel(selectId){
  const select=$(selectId);
  const opportunity=Boolean(select?.closest('.opportunity-mode')) && !isLocationConditionControl(select);
  const profiles=normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles);
  const ids=selectedWeatherLocationIds(selectId);
  if(opportunity)return ids.length ? 'use each place’s weather rules' : 'choose weather rules…';
  return profiles.length ? 'use the place’s weather rules' : 'use the place’s weather rules · none saved yet';
}

// A conditional item shows up only after a place or a weather choice.
// Say that as an instruction. "Anywhere" is not a finished choice.
function opportunitySetupHint(hasTrigger, needsCity){
  if(!hasTrigger)return 'Choose places for a location trigger, or active weather rules for a weather trigger.';
  if(needsCity)return 'Add your city so Tings can tell when the weather matches.';
  return '';
}

// Show actual bounds beside a selected set of rules, in the user's units.
function weatherProfileRuleSummary(profile){
  return (profile?.rules || []).filter(weatherRuleActive).map(rule=>{
    const label = WEATHER_METRICS[rule.metric]?.label || rule.metric;
    const percentile = rule.boundMode === 'percentile';
    const unit = percentile ? 'th percentile' : weatherMetricUnitLabel(rule.metric);
    const value = bound=>percentile ? `percentile ${bound}`
      : `${weatherMetricDisplayValue(rule.metric,bound)}${unit ? ' ' + unit : ''}`;
    const bounds = rule.min != null && rule.max != null ? `${value(rule.min)} to ${value(rule.max)}`
      : rule.min != null ? `at least ${value(rule.min)}`
      : rule.max != null ? `at most ${value(rule.max)}` : '';
    const preference = rule.relative === 'low' ? 'prefer lower' : rule.relative === 'high' ? 'prefer higher' : '';
    return `${label}: ${[bounds,preference].filter(Boolean).join(', ')}`;
  }).join('; ');
}

function weatherGuidanceHintText(selectId){
  const settings=sortSettings || loadSortSettings();
  const choice=weatherProfileChoiceFromValue($(selectId)?.value || '');
  const opportunity=Boolean($(selectId)?.closest('.opportunity-mode')) && !isLocationConditionControl($(selectId));
  if(choice.weatherProfileMode==='none'){
    return opportunity
      ? 'Choose active weather rules for this trigger, or switch the trigger to location.'
      : 'Weather won’t change the plan, unless a specific time and place says otherwise.';
  }
  if(choice.weatherProfileMode==='profile'){
    const name=weatherProfileName(choice.weatherProfileId,settings) || 'this weather';
    if(opportunity){
      const summary = weatherProfileRuleSummary(weatherProfileById(choice.weatherProfileId,settings));
      if(!summary)return `${name} has no active rules. Edit weather rules below, or switch the trigger to location.`;
      const place = selectedWeatherLocationIds(selectId).length ? 'at a selected place' : 'where the forecast is checked';
      return `Only when ${name} matches ${place}. ${summary}. Waits if the forecast is unavailable.`;
    }
    return `Uses ${name} at the place where this is planned.`;
  }
  const ids=selectedWeatherLocationIds(selectId);
  const inherited=ids.map(id=>{
    const loc=normalizeLocationRegistry(settings.locations).find(item=>item.id===id);
    const name=loc && weatherProfileRuleSummary(weatherProfileById(loc.weatherProfileId,settings)) && weatherProfileName(loc.weatherProfileId,settings);
    return name ? `${loc.name} · ${name}` : null;
  }).filter(Boolean);
  if(inherited.length)return opportunity
    ? `Uses saved rules: ${inherited.join('; ')}. Places without active rules cannot activate a weather trigger. Only weather activates this habit; places specify where it can happen.`
    : `Uses the weather saved for ${inherited.join('; ')}.`;
  if(opportunity){
    return 'Choose active weather rules, or inherit rules from a selected place. The location alone does not trigger this habit.';
  }
  return ids.length
    ? 'The selected places have no saved weather, so weather won’t change the plan.'
    : 'Uses the weather saved on the place, if it has one.';
}

function syncWeatherGuidanceHints(){
  syncConditionTriggerControls();
  const tingWrap = $('ting-weather-location-wrap');
  if(tingWrap && $('add-sheet')?.classList.contains('opportunity-mode')){
    tingWrap.hidden = !locationOptions().length || !selectedAnywhere() && selectedLocationIds().length>0
      || weatherProfileChoiceFromValue($('ting-weather-profile')?.value || '').weatherProfileMode !== 'profile';
  }
  for(const [selectId,hintId] of [['ting-weather-profile','ting-weather-guidance-hint'],['detail-weather-profile','detail-weather-guidance-hint']]){
    const hint=$(hintId);
    if(hint){
      hint.textContent=weatherGuidanceHintText(selectId);
      hint.hidden=!hint.textContent;
    }
    const blank=$(selectId)?.querySelector('option[value=""]');
    if(blank)blank.textContent=weatherInheritLabel(selectId);
    const optional = Boolean($(selectId)?.closest('.opportunity-mode'));
    const none = $(selectId)?.querySelector(`option[value="${WEATHER_PROFILE_NONE_VALUE}"]`);
    if(none)none.textContent = optional ? 'any weather' : 'ignore weather rules';
    const edit = $(selectId === 'ting-weather-profile' ? 'ting-weather-profiles' : 'detail-weather-profiles');
    if(edit)edit.textContent = normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles).length
      ? 'edit weather rules' : 'add weather rules';
  }
  if(typeof syncHabitScheduleOptionWeatherHints==='function')syncHabitScheduleOptionWeatherHints();
  syncDetailConditionHint();
  if($('add-sheet')?.classList.contains('open') && typeof refreshAddAvailability === 'function')queueMicrotask(refreshAddAvailability);
}

function syncDetailConditionHint(){
  const optional = $('detail-sheet')?.classList.contains('opportunity-mode');
  const hint = $('detail-condition-hint');
  if(!hint)return;
  const record = {
    ...readWeatherProfileChoice('detail-weather-profile'),
    conditionTrigger:$('detail-condition-trigger').value,
    locationIds:selectedLocationIdsFrom('detail-place-chips'),
    anywhereAllowed:selectedAnywhereFrom('detail-place-chips'),
    weatherLocationId:$('detail-weather-location')?.value || null,
    scheduleOptions:readHabitScheduleOptionsFromDetail()
  };
  const settings = sortSettings || loadSortSettings();
  const hasPlace = record.locationIds.length > 0 || record.scheduleOptions.some(option=>option.locationId);
  const hasTrigger = record.conditionTrigger === 'location' ? hasPlace : weatherHabitHasActiveGuidance(record,settings);
  const needsCity = optional && hasTrigger && !hasPlace && !record.weatherLocationId && !weatherHomeCoords(settings);
  $('detail-weather-city').hidden = !needsCity;
  hint.textContent = opportunitySetupHint(hasTrigger, needsCity);
  if(typeof syncOpportunityAnywhereChip === 'function')syncOpportunityAnywhereChip('detail-place-chips');
  hint.hidden = !optional || (hasTrigger && !needsCity);
  if(optional){
    $('detail-weather-location-wrap').hidden = !locationOptions().length
      || !record.anywhereAllowed && record.locationIds.length > 0
      || record.weatherProfileMode !== 'profile';
  }
  return !optional || hasTrigger;
}

function renderWeatherLocationSelect(id,value = ''){
  const select=$(id);
  if(!select)return;
  const settings=sortSettings || loadSortSettings();
  const locations=typeof locationsForDisplay === 'function' ? locationsForDisplay(settings.locations) : [];
  const homeName=settings.homeCityName ? `home city · ${settings.homeCityName}` : 'home city';
  const current=typeof cleanLocationId === 'function' ? cleanLocationId(value) : String(value || '');
  select.innerHTML=`<option value="">${escapeHtml(homeName)}</option>`+locations.map(loc=>
    `<option value="${escapeHtml(loc.id)}">${escapeHtml(loc.name)}</option>`
  ).join('');
  select.value=locations.some(loc=>loc.id===current)?current:'';
}

function weatherSwitchOn(id){
  return $(id)?.getAttribute('aria-pressed') === 'true';
}

function syncWeatherHabitLocationUi(){
  const settings=sortSettings || loadSortSettings();
  const hasPlaces=(typeof locationsForDisplay === 'function' ? locationsForDisplay(settings.locations) : []).length > 0;
  const tingWrap=$('ting-weather-location-wrap');
  const detailWrap=$('detail-weather-location-wrap');
  if(tingWrap)tingWrap.hidden = !hasPlaces || weatherProfileChoiceFromValue($('ting-weather-profile')?.value || '').weatherProfileMode!=='profile';
  if(detailWrap)detailWrap.hidden = !hasPlaces || weatherProfileChoiceFromValue($('detail-weather-profile')?.value || '').weatherProfileMode!=='profile';
  syncWeatherDisplayUi();
  syncWeatherGuidanceHints();
}

function syncWeatherDisplayUi(){
  const settings=sortSettings || loadSortSettings();
  const hasPlaces=(typeof locationsForDisplay === 'function' ? locationsForDisplay(settings.locations) : []).length > 0;
  const tingOn=weatherSwitchOn('ting-show-weather');
  const detailOn=weatherSwitchOn('detail-show-weather');
  const tingLoc=$('ting-show-weather-location-row');
  const detailLoc=$('detail-show-weather-location-row');
  const tingHint=$('ting-show-weather-location-hint');
  const detailHint=$('detail-show-weather-location-hint');
  if(tingLoc)tingLoc.hidden = !tingOn || !hasPlaces;
  if(detailLoc)detailLoc.hidden = !detailOn || !hasPlaces;
  if(tingHint)tingHint.hidden = !tingOn || !hasPlaces;
  if(detailHint)detailHint.hidden = !detailOn || !hasPlaces;
}

function readWeatherLocationId(selectId,profileValue){
  if(weatherProfileChoiceFromValue(profileValue).weatherProfileMode!=='profile')return null;
  return (typeof cleanLocationId === 'function' ? cleanLocationId($(selectId)?.value) : '') || null;
}

function weatherAgeLabel(ts){
  if(!Number.isFinite(Number(ts)) || Number(ts)<=0)return 'not loaded';
  const minutes=Math.max(0,Math.round((Date.now()-Number(ts))/60000));
  if(minutes<1)return 'just now';
  if(minutes<60)return `${minutes}m ago`;
  return `${Math.round(minutes/60)}h ago`;
}

const WEATHER_INSPECTOR_COLUMNS=['precipitation_probability','precipitation','snowfall','temperature_2m','apparent_temperature','wind_speed_10m','wind_gusts_10m','uv_index','us_aqi','european_aqi'];

function weatherInspectorCell(metric,value){
  if(!Number.isFinite(value))return '—';
  // Inspector shows the planner's rows in the display unit; the planner
  // itself keeps scoring the stored metric values.
  const converted=weatherMetricValueConverted(metric,value);
  if(metric==='precipitation' || metric==='snowfall'){
    const decimals=weatherUsesInches() ? 2 : 1;
    return (Math.round(converted*10**decimals)/10**decimals).toFixed(decimals);
  }
  return String(Math.round(converted));
}

// The panel under the profile editor: the actual forecast rows the planner
// scores against, so "why did it pick 17:00" can be answered by reading the
// numbers instead of guessing what the app fetched.
function renderWeatherInspector(settings,now = Date.now()){
  const model=weatherInspectorModel(settings,now);
  if(!model || model.error==='no-home')return '<p class="weather-forecast-empty">Set your city under Locations to load a forecast.</p>';
  if(model.error==='empty')return '<p class="weather-forecast-empty">No forecast stored yet — tap “refresh forecast”.</p>';
  if(model.error==='stale')return `<p class="weather-forecast-empty">Stored forecast is from ${weatherAgeLabel(model.lastFetchedAt)} — too old to plan with. Tap “refresh forecast”.</p>`;
  if(model.error==='window')return '<p class="weather-forecast-empty">The stored forecast has no rows for the next 24 hours.</p>';
  const tzOptions=model.timezone ? {timeZone:model.timezone} : {};
  let fmtDay,fmtTime;
  try{
    fmtDay=new Intl.DateTimeFormat('en-GB',{...tzOptions,weekday:'short'});
    fmtTime=new Intl.DateTimeFormat('en-GB',{...tzOptions,hour:'2-digit',minute:'2-digit',hour12:false});
  }catch{
    fmtDay=new Intl.DateTimeFormat('en-GB',{weekday:'short'});
    fmtTime=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});
  }
  const present=WEATHER_INSPECTOR_COLUMNS.filter(metric=>model.rows.some(row=>Number.isFinite(row.values[metric])));
  const head=`<tr><th scope="col">time</th>${present.map(metric=>{
    const unit=weatherMetricUnitLabel(metric);
    return `<th scope="col">${escapeHtml(WEATHER_METRICS[metric].label)}${unit ? ` <small>(${escapeHtml(unit)})</small>` : ''}</th>`;
  }).join('')}</tr>`;
  let lastDay='';
  const body=model.rows.map(row=>{
    const day=fmtDay.format(row.ts);
    const newDay=day!==lastDay;
    lastDay=day;
    const time=newDay ? `${day} ${fmtTime.format(row.ts)}` : fmtTime.format(row.ts);
    return `<tr${row.source==='near'?' class="near"':''}><td>${escapeHtml(time)}</td>${present.map(metric=>`<td>${weatherInspectorCell(metric,row.values[metric])}</td>`).join('')}</tr>`;
  }).join('');
  const parts=[];
  parts.push(model.cityName ? escapeHtml(model.cityName) : 'home city');
  parts.push(`7-day hourly · ${weatherAgeLabel(model.weeklyFetchedAt)}`);
  parts.push(model.nearFetchedAt
    ? `15-min detail until ${escapeHtml(fmtTime.format(model.nearUntil+15*60000))} · ${weatherAgeLabel(model.nearFetchedAt)}`
    : '15-min detail starts when a weather item is within 90 min');
  if(model.airFetchedAt)parts.push(`air quality ${weatherAgeLabel(model.airFetchedAt)}`);
  if(model.timezone)parts.push(escapeHtml(model.timezone));
  return `<p class="weather-forecast-meta">${parts.join(' · ')}</p>
    <div class="weather-forecast-scroll"><table class="weather-forecast-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p class="weather-forecast-legend">Shaded rows are 15-minute near-term samples — the planner reads them instead of the hourly value inside their span. Values show in your display unit; the planner scores the stored metric equivalents.</p>`;
}

// Segs + hints for the temperature, precipitation, and wind display units.
// 'auto' explains what it currently resolves to so the inferred default is
// never a mystery. Every hint also names how rule bounds and the stored
// forecast data relate: bounds follow the display unit, storage stays metric.
function weatherUnitHintText(setting,effectiveLabel,defaultLabel,storedLabel){
  const settings=sortSettings || loadSortSettings();
  if(setting!=='auto'){
    return `showing ${effectiveLabel} everywhere · rule bounds use ${effectiveLabel}; forecast data stays ${storedLabel} behind the scenes.`;
  }
  const city=String(settings.homeCityName || '').trim();
  const source=settings.homeCityCountry && city ? `inferred from ${city}` : `no city country yet · ${defaultLabel} default`;
  return `auto — ${effectiveLabel} (${source}). Rule bounds use ${effectiveLabel}; forecast data stays ${storedLabel} behind the scenes.`;
}

function syncWeatherTempUnitControls(){
  const settings=sortSettings || loadSortSettings();
  const mode=normalizeWeatherTempUnit(settings.weatherTempUnit);
  document.querySelectorAll('#weather-temp-unit-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue===mode);
  });
  const hint=$('weather-temp-unit-hint');
  if(!hint)return;
  hint.textContent=weatherUnitHintText(mode,weatherEffectiveTempUnit(settings)==='f' ? '°F' : '°C','°C','°C');
}

function syncWeatherPrecipUnitControls(){
  const settings=sortSettings || loadSortSettings();
  const mode=normalizeWeatherPrecipUnit(settings.weatherPrecipUnit);
  document.querySelectorAll('#weather-precip-unit-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue===mode);
  });
  const hint=$('weather-precip-unit-hint');
  if(!hint)return;
  const imperial=weatherEffectivePrecipUnit(settings)==='in';
  hint.textContent=`snowfall follows this setting · ${weatherUnitHintText(mode,imperial?'in':'mm',imperial?'in':'mm','mm')}`;
}

function syncWeatherWindUnitControls(){
  const settings=sortSettings || loadSortSettings();
  const mode=normalizeWeatherWindUnit(settings.weatherWindUnit);
  document.querySelectorAll('#weather-wind-unit-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue===mode);
  });
  const hint=$('weather-wind-unit-hint');
  if(!hint)return;
  const mph=weatherEffectiveWindUnit(settings)==='mph';
  hint.textContent=weatherUnitHintText(mode,mph?'mph':'km/h',mph?'mph':'km/h','km/h');
}

function syncWeatherUnitControls(){
  syncWeatherTempUnitControls();
  syncWeatherPrecipUnitControls();
  syncWeatherWindUnitControls();
}

function renderWeatherControls(){
  syncWeatherUnitControls();
  const list=$('weather-profile-list');
  if(!list)return;
  const settings=sortSettings || loadSortSettings();
  const profiles=normalizeWeatherProfiles(settings.weatherProfiles);
  const habits=load();
  list.innerHTML=profiles.map((profile,profileIndex)=>{
    const usages=weatherProfileUsages(profile.id,habits,settings);
    const attached=usages.map(usage=>usage.label).slice(0,5);
    return `
    <div class="weather-profile-card" data-weather-profile-index="${profileIndex}">
      <div class="weather-profile-head">
        <input class="settings-text-input" data-weather-profile-name value="${escapeHtml(profile.name)}" maxlength="32" aria-label="weather profile name" />
        <button class="mini-text-btn" type="button" data-weather-profile-remove>remove</button>
      </div>
      <div class="weather-profile-used">${attached.length ? `used by ${escapeHtml(attached.join(', '))}${usages.length>attached.length?` +${usages.length-attached.length}`:''}` : 'not attached yet'}</div>
      <div class="weather-rule-list">
        ${profile.rules.map((rule,ruleIndex)=>{
          const meta=WEATHER_METRICS[rule.metric] || {};
          // Bounds display in the effective unit (weatherMetricValueToStored
          // converts back on save); storage keeps API units either way.
          const percentile=rule.boundMode==='percentile';
          const boundValue=v=>v==null ? '' : (percentile ? v : weatherMetricDisplayValue(rule.metric,v));
          return `
          <div class="weather-rule" data-weather-rule-index="${ruleIndex}">
            <select class="settings-select" data-weather-rule-metric aria-label="weather metric">${weatherMetricOptions(rule.metric)}</select>
            <label class="weather-bound-mode">limits
              <select class="settings-select" data-weather-rule-bound-mode aria-label="weather limit type">
                <option value="absolute"${!percentile?' selected':''}>fixed values</option>
                <option value="percentile"${percentile?' selected':''}>percentiles</option>
              </select>
            </label>
            <label class="weather-min">min${percentile?' %':''} <input type="number" inputmode="decimal" data-weather-rule-min value="${boundValue(rule.min)}"${percentile?' min="0" max="100"':''} placeholder="${percentile?'0':escapeHtml(weatherMetricRangeText(rule.metric) || meta.range || '—')}" /></label>
            <label class="weather-max">max${percentile?' %':''} <input type="number" inputmode="decimal" data-weather-rule-max value="${boundValue(rule.max)}"${percentile?' min="0" max="100"':''} placeholder="${percentile?'100':escapeHtml(weatherMetricRangeText(rule.metric) || meta.range || '—')}" /></label>
            <select class="settings-select" data-weather-rule-relative aria-label="relative preference">
              <option value="none"${rule.relative==='none'?' selected':''}>no preference</option>
              <option value="low"${rule.relative==='low'?' selected':''}>prefer lower</option>
              <option value="high"${rule.relative==='high'?' selected':''}>prefer higher</option>
            </select>
            <label class="weather-importance">priority
              <select class="settings-select" data-weather-rule-importance aria-label="weather rule priority">
                <option value="low"${rule.importance==='low'?' selected':''}>low</option>
                <option value="medium"${rule.importance==='medium'?' selected':''}>medium</option>
                <option value="high"${rule.importance==='high'?' selected':''}>high</option>
              </select>
            </label>
            <label class="weather-hard"><input type="checkbox" data-weather-rule-hard${rule.hard?' checked':''} /> hard</label>
            <button class="mini-nav" type="button" data-weather-rule-remove aria-label="remove weather rule"><i class="ti ti-x" aria-hidden="true"></i></button>
            <div class="weather-rule-hint">${escapeHtml(weatherRuleHintText(rule))}</div>
          </div>`;}).join('')}
      </div>
      <button class="mini-text-btn" type="button" data-weather-rule-add>add rule</button>
    </div>`;}).join('');
  const add=$('weather-profile-add');
  if(add)add.disabled=profiles.length>=MAX_WEATHER_PROFILES;
  const cache=weatherCacheRead();
  const status=$('weather-status');
  if(status){
    if(!profiles.length)status.textContent='No saved weather yet.';
    else if(!Number.isFinite(settings.homeCityLat) || !Number.isFinite(settings.homeCityLng))status.textContent='Set your city under Locations to load a forecast.';
    else if(cache.lastError)status.textContent=`Forecast unavailable · using normal planning (${cache.lastError})`;
    else {
      let text=`7-day ${weatherAgeLabel(cache.weekly?.fetchedAt)} · near-term ${cache.near?.fetchedAt ? weatherAgeLabel(cache.near.fetchedAt) : 'waits until a weather item starts within 90 min'}`;
      const extras=Object.keys(cache.places || {}).filter(id=>cache.places[id]?.weekly);
      if(extras.length){
        const names=extras.map(id=>{
          const loc=typeof weatherLocationById === 'function' ? weatherLocationById(id,settings) : null;
          return loc?.name || 'far place';
        });
        text += ` · ${names.slice(0,2).join(', ')} ${weatherAgeLabel(cache.places[extras[0]]?.weekly?.fetchedAt)}`;
      }
      status.textContent=text;
    }
  }
  const panel=$('weather-forecast-data');
  if(panel)panel.innerHTML=renderWeatherInspector(settings);
  const tingProfileValue=$('ting-weather-profile')?$('ting-weather-profile').value:'';
  renderWeatherProfileSelect('ting-weather-profile',tingProfileValue);
  renderWeatherLocationSelect('ting-weather-location',$('ting-weather-location')?.value || '');
  const detailHabit=detailIdx != null ? load()[detailIdx] : null;
  const detailProfileValue=$('detail-weather-profile')
    ? $('detail-weather-profile').value
    : (detailHabit ? weatherProfileSelectValue(detailHabit.weatherProfileMode,detailHabit.weatherProfileId) : '');
  renderWeatherProfileSelect('detail-weather-profile',detailProfileValue);
  renderWeatherLocationSelect('detail-weather-location',$('detail-weather-location')?.value || detailHabit?.weatherLocationId || '');
  syncWeatherHabitLocationUi();
}

function weatherProfileUsages(id,data=null,settings=null){
  const clean=cleanWeatherProfileId(id);
  if(!clean)return [];
  const list=Array.isArray(data)?data:(typeof load==='function'?load():[]);
  const cfg=settings || (typeof loadSortSettings==='function'?loadSortSettings():(sortSettings||{}));
  const out=[];
  const itemName=h=>String((typeof sampleDisplayName==='function'?sampleDisplayName(h):h?.name)||'habit').trim();
  for(const h of list){
    if(!h)continue;
    const mode=typeof normalizeWeatherProfileMode==='function'
      ? normalizeWeatherProfileMode(h.weatherProfileMode,h.weatherProfileId) : (h.weatherProfileId?'profile':'inherit');
    if(mode==='profile' && cleanWeatherProfileId(h.weatherProfileId)===clean){
      out.push({kind:'item',label:itemName(h),h});
    }
    const options=typeof normalizeHabitScheduleOptions==='function'
      ? normalizeHabitScheduleOptions(h.scheduleOptions,cfg.locations) : [];
    options.forEach((option,index)=>{
      if(option.weatherProfileMode==='profile' && option.weatherProfileId===clean){
        out.push({kind:'option',label:`${itemName(h)} · option ${index+1}`,h,option});
      }
    });
  }
  for(const loc of normalizeLocationRegistry(cfg.locations)){
    if(cleanWeatherProfileId(loc.weatherProfileId)===clean){
      out.push({kind:'location',label:`${loc.name} · place`,location:loc});
    }
  }
  return out;
}

let _weatherListRenderTimer=null;
function scheduleWeatherControlsRender(){
  // Text-field saves fire on blur, which lands between the mousedown and
  // mouseup of the next tap. Rebuilding the list in that window replaces the
  // tapped node, the click never lands, and the interaction is silently lost.
  // Defer one task so any in-flight click completes before the rebuild.
  if(_weatherListRenderTimer)clearTimeout(_weatherListRenderTimer);
  _weatherListRenderTimer=setTimeout(()=>{
    _weatherListRenderTimer=null;
    renderWeatherControls();
  },0);
}

function saveWeatherProfilesFromUi(profiles,opts = {}){
  const next=normalizeWeatherProfiles(profiles);
  saveSortSettings({...loadSortSettings(),weatherProfiles:next});
  sortSettings=loadSortSettings();
  if(typeof bumpPlannerDataRevision==='function')bumpPlannerDataRevision();
  if(opts.deferRender)scheduleWeatherControlsRender();
  else renderWeatherControls();
  if(typeof renderLocationControls==='function')renderLocationControls();
  if(typeof renderHomeIfChanged==='function')renderHomeIfChanged(true,{__forceReplan:true});
  void refreshWeatherForecast();
}

function weatherProfilesMutate(mutator,opts = {}){
  const profiles=normalizeWeatherProfiles(loadSortSettings().weatherProfiles).map(profile=>({...profile,rules:profile.rules.map(rule=>({...rule}))}));
  mutator(profiles);
  saveWeatherProfilesFromUi(profiles,opts);
}

document.addEventListener('click',event=>{
  if(event.target.closest('#weather-profile-add')){
    weatherProfilesMutate(profiles=>{
      if(profiles.length>=MAX_WEATHER_PROFILES)return;
      profiles.push({id:`weather-${Date.now().toString(36)}`,name:profiles.length?'Outdoor '+(profiles.length+1):'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:false,relative:'low',importance:'medium',boundMode:'absolute'}]});
    });
    return;
  }
  if(event.target.closest('#weather-refresh')){
    const button=$('weather-refresh');
    if(button)button.disabled=true;
    void refreshWeatherForecast({force:true}).finally(()=>{if(button)button.disabled=false;});
    return;
  }
  const card=event.target.closest('[data-weather-profile-index]');
  if(!card)return;
  const profileIndex=Number(card.dataset.weatherProfileIndex);
  const rule=event.target.closest('[data-weather-rule-index]');
  const ruleIndex=Number(rule?.dataset.weatherRuleIndex);
  if(event.target.closest('[data-weather-profile-remove]')){
    const removed=normalizeWeatherProfiles(loadSortSettings().weatherProfiles)[profileIndex];
    const usages=removed?weatherProfileUsages(removed.id):[];
    if(usages.length){
      const labels=usages.slice(0,4).map(usage=>usage.label);
      if(typeof showToast==='function')showToast(`still used by ${labels.join(', ')}${usages.length>labels.length?` +${usages.length-labels.length}`:''}`);
      return;
    }
    weatherProfilesMutate(profiles=>profiles.splice(profileIndex,1));
  }else if(event.target.closest('[data-weather-rule-add]')){
    weatherProfilesMutate(profiles=>profiles[profileIndex]?.rules.push({metric:'temperature_2m',min:null,max:null,hard:false,relative:'low',importance:'medium',boundMode:'absolute'}));
  }else if(event.target.closest('[data-weather-rule-remove]')){
    weatherProfilesMutate(profiles=>profiles[profileIndex]?.rules.splice(ruleIndex,1));
  }
});

document.addEventListener('change',event=>{
  if(event.target.id === 'ting-weather-profile' || event.target.id === 'detail-weather-profile'){
    syncWeatherHabitLocationUi();
    return;
  }
  const card=event.target.closest('[data-weather-profile-index]');
  if(!card)return;
  const profileIndex=Number(card.dataset.weatherProfileIndex);
  const ruleEl=event.target.closest('[data-weather-rule-index]');
  const ruleIndex=Number(ruleEl?.dataset.weatherRuleIndex);
  // Text/number fields save on blur, which can be mid-click on the next
  // control; those saves must not rebuild the list synchronously (see
  // scheduleWeatherControlsRender). Checkbox/select changes fire after their
  // click has completed, so they can re-render immediately.
  const deferRender=event.target.matches('input:not([type="checkbox"])');
  weatherProfilesMutate(profiles=>{
    const profile=profiles[profileIndex];
    if(!profile)return;
    if(event.target.matches('[data-weather-profile-name]'))profile.name=event.target.value;
    const rule=profile.rules[ruleIndex];
    if(!rule)return;
    if(event.target.matches('[data-weather-rule-metric]'))rule.metric=event.target.value;
    if(event.target.matches('[data-weather-rule-bound-mode]')){
      rule.boundMode=event.target.value;
      rule.min=null;
      rule.max=null;
    }
    if(event.target.matches('[data-weather-rule-min]'))rule.min=rule.boundMode==='percentile'?(event.target.value===''?null:Number(event.target.value)):weatherMetricValueToStored(rule.metric,event.target.value);
    if(event.target.matches('[data-weather-rule-max]'))rule.max=rule.boundMode==='percentile'?(event.target.value===''?null:Number(event.target.value)):weatherMetricValueToStored(rule.metric,event.target.value);
    if(event.target.matches('[data-weather-rule-relative]'))rule.relative=event.target.value;
    if(event.target.matches('[data-weather-rule-importance]'))rule.importance=event.target.value;
    if(event.target.matches('[data-weather-rule-hard]'))rule.hard=event.target.checked;
  },{deferRender});
});

function bindWeatherDisplaySwitch(id){
  $(id)?.addEventListener('click',function(){
    const pressed=this.getAttribute('aria-pressed')==='true';
    this.setAttribute('aria-pressed',String(!pressed));
    syncWeatherDisplayUi();
    if(id.startsWith('detail-') && typeof setDetailDirty==='function')setDetailDirty();
  });
}
bindWeatherDisplaySwitch('ting-show-weather');
bindWeatherDisplaySwitch('ting-show-weather-location');
bindWeatherDisplaySwitch('detail-show-weather');
bindWeatherDisplaySwitch('detail-show-weather-location');

for(const prefix of ['ting','detail']){
  for(const field of ['trigger','radius'])$(prefix+'-condition-'+field).addEventListener('input',()=>{
    syncWeatherGuidanceHints();
    const id = prefix === 'ting' ? 'ting-tag-chips' : 'detail-place-chips';
    renderTagChips(id,selectedTopicsFrom(id),selectedLocationIdsFrom(id),null,selectedLocationPrefsFrom(id),selectedAnywhereFrom(id));
    if(prefix === 'detail'){
      syncDetailSchedulePlacesUi();
      setDetailDirty();
    }else if(!isLocationConditionControl($(id))){
      $('add-topics-section').querySelector('.field-hint').textContent = 'Choose where this can happen, just like a regular habit.';
    }
  });
}
