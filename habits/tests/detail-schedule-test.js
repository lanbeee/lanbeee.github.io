const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

function pad(n){ return String(n).padStart(2,'0'); }
function dateInput(d){
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function addTestHabit(page, name, type, opts = {}){
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  await page.locator('#ting-message').fill(name);
  await page.locator(`#type-seg [data-v="${type}"]`).click();
  if(type === 'task' && opts.dueDate){
    await page.locator('#ting-due-date').fill(opts.dueDate);
  }
  await page.locator('#do-save').click();
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
}

async function scrollDetailToSchedule(page, paneIndex = 2){
  await page.evaluate((idx) => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager) pager.scrollTo({ left: pager.clientWidth * idx, behavior: 'instant' });
  }, paneIndex);
  await page.waitForTimeout(200);
}

async function assertAttr(page, selector, attr, expected, msg){
  const actual = await page.locator(selector).getAttribute(attr);
  if(actual !== expected) throw new Error(`${msg}: expected "${expected}", got "${actual}"`);
}

(async()=>{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const client = await page.context().newCDPSession(page);
  const errors = [];
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto(baseUrl, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');
  const runId = `DetailTest ${Date.now()}`;

  // ═══════════════════════════════════════════════
  // SECTION 1: Build habit schedule tab toggles
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 1: Build habit schedule tab ---');
  await addTestHabit(page, runId, 'keepup');
  await page.waitForTimeout(300);

  // Navigate to effort pane (pager index 3) — duration/breakable/timer/etc.
  // moved here after the schedule/effort pane split.
  await scrollDetailToSchedule(page, 3);

  // Test breakable toggle
  console.log('Testing breakable toggle...');
  const breakableBtn = page.locator('#detail-breakable');
  await breakableBtn.waitFor({ state:'visible' });
  await assertAttr(page, '#detail-breakable', 'aria-pressed', 'false', 'breakable default off');
  if(await page.locator('#detail-min-chunk-row').isVisible()) throw new Error('min-chunk should be hidden');
  await breakableBtn.click();
  await page.waitForTimeout(100);
  await assertAttr(page, '#detail-breakable', 'aria-pressed', 'true', 'breakable toggled on');
  if(!(await page.locator('#detail-min-chunk-row').isVisible())) throw new Error('min-chunk should show');
  console.log('  breakable on: OK, min-chunk visible: OK');

  // Test track-value toggle
  console.log('Testing track-value toggle...');
  const trackValBtn = page.locator('#detail-track-value');
  await assertAttr(page, '#detail-track-value', 'aria-pressed', 'false', 'track-value default off');
  await trackValBtn.click();
  await page.waitForTimeout(100);
  await assertAttr(page, '#detail-track-value', 'aria-pressed', 'true', 'track-value on');
  console.log('  OK');

  // Test duration field
  console.log('Testing duration field...');
  const durationField = page.locator('#detail-duration');
  const durationVal = await durationField.inputValue();
  if(durationVal !== '30') throw new Error(`duration default should be 30, got ${durationVal}`);
  await durationField.click();
  await durationField.fill('');
  await durationField.fill('45');
  await durationField.blur();
  const durationAfter = await durationField.inputValue();
  if(durationAfter !== '45') throw new Error(`duration should be 45, got ${durationAfter}`);
  console.log('  OK');

  // Test flexibility field
  console.log('Testing flexibility field...');
  const flexField = page.locator('#detail-flexibility');
  const flexVal = await flexField.inputValue();
  if(flexVal !== '0') throw new Error(`flexibility default should be 0, got ${flexVal}`);
  await flexField.click();
  await flexField.fill('3');
  await flexField.blur();
  const flexAfter = await flexField.inputValue();
  if(flexAfter !== '3') throw new Error(`flexibility should be 3, got ${flexAfter}`);
  console.log('  OK');

  // Timer auto-stop on same row as start button
  console.log('Testing timer row layout...');
  const timerRow = page.locator('#detail-timer-row');
  if(!(await timerRow.locator('#detail-timer-auto-stop').isVisible())) throw new Error('timer auto-stop should be on timer row');
  console.log('  Timer row layout: OK');

  // ═══════════════════════════════════════════════
  // SECTION 2: Timer toggle + value-log-sheet
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 2: Timer + Value Log ---');
  const timerBtn = page.locator('#detail-timer-toggle');
  const timerDisplay = page.locator('#detail-timer-display');

  // Start timer
  await timerBtn.click();
  await page.waitForTimeout(200);
  if((await timerBtn.textContent()).trim() !== 'stop timer') throw new Error('timer should show stop');
  if(!(await timerDisplay.isVisible())) throw new Error('timer display should show');
  console.log('  Timer started: OK');

  // Stop timer (manual) -> value log sheet
  await timerBtn.click();
  await page.waitForTimeout(400);
  const valueLogSheet = page.locator('#value-log-sheet');
  try {
    await valueLogSheet.waitFor({ state:'visible', timeout:3000 });
  } catch(e) {
    throw new Error('value-log-sheet did not open');
  }
  console.log('  Value log sheet opened: OK');

  // Verify discard button text and click via evaluate
  const discardBtn = page.locator('#value-log-cancel');
  if((await discardBtn.textContent()).trim() !== 'discard') throw new Error('cancel should say discard');
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById('value-log-cancel');
    if(btn){ btn.click(); return true; }
    return false;
  });
  if(!clicked) throw new Error('discard button not found');
  await page.waitForTimeout(400);
  const sheetOpen = await page.evaluate(() =>
    document.getElementById('value-log-sheet')?.classList.contains('open')
  );
  if(sheetOpen) throw new Error('value-log-sheet still open after discard');
  console.log('  Discard: OK');

  // ═══════════════════════════════════════════════
  // SECTION 3: Persistence after save
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 3: Persistence ---');
  await scrollDetailToSchedule(page, 3);
  // Re-enable breakable and track-value (we toggled them off with the timer)
  if((await breakableBtn.getAttribute('aria-pressed')) !== 'true') {
    await breakableBtn.click();
    await page.waitForTimeout(100);
  }
  if((await trackValBtn.getAttribute('aria-pressed')) !== 'true') {
    await trackValBtn.click();
    await page.waitForTimeout(100);
  }

  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);

  // Reopen detail (rhythm habits may render under multiple day sections)
  await page.locator('#list .ting-card', { hasText: runId }).first().click();
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  await scrollDetailToSchedule(page, 3);
  await page.waitForTimeout(200);

  await assertAttr(page, '#detail-breakable', 'aria-pressed', 'true', 'breakable persisted');
  await assertAttr(page, '#detail-track-value', 'aria-pressed', 'true', 'track-value persisted');
  const durPersisted = await page.locator('#detail-duration').inputValue();
  if(durPersisted !== '45') throw new Error(`duration should persist as 45, got ${durPersisted}`);
  const flexPersisted = await page.locator('#detail-flexibility').inputValue();
  if(flexPersisted !== '3') throw new Error(`flexibility should persist as 3, got ${flexPersisted}`);
  console.log('  All values persisted: OK');

  // Home card for a breakable habit shows the progress slider (first instance).
  await page.locator('#detail-cool').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const cool = document.getElementById('detail-cool');
    if(cool)cool.click();
  });
  await page.waitForTimeout(300);
  const homeSlider = await page.evaluate((name) => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes(name));
    return {
      count:cards.length,
      sliders:cards.filter(c => c.querySelector('.breakable-slider')).length,
      trails:cards.filter(c => c.querySelector('.ting-trail')).length,
      label:cards[0]?.querySelector('.breakable-progress-label')?.textContent || null
    };
  }, runId);
  if(homeSlider.count < 1) throw new Error('breakable habit card missing on home');
  if(homeSlider.sliders !== 1){
    throw new Error(`expected exactly 1 progress slider on first instance, got ${JSON.stringify(homeSlider)}`);
  }
  if(homeSlider.count > 1 && homeSlider.trails !== homeSlider.count - homeSlider.sliders){
    throw new Error(`later breakable instances should keep trail dots: ${JSON.stringify(homeSlider)}`);
  }
  console.log('  Home breakable slider (first-only): OK');

  // ═══════════════════════════════════════════════
  // SECTION 4: Task schedule tab toggles
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 4: Task schedule tab ---');
  await page.locator('#detail-cool').click({ timeout:1000 }).catch(() => {});
  await page.waitForTimeout(300);

  const taskName = `${runId} task`;
  const tomorrow = new Date(Date.now() + 86400000);
  await addTestHabit(page, taskName, 'task', { dueDate: dateInput(tomorrow) });
  // Tasks land on the Effort pane (index 3) — that's where due/scheduled
  // controls live after the schedule/effort pane split.
  await scrollDetailToSchedule(page, 3);
  await page.waitForTimeout(200);

  // Due row should be visible for tasks
  if(!(await page.locator('#detail-due-row').isVisible())) throw new Error('due row should show for tasks');
  const autoMarkField = page.locator('#detail-auto-mark');
  await autoMarkField.waitFor({ state:'visible' });
  await autoMarkField.fill('30');
  await autoMarkField.blur();
  const autoMarkVal = await autoMarkField.inputValue();
  if(autoMarkVal !== '30') throw new Error(`auto-mark should be 30, got ${autoMarkVal}`);
  console.log('  Auto mark done field: OK');

  // Due date + time → eventTime; date-only → dueDate without eventTime
  await page.locator('#detail-due-time').fill('14:30');
  await page.waitForTimeout(100);
  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
  let taskItem = stored.find(h => h.name === taskName);
  if(!taskItem?.eventTime) throw new Error('task with due time should have eventTime');
  await page.locator('#list .ting-card', { hasText: taskName }).first().click();
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  await scrollDetailToSchedule(page, 3);
  await page.locator('#detail-due-time').fill('');
  await page.locator('#detail-flexibility').fill('0');
  await page.locator('#detail-flexibility').blur();
  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
  taskItem = stored.find(h => h.name === taskName);
  if(taskItem?.eventTime) throw new Error('date-only task should not have eventTime');
  if(!taskItem?.hardDue) throw new Error('flexibility 0 should infer hardDue');
  console.log('  Due/time + inferred hardDue: OK');

  // Save closes the sheet — reopen for schedule-pane tests.
  await page.locator('#list .ting-card', { hasText: taskName }).first().click();
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');

  // ═══════════════════════════════════════════════
  // SECTION 5: Schedule view seg + chips
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 5: Schedule seg + chips ---');
  await scrollDetailToSchedule(page, 2);
  await page.waitForTimeout(200);
  const prefSeg = page.locator('#detail-schedule-view-seg [data-schedule-view="preferred"]');
  if(await prefSeg.isVisible()){
    await prefSeg.click();
    await page.waitForTimeout(100);
    if(!(await page.locator('#detail-schedule-preferred').isVisible())) throw new Error('preferred section should show');
    if(await page.locator('#detail-schedule-allowed').isVisible()) throw new Error('allowed section should hide');
    await page.locator('#detail-schedule-view-seg [data-schedule-view="allowed"]').click();
    await page.waitForTimeout(100);
    if(!(await page.locator('#detail-schedule-allowed').isVisible())) throw new Error('allowed section should show');
    if(await page.locator('#detail-schedule-preferred').isVisible()) throw new Error('preferred section should hide');
  }
  console.log('  Schedule view seg: OK');

  // Toggle weekday chip
  const chip = page.locator('#detail-weekday-chips .schedule-chip').first();
  const wasOn = (await chip.getAttribute('class'))?.includes('on');
  await chip.click();
  await page.waitForTimeout(100);
  const nowOn = (await chip.getAttribute('class'))?.includes('on');
  if(nowOn === wasOn) throw new Error(`chip should toggle: was ${wasOn} now ${nowOn}`);
  console.log('  Schedule chip toggle: OK');

  // Close task detail to keep state clean for next sections
  await page.evaluate(() => {
    if(typeof closeDetail === 'function')closeDetail();
    else document.getElementById('detail-sheet')?.classList.remove('open');
  });
  await page.waitForTimeout(300);

  // ═══════════════════════════════════════════════
  // SECTION 6: Reopen build habit for timer + touch tests
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 6: Reopen build habit ---');
  // Reopen the build habit (task detail may have been saved and closed)
  await page.locator('#list .ting-card', { hasText: runId }).first().click();
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  await scrollDetailToSchedule(page, 3);
  await page.waitForTimeout(200);

  // ═══════════════════════════════════════════════
  // SECTION 7: Touch-scroll accidental click test
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 7: Touch scroll over timer ---');
  const timerBtn2 = page.locator('#detail-timer-toggle');
  await timerBtn2.waitFor({ state:'visible' });
  const timerBox = await timerBtn2.boundingBox();
  if(!timerBox) throw new Error('timer button not found');

  // Simulate a vertical touch scroll that passes over the timer button
  const startY = timerBox.y - 80;
  const endY = timerBox.y + timerBox.height + 80;
  const midX = timerBox.x + timerBox.width / 2;

  // Before the scroll, confirm timer is in 'start timer' state
  const beforeText = (await timerBtn2.textContent()).trim();
  if(beforeText !== 'start timer') throw new Error(`timer should be 'start timer', got '${beforeText}'`);

  // Reset timer state if it was left running from earlier tests
  await page.evaluate(() => {
    if(window.stopHabitTimer) stopHabitTimer(true, true);
  });

  // Dispatch a touch scroll gesture using CDP
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: midX, y: startY, radiusX: 10, radiusY: 10, force: 0.5, id: 0 }],
    modifiers: 0,
    timestamp: Date.now()
  });
  await new Promise(r => setTimeout(r, 20));

  // Touch move through the button area (scrolling down)
  const steps = 8;
  for(let i = 1; i <= steps; i++){
    const t = i / steps;
    const y = startY + (endY - startY) * t;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: midX, y, radiusX: 10, radiusY: 10, force: t, id: 0 }],
      modifiers: 0,
      timestamp: Date.now()
    });
    await new Promise(r => setTimeout(r, 20));
  }

  // Touch end past the button
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: midX, y: endY, id: 0 }],
    modifiers: 0,
    timestamp: Date.now()
  });
  await page.waitForTimeout(300);

  // Timer should NOT have started (still 'start timer', not 'stop timer')
  const afterText = (await timerBtn2.textContent()).trim();
  if(afterText !== 'start timer') {
    console.log(`  FAIL: Timer ${afterText} — scroll triggered accidental start`);
    await page.evaluate(() => {
      if(window.stopHabitTimer) stopHabitTimer(true, true);
      document.getElementById('value-log-sheet')?.classList.remove('open');
    });
    await page.waitForTimeout(200);
    errors.push('Touch scroll over timer button triggered accidental start');
  } else {
    console.log('  Touch scroll did NOT trigger timer: OK');
  }

  // ═══════════════════════════════════════════════
  // SECTION 8: Build habit auto mark done
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 8: Build habit auto mark done ---');

  // Auto mark field visible for build habits on effort pane
  const buildAutoMark = page.locator('#detail-auto-mark');
  if(!(await buildAutoMark.isVisible())) throw new Error('auto-mark should be visible for build habits');
  await buildAutoMark.fill('15');
  await buildAutoMark.blur();
  console.log('  build habit auto-mark: OK');

  // ═══════════════════════════════════════════════
  // SECTION 9: Time input fields
  // ═══════════════════════════════════════════════
  console.log('\n--- SECTION 9: Time window inputs ---');
  const timeStart = page.locator('#detail-time-start');
  const timeEnd = page.locator('#detail-time-end');
  await timeStart.fill('09:00');
  await timeEnd.fill('17:00');
  await page.waitForTimeout(100);
  const timeClear = page.locator('#detail-time-clear');
  if(!(await timeClear.isVisible())) throw new Error('time clear button should show');
  console.log('  Time window inputs: OK');

  // Cleanup
  console.log('\n--- CLEANUP ---');
  await page.locator('#detail-save').click();
  await page.waitForTimeout(300);
  const allStored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2') || '[]'));
  const filtered = allStored.filter(h => !String(h.name || '').startsWith('DetailTest'));
  await page.evaluate((data) => { localStorage.setItem('tings_v2', JSON.stringify(data)); }, filtered);

  if(errors.length) throw new Error('FAILED checks:\n' + errors.join('\n'));
  await browser.close();
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  ALL DETAIL SCHEDULE TESTS PASSED   ║');
  console.log('╚══════════════════════════════════════╝');
})().catch(async err=>{
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
