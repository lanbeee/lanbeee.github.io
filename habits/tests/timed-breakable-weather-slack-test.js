// Regression coverage for two coupled agenda semantics:
// 1) a timed breakable task fixes its first session start instead of reserving its
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
      const birthdayTrace=week=>{
        const report=buildDayCapacityScorecard(birthdayData,settings,day,now,{weekMode:true,weekSnapshot:week});
        const item=report.plannerTrace.find(entry=>entry.name==='Birthday');
        return item ? {earliest:item.earliestClockFit,inputs:item.inputs,decision:item.decision} : null;
      };
      const birthdayFastWeek=buildWeekAgenda(birthdayData,{...settings,agendaOptimizer:false},1,{fullToday:true});
      const birthdayFastTrace=birthdayTrace(birthdayFastWeek);
      const birthdayGlpkWeek=fastOnly ? null : await buildWeekAgendaAsync(birthdayData,settings,1,{fullToday:true,nativeLimitSeconds:4});
      const birthdayGlpkTrace=birthdayGlpkWeek ? birthdayTrace(birthdayGlpkWeek) : null;

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
      const weatherFastWeek=buildWeekAgenda([walk],{...weatherSettings,agendaOptimizer:false},3,{fullToday:true});
      const weatherFast=firstWalk(weatherFastWeek);
      let weatherGlpk=null;
      let weatherGlpkWeek=null;
      if(!fastOnly){
        weatherGlpkWeek=await buildWeekAgendaAsync([walk],weatherSettings,3,{fullToday:true,nativeLimitSeconds:4});
        weatherGlpk=firstWalk(weatherGlpkWeek);
      }
      const deadlineSamples=[];
      for(let offset=0;offset<3;offset+=1){
        for(let hour=12;hour<=22;hour+=1)deadlineSamples.push({
          ts:at(offset,hour),apparent_temperature:offset===2?20:(offset===1?35:30),
          uv_index:offset===2?0:(offset===1?10:8),precipitation_probability:0,source:'weekly'
        });
      }
      const deadlineWeatherSettings={...weatherSettings,_weatherContext:{
        ...weatherSettings._weatherContext,samples:deadlineSamples,revision:'deadline-test'
      }};
      const deadlineWalk={...walk,
        logs:[at(-7,12),at(-6,12),at(-5,12),at(-3,12),at(-2,12)],
        lastLog:at(-2,12)
      };
      const deadlineFast=firstWalk(buildWeekAgenda(
        [deadlineWalk],{...deadlineWeatherSettings,agendaOptimizer:false},3,{fullToday:true}
      ));
      let deadlineGlpk=null;
      if(!fastOnly)deadlineGlpk=firstWalk(await buildWeekAgendaAsync(
        [deadlineWalk],deadlineWeatherSettings,3,{fullToday:true,nativeLimitSeconds:4}
      ));
      const auditSummary=(week,auditHabit=walk)=>{
        const report=buildDayCapacityScorecard([auditHabit],weatherSettings,day,now,{
          weekMode:true,weekSnapshot:week
        });
        return {
          missed:report.missedOpportunityCount,
          critical:report.criticalMissCount,
          intentional:report.intentionalDeferralCount,
          statuses:report.placementGaps.map(gap=>gap.status),
          reason:report.unplacedItems.find(item=>item.i===0)?.reason || '',
          text:formatDayCapacityScorecardText(report,'today','test audit')
        };
      };
      const adjacentRows=coalesceAdjacentBreakableRows([
        {kind:'fill',h:birthday,i:0,start:at(0,17,30),end:at(0,18),locationId:'party',chunkMinutes:30,chunkIndex:0,scheduledDay:'2026-09-13'},
        {kind:'fill',h:birthday,i:0,start:at(0,18),end:at(0,18,45),locationId:'party',chunkMinutes:45,chunkIndex:1,scheduledDay:'2026-09-13'},
        {kind:'fill',h:birthday,i:0,start:at(0,19),end:at(0,19,30),locationId:'party',chunkMinutes:30,chunkIndex:2,scheduledDay:'2026-09-13'}
      ]);
      // The final audit must classify from the mounted week plus current item
      // state. A new due boundary can appear after that week was computed;
      // rolling quota + better forecast still explains the existing assignment.
      const dueAuditWalk=deadlineWalk;
      const weatherFastAudit=auditSummary(weatherFastWeek,dueAuditWalk);
      const weatherGlpkAudit=weatherGlpkWeek ? auditSummary(weatherGlpkWeek,dueAuditWalk) : null;
      const policyWeights=resolveAgendaScoreWeights({agendaScoreWeights:{
        travel:1,cluster:0,day:0,asap:0.12,scarce:0,preference:0
      }});
      const earlyTripCost=scoreAgendaPlacement({
        travelSeconds:2*60,fromLocId:'home',toLocId:'store',asapDelayMin:0,urgency:100
      },policyWeights);
      const lateNoTripCost=scoreAgendaPlacement({
        travelSeconds:0,fromLocId:'home',toLocId:'home',asapDelayMin:120,urgency:100
      },policyWeights);
      const fixedAnchors=optimizerFixedLocationAnchors({
        rows:[{kind:'scheduled',start:at(0,16),end:at(0,16,15),locationId:'appointment'}],
        fills:[{fit:{placeStart:at(0,17,30),placeEnd:at(0,17,45),locId:'event'}}]
      });
      globalThis.Date=RealDate;
      return {
        day,birthdayFast,birthdayGlpk,birthdayFastTrace,birthdayGlpkTrace,weatherFast,weatherGlpk,
        deadlineFast,deadlineGlpk,
        weatherFastAudit,weatherGlpkAudit,earlyTripCost,lateNoTripCost,
        travelWeight:policyWeights.travel,fixedAnchors,
        adjacentRows:adjacentRows.map(row=>({start:row.start,end:row.end,minutes:row.chunkMinutes}))
      };
    },FAST_ONLY);

    for(const [engine,value] of [['Fast',result.birthdayFast],['GLPK',result.birthdayGlpk]]){
      if(!value)continue;
      check(value.starts[0]===result.day+(17*60+30)*60000,`${engine}: timed breakable starts at 5:30 PM`,JSON.stringify(value));
      check(value.total===240,`${engine}: timed breakable retains all 240 minutes`,JSON.stringify(value));
      check(Boolean(value.prayer) && !value.overlaps,`${engine}: Maghrib interrupts without overlap`,JSON.stringify(value));
      check(!value.scheduledBirthday,`${engine}: timed breakable is not a fixed scheduled block`,JSON.stringify(value));
    }
    for(const [engine,trace] of [['Fast',result.birthdayFastTrace],['GLPK',result.birthdayGlpkTrace]]){
      if(!trace)continue;
      check(trace.earliest===result.day+(17*60+30)*60000
        && trace.inputs.some(input=>input.includes('fixed first start 5:30 PM'))
        && trace.inputs.some(input=>input.includes('remaining sessions may use')),
      `${engine}: audit distinguishes the fixed first start from resumable time`,JSON.stringify(trace));
    }
    for(const [engine,value] of [['Fast',result.weatherFast],['GLPK',result.weatherGlpk]]){
      if(!value)continue;
      check(value.day==='2026-09-14',`${engine}: rolling 5x/8d slack defers poor weather only to the next required day`,JSON.stringify(value));
    }
    for(const [engine,value] of [['Fast',result.deadlineFast],['GLPK',result.deadlineGlpk]]){
      if(!value)continue;
      check(value.day==='2026-09-13',
        `${engine}: a distant good forecast cannot justify deferral past the rolling-quota deadline`,
        JSON.stringify(value));
    }
    check(result.adjacentRows.length===2
      && result.adjacentRows[0].minutes===75
      && result.adjacentRows[1].minutes===30,
    'adjacent breakable pieces publish as one session while a real gap stays split',JSON.stringify(result.adjacentRows));
    check(result.earlyTripCost < result.lateNoTripCost,
      'a short extra location-changing trip costs less than a two-hour idle delay',
      JSON.stringify({early:result.earlyTripCost,late:result.lateNoTripCost}));
    check(result.travelWeight>1 && result.travelWeight<1.5,
      'travel receives a modest global cost increase without becoming dominant',
      String(result.travelWeight));
    check(result.fixedAnchors.length===2
      && result.fixedAnchors.some(anchor=>anchor.locationId==='appointment')
      && result.fixedAnchors.some(anchor=>anchor.locationId==='event'),
    'route optimization treats scheduled rows and committed exact-start sessions as fixed location anchors',
    JSON.stringify(result.fixedAnchors));
    for(const [engine,audit] of [['Fast',result.weatherFastAudit],['GLPK',result.weatherGlpkAudit]]){
      if(!audit)continue;
      check(audit.missed===0 && audit.critical===0 && audit.intentional===1,
        `${engine}: audit treats better-weather assignment as intentional, not a critical miss`,JSON.stringify(audit));
      check(audit.statuses.includes('weather-deferred'),
        `${engine}: remaining-gap audit labels the weather deferral`,JSON.stringify(audit));
      check(audit.reason.includes('better weather') && audit.reason.includes('5×/8-day'),
        `${engine}: unplaced explanation includes forecast choice and rolling quota`,audit.reason);
      check(audit.text.includes('WEATHER DEFERRED') && audit.text.includes('no misses'),
        `${engine}: copied audit is explicit about the explained gap`,audit.text);
    }
    check(errors.length===0,'no page errors',errors.join(' | '));
  }finally{await browser.close();}
  console.log(`\n${passed} passed, ${failed} failed`);
  if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
