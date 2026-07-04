// Topic chips, search UI, summary copy, cards, swipe gestures, and quick actions.
//
// This file renders the home list view (topic chips, search, summary copy,
// cards, swipe gestures, and quick actions). Annotated for a React Native port:
//   - RENDER  -> React functional components
//   - HANDLER -> onPress / onChange callbacks
//   - WIRE    -> useEffect setup hooks
//   - PURE    -> plain helper modules / selectors
//   - HYBRID  -> split into state hooks + presentational components

// PURE: build icon markup string
function iconHtml(h,c){
  if(h.emoji)return `<span class="emoji-mark">${escapeHtml(h.emoji)}</span>`;
  return `<i class="ti ${defaultIcon(h.type)}" style="color:${c.icon};" aria-hidden="true"></i>`;
}

// PURE: get normalized topic list
function topicOptions(){
  return normalizeTopics((sortSettings || loadSortSettings()).topics);
}

// PURE: read selected topics from DOM
function selectedTopicsFrom(containerId){
  return [...$(containerId).querySelectorAll('.topic-chip.on')].map(btn=>btn.dataset.topic);
}

// PURE: read selected add-topic chips
function selectedAddTopics(){
  return selectedTopicsFrom('ting-topic-chips');
}

// PURE: read selected weekday chips
function selectedWeekdaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.schedule-chip.on')].map(btn=>parseInt(btn.dataset.weekday,10));
}

// PURE: read selected month-day chips
function selectedMonthDaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.monthday-chip.on')].map(btn=>parseInt(btn.dataset.monthday,10));
}

// RENDER: draw weekday and month-day chips
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
  const prefWeekdays = new Set(normalizeAllowedWeekdays(h.preferredWeekdays));
  const prefMonthDays = new Set(normalizeAllowedMonthDays(h.preferredMonthDays));
  const prefWeekdayWrap = $(`${prefix}-preferred-weekday-chips`);
  const prefMonthWrap = $(`${prefix}-preferred-monthday-chips`);
  if(prefWeekdayWrap){
    prefWeekdayWrap.innerHTML = WEEKDAY_LABELS.map((label,day)=>{
      const on = prefWeekdays.has(day);
      return `<button type="button" class="schedule-chip preferred ${on ? 'on' : ''}" data-weekday="${day}" aria-pressed="${on}">${label}</button>`;
    }).join('');
  }
  if(prefMonthWrap){
    prefMonthWrap.innerHTML = Array.from({length:31},(_,i)=>{
      const day = i + 1;
      const on = prefMonthDays.has(day);
      return `<button type="button" class="monthday-chip preferred ${on ? 'on' : ''}" data-monthday="${day}" aria-pressed="${on}">${day}</button>`;
    }).join('');
  }
}

// PURE: convert minutes to HH:MM
function minutesToTimeInput(minutes){
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
// PURE: parse HH:MM into minutes
function timeInputToMinutes(value){
  if(!value)return null;
  const [h,m] = value.split(':').map(Number);
  if(Number.isNaN(h) || Number.isNaN(m))return null;
  return h * 60 + m;
}
// PURE: ms timestamp -> "YYYY-MM-DD" for <input type="date">
function dateInputValue(ts){
  if(!ts)return '';
  return dateKey(ts);
}
// PURE: ms timestamp -> "HH:mm" for <input type="time">
function timeInputValue(ts){
  if(!ts)return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}
// PURE: ms timestamp -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local">
function datetimeInputValue(ts){
  if(!ts)return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

// HANDLER: toggle schedule chip on tap
function toggleScheduleChip(e){
  const btn = e.target.closest('.schedule-chip[data-weekday],.monthday-chip[data-monthday]');
  if(!btn)return;
  btn.classList.toggle('on');
  btn.setAttribute('aria-pressed',String(btn.classList.contains('on')));
  if(btn.closest('#detail-weekday-chips,#detail-monthday-chips,#detail-preferred-weekday-chips,#detail-preferred-monthday-chips'))setDetailDirty();
}

// RENDER: build the add-topic pill button
function createAddTopicPill(){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topic-chip topic-chip-add';
  btn.dataset.topicAdd = '';
  btn.setAttribute('aria-label','new topic');
  btn.innerHTML = '<i class="ti ti-plus" aria-hidden="true"></i>new topic';
  return btn;
}

// RENDER: draw selectable topic chips
function renderTopicChips(containerId,selected = []){
  const topics = topicOptions();
  const selectedSet = new Set(normalizeTopics(selected).map(topic=>topic.toLowerCase()));
  const wrap = $(containerId);
  if(!wrap)return;
  wrap.innerHTML = topics.map(topic=>{
    const on = selectedSet.has(topic.toLowerCase());
    return `<button type="button" class="topic-chip ${on ? 'on' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`;
  }).join('');
  wrap.appendChild(createAddTopicPill());
}

// HYBRID: swap pill for input and wire commit
function beginNewTopicInput(containerId){
  const wrap = $(containerId);
  if(!wrap)return;
  if(wrap.querySelector('.topic-chip-input')){
    wrap.querySelector('.topic-chip-input')?.focus();
    return;
  }
  const pill = wrap.querySelector('[data-topic-add]');
  if(!pill)return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'topic-chip topic-chip-input';
  input.maxLength = 32;
  input.placeholder = 'new topic';
  input.autocomplete = 'off';
  input.autocorrect = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  pill.replaceWith(input);
  input.focus({preventScroll:true});
  if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
  if(typeof keepFocusedInputVisible === 'function')keepFocusedInputVisible();
  let settled = false;
  const restorePill = ()=>{
    if(input.isConnected)input.replaceWith(pill);
  };
  const commit = ()=>{
    if(settled)return;
    settled = true;
    const topic = cleanTopic(input.value);
    if(!topic || !$(containerId)){
      restorePill();
      return;
    }
    const existing = normalizeTopics(topicOptions());
    if(!existing.some(item=>item.toLowerCase() === topic.toLowerCase())){
      updateSortSetting({topics:normalizeTopics([...existing,topic])},{renderNow:false});
    }
    const nextSelected = normalizeTopics([...selectedTopicsFrom(containerId),topic]);
    renderTopicChips(containerId,nextSelected);
    renderTopicList();
    if(containerId === 'detail-topic-chips')setDetailDirty();
    render();
  };
  input.addEventListener('blur',()=>{
    if(settled)return;
    setTimeout(commit,0);
  });
  input.addEventListener('keydown',e=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      if(!settled){
        settled = true;
        commit();
      }
    }else if(e.key === 'Escape'){
      e.preventDefault();
      if(settled)return;
      settled = true;
      restorePill();
    }
  });
}

// HANDLER: toggle topic chip on tap
function toggleTopicChip(e){
  const btn = e.target.closest('.topic-chip[data-topic]');
  if(!btn)return;
  btn.classList.toggle('on');
  if(btn.closest('#detail-topic-chips'))setDetailDirty();
}

// RENDER: draw removable topic list
function renderTopicList(){
  const list = $('topic-list');
  if(!list)return;
  const topics = topicOptions();
  list.innerHTML = topics.length
    ? topics.map(topic=>`<button type="button" class="topic-chip" data-remove-topic="${escapeHtml(topic)}">${escapeHtml(topic)} <i class="ti ti-x" aria-hidden="true"></i></button>`).join('')
    : '<span class="topic-chip empty">no topics</span>';
}

// HYBRID: add topic, update state, re-render
function addTopicFromInput(inputId,options = {}){
  const input = $(inputId);
  if(!input)return;
  const topic = cleanTopic(input.value);
  if(!topic){input.focus();return;}
  const topics = normalizeTopics([...topicOptions(),topic]);
  updateSortSetting({topics},{renderNow:false});
  input.value = '';
  input.blur();
  renderTopicList();
  const autoSelect = options.autoSelect;
  const addSelected = autoSelect ? normalizeTopics([...selectedAddTopics(),topic]) : selectedAddTopics();
  renderTopicChips('ting-topic-chips',addSelected);
  if(detailIdx !== null){
    const detailSelected = autoSelect
      ? normalizeTopics([...selectedTopicsFrom('detail-topic-chips'),topic])
      : currentDetailTune().topics;
    renderTopicChips('detail-topic-chips',detailSelected);
    if(autoSelect)setDetailDirty();
  }
  render();
}

// HANDLER: add topic from input field
function addTopic(){
  addTopicFromInput('topic-name');
}

// HYBRID: remove topic and refresh views
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
  if(typeof homeTopicFilter !== 'undefined' && homeTopicFilter !== 'all' && homeTopicFilter.toLowerCase() === key){
    homeTopicFilter = 'all';
  }
  refreshOpenViews();
}

// PURE: compute home topic filter choices
function homeTopicChoices(data){
  const topics = normalizeTopics([...topicOptions(),...data.flatMap(h=>normalizeTopics(h.topics))]);
  const hasNoTopic = data.some(h=>!normalizeTopics(h.topics).length);
  return [{key:'all',label:'all'},...topics.map(topic=>({key:topic,label:topic})),...(hasNoTopic ? [{key:'__none__',label:'no topic'}] : [])];
}

// PURE: test habit matches home topic
function matchesHomeTopic(h,topic){
  if(!topic || topic === 'all')return true;
  const topics = normalizeTopics(h.topics);
  if(topic === '__none__')return !topics.length;
  return topics.some(item=>item.toLowerCase() === topic.toLowerCase());
}

// HYBRID: draw filter and reset invalid state
function renderHomeTopicFilter(data){
  const wrap = $('home-topic-filter');
  if(!wrap)return;
  const choices = homeTopicChoices(data);
  if(choices.length <= 1){
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  if(!choices.some(choice=>choice.key === homeTopicFilter))homeTopicFilter = 'all';
  wrap.hidden = false;
  wrap.innerHTML = choices.map(choice=>`
    <button type="button" class="topic-filter ${choice.key === homeTopicFilter ? 'on' : ''}" data-home-topic="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>
  `).join('');
}

// RENDER: toggle sort and search buttons
function updateSortButton(){
  const data = load();
  const count = data.length;
  const hasSearchableArchive = data.some(h=>h.type === 'task' && h.lastLog !== null);
  $('open-overview').classList.toggle('is-hidden',count < 1);
  $('open-overview').disabled = count < 1;
  $('open-search').classList.toggle('is-hidden',count < 10 && !hasSearchableArchive);
  $('open-search').disabled = count < 10 && !hasSearchableArchive;
  const barOverview = $('bar-open-overview');
  if (barOverview) {
    barOverview.classList.toggle('is-hidden',count < 1);
    barOverview.disabled = count < 1;
  }
  const barSearch = $('bar-open-search');
  if (barSearch) {
    barSearch.classList.toggle('is-hidden',count < 10 && !hasSearchableArchive);
    barSearch.disabled = count < 10 && !hasSearchableArchive;
  }
  const todayBtn = $('open-today');
  if (todayBtn){
    todayBtn.classList.toggle('is-hidden',count < 1);
    todayBtn.disabled = count < 1;
  }
  const barToday = $('bar-open-today');
  if (barToday){
    barToday.classList.toggle('is-hidden',count < 1);
    barToday.disabled = count < 1;
  }
  if(count < 10 && !hasSearchableArchive)closeSearch({render:false});
}

// RENDER: sync search bar to query state
function updateSearchUi(){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  const searchBtn = $('open-search');
  const barSearchBtn = $('bar-open-search');
  const clearBtn = $('clear-search');
  if(!input || (!nav && !barSearchBtn))return;
  const wide = paneTierActive();
  const open = wide
    ? !!($('app-bar-search') && $('app-bar-search').classList.contains('is-open'))
    : !!nav?.classList.contains('search-open');
  input.value = searchQuery;
  document.body.classList.toggle('search-active',open);
  if (searchBtn) {
    searchBtn.classList.toggle('is-on',open);
    searchBtn.setAttribute('aria-pressed',String(open));
  }
  if (barSearchBtn) {
    barSearchBtn.classList.toggle('is-on',open);
    barSearchBtn.setAttribute('aria-pressed',String(open));
  }
  const navSearchWrap = $('nav-search');
  if (navSearchWrap) navSearchWrap.setAttribute('aria-hidden',String(!open));
  const barSearchWrap = $('app-bar-search');
  if (barSearchWrap) {
    barSearchWrap.setAttribute('aria-hidden',String(!open));
    barSearchWrap.classList.toggle('is-open',open);
  }
  if(clearBtn){
    const empty = !searchQuery.trim();
    if (navSearchWrap) navSearchWrap.classList.toggle('is-empty',empty);
    clearBtn.hidden = true;
  }
}

// HYBRID: open/close search, focus, render
function setSearchOpen(open,options = {}){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  if(!input)return;
  const wide = paneTierActive();
  if(options.clear)searchQuery = '';
  if (wide) {
    const barSearch = $('app-bar-search');
    if (barSearch) barSearch.classList.toggle('is-open',open);
    if (nav) nav.classList.remove('search-open');
  } else {
    if (nav) nav.classList.toggle('search-open',open);
    const barSearch = $('app-bar-search');
    if (barSearch) barSearch.classList.remove('is-open');
  }
  updateSearchUi();
  if(open && options.focus !== false){
    input.focus({preventScroll:true});
    updateKeyboardLift();
    keepFocusedInputVisible();
    requestAnimationFrame(()=>{
      if(document.activeElement !== input)input.focus({preventScroll:true});
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

// HYBRID: close and clear search UI
function closeSearch(options = {}){
  const nav = document.querySelector('.bottom-nav');
  const active = Boolean(searchQuery.trim()) || Boolean(nav?.classList.contains('search-open'));
  setSearchOpen(false,{
    clear:options.clear !== false,
    focus:false,
    render:options.render ?? active
  });
}

// PURE: decide if tap dismisses search
function shouldDismissSearchFromTap(target){
  const nav = document.querySelector('.bottom-nav');
  const barSearch = $('app-bar-search');
  const wide = paneTierActive();
  const searchOpen = wide
    ? !!barSearch?.classList.contains('is-open')
    : !!nav?.classList.contains('search-open');
  if(!target?.closest)return false;
  if(!searchOpen)return false;
  if(target.closest('#habit-search'))return false;
  if(target.closest('.bottom-nav'))return target.closest('#open-search');
  if(target.closest('.app-bar'))return target.closest('#bar-open-search');
  if(target.closest('.sheet-wrap.open'))return false;
  if(searchQuery.trim() && target.closest('.swipe-row,.ting-card,.swipe-actions'))return false;
  return true;
}

// PURE: get next planned log entry
function nextPlannedLog(h){
  return plannedLogs(h.logs)[0] || null;
}

// PURE: compute next-eligible label text
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

// PURE: compute short next-eligible label
function nextEligibleShort(h){
  if(!hasDaySchedule(h))return '';
  const distance = nextEligibleDistance(h);
  if(distance === null)return '-';
  if(distance === 0)return '';
  return `${distance}d`;
}

// PURE: compute compact plan day label
function compactPlanLabel(ts){
  const days = calendarDayDiff(ts);
  if(days === null)return '';
  if(days <= 0)return '';
  return `${days}d`;
}

// PURE: compact task due label for card pill
function compactDueLabel(ts,hardDue){
  const left = daysUntil(ts);
  if(left === null)return '';
  if(left < 0)return `${Math.abs(left)}d${hardDue ? '!' : ''}`;
  if(left === 0)return 'today';
  if(left === 1)return 'tmrw';
  if(left <= 7)return `${left}d`;
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// PURE: compact scheduled time label for card pill / strip
function compactScheduledLabel(ts){
  const left = daysUntil(ts);
  if(left === null)return '';
  if(left < 0)return 'past';
  const time = new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  if(left === 0)return time;
  if(left === 1)return 'tmrw';
  if(left <= 6)return new Date(ts).toLocaleDateString(undefined,{weekday:'short'});
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// PURE: keep cue pills narrow; full text remains in title/tooltips.
function compactPillText(value,max = 10){
  const text = String(value || '').trim();
  if(text.length <= max)return text;
  return `${text.slice(0,Math.max(1,max - 1))}…`;
}

// PURE: compute keep-up cue text
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

// PURE: compute reduce cue text
function limitCue(h,days,target){
  if(days === null)return 'No entries yet';
  if(days < 0)return 'Planned ahead';
  const remaining = target - days;
  if(remaining > 1)return `Wait ${remaining} days`;
  if(remaining === 1)return 'Wait 1 more day';
  if(remaining === 0)return 'Okay today';
  return 'Enough space';
}

// PURE: compute card status cue text
function cardCue(h){
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  const plan = nextPlannedLog(h);
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'Snoozed for now';
  if(h.type === 'task')return taskCue(h);
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

// PURE: task status cue
function taskCue(h){
  if(h.lastLog !== null)return 'Done';
  if(h.eventTime !== null){
    if(typeof scheduledWhenLabel === 'function')return capitalizeFirst(scheduledWhenLabel(h.eventTime));
    return 'Scheduled';
  }
  if(h.dueDate === null)return 'Someday';
  const left = daysUntil(h.dueDate);
  if(left === null)return 'Due';
  if(left < 0)return h.hardDue ? `${Math.abs(left)}d past deadline` : `${Math.abs(left)}d overdue`;
  if(left === 0)return 'Due today';
  if(left === 1)return 'Due tomorrow';
  if(left <= 7)return `Due in ${left}d`;
  return `Due ${new Date(h.dueDate).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}

// PURE: scheduled-task status cue
function scheduledCue(h){
  if(!h.eventTime)return 'Scheduled';
  if(typeof scheduledWhenLabel === 'function')return capitalizeFirst(scheduledWhenLabel(h.eventTime));
  return 'Scheduled';
}

// PURE: capitalize the first letter of a string
function capitalizeFirst(s){
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// PURE: compute card tone class
function cardTone(h){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'quiet';
  if(hasPlannedToday(h) && h.type !== 'zero')return 'plan';
  return scoreTone(progressScore(h));
}

// PURE: build card meta pills markup
function cardMeta(h,options = {}){
  const plan = nextPlannedLog(h);
  const parts = [];
  if(h.sample && (options.forceSample || sortSettings.showSampleOnCards))parts.push('<span class="context-pill quiet" title="sample habit"><i class="ti ti-test-pipe" aria-hidden="true"></i>sample</span>');
  if(h.pinned && (options.forcePinned || sortSettings.showPinnedOnCards))parts.push('<span class="context-pill pin" title="pinned"><i class="ti ti-pin" aria-hidden="true"></i></span>');
  if(h.type === 'task' && (options.forceTaskDate || sortSettings.showTaskDateOnCards)){
    if(h.eventTime !== null){
      parts.push(`<span class="context-pill scheduled" title="${escapeHtml(entryWhen(h.eventTime))}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(compactScheduledLabel(h.eventTime))}</span>`);
    }else if(h.dueDate === null){
      parts.push('<span class="context-pill due icon-only" title="no due date"><i class="ti ti-flag" aria-hidden="true"></i></span>');
    }else{
      parts.push(`<span class="context-pill due ${h.hardDue ? 'hard' : ''}" title="${escapeHtml(`due ${entryWhen(h.dueDate)}`)}"><i class="ti ti-flag" aria-hidden="true"></i>${escapeHtml(compactDueLabel(h.dueDate,h.hardDue))}</span>`);
    }
  }
  else if(options.forceRepetition || sortSettings.showRepetitionOnCards){
    if(h.type !== 'zero')parts.push(`<span class="context-pill" title="target rhythm"><i class="ti ti-repeat" aria-hidden="true"></i>${h.target || 7}d</span>`);
    else parts.push('<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>');
  }
  if((options.forceDuration || sortSettings.showDurationOnCards) && h.durationMinutes)parts.push(`<span class="context-pill" title="duration"><i class="ti ti-clock" aria-hidden="true"></i>${h.durationMinutes}m</span>`);
  if((options.forceFlexibility || sortSettings.showFlexibilityOnCards) && h.flexibilityDays)parts.push(`<span class="context-pill" title="flexibility"><i class="ti ti-arrows-left-right" aria-hidden="true"></i>±${h.flexibilityDays}d</span>`);
  if(hasDaySchedule(h) && (options.forceDaySchedule || sortSettings.showDayScheduleOnCards)){
    const eligible = nextEligibleShort(h);
    const title = [scheduleSummary(h),nextEligibleCopy(h)].filter(Boolean).join(' · ');
    const prefClass = hasPreferredDays(h) ? ' has-preferred' : '';
    parts.push(`<span class="context-pill schedule${prefClass} ${eligible ? '' : 'icon-only'}" title="${escapeHtml(title)}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(eligible)}</span>`);
  }
  if(hasTimeWindow(h) && (options.forceTimeWindow || sortSettings.showTimeWindowOnCards)){
    parts.push(`<span class="context-pill time" title="time window"><i class="ti ti-clock-hour-4" aria-hidden="true"></i>${escapeHtml(timeWindowSummary(h))}</span>`);
  }
  const topics = normalizeTopics(h.topics);
  if(options.forceTopics || sortSettings.showTopicsOnCards){
    topics.slice(0,2).forEach(topic=>{
      parts.push(`<span class="context-pill quiet" title="${escapeHtml(`topic: ${topic}`)}"><i class="ti ti-tag" aria-hidden="true"></i>${escapeHtml(compactPillText(topic,10))}</span>`);
    });
    if(topics.length > 2)parts.push(`<span class="context-pill quiet" title="more topics">+${topics.length - 2}</span>`);
  }
  if(plan && h.type !== 'zero' && (options.forcePlans || sortSettings.showPlansOnCards)){
    const label = compactPlanLabel(plan);
    parts.push(`<span class="context-pill plan ${label ? '' : 'icon-only'}" title="${escapeHtml(`planned ${entryWhen(plan)}`)}"><i class="ti ti-calendar-event" aria-hidden="true"></i>${escapeHtml(label)}</span>`);
  }
  if(h.snoozedUntil && Date.now() < h.snoozedUntil && (options.forceSnoozedUntil || sortSettings.showSnoozedUntilOnCards)){
    parts.push(`<span class="context-pill quiet" title="${escapeHtml(`snoozed until ${entryWhen(h.snoozedUntil)}`)}"><i class="ti ti-moon" aria-hidden="true"></i>${escapeHtml(entryWhen(h.snoozedUntil))}</span>`);
  }
  return parts.join('');
}

// PURE: build card trail dots markup
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

// PURE: reduce trail tones to one
function summarizeTrailTone(tones){
  if(!tones.length)return '';
  if(tones.includes('plan'))return 'plan';
  if(tones.includes('miss'))return 'miss';
  if(tones.includes('warn'))return 'warn';
  if(tones.includes('hit'))return 'hit';
  return '';
}

// RENDER: render the full habit list
function render(){
  const data = load();
  const list = $('list');
  const empty = $('empty');
  list.innerHTML = '';
  empty.onclick = null;
  updateQuotaBar(sizeKb(data));
  updateSortButton();
  updateSearchUi();
  renderHomeTopicFilter(data);

  const visible = visibleIndices(data);
  const indices = filteredVisibleIndices(data);
  if(!indices.length){
    empty.style.display = 'block';
    const hasSearch = searchQuery.trim().length > 0;
    const hasTopicFilter = homeTopicFilter && homeTopicFilter !== 'all';
    empty.classList.toggle('is-action',data.length > 0 && !sortSettings.showSnoozed && !hasSearch);
    if(hasSearch){
      empty.innerHTML = 'no matches<br><span class="empty-sub">try another habit name or icon</span>';
    }else if(hasTopicFilter){
      const label = homeTopicFilter === '__none__' ? 'no topic' : homeTopicFilter;
      empty.innerHTML = `no habits in ${escapeHtml(label)}<br><span class="empty-sub">tap a topic above to change the filter</span>`;
      empty.onclick = ()=>{
        homeTopicFilter = 'all';
        render();
      };
    }else if(data.length && !sortSettings.showSnoozed && !visible.length && data.some(h=>h.snoozedUntil && Date.now() < h.snoozedUntil)){
      empty.innerHTML = 'hidden for now<br><span class="empty-sub">tap to show</span>';
      empty.onclick = ()=>{
        saveSortSettings({...sortSettings,showSnoozed:true});
        syncSettingsControls();
        render();
      };
    }else if(data.length && !visible.length){
      const doneTasks = data.filter(h=>h.type === 'task' && h.lastLog !== null).length;
      empty.innerHTML = doneTasks && doneTasks === data.length
        ? 'all clear<br><span class="empty-sub">completed tasks stay searchable; use + to add what is next</span>'
        : 'nothing active<br><span class="empty-sub">use Today or Calendar for scheduled items, or + to add a habit</span>';
    }else{
      empty.innerHTML = 'simple habit tracking<br><span class="empty-sub">Saved on this device. Tap Habits for help and settings, or + to add your first habit.</span>';
    }
    return;
  }
  empty.classList.remove('is-action');
  empty.style.display = 'none';

  const todayFirstActive = sortSettings.preset === 'todayFirst';
  let sectionCat = -1;

  indices.forEach(realIdx=>{
    const h = data[realIdx];
    const cat = todayFirstActive ? todayCategory(h,sortSettings) : -1;

    if(todayFirstActive && !h.pinned && cat !== sectionCat){
      const labels = {0:'today',1:'overdue',2:'upcoming',3:'others'};
      const label = labels[cat];
      if(label){
        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = label;
        list.appendChild(header);
      }
      sectionCat = cat;
    }

    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const cardScore = progressScore(h);
    const cardScoreTone = cardTone(h);
    const cue = cardCue(h);
    const context = cardMeta(h);
    const trail = cardTrail(h);
    const accent = visualClassColor(cardScoreTone);
    const isDoneTask = h.type === 'task' && h.lastLog !== null;
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
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}${isDoneTask?' is-done':''}" data-real="${realIdx}" style="--card-accent:${accent};">
        <button class="pulse-btn ${h.emoji ? 'emoji-pulse' : ''}" data-pulse="${realIdx}" aria-label="add entry for ${escapeHtml(h.name)}" style="background:${c.bg};color:${c.icon};">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info">
          <div class="ting-main">
            <span class="ting-name">${escapeHtml(h.name)}</span>
            <div class="mini-score-ring ${cardScoreTone}" style="--score:${cardScore ?? 0};--score-color:${accent};" title="${escapeHtml(cue)}" aria-hidden="true"></div>
          </div>
          <div class="ting-cue">${escapeHtml(cue)}</div>
          <div class="ting-meta" aria-label="rhythm and plan">${context}</div>
          <div class="ting-visual" aria-hidden="true">
            <div class="ting-trail">${trail}</div>
          </div>
        </div>
        <div class="card-actions" aria-label="habit actions">
          <button class="card-action-btn" data-action="activity" aria-label="activity" title="activity"><i class="ti ti-history" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="snooze" aria-label="snooze" title="snooze"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="nuke" aria-label="remove" title="remove"><i class="ti ti-trash" aria-hidden="true"></i></button>
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
  list.querySelectorAll('.card-action-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
    });
  });
}

// WIRE: attach swipe gesture listeners
function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const leftActions = row.querySelector('.swipe-actions-left');
  const rightActions = row.querySelector('.swipe-actions-right');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;
  let startedOpen = false;

  // PURE: measure total swipe action width
  function revealWidth(actions){
    return actions.querySelectorAll('.swipe-action').length * SWIPE_ACTION_WIDTH;
  }

  // HYBRID: reset swipe DOM and clear state
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

// HYBRID: close all open swipe rows
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

// WIRE: attach card tap and pointer listeners
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

// HANDLER: distinguish tap vs double-tap
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

// HYBRID: log entry and show undo
function logTing(i){
  const data = load();
  const now = Date.now();
  if(!data[i])return false;
  const undo = {type:'entry',idx:i,ts:now,snoozedUntil:data[i].snoozedUntil || null};
  data[i].lastLog = now;
  data[i].logs = normalizeLogs([...(data[i].logs || []),now]);
  data[i].snoozedUntil = null;
  if(!save(data))return false;
  // Cancel any scheduled push for this completed task.
  if(typeof cancelPush === 'function' && data[i].type === 'task'){
    cancelPush(reminderSignature(data[i]));
  }
  showUndo('Entry logged',undo);
  return true;
}

// HYBRID: log entry at timestamp, show undo
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

// HANDLER: splice entry from habit logs
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

// HYBRID: move all of a habit's planned entries on fromKey to toKey (preserving
// each entry's time of day), single save + single undo. The compound undo
// reverts both halves so the existing toast covers the whole move cleanly.
function movePlanTo(idx,fromKey,toKey){
  const data = load();
  const h = data[idx];
  if(!h || fromKey === toKey)return;
  const logs = normalizeLogs(h.logs);
  const moved = [];
  const newDay = new Date(`${toKey}T00:00:00`);
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === fromKey){
      const old = new Date(logTime(log));
      const nt = new Date(newDay.getFullYear(),newDay.getMonth(),newDay.getDate(),old.getHours(),old.getMinutes(),0,0).getTime();
      moved.push({oldTs:logTime(log),newTs:nt});
      return false;
    }
    return true;
  });
  if(!moved.length)return;
  moved.forEach(m=>remaining.push({ts:m.newTs,plan:true}));
  data[idx].logs = normalizeLogs(remaining);
  data[idx].lastLog = latestActualLog(data[idx].logs);
  if(save(data)){
    showUndo('Plan moved',{type:'move',idx,moved});
    refreshOpenViews();
  }
}

// HYBRID: revert last action and refresh
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
  if(pendingUndo.type === 'move'){
    const {idx,moved} = pendingUndo;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      const newSet = new Set(moved.map(m=>m.newTs));
      const filtered = logs.filter(log=>!newSet.has(logTime(log)));
      moved.forEach(m=>filtered.push({ts:m.oldTs,plan:true}));
      data[idx].logs = normalizeLogs(filtered);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(save(data)){
    hideUndo();
    showToast('undone');
    refreshOpenViews();
  }
}

// HYBRID: log entry and flash card
function quickLog(i,card){
  if(!logTing(i))return;
  if(card){
    card.classList.add('logged');
    setTimeout(()=>card.classList.remove('logged'),380);
  }
  setTimeout(refreshOpenViews, 260);
}

// PURE: compute next plan timestamp
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

// PURE: format next plan date label
function nextPlanLabel(h){
  return new Date(nextPlanTime(h)).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// HYBRID: schedule next plan entry
function planNext(i){
  const h = load()[i];
  if(!h || h.type === 'zero')return;
  const ts = nextPlanTime(h);
  if(logTingAt(i,ts))refreshOpenViews();
}

// HYBRID: toggle pin and re-render
function togglePin(i){
  const data = load();
  if(!data[i])return;
  data[i].pinned = !data[i].pinned;
  if(save(data)){
    showToast(data[i].pinned ? 'pinned' : 'unpinned');
    render();
  }
}
