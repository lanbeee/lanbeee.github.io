// Pairing a second display must sign out the first one. Same public URL, new
// device credential, previous session and cached plaintext gone.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-share-replacement-test.js
const { chromium } = require('playwright');
const crypto = require('crypto');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function sha256Hex(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function bearer(request){
  return String(request.headers()['authorization'] || '').replace(/^Bearer\s+/i,'');
}

function json(route,status,body){
  return route.fulfill({
    status,
    contentType:'application/json',
    body:JSON.stringify(body)
  });
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const ownerContext = await browser.newContext({
    viewport:{ width:390,height:844 },isMobile:true,hasTouch:true,serviceWorkers:'block'
  });
  const firstDisplay = await browser.newContext({ serviceWorkers:'block' });
  const secondDisplay = await browser.newContext({ serviceWorkers:'block' });
  const ownerPage = await ownerContext.newPage();
  const laptopPage = await firstDisplay.newPage();
  const tabletPage = await secondDisplay.newPage();

  const server = {
    feed:null,
    snapshot:null,
    revision:0,
    sessionHash:null,
    pairingId:null,
    lastPairingId:null,
    pairings:new Map()
  };

  const attachWorker = async page => {
    await page.route(/habits-share/,async route=>{
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if(method === 'OPTIONS'){
        return route.fulfill({
          status:204,
          headers:{
            'Access-Control-Allow-Origin':'*',
            'Access-Control-Allow-Headers':'Authorization,Content-Type,If-Match',
            'Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS'
          }
        });
      }
      const auth = bearer(request);
      let body = {};
      try{ body = request.postDataJSON() || {}; }catch(_){ body = {}; }

      if(url.pathname === '/v1/agendas' && method === 'POST'){
        server.feed = { id:body.id,ownerCredential:body.ownerCredential };
        server.revision = 0;
        server.snapshot = null;
        server.sessionHash = null;
        server.pairingId = null;
        return json(route,201,{ id:body.id,status:'active',revision:0 });
      }

      if(url.pathname === '/v1/agenda-pairings' && method === 'POST'){
        const pairing = {
          pairingId:body.pairingId,
          pollCredential:body.pollCredential,
          deviceCredentialHash:body.deviceCredentialHash,
          displayPublicKey:body.displayPublicKey,
          state:'pending',
          transfer:null,
          expiresAt:Date.now() + 30 * 1000
        };
        server.pairings.set(body.pairingId,pairing);
        server.lastPairingId = body.pairingId;
        return json(route,201,{ pairingId:body.pairingId,expiresAt:pairing.expiresAt });
      }

      const pairingMatch = url.pathname.match(/^\/v1\/agenda-pairings\/([0-9a-f]{32})(?:\/(approve|status|consume))?$/);
      if(pairingMatch){
        const pairing = server.pairings.get(pairingMatch[1]);
        const action = pairingMatch[2] || '';
        if(!pairing) return json(route,410,{ error:'pairing_unavailable' });
        if(!action && method === 'GET'){
          return json(route,200,{
            pairingId:pairing.pairingId,
            displayPublicKey:pairing.displayPublicKey,
            expiresAt:pairing.expiresAt
          });
        }
        if(action === 'approve' && method === 'POST'){
          if(!server.feed || auth !== server.feed.ownerCredential) return json(route,403,{ error:'forbidden' });
          pairing.state = 'approved';
          pairing.transfer = body.transfer;
          pairing.sessionExpiresAt = Date.now() + 30 * 86400000;
          server.sessionHash = pairing.deviceCredentialHash;
          server.pairingId = pairing.pairingId;
          server.snapshot = null;
          return json(route,200,{ state:'approved',sessionExpiresAt:pairing.sessionExpiresAt });
        }
        if(action === 'status' && method === 'GET'){
          if(auth !== pairing.pollCredential) return json(route,401,{ error:'unauthorized' });
          if(pairing.state !== 'approved'){
            return json(route,202,{ state:'pending',expiresAt:pairing.expiresAt });
          }
          return json(route,200,{
            state:'approved',
            feedId:server.feed.id,
            sessionExpiresAt:pairing.sessionExpiresAt,
            transfer:pairing.transfer,
            expiresAt:pairing.expiresAt
          });
        }
        if(action === 'consume' && method === 'POST'){
          if(auth !== pairing.pollCredential) return json(route,401,{ error:'unauthorized' });
          server.pairings.delete(pairing.pairingId);
          return json(route,200,{ consumed:true });
        }
        return json(route,405,{ error:'method_not_allowed' });
      }

      const agendaMatch = url.pathname.match(/^\/v1\/agendas\/([0-9a-f]{32})$/);
      if(agendaMatch && server.feed && agendaMatch[1] === server.feed.id){
        const sessionOk = server.sessionHash && sha256Hex(auth) === server.sessionHash;
        const ownerOk = auth === server.feed.ownerCredential;
        if(method === 'GET'){
          if(!sessionOk && !ownerOk) return json(route,401,{ error:'unauthorized' });
          return json(route,200,{
            id:server.feed.id,
            status:'active',
            revision:server.revision,
            snapshot:server.snapshot,
            sessionExpiresAt:sessionOk ? Date.now() + 30 * 86400000 : null,
            pairingId:sessionOk ? server.pairingId : null,
            completions:[]
          });
        }
        if(method === 'PUT'){
          if(!ownerOk) return json(route,403,{ error:'forbidden' });
          server.snapshot = body.snapshot;
          server.revision = body.snapshot && body.snapshot.revision || server.revision + 1;
          return json(route,200,{
            id:server.feed.id,status:'active',revision:server.revision
          });
        }
      }
      return json(route,404,{ error:'not_found' });
    });
  };

  await attachWorker(ownerPage);
  await attachWorker(laptopPage);
  await attachWorker(tabletPage);

  await ownerPage.goto(baseUrl,{ waitUntil:'load' });
  await ownerPage.evaluate(async ()=>{
    const now = Date.now();
    const base = dayStart(now);
    saveSortSettings({ ...loadSortSettings(), blockedTimes:[] });
    weekSnapshotForExport = () => ({ optimized:false,days:[{
      dayBase:base,dayKey:dateKey(base),isToday:true,usedMinutes:30,remainingMinutes:0,
      timeline:[{ kind:'scheduled',start:now + 3600000,end:now + 5400000,h:{
        name:'Medication',emoji:'💊',hid:'med',type:'keepup',target:1,logs:[],breakable:false,locationIds:[]
      }}]
    }] });
    saveAgendaFeedRecord(null);
    await createHouseholdAgendaFeed('Kitchen tablet');
  });

  const displayUrl = new URL('agenda-display.html',baseUrl).href;
  const enrollmentKey = await ownerPage.evaluate(
    "typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v4'"
  );

  const pairDisplay = async (displayPage,label) => {
    await displayPage.goto(displayUrl,{ waitUntil:'load' });
    await displayPage.waitForFunction(()=>document.getElementById('agenda-pair-code')?.textContent.length === 9);
    const code = (await displayPage.textContent('#agenda-pair-code')).replace('-','');
    const pairing = server.pairings.get(server.lastPairingId);
    const ownerPairUrl = new URL(baseUrl);
    ownerPairUrl.hash = new URLSearchParams({
      agendaPair:pairing.pairingId,x:pairing.displayPublicKey.x,y:pairing.displayPublicKey.y
    }).toString();
    const handled = await ownerPage.evaluate(url=>handleHouseholdAgendaScannedValue(url),ownerPairUrl.href);
    assert(handled,`${label}: owner accepts the scanned QR`);
    await ownerPage.waitForSelector('#agenda-pair-approval:not([hidden])');
    await ownerPage.waitForFunction(()=>!document.getElementById('agenda-pair-approval-code')?.disabled);
    await ownerPage.fill('#agenda-pair-approval-code',code);
    await ownerPage.click('#agenda-pair-approval-confirm');
    await ownerPage.waitForFunction(()=>/Display authorized/.test(
      document.getElementById('agenda-pair-approval-status')?.textContent || ''
    ));
    await displayPage.evaluate(()=>pollDisplayPairing());
    await displayPage.waitForFunction(()=>document.getElementById('agenda-title')?.textContent === 'Kitchen tablet');
    const enrollment = await displayPage.evaluate(key=>JSON.parse(localStorage.getItem(key) || 'null'),enrollmentKey);
    return { pairingId:pairing.pairingId,enrollment };
  };

  console.log('\n--- Shared display replacement ---\n');

  const laptop = await pairDisplay(laptopPage,'laptop');
  const laptopSeesAgenda = await laptopPage.evaluate(()=>document.getElementById('agenda-root')?.textContent || '');
  assert(laptopSeesAgenda.includes('Medication'),'first display decrypts the live agenda after QR approval');
  assert(laptop.enrollment && laptop.enrollment.pairingId === laptop.pairingId,'first display stores its own pairing id');
  const laptopCredential = laptop.enrollment.deviceCredential;
  const laptopKey = laptop.enrollment.contentKey;

  const tablet = await pairDisplay(tabletPage,'tablet');
  const tabletSeesAgenda = await tabletPage.evaluate(()=>document.getElementById('agenda-root')?.textContent || '');
  assert(tabletSeesAgenda.includes('Medication'),'replacement display decrypts the agenda under the rotated key');
  assert(tablet.enrollment.pairingId !== laptop.pairingId,'replacement display receives a different pairing id');
  assert(tablet.enrollment.deviceCredential !== laptopCredential,'replacement display receives a different device credential');
  assert(tablet.enrollment.contentKey !== laptopKey,'owner rotates the content key for the new display');
  assert(server.sessionHash === sha256Hex(tablet.enrollment.deviceCredential),'worker session hash matches only the new display');
  assert(server.pairingId === tablet.pairingId,'worker current pairing id matches only the new display');

  await laptopPage.evaluate(()=>refreshDisplay());
  const laptopAfterReplace = await laptopPage.evaluate(key=>({
    text:document.getElementById('agenda-root')?.textContent || '',
    enrollment:localStorage.getItem(key),
    pairingVisible:!document.getElementById('agenda-enroll')?.hidden,
    banner:document.getElementById('agenda-banner')?.textContent || ''
  }),enrollmentKey);
  assert(laptopAfterReplace.enrollment === null,'displaced display erases its cached credential and content key');
  assert(!laptopAfterReplace.text.includes('Medication'),'displaced display does not keep showing the agenda from cache');
  assert(laptopAfterReplace.pairingVisible,'displaced display returns to a fresh QR');

  await laptopPage.reload({ waitUntil:'load' });
  const laptopReopen = await laptopPage.evaluate(key=>({
    text:document.getElementById('agenda-root')?.textContent || '',
    enrollment:localStorage.getItem(key),
    v3:localStorage.getItem('tings_agenda_display_v3')
  }),enrollmentKey);
  assert(laptopReopen.enrollment === null && !laptopReopen.text.includes('Medication'),
    'reopening the same display URL does not restore the revoked laptop session');
  assert(!laptopReopen.v3,'legacy v3 enrollment is not used as a fallback');

  await laptopPage.evaluate(({ key,enrollment })=>{
    localStorage.setItem(key,JSON.stringify(enrollment));
  },{ key:enrollmentKey,enrollment:laptop.enrollment });
  await laptopPage.reload({ waitUntil:'load' });
  await laptopPage.waitForFunction(key=>{
    const text = document.getElementById('agenda-root')?.textContent || '';
    const enroll = document.getElementById('agenda-enroll');
    return localStorage.getItem(key) === null && !text.includes('Medication') && enroll && !enroll.hidden;
  },enrollmentKey);
  const leftoverLaptop = await laptopPage.evaluate(key=>({
    text:document.getElementById('agenda-root')?.textContent || '',
    enrollment:localStorage.getItem(key),
    pairingVisible:!document.getElementById('agenda-enroll')?.hidden
  }),enrollmentKey);
  assert(leftoverLaptop.enrollment === null && !leftoverLaptop.text.includes('Medication') && leftoverLaptop.pairingVisible,
    'a leftover laptop enrollment with the old pairing id cannot read the latest agenda');

  const tabletStillLive = await tabletPage.evaluate(()=>{
    return refreshDisplay().then(()=>({
      text:document.getElementById('agenda-root')?.textContent || '',
      title:document.getElementById('agenda-title')?.textContent || ''
    }));
  });
  assert(tabletStillLive.text.includes('Medication') && tabletStillLive.title === 'Kitchen tablet',
    'the newly paired display keeps reading the live agenda');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
