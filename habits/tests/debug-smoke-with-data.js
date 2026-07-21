// Debug: habits-layout-smoke against the sample backup (which has prayer
// habits with Maghrib anchors). Capture every console message.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';
const backup = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'sample_tings-backup-2026-07-20.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true });
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => msgs.push(`[reqfail] ${r.url()} ${r.failure() && r.failure().errorText}`));

  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.evaluate(({ backup }) => {
    localStorage.setItem('tings_v2', JSON.stringify(backup.habits));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(backup.settings));
  }, { backup });
  await page.reload({ waitUntil:'networkidle' });

  // Mirror the layout-smoke steps.
  await page.locator('#open-add').waitFor({ state:'visible' });
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  await page.locator('#type-seg [data-v="task"]').click();
  await page.locator('#task-due-row').waitFor({ state:'visible' });
  await page.locator('#ting-due-time').waitFor({ state:'visible' });
  await page.waitForTimeout(450);

  console.log('CONSOLE MESSAGES (' + msgs.length + '):');
  for (const m of msgs) console.log(' ', m);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
