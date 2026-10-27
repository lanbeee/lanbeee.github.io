// Read-only home-screen projections. The Android shell renders these without
// starting a WebView; both foreground and closed refresh use this same code.
function compileNativeWidgetSnapshot(week,data,settings,now = Date.now()){
  const byId = new Map(data.map(h=>[h.hid,h]));
  const suggested = loadTodaySuggested(),expectations = suggested.expectations || {};
  const planned = new Map((week?.days || []).map(day=>[dateKey(day.dayBase),day]));
  const keys = new Set([dateKey(now),...planned.keys()]);
  const clean = value=>String(value || '').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120);
  const days = [...keys].sort().slice(0,8).map(key=>{
    const start = new Date(`${key}T00:00:00`).getTime(),next = new Date(start);
    next.setDate(next.getDate()+1);
    const end = next.getTime(),day = planned.get(key);
    const subject = row=>byId.get(row.hid || row.h?.hid) || (!row.hid && !row.h?.hid ? data[row.i] : null);
    const groups = new Map();
    for(const row of day?.timeline || []){
      if(!['fill','scheduled'].includes(row.kind))continue;
      const h = subject(row);if(!h)continue;
      if(!groups.has(h.hid))groups.set(h.hid,[]);
      groups.get(h.hid).push(row);
    }
    const active = new Set();
    for(const [hid,rows] of groups){
      const h = byId.get(hid);
      if(h.type === 'task' && isTaskDone(h))continue;
      for(const row of agendaRowsAfterCompletions(h,rows,start))active.add(row);
    }
    const timeline = (day?.timeline || []).filter(row=>
      ['travel','blocked'].includes(row.kind) || active.has(row));
    const rows = timeline.filter(row=>Number.isFinite(row.start) && Number.isFinite(row.end) && row.end>row.start)
      .map(row=>{
        const h = subject(row);
        const result = {start:row.start,end:row.end,kind:row.kind,
          hid:['fill','scheduled'].includes(row.kind) ? h?.hid || '' : '',
          title:clean(row.kind === 'travel' ? `Travel${row.toName ? ` to ${row.toName}` : ''}`
            : row.kind === 'blocked' ? row.label || 'Busy' : h?.name || 'Ting')};
        if(h && h.type !== 'zero' && !isEventItem(h) && ['fill','scheduled'].includes(row.kind)){
          result.actionKey = JSON.stringify([h.hid,key,row.occurrenceKey || '',row.start,row.end]);
          result.completion = {hid:h.hid,dayKey:key,occurrenceKey:row.occurrenceKey || '',scheduleOptionId:row.scheduleOptionId || '',
            minutes:h.breakable ? Math.max(1,Math.round((row.end-row.start)/60000)) : 0};
        }
        return result;
      }).sort((a,b)=>a.start-b.start || a.end-b.end).slice(0,200);
    // The planner's shared gap helper includes busy time, travel and every
    // committed habit/task. Keep the full day so native code can advance time.
    const occupied = timeline.map(row=>row.kind === 'blocked' ? {...row,kind:'scheduled'} : row);
    const gaps = day ? computeDayFreeGaps({...day,timeline:occupied,isToday:false},settings,now).gaps
      .map(g=>({start:Math.max(start,g.start),end:Math.min(end,g.end)})).filter(g=>g.end>g.start) : [];
    const ids = new Set([...(expectations[key]?.hids || []),...groups.keys()]);
    for(const h of data)if(habitOccurrenceLogsForDay(h,start).length)ids.add(h.hid);
    const subjects = [...ids].map(hid=>byId.get(hid)).filter(h=>h && h.type !== 'zero');
    // Events have no completion button on Home. Show their clock status
    // separately, rather than silently treating attendance as a logged task.
    const events = subjects.filter(isEventItem).map(h=>({hid:h.hid,
      end:Math.max(0,...(groups.get(h.hid) || []).map(row=>row.end))}));
    const items = subjects.filter(h=>!isEventItem(h)).map(h=>({hid:h.hid,title:clean(h.name),
      done:h.type === 'task' ? isTaskDone(h) : completedOnDay(h,start),
      detail:h.breakable ? `${Math.min(breakableProgressMinutes(h,start),breakableTotalMinutes(h))}/${breakableTotalMinutes(h)} min`
        : habitHasMultipleDailyOccurrences(h) ? `${Math.min(habitOccurrenceLogsForDay(h,start).length,habitOccurrenceTargetForDay(h,start))}/${habitOccurrenceTargetForDay(h,start)}` : ''}));
    // Use the exact displayed IDs and occurrence keys used by Home's missed
    // pill. Saved expectations are evidence, not a fresh overdue sweep.
    const display = day?.homeDisplayedTimeline || timeline;
    const displayed = display.filter(row=>['fill','scheduled'].includes(row.kind) && subject(row));
    const current = displayed.filter(row=>!subject(row).pinned);
    const rendered = {[key]:{occurrences:displayed.filter(row=>habitHasMultipleDailyOccurrences(subject(row)))}};
    const dropped = day && key === dateKey(now)
      ? collectMissedFromSnapshot(data,current.map(row=>subject(row)?.hid).filter(Boolean),suggested,rendered,now) : [];
    const {visible,hidden} = partitionDroppedItems(dropped,now);
    const missed = visible.map(row=>({hid:row.hid,title:clean(row.name),expectedDay:row.expectedDay,
      occurrenceKey:row.occurrenceKey || '',dayLabel:row.dayLabel,detail:row.dayLabel}));
    return {key,start,end,ready:Boolean(day),rows,gaps,
      progress:{total:items.length,done:items.filter(h=>h.done).length,
        items:items.sort((a,b)=>Number(a.done)-Number(b.done)).slice(0,100),
        events:{total:events.length,upcoming:events.filter(event=>event.end>now).length},
        missed:missed.length,hidden:hidden.length,missedItems:missed.slice(0,100)}};
  });
  return {version:1,updatedAt:now,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,days};
}

// Completion stays in the canonical app so its normal persistence, value
// prompt, duplicate protection and Undo all apply to widget taps as well.
function completeNativeWidgetItem(action){
  const data=load(),index=data.findIndex(h=>h.hid === action?.hid),h=data[index],now=Date.now();
  if(!h || h.type === 'zero' || isEventItem(h) || action.dayKey !== dateKey(now)
    || !/^[0-9a-f]{32}$/.test(action.operationId || '')){
    showToast('This widget item changed. Open Agenda to refresh it.');return;
  }
  const logs=normalizeLogs(h.logs);
  if(logs.some(log=>log?.operationId === action.operationId)
    || (h.type === 'task' && isTaskDone(h))
    || (!h.breakable && (action.occurrenceKey
      ? logs.some(log=>!isPlanLog(log) && logOccurrenceKey(log) === action.occurrenceKey)
      : completedOnDay(h,dayStart(now))))){showToast('Already done.');return;}
  if(action.scheduleOptionId && !normalizeHabitScheduleOptions(h.scheduleOptions).some(option=>option.id === action.scheduleOptionId)){
    showToast('This scheduled session changed. Open Agenda to refresh it.');return;
  }
  const remaining=h.breakable ? Math.max(0,breakableTotalMinutes(h)-breakableProgressMinutes(h,dayStart(now))) : 0;
  if(h.breakable && !remaining){showToast('Already done.');return;}
  const opts={occurrenceKey:action.occurrenceKey || undefined,scheduleOptionId:action.scheduleOptionId || undefined,
    scheduledDay:action.dayKey,source:'native_widget',operationId:action.operationId,
    ...(h.breakable ? {minutes:Math.min(remaining,Math.max(1,Number(action.minutes) || 1))} : {})};
  requestLogTing(index,()=>{
    refreshOpenViews();renderHomePresentationOnly();queueNativeBackgroundSnapshot();
  },opts);
}

// Runtime bridge: absent from the PWA and the disposable background WebView.
document.addEventListener('DOMContentLoaded',()=>{
  const bridge = window.TingsNative?.isNative && window.TingsNative.widgets;
  if(!bridge)return;
  let draining = false,again = false;
  async function drain(){
    if(draining){again = true;return;}
    draining = true;
    try{
      let request;
      while((request = (await bridge.takeLaunchRequest()).request)){
        for(const sheet of document.querySelectorAll('.sheet-wrap.open'))closeSheet(sheet.id);
        const pane = getPane();
        if(pane?.dataset.activeSheet)closeSheet(pane.dataset.activeSheet);
        closeSearch();
        if(request.kind === 'add'){
          document.getElementById('open-add').click();
          document.querySelector('#type-seg [data-v="task"]').click();
          document.getElementById('ting-message').focus({preventScroll:true});
        }else if(request.kind === 'done'){
          completeNativeWidgetItem(request.completion);
        }else if(request.kind === 'item'){
          const index = load().findIndex(h=>h.hid === request.hid);
          if(index>=0)openDetail(index);
          else showToast('This item is no longer in Tings.');
        }else if(request.kind === 'missed' || request.kind === 'hide'){
          renderHomeIfChanged(true);
          const dropped = collectSlippedDropped();
          if(request.kind === 'hide'){
            const item = dropped.find(row=>row.hid === request.hid && row.expectedDay === request.expectedDay
              && (row.occurrenceKey || '') === (request.occurrenceKey || ''));
            if(item){toggleMissedHide(item,true);queueNativeBackgroundSnapshot();}
            else showToast('This item is no longer missed.');
          }
          openSlippedSheet();
        }else if(request.kind === 'today'){
          renderHomeIfChanged(true);
          window.scrollTo({top:0,behavior:'instant'});
        }
      }
    }catch(error){showToast(error.message || 'Could not open the widget.');}
    finally{draining = false;if(again){again = false;void drain();}}
  }
  void bridge.addListener('launchRequest',()=>void drain());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void drain();});
  void bridge.ready().then(drain).catch(()=>{});
});
