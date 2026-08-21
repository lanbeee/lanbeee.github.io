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
  if(feed && Object.prototype.hasOwnProperty.call(feed,'viewerCredential')){
    delete feed.viewerCredential;
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
