// Emoji suggestion: exact keywords, fuzzy misspelling recovery, ambiguity
// rejection, and compact searchable pickers (add + detail sheets).
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let ok = 0;
let notOk = 0;
function check(label, cond, extra){
  if(cond){ ok++; console.log(`  ok ${label}`); }
  else{ notOk++; console.log(`not ok ${label}${extra !== undefined ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    existing.push({
      name:'placeholder habit', hid:'emoji-test-habit', type:'keepup', target:7,
      logs:[], emoji:'🚶', emojiBgColor:'', pinned:false, sample:false,
      snoozedUntil:null, topics:[], createdAt:Date.now()
    });
    existing.push({
      name:'no emoji habit', hid:'emoji-test-habit-2', type:'keepup', target:7,
      logs:[], emoji:'', emojiBgColor:'', pinned:false, sample:false,
      snoozedUntil:null, topics:[], createdAt:Date.now()
    });
    localStorage.setItem('tings_v2', JSON.stringify(existing));
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // --- pure matching ---
  const cases = [
    ['run', '🏃', 'exact keyword'],
    ['morning run', '🏃', 'strong beats time-of-day modifier'],
    ['read quran', '📖', 'multi-word phrase'],
    ['walk dog', '🐾', 'phrase tie resolves to earlier entry'],
    ['no sugar', '🥗', 'negation phrase'],
    ['guitar practice', '🔄', 'longest keyword wins'],
    ['drink water', '💧', 'phrase'],
    ['vape', '🚭', 'exact keyword'],
    ['jummah', '🕌', 'new faith keyword'],
    ['tennis', '🎾', 'new sport keyword'],
    ['physio', '🩺', 'new health keyword'],
    ['bowling', '🎳', 'new hobby keyword'],
    ['fishing', '🎣', 'longest prefix wins over fish'],
    ['chess', '♟️', 'new hobby keyword'],
    ['taxes', '🧾', 'new money keyword'],
    ['textbook study', '📚', 'longest keyword wins'],
    ['snowboarding', '⛷️', 'longest prefix wins over snow'],
    ['router', '📡', 'longest prefix wins over route'],
    ['read!', '📖', 'trailing punctuation stripped'],
    ['runnning', '🏃', 'typo caught by fuzzy against running'],
    ['swiming', '🏊', 'typo caught by prefix match'],
    ['meditatoin', '🧘', 'fuzzy: one-letter typo'],
    ['strech', '🤸', 'fuzzy: one-letter typo'],
    ['excersise', '🏋️', 'fuzzy: two-edit typo in long word'],
    ['vvorkout', '🏋️', 'fuzzy: leading extra letter'],
    ['dinnr', '🍽️', 'fuzzy: dropped letter'],
    ['moring excersise', '🏋️', 'fuzzy prefers real word over modifier'],
    ['wakeup', '🌅', 'compound wake is not makeup'],
    ['wake up', '🌅', 'wake up phrase'],
    ['wake-up', '🌅', 'hyphenated wakeup'],
    ['makeup', '💄', 'makeup still lipstick'],
    ['notebook', null, 'short keyword no is not a prefix of notebook'],
    ['team', null, 'tea is not a prefix of team'],
    ['taraweeh', '🕌', 'new faith keyword'],
    ['stocks', '💹', 'new money keyword'],
    ['make bed', '🛏️', 'new chore phrase'],
    ['early night', '🌙', 'new phrase beats modifier'],
    ['delete instagram', '🚫', 'new quitting phrase'],
    ['palnt', '🎨', 'fuzzy: paint is one edit, plant is two'],
    ['vook', null, 'fuzzy tie between book/cook is rejected'],
    ['berd', null, 'no close keyword -> no guess'],
    ['zzzzz', null, 'gibberish -> no match'],
    ['xy', null, 'too short for fuzzy'],
  ];
  const gotList = await page.evaluate(cs => cs.map(c => findEmojiMatch(c[0])), cases);
  cases.forEach((c, i) => {
    check(`match: ${c[0]} -> ${c[1] === null ? 'null' : c[1]} (${c[2]})`, gotList[i] === c[1], `got ${JSON.stringify(gotList[i])}`);
  });
  const fallbacks = await page.evaluate(() => ({
    z: suggestEmojiFor('zzzzz'),
    y: suggestEmojiFor('yyyyy'),
    empty: suggestEmojiFor(''),
    generic: GENERIC_EMOJIS,
    picker: PICKER_EMOJIS,
    wakeup: suggestEmojiFor('wakeup')
  }));
  check('unmatched name still gets a generic emoji', fallbacks.generic.includes(fallbacks.z), fallbacks.z);
  check('different unmatched names can pick different generics', fallbacks.z !== fallbacks.y || fallbacks.generic.length === 1, `${fallbacks.z} vs ${fallbacks.y}`);
  check('empty name has no suggested emoji', fallbacks.empty === null, fallbacks.empty);
  check('wakeup suggestion stays sunrise, not a generic', fallbacks.wakeup === '🌅', fallbacks.wakeup);
  check('picker has a large common set', fallbacks.picker.length >= 80, fallbacks.picker.length);
  check('picker includes every fallback generic', fallbacks.generic.every(e => fallbacks.picker.includes(e)));
  check('picker includes generally used mapped emojis', ['🏃','☕','📚','💼','🧘'].every(e => fallbacks.picker.includes(e)));

  // --- generic quick-pick rows ---
  const rows = await page.evaluate(() => {
    const tingRow = document.getElementById('ting-generic-emoji');
    const detRow = document.getElementById('detail-generic-emoji');
    const chipCount = tingRow ? tingRow.querySelectorAll('.generic-emoji-chip').length : 0;
    const generic = [...(tingRow ? tingRow.querySelectorAll('.generic-emoji-chip') : [])].map(c => c.textContent);
    const detailCount = detRow ? detRow.querySelectorAll('.generic-emoji-chip').length : 0;
    return {
      chipCount,
      pickerCount: PICKER_EMOJIS.length,
      generic,
      detailCount,
      detailSame: detRow && JSON.stringify([...detRow.querySelectorAll('.generic-emoji-chip')].map(c => c.textContent)) === JSON.stringify(generic)
    };
  });
  check('add picker renders only the first batch', rows.chipCount === 80 && rows.pickerCount > rows.chipCount, JSON.stringify({ chipCount: rows.chipCount, pickerCount: rows.pickerCount }));
  check('detail picker starts with the same bounded set', rows.detailCount === rows.chipCount && rows.detailSame, JSON.stringify({ detailCount: rows.detailCount, chipCount: rows.chipCount }));

  // --- chip tap fills the add-sheet field and counts as a user choice ---
  const chipFill = await page.evaluate(() => {
    const chip = document.querySelector('#ting-generic-emoji .generic-emoji-chip');
    chip.click();
    return { value: document.getElementById('ting-emoji').value, chipText: chip.textContent };
  });
  check('tapping a quick-pick chip fills the add emoji field', chipFill.value === chipFill.chipText, JSON.stringify(chipFill));

  const chipGuard = await page.evaluate(() => {
    document.getElementById('ting-message').value = 'running';
    document.getElementById('ting-message').dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('ting-emoji').value;
  });
  await page.waitForTimeout(500);
  const chipGuardAfter = await page.evaluate(() => document.getElementById('ting-emoji').value);
  check('name edits do not overwrite a chip choice', chipGuardAfter === chipGuard, `got ${chipGuardAfter}`);

  const detChip = await page.evaluate(() => {
    const chip = document.querySelector('#detail-generic-emoji .generic-emoji-chip');
    chip.click();
    return { value: document.getElementById('detail-emoji').value, chipText: chip.textContent };
  });
  check('tapping a quick-pick chip fills the detail emoji field', detChip.value === detChip.chipText, JSON.stringify(detChip));

  // --- add-sheet auto-fill through the UI ---
  await page.locator('#open-add').click();
  const nameInput = page.locator('#ting-message');
  await nameInput.fill('running');
  await page.waitForTimeout(500);
  check('typing "running" auto-fills 🏃', (await page.locator('#ting-emoji').inputValue()) === '🏃', await page.locator('#ting-emoji').inputValue());

  await nameInput.fill('zzzzz');
  await page.waitForTimeout(500);
  const genericFill = await page.locator('#ting-emoji').inputValue();
  const genericOk = await page.evaluate(val => GENERIC_EMOJIS.includes(val), genericFill);
  check('gibberish name fills a neutral generic emoji', genericOk, genericFill);
  const editorHidden = await page.evaluate(() => document.getElementById('ting-emoji-edit').hidden);
  check('add sheet stays uncluttered: editor not auto-revealed on no match', editorHidden);
  await page.locator('#ting-emoji-preview').click();
  const chipsRevealed = await page.evaluate(() => {
    const row = document.getElementById('ting-generic-emoji');
    return !document.getElementById('ting-emoji-edit').hidden && row.querySelectorAll('.generic-emoji-chip').length > 0;
  });
  check('tapping the preview tile reveals the quick-pick chips', chipsRevealed);
  await page.waitForFunction(() => _emojiCatalog?.length >= 3900);
  const rowLayout = await page.evaluate(() => {
    const row = document.getElementById('ting-generic-emoji');
    const style = getComputedStyle(row);
    return {display:style.display, height:row.clientHeight, scrollable:row.scrollHeight > row.clientHeight,
      fits:row.scrollWidth <= row.clientWidth, count:row.childElementCount};
  });
  check('emoji picker is a compact vertical grid without horizontal overflow',
    rowLayout.display === 'grid' && rowLayout.height <= 184 && rowLayout.scrollable
      && rowLayout.fits && rowLayout.count <= 160, JSON.stringify(rowLayout));
  check('full catalog includes flags, skin tones, and joined emoji', await page.evaluate(() =>
    ['🇯🇵','👍🏽','👩🏽‍❤️‍💋‍👨🏻','🦦'].every(emoji=>_emojiCatalog.some(entry=>entry.emoji === emoji))));
  const search = page.locator('#ting-emoji-search');
  await search.fill('otter');
  await page.locator('#ting-generic-emoji button').filter({hasText:'🦦'}).click();
  check('search finds and selects an emoji outside the old common set', await page.locator('#ting-emoji').inputValue() === '🦦');
  await search.fill('thumbs up medium skin tone');
  await page.locator('#ting-generic-emoji button').filter({hasText:'👍🏽'}).click();
  check('skin-tone selection preserves the complete emoji', await page.locator('#ting-emoji').inputValue() === '👍🏽');
  await search.fill('');
  await search.fill('japan');
  check('search finds country flags', await page.locator('#ting-generic-emoji button').filter({hasText:'🇯🇵'}).count() === 1);
  await search.fill('nothing-matches-this-emoji');
  check('empty search has a concise recovery hint', await page.locator('#ting-emoji-status').isVisible()
    && (await page.locator('#ting-emoji-status').textContent()).includes('paste'));
  await search.fill('kiss man woman');
  const joinedEmoji = '👩🏽‍❤️‍💋‍👨🏻';
  await page.locator('#ting-emoji').fill(joinedEmoji);
  check('pasting a long joined emoji does not truncate it', await page.locator('#ting-emoji').inputValue() === joinedEmoji);
  // Reset the manual-choice guard before continuing auto-suggestion checks.
  await page.evaluate(() => {clearEmojiSuggestion();});

  await nameInput.fill('meditatoin');
  await page.waitForTimeout(500);
  check('typing "meditatoin" auto-fills 🧘', (await page.locator('#ting-emoji').inputValue()) === '🧘', await page.locator('#ting-emoji').inputValue());

  // --- user clearing the emoji is respected ---
  await page.evaluate(() => {
    const el = document.getElementById('ting-emoji');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await nameInput.fill('running again');
  await page.waitForTimeout(500);
  check('manually cleared emoji is not force-refilled', (await page.locator('#ting-emoji').inputValue()) === '', await page.locator('#ting-emoji').inputValue());

  // --- detail-sheet auto-suggest (rename) ---
  await page.evaluate(() => { if(typeof openDetail === 'function')openDetail(0); });
  await page.locator('#detail-sheet.open').waitFor({ timeout: 5000 });
  const detailState = await page.evaluate(() => ({
    name: document.getElementById('detail-habit-message').value,
    emoji: document.getElementById('detail-emoji').value
  }));
  check('detail opens with seeded emoji intact', detailState.emoji === '🚶', JSON.stringify(detailState));

  const rename = await page.evaluate(() => {
    const el = document.getElementById('detail-habit-message');
    el.value = 'strech';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const afterRename = await page.evaluate(() => document.getElementById('detail-emoji').value);
  check('renaming does not overwrite an existing emoji', afterRename === '🚶', `got ${afterRename}`);

  await page.evaluate(() => {
    const el = document.getElementById('detail-emoji');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => { if(typeof openDetail === 'function')openDetail(1); });
  await page.locator('#detail-sheet.open').waitFor({ timeout: 5000 });
  const rename2 = await page.evaluate(() => {
    const el = document.getElementById('detail-habit-message');
    el.value = 'meditatoin';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const afterRename2 = await page.evaluate(() => document.getElementById('detail-emoji').value);
  check('renaming a habit with an empty emoji auto-suggests 🧘', afterRename2 === '🧘', `got ${afterRename2}`);

  const rename3 = await page.evaluate(() => {
    const el = document.getElementById('detail-habit-message');
    el.value = 'strech';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const afterRename3 = await page.evaluate(() => document.getElementById('detail-emoji').value);
  check('auto-suggested emoji is overwritten by a better rename match', afterRename3 === '🤸', `got ${afterRename3}`);

  // --- detail header emoji offers log vs edit, home pulse still logs ---
  await page.evaluate(() => { if(typeof openDetail === 'function')openDetail(0); });
  await page.locator('#detail-sheet.open').waitFor({ timeout: 5000 });
  const menuHiddenAtOpen = await page.evaluate(() => document.getElementById('detail-mark-menu').hidden);
  check('detail header menu is closed on open', menuHiddenAtOpen);
  await page.locator('#detail-mark').click();
  const menuOpen = await page.evaluate(() => {
    const menu = document.getElementById('detail-mark-menu');
    const log = document.getElementById('detail-mark-log');
    const edit = document.getElementById('detail-mark-edit-emoji');
    return {
      hidden: menu.hidden,
      log: log && log.textContent.trim(),
      edit: edit && edit.textContent.trim(),
      expanded: document.getElementById('detail-mark').getAttribute('aria-expanded')
    };
  });
  check('tapping the detail header emoji opens two choices', !menuOpen.hidden && menuOpen.log === 'log an entry' && menuOpen.edit === 'edit emoji' && menuOpen.expanded === 'true', JSON.stringify(menuOpen));
  await page.locator('#detail-mark-edit-emoji').click();
  await page.waitForTimeout(400);
  const editorOpen = await page.evaluate(() => {
    return {
      menuHidden: document.getElementById('detail-mark-menu').hidden,
      appearanceOpen: document.getElementById('detail-appearance-disclosure').open,
      nav: detailCurrentNav()
    };
  });
  check('edit emoji closes the menu and opens the emoji page', editorOpen.menuHidden && editorOpen.appearanceOpen && editorOpen.nav === 'identity', JSON.stringify(editorOpen));
  const detailRowLayout = await page.evaluate(() => {
    const row = document.getElementById('detail-generic-emoji');
    return {display:getComputedStyle(row).display,height:row.clientHeight,fits:row.scrollWidth <= row.clientWidth};
  });
  check('detail uses the same compact grid', detailRowLayout.display === 'grid' && detailRowLayout.height <= 184
    && detailRowLayout.fits, JSON.stringify(detailRowLayout));
  await page.locator('#detail-emoji-search').fill('otter');
  await page.locator('#detail-generic-emoji button').filter({hasText:'🦦'}).click();
  check('detail catalog selection updates the field and marks it dirty', await page.locator('#detail-emoji').inputValue() === '🦦'
    && await page.locator('#detail-sheet .sheet').evaluate(el=>el.classList.contains('tune-dirty')));
  await page.evaluate(() => { if(typeof openDetail === 'function')openDetail(0); });
  await page.locator('#detail-sheet.open').waitFor({ timeout: 5000 });
  await page.locator('#detail-name').click();
  await page.waitForTimeout(400);
  const nameEditor = await page.evaluate(() => {
    const field = document.getElementById('detail-habit-message');
    return {
      nav: detailCurrentNav(),
      nameOpen: document.getElementById('detail-name-disclosure').open,
      focused: document.activeElement === field
    };
  });
  check('tapping the detail header name opens the name editor', nameEditor.nav === 'identity' && nameEditor.nameOpen && nameEditor.focused, JSON.stringify(nameEditor));
  await page.evaluate(() => { closeDetail(); openDetail(0); });
  const beforeLogs = await page.evaluate(() => (load()[0].logs || []).length);
  await page.locator('#detail-mark').click();
  await page.locator('#detail-mark-log').click();
  const afterLogs = await page.evaluate(() => (load()[0].logs || []).length);
  check('detail header log choice adds an entry', afterLogs === beforeLogs + 1, `${beforeLogs} -> ${afterLogs}`);
  await page.evaluate(() => {
    if(typeof closeSheet === 'function')closeSheet('add-sheet');
    if(typeof closeDetail === 'function')closeDetail();
  });
  const homeBefore = await page.evaluate(() => (load()[0].logs || []).length);
  await page.locator('#list [data-pulse="0"]').click();
  await page.waitForFunction(prev => (load()[0].logs || []).length === prev + 1, homeBefore, { timeout: 4000 });
  const homeAfter = await page.evaluate(() => (load()[0].logs || []).length);
  check('home pulse still logs immediately without a menu', homeAfter === homeBefore + 1, `${homeBefore} -> ${homeAfter}`);

  // Desktop: lazy loading, recovery, wheel scrolling, keyboard selection, persistence.
  const desktop = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  desktop.on('pageerror',e=>pageErrors.push(String(e)));
  await desktop.addInitScript(()=>{
    localStorage.setItem('tings_coach_install_v2','done');
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,showWeekOnHome:false}));
  });
  let catalogRequests = 0;
  await desktop.route('**/lib/emoji/catalog.json',async route=>{
    catalogRequests++;
    if(catalogRequests === 1)await route.fulfill({status:503,body:'unavailable'});
    else await route.continue();
  });
  await desktop.goto(baseUrl,{waitUntil:'networkidle'});
  check('catalog does not load on startup', catalogRequests === 0);
  await desktop.locator('#bar-open-add').click();
  await desktop.locator('#ting-message').fill('Desktop emoji');
  await desktop.locator('#ting-emoji-preview').click();
  await desktop.locator('#ting-emoji-status').waitFor();
  check('catalog failure leaves common emoji usable', await desktop.locator('#ting-generic-emoji button').count() === 80);
  await desktop.locator('#ting-emoji-search').fill('otter');
  await desktop.waitForFunction(()=>_emojiCatalog?.length >= 3900);
  check('catalog retries successfully', catalogRequests === 2);
  check('desktop keeps emoji search focused', await desktop.locator('#ting-emoji-search').evaluate(el=>document.activeElement === el));
  await desktop.locator('#ting-emoji-search').fill('');
  const gridBox = await desktop.locator('#ting-generic-emoji').boundingBox();
  await desktop.mouse.move(gridBox.x + gridBox.width / 2,gridBox.y + gridBox.height / 2);
  await desktop.mouse.wheel(0,1200);
  await desktop.waitForFunction(()=>document.getElementById('ting-generic-emoji').childElementCount > 80);
  check('mouse-wheel browsing loads more emoji', await desktop.locator('#ting-generic-emoji').evaluate(el=>el.scrollTop > 0));
  await desktop.locator('#ting-emoji-search').fill('otter');
  await desktop.locator('#ting-emoji-search').press('ArrowDown');
  await desktop.keyboard.press('Enter');
  check('desktop can select a search result with the keyboard', await desktop.locator('#ting-emoji').inputValue() === '🦦', JSON.stringify(await desktop.evaluate(()=>({active:document.activeElement.outerHTML,value:document.getElementById('ting-emoji').value}))));
  await desktop.locator('#ting-message').fill('Saved desktop emoji');
  await desktop.waitForTimeout(350);
  await desktop.locator('#do-save').click();
  await desktop.waitForFunction(()=>load().some(h=>h.name === 'Saved desktop emoji' && h.emoji === '🦦'));
  check('selected emoji persists after adding', await desktop.evaluate(()=>load().some(h=>h.name === 'Saved desktop emoji' && h.emoji === '🦦')));
  await desktop.evaluate(()=>openDetail(load().findIndex(h=>h.name === 'Saved desktop emoji')));
  await desktop.locator('#detail-mark').click();
  await desktop.locator('#detail-mark-edit-emoji').click();
  await desktop.locator('#detail-emoji-search').fill('japan');
  await desktop.locator('#detail-generic-emoji button').filter({hasText:'🇯🇵'}).click();
  await desktop.screenshot({path:'test-results/emoji-picker-desktop.png',fullPage:true});
  await desktop.locator('#detail-save').click();
  check('detail emoji changes persist after saving', await desktop.evaluate(()=>load().some(h=>h.name === 'Saved desktop emoji' && h.emoji === '🇯🇵')));
  await desktop.close();

  // --- no page errors ---
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`# ${ok} ok, ${notOk} not ok`);
  await browser.close();
  process.exit(notOk > 0 || pageErrors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
