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
    // A whole open reuses the one list its paint loaded, reads settings once,
    // keeps unchanged chip rows in place, and leaves the viewport custom
    // properties at their CSS fallback so a closed sheet cannot dirty the
    // document for the next open.
    const open=await page.evaluate(()=>{
      const originalLoad=window.load,originalSettings=window.loadSortSettings;
      let reads=0,settings=0;
      window.load=()=>{reads++;return originalLoad()};
      window.loadSortSettings=()=>{settings++;return originalSettings()};
      try{
        closeSheet('detail-sheet');
        openDetail(2);
        const row=document.querySelector('#detail-place-chips .tag-row-places');
        syncDetailSchedulePlacesUi();
        const kept=row===document.querySelector('#detail-place-chips .tag-row-places');
        const lifted=document.documentElement.style.getPropertyValue('--detail-viewport-top');
        closeSheet('detail-sheet');
        const rested=document.documentElement.style.getPropertyValue('--detail-viewport-top');
        return {reads,settings,kept,lifted,rested};
      }finally{window.load=originalLoad;window.loadSortSettings=originalSettings;}
    });
    assert.ok(open.reads<=4,`an open loads the saved list a handful of times, not per reader (${open.reads})`);
    assert.ok(open.settings<=2,`an open normalizes settings about once (${open.settings})`);
    assert.ok(open.kept,'unchanged place rows keep their elements across dock syncs');
    assert.equal(open.lifted,'0px','open sheet pins the viewport top at the CSS fallback');
    assert.equal(open.rested,'0px','closing keeps the fallback value so the next open skips a document-wide style pass');
    const topics=await page.evaluate(()=>{
      saveSortSettings({...sortSettings,topics:['Errands']});
      // Warm the same inputs, including the container's initial dataset.
      openDetail(2);openDetail(2);
      $('detail-topic-chips').querySelector('[data-topic="Errands"]').click();
      const edited=selectedTopicsFrom('detail-topic-chips');
      refreshDetailView();
      const cancelled=selectedTopicsFrom('detail-topic-chips');
      $('detail-topic-chips').querySelector('[data-topic="Errands"]').click();
      openDetail(3);
      return {edited,cancelled,nextItem:selectedTopicsFrom('detail-topic-chips'),saved:load()[2].topics};
    });
    assert.deepEqual(topics.edited,['Errands'],'a topic tap updates the draft');
    assert.deepEqual(topics.cancelled,[],'Cancel restores saved topics after a cached paint');
    assert.deepEqual(topics.nextItem,[],'unsaved topics do not carry into another item with the same saved selections');
    assert.deepEqual(topics.saved,[],'cancelled topic edits stay unsaved');
    assert.deepEqual(errors,[]);
    console.log('detail opening efficiency: bounded reads, fresh references, live tab labels');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
