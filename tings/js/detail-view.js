// Habit detail sheet, stats, graph, and per-habit calendar.
//
// This file renders the habit detail sheet: the score ring, stats, the gap
// graph, the per-habit calendar, and the schedule editor (weekday / monthday /
// time-window). Functions are tagged by role to guide the React Native port:
//   - RENDER  -> become React functional components (return JSX).
//   - HANDLER -> become onPress / onChange callbacks.
//   - WIRE    -> become useEffect setup hooks.
//   - HYBRID  -> split into a component + hooks + handlers.
//   - PURE    -> port verbatim into shared utils.

// HYBRID: opens sheet, syncs DOM and detail state
function openDetail(i){
  const h = load()[i];
  if(!h)return;
  closeSearch();
  const changedHabit = detailIdx !== i;
  if(changedHabit)detailMonthOffset = 0;
  detailIdx = i;
  const days = daysSince(h.lastLog);
  const c = colors(days,h.target,h.type);
  const cardScoreTone = cardTone(h);
  const accent = visualClassColor(cardScoreTone);
  $('detail-name').textContent = h.name;
  $('detail-sub').textContent = detailHeaderLine(h);
  $('detail-head-card').className = `detail-head ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}`;
  $('detail-head-card').style.setProperty('--card-accent',accent);
  $('detail-about').textContent = aboutText(h);
  $('detail-trend').textContent = trendText(h);
  $('detail-habit-message').value = h.name || '';
  $('detail-emoji').value = h.emoji || '';
  $('detail-days').value = h.target || '';
  $('detail-pinned').checked = Boolean(h.pinned);
  $('detail-duration').value = h.durationMinutes || DEFAULT_DURATION_MINUTES;
  $('detail-flexibility').value = h.flexibilityDays || 0;
  renderTopicChips('detail-topic-chips',h.topics);
  renderScheduleChips('detail',h);
  renderTimeWindowInputs(h);
  setScheduleView('allowed');
  $('detail-delete-confirm').hidden = true;
  setDetailTypeUi(h.type);
  detailTuneOriginal = {
    name:h.name || '',
    type:h.type || 'keepup',
    emoji:h.emoji || '',
    target:h.target || '',
    pinned:Boolean(h.pinned),
    topics:normalizeTopics(h.topics),
    allowedWeekdays:normalizeAllowedWeekdays(h.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(h.allowedMonthDays),
    preferredWeekdays:normalizeAllowedWeekdays(h.preferredWeekdays),
    preferredMonthDays:normalizeAllowedMonthDays(h.preferredMonthDays),
    allowedTimeStart:h.allowedTimeStart ?? null,
    allowedTimeEnd:h.allowedTimeEnd ?? null,
    durationMinutes:h.durationMinutes || DEFAULT_DURATION_MINUTES,
    flexibilityDays:h.flexibilityDays || 0
  };
  syncRhythm('detail',h.target || 7);
  $('detail-mark').style.background = c.bg;
  $('detail-mark').style.color = c.icon;
  $('detail-mark').classList.toggle('emoji-pulse',Boolean(h.emoji));
  $('detail-mark').setAttribute('aria-label',`add entry for ${h.name}`);
  $('detail-mark').innerHTML = iconHtml(h,c);
  renderStats(h);
  renderGraph(h);
  renderCalendar(h);
  setDetailDirty(false);
  openSheet('detail-sheet');
  if(changedHabit){
    const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
    if(pager)pager.scrollTo({left:0,behavior:'auto'});
  }
  renderDetailTabs();
  updateDetailPagerDots();
}

// HYBRID: opens detail then scrolls to calendar
function openDetailCalendar(i){
  openDetail(i);
  requestAnimationFrame(()=>{
    const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
    if(!pager)return;
    pager.scrollTo({left:pager.clientWidth,behavior:'auto'});
    updateDetailPagerDots();
  });
}

// HYBRID: opens detail then scrolls to schedule
function openDetailSchedule(i){
  openDetail(i);
  requestAnimationFrame(()=>{
    const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
    if(!pager)return;
    pager.scrollTo({left:pager.clientWidth * 2,behavior:'auto'});
    updateDetailPagerDots();
  });
}

// PURE: builds header subtitle from habit state
function detailHeaderLine(h){
  const parts = [cardCue(h)];
  if(h.durationMinutes)parts.push(`${h.durationMinutes}m`);
  if(hasDaySchedule(h)){
    const next = nextEligibleShort(h);
    if(next)parts.push(next);
  }
  if(hasTimeWindow(h))parts.push(timeWindowSummary(h));
  return parts.filter(Boolean).join(' · ');
}

// RENDER: fills time window input fields
function renderTimeWindowInputs(h = {}){
  const start = $('detail-time-start');
  const end = $('detail-time-end');
  const clear = $('detail-time-clear');
  if(!start || !end)return;
  if(hasTimeWindow(h)){
    start.value = minutesToTimeInput(h.allowedTimeStart);
    end.value = minutesToTimeInput(h.allowedTimeEnd);
    if(clear)clear.hidden = false;
  }else{
    start.value = '';
    end.value = '';
    if(clear)clear.hidden = true;
  }
}
// RENDER: toggles time-clear button visibility
function syncTimeClearBtn(){
  const clear = $('detail-time-clear');
  if(!clear)return;
  clear.hidden = !$('detail-time-start').value && !$('detail-time-end').value;
}

// HYBRID: reads form DOM into tune object
function currentDetailTune(){
  return {
    name:$('detail-habit-message').value.trim(),
    type:document.querySelector('#detail-type-seg .seg-opt.on')?.dataset.detailType || 'keepup',
    emoji:cleanMark($('detail-emoji').value),
    target:$('detail-days').value || '',
    pinned:$('detail-pinned').checked,
    topics:selectedTopicsFrom('detail-topic-chips'),
    allowedWeekdays:selectedWeekdaysFrom('detail-weekday-chips'),
    allowedMonthDays:selectedMonthDaysFrom('detail-monthday-chips'),
    preferredWeekdays:selectedWeekdaysFrom('detail-preferred-weekday-chips'),
    preferredMonthDays:selectedMonthDaysFrom('detail-preferred-monthday-chips'),
    allowedTimeStart:timeInputToMinutes($('detail-time-start').value),
    allowedTimeEnd:timeInputToMinutes($('detail-time-end').value),
    durationMinutes:clampDuration($('detail-duration').value),
    flexibilityDays:clampFlexibility($('detail-flexibility').value)
  };
}

// HYBRID: compares form to original, toggles dirty class
function setDetailDirty(force){
  const sheet = getSheetInner('detail-sheet');
  const current = currentDetailTune();
  const dirty = force ?? (
    detailTuneOriginal &&
    (current.name !== detailTuneOriginal.name ||
      current.type !== detailTuneOriginal.type ||
      current.emoji !== detailTuneOriginal.emoji ||
      String(current.target) !== String(detailTuneOriginal.target) ||
      current.pinned !== detailTuneOriginal.pinned ||
      current.durationMinutes !== detailTuneOriginal.durationMinutes ||
      current.flexibilityDays !== detailTuneOriginal.flexibilityDays ||
      current.topics.join('|') !== detailTuneOriginal.topics.join('|') ||
      current.allowedWeekdays.join('|') !== detailTuneOriginal.allowedWeekdays.join('|') ||
      current.allowedMonthDays.join('|') !== detailTuneOriginal.allowedMonthDays.join('|') ||
      current.preferredWeekdays.join('|') !== detailTuneOriginal.preferredWeekdays.join('|') ||
      current.preferredMonthDays.join('|') !== detailTuneOriginal.preferredMonthDays.join('|') ||
      current.allowedTimeStart !== detailTuneOriginal.allowedTimeStart ||
      current.allowedTimeEnd !== detailTuneOriginal.allowedTimeEnd)
  );
  sheet.classList.toggle('tune-dirty',Boolean(dirty));
}

// HYBRID: rewrites form fields from saved original
function restoreDetailTune(){
  if(!detailTuneOriginal)return;
  $('detail-habit-message').value = detailTuneOriginal.name;
  $('detail-emoji').value = detailTuneOriginal.emoji;
  $('detail-pinned').checked = detailTuneOriginal.pinned;
  $('detail-duration').value = detailTuneOriginal.durationMinutes;
  $('detail-flexibility').value = detailTuneOriginal.flexibilityDays;
  renderTopicChips('detail-topic-chips',detailTuneOriginal.topics);
  renderScheduleChips('detail',detailTuneOriginal);
  renderTimeWindowInputs(detailTuneOriginal);
  setDetailTypeUi(detailTuneOriginal.type);
  if(detailTuneOriginal.target !== '')syncRhythm('detail',detailTuneOriginal.target);
  setDetailDirty(false);
}

// HYBRID: switches allowed/preferred schedule section
function setScheduleView(view){
  detailScheduleView = view;
  document.querySelectorAll('#detail-schedule-view-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.scheduleView === view);
  });
  const allowedGroup = $('detail-schedule-allowed');
  const preferredGroup = $('detail-schedule-preferred');
  if(allowedGroup)allowedGroup.hidden = view !== 'allowed';
  if(preferredGroup)preferredGroup.hidden = view !== 'preferred';
}

// HYBRID: resets detail state and closes sheet
function closeDetail(){
  detailIdx = null;
  detailTuneOriginal = null;
  detailScheduleView = 'allowed';
  closeSheet('detail-sheet');
}

// RENDER: renders score ring and stat cards
function renderStats(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  const completed = actualLogs(h.logs).length;
  const planned = plannedLogs(h.logs).length;
  const run = currentRun(h);
  const gapNum = days === null ? '-' : days < 0 ? Math.abs(days) : days;
  const gapLabel = days < 0 ? 'until next' : 'since last';
  const target = h.target || 7;
  const recent = recentWindowStats(h,30);
  const score = progressScore(h);
  const scoreLabel = score === null ? '-' : `${score}%`;
  const scoreCls = scoreTone(score);
  const monthValue = h.type === 'keepup' ? `${recent.good}/${recent.expected}` : recent.count;
  const monthLabel = h.type === 'keepup' ? 'last 30d done' : 'last 30d entries';
  const runLabel = h.type === 'keepup' ? 'streak' : 'clear days';
  const intervalSummary = intervalToneSummary(h);
  const avgTone = avg === null ? 'empty' : intervalTone(h,avg);
  const gapTone = days === null || days < 0 ? 'empty' : intervalTone(h,days);
  const scoreName = scoreTitle(h,score);
  const targetLine = h.type === 'zero' ? 'avoid' : `${target}d rhythm`;
  const gapValue = gapNum === '-' ? '-' : `${gapNum}<small>d</small>`;
  const avgValue = avg === null ? '-' : `${avg}<small>d</small>`;
  const rhythmIcon = h.type === 'zero' ? 'ti-ban' : 'ti-repeat';
  const planIcon = h.type === 'zero' ? 'ti-list-check' : 'ti-calendar-event';
  const planFact = h.type === 'zero' ? `${completed} entries` : `${planned} planned`;
  $('detail-stats').innerHTML = `
    <div class="score-card ${scoreCls}">
      <div class="score-ring ${scoreCls}" style="--score:${score ?? 0};--score-color:${visualClassColor(scoreCls)};"><span>${scoreLabel}</span></div>
      <div class="score-copy">
        <div class="score-title">${scoreName}</div>
        <div class="score-sub">${progressCopy(h,score)}</div>
        <div class="score-facts">
          <span><i class="ti ${rhythmIcon}" aria-hidden="true"></i>${targetLine}</span>
          <span><i class="ti ${planIcon}" aria-hidden="true"></i>${planFact}</span>
        </div>
      </div>
    </div>
    <div class="stat ${gapTone}"><div class="stat-num">${gapValue}</div><div class="stat-label">${gapLabel}</div></div>
    <div class="stat ${avgTone}"><div class="stat-num">${avgValue}</div><div class="stat-label">usual gap</div></div>
    <div class="stat"><div class="stat-num">${monthValue}</div><div class="stat-label">${monthLabel}</div></div>
    <div class="stat"><div class="stat-num">${run.num}</div><div class="stat-label">${runLabel}</div></div>
    <div class="pace-card">
      <div class="pace-head"><span>recent gaps</span><span>${intervalSummary.label}</span></div>
      <div class="pace-strip" aria-hidden="true">
        <span class="hit" style="width:${intervalSummary.hit}%"></span>
        <span class="warn" style="width:${intervalSummary.warn}%"></span>
        <span class="miss" style="width:${intervalSummary.miss}%"></span>
      </div>
      <div class="pace-legend"><span><b class="hit"></b>good</span><span><b class="warn"></b>close</span><span><b class="miss"></b>care</span></div>
    </div>
    <div class="stat compact"><div class="stat-num">${completed}</div><div class="stat-label">total entries</div></div>`;
}

// PURE: summarizes logs inside a day window
function recentWindowStats(h,windowDays = 30){
  const since = Date.now() - windowDays * 86400000;
  const logs = actualLogs(h.logs).filter(ts=>ts >= since);
  const target = h.target || 7;
  const expected = h.type === 'keepup' ? Math.max(1,Math.ceil(windowDays / target)) : 0;
  return {count:logs.length,expected,good:Math.min(logs.length,expected)};
}

// PURE: lists recent gap intervals in days
function intervalValues(h,limit = null){
  const logs = actualLogs(h.logs);
  if(!logs.length)return [];
  const intervals = [];
  for(let i=1;i<logs.length;i++){
    intervals.push(Math.max(1,Math.round((logs[i] - logs[i - 1]) / 86400000)));
  }
  intervals.push(Math.max(1,daysSince(logs[logs.length - 1]) || 1));
  return limit ? intervals.slice(-limit) : intervals;
}

// PURE: tallies gap tones into percentages
function intervalToneSummary(h){
  const intervals = intervalValues(h,14);
  if(!intervals.length)return {hit:0,warn:0,miss:0,label:'no gap history'};
  const counts = intervals.reduce((acc,days)=>{
    const cls = intervalTone(h,days) || 'miss';
    acc[cls] = (acc[cls] || 0) + 1;
    return acc;
  },{hit:0,warn:0,miss:0});
  const total = intervals.length || 1;
  const hit = Math.round(counts.hit / total * 100);
  const warn = Math.round(counts.warn / total * 100);
  const miss = Math.max(0,100 - hit - warn);
  const label = counts.hit >= counts.warn + counts.miss ? 'mostly good' : counts.miss > counts.hit ? 'needs care' : 'mixed';
  return {hit,warn,miss,label};
}

// PURE: maps score to a label string
function scoreTitle(h,score){
  if(score === null)return 'no pattern yet';
  if(h.type === 'keepup'){
    if(score >= 80)return 'on track';
    if(score >= 55)return 'nearly due';
    return 'needs attention';
  }
  if(h.type === 'reduce'){
    if(score >= 80)return 'good spacing';
    if(score >= 45)return 'space is building';
    return 'too recent';
  }
  if(score >= 80)return 'clear stretch';
  if(score >= 35)return 'recovering';
  return 'recent reset';
}

// PURE: computes 0-100 progress score
function progressScore(h){
  const days = daysSince(h.lastLog);
  if(days === null)return null;
  if(days < 0)return null;
  const target = effectiveTarget(h);
  if(h.type === 'keepup'){
    if(days <= target * 0.75)return 100;
    if(days <= target)return Math.round(100 - ((days / target - 0.75) / 0.25) * 25);
    if(days <= target * 1.35)return Math.round(74 - ((days / target - 1) / 0.35) * 29);
    return Math.max(0,Math.round(44 - Math.min(1,(days / target - 1.35) / 0.65) * 44));
  }
  if(h.type === 'reduce'){
    if(days >= target)return Math.min(100,Math.round(75 + Math.min(1,(days / target - 1) / 0.75) * 25));
    if(days >= target * 0.65)return Math.round(45 + ((days / target - 0.65) / 0.35) * 29);
    return Math.max(0,Math.round((days / (target * 0.65)) * 44));
  }
  if(days >= 14)return Math.min(100,Math.round(75 + Math.min(1,(days - 14) / 16) * 25));
  if(days >= 4)return Math.round(45 + ((days - 4) / 10) * 29);
  return Math.max(0,Math.round(days / 4 * 44));
}

// PURE: maps score to guidance copy
function progressCopy(h,score){
  if(score === null)return 'start with one entry';
  if(h.type === 'keepup'){
    if(score >= 80)return 'your current gap is inside the rhythm';
    if(score >= 55)return 'still okay, but this is coming due';
    return 'the gap is longer than your rhythm';
  }
  if(h.type === 'reduce'){
    if(score >= 80)return 'you are leaving enough space';
    if(score >= 45)return 'space is improving, keep stretching it';
    return 'the last entry is still too recent';
  }
  if(score >= 80)return 'you have a strong clear stretch';
  if(score >= 35)return 'the clear stretch is rebuilding';
  return 'there was a recent reset';
}

// PURE: builds the about blurb string
function aboutText(h){
  const days = daysSince(h.lastLog);
  if(h.type === 'zero'){
    if(days === null)return 'You are keeping this off the board.';
    if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
    if(days === 0)return 'Entry today. Reset, then keep moving.';
    return `${days} clean days since the last entry.`;
  }
  const target = effectiveTarget(h);
  const rhythm = h.target || 7;
  if(days === null)return `Aim for about every ${rhythm} days.`;
  if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
  const when = entryWhen(h.lastLog);
  if(h.type === 'keepup'){
    if(days < target)return `Last entry was ${when}. ${target - days} days left in this rhythm.`;
    if(days === target)return `Last entry was ${when}. This is due today.`;
    return `Last entry was ${when}. This is ${days - target} days overdue.`;
  }
  return days >= target ? `${days} days since the last entry. Good gap.` : `Entry was ${when}. Try to increase the gap.`;
}

// PURE: builds the short trend label
function trendText(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  if(days === null)return 'no entries yet';
  if(days < 0)return 'coming up';
  if(h.type === 'zero'){
    if(days === 0)return 'entry today';
    if(days < 3)return 'recent entry';
    return 'on track';
  }
  const target = effectiveTarget(h);
  const pace = avg || days;
  if(h.type === 'keepup'){
    if(days > target)return `${days - target}d overdue`;
    if(days === target)return 'due today';
    return pace <= target ? 'on pace' : 'behind';
  }
  if(days < target)return 'too recent';
  return pace >= target ? 'on track' : 'watch';
}

// RENDER: renders gap history bar graph
function renderGraph(h){
  const graph = $('detail-graph');
  const logs = actualLogs(h.logs);
  const target = h.target || 7;
  if(!logs.length){
    graph.innerHTML = '<div class="graph-empty">no entries yet</div>';
    return;
  }
  const intervals = intervalValues(h,14);
  const max = Math.max(...intervals,target,1);
  const bars = intervals.map((days,i)=>{
    const height = Math.max(12,Math.round((days / max) * 100));
    const cls = intervalTone(h,days);
    const latest = i === intervals.length - 1 ? ' latest' : '';
    return `<div class="bar ${cls}${latest}" style="height:${height}%"><span>${days}d</span></div>`;
  }).join('');
  const targetPct = h.type === 'zero' ? null : Math.max(8,Math.min(92,Math.round((target / max) * 100)));
  graph.innerHTML = `
    <div class="graph-top"><span>gap history</span><span>${graphRule(h)}</span></div>
    <div class="graph-bars">
      ${targetPct ? `<div class="target-line" style="bottom:${targetPct}%"><span>${target}d</span></div>` : ''}
      ${bars}
    </div>
    <div class="graph-caption">${graphCaption(h,intervals)}</div>`;
}

// PURE: returns the graph rule hint
function graphRule(h){
  if(h.type === 'keepup')return 'shorter is better';
  if(h.type === 'reduce')return 'longer is better';
  return 'longer is better';
}

// PURE: builds the graph caption string
function graphCaption(h,intervals){
  const last = intervals[intervals.length - 1];
  const tone = intervalTone(h,last);
  const label = tone === 'hit' ? 'good' : tone === 'warn' ? 'close' : 'needs care';
  const avg = avgInterval(h.logs);
  const avgPart = avg === null ? '' : ` Usual gap is ${avg}d.`;
  if(h.type === 'keepup')return `Last gap was ${last}d: ${label}. Target is ${h.target || 7}d or less.${avgPart}`;
  if(h.type === 'reduce')return `Last gap was ${last}d: ${label}. More space is better.${avgPart}`;
  return `Last clear stretch was ${last}d: ${label}. Longer is better.${avgPart}`;
}

// RENDER: renders month calendar grid
function renderCalendar(h){
  const frame = monthFrame(detailMonthOffset);
  const {year,month,first,last,label,today} = frame;
  const logs = normalizeLogs(h.logs);
  const dayCounts = new Map();
  const toneByDay = logToneMap(h);
  let actual = 0;
  let planned = 0;
  logs.forEach(log=>{
    const ts = logTime(log);
    const d = new Date(ts);
    if(d.getFullYear() !== year || d.getMonth() !== month)return;
    const key = dateKey(ts);
    dayCounts.set(key,(dayCounts.get(key) || 0) + 1);
    if(isPlanLog(log))planned += 1;
    else actual += 1;
  });
  const monthEntries = actual + planned;
  const activeDays = [...dayCounts.values()].filter(Boolean).length;
  $('detail-calendar-label').textContent = `${label} · ${monthEntries}`;
  $('detail-calendar-summary').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${planned} planned</span>`;

  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:last.getDate()},(_,i)=>{
    const date = new Date(year,month,i + 1);
    const key = dateKey(date.getTime());
    const count = dayCounts.get(key) || 0;
    const toneClass = toneByDay.get(key) || '';
    const density = count >= 3 ? 'density-3' : count >= 2 ? 'density-2' : count ? 'density-1' : '';
    const dots = count ? `<span class="cal-dots"><span class="cal-dot ${toneClass}"></span>${count > 1 ? `<span class="cal-more">${count}</span>` : ''}</span>` : '<span class="cal-dots"></span>';
    const cls = [
      count ? 'has-entry' : '',
      density,
      key === today ? 'today' : '',
      key === dayLogsKey ? 'selected' : '',
      'pickable'
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-entry-day="${key}"><span>${i + 1}</span>${dots}</button>`;
  });
  $('detail-calendar').innerHTML = [...heads,...blanks,...days].join('');
}

// RENDER: syncs pager dot indicator
function updateDetailPagerDots(){
  const inner = getSheetInner('detail-sheet');
  const pager = inner?.querySelector('.detail-pager');
  const dotsWrap = inner?.querySelector('.detail-dots');
  if(!pager || !dotsWrap)return;
  const pages = [...pager.querySelectorAll('.detail-page')];
  if(dotsWrap.children.length !== pages.length){
    dotsWrap.innerHTML = pages.map(()=>'<span></span>').join('');
  }
  const dots = [...dotsWrap.querySelectorAll('span')];
  if(!dots.length)return;
  const page = Math.round(pager.scrollLeft / Math.max(1,pager.clientWidth));
  dots.forEach((dot,i)=>{
    dot.classList.toggle('on',i === page);
  });
}

// RENDER: syncs active pager dot indicator
function setDetailActivePage(key){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if (!pager) return;
  // Every tier uses the mobile-portrait layout: horizontal scroll-snap pager.
  // The caller has already scrolled to the right page; this also updates the
  // dot indicator so the user sees where they are.
  updateDetailPagerDots();
}

// RENDER: clears legacy tab chrome in pager
function renderDetailTabs(){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if (!pager) return;
  // No sidebar tabs in any tier — panes now look exactly like mobile-portrait.
  const existingTabs = pager.querySelector('.detail-tabs');
  if (existingTabs) existingTabs.remove();
  [...pager.querySelectorAll('.detail-page')].forEach(p=>p.classList.remove('is-active'));
}

// PURE: checks planned log for a day key
function hasPlannedEntryForDay(h,key){
  return plannedLogs(h.logs).some(ts=>dateKey(ts) === key);
}

// PURE: checks a planned entry exists today
function hasPlannedToday(h){
  const today = dateKey(Date.now());
  return hasPlannedEntryForDay(h,today);
}

// PURE: computes month boundary dates and label
function monthFrame(offset = 0){
  const now = new Date();
  const anchor = new Date(now.getFullYear(),now.getMonth() + offset,1);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year,month,1);
  const last = new Date(year,month + 1,0);
  const label = first.toLocaleDateString(undefined,{month:'short',year:'numeric'});
  return {year,month,first,last,label,today:dateKey(Date.now())};
}

document.addEventListener('tierchange',()=>{
  renderDetailTabs();
  // Re-open detail if it was open, so the layout applies
  if (detailIdx !== null) {
    const idx = detailIdx;
    openSheet('detail-sheet');
  }
});
