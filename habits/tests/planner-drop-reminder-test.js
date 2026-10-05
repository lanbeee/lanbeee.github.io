// A warning follows the last real agenda fit, including occupied time before
// the item's allowed end. Synthetic fixtures; both production and Fast paths.
const assert=require('node:assert/strict');
const {chromium,glpkAvailable}=require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const glpkOk=await glpkAvailable(page);
    const result=await page.evaluate(async glpkOk=>{
      const RealDate=Date,base=dayStart(Date.now()),now=base+14.5*3600000;
      let clock=now;
      function FrozenDate(...args){return args.length ? new RealDate(...args) : new RealDate(clock);}
      FrozenDate.now=()=>clock;FrozenDate.parse=RealDate.parse;FrozenDate.UTC=RealDate.UTC;
      FrozenDate.prototype=RealDate.prototype;Object.setPrototypeOf(FrozenDate,RealDate);globalThis.Date=FrozenDate;
      try{
        const settings={...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[],travel:{},
          availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],availabilityOverrides:{},agendaOptimizer:true};
        sortSettings=settings;
        const habit={hid:'short',name:'Ten-minute habit',type:'keepup',target:1,priority:2,durationMinutes:10,
          allowedTimeStart:870,allowedTimeEnd:945,createdAt:base-86400000,logs:[]};
        const fixed={hid:'event',name:'Fixed event',type:'task',priority:0,eventTime:base+15*3600000,durationMinutes:60,logs:[]};
        const high={hid:'high',name:'Higher priority commitment',type:'keepup',target:1,priority:0,durationMinutes:60,
          allowedTimeStart:900,allowedTimeEnd:960,createdAt:base-86400000,logs:[]};
        const results=[];
        for(const blocker of [fixed,high])for(const exact of glpkOk ? [false,true] : [false]){
          clock=now;
          const data=normalize([habit,blocker]);
          const week=exact ? await buildWeekAgendaAsync(data,settings,1) : buildWeekAgenda(data,settings,1);
          const row=week.days[0].timeline.find(r=>r.h?.hid==='short');
          const prefs={enabled:true,items:{'item:short':{missed:exact ? 'alarm' : 'notification',missedLeadMinutes:5}}};
          const early=nativeReminderEvents(week,data,settings,prefs,now).find(e=>e.reminderEdge==='missed');
          clock=base+(14*60+45)*60000;
          const forecast=await forecastAgendaRisks(week,data,settings,exact?'exact':'fast',{owners:['short']});
          forecast.revision='simple';applyAgendaRiskForecast(week,forecast,data);week.forecastRevision='simple';
          const warning=nativeReminderEvents(week,data,settings,prefs,clock).find(e=>e.reminderEdge==='missed');
          const sliding=shiftAgendaFillToNow(week.days[0].timeline,week.days[0].timeline.indexOf(row),base+(14*60+51)*60000);
          clock=base+(14*60+51)*60000;
          const after=exact ? await buildWeekAgendaAsync(data,settings,1) : buildWeekAgenda(data,settings,1);
          const dropped=nativeReminderEvents(after,data,settings,prefs,clock,week).filter(e=>e.key.includes(':Slipped:'));
          results.push({exact,blocker:blocker.hid,dropAt:row?.dropAt,at:warning?.at,delivery:warning?.delivery,
            early:Boolean(early),stillOnAgenda:after.days[0].timeline.some(r=>r.h?.hid==='short'),sliding:sliding!==null,dropped:dropped.length});
        }
        // No fragmentation loophole: two five-minute slivers cannot fit ten minutes.
        clock=now;
        const data=normalize([habit]);
        const day={dayBase:base,timeline:[{kind:'fill',h:data[0],i:0,start:now,end:now+600000}]};
        const fragmented={...settings,blockedTimes:[{label:'A',start:875,end:880,days:[]},{label:'B',start:885,end:1440,days:[]}]};
        const impossible=agendaOccurrenceDropAt(data[0],day.timeline[0],day,fragmented,data);
        const places=[{id:'home',name:'Home',lat:40,lng:-74},{id:'shop',name:'Shop',lat:40.01,lng:-74}];
        const travelSettings={...settings,locations:places,lastKnownLocationId:'home',travel:{
          'home|shop':{a:'home',b:'shop',seconds:300,metres:500,provider:'manual',fetchedAt:now}}};
        sortSettings=travelSettings;
        const located=normalize([{...habit,locationIds:['home'],anywhereAllowed:false},{...fixed,locationIds:['shop'],anywhereAllowed:false}]);
        const locatedDay={dayBase:base,timeline:[
          {kind:'fill',h:located[0],i:0,locationId:'home',start:now,end:now+600000},
          {kind:'scheduled',h:located[1],i:1,locationId:'shop',start:base+15*3600000,end:base+16*3600000}]};
        const travelCutoff=agendaOccurrenceDropAt(located[0],locatedDay.timeline[0],locatedDay,travelSettings,located);
        const hoursSettings={...travelSettings,locations:[{...places[0],allowedTimeStart:870,allowedTimeEnd:895},places[1]],travel:{}};
        sortSettings=hoursSettings;
        const hoursCutoff=agendaOccurrenceDropAt(located[0],locatedDay.timeline[0],{...locatedDay,timeline:locatedDay.timeline.slice(0,1)},hoursSettings,located);
        sortSettings=settings;
        const linkedData=normalize([habit,{...habit,hid:'partner',name:'Linked predecessor',priority:5}]);
        localStorage.setItem(KEY,JSON.stringify(linkedData));
        upsertOrderConstraint({dayBase:base,beforeHid:'partner',afterHid:'short',adjacency:'direct'});
        const linkedDay={dayBase:base,timeline:[
          {kind:'fill',h:linkedData[1],i:1,start:now,end:now+600000},
          {kind:'fill',h:linkedData[0],i:0,start:now+600000,end:now+1200000}]};
        const linkedCutoff=agendaOccurrenceDropAt(linkedData[0],linkedDay.timeline[1],linkedDay,settings,linkedData);
        saveOrderConstraintsForDrop(base,[]);
        // Idle polish must not remove displayed ordinary work or move imminent clocks.
        const qualityData=normalize([habit,{...habit,hid:'extra',priority:0,breakable:true,durationMinutes:60}]);
        const row={kind:'fill',i:0,start:now+120000,end:now+720000,occurrenceKey:'short:main'};
        const week=rows=>({days:[{dayBase:base,timeline:rows}],optimized:true});
        const baseline=week([row]),more={kind:'fill',i:1,start:now+1800000,end:now+5400000};
        const rejectsDrop=!homeAgendaRefinementIsBetter(baseline,week([more]),qualityData,settings);
        const rejectsImminentMove=!homeAgendaRefinementIsBetter(baseline,week([{...row,start:row.start+60000,end:row.end+60000},more]),qualityData,settings);
        const expiredTravelPlan=homeAgendaTickPlan(week([{...row,start:now+20*60000,end:now+30*60000,dropAt:now-1}]),now);
        return {base,results,impossible,rejectsDrop,rejectsImminentMove,travelCutoff,hoursCutoff,linkedCutoff,expiredTravelPlan};
      }finally{globalThis.Date=RealDate;}
    },glpkOk);
    for(const r of result.results){
      assert.equal(r.dropAt,result.base+(14*60+50)*60000+1,JSON.stringify(r));
      assert.equal(r.at,result.base+(14*60+45)*60000+2000,'inside the estimated lead warns promptly, without postponing for a restored future row');
      assert.equal(r.early,true,'constraint-aware estimate is armed before forecast');
      assert.equal(r.delivery,'alarm');
      assert.equal(r.stillOnAgenda,false,'at 2:51 the real planner drops this occurrence');
      assert.equal(r.sliding,false,'clock slide cannot carry work beyond its cutoff');
      assert.equal(r.dropped,1,'sudden/current drop produces one actionable alert');
    }
    assert.equal(result.impossible,null,'last fit respects contiguous gaps');
    assert.equal(result.travelCutoff,result.base+(14*60+45)*60000+1,'outbound travel makes cutoff earlier');
    assert.equal(result.hoursCutoff,result.base+(14*60+45)*60000+1,'location closing makes cutoff earlier');
    assert.equal(result.linkedCutoff,result.base+(14*60+40)*60000+1,'direct successor cutoff stays beside its lower-priority partner');
    assert(result.rejectsDrop);assert(result.rejectsImminentMove);
    assert.equal(result.expiredTravelPlan.kind,'imminent-solve','future start must refresh when its leave-by cutoff has passed');
    assert.equal(result.expiredTravelPlan.extraBudgetAllowed,false,'a distant-start cutoff cannot spend the extra imminent solve budget');
    console.log(`PASS: ${result.results.length} planner/collision cases, published cutoff, advance warning, drop alert, contiguity and stable refinement`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
