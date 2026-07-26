// Calendar import — temporary PDF path (Outlook/Teams + Google Calendar prints)
// feeding the same timed-task pipeline that Microsoft/Google OAuth will reuse.
//
// RN PORT NOTES:
//   - PURE parsers + applyImport port verbatim.
//   - PDF text extraction swaps pdf.js for a native PDF kit; OAuth adapters come later.

const CALENDAR_PDF_JS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const CALENDAR_PDF_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const CALENDAR_PDF_JS_FALLBACK = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js';
const CALENDAR_PDF_WORKER_FALLBACK = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const OUTLOOK_TIME_LINE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*$/i;
const OUTLOOK_DAY_HEADER = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s*$/i;

// Google Calendar "Schedule" print: "Thu Jul 30, 2026" then "1:30pm - 2:30pm   Title"
const GCAL_MONTHS = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};
const GCAL_DAY_HEADER = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s*$/i;
const GCAL_TIMED_LINE = /^(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)\s+(.+)$/i;
const GCAL_ALL_DAY_LINE = /^All day\s+(.+)$/i;
const GCAL_CALENDAR_META = /^Calendar:\s+/i;

let pdfJsLoadPromise = null;

// PURE: skip Teams/Outlook boilerplate when walking back to find a title.
function isOutlookBoilerplateLine(line){
  const t = String(line || '').trim();
  if(!t)return true;
  if(OUTLOOK_DAY_HEADER.test(t))return true;
  if(OUTLOOK_TIME_LINE.test(t))return true;
  if(/^_{5,}/.test(t))return true;
  if(/^NOTICE:/i.test(t))return true;
  if(/^Location:/i.test(t))return true;
  if(/^Organizer:/i.test(t))return true;
  if(/^Required Attendees:/i.test(t))return true;
  if(/^Optional Attendees:/i.test(t))return true;
  if(/^Microsoft Teams meeting$/i.test(t))return true;
  if(/^Join:/i.test(t))return true;
  if(/^Meeting ID:/i.test(t))return true;
  if(/^Passcode:/i.test(t))return true;
  if(/^Need help\?/i.test(t))return true;
  if(/^For organizers:/i.test(t))return true;
  if(/^Join Zoom Meeting$/i.test(t))return true;
  if(/^When:/i.test(t))return true;
  if(/^Where:/i.test(t))return true;
  if(/^From:/i.test(t))return true;
  if(/^Sent:/i.test(t))return true;
  if(/^To:/i.test(t))return true;
  if(/^Subject:/i.test(t))return true;
  if(/^Hi there,?$/i.test(t))return true;
  if(/^Hi all,?$/i.test(t))return true;
  if(/^Calendar,/i.test(t))return true;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}\s+to\s+\d{1,2}\/\d{1,2}\/\d{4}/i.test(t))return true;
  return false;
}

// PURE: parse "7/20/2026 11:00 AM" in local timezone → ms.
function parseOutlookLocalDateTime(dateStr, timeStr){
  const dm = String(dateStr || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if(!dm || !tm)return null;
  let hour = parseInt(tm[1],10);
  const minute = parseInt(tm[2],10);
  const ampm = tm[3].toUpperCase();
  if(ampm === 'PM' && hour !== 12)hour += 12;
  if(ampm === 'AM' && hour === 12)hour = 0;
  const month = parseInt(dm[1],10) - 1;
  const day = parseInt(dm[2],10);
  const year = parseInt(dm[3],10);
  const ms = new Date(year, month, day, hour, minute, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// PURE: stable external id for a PDF (or other) calendar occurrence.
function calendarEventExternalId(ev, source){
  const start = Number(ev && ev.start) || 0;
  const end = Number(ev && ev.end) || 0;
  const name = String((ev && ev.subject) || '').trim().toLowerCase().replace(/\s+/g,' ').slice(0,80);
  return `${source || 'pdf'}:${start}|${end}|${name}`.slice(0,256);
}

// PURE: Outlook / Teams agenda-print text → provider-agnostic events.
function parseOutlookTeamsPdfText(text){
  const lines = String(text || '').split(/\r?\n/).map(l=>l.replace(/\u00a0/g,' ').trimEnd());
  const events = [];
  for(let i = 0; i < lines.length; i++){
    const line = String(lines[i] || '').trim();
    const m = line.match(OUTLOOK_TIME_LINE);
    if(!m)continue;
    const start = parseOutlookLocalDateTime(m[2], m[3]);
    const end = parseOutlookLocalDateTime(m[2], m[4]);
    if(start == null || end == null || end <= start)continue;
    let subject = 'untitled';
    for(let j = i - 1; j >= 0; j--){
      const prev = String(lines[j] || '').trim();
      if(!prev)continue;
      if(isOutlookBoilerplateLine(prev))continue;
      // Stop if we hit another meeting's time line while walking back.
      if(OUTLOOK_TIME_LINE.test(prev))break;
      subject = prev.slice(0,60);
      break;
    }
    const id = calendarEventExternalId({subject,start,end}, 'pdf');
    events.push({
      id,
      subject,
      start,
      end,
      isAllDay:false,
      locationText:'',
      source:'pdf'
    });
  }
  // De-dupe identical occurrences that can appear twice across page breaks.
  const seen = new Set();
  return events.filter(ev=>{
    if(seen.has(ev.id))return false;
    seen.add(ev.id);
    return true;
  });
}

// PURE: parse Google clock like "1:30pm" / "11:30 am" → {hour, minute}.
function parseGoogleClock(timeStr){
  const tm = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if(!tm)return null;
  let hour = parseInt(tm[1],10);
  const minute = parseInt(tm[2],10);
  const ampm = tm[3].toLowerCase();
  if(ampm === 'pm' && hour !== 12)hour += 12;
  if(ampm === 'am' && hour === 12)hour = 0;
  if(hour < 0 || hour > 23 || minute < 0 || minute > 59)return null;
  return {hour, minute};
}

// PURE: Google day header "Thu Jul 30, 2026" → local day-start ms.
function parseGoogleDayHeader(line){
  const m = String(line || '').trim().match(GCAL_DAY_HEADER);
  if(!m)return null;
  const month = GCAL_MONTHS[m[2].toLowerCase()];
  if(month == null)return null;
  const day = parseInt(m[3],10);
  const year = parseInt(m[4],10);
  const ms = new Date(year, month, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// PURE: Google Calendar schedule-print text → provider-agnostic events.
function parseGoogleCalendarPdfText(text){
  const lines = String(text || '').split(/\r?\n/).map(l=>l.replace(/\u00a0/g,' ').trim());
  const events = [];
  let dayBase = null;
  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    if(!line)continue;
    if(GCAL_CALENDAR_META.test(line))continue;
    const headerMs = parseGoogleDayHeader(line);
    if(headerMs != null){
      dayBase = headerMs;
      continue;
    }
    if(dayBase == null)continue;

    const timed = line.match(GCAL_TIMED_LINE);
    if(timed){
      const startClock = parseGoogleClock(timed[1]);
      const endClock = parseGoogleClock(timed[2]);
      const subject = String(timed[3] || '').trim().slice(0,60) || 'untitled';
      if(!startClock || !endClock)continue;
      let start = dayBase + startClock.hour * 3600000 + startClock.minute * 60000;
      let end = dayBase + endClock.hour * 3600000 + endClock.minute * 60000;
      // Rare overnight wrap in a schedule print.
      if(end <= start)end += 86400000;
      const id = calendarEventExternalId({subject,start,end}, 'pdf');
      events.push({id, subject, start, end, isAllDay:false, locationText:'', source:'pdf'});
      continue;
    }

    const allDay = line.match(GCAL_ALL_DAY_LINE);
    if(allDay){
      const subject = String(allDay[1] || '').trim().slice(0,60) || 'untitled';
      const start = dayBase;
      const end = dayBase + 86400000;
      const id = calendarEventExternalId({subject,start,end}, 'pdf');
      events.push({id, subject, start, end, isAllDay:true, locationText:'', source:'pdf'});
    }
  }
  const seen = new Set();
  return events.filter(ev=>{
    if(seen.has(ev.id))return false;
    seen.add(ev.id);
    return true;
  });
}

// PURE: try Outlook/Teams first, then Google schedule print.
function parseCalendarPdfText(text){
  const outlook = parseOutlookTeamsPdfText(text);
  if(outlook.length)return {events:outlook, format:'outlook'};
  const gcal = parseGoogleCalendarPdfText(text);
  if(gcal.length)return {events:gcal, format:'gcal'};
  return {events:[], format:null};
}

// PURE: merge overlapping [start,end] intervals; return total covered minutes.
function mergeIntervalMinutes(intervals){
  const sorted = (intervals || [])
    .map(iv=>({start:Number(iv.start), end:Number(iv.end)}))
    .filter(iv=>Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
    .sort((a,b)=>a.start - b.start);
  if(!sorted.length)return 0;
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for(let i = 1; i < sorted.length; i++){
    const iv = sorted[i];
    if(iv.start <= curEnd){
      curEnd = Math.max(curEnd, iv.end);
    }else{
      total += Math.round((curEnd - curStart) / 60000);
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  total += Math.round((curEnd - curStart) / 60000);
  return Math.max(0, total);
}

// PURE: group timed events by local day → merged wall-clock minutes that day.
// All-day rows (holidays) are excluded so they never eat a full Work budget.
function calendarCreditMinutesByDay(events){
  const byDay = new Map();
  (events || []).forEach(ev=>{
    if(ev && ev.isAllDay)return;
    const start = Number(ev.start);
    const end = Number(ev.end);
    if(!Number.isFinite(start) || !Number.isFinite(end) || end <= start)return;
    const key = typeof dateKey === 'function' ? dateKey(start) : null;
    if(!key)return;
    if(!byDay.has(key))byDay.set(key, []);
    byDay.get(key).push({start, end});
  });
  const out = [];
  byDay.forEach((intervals, dayKey)=>{
    const minutes = mergeIntervalMinutes(intervals);
    if(minutes > 0)out.push({dayKey, minutes, start:intervals[0].start});
  });
  out.sort((a,b)=>a.start - b.start);
  return out;
}

// PURE: one calendar event → partial Habit fields (timed auto-mark task).
function mapEventToTask(ev, source){
  const allDay = Boolean(ev && ev.isAllDay);
  const startMs = Number(ev && ev.start);
  const endMs = Number(ev && ev.end);
  const durationMin = allDay || !Number.isFinite(endMs - startMs)
    ? (typeof DEFAULT_DURATION_MINUTES !== 'undefined' ? DEFAULT_DURATION_MINUTES : 30)
    : Math.max(1, Math.min(720, Math.round((endMs - startMs) / 60000)));
  const src = source || ev.source || 'pdf';
  const externalId = ev.id || calendarEventExternalId(ev, src);
  // Auto-complete at the meeting *end* so the block stays on the agenda while
  // it is happening, then sweeps away afterward (done tasks drop from agenda).
  return {
    type:'task',
    name:(ev.subject || 'untitled').slice(0,60),
    emoji:'',
    target:null,
    eventTime: allDay || !Number.isFinite(startMs) ? null : startMs,
    dueDate: Number.isFinite(startMs) ? dayStart(startMs) : null,
    hardDue:false,
    autoMarkMinutes:durationMin,
    durationMinutes:durationMin,
    breakable:false,
    locationIds:[],
    topics:[],
    logs:[],
    externalId,
    source:src,
    importedAt:Date.now(),
    priority: typeof DEFAULT_PRIORITY !== 'undefined' ? DEFAULT_PRIORITY : 2
  };
}

// PURE-ish: strip prior calendar credit logs, then write one merged-day credit
// per import day onto the selected keepup/reduce habit (marked breakable if needed).
function applyCalendarCreditLogs(habits, events, creditHabitId){
  const hid = typeof cleanHabitId === 'function' ? cleanHabitId(creditHabitId) : creditHabitId;
  if(!hid)return {credited:0, habitName:null};
  const h = (habits || []).find(x=>x && x.hid === hid);
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce')){
    return {credited:0, habitName:null};
  }
  // Minute budgets only apply to breakable habits — flip it on when crediting.
  if(!h.breakable)h.breakable = true;
  const kept = normalizeLogs(h.logs).filter(log=>!isCalendarCreditLog(log));
  const days = calendarCreditMinutesByDay(events);
  let credited = 0;
  days.forEach(({minutes, start})=>{
    const dayBase = dayStart(start);
    // Noon on that day — same convention as keepup auto-backfill logs.
    kept.push({
      ts: dayBase + 12 * 3600000,
      minutes,
      source:'calendar',
      note:'imported calendar'
    });
    credited += minutes;
  });
  h.logs = normalizeLogs(kept);
  h.lastLog = latestActualLog(h.logs);
  return {credited, habitName:h.name || null};
}

// PURE: clear calendar credit logs from every habit (or one hid).
function stripCalendarCreditLogs(habits, onlyHid){
  let stripped = 0;
  (habits || []).forEach(h=>{
    if(!h)return;
    if(onlyHid && h.hid !== onlyHid)return;
    const before = normalizeLogs(h.logs).length;
    h.logs = normalizeLogs(normalizeLogs(h.logs).filter(log=>!isCalendarCreditLog(log)));
    h.lastLog = latestActualLog(h.logs);
    stripped += Math.max(0, before - h.logs.length);
  });
  return stripped;
}

// PURE: apply the all-day import policy before mapping to habits.
function filterCalendarEventsForImport(events, allDayMode){
  const mode = typeof normalizeCalendarAllDayMode === 'function'
    ? normalizeCalendarAllDayMode(allDayMode)
    : (allDayMode === 'tasks' ? 'tasks' : 'skip');
  const list = Array.isArray(events) ? events : [];
  if(mode === 'tasks')return {events:list, skippedAllDay:0, mode};
  let skippedAllDay = 0;
  const kept = [];
  list.forEach(ev=>{
    if(ev && ev.isAllDay){ skippedAllDay += 1; return; }
    kept.push(ev);
  });
  return {events:kept, skippedAllDay, mode};
}

// HYBRID: merge a fresh event list into habits using insert/overwrite/skip.
function applyCalendarImport(incoming, options = {}){
  const source = options.source || 'pdf';
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const creditHabitId = options.creditHabitId != null
    ? options.creditHabitId
    : settings.calendarCreditHabitId;
  const allDayMode = options.allDayMode != null
    ? options.allDayMode
    : settings.calendarAllDayMode;
  const filtered = filterCalendarEventsForImport(incoming, allDayMode);
  const data = typeof load === 'function' ? load() : [];
  const byExternal = new Map(
    data.filter(h=>h && h.externalId).map(h=>[h.externalId, h])
  );
  let added = 0, updated = 0, skipped = filtered.skippedAllDay;
  filtered.events.forEach(ev=>{
    const mapped = mapEventToTask(ev, source);
    const existing = byExternal.get(mapped.externalId);
    if(!existing){
      const row = normalize([mapped])[0];
      data.push(row);
      byExternal.set(row.externalId, row);
      added += 1;
      return;
    }
    // User renamed the local copy — leave their edit alone.
    if(existing.importedAt && existing.name && mapped.name && existing.name !== mapped.name){
      skipped += 1;
      return;
    }
    const keepLogs = normalizeLogs(existing.logs);
    Object.assign(existing, mapped, {hid:existing.hid, logs:keepLogs});
    existing.lastLog = latestActualLog(existing.logs);
    updated += 1;
  });

  // If all-day is skipped, also drop previously imported all-day rows for this
  // source so flipping the setting + re-import cleans holidays out.
  let removedAllDay = 0;
  if(filtered.mode === 'skip'){
    for(let i = data.length - 1; i >= 0; i--){
      const h = data[i];
      if(h && h.source === source && h.type === 'task' && h.eventTime == null){
        data.splice(i, 1);
        removedAllDay += 1;
      }
    }
  }

  // Credit from all surviving imported timed tasks for this source (re-import
  // stays consistent even when the new PDF dropped a meeting).
  const creditSourceEvents = data
    .filter(h=>h && h.source === source && h.type === 'task' && h.eventTime != null)
    .map(h=>({
      id:h.externalId,
      subject:h.name,
      start:h.eventTime,
      end:h.eventTime + clampDuration(h.durationMinutes) * 60000,
      isAllDay:false,
      source
    }));

  if(creditHabitId)stripCalendarCreditLogs(data, creditHabitId);
  else stripCalendarCreditLogs(data);
  const credit = creditHabitId
    ? applyCalendarCreditLogs(data, creditSourceEvents, creditHabitId)
    : {credited:0, habitName:null};

  if(typeof save === 'function')save(data);
  return {
    added,
    updated,
    skipped,
    skippedAllDay:filtered.skippedAllDay,
    removedAllDay,
    allDayMode:filtered.mode,
    creditedMinutes:credit.credited,
    creditHabitName:credit.habitName,
    count:(incoming || []).length
  };
}

// HYBRID: remove every habit with the given import source (+ its credit logs).
function clearCalendarImport(source = 'pdf'){
  const data = typeof load === 'function' ? load() : [];
  const before = data.length;
  const next = data.filter(h=>!(h && h.source === source));
  stripCalendarCreditLogs(next);
  if(typeof save === 'function')save(next);
  return {removed: before - next.length};
}

// ASYNC: lazy-load pdf.js. Prefer a blob workerSrc so Safari PWAs (which often
// choke on cross-origin workers) can still parse on the main thread path.
function loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    const existing = document.querySelector(`script[data-calendar-pdfjs="${src}"]`);
    if(existing){
      if(window.pdfjsLib)resolve(window.pdfjsLib);
      else existing.addEventListener('load',()=>resolve(window.pdfjsLib));
      existing.addEventListener('error',()=>reject(new Error('Could not load PDF library')));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.calendarPdfjs = src;
    script.onload = ()=>{
      if(!window.pdfjsLib)reject(new Error('pdf.js failed to load'));
      else resolve(window.pdfjsLib);
    };
    script.onerror = ()=>reject(new Error('Could not load PDF library'));
    document.head.appendChild(script);
  });
}

async function configurePdfWorker(lib, workerUrl){
  try{
    const res = await fetch(workerUrl, {mode:'cors'});
    if(!res.ok)throw new Error('worker fetch failed');
    const blob = await res.blob();
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  }catch(_){
    // Fall back to the CDN URL; pdf.js may still run via its fake-worker path.
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
  }
}

function ensurePdfJs(){
  if(typeof window !== 'undefined' && window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(pdfJsLoadPromise)return pdfJsLoadPromise;
  pdfJsLoadPromise = (async()=>{
    let lib = null;
    try{
      lib = await loadScriptOnce(CALENDAR_PDF_JS_CDN);
      await configurePdfWorker(lib, CALENDAR_PDF_WORKER_CDN);
    }catch(_){
      lib = await loadScriptOnce(CALENDAR_PDF_JS_FALLBACK);
      await configurePdfWorker(lib, CALENDAR_PDF_WORKER_FALLBACK);
    }
    return lib;
  })().catch(err=>{
    pdfJsLoadPromise = null;
    throw err;
  });
  return pdfJsLoadPromise;
}

// ASYNC: extract plain text from a PDF ArrayBuffer via pdf.js.
async function extractPdfText(arrayBuffer){
  const pdfjsLib = await ensurePdfJs();
  let doc;
  try{
    doc = await pdfjsLib.getDocument({
      data:arrayBuffer,
      // Helps Safari / low-memory PWAs; text extract does not need streaming.
      disableStream:true,
      disableAutoFetch:true
    }).promise;
  }catch(err){
    throw new Error('Could not open that PDF in this browser. Try re-saving it, or open Tings in Safari (not an in-app browser).');
  }
  const pageTexts = [];
  for(let i = 1; i <= doc.numPages; i++){
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group glyphs by approximate Y so Outlook titles stay on their own lines.
    const lines = [];
    let currentY = null;
    let current = [];
    const flush = ()=>{
      if(!current.length)return;
      lines.push(current.join(' ').replace(/\s+/g,' ').trim());
      current = [];
    };
    (content.items || []).forEach(item=>{
      if(!item || !item.str)return;
      const y = item.transform ? item.transform[5] : 0;
      if(currentY == null || Math.abs(y - currentY) > 2){
        flush();
        currentY = y;
      }
      current.push(item.str);
    });
    flush();
    pageTexts.push(lines.join('\n'));
  }
  return pageTexts.join('\n');
}

// ASYNC: read a File → parsed calendar events (or throw a friendly Error).
async function parseCalendarPdfFile(file){
  if(!file)throw new Error('No file chosen');
  const buf = await file.arrayBuffer();
  const text = await extractPdfText(buf);
  const {events, format} = parseCalendarPdfText(text);
  if(!events.length){
    throw new Error('No meetings found — use an Outlook/Teams agenda print or a Google Calendar schedule PDF');
  }
  return {events, text, format};
}
