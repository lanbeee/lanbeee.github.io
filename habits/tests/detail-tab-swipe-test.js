// Native horizontal detail scrolling: real Chromium touch drags and desktop
// trackpad-style wheel input in Chromium/WebKit. Mobile WebKit's scroll/layout
// behavior is covered by programmatic scrolling; it has no native drag API.
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const {BASE,baseHabit}=require('./helpers/planner-test-helpers');

(async()=>{
  for(const [name,engine] of Object.entries({chromium,webkit})){
    const browser=await engine.launch();
    try{
      for(const phone of [true,false]){
        const page=await browser.newPage({...phone?devices['iPhone X']:{viewport:{width:1440,height:1000}},serviceWorkers:'block'});
        const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(item=>{
          localStorage.setItem('tings_v2',JSON.stringify([item]));
          localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,
            localAssistantProvider:'needle',agendaOptimizer:false,showWeekOnHome:false}));
          for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
        },baseHabit({hid:'native-scroll',name:'Walk',priority:0,durationMinutes:40,allowedWeekdays:[1,3,5]}));
        const client=phone && name==='chromium'?await page.context().newCDPSession(page):null;
        const pager=page.locator('.detail-pager');
        const select=key=>page.evaluate(key=>scrollDetailToNav(key),key);
        const settled=async key=>{
          await page.waitForFunction(key=>{
            const pager=getSheetInner('detail-sheet').querySelector('.detail-pager');
            const i=detailPageIndexByNav(key);
            return detailCurrentNav()===key && Math.abs(pager.scrollLeft-i*pager.clientWidth)<1;
          },key,{timeout:5000}).catch(async error=>{
            console.error(await pager.evaluate(el=>({nav:detailCurrentNav(),left:el.scrollLeft,width:el.clientWidth,
              pages:visibleDetailPages(el).map(p=>({nav:p.dataset.detailNav,left:p.getBoundingClientRect().left,width:p.getBoundingClientRect().width}))})));
            throw error;
          });
          await page.waitForTimeout(120);
          assert.equal(await page.evaluate(()=>detailCurrentNav()),key,'settled tab does not bounce back');
        };
        async function dragOn(selector,dx){
          const box=await page.locator(selector).boundingBox();assert.ok(box,selector);
          const from={x:box.x+box.width*.6,y:box.y+Math.min(box.height/2,40)};
          await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1,radiusX:1,radiusY:1}]});
          for(let step=1;step<=14;step++){
            await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+dx*step/14,y:from.y,id:1,radiusX:1,radiusY:1}]});
            await page.waitForTimeout(16);
            if(step===7)assert.ok(await pager.evaluate(el=>Math.abs(el.scrollLeft/el.clientWidth-Math.round(el.scrollLeft/el.clientWidth))>.02),
              'content follows the finger before release');
          }
          await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        }
        async function move(direction,key,selector='.detail-summary-note'){
          if(client)await dragOn(selector,-direction*220);
          else if(!phone){
            const box=await pager.boundingBox();await page.mouse.move(box.x+box.width*.65,box.y+80);
            await page.mouse.wheel(direction*await pager.evaluate(el=>el.clientWidth),0);
          }else await pager.evaluate((el,direction)=>el.scrollBy({left:direction*el.clientWidth,behavior:'instant'}),direction);
          await settled(key);
        }
        for(let cold=0;cold<2;cold++){
          await page.goto(BASE);
          await page.locator('#launch-screen').waitFor({state:'hidden'});
          await page.evaluate(()=>openDetail(0));
          await page.locator('#detail-summary [data-summary-field]').first().waitFor();
          await settled('summary');
          assert.equal(await pager.evaluate(el=>getComputedStyle(el).overflowX),'auto');
          assert.ok(await pager.evaluate(el=>el.scrollWidth>el.clientWidth*5),'real horizontal strip renders the adjacent panels');
          // Scroll from actual section headings. A horizontal drag must not
          // toggle a disclosure, and a plain tap must still toggle it.
          await select('schedule');await settled('schedule');
          const heading=page.locator('#detail-rhythm-disclosure > summary');
          const open=await heading.evaluate(el=>el.parentElement.open);
          await move(1,'availability','#detail-rhythm-disclosure > summary');
          assert.equal(await heading.evaluate(el=>el.parentElement.open),open);
          await select('schedule');await settled('schedule');
          await heading.click();assert.equal(await heading.evaluate(el=>el.parentElement.open),!open);
          await heading.click();assert.equal(await heading.evaluate(el=>el.parentElement.open),open);
          for(let round=0;round<3;round++){
            await select('summary');await settled('summary');
            await move(1,'calendar','.detail-summary-page');
            await move(-1,'summary','.detail-calendar-page');
            // A pill wins even while native momentum could still be active.
            await page.locator('#detail-summary [data-summary-field="priority"]').click();
            await settled('effort');
            await page.evaluate(()=>{visualViewport.dispatchEvent(new Event('resize'));});
            await settled('effort');
            const size=page.viewportSize();
            await page.setViewportSize({...size,height:size.height-100});await settled('effort');
            await page.setViewportSize(size);await settled('effort');
          }
          // Changing width preserves the chosen tab rather than interpreting
          // the old pixel offset as another destination.
          const size=page.viewportSize();
          await page.setViewportSize({width:size.width+60,height:size.height});await settled('effort');
          await page.setViewportSize(size);await settled('effort');
          // A nested horizontal list owns its scroll, including at its edge.
          await select('identity');await settled('identity');
          await page.evaluate(()=>{
            const host=document.createElement('div');host.id='native-list-fixture';
            host.style.cssText='height:160px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain';
            host.innerHTML='<div style="width:900px;height:150px;background:#eee">Scrollable list</div>';
            document.querySelector('[data-detail-nav="identity"]').prepend(host);
          });
          if(client){
            // This drag is intentionally tested without the pager-motion assertion.
            const box=await page.locator('#native-list-fixture').boundingBox();
            await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+220,y:box.y+50,id:1}]});
            for(let i=1;i<=10;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+220-i*15,y:box.y+50,id:1}]});
            await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          }else if(!phone){
            await page.locator('#native-list-fixture').hover();await page.mouse.wheel(200,0);
          }else await page.locator('#native-list-fixture').evaluate(el=>el.scrollLeft=200);
          await settled('identity');
          assert.ok(await page.locator('#native-list-fixture').evaluate(el=>el.scrollLeft>0),'nested list scrolls independently');
          await page.locator('#native-list-fixture').evaluate(el=>el.remove());
          await page.evaluate(()=>closeDetail());
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS ${name} ${phone?'phone':'desktop'}: native strip, repeated bidirectional scrolling, headings, pills, keyboard height, width changes and nested scrolling (${client?'native touch':phone?'scroll/layout':'native wheel'})`);
        await page.close();
      }
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exit(1);});
