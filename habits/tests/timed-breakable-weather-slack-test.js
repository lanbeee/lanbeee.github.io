// Regression coverage for two coupled agenda semantics:
// 1) a timed breakable task anchors its first session instead of reserving its
//    entire duration as one fixed event; critical rows may interrupt it;
// 2) weather may spend a fractional rhythm's already-earned rolling slack,
//    but must place it on the next day once that quota would fall short.
const {chromium,BASE,FAST_ONLY}=require('./helpers/planner-test-helpers');

let passed=0,failed=0;
function check(value,message,detail=''){
  if(value){passed+=1;console.log(`  ok: ${message}`);}
  else{failed+=1;console.error(`  not ok: ${message}${detail ? ` :: ${detail}` : ''}`);}
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  try{
    await page.goto(BASE,{waitUntil:'load'});
    const result=await page.evaluate(async fastOnly=>{
      const RealDate=Date;
      const now=new RealDate(2026,8,13,12,24,0,0).getTime();
      function FrozenDate(...args){return args.length ? new RealDate(...args) : new RealDate(now);}
      FrozenDate.now=()=>now; FrozenDate.parse=RealDate.parse; FrozenDate.UTC=RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate); FrozenDate.prototype=RealDate.prototype;
      globalThis.Date=FrozenDate;
      const day=dayStart(now),at=(offset,hour,minute=0)=>day+offset*86400000+(hour*60+minute)*60000;
      const settings={...DEFAULT_SORT_SETTINGS,agendaOptimizer:true,showWeekOnHome:true,
        availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],availabilityOverrides:{},
        blockedTimes:[{label:'sleep',days:[],start:0,end:420},{label:'night',days:[],start:1380,end:1440}],
        locations:[],travel:{},weatherProfiles:[]};
      const base=props=>normalize([{
        hid:props.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:props.name,type:'keepup',target:1,
        logs:[],lastLog:null,durationMinutes:30,priority:2,breakable:false,minChunkMinutes:15,
        dueDate:null,eventTime:null,allowedTimeStart:null,allowedTimeEnd:null,
        preferredTimeStart:null,preferredTimeEnd:null,allowedWeekdays:[],allowedMonthDays:[],
        preferredWeekdays:[],preferredMonthDays:[],locationIds:[],anywhereAllowed:true,
        earlyWindowDays:0,delayAllowanceDays:0,createdAt:day-86400000,...props
      }])[0];
      const birthday=base({name:'Birthday',type:'task',target:null,dueDate:day,eventTime:at(0,17,30),
        durationMinutes:240,priority:0,breakable:true,minChunkMinutes:15});
      const maghrib=base({name:'Maghrib',lastLog:day-86400000,logs:[day-86400000],durationMinutes:5,
        priority:0,allowedTimeStart:19*60+30,allowedTimeEnd:20*60+9});
      const summarizeBirthday=week=>{
        const rows=week.days[0].timeline.filter(row=>row.kind==='fill' && (row.h.name==='Birthday' || row.h.name==='Maghrib'));
        const birthdayRows=rows.filter(row=>row.h.name==='Birthday');
        const prayer=rows.find(row=>row.h.name==='Maghrib');
        return {
          starts:birthdayRows.map(row=>row.start),
          total:birthdayRows.reduce((sum,row)=>sum+Math.round((row.end-row.start)/60000),0),
          prayer:prayer ? {start:prayer.start,end:prayer.end} : null,
          overlaps:prayer ? birthdayRows.some(row=>row.start<prayer.end && row.end>prayer.start) : true,
          scheduledBirthday:week.days[0].timeline.some(row=>row.kind==='scheduled' && row.h.name==='Birthday')
        };
      };
      const birthdayData=[birthday,maghrib];
      const birthdayFast=summarizeBirthday(buildWeekAgenda(birthdayData,{...settings,agendaOptimizer:false},1,{fullToday:true}));
      let birthdayGlpk=null;
      if(!fastOnly)birthdayGlpk=summarizeBirthday(await buildWeekAgendaAsync(birthdayData,settings,1,{fullToday:true,nativeLimitSeconds:4}));

      const profile={id:'comfy',name:'Comfy',rules:[
        {metric:'apparent_temperature',min:10,max:26.6666666667,hard:false,relative:'high'},
        {metric:'uv_index',min:null,max:4,hard:false,relative:'low'}
      ]};
      const samples=[];
      for(let offset=0;offset<3;offset+=1){
        for(let hour=12;hour<=22;hour+=1)samples.push({
          ts:at(offset,hour),apparent_temperature:offset===0?30:20,
          uv_index:offset===0?8:0,precipitation_probability:0,source:'weekly'
        });
      }
      const weatherSettings={...settings,weatherProfiles:[profile],_weatherContext:{
        profiles:[profile],timezone:'America/New_York',samples,days:[],places:{},locks:[],revision:'test'
      }};
      const walk=base({name:'Walk',target:8/5,durationMinutes:30,
        logs:[at(-7,12),at(-5,12),at(-3,12),at(-2,12),at(-1,12)],lastLog:at(-1,12),
        allowedTimeStart:12*60,allowedTimeEnd:22*60,weatherProfileMode:'profile',weatherProfileId:'comfy'});
      const firstWalk=week=>{
        const row=week.days.flatMap(item=>item.timeline).find(item=>item.kind==='fill' && item.h.name==='Walk');
        return row ? {day:dateKey(row.start),start:row.start} : null;
      };
      const weatherFast=firstWalk(buildWeekAgenda([walk],{...weatherSettings,agendaOptimizer:false},3,{fullToday:true}));
      let weatherGlpk=null;
      if(!fastOnly)weatherGlpk=firstWalk(await buildWeekAgendaAsync([walk],weatherSettings,3,{fullToday:true,nativeLimitSeconds:4}));
      globalThis.Date=RealDate;
      return {day,birthdayFast,birthdayGlpk,weatherFast,weatherGlpk};
    },FAST_ONLY);

    for(const [engine,value] of [['Fast',result.birthdayFast],['GLPK',result.birthdayGlpk]]){
      if(!value)continue;
      check(value.starts[0]===result.day+(17*60+30)*60000,`${engine}: timed breakable starts at 5:30 PM`,JSON.stringify(value));
      check(value.total===240,`${engine}: timed breakable retains all 240 minutes`,JSON.stringify(value));
      check(Boolean(value.prayer) && !value.overlaps,`${engine}: Maghrib interrupts without overlap`,JSON.stringify(value));
      check(!value.scheduledBirthday,`${engine}: timed breakable is not a fixed scheduled block`,JSON.stringify(value));
    }
    for(const [engine,value] of [['Fast',result.weatherFast],['GLPK',result.weatherGlpk]]){
      if(!value)continue;
      check(value.day==='2026-09-14',`${engine}: rolling 5x/8d slack defers poor weather only to the next required day`,JSON.stringify(value));
    }
    check(errors.length===0,'no page errors',errors.join(' | '));
  }finally{await browser.close();}
  console.log(`\n${passed} passed, ${failed} failed`);
  if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
