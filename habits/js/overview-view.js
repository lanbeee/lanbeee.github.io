// Monthly overview, day drill-down (multi-step), and date availability overrides.
//
// This file renders the calendar overview sheet: the month/14-day grid, the
// day drill-down steps (list / item / add plan / availability), and per-date
// availability overrides.
//
// React Native port guide:
//   - RENDER functions  -> React functional components (return JSX).
//   - HANDLER functions -> onPress / onChange callback props.
//   - WIRE functions    -> useEffect setup hooks (attach listeners / gestures).
//   - PURE functions    -> plain helper modules (no change needed).
//   - HYBRID functions  -> split into a component + a callback before porting.

// PURE: maps habit type to entry tone
function entryTone(type){
  if(type === 'zero')return 'miss';
  if(type === 'reduce')return 'warn';
  return 'hit';
}

// PURE: short type label matching add/detail segs
function habitTypeLabel(type){
  if(type === 'keepup')return 'build';
  if(type === 'reduce')return 'limit';
  if(type === 'zero')return 'stop';
  if(type === 'task')return 'task';
  return type || '';
}

// PURE: builds topic filter choice list
function overviewTopicChoices(data){
  const topics = normalizeTopics([...(sortSettings?.topics || []),...data.flatMap(h=>normalizeTopics(h.topics))]);
  const hasNoTopic = data.some(h=>!normalizeTopics(h.topics).length);
  return [{key:'all',label:'all'},...topics.map(topic=>({key:topic,label:topic})),...(hasNoTopic ? [{key:'__none__',label:'no topic'}] : [])];
}

// PURE: tests habit against topic filter
function matchesOverviewTopic(h,topic){
  if(!topic || topic === 'all')return true;
  const topics = normalizeTopics(h.topics);
  if(topic === '__none__')return !topics.length;
  return topics.some(item=>item.toLowerCase() === topic.toLowerCase());
}

// PURE: builds location filter choice list for overview
function overviewLocationChoices(data){
  const registry = normalizeLocationRegistry(sortSettings?.locations);
  const used = new Set(data.flatMap(h=>normalizeLocationIds(h.locationIds,registry)));
  const locs = registry.filter(loc=>used.has(loc.id));
  const hasNone = data.some(h=>!normalizeLocationIds(h.locationIds,registry).length);
  return [
    {key:'all',label:'all places'},
    ...locs.map(loc=>({key:loc.id,label:loc.name})),
    ...(hasNone ? [{key:'__none__',label:'anywhere'}] : [])
  ];
}

// PURE: tests habit against overview location filter
function matchesOverviewLocation(h,id){
  if(!id || id === 'all')return true;
  const ids = normalizeLocationIds(h.locationIds);
  if(id === '__none__')return !ids.length;
  return ids.includes(id);
}

// PURE: habit passes both overview filters
function matchesOverviewFilters(h){
  return matchesOverviewTopic(h,overviewTopicFilter) && matchesOverviewLocation(h,overviewLocationFilter);
}

// "When" pills for the calendar page. 'recent' is the default on open —
// a 14-day strip: 7 days back, today, and 6 days ahead.
const OVERVIEW_RECENT_PAST = 7;
const OVERVIEW_RECENT_AHEAD = 6;
const OVERVIEW_RECENT_DAYS = OVERVIEW_RECENT_PAST + 1 + OVERVIEW_RECENT_AHEAD;
const OVERVIEW_RANGES = [
  {key:'recent',label:'around today'},
  {key:'month',label:'by month'},
  {key:'all',label:'all time'}
];

// HYBRID: one filter row — range + places + topics
function renderOverviewFilters(data){
  const wrap = $('overview-filter');
  if(!wrap)return;
  if(!OVERVIEW_RANGES.some(r=>r.key === overviewRangeFilter))overviewRangeFilter = 'recent';
  const topicChoices = overviewTopicChoices(data);
  const locChoices = overviewLocationChoices(data);
  const hasTopics = topicChoices.length > 0;
  const hasLocs = locChoices.length > 1;
  if(hasTopics && !topicChoices.some(choice=>choice.key === overviewTopicFilter))overviewTopicFilter = 'all';
  if(hasLocs && !locChoices.some(choice=>choice.key === overviewLocationFilter))overviewLocationFilter = 'all';

  const rangeHtml = OVERVIEW_RANGES.map(r=>`
    <button type="button" class="topic-filter range-filter ${r.key === overviewRangeFilter ? 'on' : ''}" data-overview-range="${r.key}">${escapeHtml(r.label)}</button>
  `).join('');
  const locHtml = hasLocs ? locChoices.map(choice=>`
    <button type="button" class="topic-filter location-filter ${choice.key === overviewLocationFilter ? 'on' : ''}" data-overview-location="${escapeHtml(choice.key)}"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(choice.label)}</button>
  `).join('') : '';
  const topicHtml = hasTopics ? topicChoices.map(choice=>`
    <button type="button" class="topic-filter ${choice.key === overviewTopicFilter ? 'on' : ''}" data-overview-topic="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>
  `).join('') : '';
  wrap.hidden = false;
  wrap.innerHTML = rangeHtml + locHtml + topicHtml;
}

// Compat aliases (filters now share one row)
function renderOverviewTagFilter(data){renderOverviewFilters(data);}
function renderOverviewLocationFilter(data){renderOverviewFilters(data);}
function renderOverviewTopicFilter(data){renderOverviewFilters(data);}
function renderOverviewRangeFilter(){renderOverviewFilters(load());}

// PURE: scheduled / due / plan-by markers for a habit (not yet in logs)
function habitPlanMarkers(h){
  const markers = [];
  if(isTimedTask(h) && h.lastLog === null && h.eventTime != null){
    markers.push({ts:h.eventTime,kind:'scheduled',tone:'plan',planned:true});
  }else if(h.type === 'task' && h.eventTime === null && h.dueDate !== null && h.lastLog === null){
    markers.push({ts:h.dueDate,kind:h.hardDue ? 'deadline' : 'due',tone:'plan',planned:true});
  }
  if((h.type === 'keepup' || h.type === 'reduce') && h.planByDate){
    markers.push({ts:h.planByDate,kind:'planBy',tone:'plan',planned:true});
  }
  return markers;
}

// Tallies every log/marker that passes `included(ts)` into a per-day map.
// PURE: tallies per-day log entries and totals
function buildDayTally(data,included){
  const map = new Map();
  let total = 0;
  let actual = 0;
  let planned = 0;
  const toneCounts = {hit:0,warn:0,miss:0,plan:0};
  const addEntry = (ts,entry)=>{
    if(ts == null || !included(ts))return;
    const key = dateKey(ts);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(entry);
    total += 1;
    if(entry.planned)planned += 1;
    else actual += 1;
    toneCounts[entry.tone] = (toneCounts[entry.tone] || 0) + 1;
  };
  data.forEach(h=>{
    const toneByDay = logToneMap(h);
    normalizeLogs(h.logs).forEach(log=>{
      const ts = logTime(log);
      const isPlan = isPlanLog(log);
      const key = dateKey(ts);
      const tone = isPlan ? 'plan' : toneByDay.get(key) || entryTone(h.type);
      addEntry(ts,{name:h.name,type:h.type,tone,planned:isPlan,kind:isPlan ? 'plan' : 'actual'});
    });
    habitPlanMarkers(h).forEach(marker=>{
      addEntry(marker.ts,{name:h.name,type:h.type,tone:marker.tone,planned:true,kind:marker.kind,scheduled:true});
    });
  });
  return {map,total,actual,planned,toneCounts};
}

// PURE: unified density class for calendar cells
function calDensityClass(count){
  if(count >= 3)return 'density-3';
  if(count >= 2)return 'density-2';
  if(count)return 'density-1';
  return '';
}

// PURE: builds calendar day cell HTML (overview grid / strip)
function cellMarkup(key,date,entries,extraSpans = ''){
  const tones = ['hit','warn','miss','plan','agenda']
    .filter(tone=>entries.some(item=>item.tone === tone))
    .slice(0,4);
  const dots = tones.map(tone=>`<span class="cal-dot ${tone}"></span>`).join('');
  const more = entries.length > tones.length ? `<span class="cal-more">${entries.length}</span>` : '';
  const density = calDensityClass(entries.length);
  const future = key > todayIso();
  const cls = [
    entries.length ? 'has-entry' : '',
    density,
    future ? 'future' : '',
    key === todayIso() ? 'today' : '',
    key === dayLogsKey ? 'selected' : '',
    'pickable'
  ].filter(Boolean).join(' ');
  return `<button class="cal-day ${cls}" data-log-day="${key}">${extraSpans}<span class="cal-dots">${dots}</span>${more}</button>`;
}

// PURE: build an N-day strip's tally + cell HTML starting at startTs.
function dayStripMarkup(data,startTs,days,{agendaByDay = null} = {}){
  const end = startTs + days * 86400000;
  const tally = buildDayTally(data,ts=>ts >= startTs && ts < end);
  if(agendaByDay instanceof Map){
    agendaByDay.forEach((items,key)=>{
      const ts = new Date(`${key}T12:00:00`).getTime();
      if(ts < startTs || ts >= end)return;
      if(!tally.map.has(key))tally.map.set(key,[]);
      const entries = tally.map.get(key);
      items.forEach(item=>{
        if(entries.some(e=>e.name === item.name && (e.kind === 'agenda' || !e.planned)))return;
        entries.push(item);
        tally.planned += 1;
        tally.total += 1;
        tally.toneCounts.plan = (tally.toneCounts.plan || 0) + 1;
      });
    });
  }
  const html = Array.from({length:days},(_,i)=>{
    const ts = startTs + i * 86400000;
    const date = new Date(ts);
    const key = dateKey(ts);
    const entries = tally.map.get(key) || [];
    const labelSpans = `<span class="strip-wd">${weekdayShort(date.getDay())}</span><span class="strip-num">${date.getDate()}</span>`;
    return cellMarkup(key,date,entries,labelSpans);
  }).join('');
  return {tally,html};
}

// PURE: week-agenda placements keyed by day (today → +6). Reuses home's
// cached week when available so opening calendar stays cheap.
function overviewAgendaByDay(data){
  const byDay = new Map();
  if(overviewRecentOffset !== 0)return byDay;
  let week = (typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days))
    ? _homeRenderedWeek
    : null;
  if(!week && typeof buildWeekAgenda === 'function' && sortSettings){
    try{ week = buildWeekAgenda(data,sortSettings,7); }
    catch(_err){ week = null; }
  }
  if(!week || !Array.isArray(week.days))return byDay;
  week.days.forEach(day=>{
    const key = dateKey(day.dayBase);
    const rows = (day.homeDisplayedTimeline && day.homeDisplayedTimeline.length)
      ? day.homeDisplayedTimeline
      : (day.timeline || []);
    const items = [];
    const seen = new Set();
    const pushHabit = (h,kind)=>{
      if(!h || seen.has(h.hid || h.name))return;
      seen.add(h.hid || h.name);
      items.push({name:h.name,type:h.type,tone:'agenda',planned:true,kind:kind || 'agenda'});
    };
    rows.forEach(row=>{
      if(row.kind !== 'fill' && row.kind !== 'scheduled')return;
      pushHabit(row.h || data[row.i], row.kind === 'scheduled' ? 'scheduled' : 'agenda');
    });
    (day.agendaItems || []).forEach(item=>pushHabit(item.h,'agenda'));
    if(items.length)byDay.set(key,items);
  });
  return byDay;
}

// RENDER: most-active habits (month / all-time)
function renderOverviewLists(data,countForHabit,scopeNote = ''){
  hideOverviewStretchChrome();
  const rows = data.map(h=>({h,count:countForHabit(h),c:colors(daysSince(h.lastLog),h.target,h.type)}))
    .filter(item=>item.count > 0).sort((a,b)=>b.count - a.count).slice(0,5);

  if(!rows.length){
    $('overview-list').innerHTML = '<div class="overview-item"><span class="overview-name">quiet stretch</span><span class="overview-meta">no entries yet</span></div>';
    return;
  }
  $('overview-list').innerHTML = `<p class="overview-section-title">most active${scopeNote}</p>${rows.map(({h,count,c})=>`
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}`;
}

// HYBRID: hide around-today insight + pane chrome (month / all-time)
function hideOverviewStretchChrome(){
  _overviewStretchCache = null;
  const insight = $('overview-insight');
  const panes = $('overview-pane-filter');
  if(insight){insight.hidden = true;insight.innerHTML = '';}
  if(panes){panes.hidden = true;panes.innerHTML = '';}
  syncOverviewLegend(false);
}

// PURE: short duration label for insight chips
function overviewMinutesLabel(minutes){
  if(typeof capacityMinutesLabel === 'function')return capacityMinutesLabel(minutes);
  if(typeof formatFreeDuration === 'function')return formatFreeDuration(minutes);
  const m = Math.max(0,Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if(!h)return `${r}m`;
  if(!r)return `${h}h`;
  return `${h}h ${r}m`;
}

// PURE: weekday short label for a day key
function overviewDayChipLabel(key){
  const today = todayIso();
  if(key === today)return 'today';
  const tomorrow = dateKey(dayStart(Date.now()) + 86400000);
  if(key === tomorrow)return 'tomorrow';
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'});
}

// PURE: week capacity summary for today → +6 (planning cue)
function overviewWeekCapacity(data){
  let week = (typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days))
    ? _homeRenderedWeek
    : null;
  if(!week && typeof buildWeekAgenda === 'function' && sortSettings){
    try{ week = buildWeekAgenda(data,sortSettings,7); }
    catch(_err){ week = null; }
  }
  if(!week || !Array.isArray(week.days) || !week.days.length){
    // Fallback: availability only (no placements)
    const days = [];
    let openTotal = 0;
    for(let i = 0;i < 7;i += 1){
      const base = dayStart(Date.now()) + i * 86400000;
      const key = dateKey(base);
      const open = typeof effectiveAvailabilityMinutes === 'function'
        ? effectiveAvailabilityMinutes(key,sortSettings)
        : 0;
      openTotal += open;
      days.push({key,open,used:0,total:open,load:0});
    }
    return {openTotal,days,lightest:days.slice().sort((a,b)=>b.open - a.open)[0] || null,busiest:null,tomorrow:days[1] || null};
  }
  const days = week.days.map(day=>{
    const key = dateKey(day.dayBase);
    const timeline = day.homeDisplayedTimeline || day.timeline || [];
    const load = timeline.filter(row=>row.kind === 'fill' || row.kind === 'scheduled').length
      + (day.agendaItems ? day.agendaItems.length : 0);
    const total = Math.max(0,Math.round(Number(day.totalMinutes) || 0));
    const used = Math.max(0,Math.round(Number(day.usedMinutes) || 0));
    const open = day.remainingMinutes != null
      ? Math.max(0,Math.round(Number(day.remainingMinutes) || 0))
      : Math.max(0,total - used);
    return {key,open,used,total,load,isToday:!!day.isToday};
  });
  const openTotal = days.reduce((sum,d)=>sum + d.open,0);
  const lightest = days.slice().sort((a,b)=>b.open - a.open || a.load - b.load)[0] || null;
  const busiest = days.slice().sort((a,b)=>a.open - b.open || b.load - a.load)[0] || null;
  const tomorrowKey = dateKey(dayStart(Date.now()) + 86400000);
  const tomorrow = days.find(d=>d.key === tomorrowKey) || null;
  return {openTotal,days,lightest,busiest,tomorrow};
}

// PURE: build ahead / care / past rows for stretch panes
function buildOverviewStretchLists(data,tally,start,end){
  const today = todayIso();
  const ahead = [];
  const care = [];
  const past = [];
  const seenAhead = new Set();
  const seenCare = new Set();

  tally.map.forEach((entries,key)=>{
    entries.forEach(entry=>{
      const id = entry.name;
      if(key >= today){
        if(entry.planned && !seenAhead.has(id)){
          seenAhead.add(id);
          ahead.push({key,entry,label:dayMarkerKindLabel(entry.kind) || overviewToneLabel(entry.tone) || 'planned'});
        }
      }else{
        if((entry.tone === 'miss' || entry.kind === 'deadline') && !entry.planned && !seenCare.has(id)){
          seenCare.add(id);
          care.push({key,entry,label:'behind'});
        }
        if(!entry.planned){
          past.push({key,entry,label:overviewToneLabel(entry.tone) || 'done'});
        }
      }
    });
  });

  data.forEach(h=>{
    habitPlanMarkers(h).forEach(marker=>{
      const key = dateKey(marker.ts);
      if(key >= today || key < dateKey(start))return;
      if(seenCare.has(h.name))return;
      seenCare.add(h.name);
      care.push({
        key,
        entry:{name:h.name,type:h.type,tone:'miss',planned:true,kind:marker.kind},
        label:dayMarkerKindLabel(marker.kind) || 'due'
      });
    });
  });

  ahead.sort((a,b)=>a.key.localeCompare(b.key) || a.entry.name.localeCompare(b.entry.name));
  care.sort((a,b)=>b.key.localeCompare(a.key) || a.entry.name.localeCompare(b.entry.name));
  past.sort((a,b)=>b.key.localeCompare(a.key) || a.entry.name.localeCompare(b.entry.name));
  return {ahead,care,past:past.slice(0,12)};
}

// RENDER: compact future insight (open hours + where to plan)
function renderOverviewInsight(capacity){
  const wrap = $('overview-insight');
  if(!wrap)return;
  if(overviewRecentOffset !== 0 || overviewRangeFilter !== 'recent' || !capacity){
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  const openLabel = overviewMinutesLabel(capacity.openTotal);
  const cues = [];
  if(capacity.lightest && capacity.lightest.open > 0){
    cues.push(`${overviewDayChipLabel(capacity.lightest.key)} lightest (${overviewMinutesLabel(capacity.lightest.open)})`);
  }
  if(capacity.tomorrow){
    if(capacity.tomorrow.open <= 30 || capacity.tomorrow.load >= 4){
      cues.push('tomorrow packed');
    }else if(capacity.tomorrow.open >= 120 && capacity.tomorrow.load <= 1){
      cues.push('tomorrow open');
    }else{
      cues.push(`tomorrow ${overviewMinutesLabel(capacity.tomorrow.open)} open`);
    }
  }else if(capacity.busiest && capacity.busiest.key !== capacity.lightest?.key && capacity.busiest.open < capacity.lightest?.open){
    cues.push(`${overviewDayChipLabel(capacity.busiest.key)} busier`);
  }
  const chips = capacity.days.slice(0,7).map(day=>{
    const tone = day.open >= 120 ? 'open' : day.open <= 30 ? 'tight' : 'mid';
    return `<button type="button" class="overview-open-chip ${tone}" data-log-day="${escapeHtml(day.key)}" title="${escapeHtml(overviewMinutesLabel(day.open))} open">
      <span>${escapeHtml(overviewDayChipLabel(day.key))}</span>
      <b>${escapeHtml(overviewMinutesLabel(day.open))}</b>
    </button>`;
  }).join('');
  wrap.innerHTML = `
    <div class="overview-insight-head">
      <span class="overview-insight-stat"><b>${escapeHtml(openLabel)}</b> open this week</span>
      ${cues.length ? `<span class="overview-insight-cue">${escapeHtml(cues.join(' · '))}</span>` : ''}
    </div>
    <div class="overview-open-chips" aria-label="open time by day">${chips}</div>`;
}

// RENDER: plan | care | past pane pills (plain labels)
function renderOverviewPaneFilter(cache){
  const wrap = $('overview-pane-filter');
  if(!wrap)return;
  if(overviewRecentOffset !== 0 || overviewRangeFilter !== 'recent' || !cache){
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  const panes = [
    {key:'plan',label:'coming up',count:cache.ahead.length},
    {key:'care',label:'attention',count:cache.care.length},
    {key:'past',label:'recent',count:cache.past.length}
  ];
  if(!panes.some(p=>p.key === overviewListPane))overviewListPane = 'plan';
  wrap.hidden = false;
  wrap.innerHTML = panes.map(p=>`
    <button type="button" class="topic-filter overview-pane ${p.key === overviewListPane ? 'on' : ''}" data-overview-pane="${p.key}">
      ${escapeHtml(p.label)}${p.count ? `<span class="overview-pane-count">${p.count}</span>` : ''}
    </button>
  `).join('');
}

// RENDER: one stretch pane at a time
function renderOverviewStretchPane(data,cache,capacity){
  const fmtDay = key => new Date(`${key}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const rowHtml = (rows,emptyName,emptyMeta,limit = 4) => rows.length
    ? rows.slice(0,limit).map(({key,entry,label})=>{
      const h = data.find(item=>item.name === entry.name);
      const c = h ? colors(daysSince(h.lastLog),h.target,h.type) : colors(null,null,entry.type);
      return `<div class="overview-item">
        <span class="overview-name">${h ? iconHtml(h,c) : ''}${escapeHtml(entry.name)}</span>
        <span class="overview-meta">${escapeHtml(label)} · ${escapeHtml(fmtDay(key))}</span>
      </div>`;
    }).join('')
    : `<div class="overview-item"><span class="overview-name">${escapeHtml(emptyName)}</span><span class="overview-meta">${escapeHtml(emptyMeta)}</span></div>`;

  if(overviewListPane === 'care'){
    $('overview-list').innerHTML = `<p class="overview-section-title">needs attention</p>${rowHtml(cache.care,'all clear','nothing needs attention')}`;
    return;
  }
  if(overviewListPane === 'past'){
    $('overview-list').innerHTML = `<p class="overview-section-title">recent</p>${rowHtml(cache.past,'quiet week','no entries yet')}`;
    return;
  }

  // coming up — tip + short list
  let tip = '';
  if(capacity?.lightest && capacity.lightest.open > 0){
    tip = `<div class="overview-plan-tip">
      <span>best day to plan</span>
      <button type="button" class="mini-text-btn" data-log-day="${escapeHtml(capacity.lightest.key)}">${escapeHtml(overviewDayChipLabel(capacity.lightest.key))} · ${escapeHtml(overviewMinutesLabel(capacity.lightest.open))} open</button>
    </div>`;
  }
  $('overview-list').innerHTML = `${tip}<p class="overview-section-title">coming up</p>${rowHtml(cache.ahead,'nothing coming up','plan a light day above',4)}`;
}

// PURE: pick default pane — coming up, unless empty and attention has items
function pickOverviewListPane(lists){
  if(overviewListPane === 'past')return 'past';
  if(overviewListPane === 'care' && lists.care.length)return 'care';
  if(!lists.ahead.length && lists.care.length)return 'care';
  return 'plan';
}

// RENDER: around-today insight + one detail pane
function renderOverviewStretchLists(data,tally,start,end){
  const capacity = overviewRecentOffset === 0 ? overviewWeekCapacity(data) : null;
  const lists = buildOverviewStretchLists(data,tally,start,end);
  overviewListPane = pickOverviewListPane(lists);
  _overviewStretchCache = {data,tally,start,end,capacity,lists};
  renderOverviewInsight(capacity);
  renderOverviewPaneFilter(lists);
  renderOverviewStretchPane(data,lists,capacity);
  syncOverviewLegend(true);
}

// RENDER: compact legend on around-today; fuller key on month browse
function syncOverviewLegend(aroundToday){
  const legend = $('overview-legend');
  if(!legend)return;
  if(aroundToday){
    legend.className = 'calendar-legend overview-legend-compact';
    legend.innerHTML = `
      <span><b class="hit"></b>done</span>
      <span><b class="plan"></b>planned</span>
      <span><b class="agenda"></b>on agenda</span>`;
  }else{
    legend.className = 'calendar-legend';
    legend.innerHTML = `
      <span><b class="hit"></b>done</span>
      <span><b class="warn"></b>almost</span>
      <span><b class="miss"></b>behind</span>
      <span><b class="plan"></b>planned</span>`;
  }
}

// HYBRID: switch plan/care/past without rebuilding the strip
function setOverviewListPane(pane){
  if(!['plan','care','past'].includes(pane))return;
  overviewListPane = pane;
  const cache = _overviewStretchCache;
  if(!cache){
    renderOverview();
    return;
  }
  renderOverviewPaneFilter(cache.lists);
  renderOverviewStretchPane(cache.data,cache.lists,cache.capacity);
}

// RENDER: toggles month nav buttons and label
function setOverviewMonthNav(showNav,label){
  $('overview-prev-month').hidden = !showNav;
  $('overview-next-month').hidden = !showNav;
  $('overview-calendar-label').textContent = label;
}

// RENDER: orchestrates full overview sheet render
function renderOverview(){
  const allData = load();
  renderOverviewFilters(allData);
  const data = allData.filter(matchesOverviewFilters);
  if(overviewRangeFilter === 'recent')renderOverviewRecent(data);
  else renderOverviewMonth(data,overviewRangeFilter === 'all');
}

// RENDER: 14-day strip centered on today (past 7 · today · next 6)
function renderOverviewRecent(data){
  const today = dayStart(Date.now());
  const shift = overviewRecentOffset * 86400000;
  const start = today - OVERVIEW_RECENT_PAST * 86400000 + shift;
  const end = today + (OVERVIEW_RECENT_AHEAD + 1) * 86400000 + shift;
  const agendaByDay = overviewAgendaByDay(data);
  const {tally,html:cells} = dayStripMarkup(data,start,OVERVIEW_RECENT_DAYS,{agendaByDay});
  setOverviewMonthNav(true,recentRangeLabel(start,end));

  const grid = $('overview-calendar');
  grid.className = 'month-grid rich-month-grid strip-grid';
  grid.innerHTML = cells;

  renderOverviewStretchLists(data,tally,start,end);
}

// PURE: label for the around-today window
function recentRangeLabel(start,end){
  if(overviewRecentOffset === 0)return 'around today';
  const first = new Date(start);
  const last = new Date(end - 86400000);
  const fmt = d => d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return `${fmt(first)} – ${fmt(last)}`;
}

// RENDER: month grid; all-time mode keeps month browsing but lists use full history
function renderOverviewMonth(data,allTime){
  const frame = monthFrame(overviewMonthOffset);
  const gridTally = buildDayTally(data,ts=>{
    const d = new Date(ts);
    return d.getFullYear() === frame.year && d.getMonth() === frame.month;
  });
  setOverviewMonthNav(true,frame.label);

  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:frame.first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:frame.last.getDate()},(_,i)=>{
    const date = new Date(frame.year,frame.month,i + 1);
    const key = dateKey(date.getTime());
    const entries = gridTally.map.get(key) || [];
    return cellMarkup(key,date,entries,`<span>${i + 1}</span>`);
  });
  const grid = $('overview-calendar');
  grid.className = 'month-grid rich-month-grid';
  grid.innerHTML = [...heads,...blanks,...days].join('');

  const countForHabit = allTime
    ? h=>actualLogs(h.logs).length
    : h=>actualLogs(h.logs).filter(ts=>{
      const d = new Date(ts);
      return d.getFullYear() === frame.year && d.getMonth() === frame.month;
    }).length;
  renderOverviewLists(data,countForHabit,allTime ? ' · all time' : '');
}

// PURE: kind label for day-sheet / list meta (plain language)
function dayMarkerKindLabel(kind){
  if(kind === 'scheduled')return 'scheduled';
  if(kind === 'deadline')return 'deadline';
  if(kind === 'due')return 'due';
  if(kind === 'planBy')return 'plan by';
  if(kind === 'plan')return 'planned';
  if(kind === 'agenda')return 'on agenda';
  return '';
}

// PURE: tone → plain meta label
function overviewToneLabel(tone){
  if(tone === 'miss')return 'behind';
  if(tone === 'warn')return 'almost';
  if(tone === 'hit')return 'done';
  if(tone === 'agenda')return 'on agenda';
  if(tone === 'plan')return 'planned';
  return '';
}

// PURE: collect day rows; when dayLogsScopeIndex is set, only that habit
function collectDayLogRows(key){
  const data = load();
  const rows = [];
  const scoped = Number.isInteger(dayLogsScopeIndex);
  data.forEach((h,i)=>{
    if(scoped){
      if(i !== dayLogsScopeIndex)return;
    }else if(!matchesOverviewFilters(h)){
      return;
    }
    const entries = normalizeLogs(h.logs).filter(log=>dateKey(logTime(log)) === key);
    const scheduled = [];
    habitPlanMarkers(h).forEach(marker=>{
      if(dateKey(marker.ts) === key)scheduled.push(marker.kind);
    });
    if(!entries.length && !scheduled.length && !scoped)return;
    rows.push({
      h,
      index:i,
      entries,
      scheduled,
      c:colors(daysSince(h.lastLog),h.target,h.type)
    });
  });
  return rows;
}

// PURE: day-scoped meta line for a row
function dayRowMeta(row){
  const plannedCount = row.entries.filter(isPlanLog).length;
  const actualCount = row.entries.length - plannedCount;
  const parts = [];
  row.scheduled.forEach(kind=>{
    const label = dayMarkerKindLabel(kind);
    if(label)parts.push(label);
  });
  if(plannedCount)parts.push(`${plannedCount} planned`);
  if(actualCount)parts.push(`${actualCount} done`);
  const cue = typeof cardCue === 'function' ? cardCue(row.h) : '';
  const type = habitTypeLabel(row.h.type);
  const head = [type,cue].filter(Boolean).join(' · ');
  const tail = parts.filter(Boolean).join(' · ');
  return [head,tail].filter(Boolean).join(' · ');
}

// PURE: day sheet is locked to one habit (opened from detail calendar)
function dayLogsScoped(){
  return Number.isInteger(dayLogsScopeIndex);
}

// PURE: can this habit take a new plan?
function dayLogsHabitPlannable(h){
  if(!h)return false;
  if(h.type === 'zero')return false;
  if(h.type === 'task' && h.lastLog !== null)return false;
  return true;
}

// HYBRID: reset day-sheet step state
function resetDayLogsStep(){
  dayLogsStep = 'list';
  dayLogsItemIndex = null;
  dayLogsMoving = false;
  dayLogsScopeIndex = null;
}

// RENDER: orchestrates day drill-down by step
function renderDayLogs(key){
  if(!key)return;
  dayLogsKey = key;
  if(dayLogsScoped()){
    dayLogsItemIndex = dayLogsScopeIndex;
    if(dayLogsStep === 'list' || dayLogsStep === 'avail')dayLogsStep = 'item';
  }else if(dayLogsStep === 'item'){
    if(dayLogsItemIndex == null || !collectDayLogRows(key).some(row=>row.index === dayLogsItemIndex)){
      dayLogsStep = 'list';
      dayLogsItemIndex = null;
      dayLogsMoving = false;
    }
  }
  const back = $('day-logs-back');
  if(back)back.hidden = dayLogsScoped() ? true : dayLogsStep === 'list';

  if(dayLogsStep === 'add')renderDayLogsAddStep(key);
  else if(dayLogsStep === 'avail' && !dayLogsScoped())renderDayLogsAvailStep(key);
  else if(dayLogsStep === 'item' || dayLogsScoped())renderDayLogsItemStep(key);
  else renderDayLogsListStep(key);
}

// RENDER: list step — items for the day (overview only)
function renderDayLogsListStep(key){
  const rows = collectDayLogRows(key);
  const ts = new Date(`${key}T12:00:00`).getTime();
  const itemCount = rows.reduce((sum,row)=>sum + row.entries.length + row.scheduled.length,0);
  $('day-logs-title').textContent = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('day-logs-sub').textContent = rows.length
    ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
    : 'no entries yet';

  const body = $('day-logs-body');
  body.innerHTML = rows.length ? `<div class="overview-list day-logs-list">${rows.map(row=>{
    const meta = dayRowMeta(row);
    return `
    <button type="button" class="overview-item plan-item day-log-row" data-day-item="${row.index}">
      <span class="overview-name">${iconHtml(row.h,row.c)} ${escapeHtml(row.h.name)}</span>
      <span class="overview-meta">${escapeHtml(meta)}</span>
      <i class="ti ti-chevron-right day-log-chevron" aria-hidden="true"></i>
    </button>`;
  }).join('')}</div>` : '<div class="overview-list"><div class="overview-item"><span class="overview-name">nothing here yet</span><span class="overview-meta">plan something</span></div></div>';

  $('day-logs-footer').innerHTML = `
    <button class="btn" type="button" id="day-logs-plan">plan</button>
    <button class="btn" type="button" id="day-logs-day">day</button>
    <button class="btn" type="button" id="day-logs-overview">calendar</button>
    <button class="btn primary" type="button" id="day-logs-home">home</button>`;
}

// RENDER: item step — actions for one habit on that day
function renderDayLogsItemStep(key){
  const data = load();
  const idx = dayLogsScoped() ? dayLogsScopeIndex : dayLogsItemIndex;
  const h = data[idx];
  const rows = collectDayLogRows(key);
  let row = rows.find(item=>item.index === idx);
  if(!h){
    if(dayLogsScoped()){
      $('day-logs-title').textContent = 'item';
      $('day-logs-sub').textContent = 'missing';
      $('day-logs-body').innerHTML = '<p class="field-hint">This item is no longer available.</p>';
      $('day-logs-footer').innerHTML = `<button class="btn primary" type="button" id="day-logs-done">done</button>`;
      return;
    }
    dayLogsStep = 'list';
    renderDayLogsListStep(key);
    return;
  }
  if(!row){
    row = {h,index:idx,entries:[],scheduled:[],c:colors(daysSince(h.lastLog),h.target,h.type)};
  }
  dayLogsItemIndex = idx;
  const c = row.c;
  const plannedCount = row.entries.filter(isPlanLog).length;
  const ts = new Date(`${key}T12:00:00`).getTime();
  const dateLabel = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  if(dayLogsScoped()){
    $('day-logs-title').textContent = dateLabel;
    $('day-logs-sub').textContent = dayRowMeta(row) || habitTypeLabel(h.type);
  }else{
    $('day-logs-title').textContent = h.name || 'item';
    $('day-logs-sub').textContent = dayRowMeta(row);
  }

  const moveBlock = dayLogsMoving ? `
    <label class="move-inline day-move-inline">
      <input type="date" class="move-date" id="day-move-date" value="${key}" data-move-from="${key}" />
      <button class="mini-text-btn" type="button" data-move-go="${idx}">save</button>
      <button class="mini-text-btn" type="button" data-move-cancel>cancel</button>
    </label>` : '';

  const actions = [];
  if(!dayLogsScoped()){
    actions.push(`<button class="btn" type="button" data-open-day-item="${idx}">open</button>`);
  }
  if(plannedCount && !dayLogsMoving){
    actions.push(`<button class="btn" type="button" data-move-plan="${idx}" data-plan-day="${key}">move plan</button>`);
    actions.push(`<button class="btn" type="button" data-remove-plan="${idx}" data-plan-day="${key}">remove plan</button>`);
  }
  if(dayLogsScoped() && dayLogsHabitPlannable(h) && !dayLogsMoving){
    actions.push(`<button class="btn" type="button" id="day-logs-plan">plan</button>`);
  }

  const emptyNote = !row.entries.length && !row.scheduled.length
    ? '<p class="field-hint">Nothing on this day yet for this item.</p>'
    : '';

  $('day-logs-body').innerHTML = `
    <div class="day-item-card">
      <div class="overview-item">
        <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
        <span class="overview-meta">${escapeHtml(habitTypeLabel(h.type))}</span>
      </div>
      <p class="day-item-cue">${escapeHtml(typeof cardCue === 'function' ? cardCue(h) : '')}</p>
      ${emptyNote}
      ${moveBlock}
      ${actions.length ? `<div class="day-item-actions">${actions.join('')}</div>` : ''}
    </div>`;

  if(dayLogsScoped()){
    $('day-logs-footer').innerHTML = `
      <button class="btn primary" type="button" id="day-logs-done">done</button>`;
  }else{
    $('day-logs-footer').innerHTML = `
      <button class="btn" type="button" id="day-logs-back-list">back</button>
      <button class="btn primary" type="button" id="day-logs-home">home</button>`;
  }
}

// RENDER: add-plan step
function renderDayLogsAddStep(key){
  const data = load();
  const ts = new Date(`${key}T12:00:00`).getTime();
  const dateLabel = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('day-logs-title').textContent = 'plan';
  $('day-logs-sub').textContent = dateLabel;

  let addOptions;
  if(dayLogsScoped()){
    const h = data[dayLogsScopeIndex];
    addOptions = h && dayLogsHabitPlannable(h) ? [{h,i:dayLogsScopeIndex}] : [];
  }else{
    addOptions = data
      .map((h,i)=>({h,i}))
      .filter(({h})=>matchesOverviewFilters(h))
      .filter(({h})=>dayLogsHabitPlannable(h))
      .sort((a,b)=>(a.h.name || '').localeCompare(b.h.name || '',undefined,{sensitivity:'base'}));
  }

  const scopedHabit = dayLogsScoped() && addOptions[0] ? addOptions[0].h : null;
  const pickerHtml = dayLogsScoped()
    ? `<p class="day-scoped-habit">${scopedHabit ? `${iconHtml(scopedHabit,colors(daysSince(scopedHabit.lastLog),scopedHabit.target,scopedHabit.type))} ${escapeHtml(scopedHabit.name)}` : 'No active item'}</p>
       <input type="hidden" id="day-log-ting" value="${addOptions[0] ? addOptions[0].i : ''}" />`
    : `<label class="field-label" for="day-log-ting">item</label>
       <select id="day-log-ting" aria-label="habit">${addOptions.length
         ? addOptions.map(({h,i})=>`<option value="${i}">${escapeHtml(h.name)}</option>`).join('')
         : '<option value="">No active items</option>'}</select>`;

  $('day-logs-body').innerHTML = `
    <div class="day-add-step">
      ${pickerHtml}
      <label class="field-label" for="day-log-time">time <span class="field-optional">optional</span></label>
      <input type="time" id="day-log-time" class="time-input" step="900" aria-label="optional plan time" />
    </div>`;

  $('day-logs-footer').innerHTML = `
    <button class="btn" type="button" id="day-logs-back-list">back</button>
    <button class="btn primary" type="button" id="day-log-add" ${addOptions.length ? '' : 'disabled'}>add plan</button>`;
}

// RENDER: availability step
function renderDayLogsAvailStep(key){
  const ts = new Date(`${key}T12:00:00`).getTime();
  $('day-logs-title').textContent = 'day';
  $('day-logs-sub').textContent = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});

  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  const hasOverride = Object.prototype.hasOwnProperty.call(overrides,key);
  const minutes = effectiveAvailabilityMinutes(key);
  const date = new Date(`${key}T12:00:00`);
  const source = hasOverride
    ? 'custom for this date'
    : `${WEEKDAY_LABELS[date.getDay()]} default`;

  $('day-logs-body').innerHTML = `
    <div class="day-availability day-availability-step">
      <div>
        <b id="day-availability-label">${minutes} min available</b>
        <small id="day-availability-source">${escapeHtml(source)}</small>
      </div>
      <input type="number" id="day-availability-minutes" min="0" max="1440" inputmode="numeric" value="${minutes}" />
      <button class="mini-text-btn" id="day-availability-save" type="button">save</button>
      <button class="mini-text-btn" id="day-availability-clear" type="button" ${hasOverride ? '' : 'hidden'}>clear</button>
    </div>
    <p class="field-hint">Override how many minutes this day has for planning.</p>`;

  $('day-logs-footer').innerHTML = `
    <button class="btn" type="button" id="day-logs-back-list">back</button>
    <button class="btn primary" type="button" id="day-logs-home">home</button>`;
}

// RENDER: writes day availability override UI (compat for settings refresh)
function renderDayAvailability(key){
  if(dayLogsStep === 'avail' && dayLogsKey === key)renderDayLogsAvailStep(key);
}

// HYBRID: persists availability minutes, re-renders
function saveDayAvailabilityOverride(){
  if(!dayLogsKey)return;
  const minutes = Math.max(0,Math.min(1440,parseInt($('day-availability-minutes').value,10) || 0));
  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  overrides[dayLogsKey] = minutes;
  updateSortSetting({availabilityOverrides:overrides},{renderNow:false});
  renderDayAvailability(dayLogsKey);
  showToast('availability saved');
}

// HYBRID: removes availability override, re-renders
function clearDayAvailabilityOverride(){
  if(!dayLogsKey)return;
  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  delete overrides[dayLogsKey];
  updateSortSetting({availabilityOverrides:overrides},{renderNow:false});
  renderDayAvailability(dayLogsKey);
  showToast('availability cleared');
}

// HYBRID: navigate day-sheet steps
function setDayLogsStep(step,itemIndex = null){
  dayLogsStep = step;
  dayLogsItemIndex = itemIndex;
  if(step !== 'item')dayLogsMoving = false;
  if(dayLogsKey)renderDayLogs(dayLogsKey);
}

// HYBRID: close day sheet and clear scope
function closeDayLogsSheet({refreshOverview = false} = {}){
  dayLogsKey = null;
  resetDayLogsStep();
  closeSheet('day-logs-sheet');
  if(refreshOverview && typeof renderOverview === 'function')renderOverview();
  else if(typeof refreshOpenViews === 'function')refreshOpenViews();
}
