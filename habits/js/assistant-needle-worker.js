// CPU inference is isolated from scrolling, the planner, and keyboard input.
// Vendored glue never fetches code or sends prompts over the network.
importScripts('../lib/needle/needle.js');
let engine = null;
let output = 0;
let active = null;
let usedTokens = 0;
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

// Needle's own embedding head retrieves tools and optional fields. This keeps
// common actions and relevant fields within an 8192-token model context,
// without a semantic parser or an extra generative classification pass.
function needleSelectTools(data, selected){
  const query = needleEmbedding(data.request);
  const featureKinds=new Set(['calendar','reminders','sharing','widgets']);
  const pool = (selected || data.tools).filter(t=>t.name !== 'ask_user'
    && (selected || !featureKinds.has(t.fixed?.kind)));
  const ranked = pool.map(tool=>({tool,score:needleSimilarity(query,tool.description)}))
    .sort((a,b)=>b.score-a.score);
  const open = ranked.filter(row=>selected || !row.tool.closed).map(row=>row.tool);
  const choices = open.slice(0,3);
  // Closed aliases are one control surface split so each value has its own
  // field. Keeping only the nearest sibling forces the value into that field.
  if(!selected && ranked.slice(0,3).some(row=>row.tool.closed)){
    for(const row of ranked){
      if(row.tool.closed && !choices.includes(row.tool))choices.push(row.tool);
    }
  }
  const ask = data.tools.find(t=>t.name === 'ask_user');
  if(ask)choices.push(ask);
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
    for(const row of ranked.slice(0,3))keep.add(row.key);
    return {...schema,properties:Object.fromEntries(entries.filter(([key])=>keep.has(key))
      .map(([key,value])=>[key,compact(value)]))};
  };
  return choices.map(tool=>({...tool,parameters:compact(tool.parameters,tool.core)}));
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

// Select the operation with a small, complete menu before exposing its fields.
// No feature has an exclusive first pass. ask_user is always a valid escape.
function needleRouteTools(data){
  const routes=data.tools.map(tool=>tool.name === 'ask_user' ? tool : ({
    ...tool,parameters:{type:'object',properties:{},required:[]}
  }));
  needleInit(data.system,routes);
  const route=needleComplete(data.request);
  const calls=[...(route.function_calls || []),...(route.suppressed_calls || [])];
  const chosen=calls.map(call=>data.tools.find(tool=>tool.name === call.name))
    .filter(tool=>tool && tool.name !== 'ask_user');
  if(!chosen.length)return {result:route,tools:routes};
  return {tools:needleSelectTools(data,[...new Set(chosen)].slice(0,2))};
}

function needleRun(data){
  const key = JSON.stringify([data.request,data.system]);
  const allowed = new Set(data.tools.map(t=>t.name));
  const same = active && active.key === key && active.tools.every(t=>allowed.has(t.name))
    && active.results.every((r,i)=>data.results[i] === r)
    && (data.results.length > active.results.length || data.repair);
  if(!same){
    const route=needleRouteTools(data);
    const tools=route.tools;
    if(!tools?.length){active=null;return {success:true,function_calls:[]};}
    active={key,tools,results:[]};
    let result=route.result;
    if(!result){needleInit(data.system,tools);result=needleComplete(data.request);}
    for(const row of data.results.slice(-2))result=needleComplete(needleResultFacts(row));
    if(data.repair)result=needleComplete(data.repair);
    active.results=data.results.slice();
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
    }catch(err){ active = null; self.postMessage({id:data.id,error:String(err.message || err)}); }
  });
};
