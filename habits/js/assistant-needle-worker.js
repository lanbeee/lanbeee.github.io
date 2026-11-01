// CPU inference is isolated from scrolling, the planner, and keyboard input.
// Vendored glue never fetches code or sends prompts over the network.
importScripts('../lib/needle/needle.js');
let engine = null;
let output = 0;
let active = null;
let usedTokens = 0;
let routeTrace = null;
const embeddings = new Map();
const OUTPUT_CAPACITY = 262144;
const NEEDLE_CONTEXT_BUDGET = 6200;

function needleError(){ return engine.ccall('needle_last_error','string',[],[]) || 'Needle runtime failed.'; }
function needleInit(system, tools){
  const nativeTools = tools.map(({name,description,parameters})=>({name,description,parameters}));
  engine._needle_reset();
  const n = engine.ccall('needle_init','number',['string','string','number'],[system,JSON.stringify(nativeTools),0]);
  if(n < 0)throw new Error(needleError());
  usedTokens = n;
  if(n > NEEDLE_CONTEXT_BUDGET)throw new Error('This part has too many settings for one model pass. Split it into smaller parts.');
}
function needleComplete(text){
  if(usedTokens + Math.ceil(text.length / 2) + 768 > 8192)throw new Error('This conversation needs a fresh context. Try the unfinished part again.');
  const n = engine.ccall('needle_complete','number',
    ['string','number','number','number','number','number'],[text,0,0,768,output,OUTPUT_CAPACITY]);
  if(n < 0)throw new Error(needleError());
  const result = JSON.parse(engine.UTF8ToString(output));
  result._promptTokens = usedTokens + Math.ceil(text.length / 2);
  usedTokens = result._promptTokens + 768;
  return result;
}

function needleEmbedding(text){
  if(embeddings.has(text))return embeddings.get(text);
  const types = ['string','number','number','number','number'];
  const n = engine.ccall('needle_embed','number',types,[text,0,0,0,0]);
  if(n <= 0)throw new Error(needleError());
  const ptr = engine._malloc(n * 4);
  if(!ptr)throw new Error('Not enough memory for Needle.');
  try{
    if(engine.ccall('needle_embed','number',types,[text,0,0,ptr,n]) < 0)throw new Error(needleError());
    const vector = Array.from(new Float32Array(engine.HEAPU8.buffer,ptr,n));
    const length = Math.sqrt(vector.reduce((sum,x)=>sum + x*x,0)) || 1;
    const normalized = vector.map(x=>x / length);
    // Bound memory across many conversations; model state itself is retained.
    if(embeddings.size >= 512)embeddings.clear();
    embeddings.set(text,normalized);
    return normalized;
  }finally{ engine._free(ptr); }
}
function needleSimilarity(query, text){
  const vector = needleEmbedding(text);
  return query.reduce((sum,x,i)=>sum + x * vector[i],0);
}

// The model selects tools. Embeddings rank only optional fields inside those
// selected schemas; they never decide whether an action or feature is relevant.
function needleSelectTools(data, selected=data.tools){
  const query=needleEmbedding(data.request);
  const choices=selected.filter(tool=>tool.name !== 'ask_user');
  const ask=data.tools.find(tool=>tool.name === 'ask_user');
  if(ask)choices.push(ask);
  let toolBudget=0;
  const compact = (schema, core=[])=>{
    if(!schema.properties){
      return schema.items ? {...schema,items:compact(schema.items)} : schema;
    }
    const entries = Object.entries(schema.properties);
    const keep = new Set([...(schema.required || []),...core]);
    // Nested filters and bulk-edit groups are real capabilities. Rank them
    // alongside scalar fields instead of silently removing their grammar.
    const ranked = entries.filter(([key])=>!keep.has(key))
      .map(([key,value])=>({key,score:needleSimilarity(query,`${key}: ${value.description || key}`)}))
      .sort((a,b)=>b.score-a.score);
    for(const row of ranked.slice(0,toolBudget))keep.add(row.key);
    const ordered=[...new Set([...core,...(schema.required || []),...keep])].filter(key=>schema.properties[key]);
    return {...schema,properties:Object.fromEntries(ordered.map(key=>[key,compact(schema.properties[key])]))};
  };
  return choices.map(tool=>{
    toolBudget=tool.closed || ['add_habit','add_task','create_reminder','get_schedule','get_week_schedule','get_habits','get_tasks'].includes(tool.name) ? 0 : 3;
    return {...tool,parameters:compact(tool.parameters,tool.core)};
  });
}

function needleSplit(request){
  needleInit('',[{name:'requests',description:'Extract the separate requests in order. Keep all details of each item together.',
    parameters:{type:'object',required:['steps'],properties:{steps:{type:'array',items:{type:'string',description:'Exact text of a request, copied verbatim.'}}}}}]);
  const raw = needleComplete('Extract the requests record from this text: '+request);
  // This is non-executable extraction metadata. Boundaries are checked against
  // the original text on the main thread; no extracted instruction is executed.
  const calls = [...(raw.function_calls || []),...(raw.suppressed_calls || [])];
  return {steps:calls.flatMap(call=>call.arguments?.steps || []).filter(x=>typeof x === 'string')};
}

// Choose an operation with identity-only schemas before exposing its fields.
// Every feature competes with ordinary actions and ask_user can always decline.
function needleRouteTools(data){
  const ask=data.tools.find(tool=>tool.name === 'ask_user');
  const menu=tools=>tools.map(tool=>{
    if(tool.name === 'ask_user')return tool;
    const properties=Object.fromEntries(Object.entries(tool.parameters?.properties || {}).filter(([key,value])=>
      ['name','query','date','kind','action','search'].includes(key) && value.type === 'string'));
    return {...tool,parameters:{type:'object',properties,required:(tool.parameters?.required || []).filter(key=>properties[key])}};
  });
  const groups=[];
  for(const tool of data.tools){
    const name=tool.closed && tool.canonical === 'draft_item' ? 'change_item' : tool.name;
    if(groups.some(row=>row.name === name))continue;
    groups.push({...tool,name,description:name === 'change_item'
      ? 'Change or rename an existing task or habit: duration, frequency, weekdays, hours, due date, priority, type, or other settings.' : tool.description});
  }
  const system=data.routingSystem || data.system;
  needleInit(system,menu(groups));
  const route=needleComplete(data.request);
  const candidates=raw=>[...(raw.function_calls || []),...(raw.suppressed_calls || [])];
  routeTrace={confidence:route.confidence,reasoning:route.reasoning,tools:candidates(route).map(call=>call.name)};
  const selected=[];
  for(const call of candidates(route)){
    let tool=data.tools.find(tool=>tool.name === call.name && tool.name !== 'ask_user');
    if(!tool)continue;
    if(tool.name === 'change_item'){
      const edits=data.tools.filter(row=>row.name === 'change_item' || (row.closed && row.canonical === 'draft_item') || row.name === 'ask_user');
      needleInit(system,menu(edits));
      const detail=needleComplete(data.request);
      routeTrace.detail={confidence:detail.confidence,reasoning:detail.reasoning,tools:candidates(detail).map(call=>call.name)};
      tool=candidates(detail).map(call=>edits.find(row=>row.name === call.name)).find(Boolean);
      if(tool?.name === 'ask_user')return {result:detail,tools:edits};
    }
    if(tool)selected.push(tool);
  }
  if(!selected.length)return {result:route,tools:ask ? [ask] : []};
  const tools=needleSelectTools(data,[...new Set(selected)].slice(0,2));
  const concrete=tools.filter(tool=>tool.name !== 'ask_user');
  if(concrete.length && concrete.every(tool=>!Object.keys(tool.parameters.properties || {}).length)){
    return {tools,result:{success:true,confidence:route.confidence,function_calls:concrete.map(tool=>({name:tool.name,arguments:{}}))}};
  }
  return {tools};
}

function needleRun(data){
  const key = JSON.stringify([data.request,data.system]);
  const allowed = new Set(data.tools.map(t=>t.name));
  const same = active && active.key === key && active.tools.every(t=>allowed.has(t.name))
    && active.results.every((r,i)=>data.results[i] === r)
    && (data.results.length > active.results.length || data.repair);
  if(!same){
    // Start with a few complete action schemas. Unlike identity-only routing,
    // these let Needle recognize ordinary commands by their actual value slots.
    const query=needleEmbedding(data.request);
    const ranked=data.tools.filter(tool=>tool.name !== 'ask_user' && tool.canonical !== 'answer_settings')
      .map(tool=>({tool,score:needleSimilarity(query,tool.description)})).sort((a,b)=>b.score-a.score);
    const focused=ranked.filter(row=>!row.tool.closed).slice(0,3).map(row=>row.tool);
    if(ranked.slice(0,3).some(row=>row.tool.closed))focused.push(...ranked.filter(row=>row.tool.closed).slice(0,2).map(row=>row.tool));
    // Basic creation and reads stay visible. Retrieval must not force an
    // ordinary request into a neighboring operation with a similar value slot.
    focused.push(...data.tools.filter(tool=>['add_habit','add_task','get_schedule','get_week_schedule','get_habits','get_tasks'].includes(tool.name)));
    let tools=needleSelectTools(data,[...new Set(focused)]);
    if(!tools?.length){active=null;return {success:true,function_calls:[]};}
    needleInit(data.system,tools);
    let result=needleComplete(data.request);
    const candidates=[...(result.function_calls || []),...(result.suppressed_calls || [])];
    // The host validates and normalizes candidate values. A converted unit or
    // frequency can be grounded there even when the native literal check held it.
    const actionable=candidates.some(call=>call.name !== 'ask_user' && tools.some(tool=>tool.name === call.name));
    routeTrace=null;
    if(!actionable && !data.results.length){
      const route=needleRouteTools(data);
      tools=route.tools;
      result=route.result;
      if(!result){needleInit(data.system,tools);result=needleComplete(data.request);}
    }
    active={key,tools,results:[]};
    for(const row of data.results.slice(-2))result=needleComplete(needleResultFacts(row));
    if(data.repair)result=needleComplete(data.repair);
    active.results=data.results.slice();
    result._route=routeTrace;
    return result;
  }
  let result;
  for(const row of data.results.slice(active.results.length))result=needleComplete(needleResultFacts(row));
  if(data.repair)result=needleComplete(data.repair);
  active.results=data.results.slice();
  return result;
}

function needleResultFacts(text){
  try{
    const row = JSON.parse(text);
    delete row.hint;
    // Keep valid JSON and complete names. Do not slice a serialized payload in
    // the middle of a field. The full authoritative result remains in Tings.
    if(Array.isArray(row.items))row.items = row.items.slice(0,12);
    if(typeof row.text === 'string' && row.text.length > 5000)row.text = row.text.slice(0,5000);
    return JSON.stringify(row);
  }catch(_){ return String(text).slice(0,5000); }
}

// Serialize messages even when a caller posts while the asynchronous WASM boot
// is finishing. Each worker has exactly one non-thread-safe model instance.
let queue = Promise.resolve();
self.onmessage = event=>{
  const data = event.data;
  queue = queue.then(async()=>{
    try{
      if(data.type === 'load'){
        engine = await createNeedle({wasmBinary:new Uint8Array(data.wasm), print:()=>{}, printErr:()=>{}});
        const bytes = new Uint8Array(data.model);
        const ptr = engine._malloc(bytes.length);
        if(!ptr)throw new Error('Not enough memory to load Needle 3.');
        try{
          engine.HEAPU8.set(bytes,ptr);
          if(engine._needle_load(ptr,BigInt(bytes.length)) < 0)throw new Error(needleError());
        }finally{ engine._free(ptr); }
        output = engine._malloc(OUTPUT_CAPACITY);
        if(!output)throw new Error('Not enough memory to run Needle 3.');
        self.postMessage({id:data.id,result:true});
      }else if(data.type === 'split'){
        if(!engine)throw new Error('Needle is not loaded.');
        self.postMessage({id:data.id,result:needleSplit(data.request)});
      }else if(data.type === 'complete'){
        if(!engine)throw new Error('Needle is not loaded.');
        self.postMessage({id:data.id,result:needleRun(data)});
      }
    }catch(err){
      active=null;
      const error=String(err.message || err);
      if(data.type === 'complete' && /token budget|context|too many settings/i.test(error)){
        self.postMessage({id:data.id,result:{success:true,_needleIssue:error,function_calls:[{name:'ask_user',arguments:{
          question:'Could you restate this part in one short sentence? I couldn’t reliably finish reading it.'
        }}]}});
      }else self.postMessage({id:data.id,error});
    }
  });
};
