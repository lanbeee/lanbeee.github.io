// State-aware onboarding for the real Tings UI. Every step gates taps: locked
// steps require the highlighted control (outside taps warn), guided steps block
// outside taps silently while Next/Back/skip advance the tour.
(function(){
  'use strict';

  const KEYS = {
    essentials:'tings_coach_essentials_v2',
    advanced:'tings_coach_advanced_v2',
    install:'tings_coach_install_v2'
  };
  const ADVANCED_ORDER = [
    'aIntro','aFullMode','aHome','aActions','aDetailRead','aSchedule','aEffort','aIdentity','aLifecycle',
    'aSearch','aCalendar','aOverview','aOverviewTools','aSettingsDisplay','aBackup',
    'aCalendarImport','aOrganization','aBusy','aDefaults','aOptimizer','aFinish'
  ];
  const SETTINGS_STAGES = new Set([
    'aFullMode','aSettingsDisplay','aBackup','aCalendarImport','aOrganization','aBusy','aDefaults','aOptimizer'
  ]);
  const DETAIL_STAGES = new Set(['eDetailBasics','eDetailEffort','aDetailRead','aSchedule','aEffort','aIdentity','aLifecycle']);
  const ADD_STAGES = new Set(['eName','eKind','eRhythm','eTask','eSave']);
  const OVERVIEW_STAGES = new Set(['eOverview','aOverview','aOverviewTools']);
  // Sheets each stage group may keep open. Anything else that appears is closed
  // by reconcile(): the coach decides what page is on screen, wander included.
  const PICKER_SHEETS = ['location-picker-sheet','presence-picker-sheet','travel-edit-sheet','block-edit-sheet','location-permission-sheet'];
  const SHEET_ALLOWANCES = new Map([
    [ADD_STAGES,['add-sheet',...PICKER_SHEETS]],
    // Gate stages wait for the user to open their destination sheet themselves.
    [new Set(['eAdd']),['add-sheet',...PICKER_SHEETS]],
    [DETAIL_STAGES,['detail-sheet','order-link-sheet','doing-now-sheet','snooze-sheet','activity-sheet','value-log-sheet','day-logs-sheet',...PICKER_SHEETS]],
    [SETTINGS_STAGES,['settings-sheet',...PICKER_SHEETS]],
    [OVERVIEW_STAGES,['overview-sheet','day-logs-sheet','activity-sheet','calendar-filter-sheet','value-log-sheet','free-time-sheet','slipped-sheet','day-capacity-sheet']],
    [new Set(['eCalendar','aCalendar']),['overview-sheet']]
  ]);
  function allowedSheets(){
    for(const [stages,allowed] of SHEET_ALLOWANCES){if(stages.has(stage))return allowed;}
    return [];
  }
  const $ = id=>document.getElementById(id);
  let active = false;
  let mode = 'essentials';
  let stage = '';
  let interactive = false;
  let root = null;
  let bubble = null;
  let spotlight = null;
  let guards = [];
  let observer = null;
  let positionFrame = 0;
  let blockedTimer = 0;
  let initialCount = 0;
  let initialHids = new Set();
  let trackedHid = '';
  let overviewActivated = false;
  let skipArmTimer = 0;
  let installDismissed = false;

  function habits(){
    try{return typeof load === 'function' ? load() : [];}
    catch(_){return [];}
  }
  function settings(){
    try{return typeof loadSortSettings === 'function' ? loadSortSettings() : {};}
    catch(_){return {};}
  }
  function isMinimal(){
    try{return typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(settings().minimalMode);}
    catch(_){return true;}
  }
  function remember(value){
    try{localStorage.setItem(KEYS[mode],value);}
    catch(_){}
  }
  function hasBox(el){
    if(!el || !el.isConnected)return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function firstTarget(selectors){
    for(const selector of selectors || []){
      const found = [...document.querySelectorAll(selector)].find(hasBox);
      if(found)return found;
    }
    return null;
  }
  function sheetOpen(id){
    return Boolean($(id)?.classList.contains('open') || $('pane-detail')?.dataset.activeSheet === id);
  }
  function overviewShown(){
    if(sheetOpen('overview-sheet'))return true;
    return overviewActivated && hasBox(document.querySelector('#pane-overview .overview-sheet'));
  }
  function closeGuidedSheet(id){
    if(!sheetOpen(id) || typeof closeSheet !== 'function')return;
    try{closeSheet(id);}catch(_){}
  }
  function openSettings(){
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('overview-sheet');
    closeGuidedSheet('detail-sheet');
    if(typeof resetSettingsSheetState === 'function')resetSettingsSheetState();
    if(typeof syncSettingsControls === 'function')syncSettingsControls();
    if(typeof openSheet === 'function')openSheet('settings-sheet');
  }
  function trackedIndex(){
    const data = habits();
    const byId = trackedHid ? data.findIndex(h=>h && h.hid === trackedHid) : -1;
    return byId >= 0 ? byId : (data.length ? 0 : -1);
  }
  function addKind(){
    const on = document.querySelector('#type-seg .seg-opt.on');
    return on?.dataset.v === 'task' ? 'task' : 'habit';
  }
  // The install guide runs before the guided start for a first-run user in a
  // browser, and on demand from About; it never mixes into the essentials
  // order itself.
  function installPlatform(){
    try{
      if(typeof tingsInstallPlatform === 'function')return tingsInstallPlatform();
    }catch(_){}
    return 'desktop';
  }
  function installPromptReady(){
    try{
      return !installDismissed && typeof tingsInstallPromptAvailable === 'function' && tingsInstallPromptAvailable();
    }catch(_){return false;}
  }
  function essentialsOrder(){
    if(!interactive)return ['eIntro','eAddInfo','eHomeCard','eHomeGroups','eCalendar','eOverview','eFinish'];
    return [
      'eIntro','eAdd','eName','eKind',addKind() === 'task' ? 'eTask' : 'eRhythm','eSave',
      'eDetailBasics','eDetailEffort','eHomeCard','eLog','eHomeGroups','eCalendar','eOverview','eFinish'
    ];
  }
  function order(){
    if(mode === 'install')return ['iSteps','iNext'];
    if(mode !== 'advanced')return essentialsOrder();
    return isMinimal() ? ADVANCED_ORDER : ADVANCED_ORDER.filter(item=>item !== 'aFullMode');
  }
  function progress(label){
    const steps = order();
    const index = Math.max(0,steps.indexOf(stage));
    return `${index + 1} of ${steps.length} · ${label}`;
  }

  function essentialsModel(){
    const p = progress('guided start');
    if(stage === 'eIntro')return {
      progress:p,title:'Welcome to Tings',
      copy:interactive
        ? 'Start with one honest habit or one-off task. Tings keeps the plan and every log private on this device.'
        : 'A quick refresher on habits, tasks, rhythms, cards, and the minimal calendar. This replay will not change your data.',
      action:interactive ? 'Add my first Ting' : 'Start refresher',next:interactive ? 'eAdd' : 'eAddInfo'
    };
    if(stage === 'eAdd')return {
      progress:p,title:'Create from +',copy:'Tap the highlighted +. The coach will stay with the add screen and keep the next action clear.',
      target:['#open-add','#bar-open-add'],hint:'Tap +',locked:true
    };
    if(stage === 'eName')return {
      progress:p,title:'Name one real thing',copy:'Use a short action name, such as “Walk” or “Pay electricity bill.” Enter finishes this step without saving early.',
      target:['#ting-message'],hint:'Type a name',locked:true,keyboard:true,
      action:'Continue',command:'nameDone',disabled:!String($('ting-message')?.value || '').trim(),back:'eAdd'
    };
    if(stage === 'eKind')return {
      progress:p,title:'Habit or one-off task?',
      copy:'A habit repeats on a rhythm. A task is completed once and may have a due date or fixed time. Tap either choice.',
      target:['#type-seg'],hint:'Choose habit or task',locked:true,
      action:`Continue with ${addKind()}`,command:'kindDone',back:'eName'
    };
    if(stage === 'eRhythm')return {
      progress:p,title:'Set the rhythm',
      copy:'“3× in 7d” means three completions in any seven-day window. Use 1× in 1d for daily, or a wider window for flexibility.',
      target:['#target-slider-row'],action:'Continue',next:'eSave',back:'eKind',locked:true
    };
    if(stage === 'eTask')return {
      progress:p,title:'Date it only when useful',
      copy:'A blank date keeps this as a someday task. A date makes it due; adding a time makes it a fixed appointment.',
      target:['#task-due-row'],action:'Continue',next:'eSave',back:'eKind',locked:true
    };
    if(stage === 'eSave')return {
      progress:p,title:'Add it',copy:'That is enough to start. Tap add; Tings will save it on this device and open its details.',
      target:['#do-save'],hint:'Tap add',locked:true,back:addKind() === 'task' ? 'eTask' : 'eRhythm'
    };
    if(stage === 'eDetailBasics')return {
      progress:p,title:'Details keep the rhythm editable',
      copy:'You can change the rhythm, due date, or task time here later. Minimal mode keeps only the controls needed for everyday use.',
      target:['#detail-slider-row','#detail-due-row','[data-detail-nav="schedule"]'],action:'Next',next:'eDetailEffort'
    };
    if(stage === 'eDetailEffort')return {
      progress:p,title:'Tell Tings how long it takes',
      copy:'Duration helps the planner find room. Auto mark is optional; leave it blank when you prefer to log manually.',
      target:['#detail-minimal-effort','#detail-duration-field','#detail-auto-mark-field'],action:'Back to home',command:'essentialsHome',back:'eDetailBasics'
    };
    if(stage === 'eAddInfo')return {
      progress:p,title:'Habits repeat; tasks finish once',
      copy:'Use + for either. Habits use a times-in-days rhythm; tasks can stay someday, become due on a date, or become fixed with a time.',
      target:['#open-add','#bar-open-add'],action:'Next',next:'eHomeCard'
    };
    if(stage === 'eHomeCard')return {
      progress:p,title:'The card is the daily loop',
      copy:'Tap the colored icon to log or complete. Tap the card body to reopen details. The status line and rhythm update from your real entries.',
      target:[`.ting-card[data-real="${trackedIndex()}"]`,'.ting-card','#list','#empty'],action:'Next',next:interactive ? 'eLog' : 'eHomeGroups'
    };
    if(stage === 'eLog'){
      const idx = trackedIndex();
      const item = habits()[idx];
      const task = item?.type === 'task';
      const label = task ? 'complete' : 'log';
      return {
        progress:p,title:task ? 'Complete it with one tap' : 'Log it with one tap',
        copy:task
          ? 'This is the loop: tap the icon to complete the task you just made. A toast appears afterwards and can undo the tap if it was a mistake.'
          : 'This is the loop: tap the icon to log the Ting you just made. A toast appears afterwards and can undo the log if it was a mistake.',
        target:[`[data-pulse="${idx}"]`,'.ting-card [data-pulse]'],hint:`Tap to ${label}`,locked:true,
        later:'I’ll log later',next:'eHomeGroups',back:'eHomeCard'
      };
    }
    if(stage === 'eHomeGroups')return {
      progress:p,title:'Home answers “what now?”',
      copy:'Minimal mode keeps today, overdue, coming up, and the rest easy to scan. Logging may move a card as its rhythm changes.',
      target:['.section-header','#list'],action:'Show calendar',next:'eCalendar',back:interactive ? 'eLog' : 'eHomeCard'
    };
    if(stage === 'eCalendar')return {
      progress:p,title:'See beyond today',copy:'Tap Calendar to inspect dates, upcoming work, recent activity, and items needing attention.',
      target:['#open-overview','#bar-open-overview'],hint:'Tap calendar',locked:true,back:'eHomeGroups'
    };
    if(stage === 'eOverview')return {
      progress:p,title:'The calendar is your second view',
      copy:'Use it when you need context beyond Home. Tap a day or an item to inspect plans and activity without changing the rhythm.',
      target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],action:'Finish',next:'eFinish',back:'eCalendar'
    };
    return {
      progress:p,title:'You are ready to use Tings',
      copy:'Tap the Tings logo for samples, settings, help, the install guide, or either coach. The advanced coach is there when you want the full planning surface.',
      target:['#open-about','#bar-open-about'],action:'Done',command:'finish',back:'eOverview'
    };
  }

  // Install guide tour: the first thing a first-run browser user sees, and a
  // two-step tour from About on demand. The steps never lock to an in-page
  // control — the real action lives in browser chrome (Share button, menu, or
  // the native install sheet) — so the guards keep the app untouchable while
  // the numbered, iconified steps play out. iNext then hands the user to the
  // guided start, which is also where an already-installed (standalone) user
  // enters onboarding directly.
  function installModel(p){
    if(stage === 'iNext')return {
      progress:p,title:'Open Tings like a native app',
      copy:'From now on, launch Tings from its home-screen icon (or its own window) instead of the browser tab — full screen, own icon, no browser bar. Ready for a quick tour of the daily loop?',
      action:'Start guided start',command:'startEssentials',later:'skip for now',back:'iSteps'
    };
    if(installPlatform() !== 'ios' && installPromptReady())return {
      progress:p,title:'Put Tings on your home screen',
      copy:'Your browser can install Tings like a real app: its own icon, full screen, no browser bar. Everything you log stays on this device.',
      action:'Install',command:'installNow',later:'Not now',next:'iNext'
    };
    const manual = {
      ios:{
        title:'Add Tings to your home screen',
        copy:'You are viewing Tings in Safari right now. Give it a permanent place in three taps:',
        steps:[
          {icon:'ti ti-share-2',text:'Tap the <strong>Share</strong> button in Safari’s toolbar: the square with an arrow pointing up.'},
          {icon:'ti ti-square-rounded-plus',text:'Scroll down and tap <strong>Add to Home Screen</strong>.'},
          {icon:'ti ti-check',text:'Tap <strong>Add</strong>. Tings gets its own icon and opens full screen, without Safari.'}
        ]
      },
      android:{
        title:'Add Tings to your home screen',
        copy:'You are viewing Tings in the browser right now. Give it a permanent place:',
        steps:[
          {icon:'ti ti-dots-vertical',text:'Tap the browser <strong>menu</strong> — ⋮ in Chrome, at the top right.'},
          {icon:'ti ti-device-mobile-down',text:'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.'},
          {icon:'ti ti-check',text:'Confirm, and Tings gets its own icon — full screen, no browser bar.'}
        ]
      },
      desktop:{
        title:'Install Tings as an app',
        copy:'The browser can install Tings like a desktop app with its own window:',
        steps:[
          {icon:'ti ti-device-desktop-down',text:'Click the <strong>install icon</strong> at the right end of the address bar.'},
          {icon:'ti ti-dots-vertical',text:'…or open the browser <strong>menu</strong> (⋮) and choose <strong>Install page as app…</strong>'},
          {icon:'ti ti-window',text:'Tings opens in its own window, separate from your tabs.'}
        ]
      }
    };
    const m = manual[installPlatform()] || manual.desktop;
    return {progress:p,title:m.title,copy:m.copy,steps:m.steps,action:'Next',next:'iNext'};
  }

  function advancedModel(){
    const p = progress('advanced coach');
    const models = {
      aIntro:{title:'Learn the full planning surface',copy:'This pro tour covers the agenda, rich cards, detail controls, calendar analysis, schedule setup, and the settings that shape real capacity.',action:habits().length ? 'Start pro tour' : 'Create a Ting first',command:habits().length ? 'advancedStart' : 'startEssentials'},
      aFullMode:{title:'Reveal full mode',copy:'Minimal mode changes presentation only. Turn it off here; your habits, logs, and planner decisions stay intact.',target:['[data-setting-toggle="minimalMode"]'],hint:'Turn minimal mode off',locked:true,back:'aIntro'},
      aHome:{title:'Home is the live agenda',copy:'Rich cards can show placed time, status, two-week activity trail, duration, places, topics, priority cues, and whether the planner pulled something early.',target:['.ting-card','#list'],action:'Card actions',next:'aActions'},
      aActions:{title:'Act without losing context',copy:'Use card buttons or swipe for activity, pin, timer, snooze, and remove. Drag eligible agenda rows to order them; triple-tap a day header for the planner audit.',target:['.ting-card .card-actions','.ting-card','.section-header'],action:'Open full detail',command:'openAdvancedDetail',back:'aHome'},
      aDetailRead:{title:'Calendar and insight explain history',copy:'The first detail pages show entries, plans, completion patterns, and trend context. The pager controls at the bottom move across every full-mode page.',target:['[data-detail-nav="calendar"]','#detail-calendar'],action:'Scheduling controls',next:'aSchedule'},
      aSchedule:{title:'Define eligibility, preference, and order',copy:'Set rhythm, allowed days, preferred days, clock or prayer-anchored windows, places, and before/after links. Allowed is a hard boundary; preferred is a scoring preference.',target:['[data-detail-nav="schedule"]','#detail-allowed-time-row'],action:'Effort and splitting',next:'aEffort',back:'aDetailRead'},
      aEffort:{title:'Describe the work itself',copy:'Duration reserves time. Flexibility lets work move earlier. Breakable work can split into chunks; priority protects critical occurrences; timers and auto-mark handle sessions.',target:['[data-detail-nav="effort"]','#detail-effort-duration-grid'],action:'Identity and links',next:'aIdentity',back:'aSchedule'},
      aIdentity:{title:'Classify and connect the Ting',copy:'Identity holds type, build/limit/stop mode, priority, call or meeting links, topics, and places. These fields affect meaning, filtering, and planner policy.',target:['[data-detail-nav="identity"]','#detail-habit-message'],action:'Item actions',next:'aLifecycle',back:'aEffort'},
      aLifecycle:{title:'Control lifecycle and order',copy:'Actions holds pin, snooze, order state, export where available, and removal. Linked order can keep items before, after, adjacent, or on the same eligible day.',target:['[data-detail-nav="actions"]','#detail-pinned'],action:'Back to home',command:'advancedHome',back:'aIdentity'},
      aSearch:{title:'Search and filters scale with the list',copy:'Search appears once the list is large enough. Topic and place filters narrow what you see without changing what is due or how the planner schedules.',target:['#home-tag-filter','#bar-open-search','#open-search'],action:'Open calendar',next:'aCalendar'},
      aCalendar:{title:'Open the planning overview',copy:'Tap Calendar for month context, open time, upcoming work, recent activity, and anything that needs attention.',target:['#open-overview','#bar-open-overview'],hint:'Tap calendar',locked:true,back:'aSearch'},
      aOverview:{title:'Read week pressure',copy:'Open-time and light-day signals show capacity. Planned and fixed items appear beside habits that slipped, so you can distinguish a busy week from a broken rhythm.',target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],action:'Filters and drill-down',next:'aOverviewTools'},
      aOverviewTools:{title:'Drill down without rebuilding the plan',copy:'Range, topic, and place filters change the view only. Tap days and list items to inspect logs or plans; use Today to return to the current date.',target:['#overview-filter','#overview-pane-filter','#overview-list'],action:'Open pro settings',command:'advancedSettings',back:'aOverview'},
      aSettingsDisplay:{title:'Choose how Home presents the plan',copy:'Home settings control which planned, due, and fixed items appear. Card settings choose agenda time, trails, status, topics, places, and order marks.',target:['#settings-home-head'],action:'Backup and calendar data',next:'aBackup'},
      aBackup:{title:'Protect local-only data',copy:'There is no account or cloud sync. Export JSON backups regularly. Import replaces device data only after confirmation.',target:['#backup-export'],action:'Calendar import',next:'aCalendarImport',back:'aSettingsDisplay'},
      aCalendarImport:{title:'Bring fixed meetings into capacity',copy:'Calendar PDF import adds timed meetings. You can credit meeting minutes toward a habit and choose how all-day events become tasks.',target:['#settings-calendar-head'],action:'Topics, places, and travel',next:'aOrganization',back:'aBackup'},
      aOrganization:{title:'Model context and movement',copy:'Topics organize search and history. Locations add opening hours, travel modes, and optional live presence; prayer or sunrise windows use the saved city or place.',target:['#settings-locations-head'],action:'Protect busy time',next:'aBusy',back:'aCalendarImport'},
      aBusy:{title:'Busy times create the real gaps',copy:'Block sleep, work, meals, school, or commutes. The planner fits work around these clock blocks and travel instead of assuming the whole day is free.',target:['#settings-blocked-head'],action:'Defaults and appearance',next:'aDefaults',back:'aOrganization'},
      aDefaults:{title:'Make repeated setup cheaper',copy:'New-habit defaults cover type, rhythm, priority, duration, flexibility, splitting, and topics. Appearance controls density, font size, and theme.',target:['#settings-defaults-head'],action:'Planner engine',next:'aOptimizer',back:'aBusy'},
      aOptimizer:{title:'Choose speed or tighter packing',copy:'Smarter packing uses the optimizer for tighter days and scarce windows; Fast mode gives an immediate heuristic preview. Both obey the same hard scheduling rules.',target:['#settings-advanced-head'],action:'Finish',next:'aFinish',back:'aDefaults'},
      aFinish:{title:'Build constraints gradually',copy:'Start with duration and busy times, then add windows, places, links, or splitting only when they improve the plan. Both coaches remain available from About.',action:'Done',command:'finish',back:'aOptimizer'}
    };
    return {progress:p,...(models[stage] || models.aIntro)};
  }

  function model(){
    if(mode === 'install')return installModel(progress('install app'));
    return mode === 'advanced' ? advancedModel() : essentialsModel();
  }

  function mount(){
    root = document.createElement('div');
    root.className = 'tings-coach-root';
    root.id = 'tings-coach';
    root.setAttribute('role','presentation');
    root.innerHTML = `
      <div class="tings-coach-shade"></div>
      <div class="tings-coach-guard" data-coach-guard="top"></div>
      <div class="tings-coach-guard" data-coach-guard="right"></div>
      <div class="tings-coach-guard" data-coach-guard="bottom"></div>
      <div class="tings-coach-guard" data-coach-guard="left"></div>
      <div class="tings-coach-spotlight"></div>
      <section class="tings-coach-bubble" role="dialog" aria-modal="false" aria-labelledby="tings-coach-title" aria-describedby="tings-coach-copy"></section>`;
    document.body.appendChild(root);
    bubble = root.querySelector('.tings-coach-bubble');
    spotlight = root.querySelector('.tings-coach-spotlight');
    guards = [...root.querySelectorAll('.tings-coach-guard')];
    root.addEventListener('click',onCoachClick);
    root.addEventListener('pointerdown',onGuardPointer,true);
    root.addEventListener('wheel',onGuardWheel,{passive:false});
    document.addEventListener('click',onDocumentClick,true);
    document.addEventListener('keydown',onKeydown,true);
    document.addEventListener('input',onInput,true);
    window.addEventListener('resize',queuePosition);
    window.addEventListener('scroll',queuePosition,true);
    window.visualViewport?.addEventListener('resize',queuePosition);
    window.visualViewport?.addEventListener('scroll',queuePosition);
    observer = new MutationObserver(()=>{reconcile();queuePosition();});
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-pressed']});
  }

  function unmount(){
    active = false;
    observer?.disconnect();
    observer = null;
    cancelAnimationFrame(positionFrame);
    clearTimeout(blockedTimer);
    clearTimeout(skipArmTimer);
    document.removeEventListener('click',onDocumentClick,true);
    document.removeEventListener('keydown',onKeydown,true);
    document.removeEventListener('input',onInput,true);
    window.removeEventListener('resize',queuePosition);
    window.removeEventListener('scroll',queuePosition,true);
    window.visualViewport?.removeEventListener('resize',queuePosition);
    window.visualViewport?.removeEventListener('scroll',queuePosition);
    root?.remove();
    root = bubble = spotlight = null;
    guards = [];
  }

  function render(){
    if(!active || !bubble)return;
    const m = model();
    root.dataset.mode = mode;
    root.dataset.coachStage = stage;
    root.dataset.gated = String(m.roam !== true);
    root.dataset.locked = String(Boolean(m.locked));
    root.dataset.keyboard = String(Boolean(m.keyboard));
    bubble.innerHTML = `
      <div class="tings-coach-head">
        <span class="tings-coach-progress">${m.progress}</span>
        <button type="button" class="tings-coach-skip" data-coach-skip>skip</button>
      </div>
      <h2 class="tings-coach-title" id="tings-coach-title">${m.title}</h2>
      <p class="tings-coach-copy" id="tings-coach-copy">${m.copy}</p>
      ${m.steps?.length ? `<ol class="tings-coach-steps">${m.steps.map((step,index)=>`
        <li>
          <span class="tings-step-glyph"><span class="tings-step-num">${index + 1}</span>${step.icon ? `<i class="${step.icon}" aria-hidden="true"></i>` : ''}</span>
          <span class="tings-step-text">${step.text}</span>
        </li>`).join('')}</ol>` : ''}
      ${m.hint ? `<p class="tings-coach-hint">${m.hint}</p>` : ''}
      ${(m.back || m.action || m.later) ? `<div class="tings-coach-actions">
        ${m.back ? '<button type="button" class="tings-coach-action secondary" data-coach-back>Back</button>' : ''}
        ${m.later ? `<button type="button" class="tings-coach-action secondary" data-coach-later>${m.later}</button>` : ''}
        ${m.action ? `<button type="button" class="tings-coach-action" data-coach-primary${m.disabled ? ' disabled' : ''}>${m.action}</button>` : ''}
      </div>` : ''}`;
    queuePosition();
  }

  function setStage(next){
    if(!active || !next || next === stage)return;
    stage = next;
    prepareStage(next);
    render();
    revealTarget();
  }

  function prepareStage(next){
    if(next === 'aIntro'){
      closeGuidedSheet('settings-sheet');
      closeGuidedSheet('overview-sheet');
      return;
    }
    if(next === 'eAdd'){
      closeGuidedSheet('add-sheet');
      return;
    }
    if(next === 'eName'){
      setTimeout(()=>$('ting-message')?.focus({preventScroll:true}),70);
      return;
    }
    if(next === 'eDetailBasics')showDetailPage('schedule');
    if(next === 'eDetailEffort')showDetailPage('effort');
    if(next === 'eHomeCard' || next === 'eHomeGroups' || next === 'aHome' || next === 'aActions' || next === 'aSearch'){
      closeGuidedSheet('detail-sheet');
      closeGuidedSheet('overview-sheet');
      closeGuidedSheet('settings-sheet');
    }
    if(next === 'eCalendar' || next === 'aCalendar'){
      overviewActivated = false;
      closeGuidedSheet('overview-sheet');
    }
    if(next === 'iSteps')closeGuidedSheet('overview-sheet');
    if(next === 'aDetailRead')showDetailPage('calendar');
    if(next === 'aSchedule')showDetailPage('schedule');
    if(next === 'aEffort')showDetailPage('effort');
    if(next === 'aIdentity')showDetailPage('identity');
    if(next === 'aLifecycle')showDetailPage('actions');
    if(SETTINGS_STAGES.has(next)){
      if(!sheetOpen('settings-sheet'))openSettings();
      const settingsTargets = {
        aFullMode:'[data-setting-toggle="minimalMode"]',aSettingsDisplay:'#settings-home-head',aBackup:'#backup-export',
        aCalendarImport:'#settings-calendar-head',aOrganization:'#settings-locations-head',aBusy:'#settings-blocked-head',
        aDefaults:'#settings-defaults-head',aOptimizer:'#settings-advanced-head'
      };
      setTimeout(()=>showSettingsTarget(settingsTargets[next]),80);
    }
  }

  function showDetailPage(key){
    setTimeout(()=>{
      if(typeof scrollDetailToNav === 'function')scrollDetailToNav(key,'auto');
      setTimeout(queuePosition,90);
    },40);
  }

  function showSettingsTarget(selector){
    const target = document.querySelector(selector);
    if(!target)return;
    const head = target.matches('.settings-collapse-head') ? target : target.closest('.settings-collapsible')?.querySelector('.settings-collapse-head');
    document.querySelectorAll('#settings-sheet .settings-collapse-head').forEach(other=>{
      const body = $(other.dataset.collapseTarget);
      const opening = other === head;
      if(body)body.hidden = !opening;
      other.setAttribute('aria-expanded',String(opening));
    });
    target.scrollIntoView({block:'center',behavior:'auto'});
    setTimeout(queuePosition,80);
  }

  // A gated step is only legible when its target is on screen; keyboard steps
  // let the focused input drive the layout instead.
  function revealTarget(){
    const m = model();
    if(m.keyboard || m.roam === true || !m.target)return;
    const el = firstTarget(m.target);
    if(!el)return;
    const rect = el.getBoundingClientRect();
    const view = window.visualViewport;
    const top = view ? view.offsetTop : 0;
    const bottom = top + (view ? view.height : window.innerHeight);
    if(rect.bottom <= top || rect.top >= bottom){
      el.scrollIntoView({block:'center',behavior:'auto'});
      setTimeout(queuePosition,80);
    }
  }

  function finish(value = 'done'){
    remember(value);
    if(mode === 'advanced')closeGuidedSheet('settings-sheet');
    unmount();
  }

  function goBack(){
    const back = model().back;
    if(!back)return;
    if(back === 'eAdd'){
      if(typeof cancelAdd === 'function')cancelAdd();
      else closeGuidedSheet('add-sheet');
    }
    if((back === 'eCalendar' || back === 'aCalendar') && (sheetOpen('overview-sheet') || overviewActivated)){
      closeGuidedSheet('overview-sheet');
    }
    setStage(back);
  }

  function disarmSkip(){
    clearTimeout(skipArmTimer);
    skipArmTimer = 0;
    const btn = bubble?.querySelector('[data-coach-skip]');
    if(btn){
      btn.classList.remove('is-armed');
      delete btn.dataset.armed;
      btn.textContent = 'skip';
    }
  }

  function onCoachClick(event){
    if(event.target.closest('[data-coach-guard]')){blockTap();return;}
    const skip = event.target.closest('[data-coach-skip]');
    if(skip){
      // Ending a tour is a two-tap action so a stray tap cannot discard it.
      if(skip.dataset.armed){disarmSkip();finish('skipped');return;}
      skip.dataset.armed = '1';
      skip.classList.add('is-armed');
      skip.textContent = 'tap again to end';
      clearTimeout(skipArmTimer);
      skipArmTimer = setTimeout(disarmSkip,2500);
      return;
    }
    if(event.target.closest('[data-coach-back]')){goBack();return;}
    if(event.target.closest('[data-coach-later]')){
      const later = model().next;
      if(later)setStage(later);
      else finish('skipped');
      return;
    }
    const primary = event.target.closest('[data-coach-primary]');
    if(!primary || primary.disabled)return;
    const m = model();
    // Commands run before the plain next-hop: a step with both (the install
    // step) uses the command for its primary and next for the later escape.
    if(m.command === 'finish'){finish();return;}
    if(m.command === 'nameDone'){
      const input = $('ting-message');
      if(!String(input?.value || '').trim()){input?.focus();return;}
      input.blur();
      setTimeout(()=>setStage('eKind'),60);
      return;
    }
    if(m.command === 'kindDone'){setStage(addKind() === 'task' ? 'eTask' : 'eRhythm');return;}
    if(m.command === 'installNow'){
      // Show the browser's native install sheet; a declined or failed prompt
      // falls back to the manual per-platform steps on the same stage.
      Promise.resolve()
        .then(()=>typeof tingsPromptInstall === 'function' ? tingsPromptInstall() : false)
        .then(accepted=>{
          if(!active)return;
          if(accepted)setStage('iNext');
          else{installDismissed = true;render();}
        })
        .catch(()=>{
          if(active){installDismissed = true;render();}
        });
      return;
    }
    if(m.command === 'essentialsHome'){
      closeGuidedSheet('detail-sheet');
      setStage('eHomeCard');
      return;
    }
    if(m.command === 'startEssentials'){
      unmount();
      window.TingsCoach.start({kind:'essentials',force:true});
      return;
    }
    if(m.command === 'advancedStart'){
      setStage(isMinimal() ? 'aFullMode' : 'aHome');
      return;
    }
    if(m.command === 'openAdvancedDetail'){
      // Stage first, then open: reconcile() keys sheet allowances off the
      // current stage, so the sheet must never appear while a home stage
      // (empty allowlist) is still active.
      setStage('aDetailRead');
      const idx = trackedIndex();
      if(idx >= 0 && typeof openDetail === 'function')openDetail(idx);
      return;
    }
    if(m.command === 'advancedHome'){
      closeGuidedSheet('detail-sheet');
      setStage('aSearch');
      return;
    }
    if(m.command === 'advancedSettings'){
      closeGuidedSheet('overview-sheet');
      openSettings();
      setStage('aSettingsDisplay');
      return;
    }
    if(m.next)setStage(m.next);
  }

  function onGuardPointer(event){
    if(!event.target.closest('[data-coach-guard]'))return;
    event.preventDefault();
    event.stopPropagation();
    blockTap();
  }

  function onGuardWheel(event){
    if(!event.target.closest('[data-coach-guard]'))return;
    event.preventDefault();
  }

  // Locked (required-action) steps warn on outside taps; guided steps block
  // silently — Next on the bubble is the way forward there.
  function blockTap(){
    if(!bubble || !model().locked)return;
    const hint = bubble.querySelector('.tings-coach-hint');
    if(hint){
      hint.classList.add('is-warning');
      hint.textContent = 'Use the highlighted control';
    }
    bubble.classList.remove('is-blocked');
    void bubble.offsetWidth;
    bubble.classList.add('is-blocked');
    clearTimeout(blockedTimer);
    blockedTimer = setTimeout(()=>bubble?.classList.remove('is-blocked'),260);
  }

  function onDocumentClick(event){
    if(!active || event.target.closest('#tings-coach'))return;
    if(stage === 'eAdd' && event.target.closest('#open-add,#bar-open-add'))setTimeout(()=>setStage('eName'),50);
    if(stage === 'eKind'){
      const choice = event.target.closest('#type-seg [data-v]');
      if(choice)setTimeout(()=>setStage(choice.dataset.v === 'task' ? 'eTask' : 'eRhythm'),60);
    }
    if(stage === 'eSave' && event.target.closest('#do-save')){
      setTimeout(reconcile,90);
      setTimeout(reconcile,350);
    }
    if(stage === 'eLog' && event.target.closest('[data-pulse]'))setTimeout(()=>setStage('eHomeGroups'),80);
    if((stage === 'eCalendar' || stage === 'aCalendar') && event.target.closest('#open-overview,#bar-open-overview')){
      overviewActivated = true;
      setTimeout(()=>setStage(stage === 'eCalendar' ? 'eOverview' : 'aOverview'),80);
    }
    if(stage === 'aFullMode' && event.target.closest('[data-setting-toggle="minimalMode"]'))setTimeout(reconcile,120);
  }

  function onInput(event){
    if(!active || stage !== 'eName' || event.target !== $('ting-message'))return;
    render();
  }

  function onKeydown(event){
    if(!active)return;
    if(stage === 'eName' && event.target === $('ting-message') && event.key === 'Enter'){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(String(event.target.value || '').trim()){
        event.target.blur();
        setTimeout(()=>setStage('eKind'),60);
      }
      return;
    }
    if(event.key !== 'Escape')return;
    if(document.activeElement === $('ting-message')){
      $('ting-message').blur();
      queuePosition();
      return;
    }
    event.preventDefault();
    finish('skipped');
  }

  function reconcile(){
    if(!active)return;
    if(ADD_STAGES.has(stage) && !sheetOpen('add-sheet')){
      const data = habits();
      if(data.length > initialCount){
        const created = data.find(h=>h?.hid && !initialHids.has(h.hid)) || data[data.length - 1];
        trackedHid = created?.hid || '';
        if(sheetOpen('detail-sheet'))setStage('eDetailBasics');
      }else setStage('eAdd');
      return;
    }
    if(stage === 'eSave' && habits().length > initialCount && sheetOpen('detail-sheet')){
      const data = habits();
      const created = data.find(h=>h?.hid && !initialHids.has(h.hid)) || data[data.length - 1];
      trackedHid = created?.hid || '';
      setStage('eDetailBasics');
      return;
    }
    if(DETAIL_STAGES.has(stage) && !sheetOpen('detail-sheet')){
      setStage(mode === 'essentials' ? 'eHomeCard' : 'aSearch');
      return;
    }
    if(stage === 'aFullMode' && !isMinimal()){
      closeGuidedSheet('settings-sheet');
      setTimeout(()=>setStage('aHome'),70);
      return;
    }
    if(SETTINGS_STAGES.has(stage) && stage !== 'aFullMode' && !sheetOpen('settings-sheet')){
      setStage('aSearch');
      return;
    }
    if((stage === 'eOverview' || stage === 'aOverview' || stage === 'aOverviewTools') && !overviewShown()){
      setStage(stage === 'eOverview' ? 'eCalendar' : 'aCalendar');
    }
    closeUnexpectedSheets();
  }

  // The coach decides which page is on screen. Any sheet the current stage did
  // not ask for (stray tap during a guard gap, system navigation, async open)
  // is closed so the tour never explains a surface the user has left.
  function closeUnexpectedSheets(){
    if(typeof closeSheet !== 'function')return;
    const allowed = new Set(allowedSheets());
    document.querySelectorAll('.sheet-wrap.open').forEach(wrap=>{
      if(wrap.id && !allowed.has(wrap.id)){
        try{closeSheet(wrap.id);}catch(_){}
      }
    });
  }

  function queuePosition(){
    if(!active || positionFrame)return;
    positionFrame = requestAnimationFrame(()=>{
      positionFrame = 0;
      position();
    });
  }

  function setRect(el,left,top,width,height){
    el.style.left = `${Math.max(0,left)}px`;
    el.style.top = `${Math.max(0,top)}px`;
    el.style.width = `${Math.max(0,width)}px`;
    el.style.height = `${Math.max(0,height)}px`;
  }

  function clearTargetGeometry(){
    spotlight.style.cssText = '';
    guards.forEach(guard=>{guard.style.cssText = '';});
  }

  function rectsOverlap(a,b,gap = 0){
    return !(a.right + gap <= b.left || a.left >= b.right + gap || a.bottom + gap <= b.top || a.top >= b.bottom + gap);
  }

  function position(){
    if(!active || !bubble || !spotlight)return;
    const m = model();
    const target = firstTarget(m.target);
    const viewport = window.visualViewport;
    const view = {
      left:viewport ? viewport.offsetLeft : 0,
      top:viewport ? viewport.offsetTop : 0,
      width:viewport ? viewport.width : window.innerWidth,
      height:viewport ? viewport.height : window.innerHeight
    };
    view.right = view.left + view.width;
    view.bottom = view.top + view.height;
    const margin = 10;
    const gap = 14;
    bubble.style.maxHeight = `${Math.max(150,view.height - margin * 2)}px`;
    const raw = target?.getBoundingClientRect();
    const intersects = raw && raw.right > view.left && raw.left < view.right && raw.bottom > view.top && raw.top < view.bottom;
    root.dataset.hasTarget = String(Boolean(intersects));
    root.dataset.locked = String(Boolean(m.locked && intersects));
    if(!intersects){
      clearTargetGeometry();
      // No visible target: a gated step still blocks the whole surface (only
      // the bubble stays usable), so there is no open window between stages.
      if(m.roam !== true){
        const cover = Object.fromEntries(guards.map(guard=>[guard.dataset.coachGuard,guard]));
        setRect(cover.top,view.left,view.top,view.width,view.height);
        setRect(cover.right,view.right,view.top,0,0);
        setRect(cover.bottom,view.left,view.bottom,0,0);
        setRect(cover.left,view.left,view.top,0,0);
      }
      const br = bubble.getBoundingClientRect();
      bubble.style.left = `${Math.max(margin,view.left + (view.width - br.width) / 2)}px`;
      bubble.style.top = `${Math.max(view.top + margin,view.top + (view.height - br.height) / 2)}px`;
      return;
    }
    const pad = Math.min(8,Math.max(4,raw.width * .04));
    const hole = {
      left:Math.max(view.left,raw.left - pad),top:Math.max(view.top,raw.top - pad),
      right:Math.min(view.right,raw.right + pad),bottom:Math.min(view.bottom,raw.bottom + pad)
    };
    hole.width = Math.max(0,hole.right - hole.left);
    hole.height = Math.max(0,hole.bottom - hole.top);
    setRect(spotlight,hole.left,hole.top,hole.width,hole.height);
    const byName = Object.fromEntries(guards.map(guard=>[guard.dataset.coachGuard,guard]));
    setRect(byName.top,view.left,view.top,view.width,hole.top - view.top);
    setRect(byName.bottom,view.left,hole.bottom,view.width,view.bottom - hole.bottom);
    setRect(byName.left,view.left,hole.top,hole.left - view.left,hole.height);
    setRect(byName.right,hole.right,hole.top,view.right - hole.right,hole.height);

    const br = bubble.getBoundingClientRect();
    const clampLeft = value=>Math.min(view.right - br.width - margin,Math.max(view.left + margin,value));
    const candidates = [
      {left:clampLeft(hole.left + hole.width / 2 - br.width / 2),top:hole.bottom + gap},
      {left:clampLeft(hole.left + hole.width / 2 - br.width / 2),top:hole.top - br.height - gap},
      {left:clampLeft(view.left + (view.width - br.width) / 2),top:view.bottom - br.height - margin},
      {left:clampLeft(view.left + (view.width - br.width) / 2),top:view.top + margin}
    ];
    if(m.keyboard)candidates.unshift(candidates.splice(2,1)[0]);
    let chosen = candidates.find(candidate=>{
      const rect = {left:candidate.left,top:candidate.top,right:candidate.left + br.width,bottom:candidate.top + br.height};
      return rect.left >= view.left + margin && rect.right <= view.right - margin
        && rect.top >= view.top + margin && rect.bottom <= view.bottom - margin
        && !rectsOverlap(rect,hole,6);
    });
    if(!chosen){
      chosen = candidates.find(candidate=>candidate.top >= view.top + margin && candidate.top + br.height <= view.bottom - margin)
        || {left:clampLeft(view.left + (view.width - br.width) / 2),top:Math.max(view.top + margin,view.bottom - br.height - margin)};
    }
    bubble.style.left = `${chosen.left}px`;
    bubble.style.top = `${chosen.top}px`;
  }

  function start(options = {}){
    if(active)unmount();
    mode = options.kind === 'advanced' ? 'advanced' : options.kind === 'install' ? 'install' : 'essentials';
    interactive = mode === 'essentials' && habits().length === 0;
    initialCount = habits().length;
    initialHids = new Set(habits().map(h=>h?.hid).filter(Boolean));
    trackedHid = habits()[0]?.hid || '';
    overviewActivated = false;
    installDismissed = false;
    stage = mode === 'advanced' ? 'aIntro' : mode === 'install' ? 'iSteps' : 'eIntro';
    active = true;
    closeGuidedSheet('about-sheet');
    mount();
    render();
    return true;
  }

  window.TingsCoach = {
    start,
    stop:()=>finish('skipped'),
    state:()=>({active,mode,stage,interactive,locked:Boolean(model().locked)})
  };
})();
