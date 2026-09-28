function shareStateStorageKey(){
  return typeof SHARE_STATE_KEY !== 'undefined' && SHARE_STATE_KEY
    ? SHARE_STATE_KEY
    : 'tings_share_v1';
}

function loadShareState(){
  const raw = typeof Storage !== 'undefined' ? Storage.read(shareStateStorageKey()) : null;
  const state = raw && typeof raw === 'object' ? raw : {};
  if(!state.shares || typeof state.shares !== 'object') state.shares = {};
  if(!state.feeds || typeof state.feeds !== 'object') state.feeds = {};
  if(!Array.isArray(state.outbox)) state.outbox = [];
  return state;
}

function saveShareState(state){
  if(typeof Storage === 'undefined') return;
  Storage.write(shareStateStorageKey(), {
    shares:state.shares || {},
    feeds:state.feeds || {},
    outbox:Array.isArray(state.outbox) ? state.outbox : []
  });
}

function agendaFeedRecord(){
  const state = loadShareState();
  const feed = state.feeds && state.feeds.agenda ? state.feeds.agenda : null;
  if(feed && !/^[0-9a-f]{16}$/.test(String(feed.ownerId || ''))){
    feed.ownerId = typeof shareRandomHex === 'function'
      ? shareRandomHex(8)
      : Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');
    saveShareState(state);
  }
  if(feed && Object.prototype.hasOwnProperty.call(feed,'viewerCredential')){
    delete feed.viewerCredential;
    saveShareState(state);
  }
  if(feed && Object.prototype.hasOwnProperty.call(feed,'currentInvite')){
    delete feed.currentInvite;
    saveShareState(state);
  }
  if(feed && !/^[0-9a-f]{64}$/.test(String(feed.replicaKey || ''))){
    feed.replicaKey = typeof shareRandomHex === 'function'
      ? shareRandomHex(32)
      : Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    saveShareState(state);
  }
  return feed;
}

function saveAgendaFeedRecord(feed){
  const state = loadShareState();
  if(feed) state.feeds.agenda = feed;
  else delete state.feeds.agenda;
  saveShareState(state);
}
