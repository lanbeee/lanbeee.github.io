const { chromium } = require('playwright');

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

  await page.goto('http://127.0.0.1:4175/', { waitUntil: 'networkidle' });
  await page.evaluate(({ today, target, targetTs }) => {
    localStorage.clear();
    const settings = {
      preset: 'todayFirst',
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

  await page.waitForSelector('.section-header:text("do it early")');
  const earlyText = await page.locator('.section-header:text("do it early") + .swipe-row .ting-name').first().textContent();
  if (earlyText !== 'Do early laundry') throw new Error(`wrong do-it-early item: ${earlyText}`);
  if (!(await page.locator('.ting-card:has-text("Do early laundry") .context-pill:has-text("early")').isVisible())) {
    throw new Error('early reason pill missing');
  }
  if (!(await page.locator('.section-header:text("upcoming")').isVisible())) {
    throw new Error('upcoming section missing after do it early split');
  }

  await page.locator('#open-overview').click();
  await page.locator(`[data-log-day="${dateKey(0)}"]`).first().click();
  await page.waitForSelector('#day-logs-sheet.open');
  await page.locator('#day-log-ting').selectOption({ label: 'Normal upcoming' });
  await page.locator('#day-log-time').fill('09:30');
  await page.locator('#day-log-add').click();
  await page.waitForSelector('#undo-toast.show');
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
  await page.waitForSelector('#undo-toast.show');
  await page.waitForFunction(() => document.querySelector('#undo-text')?.textContent === 'Entry logged');
  if (!(await page.locator('#undo-open').isVisible())) throw new Error('undo open action missing');
  if (!(await page.locator('#undo-plan').isVisible())) throw new Error('undo plan-today action missing after actual log');
  await page.locator('#undo-plan').click();
  await page.waitForSelector('#undo-toast.show');
  const afterPlan = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
  const laundryPlans = afterPlan.find(h => h.name === 'Do early laundry').logs.filter(log => log && log.plan);
  if (!laundryPlans.length) throw new Error('toast plan today action did not add a plan');

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'how it works' }).click();
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.getByRole('button', { name: 'add samples' }).click();
  await page.waitForSelector('.section-header:text("do it early")');
  if (!(await page.locator('.ting-card:has-text("do early because") .context-pill:has-text("early")').isVisible())) {
    throw new Error('sample data did not create an early item');
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ earlyText, plannedHour: plannedDate.getHours(), laundryPlans: laundryPlans.length }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
