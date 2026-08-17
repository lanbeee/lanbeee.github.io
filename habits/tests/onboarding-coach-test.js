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
  await stage(page,'iSteps',3500);
  assert(await page.locator('link[data-tings-coach]').count() === 1,'first-run coach loads its stylesheet on demand');
  assert((await page.locator('.tings-coach-progress').textContent()) === '1 of 2 · install app','a first-run browser user gets the install guide first');
  assert(await page.locator('.tings-step-glyph i').count() === 3,'install guidance shows numbered icon tiles');
  const stepNums = await page.locator('.tings-step-num').allTextContents();
  assert(stepNums.length === 3 && stepNums[0] === '1' && stepNums[2] === '3','install steps are numbered in order');
  await primary(page,'iSteps','iNext');
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Start guided start','the install tour ends by handing over to the guided start');
  await page.locator('[data-coach-primary]').click();
  await stage(page,'eIntro');
  assert((await page.locator('.tings-coach-progress').textContent()) === '1 of 14 · guided start','the handover chains into the full essentials tour');

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

  // Install guide from About: iconified steps, then the guided-start handover.
  await page.locator('#open-about').click();
  await page.locator('#open-install-guide').click();
  await stage(page,'iSteps');
  assert((await page.locator('.tings-coach-progress').textContent()) === '1 of 2 · install app','About runs the install guide as its own tour');
  assert(await page.locator('.tings-step-glyph i').count() === 3,'install guidance lists three iconified steps');
  assert(await page.locator('[data-coach-back]').count() === 0,'the install tour opens on its first step');
  assert(await page.locator('#tings-coach').getAttribute('data-gated') === 'true','install guidance keeps the rest of the app locked');
  const coverGuard = await page.evaluate(()=>{
    const top = document.querySelector('[data-coach-guard="top"]').getBoundingClientRect();
    return {w:top.width,h:top.height,vw:window.innerWidth,vh:window.innerHeight};
  });
  assert(coverGuard.h >= coverGuard.vh - 1 && coverGuard.w >= coverGuard.vw - 1,'the install step has no in-page target so guards cover the whole surface');
  await primary(page,'iSteps','iNext');
  assert((await page.locator('[data-coach-later]').textContent()) === 'skip for now','the guided-start handover keeps a soft escape');
  await page.locator('[data-coach-later]').click();
  assert(await page.locator('#tings-coach').count() === 0,'skipping the handover ends the install tour quietly');

  // Native-prompt variant: a captured install gesture swaps in an Install
  // button; a declined or broken prompt falls back to the manual steps.
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeinstallprompt')));
  await page.evaluate(()=>window.startTingsCoach('install',{force:true}));
  await stage(page,'iSteps');
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Install','a captured install gesture offers the native prompt');
  assert((await page.locator('[data-coach-later]').textContent()) === 'Not now','the native install step keeps a soft escape');
  await page.locator('[data-coach-primary]').click();
  await page.waitForTimeout(200);
  assert(await page.locator('.tings-step-glyph i').count() === 3,'a declined native prompt falls back to manual install steps');
  await primary(page,'iSteps','iNext');
  await page.locator('[data-coach-primary]').click();
  await stage(page,'eIntro');
  assert((await page.locator('.tings-coach-progress').textContent()) === '1 of 7 · guided start','the handover chains into the guided start replay');
  await page.evaluate(()=>window.TingsCoach.stop());

  // Already installed (standalone display mode): the first-run offer goes
  // straight to the guided start, and About refuses a second install tour.
  const savedStore = await page.evaluate(()=>localStorage.getItem('tings_v2'));
  await page.addInitScript(()=>{
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => /standalone|minimal-ui|fullscreen/.test(query)
      ? {matches:true,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false;}}
      : original(query);
  });
  await page.evaluate(()=>{
    localStorage.setItem('tings_v2','[]');
    localStorage.removeItem('tings_coach_essentials_v2');
    localStorage.removeItem('tings_coach_advanced_v2');
    localStorage.removeItem('tings_coach_install_v2');
  });
  await page.reload({waitUntil:'load'});
  await stage(page,'eIntro',3500);
  assert(true,'standalone fresh users are offered the guided start directly, not the install guide');
  await page.evaluate(()=>window.TingsCoach.stop());
  await page.evaluate(data=>{localStorage.setItem('tings_v2',data);},savedStore);
  await page.locator('#open-about').click();
  await page.locator('#open-install-guide').click();
  await page.waitForTimeout(250);
  assert(await page.locator('#tings-coach').count() === 0,'already-installed users get no install tour from About');
  await page.evaluate(()=>closeSheet('about-sheet'));
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
