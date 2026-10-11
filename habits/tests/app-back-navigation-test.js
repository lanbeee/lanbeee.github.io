const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
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
    assert.deepEqual(errors,[]);
    console.log('PASS: system Back preserves cancellation, nested return paths, pickers and wide panes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
