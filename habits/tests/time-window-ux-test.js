// Shared relative editors: progressive disclosure must preserve active rules
// and city setup must return to the same unsaved item draft.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-11T08:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:true,showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({json:{features:[{
      geometry:{coordinates:[-74,40.7]},properties:{name:'Test city',countrycode:'US'}
    }]}}));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.evaluate(h=>{save([h]);openDetail(0);},baseHabit({hid:'window-fixture',name:'Walk',durationMinutes:30}));
    const start = page.locator('#detail-allowed-time-row .time-endpoint').first();
    assert.ok(await page.locator('.schedule-time-lead').first().isVisible(),'minimal mode explains the boundaries');
    assert.doesNotMatch(await page.locator('.schedule-time-lead').first().innerText(),/prayer|fajr|isha/i,'general guidance stays neutral');
    assert.doesNotMatch(await page.locator('#detail-habit-options-help').textContent(),/prayer|fajr|isha/i,'place-option help stays neutral');
    await start.locator('[data-time-mode="relative"]').click();
    await start.locator('.time-anchor').selectOption('sunrise');
    await start.locator('.time-offset').fill('30');
    await start.locator('.time-offset-sign-btn').first().press('Enter');
    assert.equal(await start.locator('.time-rule-summary').innerText(),'30 min before Sunrise');
    assert.equal(await start.locator('.time-advanced').getAttribute('open'),null,'simple rules hide extra controls');
    assert.equal(await start.locator('.time-day-next').isVisible(),false);
    assert.equal(await start.locator('.time-combine').isVisible(),false);
    assert.ok(await start.locator('.time-set-city').isVisible());
    const draft = await page.evaluate(()=>currentDetailTune());
    await start.locator('.time-set-city').click();
    assert.ok(await page.locator('#settings-sheet.open #home-city-input').isVisible());
    await page.locator('#home-city-input').fill('Test city');
    await page.locator('#home-city-set').click();
    await page.waitForFunction(()=>sortSettings.homeCityName === 'Test city');
    await page.locator('#settings-close').click();
    assert.deepEqual(await page.evaluate(()=>currentDetailTune()),draft,'city setup preserves all unsaved item settings');
    assert.equal(await start.locator('.time-set-city').isVisible(),false);
    assert.equal(await start.locator('.time-resolved').getAttribute('data-day-label'),'today: ');
    await page.locator('#toast-close').click();
    await start.evaluate(endpoint=>endpoint.closest('.schedule-time-block').scrollIntoView({block:'start'}));
    await page.waitForTimeout(400); // Let Settings' closing transition finish for the visual artifact.
    await page.screenshot({path:'test-results/time-window-simple.png'});

    await start.locator('.time-advanced > summary').click();
    await start.locator('.time-day-next').click();
    assert.equal(await start.locator('.time-resolved').getAttribute('data-day-label'),'tomorrow: ');
    await start.locator('.time-combine').selectOption('later');
    await start.locator('.time-anchor').selectOption('fajr');
    await start.locator('.time-anchor2').selectOption('isha');
    assert.match(await start.locator('.time-rule-summary').innerText(),/Dawn and Night$/);
    const namingDraft = await page.evaluate(()=>currentDetailTune());
    await page.evaluate(()=>{
      openHomeCitySettings();
      $('settings-prayer-body').hidden=false;
      $('settings-prayer-head').setAttribute('aria-expanded','true');
      refreshSampleHabitsSheet();
    });
    assert.equal(await page.locator('#settings-prayer-head').innerText(),'relative times');
    assert.equal(await page.locator('#settings-prayer-calculation').isVisible(),false);
    assert.equal(await page.locator('#sample-prayers-section').getAttribute('hidden'),'');
    assert.match(await page.locator('#sample-blocks-preview').textContent(),/Night/);
    assert.doesNotMatch(await page.locator('#sample-blocks-preview').textContent(),/Isha/);
    const names = page.locator('[data-setting-toggle="prayerIslamicNames"]');
    await names.click();
    assert.ok(await page.locator('#settings-prayer-calculation').isVisible(),'prayer calculation settings are opt-in');
    assert.equal(await page.locator('#sample-prayers-section').getAttribute('hidden'),null,'prayer sample habits are opt-in');
    assert.match(await start.locator('.time-rule-summary').textContent(),/Fajr and Isha$/,'both expressions refresh their names');
    assert.deepEqual(await page.evaluate(()=>currentDetailTune()),namingDraft,'changing names preserves the unsaved rule');
    await names.click();
    assert.match(await start.locator('.time-rule-summary').textContent(),/Dawn and Night$/);
    assert.deepEqual(await page.evaluate(()=>currentDetailTune()),namingDraft,'returning to general names preserves the rule');
    assert.equal(await page.locator('#settings-prayer-calculation').isVisible(),false);
    assert.equal(await page.locator('#sample-prayers-section').getAttribute('hidden'),'');
    await page.locator('#settings-close').click();
    await start.locator('.time-anchor').selectOption('sunrise');
    await start.locator('.time-anchor2').selectOption('fixed');
    await start.locator('.time-fixed2').fill('20:00');
    assert.match(await start.locator('.time-rule-summary').innerText(),/^Later of 30 min before next day's Sunrise and /);
    assert.equal(await start.locator('.time-offset2').isVisible(),false,'clock comparison hides its unused offset');
    assert.equal(await start.locator('.time-expr2 .time-adjust-label').isVisible(),false);
    await start.locator('.time-advanced > summary').click();
    assert.equal(await page.evaluate(()=>currentDetailTune().allowedTimeStartCombine),'later','folding options keeps the rule active');
    await page.locator('#detail-save').click();
    await page.evaluate(()=>openDetail(0));
    assert.notEqual(await start.locator('.time-advanced').getAttribute('open'),null,'saved complex rules reveal their controls');
    assert.equal(await start.locator('.time-fixed2').inputValue(),'20:00');

    // The same editor must stay inside narrow phones, larger text, and desktop.
    for(const width of [320,390,1100]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(()=>document.body.style.fontSize='18px');
      const overflowing = await start.evaluate(endpoint=>[...endpoint.querySelectorAll('select,input,button,summary')]
        .filter(el=>el.getClientRects().length)
        .filter(el=>el.getBoundingClientRect().right > endpoint.getBoundingClientRect().right + 2)
        .map(el=>el.className));
      assert.deepEqual(overflowing,[],width+'px controls fit the editor');
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.body.style.fontSize='';setMinimalMode(false);setScheduleView('preferred');});
    const preferred = page.locator('#detail-preferred-time-row .time-endpoint').first();
    await preferred.locator('[data-time-mode="relative"]').click();
    assert.equal(await preferred.locator('.time-combine').isVisible(),false,'preferred hours use the same disclosure');
    await page.evaluate(()=>{setScheduleView('allowed');$('detail-options-disclosure').open=true;});
    await page.locator('#detail-time-clear').click();
    await page.locator('#detail-habit-option-add').click();
    const specific = page.locator('.habit-option-row .time-endpoint').first();
    await specific.locator('[data-time-mode="relative"]').click();
    await specific.locator('.time-anchor').selectOption('maghrib');
    await specific.locator('.time-offset').fill('15');
    assert.match(await specific.locator('.time-rule-summary').innerText(),/^15 min after /);
    assert.equal(await specific.locator('.time-combine').isVisible(),false,'place options use the same disclosure');

    await page.evaluate(()=>{
      closeSheet('detail-sheet');
      updateSortSetting({blockedTimes:[{label:'Sleep',days:[],start:1320,end:480,startAnchor:'isha'}]},{renderNow:false});
      openHomeCitySettings();
      $('settings-blocked-body').hidden=false;
      $('settings-blocked-head').setAttribute('aria-expanded','true');
    });
    const busy = page.locator('.blocked-endpoint[data-blocked-field="start"]').first();
    assert.equal(await busy.locator('.time-anchor').locator('option').first().textContent(),'— choose an event —');
    assert.match(await busy.locator('.time-rule-summary').innerText(),/^Night$/);
    await busy.locator('.time-advanced > summary').click();
    await busy.locator('.time-anchor').selectOption('sunrise');
    assert.notEqual(await busy.locator('.time-advanced').getAttribute('open'),null,'busy-time changes keep disclosure open');
    await busy.locator('.time-combine').selectOption('later');
    await busy.locator('.time-anchor2').selectOption('fixed');
    await busy.locator('.time-fixed2').fill('20:00');
    await busy.locator('.time-fixed2').dispatchEvent('change');
    assert.equal(await page.evaluate(()=>loadSortSettings().blockedTimes[0].startFixedMin2),1200);
    assert.match(await busy.locator('.time-rule-summary').innerText(),/^Later of Sunrise and /);
    await busy.locator('.time-advanced > summary').click();
    await busy.locator('.time-anchor').selectOption('isha');
    assert.equal(await busy.locator('.time-combine').isVisible(),false,'an intentionally folded busy-time rule stays folded while editing');
    assert.deepEqual(errors,[]);
    console.log('PASS relative rules, city setup, disclosure persistence, four shared contexts and responsive layout');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
