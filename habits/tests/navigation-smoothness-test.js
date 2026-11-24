// Holistic navigation smoothness regression test:
// Verifies storage caching safety, closed-sheet content-visibility containment,
// batched Detail opens, lazy Settings managers, deferred Calendar filter sheet,
// in-place day selection, and Week View column sizing + cleanup.
const assert = require('node:assert/strict');
const { chromium, BASE, baseHabit } = require('./helpers/planner-test-helpers');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 412, height: 892 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block'
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const now = Date.now();
    const items = Array.from({ length: 40 }, (_, i) => baseHabit({
      hid: `nav-${i}`,
      name: `Habit ${i + 1}`,
      type: i % 4 === 0 ? 'task' : 'keepup',
      target: i % 4 === 0 ? null : (i % 7) + 1,
      dueDate: i % 4 === 0 ? now + ((i % 6) + 1) * 86400000 : null,
      topics: i % 2 === 0 ? ['Health'] : ['Work'],
      locationIds: ['loc-home'],
      logs: [{ ts: now - 86400000 }]
    }));
    const settings = {
      localAssistant: true,
      localAssistantProvider: 'needle',
      minimalMode: false,
      agendaOptimizer: false,
      locations: [{ id: 'loc-home', name: 'Home', lat: 40.71, lng: -74.0 }],
      topics: ['Health', 'Work'],
      blockedTimes: [{ id: 'bt-1', label: 'Sleep', start: 1380, end: 420, days: [0, 1, 2, 3, 4, 5, 6] }],
      weatherProfiles: [{ id: 'wp-1', name: 'Dry', rules: { precipitation: 'dry' } }]
    };

    await page.addInitScript(({ items, settings }) => {
      localStorage.setItem('tings_v2', JSON.stringify(items));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
      for (const k of ['tings_coach_install_v2', 'tings_coach_essentials_v2']) localStorage.setItem(k, 'done');
    }, { items, settings });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('#launch-screen').waitFor({ state: 'hidden', timeout: 15000 });

    // 1. Storage cache returns independent clones and invalidates on external localStorage writes
    const cacheCheck = await page.evaluate(() => {
      const a = load();
      a[0].name = 'MUTATED_LOCAL';
      a[0].logs.push({ ts: 123456 });
      const b = load();
      const s1 = loadSortSettings();
      s1.topics.push('MUTATED_TOPIC');
      const s2 = loadSortSettings();
      // External localStorage write must invalidate cache immediately
      const raw = JSON.parse(localStorage.getItem('tings_v2'));
      raw[0].name = 'EXTERNAL_UPDATE';
      localStorage.setItem('tings_v2', JSON.stringify(raw));
      const c = load();
      // Restore original name
      raw[0].name = 'Habit 1';
      localStorage.setItem('tings_v2', JSON.stringify(raw));
      return {
        bName: b[0].name,
        bLogsLen: b[0].logs.length,
        s2Topics: s2.topics,
        cName: c[0].name
      };
    });
    assert.equal(cacheCheck.bName, 'Habit 1', 'load() cache returns independent clones (scalar)');
    assert.equal(cacheCheck.bLogsLen, 1, 'load() cache returns independent clones (nested array)');
    assert.deepEqual(cacheCheck.s2Topics, ['Health', 'Work'], 'loadSortSettings() cache returns independent clones');
    assert.equal(cacheCheck.cName, 'EXTERNAL_UPDATE', 'external localStorage.setItem invalidates load() cache');

    const legacyCacheCheck = await page.evaluate(() => {
      const realNow = Date.now;
      const raw = localStorage.getItem(KEY);
      const eventTime = realNow() + 60_000;
      try {
        localStorage.setItem(KEY, JSON.stringify([
          { hid:'legacy-event', name:'Old event', type:'event', eventTime },
          { hid:'legacy-log', name:'Old log', type:'keepup', target:1, logs:[eventTime] }
        ]));
        Date.now = () => eventTime - 1;
        const before = load().map(h=>h.logs.filter(log=>!isPlanLog(log)).length);
        Date.now = () => eventTime + 1;
        const after = load().map(h=>h.logs.filter(log=>!isPlanLog(log)).length);
        return { before, after };
      } finally {
        Date.now = realNow;
        localStorage.setItem(KEY, raw);
      }
    });
    assert.deepEqual(legacyCacheCheck, {before:[0,0],after:[1,1]},
      'legacy events and timestamp logs age out of the cache without a write');

    const filterCacheCheck = await page.evaluate(() => {
      const raw = localStorage.getItem(KEY);
      const renderFilters = () => {
        renderHomeTagFilter(load());
        renderOverviewFilters(load(),load(),{includeSheet:true});
        return ['home','calendar'].map(prefix=>document.getElementById(`${prefix}-filter-groups`).textContent);
      };
      try {
        const before = renderFilters();
        const changed = raw.replace('"Health"', '"Sports"');
        if(changed === raw || changed.length !== raw.length)throw new Error('Expected a same-length storage change');
        localStorage.setItem(KEY, changed);
        const after = renderFilters();
        return {before:before.map(text=>text.includes('Sports')),after:after.map(text=>text.includes('Sports'))};
      } finally {
        localStorage.setItem(KEY, raw);
        renderFilters();
      }
    });
    assert.deepEqual(filterCacheCheck,{before:[false,false],after:[true,true]},
      'Home and Calendar filter options update for equal-length storage edits');

    // 2. Closed sheets apply layout/style/paint containment without permanent GPU layer promotion; open Detail batches pager sync
    const detailCheck = await page.evaluate(() => {
      const wrap = document.getElementById('detail-sheet');
      const closedContain = getComputedStyle(wrap).contain;
      const closedWillChange = getComputedStyle(wrap.querySelector('.sheet')).willChange;
      const origSync = window.syncWeatherDetailPage;
      let dotSyncs = 0;
      window.syncWeatherDetailPage = function(...args) { dotSyncs++; return origSync.apply(this, args); };
      try {
        openDetail(0);
      } finally {
        window.syncWeatherDetailPage = origSync;
      }
      const openContain = getComputedStyle(wrap).contain;
      closeSheet('detail-sheet');
      const afterCloseContain = getComputedStyle(wrap).contain;
      return { closedContain, closedWillChange, openContain, afterCloseContain, dotSyncs };
    });
    assert.match(detailCheck.closedContain, /paint|content/, 'closed sheet isolates paint via contain');
    assert.equal(detailCheck.closedWillChange, 'auto', 'closed sheet does not permanently hold a GPU will-change layer');
    assert.match(detailCheck.openContain, /layout|content/, 'open sheet keeps layout/style containment');
    assert.match(detailCheck.afterCloseContain, /paint|content/, 'closing sheet restores paint containment');
    assert.ok(detailCheck.dotSyncs <= 2, `openDetail batches updateDetailPagerDots work (got ${detailCheck.dotSyncs})`);

    // 3. Settings defers closed manager DOM, populates on manager open, and skips detail dirty when Detail closed
    const settingsCheck = await page.evaluate(() => {
      document.getElementById('location-list').innerHTML = '';
      document.getElementById('blocked-time-list').innerHTML = '';
      document.getElementById('weather-profile-list').innerHTML = '';
      const origDirty = window.setDetailDirty;
      let dirtyCalls = 0;
      window.setDetailDirty = function(...args) { dirtyCalls++; return origDirty.apply(this, args); };
      try {
        openSettingsSheet();
        const locSummary = document.getElementById('location-list-summary').textContent;
        const busySummary = document.getElementById('busy-times-summary').textContent;
        const locListWhileClosed = document.getElementById('location-list').childElementCount;
        const busyListWhileClosed = document.getElementById('blocked-time-list').childElementCount;
        openBusyManager();
        const busyListWhenOpen = document.getElementById('blocked-time-list').childElementCount;
        closeBusyManager();
        closeSettingsSheet();
        return { locSummary, busySummary, locListWhileClosed, busyListWhileClosed, busyListWhenOpen, dirtyCalls };
      } finally {
        window.setDetailDirty = origDirty;
      }
    });
    assert.match(settingsCheck.locSummary, /1 saved place/, 'Settings summary updates without building closed manager list');
    assert.match(settingsCheck.busySummary, /1 busy time/, 'Busy summary updates without building closed manager list');
    assert.equal(settingsCheck.locListWhileClosed, 0, 'closed Locations Manager DOM is skipped on Settings open');
    assert.equal(settingsCheck.busyListWhileClosed, 0, 'closed Busy Manager DOM is skipped on Settings open');
    assert.ok(settingsCheck.busyListWhenOpen >= 1, 'opening Busy Manager builds its list');
    assert.equal(settingsCheck.dirtyCalls, 0, 'closing Settings skips setDetailDirty when Detail is closed');

    // 4. Calendar Overview defers filter sheet until opened, and day tap updates selection in-place
    const calCheck = await page.evaluate(() => {
      openCalendarOverview({ range: 'recent' });
      const origRenderOverview = window.renderOverview;
      let overviewRerenders = 0;
      window.renderOverview = function(...args) { overviewRerenders++; return origRenderOverview.apply(this, args); };
      try {
        const dayBtn = document.querySelector('#overview-calendar [data-log-day]');
        const dayKey = dayBtn.dataset.logDay;
        openDayLogsAfterCalendarGesture(dayKey, { refreshOverview: true });
        const selectedMatch = document.querySelector('#overview-calendar .cal-day.selected')?.dataset.logDay;
        closeDayLogsSheet({ refreshOverview: true });
        return { dayKey, selectedMatch, overviewRerenders };
      } finally {
        window.renderOverview = origRenderOverview;
      }
    });
    assert.equal(calCheck.selectedMatch, calCheck.dayKey, 'tapping a day highlights the selected cell');
    assert.equal(calCheck.overviewRerenders, 0, 'opening/closing Day Logs without edits does not re-render full Overview');

    // Verify Calendar filter sheet builds cleanly on demand
    await page.locator('#overview-filter [data-open-overview-filters]').click();
    await page.waitForSelector('#calendar-filter-sheet.open');
    const calFilterCount = await page.locator('#calendar-filter-groups .home-filter-option').count();
    assert.ok(calFilterCount >= 4, `Calendar filter sheet populates on demand (got ${calFilterCount})`);
    await page.evaluate(() => { closeSheet('calendar-filter-sheet'); closeSheet('overview-sheet'); });

    // 5. Week View sizes board properly despite content-visibility:hidden when closed, and cleans up DOM on close
    const weekCheck = await page.evaluate(() => {
      openWeekView();
      const board = document.querySelector('#week-view-body .wv-board');
      const boardWidth = parseFloat(board?.style.width || '0');
      const colCount = document.querySelectorAll('#week-view-body .wv-col').length;
      return { boardWidth, colCount };
    });
    assert.ok(weekCheck.boardWidth > 300, `Week View sizes board width on open (${weekCheck.boardWidth}px)`);
    assert.ok(weekCheck.colCount >= 7, `Week View renders day columns (${weekCheck.colCount})`);
    await page.evaluate(() => closeSheet('week-sheet'));
    await page.waitForTimeout(50);
    const weekAfterClose = await page.evaluate(() => document.getElementById('week-view-body').childElementCount);
    assert.equal(weekAfterClose, 0, 'closing Week View clears transient board DOM');

    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    console.log('navigation smoothness: cache safety, containment, batched detail, lazy managers, calendar & week ok');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
