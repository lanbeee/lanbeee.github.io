// Swipe shortcuts reuse existing writes; action-strip pans never activate them.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},
      isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-10-12T08:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,
        showWeekOnHome:false,agendaOptimizer:false,blockedTimes:[],locations:[
          {id:'home',name:'Home',lat:40,lng:-74}]}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.evaluate(habits=>{save(habits);render();},[
      baseHabit({hid:'swipe-main',name:'Read',target:1,pinned:true,
        locationIds:['home'],links:[{kind:'web',value:'https://example.com/primary'},
          {kind:'web',value:'https://example.com/other'}]}),
      baseHabit({hid:'swipe-sample',name:'Try reading',target:1,sample:true,pinned:true,
        links:[{kind:'phone',value:'+12125550123'}]}),
      baseHabit({hid:'swipe-zero',name:'Avoid',type:'zero',target:1,pinned:true})
    ]);
    const client = await context.newCDPSession(page);
    const row = hid=>page.locator(`#list .swipe-row[data-hid="${hid}"]`).first();
    async function drag(x,y,dx){
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let i=1;i<=12;i++){
        await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/12,y,id:1}]});
        await page.waitForTimeout(16);
      }
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(260);
    }
    async function swipe(hid,dir){
      await page.evaluate(()=>closeAllSwipes());
      await page.waitForTimeout(220);
      await row(hid).scrollIntoViewIfNeeded();
      const box = await row(hid).boundingBox();
      await drag(box.x+box.width/2,box.y+box.height/2,dir*90);
      assert.equal(await row(hid).getAttribute('data-swipe-open'),String(dir));
    }
    const actions = (hid,side)=>row(hid).locator(`.swipe-actions-${side} .swipe-action`)
      .evaluateAll(buttons=>buttons.map(b=>b.dataset.action));
    async function activate(hid,dir,action){
      await swipe(hid,dir);
      await row(hid).locator(`.swipe-action[data-action="${action}"]`).click();
    }
    assert.deepEqual(await actions('swipe-main','left'),['timer','plan','activity','open-link']);
    assert.deepEqual(await actions('swipe-main','right'),['snooze','pin','nuke']);
    assert.deepEqual(await actions('swipe-sample','left'),['timer','plan','activity','open-link','keep']);
    assert.deepEqual(await actions('swipe-zero','left'),['activity']);
    assert.equal(await page.locator('.swipe-action[data-action="log"],.swipe-action[data-action="edit"],.swipe-action[data-action="share"]').count(),0);
    assert.equal(await row('swipe-main').locator('.swipe-actions').evaluateAll(p=>p.every(a=>a.inert)),true);
    await row('swipe-main').locator('.swipe-action').first().evaluate(button=>button.focus());
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('swipe-action')),false,'hidden buttons cannot receive focus');

    await page.evaluate(()=>{
      window.launchedLinks=[];
      window.savedOpenHabitLink=openHabitLink;
      openHabitLink=link=>{launchedLinks.push(link);return true;};
    });
    await activate('swipe-main',1,'open-link');
    assert.equal(await page.evaluate(()=>launchedLinks[0].value),'https://example.com/primary');
    assert.equal(await row('swipe-sample').locator('[data-action="open-link"]').innerText(),'call');
    await page.evaluate(()=>{openHabitLink=savedOpenHabitLink;});

    const logsBefore = await page.evaluate(()=>load()[0].logs);
    await page.evaluate(()=>document.querySelector('[data-hid="swipe-main"]').dataset.dayBase=String(dayStart(Date.now())+86400000));
    await activate('swipe-main',1,'plan');
    assert.equal(await page.locator('#day-log-date').inputValue(),'2026-10-13','agenda day seeds the form');
    assert.deepEqual(await page.evaluate(()=>load()[0].logs),logsBefore,'opening writes nothing');
    await page.locator('#day-log-date').fill('2026-10-11');
    assert.equal(await page.locator('#day-log-add').isDisabled(),true,'past dates cannot be planned');
    await page.locator('#day-log-date').fill('2026-10-14');
    await page.locator('#day-log-time').fill('09:30');
    await page.locator('#day-log-location').selectOption('home');
    await page.locator('#day-log-add').click();
    const planned = await page.evaluate(()=>load()[0].logs.find(isPlanLog));
    assert.equal(new Date(planned.ts).toISOString(),'2026-10-14T13:30:00.000Z');
    assert.equal(planned.locationId,'home');
    assert.equal(planned.timed,true);
    await page.locator('#action-undo').click();
    assert.deepEqual(await page.evaluate(()=>load()[0].logs),logsBefore,'plan uses existing undo');
    await page.evaluate(()=>{closeDayLogsSheet();openDetailCalendar(0);});
    await page.locator('#detail-calendar [data-entry-day="2026-10-13"]').click();
    await page.locator('#day-logs-plan').click();
    assert.equal(await page.locator('#day-log-date').count(),0,'calendar entry keeps its original form');
    await page.evaluate(()=>{closeDayLogsSheet();closeSheet('detail-sheet');
      document.querySelector('[data-hid="swipe-main"]').dataset.dayBase=String(dayStart(Date.now())-86400000);});
    await activate('swipe-main',1,'plan');
    assert.equal(await page.locator('#day-log-date').inputValue(),'2026-10-12','past card defaults to today');
    await page.locator('#day-logs-close').click();
    assert.deepEqual(await page.evaluate(()=>load()[0].logs),logsBefore,'cancelling writes nothing');
    await activate('swipe-main',-1,'pin');
    assert.equal(await page.evaluate(()=>load()[0].pinned),false);
    assert.equal(await row('swipe-main').locator('.swipe-action[data-action="pin"]').innerText(),'pin','pin label refreshes without a changed agenda');
    await activate('swipe-main',-1,'pin');
    assert.equal(await page.evaluate(()=>load()[0].pinned),true);

    await page.evaluate(()=>setMinimalMode(true));
    assert.deepEqual(await actions('swipe-main','left'),['plan','activity']);
    assert.deepEqual(await actions('swipe-main','right'),['snooze','nuke']);
    assert.deepEqual(await actions('swipe-sample','left'),['keep','activity']);
    await activate('swipe-main',1,'activity');
    assert.equal(await page.locator('#activity-sheet').evaluate(el=>el.classList.contains('open')),true);
    await page.evaluate(()=>{closeSheet('activity-sheet');saveSortSettings({...sortSettings,showSnoozed:true});render();});
    await activate('swipe-main',-1,'snooze');
    await page.locator('[data-snooze-hours="1"]').click();
    assert.equal(await page.evaluate(()=>habitIsSnoozed(load()[0])),true,'minimal Snooze uses the existing options');
    await row('swipe-main').locator('.swipe-action[data-action="unsnooze"]').waitFor({state:'attached'});
    assert.deepEqual(await actions('swipe-main','right'),['unsnooze','nuke']);
    await activate('swipe-main',-1,'unsnooze');
    assert.equal(await page.evaluate(()=>habitIsSnoozed(load()[0])),false,'Show clears the snooze immediately');
    await page.evaluate(()=>{setMinimalMode(false);startHabitTimer(1);setMinimalMode(true);});
    assert.deepEqual(await actions('swipe-sample','left'),['timer','activity'],'Stop takes precedence over Keep');
    assert.equal(await row('swipe-sample').locator('[data-action="timer"]').innerText(),'stop');
    await activate('swipe-sample',1,'timer');
    assert.equal(await page.evaluate(()=>Boolean(habitTimer)),false,'Stop works after changing mode');
    await page.locator('#value-log-cancel').click();
    await page.evaluate(()=>{setMinimalMode(false);
      window.TingsNative={isNative:true};reconcileNativeReminders=async()=>{};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({version:3,enabled:true,
        items:{'item:swipe-main':{start:'notification',end:'alarm',dates:{'2026-10-13':{travelStart:'alarm'}}}}}));render();});
    assert.deepEqual(await actions('swipe-main','right'),['snooze','pin','reminders-off','nuke']);
    const remindersBefore = await page.evaluate(()=>localStorage.getItem(NATIVE_REMINDERS_KEY));
    const reminderMark = row('swipe-main').locator('.reminder-pill');
    assert.equal(await reminderMark.evaluate(el=>el.tagName),'SPAN','reminder mark is status, not a button');
    assert.equal(await reminderMark.getAttribute('data-action'),null);
    await reminderMark.tap();
    assert.equal(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),true,'reminder mark uses the normal card tap');
    assert.equal(await page.evaluate(()=>localStorage.getItem(NATIVE_REMINDERS_KEY)),remindersBefore,'tapping the alarm mark preserves all reminder choices');
    await page.evaluate(()=>closeSheet('detail-sheet'));
    await page.evaluate(()=>{const p=nativeReminderPreferences();p.items['item:swipe-main']={start:'notification'};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(p));render();});
    await row('swipe-main').locator('.reminder-pill').tap();
    assert.equal(await page.evaluate(()=>nativeReminderAnyOn('item:swipe-main')),true,'tapping the notification mark preserves reminders');
    await page.evaluate(saved=>{closeSheet('detail-sheet');localStorage.setItem(NATIVE_REMINDERS_KEY,saved);render();},remindersBefore);
    await activate('swipe-main',-1,'reminders-off');
    assert.equal(await page.evaluate(()=>nativeReminderAnyOn('item:swipe-main')),false);
    assert.deepEqual(await page.evaluate(()=>load()[0].logs),logsBefore,'Quiet does not complete the item');
    assert.equal(await row('swipe-main').locator('[data-action="reminders-off"]').count(),0);

    await page.setViewportSize({width:280,height:844});
    await swipe('swipe-sample',1);
    const strip = row('swipe-sample').locator('.swipe-actions-left .swipe-action-strip');
    const geometry = await row('swipe-sample').evaluate(r=>({width:r.clientWidth,
      translation:parseFloat(r.querySelector('.ting-card').style.transform.match(/[-\d.]+/)[0]),
      buttons:[...r.querySelectorAll('.swipe-actions-left button')].map(b=>b.getBoundingClientRect().width)}));
    assert(geometry.translation<=geometry.width-24,'card retains its visible edge');
    assert(geometry.buttons.every(width=>width===68),'buttons retain their tap width');
    const box = await strip.boundingBox();
    await drag(box.x+box.width-20,box.y+box.height/2,-140);
    assert(await strip.evaluate(el=>el.scrollLeft>0),'native horizontal drag scrolls the strip');
    assert.equal(await row('swipe-sample').getAttribute('data-swipe-open'),'1','strip pan keeps the panel open');
    assert.equal(await page.evaluate(()=>load()[1].sample),true,'scrolling does not Keep the sample');
    await page.waitForTimeout(550);
    await row('swipe-sample').locator('[data-action="keep"]').click();
    assert.equal(await page.evaluate(()=>load()[1].sample),false,'last action remains reachable');
    assert.equal(await row('swipe-sample').locator('.swipe-action[data-action="keep"]').count(),0,'Keep disappears immediately');
    await page.evaluate(()=>{const p=nativeReminderPreferences();p.items['item:swipe-main']={start:'notification'};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(p));render();});
    await swipe('swipe-main',-1);
    const rightStrip = row('swipe-main').locator('.swipe-actions-right .swipe-action-strip');
    const snooze = await row('swipe-main').locator('.swipe-action[data-action="snooze"]').boundingBox();
    const panel = await rightStrip.boundingBox();
    assert(Math.abs(snooze.x+snooze.width-(panel.x+panel.width))<1,'Snooze starts at the outer edge');
    await drag(panel.x+20,panel.y+panel.height/2,140);
    assert(await rightStrip.evaluate(el=>el.scrollLeft<0),'right panel scrolls toward Remove');
    assert.equal(await row('swipe-main').getAttribute('data-swipe-open'),'-1');
    const remove = await row('swipe-main').locator('.swipe-action[data-action="nuke"]').boundingBox();
    assert(remove.x>=panel.x-1 && remove.x+remove.width<=panel.x+panel.width+1,'Remove is fully reachable');
    await page.screenshot({path:'test-results/swipe-shortcuts.png'});
    await page.waitForTimeout(550);
    await row('swipe-main').locator('.swipe-action[data-action="nuke"]').click();
    assert.equal(await page.evaluate(()=>load().some(h=>h.hid==='swipe-main')),false,'Remove works after scrolling');
    await page.locator('#action-undo').click();
    assert.equal(await page.evaluate(()=>load().some(h=>h.hid==='swipe-main')),true,'Remove retains its undo');
    await page.evaluate(()=>closeAllSwipes());
    await page.waitForTimeout(250);
    await row('swipe-main').locator('.ting-name').tap();
    assert.equal(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),true,'card tap still opens detail');
    assert.deepEqual(errors,[]);
    console.log('PASS swipe layouts, planning/undo, primary links, Stop, Quiet, focus and native strip scrolling');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
