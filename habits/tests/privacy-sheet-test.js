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
  const feedback = await page.evaluate(() => {
    const link = document.getElementById('open-feedback');
    const row = document.getElementById('about-feedback-row');
    const leave = document.querySelector('[data-ui-leave="feedback"] .leave-btn');
    const configured = typeof feedbackFormConfigured === 'function' && feedbackFormConfigured();
    return {
      exists: Boolean(link && row),
      target: link?.getAttribute('target') || '',
      rel: link?.getAttribute('rel') || '',
      configured,
      rowHidden: Boolean(row?.hidden),
      href: link?.getAttribute('href') || '',
      leave: Boolean(leave),
      leaveAria: leave?.getAttribute('aria-label') || ''
    };
  });
  assert(feedback.exists, 'About has a send-feedback control');
  assert(feedback.target === '_blank' && /noopener/.test(feedback.rel), 'Feedback opens in a real browser tab');
  assert(feedback.leave && /Google Form/i.test(feedback.leaveAria), 'Feedback carries a leave-device mark naming Google Form');
  assert(feedback.rowHidden === !feedback.configured, 'Feedback row is visible only when a form URL is configured');
  if(feedback.configured){
    assert(feedback.href === 'https://forms.gle/KNnXKCH55VfzCNeo8', 'Configured feedback URL is the published Google Form');
    await page.locator('[data-ui-leave="feedback"] .leave-btn').click();
    const tipFit = await page.evaluate(() => {
      const tip = document.querySelector('[data-ui-leave="feedback"] .leave-tooltip');
      const sheet = document.querySelector('#about-sheet .about-sheet');
      if(!tip || !sheet || tip.hidden)return {open:false};
      const t = tip.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      return {
        open:true,
        text:(tip.textContent || ''),
        clippedRight: t.right - s.right,
        clippedLeft: s.left - t.left,
        clippedBottom: t.bottom - s.bottom
      };
    });
    assert(tipFit.open && /Google Form/i.test(tipFit.text), 'Feedback cloud-up note opens');
    assert(tipFit.clippedRight <= 1 && tipFit.clippedLeft <= 1 && tipFit.clippedBottom <= 1, 'Feedback cloud-up note stays inside About');
    await page.locator('[data-ui-leave="feedback"] .leave-btn').click();
  }
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
      display: /shared display|Cloudflare/i.test(text),
      encrypt: /encrypt/i.test(text),
      photon: /Photon/i.test(text),
      nominatim: /Nominatim/i.test(text),
      osrm: /OSRM/i.test(text),
      openSource: /open source/i.test(text),
      mapsCompare: /Google Maps|Apple Maps/i.test(text),
      legend: /this mark|stated job/i.test(text),
      feedback: labels.includes('Send feedback'),
      googleForm: /Google Form/i.test(text)
    };
  });
  assert(privacy.aboutStillOpen, 'Privacy stacks over About');
  assert(privacy.labels.includes('On this device') && privacy.labels.includes('Shared display'), 'Privacy has device + shared display sections');
  assert(privacy.local && privacy.owner, 'Privacy says the list stays in this browser and the owner cannot see it');
  assert(privacy.display && privacy.encrypt, 'Privacy explains encrypted Cloudflare shared display');
  assert(privacy.photon && privacy.nominatim && privacy.osrm, 'Privacy lists Photon, Nominatim, and OSRM');
  assert(privacy.openSource && privacy.mapsCompare, 'Privacy names open source and the narrower maps request');
  assert(privacy.legend, 'Privacy introduces the cloud-up mark');
  assert(privacy.feedback && privacy.googleForm, 'Privacy explains that send feedback is a Google Form');

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

  // The shared display section (and its leave mark) is full-mode-only now, so
  // leave minimal before tapping the agenda mark.
  await page.locator('[data-setting-toggle="minimalMode"]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-ui-leave="agenda"] .leave-btn')?.offsetParent !== null, null, { timeout: 3000 });
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
