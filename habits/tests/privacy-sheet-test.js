// About privacy page + leaves-device marks.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/privacy-sheet-test.js
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

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[A] About opens privacy');
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  assert(await page.locator('#open-privacy').count() === 1, 'About has a privacy button');
  await page.locator('#open-privacy').click();
  await page.waitForSelector('#privacy-sheet.open');
  const privacy = await page.evaluate(() => {
    const root = document.getElementById('privacy-sheet');
    const text = (root?.textContent || '').replace(/\s+/g, ' ');
    const labels = [...root.querySelectorAll('.about-label')].map(el => el.textContent || '');
    return {
      aboutStillOpen: document.getElementById('about-sheet')?.classList.contains('open'),
      labels,
      local: /localStorage|this browser/i.test(text),
      owner: /cannot see/i.test(text),
      display: /shared display|household agenda|Cloudflare/i.test(text),
      encrypt: /encrypt/i.test(text),
      photon: /Photon/i.test(text),
      nominatim: /Nominatim/i.test(text),
      osrm: /OSRM/i.test(text),
      openSource: /open source/i.test(text),
      mapsCompare: /Google Maps|Apple Maps/i.test(text),
      legend: /this mark|stated job/i.test(text)
    };
  });
  assert(privacy.aboutStillOpen, 'Privacy stacks over About');
  assert(privacy.labels.includes('On this device') && privacy.labels.includes('Shared display'), 'Privacy has device + shared display sections');
  assert(privacy.local && privacy.owner, 'Privacy says the list stays in this browser and the owner cannot see it');
  assert(privacy.display && privacy.encrypt, 'Privacy explains encrypted Cloudflare shared display');
  assert(privacy.photon && privacy.nominatim && privacy.osrm, 'Privacy lists Photon, Nominatim, and OSRM');
  assert(privacy.openSource && privacy.mapsCompare, 'Privacy names open source and the narrower maps request');
  assert(privacy.legend, 'Privacy introduces the cloud-up mark');

  await page.locator('#privacy-close').click();
  await page.waitForFunction(() => !document.getElementById('privacy-sheet')?.classList.contains('open'));
  const privacyClosed = await page.evaluate(() => !document.getElementById('privacy-sheet')?.classList.contains('open'));
  assert(privacyClosed, 'Privacy done closes the privacy sheet');

  console.log('\n[B] Leaves-device marks');
  await page.locator('#about-close').click();
  const marks = await page.evaluate(() => {
    const by = key => document.querySelector(`[data-ui-leave="${key}"] .leave-btn`);
    const tipFor = el => {
      const id = el?.getAttribute('data-tip');
      return id ? document.getElementById(id) : null;
    };
    const agenda = by('agenda');
    const share = by('share');
    const geocode = document.querySelectorAll('[data-ui-leave="geocode"] .leave-btn').length;
    const travel = by('travel');
    const map = by('map');
    return {
      agenda: Boolean(agenda),
      share: Boolean(share),
      geocode,
      travel: Boolean(travel),
      map: Boolean(map),
      total: document.querySelectorAll('.leave-btn').length,
      agendaAria: agenda?.getAttribute('aria-label') || '',
      shareTip: (tipFor(share)?.textContent || ''),
      geocodeTip: (tipFor(document.querySelector('[data-ui-leave="geocode"] .leave-btn'))?.textContent || '')
    };
  });
  assert(marks.agenda && marks.share && marks.travel && marks.map, 'Agenda, share, travel, and map carry leave marks');
  assert(marks.geocode >= 2, 'Address/city search carries leave marks');
  assert(marks.total >= 5, 'Several leave marks are mounted');
  assert(/encrypted|off this device/i.test(marks.agendaAria), 'Agenda leave mark is labeled as leaving the device');
  assert(/Cloudflare/i.test(marks.shareTip), 'Share tooltip names the Cloudflare relay');
  assert(/Photon|Nominatim/i.test(marks.geocodeTip), 'Geocode tooltip names the map services');

  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  await page.locator('#open-privacy-from-settings').click();
  await page.waitForSelector('#privacy-sheet.open');
  const fromSettings = await page.evaluate(() => ({
    settingsOpen: document.getElementById('settings-sheet')?.classList.contains('open'),
    privacyOpen: document.getElementById('privacy-sheet')?.classList.contains('open')
  }));
  assert(fromSettings.settingsOpen && fromSettings.privacyOpen, 'Settings backup privacy link stacks privacy over settings');
  await page.locator('#privacy-close').click();
  await page.waitForFunction(() => !document.getElementById('privacy-sheet')?.classList.contains('open'));

  await page.locator('[data-ui-leave="agenda"] .leave-btn').click();
  const tipShown = await page.evaluate(() => {
    const btn = document.querySelector('[data-ui-leave="agenda"] .leave-btn');
    const tip = btn && document.getElementById(btn.dataset.tip);
    return Boolean(tip && !tip.hidden && /encrypt/i.test(tip.textContent || '') && /Cloudflare/i.test(tip.textContent || ''));
  });
  assert(tipShown, 'Tapping the agenda leave mark shows the encrypted-relay note');

  if(pageErrors.length){
    fail += 1;
    console.error('  not ok: page errors ' + pageErrors.join(' | '));
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
