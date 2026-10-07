const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false,
        topics:['Personal development'],locations:[{id:'home',name:'Family home and office',lat:40,lng:-73}]}));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.evaluate(data=>{save(data);render();},Array.from({length:12},(_,i)=>baseHabit({hid:`filter-${i}`,name:`Filter fixture ${i}`,type:'zero',topics:['Personal development'],locationIds:['home']})));
    for(const width of [390,320,260,480]){
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(160);
      for(const assistant of [false,true]){
        await page.evaluate(assistant=>{
          closeSearch();homeTopicFilter='all';homeLocationFilter='all';render();
          document.getElementById('open-assistant').hidden=!assistant;
        },assistant);
        await page.locator('[data-open-home-filters]').tap();
        await page.locator('[data-home-topic="Personal development"]').tap();
        await page.locator('[data-home-location="home"]').tap();
        await page.locator('#home-filter-close').tap();
        await page.waitForTimeout(250);
        const layout=await page.evaluate(()=>{
          const header=document.querySelector('.topbar').getBoundingClientRect();
          const primary=document.querySelector('[data-open-home-filters]').getBoundingClientRect();
          const filters=[...document.querySelectorAll('.home-active-filter')].map(button=>{
            const rect=button.getBoundingClientRect();
            const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
            return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,reachable:button.contains(hit)};
          });
          return {headerBottom:header.bottom,primaryBottom:primary.bottom,filters,listTop:document.getElementById('list').getBoundingClientRect().top};
        });
        assert.equal(layout.filters.length,2,'both filters remain visible');
        for(const filter of layout.filters){
          assert.ok(filter.top>=layout.primaryBottom,`selected filters have their own row at ${width}: ${JSON.stringify(layout)}`);
          assert.ok(filter.left>=0 && filter.right<=width && filter.bottom<=layout.headerBottom,'filter fits inside header');
          assert.ok(filter.reachable,'filter clear control is not clipped or covered');
        }
        assert.ok(layout.listTop>=layout.headerBottom,'header does not overlap the habit list');
        await page.locator('[data-clear-home-topic]').tap();
        assert.equal(await page.evaluate(()=>homeTopicFilter),'all');
        assert.equal(await page.locator('[data-clear-home-location]').count(),1,'clearing topic retains place');
        await page.locator('[data-clear-home-location]').tap();
        assert.equal(await page.evaluate(()=>homeLocationFilter),'all');
        assert.equal(await page.locator('.home-active-filter').count(),0);
      }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS phone topic/place filter layout, reachable clear controls, and assistant spacing');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
