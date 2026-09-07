// Keyless Open-Meteo forecasts and pure weather placement guidance.
// Forecast data is cached separately from personal backups. Open-Meteo receives
// the home-city coordinate plus any rare far-away place a habit opts into.

const WEATHER_METRICS = {
  temperature_2m:{label:'temperature',unit:'°C',aggregate:'mean',range:'−20–40',hint:'°C · 0 freezes · 20 mild · 30+ hot'},
  apparent_temperature:{label:'feels like',unit:'°C',aggregate:'mean',range:'−20–40',hint:'°C · temperature adjusted for wind and humidity'},
  precipitation_probability:{label:'rain chance',unit:'%',aggregate:'max',range:'0–100',hint:'% chance · 0–20 dry · 30–60 unsettled · 70+ wet'},
  precipitation:{label:'precipitation',unit:'mm',aggregate:'sum',range:'0–10',hint:'mm during the item · under 2.5 light · over 7.5 heavy'},
  snowfall:{label:'snowfall',unit:'cm',aggregate:'sum',range:'0–10',hint:'cm during the item'},
  wind_speed_10m:{label:'wind',unit:'km/h',aggregate:'max',range:'0–60',hint:'km/h · under 12 light · 20 fresh · 35+ strong'},
  wind_gusts_10m:{label:'gusts',unit:'km/h',aggregate:'max',range:'0–90',hint:'km/h peak gusts · 60+ feels stormy'},
  uv_index:{label:'UV',unit:'',aggregate:'max',range:'0–11',hint:'UV index · 0–2 low · 3–5 moderate · 6–7 high · 8+ very high'},
  us_aqi:{label:'US AQI',unit:'',aggregate:'max',air:true,range:'0–300',hint:'air quality · 0–50 good · 51–100 moderate · 101+ unhealthy'},
  european_aqi:{label:'EU AQI',unit:'',aggregate:'max',air:true,range:'0–100',hint:'air quality · 0–20 good · 21–40 fair · 41–60 moderate · 61+ poor'}
};
let _weatherRefreshLocks=[];

function cleanWeatherProfileId(value){
  return typeof value === 'string' ? value.trim().slice(0,48) : '';
}

// A rule constrains only once it has a bound or a relative preference;
// otherwise it is kept (so bounds can be added later) but ignored.
function weatherRuleActive(rule){
  return Boolean(rule && (rule.min != null || rule.max != null || rule.relative !== 'none'));
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
    // Never drop configured rules here: selecting "no preference" before
    // typing bounds must not delete the rule out from under the editor.
    const rules = (Array.isArray(item.rules) ? item.rules : [])
      .slice(0,8).map(normalizeWeatherRule);
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
    for(const field of ['weather_code','is_day']){
      const value=Array.isArray(source[field]) ? Number(source[field][index]) : NaN;
      if(Number.isFinite(value))sample[field]=value;
    }
    return sample;
  }).filter(Boolean);
}

const WEATHER_DAILY_FIELDS = [
  'weather_code','temperature_2m_min','temperature_2m_max',
  'apparent_temperature_min','apparent_temperature_max',
  'precipitation_probability_max','precipitation_sum','snowfall_sum',
  'wind_speed_10m_max','wind_gusts_10m_max','uv_index_max'
];

function weatherDailySeries(payload){
  const source=payload && payload.daily;
  if(!source || !Array.isArray(source.time))return [];
  const utcOffsetSeconds=Number(payload?.utc_offset_seconds) || 0;
  return source.time.map((rawTs,index)=>{
    const unixSeconds=Number(rawTs);
    const ts=unixSeconds*1000;
    if(!Number.isFinite(ts))return null;
    // Open-Meteo documents daily Unix timestamps as GMT+0 and asks clients to
    // apply utc_offset_seconds to recover the forecast location's date.
    const localClock=new Date((unixSeconds+utcOffsetSeconds)*1000);
    const key=`${localClock.getUTCFullYear()}-${String(localClock.getUTCMonth()+1).padStart(2,'0')}-${String(localClock.getUTCDate()).padStart(2,'0')}`;
    const day={ts,key};
    for(const field of WEATHER_DAILY_FIELDS){
      const value=Array.isArray(source[field]) ? Number(source[field][index]) : NaN;
      if(Number.isFinite(value))day[field]=value;
    }
    return day;
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
    for(const field of ['weather_code','is_day']){
      const value=Number(payload.current[field]);
      if(Number.isFinite(value))current[field]=value;
    }
    samples.push(current);
    samples.sort((a,b)=>a.ts-b.ts);
  }
  return {
    fetchedAt:now,
    timezone:typeof payload?.timezone === 'string' ? payload.timezone : '',
    utcOffsetSeconds:Number(payload?.utc_offset_seconds) || 0,
    samples,
    days:kind === 'weekly' ? weatherDailySeries(payload) : []
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

// PURE: ambient interval weather is a display preference, separate from the
// named profiles that steer planning. Minimal mode never turns it on.
function weatherItemShowsAmbient(h){
  return Boolean(h && h.showWeather);
}

function weatherAmbientEnabled(settings,data){
  if(!settings || settings.minimalMode)return false;
  if(settings.showWeatherOnBusyTimes || settings.showWeatherOnTravel)return true;
  const list=Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.some(weatherItemShowsAmbient);
}

function weatherCoordsForLocation(locationId,settings){
  const home=weatherHomeCoords(settings);
  const loc=weatherLocationById(locationId,settings);
  if(!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng))return home;
  if(home && weatherCoordsClose(loc.lat,loc.lng,home.lat,home.lng))return home;
  return {lat:loc.lat,lng:loc.lng,locationId:loc.id};
}

function weatherDisplayLocationId(h,row){
  if(!h || !h.showWeatherAtLocation)return null;
  return (row && row.locationId) || (Array.isArray(h.locationIds) && h.locationIds[0]) || null;
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
    days:Array.isArray(weekly?.days) ? weekly.days.slice() : [],
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
  if(!profiles.length && !weatherAmbientEnabled(settings))return null;
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
    days:home?.days || [],
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

function weatherContextForLocation(locationId,settings){
  const root=settings && settings._weatherContext;
  if(!root)return null;
  const coords=weatherCoordsForLocation(locationId,settings);
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

// PURE: display intervals need the hourly sample that covers a partial hour.
// Keep later hourly rows when near-term detail covers only the start, while
// suppressing an hourly duplicate at the same forecast timestamp.
function weatherSamplesForDisplayInterval(context,start,end){
  if(!context || !Array.isArray(context.samples))return [];
  const rows=context.samples.filter(sample=>{
    const lead=sample.source==='near' ? 15*60*1000 : 60*60*1000;
    return sample.ts<end && sample.ts>=start-lead;
  });
  const near=rows.filter(sample=>sample.source==='near');
  const merged=near.length ? rows.filter(sample=>sample.source!=='weekly'
    || !near.some(detail=>Math.abs(detail.ts-sample.ts)<10*60*1000)) : rows;
  if(merged.length)return merged.sort((a,b)=>a.ts-b.ts);
  const nearest=context.samples.reduce((best,row)=>!best || Math.abs(row.ts-start)<Math.abs(best.ts-start)?row:best,null);
  return nearest && Math.abs(nearest.ts-start)<=90*60*1000 ? [nearest] : [];
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
    // The planner timeline owns fills/blocks; Home's presentation timeline
    // additionally owns synthesized travel legs. Preserve both without
    // duplicating the shared fill row objects.
    return [...new Set(_homeRenderedWeek.days.flatMap(day=>[
      ...(day.timeline || []),...(day.homeDisplayedTimeline || [])
    ]))];
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
  const activeRules = (profile && Array.isArray(profile.rules) ? profile.rules : []).filter(weatherRuleActive);
  const context = typeof weatherContextForHabit === 'function'
    ? weatherContextForHabit(fill?.h,settings)
    : (settings && settings._weatherContext);
  if(!activeRules.length)return null;
  if(!context)return {profile,status:'unknown',hardFail:false,penalty:0,summary:'forecast unavailable · planned normally'};
  const samples = weatherSamplesForInterval(context,fit.placeStart,fit.placeEnd);
  if(!samples.length)return {profile,status:'unknown',hardFail:false,penalty:0,summary:'forecast unavailable for this time · planned normally'};
  const results = activeRules.map(rule=>({rule,...weatherRuleResult(rule,samples,context,fit.placeStart)}));
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

function weatherConditionEmoji(status){
  if(status==='good')return '☀️';
  if(status==='unknown')return '☁️';
  if(status==='override')return '⚠️';
  return '🌧️';
}

function weatherStatusForRow(h,row,settings){
  if(!h || !row || !h.weatherProfileId)return null;
  const state = {dayBase:typeof dayStart === 'function' ? dayStart(row.start) : row.start, fills:[]};
  return weatherFitAssessment({h,i:row.i,pinned:Boolean(h.pinned) || row.kind === 'scheduled'},
    {placeStart:row.start,placeEnd:row.end},state,settings || sortSettings || loadSortSettings());
}

function weatherCodePresentation(value){
  const code=Math.round(Number(value));
  if(code===0)return {code,label:'clear',icon:'ti-sun',emoji:'☀️',rank:0,tone:'sun'};
  if(code===1)return {code,label:'mostly clear',icon:'ti-sun-low',emoji:'🌤️',rank:1,tone:'sun'};
  if(code===2)return {code,label:'partly cloudy',icon:'ti-cloud-sun',emoji:'⛅',rank:2,tone:'cloud'};
  if(code===3)return {code,label:'overcast',icon:'ti-cloud',emoji:'☁️',rank:3,tone:'cloud'};
  if(code===45 || code===48)return {code,label:'fog',icon:'ti-mist',emoji:'🌫️',rank:4,tone:'fog'};
  if(code===51)return {code,label:'light drizzle',icon:'ti-cloud-rain',emoji:'🌦️',rank:5,tone:'rain'};
  if(code===53)return {code,label:'drizzle',icon:'ti-cloud-rain',emoji:'🌦️',rank:5.5,tone:'rain'};
  if(code===55)return {code,label:'heavy drizzle',icon:'ti-cloud-rain',emoji:'🌧️',rank:6,tone:'rain'};
  if(code===56 || code===57)return {code,label:code===56?'light freezing drizzle':'freezing drizzle',icon:'ti-cloud-rain',emoji:'🌧️❄️',rank:8,tone:'ice'};
  if(code===61)return {code,label:'light rain',icon:'ti-cloud-rain',emoji:'🌦️',rank:6,tone:'rain'};
  if(code===63)return {code,label:'rain',icon:'ti-cloud-rain',emoji:'🌧️',rank:7,tone:'rain'};
  if(code===65)return {code,label:'heavy rain',icon:'ti-cloud-rain',emoji:'🌧️🌧️',rank:8,tone:'rain'};
  if(code===66 || code===67)return {code,label:code===66?'light freezing rain':'freezing rain',icon:'ti-cloud-rain',emoji:'🌧️❄️',rank:8.5,tone:'ice'};
  if(code===71)return {code,label:'light snow',icon:'ti-snowflake',emoji:'🌨️',rank:6,tone:'snow'};
  if(code===73 || code===77)return {code,label:code===77?'snow grains':'snow',icon:'ti-snowflake',emoji:'🌨️',rank:7,tone:'snow'};
  if(code===75)return {code,label:'heavy snow',icon:'ti-snowflake',emoji:'🌨️❄️',rank:8,tone:'snow'};
  if(code===80)return {code,label:'light rain showers',icon:'ti-cloud-rain',emoji:'🌦️',rank:6,tone:'rain'};
  if(code===81)return {code,label:'rain showers',icon:'ti-cloud-rain',emoji:'🌧️',rank:7,tone:'rain'};
  if(code===82)return {code,label:'heavy rain showers',icon:'ti-cloud-rain',emoji:'🌧️🌧️',rank:8.5,tone:'rain'};
  if(code===85)return {code,label:'snow showers',icon:'ti-snowflake',emoji:'🌨️',rank:7,tone:'snow'};
  if(code===86)return {code,label:'heavy snow showers',icon:'ti-snowflake',emoji:'🌨️❄️',rank:8.5,tone:'snow'};
  if(code===95)return {code,label:'thunderstorms',icon:'ti-cloud-storm',emoji:'⛈️',rank:10,tone:'storm'};
  if(code===96 || code===99)return {code,label:code===99?'thunderstorms with heavy hail':'thunderstorms with hail',icon:'ti-cloud-storm',emoji:'⛈️🧊',rank:11,tone:'storm'};
  return {code:Number.isFinite(code)?code:null,label:'forecast',icon:'ti-cloud',emoji:'☁️',rank:0,tone:'cloud'};
}

function weatherDayTimestamp(dayBase){
  if(typeof dayBase==='string'){
    const parsed=new Date(`${dayBase}T12:00:00`).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  const value=Number(dayBase);
  return Number.isFinite(value) ? value : null;
}

function weatherRequestedDayKey(dayBase){
  if(typeof dayBase==='string' && /^\d{4}-\d{2}-\d{2}$/.test(dayBase))return dayBase;
  const ts=weatherDayTimestamp(dayBase);
  if(ts==null)return '';
  return typeof dateKey==='function' ? dateKey(ts) : new Date(ts).toISOString().slice(0,10);
}

function weatherDayRows(context,dayBase){
  const ts=weatherDayTimestamp(dayBase);
  if(!context || ts==null)return [];
  const key=weatherRequestedDayKey(dayBase);
  return (context.samples || []).filter(sample=>weatherDayKey(sample.ts,context.timezone)===key);
}

function weatherDayFallback(context,dayBase){
  const rows=weatherDayRows(context,dayBase);
  if(!rows.length)return null;
  const values=field=>rows.map(row=>Number(row && row[field])).filter(Number.isFinite);
  const low=values('temperature_2m');
  const apparent=values('apparent_temperature');
  const probabilities=values('precipitation_probability');
  const wind=values('wind_speed_10m');
  const gusts=values('wind_gusts_10m');
  const uv=values('uv_index');
  const codes=values('weather_code').map(weatherCodePresentation).sort((a,b)=>b.rank-a.rank);
  let weatherCode=codes[0]?.code;
  if(!Number.isFinite(weatherCode)){
    const snow=weatherAggregate(rows,'snowfall') || 0;
    const rain=weatherAggregate(rows,'precipitation') || 0;
    const chance=probabilities.length ? Math.max(...probabilities) : 0;
    weatherCode=snow>0 ? 71 : (rain>0 || chance>=50 ? 61 : 0);
  }
  return {
    ts:weatherDayTimestamp(dayBase),weather_code:weatherCode,
    temperature_2m_min:low.length?Math.min(...low):null,
    temperature_2m_max:low.length?Math.max(...low):null,
    apparent_temperature_min:apparent.length?Math.min(...apparent):null,
    apparent_temperature_max:apparent.length?Math.max(...apparent):null,
    precipitation_probability_max:probabilities.length?Math.max(...probabilities):null,
    precipitation_sum:weatherAggregate(rows,'precipitation'),
    snowfall_sum:weatherAggregate(rows,'snowfall'),
    wind_speed_10m_max:wind.length?Math.max(...wind):null,
    wind_gusts_10m_max:gusts.length?Math.max(...gusts):null,
    uv_index_max:uv.length?Math.max(...uv):null
  };
}

function weatherDaySummary(context,dayBase,settings,now=Date.now()){
  const ts=weatherDayTimestamp(dayBase);
  if(!context || ts==null || !Number(context.weeklyFetchedAt))return null;
  if(now-Number(context.weeklyFetchedAt)>8*60*60*1000)return null;
  const key=weatherRequestedDayKey(dayBase);
  if(key<weatherRequestedDayKey(now))return null;
  const daily=(context.days || []).find(day=>day.key===key || weatherDayKey(day.ts,context.timezone)===key)
    || weatherDayFallback(context,ts);
  if(!daily)return null;
  const condition=weatherCodePresentation(daily.weather_code);
  const finite=value=>Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    key,dayBase:ts,condition,
    low:finite(daily.temperature_2m_min),high:finite(daily.temperature_2m_max),
    apparentLow:finite(daily.apparent_temperature_min),apparentHigh:finite(daily.apparent_temperature_max),
    precipitationChance:finite(daily.precipitation_probability_max),
    precipitation:finite(daily.precipitation_sum),snowfall:finite(daily.snowfall_sum),
    wind:finite(daily.wind_speed_10m_max),gusts:finite(daily.wind_gusts_10m_max),
    uv:finite(daily.uv_index_max),
    fetchedAt:Number(context.weeklyFetchedAt),timezone:context.timezone || '',
    cityName:String(settings?.homeCityName || '').trim() || 'home city'
  };
}

function weatherContextDayRows(dayBase,dayContext=null){
  const ts=weatherDayTimestamp(dayBase);
  if(ts==null)return [];
  const candidates=[];
  if(dayContext){
    candidates.push(...(dayContext.homeDisplayedTimeline || dayContext.timeline || []));
  }else if(typeof _homeRenderedWeek!=='undefined' && _homeRenderedWeek?.days){
    const day=_homeRenderedWeek.days.find(item=>dayStart(item.dayBase)===dayStart(ts));
    if(day)candidates.push(...(day.homeDisplayedTimeline || day.timeline || []));
  }
  if(!candidates.length && typeof weekForOverviewDay==='function' && typeof load==='function'){
    const key=typeof dateKey==='function' ? dateKey(ts) : '';
    const week=weekForOverviewDay(load(),key);
    const day=week?.days?.find(item=>dayStart(item.dayBase)===dayStart(ts));
    if(day)candidates.push(...(day.homeDisplayedTimeline || day.timeline || []));
  }
  if(!candidates.length && typeof weatherAgendaRows==='function')candidates.push(...weatherAgendaRows());
  return candidates.filter(row=>row && Number.isFinite(Number(row.start)) && dayStart(Number(row.start))===dayStart(ts));
}

function weatherGuidedItemsForDay(dayBase,dayContext,settings,data=null){
  const list=Array.isArray(data) ? data : (typeof load==='function' ? load() : []);
  return weatherContextDayRows(dayBase,dayContext).map(row=>{
    if(row.kind!=='fill' && row.kind!=='scheduled')return null;
    const h=row.h || (row.i!=null ? list[row.i] : null);
    if(!h?.weatherProfileId)return null;
    const assessment=weatherStatusForRow(h,row,settings);
    if(!assessment)return null;
    const coords=weatherCoordsForHabit(h,settings);
    const loc=coords?.locationId ? weatherLocationById(coords.locationId,settings) : null;
    return {h,row,assessment,locationName:loc?.name || String(settings?.homeCityName || '').trim() || 'home city'};
  }).filter(Boolean).sort((a,b)=>Number(a.row.start)-Number(b.row.start));
}

function weatherExceptionForDay(dayBase,dayContext,settings,data=null){
  const rank={override:3,blocked:2,caution:2,unknown:0,good:0};
  return weatherGuidedItemsForDay(dayBase,dayContext,settings,data)
    .filter(item=>(rank[item.assessment.status] || 0)>0)
    .sort((a,b)=>(rank[b.assessment.status] || 0)-(rank[a.assessment.status] || 0))[0] || null;
}

function weatherFeelsBounds(summary){
  if(!summary)return null;
  const low=summary.apparentLow ?? summary.low;
  const high=summary.apparentHigh ?? summary.high;
  if(!Number.isFinite(Number(low)) && !Number.isFinite(Number(high)))return null;
  const a=Math.round(Number.isFinite(Number(low)) ? Number(low) : Number(high));
  const b=Math.round(Number.isFinite(Number(high)) ? Number(high) : Number(low));
  return {low:Math.min(a,b),high:Math.max(a,b)};
}

function weatherTemperatureRange(summary){
  const bounds=weatherFeelsBounds(summary);
  if(!bounds)return '';
  return bounds.low===bounds.high ? `${bounds.low}°` : `${bounds.low}–${bounds.high}°`;
}

function weatherPeriodTemperatureRange(summary){
  const bounds=weatherFeelsBounds(summary);
  if(!bounds)return '';
  const duration=Number(summary && summary.end)-Number(summary && summary.start);
  const longEnough=duration>=WEATHER_PERIOD_RANGE_MIN_MS;
  const varied=bounds.high-bounds.low>=WEATHER_PERIOD_RANGE_DELTA_C;
  if(longEnough && varied)return `${bounds.low}–${bounds.high}°`;
  if(Number.isFinite(Number(summary.apparentMean)))return `${Math.round(Number(summary.apparentMean))}°`;
  return `${bounds.low}°`;
}

// PURE: summarize only the clock interval occupied by a card. The most
// consequential WMO condition wins, while temperatures span the sampled
// period. This is presentation-only and never feeds planner scoring.
function weatherPeriodSummary(start,end,settings,locationId=null,now=Date.now()){
  const from=Number(start);const to=Number(end);
  if(!settings || settings.minimalMode || !Number.isFinite(from) || !Number.isFinite(to) || to<=from)return null;
  if(weatherRequestedDayKey(from)<weatherRequestedDayKey(now))return null;
  const context=weatherContextForLocation(locationId,settings);
  if(!context || !Number(context.weeklyFetchedAt) || now-Number(context.weeklyFetchedAt)>8*60*60*1000)return null;
  const samples=weatherSamplesForDisplayInterval(context,from,to);
  if(!samples.length)return null;
  const numbers=field=>samples.map(sample=>Number(sample && sample[field])).filter(Number.isFinite);
  const apparent=numbers('apparent_temperature');
  const temps=numbers('temperature_2m');
  const feel=apparent.length ? apparent : temps;
  const chances=numbers('precipitation_probability');
  const snow=numbers('snowfall');
  const rain=numbers('precipitation');
  const wind=numbers('wind_speed_10m');
  const codes=numbers('weather_code').map(weatherCodePresentation).sort((a,b)=>b.rank-a.rank);
  let condition=codes[0] || null;
  if(!condition){
    const snowTotal=snow.reduce((sum,value)=>sum+value,0);
    const rainTotal=rain.reduce((sum,value)=>sum+value,0);
    const chance=chances.length?Math.max(...chances):0;
    condition=weatherCodePresentation(snowTotal>0?71:(rainTotal>0||chance>=50?61:0));
  }
  const coords=weatherCoordsForLocation(locationId,settings);
  const loc=coords?.locationId ? weatherLocationById(coords.locationId,settings) : null;
  return {
    start:from,end:to,condition,
    low:temps.length?Math.min(...temps):null,
    high:temps.length?Math.max(...temps):null,
    apparentLow:feel.length?Math.min(...feel):null,
    apparentHigh:feel.length?Math.max(...feel):null,
    apparentMean:feel.length?feel.reduce((sum,value)=>sum+value,0)/feel.length:null,
    precipitationChance:chances.length?Math.max(...chances):null,
    precipitation:rain.length?rain.reduce((sum,value)=>sum+value,0):null,
    snowfall:snow.length?snow.reduce((sum,value)=>sum+value,0):null,
    wind:wind.length?Math.max(...wind):null,
    fetchedAt:Number(context.weeklyFetchedAt),
    timezone:context.timezone || '',
    placeName:loc?.name || String(settings.homeCityName || '').trim() || 'home city'
  };
}

function weatherPeriodPillHtml(start,end,settings,options={}){
  const summary=weatherPeriodSummary(start,end,settings,options.locationId || null,options.now || Date.now());
  if(!summary)return '';
  const temp=weatherPeriodTemperatureRange(summary);
  const wet=['rain','ice','snow','storm'].includes(summary.condition.tone);
  const snow=summary.snowfall>0 ? `${Math.round(summary.snowfall*10)/10}cm` : '';
  const chance=wet && summary.precipitationChance!=null ? `${Math.round(summary.precipitationChance)}%` : '';
  const signal=snow || chance;
  const assessment=options.assessment || null;
  const warning=assessment && ['caution','blocked','override'].includes(assessment.status)
    ? `<i class="ti ${assessment.status==='override'?'ti-shield-exclamation':'ti-alert-triangle'} weather-guidance-mark" aria-hidden="true"></i>` : '';
  const detail=[
    `${summary.condition.label} in ${summary.placeName}`,
    temp?`feels like ${temp} Celsius`:'',
    summary.precipitationChance==null?'':`${Math.round(summary.precipitationChance)}% precipitation`,
    summary.snowfall>0?`${Math.round(summary.snowfall*10)/10} cm snow`:'',
    summary.wind==null?'':`${Math.round(summary.wind)} km/h wind`,
    assessment?.summary || '',weatherFreshnessText(summary.fetchedAt,options.now || Date.now())
  ].filter(Boolean).join(', ');
  const cls=`context-pill weather-period-pill weather-tone-${summary.condition.tone}${assessment?` guidance-${assessment.status || 'unknown'}`:''}${options.className?` ${options.className}`:''}`;
  const inside=`<span class="weather-condition-emoji" aria-hidden="true">${escapeHtml(summary.condition.emoji || '☁️')}</span>${temp?`<span class="weather-period-temperature">${escapeHtml(temp)}</span>`:''}${signal?`<span class="weather-period-signal">${escapeHtml(signal)}</span>`:''}${warning}`;
  if(options.interactive){
    const dayBase=typeof dayStart==='function'?dayStart(Number(start)):Number(start);
    return `<button type="button" class="${escapeHtml(cls)}" data-weather-info="${escapeHtml(detail)}" data-weather-day="${dayBase}"${options.hid?` data-weather-hid="${escapeHtml(options.hid)}"`:''} title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">${inside}</button>`;
  }
  return `<span class="${escapeHtml(cls)}" title="${escapeHtml(detail)}" role="img" aria-label="${escapeHtml(detail)}">${inside}</span>`;
}

function weatherDayPresentation(dayBase,dayContext,settings,data=null){
  const s=settings || (typeof sortSettings!=='undefined' ? sortSettings : null) || (typeof loadSortSettings==='function' ? loadSortSettings() : {});
  const context=s?._weatherContext;
  const summary=weatherDaySummary(context,dayBase,s);
  if(!summary)return null;
  const minimal=Boolean(s.minimalMode);
  if(minimal){
    const exception=weatherExceptionForDay(dayBase,dayContext,s,data);
    if(!exception)return null;
    const status=exception.assessment.status || 'caution';
    return {summary,status,icon:weatherConditionIcon(status),emoji:weatherConditionEmoji(status),label:exception.assessment.summary,showTemperature:false};
  }
  return {
    summary,status:'forecast',tone:summary.condition.tone,icon:summary.condition.icon,emoji:summary.condition.emoji,
    label:`${summary.condition.label} in ${summary.cityName}`,
    showTemperature:Boolean(s.showWeatherTemperatureRanges)
  };
}

function weatherDayCueHtml(dayBase,dayContext,settings,options={}){
  const presentation=weatherDayPresentation(dayBase,dayContext,settings,options.data || null);
  if(!presentation)return '';
  const minimal=presentation.status!=='forecast';
  const temp=presentation.showTemperature ? weatherTemperatureRange(presentation.summary) : '';
  const summary=presentation.summary;
  const wet=summary.condition.tone==='rain' || summary.condition.tone==='ice' || summary.condition.tone==='snow' || summary.condition.tone==='storm';
  const chance=!minimal && wet && summary.precipitationChance!=null ? `${Math.round(summary.precipitationChance)}%` : '';
  const detail=[
    presentation.label,
    temp ? `feels like ${temp} Celsius` : '',
    summary.precipitationChance==null ? '' : `${Math.round(summary.precipitationChance)}% precipitation`,
    summary.wind==null ? '' : `${Math.round(summary.wind)} km/h wind`,
    weatherFreshnessText(summary.fetchedAt)
  ].filter(Boolean).join(', ');
  const tone=presentation.tone || presentation.status;
  const cls=options.className ? ` ${options.className}` : '';
  return `<span class="weather-day-cue${cls} ${escapeHtml(presentation.status)} weather-tone-${escapeHtml(tone)}" data-weather-tone="${escapeHtml(tone)}" title="${escapeHtml(detail)}"><span class="weather-condition-emoji" aria-hidden="true">${escapeHtml(presentation.emoji || '☁️')}</span>${chance?`<span class="weather-signal"><i class="ti ti-droplet" aria-hidden="true"></i>${escapeHtml(chance)}</span>`:''}${temp?`<span class="weather-temperature">${escapeHtml(temp)}</span>`:''}</span>`;
}

function weatherFreshnessText(ts,now=Date.now()){
  const mins=Math.max(0,Math.round((now-Number(ts || 0))/60000));
  if(mins<1)return 'updated just now';
  if(mins<60)return `updated ${mins}m ago`;
  return `updated ${Math.round(mins/60)}h ago`;
}

function weatherMetricCard(icon,label,value){
  if(value==null || value==='')return '';
  return `<div class="weather-context-metric"><i class="ti ${icon}" aria-hidden="true"></i><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function weatherContextSheetModel(dayBase,dayContext=null,focusHid=''){
  const settings=typeof sortSettings!=='undefined' && sortSettings ? sortSettings : loadSortSettings();
  const summary=weatherDaySummary(settings?._weatherContext,dayBase,settings);
  if(!summary)return null;
  return {summary,items:weatherGuidedItemsForDay(dayBase,dayContext,settings),focusHid:String(focusHid || '')};
}

function weatherContextItemHtml(item,focusHid){
  const status=item.assessment.status || 'unknown';
  const start=new Date(Number(item.row.start)).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const end=new Date(Number(item.row.end)).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const focused=focusHid && item.h.hid===focusHid ? ' focused' : '';
  return `<div class="weather-context-item ${escapeHtml(status)}${focused}"${item.h.hid?` data-weather-context-hid="${escapeHtml(item.h.hid)}"`:''}>
    <span class="weather-context-item-icon"><i class="ti ${weatherConditionIcon(status)}" aria-hidden="true"></i></span>
    <div><b>${escapeHtml(item.h.name || 'item')}</b><small>${escapeHtml(`${start}–${end} · ${item.locationName} · ${item.assessment.profile?.name || 'weather guided'}`)}</small><p>${escapeHtml(item.assessment.summary || 'forecast guidance')}</p></div>
  </div>`;
}

function renderWeatherContextSheet(model){
  if(!model)return false;
  const {summary,items,focusHid}=model;
  const date=new Date(summary.dayBase).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  const title=document.getElementById('weather-context-title');
  const sub=document.getElementById('weather-context-sub');
  const eyebrow=document.getElementById('weather-context-eyebrow');
  const icon=document.getElementById('weather-context-icon');
  const content=document.getElementById('weather-context-content');
  if(title)title.textContent=summary.condition.label;
  if(sub)sub.textContent=`${date} · ${summary.cityName} · ${weatherFreshnessText(summary.fetchedAt)}`;
  if(eyebrow)eyebrow.textContent='forecast context';
  if(icon)icon.innerHTML=`<span class="weather-condition-emoji" aria-hidden="true">${escapeHtml(summary.condition.emoji || '☁️')}</span>`;
  if(content){
    const range=weatherTemperatureRange(summary);
    const precipitation=[
      summary.precipitationChance==null?'':`${Math.round(summary.precipitationChance)}%`,
      summary.precipitation==null?'':`${Math.round(summary.precipitation*10)/10} mm`
    ].filter(Boolean).join(' · ');
    const wind=[
      summary.wind==null?'':`${Math.round(summary.wind)} km/h`,
      summary.gusts==null?'':`gusts ${Math.round(summary.gusts)}`
    ].filter(Boolean).join(' · ');
    const metrics=[
      weatherMetricCard('ti-temperature', 'feels like', range ? `${range}C` : ''),
      weatherMetricCard('ti-umbrella', 'precipitation', precipitation),
      weatherMetricCard('ti-wind', 'wind', wind),
      weatherMetricCard('ti-sun-high', 'UV', summary.uv==null?'':String(Math.round(summary.uv)))
    ].filter(Boolean).join('');
    const itemHtml=items.map(item=>weatherContextItemHtml(item,focusHid)).join('');
    content.innerHTML=`<div class="weather-context-metrics">${metrics}</div>
      ${itemHtml?`<section class="weather-context-items"><p class="overview-section-title">weather-guided plan</p>${itemHtml}</section>`:'<p class="weather-context-empty">No weather-guided items are scheduled on this day.</p>'}`;
  }
  return true;
}

function openWeatherContextSheet(dayBase,dayContext=null,focusHid=''){
  const model=weatherContextSheetModel(dayBase,dayContext,focusHid);
  if(!renderWeatherContextSheet(model))return false;
  if(typeof openSheet==='function')openSheet('weather-context-sheet');
  if(typeof armSheetBackdropGuard==='function')armSheetBackdropGuard('weather-context-sheet');
  if(focusHid)requestAnimationFrame(()=>document.querySelector(`#weather-context-content [data-weather-context-hid="${CSS.escape(focusHid)}"]`)?.scrollIntoView({block:'nearest'}));
  return true;
}

if(typeof document!=='undefined')document.addEventListener('click',event=>{
  const opener=event.target.closest('[data-open-weather-context]');
  if(opener){
    event.preventDefault();
    event.stopPropagation();
    openWeatherContextSheet(opener.dataset.openWeatherContext,null,opener.dataset.weatherHid || '');
    return;
  }
  if(event.target.closest('#weather-context-close,#weather-context-done')){
    if(typeof closeSheet==='function')closeSheet('weather-context-sheet');
    return;
  }
  if(event.target.closest('#weather-context-settings')){
    if(typeof closeSheet==='function')closeSheet('weather-context-sheet');
    if(document.getElementById('day-logs-sheet')?.classList.contains('open') && typeof closeSheet==='function')closeSheet('day-logs-sheet');
    if(typeof openSheet==='function')openSheet('settings-sheet');
    if(typeof syncSettingsControls==='function')syncSettingsControls();
    const head=document.getElementById('settings-weather-head');
    if(head && head.getAttribute('aria-expanded')!=='true')head.click();
    return;
  }
  const wrap=event.target.closest('#weather-context-sheet');
  if(wrap && event.target===wrap){
    if(typeof sheetBackdropArmed==='function' && sheetBackdropArmed('weather-context-sheet'))return;
    if(typeof closeSheet==='function')closeSheet('weather-context-sheet');
  }
});

function weatherProfileNeedsAir(profile){
  return Boolean(profile && profile.rules && profile.rules.some(rule=>weatherRuleActive(rule) && WEATHER_METRICS[rule.metric]?.air));
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
  const addLocation=id=>{
    if(out.length>=MAX_WEATHER_EXTRA_PLACES)return;
    const coords=weatherCoordsForLocation(id,settings);
    if(!coords || !coords.locationId || seen.has(coords.locationId))return;
    seen.add(coords.locationId);
    out.push(coords);
  };
  const list=Array.isArray(data) ? data : [];
  for(const h of list){
    if(!h || !h.weatherProfileId)continue;
    addLocation(h.weatherLocationId);
  }
  if(weatherAmbientEnabled(settings,list)){
    for(const row of weatherAgendaRows()){
      if(out.length>=MAX_WEATHER_EXTRA_PLACES)break;
      if(row.kind==='fill' || row.kind==='scheduled'){
        const h=row.h || (row.i!=null ? list[row.i] : null);
        if(weatherItemShowsAmbient(h))addLocation(weatherDisplayLocationId(h,row));
      }else if(row.kind==='blocked' && settings.showWeatherOnBusyTimes){
        addLocation(row.locationId);
      }else if(row.kind==='travel' && settings.showWeatherOnTravel){
        addLocation(row.to);
      }
    }
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

// Settings-screen transparency: expose exactly what the planner sees — the
// merged home-city samples (hourly 7-day forecast + near-term 15-minute
// detail), how old each source is, and where the detail horizon ends — so a
// forecast dispute can be checked against another weather app before
// debugging the planner itself.
function weatherInspectorModel(settings,now = Date.now()){
  const home = weatherHomeCoords(settings);
  if(!home)return {error:'no-home'};
  const cache = weatherCacheRead();
  const stored = weatherSameCoords(cache.weekly,home.lat,home.lng) ? cache.weekly : null;
  // The planner gates its context on profiles existing; the inspector shows
  // the stored home forecast regardless, so it stays truthful about what is
  // cached even before (or after) a profile is attached.
  const context = weatherContextFromBucket(cache,home.lat,home.lng,now);
  if(!context || !Array.isArray(context.samples) || !context.samples.length){
    return {error:stored ? 'stale' : 'empty',lastFetchedAt:stored ? Number(stored.fetchedAt) : 0};
  }
  const nearUntil = (context.samples || []).reduce((max,sample)=>sample.source === 'near' ? Math.max(max,Number(sample.ts) || 0) : max,0);
  const rows = (context.samples || [])
    .filter(sample=>Number(sample.ts) >= now - 60 * 60 * 1000 && Number(sample.ts) <= now + 24 * 60 * 60 * 1000)
    // Inside the near-term horizon the planner reads 15-minute rows, so the
    // display mirrors that instead of showing the superseded hourly value.
    .filter(sample=>!(nearUntil && sample.source === 'weekly' && Number(sample.ts) <= nearUntil))
    .sort((a,b)=>a.ts-b.ts)
    .map(sample=>{
      const values = {};
      for(const metric of Object.keys(WEATHER_METRICS)){
        const value = Number(sample[metric]);
        if(Number.isFinite(value))values[metric] = value;
      }
      return {ts:Number(sample.ts),source:sample.source === 'near' ? 'near' : 'hourly',values};
    });
  if(!rows.length)return {error:'window'};
  return {
    error:null,
    timezone:context.timezone || '',
    cityName:typeof settings.homeCityName === 'string' ? settings.homeCityName.trim() : '',
    weeklyFetchedAt:context.weeklyFetchedAt || 0,
    nearFetchedAt:context.nearFetchedAt || 0,
    airFetchedAt:context.airFetchedAt || 0,
    nearUntil,
    rows
  };
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
  if((!profiles.length && !weatherAmbientEnabled(settings)) || !home)return false;
  _weatherRefreshPromise = (async()=>{
    const now = Date.now();
    const cache = weatherCacheRead();
    const data = typeof load === 'function' ? load() : [];
    const extras = weatherNeededExtraPlaces(settings,data);
    let changed = false;
    const common = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,uv_index,weather_code,is_day';
    const daily = 'weather_code,temperature_2m_min,temperature_2m_max,apparent_temperature_min,apparent_temperature_max,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max';
    const fetchWeekly = async(bucket,lat,lng)=>{
      const displayReady=Array.isArray(bucket.weekly?.days) && bucket.weekly.days.some(day=>Number.isFinite(Number(day?.weather_code)));
      if(force || !displayReady || !weatherSameCoords(bucket.weekly,lat,lng) || now-Number(bucket.weekly?.fetchedAt) >= WEATHER_WEEKLY_TTL_MS){
        const payload = await weatherFetchJson(weatherUrl(WEATHER_FORECAST_URL,lat,lng,{hourly:common,daily,forecast_days:7}));
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
