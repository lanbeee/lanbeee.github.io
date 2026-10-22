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
  const result=await page.evaluate(async()=>{
   const RealDate=Date,now=new RealDate(2026,9,22,8).getTime();
   globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   const rule={repeat:'weekly',startDate:'2026-10-22',until:'2026-11-08',weekdays:[0,4],startMinute:540,exceptions:{'2026-10-25':{cancelled:true},'2026-10-29':{startMinute:600,durationMinutes:90,emoji:'📚'}}};
   const data=normalize([{hid:'class',name:'Class',type:'keepup',durationMinutes:60,appointment:rule,logs:[]},
    {hid:'overlap',name:'Meeting',type:'task',eventTime:now+90*60000,durationMinutes:60,logs:[]},
    {hid:'work',name:'Flexible work',type:'keepup',target:1,durationMinutes:60,logs:[]}]);
   const settings={...loadSortSettings(),locations:[],blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},availabilityMinutes:[0,0,0,0,0,0,0]};
   const fast=buildWeekAgenda(data,settings,8),exact=await buildWeekAgendaAsync(data,settings,8,{nativeLimitSeconds:4});
   const summarize=week=>week.days.map(day=>({key:day.dayKey,fixed:day.timeline.filter(r=>r.h?.hid==='class').map(r=>({kind:r.kind,start:r.start,end:r.end,conflict:r.appointmentConflict})),fills:day.timeline.filter(r=>r.kind==='fill').length}));
   const roomy={...settings,availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440]};
   const roomyFast=buildWeekAgenda(data,roomy,1),roomyExact=await buildWeekAgendaAsync(data,roomy,1,{nativeLimitSeconds:4});
   const noOverlap=week=>!week.days[0].timeline.some(r=>r.kind==='fill' && r.start<now+150*60000 && r.end>now+60*60000);
   const completed=normalize([{...data[0],logs:[now],lastLog:now}])[0];
   const completionRows=collectScheduledAgendaEvents([completed],'2026-10-22',settings);
   const before=appointmentOccurrence(data[0],'2026-10-22'),after=appointmentOccurrence(data[0],'2026-11-01');
   const prefs={enabled:true,items:{'item:class':{start:'notification',end:'off',startLeadMinutes:15}}};
   const events=nativeReminderEvents(roomyFast,data,roomy,prefs,now);
   save(data);sortSettings=roomy;openDetail(0);
   return {fast:summarize(fast),exact:summarize(exact),noOverlap:[noOverlap(roomyFast),noOverlap(roomyExact)],
    bounds:[appointmentOccurrence(data[0],'2026-10-18'),appointmentOccurrence(data[0],'2026-11-12')],
    clocks:[new Date(before.start).getHours(),new Date(after.start).getHours()],
    noCredit:data[0].autoMarkMinutes,completionRows:completionRows.length,
    missed:isMissedOccurrence(data[0],false,now+86400000,'2026-10-22'),
    score:progressScore(data[0]),events:events.filter(e=>e.owner==='item:class').map(e=>({at:e.at,edge:e.reminderEdge})),
    expectedReminder:before.start-15*60000,dirtyBefore:homePlannerDirtyKey(data),
    dirtyAfter:homePlannerDirtyKey(normalize([{...data[0],appointment:{...rule,until:'2026-11-01'}},...data.slice(1)]))};
  });
  for(const days of [result.fast,result.exact]){
   assert.equal(days[0].fixed.length,1,'calendar block survives zero planner budget');assert.equal(days[0].fixed[0].kind,'scheduled');
   assert.match(days[0].fixed[0].conflict,/Meeting/);assert.equal(days[3].fixed.length,0,'one date cancelled');
   assert.equal(days[7].fixed.length,1);assert.equal(days[7].fixed[0].end-days[7].fixed[0].start,90*60000);
  }
  assert.deepEqual(result.noOverlap,[true,true]);assert.deepEqual(result.bounds,[null,null]);assert.deepEqual(result.clocks,[9,9]);
  assert.equal(result.noCredit,null);assert.equal(result.completionRows,1);assert.equal(result.missed,false);assert.equal(result.score,null);
  assert.notEqual(result.dirtyBefore,result.dirtyAfter,'series edits invalidate cached plans');
  assert.ok(result.events.some(e=>e.edge==='start' && e.at===result.expectedReminder),'native start lead is applied');
  const overnight=await page.evaluate(async()=>{
    const data=normalize([{hid:'night-class',name:'Night class',type:'keepup',durationMinutes:120,
      appointment:{repeat:'weekly',startDate:'2026-10-21',weekdays:[3],startMinute:1380,exceptions:{}}},
      {hid:'early-work',name:'Early work',type:'keepup',durationMinutes:60,target:1}]);
    const settings={...loadSortSettings(),locations:[],blockedTimes:[],availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440]};
    const RealDate=Date,now=new RealDate(2026,9,22,0,15).getTime();
    globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    try{
      const weeks=[buildWeekAgenda(data,settings,1),await buildWeekAgendaAsync(data,settings,1,{nativeLimitSeconds:4})];
      const prefs={enabled:true,items:{'item:night-class':{end:'off',dates:{'2026-10-21':{end:'alarm'}}}}};
      return weeks.map(w=>({fixed:w.days[0].timeline.filter(r=>r.kind==='scheduled').map(r=>({day:r.scheduledDay,end:new Date(r.end).getHours()})),
        overlap:w.days[0].timeline.some(r=>r.kind==='fill' && r.start<new Date(2026,9,22,1).getTime()),
        reminders:nativeReminderEvents(w,data,settings,prefs,now).map(e=>({day:e.dayKey,edge:e.reminderEdge,mode:e.delivery}))}));
    }finally{globalThis.Date=RealDate;}
  });
  for(const result of overnight){
    assert.deepEqual(result.fixed,[{day:'2026-10-21',end:1}],'overnight occurrence remains reserved after midnight');
    assert.equal(result.overlap,false,'flexible work cannot overlap the overnight tail');
    assert.deepEqual(result.reminders,[{day:'2026-10-21',edge:'end',mode:'alarm'}],'overnight end reminder keeps the original date override');
  }
  await page.selectOption('#detail-appt-scope','date');await page.fill('#detail-appt-occurrence','2026-10-29');
  await page.fill('#detail-appt-time','11:00');await page.fill('#detail-appt-duration','45');
  await page.click('#detail-save');
  assert.equal(await page.evaluate(()=>load()[0].appointment.exceptions['2026-10-29'].startMinute),660);
  await page.evaluate(()=>openDetail(0));
  await page.selectOption('#detail-appt-scope','date');await page.fill('#detail-appt-occurrence','2026-10-29');
  await page.click('#detail-appt-skip');
  assert.equal(await page.evaluate(()=>appointmentOccurrence(load()[0],'2026-10-29')),null);
  await page.selectOption('#detail-appt-scope','date');await page.fill('#detail-appt-occurrence','2026-10-29');await page.click('#detail-appt-reset');
  assert.equal(await page.evaluate(()=>load()[0].appointment.exceptions['2026-10-29']),undefined);
  await page.evaluate(()=>{closeDetail();applyAddDefaults();openSheet('add-sheet');});
  await page.click('#add-appointment-shortcut');await page.fill('#ting-message','Biology class');
  await page.fill('#add-appt-date','2026-10-22');await page.fill('#add-appt-time','13:00');await page.fill('#ting-duration','50');
  await page.click('#do-save');
  assert.equal(await page.evaluate(()=>load().at(-1).appointment.startMinute),780);
  assert.equal(await page.locator('#detail-appt-rule').isVisible(),true);
  await page.screenshot({path:'test-results/local-appointment-editor.png',fullPage:true});
  await page.evaluate(()=>{closeDetail();applyAddDefaults();openSheet('add-sheet');});
  assert.equal(await page.locator('#add-appointment-fields').isVisible(),false,'normal creation resets shortcut');
  await page.click('#add-appointment-shortcut');await page.selectOption('#add-appt-repeat','once');await page.fill('#ting-message','Dentist');
  await page.click('#do-save');
  assert.equal(await page.evaluate(()=>load().at(-1).type),'task');
  assert.equal(await page.evaluate(()=>load().at(-1).appointment.repeat),'once');
  const dst=await page.evaluate(async()=>{
    closeDetail();const OriginalDate=Date,now=new OriginalDate(2026,9,31,8).getTime();
    globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    const data=normalize([{hid:'dst-class',name:'Class',emoji:'📙',type:'keepup',durationMinutes:60,appointment:{repeat:'weekly',startDate:'2026-10-01',weekdays:[0,1,6],startMinute:540,exceptions:{'2026-11-02':{startMinute:600}}}}]);
    const settings={...loadSortSettings(),locations:[],blockedTimes:[],availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440]};
    const weeks=[buildWeekAgenda(data,settings,3),await buildWeekAgendaAsync(data,settings,3,{nativeLimitSeconds:4})];
    const actualNow=performance.timeOrigin+performance.now();
    const workerData=normalize([{...data[0],appointment:{...data[0].appointment,startDate:dateKey(actualNow),weekdays:[0,1,2,3,4,5,6],exceptions:{}}}]);
    const workerWeek=await buildWeekAgendaOffMain(workerData,settings,3,'fast');
    const prefs={enabled:true,items:{'item:dst-class':{start:'notification',startLeadMinutes:15,dates:{'2026-11-01':{start:'alarm',startLeadMinutes:30}}}}};
    const events=nativeReminderEvents(weeks[0],data,settings,prefs,now);
    const future=normalize([{...data[0],emoji:'📘'}])[0];
    return {workerRows:workerWeek.days.map(d=>d.timeline.filter(r=>r.kind==='scheduled').length),days:weeks.map(w=>w.days.map(d=>({key:d.dayKey,clock:new Date(d.timeline.find(r=>r.kind==='scheduled').start).getHours()}))),
      reminders:events.filter(e=>e.reminderEdge==='start').map(e=>({day:e.dayKey,mode:e.delivery,lead:(e.agendaAt-e.at)/60000})),
      inherits:appointmentOccurrence(future,'2026-11-02').emoji,ended:homeDaySequence({...weeks[0].days[0],isToday:true,timeline:weeks[0].days[0].timeline.map(r=>({...r,end:now-1}))},settings).some(r=>r.h?.hid==='dst-class')};
  });
  for(const days of dst.days)assert.deepEqual(days,[{key:'2026-10-31',clock:9},{key:'2026-11-01',clock:9},{key:'2026-11-02',clock:10}]);
  assert.deepEqual(dst.reminders,[{day:'2026-10-31',mode:'notification',lead:15},{day:'2026-11-01',mode:'alarm',lead:30},{day:'2026-11-02',mode:'notification',lead:15}]);
  assert.deepEqual(dst.workerRows,[1,1,1],'worker understands appointment recurrence');
  assert.equal(dst.inherits,'📘');assert.equal(dst.ended,false,'ended appointments leave today without a completion');
  await page.evaluate(()=>{
    window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
    reconcileNativeReminders=async()=>{};
    localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({version:4,enabled:false,items:{}}));
    openDetail(0);
  });
  await page.selectOption('#detail-appt-scope','date');await page.fill('#detail-appt-occurrence','2026-10-29');
  await page.evaluate(()=>{$('detail-native-reminders').open=true;scrollDetailToNav('actions','auto');});
  await page.getByLabel('Class: start reminder',{exact:true}).selectOption('alarm');
  await page.waitForFunction(()=>nativeReminderPreferences().items['item:class']?.dates?.['2026-10-29']?.start==='alarm');
  await page.getByLabel('meeting start reminder timing',{exact:true}).selectOption('30');
  assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:class'].start),undefined,'one-date control does not enable series reminders');
  await page.getByRole('button',{name:'Use series reminders for this date',exact:true}).click();
  assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:class'].dates['2026-10-29']),undefined,'reset restores timing as well as delivery inheritance');
  await page.fill('#detail-appt-occurrence','');
  assert.equal(await page.getByLabel('Class: start reminder',{exact:true}).count(),0,'empty occurrence date cannot edit series reminders');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{closeDetail();openDetail(0);});
  await page.waitForFunction(()=>getSheetInner('detail-sheet').classList.contains('local-appointment'));
  assert.equal(await page.locator('#detail-appt-time').isVisible(),true,'appointment editor works in the desktop side pane');
  await page.evaluate(()=>openDetail(2));
  assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').classList.contains('local-appointment')),false,'ordinary habit controls are restored');
  assert.deepEqual(errors,[]);console.log('PASS local appointments: both engines, reservations, conflicts, bounds, exceptions, reminders and creation/edit UI');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
