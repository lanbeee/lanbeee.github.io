const assert = require('node:assert/strict');
const {chromium,BASE} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      const viewport = new EventTarget();
      Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
      window.addEventListener('resize',()=>{
        Object.assign(viewport,{height:innerHeight,width:innerWidth,offsetTop:0});
        viewport.dispatchEvent(new Event('resize'));
      });
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_v2','[]');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        minimalMode:false,agendaOptimizer:false,soundEffects:false,
        homeCityLat:40.7128,homeCityLng:-74.006,
        locations:[{id:'office',name:'Office',lat:40.71,lng:-74,radiusM:100},{id:'home',name:'Home',lat:40.72,lng:-74,radiusM:100}],
        weatherProfiles:[{id:'dry',name:'<img src=x onerror=top.x=1>',rules:[]}],
        blockedTimes:[
          {label:'Work',start:540,end:1020,days:[1,2,3,4,5],locationId:'office',reminderId:'work'},
          {label:'Sleep',start:1320,end:420,days:[],reminderId:'sleep'},
          {label:'Dawn',start:300,end:330,days:[],startAnchor:'fajr',reminderId:'dawn'},
          {label:'Monthly',start:720,end:750,days:[],ordinalWeekdays:[{ordinal:1,weekday:1}],reminderId:'monthly'}
        ]
      }));
    });
    await page.goto(BASE,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof openBusyManager === 'function' && typeof executeUndo === 'function');
    const blocks = ()=>page.evaluate(()=>normalizeBlockedTimes(sortSettings.blockedTimes));
    const before = await blocks();
    await page.locator('#open-about').click();
    await page.locator('#settings-blocked-head').click();
    await page.locator('#open-busy-manager').click();
    await page.waitForSelector('#busy-manager-sheet.open');
    assert.equal(await page.locator('[data-blocked-row]').count(),4);
    assert.deepEqual(await blocks(),before,'opening does not rewrite recurring rules');
    assert.equal(await page.evaluate(()=>getComputedStyle($('busy-manager-sheet')).zIndex > getComputedStyle($('about-sheet')).zIndex),true);
    await page.locator('[data-busy-filter="daily"]').click();
    assert.equal(await page.locator('[data-blocked-row]').count(),2,'monthly rules are not daily');
    await page.locator('[data-busy-filter="relative"]').click();
    assert.equal(await page.locator('[data-blocked-row]').count(),1);
    await page.locator('[data-busy-filter="all"]').click();
    await page.locator('#busy-manager-sort').selectOption('name');
    assert.equal(await page.locator('[data-blocked-label]').first().inputValue(),'Dawn');
    await page.locator('[data-blocked-label="2"]').fill('Morning');
    await page.locator('[data-blocked-label="2"]').blur();
    assert.equal((await blocks())[2].label,'Morning','sorting retains canonical indices');
    assert.equal((await blocks())[0].label,'Work');
    await page.locator('#busy-manager-search').fill('Office');
    assert.equal(await page.locator('[data-blocked-row]').count(),1,'search includes place names');
    await page.locator('#busy-bulk-toggle').click();
    await page.locator('#busy-bulk-all').click();
    assert.equal(await page.locator('[data-blocked-label="0"]').isDisabled(),true);
    await page.locator('#busy-manager-search').fill('Sleep');
    await page.locator('#busy-bulk-all').click();
    assert.equal(await page.locator('#busy-bulk-count').textContent(),'2 selected');
    await page.locator('#busy-bulk-place').selectOption('home');
    await page.locator('#busy-bulk-apply').click();
    let saved = await blocks();
    assert.equal(saved[0].locationId,'home');assert.equal(saved[1].locationId,'home');
    assert.equal(saved[2].startAnchor,'fajr','bulk edits retain dynamic rules');
    assert.deepEqual(saved[3].ordinalWeekdays,before[3].ordinalWeekdays);
    await page.evaluate(()=>executeUndo());
    assert.equal((await blocks())[0].locationId,'office','bulk edit is undoable');
    await page.locator('#busy-bulk-all').click();
    await page.locator('#busy-bulk-action').selectOption('duplicate');
    await page.locator('#busy-bulk-apply').click();
    saved = await blocks();
    assert.equal(saved.length,5);assert.equal(saved[4].label,'Sleep copy');
    assert.equal(saved[4].reminderId,undefined,'copies do not inherit reminder identity');
    await page.locator('[data-busy-select="1"]').check();
    await page.locator('#busy-bulk-apply').click();
    saved = await blocks();
    assert.equal(saved.length,6);
    assert.notEqual(saved[4].label,saved[5].label,'repeated copies retain distinct per-date override signatures');
    await page.evaluate(()=>executeUndo());
    assert.equal((await blocks()).length,5);
    await page.locator('#busy-bulk-toggle').click();
    await page.locator('[data-blocked-remove="4"]').click();
    await page.locator('#busy-bulk-toggle').click();
    assert.equal((await blocks()).length,4);
    await page.locator('#busy-bulk-all').click();
    await page.locator('#busy-bulk-action').selectOption('delete');
    await page.locator('#busy-bulk-apply').click();
    assert.equal((await blocks()).length,3);
    await page.evaluate(()=>executeUndo());
    assert.equal((await blocks()).length,4);
    await page.locator('#busy-bulk-toggle').click();
    await page.locator('#busy-manager-search').fill('no such reservation');
    assert.equal(await page.locator('[data-blocked-row]').count(),0);
    await page.locator('[data-busy-reset]').click();
    assert.equal(await page.locator('[data-blocked-row]').count(),4);
    await page.locator('#busy-manager-sort').selectOption('saved');
    await page.locator('[data-blocked-remove="1"]').click();
    assert.equal((await blocks()).length,3);
    await page.evaluate(()=>executeUndo());
    assert.equal((await blocks()).length,4,'single removal supports undo');
    await page.locator('#busy-manager-search').fill('Work');
    await page.locator('#blocked-time-add').click();
    assert.equal(await page.locator('#busy-manager-search').inputValue(),'');
    assert.equal((await blocks()).length,5);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.blockedLabel),'4');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#busy-manager-sheet.open',{state:'hidden'});
    await page.evaluate(()=>closeSettingsSheet());
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill('Draft survives');
    await page.evaluate(()=>openAddSettings('busy'));
    await page.locator('#busy-manager-close').click();
    await page.waitForSelector('#add-sheet.open');
    assert.equal(await page.locator('#ting-message').inputValue(),'Draft survives');
    await page.evaluate(()=>openAddSettings('busy'));
    await page.goBack();
    await page.waitForSelector('#add-sheet.open');
    assert.equal(await page.locator('#ting-message').inputValue(),'Draft survives','browser Back retains draft');
    await page.goForward();
    await page.waitForSelector('#busy-manager-sheet.open');
    assert.equal(await page.evaluate(()=>$('busy-manager-sheet').inert),false,'Forward restores interactive manager');
    await page.locator('#busy-manager-close').click();
    assert.equal(await page.locator('#ting-message').inputValue(),'Draft survives','Forward retains return callback');
    await page.evaluate(()=>openAddSettings('weather'));
    await page.goBack();
    await page.waitForSelector('#add-sheet.open');
    await page.goForward();
    await page.waitForSelector('#weather-manager-sheet.open');
    await page.locator('#weather-manager-close').click();
    assert.equal(await page.locator('#ting-message').inputValue(),'Draft survives','Weather Forward also retains Add draft');
    await page.evaluate(()=>{closeSheet('add-sheet');openLocationsManager();});
    await page.goBack();
    await page.waitForSelector('#locations-manager-sheet.open',{state:'hidden'});
    await page.goForward();
    await page.waitForSelector('#locations-manager-sheet.open');
    assert.equal(await page.evaluate(()=>$('locations-manager-sheet').inert),false);
    await page.evaluate(()=>{closeLocationsManager();saveLocationPatch(0,{weatherProfileId:'dry'});openLocationsManager();});
    const more = page.locator('[data-loc-more="0"]');
    assert.equal(await more.locator('img').count(),0,'saved profile names are text on initial render');
    await more.click();
    assert.equal(await more.locator('img').count(),0,'saved profile names remain text on expansion');
    assert.match(await more.textContent(),/<img src=x/);
    await page.evaluate(()=>{closeLocationsManager();openWeatherManager();});
    await page.goBack();
    await page.waitForSelector('#weather-manager-sheet.open',{state:'hidden'});
    await page.goForward();
    await page.waitForSelector('#weather-manager-sheet.open');
    assert.equal(await page.evaluate(()=>$('weather-manager-sheet').inert),false);
    await page.evaluate(()=>{closeWeatherManager();updateSortSetting({homeCityLat:null,homeCityLng:null},{renderNow:false});});
    assert.equal(await page.locator('#weather-refresh').isDisabled(),true);
    await page.evaluate(()=>updateSortSetting({homeCityLat:40.71,homeCityLng:-74},{renderNow:false}));
    assert.equal(await page.locator('#weather-refresh').isDisabled(),false);
    assert.equal(await page.locator('#weather-refresh').getAttribute('title'),'');
    await page.evaluate(()=>{
      window.__originalRefresh=refreshWeatherForecast;
      refreshWeatherForecast=()=>new Promise(resolve=>{window.__finishRefresh=resolve;});
      openWeatherManager();
    });
    await page.locator('#weather-manager-refresh').click();
    await page.evaluate(()=>renderWeatherControls());
    assert.equal(await page.locator('#weather-manager-refresh').isDisabled(),true,'rerender retains the active refresh state');
    await page.evaluate(()=>window.__finishRefresh(false));
    await page.waitForFunction(()=>!$('weather-manager-refresh').disabled);
    await page.evaluate(()=>{refreshWeatherForecast=window.__originalRefresh;closeWeatherManager();});
    await page.evaluate(()=>openBusyManager());
    for(const size of [{width:360,height:740},{width:740,height:360},{width:1280,height:900}]){
      await page.setViewportSize(size);
      await page.waitForTimeout(180);
      await page.evaluate(()=>openBusyManager());
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
        const geometry = await page.locator('#busy-manager-sheet .manager-head').boundingBox();
        assert.ok(geometry.width <= size.width && geometry.x >= 0);
      }
    }
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';openBusyManager();$('busy-manager-body').scrollTop=0;});
    await page.screenshot({path:'test-results/busy-manager-phone.png'});
    await page.locator('[data-blocked-label="4"]').focus();
    const keyboard = await page.evaluate(async()=>{
      Object.assign(visualViewport,{height:440,offsetTop:35});
      visualViewport.dispatchEvent(new Event('resize'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      keepFocusedInputVisible();
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const r=document.activeElement.getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,sheetBottom:$('busy-manager-sheet').getBoundingClientRect().bottom};
    });
    assert.ok(keyboard.top >= 35 && keyboard.bottom <= 475,'focused busy field remains above the simulated keyboard');
    assert.ok(keyboard.sheetBottom <= 476,'manager fits the visual viewport');
    await page.evaluate(()=>{
      document.activeElement.blur();Object.assign(visualViewport,{height:844,offsetTop:0});
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(()=>updateSortSetting({blockedTimes:Array.from({length:24},(_,i)=>({label:`Busy ${i}`,start:60,end:120,days:[]}))},{renderNow:false}));
    assert.equal(await page.locator('#blocked-time-add').isDisabled(),true);
    await page.evaluate(()=>addBlockedTime());
    assert.equal((await blocks()).length,24,'limit is enforced before a write');
    await page.locator('#busy-bulk-toggle').click();
    await page.locator('#busy-bulk-all').click();
    await page.locator('#busy-bulk-action').selectOption('duplicate');
    assert.equal(await page.locator('#busy-bulk-apply').isDisabled(),true,'duplication cannot silently truncate at the limit');
    await page.locator('#busy-bulk-toggle').click();
    await page.locator('[data-blocked-remove="0"]').click();
    await page.evaluate(()=>saveBlockedTimePatch(0,{label:'Newer edit'}));
    await page.evaluate(()=>executeUndo());
    assert.equal((await blocks()).length,23,'undo does not overwrite a subsequent edit');
    assert.equal((await blocks())[0].label,'Newer edit');
    assert.deepEqual(errors,[]);
    console.log('Busy manager journeys, bulk edits/undo, canonical indices, draft/history, limits, responsive layouts, and manager regressions passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
