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

function assistantNormalizeEndpoint(raw){
  if(!raw || typeof raw !== 'object')return {kind:'unset'};
  const kind = raw.kind === 'clock' || raw.kind === 'anchor' ? raw.kind : 'unset';
  if(kind === 'clock'){
    const minutes = assistantParseClock(raw.clock);
    if(minutes == null)return {error:'clock must be HH:MM (or 7pm)'};
    return {kind:'clock', minutes, clock:assistantClockLabel(minutes)};
  }
  if(kind === 'anchor'){
    const anchor = assistantCleanAnchor(raw.anchor);
    if(!anchor)return {error:'anchor must be fajr, sunrise, dhuhr, asr, maghrib, or isha (sunset means maghrib)'};
    const offset = Number.isFinite(Number(raw.offsetMin)) ? Math.round(Number(raw.offsetMin)) : 0;
    const clamped = typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : offset;
    return {kind:'anchor', anchor, offsetMin:clamped};
  }
  return {kind:'unset'};
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

function assistantFindHabit(data, value){
  const list = (Array.isArray(data) ? data : []).map((habit, index) => ({
    index,
    hid:habit && habit.hid,
    name:String(habit && habit.name || ''),
    type:habit && habit.type,
    habit
  })).filter(item => item.name);
  const match = assistantMatchByName(list, value);
  if(!match.ok){
    if(match.error === 'AMBIGUOUS'){
      return {ok:false, error:'AMBIGUOUS', ask:`Which one: ${match.matches.map(item => item.name).join(', ')}?`, matches:match.matches};
    }
    return {ok:false, error:'UNKNOWN', ask:list.length
      ? `I do not see that on your list. Try one of: ${list.slice(0, 8).map(item => item.name).join(', ')}.`
      : 'Your list is empty, so there is nothing to log yet.'};
  }
  return {ok:true, ...match.item};
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
    places:locs.slice(0,12).map(loc => ({
      id:String(loc && loc.id || ''),
      name:String(loc && loc.name || '').slice(0,40)
    })).filter(item => item.id && item.name),
    weather:profiles.slice(0,4).map(profile => ({
      id:String(profile && profile.id || ''),
      name:String(profile && profile.name || '').slice(0,32)
    })).filter(item => item.id && item.name),
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
    name:'',
    durationMinutes:null,
    priority:null,
    dueDate:null,
    dueTime:null,
    timesPerPeriod:null,
    periodDays:null,
    allowedWeekdays:null,
    window:null,
    weather:null,
    places:null,
    windowMentioned:false,
    weatherMentioned:false,
    placeMentioned:false
  };
}

function assistantApplyWindow(draft, args){
  const start = assistantNormalizeEndpoint(args && args.start);
  if(start.error)return {ok:false, error:start.error};
  const end = assistantNormalizeEndpoint(args && args.end);
  if(end.error)return {ok:false, error:end.error};
  draft.window = {start, end};
  draft.windowMentioned = start.kind !== 'unset' || end.kind !== 'unset';
  return {ok:true, draft};
}

function assistantApplyWeather(draft, args, catalog){
  const mode = args && args.mode;
  if(mode !== 'none' && mode !== 'inherit' && mode !== 'profile'){
    return {ok:false, error:'weather mode must be none, inherit, or profile'};
  }
  if(mode !== 'profile'){
    draft.weather = {mode, profileId:null, name:null};
    draft.weatherMentioned = true;
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
  draft.weatherMentioned = true;
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
  return typeof normalizeWeatherRule === 'function' ? rules.map(normalizeWeatherRule) : rules;
}

function assistantProfileCoversHints(profile, hints){
  if(!hints || !hints.mentioned)return false;
  const rules = (profile && profile.rules) || [];
  const hasMax = metric => rules.some(rule => rule && rule.metric === metric && (rule.max != null || rule.relative === 'low'));
  const hasMin = (metrics, floor) => rules.some(rule => rule && metrics.includes(rule.metric) && rule.min != null && rule.min >= floor);
  if(hints.notRaining && !hasMax('precipitation_probability') && !hasMax('precipitation'))return false;
  if(hints.notSnowing && !hasMax('snowfall') && !hints.notRaining)return false;
  if(hints.notFreezing && !hasMin(['temperature_2m','apparent_temperature'], 0))return false;
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

function assistantAttachParsedWeather(draft, parsed, catalog, settings){
  if(!draft || draft.weather)return draft;
  if(parsed && parsed.weather){
    const applied = assistantApplyWeather(draft, {mode:'profile', profile:parsed.weather}, catalog);
    if(applied && applied.ok)Object.assign(draft, applied.draft);
    if(draft.weather)return draft;
  }
  const hints = parsed && parsed.weatherHints;
  if(!hints || !hints.mentioned)return draft;
  const profiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(settings && settings.weatherProfiles)
    : ((settings && settings.weatherProfiles) || []);
  const cover = profiles.find(profile => assistantProfileCoversHints(profile, hints));
  if(cover){
    draft.weather = {mode:'profile', profileId:cover.id, name:cover.name};
    draft.weatherMentioned = true;
    return draft;
  }
  const rules = assistantWeatherRulesFromHints(hints);
  if(!rules.length)return draft;
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  if(profiles.length >= cap){
    draft.weatherNeedAsk = {
      question:`You already have ${cap} weather profiles. Use one of: ${profiles.map(item => item.name).join(', ')}, or say "no weather".`,
      choices:profiles.map(item => item.name).concat(['no weather'])
    };
    draft.weatherMentioned = true;
    return draft;
  }
  const name = assistantUniqueWeatherName(
    hints.notRaining && hints.notFreezing ? 'Outdoor' : (hints.notFreezing ? 'Above freezing' : 'Dry'),
    profiles
  );
  draft.weatherProposed = {name, rules, hints};
  draft.weather = {mode:'profile', profileId:null, name, pending:true};
  draft.weatherMentioned = true;
  return draft;
}

function assistantEnsureProposedWeather(draft, settings){
  if(!draft || !draft.weatherProposed || (draft.weather && draft.weather.profileId))return draft;
  const current = settings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  let profiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(current.weatherProfiles)
    : ((current.weatherProfiles || []).slice());
  const cover = profiles.find(profile => assistantProfileCoversHints(profile, draft.weatherProposed.hints));
  if(cover){
    draft.weather = {mode:'profile', profileId:cover.id, name:cover.name};
    draft.weatherProposed = null;
    return draft;
  }
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  if(profiles.length >= cap)return draft;
  const id = `weather-${Date.now().toString(36)}`;
  const name = assistantUniqueWeatherName(draft.weatherProposed.name, profiles);
  const rules = (draft.weatherProposed.rules || []).map(rule =>
    typeof normalizeWeatherRule === 'function' ? normalizeWeatherRule(rule) : rule
  );
  profiles = profiles.concat([{id, name, rules}]);
  if(typeof saveSortSettings === 'function'){
    saveSortSettings({...current, weatherProfiles:profiles});
  }
  if(typeof sortSettings !== 'undefined' && sortSettings)sortSettings.weatherProfiles = profiles;
  draft.weather = {mode:'profile', profileId:id, name};
  draft.weatherProposed = null;
  return draft;
}

function assistantApplyPlace(draft, args, catalog){
  const wanted = Array.isArray(args && args.names) ? args.names : [];
  const places = (catalog && catalog.places) || [];
  if(!wanted.length){
    draft.places = {ids:[], names:[], anywhere:args && args.anywhere !== false};
    draft.placeMentioned = true;
    return {ok:true, draft};
  }
  if(!places.length){
    return {ok:false, error:'NO_PLACES', ask:'No saved places yet. Add one in Settings → locations, or drop the place.'};
  }
  const ids = [];
  const names = [];
  for(const ref of wanted){
    const match = assistantMatchByName(places, ref);
    if(!match.ok){
      if(match.error === 'AMBIGUOUS'){
        return {ok:false, error:'AMBIGUOUS_PLACE', ask:`Which place: ${match.matches.map(item => item.name).join(', ')}?`};
      }
      return {ok:false, error:'UNKNOWN_PLACE', ask:`Use a saved place: ${places.map(item => item.name).join(', ')}.`};
    }
    if(!match.item.id)return {ok:false, error:'UNKNOWN_PLACE', ask:`Use a saved place: ${places.map(item => item.name).join(', ')}.`};
    if(!ids.includes(match.item.id)){
      ids.push(match.item.id);
      names.push(match.item.name);
    }
  }
  draft.places = {ids, names, anywhere:Boolean(args && args.anywhere)};
  draft.placeMentioned = true;
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
  return out;
}

function assistantNormalizeDraftArgs(args, now){
  const out = Object.assign({}, args || {});
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
  return out;
}

function assistantResolveDraftBase(args, session, context){
  const current = session && session.draft && session.draft.name ? session.draft : null;
  const spoken = String(args && args.name || '').trim();
  const parsedName = session && session.parsed && session.parsed.itemName
    ? String(session.parsed.itemName).trim()
    : '';
  const want = spoken || parsedName;
  const follow = current && session && session.parsed && typeof assistantIsFollowupOnFocus === 'function'
    && assistantIsFollowupOnFocus(session.parsed.text, session.parsed, current);
  if(current && (!want || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(want))
    || (typeof assistantNamesMatch === 'function' && assistantNamesMatch(want, current.name))
    || follow)){
    return {ok:true, draft:{...current}, existing:Boolean(current.hid || current.index != null)};
  }
  if(want && !(typeof assistantIsPronounName === 'function' && assistantIsPronounName(want))){
    const found = typeof assistantFindHabit === 'function' ? assistantFindHabit(context && context.data, want) : {ok:false};
    if(found && found.ok){
      const draft = typeof assistantHabitToDraft === 'function'
        ? assistantHabitToDraft(found.habit, found.index, context && context.settings)
        : assistantEmptyDraft();
      return {ok:true, draft, existing:true};
    }
    const editing = session && session.parsed && session.parsed.intent === 'edit_item';
    if(editing && found && !found.ok)return found;
  }
  if(current)return {ok:true, draft:{...current}, existing:Boolean(current.hid || current.index != null)};
  return {ok:true, draft:assistantEmptyDraft(), existing:false};
}

function assistantApplyDraftItem(args, draft, catalog, now, settings){
  const raw = assistantNormalizeDraftArgs(args, now);
  const seed = draft && draft.name ? draft : assistantEmptyDraft();
  const spokenName = String(raw && raw.name || '').trim().slice(0, ASSISTANT_NAME_MAX);
  const same = seed.name && (!spokenName
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
  if(!kind)kind = 'task';
  const name = (same && next.name)
    ? next.name
    : spokenName;
  if(!name)return {ok:false, error:'name is required'};
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
    if(!applied.ok)next.windowMentioned = true;
    else Object.assign(next, applied.draft);
  }else if(raw.window === null){
    next.windowMentioned = false;
  }
  if(raw.weather && typeof raw.weather === 'object'){
    const applied = assistantApplyWeather(next, raw.weather, catalog);
    if(!applied.ok)return applied;
  }else if(raw.weatherProfile){
    const rawProfile = String(raw.weatherProfile || '').trim().toLowerCase();
    if(rawProfile === 'none' || rawProfile === 'inherit'){
      const applied = assistantApplyWeather(next, {mode:rawProfile}, catalog);
      if(!applied.ok)return applied;
    }else if(!(raw.weatherText && typeof assistantParseWeatherHints === 'function'
      && assistantParseWeatherHints(raw.weatherProfile).mentioned)){
      const applied = assistantApplyWeather(next, {mode:'profile', profile:raw.weatherProfile}, catalog);
      if(!applied.ok)return applied;
    }
  }
  if(raw.weatherText && typeof assistantAttachParsedWeather === 'function' && !next.weather){
    assistantAttachParsedWeather(next, {
      weatherHints:typeof assistantParseWeatherHints === 'function' ? assistantParseWeatherHints(raw.weatherText) : null
    }, catalog, settings);
  }
  if(raw.place && typeof raw.place === 'object'){
    const applied = assistantApplyPlace(next, raw.place, catalog);
    if(!applied.ok)return applied;
  }else if(Array.isArray(raw.placeNames) && raw.placeNames.length){
    const applied = assistantApplyPlace(next, {names:raw.placeNames, anywhere:raw.anywhere}, catalog);
    if(!applied.ok)return applied;
  }
  if(raw.needAsk && raw.ask)return {ok:true, draft:next, ask:String(raw.ask).trim(), choices:null};
  return {ok:true, draft:next};
}

function assistantValidateClassify(args){
  const intent = String(args && args.intent || '').trim();
  if(!ASSISTANT_INTENTS.includes(intent)){
    return {ok:false, error:'intent must be create_task, create_habit, ask_today, complete_item, lookup_item, unclear, or unsupported'};
  }
  return {ok:true, intent, reason:String(args && args.reason || '')};
}

function assistantCompletePreview(found, minutes){
  const done = found.habit && typeof completedToday === 'function' && completedToday(found.habit);
  return {
    ok:true,
    pendingComplete:{
      index:found.index,
      hid:found.hid,
      name:found.name,
      minutes:minutes && minutes > 0 ? minutes : null
    },
    alreadyDone:Boolean(done),
    summary:done
      ? `${found.name} is already logged today.`
      : `Log ${found.name} as done?`
  };
}

function assistantLookupText(found, context){
  const habit = found.habit;
  const name = found.name;
  const today = (context.catalog && context.catalog.today) || {};
  const onOpen = (today.open || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  const onDone = (today.done || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  const overdue = (today.overdue || []).find(item => item.hid === found.hid || assistantNormText(item.name) === assistantNormText(name));
  if(onDone)return `${name} is already done${onDone.clock ? ` (it was at ${onDone.clock})` : ' today'}.`;
  if(onOpen)return onOpen.clock ? `${name} is on today at ${onOpen.clock}.` : `${name} is on today.`;
  if(overdue)return `${name} is overdue.`;
  if(habit && habit.type === 'task'){
    if(typeof isTaskDone === 'function' && isTaskDone(habit))return `${name} is already done.`;
    if(habit.dueDate != null){
      const key = typeof dateKey === 'function' ? dateKey(habit.dueDate) : '';
      return key ? `${name} is a task due ${key}.` : `${name} is a task.`;
    }
    return `${name} is a task.`;
  }
  return `${name} is on your list, but not on today's plan.`;
}

function assistantEndpointFromHabit(habit, role){
  if(!habit)return {kind:'unset'};
  const anchor = role === 'start' ? habit.allowedTimeStartAnchor : habit.allowedTimeEndAnchor;
  const offset = role === 'start' ? habit.allowedTimeStartOffsetMin : habit.allowedTimeEndOffsetMin;
  const minutes = role === 'start' ? habit.allowedTimeStart : habit.allowedTimeEnd;
  if(anchor){
    return {
      kind:'anchor',
      anchor,
      offsetMin:typeof normalizePrayerOffset === 'function' ? normalizePrayerOffset(offset) : (offset || 0)
    };
  }
  if(minutes != null && Number.isFinite(Number(minutes))){
    const mins = Number(minutes);
    return {kind:'clock', minutes:mins, clock:assistantClockLabel(mins)};
  }
  return {kind:'unset'};
}

function assistantHabitToDraft(habit, index, settings){
  const draft = assistantEmptyDraft();
  if(!habit)return draft;
  draft.kind = habit.type === 'task' ? 'task' : 'habit';
  draft.name = String(habit.name || '').slice(0, ASSISTANT_NAME_MAX);
  draft.hid = habit.hid;
  draft.index = index;
  draft.durationMinutes = habit.durationMinutes != null ? habit.durationMinutes : null;
  draft.priority = habit.priority != null ? habit.priority : null;
  if(draft.kind === 'task'){
    draft.dueDate = habit.dueDate != null ? habit.dueDate : null;
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
  }
  const start = assistantEndpointFromHabit(habit, 'start');
  const end = assistantEndpointFromHabit(habit, 'end');
  if(start.kind !== 'unset' || end.kind !== 'unset'){
    draft.window = {start, end};
    draft.windowMentioned = true;
  }
  if(habit.weatherProfileMode && habit.weatherProfileMode !== 'inherit'){
    const profiles = (settings && settings.weatherProfiles) || [];
    const profile = profiles.find(item => item && item.id === habit.weatherProfileId);
    draft.weather = {
      mode:habit.weatherProfileMode,
      profileId:habit.weatherProfileMode === 'profile' ? habit.weatherProfileId : null,
      name:profile ? profile.name : null
    };
    draft.weatherMentioned = true;
  }
  if(Array.isArray(habit.locationIds) && habit.locationIds.length){
    const locs = (settings && settings.locations) || [];
    const names = habit.locationIds.map(id => {
      const loc = locs.find(item => item && item.id === id);
      return loc && loc.name;
    }).filter(Boolean);
    draft.places = {ids:habit.locationIds.slice(), names, anywhere:Boolean(habit.anywhereAllowed)};
    draft.placeMentioned = true;
  }
  return draft;
}

function assistantPatchDraftFromParsed(draft, parsed, catalog, settings){
  if(!draft || !parsed)return draft;
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
  if(parsed.window){
    draft.window = parsed.window;
    draft.windowMentioned = true;
  }
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
  if(name === 'draft_item'){
    const nextArgs = assistantMergeExtractedArgs(args, session.parsed);
    const resolved = assistantResolveDraftBase(nextArgs, session, context);
    if(!resolved.ok)return resolved;
    if(resolved.draft && resolved.draft.name){
      nextArgs.kind = nextArgs.kind || resolved.draft.kind;
      if(!nextArgs.name || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(nextArgs.name))){
        nextArgs.name = resolved.draft.name;
      }
    }
    const applied = assistantApplyDraftItem(nextArgs, resolved.draft, catalog, context.now, context.settings);
    if(applied.ok){
      if(session.parsed && typeof assistantPatchDraftFromParsed === 'function'
        && typeof assistantHasPatchFields === 'function' && assistantHasPatchFields(session.parsed)){
        assistantPatchDraftFromParsed(applied.draft, session.parsed, catalog, context.settings);
      }
      if(typeof assistantEnrichDraft === 'function' && session.parsed){
        assistantEnrichDraft(applied.draft, session.parsed, catalog, context.settings);
      }
      session.draft = applied.draft;
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
  if(name === 'complete_item'){
    const want = (args && args.name) || (session.draft && session.draft.name);
    const found = assistantFindHabit(context.data, want);
    if(!found.ok)return found;
    if(typeof replicaDeviceBlocksCompletion === 'function' && replicaDeviceBlocksCompletion(found.hid)){
      return {ok:false, error:'This screen is view only. Open the main Tings app on this computer to log it.'};
    }
    const minutes = args && args.minutes != null ? assistantParseDuration(args.minutes) : null;
    const preview = assistantCompletePreview(found, minutes);
    session.pendingComplete = preview.pendingComplete;
    if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
    return preview;
  }
  if(name === 'lookup_item'){
    const want = (args && args.name) || (session.draft && session.draft.name);
    const found = assistantFindHabit(context.data, want);
    if(!found.ok)return found;
    if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
    return {ok:true, text:assistantLookupText(found, context), found};
  }
  return {ok:false, error:`unknown tool ${name}`};
}

function assistantEndpointSummary(end){
  if(!end || end.kind === 'unset')return 'any';
  if(end.kind === 'clock')return end.clock;
  const labels = typeof PRAYER_ANCHOR_LABELS !== 'undefined' ? PRAYER_ANCHOR_LABELS : {};
  const label = labels[end.anchor] || end.anchor;
  const off = end.offsetMin || 0;
  if(!off)return label;
  const abs = Math.abs(off);
  const rel = off < 0 ? 'before' : 'after';
  if(abs % 60 === 0)return `${abs / 60}h ${rel} ${label}`;
  return `${abs}m ${rel} ${label}`;
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
    d:draft.durationMinutes,
    p:draft.priority,
    due:draft.dueDate,
    tm:draft.dueTime,
    t:draft.timesPerPeriod,
    pd:draft.periodDays,
    w:Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays : [],
    win:draft.window || null,
    wea:draft.weather ? {m:draft.weather.mode, i:draft.weather.profileId, n:draft.weather.name} : null,
    pl:draft.places ? {ids:draft.places.ids, a:draft.places.anywhere} : null
  });
}

function assistantPatchChangedDraft(draft, parsed, catalog, settings){
  if(!draft || typeof assistantPatchDraftFromParsed !== 'function')return false;
  const before = assistantDraftFingerprint(draft);
  assistantPatchDraftFromParsed(draft, parsed, catalog, settings);
  return assistantDraftFingerprint(draft) !== before;
}

function assistantDraftSummary(draft, settings){
  if(!draft || !draft.name)return '';
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

function assistantDraftToHabit(draft, settings, now){
  const ts = now != null ? Number(now) : Date.now();
  const s = settings || {};
  const isHabit = draft.kind === 'habit';
  const type = isHabit ? (s.defaultType === 'reduce' ? 'reduce' : 'keepup') : 'task';
  const times = draft.timesPerPeriod || 1;
  const days = draft.periodDays || Math.round(s.defaultTarget || 7);
  const target = isHabit
    ? (typeof targetFromRhythmParts === 'function' ? targetFromRhythmParts(times, days) : days / times)
    : null;
  const record = {
    name:String(draft.name || '').slice(0, ASSISTANT_NAME_MAX),
    type,
    target,
    lastLog:null,
    logs:[],
    emoji:'',
    pinned:false,
    showOnSharedDisplay:true,
    allowSharedDisplayCompletion:true,
    priority:draft.priority != null ? draft.priority : (s.defaultPriority != null ? s.defaultPriority : 2),
    topics:Array.isArray(s.defaultTopics) ? s.defaultTopics.slice() : [],
    locationIds:draft.places && Array.isArray(draft.places.ids) ? draft.places.ids.slice() : [],
    anywhereAllowed:draft.places ? Boolean(draft.places.anywhere || !draft.places.ids.length) : true,
    durationMinutes:draft.durationMinutes != null ? draft.durationMinutes : s.defaultDurationMinutes,
    breakable:Boolean(s.defaultBreakable),
    minChunkMinutes:s.defaultMinChunkMinutes,
    createdAt:ts,
    earlyWindowDays:s.defaultEarlyWindowDays,
    delayAllowanceDays:s.defaultDelayAllowanceDays,
    autoMarkMinutes:s.defaultAutoMarkMinutes
  };
  if(isHabit){
    record.allowedWeekdays = typeof normalizeAllowedWeekdays === 'function'
      ? normalizeAllowedWeekdays(draft.allowedWeekdays || [])
      : (Array.isArray(draft.allowedWeekdays) ? draft.allowedWeekdays.slice() : []);
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
  }
  if(draft.weather && !draft.weather.pending){
    record.weatherProfileMode = draft.weather.mode;
    record.weatherProfileId = draft.weather.mode === 'profile' ? draft.weather.profileId : null;
  }
  const win = draft.window;
  if(win){
    record.allowedTimeStart = null;
    record.allowedTimeEnd = null;
    record.allowedTimeStartAnchor = null;
    record.allowedTimeStartOffsetMin = 0;
    record.allowedTimeEndAnchor = null;
    record.allowedTimeEndOffsetMin = 0;
    if(win.start && win.start.kind === 'clock')record.allowedTimeStart = win.start.minutes;
    if(win.end && win.end.kind === 'clock')record.allowedTimeEnd = win.end.minutes;
    if(win.start && win.start.kind === 'anchor'){
      record.allowedTimeStartAnchor = win.start.anchor;
      record.allowedTimeStartOffsetMin = win.start.offsetMin || 0;
    }
    if(win.end && win.end.kind === 'anchor'){
      record.allowedTimeEndAnchor = win.end.anchor;
      record.allowedTimeEndOffsetMin = win.end.offsetMin || 0;
    }
  }
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
  const opts = pending.minutes ? {minutes:pending.minutes} : {};
  if(typeof logTing === 'function'){
    const ok = logTing(index, opts);
    return ok ? {ok:true, index, name:data[index] && data[index].name} : {ok:false, error:'could not log'};
  }
  const habit = data[index];
  if(!habit)return {ok:false, error:'that item is gone'};
  const ts = Date.now();
  const logs = typeof normalizeLogs === 'function' ? normalizeLogs(habit.logs) : (habit.logs || []).slice();
  logs.push(typeof makeActualLog === 'function' ? makeActualLog(ts, opts) : ts);
  habit.logs = logs;
  habit.lastLog = ts;
  if(typeof save === 'function' && !save(data))return {ok:false, error:'could not save'};
  return {ok:true, index, name:habit.name};
}

function assistantFocusHabit(session, found, context){
  if(!session || !found || !found.habit)return null;
  session.draft = typeof assistantHabitToDraft === 'function'
    ? assistantHabitToDraft(found.habit, found.index, context && context.settings)
    : assistantEmptyDraft();
  return session.draft;
}

function assistantMaybeFocusFound(session, found, context){
  if(!session || !found || !found.ok)return null;
  if(session.draft && session.draft.name && !session.draft.hid)return session.draft;
  return assistantFocusHabit(session, found, context);
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
  if(typeof load !== 'function' || typeof save !== 'function')return {ok:false, error:'save unavailable'};
  const data = load();
  const existing = assistantDraftExistingIndex(data, draft);
  if(existing < 0 && data.length >= MAX_TINGS)return {ok:false, error:`${MAX_TINGS} habits max`};
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  if(typeof assistantEnsureProposedWeather === 'function')assistantEnsureProposedWeather(draft, settings);
  const record = assistantDraftToHabit(draft, typeof loadSortSettings === 'function' ? loadSortSettings() : settings, Date.now());
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
      emoji:prev.emoji,
      emojiBgColor:prev.emojiBgColor,
      pinned:prev.pinned,
      sample:prev.sample,
      scheduleLinks:prev.scheduleLinks,
      showOnSharedDisplay:prev.showOnSharedDisplay,
      allowSharedDisplayCompletion:prev.allowSharedDisplayCompletion
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

function assistantMissingFollowups(draft){
  const steps = [];
  if(!draft || !draft.name)return ['extract'];
  if(draft.windowMentioned && (!draft.window || (draft.window.start.kind === 'unset' && draft.window.end.kind === 'unset')))steps.push('window');
  if(draft.weatherMentioned && !draft.weather)steps.push('weather');
  if(draft.placeMentioned && !draft.places)steps.push('place');
  return steps;
}
