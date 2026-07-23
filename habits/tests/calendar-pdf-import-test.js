// Calendar PDF import — pure parser, overlap merge, apply + Work credit.
// Uses synthetic Outlook/Google text only (no real calendar PDFs / PII).
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/calendar-pdf-import-test.js
//
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(cond, msg){
  if(!cond)throw new Error(`assert failed: ${msg}`);
}

// Synthetic Outlook / Teams agenda-print shape (not a real calendar export).
const SAMPLE_TEXT = `7/20/2026 to 7/24/2026
Calendar, Sample Work Calendar
Monday, July 20, 2026
Weekly priorities sync
Mon 7/20/2026 11:00 AM - 12:00 PM
Location: Microsoft Teams MeetingOrganizer: Alex Example
________________________________________________________________________________
NOTICE: This e-mail message is confidential
Wednesday, July 22, 2026
Site visit block
Wed 7/22/2026 1:00 PM - 5:00 PM
Location: Microsoft Teams Meeting
Standup follow-up
Wed 7/22/2026 2:00 PM - 2:30 PM
Location: Microsoft Teams Meeting
Thursday, July 23, 2026
Release readiness check
Thu 7/23/2026 1:00 PM - 1:45 PM
Intake workflow review
Thu 7/23/2026 3:30 PM - 4:30 PM
`;

// Synthetic Google Calendar schedule-print shape (not a real calendar export).
const GCAL_SAMPLE = `Sample User, Personal, Sample Holidays
Thu Jul 30, 2026
1:30pm - 2:30pm   Coffee with Jordan
Sat Aug 15, 2026
All day   Civic Holiday
Sat Aug 15, 2026
Calendar: holidays@example.com
Mon Aug 17, 2026
12:30pm - 2:30pm   Design workshop
Thu Nov 19, 2026
12:30pm - 1:30pm   Call with Sam
12:30pm - 1:30pm   Call with Riley
Sun Oct 11, 2026
All day   Festival Observance
Sun Oct 11, 2026
Calendar: holidays@example.com
12:30pm - 2:29pm   Deep-work block
`;

(async()=>{
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.addInitScript(()=>{
    localStorage.setItem('tings_v2', JSON.stringify([
      {
        hid:'work-habit-1',
        name:'Work',
        type:'keepup',
        target:1,
        breakable:true,
        durationMinutes:420,
        minChunkMinutes:30,
        logs:[],
        emoji:'💼'
      }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      calendarCreditHabitId:'work-habit-1',
      showWeekOnHome:true,
      showScheduledTasksInAgenda:true,
      blockedTimes:[]
    }));
  });
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');

  // ── 1. parse sample Outlook text ──
  const parsed = await page.evaluate((text)=>{
    const events = parseOutlookTeamsPdfText(text);
    return {
      n:events.length,
      names:events.map(e=>e.subject),
      wedMerged: mergeIntervalMinutes(events.filter(e=>dateKey(e.start) === '2026-07-22').map(e=>({start:e.start,end:e.end}))),
      creditDays: calendarCreditMinutesByDay(events)
    };
  }, SAMPLE_TEXT);
  assert(parsed.n === 5, `expected 5 events, got ${parsed.n}: ${parsed.names.join(' | ')}`);
  assert(parsed.names[0].includes('priorities') || parsed.names[0].includes('Weekly'), `first title: ${parsed.names[0]}`);
  assert(parsed.wedMerged === 240, `Wed overlap merge should be 240m (4h), got ${parsed.wedMerged}`);
  const wedCredit = parsed.creditDays.find(d=>d.dayKey === '2026-07-22');
  assert(wedCredit && wedCredit.minutes === 240, `Wed credit day minutes ${wedCredit && wedCredit.minutes}`);

  // ── 2. apply import credits Work ──
  const applied = await page.evaluate((text)=>{
    const events = parseOutlookTeamsPdfText(text);
    const result = applyCalendarImport(events, {source:'pdf', creditHabitId:'work-habit-1'});
    const data = load();
    const work = data.find(h=>h.hid === 'work-habit-1');
    const meetings = data.filter(h=>h.source === 'pdf');
    const wedBase = dayStart(events.find(e=>e.subject.includes('Site visit')).start);
    return {
      result,
      meetingCount:meetings.length,
      autoMark:meetings.map(h=>h.autoMarkMinutes),
      workBudget:breakableBudgetMinutes(work, wedBase),
      workProgress:breakableProgressMinutes(work, wedBase),
      creditLogs:normalizeLogs(work.logs).filter(l=>isCalendarCreditLog(l)).map(l=>({minutes:l.minutes, source:l.source}))
    };
  }, SAMPLE_TEXT);
  assert(applied.result.added === 5, `added 5, got ${applied.result.added}`);
  assert(applied.meetingCount === 5, '5 pdf meetings stored');
  assert(applied.autoMark.every(m=>m > 0), 'autoMarkMinutes set to duration (complete at end)');
  assert(applied.workProgress === 240, `Wed Work progress should be 240, got ${applied.workProgress}`);
  assert(applied.workBudget === 180, `Wed Work remaining 420-240=180, got ${applied.workBudget}`);
  assert(applied.result.creditedMinutes >= 240, `creditedMinutes ${applied.result.creditedMinutes}`);

  // ── 3. re-import dedupes ──
  const again = await page.evaluate((text)=>{
    const events = parseOutlookTeamsPdfText(text);
    return applyCalendarImport(events, {source:'pdf', creditHabitId:'work-habit-1'});
  }, SAMPLE_TEXT);
  assert(again.added === 0, `re-import added 0, got ${again.added}`);
  assert(again.updated === 5 || again.skipped + again.updated === 5, `re-import updates/skips: ${JSON.stringify(again)}`);

  // ── 3b. Google Calendar schedule text ──
  const gcal = await page.evaluate((text)=>{
    const direct = parseGoogleCalendarPdfText(text);
    const routed = parseCalendarPdfText(text);
    const timed = direct.filter(e=>!e.isAllDay);
    const allDay = direct.filter(e=>e.isAllDay);
    const credit = calendarCreditMinutesByDay(direct);
    const nov19 = credit.find(d=>d.dayKey === '2026-11-19');
    const aug15 = credit.find(d=>d.dayKey === '2026-08-15');
    const inherited = direct.find(e=>!e.isAllDay && /Deep-work/.test(e.subject));
    return {
      n:direct.length,
      timed:timed.length,
      allDay:allDay.length,
      format:routed.format,
      routedN:routed.events.length,
      nov19Minutes:nov19 ? nov19.minutes : 0,
      aug15Credit:aug15 ? aug15.minutes : null,
      inheritedDay:inherited ? dateKey(inherited.start) : null,
      inheritedMins:inherited ? Math.round((inherited.end - inherited.start)/60000) : 0,
      names:timed.map(e=>e.subject)
    };
  }, GCAL_SAMPLE);
  assert(gcal.format === 'gcal', `routed format gcal, got ${gcal.format}`);
  assert(gcal.timed >= 4, `expected >=4 timed Google events, got ${gcal.timed}: ${gcal.names.join(' | ')}`);
  assert(gcal.allDay >= 1, `expected all-day holidays, got ${gcal.allDay}`);
  assert(gcal.nov19Minutes === 60, `Nov 19 overlap should credit 60m not 120, got ${gcal.nov19Minutes}`);
  assert(gcal.aug15Credit == null, `all-day holiday must not credit Work, got ${gcal.aug15Credit}`);
  assert(gcal.inheritedDay === '2026-10-11', `timed event after Calendar: line should inherit Oct 11, got ${gcal.inheritedDay}`);
  assert(gcal.inheritedMins === 119, `12:30-2:29 = 119m, got ${gcal.inheritedMins}`);

  // ── 3c. all-day mode: skip vs tasks ──
  const allDayModes = await page.evaluate((text)=>{
    clearCalendarImport('pdf');
    const events = parseGoogleCalendarPdfText(text);
    const skipped = applyCalendarImport(events, {source:'pdf', creditHabitId:null, allDayMode:'skip'});
    const afterSkip = load().filter(h=>h.source === 'pdf');
    clearCalendarImport('pdf');
    const asTasks = applyCalendarImport(events, {source:'pdf', creditHabitId:null, allDayMode:'tasks'});
    const afterTasks = load().filter(h=>h.source === 'pdf');
    return {
      skippedAdded:skipped.added,
      skippedAllDay:skipped.skippedAllDay,
      afterSkipTimed:afterSkip.filter(h=>h.eventTime != null).length,
      afterSkipAllDay:afterSkip.filter(h=>h.eventTime == null).length,
      tasksAdded:asTasks.added,
      afterTasksAllDay:afterTasks.filter(h=>h.eventTime == null).length
    };
  }, GCAL_SAMPLE);
  assert(allDayModes.skippedAllDay >= 1, `skip mode reports skipped all-day, got ${allDayModes.skippedAllDay}`);
  assert(allDayModes.afterSkipAllDay === 0, `skip mode stores no all-day tasks, got ${allDayModes.afterSkipAllDay}`);
  assert(allDayModes.afterSkipTimed === allDayModes.skippedAdded, 'skip mode only stores timed');
  assert(allDayModes.afterTasksAllDay >= 1, `tasks mode stores all-day rows, got ${allDayModes.afterTasksAllDay}`);
  assert(allDayModes.tasksAdded > allDayModes.skippedAdded, 'tasks mode adds more than skip mode');

  // ── 4. UI import with synthetic events (no real PDF files) ──
  await page.evaluate(()=>clearCalendarImport('pdf'));
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  await page.locator('#settings-calendar-head').click();
  await page.waitForSelector('#settings-calendar-body:not([hidden])');

  await page.evaluate((text)=>{
    const {events} = parseCalendarPdfText(text);
    if(typeof showCalendarPdfPreview === 'function')showCalendarPdfPreview(events);
  }, SAMPLE_TEXT);
  await page.waitForFunction(()=>{
    const prev = document.getElementById('calendar-pdf-preview');
    return prev && !prev.hidden && prev.querySelectorAll('li').length >= 1;
  }, null, { timeout:5000 });
  const previewCount = await page.locator('#calendar-pdf-preview li').count();
  assert(previewCount >= 5, `preview should list >=5 meetings, got ${previewCount}`);
  await page.locator('#calendar-pdf-import').click({ force:true });
  await page.waitForFunction(()=>{
    const s = (document.getElementById('calendar-pdf-status')||{}).textContent || '';
    return /added|updated|credited/i.test(s);
  }, null, { timeout:10000 });
  const fromUi = await page.evaluate(()=>load().filter(h=>h.source === 'pdf').length);
  assert(fromUi >= 5, `UI import stored >=5 meetings, got ${fromUi}`);

  // ── 5. clear imported ──
  const cleared = await page.evaluate(()=>clearCalendarImport('pdf'));
  assert(cleared.removed >= 5, `cleared >=5, got ${cleared.removed}`);
  const after = await page.evaluate(()=>({
    meetings:load().filter(h=>h.source === 'pdf').length,
    credits:normalizeLogs(load().find(h=>h.hid === 'work-habit-1').logs).filter(l=>isCalendarCreditLog(l)).length
  }));
  assert(after.meetings === 0, 'no pdf meetings left');
  assert(after.credits === 0, 'calendar credit logs stripped');

  // Keepup with duration (not yet breakable) still appears / credits.
  const creditList = await page.evaluate(()=>{
    save([{
      hid:'work-habit-1', name:'Work', type:'keepup', target:1, breakable:false,
      durationMinutes:420, minChunkMinutes:30, logs:[], emoji:''
    }]);
    renderCalendarImportControls();
    const opts = [...document.querySelectorAll('#calendar-credit-habit option')].map(o=>({v:o.value,t:o.textContent}));
    return opts;
  });
  assert(creditList.some(o=>o.v === 'work-habit-1'), `Work should appear in credit list: ${JSON.stringify(creditList)}`);

  assert(!errors.length, `page errors: ${errors.join('; ')}`);
  console.log('calendar-pdf-import-test: ok');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
