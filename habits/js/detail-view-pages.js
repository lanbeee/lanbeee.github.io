// Phone tab labels, including the Android app. Each name stays within 12
// characters so the strip shows the whole word. Icons stay with the page.
// The words follow the item: a habit's rhythm is not a task's due date.
const DETAIL_PAGE_NAV = {
  summary:{icon:'ti-list-details'},
  calendar:{icon:'ti-calendar-week'},
  schedule:{icon:'ti-calendar-time'},
  availability:{icon:'ti-map-pin'},
  weather:{icon:'ti-cloud'},
  effort:{icon:'ti-progress-check'},
  tracking:{icon:'ti-player-play'},
  identity:{icon:'ti-id'},
  actions:{icon:'ti-dots'}
};

// Kind comes from the open editor. Phone-calendar items are also events, so
// that check wins. A string label is shared; a map names only the kinds whose
// page contents actually differ.
const DETAIL_PAGE_LABELS = {
  summary:'summary',
  calendar:{task:'progress', _:'history'},
  schedule:{
    routine:'how often',
    limit:'at most',
    opportunity:'conditions',
    stop:'goal',
    task:'due & start',
    event:'date & time'
  },
  availability:{opportunity:'days & hours', _:'when & where'},
  weather:'weather',
  effort:'time & order',
  tracking:'tracking',
  identity:{calendar:'icon & color', event:'name & icon', _:'name & type'},
  actions:'actions'
};

function detailNavKind(){
  const root = $('detail-sheet');
  const inner = typeof getSheetInner === 'function' ? getSheetInner('detail-sheet') : null;
  const has = name => Boolean(root?.classList.contains(name) || inner?.classList.contains(name));
  if(has('phone-calendar-detail'))return 'calendar';
  if(has('event-detail') || has('local-appointment'))return 'event';
  if(has('opportunity-mode'))return 'opportunity';
  const type = typeof currentDetailTune === 'function' ? currentDetailTune().type : 'keepup';
  if(type === 'task')return 'task';
  if(type === 'zero')return 'stop';
  if(type === 'reduce')return 'limit';
  return 'routine';
}

function detailPageLabel(key, kind = detailNavKind()){
  const spec = DETAIL_PAGE_LABELS[key];
  if(typeof spec === 'string')return spec;
  if(!spec)return key;
  return spec[kind] || spec._ || key;
}

// Minimal mode keeps two tabs: Summary alone, then every remaining pane stacked
// as one scrolling settings page.
const DETAIL_MINIMAL_NAV = {
  summary:{label:'summary',icon:'ti-list-details'},
  settings:{label:'settings',icon:'ti-adjustments-horizontal'}
};

// A save may still have a next-frame scroll restore queued. New navigation
// takes ownership of the pager, even before its scrolling has settled.
let detailNavigationRevision = 0;
let detailPanelMotion = null;
let detailDockMotion = null;

function cancelDetailNavigationMotion(){
  detailPanelMotion?.cancel();
  detailDockMotion?.cancel();
}

// Animate only an explicit navigation action. Selection and layout commit
// immediately; keyboard/viewport updates never start or delay a transition.
function animateDetailNavigation(previousNav,previousDock,behavior = 'smooth'){
  cancelDetailNavigationMotion();
  const inner = getSheetInner('detail-sheet');
  if(!inner || behavior !== 'smooth' || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(!$('detail-sheet').classList.contains('open') && !inner.closest('.pane-detail'))return;
  const nav = detailCurrentNav();
  if(previousNav !== nav){
    const pager = inner.querySelector('.detail-pager');
    const pages = visibleDetailPages(pager);
    const direction = pages.findIndex(page=>page.dataset.detailNav === nav)
      >= pages.findIndex(page=>page.dataset.detailNav === previousNav) ? 1 : -1;
    const panel = detailIsSingleView() ? pager : pages.find(page=>page.dataset.detailNav === nav);
    detailPanelMotion = panel?.animate([
      {transform:`translateX(${direction * 12}px)`,opacity:.92},
      {transform:'translateX(0)',opacity:1}
    ],{duration:180,easing:'ease-out'});
  }
  if(!previousDock?.width)return;
  const dock = inner.querySelector('.sheet-search-dock');
  const next = dock?.getBoundingClientRect();
  if(!next?.width || !next.height)return;
  const dx = previousDock.x - next.x,dy = previousDock.y - next.y;
  if(Math.abs(dx) + Math.abs(dy) + Math.abs(previousDock.width - next.width) + Math.abs(previousDock.height - next.height) < 1)return;
  const base = getComputedStyle(dock).transform;
  const transform = base === 'none' ? '' : base;
  detailDockMotion = dock.animate([
    {transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) ${transform} scale(${previousDock.width / next.width},${previousDock.height / next.height})`},
    {transformOrigin:'0 0',transform:base}
  ],{duration:180,easing:'ease-out'});
}

// Visual-only: drop the merged calendar+stats pane and the effort pane, fold
// duration + due into schedule, and keep basic allowed weekdays and hours. What is
// left is short enough to read as one scrolling settings page, so the pager
// stacks vertically. Does not change saved habit fields.
const MINIMAL_HIDDEN_DETAIL_PAGES = ['calendar','weather','effort','tracking'];
let _minimalEffortHomes = null;
function applyDetailMinimalMode(){
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  const sheet = $('detail-sheet');
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  const wasMinimal = Boolean(sheet?.classList.contains('minimal-detail'));
  // The body class flips before this runs; keep the explicit selected tab.
  const fromNav = wasMinimal ? (detailMinimalView() === 'summary' ? 'summary' : 'availability')
    : getSheetInner('detail-sheet')?.dataset.fullNav;
  pager?.querySelectorAll('.detail-field-revealed').forEach(el=>el.classList.remove('detail-field-revealed'));
  if(sheet)sheet.classList.toggle('minimal-detail', minimal);
  // A previously selected Preferred view must never hide the basic controls.
  if(minimal && typeof setScheduleView === 'function')setScheduleView('allowed');
  const availabilityTitle = $('detail-availability-disclosure')?.querySelector('summary');
  if(availabilityTitle)availabilityTitle.textContent = sheet?.classList.contains('opportunity-mode') ? 'days & hours' : minimal ? 'allowed days & hours' : 'days, hours & places';
  if(pager){
    MINIMAL_HIDDEN_DETAIL_PAGES.forEach(nav=>{
      const page = pager.querySelector(`.detail-page[data-detail-nav="${nav}"]`);
      if(page)page.hidden = minimal;
    });
    // Switching modes keeps the user on Summary or on the settings they were in.
    if(minimal && !wasMinimal){
      setDetailMinimalView(!fromNav || fromNav === 'summary' ? 'summary' : 'settings');
      pager.scrollTo({left:0,top:0,behavior:'auto'});
    }else if(minimal){
      pager.scrollTo({left:0,behavior:'auto'});
    }else if(wasMinimal){
      pager.scrollTo({top:0,behavior:'auto'});
      scrollDetailToNav(fromNav,'auto');
    }else{
      const pages = visibleDetailPages(pager);
      const inner = getSheetInner('detail-sheet');
      if(!pages.some(page=>page.dataset.detailNav === inner.dataset.fullNav))inner.dataset.fullNav = pages[0]?.dataset.detailNav || '';
    }
  }

  // Duration still matters in minimal mode, so it moves up into Schedule.
  // Task due date and flexibility already live there. Auto mark done stays
  // behind on the hidden Effort pane, keeping its saved value untouched.
  const slot = $('detail-minimal-effort');
  const durationField = $('detail-duration-field');
  const autoMarkField = $('detail-auto-mark-field');
  if(!_minimalEffortHomes && durationField && autoMarkField){
    _minimalEffortHomes = {
      durationParent:durationField.parentElement,
      durationNext:durationField.nextElementSibling,
      autoParent:autoMarkField.parentElement,
      autoNext:autoMarkField.nextElementSibling
    };
  }
  const restoreNode = (node,parent,next)=>{
    if(!node || !parent)return;
    if(next && next.parentElement === parent)parent.insertBefore(node,next);
    else parent.appendChild(node);
  };
  if(minimal && slot && durationField){
    slot.appendChild(durationField);
    slot.hidden = false;
    if(_minimalEffortHomes){
      restoreNode(autoMarkField,_minimalEffortHomes.autoParent,_minimalEffortHomes.autoNext);
    }
  }else if(_minimalEffortHomes){
    restoreNode(durationField,_minimalEffortHomes.durationParent,_minimalEffortHomes.durationNext);
    restoreNode(autoMarkField,_minimalEffortHomes.autoParent,_minimalEffortHomes.autoNext);
    if(slot)slot.hidden = true;
  }

  const inner = getSheetInner('detail-sheet');
  inner?.classList.toggle('minimal-detail',minimal);
  inner?.querySelectorAll('.detail-disclosure').forEach(el=>{
    if(minimal){
      if(el.dataset.regularOpen === undefined){
        el.dataset.regularOpen = String(el.open);
        if(el.id === 'detail-availability-disclosure')el.open = false;
      }
      // Availability starts folded, then keeps the user's disclosure choice.
      // Keep the optional emoji picker behind its disclosure too.
      if(!['detail-appearance-disclosure','detail-availability-disclosure'].includes(el.id))el.open = true;
    }else if(el.dataset.regularOpen !== undefined){
      el.open = el.dataset.regularOpen === 'true';delete el.dataset.regularOpen;
    }
  });
  if(sheet?.classList.contains('opportunity-mode'))syncDetailConditionsLayout(true);
  if(typeof refreshOpportunityChoiceVisibility === 'function')refreshOpportunityChoiceVisibility();
  if(minimal && typeof setDetailSearchOpen === 'function')setDetailSearchOpen(false,false);
  if(typeof updateDetailPagerDots === 'function')updateDetailPagerDots();
}

// PURE: minimal mode stacks every remaining pane into one scrolling page.
function detailIsSingleView(){
  return typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
}

function visibleDetailPages(pager){
  if(!pager)return [];
  return [...pager.querySelectorAll('.detail-page')].filter(page=>!page.hidden);
}

function detailMinimalView(){
  return getSheetInner('detail-sheet')?.dataset.minimalView === 'settings' ? 'settings' : 'summary';
}

function setDetailMinimalView(view){
  const inner = getSheetInner('detail-sheet');
  if(inner)inner.dataset.minimalView = view === 'settings' ? 'settings' : 'summary';
}

// The page the user is looking at. In minimal settings that is its first pane.
function detailCurrentNav(){
  const inner = getSheetInner('detail-sheet');
  const pager = inner?.querySelector('.detail-pager');
  const pages = visibleDetailPages(pager);
  if(!pages.length)return null;
  if(detailIsSingleView()){
    return detailMinimalView() === 'summary' ? 'summary'
      : pages.find(page=>page.dataset.detailNav !== 'summary')?.dataset.detailNav || null;
  }
  return pages.find(page=>page.dataset.detailNav === inner.dataset.fullNav)?.dataset.detailNav
    || pages[0].dataset.detailNav || null;
}

function detailPageIndexByNav(navKey){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if(!pager)return -1;
  return visibleDetailPages(pager).findIndex(page=>page.dataset.detailNav === navKey);
}

function scrollDetailToNav(navKey,behavior = 'auto'){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if(!pager)return;
  const index = detailPageIndexByNav(navKey);
  if(index < 0)return;
  const previousNav = detailCurrentNav();
  const previousDock = behavior === 'smooth' && !matchMedia('(prefers-reduced-motion: reduce)').matches
    ? pager.parentElement.querySelector('.sheet-search-dock')?.getBoundingClientRect() : null;
  detailNavigationRevision += 1;
  if(detailIsSingleView()){
    setDetailMinimalView(navKey === 'summary' ? 'summary' : 'settings');
    updateDetailPagerDots();
    const page = visibleDetailPages(pager)[index];
    if(page)pager.scrollTo({top:navKey === 'summary' ? 0 : page.offsetTop - pager.offsetTop,behavior});
    animateDetailNavigation(previousNav,previousDock,behavior);
    return;
  }
  // A tab is state, not a horizontal scroll position. iOS can re-snap a
  // scrolling pager when its footer/viewport changes during field reveal.
  getSheetInner('detail-sheet').dataset.fullNav = visibleDetailPages(pager)[index].dataset.detailNav;
  updateDetailPagerDots();
  animateDetailNavigation(previousNav,previousDock,behavior);
}

// A swipe is another explicit tab action, never a scrolling page strip.
// Only commit on release so viewport changes cannot re-snap the selection.
function bindDetailPagerSwipes(pager){
  if(pager.dataset.swipeBound === '1')return;
  pager.dataset.swipeBound = '1';
  const surface = pager.closest('.detail-sheet');
  let gesture = null;
  const selectionActive = ()=>Boolean(window.getSelection()?.toString());
  // Headings, labels and the item title accept drags; their normal tap action
  // remains intact. Actual editors, action buttons and drag controls own theirs.
  const controls = 'input,textarea,select,button:not(#detail-name),a,svg,canvas,'
    + '[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],'
    + '[role="spinbutton"],[role="switch"],[role="checkbox"],[role="listbox"],[draggable="true"],[data-detail-no-swipe],.leaflet-container';
  surface.addEventListener('touchstart',event=>{
    gesture = null;
    if(event.defaultPrevented || event.touches.length !== 1 || selectionActive())return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if(!target?.closest('.detail-page,.detail-head') || target.closest(controls))return;
    // Nested charts, calendar strips and other horizontal scrollers own their
    // entire gesture, including at an edge; never hand them off to tabs.
    for(let node = target;node && node !== surface;node = node.parentElement){
      if(node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX))return;
    }
    const touch = event.touches[0];
    // Leave screen-edge back/forward to iOS and the app shell.
    if(touch.clientX <= 28 || touch.clientX >= window.innerWidth - 28)return;
    gesture = {id:touch.identifier,x:touch.clientX,y:touch.clientY,
      revision:detailNavigationRevision,nav:detailCurrentNav(),claimed:false};
  },{passive:true});
  surface.addEventListener('touchmove',event=>{
    if(!gesture)return;
    if(event.touches.length !== 1 || gesture.revision !== detailNavigationRevision){gesture = null;return;}
    const touch = event.touches[0];
    if(touch.identifier !== gesture.id){gesture = null;return;}
    const dx = Math.abs(touch.clientX - gesture.x),dy = Math.abs(touch.clientY - gesture.y);
    if(!gesture.claimed){
      // Once a drag goes vertically, it stays a vertical scroll even if the
      // finger later curves sideways. Small movements remain normal taps.
      if(dy >= 10 && dx <= dy * 1.5){gesture = null;return;}
      if(dx < 10 || dx <= dy * 1.5)return;
      if(!event.cancelable){gesture = null;return;}
      gesture.claimed = true;
    }
    if(event.cancelable)event.preventDefault();
    else gesture = null;
  },{passive:false});
  surface.addEventListener('touchend',event=>{
    const start = gesture;
    gesture = null;
    if(!start?.claimed || event.touches.length || start.revision !== detailNavigationRevision
      || start.nav !== detailCurrentNav() || selectionActive())return;
    const touch = [...event.changedTouches].find(touch=>touch.identifier === start.id);
    if(!touch)return;
    // Claiming a drag also suppresses its synthetic click on the new panel.
    if(event.cancelable)event.preventDefault();
    const dx = touch.clientX - start.x,dy = Math.abs(touch.clientY - start.y);
    if(Math.abs(dx) < Math.max(48,Math.min(80,pager.clientWidth * .18)) || Math.abs(dx) <= dy * 1.5)return;
    const navs = detailIsSingleView() ? Object.keys(DETAIL_MINIMAL_NAV)
      : visibleDetailPages(pager).map(page=>page.dataset.detailNav);
    const current = detailIsSingleView() ? detailMinimalView() : start.nav;
    const index = navs.indexOf(current);
    const next = navs[index + (dx < 0 ? 1 : -1)];
    if(index < 0 || !next)return;
    if(detailIsSingleView())showDetailMinimalTab(next);
    else scrollDetailToNav(next,'smooth');
  },{passive:false});
  surface.addEventListener('touchcancel',()=>{gesture = null;},{passive:true});
}

function bindDetailPagerTabs(dotsWrap,pager){
  bindDetailPagerSwipes(pager);
  if(dotsWrap.dataset.bound === '1')return;
  dotsWrap.dataset.bound = '1';
  dotsWrap.addEventListener('click',event=>{
    const tab = event.target.closest('.detail-page-tab');
    if(!tab || !dotsWrap.contains(tab))return;
    if(tab.dataset.detailMinimal){showDetailMinimalTab(tab.dataset.detailMinimal);return;}
    const livePages = visibleDetailPages(pager);
    const index = Math.max(0,Math.min(livePages.length - 1,Number(tab.dataset.detailPage) || 0));
    scrollDetailToNav(livePages[index].dataset.detailNav,'smooth');
  });
  dotsWrap.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs = [...dotsWrap.querySelectorAll('.detail-page-tab')];
    const current = tabs.indexOf(event.target.closest('.detail-page-tab'));
    if(current < 0)return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    if(tabs[next].dataset.detailMinimal)showDetailMinimalTab(tabs[next].dataset.detailMinimal);
    else scrollDetailToNav(visibleDetailPages(pager)[next].dataset.detailNav,'smooth');
    tabs[next].focus({preventScroll:true});
  });
}

function renderDetailMinimalTabs(dotsWrap){
  if(dotsWrap.dataset.pageSig !== 'minimal'){
    dotsWrap.dataset.pageSig = 'minimal';
    dotsWrap.classList.add('minimal-tabs');
    dotsWrap.innerHTML = Object.entries(DETAIL_MINIMAL_NAV).map(([view,item])=>
      `<button type="button" class="detail-page-tab" role="tab" data-detail-minimal="${view}" title="${item.label}" aria-label="${item.label}"><i class="ti ${item.icon}" aria-hidden="true"></i><span>${item.label}</span></button>`
    ).join('');
  }
  const current = detailMinimalView();
  dotsWrap.querySelectorAll('.detail-page-tab').forEach(tab=>{
    const on = tab.dataset.detailMinimal === current;
    tab.classList.toggle('on',on);
    tab.setAttribute('aria-selected',on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
  });
}

function showDetailMinimalTab(view){
  scrollDetailToNav(view === 'summary' ? 'summary'
    : visibleDetailPages(getSheetInner('detail-sheet')?.querySelector('.detail-pager')).find(page=>page.dataset.detailNav !== 'summary')?.dataset.detailNav,'smooth');
}

// RENDER: syncs the compact pager navigation (skips hidden pages like order).
// Weather is its own tab until a conditional habit parks that editor inside
// its conditions page. Events, phone-calendar items, and minimal mode have no
// weather page. The Android app uses this same markup; native reminders stay
// on the schedule page.
function syncWeatherDetailPage(){
  const page = getSheetInner('detail-sheet')?.querySelector('.detail-page[data-detail-nav="weather"]');
  const weather = $('detail-weather-disclosure');
  if(!page || !weather)return;
  const root = $('detail-sheet');
  const inner = getSheetInner('detail-sheet');
  const event = root?.classList.contains('event-detail') || inner?.classList.contains('event-detail');
  const synced = root?.classList.contains('phone-calendar-detail') || inner?.classList.contains('phone-calendar-detail');
  page.hidden = detailIsSingleView() || event || synced || !page.contains(weather);
}

function updateDetailPagerDots(){
  const inner = getSheetInner('detail-sheet');
  const pager = inner?.querySelector('.detail-pager');
  const dotsWrap = inner?.querySelector('.detail-dots');
  if(!pager || !dotsWrap)return;
  syncWeatherDetailPage();
  dotsWrap.hidden = false;
  bindDetailPagerTabs(dotsWrap,pager);
  if(detailIsSingleView()){
    renderDetailMinimalTabs(dotsWrap);
    if(typeof syncDetailSummaryDock === 'function')syncDetailSummaryDock();
    return;
  }
  const pages = visibleDetailPages(pager);
  pages.forEach((panel,i)=>{
    panel.id = panel.id || `detail-page-${i}`;
    panel.setAttribute('role','tabpanel');
  });
  const kind = detailNavKind();
  const signature = pages.map(p=>`${p.dataset.detailNav || p.id}:${detailPageLabel(p.dataset.detailNav, kind)}`).join('|');
  if(dotsWrap.dataset.pageSig !== signature){
    dotsWrap.dataset.pageSig = signature;
    dotsWrap.classList.remove('minimal-tabs');
    dotsWrap.innerHTML = pages.map((panel,i)=>{
      const key = panel.dataset.detailNav || `page-${i}`;
      const item = DETAIL_PAGE_NAV[key] || {icon:'ti-circle'};
      const label = detailPageLabel(key, kind);
      return `<button type="button" class="detail-page-tab" role="tab" data-detail-page="${i}"${key === 'summary' ? ' data-detail-pinned="true"' : ''} title="${label}" aria-label="${label}" aria-controls="${panel.id}"><i class="ti ${item.icon}" aria-hidden="true"></i><span>${label}</span></button>`;
    }).join('');
  }
  const dots = [...dotsWrap.querySelectorAll('.detail-page-tab')];
  if(!dots.length)return;
  const nav = detailCurrentNav();
  inner.dataset.fullNav = nav || '';
  pages.forEach(panel=>panel.classList.toggle('is-active',panel.dataset.detailNav === nav));
  dots.forEach((dot,i)=>{
    const on = pages[i].dataset.detailNav === nav;
    dot.classList.toggle('on',on);
    dot.setAttribute('aria-selected',on ? 'true' : 'false');
    dot.tabIndex = on ? 0 : -1;
  });
  const active = dots.find(dot=>dot.classList.contains('on'));
  if(active && !active.hasAttribute('data-detail-pinned') && dotsWrap.clientWidth){
    // Keep the selected tab in the space beside the frozen Summary tab.
    const pinned = dotsWrap.querySelector('[data-detail-pinned]');
    const bar = dotsWrap.getBoundingClientRect(), tab = active.getBoundingClientRect();
    const left = bar.left + (pinned ? pinned.offsetWidth + 2 : 0);
    if(tab.left < left)dotsWrap.scrollLeft += tab.left - left;
    else if(tab.right > bar.right)dotsWrap.scrollLeft += tab.right - bar.right;
  }
  if(typeof syncDetailSummaryDock === 'function')syncDetailSummaryDock();
}

// RENDER: clears legacy tab chrome in pager
function renderDetailTabs(){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if (!pager) return;
  // No legacy sidebar tabs; updateDetailPagerDots owns the selected panel.
  const existingTabs = pager.querySelector('.detail-tabs');
  if (existingTabs) existingTabs.remove();
}

// PURE: computes month boundary dates and label
function monthFrame(offset = 0){
  const now = new Date();
  const anchor = new Date(now.getFullYear(),now.getMonth() + offset,1);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year,month,1);
  const last = new Date(year,month + 1,0);
  const label = first.toLocaleDateString(undefined,{month:'short',year:'numeric'});
  return {year,month,first,last,label,today:dateKey(Date.now())};
}

// PURE: format ms timestamp as ICS local datetime "YYYYMMDDTHHMMSS"
function icsDateTime(ts){
  const d = new Date(ts);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// PURE: format ms timestamp as ICS date "YYYYMMDD"
function icsDate(ts){
  const d = new Date(ts);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
// PURE: escape ICS text
function icsEscape(s){
  return String(s || '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
}
// PURE: build a VCALENDAR string for a scheduled or due-date task. Scheduled
// tasks become timed VEVENTs; due-date tasks become all-day VEVENTs so the system
// calendar fires a real alert — the bridge to native notifications on iOS.
function icsForHabit(h){
  const uid = `tings-${h.type}-${h.eventTime || h.dueDate || Date.now()}-${Date.now()}@local`;
  const stamp = icsDateTime(Date.now());
  const summary = icsEscape(h.name || '');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Tings//Habits//EN','BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${stamp}`];
  if(isTimedTask(h)){
    lines.push(`DTSTART:${icsDateTime(h.eventTime)}`);
    lines.push(`DTEND:${icsDateTime(h.eventTime + Math.max(1,clampDuration(h.durationMinutes)) * 60000)}`);
    lines.push(`SUMMARY:${summary}`);
  }else if(h.type === 'task' && h.dueDate){
    lines.push(`DTSTART;VALUE=DATE:${icsDate(h.dueDate)}`);
    lines.push(`SUMMARY:${summary}${h.hardDue ? ' (hard deadline)' : ''}`);
    lines.push('BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY',`DESCRIPTION:${summary}`,'END:VALARM');
  }else{
    return null;
  }
  lines.push('END:VEVENT','END:VCALENDAR');
  return lines.join('\r\n');
}

// HYBRID: trigger a .ics download for a scheduled or due-date task
function exportToCalendar(i){
  const data = load();
  const h = data[i];
  if(!h)return;
  const ics = icsForHabit(h);
  if(!ics){showToast('add a time or due date first');return;}
  const filename = `${(h.name || 'task').replace(/[^a-z0-9]+/gi,'-').slice(0,40)}.ics`;
  if(typeof downloadOrShareTextFile === 'function'){
    void downloadOrShareTextFile(filename,ics,'text/calendar','exported — open to add to calendar');
    return;
  }
  const blob = new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{if(a.isConnected)document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
  showToast('exported — open to add to calendar');
}

document.addEventListener('tierchange',()=>{
  // shell-ui.js (getSheetInner, openSheet) is loaded after this file, and the
  // initial tierchange can arrive before it has executed (e.g. while the
  // blocking leaflet <script> is still fetching). There is nothing to sync
  // until those helpers exist; a later tierchange re-runs this listener.
  if(typeof getSheetInner !== 'function')return;
  renderDetailTabs();
  // Re-open detail if it was open, so the layout applies
  if (detailIdx !== null) {
    const idx = detailIdx;
    openSheet('detail-sheet');
  }
});
