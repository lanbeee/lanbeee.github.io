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
      { name:'stretch', type:'keepup', target:7, logs:[] },
      { name:'spanish', type:'keepup', target:7, logs:[] },
      { name:'check inbox', type:'task', logs:[], dueDate:null }
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
    app:normalizeLinks([{kind:'app',label:'  Proton   Mail  ',value:'mail.proton.me'}])[0],
    script:normalizeUrlValue('javascript:alert(1)'),
    blank:normalizeUrlValue('   ')
  }));
  assert(values.spaced === '+15551234567', 'phone punctuation is stripped but the + is kept');
  assert(values.tooShort === '', 'too-short numbers are rejected');
  assert(values.bareHost === 'https://meet.google.com/abc-defg-hij', 'a bare host gets https');
  assert(values.keepsScheme.startsWith('https://teams.microsoft.com/'), 'full URLs pass through');
  assert(values.appScheme.startsWith('zoommtg://'), 'app schemes pass through');
  assert(values.app.kind === 'app' && values.app.label === 'Proton Mail'
    && values.app.value === 'https://mail.proton.me/', 'custom app names and safe links are normalized');
  assert(values.script === '' && values.blank === '', 'script-ish and empty links are dropped');

  // ── optional direct-open targets on app shortcuts ──────────────────────
  const direct = await page.evaluate(() => ({
    kept:normalizeLinks([{kind:'app',label:'Roku',value:'https://apps.apple.com/app/id1626186138',launch:' roku:// '}])[0],
    unsafe:normalizeLinks([{kind:'app',label:'X',value:'https://x.com/home',launch:'javascript:alert(1)'}])[0],
    sameAsValue:normalizeLinks([{kind:'app',label:'Y',value:'https://notes.example.com/',launch:'notes.example.com'}])[0],
    notApp:normalizeLinks([{kind:'link',value:'https://zoom.us/j/1',launch:'zoommtg://join'}])[0],
    scheme:linkDirectLaunchUrl({kind:'app',value:'https://apps.apple.com/app/id1626186138',launch:'roku://'}),
    web:linkDirectLaunchUrl({kind:'app',value:'https://apps.apple.com/app/id324684580',launch:'https://open.spotify.com/'}),
    none:linkDirectLaunchUrl({kind:'app',value:'https://apps.apple.com/app/id1'}),
    dropped:linkDirectLaunchUrl({kind:'app',value:'https://a.example.com/',launch:'https://a.example.com/'})
  }));
  assert(direct.kept.launch === 'roku://' && direct.kept.value === 'https://apps.apple.com/app/id1626186138',
    'an app shortcut keeps its scheme alongside the store page');
  assert(direct.unsafe.launch === undefined && direct.sameAsValue.launch === undefined,
    'unsafe or redundant direct links are dropped while the value survives');
  assert(direct.notApp.launch === undefined, 'only app shortcuts carry a direct link');
  assert(direct.scheme === 'roku://' && direct.web === 'https://open.spotify.com/'
    && direct.none === '' && direct.dropped === '',
    'the direct target is the scheme or universal link, never the stored page');

  // ── App Store / Play Store share links ─────────────────────────────────
  const store = await page.evaluate(() => ({
    short:normalizeUrlValue('https://apps.apple.com/app/id1626186138'),
    itms:normalizeUrlValue('itms-apps://itunes.apple.com/app/id1626186138'),
    idShort:appStoreIdFromUrl('https://apps.apple.com/app/id1626186138'),
    idSlug:appStoreIdFromUrl('https://apps.apple.com/us/app/roku-smart-home/id1626186138'),
    idItms:appStoreIdFromUrl('itms-apps://apps.apple.com/app/id1626186138'),
    idOther:appStoreIdFromUrl('https://zoom.us/j/98765'),
    slug:appStoreSlugName('https://apps.apple.com/us/app/roku-smart-home/id1626186138'),
    slugShort:appStoreSlugName('https://apps.apple.com/app/id1626186138'),
    labelApp:linkLabel({ kind:'app', value:'https://apps.apple.com/app/id1626186138' }),
    iconApp:linkIconClass({ kind:'app', value:'https://apps.apple.com/app/id1626186138' }),
    labelPlay:linkLabel({ kind:'app', value:'https://play.google.com/store/apps/details?id=com.example.app' }),
    iconPlay:linkIconClass({ kind:'app', value:'https://play.google.com/store/apps/details?id=com.example.app' })
  }));
  assert(store.short === 'https://apps.apple.com/app/id1626186138',
    'an App Store share link passes through unchanged');
  assert(store.itms === 'https://apps.apple.com/app/id1626186138',
    'itms-apps: share links are rewritten to the https form that opens everywhere');
  assert(store.idShort === '1626186138' && store.idSlug === '1626186138'
    && store.idItms === '1626186138' && store.idOther === '',
    'the store id is pulled out of every share-link shape (short, slug, itms-apps)');
  assert(store.slug === 'Roku Smart Home' && store.slugShort === '',
    'a slug URL yields an offline fallback name; short share links carry none');
  assert(store.labelApp === 'app store' && store.iconApp === 'ti-brand-appstore'
    && store.labelPlay === 'play store' && store.iconPlay === 'ti-brand-google-play',
    'store links get their own label and icon');

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
      gmail:l('app','https://mail.google.com/mail/u/0/'),
      custom:l('app','https://mail.proton.me/'),
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
  assert(meta.gmail.label === 'gmail' && meta.gmail.icon === 'ti-brand-gmail'
    && meta.custom.icon === 'ti-apps', 'app links get recognizable labels and icons');

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

  // ── common + custom app shortcuts ─────────────────────────────────────
  await page.waitForSelector('#detail-sheet:not(.open)');
  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'read')));
  await page.waitForSelector('#detail-sheet.open');
  await page.locator('#detail-app-add').click();
  const presetState = await page.evaluate(() => ({
    count:document.querySelectorAll('#detail-app-presets [data-app-preset]').length,
    custom:Boolean(document.querySelector('#detail-app-presets [data-app-custom]')),
    contained:document.documentElement.scrollWidth <= document.documentElement.clientWidth
  }));
  assert(presetState.count >= 8 && presetState.custom, 'the app chooser offers major apps plus custom');
  assert(presetState.contained, 'the app chooser stays inside the mobile viewport');
  await page.locator('#detail-app-presets [data-app-preset="facebook"]').click();
  let appRows = await page.evaluate(() => currentDetailLinkRows());
  assert(appRows.length === 3 && appRows[2].kind === 'app'
    && appRows[2].label === 'Facebook', 'a common app adds a ready-to-use shortcut');

  await page.locator('#detail-app-add').click();
  await page.locator('#detail-app-presets [data-app-custom]').click();
  await page.locator('#detail-custom-app-name').fill('Proton Mail');
  await page.locator('#detail-custom-app-url').fill('mail.proton.me');

  await page.setViewportSize({width:320,height:568});
  const customMobile = await page.evaluate(() => {
    const editor = $('detail-custom-app-editor');
    const rect = editor.getBoundingClientRect();
    return {
      visible:!editor.hidden,
      inside:rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
      docFits:document.documentElement.scrollWidth <= document.documentElement.clientWidth
    };
  });
  assert(customMobile.visible && customMobile.inside && customMobile.docFits,
    'the custom app editor fits a 320px mobile viewport');
  await page.locator('#detail-custom-app-confirm').click();
  appRows = await page.evaluate(() => currentDetailLinks());
  assert(appRows.length === 4 && appRows[3].kind === 'app'
    && appRows[3].label === 'Proton Mail'
    && appRows[3].value === 'https://mail.proton.me/', 'a named custom app is saveable');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#detail-save').click();
  const savedApps = await page.evaluate(() => load().find(h => h.name === 'read').links.slice(2));
  assert(savedApps.length === 2 && savedApps[0].label === 'Facebook'
    && savedApps[1].label === 'Proton Mail', 'common and custom app shortcuts persist');

  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'check inbox')));
  await page.waitForSelector('#detail-sheet.open');
  await page.locator('#detail-app-add').click();
  await page.locator('#detail-app-presets [data-app-preset="gmail"]').click();
  const taskApp = await page.evaluate(() => currentDetailLinks()[0]);
  assert(taskApp.kind === 'app' && taskApp.label === 'Gmail', 'task details support the same app shortcuts as habits');
  await page.locator('#detail-save').click();
  const savedTaskApp = await page.evaluate(() => load().find(h => h.name === 'check inbox').links[0]);
  assert(savedTaskApp.kind === 'app' && savedTaskApp.label === 'Gmail', 'task app shortcuts persist');

  await page.waitForTimeout(350);

  // ── a pasted App Store share link names the custom app ────────────────
  // The listing lookup is stubbed so the test never depends on Apple.
  await page.evaluate(() => openDetail(load().findIndex(h => h.name === 'spanish')));
  await page.waitForSelector('#detail-sheet.open');
  await page.locator('#detail-app-add').click();
  await page.locator('#detail-app-presets [data-app-custom]').click();
  const editorFocus = await page.evaluate(() => document.activeElement?.id);
  assert(editorFocus === 'detail-custom-app-url',
    'the custom editor starts on the link field, ready for a paste');

  await page.evaluate(() => {
    window.__realFetch = window.fetch;
    window.fetch = (url, opts) => String(url).includes('itunes.apple.com/lookup')
      ? Promise.resolve({ ok:true, json:async () => ({ resultCount:1, results:[{ trackName:'Roku Smart Home' }] }) })
      : window.__realFetch(url, opts);
  });
  await page.locator('#detail-custom-app-url').fill('https://apps.apple.com/app/id1626186138');
  await page.waitForFunction(() => document.querySelector('#detail-custom-app-name')?.value === 'Roku Smart Home');
  const autoNamed = await page.evaluate(() => ({
    name:$('detail-custom-app-name').value,
    auto:$('detail-custom-app-name').dataset.autoName === '1'
  }));
  assert(autoNamed.name === 'Roku Smart Home' && autoNamed.auto,
    'pasting a share link with no typed name fills the app name from the listing');

  // A name typed by hand outranks the paste.
  await page.locator('#detail-custom-app-name').fill('My Roku');
  await page.locator('#detail-custom-app-url').fill('https://apps.apple.com/us/app/roku-smart-home/id1626186138');
  await page.waitForTimeout(80);
  assert(await page.evaluate(() => $('detail-custom-app-name').value) === 'My Roku',
    'a hand-typed name is never overwritten');

  // Offline: the lookup fails, but the slug inside the link still names it.
  await page.locator('#detail-custom-app-cancel').click();
  await page.locator('#detail-app-add').click();
  await page.locator('#detail-app-presets [data-app-custom]').click();
  await page.evaluate(() => {
    window.fetch = (url, opts) => String(url).includes('itunes.apple.com/lookup')
      ? Promise.reject(new Error('offline'))
      : window.__realFetch(url, opts);
  });
  await page.locator('#detail-custom-app-url').fill('https://apps.apple.com/us/app/language-tutor/id555000111');
  await page.waitForTimeout(80);
  assert(await page.evaluate(() => $('detail-custom-app-name').value) === 'Language Tutor',
    'offline, a slug URL still fills its fallback name instantly');
  await page.locator('#detail-custom-app-confirm').click();
  await page.waitForTimeout(120);
  const offlineAdded = await page.evaluate(() => {
    window.fetch = window.__realFetch;
    return currentDetailLinks();
  });
  assert(offlineAdded.length === 1 && offlineAdded[0].kind === 'app'
    && offlineAdded[0].label === 'Language Tutor'
    && offlineAdded[0].value === 'https://apps.apple.com/us/app/language-tutor/id555000111',
    'a slug link can be added with zero typing, even offline');

  // Offline + short share link + empty name → clear error, nothing added.
  await page.locator('#detail-app-add').click();
  await page.locator('#detail-app-presets [data-app-custom]').click();
  await page.evaluate(() => {
    window.fetch = (url, opts) => String(url).includes('itunes.apple.com/lookup')
      ? Promise.reject(new Error('offline'))
      : window.__realFetch(url, opts);
  });
  await page.locator('#detail-custom-app-url').fill('https://apps.apple.com/app/id555000112');
  await page.locator('#detail-custom-app-confirm').click();
  await page.waitForTimeout(120);
  const blocked = await page.evaluate(() => ({
    toast:$('toast').textContent,
    links:currentDetailLinks().length
  }));
  assert(blocked.toast === 'name the custom app' && blocked.links === 1,
    'a short link with no name and no lookup asks for a name instead of adding junk');
  await page.evaluate(() => { window.fetch = window.__realFetch; });

  // The optional direct-open link rides along, and the row editor exposes it.
  // (The blocked confirm above left the custom editor open.)
  await page.locator('#detail-custom-app-name').fill('Spotify');
  await page.locator('#detail-custom-app-url').fill('https://apps.apple.com/app/id324684580');
  await page.locator('#detail-custom-app-launch').fill('spotify://');
  await page.locator('#detail-custom-app-confirm').click();
  await page.waitForTimeout(120);
  const directRow = await page.evaluate(() => ({
    link:currentDetailLinks()[1],
    launchInput:document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-app-launch')?.value || '',
    launchHidden:document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-app-launch')?.hidden
  }));
  assert(directRow.link?.kind === 'app' && directRow.link?.launch === 'spotify://'
    && directRow.link?.value === 'https://apps.apple.com/app/id324684580'
    && directRow.launchInput === 'spotify://' && !directRow.launchHidden,
    'a custom app can carry the app scheme, editable on its row');

  // Switching a row away from app hides the direct field and drops the target.
  const kindAway = await page.evaluate(() => {
    const select = document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-kind');
    select.value = 'link';
    select.dispatchEvent(new Event('change',{ bubbles:true }));
    return {
      hidden:document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-app-launch')?.hidden,
      kept:currentDetailLinks()[1]?.launch
    };
  });
  assert(kindAway.hidden && kindAway.kept === undefined,
    'a plain link row hides the direct field and loses its target');
  const kindBack = await page.evaluate(() => {
    const select = document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-kind');
    select.value = 'app';
    select.dispatchEvent(new Event('change',{ bubbles:true }));
    return document.querySelector('#detail-link-list .link-row[data-link-index="1"] .link-app-launch')?.hidden;
  });
  assert(kindBack === false, 'switching back to app shows the direct field again');

  await page.locator('#detail-save').click();
  const savedStore = await page.evaluate(() => load().find(h => h.name === 'spanish').links);
  assert(savedStore.length === 2 && savedStore[0].label === 'Language Tutor'
    && savedStore[1].label === 'Spotify' && savedStore[1].launch === 'spotify://',
    'store-link apps with and without a direct target persist');

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

  // ── direct-open: the app's scheme first, store page as fallback ────────
  // launchFallbackUrl is stubbed so the test never leaves the app page.
  const launchOrder = await page.evaluate(async () => {
    window.__opened = [];
    window.__fallback = '';
    window.launchFallbackUrl = (url) => { window.__fallback = String(url); };
    openHabitLink({ kind:'app', label:'Roku Smart Home', value:'https://apps.apple.com/app/id1626186138', launch:'roku://' });
    const immediate = window.__opened.slice();
    // The scheme handoff never hides a headless page, so the fallback fires.
    const deadline = Date.now() + 5000;
    while(Date.now() < deadline && !window.__fallback)await new Promise(r => setTimeout(r,100));
    window.__opened = [];
    openHabitLink({ kind:'app', label:'Roku Smart Home', value:'https://apps.apple.com/app/id1626186138' });
    return { immediate, fallback:window.__fallback, plain:window.__opened.slice() };
  });
  assert(launchOrder.immediate.length === 0,
    'a scheme handoff tries the app first, not a browser tab');
  assert(launchOrder.fallback === 'https://apps.apple.com/app/id1626186138',
    'when the app never takes over, the store page opens instead');
  assert(launchOrder.plain.length === 1 && launchOrder.plain[0] === 'https://apps.apple.com/app/id1626186138',
    'apps without a direct target still open their page directly');

  // ── travel card: tap edits the leg, double tap opens directions ─────────
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
    const timing = document.querySelector('#travel-edit-timing')?.textContent || '';
    host.remove();
    closeSheet('travel-edit-sheet');
    return { open,timing };
  });
  assert(!travelSingle.missing, 'a travel card renders for the seeded leg');
  assert(travelSingle.open, 'a single tap opens the travel time editor');
  assert(travelSingle.timing.includes('leave by') && travelSingle.timing.includes('arrive about'),
    'the travel editor carries the tapped leg’s leave-by and arrival context');
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
