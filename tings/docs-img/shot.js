/**
 * docs-img generator for tings/docs.html.
 * Drives the live app with Playwright, seeds realistic sample data,
 * and captures the 9 screenshots the doc placeholders expect.
 *
 *   npx serve -l 4181 -s .        # from tings/
 *   NODE_PATH=../node_modules node ../docs-img/shot.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const OUT = process.env.OUT || path.resolve(__dirname, 'docs-img');
const TMP = path.resolve(__dirname, '.tmp');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const PHONE = { width: 390, height: 844 };

// A one-off task, same shape the app normalises (see tests/ helpers).
function task(name, dueDate, priority = 1, durationMinutes = 60, eventTime = null, opts = {}) {
  return {
    name, type: 'task', target: null, flexibilityDays: 0, durationMinutes,
    breakable: false, minChunkMinutes: 30, allowedTimeStart: null, allowedTimeEnd: null,
    preferredTimeStart: null, preferredTimeEnd: null, lastLog: null, logs: [], emoji: '',
    pinned: !!opts.pinned, sample: false, snoozedUntil: null, topics: opts.topics || [],
    allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
    dueDate, eventTime, hardDue: !!opts.hardDue,
    markDone: eventTime != null ? false : true, createdAt: dueDate - 86400000,
    locationIds: opts.locationIds || [], priority
  };
}

function extraTasks() {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const day = ms => base.getTime() + ms * 86400000;
  return [
    task('File quarterly report', day(2), 0, 120),
    task('Physio appointment', day(1), 1, 45, 840),          // tomorrow 2:00pm, fixed event
    task('Call mom', day(0), 2, 30),
    task('Buy groceries', day(3), 3, 45),
    task('Renew passport', day(6), 5, 60),
  ];
}

// Seed one page with a realistic, populated planner. Returns once the week is rendered.
async function seed(page, { withTasks = true } = {}) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({ update: () => Promise.resolve() });
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    updateSortSetting({
      homeCityName: 'New York', homeCityLat: 40.7128, homeCityLng: -74.006,
      blockedTimes: [
        { label: 'sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 300 },
        { label: 'work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
        { label: 'commute', days: [1, 2, 3, 4, 5], start: 510, end: 540 },
        { label: 'dinner', days: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1140 }
      ]
    }, { renderNow: false, sync: false });
    addSortSamples({ closeSheets: true });
  });
  if (withTasks) {
    await page.evaluate(tasks => { const d = load(); d.push(...tasks); save(d); }, extraTasks());
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof _homeRenderedWeek!=="undefined"&&_homeRenderedWeek&&Array.isArray(_homeRenderedWeek.days)', null, { timeout: 25000 });
  await page.waitForFunction('!document.querySelector("#list")?.classList.contains("is-progressive")', null, { timeout: 25000 });
  await page.waitForTimeout(700);   // icons / fonts settle
}

const results = [];
function log(ok, name, extra = '') { results.push({ ok, name, extra }); console.log(`${ok ? 'OK' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 1 ── home-list.png ──────────────────────────────────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    await page.evaluate(() => { document.getElementById('list').scrollTop = 0; window.scrollTo(0, 0); });
    const list = page.locator('#list');
    const w = (await list.boundingBox()).width;
    await list.screenshot({ path: path.join(OUT, 'home-list.png'), clip: { x: 0, y: 0, width: w, height: 820 } });
    await page.close();
    log(true, 'home-list.png');
  } catch (e) { log(false, 'home-list.png', e.message); }

  // 2 ── sample-habits.png (fresh install → onboarding sheet) ───────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => openSampleHabitsSheet());
    await page.waitForSelector('#sample-habits-sheet.open', { timeout: 8000 });
    await page.waitForTimeout(500);
    const sheet = page.locator('#sample-habits-sheet .sample-habits-sheet');
    const h = await sheet.evaluate(el => el.scrollHeight);
    await sheet.screenshot({ path: path.join(OUT, 'sample-habits.png'), clip: { x: 0, y: 0, width: PHONE.width, height: Math.min(h, 880) } });
    await page.close();
    log(true, 'sample-habits.png');
  } catch (e) { log(false, 'sample-habits.png', e.message); }

  // 3 ── planner-week.png (the whole packed week) ───────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await seed(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#list').screenshot({ path: path.join(OUT, 'planner-week.png') });
    await page.close();
    log(true, 'planner-week.png');
  } catch (e) { log(false, 'planner-week.png', e.message); }

  // 4 ── add-sheet.png ──────────────────────────────────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    await page.locator('#open-add').click();
    await page.waitForSelector('#add-sheet.open', { timeout: 8000 });
    await page.waitForTimeout(500);
    const sheet = page.locator('#add-sheet .add-sheet');
    const h = await sheet.evaluate(el => el.scrollHeight);
    await sheet.screenshot({ path: path.join(OUT, 'add-sheet.png'), clip: { x: 0, y: 0, width: PHONE.width, height: Math.min(h, 760) } });
    await page.close();
    log(true, 'add-sheet.png');
  } catch (e) { log(false, 'add-sheet.png', e.message); }

  // 5 ── home-full.png (top bar + list + bottom nav) ────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'home-full.png') });
    await page.close();
    log(true, 'home-full.png');
  } catch (e) { log(false, 'home-full.png', e.message); }

  // 6 ── card-anatomy.png (one card, annotated) ─────────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const card = page.locator('.ting-card', { hasText: 'walk to the park' }).first();
    await card.waitFor({ timeout: 8000 });
    // scroll it fully into view
    await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(250);
    const raw = path.join(TMP, 'card-raw.png');
    await card.screenshot({ path: raw });
    const box = await card.evaluate(el => {
      const r = el.getBoundingClientRect();
      const rel = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height, cx: b.left - r.left + b.width / 2, cy: b.top - r.top + b.height / 2 }; };
      return {
        w: r.width, h: r.height,
        pts: {
          pulse: rel(el.querySelector('.pulse-btn')),
          name: rel(el.querySelector('.ting-name')),
          pill: rel(el.querySelector('.ting-main [class*=pill],.ting-main .time-pill,.agenda-pill')),
          cue: rel(el.querySelector('.ting-cue')),
          marks: rel(el.querySelector('.ting-meta')),
          trail: rel(el.querySelector('.ting-visual')),
          actions: rel(el.querySelector('.card-actions')),
        }
      };
    });
    const png = fs.readFileSync(raw).toString('base64');
    const annotated = renderAnnotation(png, box);
    const cpage = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });
    await cpage.setContent(annotated, { waitUntil: 'load' });
    await cpage.waitForTimeout(150);
    await cpage.locator('#stage').screenshot({ path: path.join(OUT, 'card-anatomy.png') });
    await cpage.close(); await page.close();
    log(true, 'card-anatomy.png');
  } catch (e) { log(false, 'card-anatomy.png', e.message); }

  // 7 ── detail-view.png (six page dots) ────────────────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    const idx = await page.evaluate(() => {
      const d = load();
      const i = d.findIndex(h => /gym session/i.test(h.name));
      return i >= 0 ? i : d.findIndex(h => h.type !== 'task');
    });
    await page.evaluate(i => openDetail(i), idx);
    await page.waitForSelector('#detail-sheet.open', { timeout: 8000 });
    await page.waitForSelector('#detail-sheet .detail-dots button', { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'detail-view.png') });
    await page.close();
    log(true, 'detail-view.png');
  } catch (e) { log(false, 'detail-view.png', e.message); }

  // 8 ── map-picker.png (adding a "Gym" place) ──────────────────────────────
  try {
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await seed(page);
    await page.evaluate(() => openLocationPicker({ name: 'Gym', lat: 40.7465, lng: -73.9972, address: 'Chelsea, NYC' }));
    await page.waitForSelector('#location-picker-sheet.open', { timeout: 8000 });
    // wait for map tiles, fall back gracefully if offline
    await page.waitForFunction(`document.querySelectorAll('.leaflet-tile-loaded').length>=4`, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT, 'map-picker.png') });
    await page.close();
    log(true, 'map-picker.png');
  } catch (e) { log(false, 'map-picker.png', e.message); }

  // 9 ── appearance.png (light/dark × compact/minimal/full) ─────────────────
  try {
    const variants = [
      { label: 'light · full', patch: { themeMode: 'light', compactMode: false, minimalMode: false } },
      { label: 'dark · full', patch: { themeMode: 'dark', compactMode: false, minimalMode: false } },
      { label: 'light · compact', patch: { themeMode: 'light', compactMode: true, minimalMode: false } },
      { label: 'light · minimal', patch: { themeMode: 'light', compactMode: false, minimalMode: true } },
    ];
    const shots = [];
    const page = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await seed(page);
    for (const v of variants) {
      await page.evaluate(patch => { updateSortSetting(patch, { renderNow: false, sync: false }); if (typeof applyAppearanceSettings === 'function') applyAppearanceSettings(); render(); }, v.patch);
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = path.join(TMP, `app-${v.label.replace(/[^a-z]/gi, '')}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: PHONE.width, height: 760 } });
      shots.push({ label: v.label, data: fs.readFileSync(file).toString('base64') });
    }
    await page.close();
    const compose = renderAppearanceStrip(shots);
    const cpage = await browser.newPage({ viewport: { width: 1180, height: 700 }, deviceScaleFactor: 2 });
    await cpage.setContent(compose, { waitUntil: 'load' });
    await cpage.waitForTimeout(150);
    await cpage.locator('#stage').screenshot({ path: path.join(OUT, 'appearance.png') });
    await cpage.close();
    log(true, 'appearance.png');
  } catch (e) { log(false, 'appearance.png', e.message); }

  await browser.close();
  console.log('\n──── summary ────');
  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'OK' : 'FAIL'}  ${r.name}${r.extra ? '  ' + r.extra : ''}`);
  console.log(failed.length ? `${failed.length} failed` : 'all 9 captured');
  process.exit(failed.length ? 1 : 0);
})();

// ── annotation overlay for a single card ──────────────────────────────────
function renderAnnotation(png, box) {
  const W = 560, scale = W / box.w, H = Math.round(box.h * scale);
  const items = [
    ['1', 'Pulse icon', 'tap to log', box.pts.pulse, 'left'],
    ['2', 'Name + agenda pill', 'title + planned time', box.pts.pill || box.pts.name, 'mid'],
    ['3', 'Status line', '"due today" cue', box.pts.cue, 'mid'],
    ['4', 'Context marks', 'progress, place, rhythm…', box.pts.marks, 'right'],
    ['5', 'Two-week trail', 'dots for this week + last', box.pts.trail, 'right'],
    ['6', 'Quick actions', 'activity · snooze · remove', box.pts.actions, 'right'],
  ];
  const dots = items.map(([n, , , p]) => {
    if (!p) return '';
    const x = Math.round(p.cx * scale);
    const y = Math.round(p.cy * scale);
    return `<span class="dot" style="left:${x}px;top:${y}px">${n}</span>`;
  }).join('');
  const legend = items.map(([n, t, d]) => `<div class="li"><span class="num">${n}</span><div><div class="t">${t}</div><div class="s">${d}</div></div></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f4f0;color:#1a1a1a}
    #stage{width:760px;padding:28px;background:#ffffff;border-radius:18px}
    .card-wrap{position:relative;width:${W}px;height:${H}px;margin:0 auto}
    .card-wrap img{width:${W}px;height:${H}px;display:block;border-radius:14px;border:1px solid rgba(0,0,0,.1)}
    .dot{position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:#0F6E56;color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px rgba(15,110,86,.2),0 2px 6px rgba(0,0,0,.25)}
    .legend{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;margin-top:24px;padding:0 24px}
    .li{display:flex;gap:12px;align-items:flex-start}
    .num{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#0F6E56;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;margin-top:1px}
    .t{font-weight:600;font-size:14px}.s{font-size:12px;color:#6b6a65}
    .cap{font-size:12px;color:#9e9d98;text-align:center;margin-top:14px}
  </style></head><body><div id="stage">
    <div class="card-wrap"><img src="data:image/png;base64,${png}">${dots}</div>
    <div class="legend">${legend}</div>
    <div class="cap">a single habit card, annotated</div>
  </div></body></html>`;
}

// ── appearance strip ───────────────────────────────────────────────────────
function renderAppearanceStrip(shots) {
  const figs = shots.map(s => `<figure><img src="data:image/png;base64,${s.data}"><figcaption>${s.label}</figcaption></figure>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1c1c1e}
    #stage{padding:26px 24px}
    .row{display:flex;gap:18px;justify-content:center;align-items:flex-start}
    figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}
    figure img{width:248px;display:block;border-radius:20px;border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45)}
    figcaption{color:#aeaeb2;font-size:12.5px;font-weight:600;letter-spacing:.01em}
  </style></head><body><div id="stage"><div class="row">${figs}</div></div></body></html>`;
}
