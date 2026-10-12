// Mode changes must retain drafts and hidden scheduling policy.
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
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.evaluate(h=>{save([h]);openDetail(0);},baseHabit({
      hid:'minimal-fixture',name:'Reading',durationMinutes:30,
      allowedWeekdays:[1],allowedTimeStart:540,allowedTimeEnd:1020,
      allowedMonthDays:[1,15],preferredWeekdays:[3],preferredTimeStart:600,preferredTimeEnd:660,
      priority:1,earlyWindowDays:2,delayAllowanceDays:1,
      links:[{kind:'web',value:'https://example.com'}]
    }));
    assert.equal(await page.locator('#detail-availability-disclosure').getAttribute('open'),null,'availability starts folded even with saved limits');
    assert.equal(await page.locator('#detail-weekday-chips').isVisible(),false);
    await page.locator('#detail-availability-disclosure > summary').click();
    await page.evaluate(()=>applyAppearanceSettings());
    assert.ok(await page.locator('#detail-weekday-chips').isVisible(),'appearance refresh preserves the expanded section');
    assert.ok(await page.locator('#detail-time-start').isVisible());
    assert.ok(await page.locator('#detail-duration').isVisible());
    for(const id of ['detail-monthday-toggle','detail-schedule-view-seg','detail-place-chips','detail-link-add','detail-priority-seg']){
      assert.equal(await page.locator('#'+id).isVisible(),false,id+' stays in regular mode');
    }
    assert.ok(await page.locator('#detail-link-actions').isVisible(),'saved links stay usable');
    const note = page.locator('#detail-regular-mode');
    assert.ok(await note.isVisible(),'a quiet settings note sits in the last section');
    assert.match(await note.innerText(),/More options in\s+settings/i);
    const actionsBox = await page.locator('#detail-actions-disclosure').boundingBox();
    const noteBox = await note.boundingBox();
    assert.ok(noteBox.y>=actionsBox.y,'the note lives in item actions');
    await page.locator('#detail-weekday-chips [data-weekday="2"]').click();
    await page.locator('#detail-time-start').fill('10:00');
    await page.locator('#detail-duration').fill('45');
    const tune = await page.evaluate(()=>currentDetailTune());
    await note.click();
    assert.equal(await page.evaluate(()=>$('settings-sheet').classList.contains('open')),true,'the note opens Settings');
    assert.equal(await page.evaluate(()=>loadSortSettings().minimalMode),true,'the note does not switch mode itself');
    assert.ok(await page.locator('[data-setting-toggle="minimalMode"]').isVisible(),'Minimal Mode is on screen');
    await page.locator('[data-setting-toggle="minimalMode"]').click();
    assert.equal(await page.evaluate(()=>loadSortSettings().minimalMode),false,'the Settings switch is persisted');
    assert.deepEqual(await page.evaluate(()=>currentDetailTune()),tune,'switch retains every unsaved field');
    await page.locator('#settings-close').click();
    assert.ok(await page.locator('#detail-save').isEnabled());
    assert.ok(await page.locator('#detail-schedule-view-seg').isVisible(),'leaving Settings stays on Details');
    await page.evaluate(()=>{setScheduleView('preferred');setMinimalMode(true);});
    assert.equal(await page.locator('#detail-availability-disclosure').getAttribute('open'),null,'entering minimal mode folds availability');
    await page.locator('#detail-availability-disclosure > summary').click();
    assert.ok(await page.locator('#detail-weekday-chips').isVisible(),'expanding shows allowed hours rather than Preferred');
    assert.deepEqual(await page.evaluate(()=>currentDetailTune()),tune,'switching back retains advanced policy');
    await page.locator('#detail-save').click();
    const saved = await page.evaluate(()=>load()[0]);
    assert.deepEqual(saved.allowedWeekdays,[1,2]);
    assert.equal(saved.allowedTimeStart,600);
    assert.equal(saved.durationMinutes,45);
    assert.deepEqual(saved.allowedMonthDays,[1,15]);
    assert.deepEqual(saved.preferredWeekdays,[3]);
    assert.equal(saved.preferredTimeStart,600);
    assert.equal(saved.priority,1);
    assert.equal(saved.earlyWindowDays,2);
    assert.deepEqual(saved.links,tune.links);

    await page.locator('#open-add').click();
    assert.ok(await page.locator('#ting-duration').isVisible());
    assert.equal(await page.locator('#add-open-defaults').isVisible(),false);
    await page.locator('#ting-message').fill('Walk');
    await page.locator('#ting-duration').fill('25');
    const draft = await page.evaluate(()=>readAddRecord());
    await page.locator('#add-regular-mode').click();
    assert.equal(await page.evaluate(()=>$('settings-sheet').classList.contains('open')),true,'Add also opens Settings');
    assert.deepEqual(await page.evaluate(()=>readAddRecord()),draft,'Add retains its draft through Settings');
    await page.locator('[data-setting-toggle="minimalMode"]').click();
    await page.locator('#settings-close').click();
    assert.ok(await page.locator('#add-more-toggle').isVisible(),'regular Add chrome returns after Settings');
    await page.locator('#add-more-toggle').click();
    assert.ok(await page.locator('#ting-duration').isVisible(),'duration remains in the main flow');
    await page.evaluate(()=>setMinimalMode(true));
    assert.deepEqual(await page.evaluate(()=>readAddRecord()),draft);
    assert.ok(await page.locator('#ting-duration').isVisible());
    await page.locator('#type-seg [data-v="task"]').click();
    assert.ok(await page.locator('#ting-due-date').isVisible(),'minimal task retains deadline');
    await page.locator('#do-cancel').click();
    assert.equal(await page.evaluate(()=>load().length),1,'mode switching never saves a draft');
    assert.deepEqual(errors,[]);
    console.log('PASS minimal basics, retained hidden policy, Settings exit and unsaved Add/Details drafts');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
