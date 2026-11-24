const assert = require('node:assert/strict');
const { chromium, devices, webkit } = require('playwright');
const { BASE, baseHabit } = require('./helpers/planner-test-helpers');

const now = Date.parse('2026-11-24T10:00:00Z');
const today = Date.parse('2026-11-24T00:00:00Z');
const settings = {
  preset:'todayFirst', minimalMode:false, agendaOptimizer:false,
  homeCityName:'Forecast test city', homeCityLat:40.7, homeCityLng:-74, homeCityCountry:'US',
  showWeatherOnBusyTimes:false, showWeatherOnTravel:false, weatherProfiles:[]
};
const weekly = {
  lat:40.7, lng:-74, fetchedAt:now - 21 * 3600000, timezone:'UTC',
  days:[{key:'2026-11-24',ts:today,weather_code:61,precipitation_probability_max:65}],
  samples:[{ts:now,precipitation_probability:65}]
};
const payload = {
  timezone:'UTC', utc_offset_seconds:0,
  daily:{time:[today / 1000],weather_code:[0],temperature_2m_min:[10],temperature_2m_max:[18]},
  hourly:{time:[now / 1000],temperature_2m:[12],apparent_temperature:[11],weather_code:[0]}
};

(async()=>{
  for(const [engine,device] of [[chromium,devices['Pixel 7']],[webkit,devices['iPhone 13']]]){
    const browser = await engine.launch();
    try{
      const page = await browser.newPage({...device,timezoneId:'UTC',serviceWorkers:'block'});
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      let online = false;
      let requests = 0;
      await page.route('https://api.open-meteo.com/**',route=>{
        requests++;
        if(new URL(route.request().url()).searchParams.get('latitude')==='41.7'){
          return route.fulfill({status:503,json:{}});
        }
        return online ? route.fulfill({json:payload}) : route.abort('internetdisconnected');
      });
      await page.clock.setFixedTime(new Date(now));
      await page.addInitScript(({settings,weekly,items})=>{
        localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
        localStorage.setItem('tings_v2',JSON.stringify(items));
        localStorage.setItem('tings_weather_cache_v1',JSON.stringify({weekly}));
        localStorage.setItem('tings_coach_install_v2','done');
        localStorage.setItem('tings_coach_essentials_v2','done');
      },{settings,weekly,items:[baseHabit({hid:'forecast-test',name:'Read',dueDate:today,type:'task'})]});
      await page.goto(BASE,{waitUntil:'domcontentloaded'});
      await page.locator('#launch-screen').waitFor({state:'hidden'});
      const pill = page.locator('#list > .section-header[data-label="today"] .weather-day-button');
      await pill.waitFor({state:'visible'});
      assert.match(await pill.innerText(),/saved/i,'offline Home shows the saved daily forecast');
      assert.match(await pill.getAttribute('aria-label'),/saved forecast.*21h ago/i);
      assert.equal(await page.evaluate(()=>Boolean(loadSortSettings()._weatherContext)),false,
        'an expired forecast is unavailable to the planner');
      await pill.tap();
      await page.locator('#weather-context-sheet.open').waitFor();
      assert.match(await page.locator('#weather-context-sub').innerText(),/saved forecast/i);
      assert.equal(await page.locator('#weather-context-content [data-weather-metric]').count(),0,
        'saved daily metrics have no stale hourly drill-down');
      await page.locator('#weather-context-close').tap();
      await page.waitForFunction(()=>!_weatherRefreshPromise && Boolean(weatherCacheRead().lastError));
      assert.ok(requests > 0,'Home forecast fetches with optional interval cues disabled');

      const originalPill = await pill.elementHandle();
      online = true;
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await page.waitForFunction(()=>document.querySelector('#list > .section-header[data-label="today"] .weather-day-button')
        ?.getAttribute('aria-label').startsWith('clear'));
      assert.equal(await originalPill.evaluate(el=>el.isConnected),true,'recovery updates the mounted pill in place');
      assert.doesNotMatch(await pill.innerText(),/saved/i);

      if(engine===chromium){
        await page.evaluate(()=>{
          saveSortSettings({...loadSortSettings(),
            weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:40}]}],
            locations:[{id:'park',name:'Park',lat:41.7,lng:-74}]
          });
          const items=load();
          Object.assign(items[0],{weatherProfileMode:'profile',weatherProfileId:'dry',weatherLocationId:'park'});
          save(items);
        });
        await page.clock.setFixedTime(new Date(now + 30 * 60000));
        const refresh=await page.evaluate(async()=>{
          const changed=await refreshWeatherForecast({force:true});
          const cache=weatherCacheRead();
          return {changed,fetchedAt:cache.weekly.fetchedAt,lastError:cache.lastError};
        });
        assert.deepEqual(refresh,{changed:true,fetchedAt:now + 30 * 60000,lastError:'weather 503'},
          'a secondary place failure preserves the successful new Home forecast');
      }

      online = false;
      await page.evaluate(async()=>{
        const cache=weatherCacheRead();
        cache.weekly.fetchedAt=Date.now() - 50 * 3600000;
        weatherCacheWrite(cache);
        sortSettings=loadSortSettings();
        await refreshWeatherForecast({force:true});
      });
      await pill.waitFor({state:'visible'});
      assert.equal(await pill.getAttribute('aria-label'),'Weather forecast unavailable');
      assert.deepEqual(errors,[]);
      console.log(`ok ${engine.name()}: saved forecast, online recovery, and unavailable state on mobile`);
    }finally{
      await browser.close();
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
