// Shared phone UI: clear-or-close, retained conversations, spacing and motion.
// Keyboard geometry is simulated; no model inference or personal storage.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit,devices}=require('playwright');
const {BASE,baseHabit,waitForAssistant}=require('./helpers/planner-test-helpers');

(async()=>{
  fs.mkdirSync('test-results/detail-refinements',{recursive:true});
  for(const [name,engine,profile,safeBottom] of [
    ['iphone-x',webkit,devices['iPhone X'],34],
    ['iphone-15',webkit,{...devices['iPhone 13'],viewport:{width:393,height:852}},34],
    ['pixel-7-pro',chromium,{...devices['Pixel 7'],viewport:{width:412,height:892}},0]
  ]){
    const browser=await engine.launch();
    try{
      const page=await browser.newPage({...profile,serviceWorkers:'block'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({item,safeBottom})=>{
        localStorage.setItem('tings_v2',JSON.stringify([item]));
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({localAssistant:true,
          localAssistantProvider:'needle',minimalMode:false,agendaOptimizer:false,showWeekOnHome:false}));
        for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
        document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.setProperty('--safe-area-inset-bottom',`${safeBottom}px`));
      },{item:baseHabit({hid:'motion',name:'Walk',durationMinutes:20}),safeBottom});
      await page.goto(BASE);await waitForAssistant(page);
      await page.locator('#launch-screen').waitFor({state:'hidden'});
      const settle=()=>page.evaluate(async()=>{
        await Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
      });
      const input=page.locator('#detail-ask-input');
      const close=page.locator('#detail-cool');
      const before=await page.evaluate(()=>load());
      for(const minimal of [false,true]){
        await page.evaluate(minimal=>{setMinimalMode(minimal);openDetail(0);assistantNeedleCanSend=()=>true;syncDetailSummaryDock();},minimal);
        assert.equal(await page.evaluate(()=>sheetEnterMotions.get($('detail-sheet'))?.playState),'running','phone page slides in');
        assert.equal(await page.evaluate(()=>$('detail-sheet').getBoundingClientRect().left),0,'the opaque cover stays in place during entry');
        await settle();
        const gap=await page.evaluate(()=>innerHeight-getSheetInner('detail-sheet').querySelector('.sheet-search-dock').getBoundingClientRect().bottom);
        assert.ok(Math.abs(gap-Math.max(16,safeBottom))<1,`${name}: consistent resting clearance (${gap})`);
        await page.screenshot({path:`test-results/detail-refinements/${name}-${minimal?'minimal':'full'}.png`});
        await input.fill('Make each session 30 minutes');
        await page.evaluate(()=>{detailSummaryBubble('say','Kept conversation');detailSummarySetTag('Duration');syncDetailSummaryDock();});
        const draft=await page.evaluate(()=>detailSummaryDraft());
        assert.equal(await close.getAttribute('aria-label'),'clear change');
        await close.tap();await settle();
        assert.equal(await input.isVisible(),true,'X keeps the composer available');
        assert.equal(await input.inputValue(),'','X clears typed text');
        assert.equal(await page.locator('#detail-ask-tag').isVisible(),false,'X clears the selected setting tag');
        assert.equal(await page.locator('#detail-summary-chat').isVisible(),true,'clearing preserves the conversation');
        assert.match(await page.locator('#detail-summary-thread').textContent(),/Kept conversation/);
        assert.equal(await page.evaluate(()=>$('detail-sheet').classList.contains('open')),true,'clearing keeps details open');
        assert.equal(await close.getAttribute('aria-label'),'close details');
        // Search remains a separate layer and returns to the same Summary.
        await page.locator('#detail-search-toggle').tap();
        await close.tap();
        assert.equal(await input.isVisible(),true);
        await page.evaluate(draft=>detailSummaryComposer(draft),draft);
        const motion=await page.evaluate(minimal=>{
          if(minimal)showDetailMinimalTab('settings');else scrollDetailToNav('schedule','smooth');
          return {panel:detailPanelMotion?.playState,dock:detailDockMotion?.playState,nav:detailCurrentNav()};
        },minimal);
        assert.equal(motion.panel,'running','tab content transitions');
        assert.equal(motion.dock,'running','composer changes into the action bar');
        // Rapid selections finish on the last choice, with one visible panel.
        await page.evaluate(minimal=>{
          if(minimal){showDetailMinimalTab('summary');showDetailMinimalTab('settings');showDetailMinimalTab('summary');}
          else{scrollDetailToNav('identity','smooth');scrollDetailToNav('summary','smooth');}
        },minimal);
        await settle();
        assert.equal(await page.evaluate(()=>detailCurrentNav()),'summary');
        assert.equal(await page.locator('.detail-pager > .detail-page:visible').count(),1);
        // Typing owns the final geometry, even if a tab change just started.
        const focused=await page.evaluate(()=>{
          const settings=visibleDetailPages(getSheetInner('detail-sheet').querySelector('.detail-pager'))
            .find(page=>page.dataset.detailNav !== 'summary').dataset.detailNav;
          scrollDetailToNav(settings,'auto');scrollDetailToNav('summary','smooth');
          $('detail-ask-input').focus({preventScroll:true});
          return {panel:detailPanelMotion?.playState,dock:detailDockMotion?.playState,
            transform:getComputedStyle(getSheetInner('detail-sheet').querySelector('.sheet-search-dock')).transform};
        });
        assert.notEqual(focused.panel,'running','focused fields stop panel motion');
        assert.notEqual(focused.dock,'running','typing stops dock morphing before the keyboard opens');
        assert.equal(focused.transform,'none','the focused composer has its final full-size geometry');
        await input.blur();
        // System Back uses the same two steps as X, without closing the page early.
        assert.equal(await page.evaluate(()=>{const plan=appBackPlan();return plan.signature;}),'detail-draft');
        if(minimal)await page.evaluate(()=>appBackPlan().run());
        else{
          await page.goBack();
          await page.waitForFunction(()=>!detailSummaryDraft() && !appBackHistoryCleaning);
        }
        await settle();
        assert.equal(await page.evaluate(()=>$('detail-sheet').classList.contains('open')),true,'Back returns to the item before leaving details');
        assert.equal(await input.inputValue(),'','Back clears the pending message too');
        await close.tap();
        assert.equal(await page.evaluate(()=>$('detail-sheet').classList.contains('open')),false,'X with an empty box leaves details in one tap');
        assert.deepEqual(await page.evaluate(()=>load()),before,'navigation never saves');
      }
      const closed=await page.evaluate(()=>{
        openDetail(0);assistantNeedleCanSend=()=>true;syncDetailSummaryDock();
        scrollDetailToNav('schedule','smooth');closeDetail();
        return {panel:detailPanelMotion?.playState,dock:detailDockMotion?.playState,
          entry:sheetEnterMotions.get($('detail-sheet'))?.playState};
      });
      for(const state of Object.values(closed))assert.notEqual(state,'running','closing cancels interrupted motion');
      if(name==='pixel-7-pro'){
        await page.evaluate(()=>{
          setMinimalMode(false);openDetail(0);detailSummaryReset(detailSummary.hid);syncDetailSummaryDock();
          window.TingsNative={isNative:true,platform:'android'};
          const viewport=new EventTarget();Object.assign(viewport,{height:892,offsetTop:0,scale:1});
          Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
          updateKeyboardLift();
        });
        await settle();await input.focus();
        await page.setViewportSize({width:412,height:540});
        await page.evaluate(()=>{visualViewport.height=190;updateKeyboardLift();});
        const keyboard=await page.locator('.detail-bottom-bar').boundingBox();
        assert.ok(Math.abs(keyboard.y+keyboard.height-540)<1,'Android uses the resized viewport once, with no extra resting gap');
        assert.equal(await close.isVisible(),true,'Close stays available above the keyboard');
        await input.blur();await page.setViewportSize({width:412,height:892});
        await page.evaluate(()=>{visualViewport.height=892;updateKeyboardLift();});
        const restored=await page.locator('.detail-bottom-bar').boundingBox();
        assert.ok(Math.abs(892-restored.y-restored.height-16)<1,'resting clearance returns after the Android keyboard closes');
        await page.evaluate(()=>{delete window.TingsNative;closeDetail();});
      }
      await page.emulateMedia({reducedMotion:'reduce'});
      const reduced=await page.evaluate(()=>{
        setMinimalMode(false);openDetail(0);scrollDetailToNav('schedule','smooth');
        return {panel:detailPanelMotion?.playState,dock:detailDockMotion?.playState,
          enter:sheetEnterMotions.get($('detail-sheet'))?.playState};
      });
      assert.notEqual(reduced.panel,'running');assert.notEqual(reduced.dock,'running');assert.notEqual(reduced.enter,'running');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${name}: full/minimal clear-or-close, conversations, spacing, tabs, rapid navigation, Back and reduced motion`);
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
