// Real taps/keystrokes: replace initial numbers, retain untouched values and
// keep compact/log fields legible in both themes and narrow/wide layouts.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch();
  try{
    let checked = 0;
    for(const width of [320,390,1100]){
      const context = await browser.newContext({viewport:{width,height:844},hasTouch:true,serviceWorkers:'block'});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{
        localStorage.clear();
        localStorage.setItem('tings_coach_essentials_v2','done');
        localStorage.setItem('tings_coach_install_v2','done');
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false,fontScale:'large'}));
      });
      await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
      await page.waitForFunction(()=>typeof openValueLogSheet==='function');
      const tap = async selector=>page.locator(selector).tap();
      const type = async text=>page.keyboard.type(text);
      const legible = async selector=>{
        const measurements = await page.locator(selector).last().evaluate(e=>{
          const s = getComputedStyle(e);
          const box = e.getBoundingClientRect();
          const contentHeight = e.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
          const textWidth = ctx.measureText(e.value || '100').width;
          return {font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight) || parseFloat(s.fontSize)*1.2,contentHeight,
            contentWidth:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),textWidth,
            left:box.left,right:box.right,foreground:s.color,background:s.backgroundColor};
        });
        assert.ok(measurements.font>=16,`${selector}: readable font`);
        assert.ok(measurements.contentHeight>=measurements.line,`${selector}: line fits height ${JSON.stringify(measurements)}`);
        assert.ok(measurements.contentWidth>=measurements.textWidth,`${selector}: digits fit width ${JSON.stringify(measurements)}`);
        assert.ok(measurements.left>=0 && measurements.right<=width,`${selector}: inside viewport`);
        assert.notEqual(measurements.foreground,measurements.background);
        checked++;
      };
      await page.evaluate(()=>{applyAddDefaults();openSheet('add-sheet');});
      await tap('#ting-times');await type('3');
      assert.equal(await page.locator('#ting-times').inputValue(),'3','first tap replaces 1 rather than appending');
      await page.locator('#ting-times').blur();await tap('#ting-times');await type('6');
      assert.equal(await page.locator('#ting-times').inputValue(),'6','refocus replaces the edited number');
      await page.keyboard.press('Backspace');
      assert.equal(await page.locator('#ting-times').inputValue(),'','backspace can clear the field without forcing 1');
      await type('2');
      await tap('#ting-days');await type('14');
      assert.equal(await page.locator('#ting-days').inputValue(),'14','multi-digit typing appends after first replacement');
      await tap('#ting-duration');await type('60');
      assert.equal(await page.locator('#ting-duration').inputValue(),'60','number inputs replace too');
      await page.locator('#ting-duration').blur();await tap('#ting-duration');
      await page.locator('#ting-duration').blur();
      assert.equal(await page.locator('#ting-duration').inputValue(),'60','untouched focus retains number');
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        for(const id of ['ting-times','ting-days','ting-duration'])await legible('#'+id);
      }
      await page.locator('#do-cancel').click();
      await page.evaluate(h=>{save([h]);openDetail(0);scrollDetailToNav('schedule','auto');},baseHabit({hid:'number-exercise',name:'Exercise',trackValue:true,target:7/3,durationMinutes:45,autoMarkMinutes:12,timerAutoStopMinutes:20}));
      await tap('#detail-times');await page.locator('#detail-times').blur();
      assert.equal(await page.locator('#detail-times').inputValue(),'3','viewing an existing frequency keeps it');
      await tap('#detail-days');await page.locator('#detail-days').blur();
      assert.equal(await page.locator('#detail-days').inputValue(),'7','viewing period keeps it');
      await page.locator('#detail-availability-disclosure > summary').click();
      const endpoint=page.locator('#detail-allowed-time-row .time-endpoint').first();
      await endpoint.locator('[data-time-mode="relative"]').click();
      await endpoint.locator('.time-offset').fill('30');
      await endpoint.locator('.time-offset').blur();
      await endpoint.locator('.time-offset').tap();await type('6');
      assert.equal(await endpoint.locator('.time-offset').inputValue(),'6','dynamic number input replaces offset');
      await legible('#detail-allowed-time-row .time-endpoint:first-child .time-offset');
      await page.evaluate(()=>{
        $('detail-duration').closest('details').open=true;
        scrollDetailToNav('effort','auto');
      });
      await tap('#detail-duration');await page.locator('#detail-duration').blur();
      assert.equal(await page.locator('#detail-duration').inputValue(),'45','detail focus does not reset duration');
      await tap('#detail-duration');await type('90');
      assert.equal(await page.locator('#detail-duration').inputValue(),'90');
      await legible('#detail-duration');
      await page.locator('#detail-logging-disclosure > summary').click();
      await tap('#detail-auto-mark');await page.locator('#detail-auto-mark').blur();
      assert.equal(await page.locator('#detail-auto-mark').inputValue(),'12','viewing optional auto-completion does not clear it');
      await tap('#detail-timer-auto-stop');await page.locator('#detail-timer-auto-stop').blur();
      assert.equal(await page.locator('#detail-timer-auto-stop').inputValue(),'20','viewing session target retains it');
      await tap('#detail-timer-auto-stop');await type('120');
      await legible('#detail-timer-auto-stop');
      await page.evaluate(()=>{closeDetail();openValueLogSheet(0);});
      await page.waitForFunction(()=>document.activeElement.id==='value-log-input');
      await type('72.5');
      await page.locator('#value-log-input').blur();await tap('#value-log-input');await type('-6.25');
      assert.equal(await page.locator('#value-log-input').inputValue(),'-6.25','signed decimals replace and stay intact');
      await page.keyboard.press('End');await type('0');
      assert.equal(await page.locator('#value-log-input').inputValue(),'-6.250','arrow/End allows editing the existing number');
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await legible('#value-log-input');await legible('#value-log-note');
        const fraction=await page.locator('#value-log-input').evaluate(e=>e.clientWidth/e.closest('.value-log-field').clientWidth);
        assert.ok(fraction>.95,'log input uses the full field width');
      }
      await page.locator('#value-log-note').fill('Exercise metric');
      await page.locator('#value-log-save').click();
      const entry=await page.evaluate(()=>load()[0].logs.at(-1));
      assert.equal(entry.value,-6.25);assert.equal(entry.note,'Exercise metric');
      await page.evaluate(()=>{
        resetSettingsSheetState();syncSettingsControls();openSheet('settings-sheet');
      });
      await page.locator('#settings-defaults-head').click();
      await tap('#setting-default-times');await type('6');
      assert.equal(await page.locator('#setting-default-times').inputValue(),'6','settings fields share replacement behavior');
      await tap('#setting-default-days');await type('14');
      await legible('#setting-default-times');await legible('#setting-default-days');
      await page.locator('#settings-weather-head').click();
      await page.locator('#weather-profile-add').click();
      await page.locator('[data-weather-rule-add]').last().click();
      const weather=page.locator('[data-weather-rule-min]').last();
      await weather.fill('12');await weather.blur();await weather.tap();await type('3.5');
      assert.equal(await weather.inputValue(),'3.5','dynamically mounted decimal setting replaces the old bound');
      await legible('[data-weather-rule-min]');
      await page.locator('#settings-close').click();
      await page.evaluate(()=>{openSheet('snooze-sheet');$('snooze-hours').value='8';});
      await tap('#snooze-hours');await type('6');
      assert.equal(await page.locator('#snooze-hours').inputValue(),'6');await legible('#snooze-hours');
      await page.evaluate(()=>{closeSheet('snooze-sheet');renderDayLogsAvailStep(dateKey(Date.now()));openSheet('day-logs-sheet');});
      await tap('#day-availability-minutes');await type('120');
      assert.equal(await page.locator('#day-availability-minutes').inputValue(),'120');await legible('#day-availability-minutes');
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log(`PASS numeric replacement, untouched values, continued editing, decimal logging and ${checked} field layout checks`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
