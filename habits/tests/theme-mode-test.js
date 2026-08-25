// Manual light/dark theme must pin native controls, not follow the OS.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/theme-mode-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

async function launchBrowser(){
  const attempts = [
    { headless:true, channel:'chrome' },
    { headless:true },
    { headless:true, args:['--disable-gpu'] }
  ];
  let lastErr = null;
  for(const opts of attempts){
    for(let i = 0; i < 2; i++){
      try{
        return await chromium.launch(opts);
      }catch(err){
        lastErr = err;
        await sleep(400);
      }
    }
  }
  throw lastErr || new Error('chromium.launch failed');
}

function seedSettings(themeMode){
  return {
    preset:'todayFirst', topics:[], locations:[], travel:{},
    defaultTravelMode:'driving', blockedTimes:[],
    themeMode: themeMode || 'system'
  };
}

async function themeSnapshot(page){
  return page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const date = document.createElement('input');
    date.type = 'date';
    date.value = '2026-08-25';
    document.body.appendChild(date);
    const select = document.createElement('select');
    select.appendChild(document.createElement('option'));
    document.body.appendChild(select);
    const dateCs = getComputedStyle(date);
    const selectCs = getComputedStyle(select);
    const meta = document.querySelector('meta[name="color-scheme"]');
    const out = {
      dataTheme: root.getAttribute('data-theme') || '',
      rootColorScheme: (cs.colorScheme || '').trim(),
      inlineColorScheme: (root.style.colorScheme || '').trim(),
      metaColorScheme: (meta && meta.content || '').trim(),
      dateColorScheme: (dateCs.colorScheme || '').trim(),
      selectColorScheme: (selectCs.colorScheme || '').trim(),
      fieldBg: cs.getPropertyValue('--field-bg').trim().toLowerCase(),
      bg: cs.getPropertyValue('--bg').trim().toLowerCase(),
      text: cs.getPropertyValue('--text').trim().toLowerCase(),
      dateBg: (dateCs.backgroundColor || '').replace(/\s+/g, ''),
      bodyBg: getComputedStyle(document.body).backgroundColor.replace(/\s+/g, '')
    };
    date.remove();
    select.remove();
    return out;
  });
}

function isDarkTokens(snap){
  return snap.bg === '#1c1c1e' && snap.fieldBg === '#34343a' && snap.text === '#f2f2f7';
}
function isLightTokens(snap){
  return snap.bg === '#ffffff' && snap.fieldBg === '#e0dfd9' && snap.text === '#1a1a1a';
}
function pinsDark(snap){
  return snap.dataTheme === 'dark'
    && snap.rootColorScheme === 'dark'
    && snap.dateColorScheme === 'dark'
    && snap.selectColorScheme === 'dark'
    && snap.metaColorScheme === 'dark';
}
function pinsLight(snap){
  return snap.dataTheme === 'light'
    && snap.rootColorScheme === 'light'
    && snap.dateColorScheme === 'light'
    && snap.selectColorScheme === 'light'
    && snap.metaColorScheme === 'light';
}

async function pickTheme(page, value){
  await page.evaluate(() => {
    if(typeof openSheet === 'function')openSheet('settings-sheet');
  });
  await page.waitForSelector('#settings-sheet.open');
  const head = page.locator('#settings-appearance-head');
  await head.scrollIntoViewIfNeeded();
  const expanded = await head.getAttribute('aria-expanded');
  if(expanded !== 'true')await head.click();
  await page.waitForSelector('#settings-appearance-body:not([hidden])');
  await page.locator(`#theme-mode-seg [data-seg-value="${value}"]`).click();
  await sleep(80);
}

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport:{ width:390, height:844 },
    isMobile:true,
    hasTouch:true,
    colorScheme:'light',
    serviceWorkers:'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(settings => {
    if(sessionStorage.getItem('skip-theme-seed') === '1')return;
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, seedSettings('system'));

  await page.goto(baseUrl, { waitUntil:'load' });
  await sleep(300);
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  console.log('\n[A] OS light + pick dark pins native controls');
  await pickTheme(page, 'dark');
  const darkOnLight = await themeSnapshot(page);
  assert(pinsDark(darkOnLight), 'forced dark sets data-theme, color-scheme, and meta to dark');
  assert(isDarkTokens(darkOnLight), 'forced dark uses dark tokens including --field-bg');
  assert(darkOnLight.inlineColorScheme === 'dark', 'forced dark sets html style.color-scheme');

  console.log('\n[B] OS light + pick light still pins light (does not wait for OS)');
  await pickTheme(page, 'light');
  const lightOnLight = await themeSnapshot(page);
  assert(pinsLight(lightOnLight), 'forced light sets data-theme, color-scheme, and meta to light');
  assert(isLightTokens(lightOnLight), 'forced light keeps light tokens');

  console.log('\n[C] OS dark + pick light overrides system dark');
  await page.emulateMedia({ colorScheme:'dark' });
  await sleep(50);
  const lightOnDark = await themeSnapshot(page);
  assert(pinsLight(lightOnDark), 'forced light stays pinned when OS turns dark');
  assert(isLightTokens(lightOnDark), 'forced light tokens survive OS dark');

  console.log('\n[D] OS dark + pick dark matches, then system follows OS');
  await pickTheme(page, 'dark');
  const darkOnDark = await themeSnapshot(page);
  assert(pinsDark(darkOnDark) && isDarkTokens(darkOnDark), 'forced dark on OS dark stays dark');

  await pickTheme(page, 'system');
  const systemOnDark = await themeSnapshot(page);
  assert(systemOnDark.dataTheme === '', 'system mode clears data-theme');
  assert(systemOnDark.metaColorScheme === 'light dark', 'system mode restores meta color-scheme');
  assert(isDarkTokens(systemOnDark), 'system mode on OS dark uses dark tokens');

  await page.emulateMedia({ colorScheme:'light' });
  await sleep(50);
  const systemOnLight = await themeSnapshot(page);
  assert(systemOnLight.dataTheme === '', 'system mode stays unset after OS light');
  assert(isLightTokens(systemOnLight), 'system mode on OS light uses light tokens');

  console.log('\n[E] persisted dark survives reload against OS light');
  await page.evaluate(() => {
    sessionStorage.setItem('skip-theme-seed', '1');
    updateSortSetting({ themeMode:'dark' });
    applyAppearanceSettings();
  });
  await page.reload({ waitUntil:'load' });
  await page.emulateMedia({ colorScheme:'light' });
  await sleep(300);
  const persisted = await themeSnapshot(page);
  assert(pinsDark(persisted) && isDarkTokens(persisted), 'saved dark theme reapplies after reload on OS light');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
