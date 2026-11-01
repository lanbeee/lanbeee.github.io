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

// Lengths stay in the user's words. An integer grammar makes the model turn
// "1.5 hours" into a minute count that is not in the request, which grounding
// then refuses. "90 minutes" only appeared to work because those digits were spoken.
const ASSISTANT_SPOKEN_DURATION_FIELDS = new Set(['durationMinutes','minChunkMinutes','autoMarkMinutes','minutes']);
const ASSISTANT_SPOKEN_DURATION_DESCRIPTION = 'the user\'s words or a minute count, such as "1.5 hours", "90 minutes", or "half an hour"';

// Select primitive schema types instead of union dialects. Keep every supported
// field; only descriptions are shortened for Needle's 8192-token context.
function assistantNeedleSchema(schema){
  const out = {};
  if(schema.type)out.type = Array.isArray(schema.type) ? schema.type.find(t=>t !== 'null') : schema.type;
  if(schema.enum)out.enum = schema.enum.filter(v=>v !== null);
  if(schema.description)out.description = schema.description.split('. ')[0].slice(0,100);
  if(schema.required)out.required = schema.required;
  if(schema.properties){
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>{
      const child = assistantNeedleSchema(value);
      if(ASSISTANT_SPOKEN_DURATION_FIELDS.has(key)){
        child.type = 'string';
        const off = /manual|off/.test(String(value && value.description || ''));
        child.description = (ASSISTANT_SPOKEN_DURATION_DESCRIPTION + (off ? ', or off' : '')).slice(0,100);
      }
      return [key, child];
    }));
  }
  if(schema.items && out.type === 'array')out.items = assistantNeedleSchema(schema.items);
  return out;
}

// Plain action names and compact fields are a better fit for a tiny tool model
// than the server model's large draft contracts. The worker retrieves additional
// fields from the complete schema with Needle embeddings. Multi-part requests
// use literal slices of the original text; intent never comes from a parser.
function assistantNeedleTools(source){
  const out = [];
  // Minimal-mode controls each get a closed alias. Field retrieval must not
  // pull a neighboring setting back in, or "3 times" is read as minutes.
  const basicEditFields = ['rhythm','timesPerPeriod','periodDays','durationMinutes','windowText','weekdays','newName','habitKind','kind','due','dueTime'];
  const itemName = ()=>({type:'string',description:'Saved item title. Omit when the user says it, this, or that.'});
  const add = (original, name, description, core, fixed, spec)=>{
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
    if(name === 'change_item'){
      for(const key of basicEditFields)delete parameters.properties[key];
      parameters.required = (parameters.required || []).filter(key=>parameters.properties[key]);
    }
    let exposed = core;
    if(spec && spec.only){
      parameters.properties = Object.fromEntries(spec.only.map(key=>{
        const authored = spec.fields && spec.fields[key];
        const base = parameters.properties[key];
        return [key, authored ? {...(base || {}), ...authored} : (base || {type:'string'})];
      }));
      parameters.required = (spec.required || []).slice();
      exposed = spec.only.slice();
    }
    out.push({name,description,parameters,core:exposed,canonical:original.function.name,fixed:fixed || {},
      closed:Boolean(spec && spec.only) || original.function.name === 'answer_settings'});
  };
  for(const original of source){
    const name = original.function.name;
    if(name === 'classify_intent')continue;
    if(name === 'draft_item'){
      add(original,'add_habit','Add a repeating habit.',
        ['name','rhythm','durationMinutes'],{kind:'habit',create:true});
      const habit=out[out.length-1].parameters.properties;
      habit.frequency={type:'string',description:'How often it repeats: 3 times a week, every two days, daily, Sundays. Copy the full frequency phrase.'};
      delete habit.rhythm;
      out[out.length-1].core=out[out.length-1].core.map(key=>key === 'rhythm' ? 'frequency' : key);
      out[out.length-1].argumentNames={frequency:'rhythm'};
      out[out.length-1].parameters.required=['name','frequency'];
      habit.durationMinutes.description='Length of ONE session, only when the user names minutes or hours. Never a repetition count or period.';
      add(original,'add_task','Add a one-off task or reminder.',
        ['name','due','dueTime','durationMinutes'],{kind:'task',create:true});
      const task=out[out.length-1];
      task.parameters.properties.date=task.parameters.properties.due;delete task.parameters.properties.due;
      task.parameters.properties.time=task.parameters.properties.dueTime;delete task.parameters.properties.dueTime;
      task.core=['name','date','time','durationMinutes'];task.argumentNames={date:'due',time:'dueTime'};
      out.push({...task,name:'create_reminder',description:'Create a task to remind the user to do something.'});
      add(original,'change_item','Change the priority, topics, weather, or places of one existing task or habit.',
        ['name','priority','placeNames','weatherText','topics'],{create:false});
      add(original,'change_frequency','Change how often an existing task or habit repeats.',
        null,{create:false,kind:'habit'},{only:['name','rhythm'],required:['rhythm'],fields:{
          name:itemName(),
          rhythm:{type:'string',description:'The full repetition phrase copied from the request.'}
        }});
      add(original,'change_duration','Change how long one session of an existing task or habit lasts.',
        null,{create:false},{only:['name','durationMinutes'],required:['durationMinutes'],fields:{name:itemName()}});
      add(original,'change_availability','Change which weekdays or clock hours an existing task or habit may use. This is not how many times it repeats.',
        null,{create:false},{only:['name','weekdays','windowText'],fields:{
          name:itemName(),
          weekdays:{type:'string',description:'Weekdays it may use, such as weekdays, weekends, or Tuesday and Thursday. Not a repetition count.'},
          windowText:{type:'string',description:'Clock hours, such as between 5pm and 7pm, after 6pm, or before 9pm.'}
        }});
      add(original,'rename_item','Rename an existing task or habit.',
        null,{create:false},{only:['name','newName'],required:['newName'],fields:{name:itemName()}});
      add(original,'change_type','Change an existing item from a habit to a task, or from a task to a habit.',
        null,{create:false},{only:['name','kind'],required:['kind'],fields:{name:itemName()}});
      add(original,'change_kind','Change an existing habit to build, limit, or stop.',
        null,{create:false,kind:'habit'},{only:['name','habitKind'],required:['habitKind'],fields:{
          name:itemName(),
          habitKind:{type:'string',enum:['build','limit','stop'],description:'build, limit, or stop'}
        }});
      add(original,'change_deadline','Change the due date or start time of an existing task. Due tomorrow, next Friday, or at 3pm.',
        null,{create:false},{only:['name','due','dueTime'],fields:{name:itemName()}});
    }else if(name === 'answer_schedule'){
      add(original,'get_schedule','Read the planned agenda for one date.',
        ['date'],{query:'day'});
      add(original,'get_week_schedule','Read the agenda for the whole week.',[],{query:'week'});
      add(original,'analyze_schedule','Analyze free time, missed items, the freest day or schedule conflicts.',['query','date'],null);
    }else if(name === 'answer_weather'){
      add(original,'get_weather','Read the weather forecast for one date.',
        ['date'],{query:'day'});
      add(original,'analyze_weather','Compare weather times, find suitable hours, or check weather for a habit.', ['query','date','start','end','name'],null);
    }else if(name === 'answer_settings'){
      for(const [alias,description,kind] of [
        ['get_settings','List saved places, weather profiles, busy times or topics.',null],
        ['import_calendar','Import calendar meetings from an ICS iCal file or PDF, or sync the phone calendar.','calendar'],
        ['phone_reminders','Set up phone reminders, notifications, ringing alarms or travel alerts.','reminders'],
        ['pair_display','Pair or sync a shared display, personal clone or glance display.','sharing'],
        ['home_widget','Add a Tings Android home-screen widget.','widgets']
      ]){
        add(original,alias,description,[],kind ? {kind,purpose:'answer'} : null);
        if(kind){
          const tool=out[out.length-1];
          const subjects={calendar:['calendar','ics','ical','pdf'],reminders:['notification','notifications','alarm','alarms','phone reminders','travel alerts'],
            sharing:['pair','pairing','display','glance','clone','qr'],widgets:['widget','widgets']};
          tool.parameters.properties.subject={type:'string',enum:subjects[kind],description:'The feature word actually present in the request.'};
          tool.parameters.required=['subject'];tool.core=['subject'];tool.evidence=['subject'];
        }
      }
      add(original,'assistant_info','Introduce yourself, explain your capabilities, or reply to a greeting or thanks.',
        null,{kind:'assistant'},{only:['query'],required:['query'],fields:{query:{type:'string',enum:['greeting','thanks','identity','help','joke','date']}}});
    }else{
      if(name === 'complete_item'){
        add(original,'undo_last_completion','Undo the most recent completion.',[],{action:'undo_today',latest:true},{only:[],required:[]});
      }
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
      if(name === 'answer_items'){
        add(original,'get_habits','List or count your saved repeating habits.',
          ['aggregate','search'],{query:'list',kind:'habit'});
        add(original,'get_tasks','List or count your saved one-off tasks.',
          ['aggregate','search'],{query:'list',kind:'task'});
      }
      const alias = aliases[name];
      const core = name === 'answer_items' ? ['kind','search','status','aggregate'] : name === 'apply_items' ? ['action','search','names','durationMinutes','priority','snooze','placeNames']
        : name === 'draft_setting' ? ['kind','name','newName','weatherText','address','windowText','days']
        : name === 'complete_item' ? ['name','action','minutes','value','note']
        : name === 'plan_item' ? ['name','action','date','time','place']
        : ['name','query','date','kind','action','question','search','purpose'];
      if(alias)add(original,alias[0],alias[1],core,name === 'answer_items' ? {query:'list'} : null);
    }
  }
  const frequency=out.find(tool=>tool.name === 'change_frequency');
  if(frequency){
    frequency.parameters.properties.frequency=frequency.parameters.properties.rhythm;
    delete frequency.parameters.properties.rhythm;
    frequency.parameters.required=['frequency'];frequency.core=['name','frequency'];
    frequency.argumentNames={frequency:'rhythm'};
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
  const facts = {currentDraft:draft ? {name:draft.name,kind:draft.kind,durationMinutes:draft.durationMinutes,rhythm:draft.timesPerPeriod && `${draft.timesPerPeriod} times in ${draft.periodDays} days`,due:draft.dueDate != null ? dateKey(draft.dueDate) : undefined,dueTime:draft.dueTime,rules:draft.rules} : undefined,
    recent:recent ? {referent:recent.referent,items:recent.items,answer:recent.answer,tools:recent.tools} : undefined,
    clarification:envelope.clarification,
    places:catalog.places?.map(row=>({name:row.name})), habits:catalog.habits?.map(row=>({name:row.name,type:row.type})), weather:catalog.weather?.map(row=>({name:row.name})), topics:catalog.topics};
  const date = catalog.date?.iso || catalog.date || new Date().toLocaleDateString('en-CA');

  const results = messages.filter(m=>m.role === 'tool').map(m=>m.content);
  const system = `date: ${date}; assistant: Tings; user: ${JSON.stringify(facts)}`;
  // Server steering names canonical tools that Needle cannot call. Return
  // compact validation facts alongside the unchanged request instead.
  const feedback = req.think === false
    ? (envelope.continueWith || assistantLastSteeringText(messages)) : '';
  const invalid = feedback.match(/^That tool call was invalid \(([\s\S]*)\)\./);
  const repair = feedback ? JSON.stringify({ok:false,
    error:invalid ? invalid[1] : 'No valid tool call was returned.',request:envelope.request}) : '';
  const routingSystem=`date: ${date}; assistant: Tings; user: ${JSON.stringify({currentDraft:facts.currentDraft,recent:facts.recent,clarification:facts.clarification,habits:facts.habits,places:facts.places})}`;
  return {request:envelope.request,system,routingSystem,results,repair,entryIntent:envelope.entryIntent || null};
}

function assistantNeedleEntryTools(tools, intent){
  const keep = intent === 'create_habit' ? ['add_habit','ask_user']
    : intent === 'create_task' ? ['add_task','create_reminder','ask_user']
    : intent === 'create_setting' ? ['save_setting','ask_user']
    : null;
  if(!keep)return tools;
  const narrowed = (tools || []).filter(tool => keep.includes(tool.name));
  return narrowed.length ? narrowed : tools;
}

function assistantNeedleGroundedArguments(call, request, ungrounded){
  if(typeof assistantSpokenDurationMatches !== 'function')return false;
  const prefix = `${call.name}.`;
  const bad = ungrounded.filter(field=>field.startsWith(prefix));
  if(!bad.length)return true;
  return bad.every(field=>{
    const key = field.slice(prefix.length);
    if(!key || key.includes('.') || !call.arguments || !Object.prototype.hasOwnProperty.call(call.arguments, key))return false;
    if(key === 'frequency' || key === 'rhythm'){
      const spoken=assistantParseRhythm(request),value=assistantParseRhythm(call.arguments[key]);
      return Boolean(spoken && value && spoken.timesPerPeriod === value.timesPerPeriod && spoken.periodDays === value.periodDays
        && JSON.stringify(spoken.weekdays || []) === JSON.stringify(value.weekdays || []));
    }
    return ASSISTANT_SPOKEN_DURATION_FIELDS.has(key) && assistantSpokenDurationMatches(request, call.arguments[key]);
  });
}

async function assistantNeedleComplete(req){
  await assistantNeedleEnsureReady();
  const turn = assistantNeedleTurn(req);
  const source = req.tools?.length ? req.tools : assistantOllamaTools(['draft_item','draft_setting','draft_batch','ask_user']);
  const tools = assistantNeedleEntryTools(assistantNeedleTools(source), turn.entryIntent);
  const raw = await assistantNeedleRequest('complete', {...turn, tools});
  if(raw.success === false || raw.type === 'error')throw new Error(raw.error || 'Needle could not complete this request.');
  // Needle explicitly allows suppressed candidates to be offered for user
  // confirmation. Writes only stage previews on the first pass. Grounded
  // read candidates can safely return authoritative app facts. A length that
  // is only the user's quantity in other units stays. Invented arguments and
  // negated actions are refused.
  const ungrounded = raw.validation?.ungrounded || [];
  const previewTools = new Set(['draft_item','draft_setting','draft_batch','apply_items','complete_item','plan_item','delete_item']);
  const safeReads = new Set(['answer_settings','answer_items','answer_schedule','answer_weather','lookup_item','find_item']);
  const held = (raw.suppressed_calls || []).filter(call=>{
    const canonical=tools.find(t=>t.name === call.name)?.canonical;
    return safeReads.has(canonical) || (!turn.results.length && previewTools.has(canonical));
  });
  const candidates = [...(raw.function_calls || []),...held];
  const seen = new Set();
  const calls = candidates.filter(call=>{
    const key = JSON.stringify(call);
    const prefix = `${call.name}.`;
    const tool=tools.find(tool=>tool.name === call.name);
    if((tool?.evidence || []).some(key=>typeof call.arguments?.[key] !== 'string' || !call.arguments[key].trim()
      || !(' '+turn.request.toLowerCase().split(/[^a-z0-9]+/).join(' ')+' ').includes(' '+call.arguments[key].toLowerCase().split(/[^a-z0-9]+/).join(' ')+' ')))return false;
    const invented = ungrounded.some(field=>field.startsWith(prefix))
      && !assistantNeedleGroundedArguments(call, turn.request, ungrounded);
    if(!tools.some(t=>t.name === call.name) || raw.validation?.negation || seen.has(key) || invented)return false;
    seen.add(key);
    return true;
  });
  const scores=[raw.confidence,raw._route?.confidence,raw._route?.detail?.confidence].filter(value=>typeof value === 'number' && Number.isFinite(value));
  const confidence=scores.length ? Math.min(...scores) : undefined;
  return {message:{role:'assistant', content:'', thinking:raw.reasoning || '',
    tool_calls:calls.map((call,i)=>{
      const tool = tools.find(t=>t.name === call.name);
      const extracted=Object.fromEntries(Object.entries(call.arguments || {}).filter(([key])=>!tool.evidence?.includes(key)).map(([key,value])=>[tool.argumentNames?.[key] || key,value]));
      const args = {...extracted,...tool.fixed};
      return {id:`needle-${i}`, type:'function', function:{name:tool.canonical, arguments:args}};
    })},
    prompt_eval_count:raw._promptTokens || 0, _contextLimit:8192, _contextManaged:true, _needleConfidence:confidence,_needleRoute:raw._route,_needleValidation:raw.validation,_needleIssue:raw._needleIssue,
    _needleNeedsConfirmation:calls.some(call=>{const tool=tools.find(t=>t.name === call.name);return tool?.canonical !== 'ask_user' && tool?.fixed?.kind !== 'assistant';})
      && ((!scores.length || confidence < 0.7) || calls.some(call=>held.includes(call)))};
}
