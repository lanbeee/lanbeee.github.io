// Week view interaction — 1–3 phone days, shared clocks, grid zoom, colors,
// navigation, event actions, Back/Escape, focus/scroll restoration.
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/overview-week-view-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function seedScript(){
  return `(function(){
    const now = Date.now();
    const day = (n) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
    const topics = ['work','health','learning'];
    const locations = [
      { id:'loc-1', name:'Home', lat:40.7, lng:-74.0, radiusM:100 },
      { id:'loc-2', name:'Office', lat:40.75, lng:-73.98, radiusM:80 }
    ];
    const settings = {
      preset:'todayFirst', topics, locations, travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[{label:'sleep',days:[],start:1350,end:180,locationId:null}],
      showLocationOnCards:false
    };
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    const habits = [
      { hid:'deep-work', name:'Deep Work', type:'keepup', target:1, logs:[day(-1)], emoji:'🧠', topics:['work'], locationIds:['loc-2'], durationMinutes:60, breakable:true, minChunkMinutes:30, priority:2, createdAt:now-86400000, lastLog:day(-1), allowedTimeStart:480, allowedTimeEnd:1200 },
      { hid:'gym', name:'Gym', type:'keepup', target:2, logs:[], emoji:'🏋️', topics:['health'], locationIds:['loc-1'], durationMinutes:45, priority:1, createdAt:now-86400000, lastLog:null, allowedTimeStart:480, allowedTimeEnd:1140 },
      { hid:'team-sync', name:'Team sync', type:'task', target:null, logs:[], emoji:'📞', topics:['work'], eventTime: day(0) + 13*3600000, hardDue:true, durationMinutes:30, priority:0, createdAt:now-86400000, lastLog:null, breakable:false },
      { hid:'pay-rent', name:'Pay rent', type:'task', target:null, logs:[], emoji:'🏠', topics:[], eventTime:null, dueDate: day(1), hardDue:false, durationMinutes:15, priority:1, createdAt:now-86400000, lastLog:null, breakable:false }
    ];
    localStorage.setItem('tings_v2', JSON.stringify(habits));
  })();`;
}

async function cdpSwipe(c, x1, y1, x2, y2, steps = 10){
  await c.send('Input.dispatchTouchEvent', {
    type:'touchStart',
    touchPoints:[{ x:x1, y:y1, radiusX:10, radiusY:10, force:0.5, id:0 }],
    modifiers:0, timestamp:Date.now()
  });
  await new Promise(r => setTimeout(r, 20));
  for(let i = 1;i <= steps;i++){
    const t = i / steps;
    await c.send('Input.dispatchTouchEvent', {
      type:'touchMove',
      touchPoints:[{ x:x1 + (x2 - x1) * t, y:y1 + (y2 - y1) * t, radiusX:10, radiusY:10, force:0.5, id:0 }],
      modifiers:0, timestamp:Date.now()
    });
    await new Promise(r => setTimeout(r, 20));
  }
  await c.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[{ x:x2, y:y2, id:0 }],
    modifiers:0, timestamp:Date.now()
  });
}

async function openWeekView(page){
  if(await page.evaluate(()=>paneTierActive())){
    await page.locator('#open-week-view').click();
  }else{
    const entry = page.locator('#open-overview:visible, #bar-open-overview:visible').first();
    await entry.click();
    if(!await page.locator('#overview-sheet').evaluate(el=>el.classList.contains('open'))){
      await page.waitForTimeout(800);
      await entry.click();
    }
    await page.waitForSelector('#overview-sheet.open');
    await page.waitForTimeout(800);
    await page.locator('#open-week-view').click();
  }
  await page.waitForSelector('#week-sheet.open');
  await page.waitForFunction(()=>document.querySelector('#week-view-body')?.getAttribute('aria-busy') === 'false');
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const errors = [];
  for(const [name,width,height] of [['phone',390,844],['small phone',320,740],['desktop',1440,900]]){
    console.log(`\n=== ${name} ===`);
    const page = await browser.newPage({viewport:{width,height},isMobile:width < 600,hasTouch:width < 600,timezoneId:'America/New_York'});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(seedScript());
    await page.goto(BASE,{waitUntil:'load'});
    await page.waitForTimeout(1000);
    await openWeekView(page);
    assert(await page.locator('#week-view-body .wv-event').count() > 0,'planner events render');
    assert(await page.locator('.week-view-sheet > .sheet-exit').count() === 0,'close remains in the calendar header');
    assert(await page.locator('#week-view-options').isHidden(),'display options use no space until opened');
    assert(await page.locator('#week-view-chips').count() === 0,'no duplicate date strip');
    const fit = await page.evaluate(()=>{
      const sheet = document.querySelector('.week-view-sheet');
      const title = document.querySelector('#week-view-label');
      return {overflow:sheet.scrollWidth > sheet.clientWidth + 1,truncated:title.scrollWidth > title.clientWidth + 1,body:document.querySelector('#week-view-body').clientHeight,sheet:sheet.clientHeight};
    });
    assert(!fit.overflow && !fit.truncated,'controls and complete date title fit');
    assert(fit.body / fit.sheet > 0.7,'schedule gets over 70% of the sheet');
    assert(await page.evaluate(()=>document.activeElement.id === 'week-view-close'),'dialog receives focus');

    await page.selectOption('#week-view-days','3');
    assert(await page.locator('#week-view-body .wv-col').count() === 3,'three equal-width days in agenda');
    assert(await page.locator('#week-view-markers .wv-day-head').count() === 3,'only the three visible dates get headers');
    assert(await page.locator('#week-view-label').evaluate(el=>el.scrollWidth <= el.clientWidth + 1),'three-day date range fits beside controls');
    const widths = await page.locator('#week-view-body .wv-col').evaluateAll(els=>els.map(el=>el.clientWidth));
    assert(Math.max(...widths)-Math.min(...widths) <= 1,'days receive equal width');
    const tappedDay = await page.locator('[data-wv-dayhead]').nth(1).getAttribute('data-wv-dayhead');
    await page.locator('[data-wv-dayhead]').nth(1).click();
    await page.waitForSelector('#day-logs-sheet.open');
    assert(await page.evaluate(()=>dayLogsKey) === tappedDay,'date header opens the day menu for that date');
    assert(await page.locator('#day-logs-body [data-day-section="agenda"]').count() === 0 && await page.locator('#day-logs-plan').count() === 1,'day menu omits the agenda and retains day actions');
    await page.click('#day-logs-close');
    await page.waitForSelector('#day-logs-sheet:not(.open)');
    assert(await page.locator('#week-sheet.open').count() === 1,'closing day menu returns to week');
    assert(await page.evaluate(key=>document.activeElement?.dataset.wvDayhead === key,tappedDay),'closing the day menu restores focus to its date');
    await page.click('#week-view-overview');
    await page.waitForTimeout(250);
    assert(await page.locator('#week-sheet.open').count() === 0,'switch closes week view');
    if(width < 600){
      assert(await page.locator('#overview-sheet.open').count() === 1,'switch opens calendar overview');
      await page.click('#overview-head-close');
      await page.waitForTimeout(300);
      const calendar = page.locator('#open-overview:visible, #bar-open-overview:visible').first();
      await calendar.click();
      await page.waitForSelector('#overview-sheet.open');
      assert(await page.locator('#week-sheet.open').count() === 0,'calendar button remembers overview');
    }
    await page.locator('#open-week-view').click();
    await page.waitForSelector('#week-sheet.open');
    if(width < 600){
      await page.click('#week-view-close');
      await page.waitForTimeout(300);
      assert(await page.locator('#overview-sheet.open').count() === 0,'week close returns home');
      await page.locator('#open-overview:visible, #bar-open-overview:visible').first().click();
      await page.waitForSelector('#week-sheet.open');
      assert(await page.locator('#overview-sheet.open').count() === 0,'calendar button remembers week');
    }
    await page.waitForFunction(()=>document.querySelector('#week-view-body')?.getAttribute('aria-busy') === 'false');
    const alignment = await page.evaluate(()=>{
      const groups = new Map();
      document.querySelectorAll('#week-view-body [data-wv-event]').forEach(el=>{
        const row = _weekViewCtx.get(el.dataset.wvEvent);
        if(!groups.has(row.topMin))groups.set(row.topMin,[]);
        groups.get(row.topMin).push(el.getBoundingClientRect().top);
      });
      return [...groups.values()].every(ys=>Math.max(...ys)-Math.min(...ys)<1);
    });
    assert(alignment,'the same time aligns across visible agenda days');

    const firstRange = await page.textContent('#week-view-label');
    await page.click('#week-view-next');
    assert(await page.textContent('#week-view-label') !== firstRange,'next advances the visible days');
    await page.click('#week-view-today');
    assert(await page.evaluate(()=>weekViewDaySel === dateKey(Date.now()) && weekViewOffset === 0),'Today returns to today');
    await page.selectOption('#week-view-days','1');
    await page.click('#week-view-label');
    await page.waitForSelector('#day-logs-sheet.open');
    assert(await page.evaluate(()=>dayLogsKey === weekViewDaySel),'single-day title opens the same day menu');
    await page.click('#day-logs-close');
    await page.waitForSelector('#day-logs-sheet:not(.open)');
    await page.selectOption('#week-view-days','3');

    await page.click('#week-view-mode');
    assert(await page.locator('#week-view-body .wv-col').count() === 3,'three-day grid keeps the selected width');
    assert(await page.locator('#week-view-body .wv-hour').count() === 24,'grid uses a proportional clock');
    await page.click('#week-view-display-options');
    assert(await page.locator('#week-view-zoom').isVisible(),'grid zoom is available in display options');
    const zoomBefore = await page.evaluate(()=>weekViewHourPx());
    await page.click('#week-view-zoom-out');
    assert(await page.evaluate(()=>weekViewHourPx()) < zoomBefore,'zoom out compresses the grid');
    await page.click('#week-view-zoom-in');
    assert(await page.evaluate(()=>weekViewHourPx()) === zoomBefore,'zoom in restores a taller grid');
    const saved = await page.evaluate(()=>localStorage.getItem('tings_v2'));
    for(const color of ['priority','type','location','when','topic']){
      await page.selectOption('#week-view-color',color);
      assert(await page.locator('#week-view-legend .wv-legend-chip').count() > 0,`${color} coloring has a matching legend`);
    }
    assert(await page.evaluate(()=>localStorage.getItem('tings_v2')) === saved,'display changes do not rewrite habits');
    await page.click('#week-view-display-options');

    // Existing rows always open their own editor; returning restores focus.
    const event = page.locator('#week-view-body [data-wv-event]').first();
    const eventId = await event.getAttribute('data-wv-event');
    await event.click();
    await page.waitForFunction(()=>document.querySelector('#detail-sheet').classList.contains('open') || document.querySelector('.pane-detail')?.dataset.activeSheet === 'detail-sheet');
    assert(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.sheet-wrap')?.id === 'detail-sheet'),'habit/event detail paints above the calendar');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.evaluate(()=>document.activeElement.dataset.wvEvent) === eventId,'closing detail restores the tapped row focus');

    const busy = page.locator('#week-view-body [data-wv-busy]').first();
    await busy.click();
    await page.waitForSelector('#block-edit-sheet.open');
    assert(true,'busy tap opens the blocked-time editor');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    const travel = page.locator('#week-view-body [data-wv-travel]').first();
    if(await travel.count()){
      await travel.click();
      await page.waitForSelector('#travel-edit-sheet.open');
      assert(true,'travel tap opens the saved route editor');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      assert(await page.locator('#week-sheet.open').count() === 1,'Escape from travel keeps the calendar open');
    }

    // Empty grid space stages a date/time; only Save can create an item.
    const target = await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      scroller.scrollTop = 17 * weekViewHourPx();
      const column = document.querySelector('[data-wv-daycol]');
      const rect = column.getBoundingClientRect();
      return {x:rect.left + rect.width/2,y:rect.top + 18 * weekViewHourPx(),day:column.dataset.wvDaycol};
    });
    await page.waitForTimeout(400);
    await page.mouse.click(target.x,target.y);
    await page.waitForSelector('#add-sheet.open');
    const draft = await page.evaluate(()=>({type:selectedType,date:document.querySelector('#ting-due-date').value,time:document.querySelector('#ting-due-time').value,top:document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.sheet-wrap')?.id}));
    assert(draft.type === 'task' && draft.date === target.day && draft.time === '18:00','empty grid tap stages a task at the tapped date and time');
    assert(draft.top === 'add-sheet','new-task editor paints above the calendar');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.evaluate(()=>localStorage.getItem('tings_v2')) === saved,'canceling the new task leaves saved items untouched');

    await page.click('#week-view-create');
    await page.waitForSelector('#add-sheet.open');
    assert(await page.inputValue('#ting-due-date') === await page.evaluate(()=>weekViewDaySel),'Add uses the selected day');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    if(width === 390){
      await page.click('#week-view-create');
      const tomorrow = await page.evaluate(()=>dateKey(offsetCalendarDay(Date.now(),1)));
      await page.fill('#ting-message','Calendar save fixture');
      await page.fill('#ting-due-date',tomorrow);
      await page.fill('#ting-due-time','18:00');
      await page.click('#do-save');
      await page.waitForFunction(()=>!document.querySelector('#add-sheet').classList.contains('open'));
      assert(await page.evaluate(day=>{
        const item = load().find(h=>h.name === 'Calendar save fixture');
        return item && item.type === 'task' && dateKey(item.eventTime) === day && new Date(item.eventTime).getHours() === 18;
      },tomorrow),'explicit Save creates a task with the staged date and time');
      await page.waitForSelector('#detail-sheet.open');
      assert(true,'Save opens the new task schedule using the existing add flow');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      assert(await page.locator('#week-sheet.open').count() === 1,'closing the new task schedule returns to the calendar');
    }

    await page.click('#week-view-display-options');
    await page.click('#week-view-filters');
    await page.waitForSelector('#calendar-filter-sheet.open');
    await page.locator('[data-overview-type="task"]').click();
    await page.click('#calendar-filter-done');
    await page.waitForTimeout(300);
    assert(await page.evaluate(()=>[...document.querySelectorAll('#week-view-body [data-wv-event]')].every(el=>_weekViewCtx.get(el.dataset.wvEvent)?.h.type === 'task')),'filters apply when returning to the week');
    assert(await page.locator('#week-view-body [data-wv-busy]').count() > 0,'filters keep busy time visible');
    await page.evaluate(()=>{clearOverviewFilters();renderWeekView();});

    await page.selectOption('#week-view-days','2');
    await page.click('#week-view-list');
    await page.click('#week-view-close');
    await page.waitForTimeout(200);
    await page.evaluate(()=>openWeekView());
    await page.waitForFunction(()=>document.querySelector('#week-view-body')?.getAttribute('aria-busy') === 'false');
    assert(await page.inputValue('#week-view-days') === '2' && await page.locator('#week-view-list').getAttribute('aria-pressed') === 'true','day count and view survive closing and reopening');
    if(width === 390){
      const client = await page.context().newCDPSession(page);
      const before = await page.evaluate(()=>weekViewDaySel);
      await cdpSwipe(client,300,400,60,400);
      await page.waitForTimeout(500);
      assert(await page.evaluate(()=>weekViewDaySel) !== before,'horizontal swipe moves to the next day');
      const after = await page.evaluate(()=>weekViewDaySel);
      await cdpSwipe(client,200,600,200,350);
      await page.waitForTimeout(500);
      assert(await page.evaluate(()=>weekViewDaySel) === after,'vertical scrolling keeps the selected day');
      assert(await page.locator('#add-sheet.open').count() === 0,'scroll/swipe never creates a draft');
    }
    await page.selectOption('#week-view-days',width > 600 ? '7' : '3');
    if(width === 390){
      await page.evaluate(()=>{
        window._savedWeekPreviewAvailable = weekPreviewWorkerAvailable;
        weekPreviewWorkerAvailable = ()=>false;
        _weekViewCache.clear();
        weekViewSetOffset(7);
      });
      await page.waitForSelector('[data-wv-retry]');
      assert(await page.locator('#week-view-body').getAttribute('aria-busy') === 'false','unavailable preview settles into a retry state');
      await page.evaluate(()=>{
        weekPreviewWorkerAvailable = window._savedWeekPreviewAvailable;
        delete window._savedWeekPreviewAvailable;
      });
      await page.locator('[data-wv-retry]').click();
      assert(await page.locator('[data-wv-retry]').count() === 0,'retry starts a fresh preview request');
    }
    await page.evaluate(()=>weekViewSetOffset(7));
    assert(/Preview/.test(await page.textContent('#week-view-sub')),'future placements are labeled Preview');
    await page.click('#week-view-today');
    if(width === 390){
      const selected = await page.evaluate(()=>{
        weekViewShiftDay(1);
        window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
        return weekViewDaySel;
      });
      assert(await page.evaluate(()=>_weekViewTimer === null),'leaving the page suspends the calendar timer');
      await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      assert(await page.evaluate(day=>weekViewDaySel === day && _weekViewTimer !== null,selected),'returning from another app preserves the day and resumes updates');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert(await page.locator('#week-sheet.open').count() === 0,'Escape closes the calendar');
    assert(await page.evaluate(()=>_weekPreviewWorker === null),'dismissal releases preview work');
    if(width === 390){
      await page.evaluate(()=>openWeekView());
      await page.setViewportSize({width:1440,height:900});
      await page.waitForFunction(()=>_weekViewLayout === 'desktop');
      assert(await page.locator('#week-view-body .wv-col').count() === 7,'resize observation still works after reopening');
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>_weekViewLayout === 'phone');
      assert(await page.inputValue('#week-view-days') === '3','resizing back restores the phone day count');
    }
    await page.close();
  }
  assert(errors.length === 0,'no page errors' + (errors.length ? ' :: ' + errors[0] : ''));
  await browser.close();
  if(fail)process.exit(1);
  console.log('\nPASS — week view interaction');
})().catch(error=>{console.error('TEST FAILED:',error);process.exit(1);});
