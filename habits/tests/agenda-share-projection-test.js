// Secure shared-display projection + QR-only display pairing.
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
  const cspViolations = [];
  page.on('console', msg => {
    const text = msg.text();
    if(/Content Security Policy/i.test(text))cspViolations.push(text);
  });
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
    const privateHabit = {
      name:'Private appointment',emoji:'🔒',hid:'private-hid',type:'task',target:null,
      logs:[],lastLog:null,breakable:false,durationMinutes:30,locationIds:[],showOnSharedDisplay:false
    };
    const extras = Array.from({ length:60 },(_,index)=>({
      name:`Extra ${index + 1}`,emoji:'',hid:`extra-${index}`,type:'keepup',target:1,
      logs:[],lastLog:null,breakable:false,durationMinutes:10,locationIds:[],
      allowSharedDisplayCompletion:index !== 0
    }));
    const data = [active,completed,privateHabit,...extras];
    const timeline = [
      { kind:'scheduled',start:now + 60 * 60000,end:now + 90 * 60000,h:{ ...active,notes:'stale private row' },i:0,locationId:'home' },
      { kind:'scheduled',start:now + 90 * 60000,end:now + 120 * 60000,h:{ ...completed,logs:[],lastLog:null },i:1 },
      { kind:'scheduled',start:now + 120 * 60000,end:now + 125 * 60000,h:privateHabit,i:2 },
      ...extras.map((habit,index)=>({
        kind:'fill',start:now + (130 + index * 11) * 60000,end:now + (140 + index * 11) * 60000,
        h:habit,i:index + 3
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
    const firstItem = projection.days.flatMap(day=>day.rows).find(row=>row.kind === 'item');
    const viewOnlyItem = projection.days.flatMap(day=>day.rows).find(row=>row.title === 'Extra 1');

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
      rowMapCount:Object.keys(projection._rowMap || {}).length,
      mappedHid:firstItem && projection._rowMap[firstItem.rowId] && projection._rowMap[firstItem.rowId].hid,
      completable:firstItem && firstItem.completable,
      viewOnlyCompletable:viewOnlyItem && viewOnlyItem.completable,
      viewOnlyMapped:Boolean(viewOnlyItem && projection._rowMap[viewOnlyItem.rowId]),
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
  assert(!result.titles.includes('Private appointment'),'an item-level privacy switch removes the item from the shared display');
  assert(!result.hourTitles.some(title=>title.startsWith('Extra')),'hours-ahead scope excludes later activity');
  assert(!result.json.includes('active-hid') && !result.json.includes('completed-hid'),'omits local habit ids');
  assert(result.rowMapCount > 0 && result.mappedHid === 'active-hid' && result.completable,'keeps the completion target only in the owner-side non-enumerable row map');
  assert(result.viewOnlyCompletable === false && !result.viewOnlyMapped,'view-only items are visible without a completion target or capability');
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
  let completionRequest = null;
  const completionRequests = [];
  // Fake server state: completions stay queued until the owner acks them, and
  // every agenda read returns the queue — that is what lets the display
  // rebuild its completionRowIds after a refresh.
  const serverCompletions = [];
  let completionGate = null;
  let completionResponseStatus = 201;
  let displayAuthorized = true;
  let displayPaused = false;
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
      id:ownerFeed.feedId,status:'active',paused:displayPaused,revision:1,
      sessionExpiresAt:Date.now() + 30 * 86400000,snapshot:publishedSnapshot,
      completions:serverCompletions.map(envelope=>({ createdAt:Date.now(),envelope }))
    }) });
  });
  await displayPage.route(`${workerUrl}/v1/agendas/${ownerFeed.feedId}/completions`,async route=>{
    completionRequest = route.request().postDataJSON();
    completionRequests.push(completionRequest);
    if(completionGate) await completionGate;
    // A 201 queues the completion server-side even if the display never learns
    // of it; a failure leaves the server queue untouched.
    if(completionResponseStatus === 201) serverCompletions.push(completionRequest.completion);
    route.fulfill({ status:completionResponseStatus,contentType:'application/json',body:JSON.stringify({
      operationId:completionRequest.completion.operationId,
      rowId:completionRequest.completion.logId,
      createdAt:Date.now()
    }) });
  });
  await displayPage.goto(new URL('agenda-display.html',baseUrl).href,{ waitUntil:'load' });
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
      timeline:[
        { kind:'scheduled',start:now + 3600000,end:now + 5400000,h:{
          name:'Medication',emoji:'💊',hid:'med',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
        }},
        { kind:'scheduled',start:now + 2 * 3600000,end:now + 2 * 3600000 + 1800000,h:{
          name:'Water plants',emoji:'🌱',hid:'water',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
        }},
        { kind:'scheduled',start:now + 4 * 3600000,end:now + 4 * 3600000 + 1800000,h:{
          name:'Tidy desk',emoji:'🧹',hid:'desk',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
        }},
        { kind:'scheduled',start:now + 6 * 3600000,end:now + 6 * 3600000 + 1800000,h:{
          name:'Stretch back',emoji:'🧘',hid:'stretch',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
        }}
      ]
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
  assert(displayState.path.endsWith('/agenda-display.html'),'canonical shared-display URL loads the standalone display');
  assert(displayState.hash === '','display address contains no enrollment secret');
  assert(!displayState.enrollment.includes(displayCode.replace('-','')) && !displayState.enrollment.includes(pairingRequest.pairingId),'display retains neither visible code nor pairing id');
  assert(displayState.title === 'Secure family agenda' && !displayState.appLoaded,'standalone display decrypts the feed without loading the main app');
  const fullscreenControl = await displayPage.evaluate(()=>({
    standaloneButton:Boolean(document.getElementById('agenda-fullscreen')),
    menuRowHidden:document.getElementById('agenda-menu-fullscreen-row')?.hidden,
    menuButtonLabel:(document.getElementById('agenda-menu-fullscreen')?.textContent || '').trim()
  }));
  assert(!fullscreenControl.standaloneButton && fullscreenControl.menuRowHidden === false && /full screen/i.test(fullscreenControl.menuButtonLabel),
    'fullscreen lives inside the ⋯ menu instead of a standalone header button when the browser supports it');

  await displayPage.click('[data-complete-row]');
  await displayPage.waitForSelector('.agenda-mark.is-done');
  const pendingUi = await displayPage.evaluate(() => ({
    done:Boolean(document.querySelector('.agenda-row.is-complete .agenda-mark.is-done')),
    toastVisible:!document.getElementById('agenda-undo').hidden,
    toastText:document.getElementById('agenda-undo-text')?.textContent || '',
    stored:JSON.parse(localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v3') || 'null')?.completionRowIds || []
  }));
  assert(pendingUi.done && pendingUi.toastVisible && /Marked .+ done/.test(pendingUi.toastText)
    && !pendingUi.stored.length && !completionRequest,
    'marking done renders the row optimistically behind an undo toast and does not push yet');

  await displayPage.click('#agenda-undo-button');
  const undoneUi = await displayPage.evaluate(() => ({
    done:Boolean(document.querySelector('.agenda-row.is-complete .agenda-mark.is-done')),
    toastVisible:!document.getElementById('agenda-undo').hidden,
    markable:Boolean(document.querySelector('[data-complete-row]')) && !document.querySelector('[data-complete-row]').disabled
  }));
  assert(!undoneUi.done && !undoneUi.toastVisible && undoneUi.markable && !completionRequest,
    'tapping undo within the window restores the row and no completion is ever sent');

  await displayPage.click('[data-complete-row]');
  await displayPage.waitForSelector('.agenda-mark.is-done');
  await displayPage.waitForTimeout(5600);
  const completionUi = await displayPage.evaluate(()=>({
    done:Boolean(document.querySelector('.agenda-row.is-complete .agenda-mark.is-done')),
    label:document.querySelector('.agenda-row.is-complete .agenda-mark.is-done')?.getAttribute('aria-label'),
    toastVisible:!document.getElementById('agenda-undo').hidden,
    stored:JSON.parse(localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v3') || 'null')?.completionRowIds || []
  }));
  assert(completionRequest && completionRequest.completion.recordKind === 'agenda_completion','the display submits only an encrypted completion envelope');
  assert(completionRequest.completion.revision === 1 && completionRequest.completion.logId.length === 16,'the completion is bound to the current snapshot and opaque displayed row');
  assert(completionUi.done && /is done/i.test(completionUi.label || '') && completionUi.stored.includes(completionRequest.completion.logId) && !completionUi.toastVisible,'once the undo window expires the display pushes the completion and keeps the row marked done');

  // The undo toast is position:fixed. The screen-fit squash transforms the
  // page content, and a transformed ancestor would otherwise become the
  // toast's containing block — re-anchoring and squashing it to the page box
  // instead of leaving it pinned to the real screen.
  await displayPage.evaluate(()=>{
    const settings = readAgendaAppearance();
    settings.squish = 85;
    writeAgendaAppearance(settings);
    applyAgendaAppearance(settings);
  });
  await displayPage.click('.agenda-day article.agenda-row:nth-of-type(2) [data-complete-row]');
  const squishedToast = await displayPage.evaluate(()=>{
    const toast = document.getElementById('agenda-undo');
    const rect = toast.getBoundingClientRect();
    return {
      squashed:getComputedStyle(document.getElementById('agenda-page')).transform !== 'none',
      visible:!toast.hidden,
      pinnedToViewport:rect.bottom <= window.innerHeight && rect.bottom >= window.innerHeight - 120,
      unsquashed:Math.abs(rect.height / toast.offsetHeight - 1) < 0.05
    };
  });
  await displayPage.click('#agenda-undo-button');
  await displayPage.evaluate(()=>{
    localStorage.removeItem('tings_agenda_appearance_v1');
    applyAgendaAppearance(readAgendaAppearance());
  });
  assert(squishedToast.squashed && squishedToast.visible && squishedToast.pinnedToViewport && squishedToast.unsquashed,
    `the undo toast stays pinned to the viewport at full height while screen fit squashes the page (${JSON.stringify(squishedToast)})`);

  // --- Undo robustness: flush, refresh races, pause, and de-pair races. ---
  completionRequests.length = 0;
  completionRequest = null;
  const waitForRoute = async condition => {
    for(let i = 0;i < 50;i++){
      if(condition()) return true;
      await displayPage.waitForTimeout(100);
    }
    return false;
  };
  const enrollmentKey = await displayPage.evaluate(
    "typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v3'"
  );
  const rowIds = await displayPage.evaluate(()=>[...document.querySelectorAll('[data-complete-row]')].map(b=>b.dataset.completeRow));
  const undoState = () => displayPage.evaluate(key=>({
    doneRows:document.querySelectorAll('.agenda-row.is-complete').length,
    toastVisible:!document.getElementById('agenda-undo').hidden,
    stored:JSON.parse(localStorage.getItem(key) || 'null')?.completionRowIds || []
  }),enrollmentKey);

  // Marking a second row must push the first one at once (one pending mark),
  // and undoing the newest mark must leave exactly the flushed push behind.
  await displayPage.click('.agenda-day article.agenda-row:nth-of-type(2) [data-complete-row]');
  let robustnessState = await undoState();
  assert(robustnessState.doneRows === 2 && robustnessState.toastVisible && !completionRequest,
    'a second mark stays pending behind its own undo toast');
  await displayPage.click('.agenda-day article.agenda-row:nth-of-type(3) [data-complete-row]');
  assert(await waitForRoute(()=>completionRequests.length === 1) && completionRequest.completion.logId === rowIds[1],
    'marking another row pushes the previous pending completion immediately');
  robustnessState = await undoState();
  assert(robustnessState.doneRows === 3 && robustnessState.toastVisible,'the flushed row stays done while the newest mark stays undoable');
  await displayPage.click('#agenda-undo-button');
  await displayPage.waitForTimeout(5600);
  robustnessState = await undoState();
  assert(completionRequests.length === 1 && robustnessState.doneRows === 2 && robustnessState.stored.length === 2 && !robustnessState.toastVisible,
    'undoing the newest mark never pushes it while the flushed one stays pushed');

  // A snapshot refresh during the undo window must keep the optimistic state
  // and still push the completion bound to the same snapshot revision.
  await displayPage.click('.agenda-day article.agenda-row:nth-of-type(4) [data-complete-row]');
  await displayPage.evaluate(()=>refreshDisplay());
  robustnessState = await undoState();
  assert(robustnessState.doneRows === 3 && robustnessState.toastVisible,'a refresh during the undo window keeps the row marked and the toast up');
  await displayPage.waitForTimeout(5600);
  assert(await waitForRoute(()=>completionRequests.length === 2) && completionRequest.completion.logId === rowIds[3]
    && completionRequest.completion.revision === 1 && (await undoState()).stored.length === 3,
    'after a mid-window refresh the delayed push still carries the displayed row and snapshot revision');

  // Pausing the display mid-window must drop the toast and never push.
  await displayPage.click('.agenda-day article.agenda-row:nth-of-type(3) [data-complete-row]');
  robustnessState = await undoState();
  assert(robustnessState.doneRows === 4 && robustnessState.toastVisible,'the unmarked row accepts a fresh pending mark');
  displayPaused = true;
  await displayPage.evaluate(()=>refreshDisplay());
  robustnessState = await undoState();
  // A paused display renders every row view-only, so the dropped mark must
  // also take the optimistic done styling with it.
  assert(!robustnessState.toastVisible && robustnessState.doneRows === 0,'pausing the display drops a pending mark, its toast, and the done styling');
  await displayPage.waitForTimeout(5600);
  assert(completionRequests.length === 2,'a pending mark dropped by a pause is never pushed');
  displayPaused = false;
  await displayPage.evaluate(()=>refreshDisplay());
  assert(await displayPage.evaluate(()=>Boolean(document.querySelector('.agenda-day article.agenda-row:nth-of-type(3) [data-complete-row]:not([disabled])'))),
    'unpausing makes the dropped row markable again');

  // Authorization cleared while the push is in flight: neither a 201 nor a
  // failure may resurrect the cleared enrollment or repaint the agenda.
  const enrollmentBeforeRace = await displayPage.evaluate(key=>localStorage.getItem(key),enrollmentKey);
  const raceCheck = () => displayPage.evaluate(key=>({
    enrollment:localStorage.getItem(key),
    rows:document.querySelectorAll('.agenda-row').length,
    toastVisible:!document.getElementById('agenda-undo').hidden
  }),enrollmentKey);
  for(const raceStatus of [500,201]){
    completionResponseStatus = raceStatus;
    const pushesBefore = completionRequests.length;
    let gateRelease;
    completionGate = new Promise(resolve=>{ gateRelease = resolve; });
    await displayPage.click('.agenda-day article.agenda-row:nth-of-type(3) [data-complete-row]');
    await displayPage.waitForTimeout(5600);
    await displayPage.waitForSelector('.agenda-mark.is-saving');
    assert(await waitForRoute(()=>completionRequests.length === pushesBefore + 1),'the delayed push is in flight');
    await displayPage.evaluate(()=>{
      window.__origBeginDisplayPairing = beginDisplayPairing;
      beginDisplayPairing = async ()=>{};
      clearDisplayAuthorization('reauth');
    });
    let raceState = await raceCheck();
    assert(raceState.enrollment === null && raceState.rows === 0 && !raceState.toastVisible,'clearing authorization mid-push removes the enrollment and the agenda');
    gateRelease();
    completionGate = null;
    await displayPage.waitForTimeout(300);
    raceState = await raceCheck();
    assert(raceState.enrollment === null && raceState.rows === 0,
      `a push finishing ${raceStatus === 201 ? 'successfully' : 'in failure'} after de-pairing does not resurrect the enrollment or repaint the agenda`);
    await displayPage.evaluate(()=>{ beginDisplayPairing = window.__origBeginDisplayPairing; });
    await displayPage.evaluate(({ key,enrollment })=>{
      localStorage.setItem(key,enrollment);
      _displayFeed = JSON.parse(enrollment);
      return refreshDisplay();
    },{ key:enrollmentKey,enrollment:enrollmentBeforeRace });
  }
  completionResponseStatus = 201;
  robustnessState = await undoState();
  assert(robustnessState.doneRows === 4 && robustnessState.stored.length === 4 && !robustnessState.toastVisible,
    `the display recovers normally once the enrollment is restored after the de-pair races (${JSON.stringify(robustnessState)})`);

  // A hung push must hit the deadline and surface as a retryable error
  // instead of leaving the row in the saving state forever.
  await displayPage.route('**/hang-forever',()=>{});
  const hungFetch = await displayPage.evaluate(async ()=>{
    try{
      await shareFetch('/v1/hang-forever',{ credential:'probe',timeoutMs:150 });
      return { threw:false };
    }catch(error){
      return { threw:true,timedOut:Boolean(error && error.timedOut),code:error && error.message };
    }
  });
  await displayPage.unroute('**/hang-forever');
  assert(hungFetch.threw && hungFetch.timedOut && hungFetch.code === 'share_timeout',
    `a hung push aborts at the deadline into a retryable error instead of pending forever (${JSON.stringify(hungFetch)})`);

  const displayPresentation = await displayPage.evaluate(() => {
    const rowTime = document.querySelector('.agenda-row time');
    const firstRow = document.querySelector('.agenda-row');
    const rowChildren = firstRow ? [...firstRow.children].map(child=>child.className || child.tagName.toLowerCase()) : [];
    const startLine = rowTime ? rowTime.querySelector('.agenda-time-start') : null;
    const endLine = rowTime ? rowTime.querySelector('.agenda-time-end') : null;
    const hide = document.getElementById('agenda-hide');
    hide.click();
    const wallpaper = document.getElementById('agenda-wallpaper');
    const hiddenAfterTap = !wallpaper.hidden && document.getElementById('agenda-page').hidden;
    wallpaper.click();
    wallpaper.click();
    const stillHiddenAfterTwoTaps = !wallpaper.hidden;
    wallpaper.click();
    return {
      columnStack:rowTime ? getComputedStyle(rowTime).flexDirection === 'column' : false,
      startCopy:startLine ? startLine.textContent : '',
      endCopy:endLine ? endLine.textContent : '',
      endSmallerThanStart:Boolean(startLine && endLine) &&
        parseFloat(getComputedStyle(startLine).fontSize) > parseFloat(getComputedStyle(endLine).fontSize),
      clockCopy:(document.getElementById('agenda-clock')?.textContent || '').trim(),
      rowChildren,
      hiddenAfterTap,
      stillHiddenAfterTwoTaps,
      restoredAfterTripleTap:wallpaper.hidden && !document.getElementById('agenda-page').hidden,
      wallpaperPreferenceCleared:localStorage.getItem('tings_agenda_wallpaper_v1') === null
    };
  });
  assert(/\d{1,2}:\d{2}/.test(displayPresentation.startCopy) && /^→ \d{1,2}:\d{2}/.test(displayPresentation.endCopy),'the start time leads and the end time follows it on its own muted line');
  assert(displayPresentation.columnStack && displayPresentation.endSmallerThanStart,'the end time renders below the start time in a smaller size');
  assert(/\d{1,2}:\d{2}/.test(displayPresentation.clockCopy),'the agenda header shows the current time');
  assert(/^agenda-mark/.test(displayPresentation.rowChildren[0] || '') && displayPresentation.rowChildren[1] === 'agenda-row-copy' && displayPresentation.rowChildren[2] === 'time','shared rows follow the Tings order: emoji, item copy, then schedule time');
  assert(displayPresentation.hiddenAfterTap && displayPresentation.stillHiddenAfterTwoTaps && displayPresentation.restoredAfterTripleTap && displayPresentation.wallpaperPreferenceCleared,
    'one tap hides the agenda and three taps on the night clock restore it and clear the persisted privacy screen');

  const displaySwipe = await displayPage.evaluate(async () => {
    if(typeof TouchEvent !== 'function' || typeof Touch !== 'function') return { skipped:true };
    const make = (x,y) => {
      try{ return new Touch({ identifier:1,target:document.body,clientX:x,clientY:y }); }
      catch(_){ return null; }
    };
    const swipe = (fromX,toX) => {
      const start = make(fromX,300);
      const end = make(toX,300);
      if(!start || !end) return false;
      document.body.dispatchEvent(new TouchEvent('touchstart',{ touches:[start],bubbles:true }));
      document.body.dispatchEvent(new TouchEvent('touchend',{ changedTouches:[end],bubbles:true }));
      return true;
    };
    if(!swipe(420,140)) return { skipped:true };
    const wallpaper = document.getElementById('agenda-wallpaper');
    const agendaPage = document.getElementById('agenda-page');
    const nightShown = !wallpaper.hidden && agendaPage.hidden;
    if(!swipe(140,420)) return { skipped:true };
    const stillHiddenAfterSwipeRight = !wallpaper.hidden && agendaPage.hidden;
    setDisplayWallpaper(false,{ focus:false });
    return { skipped:false,nightShown,stillHiddenAfterSwipeRight,restored:wallpaper.hidden };
  });
  assert(displaySwipe.skipped || (displaySwipe.nightShown && displaySwipe.stillHiddenAfterSwipeRight && displaySwipe.restored),
    'swiping left hides the agenda behind the night clock and a swipe never brings it back');

  const displaySettings = await displayPage.evaluate(() => {
    const storedBefore = JSON.parse(localStorage.getItem('tings_agenda_appearance_v1') || 'null');
    const defaultDark = document.documentElement.dataset.theme === 'dark';
    const moreLabel = (document.getElementById('agenda-more').textContent || '').trim();
    document.getElementById('agenda-more').click();
    const menu = document.getElementById('agenda-menu');
    const opened = !menu.hidden && document.getElementById('agenda-more').getAttribute('aria-expanded') === 'true';
    document.querySelector('[data-theme-opt="light"]').click();
    const lightApplied = document.documentElement.dataset.theme === 'light';
    const fontBefore = document.documentElement.dataset.font;
    document.getElementById('agenda-font-plus').click();
    const fontStepped = {
      applied:document.documentElement.dataset.font,
      stored:JSON.parse(localStorage.getItem('tings_agenda_appearance_v1') || 'null')?.font
    };
    document.getElementById('agenda-font-minus').click();
    document.getElementById('agenda-fit-minus').click();
    const fitStepped = {
      applied:document.documentElement.dataset.squish,
      squashed:getComputedStyle(document.getElementById('agenda-page')).transform !== 'none'
    };
    document.getElementById('agenda-fit-plus').click();
    const fitRestored = document.documentElement.dataset.squish === '100' && getComputedStyle(document.getElementById('agenda-page')).transform === 'none';
    return {
      nothingStored:!storedBefore,defaultDark,moreLabel,fontBefore,
      opened,lightApplied,fontStepped,fitStepped,fitRestored,
      persistedTheme:JSON.parse(localStorage.getItem('tings_agenda_appearance_v1') || 'null')?.theme
    };
  });
  assert(displaySettings.nothingStored && displaySettings.defaultDark && displaySettings.opened && displaySettings.lightApplied &&
    displaySettings.persistedTheme === 'light' && displaySettings.moreLabel === '⋯' &&
    displaySettings.fontBefore === '100' && displaySettings.fontStepped.applied === '105' && displaySettings.fontStepped.stored === 105 &&
    displaySettings.fitStepped.applied === '99' && displaySettings.fitStepped.squashed && displaySettings.fitRestored,
    'fresh displays default to dark at 100% text; the ⋯ menu switches theme and the − / + steppers adjust text size and screen fit');

  const toggleFullscreenFromMenu = async () => {
    await displayPage.click('#agenda-menu-fullscreen');
    try{ await displayPage.waitForFunction(() => document.fullscreenElement !== null,null,{ timeout:3000 }); }catch(_){}
    const on = await displayPage.evaluate(()=>({
      pressed:document.getElementById('agenda-menu-fullscreen').getAttribute('aria-pressed'),
      active:document.fullscreenElement !== null
    }));
    await displayPage.click('#agenda-menu-fullscreen');
    try{ await displayPage.waitForFunction(() => document.fullscreenElement === null,null,{ timeout:3000 }); }catch(_){}
    const off = await displayPage.evaluate(()=>({
      pressed:document.getElementById('agenda-menu-fullscreen').getAttribute('aria-pressed'),
      active:document.fullscreenElement === null
    }));
    return { on,off };
  };
  const displayFullscreen = await toggleFullscreenFromMenu();
  assert(displayFullscreen.on.pressed === 'true' && displayFullscreen.on.active &&
    displayFullscreen.off.pressed === 'false' && displayFullscreen.off.active,
    'the ⋯ menu fullscreen control enters and leaves fullscreen');

  await displayPage.click('#agenda-updated');
  const menuClosedAfterOutsideClick = await displayPage.evaluate(()=>document.getElementById('agenda-menu').hidden);
  assert(menuClosedAfterOutsideClick,'clicking outside the ⋯ menu closes it');

  const inboundSync = await page.evaluate(async ()=>{
    const now = Date.now();
    const contentKey = shareRandomHex(32);
    const feedId = 'face'.repeat(8);
    const ownerCredential = 'ab'.repeat(32);
    const rowId = '12'.repeat(8);
    const operationId = '34'.repeat(16);
    const habit = normalize([{
      hid:'shared-completion-hid',name:'Fridge task',type:'task',logs:[],lastLog:null,
      durationMinutes:20,breakable:false,showOnSharedDisplay:true
    }])[0];
    save([habit]);
    const feed = {
      feedId,contentKey,ownerCredential,lastRevision:4,title:'Shared display',
      rowMaps:[{ revision:4,rows:{ [rowId]:{ hid:habit.hid,dayBase:dayStart(now),start:now,minutes:20 } } }]
    };
    saveAgendaFeedRecord(feed);
    const payload = { schemaVersion:1,action:'complete',operationId,rowId };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:4,operationId,logId:rowId
    });
    const original = shareFetch;
    shareFetch = async ()=>({ body:{ revision:4,completions:[{ createdAt:now,envelope }] } });
    _agendaCompletionSyncAt = 0;
    try{
      const synced = await syncHouseholdAgendaCompletions(feed,{ force:true });
      const saved = load()[0];
      const log = normalizeLogs(saved.logs).find(entry=>entry && typeof entry === 'object' && entry.operationId === operationId);
      return {
        changed:synced.changed,
        ack:synced.operationIds.includes(operationId),
        done:isTaskDone(saved),
        source:log && log.source,
        rowExcluded:synced.completedRowKeys.has(`${habit.hid}|${now}`)
      };
    }finally{
      shareFetch = original;
    }
  });
  assert(inboundSync.changed && inboundSync.ack && inboundSync.done,'the owner turns an authenticated display completion into a real local task completion');
  assert(inboundSync.source === 'shared_display' && inboundSync.rowExcluded,`the imported log is idempotently tagged and its old displayed row is suppressed during republish (${JSON.stringify(inboundSync)})`);

  const corruptInbound = await page.evaluate(async ()=>{
    const now = Date.now();
    const contentKey = shareRandomHex(32);
    const feedId = 'bead'.repeat(8);
    const ownerCredential = 'cd'.repeat(32);
    const rowId = '56'.repeat(8);
    const operationId = '78'.repeat(16);
    const habit = normalize([{
      hid:'corrupt-completion-hid',name:'Still visible',type:'keepup',target:7,logs:[],lastLog:null,
      durationMinutes:15,breakable:false,showOnSharedDisplay:true
    }])[0];
    save([habit]);
    const feed = {
      feedId,contentKey,ownerCredential,lastRevision:9,title:'Shared display',
      rowMaps:[{ revision:9,rows:{ [rowId]:{ hid:habit.hid,dayBase:dayStart(now),start:now,minutes:15 } } }]
    };
    saveAgendaFeedRecord(feed);
    const payload = { schemaVersion:1,action:'complete',operationId,rowId };
    const encrypted = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:9,operationId,logId:rowId
    });
    const tail = encrypted.ciphertext.slice(-1);
    const envelope = { ...encrypted,ciphertext:`${encrypted.ciphertext.slice(0,-1)}${tail === 'A' ? 'B' : 'A'}` };
    const original = shareFetch;
    shareFetch = async ()=>({ body:{ revision:9,completions:[{ createdAt:now,envelope }] } });
    _agendaCompletionSyncAt = 0;
    try{
      const synced = await syncHouseholdAgendaCompletions(feed,{ force:true });
      const saved = load()[0];
      return {
        changed:synced.changed,
        acknowledged:synced.operationIds.includes(operationId),
        rowExcluded:synced.completedRowKeys.has(`${habit.hid}|${now}`),
        completed:completedOnDay(saved,dayStart(now))
      };
    }finally{
      shareFetch = original;
    }
  });
  assert(!corruptInbound.changed && !corruptInbound.acknowledged && !corruptInbound.rowExcluded && !corruptInbound.completed,
    `corrupt encrypted completions fail closed without hiding or completing the row (${JSON.stringify(corruptInbound)})`);

  const displayModes = await page.evaluate(()=>{
    const data = load();
    data[0].showOnSharedDisplay = undefined;
    data[0].allowSharedDisplayCompletion = undefined;
    save(data);
    openDetail(0);
    const defaultMode = currentDetailSharedDisplayMode();
    document.querySelector('[data-shared-display-mode="view"]')?.click();
    const view = currentDetailTune();
    document.querySelector('[data-shared-display-mode="hidden"]')?.click();
    const hidden = currentDetailTune();
    setDetailSharedDisplayMode('complete');
    setDetailTypeUi('zero');
    const stop = {
      mode:currentDetailSharedDisplayMode(),
      completionDisabled:document.querySelector('[data-shared-display-mode="complete"]')?.disabled
    };
    closeDetail();
    return { defaultMode,view,hidden,stop };
  });
  assert(displayModes.defaultMode === 'complete'
    && displayModes.view.showOnSharedDisplay && !displayModes.view.allowSharedDisplayCompletion
    && !displayModes.hidden.showOnSharedDisplay
    && displayModes.stop.mode === 'view' && displayModes.stop.completionDisabled,
  'each item defaults to markable and can be changed to view-only or hidden from its detail Actions page');

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

  const swSource = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
  assert(/if \(isShareWorkerRequest\(req\)\) return;/.test(swSource),'share Worker GETs bypass Cache Storage');
  assert(swSource.includes('isAgendaDisplayPath'),'display navigations do not fall back to the owner app shell');
  assert(swSource.includes('./js/sw-register.js'),'service worker precaches the external SW boot script');
  const displayHtml = fs.readFileSync(path.join(__dirname,'../agenda-display.html'),'utf8');
  assert(displayHtml.includes("frame-ancestors 'none'"),'display CSP forbids framing');
  assert(displayHtml.includes('agenda-display-boot.js'),'display loads the frame-bust first');
  assert(await page.evaluate(()=>AGENDA_DISPLAY_KEY === 'tings_agenda_display_v3'),'active display storage key is v3');

  const ownerHtml = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const ownerCsp = (ownerHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const ownerScriptSrc = (ownerCsp.split(';').map(part=>part.trim()).find(part=>part.startsWith('script-src')) || '');
  assert(ownerScriptSrc.length > 0,'owner CSP includes script-src');
  assert(!/\bunsafe-inline\b/.test(ownerScriptSrc),'owner CSP script-src does not allow unsafe-inline');
  assert(cspViolations.length === 0,`owner page has no CSP console violations${cspViolations.length ? ` (${cspViolations.join(' | ')})` : ''}`);
  const ownerInlineScripts = (ownerHtml.match(/<script\b[\s\S]*?<\/script>/gi) || [])
    .filter(block => !/\bsrc\s*=/.test(block.slice(0, block.indexOf('>'))));
  assert(ownerInlineScripts.length === 0,'owner index has no inline boot scripts');
  assert(ownerHtml.includes('<script src="./js/agenda-display-boot.js"></script>'),'owner page loads the frame-bust from the head');
  assert(!ownerScriptSrc.includes('https://unpkg.com ') && !ownerScriptSrc.includes('https://cdn.jsdelivr.net '),'owner CSP does not trust entire CDN script hosts');
  assert(/tabler-icons\.min\.css" integrity="sha256-[A-Za-z0-9+/=]+" crossorigin=/.test(ownerHtml),'Tabler CSS is SRI-pinned');
  assert(/leaflet\.js" integrity="sha256-/.test(ownerHtml),'Leaflet JS remains SRI-pinned');
  const calendarImport = fs.readFileSync(path.join(__dirname,'../js/calendar-import.js'),'utf8');
  assert(/CALENDAR_PDF_JS_SRI = 'sha256-/.test(calendarImport),'pdf.js script is SRI-pinned');
  assert(/CALENDAR_PDF_WORKER_SRI = 'sha256-/.test(calendarImport),'pdf.js worker is SRI-pinned');
  assert(/script\.integrity = integrity/.test(calendarImport),'pdf.js loader applies the integrity hash');
  assert(/sriMatches\(buf, integrity\)/.test(calendarImport),'pdf.js worker bytes are integrity-checked before the blob URL');
  assert(/isEvalSupported\s*:\s*false/.test(calendarImport),'pdf.js parsing disables its vulnerable dynamic-code path');

  const guardContext = await browser.newContext({ serviceWorkers:'block' });
  const displayUrl = new URL('agenda-display.html',baseUrl).href;
  const migratePage = await guardContext.newPage();
  await migratePage.route(/habits-share/,route=>{
    const url = route.request().url();
    if(url.includes('/v1/agenda-pairings') && route.request().method() === 'POST'){
      route.fulfill({
        status:201,contentType:'application/json',
        body:JSON.stringify({ pairingId:'00'.repeat(16),expiresAt:Date.now() + 30000 })
      });
      return;
    }
    route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({ snapshot:null,revision:0,paused:false,status:'active',sessionExpiresAt:Date.now() + 86400000 })
    });
  });
  await migratePage.goto(displayUrl,{ waitUntil:'load' });
  await migratePage.evaluate(()=>{
    localStorage.setItem('tings_agenda_display_v1',JSON.stringify({
      feedId:'a'.repeat(32),contentKey:'b'.repeat(64),viewerCredential:'legacy-link'
    }));
    localStorage.setItem('tings_agenda_display_v2',JSON.stringify({
      feedId:'c'.repeat(32),contentKey:'d'.repeat(64),deviceCredential:'e'.repeat(64)
    }));
    localStorage.removeItem('tings_agenda_display_v3');
  });
  await migratePage.reload({ waitUntil:'load' });
  const migrated = await migratePage.evaluate(()=>({
    v1:localStorage.getItem('tings_agenda_display_v1'),
    v2:localStorage.getItem('tings_agenda_display_v2'),
    v3:JSON.parse(localStorage.getItem('tings_agenda_display_v3') || 'null')
  }));
  assert(!migrated.v1 && !migrated.v2,'legacy display keys are deleted on boot');
  assert(!migrated.v3,'ambiguous v2 sessions fail closed instead of migrating retired link credentials');

  await migratePage.evaluate(()=>{
    localStorage.setItem('tings_agenda_display_v2',JSON.stringify({
      feedId:'f'.repeat(32),contentKey:'g'.repeat(64),deviceCredential:'h'.repeat(64),viewerCredential:'link'
    }));
    localStorage.removeItem('tings_agenda_display_v3');
  });
  await migratePage.reload({ waitUntil:'load' });
  const rejectedLegacy = await migratePage.evaluate(()=>({
    v2:localStorage.getItem('tings_agenda_display_v2'),
    v3:localStorage.getItem('tings_agenda_display_v3')
  }));
  assert(!rejectedLegacy.v2 && !rejectedLegacy.v3,'link-based v2 enrollments are not migrated');

  const framePage = await guardContext.newPage();
  await framePage.goto('about:blank');
  const framed = await framePage.evaluate(async url=>{
    const iframe = document.createElement('iframe');
    iframe.src = url;
    document.body.appendChild(iframe);
    await new Promise(resolve=>{
      iframe.onload = resolve;
      setTimeout(resolve,2500);
    });
    const doc = iframe.contentDocument;
    return {
      html:doc ? doc.documentElement.innerHTML : '',
      pairing:Boolean(doc && doc.getElementById('agenda-pair-code'))
    };
  },displayUrl);
  assert(!framed.pairing && !/agenda-pair-qr|agenda-pair-code/.test(framed.html),'a framed display is blanked before pairing UI appears');
  const framedOwner = await framePage.evaluate(async url=>{
    const iframe = document.createElement('iframe');
    iframe.src = url;
    document.body.appendChild(iframe);
    await new Promise(resolve=>{
      iframe.onload = resolve;
      setTimeout(resolve,2500);
    });
    const doc = iframe.contentDocument;
    return doc ? doc.documentElement.innerHTML : '';
  },baseUrl);
  assert(!/settings-agenda-scan-qr|agenda-pair-approval/.test(framedOwner),'a framed owner app is blanked before sensitive controls appear');
  await guardContext.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
