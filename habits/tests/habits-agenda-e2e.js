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
  await page.evaluate(({ clock, morning, scheduledTs }) => {
    localStorage.clear();
    const settings = {
      preset: 'todayFirst',
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
        dueDate: null, eventTime: null, hardDue: false, markDone: true, createdAt: clock
      },
      {
        name: 'Timed task 1045', type: 'task', target: null, flexibilityDays: 0,
        durationMinutes: 30, eventTime: scheduledTs, dueDate: morning, hardDue: false, markDone: true,
        lastLog: null, logs: [], emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
        allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
        allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
        createdAt: clock
      }
    ];
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    // Freeze wall-clock at 06:00 today for everything the agenda pipeline does.
    const RealDate = Date;
    const frozen = clock;
    function FrozenDate(...a) { return a.length ? new RealDate(...a) : new RealDate(frozen); }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
    window.__tingsRealDate = RealDate;
    window.Date = FrozenDate;
  }, { clock: scenarioClock, morning: at(0, 0), scheduledTs: at(10, 45) });
  await page.reload({ waitUntil: 'networkidle' });

  // (A) Issue 2 — exactly one scheduled pill on the timed-task card.
  const timedPills = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').count();
  if (timedPills !== 1) throw new Error(`timed task card should show 1 scheduled pill, saw ${timedPills}`);
  const timedPillText = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').first().textContent();
  if (!/10:45\s?AM/i.test(timedPillText || '')) throw new Error(`scheduled pill lost its time: ${JSON.stringify(timedPillText)}`);

  // (A.2) The windowed card surfaces BOTH its time-window pill and its agenda
  //       suggested-time pill (regression guard for the pill-rendering paths).
  const winCard = page.locator('.ting-card:has-text("Windowed workout")');
  if (!(await winCard.locator('.context-pill.time').count())) throw new Error('time-window pill missing on windowed card');
  if (!(await winCard.locator('.context-pill.agenda-suggested').count())) throw new Error('agenda suggested pill missing on windowed card');

  // (D)+(E) Open the today sheet via the same code path the notification uses,
  //         and confirm it renders rows + a non-empty summary.
  await page.evaluate(() => { if (typeof openToday === 'function') openToday(); });
  await page.waitForSelector('#today-sheet.open');
  await page.waitForSelector('#today-content .agenda-row');
  const rowCount = await page.locator('#today-content .agenda-row').count();
  if (rowCount < 2) throw new Error(`today sheet should render at least 2 rows, saw ${rowCount}`);
  const summary = await page.locator('#today-summary').textContent();
  if (!summary || !summary.trim()) throw new Error('today summary copy is empty');

  // (B) Issue 1 — read the rendered agenda rows and confirm the windowed workout
  //     starts at/after 10am (never inside the 12am-7am block).
  const rows = await page.locator('#today-content .agenda-row').evaluateAll(els =>
    els.map(el => ({
      name: el.querySelector('.agenda-name')?.textContent?.trim() || '',
      start: el.querySelector('.agenda-clock b')?.textContent?.trim() || '',
      tag: el.querySelector('.agenda-tag')?.textContent?.trim() || ''
    }))
  );
  const workout = rows.find(r => r.name === 'Windowed workout');
  if (!workout) throw new Error('windowed workout missing from today agenda');
  if (!/^10:/.test(workout.start) || !/AM$/i.test(workout.start)) {
    throw new Error(`windowed workout must start at 10:00 AM, saw ${workout.start}`);
  }
  const timedRow = rows.find(r => r.name === 'Timed task 1045');
  if (!timedRow || !/10:45\s?AM/i.test(timedRow.start)) {
    throw new Error(`timed task must be at 10:45 AM in agenda, saw ${timedRow && timedRow.start}`);
  }

  // (C) No agenda row may start inside the 00:00-07:00 block.
  const inBlock = rows.filter(r => {
    const m = r.start.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
    if (!m) return false;
    let h = parseInt(m[1], 10); if (/PM/i.test(m[3]) && h !== 12) h += 12; if (/AM/i.test(m[3]) && h === 12) h = 0;
    return h < 7;
  });
  if (inBlock.length) throw new Error(`agenda rows leaked into the blocked sleep window: ${JSON.stringify(inBlock)}`);

  // (D.2) Tapping an agenda row opens the detail sheet for the right item.
  await page.locator('#today-content .agenda-row', { hasText: 'Timed task 1045' }).click();
  await page.waitForSelector('#detail-sheet.open, body.pane-active');
  const detailName = await page.locator('#detail-name').textContent();
  if (!detailName || !detailName.includes('Timed task 1045')) {
    throw new Error(`agenda row tap opened the wrong detail: ${JSON.stringify(detailName)}`);
  }
  await page.locator('#detail-cool').click();
  await page.waitForTimeout(150);

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3 — plan integration: a habit planned for today via a plan log
  // surfaces in the today agenda with the planned day's row.
  // ────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const h = data.find(x => x.name === 'Windowed workout');
    if (h) h.logs.push({ ts: new Date().setHours(11, 0, 0, 0), plan: true });
    localStorage.setItem('tings_v2', JSON.stringify(data));
  });
  await page.evaluate(() => { if (typeof openToday === 'function') openToday(); });
  await page.waitForSelector('#today-content .agenda-row');
  const plannedRows = await page.locator('#today-content .agenda-row').evaluateAll(els =>
    els.map(el => el.querySelector('.agenda-name')?.textContent?.trim() || '')
  );
  if (!plannedRows.includes('Windowed workout')) {
    throw new Error('planned habit did not surface in today agenda after a plan log was added');
  }

  // Restore real time before we finish so nothing downstream stays frozen.
  await page.evaluate(() => { if (window.__tingsRealDate) window.Date = window.__tingsRealDate; });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ planRows, blocks, blocksAfter, blocksFinal, timedPills, rowCount, summary, rows }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
