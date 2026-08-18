// swipe-crown-arbitration — breakable dial vs card-swipe gesture split:
//
//   A. Left drag on the dial at the committed floor stays with the dial
//      (dead-stops at the floor) — never a card swipe.
//   B. Right drag on the dial scrubs (target rises, no swipe).
//   C. Left drag on the dial with a raised target unwinds it — still no swipe.
//   D. One gesture: scrub right, keep dragging left past the floor → the dial
//      keeps the gesture the whole way; target clamps at the floor, no swipe.
//   E. Right swipe (green panel) from an off-dial surface still works.
//   F. Left drag from the dedicated right-edge scrub hint still swipes.
//   G. Normal (non-breakable) cards swipe both directions unchanged, and at
//      snap-open the revealed buttons sit fully clear of the card on BOTH
//      sides (outer-edge anchoring; the corner-pad zone under the card's
//      rounded corner stays empty backing).
//   H. No page errors.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/swipe-crown-arbitration-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function at(hour, minute = 0){
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function base(props){
  return Object.assign({
    name:'item',
    type:'task',
    target:null,
    flexibilityDays:0,
    durationMinutes:30,
    breakable:false,
    minChunkMinutes:30,
    allowedTimeStart:null,
    allowedTimeEnd:null,
    preferredTimeStart:null,
    preferredTimeEnd:null,
    lastLog:null,
    logs:[],
    emoji:'',
    pinned:false,
    sample:false,
    snoozedUntil:null,
    topics:[],
    allowedWeekdays:[],
    allowedMonthDays:[],
    preferredWeekdays:[],
    dueDate:at(0, 0),
    eventTime:null,
    hardDue:false,
    markDone:true,
    autoMarkMinutes:null,
    trackValue:false,
    createdAt:Date.now(),
    locationIds:[],
    priority:1,
    source:null,
    externalId:null,
    importedAt:null,
    planByDate:null,
    hid:null
  }, props);
}

function defaultSettings(overrides = {}){
  return Object.assign({
    preset:'todayFirst',
    showWeekOnHome:false,
    focus:'balanced',
    availabilityMinutes:[720, 720, 720, 720, 720, 720, 720],
    availabilityOverrides:{},
    blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }],
    showScheduledTasksInAgenda:true,
    showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,
    showDueHabitsInAgenda:true,
    showTaskDateOnCards:true,
    showPlansOnCards:true,
    showTimeWindowOnCards:true,
    agendaOptimizer:false
  }, overrides);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  const client = await page.context().newCDPSession(page);

  const clockTs = at(14, 0);
  await page.addInitScript(clock => {
    const RealDate = window.Date;
    function FrozenDate(...a){ return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({ unregister:() => Promise.resolve(true), update:() => Promise.resolve() });
      }
    }catch{ }
  }, clockTs);

  const data = [
    base({ hid:'w1', name:'Work block', breakable:true, durationMinutes:360, minChunkMinutes:30 }),
    base({ hid:'h1', name:'Plain habit', type:'habit', target:1, durationMinutes:25, lastLog:at(0,0) - 86400000, logs:[at(0,0) - 86400000] })
  ];
  await page.addInitScript(({ data, settings }) => {
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { data, settings:defaultSettings() });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForSelector('.breakable-crown', { timeout:10000 });
  await sleep(800);

  // Points across the breakable card, recomputed live (the card may re-render).
  const points = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r => r.querySelector('.breakable-crown'));
    if(!row)return null;
    const crown = row.querySelector('.breakable-crown').getBoundingClientRect();
    const hint = row.querySelector('.breakable-scrub-hint').getBoundingClientRect();
    const name = row.querySelector('.ting-name').getBoundingClientRect();
    return {
      dial:{ x:crown.left + crown.width * 0.5, y:crown.top + crown.height * 0.5 },
      hint:{ x:hint.left + hint.width * 0.5, y:hint.top + hint.height * 0.5 },
      name:{ x:name.left + 40, y:name.top + name.height * 0.5 }
    };
  });

  const crownState = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r => r.querySelector('.breakable-crown'));
    if(!row)return null;
    return {
      swipeOpen: row.dataset.swipeOpen || null,
      gesture: row.dataset.cardGesture || null,
      transform: row.querySelector('.ting-card').style.transform || null,
      rightW: row.querySelector('.swipe-actions-right').style.width,
      leftW: row.querySelector('.swipe-actions-left').style.width,
      target: Number(row.dataset.progressTarget || 0)
    };
  });

  const plainState = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r => !r.querySelector('.breakable-crown'));
    if(!row)return null;
    return {
      swipeOpen: row.dataset.swipeOpen || null,
      rightW: row.querySelector('.swipe-actions-right').style.width,
      leftW: row.querySelector('.swipe-actions-left').style.width
    };
  });

  // Multi-segment CDP touch drag: segs = [[dx, steps], ...] relative to start.
  async function drag(from, segs, stepMs = 16){
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:from.x, y:from.y, radiusX:10, radiusY:10, force:1, id:1 }], modifiers:0 });
    let x = from.x;
    for(const [dx, steps] of segs){
      for(let i = 1; i <= steps; i++){
        x = from.x + (dx * i) / steps;
        await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x, y:from.y, radiusX:10, radiusY:10, force:1, id:1 }], modifiers:0 });
        await sleep(stepMs);
      }
      from = { x, y:from.y };
    }
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{ x, y:from.y, id:1 }], modifiers:0 });
    await sleep(450);
  }

  const closeSwipes = () => page.evaluate(() => closeAllSwipes()).then(() => sleep(250));
  const resetTarget = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r => r.querySelector('.breakable-crown'));
    if(row)row.dataset.progressTarget = row.querySelector('.breakable-crown').dataset.committed;
  }).then(() => sleep(100));

  // ─── A. Left drag on the dial at floor → stays with the dial ───────────
  {
    console.log('\n[A] left drag from dial at committed floor');
    const p = await points();
    await drag(p.dial, [[-140, 10]]);
    const s = await crownState();
    assert(s.swipeOpen === null, `A: no swipe from the dial (swipeOpen=${s.swipeOpen})`);
    assert(!s.transform, `A: card not translated (transform=${s.transform})`);
    assert(s.target === 0, `A: target stays at the floor (target=${s.target})`);
    await closeSwipes();
  }

  // ─── B. Right drag on the dial → scrub, no swipe ───────────────────────
  {
    console.log('\n[B] right drag from dial scrubs');
    const p = await points();
    await drag(p.dial, [[+300, 14]]);
    const s = await crownState();
    assert(s.swipeOpen === null, `B: no swipe (swipeOpen=${s.swipeOpen})`);
    assert(s.target > 30, `B: scrub raised target (target=${s.target})`);
    await resetTarget();
  }

  // ─── C. Left drag with raised target → unwind, no handoff ──────────────
  {
    console.log('\n[C] left drag from dial unwinds a raised target');
    const p = await points();
    await drag(p.dial, [[+300, 14]]);
    let s = await crownState();
    assert(s.target > 30, `C: setup raised target (target=${s.target})`);
    await drag(p.dial, [[-30, 4]]);   // ~10min of unwind — still above floor
    s = await crownState();
    assert(s.swipeOpen === null, `C: no swipe while unwinding (swipeOpen=${s.swipeOpen})`);
    assert(s.target > 0, `C: target still above floor (target=${s.target})`);
    await resetTarget();
  }

  // ─── D. Scrub right then drag left past the floor in ONE gesture ───────
  // The dial must keep the gesture the whole way: the unwind runs down to the
  // committed floor and clamps there — it must never hand off to a swipe.
  {
    console.log('\n[D] scrub right, continue left past floor in one gesture');
    const p = await points();
    await drag(p.dial, [[+120, 8], [-420, 22]]);
    const s = await crownState();
    assert(s.swipeOpen === null, `D: dial keeps the gesture — no swipe (swipeOpen=${s.swipeOpen})`);
    assert(!s.transform, `D: card not translated (transform=${s.transform})`);
    assert(s.target === 0, `D: unwound and clamped at the floor (target=${s.target})`);
    await resetTarget();
  }

  // ─── E. Right swipe from off-dial surface → green panel ────────────────
  {
    console.log('\n[E] right swipe from off-dial surface');
    const p = await points();
    await drag(p.name, [[+140, 10]]);
    const s = await crownState();
    assert(s.swipeOpen === '1', `E: green panel opens (swipeOpen=${s.swipeOpen})`);
    assert(parseFloat(s.leftW) > 100, `E: left actions revealed (width=${s.leftW})`);
    await closeSwipes();
  }

  // ─── F. Left drag from the scrub hint → red panel ──────────────────────
  {
    console.log('\n[F] left drag from scrub hint');
    const p = await points();
    await drag(p.hint, [[-140, 10]]);
    const s = await crownState();
    assert(s.swipeOpen === '-1', `F: red panel opens from hint (swipeOpen=${s.swipeOpen})`);
    await closeSwipes();
  }

  // ─── G. Normal card swipes both directions ─────────────────────────────
  {
    console.log('\n[G] normal card unchanged');
    const pt = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.swipe-row')].find(r => !r.querySelector('.breakable-crown'));
      const r = row.getBoundingClientRect();
      return { x:r.left + r.width * 0.5, y:r.top + r.height * 0.5 };
    });
    await drag(pt, [[-140, 10]]);
    let s = await plainState();
    assert(s.swipeOpen === '-1', `G: normal left swipe opens red panel (swipeOpen=${s.swipeOpen})`);
    // Reveal geometry: buttons hug the OUTER edge and stay fully clear of the
    // card — the corner-pad extension under the card's rounded corner must be
    // empty backing, never a partially hidden button.
    let geo = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.swipe-row')].find(r => !r.querySelector('.breakable-crown'));
      const card = row.querySelector('.ting-card').getBoundingClientRect();
      const btns = [...row.querySelectorAll('.swipe-actions-right .swipe-action')].map(b => b.getBoundingClientRect());
      return {
        cardRight:card.right,
        firstBtnLeft:btns.length ? Math.min(...btns.map(r => r.left)) : null,
        lastBtnRight:btns.length ? Math.max(...btns.map(r => r.right)) : null,
        rowRight:row.getBoundingClientRect().right
      };
    });
    assert(geo.firstBtnLeft >= geo.cardRight - 1, `G: red buttons clear of the card (first=${Math.round(geo.firstBtnLeft)} vs cardRight=${Math.round(geo.cardRight)})`);
    assert(geo.lastBtnRight >= geo.rowRight - 2, `G: red buttons hug the outer edge (last=${Math.round(geo.lastBtnRight)} vs rowRight=${Math.round(geo.rowRight)})`);
    await closeSwipes();
    await drag(pt, [[+140, 10]]);
    s = await plainState();
    assert(s.swipeOpen === '1', `G: normal right swipe opens green panel (swipeOpen=${s.swipeOpen})`);
    geo = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.swipe-row')].find(r => !r.querySelector('.breakable-crown'));
      const card = row.querySelector('.ting-card').getBoundingClientRect();
      const btns = [...row.querySelectorAll('.swipe-actions-left .swipe-action')].map(b => b.getBoundingClientRect());
      return {
        cardLeft:card.left,
        lastBtnRight:btns.length ? Math.max(...btns.map(r => r.right)) : null,
        firstBtnLeft:btns.length ? Math.min(...btns.map(r => r.left)) : null,
        rowLeft:row.getBoundingClientRect().left
      };
    });
    assert(geo.lastBtnRight <= geo.cardLeft + 1, `G: green buttons clear of the card (last=${Math.round(geo.lastBtnRight)} vs cardLeft=${Math.round(geo.cardLeft)})`);
    assert(geo.firstBtnLeft >= geo.rowLeft - 1, `G: green buttons hug the outer edge (first=${Math.round(geo.firstBtnLeft)} vs rowLeft=${Math.round(geo.rowLeft)})`);
    await closeSwipes();
  }

  // ─── H. Page errors ────────────────────────────────────────────────────
  console.log('\n[H] page errors');
  assert(pageErrors.length === 0, `no page errors (${pageErrors.length}: ${pageErrors.slice(0,2).join(' | ')})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
