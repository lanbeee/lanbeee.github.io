const assert = require('node:assert/strict');
const playwright = require('playwright');

(async()=>{
  const browser = await playwright[process.env.BROWSER || 'chromium'].launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York',colorScheme:'light'});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-06T12:00:00-04:00'));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>typeof syncHeaderBrand === 'function');
    async function expectVariant(variant){
      const src = `./icons/tings-app-icon${variant === 'day' ? '' : '-' + variant}.svg`;
      await page.waitForFunction(src=>[...document.querySelectorAll('[data-header-brand]')].every(img=>img.getAttribute('src') === src && img.complete && img.naturalWidth > 0),src);
      assert.equal(await page.locator('[data-header-brand]').count(),2);
    }
    await page.evaluate(()=>updateSortSetting({themeMode:'light',homeCityLat:null,homeCityLng:null,locations:[]}));
    await expectVariant('day');
    await page.evaluate(()=>updateSortSetting({themeMode:'dark'}));
    await expectVariant('night');
    await page.emulateMedia({colorScheme:'light'});
    await expectVariant('night'); // Explicit theme wins over system.
    await page.evaluate(()=>updateSortSetting({themeMode:'system'}));
    await expectVariant('day');
    await page.emulateMedia({colorScheme:'dark'});
    await expectVariant('night'); // Change event must update without a render.
    for(const themeMode of ['light','dark']){
      await page.evaluate(themeMode=>updateSortSetting({themeMode}),themeMode);
      await page.clock.setFixedTime(new Date('2026-10-06T05:15:00-04:00'));
      await page.evaluate(()=>refreshHomeAgendaWhileOpen());
      await expectVariant('twilight');
      await page.clock.setFixedTime(new Date('2026-10-06T06:45:01-04:00'));
      await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await expectVariant(themeMode === 'dark' ? 'night' : 'day');
      await page.clock.setFixedTime(new Date('2026-10-06T18:00:00-04:00'));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await expectVariant('twilight');
    }
    // Real solar calculator: sunrise isn't the fallback 6 AM, and changing
    // the saved home/first place must move the header's twilight window.
    await page.clock.setFixedTime(new Date('2026-10-06T12:00:00-04:00'));
    const rise = await page.evaluate(()=>{
      updateSortSetting({themeMode:'light',homeCityLat:40.7,homeCityLng:-74});
      const times = prayerTimesFor({latitude:40.7,longitude:-74},new Date(),prayerParams(sortSettings));
      return Number.isFinite(times?.sunrise?.getTime()) ? times.sunrise.getTime() : null;
    });
    assert.ok(rise,'Real solar calculation available');
    await page.clock.setFixedTime(new Date(rise));
    await page.evaluate(()=>syncHeaderBrand());
    await expectVariant('twilight');
    await page.clock.setFixedTime(new Date(rise + 46 * 60000));
    await page.evaluate(()=>syncHeaderBrand());
    await expectVariant('day');
    await page.clock.setFixedTime(new Date(rise));
    await page.evaluate(()=>updateSortSetting({homeCityLat:null,homeCityLng:null,locations:[{id:'home',name:'Home',lat:40.7,lng:-74}]}));
    await expectVariant('twilight');
    const fallback = await page.evaluate(()=>{
      const original = prayerTimesFor;
      try{
        prayerTimesFor = ()=>({sunrise:new Date(NaN),maghrib:new Date(NaN)});
        return headerBrandVariant(new Date(2026,9,6,18).getTime(),sortSettings);
      }finally{prayerTimesFor = original;}
    });
    assert.equal(fallback,'twilight');
    for(const width of [390,1440]){
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(500);
      await expectVariant('twilight');
      const visible = await page.locator(width === 390 ? '#open-about img' : '#bar-open-about img').boundingBox();
      assert.ok(visible && visible.width >= 24 && visible.height >= 24);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS header palettes: themes/system, solar/fallback, resume/minute, mobile/desktop');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
