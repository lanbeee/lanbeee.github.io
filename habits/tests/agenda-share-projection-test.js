// Secure household agenda projection + one-time display enrollment.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-share-projection-test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390,height:844 },isMobile:true,hasTouch:true });
  await page.goto(baseUrl,{ waitUntil:'load' });

  const result = await page.evaluate(async () => {
    const now = Date.now();
    const dayBase = dayStart(now);
    const active = {
      name:'Medication',emoji:'💊',hid:'active-hid',type:'keepup',target:1,
      logs:[],lastLog:null,breakable:false,durationMinutes:30,locationIds:[]
    };
    const completed = {
      name:'Already logged',emoji:'✅',hid:'completed-hid',type:'keepup',target:1,
      logs:[now],lastLog:now,breakable:false,durationMinutes:30,locationIds:[]
    };
    const extras = Array.from({ length:60 },(_,index)=>({
      name:`Extra ${index + 1}`,emoji:'',hid:`extra-${index}`,type:'keepup',target:1,
      logs:[],lastLog:null,breakable:false,durationMinutes:10,locationIds:[]
    }));
    const data = [active,completed,...extras];
    const timeline = [
      { kind:'scheduled',start:now + 60 * 60000,end:now + 90 * 60000,h:{ ...active,notes:'stale private row' },i:0,locationId:'home' },
      // The stale planner row says incomplete, while fresh storage says logged.
      { kind:'scheduled',start:now + 90 * 60000,end:now + 120 * 60000,h:{ ...completed,logs:[],lastLog:null },i:1 },
      ...extras.map((habit,index)=>({
        kind:'fill',start:now + (130 + index * 11) * 60000,end:now + (140 + index * 11) * 60000,
        h:habit,i:index + 2
      })),
      { kind:'blocked',start:now + 20 * 3600000,end:now + 21 * 3600000,label:'Deep Work Session Project Alpha' },
      { kind:'travel',start:now + 21 * 3600000,end:now + 21.25 * 3600000,fromName:'Home',toName:'Clinic' }
    ];
    const week = {
      optimized:true,
      plannerSolveStatus:'optimal',
      days:[
        { dayBase,dayKey:dateKey(dayBase),weekday:new Date(dayBase).getDay(),isToday:true,usedMinutes:45,remainingMinutes:30,timeline },
        { dayBase:dayBase + 86400000,dayKey:dateKey(dayBase + 86400000),weekday:new Date(dayBase + 86400000).getDay(),isToday:false,usedMinutes:0,remainingMinutes:120,timeline:[] },
        { dayBase:dayBase + 2 * 86400000,dayKey:dateKey(dayBase + 2 * 86400000),timeline:[] }
      ]
    };
    const feed = { feedId:'abcd'.repeat(8),title:'Family',lastRevision:3,scopeMode:'count',scopeValue:10 };
    const projection = buildHouseholdAgendaProjection(week,{ feed,data,now,dayCount:7 });
    const maxProjection = buildHouseholdAgendaProjection(week,{
      feed:{ ...feed,scopeValue:50 },data,now,dayCount:2
    });
    const hourProjection = buildHouseholdAgendaProjection(week,{
      feed:{ ...feed,scopeMode:'hours',scopeValue:2 },data,now,dayCount:2
    });
    const json = JSON.stringify(projection);
    const cryptoBundle = await (async () => {
      const key = shareRandomHex(32);
      const envelope = await shareEncrypt(key,projection,{
        schemaVersion:1,recordKind:'agenda_snapshot',objectId:projection.feedId,revision:projection.revision
      });
      const back = await shareDecrypt(key,envelope);
      let tamper = false;
      try{ await shareDecrypt(key,{ ...envelope,ciphertext:btoa('tampered') }); tamper = true; }
      catch(_){ tamper = false; }
      const inviteId = shareRandomHex(16);
      const code = shareNewAgendaCode();
      const wrapped = await shareAgendaWrapKey(key,projection.feedId,inviteId,code);
      const unwrapped = await shareAgendaUnwrapKey(wrapped,projection.feedId,inviteId,code);
      let wrongCodeRejected = false;
      try{ await shareAgendaUnwrapKey(wrapped,projection.feedId,inviteId,'ZZZZZ-ZZZZZ'); }
      catch(_){ wrongCodeRejected = true; }
      return {
        title:back.title,revision:back.revision,tamper,codeLength:shareNormalizeAgendaCode(code).length,
        unwrapMatches:unwrapped === key,wrongCodeRejected
      };
    })();
    return {
      dayCount:projection.days.length,
      titles:projection.days.flatMap(day=>day.rows.map(row=>row.title)),
      itemCount:projection.days.flatMap(day=>day.rows).filter(row=>row.kind === 'item').length,
      maxRows:maxProjection.days.reduce((sum,day)=>sum + day.rows.length,0),
      hourTitles:hourProjection.days.flatMap(day=>day.rows.map(row=>row.title)),
      json,
      provenance:projection.plannerProvenance,
      crypto:cryptoBundle
    };
  });

  console.log('\n--- Agenda share projection ---\n');
  assert(result.dayCount === 2,'hard-caps projection to today and tomorrow');
  assert(result.provenance === 'glpk-opt','maps optimal GLPK week to glpk-opt');
  assert(result.itemCount === 10,'next-activity scope caps projected habits');
  assert(result.maxRows <= 50,'hard-caps every snapshot at 50 total rows');
  assert(!result.titles.includes('Already logged'),'fresh logs remove a stale completed planner row');
  assert(!result.hourTitles.some(title=>title.startsWith('Extra')),'hours-ahead scope excludes later activity');
  assert(!result.json.includes('active-hid') && !result.json.includes('completed-hid'),'omits local habit ids');
  assert(!result.json.includes('stale private row'),'omits private local row fields');
  assert(result.crypto.title === 'Family','AES-GCM round-trip restores the projection');
  assert(result.crypto.tamper === false,'tampered agenda ciphertext is rejected');
  assert(result.crypto.codeLength === 10,'generates a 10-character human enrollment code');
  assert(result.crypto.unwrapMatches,'separate code unwraps the content key');
  assert(result.crypto.wrongCodeRejected,'wrong code cannot unwrap the content key');

  let createRequestBody = null;
  let inviteRequestBody = null;
  await page.route('**/v1/agendas',async route=>{
    createRequestBody = route.request().postDataJSON();
    route.fulfill({ status:201,contentType:'application/json',body:JSON.stringify({ id:createRequestBody.id,status:'active',revision:0 }) });
  });
  await page.route('**/v1/agendas/*/invite',async route=>{
    inviteRequestBody = route.request().postDataJSON();
    route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({ inviteId:inviteRequestBody.inviteId,expiresAt:Date.now() + 15 * 60000,sessionTtlMs:inviteRequestBody.sessionTtlMs })
    });
  });
  const ownerInvite = await page.evaluate(async () => {
    saveAgendaFeedRecord(null);
    const feed = await createHouseholdAgendaFeed('Secure family agenda');
    return {
      url:feed.currentInvite.url,
      code:feed.currentInvite.code,
      contentKey:feed.contentKey,
      ownerCredential:feed.ownerCredential,
      viewerCredential:feed.viewerCredential,
      reauthDays:feed.reauthDays
    };
  });
  const ownerInviteUrl = new URL(ownerInvite.url);
  assert(createRequestBody && !('viewerCredential' in createRequestBody),'feed creation never registers a permanent viewer credential');
  assert(inviteRequestBody && /^[0-9a-f]{64}$/.test(inviteRequestBody.enrollmentProof),'Worker receives only a derived enrollment proof');
  assert(ownerInviteUrl.hash.includes('invite=') && ownerInviteUrl.hash.includes('wrap='),'owner creates a wrapped one-time invitation URL');
  assert(!ownerInvite.url.includes(ownerInvite.contentKey) && !ownerInvite.url.includes(ownerInvite.ownerCredential),'invitation URL contains neither raw content key nor owner credential');
  assert(ownerInvite.viewerCredential === undefined,'owner state has no permanent viewer credential');
  assert(ownerInvite.reauthDays === 30,'display reauthorization defaults to 30 days');

  const displayFixture = await page.evaluate(async () => {
    const feedId = shareRandomHex(16);
    const inviteId = shareRandomHex(16);
    const contentKey = shareRandomHex(32);
    const code = shareNewAgendaCode();
    const wrapped = await shareAgendaWrapKey(contentKey,feedId,inviteId,code);
    const start = Date.UTC(2026,0,15,14,0,0);
    const projection = {
      schemaVersion:1,feedId,title:'Timezone check',revision:1,generatedAt:Date.now(),timezone:'America/New_York',
      days:[{ dateKey:'2026-01-15',weekdayLabel:'today',dateLabel:'Thursday, Jan 15',rows:[
        { kind:'item',start,end:start + 30 * 60000,title:'Breakfast',emoji:'',durationMinutes:30 }
      ] }]
    };
    const envelope = await shareEncrypt(contentKey,projection,{
      schemaVersion:1,recordKind:'agenda_snapshot',objectId:feedId,revision:1
    });
    const params = new URLSearchParams({ feed:feedId,invite:inviteId,salt:wrapped.salt,nonce:wrapped.nonce,wrap:wrapped.wrappedKey });
    return { feedId,inviteId,code,envelope,hash:params.toString(),workerUrl:shareWorkerBaseUrl() };
  });
  const displayContext = await browser.newContext({ timezoneId:'Asia/Tokyo' });
  const displayPage = await displayContext.newPage();
  let enrollRequests = 0;
  let agendaReads = 0;
  await displayPage.route(`${displayFixture.workerUrl}/v1/agendas/${displayFixture.feedId}/enroll`,async route=>{
    enrollRequests += 1;
    route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({ id:displayFixture.feedId,expiresAt:Date.now() + 7 * 86400000 })
    });
  });
  await displayPage.route(`${displayFixture.workerUrl}/v1/agendas/${displayFixture.feedId}`,route=>{
    agendaReads += 1;
    route.fulfill({
      status:200,contentType:'application/json',headers:{ ETag:'"1"' },
      body:JSON.stringify({
        id:displayFixture.feedId,status:'active',paused:false,revision:1,
        sessionExpiresAt:Date.now() + 7 * 86400000,snapshot:displayFixture.envelope
      })
    });
  });
  const displayUrl = new URL('agenda-display',baseUrl);
  displayUrl.hash = displayFixture.hash;
  await displayPage.goto(displayUrl.href,{ waitUntil:'load' });
  await displayPage.waitForSelector('#agenda-enroll:not([hidden])');
  assert(enrollRequests === 0 && agendaReads === 0,'link alone cannot enroll or read the feed');

  await displayPage.fill('#agenda-enroll-code','ZZZZZ-ZZZZZ');
  await displayPage.click('#agenda-enroll-form button');
  await displayPage.waitForFunction(()=>document.getElementById('agenda-enroll-status')?.textContent.includes('does not match'));
  assert(enrollRequests === 0,'wrong code fails locally without consuming a server attempt');

  await displayPage.fill('#agenda-enroll-code',displayFixture.code);
  await displayPage.click('#agenda-enroll-form button');
  await displayPage.waitForFunction(()=>document.getElementById('agenda-title')?.textContent === 'Timezone check');
  const displayState = await displayPage.evaluate(() => ({
    path:location.pathname,
    hash:location.hash,
    title:document.getElementById('agenda-title')?.textContent,
    firstTime:document.querySelector('.agenda-row time')?.textContent,
    appLoaded:Boolean(document.getElementById('app')),
    enrollment:localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v2') || ''
  }));
  assert(enrollRequests === 1 && agendaReads >= 1,'correct code enrolls once and then reads with a device credential');
  assert(displayState.path.endsWith('/agenda-display.html'),'extensionless route resolves to the standalone display');
  assert(displayState.hash === '','clears invitation material from the address bar after enrollment');
  assert(!displayState.enrollment.includes(displayFixture.code) && !displayState.enrollment.includes(displayFixture.inviteId),'does not retain the code or one-time invitation id');
  assert(displayState.title === 'Timezone check','standalone display decrypts and renders the feed');
  assert(/^9:00\s*AM/i.test(displayState.firstTime || ''),'renders clock times in the owner timezone');
  assert(displayState.appLoaded === false,'standalone display does not load the main Tings app');
  await displayContext.close();

  const legacyConfig = fs.readFileSync(path.join(__dirname,'../js/config.js'),'utf8')
    .replace(/\nconst SHARE_WORKER_PRODUCTION_URL[\s\S]*?const AGENDA_SHARE_DAYS = 2;\n/,'\n');
  const skewContext = await browser.newContext();
  const skewPage = await skewContext.newPage();
  const skewErrors = [];
  skewPage.on('pageerror',error=>skewErrors.push(String(error)));
  await skewPage.route('**/js/config.js',route=>route.fulfill({ status:200,contentType:'application/javascript',body:legacyConfig }));
  await skewPage.goto(baseUrl,{ waitUntil:'load' });
  await skewPage.waitForFunction(()=>typeof shareWorkerBaseUrl === 'function' && typeof agendaFeedRecord === 'function');
  await skewPage.waitForTimeout(100);
  const skewWorkerUrl = await skewPage.evaluate(()=>shareWorkerBaseUrl());
  assert(skewErrors.every(message=>!/SHARE_STATE_KEY|SHARE_WORKER_URL|AGENDA_SHARE_DAYS|AGENDA_DISPLAY_KEY/.test(message)),'survives one-version cached config skew');
  assert(skewWorkerUrl.includes('habits-share-staging'),'cached-config fallback keeps localhost on staging');
  await skewContext.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
