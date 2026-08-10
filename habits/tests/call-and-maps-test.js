// Call habits (detail header dial buttons) + exact-pin maps directions.
//
//   PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright \
//   HABITS_URL=http://127.0.0.1:4181/ node tests/call-and-maps-test.js
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
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'call mum', type:'keepup', target:7, logs:[] },
      { name:'recall the book order', type:'keepup', target:7, logs:[] }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving'
    }));
  });

  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.waitForFunction(() => typeof openDetail === 'function');

  // ── name matching ──────────────────────────────────────────────────────
  const words = await page.evaluate(() => ({
    call:nameMentionsCall('call mum'),
    calls:nameMentionsCall('Weekly calls with dad'),
    callBack:nameMentionsCall('call back the clinic'),
    recall:nameMentionsCall('recall the book order'),
    calligraphy:nameMentionsCall('calligraphy practice')
  }));
  assert(words.call && words.calls && words.callBack, '"call" and its inflections are detected');
  assert(!words.recall && !words.calligraphy, '"recall" and "calligraphy" are not mistaken for calls');

  // ── number normalization ───────────────────────────────────────────────
  const numbers = await page.evaluate(() => ({
    spaced:normalizeCallNumber('+1 (555) 123-4567'),
    plain:normalizeCallNumber('5551234567'),
    tooShort:normalizeCallNumber('12'),
    blank:normalizeCallNumber(''),
    tel:callUrlFor('+1 (555) 123-4567','phone'),
    wa:callUrlFor('+1 (555) 123-4567','whatsapp')
  }));
  assert(numbers.spaced === '+15551234567', 'punctuation is stripped but the + is kept');
  assert(numbers.plain === '5551234567' && numbers.tooShort === null && numbers.blank === null,
    'short or empty numbers are rejected');
  assert(numbers.tel === 'tel:+15551234567', 'phone target is a tel: link');
  assert(numbers.wa === 'https://wa.me/15551234567', 'whatsapp target is a wa.me chat link');

  // ── detail UI for a call habit ─────────────────────────────────────────
  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'call mum')));
  await page.waitForSelector('#detail-sheet.open');
  const initial = await page.evaluate(() => ({
    field:!$('detail-call-field').hidden,
    actions:!$('detail-call-actions').hidden
  }));
  assert(initial.field, 'call settings show for a habit named "call mum"');
  assert(!initial.actions, 'header dial buttons stay hidden until a number is set');

  await page.locator('#detail-call-number').fill('+1 555 123 4567');
  await page.locator('#detail-call-number').dispatchEvent('input');
  const withNumber = await page.evaluate(() => ({
    actions:!$('detail-call-actions').hidden,
    phone:!$('detail-call-phone').hidden,
    whatsapp:!$('detail-call-whatsapp').hidden,
    dirty:document.querySelector('#detail-sheet .sheet').classList.contains('tune-dirty')
  }));
  assert(withNumber.actions && withNumber.phone && !withNumber.whatsapp,
    'phone mode shows only the dial button in the header');
  assert(withNumber.dirty, 'editing the number marks the detail sheet dirty');

  await page.locator('#detail-call-app-seg .seg-opt[data-call-app="ask"]').click();
  const bothMode = await page.evaluate(() => ({
    phone:!$('detail-call-phone').hidden,
    whatsapp:!$('detail-call-whatsapp').hidden
  }));
  assert(bothMode.phone && bothMode.whatsapp, '"both" mode shows dial and whatsapp buttons');

  await page.locator('#detail-save').click();
  const saved = await page.evaluate(() => {
    const h = load().find(x => x.name === 'call mum');
    return { number:h.callNumber, app:h.callApp };
  });
  assert(saved.number === '+15551234567' && saved.app === 'ask', 'call number and app persist normalized');

  // A non-call habit keeps the block out of the way.
  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'recall the book order')));
  const nonCall = await page.evaluate(() => ({
    field:!$('detail-call-field').hidden,
    actions:!$('detail-call-actions').hidden
  }));
  assert(!nonCall.field && !nonCall.actions, 'habits that never mention calling show no call UI');

  // ── maps directions ────────────────────────────────────────────────────
  const maps = await page.evaluate(() => {
    const pinned = { id:'home', name:'Home', address:'Grand Court Apartments, Springfield', lat:40.712776, lng:-74.005974 };
    const addressOnly = { id:'clinic', name:'Clinic', address:'12 High St', lat:null, lng:null };
    return {
      driving:mapsDirectionsUrl(pinned,'driving'),
      walking:mapsDirectionsUrl(pinned,'walking'),
      addressOnly:mapsDirectionsUrl(addressOnly,'driving'),
      empty:mapsDirectionsUrl(null,'driving'),
      label:mapsAppLabel()
    };
  });
  assert(maps.driving.includes('google.com/maps/dir/?api=1'),
    'non-iOS devices get a Google Maps directions link (an Android app link)');
  assert(maps.driving.includes('destination=40.712776%2C-74.005974'),
    'directions aim at the saved pin coordinates, not the apartment complex address');
  assert(!maps.driving.includes('Grand%20Court') && !maps.driving.includes('Grand+Court'),
    'the address is not used while a pin exists');
  assert(maps.walking.includes('travelmode=walking'), 'travel mode carries into the directions link');
  assert(maps.addressOnly.includes('destination=12%20High%20St') || maps.addressOnly.includes('destination=12+High+St'),
    'places without a pin fall back to their address');
  assert(maps.empty === '', 'a missing place produces no link');
  assert(maps.label === 'Google Maps', 'the button names the app this device will open');

  assert(pageErrors.length === 0, 'no page errors: ' + pageErrors.join(' | '));

  await browser.close();
  console.log(`# ${pass} ok, ${fail} not ok`);
  process.exit(fail ? 1 : 0);
})();
