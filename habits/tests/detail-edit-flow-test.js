const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false}));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    const detailOpen=()=>page.evaluate(()=>$('detail-sheet').classList.contains('open') || getPane()?.dataset.activeSheet==='detail-sheet');
    const editName=async name=>{
      await page.locator('#detail-name').click();
      await page.waitForFunction(()=>getSheetInner('detail-sheet').querySelector('.detail-page-tab.on')?.getAttribute('aria-label')==='identity' || detailIsSingleView() || paneTierActive());
      await page.locator('#detail-habit-message').fill(name);
    };
    for(const width of [390,1440]){
      console.log('CHECK detail edit flow at width',width);
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(width=>paneTierActive()===(width>1000),width);
      await page.waitForFunction(()=>!appBackHistoryCleaning);
      await page.evaluate(h=>{closeDetail();save([h]);render();openDetail(0);},baseHabit({hid:'edit-flow',name:'Walk'}));
      await editName('Saved walk');
      await page.locator('#detail-save').click();
      assert.ok(await detailOpen(),'Save keeps the detail card open');
      assert.equal(await page.locator('#detail-name').textContent(),'Saved walk');
      assert.equal(await page.evaluate(()=>load()[0].name),'Saved walk');
      assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').classList.contains('tune-dirty')),false,'save establishes a clean baseline');
      if(width===390)assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').querySelector('.detail-page-tab.on').getAttribute('aria-label')),'identity','Save keeps the current section');

      await editName('Unstored change');
      await page.evaluate(()=>{window.editFlowSave=save;save=()=>false;});
      await page.locator('#detail-save').click();
      await page.evaluate(()=>{save=window.editFlowSave;delete window.editFlowSave;});
      assert.ok(await detailOpen(),'failed Save keeps the editor open');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Unstored change','failed Save keeps the draft');
      assert.equal(await page.evaluate(()=>load()[0].name),'Saved walk','failed Save does not replace saved data');
      await page.locator('#detail-close').click();

      await editName('Discard this');
      await page.locator('#detail-close').click();
      assert.ok(await detailOpen(),'Cancel returns to browsing the same card');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Saved walk','Cancel restores the last save');
      assert.equal(await page.locator('#detail-save').isVisible(),false,'Cancel finishes editing');
      for(const editor of ['name','emoji']){
        await page.evaluate(editor=>{
          if(editor==='name')openDetailNameEditor();else openDetailEmojiEditor();
          handleAppBack();
        },editor);
        await page.waitForTimeout(350);
        assert.ok(await detailOpen(),'cancelling before editor focus keeps the card open');
        assert.equal(await page.evaluate(()=>document.activeElement.matches('#detail-habit-message,#detail-emoji')),false,'cancelled editor never steals focus later');
        assert.equal(await page.locator('#detail-save').isVisible(),false,'delayed focus does not reactivate editing');
      }

      // Restore the current scroll and the user's expanded sections as well.
      const position=await page.evaluate(()=>{
        scrollDetailToNav('schedule','auto');
        $('detail-availability-disclosure').open=true;
        const section=getSheetInner('detail-sheet').querySelector('[data-detail-nav="schedule"]');
        section.scrollTop=100;
        $('detail-time-start').value='09:00';
        $('detail-time-start').dispatchEvent(new Event('input',{bubbles:true}));
        return section.scrollTop;
      });
      await page.locator('#detail-close').click();
      assert.ok(await detailOpen());
      assert.equal(await page.locator('#detail-time-start').inputValue(),'');
      assert.equal(await page.locator('#detail-availability-disclosure').getAttribute('open'),'');
      assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').querySelector('[data-detail-nav="schedule"]').scrollTop),position,'Cancel preserves section scroll');

      await editName('Back draft');
      assert.equal(await page.evaluate(()=>appBackPlan().surface),null,'Back cancels editing without dragging the card away');
      await page.evaluate(()=>handleAppBack());
      assert.ok(await detailOpen(),'first Back cancels the edit');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Saved walk');
      await page.evaluate(()=>handleAppBack());
      assert.equal(await detailOpen(),false,'second Back leaves the card');

      await page.evaluate(()=>openDetail(0));
      await editName('Escape draft');await page.keyboard.press('Escape');
      assert.ok(await detailOpen(),'Escape cancels editing before closing detail');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Saved walk');
      await page.keyboard.press('Escape');assert.equal(await detailOpen(),false);

      await page.evaluate(()=>openDetail(0));await editName('Close draft');
      await page.locator('#detail-habit-message').blur();
      await page.locator('#detail-cool').click();
      assert.ok(await detailOpen(),'Close while dirty cancels the edit first');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Saved walk');

      await editName('Nested draft');
      await page.evaluate(()=>{syncSettingsControls();openSheet('settings-sheet');refreshOpenViews();});
      await page.locator('#settings-close').click();
      assert.ok(await detailOpen(),'nested settings returns to detail');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Nested draft','nested refresh preserves the draft');
      await page.evaluate(()=>{snoozeFromDetail=true;openSnooze(detailIdx);});
      await page.locator('[data-snooze-days="1"]').click();
      assert.ok(await detailOpen(),'applying a snooze returns to detail');
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Nested draft');
      assert.equal(await page.locator('#detail-snooze b').textContent(),'show');
      await page.evaluate(()=>{snoozeFromDetail=true;openSnooze(detailIdx);});
      await page.locator('#snooze-show-now').click();
      assert.ok(await detailOpen());
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Nested draft','unsnooze preserves the draft too');
      await page.locator('#detail-close').click();
      assert.equal(await page.evaluate(()=>load()[0].name),'Saved walk');

      await page.evaluate(()=>{scrollDetailToNav('actions','auto');$('detail-delete').click();});
      await page.evaluate(()=>handleAppBack());
      assert.ok(await detailOpen(),'Back dismisses deletion confirmation before detail');
      assert.equal(await page.locator('#detail-delete-confirm').isVisible(),false);
      assert.equal(await page.evaluate(()=>load().length),1,'cancelling deletion keeps the item');
      await page.evaluate(()=>closeDetail());
      await page.waitForFunction(()=>!appBackHistoryCleaning);
    }

    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>!paneTierActive());
    await page.evaluate(h=>{
      save(normalize([h,{hid:'event-edit',name:'Class',type:'keepup',durationMinutes:60,
        appointment:{repeat:'weekly',startDate:todayIso(),weekdays:[new Date().getDay()],startMinute:540,exceptions:{}}},
        {hid:'phone-edit',source:'device',externalId:'device:1:2',calendarSeriesId:'device:1:3',name:'Phone meeting',type:'task',eventTime:Date.now()+3600000,durationMinutes:60}]));
      openDetail(1);scrollDetailToNav('schedule','auto');
    },baseHabit({hid:'task-edit',name:'Task',type:'task'}));
    await page.selectOption('#detail-appt-scope','date');
    const date=await page.locator('#detail-appt-occurrence').inputValue();
    await page.fill('#detail-appt-time','10:30');
    await page.locator('#detail-close').click();
    assert.ok(await detailOpen(),'event Cancel stays on the card');
    assert.equal(await page.locator('#detail-appt-scope').inputValue(),'date');
    assert.equal(await page.locator('#detail-appt-occurrence').inputValue(),date);
    assert.equal(await page.locator('#detail-appt-time').inputValue(),'09:00','event Cancel restores custom fields');
    await page.fill('#detail-appt-time','10:30');await page.locator('#detail-save').click();
    assert.ok(await detailOpen(),'event Save stays on the card');
    assert.equal(await page.locator('#detail-appt-scope').inputValue(),'date');
    assert.equal(await page.locator('#detail-appt-time').inputValue(),'10:30');
    assert.equal(await page.evaluate(date=>load()[1].appointment.exceptions[date].startMinute,date),630);

    await page.evaluate(()=>{openDetail(2);scrollDetailToNav('identity','auto');});
    await page.selectOption('#detail-calendar-personalization select','occurrence');
    await page.locator('#detail-emoji').fill('📚');await page.locator('#detail-save').click();
    assert.ok(await detailOpen(),'phone calendar Save stays on the card');
    assert.equal(await page.locator('#detail-calendar-personalization select').inputValue(),'occurrence');
    await page.locator('#detail-emoji').fill('🌳');await page.locator('#detail-close').click();
    assert.ok(await detailOpen(),'phone calendar Cancel stays on the card');
    assert.equal(await page.locator('#detail-emoji').inputValue(),'📚');

    // Browser history must treat cancellation as an in-page action as well.
    await page.evaluate(()=>closeDetail());
    await page.waitForFunction(()=>!appBackHistoryCleaning);
    await page.evaluate(()=>openDetail(0));
    await editName('Browser draft');
    await page.goBack();
    await page.waitForFunction(()=>!getSheetInner('detail-sheet').classList.contains('tune-dirty') && !appBackHistoryCleaning);
    assert.ok(await detailOpen(),'browser Back cancels editing without consuming detail history');
    await page.goBack();await page.waitForFunction(()=>!$('detail-sheet').classList.contains('open'));
    await page.goForward();await page.waitForFunction(()=>$('detail-sheet').classList.contains('open'));
    assert.equal(await page.locator('#detail-name').textContent(),'Task','Forward reopens the saved card');
    await page.evaluate(()=>{sortSettings.minimalMode=true;applyAppearanceSettings();openDetail(0);});
    await editName('Minimal draft');await page.locator('#detail-close').click();
    assert.ok(await detailOpen(),'minimal-mode Cancel keeps the card open');
    assert.equal(await page.locator('#detail-habit-message').inputValue(),'Task');
    assert.deepEqual(errors,[]);
    console.log('PASS detail Save/Cancel/Back/Escape, retained sections, nested drafts, snooze, event dates, phone icons and browser history');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
