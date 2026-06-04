// Topic chips, search UI, summary copy, cards, swipe gestures, and quick actions.

function iconHtml(h,c){
  if(h.emoji)return `<span class="emoji-mark">${escapeHtml(h.emoji)}</span>`;
  return `<i class="ti ${defaultIcon(h.type)}" style="color:${c.icon};" aria-hidden="true"></i>`;
}

function topicOptions(){
  return normalizeTopics((sortSettings || loadSortSettings()).topics);
}

function selectedTopicsFrom(containerId){
  return [...$(containerId).querySelectorAll('.topic-chip.on')].map(btn=>btn.dataset.topic);
}

function selectedAddTopics(){
  return selectedTopicsFrom('ting-topic-chips');
}

function selectedWeekdaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.schedule-chip.on')].map(btn=>parseInt(btn.dataset.weekday,10));
}

function selectedMonthDaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.monthday-chip.on')].map(btn=>parseInt(btn.dataset.monthday,10));
}

function renderScheduleChips(prefix,h = {}){
  const weekdays = new Set(normalizeAllowedWeekdays(h.allowedWeekdays));
  const monthDays = new Set(normalizeAllowedMonthDays(h.allowedMonthDays));
  const weekdayWrap = $(`${prefix}-weekday-chips`);
  const monthWrap = $(`${prefix}-monthday-chips`);
  if(weekdayWrap){
    weekdayWrap.innerHTML = WEEKDAY_LABELS.map((label,day)=>{
      const on = weekdays.has(day);
      return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-weekday="${day}" aria-pressed="${on}">${label}</button>`;
    }).join('');
  }
  if(monthWrap){
    monthWrap.innerHTML = Array.from({length:31},(_,i)=>{
      const day = i + 1;
      const on = monthDays.has(day);
      return `<button type="button" class="monthday-chip ${on ? 'on' : ''}" data-monthday="${day}" aria-pressed="${on}">${day}</button>`;
    }).join('');
  }
}

function toggleScheduleChip(e){
  const btn = e.target.closest('.schedule-chip[data-weekday],.monthday-chip[data-monthday]');
  if(!btn)return;
  btn.classList.toggle('on');
  btn.setAttribute('aria-pressed',String(btn.classList.contains('on')));
  if(btn.closest('#detail-weekday-chips,#detail-monthday-chips'))setDetailDirty();
}

function renderTopicChips(containerId,selected = []){
  const topics = topicOptions();
  const selectedSet = new Set(normalizeTopics(selected).map(topic=>topic.toLowerCase()));
  const wrap = $(containerId);
  if(!wrap)return;
  if(!topics.length){
    wrap.innerHTML = '<span class="topic-chip empty">no topics yet</span>';
    return;
  }
  wrap.innerHTML = topics.map(topic=>{
    const on = selectedSet.has(topic.toLowerCase());
    return `<button type="button" class="topic-chip ${on ? 'on' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`;
  }).join('');
}

function toggleTopicChip(e){
  const btn = e.target.closest('.topic-chip[data-topic]');
  if(!btn)return;
  btn.classList.toggle('on');
  if(btn.closest('#detail-topic-chips'))setDetailDirty();
}

function renderTopicList(){
  const list = $('topic-list');
  if(!list)return;
  const topics = topicOptions();
  list.innerHTML = topics.length
    ? topics.map(topic=>`<button type="button" class="topic-chip" data-remove-topic="${escapeHtml(topic)}">${escapeHtml(topic)} <i class="ti ti-x" aria-hidden="true"></i></button>`).join('')
    : '<span class="topic-chip empty">no topics</span>';
}

function addTopic(){
  const input = $('topic-name');
  const topic = cleanTopic(input.value);
  if(!topic){input.focus();return;}
  const topics = normalizeTopics([...topicOptions(),topic]);
  updateSortSetting({topics},{renderNow:false});
  input.value = '';
  renderTopicList();
  renderTopicChips('ting-topic-chips',selectedAddTopics());
  if(detailIdx !== null)renderTopicChips('detail-topic-chips',currentDetailTune().topics);
  render();
}

function removeTopic(topic){
  const key = topic.toLowerCase();
  const topics = topicOptions().filter(item=>item.toLowerCase() !== key);
  updateSortSetting({topics},{renderNow:false});
  const data = load().map(h=>({
    ...h,
    topics:normalizeTopics(h.topics).filter(item=>item.toLowerCase() !== key)
  }));
  save(data);
  renderTopicList();
  renderTopicChips('ting-topic-chips',selectedAddTopics());
  if(detailIdx !== null)renderTopicChips('detail-topic-chips',currentDetailTune().topics);
  refreshOpenViews();
}

function updateSortButton(){
  const count = load().length;
  $('open-overview').classList.toggle('is-hidden',count < 2);
  $('open-overview').disabled = count < 2;
  $('open-search').classList.toggle('is-hidden',count < 10);
  $('open-search').disabled = count < 10;
  if(count < 10)closeSearch({render:false});
}

function updateSearchUi(){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  const searchBtn = $('open-search');
  const clearBtn = $('clear-search');
  if(!nav || !input || !searchBtn)return;
  const open = nav.classList.contains('search-open');
  input.value = searchQuery;
  document.body.classList.toggle('search-active',open);
  searchBtn.classList.toggle('is-on',open);
  searchBtn.setAttribute('aria-pressed',String(open));
  $('nav-search').setAttribute('aria-hidden',String(!open));
  if(clearBtn){
    const empty = !searchQuery.trim();
    $('nav-search').classList.toggle('is-empty',empty);
    clearBtn.hidden = true;
  }
}

function setSearchOpen(open,options = {}){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  if(!nav || !input)return;
  if(options.clear)searchQuery = '';
  nav.classList.toggle('search-open',open);
  updateSearchUi();
  if(open && options.focus !== false){
    input.focus({preventScroll:true});
    updateKeyboardLift();
    keepFocusedInputVisible();
    requestAnimationFrame(()=>{
      if(nav.classList.contains('search-open') && document.activeElement !== input)input.focus({preventScroll:true});
      updateKeyboardLift();
      keepFocusedInputVisible();
    });
    setTimeout(()=>{
      updateKeyboardLift();
      keepFocusedInputVisible();
    },260);
  }else if(!open && document.activeElement === input){
    input.blur();
  }
  if(!open)updateKeyboardLift();
  if(options.render !== false)render();
}

function closeSearch(options = {}){
  const nav = document.querySelector('.bottom-nav');
  const active = Boolean(searchQuery.trim()) || Boolean(nav?.classList.contains('search-open'));
  setSearchOpen(false,{
    clear:options.clear !== false,
    focus:false,
    render:options.render ?? active
  });
}

function shouldDismissSearchFromTap(target){
  const nav = document.querySelector('.bottom-nav');
  if(!target?.closest)return false;
  if(!nav?.classList.contains('search-open'))return false;
  if(target.closest('#habit-search'))return false;
  if(target.closest('.bottom-nav'))return target.closest('#open-search');
  if(target.closest('.sheet-wrap.open'))return false;
  if(searchQuery.trim() && target.closest('.swipe-row,.ting-card,.swipe-actions'))return false;
  return true;
}

function updateOverallSummary(data = load()){
  const label = $('overall-summary');
  if(!label)return;
  if(!data.length){
    label.textContent = 'ready for your first habit';
    return;
  }
  const query = searchQuery.trim();
  if(query){
    const matches = filteredVisibleIndices(data).length;
    label.textContent = matches === 1 ? `1 match for "${query}"` : `${matches} matches for "${query}"`;
    return;
  }
  const visible = data.filter(h=>!(h.snoozedUntil && Date.now() < h.snoozedUntil));
  if(!visible.length){
    label.textContent = 'all hidden for now';
    return;
  }
  const plannedToday = visible.filter(h=>h.type !== 'zero' && hasPlannedToday(h)).length;
  const plannedSoon = visible.some(h=>{
    const plan = nextPlannedLog(h);
    return h.type !== 'zero' && plan && dayDistance(plan) >= -3;
  });
  const buildDueCount = visible.filter(h=>h.type === 'keepup').filter(h=>{
    const days = daysSince(h.lastLog);
    return days === null || days >= effectiveTarget(h) * 0.9;
  }).length;
  const buildCalm = visible.filter(h=>h.type === 'keepup').every(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days < effectiveTarget(h) * 0.9;
  });
  const limitGoodCount = visible.filter(h=>h.type === 'reduce').filter(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days >= effectiveTarget(h);
  }).length;
  const limitTooSoonCount = visible.filter(h=>h.type === 'reduce').filter(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days < effectiveTarget(h) * 0.55;
  }).length;
  const stopFreshCount = visible.filter(h=>h.type === 'zero').filter(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days < 3;
  }).length;
  const buildCount = visible.filter(h=>h.type === 'keepup').length;
  const limitCount = visible.filter(h=>h.type === 'reduce').length;
  const stopCount = visible.filter(h=>h.type === 'zero').length;
  const tones = visible.map(h=>scoreTone(progressScore(h)));
  const goodCount = tones.filter(t=>t === 'hit').length;
  const okayCount = tones.filter(t=>t === 'warn').length;
  const careCount = tones.filter(t=>t === 'miss' || t === 'empty').length;
  const total = visible.length;
  const allGood = goodCount === total;
  const mostlyGood = goodCount >= Math.ceil(total * 0.65) && careCount <= 1;
  const mixed = goodCount > 0 && (okayCount > 0 || careCount > 0);
  const needsCare = careCount >= Math.max(2,Math.ceil(total * 0.35));

  if(allGood && plannedSoon)label.textContent = 'you are on track, with plans ahead';
  else if(allGood)label.textContent = 'you are on track overall';
  else if(mostlyGood && plannedToday)label.textContent = 'mostly on track, with plans today';
  else if(mostlyGood && limitTooSoonCount)label.textContent = 'mostly good, give a few more space';
  else if(mostlyGood && stopFreshCount)label.textContent = 'mostly good, one reset needs care';
  else if(mostlyGood)label.textContent = 'mostly on track, a few need care';
  else if(needsCare && goodCount)label.textContent = 'some progress, but several need care';
  else if(needsCare)label.textContent = 'things need attention right now';
  else if(mixed && buildDueCount && limitGoodCount)label.textContent = 'some due, but spacing looks good';
  else if(mixed && limitTooSoonCount && buildCalm)label.textContent = 'some steady, some need more space';
  else if(mixed)label.textContent = 'mixed week, some habits need care';
  else if(plannedToday)label.textContent = 'you have habits planned for today';
  else if(limitCount && limitGoodCount && !buildCount)label.textContent = 'you are spacing things well';
  else if(stopCount && !buildCount && !limitCount)label.textContent = 'you are keeping things calm';
  else label.textContent = 'a little attention would help today';
}

function nextPlannedLog(h){
  return plannedLogs(h.logs)[0] || null;
}

function nextEligibleCopy(h){
  if(!hasDaySchedule(h))return '';
  const distance = nextEligibleDistance(h);
  if(distance === null)return 'no matching day soon';
  if(distance === 0)return 'available today';
  if(distance === 1)return 'available tomorrow';
  const next = nextEligibleDate(h);
  if(distance <= 6)return `available ${new Date(next).toLocaleDateString(undefined,{weekday:'short'})}`;
  return `available ${new Date(next).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}

function nextEligibleShort(h){
  if(!hasDaySchedule(h))return '';
  const distance = nextEligibleDistance(h);
  if(distance === null)return '-';
  if(distance === 0)return '';
  return `${distance}d`;
}

function compactPlanLabel(ts){
  const days = calendarDayDiff(ts);
  if(days === null)return '';
  if(days <= 0)return '';
  return `${days}d`;
}

function buildCue(h,days,target){
  if(days === null)return 'Ready for first entry';
  if(days < 0)return 'Planned ahead';
  const remaining = target - days;
  if(remaining < 0){
    const overdue = Math.abs(remaining);
    if(overdue === 1)return '1 day overdue';
    if(overdue <= 7)return `${overdue} days overdue`;
    return `${Math.round(overdue / 7)} weeks overdue`;
  }
  if(remaining === 0)return 'Due today';
  if(remaining === 1)return 'Due tomorrow';
  if(remaining <= 3)return `Due in ${remaining} days`;
  if(days <= target * 0.5)return 'Steady rhythm';
  return `${remaining} days left`;
}

function limitCue(h,days,target){
  if(days === null)return 'No entries yet';
  if(days < 0)return 'Planned ahead';
  const remaining = target - days;
  if(remaining > 1)return `Wait ${remaining} days`;
  if(remaining === 1)return 'Wait 1 more day';
  if(remaining === 0)return 'Okay today';
  return 'Enough space';
}

function cardCue(h){
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  const plan = nextPlannedLog(h);
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'Snoozed for now';
  if(plan && dateKey(plan) === dateKey(Date.now()) && h.type !== 'zero')return 'Planned today';
  if(days === null){
    if(h.type === 'zero')return 'Nothing logged';
    return 'Ready to start';
  }
  if(days < 0)return 'Coming up';
  if(h.type === 'keepup')return buildCue(h,days,target);
  if(h.type === 'reduce')return limitCue(h,days,target);
  if(days === 0)return 'Reset today';
  if(days === 1)return '1 day clear';
  if(days < 4)return `${days} days clear`;
  return `${days} days clear`;
}

function cardTone(h){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'quiet';
  if(hasPlannedToday(h) && h.type !== 'zero')return 'plan';
  return scoreTone(progressScore(h));
}

function cardMeta(h,options = {}){
  const plan = nextPlannedLog(h);
  const parts = [];
  if(h.sample)parts.push('<span class="context-pill quiet" title="sample habit"><i class="ti ti-test-pipe" aria-hidden="true"></i>sample</span>');
  if(h.pinned)parts.push('<span class="context-pill pin" title="pinned"><i class="ti ti-pin" aria-hidden="true"></i></span>');
  if(options.forceRepetition || sortSettings.showRepetitionOnCards){
    if(h.type !== 'zero')parts.push(`<span class="context-pill" title="target rhythm"><i class="ti ti-repeat" aria-hidden="true"></i>${h.target || 7}d</span>`);
    else parts.push('<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>');
  }
  if((options.forceDuration || sortSettings.showDurationOnCards) && h.durationMinutes)parts.push(`<span class="context-pill" title="duration"><i class="ti ti-clock" aria-hidden="true"></i>${h.durationMinutes}m</span>`);
  if((options.forceFlexibility || sortSettings.showFlexibilityOnCards) && h.flexibilityDays)parts.push(`<span class="context-pill" title="flexibility"><i class="ti ti-arrows-left-right" aria-hidden="true"></i>±${h.flexibilityDays}d</span>`);
  if(hasDaySchedule(h)){
    const eligible = nextEligibleShort(h);
    const title = [scheduleSummary(h),nextEligibleCopy(h)].filter(Boolean).join(' · ');
    parts.push(`<span class="context-pill schedule ${eligible ? '' : 'icon-only'}" title="${escapeHtml(title)}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(eligible)}</span>`);
  }
  const topics = normalizeTopics(h.topics);
  if(options.forceTopics || sortSettings.showTopicsOnCards){
    topics.slice(0,2).forEach(topic=>{
      parts.push(`<span class="context-pill quiet" title="topic"><i class="ti ti-tag" aria-hidden="true"></i>${escapeHtml(topic)}</span>`);
    });
    if(topics.length > 2)parts.push(`<span class="context-pill quiet" title="more topics">+${topics.length - 2}</span>`);
  }
  if(plan && h.type !== 'zero'){
    const label = compactPlanLabel(plan);
    parts.push(`<span class="context-pill plan ${label ? '' : 'icon-only'}" title="${escapeHtml(`planned ${entryWhen(plan)}`)}"><i class="ti ti-calendar-event" aria-hidden="true"></i>${escapeHtml(label)}</span>`);
  }
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)parts.push(`<span class="context-pill quiet" title="snoozed"><i class="ti ti-moon" aria-hidden="true"></i>${escapeHtml(entryWhen(h.snoozedUntil))}</span>`);
  return parts.join('');
}

function cardTrail(h){
  const today = new Date();
  const logKeys = logToneMap(h);
  const lastWeekTones = Array.from({length:7},(_,i)=>{
    const d = new Date(today.getFullYear(),today.getMonth(),today.getDate() - (13 - i));
    const key = dateKey(d.getTime());
    return logKeys.get(key) || '';
  }).filter(Boolean);
  const lastWeekTone = summarizeTrailTone(lastWeekTones);
  const lastWeek = `<span class="trail-week ${lastWeekTone}" aria-hidden="true"></span>`;
  const thisWeek = Array.from({length:7},(_,i)=>{
    const d = new Date(today.getFullYear(),today.getMonth(),today.getDate() - (6 - i));
    const key = dateKey(d.getTime());
    const tone = logKeys.get(key) || 'empty';
    const todayClass = i === 6 ? ' today' : '';
    return `<span class="trail-dot ${tone}${todayClass}"></span>`;
  }).join('');
  return `${lastWeek}${thisWeek}`;
}

function summarizeTrailTone(tones){
  if(!tones.length)return '';
  if(tones.includes('plan'))return 'plan';
  if(tones.includes('miss'))return 'miss';
  if(tones.includes('warn'))return 'warn';
  if(tones.includes('hit'))return 'hit';
  return '';
}

function render(){
  const data = load();
  const list = $('list');
  const empty = $('empty');
  list.innerHTML = '';
  empty.onclick = null;
  updateQuotaBar(sizeKb(data));
  updateSortButton();
  updateSearchUi();
  updateOverallSummary(data);

  const visible = visibleIndices(data);
  const indices = filteredVisibleIndices(data);
  if(!indices.length){
    empty.style.display = 'block';
    const hasSearch = searchQuery.trim().length > 0;
    empty.classList.toggle('is-action',data.length > 0 && !sortSettings.showSnoozed && !hasSearch);
    if(hasSearch){
      empty.innerHTML = 'no matches<br><span class="empty-sub">try another habit name or icon</span>';
    }else if(data.length && !sortSettings.showSnoozed && !visible.length){
      empty.innerHTML = 'hidden for now<br><span class="empty-sub">tap to show</span>';
      empty.onclick = ()=>{
        saveSortSettings({...sortSettings,showSnoozed:true});
        syncSettingsControls();
        render();
      };
    }else{
      empty.innerHTML = 'simple habit tracking<br><span class="empty-sub">Saved on this device. Tap Habits for help and settings, or + to add your first habit.</span>';
    }
    return;
  }
  empty.classList.remove('is-action');
  empty.style.display = 'none';

  indices.forEach(realIdx=>{
    const h = data[realIdx];
    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const cardScore = progressScore(h);
    const cardScoreTone = cardTone(h);
    const cue = cardCue(h);
    const context = cardMeta(h);
    const trail = cardTrail(h);
    const accent = visualClassColor(cardScoreTone);
    const pinAction = `<button class="swipe-action sa-pin" data-action="pin" aria-label="${h.pinned ? 'unpin' : 'pin'}"><i class="ti ${h.pinned ? 'ti-pinned-off' : 'ti-pin'}" aria-hidden="true"></i>${h.pinned ? 'unpin' : 'pin'}</button>`;
    const activityAction = `<button class="swipe-action sa-activity" data-action="activity" aria-label="activity"><i class="ti ti-history" aria-hidden="true"></i>activity</button>`;

    const row = document.createElement('div');
    row.className = 'swipe-row';
    row.dataset.realIdx = realIdx;
    row.innerHTML = `
      <div class="swipe-actions swipe-actions-left">
        ${pinAction}
        ${activityAction}
      </div>
      <div class="swipe-actions swipe-actions-right">
        <button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>remove</button>
      </div>
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}" data-real="${realIdx}" style="--card-accent:${accent};">
        <button class="pulse-btn ${h.emoji ? 'emoji-pulse' : ''}" data-pulse="${realIdx}" aria-label="add entry for ${escapeHtml(h.name)}" style="background:${c.bg};color:${c.icon};">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info">
          <div class="ting-main">
            <span class="ting-name">${escapeHtml(h.name)}</span>
            <div class="mini-score-ring ${cardScoreTone}" style="--score:${cardScore ?? 0};--score-color:${accent};" title="${escapeHtml(cue)}" aria-hidden="true"></div>
          </div>
          <div class="ting-status">
            <div class="ting-cue">${escapeHtml(cue)}</div>
            <div class="ting-meta" aria-label="rhythm and plan">${context}</div>
          </div>
          <div class="ting-visual" aria-hidden="true">
            <div class="ting-trail">${trail}</div>
          </div>
        </div>
      </div>`;

    list.appendChild(row);
    setupSwipe(row);
    setupCardTap(row,realIdx);
  });

  list.querySelectorAll('[data-pulse]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      if(swipeOpenCard){
        e.preventDefault();
        closeAllSwipes();
        return;
      }
      const idx = +btn.dataset.pulse;
      const card = btn.closest('.ting-card');
      handleCardActivate(idx,card,()=>quickLog(idx,card));
    });
  });

  list.querySelectorAll('.swipe-action').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      closeAllSwipes();
      if(btn.dataset.action === 'pin')togglePin(idx);
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
    });
  });
}

function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const leftActions = row.querySelector('.swipe-actions-left');
  const rightActions = row.querySelector('.swipe-actions-right');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;
  let startedOpen = false;

  function revealWidth(actions){
    return actions.querySelectorAll('.swipe-action').length * SWIPE_ACTION_WIDTH;
  }

  function resetSwipe(){
    card.style.transition = SNAP_TRANSITION;
    card.style.transform = '';
    leftActions.style.transition = WIDTH_TRANSITION;
    rightActions.style.transition = WIDTH_TRANSITION;
    leftActions.style.width = '0';
    rightActions.style.width = '0';
    leftActions.style.pointerEvents = 'none';
    rightActions.style.pointerEvents = 'none';
    swipeOpenCard = null;
    delete row.dataset.swipeOpen;
    startedOpen = false;
    moved = false;
    dx = 0;
  }

  row.addEventListener('touchstart',e=>{
    const t = e.changedTouches[0];
    touchId = t.identifier;startX = t.clientX;startY = t.clientY;dx = 0;moved = false;
    startedOpen = swipeOpenCard === card;
    if(swipeOpenCard && swipeOpenCard !== card){
      closeAllSwipes();
    }
  },{passive:true});

  row.addEventListener('touchmove',e=>{
    const t = [...e.changedTouches].find(item=>item.identifier === touchId);
    if(!t)return;
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;
    if(!moved && Math.abs(ddy) > Math.abs(ddx))return;
    e.preventDefault();
    if(startedOpen){
      if(Math.abs(ddx) > 12){
        closeAllSwipes();
        moved = true;dx = 0;
      }
      return;
    }
    const openDir = swipeOpenCard === card ? parseInt(row.dataset.swipeOpen || '0',10) : 0;
    if(openDir){
      closeAllSwipes();
      moved = true;dx = 0;
      return;
    }
    moved = true;dx = ddx;
    const wantsLeft = dx > 0;
    const activeActions = wantsLeft ? leftActions : rightActions;
    const inactiveActions = wantsLeft ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const clamped = reveal ? Math.max(-reveal,Math.min(reveal,dx)) : 0;
    card.style.transition = 'none';
    activeActions.style.transition = 'none';
    inactiveActions.style.transition = 'none';
    card.style.transform = `translateX(${clamped}px)`;
    const pct = reveal ? Math.min(1,Math.abs(clamped) / reveal) : 0;
    activeActions.style.width = `${Math.abs(clamped)}px`;
    activeActions.style.pointerEvents = pct > 0.2 ? 'auto' : 'none';
    inactiveActions.style.width = '0';
    inactiveActions.style.pointerEvents = 'none';
  },{passive:false});

  row.addEventListener('touchend',()=>{
    if(!moved)return;
    if(startedOpen){
      startedOpen = false;
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    const activeActions = dir > 0 ? leftActions : rightActions;
    const inactiveActions = dir > 0 ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const snap = reveal > 0 && Math.abs(dx) > Math.min(SWIPE_THRESHOLD,reveal * 0.55);
    card.style.transition = SNAP_TRANSITION;
    activeActions.style.transition = WIDTH_TRANSITION;
    inactiveActions.style.transition = WIDTH_TRANSITION;
    if(snap){
      card.style.transform = `translateX(${dir * reveal}px)`;
      activeActions.style.width = `${reveal}px`;
      activeActions.style.pointerEvents = 'auto';
      inactiveActions.style.width = '0';
      inactiveActions.style.pointerEvents = 'none';
      swipeOpenCard = card;
      row.dataset.swipeOpen = String(dir);
    }else{
      card.style.transform = '';
      leftActions.style.width = '0';
      rightActions.style.width = '0';
      leftActions.style.pointerEvents = 'none';
      rightActions.style.pointerEvents = 'none';
      swipeOpenCard = null;
      delete row.dataset.swipeOpen;
    }
  });

  row.addEventListener('touchcancel',resetSwipe,{passive:true});
}

function closeAllSwipes(){
  document.querySelectorAll('.swipe-row').forEach(row=>{
    const card = row.querySelector('.ting-card');
    const actions = row.querySelectorAll('.swipe-actions');
    if(card){
      card.style.transition = SNAP_TRANSITION;
      card.style.transform = '';
    }
    actions.forEach(actions=>{
      actions.style.transition = WIDTH_TRANSITION;
      actions.style.width = '0';
      actions.style.pointerEvents = 'none';
    });
    delete row.dataset.swipeOpen;
  });
  swipeOpenCard = null;
}

function setupCardTap(row,realIdx){
  const card = row.querySelector('.ting-card');
  card.addEventListener('pointerdown',e=>{
    if(e.target.closest('.pulse-btn'))return;
    cardPointer = {card,realIdx,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
  });
  card.addEventListener('pointerup',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    const tap = cardPointer;
    cardPointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    if(moved > 10 || Date.now() - tap.time > 800)return;
    suppressCardClick = card;
    if(swipeOpenCard){closeAllSwipes();}
    else handleCardActivate(realIdx,card,()=>openDetail(realIdx));
    setTimeout(()=>{if(suppressCardClick === card)suppressCardClick = null;},120);
  });
  card.addEventListener('pointercancel',e=>{
    if(cardPointer && cardPointer.card === card && cardPointer.id === e.pointerId)cardPointer = null;
  });
  card.addEventListener('click',e=>{
    if(suppressCardClick === card){
      e.preventDefault();
      e.stopPropagation();
      suppressCardClick = null;
      return;
    }
    if(e.target.closest('.pulse-btn'))return;
    if(swipeOpenCard){closeAllSwipes();return;}
    handleCardActivate(realIdx,card,()=>openDetail(realIdx));
  });
}

function handleCardActivate(realIdx,card,singleAction){
  const now = Date.now();
  if(lastTap.idx === realIdx && now - lastTap.time < TAP_DELAY){
    clearTimeout(tapTimer);
    lastTap = {idx:-1,time:0};
    quickLog(realIdx,card);
  }else{
    lastTap = {idx:realIdx,time:now};
    clearTimeout(tapTimer);
    tapTimer = setTimeout(singleAction,TAP_DELAY);
  }
}

function logTing(i){
  const data = load();
  const now = Date.now();
  if(!data[i])return false;
  const undo = {type:'entry',idx:i,ts:now,snoozedUntil:data[i].snoozedUntil || null};
  data[i].lastLog = now;
  data[i].logs = normalizeLogs([...(data[i].logs || []),now]);
  data[i].snoozedUntil = null;
  if(!save(data))return false;
  showUndo('Entry logged',undo);
  return true;
}

function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
  const entryTs = dateKey(ts) <= dateKey(Date.now()) && ts > Date.now() ? Date.now() : ts;
  const log = makeLog(entryTs);
  const undo = {type:'entry',idx:i,ts:entryTs,plan:isPlanLog(log),snoozedUntil:data[i].snoozedUntil || null};
  data[i].logs = normalizeLogs([...(data[i].logs || []),log]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!isPlanLog(log))data[i].snoozedUntil = null;
  if(!save(data))return false;
  showUndo(isPlanLog(log) ? 'Plan added' : 'Entry added',undo);
  return true;
}

function removeEntryAt(i,ts,planOnly = false){
  const data = load();
  if(!data[i])return false;
  const logs = normalizeLogs(data[i].logs);
  const pos = logs.findIndex(log=>sameLog(log,ts,planOnly));
  if(pos < 0)return false;
  logs.splice(pos,1);
  data[i].logs = logs;
  data[i].lastLog = latestActualLog(logs);
  return save(data);
}

function undoLastAction(){
  if(!pendingUndo)return;
  const data = load();
  if(pendingUndo.type === 'entry'){
    const {idx,ts,snoozedUntil} = pendingUndo;
    if(!data[idx])return;
    const logs = normalizeLogs(data[idx].logs);
    const pos = logs.findIndex(log=>sameLog(log,ts,Boolean(pendingUndo.plan)));
    if(pos >= 0)logs.splice(pos,1);
    data[idx].logs = logs;
    data[idx].lastLog = latestActualLog(logs);
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingUndo.type === 'hide'){
    const {idx,snoozedUntil} = pendingUndo;
    if(!data[idx])return;
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingUndo.type === 'delete'){
    const {idx,habit} = pendingUndo;
    data.splice(Math.min(idx,data.length),0,habit);
  }
  if(save(data)){
    hideUndo();
    showToast('undone');
    refreshOpenViews();
  }
}

function quickLog(i,card){
  if(!logTing(i))return;
  if(card){
    card.classList.add('logged');
    setTimeout(()=>card.classList.remove('logged'),380);
  }
  setTimeout(render,260);
}

function nextPlanTime(h){
  const base = h.lastLog || Date.now();
  const target = h.target || 7;
  let d = new Date(base + target * 86400000);
  d = new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0,0);
  if(d.getTime() <= Date.now()){
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    d = new Date(tomorrow.getFullYear(),tomorrow.getMonth(),tomorrow.getDate(),12,0,0,0);
  }
  return d.getTime();
}

function nextPlanLabel(h){
  return new Date(nextPlanTime(h)).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

function planNext(i){
  const h = load()[i];
  if(!h || h.type === 'zero')return;
  const ts = nextPlanTime(h);
  if(logTingAt(i,ts))refreshOpenViews();
}

function togglePin(i){
  const data = load();
  if(!data[i])return;
  data[i].pinned = !data[i].pinned;
  if(save(data)){
    showToast(data[i].pinned ? 'pinned' : 'unpinned');
    render();
  }
}
