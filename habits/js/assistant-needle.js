// Optional on-device Needle 3. Only an explicit download action fetches weights.
// Assets have an immutable revision, exact size and SHA-256; app updates keep
// this separate cache. Requests and habit data never leave the device.
const ASSISTANT_NEEDLE_CACHE = 'tings-needle-v1';
const ASSISTANT_NEEDLE_BASE = 'https://huggingface.co/Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/';
const ASSISTANT_NEEDLE_ASSETS = [
  {path:'wasm/needle.wasm', size:930545, sha:'7b73d09c17923bf81d6bdb82e19b3c343b8994f83d512ddec52eec9f6b029802'},
  {path:'needle3.cact', size:35335380, sha:'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38'}
];
let _assistantNeedleState = {phase:'missing', progress:0, error:''};
let _assistantNeedleDownload = null;
let _assistantNeedleDownloadAbort = null;
let _assistantNeedleWorker = null;
let _assistantNeedleReady = null;
let _assistantNeedleSerial = 0;
let _assistantNeedleGeneration = 0;
const _assistantNeedlePending = new Map();

function assistantNeedleState(next){
  if(next){
    _assistantNeedleState = {..._assistantNeedleState, ...next};
    document.dispatchEvent(new CustomEvent('tings-needle-state'));
  }
  return _assistantNeedleState;
}

async function assistantNeedleHasDownload(){
  if(!globalThis.caches)return false;
  // Reading status must not create an empty model cache on every app visit.
  if(!(await caches.has(ASSISTANT_NEEDLE_CACHE)))return false;
  const cache = await caches.open(ASSISTANT_NEEDLE_CACHE);
  for(const asset of ASSISTANT_NEEDLE_ASSETS){
    if(!(await cache.match(ASSISTANT_NEEDLE_BASE + asset.path)))return false;
  }
  return true;
}

async function assistantNeedleCheckDownload(){
  if(_assistantNeedleDownload)return;
  try{
    const ready = await assistantNeedleHasDownload();
    if(!_assistantNeedleDownload)assistantNeedleState({phase:ready ? 'downloaded' : 'missing', error:''});
  }catch(_){
    assistantNeedleState({phase:'missing', error:'Device storage is unavailable. Allow site storage to download the assistant.'});
  }
}

async function assistantNeedleVerify(asset, bytes){
  if(bytes.byteLength !== asset.size)throw new Error('Needle download was incomplete. Try downloading again.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const sha = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
  if(sha !== asset.sha)throw new Error('Needle download could not be verified. Try downloading again.');
}

function assistantNeedleDownload(){
  if(_assistantNeedleDownload)return _assistantNeedleDownload;
  const controller = new AbortController();
  _assistantNeedleDownloadAbort = controller;
  assistantNeedleState({phase:'downloading', progress:0, error:''});
  _assistantNeedleDownload = (async()=>{
    if(!globalThis.caches || !crypto.subtle)throw new Error('Needle needs a secure page with device storage enabled.');
    const cache = await caches.open(ASSISTANT_NEEDLE_CACHE);
    const total = ASSISTANT_NEEDLE_ASSETS.reduce((n, a) => n + a.size, 0);
    let done = 0;
    for(const asset of ASSISTANT_NEEDLE_ASSETS){
      const url = ASSISTANT_NEEDLE_BASE + asset.path;
      if(await cache.match(url)){ done += asset.size; continue; }
      const res = await fetch(url, {signal:controller.signal, credentials:'omit', cache:'no-store'});
      if(!res.ok)throw new Error(`Needle download failed (${res.status}). Try again when online.`);
      const chunks = [];
      let size = 0;
      if(res.body){
        const reader = res.body.getReader();
        try{
          while(true){
            const {value, done:ended} = await reader.read();
            if(ended)break;
            size += value.byteLength;
            if(size > asset.size)throw new Error('Needle download has an unexpected size.');
            chunks.push(value);
            assistantNeedleState({progress:Math.min(99, Math.round((done + size) / total * 100))});
          }
        }finally{ reader.releaseLock(); }
      }else{
        chunks.push(new Uint8Array(await res.arrayBuffer()));
      }
      const bytes = await new Blob(chunks).arrayBuffer();
      await assistantNeedleVerify(asset, bytes);
      if(controller.signal.aborted)throw new DOMException('Cancelled', 'AbortError');
      await cache.put(url, new Response(bytes));
      done += asset.size;
    }
    // Persistence is best effort; browsers may still clear site storage.
    try{ if(navigator.storage?.persist)await navigator.storage.persist(); }catch(_){}
    assistantNeedleState({phase:'downloaded', progress:100, error:''});
    return true;
  })().catch(err=>{
    const cancelled = err.name === 'AbortError';
    assistantNeedleState({phase:cancelled ? 'missing' : 'error', error:cancelled ? '' : (err.name === 'QuotaExceededError'
      ? 'Not enough device storage. Free some space and try again.'
      : `Could not download Needle 3. ${err.message || 'Check your connection and try again.'}`)});
    return false;
  }).finally(()=>{
    _assistantNeedleDownload = null;
    _assistantNeedleDownloadAbort = null;
  });
  return _assistantNeedleDownload;
}

function assistantNeedleCancelDownload(){
  _assistantNeedleDownloadAbort?.abort();
}

function assistantNeedleStop(reason){
  _assistantNeedleGeneration += 1;
  if(_assistantNeedleWorker)_assistantNeedleWorker.terminate();
  _assistantNeedleWorker = null;
  _assistantNeedleReady = null;
  for(const pending of _assistantNeedlePending.values()){
    clearTimeout(pending.timer);
    pending.reject(reason || new DOMException('Cancelled', 'AbortError'));
  }
  _assistantNeedlePending.clear();
}

async function assistantNeedleRemove(){
  assistantNeedleCancelDownload();
  if(_assistantNeedleDownload)await _assistantNeedleDownload;
  assistantNeedleStop();
  await caches.delete(ASSISTANT_NEEDLE_CACHE);
  assistantNeedleState({phase:'missing', progress:0, error:''});
}

function assistantNeedleRequest(type, payload, transfer){
  const id = ++_assistantNeedleSerial;
  return new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{
      assistantNeedleStop(new Error('Needle took too long. Try a shorter request.'));
    }, 180000);
    _assistantNeedlePending.set(id, {resolve,reject,timer});
    try{ _assistantNeedleWorker.postMessage({id,type,...payload}, transfer || []); }
    catch(err){ clearTimeout(timer); _assistantNeedlePending.delete(id); reject(err); }
  });
}

function assistantNeedleEnsureReady(){
  if(_assistantNeedleReady)return _assistantNeedleReady;
  const generation = _assistantNeedleGeneration;
  _assistantNeedleReady = (async()=>{
    if(!(await assistantNeedleHasDownload()))throw new Error('Download Needle 3 first using the download button in the assistant or Settings.');
    const cache = await caches.open(ASSISTANT_NEEDLE_CACHE);
    const buffers = [];
    for(const asset of ASSISTANT_NEEDLE_ASSETS){
      const res = await cache.match(ASSISTANT_NEEDLE_BASE + asset.path);
      const bytes = await res.arrayBuffer();
      try{ await assistantNeedleVerify(asset, bytes); }
      catch(err){ await cache.delete(ASSISTANT_NEEDLE_BASE + asset.path); assistantNeedleState({phase:'missing'}); throw err; }
      buffers.push(bytes);
    }
    if(generation !== _assistantNeedleGeneration)throw new DOMException('Cancelled', 'AbortError');
    _assistantNeedleWorker = new Worker('./js/assistant-needle-worker.js');
    _assistantNeedleWorker.onmessage = event=>{
      const data = event.data || {};
      const pending = _assistantNeedlePending.get(data.id);
      if(!pending)return;
      clearTimeout(pending.timer);
      _assistantNeedlePending.delete(data.id);
      if(data.error)pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    _assistantNeedleWorker.onerror = ()=>assistantNeedleStop(new Error('Needle could not start on this device. Try again or choose a local server in Settings.'));
    await assistantNeedleRequest('load', {wasm:buffers[0], model:buffers[1]}, buffers);
    return true;
  })().catch(err=>{
    if(generation === _assistantNeedleGeneration)assistantNeedleStop();
    throw err;
  });
  return _assistantNeedleReady;
}

// Select primitive schema types instead of union dialects. Keep every supported
// field; only descriptions are shortened for Needle's 8192-token context.
function assistantNeedleSchema(schema){
  const out = {};
  if(schema.type)out.type = Array.isArray(schema.type) ? schema.type.find(t=>t !== 'null') : schema.type;
  if(schema.enum)out.enum = schema.enum.filter(v=>v !== null);
  if(schema.description)out.description = schema.description.split('. ')[0].slice(0,100);
  if(schema.required)out.required = schema.required;
  if(schema.properties)out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,assistantNeedleSchema(value)]));
  if(schema.items && out.type === 'array')out.items = assistantNeedleSchema(schema.items);
  return out;
}

// Plain action names and compact fields are a better fit for a tiny tool model
// than the server model's large draft contracts. The worker retrieves additional
// fields from the complete schema with Needle embeddings. Multi-part requests
// use literal slices of the original text; intent never comes from a parser.
function assistantNeedleTools(source){
  const out = [];
  const add = (original, name, description, core, fixed)=>{
    const parameters = assistantNeedleSchema(original.function.parameters);
    if(fixed){
      for(const key of Object.keys(fixed))delete parameters.properties[key];
      if(parameters.required)parameters.required = parameters.required.filter(key=>!Object.hasOwn(fixed,key));
    }
    if(original.function.name === 'draft_item'){
      delete parameters.properties.needAsk;
      delete parameters.properties.ask;
      parameters.required = name === 'change_item' ? [] : ['name'];
    }
    out.push({name,description,parameters,core,canonical:original.function.name,fixed:fixed || {}});
  };
  for(const original of source){
    const name = original.function.name;
    if(name === 'classify_intent')continue;
    if(name === 'draft_item'){
      add(original,'add_habit','Add a repeating habit. Walk every day, exercise every Tuesday, study five times a week.',
        ['name','rhythm','durationMinutes','windowText'],{kind:'habit',create:true});
      add(original,'add_task','Add a one-off task or reminder. Remind me to call mom tomorrow.',
        ['name','due','dueTime','durationMinutes'],{kind:'task',create:true});
      add(original,'change_item','Edit one existing task or habit. Change its duration to 45 minutes or change its repeating schedule.',
        ['name','newName','durationMinutes','rhythm','windowText'],{create:false});
    }else if(name === 'answer_schedule'){
      const variants = [
        ['get_schedule','Get the schedule or agenda for a day. What is on my schedule today? What do I have tomorrow?','day'],
        ['get_week_schedule','Get the schedule or agenda for this week.','week'],
        ['get_free_time','Find free time or available gaps in the schedule.','free'],
        ['get_freest_day','Find the day with the most free time this week.','freest'],
        ['get_missed_items','List the tasks and habits missed today.','missed'],
        ['check_schedule_conflict','Check what a proposed time window would conflict with.','conflict']
      ];
      for(const [alias,description,query] of variants)add(original,alias,description,['date'],{query});
    }else if(name === 'answer_weather'){
      const variants = [
        ['get_weather','Get the weather forecast. Will it rain today?','day'],
        ['get_weather_window','Get the weather forecast between two times.','window'],
        ['find_weather_hours','Find the hours with the best weather or lowest wind or rain.','hours'],
        ['check_item_weather','Check whether the weather suits a saved habit.','item'],
        ['compare_weather','Compare the weather at two different times.','compare'],
        ['find_best_weather','Find the best weather window this week for a saved habit.','best']
      ];
      for(const [alias,description,query] of variants)add(original,alias,description,['date','start','end','name'],{query});
    }else if(name === 'answer_settings'){
      for(const [alias,description,kind] of [
        ['get_settings','List saved places, weather profiles, busy times or topics.',null],
        ['import_calendar','Import calendar meetings from an ICS iCal file or PDF, or sync the phone calendar.','calendar'],
        ['phone_reminders','Set up phone reminders, notifications, ringing alarms or travel alerts.','reminders'],
        ['pair_display','Pair or sync a shared display, personal clone or glance display.','sharing'],
        ['home_widget','Add a Tings Android home-screen widget.','widgets']
      ])add(original,alias,description,[],kind ? {kind,purpose:'answer'} : null);
    }else{
      const aliases = {
        draft_setting:['save_setting','Create or change a place, busy time, topic or weather profile.'],
        draft_batch:['add_items','Add several new tasks or habits from a list.'],
        apply_items:['change_items','Bulk edit, snooze or delete multiple saved tasks and habits matching a topic or filter.'],
        answer_schedule:['get_schedule','Get the schedule or agenda. What is on my schedule today? What do I have tomorrow? Find free time.'],
        answer_weather:['get_weather','Get the weather forecast. Will it rain today?'],
        answer_items:['get_items','List, search, count or rank saved tasks and habits.'],
        answer_settings:['get_settings','List saved places, weather profiles, busy times or topics.'],
        lookup_item:['get_item','Get history, statistics, next time or planner reason for an existing item.'],
        find_item:['find_item','Find a saved task or habit by name.'],
        complete_item:['complete_item','Mark a task or habit done, log minutes or undo a completion.'],
        plan_item:['plan_item','Plan or unplan an existing task or habit on a particular date.'],
        delete_item:['delete_item','Delete an existing task or habit.'],
        ask_user:['ask_user','Ask a short question when the request is unclear.']
      };
      const alias = aliases[name];
      const core = name === 'apply_items' ? ['action','search','names','durationMinutes','priority','snooze','placeNames']
        : name === 'draft_setting' ? ['kind','name','newName','weatherText','address','windowText','days']
        : name === 'complete_item' ? ['name','action','minutes','value','note']
        : name === 'plan_item' ? ['name','action','date','time','place']
        : ['name','query','date','kind','action','question','search','purpose'];
      if(alias)add(original,alias[0],alias[1],core);
    }
  }
  return out;
}

function assistantNeedleTurn(req){
  const messages = req.messages || [];
  let envelope = null;
  for(const msg of messages){
    if(msg.role !== 'user')continue;
    try{
      const parsed = JSON.parse(msg.content);
      if(typeof parsed.request === 'string'){ envelope = parsed; break; }
    }catch(_){}
  }
  if(!envelope)throw new Error('Needle could not read this request. Start a new chat and try again.');
  const catalog = envelope.catalog || {};
  const draft=envelope.currentDraft;
  const recent=envelope.recent;
  // The host owns draft merging and lookup. Keep only the facts needed to
  // resolve references here; replaying an earlier request can make this tiny
  // model perform that earlier action instead of the new question.
  const facts = {currentDraft:draft ? {name:draft.name,kind:draft.kind,durationMinutes:draft.durationMinutes,rules:draft.rules} : undefined,
    recent:recent ? {referent:recent.referent,items:recent.items,say:recent.say} : undefined,
    places:catalog.places, habits:catalog.habits, weather:catalog.weather, topics:catalog.topics};
  const date = catalog.date?.iso || catalog.date || new Date().toLocaleDateString('en-CA');

  const results = messages.filter(m=>m.role === 'tool').map(m=>m.content);
  const system = `date: ${date}; assistant: Tings; user: ${JSON.stringify(facts)}`;
  return {request:envelope.request, system, results};
}

async function assistantNeedleComplete(req){
  await assistantNeedleEnsureReady();
  const turn = assistantNeedleTurn(req);
  const source = req.tools?.length ? req.tools : assistantOllamaTools(['draft_item','draft_setting','draft_batch','ask_user']);
  const tools = assistantNeedleTools(source);
  const raw = await assistantNeedleRequest('complete', {...turn, tools});
  if(raw.success === false || raw.type === 'error')throw new Error(raw.error || 'Needle could not complete this request.');
  // Needle explicitly allows suppressed candidates to be offered for user
  // confirmation. Writes only stage previews on the first pass. Grounded
  // read candidates can safely return authoritative app facts. Ungrounded
  // arguments and negated actions are always refused.
  const ungrounded = raw.validation?.ungrounded || [];
  const previewTools = new Set(['draft_item','draft_setting','draft_batch','apply_items','complete_item','plan_item','delete_item']);
  const safeReads = new Set(['answer_settings']);
  const held = (raw.suppressed_calls || []).filter(call=>{
    const canonical=tools.find(t=>t.name === call.name)?.canonical;
    return safeReads.has(canonical) || (!turn.results.length && previewTools.has(canonical));
  });
  const candidates = [...(raw.function_calls || []),...held];
  const seen = new Set();
  const calls = candidates.filter(call=>{
    const key = JSON.stringify(call);
    if(!tools.some(t=>t.name === call.name) || raw.validation?.negation || seen.has(key)
      || ungrounded.some(field=>field.startsWith(`${call.name}.`)))return false;
    seen.add(key);
    return true;
  });
  return {message:{role:'assistant', content:'', thinking:raw.reasoning || '',
    tool_calls:calls.map((call,i)=>{
      const tool = tools.find(t=>t.name === call.name);
      return {id:`needle-${i}`, type:'function', function:{name:tool.canonical, arguments:{...call.arguments,...tool.fixed}}};
    })},
    prompt_eval_count:raw._promptTokens || 0, _contextLimit:8192, _contextManaged:true, _needleConfidence:raw.confidence};
}
