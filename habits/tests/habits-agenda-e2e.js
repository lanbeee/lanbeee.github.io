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

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ planRows, blocks, blocksAfter, blocksFinal }));
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
