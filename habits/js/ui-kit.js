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

function uiFilterSheetHtml({wrapId, extraClass, titleId, title, summaryId, closeId, closeAria, groupsId, resetId, doneId}){
  const sheetCls = extraClass ? ` ${extraClass}` : '';
  return `<div class="sheet-wrap" id="${wrapId}"><div class="sheet home-filter-sheet${sheetCls}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="home-filter-sheet-head"><div><p class="sheet-title" id="${titleId}">${title}</p><p class="about-copy" id="${summaryId}">Choose a place or topic.</p></div><button type="button" class="icon-btn home-filter-close" id="${closeId}" aria-label="${closeAria}"><i class="ti ti-x" aria-hidden="true"></i></button></div><div class="home-filter-groups" id="${groupsId}"></div><div class="btn-row home-filter-sheet-actions"><button class="btn" type="button" id="${resetId}">reset</button><button class="btn primary" type="button" id="${doneId}">show results</button></div></div></div>`;
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
  return `<select class="${anchorCls} mini-select" aria-label="${anchorAria}"></select>${clock}<span class="${habitWrap}" hidden><select class="${habitCls} mini-select" aria-label="${habitAria}"></select></span><input type="number" class="${offsetCls} mini-time-input" inputmode="numeric" placeholder="0" aria-label="${offsetAria}" /><button type="button" class="time-offset-sign-btn" tabindex="-1" data-sign="+" aria-label="positive offset">+</button><span class="time-offset-unit">min</span><button type="button" class="${dayCls} mini-text-btn" aria-pressed="false" title="use next day's prayer" aria-label="next day">+1d</button>`;
}

function uiTimeEndpointHtml({field, inputId, prefix, endpointLabel}){
  const which = endpointLabel === 'starts' ? 'start' : 'end';
  return `<div class="time-endpoint" data-field="${field}" data-endpoint-label="${endpointLabel}"><input type="time" class="time-input time-fixed" id="${inputId}" step="900" aria-label="${prefix} time" /><div class="time-dynamic" hidden><div class="time-expr">${uiTimeExprHtml(prefix, false)}</div><select class="time-combine mini-select" aria-label="${prefix} combine"><option value="">just this</option><option value="later">later of…</option><option value="earlier">earlier of…</option></select><div class="time-expr time-expr2" hidden>${uiTimeExprHtml(prefix, true)}</div><span class="time-resolved" aria-live="polite"></span></div><button type="button" class="time-mode-toggle mini-text-btn" title="use a fixed or relative ${which} time" aria-label="switch ${which} between fixed and relative time"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i></button></div>`;
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
    {key:'showStatusOnCards', title:'show progress', hint:'Show done / almost / behind (or new).', extraClass:'settings-full-only', pressed:true},
    {key:'showEarlyOnCards', title:'show early', hint:'Show early when it helps a packed day.', extraClass:'settings-full-only', pressed:true}
  ],
  cardsAfterTime:[
    {key:'showTrailOnCards', title:'show activity dots', hint:'Show the two-week dot history on each item.', extraClass:'settings-full-only', pressed:true},
    {key:'showCueOnCards', title:'show status line', hint:'Show the one-line status like due today or on track.', pressed:true},
    {key:'showOrderPillsOnCards', title:'show agenda order marks', hint:'Show before / after, doing-now, and linked marks.', extraClass:'settings-full-only', pressed:true},
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

const UI_ABOUT_BLOCKS = [
  {id:'about-start-body', label:'Start', summary:'Sample habits to try a demo, or + to make a build, limit, stop, or task.', body:[
    'Blank home: tap the empty message to open sample habits. Add one demo or a few; tagged bulk adds can be removed from the same sheet.',
    '<b>+</b> creates a build (keep up), limit, stop, or task.'
  ]},
  {id:'about-log-body', label:'Log', summary:'Pulse the icon to log; tap the card for detail. Toasts offer quick next steps.', body:[
    'Pulse the icon (or double-tap the card) to log. Tap the card body to open detail: edit, history, and schedule.',
    'Toasts handle quick follow-ups without another screen.'
  ]},
  {id:'about-home-body', label:'Home', summary:'Today’s agenda: pinned and due float up. Swipe to pin, snooze, timer, or remove.', body:[
    'Home is today’s slice of the week plan, not a dump. Cards show when you’re on agenda.',
    'Swipe: pin, keep (samples), activity, timer. The other way: snooze or remove. Search and topic/place filters narrow the list.'
  ]},
  {id:'about-plan-body', label:'Plan', summary:'End-to-end week planning: busy blocks, open hours, places, then the agenda packs your list.', body:[
    'In Settings, set <b>busy times</b> (sleep, work, meals) and <b>open hours</b> so the week has real free gaps. Add places and travel so moves between Home / Gym / etc. cost time.',
    'Give habits windows, duration, and places in detail. Tings packs eligible items into the week; home and the week strip show that agenda. Optional smarter packing lives in Settings → advanced.'
  ]},
  {id:'about-calendar-body', label:'Calendar', summary:'Inspect the week: open hours, lightest days, coming up, and needs attention.', body:[
    'Companion view for the plan: open hours and lightest days, plus panes for coming up, needs attention, and recent.',
    'Tap a day or chip to dig in. Use it to see what the agenda already placed and where the week is tight.'
  ]},
  {id:'about-tune-body', label:'Tune', summary:'Detail sets windows, places, chunks, auto-log, timers. Settings for places, city, and backup.', body:[
    'Detail: time windows (including prayer anchors), places, breakable chunks, auto-log, and timer length.',
    'Settings: places/travel, city, busy times, open hours, card chrome, and backup/export.'
  ]}
];

function mountUiKit(){
  document.querySelectorAll('[data-ui-toggles]').forEach(host=>{
    const rows = UI_SETTING_TOGGLES[host.dataset.uiToggles] || [];
    host.innerHTML = rows.map(uiToggleHtml).join('');
  });
  document.querySelectorAll('[data-ui-priority]').forEach(host=>{
    host.innerHTML = uiPrioritySegHtml(host.dataset.uiPriority === 'add');
  });
  const about = document.querySelector('[data-ui-about-stack]');
  if(about)about.innerHTML = UI_ABOUT_BLOCKS.map(uiAboutBlockHtml).join('');
  const allowed = $('detail-allowed-time-row');
  if(allowed && !allowed.querySelector('.time-endpoint'))allowed.innerHTML = uiTimePairHtml('allowed');
  const preferred = $('detail-preferred-time-row');
  if(preferred && !preferred.querySelector('.time-endpoint'))preferred.innerHTML = uiTimePairHtml('preferred');
  const detailLegend = document.querySelector('[data-ui-legend="detail"]');
  if(detailLegend)detailLegend.outerHTML = uiCalendarLegendHtml([['hit','done'],['warn','almost'],['miss','behind'],['plan','planned']]);
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
