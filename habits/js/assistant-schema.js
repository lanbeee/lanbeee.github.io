// Frozen local-assistant contract for Qwen3.8 (Ollama / LM Studio).
// The model thinks, then calls one of these tools. Tings validates arguments
// and never lets prose write localStorage. Keep this list short: tool schemas
// compete with thinking tokens.

const ASSISTANT_INTENTS = ['create_task','create_habit','ask_today','complete_item','lookup_item','unclear','unsupported'];
const ASSISTANT_STEPS = ['classify','extract','window','weather','place','complete','lookup'];
const ASSISTANT_ANCHORS = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
const ASSISTANT_ANCHOR_ALIASES = {
  sunset:'maghrib', dusk:'maghrib', maghreb:'maghrib',
  dawn:'fajr', sunrise:'sunrise',
  noon:'dhuhr', zuhr:'dhuhr', dhuhr:'dhuhr',
  afternoon:'asr', asr:'asr',
  night:'isha', isha:'isha'
};
const ASSISTANT_MAX_LLM_CALLS = 8;
const ASSISTANT_MAX_REPAIRS = 2;
const ASSISTANT_NAME_MAX = 60;
const ASSISTANT_CONTEXT_COMPACT_AT = 0.6;
const ASSISTANT_DEFAULT_CONTEXT_TOKENS = 32768;
const ASSISTANT_CHARS_PER_TOKEN = 4;
const ASSISTANT_THINKING_REPLAY_MAX = 1200;
const ASSISTANT_THINKING_COMPACT_MAX = 240;

const ASSISTANT_ENDPOINT_PROPS = {
  type:'object',
  properties:{
    kind:{type:'string', enum:['unset','clock','anchor']},
    clock:{type:['string','null'], description:'24h HH:MM when kind is clock'},
    anchor:{type:['string','null'], description:'fajr, sunrise, dhuhr, asr, maghrib, isha. sunset means maghrib.'},
    offsetMin:{type:'integer', description:'signed minutes vs the anchor'}
  }
};

const ASSISTANT_TOOL_DEFS = {
  classify_intent:{
    description:'Classify a new request after thinking. If currentDraft is set and they mean that item, classify create_habit or create_task, then call draft_item with only the new fields.',
    parameters:{
      type:'object',
      required:['intent'],
      properties:{
        intent:{type:'string', enum:ASSISTANT_INTENTS},
        reason:{type:'string'}
      }
    }
  },
  draft_item:{
      description:'Create or change an item in one call. Fill every field the user said; omit the rest. If currentDraft is set, "it" means that item — keep its name and hid. Strings are preferred (rhythm, weekdays, windowText, durationMinutes). Do not nest objects.',
    parameters:{
      type:'object',
      properties:{
        kind:{type:'string', enum:['task','habit']},
        name:{type:['string','null'], description:'Item name, or omit/"it" to change currentDraft'},
        durationMinutes:{type:['integer','string','null'], description:'minutes, or "45 minutes" / "half an hour"'},
        priority:{type:['integer','string','null'], description:'0 critical … 5 someday, or urgent / someday'},
        due:{type:['string','null'], description:'today, tomorrow, a weekday, or YYYY-MM-DD'},
        dueTime:{type:['string','null'], description:'24h HH:MM or 7pm'},
        rhythm:{type:['string','null'], description:'plain English: "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend", "five times a week"'},
        timesPerPeriod:{type:['integer','string','null'], description:'5, or "five". Use with periodDays, or skip and set rhythm instead'},
        periodDays:{type:['integer','string','null'], description:'7 with timesPerPeriod 5 means five times a week; 8 with 3 means three times in eight days'},
        weekdays:{type:['array','string','null'], items:{type:'string'}, description:'Tuesday, "Tue, Wed, Fri", weekdays, weekends, or omit for any day'},
        windowText:{type:['string','null'], description:'plain English: "after sunset", "between 5pm and 7pm", "2 hours before sunset till sunset"'},
        weatherProfile:{type:['string','null'], description:'catalog weather name, none, inherit, or "not raining"'},
        weatherText:{type:['string','null'], description:'plain English weather: "only if it is not raining and not freezing"'},
        placeNames:{type:['array','string','null'], items:{type:'string'}, description:'catalog place names, or one name string'},
        anywhere:{type:['boolean','null']},
        needAsk:{type:'boolean'},
        ask:{type:['string','null']}
      }
    }
  },
  set_window:{
    description:'Set the allowed clock or prayer window on the current draft.',
    parameters:{
      type:'object',
      required:['start','end'],
      properties:{
        start:ASSISTANT_ENDPOINT_PROPS,
        end:ASSISTANT_ENDPOINT_PROPS
      }
    }
  },
  set_weather:{
    description:'Attach a named weather profile from the catalog, inherit the place default, or opt out.',
    parameters:{
      type:'object',
      required:['mode'],
      properties:{
        mode:{type:'string', enum:['none','inherit','profile']},
        profile:{type:['string','null']}
      }
    }
  },
  set_place:{
    description:'Attach saved places by catalog name. Do not invent names.',
    parameters:{
      type:'object',
      properties:{
        names:{type:'array', items:{type:'string'}},
        anywhere:{type:'boolean'},
        needAsk:{type:'boolean'},
        ask:{type:['string','null']}
      }
    }
  },
  complete_item:{
    description:'Find an existing item by name to log as done. Tings will preview before saving.',
    parameters:{
      type:'object',
      required:['name'],
      properties:{
        name:{type:'string'},
        minutes:{type:['integer','null'], description:'optional chunk minutes for a split habit'}
      }
    }
  },
  lookup_item:{
    description:'Look up one existing item: when it is, whether it is done, or if it is on today.',
    parameters:{
      type:'object',
      required:['name'],
      properties:{
        name:{type:'string'}
      }
    }
  },
  ask_user:{
    description:'Ask the user one short question when a catalog match is ambiguous or a required field is missing.',
    parameters:{
      type:'object',
      required:['question'],
      properties:{
        question:{type:'string'},
        choices:{type:['array','null'], items:{type:'string'}}
      }
    }
  }
};

function assistantOllamaTools(names){
  return names.map(name => ({
    type:'function',
    function:{
      name,
      description:ASSISTANT_TOOL_DEFS[name].description,
      parameters:ASSISTANT_TOOL_DEFS[name].parameters
    }
  }));
}

function assistantStepTools(step){
  if(step === 'classify')return ['classify_intent','draft_item'];
  if(step === 'extract')return ['draft_item','set_window','set_weather','set_place','ask_user'];
  if(step === 'window')return ['set_window','draft_item','ask_user'];
  if(step === 'weather')return ['set_weather','draft_item','ask_user'];
  if(step === 'place')return ['set_place','draft_item','ask_user'];
  if(step === 'complete')return ['complete_item','ask_user'];
  if(step === 'lookup')return ['lookup_item','ask_user'];
  return ['ask_user'];
}

function assistantStepPredict(step){
  if(step === 'classify')return 1200;
  if(step === 'extract')return 1800;
  return 1000;
}

function stripAssistantThink(text){
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi,'')
    .replace(/<think>[\s\S]*$/i,'')
    .trim();
}

function repairAssistantJson(raw){
  let s = String(raw || '').trim();
  if(!s)return {ok:false, error:'PARSE_FAIL', detail:'no JSON object'};
  s = s.replace(/,\s*([}\]])/g, '$1');
  try{
    return {ok:true, value:JSON.parse(s)};
  }catch(_){}
  s = s.replace(/,?\s*"[^"\\]*(?:\\.[^"\\]*)*"?\s*$/, '');
  s = s.replace(/,?\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*(?:true|false|null|-?\d+(?:\.\d+)?|"[^"\\]*(?:\\.[^"\\]*)*"?)?\s*$/, '');
  s = s.replace(/,?\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, '');
  s = s.replace(/,\s*$/, '');
  const extraArr = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  const extraObj = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  if(extraArr > 0)s += ']'.repeat(extraArr);
  if(extraObj > 0)s += '}'.repeat(extraObj);
  try{
    const value = JSON.parse(s);
    if(value && typeof value === 'object')return {ok:true, value, repaired:true};
  }catch(err){
    return {ok:false, error:'PARSE_FAIL', detail:String(err && err.message || err)};
  }
  return {ok:false, error:'PARSE_FAIL', detail:'no JSON object'};
}

function extractJsonObject(text){
  const stripped = stripAssistantThink(text);
  const fence = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : stripped;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const raw = start < 0
    ? ''
    : (end > start ? body.slice(start, end + 1) : body.slice(start));
  if(!raw)return {ok:false, error:'PARSE_FAIL', detail:'no JSON object'};
  return repairAssistantJson(raw);
}

function assistantNormalizeToolCall(raw){
  if(!raw || typeof raw !== 'object')return null;
  const fn = raw.function && typeof raw.function === 'object' ? raw.function : raw;
  const name = String(fn.name || raw.name || '').trim();
  if(!name)return null;
  let args = fn.arguments != null ? fn.arguments : raw.arguments;
  if(typeof args === 'string'){
    const parsed = extractJsonObject(args);
    if(!parsed.ok)return {name, args:null, parseError:parsed.detail};
    args = parsed.value;
  }
  if(!args || typeof args !== 'object' || Array.isArray(args))args = {};
  return {id:String(raw.id || ''), name, args};
}

function assistantParseReply(raw, stepHint){
  const msg = raw && raw.message && typeof raw.message === 'object'
    ? raw.message
    : (raw && typeof raw === 'object' ? raw : {});
  const thinking = String(msg.thinking || msg.reasoning || msg.reasoning_content || '');
  const content = String(msg.content || '');
  const rawCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const toolCalls = rawCalls.map(assistantNormalizeToolCall).filter(Boolean);
  if(!toolCalls.length && content){
    const parsed = extractJsonObject(content);
    if(parsed.ok && parsed.value && typeof parsed.value === 'object'){
      const name = String(parsed.value.tool || parsed.value.name || '').trim();
      if(name && ASSISTANT_TOOL_DEFS[name]){
        const args = parsed.value.arguments && typeof parsed.value.arguments === 'object'
          ? parsed.value.arguments
          : parsed.value;
        toolCalls.push({id:'', name, args});
      }else if(ASSISTANT_INTENTS.includes(parsed.value.intent)){
        toolCalls.push({id:'', name:'classify_intent', args:parsed.value});
      }else if(parsed.value.kind && parsed.value.name){
        toolCalls.push({id:'', name:'draft_item', args:parsed.value});
      }else if(parsed.value.name && (stepHint === 'complete' || parsed.value.done || parsed.value.complete)){
        toolCalls.push({id:'', name:'complete_item', args:parsed.value});
      }
    }
  }
  return {role:'assistant', content, thinking, toolCalls};
}

function assistantEstimateTokens(value){
  if(value == null || value === '')return 0;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(s.length / ASSISTANT_CHARS_PER_TOKEN);
}

function assistantMessageTokens(msg){
  if(!msg || typeof msg !== 'object')return 0;
  let n = 6 + assistantEstimateTokens(msg.role) + assistantEstimateTokens(msg.content);
  if(msg.thinking)n += assistantEstimateTokens(msg.thinking);
  if(msg.tool_calls)n += assistantEstimateTokens(msg.tool_calls);
  return n;
}

function assistantPromptTokens(messages, tools){
  let n = 0;
  for(const msg of messages || [])n += assistantMessageTokens(msg);
  if(tools && tools.length)n += assistantEstimateTokens(tools);
  return n;
}

function assistantGuessContextLimit(model){
  const s = String(model || '').toLowerCase();
  if(/qwen3\.8|qwen3-8|qwen3\.5|qwen3/.test(s))return 32768;
  if(/qwen/.test(s))return 32768;
  return ASSISTANT_DEFAULT_CONTEXT_TOKENS;
}

function assistantReadPromptTokens(raw){
  if(!raw || typeof raw !== 'object')return 0;
  const n = Number(raw.prompt_eval_count);
  if(Number.isFinite(n) && n > 0)return Math.round(n);
  const usage = raw.usage;
  if(usage && typeof usage === 'object'){
    const p = Number(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
    if(Number.isFinite(p) && p > 0)return Math.round(p);
  }
  return 0;
}

function assistantShouldCompact(used, limit, at){
  const threshold = at != null ? Number(at) : ASSISTANT_CONTEXT_COMPACT_AT;
  return limit > 0 && used / limit >= threshold;
}

function assistantTrimThinking(text, maxChars){
  const s = String(text || '').trim();
  const max = maxChars != null ? maxChars : ASSISTANT_THINKING_REPLAY_MAX;
  if(!s || s.length <= max)return s;
  return `…${s.slice(s.length - max)}`;
}

function assistantCompactFacts(parsed){
  if(!parsed || typeof parsed !== 'object')return null;
  const out = {};
  const pairs = [
    ['intent', parsed.intent],
    ['name', parsed.itemName],
    ['durationMinutes', parsed.durationMinutes],
    ['due', parsed.due],
    ['dueTime', parsed.dueTime],
    ['window', parsed.window],
    ['places', parsed.places],
    ['weather', parsed.weather],
    ['weatherHints', parsed.weatherHints],
    ['rhythm', parsed.rhythm],
    ['priority', parsed.priority],
    ['newName', parsed.newName]
  ];
  for(const [key, value] of pairs){
    if(value == null || value === '' || value === false)continue;
    if(Array.isArray(value) && !value.length)continue;
    if(key === 'weatherHints' && !value.mentioned)continue;
    if(key === 'intent' && value === 'unclear')continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function assistantCompactDraft(draft){
  if(!draft || !draft.name)return null;
  const out = {kind:draft.kind || null, name:draft.name};
  if(draft.hid)out.hid = draft.hid;
  if(draft.durationMinutes != null)out.durationMinutes = draft.durationMinutes;
  if(draft.window)out.window = draft.window;
  if(draft.weather)out.weather = {mode:draft.weather.mode, name:draft.weather.name || null};
  if(draft.places && draft.places.names && draft.places.names.length)out.places = draft.places.names;
    if(draft.kind === 'habit'){
    if(draft.timesPerPeriod != null)out.timesPerPeriod = draft.timesPerPeriod;
    if(draft.periodDays != null)out.periodDays = draft.periodDays;
    if(Array.isArray(draft.allowedWeekdays) && draft.allowedWeekdays.length)out.weekdays = draft.allowedWeekdays.slice();
  }
  if(draft.dueDate != null)out.dueDate = draft.dueDate;
  if(draft.dueTime)out.dueTime = draft.dueTime;
  return out;
}

function assistantLastSteeringText(messages){
  for(let i = (messages || []).length - 1; i >= 0; i -= 1){
    const msg = messages[i];
    if(!msg || msg.role !== 'user')continue;
    const c = String(msg.content || '');
    if(/That tool call was invalid|You thought but did not call|Call (?:set_|draft_|complete_|lookup_)|currentDraft is the item|The user is changing currentDraft/i.test(c)){
      return c;
    }
    return '';
  }
  return '';
}

function assistantReplayMessage(parsed, originalCalls){
  const msg = {role:'assistant', content:parsed.content || ''};
  if(parsed.thinking)msg.thinking = assistantTrimThinking(parsed.thinking, ASSISTANT_THINKING_REPLAY_MAX);
  const calls = originalCalls || parsed.toolCalls || [];
  if(calls.length){
    msg.tool_calls = calls.map((call,i)=>({
      id:call.id || `call_${i}`,
      type:'function',
      function:{
        name:call.name,
        arguments:typeof call.args === 'string' ? call.args : JSON.stringify(call.args || {})
      }
    }));
  }
  return msg;
}
