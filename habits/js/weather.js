// Keyless Open-Meteo forecasts and pure weather placement guidance.
// Forecast data is cached separately from personal backups. Open-Meteo receives
// the home-city coordinate plus any rare far-away place a habit opts into.

const WEATHER_METRICS = {
  temperature_2m:{label:'temperature',unit:'°C',aggregate:'mean'},
  apparent_temperature:{label:'feels like',unit:'°C',aggregate:'mean'},
  precipitation_probability:{label:'rain chance',unit:'%',aggregate:'max'},
  precipitation:{label:'precipitation',unit:'mm',aggregate:'sum'},
  snowfall:{label:'snowfall',unit:'cm',aggregate:'sum'},
  wind_speed_10m:{label:'wind',unit:'km/h',aggregate:'max'},
  wind_gusts_10m:{label:'gusts',unit:'km/h',aggregate:'max'},
  uv_index:{label:'UV',unit:'',aggregate:'max'},
  us_aqi:{label:'US AQI',unit:'',aggregate:'max',air:true},
  european_aqi:{label:'EU AQI',unit:'',aggregate:'max',air:true}
};
let _weatherRefreshLocks=[];

function cleanWeatherProfileId(value){
  return typeof value === 'string' ? value.trim().slice(0,48) : '';
}

function normalizeWeatherRule(raw){
  const metric = raw && WEATHER_METRICS[raw.metric] ? raw.metric : 'precipitation_probability';
  const numberOrNull = value=>{
    if(value === '' || value == null)return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-500,Math.min(5000,n)) : null;
  };
  const relative = ['low','high'].includes(raw && raw.relative) ? raw.relative : 'none';
  return {
    metric,
    min:numberOrNull(raw && raw.min),
    max:numberOrNull(raw && raw.max),
    hard:Boolean(raw && raw.hard),
    relative
  };
}

function normalizeWeatherProfiles(raw){
  if(!Array.isArray(raw))return [];
  const out = [];
  const seen = new Set();
  for(const item of raw){
    if(!item || typeof item !== 'object')continue;
    let id = cleanWeatherProfileId(item.id);
    if(!id || seen.has(id))id = `weather-${Date.now().toString(36)}-${out.length}`;
    seen.add(id);
    const rules = (Array.isArray(item.rules) ? item.rules : [])
      .slice(0,8).map(normalizeWeatherRule)
      .filter(rule=>rule.relative !== 'none' || rule.min != null || rule.max != null);
    out.push({id,name:String(item.name || `Profile ${out.length + 1}`).trim().slice(0,32) || `Profile ${out.length + 1}`,rules});
    if(out.length >= MAX_WEATHER_PROFILES)break;
  }
  return out;
}

function weatherProfileById(id,settings){
  const clean = cleanWeatherProfileId(id);
  if(!clean)return null;
  const cached=settings?._weatherContext?.profiles;
  if(Array.isArray(cached))return cached.find(profile=>profile.id===clean) || null;
  return normalizeWeatherProfiles(settings && settings.weatherProfiles).find(profile=>profile.id === clean) || null;
}

function weatherCacheRead(){
  try{
    const raw = Storage.read(WEATHER_CACHE_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  }catch{return {};}
}

function weatherCacheWrite(cache){
  try{ Storage.write(WEATHER_CACHE_KEY,cache || {});return true; }
  catch{return false;}
}

function weatherSeries(payload,section){
  const source = payload && payload[section];
  if(!source || !Array.isArray(source.time))return [];
  return source.time.map((rawTs,index)=>{
    const ts = Number(rawTs) * 1000;
    if(!Number.isFinite(ts))return null;
    const sample = {ts};
    for(const metric of Object.keys(WEATHER_METRICS)){
      const values = source[metric];
      const value = Array.isArray(values) ? Number(values[index]) : NaN;
      if(Number.isFinite(value))sample[metric] = value;
    }
    return sample;
  }).filter(Boolean);
}

function weatherNormalizePayload(payload,kind,now = Date.now()){
  const section = kind === 'near' ? 'minutely_15' : 'hourly';
  const samples = weatherSeries(payload,section);
  if(kind === 'near' && payload && payload.current && Number.isFinite(Number(payload.current.time))){
    const current = {ts:Number(payload.current.time) * 1000};
    for(const metric of Object.keys(WEATHER_METRICS)){
      const value = Number(payload.current[metric]);
      if(Number.isFinite(value))current[metric] = value;
    }
    samples.push(current);
    samples.sort((a,b)=>a.ts-b.ts);
  }
  return {
    fetchedAt:now,
    timezone:typeof payload?.timezone === 'string' ? payload.timezone : '',
    utcOffsetSeconds:Number(payload?.utc_offset_seconds) || 0,
    samples
  };
}

function weatherSameCoords(entry,lat,lng){
  if(!entry || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))return false;
  return Math.abs(Number(entry.lat) - Number(lat)) < 0.001
    && Math.abs(Number(entry.lng) - Number(lng)) < 0.001;
}

function weatherSameCity(entry,settings){
  return weatherSameCoords(entry,settings && settings.homeCityLat,settings && settings.homeCityLng);
}

function weatherLocationById(id,settings){
  const clean = typeof cleanLocationId === 'function' ? cleanLocationId(id) : String(id || '').trim().slice(0,64);
  if(!clean)return null;
  const list = Array.isArray(settings && settings.locations) ? settings.locations : [];
  return list.find(loc=>loc && loc.id === clean) || null;
}

function weatherCoordsClose(aLat,aLng,bLat,bLng){
  if(![aLat,aLng,bLat,bLng].every(Number.isFinite))return false;
  if(typeof haversineMetres === 'function')return haversineMetres(aLat,aLng,bLat,bLng) <= WEATHER_SAME_PLACE_M;
  return Math.abs(aLat-bLat) < 0.35 && Math.abs(aLng-bLng) < 0.35;
}

function weatherHomeCoords(settings){
  if(!settings || !Number.isFinite(settings.homeCityLat) || !Number.isFinite(settings.homeCityLng))return null;
  return {lat:settings.homeCityLat,lng:settings.homeCityLng,locationId:null};
}

function weatherCoordsForHabit(h,settings){
  const home = weatherHomeCoords(settings);
  const loc = weatherLocationById(h && h.weatherLocationId,settings);
  if(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)){
    if(!home || !weatherCoordsClose(loc.lat,loc.lng,home.lat,home.lng)){
      return {lat:loc.lat,lng:loc.lng,locationId:loc.id};
    }
  }
  return home;
}

function weatherMergePlaceParts(weekly,near,air,now = Date.now()){
  const weeklyFresh = weekly && now - Number(weekly.fetchedAt) <= 8 * 60 * 60 * 1000;
  const nearFresh = near && now - Number(near.fetchedAt) <= 30 * 60 * 1000;
  const airFresh = air && now - Number(air.fetchedAt) <= 8 * 60 * 60 * 1000;
  if(!weeklyFresh && !nearFresh)return null;
  const byTs = new Map();
  if(weeklyFresh)for(const sample of weekly.samples || [])byTs.set(sample.ts,{...sample,source:'weekly'});
  if(airFresh){
    for(const sample of air.samples || []){
      const nearest = [...byTs.values()].reduce((best,row)=>!best || Math.abs(row.ts-sample.ts) < Math.abs(best.ts-sample.ts) ? row : best,null);
      if(nearest && Math.abs(nearest.ts-sample.ts) <= 45 * 60 * 1000){
        if(Number.isFinite(sample.us_aqi))nearest.us_aqi=sample.us_aqi;
        if(Number.isFinite(sample.european_aqi))nearest.european_aqi=sample.european_aqi;
      }
      else byTs.set(sample.ts,{...sample,source:'air'});
    }
  }
  if(nearFresh)for(const sample of near.samples || []){
    const existing = byTs.get(sample.ts) || {};
    const enriched={...existing,...sample,source:'near'};
    if(airFresh){
      const nearestAir=(air.samples || []).reduce((best,row)=>!best || Math.abs(row.ts-sample.ts)<Math.abs(best.ts-sample.ts)?row:best,null);
      if(nearestAir && Math.abs(nearestAir.ts-sample.ts)<=45*60*1000){
        if(Number.isFinite(nearestAir.us_aqi))enriched.us_aqi=nearestAir.us_aqi;
        if(Number.isFinite(nearestAir.european_aqi))enriched.european_aqi=nearestAir.european_aqi;
      }
    }
    byTs.set(sample.ts,enriched);
  }
  return {
    timezone:near?.timezone || weekly?.timezone || '',
    samples:[...byTs.values()].sort((a,b)=>a.ts-b.ts),
    weeklyFetchedAt:weekly?.fetchedAt || 0,
    nearFetchedAt:near?.fetchedAt || 0,
    airFetchedAt:air?.fetchedAt || 0
  };
}

function weatherContextFromBucket(bucket,lat,lng,now = Date.now()){
  if(!bucket)return null;
  const weekly = weatherSameCoords(bucket.weekly,lat,lng) ? bucket.weekly : null;
  const near = weatherSameCoords(bucket.near,lat,lng) ? bucket.near : null;
  const air = weatherSameCoords(bucket.air,lat,lng) ? bucket.air : null;
  return weatherMergePlaceParts(weekly,near,air,now);
}

function weatherPlannerContext(settings,now = Date.now()){
  const profiles = normalizeWeatherProfiles(settings && settings.weatherProfiles);
  if(!profiles.length)return null;
  const cache = weatherCacheRead();
  const homeCoords = weatherHomeCoords(settings);
  const home = homeCoords
    ? weatherMergePlaceParts(
      weatherSameCoords(cache.weekly,homeCoords.lat,homeCoords.lng) ? cache.weekly : null,
      weatherSameCoords(cache.near,homeCoords.lat,homeCoords.lng) ? cache.near : null,
      weatherSameCoords(cache.air,homeCoords.lat,homeCoords.lng) ? cache.air : null,
      now)
    : null;
  const places = {};
  const placeCache = cache.places && typeof cache.places === 'object' ? cache.places : {};
  for(const [locationId,bucket] of Object.entries(placeCache)){
    const loc = weatherLocationById(locationId,settings);
    if(!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng))continue;
    const merged = weatherContextFromBucket(bucket,loc.lat,loc.lng,now);
    if(merged)places[locationId] = merged;
  }
  if(!home && !Object.keys(places).length)return null;
  const revision = [
    home?.weeklyFetchedAt || 0,
    home?.nearFetchedAt || 0,
    home?.airFetchedAt || 0,
    ...Object.keys(places).sort().flatMap(id=>[
      places[id].weeklyFetchedAt || 0,
      places[id].nearFetchedAt || 0,
      places[id].airFetchedAt || 0
    ])
  ].join(':');
  return {
    profiles,
    timezone:home?.timezone || Object.values(places)[0]?.timezone || '',
    samples:home?.samples || [],
    weeklyFetchedAt:home?.weeklyFetchedAt || 0,
    nearFetchedAt:home?.nearFetchedAt || 0,
    airFetchedAt:home?.airFetchedAt || 0,
    places,
    locks:_weatherRefreshLocks.slice(),
    revision
  };
}

function weatherContextForHabit(h,settings){
  const root = settings && settings._weatherContext;
  if(!root)return null;
  const coords = weatherCoordsForHabit(h,settings);
  if(!coords || !coords.locationId)return root;
  return (root.places && root.places[coords.locationId]) || null;
}

function weatherAggregate(samples,metric){
  const values = (samples || []).map(sample=>Number(sample && sample[metric])).filter(Number.isFinite);
  if(!values.length)return null;
  const kind = WEATHER_METRICS[metric]?.aggregate || 'mean';
  if(kind === 'max')return Math.max(...values);
  if(kind === 'sum')return values.reduce((sum,value)=>sum+value,0);
  return values.reduce((sum,value)=>sum+value,0) / values.length;
}

function weatherSamplesForInterval(context,start,end){
  if(!context || !Array.isArray(context.samples))return [];
  let rows = context.samples.filter(sample=>sample.ts < end && sample.ts >= start - 15 * 60 * 1000);
  if(rows.length){
    // Fresh 15-minute values replace the coarser weekly hour inside their
    // overlap; the hour remains the fallback outside near-term coverage.
    const near=rows.filter(row=>row.source==='near');
    return near.length ? near : rows;
  }
  const nearest = context.samples.reduce((best,row)=>!best || Math.abs(row.ts-start) < Math.abs(best.ts-start) ? row : best,null);
  return nearest && Math.abs(nearest.ts-start) <= 90 * 60 * 1000 ? [nearest] : [];
}

function weatherPlannerLocks(now = Date.now()){
  const data=typeof load==='function'?load():[];
  const limit=now+15*60*1000;
  return weatherAgendaRows().filter(row=>{
    const h=row && row.i!=null?data[row.i]:null;
    return h && (row.kind==='fill' || row.kind==='scheduled')
      && Number(row.start)>=now && Number(row.start)<=limit && Number(row.end)>Number(row.start);
  }).map(row=>({hid:data[row.i].hid,start:Number(row.start),end:Number(row.end)})).slice(0,24);
}

function weatherAgendaRows(){
  if(typeof _homeRenderedWeek!=='undefined' && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
    return _homeRenderedWeek.days.flatMap(day=>day.timeline || []);
  }
  if(typeof homeAgendaRows==='function' && typeof load==='function'){
    try{return homeAgendaRows(load());}catch{return [];}
  }
  return [];
}

function weatherLockedPlacement(fill,state,settings){
  const locks=settings?._weatherContext?.locks;
  if(!fill?.h?.hid || !Array.isArray(locks))return null;
  return locks.find(lock=>lock.hid===fill.h.hid
    && (!state?.dayBase || (lock.start>=state.dayBase && lock.start<state.dayBase+86400000))) || null;
}

function weatherDayKey(ts,timezone){
  try{
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone || undefined,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ts));
    const read=type=>parts.find(part=>part.type===type)?.value || '';
    return `${read('year')}-${read('month')}-${read('day')}`;
  }catch{return new Date(ts).toISOString().slice(0,10);}
}

function weatherPercentile(value,values){
  const list = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!list.length || !Number.isFinite(value))return 0.5;
  let below = 0;
  for(const item of list)if(item < value)below += 1;
  return list.length <= 1 ? 0.5 : below / (list.length - 1);
}

function weatherMetricStats(context,metric){
  if(!context._weatherStats)context._weatherStats={};
  if(context._weatherStats[metric])return context._weatherStats[metric];
  const values=[];
  const byDay=new Map();
  for(const sample of context.samples || []){
    const value=Number(sample[metric]);
    if(!Number.isFinite(value))continue;
    values.push(value);
    const key=weatherDayKey(sample.ts,context.timezone);
    if(!byDay.has(key))byDay.set(key,[]);
    byDay.get(key).push(sample);
  }
  const dayValues=[...byDay.values()].map(rows=>weatherAggregate(rows,metric)).filter(Number.isFinite);
  return context._weatherStats[metric]={values,byDay,dayValues};
}

function weatherRuleResult(rule,intervalSamples,context,start){
  const value = weatherAggregate(intervalSamples,rule.metric);
  if(value == null)return {known:false,penalty:0,pass:true,value:null};
  let pass = true;
  let penalty = 0;
  if(rule.min != null && value < rule.min){
    pass = false;
    penalty += 100 + Math.min(200,Math.abs(value-rule.min) * 4);
  }
  if(rule.max != null && value > rule.max){
    pass = false;
    penalty += 100 + Math.min(200,Math.abs(value-rule.max) * 4);
  }
  if(rule.relative !== 'none'){
    const stats=weatherMetricStats(context,rule.metric);
    const intervalRank = weatherPercentile(value,stats.values);
    const day = weatherDayKey(start,context.timezone);
    const dayValue = weatherAggregate(stats.byDay.get(day) || [],rule.metric);
    const dayRank = weatherPercentile(dayValue,stats.dayValues);
    const intervalBadness = rule.relative === 'low' ? intervalRank : 1-intervalRank;
    const dayBadness = rule.relative === 'low' ? dayRank : 1-dayRank;
    penalty += 100 * (intervalBadness * 0.5 + dayBadness * 0.5);
  }
  return {known:true,pass,penalty,value};
}

function weatherCommitmentOverride(fill,state){
  if(!fill || !fill.h)return false;
  if(fill.pinned === true || fill.h.pinned)return true;
  if(typeof mustPlaceCriticalOccurrence === 'function' && mustPlaceCriticalOccurrence(fill))return true;
  if(typeof doingNowForDay === 'function'){
    const doing = doingNowForDay(state);
    if(doing && doing.hid === fill.h.hid)return true;
  }
  if(fill.h.hid && typeof plannerOrderConstraintsForDay === 'function'){
    return plannerOrderConstraintsForDay(state.dayBase).some(edge=>edge && edge.adjacency === 'direct'
      && (edge.beforeHid === fill.h.hid || edge.afterHid === fill.h.hid));
  }
  return false;
}

function weatherFitAssessment(fill,fit,state,settings){
  const profile = weatherProfileById(fill?.h?.weatherProfileId,settings);
  const context = typeof weatherContextForHabit === 'function'
    ? weatherContextForHabit(fill?.h,settings)
    : (settings && settings._weatherContext);
  if(!profile || !profile.rules.length)return null;
  if(!context)return {profile,status:'unknown',hardFail:false,penalty:0,summary:'forecast unavailable · planned normally'};
  const samples = weatherSamplesForInterval(context,fit.placeStart,fit.placeEnd);
  if(!samples.length)return {profile,status:'unknown',hardFail:false,penalty:0,summary:'forecast unavailable for this time · planned normally'};
  const results = profile.rules.map(rule=>({rule,...weatherRuleResult(rule,samples,context,fit.placeStart)}));
  const known = results.filter(result=>result.known);
  if(!known.length)return {profile,status:'unknown',hardFail:false,penalty:0,summary:'forecast metrics unavailable · planned normally'};
  const failing = known.filter(result=>!result.pass);
  const hardFail = failing.some(result=>result.rule.hard);
  const overridden = hardFail && weatherCommitmentOverride(fill,state);
  const describe = result=>{
    const meta = WEATHER_METRICS[result.rule.metric];
    return `${meta.label} ${Math.round(result.value * 10) / 10}${meta.unit}`;
  };
  const summary = failing.length
    ? `${overridden ? 'weather override' : 'weather caution'} · ${failing.map(describe).join(' · ')}`
    : `good for ${profile.name} · ${known.slice(0,2).map(describe).join(' · ')}`;
  return {
    profile,
    status:overridden ? 'override' : (hardFail ? 'blocked' : (failing.length ? 'caution' : 'good')),
    hardFail:hardFail && !overridden,
    // Weather guidance outranks ordinary ASAP/preference tie-breaking, while
    // all critical/pinned/order guarantees remain hard constraints upstream.
    penalty:results.reduce((sum,result)=>sum+result.penalty,0) * 10,
    summary,
    results
  };
}

function weatherCandidateAnchors(fill,state,start,end,durationMs,settings){
  const lock=weatherLockedPlacement(fill,state,settings);
  if(lock)return lock.start>=start && lock.start+durationMs<=end ? [lock.start] : [];
  const profile = weatherProfileById(fill?.h?.weatherProfileId,settings);
  const context = weatherContextForHabit(fill?.h,settings);
  if(!profile || !context)return [];
  const candidates = context.samples
    .map(sample=>sample.ts)
    .filter(ts=>ts >= start && ts + durationMs <= end)
    .map(ts=>{
      const assessment = weatherFitAssessment(fill,{placeStart:ts,placeEnd:ts+durationMs},state,settings);
      return {ts,score:assessment ? assessment.penalty + (assessment.hardFail ? 100000 : 0) : 0};
    })
    .sort((a,b)=>a.score-b.score || a.ts-b.ts);
  return candidates.slice(0,12).map(candidate=>candidate.ts);
}

function weatherPenaltyForFit(fill,fit,state,settings){
  if(!fit)return 0;
  const assessment=fit.weather || weatherFitAssessment(fill,fit,state,settings);
  return assessment ? Number(assessment.penalty) || 0 : 0;
}

function weatherBestPenaltyForDay(candidate,state,settings){
  const context=weatherContextForHabit(candidate?.h,settings);
  const profile=weatherProfileById(candidate?.h?.weatherProfileId,settings);
  if(!context || !profile || !state)return null;
  if(typeof tryPlaceOnDay==='function' && typeof clonePlacementState==='function'){
    const fill={h:candidate.h,i:candidate.i,priority:candidate.priority,scarcity:candidate.scarcity};
    const fit=tryPlaceOnDay(clonePlacementState(state),fill,{settings,allowNetwork:false});
    if(!fit)return null;
    return weatherPenaltyForFit(fill,fit,state,settings);
  }
  return null;
}

function weatherShouldDeferCandidate(candidate,state,settings,dayStates=[]){
  if(!candidate?.h?.weatherProfileId || candidate.pinned===true)return false;
  if(typeof mustPlaceCriticalOccurrence==='function' && mustPlaceCriticalOccurrence(candidate))return false;
  if(candidate.h.hid && typeof plannerOrderConstraintsForDay==='function'
    && plannerOrderConstraintsForDay(state.dayBase).some(edge=>edge && edge.adjacency==='direct'
      && (edge.beforeHid===candidate.h.hid || edge.afterHid===candidate.h.hid)))return false;
  const today=weatherBestPenaltyForDay(candidate,state,settings);
  if(today==null)return false;
  let future=Infinity;
  for(const other of dayStates){
    if(!other || other.dayBase<=state.dayBase)continue;
    if(candidate.eligible && !candidate.eligible.has(other.dayBase))continue;
    const penalty=weatherBestPenaltyForDay(candidate,other,settings);
    if(penalty!=null)future=Math.min(future,penalty);
  }
  return Number.isFinite(future) && future+100<today;
}

function weatherConditionIcon(status){
  if(status === 'good')return 'ti-sun';
  if(status === 'unknown')return 'ti-cloud-question';
  if(status === 'override')return 'ti-shield-exclamation';
  return 'ti-cloud-rain';
}

function weatherStatusForRow(h,row,settings){
  if(!h || !row || !h.weatherProfileId)return null;
  const state = {dayBase:typeof dayStart === 'function' ? dayStart(row.start) : row.start, fills:[]};
  return weatherFitAssessment({h,i:row.i,pinned:Boolean(h.pinned) || row.kind === 'scheduled'},
    {placeStart:row.start,placeEnd:row.end},state,settings || sortSettings || loadSortSettings());
}

function weatherProfileNeedsAir(profile){
  return Boolean(profile && profile.rules && profile.rules.some(rule=>WEATHER_METRICS[rule.metric]?.air));
}

function weatherNeedsAir(settings,locationId){
  const profiles = normalizeWeatherProfiles(settings && settings.weatherProfiles);
  if(!locationId)return profiles.some(weatherProfileNeedsAir);
  const data = typeof load === 'function' ? load() : [];
  return data.some(h=>{
    if(!h || !h.weatherProfileId)return false;
    const coords = weatherCoordsForHabit(h,settings);
    if(!coords || coords.locationId !== locationId)return false;
    return weatherProfileNeedsAir(weatherProfileById(h.weatherProfileId,settings));
  });
}

function weatherLinkedUpcomingRows(now = Date.now()){
  const data = typeof load === 'function' ? load() : [];
  return weatherAgendaRows().filter(row=>{
    const h = row && row.i != null ? data[row.i] : null;
    return h && h.weatherProfileId && (row.kind === 'fill' || row.kind === 'scheduled')
      && Number(row.end) >= now && Number(row.start) <= now + WEATHER_NEAR_TRIGGER_MS;
  });
}

function weatherNeededExtraPlaces(settings,data){
  const out = [];
  const seen = new Set();
  for(const h of Array.isArray(data) ? data : []){
    if(!h || !h.weatherProfileId)continue;
    const coords = weatherCoordsForHabit(h,settings);
    if(!coords || !coords.locationId || seen.has(coords.locationId))continue;
    seen.add(coords.locationId);
    out.push(coords);
    if(out.length >= MAX_WEATHER_EXTRA_PLACES)break;
  }
  return out;
}

function weatherWatchSamples(samples,start,end,now,timezone){
  const day = weatherDayKey(now,timezone);
  const itemEnd = Math.max(Number(end) || 0,Number(start) || 0) + WEATHER_NEAR_AFTER_END_MS;
  return (samples || []).filter(sample=>{
    if(!sample || !Number.isFinite(sample.ts))return false;
    if(sample.ts >= now && weatherDayKey(sample.ts,timezone) === day)return true;
    return sample.ts >= now - 15 * 60 * 1000 && sample.ts < itemEnd;
  });
}

function weatherPrecipMetricClear(samples,metric){
  const values = (samples || []).map(sample=>Number(sample && sample[metric])).filter(Number.isFinite);
  return values.length > 0 && Math.max(...values) <= 0;
}

function weatherForecastIsDecisive(profile,samples,start,end,now,timezone){
  if(!profile || !Array.isArray(profile.rules) || !profile.rules.length)return true;
  const watch = weatherWatchSamples(samples,start,end,now,timezone);
  const itemCover = weatherSamplesForInterval({samples},start,end);
  const use = watch.length ? watch : itemCover;
  if(!use.length)return false;
  const margins = typeof WEATHER_STABLE_MARGINS === 'object' && WEATHER_STABLE_MARGINS ? WEATHER_STABLE_MARGINS : {};
  for(const rule of profile.rules){
    if(rule.relative !== 'none' && rule.min == null && rule.max == null)continue;
    const values = use.map(sample=>Number(sample && sample[rule.metric])).filter(Number.isFinite);
    if(!values.length)return false;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const precip = rule.metric === 'precipitation_probability' || rule.metric === 'precipitation' || rule.metric === 'snowfall';
    if(precip && weatherPrecipMetricClear(use,rule.metric))continue;
    const margin = Number.isFinite(margins[rule.metric]) ? margins[rule.metric] : 0;
    if(rule.max != null){
      if(hi <= rule.max - margin || lo > rule.max + margin)continue;
      return false;
    }
    if(rule.min != null){
      if(lo >= rule.min + margin || hi < rule.min - margin)continue;
      return false;
    }
  }
  return true;
}

function weatherNearRefreshNeeded(rows,data,settings,context,now = Date.now()){
  if(!Array.isArray(rows) || !rows.length)return false;
  if(!context || !Array.isArray(context.samples) || !context.samples.length)return true;
  for(const row of rows){
    const h = row && row.i != null && Array.isArray(data) ? data[row.i] : (row && row.h) || null;
    const profile = weatherProfileById(h && h.weatherProfileId,settings);
    if(!profile)continue;
    if(!weatherForecastIsDecisive(profile,context.samples,Number(row.start),Number(row.end),now,context.timezone))return true;
  }
  return false;
}

function weatherFetchJson(url,timeoutMs = 10000){
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(()=>controller.abort(),timeoutMs) : null;
  return fetch(url,{credentials:'omit',cache:'no-store',signal:controller?.signal})
    .then(response=>{if(!response.ok)throw new Error(`weather ${response.status}`);return response.json();})
    .finally(()=>{if(timer)clearTimeout(timer);});
}

function weatherUrl(base,lat,lng,params){
  const url = new URL(base);
  url.searchParams.set('latitude',String(lat));
  url.searchParams.set('longitude',String(lng));
  url.searchParams.set('timezone','auto');
  url.searchParams.set('timeformat','unixtime');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  return url.toString();
}

function weatherEnsurePlaceBucket(cache,locationId){
  if(!locationId)return cache;
  if(!cache.places || typeof cache.places !== 'object')cache.places = {};
  if(!cache.places[locationId] || typeof cache.places[locationId] !== 'object')cache.places[locationId] = {};
  return cache.places[locationId];
}

function weatherNearParamsForRows(rows,now){
  const latestEnd = Math.max(...rows.map(row=>Number(row.end) || now));
  const horizon = Math.min(WEATHER_NEAR_MAX_HORIZON_MS,Math.max(WEATHER_NEAR_MIN_HORIZON_MS,latestEnd-now+WEATHER_NEAR_AFTER_END_MS));
  const count = Math.max(8,Math.min(16,Math.ceil(horizon / (15*60*1000))));
  return {horizon,count};
}

let _weatherRefreshPromise = null;
async function refreshWeatherForecast(options = {}){
  if(_weatherRefreshPromise)return _weatherRefreshPromise;
  const force = Boolean(options.force);
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (sortSettings || {});
  const profiles = normalizeWeatherProfiles(settings.weatherProfiles);
  const home = weatherHomeCoords(settings);
  if(!profiles.length || !home)return false;
  _weatherRefreshPromise = (async()=>{
    const now = Date.now();
    const cache = weatherCacheRead();
    const data = typeof load === 'function' ? load() : [];
    const extras = weatherNeededExtraPlaces(settings,data);
    let changed = false;
    const common = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,uv_index';
    const fetchWeekly = async(bucket,lat,lng)=>{
      if(force || !weatherSameCoords(bucket.weekly,lat,lng) || now-Number(bucket.weekly?.fetchedAt) >= WEATHER_WEEKLY_TTL_MS){
        const payload = await weatherFetchJson(weatherUrl(WEATHER_FORECAST_URL,lat,lng,{hourly:common,forecast_days:7}));
        bucket.weekly = {...weatherNormalizePayload(payload,'weekly',now),lat,lng};
        changed = true;
      }
    };
    const fetchAir = async(bucket,lat,lng,need)=>{
      if(!need)return;
      if(force || !weatherSameCoords(bucket.air,lat,lng) || now-Number(bucket.air?.fetchedAt) >= WEATHER_WEEKLY_TTL_MS){
        try{
          const payload = await weatherFetchJson(weatherUrl(WEATHER_AIR_URL,lat,lng,{hourly:'us_aqi,european_aqi',forecast_days:7}));
          bucket.air = {...weatherNormalizePayload(payload,'weekly',now),lat,lng};
          changed = true;
        }catch(error){ cache.lastError=String(error && error.message || error); }
      }
    };
    await fetchWeekly(cache,home.lat,home.lng);
    await fetchAir(cache,home.lat,home.lng,weatherNeedsAir(settings));
    for(const place of extras){
      const bucket = weatherEnsurePlaceBucket(cache,place.locationId);
      await fetchWeekly(bucket,place.lat,place.lng);
      await fetchAir(bucket,place.lat,place.lng,weatherNeedsAir(settings,place.locationId));
    }
    const upcoming = weatherLinkedUpcomingRows(now);
    const groups = new Map();
    for(const row of upcoming){
      const h = data[row.i];
      const coords = weatherCoordsForHabit(h,settings) || home;
      const key = coords.locationId || 'home';
      if(!groups.has(key))groups.set(key,{coords,rows:[]});
      groups.get(key).rows.push(row);
    }
    for(const [key,group] of groups){
      const bucket = key === 'home' ? cache : weatherEnsurePlaceBucket(cache,key);
      const context = weatherContextFromBucket(bucket,group.coords.lat,group.coords.lng,now);
      if(!force && !weatherNearRefreshNeeded(group.rows,data,settings,context,now))continue;
      if(!force && weatherSameCoords(bucket.near,group.coords.lat,group.coords.lng)
        && now-Number(bucket.near?.fetchedAt) < WEATHER_NEAR_TTL_MS)continue;
      const params = weatherNearParamsForRows(group.rows,now);
      const payload = await weatherFetchJson(weatherUrl(WEATHER_FORECAST_URL,group.coords.lat,group.coords.lng,{
        current:common,minutely_15:common,forecast_minutely_15:params.count
      }));
      bucket.near = {...weatherNormalizePayload(payload,'near',now),lat:group.coords.lat,lng:group.coords.lng,horizonMs:params.horizon};
      changed = true;
    }
    const keep = new Set(extras.map(place=>place.locationId));
    if(cache.places && typeof cache.places === 'object'){
      for(const id of Object.keys(cache.places)){
        if(!keep.has(id))delete cache.places[id];
      }
    }
    cache.lastError = '';
    weatherCacheWrite(cache);
    if(changed){
      _weatherRefreshLocks=weatherPlannerLocks(now);
      if(typeof sortSettings !== 'undefined')sortSettings = loadSortSettings();
      if(typeof bumpPlannerDataRevision === 'function')bumpPlannerDataRevision();
      if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged(true,{__weatherChanged:true,__forceReplan:true});
      else if(typeof render === 'function')render();
      if(typeof renderWeatherControls === 'function')renderWeatherControls();
      setTimeout(()=>{_weatherRefreshLocks=[];},0);
    }
    return changed;
  })().catch(error=>{
    const cache = weatherCacheRead();
    cache.lastError = String(error && error.message || error);
    cache.lastAttemptAt = Date.now();
    weatherCacheWrite(cache);
    if(typeof renderWeatherControls === 'function')renderWeatherControls();
    return false;
  }).finally(()=>{_weatherRefreshPromise=null;});
  return _weatherRefreshPromise;
}

let _weatherLoopId = null;
function startWeatherLifecycle(){
  const tick=()=>{if(typeof document === 'undefined' || !document.hidden)void refreshWeatherForecast();};
  tick();
  if(_weatherLoopId == null)_weatherLoopId=setInterval(tick,WEATHER_NEAR_TTL_MS);
  if(typeof document !== 'undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
}
