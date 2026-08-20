// Sample habits sheet (About → sample habits) smoke test.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/sample-habits-sheet-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

async function launchBrowser(){
  // Bundled headless_shell can SEGV under suite load; prefer system Chrome, then retry.
  const attempts = [
    { headless:true, channel:'chrome' },
    { headless:true },
    { headless:true, args:['--disable-gpu'] }
  ];
  let lastErr = null;
  for(const opts of attempts){
    for(let i = 0; i < 2; i++){
      try{
        return await chromium.launch(opts);
      }catch(err){
        lastErr = err;
        await sleep(400);
      }
    }
  }
  throw lastErr || new Error('chromium.launch failed');
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[A] About footer + expandable cards');
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  const aboutBtns = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#about-sheet .about-block')];
    const labels = blocks.map(b => b.querySelector('.about-label')?.textContent || '');
    const collapsed = blocks.every(b => {
      const head = b.querySelector('.about-collapse-head');
      const body = b.querySelector('.about-collapse-body');
      return head?.getAttribute('aria-expanded') === 'false' && body?.hidden === true;
    });
    return {
      sample: !!document.getElementById('open-sample-habits'),
      settings: !!document.getElementById('open-settings'),
      done: !!document.getElementById('about-close'),
      blocks: blocks.length,
      labels,
      collapsed,
      planSummary: document.querySelector('[data-collapse-target="about-plan-body"] .about-summary')?.textContent || ''
    };
  });
  console.log(aboutBtns);
  assert(aboutBtns.sample && aboutBtns.settings && aboutBtns.done, 'About shows sample habits, settings, done');
  assert(aboutBtns.blocks >= 6, 'About has six how-to cards');
  assert(aboutBtns.labels.includes('Plan') && /agenda|busy|open hours/i.test(aboutBtns.planSummary), 'Plan card covers week agenda');
  assert(aboutBtns.collapsed, 'About cards collapsed by default');

  await page.locator('[data-collapse-target="about-start-body"]').click();
  const afterStart = await page.evaluate(() => ({
    startOpen: !document.getElementById('about-start-body')?.hidden,
    startExpanded: document.querySelector('[data-collapse-target="about-start-body"]')?.getAttribute('aria-expanded') === 'true'
  }));
  assert(afterStart.startOpen && afterStart.startExpanded, 'Start expands on tap');

  await page.locator('[data-collapse-target="about-log-body"]').click();
  const afterLog = await page.evaluate(() => ({
    startClosed: document.getElementById('about-start-body')?.hidden === true,
    logOpen: !document.getElementById('about-log-body')?.hidden
  }));
  assert(afterLog.startClosed && afterLog.logOpen, 'accordion: Log open closes Start');

  await page.locator('[data-collapse-target="about-plan-body"]').click();
  const planDetail = await page.evaluate(() => document.getElementById('about-plan-body')?.textContent || '');
  assert(/busy times|open hours|packs/i.test(planDetail), 'Plan detail mentions blocking and packing');

  console.log('\n[B] Sample habits sheet layout');
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  const sheet = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#sample-habits-preview .sample-habit-row')].map(r => ({
      title: r.querySelector('b')?.textContent || '',
      blurb: r.querySelector('small')?.textContent || '',
      add: r.querySelector('[data-add-sample]')?.textContent?.trim() || ''
    }));
    const prayersBody = document.getElementById('sample-prayers-body');
    const blocksBody = document.getElementById('sample-blocks-body');
    const blockRows = blocksBody ? [...blocksBody.querySelectorAll('.sample-habit-row')] : [];
    return {
      rows: rows.length,
      titles: rows.map(r => r.title),
      rowAdds: rows.filter(r => r.add === 'add').length,
      noSleepHabit: !rows.some(r => r.title === 'sleep'),
      blocksCollapsed: blocksBody ? blocksBody.hidden : null,
      hasBlockSleep: blockRows.some(r => r.querySelector('b')?.textContent === 'sleep'),
      blockAddBtn: blockRows.length ? blockRows[0].querySelector('[data-add-sample]')?.textContent?.trim() : null,
      prayersCollapsed: prayersBody ? prayersBody.hidden : null,
      addAll: !!document.getElementById('sample-habits-add'),
      addPrayers: !!document.getElementById('sample-prayers-add'),
      removeSamples: !!document.getElementById('remove-sort-samples'),
      removeDisabled: document.getElementById('remove-sort-samples')?.disabled === true,
      testdataGone: !document.getElementById('settings-testdata-head'),
      aboutClosed: !document.getElementById('about-sheet')?.classList.contains('open')
    };
  });
  console.log(sheet);
  assert(sheet.aboutClosed, 'About closes when opening sample habits');
  assert(sheet.rows >= 8 && sheet.addAll && sheet.rowAdds >= 8, 'feature rows each have add + add all');
  assert(sheet.noSleepHabit, 'sleep is a busy time sample, not a habit row');
  assert(sheet.blocksCollapsed === true && sheet.hasBlockSleep && sheet.blockAddBtn === 'add', 'busy-time section has sleep sample to add');
  assert(sheet.removeSamples && sheet.removeDisabled, 'remove samples on sheet, disabled when none');
  assert(sheet.testdataGone, 'settings test data section removed');
  assert(sheet.prayersCollapsed === true, 'daily prayers collapsed by default');
  assert(!sheet.titles.some(t => /^(Fajr|Dhuhr|Asr|Maghrib|Isha)$/i.test(t)), 'five prayers not in feature preview list');

  console.log('\n[C] Add one or two demos — sheet stays open + undo toast');
  await page.locator('#sample-habits-preview [data-add-sample="sample-feature-water"]').click();
  await page.waitForSelector('#action-toast.show');
  const undoToast = await page.evaluate(() => ({
    text: document.getElementById('action-text')?.textContent || '',
    undo: document.getElementById('action-undo')?.textContent || '',
    pending: pendingAction && pendingAction.type === 'add-samples'
  }));
  assert(/added/i.test(undoToast.text) && undoToast.undo === 'undo' && undoToast.pending, 'single add shows action toast with undo');
  await page.locator('#action-undo').click();
  await page.waitForTimeout(300);
  const afterUndo = await page.evaluate(() => ({
    water: load().some(h => (h.hid || '') === 'sample-feature-water'),
    waterBtn: document.querySelector('#sample-habits-preview [data-add-sample="sample-feature-water"]')?.textContent?.trim()
  }));
  assert(!afterUndo.water && afterUndo.waterBtn === 'add', 'undo removes the single add');

  await page.locator('#sample-habits-preview [data-add-sample="sample-feature-water"]').click();
  await page.waitForTimeout(300);
  await page.locator('#sample-habits-preview [data-add-sample="sample-feature-timed-run"]').click();
  await page.waitForTimeout(300);
  const afterFew = await page.evaluate(() => {
    const data = load();
    const byHid = hids => data.filter(h => hids.includes(h.hid));
    const added = byHid(['sample-feature-water','sample-feature-timed-run']);
    const waterBtn = document.querySelector('#sample-habits-preview [data-add-sample="sample-feature-water"]');
    const samplePlaces = (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-'));
    return {
      addedCount: added.length,
      addedAreSample: added.every(h => h.sample === false),
      addedNames: added.map(h => h.name),
      sheetOpen: document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      waterLabel: waterBtn?.textContent?.trim(),
      waterDisabled: waterBtn?.disabled === true,
      placeCount: samplePlaces.length,
      placeIds: samplePlaces.map(l => l.id)
    };
  });
  console.log(afterFew);
  assert(afterFew.sheetOpen, 'sheet stays open after single adds');
  assert(afterFew.addedCount === 2, 'exactly two feature demos added');
  assert(afterFew.addedAreSample, 'individually added demos are not marked as sample');
  assert(afterFew.addedNames.every(n => !n.startsWith('Sample: ')), 'individually added demos have no Sample: prefix');
  assert(afterFew.waterLabel === 'added' && afterFew.waterDisabled, 'added row shows added state');
  assert(afterFew.placeCount === 1 && afterFew.placeIds[0] === 'sample-park', 'only places referenced by added demos are seeded');

  console.log('\n[D] Add all demos requires home city (sunrise windows), then fills');
  // Stretch / night work / sleep all use dynamic times, so add-all is gated
  // on the home city like the prayers — it redirects to Settings → Locations.
  await page.locator('#sample-habits-add').click();
  await page.waitForTimeout(400);
  const blockedAll = await page.evaluate(() => ({
    sampleCount: load().filter(h => h.sample).length,
    settingsOpen: document.getElementById('settings-sheet')?.classList.contains('open'),
    locationsOpen: document.getElementById('settings-locations-body')
      ? !document.getElementById('settings-locations-body').hidden
      : false
  }));
  console.log(blockedAll);
  assert(blockedAll.sampleCount === 0, 'add-all blocked without home city');
  assert(blockedAll.settingsOpen && blockedAll.locationsOpen, 'add-all opens Settings → Locations to set city');

  await page.evaluate(() => {
    updateSortSetting({
      homeCityName:'New York, United States',
      homeCityLat:40.7128,
      homeCityLng:-74.0060
    },{renderNow:false,sync:false});
  });
  await page.locator('#settings-close').click();
  await page.locator('#open-about').click();
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  await page.locator('#sample-habits-add').click();
  await page.waitForTimeout(500);
  const afterTour = await page.evaluate(() => {
    const data = load();
    const samples = data.filter(h => h.sample);
    const prayers = samples.filter(h => String(h.hid || '').startsWith('sample-prayer-'));
    const samplePlaces = (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-'));
    return {
      sampleCount: samples.length,
      prayerCount: prayers.length,
      hasSunrise: samples.some(h => h.allowedTimeStartAnchor === 'sunrise'),
      hasBreakable: samples.some(h => h.breakable),
      noSleepHabit: !samples.some(h => (h.hid || '') === 'sample-feature-sleep'),
      sheetClosed: !document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      placeCount: samplePlaces.length
    };
  });
  console.log(afterTour);
  assert(afterTour.sheetClosed, 'sample sheet closes after add all');
  assert(afterTour.sampleCount >= 6 && afterTour.prayerCount === 0, 'feature samples filled without prayers');
  assert(afterTour.hasSunrise && afterTour.hasBreakable, 'showcase fields present');
  assert(afterTour.noSleepHabit, 'add-all does not create a sleep habit');
  assert(afterTour.placeCount >= 5, 'add-all demos seeds all referenced sample places');

  console.log('\n[E] Sleep busy time requires home city, then replaces default sleep block');
  await page.locator('#open-about').click();
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  // Default sleep block is fixed 11pm–5am; sample row is not marked added.
  const defaultSleep = await page.evaluate(() => {
    const blocks = normalizeBlockedTimes(loadSortSettings().blockedTimes);
    return {
      sleep: blocks.find(b => String(b.label || '').toLowerCase() === 'sleep'),
      rowState: document.querySelector('#sample-blocks-preview [data-add-sample="sample-block-sleep"]')?.textContent?.trim()
    };
  });
  assert(defaultSleep.sleep && defaultSleep.sleep.startAnchor == null, 'default sleep block is fixed');
  assert(defaultSleep.rowState === 'add', 'sleep sample row not added before install');

  await page.evaluate(() => {
    // No city → blocked, redirected to Settings → Locations.
    const s = loadSortSettings();
    s.homeCityName = ''; s.homeCityLat = null; s.homeCityLng = null;
    saveSortSettings(s);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
  });
  await page.locator('#sample-blocks-head').click();
  await page.waitForSelector('#sample-blocks-body:not([hidden])');
  await page.locator('#sample-blocks-preview [data-add-sample="sample-block-sleep"]').click();
  await page.waitForTimeout(400);
  const blockedSleep = await page.evaluate(() => ({
    dynamic: normalizeBlockedTimes(loadSortSettings().blockedTimes).some(b => String(b.label || '').toLowerCase() === 'sleep' && b.startAnchor),
    settingsOpen: document.getElementById('settings-sheet')?.classList.contains('open'),
    locationsOpen: !document.getElementById('settings-locations-body')?.hidden
  }));
  console.log(blockedSleep);
  assert(!blockedSleep.dynamic, 'sleep busy time not added without home city');
  assert(blockedSleep.settingsOpen && blockedSleep.locationsOpen, 'opens Settings → Locations to set city');

  await page.evaluate(() => {
    updateSortSetting({
      homeCityName:'New York, United States',
      homeCityLat:40.7128,
      homeCityLng:-74.0060
    },{renderNow:false,sync:false});
  });
  await page.locator('#settings-close').click();
  await page.locator('#open-about').click();
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  await page.locator('#sample-blocks-head').click();
  await page.waitForSelector('#sample-blocks-body:not([hidden])');
  await page.locator('#sample-blocks-preview [data-add-sample="sample-block-sleep"]').click();
  await page.waitForTimeout(400);
  const afterSleep = await page.evaluate(() => {
    const blocks = normalizeBlockedTimes(loadSortSettings().blockedTimes);
    const sleep = blocks.filter(b => String(b.label || '').toLowerCase() === 'sleep');
    return {
      count: sleep.length,
      block: sleep[0],
      rowState: document.querySelector('#sample-blocks-preview [data-add-sample="sample-block-sleep"]')?.textContent?.trim(),
      rowDisabled: document.querySelector('#sample-blocks-preview [data-add-sample="sample-block-sleep"]')?.disabled === true
    };
  });
  console.log(afterSleep);
  assert(afterSleep.count === 1, 'sleep block replaced, not duplicated');
  assert(
    afterSleep.block && afterSleep.block.startAnchor === 'isha' && afterSleep.block.startOffsetMin === 15
    && afterSleep.block.startCombine === 'later' && afterSleep.block.startAnchor2 === 'sunrise'
    && afterSleep.block.startOffsetMin2 === -480 && afterSleep.block.startDayOffset2 === 1,
    'sleep block start = later of isha +15m · sunrise −8h +1d'
  );
  assert(
    afterSleep.block && afterSleep.block.endAnchor === 'sunrise' && afterSleep.block.endOffsetMin === -40,
    'sleep block end = sunrise −40m'
  );
  assert(afterSleep.rowState === 'added' && afterSleep.rowDisabled, 'sleep sample row shows added');
  const resolvedSleep = await page.evaluate(() => {
    const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)
      .find(b => String(b.label || '').toLowerCase() === 'sleep');
    const base = dayStart(Date.now());
    const start = resolveBlockedTimeMinutes(block, 'start', base);
    const end = resolveBlockedTimeMinutes(block, 'end', base);
    return { start, end };
  });
  assert(resolvedSleep.start != null && resolvedSleep.start >= 1290, 'sleep start resolves to evening (got ' + resolvedSleep.start + ')');
  assert(resolvedSleep.end != null && resolvedSleep.end < 400, 'sleep ends before sunrise (got ' + resolvedSleep.end + ')');
  assert(resolvedSleep.start != null && resolvedSleep.end != null && resolvedSleep.start > resolvedSleep.end, 'sleep is an overnight window (wrap)');

  console.log('\n[F] Prayer add with city set, then add all prayers');
  await page.locator('#sample-habits-close').click();
  await page.waitForTimeout(200);
  await page.locator('#open-about').click();
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  await page.locator('#sample-prayers-head').click();
  await page.waitForSelector('#sample-prayers-body:not([hidden])');
  await page.locator('#sample-prayers-preview [data-add-sample="sample-prayer-fajr"]').click();
  await page.waitForTimeout(300);
  const afterOnePrayer = await page.evaluate(() => {
    const fajr = load().find(h => (h.hid || '') === 'sample-prayer-fajr');
    const fajrBtn = document.querySelector('#sample-prayers-preview [data-add-sample="sample-prayer-fajr"]');
    const s = loadSortSettings();
    return {
      fajrExists: !!fajr,
      fajrIsSample: fajr ? fajr.sample : null,
      sheetOpen: document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      fajrAdded: fajrBtn?.textContent?.trim() === 'added',
      placeCount: (s.locations || []).filter(l => String(l.id || '').startsWith('sample-')).length
    };
  });
  console.log(afterOnePrayer);
  assert(afterOnePrayer.fajrExists && afterOnePrayer.fajrIsSample === false && afterOnePrayer.sheetOpen && afterOnePrayer.fajrAdded, 'single prayer add keeps sheet open, not marked sample');
  assert(afterOnePrayer.placeCount >= 5, 'prayer add does not seed extra sample places');

  await page.locator('#sample-prayers-add').click();
  await page.waitForTimeout(500);
  const afterPrayers = await page.evaluate(() => {
    const data = load();
    const allPrayers = data.filter(h => String(h.hid || '').startsWith('sample-prayer-'));
    const samplePrayers = allPrayers.filter(h => h.sample);
    const features = data.filter(h => h.sample && !String(h.hid || '').startsWith('sample-prayer-'));
    return {
      totalPrayers: allPrayers.length,
      samplePrayerCount: samplePrayers.length,
      featureCount: features.length,
      sampleNames: samplePrayers.map(h => h.name),
      fajrName: allPrayers.find(h => (h.hid || '') === 'sample-prayer-fajr')?.name,
      fajrWindow: allPrayers.find(h => (h.hid || '') === 'sample-prayer-fajr'),
      placeCount: (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-')).length
    };
  });
  console.log(afterPrayers);
  assert(afterPrayers.totalPrayers === 5, 'five prayer habits total after add all');
  assert(afterPrayers.samplePrayerCount === 4, 'four prayers marked sample (Fajr added individually)');
  assert(afterPrayers.featureCount >= 6, 'feature samples still present');
  assert(afterPrayers.fajrWindow && afterPrayers.fajrWindow.allowedTimeStartAnchor === 'fajr', 'Fajr has prayer window');
  assert(afterPrayers.fajrName === 'Fajr', 'individually added Fajr has no Sample: prefix');
  assert(
    afterPrayers.sampleNames.every(n => /^Sample: (Dhuhr|Asr|Maghrib|Isha)$/.test(n)),
    'bulk-added prayer samples use Islamic names with Sample: prefix'
  );
  assert(afterPrayers.placeCount >= 5, 'add-all prayers still seeds no extra places');

  console.log('\n[G] Keep one prayer — survives remove samples; city clear blocked');
  const keepResult = await page.evaluate(() => {
    const idx = load().findIndex(h => h.sample && (h.hid || '') === 'sample-prayer-dhuhr');
    keepSampleHabit(idx);
    const dhuhr = load().find(h => (h.hid || '') === 'sample-prayer-dhuhr');
    removeSortSamples();
    const after = load();
    const beforeCity = {
      name: loadSortSettings().homeCityName,
      lat: loadSortSettings().homeCityLat
    };
    clearHomeCity();
    const afterCity = {
      name: loadSortSettings().homeCityName,
      lat: loadSortSettings().homeCityLat
    };
    return {
      keptName: dhuhr && dhuhr.name,
      keptSample: dhuhr && dhuhr.sample,
      remainingSamples: after.filter(h => h.sample).length,
      dhuhrStillThere: after.some(h => (h.hid || '') === 'sample-prayer-dhuhr' && !h.sample),
      fajrStillThere: after.some(h => (h.hid || '') === 'sample-prayer-fajr' && !h.sample),
      cityBlocked: beforeCity.lat === afterCity.lat && beforeCity.name === afterCity.name && Number.isFinite(afterCity.lat)
    };
  });
  console.log(keepResult);
  assert(keepResult.keptName === 'Dhuhr', 'keep strips Sample: prefix → Dhuhr');
  assert(keepResult.keptSample === false && keepResult.dhuhrStillThere, 'kept Dhuhr survives remove samples');
  assert(keepResult.fajrStillThere, 'individually added Fajr (non-sample) also survives');
  assert(keepResult.remainingSamples === 0, 'unkept samples removed');
  assert(keepResult.cityBlocked, 'clearHomeCity blocked while prayer habits rely on city');

  console.log('\n[H] Blank home still opens sample habits');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);
  await page.locator('#empty').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  assert(true, 'blank home tap opens sample habits');

  if(pageErrors.length){
    console.error('page errors:', pageErrors.join('\n'));
    assert(false, 'no page errors');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail) process.exit(1);
  console.log('SAMPLE HABITS SHEET TEST PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
