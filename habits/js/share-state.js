function loadShareState(){
  const raw = typeof Storage !== 'undefined' ? Storage.read(SHARE_STATE_KEY) : null;
  const state = raw && typeof raw === 'object' ? raw : {};
  if(!state.shares || typeof state.shares !== 'object') state.shares = {};
  if(!state.feeds || typeof state.feeds !== 'object') state.feeds = {};
  if(!Array.isArray(state.outbox)) state.outbox = [];
  return state;
}

function saveShareState(state){
  if(typeof Storage === 'undefined') return;
  Storage.write(SHARE_STATE_KEY, {
    shares:state.shares || {},
    feeds:state.feeds || {},
    outbox:Array.isArray(state.outbox) ? state.outbox : []
  });
}

function agendaFeedRecord(){
  const state = loadShareState();
  return state.feeds && state.feeds.agenda ? state.feeds.agenda : null;
}

function saveAgendaFeedRecord(feed){
  const state = loadShareState();
  if(feed) state.feeds.agenda = feed;
  else delete state.feeds.agenda;
  saveShareState(state);
}
