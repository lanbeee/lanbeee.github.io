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

  console.log('\n[A] About hub + destinations');
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  const aboutBtns = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('#about-sheet .about-hub-label')].map(el => (el.textContent || '').trim());
    const blocks = document.querySelectorAll('#about-sheet .about-block').length;
    const helpBtns = [...document.querySelectorAll('#about-sheet .about-hub-group:first-of-type .btn')].map(el => (el.textContent || '').replace(/\s+/g,' ').trim());
    const deviceBtns = [...document.querySelectorAll('#about-sheet .about-hub-group:last-of-type .btn')].map(el => (el.textContent || '').replace(/\s+/g,' ').trim());
    return {
      sample: !!document.getElementById('open-sample-habits'),
      settings: !!document.getElementById('open-settings'),
      privacy: !!document.getElementById('open-privacy'),
      feedback: !!document.getElementById('open-feedback'),
      docs: !!document.getElementById('open-docs'),
      guided: !!document.getElementById('start-essentials-coach'),
      advanced: !!document.getElementById('start-advanced-coach'),
      install: !!document.getElementById('open-install-guide'),
      done: !!document.getElementById('about-close'),
      blocks,
      labels,
      helpBtns,
      deviceBtns,
      copy: document.querySelector('#about-sheet .about-hero .about-copy')?.textContent || ''
    };
  });
  console.log(aboutBtns);
  assert(aboutBtns.sample && aboutBtns.settings && aboutBtns.privacy && aboutBtns.feedback && aboutBtns.done, 'About shows samples, settings, privacy, feedback, done');
  assert(aboutBtns.guided && aboutBtns.advanced && aboutBtns.docs && aboutBtns.install, 'About shows tours, docs, and install');
  assert(aboutBtns.blocks === 0, 'About has no explainer cards; help/docs and privacy cover that');
  assert(aboutBtns.labels.join('|') === 'help|this device', 'About groups destinations as help and this device');
  assert(aboutBtns.helpBtns.join('|') === 'guided start|advanced coach|help & docs', 'Help group is tours plus written docs');
  assert(aboutBtns.deviceBtns.join('|') === 'install app|samples|settings', 'This-device group is install, samples, settings');
  assert(/private by default/i.test(aboutBtns.copy) && aboutBtns.copy.length < 120, 'Hero stays a short product line');

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
  const header = await page.evaluate(() => {
    const title = document.querySelector('.sample-habits-head .sheet-title').getBoundingClientRect();
    const close = document.getElementById('sample-habits-close').getBoundingClientRect();
    return {sameRow:Math.abs((title.top + title.height / 2) - (close.top + close.height / 2)) < 2,
      orphaned:!!document.querySelector('#sample-habits-sheet .sheet-exit'),
      addWidth:document.querySelector('.sample-habit-add').getBoundingClientRect().width};
  });
  assert(header.sameRow && !header.orphaned, 'close control shares the title row, with no orphaned top bar');
  assert(header.addWidth < 80, 'add pills leave room for the sample description');
  await page.setViewportSize({width:320,height:568});
  await page.evaluate(() => document.querySelector('.sample-habits-sheet').scrollTop = 400);
  const compactHeader = await page.evaluate(() => {
    const button = document.getElementById('sample-habits-close');
    const r = button.getBoundingClientRect();
    return {visible:r.top >= 0 && r.right <= innerWidth && r.bottom < innerHeight,
      clickable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button') === button,
      overflow:document.querySelector('.sample-habits-sheet').scrollWidth > document.querySelector('.sample-habits-sheet').clientWidth};
  });
  assert(compactHeader.visible && compactHeader.clickable && !compactHeader.overflow, 'sticky close stays reachable after scrolling on a small phone');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => document.querySelector('.sample-habits-sheet').scrollTop = 0);

  assert(sheet.rows === 5 && sheet.addAll && sheet.rowAdds === 5, 'five everyday starters each have add + try all');
  assert(!sheet.titles.some(t => /Tuesday|coffee|water|\(auto\)/i.test(t)), 'catalog removes abstract feature demos and generic filler');
  assert(sheet.noSleepHabit, 'sleep is a busy time sample, not a habit row');
  assert(sheet.blocksCollapsed === true && sheet.hasBlockSleep && sheet.blockAddBtn === 'add', 'busy-time section has sleep sample to add');
  assert(sheet.removeSamples && sheet.removeDisabled, 'remove samples on sheet, disabled when none');
  assert(sheet.testdataGone, 'settings test data section removed');
  assert(sheet.prayersCollapsed === true, 'daily prayers collapsed by default');
  assert(!sheet.titles.some(t => /^(Fajr|Dhuhr|Asr|Maghrib|Isha)$/i.test(t)), 'five prayers not in feature preview list');

  console.log('\n[B2] Expanded busy-time and prayer rows');
  await page.locator('#sample-blocks-head').click();
  await page.locator('#sample-prayers-head').click();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:844});
    const layout = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sample-blocks-preview .sample-habit-row,#sample-prayers-preview .sample-habit-row')];
      return rows.map(row => {
        const button = row.querySelector('.sample-habit-add').getBoundingClientRect();
        const copy = row.querySelector('.sample-habit-copy').getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        return {readable:copy.width >= 70,compact:button.width < 80,touchable:button.height >= 44,
          contained:copy.right <= button.left && button.right <= bounds.right && row.scrollWidth <= row.clientWidth};
      });
    });
    assert(layout.length === 6 && layout.every(r => r.readable && r.compact && r.touchable && r.contained),
      `expanded sleep and all five prayers keep text and compact Add pills inside their rows at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#sample-blocks-head').click();
  await page.locator('#sample-prayers-head').click();
  await page.evaluate(() => document.querySelector('.sample-habits-sheet').scrollTop = 0);

  console.log('\n[C] Add one or two demos — sheet stays open + undo toast');
  await page.locator('#sample-habits-preview [data-add-sample="sample-starter-walk"]').click();
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
    walk: load().some(h => (h.hid || '') === 'sample-starter-walk'),
    walkBtn: document.querySelector('#sample-habits-preview [data-add-sample="sample-starter-walk"]')?.textContent?.trim()
  }));
  assert(!afterUndo.walk && afterUndo.walkBtn === 'add', 'undo removes the single add');

  await page.locator('#sample-habits-preview [data-add-sample="sample-starter-walk"]').click();
  await page.waitForTimeout(300);
  await page.locator('#sample-habits-preview [data-add-sample="sample-starter-workout"]').click();
  await page.waitForTimeout(300);
  const afterFew = await page.evaluate(() => {
    const data = load();
    const byHid = hids => data.filter(h => hids.includes(h.hid));
    const added = byHid(['sample-starter-walk','sample-starter-workout']);
    const walkBtn = document.querySelector('#sample-habits-preview [data-add-sample="sample-starter-walk"]');
    const samplePlaces = (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-'));
    return {
      addedCount: added.length,
      addedAreSample: added.every(h => h.sample === false),
      addedNames: added.map(h => h.name),
      sheetOpen: document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      walkLabel: walkBtn?.textContent?.trim(),
      walkDisabled: walkBtn?.disabled === true,
      placeCount: samplePlaces.length,
      placeIds: samplePlaces.map(l => l.id)
    };
  });
  console.log(afterFew);
  assert(afterFew.sheetOpen, 'sheet stays open after single adds');
  assert(afterFew.addedCount === 2, 'exactly two feature demos added');
  assert(afterFew.addedAreSample, 'individually added demos are not marked as sample');
  assert(afterFew.addedNames.every(n => !n.startsWith('Sample: ')), 'individually added demos have no Sample: prefix');
  assert(afterFew.walkLabel === 'added' && afterFew.walkDisabled, 'added row shows added state');
  assert(afterFew.placeCount === 0, 'starters do not seed invented places');

  console.log('\n[D] Try all starters works without a city');
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
      noDynamicTimes: data.every(h => !sampleUsesDynamicTimes(h)),
      noFakeHistory: data.every(h => !h.logs.length),
      tasks: data.filter(h => h.type === 'task').map(h => ({due:h.dueDate,future:h.dueDate > dayStart(Date.now())})),
      habits: data.filter(h => h.type === 'keepup').length,
      hasBreakable: samples.some(h => h.breakable),
      noSleepHabit: !samples.some(h => (h.hid || '') === 'sample-feature-sleep'),
      sheetClosed: !document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      placeCount: samplePlaces.length
    };
  });
  console.log(afterTour);
  assert(afterTour.sheetClosed, 'sample sheet closes after add all');
  assert(afterTour.sampleCount === 3 && afterTour.prayerCount === 0 && afterTour.habits === 3 && afterTour.tasks.length === 2, 'bulk add fills remaining starters: three habits and two one-off tasks total');
  assert(afterTour.noDynamicTimes && afterTour.hasBreakable && afterTour.noFakeHistory && afterTour.tasks.every(h => h.future), 'starters need no city or fictional history; report can split and tasks have future due dates');
  assert(afterTour.noSleepHabit, 'add-all does not create a sleep habit');
  assert(afterTour.placeCount === 0, 'bulk starters leave the place registry empty');

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
  assert(afterOnePrayer.placeCount === 0, 'prayer add does not seed sample places');

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
      prayerNames: allPrayers.map(h => h.name),
      fajrName: allPrayers.find(h => (h.hid || '') === 'sample-prayer-fajr')?.name,
      fajrWindow: allPrayers.find(h => (h.hid || '') === 'sample-prayer-fajr'),
      placeCount: (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-')).length
    };
  });
  console.log(afterPrayers);
  assert(afterPrayers.totalPrayers === 5, 'five prayer habits total after add all');
  assert(afterPrayers.samplePrayerCount === 0, 'bulk prayers are regular habits, like individually added Fajr');
  assert(afterPrayers.featureCount === 3, 'bulk starter samples still present');
  assert(afterPrayers.fajrWindow && afterPrayers.fajrWindow.allowedTimeStartAnchor === 'fajr', 'Fajr has prayer window');
  assert(afterPrayers.fajrName === 'Fajr', 'individually added Fajr has no Sample: prefix');
  assert(
    afterPrayers.prayerNames.every(n => /^(Fajr|Dhuhr|Asr|Maghrib|Isha)$/.test(n)),
    'bulk-added prayers use clean names without Sample: prefix'
  );
  assert(afterPrayers.placeCount === 0, 'add-all prayers still seeds no places');

  console.log('\n[G] Keep one starter — it and all prayers survive remove samples; city clear blocked');
  const keepResult = await page.evaluate(() => {
    const idx = load().findIndex(h => h.sample && (h.hid || '') === 'sample-starter-read');
    keepSampleHabit(idx);
    const kept = load().find(h => (h.hid || '') === 'sample-starter-read');
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
      keptName: kept && kept.name,
      keptSample: kept && kept.sample,
      keptStillThere: after.some(h => h.hid === 'sample-starter-read' && !h.sample),
      prayersRemaining: after.filter(h => String(h.hid || '').startsWith('sample-prayer-') && !h.sample).length,
      remainingSamples: after.filter(h => h.sample).length,
      dhuhrStillThere: after.some(h => (h.hid || '') === 'sample-prayer-dhuhr' && !h.sample),
      fajrStillThere: after.some(h => (h.hid || '') === 'sample-prayer-fajr' && !h.sample),
      cityBlocked: beforeCity.lat === afterCity.lat && beforeCity.name === afterCity.name && Number.isFinite(afterCity.lat)
    };
  });
  console.log(keepResult);
  assert(keepResult.keptName === 'read before bed', 'keep strips the starter Sample: prefix');
  assert(keepResult.keptSample === false && keepResult.keptStillThere, 'kept starter survives remove samples');
  assert(keepResult.prayersRemaining === 5 && keepResult.dhuhrStillThere, 'all bulk-added prayers survive remove samples');
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
