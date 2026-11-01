// Synthetic Google Calendar exports only; exercises the real offline file picker.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const calendar = body=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\n${body.trim().replace(/\n/g,'\r\n')}\r\nEND:VCALENDAR\r\n`;
const sample = calendar(`BEGIN:VEVENT
UID:weekly@example.test
DTSTART;TZID=America/New_York:20300107T090000
DTEND;TZID=America/New_York:20300107T100000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=America/New_York:20300114T090000
SUMMARY:Weekly\\, team\\; planning with a long
  folded title
DESCRIPTION:Private description is not stored
END:VEVENT
BEGIN:VEVENT
UID:weekly@example.test
RECURRENCE-ID:20300121T140000Z
DTSTART;TZID=America/New_York:20300122T110000
DTEND;TZID=America/New_York:20300122T120000
SUMMARY:Moved meeting
END:VEVENT
BEGIN:VEVENT
UID:weekly@example.test
RECURRENCE-ID;TZID=America/New_York:20300128T090000
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:holiday@example.test
DTSTART;VALUE=DATE:20300109
DTEND;VALUE=DATE:20300111
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:single@example.test
DTSTART:20300107T143000Z
DURATION:PT1H
SUMMARY:Overlapping meeting
END:VEVENT
BEGIN:VEVENT
UID:floating@example.test
DTSTART:20300108T090000
DTEND:20300108T093000
SUMMARY:Local meeting
END:VEVENT
BEGIN:VEVENT
UID:old@example.test
DTSTART:20200101T120000Z
DTEND:20200101T130000Z
SUMMARY:Old history
END:VEVENT`);

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,timezoneId:'America/New_York'});
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_v2',JSON.stringify([{hid:'work',name:'Work',type:'keepup',target:1,durationMinutes:420,logs:[]}]));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({calendarCreditHabitId:'work',blockedTimes:[]}));
    });
    await page.goto(BASE,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#open-about');
    const parsed = await page.evaluate(text=>parseCalendarIcsText(text,{from:new Date(2030,0,1).getTime(),to:new Date(2030,1,1).getTime()}),sample);
    assert.equal(parsed.events.length,5,'master recurrence, EXDATE, moved/cancelled instances, all-day, UTC and floating dates');
    const weekly = parsed.events.find(e=>e.subject.includes('folded'));
    assert.equal(weekly.subject,'Weekly, team; planning with a long folded title');
    assert.equal(weekly.start,Date.parse('2030-01-07T14:00:00Z'));
    assert.equal(parsed.events.find(e=>e.subject==='Local meeting').start,Date.parse('2030-01-08T14:00:00Z'));
    assert.equal(parsed.events.find(e=>e.subject==='Moved meeting').start,Date.parse('2030-01-22T16:00:00Z'));
    assert.equal(JSON.stringify(parsed).includes('Private description'),false);

    const times = await page.evaluate(()=>{
      const wrap = body=>`BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`;
      const parse = body=>parseCalendarIcsText(wrap(body),{from:Date.parse('2026-03-01'),to:Date.parse('2026-04-01')}).events;
      const body=`BEGIN:VEVENT\nUID:dst\nDTSTART;TZID=America/New_York:20260302T090000\nDTEND;TZID=America/New_York:20260302T100000\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:DST\nEND:VEVENT`;
      const dst=parse(body);
      const embedded=parse(`BEGIN:VTIMEZONE\nTZID:CustomZone\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0530\nTZOFFSETTO:+0530\nEND:STANDARD\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:embedded\nDTSTART;TZID=CustomZone:20260302T090000\nDTEND;TZID=CustomZone:20260302T100000\nSUMMARY:Embedded\nEND:VEVENT`);
      const rdate=parse(`BEGIN:VEVENT\nUID:rdate\nDTSTART:20260302T090000Z\nDTEND:20260302T100000Z\nRDATE:20260305T090000Z\nSUMMARY:Extra date\nEND:VEVENT`);
      const instant=parse('BEGIN:VEVENT\nUID:instant\nDTSTART:20260302T120000Z\nSUMMARY:Instant\nEND:VEVENT')[0];
      return {dst:dst.map(e=>new Date(e.start).toISOString()),embedded:embedded[0].start,rdate:rdate.length,instant:instant.end-instant.start};
    });
    assert.deepEqual(times.dst,['2026-03-02T14:00:00.000Z','2026-03-09T13:00:00.000Z'],'DST preserves 9am wall clock');
    assert.equal(times.embedded,Date.parse('2026-03-02T03:30:00Z'));
    assert.equal(times.rdate,2);
    assert.equal(times.instant,0,'valid instantaneous events are accepted');
    const guards = await page.evaluate(()=>{
      const range={from:new Date(2030,0,1).getTime(),to:new Date(2030,1,1).getTime()};
      const attempt=text=>{try{parseCalendarIcsText(text,range);return '';}catch(error){return error.message;}};
      const wrap=body=>`BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`;
      const shifted=parseCalendarIcsText(wrap('BEGIN:VEVENT\nUID:shifted\nDTSTART:20300107T090000Z\nDTEND:20300107T100000Z\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Original\nEND:VEVENT\nBEGIN:VEVENT\nUID:shifted\nRECURRENCE-ID;RANGE=THISANDFUTURE:20300114T090000Z\nDTSTART:20300113T090000Z\nDTEND:20300113T100000Z\nSUMMARY:Shifted\nEND:VEVENT'),{from:Date.parse('2030-01-20T00:00:00Z'),to:Date.parse('2030-01-21T00:00:00Z')});
      return {
        shifted:shifted.events.map(e=>new Date(e.start).toISOString()),
        unknown:attempt(wrap('BEGIN:VEVENT\nUID:badzone\nDTSTART;TZID=Unrecognised/Zone:20300101T090000\nDTEND;TZID=Unrecognised/Zone:20300101T100000\nEND:VEVENT')),
        empty:parseCalendarIcsText(wrap(''),range).events.length,
        many:attempt(wrap(Array.from({length:5001},(_,i)=>`BEGIN:VEVENT\nUID:item-${i}\nDTSTART:20300101T090000Z\nDTEND:20300101T100000Z\nEND:VEVENT`).join('\n')))
      };
    });
    assert.match(guards.unknown,/Unsupported calendar time zone/);assert.equal(guards.empty,0);assert.match(guards.many,/5,000/);
    assert.deepEqual(guards.shifted,['2030-01-20T09:00:00.000Z'],'a future range exception can move an occurrence back inside the chosen dates');

    const merge = await page.evaluate(events=>{
      const first=applyCalendarImport(events,{source:'ics',creditHabitId:'work',allDayMode:'skip'});
      const credit=normalizeLogs(load().find(h=>h.hid==='work').logs).filter(isCalendarCreditLog).reduce((n,l)=>n+l.minutes,0);
      const original=load().find(h=>h.externalId===events[0].id);
      const data=load();Object.assign(data.find(h=>h.hid===original.hid),{name:'My local title',emoji:'📌'});save(data);
      const changed=events.map(e=>({...e,subject:'Updated '+e.subject,start:e.start+3600000,end:e.end+3600000}));
      const second=applyCalendarImport(changed,{source:'ics',creditHabitId:'work'});
      const stored=load().filter(h=>h.source==='ics');
      const backup=parseBackup(JSON.stringify(buildBackup()));
      return {first,second,credit,count:stored.length,keptName:stored.find(h=>h.hid===original.hid).name,
        event:stored.every(isEventItem),updated:stored.some(h=>h.name.startsWith('Updated')),
        emoji:stored.find(h=>h.hid===original.hid).emoji,backup:backup.habits.filter(h=>h.source==='ics').length};
    },parsed.events);
    assert.equal(merge.first.added,4);assert.equal(merge.first.skippedAllDay,1);
    assert.equal(merge.credit,180,'overlapping imports count once toward Work');
    assert.equal(merge.second.added,0);assert.equal(merge.second.updated,4);assert.equal(merge.count,4);
    assert.equal(merge.keptName,'My local title');assert.equal(merge.emoji,'📌');assert.equal(merge.updated,true);assert.equal(merge.event,true);assert.equal(merge.backup,4);
    await page.evaluate(()=>{clearCalendarImport('ics');renderCalendarImportControls();});

    await page.locator('#open-about').click();
    await page.locator('#settings-calendar-head').click();
    await page.locator('#calendar-ics-from').fill('2030-01-01');
    await page.locator('#calendar-ics-to').fill('2030-01-31');
    // ICS parsing never loads pdf.js or contacts a remote calendar service.
    await context.setOffline(true);
    const file={name:'google-calendar.ics',mimeType:'text/calendar',buffer:Buffer.from(sample)};
    await page.locator('#calendar-pdf-input').setInputFiles(file);
    await page.waitForSelector('#calendar-pdf-preview:not([hidden])');
    assert.equal(await page.locator('#calendar-pdf-preview li').count(),5);
    await page.locator('#calendar-allday-mode').selectOption('tasks');
    await page.locator('#calendar-pdf-preview input').last().uncheck();
    await page.locator('#calendar-pdf-import').click();
    assert.equal(await page.evaluate(()=>load().filter(h=>h.source==='ics').length),4);
    assert.equal(await page.evaluate(()=>load().some(h=>h.source==='ics' && h.eventTime===null)),true);
    await page.locator('#calendar-pdf-input').setInputFiles(file);
    await page.waitForSelector('#calendar-pdf-preview:not([hidden])');
    await page.locator('#calendar-pdf-import').click();
    assert.equal(await page.evaluate(()=>load().filter(h=>h.source==='ics').length),5,'re-import updates and only inserts missing occurrence');
    await page.locator('#calendar-pdf-input').setInputFiles(file);
    await page.waitForSelector('#calendar-pdf-preview:not([hidden])');
    await page.locator('#calendar-pdf-cancel').click();
    assert.equal(await page.evaluate(()=>load().filter(h=>h.source==='ics').length),5,'cancel leaves stored events alone');
    await page.locator('#calendar-pdf-input').setInputFiles({name:'bad.ics',mimeType:'text/calendar',buffer:Buffer.from('invalid')});
    await page.waitForFunction(()=>document.getElementById('calendar-pdf-status').textContent.includes('not an ICS'));
    assert.equal(await page.locator('#calendar-pdf-actions').isHidden(),true);
    assert.equal(await page.evaluate(()=>load().filter(h=>h.source==='ics').length),5,'bad file preserves data');
    await page.locator('#calendar-pdf-input').setInputFiles({name:'calendar.zip',mimeType:'application/zip',buffer:Buffer.from('zip')});
    await page.waitForFunction(()=>document.getElementById('calendar-pdf-status').textContent.includes('extract'));
    await page.locator('#calendar-ics-clear').click();
    assert.equal(await page.evaluate(()=>load().filter(h=>h.source==='ics').length),0);
    assert.deepEqual(errors,[]);
    console.log('ICS import: Google full export, time zones/DST, recurrence/exceptions, credits, backup, offline file UI and failures passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
