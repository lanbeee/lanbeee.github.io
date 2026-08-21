// Household agenda projection: today + tomorrow, display fields only.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-share-projection-test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  await page.goto(baseUrl, { waitUntil:'load' });

  const result = await page.evaluate(async () => {
    const dayBase = typeof dayStart === 'function' ? dayStart(Date.now()) : Date.now();
    const week = {
      optimized:true,
      plannerSolveStatus:'optimal',
      days:[
        {
          dayBase,
          dayKey:'2099-01-01',
          weekday:4,
          isToday:true,
          usedMinutes:45,
          remainingMinutes:30,
          timeline:[
            { kind:'scheduled', start:dayBase + 9 * 3600000, end:dayBase + 9.5 * 3600000, h:{ name:'Medication', emoji:'💊', hid:'secret-hid' }, i:0, locationId:'home' },
            { kind:'blocked', start:dayBase + 10 * 3600000, end:dayBase + 11 * 3600000, label:'Deep Work Session Project Alpha' },
            { kind:'travel', start:dayBase + 11 * 3600000, end:dayBase + 11.25 * 3600000, fromName:'Home', toName:'Clinic' }
          ]
        },
        {
          dayBase:dayBase + 86400000,
          dayKey:'2099-01-02',
          weekday:5,
          isToday:false,
          usedMinutes:0,
          remainingMinutes:120,
          timeline:[]
        }
      ]
    };
    const projection = buildHouseholdAgendaProjection(week, {
      feed:{ feedId:'abcd'.repeat(8), title:'Family', lastRevision:3 },
      data:[{ name:'Medication', hid:'secret-hid', notes:'private', address:'123 Hidden Rd' }],
      now:dayBase + 8 * 3600000,
      dayCount:2
    });
    const json = JSON.stringify(projection);
    const cryptoBundle = await (async () => {
      const key = shareRandomHex(32);
      const envelope = await shareEncrypt(key, projection, {
        schemaVersion:1,
        recordKind:'agenda_snapshot',
        objectId:projection.feedId,
        revision:projection.revision
      });
      const back = await shareDecrypt(key, envelope);
      let tamper = false;
      try{
        await shareDecrypt(key, { ...envelope, ciphertext:btoa('tampered') });
        tamper = true;
      }catch(_){ tamper = false; }
      return { title:back.title, revision:back.revision, tamper };
    })();
    return {
      dayCount:projection.days.length,
      kinds:projection.days[0].rows.map(r=>r.kind),
      busyTitle:projection.days[0].rows.find(r=>r.kind === 'busy')?.title,
      json,
      provenance:projection.plannerProvenance,
      crypto:cryptoBundle
    };
  });

  console.log('\n--- Agenda share projection ---\n');
  assert(result.dayCount === 2, 'projects today and tomorrow only');
  assert(result.provenance === 'glpk-opt', 'maps optimal GLPK week to glpk-opt');
  assert(result.kinds.includes('item') && result.kinds.includes('busy') && result.kinds.includes('travel') && result.kinds.includes('open'), 'keeps item, busy, travel, and open rows');
  assert(result.busyTitle === 'Busy', 'replaces custom blocked labels with Busy');
  assert(!result.json.includes('secret-hid'), 'omits local habit ids');
  assert(!result.json.includes('123 Hidden Rd'), 'omits addresses');
  assert(!result.json.includes('Deep Work Session Project Alpha'), 'omits custom busy labels');
  assert(result.crypto.title === 'Family', 'AES-GCM round-trip restores the projection');
  assert(result.crypto.tamper === false, 'tampered ciphertext is rejected');

  const displayFixture = await page.evaluate(async () => {
    const feedId = shareRandomHex(16);
    const contentKey = shareRandomHex(32);
    const viewerCredential = shareRandomHex(32);
    const start = Date.UTC(2026, 0, 15, 14, 0, 0);
    const projection = {
      schemaVersion:1,
      feedId,
      title:'Timezone check',
      revision:1,
      generatedAt:Date.now(),
      timezone:'America/New_York',
      days:[{
        dateKey:'2026-01-15',
        weekdayLabel:'today',
        dateLabel:'Thursday, Jan 15',
        rows:[{ kind:'item', start, end:start + 30 * 60000, title:'Breakfast', emoji:'', durationMinutes:30 }]
      }]
    };
    const envelope = await shareEncrypt(contentKey, projection, {
      schemaVersion:1,
      recordKind:'agenda_snapshot',
      objectId:feedId,
      revision:1
    });
    return { feedId, contentKey, viewerCredential, envelope, workerUrl:SHARE_WORKER_URL };
  });
  const displayContext = await browser.newContext({ timezoneId:'Asia/Tokyo' });
  const displayPage = await displayContext.newPage();
  await displayPage.route(`${displayFixture.workerUrl}/v1/agendas/${displayFixture.feedId}`, route=>{
    route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{ ETag:'"1"' },
      body:JSON.stringify({
        id:displayFixture.feedId,
        status:'active',
        paused:false,
        revision:1,
        snapshot:displayFixture.envelope
      })
    });
  });
  const displayUrl = new URL('agenda-display', baseUrl);
  displayUrl.hash = `feed=${displayFixture.feedId}&key=${displayFixture.contentKey}&viewer=${displayFixture.viewerCredential}`;
  await displayPage.goto(displayUrl.href, { waitUntil:'load' });
  await displayPage.waitForFunction(() => document.getElementById('agenda-title')?.textContent === 'Timezone check');
  const displayState = await displayPage.evaluate(() => ({
    path:location.pathname,
    hash:location.hash,
    title:document.getElementById('agenda-title')?.textContent,
    firstTime:document.querySelector('.agenda-row time')?.textContent,
    appLoaded:Boolean(document.getElementById('app'))
  }));
  assert(displayState.path.endsWith('/agenda-display.html'), 'extensionless display route resolves to the standalone page');
  assert(displayState.hash === '', 'clears feed secrets from the address bar after enrollment');
  assert(displayState.title === 'Timezone check', 'standalone display decrypts and renders the feed');
  assert(/^9:00\s*AM/i.test(displayState.firstTime || ''), 'renders clock times in the owner timezone, not the viewer timezone');
  assert(displayState.appLoaded === false, 'standalone display does not load the main Tings app');
  await displayContext.close();

  const legacyConfig = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8')
    .replace(/\nconst SHARE_WORKER_PRODUCTION_URL[\s\S]*?const AGENDA_SHARE_DAYS = 2;\n/, '\n');
  const skewContext = await browser.newContext();
  const skewPage = await skewContext.newPage();
  const skewErrors = [];
  skewPage.on('pageerror', error=>skewErrors.push(String(error)));
  await skewPage.route('**/js/config.js', route=>route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:legacyConfig
  }));
  await skewPage.goto(baseUrl, { waitUntil:'load' });
  await skewPage.waitForFunction(() => typeof shareWorkerBaseUrl === 'function' && typeof agendaFeedRecord === 'function');
  await skewPage.waitForTimeout(100);
  const skewWorkerUrl = await skewPage.evaluate(() => shareWorkerBaseUrl());
  assert(skewErrors.every(message=>!/SHARE_STATE_KEY|SHARE_WORKER_URL|AGENDA_SHARE_DAYS/.test(message)), 'survives one-version cached config skew');
  assert(skewWorkerUrl.includes('habits-share-staging'), 'cached-config fallback keeps localhost on staging');
  await skewContext.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
