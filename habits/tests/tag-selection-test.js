// Search must never discard hidden selections or their place preferences.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page = await context.newPage();
    // These selectors need no map, weather, icon font, or other remote service.
    await page.route('https://**/*',route=>route.abort());
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_v2','[]');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        agendaOptimizer:false,showWeekOnHome:false,minimalMode:false,defaultType:'keepup',
        topics:['Health','Reading','Work','Family','Rest','Learning','Focus'],
        locations:Array.from({length:12},(_,i)=>({id:`place-${i}`,name:i===9 ? 'Gym & pool' : `Favourite place ${i}`,lat:40+i/100,lng:-74}))
      }));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill('Searchable selections');
    await page.locator('#add-more-toggle').click();
    await page.evaluate(()=>renderTagChips('ting-tag-chips',
      ['Health','Reading','Work','Family','Rest','Learning','Saved topic'],
      ['place-0','place-1','place-2','place-3','place-4','place-5'],null,{'place-0':'high'},false));
    const places = page.locator('#ting-tag-chips .tag-row-places');
    const topics = page.locator('#ting-tag-chips .tag-row-topics');
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>[...$('ting-tag-chips').querySelectorAll('.tag-row')].every(row=>
        row.getBoundingClientRect().height <= 52 && row.querySelector('.tag-search').hidden
      )),'each selector stays one row tall with search tucked away');
    }
    await page.setViewportSize({width:390,height:844});
    const compactScroll = await places.evaluate(row=>{row.scrollLeft = 180;return row.scrollLeft;});
    await page.evaluate(()=>{
      const chip = $('ting-tag-chips').querySelector('[data-location-id="place-3"]');
      chip.focus({preventScroll:true});
      chip.click();
    });
    assert.equal(await places.evaluate(row=>row.scrollLeft),compactScroll,'cycling a place keeps the compact row scroll position');
    assert.equal(await page.evaluate(()=>document.activeElement.matches('.tag-search')),false,'cycling a chip never opens the search keyboard');
    await places.locator('.tag-picker-toggle').click();
    await topics.locator('.tag-picker-toggle').click();
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>[...$('ting-tag-chips').querySelectorAll('.tag-row')].every(row=>{
        const box = row.getBoundingClientRect();
        return row.scrollWidth <= row.clientWidth + 1 && [...row.querySelectorAll('.on')].every(chip=>{
          const r = chip.getBoundingClientRect();
          return !chip.hidden && r.left >= box.left - 1 && r.right <= box.right + 1;
        });
      })),'expanded selections fit without sideways scrolling');
    }
    await page.setViewportSize({width:390,height:844});
    await places.locator('.tag-search').fill('GYM');
    assert.equal(await places.locator('[data-location-id]:visible').count(),7,'search retains every selected place alongside matches');
    assert.equal(await places.locator('[data-location-id="place-10"]').isVisible(),false);
    await places.locator('[data-location-id="place-9"]').click();
    assert.equal(await places.locator('.tag-search').inputValue(),'GYM','selection preserves the query');
    for(const level of ['little','high','avoid','']){
      await places.locator('[data-location-id="place-9"]').click();
      assert.equal(await places.locator('[data-location-id="place-9"]').getAttribute('data-pref'),level);
    }
    assert.equal(await places.locator('[data-location-id="place-9"]').getAttribute('aria-pressed'),'false','preference cycle still removes the place');
    await places.locator('.tag-search').fill('nothing matches');
    assert.equal(await places.locator('[data-location-id]:visible').count(),6);
    assert.ok(await places.locator('.tag-search-empty').isVisible());
    await places.locator('.tag-search').press('Escape');
    assert.equal(await places.locator('[data-location-id]:visible').count(),12);
    assert.ok(await page.locator('#add-sheet').evaluate(el=>el.classList.contains('open')),'Escape clears search before dismissing the sheet');
    await places.locator('.tag-search').press('Enter');
    assert.equal(await page.evaluate(()=>load().length),0,'search keyboard action never submits the item');

    await topics.locator('.tag-search').fill('focus');
    await topics.locator('[data-topic="Focus"]').click();
    await topics.locator('.tag-search').fill('unmatched');
    assert.equal(await topics.locator('[data-topic]:visible').count(),8,'selected topics include saved topics outside the registry');
    await topics.locator('[data-topic="Work"]').click();
    assert.equal(await topics.locator('[data-topic="Work"]').isVisible(),false,'deselected nonmatch leaves the visible selection');
    await topics.locator('[data-topic-add]').click();
    await topics.locator('.topic-chip-input').fill('New & selected');
    await topics.locator('.topic-chip-input').press('Enter');
    assert.ok(await topics.locator('[data-topic="New & selected"]').isVisible(),'Enter creates and selects a topic during search');
    await topics.locator('.tag-picker-toggle').click();
    assert.equal(await topics.locator('.tag-search').isVisible(),false,'done restores the compact row');
    assert.equal(await topics.locator('.tag-picker-toggle').getAttribute('aria-expanded'),'false');
    assert.equal(await topics.locator('.tag-search').inputValue(),'','collapsing clears the query');
    assert.equal(await topics.locator('.tag-selection-count').textContent(),'8','compact row includes the complete selection count');
    await page.locator('#do-save').click();
    const saved = await page.evaluate(()=>load()[0]);
    assert.equal(saved.topics.length,8);
    assert.ok(saved.topics.includes('New & selected') && !saved.topics.includes('Work'));
    assert.equal(saved.locationIds.length,6);
    assert.equal(saved.locationPrefs['place-0'],'high','search preserves existing place rankings through save');

    await page.evaluate(()=>{
      openDetail(0);
      scrollDetailToNav('identity','auto');
      $('detail-priority-disclosure').open = true;
    });
    const detailTopics = page.locator('#detail-topic-chips');
    await detailTopics.locator('.tag-row-topics .tag-picker-toggle').click();
    await detailTopics.locator('.tag-row-topics .tag-search').fill('no result');
    assert.equal(await detailTopics.locator('[data-topic]:visible').count(),8,'saved selections remain visible in the editor');
    assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').classList.contains('tune-dirty')),false,'search alone does not edit the item');
    await page.evaluate(()=>{
      const wrap = $('detail-place-chips');
      wrap.dataset.locationChoiceMode = 'preference';
      renderTagChips(wrap.id,[],load()[0].locationIds,null,load()[0].locationPrefs,false);
      const input = wrap.querySelector('.tag-row-places .tag-search');
      input.value = 'Gym';
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.equal(await page.locator('#detail-place-chips [data-location-id="place-9"]').getAttribute('hidden'),'','preference search never offers a disallowed place');
    assert.equal(await page.locator('#detail-place-chips [data-location-id="place-0"]').getAttribute('hidden'),null,'preference search keeps allowed places visible');
    await page.evaluate(()=>{
      closeDetail();
      updateDefaultProfile({topics:['Health','Focus'],locationIds:['place-0']});
    });
    assert.equal(await page.locator('#default-topics-chips .tag-row-topics .tag-search').count(),1,'defaults use the shared topic selector');
    await page.evaluate(()=>{
      sortSettings.topics = Array.from({length:24},(_,i)=>`Topic ${i}`);
      renderTagChips('default-topics-chips',['Saved outside registry']);
    });
    assert.equal(await page.locator('#default-topics-chips [data-topic="Saved outside registry"]').getAttribute('aria-pressed'),'true','a full registry cannot truncate a saved selection');
    assert.deepEqual(errors,[]);
    console.log('PASS compact rows, expandable search, complete selections, preferences, creation, save and editor');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
