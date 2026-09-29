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
      const renamed = {...settings,blockedTimes:settings.blockedTimes.map(b=>({...b,label:b.label+' renamed'}))};
      const afterRename = nativeReminderEvents(week,data,renamed,prefs,now);
      return {initial,rescheduled,removed,defaults,done,withTravel,afterRename};
    });
    assert.equal(result.initial.length,3,'independent start/end choices');
    assert.equal(result.initial.find(e=>e.title==='Task').delivery,'alarm');
    assert.equal(result.initial.filter(e=>e.title==='Habit').every(e=>e.delivery==='notification'),true);
    assert.equal(result.rescheduled.find(e=>e.title==='Habit').at-result.initial.find(e=>e.title==='Habit').at,600000);
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
    await page.evaluate(()=>{
      save(normalize([{hid:'ui-one',name:'Morning walk',type:'keepup',target:1,logs:[]},{hid:'ui-two',name:'Read',type:'keepup',target:1,logs:[]}]));
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({enabled:true,habitStart:true,travelStart:true,alarmTypes:{travelStart:true}}));
      window.TingsNative={isNative:true,alarms:{status:async()=>({pending:0,exact:true,fullScreen:true}),replaceAgenda:async()=>{}},notifications:{permissions:async()=>({display:'granted'}),requestPermissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'}),pending:async()=>({notifications:[]}),replaceAgenda:async()=>{}}};
      initNativeReminders();renderNativeDetailReminders(load()[0]);
    });
    assert.equal(await page.locator('#native-reminder-controls select').count(),0,'no blanket selectors');
    assert.equal(await page.locator('#detail-native-reminders select').count(),4,'four per-item edges');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-one'].travelStart),'alarm','legacy travel choice migrated');
    await page.locator('#detail-native-reminders select[data-reminder-edge="start"]').selectOption('off',{force:true});
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:ui-one'].start==='off');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:ui-two'].start),'notification','other habit unchanged');
    const ids=await page.evaluate(()=>{
      updateSortSetting({blockedTimes:[{label:'Busy',start:900,end:960,days:[]},{label:'Busy',start:900,end:960,days:[]}]},{renderNow:false});
      return normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>b.reminderId);
    });
    assert.equal(new Set(ids).size,2,'identical busy rules get distinct stable identities');
    await page.locator('[data-blocked-row="0"] select[data-reminder-edge="start"]').selectOption('alarm',{force:true});
    await page.waitForFunction(id=>nativeReminderPreferences().items[`busy:${id}`]?.start==='alarm',ids[0]);
    await page.evaluate(()=>{saveBlockedTimePatch(0,{label:'Renamed'});removeBlockedTime(1);});
    assert.equal(await page.evaluate(id=>nativeReminderPreferences().items[`busy:${id}`].start,ids[0]),'alarm');
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
