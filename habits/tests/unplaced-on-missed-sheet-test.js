/**
 * The missed sheet lists planner leftovers that never landed on the agenda,
 * in a separate section. Those rows stay out of the today-header "N missed"
 * count. A miss that is also absent from the current agenda stays in the
 * missed section only.
 *
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/unplaced-on-missed-sheet-test.js
 */
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(cond, msg){
  if(!cond)throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  const clock = new Date();
  clock.setHours(10, 0, 0, 0);
  const now = clock.getTime();
  const dayMs = 86400000;

  await page.addInitScript(clockTs => {
    window.testClock = clockTs;
    const RealDate = window.Date;
    window.Date = class extends RealDate {
      constructor(...args){ super(...(args.length ? args : [window.testClock])); }
      static now(){ return window.testClock; }
    };
    window.Date.parse = RealDate.parse;
    window.Date.UTC = RealDate.UTC;
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_coach_essentials_v2', 'done');
    localStorage.setItem('tings_coach_install_v2', 'done');
    // Replans after a log must use the frozen clock. A real worker would plan
    // at wall time and drop the still-doable item once its test window closed.
    try{
      if(typeof globalThis.Worker !== 'function' || globalThis.__tingsPlannerStubInstalled)return;
      globalThis.__tingsPlannerStubInstalled = true;
      const RealWorker = globalThis.Worker;
      globalThis.Worker = class extends RealWorker {
        constructor(url, options){
          if(String(url).includes('agenda-planner-worker')){
            const listeners = { message:[], error:[] };
            const fake = {
              addEventListener(type, cb){ if(listeners[type])listeners[type].push(cb); },
              removeEventListener(type, cb){ if(listeners[type])listeners[type] = listeners[type].filter(fn => fn !== cb); },
              terminate(){},
              postMessage(message){
                if(!message || typeof message !== 'object')return;
                const id = message.id;
                const fire = (type, data) => { for(const cb of [...(listeners[type] || [])]){ try{ cb({ data, type }); }catch(_){} } };
                if(message.warm){ setTimeout(() => fire('message', { id, ready:true }), 0); return; }
                setTimeout(() => {
                  let week = null, error = null;
                  try{
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
  }, now);

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(200);

  const settings = {
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false,
    topics:[], locations:[], travel:{}, defaultTravelMode:'driving',
    blockedTimes:[
      { label:'sleep', days:[], start:0, end:420 },
      { label:'afternoon', days:[], start:720, end:1440 }
    ]
  };
  const habits = [
    { hid:'read-1', name:'Read', emoji:'📚', type:'keepup', target:1, durationMinutes:30,
      lastLog:now - 2 * dayMs, logs:[now - 2 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:null, dueDate:null, priority:1 },
    { hid:'walk-1', name:'Walk', emoji:'🚶', type:'keepup', target:1, durationMinutes:30,
      allowedTimeStart:360, allowedTimeEnd:540,
      lastLog:now - 2 * dayMs, logs:[now - 2 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:null, dueDate:null, priority:1 },
    { hid:'report-1', name:'Ship report', emoji:'📄', type:'task', target:null, durationMinutes:720,
      logs:[], lastLog:null, createdAt:now - 30 * dayMs, dueDate:now, eventTime:null,
      flexibilityDays:0, delayAllowanceDays:0, pinned:false, snoozedUntil:null,
      markDone:true, priority:1 },
    { hid:'someday-1', name:'Someday note', emoji:'📝', type:'task', target:null, durationMinutes:30,
      logs:[], lastLog:null, createdAt:now - 30 * dayMs, dueDate:null, eventTime:null,
      flexibilityDays:0, pinned:false, snoozedUntil:null, markDone:true, priority:2 },
    { hid:'snooze-1', name:'Parked', emoji:'🌙', type:'keepup', target:1, durationMinutes:30,
      lastLog:now - 2 * dayMs, logs:[now - 2 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:now + 2 * dayMs, dueDate:null, priority:1 }
  ];

  async function paint(){
    await page.evaluate(({ habits, settings }) => {
      localStorage.setItem('tings_v2', JSON.stringify(habits));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
      localStorage.removeItem('tings_today_suggested_v1');
      localStorage.removeItem('tings_missed_hidden_v1');
      if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
      render({ __optimizedWeek:buildWeekAgenda(load(), sortSettings, 7) });
    }, { habits, settings });
  }

  await paint();
  await page.waitForSelector('.dropped-pill', { timeout:10000 });
  const pillText = (await page.locator('.dropped-pill').textContent()).replace(/\s+/g, ' ').trim();
  assert(pillText === '1 missed', `home count stays the missed rows only (got "${pillText}")`);
  assert(await page.locator('.dropped-pill').getAttribute('data-kind') === 'missed', 'pill is the missed count');
  console.log('  ok: home count ignores the unplaced task');

  await page.locator('.dropped-pill').click();
  await page.locator('#slipped-sheet.open .dropped-item').first().waitFor();
  const sheet = await page.evaluate(() => {
    const head = sel => [...document.querySelectorAll(sel)].map(el => el.textContent.trim());
    return {
      title:document.getElementById('slipped-title').textContent.trim(),
      sections:head('#slipped-sheet .slipped-section-head'),
      missed:[...document.querySelectorAll('#slipped-sheet .dropped-item:not([data-unplaced]) .dropped-name')].map(el => el.textContent.trim()),
      unplaced:[...document.querySelectorAll('#slipped-sheet .dropped-item[data-unplaced="1"] .dropped-name')].map(el => el.textContent.trim()),
      unplacedCue:[...document.querySelectorAll('#slipped-sheet .dropped-item[data-unplaced="1"] small')].map(el => el.textContent.trim()),
      unplacedHide:document.querySelectorAll('#slipped-sheet .dropped-item[data-unplaced="1"] .dropped-hide, #slipped-sheet .dropped-item[data-unplaced="1"] .dropped-show').length,
      missedHide:document.querySelectorAll('#slipped-sheet .dropped-item:not([data-unplaced]) .dropped-hide').length
    };
  });
  assert(sheet.title === 'missed · today', `title stays on the missed list (got "${sheet.title}")`);
  assert(sheet.sections[0] === 'missed · today', `missed section stays first (got ${sheet.sections.join(' | ')})`);
  assert(sheet.sections.includes('not placed'), `not placed section is present (got ${sheet.sections.join(' | ')})`);
  assert(sheet.missed.length === 1 && sheet.missed[0] === 'Walk', `missed section is Walk only (got ${sheet.missed.join(', ')})`);
  assert(sheet.unplaced.length === 1 && sheet.unplaced[0] === 'Ship report', `unplaced section is Ship report only (got ${sheet.unplaced.join(', ')})`);
  assert(sheet.unplacedCue[0] === 'No room on the agenda', `unplaced row explains the miss (got "${sheet.unplacedCue[0]}")`);
  assert(sheet.unplacedHide === 0, 'unplaced rows have no hide control');
  assert(sheet.missedHide === 1, 'the missed row keeps its hide control');
  console.log('  ok: sheet separates the miss from the item that never fit');

  const listed = await page.evaluate(() => collectUnplacedAgendaItems(load(), sortSettings, collectDroppedItems(load(), sortSettings, [])).map(row => row.name));
  assert(listed.length === 1 && listed[0] === 'Ship report', `collector matches the sheet (got ${listed.join(', ')})`);
  console.log('  ok: collector omits misses, placed work, someday tasks, and snoozes');

  await page.locator('#slipped-close').click();
  await page.waitForSelector('#slipped-sheet:not(.open)', { timeout:3000 });
  habits.splice(1, 1);
  await paint();
  await page.waitForSelector('.dropped-pill.is-quiet', { timeout:5000 });
  const quiet = await page.evaluate(() => {
    const pill = document.querySelector('.dropped-pill');
    return {
      kind:pill && pill.dataset.kind,
      label:pill && pill.getAttribute('aria-label'),
      text:(pill && pill.textContent || '').replace(/\s+/g, ' ').trim()
    };
  });
  assert(quiet.kind === 'unplaced', 'a day with only unplaced work uses the quiet chip');
  assert(quiet.label === 'not placed', 'quiet chip is labeled not placed');
  assert(!/missed|\d/.test(quiet.text), `quiet chip has no missed count (got "${quiet.text}")`);
  await page.locator('.dropped-pill').click();
  await page.locator('#slipped-sheet.open [data-section="unplaced"]').waitFor();
  const only = await page.evaluate(() => ({
    title:document.getElementById('slipped-title').textContent.trim(),
    sections:[...document.querySelectorAll('#slipped-sheet .slipped-section-head')].map(el => el.textContent.trim()),
    names:[...document.querySelectorAll('#slipped-sheet .dropped-name')].map(el => el.textContent.trim())
  }));
  assert(only.title === 'not placed · today', `title follows the only section (got "${only.title}")`);
  assert(only.sections.length === 1 && only.sections[0] === 'not placed', `sheet is only the unplaced section (got ${only.sections.join(' | ')})`);
  assert(only.names.length === 1 && only.names[0] === 'Ship report', `only the unplaced task is listed (got ${only.names.join(', ')})`);
  console.log('  ok: no missed count when the sheet is only unplaced work');

  await page.locator('#slipped-sheet .dropped-item[data-unplaced="1"] .dropped-log').click();
  await page.waitForFunction(() => {
    const task = load().find(h => h.name === 'Ship report');
    const pill = document.querySelector('.dropped-pill');
    return task && isTaskDone(task) && !pill && !document.getElementById('slipped-sheet').classList.contains('open');
  }, null, { timeout:8000 });
  console.log('  ok: logging the unplaced task clears the chip');

  assert(errors.length === 0, `unexpected page errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('\nunplaced-on-missed-sheet-test: PASS');
})().catch(err => {
  console.error('\nunplaced-on-missed-sheet-test: FAIL —', err.message);
  process.exit(1);
});
