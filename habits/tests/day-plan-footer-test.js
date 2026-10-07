// A scoped day initially has only a redundant "done" footer. Its hidden
// attribute must not survive into planning, logging, or the overview day menu.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const { baseHabit } = require('./helpers/planner-test-helpers');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  const browser = await playwright[process.env.BROWSER || 'chromium'].launch();
  try{
    for(const viewport of [{width:390,height:568},{width:1440,height:900}]){
      const context = await browser.newContext({viewport});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(h=>{
        localStorage.setItem('tings_v2',JSON.stringify([h]));
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,showWeekOnHome:false,agendaOptimizer:false}));
        // Skip coach pointer interception; use the real calendar interactions.
        localStorage.setItem('tings_coach_install_v2','done');
        localStorage.setItem('tings_coach_essentials_v2','done');
      },baseHabit({hid:'footer-fixture',name:'Footer fixture',target:1}));
      await page.goto(baseUrl,{waitUntil:'networkidle'});

      const assertFooter = async(ids)=>{
        assert.equal(await page.locator('#day-logs-footer').evaluate(el=>el.hidden),false,'active footer clears stale hidden state');
        for(const id of ids){
          const button = page.locator(`#${id}`);
          await button.waitFor({state:'visible'});
          assert.ok(await button.isVisible(),`${id} is visible`);
          const box = await button.boundingBox();
          assert.ok(box && box.y>=0 && box.y+box.height<=viewport.height,`${id} stays inside the viewport`);
          assert.ok(await button.evaluate(el=>{
            const box=el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
          }),`${id} is reachable without scrolling`);
        }
      };
      const openOverviewDay = async()=>{
        const calendar = page.locator('#bar-open-overview:visible, #open-overview:visible').first();
        // Wide layouts keep the calendar permanently mounted in a pane.
        if(!await page.locator('#overview-calendar').isVisible())await calendar.click();
        await page.locator('#overview-calendar .cal-day.today').click();
        await page.locator('#day-logs-sheet.open').waitFor();
      };
      const backTo = async(step)=>{
        await page.waitForFunction(()=>!isScrollGuarded($('day-logs-back-list')));
        await page.locator('#day-logs-back-list').click();
        await page.waitForFunction(step=>dayLogsStep===step,step);
      };

      // Overview-first works in a clean session; back must work as well.
      await openOverviewDay();
      await page.locator('#day-logs-plan').click();
      await assertFooter(['day-logs-back-list','day-log-add']);
      await backTo('list');
      await assertFooter(['day-logs-overview','day-logs-home']);
      await page.locator('#day-logs-home').click();

      // The first scoped opening used to hide the reused footer permanently.
      await page.reload({waitUntil:'networkidle'});
      await page.locator('.ting-card').filter({hasText:'Footer fixture'}).first().click();
      await page.locator('.detail-page-tab[aria-label="history"]').click();
      await page.locator('#detail-calendar .cal-day.today').click();
      await page.locator('#day-logs-sheet.open').waitFor();
      assert.equal(await page.locator('#day-logs-done').isVisible(),false,'scoped item keeps only the header close control');
      await page.locator('#day-logs-plan').click();
      await assertFooter(['day-logs-back-list','day-log-add']);
      await page.locator('#day-log-time').fill('23:30');
      await page.locator('#day-log-add').click();
      const planned = await page.evaluate(()=>load()[0].logs.find(log=>log && log.plan && log.timed));
      assert.ok(planned,'visible add plan button saves a timed plan');
      assert.equal(new Date(planned.ts).getHours(),23);
      assert.equal(new Date(planned.ts).getMinutes(),30);
      assert.equal(await page.locator('#day-logs-done').isVisible(),false,'returning to scoped item hides its redundant done button');
      await page.locator('#day-logs-plan').click();
      await assertFooter(['day-logs-back-list','day-log-add']);
      await backTo('item');
      await page.locator('#day-logs-close').click();
      await page.locator('#detail-cool').click();

      // The same footer node is reused by the main calendar in this session.
      await openOverviewDay();
      await assertFooter(['day-logs-overview','day-logs-home']);
      await page.locator('#day-logs-plan').click();
      await assertFooter(['day-logs-back-list','day-log-add']);
      await backTo('list');
      await page.locator('#day-logs-log').click();
      await assertFooter(['day-logs-back-list','day-log-entry-save']);
      await backTo('list');
      assert.deepEqual(errors,[]);
      console.log(`PASS day plan footer: both entry paths and reused steps at ${viewport.width}×${viewport.height}`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
