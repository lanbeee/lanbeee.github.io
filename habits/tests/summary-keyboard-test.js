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
        await page.evaluate(item=>{
          save([item,...Array.from({length:18},(_,i)=>({...item,type:'zero',hid:`background-${i}`,name:`Background item ${i}`}))]);
          render();
        },baseHabit({hid:'keyboard-summary',name:'Gym workout',durationMinutes:60,allowedWeekdays:[1,3,5]}));
        await page.waitForFunction(()=>document.querySelectorAll('#list .ting-card').length>=18);
        await page.evaluate(mode=>{
          document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
          if(mode==='android-app')window.TingsNative={isNative:true,platform:'android'};
          assistantNeedleCanSend=()=>true;
          window.scrollTo({top:300,behavior:'instant'});
          window.summaryHomeScroll=scrollY;
          openDetail(0);scrollDetailToNav('summary','auto');
          // Dispatch cancelable touch events to check scroll ownership in
          // both engines, including Safari's document-pan escape path.
          window.summaryTestDrag=(target,dx,dy)=>{
            const start={identifier:91,clientX:180,clientY:220};
            const finish={...start,clientX:start.clientX+dx,clientY:start.clientY+dy};
            const dispatch=(type,touch)=>{
              const event=new Event(type,{bubbles:true,cancelable:true});
              Object.defineProperties(event,{touches:{value:type==='touchend'?[]:[touch]},changedTouches:{value:[touch]}});
              target.dispatchEvent(event);
              return event.defaultPrevented;
            };
            dispatch('touchstart',start);
            const prevented=dispatch('touchmove',finish);
            dispatch('touchend',finish);
            return prevented;
          };
        },mode);
        await page.waitForFunction(()=>detailSummaryOnScreen());
        assert.equal(await page.locator('#detail-summary .settings-sublabel').count(),0,'Summary has no section headings');
        assert.equal(await page.locator('#detail-summary .assistant-chip-row').count(),1,'all settings share one wrapping row');
        assert.ok(await page.locator('#detail-summary [data-summary-field="durationMinutes"]').count());
        assert.ok(await page.locator('#detail-summary [data-summary-field="allowedWeekdays"]').count());
        for(const width of [320,390]){
          await page.setViewportSize({width,height:844});
          assert.equal(await page.locator('#detail-summary > .focus-note').evaluate(el=>{
            const range=document.createRange();range.selectNodeContents(el);
            return range.getClientRects().length;
          }),1,`Summary hint fits one line at ${width}px`);
        }

        for(const minimal of [false,true]){
          await page.evaluate(async minimal=>{
            closeDetail();setMinimalMode(minimal);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            // Open from a settled Home in each mode. Switching presentation
            // inside a modal can legitimately reflow the covered list.
            window.scrollTo({top:300,behavior:'instant'});
            window.summaryHomeScroll=scrollY;
            openDetail(0);scrollDetailToNav('summary','auto');
          },minimal);
          const gestures=await page.evaluate(()=>{
            const thread=detailSummaryThread();
            thread.replaceChildren(...Array.from({length:16},()=>{
              const p=document.createElement('p');p.textContent='A previous change in this conversation.';return p;
            }));
            $('detail-summary-chat').hidden=false;
            const page=getSheetInner('detail-sheet').querySelector('.detail-summary-page');
            const scroller=detailIsSingleView()?page.closest('.detail-pager'):page;
            const target=thread.firstElementChild;
            scroller.scrollTop=100;
            const reading=summaryTestDrag(target,0,-40);
            scroller.scrollTop=0;
            const top=summaryTestDrag(target,0,40);
            scroller.scrollTop=scroller.scrollHeight;
            const bottom=summaryTestDrag(target,0,-40);
            scroller.scrollTop=100;
            return {reading,top,bottom,background:summaryTestDrag(document.body,0,-40),
              header:summaryTestDrag($('detail-head-card'),0,-40),
              composer:summaryTestDrag($('detail-ask-input'),0,-40)};
          });
          assert.equal(gestures.reading,false,'conversation remains scrollable');
          for(const name of ['top','bottom','background','header','composer'])assert.equal(gestures[name],true,`${name} cannot pan the document underneath detail`);
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
          assert.equal(await page.evaluate(()=>scrollY),await page.evaluate(()=>summaryHomeScroll),`${engine.name()} ${mode} minimal=${minimal}: keyboard and scroll gestures preserve Home position`);
          await page.evaluate(()=>closeDetail());
          assert.equal(await page.evaluate(()=>scrollY),await page.evaluate(()=>summaryHomeScroll),'closing detail restores the same Home position');
        }
        assert.deepEqual(errors,[]);
        await page.close();
        console.log(`PASS ${engine.name()} ${mode}: full and minimal Summary keyboard layout`);
      }
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exit(1);});
