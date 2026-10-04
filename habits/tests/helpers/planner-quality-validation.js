const {DAY}=require('./planner-quality-fixtures');
function independentViolations(s,result){
  const errors=[];
  const byId=new Map(s.data.map(h=>[h.hid,h]));
  const rows=result.rows.filter(row=>row.kind!=='travel');
  const minutes=row=>(row.end-row.start)/60000;
  for(const row of rows){
    const h=byId.get(row.hid),base=(s.dayBase == null ? DAY : s.dayBase)+row.day*86400000;
    const start=(row.start-base)/60000,end=(row.end-base)/60000;
    const weekday=new Date(base).getDay();
    if(h.allowedWeekdays.length && !h.allowedWeekdays.includes(weekday))errors.push(`weekday:${h.hid}`);
    if(h.allowedMonthDays.length && !h.allowedMonthDays.includes(new Date(base).getDate()))errors.push(`monthday:${h.hid}`);
    if(row.kind==='fill' && !h.allowedTimeStartAnchor && !h.allowedTimeEndAnchor && !h.scheduleOptions?.length){
      if(h.allowedTimeStart!=null && (h.allowedTimeEnd==null || h.allowedTimeEnd>=h.allowedTimeStart) && start<h.allowedTimeStart-1e-6)errors.push(`early:${h.hid}`);
      if(h.allowedTimeEnd!=null && (h.allowedTimeStart==null || h.allowedTimeEnd>=h.allowedTimeStart) && end>h.allowedTimeEnd+1e-6)errors.push(`late:${h.hid}`);
    }
    if(!h.breakable && Math.abs(minutes(row)-h.durationMinutes)>1e-6)errors.push(`duration:${h.hid}`);
    if(h.breakable && minutes(row)>h.durationMinutes+1e-6)errors.push(`split-overfill:${h.hid}`);
    for(const block of s.settings.blockedTimes){
      if(block.days?.length && !block.days.includes(weekday))continue;
      if(block.start<=block.end && start<block.end && end>block.start)errors.push(`block:${h.hid}:${block.label}`);
    }
    if(h.type==='task' && h.eventTime==null && h.dueDate!=null){
      const earliest=h.dueDate-(h.earlyWindowDays || 0)*86400000;
      const latest=h.dueDate+(h.delayAllowanceDays || 0)*86400000;
      if(base<earliest || base>latest)errors.push(`task-date:${h.hid}`);
    }
    if(h.snoozedUntil && row.start<h.snoozedUntil)errors.push(`snooze:${h.hid}`);
    if(h.hid==='logged' && row.day===0)errors.push('completed-today');
    if(h.hid==='zero')errors.push('zero-habit-scheduled');
    if(h.eventTime!=null && row.start!==h.eventTime)errors.push(`fixed-clock:${h.hid}`);
    if(h.locationIds?.length && !h.anywhereAllowed && !h.locationIds.includes(row.locationId))errors.push(`venue:${h.hid}`);
    if(row.locationId==='closed')errors.push(`closed-venue:${h.hid}`);
    if(h.hid==='dry-walk' || h.hid==='outdoor' || h.weatherProfileId==='dry' && s.id.startsWith('mixed')){
      if(start<720)errors.push(`hard-weather:${h.hid}`);
    }
  }
  for(const h of s.data){
    const own=rows.filter(row=>row.hid===h.hid);
    if(h.type==='task' && !h.breakable && own.length>1)errors.push(`duplicate-task:${h.hid}`);
    if(h.type==='task' && own.reduce((sum,r)=>sum+minutes(r),0)>h.durationMinutes+1e-6)errors.push(`task-overfill:${h.hid}`);
    for(const link of h.scheduleLinks || [])for(const row of own){
      const anchors=rows.filter(r=>r.hid===link.anchorHid && r.day===row.day);
      if(link.requireSameDay && !anchors.length)errors.push(`missing-link:${h.hid}`);
      if(anchors.length && !anchors.some(a=>link.direction==='after'
        ? row.start>=a.end
        : row.end<=a.start))errors.push(`link-order:${h.hid}`);
      if(link.adjacency==='direct' && anchors.length){
        const before=link.direction==='after'?anchors[0]:row,after=link.direction==='after'?row:anchors[0];
        if(rows.some(r=>r.day===row.day && r.hid!==before.hid && r.hid!==after.hid
          && r.start>=before.end && r.end<=after.start))errors.push(`link-interloper:${h.hid}`);
      }
    }
  }
  for(const [hid,required] of Object.entries(s.required || {}))if((result.totals[hid] || 0)<required)errors.push(`required:${hid}`);
  for(const [hid,start] of Object.entries(s.earliest || {}))if(rows.some(r=>r.hid===hid && (r.start-DAY)/60000<start))errors.push(`earliest:${hid}`);
  for(const hid of s.absent || [])if(rows.some(r=>r.hid===hid))errors.push(`absent:${hid}`);
  for(const [hid,place] of Object.entries(s.expectedPlaces || {}))if(!rows.some(r=>r.hid===hid && r.locationId===place))errors.push(`expected-place:${hid}`);
  for(const [hid,days] of Object.entries(s.expectedDays || {})){
    const actual=[...new Set(rows.filter(r=>r.hid===hid).map(r=>r.day))].sort();
    if(JSON.stringify(actual)!==JSON.stringify(days))errors.push(`expected-days:${hid}:${actual}`);
  }
  for(const [hid,clock] of Object.entries(s.expectedClocks || {}))if(!rows.some(r=>r.hid===hid && r.day===clock.day
    && r.start===DAY+clock.day*86400000+clock.start*60000))errors.push(`expected-clock:${hid}`);
  for(const [hid,expected] of Object.entries(s.exactTotals || {}))if(Math.abs((result.totals[hid] || 0)-expected)>1e-6)errors.push(`exact-total:${hid}`);
  for(const [hid,byDay] of Object.entries(s.dayMinutes || {}))for(const [day,expected] of Object.entries(byDay)){
    const actual=rows.filter(r=>r.hid===hid && r.day===Number(day)).reduce((sum,r)=>sum+minutes(r),0);
    if(Math.abs(actual-expected)>1e-6)errors.push(`day-minutes:${hid}:${day}:${actual}`);
  }
  return errors;
}
module.exports={independentViolations};
