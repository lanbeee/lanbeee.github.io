// In-settings navigation only. Search never changes a saved setting.
// Destinations are read from the live sheet, so hidden and platform-absent
// controls stay out of the results.
// Words a person might type instead of the label on screen.
// A section key is added to that section's title. An id or toggle key
// is added only to that control.
const SETTINGS_SEARCH_ALIASES = {
  'settings-weather-body':'forecast temperature rain snow wind humidity units celsius fahrenheit centigrade precipitation',
  'settings-reminders-body':'notification alert notify push banner ping',
  'settings-cleanup-body':'retention history delete purge logs',
  'settings-calendar-body':'meeting event pdf import ics ical outlook google apple',
  'settings-topics-body':'tag label category',
  'settings-locations-body':'place address city gps map home travel',
  'settings-blocked-body':'sleep meal lunch dinner commute blocked reserve unavailable',
  'settings-cards-body':'card pill list detail streak dot trail',
  'settings-defaults-body':'preset template',
  'settings-appearance-body':'theme dark light night mode font text size palette color colour sound compact',
  soundEffects:'mute audio chime volume',
  'settings-agenda-body':'pair fridge tablet cast sync screen qr clone glance mirror',
  'settings-prayer-body':'prayer sunrise sunset dawn dusk salah namaz fajr',
  'settings-advanced-body':'optimizer packing planner',
  'settings-assistant-body':'qwen ollama ai chatbot model',
  minimalMode:'simple basic easy essentials',
  'backup-export':'download save json',
  'backup-import':'restore upload recover json',
  'settings-reset':'factory defaults',
  'settings-clear-data':'wipe erase delete everything'
};

function settingsSearchExtra(target){
  const head = target.closest?.('.settings-collapse-head');
  const keys = [target.id, target.dataset?.settingToggle];
  if(head && head.contains(target))keys.push(head.getAttribute('aria-controls'));
  return keys.map(key=>key && SETTINGS_SEARCH_ALIASES[key]).filter(Boolean).join(' ');
}

function settingsSearchLabel(el){
  if(!el)return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.leave-tooltip, .info-tooltip, .settings-help-body, .switch-ui').forEach(node=>node.remove());
  return settingsSearchText(clone.textContent);
}

function settingsSearchTokenMatch(text, token){
  const words = text.split(' ').filter(Boolean);
  const stems = [token];
  if(token.length > 4 && token.endsWith('ies'))stems.push(token.slice(0,-3) + 'y');
  else if(token.length > 4 && token.endsWith('s'))stems.push(token.slice(0,-1));
  return stems.some(stem=>{
    if(words.some(word=>word === stem || (stem.length >= 5 && word.startsWith(stem))))return true;
    return stem.length >= 7 && words.some(word=>detailSearchTokenMatch(word, stem));
  });
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
  const add = (target,label,aliases = '')=>{
    if(!settingsSearchIncluded(target) || seen.has(target))return;
    const name = settingsSearchText(label);
    if(!name)return;
    seen.add(target);
    const section = target.closest('.settings-block');
    const sectionLabel = settingsSearchText(section?.querySelector('.settings-label')?.textContent);
    const group = settingsSearchGroup(section);
    const head = target.closest('.settings-collapse-head');
    const path = head ? group : [group,sectionLabel].filter(Boolean).join(' › ');
    const text = detailSearchNormalize(`${name} ${aliases} ${settingsSearchExtra(target)} ${path}`);
    entries.push({target,label:name,path,text});
  };
  stack.querySelectorAll('.settings-block').forEach(section=>{
    const label = section.querySelector('.settings-label');
    const head = section.querySelector('.settings-collapse-head');
    if(label)add(head || label,settingsSearchLabel(label));
  });
  stack.querySelectorAll('.settings-sublabel').forEach(el=>add(el,settingsSearchLabel(el)));
  stack.querySelectorAll('.setting-toggle').forEach(toggle=>{
    add(toggle,toggle.querySelector('b')?.textContent,toggle.querySelector('small')?.textContent);
  });
  stack.querySelectorAll('.btn, .seg-opt, .palette-option').forEach(button=>add(button,settingsSearchLabel(button)));
  return entries;
}

function renderSettingsSearch(){
  const input = $('settings-search-input');
  const results = $('settings-search-results');
  const status = $('settings-search-status');
  if(!input || !results || !status)return;
  const query = detailSearchNormalize(input.value).slice(0,120);
  const tokens = query.split(' ').filter(Boolean);
  const matches = settingsSearchEntries().filter(entry=>tokens.every(token=>settingsSearchTokenMatch(entry.text,token))).sort((a,b)=>{
    const rank = entry=>detailSearchNormalize(entry.label) === query ? 0 : detailSearchNormalize(entry.label).startsWith(query) ? 1 : 2;
    return rank(a) - rank(b) || a.label.localeCompare(b.label);
  });
  results.replaceChildren();
  matches.forEach(entry=>{
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'detail-search-result';
    const label = document.createElement('b');
    label.textContent = entry.label;
    const path = document.createElement('small');
    path.textContent = entry.path;
    button.append(label,path);
    button.addEventListener('click',()=>revealSettingsSearchEntry(entry));
    results.append(button);
  });
  status.textContent = !tokens.length
    ? 'Browse settings, or search by name.'
    : matches.length
      ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
      : 'No matching settings. Try “theme”, “backup”, “reminders”, or “places”.';
  $('settings-search-clear').hidden = !input.value;
}

function setSettingsSearchOpen(open,focus = true){
  const sheet = document.querySelector('#settings-sheet .settings-sheet');
  const panel = $('settings-search-panel');
  const toggle = $('settings-search-toggle');
  const field = sheet?.querySelector('.detail-search-field');
  if(!sheet || !panel || !toggle || !field)return;
  const minimal = document.body.classList.contains('minimal-mode');
  open = Boolean(open && !minimal);
  sheet.classList.toggle('detail-search-open',open);
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open ? 'focus settings search' : 'search settings');
  field.hidden = !open;
  if(!open){
    $('settings-search-input')?.blur();
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
  setSettingsSearchOpen($('settings-search-panel')?.hidden !== false);
});
$('settings-search-input')?.addEventListener('input',renderSettingsSearch);
$('settings-search-clear')?.addEventListener('click',()=>{
  $('settings-search-input').value = '';
  renderSettingsSearch();
  $('settings-search-input').focus({preventScroll:true});
});
$('settings-search-input')?.addEventListener('keydown',event=>{
  if(event.key !== 'Escape')return;
  event.preventDefault();
  setSettingsSearchOpen(false);
});
