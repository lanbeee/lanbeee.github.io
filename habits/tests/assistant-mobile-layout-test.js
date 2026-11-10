// Browser/WebKit layout plus touch-boundary regression. Viewport events model
// keyboard shrink AND Safari panning; desktop emulation has no physical IME.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const {BASE, baseHabit, waitForAssistant} = require('./helpers/planner-test-helpers');

(async()=>{
  const engine = process.env.BROWSER || 'chromium';
  const browser = await playwright[engine].launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({localAssistant:true,localAssistantProvider:'needle',agendaOptimizer:false,showWeekOnHome:false}));
      const viewport = new EventTarget();
      Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    });
    await page.goto(BASE,{waitUntil:'networkidle'});
    await waitForAssistant(page);
    await page.evaluate(items=>{save(items);render();},Array.from({length:20},(_,i)=>baseHabit({hid:`mobile-${i}`,name:`Routine ${i}`,type:'zero'})));
    await page.waitForFunction(()=>document.querySelectorAll('#list .ting-card').length===20);
    await page.waitForTimeout(400);
    await page.evaluate(async()=>{
      window.scrollTo({top:350,behavior:'instant'});
      await new Promise(requestAnimationFrame);
      window.homeScroll = scrollY;
      openDetail(0);
      assistantOpenForItem('mobile-0','detail');
      document.documentElement.style.setProperty('--safe-area-inset-top','47px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
      // Exercise the ready chat layout without downloading or running a model.
      document.querySelector('#assistant-sheet [data-needle-panel]').hidden = true;
      for(let i=0;i<24;i++)appendAssistantBubble(i%2 ? 'user':'say',`Message ${i}: `+'A long conversation remains readable. '.repeat(4));
    });
    const measure = ()=>page.evaluate(()=>{
      const rect = selector=>{
        const r=document.querySelector(selector).getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};
      };
      return {sheet:rect('.assistant-sheet'),input:rect('#assistant-input'),send:rect('#assistant-send'),
        head:rect('.assistant-head'),thread:rect('#assistant-thread'),guides:rect('#assistant-guides'),
        rootLocked:document.documentElement.classList.contains('modal-open'),
        sheetScroll:document.querySelector('.assistant-sheet').scrollTop,
        overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(await page.evaluate(()=>homeScroll>300),'fixture opens from scrolled Home');
    assert.ok((await measure()).rootLocked,'root scrolling locks with the modal');

    for(const [height,top] of [[844,0],[620,0],[440,80],[390,140],[540,30],[844,0]]){
      await page.evaluate(async({height,top})=>{
        Object.assign(visualViewport,{height,offsetTop:top});
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      },{height,top});
      const r=await measure();
      assert.ok(Math.abs(r.sheet.top-top)<=1,JSON.stringify(r));
      assert.ok(Math.abs(r.sheet.bottom-(height+top))<=1,JSON.stringify(r));
      const safe=height===844 ? 34 : 0;
      assert.ok(Math.abs(r.input.bottom-(height+top-safe))<=1,'composer meets keyboard/safe edge: '+JSON.stringify(r));
      assert.ok(Math.abs(r.send.bottom-r.input.bottom)<=1);
      assert.ok(r.head.top>=top && r.head.bottom<r.input.top,'header and close stay in visible viewport');
      assert.ok(r.guides.bottom<=r.input.top && r.thread.height>40);
      assert.equal(r.sheetScroll,0);
      assert.equal(r.overflow,false);
    }
    await page.locator('#assistant-input').fill('Line one\nLine two\nLine three\nLine four\nLine five\nLine six');
    let r=await measure();
    assert.ok(r.input.height>44 && r.input.height<=88,'multiline draft grows within its limit');
    assert.ok(r.guides.bottom<=r.input.top,'growing composer reserves space above it');
    await page.locator('#assistant-guide-more').tap();
    await page.locator('#assistant-input').fill('');
    await page.evaluate(()=>{visualViewport.height=310;visualViewport.offsetTop=110;updateKeyboardLift();});
    r=await measure();
    const result=await page.locator('#assistant-guide-results .assistant-guide').first().boundingBox();
    assert.ok(result.height>=40 && result.y+result.height<=r.input.top,'a complete search result survives a small keyboard viewport');
    await page.screenshot({path:`test-results/assistant-mobile-${engine}.png`});

    // This also verifies that the guard permits real internal scrolling: a
    // middle-of-list touch is native, a pull past either end is cancelled.
    const gestures=await page.evaluate(()=>{
      function drag(el,dx,dy,multi=false,startX=180){
        const p={identifier:7,target:el,clientX:startX,clientY:220};
        const touch=(x,y)=>new Touch({...p,clientX:x,clientY:y});
        el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(startX,220)],cancelable:true}));
        const e=new TouchEvent('touchmove',{bubbles:true,cancelable:true,
          touches:multi ? [touch(startX+dx,220+dy),new Touch({...p,identifier:8})] : [touch(startX+dx,220+dy)]});
        el.dispatchEvent(e);
        el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[]}));
        return e.defaultPrevented;
      }
      const list=$('assistant-guide-results');
      list.scrollTop=0;
      const top=drag(list.firstElementChild,0,50),into=drag(list.firstElementChild,0,-50);
      list.scrollTop=80;
      const middle=drag(list.children[3],0,30);
      list.scrollTop=list.scrollHeight;
      const bottom=drag(list.lastElementChild,0,-50);
      const header=drag($('assistant-title'),0,-50),gutter=drag($('assistant-sheet'),0,50);
      const pinch=drag($('assistant-title'),0,50,true),edge=drag($('assistant-title'),90,0,false,4);
      return {top,into,middle,bottom,header,gutter,pinch,edge};
    });
    assert.deepEqual(gestures,{top:true,into:false,middle:false,bottom:true,header:true,gutter:true,pinch:false,edge:false});
    await page.locator('#assistant-input').press('Escape');
    const textarea=await page.evaluate(()=>{
      const el=$('assistant-input');
      el.value='Long multiline draft.\n'.repeat(30);assistantResizeComposer();
      el.scrollTop=50;
      return {scroll:el.scrollHeight,client:el.clientHeight,font:parseFloat(getComputedStyle(el).fontSize)};
    });
    assert.ok(textarea.scroll>textarea.client && textarea.font>=16,'long drafts scroll without iPhone focus zoom');

    // Android's native adapter resizes the layout viewport; a stale, smaller
    // visual viewport must not subtract the keyboard a second time.
    await page.evaluate(()=>{
      window.TingsNative={isNative:true,platform:'android'};
      Object.assign(visualViewport,{height:844,offsetTop:0});updateKeyboardLift();
    });
    for(const height of [540,844]){
      await page.setViewportSize({width:390,height});
      await page.evaluate(height=>{visualViewport.height=height===540?190:540;updateKeyboardLift();},height);
      r=await measure();
      assert.ok(Math.abs(r.input.bottom-height)<=1,'native composer uses resized layout once: '+JSON.stringify(r));
    }
    await page.evaluate(()=>{
      delete window.TingsNative;
      Object.assign(visualViewport,{height:844,offsetTop:0});
      closeAssistantSheet();
    });
    assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('modal-open')),'closing assistant keeps the underlying detail locked');
    await page.evaluate(()=>closeDetail());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('modal-open')),false);
    assert.equal(await page.evaluate(()=>scrollY),await page.evaluate(()=>homeScroll),'closing nested sheets restores original Home position');
    assert.deepEqual(errors,[]);
    console.log(`PASS ${engine}: assistant viewport, safe areas, drafts, settings, touch boundaries, native resize and nested scroll restoration`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
