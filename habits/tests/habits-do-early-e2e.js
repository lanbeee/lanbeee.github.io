const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

function dateKey(offset){
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0,10);
}

function atDay(offset,hour = 12,minute = 0){
  const d = new Date();
  d.setHours(hour,minute,0,0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 860 }, isMobile: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(({ today, target, targetTs }) => {
    localStorage.clear();
    const settings = {
      preset: 'todayFirst',
      showWeekOnHome: false,
      availabilityMinutes: [240,240,240,240,240,240,240],
      availabilityOverrides: { [today]: 240, [target]: 60 },
      blockedTimes: [],
      showScheduledTasksInAgenda: true,
      showDueTasksInAgenda: true,
      showPlannedItemsInAgenda: true,
      showDueHabitsInAgenda: true
    };
    const data = [
      {
        name: 'Do early laundry',
        type: 'keepup',
        target: 2,
        flexibilityDays: 2,
        durationMinutes: 45,
        lastLog: Date.now(),
        logs: [Date.now()],
        emoji: '',
        pinned: false,
        topics: [],
        createdAt: Date.now()
      },
      {
        name: 'Busy target meeting',
        type: 'task',
        target: null,
        durationMinutes: 50,
        dueDate: targetTs,
        eventTime: null,
        hardDue: false,
        flexibilityDays: 0,
        lastLog: null,
        logs: [],
        emoji: '',
        pinned: false,
        topics: [],
        createdAt: Date.now()
      },
      {
        name: 'Normal upcoming',
        type: 'keepup',
        target: 7,
        flexibilityDays: 0,
        durationMinutes: 30,
        lastLog: Date.now(),
        logs: [Date.now()],
        emoji: '',
        pinned: false,
        topics: [],
        createdAt: Date.now()
      }
    ];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    localStorage.setItem('tings_v2', JSON.stringify(data));
  }, { today: dateKey(0), target: dateKey(2), targetTs: atDay(2) });
  await page.reload({ waitUntil: 'networkidle' });

  // The standalone "do it early" section is gone. Items that pass the do-early
  // gate AND earn an agenda row today are pulled into the "today" section,
  // still carrying their "early" pill. With 240 minutes free today, "Do early
  // laundry" fits and lives under "today"; "Normal upcoming" stays under
  // "upcoming" (no flexibility, so it never qualifies for do-early).
  if (await page.locator('.section-header:text("do it early")').count()) {
    throw new Error('do it early section header should be gone');
  }
  const laundrySection = await page.locator('.ting-card:has-text("Do early laundry")').first().evaluate(card => {
    const row = card.closest('.swipe-row') || card.parentElement;
    let node = row ? row.previousElementSibling : null;
    while (node) {
      if (node.classList && node.classList.contains('section-header')) return node.textContent.trim();
      node = node.previousElementSibling;
    }
    return null;
  });
  if (laundrySection !== 'today') throw new Error(`Do early laundry should be under today, got: ${laundrySection}`);
  if (!(await page.locator('.ting-card:has-text("Do early laundry") .context-pill:has-text("early")').first().isVisible())) {
    throw new Error('early reason pill missing');
  }
  if (!(await page.locator('.section-header:text("upcoming")').isVisible())) {
    throw new Error('upcoming section missing');
  }

  await page.locator('#open-overview').click();
  await page.locator(`[data-log-day="${dateKey(0)}"]`).first().click();
  await page.waitForSelector('#day-logs-sheet.open');
  await page.locator('#day-log-ting').selectOption({ label: 'Normal upcoming' });
  await page.locator('#day-log-time').fill('09:30');
  await page.locator('#day-log-add').click();
  await page.waitForSelector('#action-toast.show');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
  const planned = stored.find(h => h.name === 'Normal upcoming').logs.find(log => log && log.plan);
  if (!planned) throw new Error('planned log was not created');
  const plannedDate = new Date(planned.ts);
  if (plannedDate.getHours() !== 9 || plannedDate.getMinutes() !== 30) {
    throw new Error(`planned time was not preserved: ${plannedDate.toISOString()}`);
  }

  await page.locator('#day-logs-home').click();
  await page.waitForSelector('#day-logs-sheet:not(.open)');
  await page.locator('.ting-card:has-text("Do early laundry") .pulse-btn').click();
  await page.waitForSelector('#action-toast.show');
  // The toast reads "Logged <name>" (see logTing -> showActionToast), not a literal
  // "Entry logged", so match the prefix the app actually emits.
  await page.waitForFunction(() => /^Logged\s/.test(document.querySelector('#action-text')?.textContent || ''));
  if (!(await page.locator('#action-open').isVisible())) throw new Error('undo open action missing');
  if (!(await page.locator('#action-plan').isVisible())) throw new Error('undo plan-today action missing after actual log');
  await page.locator('#action-plan').click();
  await page.waitForSelector('#action-toast.show');
  const afterPlan = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
  const laundryPlans = afterPlan.find(h => h.name === 'Do early laundry').logs.filter(log => log && log.plan);
  if (!laundryPlans.length) throw new Error('toast plan today action did not add a plan');

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'how it works' }).click();
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.locator('#settings-testdata-head').click();
  await page.getByRole('button', { name: 'add samples' }).click();
  // Samples load without the old standalone "do it early" section. The
  // "do early because ..." item still renders — under "today" when today has
  // room for it (carrying the early pill), otherwise under "upcoming". Either
  // way the legacy section header must not appear.
  if (await page.locator('.section-header:text("do it early")').count()) {
    throw new Error('sample data should not create a do it early section');
  }
  if (!(await page.locator('.ting-card:has-text("do early because")').first().isVisible())) {
    throw new Error('sample do-early item did not render');
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ laundrySection, plannedHour: plannedDate.getHours(), laundryPlans: laundryPlans.length }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
