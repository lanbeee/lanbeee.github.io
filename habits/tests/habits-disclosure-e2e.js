// Add-sheet progressive disclosure + Settings collapsible sections.
// Verifies the "more options" toggle hides the advanced fields by default,
// expands on click, and re-collapses every time the add sheet reopens; and
// that Settings collapsible sections open/close with correct aria-expanded.
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(cond, msg){
  if(!cond)throw new Error(`assert failed: ${msg}`);
}

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true });
  const errors = [];
  page.on('console', msg => { if(msg.type() === 'error')errors.push(`console: ${msg.text()}`);});
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(baseUrl, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');

  // ── 1. add sheet opens with more-options collapsed ──
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  assert(await page.locator('#add-more-options').isHidden(), 'more-options hidden on first open');
  assert((await page.locator('#add-more-toggle').getAttribute('aria-expanded')) === 'false', 'toggle aria-expanded=false');
  // priority and topics live behind it
  assert(await page.locator('#ting-priority-seg').isHidden(), 'priority seg hidden behind toggle');
  assert(await page.locator('#ting-auto-mark').isHidden(), 'auto-mark hidden behind toggle');
  assert(await page.locator('#add-topics-section').isHidden(), 'topics hidden behind toggle');

  // ── 2. default type (keepup) shows the rhythm slider but not task-only rows ──
  assert(await page.locator('#target-slider-row').isVisible(), 'rhythm slider visible for build type');
  assert(await page.locator('#task-due-row').isHidden(), 'task due row hidden for build type');

  // ── 3. expanding reveals the advanced fields and flips aria-expanded ──
  await page.locator('#add-more-toggle').click();
  assert(await page.locator('#add-more-options').isVisible(), 'more-options visible after click');
  assert((await page.locator('#add-more-toggle').getAttribute('aria-expanded')) === 'true', 'toggle aria-expanded=true');
  assert(await page.locator('#ting-priority-seg').isVisible(), 'priority seg visible after expand');

  // ── 4. switching to task surfaces due date row (date + optional time) ──
  await page.locator('#type-seg [data-v="task"]').click();
  assert(await page.locator('#task-due-row').isVisible(), 'task due row visible for task type');
  assert(await page.locator('#ting-due-time').isVisible(), 'due time input visible on task row');

  // collapsing again re-hides everything
  await page.locator('#add-more-toggle').click();
  assert(await page.locator('#add-more-options').isHidden(), 'more-options hidden after collapse');
  assert(await page.locator('#ting-priority-seg').isHidden(), 'priority seg hidden after collapse');

  // ── 5. reopening the sheet always re-collapses more-options ──
  await page.locator('#do-cancel').click();
  await page.waitForFunction(()=> !document.getElementById('add-sheet').classList.contains('open'), null, { timeout:5000 });
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  assert(await page.locator('#add-more-options').isHidden(), 'more-options re-collapsed on reopen');
  assert((await page.locator('#add-more-toggle').getAttribute('aria-expanded')) === 'false', 'toggle aria-expanded reset to false on reopen');

  await page.locator('#do-cancel').click();

  // ── 6. Settings collapsible sections open/close with synced aria-expanded ──
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  // the reorganized sections are collapsed by default
  const cardsHead = '#settings-cards-head';
  const cardsBody = '#settings-cards-body';
  assert(await page.locator(cardsBody).isHidden(), 'cards section collapsed by default');
  assert((await page.locator(cardsHead).getAttribute('aria-expanded')) === 'false', 'cards head aria-expanded=false');
  await page.locator(cardsHead).click();
  assert(await page.locator(cardsBody).isVisible(), 'cards section expands on click');
  assert((await page.locator(cardsHead).getAttribute('aria-expanded')) === 'true', 'cards head aria-expanded=true after click');
  await page.locator(cardsHead).click();
  assert(await page.locator(cardsBody).isHidden(), 'cards section re-collapses');

  // the backup section stays open by default (not a .settings-collapsible)
  assert(await page.locator('#backup-export').isVisible(), 'backup export always visible (open by default)');
  assert(await page.locator('#backup-import').isVisible(), 'backup import always visible (open by default)');

  // ── 7. mutating a setting inside an open section must NOT collapse it ──
  // Regression guard: updateSortSetting -> syncSettingsControls used to re-fold
  // every section, so editing a field (a toggle, a blocked-time label, …) would
  // snap the section shut mid-edit. The collapse must happen only on sheet open.
  await page.locator(cardsHead).click();
  assert(await page.locator(cardsBody).isVisible(), 'cards section expanded before mutation');
  const switchBefore = await page.locator('[data-setting-toggle="showSnoozed"]').getAttribute('aria-pressed');
  await page.locator('[data-setting-toggle="showSnoozed"]').click();
  await page.waitForTimeout(200);
  assert(await page.locator(cardsBody).isVisible(), 'cards body stays open after toggling a setting inside it');
  assert((await page.locator(cardsHead).getAttribute('aria-expanded')) === 'true', 'cards head stays expanded after mutation');
  const switchAfter = await page.locator('[data-setting-toggle="showSnoozed"]').getAttribute('aria-pressed');
  assert(switchBefore !== switchAfter, 'the toggle inside the open section actually changed state');

  await page.locator('#settings-close').click();
  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('Disclosure e2e passed');
})().catch(async err=>{
  console.error(err);
  process.exit(1);
});
