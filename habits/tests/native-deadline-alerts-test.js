// Notification delivery is stubbed; exercise saved choices and the real projection.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const RealDate=Date,now=new RealDate(2026,9,30,8).getTime();
      window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      localStorage.setItem('tings_coach_essentials_v2','done');localStorage.setItem('tings_coach_install_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const projected=await page.evaluate(()=>{
      const now=Date.now(),stamp=(day,hour=0)=>new Date(2026,9,day,hour).getTime();
      sortSettings={...loadSortSettings(),locations:[],blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{}};
      const data=normalize([
        {hid:'due-today',type:'task',name:'Send report',dueDate:stamp(30),delayAllowanceDays:2},
        {hid:'due-tomorrow',type:'task',name:'Pay bill',dueDate:stamp(31)},
        {hid:'someday',type:'task',name:'Someday'},
        {hid:'past',type:'task',name:'Old task',dueDate:stamp(29)},
        {hid:'done',type:'task',name:'Done task',dueDate:stamp(31),logs:[{ts:now}]},
        {hid:'class',type:'keepup',name:'Class',durationMinutes:60,appointment:{repeat:'weekly',startDate:'2026-10-30',weekdays:[0,5],startMinute:600,exceptions:{}}},
        {hid:'phone',type:'task',source:'device',externalId:'device:1:2',calendarSeriesId:'device:1:3',name:'Phone event',eventTime:stamp(31,14),durationMinutes:30}
      ]);save(data);
      const prefs={version:4,enabled:true,items:{
        'item:due-today':{due:'notification'},'item:due-tomorrow':{due:'alarm',dueDaysBefore:1,dueMinute:600},
        'item:someday':{due:'notification'},'item:past':{due:'notification'},'item:done':{due:'notification'},
        'item:class':{start:'notification',startLeadMinutes:60,startSecond:'alarm',secondStartLeadMinutes:1440},
        'calendar-series:device:1:3':{start:'notification',startLeadMinutes:60,startSecond:'notification',secondStartLeadMinutes:1440}
      }};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
      const days=['2026-10-30','2026-11-01'].map(key=>{
        const o=appointmentOccurrence(data[5],key);return {dayBase:dayStart(o.start),dayKey:key,timeline:[{kind:'scheduled',h:data[5],i:5,...o}]};
      });
      days.push({dayBase:stamp(31),dayKey:'2026-10-31',timeline:[{kind:'scheduled',h:data[6],i:6,start:stamp(31,14),end:stamp(31,14)+1800000}]});
      const week={days},empty={days:[{dayBase:stamp(30),dayKey:'2026-10-30',timeline:[]}]};
      const events=nativeReminderEvents(week,data,sortSettings,prefs,now);
      const dueOnly=nativeReminderEvents(empty,data,sortSettings,prefs,now);
      const late=nativeReminderEvents(empty,data,sortSettings,prefs,stamp(30,12));
      const same=structuredClone(prefs);same.items['item:class'].secondStartLeadMinutes=60;
      const duplicate=nativeReminderEvents(week,data,sortSettings,same,now);
      const override=structuredClone(prefs);override.items['item:class'].dates={'2026-11-01':{startSecond:'off',startLeadMinutes:30}};
      const overridden=nativeReminderEvents(week,data,sortSettings,override,now);
      window.alertFixture={data,prefs,week,now};
      return {now,events,dueOnly,late,duplicate,overridden,paused:nativeReminderEvents(week,data,sortSettings,{...prefs,enabled:false},now)};
    });
    const today=projected.dueOnly.find(e=>e.owner==='item:due-today');
    assert.equal(projected.dueOnly.length,2,'dated tasks notify even without an agenda slot; someday, past and completed tasks do not');
    assert.equal(new Date(today.at).getTime()-projected.now,3600000,'default due-today clock is 9 AM');
    assert.equal(projected.dueOnly.find(e=>e.owner==='item:due-tomorrow').at-projected.now,2*3600000,'tomorrow deadline can notify today at chosen time');
    assert.equal(projected.dueOnly.find(e=>e.owner==='item:due-tomorrow').delivery,'alarm');
    assert.equal(projected.late.length,1,'expired advance alerts are skipped');
    assert.equal(projected.late[0].key,today.key,'catch-up retains dedupe identity');
    assert.equal(projected.late[0].at,projected.now+4*3600000+2000,'due-today alert catches up when enabled after its clock');
    assert.equal(projected.paused.length,0,'global pause also pauses deadlines and both event alerts');
    const classEvents=projected.events.filter(e=>e.owner==='item:class');
    assert.equal(classEvents.length,4,'two alerts for each recurring occurrence');
    const sunday=classEvents.filter(e=>e.dayKey==='2026-11-01');
    const before=sunday.find(e=>e.reminderEdge==='startSecond');
    assert.equal(new Date(before.at).toISOString(),'2026-10-31T14:00:00.000Z','day-before clock stays 10 AM across fall DST');
    assert.equal(new Date(sunday.find(e=>e.reminderEdge==='start').at).toISOString(),'2026-11-01T14:00:00.000Z','hour-before alert follows the new time zone offset');
    assert.notEqual(before.notificationGroup,sunday.find(e=>e.reminderEdge==='start').notificationGroup,'second alert has an independent delivery receipt');
    assert.equal(before.completion,undefined,'events never gain completion actions');
    assert.match(before.body,/Starts.*Nov 1.*10:00/,'advance alert includes the event date and clock');
    assert.equal(projected.events.filter(e=>e.owner==='item:phone').length,2,'phone calendar events inherit both alerts from the series');
    assert.equal(projected.duplicate.filter(e=>e.owner==='item:class').length,2,'matching event alerts notify once per occurrence');
    assert.equal(projected.overridden.filter(e=>e.owner==='item:class' && e.dayKey==='2026-11-01').length,1,'one-date override silences only the second alert');
    assert.equal(projected.overridden.filter(e=>e.owner==='item:class' && e.dayKey==='2026-10-30').length,2,'other dates keep both alerts');
    assert.deepEqual(await page.evaluate(()=>[...nativeItemReminderControls('item:phone','Phone event',{travelOnly:true}).querySelectorAll('[data-reminder-edge]')].map(el=>el.dataset.reminderEdge)),['travelStart','travelEnd'],'travel to an event still exposes departure and arrival reminders');

    // Open the actual task and event details, then save through their controls.
    await page.evaluate(()=>{openDetail(0);});
    assert.equal(await page.locator('#detail-native-reminders').count(),0,'PWA keeps native controls absent');
    await page.evaluate(()=>{
      reconcileNativeReminders=async()=>{};showToast=()=>{};
      window.__alertPermission='granted';window.__exactPermission='granted';
      window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:window.__alertPermission}),requestPermissions:async()=>({display:window.__alertPermission}),exactAlarmPermission:async()=>({exact_alarm:window.__exactPermission}),requestExactAlarmPermission:async()=>({exact_alarm:window.__exactPermission})}};
      openDetail(0);scrollDetailToNav('schedule','auto');
    });
    const task=page.locator('#detail-native-reminders');
    await task.getByLabel('Send report: due date reminder day',{exact:true}).selectOption('1');
    await task.getByLabel('Send report: due date reminder time',{exact:true}).fill('16:30');
    await task.getByLabel('Send report: due date reminder time',{exact:true}).dispatchEvent('change');
    assert.ok(await task.getByLabel('Send report: due date reminder time',{exact:true}).evaluate(el=>el.getBoundingClientRect().width>=100),'phone time picker has room for the clock');
    const saved=await page.evaluate(()=>nativeReminderPreferences().items['item:due-today']);
    assert.equal(saved.dueDaysBefore,1);assert.equal(saved.dueMinute,990,'chosen clock saves as local minutes');
    await page.evaluate(()=>{window.__exactPermission='denied';});
    await task.locator('[data-reminder-edge="due"]').selectOption('alarm');
    await page.waitForFunction(()=>!document.querySelector('[data-reminder-edge="due"]').disabled);
    assert.equal(await task.locator('[data-reminder-edge="due"]').inputValue(),'notification','denied alarm access restores the prior due choice');
    await page.evaluate(()=>{openDetail(2);scrollDetailToNav('schedule','auto');});
    await page.locator('#detail-native-reminders > summary').click();
    assert.equal(await page.locator('[data-reminder-edge="due"]').isDisabled(),true,'undated task explains that a due date is needed');
    await page.evaluate(()=>{openDetail(5);scrollDetailToNav('schedule','auto');});
    const event=page.locator('#detail-native-reminders');
    assert.equal(await event.locator('[data-reminder-edge="due"],[data-reminder-edge="missed"],[data-reminder-missed-lead]').count(),0,'event actions show relevant alert choices only');
    await event.getByLabel('second event reminder timing',{exact:true}).selectOption('2880');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:class'].secondStartLeadMinutes),2880,'second event timing persists');
    await page.evaluate(()=>{
      const prefs=nativeReminderPreferences();nativeSaveReminderPatch(prefs,'item:class',{startSecond:'off',secondStartLeadMinutes:30},'2026-11-01');
    });
    await page.evaluate(()=>nativeResetReminderDate('item:class','2026-11-01'));
    assert.equal(await page.evaluate(()=>nativeReminderChoices(nativeReminderPreferences(),'item:class','2026-11-01').secondStartLeadMinutes),2880,'date reset restores the latest series timing');
    await page.evaluate(()=>nativeClearItemReminders('item:class'));
    assert.equal(await page.evaluate(()=>nativeReminderAnyOn('item:class')),false,'clear switches off both event alerts');
    await page.evaluate(()=>nativeClearItemReminders('item:due-today'));
    assert.equal(await page.evaluate(()=>nativeReminderAnyOn('item:due-today')),false,'clear also switches off deadline alerts');
    assert.deepEqual(errors,[],'task and event interactions have no runtime errors');
    console.log('PASS: task deadlines, two event alerts, DST, date overrides, dedupe, permissions, persistence and PWA isolation');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
