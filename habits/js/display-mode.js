// Full-app shared-display mode. A paired display owns a normal local Tings
// database and planner; the encrypted agenda endpoint is only its replication
// transport. This keeps the display useful while the owner phone is closed.

const REPLICA_DISPLAY_POLL_MS = 3 * 60 * 1000;
const REPLICA_DISPLAY_TIMEOUT_MS = 15 * 1000;
const REPLICA_CHROME_HIDDEN_KEY = 'tings_replica_chrome_hidden_v1';
let _replicaRefreshBusy = false;
let _replicaFlushBusy = false;
let _replicaPull = null;
let _replicaClockTimer = null;
let _replicaPollTimer = null;
let _replicaChromeBound = false;

function replicaEnrollmentActive(){
  const enrolled = replicaEnrollment();
  return Boolean(enrolled && enrolled.feedId && enrolled.deviceCredential && enrolled.contentKey);
}

function replicaDisplayQueryRequested(){
  try{ return new URLSearchParams(location.search).get('display') === '1'; }
  catch(_){ return false; }
}

// Installed PWAs launch manifest start_url without ?display=1. Enrollment on
// this origin means this device is the paired display, not the owner phone.
function replicaDisplayRequested(){
  return replicaEnrollmentActive() || replicaDisplayQueryRequested();
}

function ensureReplicaDisplayQuery(){
  if(replicaDisplayQueryRequested()) return;
  try{
    const url = new URL(location.href);
    url.searchParams.set('display','1');
    history.replaceState(null,'',url.pathname + url.search + url.hash);
  }catch(_){ }
}

function replicaEnrollment(){
  try{ return JSON.parse(localStorage.getItem(AGENDA_DISPLAY_KEY) || 'null'); }
  catch(_){ return null; }
}

function writeReplicaEnrollment(value){
  try{
    if(value) localStorage.setItem(AGENDA_DISPLAY_KEY,JSON.stringify(value));
    else localStorage.removeItem(AGENDA_DISPLAY_KEY);
  }catch(_){ }
}

function replicaLogFingerprint(log){
  if(typeof log === 'number') return `n:${log}`;
  if(!log || typeof log !== 'object') return '';
  return `o:${Number(log.ts) || 0}|${Number(log.minutes) || ''}|${Number(log.value) || ''}|${String(log.note || '')}`;
}

function replicaLogOperationId(log){
  const operationId = log && typeof log === 'object' ? String(log.operationId || '') : '';
  return /^[0-9a-f]{32}$/.test(operationId) ? operationId : '';
}

function replicaLogKey(log){
  const operationId = replicaLogOperationId(log);
  return operationId ? `op:${operationId}` : replicaLogFingerprint(log);
}

function replicaLogIsActual(log){
  if(log && typeof log === 'object' && log.plan) return false;
  const ts = Number(log && typeof log === 'object' ? log.ts : log);
  return Number.isFinite(ts) && ts > 0 && ts <= Date.now() + 60000;
}

function replicaActualLogs(habit){
  return (Array.isArray(habit && habit.logs) ? habit.logs : []).filter(replicaLogIsActual);
}

function replicaDeviceBlocksCompletion(hid){
  if(!replicaDisplayRequested()) return false;
  const enrolled = replicaEnrollment();
  if(!enrolled || enrolled.replicaMode === 'clone') return false;
  const binding = enrolled.replicaRows && hid && enrolled.replicaRows[hid];
  return Boolean(binding && binding.access === 'view');
}

// Give every completion created on the replica a durable identity before
// save() writes it. Habit timestamps are deliberately snapped to a day/window
// boundary, so content alone cannot distinguish two equal-sized chunks.
function stampReplicaCompletionIds(previous,next,enrolled){
  const priorByHid = new Map((Array.isArray(previous) ? previous : [])
    .filter(h=>h && h.hid).map(h=>[h.hid,replicaActualLogs(h)]));
  for(const habit of (Array.isArray(next) ? next : [])){
    const binding = enrolled && enrolled.replicaRows && habit && enrolled.replicaRows[habit.hid];
    if(!binding || binding.access !== 'complete' || !Array.isArray(habit.logs)) continue;
    const prior = priorByHid.get(habit.hid) || [];
    const used = new Set();
    const priorByOperation = new Map();
    for(let i=0;i<prior.length;i++){
      const operationId = replicaLogOperationId(prior[i]);
      if(operationId) priorByOperation.set(operationId,i);
    }
    // Preserve explicit identities first, independent of equal-log ordering.
    for(const log of replicaActualLogs(habit)){
      const operationId = replicaLogOperationId(log);
      const index = operationId ? priorByOperation.get(operationId) : null;
      if(index != null) used.add(index);
    }
    habit.logs = habit.logs.map(log=>{
      if(!replicaLogIsActual(log)) return log;
      if(replicaLogOperationId(log)) return log;
      const fingerprint = replicaLogFingerprint(log);
      const priorIndex = prior.findIndex((candidate,index)=>
        !used.has(index) && replicaLogFingerprint(candidate) === fingerprint
      );
      if(priorIndex >= 0){
        used.add(priorIndex);
        const priorOperationId = replicaLogOperationId(prior[priorIndex]);
        if(!priorOperationId) return log;
        return {
          ...(typeof log === 'object' ? log : {ts:Number(log)}),
          source:'shared_display',operationId:priorOperationId
        };
      }
      return {
        ...(typeof log === 'object' ? log : {ts:Number(log)}),
        source:'shared_display',operationId:shareRandomHex(16)
      };
    });
  }
  return next;
}

function unionReplicaOps(primary,secondary){
  const out = [];
  const seenOp = new Set();
  const seenDefHid = new Set();
  for(const op of [...(Array.isArray(primary) ? primary : []),...(Array.isArray(secondary) ? secondary : [])]){
    if(!op || !op.operationId || seenOp.has(op.operationId)) continue;
    if(op.kind === 'definition'){
      if(seenDefHid.has(op.hid)) continue;
      seenDefHid.add(op.hid);
    }
    seenOp.add(op.operationId);
    out.push(op);
  }
  out.sort((a,b)=>{
    const ak = a && a.kind === 'definition' ? 0 : 1;
    const bk = b && b.kind === 'definition' ? 0 : 1;
    if(ak !== bk) return ak - bk;
    return (Number(a && a.createdAt) || 0) - (Number(b && b.createdAt) || 0);
  });
  // The Worker can hold at most 100 pending records at once, but that is a
  // server-side backpressure limit rather than a local durability limit. Keep
  // every unsent operation here; flushReplicaOutbox drains them as the owner
  // consumes and acknowledges batches.
  return out;
}

// Snapshot merge and same-revision GET writes replace the whole enrollment
// record. Re-read localStorage and union by operationId so a completion saved
// while a GET is in flight is not wiped.
function adoptLiveReplicaQueues(enrolled){
  const live = replicaEnrollment();
  if(!enrolled || !live) return enrolled;
  enrolled.replicaOutbox = unionReplicaOps(live.replicaOutbox,enrolled.replicaOutbox);
  enrolled.replicaPendingDefinitions = {
    ...(enrolled.replicaPendingDefinitions && typeof enrolled.replicaPendingDefinitions === 'object'
      ? enrolled.replicaPendingDefinitions : {}),
    ...(live.replicaPendingDefinitions && typeof live.replicaPendingDefinitions === 'object'
      ? live.replicaPendingDefinitions : {})
  };
  enrolled.replicaPendingCompletions = {
    ...(enrolled.replicaPendingCompletions && typeof enrolled.replicaPendingCompletions === 'object'
      ? enrolled.replicaPendingCompletions : {}),
    ...(live.replicaPendingCompletions && typeof live.replicaPendingCompletions === 'object'
      ? live.replicaPendingCompletions : {})
  };
  return enrolled;
}

function replicaSnapshotOperationIds(replica){
  const ids = new Set();
  for(const item of (Array.isArray(replica && replica.items) ? replica.items : [])){
    const logs = item && item.habit && Array.isArray(item.habit.logs) ? item.habit.logs : [];
    for(const log of logs){
      const operationId = log && typeof log === 'object' ? String(log.operationId || '') : '';
      if(operationId) ids.add(operationId);
    }
  }
  return ids;
}

function applyReplicaSnapshotReceipts(enrolled,replica){
  const pendingCompletions = enrolled.replicaPendingCompletions && typeof enrolled.replicaPendingCompletions === 'object'
    ? {...enrolled.replicaPendingCompletions}
    : {};
  const pendingDefinitions = enrolled.replicaPendingDefinitions && typeof enrolled.replicaPendingDefinitions === 'object'
    ? {...enrolled.replicaPendingDefinitions}
    : {};
  const acknowledgedLogKeys = new Set();
  const acknowledgedIds = new Set();
  const receiptIds = [
    ...(Array.isArray(replica && replica.completionReceipts) ? replica.completionReceipts : []),
    ...replicaSnapshotOperationIds(replica)
  ];
  for(const operationId of receiptIds){
    const pending = pendingCompletions[operationId];
    if(pending){
      acknowledgedLogKeys.add(`${pending.hid}|${pending.logKey}`);
      delete pendingCompletions[operationId];
    }
    if(operationId) acknowledgedIds.add(operationId);
  }
  const receipts = new Map((Array.isArray(replica && replica.definitionReceipts) ? replica.definitionReceipts : [])
    .filter(item=>item && item.operationId).map(item=>[item.operationId,item]));
  for(const [hid,pending] of Object.entries(pendingDefinitions)){
    if(pending && receipts.has(pending.operationId)){
      delete pendingDefinitions[hid];
      acknowledgedIds.add(pending.operationId);
    }
  }
  enrolled.replicaPendingCompletions = pendingCompletions;
  enrolled.replicaPendingDefinitions = pendingDefinitions;
  enrolled.replicaOutbox = (Array.isArray(enrolled.replicaOutbox) ? enrolled.replicaOutbox : [])
    .filter(op=>!op || !acknowledgedIds.has(op.operationId));
  return acknowledgedLogKeys;
}

function replicaCompletionBinding(enrolled,hid){
  if(!enrolled || !hid) return null;
  if(!enrolled.replicaRows || typeof enrolled.replicaRows !== 'object') enrolled.replicaRows = {};
  const existing = enrolled.replicaRows[hid];
  if(existing && existing.access === 'view') return existing;
  if(existing && /^[0-9a-f]{16}$/.test(String(existing.rowId || ''))) return existing;
  if(enrolled.replicaMode !== 'clone') return existing || null;
  const pending = enrolled.replicaPendingDefinitions && enrolled.replicaPendingDefinitions[hid];
  const fromPending = String(pending && pending.rowId || '');
  const fromExisting = String(existing && existing.rowId || '');
  const rowId = /^[0-9a-f]{16}$/.test(fromPending)
    ? fromPending
    : (/^[0-9a-f]{16}$/.test(fromExisting) ? fromExisting : shareRandomHex(8));
  if(pending) pending.rowId = rowId;
  const binding = {
    rowId,
    access:'complete',
    definitionHash:String((pending && pending.definitionHash) || (existing && existing.definitionHash) || '')
  };
  enrolled.replicaRows[hid] = binding;
  return binding;
}

function queueReplicaCompletion(enrolled,habit,log,binding){
  const key = replicaLogKey(log);
  if(!key || !habit || !habit.hid || !binding || binding.access !== 'complete') return false;
  const existingOperationId = replicaLogOperationId(log);
  if(existingOperationId && replicaOwnOperationIds(enrolled).has(existingOperationId)) return false;
  const outbox = Array.isArray(enrolled.replicaOutbox) ? enrolled.replicaOutbox.slice() : [];
  const pendingCompletions = enrolled.replicaPendingCompletions && typeof enrolled.replicaPendingCompletions === 'object'
    ? {...enrolled.replicaPendingCompletions}
    : {};
  if(outbox.some(op=>op && op.hid === habit.hid && op.logKey === key)) return false;
  if(Object.values(pendingCompletions).some(pending=>pending && pending.hid === habit.hid && pending.logKey === key)) return false;
  const operationId = existingOperationId || shareRandomHex(16);
  const completedAt = Number(log && typeof log === 'object' ? log.ts : log) || Date.now();
  const scheduledDay = /^\d{4}-\d{2}-\d{2}$/.test(String(log && log.scheduledDay || ''))
    ? String(log.scheduledDay)
    : (typeof dateKey === 'function' ? dateKey(completedAt) : '');
  outbox.push({
    operationId,hid:habit.hid,rowId:binding.rowId,logKey:key,
    minutes:Math.max(0,Math.round(Number(log && log.minutes) || 0)),
    occurrenceKey:String(log && log.occurrenceKey || '').slice(0,160),
    scheduleOptionId:String(log && log.scheduleOptionId || '').slice(0,64),
    scheduledDay,
    start:Number(log && log.start) || 0,
    completedAt,
    createdAt:Date.now()
  });
  pendingCompletions[operationId] = {hid:habit.hid,logKey:key};
  enrolled.replicaOutbox = unionReplicaOps(outbox,[]);
  enrolled.replicaPendingCompletions = pendingCompletions;
  return true;
}

function foldReplicaLocalLogs(habits,localById,acknowledgedLogKeys,pendingCompletions){
  const pending = pendingCompletions && typeof pendingCompletions === 'object' ? pendingCompletions : {};
  for(const habit of habits){
    const previous = localById.get(habit.hid);
    const logs = Array.isArray(habit.logs) ? habit.logs.slice() : [];
    const known = new Set(logs.map(replicaLogKey));
    const incomingOpIds = new Set(logs.map(log=>log && typeof log === 'object' ? String(log.operationId || '') : '').filter(Boolean));
    for(const log of replicaActualLogs(previous)){
      const key = replicaLogKey(log);
      if(acknowledgedLogKeys.has(`${habit.hid}|${key}`)) continue;
      const pendingOp = Object.keys(pending).find(operationId=>{
        const item = pending[operationId];
        return item && item.hid === habit.hid && item.logKey === key;
      });
      if(pendingOp && incomingOpIds.has(pendingOp)) continue;
      if(key && !known.has(key)){ logs.push(log); known.add(key); }
    }
    habit.logs = logs;
  }
}

// Shared-items definitions are single-writer. Personal clone is the same
// logical owner on two devices, so its definition edits pass through and are
// queued below alongside completions. View-only shared items keep owner logs.
function beforeReplicaDeviceDataSave(previous,next){
  if(!replicaDisplayRequested()) return next;
  const enrolled = replicaEnrollment();
  if(!enrolled || !enrolled.replicaRows) return next;
  if(enrolled.replicaMode === 'clone') return stampReplicaCompletionIds(previous,next,enrolled);
  const prior = new Map((Array.isArray(previous) ? previous : []).filter(h=>h && h.hid).map(h=>[h.hid,h]));
  const output = [];
  for(const candidate of (Array.isArray(next) ? next : [])){
    const binding = candidate && enrolled.replicaRows[candidate.hid];
    const owned = binding && prior.get(candidate.hid);
    if(!owned){ output.push(candidate); continue; }
    const allowLogs = binding.access !== 'view';
    output.push({
      ...owned,
      logs:allowLogs && Array.isArray(candidate.logs) ? candidate.logs : (Array.isArray(owned.logs) ? owned.logs : []),
      lastLog:allowLogs ? candidate.lastLog : owned.lastLog,
      snoozedUntil:candidate.snoozedUntil
    });
  }
  // A replica-side delete is also a definition edit: restore it. Only the
  // owner can delete or unshare, which arrives through mergeReplicaSnapshot.
  for(const [hid,habit] of prior){
    if(enrolled.replicaRows[hid] && !output.some(item=>item && item.hid === hid)) output.push(habit);
  }
  return stampReplicaCompletionIds(previous,output,enrolled);
}

// Called by save(). Only newly-added actual logs become outbound operations;
// edits, planner caches, and presentation settings never generate traffic.
function onReplicaDeviceDataSaved(previous,next){
  if(!replicaDisplayRequested()) return;
  const enrolled = replicaEnrollment();
  if(!enrolled || !enrolled.deviceCredential) return;
  if(!enrolled.replicaRows || typeof enrolled.replicaRows !== 'object') enrolled.replicaRows = {};
  const before = new Map((Array.isArray(previous) ? previous : []).filter(h=>h && h.hid).map(h=>[
    h.hid,new Set(replicaActualLogs(h).map(replicaLogKey))
  ]));
  const outbox = Array.isArray(enrolled.replicaOutbox) ? enrolled.replicaOutbox.slice() : [];
  const pendingDefinitions = enrolled.replicaPendingDefinitions && typeof enrolled.replicaPendingDefinitions === 'object'
    ? {...enrolled.replicaPendingDefinitions}
    : {};
  const pendingCompletions = enrolled.replicaPendingCompletions && typeof enrolled.replicaPendingCompletions === 'object'
    ? {...enrolled.replicaPendingCompletions}
    : {};
  enrolled.replicaOutbox = outbox;
  enrolled.replicaPendingDefinitions = pendingDefinitions;
  enrolled.replicaPendingCompletions = pendingCompletions;
  const nextById = new Map((Array.isArray(next) ? next : []).filter(h=>h && h.hid).map(h=>[h.hid,h]));
  if(enrolled.replicaMode === 'clone'){
    const previousById = new Map((Array.isArray(previous) ? previous : []).filter(h=>h && h.hid).map(h=>[h.hid,h]));
    for(const [hid,habit] of nextById){
      const prior = previousById.get(hid);
      const beforeHash = prior ? replicaHabitDefinitionHash(prior) : '';
      const afterHash = replicaHabitDefinitionHash(habit);
      if(beforeHash === afterHash) continue;
      const operationId = shareRandomHex(16);
      const binding = enrolled.replicaRows[hid];
      const pending = pendingDefinitions[hid];
      const baseDefinitionHash = pending
        ? pending.baseDefinitionHash
        : String(binding && binding.definitionHash || beforeHash || '');
      const rowId = String(binding && binding.rowId || pending && pending.rowId || shareRandomHex(8));
      const operation = {
        operationId,hid,action:'upsert',habit:replicaHabitDefinition(habit),
        definitionHash:afterHash,baseDefinitionHash,rowId,createdAt:Date.now()
      };
      pendingDefinitions[hid] = operation;
      enrolled.replicaRows[hid] = {rowId,access:'complete',definitionHash:afterHash};
      for(let i=outbox.length-1;i>=0;i--){
        if(outbox[i] && outbox[i].kind === 'definition' && outbox[i].hid === hid) outbox.splice(i,1);
      }
      outbox.push({...operation,kind:'definition'});
    }
    for(const [hid,prior] of previousById){
      if(nextById.has(hid)) continue;
      const binding = enrolled.replicaRows[hid];
      const existingPending = pendingDefinitions[hid];
      const operation = {
        operationId:shareRandomHex(16),hid,action:'delete',
        definitionHash:'',
        baseDefinitionHash:existingPending
          ? existingPending.baseDefinitionHash
          : String(binding && binding.definitionHash || replicaHabitDefinitionHash(prior)),
        rowId:String(binding && binding.rowId || shareRandomHex(8)),
        createdAt:Date.now()
      };
      pendingDefinitions[hid] = operation;
      for(let i=outbox.length-1;i>=0;i--){
        if(outbox[i] && outbox[i].kind === 'definition' && outbox[i].hid === hid) outbox.splice(i,1);
      }
      outbox.push({...operation,kind:'definition'});
    }
  }
  enrolled.replicaOutbox = unionReplicaOps(outbox,[]);
  for(const habit of (Array.isArray(next) ? next : [])){
    const binding = replicaCompletionBinding(enrolled,habit && habit.hid);
    if(!binding || binding.access !== 'complete') continue;
    const known = before.get(habit.hid) || new Set();
    for(const log of replicaActualLogs(habit)){
      const key = replicaLogKey(log);
      if(!key || known.has(key)) continue;
      queueReplicaCompletion(enrolled,habit,log,binding);
    }
  }
  writeReplicaEnrollment(enrolled);
  void flushReplicaOutbox();
}

async function flushReplicaOutbox(){
  if(_replicaFlushBusy || navigator.onLine === false) return;
  let enrolled = replicaEnrollment();
  if(!enrolled || !enrolled.deviceCredential) return;
  _replicaFlushBusy = true;
  const skipped = new Set();
  let staleAttempts = 0;
  try{
    while(true){
      enrolled = replicaEnrollment() || enrolled;
      const op = (Array.isArray(enrolled.replicaOutbox) ? enrolled.replicaOutbox : [])
        .find(item=>item && item.operationId && !skipped.has(item.operationId));
      if(!op) break;
      const revision = Number(enrolled.meta && enrolled.meta.revision);
      const currentBinding = enrolled.replicaRows && enrolled.replicaRows[op.hid];
      if(currentBinding && currentBinding.rowId) op.rowId = currentBinding.rowId;
      if(!Number.isInteger(revision) || revision < 1 || !/^[0-9a-f]{16}$/.test(String(op.rowId || ''))) break;
      const isDefinition = op.kind === 'definition';
      const payload = isDefinition
        ? {
            schemaVersion:1,action:op.action,operationId:op.operationId,
            rowId:op.rowId,hid:op.hid,habit:op.action === 'upsert' ? op.habit : undefined,
            baseDefinitionHash:op.baseDefinitionHash || ''
          }
        : {
            schemaVersion:1,action:'complete',operationId:op.operationId,rowId:op.rowId,
            hid:op.hid,minutes:op.minutes || null,
            occurrenceKey:op.occurrenceKey || '',
            scheduleOptionId:op.scheduleOptionId || '',
            scheduledDay:op.scheduledDay || '',
            start:Number(op.start) || null,
            completedAt:Number(op.completedAt) || Number(op.createdAt) || Date.now()
          };
      const encryptionKey = isDefinition ? enrolled.replicaKey : enrolled.contentKey;
      const envelope = await shareEncrypt(encryptionKey,payload,{
        schemaVersion:SHARE_SCHEMA_VERSION,
        recordKind:isDefinition ? 'agenda_definition' : 'agenda_completion',
        objectId:enrolled.feedId,revision,operationId:op.operationId,logId:op.rowId
      });
      try{
        await shareFetch(`/v1/agendas/${enrolled.feedId}/${isDefinition ? 'definitions' : 'completions'}`,{
          method:'POST',credential:enrolled.deviceCredential,
          body:isDefinition ? {definition:envelope} : {completion:envelope},
          timeoutMs:REPLICA_DISPLAY_TIMEOUT_MS
        });
      }catch(error){
        if(error && (error.status === 413 || error.status === 404 || error.status === 429)){
          skipped.add(op.operationId);
          updateReplicaSyncStatus('offline · changes queued');
          continue;
        }
        if(error && error.status === 409){
          staleAttempts += 1;
          if(staleAttempts > 3){
            skipped.add(op.operationId);
            updateReplicaSyncStatus('offline · changes queued');
            continue;
          }
          await pullReplicaSnapshot();
          continue;
        }
        throw error;
      }
      enrolled = replicaEnrollment() || enrolled;
      enrolled.replicaOutbox = (enrolled.replicaOutbox || []).filter(item=>item.operationId !== op.operationId);
      writeReplicaEnrollment(enrolled);
      staleAttempts = 0;
      updateReplicaSyncStatus('synced');
    }
  }catch(error){
    updateReplicaSyncStatus(error && (error.status === 401 || error.status === 410) ? 'authorization expired' : 'offline · changes queued');
    if(error && (error.status === 401 || error.status === 410)) location.replace('agenda-display.html');
  }finally{ _replicaFlushBusy = false; }
}

function mergeReplicaSnapshot(replica,enrolled){
  adoptLiveReplicaQueues(enrolled);
  let acknowledgedLogKeys = applyReplicaSnapshotReceipts(enrolled,replica);
  const incomingIds = new Set();
  const replicaRows = {};
  let incoming = replica.items.flatMap(item=>{
    const habit = item && item.habit;
    if(!habit || !habit.hid || !/^[0-9a-f]{16}$/.test(String(item.rowId || ''))) return [];
    incomingIds.add(habit.hid);
    replicaRows[habit.hid] = {
      rowId:item.rowId,
      access:item.access === 'view' ? 'view' : 'complete',
      definitionHash:String(item.definitionHash || replicaHabitDefinitionHash(habit))
    };
    return [{
      ...habit,logs:Array.isArray(habit.logs) ? habit.logs.slice() : [],
      showOnSharedDisplay:replica.mode === 'clone' ? habit.showOnSharedDisplay : true,
      allowSharedDisplayCompletion:replica.mode === 'clone'
        ? habit.allowSharedDisplayCompletion
        : item.access !== 'view'
    }];
  });
  function applyClonePending(localById){
    if(replica.mode !== 'clone') return;
    const byId = new Map(incoming.map(h=>[h.hid,h]));
    for(const [hid,pending] of Object.entries(enrolled.replicaPendingDefinitions || {})){
      if(!pending) continue;
      if(pending.action === 'delete'){
        byId.delete(hid);
        continue;
      }
      const localHabit = localById.get(hid);
      if(localHabit) byId.set(hid,localHabit);
      if(!replicaRows[hid] && /^[0-9a-f]{16}$/.test(String(pending.rowId || ''))){
        replicaRows[hid] = {
          rowId:pending.rowId,
          access:'complete',
          definitionHash:String(pending.definitionHash || '')
        };
      }
    }
    incoming = [...byId.values()];
  }
  const local = load();
  const localById = new Map(local.filter(h=>h && h.hid).map(h=>[h.hid,h]));
  foldReplicaLocalLogs(incoming,localById,acknowledgedLogKeys,enrolled.replicaPendingCompletions);
  applyClonePending(localById);
  const previouslyShared = new Set(Object.keys(enrolled.replicaRows || {}));
  const pendingAtMerge = enrolled.replicaPendingDefinitions && typeof enrolled.replicaPendingDefinitions === 'object'
    ? enrolled.replicaPendingDefinitions
    : {};
  const unpublishedLocal = hid=>{
    const pending = pendingAtMerge[hid];
    return Boolean(pending && pending.action === 'upsert' && !incomingIds.has(hid));
  };
  let privateLocal = replica.mode === 'selected'
    ? local.filter(h=>h && !incomingIds.has(h.hid) && (!previouslyShared.has(h.hid) || unpublishedLocal(h.hid)))
    : [];
  const latest = load();
  const latestById = new Map(latest.filter(h=>h && h.hid).map(h=>[h.hid,h]));
  foldReplicaLocalLogs(incoming,latestById,acknowledgedLogKeys,enrolled.replicaPendingCompletions);
  adoptLiveReplicaQueues(enrolled);
  acknowledgedLogKeys = applyReplicaSnapshotReceipts(enrolled,replica);
  applyClonePending(latestById);
  if(replica.mode === 'selected'){
    privateLocal = latest.filter(h=>h && !incomingIds.has(h.hid) && (!previouslyShared.has(h.hid) || unpublishedLocal(h.hid)));
    const privateIds = new Set(privateLocal.map(h=>h && h.hid).filter(Boolean));
    enrolled.replicaOutbox = (Array.isArray(enrolled.replicaOutbox) ? enrolled.replicaOutbox : [])
      .filter(op=>op && op.kind !== 'definition' && !privateIds.has(op.hid));
    enrolled.replicaPendingDefinitions = {};
    const pendingCompletions = enrolled.replicaPendingCompletions && typeof enrolled.replicaPendingCompletions === 'object'
      ? enrolled.replicaPendingCompletions
      : {};
    enrolled.replicaPendingCompletions = Object.fromEntries(
      Object.entries(pendingCompletions).filter(([,pending])=>pending && !privateIds.has(pending.hid))
    );
    writeReplicaEnrollment(enrolled);
  }
  enrolled.replicaRows = replicaRows;
  enrolled.replicaMode = replica.mode;
  enrolled.definitionOwnerId = replica.definitionOwnerId || null;
  enrolled.replicaTruncated = Boolean(replica.truncated);
  const mergedHabits = normalize([...privateLocal,...incoming]);
  for(const habit of mergedHabits){
    if(incomingIds.has(habit.hid)) continue;
    const binding = replicaCompletionBinding(enrolled,habit && habit.hid);
    if(!binding || binding.access !== 'complete') continue;
    for(const log of replicaActualLogs(habit)){
      if(acknowledgedLogKeys.has(`${habit.hid}|${replicaLogKey(log)}`)) continue;
      queueReplicaCompletion(enrolled,habit,log,binding);
    }
  }
  // Direct writes deliberately bypass save() so imported owner logs never
  // bounce back as new device operations. Catch-up only covers clone items
  // the owner snapshot does not yet include, so truncated history is not
  // replayed as new completions.
  Storage.writeRaw(KEY,JSON.stringify(mergedHabits));
  bumpPlannerDataRevision();
  if(replica.mode === 'clone' && replica.settings){
    Storage.write(SORT_SETTINGS_KEY,replica.settings);
    sortSettings = loadSortSettings();
    applyAppearanceSettings();
  }
  enrolled.replicaRows = replicaRows;
  adoptLiveReplicaQueues(enrolled);
  applyReplicaSnapshotReceipts(enrolled,replica);
  writeReplicaEnrollment(enrolled);
}

async function pullReplicaSnapshot(){
  if(_replicaPull) return _replicaPull;
  _replicaPull = (async()=>{
    let enrolled = replicaEnrollment();
    if(!enrolled || !enrolled.deviceCredential || !enrolled.contentKey) return null;
    const result = await shareFetch(`/v1/agendas/${enrolled.feedId}`,{
      credential:enrolled.deviceCredential,timeoutMs:REPLICA_DISPLAY_TIMEOUT_MS
    });
    if(result.body && result.body.pairingId && result.body.pairingId !== enrolled.pairingId){
      throw Object.assign(new Error('reauth'),{status:401});
    }
    if(!result.body || !result.body.snapshot) return null;
    const projection = await shareDecrypt(enrolled.contentKey,result.body.snapshot);
    let replica = projection && projection.replica;
    if(!replica && projection && projection.replicaEnvelope && enrolled.replicaKey){
      replica = await shareDecrypt(enrolled.replicaKey,projection.replicaEnvelope);
    }
    if(!projection || !replica || replica.schemaVersion !== 1) return null;
    const revision = Number(result.body.revision);
    const next = adoptLiveReplicaQueues({
      ...enrolled,snapshot:result.body.snapshot,meta:{generatedAt:projection.generatedAt,revision,error:null}
    });
    if(revision !== Number(enrolled.meta && enrolled.meta.revision)){
      mergeReplicaSnapshot(replica,next);
      if(typeof refreshOpenViews === 'function') refreshOpenViews();
    }else{
      adoptLiveReplicaQueues(next);
      const live = replicaEnrollment();
      if(live && live.replicaRows && typeof live.replicaRows === 'object'){
        next.replicaRows = { ...(next.replicaRows || {}), ...live.replicaRows };
      }
      writeReplicaEnrollment(next);
    }
    const queued = typeof householdAgendaQueueRecords === 'function'
      ? householdAgendaQueueRecords(result.body)
      : { completions:Array.isArray(result.body.completions) ? result.body.completions : [] };
    await applyReplicaLiveCompletions(replicaEnrollment() || next,queued.completions);
    return replica;
  })().finally(()=>{ _replicaPull = null; });
  return _replicaPull;
}

async function refreshReplicaDevice(opts = {}){
  if(_replicaRefreshBusy || navigator.onLine === false) return;
  const enrolled = replicaEnrollment();
  if(!enrolled || !enrolled.deviceCredential || !enrolled.contentKey) return;
  _replicaRefreshBusy = true;
  if(opts.manual) updateReplicaSyncStatus('syncing…');
  try{
    const replica = await pullReplicaSnapshot();
    await flushReplicaOutbox();
    if(!replica){
      updateReplicaSyncStatus(replicaEnrollment() && replicaEnrollment().replicaMode
        ? 'synced'
        : 'waiting for library…');
      return;
    }
    const truncated = Boolean(replica.truncated);
    updateReplicaSyncStatus(truncated ? 'synced · recent history' : 'synced');
  }catch(error){
    if(error && (error.status === 401 || error.status === 410)) location.replace('agenda-display.html');
    else updateReplicaSyncStatus('offline · will retry');
  }finally{ _replicaRefreshBusy = false; }
}

function replicaWeatherText(){
  try{
    const weather = householdAgendaCurrentWeather(sortSettings,Date.now());
    return weather ? [weather.emoji,weather.temperature].filter(Boolean).join(' ') : '';
  }catch(_){ return ''; }
}

function updateReplicaChrome(){
  const now = new Date();
  const time = now.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const date = now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  document.querySelectorAll('[data-replica-time]').forEach(node=>node.textContent=time);
  document.querySelectorAll('[data-replica-date]').forEach(node=>node.textContent=date);
  document.querySelectorAll('[data-replica-weather]').forEach(node=>node.textContent=replicaWeatherText());
}

function updateReplicaSyncStatus(text){
  const node = document.getElementById('replica-sync-status');
  if(node) node.textContent = text;
}

function setReplicaLocked(locked){
  const lock = document.getElementById('replica-lock');
  if(!lock) return;
  lock.hidden = !locked;
  document.documentElement.dataset.replicaLocked = String(locked);
  try{
    if(locked) localStorage.setItem('tings_replica_locked_v1','1');
    else localStorage.removeItem('tings_replica_locked_v1');
  }catch(_){ }
}

// A glance display is paired but never installs a replica, so it has neither a
// replicaMode nor any replicaRows. An installed PWA start_url or a stale
// bookmark can still land it here; send it back rather than mounting clone
// chrome (and a week planner) over an empty local database. A clone that just
// paired already has syncMode/replicaKey, even before the first library
// snapshot arrives, and must stay on the full app.
function replicaEnrollmentIsGlance(enrolled){
  if(!enrolled) return false;
  if(typeof sharedDisplayWantsFullApp === 'function' && sharedDisplayWantsFullApp(enrolled)) return false;
  if(enrolled.syncMode === 'glance' || enrolled.syncMode === 'legacy') return true;
  return !enrolled.replicaMode && !enrolled.replicaRows;
}

function replicaDisplayIsSelected(enrolled){
  return Boolean(enrolled && (enrolled.replicaMode === 'selected' || enrolled.syncMode === 'selected'));
}

async function bootstrapReplicaLibrary(){
  if(replicaEnrollment() && replicaEnrollment().replicaMode) return;
  await refreshReplicaDevice();
  if(replicaEnrollment() && replicaEnrollment().replicaMode) return;
  await new Promise(resolve=>setTimeout(resolve,8000));
  if(replicaEnrollment() && replicaEnrollment().replicaMode) return;
  await refreshReplicaDevice();
}

function replicaChromeHidden(){
  try{ return localStorage.getItem(REPLICA_CHROME_HIDDEN_KEY) === '1'; }
  catch(_){ return false; }
}

function setReplicaChromeHidden(hidden){
  document.body.classList.toggle('replica-chrome-hidden', Boolean(hidden));
  const bar = document.querySelector('.replica-display-bar');
  if(bar) bar.hidden = Boolean(hidden);
  try{
    if(hidden) localStorage.setItem(REPLICA_CHROME_HIDDEN_KEY,'1');
    else localStorage.removeItem(REPLICA_CHROME_HIDDEN_KEY);
  }catch(_){ }
  const toggle = document.getElementById('settings-replica-chrome');
  if(toggle) toggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
}

function bindReplicaChromeSettings(){
  const toggle = document.getElementById('settings-replica-chrome');
  if(!toggle || _replicaChromeBound) return;
  _replicaChromeBound = true;
  toggle.addEventListener('click',()=>{
    setReplicaChromeHidden(!replicaChromeHidden());
  });
}

function replicaOwnOperationIds(enrolled){
  const ids = new Set();
  for(const op of (Array.isArray(enrolled && enrolled.replicaOutbox) ? enrolled.replicaOutbox : [])){
    if(op && op.operationId) ids.add(String(op.operationId));
  }
  for(const operationId of Object.keys((enrolled && enrolled.replicaPendingCompletions) || {})){
    if(operationId) ids.add(operationId);
  }
  for(const operationId of (Array.isArray(enrolled && enrolled.replicaLiveOperationIds) ? enrolled.replicaLiveOperationIds : [])){
    if(operationId) ids.add(String(operationId));
  }
  return ids;
}

async function applyReplicaLiveCompletions(enrolled,records){
  if(!enrolled || !enrolled.contentKey) return false;
  const own = replicaOwnOperationIds(enrolled);
  const liveIds = Array.isArray(enrolled.replicaLiveOperationIds) ? enrolled.replicaLiveOperationIds.slice() : [];
  const data = typeof load === 'function' ? load() : [];
  if(!Array.isArray(data) || !data.length && !(records && records.length)) return false;
  let changed = false;
  const acknowledged = [];
  for(const record of (Array.isArray(records) ? records : [])){
    const envelope = record && record.envelope;
    const operationId = String(envelope && envelope.operationId || '');
    if(!/^[0-9a-f]{32}$/.test(operationId)) continue;
    if(own.has(operationId)){ acknowledged.push(operationId); continue; }
    if(envelope.recordKind === 'agenda_definition') continue;
    let payload;
    try{ payload = await shareDecrypt(enrolled.contentKey,envelope); }
    catch(_){ continue; }
    if(!payload || payload.schemaVersion !== 1 || payload.action !== 'complete' || payload.operationId !== operationId) continue;
    let hid = typeof cleanHabitId === 'function' ? cleanHabitId(payload.hid) : String(payload.hid || '');
    if(!hid && enrolled.replicaRows && typeof enrolled.replicaRows === 'object'){
      hid = Object.keys(enrolled.replicaRows).find(id=>{
        const binding = enrolled.replicaRows[id];
        return binding && String(binding.rowId || '') === String(payload.rowId || '');
      }) || '';
    }
    if(!hid) continue;
    const habit = data.find(item=>item && item.hid === hid);
    if(!habit) continue;
    const logs = typeof normalizeLogs === 'function' ? normalizeLogs(habit.logs) : (Array.isArray(habit.logs) ? habit.logs : []);
    if(logs.some(log=>replicaLogOperationId(log) === operationId)){
      acknowledged.push(operationId);
      continue;
    }
    const createdAt = Number(record && record.createdAt);
    const serverTime = Number.isFinite(createdAt) && createdAt > 0 ? Math.min(createdAt,Date.now()) : Date.now();
    const reportedAt = Number(payload.completedAt);
    const completionTime = Number.isFinite(reportedAt) && reportedAt > 0
      ? Math.min(reportedAt,Date.now())
      : serverTime;
    const occurrenceKey = String(payload.occurrenceKey || '').slice(0,160);
    const alreadyComplete = occurrenceKey
      ? logs.some(log=>typeof logOccurrenceKey === 'function' && logOccurrenceKey(log) === occurrenceKey)
      : (!habit.breakable && typeof completedOnDay === 'function' && completedOnDay(habit,completionTime));
    if(alreadyComplete){
      acknowledged.push(operationId);
      continue;
    }
    const minutes = Math.max(0,Math.min(720,Math.round(Number(payload.minutes) || 0)));
    if(habit.breakable && !minutes){
      acknowledged.push(operationId);
      continue;
    }
    const entryTs = typeof snapLogTimestamp === 'function' ? snapLogTimestamp(habit,completionTime) : completionTime;
    const entry = typeof makeActualLog === 'function'
      ? makeActualLog(entryTs,{
          minutes:minutes || null,source:'shared_display',operationId,
          occurrenceKey,
          scheduleOptionId:String(payload.scheduleOptionId || '').slice(0,64),
          scheduledDay:/^\d{4}-\d{2}-\d{2}$/.test(String(payload.scheduledDay || ''))
            ? String(payload.scheduledDay) : ''
        })
      : { ts:entryTs,source:'shared_display',operationId };
    habit.logs = typeof normalizeLogs === 'function' ? normalizeLogs([...logs,entry]) : [...logs,entry];
    if(typeof latestActualLog === 'function') habit.lastLog = latestActualLog(habit.logs);
    liveIds.push(operationId);
    own.add(operationId);
    acknowledged.push(operationId);
    changed = true;
  }
  if(!changed){
    await acknowledgeReplicaOperations(enrolled,acknowledged);
    return false;
  }
  enrolled.replicaLiveOperationIds = [...new Set(liveIds)].filter(id=>/^[0-9a-f]{32}$/.test(id)).slice(-100);
  writeReplicaEnrollment(enrolled);
  const next = typeof normalize === 'function' ? normalize(data) : data;
  Storage.writeRaw(KEY,JSON.stringify(next));
  if(typeof bumpPlannerDataRevision === 'function') bumpPlannerDataRevision();
  if(typeof refreshOpenViews === 'function'){
    try{ refreshOpenViews(); }
    catch(_){ /* Local logs already saved; the next render still shows them. */ }
  }
  await acknowledgeReplicaOperations(enrolled,acknowledged);
  return true;
}

async function acknowledgeReplicaOperations(enrolled,operationIds){
  const ids = [...new Set((operationIds || []).filter(id=>/^[0-9a-f]{32}$/.test(String(id || ''))))];
  if(!enrolled || !enrolled.deviceCredential || !ids.length) return;
  try{
    for(let i=0;i<ids.length;i+=50){
      await shareFetch(`/v1/agendas/${enrolled.feedId}/completion-acks`,{
        method:'POST',credential:enrolled.deviceCredential,
        body:{operationIds:ids.slice(i,i+50)},timeoutMs:REPLICA_DISPLAY_TIMEOUT_MS
      });
    }
  }catch(error){
    if(error && (error.status === 401 || error.status === 410)) throw error;
  }
}

function mountReplicaDisplayMode(){
  const enrolled = replicaEnrollment();
  if(!replicaEnrollmentActive() && !replicaDisplayQueryRequested()) return;
  if(!enrolled || !enrolled.deviceCredential){ location.replace('agenda-display.html'); return; }
  if(replicaEnrollmentIsGlance(enrolled)){ location.replace('agenda-display.html'); return; }
  ensureReplicaDisplayQuery();
  document.body.classList.add('replica-display-mode');
  document.body.classList.add(replicaDisplayIsSelected(enrolled) ? 'replica-mode-selected' : 'replica-mode-clone');
  if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
  bindReplicaChromeSettings();
  const appBar = document.getElementById('app-bar');
  if(appBar && (typeof paneTierActive === 'function' ? paneTierActive() : Number(document.body.dataset.paneCount) > 1)){
    appBar.removeAttribute('hidden');
  }
  if(typeof updateSortButton === 'function') updateSortButton();
  if(document.querySelector('.replica-display-bar')){
    setReplicaChromeHidden(replicaChromeHidden());
    return;
  }
  const bar = document.createElement('aside');
  bar.className = 'replica-display-bar';
  const ownershipLabel = replicaDisplayIsSelected(enrolled) ? 'owner-managed schedules' : 'editable personal clone';
  bar.innerHTML = `<div class="replica-display-now"><time data-replica-time></time><span data-replica-weather></span></div><div class="replica-display-actions"><span class="replica-owner-label">${ownershipLabel}</span><span id="replica-sync-status">${enrolled.replicaMode ? 'local · ready' : 'waiting for library…'}</span><button type="button" id="replica-sync-now">sync</button><button type="button" id="replica-lock-button">lock</button><button type="button" id="replica-fullscreen">full screen</button><button type="button" id="replica-hide-button">hide</button></div>`;
  document.body.insertBefore(bar, document.body.firstChild);
  const lock = document.createElement('section');
  lock.id = 'replica-lock';
  lock.className = 'replica-lock';
  lock.hidden = true;
  lock.tabIndex = 0;
  lock.setAttribute('aria-label','Tings is locked. Tap three times to return to the agenda.');
  lock.innerHTML = `<div class="replica-lock-glow"></div><div class="replica-lock-clock"><time data-replica-time></time><p data-replica-date></p><span data-replica-weather></span><small>tap three times to open Tings</small></div>`;
  document.body.appendChild(lock);
  let taps = [];
  lock.addEventListener('click',()=>{
    const now = Date.now();
    taps = taps.filter(ts=>now-ts<900); taps.push(now);
    if(taps.length >= 3){ taps=[]; setReplicaLocked(false); }
  });
  document.getElementById('replica-lock-button').addEventListener('click',()=>setReplicaLocked(true));
  document.getElementById('replica-sync-now').addEventListener('click',()=>void refreshReplicaDevice({manual:true}));
  document.getElementById('replica-hide-button').addEventListener('click',()=>setReplicaChromeHidden(true));
  document.getElementById('replica-fullscreen').addEventListener('click',async()=>{
    try{
      if(document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({navigationUI:'hide'});
    }catch(_){ }
  });
  updateReplicaChrome();
  if(!_replicaClockTimer) _replicaClockTimer = setInterval(updateReplicaChrome,10 * 1000);
  try{ if(localStorage.getItem('tings_replica_locked_v1') === '1') setReplicaLocked(true); }catch(_){ }
  setReplicaChromeHidden(replicaChromeHidden());
  void bootstrapReplicaLibrary();
  if(!_replicaPollTimer){
    _replicaPollTimer = setInterval(()=>{
      if(document.visibilityState === 'visible') void refreshReplicaDevice();
    },REPLICA_DISPLAY_POLL_MS);
    window.addEventListener('online',()=>void refreshReplicaDevice());
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState === 'visible') void refreshReplicaDevice();
    });
  }
}

document.addEventListener('DOMContentLoaded',mountReplicaDisplayMode);
