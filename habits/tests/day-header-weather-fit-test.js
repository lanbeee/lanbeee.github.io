// Day-header chips must stay single-line and keep the label readable at any
// width: the weather cue degrades stepwise (full → hide temp range → emoji
// only) instead of crushing pill text onto two lines. Regression coverage for
// fitDayHeaderChips (js/list-view-sections.js).
//
// Also covers the self-correcting re-fit: chip widths can legitimately change
// AFTER the header was first fitted (icon/text fonts land late from CDN,
// chips attach or re-render late), so a ResizeObserver on the label + weather
// button must re-run the fit without any window resize.
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/day-header-weather-fit-test.js
const { chromium } = require('playwright');

const HABITS_URL = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  const fail = (name, cond, detail) => {
    console.log(`${cond ? 'ok' : 'FAIL'} ${name}${cond ? '' : ' :: ' + detail}`);
    if (!cond) process.exitCode = 1;
  };
  const twoRafs = () => page.evaluate(() => new Promise(res =>
    requestAnimationFrame(() => requestAnimationFrame(res))));

  await page.goto(HABITS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof load === 'function' && typeof render === 'function', null, { timeout: 15000 });

  // Seed via app APIs (boot normalization would overwrite pre-seeded storage).
  await page.evaluate(() => {
    const baseHabit = props => Object.assign({
      name: 'item', type: 'keepup', target: 7, flexibilityDays: 0, durationMinutes: 30,
      allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
      allowedTimeStartAnchor: null, allowedTimeEndAnchor: null,
      lastLog: null, logs: [], emoji: '', pinned: false, sample: false, snoozedUntil: null,
      topics: [], allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
      dueDate: null, eventTime: null, hardDue: false, createdAt: Date.now(),
      breakable: false, minChunkMinutes: 30, planByDate: null, anywhereAllowed: true, locationIds: []
    }, props);
    save([
      baseHabit({ hid: 'h1', name: 'Read', target: 1 }),
      baseHabit({ hid: 'h2', name: 'Walk', target: 1, breakable: true, minChunkMinutes: 15 })
    ]);
    Object.assign(sortSettings, {
      preset: 'todayFirst', showWeekOnHome: true, agendaOptimizer: false, minimalMode: false,
      homeCityName: 'New York', homeCityLat: 40.7, homeCityLng: -74,
      showWeatherTemperatureRanges: true, showWeatherOnBusyTimes: true,
      weatherTempUnit: 'f'
    });
    const now = Date.now();
    const dayMs = 86400000;
    const noon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
    const mkDay = (offset, code, lo, hi, chance) => ({
      key: new Date(noon + offset * dayMs).toLocaleDateString('sv-SE'),
      ts: noon + offset * dayMs, weather_code: code,
      temperature_2m_min: lo, temperature_2m_max: hi,
      apparent_temperature_min: lo - 1, apparent_temperature_max: hi + 1,
      precipitation_probability_max: chance, precipitation_sum: code >= 61 ? 4 : 0.1,
      snowfall_sum: 0, wind_speed_10m_max: 14, wind_gusts_10m_max: 30, uv_index_max: 3
    });
    weatherCacheWrite({ weekly: {
      lat: 40.7, lng: -74, fetchedAt: now, timezone: 'UTC', samples: [],
      days: [mkDay(0, 65, 18, 28, 67), mkDay(1, 95, 16, 24, 90), mkDay(2, 66, 15, 22, 80),
        mkDay(3, 3, 14, 21, 10), mkDay(4, 0, 15, 23, 0), mkDay(5, 61, 17, 25, 40), mkDay(6, 2, 16, 24, 5)]
    } });
    saveSortSettings(sortSettings);
    sortSettings = loadSortSettings(); // rebuilds _weatherContext from the cache
    render();
  });
  await page.waitForSelector('.section-header .weather-day-button', { timeout: 10000 });
  await twoRafs();

  const todayHeader = () => page.evaluate(() => {
    const header = [...document.querySelectorAll('.section-header')]
      .find(h => h.dataset.label === 'today' && h.querySelector('.weather-day-button'))
      || [...document.querySelectorAll('.section-header')].find(h => h.querySelector('.weather-day-button'));
    if (!header) return null;
    const lab = header.querySelector('.section-header-label');
    const btn = header.querySelector('.weather-day-button');
    const cue = btn.querySelector('.weather-day-cue');
    const chips = [...header.querySelectorAll('.day-header-context > button')];
    return {
      label: lab.textContent,
      labelClipped: lab.scrollWidth > lab.clientWidth + 1,
      cueClipped: cue.scrollWidth > cue.clientWidth + 1,
      slim: btn.classList.contains('cue-slim'),
      emojiOnly: btn.classList.contains('cue-emoji'),
      chipHeights: chips.map(c => c.getBoundingClientRect().height),
      chipTexts: chips.map(c => (c.textContent || '').trim())
    };
  });
  const setWorstCaseChips = () => page.evaluate(() => {
    const host = document.querySelector('.section-header .day-header-context');
    let free = host.querySelector('.free-pill');
    if (!free) {
      free = document.createElement('button');
      free.type = 'button'; free.className = 'free-pill';
      host.insertBefore(free, host.firstChild);
    }
    free.textContent = '12.5H OPEN';
    let dropped = host.querySelector('.dropped-pill');
    if (!dropped) {
      dropped = document.createElement('button');
      dropped.type = 'button'; dropped.className = 'dropped-pill';
      host.appendChild(dropped);
    }
    dropped.textContent = '12 MISSED';
    const btn = host.querySelector('.weather-day-button');
    btn.querySelector('.weather-condition-emoji').textContent = '🌧️❄️';
    const sig = btn.querySelector('.weather-signal');
    if (sig) sig.innerHTML = '<i class="ti ti-droplet" aria-hidden="true"></i>100%';
    const temp = btn.querySelector('.weather-temperature');
    if (temp) temp.textContent = '−12–3°';
  });
  const allSingleLine = m => m.chipHeights.every(h => h <= 34);
  const nothingClipped = m => !m.labelClipped && !m.cueClipped;

  // (A) Comfortable width: full cue, nothing degraded.
  let m = await todayHeader();
  fail('A1 430px: cue at full detail', m && !m.slim && !m.emojiOnly, JSON.stringify(m));
  fail('A2 430px: nothing clipped', nothingClipped(m), JSON.stringify(m));
  fail('A3 430px: chips single-line', allSingleLine(m), JSON.stringify(m.chipHeights));

  // (B) Tight width + worst-case chips: degrade to slim (temp range hidden),
  //     label and every chip stay single-line and unclipped.
  await setWorstCaseChips();
  await page.setViewportSize({ width: 402, height: 900 });
  await twoRafs();
  m = await todayHeader();
  fail('B1 402px worst: slim degradation applied', m && m.slim && !m.emojiOnly, JSON.stringify(m));
  fail('B2 402px worst: nothing clipped', nothingClipped(m), JSON.stringify(m));
  fail('B3 402px worst: chips single-line', allSingleLine(m), JSON.stringify(m.chipHeights));

  // (C) Very tight width: emoji-only cue.
  await page.setViewportSize({ width: 320, height: 900 });
  await twoRafs();
  m = await todayHeader();
  fail('C1 320px worst: emoji-only degradation applied', m && m.emojiOnly, JSON.stringify(m));
  fail('C2 320px worst: nothing clipped', nothingClipped(m), JSON.stringify(m));
  fail('C3 320px worst: chips single-line', allSingleLine(m), JSON.stringify(m.chipHeights));

  // (D) Self-correcting re-fit: at a width where roomy chips fit, mutate the
  //     chip content in place (as a late font load / late chip attach would)
  //     so the row overflows — with NO resize event and NO manual fit call.
  //     The ResizeObserver on the label + weather button must re-run the fit.
  await page.evaluate(() => {
    const host = document.querySelector('.section-header .day-header-context');
    const free = host.querySelector('.free-pill');
    if (free) free.textContent = '4H OPEN';
    const dropped = host.querySelector('.dropped-pill');
    if (dropped) dropped.remove();
    const btn = host.querySelector('.weather-day-button');
    btn.querySelector('.weather-condition-emoji').textContent = '🌧️';
    const sig = btn.querySelector('.weather-signal');
    if (sig) sig.innerHTML = '<i class="ti ti-droplet" aria-hidden="true"></i>67%';
    const temp = btn.querySelector('.weather-temperature');
    if (temp) temp.textContent = '64–82°';
  });
  await page.setViewportSize({ width: 402, height: 900 }); // roomy chips fit here…
  await twoRafs();
  m = await todayHeader();
  fail('D1 402px roomy: full cue, nothing degraded', m && !m.slim && !m.emojiOnly && nothingClipped(m), JSON.stringify(m));

  await setWorstCaseChips(); // …then widen chip text in place, same viewport
  await page.waitForTimeout(120); // RO callback + refit rAF
  m = await todayHeader();
  fail('D2 late width growth: re-fit degrades automatically', m && (m.slim || m.emojiOnly), JSON.stringify(m));
  fail('D3 late width growth: nothing clipped', nothingClipped(m), JSON.stringify(m));
  fail('D4 late width growth: chips single-line', allSingleLine(m), JSON.stringify(m.chipHeights));

  // (E) Recovery: back at a comfortable width, degradation clears entirely.
  await page.setViewportSize({ width: 430, height: 900 });
  await page.evaluate(() => {
    const host = document.querySelector('.section-header .day-header-context');
    const free = host.querySelector('.free-pill');
    if (free) free.textContent = '4H OPEN';
    const dropped = host.querySelector('.dropped-pill');
    if (dropped) dropped.remove();
  });
  await page.waitForTimeout(120);
  m = await todayHeader();
  fail('E1 430px roomy: degradation cleared again', m && !m.slim && !m.emojiOnly, JSON.stringify(m));
  fail('E2 430px roomy: nothing clipped', nothingClipped(m), JSON.stringify(m));

  fail('F   no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(process.exitCode ? 'day-header-weather-fit-test: FAILURES' : 'day-header-weather-fit-test: all passed');
})();
