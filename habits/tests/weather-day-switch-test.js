// Calendar navigation must keep seven distinct dates across DST changes.
const assert = require('node:assert/strict');
const { chromium, BASE } = require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const [timezoneId,dates] of [
      ['America/New_York',['2026-10-31','2026-11-01','2026-03-08']],
      ['Europe/Berlin',['2026-10-24','2026-10-25','2026-03-29']],
      ['UTC',['2026-12-31']]
    ]){
      const page=await browser.newPage({timezoneId});
      await page.goto(BASE,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof plannerDaySwitchHtml==='function');
      for(const today of dates){
        await page.clock.setSystemTime(new Date(`${today}T12:00:00Z`));
        const result=await page.evaluate(today=>{
          // UTC arithmetic supplies expected calendar keys independently of
          // the browser's local DST offset and the navigation helper.
          const expected=offset=>{
            const d=new Date(`${today}T12:00:00Z`);
            d.setUTCDate(d.getUTCDate()+offset);
            return d.toISOString().slice(0,10);
          };
          const read=(key,attr)=>{
            const host=document.createElement('div');
            host.innerHTML=plannerDaySwitchHtml(key,attr,'choose a day');
            return {
              keys:[...host.querySelectorAll('.free-day-chip')].map(el=>el.getAttribute(attr)),
              todayCount:[...host.querySelectorAll('.free-day-chip span')].filter(el=>el.textContent==='today').length,
              tomorrowCount:[...host.querySelectorAll('.free-day-chip span')].filter(el=>el.textContent==='tmrw').length,
              selected:[...host.querySelectorAll('[aria-current="date"]')].map(el=>el.getAttribute(attr)),
              steps:[...host.querySelectorAll('.free-day-step')].map(el=>el.getAttribute(attr))
            };
          };
          return {
            expected:Array.from({length:7},(_,i)=>expected(i)),
            centeredExpected:Array.from({length:7},(_,i)=>expected(i+7)),
            previous:expected(-1),tomorrow:expected(1),last:expected(6),outside:expected(10),
            shifted:plannerShiftDateKey(today,1),
            roundTrip:plannerShiftDateKey(plannerShiftDateKey(today,1),-1),
            tomorrowCopy:plannerDaySwitchChipCopy(expected(1)),
            weather:read(today,'data-weather-day'),
            free:read(expected(6),'data-free-day'),
            centered:read(expected(10),'data-weather-day')
          };
        },today);
        const label=`${timezoneId} ${today}`;
        assert.deepEqual(result.weather.keys,result.expected,`${label}: weather shows seven consecutive dates`);
        assert.equal(result.weather.todayCount,1,`${label}: one today chip`);
        assert.equal(result.weather.tomorrowCount,1,`${label}: one tomorrow chip`);
        assert.deepEqual(result.weather.selected,[today],`${label}: one selected date`);
        assert.deepEqual(result.weather.steps,[result.previous,result.tomorrow],`${label}: arrows move one calendar day`);
        assert.equal(result.shifted,result.tomorrow,`${label}: forward date shift`);
        assert.equal(result.roundTrip,today,`${label}: date shift reverses`);
        assert.equal(result.tomorrowCopy.weekday,'tmrw',`${label}: tomorrow label follows the calendar`);
        assert.deepEqual(result.free.keys,result.expected,`${label}: last planner day keeps the current week`);
        assert.deepEqual(result.free.selected,[result.last],`${label}: free-time picker selects the last day`);
        assert.deepEqual(result.centered.keys,result.centeredExpected,`${label}: outside dates center seven consecutive days`);
        assert.deepEqual(result.centered.selected,[result.outside],`${label}: outside date remains selected`);
        console.log(`  ok: ${label}`);
      }
      await page.close();
    }
  }finally{
    await browser.close();
  }
  console.log('weather-day-switch-test: all calendar navigation checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
