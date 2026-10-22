const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:412,height:915},timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    // This fixture tests an existing user's controls, outside first-run onboarding.
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
  });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    assert.equal(await page.locator('#calendar-device-controls').isVisible(),false,'PWA hides device controls');
    assert.equal(await page.locator('#calendar-device-choose').count(),0,'native buttons are absent from PWA');
    const result=await page.evaluate(async()=>{
      const RealDate=Date,now=new RealDate(2026,9,22,8).getTime();
      globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      const from=dayStart(now),to=from+14*86400000,start=from+10*3600000;
      const work=normalize([{hid:'work',name:'Work',type:'keepup',target:1,durationMinutes:420,breakable:true,logs:[]}])[0];
      const ev={id:'device:7:20',calendarId:'7',subject:'Meeting',start,end:start+3600000,isAllDay:false};
      const snap=events=>({complete:true,calendarIds:['7'],from,to,events});
      const options={calendarIds:['7'],creditHabitId:'work',allDayMode:'skip',now};
      const first=reconcileDeviceCalendarSnapshot([work],snap([ev]),options);
      const repeated=reconcileDeviceCalendarSnapshot(first.data,snap([ev]),options);
      const moved=reconcileDeviceCalendarSnapshot(first.data,snap([{...ev,subject:'Renamed by organizer',start:start+3600000,end:start+7200000}]),options);
      const cancelled=reconcileDeviceCalendarSnapshot(moved.data,snap([]),options);
      let rejected=0;
      for(const invalid of [{...snap([]),complete:false},{...snap([]),calendarIds:['8']},snap([{...ev,end:0}])]){
        try{reconcileDeviceCalendarSnapshot(first.data,invalid,options);}catch{rejected++;}
      }
      const allDay={...ev,isAllDay:true,start:from,end:from+86400000};
      const changedToAllDay=reconcileDeviceCalendarSnapshot(first.data,snap([allDay]),options);
      const asTask=reconcileDeviceCalendarSnapshot([work],snap([allDay]),{...options,allDayMode:'tasks'});
      const past={...ev,id:'device:7:past',start:from-86400000+3600000,end:from-86400000+7200000};
      const historical=normalize([{...mapEventToTask(past,'device'),hid:'past',calendarId:'7',calendarStart:past.start,calendarEnd:past.end,logs:[past.end]}])[0];
      const history=reconcileDeviceCalendarSnapshot([...first.data,historical],snap([]),options);
      const pdf=normalize([{...mapEventToTask({...ev,id:'pdf:overlap'},'pdf'),hid:'pdf'}])[0];
      const combined=reconcileDeviceCalendarSnapshot([work,pdf],snap([ev]),options);
      const earned=structuredClone(work);earned.logs=[{ts:from-12*3600000,minutes:90,source:'calendar'}];
      const preserved=reconcileDeviceCalendarSnapshot([earned],snap([]),options);
      const shared=first.data.find(isDeviceCalendarTask);
      const completed=structuredClone(first.data);const done=completed.find(isDeviceCalendarTask);done.logs=[now];done.lastLog=now;
      const reopened=reconcileDeviceCalendarSnapshot(completed,snap([{...ev,start:start+3600000,end:start+7200000}]),options);
      const settings={...loadSortSettings(),locations:[],travel:{},blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},
        availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],agendaOptimizer:true};
      const agendaData=normalize([shared,{hid:'habit',name:'Habit',type:'keepup',target:1,durationMinutes:60,logs:[]}]);
      const fast=buildWeekAgenda(agendaData,settings,1);
      const exact=await buildWeekAgendaAsync(agendaData,settings,1,{nativeLimitSeconds:4});
      const summarize=week=>({fixed:week.days[0].timeline.filter(r=>r.kind==='scheduled').map(r=>({start:r.start,end:r.end})),
        clash:week.days[0].timeline.some(r=>r.kind==='fill' && r.start<ev.end && r.end>ev.start)});
      save(first.data);sortSettings=loadSortSettings();openDetail(load().findIndex(isDeviceCalendarTask));
      const readonly=document.querySelector('[data-detail-nav="schedule"]').inert && document.getElementById('detail-save').disabled;
      closeDetail();
      return {first:first.added,repeated:repeated.changed,moved:moved.data.find(isDeviceCalendarTask),hid:shared.hid,
        cancelled:cancelled.removed,rejected,original:first.data.find(isDeviceCalendarTask).name,
        allDaySkipped:changedToAllDay.removed,asTask:asTask.data.find(isDeviceCalendarTask),history:history.data.some(h=>h.hid==='past'),
        combinedCredit:calendarCreditMinutesByDay(calendarImportedEvents(combined.data))[0].minutes,
        earnedCredit:preserved.data.find(h=>h.hid==='work').logs.filter(isCalendarCreditLog).reduce((n,log)=>n+log.minutes,0),
        private:shared.showOnSharedDisplay===false,reopened:isTaskDone(reopened.data.find(isDeviceCalendarTask)),
        fast:summarize(fast),exact:summarize(exact),readonly};
    });
    assert.equal(result.first,1);assert.equal(result.repeated,false,'unchanged snapshot does not dirty the planner');
    assert.equal(result.moved.name,'Renamed by organizer');assert.equal(result.moved.hid,result.hid,'move preserves identity');
    assert.equal(result.cancelled,1);assert.equal(result.rejected,3);assert.equal(result.original,'Meeting','pure merge does not mutate source');
    assert.equal(result.allDaySkipped,1);assert.equal(result.asTask.eventTime,null);assert.equal(result.history,true);
    assert.equal(result.combinedCredit,60,'overlapping PDF/device meetings count once');assert.equal(result.private,true);
    assert.equal(result.earnedCredit,90,'history survives after completed task rows age out');
    assert.equal(result.reopened,false,'future moved meeting clears stale completion');assert.equal(result.readonly,true);
    for(const planner of [result.fast,result.exact]){assert.equal(planner.fixed.length,1);assert.equal(planner.clash,false);}
    const integration=await page.evaluate(()=>{
      localStorage.clear();
      const now=Date.now(),from=dayStart(now),start=now+3600000,to=from+14*86400000;
      const a={id:'device:7:80:1',seriesId:'device:7:80',calendarId:'7',subject:'Weekly meeting',start,end:start+3600000};
      const b={...a,id:'device:7:80:2',start:start+86400000,end:start+90000000};
      const snap=events=>({complete:true,calendarIds:['7'],from,to,events});
      const style={'series:device:7:80':{emoji:'📞',emojiBgColor:'blue'},[a.id]:{emoji:'🎯'}};
      localStorage.setItem(DEVICE_CALENDAR_STYLES_KEY,JSON.stringify(style));
      const original=reconcileDeviceCalendarSnapshot([],snap([a,b]),{now}).data;
      save(original);
      const moved=reconcileDeviceCalendarSnapshot(original,snap([{...a,start:start+1800000,end:start+5400000,joinUrl:'https://meet.google.com/abc-defg-hij'},b]),{now}).data;
      const prefs={version:4,enabled:true,items:{'calendar-series:device:7:80':{start:'alarm',end:'notification',startLeadMinutes:15},[`item:${a.id}`]:{start:'off'}}};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
      const resolved=nativeReminderDeliveryPreferences(moved,prefs,now);
      const c={...b,id:'device:7:80:3',start:start+2*86400000,end:start+2*86400000+3600000};
      const future=reconcileDeviceCalendarSnapshot(moved,snap([a,b,c]),{now}).data;
      const next=nativeReminderDeliveryPreferences(future,prefs,now);
      const rows=future.map((h,i)=>({kind:'scheduled',i,h,start:h.calendarStart,end:h.calendarEnd}));
      const week={days:future.map((h,i)=>({dayBase:dayStart(h.calendarStart),dayKey:dateKey(h.calendarStart),timeline:[rows[i]]}))};
      const events=nativeReminderEvents(week,future,loadSortSettings(),prefs,now);
      const cancelled=reconcileDeviceCalendarSnapshot(future,snap([b,c]),{now}).data;
      const without=nativeReminderEvents({days:week.days.filter(day=>day.timeline[0].h.externalId!==a.id)},cancelled,loadSortSettings(),prefs,now);
      saveDeviceCalendarStyle(original[0],'occurrence',null);
      const reset=load().find(h=>h.externalId===a.id);
      const mirror=nativeBackgroundSnapshot();
      return {styles:moved.map(h=>[h.emoji,h.emojiBgColor]),links:moved[0].links,series:moved[0].calendarSeriesId,
        resolved:resolved.items[`item:${a.id}`],future:next.items[`item:${c.id}`],futureEmoji:future[2].emoji,
        starts:events.filter(e=>e.reminderEdge==='start').map(e=>({owner:e.owner,lead:e.agendaAt-e.at,mode:e.delivery})),
        cancelled:without.some(e=>e.owner===`item:${a.id}`),reset:reset.emoji,
        stored:JSON.parse(localStorage.getItem(NATIVE_REMINDERS_KEY)),mirrorStyle:!!mirror.storage[DEVICE_CALENDAR_STYLES_KEY],
        mirrorSeries:mirror.prefs.items['calendar-series:device:7:80']};
    });
    assert.deepEqual(integration.styles,[['🎯','blue'],['📞','blue']]);
    assert.equal(integration.series,'device:7:80');assert.equal(integration.links[0].value,'https://meet.google.com/abc-defg-hij');
    assert.equal(integration.resolved.start,'off');assert.equal(integration.resolved.end,'notification');
    assert.equal(integration.future.start,'alarm');assert.equal(integration.futureEmoji,'📞');
    assert.equal(integration.starts.length,2);for(const event of integration.starts){assert.equal(event.lead,15*60000);assert.equal(event.mode,'alarm');}
    assert.equal(integration.cancelled,false);assert.equal(integration.reset,'📞');
    assert.equal(integration.stored.items['item:device:7:80:3'],undefined,'inheritance never becomes a saved override');
    assert.equal(integration.mirrorStyle,true);assert.equal(integration.mirrorSeries.start,'alarm');
    // Real controls with a synthetic native bridge; never read a phone calendar.
    await page.evaluate(()=>{
      localStorage.clear();window.calendarCalls={permissions:0,reads:0};
      const from=dayStart(Date.now()),start=from+12*3600000;
      window.calendarSnapshot={complete:true,calendarIds:['7'],from,to:from+14*86400000,
        events:[{id:'device:7:ui',calendarId:'7',subject:'UI meeting',start,end:start+3600000,isAllDay:false}]};
      window.TingsNative={isNative:true,calendars:{
        requestAccess:async()=>{calendarCalls.permissions++;return {granted:true};},
        list:async()=>({calendars:[{id:'7',name:'Personal',account:'test@example.test'}]}),
        read:async()=>{calendarCalls.reads++;if(window.calendarFailure)throw new Error('Access revoked; existing meetings kept.');return calendarSnapshot;},
        onChange:async fn=>{window.calendarChange=fn;return {remove:async()=>{}};}
      }};
      initDeviceCalendars();resetSettingsSheetState();syncSettingsControls();openSheet('settings-sheet');
    });
    await page.locator('#settings-calendar-head').click();
    assert.equal(await page.evaluate(()=>calendarCalls.permissions),0,'startup never requests calendar permission');
    await page.locator('#calendar-device-choose').click();
    await page.locator('#calendar-device-list input').check();
    await page.locator('#calendar-device-save').click();
    await page.waitForFunction(()=>!deviceCalendarRefresh && load().some(isDeviceCalendarTask));
    assert.equal(await page.evaluate(()=>calendarCalls.permissions),1);
    await page.evaluate(async()=>{
      calendarSnapshot.events[0].seriesId='device:7:80';
      await refreshDeviceCalendars();
      // UI exercises permission choices without scheduling real OS reminders.
      reconcileNativeReminders=async()=>{};
      TingsNative.notifications={permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})};
      closeSheet('settings-sheet');openDetail(load().findIndex(isDeviceCalendarTask));scrollDetailToNav('actions');
    });
    await page.locator('#detail-calendar-personalization summary').click();
    await page.getByLabel('meeting emoji',{exact:true}).fill('🧑‍💻');
    await page.locator('#detail-calendar-personalization').getByRole('button',{name:'save appearance',exact:true}).click();
    assert.equal(await page.evaluate(()=>deviceCalendarStyles()['series:device:7:80'].emoji),'🧑‍💻');
    await page.locator('#detail-native-reminders summary').click();
    await page.locator('#detail-native-reminders [data-reminder-edge="start"]').selectOption('alarm');
    await page.getByLabel('meeting start reminder timing',{exact:true}).selectOption('10');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['calendar-series:device:7:80'].start),'alarm');
    await page.getByLabel('change meeting reminders for',{exact:true}).selectOption('occurrence');
    await page.locator('#detail-native-reminders [data-reminder-edge="start"]').selectOption('off');
    assert.equal(await page.evaluate(()=>nativeReminderChoices(nativeReminderPreferences(),`item:${load().find(isDeviceCalendarTask).hid}`).start),'off');
    await page.locator('#detail-native-reminders').getByRole('button',{name:'use series reminders for this meeting',exact:true}).click();
    assert.equal(await page.evaluate(()=>nativeReminderChoices(nativeReminderPreferences(),`item:${load().find(isDeviceCalendarTask).hid}`).start),'alarm');
    await page.screenshot({path:'test-results/calendar-personalization.png'});
    await page.evaluate(()=>{closeDetail();openSheet('settings-sheet');});
    await page.evaluate(async()=>{window.calendarFailure=true;await refreshDeviceCalendars();});
    assert.equal(await page.evaluate(()=>load().filter(isDeviceCalendarTask).length),1,'failed read keeps meetings');
    await page.evaluate(async()=>{window.calendarFailure=false;calendarSnapshot.events=[];await refreshDeviceCalendars();});
    assert.equal(await page.evaluate(()=>load().filter(isDeviceCalendarTask).length),0,'successful empty read removes cancelled meeting');
    await page.locator('#calendar-device-stop').click();
    assert.equal(await page.evaluate(()=>deviceCalendarPreferences().enabled),false);
    assert.deepEqual(errors,[]);
    console.log('Android calendar sync: reconciliation, both planners, local privacy, read-only detail, UI, and failures passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
