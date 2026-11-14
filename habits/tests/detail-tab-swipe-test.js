// Tab swipes must be explicit navigation, independent of scroll/resize state.
// Chromium exercises native injected touch drags; WebKit exercises DOM touch
// sequences (Playwright WebKit exposes taps but no native drag injection).
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const {BASE,baseHabit}=require('./helpers/planner-test-helpers');

(async()=>{
  for(const [name,engine] of Object.entries({chromium,webkit})){
    const browser=await engine.launch();
    try{
      const page=await browser.newPage({...devices['iPhone X'],serviceWorkers:'block'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(item=>{
        localStorage.setItem('tings_v2',JSON.stringify([item]));
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,
          localAssistantProvider:'needle',agendaOptimizer:false,showWeekOnHome:false}));
        for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
      },baseHabit({hid:'swipe',name:'Walk',priority:0,durationMinutes:40,allowedWeekdays:[1,3,5]}));
      const client=name==='chromium'?await page.context().newCDPSession(page):null;
      const idle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const nav=()=>page.evaluate(()=>detailIsSingleView()?detailMinimalView():detailCurrentNav());
      const select=async key=>{
        await page.evaluate(key=>{
          if(detailIsSingleView())showDetailMinimalTab(key);else scrollDetailToNav(key);
          window.swipeExpected=detailCurrentNav();
        },key);
        await idle();
      };
      const panels=()=>page.evaluate(()=>[...document.querySelectorAll('.detail-pager > .detail-page')]
        .filter(panel=>panel.getClientRects().length).map(panel=>panel.dataset.detailNav));
      const center=async selector=>{
        const box=await page.locator(selector).boundingBox();
        assert.ok(box,`${selector} is visible`);
        return {x:box.x+box.width*.55,y:box.y+box.height/2};
      };
      // Find an ordinary patch of panel background or text, excluding widgets.
      const point=()=>page.evaluate(()=>{
        const pager=getSheetInner('detail-sheet').querySelector('.detail-pager');
        const panel=detailIsSingleView()?pager
          :pager.querySelector('.is-active');
        const r=panel.getBoundingClientRect(),p=pager.getBoundingClientRect();
        for(let y=Math.max(r.top,p.top)+24;y<Math.min(r.bottom,p.bottom)-24;y+=16)for(const fraction of [.65,.4,.2,.8]){
          const x=p.left+p.width*fraction,target=document.elementFromPoint(x,y);
          if(x<150 || x>window.innerWidth-110)continue;
          if(!target || !panel.contains(target))continue;
          // Native touch hit testing expands nearby buttons. Use a patch
          // with room around it so this really starts on ordinary content.
          const nearControl=[-14,0,14].some(dx=>[-14,0,14].some(dy=>
            document.elementFromPoint(x+dx,y+dy)?.closest('input,textarea,button,a,label,summary,select,svg,canvas,[contenteditable]')));
          if(nearControl)continue;
          let nestedScroll=false;
          for(let node=target;node && node!==pager;node=node.parentElement){
            if(node.scrollWidth>node.clientWidth+1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX))nestedScroll=true;
          }
          if(nestedScroll)continue;
          return {x,y};
        }
        throw Error('No ordinary swipe area in '+panel.dataset.detailNav);
      });
      async function touch(type,points,changed=points){
        if(client){
          await client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:p.id||1,radiusX:1,radiusY:1}))});
        }else{
          await page.evaluate(({type,points,changed})=>{
            if(type==='touchStart' && !window.swipeTestTarget)window.swipeTestTarget=document.elementFromPoint(points[0].x,points[0].y);
            const event=new Event(type.toLowerCase(),{bubbles:true,cancelable:true});
            const convert=p=>({identifier:p.id||1,clientX:p.x,clientY:p.y});
            Object.defineProperties(event,{touches:{value:points.map(convert)},changedTouches:{value:changed.map(convert)}});
            swipeTestTarget.dispatchEvent(event);
            if(type==='touchEnd'||type==='touchCancel')window.swipeTestTarget=null;
          },{type,points,changed});
        }
      }
      async function drag(dx,dy=0,opts={}){
        const from=opts.from||await point(),before=await nav();
        await touch('touchStart',[from]);
        for(let step=1;step<=8;step++){
          await touch('touchMove',[{x:from.x+dx*step/8,y:from.y+dy*step/8}]);
          assert.equal(await nav(),before,'drag does not navigate before release');
        }
        if(opts.during)await opts.during();
        await touch(opts.cancel?'touchCancel':'touchEnd',[],[{x:from.x+dx,y:from.y+dy}]);
        await idle();
      }
      for(let cold=0;cold<2;cold++){
        await page.goto(BASE);
        await page.locator('#launch-screen').waitFor({state:'hidden'});
        await page.locator('#list .ting-name').filter({hasText:'Walk'}).first().tap();
        await page.locator('#detail-summary [data-summary-field]').first().waitFor();
        // Reproduce swipes starting on the actual headings and labels, rather
        // than searching only for a blank patch between controls.
        await select('schedule');
        const rhythmOpen=await page.locator('#detail-rhythm-disclosure').evaluate(el=>el.open);
        await drag(-100,0,{from:await center('#detail-rhythm-disclosure > summary')});
        assert.equal(await nav(),'availability','a section heading accepts a swipe');
        assert.equal(await page.locator('#detail-rhythm-disclosure').evaluate(el=>el.open),rhythmOpen,'swiping a heading does not collapse it');
        await select('schedule');
        await page.locator('#detail-rhythm-disclosure > summary').tap();await idle();
        assert.equal(await page.locator('#detail-rhythm-disclosure').evaluate(el=>el.open),!rhythmOpen,'a normal heading tap still toggles its section');
        await page.locator('#detail-rhythm-disclosure > summary').tap();await idle();
        assert.equal(await page.locator('#detail-rhythm-disclosure').evaluate(el=>el.open),rhythmOpen);
        await select('effort');
        await page.locator('#detail-planning-priority-disclosure > summary').scrollIntoViewIfNeeded();
        const priorityOpen=await page.locator('#detail-planning-priority-disclosure').evaluate(el=>el.open);
        await drag(-100,0,{from:await center('#detail-planning-priority-disclosure > summary')});
        assert.equal(await nav(),'tracking','a collapsed section heading accepts a swipe');
        assert.equal(await page.locator('#detail-planning-priority-disclosure').evaluate(el=>el.open),priorityOpen,'a heading swipe does not expand its section');
        await select('summary');
        await drag(-100,0,{from:await center('#detail-name')});
        assert.equal(await nav(),'calendar','the item title accepts a swipe without opening the name editor');
        await drag(100,0,{from:await center('#detail-sub')});
        assert.equal(await nav(),'summary','the item header subtitle accepts a swipe');
        await select('tracking');
        const trackValue=await page.locator('#detail-track-value').getAttribute('aria-pressed');
        await drag(100,0,{from:await center('#detail-logging-disclosure > label > span')});
        assert.equal(await nav(),'effort','field label text accepts a swipe');
        assert.equal(await page.locator('#detail-track-value').getAttribute('aria-pressed'),trackValue,'swiping label text does not toggle its control');
        await select('summary');
        await page.evaluate(()=>{
          window.swipeFrameErrors=[];window.swipeExpected=detailCurrentNav();
          // Sample every frame after navigation has synchronously finished.
          for(const type of ['touchend','click'])document.addEventListener(type,()=>{swipeExpected=detailCurrentNav();});
          function sample(){
            if(!detailIsSingleView()){
              const pager=getSheetInner('detail-sheet')?.querySelector('.detail-pager');
              if(pager?.getClientRects().length){
                const panels=[...pager.querySelectorAll('.detail-page')].filter(p=>p.getClientRects().length);
                if(panels.length!==1 || panels[0].dataset.detailNav!==swipeExpected)swipeFrameErrors.push(panels.map(p=>p.dataset.detailNav));
              }
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
        const keys=await page.evaluate(()=>visibleDetailPages(getSheetInner('detail-sheet').querySelector('.detail-pager')).map(p=>p.dataset.detailNav));
        for(let round=0;round<3;round++){
          for(const key of keys.slice(1)){
            await drag(-130);
            assert.equal(await nav(),key,`${name}: swipe left opens ${key}`);
            await page.evaluate(()=>{visualViewport.dispatchEvent(new Event('resize'));document.querySelector('.detail-pager').dispatchEvent(new Event('scroll'));});
            await idle();
            assert.deepEqual(await panels(),[key],'resize/scroll cannot revert or blank a swipe destination');
          }
          await drag(-130);assert.equal(await nav(),keys.at(-1),'last tab does not wrap');
          for(const key of keys.slice(0,-1).reverse()){
            await drag(100);
            assert.equal(await nav(),key,`${name}: swipe right opens ${key}`);
          }
          await drag(100);assert.equal(await nav(),'summary','first tab does not wrap');
          const priorityNav=await page.evaluate(()=>document.querySelector(assistantFocusDetailSelector('priority',
            assistantFocusSummarySession(detailSummaryRecord()))).closest('.detail-page').dataset.detailNav);
          await page.locator('#detail-summary [data-summary-field="priority"]').tap();
          await idle();assert.deepEqual(await panels(),[priorityNav],'pill remains usable after repeated swipes');
          await page.locator('.detail-page-tab[aria-label="summary"]').tap();
        }
        for(const [dx,dy,opts] of [[20,0,{}],[-100,-120,{}],[-130,0,{cancel:true}],[-130,0,{from:{x:12,y:(await point()).y}}]]){
          await drag(dx,dy,opts);assert.equal(await nav(),'summary','short, vertical, cancelled and edge gestures do not navigate');
        }
        // Start vertically, then turn sideways: vertical scroll keeps ownership.
        const p=await point();
        await touch('touchStart',[p]);await touch('touchMove',[{x:p.x,y:p.y-20}]);
        await touch('touchMove',[{x:p.x-130,y:p.y-20}]);await touch('touchEnd',[],[{x:p.x-130,y:p.y-20}]);
        assert.equal(await nav(),'summary');
        await touch('touchStart',[p]);
        await touch('touchStart',[p,{x:p.x+30,y:p.y,id:2}]);
        await touch('touchMove',[{x:p.x-130,y:p.y}]);await touch('touchEnd',[],[{x:p.x-130,y:p.y}]);
        assert.equal(await nav(),'summary','multi-touch never switches tabs');
        // Interrupted navigation cancels the older gesture instead of switching again.
        await drag(-130,0,{during:()=>page.evaluate(()=>{scrollDetailToNav('identity');swipeExpected='identity';})});
        assert.equal(await nav(),'identity','new navigation cancels a swipe in flight');
        await select('summary');await page.evaluate(()=>{swipeExpected='summary';});
        const pill=await page.locator('#detail-summary [data-summary-field="priority"]').boundingBox();
        await drag(-120,0,{from:{x:pill.x+pill.width/2,y:pill.y+pill.height/2}});
        assert.equal(await nav(),'summary','swiping on a pill does not navigate or click it');
        assert.deepEqual(await page.evaluate(()=>swipeFrameErrors),[],`${name}: no blank frames or reverting selections`);
        await page.locator('#detail-cool').tap();
      }
      // Native vertical scroll, nested horizontal scrolling, and form controls.
      await page.locator('#list .ting-name').filter({hasText:'Walk'}).first().tap();
      await select('identity');
      const nameBox=await page.locator('#detail-habit-message').boundingBox();
      await drag(-100,0,{from:{x:nameBox.x+nameBox.width*.65,y:nameBox.y+nameBox.height/2}});
      assert.equal(await nav(),'identity','text input keeps its drag');
      await page.evaluate(()=>{
        document.activeElement.blur();
        const panel=document.querySelector('[data-detail-nav="identity"]');
        panel.scrollTop=0;
        const host=document.createElement('div');host.id='swipe-scroll-fixture';
        host.style.cssText='height:160px;overflow-x:auto;overflow-y:hidden';
        host.innerHTML='<div style="width:900px;height:150px;background:#eee">Scrollable content</div>';
        const vertical=document.createElement('div');vertical.id='swipe-vertical-fixture';vertical.style.height='900px';
        panel.prepend(host,vertical);
      });
      const scrollBox=await page.locator('#swipe-scroll-fixture').boundingBox();
      await drag(-120,0,{from:{x:scrollBox.x+scrollBox.width*.65,y:scrollBox.y+50}});
      assert.equal(await nav(),'identity','nested horizontal content owns its swipe');
      if(client)assert.ok(await page.locator('#swipe-scroll-fixture').evaluate(el=>el.scrollLeft>0),'native horizontal content still scrolls');
      const vBox=await page.locator('#swipe-vertical-fixture').boundingBox();
      await drag(0,-90,{from:{x:vBox.x+vBox.width*.65,y:vBox.y+110}});
      assert.equal(await nav(),'identity','vertical page scrolling does not select tabs');
      if(client)assert.ok(await page.locator('[data-detail-nav="identity"]').evaluate(el=>el.scrollTop>0),'native vertical page scrolling still works');
      await page.evaluate(()=>{
        $('swipe-scroll-fixture').remove();$('swipe-vertical-fixture').remove();
        sortSettings.minimalMode=true;document.body.classList.add('minimal-mode');applyDetailMinimalMode();showDetailMinimalTab('summary');
      });
      await idle();await drag(-130);assert.equal(await nav(),'settings','minimal mode swipes to settings');
      await drag(100);assert.equal(await nav(),'summary','minimal mode swipes back to Summary');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${name}: repeated bidirectional swipes across two cold opens, pills, boundaries, scroll/resize independence, gesture arbitration and minimal mode (${client?'native touch drags':'DOM touch sequences'})`);
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exit(1);});
