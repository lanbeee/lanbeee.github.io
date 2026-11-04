// Local iCalendar import. ICAL.js 2.2.1 is vendored (MPL-2.0) so installed
// PWAs can parse Google/Apple/Outlook exports without a network request.
// Expansion is bounded: a full Google export may contain decades of history.
const CALENDAR_ICS_MAX_EVENTS = 5000;
const CALENDAR_ICS_MAX_STEPS = 100000;

function calendarIcsDateRange(){
  const fromInput = document.getElementById('calendar-ics-from');
  const toInput = document.getElementById('calendar-ics-to');
  const today = new Date();
  const later = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90);
  if(fromInput && !fromInput.value)fromInput.value = dateKey(today.getTime());
  if(toInput && !toInput.value)toInput.value = dateKey(later.getTime());
  const parse = value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return NaN;
    const [y,m,d] = value.split('-').map(Number);
    const result = new Date(y,m-1,d);
    return dateKey(result.getTime()) === value ? result.getTime() : NaN;
  };
  const from = fromInput ? parse(fromInput.value) : dayStart(today.getTime());
  const last = toInput ? parse(toInput.value) : dayStart(later.getTime());
  if(!Number.isFinite(from) || !Number.isFinite(last) || last < from){
    throw new Error('Choose a valid ICS date range, with the end on or after the start.');
  }
  const end = new Date(last);
  end.setDate(end.getDate()+1);
  return {from,to:end.getTime()};
}

// ICAL handles embedded VTIMEZONEs. Google also exports IANA TZIDs without
// VTIMEZONE; use the browser's current zone database for those wall times.
function calendarIcsTimeMs(time, component, property = 'dtstart'){
  if(!time)throw new Error('An ICS event is missing its date.');
  if(time.isDate)return new Date(time.year,time.month-1,time.day).getTime();
  if(time.zone && time.zone.tzid !== 'floating')return time.toJSDate().getTime();
  const tzid = component.getFirstProperty(property)?.getParameter('tzid');
  if(!tzid)return new Date(time.year,time.month-1,time.day,time.hour,time.minute,time.second).getTime();
  let formatter;
  try{
    formatter = new Intl.DateTimeFormat('en-GB', {timeZone:tzid,year:'numeric',month:'2-digit',
      day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  }catch(_){throw new Error(`Unsupported calendar time zone: ${tzid}. Export with time zone definitions and try again.`);}
  const wall = Date.UTC(time.year,time.month-1,time.day,time.hour,time.minute,time.second);
  let ms = wall;
  for(let i=0;i<4;i++){
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
    const shown = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    const next = ms + wall - shown;
    if(next === ms)break;
    ms = next;
  }
  return ms;
}

function parseCalendarIcsText(text, {from,to} = {}){
  if(!Number.isFinite(from) || !Number.isFinite(to) || to <= from)throw new Error('Choose a valid ICS date range.');
  const raw = String(text || '').replace(/^\uFEFF/,'').trim();
  if(!/^BEGIN:VCALENDAR\s*$/im.test(raw) || !/END:VCALENDAR\s*$/i.test(raw)){
    throw new Error('This is not an ICS calendar. Choose the .ics file from your calendar export.');
  }
  const calendar = new ICAL.Component(ICAL.parse(raw));
  if(calendar.name !== 'vcalendar')throw new Error('Choose an ICS calendar file.');
  if(String(calendar.getFirstPropertyValue('method')).toUpperCase() === 'CANCEL'){
    throw new Error('This file is a cancellation notice. Import a full calendar export instead.');
  }
  // Keep the newest version of duplicate UID/RECURRENCE-ID records.
  const components = new Map();
  for(const c of calendar.getAllSubcomponents('vevent')){
    const uid = c.getFirstPropertyValue('uid');
    if(!uid)throw new Error('An ICS event is missing its UID. Export the calendar again.');
    const key = JSON.stringify([uid,String(c.getFirstPropertyValue('recurrence-id') || '')]);
    const previous = components.get(key);
    if(!previous || Number(c.getFirstPropertyValue('sequence') || 0) >= Number(previous.getFirstPropertyValue('sequence') || 0))components.set(key,c);
  }
  const exceptions = new Map();
  for(const c of components.values()){
    if(!c.hasProperty('recurrence-id'))continue;
    const uid = c.getFirstPropertyValue('uid');
    if(!exceptions.has(uid))exceptions.set(uid,[]);
    exceptions.get(uid).push(c);
  }
  const events = new Map();
  let steps = 0;
  const cancelled = c=>String(c.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED';
  const append = (item,startDate,endDate,recurrenceId)=>{
    const c = item.component;
    if(cancelled(c))return;
    const start = calendarIcsTimeMs(startDate,c);
    const end = calendarIcsTimeMs(endDate,c,c.hasProperty('dtend') ? 'dtend' : 'dtstart');
    // RFC 5545 permits an instantaneous VEVENT without DTEND/DURATION.
    // The shared task mapper gives it the planner's minimum one-minute slot.
    if(!Number.isFinite(start) || !Number.isFinite(end) || end < start){
      throw new Error('An ICS event has no valid end time or duration. Export the calendar again.');
    }
    if(start >= to || (end === start ? start < from : end <= from))return;
    const id = calendarIcsExternalId(item.uid,recurrenceId ?? 'single');
    events.set(id,{id,subject:item.summary || 'untitled',start,end,isAllDay:startDate.isDate,
      source:'ics',calendarSeriesId:(item.isRecurring() || c.hasProperty('recurrence-id')) ? calendarIcsExternalId(item.uid,'series') : null});
    if(events.size > CALENDAR_ICS_MAX_EVENTS)throw new Error('More than 5,000 events in this range. Choose a shorter ICS date range.');
  };
  for(const c of components.values()){
    if(c.hasProperty('recurrence-id') || cancelled(c))continue;
    const related = exceptions.get(c.getFirstPropertyValue('uid')) || [];
    const event = new ICAL.Event(c,{exceptions:related});
    if(!event.isRecurring()){
      append(event,event.startDate,event.endDate,null);
      continue;
    }
    // ICAL's RDATE-only iterator does not include DTSTART on its own.
    if(!c.hasProperty('rrule'))c.addPropertyWithValue('rdate',event.startDate.clone());
    const occurrenceKey = (time,comp,property)=>time.isDate ? time.toString() : calendarIcsTimeMs(time,comp,property);
    const direct = new Map(related.map(comp=>[occurrenceKey(comp.getFirstPropertyValue('recurrence-id'),comp,'recurrence-id'),comp]));
    const earliestShift = related.reduce((shift,comp)=>{
      if(comp.getFirstProperty('recurrence-id').getParameter('range') !== 'THISANDFUTURE' || cancelled(comp))return shift;
      const moved = calendarIcsTimeMs(comp.getFirstPropertyValue('dtstart'),comp);
      return Math.min(shift,moved-calendarIcsTimeMs(comp.getFirstPropertyValue('recurrence-id'),comp,'recurrence-id'));
    },0);
    const iterator = event.iterator();
    let occurrence;
    while((occurrence = iterator.next())){
      if(++steps > CALENDAR_ICS_MAX_STEPS)throw new Error('This calendar has too many recurring occurrences. Choose a smaller export.');
      // Exceptions shifted into the range are also handled independently below.
      const original = calendarIcsTimeMs(occurrence,c);
      if(original + earliestShift >= to)break;
      const key = occurrenceKey(occurrence,c,'dtstart');
      // Exact exceptions are appended below. Match their instant so UTC and
      // TZID spellings of the same recurrence cannot create two meetings.
      if(direct.has(key))continue;
      const override = event.exceptions[event.findRangeException(occurrence)];
      if(override && cancelled(override.component))continue;
      const detail = event.getOccurrenceDetails(occurrence);
      append(detail.item,detail.startDate,detail.endDate,key);
    }
  }
  // Include detached exceptions and meetings moved into the chosen date range.
  for(const list of exceptions.values())for(const c of list){
    if(cancelled(c))continue;
    const master = components.get(JSON.stringify([c.getFirstPropertyValue('uid'),'']));
    if(master && cancelled(master))continue;
    const event = new ICAL.Event(c);
    const recurrence = event.recurrenceId;
    append(event,event.startDate,event.endDate,recurrence.isDate ? recurrence.toString() : calendarIcsTimeMs(recurrence,c,'recurrence-id'));
  }
  return {events:[...events.values()].sort((a,b)=>a.start-b.start || a.id.localeCompare(b.id)),format:'ics'};
}

// Two independently seeded 32-bit hashes keep identities comfortably below the
// persisted externalId limit, even for long provider UIDs.
function calendarIcsExternalId(uid, occurrence){
  const value = JSON.stringify([uid,occurrence]);
  let a=2166136261,b=5381;
  for(let i=0;i<value.length;i++){
    a=Math.imul(a ^ value.charCodeAt(i),16777619);
    b=Math.imul(b,33) ^ value.charCodeAt(i);
  }
  return `ics:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}

async function parseCalendarIcsFile(file,range){
  if(file.size > 20*1024*1024)throw new Error('This ICS file is larger than 20 MB. Export a smaller calendar.');
  const result = parseCalendarIcsText(await file.text(),range);
  if(!result.events.length)throw new Error('No events found in this ICS date range. Change the dates and choose the file again.');
  return result;
}
