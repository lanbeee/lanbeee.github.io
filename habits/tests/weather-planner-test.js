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
  await page.locator('#weather-profile-add').click();
  assert(await page.locator('.weather-profile-card').count()===1,'settings creates a named weather profile');
  assert(await page.locator('#ting-weather-profile option').count()===2,'new profile appears in habit assignment');
  assert(await page.locator('.weather-rule-hint').count()===1,'each rule shows its metric scale');
  assert(/chance/.test(await page.locator('.weather-rule-hint').first().textContent()),'the hint names the metric scale bands');
  await page.locator('[data-weather-rule-relative]').first().selectOption('none');
  assert(await page.locator('.weather-profile-card .weather-rule').count()===1,'choosing "no preference" keeps the rule so bounds can be set after');
  assert(!/inactive/.test(await page.locator('.weather-rule-hint').first().textContent()),'a bounds-only rule with no preference stays active');
  assert(/inactive/.test(await page.evaluate(()=>weatherRuleHintText({metric:'uv_index',min:null,max:null,relative:'none'}))),'a rule without bounds or preference says it is inactive');
  assert(/UV index/.test(await page.evaluate(()=>weatherRuleHintText({metric:'uv_index',min:null,max:null,relative:'none'}))),'the inactive note still shows the metric scale');
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
    const kept=normalize([{name:'Trip',type:'task',weatherProfileId:'outdoor',weatherLocationId:'boston',
      logs:[],locationIds:[],anywhereAllowed:true}]);
    saveSortSettings({...loadSortSettings(),locations:settings.locations,weatherProfiles:loadSortSettings().weatherProfiles});
    sortSettings=loadSortSettings();
    const profileId=$('ting-weather-profile')?.querySelector('option:not([value=""])')?.value || '';
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
  assert(extra.keptLocation==='boston','normalize keeps a forecast-place override');
  assert(extra.placeSelectShown,'forecast place appears after a profile is chosen');
  assert(extra.placeOptions>=3,'home city plus saved places fill the forecast place list');
  assert(errors.length===0,'page has no JavaScript errors: '+errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{console.error(error);process.exit(1);});
