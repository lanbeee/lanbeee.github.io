// Real scrolling against shared CSS: native inset, ordinary browser and pane layout.
const assert = require('node:assert/strict');
const playwright = require('playwright');
(async()=>{
 const browser=await playwright[process.env.BROWSER || 'chromium'].launch();
 try {
  const page=await browser.newPage({viewport:{width:412,height:915}});
  await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
  for(const [width,inset] of [[412,0],[412,36],[320,36],[915,24],[1440,0]]){
   await page.setViewportSize({width,height:915});
   await page.waitForTimeout(700);
   await page.evaluate(inset=>{
    document.documentElement.style.setProperty('--safe-area-inset-top',`${inset}px`);
    document.documentElement.style.setProperty('--safe-area-inset-bottom','24px');
    document.documentElement.style.scrollBehavior='auto';
    // Isolate layout from planner contents, with multiple headers replacing each other.
    document.querySelector('#list').innerHTML=Array.from({length:4},(_,i)=>`<div class="section-header">Day ${i+1}</div><div style="height:650px;flex-shrink:0">Agenda rows</div>`).join('');
   },inset);
   await page.waitForTimeout(100);
   for(const scroll of [350,1000,1600]){
    await page.evaluate(scroll=>{
     if(document.body.dataset.paneCount==='1') window.scrollTo(0,scroll);
     else document.querySelector('.pane-list').scrollTop=scroll;
    },scroll);
    await page.waitForTimeout(100);
    const state=await page.evaluate(()=>{
     updateStuckSectionHeaders();
     const headers=[...document.querySelectorAll('.section-header')];
     const active=headers.filter(e=>e.classList.contains('stuck'));
     const pane=document.querySelector('.pane-list');
     const edge=document.body.dataset.paneCount==='1'?parseFloat(getComputedStyle(headers[0]).top):pane.getBoundingClientRect().top;
     return {count:active.length,top:active[0]?.getBoundingClientRect().top,edge,overflow:document.documentElement.scrollWidth>innerWidth,shield:parseFloat(getComputedStyle(document.body,'::before').height)};
    });
    assert.equal(state.count,1,JSON.stringify({width,inset,scroll,state}));
    assert.ok(Math.abs(state.top-state.edge)<2,JSON.stringify(state));
    assert.ok(state.top>=inset,JSON.stringify(state));
    assert.equal(state.shield,inset);
    assert.equal(state.overflow,false);
   }
   console.log(`PASS sticky scroll ${width}px / inset ${inset}px`);
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
