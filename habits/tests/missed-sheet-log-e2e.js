/**
 * The missed ("slipped") sheet must let you clear an item in one tap: the icon
 * is a log affordance (same pulse look + "+" badge as a card). Tapping it logs
 * the habit and removes it from the sheet at once, and the home "missed" pill
 * recounts without a cold restart. Tapping the rest of the row still reviews.
 *
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/missed-sheet-log-e2e.js
 */
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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

async function freezeClock(page, clockTs){
  await page.addInitScript((clock) => {
    const RealDate = globalThis.Date;
    function FrozenDate(...a){ return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    // Run the planner on the main thread against the frozen clock (addInitScript
    // never reaches worker contexts).
    try{
      if(typeof globalThis.Worker !== 'function')return;
      if(globalThis.__tingsPlannerStubInstalled)return;
      globalThis.__tingsPlannerStubInstalled = true;
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
                setTimeout(() => {
                  let week = null, error = null;
                  try{
                    if(typeof buildWeekAgenda !== 'function')throw new Error('buildWeekAgenda unavailable');
                    const settings = { ...(message.settings || {}), agendaOptimizer:false };
                    week = buildWeekAgenda(message.data, settings, message.numDays || 7, {});
                    if(message.mode === 'exact')week.optimized = true;
                  }catch(err){ error = String(err && err.message ? err.message : err); }
                  fire('message', error ? { id, error } : { id, week });
                }, 0);
              }
            };
            return fake;
          }
          super(url, options);
        }
      };
    }catch(_){}
  }, clockTs);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`); });

  const clockTs = at(10, 0);
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await freezeClock(page, clockTs);

  const DAY = 86400000;
  const settings = defaultSettings({ showWeekOnHome:true });
  const data = [
    // Due today, placed in today's timeline so the today header (and its missed
    // pill) render.
    base({ name:'Read', type:'keepup', target:2, durationMinutes:30,
      lastLog:clockTs - 3 * DAY, logs:[clockTs - 3 * DAY], dueDate:null, priority:1 }),
    // Overdue: daily, but its 6–9am window has already closed at the 10am frozen
    // clock, so it lands in the missed pill rather than today's timeline.
    base({ name:'Walk', type:'keepup', target:1, durationMinutes:30,
      allowedTimeStart:360, allowedTimeEnd:540,
      lastLog:clockTs - 2 * DAY, logs:[clockTs - 2 * DAY], dueDate:null, priority:1 })
  ];
  await page.evaluate(({ data, settings }) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  }, { data, settings });
  await page.reload({ waitUntil:'networkidle' });

  // Wait for today's card + the missed pill.
  await page.waitForSelector('.dropped-pill', { timeout:10000 });
  assert((await page.locator('.dropped-pill').textContent()).includes('missed'), 'missed pill shows');
  console.log('  ok: missed pill present');

  // Open the slipped sheet.
  await page.locator('.dropped-pill').click();
  await page.waitForSelector('#slipped-sheet.open .dropped-item', { timeout:5000 });
  const items = await page.$$eval('#slipped-sheet .dropped-name', els => els.map(e => e.textContent.trim()));
  assert(items.includes('Walk'), `Walk listed in missed sheet (got ${items.join(',')})`);
  assert(await page.locator('#slipped-sheet .dropped-item:has-text("Walk") .dropped-log').count() === 1,
    'Walk row has a log (icon) button');
  console.log('  ok: Walk listed with a log affordance');

  // Tap the icon — this should log Walk and drop it from the sheet live.
  const before = await page.evaluate(() => {
    const h = load().find(x => x.name === 'Walk');
    return normalizeLogs(h.logs).filter(l => !isPlanLog(l)).length;
  });
  await page.locator('#slipped-sheet .dropped-item:has-text("Walk") .dropped-log').click();
  await page.waitForFunction(before => {
    const h = load().find(x => x.name === 'Walk');
    return normalizeLogs(h.logs).filter(l => !isPlanLog(l)).length === before + 1;
  }, before, { timeout:5000 });
  console.log('  ok: tapping the icon logged Walk');

  // The row must leave the sheet at once (no reload).
  await page.waitForFunction(() => document.querySelectorAll('#slipped-sheet .dropped-item').length === 0
    || document.querySelectorAll('#slipped-sheet .dropped-item:has-text("Walk")').length === 0, { timeout:5000 })
    .catch(() => {});
  const stillListed = await page.locator('#slipped-sheet .dropped-item:has-text("Walk")').count();
  assert(stillListed === 0, 'Walk removed from missed sheet after logging (live)');
  console.log('  ok: Walk removed from sheet live');

  // The home pill must recount (Walk is now completedToday) without a reload.
  // Re-open the sheet if present; better, assert the pill text dropped / vanished.
  const pill = await page.locator('.dropped-pill').count();
  assert(pill === 0, `missed pill gone after logging the only missed item (got count=${pill})`);
  console.log('  ok: missed pill recounted to empty');

  assert(errors.length === 0, `unexpected page errors: ${errors.join(' | ')}`);
  console.log('  ok: no page errors');

  await browser.close();
  console.log('\nmissed-sheet-log-e2e: PASS');
})().catch(err => {
  console.error('\nmissed-sheet-log-e2e: FAIL —', err.message);
  process.exit(1);
});
