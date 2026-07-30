// Temporary per-day agenda order constraints + "doing now" UX.
// Long-press a fill card (~450ms) to reveal the grip, then drag within that day.

const AGENDA_LONGPRESS_MS = 450;
const CARD_GESTURE_OWNERS = new Set(['hold','reorder','scrub','swipe']);
let _orderLinkDraft = null;
let _doingNowDraft = null;
let _agendaDrag = null;
let _agendaLongPress = null;
let _agendaReadyHideTimer = null;

/** Current exclusive gesture owner on a swipe-row, or null. */
function cardGestureOwner(row){
  if(!row || !row.dataset)return null;
  const o = row.dataset.cardGesture || '';
  return CARD_GESTURE_OWNERS.has(o) ? o : null;
}

/**
 * Claim exclusive gesture ownership.
 * opts.upgradeFrom — allow replacing that owner (e.g. hold → reorder)
 * opts.force — take over from 'hold' (weaker prelude) after cancelling long-press
 */
function claimCardGesture(row,owner,opts = {}){
  if(!row || !CARD_GESTURE_OWNERS.has(owner))return false;
  const cur = cardGestureOwner(row);
  if(cur === owner)return true;
  if(opts.upgradeFrom && cur === opts.upgradeFrom){
    row.dataset.cardGesture = owner;
    return true;
  }
  if(opts.force && cur === 'hold'){
    cancelAgendaLongPress({silent:true});
    row.classList.remove('agenda-drag-ready','agenda-longpress-armed');
    row.dataset.cardGesture = owner;
    return true;
  }
  if(cur)return false;
  row.dataset.cardGesture = owner;
  return true;
}

function releaseCardGesture(row,owner = null){
  if(!row)return false;
  const cur = cardGestureOwner(row);
  if(!cur)return false;
  if(owner != null && cur !== owner)return false;
  delete row.dataset.cardGesture;
  return true;
}

/** True if `action` must not start while another owner holds the row. */
function cardGestureBlocks(row,action){
  const cur = cardGestureOwner(row);
  if(!cur)return false;
  if(action === 'swipe')return cur === 'reorder' || cur === 'scrub' || cur === 'hold';
  if(action === 'scrub')return cur === 'reorder' || cur === 'swipe';
  if(action === 'hold')return cur === 'reorder' || cur === 'scrub' || cur === 'swipe';
  if(action === 'reorder')return cur === 'scrub' || cur === 'swipe';
  if(action === 'tap')return cur === 'reorder' || cur === 'scrub' || cur === 'swipe';
  return false;
}

function formatOrderDayLabel(dayBase){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return 'this day';
  const today = dayStart(Date.now());
  if(base === today)return 'today';
  if(base === today + 86400000)return 'tomorrow';
  return new Date(base).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}).toLowerCase();
}

function shortHabitName(h){
  if(!h || !h.name)return 'task';
  const name = String(h.name).trim();
  return name.length > 28 ? `${name.slice(0,26)}…` : name;
}

function habitEmoji(h){
  const emoji = h && typeof h.emoji === 'string' ? h.emoji.trim() : '';
  return emoji || '';
}

function habitLabelHtml(h){
  const emoji = habitEmoji(h);
  const name = escapeHtml(shortHabitName(h));
  if(emoji)return `<span class="order-emoji" aria-hidden="true">${escapeHtml(emoji)}</span><b>${name}</b>`;
  return `<b>${name}</b>`;
}

function isAgendaFillDraggable(h,agendaRow){
  if(!h || !agendaRow)return false;
  if(agendaRow.kind !== 'fill' && agendaRow.kind !== 'scheduled')return false;
  // Fixed-time meetings stay put; they can still be link anchors via neighbors.
  if(agendaRow.kind === 'scheduled' && h.type === 'task' && h.eventTime != null)return false;
  if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h))return false;
  return true;
}

function orderMarkChipHtml(pill){
  const arrow = pill.kind === 'after' ? 'ti-arrow-up' : 'ti-arrow-down';
  const arrowLabel = pill.kind === 'after' ? 'after' : 'before';
  const emoji = pill.otherEmoji || '';
  const vars = typeof emojiBgStyleVars === 'function' ? emojiBgStyleVars(pill.otherBg) : null;
  const style = vars
    ? `style="--order-mark-bg:${vars.bg};--order-mark-fg:${vars.icon}"`
    : '';
  const emojiHtml = emoji
    ? `<span class="order-mark-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>`
    : `<span class="order-mark-emoji is-empty" aria-hidden="true">·</span>`;
  const adj = pill.adjacency === 'direct' ? 'next' : 'later';
  const title = `${arrowLabel} ${pill.otherName || 'task'} (${adj})`;
  return `<span class="order-mark${vars ? ' has-bg' : ''}" ${style} title="${escapeHtml(title)}"><i class="ti ${arrow}" aria-hidden="true"></i>${emojiHtml}</span>`;
}

/** Compact non-interactive order indicators: arrow + neighbor emoji/color. */
function orderLinkPillHtml(hid,dayBase,data){
  if(!hid || dayBase == null || typeof orderConstraintPillsForHid !== 'function')return '';
  const pills = orderConstraintPillsForHid(hid,dayBase,data);
  if(!pills.length)return '';
  const title = pills.map(p=>p.label).join(' · ');
  return `<span class="order-marks" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${pills.map(orderMarkChipHtml).join('')}</span>`;
}

function doingNowPillHtml(h,now = Date.now()){
  if(!h || !h.hid || typeof getDoingNow !== 'function')return '';
  const doing = getDoingNow();
  if(!doing || doing.hid !== h.hid)return '';
  if(typeof isDoingNowActive === 'function' && !isDoingNowActive(doing,now))return '';
  const targetAt = Number(doing.targetAt)
    || Number(doing.endsAt)
    || Number(doing.startedAt) + Math.max(1,Number(doing.sessionMinutes) || 30) * 60000;
  const auto = doing.completionMode === 'auto';
  const leftMin = Math.max(0,Math.ceil((targetAt - now) / 60000));
  const elapsedMin = Math.max(1,Math.floor((now - Number(doing.startedAt)) / 60000));
  const label = auto
    ? `auto · ${Math.max(1,leftMin)}m`
    : leftMin > 0
      ? `session · ${leftMin}m`
      : `target reached · ${elapsedMin}m`;
  const title = auto
    ? 'doing now — logs automatically at the end'
    : 'manual session — continues until you stop it';
  return `<span class="context-pill doing-now-pill" title="${title}"><i class="ti ti-player-play" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
}

function openDoingNowSheet(draft){
  _doingNowDraft = draft;
  const nameEl = $('doing-now-name');
  const sub = $('doing-now-sub');
  const linkRow = $('doing-now-link-row');
  if(nameEl)nameEl.innerHTML = habitLabelHtml(draft && draft.h);
  const mins = draft && draft.h && typeof doingNowSessionMinutesFor === 'function'
    ? doingNowSessionMinutesFor(draft.h)
    : (draft && draft.h ? clampDuration(draft.h.durationMinutes) : 30);
  if(sub){
    sub.textContent = `Keeps this on top and logs it automatically after ${mins}m.`;
  }
  if(linkRow){
    const data = typeof load === 'function' ? load() : [];
    const afterH = draft && draft.after && draft.after.h
      ? draft.after.h
      : data.find(item=>item && draft && draft.afterHid && item.hid === draft.afterHid);
    linkRow.innerHTML = afterH
      ? buildOrderLinkRow('before',afterH,'off')
      : '';
    linkRow.querySelector('.order-link-adj')?.addEventListener('click',e=>{
      const opt = e.target.closest('[data-adj]');
      if(!opt)return;
      const seg = opt.closest('.order-link-adj');
      seg.querySelectorAll('.seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
    });
  }
  if(typeof openSheet === 'function')openSheet('doing-now-sheet');
}

function confirmDoingNow(){
  const draft = _doingNowDraft;
  closeSheet('doing-now-sheet');
  _doingNowDraft = null;
  if(!draft || !draft.h || !draft.h.hid)return;
  const now = Date.now();
  const today = dayStart(now);
  const sessionMinutes = typeof doingNowSessionMinutesFor === 'function'
    ? doingNowSessionMinutesFor(draft.h,now)
    : clampDuration(draft.h.durationMinutes);
  const data = typeof load === 'function' ? load() : [];
  const idx = data.findIndex(item=>item && item.hid === draft.h.hid);
  let started = false;
  if(idx >= 0 && typeof startHabitTimer === 'function'){
    started = startHabitTimer(idx,{sessionMinutes,completionMode:'auto',toast:false});
  }else if(typeof setDoingNow === 'function'){
    setDoingNow(draft.h.hid,now,today,{
      sessionMinutes,
      completionMode:'auto'
    });
    started = true;
  }
  if(!started)return;

  // Moving to top chooses the active session unconditionally, but its
  // relationship to the card below is explicit in the sheet.
  if(typeof clearOrderEdgesForDay === 'function'){
    clearOrderEdgesForDay(today,draft.h.hid);
  }
  const afterH = draft.after && draft.after.h
    ? draft.after.h
    : data.find(item=>item && draft.afterHid && item.hid === draft.afterHid);
  const selected = document.querySelector('#doing-now-link-row .order-link-row[data-link-kind="before"] .seg-opt.on');
  const adjacency = selected && selected.dataset.adj;
  if(afterH && adjacency && adjacency !== 'off' && typeof saveOrderConstraintsForDrop === 'function'){
    saveOrderConstraintsForDrop(today,[{
      beforeHid:draft.h.hid,
      afterHid:afterH.hid,
      adjacency:adjacency === 'direct' ? 'direct' : 'sometime'
    }]);
  }
  if(typeof showToast === 'function')showToast(`doing ${shortHabitName(draft.h)} now · ${sessionMinutes}m`);
  if(typeof render === 'function')render();
  else if(typeof refreshOpenViews === 'function')refreshOpenViews();
  if(typeof sweepAutoDoneTasks === 'function')setTimeout(sweepAutoDoneTasks,200);
}

function cancelDoingNowSheet(){
  _doingNowDraft = null;
  if(typeof closeSheet === 'function')closeSheet('doing-now-sheet');
}

function buildOrderLinkRow(kind,otherHabit,defaultAdj){
  const isBelow = kind === 'after';
  const direction = isBelow ? 'below' : 'above';
  const directLabel = isBelow ? 'right below' : 'right above';
  return `<div class="order-link-row" data-link-kind="${kind}">
    <div class="order-link-row-label"><span>Place ${direction}</span> ${habitLabelHtml(otherHabit)}</div>
    <div class="seg order-link-adj" role="group" aria-label="place ${direction} ${escapeHtml(shortHabitName(otherHabit))}">
      <button type="button" class="seg-opt${defaultAdj === 'off' ? ' on' : ''}" data-adj="off">off</button>
      <button type="button" class="seg-opt${defaultAdj === 'sometime' ? ' on' : ''}" data-adj="sometime">${direction}</button>
      <button type="button" class="seg-opt${defaultAdj === 'direct' ? ' on' : ''}" data-adj="direct">${directLabel}</button>
    </div>
  </div>`;
}

function openOrderLinkSheet(draft){
  _orderLinkDraft = draft;
  const title = $('order-link-title');
  const sub = $('order-link-sub');
  const summary = $('order-link-summary');
  const rows = $('order-link-rows');
  const clearBtn = $('order-link-clear');
  if(title)title.textContent = 'Keep this position?';
  if(sub)sub.textContent = `Choose above or below for ${formatOrderDayLabel(draft.dayBase)}. Clears when done.`;
  if(summary)summary.innerHTML = habitLabelHtml(draft.h);

  const parts = [];
  if(draft.before){
    parts.push(buildOrderLinkRow('after',draft.before.h,draft.defaults.after || 'sometime'));
  }
  if(draft.after){
    parts.push(buildOrderLinkRow('before',draft.after.h,draft.defaults.before || 'sometime'));
  }
  if(rows)rows.innerHTML = parts.join('') || '<p class="sheet-sub">Nothing nearby to link.</p>';

  if(clearBtn){
    const hasExisting = typeof orderConstraintsForDay === 'function'
      && orderConstraintsForDay(draft.dayBase).some(e=>e.beforeHid === draft.h.hid || e.afterHid === draft.h.hid);
    clearBtn.hidden = !hasExisting && !draft.editMode;
  }

  rows?.querySelectorAll('.order-link-adj').forEach(seg=>{
    seg.addEventListener('click',e=>{
      const opt = e.target.closest('[data-adj]');
      if(!opt)return;
      seg.querySelectorAll('.seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
    });
  });

  if(typeof openSheet === 'function')openSheet('order-link-sheet');
}

function readOrderLinkChoices(){
  const draft = _orderLinkDraft;
  if(!draft)return [];
  const edges = [];
  const afterSeg = document.querySelector('.order-link-row[data-link-kind="after"] .seg-opt.on');
  const beforeSeg = document.querySelector('.order-link-row[data-link-kind="before"] .seg-opt.on');
  const afterAdj = afterSeg ? afterSeg.dataset.adj : 'off';
  const beforeAdj = beforeSeg ? beforeSeg.dataset.adj : 'off';
  if(draft.before && afterAdj && afterAdj !== 'off'){
    edges.push({
      beforeHid:draft.before.h.hid,
      afterHid:draft.h.hid,
      adjacency:afterAdj === 'direct' ? 'direct' : 'sometime'
    });
  }
  if(draft.after && beforeAdj && beforeAdj !== 'off'){
    edges.push({
      beforeHid:draft.h.hid,
      afterHid:draft.after.h.hid,
      adjacency:beforeAdj === 'direct' ? 'direct' : 'sometime'
    });
  }
  return edges;
}

function saveOrderLinkSheet(){
  const draft = _orderLinkDraft;
  if(!draft || !draft.h){ cancelOrderLinkSheet(); return; }
  const edges = readOrderLinkChoices();
  // Clear prior links for this habit on this day, then write the new set.
  if(typeof clearOrderConstraintsForDay === 'function'){
    clearOrderConstraintsForDay(draft.dayBase,draft.h.hid);
  }
  if(edges.length && typeof saveOrderConstraintsForDrop === 'function'){
    saveOrderConstraintsForDrop(draft.dayBase,edges);
  }
  closeSheet('order-link-sheet');
  _orderLinkDraft = null;
  if(typeof showToast === 'function'){
    showToast(edges.length ? 'order saved' : 'order cleared');
  }
  if(typeof render === 'function')render();
  else if(typeof refreshOpenViews === 'function')refreshOpenViews();
}

function clearOrderLinkSheet(){
  const draft = _orderLinkDraft;
  if(!draft || !draft.h){ cancelOrderLinkSheet(); return; }
  if(typeof clearOrderConstraintsForDay === 'function'){
    clearOrderConstraintsForDay(draft.dayBase,draft.h.hid);
  }
  closeSheet('order-link-sheet');
  _orderLinkDraft = null;
  if(typeof showToast === 'function')showToast('order cleared');
  if(typeof render === 'function')render();
  else if(typeof refreshOpenViews === 'function')refreshOpenViews();
}

function cancelOrderLinkSheet(){
  _orderLinkDraft = null;
  if(typeof closeSheet === 'function')closeSheet('order-link-sheet');
}

function openOrderLinksForHabit(hid,dayBase){
  const data = load();
  const h = data.find(item=>item && item.hid === hid);
  if(!h || dayBase == null)return;
  const edges = typeof orderConstraintsForDay === 'function' ? orderConstraintsForDay(dayBase) : [];
  let before = null;
  let after = null;
  let afterAdj = 'sometime';
  let beforeAdj = 'sometime';
  for(const e of edges){
    if(e.afterHid === hid){
      const bh = data.find(item=>item && item.hid === e.beforeHid);
      if(bh){ before = {h:bh}; afterAdj = e.adjacency; }
    }
    if(e.beforeHid === hid){
      const ah = data.find(item=>item && item.hid === e.afterHid);
      if(ah){ after = {h:ah}; beforeAdj = e.adjacency; }
    }
  }
  openOrderLinkSheet({
    h,
    dayBase,
    before,
    after,
    defaults:{after:before ? afterAdj : 'off', before:after ? beforeAdj : 'off'},
    editMode:true
  });
}

function dayFillRows(dayBase){
  const key = String(dayBase);
  return [...document.querySelectorAll(`.swipe-row[data-day-base="${key}"][data-agenda-draggable="1"]`)];
}

function agendaRowHid(row,data = null){
  if(!row)return '';
  if(row.dataset && row.dataset.hid)return row.dataset.hid;
  const idx = Number(row.dataset && row.dataset.realIdx);
  const source = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  const h = Number.isInteger(idx) ? source[idx] : null;
  return h && h.hid ? h.hid : '';
}

/**
 * Collapse consecutive agenda chunks for the same habit into one drop target.
 * A breakable habit may render several rows; treating those rows as separate
 * targets can create a self-link when one chunk is dropped beside another.
 */
function agendaDropGroups(dayBase,dragEl){
  const data = typeof load === 'function' ? load() : [];
  const dragHid = agendaRowHid(dragEl,data);
  const rows = dayFillRows(dayBase).filter(row=>
    row !== dragEl && (!dragHid || agendaRowHid(row,data) !== dragHid)
  );
  const groups = [];
  for(const row of rows){
    const hid = agendaRowHid(row,data);
    const last = groups[groups.length - 1];
    if(last && hid && last.hid === hid){
      last.rows.push(row);
      last.lastEl = row;
      continue;
    }
    groups.push({hid,rows:[row],firstEl:row,lastEl:row});
  }
  return groups;
}

function clearAgendaDropLines(){
  document.querySelectorAll('.agenda-drop-line').forEach(el=>el.remove());
}

function insertDropLine(beforeEl){
  clearAgendaDropLines();
  const line = document.createElement('div');
  line.className = 'agenda-drop-line on';
  line.setAttribute('aria-hidden','true');
  if(beforeEl && beforeEl.parentNode){
    beforeEl.parentNode.insertBefore(line,beforeEl);
  }
  return line;
}

function resolveDropTarget(clientY,dayBase,dragEl){
  const groups = agendaDropGroups(dayBase,dragEl);
  if(!groups.length)return {index:0,beforeEl:null,before:null,after:null};
  let insertIndex = groups.length;
  let beforeEl = null;
  for(let i = 0;i < groups.length;i += 1){
    const firstRect = groups[i].firstEl.getBoundingClientRect();
    const lastRect = groups[i].lastEl.getBoundingClientRect();
    const mid = (firstRect.top + lastRect.bottom) / 2;
    if(clientY < mid){
      insertIndex = i;
      beforeEl = groups[i].firstEl;
      break;
    }
  }
  const beforeGroup = insertIndex > 0 ? groups[insertIndex - 1] : null;
  const afterGroup = insertIndex < groups.length ? groups[insertIndex] : null;
  const beforeRow = beforeGroup ? beforeGroup.lastEl : null;
  const afterRow = afterGroup ? afterGroup.firstEl : null;
  return {
    index:insertIndex,
    beforeEl,
    before:beforeRow ? Number(beforeRow.dataset.realIdx) : null,
    after:afterRow ? Number(afterRow.dataset.realIdx) : null
  };
}

function updateAgendaDropIndicator(clientY,dayBase,dragEl){
  const target = resolveDropTarget(clientY,dayBase,dragEl);
  if(target.beforeEl){
    insertDropLine(target.beforeEl);
    return;
  }
  const groups = agendaDropGroups(dayBase,dragEl);
  const lastGroup = groups[groups.length - 1];
  const last = lastGroup && lastGroup.lastEl;
  clearAgendaDropLines();
  if(last && last.parentNode){
    const line = document.createElement('div');
    line.className = 'agenda-drop-line on';
    if(last.nextSibling)last.parentNode.insertBefore(line,last.nextSibling);
    else last.parentNode.appendChild(line);
  }
}

function clearAgendaDragReady(exceptRow = null){
  if(_agendaReadyHideTimer){
    clearTimeout(_agendaReadyHideTimer);
    _agendaReadyHideTimer = null;
  }
  document.querySelectorAll('.swipe-row.agenda-drag-ready').forEach(row=>{
    if(exceptRow && row === exceptRow)return;
    row.classList.remove('agenda-drag-ready','agenda-longpress-armed');
  });
}

function scheduleAgendaDragReadyHide(row){
  if(_agendaReadyHideTimer)clearTimeout(_agendaReadyHideTimer);
  _agendaReadyHideTimer = setTimeout(()=>{
    if(_agendaDrag)return;
    if(row)row.classList.remove('agenda-drag-ready','agenda-longpress-armed');
    _agendaReadyHideTimer = null;
  },4000);
}

function finishAgendaDrag(clientY){
  const drag = _agendaDrag;
  _agendaDrag = null;
  clearAgendaDropLines();
  if(!drag)return;
  drag.row.classList.remove('is-agenda-dragging','agenda-longpress-armed');
  releaseCardGesture(drag.row,'reorder');
  if(!drag.moved){
    // Grip revealed but no move — keep ready briefly so they can grab again.
    drag.row.classList.add('agenda-drag-ready');
    scheduleAgendaDragReadyHide(drag.row);
    return;
  }
  drag.row.classList.remove('agenda-drag-ready');
  const data = load();
  const h = data[drag.realIdx];
  if(!h)return;
  const target = resolveDropTarget(clientY,drag.dayBase,drag.row);
  const beforeH = target.before != null ? data[target.before] : null;
  const afterH = target.after != null ? data[target.after] : null;
  const todayBase = dayStart(Date.now());
  const atTop = target.index === 0;

  // Drag to top of today → doing now (one-shot auto-done for this session).
  if(atTop && drag.dayBase === todayBase){
    openDoingNowSheet({
      h,
      after:afterH ? {h:afterH} : null,
      afterHid:afterH && afterH.hid ? afterH.hid : null
    });
    return;
  }

  openOrderLinkSheet({
    h,
    dayBase:drag.dayBase,
    before:beforeH ? {h:beforeH} : null,
    after:afterH ? {h:afterH} : null,
    defaults:{
      after:beforeH ? 'sometime' : 'off',
      before:afterH ? 'sometime' : 'off'
    },
    editMode:false
  });
}

function beginAgendaDrag(row,realIdx,dayBase,pointerId,clientY,fromHandle){
  if(cardGestureBlocks(row,'reorder') && cardGestureOwner(row) !== 'hold')return false;
  if(!claimCardGesture(row,'reorder',{upgradeFrom:'hold'}) && !claimCardGesture(row,'reorder'))return false;
  clearAgendaDragReady(row);
  delete row.dataset.crownGesture;
  if(typeof closeAllSwipes === 'function')closeAllSwipes();
  row.classList.add('agenda-drag-ready','is-agenda-dragging');
  _agendaDrag = {
    row,
    realIdx,
    dayBase:Number(dayBase),
    pointerId,
    startY:clientY,
    moved:false,
    fromHandle:Boolean(fromHandle)
  };
  try{
    if(typeof navigator !== 'undefined' && navigator.vibrate)navigator.vibrate(12);
  }catch{ /* ignore */ }
  return true;
}

function cancelAgendaLongPress(opts = {}){
  if(!_agendaLongPress)return;
  const row = _agendaLongPress.row;
  if(_agendaLongPress.timer)clearTimeout(_agendaLongPress.timer);
  if(row)row.classList.remove('agenda-longpress-armed');
  _agendaLongPress = null;
  if(!opts.silent && row)releaseCardGesture(row,'hold');
}

/** Start the long-press that reveals the reorder grip (card or breakable crown). */
function beginAgendaCardLongPress(row,realIdx,dayBase,e){
  if(!row || realIdx == null || dayBase == null || !e)return false;
  if(row.dataset.agendaDraggable !== '1')return false;
  if(_agendaDrag)return false;
  if(cardGestureBlocks(row,'hold'))return false;
  cancelAgendaLongPress();
  if(!claimCardGesture(row,'hold'))return false;
  const card = row.querySelector('.ting-card');
  const scrollHost = card ? card.closest('.pane-list,.sheet,.detail-page') : null;
  _agendaLongPress = {
    row,realIdx,dayBase:Number(dayBase),pointerId:e.pointerId,
    x:e.clientX,y:e.clientY,held:true,armed:false,
    scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY,
    timer:setTimeout(()=>{
      if(!_agendaLongPress || _agendaLongPress.pointerId !== e.pointerId)return;
      _agendaLongPress.armed = true;
      _agendaLongPress.timer = null;
      // Crown may still soft-claim swipe — drop it so vertical drag can reorder.
      delete row.dataset.crownGesture;
      armAgendaReorder(row,realIdx,dayBase);
    },AGENDA_LONGPRESS_MS)
  };
  return true;
}

/** After grip is armed, a vertical move from the crown starts the drag. */
function tryAgendaDragFromArmedPress(row,e){
  if(!_agendaLongPress || _agendaLongPress.pointerId !== e.pointerId)return false;
  if(!_agendaLongPress.armed || !_agendaLongPress.held)return false;
  if(Math.abs(e.clientY - _agendaLongPress.y) <= 6)return false;
  const lp = _agendaLongPress;
  _agendaLongPress = null;
  return beginAgendaDrag(row,lp.realIdx,lp.dayBase,lp.pointerId,e.clientY,false);
}

/** True while a reorder long-press is timing or armed for this pointer. */
function agendaLongPressOwnsPointer(pointerId){
  return Boolean(_agendaLongPress && _agendaLongPress.pointerId === pointerId);
}

/** Crown / foreign pointerup: settle long-press or finish an in-flight drag. */
function settleAgendaPointerFromForeignTarget(row,e){
  if(_agendaDrag && _agendaDrag.pointerId === e.pointerId && _agendaDrag.row === row){
    finishAgendaDrag(e.clientY);
    return true;
  }
  if(!_agendaLongPress || _agendaLongPress.pointerId !== e.pointerId)return false;
  _agendaLongPress.held = false;
  if(_agendaLongPress.timer)cancelAgendaLongPress();
  else{
    _agendaLongPress = null;
    releaseCardGesture(row,'hold');
    scheduleAgendaDragReadyHide(row);
  }
  return true;
}

function armAgendaReorder(row,realIdx,dayBase){
  clearAgendaDragReady(row);
  row.classList.add('agenda-drag-ready','agenda-longpress-armed');
  const card = row.querySelector('.ting-card');
  if(card)card.dataset.ignoreClickUntil = String(Date.now() + 800);
  try{
    if(typeof navigator !== 'undefined' && navigator.vibrate)navigator.vibrate(10);
  }catch{ /* ignore */ }
  scheduleAgendaDragReadyHide(row);
}

function setupAgendaDragHandle(row,realIdx,dayBase){
  if(!row || realIdx == null || dayBase == null)return;
  const handle = row.querySelector('.agenda-drag-handle');
  const card = row.querySelector('.ting-card');
  if(!handle || !card)return;

  // Long-press on the card reveals the six-dot grip. Crown dial starts its
  // own long-press via beginAgendaCardLongPress (it stopPropagates).
  card.addEventListener('pointerdown',e=>{
    if(e.button != null && e.button !== 0)return;
    if(e.target.closest('.pulse-btn,.breakable-crown,.breakable-progress,.agenda-drag-handle,.order-marks,.card-action-btn'))return;
    beginAgendaCardLongPress(row,realIdx,dayBase,e);
  });

  card.addEventListener('pointermove',e=>{
    if(_agendaLongPress && _agendaLongPress.pointerId === e.pointerId && !_agendaDrag){
      const moved = Math.hypot(e.clientX - _agendaLongPress.x,e.clientY - _agendaLongPress.y);
      const scrollTop = _agendaLongPress.scrollHost ? _agendaLongPress.scrollHost.scrollTop : window.scrollY;
      if(!_agendaLongPress.armed){
        if(moved > 8 || Math.abs(scrollTop - _agendaLongPress.scrollTop) > 1){
          cancelAgendaLongPress();
        }
        return;
      }
      // Armed + still holding + vertical move → start dragging the card.
      tryAgendaDragFromArmedPress(row,e);
    }
    if(!_agendaDrag || _agendaDrag.pointerId !== e.pointerId || _agendaDrag.row !== row)return;
    e.preventDefault();
    if(Math.abs(e.clientY - _agendaDrag.startY) > 6)_agendaDrag.moved = true;
    if(!_agendaDrag.moved)return;
    updateAgendaDropIndicator(e.clientY,_agendaDrag.dayBase,_agendaDrag.row);
  },{passive:false});

  const endCard = e=>{
    if(_agendaLongPress && _agendaLongPress.pointerId === e.pointerId){
      _agendaLongPress.held = false;
      if(_agendaLongPress.timer)cancelAgendaLongPress();
      else{
        // Grip is visible; leave it ready for a follow-up grip drag.
        _agendaLongPress = null;
        releaseCardGesture(row,'hold');
        scheduleAgendaDragReadyHide(row);
      }
    }
    if(!_agendaDrag || _agendaDrag.pointerId !== e.pointerId || _agendaDrag.row !== row)return;
    finishAgendaDrag(e.clientY);
  };
  card.addEventListener('pointerup',endCard);
  card.addEventListener('pointercancel',endCard);

  // Once revealed, dragging the grip still works as a dedicated hit target.
  handle.addEventListener('pointerdown',e=>{
    if(e.button != null && e.button !== 0)return;
    e.preventDefault();
    e.stopPropagation();
    cancelAgendaLongPress();
    try{ handle.setPointerCapture(e.pointerId); }catch{ /* ignore */ }
    if(!beginAgendaDrag(row,realIdx,dayBase,e.pointerId,e.clientY,true)){
      try{ handle.releasePointerCapture(e.pointerId); }catch{ /* ignore */ }
    }
  });
  handle.addEventListener('pointermove',e=>{
    if(!_agendaDrag || _agendaDrag.pointerId !== e.pointerId || _agendaDrag.row !== row)return;
    e.preventDefault();
    if(Math.abs(e.clientY - _agendaDrag.startY) > 6)_agendaDrag.moved = true;
    if(!_agendaDrag.moved)return;
    updateAgendaDropIndicator(e.clientY,_agendaDrag.dayBase,_agendaDrag.row);
  });
  const endHandle = e=>{
    if(!_agendaDrag || _agendaDrag.pointerId !== e.pointerId || _agendaDrag.row !== row)return;
    try{ handle.releasePointerCapture(e.pointerId); }catch{ /* ignore */ }
    finishAgendaDrag(e.clientY);
  };
  handle.addEventListener('pointerup',endHandle);
  handle.addEventListener('pointercancel',endHandle);
}

function wireAgendaOrderSheets(){
  $('order-link-cancel')?.addEventListener('click',cancelOrderLinkSheet);
  $('order-link-save')?.addEventListener('click',saveOrderLinkSheet);
  $('order-link-clear')?.addEventListener('click',clearOrderLinkSheet);
  $('doing-now-cancel')?.addEventListener('click',cancelDoingNowSheet);
  $('doing-now-confirm')?.addEventListener('click',confirmDoingNow);
  document.addEventListener('click',e=>{
    const unlink = e.target.closest('[data-order-unlink]');
    if(unlink){
      e.preventDefault();
      e.stopPropagation();
      const id = unlink.dataset.orderUnlink;
      if(id && typeof removeOrderConstraint === 'function'){
        removeOrderConstraint(id);
        if(typeof showToast === 'function')showToast('order link removed');
        if(typeof renderDetailOrderPage === 'function')renderDetailOrderPage();
        if(typeof render === 'function')render();
        else if(typeof refreshOpenViews === 'function')refreshOpenViews();
      }
      return;
    }
    const clearAll = e.target.closest('[data-order-clear-hid]');
    if(clearAll){
      e.preventDefault();
      e.stopPropagation();
      const hid = clearAll.dataset.orderClearHid;
      if(hid && typeof clearOrderConstraintsForHid === 'function'){
        clearOrderConstraintsForHid(hid);
      }else if(hid && typeof orderConstraintsForHid === 'function' && typeof removeOrderConstraint === 'function'){
        for(const edge of orderConstraintsForHid(hid))removeOrderConstraint(edge.id);
      }
      if(typeof showToast === 'function')showToast('order cleared');
      if(typeof renderDetailOrderPage === 'function')renderDetailOrderPage();
      if(typeof render === 'function')render();
      else if(typeof refreshOpenViews === 'function')refreshOpenViews();
      return;
    }
    if(!e.target.closest('.agenda-drag-handle') && !_agendaDrag){
      clearAgendaDragReady();
    }
  });
}

if(typeof document !== 'undefined'){
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded',wireAgendaOrderSheets);
  }else{
    wireAgendaOrderSheets();
  }
}
