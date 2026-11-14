// Detail must not reread/normalize the saved list for each Summary label.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:412,height:892},serviceWorkers:'block'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(items=>{
      localStorage.setItem('tings_v2',JSON.stringify(items));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({localAssistant:true,localAssistantProvider:'needle',minimalMode:false,agendaOptimizer:false,showWeekOnHome:false}));
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
    },Array.from({length:96},(_,i)=>baseHabit({hid:`item-${i}`,name:`Item ${i}`})));
    await page.goto(BASE);await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    const result=await page.evaluate(()=>{
      const items=load();
      items[0].scheduleLinks=[{direction:'after',anchorHid:items[1].hid,adjacency:'sometime',requireSameDay:true}];
      items[0].allowedTimeStart=540;items[0].allowedTimeEnd=1020;
      save(items);
      const originalLoad=window.load,originalPlaces=window.locationOptions,originalTune=window.currentDetailTune;
      let reads=0,places=0,tunes=0;
      window.load=()=>{reads++;return originalLoad()};
      window.locationOptions=()=>{places++;return originalPlaces()};
      window.currentDetailTune=()=>{tunes++;return originalTune()};
      try{
        const item=originalLoad()[0];
        const first=assistantFocusItemSummary(item);
        const summaryReads=reads,summaryPlaces=places;
        openDetail(0);tunes=0;reads=0;
        updateDetailPagerDots();
        const navReads=reads,navTunes=tunes;
        const saved=originalLoad();saved[1].name='Renamed partner';save(saved);
        const second=assistantFocusItemSummary(originalLoad()[0]);
        document.querySelector('#detail-type-seg [data-detail-type="task"]').click();
        const taskKind=detailNavKind();
        return {summaryReads,summaryPlaces,navReads,navTunes,first:first.custom,second:second.custom,taskKind};
      }finally{window.load=originalLoad;window.locationOptions=originalPlaces;window.currentDetailTune=originalTune;}
    });
    assert.ok(result.summaryReads<=1,`one saved-list read per Summary render (${result.summaryReads})`);
    assert.ok(result.summaryPlaces<=1,'place lookup is shared within a render');
    assert.equal(result.navTunes,0,'tab labels do not serialize the full editor draft');
    assert.ok(result.navReads<=1,'tab sync avoids repeated saved-list reads');
    assert.match(result.first.find(c=>c.id==='scheduleLinks').text,/after Item 1/);
    assert.match(result.second.find(c=>c.id==='scheduleLinks').text,/after Renamed partner/,'a later render reads fresh names');
    assert.equal(result.taskKind,'task','labels still follow unsaved type changes');
    assert.deepEqual(errors,[]);
    console.log('detail opening efficiency: bounded reads, fresh references, live tab labels');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
