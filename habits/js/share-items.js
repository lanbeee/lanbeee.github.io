function portableShareDefinition(habit){
  if(!habit) return null;
  return {
    name:habit.name,
    type:habit.type,
    emoji:habit.emoji || '',
    target:habit.target,
    dueDate:habit.dueDate,
    eventTime:habit.eventTime,
    planByDate:habit.planByDate,
    priority:habit.priority,
    flexibilityDays:habit.flexibilityDays,
    durationMinutes:habit.durationMinutes,
    breakable:habit.breakable,
    minChunkMinutes:habit.minChunkMinutes,
    autoMarkMinutes:habit.autoMarkMinutes,
    allowedDates:habit.allowedDates,
    allowedTimeStart:habit.allowedTimeStart,
    allowedTimeEnd:habit.allowedTimeEnd,
    preferredTimeStart:habit.preferredTimeStart,
    preferredTimeEnd:habit.preferredTimeEnd,
    trackValue:habit.trackValue,
    callLink:habit.callLink,
    webLink:habit.webLink,
    locationIds:Array.isArray(habit.locationIds) ? habit.locationIds.slice() : []
  };
}

function locationBundleForHabit(habit){
  const ids = Array.isArray(habit && habit.locationIds) ? habit.locationIds : [];
  return ids.map(id=>{
    const loc = typeof locationById === 'function' ? locationById(id) : null;
    if(!loc) return null;
    return { name:loc.name || '', address:loc.address || '', lat:loc.lat, lng:loc.lng };
  }).filter(Boolean);
}

async function shareCurrentDetailItem(){
  if(typeof detailIdx !== 'number' || !shareConfigured()){
    if(typeof showToast === 'function') showToast(shareConfigured() ? 'open an item first' : 'sharing worker is not configured');
    return;
  }
  const habit = typeof load === 'function' ? load()[detailIdx] : null;
  if(!habit){
    if(typeof showToast === 'function') showToast('item not found');
    return;
  }
  try{
    const places = locationBundleForHabit(habit);
    const created = await createItemShare(habit, places.length ? places : null);
    const url = created.url;
    let copied = false;
    if(navigator.share){
      try{
        await navigator.share({ title:'Shared item', text:'Track this with me in Tings. Your progress stays separate.', url });
        copied = true;
      }catch(error){
        if(error && error.name === 'AbortError') return;
      }
    }
    if(!copied && typeof copyTextToClipboard === 'function') copied = await copyTextToClipboard(url);
    if(typeof showToast === 'function') showToast(copied ? 'share link ready' : url);
  }catch(_){
    if(typeof showToast === 'function') showToast('could not create share');
  }
}

document.addEventListener('click', e=>{
  if(e.target.closest('#detail-share-item')){
    e.preventDefault();
    void shareCurrentDetailItem();
  }
});

function shareInvitationUrl(secrets){
  const page = new URL(location.href);
  page.hash = `share=${secrets.id}&key=${secrets.contentKey}&claim=${secrets.claimSecret}`;
  return page.href;
}

async function createItemShare(habit, locationBundle){
  const secrets = shareNewItemSecrets();
  const definition = await shareEncrypt(secrets.contentKey, portableShareDefinition(habit), {
    schemaVersion:SHARE_SCHEMA_VERSION,
    recordKind:'definition',
    objectId:secrets.id,
    revision:1
  });
  const body = {
    id:secrets.id,
    ownerCredential:secrets.ownerCredential,
    claimSecret:secrets.claimSecret,
    definition
  };
  if(locationBundle){
    body.locationBundle = await shareEncrypt(secrets.contentKey, locationBundle, {
      schemaVersion:SHARE_SCHEMA_VERSION,
      recordKind:'location_bundle',
      objectId:secrets.id,
      revision:1
    });
  }
  await shareFetch('/v1/items', { method:'POST', body });
  const state = loadShareState();
  state.shares[secrets.id] = {
    localHid:habit.hid,
    role:'owner',
    contentKey:secrets.contentKey,
    credential:secrets.ownerCredential,
    lastSequence:0,
    definitionRevision:1,
    status:'unclaimed',
    localDisplayOverrides:{},
    locationIdMap:{},
    remoteActivity:[]
  };
  saveShareState(state);
  return { ...secrets, url:shareInvitationUrl(secrets) };
}

async function claimItemShare(id, contentKey, claimSecret){
  const recipientCredential = shareRandomHex(SHARE_KEY_BYTES);
  await shareFetch(`/v1/items/${id}/claim`, {
    method:'POST',
    body:{ claimSecret, recipientCredential }
  });
  const pulled = await shareFetch(`/v1/items/${id}/changes?after=0`, { credential:recipientCredential });
  const definition = pulled.body.definition
    ? await shareDecrypt(contentKey, pulled.body.definition)
    : null;
  const locationBundle = pulled.body.locationBundle
    ? await shareDecrypt(contentKey, pulled.body.locationBundle)
    : null;
  const state = loadShareState();
  state.shares[id] = {
    localHid:null,
    role:'recipient',
    contentKey,
    credential:recipientCredential,
    lastSequence:pulled.body.sequence || 0,
    definitionRevision:pulled.body.definitionRevision || 1,
    status:pulled.body.status,
    localDisplayOverrides:{},
    locationIdMap:{},
    remoteActivity:[]
  };
  saveShareState(state);
  return { definition, locationBundle, share:state.shares[id] };
}

function parseItemShareFragment(hash){
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const id = params.get('share') || '';
  const contentKey = params.get('key') || '';
  const claimSecret = params.get('claim') || '';
  if(!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(contentKey) || !/^[0-9a-f]{64}$/.test(claimSecret)){
    return null;
  }
  return { id, contentKey, claimSecret };
}

async function maybeClaimItemShareFromHash(){
  const invite = parseItemShareFragment(location.hash);
  if(!invite || !shareConfigured()) return null;
  const claimed = await claimItemShare(invite.id, invite.contentKey, invite.claimSecret);
  try{ history.replaceState(null, '', location.pathname + location.search); }
  catch(_){}
  if(claimed && claimed.definition && typeof load === 'function' && typeof save === 'function'){
    const data = load();
    const incoming = { ...claimed.definition, hid:crypto.randomUUID(), logs:[], locationIds:[] };
    data.push(incoming);
    save(data);
    const state = loadShareState();
    if(state.shares[invite.id]) state.shares[invite.id].localHid = incoming.hid;
    saveShareState(state);
    if(typeof showToast === 'function') showToast(`shared: ${incoming.name || 'item'}`);
    if(typeof render === 'function') render();
  }
  return claimed;
}
