// Weather guidance is a shared placement score/filter used by Fast and GLPK.
// This test exercises that shared boundary without making network requests.
const { chromium, BASE } = require('./helpers/planner-test-helpers');

let pass=0,fail=0;
function assert(value,message){
  if(value){pass+=1;console.log('  ok: '+message);}
  else{fail+=1;console.error('  FAIL: '+message);}
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});

  await page.evaluate(()=>{
    saveSortSettings({...loadSortSettings(),weatherProfiles:[]});
    sortSettings=loadSortSettings();
    openSheet('settings-sheet');
    syncSettingsControls();
  });
  await page.locator('#settings-weather-head').click();
  assert(await page.locator('#settings-weather-body [data-setting-toggle^="showWeatherOn"]').count()===2,'weather settings expose busy-time and travel toggles; habits and tasks opt in per item');
  assert(await page.locator('#detail-show-weather').count()===1 && await page.locator('#ting-show-weather').count()===1,'habit and task weather display is a per-item toggle');
  await page.locator('#weather-profile-add').click();
  assert(await page.locator('.weather-profile-card').count()===1,'settings creates a named weather profile');
  assert(await page.locator('#ting-weather-profile option').count()===3,'new profile appears beside inherit and no-weather choices');
  assert(await page.locator('.weather-rule-hint').count()===1,'each rule shows its metric scale');
  assert(/chance/.test(await page.locator('.weather-rule-hint').first().textContent()),'the hint names the metric scale bands');
  await page.locator('[data-weather-rule-relative]').first().selectOption('none');
  assert(await page.locator('.weather-profile-card .weather-rule').count()===1,'choosing "no preference" keeps the rule so bounds can be set after');
  assert(!/inactive/.test(await page.locator('.weather-rule-hint').first().textContent()),'a bounds-only rule with no preference stays active');
  assert(/inactive/.test(await page.evaluate(()=>weatherRuleHintText({metric:'uv_index',min:null,max:null,relative:'none'}))),'a rule without bounds or preference says it is inactive');
  assert(/UV index/.test(await page.evaluate(()=>weatherRuleHintText({metric:'uv_index',min:null,max:null,relative:'none'}))),'the inactive note still shows the metric scale');

  // Transparency panel: seed a fake stored forecast (hourly + near-term) and
  // check the settings screen shows exactly the rows the planner scores.
  const inspect=await page.evaluate(()=>{
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now=Date.now();
    const at=ms=>now+ms;
    const hourly=[];const near=[];
    for(let h=0;h<=24;h+=1)hourly.push({ts:at(h*3600000),precipitation_probability:80,precipitation:1.2,temperature_2m:12,wind_speed_10m:9,uv_index:2,source:'weekly'});
    for(let m=0;m<=8;m+=1)near.push({ts:at(m*15*60000),precipitation_probability:20,temperature_2m:11,wind_speed_10m:9,uv_index:2,source:'near'});
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      weekly:{lat:52.52,lng:13.405,fetchedAt:now-3600000,timezone:tz,samples:hourly},
      near:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples:near}}));
    saveSortSettings({...loadSortSettings(),homeCityLat:52.52,homeCityLng:13.405,homeCityName:'Berlin'});
    sortSettings=loadSortSettings();
    const model=weatherInspectorModel(sortSettings,now);
    renderWeatherControls();
    return {
      error:model.error,
      firstNear:model.rows[0]?.source==='near' && model.rows[0]?.values?.precipitation_probability===20,
      noWeeklyInsideNear:!model.rows.some(row=>row.source==='hourly' && row.ts<=model.nearUntil),
      hasHourlyAfterNear:model.rows.some(row=>row.source==='hourly' && row.ts>model.nearUntil),
      spans24h:model.rows[model.rows.length-1].ts>=now+23*3600000,
      tableRows:document.querySelectorAll('#weather-forecast-data .weather-forecast-table tbody tr').length,
      headText:document.querySelector('#weather-forecast-data thead')?.textContent || '',
      metaText:document.querySelector('#weather-forecast-data .weather-forecast-meta')?.textContent || '',
      firstRowNear:Boolean(document.querySelector('#weather-forecast-data tbody tr.near'))
    };
  });
  assert(inspect.error===null,'the inspector reads a fresh merged forecast');
  assert(inspect.firstNear,'the inspector leads with the fresher near-term sample');
  assert(inspect.noWeeklyInsideNear,'hourly rows are hidden where 15-minute detail supersedes them');
  assert(inspect.hasHourlyAfterNear,'hourly rows continue beyond the near-term horizon');
  assert(inspect.spans24h,'the inspector covers the next 24 hours');
  assert(inspect.tableRows>=20,'the table renders one row per forecast step');
  assert(/rain chance/.test(inspect.headText),'the table columns name the rule metrics');
  assert(/Berlin/.test(inspect.metaText) && /15-min detail until/.test(inspect.metaText),'the meta line names the city and the detail horizon');
  assert(inspect.firstRowNear,'near-term rows are visually marked');

  const usedBy=await page.evaluate(()=>{
    const profileId=normalizeWeatherProfiles(loadSortSettings().weatherProfiles)[0].id;
    save(normalize([{name:'Walk',type:'task',target:null,dueDate:null,eventTime:null,flexibilityDays:1,
      durationMinutes:30,priority:3,weatherProfileId:profileId,logs:[],locationIds:[],anywhereAllowed:true,
      allowedWeekdays:[],allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],createdAt:Date.now()}]));
    renderWeatherControls();
    return document.querySelector('.weather-profile-used')?.textContent || '';
  });
  assert(/Walk/.test(usedBy),'each profile lists the items it is attached to');

  const inheritedUi=await page.evaluate(()=>{
    const profile=normalizeWeatherProfiles(loadSortSettings().weatherProfiles)[0];
    const settings={...loadSortSettings(),weatherProfiles:[profile],locations:[
      {id:'park',name:'Park',lat:52.52,lng:13.405,weatherProfileId:profile.id}
    ]};
    saveSortSettings(settings);sortSettings=loadSortSettings();
    save(normalize([
      {name:'Park run',type:'keepup',target:7,logs:[],locationIds:['park'],anywhereAllowed:false,weatherProfileMode:'inherit'},
      {name:'Route choice',type:'keepup',target:7,logs:[],locationIds:[],anywhereAllowed:false,scheduleOptions:[
        {id:'route_option',weekdays:[],start:540,end:600,locationId:'park',weatherProfileMode:'profile',weatherProfileId:profile.id}
      ]}
    ]));
    renderLocationControls();renderWeatherControls();
    openDetail(0);
    const itemHint=$('detail-weather-guidance-hint')?.textContent || '';
    openDetail(1);
    const optionValue=document.querySelector('.habit-option-weather')?.value || '';
    const optionHint=document.querySelector('.habit-option-weather-hint')?.textContent || '';
    const usage=document.querySelector('.weather-profile-used')?.textContent || '';
    const locationValue=document.querySelector('[data-loc-weather="0"]')?.value || '';
    const before=normalizeWeatherProfiles(loadSortSettings().weatherProfiles).length;
    document.querySelector('[data-weather-profile-remove]')?.click();
    const after=normalizeWeatherProfiles(loadSortSettings().weatherProfiles).length;
    closeSheet('detail-sheet');
    return {itemHint,optionValue,optionHint,usage,locationValue,before,after};
  });
  assert(/Park.*Outdoor/.test(inheritedUi.itemHint),'item editor gently names the inherited place profile');
  assert(inheritedUi.optionValue && /Outdoor/.test(inheritedUi.optionHint),'specific option editor saves and explains its explicit weather profile');
  assert(/Park.*place/.test(inheritedUi.usage) && /Route choice.*option 1/.test(inheritedUi.usage),'profile usage includes locations and specific options');
  assert(inheritedUi.locationValue===inheritedUi.optionValue,'location editor persists a named weather profile');
  assert(inheritedUi.before===inheritedUi.after,'profile deletion is blocked while locations or options use it');

  const states=await page.evaluate(()=>{
    save([]);
    localStorage.removeItem(WEATHER_CACHE_KEY);
    renderWeatherControls();
    const empty=document.querySelector('#weather-forecast-data')?.textContent || '';
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({weekly:{lat:52.52,lng:13.405,
      fetchedAt:Date.now()-9*3600000,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples:[]}}));
    renderWeatherControls();
    const stale=document.querySelector('#weather-forecast-data')?.textContent || '';
    localStorage.removeItem(WEATHER_CACHE_KEY);
    saveSortSettings({...loadSortSettings(),homeCityName:'',homeCityLat:null,homeCityLng:null});
    sortSettings=loadSortSettings();
    renderWeatherControls();
    return {empty,stale};
  });
  assert(/No forecast stored yet/.test(states.empty),'a missing forecast says so instead of rendering an empty table');
  assert(/too old/.test(states.stale),'a stale forecast is labelled instead of silently unused');
  await page.evaluate(()=>closeSheet('settings-sheet'));

  const result=await page.evaluate(()=>{
    const base=new Date();base.setHours(0,0,0,0);
    const at=hour=>base.getTime()+hour*3600000;
    const profiles=[{id:'outdoor',name:'Outdoor',rules:[{
      metric:'precipitation_probability',min:null,max:40,hard:false,relative:'low'
    }]}];
    const context={profiles,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples:[
      {ts:at(9),precipitation_probability:90,source:'weekly'},
      {ts:at(10),precipitation_probability:80,source:'weekly'},
      {ts:at(15),precipitation_probability:10,source:'weekly'},
      {ts:at(16),precipitation_probability:15,source:'weekly'}
    ],locks:[]};
    const settings={...DEFAULT_SORT_SETTINGS,weatherProfiles:profiles,_weatherContext:context};
    const h={hid:'walk',name:'Walk',type:'keepup',target:7,priority:3,durationMinutes:30,weatherProfileId:'outdoor'};
    const fill={h,i:0,priority:3,eligible:new Set([base.getTime(),base.getTime()+86400000])};
    const state={dayBase:base.getTime(),settings,fills:[],registry:[]};
    const fit=hour=>({placeStart:at(hour),placeEnd:at(hour)+1800000,edge:{seconds:0}});
    const chosen=pickBestScoredFit([fit(9),fit(15)],fill,state,{settings});

    const hardProfiles=[{...profiles[0],rules:[{...profiles[0].rules[0],hard:true,relative:'none'}]}];
    const hardSettings={...settings,weatherProfiles:hardProfiles,_weatherContext:{...context,profiles:hardProfiles}};
    const blocked=pickBestScoredFit([fit(9)],fill,{...state,settings:hardSettings},{settings:hardSettings});
    const pinned=pickBestScoredFit([fit(9)],{...fill,pinned:true},{...state,settings:hardSettings},{settings:hardSettings});
    const missingSettings={...settings,_weatherContext:null};
    const missing=pickBestScoredFit([fit(9)],fill,{...state,settings:missingSettings},{settings:missingSettings});

    const nearContext={...context,samples:[
      {ts:at(9),precipitation_probability:90,source:'weekly'},
      {ts:at(9)+15*60000,precipitation_probability:5,source:'near'}
    ]};
    const nearRows=weatherSamplesForInterval(nearContext,at(9),at(10));
    const inertProfile={id:'inert',name:'Inert',rules:[{metric:'uv_index',min:null,max:null,hard:false,relative:'none'}]};
    const inertSettings={...settings,weatherProfiles:[inertProfile],_weatherContext:{...context,profiles:[inertProfile]}};
    const inertAssessment=weatherFitAssessment({h:{hid:'inert-h',weatherProfileId:'inert'},i:0,priority:3},
      {placeStart:at(9),placeEnd:at(10)},{dayBase:base.getTime(),settings:inertSettings,fills:[],registry:[]},inertSettings);
    const keptInert=normalizeWeatherProfiles([{...inertProfile}]);
    return {
      softHour:new Date(chosen.placeStart).getHours(),
      blocked:blocked===null,
      pinnedStatus:pinned?.weather?.status,
      missing:Boolean(missing),
      nearOnly:nearRows.length===1 && nearRows[0].source==='near',
      normalized:normalizeWeatherProfiles([...profiles,...profiles,...profiles,...profiles,...profiles]).length,
      keptNoPrefRule:keptInert.length===1 && keptInert[0].rules.length===1,
      inertIgnored:inertAssessment===null
    };
  });

  assert(result.softHour===15,'soft profile prefers the dry interval over ASAP');
  assert(result.blocked,'hard rule removes a flexible unsafe fit');
  assert(result.pinnedStatus==='override','pinned commitment survives a hard weather rule');
  assert(result.missing,'missing forecast fails open');
  assert(result.nearOnly,'near-term samples replace weekly samples in overlap');
  assert(result.normalized===4,'weather profiles are capped at four');
  assert(result.keptNoPrefRule,'a no-preference rule without bounds survives normalization');
  assert(result.inertIgnored,'a rule with no bounds and no preference does not steer or block');

  const resolution=await page.evaluate(()=>{
    const profiles=['outdoor','item','option'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),rules:[{
      metric:'precipitation_probability',min:null,max:40,hard:true,relative:'none'
    }]}));
    const settings={...DEFAULT_SORT_SETTINGS,weatherProfiles:profiles,locations:[
      {id:'park',name:'Park',lat:40,lng:-74,weatherProfileId:'outdoor'},
      {id:'gym',name:'Gym',lat:40.2,lng:-74.2},
      {id:'boston',name:'Boston',lat:42.36,lng:-71.06}
    ]};
    const inherited={hid:'inherit',weatherProfileMode:'inherit',weatherProfileId:null,locationIds:['park']};
    const explicit={hid:'explicit',weatherProfileMode:'profile',weatherProfileId:'item',weatherLocationId:'boston'};
    const disabled={hid:'disabled',weatherProfileMode:'none',weatherProfileId:null};
    const optionBase={...disabled,scheduleOptions:[
      {id:'option1',weekdays:[],start:540,end:600,locationId:'park',weatherProfileMode:'profile',weatherProfileId:'option'},
      {id:'option2',weekdays:[],start:600,end:660,locationId:'park',weatherProfileMode:'inherit',weatherProfileId:null}
    ]};
    const optionOff={...explicit,scheduleOptions:[
      {id:'option3',weekdays:[],start:660,end:720,locationId:'park',weatherProfileMode:'none',weatherProfileId:null}
    ]};
    const legacy=normalize([{name:'Legacy',type:'keepup',target:7,weatherProfileId:'item',logs:[]}])[0];
    const legacyBlank=normalize([{name:'Legacy blank',type:'keepup',target:7,logs:[]}])[0];
    const loc=effectiveWeatherGuidance(inherited,'park',settings);
    const itemAtPlace=effectiveWeatherGuidance(explicit,'park',settings);
    const itemAnywhere=effectiveWeatherGuidance(explicit,null,settings);
    const none=effectiveWeatherGuidance(disabled,'park',settings);
    const option=effectiveWeatherGuidance(optionBase,'park',settings,{scheduleOptionId:'option1'});
    const inheritedNone=effectiveWeatherGuidance(optionBase,'park',settings,{scheduleOptionId:'option2'});
    const optionDisabled=effectiveWeatherGuidance(optionOff,'park',settings,{scheduleOptionId:'option3'});
    const dangling=effectiveWeatherGuidance({weatherProfileMode:'profile',weatherProfileId:'missing'},'park',settings);
    return {
      loc:[loc.profileId,loc.source,loc.forecastLocationId,loc.inherited],
      itemAtPlace:[itemAtPlace.profileId,itemAtPlace.source,itemAtPlace.forecastLocationId],
      itemAnywhere:itemAnywhere.forecastLocationId,
      none:[none.profileId,none.source,none.disabled],
      option:[option.profileId,option.source,option.disabled],
      inheritedNone:[inheritedNone.profileId,inheritedNone.source,inheritedNone.disabled],
      optionDisabled:[optionDisabled.profileId,optionDisabled.source,optionDisabled.disabled],
      dangling:[dangling.profile,dangling.source,dangling.profileId],
      legacy:[legacy.weatherProfileMode,legacy.weatherProfileId],
      legacyBlank:[legacyBlank.weatherProfileMode,legacyBlank.weatherProfileId]
    };
  });
  assert(JSON.stringify(resolution.loc)===JSON.stringify(['outdoor','location','park',true]),'location profile is inherited with its scheduled-place forecast');
  assert(JSON.stringify(resolution.itemAtPlace)===JSON.stringify(['item','item','park']),'item profile overrides location but still uses the scheduled place');
  assert(resolution.itemAnywhere==='boston','anywhere item uses its explicit fallback forecast place');
  assert(resolution.none[0]===null && resolution.none[1]==='item' && resolution.none[2],'item no-weather blocks location inheritance');
  assert(JSON.stringify(resolution.option)===JSON.stringify(['option','option',false]),'specific option profile overrides item no-weather');
  assert(resolution.inheritedNone[0]===null && resolution.inheritedNone[1]==='item' && resolution.inheritedNone[2],'inheriting option respects item no-weather');
  assert(resolution.optionDisabled[0]===null && resolution.optionDisabled[1]==='option' && resolution.optionDisabled[2],'specific option no-weather overrides item profile');
  assert(resolution.dangling[0]===null && resolution.dangling[1]==='item' && resolution.dangling[2]==='missing','dangling explicit profile fails open without silently inheriting location');
  assert(JSON.stringify(resolution.legacy)===JSON.stringify(['profile','item']),'legacy item profile migrates to explicit profile mode');
  assert(JSON.stringify(resolution.legacyBlank)===JSON.stringify(['inherit',null]),'legacy item without profile migrates to inherit mode');

  const weekChoice=await page.evaluate(async()=>{
    const RealDate=Date;
    const now=new RealDate();now.setHours(8,0,0,0);
    function FrozenDate(...args){return args.length?new RealDate(...args):new RealDate(now.getTime());}
    FrozenDate.now=()=>now.getTime();FrozenDate.parse=RealDate.parse;FrozenDate.UTC=RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);FrozenDate.prototype=RealDate.prototype;
    globalThis.Date=FrozenDate;
    try{
      const day0=new RealDate(now);day0.setHours(0,0,0,0);
      const day1=day0.getTime()+86400000;
      const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:false,relative:'none'}]};
      const samples=[];
      for(let hour=9;hour<=17;hour+=1){
        samples.push({ts:day0.getTime()+hour*3600000,precipitation_probability:90,source:'weekly'});
        samples.push({ts:day1+hour*3600000,precipitation_probability:10,source:'weekly'});
      }
      const settings={...DEFAULT_SORT_SETTINGS,preset:'todayFirst',showWeekOnHome:true,
        agendaOptimizer:true,availabilityMinutes:[480,480,480,480,480,480,480],
        blockedTimes:[{label:'night',days:[],start:0,end:540},{label:'night',days:[],start:1080,end:1440}],
        weatherProfiles:[profile],_weatherContext:{profiles:[profile],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples,locks:[]}};
      const data=normalize([{name:'Walk',type:'task',target:null,dueDate:day1,eventTime:null,
        flexibilityDays:2,durationMinutes:30,priority:3,weatherProfileId:'outdoor',logs:[],
        locationIds:[],anywhereAllowed:true,allowedWeekdays:[],allowedMonthDays:[],
        preferredWeekdays:[],preferredMonthDays:[],createdAt:now.getTime()-86400000}]);
      const offset=week=>{
        for(let i=0;i<(week.days||[]).length;i+=1){
          if((week.days[i].timeline||[]).some(row=>row.kind==='fill' && row.h?.name==='Walk'))return i;
        }
        return -1;
      };
      const fast=offset(buildWeekAgenda(data,{...settings,agendaOptimizer:false},3));
      let glpk=-2;
      try{glpk=offset(await buildWeekAgendaAsync(data,settings,3));}catch(_){glpk=-2;}
      return {fast,glpk};
    }finally{globalThis.Date=RealDate;}
  });
  assert(weekChoice.fast===1,'Fast uses the weekly forecast to choose the drier day');
  assert(weekChoice.glpk===1 || weekChoice.glpk===-2,'GLPK uses the weekly forecast to choose the drier day (or is unavailable)');

  const locationChoice=await page.evaluate(async()=>{
    const RealDate=Date;
    const now=new RealDate();now.setHours(8,0,0,0);
    function FrozenDate(...args){return args.length?new RealDate(...args):new RealDate(now.getTime());}
    FrozenDate.now=()=>now.getTime();FrozenDate.parse=RealDate.parse;FrozenDate.UTC=RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);FrozenDate.prototype=RealDate.prototype;
    globalThis.Date=FrozenDate;
    try{
      const base=dayStart(now.getTime());
      const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:true,relative:'none'}]};
      const indoor={id:'indoor',name:'Indoor',rules:[{metric:'precipitation_probability',min:null,max:100,hard:true,relative:'none'}]};
      const wet=[9,10].map(hour=>({ts:base+hour*3600000,precipitation_probability:95,source:'weekly'}));
      const locations=[
        {id:'park',name:'Park',lat:42.36,lng:-71.06,weatherProfileId:'outdoor'},
        {id:'gym',name:'Gym',lat:40.72,lng:-74.01,weatherProfileId:'indoor'}
      ];
      const settings={...DEFAULT_SORT_SETTINGS,agendaOptimizer:true,showDueTasksInAgenda:true,
        availabilityMinutes:[480,480,480,480,480,480,480],
        blockedTimes:[{label:'night',days:[],start:0,end:540},{label:'night',days:[],start:1080,end:1440}],
        homeCityLat:40.71,homeCityLng:-74,locations,weatherProfiles:[profile,indoor],
        _weatherContext:{profiles:[profile,indoor],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples:[],places:{
          park:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples:wet,weeklyFetchedAt:now.getTime()},
          gym:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,samples:wet,weeklyFetchedAt:now.getTime()}
        },locks:[]}};
      const data=normalize([{name:'Exercise',type:'keepup',target:7,earlyWindowDays:0,delayAllowanceDays:0,
        durationMinutes:30,priority:3,logs:[],locationIds:[],anywhereAllowed:false,createdAt:base-86400000,
        scheduleOptions:[
          {id:'park_option',weekdays:[],start:540,end:600,locationId:'park',weatherProfileMode:'inherit'},
          {id:'gym_option',weekdays:[],start:540,end:600,locationId:'gym',weatherProfileMode:'inherit'}
        ]}]);
      const chosen=week=>(week.days?.[0]?.timeline || []).find(row=>row.kind==='fill' && row.h?.name==='Exercise') || null;
      const fastRow=chosen(buildWeekAgenda(data,{...settings,agendaOptimizer:false},1));
      let glpk='unavailable';
      try{glpk=chosen(await buildWeekAgendaAsync(data,settings,1)) || null;}catch(_){glpk='unavailable';}
      return {
        fast:fastRow?.locationId || null,
        fastWeather:[fastRow?.weatherProfileId,fastRow?.weatherProfileSource,fastRow?.weatherForecastLocationId],
        glpk:glpk==='unavailable'?glpk:(glpk?.locationId || null),
        glpkWeather:glpk==='unavailable'?null:[glpk?.weatherProfileId,glpk?.weatherProfileSource,glpk?.weatherForecastLocationId]
      };
    }finally{globalThis.Date=RealDate;}
  });
  assert(locationChoice.fast==='gym','Fast rejects the wet Outdoor Park option and chooses the weather-compatible Indoor Gym option');
  assert(locationChoice.glpk==='gym' || locationChoice.glpk==='unavailable','GLPK rejects the wet Outdoor Park option and chooses Indoor Gym (or is unavailable)');
  assert(JSON.stringify(locationChoice.fastWeather)===JSON.stringify(['indoor','location','gym']),'Fast stores the effective location profile and forecast place on its planned row');
  assert(locationChoice.glpk==='unavailable' || JSON.stringify(locationChoice.glpkWeather)===JSON.stringify(['indoor','location','gym']),'GLPK stores the effective location profile and forecast place on its planned row');

  const extra=await page.evaluate(()=>{
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now=new Date();now.setHours(10,0,0,0);
    const at=hour=>{const d=new Date(now);d.setHours(hour,0,0,0);return d.getTime();};
    const drySamples=[];
    for(let hour=10;hour<=21;hour+=1){
      drySamples.push({ts:at(hour),precipitation_probability:0,precipitation:0,snowfall:0,source:'weekly'});
    }
    const wetSamples=drySamples.map(sample=>({...sample,precipitation_probability:30}));
    const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:false,relative:'none'}]};
    const settings={...DEFAULT_SORT_SETTINGS,homeCityLat:40.7128,homeCityLng:-74.0060,homeCityName:'NYC',
      weatherProfiles:[profile],
      locations:[
        {id:'park',name:'Park',lat:40.72,lng:-74.01,radiusM:75},
        {id:'boston',name:'Boston',lat:42.3601,lng:-71.0589,radiusM:75}
      ]};
    const parkCoords=weatherCoordsForHabit({weatherProfileId:'outdoor',weatherLocationId:'park'},settings);
    const bostonCoords=weatherCoordsForHabit({weatherProfileId:'outdoor',weatherLocationId:'boston'},settings);
    const bostonSamples=[
      {ts:at(10),precipitation_probability:10,source:'weekly'},
      {ts:at(15),precipitation_probability:90,source:'weekly'}
    ];
    const context={
      profiles:[profile],timezone:tz,
      samples:drySamples.map(sample=>({...sample,precipitation_probability:90})),
      places:{boston:{timezone:tz,samples:bostonSamples}}
    };
    const h={hid:'trip',name:'Trip walk',type:'keepup',target:7,priority:3,durationMinutes:30,
      weatherProfileId:'outdoor',weatherLocationId:'boston'};
    const fill={h,i:0,priority:3};
    const packSettings={...settings,_weatherContext:context};
    const state={dayBase:at(0),settings:packSettings,fills:[],registry:[]};
    const fit=hour=>({placeStart:at(hour),placeEnd:at(hour)+1800000,edge:{seconds:0}});
    const chosen=pickBestScoredFit([fit(10),fit(15)],fill,state,{settings:packSettings});
    const row={i:0,start:now.getTime()+90*60000,end:now.getTime()+120*60000};
    const data=[{weatherProfileId:'outdoor'}];
    const skipNear=!weatherNearRefreshNeeded([row],data,{...settings,_weatherContext:{profiles:[profile]}},
      {samples:drySamples,timezone:tz,profiles:[profile]},now.getTime());
    const needNear=weatherNearRefreshNeeded([row],data,{...settings,_weatherContext:{profiles:[profile]}},
      {samples:wetSamples,timezone:tz,profiles:[profile]},now.getTime());
    const extras=weatherNeededExtraPlaces(settings,[
      {weatherProfileId:'outdoor',weatherLocationId:'boston'},
      {weatherProfileId:'outdoor',weatherLocationId:'park'}
    ]);
    const previousRenderedWeek=_homeRenderedWeek;
    _homeRenderedWeek={days:[{timeline:[],homeDisplayedTimeline:[{kind:'travel',from:'park',to:'boston',start:at(10),end:at(11)}]}]};
    const ambientTravelExtras=weatherNeededExtraPlaces({...settings,minimalMode:false,weatherProfiles:[],showWeatherOnTravel:true},[]);
    _homeRenderedWeek=previousRenderedWeek;
    const kept=normalize([{name:'Trip',type:'task',weatherProfileId:'outdoor',weatherLocationId:'boston',
      logs:[],locationIds:[],anywhereAllowed:true}]);
    saveSortSettings({...loadSortSettings(),locations:settings.locations,weatherProfiles:loadSortSettings().weatherProfiles});
    sortSettings=loadSortSettings();
    const profileId=[...($('ting-weather-profile')?.options || [])]
      .find(option=>option.value && option.value!=='__none__')?.value || '';
    if($('ting-weather-profile'))$('ting-weather-profile').value=profileId;
    if(typeof renderWeatherLocationSelect==='function')renderWeatherLocationSelect('ting-weather-location','');
    if(typeof syncWeatherHabitLocationUi==='function')syncWeatherHabitLocationUi();
    return {
      parkUsesHome:!parkCoords.locationId,
      bostonFar:bostonCoords.locationId==='boston',
      chosenHour:new Date(chosen.placeStart).getHours(),
      skipNear,
      needNear,
      extraIds:extras.map(place=>place.locationId).join(','),
      ambientTravelIds:ambientTravelExtras.map(place=>place.locationId).join(','),
      keptLocation:kept[0].weatherLocationId,
      placeSelectShown:Boolean(profileId) && !$('ting-weather-location-wrap')?.hidden,
      placeOptions:$('ting-weather-location')?.options.length || 0
    };
  });
  assert(extra.parkUsesHome,'nearby saved places reuse the home-city forecast');
  assert(extra.bostonFar,'a far saved place keeps its own forecast coordinate');
  assert(extra.chosenHour===10,'far-place forecast steers the item off the wet local hour');
  assert(extra.skipNear,'0% remaining-day rain skips the 15-minute refresh');
  assert(extra.needNear,'borderline rain still requests a near-term refresh');
  assert(extra.extraIds==='boston','only far weather overrides fetch an extra forecast');
  assert(extra.ambientTravelIds==='boston','a visible far-away travel leg fetches only its destination forecast');
  assert(extra.keptLocation==='boston','normalize keeps a forecast-place override');
  assert(extra.placeSelectShown,'forecast place appears after a profile is chosen');
  assert(extra.placeOptions>=3,'home city plus saved places fill the forecast place list');

  const display=await page.evaluate(()=>{
    const now=Date.now();
    const base=dayStart(now);
    const key=dateKey(base);
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',min:null,max:40,hard:false,relative:'none'}]};
    const homeSamples=[9,10,11].map(hour=>({ts:base+hour*3600000,temperature_2m:12+hour-9,
      apparent_temperature:10+hour-9,
      precipitation_probability:80,precipitation:.4,wind_speed_10m:18,wind_gusts_10m:29,
      weather_code:61,source:'weekly'}));
    const days=[{ts:base,weather_code:61,temperature_2m_min:7,temperature_2m_max:14,
      apparent_temperature_min:5,apparent_temperature_max:13,precipitation_probability_max:80,
      precipitation_sum:3.2,wind_speed_10m_max:18,wind_gusts_10m_max:29,uv_index_max:2}];
    const context={profiles:[profile],timezone:tz,samples:homeSamples,days,weeklyFetchedAt:now-600000,places:{
      boston:{timezone:tz,weeklyFetchedAt:now-600000,samples:homeSamples.map(row=>({...row,precipitation_probability:95})),days}
    },locks:[]};
    const h={hid:'walk',name:'Park walk',type:'keepup',target:7,priority:3,durationMinutes:30,
      weatherProfileId:'outdoor',weatherLocationId:'boston',locationIds:['boston'],
      showWeather:true,showWeatherAtLocation:true,pinned:false};
    const row={kind:'fill',i:0,h,start:base+9*3600000,end:base+9.5*3600000,locationId:'boston'};
    const day={dayBase:base,dayKey:key,isToday:true,timeline:[row],homeDisplayedTimeline:[row]};
    save([h]);
    let settings={...DEFAULT_SORT_SETTINGS,minimalMode:false,homeCityName:'New York',homeCityLat:40.71,homeCityLng:-74,
      locations:[{id:'boston',name:'Boston',lat:42.36,lng:-71.06}],weatherProfiles:[profile],
      showWeatherTemperatureRanges:false,_weatherContext:context};
    sortSettings=settings;

    const normalizedDefault=(()=>{
      const previous=loadSortSettings();
      delete previous.showWeatherTemperatureRanges;
      delete previous.showWeatherOnHabits;
      delete previous.showWeatherOnTasks;
      delete previous.showWeatherOnBusyTimes;
      delete previous.showWeatherOnTravel;
      Storage.write(SORT_SETTINGS_KEY,previous);
      const normalized=loadSortSettings();
      return {
        temperature:normalized.showWeatherTemperatureRanges,
        droppedHabits:'showWeatherOnHabits' in normalized,
        droppedTasks:'showWeatherOnTasks' in normalized,
        busy:normalized.showWeatherOnBusyTimes,travel:normalized.showWeatherOnTravel
      };
    })();
    sortSettings=settings;
    const noTemp=weatherDayCueHtml(base,day,settings,{data:[h]});
    const withTemp=weatherDayCueHtml(base,day,{...settings,showWeatherTemperatureRanges:true},{data:[h]});
    const stale=weatherDaySummary({...context,weeklyFetchedAt:now-9*3600000},base,settings);
    const past=weatherDaySummary(context,base-86400000,settings);
    const beyond=weatherDaySummary(context,base+8*86400000,settings);

    const host=document.createElement('div');
    document.body.appendChild(host);
    appendSectionHeader(host,'today',day);
    appendSectionHeader(host,'pinned');
    const dayHeaderWeather=host.querySelectorAll('.section-header[data-label="today"] .weather-day-button').length;
    const categoryWeather=host.querySelectorAll('.section-header[data-label="pinned"] .weather-day-button').length;
    const separated=Boolean(host.querySelector('.section-header-label + .day-header-context'));

    sortSettings={...settings,minimalMode:true};
    const minimalCaution=weatherDayCueHtml(base,day,sortSettings,{data:[h]});
    const goodContext={...context,samples:homeSamples.map(sample=>({...sample,precipitation_probability:10})),
      places:{boston:{...context.places.boston,samples:homeSamples.map(sample=>({...sample,precipitation_probability:10}))}}};
    const minimalGood=weatherDayCueHtml(base,{...day,timeline:[{...row,h}],homeDisplayedTimeline:[{...row,h}]},{...sortSettings,_weatherContext:goodContext},{data:[h]});

    sortSettings=settings;
    storeOverviewWeekSnapshot({days:[day]},[h]);
    const capacity={openTotal:120,days:[{key,open:120,used:30,total:150,load:1}],lightest:null,busiest:null,tomorrow:null};
    overviewRecentOffset=0;overviewRangeFilter='recent';
    renderOverviewInsight(capacity);
    const overviewCue=document.querySelector('#overview-insight .overview-weather-cue');
    const overviewChip=document.querySelector('#overview-insight .overview-open-chip');
    const compactHeavy=weatherDayCueHtml(base,day,{
      ...settings,_weatherContext:{...context,days:[{...days[0],weather_code:65}]}
    },{data:[h],compact:true,className:'overview-weather-cue'});
    const overviewMeasure=(()=>{
      if(!overviewChip || !overviewCue)return {fits:false,heavyFits:false,stacked:false};
      const measureHost=document.createElement('div');
      measureHost.style.cssText='position:absolute;left:-9999px;width:362px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;';
      const clone=overviewChip.cloneNode(true);
      const heavyChip=document.createElement('button');
      heavyChip.type='button';
      heavyChip.className='overview-open-chip open';
      heavyChip.innerHTML=compactHeavy;
      measureHost.appendChild(clone);
      measureHost.appendChild(heavyChip);
      document.body.appendChild(measureHost);
      const cue=clone.querySelector('.overview-weather-cue');
      const heavyCue=heavyChip.querySelector('.overview-weather-cue');
      const heavyEmoji=heavyChip.querySelector('.weather-condition-emoji');
      const measured={
        fits:clone.scrollWidth<=clone.clientWidth+1,
        heavyFits:Boolean(heavyCue && heavyEmoji) && heavyEmoji.scrollWidth<=heavyCue.clientWidth+1,
        stacked:getComputedStyle(cue).flexDirection==='column'
      };
      measureHost.remove();
      return measured;
    })();
    const overviewCompact={
      compact:Boolean(overviewCue?.classList.contains('is-compact')),
      chance:/80%/.test(overviewCue?.textContent || ''),
      titleChance:/80% precipitation/.test(overviewCue?.getAttribute('title') || ''),
      fits:overviewMeasure.fits,
      heavyFits:overviewMeasure.heavyFits,
      stacked:overviewMeasure.stacked
    };
    const overviewIcon=document.querySelectorAll('#overview-insight .overview-weather-cue').length;
    const tomorrowKey=dateKey(dayStart(Date.now())+86400000);
    const chipTomorrow={compact:overviewDayChipLabel(tomorrowKey,true),full:overviewDayChipLabel(tomorrowKey)};
    const overviewTempOff=/5–13°/.test(document.querySelector('#overview-insight')?.textContent || '');
    sortSettings={...settings,showWeatherTemperatureRanges:true};
    renderOverviewInsight(capacity);
    const overviewTempOn=/5–13°/.test(document.querySelector('#overview-insight')?.textContent || '');
    const calendarWeather=/weather-day-cue/.test(cellMarkup(key,new Date(base),[],'<span>1</span>'));
    overviewRecentOffset=-1;
    renderOverviewInsight(capacity);
    const shiftedHidden=document.querySelector('#overview-insight').hidden;
    overviewRecentOffset=0;

    sortSettings=settings;
    renderWeatherContextSheet(weatherContextSheetModel(base,day,'walk'));
    const sheetText=document.querySelector('#weather-context-sheet')?.textContent || '';
    const selectedBlock=overviewDayWeatherBlockHtml(key,day,[h]);

    sortSettings={...settings,showWeatherOnBusyTimes:true,showWeatherOnTravel:true};
    const habitPeriod=weatherCardPill(row,h);
    const homeHabit={...h,showWeatherAtLocation:false};
    const homePeriod=weatherCardPill({...row,h:homeHabit},homeHabit);
    const quietHabit={...h,showWeather:false};
    const quietPeriod=weatherCardPill({...row,h:quietHabit},quietHabit);
    const task={...h,hid:'errand',name:'Errand',type:'task',weatherProfileId:null,weatherLocationId:null,showWeather:true,showWeatherAtLocation:false};
    const taskPeriod=weatherCardPill({...row,h:task,locationId:null},task);
    const silentTask={...task,showWeather:false};
    const silentTaskPeriod=weatherCardPill({...row,h:silentTask},silentTask);
    const longRange=weatherPeriodPillHtml(base+9*3600000,base+12*3600000,settings,{});
    const shortRange=weatherPeriodPillHtml(base+9*3600000,base+9.5*3600000,settings,{});
    const periodHost=document.createElement('div');
    document.body.appendChild(periodHost);
    appendHomeBlockedCard(periodHost,{kind:'blocked',label:'sleep',start:row.start,end:row.end,locationId:null});
    appendHomeTravelCard(periodHost,'home','boston',row.start);
    const busyPeriod=periodHost.querySelector('.blocked-card .weather-period-pill')?.outerHTML || '';
    const travelPeriod=periodHost.querySelector('.travel-card .weather-period-pill')?.outerHTML || '';
    const travelInTitle=Boolean(periodHost.querySelector('.travel-card .timeline-card-title-row .weather-period-pill'));
    const busyInTitle=Boolean(periodHost.querySelector('.blocked-card .timeline-card-title-row .weather-period-pill'));
    const periodCardsFit=[...periodHost.querySelectorAll('.blocked-card,.travel-card')]
      .every(card=>card.scrollWidth<=card.clientWidth+1);
    const intensity=weatherCodePresentation(65);
    sortSettings={...sortSettings,minimalMode:true};
    const minimalAmbient=weatherCardPill({...row,h:task},task);
    periodHost.remove();
    host.remove();
    return {
      normalizedDefault,noTemp,withTemp,stale,past,beyond,dayHeaderWeather,categoryWeather,separated,
      minimalCaution,minimalGood,overviewIcon,overviewTempOff,overviewTempOn,calendarWeather,shiftedHidden,
      chipTomorrow,
      sheetText,selectedBlock,habitPeriod,homePeriod,quietPeriod,taskPeriod,silentTaskPeriod,longRange,shortRange,
      busyPeriod,travelPeriod,travelInTitle,busyInTitle,periodCardsFit,minimalAmbient,intensity,
      overviewCompact,compactHeavy,
      codeLabel:weatherCodePresentation(95).label,
      codeIcon:weatherCodePresentation(71).icon,
      codeEmoji:weatherCodePresentation(95).emoji
    };
  });
  assert(display.normalizedDefault.temperature===false && !display.normalizedDefault.droppedHabits && !display.normalizedDefault.droppedTasks && !display.normalizedDefault.busy && display.normalizedDefault.travel,'weather display settings normalize quiet by default, except travel, and drop the old global habit/task toggles');
  assert(!/weather-condition-text/.test(display.noTemp) && /🌦️/.test(display.noTemp) && /80%/.test(display.noTemp) && !/5–13°/.test(display.noTemp),'full day cue stays compact: emoji and wet chance, no long condition label or temperature');
  assert(/5–13°/.test(display.withTemp),'feels-like temperature range can be enabled for full-mode day cues');
  assert(display.stale===null && display.past===null && display.beyond===null,'stale, past, and beyond-horizon days have no forecast summary');
  assert(display.dayHeaderWeather===1 && display.categoryWeather===0,'home adds weather only to actual agenda-day headers');
  assert(display.separated,'home day headers keep label and context in separate layout groups');
  assert(/caution/.test(display.minimalCaution) && !/5–13°/.test(display.minimalCaution),'minimal mode shows an item-derived caution without temperature');
  assert(display.minimalGood==='','minimal mode hides good weather guidance');
  assert(display.overviewIcon===1 && !display.overviewTempOff && display.overviewTempOn,'overview week chips share the compact visual cue and optional range setting');
  assert(display.overviewCompact.compact && !display.overviewCompact.chance && display.overviewCompact.titleChance && display.overviewCompact.stacked && display.overviewCompact.fits,'overview chips stay emoji-only so open minutes is the only number; the wet chance lives in the tooltip');
  assert(display.chipTomorrow.compact==='tmrw' && display.chipTomorrow.full==='tomorrow','overview chips shorten tomorrow to tmrw so the seven-column labels never truncate');
  assert(/is-compact/.test(display.compactHeavy) && /🌧️🌧️/.test(display.compactHeavy) && !/weather-signal/.test(display.compactHeavy) && /80% precipitation/.test(display.compactHeavy) && display.overviewCompact.heavyFits,'compact overview cues keep the full intensity emoji and move the wet chance to the tooltip');
  assert(!display.calendarWeather && display.shiftedHidden,'calendar cells and shifted past ranges stay weather-free');
  assert(/rain/.test(display.selectedBlock) && /feels like 5–13°C/.test(display.selectedBlock) && /80% precipitation/.test(display.selectedBlock) && /18 km\/h wind/.test(display.selectedBlock) && /data-open-weather-context/.test(display.selectedBlock),'selected-day sheet shows the useful forecast metrics before opening details');
  assert(/feels like/.test(display.sheetText) && /5–13°C/.test(display.sheetText) && /80%/.test(display.sheetText) && /18 km\/h/.test(display.sheetText),'weather context shows feels-like temperature, precipitation, and wind');
  assert(/Boston/.test(display.sheetText) && /Park walk/.test(display.sheetText) && /weather caution/.test(display.sheetText),'weather context separates and explains a far-place guided item');
  assert(display.codeLabel==='thunderstorms' && display.codeIcon==='ti-snowflake' && display.codeEmoji==='⛈️','WMO conditions map to accessible labels, icons, and emoji');
  assert(/weather-period-pill/.test(display.habitPeriod) && /10°/.test(display.habitPeriod) && !/10–12°/.test(display.habitPeriod) && /95%/.test(display.habitPeriod) && /weather-guidance-mark/.test(display.habitPeriod),'habit period pill uses feels-like temperature, wet signal, and guidance status for the item location');
  assert(/weather-period-signal">80%</.test(display.homePeriod) && !/weather-period-signal">95%</.test(display.homePeriod),'turning off item-location weather uses the home-city forecast');
  assert(!/weather-period-pill/.test(display.quietPeriod) && /weather-pill/.test(display.quietPeriod),'habits without showWeather keep only the guidance marker');
  assert(/weather-period-pill/.test(display.taskPeriod) && /10°/.test(display.taskPeriod) && /80%/.test(display.taskPeriod),'tasks can show ambient interval weather without a guidance profile');
  assert(!/weather-period-pill/.test(display.silentTaskPeriod),'tasks stay weather-quiet until the item toggle is on');
  assert(/10–12°/.test(display.longRange) && /10°/.test(display.shortRange) && !/10–12°/.test(display.shortRange),'temperature range appears only for long intervals with feels-like variation');
  assert(/weather-period-pill/.test(display.busyPeriod) && /10°/.test(display.busyPeriod),'busy-time cards show weather for their occupied interval when enabled');
  assert(/weather-period-pill/.test(display.travelPeriod) && /10°/.test(display.travelPeriod),'travel cards show destination weather for the travel interval');
  assert(display.travelInTitle && display.busyInTitle,'travel and busy weather pills sit on the first row so the second line stays readable');
  assert(display.periodCardsFit,'busy-time and travel weather pills fit the mobile card width without overflow');
  assert(display.minimalAmbient==='', 'minimal mode suppresses ambient period weather pills');
  assert(display.intensity.label==='heavy rain' && display.intensity.emoji==='🌧️🌧️','WMO intensity is visible through the condition label and emoji combination');

  const inheritedVisibility=await page.evaluate(()=>{
    const now=Date.now();const base=dayStart(now);const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',max:40,min:null,hard:false,relative:'none'}]};
    const samples=[{ts:base+12*3600000,temperature_2m:12,apparent_temperature:11,precipitation_probability:80,weather_code:61,source:'weekly'}];
    const settings={...DEFAULT_SORT_SETTINGS,minimalMode:false,homeCityLat:40.7,homeCityLng:-74,weatherProfiles:[profile],
      locations:[{id:'park',name:'Park',lat:42.36,lng:-71.06,weatherProfileId:'outdoor'}],
      _weatherContext:{profiles:[profile],timezone:tz,samples:[],places:{park:{timezone:tz,samples,weeklyFetchedAt:now}},locks:[]}};
    sortSettings=settings;
    const inherited={hid:'inherited',name:'Inherited',type:'keepup',weatherProfileMode:'inherit',weatherProfileId:null,showWeather:false};
    const explicit={...inherited,hid:'explicit',weatherProfileMode:'profile',weatherProfileId:'outdoor'};
    const row={kind:'fill',i:0,start:base+12*3600000,end:base+12.5*3600000,locationId:'park'};
    return {
      inherited:weatherCardPill({...row,h:inherited},inherited),
      ambient:weatherCardPill({...row,h:{...inherited,showWeather:true,showWeatherAtLocation:true}},{...inherited,showWeather:true,showWeatherAtLocation:true}),
      explicit:weatherCardPill({...row,h:explicit},explicit)
    };
  });
  assert(inheritedVisibility.inherited==='','location-only inheritance adds no automatic agenda badge');
  assert(/weather-period-pill/.test(inheritedVisibility.ambient),'explicit ambient display still shows weather for a location-inherited item');
  assert(/weather-pill/.test(inheritedVisibility.explicit),'explicit item guidance retains its compact agenda status');

  const cacheUpgrade=await page.evaluate(async()=>{
    const now=Date.now();
    const base=dayStart(now);
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile={id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:40,min:null,hard:false,relative:'none'}]};
    save([]);
    saveSortSettings({...DEFAULT_SORT_SETTINGS,homeCityName:'Test City',homeCityLat:40.7,homeCityLng:-74,weatherProfiles:[profile]});
    sortSettings=loadSortSettings();
    weatherCacheWrite({weekly:{lat:40.7,lng:-74,fetchedAt:now-60000,timezone:tz,samples:[
      {ts:base+12*3600000,temperature_2m:11,precipitation_probability:20,weather_code:2,source:'weekly'}
    ]}});
    const originalFetch=weatherFetchJson;
    let requested='';
    weatherFetchJson=async url=>{
      requested=String(url);
      return {
        timezone:tz,utc_offset_seconds:0,
        hourly:{time:[(base+12*3600000)/1000],temperature_2m:[11],apparent_temperature:[10],
          precipitation_probability:[20],precipitation:[0],snowfall:[0],wind_speed_10m:[8],wind_gusts_10m:[13],uv_index:[2],weather_code:[2],is_day:[1]},
        daily:{time:[base/1000],weather_code:[2],temperature_2m_min:[6],temperature_2m_max:[13],
          apparent_temperature_min:[5],apparent_temperature_max:[12],precipitation_probability_max:[20],
          precipitation_sum:[0],snowfall_sum:[0],wind_speed_10m_max:[8],wind_gusts_10m_max:[13],uv_index_max:[2]}
      };
    };
    try{await refreshWeatherForecast();}finally{weatherFetchJson=originalFetch;}
    const upgraded=weatherCacheRead().weekly;
    const ambientContext=weatherPlannerContext({...sortSettings,weatherProfiles:[],minimalMode:false,showWeatherOnTravel:true},now);
    const normalized=weatherNormalizePayload({timezone:tz,hourly:{time:[]},daily:{time:[base/1000],weather_code:[3],temperature_2m_min:[4],temperature_2m_max:[9]}},'weekly',now);
    return {
      requestedDaily:new URL(requested).searchParams.get('daily') || '',
      upgradedDays:upgraded?.days?.length || 0,
      upgradedCode:upgraded?.days?.[0]?.weather_code,
      ambientSamples:ambientContext?.samples?.length || 0,
      normalizedCode:normalized.days?.[0]?.weather_code
    };
  });
  assert(/temperature_2m_min/.test(cacheUpgrade.requestedDaily) && /weather_code/.test(cacheUpgrade.requestedDaily),'weekly request adds daily fields without a second forecast request');
  assert(cacheUpgrade.upgradedDays===1 && cacheUpgrade.upgradedCode===2,'fresh legacy forecast caches are refreshed with normalized daily summaries');
  assert(cacheUpgrade.ambientSamples===1,'ambient travel weather can use the forecast cache without creating a guidance profile');
  assert(cacheUpgrade.normalizedCode===3,'daily WMO summaries normalize alongside hourly samples');

  const batchFetch=await page.evaluate(async()=>{
    const now=Date.now();const base=dayStart(now);const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile={id:'outdoor',name:'Outdoor',rules:[{metric:'precipitation_probability',max:40,min:null,hard:false,relative:'none'}]};
    const locations=Array.from({length:6},(_,index)=>({
      id:`far${index}`,name:`Far ${index}`,lat:10+index,lng:20+index,weatherProfileId:'outdoor'
    }));
    const habits=locations.map((loc,index)=>({name:`Trip ${index}`,type:'task',dueDate:null,eventTime:null,logs:[],
      durationMinutes:30,priority:3,locationIds:[loc.id],anywhereAllowed:false,weatherProfileMode:'inherit'}));
    save(normalize(habits));
    saveSortSettings({...DEFAULT_SORT_SETTINGS,homeCityName:'Home',homeCityLat:40.7,homeCityLng:-74,weatherProfiles:[profile],locations});
    sortSettings=loadSortSettings();weatherCacheWrite({});
    const originalFetch=weatherFetchJson;const coordinateCounts=[];
    const payload=()=>({timezone:tz,utc_offset_seconds:0,hourly:{time:[(base+12*3600000)/1000],temperature_2m:[12],apparent_temperature:[11],
      precipitation_probability:[10],precipitation:[0],snowfall:[0],wind_speed_10m:[8],wind_gusts_10m:[12],uv_index:[2],weather_code:[1],is_day:[1]},
      daily:{time:[base/1000],weather_code:[1],temperature_2m_min:[8],temperature_2m_max:[14],apparent_temperature_min:[7],apparent_temperature_max:[13],
        precipitation_probability_max:[10],precipitation_sum:[0],snowfall_sum:[0],wind_speed_10m_max:[8],wind_gusts_10m_max:[12],uv_index_max:[2]}});
    weatherFetchJson=async url=>{
      const count=(new URL(url).searchParams.get('latitude') || '').split(',').filter(Boolean).length;
      coordinateCounts.push(count);
      return count>1?Array.from({length:count},payload):payload();
    };
    try{await refreshWeatherForecast();}finally{weatherFetchJson=originalFetch;}
    return {
      needed:weatherNeededExtraPlaces(sortSettings,load()).length,
      cached:Object.keys(weatherCacheRead().places || {}).length,
      batched:coordinateCounts.some(count=>count===6)
    };
  });
  assert(batchFetch.needed===6 && batchFetch.cached===6,'all guided far locations are discovered and cached beyond the old four-place limit');
  assert(batchFetch.batched,'far-place forecasts use a bounded multi-coordinate request');
  assert(errors.length===0,'page has no JavaScript errors: '+errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{console.error(error);process.exit(1);});
