const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:412,height:915},timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
