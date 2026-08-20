function renderProgressive(){
  const didRender = render();
  if(didRender !== false)_homeListFingerprint = homeListFingerprint();
}

// WIRE: crown-dial gesture for breakable progress. Drag horizontally to adjust
// minutes (3px ≈ 1 min, speed-adaptive). Updates the 3-color status bar and
// pending target. The dial owns horizontal intent in both directions (forward
// only — leftward clamps at the committed floor), so it never hands off to the
// card swipe; swipe instead starts from the dedicated right-edge zone and other
// non-crown surfaces. A clean tap propagates to card (opens detail); vertical
// gestures pass through to page scroll.
function setupBreakableCrown(row,_realIdx){
  const crown = row.querySelector('.breakable-crown');
  if(!crown)return;
  const canvas = crown.querySelector('.crown-canvas');
  const label = row.querySelector('.breakable-progress-label');
  const barManual = row.querySelector('.bar-manual');
  const barCalendar = row.querySelector('.bar-calendar');
  const barAdding = row.querySelector('.bar-adding');
  const total = Math.max(1,Math.round(Number(crown.dataset.total) || 1));
  const committed = Math.max(0,Math.min(total,Math.round(Number(crown.dataset.committed) || 0)));
  const calendarMin = Math.max(0,Math.round(Number(crown.dataset.calendar) || 0));
  const manualMin = Math.max(0,Math.round(Number(crown.dataset.manual) || 0));

  const PX_PER_MIN = 3;
  crown._scroll = committed * 10;
  if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas, crown._scroll);

  let tooltip = null;
  function showTooltip(minutes){
    const adding = Math.max(0,minutes - committed);
    if(!tooltip){
      tooltip = document.createElement('span');
      tooltip.className = 'crown-tooltip';
      crown.appendChild(tooltip);
    }
    tooltip.textContent = adding > 0 ? `+${adding}m` : `${minutes}m`;
    tooltip.classList.add('visible');
  }
  function hideTooltip(){
    if(tooltip)tooltip.classList.remove('visible');
  }

  function syncVisual(minutes){
    const m = Math.max(committed,Math.min(total,Math.round(minutes)));
    if(label)label.textContent = `${m}/${total}m`;
    crown.setAttribute('aria-valuenow',m);
    crown.setAttribute('aria-label',`progress ${m} of ${total} minutes`);
    crown.classList.toggle('complete',m >= total);
    const adding = m - committed;
    const capManual = Math.min(manualMin,total);
    const capCal = Math.min(calendarMin,total - capManual);
    const capAdding = Math.min(adding,total - capManual - capCal);
    const manualPct = total > 0 ? (capManual / total) * 100 : 0;
    const calPct = total > 0 ? (capCal / total) * 100 : 0;
    const addingPct = total > 0 ? (capAdding / total) * 100 : 0;
    if(barManual)barManual.style.width = `${manualPct}%`;
    if(barCalendar)barCalendar.style.width = `${calPct}%`;
    if(barAdding)barAdding.style.width = `${addingPct}%`;
  }

  function setTarget(minutes){
    const m = Math.max(committed,Math.min(total,Math.round(minutes)));
    row.dataset.progressTarget = String(m);
    row.dataset.progressDirty = m === committed ? '0' : '1';
    syncVisual(m);
  }

  let startX,startY,prevX,velX = 0,momentumId = null,smoothAnimId = null,scrubRaf = null;
  let dragging = false,pointerId = null,pendingDx = 0,pendingTarget = null;
  const friction = 0.92;
  const minScroll = committed * 10;
  const progressRoot = row.querySelector('.breakable-progress');

  const cancelMomentum = () => {
    if(momentumId){cancelAnimationFrame(momentumId);momentumId=null;}
    if(smoothAnimId){cancelAnimationFrame(smoothAnimId);smoothAnimId=null;}
  };

  const cancelScrub = () => {
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;}
    pendingDx = 0;
  };

  const applyScrubDx = dx => {
    if(!dx && pendingTarget == null)return;
    if(dx){
      crown._scroll = Math.max(minScroll,crown._scroll + dx * (10 / PX_PER_MIN));
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      const speed = Math.abs(velX);
      const gain = 1 + speed * 0.25;
      crown._valScroll += dx * gain;
      pendingTarget = crown._dragBase + Math.round(crown._valScroll / PX_PER_MIN);
    }
    if(pendingTarget != null){
      setTarget(pendingTarget);
      showTooltip(pendingTarget);
      pendingTarget = null;
    }
  };

  const flushScrub = () => {
    scrubRaf = null;
    const dx = pendingDx;
    pendingDx = 0;
    applyScrubDx(dx);
  };

  const startMomentum = initVel => {
    cancelMomentum();
    cancelScrub();
    const baseScroll = crown._scroll;
    const baseVal = Math.round(Number(row.dataset.progressTarget) || committed);
    let vel = initVel;
    let last = performance.now();
    const tick = now => {
      const dt = Math.min(32, Math.max(0, now - last));
      last = now;
      vel *= Math.pow(friction, dt / 16.67);
      if(Math.abs(vel) < 0.5){momentumId = null;hideTooltip();return;}
      crown._scroll = Math.max(minScroll,crown._scroll + vel * (dt / 16.67) * (10 / PX_PER_MIN));
      const derived = Math.max(committed,Math.min(total,baseVal + Math.round((crown._scroll - baseScroll) / 10)));
      setTarget(derived);
      showTooltip(derived);
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      momentumId = requestAnimationFrame(tick);
    };
    momentumId = requestAnimationFrame(tick);
  };

  crown.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    // Exclusive gestures: refuse while reorder/swipe owns the card.
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'hold')){
      pointerId = null;
      return;
    }
    cancelMomentum();
    cancelScrub();
    startX = e.clientX;
    startY = e.clientY;
    prevX = e.clientX;
    velX = 0;
    pendingDx = 0;
    pendingTarget = null;
    dragging = false;
    pointerId = e.pointerId;
    crown._valScroll = 0;
    crown._dragBase = Math.round(Number(row.dataset.progressTarget) || committed);
    // Soft-claim so a tiny move can't arm card swipe before horizontal intent is known.
    row.dataset.crownGesture = '1';
    // Breakable crown owns most of the card — also start reorder long-press here.
    // Horizontal scrub cancels it; a still hold reveals the grip.
    if(row.dataset.agendaDraggable === '1' && typeof beginAgendaCardLongPress === 'function'){
      const realIdx = Number(row.dataset.realIdx);
      const dayBase = Number(row.dataset.dayBase);
      if(Number.isFinite(realIdx) && Number.isFinite(dayBase)){
        beginAgendaCardLongPress(row,realIdx,dayBase,e);
      }
    }
  });

  crown.addEventListener('pointermove',e=>{
    if(pointerId === null || e.pointerId !== pointerId)return;
    e.stopPropagation();
    if(typeof cardGestureOwner === 'function' && cardGestureOwner(row) === 'reorder'){
      pointerId = null;
      delete row.dataset.crownGesture;
      return;
    }
    const dxTotal = e.clientX - startX;
    const dyTotal = e.clientY - startY;

    // Reorder already armed: vertical move hands off to agenda drag.
    if(row.classList.contains('agenda-drag-ready') || row.classList.contains('agenda-longpress-armed')){
      if(typeof tryAgendaDragFromArmedPress === 'function' && tryAgendaDragFromArmedPress(row,e)){
        pointerId = null;
        delete row.dataset.crownGesture;
        return;
      }
      // Stay still while holding the armed grip — don't scrub.
      if(Math.abs(dxTotal) < 10)return;
      if(typeof cancelAgendaLongPress === 'function')cancelAgendaLongPress();
    }

    if(!dragging){
      // 10px beats the card-tap tolerance (8px) so a genuine tap or tiny
      // thumb tremor never arms a scrub and dirties the dial behind the
      // user's back. Vertical still wins when it dominates (page scroll).
      if(Math.abs(dxTotal) < 10 && Math.abs(dyTotal) < 10)return;
      if(Math.abs(dyTotal) > Math.abs(dxTotal)){
        // Vertical intent before reorder arms → drop long-press + crown claim.
        if(typeof agendaLongPressOwnsPointer === 'function' && agendaLongPressOwnsPointer(e.pointerId)
          && !row.classList.contains('agenda-drag-ready')
          && !row.classList.contains('agenda-longpress-armed')){
          if(Math.abs(dyTotal) > 8 && typeof cancelAgendaLongPress === 'function')cancelAgendaLongPress();
          else return;
        }else if(typeof agendaLongPressOwnsPointer === 'function' && agendaLongPressOwnsPointer(e.pointerId)){
          // Armed: handoff handled above; keep waiting for clearer vertical.
          return;
        }
        pointerId = null;
        delete row.dataset.crownGesture;
        return;
      }
      // The dial owns horizontal intent in BOTH directions. Scrub is
      // forward-only, so a leftward drag simply holds still (clamped at the
      // committed floor) instead of handing off to the card swipe — that
      // handoff was what made the crown feel like it "slipped" into swipe
      // while dialing. Swiping now starts from the dedicated right-edge zone
      // (and every non-crown surface: title, status bar) via the row handler.
      // Horizontal scrub — cancel reorder long-press so dial wins.
      if(typeof claimCardGesture === 'function'){
        if(!claimCardGesture(row,'scrub',{force:true})){
          pointerId = null;
          delete row.dataset.crownGesture;
          return;
        }
      }else if(typeof cancelAgendaLongPress === 'function'){
        cancelAgendaLongPress();
      }
      row.classList.remove('agenda-drag-ready','agenda-longpress-armed');
      if(typeof closeAllSwipes === 'function')closeAllSwipes();
      dragging = true;
      try{ crown.setPointerCapture(e.pointerId); }catch{ /* synthetic / lost pointer */ }
      crown.classList.add('active');
      if(progressRoot)progressRoot.classList.add('is-scrubbing');
      e.preventDefault();
    }

    const dx = e.clientX - prevX;
    prevX = e.clientX;
    velX = velX * 0.55 + dx * 0.45;
    pendingDx += dx;
    if(!scrubRaf)scrubRaf = requestAnimationFrame(flushScrub);
  });

  const endDrag = e => {
    if(pointerId === null)return;
    e.stopPropagation();
    const wasDragging = dragging;
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;flushScrub();}
    if(dragging){
      crown.classList.remove('active');
      if(progressRoot)progressRoot.classList.remove('is-scrubbing');
      if(Math.abs(velX) > 1.5)startMomentum(velX);
      else hideTooltip();
      setTimeout(hideTooltip,1200);
    }
    dragging = false;
    pointerId = null;
    velX = 0;
    delete row.dataset.crownGesture;
    if(wasDragging && typeof releaseCardGesture === 'function')releaseCardGesture(row,'scrub');
    if(!wasDragging && e.type === 'pointerup'){
      // A drag or an armed long-press ending on the crown is not a tap.
      // Capture BEFORE settle: the drag finish clears these classes.
      const wasArmed = row.classList.contains('agenda-drag-ready') || row.classList.contains('agenda-longpress-armed');
      if(typeof settleAgendaPointerFromForeignTarget === 'function'){
        settleAgendaPointerFromForeignTarget(row,e);
      }
      if(wasArmed)return;
      if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'tap'))return;
      const card = row.querySelector('.ting-card');
      if(card){
        card.dataset.approvedClickUntil = String(Date.now()+500);
        card.click();
      }
    }
  };

  crown.addEventListener('pointerup',endDrag);
  crown.addEventListener('pointercancel',e=>{
    e.stopPropagation();
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;pendingDx=0;}
    if(dragging){
      crown.classList.remove('active');
      if(progressRoot)progressRoot.classList.remove('is-scrubbing');
      hideTooltip();
      if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'scrub');
    }
    dragging = false;pointerId = null;velX = 0;
    delete row.dataset.crownGesture;
    if(typeof cancelAgendaLongPress === 'function'
      && typeof agendaLongPressOwnsPointer === 'function'
      && agendaLongPressOwnsPointer(e.pointerId)){
      cancelAgendaLongPress();
    }
  });

  crown.addEventListener('wheel',e=>{
    e.preventDefault();
    cancelMomentum();
    cancelScrub();
    const step = e.deltaY < 0 ? 1 : -1;
    const cur = Math.round(Number(row.dataset.progressTarget) || committed);
    const next = Math.max(committed,Math.min(total,cur + step));
    if(next !== cur){
      crown._scroll = Math.max(minScroll,crown._scroll + step * 10);
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      setTarget(next);
    }
  },{passive:false});

  crown.addEventListener('keydown',e=>{
    const inc = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const dec = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if(inc||dec){
      e.preventDefault();
      cancelMomentum();
      cancelScrub();
      const cur = Math.round(Number(row.dataset.progressTarget) || committed);
      const next = Math.max(committed,Math.min(total,cur + (inc ? 1 : -1)));
      if(next !== cur){
        crown._scroll = Math.max(minScroll,crown._scroll + (inc ? 10 : -10));
        if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
        setTarget(next);
      }
    }
  });

  // Isolate the dial's pointer and mouse gestures from the row's tap
  // tracking. Touch events must bubble: the row swipe takes over leftward
  // drags on the dial, while rightward drags stay with the crown scrub.
  const stop = e=>{ e.stopPropagation(); };
  ['pointerdown','pointermove','pointerup','pointercancel','mousedown','mouseup'].forEach(ev=>{
    crown.addEventListener(ev,stop,{ passive:true });
  });
  crown.addEventListener('click',e=>{ e.stopPropagation(); },{ passive:true });

  window.addEventListener('resize',()=>{
    if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
  });

  syncVisual(committed);
}

// WIRE: attach swipe gesture listeners
function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const leftActions = row.querySelector('.swipe-actions-left');
  const rightActions = row.querySelector('.swipe-actions-right');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;
  let startedOpen = false;
  // Match CSS collapsed default so first paint never shows action chrome.
  if(leftActions){
    leftActions.style.width = '0';
    leftActions.style.pointerEvents = 'none';
  }
  if(rightActions){
    rightActions.style.width = '0';
    rightActions.style.pointerEvents = 'none';
  }

  // PURE: measure total swipe action width
  function revealWidth(actions){
    if(!actions)return 0;
    return actions.querySelectorAll('.swipe-action').length * SWIPE_ACTION_WIDTH;
  }

  // HYBRID: reset swipe DOM and clear state
  function resetSwipe(){
    card.style.transition = SNAP_TRANSITION;
    card.style.transform = '';
    if(leftActions){
      leftActions.style.transition = WIDTH_TRANSITION;
      leftActions.style.width = '0';
      leftActions.style.pointerEvents = 'none';
    }
    if(rightActions){
      rightActions.style.transition = WIDTH_TRANSITION;
      rightActions.style.width = '0';
      rightActions.style.pointerEvents = 'none';
    }
    swipeOpenCard = null;
    delete row.dataset.swipeOpen;
    if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
    startedOpen = false;
    moved = false;
    dx = 0;
  }

  row.addEventListener('touchstart',e=>{
    const t = e.changedTouches[0];
    // Reorder and crown scrub are committed gestures. A long-press `hold` is
    // deliberately trackable here: pointerdown fires before touchstart on
    // phones, and horizontal movement upgrades that soft hold to swipe below.
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'swipe')){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    if(row.classList.contains('is-agenda-dragging')
      || row.querySelector('.breakable-progress.is-scrubbing')){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    // The breakable-progress block is dial territory — the crown, its status
    // bar, and the progress header all sit in the card's center. Swipes on a
    // breakable card start only from an edge area: the left edge (pulse button
    // / name, handled here as normal) or the right edge (the dedicated
    // .breakable-scrub-hint zone). Touches that begin anywhere inside the
    // progress block — except that right-edge hint — never arm a card swipe.
    const onDial = t.target.closest && t.target.closest('.breakable-progress')
      && !(t.target.closest && t.target.closest('.breakable-scrub-hint'));
    if(onDial){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    touchId = t.identifier;startX = t.clientX;startY = t.clientY;dx = 0;moved = false;
    startedOpen = swipeOpenCard === card;
    if(swipeOpenCard && swipeOpenCard !== card){
      closeAllSwipes();
    }
  },{passive:true});

  row.addEventListener('touchmove',e=>{
    if(touchId === null)return;
    if(typeof cardGestureOwner === 'function'){
      const owner = cardGestureOwner(row);
      if(owner === 'reorder' || owner === 'scrub')return;
    }
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
    if(!moved){
      if(typeof claimCardGesture === 'function' && !claimCardGesture(row,'swipe',{force:true})){
        touchId = null;
        return;
      }
    }
    moved = true;dx = ddx;
    const wantsLeft = dx > 0;
    const activeActions = wantsLeft ? leftActions : rightActions;
    const inactiveActions = wantsLeft ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    if(!reveal){
      card.style.transition = 'none';
      card.style.transform = '';
      return;
    }
    const clamped = Math.max(-reveal,Math.min(reveal,dx));
    card.style.transition = 'none';
    if(activeActions)activeActions.style.transition = 'none';
    if(inactiveActions)inactiveActions.style.transition = 'none';
    card.style.transform = `translateX(${clamped}px)`;
    const pct = Math.min(1,Math.abs(clamped) / reveal);
    if(activeActions){
      activeActions.style.width = `${Math.abs(clamped) + SWIPE_CORNER_PAD}px`;
      activeActions.style.pointerEvents = pct > 0.2 ? 'auto' : 'none';
    }
    if(inactiveActions){
      inactiveActions.style.width = '0';
      inactiveActions.style.pointerEvents = 'none';
    }
  },{passive:false});

  row.addEventListener('touchend',()=>{
    if(touchId === null || !moved){
      if(touchId !== null && typeof releaseCardGesture === 'function'
        && typeof cardGestureOwner === 'function' && cardGestureOwner(row) === 'swipe'
        && !row.dataset.swipeOpen){
        releaseCardGesture(row,'swipe');
      }
      touchId = null;
      return;
    }
    if(startedOpen){
      startedOpen = false;
      touchId = null;
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    const activeActions = dir > 0 ? leftActions : rightActions;
    const inactiveActions = dir > 0 ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const snap = reveal > 0 && Math.abs(dx) > Math.min(SWIPE_THRESHOLD,reveal * 0.55);
    card.style.transition = SNAP_TRANSITION;
    if(activeActions)activeActions.style.transition = WIDTH_TRANSITION;
    if(inactiveActions)inactiveActions.style.transition = WIDTH_TRANSITION;
    if(snap){
      card.style.transform = `translateX(${dir * reveal}px)`;
      if(activeActions){
        activeActions.style.width = `${reveal + SWIPE_CORNER_PAD}px`;
        activeActions.style.pointerEvents = 'auto';
      }
      if(inactiveActions){
        inactiveActions.style.width = '0';
        inactiveActions.style.pointerEvents = 'none';
      }
      swipeOpenCard = card;
      row.dataset.swipeOpen = String(dir);
      if(typeof claimCardGesture === 'function')claimCardGesture(row,'swipe');
    }else{
      card.style.transform = '';
      if(leftActions){
        leftActions.style.width = '0';
        leftActions.style.pointerEvents = 'none';
      }
      if(rightActions){
        rightActions.style.width = '0';
        rightActions.style.pointerEvents = 'none';
      }
      swipeOpenCard = null;
      delete row.dataset.swipeOpen;
      if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
    }
    touchId = null;
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
    if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
  });
  swipeOpenCard = null;
}

// WIRE: attach card tap and pointer listeners
function setupCardTap(row,realIdx){
  const card = row.querySelector('.ting-card');
  card.addEventListener('pointerdown',e=>{
    if(e.target.closest('.pulse-btn'))return;
    const scrollHost = card.closest('.pane-list,.sheet,.detail-page');
    cardPointer = {
      card,realIdx,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),maxMove:0,
      scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY
    };
  });
  card.addEventListener('pointermove',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    cardPointer.maxMove = Math.max(cardPointer.maxMove,Math.hypot(e.clientX-cardPointer.x,e.clientY-cardPointer.y));
  },{passive:true});
  card.addEventListener('pointerup',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    const tap = cardPointer;
    cardPointer = null;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX - tap.x,e.clientY - tap.y));
    const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
    if(moved > 8 || Math.abs(scrollTop-tap.scrollTop) > 1 || Date.now() - tap.time > 650){
      card.dataset.ignoreClickUntil = String(Date.now()+500);
      return;
    }
    card.dataset.approvedClickUntil = String(Date.now()+500);
  });
  card.addEventListener('pointercancel',e=>{
    if(cardPointer && cardPointer.card === card && cardPointer.id === e.pointerId){
      const tap = cardPointer;cardPointer = null;
      const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
      if(tap.maxMove > 8 || Math.abs(scrollTop-tap.scrollTop) > 1)card.dataset.ignoreClickUntil = String(Date.now()+500);
    }
  });
  card.addEventListener('click',e=>{
    if(Number(card.dataset.ignoreClickUntil || 0) > Date.now()){
      e.preventDefault();e.stopPropagation();return;
    }
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'tap')){
      e.preventDefault();e.stopPropagation();return;
    }
    if(row.classList.contains('is-agenda-dragging') || row.classList.contains('agenda-longpress-armed')){
      e.preventDefault();e.stopPropagation();return;
    }
    if(e.target.closest('.pulse-btn'))return;
    const clickNow = performance.now();
    const previousClick = Number(card.dataset.lastClickAt || 0);
    if(previousClick && clickNow-previousClick < 80){
      e.preventDefault();e.stopPropagation();return;
    }
    card.dataset.lastClickAt = String(clickNow);
    if(swipeOpenCard){closeAllSwipes();return;}
    handleCardActivate(realIdx,card,()=>openDetail(realIdx));
  });
}

// HANDLER: shared tap vs double-tap timing. key identifies the thing tapped
// (a habit index, or a "from|to" pair for a travel leg) so a quick tap on one
// card followed by a tap on another never reads as a double tap.
function handleDoubleTapActivate(key,singleAction,doubleAction){
  const now = Date.now();
  if(lastTap.idx === key && now - lastTap.time < TAP_DELAY){
    clearTimeout(tapTimer);
    lastTap = {idx:-1,time:0};
    doubleAction();
    return;
  }
  lastTap = {idx:key,time:now};
  clearTimeout(tapTimer);
  tapTimer = setTimeout(singleAction,TAP_DELAY);
}

// HANDLER: distinguish tap (open detail / log) from double-tap, which logs the
// item and launches whatever it points at — the call, the meeting room, the link.
function handleCardActivate(realIdx,card,singleAction){
  handleDoubleTapActivate(realIdx,singleAction,()=>{
    quickLog(realIdx,card);
    launchPrimaryHabitLink(realIdx);
  });
}

// HANDLER: open a habit's primary link. Runs inside the tap that logged it, so
// the gesture is still live for the popup blocker.
function launchPrimaryHabitLink(realIdx){
  const h = load()[realIdx];
  const link = typeof habitPrimaryLink === 'function' ? habitPrimaryLink(h) : null;
  if(!link)return false;
  return typeof openHabitLink === 'function' ? openHabitLink(link) : false;
}

// PURE: short item name for compact toast messages
function toastItemName(h){
  const name = (h?.name || '').trim();
  if(!name)return 'item';
  return name.length > 28 ? `${name.slice(0,27)}...` : name;
}

// PURE: secondary toast action for entry changes. Stop habits never get a
// plan-related action — they cannot be planned, only logged.
function entryToastAction(action){
  if(!action || action.type !== 'entry' || !Number.isInteger(action.idx))return null;
  if(load()[action.idx]?.type === 'zero')return null;
  if(action.consumedPlanTs)return {type:'keep-plan',label:'keep plan'};
  if(action.plan){
    if(dateKey(action.ts) <= todayIso())return {type:'complete-plan',label:'done now'};
    return null;
  }
  if(dateKey(action.ts) === todayIso())return {type:'plan-instead',label:'plan instead'};
  return {type:'plan-today',label:'plan today'};
}

// PURE: annotates action state with the contextual toast action
function withEntryToastAction(action){
  const toastAction = entryToastAction(action);
  if(toastAction){
    action.toastAction = toastAction.type;
    action.toastActionLabel = toastAction.label;
  }
  return action;
}

// PURE: finds an exact actual/planned log entry
function findEntryByKind(logs,ts,plan){
  return logs.findIndex(log=>logTime(log) === ts && isPlanLog(log) === Boolean(plan));
}

// PURE: picks the plan that should be consumed by a real entry on the same day.
function planToConsumeForEntry(logs,entryTs){
  const key = dateKey(entryTs);
  const planned = normalizeLogs(logs)
    .filter(log=>isPlanLog(log) && dateKey(logTime(log)) === key)
    .map(logTime);
  if(!planned.length)return null;
  return planned.sort((a,b)=>Math.abs(a - entryTs) - Math.abs(b - entryTs))[0];
}

// HYBRID: replace an actual entry with a plan, or a plan with an actual entry.
function replaceEntryKind(idx,fromTs,fromPlan,toTs,toPlan,label){
  const data = load();
  if(!data[idx])return false;
  // Never turn a stop habit's entry into a plan — stop habits aren't plannable.
  if(toPlan && data[idx].type === 'zero')return false;
  const logs = normalizeLogs(data[idx].logs);
  const pos = findEntryByKind(logs,fromTs,fromPlan);
  if(pos < 0)return false;
  const snoozedUntilBefore = data[idx].snoozedUntil || null;
  logs.splice(pos,1);
  logs.push(toPlan ? {ts:toTs,plan:true} : toTs);
  data[idx].logs = normalizeLogs(logs);
  data[idx].lastLog = latestActualLog(data[idx].logs);
  if(!toPlan)data[idx].snoozedUntil = null;
  else if(!fromPlan && pendingAction?.snoozedUntil !== undefined)data[idx].snoozedUntil = pendingAction.snoozedUntil;
  const snoozedUntilAfter = data[idx].snoozedUntil || null;
  if(!save(data))return false;
  showActionToast(label,{
    type:'replace-entry',
    idx,
    fromTs,
    fromPlan:Boolean(fromPlan),
    toTs,
    toPlan:Boolean(toPlan),
    snoozedUntilBefore,
    snoozedUntilAfter,
    openAction:false
  });
  refreshOpenViews();
  return true;
}

// HYBRID: log entry and show undo. opts: {value, minutes, note} for numeric / chunk / note logs.
function logTing(i,opts = {}){
  const data = load();
  const now = Date.now();
  if(!data[i])return false;
  const h = data[i];
  const logs = normalizeLogs(h.logs);
  const consumedPlanTs = planToConsumeForEntry(logs,now);
  let minutes = opts.minutes;
  if(minutes == null && h.breakable && !isAutoMark(h)){
    // Suggested chunk only — never the full remaining day on a bare tap.
    const next = typeof suggestedBreakableLogMinutes === 'function'
      ? suggestedBreakableLogMinutes(h,null)
      : null;
    if(next)minutes = next;
  }
  // Snap the stored ts to the habit's window-start for the log's day so a
  // habit logged late still counts as "done today" by rhythm math the next
  // time its window opens. See snapLogTimestamp in data.js.
  const entryTs = (typeof snapLogTimestamp === 'function') ? snapLogTimestamp(h,now) : now;
  const entry = makeActualLog(entryTs,{value:opts.value,minutes,note:opts.note});
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts:entryTs,
    plan:false,
    consumedPlanTs,
    snoozedUntil:h.snoozedUntil || null,
    entry
  });
  if(consumedPlanTs !== null){
    const pos = findEntryByKind(logs,consumedPlanTs,true);
    if(pos >= 0)logs.splice(pos,1);
  }
  h.logs = normalizeLogs([...logs,entry]);
  h.lastLog = latestActualLog(h.logs);
  h.snoozedUntil = null;
  if(typeof clearPlanByDateOnLog === 'function')clearPlanByDateOnLog(h);
  if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
  if(!save(data))return false;
  // Cancel any scheduled push for this completed task.
  if(typeof cancelPush === 'function' && h.type === 'task' && isTaskDone(h)){
    cancelPush(reminderSignature(h));
  }
  // Toast shows minutes + one detail (note preferred over value) so it never
  // overflows; the full value+note history lives in the activity sheet.
  const detail = (()=>{
    const parts = [];
    if(minutes)parts.push(`${minutes}m`);
    const noteStr = String(opts.note || '').trim();
    if(noteStr)parts.push(noteStr.slice(0,32));
    else if(opts.value != null && Number.isFinite(Number(opts.value)))parts.push(`${opts.value}`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  })();
  showActionToast(`Logged ${toastItemName(h)}${detail}`,action);
  // If a session timer was open for this habit, drop it — the entry already
  // covers the session and a later stop must not prompt a second log.
  if(typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === i
    && typeof clearHabitTimerSilent === 'function'){
    clearHabitTimerSilent();
  }
  return true;
}

// HYBRID: log entry at timestamp, show undo
function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
  // Calendar day logs are for today and past days only — future days use plans.
  if(dateKey(ts) > todayIso())return false;
  const entryTs = dateKey(ts) <= dateKey(Date.now()) && ts > Date.now() ? Date.now() : ts;
  const log = makeLog(entryTs);
  const isPlan = isPlanLog(log);
  const logs = normalizeLogs(data[i].logs);
  const consumedPlanTs = isPlan ? null : planToConsumeForEntry(logs,entryTs);
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts:entryTs,
    plan:isPlan,
    consumedPlanTs,
    snoozedUntil:data[i].snoozedUntil || null
  });
  if(consumedPlanTs !== null){
    const pos = findEntryByKind(logs,consumedPlanTs,true);
    if(pos >= 0)logs.splice(pos,1);
  }
  data[i].logs = normalizeLogs([...logs,log]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!isPlan){
    data[i].snoozedUntil = null;
    if(typeof clearPlanByDateOnLog === 'function')clearPlanByDateOnLog(data[i]);
    if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(data[i]);
  }
  if(!save(data))return false;
  showActionToast(`${isPlan ? 'Planned' : 'Logged'} ${toastItemName(data[i])}`,action);
  // Calendar day log counts as completing the session — drop any open timer.
  if(!isPlan && typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === i
    && typeof clearHabitTimerSilent === 'function'){
    clearHabitTimerSilent();
  }
  return true;
}

// HYBRID: add a planned entry for a specific date, optionally with a hard
// clock time and/or one-day location. Empty time → day pin only (noon ts,
// no timed flag). Set time → hard agenda appointment at that clock.
function planTingOnDay(i,key,timeValue = '',options = {}){
  const data = load();
  if(!data[i])return false;
  // Stop habits ("quit" type) cannot be planned — there is no future session
  // to schedule, only lapses to log. Bail before creating any plan log.
  if(data[i].type === 'zero')return false;
  // Plans are only for today and future days.
  if(!key || key < todayIso())return false;
  const base = new Date(`${key}T12:00:00`);
  if(Number.isNaN(base.getTime()))return false;
  let hours = 12;
  let minutes = 0;
  const time = timeInputToMinutes(timeValue);
  const timed = time !== null;
  if(timed){
    hours = Math.floor(time / 60);
    minutes = time % 60;
  }
  const ts = new Date(base.getFullYear(),base.getMonth(),base.getDate(),hours,minutes,0,0).getTime();
  const locationId = options.locationId != null ? String(options.locationId).trim() : '';
  const planEntry = makePlanLog(ts,{timed,locationId:locationId || null});
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts,
    plan:true,
    snoozedUntil:data[i].snoozedUntil || null,
    openAction:options.openAction
  });
  data[i].logs = normalizeLogs([...(data[i].logs || []),planEntry]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!save(data))return false;
  const timeLabel = timed ? ` · ${new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}` : '';
  const locName = locationId && typeof normalizeLocationRegistry === 'function'
    ? (normalizeLocationRegistry(sortSettings?.locations).find(l=>l.id === locationId)?.name || '')
    : '';
  const locLabel = locName ? ` · ${locName}` : '';
  showActionToast(`Planned ${toastItemName(data[i])}${timeLabel}${locLabel}`,action);
  return true;
}

// HYBRID: run the contextual secondary action shown in the action toast.
function runPendingAction(){
  if(!pendingAction || !Number.isInteger(pendingAction.idx))return;
  const action = pendingAction.toastAction;
  if(action === 'plan-instead'){
    replaceEntryKind(
      pendingAction.idx,
      pendingAction.ts,
      false,
      pendingAction.ts,
      true,
      'Planned instead'
    );
    return;
  }
  if(action === 'plan-today'){
    if(planTingOnDay(pendingAction.idx,todayIso()))refreshOpenViews();
    return;
  }
  if(action === 'complete-plan'){
    replaceEntryKind(
      pendingAction.idx,
      pendingAction.ts,
      true,
      Date.now(),
      false,
      'Marked done'
    );
    return;
  }
  if(action === 'keep-plan'){
    const data = load();
    const idx = pendingAction.idx;
    if(!data[idx] || !pendingAction.consumedPlanTs)return;
    data[idx].logs = normalizeLogs([...(data[idx].logs || []),{ts:pendingAction.consumedPlanTs,plan:true}]);
    data[idx].lastLog = latestActualLog(data[idx].logs);
    if(save(data)){
      showActionToast('Plan kept',{type:'entry',idx,ts:pendingAction.consumedPlanTs,plan:true,snoozedUntil:data[idx].snoozedUntil || null,openAction:false});
      refreshOpenViews();
    }
  }
}

// HYBRID: remove all planned entries for one item/day with a single undo.
function removePlansOnDay(idx,key){
  const data = load();
  const h = data[idx];
  if(!h)return false;
  const logs = normalizeLogs(h.logs);
  const removed = [];
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === key){
      removed.push(makePlanLog(logTime(log),{
        timed:planTimed(log),
        locationId:planLocationId(log)
      }));
      return false;
    }
    return true;
  });
  if(!removed.length)return false;
  h.logs = normalizeLogs(remaining);
  h.lastLog = latestActualLog(h.logs);
  if(!save(data))return false;
  const label = removed.length === 1 ? `Removed plan · ${toastItemName(h)}` : `Removed ${removed.length} plans · ${toastItemName(h)}`;
  showActionToast(label,{type:'remove-plans',idx,key,removed,openAction:false,undoLabel:'restore'});
  refreshOpenViews();
  return true;
}

// HYBRID: move all of a habit's planned entries on fromKey to toKey (preserving
// each entry's time of day), single save + single undo. The compound undo
// reverts both halves so the existing toast covers the whole move cleanly.
function movePlanTo(idx,fromKey,toKey){
  const data = load();
  const h = data[idx];
  if(!h || fromKey === toKey)return;
  // Plans can only move onto today or a future day.
  if(!toKey || toKey < todayIso())return;
  const logs = normalizeLogs(h.logs);
  const moved = [];
  const newDay = new Date(`${toKey}T00:00:00`);
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === fromKey){
      const old = new Date(logTime(log));
      const nt = new Date(newDay.getFullYear(),newDay.getMonth(),newDay.getDate(),old.getHours(),old.getMinutes(),0,0).getTime();
      moved.push({
        oldTs:logTime(log),
        newTs:nt,
        timed:planTimed(log),
        locationId:planLocationId(log)
      });
      return false;
    }
    return true;
  });
  if(!moved.length)return;
  moved.forEach(m=>remaining.push(makePlanLog(m.newTs,{timed:m.timed,locationId:m.locationId})));
  data[idx].logs = normalizeLogs(remaining);
  data[idx].lastLog = latestActualLog(data[idx].logs);
  if(save(data)){
    showActionToast(`Moved ${toastItemName(h)}`,{type:'move',idx,moved,openAction:false,undoLabel:'move back'});
    refreshOpenViews();
  }
}

// HYBRID: revert last action and refresh
function executeUndo(){
  if(!pendingAction)return;
  const refreshBlockedPresentation = pendingAction.type === 'restore-blocked'
    || pendingAction.type === 'restore-block-adjust';
  const data = load();
  if(pendingAction.type === 'entry'){
    const {idx,ts,snoozedUntil,consumedPlanTs} = pendingAction;
    if(!data[idx])return;
    const logs = normalizeLogs(data[idx].logs);
    const pos = findEntryByKind(logs,ts,Boolean(pendingAction.plan));
    if(pos >= 0)logs.splice(pos,1);
    if(consumedPlanTs)logs.push({ts:consumedPlanTs,plan:true});
    data[idx].logs = logs;
    data[idx].lastLog = latestActualLog(logs);
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingAction.type === 'hide'){
    const {idx,snoozedUntil} = pendingAction;
    if(!data[idx])return;
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingAction.type === 'delete'){
    const {idx,habit} = pendingAction;
    data.splice(Math.min(idx,data.length),0,habit);
  }
  if(pendingAction.type === 'move'){
    const {idx,moved} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      const newSet = new Set(moved.map(m=>m.newTs));
      const filtered = logs.filter(log=>!newSet.has(logTime(log)));
      moved.forEach(m=>filtered.push(makePlanLog(m.oldTs,{
        timed:Boolean(m.timed),
        locationId:m.locationId || null
      })));
      data[idx].logs = normalizeLogs(filtered);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(pendingAction.type === 'remove-plans'){
    const {idx,removed} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      removed.forEach(entry=>{
        if(entry && typeof entry === 'object' && entry.plan)logs.push(entry);
        else logs.push(makePlanLog(entry));
      });
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(pendingAction.type === 'replace-entry'){
    const {idx,fromTs,fromPlan,toTs,toPlan,snoozedUntilBefore} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      const pos = findEntryByKind(logs,toTs,toPlan);
      if(pos >= 0)logs.splice(pos,1);
      logs.push(fromPlan ? {ts:fromTs,plan:true} : fromTs);
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
      data[idx].snoozedUntil = snoozedUntilBefore;
    }
  }
  if(pendingAction.type === 'breakable-set'){
    const {idx,logs,snoozedUntil} = pendingAction;
    if(data[idx]){
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
      data[idx].snoozedUntil = snoozedUntil;
    }
  }
  if(pendingAction.type === 'restore-blocked'){
    lockBlockedCardActivation();
    const {dayKey,label,startMin,endMin,freedMin} = pendingAction;
    if(typeof restoreBlockedInstance === 'function')restoreBlockedInstance(dayKey,label,startMin,endMin);
    const s = loadSortSettings();
    const overrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
    if(Object.prototype.hasOwnProperty.call(overrides,dayKey)){
      // Reuse the same wraparound math as cancelHomeBlockedRow so overnight
      // blocks restore the exact minutes that were freed (not end−start < 0).
      const back = freedMin != null && Number.isFinite(freedMin)
        ? freedMin
        : (typeof blockDurationMinutes === 'function'
          ? blockDurationMinutes(startMin,endMin)
          : (endMin > startMin ? endMin - startMin : (1440 - startMin) + endMin));
      const restored = overrides[dayKey] - back;
      if(restored > 0)overrides[dayKey] = restored;
      else delete overrides[dayKey];
      saveSortSettings({...s,availabilityOverrides:overrides});
    }
  }
  if(pendingAction.type === 'restore-block-adjust'){
    lockBlockedCardActivation();
    const {dayKey,signature,previousOverride,hadAvailability,previousAvailability} = pendingAction;
    const s = loadSortSettings();
    const blockOverrides = normalizeBlockedTimeOverrides(s.blockedTimeOverrides);
    const day = {...(blockOverrides[dayKey] || {})};
    if(previousOverride)day[signature] = previousOverride;
    else delete day[signature];
    if(Object.keys(day).length)blockOverrides[dayKey] = day;
    else delete blockOverrides[dayKey];
    const availabilityOverrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
    if(hadAvailability)availabilityOverrides[dayKey] = previousAvailability;
    else delete availabilityOverrides[dayKey];
    saveSortSettings({...s,blockedTimeOverrides:blockOverrides,availabilityOverrides});
  }
  if(pendingAction.type === 'add-samples'){
    const hids = new Set((pendingAction.hids || []).filter(Boolean));
    for(let i = data.length - 1; i >= 0; i--){
      if(hids.has(data[i].hid))data.splice(i,1);
    }
    if(typeof pruneUnusedSamplePlaces === 'function'){
      const pruned = pruneUnusedSamplePlaces(data);
      data.length = 0;
      data.push(...pruned);
    }
  }
  if(save(data)){
    // Block undo changes only presentation/capacity immediately. Repaint those
    // rows from the mounted exact week before queueing the replacement solve,
    // mirroring cancelHomeBlockedRow and avoiding a stale missing/editable row.
    if(refreshBlockedPresentation && typeof renderHomePresentationOnly === 'function'){
      renderHomePresentationOnly();
    }
    hideActionToast();
    showToast('undone');
    if(typeof updateSortSampleCount === 'function')updateSortSampleCount();
    if(typeof refreshSampleHabitsSheet === 'function')refreshSampleHabitsSheet();
    refreshOpenViews();
  }
}

/**
 * HYBRID: set absolute breakable progress. Forward movement appends a minute
 * log; backward movement consolidates minute logs in the relevant scope while
 * preserving plans and non-minute entries.
 * Returns true when a log was saved.
 */
function commitBreakableProgress(i,targetMinutes,dayBase){
  const data = load();
  if(!data[i] || !data[i].breakable)return false;
  const h = data[i];
  const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h,dayBase) : 0;
  const total = typeof breakableTotalMinutes === 'function' ? breakableTotalMinutes(h) : clampDuration(h.durationMinutes);
  let target = Math.round(Number(targetMinutes));
  if(!Number.isFinite(target))target = done;
  target = Math.max(0,Math.min(total,target));
  if(target === done)return false;

  if(target > done){
    const delta = typeof breakableSliderDeltaMinutes === 'function'
      ? breakableSliderDeltaMinutes(h,target,dayBase)
      : (target - done);
    if(delta > 0)return logTing(i,{ minutes:delta });
    return false;
  }

  const logsBefore = normalizeLogs(h.logs);
  const snoozedUntil = h.snoozedUntil || null;
  const result = rewriteBreakableProgress(h,target,dayBase);
  if(result.mode !== 'set' || !save(data))return false;
  showActionToast(`Set ${toastItemName(h)} · ${target}m`,{
    type:'breakable-set',idx:i,logs:logsBefore,snoozedUntil,openAction:false
  });
  return true;
}

// PURE: read the pending target from a card, or compute its untouched quick-log
// advance. The agenda chunk is only used when it is a true partial placement.
function breakableCardIntent(h,card){
  const row = card && card.closest ? card.closest('.swipe-row') : null;
  const dirty = row && row.dataset.progressDirty === '1';
  const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0;
  const total = typeof breakableTotalMinutes === 'function' ? breakableTotalMinutes(h) : clampDuration(h.durationMinutes);
  let target = dirty && row ? Math.round(Number(row.dataset.progressTarget)) : done;
  if(!Number.isFinite(target))target = done;
  target = Math.max(0,Math.min(total,target));
  const chunk = row && row.dataset.chunkMinutes != null && row.dataset.chunkMinutes !== ''
    ? Math.round(Number(row.dataset.chunkMinutes))
    : null;
  const suggested = typeof suggestedBreakableLogMinutes === 'function'
    ? suggestedBreakableLogMinutes(h,chunk)
    : 0;
  return {row,dirty:dirty && target !== done,done,target,suggested};
}

/** HYBRID: commit a card's pending target, or advance by its quick-log amount. */
function commitBreakableFromCard(i,card){
  const h = load()[i];
  if(!h || !h.breakable)return false;
  const intent = breakableCardIntent(h,card);
  if(intent.dirty){
    if(intent.target <= intent.done){
      showToast('already done');
      return false;
    }
    return commitBreakableProgress(i,intent.target);
  }
  const suggested = typeof suggestedBreakableLogMinutes === 'function'
    ? intent.suggested
    : 0;
  if(!suggested || suggested <= 0){
    showToast('already done');
    return false;
  }
  return commitBreakableProgress(i,intent.done + suggested);
}

// HYBRID: log entry and flash card
function quickLog(i,card){
  const go = ()=>{
    if(card){
      card.classList.add('logged');
      setTimeout(()=>card.classList.remove('logged'),380);
    }
    setTimeout(refreshOpenViews, 260);
    // In week-on mode, render() keeps the mounted DOM while the planner
    // re-solves, so the just-logged card's done-state and the today "missed"
    // pill lag behind the log. Once the tap animation has played, repaint home
    // from the mounted plan so they update without waiting for the background
    // solve. No-op outside week mode (render() is already synchronous there).
    setTimeout(()=>{
      if(weekOnHomeEnabled(sortSettings || {}) && typeof renderHomePresentationOnly === 'function'){
        renderHomePresentationOnly();
      }
    }, 400);
  };
  const data = load();
  const h = data[i];
  if(h && h.breakable){
    if(h.trackValue && typeof requestLogTing === 'function'){
      const intent = breakableCardIntent(h,card);
      if(intent.dirty && intent.target <= intent.done){
        showToast('already done');
        return;
      }
      const minutes = intent.dirty ? intent.target - intent.done : intent.suggested;
      if(!minutes || minutes <= 0){
        showToast('already done');
        return;
      }
      requestLogTing(i,go,{ minutes });
      return;
    }
    if(!commitBreakableFromCard(i,card))return;
    go();
    return;
  }
  if(typeof requestLogTing === 'function'){
    requestLogTing(i,go);
    return;
  }
  if(!logTing(i))return;
  go();
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
