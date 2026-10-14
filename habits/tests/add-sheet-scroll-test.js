// Touch scrolling, disclosures and viewport changes must leave creation actions steady.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false}));
      const viewport=new EventTarget();
      Object.assign(viewport,{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    const cdp = await context.newCDPSession(page);
    let layouts=0;
    for(const size of [{width:320,height:568},{width:390,height:844},{width:1100,height:740}]){
      await page.setViewportSize(size);
      await page.evaluate(height=>{visualViewport.height=height;visualViewport.dispatchEvent(new Event('resize'));},size.height);
      await page.waitForTimeout(300);
      for(const minimal of [false,true]){
        await page.evaluate(minimal=>{setMinimalMode(minimal);applyAddDefaults();openSheet('add-sheet');},minimal);
        await page.locator('#ting-message').fill('Scrolling draft');
        await page.locator('#ting-message').blur();
        const geometry=()=>page.evaluate(()=>{
          const footer=document.querySelector('.add-actions').getBoundingClientRect();
          const content=document.querySelector('.add-content');
          const rect=content.getBoundingClientRect();
          return {top:footer.top,bottom:footer.bottom,left:footer.left,width:footer.width,contentBottom:rect.bottom,
            scroll:content.scrollTop,max:content.scrollHeight-content.clientHeight,
            shellScroll:document.querySelector('.add-sheet').scrollTop,
            hit:['do-save','do-cancel'].every(id=>{
              const r=$(id).getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id===id;
            })};
        });
        const before=await geometry();
        if(!minimal){
          await page.locator('#add-more-toggle').click();
          await page.locator('.add-weather-options > summary').click();
          await page.locator('#ting-show-weather').click();
        }else{
          await page.locator('#type-seg [data-v="task"]').click();
          assert.match(await page.locator('label[for="ting-due-time"]').textContent(),/^Start time/);
          await page.locator('[data-add-due="tomorrow"]').click();
          await page.locator('#ting-due-time').fill('09:30');
          await page.locator('#ting-due-time').blur();
        }
        await page.evaluate(()=>document.querySelector('.add-content').scrollTo({top:0,behavior:'instant'}));
        const expanded=await geometry();
        assert.ok(Math.abs(before.top-expanded.top)<1,`opening options and changing type do not move actions: ${JSON.stringify({size,minimal,before,expanded})}`);
        await page.evaluate(()=>{
          window.addFooterFrames=[];window.recordAddFooter=true;
          const sample=()=>{
            if(!recordAddFooter)return;
            const r=document.querySelector('.add-actions').getBoundingClientRect();
            addFooterFrames.push({top:r.top,bottom:r.bottom});requestAnimationFrame(sample);
          };requestAnimationFrame(sample);
        });
        const startY=Math.min(expanded.top-24,size.height-80);
        await cdp.send('Input.synthesizeScrollGesture',{x:Math.round(expanded.left+expanded.width/2),y:Math.round(startY),yDistance:-600,speed:600,gestureSourceType:'touch'});
        await page.waitForTimeout(180);
        const frames=await page.evaluate(()=>{recordAddFooter=false;return addFooterFrames;});
        const after=await geometry();
        assert.ok(frames.length>5,'sampled footer throughout a touch scroll');
        for(const frame of frames)assert.ok(Math.abs(frame.top-expanded.top)<1 && Math.abs(frame.bottom-expanded.bottom)<1,'footer stays still throughout touch scrolling');
        assert.ok(after.hit,'both actions remain tappable after scrolling');
        assert.equal(after.shellScroll,0,'outer sheet never scrolls');
        assert.ok(after.contentBottom<=after.top+1,'form never runs beneath the actions');
        if(after.max>20)assert.ok(after.scroll>20,'the actual touch gesture scrolled the form');
        await page.evaluate(()=>document.querySelector('.add-content').scrollTo({top:1e6,behavior:'instant'}));
        assert.ok((await geometry()).hit,'actions remain reachable at the end of the form');
        assert.equal(await page.locator('#ting-message').inputValue(),'Scrolling draft');
        await page.locator('#do-cancel').tap();
        assert.equal(await page.evaluate(()=>$('add-sheet').classList.contains('open')),false);
        assert.equal(await page.evaluate(()=>load().length),0,'scrolling and cancel never create an item');
        layouts++;
      }
    }
    // An open phone form follows the keyboard once, and reveals fields in
    // its scroll region without shifting the footer with the content.
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.body.dataset.paneCount==='1');
    await page.evaluate(()=>{visualViewport.height=844;setMinimalMode(false);applyAddDefaults();openSheet('add-sheet');});
    await page.locator('#add-more-toggle').click();
    await page.locator('#ting-completion-mode').selectOption('minutes');
    await page.locator('#ting-auto-mark').focus();
    for(const height of [740,600,490,600,740,844]){
      const bounds=await page.evaluate(async height=>{
        visualViewport.height=height;
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const footer=document.querySelector('.add-actions').getBoundingClientRect();
        const field=$('ting-auto-mark').getBoundingClientRect();
        const content=document.querySelector('.add-content');
        const before=content.scrollTop;keepFocusedInputVisible();keepFocusedInputVisible();
        return {bottom:footer.bottom,top:footer.top,fieldTop:field.top,fieldBottom:field.bottom,before,after:content.scrollTop};
      },height);
      assert.ok(Math.abs(bounds.bottom-(height-14))<=1,`footer follows the visible viewport edge at ${height}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.fieldTop>=0 && bounds.fieldBottom<=bounds.top,'focused lower field stays above actions');
      assert.equal(bounds.before,bounds.after,'visible input is not repeatedly recentered');
    }
    await page.locator('#ting-auto-mark').blur();
    await page.locator('#do-cancel').tap();
    await page.setViewportSize({width:393,height:852});
    for(const minimal of [false,true]){
      await page.evaluate(minimal=>{
        visualViewport.width=393;visualViewport.height=852;visualViewport.offsetTop=0;
        setMinimalMode(minimal);applyAddDefaults();openSheet('add-sheet');
      },minimal);
      for(const id of ['ting-message','ting-times','ting-days','ting-duration']){
        await page.locator('#'+id).focus();
        for(const height of [400,320]){
          const layout = await page.evaluate(async ({height,id})=>{
            visualViewport.height=height;visualViewport.offsetTop=20;
            visualViewport.dispatchEvent(new Event('resize'));
            visualViewport.dispatchEvent(new Event('scroll'));
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const field=$(id).getBoundingClientRect();
            const footer=document.querySelector('.add-actions').getBoundingClientRect();
            const hit=document.elementFromPoint(field.left+field.width/2,field.top+field.height/2);
            const save=$('do-save').getBoundingClientRect();
            return {fieldVisible:field.top>=20 && field.bottom<=footer.top,
              fieldHit:hit===$(id),footerVisible:footer.bottom<=height+20,
              saveHit:document.elementFromPoint(save.left+save.width/2,save.top+save.height/2)?.closest('button')?.id === 'do-save'};
          },{height,id});
          assert.ok(layout.fieldVisible && layout.fieldHit && layout.footerVisible && layout.saveHit,`${id} stays above the 393px phone keyboard, minimal=${minimal}, height=${height}: ${JSON.stringify(layout)}`);
        }
        await page.evaluate(()=>{visualViewport.height=852;visualViewport.offsetTop=0;visualViewport.dispatchEvent(new Event('resize'));});
        await page.locator('#'+id).blur();
      }
      await page.locator('#do-cancel').tap();
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{visualViewport.height=844;visualViewport.offsetTop=0;updateKeyboardLift();});
    await page.locator('#open-add').tap();
    assert.equal(await page.evaluate(()=>document.querySelector('.add-content').scrollTop),0,'new drafts start at the beginning');
    // Android shrinks the WebView itself. A lagging visual viewport must
    // not lift the footer a second time, even before SystemBars clears insets.
    await page.evaluate(()=>{
      window.TingsNative={isNative:true,platform:'android'};
      document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
      updateKeyboardLift();
    });
    for(const height of [600,490,600,844]){
      await page.setViewportSize({width:390,height});
      const native=await page.evaluate(async height=>{
        visualViewport.height=height<844 ? height-250 : height;
        visualViewport.dispatchEvent(new Event('resize'));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return document.querySelector('.add-actions').getBoundingClientRect().bottom;
      },height);
      assert.ok(Math.abs(native-(height-14-(height===844 ? 34 : 0)))<1,'native footer uses the resized layout exactly once');
    }
    await page.setViewportSize({width:1100,height:740});
    await page.waitForFunction(()=>document.body.dataset.paneCount!=='1');
    await page.evaluate(()=>{visualViewport.height=740;updateKeyboardLift();});
    const nativeWide=await page.evaluate(()=>document.querySelector('.add-sheet').getBoundingClientRect().height);
    assert.ok(Math.abs(nativeWide-(740-48))<1,'native wide modal reserves its outer padding exactly once');
    assert.deepEqual(errors,[]);
    console.log(`PASS add sheet scrolling: ${layouts} responsive touch layouts, PWA/native keyboard opening/closing and draft cleanup; page errors: 0`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
