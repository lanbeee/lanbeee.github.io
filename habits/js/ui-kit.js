// Shared UI primitives. Sheets and settings mount from these so markup is not
// copy-pasted in index.html. Keep generated ids/classes byte-stable for tests.

function uiToggleHtml({key, title, hint, extraClass = '', pressed = false}){
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<button class="setting-toggle setting-switch${cls}" type="button" data-setting-toggle="${key}" aria-pressed="${pressed ? 'true' : 'false'}"><span><b>${title}</b><small>${hint}</small></span><span class="switch-ui" aria-hidden="true"></span></button>`;
}

function uiPrioritySegHtml(markDefault){
  const def = Number.isFinite(DEFAULT_PRIORITY) ? DEFAULT_PRIORITY : 2;
  return PRIORITY_LABELS.map((label,i)=>`<button class="seg-opt${markDefault && i === def ? ' on' : ''}" data-priority="${i}">${label}</button>`).join('');
}

function uiCalendarLegendHtml(items, extraClass, id){
  const cls = extraClass ? ` ${extraClass}` : '';
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="calendar-legend${cls}"${idAttr} aria-hidden="true">${items.map(([tone,label])=>`<span><b class="${tone}"></b>${label}</span>`).join('')}</div>`;
}

function uiAboutBlockHtml({id, label, summary, body}){
  return `<section class="about-block about-collapsible calm-block"><button type="button" class="about-collapse-head" data-collapse-target="${id}" aria-expanded="false" aria-controls="${id}"><span class="about-head-text"><span class="about-label">${label}</span><span class="about-summary">${summary}</span></span><i class="ti ti-chevron-down" aria-hidden="true"></i></button><div class="about-collapse-body" id="${id}" hidden>${body.map(p=>`<p>${p}</p>`).join('')}</div></section>`;
}

function uiLeaveBtnHtml({id, aria, body}){
  return `<button type="button" class="info-btn leave-btn" data-tip="${id}" aria-label="${aria}"><i class="ti ti-cloud-up" aria-hidden="true"></i></button><div class="info-tooltip leave-tooltip" id="${id}" role="tooltip" hidden>${body}</div>`;
}

function uiFilterSheetHtml({wrapId, extraClass, titleId, title, summaryId, closeId, closeAria, groupsId, resetId, doneId}){
  const sheetCls = extraClass ? ` ${extraClass}` : '';
  return `<div class="sheet-wrap" id="${wrapId}"><div class="sheet home-filter-sheet${sheetCls}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="home-filter-sheet-head"><div><p class="sheet-title" id="${titleId}">${title}</p><p class="about-copy" id="${summaryId}">Choose a place or topic.</p></div><button type="button" class="icon-btn home-filter-close" id="${closeId}" aria-label="${closeAria}"><i class="ti ti-x" aria-hidden="true"></i></button></div><div class="home-filter-groups" id="${groupsId}"></div><div class="btn-row home-filter-sheet-actions"><button class="btn" type="button" id="${resetId}">reset</button><button class="btn primary" type="button" id="${doneId}">show results</button></div></div></div>`;
}

// PURE: plain-language word for an offset direction. The button keeps
// data-sign='+/-' (storage + readSignedOffset depend on it); only the visible
// word changes, so the adjustment reads "30 min after".
function timeOffsetSignWord(sign){
  return sign === '-' ? 'before' : 'after';
}

// PURE: which mode a clock|relative click asked for. Clicking a labeled
// option selects that mode; clicking the group (tests, padding) toggles.
function timeModeClickWantsDynamic(e, currentlyDynamic){
  const opt = e && e.target && e.target.closest && e.target.closest('[data-time-mode]');
  if(opt)return opt.dataset.timeMode === 'relative';
  return !currentlyDynamic;
}

// RENDER: clock|relative segmented control that owns one start or end.
function uiTimeModeToggleHtml({which, isDynamic = false, extraAttrs = ''}){
  const clockOn = !isDynamic;
  return `<div class="time-mode-toggle time-mode-seg" role="group" aria-label="how this ${which} time is set"${extraAttrs}><button type="button" class="time-mode-opt${clockOn ? ' on' : ''}" data-time-mode="clock" aria-pressed="${clockOn ? 'true' : 'false'}">clock</button><button type="button" class="time-mode-opt${isDynamic ? ' on' : ''}" data-time-mode="relative" aria-pressed="${isDynamic ? 'true' : 'false'}">relative</button></div>`;
}

// RENDER: keep the clock|relative seg in step with an endpoint's mode.
function syncTimeModeWord(endpoint){
  if(!endpoint)return;
  const dyn = endpoint.classList.contains('is-dynamic');
  endpoint.querySelectorAll('.time-mode-toggle [data-time-mode]').forEach(opt=>{
    const on = (opt.dataset.timeMode === 'relative') === dyn;
    opt.classList.toggle('on', on);
    opt.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function uiTimeDayHtml(prefix, second, {on = false, attrs = '', hidden = false} = {}){
  return `<button type="button" class="${second ? 'time-day-next2' : 'time-day-next'} mini-text-btn"${attrs} aria-pressed="${on ? 'true' : 'false'}" title="Use this event on the following day" aria-label="${prefix} use next day's event"${hidden ? ' hidden' : ''}>next day's event</button>`;
}

function uiTimeExprHtml(prefix, second, {options = '', offset = 0, fixedValue = '', isFixed = false, dayOn = false, attr = ()=>''} = {}){
  const anchorCls = second ? 'time-anchor2' : 'time-anchor';
  const habitWrap = second ? 'time-habit-wrap2' : 'time-habit-wrap';
  const habitCls = second ? 'time-habit2' : 'time-habit';
  const offsetCls = second ? 'time-offset2' : 'time-offset';
  const habitAria = second ? `${prefix} second habit` : `${prefix} anchor habit`;
  const offsetAria = second ? `${prefix} second offset minutes` : `${prefix} offset minutes`;
  const anchorAria = second ? `${prefix} second anchor` : `${prefix} anchor`;
  const clock = second ? `<input type="time" class="time-input time-fixed2" step="300"${attr('fixed2')} value="${fixedValue}"${isFixed ? '' : ' hidden'} aria-label="${prefix} clock time" />` : '';
  const hide = isFixed ? ' hidden' : '';
  return `<label class="time-event-label">${second ? 'second time' : 'based on'}<select class="${anchorCls} mini-select"${attr(second ? 'anchor2' : 'anchor')} aria-label="${anchorAria}">${options}</select></label>${clock}<span class="${habitWrap}" hidden><select class="${habitCls} mini-select" aria-label="${habitAria}"></select></span><span class="time-adjust-label"${hide}>adjust by</span><input type="number" class="${offsetCls} mini-time-input"${attr(second ? 'offset2' : 'offset')} inputmode="numeric" min="0" max="720" placeholder="0" value="${Math.abs(offset) || ''}" aria-label="${offsetAria}"${hide} /><button type="button" class="time-offset-sign-btn" data-sign="${offset < 0 ? '-' : '+'}" aria-label="${offset < 0 ? 'minutes before' : 'minutes after'}" title="Switch between before and after"${hide}>${timeOffsetSignWord(offset < 0 ? '-' : '+')}</button><span class="time-offset-unit"${hide}>min</span>${second ? uiTimeDayHtml(prefix,true,{on:dayOn,attrs:attr('day2'),hidden:isFixed}) : ''}`;
}

function uiTimeCombineOptions(combine = ''){
  return [['','use this time only'],['later','use the later time'],['earlier','use the earlier time']]
    .map(([value,label])=>`<option value="${value}"${value === combine ? ' selected' : ''}>${label}</option>`).join('');
}

function timeResolvedDayLabel(minutes){
  return minutes >= 1440 ? 'tomorrow: ' : minutes < 0 ? 'yesterday: ' : 'today: ';
}

// The same progressive editor serves item hours, preferences, place options,
// and busy times. Disclosure state is UI only; collapsed rules still apply.
function uiTimeDynamicHtml(prefix, {expr = uiTimeExprHtml(prefix,false), expr2 = uiTimeExprHtml(prefix,true), day = uiTimeDayHtml(prefix,false), combine = '', combineAttrs = '', resolved = '', resolvedDay = '', needsCity = false, open = false} = {}){
  return `<p class="time-relative-hint">Follows this event as its time changes each day.</p><div class="time-expr">${expr}</div><div class="time-rule-preview" aria-live="polite"><span class="time-rule-summary"></span><span class="time-resolved" data-day-label="${resolvedDay}">${resolved}</span><button type="button" class="mini-text-btn time-set-city"${needsCity ? '' : ' hidden'}>set home city</button></div><details class="time-advanced"${open ? ' open' : ''}><summary>More options</summary><div class="time-advanced-body"><p class="field-hint">For overnight windows, use the event on the following day.</p>${day}<label class="time-compare-label">compare two times<select class="time-combine mini-select"${combineAttrs} aria-label="${prefix} combine">${uiTimeCombineOptions(combine)}</select></label><div class="time-expr time-expr2"${combine ? '' : ' hidden'}>${expr2}</div><p class="field-hint time-comparison-hint"${combine ? '' : ' hidden'}>This boundary uses whichever time is ${combine === 'earlier' ? 'earlier' : 'later'}.</p></div></details>`;
}

// RENDER: translate the current controls into a readable rule, independent of
// today's clock preview (which may need a city before it can resolve).
function syncTimeRuleSummary(endpoint){
  const node = endpoint?.querySelector('.time-rule-summary');
  if(!node)return;
  const expression = second=>{
    const select = endpoint.querySelector(second ? '.time-anchor2' : '.time-anchor');
    if(!select?.value)return 'choose an event';
    if(select.value === 'fixed'){
      const min = timeInputToMinutes(endpoint.querySelector('.time-fixed2')?.value);
      return min == null ? 'choose a clock time' : formatTimeShort(min);
    }
    let event = select.selectedOptions[0]?.textContent || '';
    if(select.value === 'habit'){
      const habit = endpoint.querySelector(second ? '.time-habit2' : '.time-habit');
      event = habit?.value ? `${habit.selectedOptions[0].textContent} completion` : 'habit completion';
    }
    const next = endpoint.querySelector(second ? '.time-day-next2' : '.time-day-next')?.getAttribute('aria-pressed') === 'true';
    if(next && select.value !== 'habit')event = `next day's ${event}`;
    const input = endpoint.querySelector(second ? '.time-offset2' : '.time-offset');
    const offset = normalizePrayerOffset(readSignedOffset(input));
    return offset ? `${Math.abs(offset)} min ${offset < 0 ? 'before' : 'after'} ${event}` : event;
  };
  const combine = endpoint.querySelector('.time-combine')?.value;
  node.textContent = combine ? `${combine === 'later' ? 'Later' : 'Earlier'} of ${expression(false)} and ${expression(true)}` : expression(false);
  const hint = endpoint.querySelector('.time-comparison-hint');
  if(hint){
    hint.hidden = !combine;
    hint.textContent = `This boundary uses whichever time is ${combine === 'earlier' ? 'earlier' : 'later'}.`;
  }
}

function uiTimeEndpointHtml({field, inputId, prefix, endpointLabel, fixedClass = ''}){
  const which = /start$/i.test(field) ? 'start' : 'end';
  const fixedCls = fixedClass ? ` ${fixedClass}` : '';
  return `<div class="time-endpoint" data-field="${field}" data-endpoint-label="${endpointLabel}"><input type="time" class="time-input time-fixed${fixedCls}" id="${inputId}" step="300" aria-label="${prefix} time" /><div class="time-dynamic" hidden>${uiTimeDynamicHtml(prefix)}</div>${uiTimeModeToggleHtml({which})}</div>`;
}

function uiTimePairHtml(kind){
  const allowed = kind === 'allowed';
  const startField = allowed ? 'allowedTimeStart' : 'preferredTimeStart';
  const endField = allowed ? 'allowedTimeEnd' : 'preferredTimeEnd';
  const startId = allowed ? 'detail-time-start' : 'detail-preferred-time-start';
  const endId = allowed ? 'detail-time-end' : 'detail-preferred-time-end';
  const startPrefix = allowed ? 'allowed start' : 'preferred start';
  const endPrefix = allowed ? 'allowed end' : 'preferred end';
  return uiTimeEndpointHtml({field:startField,inputId:startId,prefix:startPrefix,endpointLabel:'from'})
    + '<span class="time-sep">—</span>'
    + uiTimeEndpointHtml({field:endField,inputId:endId,prefix:endPrefix,endpointLabel:'until'});
}

const UI_SETTING_TOGGLES = {
  display:[
    {key:'minimalMode', title:'minimal mode', hint:'Keep the basics: name, rhythm or deadline, duration, allowed weekdays and hours. Turn off for all options. Saved settings still apply; the planner works the same way.'}
  ],
  reminders:[
    {key:'reminders', title:'remind me about commitments', hint:'Show a heads-up for dated tasks and fixed appointments. Rhythm habits stay quiet.'},
    {key:'pushDetailed', title:'include details in notifications', hint:'Include item names, topics, and places instead of generic notification text.'}
  ],
  weather:[
    {key:'showWeatherTemperatureRanges', title:'day temperature ranges', hint:'Add the daily feels-like low–high beside weather icons on Home and the Calendar week strip. Off by default.', extraClass:'settings-full-only'},
    {key:'showWeatherOnBusyTimes', title:'weather on busy times', hint:'Show the condition and feels-like temperature during blocks such as sleep.', extraClass:'settings-full-only'},
    {key:'showWeatherOnTravel', title:'weather on travel', hint:'Show the condition and feels-like temperature during travel. On by default.', extraClass:'settings-full-only'}
  ],
  cardDetails:[
    {key:'showPinnedOnCards', title:'show pinned', hint:'Show a pin mark on pinned items.', extraClass:'settings-full-only'},
    {key:'showTaskDateOnCards', title:'show task dates', hint:'Show due / someday / fixed-time marks on tasks.', extraClass:'settings-full-only'},
    {key:'showPlansOnCards', title:'show planned', hint:'Show when something is planned next.', extraClass:'settings-full-only'},
    {key:'showDayScheduleOnCards', title:'show which days', hint:'Show which weekdays or month days it runs.', extraClass:'settings-full-only'},
    {key:'showTimeWindowOnCards', title:'show time of day', hint:'Show the hours it’s allowed.', extraClass:'settings-full-only'},
    {key:'showSnoozedUntilOnCards', title:'show snooze label', hint:'Show when hidden items return.', extraClass:'settings-full-only'},
    {key:'showDurationOnCards', title:'show duration', hint:'Keep duration visible on the home list.', extraClass:'settings-full-only'},
    {key:'showRepetitionOnCards', title:'show how often', hint:'Show every N days or stop.', extraClass:'settings-full-only'},
    {key:'showFlexibilityOnCards', title:'show scheduling windows', hint:'Show how many days early or late it may be planned.', extraClass:'settings-full-only'},
    {key:'showTopicsOnCards', title:'show topics', hint:'Show topic labels on the home list.', extraClass:'settings-full-only'},
    {key:'showLocationOnCards', title:'show place', hint:'Show the place on each item.', extraClass:'settings-full-only'},
    {key:'showRemindersOnCards', title:'show reminder mark', hint:'Show a bell when this item sends a phone notification or alarm. Tap it to turn those reminders off.', extraClass:'settings-full-only'},
    {key:'showStatusOnCards', title:'show progress', hint:'Show done / almost / behind (or new).', extraClass:'settings-full-only'},
    {key:'showEarlyOnCards', title:'show early', hint:'Show early when it helps a packed day.', extraClass:'settings-full-only'},
    {key:'showCueOnCards', title:'show status line', hint:'Show the one-line status like due today or on track.', pressed:true},
    {key:'showOrderPillsOnCards', title:'show agenda order marks', hint:'Show before / after, doing-now, and linked marks.', extraClass:'settings-full-only'}
  ],
  cards:[
    {key:'showSnoozed', title:'show hidden habits', hint:'Show habits you’ve hidden, faded on home.'}
  ],
  cardsAfterTime:[
    {key:'showTrailOnCards', title:'show activity dots', hint:'Recent history: filled marks are logged days, hollow marks are plans. The rightmost dot is today; the left bar summarizes the previous week.', extraClass:'settings-full-only'},
    {key:'minimalShowTrailOnCards', title:'show activity dots', hint:'Recent history: filled marks are logged days, hollow marks are plans. The rightmost dot is today; the left bar summarizes the previous week.', extraClass:'settings-minimal-only'},
    {key:'reachAssist', title:'easier reach', hint:'Pull and hold at the top to bring the first items down.'}
  ],
  defaults:[
    {key:'defaultBreakable', title:'allow splitting', hint:'New habits can be split across sessions.'}
  ],
  appearance:[
    {key:'soundEffects', title:'gentle sounds', hint:'A soft chime when you log a Ting or make a plan. No background sounds.'},
    {key:'compactMode', title:'compact mode', hint:'Tighter list so more items fit.'}
  ],
  prayer:[
    {key:'prayerIslamicNames', title:'use Islamic prayer names', hint:'Optional: replace the general time labels with Fajr, Dhuhr, Asr, Maghrib, and Isha. Also show prayer calculation settings and sample habits.'}
  ],
  advanced:[
    {key:'agendaOptimizer', title:'smarter packing', hint:'Takes longer, but packs tight days better and protects items with fewer open slots. Off = fast graph packing, usually under a second.'}
  ]
};

const UI_PRIVACY_BLOCKS = [
  {id:'privacy-here-body', label:'On this device', summary:'Habits, logs, places, and settings live in this browser. There is no Tings account.', body:[
    'Tings is a set of files in your browser. Your list is saved in this browser’s own storage (localStorage) on this phone or computer — not in a Tings inbox.',
    'The person who put this site online cannot see your habits, notes, addresses, or logs. Clearing this site’s data, switching browsers, or getting a new phone wipes the list unless you exported a backup (Settings → backup).',
    'Live GPS is used on this phone to match a saved place. Filling city the first time sends a coarse location to Photon or Nominatim. Driving estimates send coordinates to OSRM, an open routing service — saved-place pins, and the live GPS origin when estimating a drive from here.',
    'On the Android app, optional closed-app refresh can save the latest location fix on this phone so reminders can follow you to a saved place even when the app is closed. That fix is never used after ten minutes. A driving estimate can send that origin to OSRM, same as when the app is open. Closed refresh also works from your last saved place without background location.'
  ]},
  {id:'privacy-why-body', label:'Why a website can still be private', summary:'Tings is open source. The hosted files are the app; planning runs here.', body:[
    'The site you open is the program. There is no Tings account and no hidden backend for your list. Anyone can read how it works.',
    'A few features below contact an outside service, each for a stated job. Nothing else is uploaded.'
  ]},
  {id:'privacy-display-body', label:'Shared display', summary:'Opt-in fridge or tablet view. Encrypted on this phone, then relayed by Cloudflare.', body:[
    'Shared display publishes a capped today/tomorrow agenda every paired screen can decrypt, plus — only when a personal clone is signed in — a separate encrypted copy of the full library. That library uses a second key transferred only to the clone, and glance displays never download it.',
    'Either signed-in screen can submit encrypted completion events; the other screen reads them from the relay even if this phone is off. A personal clone can also publish an updated today/tomorrow agenda so the glance display refreshes without opening this phone. A glance display cannot edit the plan or item details. Cloudflare can see that encrypted blobs exist, their sizes, and when they were updated, but cannot read item names, notes, places, or completion contents. Pairing is QR-only from inside Tings. The display can optionally require a local four-digit passcode after its three-tap privacy screen; three wrong attempts revoke that display access and require pairing again.',
    'Look for the cloud-up mark on that setting. At most two screens can be signed in: one full-app display and one glance display. Revoke one from the list, or revoke the whole feed, anytime in Settings; scan a new QR to add a display again.'
  ]},
  {id:'privacy-share-body', label:'Share item', summary:'Opt-in. Encrypted on this phone; the key rides in the invitation link.', body:[
    'Share item uses the same Cloudflare relay. The item is encrypted on this phone before it leaves. The key lives in the link itself, not on the server.',
    'Their progress stays separate from yours. Revoke from the item when you are done.'
  ]},
  {id:'privacy-maps-body', label:'Maps and places', summary:'Lookups use open mapping services, and only for that lookup.', body:[
    '<b>Address or city search</b> sends the text you type to Photon (Komoot) and Nominatim (OpenStreetMap).',
    '<b>First city fill from GPS</b> sends a coarse location (about 1 km), not the live pin, to Photon or Nominatim. Presence matching stays on this phone.',
    '<b>Travel estimates</b> send coordinates to OSRM, an open routing service, for that route: two saved-place pins, or the live GPS origin plus a saved-place pin when estimating a drive from here. You can type minutes yourself instead.',
    '<b>Map picture</b> loads OpenStreetMap street tiles or Esri World Imagery satellite tiles for the area on screen.',
    'These are open mapping services. They receive the search or pin needed for that job — not your habit list, and not an ongoing location history. That is a narrower request than embedding Google Maps or Apple Maps.'
  ]},
  {id:'privacy-weather-body', label:'Weather guidance', summary:'Forecast displays or guidance send home-city coordinates to Open-Meteo, plus only far saved-place pins needed on your plan.', body:[
    'In regular mode, travel weather is on by default; the other period displays are optional. When a forecast display is on or you create a weather profile, Tings sends your saved home-city coordinates to Open-Meteo. A planned item, busy time, or travel leg far from home sends that saved-place pin instead. Places near home reuse the home-city forecast. It does not send item names, schedules, logs, or live GPS.',
    'The seven-day forecast is cached for six hours. A shorter 15-minute forecast refreshes only while Tings is visible, a weather-linked planned item is active or starts within 90 minutes, and the cached day is not already decisive (for example 0% rain and snow remaining). Air-quality rules use CAMS ENSEMBLE data through Open-Meteo.',
    'Forecasts are guidance and may be wrong. Missing data never blocks planning.'
  ]},
  {id:'privacy-assistant-body', label:'Local assistant', summary:'Optional. Talks only to Ollama or LM Studio on this computer, or a laptop on your Wi-Fi or Tailscale. Off by default.', body:[
    'Local assistant sends a short catalog (item names, place labels, weather profile names) plus what you type to a model running on this computer. It does not send notes, logs, addresses, or coordinates, and it does not use a Tings cloud model.',
    'It talks only to Ollama or LM Studio on this computer, or on a laptop on this Wi-Fi or Tailscale, including from a personal clone on GitHub Pages. Clear requests (remind me, what is next, I already did it, change it, every Tuesday) are parsed here; Qwen calls tools to create or change an item with whatever details you said, including cadences like every two days or Tuesday, Wednesday and Friday. The top bar is the item you are changing. Nothing is saved until you confirm. Settings → local assistant has the first-time steps, including pasting the laptop URL on a phone.',
    'A debug switch in Settings (and on the chat) prints parse, tool calls, thinking, and context use in the thread and this browser’s console. That stays on this device; it does not send extra data off this computer.',
    'Turn it off anytime in Settings. The rest of Tings does not need it.'
  ]},
  {id:'privacy-others-body', label:'Other services', summary:'Icons and map/PDF libraries load from public CDNs. They do not receive your list.', body:[
    'Tabler icons (jsDelivr) and Leaflet (unpkg) draw buttons and the map. PDF import uses pdf.js in this browser; the file you pick is not uploaded.',
    'Naming a pasted App Store link asks Apple’s public listing for that app’s name. It receives only the numeric id already inside the link, and only when you paste one. Offline, you simply type the name yourself.',
    'Relative times such as sunrise and sunset are calculated on this device from your city. Calendar PDF import and backup files stay here unless you share the file yourself.'
  ]},
  {id:'privacy-feedback-body', label:'Send feedback', summary:'Optional. Opens a Google Form in your browser. Answers go to Google, not into Tings.', body:[
    'The send-feedback button on About opens a Google Form in a new browser tab. Tings does not receive those answers, and nothing from your list is attached.',
    'Google collects whatever you type in that form. Skip habit names, addresses, notes, and logs. You can leave the form without sending anything.',
    'Look for the cloud-up mark on that button.'
  ]}
];

const UI_LEAVE_HINTS = {
  agenda:{
    aria:'this sends an encrypted agenda off this device',
    body:'Publishing encrypts a limited today/tomorrow agenda on this phone, plus a clone-only library envelope when a personal clone is signed in, then stores those encrypted copies on a Cloudflare relay. Cloudflare cannot read item names. Full story: About → privacy.'
  },
  share:{
    aria:'this sends an encrypted item off this device',
    body:'Sharing encrypts this item on this phone, then stores that encrypted copy on a Cloudflare relay. The key is in the invitation link, not on the server. Full story: About → privacy.'
  },
  geocode:{
    aria:'this sends a search off this device',
    body:'Address search uses open mapping services (Photon and OpenStreetMap Nominatim). They receive the text you type for this lookup only — not your habit list. Full story: About → privacy.'
  },
  travel:{
    aria:'this sends place coordinates off this device',
    body:'Travel estimates use OSRM, an open routing service. It receives the two pins for this estimate — saved places, or live GPS plus a saved place when driving from here. You can type minutes yourself instead. Full story: About → privacy.'
  },
  map:{
    aria:'this loads map tiles from the web',
    body:'Street tiles come from OpenStreetMap; Satellite tiles come from Esri World Imagery. The request is the area on screen, not your habits or a location history. Full story: About → privacy.'
  },
  weather:{
    aria:'this sends forecast coordinates off this device',
    body:'Forecast displays and weather guidance send your saved home-city coordinates to Open-Meteo, plus only far-away saved-place pins needed on the plan. Live GPS, item names, and logs stay here. Full story: About → privacy.'
  },
  feedback:{
    aria:'this opens a Google Form off this device',
    body:'Send feedback opens a Google Form in your browser. Tings does not receive the answers, and nothing from your list is attached. Skip habit names, addresses, and logs. Full story: About → privacy.'
  }
};

function mountUiKit(){
  document.querySelectorAll('[data-ui-toggles]').forEach(host=>{
    const rows = UI_SETTING_TOGGLES[host.dataset.uiToggles] || [];
    host.innerHTML = rows.map(uiToggleHtml).join('');
  });
  document.querySelectorAll('[data-ui-priority]').forEach(host=>{
    host.innerHTML = uiPrioritySegHtml(host.dataset.uiPriority === 'add');
  });
  const privacy = document.querySelector('[data-ui-privacy-stack]');
  if(privacy)privacy.innerHTML = UI_PRIVACY_BLOCKS.map(uiAboutBlockHtml).join('');
  const policyLink = document.getElementById('privacy-policy-url');
  if(policyLink && typeof PRIVACY_POLICY_URL === 'string'){
    policyLink.href = PRIVACY_POLICY_URL;
    policyLink.hidden = !PRIVACY_POLICY_URL || PRIVACY_POLICY_URL.includes('YOUR_');
  }
  const disclosure = document.getElementById('background-location-disclosure-copy');
  if(disclosure && typeof BACKGROUND_LOCATION_DISCLOSURE === 'string')disclosure.textContent = BACKGROUND_LOCATION_DISCLOSURE;
  document.querySelectorAll('[data-ui-leave]').forEach((host,i)=>{
    const hint = UI_LEAVE_HINTS[host.dataset.uiLeave];
    if(!hint)return;
    host.innerHTML = uiLeaveBtnHtml({id:`leave-${host.dataset.uiLeave}-${i}-help`, aria:hint.aria, body:hint.body});
  });
  const allowed = $('detail-allowed-time-row');
  if(allowed && !allowed.querySelector('.time-endpoint'))allowed.innerHTML = uiTimePairHtml('allowed');
  const preferred = $('detail-preferred-time-row');
  if(preferred && !preferred.querySelector('.time-endpoint'))preferred.innerHTML = uiTimePairHtml('preferred');
  const detailLegend = document.querySelector('[data-ui-legend="detail"]');
  if(detailLegend)detailLegend.outerHTML = uiCalendarLegendHtml([['hit','done'],['warn','almost'],['miss','behind'],['plan','planned'],['agenda','on agenda']]);
  const overviewLegend = document.querySelector('[data-ui-legend="overview"]');
  if(overviewLegend)overviewLegend.outerHTML = uiCalendarLegendHtml([['hit','done'],['plan','planned'],['agenda','on agenda']],'overview-legend-compact','overview-legend');
  const filterHost = document.querySelector('[data-ui-filter-sheets]');
  if(filterHost){
    filterHost.outerHTML = uiFilterSheetHtml({
      wrapId:'home-filter-sheet', titleId:'home-filter-title', title:'filter home',
      summaryId:'home-filter-summary', closeId:'home-filter-close', closeAria:'close filters',
      groupsId:'home-filter-groups', resetId:'home-filter-reset', doneId:'home-filter-done'
    }) + uiFilterSheetHtml({
      wrapId:'calendar-filter-sheet', extraClass:'calendar-filter-sheet',
      titleId:'calendar-filter-title', title:'filter calendar',
      summaryId:'calendar-filter-summary', closeId:'calendar-filter-close', closeAria:'close calendar filters',
      groupsId:'calendar-filter-groups', resetId:'calendar-filter-reset', doneId:'calendar-filter-done'
    });
  }
}

mountUiKit();
