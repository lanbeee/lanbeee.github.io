// Contract for the shared tap primitive (js/tap.js):
//   - one bindTap, not per-card pointer machines
//   - pointercancel recovery does not double-fire with the later click
//   - a pan does not activate cards, header pills, or the pulse button
//   - short boundary drags and abandoned touches do not recover as pill taps
//   - single taps are immediate, including rapid taps on different controls
//   - openSheet arms every sheet; a trailing wrap click cannot dismiss it
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/tap-reliability-test.js
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg, detail){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else{
    fail += 1;
    console.error('  FAIL: ' + msg + (detail ? ' :: ' + detail : ''));
  }
}

async function checkTapPrimitive(page){
  const primitive = await page.evaluate(async()=>{
    const point = (x,y,id)=>({
      bubbles:true, cancelable:true, pointerId:id || 11, pointerType:'touch',
      isPrimary:true, clientX:x, clientY:y
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const make = (label)=>{
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'blocked-card';
      el.textContent = label;
      host.appendChild(el);
      return el;
    };

    const a = make('a');
    let n = 0;
    bindTap(a,()=>{ n += 1; });
    const p = point(20, 20, 21);
    a.dispatchEvent(new PointerEvent('pointerdown', p));
    a.dispatchEvent(new PointerEvent('pointercancel', p));
    a.click();
    await new Promise(r=>setTimeout(r, 200));
    const cancelThenClick = n;

    n = 0;
    const b = make('b');
    bindTap(b,()=>{ n += 1; });
    const pan = point(20, 100, 22);
    b.dispatchEvent(new PointerEvent('pointerdown', pan));
    b.dispatchEvent(new PointerEvent('pointermove', point(20, 40, 22)));
    b.dispatchEvent(new PointerEvent('pointerup', point(20, 40, 22)));
    b.click();
    const panCount = n;

    b.dispatchEvent(new PointerEvent('pointerdown', point(20, 40, 23)));
    b.dispatchEvent(new PointerEvent('pointerup', point(20, 40, 23)));
    b.click();
    const tapAfterPan = n;

    const f = make('cancelled at the scroll boundary');
    let boundaryCount = 0;
    bindTap(f,()=>{ boundaryCount += 1; });
    const touch = (type,y)=>{
      const t = {identifier:31,target:f,clientX:20,clientY:y};
      const event = new Event(type,{bubbles:true});
      Object.defineProperties(event,{
        changedTouches:{value:[t]},touches:{value:type === 'touchend' ? [] : [t]}
      });
      f.dispatchEvent(event);
    };
    f.dispatchEvent(new PointerEvent('pointerdown', point(20, 20, 31)));
    touch('touchstart',20);
    f.dispatchEvent(new PointerEvent('pointercancel', point(20, 20, 31)));
    await new Promise(r=>setTimeout(r,100));
    const whileFingerDown = boundaryCount;
    touch('touchmove',80);
    touch('touchend',80);
    await new Promise(r=>setTimeout(r,100));

    // A cancelled tap that stays still should recover only after release,
    // preserving the child target (e.g. a weather chip) and consuming its click.
    const chip = document.createElement('span');
    const g = make('stationary cancellation');
    g.appendChild(chip);
    const targets = [];
    bindTap(g,e=>targets.push(e.target === chip));
    const stationaryTouch = type=>{
      const t = {identifier:32,target:chip,clientX:20,clientY:20};
      const event = new Event(type,{bubbles:true});
      Object.defineProperties(event,{
        changedTouches:{value:[t]},touches:{value:type === 'touchend' ? [] : [t]}
      });
      chip.dispatchEvent(event);
    };
    chip.dispatchEvent(new PointerEvent('pointerdown', point(20,20,32)));
    stationaryTouch('touchstart');
    chip.dispatchEvent(new PointerEvent('pointercancel', point(20,20,32)));
    await new Promise(r=>setTimeout(r,100));
    const stationaryBeforeRelease = targets.length;
    stationaryTouch('touchend');
    await new Promise(r=>setTimeout(r,100));
    chip.click();

    const held = make('released before the hold limit');
    let heldCount = 0;
    bindTap(held,()=>{heldCount += 1;},{holdMs:120});
    held.dispatchEvent(new PointerEvent('pointerdown',point(20,20,33)));
    await new Promise(r=>setTimeout(r,90));
    held.dispatchEvent(new PointerEvent('pointerup',point(20,20,33)));
    await new Promise(r=>setTimeout(r,100));

    const singles = [];
    const c = make('c');
    const d = make('d');
    bindTap(c,()=>singles.push('c'));
    bindTap(d,()=>singles.push('d'));
    c.click();
    const immediate = singles.slice();
    d.click();
    c.click();

    host.remove();
    return {
      cancelThenClick,
      panCount,
      tapAfterPan,
      whileFingerDown,
      boundaryCount,
      stationaryBeforeRelease,
      targets,
      heldCount,
      immediate,
      singles
    };
  });
  assert(primitive.cancelThenClick === 1,
    'a cancelled tap plus its trailing click activate once',
    JSON.stringify(primitive));
  assert(primitive.panCount === 0,
    'a pan does not activate the control',
    JSON.stringify(primitive));
  assert(primitive.tapAfterPan === 1,
    'a new deliberate tap immediately after a pan is accepted',JSON.stringify(primitive));
  assert(primitive.whileFingerDown === 0 && primitive.boundaryCount === 0,
    'a cancelled boundary drag never activates, even before scrollTop changes',JSON.stringify(primitive));
  assert(primitive.stationaryBeforeRelease === 0 && primitive.targets.length === 1 && primitive.targets[0],
    'a stationary cancelled tap waits for release, preserves its child target and fires once',JSON.stringify(primitive));
  assert(primitive.heldCount === 1,
    'recovery delay does not turn an accepted press into a long hold',JSON.stringify(primitive));
  assert(primitive.immediate.join() === 'c' && primitive.singles.join() === 'c,d,c',
    'single taps activate immediately and rapid taps never become a different action',
    JSON.stringify(primitive));

}

// Exercise the real day-header binding and the document button fallback,
// especially pans that cannot change scrollTop at the end of the page.
async function checkHomeButtonBoundaries(page){
  const results = await page.evaluate(async()=>{
    const host = document.createElement('div');
    host.className = 'section-header';
    document.body.appendChild(host);
    const results = [];
    for(const cls of ['dropped-pill','free-pill','weather-day-button','planner-state-indicator']){
      const button = document.createElement('button');
      button.className = cls;
      host.appendChild(button);
      let opened = 0;
      if(cls === 'planner-state-indicator')button.addEventListener('click',()=>opened++);
      else bindDayHeaderPill(button,()=>opened++);
      const point = y=>({bubbles:true,cancelable:true,pointerId:81,pointerType:'touch',isPrimary:true,clientX:20,clientY:y});
      const touch = (type,y)=>{
        const event = new Event(type,{bubbles:true});
        const t = {identifier:81,target:button,clientX:20,clientY:y};
        Object.defineProperties(event,{
          changedTouches:{value:[t]},touches:{value:type === 'touchend' || type === 'touchcancel' ? [] : [t]}
        });
        button.dispatchEvent(event);
      };
      button.dispatchEvent(new PointerEvent('pointerdown',point(20)));
      touch('touchstart',20);
      button.dispatchEvent(new PointerEvent('pointercancel',point(24)));
      touch('touchmove',44);
      touch('touchend',44);
      await new Promise(r=>setTimeout(r,180));
      const boundaryOpened = opened;
      // A real touch cancellation is abandonment, not a finger release.
      button.dispatchEvent(new PointerEvent('pointerdown',point(20)));
      touch('touchstart',20);
      button.dispatchEvent(new PointerEvent('pointercancel',point(20)));
      touch('touchcancel',20);
      await new Promise(r=>setTimeout(r,180));
      const cancelledOpened = opened;
      button.dispatchEvent(new PointerEvent('pointerdown',point(20)));
      touch('touchstart',20);
      button.dispatchEvent(new PointerEvent('pointerup',point(20)));
      touch('touchend',20);
      button.click();
      await new Promise(r=>setTimeout(r,180));
      results.push({cls,boundaryOpened,cancelledOpened,tapped:opened});
      button.remove();
    }
    host.remove();
    return results;
  });
  for(const result of results){
    assert(result.boundaryOpened === 0,
      `${result.cls}: a short vertical boundary drag never activates`,JSON.stringify(result));
    assert(result.cancelledOpened === 0,
      `${result.cls}: touchcancel never activates`,JSON.stringify(result));
    assert(result.tapped === 1,
      `${result.cls}: a fresh deliberate tap after rejection activates once`,JSON.stringify(result));
  }
}

async function checkNativeHeaderScrolling(page){
  await page.evaluate(()=>{
    const host = document.createElement('div');
    host.id = 'native-header-fixture';
    host.style.cssText = 'position:fixed;inset:120px 20px auto;height:400px;overflow:auto;overscroll-behavior:contain;background:var(--bg);z-index:10;';
    document.body.appendChild(host);
    window.__headerActivations = 0;
    for(const cls of ['dropped-pill','free-pill','weather-day-button','planner-state-indicator']){
      const header = document.createElement('div');
      header.className = 'section-header';
      header.style.cssText = 'position:static;height:50px;';
      const button = document.createElement('button');
      button.className = cls;
      button.textContent = cls;
      button.style.cssText = 'position:relative;right:auto;top:auto;transform:none;min-width:100px;min-height:32px;touch-action:pan-y;';
      header.appendChild(button);
      host.appendChild(header);
      const activate = ()=>window.__headerActivations++;
      if(cls === 'planner-state-indicator')button.addEventListener('click',activate);
      else bindDayHeaderPill(button,activate);
    }
    const filler = document.createElement('div');
    filler.style.height = '1200px';
    host.appendChild(filler);
  });
  const cdp = await page.context().newCDPSession(page);
  for(const cls of ['dropped-pill','free-pill','weather-day-button','planner-state-indicator']){
    const button = page.locator(`#native-header-fixture .${cls}`);
    for(const dy of [-96,24]){
      await page.evaluate(()=>{
        const host = document.getElementById('native-header-fixture');
        host.style.overflow = 'hidden';
        host.scrollTop = 0;
        host.style.overflow = 'auto';
        window.__headerActivations = 0;
      });
      const box = await button.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let i=1;i<=8;i++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/8,id:1}]});
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(200);
      const state = await page.evaluate(()=>({
        top:document.getElementById('native-header-fixture').scrollTop,
        activations:window.__headerActivations
      }));
      assert(state.activations === 0 && (dy > 0 ? state.top === 0 : state.top > 20),
        `${cls}: native ${dy > 0 ? 'short drag at the top boundary' : 'scroll'} does not activate`,JSON.stringify(state));
    }
    await button.tap();
    await page.waitForTimeout(180);
    assert(await page.evaluate(()=>window.__headerActivations) === 1,
      `${cls}: deliberate native tap still works after scrolling`);
  }
  await cdp.detach();
  await page.evaluate(()=>document.getElementById('native-header-fixture').remove());
}

async function checkNativeScrolling(page){
  await page.evaluate(()=>{
    const host = document.createElement('div');
    host.id = 'native-tap-fixture';
    host.style.cssText = 'position:fixed;inset:120px 20px auto;height:550px;overflow:auto;overscroll-behavior:contain;background:var(--bg);z-index:10;';
    document.body.appendChild(host);
    const day = dayStart(Date.now());
    appendHomeBlockedCard(host,{label:'Work',start:day+9*3600000,end:day+17*3600000});
    appendHomeTravelCard(host,'home','office',Date.now()+3600000);
    const original = document.querySelector('#list .swipe-row');
    // Move the mounted row so its actual pulse/action handlers stay attached.
    host.appendChild(original);
    const filler = document.createElement('div');
    filler.style.height = '1200px';
    host.appendChild(filler);
  });
  const cdp = await page.context().newCDPSession(page);
  for(const [selector,sheet] of [
    ['.blocked-card:not(.blocked-card-merge)','#block-edit-sheet'],
    ['.travel-card','#travel-edit-sheet'],
    ['.ting-card','#detail-sheet'],
    ['.blocked-cancel-mark',null],
    ['[data-pulse]',null]
  ]){
    await page.evaluate(()=>{
      const host = document.getElementById('native-tap-fixture');
      host.style.overflow = 'hidden'; // stop the previous flick's momentum
      host.scrollTop = 0;
      host.style.overflow = 'auto';
      const settings = loadSortSettings();
      window.__tapSettingsBefore = JSON.stringify([settings.cancelledBlocks,settings.availabilityOverrides]);
      window.__tapDataBefore = JSON.stringify(load().map(h=>h.logs));
    });
    const card = page.locator(`#native-tap-fixture ${selector}`).first();
    const box = await card.boundingBox();
    const x = box.x + (selector === '.blocked-cancel-mark' ? box.width / 2 : 24);
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let i=1;i<=8;i++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*12,id:1}]});
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(150);
    const state = await page.evaluate(()=>{
      const settings = loadSortSettings();
      return {
        top:document.getElementById('native-tap-fixture').scrollTop,
        open:Boolean(document.querySelector('.sheet-wrap.open')),
        unchanged:window.__tapSettingsBefore === JSON.stringify([settings.cancelledBlocks,settings.availabilityOverrides])
          && window.__tapDataBefore === JSON.stringify(load().map(h=>h.logs))
      };
    });
    assert(state.top > 20 && !state.open && state.unchanged,
      `native scrolling from ${selector} scrolls without opening or cancelling anything`,JSON.stringify(state));
    if(sheet){
      await page.evaluate(()=>{
        const host = document.getElementById('native-tap-fixture');
        host.style.overflow = 'hidden';
        host.scrollTop = 0;
        host.style.overflow = 'auto';
      });
      await card.tap();
      assert(await page.locator(`${sheet}.open`).count() === 1,
        `a deliberate native tap on ${selector} opens immediately after scrolling`);
      await page.evaluate(id=>closeSheet(id),sheet.slice(1));
    }
  }
  await cdp.detach();
  await page.evaluate(()=>document.getElementById('native-tap-fixture').remove());
}

(async()=>{
  const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const tapAt = html.indexOf('js/tap.js');
  const homeAt = html.indexOf('js/list-view-home.js');
  const actionsAt = html.indexOf('js/list-view-actions.js');
  assert(tapAt !== -1 && tapAt < homeAt && homeAt < actionsAt,
    'tap.js loads before the home-list scripts that call bindTap');

  const sw = fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  assert(sw.includes("'./js/tap.js'") || sw.includes('"./js/tap.js"'),
    'the service worker precaches tap.js');

  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.addInitScript(()=>{
    const day = new Date(2026,6,22).getTime();
    localStorage.setItem('tings_v2', JSON.stringify([
      {name:'Tap fixture',type:'task',dueDate:day,durationMinutes:30,
        logs:[],lastLog:null,priority:2,locationIds:[],anywhereAllowed:true},
      {name:'Second fixture',type:'task',dueDate:day,durationMinutes:20,
        logs:[],lastLog:null,priority:2,locationIds:[],anywhereAllowed:true}
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', agendaOptimizer:false, homeExtraMode:'cards',
      availabilityMinutes:[600,600,600,600,600,600,600],
      defaultTravelMode:'walking',
      locations:[
        {id:'home',name:'Home',lat:40.712776,lng:-74.005974,radiusM:150},
        {id:'office',name:'Office',lat:40.706192,lng:-74.008770,radiusM:150}
      ],
      blockedTimes:[{label:'Work',days:[0,1,2,3,4,5,6],start:540,end:1020}]
    }));
  });
  await page.goto(BASE,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof bindTap === 'function' && typeof openSheet === 'function');

  await checkTapPrimitive(page);
  await checkHomeButtonBoundaries(page);

  const sheetGuard = await page.evaluate(()=>{
    document.querySelectorAll('.sheet-wrap.open').forEach(el=>el.classList.remove('open'));
    openSheet('add-sheet');
    const armed = sheetBackdropArmed('add-sheet');
    const wrap = document.getElementById('add-sheet');
    wrap.click();
    const stillOpen = wrap.classList.contains('open');
    closeSheet('add-sheet');
    return {armed, stillOpen};
  });
  assert(sheetGuard.armed && sheetGuard.stillOpen,
    'openSheet arms every sheet so a trailing wrap click cannot dismiss it',
    JSON.stringify(sheetGuard));

  const travelCancel = await page.evaluate(async()=>{
    const point = (x,y,id)=>({
      bubbles:true, cancelable:true, pointerId:id || 11, pointerType:'touch',
      isPrimary:true, clientX:x, clientY:y
    });
    document.querySelectorAll('.sheet-wrap.open').forEach(el=>el.classList.remove('open'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    appendHomeTravelCard(host,'home','office',Date.now() + 3600000);
    const el = host.querySelector('.travel-card');
    if(!el){ host.remove(); return {missing:true}; }
    const r = el.getBoundingClientRect();
    const p = point(r.left + 24, r.top + r.height / 2, 31);
    el.dispatchEvent(new PointerEvent('pointerdown', p));
    el.dispatchEvent(new PointerEvent('pointercancel', p));
    await new Promise(res=>setTimeout(res, 250));
    await new Promise(res=>setTimeout(res, 350));
    const open = Boolean(document.querySelector('#travel-edit-sheet.open'));
    host.remove();
    closeSheet('travel-edit-sheet');
    return {open};
  });
  assert(travelCancel.open && !travelCancel.missing,
    'a cancelled stationary press still opens the travel editor',
    JSON.stringify(travelCancel));

  await checkNativeHeaderScrolling(page);
  await checkNativeScrolling(page);
  await browser.close();

  const webkitBrowser = await webkit.launch({headless:true});
  const webkitPage = await webkitBrowser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await webkitPage.addInitScript(()=>{
    const today = new Date();
    const day = new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
    localStorage.setItem('tings_v2', JSON.stringify([
      {name:'Blocked tap fixture',type:'task',dueDate:day,durationMinutes:30,
        logs:[],lastLog:null,priority:2,locationIds:[],anywhereAllowed:true},
      {name:'Second tap fixture',type:'task',dueDate:day,durationMinutes:20,
        logs:[],lastLog:null,priority:2,locationIds:[],anywhereAllowed:true}
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', agendaOptimizer:false, homeExtraMode:'cards',
      availabilityMinutes:[600,600,600,600,600,600,600], locations:[],
      blockedTimes:[{label:'Work',days:[0,1,2,3,4,5,6],start:540,end:1020}]
    }));
  });
  await webkitPage.goto(BASE,{waitUntil:'networkidle'});
  await webkitPage.waitForSelector('.blocked-card:not(.blocked-card-merge), #list .ting-card');
  await checkTapPrimitive(webkitPage);
  await checkHomeButtonBoundaries(webkitPage);

  const webkitBlock = await webkitPage.evaluate(async()=>{
    const el = document.querySelector('.blocked-card:not(.blocked-card-merge)');
    if(!el)return {missing:true};
    const r = el.getBoundingClientRect();
    const p = {
      bubbles:true, cancelable:true, pointerId:11, pointerType:'touch', isPrimary:true,
      clientX:r.left + 24, clientY:r.top + r.height / 2
    };
    el.dispatchEvent(new PointerEvent('pointerdown', p));
    el.dispatchEvent(new PointerEvent('pointercancel', p));
    await new Promise(res=>setTimeout(res, 250));
    return {open:Boolean(document.querySelector('#block-edit-sheet.open'))};
  });
  assert(webkitBlock.open && !webkitBlock.missing,
    'WebKit pointercancel still opens the blocked-time editor',
    JSON.stringify(webkitBlock));
  await webkitPage.evaluate(()=>document.getElementById('block-edit-sheet')?.classList.remove('open'));

  const webkitHabit = await webkitPage.evaluate(async()=>{
    const el = document.querySelector('#list .ting-card');
    if(!el)return {missing:true};
    const r = el.getBoundingClientRect();
    const p = {
      bubbles:true, cancelable:true, pointerId:12, pointerType:'touch', isPrimary:true,
      clientX:r.left + 24, clientY:r.top + r.height / 2
    };
    el.dispatchEvent(new PointerEvent('pointerdown', p));
    el.dispatchEvent(new PointerEvent('pointercancel', p));
    await new Promise(res=>setTimeout(res, 500));
    const name = (document.querySelector('#detail-name')?.textContent || '').trim();
    return {
      open:Boolean(document.querySelector('#detail-sheet.open') || document.body.classList.contains('pane-active')),
      name
    };
  });
  assert(webkitHabit.open && !webkitHabit.missing,
    'WebKit pointercancel still opens a habit card’s detail',
    JSON.stringify(webkitHabit));

  await webkitBrowser.close();

  if(fail){
    console.log(`\n${fail} FAILURES`);
    process.exit(1);
  }
  console.log(`\nPASS - ${pass} tap-reliability checks`);
})().catch(error=>{ console.error(error); process.exit(1); });
