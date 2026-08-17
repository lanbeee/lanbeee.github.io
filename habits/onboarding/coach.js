// Lightweight, action-aware onboarding for the real Tings UI.
(function(){
  'use strict';

  const KEYS = {
    essentials:'tings_coach_essentials_v1',
    advanced:'tings_coach_advanced_v1'
  };
  const $ = id=>document.getElementById(id);
  let active = false;
  let mode = 'essentials';
  let stage = '';
  let interactive = false;
  let root = null;
  let bubble = null;
  let spotlight = null;
  let observer = null;
  let positionFrame = 0;
  let initialHids = new Set();
  let trackedHid = '';
  let baselineLogs = 0;

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
  function visible(el){
    if(!el || !el.isConnected)return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function firstVisible(selectors){
    for(const selector of selectors || []){
      const found = [...document.querySelectorAll(selector)].find(visible);
      if(found)return found;
    }
    return null;
  }
  function sheetOpen(id){
    return Boolean($(id)?.classList.contains('open') || $('pane-detail')?.dataset.activeSheet === id);
  }
  function closeGuidedSheet(id){
    if(!sheetOpen(id) || typeof closeSheet !== 'function')return;
    try{closeSheet(id);}catch(_){}
  }
  function openSettings(){
    closeGuidedSheet('about-sheet');
    closeGuidedSheet('overview-sheet');
    if(typeof resetSettingsSheetState === 'function')resetSettingsSheetState();
    if(typeof syncSettingsControls === 'function')syncSettingsControls();
    if(typeof openSheet === 'function')openSheet('settings-sheet');
  }
  function trackedIndex(){
    const data = habits();
    const byId = trackedHid ? data.findIndex(h=>h && h.hid === trackedHid) : -1;
    return byId >= 0 ? byId : (data.length ? 0 : -1);
  }
  function trackedLogCount(){
    const h = habits()[trackedIndex()];
    if(!h)return 0;
    return Array.isArray(h.logs) ? h.logs.filter(log=>!(log && typeof log === 'object' && log.plan)).length : 0;
  }

  function stepModel(){
    if(mode === 'essentials')return essentialsModel();
    return advancedModel();
  }

  function essentialsModel(){
    const review = !interactive;
    const totals = review ? 5 : 7;
    const steps = review
      ? {intro:1,addInfo:2,cardInfo:3,calendarWait:4,overview:5}
      : {intro:1,addWait:2,create:3,detail:4,log:5,calendarWait:6,overview:7};
    const progress = `${steps[stage] || 1} of ${totals} · guided start`;
    if(stage === 'intro')return {
      progress,title:'Welcome to Tings',
      copy:review
        ? 'Take a quick refresher on creating, reading, and planning your Tings. This tour will not change your existing entries.'
        : 'Build habits and tasks around the time you really have. Everything stays private on this device.',
      action:review ? 'Start tour' : 'Create my first Ting',next:review ? 'addInfo' : 'addWait'
    };
    if(stage === 'addWait')return {
      progress,title:'Start with one real thing',copy:'Tap +, then add a habit you want to build or a one-off task. The defaults are enough to begin.',
      target:['#open-add','#bar-open-add'],hint:'Tap + in Tings'
    };
    if(stage === 'create')return {
      progress,title:'Name it and set the rhythm',copy:'Give it a short name. Keep “habit” for something recurring, or choose “task” for a one-off. Then tap add.',
      target:['#ting-message'],hint:'Name it, then tap add'
    };
    if(stage === 'detail')return {
      progress,title:'Tune it when you need to',copy:'Detail is where scheduling lives. You can add days, time windows, duration, and places later—the defaults already work.',
      target:['#detail-sheet .detail-sheet','#pane-detail .detail-sheet'],action:'Back to home',command:'closeDetail'
    };
    if(stage === 'log')return {
      progress,title:'Log from the card',copy:'Tap the colored icon to log this Ting. Tap the rest of the card whenever you want to reopen its details.',
      target:['.ting-card [data-pulse]','.ting-card'],hint:'Tap the icon on the card'
    };
    if(stage === 'addInfo')return {
      progress,title:'Create with +',copy:'Use + for a recurring habit or a one-off task. Start simple; detail lets you add timing and places later.',
      target:['#open-add','#bar-open-add'],action:'Next',next:'cardInfo'
    };
    if(stage === 'cardInfo')return {
      progress,title:'Cards are made for quick action',copy:'The colored icon logs a Ting; the card body opens detail. Your status and rhythm update from real entries.',
      target:['.ting-card','#list','#empty'],action:'Next',next:'calendarWait'
    };
    if(stage === 'calendarWait')return {
      progress,title:'See the week',copy:'Calendar shows what is coming up and where the week has room. Tap the calendar icon now.',
      target:['#open-overview','#bar-open-overview'],hint:'Tap calendar in Tings'
    };
    return {
      progress,title:'You know the essentials',copy:'Tings will keep shaping the list as you log. Open Tings → advanced coach whenever you want the full planning controls.',
      target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],action:'Finish',command:'finish'
    };
  }

  function advancedModel(){
    const steps = {intro:1,fullMode:2,home:3,detail:4,calendarWait:5,overview:6,backup:7,planning:8,finish:9};
    const progress = `${steps[stage] || 1} of 9 · advanced coach`;
    if(stage === 'intro')return {
      progress,title:'Explore the full planner',copy:'Full mode reveals agenda timing, trails, card actions, planning panes, places, and busy-time controls. It does not change the planner’s decisions by itself.',
      action:habits().length ? 'Start advanced coach' : 'Start with a Ting',command:habits().length ? 'startAdvanced' : 'startEssentials'
    };
    if(stage === 'fullMode')return {
      progress,title:'Turn off minimal mode',copy:'Minimal mode only hides extra controls. Turn it off here; your habits, logs, and schedule stay exactly where they are.',
      target:['[data-setting-toggle="minimalMode"]'],hint:'Tap the minimal mode switch'
    };
    if(stage === 'home')return {
      progress,title:'Home is a live agenda',copy:'Full cards can show suggested times, status, trails, and quick actions. Swipe for pin, activity, timer, snooze, or remove; tap a card for its full setup.',
      target:['.ting-card','#list'],action:'Open a Ting',command:'openDetail'
    };
    if(stage === 'detail')return {
      progress,title:'Control where it can fit',copy:'Calendar sets eligible days. Schedule sets allowed and preferred windows and places. Effort controls duration, chunks, and auto-log; Actions holds links and order rules.',
      target:['#detail-sheet .detail-sheet','#pane-detail .detail-sheet'],action:'Back to home',command:'advancedHome'
    };
    if(stage === 'calendarWait')return {
      progress,title:'Inspect the whole week',copy:'Tap Calendar for open hours, lighter days, upcoming plans, recent activity, and items that need attention.',
      target:['#open-overview','#bar-open-overview'],hint:'Tap calendar in Tings'
    };
    if(stage === 'overview')return {
      progress,title:'Read the pressure, not just the dates',copy:'The calendar is the planner’s companion: use it to see open time, tight days, what was placed, and what slipped.',
      target:['#overview-sheet .overview-sheet','#pane-overview .overview-sheet'],action:'Planning setup',command:'openSettings'
    };
    if(stage === 'backup')return {
      progress,title:'Back up this device',copy:'Tings has no account or cloud sync. Export a backup regularly, especially before clearing browser data or moving phones.',
      target:['#backup-export'],action:'Schedule & places',command:'planning'
    };
    if(stage === 'planning')return {
      progress,title:'Model your real day',copy:'Locations add opening hours and travel. Busy times protect sleep, work, meals, and other unavailable time. These settings make the agenda realistic.',
      target:['#settings-locations-head','#settings-blocked-head'],action:'Got it',next:'finish'
    };
    return {
      progress,title:'Full mode is ready',copy:'You can return to either coach from Tings → About. Start with a few honest constraints; add complexity only when it helps the plan.',
      action:'Finish',command:'finish'
    };
  }

  function mount(){
    root = document.createElement('div');
    root.className = 'tings-coach-root';
    root.id = 'tings-coach';
    root.setAttribute('role','presentation');
    root.innerHTML = '<div class="tings-coach-shade"></div><div class="tings-coach-spotlight"></div><section class="tings-coach-bubble" role="dialog" aria-modal="false" aria-labelledby="tings-coach-title" aria-describedby="tings-coach-copy"></section>';
    document.body.appendChild(root);
    bubble = root.querySelector('.tings-coach-bubble');
    spotlight = root.querySelector('.tings-coach-spotlight');
    root.addEventListener('click',onCoachClick);
    document.addEventListener('click',onDocumentClick,true);
    document.addEventListener('keydown',onKeydown,true);
    window.addEventListener('resize',queuePosition);
    window.addEventListener('scroll',queuePosition,true);
    window.visualViewport?.addEventListener('resize',queuePosition);
    window.visualViewport?.addEventListener('scroll',queuePosition);
    observer = new MutationObserver(()=>{
      syncFromApp();
      queuePosition();
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-pressed']});
  }

  function unmount(){
    active = false;
    observer?.disconnect();
    observer = null;
    cancelAnimationFrame(positionFrame);
    document.removeEventListener('click',onDocumentClick,true);
    document.removeEventListener('keydown',onKeydown,true);
    window.removeEventListener('resize',queuePosition);
    window.removeEventListener('scroll',queuePosition,true);
    window.visualViewport?.removeEventListener('resize',queuePosition);
    window.visualViewport?.removeEventListener('scroll',queuePosition);
    root?.remove();
    root = bubble = spotlight = null;
  }

  function renderStep(){
    if(!active || !bubble)return;
    const model = stepModel();
    root.dataset.mode = mode;
    root.dataset.coachStage = stage;
    bubble.innerHTML = `
      <div class="tings-coach-head">
        <span class="tings-coach-progress">${model.progress}</span>
        <button type="button" class="tings-coach-skip" data-coach-skip>skip</button>
      </div>
      <h2 class="tings-coach-title" id="tings-coach-title">${model.title}</h2>
      <p class="tings-coach-copy" id="tings-coach-copy">${model.copy}</p>
      ${model.hint ? `<p class="tings-coach-hint">${model.hint}</p>` : ''}
      ${model.action ? `<div class="tings-coach-actions"><button type="button" class="tings-coach-action" data-coach-primary>${model.action}</button></div>` : ''}`;
    queuePosition();
  }

  function setStage(next){
    if(!active || !next || stage === next)return;
    stage = next;
    renderStep();
    if(mode === 'advanced' && (stage === 'backup' || stage === 'planning')){
      setTimeout(scrollAdvancedTarget,80);
    }
  }

  function scrollAdvancedTarget(){
    const selector = stage === 'backup' ? '#backup-export' : '#settings-locations-head';
    const el = document.querySelector(selector);
    if(el)el.scrollIntoView({block:'center',behavior:'smooth'});
    setTimeout(queuePosition,240);
  }

  function finish(value = 'done'){
    remember(value);
    closeGuidedSheet('settings-sheet');
    unmount();
  }

  function skip(){finish('skipped');}

  function onCoachClick(event){
    if(event.target.closest('[data-coach-skip]')){skip();return;}
    if(!event.target.closest('[data-coach-primary]'))return;
    const model = stepModel();
    if(model.next){setStage(model.next);return;}
    if(model.command === 'finish'){finish();return;}
    if(model.command === 'closeDetail'){
      closeGuidedSheet('detail-sheet');
      baselineLogs = trackedLogCount();
      setStage('log');
      return;
    }
    if(model.command === 'startAdvanced'){
      if(isMinimal()){
        openSettings();
        setStage('fullMode');
      }else setStage('home');
      return;
    }
    if(model.command === 'startEssentials'){
      unmount();
      window.TingsCoach.start({kind:'essentials',force:true});
      return;
    }
    if(model.command === 'openDetail'){
      const idx = trackedIndex();
      if(idx >= 0 && typeof openDetail === 'function')openDetail(idx);
      setTimeout(()=>setStage('detail'),30);
      return;
    }
    if(model.command === 'advancedHome'){
      closeGuidedSheet('detail-sheet');
      setStage('calendarWait');
      return;
    }
    if(model.command === 'openSettings'){
      closeGuidedSheet('overview-sheet');
      openSettings();
      setStage('backup');
      return;
    }
    if(model.command === 'planning'){setStage('planning');}
  }

  function onDocumentClick(event){
    if(!active || event.target.closest('#tings-coach'))return;
    if(mode === 'essentials'){
      if(stage === 'addWait' && event.target.closest('#open-add,#bar-open-add')){
        setTimeout(()=>setStage('create'),40);
      }else if(stage === 'create' && event.target.closest('#do-cancel')){
        setTimeout(()=>setStage('addWait'),40);
      }else if(stage === 'calendarWait' && event.target.closest('#open-overview,#bar-open-overview')){
        setTimeout(()=>setStage('overview'),80);
      }
    }else{
      if(stage === 'fullMode' && event.target.closest('[data-setting-toggle="minimalMode"]'))setTimeout(syncFromApp,100);
      if(stage === 'calendarWait' && event.target.closest('#open-overview,#bar-open-overview'))setTimeout(()=>setStage('overview'),80);
    }
    setTimeout(syncFromApp,70);
    setTimeout(syncFromApp,280);
  }

  function syncFromApp(){
    if(!active)return;
    if(mode === 'essentials' && stage === 'create'){
      const data = habits();
      if(data.length > initialHids.size){
        const created = data.find(h=>h && h.hid && !initialHids.has(h.hid)) || data[data.length - 1];
        trackedHid = created?.hid || '';
        baselineLogs = trackedLogCount();
        if(sheetOpen('detail-sheet'))setStage('detail');
      }else if(!sheetOpen('add-sheet'))setStage('addWait');
    }else if(mode === 'essentials' && stage === 'detail' && !sheetOpen('detail-sheet')){
      baselineLogs = trackedLogCount();
      setStage('log');
    }else if(mode === 'essentials' && stage === 'log' && trackedLogCount() > baselineLogs){
      setStage('calendarWait');
    }else if(stage === 'calendarWait' && sheetOpen('overview-sheet')){
      setStage('overview');
    }else if(mode === 'advanced' && stage === 'fullMode' && !isMinimal()){
      closeGuidedSheet('settings-sheet');
      setTimeout(()=>setStage('home'),60);
    }else if(mode === 'advanced' && stage === 'detail' && !sheetOpen('detail-sheet')){
      setStage('calendarWait');
    }
  }

  function onKeydown(event){
    if(!active || event.key !== 'Escape')return;
    event.preventDefault();
    skip();
  }

  function queuePosition(){
    if(!active || positionFrame)return;
    positionFrame = requestAnimationFrame(()=>{
      positionFrame = 0;
      position();
    });
  }

  function position(){
    if(!active || !bubble || !spotlight)return;
    const model = stepModel();
    const target = firstVisible(model.target);
    root.dataset.hasTarget = String(Boolean(target));
    const viewport = window.visualViewport;
    const viewLeft = viewport ? viewport.offsetLeft : 0;
    const viewTop = viewport ? viewport.offsetTop : 0;
    const viewWidth = viewport ? viewport.width : window.innerWidth;
    const viewHeight = viewport ? viewport.height : window.innerHeight;
    const margin = 10;
    const gap = 14;
    const bubbleRect = bubble.getBoundingClientRect();
    if(!target){
      spotlight.style.cssText = '';
      bubble.style.left = `${Math.max(margin,viewLeft + (viewWidth - bubbleRect.width) / 2)}px`;
      bubble.style.top = `${Math.max(margin,viewTop + (viewHeight - bubbleRect.height) / 2)}px`;
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = Math.min(8,Math.max(4,rect.width * .04));
    spotlight.style.left = `${Math.max(viewLeft,rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(viewTop,rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(viewLeft + viewWidth,rect.right + pad) - Math.max(viewLeft,rect.left - pad)}px`;
    spotlight.style.height = `${Math.min(viewTop + viewHeight,rect.bottom + pad) - Math.max(viewTop,rect.top - pad)}px`;
    const centeredLeft = rect.left + rect.width / 2 - bubbleRect.width / 2;
    const left = Math.min(viewLeft + viewWidth - bubbleRect.width - margin,Math.max(viewLeft + margin,centeredLeft));
    const below = rect.bottom + gap;
    const above = rect.top - bubbleRect.height - gap;
    let top;
    if(below + bubbleRect.height <= viewTop + viewHeight - margin)top = below;
    else if(above >= viewTop + margin)top = above;
    else top = viewTop + viewHeight - bubbleRect.height - margin;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(viewTop + margin,top)}px`;
  }

  function start(options = {}){
    const kind = options.kind === 'advanced' ? 'advanced' : 'essentials';
    if(active)unmount();
    mode = kind;
    interactive = mode === 'essentials' && habits().length === 0;
    initialHids = new Set(habits().map(h=>h && h.hid).filter(Boolean));
    trackedHid = habits()[0]?.hid || '';
    baselineLogs = trackedLogCount();
    stage = 'intro';
    active = true;
    closeGuidedSheet('about-sheet');
    mount();
    renderStep();
    return true;
  }

  window.TingsCoach = {
    start,
    stop:skip,
    state:()=>({active,mode,stage,interactive})
  };
})();
