/**
 * Logging a habit must remove it from today's agenda live — without a cold
 * restart. In week-on-home mode the home list repaints from a stale/cached
 * planner week while the worker re-solves asynchronously; that stale repaint
 * (renderHomePresentationOnly, fired by the pulse handler) must not keep a
 * just-logged — no-longer-due — card on screen.
 *
 * This drives the REAL pulse button and asserts the card leaves today's
 * section on its own (no page.reload). The planner worker is stubbed so the
 * FIRST solve mounts quickly but every later re-solve stalls, isolating the
 * stale-repaint (the path a user sees between a tap and a slow GLPK re-solve).
 *
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/log-live-removal-e2e.js
 */
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const RESOLVE_DELAY_MS = 30000; // stall every re-solve after the first

function assert(cond, msg){ if(!cond)throw new Error(msg); }
function at(hour, minute = 0){ const d = new Date(); d.setHours(hour, minute, 0, 0); return d.getTime(); }
function base(props){
  return Object.assign({
    name:'item', type:'task', target:null, flexibilityDays:0,
    durationMinutes:30, breakable:false, minChunkMinutes:30,
    allowedTimeStart:null, allowedTimeEnd:null, preferredTimeStart:null, preferredTimeEnd:null,
    lastLog:null, logs:[], emoji:'', pinned:false, sample:false, snoozedUntil:null,
    topics:[], allowedWeekdays:[], allowedMonthDays:[], preferredWeekdays:[], preferredMonthDays:[],
    dueDate:at(0, 0), eventTime:null, hardDue:false, markDone:true, createdAt:Date.now(),
    locationIds:[], priority:1
  }, props);
}
function defaultSettings(o = {}){
  return Object.assign({
    preset:'todayFirst', showWeekOnHome:false, focus:'balanced',
    availabilityMinutes:[720, 720, 720, 720, 720, 720, 720], availabilityOverrides:{},
    blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }],
    showScheduledTasksInAgenda:true, showDueTasksInAgenda:true, showPlannedItemsInAgenda:true,
    showDueHabitsInAgenda:true, showTaskDateOnCards:true, showPlansOnCards:true,
    showTimeWindowOnCards:true, agendaOptimizer:false
  }, o);
}

async function freezeClock(page, clockTs, delay){
  await page.addInitScript(({ clock, delay }) => {
    const RealDate = globalThis.Date;
    function FrozenDate(...a){ return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    // Run the planner on the main thread against the frozen clock (addInitScript
    // never reaches worker contexts). The first solve mounts the home list; every
    // later solve stalls so the post-log stale-repaint is what's under test.
    try{
      if(typeof globalThis.Worker !== 'function')return;
      if(globalThis.__tingsPlannerStubInstalled)return;
      globalThis.__tingsPlannerStubInstalled = true;
      globalThis.__stubSolveCount = 0;
      const RealWorker = globalThis.Worker;
      globalThis.Worker = class extends RealWorker {
        constructor(url, options){
          if(String(url).includes('agenda-planner-worker')){
            const listeners = { message: [], error: [] };
            const fake = {
              addEventListener(type, cb){ if(listeners[type])listeners[type].push(cb); },
              removeEventListener(type, cb){ if(listeners[type])listeners[type] = listeners[type].filter(f => f !== cb); },
              terminate(){},
              postMessage(message){
                if(!message || typeof message !== 'object')return;
                const id = message.id;
                const fire = (type, data) => { for(const cb of [...(listeners[type] || [])]){ try{ cb({ data, type }); }catch(_){} } };
                if(message.warm){ setTimeout(() => fire('message', { id, ready:true }), 0); return; }
                const count = ++globalThis.__stubSolveCount;
                const when = count <= 1 ? 0 : delay;
                setTimeout(() => {
                  let week = null, error = null;
                  try{
                    if(typeof buildWeekAgenda !== 'function')throw new Error('buildWeekAgenda unavailable');
                    const settings = { ...(message.settings || {}), agendaOptimizer:false };
                    week = buildWeekAgenda(message.data, settings, message.numDays || 7, {});
                    if(message.mode === 'exact')week.optimized = true;
                  }catch(err){ error = String(err && err.message ? err.message : err); }
                  fire('message', error ? { id, error } : { id, week });
                }, when);
              }
            };
            return fake;
          }
          super(url, options);
        }
      };
    }catch(_){}
  }, { clock: clockTs, delay });
}

async function seedAndReload(page, { data, settings, clockTs }){
  await page.evaluate(({ data, settings }) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  }, { data, settings });
  await page.reload({ waitUntil:'networkidle' });
  if(clockTs != null){
    const now = await page.evaluate(() => Date.now());
    assert(Math.abs(now - clockTs) < 2000, `clock freeze lost: ${now} vs ${clockTs}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`); });

  const clockTs = at(10, 0);
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await freezeClock(page, clockTs, RESOLVE_DELAY_MS);

  const DAY = 86400000;
  const settings = defaultSettings({ showWeekOnHome:true });
  const data = [
    // Non-breakable keepup, due today (last logged 3 days ago, every 2 days).
    // Placed in today's timeline; logging makes it completedOnDay so it must
    // leave today's section at once.
    base({ name:'Read', type:'keepup', target:2, durationMinutes:30,
      lastLog:clockTs - 3 * DAY, logs:[clockTs - 3 * DAY], dueDate:null, priority:1 })
  ];
  await seedAndReload(page, { data, settings, clockTs });

  // First solve mounts the card in today.
  await page.waitForFunction((name) => {
    const todayBase = dayStart(Date.now());
    const row = document.querySelector(`#list .swipe-row[data-day-base="${todayBase}"]`);
    return !!(row && (row.textContent || '').includes(name));
  }, 'Read', { timeout:10000 });
  console.log('  ok: Read card mounted in today before log');

  // Drive the REAL pulse button on today's card (the planner also places this
  // every-2-day habit on future days — scope by today's day-base).
  const before = await page.evaluate(() => {
    const h = load().find(x => x.name === 'Read');
    return normalizeLogs(h.logs).filter(l => !isPlanLog(l)).length;
  });
  const todayBase = await page.evaluate(() => dayStart(Date.now()));
  await page.locator(`.swipe-row[data-day-base="${todayBase}"]:has-text("Read") .pulse-btn`).first().click();
  await page.waitForFunction(before => {
    const h = load().find(x => x.name === 'Read');
    return normalizeLogs(h.logs).filter(l => !isPlanLog(l)).length === before + 1;
  }, before, { timeout:5000 });
  console.log('  ok: pulse persisted an actual log');

  // The card must leave today's section on its own (no reload). The stale
  // repaint fires ~400ms after the tap; the re-solve is stalled, so this
  // measures exactly the repaint — the path the user sees right after logging.
  const leftToday = await page.waitForFunction((name) => {
    const todayBase = dayStart(Date.now());
    const rows = document.querySelectorAll(`#list .swipe-row[data-day-base="${todayBase}"]`);
    for(const row of rows){
      const card = row.querySelector('.ting-card');
      if(card && (card.textContent || '').includes(name))return false;
    }
    return true;
  }, 'Read', { timeout:6000 }).then(() => true).catch(() => false);
  assert(leftToday, 'Read card left today section after log (live, no reload)');
  console.log('  ok: Read card left today live after log');

  assert(errors.length === 0, `unexpected page errors: ${errors.join(' | ')}`);
  console.log('  ok: no page errors');

  await browser.close();
  console.log('\nlog-live-removal-e2e: PASS');
})().catch(err => {
  console.error('\nlog-live-removal-e2e: FAIL —', err.message);
  process.exit(1);
});
