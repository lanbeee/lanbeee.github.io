// Monthly overview, topic activity reporting, day logs, and date availability overrides.
//
// This file renders the calendar overview sheet: the month/14-day grid, the
// day drill-down (activity list), and per-date availability overrides.
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

// HYBRID: renders topic pills, fixes invalid selection
function renderOverviewTopicFilter(data){
  const wrap = $('overview-topic-filter');
  if(!wrap)return;
  const choices = overviewTopicChoices(data);
  if(!choices.some(choice=>choice.key === overviewTopicFilter))overviewTopicFilter = 'all';
  wrap.innerHTML = choices.map(choice=>`
    <button type="button" class="topic-filter ${choice.key === overviewTopicFilter ? 'on' : ''}" data-overview-topic="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>
  `).join('');
}

// "When" pills for the calendar page, independent of the topic ("what") filter
// above. 'recent' is the default every time the sheet is opened.
const OVERVIEW_RANGES = [
  {key:'recent',label:'last 2 weeks'},
  {key:'month',label:'by month'},
  {key:'all',label:'all time'}
];

// HYBRID: renders range pills, fixes invalid selection
function renderOverviewRangeFilter(){
  const wrap = $('overview-range-filter');
  if(!wrap)return;
  if(!OVERVIEW_RANGES.some(r=>r.key === overviewRangeFilter))overviewRangeFilter = 'recent';
  wrap.innerHTML = OVERVIEW_RANGES.map(r=>`
    <button type="button" class="topic-filter range-filter ${r.key === overviewRangeFilter ? 'on' : ''}" data-overview-range="${r.key}">${escapeHtml(r.label)}</button>
  `).join('');
}

// Tallies every log that passes `included(ts)` into a per-day map plus
// running totals, shared by the recent/month/all-time renderers below so
// "busiest day" and "active days" are computed identically everywhere.
// PURE: tallies per-day log entries and totals
function buildDayTally(data,included){
  const map = new Map();
  let total = 0;
  let actual = 0;
  let planned = 0;
  const toneCounts = {hit:0,warn:0,miss:0,plan:0};
  const addEntry = (ts,entry)=>{
    if(!included(ts))return;
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
      addEntry(ts,{name:h.name,type:h.type,tone,planned:isPlan});
    });
    if(isTimedTask(h) && h.lastLog === null){
      addEntry(h.eventTime,{name:h.name,type:h.type,tone:'plan',planned:true,scheduled:true});
    }
    if(h.type === 'task' && h.eventTime === null && h.dueDate !== null && h.lastLog === null){
      addEntry(h.dueDate,{name:h.name,type:h.type,tone:'plan',planned:true,scheduled:true});
    }
  });
  return {map,total,actual,planned,toneCounts};
}

// PURE: derives active days and busiest
function dayTallySummary(tally){
  const activeDays = [...tally.map.values()].filter(entries=>entries.some(entry=>!entry.planned)).length;
  const busiest = [...tally.map.entries()].sort((a,b)=>b[1].length - a[1].length)[0];
  return {activeDays,busiest};
}

// PURE: picks summary copy from tone counts
function overviewToneCopy(tally,emptyWord){
  if(tally.toneCounts.miss)return 'some days need care';
  if(tally.toneCounts.warn)return 'mostly steady';
  if(tally.actual)return 'a clean stretch so far';
  if(tally.planned)return 'plans are set';
  return emptyWord;
}

// RENDER: writes overview stats row markup
function renderOverviewStatsRow(activeDays,actual,planned,busiestLabel){
  $('overview-stats').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} active days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${planned} planned</span>
    <span class="overview-stat"><i class="ti ti-chart-bar" aria-hidden="true"></i>busy ${busiestLabel}</span>`;
}

// PURE: builds calendar day cell HTML
function cellMarkup(key,date,entries,extraSpans = ''){
  const tones = ['hit','warn','miss','plan']
    .filter(tone=>entries.some(item=>item.tone === tone))
    .slice(0,4);
  const dots = tones.map(tone=>`<span class="cal-dot ${tone}"></span>`).join('');
  const more = entries.length > tones.length ? `<span class="cal-more">${entries.length}</span>` : '';
  const density = entries.length >= 5 ? 'density-3' : entries.length >= 3 ? 'density-2' : entries.length ? 'density-1' : '';
  const cls = [
    entries.length ? 'has-entry' : '',
    density,
    key === todayIso() ? 'today' : '',
    key === dayLogsKey ? 'selected' : '',
    'pickable'
  ].filter(Boolean).join(' ');
  return `<button class="cal-day ${cls}" data-log-day="${key}">${extraSpans}<span class="cal-dots">${dots}</span>${more}</button>`;
}

// PURE: build an N-day strip's tally + cell HTML starting at startTs. Shared by
// the overview "last 2 weeks" strip and the today sheet's "this week" strip so
// the two never diverge in how they render a day cell.
function dayStripMarkup(data,startTs,days){
  const end = startTs + days * 86400000;
  const tally = buildDayTally(data,ts=>ts >= startTs && ts < end);
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

// Lists shared by every range mode: top habits and topics by entry count.
// `countForHabit` decides what "count" means for the active range.
// RENDER: writes top habits and topics lists
function renderOverviewLists(data,countForHabit,scopeNote = ''){
  const rows = data.map(h=>({h,count:countForHabit(h),c:colors(daysSince(h.lastLog),h.target,h.type)}))
    .filter(item=>item.count > 0).sort((a,b)=>b.count - a.count).slice(0,8);

  const topicCounts = new Map();
  data.forEach(h=>{
    const count = countForHabit(h);
    if(!count)return;
    const topics = normalizeTopics(h.topics);
    (topics.length ? topics : ['no topic']).forEach(topic=>{
      topicCounts.set(topic,(topicCounts.get(topic) || 0) + count);
    });
  });
  const topicRows = [...topicCounts.entries()].sort((a,b)=>b[1] - a[1] || a[0].localeCompare(b[0])).slice(0,8);
  const topicHtml = topicRows.length ? `<p class="overview-section-title">topics${scopeNote}</p>${topicRows.map(([topic,count])=>`
    <div class="overview-item">
      <span class="overview-name"><i class="ti ti-tag" aria-hidden="true"></i>${escapeHtml(topic)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}` : '';

  $('overview-list').innerHTML = `${topicHtml}${rows.length ? `<p class="overview-section-title">most active${scopeNote}</p>${rows.map(({h,count,c})=>`
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}` : '<div class="overview-item"><span class="overview-name">quiet stretch</span><span class="overview-meta">no entries yet</span></div>'}`;
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
  renderOverviewTopicFilter(allData);
  renderOverviewRangeFilter();
  const data = allData.filter(h=>matchesOverviewTopic(h,overviewTopicFilter));
  const topicLabel = overviewTopicFilter === 'all' ? '' : overviewTopicFilter === '__none__' ? 'No topic' : overviewTopicFilter;
  if(overviewRangeFilter === 'recent')renderOverviewRecent(data,topicLabel);
  else renderOverviewMonth(data,topicLabel,overviewRangeFilter === 'all');
}

// Default view: a 14-cell strip (today and the 13 days before it), always
// anchored to "now" rather than whatever month happens to be navigated to.
// RENDER: renders 14-day strip and stats
function renderOverviewRecent(data,topicLabel){
  const end = dayStart(Date.now()) + 86400000; // exclusive: start of tomorrow
  const start = end - 14 * 86400000;
  const {tally,html:cells} = dayStripMarkup(data,start,14);
  const {activeDays,busiest} = dayTallySummary(tally);
  const busiestLabel = busiest ? new Date(`${busiest[0]}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '-';
  const bestTone = overviewToneCopy(tally,'a quiet stretch');

  $('overview-copy').textContent = tally.total
    ? `${topicLabel ? `${topicLabel}: ` : ''}${bestTone}. ${tally.actual} entries${tally.planned ? `, ${tally.planned} planned` : ''} in the last 14 days.`
    : `${topicLabel ? `${topicLabel}: ` : ''}No entries or plans in the last 14 days.`;
  renderOverviewStatsRow(activeDays,tally.actual,tally.planned,busiestLabel);
  setOverviewMonthNav(false,'last 14 days');

  const grid = $('overview-calendar');
  grid.className = 'month-grid rich-month-grid strip-grid';
  grid.innerHTML = cells;

  renderOverviewLists(data,h=>actualLogs(h.logs).filter(ts=>ts >= start && ts < end).length);
}

// 'month': the original navigable month grid. 'all': same grid for browsing,
// but the stats/lists below it cover the habit's entire history instead of
// just the visible month, so "most active" reflects all-time, not one page
// of the calendar.
// RENDER: renders month grid and stats
function renderOverviewMonth(data,topicLabel,allTime){
  const frame = monthFrame(overviewMonthOffset);
  const gridTally = buildDayTally(data,ts=>{
    const d = new Date(ts);
    return d.getFullYear() === frame.year && d.getMonth() === frame.month;
  });
  const statsTally = allTime ? buildDayTally(data,()=>true) : gridTally;
  const {activeDays,busiest} = dayTallySummary(statsTally);
  const busiestLabel = busiest
    ? new Date(`${busiest[0]}T12:00:00`).toLocaleDateString(undefined,allTime ? {month:'short',day:'numeric',year:'numeric'} : {month:'short',day:'numeric'})
    : '-';
  const bestTone = overviewToneCopy(statsTally,allTime ? 'just getting started' : 'quiet month');

  $('overview-copy').textContent = statsTally.total
    ? `${topicLabel ? `${topicLabel}: ` : ''}${bestTone}. ${statsTally.actual} entries${statsTally.planned ? `, ${statsTally.planned} planned` : ''}${allTime ? ' all time.' : '.'}`
    : `${topicLabel ? `${topicLabel}: ` : ''}No entries or plans${allTime ? ' yet.' : ' this month.'}`;
  renderOverviewStatsRow(activeDays,statsTally.actual,statsTally.planned,busiestLabel);
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

// RENDER: writes day drill-down entries list
function renderDayLogs(key){
  const data = load();
  const topicLabel = overviewTopicFilter === 'all' ? '' : overviewTopicFilter === '__none__' ? 'no topic' : overviewTopicFilter;
  const rows = [];
  data.forEach((h,i)=>{
    if(!matchesOverviewTopic(h,overviewTopicFilter))return;
    const entries = normalizeLogs(h.logs).filter(log=>dateKey(logTime(log)) === key);
    const scheduled = [];
    if(isTimedTask(h) && h.lastLog === null && dateKey(h.eventTime) === key){
      scheduled.push('scheduled');
    }
    if(h.type === 'task' && h.eventTime === null && h.dueDate !== null && h.lastLog === null && dateKey(h.dueDate) === key){
      scheduled.push(h.hardDue ? 'deadline' : 'due');
    }
    const count = entries.length;
    if(!count && !scheduled.length)return;
    rows.push({h,index:i,count,entries,scheduled,c:colors(daysSince(h.lastLog),h.target,h.type)});
  });
  const ts = new Date(`${key}T12:00:00`).getTime();
  const itemCount = rows.reduce((sum,row)=>sum + row.count + row.scheduled.length,0);
  $('day-logs-title').textContent = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('day-logs-sub').textContent = rows.length
    ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}${topicLabel ? ` · ${topicLabel}` : ''}`
    : `no entries${topicLabel ? ` · ${topicLabel}` : ''}`;
  renderDayAvailability(key);
  $('day-logs-list').innerHTML = rows.length ? rows.map(({h,index,count,entries,scheduled,c})=>{
    const plannedCount = entries.filter(isPlanLog).length;
    const actualCount = count - plannedCount;
    const remove = plannedCount ? `<button class="mini-text-btn" data-remove-plan="${index}" data-plan-day="${key}">remove</button>` : '';
    const move = plannedCount ? `<button class="mini-text-btn" data-move-plan="${index}" data-plan-day="${key}">move</button>` : '';
    const open = `<button class="mini-text-btn" data-open-day-item="${index}">open</button>`;
    const entryMeta = plannedCount ? `${plannedCount} planned${actualCount ? `, ${actualCount} done` : ''}` : actualCount ? `${actualCount} ${actualCount === 1 ? 'entry' : 'entries'}` : '';
    const scheduledMeta = scheduled.join(', ');
    const meta = [scheduledMeta,entryMeta].filter(Boolean).join(' · ');
    return `
    <div class="overview-item plan-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${escapeHtml(meta)}</span>
      <div class="plan-actions">${open}${move}${remove}</div>
      <label class="move-inline" hidden>
        <input type="date" class="move-date" value="${key}" data-move-date="${index}" data-move-from="${key}" />
        <button class="mini-text-btn" type="button" data-move-go="${index}">save</button>
        <button class="mini-text-btn" type="button" data-move-cancel>cancel</button>
      </label>
    </div>`;
  }).join('') : '<div class="overview-item"><span class="overview-name">no entries</span><span class="overview-meta">add one below</span></div>';
  const addOptions = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>matchesOverviewTopic(h,overviewTopicFilter))
    .filter(({h})=>!(h.type === 'task' && h.lastLog !== null))
    .sort((a,b)=>(a.h.name || '').localeCompare(b.h.name || '',undefined,{sensitivity:'base'}));
  $('day-log-ting').innerHTML = addOptions.length ? addOptions.map(({h,i})=>`<option value="${i}">${escapeHtml(h.name)}</option>`).join('') : '<option value="">No active items</option>';
  $('day-log-add').disabled = !addOptions.length;
}

// RENDER: writes day availability override UI
function renderDayAvailability(key){
  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  const hasOverride = Object.prototype.hasOwnProperty.call(overrides,key);
  const minutes = effectiveAvailabilityMinutes(key);
  const date = new Date(`${key}T12:00:00`);
  $('day-availability-label').textContent = `${minutes} min available`;
  $('day-availability-source').textContent = hasOverride
    ? 'custom for this date'
    : `${WEEKDAY_LABELS[date.getDay()]} default`;
  $('day-availability-minutes').value = minutes;
  $('day-availability-clear').hidden = !hasOverride;
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
