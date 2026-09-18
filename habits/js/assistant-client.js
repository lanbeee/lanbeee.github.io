// Ollama native /api/chat (preferred for Qwen3.8 think+tools) and LM Studio
// OpenAI-compatible /v1/chat/completions. Loopback, LAN, or Tailscale only.

let _assistantAbort = null;
let _assistantModelsCache = {at:0, origin:'', models:[]};
let _assistantContextCache = {};

function assistantSettings(){
  const s = typeof loadSortSettings === 'function' ? loadSortSettings() : (sortSettings || {});
  return {
    on:Boolean(s.localAssistant),
    debug:Boolean(s.localAssistantDebug),
    modelOnly:Boolean(s.localAssistantModelOnly),
    provider:normalizeLocalAssistantProvider(s.localAssistantProvider),
    url:normalizeLocalAssistantUrl(s.localAssistantUrl),
    model:normalizeLocalAssistantModel(s.localAssistantModel)
  };
}

function assistantOriginFor(provider, url){
  if(url)return url;
  if(provider === 'lmstudio')return ASSISTANT_LMSTUDIO_ORIGIN;
  return ASSISTANT_OLLAMA_ORIGIN;
}

function assistantAbortInFlight(){
  if(_assistantAbort){
    try{ _assistantAbort.abort(); }catch(_){}
    _assistantAbort = null;
  }
}

function assistantContextFromShow(body){
  const info = (body && body.model_info) || {};
  let fromInfo = 0;
  Object.keys(info).forEach(key => {
    if(/context[_]?length/i.test(key)){
      const n = Number(info[key]);
      if(Number.isFinite(n) && n > fromInfo)fromInfo = n;
    }
  });
  let fromParams = 0;
  if(body && body.parameters){
    const match = String(body.parameters).match(/num_ctx\s+(\d+)/i);
    if(match)fromParams = Number(match[1]) || 0;
  }
  // Runtime num_ctx is what the user enabled (e.g. 128k). Prefer it over a
  // stale architecture default in model_info.
  if(fromParams > 0)return fromParams;
  return fromInfo > 0 ? fromInfo : 0;
}

async function assistantLookupContextLimit(origin, provider, model){
  const key = `${provider || ''}:${origin || ''}:${model || ''}`;
  if(_assistantContextCache[key])return _assistantContextCache[key];
  let limit = typeof assistantGuessContextLimit === 'function'
    ? assistantGuessContextLimit(model)
    : ASSISTANT_DEFAULT_CONTEXT_TOKENS;
  if(provider === 'ollama' && origin && model){
    try{
      const res = await assistantFetch(`${origin}/api/show`, {
        method:'POST',
        body:JSON.stringify({name:model})
      });
      if(res.ok){
        const fromShow = assistantContextFromShow(await res.json());
        if(fromShow)limit = fromShow;
      }
    }catch(_){}
  }
  _assistantContextCache[key] = limit;
  return limit;
}

function pickAssistantModel(names, preferred){
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if(!list.length)return preferred || ASSISTANT_DEFAULT_MODEL;
  if(preferred && list.includes(preferred))return preferred;
  const lower = list.map(name => ({raw:name, key:String(name).toLowerCase()}));
  const q38mlx = lower.find(item => item.key.includes('qwen3.8') && item.key.includes('mlx'));
  if(q38mlx)return q38mlx.raw;
  const q38 = lower.find(item => item.key.includes('qwen3.8'));
  if(q38)return q38.raw;
  const qwen = lower.find(item => item.key.includes('qwen'));
  return qwen ? qwen.raw : list[0];
}

function assistantHasRequestBody(opts){
  return Boolean(opts && opts.body != null && opts.body !== '');
}

function assistantFetchInit(url, opts){
  const src = opts || {};
  const init = {};
  Object.keys(src).forEach(key => {
    if(key === 'headers')return;
    init[key] = src[key];
  });
  if(typeof assistantUrlAddressSpace === 'function'){
    const space = assistantUrlAddressSpace(url);
    if(space)init.targetAddressSpace = space;
  }else if(typeof assistantUrlIsLoopback === 'function' ? assistantUrlIsLoopback(url) : false){
    init.targetAddressSpace = 'loopback';
  }
  const headers = Object.assign({}, src.headers || {});
  const hasType = Object.keys(headers).some(key => String(key).toLowerCase() === 'content-type');
  if(assistantHasRequestBody(src) && !hasType)headers['Content-Type'] = 'application/json';
  if(Object.keys(headers).length)init.headers = headers;
  return init;
}

async function assistantLocalNetworkPermissionState(){
  if(typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query)return '';
  const names = ['loopback-network', 'local-network-access'];
  for(let i = 0; i < names.length; i += 1){
    try{
      const status = await navigator.permissions.query({name:names[i]});
      if(status && status.state)return status.state;
    }catch(_){}
  }
  return '';
}

async function assistantFetchAttempt(url, init){
  try{
    return await fetch(url, init);
  }catch(err){
    if(!init || !init.targetAddressSpace)throw err;
    const msg = String(err && err.message || err || '');
    const retry = Object.assign({}, init);
    delete retry.targetAddressSpace;
    if(/targetAddressSpace|Unexpected (field|option)|not a valid value|address space/i.test(msg)){
      return fetch(url, retry);
    }
    let host = '';
    try{ host = new URL(String(url || ''), 'http://127.0.0.1/').hostname; }catch(_){}
    if(init.targetAddressSpace === 'local' && typeof assistantHostLooksTailscale === 'function' && assistantHostLooksTailscale(host)){
      try{ return await fetch(url, retry); }catch(_){ throw err; }
    }
    throw err;
  }
}

async function assistantFetch(url, opts){
  const controller = opts && opts.signal ? null : new AbortController();
  if(controller)_assistantAbort = controller;
  const signal = (opts && opts.signal) || (controller && controller.signal);
  const init = assistantFetchInit(url, Object.assign({}, opts, {signal}));
  try{
    const permission = await assistantLocalNetworkPermissionState();
    if(permission === 'denied' && typeof assistantPublicPageOrigin === 'function' && assistantPublicPageOrigin()){
      throw new Error('Local network access is blocked for this site. In the address bar, allow Apps on this device / Local network, then try again.');
    }
    return await assistantFetchAttempt(url, init);
  }finally{
    if(controller && _assistantAbort === controller)_assistantAbort = null;
  }
}

async function assistantProbeOllama(origin){
  const res = await assistantFetch(`${origin}/api/tags`, {method:'GET'});
  if(!res.ok)throw new Error(`Ollama ${res.status}`);
  const body = await res.json();
  const models = Array.isArray(body.models) ? body.models.map(row => row && (row.name || row.model)).filter(Boolean) : [];
  const loaded = Array.isArray(body.models) ? body.models : [];
  return {provider:'ollama', origin, models, loaded};
}

async function assistantProbeLmStudio(origin){
  const res = await assistantFetch(`${origin}/v1/models`, {method:'GET'});
  if(!res.ok)throw new Error(`LM Studio ${res.status}`);
  const body = await res.json();
  const models = Array.isArray(body.data) ? body.data.map(row => row && row.id).filter(Boolean) : [];
  return {provider:'lmstudio', origin, models};
}

async function assistantDiscover(settings){
  const s = settings || assistantSettings();
  const forced = s.provider;
  const origin = assistantOriginFor(forced === 'auto' ? 'ollama' : forced, s.url);
  if(forced === 'lmstudio')return assistantProbeLmStudio(origin);
  if(forced === 'ollama')return assistantProbeOllama(origin);
  try{
    return await assistantProbeOllama(s.url || ASSISTANT_OLLAMA_ORIGIN);
  }catch(ollamaErr){
    try{
      return await assistantProbeLmStudio(s.url || ASSISTANT_LMSTUDIO_ORIGIN);
    }catch(_){
      throw ollamaErr;
    }
  }
}

async function assistantListModels(force){
  const now = Date.now();
  const s = assistantSettings();
  if(!force && _assistantModelsCache.models.length && now - _assistantModelsCache.at < 30000){
    return _assistantModelsCache;
  }
  const found = await assistantDiscover(s);
  _assistantModelsCache = {at:now, ...found};
  return found;
}

function assistantOllamaBody(req, model){
  const body = {
    model,
    stream:true,
    think:req.think !== false,
    keep_alive:'10m',
    messages:req.messages,
    options:{
      temperature:req.temperature != null ? req.temperature : (req.step === 'classify' ? 0.1 : 0.2),
      num_predict:req.maxPredict || (ASSISTANT_THINK_TOKENS + ASSISTANT_TOOL_TOKENS)
    }
  };
  if(req.tools && req.tools.length)body.tools = req.tools;
  if(req.format)body.format = req.format;
  return body;
}

function assistantOllamaHasReply(body){
  const msg = body && body.message;
  if(!msg || typeof msg !== 'object')return false;
  if(String(msg.content || '').trim())return true;
  if(String(msg.thinking || '').trim())return true;
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
}

function assistantAccumulateOllamaChat(text){
  const raw = String(text || '').trim();
  if(!raw)return {error:'empty reply'};
  if(raw[0] === '{'){
    try{
      const once = JSON.parse(raw);
      if(once && once.error && !once.message)return {error:String(once.error), body:once};
      if(once && (once.message || once.done != null))return {body:once, error:once.error ? String(once.error) : ''};
    }catch(_){}
  }
  const acc = {
    message:{role:'assistant', content:'', thinking:'', tool_calls:[]},
    prompt_eval_count:0
  };
  let error = '';
  raw.split(/\n+/).forEach(line => {
    const s = line.trim();
    if(!s)return;
    let chunk;
    try{ chunk = JSON.parse(s); }catch(_){ return; }
    if(chunk.error)error = String(chunk.error);
    if(chunk.prompt_eval_count)acc.prompt_eval_count = chunk.prompt_eval_count;
    if(chunk.eval_count)acc.eval_count = chunk.eval_count;
    const msg = chunk.message;
    if(!msg)return;
    if(msg.thinking)acc.message.thinking += msg.thinking;
    if(msg.content)acc.message.content += msg.content;
    if(Array.isArray(msg.tool_calls) && msg.tool_calls.length){
      acc.message.tool_calls = msg.tool_calls;
    }
  });
  return {body:acc, error};
}

function assistantOpenAiBody(req, model){
  return {
    model,
    stream:false,
    messages:req.messages,
    tools:req.tools || [],
    temperature:req.temperature != null ? req.temperature : (req.step === 'classify' ? 0.1 : 0.2),
    max_tokens:req.maxPredict || (ASSISTANT_THINK_TOKENS + ASSISTANT_TOOL_TOKENS),
    chat_template_kwargs:{enable_thinking:req.think !== false, preserve_thinking:true}
  };
}

function assistantFromOpenAi(body){
  const choice = body && body.choices && body.choices[0];
  const msg = (choice && choice.message) || {};
  const usage = body && body.usage;
  return {
    message:{
      role:'assistant',
      content:msg.content || '',
      thinking:msg.reasoning_content || msg.reasoning || msg.thinking || '',
      tool_calls:msg.tool_calls || []
    },
    prompt_eval_count:usage && (usage.prompt_tokens || usage.input_tokens) || 0,
    usage
  };
}

function assistantHttpErrorText(text, fallback){
  const raw = String(text || '').trim();
  try{
    const parsed = JSON.parse(raw);
    if(parsed && parsed.error)return String(parsed.error);
  }catch(_){}
  return raw.slice(0, 180) || fallback;
}

async function assistantComplete(req){
  if(typeof globalThis.__assistantTestComplete === 'function'){
    return globalThis.__assistantTestComplete(req);
  }
  const s = assistantSettings();
  if(!s.on)throw new Error('Local assistant is off.');
  const found = await assistantDiscover(s);
  const model = pickAssistantModel(found.models, s.model);
  const contextLimit = await assistantLookupContextLimit(found.origin, found.provider, model);
  if(found.provider === 'ollama'){
    const res = await assistantFetch(`${found.origin}/api/chat`, {
      method:'POST',
      body:JSON.stringify(assistantOllamaBody(req, model))
    });
    const text = await res.text();
    const got = assistantAccumulateOllamaChat(text);
    const body = got.body && got.body.message ? got.body : null;
    if(body && assistantOllamaHasReply(body)){
      if(got.error && !(body.message.tool_calls && body.message.tool_calls.length)){
        body._parseError = got.error;
      }
      body._contextLimit = contextLimit;
      return body;
    }
    if(!res.ok || got.error)throw new Error(got.error || assistantHttpErrorText(text, `Ollama ${res.status}`));
    if(!body)throw new Error(assistantHttpErrorText(text, `Ollama ${res.status}`));
    body._contextLimit = contextLimit;
    return body;
  }
  const res = await assistantFetch(`${found.origin}/v1/chat/completions`, {
    method:'POST',
    body:JSON.stringify(assistantOpenAiBody(req, model))
  });
  const text = await res.text();
  if(!res.ok)throw new Error(assistantHttpErrorText(text, `LM Studio ${res.status}`));
  const mapped = assistantFromOpenAi(JSON.parse(text));
  mapped._contextLimit = contextLimit;
  return mapped;
}

async function assistantTestConnection(){
  const found = await assistantListModels(true);
  const model = pickAssistantModel(found.models, assistantSettings().model);
  const raw = await assistantComplete({
    messages:[
      {role:'system', content:assistantSystemPrompt()},
      {role:'user', content:assistantUserEnvelope('ping: classify this as unsupported', assistantCatalog([], {locations:[], weatherProfiles:[]}, Date.now()), null)}
    ],
    tools:assistantOllamaTools(['classify_intent']),
    think:true,
    maxPredict:800,
    step:'classify'
  });
  const parsed = assistantParseReply(raw);
  const call = parsed.toolCalls && parsed.toolCalls[0];
  return {
    provider:found.provider,
    origin:found.origin,
    model,
    models:found.models,
    thinking:Boolean(parsed.thinking),
    tool:call && call.name,
    ok:Boolean(call && call.name === 'classify_intent')
  };
}
