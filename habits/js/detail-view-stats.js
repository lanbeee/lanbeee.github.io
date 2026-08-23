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
  const runLabel = h.type === 'keepup' ? 'streak'
    : h.type === 'reduce' ? 'clear days'
    : (run.label || 'status');
  const intervalSummary = intervalToneSummary(h);
  const avgTone = avg === null ? 'empty' : intervalTone(h,avg);
  const gapTone = days === null || days < 0 ? 'empty' : intervalTone(h,days);
  const scoreName = scoreTitle(h,score);
  const timed = h.type === 'task' && h.eventTime !== null;
  const targetLine = h.type === 'zero' ? 'avoid'
    : h.type === 'task' ? (timed ? 'appointment' : (h.dueDate ? 'due task' : 'someday'))
    : `${formatRhythmLabel(target)} rhythm`;
  const rhythmIcon = h.type === 'zero' ? 'ti-ban'
    : h.type === 'task' ? (timed ? 'ti-calendar-time' : 'ti-checkbox')
    : 'ti-repeat';
  const planIcon = h.type === 'zero' ? 'ti-list-check'
    : h.type === 'task' ? (timed ? 'ti-clock-hour-4' : 'ti-flag')
    : 'ti-calendar-event';
  const planFact = h.type === 'zero' ? `${completed} entries`
    : h.type === 'task' ? (h.lastLog !== null ? 'completed' : (timed ? 'scheduled' : (h.dueDate ? 'has due date' : 'no due date')))
    : `${planned} planned`;
  if(h.type === 'task'){
    $('detail-stats').innerHTML = `
      <div class="score-card ${scoreCls}">
        <div class="score-ring ${scoreCls}" style="--score:${score ?? 0};--score-color:${visualClassColor(scoreCls)};"><span>${scoreLabel}</span></div>
        <div class="score-copy">
          <div class="score-title">${escapeHtml(scoreName)}</div>
          <div class="score-sub">${escapeHtml(progressCopy(h,score))}</div>
          <div class="score-facts">
            <span><i class="ti ${rhythmIcon}" aria-hidden="true"></i>${escapeHtml(targetLine)}</span>
            <span><i class="ti ${planIcon}" aria-hidden="true"></i>${escapeHtml(planFact)}</span>
          </div>
        </div>
      </div>`;
    return;
  }
  const gapValue = gapNum === '-' ? '-' : `${gapNum}<small>d</small>`;
  const avgValue = avg === null ? '-' : `${avg}<small>d</small>`;
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

// PURE: maps score to a label string
function scoreTitle(h,score){
  if(score === null){
    if(h.type === 'task')return taskWhen(h) === null ? 'someday' : 'upcoming';
    return 'no pattern yet';
  }
  if(h.type === 'task'){
    if(h.lastLog !== null)return 'done';
    if(score >= 80)return 'plenty of time';
    if(score >= 45)return 'coming due';
    return 'due now';
  }
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
  if(h.type === 'task'){
    if(h.lastLog !== null)return `Done. Logged ${entryWhen(h.lastLog)}.`;
    if(h.eventTime !== null)return `Scheduled ${scheduledWhenLabel(h.eventTime)}. Fixed time — never rescheduled.`;
    if(h.dueDate === null)return 'A someday task. Pin it or add a due date to bring it forward.';
    const left = daysUntil(h.dueDate);
    if(left === null)return 'A task with a due date.';
    if(left < 0)return `${Math.abs(left)} days overdue${h.hardDue ? ' (hard deadline)' : ''}.`;
    if(left === 0)return `Due today${h.hardDue ? ' — hard deadline' : ''}.`;
    return `Due in ${left} days${h.hardDue ? ' (hard deadline)' : ''}.`;
  }
  if(h.type === 'zero'){
    if(days === null)return 'You are keeping this off the board.';
    if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
    if(days === 0)return 'Entry today. Reset, then keep moving.';
    return `${days} clean days since the last entry.`;
  }
  const target = effectiveTarget(h);
  const rhythm = h.target || 7;
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const left = daysUntil(planBy);
    const planLabel = left === null
      ? 'Plan by date set'
      : left < 0
        ? `Plan-by was ${Math.abs(left)} days ago`
        : left === 0
          ? 'Plan by today'
          : `Plan by in ${left} days`;
    if(days === null)return `${planLabel}. Aim for about every ${rhythm} days.`;
    if(days < 0)return `${planLabel}. Next entry is ${entryWhen(h.lastLog)}.`;
    const when = entryWhen(h.lastLog);
    // Whole-day boundary (see cueDayBoundary): fractional rhythms must not
    // print floats like "0.666666666 days left in this rhythm".
    const due = typeof cueDayBoundary === 'function' ? cueDayBoundary(target) : Math.ceil(target);
    if(h.type === 'keepup'){
      if(days < due)return `${planLabel}. Last entry was ${when}.`;
      if(days === due)return `${planLabel}. Last entry was ${when}. Rhythm is also due today.`;
      return `${planLabel}. Last entry was ${when}. Rhythm is ${days - due} days overdue.`;
    }
    return days >= due
      ? `${planLabel}. ${days} days since the last entry.`
      : `${planLabel}. Entry was ${when}.`;
  }
  if(days === null)return `Aim for about every ${rhythm} days.`;
  if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
  const when = entryWhen(h.lastLog);
  // Same whole-day boundary as above — no float day counts in copy.
  const due = typeof cueDayBoundary === 'function' ? cueDayBoundary(target) : Math.ceil(target);
  if(h.type === 'keepup'){
    if(days < due)return `Last entry was ${when}. ${due - days} days left in this rhythm.`;
    if(days === due)return `Last entry was ${when}. This is due today.`;
    return `Last entry was ${when}. This is ${days - due} days overdue.`;
  }
  return days >= due ? `${days} days since the last entry. Good gap.` : `Entry was ${when}. Try to increase the gap.`;
}

// PURE: builds the short trend label
function trendText(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  if(h.type === 'task'){
    if(h.lastLog !== null)return 'completed';
    if(h.eventTime !== null)return scheduledWhenLabel(h.eventTime);
    if(h.dueDate === null)return 'someday';
    const left = daysUntil(h.dueDate);
    if(left === null)return 'due';
    if(left < 0)return `${Math.abs(left)}d overdue`;
    if(left === 0)return 'due today';
    return `due in ${left}d`;
  }
  if(days === null)return 'no entries yet';
  if(days < 0)return 'coming up';
  if(h.type === 'zero'){
    if(days === 0)return 'entry today';
    if(days < 3)return 'recent entry';
    return 'on track';
  }
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const left = daysUntil(planBy);
    if(left !== null){
      if(left < 0)return `plan by ${Math.abs(left)}d overdue`;
      if(left === 0)return 'plan by today';
      return `plan by in ${left}d`;
    }
  }
  const target = effectiveTarget(h);
  const pace = avg || days;
  // Whole-day boundary keeps the overdue count an integer for fractional rhythms.
  const due = typeof cueDayBoundary === 'function' ? cueDayBoundary(target) : Math.ceil(target);
  if(h.type === 'keepup'){
    if(days > due)return `${days - due}d overdue`;
    if(days === due)return 'due today';
    return pace <= target ? 'on pace' : 'behind';
  }
  if(days < due)return 'too recent';
  return pace >= target ? 'on track' : 'watch';
}

// RENDER: renders gap history bar graph
function renderGraph(h){
  const graph = $('detail-graph');
  if(h.type === 'task'){
    graph.innerHTML = '';
    return;
  }
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
      ${targetPct ? `<div class="target-line" style="bottom:${targetPct}%"><span>${formatRhythmLabel(target)}</span></div>` : ''}
      ${bars}
    </div>
    <div class="graph-caption">${graphCaption(h,intervals)}</div>`;
}

// PURE: returns the graph rule hint
function graphRule(h){
  if(h.type === 'keepup')return 'shorter is better';
  if(h.type === 'reduce')return 'longer is better';
  if(h.type === 'task')return h.eventTime !== null ? 'fixed time' : 'one-off';
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

// RENDER: renders month calendar grid (shared markers with overview tally)
function renderCalendar(h){
  const frame = monthFrame(detailMonthOffset);
  const {year,month,first,last,label,today} = frame;
  const tally = typeof buildDayTally === 'function'
    ? buildDayTally([h],ts=>{
      const d = new Date(ts);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    : {map:new Map(),actual:0,planned:0};
  const toneByDay = logToneMap(h);
  const monthEntries = tally.actual + tally.planned;
  const activeDays = tally.map.size;
  $('detail-calendar-label').textContent = `${label} · ${monthEntries}`;
  $('detail-calendar-summary').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${tally.actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${tally.planned} planned</span>`;

  const hasSched = typeof hasDaySchedule === 'function' && hasDaySchedule(h);
  const densityFn = typeof calDensityClass === 'function' ? calDensityClass : (count=>count >= 3 ? 'density-3' : count >= 2 ? 'density-2' : count ? 'density-1' : '');

  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:last.getDate()},(_,i)=>{
    const date = new Date(year,month,i + 1);
    const key = dateKey(date.getTime());
    const entries = tally.map.get(key) || [];
    const count = entries.length;
    const toneClass = entries.find(e=>e.tone && e.tone !== 'plan')?.tone
      || (entries.some(e=>e.tone === 'plan') ? 'plan' : '')
      || toneByDay.get(key)
      || '';
    const density = densityFn(count);
    const eligible = !count && hasSched && typeof isDateEligibleForHabit === 'function' && isDateEligibleForHabit(h,date.getTime());
    const dots = count
      ? `<span class="cal-dots"><span class="cal-dot ${toneClass}"></span>${count > 1 ? `<span class="cal-more">${count}</span>` : ''}</span>`
      : '<span class="cal-dots"></span>';
    const cls = [
      count ? 'has-entry' : '',
      density,
      eligible ? 'eligible' : '',
      key === today ? 'today' : '',
      key === dayLogsKey ? 'selected' : '',
      'pickable'
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-entry-day="${key}"><span>${i + 1}</span>${dots}</button>`;
  });
  $('detail-calendar').innerHTML = [...heads,...blanks,...days].join('');
}
