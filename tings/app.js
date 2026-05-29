const KEY = 'tings_v2';
const SORT_KEY = 'tings_sort_v1';
const HANDLE_UNTIL_KEY = 'tings_handle_until_v1';
const MAX_LOGS = 24;
const MAX_TINGS = 50;
const QUOTA_WARN_KB = 30;
const QUOTA_HARD_KB = 80;
const SWIPE_THRESHOLD = 60;
const SWIPE_REVEAL = 200;
const TAP_DELAY = 310;
const HANDLE_WINDOW_MS = 5 * 60 * 1000;

const $ = id => document.getElementById(id);

let pendingIdx = null;
let detailIdx = null;
let snoozeIdx = null;
let dayEntryIdx = null;
let dayEntryTs = null;
let selectedType = 'keepup';
let showSnoozed = false;
let sortMode = localStorage.getItem(SORT_KEY) || 'smart';
let handleUntil = parseInt(localStorage.getItem(HANDLE_UNTIL_KEY),10) || 0;

let swipeOpenCard = null;
let tapTimer = null;
let lastTap = {idx:-1,time:0};
let isDragging = false;
let dragSrcIdx = null;
let dragOverIdx = null;
let dragRows = [];
let dragDropIndex = null;
let dragStartY = 0;
let dragFrame = null;
let toastTimer = null;
let handleTimer = null;

function load(){
  try{return normalize(JSON.parse(localStorage.getItem(KEY)) || []);}
  catch{return [];}
}

function normalize(items){
  return items.map(h => ({
    name: h.name || '',
    type: h.type || 'keepup',
    target: h.type === 'zero' ? null : (h.target || 7),
    lastLog: h.lastLog || null,
    logs: Array.isArray(h.logs) ? h.logs.slice(-MAX_LOGS) : [],
    emoji: h.emoji || '',
    snoozedUntil: h.snoozedUntil || null
  }));
}

function save(data){
  try{
    const str = JSON.stringify(data);
    const kb = Math.round((str.length * 2) / 1024);
    localStorage.setItem(KEY,str);
    updateQuotaBar(kb);
    return true;
  }catch(e){
    alert('storage full - drop some tings first');
    return false;
  }
}

function sizeKb(data){return Math.round((JSON.stringify(data).length * 2) / 1024);}
function daysSince(ts){return ts ? Math.floor((Date.now() - ts) / 86400000) : null;}
function dayDistance(ts){return ts ? Math.round((Date.now() - ts) / 86400000) : null;}
function entryWhen(ts){
  const days = dayDistance(ts);
  if(days === null)return 'not yet';
  if(days < 0)return `in ${Math.abs(days)}d`;
  if(days === 0)return 'today';
  return `${days}d ago`;
}
function todayIso(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateKey(ts){
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function markSegments(value){
  const text = value.trim();
  if(Intl.Segmenter){
    return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(item=>item.segment);
  }
  return Array.from(text);
}

function cleanMark(value){
  return markSegments(value).slice(0,2).join('');
}

function avgInterval(logs){
  if(!logs || logs.length < 2)return null;
  const sorted = [...logs].sort((a,b)=>a-b);
  let sum = 0;
  for(let i=1;i<sorted.length;i++)sum += sorted[i] - sorted[i-1];
  return Math.round(sum / (sorted.length - 1) / 86400000);
}

function currentRun(h){
  const logs = [...(h.logs || [])].sort((a,b)=>b-a);
  const days = daysSince(h.lastLog);
  if(h.type !== 'keepup'){
    return {num:days === null ? '-' : Math.max(0,days),label:'clear'};
  }
  if(!logs.length)return {num:'-',label:'run'};
  const targetMs = (h.target || 7) * 86400000;
  if(days !== null && days > (h.target || 7))return {num:0,label:'run'};
  let run = 1;
  for(let i=0;i<logs.length - 1;i++){
    if(logs[i] - logs[i + 1] <= targetMs)run += 1;
    else break;
  }
  return {num:run,label:'run'};
}

function updateQuotaBar(kb){
  const bar = $('quota-bar');
  if(kb >= QUOTA_WARN_KB){
    bar.style.display = 'block';
    bar.textContent = `storage: ~${kb} KB`;
  }else{
    bar.style.display = 'none';
  }
}

function defaultIcon(type){
  if(type === 'zero')return 'ti-flame-off';
  if(type === 'reduce')return 'ti-trending-down';
  return 'ti-heart';
}

function tone(days,target,type){
  if(type === 'zero'){
    if(days === null)return 'purple';
    if(days === 0)return 'red';
    if(days < 3)return 'amber';
    return 'teal';
  }
  if(days === null)return 'quiet';
  const ratio = days / target;
  if(type === 'keepup')return ratio < 0.75 ? 'teal' : ratio < 1.1 ? 'amber' : 'red';
  return ratio > 1.5 ? 'teal' : ratio > 0.9 ? 'amber' : 'red';
}

function colors(days,target,type){
  const t = tone(days,target,type);
  const map = {
    teal:{bg:'var(--teal-bg)',icon:'var(--teal-icon)',chipBg:'var(--teal-bg)',chipColor:'var(--teal-text)'},
    amber:{bg:'var(--amber-bg)',icon:'var(--amber-icon)',chipBg:'var(--amber-bg)',chipColor:'var(--amber-text)'},
    red:{bg:'var(--red-bg)',icon:'var(--red-icon)',chipBg:'var(--red-bg)',chipColor:'var(--red-text)'},
    purple:{bg:'var(--purple-bg)',icon:'var(--purple-icon)',chipBg:'var(--purple-bg)',chipColor:'var(--purple-text)'},
    quiet:{bg:'var(--bg2)',icon:'var(--text3)',chipBg:null,chipColor:null}
  };
  return map[t];
}

function vibe(days,target,type){
  if(type === 'zero'){
    if(days === null)return 'clean slate';
    if(days === 0)return 'slipped';
    if(days < 3)return 'recent';
    return 'holding';
  }
  if(days === null)return null;
  const ratio = days / target;
  if(type === 'keepup')return ratio < 0.75 ? 'fresh' : ratio < 1.1 ? 'soon' : 'overdue';
  return ratio > 1.5 ? 'clear' : ratio > 0.9 ? 'watch' : 'hot';
}

function metaLine(h){
  const days = daysSince(h.lastLog);
  const parts = [];
  if(h.snoozedUntil && Date.now() < h.snoozedUntil){
    parts.push(`snoozed ${Math.ceil((h.snoozedUntil - Date.now()) / 86400000)}d`);
  }else{
    parts.push(entryWhen(h.lastLog));
    if(h.type !== 'zero' && h.target)parts.push(`every ${h.target}d`);
  }
  return parts;
}

function attentionScore(h,index){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return -1000 - index;
  const days = daysSince(h.lastLog);
  const target = h.target || 7;

  if(h.type === 'keepup'){
    if(days === null)return 130 - index / 100;
    const ratio = days / target;
    if(ratio >= 1)return 260 + Math.min(55,ratio * 14) - index / 100;
    if(ratio >= 0.75)return 185 + ratio * 35 - index / 100;
    return 70 + ratio * 70 - index / 100;
  }

  if(h.type === 'reduce'){
    if(days === null)return 38 - index / 100;
    const ratio = days / target;
    if(ratio >= 1.25)return 92 + Math.min(24,(ratio - 1.25) * 18) - index / 100;
    if(ratio >= 1)return 68 + ratio * 12 - index / 100;
    if(ratio >= 0.75)return 42 + ratio * 12 - index / 100;
    return 18 + ratio * 20 - index / 100;
  }

  if(h.type === 'zero'){
    if(days === null)return 10 - index / 100;
    if(days < 0)return 8 - index / 100;
    if(days === 0)return 24 - index / 100;
    if(days < 3)return 18 - index / 100;
    return Math.max(4,14 - days / 3) - index / 100;
  }

  if(days === null)return 20 - index / 100;
  const ratio = days / target;
  return ratio >= 1 ? 80 + ratio : ratio * 40;
}

function visibleIndices(data){
  const indices = data.map((_,i)=>i).filter(i=>{
    const h = data[i];
    return !(h.snoozedUntil && Date.now() < h.snoozedUntil && !showSnoozed);
  });
  if(sortMode === 'smart'){
    indices.sort((a,b)=>attentionScore(data[b],b) - attentionScore(data[a],a));
  }
  return indices;
}

function iconHtml(h,c){
  if(h.emoji)return `<span class="emoji-mark">${escapeHtml(h.emoji)}</span>`;
  return `<i class="ti ${defaultIcon(h.type)}" style="color:${c.icon};" aria-hidden="true"></i>`;
}

function extendHandleWindow(){
  handleUntil = Date.now() + HANDLE_WINDOW_MS;
  localStorage.setItem(HANDLE_UNTIL_KEY,String(handleUntil));
}

function handlesVisible(){
  return sortMode === 'manual' && Date.now() < handleUntil;
}

function scheduleHandleExpiry(){
  clearTimeout(handleTimer);
  if(!handlesVisible())return;
  handleTimer = setTimeout(render,Math.max(0,handleUntil - Date.now()) + 50);
}

function setSortMode(mode){
  sortMode = mode;
  localStorage.setItem(SORT_KEY,mode);
  if(mode === 'manual')extendHandleWindow();
  updateSortButton();
}

function updateSortButton(){
  const btn = $('toggle-sort');
  const icon = btn.querySelector('i');
  btn.classList.toggle('is-on',sortMode === 'manual');
  btn.dataset.mode = sortMode;
  icon.className = sortMode === 'smart' ? 'ti ti-arrows-sort' : 'ti ti-list';
  btn.setAttribute('aria-label',sortMode === 'smart' ? 'smart order' : 'hand order');
}

function render(){
  const data = load();
  const list = $('list');
  const empty = $('empty');
  list.innerHTML = '';
  empty.onclick = null;
  updateQuotaBar(sizeKb(data));
  updateSortButton();

  const indices = visibleIndices(data);
  list.classList.toggle('handles-visible',handlesVisible());
  scheduleHandleExpiry();
  if(!indices.length){
    empty.style.display = 'block';
    empty.classList.toggle('is-action',data.length > 0);
    if(data.length){
      empty.innerHTML = 'snoozed for now<br><span class="empty-sub">tap to peek</span>';
      empty.onclick = ()=>{showSnoozed = true;render();};
    }else{
      empty.innerHTML = 'noting tracked yet<br><span class="empty-sub">tap + to add your first ting</span>';
    }
    return;
  }
  empty.classList.remove('is-action');
  empty.style.display = 'none';

  indices.forEach(realIdx=>{
    const h = data[realIdx];
    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const v = vibe(days,h.target,h.type);
    const parts = metaLine(h);
    const chipHtml = v ? `<span class="chip" style="background:${c.chipBg};color:${c.chipColor};">${v}</span>` : '';

    const row = document.createElement('div');
    row.className = 'swipe-row';
    row.dataset.realIdx = realIdx;
    row.innerHTML = `
      <div class="swipe-actions">
        <button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>gone</button>
      </div>
      <div class="ting-card${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}" data-real="${realIdx}">
        <span class="drag-handle" aria-label="drag"><i class="ti ti-grip-vertical" aria-hidden="true"></i></span>
        <button class="pulse-btn" data-pulse="${realIdx}" aria-label="add entry for ${escapeHtml(h.name)}" style="background:${c.bg};color:${c.icon};">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0;">
            <span class="ting-name">${escapeHtml(h.name)}</span>${chipHtml}
          </div>
          <div class="ting-meta" aria-label="status">
            ${parts.map((p,i)=>i===0?`<span>${escapeHtml(p)}</span>`:`<span class="dot">·</span><span>${escapeHtml(p)}</span>`).join('')}
          </div>
        </div>
      </div>`;

    list.appendChild(row);
    setupSwipe(row);
    setupDrag(row,realIdx);
    setupCardTap(row,realIdx);
  });

  list.querySelectorAll('[data-pulse]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      openConfirm(+btn.dataset.pulse);
    });
  });

  list.querySelectorAll('.swipe-action').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      closeAllSwipes();
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
    });
  });
}

function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const actions = row.querySelector('.swipe-actions');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;

  row.addEventListener('touchstart',e=>{
    if(isDragging)return;
    if(e.target.closest('.drag-handle'))return;
    const t = e.changedTouches[0];
    touchId = t.identifier;startX = t.clientX;startY = t.clientY;dx = 0;moved = false;
    if(swipeOpenCard && swipeOpenCard !== card){
      swipeOpenCard.style.transform = '';
      swipeOpenCard = null;
    }
  },{passive:true});

  row.addEventListener('touchmove',e=>{
    if(isDragging)return;
    if(e.target.closest('.drag-handle'))return;
    const t = [...e.changedTouches].find(item=>item.identifier === touchId);
    if(!t)return;
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;
    if(!moved && Math.abs(ddy) > Math.abs(ddx))return;
    moved = true;dx = ddx;
    if(dx > 0)return;
    const clamped = Math.max(-SWIPE_REVEAL,dx);
    card.style.transition = 'none';
    card.style.transform = `translateX(${clamped}px)`;
    const pct = Math.min(1,Math.abs(clamped) / SWIPE_REVEAL);
    actions.style.width = `${Math.abs(clamped)}px`;
    actions.style.pointerEvents = pct > 0.2 ? 'auto' : 'none';
  },{passive:true});

  row.addEventListener('touchend',()=>{
    if(isDragging || !moved)return;
    const snap = dx < -SWIPE_THRESHOLD;
    card.style.transition = 'transform 0.22s cubic-bezier(.25,.46,.45,.94)';
    if(snap){
      card.style.transform = `translateX(-${SWIPE_REVEAL}px)`;
      actions.style.width = `${SWIPE_REVEAL}px`;
      actions.style.pointerEvents = 'auto';
      swipeOpenCard = card;
    }else{
      card.style.transform = '';
      actions.style.width = '0';
      actions.style.pointerEvents = 'none';
      swipeOpenCard = null;
    }
  });
}

function closeAllSwipes(){
  document.querySelectorAll('.swipe-row').forEach(row=>{
    const card = row.querySelector('.ting-card');
    const actions = row.querySelector('.swipe-actions');
    if(card){
      card.style.transition = 'transform 0.22s cubic-bezier(.25,.46,.45,.94)';
      card.style.transform = '';
    }
    if(actions){
      actions.style.width = '0';
      actions.style.pointerEvents = 'none';
    }
  });
  swipeOpenCard = null;
}

function setupDrag(row,realIdx){
  const card = row.querySelector('.ting-card');
  const handle = card.querySelector('.drag-handle');
  let timer = null;
  let startY = 0;
  let pointerId = null;

  function clear(){clearTimeout(timer);timer = null;}

  handle.addEventListener('pointerdown',e=>{
    if(swipeOpenCard)return;
    pointerId = e.pointerId;
    startY = e.clientY;
    handle.setPointerCapture(pointerId);
    timer = setTimeout(()=>beginDrag(row,realIdx,startY),260);
  });

  handle.addEventListener('pointermove',e=>{
    if(!isDragging && Math.abs(e.clientY - startY) > 8)clear();
    if(isDragging)moveDrag(row,e.clientY);
  });

  handle.addEventListener('pointerup',()=>{
    clear();
    if(isDragging)endDrag(row);
  });

  handle.addEventListener('pointercancel',()=>{
    clear();
    if(isDragging)endDrag(row);
  });
}

function beginDrag(row,realIdx,startY){
  closeAllSwipes();
  isDragging = true;
  document.body.classList.add('drag-active');
  row.classList.add('dragging');
  dragSrcIdx = realIdx;
  dragOverIdx = null;
  dragStartY = startY;
  dragDropIndex = [...document.querySelectorAll('.swipe-row')].indexOf(row);
  dragRows = [...document.querySelectorAll('.swipe-row')].map((item,index)=>{
    const rect = item.getBoundingClientRect();
    return {
      index,
      realIdx:+item.dataset.realIdx,
      center:rect.top + rect.height / 2
    };
  });
  row.dataset.dragStartY = String(startY);
  const card = row.querySelector('.ting-card');
  card.style.transition = 'none';
  card.classList.add('dragging-ghost');
  if(navigator.vibrate)navigator.vibrate(25);
}

function moveDrag(row,currentY){
  const card = row.querySelector('.ting-card');
  if(dragFrame)cancelAnimationFrame(dragFrame);
  dragFrame = requestAnimationFrame(()=>{
    card.style.transition = 'none';
    card.style.transform = `translate3d(0,${currentY - dragStartY}px,0)`;
    card.style.zIndex = 20;
  });

  const otherRows = dragRows.filter(item=>item.realIdx !== dragSrcIdx);
  const deadZone = 18;
  let nextDropIndex = 0;
  otherRows.forEach(item=>{
    if(currentY > item.center + deadZone)nextDropIndex += 1;
  });
  if(dragDropIndex !== null && Math.abs(nextDropIndex - dragDropIndex) === 1){
    const boundary = otherRows[Math.min(nextDropIndex,dragDropIndex)]?.center;
    if(boundary !== undefined && Math.abs(currentY - boundary) < deadZone * 2){
      nextDropIndex = dragDropIndex;
    }
  }
  dragDropIndex = nextDropIndex;

  const sourceOrderIndex = dragRows.find(item=>item.realIdx === dragSrcIdx)?.index ?? 0;
  const targetOrderIndex = nextDropIndex >= sourceOrderIndex ? nextDropIndex + 1 : nextDropIndex;
  const overRow = dragRows.find(item=>item.index === targetOrderIndex && item.realIdx !== dragSrcIdx);
  document.querySelectorAll('.ting-card').forEach(c=>c.classList.remove('drag-over'));
  if(overRow){
    document.querySelector(`.swipe-row[data-real-idx="${overRow.realIdx}"] .ting-card`)?.classList.add('drag-over');
    dragOverIdx = overRow.realIdx;
  }else{
    dragOverIdx = null;
  }
}

function endDrag(row){
  const card = row.querySelector('.ting-card');
  if(dragFrame)cancelAnimationFrame(dragFrame);
  dragFrame = null;
  isDragging = false;
  document.body.classList.remove('drag-active');
  row.classList.remove('dragging');
  card.style.transform = '';
  card.style.transition = '';
  card.style.zIndex = '';
  card.classList.remove('dragging-ghost');
  document.querySelectorAll('.ting-card').forEach(c=>c.classList.remove('drag-over'));

  const currentOrder = visibleIndices(load());
  const from = currentOrder.indexOf(dragSrcIdx);
  if(dragDropIndex !== null && from >= 0 && dragDropIndex !== from){
    const data = reorderByVisibleOrder(load(),dragSrcIdx,dragDropIndex);
    setSortMode('manual');
    extendHandleWindow();
    save(data);
    showToast('hand order');
  }
  dragSrcIdx = null;
  dragOverIdx = null;
  dragRows = [];
  dragDropIndex = null;
  dragStartY = 0;
  render();
}

function reorderByVisibleOrder(data,sourceIdx,targetPosition){
  const order = visibleIndices(data);
  const from = order.indexOf(sourceIdx);
  if(from < 0)return data;
  const nextOrder = [...order];
  nextOrder.splice(from,1);
  const to = Math.max(0,Math.min(targetPosition,nextOrder.length));
  if(from === to)return data;
  nextOrder.splice(to,0,sourceIdx);
  const hidden = data.map((_,i)=>i).filter(i=>!nextOrder.includes(i));
  return [...nextOrder,...hidden].map(i=>data[i]);
}

function setupCardTap(row,realIdx){
  const card = row.querySelector('.ting-card');
  card.addEventListener('click',e=>{
    if(e.target.closest('.pulse-btn') || e.target.closest('.drag-handle'))return;
    if(swipeOpenCard){closeAllSwipes();return;}
    const now = Date.now();
    if(lastTap.idx === realIdx && now - lastTap.time < TAP_DELAY){
      clearTimeout(tapTimer);
      lastTap = {idx:-1,time:0};
      quickLog(realIdx,card);
    }else{
      lastTap = {idx:realIdx,time:now};
      clearTimeout(tapTimer);
      tapTimer = setTimeout(()=>openDetail(realIdx),TAP_DELAY);
    }
  });
}

function logTing(i){
  const data = load();
  const now = Date.now();
  if(!data[i])return false;
  data[i].lastLog = now;
  data[i].logs = [...(data[i].logs || []),now].slice(-MAX_LOGS);
  data[i].snoozedUntil = null;
  return save(data);
}

function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
  const entryTs = Math.min(ts,Date.now());
  data[i].logs = [...(data[i].logs || []),entryTs].sort((a,b)=>a-b).slice(-MAX_LOGS);
  data[i].lastLog = Math.max(...data[i].logs);
  data[i].snoozedUntil = null;
  return save(data);
}

function quickLog(i,card){
  if(!logTing(i))return;
  if(card){
    card.classList.add('logged');
    setTimeout(()=>card.classList.remove('logged'),520);
  }
  showToast('planted');
  setTimeout(render,540);
}

function openConfirm(i){
  const h = load()[i];
  if(!h)return;
  pendingIdx = i;
  const days = daysSince(h.lastLog);
  $('confirm-name').textContent = h.name;
  $('confirm-sub').textContent = days === null ? 'first time?' : `last entry ${entryWhen(h.lastLog)}`;
  openSheet('confirm-sheet');
}

function openDetail(i){
  const h = load()[i];
  if(!h)return;
  detailIdx = i;
  const days = daysSince(h.lastLog);
  const c = colors(days,h.target,h.type);
  $('detail-name').textContent = h.name;
  $('detail-sub').textContent = metaLine(h).join(' · ');
  $('detail-about').textContent = aboutText(h);
  $('detail-trend').textContent = trendText(h);
  $('detail-emoji').value = h.emoji || '';
  $('detail-days').value = h.target || '';
  $('detail-slider-row').style.display = h.type === 'zero' ? 'none' : 'flex';
  $('detail-target-help').style.display = h.type === 'zero' ? 'none' : 'block';
  $('detail-target-help').textContent = rhythmHelp(h.type);
  syncRhythm('detail',h.target || 7);
  $('detail-mark').style.background = c.bg;
  $('detail-mark').style.color = c.icon;
  $('detail-mark').setAttribute('aria-label',`add entry for ${h.name}`);
  $('detail-mark').innerHTML = iconHtml(h,c);
  renderStats(h);
  renderGraph(h);
  renderCalendar(h);
  openSheet('detail-sheet');
}

function renderStats(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  const total = h.logs?.length || 0;
  const run = currentRun(h);
  const gapNum = days === null ? '-' : days < 0 ? Math.abs(days) : days;
  const gapLabel = days < 0 ? 'away' : 'gap';
  $('detail-stats').innerHTML = `
    <div class="stat"><div class="stat-num">${gapNum}</div><div class="stat-label">${gapLabel}</div></div>
    <div class="stat"><div class="stat-num">${avg === null ? '-' : avg}</div><div class="stat-label">pace</div></div>
    <div class="stat"><div class="stat-num">${run.num}</div><div class="stat-label">${run.label}</div></div>
    <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">entries</div></div>`;
}

function aboutText(h){
  const days = daysSince(h.lastLog);
  if(h.type === 'zero'){
    if(days === null)return 'You are keeping this off the board.';
    if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
    if(days === 0)return 'Entry today. Reset, then keep moving.';
    return `${days} clean days since the last entry.`;
  }
  const target = h.target || 7;
  if(days === null)return `Aim for about every ${target} days.`;
  if(days < 0)return `Next entry is ${entryWhen(h.lastLog)}.`;
  const when = entryWhen(h.lastLog);
  if(h.type === 'keepup')return days <= target ? `Last entry was ${when}. Still in rhythm.` : `Last entry was ${when}. Time to bring it back.`;
  return days >= target ? `${days} days clear. Keep the gap wide.` : `Entry was ${when}. Let it cool.`;
}

function trendText(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  if(days === null)return 'no entries yet';
  if(days < 0)return 'coming up';
  if(h.type === 'zero'){
    if(days === 0)return 'fresh slip';
    if(days < 3)return 'settling';
    return 'clean streak';
  }
  const target = h.target || 7;
  const pace = avg || days;
  if(h.type === 'keepup'){
    if(days > target)return 'due now';
    return pace <= target ? 'on pace' : 'drifting';
  }
  if(days < target)return 'too warm';
  return pace >= target ? 'cooling down' : 'watch it';
}

function renderGraph(h){
  const graph = $('detail-graph');
  const logs = [...(h.logs || [])].sort((a,b)=>a-b);
  if(!logs.length){
    graph.innerHTML = '<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>';
    return;
  }
  const intervals = logs.map((ts,i)=>i === 0 ? Math.max(1,daysSince(ts) || 1) : Math.max(1,Math.round((ts - logs[i-1]) / 86400000)));
  const max = Math.max(...intervals,h.target || 7,1);
  graph.innerHTML = intervals.slice(-12).map(days=>{
    const height = Math.max(12,Math.round((days / max) * 100));
    let cls = 'hit';
    if(h.type === 'keepup')cls = days <= (h.target || 7) ? 'hit' : 'miss';
    if(h.type === 'reduce')cls = days >= (h.target || 7) ? 'hit' : 'warn';
    if(h.type === 'zero')cls = days >= 3 ? 'hit' : 'miss';
    return `<div class="bar ${cls}" style="height:${height}%"></div>`;
  }).join('');
}

function renderCalendar(h){
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year,month,1);
  const last = new Date(year,month + 1,0);
  const logs = [...(h.logs || [])];
  const loggedDays = new Set(logs.map(dateKey));
  const monthEntries = logs.filter(ts=>{
    const d = new Date(ts);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;
  const label = first.toLocaleDateString(undefined,{month:'short',year:'numeric'});
  $('detail-calendar-label').textContent = `${label} · ${monthEntries}`;

  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:first.getDay()},()=>'<div class="cal-day blank"></div>');
  const today = dateKey(Date.now());
  const toneClass = h.type === 'zero' ? 'miss' : h.type === 'reduce' ? 'warn' : 'hit';
  const days = Array.from({length:last.getDate()},(_,i)=>{
    const date = new Date(year,month,i + 1);
    const key = dateKey(date.getTime());
    const cls = [
      loggedDays.has(key) ? toneClass : '',
      key === today ? 'today' : '',
      date.getTime() <= Date.now() ? 'pickable' : ''
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-entry-day="${key}" ${date.getTime() > Date.now() ? 'disabled' : ''}>${i + 1}</button>`;
  });
  $('detail-calendar').innerHTML = [...heads,...blanks,...days].join('');
}

function monthFrame(){
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year,month,1);
  const last = new Date(year,month + 1,0);
  const label = first.toLocaleDateString(undefined,{month:'short',year:'numeric'});
  return {year,month,first,last,label,today:dateKey(Date.now())};
}

function entryTone(type){
  if(type === 'zero')return 'miss';
  if(type === 'reduce')return 'warn';
  return 'hit';
}

function renderOverview(){
  const data = load();
  const frame = monthFrame();
  const byDay = new Map();
  let total = 0;
  data.forEach(h=>{
    (h.logs || []).forEach(ts=>{
      const d = new Date(ts);
      if(d.getFullYear() !== frame.year || d.getMonth() !== frame.month)return;
      const key = dateKey(ts);
      if(!byDay.has(key))byDay.set(key,[]);
      byDay.get(key).push({name:h.name,type:h.type});
      total += 1;
    });
  });

  $('overview-copy').textContent = data.length ? `${total} entries across ${data.length} tings.` : 'month view across every ting.';
  $('overview-calendar-label').textContent = frame.label;
  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:frame.first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:frame.last.getDate()},(_,i)=>{
    const date = new Date(frame.year,frame.month,i + 1);
    const key = dateKey(date.getTime());
    const entries = byDay.get(key) || [];
    const dots = entries.slice(0,3).map(item=>`<span class="cal-dot ${entryTone(item.type)}"></span>`).join('');
    const more = entries.length > 3 ? `<span class="cal-more">+${entries.length - 3}</span>` : '';
    const cls = key === frame.today ? 'today' : '';
    return `<div class="cal-day ${cls}"><span>${i + 1}</span><span class="cal-dots">${dots}</span>${more}</div>`;
  });
  $('overview-calendar').innerHTML = [...heads,...blanks,...days].join('');

  const monthRows = data.map(h=>{
    const count = (h.logs || []).filter(ts=>{
      const d = new Date(ts);
      return d.getFullYear() === frame.year && d.getMonth() === frame.month;
    }).length;
    const c = colors(daysSince(h.lastLog),h.target,h.type);
    return {h,count,c};
  }).filter(item=>item.count > 0).sort((a,b)=>b.count - a.count).slice(0,8);

  $('overview-list').innerHTML = monthRows.length ? monthRows.map(({h,count,c})=>`
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('') : '<div class="overview-item"><span class="overview-name">quiet month</span><span class="overview-meta">no entries yet</span></div>';
}

function openSnooze(i){
  const h = load()[i];
  if(!h)return;
  snoozeIdx = i;
  $('snooze-name').textContent = h.name;
  openSheet('snooze-sheet');
}

function doSnooze(i,days){
  const data = load();
  if(!data[i])return;
  data[i].snoozedUntil = Date.now() + days * 86400000;
  save(data);
  showToast(`snoozed ${days}d`);
  render();
}

function doNuke(i){
  const data = load();
  data.splice(i,1);
  save(data);
  showToast('gone');
  render();
}

function openDayEntry(i,key){
  const h = load()[i];
  if(!h)return;
  dayEntryIdx = i;
  dayEntryTs = new Date(`${key}T12:00:00`).getTime();
  $('day-entry-name').textContent = h.name;
  $('day-entry-sub').textContent = `add entry for ${new Date(dayEntryTs).toLocaleDateString(undefined,{month:'short',day:'numeric'})}?`;
  openSheet('day-entry-sheet');
}

function updateKeyboardLift(){
  const addOpen = $('add-sheet').classList.contains('open');
  if(!addOpen || !window.visualViewport){
    document.documentElement.style.setProperty('--keyboard-lift','0px');
    return;
  }
  const keyboard = Math.max(0,window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
  document.documentElement.style.setProperty('--keyboard-lift',`${keyboard}px`);
}

function keepFocusedInputVisible(){
  const active = document.activeElement;
  if(!active || !$('add-sheet').contains(active))return;
  active.scrollIntoView({block:'center',inline:'nearest'});
}

function openSheet(id){
  $(id).classList.add('open');
  updateKeyboardLift();
}
function closeSheet(id){
  $(id).classList.remove('open');
  if(id === 'add-sheet')updateKeyboardLift();
}

function showToast(text){
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove('show'),900);
}

function cancelAdd(){
  closeSheet('add-sheet');
  $('ting-name').value = '';
  $('ting-emoji').value = '';
  $('ting-days').value = '7';
  syncRhythm('ting',7);
  selectedType = 'keepup';
  document.querySelectorAll('#type-seg .seg-opt').forEach((o,i)=>o.classList.toggle('on',i === 0));
  $('target-slider-row').style.display = 'flex';
  $('target-help').style.display = 'block';
  $('target-help').textContent = rhythmHelp(selectedType);
}

$('toggle-sort').addEventListener('click',()=>{
  setSortMode(sortMode === 'smart' ? 'manual' : 'smart');
  showToast(sortMode === 'smart' ? 'smart order' : 'hand order');
  render();
});

$('type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-v]');
  if(!opt)return;
  selectedType = opt.dataset.v;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
  $('target-slider-row').style.display = selectedType === 'zero' ? 'none' : 'flex';
  $('target-help').style.display = selectedType === 'zero' ? 'none' : 'block';
  $('target-help').textContent = rhythmHelp(selectedType);
});

$('open-add').addEventListener('click',()=>{
  openSheet('add-sheet');
  $('ting-name').focus({preventScroll:true});
  setTimeout(()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  },260);
});

$('do-cancel').addEventListener('click',cancelAdd);
$('add-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)cancelAdd();});

$('do-save').addEventListener('click',()=>{
  const name = $('ting-name').value.trim();
  if(!name){$('ting-name').focus();return;}
  const data = load();
  if(data.length >= MAX_TINGS){alert(`${MAX_TINGS} tings max`);return;}
  if(sizeKb(data) >= QUOTA_HARD_KB){alert('storage ceiling');return;}
  const target = selectedType === 'zero' ? null : Math.max(1,Math.min(90,parseInt($('ting-days').value,10) || 7));
  data.push({name:name.slice(0,60),type:selectedType,target,lastLog:null,logs:[],emoji:cleanMark($('ting-emoji').value)});
  if(save(data)){cancelAdd();showToast('new ting');render();}
});

$('ting-name').addEventListener('keydown',e=>{if(e.key === 'Enter')$('do-save').click();});

function clampRhythm(value){
  return Math.max(1,Math.min(90,parseInt(value,10) || 7));
}

function rhythmHelp(type){
  if(type === 'reduce')return 'rhythm is the gap you want before it happens again.';
  return 'rhythm is about how many days between entries.';
}

function syncRhythm(prefix,value){
  const days = clampRhythm(value);
  $(`${prefix}-days`).value = days;
  $(`${prefix}-days-slider`).value = days;
  const label = $(`${prefix}-days-label`);
  if(label)label.textContent = `${days}d`;
}

function bindRhythm(prefix){
  const field = $(`${prefix}-days`);
  const slider = $(`${prefix}-days-slider`);
  const label = $(`${prefix}-days-label`);

  field.addEventListener('input',e=>{
    const typed = e.target.value.replace(/\D/g,'').slice(0,2);
    e.target.value = typed;
    if(!typed)return;
    const days = clampRhythm(typed);
    slider.value = days;
    if(label)label.textContent = `${days}d`;
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.was = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>syncRhythm(prefix,e.target.value));
  slider.addEventListener('input',e=>syncRhythm(prefix,e.target.value));
}

bindRhythm('ting');
bindRhythm('detail');

function bindMarkLimit(id){
  $(id).addEventListener('input',e=>{
    const limited = cleanMark(e.target.value);
    if(e.target.value !== limited)e.target.value = limited;
  });
}

bindMarkLimit('ting-emoji');
bindMarkLimit('detail-emoji');

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  });
  window.visualViewport.addEventListener('scroll',updateKeyboardLift);
}

$('confirm-yes').addEventListener('click',()=>{
  if(pendingIdx === null)return;
  logTing(pendingIdx);
  pendingIdx = null;
  closeSheet('confirm-sheet');
  showToast('planted');
  render();
});
$('confirm-no').addEventListener('click',()=>{pendingIdx = null;closeSheet('confirm-sheet');});
$('confirm-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){pendingIdx = null;closeSheet('confirm-sheet');}});

$('detail-save').addEventListener('click',()=>{
  if(detailIdx === null)return;
  const data = load();
  const h = data[detailIdx];
  if(!h)return;
  h.emoji = cleanMark($('detail-emoji').value);
  if(h.type !== 'zero')h.target = Math.max(1,Math.min(90,parseInt($('detail-days').value,10) || h.target || 7));
  save(data);
  showToast('tuned');
  closeSheet('detail-sheet');
  detailIdx = null;
  render();
});
$('detail-mark').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  showToast('planted');
  openDetail(detailIdx);
  render();
});
$('detail-add').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  showToast('planted');
  openDetail(detailIdx);
  render();
});
$('detail-close').addEventListener('click',()=>{detailIdx = null;closeSheet('detail-sheet');});
$('detail-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){detailIdx = null;closeSheet('detail-sheet');}});
$('detail-calendar').addEventListener('click',e=>{
  const day = e.target.closest('[data-entry-day]');
  if(!day || detailIdx === null)return;
  openDayEntry(detailIdx,day.dataset.entryDay);
});

$('open-about').addEventListener('click',()=>openSheet('about-sheet'));
$('about-close').addEventListener('click',()=>closeSheet('about-sheet'));
$('about-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('about-sheet');});

$('open-overview').addEventListener('click',()=>{
  renderOverview();
  openSheet('overview-sheet');
});
$('overview-close').addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('overview-sheet');});

$('snooze-sheet').addEventListener('click',e=>{
  const opt = e.target.closest('[data-snooze-days]');
  if(!opt || snoozeIdx === null)return;
  const days = parseInt(opt.dataset.snoozeDays,10);
  doSnooze(snoozeIdx,days);
  snoozeIdx = null;
  closeSheet('snooze-sheet');
});
$('snooze-cancel').addEventListener('click',()=>{snoozeIdx = null;closeSheet('snooze-sheet');});
$('snooze-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){snoozeIdx = null;closeSheet('snooze-sheet');}});

$('day-entry-save').addEventListener('click',()=>{
  if(dayEntryIdx === null || dayEntryTs === null)return;
  if(!logTingAt(dayEntryIdx,dayEntryTs))return;
  closeSheet('day-entry-sheet');
  if(detailIdx !== null)openDetail(detailIdx);
  dayEntryIdx = null;
  dayEntryTs = null;
  showToast('planted');
  if(detailIdx === null)render();
});
$('day-entry-cancel').addEventListener('click',()=>{dayEntryIdx = null;dayEntryTs = null;closeSheet('day-entry-sheet');});
$('day-entry-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){dayEntryIdx = null;dayEntryTs = null;closeSheet('day-entry-sheet');}});

$('list').addEventListener('touchstart',e=>{
  if(swipeOpenCard && !e.target.closest('.swipe-actions') && !e.target.closest('.ting-card'))closeAllSwipes();
},{passive:true});

render();
