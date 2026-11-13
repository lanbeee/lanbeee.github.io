// Phone Summary geometry across Safari pan, browser overlay and Android resize.
// Synthetic viewport events exercise layout; they do not emulate a physical IME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const playwright = require('playwright');
const {BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');

(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  // Match the other UI tests; BROWSER=webkit runs the Safari engine.
  for(const engine of [playwright[process.env.BROWSER || 'chromium']]){
    const browser = await engine.launch();
    try{
      for(const mode of ['pwa','android-browser','android-app']){
        const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.addInitScript(()=>{
          localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,localAssistantProvider:'needle',agendaOptimizer:false,showWeekOnHome:false}));
          localStorage.setItem('tings_coach_install_v2','done');
          localStorage.setItem('tings_coach_essentials_v2','done');
          const viewport = new EventTarget();
          Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
          Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
        });
        await page.goto(BASE);
        await waitForAssistant(page);
        await page.locator('#launch-screen').waitFor({state:'hidden'});
        await page.evaluate(({item,mode})=>{
          document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
          if(mode==='android-app')window.TingsNative={isNative:true,platform:'android'};
          assistantNeedleCanSend=()=>true;
          save([item]);openDetail(0);scrollDetailToNav('summary','auto');
        },{item:baseHabit({hid:'keyboard-summary',name:'Gym workout',durationMinutes:60,allowedWeekdays:[1,3,5]}),mode});
        await page.waitForFunction(()=>detailSummaryOnScreen());
        assert.equal(await page.locator('#detail-summary .settings-sublabel').count(),0,'Summary has no section headings');
        assert.equal(await page.locator('#detail-summary .assistant-chip-row').count(),1,'all settings share one wrapping row');
        assert.ok(await page.locator('#detail-summary [data-summary-field="durationMinutes"]').count());
        assert.ok(await page.locator('#detail-summary [data-summary-field="allowedWeekdays"]').count());

        for(const minimal of [false,true]){
          await page.evaluate(minimal=>{setMinimalMode(minimal);scrollDetailToNav('summary','auto');},minimal);
          await page.locator('#detail-ask-input').tap();
          await page.locator('#detail-ask-input').fill('Make this 40 minutes');
          const baseline=await page.evaluate(()=>{
            const header=$('detail-head-card').getBoundingClientRect();
            window.summaryFocusScrolls=0;
            window.summaryScrollToEnd=detailSummaryScrollToEnd;
            detailSummaryScrollToEnd=()=>{summaryFocusScrolls++;summaryScrollToEnd();};
            return {top:header.top,height:header.height};
          });
          const sample=async(height,offsetTop=0,duplicate=false)=>{
            // Chrome's default browser IME overlays the layout; Capacitor's
            // Android adapter resizes the layout itself.
            if(mode==='android-app')await page.setViewportSize({width:390,height});
            return page.evaluate(async ({height,offsetTop,duplicate})=>{
              visualViewport.height=duplicate ? height-300 : height;
              visualViewport.offsetTop=offsetTop;
              visualViewport.dispatchEvent(new Event('resize'));
              visualViewport.dispatchEvent(new Event('scroll'));
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const inner=getSheetInner('detail-sheet');
              return {header:$('detail-head-card').getBoundingClientRect().toJSON(),
                dock:inner.querySelector('.sheet-search-dock').getBoundingClientRect().toJSON(),
                input:$('detail-ask-input').getBoundingClientRect().toJSON(),
                send:$('detail-ask-send').getBoundingClientRect().toJSON(),
                typing:inner.classList.contains('detail-ask-typing'),focus:document.activeElement.id,
                text:$('detail-ask-input').value,scrolls:summaryFocusScrolls};
            },{height,offsetTop,duplicate});
          };
          for(const [height,offsetTop] of mode==='pwa' ? [[760,0],[650,38],[530,64],[480,96],[530,64]] : [[760,0],[650,0],[530,0],[480,0],[530,0]]){
            const frame=await sample(height,offsetTop);
            const context=`${engine.name()} ${mode} minimal=${minimal} at ${height}/${offsetTop}`;
            assert.ok(Math.abs(frame.header.top-offsetTop-baseline.top)<=1,`${context}: header stays at the visible top`);
            assert.equal(frame.header.height,baseline.height,`${context}: header retains its size`);
            assert.ok(Math.abs(frame.dock.bottom-(height+offsetTop))<=1,`${context}: dock meets keyboard once: ${JSON.stringify(frame.dock)}`);
            assert.ok(frame.input.top>=frame.header.bottom,`${context}: composer clears header`);
            assert.ok(frame.send.top>=frame.input.top && frame.send.bottom<=height+offsetTop,`${context}: next action is visible`);
            assert.equal(frame.focus,'detail-ask-input',`${context}: focus survives viewport changes`);
            assert.equal(frame.text,'Make this 40 minutes');
            assert.equal(frame.scrolls,0,`${context}: focus never triggers a delayed conversation jump`);
            if(mode==='android-app'){
              const transient=await sample(height,0,true);
              assert.ok(Math.abs(transient.dock.bottom-height)<=1,'native app ignores duplicate visual keyboard inset');
              assert.equal(transient.header.height,baseline.height);
            }
          }
          await page.waitForTimeout(300);
          assert.equal(await page.evaluate(()=>summaryFocusScrolls),0,'no late focus scroll after keyboard settles');
          await page.screenshot({path:`test-results/summary-keyboard-${engine.name()}-${mode}-${minimal?'minimal':'full'}.png`});
          await page.locator('#detail-ask-input').blur();
          for(const height of [530,650,760,844]){
            const frame=await sample(height);
            assert.equal(frame.typing,height<844,'compact controls remain until keyboard finishes closing');
            const clearance=height===844 ? 34+42 : 0;
            assert.ok(Math.abs(frame.dock.bottom-(height-clearance))<=1,`closing dock stays at its keyboard/safe edge: ${JSON.stringify(frame.dock)}`);
          }
          await page.evaluate(()=>{detailSummaryScrollToEnd=summaryScrollToEnd;$('detail-ask-input').value='';syncDetailSummaryDock();});
          // An empty field still shows guides. Blur must not collapse them
          // halfway through the closing keyboard animation.
          await page.locator('#detail-ask-input').tap();
          const empty=await sample(530);
          await page.locator('#detail-ask-input').blur();
          const closingEmpty=await sample(530);
          assert.equal(closingEmpty.dock.height,empty.dock.height,'empty composer guides stay stable during keyboard dismissal');
          await sample(844);
        }
        assert.deepEqual(errors,[]);
        await page.close();
        console.log(`PASS ${engine.name()} ${mode}: full and minimal Summary keyboard layout`);
      }
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exit(1);});
