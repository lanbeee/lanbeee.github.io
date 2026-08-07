/**
 * E2E: a breakable daily keepup habit must stay on the home list and agenda
 * after a partial chunk log.  Before the fix, logging one chunk set
 * lastLog=today which made completedToday() true (hiding the card) and made
 * isWeekCandidate() reject today (removing all agenda chunks).
 */
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function at(hour, minute = 0){ const d = new Date(); d.setHours(hour, minute, 0, 0); return d.getTime(); }
const ok = [];
const fail = [];
function assert(name, cond){ (cond ? ok : fail).push(name); if(!cond) console.error('FAIL:', name); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const clockTs = at(9, 0);
  await page.addInitScript(clock => { const R=window.Date; function F(...a){return a.length?new R(...a):new R(clock);} F.now=()=>clock; Object.setPrototypeOf(F,R); F.prototype=R.prototype; window.Date=F; }, clockTs);
  await page.goto(BASE, { waitUntil:'networkidle' });

  const mk = (name) => ({
    name, type:'keepup', breakable:true, durationMinutes:90, minChunkMinutes:15,
    dueDate:at(0,0), target:1, flexibilityDays:0,
    logs:[], emoji:'W', pinned:false, sample:false, snoozedUntil:null,
    topics:[], allowedWeekdays:[], allowedMonthDays:[], preferredWeekdays:[],
    preferredMonthDays:[], eventTime:null, hardDue:false, markDone:true,
    autoMarkMinutes:null, trackValue:false, createdAt:Date.now(), locationIds:[],
    priority:1, source:null, externalId:null, importedAt:null, planByDate:null,
    hid:name, allowedTimeStart:null, allowedTimeEnd:null,
    preferredTimeStart:null, preferredTimeEnd:null
  });
  const data = [ mk('Work') ];
  const settings = {
    preset:'todayFirst', showWeekOnHome:false, focus:'balanced',
    availabilityMinutes:[720,720,720,720,720,720,720], availabilityOverrides:{},
    blockedTimes:[{label:'sleep',days:[],start:0,end:420}],
    showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
    showTaskDateOnCards:true, showPlansOnCards:true, showTimeWindowOnCards:true,
    agendaOptimizer:false, defaultBreakable:true
  };
  await page.evaluate(({data,settings}) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { data, settings });
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  // ── 1. Card visible before any log ──
  let cardVisible = await page.evaluate(() => {
    return !!document.querySelector('#list .swipe-row[data-hid="Work"]');
  });
  assert('A — Work card visible before log', cardVisible);

  // ── 2. completedToday returns false with no logs ──
  let ct0 = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Work');
    return completedToday(h);
  });
  assert('B — completedToday false with no logs', ct0 === false);

  // ── 3. Log a partial chunk (15m of 90m) ──
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tings_v2'));
    const h = raw.find(x=>x.hid==='Work');
    h.logs = [{ ts: Date.now(), minutes: 15, note: 'manual' }];
    h.lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(raw));
  });
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  // ── 4. completedToday still false after partial log ──
  let ct1 = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Work');
    return completedToday(h);
  });
  assert('C — completedToday false after partial log (15/90)', ct1 === false);

  // ── 5. Card still visible after partial log ──
  let cardAfterPartial = await page.evaluate(() => {
    return !!document.querySelector('#list .swipe-row[data-hid="Work"]');
  });
  assert('D — Work card still visible after partial log', cardAfterPartial);

  // ── 6. isWeekCandidate returns true for today after partial log ──
  let eligible = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Work');
    const s = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
    const dayBase = dayStart(Date.now());
    const weekday = new Date().getDay();
    return isWeekCandidate(h, s, dayBase, weekday);
  });
  assert('E — isWeekCandidate true for today after partial log', eligible === true);

  // ── 7. Log the full remaining budget → completedToday true ──
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tings_v2'));
    const h = raw.find(x=>x.hid==='Work');
    h.logs = [{ ts: Date.now(), minutes: 90, note: 'manual' }];
    h.lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(raw));
  });
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  let ct2 = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Work');
    return completedToday(h);
  });
  assert('F — completedToday true after full log (90/90)', ct2 === true);

  // ── 7b. Fully-logged breakable is no longer a week candidate for today ──
  let eligibleAfterFull = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Work');
    const s = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
    const dayBase = dayStart(Date.now());
    const weekday = new Date().getDay();
    return isWeekCandidate(h, s, dayBase, weekday);
  });
  assert('G — isWeekCandidate false for today after full log', eligibleAfterFull === false);

  // ── 8. Non-breakable keepup: any log = completedToday (unchanged behavior) ──
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tings_v2'));
    const existing = raw.find(x=>x.hid==='Read');
    if(!existing){
      const tpl = raw.find(x=>x.hid==='Work');
      raw.push({ ...tpl, name:'Read', hid:'Read', breakable:false, durationMinutes:30,
        logs:[{ts:Date.now(),minutes:5,note:'manual'}], lastLog:Date.now() });
      localStorage.setItem('tings_v2', JSON.stringify(raw));
    }
  });
  let ctNonBreakable = await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('tings_v2')).find(x=>x.hid==='Read');
    return h ? completedToday(h) : null;
  });
  assert('H — non-breakable completedToday true after any log', ctNonBreakable === true);

  await browser.close();

  console.log(`\n${ok.length} passed, ${fail.length} failed`);
  if(fail.length){ console.log('FAILED:', fail.join(', ')); process.exit(1); }
  console.log('All breakable partial-log cases passed.');
})();
