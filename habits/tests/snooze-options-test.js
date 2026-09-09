// Snooze sheet hours / end-of-day options, and unsnooze from Home + the sheet.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/snooze-options-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Snooze item', hid:'snooze-item', type:'keepup', target:1, logs:[], emoji:'', pinned:false, snoozedUntil:null, createdAt:Date.now() }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', minimalMode:false, showSnoozed:true, showSnoozedUntilOnCards:true, showWeekOnHome:false
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForSelector('#open-add');
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  async function habitState(){
    return page.evaluate(() => {
      const h = load().find(item => item.hid === 'snooze-item');
      return {
        snoozedUntil:h ? h.snoozedUntil : null,
        isSnoozed:typeof habitIsSnoozed === 'function' ? habitIsSnoozed(h) : Boolean(h && h.snoozedUntil && Date.now() < h.snoozedUntil),
        endOfDay:typeof snoozeUntilEndOfDay === 'function' ? snoozeUntilEndOfDay() : (dayStart(Date.now()) + 86400000),
        now:Date.now()
      };
    });
  }

  async function resetSnooze(){
    await page.evaluate(() => {
      const data = load();
      const h = data.find(item => item.hid === 'snooze-item');
      if(h)h.snoozedUntil = null;
      save(data);
      render();
    });
  }

  // ── A. Sheet offers hour, today, day, and custom-hours controls ──
  console.log('\n[A] snooze sheet options');
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'snooze-item');
    openSnooze(idx);
  });
  await page.waitForSelector('#snooze-sheet.open', { timeout:3000 });
  const optionState = await page.evaluate(() => ({
    hours:[...document.querySelectorAll('[data-snooze-hours]')].map(btn => btn.dataset.snoozeHours),
    today:Boolean(document.querySelector('[data-snooze-until="eod"]')),
    days:[...document.querySelectorAll('[data-snooze-days]')].map(btn => btn.dataset.snoozeDays),
    custom:Boolean(document.getElementById('snooze-hours')),
    apply:Boolean(document.getElementById('snooze-hours-apply')),
    showNowHidden:document.getElementById('snooze-show-now')?.hidden === true
  }));
  assert(optionState.hours.join(',') === '1,3,8', 'hour presets 1h 3h 8h');
  assert(optionState.today, 'today / end-of-day button present');
  assert(optionState.days.join(',') === '1,3,7,14', 'day presets unchanged');
  assert(optionState.custom && optionState.apply, 'custom hours field and hide button');
  assert(optionState.showNowHidden, 'show now hidden when not snoozed');

  // ── B. 3h preset ──
  console.log('\n[B] hide for 3 hours');
  await page.locator('[data-snooze-hours="3"]').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  let state = await habitState();
  assert(state.isSnoozed, 'habit is snoozed after 3h');
  assert(Math.abs(state.snoozedUntil - state.now - 3 * 3600000) < 8000, 'snoozedUntil is about 3 hours from now');

  // ── C. Home swipe/card becomes show and unsnoozes ──
  console.log('\n[C] unsnooze from home');
  await page.waitForSelector('.swipe-action[data-action="unsnooze"]', { state:'attached' });
  const homeShow = await page.evaluate(() => {
    const swipe = document.querySelector('.swipe-action[data-action="unsnooze"]');
    const card = document.querySelector('.card-action-btn[data-action="unsnooze"]');
    return {
      swipeLabel:(swipe?.textContent || '').replace(/\s+/g,' ').trim(),
      hasCardShow:Boolean(card)
    };
  });
  assert(homeShow.swipeLabel === 'show', 'swipe action labeled show');
  assert(homeShow.hasCardShow, 'card action is show');
  await page.evaluate(() => {
    document.querySelector('.swipe-action[data-action="unsnooze"]')?.click();
  });
  state = await habitState();
  assert(!state.isSnoozed && state.snoozedUntil == null, 'show swipe clears snoozedUntil');
  const undoText = await page.locator('#action-text').textContent();
  assert(/Showing/.test(undoText || ''), 'unsnooze toast says Showing');

  // ── D. today = midnight tonight ──
  console.log('\n[D] hide until end of today');
  await resetSnooze();
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'snooze-item');
    openSnooze(idx);
  });
  await page.waitForSelector('#snooze-sheet.open');
  await page.locator('[data-snooze-until="eod"]').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(state.snoozedUntil === state.endOfDay, 'today snoozes until midnight tonight');

  // ── E. custom hours ──
  console.log('\n[E] custom hours');
  await resetSnooze();
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'snooze-item');
    openSnooze(idx);
  });
  await page.waitForSelector('#snooze-sheet.open');
  await page.locator('#snooze-hours').fill('2');
  await page.locator('#snooze-hours-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(state.isSnoozed, 'custom hours snoozes the habit');
  assert(Math.abs(state.snoozedUntil - state.now - 2 * 3600000) < 8000, 'custom 2 hours lands about 2h out');

  // ── F. show now on the sheet ──
  console.log('\n[F] show now on the snooze sheet');
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'snooze-item');
    openDetail(idx);
    if(typeof scrollDetailToNav === 'function')scrollDetailToNav('actions');
  });
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  const detailShow = await page.evaluate(() => {
    const btn = document.getElementById('detail-snooze');
    return {
      title:btn?.querySelector('b')?.textContent || '',
      sub:btn?.querySelector('small')?.textContent || ''
    };
  });
  assert(detailShow.title === 'show', 'detail action reads show while snoozed');
  assert(/Bring it back/i.test(detailShow.sub), 'detail subtitle offers unsnooze');
  await page.locator('#detail-snooze').click({ force:true });
  await page.waitForSelector('#snooze-sheet.open');
  const showNowVisible = await page.locator('#snooze-show-now').isVisible();
  assert(showNowVisible, 'show now is visible on the sheet while snoozed');
  await page.locator('#snooze-show-now').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(!state.isSnoozed && state.snoozedUntil == null, 'show now clears the snooze');

  // ── G. undo hide restores the previous snooze ──
  console.log('\n[G] unsnooze undo restores hide');
  const undoLabel = await page.locator('#action-undo').textContent();
  assert(undoLabel.trim() === 'hide', 'unsnooze toast undo is hide');
  await page.locator('#action-undo').click();
  state = await habitState();
  assert(state.isSnoozed, 'undo hide restores the snooze');

  if(pageErrors.length){
    fail += 1;
    console.error('  FAIL: page errors — ' + pageErrors.join(' | '));
  }else{
    pass += 1;
    console.log('  ok: no page errors');
  }

  await browser.close();
  console.log(`\nsnooze-options-test: ${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
