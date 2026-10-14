const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-13T09:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,defaultType:'reduce',themeMode:'light'}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE,{waitUntil:'networkidle'});
    await page.locator('#open-add').click();
    assert.equal(await page.locator('[data-add-repeat="opportunity"]').isVisible(),false,'a limit habit cannot silently become a build habit');
    assert.equal(await page.evaluate(()=>readAddRecord().type),'reduce');
    await page.locator('#do-cancel').click();

    const task = baseHabit({hid:'flow-task',name:'Book a visit',type:'task',dueDate:null,eventTime:null});
    for(const width of [390,1280,320]){
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(250); // Let the shell finish moving permanent panes.
      for(const minimal of [false,true]){
        await page.evaluate(({task,minimal})=>{save([task]);setMinimalMode(minimal);openDetail(0);scrollDetailToNav('schedule');},{task,minimal});
        assert.ok(await page.locator('#detail-due-time').isDisabled(),'undated task cannot collect an ignored clock');
        assert.equal(await page.locator('label[for="detail-due-time"]').textContent(),'Start time (optional)');
        const taskDraft = await page.evaluate(()=>currentDetailTune());
        if(!minimal){
          await page.evaluate(()=>{
            const entry = detailSearchEntries().find(e=>e.target.id==='detail-due-time');
            revealDetailSearchEntry(entry);
          });
          await page.waitForFunction(()=>document.activeElement.id==='detail-due-date');
          assert.ok(await page.locator('#detail-due-time').isDisabled(),'finding start time explains its prerequisite');
          await page.locator('#detail-due-date').blur();
          await page.locator('#toast-close').click();
        }
        const clipped = await page.locator('#detail-due-row').evaluate(row=>{
          const box=row.getBoundingClientRect();
          return [...row.querySelectorAll('input')].flatMap(el=>{
            const r=el.getBoundingClientRect();return r.left<box.left-1 || r.right>box.right+1
              ? [{id:el.id,left:r.left,right:r.right,bounds:[box.left,box.right]}] : [];
          });
        });
        assert.deepEqual(clipped,[],`date and clock fit ${width}px in ${minimal ? 'minimal' : 'regular'} mode`);
        if(width===390)await page.screenshot({path:`test-results/mode-flow-task-${minimal?'minimal':'regular'}.png`,animations:'disabled'});
        await page.locator('#detail-due-date').fill('2026-10-14');
        assert.ok(await page.locator('#detail-due-time').isEnabled());
        await page.locator('#detail-due-time').fill('10:30');
        await page.locator('#detail-due-date').fill('');
        assert.equal(await page.locator('#detail-due-time').inputValue(),'');
        assert.ok(await page.locator('#detail-due-time').isDisabled());
        assert.deepEqual(await page.evaluate(()=>currentDetailTune()),taskDraft,'returning to undated restores the original draft');
        assert.ok(await page.locator('#detail-save').isDisabled(),'reverting task dates leaves no spurious unsaved edit');
        await page.evaluate(()=>closeDetail());
      }
    }
    await page.setViewportSize({width:390,height:844});

    // Older/imported appointments need no separate stored due-date field.
    for(const minimal of [false,true]){
      const appointment = await page.evaluate(({task,minimal})=>{
        const eventTime=dayStart(Date.now())+10*3600000;
        save([{...task,eventTime}]);setMinimalMode(minimal);openDetail(0);scrollDetailToNav('schedule');
        return {eventTime,date:dateInputValue(eventTime)};
      },{task,minimal});
      assert.equal(await page.locator('#detail-due-date').inputValue(),appointment.date,'an event-only appointment supplies its existing date');
      assert.equal(await page.locator('#detail-due-time').inputValue(),'10:00');
      assert.ok(await page.locator('#detail-due-time').isEnabled());
      assert.ok(await page.locator('#detail-save').isDisabled(),'opening a legacy appointment is clean');
      await page.evaluate(()=>scrollDetailToNav('identity'));
      await page.locator('#detail-habit-message').fill('Booked visit');
      await page.locator('#detail-save').click();
      assert.equal(await page.evaluate(()=>load()[0].eventTime),appointment.eventTime,'renaming preserves the appointment');
    }

    const optional = baseHabit({hid:'flow-optional',name:'Optional walk',repeatMode:'opportunity',weatherProfileMode:'profile',weatherProfileId:'dry'});
    for(const type of ['task','zero']){
      await page.evaluate(({task,type})=>{setMinimalMode(false);save([{...task,type}]);openDetail(0);},{task,type});
      const before=await page.evaluate(()=>currentDetailTune());
      await page.evaluate(()=>revealDetailSearchEntry(detailSearchEntries().find(e=>e.target.id==='detail-times')));
      await page.waitForFunction(()=>document.activeElement.closest('#detail-rhythm-disclosure'));
      assert.equal(await page.locator('#detail-times').isVisible(),false,'search does not enable an inapplicable frequency');
      assert.match(await page.locator('#toast-text').textContent(),type==='zero' ? /build or limit/ : /Choose Habit/);
      assert.deepEqual(await page.evaluate(()=>currentDetailTune()),before,'prerequisite navigation preserves the item');
      await page.locator('#toast-close').click();
      await page.evaluate(()=>closeDetail());
    }
    for(const width of [390,1280]){
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(250);
      await page.evaluate(h=>{
        setMinimalMode(false);
        updateSortSetting({weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:30}]}]});
        save([h]);openDetail(0);
      },optional);
      const entries = await page.evaluate(()=>detailSearchEntries().map(e=>({id:e.target.id,label:e.label})));
      assert.ok(entries.some(e=>e.id==='detail-days' && /repeat limit/i.test(e.label)),'optional frequency has its own search label');
      for(const id of ['detail-times','detail-early-window','detail-delay-allowance','detail-flexibility-disclosure']){
        assert.ok(!entries.some(e=>e.id===id),'inapplicable optional control omitted: '+id);
      }
      assert.ok(!entries.some(e=>e.label==='Place preferences'),'conditional places cannot lead search to a preference-only view');

      // Setup edits can change validity without changing the item draft itself.
      await page.evaluate(()=>{
        updateSortSetting({weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability'}]}]});
        scrollDetailToNav('identity');
      });
      await page.locator('#detail-habit-message').fill('Optional walk edited');
      assert.ok(await page.locator('#detail-save').isDisabled(),'inactive weather is not a trigger');
      const draft = await page.evaluate(()=>currentDetailTune());
      await page.evaluate(()=>{
        updateSortSetting({weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:30}]}]});
        openSheet('settings-sheet');closeSettingsSheet();
      });
      assert.deepEqual(await page.evaluate(()=>currentDetailTune()),draft,'returning from setup preserves the edit');
      assert.ok(await page.locator('#detail-save').isEnabled(),'valid weather setup re-enables the staged edit');
      await page.evaluate(()=>{
        updateSortSetting({weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability'}]}]});
        openSheet('settings-sheet');closeSettingsSheet();
      });
      assert.ok(await page.locator('#detail-save').isDisabled(),'removing the last trigger disables the staged edit');
      await page.evaluate(()=>closeDetail());
    }
    assert.deepEqual(errors,[]);
    console.log('PASS cross-mode task dates, habit kind, optional search and setup-return validation');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
