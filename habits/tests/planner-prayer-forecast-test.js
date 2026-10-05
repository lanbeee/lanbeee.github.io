const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,openEveningSettings,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({timezoneId:'America/New_York',serviceWorkers:'block'});
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof forecastAgendaRisks==='function');
    const exactAvailable = await glpkAvailable(page);
    const results = await page.evaluate(async ({base,settings,exactAvailable})=>{
      const RealDate = Date;
      const dayBase = new RealDate(2026,9,5).getTime();
      let clock = dayBase + 6*3600000;
      function FrozenDate(...args){return args.length ? new RealDate(...args) : new RealDate(clock);}
      FrozenDate.now=()=>clock;FrozenDate.parse=RealDate.parse;FrozenDate.UTC=RealDate.UTC;
      FrozenDate.prototype=RealDate.prototype;Object.setPrototypeOf(FrozenDate,RealDate);
      globalThis.Date=FrozenDate;
      const previousSettings=sortSettings;
      sortSettings=settings;
      try{
        const data = normalize([
          {...base,hid:'morning',name:'Morning critical',target:1,priority:0,durationMinutes:2,
            allowedTimeStartAnchor:'fajr',allowedTimeEndAnchor:'sunrise',allowedTimeEndOffsetMin:-5},
          {...base,hid:'evening',name:'Evening critical',target:1,priority:0,durationMinutes:5,
            allowedTimeStartAnchor:'maghrib',allowedTimeEndAnchor:'isha',allowedTimeEndOffsetMin:-10},
          {...base,hid:'flex',name:'Flexible preferred work',target:1,priority:0,durationMinutes:30,
            preferredTimeStart:240,preferredTimeEnd:540,
            scheduleOptions:[{id:'flex-row',start:0,end:1440,sameDayMode:'alternative'}]}
        ]);
        save(data);
        clearPrayerTimesCache();
        const expected = data.slice(0,2).map(h=>({hid:h.hid,windows:fillDayWindows(h,dayBase,'home')}));
        const sun = weatherSunTimesFor({dayBase});
        const window=expected[0].windows[0];
        clock=Math.max(window.start,window.end-30*60000);
        const target=clock+5*60000;
        const output=[];
        for(const exact of exactAvailable ? [false,true] : [false]){
          const build = ()=>exact ? buildWeekAgendaAsync(data,{...settings,agendaOptimizer:true},7)
            : buildWeekAgenda(data,{...settings,agendaOptimizer:false},7);
          const first=await build();
          const forecast=await forecastAgendaRisks(first,data,settings,exact?'exact':'fast',{
            owners:['morning','evening'],targetAt:target
          });
          const future=forecast.futureWeek;
          // Validate the cached agenda that Home adopts, against the original
          // real-clock windows, not against another potentially broken resolver.
          const rows=(future?.days[0]?.timeline || []).filter(r=>r.kind==='fill');
          output.push({exact,probes:forecast.probes,normalWeek:forecast.normalWeek,
            legal:expected.every(({hid,windows})=>{
              const row=rows.find(r=>data[r.i]?.hid===hid);
              return row && windows.some(w=>row.start>=w.start && row.end<=w.end);
            }),morning:rows.some(r=>data[r.i]?.hid==='morning'),
            restored:JSON.stringify(expected)===JSON.stringify(data.slice(0,2).map(h=>({hid:h.hid,windows:fillDayWindows(h,dayBase,'home')}))),
            risks:Object.keys(forecast.risks).filter(k=>k.startsWith('morning:'))});
          // Repeated forecasts must keep cached prayer dates valid as well.
          const again=await forecastAgendaRisks(first,data,settings,exact?'exact':'fast',{owners:['morning'],targetAt:target});
          const morning=again.futureWeek.days[0].timeline.find(r=>r.kind==='fill' && data[r.i]?.hid==='morning');
          output[output.length-1].repeatLegal=Boolean(morning && morning.start>=window.start && morning.end<=window.end);
        }
        globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[target]));}static now(){return target;}};
        const forecastSun=weatherSunTimesFor({dayBase});
        return {output,sunStable:JSON.stringify(sun)===JSON.stringify(forecastSun) && Boolean(sun)};
      }finally{globalThis.Date=RealDate;sortSettings=previousSettings;clearPrayerTimesCache();}
    },{
      base:baseHabit({lastLog:null,createdAt:new Date(2026,9,1).getTime()}),
      settings:openEveningSettings({blockedTimes:[],locations:[{id:'home',name:'Home',lat:43,lng:-79}],
        lastKnownLocationId:'home',homeCityLat:43,homeCityLng:-79,prayerMethod:'NorthAmerica',prayerMadhab:'hanafi'}),
      exactAvailable
    });
    for(const row of results.output){
      const label=row.exact?'GLPK':'Fast';
      assert(row.normalWeek && row.probes===1,`${label}: one normal future build`);
      assert(row.morning && row.legal,`${label}: forecast retains critical occurrences inside their real prayer windows`);
      assert(row.repeatLegal && row.restored,`${label}: repeat forecast and restored clock preserve cached anchors`);
      assert.deepEqual(row.risks,[],`${label}: no false morning drop`);
      console.log(`ok: ${label} warm prayer cache survives forecast and adoption`);
    }
    assert(results.sunStable,'cached sunrise/sunset remain valid under the forecast clock');
    console.log('PASS planner prayer forecast');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
