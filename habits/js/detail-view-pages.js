const DETAIL_PAGE_NAV = {
  calendar:{label:'calendar',icon:'ti-calendar-week'},
  schedule:{label:'schedule',icon:'ti-calendar-time'},
  effort:{label:'effort',icon:'ti-progress-check'},
  identity:{label:'identity',icon:'ti-id'},
  actions:{label:'actions',icon:'ti-dots'}
};

// Visual-only: drop the merged calendar+stats pane and the effort pane, fold
// duration + due into schedule, and strip schedule/identity chrome. What is
// left is short enough to read as one scrolling page, so the pager stacks
// vertically and the tab strip goes away. Does not change saved habit fields.
const MINIMAL_HIDDEN_DETAIL_PAGES = ['calendar','effort'];
let _minimalEffortHomes = null;
function applyDetailMinimalMode(){
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  const sheet = $('detail-sheet');
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if(sheet)sheet.classList.toggle('minimal-detail', minimal);
  if(pager){
    MINIMAL_HIDDEN_DETAIL_PAGES.forEach(nav=>{
      const page = pager.querySelector(`.detail-page[data-detail-nav="${nav}"]`);
      if(page)page.hidden = minimal;
    });
    if(minimal)pager.scrollTo({left:0,behavior:'auto'});
    else{
      const pages = visibleDetailPages(pager);
      const width = Math.max(1,pager.clientWidth);
      const idx = Math.round(pager.scrollLeft / width);
      if(idx < 0 || idx >= pages.length)pager.scrollTo({left:0,behavior:'auto'});
    }
  }

  // Duration and the task due date still matter in minimal mode, so they move
  // up into schedule. Auto mark done does not — it stays behind on the hidden
  // effort pane, which keeps its saved value untouched.
  const slot = $('detail-minimal-effort');
  const durationField = $('detail-duration-field');
  const autoMarkField = $('detail-auto-mark-field');
  const dueRow = $('detail-due-row');
  const dueHint = $('detail-due-hint');
  if(!_minimalEffortHomes && durationField && autoMarkField){
    _minimalEffortHomes = {
      durationParent:durationField.parentElement,
      durationNext:durationField.nextElementSibling,
      autoParent:autoMarkField.parentElement,
      autoNext:autoMarkField.nextElementSibling,
      dueParent:dueRow ? dueRow.parentElement : null,
      dueNext:dueRow ? dueRow.nextElementSibling : null,
      hintParent:dueHint ? dueHint.parentElement : null,
      hintNext:dueHint ? dueHint.nextElementSibling : null
    };
  }
  const restoreNode = (node,parent,next)=>{
    if(!node || !parent)return;
    if(next && next.parentElement === parent)parent.insertBefore(node,next);
    else parent.appendChild(node);
  };
  if(minimal && slot && durationField){
    slot.appendChild(durationField);
    if(dueRow)slot.appendChild(dueRow);
    if(dueHint)slot.appendChild(dueHint);
    slot.hidden = false;
    if(_minimalEffortHomes){
      restoreNode(autoMarkField,_minimalEffortHomes.autoParent,_minimalEffortHomes.autoNext);
    }
  }else if(_minimalEffortHomes){
    restoreNode(durationField,_minimalEffortHomes.durationParent,_minimalEffortHomes.durationNext);
    restoreNode(autoMarkField,_minimalEffortHomes.autoParent,_minimalEffortHomes.autoNext);
    restoreNode(dueRow,_minimalEffortHomes.dueParent,_minimalEffortHomes.dueNext);
    restoreNode(dueHint,_minimalEffortHomes.hintParent,_minimalEffortHomes.hintNext);
    if(slot)slot.hidden = true;
  }

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
  if(detailIsSingleView()){
    const page = visibleDetailPages(pager)[index];
    if(page)pager.scrollTo({top:page.offsetTop - pager.offsetTop,behavior});
    return;
  }
  pager.scrollTo({left:pager.clientWidth * index,behavior});
  updateDetailPagerDots();
}

// RENDER: syncs the compact pager navigation (skips hidden pages like order).
function updateDetailPagerDots(){
  const inner = getSheetInner('detail-sheet');
  const pager = inner?.querySelector('.detail-pager');
  const dotsWrap = inner?.querySelector('.detail-dots');
  if(!pager || !dotsWrap)return;
  // One scrolling page has nothing to page between — the tab strip would just
  // be three buttons that scroll a page the user can already see.
  if(detailIsSingleView()){
    dotsWrap.hidden = true;
    dotsWrap.innerHTML = '';
    delete dotsWrap.dataset.pageSig;
    return;
  }
  dotsWrap.hidden = false;
  const pages = visibleDetailPages(pager);
  pages.forEach((panel,i)=>{
    panel.id = panel.id || `detail-page-${i}`;
    panel.setAttribute('role','tabpanel');
  });
  const signature = pages.map(p=>p.dataset.detailNav || p.id).join('|');
  if(dotsWrap.dataset.pageSig !== signature){
    dotsWrap.dataset.pageSig = signature;
    dotsWrap.style.gridTemplateColumns = `repeat(${Math.max(1,pages.length)},minmax(0,1fr))`;
    dotsWrap.innerHTML = pages.map((panel,i)=>{
      const key = panel.dataset.detailNav || `page-${i}`;
      const item = DETAIL_PAGE_NAV[key] || {label:key,icon:'ti-circle'};
      return `<button type="button" class="detail-page-tab" role="tab" data-detail-page="${i}" title="${item.label}" aria-label="${item.label}" aria-controls="${panel.id}"><i class="ti ${item.icon}" aria-hidden="true"></i><span>${item.label}</span></button>`;
    }).join('');
  }
  if(dotsWrap.dataset.bound !== '1'){
    dotsWrap.dataset.bound = '1';
    dotsWrap.addEventListener('click',event=>{
      const tab = event.target.closest('.detail-page-tab');
      if(!tab || !dotsWrap.contains(tab))return;
      const livePages = visibleDetailPages(pager);
      const index = Math.max(0,Math.min(livePages.length - 1,Number(tab.dataset.detailPage) || 0));
      pager.scrollTo({left:pager.clientWidth * index,behavior:'smooth'});
    });
  }
  const dots = [...dotsWrap.querySelectorAll('.detail-page-tab')];
  if(!dots.length)return;
  const page = Math.max(0,Math.min(dots.length - 1,Math.round(pager.scrollLeft / Math.max(1,pager.clientWidth))));
  dots.forEach((dot,i)=>{
    dot.classList.toggle('on',i === page);
    dot.setAttribute('aria-selected',i === page ? 'true' : 'false');
    dot.tabIndex = i === page ? 0 : -1;
  });
}

// RENDER: clears legacy tab chrome in pager
function renderDetailTabs(){
  const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
  if (!pager) return;
  // No sidebar tabs in any tier — panes now look exactly like mobile-portrait.
  const existingTabs = pager.querySelector('.detail-tabs');
  if (existingTabs) existingTabs.remove();
  [...pager.querySelectorAll('.detail-page')].forEach(p=>p.classList.remove('is-active'));
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
  const blob = new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(h.name || 'task').replace(/[^a-z0-9]+/gi,'-').slice(0,40)}.ics`;
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
