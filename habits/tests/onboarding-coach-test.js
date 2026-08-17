// Refined essentials + full-mode advanced coach smoke test.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/onboarding-coach-test.js
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const coachUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'planner=fast';
const habitName = `Coach reading ${Date.now()}`;

function assert(condition,message){
  if(!condition)throw new Error(message);
  console.log('  ok: ' + message);
}

async function stage(page,name,timeout = 4000){
  await page.waitForSelector(`#tings-coach[data-coach-stage="${name}"]`,{timeout});
}

async function primary(page,current,next){
  await stage(page,current);
  await page.locator('[data-coach-primary]').click();
  if(next)await stage(page,next);
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
  await stage(page,'eIntro',3500);
  assert(await page.locator('link[data-tings-coach]').count() === 1,'first-run coach loads its stylesheet on demand');

  await primary(page,'eIntro','eAdd');
  assert(await page.locator('#tings-coach').getAttribute('data-locked') === 'true','required action steps lock interaction to the highlighted target');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.setViewportSize({width:390,height:480});
  await page.waitForTimeout(150);
  const keyboardLayout = await page.evaluate(()=>{
    const bubble = document.querySelector('.tings-coach-bubble').getBoundingClientRect();
    const input = document.getElementById('ting-message').getBoundingClientRect();
    const kind = document.getElementById('type-seg').getBoundingClientRect();
    const atKind = document.elementFromPoint(kind.left + kind.width / 2,kind.top + kind.height / 2);
    const overlap = !(bubble.right <= input.left || bubble.left >= input.right || bubble.bottom <= input.top || bubble.top >= input.bottom);
    return {bubbleBottom:bubble.bottom,viewport:window.visualViewport?.height || window.innerHeight,overlap,guarded:Boolean(atKind?.closest('[data-coach-guard]'))};
  });
  assert(keyboardLayout.bubbleBottom <= keyboardLayout.viewport + 1 && !keyboardLayout.overlap,'name guidance stays inside a keyboard-sized visual viewport without covering the input');
  assert(keyboardLayout.guarded,'controls outside the name step are shielded from accidental taps');
  await page.setViewportSize({width:390,height:844});

  await page.locator('#ting-message').fill(habitName);
  await primary(page,'eName','eKind');
  await page.evaluate(()=>cancelAdd());
  await stage(page,'eAdd');
  assert(true,'coach recovers to the correct step when the add sheet closes unexpectedly');

  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.locator('#ting-message').fill(habitName);
  await primary(page,'eName','eKind');
  await page.locator('#type-seg [data-v="task"]').click();
  await stage(page,'eTask');
  assert(await page.locator('#task-due-row').isVisible(),'task branch teaches optional due dates and fixed times');
  await page.locator('[data-coach-back]').click();
  await stage(page,'eKind');
  await page.locator('#type-seg [data-v="keepup"]').click();
  await stage(page,'eRhythm');
  await page.locator('#ting-times').fill('3');
  await page.locator('#ting-days').fill('7');
  await primary(page,'eRhythm','eSave');
  await page.locator('#do-save').click();
  await stage(page,'eDetailBasics',5000);
  assert(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),'coach follows the saved Ting into its real detail screen');

  await primary(page,'eDetailBasics','eDetailEffort');
  await primary(page,'eDetailEffort','eHomeCard');
  await primary(page,'eHomeCard','eLog');
  assert(await page.locator('#tings-coach').getAttribute('data-locked') === 'true','logging practice is a required action');
  await page.locator('[data-coach-later]').click();
  await stage(page,'eHomeGroups');
  await page.locator('[data-coach-back]').click();
  await stage(page,'eLog');
  await page.locator('.ting-card [data-pulse]').first().click();
  await stage(page,'eHomeGroups');
  assert(true,'logging practice advances via the real pulse button');

  const guardedNav = await page.evaluate(()=>{
    const btn = document.getElementById('open-add').getBoundingClientRect();
    const hit = document.elementFromPoint(btn.left + btn.width / 2,btn.top + btn.height / 2);
    return Boolean(hit?.closest('[data-coach-guard]'));
  });
  assert(guardedNav,'guided steps shield navigation controls outside the spotlight');
  await page.evaluate(()=>document.getElementById('open-add').click());
  await page.waitForTimeout(300);
  assert(await page.locator('#add-sheet.open').count() === 0,'the coach closes any sheet the current step did not ask for');

  await primary(page,'eHomeGroups','eCalendar');
  await page.locator('#open-overview').click();
  await stage(page,'eOverview');
  await primary(page,'eOverview','eFinish');
  await page.locator('[data-coach-primary]').click();
  assert(await page.locator('#tings-coach').count() === 0,'finishing guided start removes the coach');
  const essentialState = await page.evaluate(name=>{
    const item = JSON.parse(localStorage.getItem('tings_v2') || '[]').find(h=>h.name === name);
    return {marker:localStorage.getItem('tings_coach_essentials_v2'),target:item?.target,type:item?.type,logs:item?.logs?.length || 0};
  },habitName);
  assert(essentialState.marker === 'done' && essentialState.target === 7 / 3 && essentialState.type === 'keepup','guided start preserves the chosen habit rhythm and remembers completion');
  assert(essentialState.logs >= 1,'logging practice recorded a real log entry');

  await page.evaluate(()=>window.startTingsCoach('advanced',{force:true}));
  await primary(page,'aIntro','aFullMode');
  await page.locator('[data-setting-toggle="minimalMode"]').click();
  await stage(page,'aHome');
  assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}').minimalMode === false),'advanced coach teaches and enables full mode');

  await primary(page,'aHome','aActions');
  await primary(page,'aActions','aDetailRead');
  await primary(page,'aDetailRead','aSchedule');
  await primary(page,'aSchedule','aEffort');
  await primary(page,'aEffort','aIdentity');
  await primary(page,'aIdentity','aLifecycle');
  await primary(page,'aLifecycle','aSearch');
  await primary(page,'aSearch','aCalendar');
  await page.locator('#open-overview').click();
  await stage(page,'aOverview');
  await primary(page,'aOverview','aOverviewTools');
  await primary(page,'aOverviewTools','aSettingsDisplay');
  await primary(page,'aSettingsDisplay','aBackup');
  await primary(page,'aBackup','aCalendarImport');
  await primary(page,'aCalendarImport','aOrganization');
  await primary(page,'aOrganization','aBusy');
  await primary(page,'aBusy','aDefaults');
  await primary(page,'aDefaults','aOptimizer');
  await primary(page,'aOptimizer','aFinish');
  await page.locator('[data-coach-primary]').click();
  assert(await page.evaluate(()=>localStorage.getItem('tings_coach_advanced_v2') === 'done'),'advanced coach remembers completion after the full pro walkthrough');
  assert(await page.locator('#settings-sheet.open').count() === 0,'advanced coach closes its final settings sheet');

  await page.locator('#open-about').click();
  assert(await page.locator('#start-essentials-coach').count() === 1 && await page.locator('#start-advanced-coach').count() === 1,'About exposes both coaches for replay');
  await page.evaluate(()=>window.startTingsCoach('essentials',{force:true}));
  await stage(page,'eIntro');
  await page.locator('[data-coach-skip]').click();
  assert(await page.locator('[data-coach-skip]').getAttribute('data-armed') === '1','first skip tap arms instead of ending the tour');
  await page.locator('[data-coach-skip]').click();
  assert(await page.locator('#tings-coach').count() === 0,'second skip tap ends the tour');
  assert(await page.evaluate(()=>localStorage.getItem('tings_coach_essentials_v2')) === 'skipped','skipping is recorded only after confirmation');
  await page.evaluate(()=>{
    localStorage.removeItem('tings_coach_essentials_v2');
    localStorage.removeItem('tings_coach_advanced_v2');
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
