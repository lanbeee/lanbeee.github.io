// Reminders — a deliberately minimal, anti-nag heads-up system.
//
// Design constraints (see EGO's_EXPANSION.md §"Stretch: Web Push reminders"):
//  - The app is anti-nag for rhythm habits by design. Reminders ONLY cover the
//    two rigid shapes: a hard-due task, or an event starting soon.
//  - On iOS Safari (PWA), system notifications can't fire while the app is
//    closed without a push backend. So the reliable channel is an in-app banner
//    shown on launch / when the user returns. System notifications are layered
//    on top where supported (desktop), and the service-worker push/click
//    handlers in sw.js are forward-compatible for when a backend exists.
//  - "Not too many": each item is reminded at most once per day (persisted
//    dedupe), the banner consolidates everything into one row, and a dismissed
//    banner stays gone until a *new* item appears.
//
// RN port: gatherReminders() ports verbatim; the banner becomes a React Native
// in-app notification/local-notification scheduler.

const REMINDER_EVENT_WINDOW_MS = 60 * 60 * 1000; // events starting within 1 hour
const REMINDER_KEY = 'tings_reminders_v1';

// PURE: stable signature for dedupe. Name + type + the fixed timestamp is
// stable enough for a per-day dedupe set (ids aren't part of the schema).
function reminderSignature(h){
  const ts = h.type === 'event' ? h.eventTime : h.dueDate;
  return `${h.type}|${h.name || ''}|${ts || ''}`;
}

// PURE: gather actionable reminders. Hard-due tasks that are overdue/due today
// and not done, plus events starting within the next hour. Sorted: soonest
// event first, then overdue tasks. Returns [{h, i, kind, title, body, sig}].
function gatherReminders(data,now = Date.now()){
  const out = [];
  data.forEach((h,i)=>{
    if(h.type === 'task' && h.hardDue && h.dueDate !== null && h.lastLog === null){
      const left = daysUntil(h.dueDate);
      if(left !== null && left <= 0){
        out.push({
          h,i,kind:'task',sig:reminderSignature(h),
          title:left === 0 ? 'Task due today' : `${Math.abs(left)}d past deadline`,
          body:h.name + (h.topics.length ? ` · ${h.topics.join(', ')}` : '')
        });
      }
    }
    if(h.type === 'event' && h.eventTime !== null){
      const ms = h.eventTime - now;
      if(ms >= 0 && ms <= REMINDER_EVENT_WINDOW_MS){
        const mins = Math.max(0,Math.round(ms / 60000));
        out.push({
          h,i,kind:'event',sig:reminderSignature(h),
          title:mins <= 1 ? 'Event starting now' : `Event in ${mins} min`,
          body:h.name + ' · ' + agendaTimeLabel(h.eventTime)
        });
      }
    }
  });
  // Events lead (they're time-critical "happening now"), soonest first; then
  // hard-due tasks, most-overdue first.
  out.sort((a,b)=>{
    if(a.kind !== b.kind)return a.kind === 'event' ? -1 : 1;
    if(a.kind === 'event')return (a.h.eventTime || 0) - (b.h.eventTime || 0);
    return (a.h.dueDate || 0) - (b.h.dueDate || 0);
  });
  return out;
}

// HYBRID: load today's dedupe state (reset when the calendar day changes).
function loadReminderState(){
  const today = todayIso();
  try{
    const raw = localStorage.getItem(REMINDER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if(parsed && parsed.date === today)return {date:today,notified:new Set(parsed.notified || []),dismissed:new Set(parsed.dismissed || [])};
  }catch(_){}
  return {date:today,notified:new Set(),dismissed:new Set()};
}

// HYBRID: persist today's dedupe state.
function saveReminderState(state){
  try{
    localStorage.setItem(REMINDER_KEY,JSON.stringify({
      date:state.date,
      notified:[...state.notified],
      dismissed:[...state.dismissed]
    }));
  }catch(_){}
}

// PURE: best-effort system notification, never throws. On iOS Safari PWA this
// is a no-op outside a push event; the in-app banner is the reliable channel.
async function trySystemNotification(title,body,tag){
  try{
    if(!('Notification' in window) || Notification.permission !== 'granted')return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const opts = {body,tag,renotify:false,silent:false};
    if(reg && typeof reg.showNotification === 'function'){
      await reg.showNotification(title,opts);
    }else if(typeof Notification === 'function'){
      new Notification(title,opts);
    }
  }catch(_){}
}

// HYBRID: main entry. Checks settings + state, fires one system notification
// per *new* item (deduped per day) and renders the consolidated banner.
let reminderBannerCache = [];
function checkReminders(options = {}){
  const settings = sortSettings || loadSortSettings();
  if(!settings.reminders){hideReminderBanner();return;}
  const data = load();
  const reminders = gatherReminders(data);
  const state = loadReminderState();

  // Fire one system notification per newly-due item (max 3/run to avoid spam).
  let fired = 0;
  for(const r of reminders){
    if(state.notified.has(r.sig))continue;
    if(fired >= 3)break;
    state.notified.add(r.sig);
    trySystemNotification(r.title,r.body,r.sig);
    fired += 1;
  }
  if(fired)saveReminderState(state);

  // Banner = actionable items not dismissed today.
  const bannerItems = reminders.filter(r=>!state.dismissed.has(r.sig));
  renderReminderBanner(bannerItems);
}

// RENDER: draw (or hide) the consolidated reminder banner.
function renderReminderBanner(items){
  const banner = $('reminder-banner');
  if(!banner)return;
  reminderBannerCache = items;
  if(!items.length){banner.hidden = true;banner.innerHTML = '';return;}
  banner.hidden = false;
  const count = items.length;
  const first = items[0];
  const isEvent = first.kind === 'event';
  const icon = isEvent ? 'ti-clock-hour-4' : 'ti-alert-triangle';
  const summary = count === 1
    ? first.title
    : `${count} items need attention`;
  const names = items.slice(0,2).map(r=>escapeHtml(r.h.name)).join(' · ') + (count > 2 ? ' · …' : '');
  banner.innerHTML = `
    <button class="reminder-main" id="reminder-go" type="button">
      <i class="ti ${icon}" aria-hidden="true"></i>
      <span class="reminder-text"><b>${escapeHtml(summary)}</b><small>${names}</small></span>
    </button>
    <button class="reminder-dismiss" id="reminder-dismiss" type="button" aria-label="dismiss">
      <i class="ti ti-x" aria-hidden="true"></i>
    </button>`;
  $('reminder-go').addEventListener('click',()=>{
    if(count === 1 && typeof openDetail === 'function')openDetail(first.i);
    else if(typeof openToday === 'function')openToday();
  });
  $('reminder-dismiss').addEventListener('click',()=>dismissReminderBanner(items));
}

// HYBRID: hide the banner and record dismissals so they don't reappear today.
function dismissReminderBanner(items){
  const state = loadReminderState();
  items.forEach(r=>state.dismissed.add(r.sig));
  saveReminderState(state);
  hideReminderBanner();
}

// RENDER: hide the banner element.
function hideReminderBanner(){
  const banner = $('reminder-banner');
  if(banner){banner.hidden = true;banner.innerHTML = '';}
  reminderBannerCache = [];
}

// HANDLER: request notification permission (called from a user gesture — the
// settings toggle). Returns the permission string.
async function requestReminderPermission(){
  if(!('Notification' in window))return 'unsupported';
  try{
    if(Notification.permission === 'granted')return 'granted';
    if(Notification.permission === 'denied')return 'denied';
    return await Notification.requestPermission();
  }catch(_){
    return 'default';
  }
}

// WIRE: periodic + event-driven reminder checks. Called once at startup.
let reminderIntervalId = null;
function initReminders(){
  checkReminders();
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)setTimeout(checkReminders,300);
  });
  window.addEventListener('focus',()=>checkReminders());
  if(reminderIntervalId)clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkReminders,5 * 60 * 1000); // every 5 min while open
}
