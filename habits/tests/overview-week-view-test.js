// Week view interaction — phone week/month choices, shared clocks, grid zoom, colors,
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
    modifiers:0, timestamp:Date.now()/1000
  });
  await new Promise(r => setTimeout(r, 20));
  for(let i = 1;i <= steps;i++){
    const t = i / steps;
    await c.send('Input.dispatchTouchEvent', {
      type:'touchMove',
      touchPoints:[{ x:x1 + (x2 - x1) * t, y:y1 + (y2 - y1) * t, radiusX:10, radiusY:10, force:0.5, id:0 }],
      modifiers:0, timestamp:Date.now()/1000
    });
    await new Promise(r => setTimeout(r, 20));
  }
  await c.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[],
    modifiers:0, timestamp:Date.now()/1000
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

async function setOptionsOpen(page,open){
  const visible = await page.locator('#week-view-options').isVisible();
  if(visible === open)return;
  await page.click(open ? '#week-view-display-options' : '#week-view-options-close');
}

async function chooseOption(page,selector){
  await setOptionsOpen(page,true);
  await page.locator(selector).click();
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
    assert(await page.locator('#week-view-body').getAttribute('data-days') === (width >= 1100 ? '7' : '3'),'fresh preferences show three phone days or a full desktop week');
    const fit = await page.evaluate(()=>{
      const sheet = document.querySelector('.week-view-sheet');
      const title = document.querySelector('#week-view-label-text');
      return {overflow:sheet.scrollWidth > sheet.clientWidth + 1,truncated:title.scrollWidth > title.clientWidth + 1,body:document.querySelector('#week-view-body').clientHeight,sheet:sheet.clientHeight};
    });
    assert(!fit.overflow && !fit.truncated,'controls and complete date title fit');
    assert(fit.body / fit.sheet > 0.7,'schedule gets over 70% of the sheet');
    assert(await page.evaluate(()=>document.activeElement.id === 'week-view-close'),'dialog receives focus');
    assert(await page.locator('#week-view-filters').count() === 0,'there is no standalone Filters button');
    const taskFilter = page.locator('#week-view-options [data-wvfilter-type="task"]');
    assert(await taskFilter.isHidden(),'filters are hidden when Calendar options is closed');
    await setOptionsOpen(page,true);
    await taskFilter.click();
    assert(await page.evaluate(()=>homeTypeFilter === 'task' && overviewTypeFilter === 'task'),'week filters apply to Home and calendar');
    assert(await page.evaluate(()=>document.activeElement.id === 'week-view-display-options'),'applying a filter returns focus to Calendar options');
    await setOptionsOpen(page,true);
    assert(await taskFilter.getAttribute('aria-pressed') === 'true' && await page.locator('#week-view-filter-title').textContent() === 'Filters (1)','the sidebar shows the selection and active count');
    await page.locator('#week-view-filters-reset').click();
    assert(await page.evaluate(()=>homeTypeFilter === 'all' && overviewTypeFilter === 'all'),'week reset clears the shared selection');
    if(width >= 1100){
      assert(await page.locator('.week-view-sheet').evaluate(el=>{
        const r = el.getBoundingClientRect();
        return Math.abs(r.top) <= 1 && Math.abs(r.left) <= 1
          && Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1
          && getComputedStyle(el).borderRadius === '0px';
      }),'desktop calendar fills the browser window without an outer frame');
    }

    const drawerState = await page.evaluate(()=>{
      const body = document.querySelector('#week-view-body');
      const scroller = body.querySelector('.wv-scroller');
      const y = body.querySelector('.wv-yscroll');
      const top = y.scrollTop, left = scroller.scrollLeft, height = body.clientHeight;
      weekViewSetOptionsOpen(true);
      weekViewSetOptionsOpen(false);
      return {same:scroller === body.querySelector('.wv-scroller'),top:y.scrollTop === top,left:scroller.scrollLeft === left,height:body.clientHeight === height};
    });
    assert(Object.values(drawerState).every(Boolean),'opening and closing options preserves the board, both scroll positions and viewport');
    await setOptionsOpen(page,true);
    assert(await page.evaluate(()=>document.querySelector('#week-view-body').inert),'the drawer makes the covered calendar inert');
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(()=>document.activeElement.closest('#week-view-options') !== null),'keyboard focus stays inside the sidebar');
    await page.keyboard.press('Escape');
    assert(await page.locator('#week-view-options').isHidden() && await page.locator('#week-sheet.open').count() === 1,'Escape closes options before the calendar');
    assert(await page.evaluate(()=>document.activeElement.id === 'week-view-display-options'),'closing options restores focus to the menu button');
    await setOptionsOpen(page,true);
    await page.evaluate(()=>handleAppBack());
    assert(await page.locator('#week-view-options').isHidden() && await page.locator('#week-sheet.open').count() === 1,'system Back dismisses the sidebar before the calendar');
    await setOptionsOpen(page,true);
    const focusSurvivesPreview = await page.evaluate(()=>{
      const option = document.querySelector('#week-view-filter-groups button');
      option.focus({preventScroll:true});
      renderWeekView();
      return document.activeElement === option;
    });
    assert(focusSurvivesPreview,'a background calendar repaint keeps sidebar filter focus');
    const backdrop = await page.locator('#week-view-options-backdrop').boundingBox();
    await page.locator('#week-view-options-backdrop').click({position:{x:backdrop.width-8,y:backdrop.height/2}});
    assert(await page.locator('#week-view-options').isHidden(),'tapping outside the sidebar dismisses it');
    assert(await page.locator('#week-view-body .is-selected').count() === 0,'the leftmost column has no selection highlight');
    assert(await page.locator('#week-view-body .wv-col').evaluateAll(cols=>cols.every(el=>getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)')),'today and the leftmost column have no background tint');
    assert(await page.locator('#week-view-body .wv-ev-hour').count() === 0,'hour lines do not cross agenda cards');
    assert(await page.locator('#week-view-body .wv-hour').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)) === 13,'gutter labels are 30 percent larger');
    const nowAligned = await page.evaluate(()=>{
      updateWeekViewNowLine();
      const tag = document.querySelector('#week-view-body .wv-nowtag');
      const line = document.querySelector('#week-view-body [data-wv-elastic-now]');
      return tag && line && Math.abs(parseFloat(tag.style.top) - parseFloat(line.style.top)) < 1;
    });
    assert(nowAligned,'the current-time gutter label follows the compressed agenda clock');

    if(width === 320){
      const title = await page.evaluate(()=>{
        weekViewGoToDay(`${new Date().getFullYear() - 1}-09-30`);
        const label = document.querySelector('#week-view-label-text');
        return {text:label.textContent,fits:label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1};
      });
      assert(title.fits && title.text.includes('Sep') && title.text.includes('Oct'),'cross-month date ranges fit on a small phone');
      await page.click('#week-view-today');
    }

    await setOptionsOpen(page,true);
    await chooseOption(page,'[data-wv-days="3"]');
    assert(await page.locator('.wv-scale-note').count() === 0,'the shared-scale note is gone');
    assert(await page.locator('#week-view-prev,#week-view-next').count() === 0,'day arrows are gone');
    await setOptionsOpen(page,false);
    const strip = await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      const cols = [...document.querySelectorAll('#week-view-body .wv-col')];
      const box = scroller.getBoundingClientRect();
      const gutterBox = document.querySelector('#week-view-body .wv-gutter')?.getBoundingClientRect();
      const gutter = gutterBox?.width || 0;
      const labelsFit = [...document.querySelectorAll('#week-view-body .wv-hour')].every(el=>{
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.left >= gutterBox.left - 1 && box.right <= gutterBox.right + 1;
      });
      const visible = cols.filter(col=>{
        const r = col.getBoundingClientRect();
        return Math.min(r.right,box.right) - Math.max(r.left,box.left) > r.width * 0.6;
      }).length;
      const widths = cols.map(el=>el.clientWidth);
      return {total:cols.length,heads:document.querySelectorAll('#week-view-body .wv-day-head').length,visible,equal:Math.max(...widths)-Math.min(...widths) <= 1,gutter,labelsFit};
    });
    assert(strip.total >= 14,'the strip continues past the first screen');
    assert(strip.heads === strip.total,'every day in the strip has a header');
    assert(strip.visible === 3,'three days fit on screen');
    assert(strip.equal,'days receive equal width');
    assert(strip.gutter > 0 && strip.gutter <= 28,'the time gutter stays narrow and readable');
    assert(strip.labelsFit,'hour labels stay inside the gutter');
    assert(await page.locator('#week-view-body .wv-event-mark').count() > 0,'one to three day cards keep an emoji');
    const summaries = (await page.locator('#week-view-body .wv-load').allTextContents()).map(text=>text.trim()).filter(Boolean);
    assert(summaries.length > 0 && summaries.every(text=>text.length <= 32),'day headers show a short summary');
    await page.screenshot({path:`test-results/calendar-refined-${width}.png`,animations:'disabled'});
    assert(await page.locator('#week-view-label').evaluate(el=>el.scrollWidth <= el.clientWidth + 1),'three-day date range fits beside controls');
    const tappedDay = await page.locator('#week-view-body [data-wv-dayhead]').nth(1).getAttribute('data-wv-dayhead');
    await page.locator('[data-wv-dayhead]').nth(1).click();
    await page.waitForSelector('#day-logs-sheet.open');
    assert(await page.evaluate(()=>dayLogsKey) === tappedDay,'date header opens the day menu for that date');
    assert(await page.locator('#day-logs-body [data-day-section="agenda"]').count() === 0 && await page.locator('#day-logs-plan').count() === 1,'day menu omits the agenda and retains day actions');
    await page.click('#day-logs-close');
    await page.waitForSelector('#day-logs-sheet:not(.open)');
    assert(await page.locator('#week-sheet.open').count() === 1,'closing day menu returns to week');
    assert(await page.evaluate(key=>document.activeElement?.dataset.wvDayhead === key,tappedDay),'closing the day menu restores focus to its date');
    await page.evaluate(()=>{
      overviewTypeFilter = 'task';
      const now = new Date();
      weekViewGoToDay(dateKey(new Date(now.getFullYear(),now.getMonth() + 2,1).getTime()));
    });
    await chooseOption(page,'#week-view-month-view');
    await page.waitForTimeout(250);
    assert(await page.locator('#week-sheet.open').count() === 0,'switch closes week view');
    assert(await page.evaluate(()=>overviewRangeFilter === 'month' && overviewTypeFilter === 'task'),'Month opens the monthly overview directly and retains calendar filters');
    assert(await page.evaluate(()=>overviewMonthOffset === 2),'Month keeps the date being browsed instead of jumping to the current month');
    if(width < 600){
      assert(await page.locator('#overview-sheet.open').count() === 1,'switch opens calendar overview');
      await page.click('#overview-head-close');
      await page.waitForTimeout(300);
      const calendar = page.locator('#open-overview:visible, #bar-open-overview:visible').first();
      await calendar.click();
      await page.waitForSelector('#overview-sheet.open');
      assert(await page.locator('#week-sheet.open').count() === 0,'calendar button remembers overview');
      assert(await page.evaluate(()=>overviewRangeFilter === 'month'),'calendar button remembers the monthly display');
    }
    await page.evaluate(()=>clearOverviewFilters());
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

    const firstRange = (await page.textContent('#week-view-label')).trim();
    await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      scroller.scrollLeft = scroller.scrollWidth;
    });
    await page.waitForFunction(prev=>document.querySelector('#week-view-label').textContent.trim() !== prev,firstRange);
    assert(true,'horizontal scroll moves through later days');
    await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      scroller.scrollLeft = weekViewColumnStep(scroller) * 1.45;
    });
    await page.waitForFunction(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      const step = weekViewColumnStep(scroller);
      return Math.abs(scroller.scrollLeft - Math.round(scroller.scrollLeft / step) * step) < 2;
    });
    assert(true,'horizontal scroll settles on a day');
    await page.click('#week-view-today');
    assert(await page.evaluate(()=>weekViewDaySel === dateKey(Date.now()) && weekViewOffset === 0),'Today returns to today');
    await setOptionsOpen(page,true);
    await chooseOption(page,'[data-wv-days="1"]');
    await setOptionsOpen(page,false);
    await page.click('#week-view-label');
    assert(await page.locator('#week-view-month:not([hidden])').count() === 1,'date title drops down a month');
    await page.click('#week-view-label');
    assert(await page.locator('#week-view-month').isHidden(),'tapping the date title again closes the month');
    await page.click('#week-view-label');
    const pickerDay = await page.evaluate(()=>document.activeElement.dataset.wvMonthDay);
    const pickerBodyHeight = await page.locator('#week-view-body').evaluate(el=>el.clientHeight);
    await page.keyboard.press('ArrowRight');
    assert(await page.evaluate(key=>document.activeElement.dataset.wvMonthDay === dateKey(offsetCalendarDay(new Date(`${key}T12:00:00`).getTime(),1)),pickerDay),'arrow keys navigate dates inside the month picker');
    await page.keyboard.press('Escape');
    assert(await page.locator('#week-view-month').isHidden() && await page.locator('#week-sheet').evaluate(el=>el.classList.contains('open')),'Escape closes the date picker before the calendar');
    assert(await page.evaluate(()=>document.activeElement.id === 'week-view-label'),'closing the picker restores title focus');
    assert(await page.locator('#week-view-body').evaluate(el=>el.clientHeight) === pickerBodyHeight,'the month picker overlays the calendar without squeezing it');
    const singleDay = await page.locator('#week-view-body [data-wv-dayhead]').first().getAttribute('data-wv-dayhead');
    await page.locator('#week-view-body [data-wv-dayhead]').first().click();
    await page.waitForSelector('#day-logs-sheet.open');
    assert(await page.evaluate(()=>dayLogsKey === weekViewDaySel),'date header opens the same day menu');
    assert(singleDay === await page.evaluate(()=>weekViewDaySel),'the open day is the one in the header');
    await page.click('#day-logs-close');
    await page.waitForSelector('#day-logs-sheet:not(.open)');
    await setOptionsOpen(page,true);
    await chooseOption(page,'[data-wv-days="3"]');
    await chooseOption(page,'#week-view-mode');
    await setOptionsOpen(page,false);
    const gridFit = await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      const cols = [...document.querySelectorAll('#week-view-body .wv-col')];
      const box = scroller.getBoundingClientRect();
      const visible = cols.filter(col=>{
        const r = col.getBoundingClientRect();
        return Math.min(r.right,box.right) - Math.max(r.left,box.left) > r.width * 0.6;
      }).length;
      return visible;
    });
    assert(gridFit === 3,'three-day grid keeps the selected width');
    assert(await page.locator('#week-view-body .wv-hour').count() === 24,'grid uses a proportional clock');
    assert(await page.locator('#week-view-body .wv-ev-hour, #week-view-body .wv-line').count() === 0,'grid draws hour lines behind cards without individual line elements');
    await setOptionsOpen(page,true);
    assert(await page.locator('#week-view-zoom').isVisible(),'grid zoom is available in display options');
    const zoomBefore = await page.evaluate(()=>weekViewHourPx());
    await page.click('#week-view-zoom-out');
    assert(await page.evaluate(()=>weekViewHourPx()) < zoomBefore,'zoom out compresses the grid');
    await page.click('#week-view-zoom-in');
    assert(await page.evaluate(()=>weekViewHourPx()) === zoomBefore,'zoom in restores a taller grid');
    const clockPosition = await page.evaluate(()=>{
      const y = document.querySelector('#week-view-body .wv-yscroll');
      y.scrollTop = 600;
      let scroller = document.querySelector('#week-view-body .wv-scroller');
      const minute = weekViewViewportMinute(scroller);
      weekViewChangeZoom(-1);
      scroller = document.querySelector('#week-view-body .wv-scroller');
      const zoomError = Math.abs(weekViewViewportMinute(scroller) - minute);
      weekViewSetMode('list');
      scroller = document.querySelector('#week-view-body .wv-scroller');
      const listMinute = weekViewViewportMinute(scroller);
      weekViewSetMode('grid');
      scroller = document.querySelector('#week-view-body .wv-scroller');
      const modeError = Math.abs(weekViewViewportMinute(scroller) - listMinute);
      return {zoomError,modeError};
    });
    assert(clockPosition.zoomError < 1,'zoom preserves the clock beneath the sticky header');
    assert(clockPosition.modeError < 1,'switching layouts preserves the visible clock');
    const saved = await page.evaluate(()=>localStorage.getItem('tings_v2'));
    for(const color of ['priority','type','location','when','topic']){
      await chooseOption(page,`[data-wv-color="${color}"]`);
      await setOptionsOpen(page,true);
      assert(await page.locator('#week-view-legend .wv-legend-chip').count() > 0,`${color} coloring has a matching legend`);
    }
    assert(await page.evaluate(()=>localStorage.getItem('tings_v2')) === saved,'display changes do not rewrite habits');
    await setOptionsOpen(page,false);

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
    await page.evaluate(()=>{document.querySelector('#week-view-body .wv-yscroll').scrollTop = 17 * weekViewHourPx();});
    await page.waitForTimeout(400);
    const target = await page.evaluate(()=>{
      const column = document.querySelector(`[data-wv-daycol="${weekViewDaySel}"]`);
      const rect = column.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      for(let minute = 18 * 60;minute < 22 * 60;minute += 15){
        const y = rect.top + minute * weekViewHourPx() / 60;
        const hit = document.elementFromPoint(x,y);
        if(hit?.closest('[data-wv-daycol]') !== column || hit.closest('.wv-event,[data-wv-busy],[data-wv-travel]'))continue;
        const time = `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2,'0')}`;
        return {x,y,day:column.dataset.wvDaycol,time};
      }
      throw new Error('No empty evening grid slot is visible');
    });
    if(width < 600)await page.touchscreen.tap(target.x,target.y);
    else await page.mouse.click(target.x,target.y);
    await page.waitForSelector('#add-sheet.open');
    const draft = await page.evaluate(()=>({type:selectedType,date:document.querySelector('#ting-due-date').value,time:document.querySelector('#ting-due-time').value,top:document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.sheet-wrap')?.id}));
    assert(draft.type === 'task' && draft.date === target.day && draft.time === target.time,'empty grid tap stages a task at the tapped date and time');
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

    await setOptionsOpen(page,true);
    await chooseOption(page,'[data-wvfilter-type="task"]');
    assert(await page.locator('#calendar-filter-sheet.open').count() === 0,'sidebar filters apply directly without another sheet');
    await page.waitForTimeout(300);
    assert(await page.evaluate(()=>[...document.querySelectorAll('#week-view-body [data-wv-event]')].every(el=>_weekViewCtx.get(el.dataset.wvEvent)?.h.type === 'task')),'filters apply when returning to the week');
    assert(await page.locator('#week-view-body [data-wv-busy]').count() > 0,'filters keep busy time visible');
    await page.evaluate(()=>{clearOverviewFilters();renderWeekView();});

    await chooseOption(page,'[data-wv-days="2"]');
    await chooseOption(page,'#week-view-list');
    await page.click('#week-view-close');
    await page.waitForTimeout(200);
    await page.evaluate(()=>openWeekView());
    await page.waitForFunction(()=>document.querySelector('#week-view-body')?.getAttribute('aria-busy') === 'false');
    assert(await page.locator('[data-wv-days="2"]').getAttribute('aria-pressed') === 'true'  && await page.locator('#week-view-list').getAttribute('aria-pressed') === 'true','day count and view survive closing and reopening');
    if(width === 390){
      const client = await page.context().newCDPSession(page);
      const before = await page.evaluate(()=>weekViewDaySel);
      await page.evaluate(()=>{
        const scroller = document.querySelector('#week-view-body .wv-scroller');
        scroller.scrollLeft += weekViewColumnStep(scroller);
      });
      await page.waitForFunction(day=>weekViewDaySel !== day,before);
      assert(await page.evaluate(()=>weekViewDaySel) !== before,'horizontal scroll moves to the next day');
      // Use the proportional clock so the gesture has room to scroll at any
      // time of day, even when Agenda compresses the fixture to one screen.
      await chooseOption(page,'#week-view-mode');
      const beforeTouch = await page.evaluate(()=>weekViewDaySel);
      // A late worker reply must not replace the scroller during a gesture.
      await page.evaluate(()=>document.querySelector('#week-view-body').addEventListener('touchstart',()=>{
        setTimeout(weekViewRequestRefresh,80);
      },{once:true,passive:true}));
      await cdpSwipe(client,300,400,60,400);
      await page.waitForTimeout(500);
      assert(await page.evaluate(()=>weekViewDaySel) !== beforeTouch,'a real touch swipe survives a background calendar refresh');
      // Let the horizontal fling finish settling before capturing the
      // baseline — a touch that lands mid-fling stops it, and the strip then
      // rightly settles onto a whole day on release.
      await page.waitForFunction(()=>{
        const scroller = document.querySelector('#week-view-body .wv-scroller');
        const s = weekViewColumnStep(scroller);
        return Math.abs(scroller.scrollLeft - Math.round(scroller.scrollLeft / s) * s) < 2;
      },{timeout:5000});
      await page.waitForTimeout(300);
      const after = await page.evaluate(()=>weekViewDaySel);
      await cdpSwipe(client,200,600,200,350);
      await page.waitForTimeout(500);
      assert(await page.evaluate(()=>weekViewDaySel) === after,'vertical scrolling keeps the selected day');
      // Diagonal gestures commit to one axis — the strip and the clock never
      // move together: not from mid-clock, during momentum, nor at an edge.
      const readScroll = () => page.evaluate(()=>({
        sl:document.querySelector('#week-view-body .wv-scroller').scrollLeft,
        st:document.querySelector('#week-view-body .wv-yscroll').scrollTop
      }));
      await page.evaluate(()=>{
        const scroller = document.querySelector('#week-view-body .wv-scroller');
        const y = document.querySelector('#week-view-body .wv-yscroll');
        scroller.scrollLeft = weekViewColumnStep(scroller) * 2;
        y.scrollTop = Math.round((y.scrollHeight - y.clientHeight) / 2);
      });
      await page.waitForTimeout(400);
      const vDiagBefore = await readScroll();
      await cdpSwipe(client,250,650,180,380);
      await page.waitForTimeout(700);
      const vDiagAfter = await readScroll();
      assert(vDiagAfter.st - vDiagBefore.st > 40 && Math.abs(vDiagAfter.sl - vDiagBefore.sl) < 2,'a vertical-dominant diagonal moves only the clock');
      const xDiagBefore = await readScroll();
      const step = await page.evaluate(()=>weekViewColumnStep(document.querySelector('#week-view-body .wv-scroller')));
      await cdpSwipe(client,300,500,60,440);
      await page.waitForTimeout(700);
      const xDiagAfter = await readScroll();
      assert(xDiagAfter.sl - xDiagBefore.sl > step * 0.4 && Math.abs(xDiagAfter.st - xDiagBefore.st) < 2,'a horizontal-dominant diagonal moves only the day strip');
      // A diagonal that lands mid-fling must not corrupt the interrupted
      // strip: touching stops the fling, the clock moves, and the strip still
      // settles onto a whole day.
      await page.evaluate(()=>{
        const y = document.querySelector('#week-view-body .wv-yscroll');
        y.scrollTop = Math.round((y.scrollHeight - y.clientHeight) / 2);
      });
      const flingFrom = await readScroll();
      await cdpSwipe(client,300,500,120,500);
      await page.waitForTimeout(80);
      await cdpSwipe(client,250,650,200,400);
      await page.waitForTimeout(1400);
      const flingAfter = await page.evaluate(()=>{
        const scroller = document.querySelector('#week-view-body .wv-scroller');
        const s = weekViewColumnStep(scroller);
        return { sl:scroller.scrollLeft, aligned:Math.abs(scroller.scrollLeft - Math.round(scroller.scrollLeft / s) * s) < 2 };
      });
      assert(flingAfter.aligned && Math.abs(flingAfter.sl - flingFrom.sl) > 1,'a diagonal during momentum still settles the strip on a whole day');
      // At a clock edge nothing leaks sideways.
      const edgeBefore = await page.evaluate(()=>{
        const y = document.querySelector('#week-view-body .wv-yscroll');
        y.scrollTop = 0;
        return document.querySelector('#week-view-body .wv-scroller').scrollLeft;
      });
      await page.waitForTimeout(300);
      await cdpSwipe(client,200,300,260,640);
      await page.waitForTimeout(700);
      const edgeAfter = await readScroll();
      assert(edgeAfter.sl === edgeBefore && edgeAfter.st === 0,'a diagonal at the clock edge never slides the strip');
      assert(await page.locator('#add-sheet.open').count() === 0,'scroll/swipe never creates a draft');
      await chooseOption(page,'#week-view-list');
    }
    await chooseOption(page,`[data-wv-days="${width > 600 ? 7 : 3}"]`);
    if(width === 390){
      const marked = await page.evaluate(()=>{
        const buttons = [...document.querySelectorAll('#week-view-body .wv-event-mark')];
        const btn = buttons.find(el=>{
          const ev = _weekViewCtx.get(el.dataset.wvDone);
          return ev && ev.h && ev.h.type === 'task';
        }) || buttons[0];
        const ev = btn && _weekViewCtx.get(btn.dataset.wvDone);
        return {id:btn ? btn.dataset.wvDone : '',hid:ev ? ev.hid : ''};
      });
      assert(Boolean(marked.id),'a completable item offers its emoji');
      await page.locator(`#week-view-body .wv-event-mark[data-wv-done="${marked.id}"]`).click();
      await page.waitForFunction(hid=>{
        const item = load().find(h=>h && h.hid === hid);
        return Boolean(item && item.lastLog != null);
      },marked.hid);
      await page.waitForFunction(id=>!document.querySelector(`#week-view-body [data-wv-done="${id}"]`),marked.id);
      assert(await page.locator('#week-view-body .wv-gutter .wv-hour').count() > 0,'marking done redraws the compressed clock');
    }
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
    if(width === 390){
      const later = await page.evaluate(()=>dateKey(offsetCalendarDay(Date.now(),8)));
      await page.waitForFunction(key=>{
        const col = document.querySelector(`[data-wv-daycol="${key}"]`);
        return Boolean(col && col.querySelector('[data-wv-busy],[data-wv-event]'));
      },later);
      assert(true,'a day past this week still shows plans or busy time');
      await page.click('#week-view-label');
      const far = await page.evaluate(()=>{
        _weekViewMonthOffset = 2;
        weekViewRenderMonth();
        return document.querySelector('#week-view-month [data-wv-month-day]')?.dataset.wvMonthDay || '';
      });
      await page.locator(`#week-view-month [data-wv-month-day="${far}"]`).click();
      await page.waitForFunction(key=>weekViewDaySel === key,far);
      assert(/Rough picture/.test(await page.textContent('#week-view-sub')),'a day outside the plan is marked as a rough picture');
      assert(await page.locator(`[data-wv-daycol="${far}"] [data-wv-busy]`).count() > 0,'a far day still shows busy time');
      const navigation = await page.evaluate(()=>{
        const last = dateKey(offsetCalendarDay(Date.now(),13));
        weekViewGoToday();
        weekViewGoToDay(last);
        const exact = weekViewDaySel === last;
        const past = dateKey(offsetCalendarDay(Date.now(),-730));
        weekViewGoToDay(past);
        return {exact,past:weekViewDaySel === past,columns:document.querySelectorAll('#week-view-body .wv-col').length};
      });
      assert(navigation.exact,'choosing the final planned day lands on that exact date');
      assert(navigation.past && navigation.columns === 14,'browsing a past year keeps a bounded strip of days');
      const appointments = await page.evaluate(()=>{
        const base = offsetCalendarDay(Date.now(),21);
        const key = dateKey(base),nextKey = dateKey(offsetCalendarDay(base,1)),cancelKey = dateKey(offsetCalendarDay(base,7));
        const data = normalize([{
          hid:'rough-recurring',name:'Night class',type:'keepup',durationMinutes:120,emoji:'📚',logs:[],
          appointment:{repeat:'weekly',startDate:key,startMinute:1410,weekdays:[new Date(base).getDay()],until:'',exceptions:{[key]:{emoji:'🌙'},[cancelKey]:{cancelled:true}}}
        }]);
        const source = weekViewRoughSource(base,data);
        const rows = weekCalendarRows(source,data,sortSettings,weekViewTopicTokenMap(sortSettings),new Set(data.map(h=>h.hid)));
        const next = weekViewRoughSource(offsetCalendarDay(base,1),data);
        const tail = weekCalendarRows(next,data,sortSettings,weekViewTopicTokenMap(sortSettings),new Set(data.map(h=>h.hid)));
        const cancelled = weekViewRoughSource(offsetCalendarDay(base,7),data);
        return {recurs:rows.events.length === 1,patch:rows.events[0]?.emoji === '🌙',overnight:tail.events[0]?.topMin === 0 && tail.events[0]?.botMin === 90,identity:source.timeline[0]?.occurrenceKey === next.timeline[0]?.occurrenceKey,cancelled:!cancelled.timeline.length};
      });
      assert(appointments.recurs && appointments.patch,'far-future recurring appointments keep their occurrence edits');
      assert(appointments.overnight && appointments.identity,'overnight appointments continue on the next day with the same identity');
      assert(appointments.cancelled,'cancelled recurring appointments stay absent');
    }
    await page.click('#week-view-today');
    await chooseOption(page,'[data-wv-days="7"]');
    assert(await page.evaluate(()=>{
      const scroller = document.querySelector('#week-view-body .wv-scroller');
      const box = scroller.getBoundingClientRect();
      const visible = [...scroller.querySelectorAll('.wv-col')].filter(col=>{
        const r = col.getBoundingClientRect();
        return Math.min(r.right,box.right) - Math.max(r.left,box.left) > r.width * 0.6;
      });
      return visible.length === 7 && document.querySelector('#week-view-body').dataset.days === '7';
    }),'Week fits all seven days on this screen');
    assert(await page.locator('#week-view-body .wv-day-head').evaluateAll(heads=>heads.every(head=>head.scrollWidth <= head.clientWidth + 1)),'seven-day date headers stay within their columns');
    await page.click('#week-view-close');
    await page.evaluate(()=>openWeekView());
    await page.waitForSelector('#week-sheet.open');
    assert(await page.locator('[data-wv-days="7"]').getAttribute('aria-pressed') === 'true','Week preference survives reopening on this screen');
    await chooseOption(page,'[data-wv-days="3"]');
    if(width === 390){
      const selected = await page.evaluate(()=>{
        weekViewGoToDay(dateKey(offsetCalendarDay(Date.now(),1)));
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
      const resized = await page.evaluate(()=>{
        const scroller = document.querySelector('#week-view-body .wv-scroller');
        const cols = [...document.querySelectorAll('#week-view-body .wv-col')];
        const box = scroller.getBoundingClientRect();
        const visible = cols.filter(col=>{
          const r = col.getBoundingClientRect();
          return Math.min(r.right,box.right) - Math.max(r.left,box.left) > r.width * 0.6;
        }).length;
        return visible === 7 && cols.length >= 14;
      });
      assert(resized,'resize observation still fits a week and keeps the later days');
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>_weekViewLayout === 'phone');
      assert(await page.locator('[data-wv-days="3"]').getAttribute('aria-pressed') === 'true' ,'resizing back restores the phone day count');
    }
    await page.close();
  }
  assert(errors.length === 0,'no page errors' + (errors.length ? ' :: ' + errors[0] : ''));
  await browser.close();
  if(fail)process.exit(1);
  console.log('\nPASS — week view interaction');
})().catch(error=>{console.error('TEST FAILED:',error);process.exit(1);});
