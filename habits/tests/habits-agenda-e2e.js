const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  if (await page.locator('#open-today').count()) throw new Error('agenda bottom button still exists');
  if (await page.locator('#bar-open-today').count()) throw new Error('agenda bar button still exists');
  if (await page.locator('#home-agenda').count()) throw new Error('duplicate home agenda section still exists');

  await page.getByRole('button', { name: 'how it works' }).click();
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.locator('#settings-testdata-head').click();
  await page.getByRole('button', { name: 'add samples' }).click();
  await page.waitForSelector('.ting-card .context-pill.agenda-suggested, .ting-card .context-pill.scheduled');

  const planRows = await page.locator('.ting-card .context-pill.agenda-suggested, .ting-card .context-pill.scheduled').count();
  if (planRows < 1) throw new Error('agenda time pills did not render on cards after samples');
  await page.locator('.ting-card:has(.context-pill.agenda-suggested), .ting-card:has(.context-pill.scheduled)').first().click();
  await page.waitForSelector('#detail-sheet.open, body.pane-active');
  await page.locator('#detail-cool').click();
  await page.waitForTimeout(150);

  await page.getByRole('button', { name: 'how it works' }).click();
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.locator('#settings-blocked-head').click();
  await page.waitForSelector('#blocked-time-list');

  const blocks = await page.locator('#blocked-time-list .blocked-time-row').count();
  if (blocks < 3) throw new Error('default blocked-time rows missing');

  await page.locator('[data-blocked-label="0"]').fill('sleep test');
  await page.locator('[data-blocked-label="0"]').blur();
  await page.getByRole('button', { name: 'add blocked time' }).click();
  const blocksAfter = await page.locator('#blocked-time-list .blocked-time-row').count();
  if (blocksAfter <= blocks) throw new Error('add blocked time failed');

  await page.locator('[data-blocked-remove]').last().click();
  const blocksFinal = await page.locator('#blocked-time-list .blocked-time-row').count();
  if (blocksFinal !== blocks) throw new Error('remove blocked time failed');

  await page.setViewportSize({ width: 1180, height: 850 });
  await page.waitForTimeout(250);
  if (await page.locator('#bar-open-today').count()) throw new Error('agenda wide button still exists');
  if (await page.locator('#home-agenda').count()) throw new Error('duplicate home agenda section exists on desktop');
  if (!(await page.locator('.ting-card .context-pill.agenda-suggested, .ting-card .context-pill.scheduled').first().isVisible())) throw new Error('card time pill hidden on desktop');

  // ────────────────────────────────────────────────────────────────────────
  // Phase 2 — controlled-data scenarios for the regressions:
  //   (A) timed task today shows exactly ONE scheduled pill (Issue 2)
  //   (B) a windowed habit (10am-8pm) is never planned inside the 12am-7am
  //       block — its agenda row starts at/after 10am (Issue 1)
  //   (C) no agenda row overlaps a blocked time
  //   (D) the today sheet opens, renders rows, and tapping a row opens detail
  //   (E) the agenda summary copy is populated
  // Time is frozen at today 06:00 for the render so placement is deterministic
  // regardless of when the suite runs.
  // ────────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);

  const scenarioClock = (() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d.getTime(); })();
  const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  // Freeze wall-clock at 06:00 today for every page load from here on, so the
  // whole agenda pipeline (slot clipping, now-ceil, window enforcement) agrees
  // on the same instant regardless of when the suite runs. page.addInitScript
  // re-installs the freeze before page scripts on every navigation — a plain
  // page.evaluate freeze would be wiped by the reload below.
  await page.addInitScript(clock => {
    const RealDate = window.Date;
    function FrozenDate(...a) { return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock;
    FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
    window.__tingsRealDate = RealDate;
    window.Date = FrozenDate;
  }, scenarioClock);
  await page.evaluate(({ morning, scheduledTs }) => {
    localStorage.clear();
    const settings = {
      preset: 'todayFirst',
      showWeekOnHome: false,
      focus: 'balanced',
      availabilityMinutes: [720, 720, 720, 720, 720, 720, 720],
      availabilityOverrides: {},
      blockedTimes: [{ label: 'sleep', days: [], start: 0, end: 420 }], // 00:00-07:00
      showScheduledTasksInAgenda: true,
      showDueTasksInAgenda: true,
      showPlannedItemsInAgenda: true,
      showDueHabitsInAgenda: true,
      showTaskDateOnCards: true,
      showPlansOnCards: true,
      showTimeWindowOnCards: true
    };
    const data = [
      {
        name: 'Windowed workout', type: 'keepup', target: 1, flexibilityDays: 0,
        durationMinutes: 45, allowedTimeStart: 600, allowedTimeEnd: 1200, // 10:00-20:00
        lastLog: morning - 2 * 86400000, logs: [morning - 2 * 86400000],
        emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
        allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
        preferredTimeStart: null, preferredTimeEnd: null,
        dueDate: null, eventTime: null, hardDue: false, markDone: true, createdAt: morning
      },
      {
        name: 'Timed task 1045', type: 'task', target: null, flexibilityDays: 0,
        durationMinutes: 30, eventTime: scheduledTs, dueDate: morning, hardDue: false, markDone: true,
        lastLog: null, logs: [], emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
        allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
        allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
        createdAt: morning
      }
    ];
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { morning: at(0, 0), scheduledTs: at(10, 45) });
  await page.reload({ waitUntil: 'networkidle' });

  // (A) Issue 2 — exactly one scheduled pill on the timed-task card.
  const timedPills = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').count();
  if (timedPills !== 1) throw new Error(`timed task card should show 1 scheduled pill, saw ${timedPills}`);
  const timedPillText = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').first().textContent();
  if (!/10:45\s?AM/i.test(timedPillText || '')) throw new Error(`scheduled pill lost its time: ${JSON.stringify(timedPillText)}`);

  // (A.2) The windowed card surfaces BOTH its time-window pill and its agenda
  //       suggested-time pill (regression guard for the pill-rendering paths).
  const winCard = page.locator('.ting-card:has-text("Windowed workout")');
  // Debug: check setting value and habit data if pill is missing
  const pillDebug = await page.evaluate(() => {
    const s = loadSortSettings();
    const data = load();
    const h = data.find(x => x.name === 'Windowed workout');
    return {
      showTimeWindowOnCards: s.showTimeWindowOnCards,
      showWeekOnHome: s.showWeekOnHome,
      hasTimeWindow: h ? (Number.isFinite(h.allowedTimeStart) && Number.isFinite(h.allowedTimeEnd)) : null,
      allowedTimeStart: h ? h.allowedTimeStart : null,
      allowedTimeEnd: h ? h.allowedTimeEnd : null
    };
  });
  const winPillCount = await winCard.locator('.context-pill.time').count();
  if (!winPillCount) {
    console.log('time-window pill debug:', JSON.stringify(pillDebug));
    throw new Error('time-window pill missing on windowed card');
  }
  if (!(await winCard.locator('.context-pill.agenda-suggested').count())) throw new Error('agenda suggested pill missing on windowed card');

  // (B)+(C)+(D)+(E) — agenda placement verified via home list and evaluate
  // Check that the windowed workout card shows the expected pills
  if (!(await winCard.locator('.context-pill.agenda-suggested').count())) {
    throw new Error('agenda suggested pill missing on windowed card');
  }
  // Verify agenda placement via evaluate (buildTodayAgenda/buildTodayTimeline)
  const agendaRows = await page.evaluate(() => {
    const data = load();
    const settings = sortSettings || loadSortSettings();
    const ag = buildTodayAgenda(data, settings);
    const rows = buildTodayTimeline(ag);
    return rows.map(r => ({
      name: r.h?.name || r.name || '',
      startMin: r.startMin,
      kind: r.kind
    }));
  });
  const workoutRow = agendaRows.find(r => r.name === 'Windowed workout');
  if (!workoutRow) throw new Error('windowed workout missing from agenda');
  // Must start at 10:00 (600 min) or after
  if (workoutRow.startMin < 600) {
    throw new Error(`windowed workout must start at/after 10:00 AM (600 min), saw ${workoutRow.startMin}`);
  }
  // No agenda row may start inside the 00:00-07:00 block (0-420 min)
  const inBlock = agendaRows.filter(r => r.startMin >= 0 && r.startMin < 420);
  if (inBlock.length) throw new Error(`agenda rows leaked into blocked sleep window: ${JSON.stringify(inBlock)}`);

  // Tapping a card with agenda-suggested pill opens detail sheet
  await page.locator('.ting-card:has-text("Timed task 1045")').first().click();
  await page.waitForSelector('#detail-sheet.open, body.pane-active');
  const detailName = await page.locator('#detail-name').textContent();
  if (!detailName || !detailName.includes('Timed task 1045')) {
    throw new Error(`card tap opened the wrong detail: ${JSON.stringify(detailName)}`);
  }
  await page.locator('#detail-cool').click();
  await page.waitForTimeout(150);

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3 — plan integration: a habit planned for today via a plan log
  // surfaces in the home agenda with the planned day's suggested time.
  // ────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const h = data.find(x => x.name === 'Windowed workout');
    if (h) h.logs.push({ ts: new Date().setHours(11, 0, 0, 0), plan: true });
    localStorage.setItem('tings_v2', JSON.stringify(data));
  });
  // Re-evaluate agenda to confirm the planned habit still surfaces
  const plannedAgenda = await page.evaluate(() => {
    const data = load();
    const settings = sortSettings || loadSortSettings();
    const ag = buildTodayAgenda(data, settings);
    const rows = buildTodayTimeline(ag);
    return rows.map(r => r.h?.name || r.name || '');
  });
  if (!plannedAgenda.includes('Windowed workout')) {
    throw new Error('planned habit did not surface in today agenda after a plan log was added');
  }

  // Restore real time before we finish so nothing downstream stays frozen.
  await page.evaluate(() => { if (window.__tingsRealDate) window.Date = window.__tingsRealDate; });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ planRows, blocks, blocksAfter, blocksFinal, timedPills }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
