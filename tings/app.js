const KEY = 'tings_v2';
const SORT_SETTINGS_KEY = 'tings_sort_settings_v1';
const MAX_LOGS = 500;
const MAX_TINGS = 300;
const QUOTA_WARN_KB = 2048;
const QUOTA_HARD_KB = 4096;
const SWIPE_THRESHOLD = 60;
const SWIPE_ACTION_WIDTH = 68;
const TAP_DELAY = 310;
const SNAP_TRANSITION = 'transform 190ms cubic-bezier(.3,.7,.2,1)';
const WIDTH_TRANSITION = 'width 190ms cubic-bezier(.3,.7,.2,1)';
const DEFAULT_SORT_SETTINGS = {
  focus:'balanced',
  plansFirst:true,
  keepStopsQuiet:true,
  showSnoozed:false,
  planWindowDays:1,
  planWeight:100,
  buildWeight:100,
  limitWeight:100,
  stopWeight:55,
  newWeight:100,
  requireConfirm:true,
  reachAssist:true,
  defaultType:'keepup',
  defaultTarget:7
};

const $ = id => document.getElementById(id);

let pendingIdx = null;
let detailIdx = null;
let snoozeIdx = null;
let dayEntryIdx = null;
let dayEntryTs = null;
let detailMonthOffset = 0;
let overviewMonthOffset = 0;
let dayLogsKey = null;
let selectedType = 'keepup';
let sortSettings = loadSortSettings();

let swipeOpenCard = null;
let tapTimer = null;
let lastTap = {idx:-1,time:0};
let toastTimer = null;
let undoTimer = null;
let navSuppressTimer = null;
let pendingUndo = null;
let reachTimer = null;
let reachHoldTimer = null;
let lastScrollY = 0;
let headerHidden = false;
let headerRevealPull = 0;
let topTouchY = 0;
let topTouchX = 0;
let topTouchStartedAtTop = false;
let reachArmed = false;
let buttonPointer = null;
let suppressNativeButton = null;
let detailTuneOriginal = null;
let calendarPointer = null;
let cardPointer = null;
let suppressCardClick = null;

function load(){
  try{return normalize(JSON.parse(localStorage.getItem(KEY)) || []);}
  catch{return [];}
}

function loadSortSettings(){
  try{
    return {...DEFAULT_SORT_SETTINGS,...(JSON.parse(localStorage.getItem(SORT_SETTINGS_KEY)) || {})};
  }catch{
    return {...DEFAULT_SORT_SETTINGS};
  }
}

function saveSortSettings(settings){
  sortSettings = {...DEFAULT_SORT_SETTINGS,...settings};
  localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(sortSettings));
}

function normalize(items){
  return items.map(h => ({
    name: h.name || '',
    type: h.type || 'keepup',
    target: h.type === 'zero' ? null : (h.target || 7),
    logs: Array.isArray(h.logs) ? h.logs.slice().sort((a,b)=>a-b).slice(-MAX_LOGS) : [],
    emoji: h.emoji || '',
    pinned:Boolean(h.pinned),
    snoozedUntil: h.snoozedUntil || null
  })).map(h => ({...h,lastLog:latestActualLog(h.logs)}));
}

function save(data){
  try{
    const str = JSON.stringify(data);
    const kb = Math.round((str.length * 2) / 1024);
    localStorage.setItem(KEY,str);
    updateQuotaBar(kb);
    return true;
  }catch(e){
    alert('storage full - remove some habits first');
    return false;
  }
}

function sizeKb(data){return Math.round((JSON.stringify(data).length * 2) / 1024);}
function latestActualLog(logs){
  const actual = (logs || []).filter(ts=>ts <= Date.now()).sort((a,b)=>a-b);
  return actual.length ? actual[actual.length - 1] : null;
}
function actualLogs(logs){
  return (logs || []).filter(ts=>ts <= Date.now()).sort((a,b)=>a-b);
}
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
  const sorted = actualLogs(logs);
  if(sorted.length < 2)return null;
  let sum = 0;
  for(let i=1;i<sorted.length;i++)sum += sorted[i] - sorted[i-1];
  return Math.round(sum / (sorted.length - 1) / 86400000);
}

function currentRun(h){
  const logs = actualLogs(h.logs).sort((a,b)=>b-a);
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
    teal:{bg:'var(--teal-bg)',icon:'var(--teal-icon)'},
    amber:{bg:'var(--amber-bg)',icon:'var(--amber-icon)'},
    red:{bg:'var(--red-bg)',icon:'var(--red-icon)'},
    purple:{bg:'var(--purple-bg)',icon:'var(--purple-icon)'},
    quiet:{bg:'var(--bg2)',icon:'var(--text3)'}
  };
  return map[t];
}

function visualClassColor(cls){
  if(cls === 'hit')return 'var(--teal-icon)';
  if(cls === 'warn')return 'var(--amber-icon)';
  if(cls === 'miss')return 'var(--red-icon)';
  if(cls === 'plan')return 'var(--purple-icon)';
  return 'var(--text3)';
}

function scoreTone(score){
  if(score === null || score === undefined)return 'empty';
  if(score >= 75)return 'hit';
  if(score >= 45)return 'warn';
  return 'miss';
}

function intervalTone(h,days){
  if(days === null || days === undefined)return '';
  const target = h.target || 7;
  if(h.type === 'keepup'){
    if(days <= target)return 'hit';
    if(days <= target * 1.35)return 'warn';
    return 'miss';
  }
  if(h.type === 'reduce'){
    if(days >= target)return 'hit';
    if(days >= target * 0.65)return 'warn';
    return 'miss';
  }
  if(days >= 14)return 'hit';
  if(days >= 4)return 'warn';
  return 'miss';
}

function logToneMap(h){
  const actual = actualLogs(h.logs);
  const map = new Map();
  actual.forEach((ts,i)=>{
    const days = i === 0 ? Math.max(1,daysSince(ts) || 1) : Math.max(1,Math.round((ts - actual[i - 1]) / 86400000));
    map.set(dateKey(ts),intervalTone(h,days));
  });
  (h.logs || []).filter(ts=>ts > Date.now()).forEach(ts=>{
    const key = dateKey(ts);
    if(!map.has(key))map.set(key,'plan');
  });
  return map;
}

function metaLine(h){
  const days = daysSince(h.lastLog);
  const parts = [];
  if(hasPlannedToday(h))parts.push('planned today');
  if(h.snoozedUntil && Date.now() < h.snoozedUntil){
    parts.push(`hidden ${Math.ceil((h.snoozedUntil - Date.now()) / 86400000)}d`);
  }else{
    parts.push(entryWhen(h.lastLog));
    if(h.type !== 'zero' && h.target)parts.push(`every ${h.target}d`);
  }
  return parts;
}

function settingScale(value){
  return Math.max(0,Math.min(2,(parseInt(value,10) || 0) / 100));
}

function plannedWithinWindow(h,windowDays){
  const plan = nextPlannedLog(h);
  if(!plan || h.type === 'zero')return false;
  const dist = dayDistance(plan);
  return dist !== null && dist <= 0 && Math.abs(dist) <= windowDays;
}

function attentionScore(h,index){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return -1000 - index;
  const days = daysSince(h.lastLog);
  const target = h.target || 7;
  const settings = sortSettings || DEFAULT_SORT_SETTINGS;
  const focus = settings.focus || 'balanced';
  const planScale = settingScale(settings.planWeight);
  const buildScale = settingScale(settings.buildWeight);
  const limitScale = settingScale(settings.limitWeight);
  const stopScale = settingScale(settings.stopWeight);
  const newScale = settingScale(settings.newWeight);
  let score = 0;
  if(settings.plansFirst && plannedWithinWindow(h,settings.planWindowDays ?? 1))score += 320 * planScale;

  if(h.type === 'keepup'){
    if(days === null)score += 130 * newScale;
    else{
      const ratio = days / target;
      if(ratio >= 1)score += 260 + Math.min(55,ratio * 14);
      else if(ratio >= 0.75)score += 185 + ratio * 35;
      else score += 70 + ratio * 70;
    }
    if(focus === 'build')score *= 1.22;
    if(focus === 'space')score *= 0.9;
    score *= buildScale;
    return score - index / 100;
  }

  if(h.type === 'reduce'){
    if(days === null)score += 38 * newScale;
    else{
      const ratio = days / target;
      if(ratio >= 1.25)score += 92 + Math.min(24,(ratio - 1.25) * 18);
      else if(ratio >= 1)score += 68 + ratio * 12;
      else if(ratio >= 0.75)score += 42 + ratio * 12;
      else score += 18 + ratio * 20;
    }
    if(focus === 'space')score *= 1.35;
    if(focus === 'build')score *= 0.78;
    score *= limitScale;
    return score - index / 100;
  }

  if(h.type === 'zero'){
    if(days === null)score += 10 * newScale;
    else if(days < 0)score += 8;
    else if(days === 0)score += 24;
    else if(days < 3)score += 18;
    else score += Math.max(4,14 - days / 3);
    if(settings.keepStopsQuiet)score *= 0.55;
    if(focus === 'space')score *= 1.2;
    score *= stopScale;
    return score - index / 100;
  }

  if(days === null)return 20 - index / 100;
  const ratio = days / target;
  return (ratio >= 1 ? 80 + ratio : ratio * 40) - index / 100;
}

function visibleIndices(data){
  const indices = data.map((_,i)=>i).filter(i=>{
    const h = data[i];
    return !(h.snoozedUntil && Date.now() < h.snoozedUntil && !sortSettings.showSnoozed);
  });
  indices.sort((a,b)=>{
    if(data[a].pinned && data[b].pinned)return a - b;
    const pin = Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned));
    if(pin)return pin;
    return attentionScore(data[b],b) - attentionScore(data[a],a);
  });
  return indices;
}

function iconHtml(h,c){
  if(h.emoji)return `<span class="emoji-mark">${escapeHtml(h.emoji)}</span>`;
  return `<i class="ti ${defaultIcon(h.type)}" style="color:${c.icon};" aria-hidden="true"></i>`;
}

function updateSortButton(){
  const count = load().length;
  $('open-overview').classList.toggle('is-hidden',count < 2);
  $('open-overview').disabled = count < 2;
}

function updateOverallSummary(data = load()){
  const label = $('overall-summary');
  if(!label)return;
  if(!data.length){
    label.textContent = 'ready for your first habit';
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
    return days === null || days >= (h.target || 7) * 0.9;
  }).length;
  const buildCalm = visible.filter(h=>h.type === 'keepup').every(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days < (h.target || 7) * 0.9;
  });
  const limitGoodCount = visible.filter(h=>h.type === 'reduce').filter(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days >= (h.target || 7);
  }).length;
  const limitTooSoonCount = visible.filter(h=>h.type === 'reduce').filter(h=>{
    const days = daysSince(h.lastLog);
    return days !== null && days < (h.target || 7) * 0.55;
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
  return (h.logs || []).filter(ts=>ts > Date.now()).sort((a,b)=>a-b)[0] || null;
}

function cardCue(h){
  const days = daysSince(h.lastLog);
  const target = h.target || 7;
  const plan = nextPlannedLog(h);
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'Snoozed for now';
  if(plan && dateKey(plan) === dateKey(Date.now()) && h.type !== 'zero')return 'Planned today';
  if(days === null){
    if(h.type === 'zero')return 'Nothing logged';
    return 'Ready to start';
  }
  if(days < 0)return 'Coming up';
  if(h.type === 'keepup'){
    if(days >= target)return 'Due now';
    if(days >= target * 0.75)return 'Due soon';
    return 'On rhythm';
  }
  if(h.type === 'reduce'){
    if(days >= target)return 'Good spacing';
    if(days >= target * 0.55)return 'Getting space';
    return 'Too recent';
  }
  if(days === 0)return 'Reset today';
  if(days < 3)return 'Recent reset';
  return 'Clear stretch';
}

function cardTone(h){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'quiet';
  if(hasPlannedToday(h) && h.type !== 'zero')return 'plan';
  return scoreTone(progressScore(h));
}

function cardMeta(h){
  const plan = nextPlannedLog(h);
  const parts = [];
  if(h.pinned)parts.push('<span class="context-pill pin" title="pinned"><i class="ti ti-pin" aria-hidden="true"></i></span>');
  if(h.type !== 'zero')parts.push(`<span class="context-pill" title="target rhythm"><i class="ti ti-repeat" aria-hidden="true"></i>${h.target || 7}d</span>`);
  else parts.push('<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>');
  if(plan && h.type !== 'zero' && !hasPlannedToday(h))parts.push(`<span class="context-pill plan" title="planned entry"><i class="ti ti-calendar-event" aria-hidden="true"></i>${escapeHtml(entryWhen(plan))}</span>`);
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
  updateOverallSummary(data);

  const indices = visibleIndices(data);
  if(!indices.length){
    empty.style.display = 'block';
    empty.classList.toggle('is-action',data.length > 0 && !sortSettings.showSnoozed);
    if(data.length && !sortSettings.showSnoozed){
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
    const planAction = h.type === 'zero'
      ? ''
      : `<button class="swipe-action sa-plan" data-action="plan-next" aria-label="plan ${escapeHtml(nextPlanLabel(h))}"><i class="ti ti-calendar-plus" aria-hidden="true"></i><span>plan</span><small>${escapeHtml(nextPlanLabel(h))}</small></button>`;

    const row = document.createElement('div');
    row.className = 'swipe-row';
    row.dataset.realIdx = realIdx;
    row.innerHTML = `
      <div class="swipe-actions swipe-actions-left">
        ${pinAction}
        ${planAction}
      </div>
      <div class="swipe-actions swipe-actions-right">
        <button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>remove</button>
      </div>
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}" data-real="${realIdx}" style="--card-accent:${accent};">
        <button class="pulse-btn" data-pulse="${realIdx}" aria-label="add entry for ${escapeHtml(h.name)}" style="background:${c.bg};color:${c.icon};">
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
      const idx = +btn.dataset.pulse;
      const card = btn.closest('.ting-card');
      handleCardActivate(idx,card,()=>sortSettings.requireConfirm ? openConfirm(idx) : quickLog(idx,card));
    });
  });

  list.querySelectorAll('.swipe-action').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      closeAllSwipes();
      if(btn.dataset.action === 'pin')togglePin(idx);
      if(btn.dataset.action === 'plan-next')planNext(idx);
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
  },{passive:true});

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
  data[i].logs = [...(data[i].logs || []),now].sort((a,b)=>a-b).slice(-MAX_LOGS);
  data[i].snoozedUntil = null;
  if(!save(data))return false;
  showUndo('Entry logged',undo);
  return true;
}

function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
  const entryTs = ts;
  const undo = {type:'entry',idx:i,ts:entryTs,snoozedUntil:data[i].snoozedUntil || null};
  data[i].logs = [...(data[i].logs || []),entryTs].sort((a,b)=>a-b).slice(-MAX_LOGS);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(entryTs <= Date.now())data[i].snoozedUntil = null;
  if(!save(data))return false;
  showUndo(entryTs > Date.now() ? 'Plan added' : 'Entry added',undo);
  return true;
}

function removeEntryAt(i,ts){
  const data = load();
  if(!data[i])return false;
  const logs = [...(data[i].logs || [])];
  const pos = logs.indexOf(ts);
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
    const logs = [...(data[idx].logs || [])];
    const pos = logs.indexOf(ts);
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
  const changedHabit = detailIdx !== i;
  if(changedHabit)detailMonthOffset = 0;
  detailIdx = i;
  const days = daysSince(h.lastLog);
  const c = colors(days,h.target,h.type);
  $('detail-name').textContent = h.name;
  $('detail-sub').textContent = metaLine(h).join(' · ');
  $('detail-about').textContent = aboutText(h);
  $('detail-trend').textContent = trendText(h);
  $('detail-habit-name').value = h.name || '';
  $('detail-emoji').value = h.emoji || '';
  $('detail-days').value = h.target || '';
  $('detail-pinned').checked = Boolean(h.pinned);
  setDetailTypeUi(h.type);
  detailTuneOriginal = {
    name:h.name || '',
    type:h.type || 'keepup',
    emoji:h.emoji || '',
    target:h.target || '',
    pinned:Boolean(h.pinned)
  };
  syncRhythm('detail',h.target || 7);
  $('detail-mark').style.background = c.bg;
  $('detail-mark').style.color = c.icon;
  $('detail-mark').setAttribute('aria-label',`add entry for ${h.name}`);
  $('detail-mark').innerHTML = iconHtml(h,c);
  renderStats(h);
  renderGraph(h);
  renderCalendar(h);
  setDetailDirty(false);
  openSheet('detail-sheet');
  if(changedHabit){
    const pager = $('detail-sheet').querySelector('.detail-pager');
    if(pager)pager.scrollTo({left:0,behavior:'auto'});
  }
  updateDetailPagerDots();
}

function currentDetailTune(){
  return {
    name:$('detail-habit-name').value.trim(),
    type:document.querySelector('#detail-type-seg .seg-opt.on')?.dataset.detailType || 'keepup',
    emoji:cleanMark($('detail-emoji').value),
    target:$('detail-days').value || '',
    pinned:$('detail-pinned').checked
  };
}

function setDetailDirty(force){
  const sheet = $('detail-sheet').querySelector('.detail-sheet');
  const current = currentDetailTune();
  const dirty = force ?? (
    detailTuneOriginal &&
    (current.name !== detailTuneOriginal.name ||
      current.type !== detailTuneOriginal.type ||
      current.emoji !== detailTuneOriginal.emoji ||
      String(current.target) !== String(detailTuneOriginal.target) ||
      current.pinned !== detailTuneOriginal.pinned)
  );
  sheet.classList.toggle('tune-dirty',Boolean(dirty));
}

function restoreDetailTune(){
  if(!detailTuneOriginal)return;
  $('detail-habit-name').value = detailTuneOriginal.name;
  $('detail-emoji').value = detailTuneOriginal.emoji;
  $('detail-pinned').checked = detailTuneOriginal.pinned;
  setDetailTypeUi(detailTuneOriginal.type);
  if(detailTuneOriginal.target !== '')syncRhythm('detail',detailTuneOriginal.target);
  setDetailDirty(false);
}

function closeDetail(){
  detailIdx = null;
  detailTuneOriginal = null;
  closeSheet('detail-sheet');
}

function renderStats(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  const completed = actualLogs(h.logs).length;
  const planned = (h.logs || []).filter(ts=>ts > Date.now()).length;
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
  const runLabel = h.type === 'keepup' ? 'streak' : 'clear days';
  const intervalSummary = intervalToneSummary(h);
  const avgTone = avg === null ? 'empty' : intervalTone(h,avg);
  const gapTone = days === null || days < 0 ? 'empty' : intervalTone(h,days);
  const scoreName = scoreTitle(h,score);
  const targetLine = h.type === 'zero' ? 'avoid' : `${target}d rhythm`;
  const gapValue = gapNum === '-' ? '-' : `${gapNum}<small>d</small>`;
  const avgValue = avg === null ? '-' : `${avg}<small>d</small>`;
  const rhythmIcon = h.type === 'zero' ? 'ti-ban' : 'ti-repeat';
  const planIcon = h.type === 'zero' ? 'ti-list-check' : 'ti-calendar-event';
  const planFact = h.type === 'zero' ? `${completed} entries` : `${planned} planned`;
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

function recentWindowStats(h,windowDays = 30){
  const since = Date.now() - windowDays * 86400000;
  const logs = (h.logs || []).filter(ts=>ts >= since && ts <= Date.now());
  const target = h.target || 7;
  const expected = h.type === 'keepup' ? Math.max(1,Math.ceil(windowDays / target)) : 0;
  return {count:logs.length,expected,good:Math.min(logs.length,expected)};
}

function intervalValues(h,limit = null){
  const logs = actualLogs(h.logs);
  const intervals = logs.map((ts,i)=>i === 0 ? Math.max(1,daysSince(ts) || 1) : Math.max(1,Math.round((ts - logs[i-1]) / 86400000)));
  return limit ? intervals.slice(-limit) : intervals;
}

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

function scoreTitle(h,score){
  if(score === null)return 'no pattern yet';
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

function progressScore(h){
  const days = daysSince(h.lastLog);
  if(days === null)return null;
  if(days < 0)return null;
  const target = h.target || 7;
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
  if(h.type === 'keepup')return days <= target ? `Last entry was ${when}. You are on track.` : `Last entry was ${when}. This needs attention.`;
  return days >= target ? `${days} days since the last entry. Good gap.` : `Entry was ${when}. Try to increase the gap.`;
}

function trendText(h){
  const days = daysSince(h.lastLog);
  const avg = avgInterval(h.logs);
  if(days === null)return 'no entries yet';
  if(days < 0)return 'coming up';
  if(h.type === 'zero'){
    if(days === 0)return 'entry today';
    if(days < 3)return 'recent entry';
    return 'on track';
  }
  const target = h.target || 7;
  const pace = avg || days;
  if(h.type === 'keepup'){
    if(days > target)return 'due now';
    return pace <= target ? 'on pace' : 'behind';
  }
  if(days < target)return 'too recent';
  return pace >= target ? 'on track' : 'watch';
}

function renderGraph(h){
  const graph = $('detail-graph');
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

function graphRule(h){
  if(h.type === 'keepup')return 'shorter is better';
  if(h.type === 'reduce')return 'longer is better';
  return 'longer is better';
}

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

function renderCalendar(h){
  const frame = monthFrame(detailMonthOffset);
  const {year,month,first,last,label,today} = frame;
  const logs = [...(h.logs || [])];
  const dayCounts = new Map();
  const toneByDay = logToneMap(h);
  let actual = 0;
  let planned = 0;
  logs.forEach(ts=>{
    const d = new Date(ts);
    if(d.getFullYear() !== year || d.getMonth() !== month)return;
    const key = dateKey(ts);
    dayCounts.set(key,(dayCounts.get(key) || 0) + 1);
    if(ts > Date.now())planned += 1;
    else actual += 1;
  });
  const monthEntries = actual + planned;
  const activeDays = [...dayCounts.values()].filter(Boolean).length;
  $('detail-calendar-label').textContent = `${label} · ${monthEntries}`;
  $('detail-calendar-summary').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${planned} planned</span>`;

  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:last.getDate()},(_,i)=>{
    const date = new Date(year,month,i + 1);
    const key = dateKey(date.getTime());
    const count = dayCounts.get(key) || 0;
    const toneClass = toneByDay.get(key) || '';
    const density = count >= 3 ? 'density-3' : count >= 2 ? 'density-2' : count ? 'density-1' : '';
    const dots = count ? `<span class="cal-dots"><span class="cal-dot ${toneClass}"></span>${count > 1 ? `<span class="cal-more">${count}</span>` : ''}</span>` : '<span class="cal-dots"></span>';
    const cls = [
      count ? 'has-entry' : '',
      density,
      key === today ? 'today' : '',
      key === dayLogsKey ? 'selected' : '',
      'pickable'
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-entry-day="${key}"><span>${i + 1}</span>${dots}</button>`;
  });
  $('detail-calendar').innerHTML = [...heads,...blanks,...days].join('');
}

function updateDetailPagerDots(){
  const pager = $('detail-sheet').querySelector('.detail-pager');
  const dots = [...$('detail-sheet').querySelectorAll('.detail-dots span')];
  if(!pager || !dots.length)return;
  const page = Math.round(pager.scrollLeft / Math.max(1,pager.clientWidth));
  dots.forEach((dot,i)=>{
    dot.style.background = i === page ? 'var(--text)' : 'var(--border2)';
    dot.style.opacity = i === page ? '0.9' : '0.7';
  });
}

function hasPlannedEntryForDay(h,key){
  return (h.logs || []).some(ts=>dateKey(ts) === key && ts > Date.now());
}

function hasPlannedToday(h){
  const today = dateKey(Date.now());
  return (h.logs || []).some(ts=>dateKey(ts) === today && ts > Date.now());
}

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

function entryTone(type){
  if(type === 'zero')return 'miss';
  if(type === 'reduce')return 'warn';
  return 'hit';
}

function renderOverview(){
  const data = load();
  const frame = monthFrame(overviewMonthOffset);
  const byDay = new Map();
  let total = 0;
  let actual = 0;
  let planned = 0;
  const toneCounts = {hit:0,warn:0,miss:0,plan:0};
  data.forEach(h=>{
    const toneByDay = logToneMap(h);
    (h.logs || []).forEach(ts=>{
      const d = new Date(ts);
      if(d.getFullYear() !== frame.year || d.getMonth() !== frame.month)return;
      const key = dateKey(ts);
      if(!byDay.has(key))byDay.set(key,[]);
      const isPlan = ts > Date.now();
      const tone = isPlan ? 'plan' : toneByDay.get(key) || entryTone(h.type);
      byDay.get(key).push({name:h.name,type:h.type,tone,planned:isPlan});
      total += 1;
      if(isPlan)planned += 1;
      else actual += 1;
      toneCounts[tone] = (toneCounts[tone] || 0) + 1;
    });
  });

  const activeDays = [...byDay.values()].filter(entries=>entries.some(entry=>!entry.planned)).length;
  const busiest = [...byDay.entries()].sort((a,b)=>b[1].length - a[1].length)[0];
  const busiestLabel = busiest
    ? new Date(`${busiest[0]}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'})
    : '-';
  const bestTone = toneCounts.miss ? 'some days need care' : toneCounts.warn ? 'mostly steady' : actual ? 'clean month so far' : planned ? 'plans are set' : 'quiet month';

  $('overview-copy').textContent = total
    ? `${bestTone}. ${actual} entries${planned ? `, ${planned} planned` : ''}.`
    : 'No entries or plans this month.';
  $('overview-stats').innerHTML = `
    <span class="overview-stat"><i class="ti ti-calendar-check" aria-hidden="true"></i>${activeDays} active days</span>
    <span class="overview-stat"><i class="ti ti-list-check" aria-hidden="true"></i>${actual} entries</span>
    <span class="overview-stat"><i class="ti ti-calendar-event" aria-hidden="true"></i>${planned} planned</span>
    <span class="overview-stat"><i class="ti ti-chart-bar" aria-hidden="true"></i>busy ${busiestLabel}</span>`;
  $('overview-calendar-label').textContent = frame.label;
  const heads = ['s','m','t','w','t','f','s'].map(day=>`<div class="cal-head">${day}</div>`);
  const blanks = Array.from({length:frame.first.getDay()},()=>'<div class="cal-day blank"></div>');
  const days = Array.from({length:frame.last.getDate()},(_,i)=>{
    const date = new Date(frame.year,frame.month,i + 1);
    const key = dateKey(date.getTime());
    const entries = byDay.get(key) || [];
    const tones = ['hit','warn','miss','plan']
      .filter(tone=>entries.some(item=>item.tone === tone))
      .slice(0,4);
    const dots = tones.map(tone=>`<span class="cal-dot ${tone}"></span>`).join('');
    const more = entries.length > tones.length ? `<span class="cal-more">${entries.length}</span>` : '';
    const density = entries.length >= 5 ? 'density-3' : entries.length >= 3 ? 'density-2' : entries.length ? 'density-1' : '';
    const cls = [
      entries.length ? 'has-entry' : '',
      density,
      key === frame.today ? 'today' : '',
      key === dayLogsKey ? 'selected' : '',
      'pickable'
    ].filter(Boolean).join(' ');
    return `<button class="cal-day ${cls}" data-log-day="${key}"><span>${i + 1}</span><span class="cal-dots">${dots}</span>${more}</button>`;
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

  $('overview-list').innerHTML = monthRows.length ? `<p class="overview-section-title">most active</p>${monthRows.map(({h,count,c})=>`
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
  `).join('')}` : '<div class="overview-item"><span class="overview-name">quiet month</span><span class="overview-meta">no entries yet</span></div>';
}

function renderDayLogs(key){
  const data = load();
  const rows = [];
  data.forEach((h,i)=>{
    const entries = (h.logs || []).filter(ts=>dateKey(ts) === key);
    const count = entries.length;
    if(!count)return;
    rows.push({h,index:i,count,entries,c:colors(daysSince(h.lastLog),h.target,h.type)});
  });
  const ts = new Date(`${key}T12:00:00`).getTime();
  $('day-logs-title').textContent = new Date(ts).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('day-logs-sub').textContent = rows.length ? `${rows.reduce((sum,row)=>sum + row.count,0)} entries` : 'no entries';
  $('day-logs-list').innerHTML = rows.length ? rows.map(({h,index,count,entries,c})=>{
    const plannedCount = entries.filter(entryTs=>entryTs > Date.now()).length;
    const remove = plannedCount ? `<button class="mini-text-btn" data-remove-plan="${index}" data-plan-day="${key}">remove plan</button>` : '';
    return `
    <div class="overview-item">
      <span class="overview-name">${iconHtml(h,c)} ${escapeHtml(h.name)}</span>
      <span class="overview-meta">${plannedCount ? `${plannedCount} planned` : `${count} ${count === 1 ? 'entry' : 'entries'}`}</span>
      ${remove}
    </div>`;
  }).join('') : '<div class="overview-item"><span class="overview-name">no entries</span><span class="overview-meta">add one below</span></div>';
  $('day-log-ting').innerHTML = data.length ? data.map((h,i)=>`<option value="${i}">${escapeHtml(h.name)}</option>`).join('') : '<option value="">No habits</option>';
  $('day-log-add').disabled = !data.length;
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
  const previous = data[i].snoozedUntil || null;
  data[i].snoozedUntil = Date.now() + days * 86400000;
  if(save(data)){
    showUndo(`Hidden ${days}d`,{type:'hide',idx:i,snoozedUntil:previous});
    render();
  }
}

function doNuke(i){
  const data = load();
  const removed = data[i];
  if(!removed)return;
  data.splice(i,1);
  if(save(data)){
    showUndo('Habit removed',{type:'delete',idx:i,habit:removed});
    render();
  }
}

function openDayEntry(i,key){
  const h = load()[i];
  if(!h)return;
  dayEntryIdx = i;
  dayEntryTs = new Date(`${key}T12:00:00`).getTime();
  $('day-entry-name').textContent = h.name;
  const label = dayEntryTs > Date.now() ? 'Plan entry for' : 'Add entry for';
  $('day-entry-sub').textContent = `${label} ${new Date(dayEntryTs).toLocaleDateString(undefined,{month:'short',day:'numeric'})}?`;
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
  updateFullPageState();
  updateKeyboardLift();
}
function closeSheet(id){
  $(id).classList.remove('open');
  updateFullPageState();
  if(isFullPageSheet(id))suppressBottomNav(450);
  if(id === 'add-sheet')updateKeyboardLift();
}

function isFullPageSheet(id){
  return id === 'detail-sheet' || id === 'about-sheet' || id === 'overview-sheet' || id === 'settings-sheet';
}

function updateFullPageState(){
  const open = ['detail-sheet','about-sheet','overview-sheet','settings-sheet'].some(id=>$(id).classList.contains('open'));
  document.body.classList.toggle('fullpage-open',open);
}

function showToast(text){
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove('show'),900);
}

function showUndo(text,undo){
  pendingUndo = undo;
  $('undo-text').textContent = text;
  $('undo-toast').classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo,5200);
}

function hideUndo(){
  clearTimeout(undoTimer);
  undoTimer = null;
  pendingUndo = null;
  $('undo-toast').classList.remove('show');
}

function refreshOpenViews(){
  render();
  if(detailIdx !== null && $('detail-sheet').classList.contains('open'))openDetail(detailIdx);
  if($('overview-sheet').classList.contains('open'))renderOverview();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayLogs(dayLogsKey);
}

function suppressBottomNav(ms = 300){
  document.body.classList.add('nav-suppressed');
  clearTimeout(navSuppressTimer);
  navSuppressTimer = setTimeout(()=>document.body.classList.remove('nav-suppressed'),ms);
}

function showReachPad(){
  if(!sortSettings.reachAssist)return;
  if(document.querySelector('.sheet-wrap.open'))return;
  if(window.scrollY > 4)return;
  if(document.body.classList.contains('reach-pad'))return;
  document.body.classList.add('reach-pad');
  clearTimeout(reachTimer);
  reachTimer = setTimeout(()=>{
    document.body.classList.remove('reach-pad');
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
  },5200);
}

function cancelReachHold(){
  clearTimeout(reachHoldTimer);
  reachHoldTimer = null;
  reachArmed = false;
}

function updateHeaderOnScroll(){
  const y = window.scrollY;
  const dy = y - lastScrollY;
  if(y < 12){
    headerHidden = false;
    headerRevealPull = 0;
  }else if(dy > 4 && y > 42){
    headerHidden = true;
    headerRevealPull = 0;
  }else if(dy < -2){
    headerRevealPull += Math.abs(dy);
    if(headerRevealPull > 64)headerHidden = false;
  }else if(dy > 0){
    headerRevealPull = 0;
  }
  document.body.classList.toggle('header-hidden',headerHidden);
  lastScrollY = y;
}

function forgivingButtonTarget(target){
  const btn = target.closest('button');
  if(!btn || btn.closest('.ting-card'))return null;
  if(btn.closest('.month-nav'))return null;
  if(btn.classList.contains('cal-day'))return null;
  return btn;
}

function bindCalendarTap(container,selector,handler){
  container.addEventListener('pointerdown',e=>{
    const day = e.target.closest(selector);
    if(!day || !container.contains(day))return;
    const scrollHost = container.closest('.sheet');
    calendarPointer = {
      container,
      day,
      id:e.pointerId,
      x:e.clientX,
      y:e.clientY,
      scrollHost,
      scrollTop:scrollHost ? scrollHost.scrollTop : 0,
      time:Date.now()
    };
  },{passive:true});

  container.addEventListener('pointerup',e=>{
    if(!calendarPointer || calendarPointer.container !== container || calendarPointer.id !== e.pointerId)return;
    const tap = calendarPointer;
    calendarPointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
    if(moved > 5 || scrolled > 1 || Date.now() - tap.time > 650)return;
    handler(tap.day,e);
  },{passive:true});

  container.addEventListener('pointercancel',()=>{
    if(calendarPointer && calendarPointer.container === container)calendarPointer = null;
  },{passive:true});
}

document.addEventListener('pointerdown',e=>{
  const btn = forgivingButtonTarget(e.target);
  if(!btn)return;
  buttonPointer = {btn,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
},true);

document.addEventListener('pointerup',e=>{
  if(!buttonPointer || buttonPointer.id !== e.pointerId)return;
  const {btn,x,y,time} = buttonPointer;
  buttonPointer = null;
  if(btn.disabled)return;
  const dx = Math.abs(e.clientX - x);
  const dy = Math.abs(e.clientY - y);
  const moved = Math.hypot(dx,dy);
  if(moved > 8 && moved <= 160 && Date.now() - time < 1200){
    suppressNativeButton = btn;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
    setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},80);
  }
},true);

document.addEventListener('click',e=>{
  if(e.target.closest('button') === suppressNativeButton && e.isTrusted){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
    return;
  }
  const btn = forgivingButtonTarget(e.target);
  if(btn && btn === suppressNativeButton && e.isTrusted){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
  }
},true);

function cancelAdd(){
  closeSheet('add-sheet');
  applyAddDefaults();
}

function applyAddDefaults(){
  const settings = loadSortSettings();
  $('ting-name').value = '';
  $('ting-emoji').value = '';
  selectedType = settings.defaultType || 'keepup';
  const target = clampRhythm(settings.defaultTarget || 7);
  syncRhythm('ting',target);
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o.dataset.v === selectedType));
  $('target-slider-row').style.display = selectedType === 'zero' ? 'none' : 'flex';
  $('target-help').style.display = selectedType === 'zero' ? 'none' : 'block';
  $('target-help').textContent = rhythmHelp(selectedType);
}

function syncSettingsControls(){
  sortSettings = loadSortSettings();
  document.querySelectorAll('#sort-focus-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.focus === sortSettings.focus);
  });
  document.querySelectorAll('#plan-window-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.window,10) === (sortSettings.planWindowDays ?? 1));
  });
  document.querySelectorAll('#default-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.defaultType === sortSettings.defaultType);
  });
  $('setting-plans-first').checked = Boolean(sortSettings.plansFirst);
  $('setting-stops-quiet').checked = Boolean(sortSettings.keepStopsQuiet);
  $('setting-show-snoozed').checked = Boolean(sortSettings.showSnoozed);
  $('setting-require-confirm').checked = Boolean(sortSettings.requireConfirm);
  $('setting-reach-assist').checked = Boolean(sortSettings.reachAssist);
  syncSettingRange('plan-weight',sortSettings.planWeight,'%');
  syncSettingRange('build-weight',sortSettings.buildWeight,'%');
  syncSettingRange('limit-weight',sortSettings.limitWeight,'%');
  syncSettingRange('stop-weight',sortSettings.stopWeight,'%');
  syncSettingRange('new-weight',sortSettings.newWeight,'%');
  syncSettingRange('default-target',sortSettings.defaultTarget,'d');
}

function updateSortSetting(patch){
  saveSortSettings({...sortSettings,...patch});
  syncSettingsControls();
  if(sortSettings.reachAssist === false)document.body.classList.remove('reach-pad');
  render();
}

function syncSettingRange(name,value,suffix){
  const field = $(`setting-${name}`);
  const label = $(`setting-${name}-label`);
  if(!field || !label)return;
  field.value = value;
  label.textContent = `${value}${suffix}`;
}

function bindSettingRange(name,key,suffix){
  const field = $(`setting-${name}`);
  if(!field)return;
  field.addEventListener('input',e=>{
    const value = parseInt(e.target.value,10);
    syncSettingRange(name,value,suffix);
    updateSortSetting({[key]:value});
  });
}

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
  applyAddDefaults();
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
  if(data.length >= MAX_TINGS){alert(`${MAX_TINGS} habits max`);return;}
  if(sizeKb(data) >= QUOTA_HARD_KB){alert('storage ceiling');return;}
  const target = selectedType === 'zero' ? null : Math.max(1,Math.min(90,parseInt($('ting-days').value,10) || 7));
  data.push({name:name.slice(0,60),type:selectedType,target,lastLog:null,logs:[],emoji:cleanMark($('ting-emoji').value),pinned:false});
  if(save(data)){cancelAdd();showToast('added');render();}
});

$('ting-name').addEventListener('keydown',e=>{if(e.key === 'Enter')$('do-save').click();});

function clampRhythm(value){
  return Math.max(1,Math.min(90,parseInt(value,10) || 7));
}

function rhythmHelp(type){
  if(type === 'reduce')return 'Target is the gap you want before it happens again.';
  return 'Target days between entries.';
}

function setDetailTypeUi(type){
  document.querySelectorAll('#detail-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.detailType === type);
  });
  $('detail-slider-row').style.display = type === 'zero' ? 'none' : 'flex';
  $('detail-target-help').style.display = type === 'zero' ? 'none' : 'block';
  $('detail-target-help').textContent = rhythmHelp(type);
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
$('detail-habit-name').addEventListener('input',()=>setDetailDirty());
$('detail-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-detail-type]');
  if(!opt)return;
  setDetailTypeUi(opt.dataset.detailType);
  setDetailDirty();
});
$('detail-pinned').addEventListener('change',()=>setDetailDirty());
$('detail-days').addEventListener('input',()=>setDetailDirty());
$('detail-days').addEventListener('blur',()=>setDetailDirty());
$('detail-days-slider').addEventListener('input',()=>setDetailDirty());

function bindMarkLimit(id){
  $(id).addEventListener('input',e=>{
    const limited = cleanMark(e.target.value);
    if(e.target.value !== limited)e.target.value = limited;
  });
}

bindMarkLimit('ting-emoji');
bindMarkLimit('detail-emoji');
$('detail-emoji').addEventListener('input',()=>setDetailDirty());

window.addEventListener('scroll',updateHeaderOnScroll,{passive:true});
document.addEventListener('touchstart',e=>{
  cancelReachHold();
  topTouchStartedAtTop = sortSettings.reachAssist && window.scrollY <= 1 && !e.target.closest('button,input,select');
  if(topTouchStartedAtTop){
    topTouchY = e.touches[0].clientY;
    topTouchX = e.touches[0].clientX;
  }
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!topTouchStartedAtTop || e.target.closest('button,input,select'))return cancelReachHold();
  if(window.scrollY > 1)return cancelReachHold();
  const dy = e.touches[0].clientY - topTouchY;
  const dx = Math.abs(e.touches[0].clientX - topTouchX);
  if(dy < 110 || dx > dy * 0.28)return cancelReachHold();
  if(!reachArmed){
    reachArmed = true;
    reachHoldTimer = setTimeout(()=>{
      showReachPad();
      cancelReachHold();
    },800);
  }
},{passive:true});
document.addEventListener('touchend',cancelReachHold,{passive:true});
document.addEventListener('touchcancel',cancelReachHold,{passive:true});
document.addEventListener('wheel',e=>{
  if(window.scrollY <= 1 && e.deltaY < -120)showReachPad();
},{passive:true});

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
  render();
});
$('confirm-no').addEventListener('click',()=>{pendingIdx = null;closeSheet('confirm-sheet');});
$('confirm-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){pendingIdx = null;closeSheet('confirm-sheet');}});

$('detail-save').addEventListener('click',()=>{
  if(detailIdx === null)return;
  const data = load();
  const h = data[detailIdx];
  if(!h)return;
  const current = currentDetailTune();
  if(!current.name){$('detail-habit-name').focus();return;}
  h.name = current.name.slice(0,60);
  h.type = current.type;
  h.emoji = current.emoji;
  h.pinned = current.pinned;
  h.target = current.type === 'zero' ? null : Math.max(1,Math.min(90,parseInt(current.target,10) || h.target || 7));
  h.lastLog = latestActualLog(h.logs);
  save(data);
  showToast('saved');
  closeSheet('detail-sheet');
  detailIdx = null;
  detailTuneOriginal = null;
  render();
});
$('detail-mark').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  openDetail(detailIdx);
  render();
});
$('detail-add').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  openDetail(detailIdx);
  render();
});
$('detail-cool').addEventListener('click',closeDetail);
$('detail-close').addEventListener('click',()=>{restoreDetailTune();closeDetail();});
$('detail-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeDetail();});
$('detail-sheet').querySelectorAll('.detail-actions button').forEach(btn=>{
  btn.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
});
bindCalendarTap($('detail-calendar'),'[data-entry-day]',day=>{
  if(!day || detailIdx === null)return;
  const h = load()[detailIdx];
  dayLogsKey = day.dataset.entryDay;
  renderCalendar(h);
  if(h && hasPlannedEntryForDay(h,day.dataset.entryDay)){
    renderDayLogs(dayLogsKey);
    openSheet('day-logs-sheet');
    return;
  }
  openDayEntry(detailIdx,day.dataset.entryDay);
});
$('detail-prev-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailMonthOffset -= 1;
  renderCalendar(load()[detailIdx]);
});
$('detail-next-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailMonthOffset += 1;
  renderCalendar(load()[detailIdx]);
});
$('detail-sheet').querySelector('.detail-pager')?.addEventListener('scroll',()=>{
  requestAnimationFrame(updateDetailPagerDots);
},{passive:true});

$('open-about').addEventListener('click',()=>openSheet('about-sheet'));
$('about-close').addEventListener('click',()=>closeSheet('about-sheet'));
$('about-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('about-sheet');});
$('about-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('open-settings').addEventListener('click',()=>{
  closeSheet('about-sheet');
  syncSettingsControls();
  openSheet('settings-sheet');
});
$('settings-close').addEventListener('click',()=>closeSheet('settings-sheet'));
$('settings-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('settings-sheet');});
$('settings-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('sort-focus-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-focus]');
  if(!opt)return;
  updateSortSetting({focus:opt.dataset.focus});
  showToast('order updated');
});
$('plan-window-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-window]');
  if(!opt)return;
  updateSortSetting({planWindowDays:parseInt(opt.dataset.window,10)});
  showToast('order updated');
});
$('default-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-default-type]');
  if(!opt)return;
  updateSortSetting({defaultType:opt.dataset.defaultType});
});
$('setting-plans-first').addEventListener('change',e=>updateSortSetting({plansFirst:e.target.checked}));
$('setting-stops-quiet').addEventListener('change',e=>updateSortSetting({keepStopsQuiet:e.target.checked}));
$('setting-show-snoozed').addEventListener('change',e=>updateSortSetting({showSnoozed:e.target.checked}));
$('setting-require-confirm').addEventListener('change',e=>updateSortSetting({requireConfirm:e.target.checked}));
$('setting-reach-assist').addEventListener('change',e=>updateSortSetting({reachAssist:e.target.checked}));
bindSettingRange('plan-weight','planWeight','%');
bindSettingRange('build-weight','buildWeight','%');
bindSettingRange('limit-weight','limitWeight','%');
bindSettingRange('stop-weight','stopWeight','%');
bindSettingRange('new-weight','newWeight','%');
bindSettingRange('default-target','defaultTarget','d');
$('settings-reset').addEventListener('click',()=>{
  saveSortSettings({...DEFAULT_SORT_SETTINGS});
  syncSettingsControls();
  render();
  showToast('settings reset');
});

$('open-overview').addEventListener('click',()=>{
  if(load().length < 2)return;
  overviewMonthOffset = 0;
  dayLogsKey = null;
  renderOverview();
  openSheet('overview-sheet');
});
$('overview-close').addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('overview-sheet');});
$('overview-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('overview-prev-month').addEventListener('click',()=>{
  overviewMonthOffset -= 1;
  renderOverview();
});
$('overview-next-month').addEventListener('click',()=>{
  overviewMonthOffset += 1;
  renderOverview();
});
bindCalendarTap($('overview-calendar'),'[data-log-day]',day=>{
  if(!day)return;
  dayLogsKey = day.dataset.logDay;
  renderOverview();
  renderDayLogs(dayLogsKey);
  openSheet('day-logs-sheet');
});
$('day-log-add').addEventListener('click',()=>{
  if(!dayLogsKey)return;
  const idx = parseInt($('day-log-ting').value,10);
  if(Number.isNaN(idx))return;
  const ts = new Date(`${dayLogsKey}T12:00:00`).getTime();
  if(!logTingAt(idx,ts))return;
  renderDayLogs(dayLogsKey);
  refreshOpenViews();
});
$('day-logs-list').addEventListener('click',e=>{
  const btn = e.target.closest('[data-remove-plan]');
  if(!btn)return;
  const idx = parseInt(btn.dataset.removePlan,10);
  const key = btn.dataset.planDay;
  const data = load();
  const h = data[idx];
  if(!h)return;
  const planned = (h.logs || []).filter(ts=>dateKey(ts) === key && ts > Date.now());
  if(!planned.length)return;
  planned.forEach(ts=>removeEntryAt(idx,ts));
  showToast('plan removed');
  refreshOpenViews();
});

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
  const ts = dayEntryTs;
  if(!logTingAt(dayEntryIdx,ts))return;
  closeSheet('day-entry-sheet');
  dayEntryIdx = null;
  dayEntryTs = null;
  refreshOpenViews();
});
$('day-entry-cancel').addEventListener('click',()=>{dayEntryIdx = null;dayEntryTs = null;closeSheet('day-entry-sheet');});
$('day-entry-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){dayEntryIdx = null;dayEntryTs = null;closeSheet('day-entry-sheet');}});

$('day-logs-close').addEventListener('click',()=>{dayLogsKey = null;closeSheet('day-logs-sheet');});
$('day-logs-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){dayLogsKey = null;closeSheet('day-logs-sheet');}});
$('day-logs-sheet').addEventListener('pointerup',e=>{if(e.target === e.currentTarget){dayLogsKey = null;closeSheet('day-logs-sheet');}});
$('undo-action').addEventListener('click',undoLastAction);

$('list').addEventListener('touchstart',e=>{
  if(swipeOpenCard && !e.target.closest('.swipe-actions') && !e.target.closest('.ting-card'))closeAllSwipes();
},{passive:true});

render();
