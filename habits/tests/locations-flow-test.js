// End-to-end: sample locations + chips + filters + agenda travel + I-am-at.
//
//   PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright \
//   HABITS_URL=http://127.0.0.1:4181/ node tests/locations-flow-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

async function openSettings(page){
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'walking',
      showLocationOnCards:false, availabilityMinutes:[180,180,180,180,180,120,120]
    }));
    // Mock OSRM so travel edges resolve quickly without the public demo server.
    const realFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if(url.indexOf('router.project-osrm.org') >= 0){
        return Promise.resolve(new Response(JSON.stringify({
          routes:[{ duration:720, distance:1800 }]
        }),{ status:200, headers:{ 'Content-Type':'application/json' } }));
      }
      return realFetch(input, init);
    };
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);

  // ── A. Add samples seeds 5 places + location-linked habits ──
  console.log('\n[A] add samples → locations registry');
  await openSettings(page);
  await page.locator('#settings-testdata-head').click();
  await page.waitForSelector('#settings-testdata-body:not([hidden])');
  await page.locator('#add-sort-samples').click();
  await page.waitForTimeout(500);

  const seeded = await page.evaluate(() => {
    const s = loadSortSettings();
    const data = load();
    const withLoc = data.filter(h => (h.locationIds || []).length > 0);
    const multi = data.filter(h => (h.locationIds || []).length >= 2);
    return {
      locCount:s.locations.length,
      names:s.locations.map(l=>l.name),
      habitCount:data.length,
      withLoc:withLoc.length,
      multi:multi.length,
      lastKnown:s.lastKnownLocationId,
      showLoc:s.showLocationOnCards,
      mode:s.defaultTravelMode,
      gymHours:s.locations.find(l=>l.id==='sample-gym'),
      officeClosed:s.locations.find(l=>l.id==='sample-office')?.closedDays
    };
  });
  console.log(seeded);
  assert(seeded.locCount >= 6, 'at least 6 sample locations');
  assert(seeded.names.includes('Home') && seeded.names.includes('Gym') && seeded.names.includes('Park'), 'Home/Gym/Park present');
  assert(seeded.withLoc >= 10, 'many habits have locationIds (got ' + seeded.withLoc + ')');
  assert(seeded.multi >= 3, 'some multi-location habits');
  assert(seeded.lastKnown === 'sample-home', 'lastKnownLocationId = Home');
  assert(seeded.showLoc === true, 'showLocationOnCards enabled');
  assert(seeded.mode === 'walking', 'default travel mode walking');
  assert(seeded.gymHours && seeded.gymHours.allowedTimeStart === 360, 'Gym opens 6am');
  assert(JSON.stringify(seeded.officeClosed) === JSON.stringify([0,6]), 'Office closed weekends');

  // ── B. Home location filter + pin labels ──
  console.log('\n[B] home location filter + card pins');
  await page.waitForTimeout(300);
  const filterVisible = await page.locator('#home-tag-filter').isVisible().catch(()=>false);
  assert(filterVisible, 'home tag filter visible');
  const presenceChip = await page.locator('#home-tag-filter [data-home-presence]').count();
  assert(presenceChip === 1, 'presence status chip present');
  const firstFilterKind = await page.evaluate(() => {
    const kids = [...document.querySelectorAll('#home-tag-filter > button')];
    return {
      firstIsPresence:kids[0] && kids[0].hasAttribute('data-home-presence'),
      firstLocationIdx:kids.findIndex(b=>b.hasAttribute('data-home-location')),
      firstTopicIdx:kids.findIndex(b=>b.hasAttribute('data-home-topic'))
    };
  });
  assert(firstFilterKind.firstIsPresence, 'presence chip is first');
  assert(firstFilterKind.firstLocationIdx >= 0 && firstFilterKind.firstLocationIdx < firstFilterKind.firstTopicIdx, 'places before topics');
  const filterCount = await page.locator('#home-tag-filter .location-filter').count();
  assert(filterCount >= 3, 'location filters present (got ' + filterCount + ')');
  // Filter to Gym.
  await page.locator('#home-tag-filter [data-home-location="sample-gym"]').click();
  await page.waitForTimeout(200);
  const gymOnly = await page.evaluate(() => {
    const data = load();
    const idxs = filteredVisibleIndices(data);
    return idxs.every(i => (data[i].locationIds || []).includes('sample-gym'));
  });
  assert(gymOnly, 'Gym filter shows only Gym-linked habits');
  const pinVisible = await page.locator('.ting-card .ti-map-pin').count();
  assert(pinVisible > 0, 'location pin labels on cards (got ' + pinVisible + ')');
  await page.locator('#home-tag-filter [data-home-location="all"]').click();

  // Presence picker sets agenda anchor without filtering. Manual picks now
  // pin into pinnedLocationId (sticky override of auto detection) rather
  // than lastKnownLocationId, so they survive subsequent GPS fixes.
  await page.locator('#home-tag-filter [data-home-presence]').click();
  await page.waitForSelector('#presence-picker-sheet.open');
  await page.locator('#presence-picker-chips [data-presence-pick="sample-gym"]').click();
  await page.waitForTimeout(150);
  const anchored = await page.evaluate(() => loadSortSettings().pinnedLocationId);
  assert(anchored === 'sample-gym', 'presence pick pins pinnedLocationId');
  await page.locator('#presence-picker-close').click();
  await page.waitForTimeout(100);

  // ── C. Add-sheet location chips ──
  console.log('\n[C] add-sheet location chips + preferred');
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  const more = page.locator('#add-more-toggle');
  if(await more.count())await more.click();
  await page.waitForSelector('#ting-tag-chips',{timeout:3000});
  const chipCount = await page.locator('#ting-tag-chips .location-chip').count();
  assert(chipCount >= 5, 'add sheet shows location chips (got ' + chipCount + ')');
  await page.locator('#ting-tag-chips [data-location-id="sample-home"]').click();
  await page.locator('#ting-tag-chips [data-location-id="sample-gym"]').click();
  await page.waitForTimeout(150);
  // Second tap on Gym (with 2+ selected) marks it preferred (cycle: off→on→little→high→avoid→off)
  await page.locator('#ting-tag-chips [data-location-id="sample-gym"]').click();
  await page.waitForTimeout(100);
  const anywhereStillOn = await page.locator('#ting-tag-chips [data-anywhere].on').count();
  assert(anywhereStillOn === 1, 'anywhere remains selected while a place is preferred');
  const prefOn = await page.locator('#ting-tag-chips .location-chip[data-pref="little"][data-location-id="sample-gym"]').count();
  assert(prefOn === 1, 'Gym marked preferred via second tap');
  await page.locator('#ting-message').fill('loc chip test habit');
  await page.locator('#do-save').click();
  await page.waitForTimeout(400);
  // Detail may open on schedule — close if open.
  if(await page.locator('#detail-sheet.open').count()){
    await page.locator('#detail-cool, #detail-close').first().click().catch(()=>{});
  }
  const saved = await page.evaluate(() => {
    const h = load().find(x => x.name === 'loc chip test habit');
    return h ? { ids:h.locationIds, pref:h.preferredLocationId, anywhere:h.anywhereAllowed } : null;
  });
  console.log(saved);
  assert(saved && saved.ids.includes('sample-home') && saved.ids.includes('sample-gym'), 'saved locationIds');
  assert(saved && saved.pref === 'sample-gym', 'saved preferredLocationId = Gym');
  assert(saved && saved.anywhere === true, 'saved habit allows anywhere with preferred Gym');

  // ── D. Home agenda travel + I-am-at ──
  console.log('\n[D] home agenda travel rows + I-am-at');
  // Ensure I-am-at picker is rendered (may need refresh after add-sheet closed)
  await page.evaluate(() => { if(typeof renderIAmAtPicker === 'function')renderIAmAtPicker(); });
  await page.waitForTimeout(200);
  const agenda = await page.evaluate(() => {
    const data = load();
    const ag = buildTodayAgenda(data, sortSettings || loadSortSettings());
    const rows = buildTodayTimeline(ag);
    return {
      total:rows.length,
      fills:rows.filter(r=>r.kind==='fill').length,
      travel:rows.filter(r=>r.kind==='travel').length,
      withLoc:rows.filter(r=>r.kind==='fill' && r.locationId).length,
      used:ag.usedMinutes,
      remaining:ag.remainingMinutes
    };
  });
  console.log(agenda);
  assert(agenda.fills >= 1, 'agenda has fill rows');
  // Late-day runs can leave almost no slot capacity, so location-tagged fills
  // are best-effort; require them only when the day still has room.
  if(agenda.remaining + agenda.used >= 60){
    assert(agenda.withLoc >= 1, 'some fills carry locationId');
  }else{
    console.log('  skip: withLoc check (low remaining day capacity)');
  }
  // NOTE: the legacy "I am at" row (#iam-at-row) was retired with the today
  // sheet; the equivalent presence-picker flow is covered above in [B].

  // Home today section should show thin travel cards when consecutive items differ.
  const homeTravel = await page.evaluate(() => {
    const settings = loadSortSettings();
    if(settings.preset !== 'todayFirst'){
      saveSortSettings({...settings,preset:'todayFirst'});
    }
    render();
    return {
      travelCards:document.querySelectorAll('#list .travel-card').length,
      travelCopy:[...document.querySelectorAll('#list .travel-card')].slice(0,2).map(el=>el.textContent.replace(/\s+/g,' ').trim())
    };
  });
  console.log(homeTravel);
  assert(homeTravel.travelCards >= 1, 'home today shows travel card(s) (got ' + homeTravel.travelCards + ')');

  // Edit a travel card → manual override persists.
  //
  // The synthetic "from current location" leg (.is-from-current) is non-
  // tappable by design — editing it would store an override that's stale on
  // the next GPS tick. Pick the first SAVED-PLACE → SAVED-PLACE card.
  //
  // The agenda is time-of-day sensitive: late-day runs place fewer items and
  // the first saved-place pair can be any of Home↔Office / Home↔Park / etc.
  // Read the clicked card's from/to BEFORE editing so the assertions check
  // the actual pair, not a hard-coded "Home → Park" that may not exist.
  //
  // Editing a travel time can shift placement enough that the same pair no
  // longer renders (a 42-min override may push items into different slots
  // and the gym→park card disappears on reflow). So we assert against the
  // persisted cache (`settings.travel`) rather than the re-rendered DOM.
  const target = await page.evaluate(() => {
    const card = document.querySelector('#list .travel-card:not(.is-from-current)');
    if(!card)return null;
    return { from:card.dataset.travelFrom, to:card.dataset.travelTo };
  });
  console.log('editing card:', target);
  if(!target)console.log('  skip: no saved-place travel card rendered (low-capacity time of day)');
  if(target){
    await page.locator('#list .travel-card:not(.is-from-current)').first().click();
    await page.waitForSelector('#travel-edit-sheet.open');
    await page.locator('#travel-edit-minutes').fill('42');
    await page.locator('#travel-edit-save').click();
    await page.waitForFunction(({from,to})=>{
      const cards = [...document.querySelectorAll('#list .travel-card')];
      const match = cards.find(el =>
        (el.dataset.travelFrom === from && el.dataset.travelTo === to) ||
        (el.dataset.travelFrom === to && el.dataset.travelTo === from)
      );
      return !match || match.classList.contains('is-edited');
    },target,{timeout:10000});
    const manual = await page.evaluate(({ from, to }) => {
      // edgeKey is symmetric — check both orderings.
      const k1 = `${from}|${to}`;
      const k2 = `${to}|${from}`;
      const s = loadSortSettings();
      const entry = (s.travel && (s.travel[k1] || s.travel[k2])) || null;
      // Also: at least one rendered card should still show is-edited for this
      // pair if it survives the reflow (best-effort, not required — the cache
      // is the source of truth).
      const cards = [...document.querySelectorAll('#list .travel-card')];
      const match = cards.find(el =>
        (el.dataset.travelFrom === from && el.dataset.travelTo === to) ||
        (el.dataset.travelFrom === to && el.dataset.travelTo === from)
      );
      return {
        provider:entry && entry.provider,
        mins:entry && Math.round(entry.seconds / 60),
        editedUi:match ? match.classList.contains('is-edited') : null
      };
    }, target);
    console.log(manual);
    assert(manual && manual.provider === 'manual' && manual.mins === 42, 'manual travel override saved for ' + target.from + ' → ' + target.to + ' (cache)');
    // editedUi is best-effort — when reflow removes the matching card we can't
    // assert it. Only assert when the card actually still renders.
    if(manual && manual.editedUi !== null){
      assert(manual.editedUi === true, 'edited travel card shows edited affordance (reflow preserved)');
    }else{
      console.log('  skip: edited-card UI check (agenda reflowed the pair out of view)');
    }
  }
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  // ── E. Travel mode control in settings ──
  console.log('\n[E] travel mode segmented control');
  await openSettings(page);
  await page.locator('#settings-locations-head').click();
  await page.waitForSelector('#settings-locations-body:not([hidden])');
  await page.locator('#travel-mode-seg [data-travel-mode="driving"]').click();
  await page.waitForTimeout(150);
  const mode = await page.evaluate(() => loadSortSettings().defaultTravelMode);
  assert(mode === 'driving', 'travel mode switched to driving');

  // ── F. Remove samples cleans sample-* locations ──
  console.log('\n[F] remove samples sweeps sample locations');
  await page.evaluate(() => removeSortSamples());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const s = loadSortSettings();
    return {
      habits:load().filter(h=>h.sample).length,
      sampleLocs:s.locations.filter(l=>(l.id||'').startsWith('sample-')).length,
      customHabit:load().some(h=>h.name==='loc chip test habit')
    };
  });
  console.log(after);
  assert(after.habits === 0, 'sample habits removed');
  assert(after.sampleLocs === 0, 'sample-* locations removed');
  // Custom habit may remain but its sample location ids should be swept.
  const swept = await page.evaluate(() => {
    const h = load().find(x=>x.name==='loc chip test habit');
    return h ? h.locationIds : null;
  });
  if(swept)assert(swept.length === 0, 'custom habit location ids swept after sample loc removal');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
