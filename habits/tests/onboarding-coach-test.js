// Essentials + full-mode advanced coach smoke test.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/onboarding-coach-test.js
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const coachUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'planner=fast';
const habitName = `Coach walk ${Date.now()}`;

function assert(condition,message){
  if(!condition)throw new Error(message);
  console.log('  ok: ' + message);
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));

  await page.goto(coachUrl,{waitUntil:'load'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'load'});

  assert(await page.locator('script[data-tings-coach]').count() === 0,'coach assets stay lazy before the first-run offer');
  await page.waitForSelector('#tings-coach[data-coach-stage="intro"]',{timeout:3500});
  assert(await page.locator('link[data-tings-coach]').count() === 1,'first-run coach loads its stylesheet on demand');

  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="addWait"]');
  await page.locator('#open-add').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="create"]');
  await page.locator('#ting-message').fill(habitName);
  await page.locator('#do-save').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="detail"]',{timeout:5000});
  assert(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),'coach follows the real saved Ting into detail');

  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="log"]');
  await page.locator('.ting-card [data-pulse]').first().click();
  await page.waitForSelector('#tings-coach[data-coach-stage="calendarWait"]',{timeout:3500});
  assert(await page.evaluate(name=>{
    const data = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    return Boolean(data.find(h=>h.name === name)?.lastLog);
  },habitName),'logging through the highlighted real card advances the coach');

  await page.locator('#open-overview').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="overview"]');
  await page.locator('[data-coach-primary]').click();
  assert(await page.locator('#tings-coach').count() === 0,'finishing essentials removes the coach');
  assert(await page.evaluate(()=>localStorage.getItem('tings_coach_essentials_v1') === 'done'),'essentials completion is remembered');

  await page.evaluate(()=>window.startTingsCoach('advanced',{force:true}));
  await page.waitForSelector('#tings-coach[data-coach-stage="intro"]');
  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="fullMode"]');
  await page.locator('[data-setting-toggle="minimalMode"]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="home"]',{timeout:3500});
  assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}').minimalMode === false),'advanced coach teaches and enables full mode');

  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="detail"]');
  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="calendarWait"]');
  await page.locator('#open-overview').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="overview"]');
  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="backup"]');
  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="planning"]');
  await page.locator('[data-coach-primary]').click();
  await page.waitForSelector('#tings-coach[data-coach-stage="finish"]');
  await page.locator('[data-coach-primary]').click();
  assert(await page.evaluate(()=>localStorage.getItem('tings_coach_advanced_v1') === 'done'),'advanced coach completion is remembered');
  assert(await page.locator('#settings-sheet.open').count() === 0,'advanced coach closes its final settings sheet');

  await page.locator('#open-about').click();
  assert(await page.locator('#start-essentials-coach').count() === 1 && await page.locator('#start-advanced-coach').count() === 1,'About exposes both coaches for replay');

  await page.evaluate(()=>{
    localStorage.removeItem('tings_coach_essentials_v1');
    localStorage.removeItem('tings_coach_advanced_v1');
  });
  await page.reload({waitUntil:'load'});
  await page.waitForTimeout(1200);
  assert(await page.locator('script[data-tings-coach]').count() === 0,'existing users do not download coach assets automatically');

  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('ONBOARDING COACH TEST PASSED');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
