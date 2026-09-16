// Full-app paired-device replication and display chrome.
// HABITS_URL=http://127.0.0.1:4181/ node tests/device-replica-sync-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
let pass = 0, fail = 0;
function assert(value,message){
  if(value){ pass += 1; console.log('  ok: ' + message); }
  else{ fail += 1; console.error('  FAIL: ' + message); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1024,height:768}});
  await page.goto(baseUrl,{waitUntil:'load'});
  const result = await page.evaluate(async()=>{
    history.replaceState(null,'',location.pathname + '?display=1');
    const contentKey = shareRandomHex(32);
    const replicaKey = shareRandomHex(32);
    const feedId = shareRandomHex(16);
    const deviceCredential = shareRandomHex(32);
    const ownerId = shareRandomHex(8);
    const sharedId = generateHabitId();
    const removedId = generateHabitId();
    const privateId = generateHabitId();
    const makeHabit = (hid,name,logs=[])=>normalize([{
      hid,name,type:'keepup',target:7,logs,durationMinutes:30,
      showOnSharedDisplay:true,allowSharedDisplayCompletion:true
    }])[0];
    const viewOnlyId = generateHabitId();
    const viewOnly = makeHabit(viewOnlyId,'Look but do not log');
    const oldShared = makeHabit(sharedId,'Old name',[Date.now()-86400000]);
    const removed = makeHabit(removedId,'No longer shared');
    const privateHabit = makeHabit(privateId,'Device private');
    Storage.writeRaw(KEY,JSON.stringify([oldShared,removed,privateHabit]));
    const enrollment = {
      feedId,deviceCredential,contentKey,replicaKey,pairingId:shareRandomHex(16),
      meta:{revision:4},replicaMode:'selected',
      replicaRows:{
        [sharedId]:{rowId:'11'.repeat(8),access:'complete'},
        [removedId]:{rowId:'22'.repeat(8),access:'complete'}
      },replicaOutbox:[]
    };
    writeReplicaEnrollment(enrollment);
    const incoming = makeHabit(sharedId,'Owner changed cadence',[Date.now()-2*86400000]);
    incoming.target = 2;
    const next = {...enrollment,meta:{revision:5}};
    mergeReplicaSnapshot({
      schemaVersion:1,mode:'selected',definitionOwnerId:ownerId,
      ownershipPolicy:'single-writer-definition_additive-completions',
      items:[
        {rowId:'33'.repeat(8),habit:incoming,access:'complete',definitionOwnerId:ownerId,definitionRevision:5},
        {rowId:'55'.repeat(8),habit:viewOnly,access:'view',definitionOwnerId:ownerId,definitionRevision:5}
      ],
      settings:null,truncated:false
    },next);
    const merged = load();
    const mergedShared = merged.find(h=>h.hid===sharedId);
    const rejectedDefinitionEdit = beforeReplicaDeviceDataSave(merged,merged.map(h=>h.hid===sharedId ? {...h,target:99,name:'Peer edit'} : h));
    const viewAttempt = beforeReplicaDeviceDataSave(merged,merged.map(h=>h.hid===viewOnlyId ? {...h,logs:[...h.logs,{ts:Date.now(),minutes:1}]} : h));
    const viewLogsBlocked = (viewAttempt.find(h=>h.hid===viewOnlyId)?.logs || []).length
      === (merged.find(h=>h.hid===viewOnlyId)?.logs || []).length;
    const viewIdx = merged.findIndex(h=>h.hid===viewOnlyId);
    const logTingBlocked = viewIdx >= 0 && logTing(viewIdx) === false;
    history.replaceState(null,'',location.pathname);
    const logTingBlockedWithoutQuery = viewIdx >= 0 && replicaDeviceBlocksCompletion(viewOnlyId)
      && logTing(viewIdx) === false;
    history.replaceState(null,'',location.pathname + '?display=1');
    const posted = [];
    shareFetch = async(path,opts={})=>{
      if(opts.method === 'POST') posted.push(opts.body.completion);
      return {body:{},status:200};
    };
    const before = load();
    const after = load();
    after.find(h=>h.hid===sharedId).logs.push({ts:Date.now(),minutes:17});
    onReplicaDeviceDataSaved(before,after);
    const deadline = Date.now()+2000;
    while(!posted.length && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    const payload = posted[0] ? await shareDecrypt(contentKey,posted[0]) : null;
    const staleEnrolled = JSON.parse(JSON.stringify(replicaEnrollment()));
    const raceBefore = load();
    const raceAfter = JSON.parse(JSON.stringify(raceBefore));
    raceAfter.find(h=>h.hid===sharedId).logs.push({ts:Date.now(),minutes:5});
    onReplicaDeviceDataSaved(raceBefore,raceAfter);
    mergeReplicaSnapshot({
      schemaVersion:1,mode:'selected',definitionOwnerId:ownerId,
      ownershipPolicy:'single-writer-definition_additive-completions',
      items:[
        {rowId:'33'.repeat(8),habit:load().find(h=>h.hid===sharedId),access:'complete',definitionOwnerId:ownerId,definitionRevision:5},
        {rowId:'55'.repeat(8),habit:load().find(h=>h.hid===viewOnlyId),access:'view',definitionOwnerId:ownerId,definitionRevision:5}
      ],
      settings:null,truncated:false,completionReceipts:[],definitionReceipts:[]
    },staleEnrolled);
    const outboxSurvived = Boolean(
      (replicaEnrollment().replicaOutbox || []).some(op=>op && op.minutes === 5)
      || Object.values(replicaEnrollment().replicaPendingCompletions || {}).some(pending=>pending && pending.hid === sharedId)
    );
    const cloneEnrollment = {
      ...replicaEnrollment(),replicaMode:'clone',replicaOutbox:[],replicaPendingDefinitions:{},
      replicaRows:{
        [sharedId]:{
          rowId:'33'.repeat(8),access:'complete',definitionHash:replicaHabitDefinitionHash(mergedShared)
        }
      }
    };
    writeReplicaEnrollment(cloneEnrollment);
    const clonePosts = [];
    const clonePaths = [];
    shareFetch = async(path,opts={})=>{
      if(opts.method === 'POST'){
        clonePaths.push(path);
        clonePosts.push(opts.body.definition || opts.body.completion);
      }
      return {body:{},status:200};
    };
    const cloneBefore = load();
    const addedId = generateHabitId();
    const added = makeHabit(addedId,'Added on the wall display',[{ts:Date.now(),minutes:9}]);
    save([...cloneBefore,added]);
    const cloneDeadline = Date.now()+2000;
    let addOperation = null;
    let completeOperation = null;
    while(Date.now()<cloneDeadline){
      for(const envelope of clonePosts){
        const decoded = await shareDecrypt(
          envelope.recordKind === 'agenda_definition' ? replicaKey : contentKey,
          envelope
        );
        if(decoded && decoded.action === 'upsert' && decoded.hid === addedId) addOperation = {envelope,decoded};
        if(decoded && decoded.action === 'complete' && decoded.hid === addedId) completeOperation = {envelope,decoded};
      }
      if(addOperation && completeOperation) break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    history.replaceState(null,'',location.pathname);
    const ownerStored = replicaEnrollment().definitionOwnerId === ownerId;
    const outboxEmpty = (replicaEnrollment().replicaOutbox || []).length === 0;
    writeReplicaEnrollment(null);
    Storage.writeRaw(KEY,JSON.stringify(cloneBefore));
    const ownerFeed = {
      feedId,contentKey,replicaKey,ownerCredential:shareRandomHex(32),ownerId,
      syncMode:'clone',lastRevision:5,rowMaps:[]
    };
    shareFetch = async()=>({body:{
      revision:5,
      completions:[
        completeOperation && {createdAt:Date.now(),envelope:completeOperation.envelope}
      ].filter(Boolean),
      definitions:[
        addOperation && {createdAt:Date.now(),envelope:addOperation.envelope}
      ].filter(Boolean)
    }});
    _agendaCompletionSyncAt = 0;
    const ownerFold = await syncHouseholdAgendaCompletions(ownerFeed,{force:true});
    const ownerAdded = load().find(h=>h.hid === addedId);
    const ownerFoldedCompletion = Boolean(ownerAdded && normalizeLogs(ownerAdded.logs).some(log=>
      log && typeof log === 'object' && log.source === 'shared_display'
    ));
    const adoptedRowId = Boolean(addOperation && ownerFold.feed.replicaRowIds
      && ownerFold.feed.replicaRowIds[addedId] === addOperation.decoded.rowId);
    const cloneCompleteMatched = Boolean(addOperation && completeOperation
      && completeOperation.decoded.rowId === addOperation.decoded.rowId
      && completeOperation.decoded.minutes === 9);
    const staleOperationId = shareRandomHex(16);
    const staleRowId = '44'.repeat(8);
    const staleHabit = {...load().find(h=>h.hid === sharedId),target:99};
    const staleEnvelope = await shareEncrypt(replicaKey,{
      schemaVersion:1,action:'upsert',operationId:staleOperationId,rowId:staleRowId,
      hid:sharedId,habit:replicaHabitDefinition(staleHabit),baseDefinitionHash:'deadbeef'
    },{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_definition',objectId:feedId,
      revision:5,operationId:staleOperationId,logId:staleRowId
    });
    shareFetch = async()=>({body:{revision:5,definitions:[{createdAt:Date.now(),envelope:staleEnvelope}],completions:[]}});
    _agendaCompletionSyncAt = 0;
    const staleFold = await syncHouseholdAgendaCompletions(ownerFold.feed,{force:true});
    const staleEditRejected = load().find(h=>h.hid === sharedId)?.target === 2
      && Boolean(staleFold.feed.definitionReceipts?.some(item=>item.operationId === staleOperationId && !item.accepted));
    const fatId = generateHabitId();
    const doneId = generateHabitId();
    const fatRow = 'aa'.repeat(8);
    const doneRow = 'bb'.repeat(8);
    const fatOp = shareRandomHex(16);
    const doneOp = shareRandomHex(16);
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId:shareRandomHex(16),
      meta:{revision:5},replicaMode:'clone',
      replicaRows:{
        [fatId]:{rowId:fatRow,access:'complete'},
        [doneId]:{rowId:doneRow,access:'complete'}
      },
      replicaOutbox:[
        {
          kind:'definition',operationId:fatOp,hid:fatId,action:'upsert',
          habit:{hid:fatId,name:'Rich item'},rowId:fatRow,createdAt:1
        },
        {operationId:doneOp,hid:doneId,rowId:doneRow,minutes:3,logKey:'n:1',createdAt:2}
      ]
    });
    const holPosted = [];
    _replicaFlushBusy = false;
    shareFetch = async(path,opts={})=>{
      if(String(path).includes('/definitions')){
        const error = new Error('payload_too_large');
        error.status = 413;
        throw error;
      }
      holPosted.push({path,envelope:opts.body && (opts.body.completion || opts.body.definition)});
      return {body:{},status:200};
    };
    await flushReplicaOutbox();
    const holRemaining = replicaEnrollment()?.replicaOutbox || [];
    const holCompletion = holPosted[0] && holPosted[0].envelope
      ? await shareDecrypt(contentKey,holPosted[0].envelope)
      : null;
    const holCompletionPosted = Boolean(holCompletion && holCompletion.action === 'complete' && holCompletion.minutes === 3
      && holPosted[0].path.endsWith('/completions'));
    const holDefinitionHeld = holRemaining.some(op=>op && op.operationId === fatOp && op.kind === 'definition');
    const holCompletionDrained = !holRemaining.some(op=>op && op.operationId === doneOp);
    const staleRow = 'cc'.repeat(8);
    const staleDoneOp = shareRandomHex(16);
    const pairingId = shareRandomHex(16);
    const snapHabit = makeHabit(doneId,'Posted after GET');
    const snapshotEnvelope = await shareEncrypt(contentKey,{
      replica:{
        schemaVersion:1,mode:'clone',definitionOwnerId:ownerId,
        items:[{rowId:staleRow,habit:snapHabit,access:'complete',definitionHash:replicaHabitDefinitionHash(snapHabit)}],
        settings:null,truncated:false,completionReceipts:[],definitionReceipts:[]
      },
      generatedAt:Date.now()
    },{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_snapshot',objectId:feedId,revision:6
    });
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId,
      meta:{revision:5},replicaMode:'clone',
      replicaRows:{ [doneId]:{rowId:staleRow,access:'complete'} },
      replicaOutbox:[{operationId:staleDoneOp,hid:doneId,rowId:staleRow,minutes:4,logKey:'n:1',createdAt:3}]
    });
    const stalePosted = [];
    _replicaFlushBusy = false;
    _replicaRefreshBusy = false;
    shareFetch = async(path,opts={})=>{
      if(!opts.method || opts.method === 'GET'){
        return {body:{revision:6,pairingId,snapshot:snapshotEnvelope},status:200};
      }
      const envelope = opts.body && (opts.body.completion || opts.body.definition);
      if(envelope && envelope.revision === 5){
        const error = new Error('stale_snapshot');
        error.status = 409;
        throw error;
      }
      stalePosted.push({path,envelope});
      return {body:{},status:200};
    };
    await flushReplicaOutbox();
    const staleRetry = stalePosted[0] && stalePosted[0].envelope
      ? await shareDecrypt(contentKey,stalePosted[0].envelope)
      : null;
    const staleRevisionRecovered = Boolean(staleRetry && staleRetry.action === 'complete' && staleRetry.minutes === 4
      && Number(replicaEnrollment()?.meta?.revision) === 6
      && !(replicaEnrollment()?.replicaOutbox || []).some(op=>op && op.operationId === staleDoneOp));
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId,
      meta:{revision:5},replicaMode:'clone',
      replicaRows:{ [doneId]:{rowId:staleRow,access:'complete'} },
      replicaOutbox:[{operationId:shareRandomHex(16),hid:doneId,rowId:staleRow,minutes:8,logKey:'n:2',createdAt:4}]
    });
    const refreshOrder = [];
    _replicaFlushBusy = false;
    _replicaRefreshBusy = false;
    shareFetch = async(path,opts={})=>{
      refreshOrder.push(opts.method || 'GET');
      if(!opts.method || opts.method === 'GET'){
        return {body:{revision:6,pairingId,snapshot:snapshotEnvelope},status:200};
      }
      return {body:{},status:200};
    };
    await refreshReplicaDevice();
    const refreshGetsFirst = refreshOrder[0] === 'GET' && refreshOrder.includes('POST');
    const wallCreatedId = generateHabitId();
    const wallCreated = makeHabit(wallCreatedId,'Kept private after mode switch');
    Storage.writeRaw(KEY,JSON.stringify([snapHabit,wallCreated]));
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId,
      meta:{revision:6},replicaMode:'clone',
      replicaRows:{
        [doneId]:{rowId:staleRow,access:'complete'},
        [wallCreatedId]:{rowId:'dd'.repeat(8),access:'complete'}
      },
      replicaPendingDefinitions:{
        [wallCreatedId]:{
          operationId:shareRandomHex(16),hid:wallCreatedId,action:'upsert',
          rowId:'dd'.repeat(8),habit:replicaHabitDefinition(wallCreated)
        }
      },
      replicaOutbox:[{
        kind:'definition',operationId:shareRandomHex(16),hid:wallCreatedId,action:'upsert',
        rowId:'dd'.repeat(8),habit:replicaHabitDefinition(wallCreated),createdAt:1
      }]
    });
    mergeReplicaSnapshot({
      schemaVersion:1,mode:'selected',definitionOwnerId:ownerId,
      ownershipPolicy:'single-writer-definition_additive-completions',
      items:[{rowId:staleRow,habit:snapHabit,access:'complete',definitionOwnerId:ownerId,definitionRevision:6}],
      settings:null,truncated:false,completionReceipts:[],definitionReceipts:[]
    },replicaEnrollment());
    const modeSwitchKept = Boolean(load().find(h=>h.hid===wallCreatedId));
    const modeSwitchDroppedDefs = !(replicaEnrollment()?.replicaOutbox || []).some(op=>op && op.kind === 'definition');
    const duplicateOp = shareRandomHex(16);
    const localDup = {ts:Date.now()-1000,minutes:11};
    const ownerDup = {ts:Date.now(),minutes:11,source:'shared_display',operationId:duplicateOp};
    Storage.writeRaw(KEY,JSON.stringify([makeHabit(doneId,'Dup fold',[localDup])]));
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId,
      meta:{revision:6},replicaMode:'clone',
      replicaRows:{ [doneId]:{rowId:staleRow,access:'complete'} },
      replicaPendingCompletions:{ [duplicateOp]:{hid:doneId,logKey:replicaLogKey(localDup)} },
      replicaOutbox:[]
    });
    mergeReplicaSnapshot({
      schemaVersion:1,mode:'clone',definitionOwnerId:ownerId,
      items:[{
        rowId:staleRow,
        habit:makeHabit(doneId,'Dup fold',[ownerDup]),
        access:'complete',definitionOwnerId:ownerId,definitionRevision:6
      }],
      settings:null,truncated:false,completionReceipts:[],definitionReceipts:[]
    },replicaEnrollment());
    const folded = load().find(h=>h.hid===doneId);
    const noDoubleCount = Boolean(folded && replicaActualLogs(folded).length === 1);
    const duplicateChunkId = generateHabitId();
    const duplicateChunkRow = 'de'.repeat(8);
    const duplicateChunkTs = dayStart(Date.now());
    const duplicateChunkBefore = [normalize([{
      hid:duplicateChunkId,name:'Repeated chunks',type:'keepup',target:1,
      breakable:true,durationMinutes:60,minChunkMinutes:15,
      logs:[{ts:duplicateChunkTs,minutes:15}]
    }])[0]];
    const duplicateChunkNext = JSON.parse(JSON.stringify(duplicateChunkBefore));
    duplicateChunkNext[0].logs.push({ts:duplicateChunkTs,minutes:15});
    Storage.writeRaw(KEY,JSON.stringify(duplicateChunkBefore));
    writeReplicaEnrollment({
      feedId,deviceCredential,contentKey,replicaKey,pairingId,
      meta:{revision:6},replicaMode:'clone',
      replicaRows:{ [duplicateChunkId]:{rowId:duplicateChunkRow,access:'complete'} },
      replicaOutbox:[],replicaPendingCompletions:{}
    });
    const duplicateChunkPosts = [];
    _replicaFlushBusy = false;
    shareFetch = async(path,opts={})=>{
      if(opts.method === 'POST' && opts.body && opts.body.completion){
        duplicateChunkPosts.push(opts.body.completion);
      }
      return {body:{},status:200};
    };
    save(duplicateChunkNext);
    const stampedDuplicateChunks = load();
    const duplicateDeadline = Date.now()+2000;
    while(!duplicateChunkPosts.length && Date.now()<duplicateDeadline){
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const duplicateChunkPayload = duplicateChunkPosts[0]
      ? await shareDecrypt(contentKey,duplicateChunkPosts[0])
      : null;
    const duplicateChunkOperationId = duplicateChunkPayload && duplicateChunkPayload.operationId;
    const duplicateChunkKeys = replicaActualLogs(stampedDuplicateChunks[0]).map(replicaLogKey);
    const duplicateChunksDistinct = duplicateChunkKeys.length === 2
      && new Set(duplicateChunkKeys).size === 2
      && duplicateChunkPayload && duplicateChunkPayload.minutes === 15;
    const duplicateChunkDiagnostic = {
      keys:duplicateChunkKeys,
      postCount:duplicateChunkPosts.length,
      payload:duplicateChunkPayload
    };
    const echoedDuplicate = {
      ts:duplicateChunkTs,minutes:15,source:'shared_display',operationId:duplicateChunkOperationId
    };
    const duplicateOwnerHabit = JSON.parse(JSON.stringify(duplicateChunkBefore[0]));
    duplicateOwnerHabit.logs.push(echoedDuplicate);
    mergeReplicaSnapshot({
      schemaVersion:1,mode:'clone',definitionOwnerId:ownerId,
      items:[{
        rowId:duplicateChunkRow,habit:duplicateOwnerHabit,
        access:'complete',definitionOwnerId:ownerId,definitionRevision:6
      }],
      settings:null,truncated:false,
      completionReceipts:[duplicateChunkOperationId],definitionReceipts:[]
    },replicaEnrollment());
    const duplicateChunksFoldOnce = replicaActualLogs(load().find(h=>h.hid===duplicateChunkId)).length === 2;
    const queuedOfflineOps = Array.from({length:60},(_,index)=>({
      operationId:index.toString(16).padStart(32,'0'),
      hid:duplicateChunkId,rowId:duplicateChunkRow,minutes:15,
      logKey:`op:${index.toString(16).padStart(32,'0')}`,createdAt:index
    }));
    const offlineQueueKeepsAll = unionReplicaOps(queuedOfflineOps,[]).length === 60;
    const failedSaveOperationId = shareRandomHex(16);
    const failedSaveHabit = JSON.parse(JSON.stringify(load().find(h=>h.hid === duplicateChunkId)));
    const failedSaveCandidate = {...failedSaveHabit,name:'Must not acknowledge'};
    const failedSaveEnvelope = await shareEncrypt(replicaKey,{
      schemaVersion:1,action:'upsert',operationId:failedSaveOperationId,rowId:duplicateChunkRow,
      hid:duplicateChunkId,habit:replicaHabitDefinition(failedSaveCandidate),
      baseDefinitionHash:replicaHabitDefinitionHash(failedSaveHabit)
    },{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_definition',objectId:feedId,
      revision:6,operationId:failedSaveOperationId,logId:duplicateChunkRow
    });
    const saveBeforeFailure = save;
    save = ()=>false;
    shareFetch = async()=>({body:{
      revision:6,definitions:[{createdAt:Date.now(),envelope:failedSaveEnvelope}],completions:[]
    }});
    _agendaCompletionSyncAt = 0;
    const failedSaveFold = await syncHouseholdAgendaCompletions({
      ...ownerFeed,lastRevision:6,
      replicaRowIds:{[duplicateChunkId]:duplicateChunkRow}
    },{force:true});
    save = saveBeforeFailure;
    const failedSaveNotAcknowledged = !failedSaveFold.operationIds.includes(failedSaveOperationId)
      && !failedSaveFold.feed.definitionReceipts?.some(item=>item.operationId === failedSaveOperationId)
      && load().find(h=>h.hid === duplicateChunkId)?.name !== 'Must not acknowledge';
    history.replaceState(null,'',location.pathname + '?display=1');
    mountReplicaDisplayMode();
    const barBox = document.querySelector('.replica-display-bar')?.getBoundingClientRect();
    const appBox = document.querySelector('.app')?.getBoundingClientRect();
    const logoBox = document.querySelector('.app-bar-logo')?.getBoundingClientRect();
    const chromeLayout = {
      top:barBox ? Math.round(barBox.top) : null,
      left:barBox ? Math.round(barBox.left) : null,
      width:barBox ? Math.round(barBox.width) : null,
      besideApp:Boolean(barBox && appBox && barBox.left >= appBox.right - 8),
      logoVisible:Boolean(logoBox && logoBox.width > 8 && logoBox.left >= 0 && logoBox.left < window.innerWidth),
      hideControl:Boolean(document.getElementById('replica-hide-button')),
      settingsToggle:Boolean(document.getElementById('settings-replica-chrome')),
      searchVisible:getComputedStyle(document.getElementById('bar-open-search')).display !== 'none'
    };
    document.getElementById('replica-lock-button')?.click();
    const lock = document.getElementById('replica-lock');
    lock?.click(); lock?.click(); lock?.click();
    document.getElementById('replica-hide-button')?.click();
    const chromeHidden = {
      bodyClass:document.body.classList.contains('replica-chrome-hidden'),
      barHidden:Boolean(document.querySelector('.replica-display-bar')?.hidden),
      stored:localStorage.getItem('tings_replica_chrome_hidden_v1') === '1',
      toggleOff:document.getElementById('settings-replica-chrome')?.getAttribute('aria-pressed') === 'false'
    };
    document.getElementById('settings-replica-chrome')?.click();
    const chromeRestored = {
      bodyClass:document.body.classList.contains('replica-chrome-hidden'),
      barHidden:Boolean(document.querySelector('.replica-display-bar')?.hidden),
      stored:localStorage.getItem('tings_replica_chrome_hidden_v1') === '1'
    };
    return {
      ownerCadence:mergedShared && mergedShared.target,
      peerEditBlocked:rejectedDefinitionEdit.find(h=>h.hid===sharedId)?.target === 2
        && rejectedDefinitionEdit.find(h=>h.hid===sharedId)?.name === 'Owner changed cadence',
      keptLocalLog:mergedShared && mergedShared.logs.length === 2,
      removedGone:!merged.some(h=>h.hid===removedId),
      privateKept:Boolean(merged.find(h=>h.hid===privateId)),
      ownerStored,
      postedCompletion:payload && payload.action === 'complete' && payload.minutes === 17,
      outboxEmpty,
      outboxSurvived,
      viewLogsBlocked,
      logTingBlocked,
      logTingBlockedWithoutQuery,
      cloneQueuedAdd:Boolean(addOperation && addOperation.decoded.habit.name === 'Added on the wall display'),
      cloneDefinitionKind:Boolean(addOperation && addOperation.envelope.recordKind === 'agenda_definition'
        && clonePaths.some(path=>/\/definitions$/.test(path))),
      cloneCompletionKind:Boolean(completeOperation && completeOperation.envelope.recordKind === 'agenda_completion'
        && clonePaths.some(path=>/\/completions$/.test(path))),
      cloneCompleteMatched,
      ownerFoldedAdd:Boolean(ownerAdded && ownerAdded.name === 'Added on the wall display'),
      ownerFoldedCompletion,
      adoptedRowId,
      acceptedReceipt:Boolean(ownerFold.feed.definitionReceipts?.some(item=>item.operationId === addOperation?.decoded.operationId && item.accepted)),
      staleEditRejected,
      holCompletionPosted,
      holDefinitionHeld,
      holCompletionDrained,
      staleRevisionRecovered,
      refreshGetsFirst,
      modeSwitchKept,
      modeSwitchDroppedDefs,
      noDoubleCount,
      duplicateChunksDistinct,
      duplicateChunksFoldOnce,
      offlineQueueKeepsAll,
      failedSaveNotAcknowledged,
      duplicateChunkDiagnostic,
      chrome:Boolean(document.querySelector('.replica-display-bar')),
      clock:Boolean(document.querySelector('[data-replica-time]')?.textContent),
      addVisible:getComputedStyle(document.getElementById('open-add')).display !== 'none',
      unlocked:Boolean(lock && lock.hidden),
      chromeLayout,
      chromeHidden,
      chromeRestored
    };
  });
  console.log('\n--- Device replica sync ---\n');
  assert(result.ownerCadence === 2,'the definition owner’s cadence revision wins');
  assert(result.peerEditBlocked,'a paired device cannot overwrite an owner-managed definition');
  assert(result.keptLocalLog,'owner history and an offline local completion merge additively');
  assert(result.removedGone,'an owner removal or unshare removes the old replica');
  assert(result.privateKept,'shared-items mode preserves device-private habits');
  assert(result.ownerStored,'the paired device records who owns shared definitions');
  assert(result.postedCompletion && result.outboxEmpty,'a local completion is encrypted, sent, and removed from the outbox');
  assert(result.outboxSurvived,'a completion queued during an in-flight snapshot GET is kept');
  assert(result.viewLogsBlocked && result.logTingBlocked,'view-only shared items cannot be marked done on the paired full app');
  assert(result.logTingBlockedWithoutQuery,'view-only stays blocked when the installed PWA launches without ?display=1');
  assert(result.cloneQueuedAdd,'personal clone encrypts and queues a habit created on the display');
  assert(result.cloneDefinitionKind,'clone definition ops use the 64 KiB agenda_definition envelope');
  assert(result.cloneCompletionKind && result.cloneCompleteMatched,'a completion on that new habit uses the 4 KiB completion envelope and the same row id');
  assert(result.ownerFoldedAdd && result.acceptedReceipt,'the primary device folds the new habit in and publishes an acceptance receipt');
  assert(result.ownerFoldedCompletion && result.adoptedRowId,'the owner adopts the display row id and folds the matching completion log');
  assert(result.staleEditRejected,'a stale concurrent definition edit is rejected instead of overwriting newer data');
  assert(result.holCompletionPosted && result.holDefinitionHeld && result.holCompletionDrained,
    'a 413 clone definition stays queued instead of blocking later completions');
  assert(result.staleRevisionRecovered,'a 409 stale snapshot GET updates revision and retries the queued completion');
  assert(result.refreshGetsFirst,'display refresh pulls the snapshot before flushing the outbox');
  assert(result.modeSwitchKept && result.modeSwitchDroppedDefs,
    'switching to shared-items keeps unpublished display items private and drops clone definition ops');
  assert(result.noDoubleCount,'owner-applied completions are not folded again when receipts have slid off');
  assert(result.duplicateChunksDistinct,
    `identical same-time breakable chunks get distinct operation ids and sync (${JSON.stringify(result.duplicateChunkDiagnostic)})`);
  assert(result.duplicateChunksFoldOnce,'the echoed identical chunk folds exactly once');
  assert(result.offlineQueueKeepsAll,'more than 50 offline operations remain queued locally until they can drain');
  assert(result.failedSaveNotAcknowledged,'an accepted definition is retried when owner persistence fails');
  assert(result.chrome && result.clock,'display mode shows a live current-time chrome');
  assert(result.addVisible,'personal clone keeps the normal add-task and add-habit action available');
  assert(result.unlocked,'three taps dismiss the display lock screen');
  assert(result.chromeLayout && result.chromeLayout.top <= 8 && result.chromeLayout.left <= 8
    && result.chromeLayout.width > 700 && !result.chromeLayout.besideApp,
    `the display bar spans the top of the window instead of a right-hand column (${JSON.stringify(result.chromeLayout)})`);
  assert(result.chromeLayout.logoVisible && result.chromeLayout.hideControl && result.chromeLayout.settingsToggle
    && result.chromeLayout.searchVisible,
    'desktop Tings chrome stays visible and the bar can be hidden from the bar or settings');
  assert(result.chromeHidden && result.chromeHidden.bodyClass && result.chromeHidden.barHidden
    && result.chromeHidden.stored && result.chromeHidden.toggleOff,
    'hide puts the clone on the normal Tings window and remembers that choice');
  assert(result.chromeRestored && !result.chromeRestored.bodyClass && !result.chromeRestored.barHidden
    && !result.chromeRestored.stored,
    'settings appearance can show the display bar again');

  const libraryPull = await page.evaluate(async()=>{
    const contentKey = shareRandomHex(32);
    const replicaKey = shareRandomHex(32);
    const feedId = shareRandomHex(16);
    const pairingId = shareRandomHex(16);
    const hid = generateHabitId();
    const habit = normalize([{
      hid,name:'Pulled from sealed library',type:'keepup',target:1,logs:[],durationMinutes:30
    }])[0];
    const replica = {
      schemaVersion:1,mode:'clone',generatedAt:Date.now(),
      items:[{ rowId:shareRandomHex(8),habit,access:'complete',definitionHash:'abc' }],
      settings:null,truncated:false
    };
    const replicaEnvelope = await shareEncrypt(replicaKey,replica,{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_replica',objectId:feedId,revision:2
    });
    const snapshot = await shareEncrypt(contentKey,{
      schemaVersion:SHARE_SCHEMA_VERSION,feedId,days:[]
    },{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_snapshot',objectId:feedId,revision:2
    });
    const glanceSnapshot = await shareEncrypt(contentKey,{
      schemaVersion:SHARE_SCHEMA_VERSION,feedId,days:[]
    },{
      schemaVersion:SHARE_SCHEMA_VERSION,recordKind:'agenda_snapshot',objectId:feedId,revision:1
    });
    writeReplicaEnrollment({
      feedId,deviceCredential:shareRandomHex(32),contentKey,replicaKey,pairingId,syncMode:'clone'
    });
    Storage.writeRaw(KEY,JSON.stringify([]));
    shareFetch = async()=>({ body:{ snapshot:glanceSnapshot,revision:1,pairingId,completions:[] } });
    _replicaPull = null;
    const waiting = await pullReplicaSnapshot();
    const waitingMode = replicaEnrollment() && replicaEnrollment().replicaMode;
    shareFetch = async()=>({ body:{ snapshot,replica:replicaEnvelope,revision:2,pairingId,completions:[] } });
    _replicaPull = null;
    const pulled = await pullReplicaSnapshot();
    return {
      waitingNull:waiting == null,
      waitingMode:waitingMode || null,
      pulledMode:pulled && pulled.mode,
      names:load().map(h=>h && h.name),
      storedMode:replicaEnrollment() && replicaEnrollment().replicaMode
    };
  });
  assert(libraryPull.waitingNull && !libraryPull.waitingMode,
    `a glance-only snapshot leaves the clone waiting instead of installing an empty library (${JSON.stringify(libraryPull)})`);
  assert(libraryPull.pulledMode === 'clone' && libraryPull.storedMode === 'clone'
    && libraryPull.names.includes('Pulled from sealed library'),
    `the clone installs habits from the sibling replica envelope (${JSON.stringify(libraryPull)})`);

  // Glance display: the phone publishes no replica, so the screen must never
  // install a library or mount the full-app planner.
  const glanceContext = await browser.newContext({serviceWorkers:'block'});
  const glancePage = await glanceContext.newPage();
  await glancePage.goto(baseUrl,{waitUntil:'load'});
  const glanceClassify = await glancePage.evaluate(()=>{
    const base = {
      feedId:shareRandomHex(16),
      deviceCredential:shareRandomHex(32),
      contentKey:shareRandomHex(32),
      pairingId:shareRandomHex(16)
    };
    localStorage.setItem(AGENDA_DISPLAY_KEY,JSON.stringify(base));
    return {
      glanceDetected:replicaEnrollmentIsGlance(base),
      cloneNotGlance:replicaEnrollmentIsGlance({...base,replicaMode:'clone',replicaRows:{}}),
      selectedNotGlance:replicaEnrollmentIsGlance({...base,replicaMode:'selected',replicaRows:{}}),
      clonePendingNotGlance:replicaEnrollmentIsGlance({
        ...base,syncMode:'clone',replicaKey:shareRandomHex(32)
      }),
      selectedPendingNotGlance:replicaEnrollmentIsGlance({
        ...base,syncMode:'selected',replicaKey:shareRandomHex(32)
      }),
      replicaKeyWantsApp:typeof sharedDisplayWantsFullApp === 'function'
        && sharedDisplayWantsFullApp({...base,replicaKey:shareRandomHex(32)}),
      glanceKeepsKiosk:typeof sharedDisplayWantsFullApp === 'function'
        && sharedDisplayWantsFullApp({...base,syncMode:'glance'}) === false
    };
  });
  await glancePage.goto(`${baseUrl}index.html?display=1`,{waitUntil:'load'});
  await glancePage.waitForLoadState('load');
  const glanceLanding = await glancePage.evaluate(async()=>({
    path:location.pathname,
    replicaChrome:Boolean(document.querySelector('.replica-display-bar')),
    // agenda-display.js is only loaded on the kiosk page, so reaching it here
    // also proves the redirect landed.
    stayedOnKiosk:typeof installDisplayReplica === 'function'
      && await installDisplayReplica({generatedAt:Date.now(),days:[]},displayReadEnrollment()),
    stillEnrolled:Boolean(displayReadEnrollment())
  }));
  assert(glanceClassify.glanceDetected
    && !glanceClassify.cloneNotGlance
    && !glanceClassify.selectedNotGlance,
    'an enrollment that never installed a replica is recognized as a glance display');
  assert(glanceClassify.clonePendingNotGlance === false
    && glanceClassify.selectedPendingNotGlance === false
    && glanceClassify.replicaKeyWantsApp
    && glanceClassify.glanceKeepsKiosk,
    'a just-paired clone is not treated as a glance while it waits for the library snapshot');
  assert(glanceLanding.path.endsWith('/agenda-display.html') && !glanceLanding.replicaChrome,
    'a glance display opening index.html is sent back to the kiosk instead of mounting the full app');
  assert(glanceLanding.stayedOnKiosk === false && glanceLanding.stillEnrolled,
    'a snapshot without a replica block keeps the paired kiosk in place instead of installing a library');

  const clonePendingContext = await browser.newContext({
    serviceWorkers:'block',
    viewport:{width:1024,height:768}
  });
  const clonePendingPage = await clonePendingContext.newPage();
  const displayUrl = new URL('agenda-display.html',baseUrl).href;
  await clonePendingPage.goto(baseUrl,{waitUntil:'load'});
  await clonePendingPage.evaluate(()=>{
    localStorage.setItem(AGENDA_DISPLAY_KEY,JSON.stringify({
      feedId:shareRandomHex(16),
      deviceCredential:shareRandomHex(32),
      contentKey:shareRandomHex(32),
      replicaKey:shareRandomHex(32),
      pairingId:shareRandomHex(16),
      syncMode:'clone'
    }));
  });
  await clonePendingPage.route(/habits-share/,route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({ revision:0,snapshot:null })
  }));
  await clonePendingPage.goto(displayUrl,{waitUntil:'load'});
  await clonePendingPage.waitForURL(/index\.html/,{timeout:10000});
  await clonePendingPage.waitForSelector('.replica-display-bar',{timeout:5000});
  const clonePendingLanding = await clonePendingPage.evaluate(()=>{
    const bar = document.querySelector('.replica-display-bar')?.getBoundingClientRect();
    const logo = (document.querySelector('.app-bar-logo') || document.querySelector('.wordmark'))?.getBoundingClientRect();
    return {
      path:location.pathname,
      displayQuery:new URLSearchParams(location.search).get('display'),
      replicaChrome:Boolean(document.querySelector('.replica-display-bar')),
      bouncedToKiosk:typeof installDisplayReplica === 'function',
      wantsFullApp:typeof sharedDisplayWantsFullApp === 'function'
        && sharedDisplayWantsFullApp(replicaEnrollment()),
      glance:replicaEnrollmentIsGlance(replicaEnrollment()),
      barLeft:bar ? Math.round(bar.left) : null,
      barWidth:bar ? Math.round(bar.width) : null,
      logoVisible:Boolean(logo && logo.width > 8 && logo.left >= 0)
    };
  });
  assert(clonePendingLanding.path.endsWith('/index.html')
    && clonePendingLanding.displayQuery === '1'
    && clonePendingLanding.replicaChrome
    && !clonePendingLanding.bouncedToKiosk
    && clonePendingLanding.wantsFullApp
    && clonePendingLanding.glance === false
    && clonePendingLanding.barLeft <= 8
    && clonePendingLanding.barWidth > 700
    && clonePendingLanding.logoVisible,
    `a clone enrollment on the kiosk URL opens the full app before a replica snapshot exists (${JSON.stringify(clonePendingLanding)})`);

  const revokeContext = await browser.newContext({
    serviceWorkers:'block',
    viewport:{width:1024,height:768}
  });
  const revokePage = await revokeContext.newPage();
  await revokePage.goto(baseUrl,{waitUntil:'load'});
  await revokePage.evaluate(()=>{
    localStorage.setItem(AGENDA_DISPLAY_KEY,JSON.stringify({
      feedId:shareRandomHex(16),
      deviceCredential:shareRandomHex(32),
      contentKey:shareRandomHex(32),
      replicaKey:shareRandomHex(32),
      pairingId:shareRandomHex(16),
      syncMode:'clone'
    }));
  });
  await revokePage.route(/habits-share/,route=>route.fulfill({
    status:410,contentType:'application/json',
    body:JSON.stringify({ error:'revoked' })
  }));
  await revokePage.goto(new URL('index.html?display=1',baseUrl).href,{waitUntil:'load'});
  await revokePage.waitForURL(/agenda-display/,{timeout:10000});
  await revokePage.waitForTimeout(1500);
  const revokeLanding = await revokePage.evaluate(()=>({
    path:location.pathname,
    displayQuery:new URLSearchParams(location.search).get('display'),
    enrollment:localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v4'),
    ended:typeof sharedDisplaySessionEnded === 'function' && sharedDisplaySessionEnded()
  }));
  await revokePage.waitForTimeout(1500);
  const stillRevoked = await revokePage.evaluate(()=>({
    path:location.pathname,
    enrollment:localStorage.getItem(typeof AGENDA_DISPLAY_KEY !== 'undefined' ? AGENDA_DISPLAY_KEY : 'tings_agenda_display_v4')
  }));
  assert(revokeLanding.path.endsWith('/agenda-display.html') && !revokeLanding.enrollment,
    `signing out a clone forgets local pairing instead of bouncing to the full app (${JSON.stringify(revokeLanding)})`);
  assert(stillRevoked.path.endsWith('/agenda-display.html') && !stillRevoked.enrollment,
    'a signed-out clone stays on the pairing page instead of looping with index.html');
  await revokeContext.close();
  await clonePendingContext.close();
  await glanceContext.close();
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(error=>{ console.error(error); process.exitCode=1; });
