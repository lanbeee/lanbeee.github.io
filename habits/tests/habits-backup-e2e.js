// Backup/export/import — exercises both the pure data.js core
// (buildBackup / parseBackup / restoreBackup) and the full Settings UI
// round trip (export download → file input → count confirmation → replace).
const { chromium } = require('playwright');
const fs = require('fs');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

function assert(cond, msg){
  if(!cond)throw new Error(`assert failed: ${msg}`);
}

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true });
  const errors = [];
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`);});
  page.on('pageerror', err => errors.push(err.message));

  await page.addInitScript(()=>{
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'backup-a', type:'keepup', target:7, logs:[Date.now()], emoji:'🅰️' },
      { name:'backup-b', type:'task', target:null, dueDate:Date.now(), logs:[] }
    ]));
  });
  await page.goto(baseUrl, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');

  // ── 1. buildBackup shape ──
  const shape = await page.evaluate(()=>{
    const b = buildBackup();
    return { app:b.app, version:b.version, hasHabits:Array.isArray(b.habits), n:b.habits.length, hasSettings:b.settings && typeof b.settings === 'object' };
  });
  assert(shape.app === 'tings', 'buildBackup app === tings');
  assert(shape.version === 1, 'buildBackup version === 1');
  assert(shape.hasHabits && shape.n === 2, 'buildBackup carries the 2 seeded habits');
  assert(shape.hasSettings, 'buildBackup carries settings');

  // ── 2. parseBackup accepts wrapped object, bare array, and JSON string ──
  const wrapped = await page.evaluate(()=>{
    const r = parseBackup({app:'tings',version:1,habits:[{name:'x',type:'keepup'}],settings:{planWeight:50}});
    return { ok:r.ok, n:r.habits.length, hasSettings:!!r.settings };
  });
  assert(wrapped.ok && wrapped.n === 1 && wrapped.hasSettings, 'parseBackup accepts wrapped {habits,settings}');

  const bare = await page.evaluate(()=>{
    const r = parseBackup([{name:'y',type:'task'}]);
    return { ok:r.ok, n:r.habits.length, hasSettings:r.settings };
  });
  assert(bare.ok && bare.n === 1 && bare.hasSettings === null, 'parseBackup accepts a bare habits array (legacy export)');

  const asString = await page.evaluate(()=>{
    const r = parseBackup(JSON.stringify({habits:[{name:'z'}]}));
    return { ok:r.ok, n:r.habits.length };
  });
  assert(asString.ok && asString.n === 1, 'parseBackup accepts a JSON string');

  // ── 3. parseBackup rejects garbage with a reason ──
  const bad = await page.evaluate(()=>{
    return {
      json: parseBackup('not json'),
      noArr: parseBackup({foo:1}),
      nonObj: parseBackup(42),
      empty: parseBackup(null)
    };
  });
  assert(!bad.json.ok && /json/i.test(bad.json.reason), 'parseBackup rejects invalid JSON');
  assert(!bad.noArr.ok, 'parseBackup rejects object without habits');
  assert(!bad.nonObj.ok, 'parseBackup rejects a primitive');
  assert(!bad.empty.ok, 'parseBackup rejects null');

  // ── 4. restoreBackup replaces all local data and returns the count ──
  const restored = await page.evaluate(()=>{
    return restoreBackup({habits:[
      {name:'restored-1',type:'keepup'},
      {name:'restored-2',type:'task'},
      {name:'restored-3',type:'zero'}
    ]});
  });
  assert(restored.ok && restored.count === 3, 'restoreBackup returns count 3');
  const afterRestore = await page.evaluate(()=> JSON.parse(localStorage.getItem('tings_v2')));
  assert(afterRestore.length === 3, 'restoreBackup wrote 3 habits');
  assert(afterRestore.some(h => h.name === 'restored-1'), 'restoreBackup wrote the new items');
  assert(!afterRestore.some(h => h.name === 'backup-a'), 'restoreBackup fully replaced the old data');

  // ── 5. UI: export triggers a timestamped download with the right contents ──
  await page.evaluate(()=>{
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'exported-1', type:'keepup', target:3, logs:[], emoji:'🚀' }
    ]));
  });
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup-export').click()
  ]);
  const fname = download.suggestedFilename();
  if(!/^tings-backup-\d{4}-\d{2}-\d{2}\.json$/.test(fname))
    throw new Error(`unexpected export filename: ${fname}`);
  const tmpPath = `/tmp/habits-backup-test-${Date.now()}.json`;
  await download.saveAs(tmpPath);
  const exported = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
  assert(exported.app === 'tings' && exported.version === 1, 'exported file has app/version');
  assert(Array.isArray(exported.habits) && exported.habits.length === 1, 'exported file has 1 habit');
  assert(exported.habits[0].name === 'exported-1', 'exported file carries the right habit');

  // ── 6. UI: a valid import shows a count-based confirmation before touching data ──
  await page.evaluate(()=>{
    localStorage.setItem('tings_v2', JSON.stringify([{ name:'current', type:'keepup', logs:[] }]));
  });
  const importPayload = JSON.stringify({
    app:'tings', version:1, exportedAt:Date.now(),
    habits:[{name:'imp-1',type:'task'},{name:'imp-2',type:'keepup'}],
    settings:{}
  });
  await page.locator('#backup-file-input').setInputFiles({
    name:'import.json', mimeType:'application/json', buffer:Buffer.from(importPayload,'utf-8')
  });
  await page.locator('#backup-import-confirm').waitFor({ state:'visible' });
  const summary = await page.locator('#backup-import-summary').textContent();
  if(!/replace\s+1\s+habit\b/i.test(summary || '') || !/with\s+2\b/i.test(summary || ''))
    throw new Error(`import summary did not show counts: ${summary}`);
  // data NOT replaced yet
  const beforeConfirm = await page.evaluate(()=> JSON.parse(localStorage.getItem('tings_v2')));
  assert(beforeConfirm.length === 1 && beforeConfirm[0].name === 'current', 'data unchanged until confirm');

  // ── 7. confirm replaces data and reports success ──
  await page.locator('#backup-import-yes').click();
  await page.waitForFunction(()=> /imported\s+2\s+habits/i.test((document.getElementById('backup-status')||{}).textContent||''), null, { timeout:5000 });
  const afterConfirm = await page.evaluate(()=> JSON.parse(localStorage.getItem('tings_v2')));
  assert(afterConfirm.length === 2, 'confirm imported 2 habits');
  assert(afterConfirm.some(h => h.name === 'imp-1'), 'confirm wrote imp-1');
  assert(!afterConfirm.some(h => h.name === 'current'), 'confirm removed the previous data');

  // ── 8. cancel does not touch data ──
  await page.evaluate(()=>{
    localStorage.setItem('tings_v2', JSON.stringify([{ name:'keep-me', type:'keepup', logs:[] }]));
  });
  await page.locator('#backup-file-input').setInputFiles({
    name:'import2.json', mimeType:'application/json', buffer:Buffer.from(importPayload,'utf-8')
  });
  await page.locator('#backup-import-confirm').waitFor({ state:'visible' });
  await page.locator('#backup-import-no').click();
  await page.waitForFunction(()=> document.getElementById('backup-import-confirm').hidden, null, { timeout:5000 });
  const afterCancel = await page.evaluate(()=> JSON.parse(localStorage.getItem('tings_v2')));
  assert(afterCancel.length === 1 && afterCancel[0].name === 'keep-me', 'cancel left data untouched');

  // ── 9. an invalid file reports an error inline and never asks to confirm ──
  await page.locator('#backup-file-input').setInputFiles({
    name:'bad.json', mimeType:'application/json', buffer:Buffer.from('{not valid json','utf-8')
  });
  await page.waitForTimeout(300);
  const confirmVisible = await page.locator('#backup-import-confirm').isVisible();
  assert(!confirmVisible, 'invalid file must not show the confirm box');
  const status = await page.locator('#backup-status').textContent();
  assert(status && status.trim().length > 0, 'invalid file reports an inline error');
  const stillSafe = await page.evaluate(()=> JSON.parse(localStorage.getItem('tings_v2')));
  assert(stillSafe.length === 1 && stillSafe[0].name === 'keep-me', 'invalid file left data untouched');

  // ── 10. an oversized backup is trimmed to MAX_TINGS (300) ──
  const oversized = await page.evaluate(()=>{
    const MAX = 300;
    const habits = Array.from({length:400},(_,i)=>({name:`h${i}`,type:'keepup'}));
    const r = restoreBackup({habits});
    const stored = JSON.parse(localStorage.getItem('tings_v2'));
    return { ok:r.ok, count:r.count, stored:stored.length, first:stored[0].name, last:stored[stored.length-1].name };
  });
  assert(oversized.ok && oversized.count === 300, 'restoreBackup reports count 300 for an oversized backup');
  assert(oversized.stored === 300, 'restoreBackup trims stored habits to MAX_TINGS');
  assert(oversized.first === 'h0' && oversized.last === 'h299', 'restoreBackup keeps the first 300 in order');

  // ── 11. settings travel with the backup and are applied on restore ──
  const rt = await page.evaluate(()=>{
    saveSortSettings({...sortSettings, dueWeight:123, topics:['roundtrip']});
    save([{name:'rt-habit',type:'keepup'}]);
    const blob = JSON.stringify(buildBackup());
    localStorage.removeItem('tings_v2');
    localStorage.removeItem('tings_app_settings_v2');
    const res = restoreBackup(blob);
    const settings = loadSortSettings();
    const habits = load();
    return { ok:res.ok, dueWeight:settings.dueWeight, topics:settings.topics, firstName:habits[0] && habits[0].name };
  });
  assert(rt.ok, 'settings round-trip restore ok');
  assert(rt.dueWeight === 123, 'settings round-trip preserves dueWeight');
  assert(Array.isArray(rt.topics) && rt.topics.includes('roundtrip'), 'settings round-trip preserves topics');
  assert(rt.firstName === 'rt-habit', 'settings round-trip still restores habits');

  await page.locator('#settings-close').click();
  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('Backup e2e passed');
})().catch(async err=>{
  console.error(err);
  process.exit(1);
});
