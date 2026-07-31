// Habit detail sheet, per-habit calendar, stats, graph, and schedule editor.
//
// This file renders the habit detail sheet: the per-habit calendar (the
// default first pane for habits — tasks default to the schedule pane
// instead, see openDetail()), the score ring, stats, the gap graph, and the
// schedule editor (weekday / monthday / time-window). Functions are tagged
// by role to guide the React Native port:
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
  $('detail-head-card').style.setProperty('--card-priority',priorityColor(effectivePriority(h)));
  $('detail-about').textContent = aboutText(h);
  $('detail-trend').textContent = trendText(h);
  $('detail-habit-message').value = h.name || '';
  $('detail-emoji').value = h.emoji || '';
  renderEmojiBgSwatches('detail-emoji-bg',h.emojiBgColor || '');
  $('detail-days').value = h.target || '';
  if($('detail-times'))$('detail-times').value = rhythmParts(h.target || 7).times;
  $('detail-pinned').setAttribute('aria-pressed',h.pinned ? 'true' : 'false');
  $('detail-duration').value = h.durationMinutes || DEFAULT_DURATION_MINUTES;
  $('detail-flexibility').value = h.flexibilityDays || 0;
  if($('detail-breakable'))$('detail-breakable').setAttribute('aria-pressed',h.breakable ? 'true' : 'false');
  if($('detail-min-chunk'))$('detail-min-chunk').value = h.minChunkMinutes || DEFAULT_MIN_CHUNK_MINUTES;
  if($('detail-track-value'))$('detail-track-value').setAttribute('aria-pressed',h.trackValue ? 'true' : 'false');
  if($('detail-timer-auto-stop'))$('detail-timer-auto-stop').value = h.timerAutoStopMinutes != null ? h.timerAutoStopMinutes : '';
  if($('detail-auto-mark'))$('detail-auto-mark').value = h.autoMarkMinutes != null ? h.autoMarkMinutes : '';
  renderTagChips('detail-tag-chips',h.topics,h.locationIds,h.preferredLocationId,h.locationPrefs,h.anywhereAllowed);
  renderScheduleChips('detail',h);
  renderScheduleLinkEditors(h);
  renderTimeWindowInputs(h);
  $('detail-due-date').value = dateInputValue(h.dueDate);
  if($('detail-due-time'))$('detail-due-time').value = h.eventTime !== null ? timeInputValue(h.eventTime) : '';
  if($('detail-plan-by-date'))$('detail-plan-by-date').value = dateInputValue(h.planByDate);
  syncDetailDueUi();
  syncDetailPlanByUi();
  setScheduleView('allowed');
  $('detail-delete-confirm').hidden = true;
  setDetailTypeUi(h.type);
  setDetailPriorityUi(effectivePriority(h));
  detailTuneOriginal = {
    hid:h.hid,
    name:h.name || '',
    type:h.type || 'keepup',
    emoji:h.emoji || '',
    emojiBgColor:normalizeEmojiBgColor(h.emojiBgColor),
    target:h.target || '',
    pinned:Boolean(h.pinned),
    topics:normalizeTopics(h.topics),
    locationIds:normalizeLocationIds(h.locationIds),
    anywhereAllowed:Boolean(h.anywhereAllowed),
    locationPrefs:normalizeLocationPrefs(h.locationPrefs,h.locationIds,h.preferredLocationId),
    preferredLocationId:h.preferredLocationId || null,
    allowedWeekdays:normalizeAllowedWeekdays(h.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(h.allowedMonthDays),
    preferredWeekdays:normalizeAllowedWeekdays(h.preferredWeekdays),
    preferredMonthDays:normalizeAllowedMonthDays(h.preferredMonthDays),
    allowedTimeStart:h.allowedTimeStart ?? null,
    allowedTimeEnd:h.allowedTimeEnd ?? null,
    preferredTimeStart:h.preferredTimeStart ?? null,
    preferredTimeEnd:h.preferredTimeEnd ?? null,
    allowedTimeStartAnchor:cleanAnchor(h.allowedTimeStartAnchor),
    allowedTimeStartOffsetMin:normalizePrayerOffset(h.allowedTimeStartOffsetMin),
    allowedTimeEndAnchor:cleanAnchor(h.allowedTimeEndAnchor),
    allowedTimeEndOffsetMin:normalizePrayerOffset(h.allowedTimeEndOffsetMin),
    preferredTimeStartAnchor:cleanAnchor(h.preferredTimeStartAnchor),
    preferredTimeStartOffsetMin:normalizePrayerOffset(h.preferredTimeStartOffsetMin),
    preferredTimeEndAnchor:cleanAnchor(h.preferredTimeEndAnchor),
    preferredTimeEndOffsetMin:normalizePrayerOffset(h.preferredTimeEndOffsetMin),
    allowedTimeStartAnchorHabitId:cleanHabitId(h.allowedTimeStartAnchorHabitId) || null,
    allowedTimeEndAnchorHabitId:cleanHabitId(h.allowedTimeEndAnchorHabitId) || null,
    preferredTimeStartAnchorHabitId:cleanHabitId(h.preferredTimeStartAnchorHabitId) || null,
    preferredTimeEndAnchorHabitId:cleanHabitId(h.preferredTimeEndAnchorHabitId) || null,
    scheduleLinks:normalizeScheduleLinks(h.scheduleLinks,h.hid),
    ...snapshotCombineFields(h, 'allowedTimeStart'),
    ...snapshotCombineFields(h, 'allowedTimeEnd'),
    ...snapshotCombineFields(h, 'preferredTimeStart'),
    ...snapshotCombineFields(h, 'preferredTimeEnd'),
    durationMinutes:h.durationMinutes || DEFAULT_DURATION_MINUTES,
    breakable:Boolean(h.breakable),
    minChunkMinutes:h.minChunkMinutes || DEFAULT_MIN_CHUNK_MINUTES,
    timerAutoStopMinutes:h.timerAutoStopMinutes ?? null,
    autoMarkMinutes:h.autoMarkMinutes ?? null,
    trackValue:Boolean(h.trackValue),
    flexibilityDays:h.flexibilityDays || 0,
    priority:effectivePriority(h),
    dueDate:h.dueDate ?? null,
    eventTime:h.eventTime ?? null,
    planByDate:h.planByDate ?? null
  };
  syncRhythm('detail',h.target || 7);
  syncBreakableUi();
  if(typeof syncDetailTimerUi === 'function')syncDetailTimerUi();
  $('detail-mark').style.cssText = '';
  const markStyle = typeof emojiBgInlineStyle === 'function'
    ? emojiBgInlineStyle(h,c.bg,c.icon)
    : `background:${c.bg};color:${c.icon}`;
  $('detail-mark').style.cssText = markStyle;
  $('detail-mark').classList.toggle('emoji-pulse',Boolean(h.emoji));
  $('detail-mark').classList.toggle('has-emoji-bg',Boolean(normalizeEmojiBgColor(h.emojiBgColor)));
  $('detail-mark').setAttribute('aria-label',`add entry for ${h.name}`);
  $('detail-mark').innerHTML = iconHtml(h,c);
  renderStats(h);
  renderGraph(h);
  renderCalendar(h);
  renderDetailOrderPage(h);
  setDetailDirty(false);
  openSheet('detail-sheet');
  if(changedHabit){
    const inner = getSheetInner('detail-sheet');
    const pager = inner?.querySelector('.detail-pager');
    if(inner)inner.scrollTop = 0;
    if(pager){
      pager.querySelectorAll('.detail-page').forEach(page=>{ page.scrollTop = 0; });
      // Order links → actions first so unlink is immediate.
      // Tasks otherwise land on Effort; habits on Calendar.
      const hasOrder = typeof habitHasOrderConstraints === 'function'
        && habitHasOrderConstraints(h.hid);
      requestAnimationFrame(()=>{
        if(hasOrder)scrollDetailToNav('actions','auto');
        else if(h.type === 'task')scrollDetailToNav('effort','auto');
        else{
          pager.scrollTo({left:0,behavior:'auto'});
          updateDetailPagerDots();
        }
      });
    }
  }
  renderDetailTabs();
  updateDetailPagerDots();
}

// HYBRID: opens detail then scrolls to calendar (now the default first pane —
// this is kept for callers that need to jump here even when the sheet is
// already open on a different pane for the same habit).
function openDetailCalendar(i){
  openDetail(i);
  requestAnimationFrame(()=>{
    const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
    if(!pager)return;
    pager.scrollTo({left:0,behavior:'auto'});
    updateDetailPagerDots();
  });
}

// HYBRID: opens detail then scrolls to schedule. For tasks the relevant
// controls (due / scheduled) live in the Effort pane, so route by type.
function openDetailSchedule(i){
  openDetail(i);
  requestAnimationFrame(()=>{
    const h = load()[i];
    scrollDetailToNav(h && h.type === 'task' ? 'effort' : 'schedule','auto');
  });
}

function selectedEmojiBgColor(containerId){
  const on = document.querySelector(`#${containerId} .emoji-bg-swatch.on`);
  return normalizeEmojiBgColor(on && on.dataset.emojiBg);
}

function renderEmojiBgSwatches(containerId,selected = ''){
  const wrap = $(containerId);
  if(!wrap)return;
  const tokens = typeof EMOJI_BG_COLOR_TOKENS !== 'undefined'
    ? EMOJI_BG_COLOR_TOKENS
    : ['teal','amber','red','purple','blue','green'];
  const current = normalizeEmojiBgColor(selected);
  const chips = [
    `<button type="button" class="emoji-bg-swatch none${current === '' ? ' on' : ''}" data-emoji-bg="" title="none" aria-label="no emoji background" aria-pressed="${current === '' ? 'true' : 'false'}"><i class="ti ti-slash" aria-hidden="true"></i></button>`,
    ...tokens.map(token=>{
      const on = current === token;
      return `<button type="button" class="emoji-bg-swatch${on ? ' on' : ''}" data-emoji-bg="${token}" title="${token}" aria-label="${token} background" aria-pressed="${on ? 'true' : 'false'}" style="--swatch-bg:var(--${token}-bg);--swatch-fg:var(--${token}-icon)"></button>`;
    })
  ];
  wrap.innerHTML = chips.join('');
  if(wrap.dataset.bound !== '1'){
    wrap.dataset.bound = '1';
    wrap.addEventListener('click',e=>{
      const btn = e.target.closest('.emoji-bg-swatch');
      if(!btn || !wrap.contains(btn))return;
      wrap.querySelectorAll('.emoji-bg-swatch').forEach(el=>{
        const active = el === btn;
        el.classList.toggle('on',active);
        el.setAttribute('aria-pressed',active ? 'true' : 'false');
      });
      if(containerId === 'detail-emoji-bg' && typeof setDetailDirty === 'function')setDetailDirty();
      if(containerId === 'detail-emoji-bg'){
        const mark = $('detail-mark');
        if(mark){
          const token = normalizeEmojiBgColor(btn.dataset.emojiBg);
          mark.classList.toggle('has-emoji-bg',Boolean(token));
          if(token){
            mark.style.background = `var(--${token}-bg)`;
            mark.style.color = `var(--${token}-icon)`;
            mark.style.setProperty('--emoji-bg',`var(--${token}-bg)`);
          }else if(detailIdx != null){
            const h = load()[detailIdx];
            if(h){
              const days = daysSince(h.lastLog);
              const c = colors(days,h.target,h.type);
              mark.style.background = c.bg;
              mark.style.color = c.icon;
              mark.style.removeProperty('--emoji-bg');
            }
          }
        }
      }
    });
  }
}

/** RENDER: recurring Schedule links + temporary reorder links on Actions. */
function renderDetailOrderPage(h = null){
  const block = $('detail-order-block');
  const list = $('detail-order-list');
  const clearBtn = $('detail-order-clear-all');
  if(!block || !list)return;
  const habit = h || (detailIdx != null ? load()[detailIdx] : null);
  if(!habit || !habit.hid || typeof orderConstraintsForHid !== 'function'){
    block.hidden = true;
    if(clearBtn)clearBtn.hidden = true;
    return;
  }
  const edges = orderConstraintsForHid(habit.hid);
  const persistentLinks = normalizeScheduleLinks(habit.scheduleLinks,habit.hid);
  const recurring = ['after','before'].filter(direction=>persistentLinks[direction]);
  block.hidden = edges.length === 0 && recurring.length === 0;
  if(clearBtn){
    clearBtn.hidden = edges.length === 0;
    clearBtn.dataset.orderClearHid = habit.hid;
  }
  if(!edges.length && !recurring.length){
    list.innerHTML = '';
    return;
  }
  const data = load();
  const recurringHtml = recurring.map(direction=>{
    const link = persistentLinks[direction];
    const other = data.find(item=>item && item.hid === link.anchorHid);
    const label = `${link.adjacency === 'direct' ? 'right ' : ''}${direction} ${other && other.name || 'missing habit'}`;
    const mark = other ? orderMarkChipHtml({
      kind:direction,
      adjacency:link.adjacency,
      persistent:true,
      otherEmoji:other.emoji || '',
      otherBg:other.emojiBgColor || '',
      otherName:other.name || 'habit'
    }) : '';
    return `<div class="detail-order-row">
      ${mark}
        <span class="detail-order-meta">recurring · ${escapeHtml(label)}${link.requireSameDay ? ` · only on days with ${escapeHtml(other && other.name || 'the other habit')}` : ''}</span>
      <span class="detail-order-edit-note">Schedule</span>
    </div>`;
  }).join('');
  const byDay = new Map();
  for(const edge of edges){
    if(!byDay.has(edge.dayBase))byDay.set(edge.dayBase,[]);
    byDay.get(edge.dayBase).push(edge);
  }
  const dayBases = [...byDay.keys()].sort((a,b)=>a - b);
  list.innerHTML = recurringHtml + dayBases.map(dayBase=>{
    const dayLabel = typeof formatOrderDayLabel === 'function'
      ? formatOrderDayLabel(dayBase)
      : new Date(dayBase).toLocaleDateString();
    return byDay.get(dayBase).map(edge=>{
      const isAfter = edge.afterHid === habit.hid;
      const otherHid = isAfter ? edge.beforeHid : edge.afterHid;
      const other = data.find(item=>item && item.hid === otherHid);
      const adj = edge.adjacency === 'direct' ? 'next' : 'later';
      const mark = other
        ? orderMarkChipHtml({
          kind:isAfter ? 'after' : 'before',
          adjacency:edge.adjacency,
          otherEmoji:other.emoji || '',
          otherBg:other.emojiBgColor || '',
          otherName:other.name || 'task'
        })
        : `<span class="order-mark"><i class="ti ${isAfter ? 'ti-arrow-up' : 'ti-arrow-down'}" aria-hidden="true"></i><span class="order-mark-emoji is-empty">·</span></span>`;
      return `<div class="detail-order-row">
        ${mark}
        <span class="detail-order-meta">${escapeHtml(dayLabel)} · ${adj}</span>
        <button type="button" class="mini-text-btn detail-order-unlink" data-order-unlink="${escapeHtml(edge.id)}">unlink</button>
      </div>`;
    }).join('');
  }).join('');
}

// PURE: builds header subtitle from habit state
function detailHeaderLine(h){
  if(h.type === 'task'){
    const parts = [];
    if(h.eventTime !== null)parts.push(scheduledWhenLabel(h.eventTime));
    else parts.push(cardCue(h));
    if(h.durationMinutes)parts.push(`${h.durationMinutes}m`);
    if(hasDaySchedule(h)){
      const next = nextEligibleShort(h);
      if(next)parts.push(next);
    }
    return parts.filter(Boolean).join(' · ');
  }
  const parts = [cardCue(h)];
  if(h.durationMinutes)parts.push(`${h.durationMinutes}m`);
  if(hasDaySchedule(h)){
    const next = nextEligibleShort(h);
    if(next)parts.push(next);
  }
  if(hasTimeWindow(h))parts.push(timeWindowSummary(h));
  return parts.filter(Boolean).join(' · ');
}

// PURE: format a scheduled time as a friendly label
function scheduledWhenLabel(ts){
  const left = daysUntil(ts);
  const time = new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  if(left === null)return '';
  if(left < 0)return `ended ${entryWhen(ts)}`;
  if(left === 0)return `today ${time}`;
  if(left === 1)return `tomorrow ${time}`;
  if(left <= 6)return `${new Date(ts).toLocaleDateString(undefined,{weekday:'short'})} ${time}`;
  return `${new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${time}`;
}

// RENDER: fills allowed/preferred time window input fields
//
// Each of the four endpoints (allowed start/end, preferred start/end) is a
// per-endpoint editor that swaps between two modes:
//   • fixed  → a single <input type="time"> (the legacy behaviour)
//   • dynamic → a <select> of prayer anchors + signed-minute offset + live
//              preview of the resolved clock time
// The gear button toggles modes; the underlying time-endpoint element holds
// both controls and shows the one that matches the habit's current state.
function renderTimeWindowInputs(h = {}){
  populateAnchorOptions();
  renderTimeEndpoint($('detail-time-start').closest('.time-endpoint'), 'allowedTimeStart', h);
  renderTimeEndpoint($('detail-time-end').closest('.time-endpoint'), 'allowedTimeEnd', h);
  renderTimeEndpoint($('detail-preferred-time-start').closest('.time-endpoint'), 'preferredTimeStart', h);
  renderTimeEndpoint($('detail-preferred-time-end').closest('.time-endpoint'), 'preferredTimeEnd', h);
  syncTimeClearBtn();
}

function scheduleLinkHabitOptions(subjectHid,selectedHid){
  const items = typeof load === 'function' ? load() : [];
  const options = ['<option value="">— no anchor —</option>'];
  for(const item of items){
    if(!item || cleanHabitId(item.hid) === cleanHabitId(subjectHid) || item.type === 'zero')continue;
    const hid = cleanHabitId(item.hid);
    options.push(`<option value="${escapeHtml(hid)}"${hid === selectedHid ? ' selected' : ''}>${escapeHtml((item.name || 'untitled').slice(0,60))}</option>`);
  }
  return options.join('');
}

function renderScheduleLinkEditor(editor,direction,h){
  if(!editor)return;
  const links = normalizeScheduleLinks(h && h.scheduleLinks,h && h.hid);
  const link = links[direction];
  const picker = editor.querySelector('.schedule-link-habit');
  const adj = editor.querySelector('.schedule-link-adjacency');
  const sameDay = editor.querySelector('.schedule-link-same-day');
  const sameDayRow = editor.querySelector('.schedule-link-same-day-row');
  const clear = editor.querySelector('.schedule-link-clear');
  const anchorHid = link ? link.anchorHid : '';
  if(picker)picker.innerHTML = scheduleLinkHabitOptions(h && h.hid,anchorHid);
  if(adj){
    adj.hidden = !link;
    adj.querySelectorAll('[data-adjacency]').forEach(btn=>{
      btn.classList.toggle('on',btn.dataset.adjacency === (link ? link.adjacency : 'sometime'));
    });
  }
  if(sameDay){
    if(sameDayRow)sameDayRow.hidden = !link;
    const isRequired = Boolean(link && link.requireSameDay);
    sameDay.setAttribute('aria-pressed',isRequired ? 'true' : 'false');
    if(sameDayRow)sameDayRow.classList.toggle('is-on',isRequired);
    const anchor = (typeof load === 'function' ? load() : []).find(item=>item && item.hid === anchorHid);
    const title = sameDayRow && sameDayRow.querySelector('.setting-title');
    const help = sameDayRow && sameDayRow.querySelector('.schedule-link-same-day-help');
    const anchorName = anchor && anchor.name || 'the other habit';
    if(title)title.textContent = `Only on days with ${anchorName}`;
    if(help)help.textContent = `When on, this habit is planned only if ${anchorName} is also planned or already completed that day.`;
    sameDay.setAttribute('aria-label',`Only on days with ${anchorName}: ${isRequired ? 'on' : 'off'}`);
  }
  if(clear)clear.hidden = !link;
}

function renderScheduleLinkEditors(h = {}){
  document.querySelectorAll('#detail-schedule-order .schedule-link-editor').forEach(editor=>{
    renderScheduleLinkEditor(editor,editor.dataset.scheduleLink,h);
  });
}

function readScheduleLinksFromDetail(subjectHid){
  const out = {before:null,after:null};
  document.querySelectorAll('#detail-schedule-order .schedule-link-editor').forEach(editor=>{
    const direction = editor.dataset.scheduleLink;
    const anchorHid = cleanHabitId(editor.querySelector('.schedule-link-habit')?.value);
    if(!anchorHid)return;
    const adjacency = editor.querySelector('[data-adjacency].on')?.dataset.adjacency === 'direct'
      ? 'direct' : 'sometime';
    out[direction] = normalizeScheduleLink({
      anchorHid,
      adjacency,
      requireSameDay:editor.querySelector('.schedule-link-same-day')?.getAttribute('aria-pressed') === 'true'
    },subjectHid);
  });
  return out;
}

// PURE: snapshot the later/earlier-of fields for one endpoint into the tune object.
function snapshotCombineFields(h, prefix){
  return {
    [prefix + 'Combine']:cleanTimeCombine(h && h[prefix + 'Combine']),
    [prefix + 'Anchor2']:cleanAnchor(h && h[prefix + 'Anchor2']),
    [prefix + 'OffsetMin2']:normalizePrayerOffset(h && h[prefix + 'OffsetMin2']),
    [prefix + 'AnchorHabitId2']:cleanHabitId(h && h[prefix + 'AnchorHabitId2']) || null,
    [prefix + 'FixedMin2']:normalizeTimeMinutes(h && h[prefix + 'FixedMin2']),
    [prefix + 'DayOffset']:normalizeAnchorDayOffset(h && h[prefix + 'DayOffset']),
    [prefix + 'DayOffset2']:normalizeAnchorDayOffset(h && h[prefix + 'DayOffset2'])
  };
}

// RENDER (idempotent): populate every anchor <select> with the standard list.
// Re-running on every openDetail is harmless — the options are stable. Primary
// gets prayers; secondary also gets a fixed clock option. Habit choices are
// now created in the dedicated recurring Habit order editor. A legacy option
// is injected only while rendering an older non-migratable expression.
function populateAnchorOptions(){
  const prayerOpts = PRAYER_ANCHORS.map(a => `<option value="${a}">${prayerDisplayName(a)}</option>`).join('');
  document.querySelectorAll('.time-endpoint .time-anchor').forEach(sel => {
    if(sel.dataset.populated === '1')return;
    sel.innerHTML = '<option value="">— anchor —</option>'
      + prayerOpts;
    sel.dataset.populated = '1';
  });
  document.querySelectorAll('.time-endpoint .time-anchor2').forEach(sel => {
    if(sel.dataset.populated === '1')return;
    sel.innerHTML = '<option value="">— anchor —</option>'
      + prayerOpts
      + '<option value="fixed">clock time…</option>';
    sel.dataset.populated = '1';
  });
}

function ensureLegacyHabitAnchorOption(select){
  if(!select || select.querySelector('option[value="habit"]'))return;
  const option = document.createElement('option');
  option.value = 'habit';
  option.textContent = 'after completion (legacy)…';
  const fixed = select.querySelector('option[value="fixed"]');
  select.insertBefore(option,fixed || null);
}

// RENDER: build/rebuild a habit-picker dropdown. `which` is '' (primary) or '2'.
// Excludes the current habit (can't anchor on yourself).
function populateHabitPickerFor(endpoint, field, h, which = ''){
  if(!endpoint)return;
  const picker = endpoint.querySelector(which === '2' ? '.time-habit2' : '.time-habit');
  if(!picker)return;
  const selected = cleanHabitId(h && h[field + 'AnchorHabitId' + which]) || '';
  const data = typeof load === 'function' ? load() : [];
  const currentHid = cleanHabitId(h && h.hid);
  const options = ['<option value="">— pick a habit —</option>']
    .concat(data.filter(x => x && cleanHabitId(x.hid) !== currentHid).map(x => {
      const hid = cleanHabitId(x.hid);
      const name = (x.name || 'untitled').slice(0,60);
      return `<option value="${escapeHtml(hid)}"${hid === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`;
    }));
  picker.innerHTML = options.join('');
}

// RENDER: sync habit-wrap + day-next (+ fixed clock for B) visibility for one expression row.
function syncExprControls(endpoint, field, h, which = ''){
  const suffix = which === '2' ? '2' : '';
  const anchor = cleanAnchor(h && h[field + 'Anchor' + suffix]);
  const isFixed = which === '2' && anchor === 'fixed';
  const habitWrap = endpoint.querySelector(which === '2' ? '.time-habit-wrap2' : '.time-habit-wrap');
  const dayBtn = endpoint.querySelector(which === '2' ? '.time-day-next2' : '.time-day-next');
  const expr = endpoint.querySelector(which === '2' ? '.time-expr2' : '.time-expr');
  const fixed2 = which === '2' ? endpoint.querySelector('.time-fixed2') : null;
  if(fixed2){
    fixed2.hidden = !isFixed;
    if(isFixed){
      const min = normalizeTimeMinutes(h && h[field + 'FixedMin2']);
      fixed2.value = minutesToTimeInput(min != null ? min : 1200);
    }
  }
  if(habitWrap){
    habitWrap.hidden = anchor !== 'habit';
    if(anchor === 'habit')populateHabitPickerFor(endpoint, field, h, which);
  }
  if(dayBtn){
    const on = normalizeAnchorDayOffset(h && h[field + 'DayOffset' + suffix]) === 1;
    dayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // +1d only applies to prayer anchors (habit logs are absolute; fixed has no day).
    dayBtn.hidden = !anchor || anchor === 'habit' || isFixed;
  }
  if(expr && which === '2'){
    expr.querySelectorAll('.time-offset2, .time-offset-sign-btn, .time-offset-unit').forEach(el => {
      el.hidden = isFixed;
    });
  }
}

// RENDER: sync a single time endpoint DOM block from the habit's stored state.
function renderTimeEndpoint(endpoint, field, h){
  if(!endpoint)return;
  const fixedInput = endpoint.querySelector('.time-fixed');
  const dynWrap = endpoint.querySelector('.time-dynamic');
  const anchorSel = endpoint.querySelector('.time-anchor');
  const offsetInput = endpoint.querySelector('.time-offset');
  const combineSel = endpoint.querySelector('.time-combine');
  const expr2 = endpoint.querySelector('.time-expr2');
  const anchor2Sel = endpoint.querySelector('.time-anchor2');
  const offset2Input = endpoint.querySelector('.time-offset2');
  const anchor = cleanAnchor(h && h[field + 'Anchor']);
  if(anchor){
    if(anchor === 'habit')ensureLegacyHabitAnchorOption(anchorSel);
    endpoint.classList.add('is-dynamic');
    if(fixedInput)fixedInput.hidden = true;
    if(dynWrap)dynWrap.hidden = false;
    if(anchorSel)anchorSel.value = anchor;
    if(offsetInput){
      const off = normalizePrayerOffset(h[field + 'OffsetMin']);
      offsetInput.value = Math.abs(off) || '';
      syncOffsetSign(offsetInput, off);
    }
    syncExprControls(endpoint, field, h, '');
    const combine = cleanTimeCombine(h && h[field + 'Combine']);
    if(combineSel)combineSel.value = combine || '';
    if(expr2)expr2.hidden = !combine;
    if(combine){
      if(cleanAnchor(h[field + 'Anchor2']) === 'habit')ensureLegacyHabitAnchorOption(anchor2Sel);
      if(anchor2Sel)anchor2Sel.value = cleanAnchor(h[field + 'Anchor2']) || '';
      if(offset2Input){
        const off2 = normalizePrayerOffset(h[field + 'OffsetMin2']);
        offset2Input.value = Math.abs(off2) || '';
        syncOffsetSign(offset2Input, off2);
      }
      syncExprControls(endpoint, field, h, '2');
    }
  }else{
    endpoint.classList.remove('is-dynamic');
    if(fixedInput){
      fixedInput.hidden = false;
      // Guard null/undefined explicitly — Number(null) returns 0, which would
      // otherwise render "00:00" in the input and silently write back a
      // midnight→midnight time window on the next save (hasTimeWindow treats
      // 0/0 as a valid 24h window). null must round-trip to an empty input.
      const raw = h[field];
      const num = raw != null ? Number(raw) : NaN;
      fixedInput.value = Number.isFinite(num) ? minutesToTimeInput(num) : '';
    }
    if(dynWrap)dynWrap.hidden = true;
    if(anchorSel)anchorSel.value = '';
    if(offsetInput)offsetInput.value = '';
    if(combineSel)combineSel.value = '';
    if(expr2)expr2.hidden = true;
  }
  updateTimeResolved(endpoint, field, h);
}

// RENDER: live preview of the resolved clock time for a dynamic endpoint.
// Falls back to a muted "—" when there's no location on the habit (the save
// path will block, but the preview explains why). For 'habit' anchors, shows
// contextual hints: "pick a habit", "never logged", "done · waiting".
function updateTimeResolved(endpoint, field, h){
  const node = endpoint && endpoint.querySelector('.time-resolved');
  if(!node)return;
  const anchor = cleanAnchor(h && h[field + 'Anchor']);
  if(!anchor){ node.textContent = ''; return; }
  if(anchor === 'habit'){
    const data = typeof load === 'function' ? load() : [];
    const anchorHabit = findHabitByHid(h && h[field + 'AnchorHabitId'], data);
    if(!anchorHabit){ node.textContent = 'pick a habit'; return; }
    const min = resolveHabitTimeField(h, field, dayStart(Date.now()));
    if(min == null){
      const role = field.endsWith('Start') ? 'start' : 'end';
      const anchorLast = anchorHabit.lastLog;
      const ownLast = h && h.lastLog;
      if(role === 'start' && ownLast != null && anchorLast != null && ownLast >= anchorLast){
        node.textContent = 'done · waiting';
      }else if(anchorLast == null){
        node.textContent = 'never logged';
      }else{
        node.textContent = '—';
      }
      return;
    }
    node.textContent = formatTimeShort(((min % 1440) + 1440) % 1440);
    return;
  }
  // Prayer anchor — needs a location.
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = habitPrayerLocation(h, settings);
  if(!loc){
    node.textContent = 'add a location';
    return;
  }
  const min = resolveHabitTimeField(h, field, dayStart(Date.now()));
  if(min == null){
    node.textContent = '—';
    return;
  }
  node.textContent = formatTimeShort(((min % 1440) + 1440) % 1440);
}
// RENDER: toggles time-clear button visibility. A clear is offered whenever
// any of the four endpoints has a value (fixed or dynamic).
function syncTimeClearBtn(){
  const allowedOn = endpointHasValue($('detail-time-start').closest('.time-endpoint'))
    || endpointHasValue($('detail-time-end').closest('.time-endpoint'));
  const prefOn = endpointHasValue($('detail-preferred-time-start').closest('.time-endpoint'))
    || endpointHasValue($('detail-preferred-time-end').closest('.time-endpoint'));
  const clear = $('detail-time-clear');
  if(clear)clear.hidden = !allowedOn;
  const prefClear = $('detail-preferred-time-clear');
  if(prefClear)prefClear.hidden = !prefOn;
}
function endpointHasValue(endpoint){
  if(!endpoint)return false;
  if(endpoint.classList.contains('is-dynamic'))return true;
  const fixed = endpoint.querySelector('.time-fixed');
  return Boolean(fixed && fixed.value);
}
// RENDER: sync the sign toggle button next to an offset input to reflect a
// signed numeric value. The input stores the absolute value.
function syncOffsetSign(input, signedVal){
  if(!input)return;
  const btn = input.nextElementSibling;
  if(!btn || !btn.classList.contains('time-offset-sign-btn'))return;
  const neg = signedVal < 0;
  btn.dataset.sign = neg ? '-' : '+';
  btn.textContent = neg ? '−' : '+';
  btn.setAttribute('aria-label', (neg ? 'negative' : 'positive') + ' offset');
}
// PURE: read the signed offset from an input element by combining its value
// with the sign from the adjacent .time-offset-sign-btn.
function readSignedOffset(input){
  const raw = normalizePrayerOffset(input ? input.value : 0);
  if(!input)return raw;
  const btn = input.nextElementSibling;
  if(btn && btn.classList.contains('time-offset-sign-btn') && btn.dataset.sign === '-'){
    return -Math.abs(raw);
  }
  return Math.abs(raw);
}
// PURE: read the anchor value (or null) from a per-endpoint editor, addressed
// by its fixed-input id. Returns null when the endpoint is in fixed mode.
function readAnchorFromEndpoint(fixedInputId){
  const el = document.getElementById(fixedInputId);
  if(!el)return null;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return null;
  const sel = endpoint.querySelector('.time-anchor');
  return cleanAnchor(sel ? sel.value : '');
}
// PURE: read the signed offset (default 0) from a per-endpoint editor.
function readOffsetFromEndpoint(fixedInputId){
  const el = document.getElementById(fixedInputId);
  if(!el)return 0;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return 0;
  const input = endpoint.querySelector('.time-offset');
  return readSignedOffset(input);
}
// PURE: read the referenced habit id (or null) from a per-endpoint editor.
// Returns null when the endpoint isn't in 'habit' anchor mode.
// `which` is '' (primary) or '2' (secondary expression).
function readHabitIdFromEndpoint(fixedInputId, which = ''){
  const el = document.getElementById(fixedInputId);
  if(!el)return null;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return null;
  const sel = endpoint.querySelector(which === '2' ? '.time-anchor2' : '.time-anchor');
  if(!sel || sel.value !== 'habit')return null;
  const picker = endpoint.querySelector(which === '2' ? '.time-habit2' : '.time-habit');
  const id = picker ? cleanHabitId(picker.value) : '';
  return id || null;
}
// PURE: read combine mode / secondary expression / day offsets from an endpoint.
function readCombineFromEndpoint(fixedInputId){
  const empty = {
    combine:null, anchor2:null, offset2:0, habitId2:null, fixedMin2:null, dayOffset:0, dayOffset2:0
  };
  const el = document.getElementById(fixedInputId);
  if(!el)return empty;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return empty;
  const combine = cleanTimeCombine(endpoint.querySelector('.time-combine')?.value);
  const dayOffset = endpoint.querySelector('.time-day-next')?.getAttribute('aria-pressed') === 'true' ? 1 : 0;
  if(!combine){
    return {...empty, dayOffset};
  }
  const anchor2 = cleanAnchor(endpoint.querySelector('.time-anchor2')?.value);
  const offset2 = anchor2 && anchor2 !== 'fixed'
    ? readSignedOffset(endpoint.querySelector('.time-offset2')) : 0;
  const dayOffset2 = anchor2 && anchor2 !== 'fixed'
    && endpoint.querySelector('.time-day-next2')?.getAttribute('aria-pressed') === 'true' ? 1 : 0;
  const fixedMin2 = anchor2 === 'fixed'
    ? (timeInputToMinutes(endpoint.querySelector('.time-fixed2')?.value) ?? 1200)
    : null;
  return {
    combine: anchor2 ? combine : null,
    anchor2,
    offset2,
    habitId2: readHabitIdFromEndpoint(fixedInputId, '2'),
    fixedMin2,
    dayOffset,
    dayOffset2
  };
}

// HYBRID: reads form DOM into tune object
function currentDetailTune(){
  const type = document.querySelector('#detail-type-seg .seg-opt.on')?.dataset.detailType || 'keepup';
  const locationIds = selectedLocationIdsFrom('detail-tag-chips');
  const locationPrefs = selectedLocationPrefsFrom('detail-tag-chips');
  const subjectHid = detailIdx != null ? cleanHabitId(load()[detailIdx]?.hid) : '';
  return {
    name:$('detail-habit-message').value.trim(),
    type,
    emoji:cleanMark($('detail-emoji').value),
    emojiBgColor:selectedEmojiBgColor('detail-emoji-bg'),
    target:currentRhythmTarget('detail'),
    pinned:$('detail-pinned').getAttribute('aria-pressed') === 'true',
    topics:selectedTopicsFrom('detail-tag-chips'),
    locationIds,
    anywhereAllowed:selectedAnywhereFrom('detail-tag-chips'),
    locationPrefs,
    preferredLocationId:primaryPreferredLocationId(locationPrefs,locationIds),
    allowedWeekdays:selectedWeekdaysFrom('detail-weekday-chips'),
    allowedMonthDays:selectedMonthDaysFrom('detail-monthday-chips'),
    preferredWeekdays:selectedWeekdaysFrom('detail-preferred-weekday-chips'),
    preferredMonthDays:selectedMonthDaysFrom('detail-preferred-monthday-chips'),
    allowedTimeStart:timeInputToMinutes($('detail-time-start').value),
    allowedTimeEnd:timeInputToMinutes($('detail-time-end').value),
    preferredTimeStart:timeInputToMinutes($('detail-preferred-time-start').value),
    preferredTimeEnd:timeInputToMinutes($('detail-preferred-time-end').value),
    allowedTimeStartAnchor:readAnchorFromEndpoint('detail-time-start'),
    allowedTimeStartOffsetMin:readOffsetFromEndpoint('detail-time-start'),
    allowedTimeEndAnchor:readAnchorFromEndpoint('detail-time-end'),
    allowedTimeEndOffsetMin:readOffsetFromEndpoint('detail-time-end'),
    preferredTimeStartAnchor:readAnchorFromEndpoint('detail-preferred-time-start'),
    preferredTimeStartOffsetMin:readOffsetFromEndpoint('detail-preferred-time-start'),
    preferredTimeEndAnchor:readAnchorFromEndpoint('detail-preferred-time-end'),
    preferredTimeEndOffsetMin:readOffsetFromEndpoint('detail-preferred-time-end'),
    allowedTimeStartAnchorHabitId:readHabitIdFromEndpoint('detail-time-start'),
    allowedTimeEndAnchorHabitId:readHabitIdFromEndpoint('detail-time-end'),
    preferredTimeStartAnchorHabitId:readHabitIdFromEndpoint('detail-preferred-time-start'),
    preferredTimeEndAnchorHabitId:readHabitIdFromEndpoint('detail-preferred-time-end'),
    scheduleLinks:readScheduleLinksFromDetail(subjectHid),
    ...(() => {
      const c = readCombineFromEndpoint('detail-time-start');
      return {
        allowedTimeStartCombine:c.combine, allowedTimeStartAnchor2:c.anchor2,
        allowedTimeStartOffsetMin2:c.offset2, allowedTimeStartAnchorHabitId2:c.habitId2,
        allowedTimeStartFixedMin2:c.fixedMin2,
        allowedTimeStartDayOffset:c.dayOffset, allowedTimeStartDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-time-end');
      return {
        allowedTimeEndCombine:c.combine, allowedTimeEndAnchor2:c.anchor2,
        allowedTimeEndOffsetMin2:c.offset2, allowedTimeEndAnchorHabitId2:c.habitId2,
        allowedTimeEndFixedMin2:c.fixedMin2,
        allowedTimeEndDayOffset:c.dayOffset, allowedTimeEndDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-preferred-time-start');
      return {
        preferredTimeStartCombine:c.combine, preferredTimeStartAnchor2:c.anchor2,
        preferredTimeStartOffsetMin2:c.offset2, preferredTimeStartAnchorHabitId2:c.habitId2,
        preferredTimeStartFixedMin2:c.fixedMin2,
        preferredTimeStartDayOffset:c.dayOffset, preferredTimeStartDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-preferred-time-end');
      return {
        preferredTimeEndCombine:c.combine, preferredTimeEndAnchor2:c.anchor2,
        preferredTimeEndOffsetMin2:c.offset2, preferredTimeEndAnchorHabitId2:c.habitId2,
        preferredTimeEndFixedMin2:c.fixedMin2,
        preferredTimeEndDayOffset:c.dayOffset, preferredTimeEndDayOffset2:c.dayOffset2
      };
    })(),
    durationMinutes:clampDuration($('detail-duration').value),
    breakable:$('detail-breakable')?.getAttribute('aria-pressed') === 'true',
    minChunkMinutes:clampMinChunk($('detail-min-chunk')?.value),
    timerAutoStopMinutes:normalizeTimerAutoStop($('detail-timer-auto-stop')?.value),
    autoMarkMinutes:normalizeAutoMark($('detail-auto-mark')?.value),
    trackValue:$('detail-track-value')?.getAttribute('aria-pressed') === 'true',
    flexibilityDays:clampFlexibility($('detail-flexibility').value),
    priority:clampPriority(document.querySelector('#detail-priority-seg .seg-opt.on')?.dataset.priority),
    dueDate:parseDateInput($('detail-due-date').value),
    eventTime:parseTaskWhen($('detail-due-date').value,$('detail-due-time')?.value || ''),
    planByDate:parseDateInput($('detail-plan-by-date')?.value || '')
  };
}

function syncBreakableUi(){
  const on = $('detail-breakable')?.getAttribute('aria-pressed') === 'true';
  const row = $('detail-min-chunk-row');
  if(row)row.hidden = !on;
  const autoValue = normalizeAutoMark($('detail-auto-mark')?.value);
  const autoOn = autoValue !== null;
  const label = $('detail-auto-mark-label');
  const summary = $('detail-auto-mark-summary');
  const unit = $('detail-auto-mark-unit');
  const inputWrap = $('detail-auto-mark')?.closest('.range-value');
  if(label)label.textContent = on ? 'auto-log agenda chunks' : 'auto mark done';
  // Keep the compact "min" unit; after/later belongs in the summary copy.
  if(unit)unit.textContent = 'min';
  if(summary){
    summary.textContent = on
      ? (autoOn
        ? `Each placed chunk logs ${autoValue ? `${autoValue} min after` : 'when'} it ends. Manual taps count first.`
        : 'Blank keeps chunk logging manual.')
      : (autoOn
        ? `Logs automatically ${autoValue ? `${autoValue} min after` : 'at'} its trigger.`
        : 'Blank keeps this manual.');
  }
  if(inputWrap){
    inputWrap.setAttribute('aria-label',on
      ? 'agenda chunk auto-log delay in minutes, blank is manual'
      : 'auto mark done delay in minutes, blank is manual');
  }
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
      current.emojiBgColor !== detailTuneOriginal.emojiBgColor ||
      String(current.target) !== String(detailTuneOriginal.target) ||
      current.pinned !== detailTuneOriginal.pinned ||
      current.durationMinutes !== detailTuneOriginal.durationMinutes ||
      current.flexibilityDays !== detailTuneOriginal.flexibilityDays ||
      current.priority !== detailTuneOriginal.priority ||
      current.dueDate !== detailTuneOriginal.dueDate ||
      current.eventTime !== detailTuneOriginal.eventTime ||
      current.planByDate !== detailTuneOriginal.planByDate ||
      current.autoMarkMinutes !== detailTuneOriginal.autoMarkMinutes ||
      current.topics.join('|') !== detailTuneOriginal.topics.join('|') ||
      current.locationIds.join('|') !== (detailTuneOriginal.locationIds || []).join('|') ||
      current.anywhereAllowed !== Boolean(detailTuneOriginal.anywhereAllowed) ||
      JSON.stringify(current.locationPrefs || {}) !== JSON.stringify(detailTuneOriginal.locationPrefs || {}) ||
      (current.preferredLocationId || null) !== (detailTuneOriginal.preferredLocationId || null) ||
      current.breakable !== detailTuneOriginal.breakable ||
      current.minChunkMinutes !== detailTuneOriginal.minChunkMinutes ||
      current.timerAutoStopMinutes !== detailTuneOriginal.timerAutoStopMinutes ||
      current.trackValue !== detailTuneOriginal.trackValue ||
      current.allowedWeekdays.join('|') !== detailTuneOriginal.allowedWeekdays.join('|') ||
      current.allowedMonthDays.join('|') !== detailTuneOriginal.allowedMonthDays.join('|') ||
      current.preferredWeekdays.join('|') !== detailTuneOriginal.preferredWeekdays.join('|') ||
      current.preferredMonthDays.join('|') !== detailTuneOriginal.preferredMonthDays.join('|') ||
      current.allowedTimeStart !== detailTuneOriginal.allowedTimeStart ||
      current.allowedTimeEnd !== detailTuneOriginal.allowedTimeEnd ||
      current.preferredTimeStart !== detailTuneOriginal.preferredTimeStart ||
      current.preferredTimeEnd !== detailTuneOriginal.preferredTimeEnd ||
      current.allowedTimeStartAnchor !== detailTuneOriginal.allowedTimeStartAnchor ||
      current.allowedTimeStartOffsetMin !== detailTuneOriginal.allowedTimeStartOffsetMin ||
      current.allowedTimeEndAnchor !== detailTuneOriginal.allowedTimeEndAnchor ||
      current.allowedTimeEndOffsetMin !== detailTuneOriginal.allowedTimeEndOffsetMin ||
      current.preferredTimeStartAnchor !== detailTuneOriginal.preferredTimeStartAnchor ||
      current.preferredTimeStartOffsetMin !== detailTuneOriginal.preferredTimeStartOffsetMin ||
      current.preferredTimeEndAnchor !== detailTuneOriginal.preferredTimeEndAnchor ||
      current.preferredTimeEndOffsetMin !== detailTuneOriginal.preferredTimeEndOffsetMin ||
      (current.allowedTimeStartAnchorHabitId || null) !== (detailTuneOriginal.allowedTimeStartAnchorHabitId || null) ||
      (current.allowedTimeEndAnchorHabitId || null) !== (detailTuneOriginal.allowedTimeEndAnchorHabitId || null) ||
      (current.preferredTimeStartAnchorHabitId || null) !== (detailTuneOriginal.preferredTimeStartAnchorHabitId || null) ||
      (current.preferredTimeEndAnchorHabitId || null) !== (detailTuneOriginal.preferredTimeEndAnchorHabitId || null) ||
      JSON.stringify(current.scheduleLinks || {}) !== JSON.stringify(detailTuneOriginal.scheduleLinks || {}) ||
      (current.allowedTimeStartCombine || null) !== (detailTuneOriginal.allowedTimeStartCombine || null) ||
      (current.allowedTimeStartAnchor2 || null) !== (detailTuneOriginal.allowedTimeStartAnchor2 || null) ||
      current.allowedTimeStartOffsetMin2 !== detailTuneOriginal.allowedTimeStartOffsetMin2 ||
      (current.allowedTimeStartAnchorHabitId2 || null) !== (detailTuneOriginal.allowedTimeStartAnchorHabitId2 || null) ||
      (current.allowedTimeStartFixedMin2 ?? null) !== (detailTuneOriginal.allowedTimeStartFixedMin2 ?? null) ||
      current.allowedTimeStartDayOffset !== detailTuneOriginal.allowedTimeStartDayOffset ||
      current.allowedTimeStartDayOffset2 !== detailTuneOriginal.allowedTimeStartDayOffset2 ||
      (current.allowedTimeEndCombine || null) !== (detailTuneOriginal.allowedTimeEndCombine || null) ||
      (current.allowedTimeEndAnchor2 || null) !== (detailTuneOriginal.allowedTimeEndAnchor2 || null) ||
      current.allowedTimeEndOffsetMin2 !== detailTuneOriginal.allowedTimeEndOffsetMin2 ||
      (current.allowedTimeEndAnchorHabitId2 || null) !== (detailTuneOriginal.allowedTimeEndAnchorHabitId2 || null) ||
      (current.allowedTimeEndFixedMin2 ?? null) !== (detailTuneOriginal.allowedTimeEndFixedMin2 ?? null) ||
      current.allowedTimeEndDayOffset !== detailTuneOriginal.allowedTimeEndDayOffset ||
      current.allowedTimeEndDayOffset2 !== detailTuneOriginal.allowedTimeEndDayOffset2 ||
      (current.preferredTimeStartCombine || null) !== (detailTuneOriginal.preferredTimeStartCombine || null) ||
      (current.preferredTimeStartAnchor2 || null) !== (detailTuneOriginal.preferredTimeStartAnchor2 || null) ||
      current.preferredTimeStartOffsetMin2 !== detailTuneOriginal.preferredTimeStartOffsetMin2 ||
      (current.preferredTimeStartAnchorHabitId2 || null) !== (detailTuneOriginal.preferredTimeStartAnchorHabitId2 || null) ||
      (current.preferredTimeStartFixedMin2 ?? null) !== (detailTuneOriginal.preferredTimeStartFixedMin2 ?? null) ||
      current.preferredTimeStartDayOffset !== detailTuneOriginal.preferredTimeStartDayOffset ||
      current.preferredTimeStartDayOffset2 !== detailTuneOriginal.preferredTimeStartDayOffset2 ||
      (current.preferredTimeEndCombine || null) !== (detailTuneOriginal.preferredTimeEndCombine || null) ||
      (current.preferredTimeEndAnchor2 || null) !== (detailTuneOriginal.preferredTimeEndAnchor2 || null) ||
      current.preferredTimeEndOffsetMin2 !== detailTuneOriginal.preferredTimeEndOffsetMin2 ||
      (current.preferredTimeEndAnchorHabitId2 || null) !== (detailTuneOriginal.preferredTimeEndAnchorHabitId2 || null) ||
      (current.preferredTimeEndFixedMin2 ?? null) !== (detailTuneOriginal.preferredTimeEndFixedMin2 ?? null) ||
      current.preferredTimeEndDayOffset !== detailTuneOriginal.preferredTimeEndDayOffset ||
      current.preferredTimeEndDayOffset2 !== detailTuneOriginal.preferredTimeEndDayOffset2)
  );
  sheet.classList.toggle('tune-dirty',Boolean(dirty));
}

// HYBRID: rewrites form fields from saved original
function restoreDetailTune(){
  if(!detailTuneOriginal)return;
  $('detail-habit-message').value = detailTuneOriginal.name;
  $('detail-emoji').value = detailTuneOriginal.emoji;
  renderEmojiBgSwatches('detail-emoji-bg',detailTuneOriginal.emojiBgColor || '');
  $('detail-pinned').setAttribute('aria-pressed',detailTuneOriginal.pinned ? 'true' : 'false');
  $('detail-duration').value = detailTuneOriginal.durationMinutes;
  $('detail-flexibility').value = detailTuneOriginal.flexibilityDays;
  $('detail-due-date').value = dateInputValue(detailTuneOriginal.dueDate);
  if($('detail-due-time'))$('detail-due-time').value = detailTuneOriginal.eventTime !== null ? timeInputValue(detailTuneOriginal.eventTime) : '';
  if($('detail-plan-by-date'))$('detail-plan-by-date').value = dateInputValue(detailTuneOriginal.planByDate);
  syncDetailDueUi();
  syncDetailPlanByUi();
  renderTagChips('detail-tag-chips',detailTuneOriginal.topics,detailTuneOriginal.locationIds || [],detailTuneOriginal.preferredLocationId || null,detailTuneOriginal.locationPrefs || null,detailTuneOriginal.anywhereAllowed);
  if($('detail-breakable'))$('detail-breakable').setAttribute('aria-pressed',detailTuneOriginal.breakable ? 'true' : 'false');
  if($('detail-min-chunk'))$('detail-min-chunk').value = detailTuneOriginal.minChunkMinutes || DEFAULT_MIN_CHUNK_MINUTES;
  if($('detail-track-value'))$('detail-track-value').setAttribute('aria-pressed',detailTuneOriginal.trackValue ? 'true' : 'false');
  if($('detail-timer-auto-stop'))$('detail-timer-auto-stop').value = detailTuneOriginal.timerAutoStopMinutes != null ? detailTuneOriginal.timerAutoStopMinutes : '';
  if($('detail-auto-mark'))$('detail-auto-mark').value = detailTuneOriginal.autoMarkMinutes != null ? detailTuneOriginal.autoMarkMinutes : '';
  syncBreakableUi();
  renderScheduleChips('detail',detailTuneOriginal);
  renderScheduleLinkEditors(detailTuneOriginal);
  renderTimeWindowInputs(detailTuneOriginal);
  setDetailTypeUi(detailTuneOriginal.type);
  setDetailPriorityUi(detailTuneOriginal.priority);
  if(detailTuneOriginal.target !== '')syncRhythm('detail',detailTuneOriginal.target);
  setDetailDirty(false);
}

// RENDER: task due row hint — date-only vs fixed appointment
function syncDetailDueUi(){
  const dueInput = $('detail-due-date');
  const timeInput = $('detail-due-time');
  if(!dueInput)return;
  const hasDate = Boolean(dueInput.value);
  const hasTime = Boolean(timeInput?.value);
  const hint = $('detail-due-hint');
  if(hint){
    if(!hasDate)hint.textContent = 'No due date. This stays in your list as a low-priority someday task until you date it or finish it.';
    else if(hasTime)hint.textContent = 'Fixed appointment — shows on your agenda at this time. Clear the date to remove both.';
    else hint.textContent = 'Due on this date — set flexibility to 0 for a firm deadline.';
  }
}

// RENDER: toggle habit one-off plan-by controls + hint
function syncDetailPlanByUi(){
  const input = $('detail-plan-by-date');
  const clearBtn = $('detail-plan-by-clear');
  const weekBtn = $('detail-plan-by-week');
  if(!input)return;
  const hasDate = Boolean(input.value);
  if(clearBtn)clearBtn.hidden = !hasDate;
  if(weekBtn)weekBtn.hidden = hasDate;
  const hint = $('detail-plan-by-hint');
  if(hint)hint.textContent = hasDate
    ? 'Soft one-off target — the week planner will place this habit on a free day on or before this date. Cleared when you log it.'
    : 'Optional. Set a one-off “plan by” date to pull this habit into the week planner without picking a specific day.';
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
    : `${target}d rhythm`;
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

// PURE: computes 0-100 progress score
function progressScore(h){
  if(h.type === 'task'){
    if(h.breakable && h.lastLog !== null){
      const total = clampDuration(h.durationMinutes);
      const done = loggedChunkMinutes(h);
      if(total <= 0)return 100;
      return Math.max(0,Math.min(100,Math.round((done / total) * 100)));
    }
    if(h.lastLog !== null)return 100;
    const when = taskWhen(h);
    if(when === null)return null;
    const left = daysUntil(when);
    if(left === null)return null;
    const window = Math.max(1,h.flexibilityDays || 3);
    if(left <= 0)return Math.max(0,Math.round(30 - Math.min(30,Math.abs(left) * 6)));
    return Math.round(Math.min(100,100 - (left / window) * 50));
  }
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
    if(h.type === 'keepup'){
      if(days < target)return `${planLabel}. Last entry was ${when}.`;
      if(days === target)return `${planLabel}. Last entry was ${when}. Rhythm is also due today.`;
      return `${planLabel}. Last entry was ${when}. Rhythm is ${days - target} days overdue.`;
    }
    return days >= target
      ? `${planLabel}. ${days} days since the last entry.`
      : `${planLabel}. Entry was ${when}.`;
  }
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
      ${targetPct ? `<div class="target-line" style="bottom:${targetPct}%"><span>${target}d</span></div>` : ''}
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

const DETAIL_PAGE_NAV = {
  calendar:{label:'calendar',icon:'ti-calendar-month'},
  insight:{label:'insight',icon:'ti-chart-line'},
  schedule:{label:'schedule',icon:'ti-calendar-time'},
  effort:{label:'effort',icon:'ti-progress-check'},
  identity:{label:'identity',icon:'ti-id'},
  actions:{label:'actions',icon:'ti-dots'}
};

function visibleDetailPages(pager){
  if(!pager)return [];
  return [...pager.querySelectorAll('.detail-page')].filter(page=>!page.hidden);
}

function detailPageIndexByNav(navKey){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if(!pager)return -1;
  return visibleDetailPages(pager).findIndex(page=>page.dataset.detailNav === navKey);
}

function scrollDetailToNav(navKey,behavior = 'auto'){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if(!pager)return;
  const index = detailPageIndexByNav(navKey);
  if(index < 0)return;
  pager.scrollTo({left:pager.clientWidth * index,behavior});
  updateDetailPagerDots();
}

// RENDER: syncs the compact pager navigation (skips hidden pages like order).
function updateDetailPagerDots(){
  const inner = getSheetInner('detail-sheet');
  const pager = inner?.querySelector('.detail-pager');
  const dotsWrap = inner?.querySelector('.detail-dots');
  if(!pager || !dotsWrap)return;
  const pages = visibleDetailPages(pager);
  pages.forEach((panel,i)=>{
    panel.id = panel.id || `detail-page-${i}`;
    panel.setAttribute('role','tabpanel');
  });
  const signature = pages.map(p=>p.dataset.detailNav || p.id).join('|');
  if(dotsWrap.dataset.pageSig !== signature){
    dotsWrap.dataset.pageSig = signature;
    dotsWrap.style.gridTemplateColumns = `repeat(${Math.max(1,pages.length)},minmax(0,1fr))`;
    dotsWrap.innerHTML = pages.map((panel,i)=>{
      const key = panel.dataset.detailNav || `page-${i}`;
      const item = DETAIL_PAGE_NAV[key] || {label:key,icon:'ti-circle'};
      return `<button type="button" class="detail-page-tab" role="tab" data-detail-page="${i}" title="${item.label}" aria-label="${item.label}" aria-controls="${panel.id}"><i class="ti ${item.icon}" aria-hidden="true"></i><span>${item.label}</span></button>`;
    }).join('');
  }
  if(dotsWrap.dataset.bound !== '1'){
    dotsWrap.dataset.bound = '1';
    dotsWrap.addEventListener('click',event=>{
      const tab = event.target.closest('.detail-page-tab');
      if(!tab || !dotsWrap.contains(tab))return;
      const livePages = visibleDetailPages(pager);
      const index = Math.max(0,Math.min(livePages.length - 1,Number(tab.dataset.detailPage) || 0));
      pager.scrollTo({left:pager.clientWidth * index,behavior:'smooth'});
    });
  }
  const dots = [...dotsWrap.querySelectorAll('.detail-page-tab')];
  if(!dots.length)return;
  const page = Math.max(0,Math.min(dots.length - 1,Math.round(pager.scrollLeft / Math.max(1,pager.clientWidth))));
  dots.forEach((dot,i)=>{
    dot.classList.toggle('on',i === page);
    dot.setAttribute('aria-selected',i === page ? 'true' : 'false');
    dot.tabIndex = i === page ? 0 : -1;
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

// PURE: checks whether a habit has a due/scheduled/plan-by marker on a day.
function hasScheduledMarkerForDay(h,key){
  if(typeof habitPlanMarkers === 'function'){
    return habitPlanMarkers(h).some(marker=>dateKey(marker.ts) === key);
  }
  return (
    (isTimedTask(h) && h.lastLog === null && dateKey(h.eventTime) === key) ||
    (h.type === 'task' && h.eventTime === null && h.dueDate !== null && h.lastLog === null && dateKey(h.dueDate) === key) ||
    ((h.type === 'keepup' || h.type === 'reduce') && h.planByDate && dateKey(h.planByDate) === key)
  );
}

// PURE: checks a planned entry exists today
function hasPlannedToday(h){
  const today = dateKey(Date.now());
  return hasPlannedEntryForDay(h,today) || hasScheduledMarkerForDay(h,today);
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

// PURE: format ms timestamp as ICS local datetime "YYYYMMDDTHHMMSS"
function icsDateTime(ts){
  const d = new Date(ts);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// PURE: format ms timestamp as ICS date "YYYYMMDD"
function icsDate(ts){
  const d = new Date(ts);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
// PURE: escape ICS text
function icsEscape(s){
  return String(s || '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
}
// PURE: build a VCALENDAR string for a scheduled or due-date task. Scheduled
// tasks become timed VEVENTs; due-date tasks become all-day VEVENTs so the system
// calendar fires a real alert — the bridge to native notifications on iOS.
function icsForHabit(h){
  const uid = `tings-${h.type}-${h.eventTime || h.dueDate || Date.now()}-${Date.now()}@local`;
  const stamp = icsDateTime(Date.now());
  const summary = icsEscape(h.name || '');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Tings//Habits//EN','BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${stamp}`];
  if(isTimedTask(h)){
    lines.push(`DTSTART:${icsDateTime(h.eventTime)}`);
    lines.push(`DTEND:${icsDateTime(h.eventTime + Math.max(1,clampDuration(h.durationMinutes)) * 60000)}`);
    lines.push(`SUMMARY:${summary}`);
  }else if(h.type === 'task' && h.dueDate){
    lines.push(`DTSTART;VALUE=DATE:${icsDate(h.dueDate)}`);
    lines.push(`SUMMARY:${summary}${h.hardDue ? ' (hard deadline)' : ''}`);
    lines.push('BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY',`DESCRIPTION:${summary}`,'END:VALARM');
  }else{
    return null;
  }
  lines.push('END:VEVENT','END:VCALENDAR');
  return lines.join('\r\n');
}

// HYBRID: trigger a .ics download for a scheduled or due-date task
function exportToCalendar(i){
  const data = load();
  const h = data[i];
  if(!h)return;
  const ics = icsForHabit(h);
  if(!ics){showToast('add a time or due date first');return;}
  const blob = new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(h.name || 'task').replace(/[^a-z0-9]+/gi,'-').slice(0,40)}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{if(a.isConnected)document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
  showToast('exported — open to add to calendar');
}

document.addEventListener('tierchange',()=>{
  renderDetailTabs();
  // Re-open detail if it was open, so the layout applies
  if (detailIdx !== null) {
    const idx = detailIdx;
    openSheet('detail-sheet');
  }
});
