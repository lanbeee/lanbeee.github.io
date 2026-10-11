// Exercise animated visual-viewport changes without requiring a physical IME.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      // Installed phone apps can retain a home-indicator inset while the IME
      // covers it. Search must not stack that inset above the keyboard.
      document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','34px'));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false}));
      const viewport = new EventTarget();
      Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    });
    let releaseBoot;
    const bootGate=new Promise(resolve=>{releaseBoot=resolve;});
    await page.route('**/js/config.js',async route=>{await bootGate;await route.continue();});
    const navigation=page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.waitForSelector('.wordmark');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.wordmark img')).width==='38px');
    const skeletonHeader=await page.evaluate(()=>{
      document.documentElement.style.setProperty('--safe-area-inset-top','41px');
      return {top:document.querySelector('.wordmark').getBoundingClientRect().top,
        height:document.documentElement.scrollHeight};
    });
    assert.equal(skeletonHeader.height,844,'loading Home has no extra footer scroll band');
    releaseBoot();
    await navigation;
    await page.unroute('**/js/config.js');
    assert.equal(await page.locator('.wordmark').evaluate(el=>el.getBoundingClientRect().top),
      skeletonHeader.top,'wordmark keeps its skeleton position after boot');
    await page.evaluate(data=>{save(data);render();},Array.from({length:12},(_,i)=>baseHabit({hid:`keyboard-${i}`,name:`Keyboard fixture ${i}`,type:'zero'})));
    await page.waitForTimeout(400);
    // A fading detail overlay exposes cards when the scroll lock unsticks
    // Home's day header. Check the very first paint from a scrolled feed.
    const detailEntry = await page.evaluate(async()=>{
      window.scrollTo({top:350,behavior:'instant'});
      await new Promise(requestAnimationFrame);
      const top=scrollY;
      openDetail(0);
      const frames=[];
      for(let i=0;i<8;i++){
        await new Promise(requestAnimationFrame);
        const wrap=$('detail-sheet'),head=$('detail-head-card');
        frames.push({opacity:getComputedStyle(wrap).opacity,
          sheetOpacity:getComputedStyle(head.parentElement).opacity,
          covered:Boolean(document.elementFromPoint(20,60)?.closest('#detail-sheet'))});
      }
      closeDetail();
      await new Promise(requestAnimationFrame);
      return {top,returned:scrollY,frames};
    });
    assert.ok(detailEntry.top>300,'detail entry starts from a scrolled Home');
    for(const frame of detailEntry.frames){
      assert.equal(frame.opacity,'1','phone detail is opaque from its first frame');
      assert.equal(frame.sheetOpacity,'1','detail header has no delayed fade');
      assert.ok(frame.covered,'detail covers the sticky day header area');
    }
    assert.equal(detailEntry.returned,detailEntry.top,'closing detail preserves Home scroll');
    const calendarEntry=await page.evaluate(async()=>{
      renderOverview();
      openSheet('overview-sheet');
      const frames=[];
      for(let i=0;i<8;i++){
        await new Promise(requestAnimationFrame);
        const wrap=$('overview-sheet');
        frames.push({opacity:getComputedStyle(wrap).opacity,
          covered:Boolean(document.elementFromPoint(20,60)?.closest('#overview-sheet'))});
      }
      closeSheet('overview-sheet');
      return frames;
    });
    for(const frame of calendarEntry){
      assert.equal(frame.opacity,'1','phone Calendar is opaque from its first frame');
      assert.ok(frame.covered,'Calendar covers the sticky day header area');
    }
    await page.evaluate(()=>{
      window.keyboardProbe = {renders:0,scrolls:0,updates:0};
      const originalRender = render;
      render = (...args)=>{keyboardProbe.renders++;return originalRender(...args);};
      const originalUpdate = updateKeyboardLift;
      updateKeyboardLift = ()=>{keyboardProbe.updates++;return originalUpdate();};
      const originalScroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(...args){keyboardProbe.scrolls++;return originalScroll.apply(this,args);};
      window.scrollTo({top:350,behavior:'instant'});
    });
    await page.locator('#open-search').tap();
    await page.waitForTimeout(400);
    const opening = await page.evaluate(()=>({
      ...keyboardProbe,focused:document.activeElement.id,top:scrollY,
      transition:getComputedStyle(document.querySelector('.bottom-nav')).transitionProperty
    }));
    assert.equal(opening.focused,'habit-search','trusted tap focuses search immediately');
    assert.equal(opening.renders,0,'opening an empty search retains the mounted agenda');
    assert.equal(opening.scrolls,0,'fixed search never scrolls the document into view');
    assert.equal(opening.top,0,'search starts at the top');
    assert.ok(!opening.transition.split(',').map(s=>s.trim()).includes('bottom'),'keyboard dock does not chase resize events with another animation');

    // Resize+scroll can arrive together for every step of the keyboard animation.
    for(const height of [760,660,544,600,740,844]){
      const dock = await page.evaluate(async height=>{
        keyboardProbe.updates=0;
        visualViewport.height = height;
        for(let i=0;i<4;i++){
          visualViewport.dispatchEvent(new Event('resize'));
          visualViewport.dispatchEvent(new Event('scroll'));
        }
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=document.querySelector('.bottom-nav').getBoundingClientRect();
        return {bottom:r.bottom,top:scrollY,scrolls:keyboardProbe.scrolls,updates:keyboardProbe.updates};
      },height);
      const expectedBottom=height===844 ? height-34 : height;
      assert.ok(Math.abs(dock.bottom-expectedBottom)<=1,`Home search meets keyboard/safe edge at ${height}: ${JSON.stringify(dock)}`);
      assert.equal(dock.top,0);
      assert.equal(dock.scrolls,0);
      assert.equal(dock.updates,1,'resize and scroll bursts share one layout update');
    }
    await page.locator('#habit-search').fill('fixture 3');
    await page.waitForFunction(()=>document.querySelectorAll('#list .ting-card').length===1);
    await page.evaluate(()=>closeSearch());
    await page.waitForFunction(()=>document.querySelectorAll('#list .ting-card').length===12);
    const homeExitTransitions=await page.evaluate(()=>['.topbar','#home-tag-filter'].map(selector=>getComputedStyle(document.querySelector(selector)).transitionProperty.split(',').map(s=>s.trim())));
    for(const properties of homeExitTransitions)assert.ok(properties.every(property=>['transform','opacity'].includes(property)),'Home header restores its space without a second resize animation');

    // No delayed retry steals focus after the user chooses another control.
    await page.evaluate(()=>{setSearchOpen(true);document.getElementById('open-search').focus({preventScroll:true});});
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'open-search');
    await page.evaluate(()=>{closeSearch();openDetail(0);});
    await page.locator('#detail-search-toggle').tap();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'detail-search-input');
    for(const height of [740,640,544,680,844]){
      const dock=await page.evaluate(async height=>{
        visualViewport.height=height;
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=document.querySelector('.detail-bottom-bar').getBoundingClientRect();
        return {top:r.top,bottom:r.bottom};
      },height);
      const expectedBottom=height===844 ? height-34 : height;
      assert.ok(dock.top>=0 && Math.abs(dock.bottom-expectedBottom)<=1,`detail search meets keyboard/safe edge at ${height}: ${JSON.stringify(dock)}`);
    }
    await page.evaluate(()=>{setDetailSearchOpen(false,false);scrollDetailToNav('identity','auto');});
    await page.locator('#detail-habit-message').focus();
    // A visible editing field must not be recentered on every resize.
    const editing=await page.evaluate(()=>{
      keyboardProbe.scrolls=0;
      const host=document.activeElement.closest('.detail-page');
      const before=host.scrollTop;
      keepFocusedInputVisible();keepFocusedInputVisible();
      return {before,after:host.scrollTop};
    });
    assert.equal(editing.after,editing.before,'visible detail input is not recentered');
    assert.equal(await page.evaluate(()=>keyboardProbe.scrolls),0,'visible detail input keeps its reading position');
    await page.evaluate(()=>{
      visualViewport.height=544;updateKeyboardLift();
      document.activeElement.blur();
    });
    for(const height of [544,660,740,844]){
      const closing=await page.evaluate(async height=>{
        visualViewport.height=height;visualViewport.dispatchEvent(new Event('resize'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {editing:getSheetInner('detail-sheet').classList.contains('detail-field-editing'),
          display:getComputedStyle(document.querySelector('.detail-bottom-bar')).display};
      },height);
      assert.equal(closing.editing,height<844,'PWA editing chrome stays compact through the closing keyboard animation');
      assert.equal(closing.display==='none',height<844,'PWA Search/Close appears only at the resting bottom');
    }
    await page.evaluate(()=>{
      closeDetail();openSheet('add-sheet');
      const inner=getSheetInner('add-sheet');
      const spacer=document.createElement('div');spacer.style.height='1000px';
      const field=document.createElement('input');field.id='keyboard-low-field';
      inner.append(spacer,field);field.focus({preventScroll:true});
      keepFocusedInputVisible();
    });
    const revealed=await page.locator('#keyboard-low-field').boundingBox();
    const footer=await page.locator('.add-actions').boundingBox();
    assert.ok(revealed.y>=0 && revealed.y+revealed.height<=footer.y,'covered add input scrolls above the footer immediately');
    await page.evaluate(()=>{closeSheet('add-sheet');window.TingsNative={isNative:true};});
    // IME and layout metrics need not arrive together. Keep innerHeight stale
    // across a real CSS viewport resize, then reverse the event order on close.
    for(const surface of ['home','detail']){
      await page.evaluate(surface=>{
        if(surface==='home')setSearchOpen(true);
        else {closeSearch();openDetail(0);setDetailSearchOpen(true);}
        document.documentElement.style.setProperty('--safe-area-inset-bottom','0px');
      },surface);
      await page.waitForTimeout(300);
      if(surface==='detail')assert.equal(await page.evaluate(()=>getComputedStyle($('detail-sheet')).backgroundColor),await page.evaluate(()=>getComputedStyle(getSheetInner('detail-sheet')).backgroundColor),'opaque detail backdrop covers Home between viewport frames');
      const sample=async (height,reportedHeight,offsetTop=0)=>page.evaluate(async ({height,reportedHeight,offsetTop,surface})=>{
        Object.defineProperty(window,'innerHeight',{value:reportedHeight,configurable:true});
        visualViewport.height=height;visualViewport.offsetTop=offsetTop;
        visualViewport.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const dock=document.querySelector(surface==='home'?'.bottom-nav':'.detail-bottom-bar').getBoundingClientRect();
        const inner=document.querySelector('.detail-sheet').getBoundingClientRect();
        return {bottom:dock.bottom,sheetBottom:inner.bottom,open:surface==='home'?isSearchOpen():$('detail-sheet').classList.contains('open')};
      },{height,reportedHeight,offsetTop,surface});
      for(const height of [660,544,430]){
        // Visual viewport leads, then CSS layout catches up before innerHeight.
        let frame=await sample(height,844);
        assert.ok(Math.abs(frame.bottom-height)<=1,`${surface} visual-first frame stays at keyboard: ${JSON.stringify(frame)}`);
        await page.setViewportSize({width:390,height});
        frame=await sample(height,844);
        assert.ok(Math.abs(frame.bottom-height)<=1,`${surface} stale innerHeight must not double lift: ${JSON.stringify(frame)}`);
        if(surface==='detail')assert.ok(Math.abs(frame.sheetBottom-height)<=1,'detail surface fills the visible screen without exposing Home');
        // Layout leads on close, with both JS metrics still reporting the IME.
        await page.setViewportSize({width:390,height:844});
        frame=await sample(height,height);
        assert.ok(Math.abs(frame.bottom-height)<=1,`${surface} layout-first close frame stays at keyboard: ${JSON.stringify(frame)}`);
        frame=await sample(844,844);
        assert.ok(Math.abs(frame.bottom-844)<=1,`${surface} returns to bottom after keyboard closes`);
        assert.equal(frame.open,true,'asynchronous viewport steps retain the current screen');
        // CSS can also shrink before either JS height reports the keyboard.
        await page.setViewportSize({width:390,height});
        frame=await sample(844,844);
        assert.ok(Math.abs(frame.bottom-height)<=1,`${surface} layout-first open frame stays at keyboard: ${JSON.stringify(frame)}`);
        await page.setViewportSize({width:390,height:844});
        await sample(844,844);
      }
      const panned=await sample(500,844,44);
      assert.ok(Math.abs(panned.bottom-544)<=1,`${surface} dock follows the panned visual viewport`);
      await sample(844,844);
    }
    await page.evaluate(()=>{delete window.innerHeight;visualViewport.offsetTop=0;closeDetail();document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');window.TingsNative={isNative:true,platform:'android'};updateKeyboardLift();});
    await page.waitForTimeout(300);
    // Android adjustResize shrinks innerHeight too: do not lift the dock a
    // second time, close the detail sheet, or lose the focused field.
    for(const surface of ['home','detail']){
      await page.evaluate(surface=>{
        if(surface==='home')setSearchOpen(true);
        else {closeSearch();openDetail(0);setDetailSearchOpen(true);}
      },surface);
      const contentPadding=await page.evaluate(()=>getComputedStyle(document.querySelector('.detail-page.tune-section')).paddingLeft);
      const historyCopy=await page.evaluate(()=>getComputedStyle(document.querySelector('.detail-calendar-page .detail-about')).display);
      for(const height of [660,544,844]){
        await page.evaluate(height=>{
          visualViewport.height=height;
          // Capacitor removes the system-bar inset while the IME is visible.
          document.documentElement.style.setProperty('--safe-area-inset-bottom',height===844 ? '34px' : '0px');
        },height);
        await page.setViewportSize({width:390,height});
        await page.waitForTimeout(160);
        const native=await page.evaluate(surface=>{
          const dock=document.querySelector(surface==='home'?'.bottom-nav':'.detail-bottom-bar').getBoundingClientRect();
          return {bottom:dock.bottom,focus:document.activeElement.id,lift:document.documentElement.style.getPropertyValue('--keyboard-lift'),open:surface==='home'?isSearchOpen():document.getElementById('detail-sheet').classList.contains('open')};
        },surface);
        assert.equal(native.open,true,'window resizing preserves the open surface');
        assert.equal(native.focus,surface==='home'?'habit-search':'detail-search-input');
        assert.equal(native.lift,'0px','resized WebView needs no additional keyboard lift');
        assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.detail-page.tune-section')).paddingLeft),contentPadding,'portrait detail content keeps its padding while the native keyboard opens and closes');
        assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.detail-calendar-page .detail-about')).display),historyCopy,'portrait history content is not hidden and reinserted by the keyboard');
        const expectedBottom=height===844 ? height-34 : height;
        assert.ok(Math.abs(native.bottom-expectedBottom)<=1,`native ${surface} dock meets keyboard/safe edge: ${JSON.stringify(native)}`);
        if(height===544){
          // Physical Pixel trace: Capacitor resizes the layout, then WebView
          // briefly reports another full keyboard reduction in visualViewport.
          const baseline=await page.evaluate(()=>document.querySelector('.detail-head').getBoundingClientRect().toJSON());
          await page.evaluate(()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','34px'));
          for(const transientHeight of [194,544]){
            const transient=await page.evaluate(async ({surface,transientHeight})=>{
              visualViewport.height=transientHeight;
              visualViewport.dispatchEvent(new Event('resize'));
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const dock=document.querySelector(surface==='home'?'.bottom-nav':'.detail-bottom-bar').getBoundingClientRect();
              const head=document.querySelector('.detail-head').getBoundingClientRect();
              return {bottom:dock.bottom,headerTop:head.top,headerHeight:head.height,lift:document.documentElement.style.getPropertyValue('--keyboard-lift')};
            },{surface,transientHeight});
            assert.ok(Math.abs(transient.bottom-544)<=1,`Pixel ${surface} ignores duplicate visual IME inset: ${JSON.stringify(transient)}`);
            assert.equal(transient.lift,'0px');
            if(surface==='detail'){
              assert.equal(transient.headerTop,baseline.top,'detail header stays in place through the transient viewport');
              assert.equal(transient.headerHeight,baseline.height,'detail header remains visible at its original size');
            }
          }
          await page.evaluate(()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','0px'));
          // Hold JS geometry at its keyboard-open state while CSS restores
          // full height. Native exit must finish without a second JS resize.
          await page.evaluate(()=>{window.realPixelUpdate=updateKeyboardLift;updateKeyboardLift=()=>{};visualViewport.height=194;});
          await page.setViewportSize({width:390,height:844});
          const closing=await page.evaluate(surface=>{
            const dock=document.querySelector(surface==='home'?'.bottom-nav':'.detail-bottom-bar').getBoundingClientRect();
            return {bottom:dock.bottom,sheetHeight:document.querySelector('.detail-sheet').getBoundingClientRect().height};
          },surface);
          assert.ok(Math.abs(closing.bottom-810)<=1,`${surface} native keyboard exit restores its safe area immediately: ${JSON.stringify(closing)}`);
          if(surface==='detail')assert.equal(closing.sheetHeight,844,'detail exit does not wait for viewport JS to restore its height');
          await page.evaluate(()=>{updateKeyboardLift=window.realPixelUpdate;visualViewport.height=544;});
          await page.setViewportSize({width:390,height:544});
          await page.evaluate(()=>updateKeyboardLift());
        }
      }
    }
    // A normal detail input must not scroll toward the transiently tiny
    // visual viewport either. Only genuinely covered fields should move.
    await page.setViewportSize({width:390,height:544});
    const nativeEditing=await page.evaluate(()=>{
      visualViewport.height=544;
      setDetailSearchOpen(false,false);scrollDetailToNav('identity','auto');
      window.editingHeaderGeometry=()=>{
        const header=document.querySelector('.detail-head'),mark=header.querySelector('.detail-mark');
        const style=getComputedStyle(header);
        return {height:header.getBoundingClientRect().height,markWidth:mark.getBoundingClientRect().width,
          markHeight:mark.getBoundingClientRect().height,padding:style.padding,margin:style.margin,
          cue:getComputedStyle(header.querySelector('.detail-cue')).display,
          actions:getComputedStyle(header.querySelector('.detail-head-actions')).display};
      };
      window.restingEditingHeader=editingHeaderGeometry();
      $('detail-habit-message').focus({preventScroll:true});updateKeyboardLift();
      keepFocusedInputVisible();
      const host=document.activeElement.closest('.detail-page'),before=host.scrollTop;
      visualViewport.height=194;
      keepFocusedInputVisible();
      return {before,after:host.scrollTop};
    });
    assert.equal(nativeEditing.after,nativeEditing.before,'Pixel editing field ignores the duplicate visual keyboard inset');
    assert.deepEqual(await page.evaluate(()=>editingHeaderGeometry()),await page.evaluate(()=>restingEditingHeader),'typing preserves the full detail header');
    await page.evaluate(()=>document.activeElement.blur());
    for(const height of [260,360,430,544,660,740,844]){
      await page.setViewportSize({width:390,height});
      const closing=await page.evaluate(async height=>{
        // Keep the last visual metric stale, as on the real Pixel exit.
        visualViewport.height=194;
        window.dispatchEvent(new Event('resize'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const bar=document.querySelector('.detail-bottom-bar');
        return {editing:getSheetInner('detail-sheet').classList.contains('detail-field-editing'),
          display:getComputedStyle(bar).display,bottom:bar.getBoundingClientRect().bottom};
      },height);
      assert.equal(closing.editing,height<844,'native editing chrome waits for the CSS layout to finish expanding');
      assert.equal(closing.display==='none',height<844,'native Search/Close never flashes above the closing keyboard');
      assert.deepEqual(await page.evaluate(()=>editingHeaderGeometry()),await page.evaluate(()=>restingEditingHeader),'short keyboard layouts preserve header size and contents');
      if(height===844)assert.ok(Math.abs(closing.bottom-(844-34-42))<=1,'native Search/Close returns at the resting bottom with its normal clearance');
    }
    await page.evaluate(()=>{
      visualViewport.height=844;scrollDetailToNav('identity','auto');
      $('detail-habit-message').focus({preventScroll:true});
      getSheetInner('detail-sheet').classList.add('tune-dirty');
    });
    await page.setViewportSize({width:390,height:544});
    await page.evaluate(()=>{document.activeElement.blur();updateKeyboardLift();});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.detail-bottom-bar .tune-actions')).display),'flex','Save/Cancel stays reachable during field blur');
    assert.equal(await page.evaluate(()=>getComputedStyle($('detail-cool-row')).display),'none','Search/Close stays hidden behind unsaved editing actions');
    assert.deepEqual(errors,[]);
    console.log('PASS keyboard docks, staggered native viewport frames, covered detail backdrop, stable focus, retained Home, and conditional input scrolling');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
