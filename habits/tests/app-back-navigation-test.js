const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    const back=async()=>assert.equal(await page.evaluate(()=>handleAppBack()),true);
    const closed=async id=>assert.equal(await page.locator('#'+id).evaluate(el=>el.classList.contains('open')),false,id+' closed');
    await page.evaluate(h=>{save([h]);openDetail(0);},baseHabit({hid:'back-fixture',name:'Walk'}));
    await page.evaluate(()=>{syncSettingsControls();openSheet('settings-sheet');});
    await back();await closed('settings-sheet');
    assert.ok(await page.locator('#detail-sheet.open').count(),'settings returns to detail');
    await back();await closed('detail-sheet');
    assert.equal(await page.evaluate(()=>detailIdx),null,'detail state is cleaned up');

    // Unsaved detail edits take the same cancellation path as Cancel.
    await page.evaluate(()=>openDetail(0));
    await page.locator('#detail-name').click();
    await page.locator('#detail-habit-message').fill('Unsaved name');
    await back();
    assert.ok(await page.locator('#detail-sheet.open').count(),'Back cancels editing inside detail');
    assert.equal(await page.locator('#detail-habit-message').inputValue(),'Walk');
    await back();await closed('detail-sheet');
    assert.equal(await page.evaluate(()=>load()[0].name),'Walk');
    await page.evaluate(()=>openDetail(0));
    assert.equal(await page.locator('#detail-name').textContent(),'Walk');
    await page.evaluate(()=>setDetailSearchOpen(true));
    await back();
    assert.equal(await page.locator('#detail-search-panel').getAttribute('hidden'),'');
    assert.ok(await page.locator('#detail-sheet.open').count(),'Back dismisses detail search first');
    await page.evaluate(()=>{window.__tingsForceTimePicker=true;openTimePicker(document.querySelector('#detail-allowed-time-row input[type=time]'));});
    await back();
    assert.equal(await page.locator('#time-step-picker').evaluate(el=>el.classList.contains('open')),false);
    assert.ok(await page.locator('#detail-sheet.open').count(),'time picker dismissal leaves details open');
    await back();
    assert.ok(await page.locator('#detail-sheet.open').count(),'Back cancels the time picker edit before leaving detail');
    await back();

    // Settings opened from Add must return to the intact draft.
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill('Draft habit');
    await page.evaluate(()=>openAddSettings('defaults'));
    await back();await closed('settings-sheet');
    assert.ok(await page.locator('#add-sheet.open').count());
    assert.equal(await page.locator('#ting-message').inputValue(),'Draft habit');
    await back();await closed('add-sheet');
    assert.equal(await page.evaluate(()=>load().length),1,'cancel add does not save a draft');

    // Dismissal selection follows the visible layer, rather than DOM order.
    await page.evaluate(()=>{openSheet('overview-sheet');openSheet('weather-context-sheet');openSheet('weather-metric-sheet');});
    await back();await closed('weather-metric-sheet');
    assert.ok(await page.locator('#weather-context-sheet.open').count());
    await back();await closed('weather-context-sheet');
    assert.ok(await page.locator('#overview-sheet.open').count());
    await back();await closed('overview-sheet');

    // Every standard sheet uses an existing exit control, including utility sheets.
    const ids=await page.evaluate(()=>[...document.querySelectorAll('.sheet-wrap')].map(el=>el.id));
    for(const id of ids){
      if(['detail-sheet','day-logs-sheet','assistant-sheet'].includes(id))continue;
      const result=await page.evaluate(id=>{
        openSheet(id);
        const button=getSheetInner(id).querySelector('[data-sheet-dismissal]');
        let clicked=false;
        const observe=()=>{clicked=true;};
        button?.addEventListener('click',observe,{once:true});
        const handled=handleAppBack();
        button?.removeEventListener('click',observe);
        closeSheet(id);
        return {clicked,handled};
      },id);
      assert.deepEqual(result,{clicked:true,handled:true},id+' uses its existing dismissal button');
    }
    await page.setViewportSize({width:1100,height:800});
    await page.evaluate(()=>openDetail(0));
    await back();
    assert.equal(await page.evaluate(()=>getPane().dataset.activeSheet),undefined,'wide detail pane closes too');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{openSheet('overview-sheet');openSheet('weather-context-sheet');});
    await page.goBack();
    await page.waitForFunction(()=>!$('weather-context-sheet').classList.contains('open'));
    assert.ok(await page.locator('#overview-sheet.open').count(),'browser Back dismisses only the top sheet');
    await page.goBack();
    await page.waitForFunction(()=>!$('overview-sheet').classList.contains('open'));
    assert.equal(new URL(page.url()).pathname,'/','browser Back stays inside the app');
    await page.evaluate(()=>openSheet('about-sheet'));
    await page.locator('#about-head-close').click();
    await page.waitForFunction(()=>!appBackHistoryCleaning && !appBackHistoryArmed);
    assert.equal(await page.evaluate(()=>Boolean(history.state?.tingsSheetBack)),false,'button dismissal consumes sheet history too');
    assert.equal(await page.evaluate(()=>handleAppBack()),false,'Home is the only unhandled Back');
    await page.evaluate(()=>{
      const nativeBefore=window.Capacitor;
      const stateBefore=history.state;
      window.Capacitor={isNativePlatform:()=>true};
      openSheet('settings-sheet');
      if(history.state !== stateBefore)throw new Error('Native sheets must not create browser history');
      if(!handleAppBack() || $('settings-sheet').classList.contains('open'))throw new Error('Native Back must still close settings');
      window.Capacitor=nativeBefore;
    });
    const swipeEdge = async({edge='left', target='body', distance='commit', y=300, release=true}={})=>{
      return page.evaluate(({edge, target, distance, y, release})=>{
        const el = document.querySelector(target);
        if(!el)throw new Error('missing '+target);
        const width = window.innerWidth;
        const from = edge === 'left' ? 8 : width - 8;
        const travel = distance === 'commit' ? Math.max(170, width * 0.55) : distance === 'vertical' ? 6 : 22;
        const toX = edge === 'left' ? from + travel : from - travel;
        const toY = distance === 'vertical' ? y + 160 : y;
        const fire = (type, x, yy)=>{
          const touch = new Touch({
            identifier:4, target:el, clientX:x, clientY:yy, pageX:x, pageY:yy, screenX:x, screenY:yy, radiusX:1, radiusY:1, force:0.5
          });
          el.dispatchEvent(new TouchEvent(type, {
            bubbles:true, cancelable:true, composed:true,
            touches:type === 'touchend' ? [] : [touch],
            changedTouches:[touch]
          }));
        };
        if(release === 'end')fire('touchend', toX, toY);
        else{
          fire('touchstart', from, y);
          fire('touchmove', toX, toY);
          if(release)fire('touchend', toX, toY);
        }
        const wrap = el.closest('.sheet-wrap');
        const hint = document.getElementById('edge-back-hint');
        return {
          dragging:!!wrap?.classList.contains('edge-back-dragging'),
          transform:wrap?.style.transform || '',
          hint:!!hint?.classList.contains('show')
        };
      }, {edge, target, distance, y, release});
    };
    const edgeSettled = ()=>page.waitForFunction(()=>!document.querySelector('.edge-back-dragging,.edge-back-settle,.edge-back-hold'));

    await page.evaluate(()=>openSheet('settings-sheet'));
    let mid = await swipeEdge({target:'#settings-sheet .settings-stack', distance:'short', release:false});
    assert.equal(mid.dragging, true, 'short bezel drag tracks the sheet');
    assert.match(mid.transform, /^translate3d\([1-9]/, mid.transform);
    await swipeEdge({release:'end'});
    await edgeSettled();
    assert.ok(await page.locator('#settings-sheet.open').count(), 'a short edge drag does not dismiss');
    assert.equal(await page.evaluate(()=>$('settings-sheet').style.transform), '');

    await swipeEdge({target:'#settings-sheet .settings-stack', distance:'vertical'});
    assert.ok(await page.locator('#settings-sheet.open').count(), 'a vertical bezel drag does not dismiss');

    await swipeEdge({target:'#settings-close', edge:'right'});
    assert.ok(await page.locator('#settings-sheet.open').count(), 'a control in the bezel keeps its tap');

    mid = await swipeEdge({target:'#settings-sheet .settings-stack', release:false});
    assert.match(mid.transform, /^translate3d\([1-9]/, 'left edge drags the page right');
    await swipeEdge({release:'end'});
    await page.waitForFunction(()=>!$('settings-sheet').classList.contains('open'));
    await edgeSettled();
    assert.equal(await page.evaluate(()=>Boolean(history.state?.tingsSheetBack)), false, 'edge dismiss consumes the history entry');
    assert.equal(new URL(page.url()).pathname, '/', 'edge dismiss stays inside the app');

    await page.evaluate(h=>{save([h]);openDetail(0);openSheet('settings-sheet');}, baseHabit({hid:'edge-fixture', name:'Walk'}));
    mid = await swipeEdge({edge:'right', target:'#settings-sheet .settings-stack'});
    assert.equal(mid.transform, '', 'right edge does not go Back when there is no Forward page');
    assert.ok(await page.locator('#settings-sheet.open').count());
    await swipeEdge({target:'#settings-sheet .settings-stack'});
    await page.waitForFunction(()=>!$('settings-sheet').classList.contains('open') && !appBackHistoryCleaning);
    assert.ok(await page.locator('#detail-sheet.open').count(), 'left edge dismisses only the top page');
    await edgeSettled();
    mid = await swipeEdge({edge:'right', target:'#detail-sheet .detail-page', release:false});
    assert.equal(mid.hint, true, 'right edge previews Forward');
    assert.equal(mid.transform, '', 'Forward leaves the current page in place');
    await swipeEdge({edge:'right', release:'end'});
    await page.waitForFunction(()=>$('settings-sheet').classList.contains('open'));
    assert.ok(await page.locator('#detail-sheet.open').count(), 'Forward restores Settings above the same habit');
    await swipeEdge({target:'#settings-sheet .settings-stack'});
    await page.waitForFunction(()=>!$('settings-sheet').classList.contains('open') && !appBackHistoryCleaning);
    await edgeSettled();
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!$('detail-sheet').classList.contains('open'));
    await edgeSettled();

    await page.evaluate(()=>openDetail(0));
    await page.locator('#detail-name').click();
    await page.locator('#detail-habit-message').fill('Unsaved name');
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!getSheetInner('detail-sheet').classList.contains('tune-dirty'));
    assert.ok(await page.locator('#detail-sheet.open').count(),'edge back cancels editing inside detail');
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!$('detail-sheet').classList.contains('open'));
    assert.equal(await page.evaluate(()=>load()[0].name), 'Walk', 'edge back cancels unsaved edits');

    await page.evaluate(()=>{openDetail(0);setDetailSearchOpen(true);});
    mid = await swipeEdge({target:'#detail-sheet .detail-search-panel', release:false});
    assert.equal(mid.hint, true, 'in-page back shows the edge hint');
    assert.equal(mid.dragging, false, 'in-page back does not drag the whole sheet');
    await swipeEdge({release:'end'});
    await page.waitForFunction(()=>$('detail-search-panel').hidden);
    assert.ok(await page.locator('#detail-sheet.open').count(), 'edge back closes detail search before the page');
    await page.evaluate(()=>{window.__tingsForceTimePicker=true;openTimePicker(document.querySelector('#detail-allowed-time-row input[type=time]'));});
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!$('time-step-picker').classList.contains('open'));
    assert.ok(await page.locator('#detail-sheet.open').count(), 'edge back closes the time picker before the page');
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!getSheetInner('detail-sheet').classList.contains('tune-dirty'));
    assert.ok(await page.locator('#detail-sheet.open').count(),'edge back cancels the time picker edit before leaving detail');
    await swipeEdge({target:'#detail-sheet .detail-page'});
    await page.waitForFunction(()=>!$('detail-sheet').classList.contains('open'));
    await edgeSettled();

    await page.evaluate(()=>document.querySelector('.bottom-nav').classList.add('search-open'));
    await swipeEdge({target:'#list'});
    await page.waitForFunction(()=>!isSearchOpen());

    await page.evaluate(()=>{
      const nativeBefore=window.Capacitor;
      window.Capacitor={isNativePlatform:()=>true};
      openSheet('settings-sheet');
      window.__tingsNativeBefore=nativeBefore;
    });
    await swipeEdge({target:'#settings-sheet .settings-stack'});
    await swipeEdge({edge:'right',target:'#settings-sheet .settings-stack'});
    assert.ok(await page.locator('#settings-sheet.open').count(), 'the installed Android shell keeps the system back gesture');
    await page.evaluate(()=>{
      handleAppBack();
      window.Capacitor=window.__tingsNativeBefore;
    });
    await page.waitForFunction(()=>!$('settings-sheet').classList.contains('open'));

    await page.evaluate(()=>{openSheet('overview-sheet');openSheet('weather-context-sheet');});
    await swipeEdge({target:'#weather-context-sheet .sheet'});
    await page.waitForFunction(()=>!$('weather-context-sheet').classList.contains('open'));
    assert.ok(await page.locator('#overview-sheet.open').count(), 'edge back leaves the page underneath');
    await page.goBack();
    await page.waitForFunction(()=>!$('overview-sheet').classList.contains('open'));
    assert.equal(new URL(page.url()).pathname, '/', 'browser Back still dismisses after an edge swipe');

    // Native touch input exercises the browser's scroll/click defaults, which
    // dispatching synthetic TouchEvents above cannot verify.
    await page.evaluate(()=>openSheet('privacy-sheet'));
    await page.locator('#privacy-sheet .about-collapse-head').first().click();
    const cdp = await context.newCDPSession(page);
    const touchDrag = async(from,to)=>{
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
      for(let step = 1;step <= 20;step += 1){
        const point = {x:from.x + (to.x - from.x) * step / 20,y:from.y + (to.y - from.y) * step / 20};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    for(const x of [24,366]){
      await page.evaluate(()=>document.querySelector('#privacy-sheet .privacy-sheet').scrollTop = 0);
      await touchDrag({x,y:420},{x,y:160});
      await page.waitForFunction(()=>document.querySelector('#privacy-sheet .privacy-sheet').scrollTop > 100);
      assert.ok(await page.locator('#privacy-sheet.open').count(), 'vertical edge scrolling leaves the sheet open');
      await page.waitForTimeout(300);
    }
    await page.evaluate(()=>{
      document.querySelector('#privacy-sheet .privacy-sheet').scrollTop = 0;
      window.__edgeTapCount = 0;
      $('privacy-sheet').addEventListener('click',()=>{window.__edgeTapCount += 1;},{once:true});
    });
    await page.touchscreen.tap(24,420);
    assert.equal(await page.evaluate(()=>window.__edgeTapCount),1,'an edge tap retains its native click');
    await touchDrag({x:24,y:420},{x:220,y:420});
    await page.waitForFunction(()=>!$('privacy-sheet').classList.contains('open'));
    await edgeSettled();
    assert.equal(new URL(page.url()).pathname, '/', 'a native horizontal touch still performs edge Back');

    // Opening a new page during an unfinished drag cancels that old gesture.
    await page.evaluate(()=>openDetail(0));
    await swipeEdge({target:'#detail-sheet .detail-page',release:false});
    await page.evaluate(()=>openDetail(0));
    await swipeEdge({release:'end'});
    await edgeSettled();
    assert.ok(await page.locator('#detail-sheet.open').count(), 'a stale edge drag cannot dismiss a newly opened page');
    await back();

    assert.deepEqual(errors,[]);
    console.log('PASS: system Back preserves cancellation, nested return paths, pickers and wide panes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
