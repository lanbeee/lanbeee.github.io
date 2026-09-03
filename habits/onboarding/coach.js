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
  // The advanced coach is a chapter menu, not one long march: each chapter is a
  // short standalone tour of one surface, taken in any order. Completion is
  // remembered per chapter so the menu can show what is left.
  const ADVANCED_CHAPTERS = [
    {id:'home',icon:'ti ti-home',title:'Home & cards',summary:'Full mode, rich cards, acting on cards, missed days, and open time.',stages:['aFullMode','aHome','aActions','aMissed','aOpenTime']},
    {id:'detail',icon:'ti ti-file-text',title:'The detail pages',summary:'Every control on a Ting’s own page, one at a time.',stages:['aDetailRead','aSchedule','aEffort','aIdentity','aLifecycle']},
    {id:'plan',icon:'ti ti-calendar',title:'Calendar & search',summary:'The calendar, week pressure, filters, and search.',stages:['aSearch','aCalendar','aOverview','aOverviewTools']},
    {id:'data',icon:'ti ti-database',title:'Backups & places',summary:'Backups, calendar import, places, travel, sharing, and cleanup.',stages:['aBackup','aCalendarImport','aOrganization','aShare','aCleanup']},
    {id:'tuning',icon:'ti ti-settings-2',title:'Time & tuning',summary:'Busy times, home display, defaults, and the planner engine.',stages:['aSettingsDisplay','aBusy','aDefaults','aOptimizer']}
  ];
  const SETTINGS_STAGES = new Set([
    'aFullMode','aSettingsDisplay','aBackup','aCalendarImport','aOrganization','aShare','aCleanup','aBusy','aDefaults','aOptimizer'
  ]);
  const DETAIL_STAGES = new Set(['eDetailBasics','eDetailEffort','eTaskDetail','aDetailRead','aSchedule','aEffort','aIdentity','aLifecycle']);
  const ADD_STAGES = new Set(['eName','eKind','eRhythm','eTask','eSave','eTaskName','eSaveTask']);
  const OVERVIEW_STAGES = new Set(['eOverview','eOverviewPast','eOverviewLog','eOverviewMissed','eOverviewFuture','eOverviewPlan','aOverview','aOverviewTools']);
  const OVERVIEW_DAY_STAGES = new Set(['eOverviewLog','eOverviewMissed','eOverviewPlan']);
  // Sheets each stage group may keep open. Anything else that appears is closed
  // by reconcile(): the coach decides what page is on screen, wander included.
  const PICKER_SHEETS = ['location-picker-sheet','presence-picker-sheet','travel-edit-sheet','block-edit-sheet','location-permission-sheet'];
  const SHEET_ALLOWANCES = new Map([
    [ADD_STAGES,['add-sheet',...PICKER_SHEETS]],
    // Gate stages wait for the user to open their destination sheet themselves.
    [new Set(['eAdd','eAddTask']),['add-sheet',...PICKER_SHEETS]],
    [DETAIL_STAGES,['detail-sheet','order-link-sheet','doing-now-sheet','snooze-sheet','activity-sheet','value-log-sheet','day-logs-sheet',...PICKER_SHEETS]],
    [SETTINGS_STAGES,['settings-sheet',...PICKER_SHEETS]],
    [OVERVIEW_STAGES,['overview-sheet','day-logs-sheet','activity-sheet','calendar-filter-sheet','value-log-sheet','free-time-sheet','slipped-sheet','day-capacity-sheet']],
    [new Set(['eCalendar','aCalendar']),['overview-sheet']],
    // Day-header pill steps: tapping the highlighted pill really opens its
    // sheet (missed list / open-time strip), so each stage allows exactly that.
    [new Set(['aMissed']),['slipped-sheet']],
    [new Set(['aOpenTime']),['free-time-sheet']],
    [new Set(['eSampleIntro','eSampleAdd']),['sample-habits-sheet','about-sheet']],
    [new Set(['eAbout']),['about-sheet']],
    [new Set(['eAboutMenu']),['about-sheet','settings-sheet','privacy-sheet','sample-habits-sheet']]
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
  let trackedTaskHid = '';
  let overviewActivated = false;
  let skipArmTimer = 0;
  let installDismissed = false;
  let chromeOverlay = false;

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
    // The advanced coach records per-chapter completion instead of one marker;
    // skipping the menu must not undo chapters already finished.
    if(mode === 'advanced')return;
    try{localStorage.setItem(KEYS[mode],value);}catch(_){}
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
    // Wide tiers keep the overview as a permanent pane — it is on screen
    // whether or not this tour opened it.
    return hasBox(document.querySelector('#pane-overview .overview-sheet'));
  }
  // Wide tiers have no calendar button at all: the overview is a permanent
  // pane there, so a locked "tap Calendar" step would be unsolvable. Narrow
  // tiers keep the step — the button is part of the nav, and the guided start
  // creates its first Ting before reaching the calendar chapter.
  function calendarStepApplies(){
    try{return typeof paneTierActive !== 'function' || !paneTierActive();}
    catch(_){return true;}
  }
  function closeGuidedSheet(id){
    if(!sheetOpen(id) || typeof closeSheet !== 'function')return;
    try{closeSheet(id);}catch(_){}
  }
  function openSettings(){
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('privacy-sheet');
    closeGuidedSheet('overview-sheet');
    closeGuidedSheet('detail-sheet');
    if(typeof resetSettingsSheetState === 'function')resetSettingsSheetState();
    if(typeof syncSettingsControls === 'function')syncSettingsControls();
    if(typeof openSheet === 'function')openSheet('settings-sheet');
  }
  function trackedIndex(){
    const data = habits();
    const hid = (stage === 'eTaskDetail' && trackedTaskHid) ? trackedTaskHid : trackedHid;
    const byId = hid ? data.findIndex(h=>h && h.hid === hid) : -1;
    return byId >= 0 ? byId : (data.length ? 0 : -1);
  }
  function addKind(){
    const on = document.querySelector('#type-seg .seg-opt.on');
    return on?.dataset.v === 'task' ? 'task' : 'habit';
  }
  function trackedItem(){
    return habits().find(h=>h && h.hid === trackedHid) || null;
  }
  function shouldTeachTask(){
    if(!interactive)return false;
    const item = trackedItem();
    if(item)return item.type !== 'task';
    return addKind() !== 'task';
  }
  function inTaskFollowup(){
    return ['eAddTask','eTaskName','eTask','eSaveTask'].includes(stage) && Boolean(trackedHid);
  }
  function newestUntracked(){
    const known = new Set([trackedHid,trackedTaskHid].filter(Boolean));
    return habits().find(h=>h?.hid && !initialHids.has(h.hid) && !known.has(h.hid)) || null;
  }
  function chooseAddType(type){
    const opt = document.querySelector(`#type-seg [data-v="${type}"]`);
    if(opt && !opt.classList.contains('on'))opt.click();
  }
  function closeGuidedDayLogs(){
    if(typeof closeDayLogsSheet === 'function'){
      try{closeDayLogsSheet({refreshOverview:true});}catch(_){}
      return;
    }
    closeGuidedSheet('day-logs-sheet');
  }
  function calDayFromEvent(event){
    const day = event.target.closest?.('.cal-day.pickable');
    if(!day || !day.closest('#overview-calendar'))return null;
    return day;
  }
  function afterCalendarNext(){
    if(shouldTeachTask())return 'eAddTaskIntro';
    return interactive ? 'eSampleIntro' : 'eAbout';
  }
  function openGuidedAbout(){
    closeGuidedSheet('sample-habits-sheet');
    closeGuidedSheet('overview-sheet');
    closeGuidedDayLogs();
    closeGuidedSheet('detail-sheet');
    closeGuidedSheet('add-sheet');
    closeGuidedSheet('settings-sheet');
    closeGuidedSheet('privacy-sheet');
    if(typeof resetAboutSheetState === 'function'){
      try{resetAboutSheetState();}catch(_){}
    }
    if(typeof syncInstallGuideVisibility === 'function'){
      try{syncInstallGuideVisibility();}catch(_){}
    }
    if(typeof openSheet === 'function'){
      try{openSheet('about-sheet');}catch(_){}
    }
  }
  function openGuidedSamples(){
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('overview-sheet');
    closeGuidedDayLogs();
    closeGuidedSheet('detail-sheet');
    closeGuidedSheet('add-sheet');
    if(typeof openSampleHabitsSheet === 'function'){
      try{openSampleHabitsSheet();}catch(_){}
    }
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
  // iOS Safari's compact toolbar keeps Share behind the address-bar ••• menu,
  // so the install guide always teaches ••• → Share → Add to Home Screen →
  // Add. Older iOS layouts without a ••• button (and any Safari toolbar
  // variant that shows Share directly) are covered by a one-sentence hedge in
  // the card copy rather than by branching the flow.
  // Docking: native UI paints above the web view (z-index cannot float over
  // Safari’s sheet), so the card lives on the uncovered edge — iPhone keeps
  // its address bar, ••• menu, and sheets at the bottom, so the card docks at
  // the top; iPad hangs its toolbar and popovers from the top, so the card
  // docks at the bottom. Device-fixed, so rotation never strands the card.
  function iosInstallDock(){
    if(installPlatform() !== 'ios')return '';
    return /iPhone|iPod/.test(navigator.userAgent || '') ? 'top' : 'bottom';
  }
  function coachSafe(side){
    if(!root)return 0;
    const n = parseFloat(getComputedStyle(root).getPropertyValue(`--coach-safe-${side}`));
    return Number.isFinite(n) ? n : 0;
  }
  function essentialsOrder(){
    const stages = interactive ? [
      'eIntro','eAdd','eName','eKind',addKind() === 'task' ? 'eTask' : 'eRhythm','eSave',
      'eDetailBasics','eDetailEffort','eHomeCard','eLog','eHomeGroups','eCalendar','eOverview',
      'eOverviewPast','eOverviewLog','eOverviewMissed','eOverviewFuture','eOverviewPlan',
      ...(shouldTeachTask() ? ['eAddTaskIntro','eAddTask','eTaskName','eTask','eSaveTask','eTaskDetail'] : []),
      'eSampleIntro','eSampleAdd','eAbout','eAboutMenu'
    ] : ['eIntro','eAddInfo','eHomeCard','eHomeGroups','eCalendar','eOverview','eAbout','eAboutMenu'];
    return calendarStepApplies() ? stages : stages.filter(item=>item !== 'eCalendar');
  }
  function chapterStages(chapter){
    let stages = !isMinimal() && chapter.stages.includes('aFullMode') ? chapter.stages.filter(item=>item !== 'aFullMode') : chapter.stages;
    if(!calendarStepApplies())stages = stages.filter(item=>item !== 'aCalendar');
    return stages;
  }
  function advancedChapter(){
    return ADVANCED_CHAPTERS.find(chapter=>chapter.stages.includes(stage)) || null;
  }
  // Per-chapter completion. The key historically held 'done'/'skipped' for the
  // whole serial tour; a legacy 'done' counts as every chapter seen.
  function advancedDoneMap(){
    let raw = null;
    try{raw = localStorage.getItem(KEYS.advanced);}catch(_){}
    if(raw === 'done')return Object.fromEntries(ADVANCED_CHAPTERS.map(chapter=>[chapter.id,'done']));
    if(!raw)return {};
    try{
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }catch(_){return {};}
  }
  function markChapterDone(id){
    const done = advancedDoneMap();
    done[id] = 'done';
    try{localStorage.setItem(KEYS.advanced,JSON.stringify(done));}catch(_){}
  }
  function order(){
    if(mode === 'install')return ['iSteps','iNext'];
    if(mode !== 'advanced')return essentialsOrder();
    if(stage === 'aIntro')return ['aIntro'];
    const chapter = advancedChapter();
    return chapter ? chapterStages(chapter) : ['aIntro'];
  }
  // Tours show a bar, never a "3 of 21" count — the number itself is what
  // makes a long tour feel heavy. Position stays available to screen readers
  // through the progressbar aria attributes.
  function progress(label){
    if(mode === 'advanced' && stage === 'aIntro'){
      const done = advancedDoneMap();
      const total = ADVANCED_CHAPTERS.length;
      const now = ADVANCED_CHAPTERS.filter(chapter=>done[chapter.id] === 'done').length;
      return {fraction:total ? now / total : 0,now,total:Math.max(total,1),label};
    }
    const steps = order();
    const index = Math.max(0,steps.indexOf(stage));
    return {fraction:steps.length ? (index + 1) / steps.length : 1,now:index + 1,total:steps.length,label};
  }

  function essentialsModel(){
    const p = progress('guided start');
    const calendarBtn = calendarStepApplies();
    if(stage === 'eIntro')return {
      progress:p,title:'Welcome to Tings',
      copy:interactive
        ? 'A Ting is a habit you repeat, or a task you finish once. Let’s add your first one together — everything stays on this device.'
        : 'A quick refresher on habits, tasks, cards, and the calendar. Nothing you tap here changes your data.',
      action:interactive ? 'Add my first Ting' : 'Start refresher',next:interactive ? 'eAdd' : 'eAddInfo'
    };
    if(stage === 'eAdd')return {
      progress:p,title:'Start with +',copy:'Tap the + button. We’ll add one together, step by step.',
      target:['#open-add','#bar-open-add'],hint:'Tap +',locked:true
    };
    if(stage === 'eName')return {
      progress:p,title:'Give it a name',copy:'Short and clear works best, like “Walk” or “Pay the bill.”',
      target:['#ting-message'],hint:'Type a name',locked:true,keyboard:true,
      action:'Continue',command:'nameDone',disabled:!String($('ting-message')?.value || '').trim(),back:'eAdd'
    };
    if(stage === 'eKind')return {
      progress:p,title:'Habit or task?',
      copy:'A habit repeats — walk, stretch, read. A task happens once, like paying a bill. Tap the one you’re adding.',
      target:['#type-seg'],hint:'Choose habit or task',locked:true,
      action:`Continue with ${addKind()}`,command:'kindDone',back:'eName'
    };
    if(stage === 'eRhythm')return {
      progress:p,title:'How often?',
      copy:'How many times, over how many days — say, 3 times in 7 days. A rough guess is fine; you can change it later.',
      target:['#target-slider-row'],action:'Continue',next:'eSave',back:'eKind',locked:true
    };
    if(stage === 'eTask')return {
      progress:p,title:'Add a date only if you need one',
      copy:'Leave the date blank if this can wait. Pick a day to set a deadline, and a time only if it must happen then.',
      target:['#task-due-row'],action:'Continue',next:inTaskFollowup() ? 'eSaveTask' : 'eSave',
      back:inTaskFollowup() ? 'eTaskName' : 'eKind',locked:true
    };
    if(stage === 'eSave')return {
      progress:p,title:'Add it',copy:'That’s all it needs. Tap add — Tings saves it and opens its page.',
      target:['#do-save'],hint:'Tap add',locked:true,back:addKind() === 'task' ? 'eTask' : 'eRhythm'
    };
    if(stage === 'eDetailBasics')return {
      progress:p,title:'This page is for later changes',
      copy:'How often it happens, its due date — all of it can change later. You don’t need every control today.',
      target:['#detail-slider-row','#detail-due-row','[data-detail-nav="schedule"]'],action:'Next',next:'eDetailEffort'
    };
    if(stage === 'eDetailEffort')return {
      progress:p,title:'How long does it take?',
      copy:'A rough guess helps Tings find room for it in your day. Everything else here can wait.',
      target:['#detail-minimal-effort','#detail-duration-field','#detail-auto-mark-field'],action:'Back to home',command:'essentialsHome',back:'eDetailBasics'
    };
    if(stage === 'eAddInfo')return {
      progress:p,title:'Habits repeat. Tasks finish once.',
      copy:'+ adds both. Habits run on a rhythm. Tasks can wait, carry a due date, or have a set time.',
      target:['#open-add','#bar-open-add'],action:'Next',next:'eHomeCard'
    };
    if(stage === 'eHomeCard')return {
      progress:p,title:'This is its card',
      copy:'Every Ting gets a card here. Tap the color icon to log it or mark it done — tap the rest of the card to open its page.',
      target:[`.ting-card[data-real="${trackedIndex()}"]`,'.ting-card','#list','#empty'],action:'Next',next:interactive ? 'eLog' : 'eHomeGroups'
    };
    if(stage === 'eLog'){
      const idx = trackedIndex();
      const item = habits()[idx];
      const task = item?.type === 'task';
      const label = task ? 'complete' : 'log';
      return {
        progress:p,title:task ? 'Mark it done with one tap' : 'Log it with one tap',
        copy:task
          ? 'Tap the icon to finish this task. If that was a mistake, you can undo.'
          : 'Tap the icon to log it for today. If that was a mistake, you can undo.',
        target:[`[data-pulse="${idx}"]`,'.ting-card [data-pulse]'],hint:`Tap to ${label}`,locked:true,
        later:'I’ll log later',next:'eHomeGroups',back:'eHomeCard'
      };
    }
    if(stage === 'eHomeGroups')return {
      progress:p,title:'Home shows what to do now',
      copy:'Your list is grouped — what’s due today, what’s late, and what’s coming up.',
      target:['.section-header','#list'],
      action:calendarBtn ? 'Show calendar' : 'Next',
      next:calendarBtn ? 'eCalendar' : 'eOverview',
      back:interactive ? 'eLog' : 'eHomeCard'
    };
    if(stage === 'eCalendar')return {
      progress:p,title:'See other days too',copy:'Tap Calendar to look back at past days, or ahead at what’s coming.',
      target:['#open-overview','#bar-open-overview'],hint:'Tap calendar',locked:true,back:'eHomeGroups'
    };
    if(stage === 'eOverview')return {
      progress:p,title:'The calendar is the bigger picture',
      copy:interactive
        ? 'Tap any day to open it. Past days show what you did; future days are for planning.'
        : 'Tap a day to see what happened, catch up a missed log, or plan something ahead.',
      target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],
      action:'Next',next:interactive ? 'eOverviewPast' : 'eAbout',back:calendarBtn ? 'eCalendar' : 'eHomeGroups'
    };
    if(stage === 'eOverviewPast')return {
      progress:p,title:'Look at a past day',
      copy:'Tap any day before today. You’ll see what was done — and you can add a missed log.',
      target:['#overview-calendar'],hint:'Tap a past day',locked:true,later:'Skip',next:'eOverviewFuture',back:'eOverview',pinBottom:true
    };
    if(stage === 'eOverviewLog')return {
      progress:p,title:'Catch up a missed day',
      copy:'Forgot to log something? Tap Log a missed day — it works even on days with nothing planned.',
      target:['#day-logs-log'],hint:'Tap Log a missed day',locked:true,later:'Skip',next:'eOverviewFuture',back:'eOverviewPast'
    };
    if(stage === 'eOverviewMissed')return {
      progress:p,title:'Save the missed log',
      copy:'Tap log it to save this missed day — or tap Next to skip.',
      target:['#day-log-entry-save'],hint:'Tap log it',action:'Next',next:'eOverviewFuture',back:'eOverviewLog'
    };
    if(stage === 'eOverviewFuture')return {
      progress:p,title:'Look at a coming day',
      copy:'Now tap a day after today. Future days are for plans, not for logging the past.',
      target:['#overview-calendar'],hint:'Tap a coming day',locked:true,later:'Skip',next:afterCalendarNext(),back:'eOverview',pinBottom:true
    };
    if(stage === 'eOverviewPlan')return {
      progress:p,title:'Plan something ahead',
      copy:'Tap Plan something to put an item on this day — with a time, if you want one.',
      target:['#day-logs-plan'],hint:'Tap Plan something',locked:true,later:'Skip',next:afterCalendarNext(),back:'eOverviewFuture'
    };
    if(stage === 'eAddTaskIntro')return {
      progress:p,title:'Now add a task',
      copy:'You’ve made a habit. A task is the once-only kind — a bill to pay, a call to make. Let’s add one.',
      action:'Add a task',next:'eAddTask',back:'eOverview'
    };
    if(stage === 'eAddTask')return {
      progress:p,title:'Tap + again',copy:'Same button, different kind — this time we’ll make a one-time task.',
      target:['#open-add','#bar-open-add'],hint:'Tap +',locked:true,back:'eAddTaskIntro'
    };
    if(stage === 'eTaskName')return {
      progress:p,title:'Name the task',copy:'Something specific, like “Call the dentist” or “Pay rent.”',
      target:['#ting-message'],hint:'Type a name',locked:true,keyboard:true,
      action:'Continue',command:'nameDone',disabled:!String($('ting-message')?.value || '').trim(),back:'eAddTask'
    };
    if(stage === 'eSaveTask')return {
      progress:p,title:'Add the task',copy:'Tap add. Its page opens, just like the habit’s did.',
      target:['#do-save'],hint:'Tap add',locked:true,back:'eTask'
    };
    if(stage === 'eTaskDetail')return {
      progress:p,title:'This is the task page',
      copy:'A due date and time can wait until you need them. When the work is done, tap the icon and it’s finished.',
      target:['#detail-due-row','#detail-slider-row','[data-detail-nav="schedule"]'],action:'Next',next:'eSampleIntro',back:'eAddTaskIntro'
    };
    if(stage === 'eSampleIntro')return {
      progress:p,title:'Try a ready-made habit',
      copy:'Samples are starter habits you can add in one tap — and remove just as easily. Add one to see a fuller day.',
      action:'See samples',command:'openSamples',later:'Not now',next:'eAbout',back:shouldTeachTask() ? 'eAddTaskIntro' : 'eOverview'
    };
    if(stage === 'eSampleAdd')return {
      progress:p,title:'Add drink water',
      copy:'Tap add on drink water — a simple daily habit. Samples can be removed anytime from the same place.',
      target:['#sample-habits-preview [data-add-sample="sample-feature-water"]','#sample-habits-preview [data-add-sample]:not([disabled])'],
      hint:'Tap add',locked:true,later:'Not now',next:'eAbout',back:'eSampleIntro'
    };
    if(stage === 'eAbout')return {
      progress:p,title:'Find settings here',
      copy:'Tap the Tings name at the top. Settings, help, samples, and privacy all live there.',
      target:['#open-about','#bar-open-about'],hint:'Tap Tings',locked:true,later:'Skip',next:'eAboutMenu',
      back:interactive ? 'eSampleIntro' : 'eOverview'
    };
    if(stage === 'eAboutMenu')return {
      progress:p,title:'Settings, help, and more',
      copy:'Settings is this button — backups, busy times, and how the app looks. Help, samples, and privacy are on this same page. Tap the Tings name anytime to get back here.',
      target:['#open-settings','.about-actions'],action:'Done',command:'finish',back:'eAbout'
    };
    return {
      progress:p,title:'You’re ready',
      copy:'Tap the Tings name anytime for settings, help, samples, and privacy.',
      target:['#open-about','#bar-open-about'],action:'Done',command:'finish',
      back:interactive ? 'eSampleIntro' : 'eOverview'
    };
  }

  // Install guide tour: the first thing a first-run browser user sees, and a
  // two-step tour from About on demand. The shortest path always wins: a
  // captured beforeinstallprompt gesture renders a one-tap native Install
  // button (swapped in live if the gesture arrives mid-tour), and the
  // per-platform manual steps are only the fallback for browsers without a
  // gesture. The steps never lock to an in-page
  // control — the real action lives in browser chrome (••• menu, share sheet,
  // or the native install sheet) — so the guards keep the app untouchable
  // while the steps play out. Mobile rails quote each control exactly as the
  // browser labels it (••• / Share / Add to Home Screen / Add). Copy stays
  // one short locator sentence so the rail sits in the uncovered strip —
  // Safari’s sheet covers a tall paragraph, which is why a long card looks
  // like the instructions vanished. iNext then shows a large close-this-tab /
  // open-the-app visual so the user leaves the browser; staying in the tab is
  // the escape into the guided start. An already-installed (standalone) user
  // skips this tour and enters onboarding directly.
  function installModel(p){
    if(stage === 'iNext'){
      const phone = installPlatform() !== 'desktop';
      return {
        progress:p,title:'Close this tab',
        copy:phone
          ? 'This browser page is not the app. Close this tab, then tap <strong>Tings</strong> on your Home Screen.'
          : 'This browser tab is not the app. Close it, then open <strong>Tings</strong> from its own window — or pin its icon to the dock or Start menu.',
        handoff:{
          leave:'Close this tab',
          open:'Open Tings',
          openWhere:phone ? 'Home Screen' : 'own window'
        },
        action:'Got it',command:'finish',later:'Stay in this tab',laterCommand:'startEssentials',back:'iSteps'
      };
    }
    if(installPlatform() !== 'ios' && installPromptReady()){
      const phone = installPlatform() === 'android';
      return {
        progress:p,
        title:phone ? 'Put Tings on your home screen' : 'Install Tings as an app',
        copy:phone
          ? 'Your browser can install Tings like a real app: its own icon, full screen, no browser bar. Everything you log stays on this device.'
          : 'Your browser can install Tings as a desktop app with its own window and taskbar icon. Everything you log stays on this device.',
        action:'Install',command:'installNow',later:'Not now',next:'iNext'
      };
    }
    const iosDock = iosInstallDock();
    const manual = {
      ios:{
        title:'Add Tings to your home screen',
        copy:'Tap <strong>•••</strong> at the right of Safari’s address bar. No •••? Tap <strong>Share</strong> in the toolbar instead.',
        compact:true,
        dock:iosDock,
        overlayHint:'<strong>Share</strong> → <strong>Add to Home Screen</strong> → <strong>Add</strong>. Leave <strong>Open as Web App</strong> on.',
        steps:[
          {icon:'ti ti-dots',label:'•••'},
          {icon:'ti ti-share-2',label:'Share'},
          {icon:'ti ti-square-rounded-plus',label:'Add to Home Screen'},
          {icon:'ti ti-check',label:'Add'}
        ]
      },
      android:{
        title:'Add Tings to your home screen',
        copy:'Tap <strong>⋮</strong> at the top right, then <strong>Install app</strong>. Samsung Internet: ≡ at the bottom right.',
        compact:true,
        dock:'bottom',
        overlayHint:'<strong>Install app</strong> → confirm.',
        steps:[
          {icon:'ti ti-dots-vertical',label:'⋮ menu'},
          {icon:'ti ti-device-mobile-down',label:'Install app'},
          {icon:'ti ti-check',label:'Confirm'}
        ]
      },
      desktop:{
        title:'Install Tings as an app',
        copy:'The browser can install Tings like a desktop app with its own window:',
        steps:[
          {icon:'ti ti-device-desktop-down',text:'Click the <strong>install icon</strong> — a little screen with a down arrow — at the right end of the address bar.'},
          {icon:'ti ti-dots-vertical',text:'No icon? Open the <strong>menu</strong> (⋮) → <strong>Cast, save, and share</strong> → <strong>Install page as app…</strong> In Edge: ⋯ → <strong>Apps</strong> → <strong>Install this site as an app</strong>.'},
          {icon:'ti ti-window',text:'Tings then opens in its own window with its own taskbar entry, separate from your tabs.'}
        ]
      }
    };
    const m = manual[installPlatform()] || manual.desktop;
    return {
      progress:p,title:m.title,copy:m.copy,steps:m.steps,action:'Next',next:'iNext',
      compact:Boolean(m.compact),dock:m.dock || '',overlayHint:m.overlayHint || ''
    };
  }

  function advancedModel(){
    const p = progress('advanced coach');
    const calendarBtn = calendarStepApplies();
    if(stage === 'aIntro' || !advancedChapter()){
      const hasHabits = habits().length > 0;
      const done = advancedDoneMap();
      const chapters = hasHabits ? ADVANCED_CHAPTERS.map(chapter=>({...chapter,done:done[chapter.id] === 'done'})) : [];
      const doneCount = chapters.filter(chapter=>chapter.done).length;
      return {
        progress:p,
        title:'Go beyond the basics',
        copy:!hasHabits
          ? 'These chapters tour your real Tings and settings — add your first Ting, then come back.'
          : doneCount === chapters.length
            ? 'You’ve covered every chapter. Replay one anytime, or tap Close.'
            : 'Five short chapters, any order — each one tours a different part of the app.',
        chapters,
        note:hasHabits ? 'Tip: for good plans, set each Ting’s duration and your busy times first. Add windows, places, and links only when you need them.' : '',
        action:hasHabits ? 'Close' : 'Create a Ting first',
        command:hasHabits ? 'finish' : 'startEssentials'
      };
    }
    const models = {
      aFullMode:{title:'Reveal full mode',copy:'Minimal mode only hides things — your habits, logs, and plans stay untouched. Turn it off to see every card and control; you can switch back anytime.',target:['[data-setting-toggle="minimalMode"]'],hint:'Turn minimal mode off',locked:true,back:'aIntro'},
      aHome:{title:'Home is the live agenda',copy:'Cards can show the planned time, status, a two-week trail of logs, duration, places, topics — even when the planner pulled something early. How much each card shows is yours to choose in Settings.',target:['.ting-card','#list'],action:'Next',next:'aActions',back:'aIntro'},
      aActions:{title:'Act right on the card',copy:'Swipe a card — or use its buttons — for the timer, snooze, pin, activity, and remove. Drag planned rows to reorder a day, drag one to the very top to do it now, and triple-tap a day header to audit why the plan looks as it does.',target:['.ting-card .card-actions','.ting-card','.section-header'],action:'Next',next:'aMissed',back:'aHome'},
      aMissed:{title:'Nothing slips away quietly',copy:'A day header counts what slipped. Tap the missed count to see it all — log one with a tap, or open it to reschedule or adjust its rhythm.',target:['.dropped-pill','.section-header'],action:'Next',next:'aOpenTime',back:'aActions'},
      aOpenTime:{title:'Use the room a day has left',copy:'The open-time count shows spare minutes. Tap it for a strip of the day — busy and open blocks — and tap an open stretch to plan something straight into it.',target:['.free-pill','.section-header'],action:'Finish chapter',command:'chapterDone',back:'aMissed'},
      aDetailRead:{title:'Every Ting keeps its own history',copy:'This first page shows what you logged, what was planned, and how it’s trending. The dots at the bottom page through the rest — schedule, effort, identity, and actions.',target:['[data-detail-nav="calendar"]','#detail-calendar'],action:'Next',next:'aSchedule',back:'aIntro'},
      aSchedule:{title:'Tell it when it can happen',copy:'Rhythm, allowed and preferred days, time windows — fixed to the clock, a prayer time, or another Ting — places, extra specific time-and-place rows, and what comes before or after it. Allowed days are hard limits; preferred days just nudge the plan.',target:['[data-detail-nav="schedule"]','#detail-allowed-time-row'],action:'Next',next:'aEffort',back:'aDetailRead'},
      aEffort:{title:'Tell it how long the work takes',copy:'Duration reserves the time. Flexibility lets it start early; breakable lets it split into chunks. Priority protects what can’t slip, timers or auto-mark can run a session, and value tracking records a number with each log — reps, pages, weight.',target:['[data-detail-nav="effort"]','#detail-effort-duration-grid'],action:'Next',next:'aIdentity',back:'aSchedule'},
      aIdentity:{title:'Say what kind of Ting it is',copy:'Name, emoji, habit or task — and for habits, the kind: build to keep up, limit to cut back, stop to quit. Priority and topics live here too.',target:['[data-detail-nav="identity"]','#detail-habit-message'],action:'Next',next:'aLifecycle',back:'aEffort'},
      aLifecycle:{title:'Pin, link, and clean up',copy:'The actions page pins a Ting above auto order, and holds app and call links — double-tapping the card opens the starred one — plus snooze, export to calendar, and remove. Order links keep two Tings before, after, or next to each other.',target:['[data-detail-nav="actions"]','#detail-pinned'],action:'Finish chapter',command:'chapterDone',back:'aIdentity'},
      aSearch:{title:'Search and filters',copy:'Search appears once your list grows, and topic or place filters narrow the view. Neither changes what is due or how the day is planned.',target:['#home-tag-filter','#bar-open-search','#open-search'],action:'Next',next:calendarBtn ? 'aCalendar' : 'aOverview',back:'aIntro'},
      aCalendar:{title:'The calendar is the bigger picture',copy:'Tap Calendar to see the month, where the week has room, upcoming work, and anything that needs attention.',target:['#open-overview','#bar-open-overview'],hint:'Tap calendar',locked:true,back:'aSearch'},
      aOverview:{title:'Read the week at a glance',copy:'Open time and light days show where the week has room, while planned and set-time items sit beside habits that slipped — a busy week looks different from a slipping habit.',target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],action:'Next',next:'aOverviewTools',back:calendarBtn ? 'aCalendar' : 'aSearch'},
      aOverviewTools:{title:'Filters change the view, never the plan',copy:'Range, topic, and place filters change only what you see. Tap a day or a row to inspect its logs and plans; Today jumps back to now.',target:['#overview-filter','#overview-pane-filter','#overview-list'],action:'Finish chapter',command:'chapterDone',back:'aOverview'},
      aBackup:{title:'Your data lives on this device',copy:'There’s no account and no cloud sync, so backups are the safety net. Export one regularly — importing a backup replaces what’s here, and only after you confirm.',target:['#backup-export'],action:'Next',next:'aCalendarImport',back:'aIntro'},
      aCalendarImport:{title:'Import your calendar',copy:'A calendar PDF becomes timed blocks the planner works around. Meeting minutes can count toward a habit, and all-day events can become tasks.',target:['#settings-calendar-head'],action:'Next',next:'aOrganization',back:'aBackup'},
      aOrganization:{title:'Places and topics',copy:'Topics keep search and history tidy. Locations carry opening hours and travel time, and can follow where you are — or set today’s starting place yourself from Home. Prayer and sunrise windows use your saved city, tuned just below.',target:['#settings-locations-head'],action:'Next',next:'aShare',back:'aCalendarImport'},
      aShare:{title:'Share a screen, or share one Ting',copy:'Create a display feed here and pair a fridge or tablet with its QR code — today and tomorrow, only what you approve, paused or revoked anytime. The share item button on a Ting’s actions page invites one person instead: they track their own progress, encrypted end to end.',target:['#settings-agenda-head'],action:'Next',next:'aCleanup',back:'aOrganization'},
      aCleanup:{title:'Tings tidies up on its own',copy:'About once a month, finished tasks and extra history are trimmed automatically. Set how long each is kept here, or tap clean now for an immediate pass.',target:['#settings-cleanup-head'],action:'Finish chapter',command:'chapterDone',back:'aShare'},
      aSettingsDisplay:{title:'Choose how Home presents the plan',copy:'Pick what Home shows — planned, due, and set-time items, plus an optional week strip — and how much each card shows: agenda time, log trails, status, topics, places, order marks.',target:['#settings-home-head'],action:'Next',next:'aBusy',back:'aIntro'},
      aBusy:{title:'Busy times create the real gaps',copy:'The one that makes plans good: block sleep, work, meals, school, commutes — whatever claims the clock. Tings then fits everything into the real gaps, travel included. Changes can hit a single date or the whole series.',target:['#settings-blocked-head'],action:'Next',next:'aDefaults',back:'aSettingsDisplay'},
      aDefaults:{title:'Defaults for new Tings',copy:'Set them once and every new Ting starts close to right — type, rhythm, priority, duration, flexibility, splitting, topics. Appearance adjusts density, text size, and theme.',target:['#settings-defaults-head'],action:'Next',next:'aOptimizer',back:'aBusy'},
      aOptimizer:{title:'Choose speed or tighter packing',copy:'Smarter packing trades a little time for tighter days; Fast mode answers instantly with a good plan. Either way, the same hard rules hold — nothing gets double-booked.',target:['#settings-advanced-head'],action:'Finish chapter',command:'chapterDone',back:'aDefaults'}
    };
    return {progress:p,...models[stage]};
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
    window.addEventListener('blur',onChromeConceal);
    window.addEventListener('focus',onChromeReveal);
    document.addEventListener('visibilitychange',onChromeVisibility);
    window.addEventListener('beforeinstallprompt',onInstallGesture);
    window.addEventListener('appinstalled',onAppInstalled);
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
    window.removeEventListener('blur',onChromeConceal);
    window.removeEventListener('focus',onChromeReveal);
    document.removeEventListener('visibilitychange',onChromeVisibility);
    window.removeEventListener('beforeinstallprompt',onInstallGesture);
    window.removeEventListener('appinstalled',onAppInstalled);
    chromeOverlay = false;
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
    root.dataset.installDock = m.dock || '';
    root.dataset.chromeOverlay = String(Boolean(chromeOverlay && m.dock));
    root.dataset.handoff = String(Boolean(m.handoff));
    const compact = Boolean(m.compact);
    const stepsHtml = m.steps?.length ? `<ol class="tings-coach-steps${compact ? ' is-compact' : ''}">${m.steps.map((step,index)=>`
        <li>
          <span class="tings-step-glyph"><span class="tings-step-num">${index + 1}</span>${step.icon ? `<i class="${step.icon}" aria-hidden="true"></i>` : ''}</span>
          <span class="tings-step-text">${compact && step.label ? step.label : step.text}</span>
          ${compact && index < m.steps.length - 1 ? '<i class="tings-step-arrow ti ti-arrow-narrow-right" aria-hidden="true"></i>' : ''}
        </li>`).join('')}</ol>` : '';
    const copyHtml = `<p class="tings-coach-copy" id="tings-coach-copy">${m.copy}</p>`;
    const chaptersHtml = m.chapters?.length ? `<div class="tings-coach-chapters" role="list">${m.chapters.map(chapter=>`
        <button type="button" class="tings-coach-chapter${chapter.done ? ' is-done' : ''}" data-coach-chapter="${chapter.id}" role="listitem">
          <span class="tings-coach-chapter-glyph"><i class="${chapter.icon}" aria-hidden="true"></i></span>
          <span class="tings-coach-chapter-text"><strong>${chapter.title}</strong><em>${chapter.summary}</em></span>
          <span class="tings-coach-chapter-check"><i class="ti ${chapter.done ? 'ti-check' : 'ti-chevron-right'}" aria-hidden="true"></i></span>
        </button>`).join('')}</div>` : '';
    const noteHtml = m.note ? `<p class="tings-coach-note">${m.note}</p>` : '';
    const chromeNudge = m.dock
      ? `<span class="tings-coach-chrome-nudge" aria-hidden="true"><i class="ti ${m.dock === 'bottom' ? 'ti-arrow-up-right' : 'ti-arrow-down-right'}"></i></span>`
      : '';
    bubble.innerHTML = `
      <div class="tings-coach-head">
        <span class="tings-coach-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${m.progress.total}" aria-valuenow="${Math.min(m.progress.now,m.progress.total)}" aria-label="${m.progress.label}"><i style="width:${Math.round(m.progress.fraction * 100)}%"></i></span>
        <button type="button" class="tings-coach-skip" data-coach-skip>skip</button>
      </div>
      <h2 class="tings-coach-title" id="tings-coach-title">${m.title}</h2>
      ${m.handoff ? `<div class="tings-coach-handoff" aria-hidden="true">
        <figure class="tings-handoff-pane is-leave">
          <div class="tings-handoff-browser" aria-hidden="true">
            <span class="tings-handoff-chrome"><i></i><i></i><i></i></span>
            <span class="tings-handoff-x"><i class="ti ti-x"></i></span>
          </div>
          <figcaption><strong>${m.handoff.leave}</strong></figcaption>
        </figure>
        <span class="tings-handoff-arrow" aria-hidden="true"><i class="ti ti-arrow-big-right"></i></span>
        <figure class="tings-handoff-pane is-open">
          <div class="tings-handoff-app" aria-hidden="true"><img src="./favicon.svg" alt=""></div>
          <figcaption><strong>${m.handoff.open}</strong><span>${m.handoff.openWhere}</span></figcaption>
        </figure>
      </div>` : ''}
      ${m.overlayHint ? `<p class="tings-coach-overlay-hint" role="status">${m.overlayHint}</p>` : ''}
      ${compact ? `${stepsHtml}${copyHtml}` : `${copyHtml}${chaptersHtml}${noteHtml}${stepsHtml}`}
      ${m.hint ? `<p class="tings-coach-hint">${m.hint}</p>` : ''}
      ${(m.back || m.action || m.later) ? `<div class="tings-coach-actions">
        ${m.back ? '<button type="button" class="tings-coach-action secondary" data-coach-back>Back</button>' : ''}
        ${m.later ? `<button type="button" class="tings-coach-action secondary" data-coach-later>${m.later}</button>` : ''}
        ${m.action ? `<button type="button" class="tings-coach-action" data-coach-primary${m.disabled ? ' disabled' : ''}>${m.action}</button>` : ''}
      </div>` : ''}
      ${chromeNudge}`;
    queuePosition();
  }

  function setStage(next){
    if(!active || !next || next === stage)return;
    stage = next;
    if(next !== 'iSteps')setChromeOverlay(false);
    prepareStage(next);
    render();
    revealTarget();
  }

  function prepareStage(next){
    if(next === 'aIntro'){
      // The chapter menu is a clean slate: chapters can end with the detail,
      // settings, overview, or a day-header pill sheet open — all of it
      // closes on return.
      closeGuidedSheet('settings-sheet');
      closeGuidedSheet('overview-sheet');
      closeGuidedDayLogs();
      closeGuidedSheet('detail-sheet');
      closeGuidedSheet('add-sheet');
      closeGuidedSheet('about-sheet');
      closeGuidedSheet('sample-habits-sheet');
      closeGuidedSheet('slipped-sheet');
      closeGuidedSheet('free-time-sheet');
      return;
    }
    if(next === 'eAdd' || next === 'eAddTask'){
      closeGuidedSheet('add-sheet');
      return;
    }
    if(next === 'eName'){
      setTimeout(()=>$('ting-message')?.focus({preventScroll:true}),70);
      return;
    }
    if(next === 'eTaskName'){
      chooseAddType('task');
      setTimeout(()=>$('ting-message')?.focus({preventScroll:true}),70);
      return;
    }
    if(next === 'eTask' && inTaskFollowup())chooseAddType('task');
    if(next === 'eDetailBasics' || next === 'eTaskDetail')showDetailPage('schedule');
    if(next === 'eDetailEffort')showDetailPage('effort');
    if(next === 'eHomeCard' || next === 'eHomeGroups' || next === 'eAddTaskIntro' || next === 'eSampleIntro' || next === 'eAbout' || next === 'eFinish'
      || next === 'aHome' || next === 'aActions' || next === 'aMissed' || next === 'aOpenTime' || next === 'aSearch'){
      closeGuidedSheet('detail-sheet');
      closeGuidedSheet('overview-sheet');
      closeGuidedDayLogs();
      closeGuidedSheet('settings-sheet');
      closeGuidedSheet('add-sheet');
      closeGuidedSheet('about-sheet');
      closeGuidedSheet('slipped-sheet');
      closeGuidedSheet('free-time-sheet');
      if(next !== 'eSampleAdd')closeGuidedSheet('sample-habits-sheet');
    }
    if(next === 'eOverviewPast' || next === 'eOverviewFuture')closeGuidedDayLogs();
    if(next === 'eSampleAdd'){
      if(!sheetOpen('sample-habits-sheet'))openGuidedSamples();
      setTimeout(()=>{
        firstTarget(['#sample-habits-preview [data-add-sample="sample-feature-water"]'])?.scrollIntoView({block:'center',behavior:'auto'});
        queuePosition();
      },80);
    }
    if(next === 'eAboutMenu'){
      if(!sheetOpen('about-sheet'))openGuidedAbout();
      setTimeout(()=>{
        firstTarget(['#open-settings','.about-actions'])?.scrollIntoView({block:'center',behavior:'auto'});
        queuePosition();
      },80);
    }
    if(next === 'eCalendar' || next === 'aCalendar'){
      overviewActivated = false;
      closeGuidedSheet('overview-sheet');
      closeGuidedDayLogs();
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
        aCalendarImport:'#settings-calendar-head',aOrganization:'#settings-locations-head',aShare:'#settings-agenda-head',
        aCleanup:'#settings-cleanup-head',aBusy:'#settings-blocked-head',
        aDefaults:'#settings-defaults-head',aOptimizer:'#settings-advanced-head'
      };
      setTimeout(()=>showSettingsTarget(settingsTargets[next]),80);
    }
  }

  // Entering a chapter from the menu. The detail chapter is the only one whose
  // first step needs a sheet the menu does not open: stage first, then open —
  // reconcile() keys sheet allowances off the current stage, so the detail
  // sheet must never appear while the menu stage (empty allowlist) is active.
  function startChapter(id){
    const chapter = ADVANCED_CHAPTERS.find(item=>item.id === id);
    if(!chapter || !habits().length)return;
    const stages = chapterStages(chapter);
    if(!stages.length)return;
    if(stages[0] === 'aDetailRead'){
      setStage('aDetailRead');
      const idx = trackedIndex();
      if(idx >= 0 && typeof openDetail === 'function')openDetail(idx);
      return;
    }
    setStage(stages[0]);
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
    closeGuidedSheet('sample-habits-sheet');
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('settings-sheet');
    closeGuidedSheet('slipped-sheet');
    closeGuidedSheet('free-time-sheet');
    closeGuidedDayLogs();
    unmount();
  }

  function goBack(){
    const back = model().back;
    if(!back)return;
    if(back === 'eAdd' || back === 'eAddTask'){
      if(typeof cancelAdd === 'function')cancelAdd();
      else closeGuidedSheet('add-sheet');
    }
    if(back === 'eSampleIntro')closeGuidedSheet('sample-habits-sheet');
    if(back === 'eAbout')closeGuidedSheet('settings-sheet');
    if((back === 'eCalendar' || back === 'aCalendar' || back === 'eOverview' || back === 'eOverviewPast' || back === 'eOverviewFuture')
      && (sheetOpen('overview-sheet') || overviewActivated || sheetOpen('day-logs-sheet'))){
      if(back === 'eCalendar' || back === 'aCalendar' || back === 'eOverview'){
        closeGuidedDayLogs();
        if(back === 'eCalendar' || back === 'aCalendar')closeGuidedSheet('overview-sheet');
      }else closeGuidedDayLogs();
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
    // Coach-internal taps (bubble buttons, guards, shade) never reach app-level
    // document click handlers. On wide tiers the pane click-away would
    // otherwise unmount the detail the tour just mounted, since the bubble is
    // not a .sheet-wrap — the chapter tap undid itself one tick later. The
    // coach's own document listener is capture-phase, so it still sees real
    // control taps inside the spotlight hole; those never pass through here.
    event.stopPropagation();
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
    const chapterBtn = event.target.closest('[data-coach-chapter]');
    if(chapterBtn){startChapter(chapterBtn.dataset.coachChapter);return;}
    if(event.target.closest('[data-coach-later]')){
      const laterModel = model();
      if(laterModel.laterCommand === 'startEssentials'){
        if(mode === 'install')remember('done');
        unmount();
        window.TingsCoach.start({kind:'essentials',force:true});
        return;
      }
      if(stage === 'eSampleIntro' || stage === 'eSampleAdd')closeGuidedSheet('sample-habits-sheet');
      if(OVERVIEW_DAY_STAGES.has(stage) || stage === 'eOverviewPast')closeGuidedDayLogs();
      const later = laterModel.next;
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
      setTimeout(()=>setStage(stage === 'eTaskName' ? 'eTask' : 'eKind'),60);
      return;
    }
    if(m.command === 'kindDone'){setStage(addKind() === 'task' ? 'eTask' : 'eRhythm');return;}
    if(m.command === 'openSamples'){
      setStage('eSampleAdd');
      return;
    }
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
      if(mode === 'install')remember('done');
      unmount();
      window.TingsCoach.start({kind:'essentials',force:true});
      return;
    }
    if(m.command === 'chapterDone'){
      const chapter = advancedChapter();
      if(chapter)markChapterDone(chapter.id);
      setStage('aIntro');
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
      hint.textContent = 'Tap the highlighted control to continue';
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
    if(stage === 'eAddTask' && event.target.closest('#open-add,#bar-open-add')){
      setTimeout(()=>{chooseAddType('task');setStage('eTaskName');},50);
    }
    if(stage === 'eKind'){
      const choice = event.target.closest('#type-seg [data-v]');
      if(choice)setTimeout(()=>setStage(choice.dataset.v === 'task' ? 'eTask' : 'eRhythm'),60);
    }
    if((stage === 'eSave' || stage === 'eSaveTask') && event.target.closest('#do-save')){
      setTimeout(reconcile,90);
      setTimeout(reconcile,350);
    }
    if(stage === 'eLog' && event.target.closest('[data-pulse]'))setTimeout(()=>setStage('eHomeGroups'),80);
    if((stage === 'eCalendar' || stage === 'aCalendar') && event.target.closest('#open-overview,#bar-open-overview')){
      overviewActivated = true;
      setTimeout(()=>setStage(stage === 'eCalendar' ? 'eOverview' : 'aOverview'),80);
    }
    if(stage === 'eOverviewPast'){
      const day = calDayFromEvent(event);
      if(day && !day.classList.contains('today') && !day.classList.contains('future')){
        setTimeout(()=>setStage('eOverviewLog'),120);
      }
    }
    if(stage === 'eOverviewLog' && event.target.closest('#day-logs-log')){
      setTimeout(()=>setStage('eOverviewMissed'),80);
    }
    if(stage === 'eOverviewMissed' && event.target.closest('#day-log-entry-save')){
      setTimeout(()=>setStage('eOverviewFuture'),80);
    }
    if(stage === 'eOverviewFuture'){
      const day = calDayFromEvent(event);
      if(day && day.classList.contains('future')){
        setTimeout(()=>setStage('eOverviewPlan'),120);
      }
    }
    if(stage === 'eOverviewPlan' && event.target.closest('#day-logs-plan')){
      setTimeout(()=>setStage(afterCalendarNext()),80);
    }
    if(stage === 'eSampleAdd' && event.target.closest('#sample-habits-preview [data-add-sample]')){
      setTimeout(()=>setStage('eAbout'),120);
    }
    if(stage === 'eAbout' && event.target.closest('#open-about,#bar-open-about')){
      setTimeout(()=>setStage('eAboutMenu'),50);
    }
    if(stage === 'aFullMode' && event.target.closest('[data-setting-toggle="minimalMode"]'))setTimeout(reconcile,120);
  }

  function onInput(event){
    if(!active || (stage !== 'eName' && stage !== 'eTaskName') || event.target !== $('ting-message'))return;
    render();
  }

  function onKeydown(event){
    if(!active)return;
    if((stage === 'eName' || stage === 'eTaskName') && event.target === $('ting-message') && event.key === 'Enter'){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(String(event.target.value || '').trim()){
        event.target.blur();
        setTimeout(()=>setStage(stage === 'eTaskName' ? 'eTask' : 'eKind'),60);
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
      const created = newestUntracked();
      if(created){
        if(inTaskFollowup() || stage === 'eSaveTask' || stage === 'eTaskName'){
          trackedTaskHid = created.hid;
          if(sheetOpen('detail-sheet'))setStage('eTaskDetail');
        }else{
          trackedHid = created.hid;
          if(sheetOpen('detail-sheet'))setStage('eDetailBasics');
        }
      }else if(stage === 'eSaveTask' && trackedTaskHid && sheetOpen('detail-sheet')){
        setStage('eTaskDetail');
      }else if(stage === 'eSave' && trackedHid && sheetOpen('detail-sheet')){
        setStage('eDetailBasics');
      }else setStage(inTaskFollowup() || stage === 'eTaskName' || stage === 'eSaveTask' ? 'eAddTask' : 'eAdd');
      return;
    }
    if(stage === 'eSave' && newestUntracked() && sheetOpen('detail-sheet')){
      trackedHid = newestUntracked().hid;
      setStage('eDetailBasics');
      return;
    }
    if(stage === 'eSaveTask' && newestUntracked() && sheetOpen('detail-sheet')){
      trackedTaskHid = newestUntracked().hid;
      setStage('eTaskDetail');
      return;
    }
    if(DETAIL_STAGES.has(stage) && !sheetOpen('detail-sheet')){
      if(stage === 'eTaskDetail')setStage('eSampleIntro');
      else setStage(mode === 'essentials' ? 'eHomeCard' : 'aIntro');
      return;
    }
    if(stage === 'aFullMode' && !isMinimal()){
      closeGuidedSheet('settings-sheet');
      setTimeout(()=>setStage('aHome'),70);
      return;
    }
    if(SETTINGS_STAGES.has(stage) && stage !== 'aFullMode' && !sheetOpen('settings-sheet')){
      setStage('aIntro');
      return;
    }
    if(['eOverview','eOverviewPast','eOverviewLog','eOverviewMissed','eOverviewFuture','eOverviewPlan'].includes(stage)){
      if(!overviewShown())setStage('eCalendar');
      else if((stage === 'eOverviewMissed' || stage === 'eOverviewPlan') && !sheetOpen('day-logs-sheet')){
        setStage(stage === 'eOverviewPlan' ? 'eOverviewFuture' : 'eOverviewPast');
      }else if(stage === 'eOverviewPast' && sheetOpen('day-logs-sheet')){
        setStage('eOverviewLog');
      }else if(stage === 'eOverviewFuture' && sheetOpen('day-logs-sheet')){
        setStage('eOverviewPlan');
      }
    }
    if((stage === 'aOverview' || stage === 'aOverviewTools') && !overviewShown()){
      setStage('aCalendar');
    }
    if(stage === 'eSampleAdd' && !sheetOpen('sample-habits-sheet')){
      setStage('eSampleIntro');
      return;
    }
    if(stage === 'eAboutMenu' && !sheetOpen('about-sheet') && !sheetOpen('settings-sheet')){
      setStage('eAbout');
      return;
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

  function setChromeOverlay(on){
    const m = active ? model() : {};
    const next = Boolean(on && m.dock && stage === 'iSteps');
    if(chromeOverlay === next)return;
    chromeOverlay = next;
    if(!root)return;
    root.dataset.chromeOverlay = String(next);
    queuePosition();
  }
  function onChromeConceal(){
    if(!active || document.visibilityState === 'hidden')return;
    setChromeOverlay(true);
  }
  function onChromeReveal(){
    setChromeOverlay(false);
  }
  function onChromeVisibility(){
    if(document.visibilityState === 'hidden')setChromeOverlay(false);
    else onChromeReveal();
  }
  // Chrome fires beforeinstallprompt whenever it (re)qualifies the PWA —
  // often a beat after the first-run card rendered with the manual steps
  // (main-input's boot listener captured the gesture first; it registered
  // before this one, so the deferred prompt is already set when this runs).
  // The one-tap native Install always wins over teaching the long way, so
  // the card swaps itself the moment the gesture exists.
  function onInstallGesture(){
    if(!active || mode !== 'install' || stage !== 'iSteps')return;
    installDismissed = false;
    render();
  }
  // The user may also install straight from browser chrome (address-bar
  // icon, ⋮/⋯ menu) while the manual card is up — meet them at the handoff.
  function onAppInstalled(){
    if(!active || mode !== 'install' || stage !== 'iSteps')return;
    setStage('iNext');
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
    // The chrome nudge points at the real browser control (••• / ⋮), which
    // lives in the toolbar on the far side of the viewport from the docked
    // card — pin it beside that corner, not to the card itself.
    const nudge = bubble.querySelector('.tings-coach-chrome-nudge');
    if(nudge){
      nudge.style.left = `${view.right - 40}px`;
      nudge.style.top = `${m.dock === 'top' ? view.bottom - 38 : view.top + 12}px`;
    }
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
      const left = Math.max(margin,view.left + (view.width - br.width) / 2);
      let top = Math.max(view.top + margin,view.top + (view.height - br.height) / 2);
      if(m.dock === 'top')top = view.top + margin + coachSafe('top');
      else if(m.dock === 'bottom'){
        top = Math.max(view.top + margin,view.bottom - br.height - margin - coachSafe('bottom'));
      }
      root.dataset.installDock = m.dock || '';
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
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
    if(m.keyboard || m.pinBottom)candidates.unshift(candidates.splice(2,1)[0]);
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
    trackedTaskHid = '';
    overviewActivated = false;
    installDismissed = false;
    chromeOverlay = false;
    stage = mode === 'advanced' ? 'aIntro' : mode === 'install' ? 'iSteps' : 'eIntro';
    active = true;
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('privacy-sheet');
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
