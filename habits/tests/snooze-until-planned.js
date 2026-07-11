const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true });
  const errors = [];
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(err.message));

  const habitName = `SnoozeTest ${Date.now()}`;
  const future = new Date(Date.now() + 3 * 86400000);
  const futureKey = future.toISOString().slice(0, 10);

  await page.addInitScript(({ name }) => {
    localStorage.setItem('tings_v2', JSON.stringify([
      { name, type:'keepup', target:1, logs:[], emoji:'', pinned:false, snoozedUntil:null, createdAt:Date.now() }
    ]));
  }, { name: habitName });
  await page.goto(baseUrl, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');

  // ── 1. Habit card visible before snooze ──
  const card = page.locator('#list .ting-card', { hasText: habitName });
  if(!(await card.isVisible()))throw new Error('habit card should be visible before snooze');

  // ── 2. Add a plan for a future date ──
  await page.evaluate(({ name, futureKey }) => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const idx = data.findIndex(h => h.name === name);
    if(idx === -1)throw new Error('habit not found');
    const result = planTingOnDay(idx, futureKey);
    if(!result)throw new Error('planTingOnDay returned false');
  }, { name: habitName, futureKey });

  await page.waitForTimeout(300);

  // ── 3. Snooze-until-planned button appears in toast ──
  const snoozeBtn = page.locator('#snooze-until-planned');
  const snoozeVisible = await snoozeBtn.isVisible();
  if(!snoozeVisible)throw new Error('snooze-until-planned button was not visible');

  const btnText = await snoozeBtn.textContent();
  if(btnText !== 'snooze until planned')throw new Error(`Unexpected button text: "${btnText}"`);

  const toastVisible = await page.locator('#action-toast.show').isVisible();
  if(!toastVisible)throw new Error('undo toast was not shown');

  // ── 4. Click the snooze-until-planned button ──
  await snoozeBtn.click();
  await page.waitForTimeout(300);

  // ── 5. Verify data: snoozedUntil is set to the planned timestamp ──
  const futureTs = new Date(futureKey + 'T12:00:00').getTime();
  const snoozedUntil = await page.evaluate(({ name }) => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const h = data.find(h => h.name === name);
    return h ? h.snoozedUntil : null;
  }, { name: habitName });
  if(snoozedUntil !== futureTs)throw new Error(`Expected snoozedUntil ${futureTs}, got ${snoozedUntil}`);

  // ── 6. Habit card is hidden from home screen ──
  await page.waitForTimeout(500);
  const cardHidden = await card.isVisible();
  if(cardHidden)throw new Error('habit card should be hidden after snooze');

  // Confirm empty state shows "hidden for now"
  const empty = page.locator('#empty');
  const emptyText = await empty.textContent();
  if(!emptyText || !emptyText.includes('hidden for now'))throw new Error(`Expected "hidden for now" empty state, got: "${emptyText}"`);

  // ── 7. Simulate time passing: clear snoozedUntil and re-render ──
  // The habit should reappear once the planned date arrives
  await page.evaluate(({ name }) => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const h = data.find(h => h.name === name);
    if(!h)throw new Error('habit not found');
    h.snoozedUntil = null;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    // Re-read to refresh the view with the updated data
    render();
  }, { name: habitName });

  await page.waitForTimeout(500);

  // ── 8. Habit card is visible again after snooze expires ──
  const cardBack = await card.isVisible();
  if(!cardBack)throw new Error('habit card should be visible after snooze expires');

  const snoozedAfter = await page.evaluate(({ name }) => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    const h = data.find(h => h.name === name);
    return h ? h.snoozedUntil : null;
  }, { name: habitName });
  if(snoozedAfter !== null)throw new Error(`snoozedUntil should be null after clearing, got ${snoozedAfter}`);

  // ── 9. Cleanup ──
  await page.evaluate(({ name }) => {
    const raw = localStorage.getItem('tings_v2');
    if(!raw)return;
    const items = JSON.parse(raw);
    localStorage.setItem('tings_v2', JSON.stringify(items.filter(h => h.name !== name)));
  }, { name: habitName });

  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('snooze-until-planned test passed');
})().catch(async err=>{
  console.error(err);
  process.exit(1);
});
