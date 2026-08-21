// Secure household agenda projection + QR-only display pairing.
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
  const ownerContext = await browser.newContext({
    viewport:{ width:390,height:844 },isMobile:true,hasTouch:true,serviceWorkers:'block'
  });
  const page = await ownerContext.newPage();
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
      { kind:'scheduled',start:now + 90 * 60000,end:now + 120 * 60000,h:{ ...completed,logs:[],lastLog:null },i:1 },
      ...extras.map((habit,index)=>({
        kind:'fill',start:now + (130 + index * 11) * 60000,end:now + (140 + index * 11) * 60000,
        h:habit,i:index + 2
      })),
      { kind:'blocked',start:now + 20 * 3600000,end:now + 21 * 3600000,label:'Deep Work Session Project Alpha' },
      { kind:'travel',start:now + 21 * 3600000,end:now + 21.25 * 3600000,fromName:'Home',toName:'Clinic' }
    ];
    const week = {
      optimized:true,plannerSolveStatus:'optimal',days:[
        { dayBase,dayKey:dateKey(dayBase),weekday:new Date(dayBase).getDay(),isToday:true,usedMinutes:45,remainingMinutes:30,timeline },
        { dayBase:dayBase + 86400000,dayKey:dateKey(dayBase + 86400000),weekday:new Date(dayBase + 86400000).getDay(),isToday:false,usedMinutes:0,remainingMinutes:120,timeline:[] },
        { dayBase:dayBase + 2 * 86400000,dayKey:dateKey(dayBase + 2 * 86400000),timeline:[] }
      ]
    };
    const feed = { feedId:'abcd'.repeat(8),title:'Family',lastRevision:3,scopeMode:'count',scopeValue:10 };
    const projection = buildHouseholdAgendaProjection(week,{ feed,data,now,dayCount:7 });
    const maxProjection = buildHouseholdAgendaProjection(week,{ feed:{ ...feed,scopeValue:50 },data,now,dayCount:2 });
    const hourProjection = buildHouseholdAgendaProjection(week,{ feed:{ ...feed,scopeMode:'hours',scopeValue:2 },data,now,dayCount:2 });
    const json = JSON.stringify(projection);

    const key = shareRandomHex(32);
    const envelope = await shareEncrypt(key,projection,{
      schemaVersion:1,recordKind:'agenda_snapshot',objectId:projection.feedId,revision:projection.revision
    });
    const back = await shareDecrypt(key,envelope);
    let tamperRejected = false;
    try{ await shareDecrypt(key,{ ...envelope,ciphertext:btoa('tampered') }); }
    catch(_){ tamperRejected = true; }

    const pairing = await shareNewAgendaPairingRequest();
    const transfer = await shareAgendaPairEncrypt(key,projection.feedId,pairing.pairingId,pairing.displayPublicKey);
    const transferredKey = await shareAgendaPairDecrypt(
      transfer,pairing.privateKey,projection.feedId,pairing.pairingId
    );
    let wrongDisplayRejected = false;
    try{
      const other = await shareNewAgendaPairingRequest();
      await shareAgendaPairDecrypt(transfer,other.privateKey,projection.feedId,pairing.pairingId);
    }catch(_){ wrongDisplayRejected = true; }

    return {
      dayCount:projection.days.length,
      titles:projection.days.flatMap(day=>day.rows.map(row=>row.title)),
      itemCount:projection.days.flatMap(day=>day.rows).filter(row=>row.kind === 'item').length,
      maxRows:maxProjection.days.reduce((sum,day)=>sum + day.rows.length,0),
      hourTitles:hourProjection.days.flatMap(day=>day.rows.map(row=>row.title)),
      json,provenance:projection.plannerProvenance,
      crypto:{
        title:back.title,tamperRejected,
        codeLength:shareNormalizeAgendaPairCode(pairing.confirmationCode).length,
        proofLooksHashed:/^[0-9a-f]{64}$/.test(pairing.confirmationProof),
        transferMatches:transferredKey === key,
        wrongDisplayRejected,
        rawCredentialHidden:pairing.deviceCredentialHash !== pairing.deviceCredential
      }
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
  assert(result.crypto.tamperRejected,'tampered agenda ciphertext is rejected');
  assert(result.crypto.codeLength === 8 && result.crypto.proofLooksHashed,'uses a separate 8-digit display code and stores only its proof');
  assert(result.crypto.transferMatches,'ECDH transfers the content key to the exact display key');
  assert(result.crypto.wrongDisplayRejected,'a different display private key cannot decrypt the transfer');
  assert(result.crypto.rawCredentialHidden,'display device credential is represented to the Worker only by its hash');

  let createRequestBody = null;
  await page.route('**/v1/agendas',async route=>{
    createRequestBody = route.request().postDataJSON();
    route.fulfill({ status:201,contentType:'application/json',body:JSON.stringify({ id:createRequestBody.id,status:'active',revision:0 }) });
  });
  const ownerFeed = await page.evaluate(async () => {
    saveAgendaFeedRecord(null);
    return createHouseholdAgendaFeed('Secure family agenda');
  });
  assert(createRequestBody && !('viewerCredential' in createRequestBody),'feed creation never registers a permanent viewer credential');
  assert(ownerFeed.currentInvite === undefined,'owner creates no enrollment link or fallback code');
  assert(ownerFeed.reauthDays === 30,'display reauthorization defaults to 30 days');

  const displayContext = await browser.newContext({ timezoneId:'Asia/Tokyo',serviceWorkers:'block' });
  const displayPage = await displayContext.newPage();
  let pairingRequest = null;
  let approvalRequest = null;
  let publishedSnapshot = null;
  let agendaReads = 0;
  let displayAuthorized = true;
  const workerUrl = await page.evaluate(()=>shareWorkerBaseUrl());

  await displayPage.route(`${workerUrl}/v1/agenda-pairings`,async route=>{
    pairingRequest = route.request().postDataJSON();
    route.fulfill({ status:201,contentType:'application/json',body:JSON.stringify({
      pairingId:pairingRequest.pairingId,expiresAt:Date.now() + 30 * 1000
    }) });
  });
  await displayPage.route(`${workerUrl}/v1/agenda-pairings/*/status`,route=>{
    if(!approvalRequest){
      route.fulfill({ status:202,contentType:'application/json',body:JSON.stringify({ state:'pending',expiresAt:Date.now() + 60000 }) });
      return;
    }
    route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
      state:'approved',feedId:ownerFeed.feedId,sessionExpiresAt:Date.now() + 30 * 86400000,
      transfer:approvalRequest.transfer,expiresAt:Date.now() + 60000
    }) });
  });
  await displayPage.route(`${workerUrl}/v1/agenda-pairings/*/consume`,route=>{
    route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({ consumed:true }) });
  });
  await displayPage.route(`${workerUrl}/v1/agendas/${ownerFeed.feedId}`,route=>{
    agendaReads += 1;
    if(!displayAuthorized){
      route.fulfill({ status:401,contentType:'application/json',body:JSON.stringify({ error:'reauth_required' }) });
      return;
    }
    route.fulfill({ status:200,contentType:'application/json',headers:{ ETag:'"1"' },body:JSON.stringify({
      id:ownerFeed.feedId,status:'active',paused:false,revision:1,
      sessionExpiresAt:Date.now() + 30 * 86400000,snapshot:publishedSnapshot
    }) });
  });
  await displayPage.goto(new URL('agenda-display',baseUrl).href,{ waitUntil:'load' });
  await displayPage.waitForFunction(()=>document.getElementById('agenda-pair-code')?.textContent.length === 9);
  const displayCode = await displayPage.textContent('#agenda-pair-code');
  assert(pairingRequest && !JSON.stringify(pairingRequest).includes(displayCode.replace('-','')),'QR request does not send or encode the visible confirmation code');
  assert(agendaReads === 0,'an unapproved QR request cannot read the agenda');

  await page.route('**/v1/agenda-pairings/**',route=>{
    if(route.request().url().endsWith('/approve')){
      approvalRequest = route.request().postDataJSON();
      if(approvalRequest.confirmationCode !== displayCode.replace('-','')){
        route.fulfill({ status:401,contentType:'application/json',body:JSON.stringify({ error:'invalid_confirmation' }) });
        return;
      }
      route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
        state:'approved',sessionExpiresAt:Date.now() + 30 * 86400000
      }) });
      return;
    }
    route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
      pairingId:pairingRequest.pairingId,displayPublicKey:pairingRequest.displayPublicKey,expiresAt:Date.now() + 60000
    }) });
  });
  await page.route(`${workerUrl}/v1/agendas/${ownerFeed.feedId}`,route=>{
    if(route.request().method() === 'PUT'){
      publishedSnapshot = route.request().postDataJSON().snapshot;
      route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
        id:ownerFeed.feedId,status:'active',paused:false,revision:publishedSnapshot.revision
      }) });
      return;
    }
    route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
      id:ownerFeed.feedId,status:'active',paused:false,revision:0,snapshot:null,sessionExpiresAt:null
    }) });
  });

  const ownerPairUrl = new URL(baseUrl);
  ownerPairUrl.hash = new URLSearchParams({
    agendaPair:pairingRequest.pairingId,x:pairingRequest.displayPublicKey.x,y:pairingRequest.displayPublicKey.y
  }).toString();
  const scannerChecks = await page.evaluate(validUrl=>{
    const crossOrigin = new URL(validUrl);
    crossOrigin.hostname = 'attacker.example';
    const queryBearing = new URL(validUrl);
    queryBearing.search = '?redirect=1';
    const wrongPath = new URL(validUrl);
    wrongPath.pathname += 'agenda-display.html';
    return {
      button:Boolean(document.getElementById('settings-agenda-scan-qr')),
      modal:Boolean(document.getElementById('agenda-pair-scanner')),
      decoder:typeof jsQR === 'function',
      valid:Boolean(parseHouseholdAgendaPairingUrl(validUrl)),
      rejectsCrossOrigin:parseHouseholdAgendaPairingUrl(crossOrigin.href) === null,
      rejectsQuery:parseHouseholdAgendaPairingUrl(queryBearing.href) === null,
      rejectsWrongPath:parseHouseholdAgendaPairingUrl(wrongPath.href) === null,
      before:location.href
    };
  },ownerPairUrl.href);
  assert(scannerChecks.button && scannerChecks.modal && scannerChecks.decoder,'installed Tings includes an offline in-app QR scanner');
  assert(scannerChecks.valid && scannerChecks.rejectsCrossOrigin && scannerChecks.rejectsQuery && scannerChecks.rejectsWrongPath,'scanner accepts only an exact same-origin Tings pairing URL');
  const scannerLifecycle = await page.evaluate(async ()=>{
    const original = navigator.mediaDevices.getUserMedia;
    const canvas = document.createElement('canvas');
    const stream = canvas.captureStream(1);
    const video = document.getElementById('agenda-pair-scanner-video');
    const originalPlay = video.play;
    video.play = async ()=>{};
    let requested = null;
    navigator.mediaDevices.getUserMedia = async constraints=>{
      requested = constraints;
      return stream;
    };
    try{
      const started = await startHouseholdAgendaQrScanner();
      const visibleWhileActive = !document.getElementById('agenda-pair-scanner').hidden;
      stopHouseholdAgendaQrScanner();
      return {
        started,visibleWhileActive,
        noAudio:requested && requested.audio === false,
        rearCamera:requested && requested.video && requested.video.facingMode.ideal === 'environment',
        stopped:stream.getTracks().every(track=>track.readyState === 'ended'),
        hiddenAfterStop:document.getElementById('agenda-pair-scanner').hidden
      };
    }finally{
      navigator.mediaDevices.getUserMedia = original;
      video.play = originalPlay;
    }
  });
  assert(scannerLifecycle.started && scannerLifecycle.visibleWhileActive && scannerLifecycle.noAudio && scannerLifecycle.rearCamera,'scanner requests only the rear-facing camera and never requests microphone access');
  assert(scannerLifecycle.stopped && scannerLifecycle.hiddenAfterStop,'closing the scanner stops its camera track immediately');
  const externalCameraRejected = await page.evaluate(url=>{
    history.replaceState(null,'',url);
    rejectExternalHouseholdAgendaPairingHash();
    const status = document.getElementById('agenda-pair-scanner-status').textContent;
    const approvalHidden = document.getElementById('agenda-pair-approval').hidden;
    stopHouseholdAgendaQrScanner();
    return location.hash === '' && approvalHidden && /cannot authorize/i.test(status);
  },ownerPairUrl.href);
  assert(externalCameraRejected,'a system-Camera link is rejected instead of becoming a browser approval fallback');
  const handledInApp = await page.evaluate(url=>handleHouseholdAgendaScannedValue(url),ownerPairUrl.href);
  await page.waitForSelector('#agenda-pair-approval:not([hidden])');
  await page.waitForFunction(()=>!document.getElementById('agenda-pair-approval-code')?.disabled
    || /expired|failed|does not own/i.test(document.getElementById('agenda-pair-approval-status')?.textContent || ''));
  const afterScanLocation = await page.evaluate(()=>location.href);
  assert(handledInApp && afterScanLocation === scannerChecks.before,'in-app scanning opens approval without navigating out of the installed PWA');
  await page.evaluate(() => {
    const now = Date.now();
    const base = dayStart(now);
    weekSnapshotForExport = () => ({ optimized:false,days:[{
      dayBase:base,dayKey:dateKey(base),isToday:true,usedMinutes:30,remainingMinutes:0,
      timeline:[{ kind:'scheduled',start:now + 3600000,end:now + 5400000,h:{
        name:'Medication',emoji:'💊',hid:'med',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
      }}]
    }] });
  });
  assert(approvalRequest === null,'in-app scanning still requires explicit owner approval');
  await page.fill('#agenda-pair-approval-code','0000-0000');
  await page.click('#agenda-pair-approval-confirm');
  await page.waitForFunction(()=>document.getElementById('agenda-pair-approval-status')?.textContent.includes('did not match'));
  assert(approvalRequest && approvalRequest.confirmationCode === '00000000','owner submits the manually entered display code for exact server verification');

  approvalRequest = null;
  await page.fill('#agenda-pair-approval-code',displayCode);
  await page.click('#agenda-pair-approval-confirm');
  await page.waitForFunction(()=>document.getElementById('agenda-pair-approval-status')?.textContent.includes('Display authorized'));
  assert(approvalRequest && !JSON.stringify(approvalRequest).includes(ownerFeed.contentKey),'owner rotates the content key and sends it only inside the ECDH ciphertext');
  assert(publishedSnapshot && publishedSnapshot.recordKind === 'agenda_snapshot','owner publishes a fresh snapshot under the rotated key');

  await displayPage.evaluate(()=>pollDisplayPairing());
  await displayPage.waitForFunction(()=>document.getElementById('agenda-title')?.textContent === 'Secure family agenda');
  const displayState = await displayPage.evaluate(() => ({
    path:location.pathname,hash:location.hash,title:document.getElementById('agenda-title')?.textContent,
    appLoaded:Boolean(document.getElementById('app')),
    enrollment:localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v3') || ''
  }));
  assert(displayState.path.endsWith('/agenda-display.html'),'extensionless route resolves to the standalone display');
  assert(displayState.hash === '','display address contains no enrollment secret');
  assert(!displayState.enrollment.includes(displayCode.replace('-','')) && !displayState.enrollment.includes(pairingRequest.pairingId),'display retains neither visible code nor pairing id');
  assert(displayState.title === 'Secure family agenda' && !displayState.appLoaded,'standalone display decrypts the feed without loading the main app');

  displayAuthorized = false;
  await displayPage.evaluate(()=>refreshDisplay());
  const clearedState = await displayPage.evaluate(() => ({
    text:document.getElementById('agenda-root')?.textContent || '',
    enrollment:localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v3'),
    pairingVisible:!document.getElementById('agenda-enroll')?.hidden
  }));
  assert(clearedState.enrollment === null && !clearedState.text.includes('Medication'),'reauthorization failure erases the cached credential, key, and agenda');
  assert(clearedState.pairingVisible,'expired access immediately returns to QR reauthorization');
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
