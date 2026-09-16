// Two signed-in screens can coexist: one full-app and one glance. They share
// the agenda key and a receipt-tracked completion stream; only the clone gets
// the nested-replica key. A second clone is refused.
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
  const framePage = await firstDisplay.newPage();
  const extraPage = await secondDisplay.newPage();

  const server = {
    feed:null,
    snapshot:null,
    replica:null,
    revision:0,
    sessions:new Map(),
    lastPairingId:null,
    pairings:new Map(),
    completions:[],
    agendaCreates:0
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
        server.agendaCreates += 1;
        server.feed = { id:body.id,ownerCredential:body.ownerCredential };
        server.revision = 0;
        server.snapshot = null;
        server.replica = null;
        server.sessions.clear();
        server.completions = [];
        return json(route,201,{ id:body.id,status:'active',revision:0 });
      }

      if(url.pathname === '/v1/agenda-pairings' && method === 'POST'){
        const pairing = {
          pairingId:body.pairingId,
          pollCredential:body.pollCredential,
          deviceCredentialHash:body.deviceCredentialHash,
          displayPublicKey:body.displayPublicKey,
          protocolVersion:body.protocolVersion || 1,
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
            protocolVersion:pairing.protocolVersion,
            expiresAt:pairing.expiresAt
          });
        }
        if(action === 'approve' && method === 'POST'){
          if(!server.feed || auth !== server.feed.ownerCredential) return json(route,403,{ error:'forbidden' });
          if(server.sessions.size >= 2 && !server.sessions.has(pairing.pairingId)){
            return json(route,409,{ error:'session_limit' });
          }
          pairing.state = 'approved';
          pairing.transfer = body.transfer;
          pairing.sessionExpiresAt = Date.now() + 30 * 86400000;
          server.sessions.set(pairing.pairingId,{
            pairingId:pairing.pairingId,
            hash:pairing.deviceCredentialHash,
            expiresAt:pairing.sessionExpiresAt
          });
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

      const accessMatch = url.pathname.match(/^\/v1\/agendas\/([0-9a-f]{32})\/display-access$/);
      if(accessMatch && server.feed && accessMatch[1] === server.feed.id && method === 'DELETE'){
        const ownerOk = auth === server.feed.ownerCredential;
        if(ownerOk){
          if(!body.pairingId) return json(route,400,{ error:'invalid_request' });
          if(!server.sessions.has(body.pairingId)) return json(route,404,{ error:'not_found' });
          server.sessions.delete(body.pairingId);
          return json(route,200,{ revoked:true });
        }
        for(const [pairingId,session] of server.sessions){
          if(session.hash === sha256Hex(auth)){
            server.sessions.delete(pairingId);
            return json(route,200,{ revoked:true });
          }
        }
        return json(route,401,{ error:'unauthorized' });
      }

      const completionMatch = url.pathname.match(/^\/v1\/agendas\/([0-9a-f]{32})\/completions$/);
      if(completionMatch && server.feed && completionMatch[1] === server.feed.id && method === 'POST'){
        const source = [...server.sessions.values()].find(session=>session.hash === sha256Hex(auth));
        if(!source) return json(route,401,{ error:'unauthorized' });
        server.completions.push({
          sequence:server.completions.length + 1,
          createdAt:Date.now(),
          envelope:body.completion,
          targets:new Set([
            'owner',
            ...[...server.sessions.values()]
              .filter(session=>session.pairingId !== source.pairingId)
              .map(session=>session.pairingId)
          ])
        });
        return json(route,201,{
          operationId:body.completion && body.completion.operationId,
          rowId:body.completion && body.completion.logId,
          createdAt:Date.now()
        });
      }

      const ackMatch = url.pathname.match(/^\/v1\/agendas\/([0-9a-f]{32})\/completion-acks$/);
      if(ackMatch && server.feed && ackMatch[1] === server.feed.id && method === 'POST'){
        const session = [...server.sessions.values()].find(item=>item.hash === sha256Hex(auth));
        const consumer = auth === server.feed.ownerCredential ? 'owner' : (session && session.pairingId);
        if(!consumer) return json(route,401,{ error:'unauthorized' });
        let acknowledged = 0;
        for(const operationId of (body.operationIds || [])){
          const record = server.completions.find(item=>item.envelope && item.envelope.operationId === operationId);
          if(record && record.targets && record.targets.delete(consumer)) acknowledged += 1;
        }
        server.completions = server.completions.filter(item=>!item.targets || item.targets.size);
        return json(route,200,{ acknowledged });
      }

      const agendaMatch = url.pathname.match(/^\/v1\/agendas\/([0-9a-f]{32})$/);
      if(agendaMatch && server.feed && agendaMatch[1] === server.feed.id){
        const session = [...server.sessions.values()].find(item=>item.hash === sha256Hex(auth));
        const ownerOk = auth === server.feed.ownerCredential;
        if(method === 'GET'){
          if(!session && !ownerOk) return json(route,401,{ error:'unauthorized' });
          const payload = {
            id:server.feed.id,
            status:'active',
            revision:server.revision,
            snapshot:server.snapshot,
            sessionExpiresAt:session ? session.expiresAt : null,
            pairingId:session ? session.pairingId : null,
            completions:server.completions
              .filter(item=>!item.targets || item.targets.has(ownerOk ? 'owner' : session.pairingId))
              .map(({ targets:_targets,...item })=>item),
            definitions:[]
          };
          if(url.searchParams.get('library') === '1') payload.replica = server.replica;
          if(ownerOk) payload.sessions = [...server.sessions.values()].map(item=>({ pairingId:item.pairingId }));
          return json(route,200,payload);
        }
        if(method === 'PUT'){
          if(!ownerOk && !session) return json(route,401,{ error:'unauthorized' });
          if(!ownerOk && body.replica) return json(route,403,{ error:'forbidden' });
          server.snapshot = body.snapshot;
          if(ownerOk) server.replica = body.replica || null;
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
  await attachWorker(framePage);
  await attachWorker(extraPage);

  await ownerPage.goto(baseUrl,{ waitUntil:'load' });
  await ownerPage.evaluate(async ()=>{
    const now = Date.now();
    const base = dayStart(now);
    saveSortSettings({ ...loadSortSettings(), blockedTimes:[] });
    const medication = normalize([{
      name:'Medication',emoji:'💊',hid:'med',type:'keepup',target:1,logs:[],lastLog:null,
      breakable:false,durationMinutes:30,locationIds:[],showOnSharedDisplay:true
    }])[0];
    const exercise = normalize([{
      name:'Exercise',emoji:'🏃',hid:'exercise',type:'keepup',target:1,logs:[],lastLog:null,
      breakable:false,durationMinutes:30,locationIds:[],showOnSharedDisplay:true
    }])[0];
    save([medication,exercise]);
    weekSnapshotForExport = () => ({ optimized:false,days:[{
      dayBase:base,dayKey:dateKey(base),isToday:true,usedMinutes:60,remainingMinutes:0,
      timeline:[
        { kind:'scheduled',start:now + 3600000,end:now + 5400000,h:medication },
        { kind:'scheduled',start:now + 5400000,end:now + 7200000,h:exercise }
      ]
    }] });
    saveAgendaFeedRecord(null);
    await createHouseholdAgendaFeed('Kitchen tablet');
    const feed = agendaFeedRecord();
    feed.syncMode = 'glance';
    saveAgendaFeedRecord(feed);
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
    await ownerPage.waitForFunction(()=>!document.getElementById('agenda-pair-approval-code')?.disabled
      || /already signed in|Revoke/.test(document.getElementById('agenda-pair-approval-status')?.textContent || ''));
    const prestatus = await ownerPage.evaluate(()=>document.getElementById('agenda-pair-approval-status')?.textContent || '');
    if(/already signed in|Revoke/.test(prestatus)){
      return { pairingId:pairing.pairingId,enrollment:null,refused:prestatus };
    }
    await ownerPage.fill('#agenda-pair-approval-code',code);
    await ownerPage.click('#agenda-pair-approval-confirm');
    await ownerPage.waitForFunction(()=>/Display authorized|already signed in|Revoke|Two displays/.test(
      document.getElementById('agenda-pair-approval-status')?.textContent || ''
    ));
    const status = await ownerPage.evaluate(()=>document.getElementById('agenda-pair-approval-status')?.textContent || '');
    if(!/Display authorized/.test(status)){
      return { pairingId:pairing.pairingId,enrollment:null,refused:status };
    }
    await displayPage.evaluate(()=>pollDisplayPairing());
    await Promise.race([
      displayPage.waitForFunction(()=>document.getElementById('agenda-title')?.textContent === 'Kitchen tablet'),
      displayPage.waitForURL(/index\.html/,{ timeout:15000 })
    ]).catch(()=>{});
    const enrollment = await displayPage.evaluate(key=>JSON.parse(localStorage.getItem(key) || 'null'),enrollmentKey);
    return { pairingId:pairing.pairingId,enrollment,refused:null };
  };

  console.log('\n--- Multiple shared displays ---\n');

  const composition = await ownerPage.evaluate(()=>{
    const empty = { devices:[] };
    const glance = { devices:[{ pairingId:'a'.repeat(32),syncMode:'glance' }] };
    const clone = { devices:[{ pairingId:'b'.repeat(32),syncMode:'clone' }] };
    const mixed = { devices:[
      { pairingId:'a'.repeat(32),syncMode:'clone' },
      { pairingId:'c'.repeat(32),syncMode:'glance' }
    ] };
    const glanceOnlySessions = [{ pairingId:'c'.repeat(32) }];
    return {
      emptyClone:householdAgendaApproveConflict(empty,'clone'),
      secondGlance:householdAgendaApproveConflict(glance,'glance'),
      secondClone:householdAgendaApproveConflict(clone,'clone'),
      cloneThenGlance:householdAgendaApproveConflict(clone,'glance'),
      mixedFull:householdAgendaApproveConflict(mixed,'clone'),
      replicaBlocked:householdAgendaOwnerControlsBlocked(),
      keptCloneAfterGlanceSession:householdAgendaDevices({
        devices:reconcileHouseholdAgendaDevices(mixed,glanceOnlySessions)
      }).map(item=>item.syncMode).sort(),
      mixedLibrary:householdAgendaLibraryStyle(mixed)
    };
  });
  assert(!composition.emptyClone,'an unpaired feed can approve the first display');
  assert(/glance/.test(composition.secondGlance),'a second glance is refused while one glance is live');
  assert(/full-app|already signed in/.test(composition.secondClone),'a second clone is refused while a full-app display is live');
  assert(!composition.cloneThenGlance,'clone plus glance is the allowed composition');
  assert(/Two displays|already signed in/.test(composition.mixedFull),'a third display is refused');
  assert(!composition.replicaBlocked,'the owner phone is not treated as a replica');
  assert(composition.keptCloneAfterGlanceSession.join(',') === 'clone,glance',
    'a completion pull that has not yet seen the clone session still keeps the clone pairing');
  assert(composition.mixedLibrary === 'clone','mixed glance plus clone publishes the full library');

  const createsBefore = server.agendaCreates;
  const replicaGuard = await ownerPage.evaluate(async key=>{
    const previous = localStorage.getItem(key);
    localStorage.setItem(key,JSON.stringify({
      feedId:'ab'.repeat(16),
      deviceCredential:'cd'.repeat(32),
      contentKey:'ef'.repeat(32),
      replicaMode:'clone',
      replicaRows:{ med:{ rowId:'11'.repeat(8),access:'complete' } }
    }));
    const blocked = replicaDisplayRequested();
    const created = await createHouseholdAgendaFeed('forked feed');
    const scanned = await startHouseholdAgendaQrScanner();
    const approved = await approveHouseholdAgendaPairing();
    if(previous) localStorage.setItem(key,previous);
    else localStorage.removeItem(key);
    return { blocked,created,scanned,approved,title:agendaFeedRecord() && agendaFeedRecord().title };
  },enrollmentKey);
  assert(replicaGuard.blocked,'replica display mode is detected from enrollment');
  assert(replicaGuard.created == null && replicaGuard.scanned === false && replicaGuard.approved === false,
    'a personal clone cannot create, scan, or approve another feed');
  assert(replicaGuard.title === 'Kitchen tablet' && server.agendaCreates === createsBefore,
    'replica create is a no-op and does not POST a second Worker feed');

  const frame = await pairDisplay(framePage,'glance frame');
  const frameSeesAgenda = await framePage.evaluate(()=>document.getElementById('agenda-root')?.textContent || '');
  assert(frameSeesAgenda.includes('Medication'),'glance display decrypts the live agenda after QR approval');
  assert(frame.enrollment && frame.enrollment.pairingId === frame.pairingId,'glance stores its own pairing id');
  assert(frame.enrollment.syncMode === 'glance','pairing transfer stamps glance onto the enrollment');
  const frameKey = frame.enrollment.contentKey;
  const frameCredential = frame.enrollment.deviceCredential;

  const glanceIgnoresReplica = await framePage.evaluate(enrollment=>{
    const projection = {
      schemaVersion:1,
      replica:{
        schemaVersion:1,mode:'clone',items:[{
          rowId:'22'.repeat(8),access:'complete',habit:{ hid:'med',name:'Medication',logs:[] }
        }]
      },
      days:[]
    };
    return installDisplayReplica(projection,enrollment);
  },frame.enrollment);
  assert(glanceIgnoresReplica === false,'glance stays on the kiosk even when the snapshot has a replica for a clone');
  assert(await framePage.evaluate(()=>location.pathname.endsWith('agenda-display.html')),
    'glance does not navigate into the full app after seeing a replica block');

  await ownerPage.evaluate(()=>{
    const feed = agendaFeedRecord();
    feed.syncMode = 'clone';
    saveAgendaFeedRecord(feed);
  });
  const laptop = await pairDisplay(extraPage,'clone laptop');
  assert(!laptop.refused,'clone is allowed alongside one glance display');
  assert(laptop.enrollment && laptop.enrollment.contentKey === frameKey,'owner reuses the content key for the second display');
  assert(!frame.enrollment.replicaKey,'glance enrollment never receives the clone-only replica key');
  assert(laptop.enrollment && /^[0-9a-f]{64}$/.test(String(laptop.enrollment.replicaKey || '')),
    'personal clone receives a separate replica key');
  assert(laptop.enrollment && laptop.enrollment.replicaKey !== frameKey,
    'clone-only data is not sealed with the agenda key known to the glance display');
  assert(laptop.enrollment.deviceCredential !== frameCredential,'the second display receives its own device credential');
  assert(laptop.enrollment.syncMode === 'clone','pairing transfer stamps clone onto the second enrollment');
  const laptopUrl = new URL(extraPage.url());
  assert(laptopUrl.pathname.endsWith('/index.html') && laptopUrl.searchParams.get('display') === '1',
    'personal clone leaves agenda-display.html for the full Tings app');
  assert(server.sessions.size === 2,'worker keeps both viewer sessions');
  assert([...server.sessions.keys()].includes(frame.pairingId)
    && [...server.sessions.keys()].includes(laptop.pairingId),'worker session ids match both pairing ids');

  const glancePlaintext = await framePage.evaluate(async snapshot=>{
    const enrolled = _displayFeed || displayReadEnrollment();
    const projection = await shareDecrypt(enrolled.contentKey,snapshot);
    return {
      hasPlainReplica:Boolean(projection.replica),
      hasNestedReplica:Boolean(projection.replicaEnvelope && projection.replicaEnvelope.ciphertext)
    };
  },server.snapshot);
  assert(!glancePlaintext.hasPlainReplica && !glancePlaintext.hasNestedReplica && server.replica,
    'glance snapshot has only agenda days; the clone library is a sibling envelope');

  await extraPage.waitForFunction(()=>typeof flushReplicaOutbox === 'function' && load().some(h=>h && h.hid === 'exercise'));
  const clonePosted = await extraPage.evaluate(async ()=>{
    const index = load().findIndex(h=>h && h.hid === 'exercise');
    const logged = logTing(index);
    await flushReplicaOutbox();
    return logged;
  });
  assert(clonePosted,'clone records a completion without opening the owner phone');
  await framePage.evaluate(()=>refreshDisplay());
  const frameSawClone = await framePage.evaluate(()=>{
    return [...document.querySelectorAll('.agenda-row')].some(row=>
      row.textContent.includes('Exercise') && row.classList.contains('is-complete')
    );
  });
  assert(frameSawClone,'glance receives the clone completion directly from the Worker event stream');

  const glancePosted = await framePage.evaluate(async ()=>{
    const row = _displayProjection.days.flatMap(day=>day.rows)
      .find(item=>item && item.title === 'Medication');
    if(!row) return false;
    await commitDisplayCompletion(row.rowId);
    return true;
  });
  assert(glancePosted,'glance records a completion without opening the owner phone');
  await extraPage.evaluate(()=>pullReplicaSnapshot());
  const cloneSawGlance = await extraPage.evaluate(()=>{
    const habit = load().find(item=>item && item.hid === 'med');
    return Boolean(habit && normalizeLogs(habit.logs).some(log=>
      log && typeof log === 'object' && log.source === 'shared_display'
    ));
  });
  assert(cloneSawGlance,'personal clone receives the glance completion directly from the Worker event stream');

  await framePage.evaluate(()=>refreshDisplay());
  const frameAfterSecond = await framePage.evaluate(key=>({
    text:document.getElementById('agenda-root')?.textContent || '',
    enrollment:JSON.parse(localStorage.getItem(key) || 'null'),
    path:location.pathname
  }),enrollmentKey);
  assert(frameAfterSecond.enrollment && frameAfterSecond.enrollment.pairingId === frame.pairingId,
    'adding a clone does not erase the glance enrollment');
  assert(frameAfterSecond.text.includes('Medication') && frameAfterSecond.path.endsWith('agenda-display.html'),
    'glance keeps showing the agenda on the kiosk after a clone is added');

  await ownerPage.evaluate(()=>{
    if(typeof closeHouseholdAgendaPairingApproval === 'function') closeHouseholdAgendaPairingApproval();
  });

  const devices = await ownerPage.evaluate(()=>householdAgendaDevices(agendaFeedRecord()).map(item=>item.syncMode).sort());
  assert(devices.join(',') === 'clone,glance','settings remembers one clone and one glance');

  await ownerPage.evaluate(()=>{
    if(typeof closeHouseholdAgendaPairingApproval === 'function') closeHouseholdAgendaPairingApproval();
    const feed = agendaFeedRecord();
    feed.syncMode = 'clone';
    saveAgendaFeedRecord(feed);
  });
  const thirdContext = await browser.newContext({ serviceWorkers:'block' });
  const thirdPage = await thirdContext.newPage();
  await attachWorker(thirdPage);
  const third = await pairDisplay(thirdPage,'second clone');
  assert(third.refused && /full-app|already signed in/.test(third.refused),
    'a second full-app display is refused before the Worker is asked to add a third session');
  assert(server.sessions.size === 2,'refusing a second clone leaves the two live sessions in place');
  await thirdContext.close();

  const liveQueue = await ownerPage.evaluate(async ({ feedId,contentKey })=>{
    const hid = 'med';
    const rowId = '33'.repeat(8);
    const operationId = shareRandomHex(16);
    const payload = { schemaVersion:1,action:'complete',operationId,rowId,hid };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:SHARE_SCHEMA_VERSION,
      recordKind:'agenda_completion',
      objectId:feedId,
      revision:agendaFeedRecord().lastRevision || 1,
      operationId,
      logId:rowId
    });
    return { envelope,operationId,rowId,hid };
  },{ feedId:server.feed.id,contentKey:frameKey });
  server.completions.push({ sequence:1,createdAt:Date.now(),envelope:liveQueue.envelope });

  const glanceLiveClean = await framePage.evaluate(async records=>{
    const enrolled = _displayFeed || displayReadEnrollment();
    const projection = _displayProjection;
    const live = await applyDisplayLiveCompletions(enrolled,records,projection);
    const extras = [...live];
    const completionRowIds = mergeDisplayCompletionRowIds(enrolled.completionRowIds,[],projection,extras);
    const next = { ...enrolled,completionRowIds };
    _displayFeed = next;
    displayWriteEnrollment(next);
    renderDisplay(projection,next.meta || {},completionRowIds);
    return {
      done:Boolean(document.querySelector('.agenda-mark.is-done')),
      storedCount:completionRowIds.length
    };
  },server.completions);
  assert(glanceLiveClean.done && glanceLiveClean.storedCount > 0,
    'glance marks a matching hid done from the shared completion queue without a new snapshot');

  const previous = await ownerPage.evaluate(()=>JSON.stringify(load()));
  const cloneLive = await ownerPage.evaluate(async ({ contentKey,envelope,hid })=>{
    const habit = {
      name:'Medication',emoji:'💊',hid,type:'keepup',target:1,logs:[],lastLog:null,
      breakable:false,durationMinutes:30,locationIds:[]
    };
    save([habit]);
    const enrolled = {
      contentKey,
      replicaRows:{ [hid]:{ rowId:'44'.repeat(8),access:'complete' } },
      replicaOutbox:[],
      replicaPendingCompletions:{}
    };
    await applyReplicaLiveCompletions(enrolled,[{ envelope,createdAt:Date.now() }]);
    const logs = load()[0] && load()[0].logs;
    return Array.isArray(logs) && logs.some(log=>log && log.operationId && log.source === 'shared_display');
  },{ contentKey:frameKey,envelope:liveQueue.envelope,hid:'med' });
  await ownerPage.evaluate(raw=>save(JSON.parse(raw)),previous);
  assert(cloneLive,'clone applies a live completion on an unchanged snapshot revision without echoing it to the outbox');

  const oneOccurrence = await framePage.evaluate(async ({ contentKey,feedId })=>{
    const operationId = '91'.repeat(16);
    const payload = {
      schemaVersion:1,action:'complete',operationId,rowId:'99'.repeat(8),hid:'repeat',
      minutes:30,scheduledDay:'2026-09-15',completedAt:Date.now()
    };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:1,
      operationId,logId:payload.rowId
    });
    const enrolled = { contentKey,feedId };
    const projection = { days:[{ rows:[
      {rowId:'01'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15'},
      {rowId:'02'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15'}
    ]}] };
    return [...await applyDisplayLiveCompletions(enrolled,[{createdAt:Date.now(),envelope}],projection)];
  },{ contentKey:frameKey,feedId:server.feed.id });
  assert(oneOccurrence.length === 1,
    'one clone completion marks at most one matching glance occurrence when a habit has multiple rows');

  const exactOccurrence = await framePage.evaluate(async ({ contentKey,feedId })=>{
    const operationId = '94'.repeat(16);
    const payload = {
      schemaVersion:1,action:'complete',operationId,rowId:'98'.repeat(8),hid:'repeat',
      minutes:30,occurrenceKey:'repeat:second',scheduledDay:'2026-09-15',completedAt:Date.now()
    };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:1,
      operationId,logId:payload.rowId
    });
    const enrolled = { contentKey,feedId };
    const projection = { days:[{ rows:[
      {rowId:'01'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15',occurrenceKey:'repeat:first',start:1},
      {rowId:'02'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15',occurrenceKey:'repeat:second',start:2}
    ]}] };
    return [...await applyDisplayLiveCompletions(enrolled,[{createdAt:Date.now(),envelope}],projection)];
  },{ contentKey:frameKey,feedId:server.feed.id });
  assert(exactOccurrence.length === 1 && exactOccurrence[0] === '02'.repeat(8),
    'a clone completion marks only the glance row with the same occurrence key');

  const unknownOccurrence = await framePage.evaluate(async ({ contentKey,feedId })=>{
    const operationId = '95'.repeat(16);
    const payload = {
      schemaVersion:1,action:'complete',operationId,rowId:'97'.repeat(8),hid:'repeat',
      minutes:30,occurrenceKey:'repeat:missing',scheduledDay:'2026-09-15',completedAt:Date.now()
    };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:1,
      operationId,logId:payload.rowId
    });
    const enrolled = { contentKey,feedId };
    const projection = { days:[{ rows:[
      {rowId:'01'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15',occurrenceKey:'repeat:first'},
      {rowId:'02'.repeat(8),hid:'repeat',completable:true,durationMinutes:30,scheduledDay:'2026-09-15',occurrenceKey:'repeat:second'}
    ]}] };
    return [...await applyDisplayLiveCompletions(enrolled,[{createdAt:Date.now(),envelope}],projection)];
  },{ contentKey:frameKey,feedId:server.feed.id });
  assert(unknownOccurrence.length === 0,
    'an occurrence-scoped completion does not fall back to marking every hid row');

  const breakableMinutes = await ownerPage.evaluate(async ({ contentKey,feedId })=>{
    const hid = 'breakable-direct';
    const operationId = '92'.repeat(16);
    save([normalize([{
      hid,name:'Deep work',type:'keepup',target:1,logs:[],lastLog:null,
      breakable:true,durationMinutes:120,minChunkMinutes:15,locationIds:[]
    }])[0]]);
    const payload = {
      schemaVersion:1,action:'complete',operationId,rowId:'93'.repeat(8),hid,
      minutes:30,completedAt:Date.now()
    };
    const envelope = await shareEncrypt(contentKey,payload,{
      schemaVersion:1,recordKind:'agenda_completion',objectId:feedId,revision:1,
      operationId,logId:payload.rowId
    });
    await applyReplicaLiveCompletions({
      contentKey,replicaRows:{[hid]:{rowId:payload.rowId,access:'complete'}},
      replicaOutbox:[],replicaPendingCompletions:{}
    },[{createdAt:Date.now(),envelope}]);
    const log = normalizeLogs(load()[0].logs).find(item=>item && item.operationId === operationId);
    return log && log.minutes;
  },{ contentKey:frameKey,feedId:server.feed.id });
  assert(breakableMinutes === 30,
    'glance session duration reaches the clone so a breakable row does not become a full-task completion');

  const glanceRetry = await framePage.evaluate(()=>{
    const enrolled = _displayFeed || displayReadEnrollment();
    const pending = displayPendingCompletionPosts({
      pendingCompletionPosts:[{ rowId:'55'.repeat(8),operationId:'aa'.repeat(16),hid:'med' }]
    });
    return pending.length === 1 && Array.isArray(enrolled.completionRowIds);
  });
  assert(glanceRetry,'glance keeps failed completion posts queued for the existing poll');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
