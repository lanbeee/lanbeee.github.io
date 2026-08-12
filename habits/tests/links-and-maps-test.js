// Habit links (calls + meeting links), card double-tap launch, and
// exact-pin maps directions.
//
//   PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright \
//   HABITS_URL=http://127.0.0.1:4181/ node tests/links-and-maps-test.js
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
      // Legacy call fields — must migrate into links.
      { name:'call mum', type:'keepup', target:7, logs:[], callNumber:'+15551234567', callApp:'ask' },
      { name:'standup', type:'keepup', target:1, logs:[], links:[{ kind:'link', value:'https://zoom.us/j/98765' }] },
      { name:'read', type:'keepup', target:7, logs:[] },
      { name:'stretch', type:'keepup', target:7, logs:[] }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], travel:{},
      // walking resolves from haversine, so travel cards need no routing call
      defaultTravelMode:'walking',
      locations:[
        { id:'home', name:'Home', address:'Grand Court Apartments, Springfield', lat:40.712776, lng:-74.005974, radiusM:150 },
        { id:'office', name:'Office', address:'5 Market St', lat:40.706192, lng:-74.008770, radiusM:150 }
      ]
    }));
    // Record launches instead of navigating away.
    window.__opened = [];
    window.open = (url) => { window.__opened.push(String(url)); return null; };
  });

  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.waitForFunction(() => typeof openDetail === 'function');

  // ── value normalization ────────────────────────────────────────────────
  const values = await page.evaluate(() => ({
    spaced:normalizePhoneValue('+1 (555) 123-4567'),
    tooShort:normalizePhoneValue('12'),
    bareHost:normalizeUrlValue('meet.google.com/abc-defg-hij'),
    keepsScheme:normalizeUrlValue('https://teams.microsoft.com/l/meetup-join/x'),
    appScheme:normalizeUrlValue('zoommtg://zoom.us/join?confno=1'),
    script:normalizeUrlValue('javascript:alert(1)'),
    blank:normalizeUrlValue('   ')
  }));
  assert(values.spaced === '+15551234567', 'phone punctuation is stripped but the + is kept');
  assert(values.tooShort === '', 'too-short numbers are rejected');
  assert(values.bareHost === 'https://meet.google.com/abc-defg-hij', 'a bare host gets https');
  assert(values.keepsScheme.startsWith('https://teams.microsoft.com/'), 'full URLs pass through');
  assert(values.appScheme.startsWith('zoommtg://'), 'app schemes pass through');
  assert(values.script === '' && values.blank === '', 'script-ish and empty links are dropped');

  // ── labels, icons, launch URLs ─────────────────────────────────────────
  const meta = await page.evaluate(() => {
    const l = (kind,value) => ({ label:linkLabel({kind,value}), icon:linkIconClass({kind,value}), url:linkLaunchUrl({kind,value}) });
    return {
      phone:l('phone','+1 555 123 4567'),
      whatsapp:l('whatsapp','+15551234567'),
      facetime:l('facetime','+15551234567'),
      zoom:l('link','https://zoom.us/j/98765'),
      teams:l('link','https://teams.microsoft.com/l/meetup-join/x'),
      meet:l('link','https://meet.google.com/abc'),
      webex:l('link','https://acme.webex.com/meet/x'),
      other:l('link','https://notes.example.com/agenda')
    };
  });
  assert(meta.phone.url === 'tel:+15551234567' && meta.phone.label === 'call', 'phone dials via tel:');
  assert(meta.whatsapp.url === 'https://wa.me/15551234567', 'whatsapp opens the wa.me chat');
  assert(meta.facetime.url === 'facetime://+15551234567', 'facetime uses its own scheme');
  assert(meta.zoom.label === 'zoom' && meta.teams.label === 'teams' && meta.meet.label === 'meet' && meta.webex.label === 'webex',
    'meeting services are named from their host');
  assert(meta.other.label === 'notes.example.com', 'an unknown link is named after its host');
  assert(meta.zoom.icon === 'ti-video' && meta.other.icon === 'ti-link',
    'meeting links get the video icon, other links the link icon');

  // ── legacy call fields migrate ─────────────────────────────────────────
  const migrated = await page.evaluate(() => load().find(h => h.name === 'call mum').links);
  assert(migrated.length === 2 && migrated[0].kind === 'phone' && migrated[1].kind === 'whatsapp'
    && migrated[0].value === '+15551234567', 'the old callNumber/callApp="ask" pair became two links');

  // ── detail editor ──────────────────────────────────────────────────────
  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'read')));
  await page.waitForSelector('#detail-sheet.open');
  const emptyState = await page.evaluate(() => ({
    field:!$('detail-link-field').hidden,
    rows:document.querySelectorAll('#detail-link-list .link-row').length,
    actions:!$('detail-link-actions').hidden
  }));
  assert(emptyState.field && emptyState.rows === 0 && !emptyState.actions,
    'every habit gets the links block, empty and with no header buttons');

  await page.locator('#detail-link-add').click();
  await page.locator('#detail-link-list .link-row .link-value').fill('+1 555 987 6543');
  await page.locator('#detail-link-list .link-row .link-value').dispatchEvent('input');
  const oneLink = await page.evaluate(() => ({
    actions:!$('detail-link-actions').hidden,
    buttons:document.querySelectorAll('#detail-link-actions [data-link-open]').length,
    dirty:document.querySelector('#detail-sheet .sheet').classList.contains('tune-dirty'),
    hint:$('detail-link-hint').textContent
  }));
  assert(oneLink.actions && oneLink.buttons === 1, 'a usable link puts one launch button in the header');
  assert(oneLink.dirty, 'editing a link marks the sheet dirty');
  assert(oneLink.hint.includes('call'), 'the hint names what a double tap will open');

  await page.locator('#detail-link-add').click();
  await page.locator('#detail-link-list .link-row:nth-child(2) .link-value').fill('meet.google.com/abc-defg-hij');
  await page.locator('#detail-link-list .link-row:nth-child(2) .link-value').dispatchEvent('input');
  await page.locator('#detail-link-list .link-row:nth-child(2) [data-link-promote]').click();
  const promoted = await page.evaluate(() => currentDetailLinks());
  assert(promoted.length === 2 && promoted[0].kind === 'link' && promoted[0].value.includes('meet.google.com'),
    'promote moves a link to the front so it becomes primary');

  // The header button launches what is in the form, before any save.
  await page.evaluate(() => { window.__opened = []; });
  await page.locator('#detail-link-actions [data-link-open="0"]').click();
  const headerOpen = await page.evaluate(() => window.__opened);
  assert(headerOpen.length === 1 && headerOpen[0] === 'https://meet.google.com/abc-defg-hij',
    'the header button opens the link without needing a save first');

  await page.locator('#detail-save').click();
  const savedLinks = await page.evaluate(() => load().find(h => h.name === 'read').links);
  assert(savedLinks.length === 2 && savedLinks[0].value === 'https://meet.google.com/abc-defg-hij'
    && savedLinks[1].value === '+15559876543', 'links persist in order, normalized');

  await page.evaluate(() => closeSheet('detail-sheet'));
  await page.waitForTimeout(350);

  // ── double tap a card: log + launch ────────────────────────────────────
  const dbl = await page.evaluate(async () => {
    window.__opened = [];
    const idx = load().findIndex(h => h.name === 'standup');
    const before = load()[idx].logs.length;
    const card = document.querySelector(`.ting-card[data-real="${idx}"]`);
    if(!card)return { missing:true };
    // Real double taps land 100–250ms apart; the card ignores clicks under 80ms.
    card.click();
    await new Promise(r => setTimeout(r, 140));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    return { before, after:load()[idx].logs.length, opened:window.__opened.slice(), sheet:document.querySelector('#detail-sheet')?.classList.contains('open') };
  });
  assert(!dbl.missing, 'the standup card is on the home list');
  assert(dbl.after === dbl.before + 1, 'double tapping a card logs it');
  assert(dbl.opened.length === 1 && dbl.opened[0] === 'https://zoom.us/j/98765',
    'double tapping a card also opens its primary link');
  assert(!dbl.sheet, 'double tap does not fall through to the detail sheet');

  // A card with no links still just logs, and opens nothing.
  const noLink = await page.evaluate(async () => {
    window.__opened = [];
    const idx = load().findIndex(h => h.name === 'stretch');
    const card = document.querySelector(`.ting-card[data-real="${idx}"]`);
    if(!card)return { missing:true };
    const before = load()[idx].logs.length;
    card.click();
    await new Promise(r => setTimeout(r, 140));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    return { before, after:load()[idx].logs.length, opened:window.__opened.slice() };
  });
  assert(!noLink.missing, 'the stretch card is on the home list');
  assert(noLink.after === noLink.before + 1 && noLink.opened.length === 0,
    'double tapping a card with no links just logs it');

  // tel: hands off to the OS rather than opening a tab, so it can't be driven
  // through window.open here — assert the routing instead.
  const dialRouting = await page.evaluate(() => {
    const primary = habitPrimaryLink(load().find(h => h.name === 'call mum'));
    const url = linkLaunchUrl(primary);
    return { url, handsOff:linkHandsOffToOs(url), webHandsOff:linkHandsOffToOs('https://zoom.us/j/1') };
  });
  assert(dialRouting.url === 'tel:+15551234567' && dialRouting.handsOff && !dialRouting.webHandsOff,
    'a migrated call habit dials via tel:, which replaces the location instead of opening a tab');

  // ── travel card: tap edits the leg, double tap just goes ───────────────
  const travelPlaces = await page.evaluate(() => ({
    home:Boolean(locationById('home')), office:Boolean(locationById('office'))
  }));
  assert(travelPlaces.home && travelPlaces.office, 'the seeded places are in the registry');

  const travelSingle = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    appendHomeTravelCard(host,'home','office',Date.now() + 3600000);
    const card = host.querySelector('.travel-card');
    if(!card){ host.remove(); return { missing:true }; }
    card.click();
    await new Promise(r => setTimeout(r, 500));
    const open = Boolean(document.querySelector('#travel-edit-sheet.open'));
    host.remove();
    closeSheet('travel-edit-sheet');
    return { open };
  });
  assert(!travelSingle.missing, 'a travel card renders for the seeded leg');
  assert(travelSingle.open, 'a single tap still opens the travel time editor');
  await page.waitForTimeout(350);

  const travelDouble = await page.evaluate(async () => {
    window.__opened = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    appendHomeTravelCard(host,'home','office',Date.now() + 3600000);
    const card = host.querySelector('.travel-card');
    if(!card){ host.remove(); return { missing:true }; }
    card.click();
    await new Promise(r => setTimeout(r, 140));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    const res = { opened:window.__opened.slice(), sheet:Boolean(document.querySelector('#travel-edit-sheet.open')) };
    host.remove();
    return res;
  });
  assert(!travelDouble.missing && travelDouble.opened.length === 1
    && travelDouble.opened[0].includes('destination=40.706192%2C-74.008770'),
    'double tapping a travel card opens directions to the destination pin');
  assert(!travelDouble.sheet, 'double tapping a travel card skips the editor sheet');

  // ── travel card from current (non-saved) location: tap opens directions ──
  // A live-GPS leg has no editor (an override would go stale next tick), but
  // the destination is a real saved place, so a tap should open maps rather
  // than do nothing.
  const travelFromCurrent = await page.evaluate(async () => {
    window.__opened = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fromId = (typeof CURRENT_COORD_ID !== 'undefined') ? CURRENT_COORD_ID : '__current__';
    appendHomeTravelCard(host, fromId, 'office', Date.now() + 3600000);
    const card = host.querySelector('.travel-card.is-from-current');
    if(!card){ host.remove(); return { missing:true }; }
    card.click();
    await new Promise(r => setTimeout(r, 500));
    const res = {
      opened:window.__opened.slice(),
      sheet:Boolean(document.querySelector('#travel-edit-sheet.open')),
      disabled:card.getAttribute('aria-disabled')
    };
    host.remove();
    closeSheet('travel-edit-sheet');
    return res;
  });
  assert(!travelFromCurrent.missing, 'a from-current travel card renders');
  assert(!travelFromCurrent.disabled, 'a from-current travel card is not aria-disabled');
  assert(travelFromCurrent.opened.length === 1
    && travelFromCurrent.opened[0].includes('destination=40.706192%2C-74.008770'),
    'tapping a from-current travel card opens directions to the destination pin');
  assert(!travelFromCurrent.sheet, 'a from-current travel card does not open the editor sheet');
  await page.waitForTimeout(350);

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
