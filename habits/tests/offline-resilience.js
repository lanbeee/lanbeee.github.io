const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // Phase 1 — load the app online, prime caches
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // Seed test data so buttons are visible
  await page.evaluate(() => {
    const data = [{
      name: 'Test habit', type: 'keepup', target: 7,
      logs: [Date.now() - 86400000], emoji: '', pinned: false, sample: false,
      snoozedUntil: null, topics: [], allowedWeekdays: [], allowedMonthDays: [],
      preferredWeekdays: [], preferredMonthDays: [],
      preferredTimeStart: null, preferredTimeEnd: null,
      dueDate: null, eventTime: null, hardDue: false, markDone: true,
      createdAt: Date.now() - 5 * 86400000, lastLog: Date.now() - 86400000,
      flexibilityDays: 0, durationMinutes: 30, priority: 2
    }];
    localStorage.setItem('tings_v2', JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'networkidle' });

  // Phase 2 — go offline, verify the app remains functional
  await page.context().setOffline(true);

  // Reload while offline to verify the SW serves cached content
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Wait a moment for deferred scripts to execute
  await page.waitForTimeout(500);

  // Verify the app bar is still hidden (no agenda/today button leaked)
  const appBarHidden = await page.evaluate(() => {
    const bar = document.getElementById('app-bar');
    return bar ? bar.hasAttribute('hidden') : true;
  });
  if (!appBarHidden) throw new Error('app-bar became visible offline on phone layout');

  // Verify no stale today/agenda buttons exist
  if (await page.locator('#open-today').count()) throw new Error('stale #open-today button appeared');
  if (await page.locator('#bar-open-today').count()) throw new Error('stale #bar-open-today button appeared');

  // Verify bottom nav is present and interactive
  const bottomNavVisible = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return false;
    const style = window.getComputedStyle(nav);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (!bottomNavVisible) throw new Error('bottom nav is hidden offline');

  // Verify the bottom nav has exactly the expected buttons (calendar, plus, search)
  const navButtons = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return [];
    return [...nav.querySelectorAll(':scope > .icon-btn')].map(btn => ({
      id: btn.id,
      label: btn.getAttribute('aria-label')
    }));
  });
  if (navButtons.length !== 3) throw new Error(`expected 3 bottom-nav buttons, got ${navButtons.length}: ${JSON.stringify(navButtons)}`);

  const ids = navButtons.map(b => b.id);
  if (!ids.includes('open-overview')) throw new Error('missing open-overview button');
  if (!ids.includes('open-add')) throw new Error('missing open-add button');
  if (!ids.includes('open-search')) throw new Error('missing open-search button');
  if (ids.includes('open-today')) throw new Error('stale open-today button in bottom-nav');

  // Verify tapping the add button opens the add sheet
  await page.locator('#open-add').click();
  await page.waitForTimeout(200);
  const addSheetOpen = await page.evaluate(() => document.getElementById('add-sheet').classList.contains('open'));
  if (!addSheetOpen) throw new Error('add sheet did not open offline');

  // Close the add sheet
  await page.evaluate(() => document.getElementById('add-sheet').classList.remove('open'));
  await page.waitForTimeout(200);

  // Verify cards are rendered and tappable
  const cardCount = await page.locator('.ting-card').count();
  if (cardCount < 1) throw new Error(`no cards rendered offline, saw ${cardCount}`);

  // Core shell scripts must resolve from cache (not fail open as empty 503s)
  const shellScriptsOk = await page.evaluate(async () => {
    const paths = [
      './js/config.js',
      './js/storage.js',
      './js/data.js',
      './js/list-view.js',
      './js/main.js',
      './styles.css'
    ];
    const results = await Promise.all(paths.map(async (path) => {
      try {
        const res = await fetch(path, { cache: 'reload' });
        return { path, ok: res.ok, status: res.status, type: res.headers.get('content-type') || '' };
      } catch (error) {
        return { path, ok: false, status: 0, error: String(error) };
      }
    }));
    return results;
  });
  const badShell = shellScriptsOk.filter(r => !r.ok);
  if (badShell.length) throw new Error(`offline shell assets failed: ${JSON.stringify(badShell)}`);

  // Phase 3 — go back online, verify the app still works
  await page.context().setOffline(false);
  await page.reload({ waitUntil: 'networkidle' });

  const onlineCards = await page.locator('.ting-card').count();
  if (onlineCards < 1) throw new Error(`no cards rendered after coming back online, saw ${onlineCards}`);

  // Verify the tabler CSS loaded successfully
  const tablerLoaded = await page.evaluate(() => {
    const link = document.querySelector('link[href*="tabler-icons"]');
    return link && link.media === 'all';
  });
  if (!tablerLoaded) throw new Error('tabler icons CSS not loaded after coming back online');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ appBarHidden, bottomNavVisible, navButtons, cardCount, onlineCards, tablerLoaded, shellScriptsOk }));

  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
