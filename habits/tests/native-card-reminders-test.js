// Card entry points share destination reminder ownership; date patches replace edges.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:412,height:915}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const fixture=await page.evaluate(()=>{
      reconcileNativeReminders=async()=>{};showToast=()=>{};
      const base=dayStart(Date.now())+86400000,dayKey=dateKey(base);
      const settings={...loadSortSettings(),blockedTimes:[{label:'Sleep',reminderId:'sleep',start:0,end:480,days:[],locationId:'home'},{label:'Meeting',reminderId:'meeting',start:720,end:780,days:[],locationId:'shop'}],
        blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[{id:'home',name:'Home',lat:40,lng:-74},{id:'shop',name:'Shop',lat:40.02,lng:-74.01}],
        lastKnownLocationId:'home',homeLocationId:'home'};
      saveSortSettings(settings);
      const data=normalize([{hid:'walk',name:'Walk',type:'keepup',target:1,durationMinutes:30,logs:[]}]);save(data);
      const week={days:[0,1].map(offset=>{const dayBase=base+offset*86400000;return {dayBase,dayKey:dateKey(dayBase),isToday:false,
        timeline:[{kind:'fill',h:data[0],i:0,locationId:'shop',start:dayBase+10*3600000,end:dayBase+10.5*3600000}]};})};
      const prefs={version:3,enabled:true,items:{'busy:meeting':{start:'notification',end:'notification',travelStart:'notification'},
        'item:walk':{start:'notification',travelStart:'notification',travelEnd:'notification'}}};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
      window.cardFixture={base,dayKey,settings:sortSettings,data,week,prefs};
      const block=blockedTimelineRows(dayKey,sortSettings,base,{clipAfter:null}).find(b=>b.label==='Meeting');
      openBlockEditSheet(block);
      const pwaBlocked=document.querySelector('#block-edit-reminders')===null;closeSheet('block-edit-sheet');
      openTravelEditSheet('home','shop',base+9*3600000,week.days[0].timeline[0],dayKey);
      const pwaTravel=document.querySelector('#travel-edit-reminders')===null;closeSheet('travel-edit-sheet');
      window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
      const host=document.createElement('div');host.id='card-test-host';document.body.append(host);
      appendHomeBlockedCard(host,block);host.querySelector('.blocked-card').click();
      return {dayKey,pwaBlocked,pwaTravel};
    });
    assert(fixture.pwaBlocked && fixture.pwaTravel,'PWA keeps native controls absent in both card editors');
    const block=page.locator('#block-edit-reminders');
    assert.equal(await block.locator('[data-reminder-edge="start"]').inputValue(),'notification','busy card opens existing recurring choices');
    await block.locator('[data-reminder-edge="start"]').selectOption('off');
    await page.waitForFunction(()=>nativeReminderPreferences().items['busy:meeting'].dates?.[cardFixture.dayKey]?.start==='off');
    const afterOff=await page.evaluate(()=>{
      const f=cardFixture,prefs=nativeReminderPreferences();
      return {prefs,events:nativeReminderEvents(f.week,f.data,sortSettings,prefs,Date.now())};
    });
    assert.equal(afterOff.prefs.items['busy:meeting'].start,'notification','one date does not change the series');
    assert.equal(afterOff.events.filter(e=>e.owner==='busy:meeting' && e.reminderEdge==='start').length,1,'one date silenced; tomorrow retains start');
    assert.equal(afterOff.events.filter(e=>e.owner==='busy:meeting' && e.reminderEdge==='end').length,2,'other busy edges inherit');
    await block.locator('[data-reminder-scope]').selectOption('series');
    await block.locator('[data-reminder-edge="end"]').selectOption('alarm');
    await page.waitForFunction(()=>nativeReminderPreferences().items['busy:meeting'].end==='alarm');
    assert.equal(await page.evaluate(()=>nativeReminderChoices(nativeReminderPreferences(),'busy:meeting',cardFixture.dayKey).end),'alarm','series changes flow through unmodified date edges');
    await page.evaluate(()=>{
      closeSheet('block-edit-sheet');const f=cardFixture,host=document.getElementById('card-test-host');host.replaceChildren();
      appendHomeTravelCard(host,'home','shop',f.base+9*3600000,f.week.days[0].timeline[0],f.dayKey);host.querySelector('.travel-card').click();
    });
    const travel=page.locator('#travel-edit-reminders');
    assert.equal(await travel.locator('[data-reminder-edge]').count(),2,'travel card exposes departure and arrival only');
    assert.equal(await travel.locator('[data-reminder-owner]').first().getAttribute('data-reminder-owner'),'item:walk','travel uses saved destination ownership');
    await travel.locator('[data-reminder-edge="travelStart"]').selectOption('alarm');
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:walk'].dates?.[cardFixture.dayKey]?.travelStart==='alarm');
    await travel.locator('[data-reminder-lead]').selectOption('10');
    const projection=await page.evaluate(()=>{
      const f=cardFixture;
      return {before:nativeReminderEvents(f.week,f.data,sortSettings,f.prefs,Date.now()),
        after:nativeReminderEvents(f.week,f.data,sortSettings,nativeReminderPreferences(),Date.now())};
    });
    const starts=projection.after.filter(e=>e.owner==='item:walk' && e.reminderEdge==='travelStart');
    assert.equal(starts.length,2,'exactly one departure per date');
    const changed=starts.find(e=>e.dayKey===fixture.dayKey),original=projection.before.find(e=>e.key===changed.key);
    assert(original,'override keeps the event key and duplicate suppression receipts');
    assert.equal(changed.delivery,'alarm');assert.equal(original.at-changed.at,600000,'one date uses its lead time');
    assert.equal(starts.find(e=>e.dayKey!==fixture.dayKey).delivery,'notification','next date retains recurring delivery');
    assert.equal(projection.after.filter(e=>e.owner==='item:walk' && e.reminderEdge==='start').length,2,'destination start stays independent');
    await travel.locator('[data-reminder-scope]').selectOption('series');
    await travel.locator('[data-reminder-edge="travelEnd"]').selectOption('alarm');
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:walk'].travelEnd==='alarm');
    await travel.locator('[data-reminder-scope]').selectOption('date');
    await travel.getByRole('button',{name:'use recurring reminders for this date'}).click();
    await page.waitForFunction(()=>!nativeReminderPreferences().items['item:walk'].dates?.[cardFixture.dayKey]);
    assert.equal(await travel.locator('[data-reminder-edge="travelStart"]').inputValue(),'notification','reset restores inherited departure');
    assert.equal(await travel.locator('[data-reminder-edge="travelEnd"]').inputValue(),'alarm','reset follows latest series edit');
    const busyTravel=await page.evaluate(()=>{
      const f=cardFixture;closeSheet('travel-edit-sheet');
      const destination=blockedTimelineRows(f.dayKey,sortSettings,f.base,{clipAfter:null}).find(b=>b.label==='Meeting');
      openTravelEditSheet('home','shop',f.base+11*3600000,destination,f.dayKey);
      return document.querySelector('#travel-edit-reminders [data-reminder-owner]').dataset.reminderOwner;
    });
    assert.equal(busyTravel,'busy:meeting','travel to busy time uses that block’s existing choices');
    await page.evaluate(()=>{
      const f=cardFixture;closeSheet('travel-edit-sheet');
      currentCoordLocation=()=>({id:CURRENT_COORD_ID,name:'here',lat:40,lng:-74});travelFromCurrent=()=>({seconds:600,provider:'estimate'});
      openTravelEditSheet(CURRENT_COORD_ID,'shop',f.base+11*3600000,f.week.days[0].timeline[0],f.dayKey);
    });
    assert(await page.locator('#travel-edit-save').isDisabled(),'GPS origin cannot save an ephemeral travel duration');
    assert.equal(await travel.locator('[data-reminder-edge]').count(),2,'GPS-origin trip also exposes reminders');
    await page.screenshot({path:'test-results/native-card-reminders.png'});
    await page.evaluate(()=>{closeSheet('travel-edit-sheet');openTravelEditSheet('home','shop',cardFixture.base+11*3600000);});
    assert.equal(await page.locator('#travel-edit-reminders').count(),0,'route-only edit does not guess a destination item');
    assert(!await page.locator('#travel-edit-save').isDisabled(),'saved route duration remains editable after GPS trip');
    assert.deepEqual(errors,[],'card editor interactions have no page errors');
    console.log('PASS: card access, PWA isolation, date/series reminders, reset, stable travel identity and GPS trips');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
