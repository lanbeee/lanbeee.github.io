// Mode changes must retain drafts and hidden scheduling policy.
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await (process.env.TEST_BROWSER === 'webkit' ? webkit : chromium).launch();
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
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(h=>{save([h]);openDetail(0);},baseHabit({
      hid:'minimal-fixture',name:'Reading',durationMinutes:30,
      createdAt:Date.parse('2026-09-01T12:00:00-04:00'),lastLog:Date.parse('2026-10-09T12:00:00-04:00'),logs:[Date.parse('2026-10-09T12:00:00-04:00')],
      allowedWeekdays:[1],allowedTimeStart:540,allowedTimeEnd:1020,
      allowedMonthDays:[1,15],preferredWeekdays:[3],preferredTimeStart:600,preferredTimeEnd:660,
      priority:1,earlyWindowDays:2,delayAllowanceDays:1,
      links:[{kind:'web',value:'https://example.com'}]
    }));
    assert.equal(await page.locator('.detail-page-tab.on').innerText(),'summary','minimal detail opens on Summary');
    await page.locator('.detail-page-tab',{hasText:'settings'}).click();
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

    await page.evaluate(()=>closeDetail());
    await page.locator('#open-add').click();
    assert.ok(await page.locator('#ting-duration').isVisible());
    assert.equal(await page.locator('#add-open-defaults').isVisible(),false);
    await page.locator('#ting-message').fill('Walk');
    await page.locator('#ting-duration').fill('25');
    // Compare the settled draft after the existing name/emoji debounce.
    await page.waitForFunction(()=>$('ting-emoji').value === '🚶');
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
    // Summary links reveal advanced controls without changing Minimal Mode or data.
    const beforeNavigation = await page.evaluate(()=>load());
    await page.evaluate(()=>openDetail(0));
    const fields = await page.locator('#detail-summary [data-summary-field]').evaluateAll(nodes=>[...new Set(nodes.map(el=>el.dataset.summaryField))]);
    assert.ok(fields.includes('priority'),'advanced saved settings remain discoverable in Summary');
    for(const field of fields){
      await page.evaluate(()=>scrollDetailToNav('summary','instant'));
      await page.locator(`#detail-summary [data-summary-field="${field}"]`).first().click();
      await page.waitForTimeout(60);
      const target = await page.evaluate(field=>{
        const item=detailSummaryRecord(),session=assistantFocusSummarySession(item);
        const el=getSheetInner('detail-sheet').querySelector(detailSummaryFieldSelector(field,session));
        return {visible:!!el?.getClientRects().length,mode:isMinimalMode(),view:detailMinimalView()};
      },field);
      assert.equal(target.visible,true,`${field} reveals its editor`);
      assert.equal(target.mode,true,'navigation preserves Minimal Mode');
      assert.equal(target.view,'settings','navigation switches to Settings');
    }
    await page.evaluate(()=>scrollDetailToNav('summary','instant'));
    await page.locator('[data-summary-history]').click();
    assert.equal(await page.locator('#detail-calendar').isVisible(),true,'activity reveals the hidden calendar');
    await page.locator('#detail-calendar [data-entry-day]').first().click();
    await page.waitForFunction(()=>$('day-logs-sheet').classList.contains('open'));
    assert.equal(await page.locator('#day-logs-sheet').evaluate(el=>el.classList.contains('open')),true,'revealed calendar can open a day');
    await page.evaluate(()=>{closeDayLogsSheet();closeDetail();openDetail(0);});
    assert.equal(await page.locator('.detail-calendar-page').isVisible(),false,'temporary calendar reveal ends on the next visit');
    assert.deepEqual(await page.evaluate(()=>load()),beforeNavigation,'summary navigation never saves settings or logs');
    await page.evaluate(()=>{closeDetail();const items=load();items[0].planByDate=parseDateInput('2026-12-01');save(items);openDetail(0);});
    const withPlanBy=await page.evaluate(()=>load());
    await page.locator('[data-summary-field="planByDate"]').click();
    assert.equal(await page.locator('#detail-calendar [data-entry-day="2026-12-01"]').isVisible(),true,'plan-by opens the calendar at its saved date');
    await page.evaluate(()=>scrollDetailToNav('summary','instant'));
    await page.locator('[data-summary-history]').click();
    assert.equal(await page.locator('#detail-calendar [data-entry-day="2026-10-11"]').isVisible(),true,'activity returns to recent days');
    assert.deepEqual(await page.evaluate(()=>load()),withPlanBy,'opening the plan-by editor keeps the saved date');
    assert.deepEqual(errors,[]);
    console.log('PASS minimal basics, retained hidden policy, Settings exit and unsaved Add/Details drafts');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
