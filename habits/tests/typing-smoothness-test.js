// Keystrokes in Home search, Detail search, Detail ask, Settings search, and
// Assistant must stay lightweight — no per-keystroke settings/storage storms,
// no synchronous full-list home renders blocking the typed glyph, and no
// per-keystroke computed-style sweeps in minimal detail search.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:412,height:892},serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    const seedItems = Array.from({length:40},(_,i)=>baseHabit({
      hid:`smooth-${i}`,
      name:i === 0 ? 'Morning run' : `Routine item ${i}`,
      topics:['Health'],
      locationIds:['loc-home'],
      allowedWeekdays:[1,2,3,4,5]
    }));
    await page.addInitScript(items=>{
      localStorage.setItem('tings_v2',JSON.stringify(items));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        localAssistant:true,
        localAssistantProvider:'needle',
        minimalMode:false,
        agendaOptimizer:false,
        locations:[{id:'loc-home',name:'Home',address:'123 Main St',lat:40.71,lng:-74.0}],
        topics:['Health'],
        weatherProfiles:[{id:'wp-dry',name:'Dry',rules:{precipitation:'dry'}}]
      }));
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
    },seedItems);

    await page.goto(BASE);
    await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(()=>{ window.assistantNeedleCanSend = ()=>true; });

    // 1. Home screen search: keystrokes coalesce without synchronous/pre-paint
    //    renders, reuse the search snapshot across renders, and clearing yields
    //    past paint before restoring the full list.
    await page.click('#open-search');
    const home = await page.evaluate(async()=>{
      const origLoad = window.load;
      const origRender = window.render;
      let loads = 0, syncRenders = 0, totalRenders = 0;
      window.load = (...args)=>{ loads++; return origLoad(...args); };
      window.render = (...args)=>{ totalRenders++; return origRender(...args); };
      const input = $('habit-search');
      input.focus();
      try{
        for(const q of ['m','mo','mor','morn','morni','mornin','morning']){
          const before = totalRenders;
          input.value = q;
          input.dispatchEvent(new InputEvent('input',{bubbles:true,data:q.slice(-1)}));
          if(totalRenders > before)syncRenders++;
        }
        const rendersRightAfterBurst = totalRenders;
        await new Promise(r=>setTimeout(r,200));
        const cardsAfter = document.querySelectorAll('#list .ting-card').length;
        const loadsAfterFirstQuery = loads;
        // Refining the query inside the same search session reuses the snapshot.
        input.value = 'morning run';
        input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'n'}));
        await new Promise(r=>setTimeout(r,200));
        const loadsAfterRefine = loads;
        const cardsAfterRefine = document.querySelectorAll('#list .ting-card').length;
        // Backspace-clearing yields past paint (no synchronous render inside input).
        const beforeClear = totalRenders;
        input.value = '';
        input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
        const syncRenderOnClear = totalRenders - beforeClear;
        await new Promise(r=>setTimeout(r,120));
        const cardsRestored = document.querySelectorAll('#list .ting-card').length;
        return {syncRenders,rendersRightAfterBurst,totalRenders,cardsAfter,loadsAfterFirstQuery,loadsAfterRefine,cardsAfterRefine,syncRenderOnClear,cardsRestored};
      }finally{
        window.load = origLoad;
        window.render = origRender;
      }
    });
    assert.equal(home.syncRenders,0,'home search never runs render() synchronously inside input');
    assert.equal(home.rendersRightAfterBurst,0,'home search coalesces rapid keystrokes past paint');
    assert.equal(home.cardsAfter,1,'home search renders the matching item after debounce');
    assert.ok(home.loadsAfterFirstQuery <= 2,`home search reads storage at most twice on first render (${home.loadsAfterFirstQuery})`);
    assert.equal(home.loadsAfterRefine,home.loadsAfterFirstQuery,'refining a home search reuses the cached search snapshot with 0 extra load() calls');
    assert.equal(home.cardsAfterRefine,1);
    assert.equal(home.syncRenderOnClear,0,'clearing home search yields past paint before restoring full list');
    assert.ok(home.cardsRestored >= 40,`clearing home search restores all items (${home.cardsRestored})`);
    await page.evaluate(()=>closeSearch());

    // 2. Detail search (minimal mode): no per-keystroke getComputedStyle sweep,
    //    and fuzzy typo matching stays intact.
    const detailSearch = await page.evaluate(()=>{
      saveSortSettings({...sortSettings,minimalMode:true});
      document.body.classList.add('minimal-mode');
      openDetail(0);
      setDetailSearchOpen(true);
      const origGCS = window.getComputedStyle;
      let gcsCalls = 0;
      window.getComputedStyle = (...args)=>{ gcsCalls++; return origGCS(...args); };
      const input = $('detail-search-input');
      try{
        for(const q of ['d','du','dur','dura','durat','durato','duraton']){
          input.value = q;
          input.dispatchEvent(new InputEvent('input',{bubbles:true,data:q.slice(-1)}));
        }
        const matched = [...document.querySelectorAll('#detail-search-results b')].some(b=>b.textContent === 'Duration');
        return {gcsCalls,matched};
      }finally{
        window.getComputedStyle = origGCS;
        setDetailSearchOpen(false);
        saveSortSettings({...sortSettings,minimalMode:false});
        document.body.classList.remove('minimal-mode');
      }
    });
    assert.equal(detailSearch.gcsCalls,0,'minimal detail search avoids getComputedStyle calls while typing');
    assert.equal(detailSearch.matched,true,'detail search still matches single-edit typos');

    // 3. Detail summary ask: typing does not re-parse settings or re-load data
    //    on every keystroke, enables Send immediately, and refreshes guides after pause.
    const detailAsk = await page.evaluate(async()=>{
      openDetail(0);
      scrollDetailToNav('summary','auto');
      syncDetailSummaryDock();
      // Warm initial catalog once, then measure typing burst.
      const origLoad = window.load;
      const origSettings = window.loadSortSettings;
      let loads = 0, settings = 0;
      window.load = (...args)=>{ loads++; return origLoad(...args); };
      window.loadSortSettings = (...args)=>{ settings++; return origSettings(...args); };
      const input = $('detail-ask-input');
      try{
        const phrase = 'make it 20 minutes on mondays';
        for(let i = 1;i <= phrase.length;i++){
          input.value = phrase.slice(0,i);
          input.dispatchEvent(new InputEvent('input',{bubbles:true,data:phrase[i - 1]}));
        }
        const sendEnabledImmediately = !$('detail-ask-send').disabled;
        const loadsDuringType = loads;
        const settingsDuringType = settings;
        await new Promise(r=>setTimeout(r,150));
        const guidesVisible = !$('detail-ask-guides').hidden && document.querySelectorAll('#detail-ask-guides-row button').length > 0;
        return {sendEnabledImmediately,loadsDuringType,settingsDuringType,loadsAfter:loads,settingsAfter:settings,guidesVisible};
      }finally{
        window.load = origLoad;
        window.loadSortSettings = origSettings;
        closeSheet('detail-sheet');
      }
    });
    assert.equal(detailAsk.sendEnabledImmediately,true,'detail ask enables Send immediately on input');
    assert.equal(detailAsk.loadsDuringType,0,'detail ask does not call load() synchronously per keystroke');
    assert.equal(detailAsk.settingsDuringType,0,'detail ask does not call loadSortSettings() per keystroke');
    assert.ok(detailAsk.settingsAfter <= 1,`detail ask settings reads stay bounded after guide debounce (${detailAsk.settingsAfter})`);
    assert.equal(detailAsk.guidesVisible,true,'detail ask still renders setting guides after typing pauses');

    // 4. Assistant focus & guide search: bounded settings reads across typing.
    const assistant = await page.evaluate(async()=>{
      await assistantOpenForItem('smooth-0','detail');
      $('assistant-input').value = '';
      assistantToggleGuideBrowser(true);
      assistantRenderGuideBrowser();
      const origSettings = window.loadSortSettings;
      let settings = 0;
      window.loadSortSettings = (...args)=>{ settings++; return origSettings(...args); };
      const input = $('assistant-input');
      try{
        for(const q of ['w','we','wee','week','weekd','weekda','weekday','weekdays']){
          input.value = q;
          input.dispatchEvent(new InputEvent('input',{bubbles:true,data:q.slice(-1)}));
        }
        const matches = document.querySelectorAll('#assistant-guide-results [data-assistant-guide]').length;
        return {settings,matches};
      }finally{
        window.loadSortSettings = origSettings;
        closeAssistantSheet();
      }
    });
    assert.equal(assistant.settings,0,'assistant guide search does not re-parse settings while typing');
    assert.ok(assistant.matches >= 1,'assistant guide search still returns matching settings');

    assert.deepEqual(errors,[]);
    console.log('typing smoothness: coalesced home search, cached detail/assistant lookups, zero per-keystroke storms');
  }finally{
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1);});
