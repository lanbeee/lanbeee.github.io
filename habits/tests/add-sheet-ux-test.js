// First-item flow, frequency/date shortcuts, draft navigation and responsive controls.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-10-31T12:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,defaultType:'keepup',defaultTarget:7}));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.locator('#open-add').click();
    assert.equal(await page.locator('#add-more-options').isVisible(),false);
    assert.equal(await page.locator('#add-open-defaults').isVisible(),false);
    assert.ok(await page.locator('#ting-duration').isVisible(),'session duration is a core field');
    assert.equal(await page.locator('#do-save').textContent(),'add habit');
    await page.locator('#ting-message').fill('Read a book');
    await page.locator('#ting-message').press('Enter');
    assert.equal(await page.evaluate(()=>load().length),0,'keyboard Done finishes the field without creating an unfinished item');
    assert.ok(await page.locator('#ting-message').isVisible());
    await page.locator('[data-add-rhythm="3,7"]').click();
    assert.equal(await page.locator('#target-help').textContent(),'Aim for 3 times a week.');
    assert.equal(await page.evaluate(()=>readAddRecord().target),7/3);
    assert.equal(await page.locator('[data-add-rhythm="3,7"]').getAttribute('aria-pressed'),'true');
    await page.locator('#ting-days').focus();
    assert.equal(await page.locator('#ting-days').inputValue(),'','focusing a frequency field clears it for editing');
    await page.locator('#ting-days').blur();
    assert.equal(await page.locator('#ting-days').inputValue(),'7','leaving without typing restores the frequency');
    await page.locator('#ting-days').fill('10');
    await page.locator('#ting-days').blur();
    assert.equal(await page.locator('#target-help').textContent(),'Aim for 3 times every 10 days.');
    assert.equal(await page.locator('[data-add-rhythm="3,7"]').getAttribute('aria-pressed'),'false');
    await page.locator('#ting-duration').fill('25');
    await page.locator('#type-seg [data-v="task"]').click();
    assert.equal(await page.locator('#type-seg [data-v="task"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#add-frequency').isVisible(),false);
    assert.equal(await page.locator('#do-save').textContent(),'add task');
    await page.locator('[data-add-due="tomorrow"]').click();
    assert.equal(await page.locator('#ting-due-date').inputValue(),'2026-11-01','tomorrow handles month and DST boundaries');
    await page.locator('#ting-due-time').fill('09:30');
    assert.ok(await page.evaluate(()=>readAddRecord().eventTime !== null),'fixed start is saved as an appointment');
    await page.locator('[data-add-due="none"]').click();
    assert.equal(await page.locator('#ting-due-time').inputValue(),'');
    assert.ok(await page.locator('#ting-due-time').isDisabled());
    assert.equal(await page.evaluate(()=>readAddRecord().eventTime),null);
    await page.locator('[data-add-due="today"]').click();
    assert.equal(await page.locator('#ting-due-date').inputValue(),'2026-10-31');
    assert.ok(await page.locator('#ting-due-time').isEnabled());
    await page.locator('#type-seg [data-v="keepup"]').click();
    assert.equal(await page.locator('#ting-days').inputValue(),'10');
    assert.equal(await page.locator('#ting-times').inputValue(),'3');
    assert.equal(await page.locator('#ting-duration').inputValue(),'25','type switches preserve independent drafts');
    await page.locator('#add-more-toggle').click();
    assert.equal(await page.locator('#ting-priority-seg [data-priority="2"]').textContent(),'normal');
    await page.locator('#ting-priority-seg [data-priority="1"]').click();
    assert.equal(await page.evaluate(()=>readAddRecord().priority),1);
    assert.equal(await page.locator('.add-weather-options').getAttribute('open'),null);
    await page.locator('.add-weather-options > summary').click();
    await page.locator('#ting-show-weather').click();
    await page.locator('#add-open-defaults').click();
    await page.locator('#settings-close').click();
    assert.equal(await page.locator('#ting-message').inputValue(),'Read a book');
    assert.equal(await page.locator('#ting-duration').inputValue(),'25');
    assert.ok(await page.locator('#ting-show-weather').isVisible(),'settings return retains nested disclosure state');
    assert.equal(await page.locator('#ting-show-weather').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>setMinimalMode(true));
    assert.ok(await page.locator('#ting-duration').isVisible());
    assert.equal(await page.locator('#add-more-toggle').isVisible(),false);
    assert.equal(await page.locator('#ting-duration').inputValue(),'25');
    await page.evaluate(()=>setMinimalMode(false));
    await page.locator('#do-save').click();
    const saved = await page.evaluate(()=>load().find(item=>item.name === 'Read a book'));
    assert.equal(saved.target,10/3);
    assert.equal(saved.durationMinutes,25);
    assert.equal(saved.priority,1);
    assert.equal(saved.showWeather,true);
    await page.evaluate(()=>closeDetail());

    // Short phones, large text, assistant button and wide panes must keep all
    // core controls inside the sheet. Optional panels stay independently usable.
    let layouts = 0;
    for(const width of [320,393,1100]){
      await page.setViewportSize({width,height:740});
      await page.waitForTimeout(300); // allow responsive pane transitions
      for(const minimal of [false,true]){
        await page.evaluate(minimal=>{
          updateSortSetting({fontScale:'large',assistantEnabled:true},{renderNow:false});
          setMinimalMode(minimal);
          applyAddDefaults();openSheet('add-sheet');
          document.body.classList.add('assistant-on');
        },minimal);
        if(width === 393){
          const selectors = ['[data-add-rhythm="1,1"]','[data-add-rhythm="3,7"]','[data-add-rhythm="1,7"]',...(minimal ? [] : ['[data-add-repeat="opportunity"]'])];
          if(minimal)assert.equal(await page.locator('[data-add-repeat="opportunity"]').isVisible(),false,'minimal add hides when conditions fit');
          for(const selector of selectors){
            await page.locator(selector).click();
            const fits = await page.locator('#add-frequency .add-presets').evaluate(row=>{
              const boxes=[...row.children].filter(button=>!button.hidden).map(button=>button.getBoundingClientRect());
              const bounds=row.getBoundingClientRect();
              return boxes.every(box=>Math.abs(box.top-boxes[0].top)<1 && box.left>=bounds.left && box.right<=bounds.right+1 && box.height>=44 && box.width>=44);
            });
            assert.ok(fits,`all rhythm choices fit one row at 393, minimal=${minimal}, selected=${selector}`);
          }
          await page.locator('[data-add-rhythm="1,7"]').click();
        }
        for(const task of [false,true]){
          await page.evaluate(task=>switchAddType(task ? 'task' : 'keepup'),task);
          await page.waitForTimeout(250);
          const ids = ['ting-message','ting-emoji-preview','ting-ask-ai','ting-duration','do-save','do-cancel',...(task ? ['ting-due-date','ting-due-time'] : ['ting-times','ting-days'])];
          for(const id of ids){
            const control = page.locator('#'+id);
            assert.ok(await control.isVisible(),`${id} visible at ${width}, minimal=${minimal}, task=${task}`);
            const fits = await control.evaluate(element=>{
              const box = element.getBoundingClientRect();
              const sheet = element.closest('.add-sheet').getBoundingClientRect();
              return box.left >= sheet.left && box.right <= sheet.right + 1;
            });
            assert.ok(fits,`${id} fits at ${width}, minimal=${minimal}, task=${task}`);
          }
          layouts++;
        }
      }
      await page.locator('#do-cancel').click();
    }
    await page.setViewportSize({width:393,height:852});
    await page.waitForFunction(()=>document.body.dataset.paneCount === '1');
    for(const minimal of [false,true]){
      await page.evaluate(minimal=>{setMinimalMode(minimal);openDetail(0);scrollDetailToNav('schedule');},minimal);
      const selectors = ['[data-detail-rhythm="1,1"]','[data-detail-rhythm="3,7"]','[data-detail-rhythm="1,7"]',...(minimal ? [] : ['[data-detail-repeat="opportunity"]'])];
      if(minimal)assert.equal(await page.locator('[data-detail-repeat]').isVisible(),false,'minimal detail hides when conditions fit');
      for(const selector of selectors){
        await page.locator(selector).click();
        assert.ok(await page.locator('#detail-frequency-presets').evaluate(row=>{
          const boxes=[...row.children].filter(button=>!button.hidden).map(button=>button.getBoundingClientRect());
          const bounds=row.getBoundingClientRect();
          return boxes.every(box=>Math.abs(box.top-boxes[0].top)<1 && box.left>=bounds.left && box.right<=bounds.right+1 && box.height>=44 && box.width>=44 && buttonFits(box));
          function buttonFits(box){return box.right<=innerWidth;}
        }),`Schedule rhythm choices fit one row at 393, minimal=${minimal}, selected=${selector}`);
      }
      await page.evaluate(()=>closeDetail());
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS add flow, custom frequencies, date shortcuts, draft preservation, persisted settings and ${layouts} responsive layouts`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
