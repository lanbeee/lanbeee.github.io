// Approval must leave the QR screen even if cleanup stalls. Use real fetch,
// encryption and automatic polling, then cover expiry/replacement races.
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
let pass = 0, fail = 0;
function assert(value,message){
  if(value){ pass++; console.log('  ok: ' + message); }
  else{ fail++; console.error('  FAIL: ' + message); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const context = await browser.newContext({serviceWorkers:'block'});
    const page = await context.newPage();
    let approved = null;
    let library = null;
    let consumeStarted = false;
    const json = (route,status,body)=>route.fulfill({
      status,contentType:'application/json',body:JSON.stringify(body)
    });
    await page.route(/habits-share/,async route=>{
      const request = route.request();
      const url = new URL(request.url());
      if(url.pathname.endsWith('/consume')){
        consumeStarted = true;
        // Intentionally never answer. The browser must abort the request and
        // continue into the clone using the already persisted authorization.
        return;
      }
      if(url.pathname.endsWith('/status')){
        return json(route,approved ? 200 : 202,approved || {state:'pending'});
      }
      if(url.pathname === '/v1/agenda-pairings'){
        return json(route,201,{expiresAt:Date.now()+30000});
      }
      if(library && url.pathname === `/v1/agendas/${library.id}`){
        if(request.method() === 'PUT') return json(route,200,{revision:2,status:'active'});
        return json(route,200,library);
      }
      return json(route,200,{});
    });
    const displayUrl = new URL('agenda-display.html',baseUrl).href;
    await page.goto(displayUrl,{waitUntil:'load'});
    await page.waitForFunction(()=>Boolean(_displayPairing));
    const prepared = await page.evaluate(async()=>{
      const pairing = _displayPairing;
      const feedId = shareRandomHex(16);
      const contentKey = shareRandomHex(32);
      const replicaKey = shareRandomHex(32);
      const hid = 'paired-clone-test';
      const transfer = await shareAgendaPairEncrypt(
        contentKey,feedId,pairing.pairingId,pairing.displayPublicKey,'clone',replicaKey
      );
      const fields = {schemaVersion:SHARE_SCHEMA_VERSION,objectId:feedId,revision:1};
      return {
        approved:{state:'approved',feedId,transfer,sessionExpiresAt:Date.now()+86400000},
        library:{
          id:feedId,revision:1,pairingId:pairing.pairingId,completions:[],definitions:[],
          snapshot:await shareEncrypt(contentKey,{days:[],generatedAt:Date.now()},
            {...fields,recordKind:'agenda_snapshot'}),
          replica:await shareEncrypt(replicaKey,{
            schemaVersion:1,mode:'clone',items:[{
              rowId:shareRandomHex(8),access:'complete',
              habit:{hid,name:'Synced from phone',type:'keepup',target:1,logs:[],durationMinutes:10}
            }],settings:null,truncated:false
          },{...fields,recordKind:'agenda_replica'})
        }
      };
    });
    approved = prepared.approved;
    library = prepared.library;
    // Do not call pollDisplayPairing: exercise the automatic QR-page timer.
    let opened = false;
    try{
      await page.waitForURL(/index\.html\?display=1/,{timeout:12000});
      opened = true;
    }catch(_){ }
    assert(consumeStarted,'automatic polling receives approval and attempts one-time cleanup');
    assert(opened,'a stalled cleanup request cannot strand an approved clone on the QR screen');
    if(opened){
      await page.waitForFunction(()=>typeof load === 'function' && load().some(h=>h.name === 'Synced from phone'));
      // Persistence precedes the asynchronous home render. Wait for the UI too.
      await page.getByText('Synced from phone',{exact:true}).first().waitFor({state:'visible'});
      assert(await page.locator('#list').innerText().then(text=>text.includes('Synced from phone')),
        'the computer opens the full app and displays the encrypted phone library');
      await page.goto(baseUrl,{waitUntil:'load'});
      await page.waitForFunction(()=>document.body.classList.contains('replica-display-mode'));
      assert(await page.evaluate(()=>replicaEnrollmentActive() && load().some(h=>h.name === 'Synced from phone')),
        'a PWA-style launch without the display query keeps the paired clone');
    }
    await context.close();

    const raceContext = await browser.newContext({serviceWorkers:'block'});
    const racePage = await raceContext.newPage();
    await racePage.route(/habits-share/,route=>json(route,201,{expiresAt:Date.now()+30000}));
    await racePage.goto(displayUrl,{waitUntil:'load'});
    await racePage.waitForFunction(()=>Boolean(_displayPairing));
    const races = await racePage.evaluate(async()=>{
      clearInterval(_displayPairPollTimer);
      clearInterval(_displayPairExpiryTimer);
      const pairing = _displayPairing;
      const feedId = shareRandomHex(16);
      const transfer = await shareAgendaPairEncrypt(
        shareRandomHex(32),feedId,pairing.pairingId,pairing.displayPublicKey,'clone',shareRandomHex(32)
      );
      const response = {body:{state:'approved',feedId,transfer}};
      let resolveStatus;
      const status = new Promise(resolve=>{resolveStatus=resolve;});
      let statusCalls = 0;
      let opens = 0;
      openDisplayFullApp = ()=>{opens++;};
      shareFetch = async path=>{
        if(path.endsWith('/status')){statusCalls++; return status;}
        return {body:{}};
      };
      const first = pollDisplayPairing();
      const duplicate = pollDisplayPairing();
      pairing.expiresAt = Date.now()-1;
      updateDisplayPairingExpiry();
      const keptInFlight = _displayPairing === pairing;
      resolveStatus(response);
      await Promise.all([first,duplicate]);
      const approvedOnce = opens === 1 && displayReadEnrollment()?.syncMode === 'clone';

      displayWriteEnrollment(null);
      _displayFeed = null;
      const oldPairing = {...pairing,expiresAt:Date.now()+30000};
      _displayPairing = oldPairing;
      let resolveOld;
      shareFetch = async path=>path.endsWith('/status')
        ? new Promise(resolve=>{resolveOld=resolve;}) : {body:{}};
      const stale = pollDisplayPairing();
      stopDisplayPairing();
      const replacement = {...oldPairing,pairingId:shareRandomHex(16)};
      _displayPairing = replacement;
      resolveOld(response);
      await stale;
      const ignoredOld = _displayPairing === replacement && !displayReadEnrollment() && opens === 1;

      // Expiry still destroys a request whose final in-flight response was pending.
      _displayPairing = replacement;
      replacement.expiresAt = Date.now()+30000;
      let resolvePending;
      shareFetch = async()=>new Promise(resolve=>{resolvePending=resolve;});
      const pending = pollDisplayPairing();
      replacement.expiresAt = Date.now()-1;
      updateDisplayPairingExpiry();
      resolvePending({body:{state:'pending'}});
      await pending;
      return {statusCalls,keptInFlight,approvedOnce,ignoredOld,pendingExpired:_displayPairing === null};
    });
    assert(races.statusCalls === 1,'slow status requests do not create overlapping approval polls');
    assert(races.keptInFlight && races.approvedOnce,'expiry preserves an approval already in flight and opens the clone once');
    assert(races.ignoredOld,'an old approval response cannot replace a newer QR request');
    assert(races.pendingExpired,'an expired pending request still erases its pairing key');
    await raceContext.close();
  }finally{
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(error=>{console.error(error);process.exitCode=1;});
