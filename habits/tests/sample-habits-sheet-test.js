// Sample habits sheet (About → sample habits) smoke test.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/sample-habits-sheet-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
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
    return {
      rows: rows.length,
      titles: rows.map(r => r.title),
      rowAdds: rows.filter(r => r.add === 'add').length,
      prayersCollapsed: prayersBody ? prayersBody.hidden : null,
      addAll: !!document.getElementById('sample-habits-add'),
      addPrayers: !!document.getElementById('sample-prayers-add'),
      aboutClosed: !document.getElementById('about-sheet')?.classList.contains('open')
    };
  });
  console.log(sheet);
  assert(sheet.aboutClosed, 'About closes when opening sample habits');
  assert(sheet.rows >= 8 && sheet.addAll && sheet.rowAdds >= 8, 'feature rows each have add + add all');
  assert(sheet.prayersCollapsed === true, 'daily prayers collapsed by default');
  assert(!sheet.titles.some(t => /^(Fajr|Dhuhr|Asr|Maghrib|Isha)$/i.test(t)), 'five prayers not in feature preview list');

  console.log('\n[C] Add one or two demos — sheet stays open');
  await page.locator('#sample-habits-preview [data-add-sample="sample-feature-water"]').click();
  await page.waitForTimeout(300);
  await page.locator('#sample-habits-preview [data-add-sample="sample-feature-timed-run"]').click();
  await page.waitForTimeout(300);
  const afterFew = await page.evaluate(() => {
    const data = load();
    const samples = data.filter(h => h.sample);
    const waterBtn = document.querySelector('#sample-habits-preview [data-add-sample="sample-feature-water"]');
    return {
      sampleCount: samples.length,
      hids: samples.map(h => h.hid).sort(),
      sheetOpen: document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      waterLabel: waterBtn?.textContent?.trim(),
      waterDisabled: waterBtn?.disabled === true,
      placeCount: (loadSortSettings().locations || []).filter(l => String(l.id || '').startsWith('sample-')).length
    };
  });
  console.log(afterFew);
  assert(afterFew.sheetOpen, 'sheet stays open after single adds');
  assert(afterFew.sampleCount === 2, 'exactly two feature samples added');
  assert(afterFew.hids.includes('sample-feature-water') && afterFew.hids.includes('sample-feature-timed-run'), 'picked demos present');
  assert(afterFew.waterLabel === 'added' && afterFew.waterDisabled, 'added row shows added state');
  assert(afterFew.placeCount >= 1, 'places seeded when a place demo is added');

  console.log('\n[D] Add all demos fills the rest');
  await page.locator('#sample-habits-add').click();
  await page.waitForTimeout(500);
  const afterTour = await page.evaluate(() => {
    const data = load();
    const samples = data.filter(h => h.sample);
    const prayers = samples.filter(h => String(h.hid || '').startsWith('sample-prayer-'));
    return {
      sampleCount: samples.length,
      prayerCount: prayers.length,
      hasSunrise: samples.some(h => h.allowedTimeStartAnchor === 'sunrise'),
      hasBreakable: samples.some(h => h.breakable),
      sheetClosed: !document.getElementById('sample-habits-sheet')?.classList.contains('open')
    };
  });
  console.log(afterTour);
  assert(afterTour.sheetClosed, 'sample sheet closes after add all');
  assert(afterTour.sampleCount >= 8 && afterTour.prayerCount === 0, 'feature samples filled without prayers');
  assert(afterTour.hasSunrise && afterTour.hasBreakable, 'showcase fields present');

  console.log('\n[E] Expand + add one prayer, then all');
  await page.locator('#open-about').click();
  await page.locator('#open-sample-habits').click();
  await page.waitForSelector('#sample-habits-sheet.open');
  await page.locator('#sample-prayers-head').click();
  await page.waitForSelector('#sample-prayers-body:not([hidden])');
  await page.locator('#sample-prayers-preview [data-add-sample="sample-prayer-fajr"]').click();
  await page.waitForTimeout(300);
  const afterOnePrayer = await page.evaluate(() => {
    const prayers = load().filter(h => h.sample && String(h.hid || '').startsWith('sample-prayer-'));
    const fajrBtn = document.querySelector('#sample-prayers-preview [data-add-sample="sample-prayer-fajr"]');
    return {
      prayerCount: prayers.length,
      sheetOpen: document.getElementById('sample-habits-sheet')?.classList.contains('open'),
      fajrAdded: fajrBtn?.textContent?.trim() === 'added'
    };
  });
  console.log(afterOnePrayer);
  assert(afterOnePrayer.prayerCount === 1 && afterOnePrayer.sheetOpen && afterOnePrayer.fajrAdded, 'single prayer add keeps sheet open');

  await page.locator('#sample-prayers-add').click();
  await page.waitForTimeout(500);
  const afterPrayers = await page.evaluate(() => {
    const data = load();
    const prayers = data.filter(h => h.sample && String(h.hid || '').startsWith('sample-prayer-'));
    const features = data.filter(h => h.sample && !String(h.hid || '').startsWith('sample-prayer-'));
    return {
      prayerCount: prayers.length,
      featureCount: features.length,
      names: prayers.map(h => h.name),
      fajrWindow: prayers.find(h => (h.hid || '') === 'sample-prayer-fajr')
    };
  });
  console.log(afterPrayers);
  assert(afterPrayers.prayerCount === 5, 'five prayer samples total after add all');
  assert(afterPrayers.featureCount >= 8, 'feature samples still present');
  assert(afterPrayers.fajrWindow && afterPrayers.fajrWindow.allowedTimeStartAnchor === 'fajr', 'Fajr has prayer window');
  assert(
    afterPrayers.names.every(n => /^Sample: (Fajr|Dhuhr|Asr|Maghrib|Isha)$/.test(n)),
    'prayer samples use Islamic names'
  );

  console.log('\n[F] Keep one prayer — survives remove samples');
  const keepResult = await page.evaluate(() => {
    const idx = load().findIndex(h => h.sample && (h.hid || '') === 'sample-prayer-fajr');
    keepSampleHabit(idx);
    const fajr = load().find(h => (h.hid || '') === 'sample-prayer-fajr');
    removeSortSamples();
    const after = load();
    return {
      keptName: fajr && fajr.name,
      keptSample: fajr && fajr.sample,
      remainingSamples: after.filter(h => h.sample).length,
      fajrStillThere: after.some(h => (h.hid || '') === 'sample-prayer-fajr' && !h.sample)
    };
  });
  console.log(keepResult);
  assert(keepResult.keptName === 'Fajr', 'keep strips Sample: prefix → Fajr');
  assert(keepResult.keptSample === false && keepResult.fajrStillThere, 'kept Fajr survives remove samples');
  assert(keepResult.remainingSamples === 0, 'unkept samples removed');

  console.log('\n[G] Blank home still opens sample habits');
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
