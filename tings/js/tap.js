// Shared tap recognition for home-list cards (habits, busy times, travel).
// WebKit often claims a still finger as the start of a pan-y scroll and fires
// pointercancel with no click. Recover that in one place so a new card calls
// bindTap instead of growing another pointer machine.
//
// A tap is little finger movement, no ancestor scroll, and a short hold.
// pointerup/cancel recovery and the later native click share a tap id, so
// they cannot double-fire. Native clicks activate immediately. A cancelled
// touch waits for finger release; a pan only suppresses its trailing click,
// never the next physical tap.

const TAP_MOVE_PX = 8;
const TAP_HOLD_MS = 650;
const TAP_RECOVER_MS = 60;
const TAP_PAN_IGNORE_MS = 500;

function tapScrollerSnapshot(fromEl, extraEls){
  const scrollers = [];
  const seen = new Set();
  function add(el){
    if(!el || seen.has(el))return;
    seen.add(el);
    scrollers.push({el,top:el.scrollTop,left:el.scrollLeft});
  }
  for(let el = fromEl; el; el = el.parentElement){
    if((el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1))add(el);
    if(el === document.documentElement)break;
  }
  (extraEls || []).forEach(add);
  scrollers.push({
    el:{get scrollTop(){return window.scrollY;},get scrollLeft(){return window.scrollX;}},
    top:window.scrollY,
    left:window.scrollX
  });
  return scrollers;
}

function tapScrollersMoved(scrollers, floor = 1){
  if(!scrollers)return false;
  for(let i = 0; i < scrollers.length; i++){
    const s = scrollers[i];
    if(Math.abs(s.el.scrollTop - s.top) > floor)return true;
    if(Math.abs(s.el.scrollLeft - s.left) > floor)return true;
  }
  return false;
}

function tapIsPan(tap, event, moveLimit, holdMs){
  const x = event && Number.isFinite(event.clientX) ? event.clientX : tap.x;
  const y = event && Number.isFinite(event.clientY) ? event.clientY : tap.y;
  const moved = Math.max(tap.maxMove, Math.hypot(x - tap.x, y - tap.y));
  if(moved > (moveLimit || TAP_MOVE_PX))return true;
  if((tap.endTime ?? Date.now()) - tap.time > (holdMs || TAP_HOLD_MS))return true;
  return tapScrollersMoved(tap.scrollers);
}

function bindTap(el, activate, opts){
  if(!el || typeof activate !== 'function')return;
  opts = opts || {};
  const ignoreSelector = opts.ignoreSelector || '';
  const moveLimit = opts.moveLimit || TAP_MOVE_PX;
  const holdMs = opts.holdMs || TAP_HOLD_MS;
  const stop = Boolean(opts.stop);
  let pointer = null;
  let recovery = null;
  let recoveryTimer = null;
  let openTapId = 0;
  let consumedId = 0;
  let ignoreUntil = 0;
  let seq = 1;

  function ignored(event){
    return ignoreSelector && event.target && event.target.closest
      && event.target.closest(ignoreSelector);
  }
  function halt(event){
    if(stop && event && typeof event.stopPropagation === 'function')event.stopPropagation();
  }
  function clearRecovery(){
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if(recovery && recovery.cleanup)recovery.cleanup();
    recovery = null;
  }
  function rejectPan(){
    clearRecovery();
    if(pointer && pointer.cleanup)pointer.cleanup();
    ignoreUntil = Date.now() + TAP_PAN_IGNORE_MS;
    openTapId = 0;
    pointer = null;
    if(el.dataset)el.dataset.ignoreClickUntil = String(ignoreUntil);
  }
  function fire(event, tapId){
    if(tapId != null){
      if(tapId === consumedId)return;
      consumedId = tapId;
    }
    activate(event);
  }
  function recover(tap){
    recovery = tap;
    clearTimeout(recoveryTimer);
    // pointercancel ends the pointer stream, not the physical touch. At a
    // scroll boundary a finger can keep dragging without changing scrollTop.
    if(tap.touchId != null && !tap.touchEnded)return;
    recoveryTimer = setTimeout(()=>{
      clearRecovery();
      if(!el.isConnected || Date.now() < ignoreUntil)return;
      if(tapIsPan(tap, null, moveLimit, holdMs)){rejectPan();return;}
      fire({target:tap.target, type:'click'}, tap.tapId);
    }, TAP_RECOVER_MS);
  }

  el.addEventListener('pointerdown', e=>{
    halt(e);
    if(ignored(e))return;
    if(e.pointerType === 'mouse' && e.button !== 0)return;
    if(e.pointerType === 'touch' && e.isPrimary === false){rejectPan();return;}
    clearRecovery();
    if(pointer && pointer.cleanup)pointer.cleanup();
    ignoreUntil = 0;
    if(el.dataset)delete el.dataset.ignoreClickUntil;
    openTapId = seq++;
    pointer = {
      id:e.pointerId,
      target:e.target,
      tapId:openTapId,
      x:e.clientX,
      y:e.clientY,
      maxMove:0,
      time:Date.now(),
      scrollers:tapScrollerSnapshot(el)
    };
  }, {passive:true});
  el.addEventListener('touchstart', e=>{
    if(!pointer || ignored(e))return;
    if(e.touches.length !== 1){rejectPan();return;}
    const tap = pointer;
    tap.touchId = e.changedTouches[0].identifier;
    tap.touchEnded = false;
    const onTouch = event=>{
      const touch = [...event.changedTouches].find(t=>t.identifier === tap.touchId);
      if(!touch)return;
      tap.maxMove = Math.max(tap.maxMove,Math.hypot(touch.clientX - tap.x,touch.clientY - tap.y));
      if(event.type === 'touchcancel' || event.touches.length > 1 || tapIsPan(tap, null, moveLimit, holdMs)){
        rejectPan();
        return;
      }
      if(event.type === 'touchend'){
        tap.endTime = Date.now();
        tap.touchEnded = true;
        tap.cleanup();
        if(recovery === tap)recover(tap);
      }
    };
    const events = ['touchmove','touchend','touchcancel'];
    // Capture continues after pointercancel, even if swipe code stops bubbling.
    events.forEach(name=>window.addEventListener(name,onTouch,{capture:true,passive:true}));
    const expiry = setTimeout(()=>{tap.cleanup();rejectPan();},holdMs);
    tap.cleanup = ()=>{
      clearTimeout(expiry);
      events.forEach(name=>window.removeEventListener(name,onTouch,true));
    };
  }, {passive:true});
  el.addEventListener('pointermove', e=>{
    if(!pointer || pointer.id !== e.pointerId)return;
    pointer.maxMove = Math.max(pointer.maxMove, Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y));
  }, {passive:true});
  el.addEventListener('pointerup', e=>{
    halt(e);
    if(!pointer || pointer.id !== e.pointerId)return;
    const tap = pointer;
    tap.endTime = Date.now();
    if(tapIsPan(tap, e, moveLimit, holdMs)){ rejectPan(); return; }
    pointer = null;
    recover(tap);
  });
  el.addEventListener('pointercancel', e=>{
    halt(e);
    if(!pointer || pointer.id !== e.pointerId)return;
    const tap = pointer;
    if(tap.touchId == null)tap.endTime = Date.now();
    if(tapIsPan(tap, e, moveLimit, holdMs)){ rejectPan(); return; }
    pointer = null;
    recover(tap);
  }, {passive:true});
  el.addEventListener('click', e=>{
    if(ignored(e))return;
    e.preventDefault();
    e.stopPropagation();
    if(Date.now() < ignoreUntil)return;
    if(Number(el.dataset && el.dataset.ignoreClickUntil || 0) > Date.now())return;
    if(recovery){
      if(tapIsPan(recovery, null, moveLimit, holdMs)){rejectPan();return;}
      if(recovery.touchId != null && !recovery.touchEnded)return;
      clearRecovery();
    }
    const tapId = openTapId || null;
    openTapId = 0;
    fire(e, tapId);
  });
}

function bindScrollSafeTap(el, activate, ignoreSelector){
  bindTap(el, activate, {ignoreSelector:ignoreSelector || ''});
}
