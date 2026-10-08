const {baseHabit,openEveningSettings}=require('./planner-test-helpers');
const NOW=new Date('2026-09-14T09:00:00-04:00').getTime(),DAY=NOW-540*60000,MS=86400000;
const key=offset=>`2026-09-${String(14+offset).padStart(2,'0')}`;
const habit=(hid,extra={})=>baseHabit({hid,name:`Synthetic ${hid}`,target:1,priority:2,
  createdAt:DAY-14*MS,earlyWindowDays:0,delayAllowanceDays:0,...extra});
const settings=extra=>openEveningSettings({blockedTimes:[{label:'night',days:[],start:0,end:540},
  {label:'end',days:[],start:1080,end:1440}],...extra});
const scenario=(id,data,extra={})=>({id,now:NOW,days:7,data,settings:settings(),...extra});
// Reduced from seeded discovery (72493). Fixed arrays are the regression corpus;
// tests never hunt randomly. Equal priorities remove priority tradeoff ambiguity.
const gapSpecs=[
  [[45,645,750],[30,645,735],[30,645,765],[60,645,765],[45,645,810],[45,645,780],[30,705,795],[45,705,750],[30,585,615]],
  [[60,600,705],[60,600,735],[90,600,795],[60,540,675],[45,540,720],[30,540,675],[90,540,705],[30,660,825]],
  [[30,600,675],[90,540,765],[30,660,705],[15,600,690],[45,540,690],[15,540,690],[15,540,630],[90,660,825],[60,600,705],[30,540,615],[30,540,615],[90,600,765]]
];
const witnesses=[[[8,585],[2,645],[1,675],[0,705],[6,750]],
  [[5,540],[3,570],[0,630],[2,690],[7,795]],
  [[6,540],[10,555],[9,585],[0,615],[5,645],[3,660],[2,675],[7,705]]];
function gap(index,id,transform){
  const data=gapSpecs[index].map(([durationMinutes,allowedTimeStart,allowedTimeEnd],i)=>habit(`g${i}`,{
    durationMinutes,allowedTimeStart,allowedTimeEnd,priority:2,allowedWeekdays:[1]}));
  const result=scenario(id,data,{days:1,knownGap:true,witness:witnesses[index],
    settings:settings({blockedTimes:[{label:'night',days:[],start:0,end:540},{label:'end',days:[],start:900,end:1440}]})});
  if(transform)transform(result);return result;
}
function weatherContext(days=7){
  const profiles=[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',min:null,max:40,hard:true,relative:'low'}]},
    {id:'mild',name:'Mild',rules:[{metric:'temperature_2m',min:5,max:30,hard:false,relative:'low'}]}];
  const samples=[];for(let d=0;d<days;d++)for(let h=0;h<24;h++)samples.push({ts:DAY+d*MS+h*3600000,
    precipitation_probability:h<12?90:10,temperature_2m:18+(h%4),wind_speed_10m:8,source:'weekly'});
  return {profiles,timezone:'America/New_York',samples,locks:[]};
}
function withPlaces(s){
  s.settings.locations=[{id:'home',name:'Home',lat:40.7,lng:-74,isHome:true},
    {id:'shop',name:'Shop',lat:40.701,lng:-74,allowedTimeStart:600,allowedTimeEnd:1020,closedDays:[0]},
    {id:'office',name:'Office',lat:40.705,lng:-74,allowedTimeStart:540,allowedTimeEnd:1050},
    {id:'closed',name:'Closed',lat:40.702,lng:-74,closedDays:[0,1,2,3,4,5,6]}];
  s.settings.lastKnownLocationId='home';
  s.settings.travel={};for(const a of s.settings.locations)for(const b of s.settings.locations)if(a.id<b.id)
    s.settings.travel[`${a.id}|${b.id}`]={a:a.id,b:b.id,seconds:300,metres:500,provider:'manual',fetchedAt:NOW};
}
function mixed(count){
  const s=scenario(`mixed-${count}`,[]);withPlaces(s);
  s.settings.homeCityLat=40.7;s.settings.homeCityLng=-74;
  s.settings.weatherProfiles=weatherContext().profiles;s.settings._weatherContext=weatherContext();
  s.settings.blockedTimes.splice(1,0,{label:'lunch',days:[],start:720,end:750,locationId:'home'});
  s.settings.availabilityOverrides=Object.fromEntries(Array.from({length:7},(_,d)=>[key(d),480]));
  const core=[
    habit('daily-critical',{priority:0,durationMinutes:10,allowedTimeStart:540,allowedTimeEnd:600}),
    habit('split-work',{priority:0,durationMinutes:120,breakable:true,minChunkMinutes:30,allowedTimeStart:600,allowedTimeEnd:1050}),
    habit('sparse',{target:3,durationMinutes:20,allowedTimeStart:750,allowedTimeEnd:1080}),
    habit('fractional',{target:0.5,durationMinutes:5,allowedTimeStart:600,allowedTimeEnd:1080}),
    habit('reduce',{type:'reduce',target:2,durationMinutes:10}),
    habit('zero',{type:'zero',target:null,durationMinutes:10}),
    habit('dry-walk',{durationMinutes:15,allowedTimeStart:750,allowedTimeEnd:1080,weatherProfileMode:'profile',weatherProfileId:'dry'}),
    habit('linked-a',{durationMinutes:10,allowedTimeStart:960,allowedTimeEnd:1050}),
    habit('linked-b',{durationMinutes:10,allowedTimeStart:960,allowedTimeEnd:1080,
      scheduleLinks:[{anchorHid:'linked-a',direction:'after',adjacency:'direct',requireSameDay:true}]}),
    habit('planned',{type:'task',target:null,dueDate:DAY+6*MS,earlyWindowDays:6,durationMinutes:20,logs:[{ts:DAY+2*MS+780*60000,plan:true}]}),
    habit('fixed',{type:'task',target:null,dueDate:DAY,eventTime:DAY+660*60000,durationMinutes:20,priority:0,locationIds:['office'],anywhereAllowed:false}),
    habit('logged',{durationMinutes:10,logs:[DAY+480*60000],lastLog:DAY+480*60000}),
    habit('snoozed',{snoozedUntil:DAY+2*MS,durationMinutes:10}),
    habit('prayer',{durationMinutes:5,allowedTimeStartAnchor:'asr',allowedTimeEndAnchor:'maghrib',
      allowedTimeStartOffsetMin:0,allowedTimeEndOffsetMin:-10}),
    habit('options',{durationMinutes:10,anywhereAllowed:false,locationIds:[],scheduleOptions:[
      {id:'closed-option',weekdays:[],start:600,end:660,locationId:'closed'},
      {id:'open-option',weekdays:[],start:780,end:1020,locationId:'shop'}]}),
    habit('doing',{durationMinutes:15,priority:0,allowedTimeStart:540,allowedTimeEnd:570})
  ];
  s.storage={'tings_order_constraints_v1':JSON.stringify({edges:[],doingNow:{hid:'doing',dayBase:DAY,startedAt:NOW,sessionMinutes:15,endsAt:NOW+15*60000}})};
  for(let i=core.length;i<count;i++)core.push(habit(`task-${i}`,{
    type:'task',target:null,durationMinutes:[10,15,20,30,45][i%5],priority:i%6,
    dueDate:DAY+(i%7)*MS,earlyWindowDays:i%7,delayAllowanceDays:i%3===0?1:0,
    allowedTimeStart:600+(i%4)*60,allowedTimeEnd:1020,
    allowedWeekdays:i%3===0?[1,3,5]:[],allowedMonthDays:i%11===0?[14,16,18,20]:[],
    preferredTimeStart:840,preferredTimeEnd:960,preferredWeekdays:[3],preferredLocationId:'shop',
    locationIds:i%4===0?['shop','office']:[],anywhereAllowed:i%4!==0,
    weatherProfileMode:i%6===0?'profile':'none',weatherProfileId:i%6===0?'dry':null,
    breakable:i%9===0,minChunkMinutes:15
  }));
  s.data=core;s.required={'daily-critical':70};s.expectedClocks={doing:{day:0,start:540}};return s;
}
// Evening packing regression: a sparse outdoor occurrence and a closing venue
// require shifting flexible critical rows and a long soft-preference block.
function eveningPackingScenario(){
  const now=new Date('2026-10-03T18:28:00-04:00').getTime();
  const day=now-1108*60000,ms=86400000;
  const item=(hid,durationMinutes,priority,start,end,extra={})=>baseHabit({
    hid,name:`Synthetic ${hid}`,target:1,durationMinutes,priority,logs:[day-ms],
    allowedTimeStart:start,allowedTimeEnd:end,...extra});
  const profile={id:'mild',name:'Mild',rules:[{metric:'temperature_2m',min:null,max:25,hard:true,relative:'none'}]};
  const samples=Array.from({length:7*24},(_,i)=>({ts:day+i*3600000,
    temperature_2m:i%24<20 ? 20 : 30,source:'weekly'}));
  const home={locationIds:['home'],anywhereAllowed:false};
  return {id:'evening-sparse-weather-and-closing-venue',now,dayBase:day,days:7,data:[
    item('critical-a',5,0,1134,1173,home),item('critical-b',10,0,1210,1330,home),
    item('meal',15,1,1230,1410,home),
    item('long-flex',60,2,977,1439,{...home,target:7,logs:[day-7*ms],preferredTimeStart:970,preferredTimeEnd:1210}),
    item('call-a',15,2,1290,1440),item('call-b',30,2,1320,1440),item('call-c',30,2,1305,1440),
    item('outdoor',30,2,725,1396,{...home,target:1.6,logs:[day-2*ms],weatherProfileMode:'profile',weatherProfileId:'mild'}),
    item('errand',30,3,0,1440,{type:'reduce',target:30,earlyWindowDays:4,delayAllowanceDays:0,
      logs:[day-30*ms],locationIds:['shop'],anywhereAllowed:false})
  ],settings:openEveningSettings({blockedTimes:[{label:'night',days:[],start:1396,end:1440}],
    lastKnownLocationId:'home',locations:[{id:'home',name:'Home',lat:40.7,lng:-74},
      {id:'shop',name:'Shop',lat:40.701,lng:-74,allowedTimeStart:0,allowedTimeEnd:1200}],
    travel:{'home|shop':{a:'home',b:'shop',seconds:360,metres:3000,provider:'manual',fetchedAt:now}},
    weatherProfiles:[profile],_weatherContext:{profiles:[profile],samples,locks:[],timezone:'America/New_York',
      places:{home:{timezone:'America/New_York',samples}}}
  }),dayMinutes:{outdoor:{0:30},errand:{0:30}}};
}

// Packed-week recovery: optional early errand must fit TODAY with eight
// incumbent fills, without adding a second occurrence or extra weekly travel.
function lateEveningPackingScenario(){
  const s=eveningPackingScenario();
  s.id='late-evening-optional-errand';s.now=s.dayBase+1147*60000;
  s.data.find(h=>h.hid==='critical-a').allowedTimeStart=1150;
  const errand=s.data.find(h=>h.hid==='errand');
  Object.assign(errand,{logs:[s.dayBase-26*MS],planByDate:s.dayBase+6*MS,delayAllowanceDays:4,preferredWeekdays:[1,2,3,4,5]});
  s.settings.locations.find(l=>l.id==='shop').allowedTimeEnd=1260;
  s.settings.locations.find(l=>l.id==='home').isHome=true;
  s.settings.blockedTimes.push({label:'sleep',days:[],start:0,end:420,locationId:'home'});
  return s;
}

// A completed wash is not outstanding work. The missing closing-venue errand
// can fit after the weather-guided walk by shifting the flexible critical row.
// Errand-first also fits, but worsens the walk's weather and must be rejected
// without ending the search before its walk-first alternative.
function closingErrandWeatherScenario(){
  const now=new Date('2026-10-07T19:05:00-04:00').getTime();
  const day=now-1145*60000,home={locationIds:['home'],anywhereAllowed:false};
  const item=(hid,durationMinutes,priority,start,end,extra={})=>baseHabit({
    hid,name:`Synthetic ${hid}`,target:1,durationMinutes,priority,
    allowedTimeStart:start,allowedTimeEnd:end,logs:[day-MS],...extra});
  const profiles=[{id:'warm',name:'Warm',rules:[{
    metric:'temperature_2m',min:null,max:null,hard:false,relative:'high'
  }]}];
  const samples=Array.from({length:7*24},(_,i)=>({ts:day+i*3600000,
    temperature_2m:30-i%24,source:'weekly'}));
  return {id:'closing-errand-preserves-walk-weather',now,dayBase:day,days:7,data:[
    item('walk',30,2,724,1361,{...home,target:1.6,logs:[day-2*MS],
      weatherProfileMode:'profile',weatherProfileId:'warm'}),
    item('wash',5,2,0,1440,{...home,target:2.5,logs:[day+900*60000],lastLog:day+900*60000}),
    item('critical',10,0,1203,1323),item('meal',15,1,1230,1410,home),
    item('call',32,2,1305,1440),
    item('errand',30,3,600,1230,{type:'reduce',target:30,earlyWindowDays:4,
      delayAllowanceDays:4,planByDate:day+2*MS,logs:[day-26*MS],
      locationIds:['shop'],anywhereAllowed:false})
  ],settings:openEveningSettings({
    blockedTimes:[{label:'sleep',days:[],start:0,end:420,locationId:'home'},
      {label:'night',days:[],start:1361,end:1440,locationId:'home'}],
    lastKnownLocationId:'home',locations:[{id:'home',name:'Home',lat:40.7,lng:-74,isHome:true},
      {id:'shop',name:'Shop',lat:40.701,lng:-74,allowedTimeStart:600,allowedTimeEnd:1230}],
    travel:{'home|shop':{a:'home',b:'shop',seconds:360,metres:3000,provider:'manual',fetchedAt:now}},
    weatherProfiles:profiles,_weatherContext:{profiles,samples,locks:[],timezone:'America/New_York',
      places:{home:{timezone:'America/New_York',samples}}}
  }),dayMinutes:{walk:{0:30},errand:{0:30},wash:{0:0}}};
}

function qualityScenarios(){
  const gaps=[gap(0,'selection-trap'),gap(1,'long-block-trap'),gap(2,'short-hole-trap'),
    gap(0,'weather-selection-trap',s=>{
      const ctx=weatherContext(1);ctx.samples.forEach(sample=>sample.precipitation_probability=10);
      s.settings.weatherProfiles=ctx.profiles;s.settings._weatherContext=ctx;
      s.data.forEach(h=>{h.weatherProfileMode='profile';h.weatherProfileId='dry';});
    }),
    gap(1,'location-hours-selection-trap',s=>{
      withPlaces(s);s.data.forEach(h=>{h.locationIds=['home'];h.anywhereAllowed=false;});
      s.settings.locations[0].allowedTimeStart=540;s.settings.locations[0].allowedTimeEnd=900;
    })];
  const precision=scenario('off-grid-windows',[
    habit('seven',{durationMinutes:7,allowedTimeStart:547,allowedTimeEnd:554}),
    habit('eleven',{durationMinutes:11,allowedTimeStart:554,allowedTimeEnd:565}),
    habit('appointment',{type:'task',target:null,eventTime:DAY+565*60000,dueDate:DAY,durationMinutes:13})
  ],{days:1,required:{seven:7,eleven:11,appointment:13}});
  const weather=scenario('wet-morning-dry-afternoon',[
    habit('outdoor',{durationMinutes:30,allowedTimeStart:540,allowedTimeEnd:1020,weatherProfileMode:'profile',weatherProfileId:'dry'})
  ],{days:1,required:{outdoor:30},earliest:{outdoor:720}});
  weather.settings.weatherProfiles=weatherContext(1).profiles;weather.settings._weatherContext=weatherContext(1);
  const places=scenario('travel-and-venue-hours',[
    habit('errand-a',{type:'task',target:null,dueDate:DAY,durationMinutes:20,allowedTimeStart:600,allowedTimeEnd:900,locationIds:['shop'],anywhereAllowed:false}),
    habit('errand-b',{type:'task',target:null,dueDate:DAY,durationMinutes:20,allowedTimeStart:600,allowedTimeEnd:900,locationIds:['office'],anywhereAllowed:false}),
    habit('venue-choice',{durationMinutes:10,locationIds:['closed','shop'],anywhereAllowed:false,allowedTimeStart:600,allowedTimeEnd:900})
  ],{days:1,required:{'errand-a':20,'errand-b':20,'venue-choice':10}});withPlaces(places);
  const scaled=gap(0,'selection-trap-50-week');scaled.days=7;withPlaces(scaled);
  scaled.settings.blockedTimes[1].start=1080;
  scaled.settings._weatherContext=weatherContext();scaled.settings.weatherProfiles=weatherContext().profiles;
  while(scaled.data.length<50){
    const i=scaled.data.length,d=1+((i-9)%6),slot=750+Math.floor((i-9)/6)*30;
    scaled.data.push(habit(`filler-${i}`,{type:'task',target:null,dueDate:DAY+d*MS,priority:i%6,
      durationMinutes:10,allowedTimeStart:slot,allowedTimeEnd:slot+25,allowedWeekdays:[(d+1)%7],
      locationIds:i%3===0?['shop']:['home'],anywhereAllowed:false,
      weatherProfileMode:'profile',weatherProfileId:'dry'}));
  }
  const inheritance=scenario('place-weather-options',[
    habit('exercise',{durationMinutes:30,anywhereAllowed:false,locationIds:[],scheduleOptions:[
      {id:'wet-park',weekdays:[],start:600,end:660,locationId:'shop',weatherProfileMode:'inherit'},
      {id:'indoor',weekdays:[],start:600,end:660,locationId:'office',weatherProfileMode:'none'}]})
  ],{days:1,required:{exercise:30},expectedPlaces:{exercise:'office'}});withPlaces(inheritance);
  inheritance.settings.locations.find(l=>l.id==='shop').weatherProfileId='dry';
  inheritance.settings.weatherProfiles=weatherContext(1).profiles;inheritance.settings._weatherContext=weatherContext(1);
  inheritance.settings._weatherContext.places=Object.fromEntries(['shop','office'].map(id=>[id,
    {timezone:'America/New_York',samples:weatherContext(1).samples,weeklyFetchedAt:NOW}]));
  const cadence=scenario('cadence-and-partial-logs',[
    habit('daily',{durationMinutes:10,allowedTimeStart:600,allowedTimeEnd:630}),
    habit('sparse-three',{target:3,durationMinutes:20,allowedTimeStart:630,allowedTimeEnd:660}),
    habit('fractional-window',{target:0.5,durationMinutes:5,allowedTimeStart:660,allowedTimeEnd:720}),
    habit('partial',{durationMinutes:60,breakable:true,minChunkMinutes:15,allowedTimeStart:780,allowedTimeEnd:900,
      logs:[{ts:DAY+480*60000,minutes:30}]}),
    habit('hidden',{snoozedUntil:DAY+7*MS}),habit('limit',{type:'reduce',target:2,durationMinutes:5}),
    habit('stopped',{type:'zero',target:null})
  ],{required:{daily:70,'sparse-three':60,'fractional-window':35,partial:390},absent:['hidden','stopped'],
    expectedDays:{'sparse-three':[0,3,6]},dayMinutes:{partial:{0:30}},exactTotals:{daily:70,partial:390}});
  const plans=scenario('deadlines-plans-and-links',[
    habit('due-today',{type:'task',target:null,dueDate:DAY,hardDue:true,durationMinutes:30,priority:0,allowedTimeStart:600,allowedTimeEnd:660}),
    habit('future-plan',{type:'task',target:null,dueDate:DAY+5*MS,earlyWindowDays:5,durationMinutes:30,
      logs:[{ts:DAY+2*MS+780*60000,plan:true}]}),
    habit('timed-plan',{durationMinutes:15,logs:[{ts:DAY+1*MS+810*60000,plan:true,timed:true}]}),
    habit('a',{durationMinutes:10,allowedTimeStart:960,allowedTimeEnd:990}),
    habit('b',{durationMinutes:10,allowedTimeStart:960,allowedTimeEnd:1020,
      scheduleLinks:[{anchorHid:'a',direction:'after',adjacency:'direct',requireSameDay:true}]}),
    habit('late-allowed',{type:'task',target:null,dueDate:DAY,delayAllowanceDays:2,durationMinutes:30,allowedWeekdays:[3]}),
    habit('done-task',{type:'task',target:null,dueDate:DAY,durationMinutes:10,logs:[DAY+480*60000],lastLog:DAY+480*60000})
  ],{required:{'due-today':30,'future-plan':30,'late-allowed':30},absent:['done-task'],
    expectedDays:{'due-today':[0],'future-plan':[2],'late-allowed':[2]},expectedClocks:{'timed-plan':{day:1,start:810}}});
  const anchored=scenario('prayer-combined-and-overnight',[
    habit('anchored',{durationMinutes:7,allowedTimeStartAnchor:'asr',allowedTimeEndAnchor:'maghrib',allowedTimeEndOffsetMin:-5,
      allowedTimeStartCombine:'later',allowedTimeStartAnchor2:'fixed',allowedTimeStartFixedMin2:900}),
    habit('overnight',{durationMinutes:10,allowedTimeStart:1260,allowedTimeEnd:120})
  ],{settings:settings({homeCityLat:40.7,homeCityLng:-74,blockedTimes:[]}),required:{anchored:49,overnight:70}});
  return [...gaps,precision,weather,places,inheritance,cadence,plans,anchored,scaled,
    eveningPackingScenario(),lateEveningPackingScenario(),mixed(20),mixed(35),mixed(50)];
}
module.exports={qualityScenarios,NOW,DAY,mixed,eveningPackingScenario,lateEveningPackingScenario,closingErrandWeatherScenario};
