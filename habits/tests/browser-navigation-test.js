// Real browser history must replay the page, rather than merely toggle a sentinel.
const assert = require('node:assert/strict');
const {chromium,webkit,devices} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  for(const [name,engine,device] of [
    ['Chromium',chromium,{viewport:{width:390,height:844},isMobile:true,hasTouch:true}],
    ['iPhone WebKit',webkit,devices['iPhone 13']]
  ]){
    const browser = await engine.launch();
    try{
      const context = await browser.newContext({...device,serviceWorkers:'block'});
      const page = await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{
        localStorage.clear();
        localStorage.setItem('tings_coach_install_v2','done');
        localStorage.setItem('tings_coach_essentials_v2','done');
      });
      await page.goto(BASE,{waitUntil:'networkidle'});
      await page.evaluate(habits=>{save(habits);render();},[
        baseHabit({hid:'nav-a',name:'First habit'}),baseHabit({hid:'nav-b',name:'Second habit'})
      ]);
      const stack = ()=>page.evaluate(()=>browserOpenPages().map(page=>page.id));
      const settled = ()=>page.waitForFunction(()=>!appBackHistoryCleaning && !browserNavigationQueued);
      const back = async()=>{await page.goBack();await settled();};
      const forward = async()=>{await page.goForward();await settled();};
      const home = async()=>{
        await page.evaluate(()=>{for(let i=0;i<20 && appBackPlan();i++)handleAppBack();});
        await settled();
        assert.deepEqual(await stack(),[]);
      };

      await page.evaluate(()=>openDetail(0));
      await page.evaluate(()=>{syncSettingsControls();openSheet('settings-sheet');});
      await page.evaluate(()=>openPrivacySheet());
      assert.deepEqual(await stack(),['detail-sheet','settings-sheet','privacy-sheet']);
      const endIndex = await page.evaluate(()=>history.state.tingsNavigation.index);
      const length = await page.evaluate(()=>history.length);
      for(let repeat=0;repeat<3;repeat++){
        await back();assert.deepEqual(await stack(),['detail-sheet','settings-sheet']);
        await back();assert.deepEqual(await stack(),['detail-sheet']);
        await back();assert.deepEqual(await stack(),[]);
        await forward();assert.deepEqual(await stack(),['detail-sheet']);
        assert.equal(await page.evaluate(()=>load()[detailIdx]?.hid),'nav-a');
        await forward();assert.deepEqual(await stack(),['detail-sheet','settings-sheet']);
        await forward();assert.deepEqual(await stack(),['detail-sheet','settings-sheet','privacy-sheet']);
      }
      assert.equal(await page.evaluate(()=>history.length),length,'repeated Back/Forward never adds duplicate Home entries');
      assert.equal(await page.evaluate(()=>history.state.tingsNavigation.index),endIndex);
      await home();

      // Closing a page with its own button must leave a useful Forward entry.
      await page.evaluate(()=>{
        const push=history.pushState;
        window.__snapshotOpenPages=[];
        history.pushState=function(...args){
          window.__snapshotOpenPages.push([...document.querySelectorAll('.sheet-wrap.open')].map(el=>el.id));
          return push.apply(this,args);
        };
      });
      await page.locator('#open-about').tap();
      assert.deepEqual(await page.evaluate(()=>window.__snapshotOpenPages),[[]],
        'record the outgoing Home screen before revealing the destination');
      await page.locator('#about-head-close').tap();
      await settled();
      await forward();
      assert.deepEqual(await stack(),['about-sheet']);
      await home();

      // History restoration retains scroll position after a real close/open,
      // rather than relying on an unchanged hidden DOM node.
      await page.evaluate(()=>openPrivacySheet());
      await page.locator('#privacy-sheet .about-collapse-head').first().tap();
      const scroll = await page.evaluate(()=>{
        const inner=getSheetInner('privacy-sheet');
        inner.scrollTop=240;
        return inner.scrollTop;
      });
      assert.ok(scroll > 100);
      await back();
      await page.evaluate(()=>getSheetInner('privacy-sheet').scrollTop=0);
      await forward();
      await page.waitForFunction(expected=>getSheetInner('privacy-sheet').scrollTop===expected,scroll);
      await home();

      // Utility pages whose dismissal clears their context must rebuild it.
      await page.evaluate(()=>openActivity(0));
      await back();assert.equal(await page.evaluate(()=>activityIdx),null);
      await forward();assert.equal(await page.evaluate(()=>activityIdx),0);
      await home();
      await page.evaluate(()=>openSnooze(0));
      await back();assert.equal(await page.evaluate(()=>snoozeIdx),null);
      await forward();assert.equal(await page.evaluate(()=>snoozeIdx),0);
      await home();
      await page.evaluate(()=>openValueLogSheet(0));
      await back();assert.equal(await page.evaluate(()=>valueLogIdx),null);
      await forward();assert.equal(await page.evaluate(()=>valueLogIdx),0);
      await home();
      assert.equal(await page.evaluate(()=>load()[0].logs.length),0,'navigation never logs an item');
      await page.evaluate(()=>{
        dayLogsKey=dateKey(Date.now());
        dayLogsScopeIndex=0;
        dayLogsStep='item';
        dayLogsItemIndex=0;
        renderDayLogs(dayLogsKey);
        openSheet('day-logs-sheet');
      });
      await back();assert.equal(await page.evaluate(()=>dayLogsKey),null);
      await forward();
      assert.equal(await page.evaluate(()=>dayLogsScopeIndex),0);
      assert.equal(await page.evaluate(()=>dayLogsKey),await page.evaluate(()=>dateKey(Date.now())));
      await home();

      await page.evaluate(()=>{
        const settings=loadSortSettings();
        settings.blockedTimes=[{label:'Navigation block',days:[0,1,2,3,4,5,6],start:540,end:600}];
        saveSortSettings(settings);
        openBlockEditSheet({label:'Navigation block',start:dayStart(Date.now())+540*60000,
          blockStartMin:540,blockEndMin:600,blockIndex:0});
      });
      await back();assert.equal(await page.evaluate(()=>blockEditContext),null);
      await forward();
      assert.equal(await page.evaluate(()=>blockEditContext?.blockIndex),0);
      assert.equal(await page.locator('#block-edit-start').inputValue(),'09:00');
      await home();

      // Cancellation is still cancellation; Forward reopens saved details by
      // identity even after another record has moved into its former index.
      await page.evaluate(()=>openDetail(1));
      await page.locator('#detail-name').tap();
      await page.locator('#detail-habit-message').fill('Unsaved edit');
      await back();
      assert.equal(await page.evaluate(()=>load()[1].name),'Second habit');
      await page.evaluate(()=>{const data=load();data.reverse();save(data);});
      await forward();
      assert.equal(await page.evaluate(()=>detailIdx),0);
      assert.equal(await page.locator('#detail-name').textContent(),'Second habit');
      await home();

      // The nested Settings return path must preserve the actual Add draft.
      await page.locator('#open-add').tap();
      await page.locator('#ting-message').fill('Keep this draft');
      await page.evaluate(()=>openAddSettings('defaults'));
      await back();
      assert.deepEqual(await stack(),['add-sheet']);
      assert.equal(await page.locator('#ting-message').inputValue(),'Keep this draft');
      await forward();
      assert.deepEqual(await stack(),['settings-sheet']);
      await back();
      assert.deepEqual(await stack(),['add-sheet']);
      assert.equal(await page.locator('#ting-message').inputValue(),'Keep this draft');
      await home();
      assert.equal(await page.evaluate(()=>load().length),2);

      // Back out of an in-page overlay without consuming the page underneath.
      await page.evaluate(()=>openDetail(0));
      await page.evaluate(()=>setDetailSearchOpen(true));
      await back();
      assert.deepEqual(await stack(),['detail-sheet']);
      assert.equal(await page.locator('#detail-search-panel').getAttribute('hidden'),'');
      await back();assert.deepEqual(await stack(),[]);
      await forward();assert.deepEqual(await stack(),['detail-sheet']);
      await home();

      // A new navigation after Back drops the old Forward branch normally.
      await page.evaluate(()=>openDetail(0));
      await back();
      await page.evaluate(()=>openSheet('settings-sheet'));
      assert.equal(await page.evaluate(()=>edgeNavigationPlan(-1)),null);
      await home();

      // iOS owns the snapshot animation. Even cancelable JS touch events at
      // the extreme edges must not start a competing DOM drag or consume taps.
      if(name === 'iPhone WebKit'){
        await page.evaluate(()=>openDetail(0));
        const observed = await page.evaluate(()=>{
          const target=$('detail-sheet');
          const results=[];
          for(const x of [1,innerWidth-1]){
            const touch={identifier:7,clientX:x,clientY:300,target};
            const start=new Event('touchstart',{bubbles:true,cancelable:true});
            Object.assign(start,{touches:[touch],changedTouches:[touch]});
            target.dispatchEvent(start);
            const moved={...touch,clientX:x===1 ? 210 : innerWidth-210};
            const move=new Event('touchmove',{bubbles:true,cancelable:true});
            Object.assign(move,{touches:[moved],changedTouches:[moved]});
            target.dispatchEvent(move);
            results.push({start:start.defaultPrevented,move:move.defaultPrevented,dragging:!!edgeBack,transform:target.style.transform});
          }
          return {owns:browserOwnsEdgeNavigation(),results};
        });
        assert.equal(observed.owns,true);
        assert.deepEqual(observed.results,[
          {start:false,move:false,dragging:false,transform:''},
          {start:false,move:false,dragging:false,transform:''}
        ]);
        await back();await forward();
        assert.deepEqual(await stack(),['detail-sheet']);
        await home();
      }
      assert.deepEqual(errors,[]);
      console.log(`PASS: ${name} restores nested pages, cancellation, stable habit identity, Add drafts, and Forward branches.`);
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
