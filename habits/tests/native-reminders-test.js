// OS delivery is mocked; projection uses the real agenda and completion helpers.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:412,height:915}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    assert.equal(await page.locator('#native-reminder-controls').count(),0,'PWA hides native controls');
    const result = await page.evaluate(()=>{
      const now = Date.now(), base = dayStart(now)+86400000, start = base+10*3600000;
      const data = normalize([{hid:'notification-task',name:'Task',type:'task',eventTime:start,durationMinutes:30,logs:[]},{hid:'notification-habit',name:'Habit',type:'keepup',target:1,durationMinutes:30,logs:[]}]);
      const week = {days:[{dayBase:base,dayKey:dateKey(base),isToday:false,timeline:data.map((h,i)=>({kind:'fill',h,i,locationId:i===0?'shop':'home',start:start+i*3600000,end:start+i*3600000+1800000}))}]};
      const settings = {...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[],homeExtraMode:'compact'};
      const prefs = {version:2,enabled:true,items:{'item:notification-task':{start:'alarm',end:'off'},'item:notification-habit':{start:'notification',end:'notification'}}};
      const initial = nativeReminderEvents(week,data,settings,prefs,now);
      const moved = structuredClone(week);moved.days[0].timeline[1].start += 600000;moved.days[0].timeline[1].end += 600000;
      const rescheduled = nativeReminderEvents(moved,data,settings,prefs,now);
      const removed = nativeReminderEvents(week,data.slice(0,1),settings,prefs,now);
      const defaults = nativeReminderEvents(week,data,settings,{...NATIVE_REMINDER_DEFAULTS,enabled:true},now);
      const completed = structuredClone(data);completed[0].logs=[{ts:now}];completed[0].lastLog=now;
      const done = nativeReminderEvents(week,completed,settings,prefs,now);
      settings.locations = [{id:'home',name:'Home',lat:40,lng:-74},{id:'shop',name:'Shop',lat:40.02,lng:-74.01}];
      settings.blockedTimes = [{reminderId:'sleep',label:'Sleep',start:0,end:480,days:[],locationId:'home'}, {reminderId:'work',label:'Work',start:720,end:780,days:[],locationId:'shop'}];
      prefs.items['busy:sleep']={end:'notification'};
      prefs.items['busy:work']={start:'alarm',travelStart:'notification',travelEnd:'alarm'};
      prefs.items['item:notification-task'].travelStart='alarm';
      const withTravel = nativeReminderEvents(week,data,settings,prefs,now);
      const baselineTravel=withTravel.find(e=>e.owner==='item:notification-task' && e.reminderEdge==='travelStart');
      prefs.items['item:notification-task'].travelLeadMinutes=10;
      const withLead=nativeReminderEvents(week,data,settings,prefs,now);
      const leadTravel=withLead.find(e=>e.owner==='item:notification-task' && e.reminderEdge==='travelStart');
      const lateLead=nativeReminderEvents(week,data,settings,prefs,baselineTravel.at-60000)
        .find(e=>e.owner==='item:notification-task' && e.reminderEdge==='travelStart');
      const renamed = {...settings,blockedTimes:settings.blockedTimes.map(b=>({...b,label:b.label+' renamed'}))};
      const afterRename = nativeReminderEvents(week,data,renamed,prefs,now);
      return {initial,rescheduled,removed,defaults,done,withTravel,afterRename,baselineTravel,leadTravel,lateLead};
    });
    assert.equal(result.initial.length,3,'independent start/end choices');
    assert.equal(result.initial.find(e=>e.title==='Task').upNext,false,'fixed event clocks stay authoritative');
    assert.equal(result.initial.find(e=>e.title==='Habit' && e.reminderEdge==='start').upNext,true,'flexible starts can keep their imminent trigger');
    assert.equal(result.initial.find(e=>e.reminderEdge==='end').upNext,false,'end edges stay at their agenda clocks');
    assert.equal(result.withTravel.find(e=>e.owner==='busy:work' && e.reminderEdge==='start').upNext,false,'busy clocks remain authoritative');
    assert.equal(result.leadTravel.upNext,false,'fixed event departure does not get pinned early');
    assert.equal(result.rescheduled.find(e=>e.title==='Habit').notificationGroup,result.initial.find(e=>e.title==='Habit').notificationGroup,'cooldown identity survives a shifted clock');
    assert(result.initial.every(e=>e.expiresAt>e.at),'freshness follows the agenda edge');
    assert.equal(result.initial.find(e=>e.title==='Task').delivery,'alarm');
    assert.equal(result.initial.filter(e=>e.title==='Habit').every(e=>e.delivery==='notification'),true);
    assert.equal(result.rescheduled.find(e=>e.title==='Habit').at-result.initial.find(e=>e.title==='Habit').at,600000);
    assert.equal(result.rescheduled.find(e=>e.title==='Habit').key,result.initial.find(e=>e.title==='Habit').key,'same occurrence keeps its identity when moved');
    assert.equal(result.baselineTravel.at-result.leadTravel.at,10*60000,'departure warning precedes actual travel');
    assert.equal(result.baselineTravel.key,result.leadTravel.key,'lead changes keep occurrence identity');
    assert.equal(result.leadTravel.completion,undefined,'travel must not complete destination');
    assert.equal(result.initial[0].completion.hid,'notification-task');
    assert.equal(result.lateLead.at,result.baselineTravel.at-60000+2000,'warn shortly when lead time has passed but travel is ahead');
    assert.equal(result.removed.length,1,'deleted item removed');
    assert.equal(result.defaults.length,0,'new items have no blanket reminders');
    assert.equal(result.done.some(e=>e.title==='Task'),false);
    assert.equal(result.withTravel.filter(e=>e.reminderEdge==='travelStart').length,2,'real travel sequence uses destination item choices despite home display cleanup');
    assert.equal(result.withTravel.find(e=>e.reminderEdge==='travelStart').owner,'item:notification-task');
    assert.equal(result.withTravel.find(e=>e.owner==='busy:work' && e.reminderEdge==='start').delivery,'alarm');
    assert.equal(result.withTravel.find(e=>e.owner==='busy:work' && e.reminderEdge==='travelStart').delivery,'notification');
    assert.equal(result.withTravel.find(e=>e.owner==='busy:work' && e.reminderEdge==='travelEnd').delivery,'alarm');
    assert.equal(result.withTravel.find(e=>e.owner==='busy:sleep').delivery,'notification');
    assert.equal(result.afterRename.find(e=>e.owner==='busy:work' && e.reminderEdge==='start').delivery,'alarm','busy identity survives rename');
    const warnings=await page.evaluate(()=>{
      const base=dayStart(Date.now()),now=base+10*3600000;
      const settings={...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[]};
      const data=normalize([
        {hid:'flex',name:'Walk',type:'keepup',target:1,durationMinutes:30,allowedTimeStart:540,allowedTimeEnd:720,logs:[]},
        {hid:'fixed',name:'Appointment',type:'task',eventTime:now,durationMinutes:5,logs:[]},
        {hid:'split',name:'Work',type:'keepup',target:1,breakable:true,durationMinutes:60,minChunkMinutes:15,logs:[]},
        {hid:'options',name:'Separate windows',type:'keepup',target:1,durationMinutes:30,scheduleOptions:[
          {id:'one',start:540,end:720,sameDayMode:'separate'},
          {id:'two',start:600,end:780,sameDayMode:'separate'}],logs:[]},
        {hid:'later',name:'Not allowed yet',type:'keepup',target:1,durationMinutes:30,allowedTimeStart:720,allowedTimeEnd:780,logs:[]}
      ]);
      const day={dayBase:base,dayKey:dateKey(base),timeline:data.flatMap((h,i)=>{
        const row={kind:'fill',h,i,start:now,end:now+30*60000,dropAt:base+20*3600000,riskAt:base+9*3600000};
        if(h.hid==='options')return [{...row,scheduleOptionId:'one',occurrenceKey:'one'},
          {...row,scheduleOptionId:'two',occurrenceKey:'two'}];
        return h.breakable ? [row,{...row,start:now+30*60000,end:now+60*60000}] : [row];
      })};
      const week={days:[day]},prefs={enabled:true,items:Object.fromEntries(data.map(h=>[`item:${h.hid}`,{missed:'notification',missedLeadMinutes:60}]))};
      const withoutForecast=nativeReminderEvents(week,data,settings,prefs,now);
      const forecast={checkedAt:now,targetAt:now+300000,revision:'fixture',planKey:agendaForecastPlanKey(week,data),
        futureWeek:{days:[{...day,timeline:[]}]},risks:Object.fromEntries(day.timeline.map(row=>
          [agendaForecastIdentity(row,data),{at:now+300000,reason:'five-minute-loss',validated:true}]))};
      applyAgendaRiskForecast(week,forecast,data);week.forecastRevision='fixture';
      plannerPerfResetTryPlace();
      const events=nativeReminderEvents(week,data,settings,prefs,now);
      const background=nativeReminderEvents(week,data,settings,prefs,now-1000,null,now);
      const placementCalls=_plannerPerfTryPlace;
      const late=nativeReminderEvents(week,data,settings,prefs,now+240000).find(e=>e.owner==='item:flex');
      const expired=nativeReminderEvents(week,data,settings,prefs,now+300000).find(e=>e.owner==='item:flex');
      const removed=nativeReminderEvents(week,data.filter(h=>h.hid!=='flex'),settings,prefs,now);
      const completed=structuredClone(data);completed[0].logs=[{ts:now}];completed[0].lastLog=now;
      const realNow=Date.now;Date.now=()=>now;
      const done=nativeReminderEvents(week,completed,settings,prefs,now);
      Date.now=realNow;
      const venueSettings={...settings,locations:[{id:'later-place',allowedTimeStart:720,allowedTimeEnd:780}]};
      const venue=structuredClone(week);venue.days[0].timeline[0].locationId='later-place';
      venue.dropForecast.planKey=agendaForecastPlanKey(venue,data);
      const venueWarnings=nativeReminderEvents(venue,data,venueSettings,prefs,now);
      const changed=structuredClone(week);changed.days[0].timeline[0].start+=60000;
      const stale=nativeReminderEvents(changed,data,settings,prefs,now);
      return {base,now,events,background,withoutForecast,placementCalls,late,expired,removed,done,stale,venueWarnings};
    });
    const flex=warnings.events.find(e=>e.owner==='item:flex');
    assert.equal(warnings.withoutForecast.length,0,'old static and conservative risks never warn');
    assert.equal(flex.at,warnings.now+2000,'one shared five-minute lookahead warns now');
    assert.equal(flex.agendaAt,warnings.now+300000,'the cached future clock is the drop clock');
    assert.equal(flex.body,'Drops within 5 min');
    assert.deepEqual(warnings.background,warnings.events,'background preserves just-due edges while using the completed forecast clock');
    assert.equal(flex.upNext,false);
    assert.equal(warnings.placementCalls,0,'warning projection never runs placement on UI thread');
    assert.equal(warnings.events.filter(e=>e.owner==='item:split').length,1,'split work warns once');
    assert.equal(warnings.events.find(e=>e.owner==='item:split').completion,undefined);
    assert.equal(warnings.events.filter(e=>e.owner==='item:options').length,2,'separate occurrences retain independent warnings');
    assert(!warnings.events.some(e=>e.owner==='item:later'),'no warning more than one hour before allowed start');
    assert.equal(warnings.late.at,flex.at,'polling cannot slide or reschedule the warning');
    assert.equal(warnings.expired,undefined,'no advance warning after projected drop');
    assert(!warnings.removed.some(e=>e.owner==='item:flex'));
    assert(!warnings.done.some(e=>e.owner==='item:flex'));
    assert(!warnings.venueWarnings.some(e=>e.owner==='item:flex'),'venue hours also respect the one-hour guard');
    assert.equal(warnings.stale.length,0,'changed agenda invalidates the projection');
    const closedWarnings=await page.evaluate(()=>{
      const now=dayStart(Date.now())+10*3600000,base=dayStart(now);
      const data=normalize([{hid:'closed-one',name:'Closed warning',type:'keepup',target:1,durationMinutes:10,
        allowedTimeStart:540,allowedTimeEnd:720,logs:[]}]);
      const settings={...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[]};
      const week={forecastRevision:'closed',days:[{dayBase:base,dayKey:dateKey(base),timeline:[
        {kind:'fill',h:data[0],i:0,start:now,end:now+10*60000}]}]};
      const risk={at:now+30*60000,warningAt:now+25*60000,validated:true,verified:true};
      week.closedDropForecast={kind:'closed',revision:'closed',checkedAt:now,throughAt:now+60*60000,
        warningAt:now+2000,planKey:agendaForecastPlanKey(week,data),risks:{'closed-one:main':risk}};
      const prefs={enabled:true,items:{'item:closed-one':{missed:'alarm'}}};
      const compile=()=>nativeReminderEvents(week,data,settings,prefs,now);
      const prepared=compile();risk.verified=false;const unverified=compile();risk.verified=true;
      week.closedDropForecast.planKey+='changed';const stale=compile();
      week.closedDropForecast.planKey=agendaForecastPlanKey(week,data);
      prefs.items['item:closed-one'].missed='off';const off=compile();
      return {prepared,unverified,stale,off,now};
    });
    assert.equal(closedWarnings.prepared.length,1,'verified later loss queues a native alarm');
    assert.equal(closedWarnings.prepared[0].at,closedWarnings.now+25*60000,'future warning waits until five minutes before loss');
    assert.equal(closedWarnings.prepared[0].agendaAt-closedWarnings.prepared[0].at,5*60000);
    assert.equal(closedWarnings.unverified.length,0,'unverified risk cannot fall back to an early warning');
    assert.equal(closedWarnings.stale.length,0,'changed source plan invalidates queued prediction');
    assert.equal(closedWarnings.off.length,0,'closed preparation respects per-item Off');
    const hotPath=await page.evaluate(()=>{
      const base=dayStart(Date.now())+86400000,now=base+8*3600000;
      const settings={...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[],
        availabilityMinutes:Array(7).fill(1440)};
      const data=normalize([
        {hid:'flex',name:'Walk',type:'keepup',target:1,durationMinutes:30,allowedTimeStart:540,allowedTimeEnd:720,logs:[]},
        {hid:'fixed',name:'Appointment',type:'task',eventTime:base+10*3600000,durationMinutes:30,logs:[]}
      ]);
      const day={dayBase:base,dayKey:dateKey(base),timeline:data.map((h,i)=>({kind:'fill',h,i,start:base+10*3600000,end:base+10.5*3600000}))};
      const week={days:[day]},prefs={enabled:true,items:Object.fromEntries(data.map(h=>[`item:${h.hid}`,{missed:'notification',missedLeadMinutes:10}]))};
      const futureMissed=nativeReminderEvents(week,data,settings,prefs,Date.now()).filter(e=>e.reminderEdge==='missed').length;
      annotateAgendaDropTimes(week.days,data,settings,now);
      nativeReminderEvents(week,data,settings,prefs,now);
      plannerPerfResetTryPlace();
      nativeReminderEvents(week,data,settings,prefs,now);
      const cached=_plannerPerfTryPlace;
      plannerPerfResetTryPlace();
      computePlannerExpectationMap(data,settings,1);
      const skipped=_plannerPerfTryPlace;
      plannerPerfResetTryPlace();
      buildWeekAgenda(data,settings,1);
      return {cached,skipped,annotated:_plannerPerfTryPlace,futureMissed};
    });
    assert.equal(hotPath.futureMissed,0,'before-missed does not schedule tomorrow');
    assert.equal(hotPath.cached,0,'repeat reminder projection must not place on the UI thread');
    assert(hotPath.annotated>hotPath.skipped,'missed-pill fallback skips drop-cutoff probes during paint');
    await page.evaluate(()=>{
      save(normalize([{hid:'ui-one',name:'Morning walk',type:'keepup',target:1,logs:[]},{hid:'ui-two',name:'Read',type:'keepup',target:1,logs:[]}]));
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({enabled:true,habitStart:true,travelStart:true,alarmTypes:{travelStart:true}}));
      window.TingsNative={isNative:true,alarms:{status:async()=>({pending:0,exact:true,fullScreen:true}),replaceAgenda:async()=>{}},notifications:{permissions:async()=>({display:'granted'}),requestPermissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'}),pending:async()=>({notifications:[]}),replaceAgenda:async()=>{}}};
      initNativeReminders();renderNativeDetailReminders(load()[0]);
    });
    assert.equal(await page.locator('#native-reminder-controls select').count(),0,'no blanket selectors');
    assert.equal(await page.locator('#detail-native-reminders select[data-reminder-edge]').count(),5,'five per-item edges');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-one'].missed || 'off'),'off','migration leaves before-missed warnings off');
    await page.locator('#detail-native-reminders select[data-reminder-edge="missed"]').selectOption('notification',{force:true});
    assert.equal(await page.locator('#detail-native-reminders select[data-reminder-missed-lead]').count(),0,'one five-minute warning has no timing selector');
    assert.equal(await page.evaluate(()=>nativeReminderMissedLeadMinutes({missedLeadMinutes:60})),5,'legacy leads use the new common duration');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-two'].missed || 'off'),'off','warning choice stays per item');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-one'].travelStart),'alarm','legacy travel choice migrated');
    await page.locator('#detail-native-reminders select[data-reminder-edge="start"]').selectOption('off',{force:true});
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:ui-one'].start==='off');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-two'].start),'notification','other habit unchanged');
    const ids=await page.evaluate(()=>{
      updateSortSetting({blockedTimes:[{label:'Busy',start:900,end:960,days:[]},{label:'Busy',start:900,end:960,days:[]}]},{renderNow:false});
      return normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>b.reminderId);
    });
    assert.equal(await page.locator('[data-blocked-row="0"] select[data-reminder-edge="missed"]').count(),0,'busy times do not enter missed list');
    assert.equal(new Set(ids).size,2,'identical busy rules get distinct stable identities');
    await page.locator('[data-blocked-row="0"] select[data-reminder-edge="start"]').selectOption('alarm',{force:true});
    await page.waitForFunction(id=>nativeReminderPreferences().items[`busy:${id}`]?.start==='alarm',ids[0]);
    await page.evaluate(()=>{saveBlockedTimePatch(0,{label:'Renamed'});removeBlockedTime(1);});
    assert.equal(await page.evaluate(id=>nativeReminderPreferences().items[`busy:${id}`].start,ids[0]),'alarm');
    await page.locator('#detail-native-reminders select[data-reminder-lead]').selectOption('15',{force:true});
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:ui-one'].travelLeadMinutes===15);
    const completion=await page.evaluate(async()=>{
      save(normalize([{hid:'done-alarm',name:'Read',type:'keepup',target:1,logs:[]},
        {hid:'chunk-alarm',name:'Work',type:'keepup',target:1,breakable:true,durationMinutes:120,logs:[]},
        {hid:'separate-alarm',name:'Practice',type:'keepup',target:1,logs:[makeActualLog(Date.now()-1000,{occurrenceKey:'session-a'})]}]));
      let actions=[{id:'a'.repeat(32),hid:'done-alarm',dayKey:todayIso(),at:Date.now(),minutes:0},
        {id:'b'.repeat(32),hid:'chunk-alarm',dayKey:todayIso(),at:Date.now(),minutes:30},
        {id:'c'.repeat(32),hid:'separate-alarm',dayKey:todayIso(),at:Date.now(),occurrenceKey:'session-b'}];
      let failOnce=true;
      window.TingsNative.alarms.completions=async()=>({actions});
      window.TingsNative.alarms.acknowledge=async id=>{
        if(failOnce){failOnce=false;throw new Error('interrupted ack');}
        actions=actions.filter(a=>a.id!==id);
      };
      try{await consumeNativeAlarmCompletions();}catch(_){}
      await consumeNativeAlarmCompletions();await consumeNativeAlarmCompletions();
      const data=load();
      return {logs:data.map(h=>normalizeLogs(h.logs)),pending:actions.length};
    });
    assert.equal(completion.logs[0].length,1,'retry after saved completion cannot duplicate');
    assert.equal(completion.logs[0][0].source,'native_alarm','durable action identity survives normalization');
    assert.equal(completion.logs[1][0].minutes,30,'only the split session is credited');
    assert.equal(completion.logs[2].length,2,'a separate completed occurrence does not swallow this completion');
    assert.equal(completion.pending,0,'acknowledge only after save');
    assert.deepEqual(errors,[],'no runtime errors');
    // Isolated preview of the real controls using existing styles, for mobile-width review.
    await page.evaluate(()=>{
      const preview=document.createElement('div');preview.className='settings-block';
      preview.append(document.getElementById('native-reminder-controls'),nativeItemReminderControls('item:ui-one','Morning walk'));
      document.body.replaceChildren(preview);
    });
    await page.screenshot({path:'/tmp/tings-reminder-controls.png',fullPage:true});
    console.log('PASS: per-item choices, busy identities, real travel ownership, migration, UI isolation, replan and completion');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
