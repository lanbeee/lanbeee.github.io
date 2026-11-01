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
  const choices = (selected || data.tools).filter(t=>t.name !== 'ask_user'
    && (selected || !featureKinds.has(t.fixed?.kind)))
    .map(tool=>({tool,score:needleSimilarity(query,tool.description)}))
    .sort((a,b)=>b.score-a.score).slice(0,3).map(row=>row.tool);
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

function needleRouteTools(data){
  // Model-first discovery for settings/features and library queries. Embeddings
  // alone can hide these behind unrelated action aliases. Routing exposes
  // only identity fields; a second model pass extracts the real arguments.
  const routes=data.tools.filter(t=>['answer_settings','answer_items'].includes(t.canonical)).map(tool=>{
    const required=tool.parameters.required || [];
    return {...tool,parameters:{type:'object',properties:Object.fromEntries(
      Object.entries(tool.parameters.properties || {}).filter(([key,value])=>
        (required.includes(key) || key === 'name') && value.type !== 'array' && value.type !== 'object')),
      required:required.filter(key=>tool.parameters.properties[key]?.type !== 'array' && tool.parameters.properties[key]?.type !== 'object')}};
  });
  needleInit(data.system,routes);
  const route=needleComplete(data.request);
  const candidates=[...(route.function_calls || []),...(route.suppressed_calls || [])];
  if(route.validation?.negation)return [];
  const first=candidates.find(call=>data.tools.some(tool=>tool.name === call.name)
    && !(route.validation?.ungrounded || []).some(field=>field.startsWith(call.name+'.')));
  const chosen=first && data.tools.find(tool=>tool.name === first.name);
  // The broad route is most useful for feature discovery and library queries.
  // Creation keeps its focused action schemas, which preserve kind/rhythm.
  return chosen && ['answer_settings','answer_items'].includes(chosen.canonical)
    ? needleSelectTools(data,[chosen]) : [];
}

function needleRun(data){
  const key = JSON.stringify([data.request,data.system]);
  const allowed = new Set(data.tools.map(t=>t.name));
  const same = active && active.key === key && active.tools.every(t=>allowed.has(t.name))
    && active.results.every((r,i)=>data.results[i] === r) && data.results.length > active.results.length;
  if(!same){
    // These features have no write semantics and distinct user vocabulary.
    // Discover them with their own tiny toolset so an import cannot become a
    // fabricated busy-time draft. Reminder tasks still use the action pass.
    if(!data.results.length){
      const features=data.tools.filter(tool=>['calendar','sharing','widgets'].includes(tool.fixed?.kind));
      if(features.length){
        needleInit(data.system,features);
        const feature=needleComplete(data.request);
        const proposed=[...(feature.function_calls || []),...(feature.suppressed_calls || [])]
          .filter(call=>features.some(tool=>tool.name === call.name));
        if(proposed.length && !feature.validation?.negation && !feature.validation?.ungrounded?.length){
          active={key,tools:features,results:[]};return feature;
        }
      }
    }
    let tools = needleSelectTools(data);
    if(!tools.length){ active = null; return {success:true,function_calls:[]}; }
    needleInit(data.system,tools);
    active = {key,tools,results:[]};
    let result = needleComplete(data.request);
    const writes=new Set(['draft_item','draft_setting','draft_batch','apply_items','complete_item','plan_item','delete_item']);
    const actionable=(result.function_calls || []).length || (result.suppressed_calls || []).some(call=>
      writes.has(tools.find(tool=>tool.name === call.name)?.canonical)
      && !(result.validation?.ungrounded || []).some(field=>field.startsWith(call.name+'.')));
    // Try discovery only after the focused model pass declines. This prevents
    // a broad phone-reminder tool from stealing an ordinary reminder task.
    if(!actionable && !data.results.length){
      const discovered=needleRouteTools(data);
      if(discovered.length){
        tools=discovered;needleInit(data.system,tools);result=needleComplete(data.request);
        active={key,tools,results:[]};
      }else{
        // Discovery reset native state; restore the original conversation.
        needleInit(data.system,tools);result=needleComplete(data.request);
      }
    }
    // Replays are bounded. The original request and the latest authoritative
    // results are sufficient to retry after a changed toolset or validation.
    for(const row of data.results.slice(-2))result = needleComplete(needleResultFacts(row));
    active.results = data.results.slice();
    return result;
  }
  let result;
  for(const row of data.results.slice(active.results.length))result = needleComplete(needleResultFacts(row));
  active.results = data.results.slice();
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
