// Weather profile controls and per-habit profile selectors.

const WEATHER_PROFILE_NONE_VALUE='__none__';

function weatherMetricOptions(selected){
  return Object.entries(WEATHER_METRICS).map(([key,meta])=>
    `<option value="${key}"${key===selected?' selected':''}>${escapeHtml(meta.label)}${meta.unit ? ` (${escapeHtml(meta.unit)})` : ''}</option>`
  ).join('');
}

// Every metric has an unfamiliar scale (UV 0–11, AQI 0–300, …). Show the
// bands inline so min/max need no external lookup, and flag rules that do
// nothing yet instead of letting them look configured but inert.
function weatherRuleHintText(rule){
  const meta=WEATHER_METRICS[rule.metric] || {};
  const scale=meta.hint || '';
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

function weatherProfileOptionsHtml(value='',inheritLabel='use place default'){
  const profiles=normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles);
  const selected=String(value || '');
  const missing=selected && selected!==WEATHER_PROFILE_NONE_VALUE && !profiles.some(profile=>profile.id===selected);
  return `<option value=""${selected===''?' selected':''}>${escapeHtml(inheritLabel)}</option>`
    +`<option value="${WEATHER_PROFILE_NONE_VALUE}"${selected===WEATHER_PROFILE_NONE_VALUE?' selected':''}>no weather</option>`
    +profiles.map(profile=>
      `<option value="${escapeHtml(profile.id)}"${profile.id===selected?' selected':''}>${escapeHtml(profile.name)}</option>`
    ).join('')
    +(missing?`<option value="${escapeHtml(selected)}" selected>missing profile · choose again</option>`:'');
}

function renderWeatherProfileSelect(id,value = ''){
  const select=$(id);
  if(!select)return;
  const profiles=normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles);
  select.innerHTML=weatherProfileOptionsHtml(value,profiles.length?'use place default':'use place default · no profiles yet');
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

function weatherGuidanceHintText(selectId){
  const settings=sortSettings || loadSortSettings();
  const choice=weatherProfileChoiceFromValue($(selectId)?.value || '');
  if(choice.weatherProfileMode==='none')return 'No weather guidance applies to this item unless a specific option overrides it.';
  if(choice.weatherProfileMode==='profile'){
    return `Uses ${weatherProfileName(choice.weatherProfileId,settings) || 'this profile'} at the scheduled place.`;
  }
  const ids=selectedWeatherLocationIds(selectId);
  const inherited=ids.map(id=>{
    const loc=normalizeLocationRegistry(settings.locations).find(item=>item.id===id);
    const name=loc && weatherProfileName(loc.weatherProfileId,settings);
    return name ? `${loc.name} · ${name}` : null;
  }).filter(Boolean);
  if(inherited.length)return `Place defaults: ${inherited.join('; ')}.`;
  return 'No selected place has weather guidance; planning is unchanged.';
}

function syncWeatherGuidanceHints(){
  for(const [selectId,hintId] of [['ting-weather-profile','ting-weather-guidance-hint'],['detail-weather-profile','detail-weather-guidance-hint']]){
    const hint=$(hintId);
    if(hint)hint.textContent=weatherGuidanceHintText(selectId);
  }
  if(typeof syncHabitScheduleOptionWeatherHints==='function')syncHabitScheduleOptionWeatherHints();
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
  if(metric==='precipitation' || metric==='snowfall')return (Math.round(value*10)/10).toFixed(1);
  return String(Math.round(value));
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
  const head=`<tr><th scope="col">time</th>${present.map(metric=>`<th scope="col">${escapeHtml(WEATHER_METRICS[metric].label)}</th>`).join('')}</tr>`;
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
    <p class="weather-forecast-legend">Shaded rows are 15-minute near-term samples — the planner reads them instead of the hourly value inside their span.</p>`;
}

// Seg + hint for the temperature display unit. 'auto' explains what it
// currently resolves to so the inferred default is never a mystery.
function syncWeatherTempUnitControls(){
  const settings=sortSettings || loadSortSettings();
  const mode=normalizeWeatherTempUnit(settings.weatherTempUnit);
  document.querySelectorAll('#weather-temp-unit-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue===mode);
  });
  const hint=$('weather-temp-unit-hint');
  if(!hint)return;
  if(mode==='auto'){
    const effective=weatherEffectiveTempUnit(settings)==='f' ? '°F' : '°C';
    const city=String(settings.homeCityName || '').trim();
    const source=settings.homeCityCountry && city ? `inferred from ${city}` : 'no city country yet · °C default';
    hint.textContent=`auto — ${effective} (${source}). Forecast data and rule bounds stay in °C.`;
  }else{
    hint.textContent=`showing ${mode==='f'?'°F':'°C'} everywhere · forecast data and rule bounds stay in °C.`;
  }
}

function renderWeatherControls(){
  syncWeatherTempUnitControls();
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
          return `
          <div class="weather-rule" data-weather-rule-index="${ruleIndex}">
            <select class="settings-select" data-weather-rule-metric aria-label="weather metric">${weatherMetricOptions(rule.metric)}</select>
            <label>min <input type="number" inputmode="decimal" data-weather-rule-min value="${rule.min??''}" placeholder="${escapeHtml(meta.range || '—')}" /></label>
            <label>max <input type="number" inputmode="decimal" data-weather-rule-max value="${rule.max??''}" placeholder="${escapeHtml(meta.range || '—')}" /></label>
            <select class="settings-select" data-weather-rule-relative aria-label="relative preference">
              <option value="none"${rule.relative==='none'?' selected':''}>no preference</option>
              <option value="low"${rule.relative==='low'?' selected':''}>prefer lower</option>
              <option value="high"${rule.relative==='high'?' selected':''}>prefer higher</option>
            </select>
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
    if(!profiles.length)status.textContent='No weather profiles yet.';
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
      profiles.push({id:`weather-${Date.now().toString(36)}`,name:profiles.length?'Outdoor '+(profiles.length+1):'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:false,relative:'low'}]});
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
    weatherProfilesMutate(profiles=>profiles[profileIndex]?.rules.push({metric:'temperature_2m',min:null,max:null,hard:false,relative:'low'}));
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
    if(event.target.matches('[data-weather-rule-min]'))rule.min=event.target.value;
    if(event.target.matches('[data-weather-rule-max]'))rule.max=event.target.value;
    if(event.target.matches('[data-weather-rule-relative]'))rule.relative=event.target.value;
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
