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
    if(i >= 0)out[i] = Object.assign({}, out[i], rule);
    else out.push(Object.assign({}, rule));
  }
  return typeof normalizeWeatherRule === 'function'
    ? out.slice(0, 8).map(normalizeWeatherRule)
    : out.slice(0, 8);
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
  let rules = assistantMergeWeatherRules(parsed.rules, assistantWeatherRulesFromHints(hints));
  const nameLooksLikeRules = nameWanted && typeof assistantParseWeatherHints === 'function'
    && assistantParseWeatherHints(nameWanted).mentioned
    && !text;
  const profileName = nameLooksLikeRules ? '' : nameWanted;
  const catalogWeather = (catalog && catalog.weather) || [];
  if(profileName){
    const match = assistantMatchByName(catalogWeather, profileName);
    if(match.ok){
      draft.weather = {mode:'profile', profileId:match.item.id, name:match.item.name};
      draft.weatherNeedAsk = null;
      if(rules.length && draft.kind === 'weather'){
        draft.weatherProposed = {
          name:match.item.name,
          rules:assistantMergeWeatherRules((match.item.rules || []), rules),
          hints
        };
        draft.settingId = match.item.id;
      }else{
        draft.weatherProposed = null;
      }
      return draft;
    }
  }
  const profiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(settings && settings.weatherProfiles)
    : ((settings && settings.weatherProfiles) || []);
  if(hints && hints.mentioned && draft.kind !== 'weather'){
    const cover = profiles.find(profile => assistantProfileCoversHints(profile, hints));
    if(cover){
      draft.weather = {mode:'profile', profileId:cover.id, name:cover.name};
      draft.weatherProposed = null;
      draft.weatherNeedAsk = null;
      return draft;
    }
  }
  if(!rules.length && !profileName && !(hints && hints.mentioned) && draft.kind !== 'weather')return draft;
  const cap = typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 4;
  const existingId = draft.settingId || (draft.weather && draft.weather.profileId);
  const existing = existingId ? profiles.find(profile => profile && profile.id === existingId) : null;
  if(!existing && profiles.length >= cap && draft.kind !== 'weather'){
    draft.weatherNeedAsk = assistantWeatherCapAsk(profiles);
    return draft;
  }
  if(draft.weatherProposed && Array.isArray(draft.weatherProposed.rules)){
    rules = assistantMergeWeatherRules(draft.weatherProposed.rules, rules);
  }
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
  if(!draft || !draft.weatherProposed || (draft.weather && draft.weather.profileId && draft.kind !== 'weather'))return draft;
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

function assistantApplyPlace(draft, args, catalog){
  const wanted = Array.isArray(args && args.names) ? args.names : [];
  const places = (catalog && catalog.places) || [];
  if(!wanted.length){
    draft.places = {ids:[], names:[], anywhere:args && args.anywhere !== false};
    return {ok:true, draft};
  }
  if(!places.length)return assistantPlaceAsk('NO_PLACES', places);
  const ids = [];
  const names = [];
  for(const ref of wanted){
    const match = assistantMatchByName(places, ref);
    if(!match.ok)return assistantPlaceAsk(match.error, places, match.matches);
    if(!match.item || !match.item.id)return assistantPlaceAsk('UNKNOWN', places);
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
        ? assistantHabitToDraft(found.habit, found.index, context && context.settings, context && context.data)
        : assistantEmptyDraft();
      return {ok:true, draft, existing:true};
    }
    const editing = session && session.parsed && session.parsed.intent === 'edit_item';
    if(editing && found && !found.ok)return found;
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

function assistantApplyDraftItem(args, draft, catalog, now, settings, data, requestText){
  const salvaged = typeof assistantSalvageDraftArgs === 'function'
    ? assistantSalvageDraftArgs(args, requestText)
    : args;
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
    const applied = assistantApplyPlace(next, placeArgs, catalog);
    if(!applied.ok){
      if(next.name && applied.ask){
        return {ok:true, draft:next, ask:applied.ask, error:applied.error, choices:applied.choices || null};
      }
      return applied;
    }
  }
  if(raw.needAsk && raw.ask)return {ok:true, draft:next, ask:String(raw.ask).trim(), choices:null};
  return {ok:true, draft:next};
}

function assistantValidateClassify(args){
  const intent = String(args && args.intent || '').trim();
  if(!ASSISTANT_INTENTS.includes(intent)){
    return {ok:false, error:'intent must be create_task, create_habit, create_setting, ask_today, complete_item, lookup_item, unclear, or unsupported'};
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

function assistantApplyDraftSetting(args, draft, catalog, now, settings, requestText){
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
    const text = raw.weatherText || requestText || '';
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
    if(raw.address != null && String(raw.address).trim())next.address = String(raw.address).trim().slice(0, 120);
    const lat = raw.lat != null ? Number(raw.lat) : next.lat;
    const lng = raw.lng != null ? Number(raw.lng) : next.lng;
    if(Number.isFinite(lat))next.lat = lat;
    if(Number.isFinite(lng))next.lng = lng;
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
      || (session.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind)
        && !(typeof assistantIsItemKind === 'function' && assistantIsItemKind(nextArgs.kind)));
    if(asSetting){
      if(!nextArgs.kind && session.draft && assistantIsSettingKind(session.draft.kind))nextArgs.kind = session.draft.kind;
      const applied = assistantApplyDraftSetting(
        nextArgs,
        session.draft,
        catalog,
        context.now,
        context.settings,
        session && session.parsed && session.parsed.text
      );
      if(applied.ok)session.draft = applied.draft;
      return applied;
    }
    const resolved = assistantResolveDraftBase(nextArgs, session, context);
    if(!resolved.ok)return resolved;
    if(resolved.draft && resolved.draft.name){
      const follow = (session.parsed && typeof assistantLooksLikeSettingFollowup === 'function'
        && assistantLooksLikeSettingFollowup(session.parsed.text))
        || (session.parsed && typeof assistantIsFollowupOnFocus === 'function'
          && assistantIsFollowupOnFocus(session.parsed.text, session.parsed, resolved.draft));
      if(follow)nextArgs.kind = resolved.draft.kind || nextArgs.kind;
      else nextArgs.kind = nextArgs.kind || resolved.draft.kind;
      if(!nextArgs.name || (typeof assistantIsPronounName === 'function' && assistantIsPronounName(nextArgs.name)) || follow){
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
      session && session.parsed && session.parsed.text
    );
    if(applied.draft)session.draft = applied.draft;
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
      const rules = (draft.weatherProposed && draft.weatherProposed.rules) || [];
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
    ? assistantHabitToDraft(found.habit, found.index, context && context.settings, context && context.data)
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
  if(typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)){
    return assistantCommitSetting(draft);
  }
  if(typeof load !== 'function' || typeof save !== 'function')return {ok:false, error:'save unavailable'};
  const data = load();
  const existing = assistantDraftExistingIndex(data, draft);
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
