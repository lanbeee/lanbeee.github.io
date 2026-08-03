// Retention auto-cleanup — unit tests for PURE helpers in data.js.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/retention-cleanup-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{},
      completedTaskRetentionDays:7,
      habitLogKeepCount:30,
      lastRetentionCleanupAt:0
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[A] normalize helpers + monthly gate');
  const norms = await page.evaluate(() => {
    const now = Date.now();
    return {
      days2: normalizeCompletedTaskRetentionDays(2),
      daysBad: normalizeCompletedTaskRetentionDays(99),
      keep12: normalizeHabitLogKeepCount(12),
      keepOff: normalizeHabitLogKeepCount(0),
      keepBad: normalizeHabitLogKeepCount(99),
      gateNever: shouldRunRetentionCleanup({lastRetentionCleanupAt:0}, now),
      gateRecent: shouldRunRetentionCleanup({lastRetentionCleanupAt:now - 86400000}, now),
      gateOld: shouldRunRetentionCleanup({lastRetentionCleanupAt:now - 31 * 86400000}, now),
      interval: RETENTION_CLEANUP_INTERVAL_MS
    };
  });
  assert(norms.days2 === 2, 'retention days accepts 2');
  assert(norms.daysBad === 7, 'invalid retention days → 7');
  assert(norms.keep12 === 12, 'keep count accepts 12');
  assert(norms.keepOff === 0, 'keep count accepts off/0');
  assert(norms.keepBad === 30, 'invalid keep count → 30');
  assert(norms.gateNever === true, 'never-run gate is due');
  assert(norms.gateRecent === false, 'recent cleanup skips monthly gate');
  assert(norms.gateOld === true, 'month-old cleanup is due again');
  assert(norms.interval === 30 * 86400000, 'interval is ~30 days');

  console.log('\n[B] delete expired completed tasks; keep young ones');
  const taskCase = await page.evaluate(() => {
    const now = Date.now();
    const day = 86400000;
    const data = [
      {hid:'old-done', name:'old', type:'task', lastLog:now - 10 * day, logs:[now - 10 * day], target:7, priority:3},
      {hid:'young-done', name:'young', type:'task', lastLog:now - 1 * day, logs:[now - 1 * day], target:7, priority:3},
      {hid:'open-task', name:'open', type:'task', lastLog:null, logs:[], target:7, priority:3},
      {hid:'habit-a', name:'habit', type:'keepup', lastLog:now - 2 * day, logs:[now - 2 * day], target:7, priority:3}
    ];
    const result = runRetentionCleanup(data, {
      completedTaskRetentionDays:7,
      habitLogKeepCount:0
    }, now);
    return {
      changed: result.changed,
      removed: result.removedTasks.map(h => h.hid),
      left: result.data.map(h => h.hid)
    };
  });
  assert(taskCase.changed === true, 'cleanup reports change');
  assert(taskCase.removed.length === 1 && taskCase.removed[0] === 'old-done', 'only old completed task removed');
  assert(taskCase.left.includes('young-done'), 'young completed task kept');
  assert(taskCase.left.includes('open-task'), 'open task kept');
  assert(taskCase.left.includes('habit-a'), 'habit kept');

  console.log('\n[C] protect tasks used as habit anchors');
  const protectCase = await page.evaluate(() => {
    const now = Date.now();
    const day = 86400000;
    const data = [
      {hid:'anchor-task', name:'anchor', type:'task', lastLog:now - 20 * day, logs:[now - 20 * day], target:7, priority:3},
      {
        hid:'dependent', name:'dep', type:'keepup', lastLog:null, logs:[], target:7, priority:3,
        allowedTimeStartAnchor:'habit',
        allowedTimeStartAnchorHabitId:'anchor-task',
        allowedTimeStartOffsetMin:0
      }
    ];
    const result = runRetentionCleanup(data, {
      completedTaskRetentionDays:2,
      habitLogKeepCount:0
    }, now);
    return {
      removed: result.removedTasks.map(h => h.hid),
      left: result.data.map(h => h.hid)
    };
  });
  assert(protectCase.removed.length === 0, 'anchored completed task not deleted');
  assert(protectCase.left.includes('anchor-task'), 'anchor task still present');

  console.log('\n[D] protect schedule-link anchors');
  const linkCase = await page.evaluate(() => {
    const now = Date.now();
    const day = 86400000;
    const data = [
      {hid:'link-task', name:'linked', type:'task', lastLog:now - 20 * day, logs:[now - 20 * day], target:7, priority:3},
      {
        hid:'follower', name:'follower', type:'keepup', lastLog:null, logs:[], target:7, priority:3,
        scheduleLinks:[{anchorHid:'link-task', direction:'after', adjacency:'sometime', requireSameDay:false}]
      }
    ];
    const result = runRetentionCleanup(data, {
      completedTaskRetentionDays:2,
      habitLogKeepCount:0
    }, now);
    return {
      removed: result.removedTasks.map(h => h.hid),
      left: result.data.map(h => h.hid)
    };
  });
  assert(linkCase.removed.length === 0, 'schedule-linked completed task not deleted');

  console.log('\n[E] trim actual logs to N; keep plan logs; skip tasks');
  const trimCase = await page.evaluate(() => {
    const now = Date.now();
    const hour = 3600000;
    const actuals = [];
    for(let i = 20; i >= 1; i--)actuals.push(now - i * hour);
    const planTs = now + 2 * 86400000;
    const data = [
      {
        hid:'busy-habit', name:'busy', type:'keepup', target:7, priority:3,
        logs:[...actuals, {ts:planTs, plan:true}],
        lastLog:actuals[actuals.length - 1]
      },
      {
        hid:'chunk-task', name:'chunk', type:'task', target:7, priority:3,
        logs:actuals.slice(-5),
        lastLog:null
      }
    ];
    const result = runRetentionCleanup(data, {
      completedTaskRetentionDays:7,
      habitLogKeepCount:12
    }, now);
    const habit = result.data.find(h => h.hid === 'busy-habit');
    const task = result.data.find(h => h.hid === 'chunk-task');
    const habitActual = actualLogs(habit.logs);
    const habitPlans = plannedLogs(habit.logs);
    return {
      changed: result.changed,
      trimmedLogs: result.trimmedLogs,
      trimmedHabits: result.trimmedHabits,
      habitActualCount: habitActual.length,
      habitPlanCount: habitPlans.length,
      taskLogCount: normalizeLogs(task.logs).length,
      newestKept: habitActual[habitActual.length - 1] === actuals[actuals.length - 1]
    };
  });
  assert(trimCase.changed === true, 'log trim reports change');
  assert(trimCase.trimmedHabits === 1, 'one habit trimmed');
  assert(trimCase.trimmedLogs === 8, 'trimmed 8 older actuals (20→12)');
  assert(trimCase.habitActualCount === 12, 'kept 12 actual logs');
  assert(trimCase.habitPlanCount === 1, 'plan log preserved');
  assert(trimCase.taskLogCount === 5, 'open task logs not trimmed');
  assert(trimCase.newestKept === true, 'kept newest actuals');

  console.log('\n[F] habitLogKeepCount 0 is a no-op for logs');
  const offCase = await page.evaluate(() => {
    const now = Date.now();
    const logs = [];
    for(let i = 40; i >= 1; i--)logs.push(now - i * 3600000);
    const data = [{
      hid:'keep-all', name:'keep', type:'keepup', target:7, priority:3,
      logs, lastLog:logs[logs.length - 1]
    }];
    const result = runRetentionCleanup(data, {
      completedTaskRetentionDays:7,
      habitLogKeepCount:0
    }, now);
    return {
      changed: result.changed,
      count: actualLogs(result.data[0].logs).length
    };
  });
  assert(offCase.changed === false, 'off keep-count does not change data');
  assert(offCase.count === 40, 'all logs retained when off');

  console.log('\n[G] scrub dangling refs when unprotected task is deleted');
  const scrubCase = await page.evaluate(() => {
    const now = Date.now();
    const day = 86400000;
    const data = [
      {hid:'gone-task', name:'gone', type:'task', lastLog:now - 20 * day, logs:[now - 20 * day], target:7, priority:3},
      {
        hid:'other', name:'other', type:'keepup', lastLog:null, logs:[], target:7, priority:3,
        // not an active habit-anchor reference for protection — use a dangling
        // schedule link only after we delete a *different* unprotected task that
        // nothing points at; here "noise-task" is unprotected and "gone-task"
        // is also unprotected. Add a third habit pointing at noise for scrub check.
      },
      {hid:'noise-task', name:'noise', type:'task', lastLog:now - 20 * day, logs:[now - 20 * day], target:7, priority:3},
      {
        hid:'refers', name:'refers', type:'keepup', lastLog:null, logs:[], target:7, priority:3,
        preferredTimeEndAnchor:'habit',
        preferredTimeEndAnchorHabitId:'noise-task',
        preferredTimeEndOffsetMin:5,
        scheduleLinks:[{anchorHid:'gone-task', direction:'before', adjacency:'sometime', requireSameDay:false}]
      }
    ];
    // Wait — schedule link TO gone-task protects it. Use a habit that does NOT
    // protect noise-task via schedule links; only preferredTimeEnd does, which
    // also protects. So both would be protected. Need an unprotected deleted
    // task while another habit had a stale id that we scrub — but protect
    // collects live refs, so we can't have a scrub-and-delete of the same id.
    // Instead: delete unprotected noise-task when nothing references it, and
    // separately verify scrubRemovedHabitReferences.
    const scrubbed = scrubRemovedHabitReferences([
      {
        hid:'refers', name:'refers', type:'keepup',
        preferredTimeEndAnchor:'habit',
        preferredTimeEndAnchorHabitId:'noise-task',
        scheduleLinks:[{anchorHid:'gone-task', direction:'before', adjacency:'sometime', requireSameDay:false}]
      }
    ], new Set(['noise-task','gone-task']));
    const h = scrubbed[0];
    return {
      anchorCleared: h.preferredTimeEndAnchorHabitId == null && h.preferredTimeEndAnchor == null,
      beforeCleared: !(h.scheduleLinks || []).some(l => l.direction === 'before')
    };
  });
  assert(scrubCase.anchorCleared === true, 'scrub clears habit-anchor ids');
  assert(scrubCase.beforeCleared === true, 'scrub clears schedule-link anchors');

  console.log('\n[H] settings UI segs + clean now');
  const ui = await page.evaluate(async () => {
    if(typeof syncSettingsControls === 'function')syncSettingsControls();
    const open = document.getElementById('settings-cleanup-head');
    if(open)open.click();
    const daysSeg = document.getElementById('completed-task-retention-seg');
    const keepSeg = document.getElementById('habit-log-keep-seg');
    const cleanBtn = document.getElementById('retention-clean-now');
    const dayBtn = daysSeg && daysSeg.querySelector('[data-seg-value="3"]');
    const keepBtn = keepSeg && keepSeg.querySelector('[data-seg-value="12"]');
    if(dayBtn)dayBtn.click();
    if(keepBtn)keepBtn.click();
    const settings = loadSortSettings();
    // Seed an old completed task then force clean.
    const now = Date.now();
    const data = load();
    data.push({
      hid:'ui-old-task', name:'ui old', type:'task', emoji:'',
      lastLog:now - 10 * 86400000, logs:[now - 10 * 86400000],
      target:7, priority:3, topics:[], locationIds:[], snoozedUntil:null
    });
    save(normalize(data));
    const before = applyRetentionCleanup({force:true});
    const after = load().some(h => h.hid === 'ui-old-task');
    return {
      hasSection: Boolean(daysSeg && keepSeg && cleanBtn),
      days: settings.completedTaskRetentionDays,
      keep: settings.habitLogKeepCount,
      cleaned: before.changed === true,
      gone: after === false,
      summary: before.summary || ''
    };
  });
  assert(ui.hasSection === true, 'cleanup settings section present');
  assert(ui.days === 3, 'completed-task retention seg updates setting');
  assert(ui.keep === 12, 'habit-log keep seg updates setting');
  assert(ui.cleaned === true, 'clean now removes expired task');
  assert(ui.gone === true, 'expired task gone after clean now');
  assert(/Cleanup —/.test(ui.summary), 'clean now summary message');

  assert(pageErrors.length === 0, 'no page errors (' + pageErrors.join(' | ') + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
