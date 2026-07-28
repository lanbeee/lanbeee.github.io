// Temporary per-day agenda order constraints + "doing now" UX.
// Long-press a fill card (~450ms) to reveal the grip, then drag within that day.

const AGENDA_LONGPRESS_MS = 450;
let _orderLinkDraft = null;
let _doingNowDraft = null;
let _agendaDrag = null;
let _agendaLongPress = null;
let _agendaReadyHideTimer = null;

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

function orderLinkPillHtml(hid,dayBase,data){
  if(!hid || dayBase == null || typeof orderConstraintPillsForHid !== 'function')return '';
  const pills = orderConstraintPillsForHid(hid,dayBase,data);
  if(!pills.length)return '';
  const first = pills[0];
  const extra = pills.length > 1 ? ` +${pills.length - 1}` : '';
  return `<button type="button" class="context-pill order-link" data-order-pill="${escapeHtml(hid)}" data-order-day="${dayBase}" title="${escapeHtml(pills.map(p=>p.label).join(' · '))}"><i class="ti ti-arrows-vertical" aria-hidden="true"></i>${escapeHtml(first.label)}${escapeHtml(extra)}</button>`;
}

function doingNowPillHtml(h){
  if(!h || !h.hid || typeof getDoingNow !== 'function')return '';
  const doing = getDoingNow();
  if(!doing || doing.hid !== h.hid)return '';
  return `<span class="context-pill doing-now-pill" title="doing now"><i class="ti ti-player-play" aria-hidden="true"></i>now</span>`;
}

function openDoingNowSheet(draft){
  _doingNowDraft = draft;
  const nameEl = $('doing-now-name');
  const sub = $('doing-now-sub');
  if(nameEl)nameEl.innerHTML = habitLabelHtml(draft && draft.h);
  if(sub){
    sub.textContent = draft && draft.h && draft.h.breakable
      ? 'Chunks auto-log from a fresh start.'
      : 'Auto-done starts from now.';
  }
  if(typeof openSheet === 'function')openSheet('doing-now-sheet');
}

function confirmDoingNow(){
  const draft = _doingNowDraft;
  closeSheet('doing-now-sheet');
  _doingNowDraft = null;
  if(!draft || !draft.h || !draft.h.hid)return;
  const now = Date.now();
  if(typeof setDoingNow === 'function')setDoingNow(draft.h.hid,now,dayStart(now));
  // Also prefer it first today relative to the previous first fill, if any.
  if(draft.afterHid && typeof saveOrderConstraintsForDrop === 'function'){
    saveOrderConstraintsForDrop(dayStart(now),[{
      beforeHid:draft.h.hid,
      afterHid:draft.afterHid,
      adjacency:'sometime'
    }]);
  }
  if(typeof showToast === 'function')showToast(`doing ${shortHabitName(draft.h)} now`);
  if(typeof render === 'function')render();
  else if(typeof refreshOpenViews === 'function')refreshOpenViews();
  if(typeof sweepAutoDoneTasks === 'function')setTimeout(sweepAutoDoneTasks,200);
}

function cancelDoingNowSheet(){
  _doingNowDraft = null;
  if(typeof closeSheet === 'function')closeSheet('doing-now-sheet');
}

function buildOrderLinkRow(kind,otherHabit,defaultAdj){
  const directLabel = kind === 'after' ? 'next' : 'next';
  return `<div class="order-link-row" data-link-kind="${kind}">
    <div class="order-link-row-label"><span>${kind === 'after' ? 'After' : 'Before'}</span> ${habitLabelHtml(otherHabit)}</div>
    <div class="seg order-link-adj" role="group" aria-label="${kind === 'after' ? 'after link' : 'before link'}">
      <button type="button" class="seg-opt${defaultAdj === 'off' ? ' on' : ''}" data-adj="off">off</button>
      <button type="button" class="seg-opt${defaultAdj === 'sometime' ? ' on' : ''}" data-adj="sometime">later</button>
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
  if(title)title.textContent = 'Reorder?';
  if(sub)sub.textContent = `Just for ${formatOrderDayLabel(draft.dayBase)}. Clears when done.`;
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
  const rows = dayFillRows(dayBase).filter(r=>r !== dragEl);
  if(!rows.length)return {index:0,beforeEl:null,before:null,after:null};
  let insertIndex = rows.length;
  let beforeEl = null;
  for(let i = 0;i < rows.length;i += 1){
    const rect = rows[i].getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if(clientY < mid){
      insertIndex = i;
      beforeEl = rows[i];
      break;
    }
  }
  const beforeRow = insertIndex > 0 ? rows[insertIndex - 1] : null;
  const afterRow = insertIndex < rows.length ? rows[insertIndex] : null;
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
  const rows = dayFillRows(dayBase).filter(r=>r !== dragEl);
  const last = rows[rows.length - 1];
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
  const isAuto = typeof isAutoMark === 'function' && isAutoMark(h);

  // Drag to top of today + auto-mark → doing now.
  if(atTop && drag.dayBase === todayBase && isAuto){
    openDoingNowSheet({
      h,
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
  clearAgendaDragReady(row);
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
}

function cancelAgendaLongPress(){
  if(!_agendaLongPress)return;
  if(_agendaLongPress.timer)clearTimeout(_agendaLongPress.timer);
  if(_agendaLongPress.row)_agendaLongPress.row.classList.remove('agenda-longpress-armed');
  _agendaLongPress = null;
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

  // Long-press on the card reveals the six-dot grip.
  card.addEventListener('pointerdown',e=>{
    if(e.button != null && e.button !== 0)return;
    if(e.target.closest('.pulse-btn,.breakable-crown,.agenda-drag-handle,.context-pill.order-link,.card-action-btn'))return;
    if(_agendaDrag)return;
    cancelAgendaLongPress();
    const scrollHost = card.closest('.pane-list,.sheet,.detail-page');
    _agendaLongPress = {
      row,realIdx,dayBase:Number(dayBase),pointerId:e.pointerId,
      x:e.clientX,y:e.clientY,held:true,armed:false,
      scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY,
      timer:setTimeout(()=>{
        if(!_agendaLongPress || _agendaLongPress.pointerId !== e.pointerId)return;
        _agendaLongPress.armed = true;
        _agendaLongPress.timer = null;
        armAgendaReorder(row,realIdx,dayBase);
      },AGENDA_LONGPRESS_MS)
    };
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
      if(_agendaLongPress.held && Math.abs(e.clientY - _agendaLongPress.y) > 6){
        const lp = _agendaLongPress;
        _agendaLongPress = null;
        beginAgendaDrag(row,realIdx,dayBase,lp.pointerId,e.clientY,false);
      }
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
    beginAgendaDrag(row,realIdx,dayBase,e.pointerId,e.clientY,true);
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
    const pill = e.target.closest('[data-order-pill]');
    if(pill){
      e.preventDefault();
      e.stopPropagation();
      const hid = pill.dataset.orderPill;
      const dayBase = Number(pill.dataset.orderDay);
      openOrderLinksForHabit(hid,dayBase);
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
