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
  if(changedHabit){
    detailStripOffset = 0;
    detailVizMode = 'calendar';
  }
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
  renderDetailLinkRows(normalizeLinks(h.links));
  renderTagChips('detail-tag-chips',h.topics,h.locationIds,h.preferredLocationId,h.locationPrefs,h.anywhereAllowed);
  renderScheduleChips('detail',h);
  renderScheduleLinkEditors(h);
  renderTimeWindowInputs(h);
  $('detail-due-date').value = dateInputValue(h.dueDate);
  if($('detail-due-time'))$('detail-due-time').value = h.eventTime !== null ? timeInputValue(h.eventTime) : '';
  syncDetailDueUi();
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
    links:normalizeLinks(h.links),
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
  syncDetailVizMode();
  renderDetailOrderPage(h);
  setDetailDirty(false);
  applyDetailMinimalMode();
  openSheet('detail-sheet');
  if(changedHabit){
    const inner = getSheetInner('detail-sheet');
    const pager = inner?.querySelector('.detail-pager');
    if(inner)inner.scrollTop = 0;
    if(pager){
      pager.querySelectorAll('.detail-page').forEach(page=>{ page.scrollTop = 0; });
      // Order links → actions first so unlink is immediate.
      // Tasks land on Schedule, where their due date and placement controls live;
      // recurring habits land on Calendar so their history is visible first.
      const hasOrder = typeof habitHasOrderConstraints === 'function'
        && habitHasOrderConstraints(h.hid);
      const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
      requestAnimationFrame(()=>{
        if(hasOrder)scrollDetailToNav('actions','auto');
        else if(minimal)pager.scrollTo({top:0,behavior:'auto'});
        else if(h.type === 'task')scrollDetailToNav('schedule','auto');
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

// HYBRID: opens detail then scrolls to Schedule for either item type.
function openDetailSchedule(i){
  openDetail(i);
  requestAnimationFrame(()=>{
    scrollDetailToNav('schedule','auto');
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
      if(containerId === 'ting-emoji-bg' && typeof updateEmojiPreview === 'function')updateEmojiPreview();
      if(containerId === 'detail-emoji-bg' && typeof updateEmojiPreview === 'function')updateEmojiPreview();
    });
  }
}
