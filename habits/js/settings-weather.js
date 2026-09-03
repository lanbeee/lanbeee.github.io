// Weather profile controls and per-habit profile selectors.

function weatherMetricOptions(selected){
  return Object.entries(WEATHER_METRICS).map(([key,meta])=>
    `<option value="${key}"${key===selected?' selected':''}>${escapeHtml(meta.label)}${meta.unit ? ` (${escapeHtml(meta.unit)})` : ''}</option>`
  ).join('');
}

function renderWeatherProfileSelect(id,value = ''){
  const select=$(id);
  if(!select)return;
  const profiles=normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles);
  // Empty state names itself: a bare "none" dropdown reads as broken UI.
  select.innerHTML=`<option value="">${profiles.length ? 'none' : 'none · no profiles yet'}</option>`+profiles.map(profile=>
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`
  ).join('');
  select.value=profiles.some(profile=>profile.id===value)?value:'';
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

function syncWeatherHabitLocationUi(){
  const settings=sortSettings || loadSortSettings();
  const hasPlaces=(typeof locationsForDisplay === 'function' ? locationsForDisplay(settings.locations) : []).length > 0;
  const tingWrap=$('ting-weather-location-wrap');
  const detailWrap=$('detail-weather-location-wrap');
  if(tingWrap)tingWrap.hidden = !hasPlaces || !cleanWeatherProfileId($('ting-weather-profile')?.value);
  if(detailWrap)detailWrap.hidden = !hasPlaces || !cleanWeatherProfileId($('detail-weather-profile')?.value);
}

function readWeatherLocationId(selectId,profileId){
  if(!cleanWeatherProfileId(profileId))return null;
  return (typeof cleanLocationId === 'function' ? cleanLocationId($(selectId)?.value) : '') || null;
}

function weatherAgeLabel(ts){
  if(!Number.isFinite(Number(ts)) || Number(ts)<=0)return 'not loaded';
  const minutes=Math.max(0,Math.round((Date.now()-Number(ts))/60000));
  if(minutes<1)return 'just now';
  if(minutes<60)return `${minutes}m ago`;
  return `${Math.round(minutes/60)}h ago`;
}

function renderWeatherControls(){
  const list=$('weather-profile-list');
  if(!list)return;
  const settings=sortSettings || loadSortSettings();
  const profiles=normalizeWeatherProfiles(settings.weatherProfiles);
  list.innerHTML=profiles.map((profile,profileIndex)=>`
    <div class="weather-profile-card" data-weather-profile-index="${profileIndex}">
      <div class="weather-profile-head">
        <input class="settings-text-input" data-weather-profile-name value="${escapeHtml(profile.name)}" maxlength="32" aria-label="weather profile name" />
        <button class="mini-text-btn" type="button" data-weather-profile-remove>remove</button>
      </div>
      <div class="weather-rule-list">
        ${profile.rules.map((rule,ruleIndex)=>`
          <div class="weather-rule" data-weather-rule-index="${ruleIndex}">
            <select class="settings-select" data-weather-rule-metric aria-label="weather metric">${weatherMetricOptions(rule.metric)}</select>
            <label>min <input type="number" inputmode="decimal" data-weather-rule-min value="${rule.min??''}" placeholder="—" /></label>
            <label>max <input type="number" inputmode="decimal" data-weather-rule-max value="${rule.max??''}" placeholder="—" /></label>
            <select class="settings-select" data-weather-rule-relative aria-label="relative preference">
              <option value="none"${rule.relative==='none'?' selected':''}>no preference</option>
              <option value="low"${rule.relative==='low'?' selected':''}>prefer lower</option>
              <option value="high"${rule.relative==='high'?' selected':''}>prefer higher</option>
            </select>
            <label class="weather-hard"><input type="checkbox" data-weather-rule-hard${rule.hard?' checked':''} /> hard</label>
            <button class="mini-nav" type="button" data-weather-rule-remove aria-label="remove weather rule"><i class="ti ti-x" aria-hidden="true"></i></button>
          </div>`).join('')}
      </div>
      <button class="mini-text-btn" type="button" data-weather-rule-add>add rule</button>
    </div>`).join('');
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
  renderWeatherProfileSelect('ting-weather-profile',$('ting-weather-profile')?.value || '');
  renderWeatherLocationSelect('ting-weather-location',$('ting-weather-location')?.value || '');
  const detailHabit=detailIdx != null ? load()[detailIdx] : null;
  renderWeatherProfileSelect('detail-weather-profile',$('detail-weather-profile')?.value || detailHabit?.weatherProfileId || '');
  renderWeatherLocationSelect('detail-weather-location',$('detail-weather-location')?.value || detailHabit?.weatherLocationId || '');
  syncWeatherHabitLocationUi();
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
    weatherProfilesMutate(profiles=>profiles.splice(profileIndex,1));
    if(removed){
      const data=load();
      let changed=false;
      data.forEach(h=>{if(h.weatherProfileId===removed.id){h.weatherProfileId=null;changed=true;}});
      if(changed)save(data);
    }
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
