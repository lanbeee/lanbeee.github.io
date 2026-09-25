// Local assistant tools: catalogs, argument validation, draft merge, save.
// The model never receives addresses, notes, logs, or coordinates.
// Clock / due / duration parsers live in assistant-parse.js (loaded first).

function assistantCleanAnchor(value){
  const raw = String(value || '').trim().toLowerCase();
  if(!raw)return null;
  const aliased = ASSISTANT_ANCHOR_ALIASES[raw] || raw;
  if(typeof cleanPrayerAnchor === 'function')return cleanPrayerAnchor(aliased);
  return ASSISTANT_ANCHORS.includes(aliased) ? aliased : null;
}

function assistantSecondaryFromRaw(raw){
  if(!raw || typeof raw !== 'object')return null;
  if(raw.second && typeof raw.second === 'object')return assistantNormalizeEndpoint(raw.second);
  const has = raw.clock2 != null || raw.anchor2 != null || raw.habit2 != null;
  if(!has)return null;
  return assistantNormalizeEndpoint({
    kind:raw.habit2 ? 'habit' : (raw.anchor2 ? 'anchor' : 'clock'),
    clock:raw.clock2,
    anchor:raw.anchor2,
    offsetMin:raw.offsetMin2,
    habit:raw.habit2,
    dayOffset:raw.dayOffset2
  });
}

function assistantNormalizeEndpoint(raw){
  if(!raw || typeof raw !== 'object')return {kind:'unset'};
  const kind = raw.kind === 'clock' || raw.kind === 'anchor' || raw.kind === 'habit'
    ? raw.kind
    : (raw.habit ? 'habit' : (raw.anchor ? 'anchor' : (raw.clock ? 'clock' : 'unset')));
  let end;
  if(kind === 'clock'){
    const minutes = assistantParseClock(raw.clock != null ? raw.clock : raw.minutes);
    if(minutes == null && Number.isFinite(Number(raw.minutes))){
      end = {kind:'clock', minutes:Number(raw.minutes), clock:assistantClockLabel(Number(raw.minutes))};
    }else if(minutes == null){
      return {error:'clock must be HH:MM (or 7pm)'};
    }else{
      end = {kind:'clock', minutes, clock:assistantClockLabel(minutes)};
    }
  }else if(kind === 'anchor'){
    const anchor = assistantCleanAnchor(raw.anchor);
    if(!anchor)return {error:'anchor must be fajr, sunrise, dhuhr, asr, maghrib, or isha (sunset means maghrib)'};
    const offset = Number.isFinite(Number(raw.offsetMin)) ? Math.round(Number(raw.offsetMin)) : 0;
    const clamped = typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : offset;
    end = {kind:'anchor', anchor, offsetMin:clamped};
  }else if(kind === 'habit'){
    const name = String(raw.habit || raw.anchor || raw.name || '').trim();
    if(!name)return {error:'habit window needs another item name'};
    const offset = Number.isFinite(Number(raw.offsetMin)) ? Math.round(Number(raw.offsetMin)) : 0;
    const clamped = typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : offset;
    end = {kind:'habit', habitName:name, habitId:raw.habitId || null, offsetMin:clamped};
  }else{
    end = {kind:'unset'};
  }
  const dayOffset = Number(raw.dayOffset) === 1 ? 1 : 0;
  if(dayOffset)end.dayOffset = 1;
  const combine = typeof cleanTimeCombine === 'function'
    ? cleanTimeCombine(raw.combine)
    : (raw.combine === 'later' || raw.combine === 'earlier' ? raw.combine : null);
  if(combine){
    const second = assistantSecondaryFromRaw(raw);
    if(second && !second.error && second.kind !== 'unset'){
      end.combine = combine;
      end.second = second;
    }
  }
  return end;
}

function assistantResolveEndpointHabits(end, data){
  if(!end || typeof end !== 'object')return {ok:true, end:end || {kind:'unset'}};
  let next = end;
  if(end.kind === 'habit' && !end.habitId){
    const found = typeof assistantFindHabit === 'function'
      ? assistantFindHabit(data, end.habitName || end.habit || end.name)
      : {ok:false};
    if(!found || !found.ok){
      return found && found.ok === false
        ? found
        : {ok:false, error:'UNKNOWN', ask:'I cannot find that item to use as a time anchor.'};
    }
    next = Object.assign({}, end, {habitId:found.hid, habitName:found.name});
  }
  if(next.second){
    const second = assistantResolveEndpointHabits(next.second, data);
    if(!second.ok)return second;
    if(second.end !== next.second)next = Object.assign({}, next, {second:second.end});
  }
  return {ok:true, end:next};
}

function assistantResolveWindowHabits(window, data){
  if(!window || typeof window !== 'object')return {ok:true, window};
  const start = assistantResolveEndpointHabits(window.start, data);
  if(!start.ok)return start;
  const end = assistantResolveEndpointHabits(window.end, data);
  if(!end.ok)return end;
  if(start.end === window.start && end.end === window.end)return {ok:true, window};
  return {ok:true, window:{start:start.end, end:end.end}};
}

function assistantMatchByName(list, value){
  const want = String(value || '').trim().toLowerCase();
  if(!want)return {ok:false, error:'empty name'};
  const exact = list.filter(item => String(item.name || '').trim().toLowerCase() === want);
  if(exact.length === 1)return {ok:true, item:exact[0]};
  if(exact.length > 1)return {ok:false, error:'AMBIGUOUS', matches:exact};
  const part = list.filter(item => {
    const name = String(item.name || '').toLowerCase();
    return name.includes(want) || want.includes(name);
  });
  if(part.length === 1)return {ok:true, item:part[0]};
  if(part.length > 1)return {ok:false, error:'AMBIGUOUS', matches:part};
  const limit = typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(want.length) : 0;
  if(limit > 0 && typeof assistantLevenshtein === 'function'){
    const fuzzy = list.filter(item => {
      const name = String(item.name || '').trim().toLowerCase();
      if(!name)return false;
      return assistantLevenshtein(want, name) <= Math.max(limit, assistantFuzzyLimit(name.length));
    });
    if(fuzzy.length === 1)return {ok:true, item:fuzzy[0]};
    if(fuzzy.length > 1)return {ok:false, error:'AMBIGUOUS', matches:fuzzy};
  }
  return {ok:false, error:'UNKNOWN', names:list.map(item => item.name)};
}

const ASSISTANT_NAME_STOP = new Set([
  'a','an','the','my','your','to','of','for','and','or','on','in','at','it','this','that',
  'when','where','what','which','who','how','am','is','are','was','were','be','been',
  'do','did','does','have','has','had','i','im','ive','should','would','could','can','will',
  'next','last','today','tomorrow','tonight','please','you','me','we','they','okay','ok',
  'then','if','not','so','just','also','still','already','yet','supposed','something',
  'anything','plan','agenda','list','schedule','again','now','about','with','from',
  'there','here','into','than','too','very','being','wasnt','isnt'
]);
const ASSISTANT_NAME_WEAK = new Set([
  'call','check','log','mark','finish','finished','done','buy','get','pick','run','make',
  'take','go','see','ask','tell','set','add'
]);

function assistantNameTokens(text){
  const norm = typeof assistantNormText === 'function' ? assistantNormText(text) : String(text || '').toLowerCase();
  return norm.replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).map(tok => tok.replace(/'s$/g, '').replace(/'/g, '')).filter(tok => tok.length >= 2 && !ASSISTANT_NAME_STOP.has(tok));
}

function assistantScoreNameMatch(query, name){
  const qRaw = typeof assistantNormText === 'function' ? assistantNormText(query) : String(query || '').trim().toLowerCase();
  const nRaw = typeof assistantNormText === 'function' ? assistantNormText(name) : String(name || '').trim().toLowerCase();
  if(!qRaw || !nRaw)return {score:0, why:''};
  if(qRaw === nRaw)return {score:100, why:'exact'};
  const qFold = qRaw.replace(/[^a-z0-9]+/g, '');
  const nFold = nRaw.replace(/[^a-z0-9]+/g, '');
  if(qFold && qFold === nFold)return {score:96, why:'exact'};
  let score = 0;
  const why = [];
  if(nRaw.includes(qRaw) && qRaw.length >= 3){
    score += qRaw.length >= 5 ? 48 : 34;
    why.push('in-name');
  }else if(qRaw.includes(nRaw) && nRaw.length >= 4){
    score += 44;
    why.push('in-query');
  }
  const qTokens = assistantNameTokens(qRaw);
  const nTokens = assistantNameTokens(nRaw);
  const nSet = new Set(nTokens);
  for(const qt of qTokens){
    const weak = ASSISTANT_NAME_WEAK.has(qt);
    if(nSet.has(qt)){
      score += weak ? 10 : (qt.length >= 4 ? 46 : 28);
      if(!weak)why.push('token:' + qt);
      continue;
    }
    const prefixed = nTokens.find(nt => nt.length >= 4 && qt.length >= 3 && (nt.startsWith(qt) || qt.startsWith(nt)));
    if(prefixed && !weak){
      score += 22;
      why.push('prefix:' + prefixed);
      continue;
    }
    if(qt.length >= 3 && typeof assistantLevenshtein === 'function'){
      let best = null;
      let bestD = 99;
      for(const nt of nTokens){
        if(nt.length < 3)continue;
        const dist = assistantLevenshtein(qt, nt);
        const lim = Math.max(
          typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(qt.length) : 0,
          typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(nt.length) : 0
        );
        if(dist > 0 && dist <= lim && dist < bestD){
          bestD = dist;
          best = nt;
        }
      }
      if(best){
        score += weak ? 6 : 30;
        why.push('typo:' + qt + '~' + best);
      }
    }
  }
  if(typeof assistantLevenshtein === 'function' && qRaw.length >= 4 && nRaw.length >= 4 && qRaw.length <= nRaw.length + 8){
    const dist = assistantLevenshtein(qRaw, nRaw);
    const lim = Math.max(
      typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(qRaw.length) : 0,
      typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(nRaw.length) : 0
    );
    if(dist > 0 && dist <= lim + 1){
      score += Math.max(8, 26 - dist * 8);
      why.push('edit:' + dist);
    }
  }
  return {score, why:why.slice(0, 3).join(',')};
}

function assistantHabitRows(data){
  return (Array.isArray(data) ? data : []).map((habit, index) => ({
    index,
    hid:habit && habit.hid,
    name:String(habit && habit.name || ''),
    type:habit && habit.type,
    habit
  })).filter(item => item.name);
}

function assistantRankByName(list, query, limit){
  const cap = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const scored = [];
  for(const item of list || []){
    const name = String(item && item.name || '');
    if(!name)continue;
    const hit = assistantScoreNameMatch(query, name);
    if(hit.score > 0)scored.push({item, name, score:hit.score, why:hit.why, type:item.type === 'task' ? 'task' : 'habit'});
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, cap);
}

function assistantCandidateRows(ranked){
  return (ranked || []).map(row => ({
    name:row.name,
    type:row.type || (row.item && row.item.type === 'task' ? 'task' : 'habit'),
    score:row.score,
    why:row.why || ''
  }));
}

function assistantHabitAskFromCandidates(candidates, error){
  const names = (candidates || []).map(row => row && row.name).filter(Boolean);
  if(names.length === 1){
    return {
      ok:false,
      error:error || 'CONFIRM',
      ask:`Did you mean ${names[0]}?`,
      choices:names,
      candidates,
      matches:names.map(name => ({name}))
    };
  }
  if(names.length){
    return {
      ok:false,
      error:error || 'AMBIGUOUS',
      ask:`Which one: ${names.join(', ')}?`,
      choices:names,
      candidates,
      matches:names.map(name => ({name}))
    };
  }
  return {
    ok:false,
    error:error || 'UNKNOWN',
    ask:'I do not see that on your list.',
    choices:[],
    candidates:[]
  };
}

function assistantPickRankedName(ranked){
  const rows = Array.isArray(ranked) ? ranked : [];
  const candidates = assistantCandidateRows(rows);
  if(!rows.length)return {ok:false, error:'UNKNOWN', candidates:[]};
  const top = rows[0];
  const second = rows[1];
  const gap = second ? top.score - second.score : 99;
  const strong = top.score >= 36 && (rows.length === 1 || (top.score >= 42 && gap >= 16));
  if(strong)return {ok:true, item:top.item, candidates};
  if(rows.length === 1 && top.score >= 16)return {ok:false, error:'CONFIRM', item:top.item, candidates};
  const close = rows.filter(row => row.score >= 10 && row.score >= top.score - 14);
  if(close.length > 1)return {ok:false, error:'AMBIGUOUS', matches:close.map(row => row.item), candidates:assistantCandidateRows(close)};
  if(rows.length === 1)return {ok:false, error:'CONFIRM', item:top.item, candidates};
  return {ok:false, error:'AMBIGUOUS', matches:rows.map(row => row.item), candidates};
}

function assistantFindHabit(data, value){
  const list = assistantHabitRows(data);
  const query = String(value || '').trim();
  if(!query){
    return assistantHabitAskFromCandidates([], 'UNKNOWN');
  }
  if(!list.length){
    return {ok:false, error:'UNKNOWN', ask:'Your list is empty, so there is nothing to look up yet.', choices:[], candidates:[]};
  }
  const ranked = assistantRankByName(list, query, 8);
  const picked = assistantPickRankedName(ranked);
  if(picked.ok)return {ok:true, ...picked.item, candidates:picked.candidates};
  if(!picked.candidates || !picked.candidates.length){
    return {ok:false, error:'UNKNOWN', ask:'I do not see that on your list.', choices:[], candidates:[]};
  }
  return assistantHabitAskFromCandidates(picked.candidates, picked.error);
}

function assistantFindHabitSmart(data, name, spoken){
  const primary = String(name || '').trim();
  const found = assistantFindHabit(data, primary);
  if(found.ok)return found;
  const fallback = String(spoken || '').trim();
  if(!fallback || (typeof assistantNormText === 'function'
    ? assistantNormText(fallback) === assistantNormText(primary)
    : fallback.toLowerCase() === primary.toLowerCase()))return found;
  // A long utterance can uniquely hit a different mentioned title ("after Walk").
  if(fallback.length > 80 || fallback.split(/\s+/).filter(Boolean).length > 8)return found;
  const alt = assistantFindHabit(data, fallback);
  if(alt.ok)return alt;
  const aScore = alt.candidates && alt.candidates[0] ? alt.candidates[0].score : 0;
  const pScore = found.candidates && found.candidates[0] ? found.candidates[0].score : 0;
  return aScore > pScore ? alt : found;
}

function assistantLooksLikeItemQuestion(text){
  const s = typeof assistantNormText === 'function' ? assistantNormText(text) : String(text || '').trim().toLowerCase();
  if(!s)return false;
  if(/\b(?:remind me|don't forget|dont forget|create |new (?:task|habit)|add:?)\b/.test(s))return false;
  if(typeof assistantLooksLikeEdit === 'function' && assistantLooksLikeEdit(s)
    && !/\b(?:when|did i|do i have|why |last time|history|stats)\b/.test(s))return false;
  return /\b(?:when(?:'s| is| am i| should i| do i| did i| will i)|where(?:'s| is)|did i (?:do|finish)|do i have|last time|how often|why (?:isn'?t|is not|wasn'?t)|on (?:my |the )?(?:plan|agenda|list))\b/.test(s);
}

function assistantRowClock(row){
  const start = row && (row.start || row.placeStart || row.begin);
  if(!Number.isFinite(start))return '';
  const minutes = new Date(start).getHours() * 60 + new Date(start).getMinutes();
  return typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(minutes) : assistantClockLabel(minutes);
}

function assistantTodayBrief(data, settings, now){
  const ts = now != null ? Number(now) : Date.now();
  const today = typeof dayStart === 'function' ? dayStart(ts) : ts;
  const seen = new Set();
  const open = [];
  const done = [];
  const overdue = [];
  const week = (typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek)
    || (typeof cachedHomeAgenda === 'function' ? cachedHomeAgenda(data) : null);
  const day0 = week && Array.isArray(week.days) ? week.days[0] : null;
  const timeline = day0 && Array.isArray(day0.timeline) ? day0.timeline : [];
  for(const row of timeline){
    if(!row || row.kind === 'travel' || row.kind === 'block' || row.kind === 'busy')continue;
    const habit = row.h || (data && row.i != null ? data[row.i] : null);
    const name = String((habit && habit.name) || row.name || '').trim();
    if(!name)continue;
    const clock = assistantRowClock(row);
    const isDone = habit && typeof completedToday === 'function' ? completedToday(habit, ts) : Boolean(row.done);
    const item = {name:name.slice(0,40), clock, hid:habit && habit.hid};
    if(isDone)done.push(item);
    else open.push(item);
    if(habit && habit.hid)seen.add(habit.hid);
    if(open.length + done.length >= 12)break;
  }
  for(const habit of Array.isArray(data) ? data : []){
    if(!habit || seen.has(habit.hid))continue;
    const name = String(habit.name || '').slice(0,40);
    if(!name)continue;
    if(typeof completedToday === 'function' && completedToday(habit, ts)){
      if(done.length < 8)done.push({name, clock:'', hid:habit.hid});
      continue;
    }
    if(habit.type === 'task' && habit.dueDate != null){
      const due = typeof dayStart === 'function' ? dayStart(habit.dueDate) : habit.dueDate;
      const isDone = typeof isTaskDone === 'function' ? isTaskDone(habit) : false;
      if(isDone)continue;
      if(due < today && overdue.length < 6)overdue.push({name, clock:''});
      else if(due === today && open.length < 12)open.push({name, clock:''});
    }
  }
  const next = open.find(item => item.clock) || open[0] || null;
  const lines = open.map(item => item.clock ? `${item.clock} ${item.name}` : item.name);
  return {open, done, overdue, next, lines};
}

function assistantCatalog(data, settings, now){
  const locs = Array.isArray(settings && settings.locations) ? settings.locations : [];
  const profiles = Array.isArray(settings && settings.weatherProfiles) ? settings.weatherProfiles : [];
  const habits = Array.isArray(data) ? data : [];
  const ts = now != null ? Number(now) : Date.now();
  const today = assistantTodayBrief(data, settings, now);
  const iso = typeof dateKey === 'function'
    ? dateKey(ts)
    : new Date(ts).toISOString().slice(0, 10);
  return {
    date:{
      iso,
      weekday:ASSISTANT_WEEKDAY_LABELS[new Date(ts).getDay()] || null
    },
    today:{
      next:today.next,
      open:today.open,
      done:today.done.slice(0, 6),
      overdue:today.overdue
    },
    habits:habits.slice(0,24).map(h => ({
      name:String(h && h.name || '').slice(0,40),
      type:h && h.type === 'task' ? 'task' : 'habit',
      hid:h && h.hid ? String(h.hid) : undefined
    })),
    // Every saved place. A capped list hides later names, so the model invents
    // a duplicate and never applies the one the user already saved.
    places:locs.map(loc => ({
      id:String(loc && loc.id || ''),
      name:String(loc && loc.name || '').slice(0,40)
    })).filter(item => item.id && item.name),
    weather:profiles.slice(0,4).map(profile => {
      const row = {
        id:String(profile && profile.id || ''),
        name:String(profile && profile.name || '').slice(0,32)
      };
      const chips = typeof assistantWeatherRulesSummary === 'function'
        ? assistantWeatherRulesSummary(profile && profile.rules).slice(0, 6)
        : [];
      if(chips.length)row.rules = chips;
      return row;
    }).filter(item => item.id && item.name),
    topics:(Array.isArray(settings && settings.topics) ? settings.topics : []).slice(0, 12).map(topic => String(topic || '').slice(0, 32)).filter(Boolean),
    anchors:ASSISTANT_ANCHORS.slice(),
    aliases:'sunset=maghrib, dawn=fajr, noon=dhuhr'
  };
}

function assistantBuildContext(now){
  const data = typeof load === 'function' ? load() : [];
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (sortSettings || {});
  return {
    now:now != null ? Number(now) : Date.now(),
    data,
    settings,
    catalog:assistantCatalog(data, settings, now)
  };
}

function assistantEmptyDraft(){
  return {
    kind:null,
    habitKind:null,
    name:'',
    emoji:null,
    emojiBgColor:null,
    durationMinutes:null,
    priority:null,
    topics:null,
    dueDate:null,
    dueTime:null,
    hardDue:null,
    planByDate:null,
    timesPerPeriod:null,
    periodDays:null,
    allowedWeekdays:null,
    allowedMonthDays:null,
    preferredWeekdays:null,
    preferredMonthDays:null,
    window:null,
    preferredWindow:null,
    weather:null,
    places:null,
    locationPrefs:null,
    earlyWindowDays:null,
    delayAllowanceDays:null,
    breakable:null,
    minChunkMinutes:null,
    autoMarkMinutes:undefined,
    trackValue:null,
    pinned:null,
    snoozedUntil:undefined,
    showOnSharedDisplay:null,
    allowSharedDisplayCompletion:null,
    showWeather:null,
    showWeatherAtLocation:null,
    weatherLocationId:null,
    weatherLocationName:null,
    scheduleLinks:null,
    scheduleOptions:null,
    links:null
  };
}

function assistantApplyWindow(draft, args, role){
  const start = assistantNormalizeEndpoint(args && args.start);
  if(start.error)return {ok:false, error:start.error};
  const end = assistantNormalizeEndpoint(args && args.end);
  if(end.error)return {ok:false, error:end.error};
  const key = role === 'preferred' ? 'preferredWindow' : 'window';
  draft[key] = {start, end};
  return {ok:true, draft};
}

function assistantApplyWeather(draft, args, catalog){
  const mode = args && args.mode;
  if(mode !== 'none' && mode !== 'inherit' && mode !== 'profile'){
    return {ok:false, error:'weather mode must be none, inherit, or profile'};
  }
  if(mode !== 'profile'){
    draft.weather = {mode, profileId:null, name:null};
    draft.weatherNeedAsk = null;
    draft.weatherProposed = null;
    return {ok:true, draft};
  }
  const names = (catalog && catalog.weather) || [];
  if(!names.length)return {ok:false, error:'NO_WEATHER_PROFILES', ask:'No weather profiles are saved. Open Settings -> weather guidance, or say "no weather".'};
  const match = assistantMatchByName(names, args.profile);
  if(!match.ok){
    if(match.error === 'AMBIGUOUS'){
      return {ok:false, error:'AMBIGUOUS_WEATHER', ask:`Which weather profile: ${match.matches.map(item => item.name).join(', ')}?`};
    }
    return {ok:false, error:'UNKNOWN_WEATHER', ask:`Use one of: ${names.map(item => item.name).join(', ')}, inherit, or none.`};
  }
  draft.weather = {mode:'profile', profileId:match.item.id, name:match.item.name};
  draft.weatherNeedAsk = null;
  return {ok:true, draft};
}

function assistantWeatherRulesFromHints(hints){
  const rules = [];
  if(!hints)return rules;
  if(hints.notRaining){
    rules.push({metric:'precipitation_probability', min:null, max:20, hard:true, relative:'none'});
  }
  if(hints.notSnowing){
    rules.push({metric:'snowfall', min:null, max:0.1, hard:true, relative:'none'});
  }
  if(hints.notFreezing){
    rules.push({metric:'temperature_2m', min:1, max:null, hard:true, relative:'none'});
  }
  if(hints.notWindy){
    rules.push({metric:'wind_speed_10m', min:null, max:20, hard:false, relative:'low'});
  }
  return typeof normalizeWeatherRule === 'function' ? rules.map(normalizeWeatherRule) : rules;
}

function assistantMergeWeatherRules(base, extra){
  const out = (Array.isArray(base) ? base : []).map(rule => Object.assign({}, rule));
  for(const rule of extra || []){
    if(!rule || !rule.metric)continue;
    const i = out.findIndex(row => row && row.metric === rule.metric);
    if(i < 0){
      out.push(Object.assign({metric:rule.metric, min:null, max:null, hard:false, relative:'none'}, rule));
      continue;
    }
    const next = Object.assign({}, out[i]);
    if(rule.min != null)next.min = rule.min;
    if(rule.max != null)next.max = rule.max;
    if(rule.relative === 'high' || rule.relative === 'low')next.relative = rule.relative;
    else if(rule.relativeExplicit)next.relative = rule.relative === 'high' || rule.relative === 'low' ? rule.relative : 'none';
    if(rule.min != null || rule.max != null){
      if(typeof rule.hard === 'boolean')next.hard = rule.hard;
    }else if(rule.hard === true){
      next.hard = true;
    }
    out[i] = next;
  }
  return typeof normalizeWeatherRule === 'function'
    ? out.slice(0, 8).map(normalizeWeatherRule)
    : out.slice(0, 8);
}

function assistantWeatherProfilesList(settings){
  return typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(settings && settings.weatherProfiles)
    : ((settings && settings.weatherProfiles) || []);
}

function assistantFindWeatherProfile(name, id, settings, catalog){
  const profiles = assistantWeatherProfilesList(settings);
  if(id){
    const byId = profiles.find(profile => profile && profile.id === id);
    if(byId)return byId;
  }
  const wanted = String(name || '').trim();
  if(wanted && typeof assistantMatchByName === 'function'){
    const match = assistantMatchByName(profiles, wanted);
    if(match && match.ok)return match.item;
    const cat = assistantMatchByName((catalog && catalog.weather) || [], wanted);
    if(cat && cat.ok && cat.item){
      const structured = Array.isArray(cat.item.rules) && cat.item.rules[0] && cat.item.rules[0].metric;
      return profiles.find(profile => profile && profile.id === cat.item.id)
        || profiles.find(profile => assistantNormText(profile && profile.name) === assistantNormText(cat.item.name))
        || (structured ? cat.item : null);
    }
  }
  return null;
}

function assistantDraftWeatherRules(draft, settings){
  if(draft && draft.weatherProposed && Array.isArray(draft.weatherProposed.rules) && draft.weatherProposed.rules.length){
    return draft.weatherProposed.rules;
  }
  const current = settings || (typeof loadSortSettings === 'function' ? loadSortSettings() : null);
  const found = assistantFindWeatherProfile(
    draft && draft.name,
    draft && (draft.settingId || (draft.weather && draft.weather.profileId)),
    current
  );
  return (found && found.rules) || [];
}

function assistantJoinWeatherText(weatherText, requestText){
  const a = String(weatherText || '').trim();
  const b = String(requestText || '').trim();
  if(!a)return b;
  if(!b)return a;
  const na = typeof assistantNormText === 'function' ? assistantNormText(a) : a.toLowerCase();
  const nb = typeof assistantNormText === 'function' ? assistantNormText(b) : b.toLowerCase();
  if(na === nb || nb.indexOf(na) >= 0)return b;
  if(na.indexOf(nb) >= 0)return a;
  return a + '\n' + b;
}

function assistantHintWeatherName(hints, fallback){
  if(fallback)return fallback;
  if(!hints)return 'Outdoor';
  if(hints.notRaining && hints.notFreezing)return 'Outdoor';
  if(hints.notFreezing)return 'Above freezing';
  if(hints.notWindy && hints.notRaining)return 'Outdoor';
  if(hints.notWindy)return 'Calm';
  return 'Dry';
}

function assistantWeatherCapAsk(profiles){
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  return {
    question:`You already have ${cap} weather profiles. Use one of: ${profiles.map(item => item.name).join(', ')}, or say "no weather".`,
    choices:profiles.map(item => item.name).concat(['no weather'])
  };
}

function assistantProposeWeather(draft, opts, catalog, settings){
  if(!draft)return draft;
  const nameWanted = String(opts && opts.name || '').trim();
  const text = String(opts && opts.text || '').trim();
  const parsed = typeof assistantParseWeatherRulesFromText === 'function'
    ? assistantParseWeatherRulesFromText(text || nameWanted)
    : {hints:typeof assistantParseWeatherHints === 'function' ? assistantParseWeatherHints(text || nameWanted) : null, rules:[], mentioned:false};
  const hints = (opts && opts.hints) || parsed.hints || {};
  const patchRules = assistantMergeWeatherRules(parsed.rules, assistantWeatherRulesFromHints(hints));
  const nameLooksLikeRules = nameWanted && typeof assistantParseWeatherHints === 'function'
    && assistantParseWeatherHints(nameWanted).mentioned
    && !text;
  const profileName = nameLooksLikeRules ? '' : nameWanted;
  const profiles = assistantWeatherProfilesList(settings);
  const existing = assistantFindWeatherProfile(
    profileName || (draft.kind === 'weather' ? draft.name : ''),
    draft.settingId || (draft.weather && draft.weather.profileId),
    settings,
    catalog
  );
  if(existing && draft.kind !== 'weather'){
    if(patchRules.length){
      const rules = assistantMergeWeatherRules(existing.rules || [], patchRules);
      draft.weatherProposed = {name:existing.name, rules, hints};
      draft.weather = {mode:'profile', profileId:existing.id, name:existing.name};
      draft.weatherNeedAsk = null;
      draft.settingId = existing.id;
      return draft;
    }
    draft.weather = {mode:'profile', profileId:existing.id, name:existing.name};
    draft.weatherNeedAsk = null;
    draft.weatherProposed = null;
    return draft;
  }
  if(hints && hints.mentioned && draft.kind !== 'weather'){
    const cover = profiles.find(profile => assistantProfileCoversHints(profile, hints));
    if(cover){
      draft.weather = {mode:'profile', profileId:cover.id, name:cover.name};
      draft.weatherProposed = null;
      draft.weatherNeedAsk = null;
      return draft;
    }
  }
  if(!patchRules.length && !profileName && !(hints && hints.mentioned) && draft.kind !== 'weather')return draft;
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  if(!existing && profiles.length >= cap && draft.kind !== 'weather'){
    draft.weatherNeedAsk = assistantWeatherCapAsk(profiles);
    return draft;
  }
  let baseRules = [];
  if(draft.weatherProposed && Array.isArray(draft.weatherProposed.rules) && draft.weatherProposed.rules.length){
    baseRules = draft.weatherProposed.rules;
  }else if(existing){
    baseRules = existing.rules || [];
  }
  const rules = assistantMergeWeatherRules(baseRules, patchRules);
  const name = assistantUniqueWeatherName(
    profileName || (draft.weatherProposed && draft.weatherProposed.name) || assistantHintWeatherName(hints, draft.kind === 'weather' ? draft.name : ''),
    existing ? profiles.filter(profile => profile.id !== existing.id) : profiles
  );
  draft.weatherProposed = {name, rules, hints};
  draft.weather = {mode:'profile', profileId:existing ? existing.id : null, name, pending:!existing};
  draft.weatherNeedAsk = null;
  if(existing)draft.settingId = existing.id;
  return draft;
}

function assistantAttachParsedWeather(draft, parsed, catalog, settings){
  if(!draft)return draft;
  const text = parsed && (parsed.weatherText || parsed.text) || '';
  const parsedRules = typeof assistantParseWeatherRulesFromText === 'function'
    ? assistantParseWeatherRulesFromText(text)
    : null;
  const mentioned = Boolean(parsed && parsed.weather)
    || Boolean(parsed && parsed.weatherHints && parsed.weatherHints.mentioned)
    || Boolean(parsedRules && parsedRules.mentioned);
  if(draft.weather && draft.kind !== 'weather' && !mentioned){
    return draft;
  }
  if(parsed && parsed.weather){
    const applied = assistantApplyWeather(draft, {mode:'profile', profile:parsed.weather}, catalog);
    if(applied && applied.ok && draft.weather && draft.weather.profileId)return draft;
  }
  const had = draft.weather;
  if(draft.kind !== 'weather')draft.weather = null;
  assistantProposeWeather(draft, {
    name:parsed && parsed.weather || '',
    text,
    hints:parsed && parsed.weatherHints || (parsedRules && parsedRules.hints)
  }, catalog, settings);
  if(!draft.weather)draft.weather = had;
  return draft;
}

function assistantPersistSettings(patch){
  const current = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const next = Object.assign({}, current, patch);
  if(typeof saveSortSettings === 'function')saveSortSettings(next);
  if(typeof sortSettings !== 'undefined' && sortSettings){
    Object.keys(patch || {}).forEach(key => { sortSettings[key] = next[key]; });
  }
  if(typeof bumpPlannerDataRevision === 'function'
    && (patch.weatherProfiles || patch.locations || patch.blockedTimes)){
    bumpPlannerDataRevision();
  }
  if(patch.weatherProfiles && typeof renderWeatherControls === 'function')renderWeatherControls();
  if(patch.locations && typeof renderLocationControls === 'function')renderLocationControls();
  if(patch.blockedTimes && typeof renderBlockedTimeControls === 'function')renderBlockedTimeControls();
  if(patch.topics && typeof renderTopicList === 'function')renderTopicList();
  return next;
}

function assistantMaterializeWeatherProfile(draft, settings){
  if(!draft || !draft.weatherProposed)return null;
  const current = settings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  let profiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(current.weatherProfiles)
    : ((current.weatherProfiles || []).slice());
  const proposed = draft.weatherProposed;
  const nameWanted = String((proposed && proposed.name) || draft.name || 'Outdoor').trim().slice(0, 32) || 'Outdoor';
  const existingId = draft.settingId || (draft.weather && draft.weather.profileId) || null;
  if(existingId){
    const i = profiles.findIndex(profile => profile && profile.id === existingId);
    if(i >= 0){
      profiles[i] = {
        ...profiles[i],
        name:nameWanted,
        rules:assistantMergeWeatherRules(profiles[i].rules, proposed.rules)
      };
      assistantPersistSettings({weatherProfiles:profiles});
      return {id:profiles[i].id, name:profiles[i].name};
    }
  }
  if(draft.kind !== 'weather' && proposed.hints && proposed.hints.mentioned){
    const cover = profiles.find(profile => assistantProfileCoversHints(profile, proposed.hints));
    if(cover)return {id:cover.id, name:cover.name};
  }
  const byName = profiles.find(profile => assistantNormText(profile && profile.name) === assistantNormText(nameWanted));
  if(byName){
    if(proposed.rules && proposed.rules.length){
      byName.rules = assistantMergeWeatherRules(byName.rules, proposed.rules);
      assistantPersistSettings({weatherProfiles:profiles});
    }
    return {id:byName.id, name:byName.name};
  }
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  if(profiles.length >= cap)return null;
  const id = `weather-${Date.now().toString(36)}`;
  const name = assistantUniqueWeatherName(nameWanted, profiles);
  const rules = assistantMergeWeatherRules([], proposed.rules);
  profiles = profiles.concat([{id, name, rules}]);
  assistantPersistSettings({weatherProfiles:profiles});
  return {id, name};
}

function assistantEnsureProposedWeather(draft, settings){
  if(!draft || !draft.weatherProposed)return draft;
  const updatingAttached = draft.kind !== 'weather'
    && draft.weather
    && draft.weather.profileId
    && Array.isArray(draft.weatherProposed.rules)
    && draft.weatherProposed.rules.length;
  if(draft.weather && draft.weather.profileId && draft.kind !== 'weather' && !updatingAttached)return draft;
  const made = assistantMaterializeWeatherProfile(draft, settings);
  if(!made)return draft;
  draft.weather = {mode:'profile', profileId:made.id, name:made.name};
  draft.settingId = made.id;
  draft.weatherProposed = draft.kind === 'weather' ? draft.weatherProposed : null;
  return draft;
}

function assistantProfileCoversHints(profile, hints){
  if(!hints || !hints.mentioned)return false;
  const rules = (profile && profile.rules) || [];
  const hasMax = metric => rules.some(rule => rule && rule.metric === metric && (rule.max != null || rule.relative === 'low'));
  const hasMin = (metrics, floor) => rules.some(rule => rule && metrics.includes(rule.metric) && rule.min != null && rule.min >= floor);
  if(hints.notRaining && !hasMax('precipitation_probability') && !hasMax('precipitation'))return false;
  if(hints.notSnowing && !hasMax('snowfall') && !hints.notRaining)return false;
  if(hints.notFreezing && !hasMin(['temperature_2m','apparent_temperature'], 0))return false;
  if(hints.notWindy && !hasMax('wind_speed_10m') && !hasMax('wind_gusts_10m'))return false;
  return true;
}

function assistantUniqueWeatherName(wanted, profiles){
  const used = new Set((profiles || []).map(item => assistantNormText(item && item.name)));
  const base = String(wanted || 'Outdoor').trim().slice(0, 32) || 'Outdoor';
  if(!used.has(assistantNormText(base)))return base;
  for(let i = 2; i <= 6; i += 1){
    const next = `${base} ${i}`.slice(0, 32);
    if(!used.has(assistantNormText(next)))return next;
  }
  return `Outdoor ${Date.now().toString(36)}`.slice(0, 32);
}

function assistantPlaceAsk(error, places, matches){
  const names = (places || []).map(item => item && item.name).filter(Boolean);
  if(error === 'AMBIGUOUS'){
    const labels = (matches || []).map(item => item && item.name).filter(Boolean);
    return {ok:false, error:'AMBIGUOUS_PLACE', ask:`Which place: ${labels.join(', ')}?`, choices:labels};
  }
  if(error === 'NO_PLACES'){
    return {ok:false, error:'NO_PLACES', ask:'No saved places yet. Add one in Settings → locations, or drop the place.'};
  }
  return {ok:false, error:'UNKNOWN_PLACE', ask:`Use a saved place: ${names.join(', ')}.`, choices:names};
}

function assistantPlaceholderOrigin(settings){
  const locs = Array.isArray(settings && settings.locations) ? settings.locations : [];
  const pinned = locs.find(loc => loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng)));
  if(pinned)return {lat:Number(pinned.lat), lng:Number(pinned.lng)};
  if(Number.isFinite(Number(settings && settings.homeCityLat)) && Number.isFinite(Number(settings && settings.homeCityLng))){
    return {lat:Number(settings.homeCityLat), lng:Number(settings.homeCityLng)};
  }
  return {lat:43.0008, lng:-78.789};
}

function assistantPlaceholderCoords(settings, index){
  const origin = assistantPlaceholderOrigin(settings);
  const ang = ((Number(index) || 0) * 2.3) % (Math.PI * 2);
  return {
    lat:origin.lat + Math.cos(ang) * 0.0008,
    lng:origin.lng + Math.sin(ang) * 0.0008
  };
}

function assistantPlaceholderAddress(name){
  const label = String(name || 'Place').trim().slice(0, 48) || 'Place';
  return `${label} (placeholder — set the real address in Settings)`.slice(0, 120);
}

function assistantEnsurePlaceholderPlace(name, address, session, catalog, settings, requestText){
  const want = String(name || '').trim();
  if(!want)return null;
  const places = (catalog && catalog.places) || [];
  const existing = assistantMatchByName(places, want);
  if(existing.ok && existing.item)return existing.item;
  if(!session.pendingPlaces)session.pendingPlaces = [];
  const pending = session.pendingPlaces.find(item => assistantNormText(item && item.name) === assistantNormText(want));
  if(pending){
    if(!places.some(item => item && item.id === pending.id))places.push({id:pending.id, name:pending.name});
    catalog.places = places;
    return pending;
  }
  const coords = assistantPlaceholderCoords(settings, session.pendingPlaces.length);
  const id = `pending-loc-${session.pendingPlaces.length + 1}`;
  const given = String(address || '').trim().slice(0, 120);
  const loc = {
    kind:'location',
    name:typeof assistantTitleName === 'function' ? assistantTitleName(want, 48) : want.slice(0, 48),
    address:given
      ? (/placeholder/i.test(given) ? given : `${given} (placeholder)`.slice(0, 120))
      : assistantPlaceholderAddress(want),
    lat:coords.lat,
    lng:coords.lng,
    placeholder:true,
    id
  };
  session.pendingPlaces.push(loc);
  places.push({id, name:loc.name});
  catalog.places = places;
  return loc;
}

function assistantApplyPlace(draft, args, catalog, opts){
  const wanted = Array.isArray(args && args.names) ? args.names : [];
  const places = (catalog && catalog.places) || [];
  if(!wanted.length){
    draft.places = {ids:[], names:[], anywhere:args && args.anywhere !== false};
    return {ok:true, draft};
  }
  const allowPlaceholders = Boolean(opts && opts.placeholders);
  if(!places.length && !allowPlaceholders)return assistantPlaceAsk('NO_PLACES', places);
  const ids = [];
  const names = [];
  for(const ref of wanted){
    let match = assistantMatchByName(places, ref);
    if((!match.ok || !match.item || !match.item.id) && allowPlaceholders && match.error !== 'AMBIGUOUS'){
      const made = assistantEnsurePlaceholderPlace(
        ref,
        null,
        opts.session,
        catalog,
        opts.settings,
        opts.requestText
      );
      if(made)match = {ok:true, item:made};
    }
    if(!match.ok)return assistantPlaceAsk(match.error, catalog.places || places, match.matches);
    if(!match.item || !match.item.id)return assistantPlaceAsk('UNKNOWN', catalog.places || places);
    if(!ids.includes(match.item.id)){
      ids.push(match.item.id);
      names.push(match.item.name);
    }
  }
  draft.places = {ids, names, anywhere:Boolean(args && args.anywhere)};
  return {ok:true, draft};
}

function assistantMergeExtractedArgs(args, parsed){
  const out = Object.assign({}, args || {});
  if(!parsed)return out;
  if(!out.name && parsed.itemName && !(typeof assistantIsPronounName === 'function' && assistantIsPronounName(parsed.itemName))){
    out.name = parsed.itemName;
  }
  if((out.durationMinutes == null || out.durationMinutes === '') && parsed.durationMinutes != null){
    out.durationMinutes = parsed.durationMinutes;
  }
  if((out.priority == null || out.priority === '') && parsed.priority != null)out.priority = parsed.priority;
  if(!out.due && parsed.due && !(parsed.rhythm && parsed.rhythm.weekdays && parsed.rhythm.weekdays.length)){
    out.due = parsed.due;
  }
  if(!out.dueTime && parsed.dueTime)out.dueTime = parsed.dueTime;
  if(parsed.rhythm){
    if(out.timesPerPeriod == null || out.timesPerPeriod === '')out.timesPerPeriod = parsed.rhythm.timesPerPeriod;
    if(out.periodDays == null || out.periodDays === '')out.periodDays = parsed.rhythm.periodDays;
    if((out.weekdays == null || out.weekdays === '') && parsed.rhythm.weekdays){
      out.weekdays = parsed.rhythm.weekdays.slice();
    }else if(!parsed.rhythm.weekdays && out.weekdays == null){
      out.clearWeekdays = true;
    }
  }
  if(!out.window && !out.windowText && parsed.window)out.window = parsed.window;
  if((!out.placeNames || (Array.isArray(out.placeNames) && !out.placeNames.length)) && parsed.places && parsed.places.length){
    out.placeNames = parsed.places.slice();
  }
  if(!out.weatherProfile && parsed.weather)out.weatherProfile = parsed.weather;
  if(!out.weatherText && parsed.weatherHints && parsed.weatherHints.mentioned)out.weatherText = parsed.text;
  if(!out.kind){
    if(parsed.intent === 'create_habit' || parsed.rhythm)out.kind = 'habit';
    else if(parsed.intent === 'create_task')out.kind = 'task';
  }
  if(!out.newName && parsed.newName)out.newName = parsed.newName;
  if(!out.habitKind && parsed.habitKind)out.habitKind = parsed.habitKind;
  if((out.topics == null || out.topics === '') && parsed.topics)out.topics = parsed.topics;
  if(out.breakable == null && parsed.breakable != null)out.breakable = parsed.breakable;
  if(out.pinned == null && parsed.pinned != null)out.pinned = parsed.pinned;
  if(out.hardDue == null && parsed.hardDue != null)out.hardDue = parsed.hardDue;
  return out;
}

function assistantNormalizeDraftArgs(args, now){
  const out = Object.assign({}, args || {});
  ['placeNames','placePrefs','topics','weekdays'].forEach(key => {
    if(Array.isArray(out[key]) && !out[key].length)delete out[key];
  });
  if(typeof out.order === 'number')delete out.order;
  if((out.priority == null || out.priority === '') && out.order != null && typeof assistantParsePriority === 'function'){
    const orderText = typeof assistantNormText === 'function' ? assistantNormText(out.order) : String(out.order || '').trim().toLowerCase();
    if(/^(?:p[0-5]|urgent|asap|critical|someday|whenever|[0-5])$/.test(orderText)){
      out.priority = out.order;
      delete out.order;
    }
  }
  if(typeof out.hardDue === 'string' && typeof assistantParseDue === 'function'){
    const dueFromHard = assistantParseDue(out.hardDue, now);
    if(dueFromHard != null){
      if(out.due == null || out.due === '')out.due = out.hardDue;
      out.hardDue = true;
    }
  }
  if(out.weekdays != null && out.allowedWeekdays == null && typeof assistantNormalizeWeekdaysArg === 'function'){
    const days = assistantNormalizeWeekdaysArg(out.weekdays);
    if(days)out.allowedWeekdays = days;
  }else if(typeof out.allowedWeekdays === 'string' && typeof assistantNormalizeWeekdaysArg === 'function'){
    const days = assistantNormalizeWeekdaysArg(out.allowedWeekdays);
    if(days)out.allowedWeekdays = days;
  }
  if(typeof out.rhythm === 'string' && out.rhythm.trim() && typeof assistantParseRhythm === 'function'){
    const rhythm = assistantParseRhythm(out.rhythm);
    if(rhythm){
      if(out.timesPerPeriod == null || out.timesPerPeriod === '')out.timesPerPeriod = rhythm.timesPerPeriod;
      if(out.periodDays == null || out.periodDays === '')out.periodDays = rhythm.periodDays;
      if(out.allowedWeekdays == null && rhythm.weekdays)out.allowedWeekdays = rhythm.weekdays.slice();
      else if(out.allowedWeekdays == null && !rhythm.weekdays)out.clearWeekdays = true;
    }
  }
  if(out.timesPerPeriod != null && out.timesPerPeriod !== '' && typeof assistantParseCount === 'function'){
    const fromPhrase = typeof out.timesPerPeriod === 'string' && typeof assistantParseRhythm === 'function'
      ? assistantParseRhythm(out.timesPerPeriod)
      : null;
    if(fromPhrase){
      out.timesPerPeriod = fromPhrase.timesPerPeriod;
      if(out.periodDays == null || out.periodDays === '')out.periodDays = fromPhrase.periodDays;
      if(out.allowedWeekdays == null && fromPhrase.weekdays)out.allowedWeekdays = fromPhrase.weekdays.slice();
    }else{
      out.timesPerPeriod = assistantParseCount(out.timesPerPeriod, 1, 30);
    }
  }
  if(out.periodDays != null && out.periodDays !== '' && typeof assistantParseCount === 'function'){
    out.periodDays = assistantParseCount(out.periodDays, 1, 183);
  }
  const windowSource = typeof out.windowText === 'string' && out.windowText.trim()
    ? out.windowText
    : (typeof out.window === 'string' ? out.window : '');
  if(windowSource && typeof assistantParseWindowFromText === 'function'){
    const window = assistantParseWindowFromText(windowSource);
    if(window)out.window = window;
  }
  const preferredSource = typeof out.preferredWindowText === 'string' && out.preferredWindowText.trim()
    ? out.preferredWindowText
    : (typeof out.preferredWindow === 'string' ? out.preferredWindow : '');
  if(preferredSource && typeof assistantParseWindowFromText === 'function'){
    const preferred = assistantParseWindowFromText(preferredSource);
    if(preferred)out.preferredWindow = preferred;
  }
  if(typeof out.placeNames === 'string' && out.placeNames.trim()){
    out.placeNames = [out.placeNames.trim()];
  }
  if(typeof out.place === 'string' && out.place.trim()){
    out.placeNames = [out.place.trim()];
    out.place = undefined;
  }
  if(typeof out.weather === 'string' && out.weather.trim() && !out.weatherProfile){
    out.weatherProfile = out.weather;
    out.weather = undefined;
  }
  if(typeof out.weatherProfile === 'string' && typeof assistantParseWeatherHints === 'function'){
    const hints = assistantParseWeatherHints(out.weatherProfile);
    if(hints && hints.mentioned && !out.weatherText)out.weatherText = out.weatherProfile;
  }
  if(out.habitKind != null && typeof assistantParseHabitKind === 'function'){
    const kind = assistantParseHabitKind(out.habitKind);
    if(kind)out.habitKind = kind;
    else delete out.habitKind;
  }
  if(out.monthDays != null && typeof assistantParseMonthDays === 'function'){
    const days = assistantParseMonthDays(out.monthDays);
    if(days)out.allowedMonthDays = days;
  }
  if(out.preferredWeekdays != null && typeof assistantNormalizeWeekdaysArg === 'function'){
    const days = assistantNormalizeWeekdaysArg(out.preferredWeekdays);
    if(days != null)out.preferredWeekdays = days;
    else delete out.preferredWeekdays;
  }
  if(out.preferredMonthDays != null && typeof assistantParseMonthDays === 'function'){
    const days = assistantParseMonthDays(out.preferredMonthDays);
    if(days != null)out.preferredMonthDays = days;
    else delete out.preferredMonthDays;
  }
  if(out.topics != null && typeof assistantParseTopicsArg === 'function'){
    out.topics = assistantParseTopicsArg(out.topics);
  }
  if(out.emoji != null && typeof assistantParseEmoji === 'function'){
    out.emoji = assistantParseEmoji(out.emoji);
  }
  if(out.emojiColor != null && typeof assistantParseEmojiColor === 'function'){
    const color = assistantParseEmojiColor(out.emojiColor);
    if(color != null)out.emojiBgColor = color;
  }
  if(out.breakable != null && typeof assistantParseBreakable === 'function'){
    const parsed = assistantParseBreakable(out.breakable);
    if(parsed){
      out.breakable = parsed.breakable;
      if(parsed.minChunkMinutes != null && (out.minChunkMinutes == null || out.minChunkMinutes === '')){
        out.minChunkMinutes = parsed.minChunkMinutes;
      }
    }
  }
  if(out.minChunkMinutes != null && out.minChunkMinutes !== ''){
    const mins = typeof assistantParseDuration === 'function'
      ? assistantParseDuration(out.minChunkMinutes)
      : parseInt(out.minChunkMinutes, 10);
    if(Number.isFinite(mins)){
      out.minChunkMinutes = typeof clampMinChunk === 'function' ? clampMinChunk(mins) : mins;
    }
  }
  if(out.earlyDays != null && out.earlyWindowDays == null && typeof assistantParseFlexDays === 'function'){
    out.earlyWindowDays = assistantParseFlexDays(out.earlyDays);
  }
  if(out.delayDays != null && out.delayAllowanceDays == null && typeof assistantParseFlexDays === 'function'){
    out.delayAllowanceDays = assistantParseFlexDays(out.delayDays);
  }
  if(out.autoMarkMinutes !== undefined && typeof assistantParseAutoMark === 'function'){
    out.autoMarkMinutes = assistantParseAutoMark(out.autoMarkMinutes);
  }
  ['hardDue','trackValue','pinned','sharedDisplay','sharedComplete','showWeather','weatherAtPlace','anywhere'].forEach(key => {
    if(out[key] != null && typeof assistantParseBool === 'function'){
      const parsed = assistantParseBool(out[key]);
      if(parsed != null)out[key] = parsed;
    }
  });
  if(out.snooze !== undefined && typeof assistantParseSnoozeUntil === 'function'){
    out.snoozedUntil = assistantParseSnoozeUntil(out.snooze, now);
  }
  if(out.links != null && typeof assistantParseLinksArg === 'function'){
    out.links = assistantParseLinksArg(out.links);
  }
  if(out.placePrefs != null && typeof assistantParsePlacePrefsText === 'function'){
    out.placePrefList = assistantParsePlacePrefsText(out.placePrefs);
  }
  if(out.planBy != null && out.planBy !== ''){
    const plan = assistantParseDue(out.planBy, now);
    if(plan != null)out.planByDate = plan;
  }
  if(typeof out.newName === 'string' && out.newName.trim()){
    out.newName = out.newName.trim().slice(0, ASSISTANT_NAME_MAX);
  }
  return out;
}

function assistantResolveDraftBase(args, session, context){
  let current = session && session.draft && session.draft.name ? session.draft : null;
  if(current && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(current.kind)
    && !(args && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(args.kind))){
    current = null;
  }
  const spoken = String(args && args.name || '').trim();
  const want = spoken;
  if(current && (!want || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(want))
    || (typeof assistantNamesMatch === 'function' && assistantNamesMatch(want, current.name)))){
    return {ok:true, draft:{...current}, existing:Boolean(current.hid || current.index != null)};
  }
  if(want && !(typeof assistantIsPronounName === 'function' && assistantIsPronounName(want))){
    const spoken = session && session.parsed && session.parsed.text;
    const foundRaw = typeof assistantFindHabitSmart === 'function'
      ? assistantFindHabitSmart(context && context.data, want, spoken)
      : (typeof assistantFindHabit === 'function' ? assistantFindHabit(context && context.data, want) : {ok:false});
    const foundName = foundRaw && (foundRaw.name || (foundRaw.habit && foundRaw.habit.name));
    const titleMatch = foundRaw && foundRaw.ok && foundName && (typeof assistantNamesMatch === 'function'
      ? assistantNamesMatch(want, foundName)
      : (typeof assistantNormText === 'function'
        ? assistantNormText(want) === assistantNormText(foundName)
        : String(want).toLowerCase() === String(foundName).toLowerCase()));
    const found = (foundRaw && foundRaw.ok && !titleMatch)
      ? {ok:false, error:'UNKNOWN', candidates:foundRaw.candidates || []}
      : foundRaw;
    if(found && found.ok && titleMatch){
      const draft = typeof assistantHabitToDraft === 'function'
        ? assistantHabitToDraft(found.habit, found.index, context && context.settings, context && context.data)
        : assistantEmptyDraft();
      return {ok:true, draft, existing:true};
    }
    const creating = !(current && (current.hid || current.index != null));
    const packedName = typeof assistantNameLooksLikeSettingsDump === 'function'
      && assistantNameLooksLikeSettingsDump(want);
    // A packed "name is the whole request" dump is a new item, not a failed
    // lookup of the focused row.
    if(packedName){
      return {ok:true, draft:assistantEmptyDraft(), existing:false};
    }
    if(!creating)return found;
    const close = (found && found.candidates || []).filter(row => Number(row.score) >= 40);
    if(found && found.error === 'AMBIGUOUS' && close.length){
      return assistantHabitAskFromCandidates(close, 'AMBIGUOUS');
    }
  }
  if(current)return {ok:true, draft:{...current}, existing:Boolean(current.hid || current.index != null)};
  return {ok:true, draft:assistantEmptyDraft(), existing:false};
}

function assistantResolveOrderLink(name, data, mods){
  const found = assistantFindHabit(data, name);
  if(!found || !found.ok)return found;
  return {
    ok:true,
    link:{
      name:found.name,
      anchorHid:found.hid,
      direction:mods.direction,
      adjacency:mods.adjacency || 'sometime',
      requireSameDay:Boolean(mods.requireSameDay)
    }
  };
}

function assistantMergeScheduleLink(draft, link){
  const list = Array.isArray(draft.scheduleLinks) ? draft.scheduleLinks.slice() : [];
  const key = `${link.direction}:${link.anchorHid}`;
  const next = list.filter(item => `${item.direction}:${item.anchorHid}` !== key);
  next.push(link);
  draft.scheduleLinks = next;
}

function assistantApplyExtraDraftFields(next, raw, catalog, data){
  if(raw.newName)next.name = raw.newName;
  if(raw.habitKind === 'keepup' || raw.habitKind === 'reduce' || raw.habitKind === 'zero')next.habitKind = raw.habitKind;
  if(raw.emoji != null)next.emoji = raw.emoji;
  if(raw.emojiBgColor != null)next.emojiBgColor = raw.emojiBgColor;
  if(Array.isArray(raw.topics))next.topics = raw.topics;
  if(Array.isArray(raw.allowedMonthDays))next.allowedMonthDays = raw.allowedMonthDays;
  if(Array.isArray(raw.preferredWeekdays))next.preferredWeekdays = raw.preferredWeekdays;
  if(Array.isArray(raw.preferredMonthDays))next.preferredMonthDays = raw.preferredMonthDays;
  if(raw.preferredWindow && typeof raw.preferredWindow === 'object' && !Array.isArray(raw.preferredWindow)){
    const applied = assistantApplyWindow(next, raw.preferredWindow, 'preferred');
    if(applied.ok)Object.assign(next, applied.draft);
  }
  if(raw.earlyWindowDays != null)next.earlyWindowDays = raw.earlyWindowDays;
  if(raw.delayAllowanceDays != null)next.delayAllowanceDays = raw.delayAllowanceDays;
  if(typeof raw.hardDue === 'boolean'){
    next.hardDue = raw.hardDue;
    if(raw.hardDue)next.delayAllowanceDays = 0;
    else if(next.delayAllowanceDays == null || next.delayAllowanceDays === 0)next.delayAllowanceDays = 1;
  }
  if(typeof raw.breakable === 'boolean')next.breakable = raw.breakable;
  if(raw.minChunkMinutes != null)next.minChunkMinutes = raw.minChunkMinutes;
  if(raw.autoMarkMinutes !== undefined)next.autoMarkMinutes = raw.autoMarkMinutes;
  if(typeof raw.trackValue === 'boolean')next.trackValue = raw.trackValue;
  if(typeof raw.pinned === 'boolean')next.pinned = raw.pinned;
  if(raw.snoozedUntil !== undefined)next.snoozedUntil = raw.snoozedUntil;
  if(typeof raw.sharedDisplay === 'boolean')next.showOnSharedDisplay = raw.sharedDisplay;
  if(typeof raw.sharedComplete === 'boolean')next.allowSharedDisplayCompletion = raw.sharedComplete;
  if(typeof raw.showWeather === 'boolean')next.showWeather = raw.showWeather;
  if(typeof raw.weatherAtPlace === 'boolean')next.showWeatherAtLocation = raw.weatherAtPlace;
  if(typeof raw.anywhere === 'boolean'){
    if(next.places)next.places.anywhere = raw.anywhere;
    else{
      next.places = {ids:[], names:[], anywhere:raw.anywhere};
    }
  }
  if(raw.weatherPlace != null){
    const want = String(raw.weatherPlace).trim();
    if(!want || /^(none|off|clear)$/i.test(want)){
      next.weatherLocationId = null;
      next.weatherLocationName = null;
    }else{
      const match = assistantMatchByName((catalog && catalog.places) || [], want);
      if(!match.ok){
        if(match.error === 'AMBIGUOUS'){
          return {ok:false, error:'AMBIGUOUS_PLACE', ask:`Which forecast place: ${match.matches.map(item => item.name).join(', ')}?`};
        }
        return {ok:false, error:'UNKNOWN_PLACE', ask:`Use a saved place: ${((catalog && catalog.places) || []).map(item => item.name).join(', ')}.`};
      }
      next.weatherLocationId = match.item.id;
      next.weatherLocationName = match.item.name;
    }
  }
  if(raw.planByDate != null)next.planByDate = raw.planByDate;
  if(Array.isArray(raw.links))next.links = raw.links;
  if(Array.isArray(raw.placePrefList)){
    if(!raw.placePrefList.length)next.locationPrefs = {};
    else{
      const prefs = Object.assign({}, next.locationPrefs || {});
      const ids = (next.places && next.places.ids) ? next.places.ids.slice() : [];
      const names = (next.places && next.places.names) ? next.places.names.slice() : [];
      for(const row of raw.placePrefList){
        const match = assistantMatchByName((catalog && catalog.places) || [], row.name);
        if(!match.ok){
          if(match.error === 'AMBIGUOUS'){
            return {ok:false, error:'AMBIGUOUS_PLACE', ask:`Which place: ${match.matches.map(item => item.name).join(', ')}?`};
          }
          return {ok:false, error:'UNKNOWN_PLACE', ask:`Use a saved place: ${((catalog && catalog.places) || []).map(item => item.name).join(', ')}.`};
        }
        prefs[match.item.id] = row.level;
        if(!ids.includes(match.item.id)){
          ids.push(match.item.id);
          names.push(match.item.name);
        }
      }
      next.locationPrefs = prefs;
      next.places = {ids, names, anywhere:next.places ? Boolean(next.places.anywhere) : false};
    }
  }
  const mods = typeof assistantParseOrderText === 'function' && raw.order
    ? assistantParseOrderText(raw.order)
    : null;
  if(mods && mods.clear)next.scheduleLinks = [];
  const orderMods = (mods && mods.modifiers) || (mods && mods.links && mods.links[0])
    || (typeof assistantParseOrderModifiers === 'function' ? assistantParseOrderModifiers(raw.order || '') : {adjacency:'sometime', requireSameDay:false});
  if(mods && mods.links){
    for(const row of mods.links){
      const resolved = assistantResolveOrderLink(row.name, data, row);
      if(!resolved || !resolved.ok)return resolved && resolved.ok === false ? resolved : {ok:false, error:'UNKNOWN', ask:resolved && resolved.ask};
      assistantMergeScheduleLink(next, resolved.link);
    }
  }
  if(raw.after != null){
    if(!String(raw.after).trim() || /^(none|off|clear)$/i.test(String(raw.after).trim())){
      next.scheduleLinks = (next.scheduleLinks || []).filter(link => link.direction !== 'after');
    }else{
      const resolved = assistantResolveOrderLink(raw.after, data, {
        direction:'after',
        adjacency:orderMods.adjacency || 'sometime',
        requireSameDay:Boolean(orderMods.requireSameDay)
      });
      if(!resolved || !resolved.ok)return resolved && resolved.ok === false ? resolved : {ok:false, error:'UNKNOWN'};
      assistantMergeScheduleLink(next, resolved.link);
    }
  }
  if(raw.before != null){
    if(!String(raw.before).trim() || /^(none|off|clear)$/i.test(String(raw.before).trim())){
      next.scheduleLinks = (next.scheduleLinks || []).filter(link => link.direction !== 'before');
    }else{
      const resolved = assistantResolveOrderLink(raw.before, data, {
        direction:'before',
        adjacency:orderMods.adjacency || 'sometime',
        requireSameDay:Boolean(orderMods.requireSameDay)
      });
      if(!resolved || !resolved.ok)return resolved && resolved.ok === false ? resolved : {ok:false, error:'UNKNOWN'};
      assistantMergeScheduleLink(next, resolved.link);
    }
  }
  if(raw.option != null){
    const values = Array.isArray(raw.option) ? raw.option : [raw.option];
    const existing = Array.isArray(next.scheduleOptions) ? next.scheduleOptions.slice() : [];
    let options = Array.isArray(raw.option) ? [] : existing;
    let parsedAny = false;
    for(const value of values){
      const parsed = typeof assistantParseScheduleOptionText === 'function'
        ? assistantParseScheduleOptionText(value, catalog)
        : null;
      if(parsed && parsed.clear){
        options = [];
        parsedAny = true;
        break;
      }
      if(parsed && parsed.option){
        options.push(parsed.option);
        parsedAny = true;
      }
    }
    if(parsedAny){
      next.scheduleOptions = typeof normalizeHabitScheduleOptions === 'function'
        ? normalizeHabitScheduleOptions(options)
        : options;
    }
  }
  return {ok:true, draft:next};
}

function assistantApplyDraftItem(args, draft, catalog, now, settings, data, requestText, opts){
  const salvaged = (opts && opts.skipSalvage)
    ? (args || {})
    : (typeof assistantSalvageDraftArgs === 'function'
      ? assistantSalvageDraftArgs(args, requestText)
      : args);
  const raw = assistantNormalizeDraftArgs(salvaged, now);
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(raw.kind)){
    return assistantApplyDraftSetting(raw, draft, catalog, now, settings, requestText);
  }
  if(typeof assistantIsSettingKind === 'function' && draft && assistantIsSettingKind(draft.kind)
    && !assistantIsItemKind(raw.kind)){
    return assistantApplyDraftSetting(Object.assign({kind:draft.kind}, raw), draft, catalog, now, settings, requestText);
  }
  const seed = draft && draft.name ? draft : assistantEmptyDraft();
  const spokenName = String(raw && raw.name || '').trim().slice(0, ASSISTANT_NAME_MAX);
  const settingFollow = typeof assistantLooksLikeSettingFollowup === 'function'
    && assistantLooksLikeSettingFollowup(requestText);
  const same = seed.name && (!spokenName
    || settingFollow
    || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(spokenName))
    || (typeof assistantNamesMatch === 'function' ? assistantNamesMatch(spokenName, seed.name)
      : assistantNormText(seed.name) === assistantNormText(spokenName)));
  const next = same ? {...seed} : assistantEmptyDraft();
  if(same){
    next.hid = seed.hid;
    next.index = seed.index;
  }
  const hasRhythm = raw.timesPerPeriod != null || raw.periodDays != null || raw.rhythm
    || raw.weekdays != null || raw.allowedWeekdays != null || raw.clearWeekdays;
  let kind = raw.kind === 'habit' ? 'habit' : (raw.kind === 'task' ? 'task' : (same ? next.kind : null));
  if(!kind && hasRhythm)kind = 'habit';
  if(!kind && same && next.kind)kind = next.kind;
  if(same && seed.kind && settingFollow)kind = seed.kind;
  if(!kind)kind = 'task';
  let name = (same && next.name)
    ? next.name
    : spokenName;
  if(!name)return {ok:false, error:'name is required'};
  if(!same && typeof assistantNameLooksLikeSettingsDump === 'function' && assistantNameLooksLikeSettingsDump(spokenName || name)
    && typeof assistantShortTitleFromDump === 'function'){
    const short = assistantShortTitleFromDump(spokenName || name);
    if(short)name = short.slice(0, ASSISTANT_NAME_MAX);
  }
  next.kind = kind;
  next.name = name;
  if(raw.durationMinutes != null && raw.durationMinutes !== ''){
    const mins = typeof assistantParseDuration === 'function'
      ? assistantParseDuration(raw.durationMinutes)
      : parseInt(raw.durationMinutes, 10);
    if(!Number.isFinite(mins) || mins < 1)return {ok:false, error:'durationMinutes must be a positive number'};
    next.durationMinutes = typeof clampDuration === 'function' ? clampDuration(mins) : mins;
  }
  if(raw.priority != null && raw.priority !== ''){
    const pri = typeof assistantParsePriority === 'function'
      ? assistantParsePriority(raw.priority)
      : (typeof clampPriority === 'function' ? clampPriority(raw.priority) : parseInt(raw.priority, 10));
    if(pri == null || !Number.isFinite(pri))return {ok:false, error:'priority must be 0-5, urgent, or someday'};
    next.priority = pri;
  }
  if(kind === 'task'){
    if(raw.due != null && raw.due !== ''){
      const due = assistantParseDue(raw.due, now);
      if(due == null)return {ok:false, error:'due must be today, tomorrow, a weekday, or YYYY-MM-DD'};
      next.dueDate = due;
    }
    if(raw.dueTime != null && raw.dueTime !== ''){
      const dueMins = assistantParseClock(raw.dueTime);
      if(dueMins == null)return {ok:false, error:'dueTime must be HH:MM or 7pm'};
      next.dueTime = assistantClockLabel(dueMins);
    }
  }else{
    if(raw.timesPerPeriod != null)next.timesPerPeriod = raw.timesPerPeriod;
    if(raw.periodDays != null)next.periodDays = raw.periodDays;
    if(hasRhythm && next.timesPerPeriod == null){
      const days = Array.isArray(raw.allowedWeekdays) ? raw.allowedWeekdays : [];
      const weekend = days.length === 2 && days[0] === 0 && days[1] === 6;
      next.timesPerPeriod = weekend ? 1 : (days.length || 1);
    }
    if(hasRhythm && next.periodDays == null)next.periodDays = 7;
    if(raw.allowedWeekdays != null){
      next.allowedWeekdays = typeof normalizeAllowedWeekdays === 'function'
        ? normalizeAllowedWeekdays(raw.allowedWeekdays)
        : raw.allowedWeekdays.slice();
    }else if(raw.clearWeekdays){
      next.allowedWeekdays = [];
    }else if(kind === 'habit' && raw.due != null && raw.due !== '' && next.allowedWeekdays == null){
      const fromDue = typeof assistantNormalizeWeekdaysArg === 'function'
        ? assistantNormalizeWeekdaysArg(raw.due)
        : null;
      if(fromDue && fromDue.length){
        next.allowedWeekdays = fromDue;
        if(next.timesPerPeriod == null)next.timesPerPeriod = fromDue.length;
        if(next.periodDays == null)next.periodDays = 7;
      }
    }
  }
  if(raw.window && typeof raw.window === 'object' && !Array.isArray(raw.window)){
    const applied = assistantApplyWindow(next, raw.window);
    if(!applied.ok)return applied;
    Object.assign(next, applied.draft);
  }
  const weatherSource = String(raw.weatherText || '').trim()
    || (raw.weatherHints && raw.weatherHints.mentioned ? String(requestText || '') : '');
  if(!raw.weatherProfile && weatherSource && !(raw.weather && typeof raw.weather === 'object')){
    const exact = ((catalog && catalog.weather) || []).find(item => (
      assistantNormText(item && item.name) === assistantNormText(weatherSource)
    ));
    if(exact)raw.weatherProfile = exact.name;
  }
  if(raw.weather && typeof raw.weather === 'object'){
    const applied = assistantApplyWeather(next, raw.weather, catalog);
    if(!applied.ok){
      if(applied.error === 'NO_WEATHER_PROFILES' || applied.error === 'UNKNOWN_WEATHER'){
        assistantProposeWeather(next, {
          name:raw.weather.profile || raw.weather.name || '',
          text:weatherSource || raw.weather.profile || ''
        }, catalog, settings);
      }else return applied;
    }
  }else if(raw.weatherProfile){
    const rawProfile = String(raw.weatherProfile || '').trim();
    const rawProfileKey = rawProfile.toLowerCase();
    if(rawProfileKey === 'none' || rawProfileKey === 'inherit'){
      const applied = assistantApplyWeather(next, {mode:rawProfileKey}, catalog);
      if(!applied.ok)return applied;
    }else{
      const asHints = typeof assistantParseWeatherHints === 'function'
        ? assistantParseWeatherHints(rawProfile)
        : null;
      if(asHints && asHints.mentioned && !raw.weatherText){
        assistantProposeWeather(next, {text:rawProfile, hints:asHints}, catalog, settings);
      }else{
        const applied = assistantApplyWeather(next, {mode:'profile', profile:rawProfile}, catalog);
        if(!applied.ok){
          assistantProposeWeather(next, {name:rawProfile, text:weatherSource}, catalog, settings);
        }
      }
    }
  }
  if(weatherSource && (!next.weather || next.weather.pending)){
    assistantAttachParsedWeather(next, {
      weatherText:weatherSource,
      weatherHints:raw.weatherHints || (typeof assistantParseWeatherHints === 'function'
        ? assistantParseWeatherHints(weatherSource)
        : null)
    }, catalog, settings);
  }else if(weatherSource && next.weather && next.weather.profileId){
    const parsedRules = typeof assistantParseWeatherRulesFromText === 'function'
      ? assistantParseWeatherRulesFromText(weatherSource)
      : null;
    if(parsedRules && parsedRules.mentioned){
      assistantProposeWeather(next, {
        name:next.weather.name || '',
        text:weatherSource,
        hints:raw.weatherHints || parsedRules.hints
      }, catalog, settings);
    }
  }
  const extra = assistantApplyExtraDraftFields(next, raw, catalog, data);
  if(!extra.ok)return extra;
  if(next.window){
    const resolved = assistantResolveWindowHabits(next.window, data);
    if(!resolved.ok)return resolved;
    next.window = resolved.window;
  }
  if(next.preferredWindow){
    const resolved = assistantResolveWindowHabits(next.preferredWindow, data);
    if(!resolved.ok)return resolved;
    next.preferredWindow = resolved.window;
  }
  const placeArgs = raw.place && typeof raw.place === 'object' && !Array.isArray(raw.place)
    ? raw.place
    : (Array.isArray(raw.placeNames) && raw.placeNames.length ? {names:raw.placeNames, anywhere:raw.anywhere} : null);
  if(placeArgs){
    const applied = assistantApplyPlace(next, placeArgs, catalog, opts && opts.placeholders
      ? {placeholders:true, session:opts.session, settings:opts.settings || settings, requestText}
      : null);
    if(!applied.ok){
      if(next.name && applied.ask){
        return {ok:true, draft:next, ask:applied.ask, error:applied.error, choices:applied.choices || null};
      }
      return applied;
    }
  }
  if(opts && opts.placeholders && next.durationMinutes == null){
    const derived = assistantDurationFromClockWindow(next.window);
    if(derived)next.durationMinutes = derived;
  }
  if(raw.needAsk && raw.ask)return {ok:true, draft:next, ask:String(raw.ask).trim(), choices:null};
  return {ok:true, draft:next};
}

function assistantDurationFromClockWindow(window){
  if(!window || typeof window !== 'object')return null;
  const start = window.start && window.start.kind === 'clock' ? Number(window.start.minutes) : NaN;
  const end = window.end && window.end.kind === 'clock' ? Number(window.end.minutes) : NaN;
  if(!Number.isFinite(start) || !Number.isFinite(end))return null;
  let span = end - start;
  if(span <= 0)span += 1440;
  if(span < 5 || span > 12 * 60)return null;
  return span;
}

function assistantValidateClassify(args){
  const intent = String(args && args.intent || '').trim();
  if(!ASSISTANT_INTENTS.includes(intent)){
    return {ok:false, error:`intent must be one of ${ASSISTANT_INTENTS.join(', ')}`};
  }
  return {ok:true, intent, reason:String(args && args.reason || '')};
}

function assistantCompletePreview(found, options){
  const opts = typeof options === 'number' ? {minutes:options} : (options || {});
  const action = assistantNormText(opts.action) === 'undo_today' ? 'undo_today' : 'log';
  const minutes = opts.minutes != null ? assistantParseDuration(opts.minutes) : null;
  const valueNum = opts.value === null || opts.value === undefined || opts.value === '' ? null : Number(opts.value);
  const value = Number.isFinite(valueNum) ? valueNum : null;
  const note = String(opts.note || '').trim().slice(0, typeof MAX_NOTE_CHARS === 'number' ? MAX_NOTE_CHARS : 200);
  const logs = found.habit && typeof normalizeLogs === 'function' ? normalizeLogs(found.habit.logs) : [];
  const todayKey = typeof dateKey === 'function' ? dateKey(Date.now()) : '';
  const todayActual = logs.filter(log => !(typeof isPlanLog === 'function' && isPlanLog(log))
    && (!todayKey || (typeof dateKey === 'function' && dateKey(logTime(log)) === todayKey)));
  if(action === 'undo_today'){
    const target = todayActual[todayActual.length - 1];
    if(!target)return {ok:true, noChange:true, text:`${found.name} has no completion to undo today.`};
    return {
      ok:true,
      pendingComplete:{
        action:'undo_today',
        index:found.index,
        hid:found.hid,
        name:found.name,
        targetTs:typeof logTime === 'function' ? logTime(target) : Number(target && target.ts || target)
      },
      alreadyDone:false,
      summary:`Mark ${found.name} not done by removing its latest completion from today?`
    };
  }
  if(opts.minutes != null && opts.minutes !== '' && minutes == null){
    return {ok:false, error:'minutes must be a duration such as 20 or "20 minutes"'};
  }
  if(opts.value !== null && opts.value !== undefined && opts.value !== '' && value === null){
    return {ok:false, error:'value must be a number'};
  }
  const done = found.habit && typeof completedToday === 'function' && completedToday(found.habit);
  const detail = [minutes && `${minutes}m`, value !== null && `value ${value}`, note && `“${note}”`].filter(Boolean).join(' · ');
  return {
    ok:true,
    pendingComplete:{
      action:'log',
      index:found.index,
      hid:found.hid,
      name:found.name,
      minutes:minutes && minutes > 0 ? minutes : null,
      value,
      note:note || null
    },
    // A chunk/value/note is an intentional additional entry even when the
    // rhythm has already met today's target.
    alreadyDone:Boolean(done && !detail),
    summary:done && !detail
      ? `${found.name} is already logged today.`
      : `Log ${found.name}${detail ? ` · ${detail}` : ' as done'}?`
  };
}

function assistantLookupSummaryText(found, context){
  const habit = found.habit;
  const name = found.name;
  const today = (context.catalog && context.catalog.today) || {};
  const onOpen = (today.open || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  const onDone = (today.done || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  const overdue = (today.overdue || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  let state = '';
  if(onDone)state = `${name} is already done${onDone.clock ? ` (it was at ${onDone.clock})` : ' today'}.`;
  else if(onOpen)state = onOpen.clock ? `${name} is on today at ${onOpen.clock}.` : `${name} is on today.`;
  else if(overdue)state = `${name} is overdue.`;
  if(habit && habit.type === 'task'){
    if(!state && typeof isTaskDone === 'function' && isTaskDone(habit))state = `${name} is already done.`;
    if(!state && habit.dueDate != null){
      const key = typeof dateKey === 'function' ? dateKey(habit.dueDate) : '';
      state = key ? `${name} is a task due ${key}.` : `${name} is a task.`;
    }
    if(!state)state = `${name} is a task.`;
  }else if(!state){
    state = `${name} is on your list, but not on today's plan.`;
  }
  const now = context.now != null ? Number(context.now) : Date.now();
  const todayBase = assistantDayBase(now);
  const occurrenceLabel = (ts, timed) => {
    const base = assistantDayBase(ts);
    const delta = Math.round((base - todayBase) / 86400000);
    const day = delta === 0 ? 'today'
      : delta === 1 ? 'tomorrow'
        : new Date(base).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
    if(!timed)return day;
    const mins = new Date(ts).getHours() * 60 + new Date(ts).getMinutes();
    const clock = typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(mins) : new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    return `${day} at ${clock}`;
  };
  let nextText = '';
  try{
    const week = assistantQueryWeek(context.data, context.settings);
    const rows = [];
    for(const day of week && week.days || []){
      for(const row of (day && day.timeline) || []){
        if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled'))continue;
        const source = row.h || (context.data && row.i != null ? context.data[row.i] : null);
        if(!source)continue;
        if(found.hid ? source.hid !== found.hid : assistantNormText(source.name) !== assistantNormText(name))continue;
        if(Number(row.end) <= now)continue;
        rows.push(row);
      }
    }
    rows.sort((a,b) => a.start - b.start);
    if(rows.length){
      nextText = ` Next planned: ${occurrenceLabel(rows[0].start, true)}.`;
    }else{
      const plans = (typeof normalizeLogs === 'function' ? normalizeLogs(habit && habit.logs) : [])
        .filter(log => typeof isPlanLog === 'function' && isPlanLog(log) && logTime(log) >= todayBase)
        .sort((a,b) => logTime(a) - logTime(b));
      if(plans.length){
        const first = plans[0];
        nextText = ` Next planned: ${occurrenceLabel(logTime(first), typeof planTimed === 'function' && planTimed(first))}.`;
      }else if(habit && habit.type === 'task' && habit.eventTime && habit.eventTime >= now){
        nextText = ` Next scheduled: ${occurrenceLabel(habit.eventTime, true)}.`;
      }else if(habit && habit.type === 'task' && habit.dueDate != null && assistantDayBase(habit.dueDate) >= todayBase
        && !(typeof isTaskDone === 'function' && isTaskDone(habit))){
        nextText = ` Next due: ${occurrenceLabel(habit.dueDate, false)}.`;
      }else if(habit && habit.planByDate != null && assistantDayBase(habit.planByDate) >= todayBase){
        nextText = ` Next plan-by date: ${occurrenceLabel(habit.planByDate, false)}.`;
      }else if(!(habit && habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(habit))){
        nextText = ' No occurrence is currently placed in the next seven days.';
      }
    }
  }catch(_){}
  let lastText = '';
  try{
    const logs = (typeof normalizeLogs === 'function' ? normalizeLogs(habit && habit.logs) : [])
      .filter(log => !(typeof isPlanLog === 'function' && isPlanLog(log)) && logTime(log) <= now);
    if(logs.length){
      const ts = logTime(logs[logs.length - 1]);
      const when = assistantDayBase(ts) === todayBase
        ? 'today'
        : new Date(ts).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'});
      lastText = ` Last completed: ${when}.`;
    }else{
      lastText = ' No completion has been logged yet.';
    }
  }catch(_){}
  let details = '';
  try{
    const draft = typeof assistantHabitToDraft === 'function'
      ? assistantHabitToDraft(habit, found.index, context.settings, context.data)
      : null;
    const summary = draft && typeof assistantDraftSummary === 'function'
      ? assistantDraftSummary(draft, context.settings)
      : '';
    if(summary){
      const bits = summary.split(' · ').slice(1);
      if(bits.length)details = ` Settings: ${bits.join(' · ')}.`;
    }
  }catch(_){}
  return state + nextText + lastText + details;
}

function assistantLookupHistoryText(found){
  const logs = typeof normalizeLogs === 'function' ? normalizeLogs(found.habit && found.habit.logs) : [];
  const actual = logs.filter(log => !(typeof isPlanLog === 'function' && isPlanLog(log))
    && (typeof logTime !== 'function' || logTime(log) <= Date.now()));
  if(!actual.length)return `${found.name} has no completion history yet.`;
  const recent = actual.slice(-8).reverse().map(log => {
    const ts = typeof logTime === 'function' ? logTime(log) : Number(log && log.ts || log);
    const when = new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    const bits = [when];
    const minutes = typeof logMinutes === 'function' ? logMinutes(log) : null;
    const value = typeof logValue === 'function' ? logValue(log) : null;
    const note = typeof logNote === 'function' ? logNote(log) : '';
    if(minutes)bits.push(`${minutes}m`);
    if(value !== null)bits.push(`value ${value}`);
    if(note)bits.push(note);
    return bits.join(' · ');
  });
  return `${found.name} has ${actual.length} completion${actual.length === 1 ? '' : 's'}. Recent: ${recent.join('; ')}.`;
}

function assistantLookupStatsText(found){
  const h = found.habit || {};
  const actual = typeof actualLogs === 'function' ? actualLogs(h.logs) : [];
  if(h.type === 'task'){
    const done = typeof isTaskDone === 'function' && isTaskDone(h);
    const due = h.dueDate != null && typeof dateKey === 'function' ? ` Due ${dateKey(h.dueDate)}.` : '';
    return `${found.name} is ${done ? 'done' : 'open'}.${due} ${actual.length} completion ${actual.length === 1 ? 'entry' : 'entries'} total.`.replace(/\s+/g,' ').trim();
  }
  const bits = [`${actual.length} total ${actual.length === 1 ? 'entry' : 'entries'}`];
  if(typeof recentWindowStats === 'function'){
    const recent = recentWindowStats(h,30);
    bits.push(h.type === 'keepup' ? `${recent.good}/${recent.expected} on pace in the last 30 days` : `${recent.count} in the last 30 days`);
  }
  if(typeof currentRun === 'function'){
    const run = currentRun(h);
    if(run && Number.isFinite(Number(run.num)))bits.push(`${run.num} ${run.label || (h.type === 'keepup' ? 'streak' : 'current run')}`);
  }
  if(typeof progressScore === 'function'){
    const score = progressScore(h);
    if(score != null)bits.push(`${score}% progress score`);
  }
  if(typeof daysSince === 'function'){
    const gap = daysSince(h.lastLog);
    if(gap != null)bits.push(`${Math.max(0,gap)} day${Math.abs(gap) === 1 ? '' : 's'} since last`);
  }
  return `${found.name}: ${bits.join(' · ')}.`;
}

function assistantLookupWhyText(found, context, dateValue){
  const date = assistantQueryDay(dateValue, context.now);
  if(dateValue != null && String(dateValue).trim() && !date){
    return 'I can explain planner choices for a day in the next seven days.';
  }
  const dayBase = date ? date.dayBase : assistantDayBase(context.now);
  const dayLabel = date ? date.label : 'today';
  const week = assistantQueryWeek(context.data, context.settings);
  const day = week && (week.days || []).find(row => row.dayBase === dayBase);
  const placed = assistantQueryDayRows(day, context.data).filter(row => assistantNormText(row.name) === assistantNormText(found.name));
  if(placed.length){
    return `${found.name} is planned ${dayLabel} at ${placed.map(row => row.clock).filter(Boolean).join(' and ') || 'a flexible time'}. The planner fit it around fixed time, travel, priorities, windows, and other eligible work.`;
  }
  if(found.habit && found.habit.snoozedUntil && found.habit.snoozedUntil > context.now){
    return `${found.name} is not planned ${dayLabel} because it is snoozed until ${new Date(found.habit.snoozedUntil).toLocaleString()}.`;
  }
  if(found.habit && found.habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(found.habit)){
    return `${found.name} is not planned ${dayLabel} because the task is already done.`;
  }
  try{
    if(typeof buildDayCapacityScorecard === 'function'){
      const report = buildDayCapacityScorecard(context.data, context.settings, dayBase, context.now, {weekMode:true, weekSnapshot:week});
      const trace = (report && report.plannerTrace || []).find(row => row && (row.i === found.index || assistantNormText(row.name) === assistantNormText(found.name)));
      if(trace){
        const reason = trace.decision || (trace.status === 'unplaced' ? 'it did not fit the final plan' : 'the planner selected that slot');
        const constraints = (trace.inputs || []).filter(bit => /allowed|priority|duration|weather|order|location|planned for/i.test(bit)).slice(0, 3);
        return `${found.name} is ${trace.status} ${dayLabel}: ${reason}.${constraints.length ? ` Relevant inputs: ${constraints.join(' · ')}.` : ''}`;
      }
    }
  }catch(_){}
  return `${found.name} is not on ${dayLabel}'s plan. It may be off-rhythm, outside its allowed day/window, already satisfied, lower priority than work that fit, or unable to fit the remaining gaps.`;
}

function assistantLookupQueryFromText(text, args){
  const explicit = assistantNormText(args && args.query);
  if(explicit === 'history' || explicit === 'stats' || explicit === 'why' || explicit === 'summary')return explicit;
  // Intent belongs to the model. The tool only validates the explicit query
  // and defaults safely when the model omitted it.
  return 'summary';
}

function assistantLookupText(found, context, args, spoken){
  const query = assistantLookupQueryFromText(spoken, args);
  if(query === 'history')return assistantLookupHistoryText(found);
  if(query === 'stats')return assistantLookupStatsText(found);
  if(query === 'why')return assistantLookupWhyText(found, context, args && args.date);
  return assistantLookupSummaryText(found, context);
}

function assistantDeletePreview(found){
  return {
    ok:true,
    pendingDelete:{index:found.index, hid:found.hid, name:found.name},
    summary:`Remove ${found.name}? This deletes the item and its history.`
  };
}

function assistantPlanPreview(found, args, context){
  const action = assistantNormText(args && args.action) === 'remove' ? 'remove' : 'add';
  if(found.habit && found.habit.type === 'zero'){
    return {ok:false, error:'Stop habits cannot be planned; they only record lapses.'};
  }
  if(found.habit && found.habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(found.habit)){
    return {ok:false, error:`${found.name} is already done.`};
  }
  const parsed = typeof assistantParseDue === 'function' ? assistantParseDue(args && args.date, context.now) : null;
  if(parsed == null)return {ok:false, error:'date is required'};
  const dayBase = assistantDayBase(parsed);
  const todayBase = assistantDayBase(context.now);
  if(dayBase < todayBase)return {ok:false, error:'Plans can only be added or removed for today or a future day.'};
  const key = typeof dateKey === 'function' ? dateKey(dayBase) : '';
  if(!key)return {ok:false, error:'invalid plan date'};
  let timeMin = null;
  const timeText = String(args && args.time || '').trim();
  if(timeText){
    timeMin = typeof assistantParseClock === 'function' ? assistantParseClock(timeText) : null;
    if(timeMin == null)return {ok:false, error:'time must look like 3pm or 15:00'};
  }
  let locationId = null;
  let placeName = '';
  const placeText = String(args && args.place || '').trim();
  if(placeText && action === 'add'){
    const match = assistantMatchByName((context.catalog && context.catalog.places) || [], placeText);
    if(!match.ok)return assistantPlaceAsk(match.error, (context.catalog && context.catalog.places) || [], match.matches);
    locationId = match.item.id;
    placeName = match.item.name;
  }
  const existing = (typeof normalizeLogs === 'function' ? normalizeLogs(found.habit && found.habit.logs) : [])
    .filter(log => typeof isPlanLog === 'function' && isPlanLog(log)
      && typeof dateKey === 'function' && dateKey(logTime(log)) === key);
  if(action === 'remove' && !existing.length){
    return {ok:true, noChange:true, text:`${found.name} has no one-day plan on ${key}.`};
  }
  const clock = timeMin == null ? '' : (typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(timeMin) : timeText);
  const pendingPlan = {
    action,index:found.index,hid:found.hid,name:found.name,key,dayBase,timeMin,locationId,placeName,
    replacing:existing.length
  };
  const summary = action === 'remove'
    ? `Remove ${found.name}'s one-day plan on ${key}?`
    : `${existing.length ? 'Replace' : 'Plan'} ${found.name} on ${key}${clock ? ` at ${clock}` : ''}${placeName ? ` at ${placeName}` : ''}?`;
  return {ok:true, pendingPlan, summary};
}

function assistantCollectItemRows(context){
  const now = context && context.now != null ? Number(context.now) : Date.now();
  const todayBase = assistantDayBase(now);
  return (Array.isArray(context && context.data) ? context.data : []).map((habit, index) => {
    if(!habit || !habit.name)return null;
    const type = habit.type === 'task' ? 'task' : 'habit';
    const done = type === 'task'
      ? (typeof isTaskDone === 'function' && isTaskDone(habit))
      : (typeof completedToday === 'function' && completedToday(habit, now));
    const taskOverdue = type === 'task' && !done && habit.dueDate != null && assistantDayBase(habit.dueDate) < todayBase;
    const haystack = assistantNormText([habit.name].concat(habit.topics || []).join(' '));
    const facts = assistantHabitQueryFacts(habit, {done:Boolean(done), overdue:Boolean(taskOverdue)}, context, index);
    const overdue = facts ? Number(facts.overdueDays) > 0 : taskOverdue;
    return Object.assign({haystack, index}, facts || {name:String(habit.name), type, done:Boolean(done), index}, {overdue:Boolean(overdue)});
  }).filter(Boolean);
}

function assistantFilterCollectedRows(rows, spec){
  const kind = ['task','habit'].includes(assistantNormText(spec && spec.kind))
    ? assistantNormText(spec.kind)
    : 'all';
  const status = ['open','done','overdue'].includes(assistantNormText(spec && spec.status))
    ? assistantNormText(spec.status)
    : 'all';
  const search = assistantNormText(spec && spec.search);
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if(kind !== 'all' && row.type !== kind)return false;
    if(status === 'done' && !row.done)return false;
    if(status === 'open' && row.done)return false;
    if(status === 'overdue' && !(row.overdue || row.status === 'overdue' || Number(row.overdueDays) > 0))return false;
    if(search && !String(row.haystack || '').includes(search))return false;
    return true;
  });
}

function assistantAnswerItems(args, context){
  const query = assistantNormText(args && args.query);
  const kind = ['task','habit'].includes(assistantNormText(args && args.kind))
    ? assistantNormText(args.kind)
    : 'all';
  const status = ['open','done','overdue'].includes(assistantNormText(args && args.status))
    ? assistantNormText(args.status)
    : 'all';
  const search = assistantNormText(args && args.search);
  const rows = assistantFilterCollectedRows(assistantCollectItemRows(context), args);

  if(query === 'progress'){
    const today = context.catalog && context.catalog.today || {};
    const done = (today.done || []).length;
    const open = (today.open || []).length;
    const overdue = (today.overdue || []).length;
    if(!done && !open && !overdue)return {ok:true, text:'Nothing is planned or overdue today.'};
    const parts = [`${done} done today`, `${open} still open`];
    if(overdue)parts.push(`${overdue} overdue`);
    const next = today.next && today.next.name
      ? ` Next: ${today.next.clock ? `${today.next.clock} ` : ''}${today.next.name}.`
      : '';
    return {ok:true, text:`Today: ${parts.join(' · ')}.${next}`};
  }
  if(query !== 'list')return {ok:true, text:'I can list tasks or habits by open, done, or overdue status, or summarize today’s progress.'};
  const label = status === 'all' ? (kind === 'all' ? 'items' : `${kind}s`) : `${status} ${kind === 'all' ? 'items' : `${kind}s`}`;
  const baseItems = rows.map(row => {
    const copy = Object.assign({}, row);
    delete copy.haystack;
    delete copy.index;
    return copy;
  });
  const queried = assistantApplyItemQuery(baseItems, args || {}, kind === 'all' ? 'item' : kind);
  if(queried.ok)return queried;
  if(!queried.rows.length)return {ok:true, text:`No ${label}${search ? ` match “${String(args.search).trim()}”` : ''} match the query.`, items:[]};
  const more = queried.total > queried.rows.length ? `, and ${queried.total - queried.rows.length} more` : '';
  const countLabel = queried.total === 1
    ? label.replace(/items$/, 'item').replace(/habits$/, 'habit').replace(/tasks$/, 'task')
    : label;
  return {ok:true, items:queried.rows, text:`${queried.total} matching ${countLabel}: ${queried.rows.map(row => row.name).join(', ')}${more}.`};
}

function assistantAnswerSettings(args, context){
  const kind = assistantNormText(args && args.kind);
  const settings = context.settings || {};
  let rows = [];
  let label = '';
  if(kind === 'places'){
    label = 'saved places';
    rows = (settings.locations || []).map(row => row && row.name).filter(Boolean);
  }else if(kind === 'weather'){
    label = 'weather profiles';
    rows = (settings.weatherProfiles || []).map(row => {
      if(!row || !row.name)return null;
      const rules = typeof assistantWeatherRulesSummary === 'function' ? assistantWeatherRulesSummary(row.rules).slice(0, 3) : [];
      return rules.length ? `${row.name} (${rules.join(', ')})` : row.name;
    }).filter(Boolean);
  }else if(kind === 'topics'){
    label = 'topics';
    rows = (settings.topics || []).map(String).filter(Boolean);
  }else if(kind === 'busy'){
    label = 'busy times';
    const blocks = typeof normalizeBlockedTimes === 'function' ? normalizeBlockedTimes(settings.blockedTimes) : (settings.blockedTimes || []);
    rows = blocks.map(row => row && row.label).filter(Boolean);
  }else{
    return {ok:false, error:'kind must be places, weather, topics, or busy'};
  }
  if(!rows.length)return {ok:true, text:`You have no ${label} yet.`};
  const shown = kind === 'places' ? rows : rows.slice(0, 20);
  const more = rows.length - shown.length;
  return {ok:true, text:`Your ${label}: ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`};
}

// ── Query tools (answer_weather / answer_schedule) ───────────────────────
// Read-only answers computed with the same primitives the UI uses: the
// free-time panel (computeDayFreeGaps), the make-room checker core
// (computeFreeWindowVerdict), and the weather sheet data (weatherDaySummary,
// weatherPeriodSummary, weatherFitAssessment). The model only picks the
// query and fills day/window/name — the numbers below are never guessed.

function assistantQueryCapabilities(){
  return 'I can check how much time is open on a day, which day is freest, whether a time block would make you miss something, what you missed (the same list as the missed pill on today), the agenda for a day or the week, the weather for the next seven days, which hour matches weather conditions, a comparison of two times, and whether the weather suits an item.';
}

function assistantPriorityFacts(habit){
  const rank = typeof clampPriority === 'function'
    ? clampPriority(habit && habit.priority)
    : Number(habit && habit.priority);
  const n = Number.isFinite(rank) ? rank : 2;
  const labels = typeof PRIORITY_LABELS !== 'undefined' ? PRIORITY_LABELS : ['P0','P1','P2','P3','P4','P5'];
  return {priority:labels[n] || ('P' + n), priorityRank:n};
}

function assistantFrequencyFacts(habit){
  if(!habit || habit.type === 'task')return {frequency:'once', timesPerWeek:0};
  const parts = typeof rhythmParts === 'function' ? rhythmParts(habit.target) : null;
  const times = parts && parts.times || 1;
  const days = parts && parts.days || 7;
  const timesPerWeek = days ? Math.round((times / days) * 70) / 10 : 0;
  let frequency = `${times}× / ${days}d`;
  if(days === 1 && times === 1)frequency = 'daily';
  else if(days === 7)frequency = `${times}× / week`;
  return {frequency, timesPerWeek};
}

function assistantHabitOverdueFacts(habit, now = Date.now()){
  if(!habit)return {overdueDays:0, dueInDays:null, daysSinceLast:null};
  const todayBase = assistantDayBase(now);
  const dayDiff = ts => ts == null ? null : Math.round((assistantDayBase(ts) - todayBase) / 86400000);
  const last = habit.lastLog != null ? habit.lastLog : null;
  const daysSinceLast = last == null ? null : Math.max(0, -dayDiff(last));
  if(habit.type === 'task'){
    const when = typeof taskWhen === 'function' ? taskWhen(habit) : (habit.eventTime != null ? habit.eventTime : habit.dueDate);
    const dueInDays = dayDiff(when);
    return {overdueDays:dueInDays == null ? 0 : Math.max(0, -dueInDays), dueInDays, daysSinceLast};
  }
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(habit) : habit.planByDate;
  if(planBy != null){
    const dueInDays = dayDiff(planBy);
    return {overdueDays:dueInDays == null ? 0 : Math.max(0, -dueInDays), dueInDays, daysSinceLast};
  }
  // Match the product cue: a never-completed rhythm is "ready for first
  // entry", not N days overdue merely because it was created long ago.
  const age = last == null ? null : Math.max(0, -dayDiff(last));
  const target = Math.max(1, Math.ceil(Number(typeof effectiveTarget === 'function' ? effectiveTarget(habit) : habit.target) || 7));
  const dueInDays = age == null ? null : target - age;
  return {overdueDays:dueInDays == null ? 0 : Math.max(0, -dueInDays), dueInDays, daysSinceLast};
}

function assistantHabitQueryFacts(habit, extra, context, index){
  if(!habit)return null;
  const pri = assistantPriorityFacts(habit);
  const freq = assistantFrequencyFacts(habit);
  const now = context && context.now != null ? Number(context.now) : Date.now();
  const due = assistantHabitOverdueFacts(habit, now);
  const settings = context && context.settings || (typeof loadSortSettings === 'function' ? loadSortSettings() : null);
  const done = habit.type === 'task'
    ? Boolean(typeof isTaskDone === 'function' && isTaskDone(habit))
    : Boolean(typeof completedToday === 'function' && completedToday(habit, now));
  const snoozed = Boolean(habit.snoozedUntil && habit.snoozedUntil > now);
  const status = snoozed ? 'snoozed' : done ? 'done' : due.overdueDays > 0 ? 'overdue' : due.dueInDays === 0 ? 'due' : 'open';
  let urgency = null;
  try{
    if(typeof attentionScore === 'function')urgency = Math.round(attentionScore(habit, Number.isInteger(index) ? index : 0, settings) * 10) / 10;
  }catch(_){}
  const locations = settings && Array.isArray(settings.locations) ? settings.locations : [];
  const places = (habit.locationIds || []).map(id => {
    const found = locations.find(row => row && row.id === id);
    return found && found.name;
  }).filter(Boolean);
  const profiles = settings && Array.isArray(settings.weatherProfiles) ? settings.weatherProfiles : [];
  const profile = profiles.find(row => row && row.id === habit.weatherProfileId);
  const facts = {
    name:String(habit.name || '').slice(0, 48),
    hid:habit.hid || undefined,
    type:habit.type === 'task' ? 'task' : 'habit',
    priority:pri.priority,
    priorityRank:pri.priorityRank,
    pinned:Boolean(habit.pinned),
    breakable:Boolean(habit.breakable),
    completedToday:done,
    status,
    durationMinutes:Number.isFinite(Number(habit.durationMinutes)) ? Number(habit.durationMinutes) : null,
    frequency:freq.frequency,
    timesPerWeek:freq.timesPerWeek,
    topics:Array.isArray(habit.topics) ? habit.topics.slice(0, 8) : [],
    places:places.slice(0, 8),
    weatherProfile:profile && profile.name || null,
    urgency,
    overdueDays:due.overdueDays,
    dueInDays:due.dueInDays,
    daysSinceLast:due.daysSinceLast
  };
  if(extra)Object.assign(facts, extra);
  return facts;
}

function assistantTodayAgendaHids(data, week, now){
  const todayBase = typeof dayStart === 'function' ? dayStart(now) : assistantDayBase(now);
  const days = week && Array.isArray(week.days) ? week.days : [];
  const day = days.find(item => item && (item.isToday || item.dayBase === todayBase)) || null;
  const rows = (day && (day.homeDisplayedTimeline || day.timeline)) || [];
  const hids = [];
  const seen = new Set();
  for(const row of rows){
    if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled'))continue;
    const habit = row.h || (data && row.i != null ? data[row.i] : null);
    const hid = habit && habit.hid;
    if(!hid || seen.has(hid))continue;
    seen.add(hid);
    hids.push(hid);
  }
  return hids;
}

const ASSISTANT_QUERY_FIELD_KEYS = {
  name:'name', kind:'type', status:'status', priority:'priorityRank', importance:'priorityRank',
  urgency:'urgency', overdue_days:'overdueDays', due_in_days:'dueInDays', days_since_last:'daysSinceLast',
  frequency_per_week:'timesPerWeek', duration_minutes:'durationMinutes', pinned:'pinned', breakable:'breakable',
  completed_today:'completedToday', topic:'topics', place:'places', weather_profile:'weatherProfile',
  scheduled_time:'startMinutes'
};

function assistantQueryCompare(actual, op, expected){
  const list = Array.isArray(actual) ? actual : null;
  if(op === 'contains'){
    if(list)return list.some(value => assistantNormText(value).includes(assistantNormText(expected)));
    return assistantNormText(actual).includes(assistantNormText(expected));
  }
  const aNum = typeof actual === 'number' ? actual : Number(actual);
  const eNum = typeof expected === 'number' ? expected : Number(expected);
  const numeric = actual !== null && actual !== '' && expected !== null && expected !== '' && Number.isFinite(aNum) && Number.isFinite(eNum);
  if(op === 'gt')return numeric && aNum > eNum;
  if(op === 'gte')return numeric && aNum >= eNum;
  if(op === 'lt')return numeric && aNum < eNum;
  if(op === 'lte')return numeric && aNum <= eNum;
  const equal = list
    ? list.some(value => assistantNormText(value) === assistantNormText(expected))
    : typeof actual === 'boolean' || typeof expected === 'boolean'
      ? Boolean(actual) === Boolean(expected)
      : numeric ? aNum === eNum : assistantNormText(actual) === assistantNormText(expected);
  return op === 'neq' ? !equal : equal;
}

function assistantQueryFieldValue(item, field){
  const key = ASSISTANT_QUERY_FIELD_KEYS[assistantNormText(field)];
  return key ? item && item[key] : undefined;
}

function assistantQueryOrdinal(n){
  const value = Math.max(1, Math.round(Number(n) || 1));
  const mod100 = value % 100;
  if(mod100 >= 11 && mod100 <= 13)return `${value}th`;
  return `${value}${value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`;
}

function assistantQueryFieldLabel(field, direction){
  const desc = direction === 'desc';
  const labels = {
    importance:desc ? 'least important' : 'most important', priority:desc ? 'least important' : 'most important',
    urgency:desc ? 'most urgent' : 'least urgent', overdue_days:desc ? 'most overdue' : 'least overdue',
    due_in_days:desc ? 'latest due' : 'soonest due', days_since_last:desc ? 'longest since completed' : 'most recently completed',
    frequency_per_week:desc ? 'most frequent' : 'least frequent', duration_minutes:desc ? 'longest' : 'shortest',
    scheduled_time:desc ? 'latest' : 'earliest', name:desc ? 'reverse-alphabetical' : 'alphabetical'
  };
  return labels[field] || 'matching';
}

function assistantQueryDetail(item, field){
  if(!item)return '';
  if(field === 'priority' || field === 'importance')return item.priority || '';
  if(field === 'urgency')return Number.isFinite(Number(item.urgency)) ? `urgency ${item.urgency}` : '';
  if(field === 'overdue_days')return item.overdueDays > 0 ? `${item.overdueDays} day${item.overdueDays === 1 ? '' : 's'} overdue` : 'not overdue';
  if(field === 'due_in_days')return item.dueInDays == null ? 'no due date' : item.dueInDays === 0 ? 'due today' : item.dueInDays < 0 ? `${Math.abs(item.dueInDays)} days overdue` : `due in ${item.dueInDays} days`;
  if(field === 'days_since_last')return item.daysSinceLast == null ? 'never completed' : `${item.daysSinceLast} days since completion`;
  if(field === 'frequency_per_week')return item.frequency || '';
  if(field === 'duration_minutes')return item.durationMinutes == null ? 'duration not set' : assistantQueryDurationText(item.durationMinutes);
  if(field === 'scheduled_time')return item.clock || '';
  return '';
}

function assistantApplyItemQuery(items, args, scope, opts){
  let rows = (Array.isArray(items) ? items : []).filter(Boolean).map((item,index) => Object.assign({_queryIndex:index}, item));
  const conditions = Array.isArray(args && args.conditions) ? args.conditions.slice(0, 12) : [];
  for(const condition of conditions){
    const field = assistantNormText(condition && condition.field);
    const op = ['eq','neq','gt','gte','lt','lte','contains'].includes(assistantNormText(condition && condition.op))
      ? assistantNormText(condition.op) : 'eq';
    if(!ASSISTANT_QUERY_FIELD_KEYS[field])continue;
    rows = rows.filter(item => assistantQueryCompare(assistantQueryFieldValue(item, field), op, condition.value));
  }
  const sortBy = ASSISTANT_QUERY_FIELD_KEYS[assistantNormText(args && args.sortBy)] ? assistantNormText(args.sortBy) : '';
  const defaultDesc = ['urgency','overdue_days','days_since_last','frequency_per_week','duration_minutes'].includes(sortBy);
  const direction = assistantNormText(args && args.sortOrder) === 'asc' ? 'asc'
    : assistantNormText(args && args.sortOrder) === 'desc' ? 'desc'
    : (defaultDesc ? 'desc' : 'asc');
  if(sortBy){
    rows.sort((a,b) => {
      const av = assistantQueryFieldValue(a, sortBy);
      const bv = assistantQueryFieldValue(b, sortBy);
      let cmp = 0;
      if(Array.isArray(av) || Array.isArray(bv) || typeof av === 'string' || typeof bv === 'string'){
        cmp = String(Array.isArray(av) ? av.join(', ') : av || '').localeCompare(String(Array.isArray(bv) ? bv.join(', ') : bv || ''));
      }else{
        const an = Number(av), bn = Number(bv);
        const am = av == null || av === '' || !Number.isFinite(an);
        const bm = bv == null || bv === '' || !Number.isFinite(bn);
        if(am !== bm)return am ? 1 : -1;
        if(!am)cmp = an - bn;
      }
      if(cmp)return direction === 'desc' ? -cmp : cmp;
      const priorityTie = (Number(a.priorityRank) || 0) - (Number(b.priorityRank) || 0);
      return priorityTie || a._queryIndex - b._queryIndex;
    });
  }
  const clean = item => { const copy = Object.assign({}, item); delete copy._queryIndex; return copy; };
  const aggregate = assistantNormText(args && args.aggregate);
  if(aggregate === 'count')return {ok:true, items:[], text:`${rows.length} ${scope}${rows.length === 1 ? '' : 's'} match.`};
  if(aggregate === 'sum_duration' || aggregate === 'average_duration'){
    const durations = rows.map(item => Number(item.durationMinutes)).filter(value => Number.isFinite(value) && value >= 0);
    if(!durations.length)return {ok:true, items:[], text:`None of the matching ${scope}${rows.length === 1 ? '' : 's'} has a duration.`};
    const total = durations.reduce((sum,value) => sum + value, 0);
    const value = aggregate === 'average_duration' ? (durations.length ? Math.round(total / durations.length) : 0) : total;
    const label = aggregate === 'average_duration' ? 'average duration' : 'total duration';
    const count = aggregate === 'average_duration' ? durations.length : rows.length;
    const qualifier = aggregate === 'average_duration' && durations.length !== rows.length ? ' with a duration' : '';
    return {ok:true, items:rows.map(clean).slice(0,20), text:`The ${label} of the ${count} matching ${scope}${count === 1 ? '' : 's'}${qualifier} is ${assistantQueryDurationText(value)}.`};
  }
  const position = Math.round(Number(args && args.position));
  if(Number.isInteger(position) && position > 0){
    const picked = rows[position - 1];
    if(!picked)return {ok:true, items:[], text:`Only ${rows.length} ${scope}${rows.length === 1 ? ' matches' : 's match'}, so there is no ${assistantQueryOrdinal(position)} result.`};
    const item = clean(picked);
    const ordinal = position === 1 ? 'The' : `The ${assistantQueryOrdinal(position)}`;
    const ranking = sortBy ? assistantQueryFieldLabel(sortBy, direction) : 'matching';
    const detail = assistantQueryDetail(item, sortBy);
    return {ok:true, items:[item], item, text:`${ordinal} ${ranking} ${scope} is ${item.name}${detail ? ` (${detail})` : ''}.`};
  }
  const requestedLimit = Math.round(Number(args && args.limit));
  const unlimited = Boolean(opts && opts.all);
  const hard = opts && Number(opts.max) > 0 ? Number(opts.max) : 20;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : (unlimited ? rows.length : 20);
  const capped = unlimited ? limit : Math.min(hard, limit);
  return {rows:rows.slice(0, capped).map(clean), total:rows.length, queried:Boolean(conditions.length || sortBy || (args && args.limit != null))};
}

function assistantScheduleAnalysisArgs(args, select){
  if(!select || (args && (args.sortBy || args.position || args.aggregate)))return args || {};
  const out = Object.assign({}, args || {}, {position:1});
  if(select === 'most_important'){
    out.sortBy = 'importance';
    out.sortOrder = 'asc';
  }else if(select === 'most_frequent'){
    out.sortBy = 'frequency_per_week';
    out.sortOrder = 'desc';
    out.conditions = (Array.isArray(out.conditions) ? out.conditions.slice() : []).concat([{field:'kind', op:'eq', value:'habit'}]);
  }else if(select === 'longest'){
    out.sortBy = 'duration_minutes';
    out.sortOrder = 'desc';
  }
  return out;
}

function assistantAnswerMissed(context, select, args){
  const data = context.data;
  const settings = context.settings;
  const now = context.now != null ? Number(context.now) : Date.now();
  const week = assistantQueryWeek(data, settings);
  const todayHids = assistantTodayAgendaHids(data, week, now);
  const dropped = typeof collectDroppedItems === 'function'
    ? collectDroppedItems(data, settings, todayHids, now)
    : [];
  if(!dropped.length){
    const empty = assistantApplyItemQuery([], assistantScheduleAnalysisArgs(args, select), 'missed item');
    return empty.ok ? empty : {ok:true, text:'Nothing missed — the missed list on today is empty.', items:[]};
  }
  const items = dropped.map(row => {
    const habit = (data && row.idx != null ? data[row.idx] : null)
      || (Array.isArray(data) ? data.find(item => item && item.hid === row.hid) : null);
    return assistantHabitQueryFacts(habit, {missed:row.dayLabel || 'today'}, context, row.idx)
      || {name:String(row.name || '').slice(0, 48), hid:row.hid, missed:row.dayLabel || 'today'};
  });
  const queried = assistantApplyItemQuery(items, assistantScheduleAnalysisArgs(args, select), 'missed item');
  if(queried.ok)return queried;
  if(!queried.rows.length)return {ok:true, text:'No missed items match the query.', items:[]};
  const more = queried.total > queried.rows.length ? ` and ${queried.total - queried.rows.length} more` : '';
  const listed = queried.rows.map(item => item.missed && item.missed !== 'today'
    ? `${item.name} (${item.missed})`
    : item.name).join(', ');
  return {ok:true, items:queried.rows, text:`Missed: ${listed}${more}.`};
}

function assistantQueryDurationText(minutes){
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if(h && rest)return `${h}h ${rest}m`;
  if(h)return `${h}h`;
  return `${rest}m`;
}

// Resolve the tool's date string to a dayBase inside the week horizon.
function assistantQueryDay(value, now){
  const ts = now != null ? Number(now) : Date.now();
  const base = typeof assistantDayBase === 'function' ? assistantDayBase(ts) : new Date(new Date(ts).setHours(0,0,0,0)).getTime();
  const s = assistantNormText(value);
  let dayBase = base;
  if(s){
    const parsed = typeof assistantParseDue === 'function' ? assistantParseDue(s, ts) : null;
    if(parsed == null)return null;
    dayBase = parsed;
  }
  const offset = Math.round((dayBase - base) / 86400000);
  if(offset < 0 || offset > 6)return null;
  const label = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : (ASSISTANT_WEEKDAY_LABELS[new Date(dayBase).getDay()] || 'that day');
  return {dayBase, offset, label};
}

function assistantQueryWindow(args, dayBase){
  if(dayBase == null)return null;
  let startMin = typeof assistantParseClock === 'function' ? assistantParseClock(args && args.start) : null;
  let endMin = typeof assistantParseClock === 'function' ? assistantParseClock(args && args.end) : null;
  const minutes = Number(args && args.minutes);
  const hasDuration = Number.isFinite(minutes) && minutes > 0 && minutes <= 1440;
  if(startMin != null && endMin == null && hasDuration)endMin = startMin + Math.round(minutes);
  if(endMin != null && startMin == null && hasDuration)startMin = endMin - Math.round(minutes);
  if(startMin == null || endMin == null || startMin < 0 || endMin > 1440 || endMin <= startMin)return null;
  return {start:dayBase + startMin * 60000, end:dayBase + endMin * 60000};
}

// The week agenda the home view already rendered, else the cache, else a
// fresh fast build. Rows carry `h` so names and completions resolve.
function assistantQueryWeek(data, settings){
  const rendered = typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days) ? _homeRenderedWeek : null;
  const week = rendered
    || (typeof cachedHomeAgenda === 'function' ? cachedHomeAgenda(data) : null)
    || (typeof buildWeekAgenda === 'function' ? buildWeekAgenda(data, settings, 7) : null);
  return week && Array.isArray(week.days) ? week : null;
}

function assistantQueryDayRows(day, data){
  const rows = [];
  for(const row of (day && day.timeline) || []){
    if(!row || row.kind === 'travel' || row.kind === 'block' || row.kind === 'busy')continue;
    const habit = row.h || (data && row.i != null ? data[row.i] : null);
    const name = String((habit && habit.name) || row.name || '').trim();
    if(!name)continue;
    rows.push({
      name:name.slice(0,48),
      hid:habit && habit.hid || null,
      habit,
      clock:assistantRowClock(row),
      start:row.start,
      end:row.end,
      kind:row.kind
    });
  }
  rows.sort((a,b) => a.start - b.start);
  return rows;
}

function assistantQueryRowFacts(rows, context){
  const seen = new Set();
  const items = [];
  for(const row of rows || []){
    const key = row.hid || row.name;
    if(!key || seen.has(key))continue;
    seen.add(key);
    const when = Number(row.start);
    const startMinutes = Number.isFinite(when) ? new Date(when).getHours() * 60 + new Date(when).getMinutes() : null;
    const index = row.habit && Array.isArray(context && context.data)
      ? context.data.findIndex(item => item && item.hid === row.habit.hid)
      : -1;
    const facts = assistantHabitQueryFacts(row.habit, {
      clock:row.clock || undefined,
      startMinutes
    }, context, index);
    items.push(facts || {name:row.name, clock:row.clock || undefined});
  }
  return items;
}

function assistantQueryRowsInWindowText(rows, start, end){
  const hit = rows.filter(row => row.end > start && row.start < end);
  if(!hit.length)return null;
  return hit.map(row => `${row.clock || ''} ${row.name}`.trim()).slice(0, 5).join(', ');
}

function assistantWeatherNumbers(settings){
  const f = typeof weatherUsesFahrenheit === 'function' && weatherUsesFahrenheit(settings);
  const convert = value => typeof weatherTempConverted === 'function' ? weatherTempConverted(value) : value;
  return {unit:f ? '°F' : '°C', convert};
}

const ASSISTANT_WEATHER_METRIC_KEYS = {
  temperature:'temperature_2m', temp:'temperature_2m', hot:'temperature_2m', heat:'temperature_2m',
  feels:'apparent_temperature', feel:'apparent_temperature',
  rain:'precipitation_probability', precipitation:'precipitation_probability', wet:'precipitation_probability',
  wind:'wind_speed_10m',
  gust:'wind_gusts_10m', gusts:'wind_gusts_10m',
  uv:'uv_index',
  aqi:'us_aqi'
};

function assistantWeatherMetricKey(value){
  const key = assistantNormText(value).replace(/[_-]+/g, ' ');
  if(!key)return '';
  if(ASSISTANT_WEATHER_METRIC_KEYS[key])return ASSISTANT_WEATHER_METRIC_KEYS[key];
  if(key === 'rain chance' || key === 'precipitation probability')return 'precipitation_probability';
  if(key === 'feels like' || key === 'apparent temperature')return 'apparent_temperature';
  if(key === 'wind speed')return 'wind_speed_10m';
  if(typeof WEATHER_METRICS === 'object' && WEATHER_METRICS[key.replace(/ /g, '_')])return key.replace(/ /g, '_');
  return '';
}

function assistantWeatherRelative(value){
  const key = assistantNormText(value).replace(/[_-]+/g, ' ');
  if(key === 'very high' || key === 'very hot')return 'very_high';
  if(key === 'very low' || key === 'very cold')return 'very_low';
  if(key === 'high' || key === 'hot' || key === 'higher')return 'high';
  if(key === 'low' || key === 'cold' || key === 'lower')return 'low';
  return '';
}

function assistantWeatherCount(word){
  if(word == null || word === '')return 1;
  if(typeof ASSISTANT_NUMBER_WORDS === 'object' && ASSISTANT_NUMBER_WORDS[word] != null)return ASSISTANT_NUMBER_WORDS[word];
  const n = Number(word);
  return Number.isFinite(n) ? n : null;
}

function assistantWeatherAnchorMinutes(word, offsetMin, dayBase, settings){
  const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(word) : null;
  if(!anchor || typeof resolvePrayerExprMinutes !== 'function')return null;
  const lat = Number(settings && settings.homeCityLat);
  const lng = Number(settings && settings.homeCityLng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return null;
  const minutes = resolvePrayerExprMinutes({latitude:lat, longitude:lng}, anchor, offsetMin, dayBase, 0);
  if(!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440)return null;
  return Math.round(minutes);
}

// A clock, or a prayer/sun offset such as "1 hour before sunset".
function assistantWeatherMomentMinutes(value, dayBase, settings){
  const s = assistantNormText(value).replace(/\./g, '').replace(/^(?:about|around|at)\s+/, '');
  if(!s)return null;
  if(s === 'noon' || s === 'midday' || s === 'midnight')return assistantParseClock(s);
  const anchors = 'sunset|sunrise|dawn|dusk|fajr|dhuhr|zuhr|asr|maghrib|maghreb|isha';
  const counts = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+(?:\\.\\d+)?';
  const offset = s.match(new RegExp('^(?:(' + counts + ')\\s+)?(hours?|hrs?|minutes?|mins?)\\s+(before|after)\\s+(' + anchors + ')$'));
  if(offset){
    const count = assistantWeatherCount(offset[1]);
    if(count == null)return null;
    let minutes = /^h/.test(offset[2]) ? Math.round(count * 60) : Math.round(count);
    if(offset[3] === 'before')minutes = -minutes;
    return assistantWeatherAnchorMinutes(offset[4], minutes, dayBase, settings);
  }
  const side = s.match(new RegExp('^(before|after)\\s+(' + anchors + ')$'));
  if(side)return assistantWeatherAnchorMinutes(side[2], 0, dayBase, settings);
  const bare = s.match(new RegExp('^(' + anchors + ')$'));
  if(bare)return assistantWeatherAnchorMinutes(bare[1], 0, dayBase, settings);
  return typeof assistantParseClock === 'function' ? assistantParseClock(s) : null;
}

function assistantWeatherSpan(args, dayBase, settings, options){
  const startGiven = args && args.start != null && String(args.start).trim() !== '';
  const endGiven = args && args.end != null && String(args.end).trim() !== '';
  const startParsed = startGiven ? assistantWeatherMomentMinutes(args.start, dayBase, settings) : null;
  const endParsed = endGiven ? assistantWeatherMomentMinutes(args.end, dayBase, settings) : null;
  if(startGiven && startParsed == null)return {error:`I could not resolve "${String(args.start).trim()}". Use a clock like 5pm, or sunset with an offset such as 1 hour before sunset.`};
  if(endGiven && endParsed == null)return {error:`I could not resolve "${String(args.end).trim()}". Use a clock like 6pm, or sunset.`};
  let startMin = startParsed;
  let endMin = endParsed;
  if(startMin == null && endMin == null){
    if(!(options && options.allowWholeDay))return null;
    startMin = 0;
    endMin = 1440;
    const now = options && options.now;
    if(now != null && dayBase === assistantDayBase(now)){
      const nowMin = Math.floor((Number(now) - dayBase) / 60000);
      if(nowMin > 0 && nowMin < 1440)startMin = Math.floor(nowMin / 60) * 60;
    }
  }else if(startMin != null && endMin == null){
    endMin = 1440;
  }else if(startMin == null){
    startMin = 0;
  }
  startMin = Math.max(0, Math.min(1439, Math.round(startMin)));
  endMin = Math.max(0, Math.min(1440, Math.round(endMin)));
  if(endMin <= startMin)return {error:'That time window is empty.'};
  return {startMin, endMin};
}

function assistantWeatherSpanLabel(dayLabel, startMin, endMin){
  const pretty = dayLabel ? dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1) : 'Today';
  if(startMin <= 0 && endMin >= 1440)return pretty;
  if(endMin >= 1440)return `${pretty} after ${assistantFriendlyClock(startMin)}`;
  if(startMin <= 0)return `${pretty} until ${assistantFriendlyClock(endMin)}`;
  return `${pretty} ${assistantFriendlyClock(startMin)}–${assistantFriendlyClock(endMin)}`;
}

function assistantWeatherReadableContext(settings, now, dayBase){
  const context = (typeof weatherContextForLocation === 'function' && weatherContextForLocation(null, settings))
    || (settings && settings._weatherContext)
    || (typeof weatherPlannerContext === 'function' ? weatherPlannerContext(settings, now) : null);
  if(!context || !Array.isArray(context.samples) || !context.samples.length)return null;
  if(!Number(context.weeklyFetchedAt) || now - Number(context.weeklyFetchedAt) > 8 * 60 * 60 * 1000)return null;
  if(typeof weatherRequestedDayKey === 'function' && weatherRequestedDayKey(dayBase) < weatherRequestedDayKey(now))return null;
  return context;
}

function assistantWeatherValueText(metric, stored){
  const shown = Math.round(typeof weatherMetricValueConverted === 'function'
    ? weatherMetricValueConverted(metric, stored)
    : Number(stored));
  const unit = typeof weatherMetricUnitLabel === 'function' ? weatherMetricUnitLabel(metric) : '';
  if(!unit)return String(shown);
  return unit.charAt(0) === '°' ? `${shown}${unit}` : `${shown} ${unit}`;
}

function assistantWeatherHourRows(context, dayBase, startMin, endMin){
  const buckets = new Map();
  for(const sample of context.samples || []){
    if(!sample || !Number.isFinite(Number(sample.ts)))continue;
    const minute = Math.round((Number(sample.ts) - dayBase) / 60000);
    if(minute < startMin || minute >= endMin)continue;
    const hour = Math.floor(minute / 60) * 60;
    if(!buckets.has(hour))buckets.set(hour, []);
    buckets.get(hour).push(sample);
  }
  const keys = typeof WEATHER_METRICS === 'object' ? Object.keys(WEATHER_METRICS) : [];
  return [...buckets.keys()].sort((a, b) => a - b).map(hour => {
    const samples = buckets.get(hour);
    const metrics = {};
    for(const key of keys){
      const value = typeof weatherAggregate === 'function' ? weatherAggregate(samples, key) : null;
      if(Number.isFinite(value))metrics[key] = value;
    }
    let condition = '';
    if(typeof weatherCodePresentation === 'function'){
      const codes = samples.map(sample => Number(sample.weather_code)).filter(Number.isFinite).map(weatherCodePresentation);
      codes.sort((a, b) => b.rank - a.rank);
      condition = codes[0] && codes[0].label || '';
    }
    return {startMin:hour, condition, metrics};
  });
}

function assistantWeatherHourBrief(row){
  if(!row)return 'no hourly detail';
  const metrics = row.metrics || {};
  const parts = [];
  if(row.condition)parts.push(row.condition);
  if(Number.isFinite(metrics.temperature_2m))parts.push(assistantWeatherValueText('temperature_2m', metrics.temperature_2m));
  if(Number.isFinite(metrics.wind_speed_10m))parts.push(`wind ${assistantWeatherValueText('wind_speed_10m', metrics.wind_speed_10m)}`);
  if(Number.isFinite(metrics.precipitation_probability))parts.push(`${Math.round(metrics.precipitation_probability)}% rain`);
  return parts.join(', ') || 'no hourly detail';
}

function assistantWeatherExtremesText(rows){
  if(!rows || rows.length < 2)return '';
  const bits = [];
  const wind = rows.filter(row => Number.isFinite(row.metrics && row.metrics.wind_speed_10m));
  if(wind.length >= 2){
    const lo = wind.reduce((best, row) => row.metrics.wind_speed_10m < best.metrics.wind_speed_10m ? row : best);
    const hi = wind.reduce((best, row) => row.metrics.wind_speed_10m > best.metrics.wind_speed_10m ? row : best);
    if(lo.startMin !== hi.startMin){
      bits.push(`Lowest wind is ${assistantFriendlyClock(lo.startMin)} (${assistantWeatherValueText('wind_speed_10m', lo.metrics.wind_speed_10m)})`);
    }
  }
  const temp = rows.filter(row => Number.isFinite(row.metrics && row.metrics.temperature_2m));
  if(temp.length >= 2){
    const hi = temp.reduce((best, row) => row.metrics.temperature_2m > best.metrics.temperature_2m ? row : best);
    const lo = temp.reduce((best, row) => row.metrics.temperature_2m < best.metrics.temperature_2m ? row : best);
    if(lo.startMin !== hi.startMin){
      bits.push(`Warmest is ${assistantFriendlyClock(hi.startMin)} (${assistantWeatherValueText('temperature_2m', hi.metrics.temperature_2m)})`);
    }
  }
  return bits.length ? `${bits.join('. ')}.` : '';
}

function assistantWeatherConditions(args){
  const raw = Array.isArray(args && args.conditions) ? args.conditions.slice(0, 8) : [];
  const out = [];
  for(const row of raw){
    if(!row || typeof row !== 'object')continue;
    const metric = assistantWeatherMetricKey(row.metric || row.field);
    if(!metric)continue;
    const relative = assistantWeatherRelative(row.relative);
    const opName = assistantNormText(row.op);
    const op = ['eq','neq','gt','gte','lt','lte'].includes(opName) ? opName : '';
    let value = null;
    if(row.value != null && row.value !== '' && typeof weatherMetricValueToStored === 'function'){
      const stored = Number(weatherMetricValueToStored(metric, row.value));
      if(Number.isFinite(stored))value = stored;
    }
    if(!relative && !(op && value != null))continue;
    out.push({metric, relative, op, value});
  }
  return out;
}

function assistantWeatherAbsolutePass(value, condition){
  if(!condition.op || condition.value == null)return true;
  if(!Number.isFinite(value))return false;
  if(condition.op === 'gt')return value > condition.value;
  if(condition.op === 'gte')return value >= condition.value;
  if(condition.op === 'lt')return value < condition.value;
  if(condition.op === 'lte')return value <= condition.value;
  if(condition.op === 'neq')return value !== condition.value;
  return value === condition.value;
}

function assistantWeatherRelativePass(relative, percentile){
  if(relative === 'very_low')return percentile <= 0.25;
  if(relative === 'low')return percentile <= 0.45;
  if(relative === 'high')return percentile >= 0.55;
  if(relative === 'very_high')return percentile >= 0.75;
  return true;
}

function assistantWeatherRelativeGoodness(condition, percentile){
  const weight = condition.relative === 'very_high' || condition.relative === 'very_low' ? 1.5 : 1;
  if(condition.relative === 'high' || condition.relative === 'very_high')return percentile * weight;
  if(condition.relative === 'low' || condition.relative === 'very_low')return (1 - percentile) * weight;
  return 0;
}

function assistantWeatherRelativePhrase(condition){
  const metric = condition.metric;
  const rel = condition.relative;
  if(metric === 'temperature_2m' || metric === 'apparent_temperature'){
    if(rel === 'very_high')return 'very hot';
    if(rel === 'high')return 'relatively hot';
    if(rel === 'very_low')return 'very cold';
    if(rel === 'low')return 'relatively cold';
  }
  if(metric === 'wind_speed_10m' || metric === 'wind_gusts_10m'){
    if(rel === 'very_low')return 'very low wind';
    if(rel === 'low')return 'low wind';
    if(rel === 'very_high')return 'very high wind';
    if(rel === 'high')return 'high wind';
  }
  const label = typeof WEATHER_METRICS === 'object' && WEATHER_METRICS[metric] ? WEATHER_METRICS[metric].label : 'that';
  if(rel === 'very_low')return `very low ${label}`;
  if(rel === 'low')return `low ${label}`;
  if(rel === 'very_high')return `very high ${label}`;
  if(rel === 'high')return `high ${label}`;
  return label;
}

function assistantWeatherExtremeWord(metric, order){
  const high = order === 'desc';
  if(metric === 'wind_speed_10m' || metric === 'wind_gusts_10m')return high ? 'highest wind' : 'lowest wind';
  if(metric === 'temperature_2m' || metric === 'apparent_temperature')return high ? 'warmest' : 'coolest';
  if(metric === 'precipitation_probability' || metric === 'precipitation')return high ? 'wettest' : 'driest';
  if(metric === 'uv_index')return high ? 'highest UV' : 'lowest UV';
  const label = typeof WEATHER_METRICS === 'object' && WEATHER_METRICS[metric] ? WEATHER_METRICS[metric].label : 'value';
  return high ? `highest ${label}` : `lowest ${label}`;
}

function assistantWeatherDefaultOrder(metric){
  if(metric === 'temperature_2m' || metric === 'apparent_temperature' || metric === 'uv_index')return 'desc';
  return 'asc';
}

function assistantWeatherRankArgs(args){
  return Boolean(args && (
    args.sortBy || args.position || args.limit
    || (Array.isArray(args.conditions) && args.conditions.length)
  ));
}

function assistantWeatherNoForecast(){
  return {ok:true, text:'I do not have a fresh forecast for that window yet. Open the weather panel once to fetch it, then ask again.'};
}

function assistantAnswerWeatherHours(args, context, dayBase, dayLabel){
  const settings = context.settings;
  const now = context.now;
  const span = assistantWeatherSpan(args, dayBase, settings, {allowWholeDay:true, now});
  if(!span)return {ok:true, text:`Give me the time window, like "after 5pm". ${assistantQueryCapabilities()}`};
  if(span.error)return {ok:true, text:span.error};
  const weather = assistantWeatherReadableContext(settings, now, dayBase);
  if(!weather)return assistantWeatherNoForecast();
  const rows = assistantWeatherHourRows(weather, dayBase, span.startMin, span.endMin);
  if(!rows.length)return assistantWeatherNoForecast();
  const where = assistantWeatherSpanLabel(dayLabel, span.startMin, span.endMin);
  const conditions = assistantWeatherConditions(args);
  const metrics = [...new Set(conditions.map(condition => condition.metric))];
  for(const metric of metrics){
    const values = rows.map(row => row.metrics[metric]).filter(Number.isFinite);
    for(const row of rows){
      if(!row.percentiles)row.percentiles = {};
      const value = row.metrics[metric];
      row.percentiles[metric] = typeof weatherPercentile === 'function'
        ? weatherPercentile(value, values)
        : 0.5;
    }
  }
  const absolute = conditions.filter(condition => condition.op && condition.value != null);
  const relative = conditions.filter(condition => condition.relative);
  let matched = rows.filter(row => absolute.every(condition => assistantWeatherAbsolutePass(row.metrics[condition.metric], condition)));
  let relaxed = false;
  if(relative.length){
    const strict = matched.filter(row => relative.every(condition => assistantWeatherRelativePass(condition.relative, row.percentiles && row.percentiles[condition.metric])));
    if(strict.length)matched = strict;
    else relaxed = true;
  }
  const sortMetric = assistantWeatherMetricKey(args && args.sortBy);
  const requestedOrder = assistantNormText(args && args.sortOrder);
  const order = requestedOrder === 'asc' || requestedOrder === 'desc'
    ? requestedOrder
    : (sortMetric ? assistantWeatherDefaultOrder(sortMetric) : 'asc');
  matched.sort((a, b) => {
    if(relative.length && !sortMetric){
      const score = row => relative.reduce((sum, condition) => sum + assistantWeatherRelativeGoodness(condition, (row.percentiles && row.percentiles[condition.metric]) || 0), 0);
      const delta = score(b) - score(a);
      if(delta)return delta;
    }
    if(sortMetric){
      const av = a.metrics[sortMetric];
      const bv = b.metrics[sortMetric];
      const am = !Number.isFinite(av);
      const bm = !Number.isFinite(bv);
      if(am !== bm)return am ? 1 : -1;
      if(!am && av !== bv)return order === 'desc' ? bv - av : av - bv;
    }
    return a.startMin - b.startMin;
  });
  const position = Math.round(Number(args && args.position));
  const hasPosition = Number.isInteger(position) && position > 0;
  const limit = Math.round(Number(args && args.limit));
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const items = matched.map(row => ({
    clock:assistantFriendlyClock(row.startMin),
    condition:row.condition || undefined,
    temperature:Number.isFinite(row.metrics.temperature_2m) ? assistantWeatherValueText('temperature_2m', row.metrics.temperature_2m) : undefined,
    wind:Number.isFinite(row.metrics.wind_speed_10m) ? assistantWeatherValueText('wind_speed_10m', row.metrics.wind_speed_10m) : undefined,
    rain:Number.isFinite(row.metrics.precipitation_probability) ? `${Math.round(row.metrics.precipitation_probability)}%` : undefined
  }));
  if(!matched.length)return {ok:true, items:[], text:`No hour ${where.charAt(0).toLowerCase() + where.slice(1)} matches those conditions.`};
  const pickOne = hasPosition || (!hasLimit && (sortMetric || relative.length));
  if(pickOne){
    const index = hasPosition ? position - 1 : 0;
    const picked = matched[index];
    if(!picked)return {ok:true, items, text:`Only ${matched.length} hour${matched.length === 1 ? '' : 's'} match, so there is no ${assistantQueryOrdinal(index + 1)} result.`};
    const clock = assistantFriendlyClock(picked.startMin);
    const brief = assistantWeatherHourBrief(picked);
    if(sortMetric && !relative.length){
      const word = assistantWeatherExtremeWord(sortMetric, order);
      const ordinal = !hasPosition || position === 1 ? '' : `${assistantQueryOrdinal(position)} `;
      return {ok:true, items, text:`${where}, the ${ordinal}${word} is ${clock}: ${brief}.`};
    }
    const phrase = relative.map(assistantWeatherRelativePhrase).filter(Boolean).join(' and ') || 'a match';
    if(relaxed)return {ok:true, items, text:`${where}, no hour is ${phrase}. Closest is ${clock}: ${brief}.`};
    const extra = !hasPosition && matched.length > 1 ? ` ${matched.length - 1} other hour${matched.length === 2 ? '' : 's'} also match.` : '';
    return {ok:true, items, text:`${where}, ${clock} is ${phrase}: ${brief}.${extra}`};
  }
  const shown = matched.slice(0, hasLimit ? Math.min(8, limit) : 8);
  const listed = shown.map(row => `${assistantFriendlyClock(row.startMin)} ${assistantWeatherHourBrief(row)}`).join('; ');
  const more = matched.length > shown.length ? ` ${matched.length - shown.length} later hours not listed.` : '';
  return {ok:true, items, text:`${where}: ${listed}.${more}`};
}

function assistantWeatherPoint(value, dayBase, settings){
  if(value == null || String(value).trim() === '')return null;
  const label = String(value).trim();
  const minutes = assistantWeatherMomentMinutes(label, dayBase, settings);
  if(minutes == null){
    return {error:`I could not resolve "${label}". Use a clock like 5pm, or sunset with an offset such as 1 hour before sunset. Sunset needs a home city.`};
  }
  return {minutes, label};
}

function assistantWeatherPointLabel(point){
  const clock = assistantFriendlyClock(point.minutes);
  const raw = assistantNormText(point.label);
  if(!raw || raw === assistantNormText(clock))return clock;
  return `${clock} (${point.label})`;
}

function assistantWeatherMomentSummary(context, dayBase, minutes){
  const ts = dayBase + minutes * 60000;
  let best = null;
  let bestDelta = Infinity;
  for(const sample of context.samples || []){
    if(!sample || !Number.isFinite(Number(sample.ts)))continue;
    const delta = ts - Number(sample.ts);
    if(delta < 0 || delta >= 60 * 60 * 1000 || delta >= bestDelta)continue;
    best = sample;
    bestDelta = delta;
  }
  if(!best)return null;
  const metrics = {};
  for(const key of (typeof WEATHER_METRICS === 'object' ? Object.keys(WEATHER_METRICS) : [])){
    const value = Number(best[key]);
    if(Number.isFinite(value))metrics[key] = value;
  }
  let condition = '';
  if(typeof weatherCodePresentation === 'function' && Number.isFinite(Number(best.weather_code))){
    condition = weatherCodePresentation(best.weather_code).label || '';
  }
  return {condition, metrics, sampleTs:Number(best.ts)};
}

function assistantWeatherDuration(args, habit){
  const requested = Number(args && args.durationMinutes);
  if(Number.isFinite(requested) && requested >= 15 && requested <= 1440)return Math.round(requested);
  const own = Number(habit && habit.durationMinutes);
  if(Number.isFinite(own) && own >= 15 && own <= 1440)return Math.round(own);
  return 60;
}

function assistantWeatherFitAt(habit, index, dayBase, minutes, duration, settings){
  if(!habit || typeof weatherFitAssessment !== 'function')return null;
  const length = Math.max(15, Math.min(duration, 1440 - minutes));
  return weatherFitAssessment(
    {h:habit, i:index},
    {placeStart:dayBase + minutes * 60000, placeEnd:dayBase + (minutes + length) * 60000, locId:null},
    {dayBase, fills:[]},
    settings
  );
}

function assistantWeatherFitRank(assessment){
  if(!assessment || assessment.status === 'unknown')return null;
  return (assessment.hardFail ? 100000 : 0) + (Number(assessment.penalty) || 0);
}

function assistantWeatherFitPhrase(assessment){
  if(!assessment)return 'no weather rules';
  return assessment.summary || assessment.status || 'forecast';
}

function assistantWeatherPlannedNote(found, context, dayBase, dayLabel){
  const week = assistantQueryWeek(context.data, context.settings);
  const day = week ? (week.days || []).find(item => item.dayBase === dayBase) : null;
  let clock = '';
  for(const row of (day && day.timeline) || []){
    if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled'))continue;
    const habit = row.h || null;
    if(!habit || habit.hid !== found.hid)continue;
    clock = typeof assistantRowClock === 'function' ? assistantRowClock(row) : '';
    break;
  }
  if(!clock)return `${found.name} is not planned ${dayLabel}. `;
  return `${found.name} is planned ${dayLabel} at ${clock}. `;
}

function assistantAnswerWeatherItemWindow(args, context, found, dayBase, dayLabel){
  const settings = context.settings;
  const span = assistantWeatherSpan(args, dayBase, settings, {});
  if(!span)return {ok:true, text:`Give me the time window, like "after 5pm". ${assistantQueryCapabilities()}`};
  if(span.error)return {ok:true, text:span.error};
  const weather = assistantWeatherReadableContext(settings, context.now, dayBase);
  if(!weather)return assistantWeatherNoForecast();
  const duration = assistantWeatherDuration(args, found.habit);
  const candidates = [];
  for(let min = span.startMin; min < span.endMin; min += 60){
    const length = Math.min(duration, span.endMin - min);
    if(length < 15)break;
    candidates.push({
      min,
      length,
      assessment:assistantWeatherFitAt(found.habit, found.index, dayBase, min, length, settings),
      sample:assistantWeatherMomentSummary(weather, dayBase, min)
    });
  }
  if(!candidates.length)return assistantWeatherNoForecast();
  const where = assistantWeatherSpanLabel(dayLabel, span.startMin, span.endMin);
  const planned = assistantWeatherPlannedNote(found, context, dayBase, dayLabel);
  candidates.sort((a, b) => {
    const ar = assistantWeatherFitRank(a.assessment);
    const br = assistantWeatherFitRank(b.assessment);
    if(ar == null && br == null)return a.min - b.min;
    if(ar == null)return 1;
    if(br == null)return -1;
    return ar - br || a.min - b.min;
  });
  const best = candidates[0];
  const bestClock = `${assistantFriendlyClock(best.min)}–${assistantFriendlyClock(best.min + best.length)}`;
  if(!best.assessment){
    const brief = assistantWeatherHourBrief(best.sample);
    return {ok:true, text:`${planned}${found.name} has no weather rules, so the forecast does not steer it. ${where}, ${bestClock} is ${brief}.`};
  }
  const earlier = candidates
    .filter(row => row.min < best.min && assistantWeatherFitRank(row.assessment) != null && assistantWeatherFitRank(row.assessment) > assistantWeatherFitRank(best.assessment))
    .sort((a, b) => a.min - b.min)[0];
  const contrast = earlier ? ` ${assistantFriendlyClock(earlier.min)}: ${assistantWeatherFitPhrase(earlier.assessment)}.` : '';
  return {ok:true, text:`${planned}${where}, best for ${found.name} is ${bestClock}: ${assistantWeatherFitPhrase(best.assessment)}.${contrast}`};
}

function assistantAnswerWeatherCompare(args, context, dayBase, dayLabel){
  const settings = context.settings;
  const left = assistantWeatherPoint(args && args.start, dayBase, settings);
  const right = assistantWeatherPoint(args && (args.compareStart || args.end), dayBase, settings);
  if(!left || !right)return {ok:true, text:`Tell me the two times to compare, like 5pm and 1 hour before sunset. ${assistantQueryCapabilities()}`};
  if(left.error)return {ok:true, text:left.error};
  if(right.error)return {ok:true, text:right.error};
  const weather = assistantWeatherReadableContext(settings, context.now, dayBase);
  if(!weather)return assistantWeatherNoForecast();
  const leftSummary = assistantWeatherMomentSummary(weather, dayBase, left.minutes);
  const rightSummary = assistantWeatherMomentSummary(weather, dayBase, right.minutes);
  if(!leftSummary || !rightSummary)return assistantWeatherNoForecast();
  let text = `${dayLabel} ${assistantWeatherPointLabel(left)}: ${assistantWeatherHourBrief(leftSummary)}. ${assistantWeatherPointLabel(right)}: ${assistantWeatherHourBrief(rightSummary)}.`;
  if(leftSummary.sampleTs === rightSummary.sampleTs){
    const sampleMin = Math.round((leftSummary.sampleTs - dayBase) / 60000);
    text += ` Both fall in the ${assistantFriendlyClock(sampleMin)} forecast hour.`;
  }
  const want = String((args && args.name) || '').trim();
  if(!want)return {ok:true, text};
  const found = assistantFindHabit(context.data, want);
  if(!found.ok){
    if((found.choices || []).length)return found;
    return {ok:true, text:`${text} I cannot find ${want}, so this compares the forecast only.`};
  }
  const duration = assistantWeatherDuration(args, found.habit);
  const leftFit = assistantWeatherFitAt(found.habit, found.index, dayBase, left.minutes, duration, settings);
  const rightFit = assistantWeatherFitAt(found.habit, found.index, dayBase, right.minutes, duration, settings);
  const leftRank = assistantWeatherFitRank(leftFit);
  const rightRank = assistantWeatherFitRank(rightFit);
  if(leftRank == null && rightRank == null){
    text += ` ${found.name} has no weather rules, so the forecast does not steer it.`;
  }else if(leftRank == null || rightRank == null){
    text += ` ${found.name} can only be scored at ${assistantWeatherPointLabel(leftRank == null ? right : left)}.`;
  }else if(leftRank === rightRank){
    text += ` For ${found.name}, both times score the same (${assistantWeatherFitPhrase(leftFit)}).`;
  }else{
    const better = leftRank < rightRank ? left : right;
    const worse = leftRank < rightRank ? right : left;
    const betterFit = leftRank < rightRank ? leftFit : rightFit;
    const worseFit = leftRank < rightRank ? rightFit : leftFit;
    text += ` For ${found.name}, ${assistantWeatherPointLabel(better)} is the better fit (${assistantWeatherFitPhrase(betterFit)}). ${assistantWeatherPointLabel(worse)}: ${assistantWeatherFitPhrase(worseFit)}.`;
  }
  return {ok:true, text};
}

function assistantAnswerWeather(args, context){
  const settings = context.settings;
  const now = context.now;
  const queryRaw = assistantNormText(args && args.query);
  const date = assistantQueryDay(args && args.date, now);
  if((args && args.date != null && String(args.date).trim() !== '') && !date){
    return {ok:true, text:`I can only cover the next seven days. ${assistantQueryCapabilities()}`};
  }
  const dayBase = date ? date.dayBase : assistantDayBase(now);
  const dayLabel = date ? date.label : 'today';
  let query = ['day','window','item','hours','compare'].includes(queryRaw) ? queryRaw : '';

  if(!query){
    return {ok:true, text:`That weather question is too vague for me. ${assistantQueryCapabilities()}`};
  }
  if(query === 'compare' || (args && args.compareStart)){
    return assistantAnswerWeatherCompare(args, context, dayBase, dayLabel);
  }
  if(query === 'hours' || (query === 'window' && assistantWeatherRankArgs(args))){
    return assistantAnswerWeatherHours(args, context, dayBase, dayLabel);
  }

  if(query === 'item'){
    const want = String((args && args.name) || '').trim();
    if(!want)return {ok:true, text:`Which item should I check the weather for? ${assistantQueryCapabilities()}`};
    const found = assistantFindHabit(context.data, want);
    if(!found.ok){
      if((found.choices || []).length)return found;
      if(args && (args.start || args.end)){
        const forecast = assistantAnswerWeatherHours(args, context, dayBase, dayLabel);
        return {ok:true, text:`I cannot find ${want}, so this is only the forecast. ${forecast.text}`};
      }
      return {ok:true, text:found.ask || 'I cannot find that item.'};
    }
    if(args && (args.start || args.end)){
      return assistantAnswerWeatherItemWindow(args, context, found, dayBase, dayLabel);
    }
    const week = assistantQueryWeek(context.data, settings);
    const day = week ? (week.days || []).find(item => item.dayBase === dayBase) : null;
    const rows = [];
    for(const row of (day && day.timeline) || []){
      if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled'))continue;
      const habit = row.h || null;
      if(!habit || habit.hid !== found.hid)continue;
      rows.push(row);
    }
    if(!rows.length){
      return {ok:true, text:`${found.name} is not planned on ${dayLabel}. ${assistantQueryCapabilities()}`};
    }
    const temps = assistantWeatherNumbers(settings);
    const row = rows[0];
    const clock = assistantRowClock(row);
    let assessment = null;
    if(typeof weatherFitAssessment === 'function'){
      assessment = weatherFitAssessment(
        {h:found.habit, i:found.index},
        {placeStart:row.start, placeEnd:row.end, locId:row.locationId || null},
        {dayBase, fills:[]},
        settings
      );
    }
    if(!assessment){
      const period = typeof weatherPeriodSummary === 'function'
        ? weatherPeriodSummary(row.start, row.end, settings, row.locationId || null, now)
        : null;
      if(!period)return {ok:true, text:`${found.name} has no weather rules, and I do not have a fresh forecast yet. Open the weather panel once to fetch it, then ask again.`};
      return {ok:true, text:`${found.name} has no weather rules, so the forecast does not steer it. ${dayLabel} ${clock || ''}: ${period.condition ? period.condition.label : 'clear'}, ${Math.round(temps.convert(period.low))}–${Math.round(temps.convert(period.high))}${temps.unit}, ${Number.isFinite(period.precipitationChance) ? period.precipitationChance : 0}% rain chance.`.trim()};
    }
    const statusText = assessment.status === 'good'
      ? `the weather looks good for it (${assessment.summary})`
      : assessment.status === 'unknown'
        ? `I cannot judge it — ${assessment.summary}`
        : `watch out — ${assessment.summary}`;
    return {ok:true, text:`${found.name} is planned ${dayLabel}${clock ? ` at ${clock}` : ''}: ${statusText}.`};
  }

  const contextWeather = typeof weatherPlannerContext === 'function' ? weatherPlannerContext(settings, now) : null;

  if(query === 'window'){
    const span = assistantWeatherSpan(args, dayBase, settings, {});
    if(!span)return {ok:true, text:`Give me the time window, like "tomorrow 5 to 6 pm". ${assistantQueryCapabilities()}`};
    if(span.error)return {ok:true, text:span.error};
    const windowStart = dayBase + span.startMin * 60000;
    const windowEnd = dayBase + span.endMin * 60000;
    const period = typeof weatherPeriodSummary === 'function'
      ? weatherPeriodSummary(windowStart, windowEnd, settings, null, now)
      : null;
    if(!period)return {ok:true, text:'I do not have a fresh forecast for that window yet. Open the weather panel once to fetch it, then ask again.'};
    const temps = assistantWeatherNumbers(settings);
    const parts = [
      `${dayLabel} ${assistantFriendlyClock(span.startMin)}–${assistantFriendlyClock(span.endMin)}`,
      `${period.condition ? period.condition.label : 'clear'}`,
      `${Math.round(temps.convert(period.low))}–${Math.round(temps.convert(period.high))}${temps.unit}`,
      `${Number.isFinite(period.precipitationChance) ? Math.round(period.precipitationChance) : 0}% rain chance`
    ];
    if(Number.isFinite(period.wind))parts.push(`wind ${Math.round(typeof weatherMetricValueConverted === 'function' ? weatherMetricValueConverted('wind_speed_10m', period.wind) : period.wind)}${typeof weatherMetricUnitLabel === 'function' ? weatherMetricUnitLabel('wind_speed_10m') : ''}`);
    let text = parts.join(' · ') + '.';
    if(windowEnd - windowStart >= 3 * 60 * 60 * 1000){
      const weather = assistantWeatherReadableContext(settings, now, dayBase);
      const rows = weather ? assistantWeatherHourRows(weather, dayBase, span.startMin, span.endMin) : [];
      const extremes = assistantWeatherExtremesText(rows);
      if(extremes)text += ` ${extremes}`;
    }
    return {ok:true, text};
  }

  // query day.
  const summary = contextWeather && typeof weatherDaySummary === 'function'
    ? weatherDaySummary(contextWeather, dayBase, settings, now)
    : null;
  if(!summary)return {ok:true, text:'I do not have a fresh forecast yet. Open the weather panel once to fetch it, then ask again.'};
  const temps = assistantWeatherNumbers(settings);
  const parts = [
    `${dayLabel} in ${summary.cityName || 'your home city'}`,
    `${summary.condition ? `${summary.condition.emoji || ''} ${summary.condition.label}`.trim() : 'clear'}`,
    `${Math.round(temps.convert(summary.low))}–${Math.round(temps.convert(summary.high))}${temps.unit}`,
    `${Number.isFinite(summary.precipitationChance) ? Math.round(summary.precipitationChance) : 0}% rain chance`
  ];
  if(Number.isFinite(summary.wind))parts.push(`wind up to ${Math.round(typeof weatherMetricValueConverted === 'function' ? weatherMetricValueConverted('wind_speed_10m', summary.wind) : summary.wind)}${typeof weatherMetricUnitLabel === 'function' ? weatherMetricUnitLabel('wind_speed_10m') : ''}`);
  return {ok:true, text:parts.join(' · ') + '.'};
}

async function assistantAnswerSchedule(args, context){
  const settings = context.settings;
  const now = context.now;
  const data = context.data;
  const queryRaw = assistantNormText(args && args.query);
  const query = ['free','freest','conflict','missed','day','week'].includes(queryRaw) ? queryRaw : '';
  const selectRaw = assistantNormText(args && args.select);
  const select = ['most_important','most_frequent','longest'].includes(selectRaw) ? selectRaw : '';
  if(!query)return {ok:true, text:`That schedule question is too vague for me. ${assistantQueryCapabilities()}`};
  const date = assistantQueryDay(args && args.date, now);
  if((args && args.date != null && String(args.date).trim() !== '') && !date){
    return {ok:true, text:`I plan a week at a time, so pick a day in the next seven days. ${assistantQueryCapabilities()}`};
  }
  const dayBase = date ? date.dayBase : assistantDayBase(now);
  const dayLabel = date ? date.label : 'today';
  const week = assistantQueryWeek(data, settings);
  const day = week ? (week.days || []).find(item => item.dayBase === dayBase) : null;
  const gapsInfo = day && typeof computeDayFreeGaps === 'function' ? computeDayFreeGaps(day, settings, now) : null;

  if(query === 'missed')return assistantAnswerMissed(context, select, args);

  if(query === 'freest'){
    if(!week || typeof computeDayFreeGaps !== 'function')return {ok:true, text:'I could not read this week\'s plan yet — open the home view once, then ask again.'};
    const ranked = (week.days || []).map(item => {
      const info = computeDayFreeGaps(item, settings, now);
      const label = item.isToday ? 'today' : (ASSISTANT_WEEKDAY_LABELS[new Date(item.dayBase).getDay()] || '');
      return {label, free:info.totalFreeMinutes, largest:info.largestGapMinutes};
    }).filter(item => item.label);
    if(!ranked.length)return {ok:true, text:'This week\'s plan is empty, so every day is open.'};
    ranked.sort((a,b) => b.free - a.free || b.largest - a.largest);
    const best = ranked[0];
    const rest = ranked.slice(1).map(item => `${item.label} ${assistantQueryDurationText(item.free)}`).join(', ');
    return {ok:true, text:`${best.label.charAt(0).toUpperCase() + best.label.slice(1)} looks freest — ${assistantQueryDurationText(best.free)} open, longest stretch ${assistantQueryDurationText(best.largest)}.${rest ? ` Then: ${rest}.` : ''}`};
  }

  if(query === 'day' || query === 'week'){
    if(query === 'week'){
      if(!week || typeof computeDayFreeGaps !== 'function')return {ok:true, text:'I could not read this week\'s plan yet — open the home view once, then ask again.'};
      const lines = (week.days || []).map(item => {
        const info = computeDayFreeGaps(item, settings, now);
        const rows = assistantQueryDayRows(item, data);
        const label = item.isToday ? 'Today' : (ASSISTANT_WEEKDAY_LABELS[new Date(item.dayBase).getDay()] || '');
        return `${label}: ${rows.length ? `${rows.length} planned, ` : 'nothing planned, '}${assistantQueryDurationText(info.totalFreeMinutes)} open`;
      });
      return {ok:true, text:`Your week: ${lines.join(' · ')}.`};
    }
    const rows = assistantQueryDayRows(day, data);
    if(!rows.length){
      const empty = assistantApplyItemQuery([], assistantScheduleAnalysisArgs(args, select), `item in ${dayLabel}'s agenda`);
      return empty.ok ? empty : {ok:true, text:`Nothing is planned on ${dayLabel}.`, items:[]};
    }
    const free = gapsInfo ? ` ${assistantQueryDurationText(gapsInfo.totalFreeMinutes)} stays open.` : '';
    const items = assistantQueryRowFacts(rows, context);
    const queried = assistantApplyItemQuery(items, assistantScheduleAnalysisArgs(args, select), `item in ${dayLabel}'s agenda`);
    if(queried.ok)return queried;
    if(!queried.rows.length)return {ok:true, text:`Nothing on ${dayLabel}'s agenda matches the query.`, items:[]};
    return {
      ok:true,
      items:queried.rows,
      text:`${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}: ${queried.rows.map(item => `${item.clock || ''} ${item.name}`.trim()).join(', ')}.${free}`
    };
  }

  // free / conflict need the window (conflict always, free only for the
  // window form — a bare "free" answers the whole day).
  const window = assistantQueryWindow(args, dayBase);
  if(!window){
    if(query === 'conflict')return {ok:true, text:`Tell me the time window, like "tomorrow 5 to 6 pm", and I will check what it would displace. ${assistantQueryCapabilities()}`};
    if(!gapsInfo)return {ok:true, text:'I could not read the plan for that day yet — open the home view once, then ask again.'};
    const requestedMinutes = Math.round(Number(args && args.minutes));
    if(Number.isFinite(requestedMinutes) && requestedMinutes > 0){
      const fitting = gapsInfo.gaps.find(gap => Math.round((gap.end - gap.start) / 60000) >= requestedMinutes);
      if(fitting){
        const start = assistantFriendlyClock((fitting.start - dayBase) / 60000);
        const end = assistantFriendlyClock((fitting.end - dayBase) / 60000);
        return {ok:true, text:`Yes — ${dayLabel} has a contiguous ${assistantQueryDurationText(requestedMinutes)} opening from ${start} to ${end}.`};
      }
      return {ok:true, text:`No single ${assistantQueryDurationText(requestedMinutes)} block is open on ${dayLabel}; the longest stretch is ${assistantQueryDurationText(gapsInfo.largestGapMinutes)}.`};
    }
    return {ok:true, text:`${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} has ${assistantQueryDurationText(gapsInfo.totalFreeMinutes)} open across ${gapsInfo.gaps.length} gap${gapsInfo.gaps.length === 1 ? '' : 's'}; the longest stretch is ${assistantQueryDurationText(gapsInfo.largestGapMinutes)}.`};
  }
  if(!gapsInfo)return {ok:true, text:'I could not read the plan for that day yet — open the home view once, then ask again.'};
  const duration = Math.round((window.end - window.start) / 60000);
  const rows = assistantQueryDayRows(day, data);
  const inWindow = assistantQueryRowsInWindowText(rows, window.start, window.end);
  const clockLabel = `${assistantFriendlyClock((window.start - dayBase) / 60000)}–${assistantFriendlyClock((window.end - dayBase) / 60000)}`;
  const weatherLine = () => {
    const period = typeof weatherPeriodSummary === 'function'
      ? weatherPeriodSummary(window.start, window.end, settings, null, now)
      : null;
    if(!period)return '';
    const temps = assistantWeatherNumbers(settings);
    return ` Weather then: ${period.condition ? period.condition.label : 'clear'}, ${Number.isFinite(period.precipitationChance) ? Math.round(period.precipitationChance) : 0}% rain chance, ${Math.round(temps.convert(period.low))}–${Math.round(temps.convert(period.high))}${temps.unit}.`;
  };

  if(query === 'free'){
    const overlap = typeof freeWindowOverlapMinutes === 'function'
      ? freeWindowOverlapMinutes(gapsInfo.gaps, window.start, window.end)
      : 0;
    if(overlap >= duration){
      return {ok:true, text:`Yes — ${clockLabel} on ${dayLabel} is open${inWindow ? ` (around: ${inWindow})` : ''}.${weatherLine()}`};
    }
    const busy = inWindow ? ` ${inWindow} ${duration === 1 ? 'sits' : 'sit'} in that window.` : ' It is mostly taken.';
    return {ok:true, text:`Only ${assistantQueryDurationText(overlap)} of ${assistantQueryDurationText(duration)} is open at ${clockLabel} on ${dayLabel}.${busy}`};
  }

  // conflict: what would blocking this window do to the rest of the plan?
  if(typeof computeFreeWindowVerdict !== 'function' || !gapsInfo){
    return {ok:true, text:'I could not run the what-if check yet — open the home view once, then ask again.'};
  }
  const verdict = await computeFreeWindowVerdict(gapsInfo, window.start, window.end);
  const prefix = `${clockLabel} on ${dayLabel}`;
  if(verdict.tone === 'open'){
    return {ok:true, text:`Nothing to miss — ${prefix} is completely open, so a task there would not displace anything.${weatherLine()}`};
  }
  if(verdict.tone === 'blocked'){
    return {ok:true, text:`No — ${prefix} overlaps ${verdict.fixed.name}, which is fixed on the day. Blocking it would clash right away.`};
  }
  if(verdict.tone === 'possible'){
    const detail = verdict.movedNames.length ? ` The planner would shift ${verdict.movedNames.join(' and ')} within ${dayLabel}, but nothing gets lost.` : ' Everything else keeps its day.';
    return {ok:true, text:`You would not miss anything — ${prefix} is tight but the planner can absorb it.${detail}${weatherLine()}`};
  }
  const laterNames = (verdict.later || []).map(row => row.name);
  if(laterNames.length){
    const first = verdict.later[0];
    const more = verdict.later.length > 1 ? ` and ${verdict.later.length - 1} more` : '';
    return {ok:true, text:`Yes — blocking ${prefix} would move ${first.name}${more} to ${String(first.dayLabel || 'a later day').toLowerCase()}. Skip it or pick another window if that matters.${weatherLine()}`};
  }
  const pushed = (verdict.unscheduled || []).slice(0, 2).join(' and ') || 'planned work';
  return {ok:true, text:`Yes — blocking ${prefix} would push ${pushed} off ${dayLabel} entirely. It would go unplanned, not just later.`};
}

function assistantEndpointFromHabit(habit, prefix){
  if(!habit)return {kind:'unset'};
  const role = prefix === 'start' ? 'allowedTimeStart'
    : prefix === 'end' ? 'allowedTimeEnd'
    : prefix;
  const anchor = habit[role + 'Anchor'];
  const offset = habit[role + 'OffsetMin'];
  const minutes = habit[role];
  const habitId = habit[role + 'AnchorHabitId'];
  let end;
  if(anchor === 'habit' && habitId){
    end = {
      kind:'habit',
      habitId,
      offsetMin:typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : (offset || 0)
    };
  }else if(anchor){
    end = {
      kind:'anchor',
      anchor,
      offsetMin:typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : (offset || 0)
    };
  }else if(minutes != null && Number.isFinite(Number(minutes))){
    const mins = Number(minutes);
    end = {kind:'clock', minutes:mins, clock:assistantClockLabel(mins)};
  }else{
    end = {kind:'unset'};
  }
  const dayOffset = Number(habit[role + 'DayOffset']) === 1 ? 1 : 0;
  if(dayOffset)end.dayOffset = 1;
  const combine = typeof cleanTimeCombine === 'function'
    ? cleanTimeCombine(habit[role + 'Combine'])
    : (habit[role + 'Combine'] === 'later' || habit[role + 'Combine'] === 'earlier' ? habit[role + 'Combine'] : null);
  const anchor2 = habit[role + 'Anchor2'];
  if(combine && anchor2){
    let second;
    if(anchor2 === 'fixed'){
      const fixed = Number(habit[role + 'FixedMin2']);
      second = {kind:'clock', minutes:fixed, clock:assistantClockLabel(fixed)};
    }else if(anchor2 === 'habit'){
      second = {
        kind:'habit',
        habitId:habit[role + 'AnchorHabitId2'],
        offsetMin:typeof normalizePrayerOffset === 'function'
          ? normalizePrayerOffset(habit[role + 'OffsetMin2'])
          : (habit[role + 'OffsetMin2'] || 0)
      };
    }else{
      second = {
        kind:'anchor',
        anchor:anchor2,
        offsetMin:typeof normalizePrayerOffset === 'function'
          ? normalizePrayerOffset(habit[role + 'OffsetMin2'])
          : (habit[role + 'OffsetMin2'] || 0)
      };
    }
    if(Number(habit[role + 'DayOffset2']) === 1)second.dayOffset = 1;
    end.combine = combine;
    end.second = second;
  }
  return end;
}

function assistantClearEndpointFields(record, prefix){
  record[prefix] = null;
  record[prefix + 'Anchor'] = null;
  record[prefix + 'OffsetMin'] = 0;
  record[prefix + 'AnchorHabitId'] = null;
  record[prefix + 'Combine'] = null;
  record[prefix + 'Anchor2'] = null;
  record[prefix + 'OffsetMin2'] = 0;
  record[prefix + 'AnchorHabitId2'] = null;
  record[prefix + 'FixedMin2'] = null;
  record[prefix + 'DayOffset'] = 0;
  record[prefix + 'DayOffset2'] = 0;
}

function assistantWriteEndpointToRecord(record, prefix, end, data){
  assistantClearEndpointFields(record, prefix);
  if(!end || end.kind === 'unset')return;
  let resolved = end;
  if(end.kind === 'habit' && !end.habitId && data){
    const found = assistantFindHabit(data, end.habitName);
    if(found && found.ok){
      resolved = Object.assign({}, end, {habitId:found.hid, habitName:found.name});
    }
  }
  if(resolved.kind === 'clock')record[prefix] = resolved.minutes;
  else if(resolved.kind === 'anchor'){
    record[prefix + 'Anchor'] = resolved.anchor;
    record[prefix + 'OffsetMin'] = resolved.offsetMin || 0;
  }else if(resolved.kind === 'habit' && resolved.habitId){
    record[prefix + 'Anchor'] = 'habit';
    record[prefix + 'AnchorHabitId'] = resolved.habitId;
    record[prefix + 'OffsetMin'] = resolved.offsetMin || 0;
  }
  if(resolved.dayOffset === 1)record[prefix + 'DayOffset'] = 1;
  if(resolved.combine && resolved.second){
    const second = resolved.second;
    record[prefix + 'Combine'] = resolved.combine;
    if(second.kind === 'clock'){
      record[prefix + 'Anchor2'] = 'fixed';
      record[prefix + 'FixedMin2'] = second.minutes;
    }else if(second.kind === 'anchor'){
      record[prefix + 'Anchor2'] = second.anchor;
      record[prefix + 'OffsetMin2'] = second.offsetMin || 0;
    }else if(second.kind === 'habit'){
      let hid = second.habitId;
      if(!hid && data && second.habitName){
        const found = assistantFindHabit(data, second.habitName);
        if(found && found.ok)hid = found.hid;
      }
      if(hid){
        record[prefix + 'Anchor2'] = 'habit';
        record[prefix + 'AnchorHabitId2'] = hid;
        record[prefix + 'OffsetMin2'] = second.offsetMin || 0;
      }
    }
    if(second.dayOffset === 1)record[prefix + 'DayOffset2'] = 1;
  }
}

function assistantWriteWindowToRecord(record, window, role, data){
  const startPrefix = role === 'preferred' ? 'preferredTimeStart' : 'allowedTimeStart';
  const endPrefix = role === 'preferred' ? 'preferredTimeEnd' : 'allowedTimeEnd';
  if(!window)return;
  assistantWriteEndpointToRecord(record, startPrefix, window.start, data);
  assistantWriteEndpointToRecord(record, endPrefix, window.end, data);
}

function assistantHabitToDraft(habit, index, settings, data){
  const draft = assistantEmptyDraft();
  if(!habit)return draft;
  draft.kind = habit.type === 'task' ? 'task' : 'habit';
  draft.habitKind = habit.type === 'task' ? null : habit.type;
  draft.name = String(habit.name || '').slice(0, ASSISTANT_NAME_MAX);
  draft.hid = habit.hid;
  draft.index = index;
  draft.emoji = habit.emoji || '';
  draft.emojiBgColor = habit.emojiBgColor || '';
  draft.durationMinutes = habit.durationMinutes != null ? habit.durationMinutes : null;
  draft.priority = habit.priority != null ? habit.priority : null;
  draft.topics = Array.isArray(habit.topics) ? habit.topics.slice() : [];
  if(draft.kind === 'task'){
    draft.dueDate = habit.dueDate != null ? habit.dueDate : null;
    draft.hardDue = Boolean(habit.hardDue);
    if(habit.eventTime != null){
      const when = new Date(habit.eventTime);
      if(Number.isFinite(when.getTime())){
        draft.dueTime = assistantClockLabel(when.getHours() * 60 + when.getMinutes());
      }
    }
  }else if(typeof rhythmParts === 'function' && habit.target != null){
    const parts = rhythmParts(habit.target);
    draft.timesPerPeriod = parts.times;
    draft.periodDays = parts.days;
  }
  if(draft.kind === 'habit'){
    draft.allowedWeekdays = Array.isArray(habit.allowedWeekdays) ? habit.allowedWeekdays.slice() : [];
    draft.allowedMonthDays = Array.isArray(habit.allowedMonthDays) ? habit.allowedMonthDays.slice() : [];
    draft.preferredWeekdays = Array.isArray(habit.preferredWeekdays) ? habit.preferredWeekdays.slice() : [];
    draft.preferredMonthDays = Array.isArray(habit.preferredMonthDays) ? habit.preferredMonthDays.slice() : [];
    draft.planByDate = habit.planByDate != null ? habit.planByDate : null;
  }
  const start = assistantEndpointFromHabit(habit, 'allowedTimeStart');
  const end = assistantEndpointFromHabit(habit, 'allowedTimeEnd');
  if(start.kind !== 'unset' || end.kind !== 'unset'){
    draft.window = {start, end};
  }
  const prefStart = assistantEndpointFromHabit(habit, 'preferredTimeStart');
  const prefEnd = assistantEndpointFromHabit(habit, 'preferredTimeEnd');
  if(prefStart.kind !== 'unset' || prefEnd.kind !== 'unset'){
    draft.preferredWindow = {start:prefStart, end:prefEnd};
  }
  if(habit.weatherProfileMode && habit.weatherProfileMode !== 'inherit'){
    const profiles = (settings && settings.weatherProfiles) || [];
    const profile = profiles.find(item => item && item.id === habit.weatherProfileId);
    draft.weather = {
      mode:habit.weatherProfileMode,
      profileId:habit.weatherProfileMode === 'profile' ? habit.weatherProfileId : null,
      name:profile ? profile.name : null
    };
  }
  const locs = (settings && settings.locations) || [];
  if(Array.isArray(habit.locationIds) && habit.locationIds.length){
    const names = habit.locationIds.map(id => {
      const loc = locs.find(item => item && item.id === id);
      return loc && loc.name;
    }).filter(Boolean);
    draft.places = {ids:habit.locationIds.slice(), names, anywhere:Boolean(habit.anywhereAllowed)};
  }else{
    draft.places = {ids:[], names:[], anywhere:habit.anywhereAllowed !== false};
  }
  draft.locationPrefs = habit.locationPrefs && typeof habit.locationPrefs === 'object' ? Object.assign({}, habit.locationPrefs) : {};
  draft.earlyWindowDays = habit.earlyWindowDays != null ? habit.earlyWindowDays : null;
  draft.delayAllowanceDays = habit.delayAllowanceDays != null ? habit.delayAllowanceDays : null;
  draft.breakable = Boolean(habit.breakable);
  draft.minChunkMinutes = habit.minChunkMinutes != null ? habit.minChunkMinutes : null;
  draft.autoMarkMinutes = habit.autoMarkMinutes !== undefined ? habit.autoMarkMinutes : null;
  draft.trackValue = Boolean(habit.trackValue);
  draft.pinned = Boolean(habit.pinned);
  draft.snoozedUntil = habit.snoozedUntil || null;
  draft.showOnSharedDisplay = habit.showOnSharedDisplay !== false;
  draft.allowSharedDisplayCompletion = habit.allowSharedDisplayCompletion !== false;
  draft.showWeather = Boolean(habit.showWeather);
  draft.showWeatherAtLocation = Boolean(habit.showWeatherAtLocation);
  draft.weatherLocationId = habit.weatherLocationId || null;
  if(draft.weatherLocationId){
    const loc = locs.find(item => item && item.id === draft.weatherLocationId);
    draft.weatherLocationName = loc && loc.name || null;
  }
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  draft.scheduleLinks = (Array.isArray(habit.scheduleLinks) ? habit.scheduleLinks : []).map(link => {
    const other = list.find(item => item && item.hid === link.anchorHid);
    return {
      name:other && other.name || '',
      anchorHid:link.anchorHid,
      direction:link.direction,
      adjacency:link.adjacency || 'sometime',
      requireSameDay:Boolean(link.requireSameDay)
    };
  });
  draft.scheduleOptions = Array.isArray(habit.scheduleOptions) ? habit.scheduleOptions.slice() : [];
  draft.links = Array.isArray(habit.links) ? habit.links.slice() : [];
  return draft;
}

function assistantPatchDraftFromParsed(draft, parsed, catalog, settings){
  if(!draft || !parsed)return draft;
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)){
    if(parsed.newName)draft.name = typeof assistantTitleName === 'function' ? assistantTitleName(parsed.newName, 32) : String(parsed.newName).slice(0, 32);
    if(draft.kind === 'weather'){
      assistantProposeWeather(draft, {name:draft.name, text:parsed.text || parsed.weatherText || ''}, catalog, settings);
    }
    if(draft.kind === 'busy' && parsed.window)draft.window = parsed.window;
    if(draft.kind === 'location' && parsed.address)draft.address = parsed.address;
    return draft;
  }
  if(parsed.newName)draft.name = String(parsed.newName).slice(0, ASSISTANT_NAME_MAX);
  if(parsed.durationMinutes != null){
    draft.durationMinutes = typeof clampDuration === 'function'
      ? clampDuration(parsed.durationMinutes)
      : parsed.durationMinutes;
  }
  if(draft.kind === 'task'){
    if(parsed.dueTs != null)draft.dueDate = parsed.dueTs;
    if(parsed.dueTime)draft.dueTime = parsed.dueTime;
  }
  if(draft.kind === 'habit' && parsed.rhythm){
    draft.timesPerPeriod = parsed.rhythm.timesPerPeriod;
    draft.periodDays = parsed.rhythm.periodDays;
    if(parsed.rhythm.weekdays)draft.allowedWeekdays = parsed.rhythm.weekdays.slice();
    else draft.allowedWeekdays = [];
  }
  if(parsed.priority != null)draft.priority = parsed.priority;
  if(parsed.window)draft.window = parsed.window;
  if(parsed.places && parsed.places.length){
    const applied = assistantApplyPlace(draft, {names:parsed.places, anywhere:false}, catalog);
    if(applied && applied.ok)Object.assign(draft, applied.draft);
  }
  if(parsed.weather){
    const applied = assistantApplyWeather(draft, {mode:'profile', profile:parsed.weather}, catalog);
    if(applied && applied.ok)Object.assign(draft, applied.draft);
  }else if(parsed.weatherHints && parsed.weatherHints.mentioned){
    const had = draft.weather;
    draft.weather = null;
    if(typeof assistantAttachParsedWeather === 'function'){
      assistantAttachParsedWeather(draft, parsed, catalog, settings);
    }
    if(!draft.weather)draft.weather = had;
  }
  return draft;
}

function assistantEmptySetting(kind){
  return {
    kind:kind || null,
    name:'',
    settingId:null,
    weatherProposed:null,
    weather:null,
    address:'',
    lat:null,
    lng:null,
    window:null,
    allowedWeekdays:null
  };
}

function assistantBusyFromWindow(window){
  const block = {start:900, end:960};
  if(!window || typeof window !== 'object')return block;
  const applyEnd = (end, prefix) => {
    if(!end || end.kind === 'unset')return;
    if(end.kind === 'clock' && end.minutes != null)block[prefix] = end.minutes;
    if(end.kind === 'anchor' && end.anchor){
      block[prefix + 'Anchor'] = end.anchor;
      block[prefix + 'OffsetMin'] = end.offsetMin || 0;
      if(block[prefix] == null)block[prefix] = prefix === 'start' ? 0 : 1200;
    }
    if(end.combine && end.second){
      block[prefix + 'Combine'] = end.combine;
      if(end.second.kind === 'clock'){
        block[prefix + 'Anchor2'] = 'fixed';
        block[prefix + 'FixedMin2'] = end.second.minutes;
      }else if(end.second.kind === 'anchor'){
        block[prefix + 'Anchor2'] = end.second.anchor;
        block[prefix + 'OffsetMin2'] = end.second.offsetMin || 0;
      }
    }
  };
  applyEnd(window.start, 'start');
  applyEnd(window.end, 'end');
  if(block.start === block.end)block.end = (block.start + 60) % 1440;
  return block;
}

function assistantSavedLocationByName(name, settings){
  const locs = Array.isArray(settings && settings.locations) ? settings.locations : [];
  const rows = locs.map(loc => ({
    id:loc && loc.id,
    name:loc && loc.name,
    address:loc && loc.address,
    lat:loc && loc.lat,
    lng:loc && loc.lng
  })).filter(row => row && row.name);
  const match = assistantMatchByName(rows, name);
  return match && match.ok ? match.item : null;
}

// A place drafted only so a later item change can use it must be resolvable
// in this turn. Placeholder coordinates let confirm save it; commit then
// rebinds item place names to the saved id.
function assistantExposeLocationDraft(draft, catalog, settings){
  if(!draft || draft.kind !== 'location' || !draft.name || !catalog)return draft;
  const places = Array.isArray(catalog.places) ? catalog.places : [];
  const match = assistantMatchByName(places, draft.name);
  if(match.ok && match.item && match.item.id){
    if(String(match.item.id).indexOf('pending-loc-') === 0)draft.settingId = match.item.id;
    catalog.places = places;
    return draft;
  }
  const id = `pending-loc-${places.length + 1}`;
  if(!Number.isFinite(Number(draft.lat)) || !Number.isFinite(Number(draft.lng))){
    const coords = assistantPlaceholderCoords(settings, places.length);
    draft.lat = coords.lat;
    draft.lng = coords.lng;
  }
  draft.settingId = id;
  places.push({id, name:draft.name});
  catalog.places = places;
  return draft;
}

function assistantApplyDraftSetting(args, draft, catalog, now, settings, requestText, opts){
  const raw = args || {};
  let kind = typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(raw.kind)
    ? raw.kind
    : (draft && assistantIsSettingKind(draft.kind) ? draft.kind : null);
  if(!kind)return {ok:false, error:'kind must be weather, location, busy, or topic'};
  const next = draft && draft.kind === kind ? Object.assign({}, draft) : assistantEmptySetting(kind);
  let name = String(raw.newName || raw.name || next.name || '').trim();
  if(typeof assistantIsPronounName === 'function' && assistantIsPronounName(name))name = next.name;
  if(!name)return {ok:false, error:'name is required'};
  const max = kind === 'busy' ? 24 : (kind === 'location' ? 48 : 32);
  next.kind = kind;
  next.name = typeof assistantTitleName === 'function' ? assistantTitleName(name, max) : name.slice(0, max);
  if(kind === 'weather'){
    const text = assistantJoinWeatherText(raw.weatherText, requestText);
    assistantProposeWeather(next, {name:next.name, text}, catalog, settings);
    if(next.weatherProposed)next.weatherProposed.name = next.name;
    if(next.weather)next.weather.name = next.name;
    const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
    const profiles = typeof normalizeWeatherProfiles === 'function'
      ? normalizeWeatherProfiles(settings && settings.weatherProfiles)
      : ((settings && settings.weatherProfiles) || []);
    if(!next.settingId && !next.weatherProposed && profiles.length >= cap){
      next.weatherNeedAsk = assistantWeatherCapAsk(profiles);
    }
  }else if(kind === 'location'){
    const saved = assistantSavedLocationByName(next.name, settings);
    if(saved && opts && opts.reuseSavedPlace){
      return {
        ok:true,
        existing:true,
        name:saved.name,
        text:`${saved.name} is already a saved place.`
      };
    }
    if(raw.address != null && String(raw.address).trim())next.address = String(raw.address).trim().slice(0, 120);
    const lat = raw.lat != null ? Number(raw.lat) : next.lat;
    const lng = raw.lng != null ? Number(raw.lng) : next.lng;
    if(Number.isFinite(lat))next.lat = lat;
    if(Number.isFinite(lng))next.lng = lng;
    if(!saved && opts && opts.reuseSavedPlace && opts.catalog){
      assistantExposeLocationDraft(next, opts.catalog, settings);
    }
  }else if(kind === 'busy'){
    const windowSource = typeof raw.windowText === 'string' && raw.windowText.trim()
      ? raw.windowText
      : raw.window;
    if(typeof windowSource === 'string' && typeof assistantParseWindowFromText === 'function'){
      const window = assistantParseWindowFromText(windowSource);
      if(window)next.window = window;
    }else if(windowSource && typeof windowSource === 'object' && !Array.isArray(windowSource)){
      next.window = windowSource;
    }else if(requestText && typeof assistantParseWindowFromText === 'function'){
      const window = assistantParseWindowFromText(requestText);
      if(window)next.window = window;
    }
    if(raw.days != null && typeof assistantNormalizeWeekdaysArg === 'function'){
      const days = assistantNormalizeWeekdaysArg(raw.days);
      if(days)next.allowedWeekdays = days;
    }
  }
  return {ok:true, draft:next};
}

function assistantCommitWeatherSetting(draft, settings){
  if(draft.weatherProposed || !draft.settingId){
    const made = assistantMaterializeWeatherProfile(draft, settings);
    if(!made){
      const profiles = typeof normalizeWeatherProfiles === 'function'
        ? normalizeWeatherProfiles(settings && settings.weatherProfiles)
        : ((settings && settings.weatherProfiles) || []);
      const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
      if(profiles.length >= cap)return {ok:false, error:`${cap} weather profiles max`};
      return {ok:false, error:'could not save weather profile'};
    }
    draft.settingId = made.id;
    draft.weather = {mode:'profile', profileId:made.id, name:made.name};
    draft.name = made.name;
  }
  return {ok:true, draft, name:draft.name, setting:'weather', settingId:draft.settingId};
}

function assistantCommitLocationSetting(draft, settings){
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){
    return {ok:false, error:'Look up the address first, or give coordinates.'};
  }
  const locations = typeof normalizeLocationRegistry === 'function'
    ? normalizeLocationRegistry(settings && settings.locations)
    : ((settings && settings.locations) || []).slice();
  const cap = typeof MAX_LOCATIONS === 'number' ? MAX_LOCATIONS : 32;
  if(draft.settingId){
    const i = locations.findIndex(loc => loc && loc.id === draft.settingId);
    if(i >= 0){
      locations[i] = {
        ...locations[i],
        name:draft.name,
        address:String(draft.address || locations[i].address || '').slice(0, 120),
        lat, lng
      };
      assistantPersistSettings({locations});
      return {ok:true, draft, name:draft.name, setting:'location', settingId:draft.settingId, updated:true};
    }
  }
  if(locations.length >= cap)return {ok:false, error:`limit ${cap} locations`};
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  locations.push({
    id,
    name:draft.name,
    address:String(draft.address || '').slice(0, 120),
    lat, lng,
    emoji:'',
    radiusM:typeof DEFAULT_LOCATION_RADIUS_M === 'number' ? DEFAULT_LOCATION_RADIUS_M : 75,
    weatherProfileId:null
  });
  assistantPersistSettings({locations});
  draft.settingId = id;
  return {ok:true, draft, name:draft.name, setting:'location', settingId:id};
}

function assistantCommitBusySetting(draft, settings){
  const blocks = typeof normalizeBlockedTimes === 'function'
    ? normalizeBlockedTimes(settings && settings.blockedTimes)
    : ((settings && settings.blockedTimes) || []).slice();
  const clocks = assistantBusyFromWindow(draft.window);
  const row = Object.assign({
    label:String(draft.name || 'busy').slice(0, 24),
    days:Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays.slice() : []
  }, clocks);
  if(draft.settingId != null && blocks[draft.settingId]){
    blocks[draft.settingId] = Object.assign({}, blocks[draft.settingId], row);
    assistantPersistSettings({blockedTimes:blocks});
    return {ok:true, draft, name:draft.name, setting:'busy', settingId:draft.settingId, updated:true};
  }
  if(blocks.length >= 24)return {ok:false, error:'24 busy times max'};
  blocks.push(row);
  assistantPersistSettings({blockedTimes:blocks});
  draft.settingId = blocks.length - 1;
  return {ok:true, draft, name:draft.name, setting:'busy', settingId:draft.settingId};
}

function assistantCommitTopicSetting(draft, settings){
  const current = typeof normalizeTopics === 'function'
    ? normalizeTopics(settings && settings.topics)
    : ((settings && settings.topics) || []).slice();
  const next = typeof normalizeTopics === 'function'
    ? normalizeTopics(current.concat([draft.name]))
    : current.concat([draft.name]);
  if(next.length === current.length && next.every((topic, i) => topic === current[i])){
    draft.settingId = draft.name;
    return {ok:true, draft, name:draft.name, setting:'topic', settingId:draft.name, updated:true};
  }
  assistantPersistSettings({topics:next});
  draft.settingId = draft.name;
  return {ok:true, draft, name:draft.name, setting:'topic', settingId:draft.name};
}

function assistantCommitSetting(draft){
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  if(draft.kind === 'weather')return assistantCommitWeatherSetting(draft, settings);
  if(draft.kind === 'location')return assistantCommitLocationSetting(draft, settings);
  if(draft.kind === 'busy')return assistantCommitBusySetting(draft, settings);
  if(draft.kind === 'topic')return assistantCommitTopicSetting(draft, settings);
  return {ok:false, error:'unknown setting'};
}

function assistantNormalizePlaceNamesArg(value){
  if(value == null || value === '')return [];
  if(Array.isArray(value))return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value).split(/,|&|\band\b/i).map(part => part.trim()).filter(Boolean);
}

function assistantBatchItemUnscheduled(item){
  if(!item || typeof item !== 'object')return true;
  if(!String(item.name || '').trim())return true;
  const windowText = String(item.windowText || item.dueTime || '').trim();
  if(/^(to be announced|tba)$/i.test(windowText)){
    const rhythm = String(item.rhythm || '').trim();
    const weekdays = item.weekdays != null && String(item.weekdays).trim();
    const due = String(item.due || '').trim();
    if(!weekdays && !rhythm && !due)return true;
  }
  return false;
}

function assistantWorkingCatalog(catalog){
  const src = catalog || {};
  return Object.assign({}, src, {
    places:Array.isArray(src.places) ? src.places.map(item => Object.assign({}, item)) : []
  });
}

function assistantApplyDraftBatch(args, session, context){
  const rawPlaces = Array.isArray(args && args.places) ? args.places : [];
  const rawItems = Array.isArray(args && args.items) ? args.items : [];
  const cap = typeof ASSISTANT_BATCH_MAX === 'number' ? ASSISTANT_BATCH_MAX : 24;
  if(!rawItems.length)return {ok:false, error:'items is required'};
  const items = rawItems.filter(item => !assistantBatchItemUnscheduled(item));
  if(!items.length)return {ok:false, error:'every row was unscheduled (no days or times)'};
  if(rawPlaces.length + items.length > cap)return {ok:false, error:`${cap} rows max`};
  const catalog = assistantWorkingCatalog(context && context.catalog);
  const settings = (context && context.settings) || {};
  session.pendingPlaces = [];
  session.drafts = [];
  session.bulk = true;
  rawPlaces.forEach(row => {
    if(!row || !row.name)return;
    assistantEnsurePlaceholderPlace(row.name, row.address, session, catalog, settings);
  });
  items.forEach(item => {
    assistantNormalizePlaceNamesArg(item && item.placeNames).forEach(name => {
      assistantEnsurePlaceholderPlace(name, null, session, catalog, settings);
    });
  });
  const drafts = (session.pendingPlaces || []).slice();
  const itemOpts = {placeholders:true, session, settings, skipSalvage:true};
  for(const item of items){
    const applied = assistantApplyDraftItem(
      item,
      null,
      catalog,
      context && context.now,
      settings,
      context && context.data,
      '',
      itemOpts
    );
    if(!applied.ok)return applied;
    if(applied.draft && applied.draft.name)drafts.push(applied.draft);
  }
  if(!drafts.length)return {ok:false, error:'nothing to add'};
  session.drafts = drafts;
  session.draft = drafts.find(row => row.kind === 'habit' || row.kind === 'task') || drafts[0];
  return {ok:true, drafts, draft:session.draft};
}

function assistantLinkStagedWeather(session, draft){
  if(!session || !draft || draft.kind === 'weather')return draft;
  const wanted = String(
    (draft.weather && draft.weather.name)
    || (draft.weatherProposed && draft.weatherProposed.name)
    || ''
  ).trim();
  if(!wanted)return draft;
  if(draft.weather && draft.weather.profileId && !draft.weather.pending)return draft;
  const pool = []
    .concat(Array.isArray(session.turnDrafts) ? session.turnDrafts : [])
    .concat(Array.isArray(session.drafts) ? session.drafts : []);
  const staged = pool.find(row => row && row.kind === 'weather' && row.weatherProposed
    && typeof assistantNamesMatch === 'function' && assistantNamesMatch(row.name, wanted));
  if(!staged)return draft;
  const proposed = staged.weatherProposed || {};
  draft.weatherProposed = {
    name:staged.name,
    rules:Array.isArray(proposed.rules) ? proposed.rules.map(rule => Object.assign({}, rule)) : [],
    hints:proposed.hints || {}
  };
  draft.weather = {
    mode:'profile',
    profileId:staged.settingId || null,
    name:staged.name,
    pending:!staged.settingId
  };
  draft.weatherNeedAsk = null;
  return draft;
}

function assistantRelinkStagedWeather(session){
  if(!session)return;
  const rows = []
    .concat(Array.isArray(session.turnDrafts) ? session.turnDrafts : [])
    .concat(Array.isArray(session.drafts) ? session.drafts : []);
  rows.forEach(row => {
    if(row && row.kind !== 'weather')assistantLinkStagedWeather(session, row);
  });
}

function assistantBindSavedWeather(item){
  if(!item || item.kind === 'weather' || !item.weather || !item.weather.name)return item;
  if(item.weather.profileId && !item.weather.pending)return item;
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const found = typeof assistantFindWeatherProfile === 'function'
    ? assistantFindWeatherProfile(item.weather.name, null, settings, null)
    : null;
  if(!found)return item;
  item.weather = {mode:'profile', profileId:found.id, name:found.name};
  item.weatherProposed = null;
  item.weatherNeedAsk = null;
  return item;
}

function assistantPreflightApplyDrafts(rows){
  const guarded = (Array.isArray(rows) ? rows : []).filter(row => row && row.applySourceFingerprint);
  if(!guarded.length)return {ok:true};
  const data = typeof load === 'function' ? load() : [];
  const seen = new Set();
  for(const draft of guarded){
    const index = assistantDraftExistingIndex(data, draft);
    if(index < 0)return {ok:false, error:`${draft.name} is no longer on the list. Ask me to make the change again.`};
    const key = draft.hid || `index:${index}`;
    if(seen.has(key))return {ok:false, error:`${draft.name} appears more than once in this change.`};
    seen.add(key);
    const current = assistantHabitToDraft(data[index], index, typeof loadSortSettings === 'function' ? loadSortSettings() : {}, data);
    if(assistantDraftFingerprint(current) !== draft.applySourceFingerprint){
      return {ok:false, error:`${draft.name} changed after this preview. Ask me to make the change again.`};
    }
  }
  return {ok:true};
}

function assistantCommitDrafts(drafts){
  const rows = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
  if(!rows.length)return {ok:false, error:'empty draft'};
  // Validate every selected row before the first write. Without this pass a
  // stale second row could leave the first half of a bulk confirmation saved.
  const preflight = assistantPreflightApplyDrafts(rows);
  if(!preflight.ok)return preflight;
  if(rows.length === 1)return assistantCommitDraft(rows[0]);
  const places = rows.filter(row => row.kind === 'location');
  const items = rows.filter(row => row.kind === 'habit' || row.kind === 'task');
  const settingsRows = rows.filter(row => row.kind === 'weather' || row.kind === 'busy' || row.kind === 'topic');
  const others = rows.filter(row => row.kind !== 'location' && row.kind !== 'habit' && row.kind !== 'task'
    && row.kind !== 'weather' && row.kind !== 'busy' && row.kind !== 'topic');
  const saved = [];
  for(const place of places){
    const result = assistantCommitDraft(place);
    if(!result.ok)return result;
    saved.push(result);
  }
  for(const setting of settingsRows){
    const result = assistantCommitDraft(setting);
    if(!result.ok)return result;
    saved.push(result);
  }
  const context = typeof assistantBuildContext === 'function' ? assistantBuildContext() : null;
  const catalog = context && context.catalog;
  for(const item of items){
    assistantBindSavedWeather(item);
    if(item.places && Array.isArray(item.places.names) && item.places.names.length && catalog){
      const applied = assistantApplyPlace(item, {names:item.places.names, anywhere:Boolean(item.places.anywhere)}, catalog);
      if(applied.ok)Object.assign(item, applied.draft);
    }
    const result = assistantCommitDraft(item);
    if(!result.ok)return result;
    saved.push(result);
  }
  for(const other of others){
    const result = assistantCommitDraft(other);
    if(!result.ok)return result;
    saved.push(result);
  }
  const lastItem = saved.slice().reverse().find(row => row.habit) || saved[saved.length - 1];
  return {
    ok:true,
    saved,
    count:saved.length,
    places:places.length,
    items:items.length,
    habit:lastItem && lastItem.habit,
    index:lastItem && lastItem.index,
    draft:lastItem && lastItem.draft || items[items.length - 1] || places[places.length - 1],
    name:lastItem && (lastItem.habit && lastItem.habit.name || lastItem.name)
  };
}

function assistantApplyNameList(value){
  const max = typeof ASSISTANT_APPLY_MAX === 'number' ? ASSISTANT_APPLY_MAX : 40;
  if(value == null || value === '')return [];
  const rows = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
  return rows.map(item => String(item || '').trim()).filter(Boolean).slice(0, max);
}

function assistantApplyNameHits(query, title){
  if(typeof assistantNamesMatch === 'function' && assistantNamesMatch(query, title))return true;
  const needle = assistantNormText(query);
  const hay = assistantNormText(title);
  return needle.length >= 4 && hay.includes(needle);
}

function assistantRowsForNames(rows, names){
  const missed = [];
  const ambiguous = [];
  const picked = [];
  const seen = new Set();
  names.forEach(name => {
    // `names` is for titles copied from a verified list, not a broad search.
    // Prefer the exact title so "Walk" cannot silently expand to Evening Walk
    // and Walk dog. Only use the fuzzy matcher when it yields one unique row.
    const exact = (rows || []).filter(row => assistantNormText(row && row.name) === assistantNormText(name));
    const hits = exact.length ? exact : (rows || []).filter(row => assistantApplyNameHits(name, row && row.name));
    if(!hits.length)missed.push(name);
    if(hits.length > 1){
      ambiguous.push({name, matches:hits.map(row => row.name).filter(Boolean)});
      return;
    }
    hits.forEach(row => {
      const key = row.hid || row.name;
      if(seen.has(key))return;
      seen.add(key);
      picked.push(row);
    });
  });
  return {rows:picked, missed, ambiguous};
}

function assistantRowsForRecent(session, rows){
  const recent = session && session.recent && Array.isArray(session.recent.items) ? session.recent.items : [];
  const hids = new Set(recent.map(item => item && item.hid).filter(Boolean));
  const names = recent.map(item => assistantNormText(item && item.name)).filter(Boolean);
  return (rows || []).filter(row => (row.hid && hids.has(row.hid)) || names.includes(assistantNormText(row.name)));
}

function assistantApplyPatchKeys(){
  return Object.keys(typeof assistantApplyPatchProperties === 'function'
    ? assistantApplyPatchProperties()
    : {}).filter(key => key !== 'name' && key !== 'kind');
}

function assistantApplyHasPatch(spec){
  return assistantApplyPatchKeys().some(key => spec && spec[key] != null && spec[key] !== '');
}

function assistantApplyActionOf(spec){
  const named = assistantNormText(spec && spec.action);
  if(named === 'unsnooze')return 'show';
  if(named === 'edit' || named === 'delete' || named === 'snooze' || named === 'show')return named;
  if(spec && spec.snooze != null && String(spec.snooze).trim()){
    return /^(off|none|clear|show|unsnooze)$/.test(assistantNormText(spec.snooze)) ? 'show' : 'snooze';
  }
  if(assistantApplyHasPatch(spec))return 'edit';
  return '';
}

function assistantApplyIsNarrow(spec, action){
  if(!spec)return false;
  if(spec.fromRecent === true || spec.fromRecent === 'true')return true;
  if(assistantApplyNameList(spec.names).length)return true;
  if(String(spec.search || '').trim())return true;
  if(Array.isArray(spec.conditions) && spec.conditions.length)return true;
  if(Number(spec.position) > 0)return true;
  if(Number(spec.limit) > 0)return true;
  const status = assistantNormText(spec.status);
  if(status && status !== 'all')return true;
  const kind = assistantNormText(spec.kind);
  if((kind === 'task' || kind === 'habit') && action !== 'delete')return true;
  return false;
}

function assistantApplyMergedSelector(parent, group, universeReady){
  const spec = Object.assign({}, group || {});
  const keys = universeReady
    ? ['search','kind','status','names','fromRecent','conditions']
    : ['search','kind','status','names','fromRecent','conditions','sortBy','sortOrder','position','limit'];
  keys.forEach(key => {
    const empty = spec[key] == null || spec[key] === '' || (Array.isArray(spec[key]) && !spec[key].length);
    if(empty && parent && parent[key] != null && parent[key] !== '')spec[key] = parent[key];
  });
  if(parent && Array.isArray(parent.conditions) && parent.conditions.length
    && group && Array.isArray(group.conditions) && group.conditions.length){
    spec.conditions = parent.conditions.concat(group.conditions);
  }
  if(spec.fromRecent == null && parent && (parent.fromRecent === true || parent.fromRecent === 'true')){
    spec.fromRecent = true;
  }
  const groupHasPatch = assistantApplyHasPatch(group);
  const groupHasAction = Boolean(assistantNormText(group && group.action));
  if(!groupHasAction && parent && parent.action)spec.action = parent.action;
  if(!groupHasPatch && !groupHasAction){
    assistantApplyPatchKeys().forEach(key => {
      if((spec[key] == null || spec[key] === '') && parent && parent[key] != null && parent[key] !== ''){
        spec[key] = parent[key];
      }
    });
  }
  return spec;
}

function assistantResolveApplySet(spec, session, context, universe){
  let rows = Array.isArray(universe) ? universe.slice() : assistantCollectItemRows(context);
  if(spec && (spec.fromRecent === true || spec.fromRecent === 'true')){
    rows = assistantRowsForRecent(session, rows);
    if(!rows.length){
      return {ok:false, ask:'I do not have a previous list. Name a topic or the items.', error:'UNKNOWN'};
    }
  }
  const names = assistantApplyNameList(spec && spec.names);
  if(names.length){
    const named = assistantRowsForNames(rows, names);
    if(named.ambiguous.length){
      const first = named.ambiguous[0];
      return {
        ok:false,
        ask:`“${first.name}” matches more than one saved item: ${first.matches.join(', ')}. Use a full title or another filter.`,
        error:'AMBIGUOUS'
      };
    }
    if(named.missed.length){
      return {ok:false, ask:`I do not see ${named.missed.join(', ')} on your list.`, error:'UNKNOWN'};
    }
    rows = named.rows;
  }
  rows = assistantFilterCollectedRows(rows, spec);
  if(assistantNormText(spec && spec.aggregate)){
    return {ok:false, error:'apply_items selects items; leave aggregate off'};
  }
  const queried = assistantApplyItemQuery(rows, spec || {}, 'item', {all:true});
  const selected = queried.ok
    ? (Array.isArray(queried.items) ? queried.items : [])
    : (queried.rows || []);
  if(!selected.length){
    return {ok:false, ask:(queried.ok && queried.text) || 'No saved items match that.', error:'UNKNOWN'};
  }
  const max = typeof ASSISTANT_APPLY_MAX === 'number' ? ASSISTANT_APPLY_MAX : 40;
  if(selected.length > max){
    return {
      ok:false,
      ask:`That matches ${queried.total || selected.length} items. I can change up to ${max} at once — add a tighter filter or a limit.`,
      error:'TOO_MANY'
    };
  }
  return {ok:true, rows:selected};
}

function assistantApplyHabitAt(data, row){
  if(!Array.isArray(data) || !row)return null;
  if(row.hid){
    const byHid = data.find(item => item && item.hid === row.hid);
    if(byHid)return byHid;
  }
  if(row.index != null && data[row.index] && assistantNormText(data[row.index].name) === assistantNormText(row.name)){
    return data[row.index];
  }
  return data.find(item => item && assistantNormText(item.name) === assistantNormText(row.name)) || null;
}

function assistantApplyPatchFrom(spec, action){
  const patch = {};
  assistantApplyPatchKeys().forEach(key => {
    if(spec && spec[key] != null && spec[key] !== '')patch[key] = spec[key];
  });
  if(action === 'show')patch.snooze = patch.snooze || 'off';
  return patch;
}

function assistantApplyOneGroup(spec, rows, session, context, claimed, opts){
  const action = assistantApplyActionOf(spec);
  if(!action)return {ok:false, ask:'What should I change, snooze, or delete on that set?', error:'action required'};
  if(!(opts && opts.rest) && !assistantApplyIsNarrow(spec, action)){
    const verb = action === 'delete' ? 'remove' : 'change';
    return {
      ok:false,
      ask:`Name a topic, a title, or which items to ${verb}. I will not ${verb} every saved item at once.`,
      error:'selector required'
    };
  }
  const patch = action === 'delete' ? null : assistantApplyPatchFrom(spec, action);
  if(action === 'snooze' && (patch.snooze == null || String(patch.snooze).trim() === '')){
    return {ok:false, ask:'How long should I snooze them? For example, 3 days or until tomorrow.', error:'snooze required'};
  }
  if(action === 'edit' && !assistantApplyHasPatch(patch)){
    return {ok:false, ask:'What should I change on those?', error:'patch required'};
  }
  const fresh = [];
  const local = new Set();
  for(const row of rows){
    const key = row.hid || row.name;
    if(local.has(key))continue;
    if(claimed.has(key)){
      return {ok:false, ask:`${row.name} matches more than one change. Say which change it should get.`, error:'OVERLAP'};
    }
    local.add(key);
    fresh.push(row);
    claimed.add(key);
  }
  if(patch && patch.newName && fresh.length > 1){
    return {ok:false, ask:'I can rename one item at a time. Which one should get the new name?', error:'rename'};
  }
  if(action === 'delete'){
    return {
      ok:true,
      edits:[],
      deletes:fresh.map(row => {
        const habit = assistantApplyHabitAt(context && context.data, row);
        const base = habit && typeof assistantHabitToDraft === 'function'
          ? assistantHabitToDraft(habit, row.index, context.settings, context.data)
          : null;
        return {
          index:row.index,
          hid:row.hid,
          name:row.name,
          sourceFingerprint:base ? assistantDraftFingerprint(base) : ''
        };
      }),
      items:fresh
    };
  }
  const edits = [];
  const data = context && context.data;
  for(const row of fresh){
    const habit = assistantApplyHabitAt(data, row);
    if(!habit)return {ok:false, error:`${row.name} is no longer on the list`};
    const base = typeof assistantHabitToDraft === 'function'
      ? assistantHabitToDraft(habit, row.index, context.settings, data)
      : assistantEmptyDraft();
    const applied = assistantApplyDraftItem(
      Object.assign({}, patch, {name:base.name, kind:base.kind}),
      base,
      context.catalog,
      context.now,
      context.settings,
      data,
      '',
      {skipSalvage:true, session, settings:context.settings}
    );
    if(!applied.ok)return applied;
    if(action === 'show' && applied.draft)applied.draft.applyNote = 'shown';
    if(assistantDraftFingerprint(base) === assistantDraftFingerprint(applied.draft))continue;
    if(applied.draft){
      // Confirmations can stay open while another device or another app view
      // changes the same row. Refuse a stale overwrite instead of applying a
      // patch that was derived from an older version of the item.
      applied.draft.applySourceFingerprint = assistantDraftFingerprint(base);
      edits.push(applied.draft);
    }
  }
  return {ok:true, edits, deletes:[], items:fresh};
}

function assistantApplyDeleteSummary(items){
  const names = items.map(item => item.name).filter(Boolean);
  if(names.length === 1)return `Remove ${names[0]}? This deletes the item and its history.`;
  return `Remove these ${names.length} items: ${names.join(', ')}? This deletes them and their history.`;
}

function assistantApplyItems(args, session, context){
  const parent = args && typeof args === 'object' ? args : {};
  const rawGroups = Array.isArray(parent.groups) ? parent.groups.filter(group => group && typeof group === 'object') : [];
  if(rawGroups.length > 8)return {ok:false, error:'8 groups max'};
  let universe = null;
  if(rawGroups.length){
    const parentSelect = {
      search:parent.search,
      kind:parent.kind,
      status:parent.status,
      names:parent.names,
      fromRecent:parent.fromRecent,
      conditions:parent.conditions,
      sortBy:parent.sortBy,
      sortOrder:parent.sortOrder,
      position:parent.position,
      limit:parent.limit
    };
    const parentNarrow = assistantApplyIsNarrow(parentSelect, 'edit') || assistantApplyIsNarrow(parentSelect, 'delete');
    const wantsRest = rawGroups.some(group => group.rest === true || group.rest === 'true');
    if(wantsRest && !parentNarrow){
      return {ok:false, ask:'Say which items the groups share — a topic, names, or the previous list.', error:'selector required'};
    }
    if(parentNarrow){
      const resolved = assistantResolveApplySet(parentSelect, session, context, null);
      if(!resolved.ok)return resolved;
      universe = resolved.rows;
    }
  }
  const groups = rawGroups.length ? rawGroups : [parent];
  const claimed = new Set();
  const edits = [];
  const deletes = [];
  const matched = [];
  for(const group of groups){
    const rest = Boolean(rawGroups.length && (group.rest === true || group.rest === 'true'));
    const spec = rawGroups.length ? assistantApplyMergedSelector(parent, group, universe != null) : parent;
    let pool = universe;
    if(rest){
      pool = (universe || []).filter(row => !claimed.has(row.hid || row.name));
      if(!pool.length)continue;
      spec.fromRecent = false;
      if(!spec.search && !assistantApplyNameList(spec.names).length && !(Array.isArray(spec.conditions) && spec.conditions.length)){
        spec.search = parent.search;
        spec.names = parent.names;
        spec.kind = parent.kind;
        spec.status = parent.status;
        spec.conditions = parent.conditions;
      }
    }
    const resolved = assistantResolveApplySet(spec, session, context, pool);
    if(!resolved.ok)return resolved;
    const applied = assistantApplyOneGroup(spec, resolved.rows, session, context, claimed, {rest});
    if(!applied.ok)return applied;
    applied.edits.forEach(row => edits.push(row));
    applied.deletes.forEach(row => deletes.push(row));
    applied.items.forEach(row => matched.push(row));
  }
  if(!edits.length && !deletes.length){
    return {ok:true, noChange:true, text:'Those items already have that change.'};
  }
  const pendingDelete = deletes.length ? {
    index:deletes[0].index,
    hid:deletes[0].hid,
    name:deletes.length === 1 ? deletes[0].name : deletes.map(item => item.name).join(', '),
    items:deletes,
    summary:assistantApplyDeleteSummary(deletes)
  } : null;
  const parts = [];
  if(edits.length)parts.push(`Change ${edits.length}: ${edits.map(row => row.name).join(', ')}.`);
  if(pendingDelete)parts.push(pendingDelete.summary);
  return {
    ok:true,
    drafts:edits,
    draft:edits[0] || null,
    pendingDelete,
    summary:parts.join(' '),
    text:parts.join(' '),
    items:matched.map(row => ({
      name:row.name,
      hid:row.hid,
      durationMinutes:row.durationMinutes,
      topics:row.topics
    }))
  };
}

function assistantExecuteTool(name, args, session, context){
  const catalog = context.catalog;
  const draft = session.draft || assistantEmptyDraft();
  if(name === 'classify_intent')return assistantValidateClassify(args);
  if(name === 'ask_user'){
    const question = String(args && args.question || '').trim();
    if(!question)return {ok:false, error:'question is required'};
    const choices = Array.isArray(args.choices) ? args.choices.map(v => String(v).trim()).filter(Boolean).slice(0, 6) : [];
    return {ok:true, ask:question, choices};
  }
  if(name === 'apply_items'){
    const applied = assistantApplyItems(args, session, context);
    if(applied.ok && Array.isArray(applied.drafts) && applied.drafts.length){
      session.drafts = applied.drafts;
      session.draft = applied.draft;
      session.bulk = true;
    }
    if(applied.ok && applied.pendingDelete)session.pendingDelete = applied.pendingDelete;
    return applied;
  }
  if(name === 'draft_batch'){
    const applied = assistantApplyDraftBatch(args, session, context);
    if(applied.ok){
      session.drafts = applied.drafts;
      session.draft = applied.draft;
      session.bulk = true;
    }
    return applied;
  }
  if(name === 'draft_item' || name === 'draft_setting'){
    const focusedItem = session.draft && session.draft.name
      && typeof assistantIsItemKind === 'function' && assistantIsItemKind(session.draft.kind);
    const trustFacts = !focusedItem && typeof assistantTrustParsedFacts === 'function' && assistantTrustParsedFacts(session.parsed);
    const nextArgs = trustFacts
      ? assistantMergeExtractedArgs(args, session.parsed)
      : Object.assign({}, args || {});
    if((name === 'draft_setting' || trustFacts) && session.parsed && session.parsed.settingKind && !nextArgs.kind){
      nextArgs.kind = session.parsed.settingKind;
    }
    if((name === 'draft_setting' || trustFacts) && session.parsed && session.parsed.address && !nextArgs.address){
      nextArgs.address = session.parsed.address;
    }
    const asSetting = name === 'draft_setting'
      || (typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(nextArgs.kind))
      || (session.intent === 'create_setting' && !(typeof assistantIsItemKind === 'function' && assistantIsItemKind(nextArgs.kind)))
      || (name !== 'draft_item' && session.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind)
        && !(typeof assistantIsItemKind === 'function' && assistantIsItemKind(nextArgs.kind)));
    if(asSetting){
      let base = session.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind)
        ? session.draft
        : null;
      if(!base && nextArgs.name){
        const pool = []
          .concat(Array.isArray(session.turnDrafts) ? session.turnDrafts : [])
          .concat(Array.isArray(session.drafts) ? session.drafts : []);
        base = pool.find(row => row && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(row.kind)
          && (!nextArgs.kind || row.kind === nextArgs.kind)
          && typeof assistantNamesMatch === 'function' && assistantNamesMatch(row.name, nextArgs.name)) || null;
      }
      if(!nextArgs.kind && base && assistantIsSettingKind(base.kind))nextArgs.kind = base.kind;
      else if(!nextArgs.kind && session.draft && assistantIsSettingKind(session.draft.kind))nextArgs.kind = session.draft.kind;
      const applied = assistantApplyDraftSetting(
        nextArgs,
        base || session.draft,
        catalog,
        context.now,
        context.settings,
        '',
        {
          reuseSavedPlace:true,
          catalog
        }
      );
      if(applied.ok && !applied.existing)session.draft = applied.draft;
      return applied;
    }
    const resolved = assistantResolveDraftBase(nextArgs, session, context);
    if(!resolved.ok)return resolved;
    if(resolved.draft && resolved.draft.name){
      nextArgs.kind = nextArgs.kind || resolved.draft.kind;
      if(!nextArgs.name || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(nextArgs.name))){
        nextArgs.name = resolved.draft.name;
      }
    }
    const applied = assistantApplyDraftItem(
      nextArgs,
      resolved.draft,
      catalog,
      context.now,
      context.settings,
      context.data,
      '',
      {
        placeholders:Boolean(session && session.bulk),
        skipSalvage:true,
        session,
        settings:context.settings
      }
    );
    if(applied.draft){
      session.draft = applied.draft;
      assistantLinkStagedWeather(session, applied.draft);
    }
    return applied;
  }
  if(name === 'set_window'){
    const applied = assistantApplyWindow(draft, args);
    if(applied.ok)session.draft = applied.draft;
    return applied;
  }
  if(name === 'set_weather'){
    const applied = assistantApplyWeather(draft, args, catalog);
    if(applied.ok)session.draft = applied.draft;
    return applied;
  }
  if(name === 'set_place'){
    const applied = assistantApplyPlace(draft, args, catalog);
    if(applied.ok)session.draft = applied.draft;
    return applied;
  }
  if(name === 'find_item'){
    const query = String((args && (args.query || args.name)) || (session.parsed && session.parsed.text) || '').trim();
    if(!query)return {ok:false, error:'query is required', ask:'Which item are you asking about?'};
    const ranked = assistantRankByName(assistantHabitRows(context.data), query, args && args.limit);
    const picked = assistantPickRankedName(ranked);
    const matches = assistantCandidateRows(ranked);
    if(picked.ok){
      return {ok:true, matches, text:`Closest match: ${picked.item.name}.`};
    }
    if(matches.length)return assistantHabitAskFromCandidates(matches, picked.error);
    return {ok:true, matches:[], text:'No saved item is close to that name.'};
  }
  if(name === 'complete_item' || name === 'plan_item' || name === 'delete_item' || name === 'lookup_item'){
    const spoken = (session.parsed && session.parsed.text) || '';
    let want = (args && args.name) || '';
    const pronoun = !String(want).trim()
      || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(want));
    if(pronoun){
      want = (session.draft && session.draft.name)
        || (session.recent && session.recent.referent)
        || want;
    }
    let found = typeof assistantFindHabitSmart === 'function'
      ? assistantFindHabitSmart(context.data, want, spoken)
      : assistantFindHabit(context.data, want);
    // An explicit name is authoritative. Context may resolve only an omitted
    // name or a pronoun; a miss must never mutate or describe another item.
    if(!found.ok)return found;
    if(name === 'complete_item'){
      if(typeof replicaDeviceBlocksCompletion === 'function' && replicaDeviceBlocksCompletion(found.hid)){
        return {ok:false, error:'This screen is view only. Open the main Tings app on this computer to log it.'};
      }
      const preview = assistantCompletePreview(found, args);
      session.pendingComplete = preview.pendingComplete || null;
      if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
      return preview;
    }
    if(name === 'plan_item'){
      const preview = assistantPlanPreview(found, args, context);
      session.pendingPlan = preview.pendingPlan || null;
      if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
      return preview;
    }
    if(name === 'delete_item'){
      const preview = assistantDeletePreview(found);
      session.pendingDelete = preview.pendingDelete;
      if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
      return preview;
    }
    if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
    return {
      ok:true,
      text:assistantLookupText(found, context, args, session.parsed && session.parsed.text),
      found,
      item:typeof assistantHabitQueryFacts === 'function' ? assistantHabitQueryFacts(found.habit) : null
    };
  }
  // Query tools answer from live app data and never touch the draft or
  // storage. answer_schedule is async (the what-if may rebuild the week).
  if(name === 'answer_weather'){
    return assistantAnswerWeather(args, context);
  }
  if(name === 'answer_schedule'){
    return assistantAnswerSchedule(args, context);
  }
  if(name === 'answer_items')return assistantAnswerItems(args, context);
  if(name === 'answer_settings')return assistantAnswerSettings(args, context);
  return {ok:false, error:`unknown tool ${name}`};
}

function assistantEndpointSummary(end){
  if(!end || end.kind === 'unset')return 'any';
  let primary;
  if(end.kind === 'clock')primary = end.clock;
  else if(end.kind === 'habit'){
    const name = end.habitName || 'another item';
    const off = end.offsetMin || 0;
    if(!off)primary = name;
    else{
      const abs = Math.abs(off);
      const rel = off < 0 ? 'before' : 'after';
      primary = `${abs}m ${rel} ${name}`;
    }
  }else{
    const labels = typeof PRAYER_ANCHOR_LABELS !== 'undefined' ? PRAYER_ANCHOR_LABELS : {};
    const label = labels[end.anchor] || end.anchor;
    const off = end.offsetMin || 0;
    if(!off)primary = label;
    else{
      const abs = Math.abs(off);
      const rel = off < 0 ? 'before' : 'after';
      primary = abs % 60 === 0 ? `${abs / 60}h ${rel} ${label}` : `${abs}m ${rel} ${label}`;
    }
  }
  if(end.combine && end.second){
    const word = end.combine === 'earlier' ? 'earlier of' : 'later of';
    const second = assistantEndpointSummary(Object.assign({}, end.second, {combine:null, second:null}));
    return `${word} ${primary} · ${second}`;
  }
  return primary;
}

function assistantWeekdaySummary(days){
  if(!Array.isArray(days) || !days.length)return '';
  const labels = typeof WEEKDAY_LABELS !== 'undefined' ? WEEKDAY_LABELS : ['sun','mon','tue','wed','thu','fri','sat'];
  if(days.length === 5 && days.join(',') === '1,2,3,4,5')return 'weekdays';
  if(days.length === 2 && days[0] === 0 && days[1] === 6)return 'weekends';
  const names = days.map(day => labels[day]).filter(Boolean);
  if(names.length === 1)return `every ${names[0]}`;
  if(names.length === 2)return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function assistantDraftFingerprint(draft){
  if(!draft)return '';
  return JSON.stringify({
    n:draft.name,
    k:draft.kind,
    hk:draft.habitKind,
    e:draft.emoji,
    c:draft.emojiBgColor,
    d:draft.durationMinutes,
    p:draft.priority,
    tp:draft.topics,
    due:draft.dueDate,
    tm:draft.dueTime,
    hd:draft.hardDue,
    t:draft.timesPerPeriod,
    pd:draft.periodDays,
    w:Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays : [],
    md:Array.isArray(draft.allowedMonthDays) ? draft.allowedMonthDays : [],
    pw:Array.isArray(draft.preferredWeekdays) ? draft.preferredWeekdays : [],
    pmd:Array.isArray(draft.preferredMonthDays) ? draft.preferredMonthDays : [],
    win:draft.window || null,
    pwin:draft.preferredWindow || null,
    wea:draft.weather ? {m:draft.weather.mode, i:draft.weather.profileId, n:draft.weather.name} : null,
    pl:draft.places ? {ids:draft.places.ids, a:draft.places.anywhere} : null,
    lp:draft.locationPrefs || null,
    early:draft.earlyWindowDays,
    delay:draft.delayAllowanceDays,
    br:draft.breakable,
    mc:draft.minChunkMinutes,
    am:draft.autoMarkMinutes,
    tv:draft.trackValue,
    pin:draft.pinned,
    sn:draft.snoozedUntil,
    sh:draft.showOnSharedDisplay,
    sc:draft.allowSharedDisplayCompletion,
    sw:draft.showWeather,
    swp:draft.showWeatherAtLocation,
    wl:draft.weatherLocationId,
    sl:draft.scheduleLinks || null,
    so:draft.scheduleOptions || null,
    lk:draft.links || null,
    pb:draft.planByDate,
    sid:draft.settingId || null,
    wp:draft.weatherProposed || null,
    addr:draft.address || null,
    lat:draft.lat,
    lng:draft.lng
  });
}

function assistantSettingLabel(kind){
  if(kind === 'weather')return 'weather profile';
  if(kind === 'location')return 'place';
  if(kind === 'busy')return 'busy time';
  if(kind === 'topic')return 'topic';
  return '';
}

function assistantWeatherRulesSummary(rules){
  return (rules || []).filter(rule => rule && (typeof weatherRuleActive === 'function'
    ? weatherRuleActive(rule)
    : (rule.min != null || rule.max != null || (rule.relative && rule.relative !== 'none')))).map(rule => {
    const label = (typeof WEATHER_METRICS !== 'undefined' && WEATHER_METRICS[rule.metric] && WEATHER_METRICS[rule.metric].label) || rule.metric;
    const unit = typeof weatherMetricUnitLabel === 'function' ? weatherMetricUnitLabel(rule.metric) : '';
    const fmt = v => {
      const n = typeof weatherMetricDisplayValue === 'function' ? weatherMetricDisplayValue(rule.metric, v) : v;
      return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '';
    };
    const bits = [];
    if(rule.min != null)bits.push(`≥${fmt(rule.min)}${unit}`);
    if(rule.max != null)bits.push(`≤${fmt(rule.max)}${unit}`);
    if(rule.relative === 'low')bits.push('prefer lower');
    if(rule.relative === 'high')bits.push('prefer higher');
    if(rule.hard)bits.push('hard');
    return `${label} ${bits.join(' ')}`.trim();
  }).filter(Boolean);
}

function assistantDraftSummary(draft, settings){
  if(!draft || !draft.name)return '';
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)){
    const parts = [draft.name, assistantSettingLabel(draft.kind)];
    if(draft.kind === 'weather'){
      const rules = assistantDraftWeatherRules(draft, settings);
      const chips = assistantWeatherRulesSummary(rules);
      if(chips.length)parts.push(...chips.slice(0, 4));
      else parts.push('no rules yet');
    }else if(draft.kind === 'location'){
      if(draft.address)parts.push(draft.address);
      else if(Number.isFinite(Number(draft.lat)))parts.push('pinned');
      else parts.push('needs address');
    }else if(draft.kind === 'busy' && draft.window){
      parts.push(`${assistantEndpointSummary(draft.window.start)} → ${assistantEndpointSummary(draft.window.end)}`);
    }
    return parts.filter(Boolean).join(' · ');
  }
  const parts = [draft.name, draft.kind === 'habit' ? 'habit' : 'task'];
  const duration = draft.durationMinutes != null
    ? draft.durationMinutes
    : (settings && settings.defaultDurationMinutes);
  if(duration)parts.push(`${duration} min`);
  if(draft.kind === 'habit' && draft.timesPerPeriod && draft.periodDays){
    const dayLabel = assistantWeekdaySummary(draft.allowedWeekdays);
    const weekdayCadence = dayLabel && draft.periodDays === 7 && (
      draft.timesPerPeriod === (draft.allowedWeekdays && draft.allowedWeekdays.length)
      || (dayLabel === 'weekends' && draft.timesPerPeriod === 1)
      || (dayLabel === 'weekdays' && draft.timesPerPeriod === 5)
    );
    if(weekdayCadence)parts.push(dayLabel);
    else{
      if(draft.periodDays === 1 && draft.timesPerPeriod === 1)parts.push('daily');
      else if(draft.periodDays === 7)parts.push(`${draft.timesPerPeriod}× / week`);
      else parts.push(`${draft.timesPerPeriod}× / ${draft.periodDays}d`);
      if(dayLabel)parts.push(dayLabel);
    }
  }
  if(draft.kind === 'task' && draft.dueDate){
    const key = typeof dateKey === 'function' ? dateKey(draft.dueDate) : '';
    parts.push(draft.dueTime ? `${key} ${draft.dueTime}` : key);
  }
  if(draft.window && (draft.window.start.kind !== 'unset' || draft.window.end.kind !== 'unset')){
    parts.push(`${assistantEndpointSummary(draft.window.start)} → ${assistantEndpointSummary(draft.window.end)}`);
  }
  if(draft.weather){
    if(draft.weather.mode === 'none')parts.push('no weather');
    else if(draft.weather.mode === 'profile' && draft.weather.name)parts.push(draft.weather.name);
  }
  if(draft.places && draft.places.names && draft.places.names.length){
    parts.push(draft.places.names.join(', '));
  }
  if(draft.habitKind === 'reduce')parts.push('limit');
  if(draft.habitKind === 'zero')parts.push('stop');
  if(Array.isArray(draft.topics) && draft.topics.length)parts.push(draft.topics.join(', '));
  if(draft.breakable)parts.push('split');
  if(draft.pinned)parts.push('pinned');
  if(draft.snoozedUntil && Number(draft.snoozedUntil) > Date.now())parts.push('snoozed');
  else if(draft.applyNote)parts.push(draft.applyNote);
  if(draft.hardDue)parts.push('hard due');
  if(Array.isArray(draft.scheduleLinks) && draft.scheduleLinks.length){
    parts.push(draft.scheduleLinks.map(link => `${link.direction} ${link.name || ''}`.trim()).join(', '));
  }
  if(Array.isArray(draft.links) && draft.links.length)parts.push('link');
  return parts.filter(Boolean).join(' · ');
}

function assistantFormatList(title, rows){
  if(!rows || !rows.length)return '';
  const lines = rows.map(row => row.clock ? `${row.clock} ${row.name}` : row.name);
  return `${title}\n${lines.map(line => `- ${line}`).join('\n')}`;
}

function assistantFormatToday(catalog, opts){
  const today = catalog && catalog.today;
  if(!today || typeof today !== 'object' || Array.isArray(today)){
    const rows = Array.isArray(today) ? today : [];
    if(!rows.length)return 'Nothing is on today yet. The list fills after the planner runs.';
    return rows.map(row => row.clock ? `${row.clock} ${row.name}` : row.name).join('\n');
  }
  if(opts && opts.compact && today.next){
    return today.next.clock ? `Next: ${today.next.name} at ${today.next.clock}` : `Next: ${today.next.name}`;
  }
  const parts = [];
  if(today.next)parts.push(today.next.clock ? `Next: ${today.next.name} at ${today.next.clock}` : `Next: ${today.next.name}`);
  const open = assistantFormatList('Still open', (today.open || []).slice(0, 6));
  if(open)parts.push(open);
  const overdue = assistantFormatList('Overdue', (today.overdue || []).slice(0, 4));
  if(overdue)parts.push(overdue);
  const done = assistantFormatList('Already done', (today.done || []).slice(0, 4));
  if(done)parts.push(done);
  if(!parts.length)return 'Nothing is on today yet. You can add something by saying "remind me to ..."';
  return parts.join('\n\n');
}

function assistantDraftToHabit(draft, settings, now, data){
  const ts = now != null ? Number(now) : Date.now();
  const s = settings || {};
  const isHabit = draft.kind === 'habit';
  const type = isHabit
    ? (draft.habitKind === 'reduce' || draft.habitKind === 'zero' || draft.habitKind === 'keepup'
      ? draft.habitKind
      : (s.defaultType === 'reduce' || s.defaultType === 'zero' ? s.defaultType : 'keepup'))
    : 'task';
  const times = draft.timesPerPeriod || 1;
  const days = draft.periodDays || Math.round(s.defaultTarget || 7);
  const target = (type === 'zero' || type === 'task')
    ? null
    : (typeof targetFromRhythmParts === 'function' ? targetFromRhythmParts(times, days) : days / times);
  const record = {
    name:String(draft.name || '').slice(0, ASSISTANT_NAME_MAX),
    type,
    target,
    lastLog:null,
    logs:[],
    emoji:draft.emoji != null ? draft.emoji : '',
    emojiBgColor:draft.emojiBgColor != null ? draft.emojiBgColor : '',
    pinned:draft.pinned != null ? Boolean(draft.pinned) : false,
    showOnSharedDisplay:draft.showOnSharedDisplay != null ? Boolean(draft.showOnSharedDisplay) : true,
    allowSharedDisplayCompletion:draft.allowSharedDisplayCompletion != null ? Boolean(draft.allowSharedDisplayCompletion) : true,
    priority:draft.priority != null ? draft.priority : (s.defaultPriority != null ? s.defaultPriority : 2),
    topics:Array.isArray(draft.topics)
      ? draft.topics.slice()
      : (Array.isArray(s.defaultTopics) ? s.defaultTopics.slice() : []),
    locationIds:draft.places && Array.isArray(draft.places.ids) ? draft.places.ids.slice() : [],
    anywhereAllowed:draft.places ? Boolean(draft.places.anywhere || !draft.places.ids.length) : true,
    locationPrefs:draft.locationPrefs && typeof draft.locationPrefs === 'object' ? Object.assign({}, draft.locationPrefs) : {},
    durationMinutes:draft.durationMinutes != null ? draft.durationMinutes : s.defaultDurationMinutes,
    breakable:draft.breakable != null ? Boolean(draft.breakable) : Boolean(s.defaultBreakable),
    minChunkMinutes:draft.minChunkMinutes != null ? draft.minChunkMinutes : s.defaultMinChunkMinutes,
    createdAt:ts,
    earlyWindowDays:draft.earlyWindowDays != null ? draft.earlyWindowDays : s.defaultEarlyWindowDays,
    delayAllowanceDays:draft.delayAllowanceDays != null ? draft.delayAllowanceDays : s.defaultDelayAllowanceDays,
    autoMarkMinutes:draft.autoMarkMinutes !== undefined ? draft.autoMarkMinutes : s.defaultAutoMarkMinutes,
    trackValue:Boolean(draft.trackValue),
    showWeather:Boolean(draft.showWeather),
    showWeatherAtLocation:Boolean(draft.showWeatherAtLocation),
    weatherLocationId:draft.weatherLocationId || null
  };
  if(isHabit){
    record.allowedWeekdays = typeof normalizeAllowedWeekdays === 'function'
      ? normalizeAllowedWeekdays(draft.allowedWeekdays || [])
      : (Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays.slice() : []);
    record.allowedMonthDays = typeof normalizeAllowedMonthDays === 'function'
      ? normalizeAllowedMonthDays(draft.allowedMonthDays || [])
      : (Array.isArray(draft.allowedMonthDays) ? draft.allowedMonthDays.slice() : []);
    record.preferredWeekdays = typeof normalizeAllowedWeekdays === 'function'
      ? normalizeAllowedWeekdays(draft.preferredWeekdays || [])
      : (Array.isArray(draft.preferredWeekdays) ? draft.preferredWeekdays.slice() : []);
    record.preferredMonthDays = typeof normalizeAllowedMonthDays === 'function'
      ? normalizeAllowedMonthDays(draft.preferredMonthDays || [])
      : (Array.isArray(draft.preferredMonthDays) ? draft.preferredMonthDays.slice() : []);
    record.planByDate = draft.planByDate != null ? draft.planByDate : null;
  }
  if(type === 'task'){
    record.dueDate = draft.dueDate;
    if(draft.dueTime && draft.dueDate && typeof parseTaskWhen === 'function'){
      const key = typeof dateKey === 'function' ? dateKey(draft.dueDate) : '';
      record.eventTime = parseTaskWhen(key, draft.dueTime);
    }else{
      record.eventTime = null;
    }
    if(record.dueDate == null)record.earlyWindowDays = 0;
    if(draft.hardDue === true)record.delayAllowanceDays = 0;
  }
  if(draft.weather && (draft.weather.mode !== 'profile' || draft.weather.profileId)){
    record.weatherProfileMode = draft.weather.mode;
    record.weatherProfileId = draft.weather.mode === 'profile' ? draft.weather.profileId : null;
  }
  assistantWriteWindowToRecord(record, draft.window, 'allowed', data);
  assistantWriteWindowToRecord(record, draft.preferredWindow, 'preferred', data);
  if(Array.isArray(draft.scheduleLinks)){
    record.scheduleLinks = draft.scheduleLinks.map(link => ({
      anchorHid:link.anchorHid,
      direction:link.direction,
      adjacency:link.adjacency === 'direct' ? 'direct' : 'sometime',
      requireSameDay:Boolean(link.requireSameDay)
    })).filter(link => link.anchorHid && (link.direction === 'before' || link.direction === 'after'));
  }
  if(Array.isArray(draft.scheduleOptions)){
    record.scheduleOptions = typeof normalizeHabitScheduleOptions === 'function'
      ? normalizeHabitScheduleOptions(draft.scheduleOptions)
      : draft.scheduleOptions.slice();
  }
  if(Array.isArray(draft.links)){
    record.links = typeof normalizeLinks === 'function' ? normalizeLinks(draft.links) : draft.links.slice();
  }
  if(draft.snoozedUntil !== undefined)record.snoozedUntil = draft.snoozedUntil;
  return record;
}

function assistantCommitComplete(pending){
  if(!pending || pending.index == null)return {ok:false, error:'nothing to log'};
  if(typeof replicaDeviceBlocksCompletion === 'function' && replicaDeviceBlocksCompletion(pending.hid)){
    return {ok:false, error:'This screen is view only. Open the main Tings app on this computer to log it.'};
  }
  const data = typeof load === 'function' ? load() : [];
  let index = pending.index;
  if(!data[index] || (pending.hid && data[index].hid && data[index].hid !== pending.hid)){
    const found = assistantFindHabit(data, pending.name);
    if(!found.ok)return {ok:false, error:found.ask || 'that item is gone'};
    index = found.index;
  }
  if(pending.action === 'undo_today'){
    const habit = data[index];
    const before = typeof normalizeLogs === 'function' ? normalizeLogs(habit.logs) : (habit.logs || []).slice();
    const targetTs = Number(pending.targetTs);
    const after = before.slice();
    let removeAt = -1;
    for(let pos = after.length - 1; pos >= 0; pos -= 1){
      const log = after[pos];
      if(typeof isPlanLog === 'function' && isPlanLog(log))continue;
      const ts = typeof logTime === 'function' ? logTime(log) : Number(log && log.ts || log);
      if(ts === targetTs){ removeAt = pos; break; }
    }
    if(removeAt < 0)return {ok:false, error:'that completion is already gone'};
    after.splice(removeAt,1);
    habit.logs = typeof normalizeLogs === 'function' ? normalizeLogs(after) : after;
    habit.lastLog = typeof latestActualLog === 'function' ? latestActualLog(habit.logs) : null;
    if(typeof save === 'function' && !save(data))return {ok:false, error:'could not save'};
    if(typeof showActionToast === 'function'){
      showActionToast(`Marked ${habit.name} not done`,{
        type:'breakable-set',idx:index,logs:before,snoozedUntil:habit.snoozedUntil || null,
        openAction:false,undoLabel:'restore'
      });
    }
    return {ok:true, index, name:habit.name, action:'undo_today', habit};
  }
  const opts = {};
  if(pending.minutes)opts.minutes = pending.minutes;
  if(pending.value !== null && pending.value !== undefined)opts.value = pending.value;
  if(pending.note)opts.note = pending.note;
  if(typeof logTing === 'function'){
    const ok = logTing(index, opts);
    return ok ? {ok:true, index, name:data[index] && data[index].name, action:'log', habit:data[index]} : {ok:false, error:'could not log'};
  }
  const habit = data[index];
  if(!habit)return {ok:false, error:'that item is gone'};
  const ts = Date.now();
  const logs = typeof normalizeLogs === 'function' ? normalizeLogs(habit.logs) : (habit.logs || []).slice();
  logs.push(typeof makeActualLog === 'function' ? makeActualLog(ts, opts) : ts);
  habit.logs = logs;
  habit.lastLog = ts;
  if(typeof save === 'function' && !save(data))return {ok:false, error:'could not save'};
  return {ok:true, index, name:habit.name, action:'log', habit};
}

function assistantCommitPlan(pending){
  if(!pending || pending.index == null || !pending.key)return {ok:false, error:'nothing to plan'};
  const data = typeof load === 'function' ? load() : [];
  let index = pending.index;
  if(!data[index] || (pending.hid && data[index].hid && data[index].hid !== pending.hid)){
    const found = assistantFindHabit(data, pending.name);
    if(!found.ok)return {ok:false, error:found.ask || 'that item is gone'};
    index = found.index;
  }
  const habit = data[index];
  if(!habit)return {ok:false, error:'that item is gone'};
  if(habit.type === 'zero')return {ok:false, error:'Stop habits cannot be planned.'};
  if(pending.key < (typeof todayIso === 'function' ? todayIso() : dateKey(Date.now()))){
    return {ok:false, error:'that plan date has already passed'};
  }
  if(pending.action !== 'remove' && habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(habit)){
    return {ok:false, error:`${habit.name} is already done`};
  }
  if(pending.action !== 'remove' && pending.locationId){
    const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
    const places = typeof normalizeLocationRegistry === 'function'
      ? normalizeLocationRegistry(settings.locations)
      : (settings.locations || []);
    if(!places.some(place => place && place.id === pending.locationId)){
      return {ok:false, error:'that saved place is no longer available'};
    }
  }
  const before = typeof normalizeLogs === 'function' ? normalizeLogs(habit.logs) : (habit.logs || []).slice();
  const remaining = before.filter(log => !(typeof isPlanLog === 'function' && isPlanLog(log)
    && typeof dateKey === 'function' && dateKey(logTime(log)) === pending.key));
  if(pending.action !== 'remove'){
    const base = new Date(`${pending.key}T12:00:00`);
    if(Number.isNaN(base.getTime()))return {ok:false, error:'invalid plan date'};
    const minute = pending.timeMin == null ? 12 * 60 : Number(pending.timeMin);
    const ts = new Date(base.getFullYear(),base.getMonth(),base.getDate(),Math.floor(minute / 60),minute % 60,0,0).getTime();
    const entry = typeof makePlanLog === 'function'
      ? makePlanLog(ts,{timed:pending.timeMin != null,locationId:pending.locationId || null})
      : {ts,plan:true};
    remaining.push(entry);
  }
  habit.logs = typeof normalizeLogs === 'function' ? normalizeLogs(remaining) : remaining;
  habit.lastLog = typeof latestActualLog === 'function' ? latestActualLog(habit.logs) : habit.lastLog;
  if(typeof save === 'function' && !save(data))return {ok:false, error:'could not save'};
  const verb = pending.action === 'remove' ? 'Unplanned' : (pending.replacing ? 'Replanned' : 'Planned');
  if(typeof showActionToast === 'function'){
    showActionToast(`${verb} ${habit.name}`,{
      type:'breakable-set',idx:index,logs:before,snoozedUntil:habit.snoozedUntil || null,
      openAction:false,undoLabel:'undo'
    });
  }
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  else if(typeof render === 'function')render();
  return {ok:true,index,name:habit.name,action:pending.action || 'add',habit};
}

function assistantCommitDeleteSet(items){
  const pending = Array.isArray(items) ? items.slice() : [];
  const data = typeof load === 'function' ? load() : [];
  const targets = [];
  const seen = new Set();
  // Resolve the entire confirmation against one snapshot before deleting the
  // first row. A removed/renamed target must not cause a half-applied set.
  for(const item of pending){
    let index = item && item.hid ? data.findIndex(row => row && row.hid === item.hid) : -1;
    if(index < 0){
      const match = assistantFindHabit(data, item && item.name);
      if(!match.ok)return {ok:false, error:match.ask || `${item && item.name || 'an item'} is gone`};
      index = match.index;
    }
    const habit = data[index];
    const key = habit && (habit.hid || `${index}:${habit.name}`);
    if(!habit || seen.has(key))return {ok:false, error:`${item && item.name || 'An item'} is no longer available`};
    if(item.sourceFingerprint){
      const current = assistantHabitToDraft(habit, index, typeof loadSortSettings === 'function' ? loadSortSettings() : {}, data);
      if(assistantDraftFingerprint(current) !== item.sourceFingerprint){
        return {ok:false, error:`${habit.name} changed after this preview. Ask me to remove the set again.`};
      }
    }
    seen.add(key);
    targets.push({index, habit});
  }
  targets.sort((a, b) => b.index - a.index);
  const removed = [];
  for(const target of targets){
    const habit = typeof doNuke === 'function' ? doNuke(target.index, {silent:true}) : null;
    if(!habit)return {ok:false, error:'could not remove'};
    removed.push({idx:target.index, habit});
  }
  removed.sort((a, b) => a.idx - b.idx);
  const names = removed.map(row => row.habit && row.habit.name).filter(Boolean);
  if(typeof showActionToast === 'function'){
    showActionToast(names.length === 1 ? `Removed ${names[0]}` : `Removed ${names.length} items`, {
      type:'delete-many',
      items:removed,
      openAction:false,
      undoLabel:'restore'
    });
  }
  if(typeof render === 'function')render();
  return {ok:true, count:names.length, name:names.join(', '), names};
}

function assistantCommitDelete(pending){
  if(pending && Array.isArray(pending.items) && pending.items.length){
    return assistantCommitDeleteSet(pending.items);
  }
  if(!pending || pending.index == null)return {ok:false, error:'nothing to remove'};
  const data = typeof load === 'function' ? load() : [];
  let index = pending.index;
  if(!data[index] || (pending.hid && data[index].hid && data[index].hid !== pending.hid)){
    const found = assistantFindHabit(data, pending.name);
    if(!found.ok)return {ok:false, error:found.ask || 'that item is gone'};
    index = found.index;
  }
  const name = data[index] && data[index].name || pending.name;
  if(typeof doNuke === 'function'){
    doNuke(index);
    const after = typeof load === 'function' ? load() : [];
    const remains = pending.hid
      ? after.some(item => item && item.hid === pending.hid)
      : after.some(item => item && assistantNormText(item.name) === assistantNormText(name));
    return remains ? {ok:false, error:'could not remove'} : {ok:true, name};
  }
  data.splice(index, 1);
  if(typeof save === 'function' && !save(data))return {ok:false, error:'could not remove'};
  return {ok:true, name};
}

function assistantFocusHabit(session, found, context){
  if(!session || !found || !found.habit)return null;
  session.draft = typeof assistantHabitToDraft === 'function'
    ? assistantHabitToDraft(found.habit, found.index, context && context.settings, context && context.data)
    : assistantEmptyDraft();
  return session.draft;
}

function assistantMaybeFocusFound(session, found, context){
  if(!session || !found || !found.ok)return null;
  if(session.draft && session.draft.name && !session.draft.hid)return session.draft;
  const draft = assistantFocusHabit(session, found, context);
  session._focusOnly = true;
  return draft;
}

function assistantDraftExistingIndex(data, draft){
  if(!draft || !Array.isArray(data))return -1;
  if(draft.hid){
    const byHid = data.findIndex(item => item && item.hid === draft.hid);
    if(byHid >= 0)return byHid;
  }
  if(draft.index != null && data[draft.index] && (!draft.hid || data[draft.index].hid === draft.hid)){
    return draft.index;
  }
  return -1;
}

function assistantCommitDraft(draft){
  if(!draft || !draft.name)return {ok:false, error:'empty draft'};
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)){
    return assistantCommitSetting(draft);
  }
  if(typeof load !== 'function' || typeof save !== 'function')return {ok:false, error:'save unavailable'};
  const data = load();
  const existing = assistantDraftExistingIndex(data, draft);
  if(draft.applySourceFingerprint){
    if(existing < 0)return {ok:false, error:`${draft.name} is no longer on the list. Ask me to make the change again.`};
    const current = assistantHabitToDraft(data[existing], existing, typeof loadSortSettings === 'function' ? loadSortSettings() : {}, data);
    if(assistantDraftFingerprint(current) !== draft.applySourceFingerprint){
      return {ok:false, error:`${draft.name} changed after this preview. Ask me to make the change again.`};
    }
  }
  if(existing < 0 && data.length >= MAX_TINGS)return {ok:false, error:`${MAX_TINGS} habits max`};
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  if(typeof assistantEnsureProposedWeather === 'function')assistantEnsureProposedWeather(draft, settings);
  if(draft.weatherProposed && draft.kind !== 'weather' && !(draft.weather && draft.weather.profileId)){
    if(draft.weatherNeedAsk)return {ok:false, error:draft.weatherNeedAsk.question};
    return {ok:false, error:'could not save weather profile'};
  }
  if(Array.isArray(draft.topics) && draft.topics.length){
    const currentTopics = typeof normalizeTopics === 'function'
      ? normalizeTopics(settings.topics)
      : ((settings.topics || []).slice());
    const mergedTopics = typeof normalizeTopics === 'function'
      ? normalizeTopics(currentTopics.concat(draft.topics))
      : currentTopics.concat(draft.topics);
    if(mergedTopics.length !== currentTopics.length)assistantPersistSettings({topics:mergedTopics});
  }
  const record = assistantDraftToHabit(draft, typeof loadSortSettings === 'function' ? loadSortSettings() : settings, Date.now(), data);
  let next;
  let index;
  if(existing >= 0){
    const prev = data[existing];
    const merged = {
      ...prev,
      ...record,
      hid:prev.hid,
      logs:prev.logs,
      lastLog:prev.lastLog,
      createdAt:prev.createdAt,
      sample:prev.sample,
      externalId:prev.externalId,
      source:prev.source,
      importedAt:prev.importedAt
    };
    next = data.slice();
    next[existing] = merged;
    index = existing;
  }else{
    next = data.concat([record]);
    index = next.length - 1;
  }
  next = typeof normalize === 'function' ? normalize(next) : next;
  if(!save(next))return {ok:false, error:'could not save'};
  const habit = next[index];
  draft.hid = habit && habit.hid;
  draft.index = index;
  return {ok:true, index, habit, updated:existing >= 0};
}
