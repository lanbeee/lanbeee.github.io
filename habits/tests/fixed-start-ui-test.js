const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-13T08:00:00-04:00'));
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE,{waitUntil:'networkidle'});
    await page.evaluate(h=>{save([h]);openDetail(0);scrollDetailToNav('schedule','instant');},
      baseHabit({hid:'class-ui',name:'Class',allowedTimeStart:540,allowedTimeEnd:1020,durationMinutes:60}));
    const kind=page.locator('#detail-time-kind');
    assert.equal(await kind.inputValue(),'window','existing time windows stay flexible');
    await kind.selectOption('fixed');
    assert.equal(await page.locator('#detail-time-end').isVisible(),false,'fixed start needs no end clock');
    await page.locator('#detail-time-start').fill('10:03');
    await page.locator('#detail-save').click();
    let saved=await page.evaluate(()=>load()[0]);
    assert.equal(saved.allowedTimeFixedStart,true);
    assert.equal(saved.allowedTimeStart,603);
    assert.equal(saved.allowedTimeEnd,1020,'mode switch preserves the old end rule');
    await page.evaluate(()=>{openDetail(0);scrollDetailToNav('schedule','instant');});
    assert.equal(await kind.inputValue(),'fixed','saved mode restores');
    assert.ok(await page.locator('#detail-save').isDisabled(),'reopening the fixed start has no spurious edits');
    await kind.selectOption('window');
    assert.equal(await page.locator('#detail-time-end').inputValue(),'17:00','switching back restores the end clock');
    assert.ok(await page.locator('#detail-time-end').isVisible());
    await kind.selectOption('fixed');
    await page.locator('#detail-options-disclosure > summary').click();
    await page.locator('#detail-habit-option-add').click();
    const row=page.locator('.habit-option-row').first();
    assert.equal(await row.locator('.habit-option-time-kind').inputValue(),'fixed','first option inherits fixed start');
    await row.locator('.habit-option-start').fill('14:07');
    assert.equal(await row.locator('.habit-option-end').isVisible(),false);
    await page.locator('#detail-save').click();
    saved=await page.evaluate(()=>load()[0]);
    assert.equal(saved.scheduleOptions[0].fixedStart,true);
    assert.equal(saved.scheduleOptions[0].start,847);
    await page.evaluate(()=>{openDetail(0);scrollDetailToNav('schedule','instant');});
    assert.equal(await row.locator('.habit-option-time-kind').inputValue(),'fixed');
    assert.ok(await page.locator('#detail-save').isDisabled(),'saved fixed row has no spurious edits');
    await row.locator('.habit-option-time-kind').selectOption('window');
    assert.ok(await row.locator('.habit-option-end').isVisible(),'each row can restore its flexible window');
    await row.locator('.habit-option-time-kind').selectOption('fixed');
    await page.locator('#detail-time-clear').click();
    assert.equal(await kind.inputValue(),'window');
    assert.equal(await page.evaluate(()=>currentDetailTune().allowedTimeFixedStart),false,'clear removes general fixed restriction');
    assert.equal(await page.evaluate(()=>currentDetailTune().scheduleOptions[0].fixedStart),true,'clear keeps the independent row');
    await page.locator('#detail-save').click();

    await page.evaluate(()=>{openDetail(0);setMinimalMode(true);$('detail-availability-disclosure').open=true;});
    assert.ok(await kind.isVisible(),'minimal mode supports fixed starts');
    await kind.selectOption('fixed');
    await page.locator('#detail-save').click();
    assert.equal(await page.evaluate(()=>load()[0].allowedTimeFixedStart),false,'blank fixed start is not saved');
    assert.ok(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open') || el.closest('#pane-detail')),'invalid draft remains open');
    await page.locator('#detail-time-start').fill('09:07');
    await page.locator('#detail-save').click();
    saved=await page.evaluate(()=>load()[0]);
    assert.equal(saved.allowedTimeFixedStart,true);
    assert.equal(saved.allowedTimeStart,547);
    await page.evaluate(()=>{
      const h=load()[0];h.allowedTimeEndAnchor='maghrib';save([h]);openDetail(0);
    });
    await page.locator('#detail-habit-message').fill('Class session');
    await page.locator('#detail-save').click();
    assert.equal(await page.evaluate(()=>load()[0].name),'Class session','unused saved end rule does not require city setup for a clock start');
    await page.evaluate(()=>{openDetail(0);$('detail-availability-disclosure').open=true;});
    await page.locator('#detail-time-kind').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/fixed-start-ui.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS fixed-start controls, save/reopen, draft restoration, independent options, clear and minimal mode');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
