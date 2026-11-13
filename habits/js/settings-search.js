// In-settings navigation only. Search never changes a saved setting.
// Destinations are read from the live sheet, so hidden and platform-absent
// controls stay out of the results, and saved user content (place names,
// addresses, topics, profiles, device names) is never indexed.
// Words a person might type instead of the label on screen. A section key is
// added to that section's title. An id, toggle key, or associated control id
// is added only to that control.
const SETTINGS_SEARCH_ALIASES = {
  'settings-weather-body':'forecast temperature rain snow wind humidity units celsius fahrenheit centigrade precipitation',
  'weather-temp-unit-seg':'temperature unit celsius fahrenheit centigrade',
  'weather-precip-unit-seg':'precipitation rain unit millimeter inches',
  'weather-wind-unit-seg':'wind speed unit kilometers miles hours',
  'settings-reminders-body':'notification alert notify push banner ping sound tone chime calm warm deep gentle audio',
  soundEffects:'mute audio chime volume',
  'settings-cleanup-body':'retention history delete purge logs',
  'settings-calendar-body':'meeting event pdf import ics ical outlook google apple',
  'calendar-ics-from':'ics import range start date',
  'calendar-ics-to':'ics import range end date through',
  'calendar-pdf-input':'pdf file choose import attachment',
  'calendar-allday-mode':'allday all day overnight midnight multi day events',
  'calendar-credit-habit':'credit meeting time toward habit work hours',
  'settings-topics-body':'tag label category',
  'settings-locations-body':'place address city gps map home travel',
  'travel-mode-seg':'default transport commute drive walking bicycle transit mode',
  'location-access-enable':'gps presence live location turn on enable',
  'home-city-input':'home city town weather base set',
  'settings-blocked-body':'sleep meal lunch dinner commute blocked reserve unavailable',
  'settings-cards-body':'card pill list detail streak dot trail',
  'card-detail-seg':'card detail level simple detailed custom',
  'agenda-time-seg':'agenda clock time symbol hide show scheduled',
  'settings-defaults-body':'preset template',
  'default-type-seg':'default new item kind build limit stop task',
  'default-profile-seg':'defaults for habits tasks profile',
  'default-priority-seg':'default importance urgent critical someday',
  'setting-default-due':'due date default someday no date deadline',
  'setting-default-completion':'completion automatic mark done duration minutes',
  'setting-default-auto-mark':'auto mark after minutes completion',
  'setting-default-breakable':'split chunks duration sessions',
  'font-scale-seg':'font text size letters display scale',
  'theme-mode-seg':'theme dark light system mode',
  'settings-appearance-body':'theme dark light night mode font text size palette color colour sound compact',
  'settings-replica-chrome':'display bar clock sync lock paired screen',
  'settings-agenda-body':'pair fridge tablet cast sync screen qr clone glance mirror',
  'settings-prayer-body':'prayer sunrise sunset dawn dusk salah namaz fajr',
  'setting-prayer-method':'prayer calculation convention method university',
  'prayer-madhab-seg':'asr school madhab hanafi shafi prayer standard later',
  'settings-advanced-body':'optimizer packing planner',
  'settings-assistant-body':'qwen ollama ai chatbot model',
  'assistant-provider-seg':'assistant model source needle ollama lm studio server',
  'assistant-reasoning-seg':'thinking reasoning depth full low off',
  'settings-android-assistant-body':'gemini google hey voice appfunctions shortcuts',
  minimalMode:'simple basic easy essentials',
  'backup-export':'download save json',
  'backup-import':'restore upload recover json',
  'settings-reset':'factory defaults',
  'settings-clear-data':'wipe erase delete everything'
};

// A few headings are plain spans with no id and no associated control; these
// synonyms key off the heading's normalized text instead.
const SETTINGS_SEARCH_ALIAS_LABELS = {
  'delete completed tasks after':'retention cleanup purge automatic completed tasks',
  'habit history':'history logs entries keep retention trail',
  'live location':'gps presence background location',
  'city':'home city town weather base',
  'default travel mode':'travel transport commute drive walking bicycle transit',
  'item details':'card pill detail level',
  'scheduled time on items':'agenda clock time card',
  'start the add page with':'default new item kind',
  'how often':'frequency default times period',
  'importance':'priority urgent critical someday',
  'duration':'length minutes default',
  'can do early':'early window flexibility days before default',
  'may run late':'delay allowance late flexibility default',
  'shortest session':'minimum chunk split',
  'allowed days':'weekdays days schedule default',
  'allowed time':'time window hours start end default',
  'allowed places':'places locations default',
  'default topics':'topics tags default',
  'color palette':'palette color colour swatch theme',
  'font size':'font text letters display size',
  'on each card':'card appearance minimal',
  'feed title':'display feed name',
  'sync style for the next display':'sync clone glance shared style',
  'display reauthorization':'reauthorize qr expiry days scan',
  'glance view compatibility':'glance scope compatibility hours activities',
  'signed in displays':'paired devices displays list',
  'pair a display':'pair qr scan display second screen',
  'calculation method':'prayer calculation convention university',
  'asr school madhab':'asr madhab hanafi shafi prayer school standard later'
};

// Rendered lists that hold the user's own data. Nothing inside is indexed.
const SETTINGS_USER_CONTENT = '#location-list,#topic-list,#blocked-time-list,#weather-profile-list,#calendar-device-controls,#settings-agenda-devices,#weather-forecast-data,#calendar-pdf-preview,#default-places-chips,#default-topics-chips';

function settingsSearchExtra(target){
  const head = target.closest?.('.settings-collapse-head');
  const keys = [target.id, target.dataset?.settingToggle];
  if(head && head.contains(target))keys.push(head.getAttribute('aria-controls'));
  return keys.map(key=>key && SETTINGS_SEARCH_ALIASES[key]).filter(Boolean).join(' ');
}

// Associate aliases with the field heading, not every choice in its group:
// searching "dark" must not make the "light" choice a match.
function settingsControlAliases(target){
  const label = target.matches?.('label[for]') ? target : target.querySelector?.('label[for]');
  const ids = [label?.getAttribute('for')];
  if(target.matches('.settings-sublabel,.settings-range')){
    ids.push(target.querySelector('input,select')?.id);
    const next = (target.closest('.settings-help') || target).nextElementSibling;
    if(next?.matches('.seg'))ids.push(next.id);
  }
  return ids.map(id=>id && SETTINGS_SEARCH_ALIASES[id]).filter(Boolean).join(' ');
}

function settingsSearchLabel(el){
  if(!el)return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.leave-tooltip, .info-tooltip, .settings-help-body, .switch-ui').forEach(node=>node.remove());
  return settingsSearchText(clone.textContent);
}

function settingsSearchText(value){
  return String(value || '').replace(/\s+/g,' ').trim();
}

function settingsSearchIncluded(el){
  if(!el?.closest('#settings-sheet .settings-stack'))return false;
  const minimal = document.body.classList.contains('minimal-mode');
  if(minimal && el.closest('.settings-full-only'))return false;
  if(!minimal && el.closest('.settings-minimal-only'))return false;
  const stack = el.closest('.settings-stack');
  for(let node = el; node && node !== stack; node = node.parentElement){
    if(node.hidden && !node.classList.contains('settings-collapse-body'))return false;
  }
  return true;
}

function settingsSearchGroup(section){
  let el = section?.previousElementSibling;
  while(el && !el.classList.contains('settings-group-head'))el = el.previousElementSibling;
  return settingsSearchText(el?.textContent);
}

function settingsSearchEntries(){
  const stack = document.querySelector('#settings-sheet .settings-stack');
  if(!stack)return [];
  const entries = [];
  const seen = new Set();
  const add = (target,label,aliases = '',desc = '')=>{
    if(!settingsSearchIncluded(target) || seen.has(target))return;
    // Saved user content stays out of the index entirely.
    if(target.closest(SETTINGS_USER_CONTENT))return;
    const name = settingsSearchText(label);
    if(!name)return;
    seen.add(target);
    const section = target.closest('.settings-block');
    const sectionLabel = settingsSearchText(section?.querySelector('.settings-label')?.textContent);
    const group = settingsSearchGroup(section);
    const head = target.closest('.settings-collapse-head');
    const path = head ? group : [group,sectionLabel].filter(Boolean).join(' › ');
    const synonyms = [
      settingsSearchExtra(target),
      settingsControlAliases(target),
      SETTINGS_SEARCH_ALIAS_LABELS[detailSearchNormalize(name)]
    ].filter(Boolean).join(' ');
    const labelN = detailSearchNormalize(name);
    entries.push({
      target,label:name,path,labelN,
      aliasN:detailSearchNormalize(`${aliases} ${synonyms}`),
      pathN:detailSearchNormalize(path),
      descN:detailSearchNormalize(desc),
      order:entries.length
    });
  };
  stack.querySelectorAll('.settings-block').forEach(section=>{
    const label = section.querySelector('.settings-label');
    const head = section.querySelector('.settings-collapse-head');
    if(label)add(head || label,settingsSearchLabel(label));
  });
  stack.querySelectorAll('.settings-sublabel').forEach(el=>add(el,settingsSearchLabel(el)));
  stack.querySelectorAll('.setting-toggle').forEach(toggle=>{
    add(toggle,toggle.querySelector('b')?.textContent,'',toggle.querySelector('small')?.textContent);
  });
  stack.querySelectorAll('.btn, .seg-opt, .palette-option').forEach(button=>add(button,settingsSearchLabel(button)));
  // Default-duration style ranges keep their caption in a bare span.
  stack.querySelectorAll('.settings-range').forEach(row=>{
    add(row,row.querySelector(':scope > span')?.textContent);
  });
  return entries;
}

function renderSettingsSearch(){
  const input = $('settings-search-input');
  const results = $('settings-search-results');
  const status = $('settings-search-status');
  if(!input || !results || !status)return;
  const query = detailSearchNormalize(input.value).slice(0,120);
  const tokens = query.split(' ').filter(Boolean);
  const ranked = searchRankEntries(settingsSearchEntries(),tokens,SETTINGS_SEARCH_RULES,true);
  results.replaceChildren();
  ranked.forEach(row=>results.append(searchResultButton(row,entry=>revealSettingsSearchEntry(entry))));
  status.textContent = !tokens.length
    ? 'Browse settings, or search by name.'
    : ranked.length
      ? `${ranked.length} ${ranked.length === 1 ? 'match' : 'matches'}`
      : 'No matching settings. Try “theme”, “backup”, “reminders”, or “places”.';
  $('settings-search-clear').hidden = !input.value;
}

let settingsSearchReturnScroll = 0;
function setSettingsSearchOpen(open,focus = true){
  const sheet = document.querySelector('#settings-sheet .settings-sheet');
  const panel = $('settings-search-panel');
  const toggle = $('settings-search-toggle');
  const field = sheet?.querySelector('.detail-search-field');
  if(!sheet || !panel || !toggle || !field)return;
  const minimal = document.body.classList.contains('minimal-mode');
  open = Boolean(open && !minimal);
  const wasOpen = sheet.classList.contains('detail-search-open');
  const stack = sheet.querySelector('.settings-stack');
  if(open && !wasOpen)settingsSearchReturnScroll = stack.scrollTop;
  sheet.classList.toggle('detail-search-open',open);
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open ? 'focus settings search' : 'search settings');
  field.hidden = !open;
  $('settings-search-dismiss').hidden = !open;
  $('settings-close').hidden = open;
  if(!open){
    $('settings-search-input')?.blur();
    if(wasOpen)stack.scrollTop = settingsSearchReturnScroll;
  }else{
    renderSettingsSearch();
    if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
    if(focus)$('settings-search-input')?.focus({preventScroll:true});
  }
  if(!open && focus)toggle.focus({preventScroll:true});
}

function revealSettingsSearchEntry(entry){
  if(!entry?.target?.isConnected)return;
  const target = entry.target;
  setSettingsSearchOpen(false,false);
  $('settings-search-input')?.blur();
  const section = target.closest('.settings-block');
  const body = section?.querySelector('.settings-collapse-body');
  const head = section?.querySelector('.settings-collapse-head');
  if(body && head){
    body.hidden = false;
    head.setAttribute('aria-expanded','true');
  }
  for(let details = target.closest('details'); details; details = details.parentElement?.closest('details')){
    details.open = true;
  }
  requestAnimationFrame(()=>{
    if(!target.isConnected)return;
    target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    const hit = target.closest('.setting-toggle, .settings-collapse-head, .btn, .seg-opt, .palette-option') || target;
    hit.classList.add('detail-search-hit');
    setTimeout(()=>hit.classList.remove('detail-search-hit'),2400);
    const focus = target.matches('input,select,button,summary') ? target : target.querySelector('input,select,button,summary');
    focus?.focus({preventScroll:true});
  });
}

$('settings-search-toggle')?.addEventListener('click',()=>{
  setSettingsSearchOpen(true);
});
$('settings-search-dismiss')?.addEventListener('click',()=>setSettingsSearchOpen(false));
$('settings-search-input')?.addEventListener('input',event=>{
  if(event.isComposing)return;
  renderSettingsSearch();
});
$('settings-search-input')?.addEventListener('compositionend',renderSettingsSearch);
$('settings-search-clear')?.addEventListener('click',()=>{
  $('settings-search-input').value = '';
  renderSettingsSearch();
  $('settings-search-input').focus({preventScroll:true});
});
$('settings-search-input')?.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key === 'ArrowDown'){
    event.preventDefault();$('settings-search-results').querySelector('button')?.focus();
  }else if(event.key === 'Enter'){
    event.preventDefault();$('settings-search-results').querySelector('button')?.click();
  }
});
$('settings-search-results')?.addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const buttons = [...$('settings-search-results').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();buttons[next]?.focus();
});
document.addEventListener('keydown',event=>{
  if(event.key !== 'Escape' || $('settings-search-panel')?.hidden || !$('settings-sheet')?.classList.contains('open'))return;
  const tier = parseInt(getComputedStyle($('settings-sheet')).zIndex,10) || 0;
  if([...document.querySelectorAll('.sheet-wrap.open')].some(el=>el.id !== 'settings-sheet' && (parseInt(getComputedStyle(el).zIndex,10)||0)>tier))return;
  event.preventDefault();event.stopImmediatePropagation();setSettingsSearchOpen(false);
},true);
