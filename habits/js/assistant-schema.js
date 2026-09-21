// Frozen local-assistant contract for Qwen3.8 (Ollama / LM Studio).
// The model thinks, then calls one of these tools. Tings validates arguments
// and never lets prose write localStorage. Keep this list short: tool schemas
// compete with thinking tokens.

const ASSISTANT_INTENTS = ['create_task','create_habit','create_setting','ask_today','ask_weather','ask_schedule','ask_items','ask_settings','complete_item','plan_item','delete_item','lookup_item','unclear','unsupported'];
const ASSISTANT_SETTING_KINDS = ['weather','location','busy','topic'];
const ASSISTANT_STEPS = ['classify','extract','complete','plan','delete','lookup','query','answer'];
const ASSISTANT_ANCHORS = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
const ASSISTANT_ANCHOR_ALIASES = {
  sunset:'maghrib', dusk:'maghrib', maghreb:'maghrib',
  dawn:'fajr', sunrise:'sunrise',
  noon:'dhuhr', zuhr:'dhuhr', dhuhr:'dhuhr',
  afternoon:'asr', asr:'asr',
  night:'isha', isha:'isha'
};
const ASSISTANT_MAX_LLM_CALLS = 10;
const ASSISTANT_MAX_LLM_CALLS_BATCH = 12;
const ASSISTANT_MAX_REPAIRS = 2;
const ASSISTANT_MAX_CLARIFY = 2;
const ASSISTANT_NAME_MAX = 60;
const ASSISTANT_INPUT_MAX = 12000;
const ASSISTANT_BATCH_MAX = 24;
const ASSISTANT_HEAVY_CHARS = 400;
// Compact late: small models need the transcript (and their own thinking)
// in context. 128k × 85% ≈ 111k tokens before we fold the trace.
const ASSISTANT_CONTEXT_COMPACT_AT = 0.85;
const ASSISTANT_DEFAULT_CONTEXT_TOKENS = 131072;
const ASSISTANT_CHARS_PER_TOKEN = 4;
const ASSISTANT_THINKING_REPLAY_MAX = 8000;
const ASSISTANT_THINKING_COMPACT_MAX = 240;
// Ollama num_predict counts thinking + the tool call. little-coder's default
// thinking budget is 4096; leave extra room so the model can still emit JSON.
const ASSISTANT_THINK_TOKENS = 4096;
const ASSISTANT_TOOL_TOKENS = 2048;
const ASSISTANT_BATCH_TOOL_TOKENS = 8192;
// A GLM reasoning pass is longer than a local model's, and max_tokens caps
// thinking plus the tool call together.
const ASSISTANT_GLM_THINK_TOKENS = 16384;

const ASSISTANT_DRAFT_ITEM_PROPERTIES = {
  kind:{type:'string', enum:['task','habit']},
  habitKind:{type:['string','null'], description:'keepup/build, reduce/limit, or zero/stop'},
  name:{type:['string','null'], description:'Short title only, e.g. Kettlebells. Never paste the rest of the sentence here. Omit/"it" to change currentDraft'},
  newName:{type:['string','null'], description:'Rename the current item'},
  emoji:{type:['string','null'], description:'emoji, or none'},
  emojiColor:{type:['string','null'], description:'teal, amber, red, purple, blue, green, pink, orange, indigo, cyan, lime, slate, or none'},
  durationMinutes:{type:['integer','string','null'], description:'minutes, or "45 minutes" / "half an hour"'},
  priority:{type:['integer','string','null'], description:'0 critical … 5 someday, or urgent / someday'},
  topics:{type:['array','string','null'], items:{type:'string'}, description:'"health, wellness", catalog topic names, or none'},
  due:{type:['string','null'], description:'today, tomorrow, a weekday, or YYYY-MM-DD'},
  dueTime:{type:['string','null'], description:'24h HH:MM or 7pm'},
  hardDue:{type:['boolean','string','null'], description:'true = due day is firm (no late days)'},
  planBy:{type:['string','null'], description:'keepup/reduce do-by date: today, tomorrow, or YYYY-MM-DD'},
  rhythm:{type:['string','null'], description:'plain English: "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend", "five times a week"'},
  timesPerPeriod:{type:['integer','string','null'], description:'5, or "five". Use with periodDays, or skip and set rhythm instead'},
  periodDays:{type:['integer','string','null'], description:'7 with timesPerPeriod 5 means five times a week; 8 with 3 means three times in eight days'},
  weekdays:{type:['array','string','null'], items:{type:'string'}, description:'Tuesday, "Tue, Wed, Fri", weekdays, weekends, or omit for any day'},
  monthDays:{type:['array','string','null'], items:{type:'string'}, description:'"1, 15", "the 1st", or any'},
  preferredWeekdays:{type:['array','string','null'], items:{type:'string'}, description:'soft weekday preference, or none'},
  preferredMonthDays:{type:['array','string','null'], items:{type:'string'}, description:'soft month-day preference, or none'},
  windowText:{type:['string','null'], description:'allowed window as one string: "after sunset", "between 5pm and 7pm", "later of 6pm and sunset until isha", "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier"'},
  preferredWindowText:{type:['string','null'], description:'preferred window, same phrasing as windowText'},
  earlyDays:{type:['integer','string','null'], description:'days it may start early, 0-60'},
  delayDays:{type:['integer','string','null'], description:'days it may stay on time late, 0-60'},
  breakable:{type:['boolean','string','null'], description:'true/split, or false/one session'},
  minChunkMinutes:{type:['integer','string','null'], description:'shortest split, or "15 minutes"'},
  autoMarkMinutes:{type:['integer','string','null'], description:'minutes, or manual/off'},
  trackValue:{type:['boolean','string','null'], description:'log a numeric value'},
  pinned:{type:['boolean','string','null']},
  snooze:{type:['string','null'], description:'off, 2 hours, until tomorrow, 3 days'},
  sharedDisplay:{type:['boolean','string','null'], description:'include on the shared display'},
  sharedComplete:{type:['boolean','string','null'], description:'allow completing from the shared display'},
  weatherProfile:{type:['string','null'], description:'catalog weather name, none, inherit, a new profile name, or "not raining"'},
  weatherText:{type:['string','null'], description:'plain English weather: "only if it is not raining and not freezing", or a patch like "prefer higher temperature". Tings creates a profile when none matches'},
  showWeather:{type:['boolean','string','null'], description:'show forecast on the card'},
  weatherAtPlace:{type:['boolean','string','null'], description:'forecast uses this item\'s place instead of home city'},
  weatherPlace:{type:['string','null'], description:'catalog place for anywhere-forecast, or none'},
  placeNames:{type:['array','string','null'], items:{type:'string'}, description:'catalog.places names only, or one string such as "home and mom\'s house". Never invent a place that is not in the catalog'},
  anywhere:{type:['boolean','null']},
  placePrefs:{type:['string','null'], description:'"Home high, Gym avoid"'},
  before:{type:['string','null'], description:'other item this should finish before, or none'},
  after:{type:['string','null'], description:'other item this should start after, or none'},
  order:{type:['string','null'], description:'"right after Walk, same day" or "none"'},
  links:{type:['array','string','null'], items:{type:'string'}, description:'URL, tel:, "call 5551234", or none'},
  option:{type:['array','string','null'], items:{type:'string'}, description:'extra window "Tue 9am-11am at Home", or none'},
  needAsk:{type:'boolean'},
  ask:{type:['string','null']}
};

function assistantBatchItemProperties(){
  return Object.assign({}, ASSISTANT_DRAFT_ITEM_PROPERTIES, {
    name:{type:'string', description:'Short title only. Never paste the rest of the request here.'},
    placeNames:{type:['array','string','null'], items:{type:'string'}, description:'Saved catalog place, or a new name that also appears in places'}
  });
}

function assistantLooksLikeMultiItem(text){
  const s = String(text || '');
  if(!s)return false;
  const creates = (s.match(/\b(?:add|create|remind me to|new (?:task|habit))\b/gi) || []).length;
  if(creates >= 2)return true;
  if(/\b(?:add these|add all(?: of)?(?: these| them| this)?|add both|the following|a few things|several things|these items|set up my (?:week|semester|schedule))\b/i.test(s))return true;
  if(/\b(?:and also add|then add|plus add|as well as adding)\b/i.test(s))return true;
  return false;
}

function assistantRequestIsHeavy(text){
  return String(text || '').length >= (typeof ASSISTANT_HEAVY_CHARS === 'number' ? ASSISTANT_HEAVY_CHARS : 400);
}

function assistantRequestNeedsModel(text){
  return assistantLooksLikeMultiItem(text) || assistantRequestIsHeavy(text);
}

const ASSISTANT_TOOL_DEFS = {
  classify_intent:{
    description:'Classify only when you cannot call the final tool directly. create_setting is a weather profile, place, busy time, or topic. ask_weather and ask_schedule use live data; availability, missed-item, ranking, and what-if questions are ask_schedule, not creation. For schedule rankings call answer_schedule with select. Several questions or an action plus a question require a tool for every part. ask_items covers lists/status/progress; ask_settings covers saved configuration; lookup_item covers one item’s next time/history/stats/why. complete_item, plan_item, and delete_item preview actions. If a name or request is ambiguous, call find_item or ask_user instead of guessing. currentDraft and recent hold conversational context.',
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
      description:'Create or change one item in one call. Fill every setting the user named; omit the rest. name is a 1-3 word title. Put habitKind, topics, windowText, order, placePrefs, hardDue, and the rest in their own fields. If currentDraft is set, "it" means that item — keep its name and hid. Prefer plain strings. Do not nest window or place objects — a nested object is how tool JSON gets cut off. Several items in one request belong in draft_batch, not repeated draft_item calls.',
    parameters:{
      type:'object',
      properties:ASSISTANT_DRAFT_ITEM_PROPERTIES
    }
  },
  draft_batch:{
    description:'Create several items from one request — a list, a pasted schedule, two habits, errands plus places. Call this once instead of many draft_item calls. Each item uses the same fields as draft_item. Recurring meetings are habits. Skip a row that is TBA with no days and no times. Unknown place names go in places with a dummy address — do not ask. The user will set the real address later. One item, even with a long instruction, is still draft_item.',
    parameters:{
      type:'object',
      required:['items'],
      properties:{
        places:{
          type:'array',
          items:{
            type:'object',
            properties:{
              name:{type:'string', description:'New place, room, or building'},
              address:{type:['string','null'], description:'Dummy address is fine'}
            }
          }
        },
        items:{
          type:'array',
          items:{
            type:'object',
            properties:assistantBatchItemProperties()
          }
        }
      }
    }
  },
  draft_setting:{
    description:'Create or change a settings row — weather profile, place, busy time, or topic — not a habit or task. name is a short title. For weather, weatherText is the rules as one string; a follow-up patches currentDraft.rules (prefer higher/lower, harder/softer bounds) without dropping other metrics. For a place, address is the search query (lat/lng if known). For busy time, windowText and days. If currentDraft is a setting, keep its kind and name and only add the new fields.',
    parameters:{
      type:'object',
      required:['kind','name'],
      properties:{
        kind:{type:'string', enum:ASSISTANT_SETTING_KINDS},
        name:{type:['string','null'], description:'Short title: Barbecuing, Gym, Sleep, health'},
        newName:{type:['string','null']},
        weatherText:{type:['string','null'], description:'Weather rules in English. On a change this MERGES onto currentDraft.rules — do not repeat rules you are not changing. Examples: "prefer higher temperature", "wind under 25mph hard", "rain chance under 20, prefer lower"'},
        address:{type:['string','null'], description:'Place search query or street address'},
        lat:{type:['number','string','null']},
        lng:{type:['number','string','null']},
        windowText:{type:['string','null'], description:'Busy window, same phrasing as item windowText'},
        days:{type:['array','string','null'], items:{type:'string'}, description:'Busy weekdays, or omit for every day'}
      }
    }
  },
  complete_item:{
    description:'Log an existing item, or undo its latest completion from today. Tings previews before saving. Include minutes for a habit chunk, value for a tracked measurement, and note for optional log detail.',
    parameters:{
      type:'object',
      required:['name'],
      properties:{
        name:{type:'string'},
        action:{type:['string','null'], enum:['log','undo_today',null], description:'log by default; undo_today means mark it not done / undo today’s latest completion'},
        minutes:{type:['integer','null'], description:'optional chunk minutes for a split habit'},
        value:{type:['number','string','null'], description:'optional numeric tracked value'},
        note:{type:['string','null'], description:'optional short note about this completion'}
      }
    }
  },
  plan_item:{
    description:'Plan or unplan one occurrence of an existing task/habit on a date. This is a one-day plan, not a change to the recurring schedule or due date. An optional time makes it a fixed appointment; an optional saved place applies only to that day. Tings previews before saving.',
    parameters:{
      type:'object',
      required:['name','date'],
      properties:{
        name:{type:'string'},
        action:{type:['string','null'], enum:['add','remove',null], description:'add by default; remove unplans that date'},
        date:{type:'string', description:'today, tomorrow, a weekday, or YYYY-MM-DD'},
        time:{type:['string','null'], description:'optional fixed clock, such as 3pm or 15:00'},
        place:{type:['string','null'], description:'optional saved catalog place for this occurrence'}
      }
    }
  },
  lookup_item:{
    description:'Answer a question about one existing item. name may be a fragment, nickname, typo, or the whole question — Tings ranks saved titles and uses a unique match. If several titles could fit, Tings asks instead of guessing. summary includes next planned time and last completion; history lists recent logs; stats gives pace/streak/progress; why explains planner placement.',
    parameters:{
      type:'object',
      required:['name'],
      properties:{
        name:{type:'string', description:'Saved title, a distinctive word from it, or the user’s phrasing'},
        query:{type:['string','null'], enum:['summary','history','stats','why',null]},
        date:{type:['string','null'], description:'for why: today, tomorrow, a weekday, or YYYY-MM-DD'}
      }
    }
  },
  find_item:{
    description:'Search saved tasks/habits by a name fragment, nickname, typo, or the whole question. Tings ranks deterministic fuzzy matches. Use this when the spoken name may not match the saved title. If several could fit, Tings asks the user — do not guess. Set action when this search is for a lookup, completion, plan, or deletion so a name clarification continues the same action. After a unique match, call the requested tool with that exact name.',
    parameters:{
      type:'object',
      required:['query'],
      properties:{
        query:{type:'string', description:'Name fragment, nickname, or the user’s phrasing'},
        limit:{type:['integer','null'], description:'max matches, default 5'},
        action:{type:['string','null'], enum:['lookup','complete','plan','delete',null], description:'operation to resume after name clarification'}
      }
    }
  },
  delete_item:{
    description:'Find one existing task or habit by name and preview removing it. Tings always asks for confirmation before deletion.',
    parameters:{
      type:'object',
      required:['name'],
      properties:{name:{type:'string'}}
    }
  },
  answer_items:{
    description:'Answer list and status questions about tasks and habits. list = names matching kind/status/search, each with priority and frequency so you can rank the list; progress = a concise today summary. Use this for "what habits do I have", "show my open tasks", "what did I finish today", and "how am I doing today". If the request has another clause, call this and the other matching tools. After items return, rank from that payload or call lookup_item only for extra history/stats/why.',
    parameters:{
      type:'object',
      required:['query'],
      properties:{
        query:{type:'string', enum:['list','progress']},
        kind:{type:['string','null'], enum:['all','task','habit',null]},
        status:{type:['string','null'], enum:['all','open','done','overdue',null]},
        search:{type:['string','null'], description:'optional name or topic text filter'}
      }
    }
  },
  answer_settings:{
    description:'List configured places, weather profiles, topics, or busy times. Use this for questions about what app settings are already available.',
    parameters:{
      type:'object',
      required:['kind'],
      properties:{kind:{type:'string', enum:['places','weather','topics','busy']}}
    }
  },
  answer_weather:{
    description:'Answer a weather question from the real forecast — Tings computes it, never guess weather. query day = "what is the weather tomorrow". query window = "will it rain Thursday 5 to 6 pm" (start and end required). query item = "should I run today given the weather" (name required).',
    parameters:{
      type:'object',
      required:['query'],
      properties:{
        query:{type:'string', enum:['day','window','item']},
        date:{type:['string','null'], description:'today, tomorrow, a weekday, or YYYY-MM-DD. Default today'},
        start:{type:['string','null'], description:'window start: 5pm or 17:00'},
        end:{type:['string','null'], description:'window end: 6pm or 18:00'},
        name:{type:['string','null'], description:'existing item for query item'}
      }
    }
  },
  answer_schedule:{
    description:'Answer a schedule question by computing it against the real plan — never guess the schedule. query free = how much time is open on a day, or whether one window is open (start/end). query freest = which day of the week is freest. query conflict = "if I block/add a task tomorrow 5 to 6 pm, will I miss anything" — what a new window would displace (start and end required). query missed = the same list as the missed pill on today\'s header (planner expectations that slipped, not a raw overdue dump). query day = the agenda for one day, with per-item priority and frequency. query week = the whole week overview. For "most important", "most frequent", or "longest", set select so Tings computes the answer; never rank items yourself. Several questions in one message: call this for each schedule part and lookup_item / answer_weather / answer_items for the rest.',
    parameters:{
      type:'object',
      required:['query'],
      properties:{
        query:{type:'string', enum:['free','freest','conflict','missed','day','week']},
        date:{type:['string','null'], description:'today, tomorrow, a weekday, or YYYY-MM-DD. Default today'},
        start:{type:['string','null'], description:'window start: 5pm or 17:00'},
        end:{type:['string','null'], description:'window end: 6pm or 18:00'},
        minutes:{type:['integer','null'], description:'duration in minutes, e.g. a 45 minute task'},
        select:{type:['string','null'], enum:['most_important','most_frequent','longest',null], description:'Compute one ranked choice from query day or missed. Omit for the full list.'}
      }
    }
  },
  ask_user:{
    description:'Ask the user one short question when you are confused, two Tings actions could fit, a catalog match is ambiguous, or a required field is missing. Do not guess. One question, optional short choices. Tings allows two clarification questions in a row, then stops.',
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

function assistantIsSettingKind(kind){
  return ASSISTANT_SETTING_KINDS.indexOf(kind) >= 0;
}

function assistantIsItemKind(kind){
  return kind === 'habit' || kind === 'task';
}

function assistantStepTools(step){
  // The first model pass may call the final tool directly. classify_intent is
  // retained for models that prefer a two-step plan, not as a mandatory gate.
  if(step === 'classify')return ['classify_intent','draft_item','draft_setting','draft_batch','complete_item','plan_item','delete_item','lookup_item','find_item','answer_weather','answer_schedule','answer_items','answer_settings','ask_user'];
  if(step === 'extract')return ['draft_item','draft_setting','draft_batch','complete_item','plan_item','delete_item','lookup_item','find_item','answer_weather','answer_schedule','answer_items','answer_settings','ask_user'];
  if(step === 'complete')return ['complete_item','find_item','ask_user'];
  if(step === 'plan')return ['plan_item','find_item','ask_user'];
  if(step === 'delete')return ['delete_item','find_item','ask_user'];
  if(step === 'lookup')return ['lookup_item','find_item','ask_user'];
  if(step === 'query')return ['answer_weather','answer_schedule','answer_items','answer_settings','lookup_item','find_item','complete_item','plan_item','delete_item','ask_user'];
  if(step === 'answer')return ['lookup_item','find_item','answer_weather','answer_schedule','answer_items','answer_settings','complete_item','plan_item','delete_item','ask_user'];
  return ['ask_user'];
}

function assistantWideSession(session){
  return Boolean(session && (session.wide || session.bulk));
}

function assistantStepPredict(step, session){
  const wide = typeof assistantWideSession === 'function' ? assistantWideSession(session) : Boolean(session && session.bulk);
  if(step === 'extract' || step === 'classify'){
    // The model, not a text pre-parser, decides whether the request needs
    // draft_batch. Give the first pass enough room to emit a large batch even
    // though the session cannot be labelled "wide" before the model reads it.
    const toolTokens = wide
      ? (typeof ASSISTANT_BATCH_TOOL_TOKENS === 'number' ? ASSISTANT_BATCH_TOOL_TOKENS : 8192)
      : step === 'classify'
        ? (typeof ASSISTANT_BATCH_TOOL_TOKENS === 'number' ? ASSISTANT_BATCH_TOOL_TOKENS : 8192)
        : ASSISTANT_TOOL_TOKENS;
    return ASSISTANT_THINK_TOKENS + toolTokens;
  }
  if(step === 'query' || step === 'answer')return ASSISTANT_THINK_TOKENS + 1024;
  return ASSISTANT_THINK_TOKENS + 512;
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
      }else if(Array.isArray(parsed.value.items)){
        toolCalls.push({id:'', name:'draft_batch', args:parsed.value});
      }else if(parsed.value.kind && parsed.value.name && assistantIsSettingKind(parsed.value.kind)){
        toolCalls.push({id:'', name:'draft_setting', args:parsed.value});
      }else if(parsed.value.kind && parsed.value.name){
        toolCalls.push({id:'', name:'draft_item', args:parsed.value});
      }else if(parsed.value.name && (parsed.value.windowText || parsed.value.rhythm || parsed.value.durationMinutes != null || parsed.value.kind || parsed.value.weatherText || parsed.value.address)){
        toolCalls.push({
          id:'',
          name:assistantIsSettingKind(parsed.value.kind) ? 'draft_setting' : 'draft_item',
          args:parsed.value
        });
      }else if(ASSISTANT_INTENTS.includes(parsed.value.intent)){
        toolCalls.push({id:'', name:'classify_intent', args:parsed.value});
      }else if(parsed.value.name && (stepHint === 'complete' || parsed.value.done || parsed.value.complete)){
        toolCalls.push({id:'', name:'complete_item', args:parsed.value});
      }
    }
  }
  if(!toolCalls.length && raw && raw._parseError){
    toolCalls.push({id:'', name:'', args:null, parseError:String(raw._parseError)});
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
  if(/qwen3\.8|qwen3-8|qwen3\.5|qwen3/.test(s))return 131072;
  if(/qwen/.test(s))return 131072;
  if(/glm[-_ ]?5\.[23]/.test(s))return 1000000;
  if(/glm/.test(s))return 200000;
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
    ['settingKind', parsed.settingKind],
    ['address', parsed.address],
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
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)){
    const out = {kind:draft.kind, name:draft.name};
    if(draft.settingId)out.settingId = draft.settingId;
    if(draft.kind === 'weather'){
      const rules = typeof assistantDraftWeatherRules === 'function'
        ? assistantDraftWeatherRules(draft)
        : ((draft.weatherProposed && draft.weatherProposed.rules) || []);
      const chips = typeof assistantWeatherRulesSummary === 'function'
        ? assistantWeatherRulesSummary(rules)
        : [];
      if(chips.length)out.rules = chips;
    }
    if(draft.address)out.address = draft.address;
    if(draft.window)out.window = draft.window;
    if(Array.isArray(draft.allowedWeekdays) && draft.allowedWeekdays.length)out.days = draft.allowedWeekdays.slice();
    return out;
  }
  const out = {kind:draft.kind || null, name:draft.name};
  if(draft.hid)out.hid = draft.hid;
  if(draft.habitKind && draft.habitKind !== 'keepup')out.habitKind = draft.habitKind;
  if(draft.emoji)out.emoji = draft.emoji;
  if(draft.emojiBgColor)out.emojiColor = draft.emojiBgColor;
  if(draft.durationMinutes != null)out.durationMinutes = draft.durationMinutes;
  if(draft.priority != null)out.priority = draft.priority;
  if(Array.isArray(draft.topics) && draft.topics.length)out.topics = draft.topics.slice();
  if(draft.window)out.window = draft.window;
  if(draft.preferredWindow)out.preferredWindow = draft.preferredWindow;
  if(draft.weather)out.weather = {mode:draft.weather.mode, name:draft.weather.name || null};
  if(draft.places && draft.places.names && draft.places.names.length)out.places = draft.places.names;
  if(draft.locationPrefs && draft.places && Array.isArray(draft.places.ids)){
    const prefs = draft.places.ids.map((id, i) => {
      const level = draft.locationPrefs[id];
      const name = draft.places.names && draft.places.names[i];
      return level && name ? `${name} ${level}` : null;
    }).filter(Boolean);
    if(prefs.length)out.placePrefs = prefs.join(', ');
  }
  if(draft.kind === 'habit'){
    if(draft.timesPerPeriod != null)out.timesPerPeriod = draft.timesPerPeriod;
    if(draft.periodDays != null)out.periodDays = draft.periodDays;
    if(Array.isArray(draft.allowedWeekdays) && draft.allowedWeekdays.length)out.weekdays = draft.allowedWeekdays.slice();
    if(Array.isArray(draft.allowedMonthDays) && draft.allowedMonthDays.length)out.monthDays = draft.allowedMonthDays.slice();
    if(Array.isArray(draft.preferredWeekdays) && draft.preferredWeekdays.length)out.preferredWeekdays = draft.preferredWeekdays.slice();
    if(Array.isArray(draft.preferredMonthDays) && draft.preferredMonthDays.length)out.preferredMonthDays = draft.preferredMonthDays.slice();
  }
  if(draft.dueDate != null)out.dueDate = draft.dueDate;
  if(draft.dueTime)out.dueTime = draft.dueTime;
  if(draft.earlyWindowDays != null)out.earlyDays = draft.earlyWindowDays;
  if(draft.delayAllowanceDays != null)out.delayDays = draft.delayAllowanceDays;
  if(draft.breakable != null)out.breakable = draft.breakable;
  if(draft.minChunkMinutes != null)out.minChunkMinutes = draft.minChunkMinutes;
  if(draft.autoMarkMinutes !== undefined)out.autoMarkMinutes = draft.autoMarkMinutes;
  if(draft.trackValue)out.trackValue = true;
  if(draft.pinned)out.pinned = true;
  if(draft.hardDue)out.hardDue = true;
  if(Array.isArray(draft.scheduleOptions) && draft.scheduleOptions.length)out.options = draft.scheduleOptions.length;
  if(Array.isArray(draft.scheduleLinks) && draft.scheduleLinks.length){
    out.order = draft.scheduleLinks.map(link => `${link.direction} ${link.name || link.anchorHid}`).join(', ');
  }
  if(Array.isArray(draft.links) && draft.links.length){
    out.links = draft.links.map(link => String(link && (link.value || link) || '').slice(0, 48)).filter(Boolean).slice(0, 3);
  }
  return out;
}

function assistantLastSteeringText(messages){
  for(let i = (messages || []).length - 1; i >= 0; i -= 1){
    const msg = messages[i];
    if(!msg || msg.role !== 'user')continue;
    const c = String(msg.content || '');
    if(/That tool call was invalid|was cut off|Do not call a tool|FLAT strings|You thought but did not call|Call (?:set_|draft_|complete_|lookup_)|currentDraft is the item|The user is changing currentDraft|weather profile, place, busy time/i.test(c)){
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
