const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {openEveningSettings,runPlannerPair,glpkAvailable} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
    const page=await context.newPage();
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    const dates=['2026-01-15','2026-06-15','2026-11-01'];
    for(const date of dates){
      for(const coords of [[40.7,-74],[21.4,39.8]]){
        const result=await page.evaluate(({date,coords})=>{
          sortSettings=Object.assign(loadSortSettings(),{homeCityLat:coords[0],homeCityLng:coords[1]});
          const base=dayStart(new Date(date+'T00:00:00').getTime());
          const times=prayerTimesFor({latitude:coords[0],longitude:coords[1]},new Date(base),prayerParams(sortSettings));
          const midnight=new adhan.SunnahTimes(times).middleOfTheNight;
          const h=normalize(buildPrayerSamples()).find(h=>h.hid==='sample-prayer-isha');
          const end=resolveHabitTimeField(h,'allowedTimeEnd',base);
          const next=new Date(base);next.setDate(next.getDate()+1);
          const tomorrow=prayerTimesFor({latitude:coords[0],longitude:coords[1]},next,prayerParams(sortSettings));
          const expected=Math.round((midnight.getTime()-base)/60000);
          save([h]);openDetail(0);
          const roundtrip=currentDetailTune();
          closeDetail();
          return {end,expected,midnight:midnight.getTime(),sunset:times.maghrib.getTime(),fajr:tomorrow.fajr.getTime(),
            roundtrip:roundtrip.allowedTimeEndAnchor,window:fillTimeWindow(h,base)};
        },{date,coords});
        assert.equal(result.end,result.expected,date+' resolves Adhan midpoint');
        assert.ok(Math.abs(result.midnight-(result.sunset+result.fajr)/2)<=30000,'midpoint is between sunset and next dawn');
        assert.ok(result.midnight < result.fajr,'end precedes next Fajr');
        assert.equal(result.roundtrip,'midnight','detail editor preserves new anchor');
        assert.equal(result.window.end,result.midnight,'allowed window ends at the exact Adhan midpoint');
      }
    }
    const settings=openEveningSettings({blockedTimes:[],homeCityLat:40.7,homeCityLng:-74,homeCityName:'Test city'});
    const now=new Date('2026-10-11T12:00:00-04:00').getTime();
    const h=await page.evaluate(settings=>{
      sortSettings=Object.assign(loadSortSettings(),settings);
      return normalize(buildPrayerSamples()).find(h=>h.hid==='sample-prayer-isha');
    },settings);
    const glpkOk=await glpkAvailable(page);
    h.createdAt=now-86400000;
    const pair=await runPlannerPair(page,[h],settings,now,2);
    for(const engine of ['fast',...(glpkOk?['glpk']:[])]){
      assert.equal(pair[engine].days[0][h.name],8,engine+' places Isha within its new window');
    }
    console.log('PASS: Adhan midpoint across cities/seasons, normalized/editor roundtrip, Fast and GLPK placement.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
