const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-14T09:00:00-04:00'));
    await context.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,themeMode:'light',
        locations:[{id:'park',name:'Park',lat:40,lng:-74},{id:'home',name:'Home',lat:40,lng:-74}],
        weatherTempUnit:'f',weatherProfiles:[
          {id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:30}]},
          {id:'warm',name:'Warm',rules:[{metric:'temperature_2m',min:20,max:30}]},
          {id:'empty',name:'Empty',rules:[]}
        ]}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    const page = await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(BASE,{waitUntil:'networkidle'});
    for(const width of [390,1280]){
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(count=>document.body.dataset.paneCount===count,width>=1200 ? '3' : '1');
      for(const minimal of [false,true]){
        await page.evaluate(minimal=>setMinimalMode(minimal),minimal);
        await page.locator(width >= 1280 ? '#bar-open-add' : '#open-add').click();
        await page.locator('#type-seg [data-v="keepup"]').click();
        if(minimal){
          assert.equal(await page.locator('[data-add-repeat="opportunity"]').isVisible(),false,'minimal add hides when conditions fit');
          await page.locator('#do-cancel').click();
        }else{
        await page.locator('[data-add-repeat="opportunity"]').click();
        await page.locator('#ting-message').fill('A walk');
        const park=page.locator('#ting-tag-chips [data-location-id="park"]');
        const anywhere=page.locator('#ting-tag-chips [data-anywhere]');
        assert.equal(await anywhere.innerText(),'anywhere');
        assert(await page.locator('#do-save').isDisabled(),'weather trigger needs weather rules');
        await page.locator('#ting-condition-trigger').selectOption('location');
        assert(!await anywhere.isVisible(),'location trigger requires a named place');
        await park.click();
        assert.equal(await park.getAttribute('aria-pressed'),'true');
        assert.equal(await anywhere.getAttribute('aria-pressed'),'false','named place excludes unrestricted placement');
        assert.deepEqual(await page.evaluate(()=>readAddRecord().locationPrefs),{});
        assert(await page.locator('#do-save').isEnabled(),'selected place activates location trigger');
        await park.click();
        assert.equal(await park.getAttribute('aria-pressed'),'false','second tap removes without changing preference');
        assert.equal(await anywhere.getAttribute('aria-pressed'),'true');
        assert(await page.locator('#do-save').isDisabled(),'removed place deactivates location trigger');
        await page.locator('#ting-weather-profile').selectOption('dry');
        assert(await page.locator('#do-save').isDisabled(),'weather guidance does not activate location trigger');
        await page.locator('#ting-condition-trigger').selectOption('weather');
        await page.waitForFunction(()=>!$('do-save').disabled);
        assert.match(await page.locator('#ting-weather-guidance-hint').innerText(),/at most 30 %/);
        await park.click();
        await page.locator('#ting-tag-chips [data-location-id="home"]').click();
        assert.equal((await page.evaluate(()=>readAddRecord())).locationIds.length,2,'multiple place selection');
        const anywhereBefore=await page.evaluate(()=>readAddRecord().anywhereAllowed);
        await anywhere.click();
        const weatherPlaces=await page.evaluate(()=>readAddRecord());
        assert.equal(weatherPlaces.anywhereAllowed,!anywhereBefore,'weather trigger keeps ordinary anywhere toggle');
        assert.equal(weatherPlaces.locationIds.length,2,'anywhere does not erase ordinary place preferences');
        await page.locator('#ting-weather-profile').selectOption('warm');
        assert.match(await page.locator('#ting-weather-guidance-hint').innerText(),/68 °F to 86 °F/,'bound summary follows display units');
        await page.locator('#ting-weather-profile').selectOption('empty');
        await page.waitForFunction(()=>$('do-save').disabled);
        assert.match(await page.locator('#ting-weather-guidance-hint').innerText(),/Add a weather limit/);
        await page.locator('#do-cancel').click();
        }

        const item=baseHabit({hid:'conditional',name:'Optional walk',repeatMode:'opportunity',locationIds:['park'],anywhereAllowed:false,locationPrefs:{park:'high'}});
        await page.evaluate(item=>{save([item]);openDetail(0);scrollDetailToNav('schedule');},item);
        const detailPark=page.locator('#detail-place-chips [data-location-id="park"]');
        assert.equal(await detailPark.innerText(),'Park','conditional places do not show ranking symbols');
        assert.deepEqual(await page.evaluate(()=>currentDetailTune().locationPrefs),{park:'high'},'opening preserves saved rankings');
        if(minimal){
          assert.equal(await page.locator('[data-detail-repeat]').isVisible(),false,'minimal detail hides when conditions fit');
        }else{
          await page.locator('[data-detail-rhythm="1,7"]').click();
          assert.match(await detailPark.textContent(),/★/,'regular mode still exposes saved ranking');
          await page.locator('[data-detail-repeat]').click();
          assert.equal(await detailPark.innerText(),'Park');
        }
        await detailPark.click();
        assert.equal(await detailPark.getAttribute('aria-pressed'),'false');
        assert(await page.locator('#detail-save').isDisabled());
        await page.locator('#detail-weather-profile').selectOption('dry');
        assert(await page.locator('#detail-save').isDisabled(),'weather guidance cannot replace a location trigger');
        await detailPark.click();
        await page.locator('#detail-weather-profile').selectOption('__none__');
        assert(await page.locator('#detail-save').isEnabled(),'location trigger works with any weather');
        assert(!await page.locator('#detail-weather-guidance-hint').isVisible(),'unused guidance needs no explanation');
        await page.locator('#detail-save').click();
        const saved=await page.evaluate(()=>load()[0]);
        assert.equal(saved.conditionTrigger,'location');
        assert.equal(saved.anywhereAllowed,false);
        assert.deepEqual(saved.locationIds,['park']);
        assert.deepEqual(saved.locationPrefs,{});
        assert.equal(saved.weatherProfileMode,'none');
        await page.evaluate(()=>closeDetail());
      }
    }
    // Inheritance names rules and explains mixed places without inventing a
    // weather requirement for the place whose rules are empty.
    await page.evaluate(()=>{
      updateSortSetting({locations:locationOptions().map(loc=>({...loc,weatherProfileId:loc.id==='park'?'dry':null}))});
      openDetail(0);scrollDetailToNav('schedule');
    });
    await page.locator('#detail-place-chips [data-location-id="home"]').click();
    await page.locator('#detail-condition-trigger').selectOption('weather');
    await page.locator('#detail-weather-profile').selectOption('');
    assert.match(await page.locator('#detail-weather-profile option[value=""]').innerText(),/each place’s weather rules/);
    assert.match(await page.locator('#detail-weather-guidance-hint').innerText(),/Park · Dry/);
    await page.setViewportSize({width:320,height:844});
    await page.waitForFunction(()=>document.body.dataset.paneCount==='1');
    await page.evaluate(()=>{openDetail(0);scrollDetailToNav('schedule');hideToast();});
    await page.locator('#detail-weather-profile').selectOption('dry');
    await page.screenshot({path:'test-results/condition-controls-schedule.png',animations:'disabled'});
    await page.evaluate(()=>{closeDetail();updateSortSetting({locations:[]});setMinimalMode(true);});
    await page.locator('#open-add').click();
    await page.locator('#type-seg [data-v="keepup"]').click();
    assert.equal(await page.locator('[data-add-repeat="opportunity"]').isVisible(),false,'minimal add hides when conditions fit before places exist');
    await page.evaluate(()=>setMinimalMode(false));
    await page.locator('[data-add-repeat="opportunity"]').click();
    assert(await page.locator('#ting-tag-chips [data-anywhere]').isVisible(),'weather-triggered habit can happen anywhere');
    await page.locator('#ting-weather-profile').selectOption('dry');
    assert(await page.locator('#ting-weather-city').isVisible(),'weather-only condition offers city setup');
    await page.locator('#ting-message').fill('Walk on a dry day');
    await page.locator('#ting-message').blur();
    await page.evaluate(()=>{document.querySelector('.add-content').scrollTop=0;hideToast();});
    await page.screenshot({path:'test-results/condition-controls-add.png',animations:'disabled'});
    await page.locator('#do-cancel').click();
    assert.deepEqual(errors,[]);
    console.log('Conditional place toggles, weather explanations, units and saved choices pass in both modes and layouts');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
