'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const URL = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Europe/London' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof openDetail === 'function' && typeof openWeekView === 'function' && typeof openSettingsSheet === 'function');

    await page.evaluate(() => {
      localStorage.clear();
      const now = Date.now();
      const s = loadSortSettings();
      s.topics = ['Health', 'Errands', 'Study'];
      s.locations = [
        { id: 'loc-home', name: 'Home', lat: 37.77, lng: -122.42, radiusM: 150 },
        { id: 'loc-gym', name: 'Gym', lat: 37.78, lng: -122.41, radiusM: 150 },
      ];
      s.defaultTopics = ['Health'];
      s.defaultLocationIds = ['loc-gym'];
      s.defaultAnywhereAllowed = false;
      s.defaultDurationMinutes = 45;
      saveSortSettings(s);
      sortSettings = loadSortSettings();
      save([
        {
          hid: 'habit-alpha',
          name: 'Alpha Stretch',
          type: 'keepup',
          target: 2,
          durationMinutes: 20,
          topics: ['Health'],
          locationIds: ['loc-home'],
          anywhereAllowed: false,
          logs: [now - 86400000],
          lastLog: now - 86400000,
          createdAt: now - 10 * 86400000,
        },
        {
          hid: 'habit-beta',
          name: 'Beta Groceries',
          type: 'keepup',
          target: 7,
          durationMinutes: 35,
          topics: ['Errands'],
          locationIds: ['loc-gym'],
          anywhereAllowed: false,
          logs: [now - 2 * 86400000],
          lastLog: now - 2 * 86400000,
          createdAt: now - 10 * 86400000,
        },
      ]);
      render();
    });
    await page.waitForTimeout(200);

    // 1. Detail: rapid open(A) -> close -> open(B) must not leak A's deferred hydration into B
    const rapidDetail = await page.evaluate(async () => {
      openDetail(0);
      const nameA = document.getElementById('detail-name').textContent;
      closeDetail();
      openDetail(1);
      const nameBImmediate = document.getElementById('detail-name').textContent;
      // Immediately jump to identity tab before warm timers fire
      scrollDetailToNav('identity', 'instant');
      const inputValImmediate = document.getElementById('detail-habit-message').value;
      const selectedTopicsImmediate = selectedTopicsFrom('detail-topic-chips');
      // Wait past warm hydration timers (32ms + 40ms + 220ms entry)
      await new Promise(r => setTimeout(r, 360));
      const nameBAfter = document.getElementById('detail-name').textContent;
      const inputValAfter = document.getElementById('detail-habit-message').value;
      const saveDirty = !document.getElementById('detail-save').disabled;
      // Edit name only and save; verify deferred places/topics/duration stay intact
      document.getElementById('detail-habit-message').value = 'Beta Groceries Updated';
      document.getElementById('detail-habit-message').dispatchEvent(new Event('input', { bubbles: true }));
      const dirtyAfterEdit = !document.getElementById('detail-save').disabled;
      document.getElementById('detail-save').click();
      const savedB = load().find(h => h.hid === 'habit-beta');
      closeDetail();
      return { nameA, nameBImmediate, inputValImmediate, selectedTopicsImmediate, nameBAfter, inputValAfter, saveDirty, dirtyAfterEdit, savedB };
    });
    assert.equal(rapidDetail.nameA, 'Alpha Stretch');
    assert.equal(rapidDetail.nameBImmediate, 'Beta Groceries');
    assert.equal(rapidDetail.inputValImmediate, 'Beta Groceries', 'immediate tab tap synchronously hydrates Detail editor fields');
    assert.deepEqual(rapidDetail.selectedTopicsImmediate, ['Errands'], 'immediate tab tap synchronously hydrates topic chips');
    assert.equal(rapidDetail.nameBAfter, 'Beta Groceries', 'stale warm hydration from item A never overwrites item B');
    assert.equal(rapidDetail.inputValAfter, 'Beta Groceries');
    assert.equal(rapidDetail.saveDirty, false, 'clean reopen is not falsely dirty');
    assert.equal(rapidDetail.dirtyAfterEdit, true, 'editing marks Detail dirty');
    assert.equal(rapidDetail.savedB.name, 'Beta Groceries Updated');
    assert.deepEqual(rapidDetail.savedB.topics, ['Errands'], 'saving preserves topics');
    assert.deepEqual(rapidDetail.savedB.locationIds, ['loc-gym'], 'saving preserves places');
    assert.equal(rapidDetail.savedB.durationMinutes, 35, 'saving preserves duration');

    // 2. Add: submitting without expanding #add-more-options preserves deferred defaults
    const addCheck = await page.evaluate(() => {
      openAddSheetFromChrome();
      const moreHiddenInitially = document.getElementById('add-more-options').hidden;
      document.getElementById('ting-message').value = 'Quick Default Habit';
      document.getElementById('do-save').click();
      const created = load().find(h => h.name === 'Quick Default Habit');
      if (document.getElementById('detail-sheet').classList.contains('open')) closeDetail();
      // Reopen Add, expand more options, cancel, and reopen to verify clean reset
      openAddSheetFromChrome();
      document.getElementById('add-more-toggle').click();
      const moreExpanded = !document.getElementById('add-more-options').hidden;
      const hydratedChips = document.querySelectorAll('#ting-tag-chips button').length;
      closeSheet('add-sheet');
      openAddSheetFromChrome();
      const moreResetCollapsed = document.getElementById('add-more-options').hidden;
      closeSheet('add-sheet');
      return { moreHiddenInitially, created, moreExpanded, hydratedChips, moreResetCollapsed };
    });
    assert.equal(addCheck.moreHiddenInitially, true, 'Add opens with more options collapsed');
    assert.ok(addCheck.created, 'Add submits cleanly without expanding more options');
    assert.deepEqual(addCheck.created.topics, ['Health'], 'deferred default topics persist when submitted unopened');
    assert.deepEqual(addCheck.created.locationIds, ['loc-gym'], 'deferred default places persist when submitted unopened');
    assert.equal(addCheck.created.anywhereAllowed, false, 'deferred anywhereAllowed persists when submitted unopened');
    assert.equal(addCheck.created.durationMinutes, 45, 'default duration persists');
    assert.equal(addCheck.moreExpanded, true, 'expanding more options shows container');
    assert.ok(addCheck.hydratedChips >= 3, `expanding more options hydrates tag chips (got ${addCheck.hydratedChips})`);
    assert.equal(addCheck.moreResetCollapsed, true, 'reopening Add resets more options to collapsed');

    // 3. Settings: clean cache hit, lazy section hydration on expand, and invalidation on settings change
    const settingsCheck = await page.evaluate(() => {
      openSettingsSheet();
      closeSettingsSheet();
      // Second clean open hits cached sync
      openSettingsSheet();
      const topicsHead = document.querySelector('[data-collapse-target="settings-topics-body"]');
      topicsHead.click();
      const topicsOpen = !document.getElementById('settings-topics-body').hidden;
      const topicChips = document.querySelectorAll('#topic-list .topic-item, #topic-list .tag-chip, #topic-list button').length;
      closeSettingsSheet();
      // Mutate sortSettings directly and reopen: verify dirty-key invalidation updates visible UI
      const s = loadSortSettings();
      s.soundEffects = !s.soundEffects;
      saveSortSettings(s);
      openSettingsSheet();
      const soundPressed = document.querySelector('[data-setting-toggle="soundEffects"]')?.getAttribute('aria-pressed');
      closeSettingsSheet();
      s.minimalMode = true;
      saveSortSettings(s);
      sortSettings = loadSortSettings();
      openSettingsSheet();
      const minimalPressed = document.querySelector('[data-setting-toggle="minimalMode"]')?.getAttribute('aria-pressed');
      const topicsResetClosed = document.getElementById('settings-topics-body').hidden;
      closeSettingsSheet();
      // Restore minimalMode = false
      const s2 = loadSortSettings();
      s2.minimalMode = false;
      saveSortSettings(s2);
      // openAddSettings('defaults') hydrates defaults section immediately
      openAddSheetFromChrome();
      openAddSettings('defaults');
      const defaultsOpen = !document.getElementById('settings-defaults-body').hidden;
      const defaultDayChips = document.querySelectorAll('#default-weekdays .schedule-chip').length;
      closeSettingsSheet();
      closeSheet('add-sheet');
      return { topicsOpen, topicChips, soundPressed, soundExpected: String(s.soundEffects), minimalPressed, topicsResetClosed, defaultsOpen, defaultDayChips };
    });
    assert.equal(settingsCheck.topicsOpen, true, 'clicking collapsible Settings head opens section');
    assert.ok(settingsCheck.topicChips >= 3, `expanding Topics section hydrates items (got ${settingsCheck.topicChips})`);
    assert.equal(settingsCheck.soundPressed, settingsCheck.soundExpected, 'Settings refreshes a cached control when its saved value changes');
    assert.equal(settingsCheck.minimalPressed, 'true', 'Settings dirty-key invalidates when sortSettings changes');
    assert.equal(settingsCheck.topicsResetClosed, true, 'reopening Settings after interaction resets collapsed sections');
    assert.equal(settingsCheck.defaultsOpen, true, 'openAddSettings expands target section');
    assert.equal(settingsCheck.defaultDayChips, 7, 'openAddSettings hydrates weekday chips immediately');

    // 4. Week <-> Calendar Month rapid switching, off-screen column hydration, and cached event tap
    const calWeekCheck = await page.evaluate(async () => {
      openWeekView();
      const colCountImmediate = document.querySelectorAll('#week-view-body .wv-col').length;
      const deferredBefore = document.querySelectorAll('#week-view-body .wv-col[data-wv-deferred="1"]').length;
      // Trigger immediate nudge before entry finishes -> must hydrate synchronously
      weekViewNudge(1);
      const deferredAfterNudge = document.querySelectorAll('#week-view-body .wv-col[data-wv-deferred="1"]').length;
      // Switch rapidly Week -> Month -> Week -> Home
      openCalendarOverview({ range: 'month' });
      const monthCells = document.querySelectorAll('#overview-calendar .cal-day:not(.blank)').length;
      openWeekView();
      await new Promise(r => setTimeout(r, 320));
      const deferredAfterEntry = document.querySelectorAll('#week-view-body .wv-col[data-wv-deferred="1"]').length;
      const firstEv = document.querySelector('#week-view-body [data-wv-event]');
      let tappedDetailOpened = false;
      if (firstEv) {
        firstEv.click();
        tappedDetailOpened = document.getElementById('detail-sheet').classList.contains('open');
        if (tappedDetailOpened) closeDetail();
      }
      closeSheet('week-sheet');
      await new Promise(r => setTimeout(r, 60));
      const weekBodyAfterClose = document.getElementById('week-view-body').childElementCount;
      return { colCountImmediate, deferredBefore, deferredAfterNudge, monthCells, deferredAfterEntry, hasEvent: Boolean(firstEv), tappedDetailOpened, weekBodyAfterClose };
    });
    assert.ok(calWeekCheck.colCountImmediate >= 14, `Week renders full 14-day shell immediately (got ${calWeekCheck.colCountImmediate})`);
    assert.ok(calWeekCheck.deferredBefore > 0, `Week defers off-screen columns on phone Frame 0 (got ${calWeekCheck.deferredBefore})`);
    assert.equal(calWeekCheck.deferredAfterNudge, 0, 'immediate horizontal navigation hydrates off-screen columns synchronously');
    assert.ok(calWeekCheck.monthCells >= 28, `Month overview renders calendar cells (got ${calWeekCheck.monthCells})`);
    assert.equal(calWeekCheck.deferredAfterEntry, 0, 'off-screen columns hydrate automatically after entry');
    if (calWeekCheck.hasEvent) {
      assert.equal(calWeekCheck.tappedDetailOpened, true, 'tapping an event on a cached Week board opens Detail');
    }
    assert.equal(calWeekCheck.weekBodyAfterClose, 0, 'closing Week clears board DOM');

    const monthBoundary = await page.evaluate(() => {
      save([
        { hid: 'last-in-march', name: 'Last March log', type: 'keepup', logs: [new Date(2024, 2, 31, 23, 30).getTime()] },
        { hid: 'first-in-april', name: 'First April log', type: 'keepup', logs: [new Date(2024, 3, 1, 0, 30).getTime()] },
      ]);
      openCalendarOverview({ range: 'month', dayKey: '2024-03-31' });
      return {
        marchLog: document.querySelector('#overview-calendar [data-log-day="2024-03-31"]').classList.contains('has-entry'),
        aprilLog: document.getElementById('overview-list').textContent.includes('First April log'),
      };
    });
    assert.deepEqual(monthBoundary, { marchLog: true, aprilLog: false }, 'Month ends at the next local midnight across a daylight-saving change');

    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    console.log('PASS sheet opening regression: Detail rapid switch/hydration, Add deferred defaults, Settings lazy/cache, Week off-screen hydration & Month switch');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
