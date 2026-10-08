// In-item navigation only. Search never changes a saved setting or enables a
// prerequisite. Destinations are resolved from the live DOM on every search.
const DETAIL_SEARCH_FIELDS = [
  ['detail-times','Times per cycle','frequency repeat repetitions rhythm'],
  ['detail-days','Cycle days','frequency interval cadence rhythm'],
  ['detail-due-date','Due date','deadline appointment task date'],
  ['detail-due-time','Due time','deadline appointment fixed start task time'],
  ['detail-weekday-chips','Allowed weekdays','days monday tuesday wednesday thursday friday saturday sunday'],
  ['detail-monthday-toggle','Allowed month days','dates monthly calendar'],
  ['detail-allowed-time-row','Allowed time window','hours start end clock relative sunrise sunset prayer fajr zuhr dhuhr asr maghrib isha anchor offset later earlier combine overnight'],
  ['detail-preferred-weekday-chips','Preferred weekdays','best days soft preference'],
  ['detail-preferred-monthday-toggle','Preferred month days','best dates monthly'],
  ['detail-preferred-time-row','Preferred time window','best hours start end clock sunrise sunset prayer anchor'],
  ['detail-places-label','Allowed places','location anywhere home work venues'],
  ['detail-place-chips','Place preferences','preferred location venue little high avoid ranking'],
  ['detail-show-weather','Show weather','forecast temperature rain wind humidity'],
  ['detail-show-weather-location','Use this item’s place for weather','forecast location'],
  ['detail-weather-profile','Weather guidance','profile dry rain temperature wind conditions'],
  ['detail-weather-location','Anywhere forecast','weather city location'],
  ['detail-habit-option-add','Add a time and place option','specific alternative venue weather schedule'],
  ['detail-duration','Duration','length minutes effort time'],
  ['detail-breakable','Breakable into chunks','split sessions pieces duration'],
  ['detail-min-chunk','Minimum chunk','shortest session split breakable'],
  ['detail-min-gap','Minimum gap between sessions','spacing wait naps medicine'],
  ['detail-track-value','Log a value or note','weight measurement tracking'],
  ['detail-auto-mark','Auto mark done','automatic completion logging minutes auto log agenda chunks'],
  ['detail-timer-toggle','Start or stop session','timer stopwatch active'],
  ['detail-timer-auto-stop','Session target','timer auto stop minutes'],
  ['detail-early-window','Early window','days flexibility before due'],
  ['detail-delay-allowance','Delay allowance','late days flexibility postpone after due'],
  ['detail-schedule-link-add','Item order','before after direct adjacency same day partner link'],
  ['detail-habit-message','Name','title rename identity'],
  ['detail-type-seg','Habit or task','type convert change'],
  ['detail-mode-seg','Habit kind','build limit stop reduce zero'],
  ['detail-emoji','Emoji','icon appearance quick pick'],
  ['detail-emoji-bg','Emoji background','color colour appearance'],
  ['detail-priority-seg','Priority','critical someday p0 p1 p2 p3 p4 p5'],
  ['detail-topic-chips','Topics','tags category categories'],
  ['detail-app-add','Add app','shortcut gmail outlook facebook instagram youtube reddit linkedin'],
  ['detail-link-add','Add link or call','phone whatsapp facetime meeting url web'],
  ['detail-shared-display','Shared display access','hidden view only mark done completion'],
  ['detail-pinned','Pinned','pin top order'],
  ['detail-export','Export to calendar','download appointment phone alert'],
  ['detail-share-item','Share item','invite sharing'],
  ['detail-ask-ai','Change with AI','assistant edit artificial intelligence'],
  ['detail-snooze','Snooze or show','hide unhide hidden hours days'],
  ['detail-delete','Remove item','delete undo'],
  ['detail-calendar','Calendar history','activity log plan day date entries'],
  ['detail-viz-seg','Gap history','graph chart intervals'],
  ['detail-stats','Progress statistics','score streak total entries usual gap last 30 days trend'],
  ['detail-order-block','Today’s order links','drag reorder unlink clear partner']
];

function resetDetailDisclosures(h){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  inner.querySelectorAll('.detail-disclosure').forEach(el=>{
    delete el.dataset.regularOpen;
    el.open = el.dataset.detailEssential === 'true';
  });
  const configured = {
    'detail-availability-disclosure':Boolean(h.allowedWeekdays?.length || h.allowedMonthDays?.length || h.locationIds?.length || h.allowedTimeStart != null || h.allowedTimeEnd != null || h.allowedTimeStartAnchor || h.allowedTimeEndAnchor),
    'detail-weather-disclosure':Boolean(h.showWeather || h.weatherProfileId || h.weatherProfileMode === 'none' || h.weatherLocationId),
    'detail-options-disclosure':Boolean(h.scheduleOptions?.length),
    'detail-order-disclosure':Boolean(h.scheduleLinks?.length),
    'detail-links-disclosure':Boolean(h.links?.length),
    'detail-native-reminders':typeof nativeReminderAnyOn === 'function' && nativeReminderAnyOn(`item:${h.hid}`)
  };
  Object.entries(configured).forEach(([id,open])=>{if($(id))$(id).open = open;});
}

function detailSearchNormalize(value){
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

function detailSearchEntries(){
  const inner = getSheetInner('detail-sheet');
  if(!inner || detailIsSingleView())return [];
  const entries = [];
  const add = (target,label,aliases='')=>{
    const page = target?.closest('.detail-page');
    if(!page || page.hidden || target.disabled)return;
    // Platform-only controls are deliberately absent, including native sharing.
    if(target.closest('.detail-shared-display-control') && window.TingsNative?.isNative)return;
    if(target.id === 'detail-share-item' && typeof shareConfigured === 'function' && !shareConfigured())return;
    if(target.id === 'detail-export' && target.hidden)return;
    if(target.id === 'detail-order-block' && target.hidden)return;
    const sections = [];
    for(let p=target.closest('details');p;p=p.parentElement.closest('details')){
      sections.unshift(p.querySelector(':scope > summary')?.textContent.trim());
    }
    const path = [DETAIL_PAGE_NAV[page.dataset.detailNav]?.label,...sections].filter(Boolean).join(' › ');
    const text = detailSearchNormalize(`${label} ${aliases} ${path}`);
    if(!entries.some(e=>e.target === target))entries.push({target,label,path,text});
  };
  DETAIL_SEARCH_FIELDS.forEach(([id,label,aliases])=>add($(id),label,aliases));
  inner.querySelectorAll('.detail-page details > summary').forEach(el=>add(el,el.textContent.trim()));
  // Include live option/link rows and every native reminder edge. Labels come
  // from the renderer, so added rows and changing item types cannot go stale.
  inner.querySelectorAll('.habit-option-row, .schedule-link-editor, .link-row, #detail-native-reminders label').forEach(row=>{
    let label,aliases;
    if(row.closest('#detail-native-reminders')){
      label = row.childNodes[0]?.textContent.trim();
      const edge = row.querySelector('select')?.dataset.reminderEdge;
      aliases = 'phone reminder notification ringing alarm';
      if(edge === 'missed')aliases += ' before missed drop cutoff warning estimate';
      if(row.querySelector('[data-reminder-lead]'))aliases += ' travel departure lead time minutes';
    }else if(row.matches('.schedule-link-editor')){
      label = `Item order: ${row.querySelector('.schedule-link-habit option:checked')?.textContent || 'choose a partner'}`;
      aliases = row.textContent;
    }else if(row.matches('.habit-option-row')){
      label = `${row.querySelector('.habit-option-number')?.textContent || 'Option'}: ${row.querySelector('.habit-option-location option:checked')?.textContent || 'anywhere'}`;
      aliases = row.textContent;
    }else{
      label = row.querySelector('.link-app-name')?.value || row.querySelector('.link-value')?.value || 'Link or call';
      aliases = row.textContent;
    }
    add(row,label || 'Schedule option',aliases);
  });
  return entries;
}

// One missing, extra, or mistyped letter for long words; short queries stay
// exact so searches like “P0” and “AI” do not flood the results.
function detailSearchTokenMatch(text,token){
  if(text.includes(token))return true;
  if(token.length < 5)return false;
  return text.split(' ').some(word=>{
    if(Math.abs(word.length - token.length)>1)return false;
    let i=0,j=0,edits=0;
    while(i<word.length && j<token.length){
      if(word[i] === token[j]){i++;j++;continue;}
      if(++edits>1)return false;
      if(word.length>=token.length)i++;
      if(token.length>=word.length)j++;
    }
    return edits+(word.length-i)+(token.length-j)<=1;
  });
}

function renderDetailSearch(){
  const query = detailSearchNormalize($('detail-search-input').value).slice(0,120);
  const tokens = query.split(' ').filter(Boolean);
  const entries = detailSearchEntries();
  const matches = entries.filter(e=>tokens.every(token=>detailSearchTokenMatch(e.text,token))).sort((a,b)=>{
    const rank = e=>detailSearchNormalize(e.label) === query ? 0 : detailSearchNormalize(e.label).startsWith(query) ? 1 : 2;
    return rank(a)-rank(b);
  });
  const results = $('detail-search-results');
  results.replaceChildren();
  matches.forEach(entry=>{
    const button = document.createElement('button');
    button.type = 'button';button.className = 'detail-search-result';
    const label = document.createElement('b');label.textContent = entry.label;
    const path = document.createElement('small');path.textContent = entry.path;
    button.append(label,path);
    button.addEventListener('click',()=>revealDetailSearchEntry(entry));
    results.append(button);
  });
  $('detail-search-status').textContent = !tokens.length ? 'Browse settings, or search by name.' : matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : 'No matching settings. Try “duration”, “weather”, “reminder” or “days”.';
  $('detail-search-clear').hidden = !$('detail-search-input').value;
}

let detailSearchReturnNav = null;
let detailSearchReturnScroll = [];
function setDetailSearchOpen(open,focus = true){
  open = Boolean(open && !detailIsSingleView() && !getSheetInner('detail-sheet')?.classList.contains('tune-dirty'));
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const wasOpen = inner.classList.contains('detail-search-open');
  if(open && !wasOpen){
    const pager = inner.querySelector('.detail-pager');
    const index = Math.round(pager.scrollLeft / Math.max(1,pager.clientWidth));
    const pages = visibleDetailPages(pager);
    detailSearchReturnNav = pages[index]?.dataset.detailNav;
    detailSearchReturnScroll = pages.map(page=>({page,top:page.scrollTop}));
  }
  inner.classList.toggle('detail-search-open',open);
  $('detail-search-panel').hidden = !open;
  const toggle = $('detail-search-toggle');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open ? 'focus detail search' : 'search detail settings');
  $('detail-cool').setAttribute('aria-label',open ? 'close detail search' : 'close details');
  inner.querySelector('.detail-search-field').hidden = !open;
  if(!open){
    $('detail-search-input').blur();
    if(wasOpen){
      if(detailSearchReturnNav)scrollDetailToNav(detailSearchReturnNav,'auto');
      detailSearchReturnScroll.forEach(({page,top})=>{if(page.isConnected)page.scrollTop = top;});
    }
  }
  if(open){
    renderDetailSearch();
    updateKeyboardLift();
    if(focus)$('detail-search-input').focus({preventScroll:true});
  }else if(focus){
    $('detail-search-input').blur();
    $('detail-search-toggle').focus({preventScroll:true});
  }
}

function revealDetailSearchEntry(entry){
  if(!entry.target.isConnected || detailIsSingleView())return;
  let target = entry.target;
  const original = target;
  setDetailSearchOpen(false,false);
  $('detail-search-input').blur();
  const preferred = target.closest('#detail-schedule-preferred') || entry.label === 'Place preferences';
  if(target.closest('[data-detail-nav="schedule"]'))setScheduleView(preferred ? 'preferred' : 'allowed');
  if(target.id === 'detail-viz-seg'){
    detailVizMode = 'gaps';syncDetailVizMode();
  }else if(target.closest('.detail-calendar-page')){
    detailVizMode = 'calendar';syncDetailVizMode();
  }
  let message = '';
  if(target.closest('#detail-min-chunk-row') && $('detail-min-chunk-row').hidden){
    target = $('detail-breakable-row');message = 'Turn on “breakable into chunks” to set a minimum chunk.';
  }else if(target.closest('#detail-due-row') && $('detail-due-row').hidden){
    target = $('detail-rhythm-disclosure').querySelector('summary');message = 'Due dates and fixed times are available for tasks. Change the type in Identity first.';
  }else if(target.closest('#detail-slider-row') && $('detail-slider-row').hidden){
    target = $('detail-rhythm-disclosure').querySelector('summary');message = 'A repeating rhythm is available for habits. Change the type in Identity first.';
  }else if(target.closest('#detail-mode-field') && $('detail-mode-field').hidden){
    target = $('detail-type-seg');message = 'Choose Habit to see build, limit and stop.';
  }else if(target.closest('#detail-weather-location-wrap') && $('detail-weather-location-wrap').hidden){
    target = $('detail-weather-profile');message = 'An anywhere forecast applies when this item can run anywhere with weather guidance.';
  }else if(target.closest('#detail-show-weather-location-row') && $('detail-show-weather-location-row').hidden){
    target = $('detail-show-weather');message = 'Turn on “show weather” to choose its forecast place.';
  }
  for(let p=target.closest('details');p;p=p.parentElement.closest('details'))p.open = true;
  scrollDetailToNav(target.closest('.detail-page').dataset.detailNav,'auto');
  requestAnimationFrame(()=>{
    if(!target.isConnected || detailIdx === null)return;
    // Conditional fields can change after rendering; land on their nearest
    // visible section without turning on or altering any saved settings.
    if(!target.getClientRects().length)target = original.closest('details')?.querySelector('summary') || target;
    target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    target.classList.add('detail-search-hit');
    setTimeout(()=>target.classList.remove('detail-search-hit'),2400);
    const focus = target.matches('input,select,button,summary') ? target : target.querySelector('input,select,button,summary');
    if(focus)focus.focus({preventScroll:true});
    if(message)showToast(message,4500);
  });
}

$('detail-search-toggle').addEventListener('click',()=>setDetailSearchOpen(true));
// Reclaim space as soon as an editing field gains focus, including native
// keyboards that resize the WebView itself rather than visualViewport.
// Search keeps its own keyboard layout, and Save/Cancel stay reachable.
let detailEditingPointerDown = false;
function syncDetailEditingChrome(){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const active = document.activeElement;
  const keyboardSpace = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')) || 0;
  const virtualKeyboard = window.TingsNative?.isNative || matchMedia('(any-pointer:coarse)').matches || keyboardSpace > 80;
  const editing = inner.contains(active) && active.closest('.detail-page')
    && active.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]')
    && !active.readOnly && !active.disabled;
  // Blurring the field on pointerdown must not move the intended button
  // before pointerup/click reaches it.
  if(!editing && detailEditingPointerDown)return;
  // Blur precedes the IME's closing resize. Keep the editing chrome until
  // that resize finishes, otherwise Search/X briefly appears above the
  // keyboard and then jumps to the bottom. Android already resizes the
  // layout, so its zero keyboard-lift is not evidence that the IME closed.
  const nativeResized = window.TingsNative?.isNative && window.TingsNative.platform === 'android'
    && Math.abs((window.visualViewport?.scale || 1) - 1) < 0.01;
  const keyboardVisible = nativeResized
    ? nativeKeyboardRestHeight - document.documentElement.clientHeight > 2 : keyboardSpace > 2;
  const closing = !inner.classList.contains('detail-search-open')
    && inner.classList.contains('detail-field-editing') && keyboardVisible;
  inner.classList.toggle('detail-field-editing',Boolean((editing && virtualKeyboard) || closing));
}
document.addEventListener('pointerdown',event=>{
  detailEditingPointerDown = Boolean(event.target.closest('.detail-sheet'));
},true);
['pointerup','pointercancel'].forEach(type=>document.addEventListener(type,()=>{
  if(!detailEditingPointerDown)return;
  detailEditingPointerDown = false;
  setTimeout(syncDetailEditingChrome,250);
},true));
document.addEventListener('focusin',syncDetailEditingChrome);
document.addEventListener('focusout',()=>requestAnimationFrame(syncDetailEditingChrome));
$('detail-search-input').addEventListener('input',renderDetailSearch);
$('detail-search-input').addEventListener('keydown',event=>{
  if(event.key === 'ArrowDown'){
    event.preventDefault();$('detail-search-results').querySelector('button')?.focus();
  }else if(event.key === 'Enter'){
    event.preventDefault();$('detail-search-results').querySelector('button')?.click();
  }
});
$('detail-search-clear').addEventListener('click',()=>{
  $('detail-search-input').value='';renderDetailSearch();$('detail-search-input').focus();
});
$('detail-search-results').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const buttons = [...$('detail-search-results').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();buttons[next]?.focus();
});
document.addEventListener('keydown',event=>{
  if(event.key !== 'Escape' || $('detail-search-panel').hidden)return;
  // A nested modal must dismiss before the search underneath it.
  if([...document.querySelectorAll('.sheet-wrap.open')].some(el=>el.id !== 'detail-sheet' && (parseInt(getComputedStyle(el).zIndex,10)||0)>110))return;
  event.preventDefault();event.stopImmediatePropagation();setDetailSearchOpen(false);
},true);
