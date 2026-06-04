// Monthly overview, topic activity reporting, day logs, and date availability overrides.

function entryTone(type){
  if(type === 'zero')return 'miss';
  if(type === 'reduce')return 'warn';
  return 'hit';
}

function overviewTopicChoices(data){
  const topics = normalizeTopics([...(sortSettings?.topics || []),...data.flatMap(h=>normalizeTopics(h.topics))]);
  const hasNoTopic = data.some(h=>!normalizeTopics(h.topics).length);
  return [{key:'all',label:'all'},...topics.map(topic=>({key:topic,label:topic})),...(hasNoTopic ? [{key:'__none__',label:'no topic'}] : [])];
}

function matchesOverviewTopic(h,topic){
  if(!topic || topic === 'all')return true;
  const topics = normalizeTopics(h.topics);
  if(topic === '__none__')return !topics.length;
  return topics.some(item=>item.toLowerCase() === topic.toLowerCase());
}

function renderOverviewTopicFilter(data){
  const wrap = $('overview-topic-filter');
  if(!wrap)return;
  const choices = overviewTopicChoices(data);
  if(!choices.some(choice=>choice.key === overviewTopicFilter))overviewTopicFilter = 'all';
  wrap.innerHTML = choices.map(choice=>`
    <button type="button" class="topic-filter ${choice.key === overviewTopicFilter ? 'on' : ''}" data-overview-topic="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>
  `).join('');
}

function renderOverview(){
  const allData = load();
  renderOverviewTopicFilter(allData);
  const data = allData.filter(h=>matchesOverviewTopic(h,overviewTopicFilter));
  const topicLabel = overviewTopicFilter === 'all' ? '' : overviewTopicFilter === '__none__' ? 'No topic' : overviewTopicFilter;
  const frame = monthFrame(overviewMonthOffset);
  const byDay = new Map();
  let total = 0;
  let actual = 0;
  let planned = 0;
  const toneCounts = {hit:0,warn:0,miss:0,plan:0};
  data.forEach(h=>{
    const toneByDay = logToneMap(h);
    normalizeLogs(h.logs).forEach(log=>{
      const ts = logTime(log);
      const d = new Date(ts);
      if(d.getFullYear() !== frame.year || d.getMonth() !== frame.month)return;
      const key = dateKey(ts);
      if(!byDay.has(key))byDay.set(key,[]);
      const isPlan = isPlanLog(log);
      const tone = isPlan ? 'plan' : toneByDay.get(key) || entryTone(h.type);
      byDay.get(key).push({name:h.name,type:h.type,tone,planned:isPlan});
      total += 1;
      if(isPlan)planned += 1;
      else actual += 1;
      toneCounts[tone] = (toneCounts[tone] || 0) + 1;
    });
  });

  const activeDays = [...byDay.values()].filter(entries=>entries.some(entry=>!entry.planned)).length;
  const busiest = [...byDay.entries()].sort((a,b)=>b[1].length - a[1].length)[0];
  const busiestLabel = busiest
    ? new Date(`${busiest[0]}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'})
    : '-';
  const bestTone = toneCounts.miss ? 'some days need care' : toneCounts.warn ? 'mostly steady' : actual ? 'clean month so far' : planned ? 'plans are set' : 'quiet month';

  $('overview-copy').textContent = total
    ? `${topicLabel ? `${topicLabel}: ` : ''}${bestTone}. ${actual} entries${planned ? `, ${planned} planned` : ''}.`
    : `${topicLabel ? `${topicLabel}: ` : ''}No entries or plans this month.`;
  $('overview-stats').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} active days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${planned} planned</span>
    <span class="overview-stat"><i class="ti ti-chart-bar" aria-hidden="true"></i>busy ${busiestLabel}</span>`;
  $('overview-calendar-label').textContent = frame.label;
  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:frame.first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:frame.last.getDate()},(_,i)=>{
    const date = new Date(frame.year,frame.month,i + 1);
    const key = dateKey(date.getTime());
    const entries = byDay.get(key) || [];
    const tones = ['hit','warn','miss','plan']
      .filter(tone=>entries.some(item=>item.tone === tone))
      .slice(0,4);
    const dots = tones.map(tone=>`<span class="cal-dot ${tone}"></span>`).join('');
    const more = entries.length > tones.length ? `<span class="cal-more">${entries.length}</span>` : '';
    const density = entries.length >= 5 ? 'density-3' : entries.length >= 3 ? 'density-2' : entries.length ? 'density-1' : '';
    const cls = [
      entries.length ? 'has-entry' : '',
      density,
      key === frame.today ? 'today' : '',
      key === dayLogsKey ? 'selected' : '',
      'pickable'
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-log-day="${key}"><span>${i + 1}</span><span class="cal-dots">${dots}</span>${more}</button>`;
  });
  $('overview-calendar').innerHTML = [...heads,...blanks,...days].join('');

  const monthRows = data.map(h=>{
    const count = actualLogs(h.logs).filter(ts=>{
      const d = new Date(ts);
      return d.getFullYear() === frame.year && d.getMonth() === frame.month;
    }).length;
    const c = colors(daysSince(h.lastLog),h.target,h.type);
    return {h,count,c};
  }).filter(item=>item.count > 0).sort((a,b)=>b.count - a.count).slice(0,8);

  const topicCounts = new Map();
  data.forEach(h=>{
    const count = actualLogs(h.logs).filter(ts=>{
      const d = new Date(ts);
      return d.getFullYear() === frame.year && d.getMonth() === frame.month;
    }).length;
    if(!count)return;
    const topics = normalizeTopics(h.topics);
    (topics.length ? topics : ['no topic']).forEach(topic=>{
      topicCounts.set(topic,(topicCounts.get(topic) || 0) + count);
    });
  });
  const topicRows = [...topicCounts.entries()].sort((a,b)=>b[1] - a[1] || a[0].localeCompare(b[0])).slice(0,8);
  const topicHtml = topicRows.length ? `<p class="overview-section-title">topics</p>${topicRows.map(([topic,count])=>`
    <div class="overview-item">
      <span class="overview-name"><i class="ti ti-tag" aria-hidden="true"></i>${escapeHtml(topic)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}` : '';

  $('overview-list').innerHTML = `${topicHtml}${monthRows.length ? `<p class="overview-section-title">most active</p>${monthRows.map(({h,count,c})=>`
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}` : '<div class="overview-item"><span class="overview-name">quiet month</span><span class="overview-meta">no entries yet</span></div>'}`;
}

function renderDayLogs(key){
  const data = load();
  const topicLabel = overviewTopicFilter === 'all' ? '' : overviewTopicFilter === '__none__' ? 'no topic' : overviewTopicFilter;
  const rows = [];
  data.forEach((h,i)=>{
    if(!matchesOverviewTopic(h,overviewTopicFilter))return;
    const entries = normalizeLogs(h.logs).filter(log=>dateKey(logTime(log)) === key);
    const count = entries.length;
    if(!count)return;
    rows.push({h,index:i,count,entries,c:colors(daysSince(h.lastLog),h.target,h.type)});
  });
  const ts = new Date(`${key}T12:00:00`).getTime();
  $('day-logs-title').textContent = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('day-logs-sub').textContent = rows.length
    ? `${rows.reduce((sum,row)=>sum + row.count,0)} entries${topicLabel ? ` · ${topicLabel}` : ''}`
    : `no entries${topicLabel ? ` · ${topicLabel}` : ''}`;
  renderDayAvailability(key);
  $('day-logs-list').innerHTML = rows.length ? rows.map(({h,index,count,entries,c})=>{
    const plannedCount = entries.filter(isPlanLog).length;
    const actualCount = count - plannedCount;
    const remove = plannedCount ? `<button class="mini-text-btn" data-remove-plan="${index}" data-plan-day="${key}">remove plan</button>` : '';
    return `
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${plannedCount ? `${plannedCount} planned${actualCount ? `, ${actualCount} done` : ''}` : `${count} ${count === 1 ? 'entry' : 'entries'}`}</span>
      ${remove}
    </div>`;
  }).join('') : '<div class="overview-item"><span class="overview-name">no entries</span><span class="overview-meta">add one below</span></div>';
  const addOptions = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>matchesOverviewTopic(h,overviewTopicFilter))
    .sort((a,b)=>(a.h.name || '').localeCompare(b.h.name || '',undefined,{sensitivity:'base'}));
  $('day-log-ting').innerHTML = addOptions.length ? addOptions.map(({h,i})=>`<option value="${i}">${escapeHtml(h.name)}</option>`).join('') : '<option value="">No habits</option>';
  $('day-log-add').disabled = !addOptions.length;
}

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

function saveDayAvailabilityOverride(){
  if(!dayLogsKey)return;
  const minutes = Math.max(0,Math.min(1440,parseInt($('day-availability-minutes').value,10) || 0));
  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  overrides[dayLogsKey] = minutes;
  updateSortSetting({availabilityOverrides:overrides},{renderNow:false});
  renderDayAvailability(dayLogsKey);
  showToast('availability saved');
}

function clearDayAvailabilityOverride(){
  if(!dayLogsKey)return;
  const overrides = normalizeAvailabilityOverrides(sortSettings.availabilityOverrides);
  delete overrides[dayLogsKey];
  updateSortSetting({availabilityOverrides:overrides},{renderNow:false});
  renderDayAvailability(dayLogsKey);
  showToast('availability cleared');
}
