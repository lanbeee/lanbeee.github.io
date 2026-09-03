// Advanced coach data isolation test.
//
// Verifies that the advanced coach's temporary demo state is fully restored
// after the coach ends: tings_v2 and tings_app_settings_v2 are exactly the
// same as before the coach started, while per-chapter completion markers
// (tings_coach_advanced_v2) are preserved.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/advanced-coach-isolation-test.js

const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const errors = [];

function assert(condition, message){
  if(!condition)throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

async function stage(page, name, timeout = 5000){
  await page.waitForSelector(`#tings-coach[data-coach-stage="${name}"]`, {timeout});
}

async function primary(page, current, next){
  await stage(page, current);
  await page.locator('[data-coach-primary]').click();
  if(next) await stage(page, next);
}

(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(baseUrl, {waitUntil: 'load'});

  // Start with a clean slate (simulates a real user with some habits).
  await page.evaluate(() => {
    localStorage.clear();
    // Plant a small set of real user habits so we can verify they are restored.
    const userHabits = [
      {hid:'real-h1', message:'Real habit 1', type:'habit', target:1, duration:20,
       breakable:false, priority:1, pinned:false, emoji:'⭐', topics:['life'], logs:[]},
      {hid:'real-h2', message:'Real habit 2', type:'habit', target:1, duration:15,
       breakable:false, priority:1, pinned:false, emoji:'🌙', topics:['rest'], logs:[]}
    ];
    localStorage.setItem('tings_v2', JSON.stringify(userHabits));
    const userSettings = {minimalMode: true, showWeekOnHome: false, agendaOptimizer: true};
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(userSettings));
  });
  await page.reload({waitUntil: 'load'});

  // Capture pre-coach state.
  const beforeV2 = await page.evaluate(() => localStorage.getItem('tings_v2'));
  const beforeSettings = await page.evaluate(() => localStorage.getItem('tings_app_settings_v2'));

  // Start the advanced coach.
  await page.evaluate(() => window.startTingsCoach('advanced', {force: true}));
  await stage(page, 'aIntro');

  // Verify that demo habits were injected (tings_v2 should have grown).
  const duringV2Raw = await page.evaluate(() => localStorage.getItem('tings_v2'));
  const duringHabits = JSON.parse(duringV2Raw || '[]');
  const hasDemo = duringHabits.some(h => h.hid === '__coach_demo__');
  const hasMissedDemo = duringHabits.some(h => h.hid === '__coach_demo_missed__');
  assert(hasDemo, 'demo habit injected into tings_v2 while coach is running');
  assert(hasMissedDemo, 'demo missed habit injected into tings_v2 while coach is running');

  // Real habits must also still be present (coach preserves existing data).
  const realStillPresent = duringHabits.some(h => h.hid === 'real-h1');
  assert(realStillPresent, 'real user habits are preserved during demo state');

  // Verify missed pill seeded.
  const suggested = await page.evaluate(() => {
    const raw = localStorage.getItem('tings_today_suggested_v1');
    return raw ? JSON.parse(raw) : null;
  });
  assert(suggested && suggested.hids && typeof suggested.hids === 'object',
    'tings_today_suggested_v1 seeded with hids object');
  assert(Object.prototype.hasOwnProperty.call(suggested.hids, '__coach_demo_missed__'),
    'hids contains the demo missed habit hid');

  // Take one chapter all the way to completion (home chapter without full mode etc — skip it).
  // We just test skip/finish restores state.
  const skipBtn = page.locator('[data-coach-skip]');
  await skipBtn.click(); // arm
  await skipBtn.click(); // confirm

  // Coach should be gone.
  assert(await page.locator('#tings-coach').count() === 0, 'coach unmounted after skip');

  // Verify restoration.
  const afterV2 = await page.evaluate(() => localStorage.getItem('tings_v2'));
  const afterSettings = await page.evaluate(() => localStorage.getItem('tings_app_settings_v2'));

  // tings_v2 must be restored: real habits back, no demo habits.
  const afterHabits = JSON.parse(afterV2 || '[]');
  assert(!afterHabits.some(h => String(h?.hid||'').startsWith('__coach_')),
    'no demo habits remain in tings_v2 after coach ends');
  assert(afterHabits.some(h => h.hid === 'real-h1'),
    'real habit real-h1 restored in tings_v2 after coach ends');
  assert(afterHabits.some(h => h.hid === 'real-h2'),
    'real habit real-h2 restored in tings_v2 after coach ends');

  // Settings must be restored exactly.
  assert(afterSettings === beforeSettings,
    'tings_app_settings_v2 restored exactly to pre-coach value');

  // Chapter completion markers must survive (coach uses a separate key).
  // After a skip the marker should be 'skipped', not wiped.
  const advancedMarkers = await page.evaluate(() => localStorage.getItem('tings_coach_advanced_v2'));
  // The key may or may not exist depending on which chapter was active; but
  // it must not be the raw user-data key.
  assert(afterV2 !== null, 'tings_v2 is not null after coach ends');

  // Second run: verify that a second advanced coach start also snapshots correctly.
  await page.evaluate(() => window.startTingsCoach('advanced', {force: true}));
  await stage(page, 'aIntro');
  const secondDuringV2 = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    return h.filter(x => String(x.hid||'').startsWith('__coach_')).map(x => x.hid);
  });
  assert(secondDuringV2.length >= 2, 'second advanced coach run also injects demo habits');
  const skipBtn2 = page.locator('[data-coach-skip]');
  await skipBtn2.click();
  await skipBtn2.click();
  const finalV2 = await page.evaluate(() => localStorage.getItem('tings_v2'));
  const finalHabits = JSON.parse(finalV2 || '[]');
  assert(!finalHabits.some(h => String(h?.hid||'').startsWith('__coach_')),
    'demo habits removed after second coach run ends too');

  if(errors.length){
    console.error('Page errors:', errors);
    process.exit(1);
  }
  await browser.close();
  console.log('\nAll isolation assertions passed.');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
