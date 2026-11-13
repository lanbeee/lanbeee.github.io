// Cold-open and repeated Summary pill navigation must never depend on a
// scroll-snap position. Use the real lazy Summary load and real touch taps.
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const {BASE,baseHabit}=require('./helpers/planner-test-helpers');

(async()=>{
  for(const [name,engine] of Object.entries({webkit,chromium})){
    const browser=await engine.launch();
    try{
      const page=await browser.newPage({...devices['iPhone X'],serviceWorkers:'block'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const item=baseHabit({hid:'cold-prayer',name:'Dhuhr',priority:0,durationMinutes:60,
        allowedTimeStartAnchor:'dhuhr',allowedTimeEndAnchor:'asr',minGapMinutes:25,topics:['prayer']});
      await page.addInitScript(item=>{
        localStorage.setItem('tings_v2',JSON.stringify([item]));
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,
          localAssistantProvider:'needle',agendaOptimizer:false,showWeekOnHome:false}));
        for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
      },item);
      const visiblePanels=()=>page.evaluate(()=>[...document.querySelectorAll('.detail-pager > .detail-page')]
        .filter(panel=>panel.getClientRects().length).map(panel=>panel.dataset.detailNav));
      const idle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      let taps=0;
      for(let cold=0;cold<2;cold++){
        // A new document and normal card tap, with no eager assistant load or
        // existing chat/save state, cover the reported cold-open first tap.
        await page.goto(BASE);
        await page.locator('#launch-screen').waitFor({state:'hidden'});
        await page.locator('#list .ting-name').filter({hasText:'Dhuhr'}).first().tap();
        await page.locator('#detail-summary [data-summary-field="allowedWindow"]').waitFor();
        const summaryTab=page.locator('.detail-page-tab[aria-label="summary"]');
        const summaryStart=await summaryTab.boundingBox();
        await page.locator('.detail-dots').evaluate(bar=>{bar.scrollLeft=bar.scrollWidth;});
        await idle();
        const frozen=await summaryTab.evaluate(tab=>{
          const rect=tab.getBoundingClientRect(),bar=tab.parentElement;
          const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
          return {x:rect.x,scrolled:bar.scrollLeft>0,clickable:tab.contains(hit)};
        });
        assert.ok(frozen.scrolled && frozen.clickable && Math.abs(frozen.x-summaryStart.x)<1,
          `${name}: Summary stays fixed and tappable when the tab strip is scrolled to the end`);
        await page.locator('.detail-page-tab[aria-label="actions"]').tap();
        await page.keyboard.press('ArrowLeft');
        await idle();
        const besideSummary=await page.locator('.detail-page-tab.on').evaluate(tab=>{
          const pinned=tab.parentElement.querySelector('[data-detail-pinned]');
          const rect=tab.getBoundingClientRect(),bar=tab.parentElement.getBoundingClientRect();
          return rect.left>=pinned.getBoundingClientRect().right && rect.right<=bar.right+1;
        });
        assert.ok(besideSummary,`${name}: keyboard navigation keeps the selected tab clear of Summary`);
        await summaryTab.tap();
        await idle();
        assert.deepEqual(await visiblePanels(),['summary'],'the pinned Summary tab opens its panel');
        await page.evaluate(()=>{
          window.detailTabExpected='summary';window.detailTabFrameErrors=[];
          document.addEventListener('click',event=>{
            const pill=event.target.closest('[data-summary-field]');
            const tab=event.target.closest('.detail-page-tab[data-detail-page]');
            if(pill){
              const selector=assistantFocusDetailSelector(pill.dataset.summaryField,assistantFocusSummarySession(detailSummaryRecord()));
              detailTabExpected=document.querySelector(selector).closest('.detail-page').dataset.detailNav;
            }else if(tab)detailTabExpected=visibleDetailPages(detailSummaryPager)[Number(tab.dataset.detailPage)].dataset.detailNav;
          },true);
          const sample=()=>{
            if($('detail-sheet').classList.contains('open') || getPane()?.dataset.activeSheet==='detail-sheet'){
              const panels=[...detailSummaryPager.querySelectorAll('.detail-page')]
                .filter(panel=>panel.getClientRects().length).map(panel=>panel.dataset.detailNav);
              if(panels.length!==1 || panels[0]!==detailTabExpected)detailTabFrameErrors.push({expected:detailTabExpected,panels});
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const pills=await page.evaluate(()=>{
          const session=assistantFocusSummarySession(detailSummaryRecord());
          return [...$('detail-summary').querySelectorAll('[data-summary-field]')].map(button=>{
            const field=button.dataset.summaryField;
            const selector=assistantFocusDetailSelector(field,session);
            return {field,selector,nav:document.querySelector(selector).closest('.detail-page').dataset.detailNav};
          }).sort((a,b)=>(b.field==='allowedWindow')-(a.field==='allowedWindow'));
        });
        assert.ok(pills.length>=5,'fixture covers different destinations and the recorded prayer window');
        for(let round=0;round<5;round++)for(const pill of pills){
          await page.locator(`#detail-summary [data-summary-field="${pill.field}"]`).tap();
          await idle();
          assert.deepEqual(await visiblePanels(),[pill.nav],`${name} cold ${cold+1}, round ${round+1}: ${pill.field} renders its panel`);
          assert.equal(await page.locator(`.detail-page-tab[aria-controls="${await page.locator(`[data-detail-nav="${pill.nav}"]`).getAttribute('id')}"]`).getAttribute('aria-selected'),'true');
          const bounds=await page.locator(pill.selector).evaluate(target=>{
            const rect=target.getBoundingClientRect(),host=target.closest('.detail-page').getBoundingClientRect();
            return {left:rect.left>=host.left-1,right:rect.right<=host.right+1,vertical:rect.top<host.bottom && rect.bottom>host.top};
          });
          assert.ok(bounds.left && bounds.right && bounds.vertical,`${pill.field} is visible, rather than a blank panel`);
          // Try horizontal scrolling before a viewport notification. Mobile
          // WebKit has no Playwright wheel injection, so exercise attempted
          // scrolling and scroll notification explicitly in that engine.
          if(name==='chromium'){
            await page.locator(pill.selector).hover();
            await page.mouse.wheel(450,0);
          }else await page.locator('.detail-pager').evaluate(el=>{
            el.scrollBy({left:450,behavior:'instant'});
            el.dispatchEvent(new Event('scroll'));
          });
          await page.evaluate(()=>{visualViewport.dispatchEvent(new Event('resize'));});
          await idle();
          assert.deepEqual(await visiblePanels(),[pill.nav],`${pill.field} survives scrolling and viewport changes`);
          assert.equal(await page.locator('.detail-pager').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
          await page.locator('.detail-page-tab[aria-label="summary"]').tap();
          await idle();
          assert.deepEqual(await visiblePanels(),['summary']);
          taps++;
        }
        // A fresh card opening also cancels any queued field reveal from the
        // preceding item visit; the first page is selected synchronously.
        assert.deepEqual(await page.evaluate(()=>detailTabFrameErrors),[],`${name}: every animation frame keeps the requested panel visible`);
        await page.locator('#detail-cool').tap();
      }
      await page.setViewportSize({width:812,height:375});
      // Let the orientation's pane reparenting finish before tapping Home.
      await page.waitForTimeout(500);
      await page.locator('#list .ting-name').filter({hasText:'Dhuhr'}).first().tap();
      await idle();
      assert.equal(await page.locator('.detail-page-nav').isVisible(),true,'short landscape keeps the only tab navigation available');
      await page.locator('.detail-page-tab[aria-label="name & type"]').tap();
      await idle();
      assert.deepEqual(await visiblePanels(),['identity']);
      await page.setViewportSize({width:812,height:280});
      await idle();
      assert.equal(await page.locator('.detail-page-nav').isVisible(),true,'very short panes keep icon tabs available');
      await page.locator('.detail-page-tab[aria-label="summary"]').tap();
      await idle();
      assert.deepEqual(await visiblePanels(),['summary']);
      assert.deepEqual(await page.evaluate(()=>detailTabFrameErrors),[],`${name}: landscape frames keep the requested panel visible`);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${name}: ${taps} pill taps across two cold opens, first Allowed hours tap, repeated destinations, scroll/resize independence and landscape tabs`);
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exit(1);});
