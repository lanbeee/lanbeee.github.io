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
          const read=(key,attr,fact)=>{
            const host=document.createElement('div');
            host.style.width='390px';
            host.innerHTML=plannerDaySwitchHtml(key,attr,'choose a day',fact);
            document.body.appendChild(host);
            plannerDaySwitchReveal(host);
            const scroller=host.querySelector('.free-day-chips');
            const chips=[...host.querySelectorAll('.free-day-chip')];
            const chipW=chips[0]?.getBoundingClientRect().width || 0;
            const gap=parseFloat(getComputedStyle(scroller).columnGap || getComputedStyle(scroller).gap) || 0;
            const visible=chipW ? (scroller.clientWidth+gap)/(chipW+gap) : 0;
            const todayChip=host.querySelector('[data-switch-today="1"]');
            const selected=host.querySelector('[aria-current="date"]');
            const result={
              keys:chips.map(el=>el.getAttribute(attr)),
              todayCount:[...host.querySelectorAll('.free-day-name')].filter(el=>el.textContent==='today').length,
              tomorrowCount:[...host.querySelectorAll('.free-day-name')].filter(el=>el.textContent==='tmrw').length,
              selected:[...host.querySelectorAll('[aria-current="date"]')].map(el=>el.getAttribute(attr)),
              fixed:host.querySelector('.free-day-switch')?.classList.contains('is-fixed') || false,
              scrolls:scroller.scrollWidth>scroller.clientWidth+1,
              visible:Math.round(visible*100)/100,
              todayLeads:Boolean(todayChip) && Math.abs(scroller.scrollLeft-(todayChip.offsetLeft||0))<1.5
            };
            host.remove();
            return result;
          };
          return {
            expected:Array.from({length:7},(_,i)=>expected(i)),
            nearEnd:expected(13),
            past:expected(-1),far:expected(30),outside:expected(10),
            tomorrow:expected(1),last:expected(6),
            shifted:plannerShiftDateKey(today,1),
            roundTrip:plannerShiftDateKey(plannerShiftDateKey(today,1),-1),
            tomorrowCopy:plannerDaySwitchChipCopy(expected(1)),
            weather:read(today,'data-weather-day','weather'),
            weatherLater:read(expected(10),'data-weather-day','weather'),
            free:read(expected(6),'data-free-day','open'),
            ahead:read(expected(10),'data-free-day','open'),
            farWindow:read(expected(30),'data-free-day','open'),
            pastOpen:read(expected(-1),'data-free-day','open')
          };
        },today);
        const label=`${timezoneId} ${today}`;
        assert.deepEqual(result.weather.keys,result.expected,`${label}: weather shows the seven forecast days`);
        assert.equal(result.weather.fixed,true,`${label}: weather days fill the row`);
        assert.equal(result.weather.scrolls,false,`${label}: weather days do not scroll`);
        assert.equal(result.weather.todayCount,1,`${label}: one today chip`);
        assert.equal(result.weather.tomorrowCount,1,`${label}: one tomorrow chip`);
        assert.deepEqual(result.weather.selected,[today],`${label}: one selected date`);
        assert.deepEqual(result.weatherLater.keys,result.expected,`${label}: a later day still offers only the forecast week`);
        assert.deepEqual(result.weatherLater.selected,[],`${label}: a day outside the forecast is not a weather chip`);
        assert.equal(result.shifted,result.tomorrow,`${label}: forward date shift`);
        assert.equal(result.roundTrip,today,`${label}: date shift reverses`);
        assert.equal(result.tomorrowCopy.weekday,'tmrw',`${label}: tomorrow label follows the calendar`);
        assert.equal(result.free.keys[0],today,`${label}: open hours starts today`);
        assert.equal(result.free.keys.at(-1),result.nearEnd,`${label}: open hours runs two weeks ahead`);
        assert.equal(result.free.keys.includes(result.past),false,`${label}: open hours omits yesterday`);
        assert.equal(result.free.scrolls,true,`${label}: open hours can scroll to later days`);
        assert.ok(Math.abs(result.free.visible-7)<0.08,`${label}: seven open-hours days fit (${result.free.visible})`);
        assert.deepEqual(result.free.selected,[result.last],`${label}: free-time picker selects the last forecast-week day`);
        assert.equal(result.free.todayLeads,true,`${label}: a day inside the week keeps that week on screen`);
        assert.equal(result.ahead.keys[0],today,`${label}: a later open day still starts at today`);
        assert.deepEqual(result.ahead.selected,[result.outside],`${label}: that later day remains selected`);
        assert.equal(result.farWindow.keys[0],today,`${label}: a far open day does not add past dates`);
        assert.equal(result.farWindow.keys.at(-1),result.far,`${label}: a far open day stays on the strip`);
        assert.equal(result.pastOpen.keys[0],today,`${label}: opening a past day still starts the strip at today`);
        assert.deepEqual(result.pastOpen.selected,[],`${label}: a past day is not listed`);
        console.log(`  ok: ${label}`);
      }
      await page.close();
    }
  }finally{
    await browser.close();
  }
  console.log('weather-day-switch-test: all calendar navigation checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
