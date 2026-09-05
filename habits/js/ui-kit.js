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
// word changes, so an expression reads "Dawn · 30 · after · min".
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

function uiTimeExprHtml(prefix, second){
  const anchorCls = second ? 'time-anchor2' : 'time-anchor';
  const habitWrap = second ? 'time-habit-wrap2' : 'time-habit-wrap';
  const habitCls = second ? 'time-habit2' : 'time-habit';
  const offsetCls = second ? 'time-offset2' : 'time-offset';
  const dayCls = second ? 'time-day-next2' : 'time-day-next';
  const habitAria = second ? `${prefix} second habit` : `${prefix} anchor habit`;
  const offsetAria = second ? `${prefix} second offset minutes` : `${prefix} offset minutes`;
  const anchorAria = second ? `${prefix} second anchor` : `${prefix} anchor`;
  const clock = second ? `<input type="time" class="time-input time-fixed2" step="900" hidden aria-label="${prefix} clock time" />` : '';
  return `<select class="${anchorCls} mini-select" aria-label="${anchorAria}"></select>${clock}<span class="${habitWrap}" hidden><select class="${habitCls} mini-select" aria-label="${habitAria}"></select></span><input type="number" class="${offsetCls} mini-time-input" inputmode="numeric" placeholder="0" aria-label="${offsetAria}" /><button type="button" class="time-offset-sign-btn" tabindex="-1" data-sign="+" aria-label="minutes after">after</button><span class="time-offset-unit">min</span><button type="button" class="${dayCls} mini-text-btn" aria-pressed="false" title="use next day's prayer" aria-label="next day">next day</button>`;
}

function uiTimeEndpointHtml({field, inputId, prefix, endpointLabel, fixedClass = ''}){
  const which = endpointLabel === 'starts' ? 'start' : 'end';
  const fixedCls = fixedClass ? ` ${fixedClass}` : '';
  return `<div class="time-endpoint" data-field="${field}" data-endpoint-label="${endpointLabel}"><input type="time" class="time-input time-fixed${fixedCls}" id="${inputId}" step="900" aria-label="${prefix} time" /><div class="time-dynamic" hidden><div class="time-expr">${uiTimeExprHtml(prefix, false)}</div><select class="time-combine mini-select" aria-label="${prefix} combine"><option value="">just this time</option><option value="later">whichever is later</option><option value="earlier">whichever is earlier</option></select><div class="time-expr time-expr2" hidden>${uiTimeExprHtml(prefix, true)}</div><span class="time-resolved" aria-live="polite"></span></div>${uiTimeModeToggleHtml({which})}</div>`;
}

function uiTimePairHtml(kind){
  const allowed = kind === 'allowed';
  const startField = allowed ? 'allowedTimeStart' : 'preferredTimeStart';
  const endField = allowed ? 'allowedTimeEnd' : 'preferredTimeEnd';
  const startId = allowed ? 'detail-time-start' : 'detail-preferred-time-start';
  const endId = allowed ? 'detail-time-end' : 'detail-preferred-time-end';
  const startPrefix = allowed ? 'allowed start' : 'preferred start';
  const endPrefix = allowed ? 'allowed end' : 'preferred end';
  return uiTimeEndpointHtml({field:startField,inputId:startId,prefix:startPrefix,endpointLabel:'starts'})
    + '<span class="time-sep">—</span>'
    + uiTimeEndpointHtml({field:endField,inputId:endId,prefix:endPrefix,endpointLabel:'ends'});
}

const UI_SETTING_TOGGLES = {
  display:[
    {key:'minimalMode', title:'minimal mode', hint:'Show emoji, name, status line, and how often. Hide agenda times, trails, insights, and other extras. Does not change what’s due or how the planner works.'}
  ],
  home:[
    {key:'plansFirst', title:'bring planned items up', hint:'Items you’ve planned for soon move toward the top.'},
    {key:'showScheduledTasksInAgenda', title:'fixed-time tasks', hint:'Tasks with a set time show on today’s list.'},
    {key:'showDueTasksInAgenda', title:'tasks due today', hint:'Tasks due today fill open time on the list.'},
    {key:'showPlannedItemsInAgenda', title:'planned for today', hint:'Things you’ve planned for today fill open time.'},
    {key:'showDueHabitsInAgenda', title:'habits ready today', hint:'Habits that belong today fill open time.'},
    {key:'showWeekOnHome', title:'week by day', hint:'Show a day-by-day week instead of today / overdue / coming up.', extraClass:'settings-full-only'}
  ],
  reminders:[
    {key:'reminders', title:'remind me about commitments', hint:'Show a heads-up for dated tasks and fixed appointments. Rhythm habits stay quiet.'},
    {key:'pushDetailed', title:'include details in notifications', hint:'Include item names, topics, and places instead of generic notification text.'}
  ],
  cards:[
    {key:'showSnoozed', title:'show hidden habits', hint:'Show habits you’ve hidden, faded on home.'},
    {key:'showSampleOnCards', title:'show sample tag', hint:'Mark sample habits on the home list.', extraClass:'settings-full-only'},
    {key:'showPinnedOnCards', title:'show pinned', hint:'Show a pin mark on pinned items.', extraClass:'settings-full-only'},
    {key:'showTaskDateOnCards', title:'show task dates', hint:'Show due / someday / fixed-time marks on tasks.', extraClass:'settings-full-only'},
    {key:'showPlansOnCards', title:'show planned', hint:'Show when something is planned next.', extraClass:'settings-full-only'},
    {key:'showDayScheduleOnCards', title:'show which days', hint:'Show which weekdays or month days it runs.', extraClass:'settings-full-only'},
    {key:'showTimeWindowOnCards', title:'show time of day', hint:'Show the hours it’s allowed.', extraClass:'settings-full-only'},
    {key:'showSnoozedUntilOnCards', title:'show snooze label', hint:'Show when hidden items return.', extraClass:'settings-full-only'},
    {key:'showDurationOnCards', title:'show duration', hint:'Keep duration visible on the home list.', extraClass:'settings-full-only'},
    {key:'showRepetitionOnCards', title:'show how often', hint:'Show every N days or stop.', extraClass:'settings-full-only'},
    {key:'showFlexibilityOnCards', title:'show early window', hint:'Show how many days early it can be done.', extraClass:'settings-full-only'},
    {key:'showTopicsOnCards', title:'show topics', hint:'Show topic labels on the home list.', extraClass:'settings-full-only'},
    {key:'showLocationOnCards', title:'show place', hint:'Show the place on each item.', extraClass:'settings-full-only'},
    {key:'showStatusOnCards', title:'show progress', hint:'Show done / almost / behind (or new).', extraClass:'settings-full-only'},
    {key:'showEarlyOnCards', title:'show early', hint:'Show early when it helps a packed day.', extraClass:'settings-full-only'}
  ],
  cardsAfterTime:[
    {key:'showTrailOnCards', title:'show activity dots', hint:'Show the two-week dot history on each item.', extraClass:'settings-full-only'},
    {key:'minimalShowTrailOnCards', title:'show activity dots', hint:'Show the two-week dot history on each item.', extraClass:'settings-minimal-only'},
    {key:'showCueOnCards', title:'show status line', hint:'Show the one-line status like due today or on track.', pressed:true},
    {key:'showOrderPillsOnCards', title:'show agenda order marks', hint:'Show before / after, doing-now, and linked marks.', extraClass:'settings-full-only'},
    {key:'reachAssist', title:'easier reach', hint:'Pull and hold at the top to bring the first items down.'}
  ],
  defaults:[
    {key:'defaultBreakable', title:'allow splitting', hint:'New habits can be split across sessions.'}
  ],
  appearance:[
    {key:'compactMode', title:'compact mode', hint:'Tighter list so more items fit.'}
  ],
  prayer:[
    {key:'prayerIslamicNames', title:'Islamic prayer names', hint:'Show Fajr, Dhuhr, Asr, Maghrib, Isha instead of Dawn, Noon, Afternoon, Sunset, Night.'}
  ],
  advanced:[
    {key:'agendaOptimizer', title:'smarter packing', hint:'Takes longer, but packs tight days better and protects items with fewer open slots. Off = faster, simpler packing.'}
  ]
};

const UI_PRIVACY_BLOCKS = [
  {id:'privacy-here-body', label:'On this device', summary:'Habits, logs, places, and settings live in this browser. There is no Tings account.', body:[
    'Tings is a set of files in your browser. Your list is saved in this browser’s own storage (localStorage) on this phone or computer — not in a Tings inbox.',
    'The person who put this site online cannot see your habits, notes, addresses, or logs. Clearing this site’s data, switching browsers, or getting a new phone wipes the list unless you exported a backup (Settings → backup).',
    'Live location is used only to match a saved place. Coordinates are not stored and are not uploaded.'
  ]},
  {id:'privacy-why-body', label:'Why a website can still be private', summary:'Tings is open source. The hosted files are the app; planning runs here.', body:[
    'The site you open is the program. There is no Tings account and no hidden backend for your list. Anyone can read how it works.',
    'A few features below contact an outside service, each for a stated job. Nothing else is uploaded.'
  ]},
  {id:'privacy-display-body', label:'Shared display', summary:'Opt-in fridge or tablet view. Encrypted on this phone, then relayed by Cloudflare.', body:[
    'Shared display publishes a capped view of today and tomorrow. This phone encrypts that snapshot first, then a Cloudflare relay stores the encrypted copy so the paired display can fetch it.',
    'The paired display can submit only encrypted completion events for rows in its current plan; it cannot edit the plan or item details. Cloudflare can see that encrypted blobs exist, their sizes, and when they were updated, but cannot read item names, notes, places, or completion contents. The encryption key stays with your devices. Pairing is QR-only from inside Tings.',
    'Look for the cloud-up mark on that setting. Pause or revoke anytime in Settings.'
  ]},
  {id:'privacy-share-body', label:'Share item', summary:'Opt-in. Encrypted on this phone; the key rides in the invitation link.', body:[
    'Share item uses the same Cloudflare relay. The item is encrypted on this phone before it leaves. The key lives in the link itself, not on the server.',
    'Their progress stays separate from yours. Revoke from the item when you are done.'
  ]},
  {id:'privacy-maps-body', label:'Maps and places', summary:'Lookups use open mapping services, and only for that lookup.', body:[
    '<b>Address or city search</b> sends the text you type to Photon (Komoot) and Nominatim (OpenStreetMap).',
    '<b>Travel estimates</b> send the pins of two saved places to OSRM. You can type minutes yourself instead.',
    '<b>Map picture</b> loads OpenStreetMap tiles for the area on screen.',
    'These are open mapping services. They receive the search or pin needed for that job — not your habit list, and not an ongoing location history. That is a narrower request than embedding Google Maps or Apple Maps.'
  ]},
  {id:'privacy-weather-body', label:'Weather guidance', summary:'Opt-in profiles send home-city coordinates to Open-Meteo, plus any far-away place you attach to an item.', body:[
    'When you create a weather profile, Tings sends your saved home-city latitude and longitude to Open-Meteo. A habit can optionally use a saved place instead when that item happens far from home. It does not send habit names, schedules, logs, or live GPS location.',
    'The seven-day forecast is cached for six hours. A shorter 15-minute forecast refreshes only while Tings is visible, a weather-linked planned item is active or starts within 90 minutes, and the cached day is not already decisive (for example 0% rain and snow remaining). Air-quality rules use CAMS ENSEMBLE data through Open-Meteo.',
    'Forecasts are guidance and may be wrong. Missing data never blocks planning.'
  ]},
  {id:'privacy-others-body', label:'Other services', summary:'Icons and map/PDF libraries load from public CDNs. They do not receive your list.', body:[
    'Tabler icons (jsDelivr) and Leaflet (unpkg) draw buttons and the map. PDF import uses pdf.js in this browser; the file you pick is not uploaded.',
    'Naming a pasted App Store link asks Apple’s public listing for that app’s name. It receives only the numeric id already inside the link, and only when you paste one. Offline, you simply type the name yourself.',
    'Prayer times are calculated on this device from your city. Calendar PDF import and backup files stay here unless you share the file yourself.'
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
    body:'Publishing encrypts a limited today/tomorrow list on this phone, then stores that encrypted copy on a Cloudflare relay so a display can fetch it. Cloudflare cannot read item names. Full story: About → privacy.'
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
    body:'Travel estimates use OSRM, an open routing service. It receives the two place pins for this estimate only. You can type minutes yourself instead. Full story: About → privacy.'
  },
  map:{
    aria:'this loads map tiles from the web',
    body:'Map tiles come from OpenStreetMap. The request is the area on screen, not your habits, and not a location history. Full story: About → privacy.'
  },
  weather:{
    aria:'this sends forecast coordinates off this device',
    body:'Weather guidance sends your saved home-city coordinates to Open-Meteo, plus any far-away place you attach to an item. Habit names and logs stay here. Full story: About → privacy.'
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
