const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York',hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('tings_coach_essentials_v2','done');localStorage.setItem('tings_coach_install_v2','done');});
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const result=await page.evaluate(async()=>{
      const RealDate=Date,now=new RealDate(2026,10,3,12).getTime();globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      const settings={...loadSortSettings(),blockedTimes:[],locations:[],travel:{},availabilityMinutes:Array(7).fill(1440),agendaOptimizer:false};saveSortSettings(settings);sortSettings=loadSortSettings();
      save(normalize([{hid:'tick-session-a',name:'Read',type:'keepup',target:1,tapStartsSession:true,trackValue:true,durationMinutes:30,logs:[]},{hid:'tick-session-b',name:'Write',type:'task',tapStartsSession:true,durationMinutes:20,logs:[]}]));
      const defaultOff=normalize([{name:'Default'}])[0].tapStartsSession===false;
      const states=[],calls=[];let route='',settingsOpened=0;
      window.TingsNative={isNative:true,quiet:{reconcile:async config=>{states.push(config);return {granted:false};},status:async()=>({granted:false}),openSettings:async()=>{settingsOpened++;},consumeRoute:async()=>{const value=route;route='';return {route:value};}},notifications:{requestPermissions:async()=>({display:'granted'})}};
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({version:4,enabled:false,items:{'item:tick-session-a':{dnd:true}}}));
      quickLog(0);await reconcileNativeQuiet();const first=habitTimer?.idx===0 && !load()[0].logs.length && states.at(-1).intervals.some(i=>i.session);
      quickLog(1);const conflict=habitTimer?.idx===0 && !load()[1].logs.length;
      quickLog(0);await reconcileNativeQuiet();const stop=!habitTimer && valueLogIdx===0 && valueLogMinutes>0 && !states.at(-1).intervals.some(i=>i.session);$('value-log-cancel').click();const discard=!load()[0].logs.length;
      quickLog(0);quickLog(0);$('value-log-input').value='5';$('value-log-note').value='session note';$('value-log-save').click();
      const log=load()[0].logs.find(x=>x.value===5),saved=Boolean(log && log.minutes>0 && log.note==='session note');
      startHabitTimer(1,{completionMode:'auto',startedAt:now-120000,targetAt:now-1000});tickHabitTimer();await reconcileNativeQuiet();const autoDone=isTaskDone(load()[1]) && !getDoingNow();
      const beforeCopy=load(),originalReconcile=reconcileNativeReminders;reconcileNativeReminders=async()=>{};
      openDetail(0);$('detail-duplicate').click();const cancelledId=detailUnsavedCreate.hid;
      const staged=detailUnsavedReminders?.duplicateChoices?.dnd && !nativeReminderPreferences().items[`item:${cancelledId}`];
      $('detail-close').click();const cancelledCopy=!load().some(h=>h.hid===cancelledId) && !nativeReminderPreferences().items[`item:${cancelledId}`];
      openDetail(0);$('detail-duplicate').click();const copiedId=detailUnsavedCreate.hid;$('detail-save').click();
      const copied=load().find(h=>h.hid===copiedId),copyPreferences=staged && cancelledCopy && copied && !copied.logs.length && copied.tapStartsSession && nativeReminderPreferences().items[`item:${copiedId}`].dnd;
      closeDetail();save(beforeCopy);const copyPrefs=nativeReminderPreferences();delete copyPrefs.items[`item:${copiedId}`];localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(copyPrefs));reconcileNativeReminders=originalReconcile;
      const dnd=nativeDndControl('item:tick-session-b','DND during session');document.body.append(dnd);const check=dnd.querySelector('input');check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,20));const denied=settingsOpened===1 && nativeReminderPreferences().items['item:tick-session-b'].dnd;
      reconcileNativeReminders=async()=>{};
      nativeClearItemReminders('item:tick-session-b');const independentDnd=nativeReminderPreferences().items['item:tick-session-b'].dnd;
      saveSortSettings({...settings,blockedTimes:[{label:'New quiet block',days:[],start:660,end:780}]});sortSettings=loadSortSettings();renderBlockedTimeControls();
      const blockId=sortSettings.blockedTimes[0].reminderId,blockOwner=nativeBusyReminderKey(sortSettings.blockedTimes[0],0),blockPrefs=nativeReminderPreferences();blockPrefs.items[blockOwner]={dnd:true};localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(blockPrefs));
      saveBlockedTimePatch(0,{start:690});const stableBusyId=Boolean(blockId) && sortSettings.blockedTimes[0].reminderId===blockId && nativeReminderPreferences().items[nativeBusyReminderKey(sortSettings.blockedTimes[0],0)].dnd;
      saveSortSettings(settings);sortSettings=loadSortSettings();reconcileNativeReminders=originalReconcile;
      const busy={label:'Busy',start:660,end:780,days:[],reminderId:'busy-local'};const compiled=compileNativeQuietSchedule(load(),{...settings,blockedTimes:[busy]},{enabled:false,items:{'busy:busy-local':{dnd:true}}},now);
      const overlap=compiled.intervals.some(i=>i.start<=now && i.end>now) && compiled.busySelected;
      const catchups=nativeCatchupControls();document.body.append(catchups);const defaults=[...catchups.querySelectorAll('input[type="checkbox"]')].every(el=>!el.checked) && [...catchups.querySelectorAll('input[type="time"]')].map(el=>el.value).join(',')==='09:00,18:00';
      const daily=catchups.querySelector('input[type="checkbox"]');daily.checked=true;daily.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,30));const independent=nativeReminderPreferences().daily.enabled && !nativeReminderPreferences().enabled && !nativeCatchupRule(nativeReminderPreferences().weekly,true).enabled;
      const [dailyTime,weeklyTime]=catchups.querySelectorAll('input[type="time"]'),weekly=catchups.querySelectorAll('input[type="checkbox"]')[1],day=catchups.querySelector('select');
      dailyTime.value='10:30';dailyTime.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,30));
      day.value='1';weeklyTime.value='19:15';weekly.checked=true;weekly.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,30));
      const edited=nativeReminderPreferences().daily.minute===630 && nativeReminderPreferences().weekly.enabled && nativeReminderPreferences().weekly.minute===1155 && nativeReminderPreferences().weekly.day===1;
      daily.checked=false;daily.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,30));const disabled=!nativeReminderPreferences().daily.enabled && nativeReminderPreferences().weekly.enabled;
      route='weekly';await nativeConsumeCatchupRoute();const weeklyNav=$('overview-sheet').classList.contains('open') && overviewRecentOffset===0;
      route='daily';await nativeConsumeCatchupRoute();const dailyNav=!$('overview-sheet').classList.contains('open');
      window.TingsNative={isNative:false};
      const originalWeather=refreshWeatherForecast,originalViews=refreshOpenViews,originalCache=weatherCacheRead;let finish;
      refreshWeatherForecast=()=>{calls.push('weather');return new Promise(r=>{finish=r;});};refreshOpenViews=()=>calls.push('render');weatherCacheRead=()=>({});
      const refresh=refreshHomeAgenda(),second=refreshHomeAgenda();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const single=calls.length===1 && !pullRefreshStatus.hidden;finish(true);await Promise.all([refresh,second]);
      const finished=calls.join(',')==='weather,render' && pullRefreshStatus.hidden;
      refreshWeatherForecast=async()=>{throw new Error('offline');};await refreshHomeAgenda();const offline=$('toast-text').textContent.includes('Cached content was kept') && load().length===2;
      const originalCalendar=refreshDeviceCalendars;window.TingsNative={isNative:true};refreshDeviceCalendars=async()=>({error:'offline calendar'});refreshWeatherForecast=async()=>true;
      await refreshHomeAgenda();const partial=$('toast-text').textContent.includes('Cached content was kept');refreshDeviceCalendars=originalCalendar;window.TingsNative={isNative:false};
      const spacer=document.createElement('div');spacer.style.height='2500px';document.body.append(spacer);window.scrollTo({top:600,behavior:'instant'});const beforeScroll=window.scrollY;
      await refreshHomeAgenda();await new Promise(requestAnimationFrame);const scrollPreserved=beforeScroll>0 && Math.abs(window.scrollY-beforeScroll)<2;spacer.remove();window.scrollTo({top:0,behavior:'instant'});
      refreshWeatherForecast=originalWeather;refreshOpenViews=originalViews;weatherCacheRead=originalCache;
      return {defaultOff,first,conflict,stop,discard,saved,autoDone,copyPreferences:Boolean(copyPreferences),denied,independentDnd,stableBusyId,overlap,defaults,independent,edited,disabled,weeklyNav,dailyNav,single,finished,offline,partial,scrollPreserved};
    });
    for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
    // Cancelled/multitouch pulls and controls do not arm the gesture.
    const gesture=await page.evaluate(()=>{
      window.TingsNative={isNative:false};for(const sheet of document.querySelectorAll('.sheet-wrap.open'))closeSheet(sheet.id);window.scrollTo({top:0,behavior:'instant'});
      const send=(target,type,touches)=>target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:touches.map((p,i)=>new Touch({identifier:i,target,clientX:p[0],clientY:p[1]}))}));
      const target=$('list');send(target,'touchstart',[[10,10]]);send(target,'touchmove',[[10,140]]);const ready=pullRefreshReady;send(target,'touchcancel',[]);const cancelled=!pullRefreshStart && !pullRefreshReady;
      send(target,'touchstart',[[10,10]]);send(target,'touchmove',[[10,140],[20,150]]);const multi=!pullRefreshStart;
      const button=$('refresh-agenda');send(button,'touchstart',[[10,10]]);const control=!pullRefreshStart;
      send(target,'touchstart',[[10,10]]);send(target,'touchmove',[[100,30]]);const horizontal=!pullRefreshStart;
      return {ready,cancelled,multi,control,horizontal};
    });for(const [key,value] of Object.entries(gesture))assert.equal(value,true,key);
    // Real touch input must refresh on the first drag from a card surface,
    // track finger rotation, and preserve horizontal swipe/tap behavior.
    await page.evaluate(()=>{
      refreshWeatherForecast=()=>{window.refreshGestureCalls=(window.refreshGestureCalls||0)+1;return new Promise(resolve=>{window.finishGestureRefresh=resolve;});};
      refreshOpenViews=()=>{};weatherCacheRead=()=>({});
      save(normalize([{hid:'pull-card',name:'Pull from this card',type:'keepup',target:1,durationMinutes:20,logs:[]}]));
      render();window.scrollTo({top:0,behavior:'instant'});
    });
    const cdp=await page.context().newCDPSession(page);
    const card=page.locator('.ting-card').first();await card.waitFor({state:'visible'});
    const box=await card.boundingBox(),x=Math.round(box.x+box.width*.4),y=Math.round(box.y+Math.min(30,box.height/2));
    const touch=async(type,px=x,py=y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x:px,y:py}]});
    await touch('touchStart');await touch('touchMove',x,y+20);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const early=await page.evaluate(()=>({visible:!pullRefreshStatus.hidden,angle:pullRefreshIcon.style.transform,transform:pullRefreshStatus.style.transform}));
    assert.equal(early.visible,true,'feedback starts with the first small pull');
    await touch('touchMove',x,y+80);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const armed=await page.evaluate(()=>({ready:pullRefreshReady,angle:pullRefreshIcon.style.transform,transform:pullRefreshStatus.style.transform}));
    assert.equal(armed.ready,true,'one comfortable card drag arms refresh');
    assert.notEqual(armed.angle,early.angle,'reload icon rotates with the finger');
    assert.notEqual(armed.transform,early.transform,'indicator follows the finger');
    await touch('touchEnd');
    await page.waitForFunction(()=>window.refreshGestureCalls===1 && pullRefreshStatus.classList.contains('is-refreshing'));
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.sheet-wrap.open'))),false,'pull does not open the card');
    assert.equal(await page.evaluate(()=>pullRefreshIcon.getAnimations().some(animation=>animation.effect.getTiming().iterations===Infinity)),true,'spinner uses a continuous transform animation');
    await page.evaluate(()=>window.finishGestureRefresh(true));
    await page.waitForFunction(()=>!pullRefreshPromise && pullRefreshStatus.hidden);
    // A short pull springs home without refreshing, including when reduced
    // motion is requested. Retreating below the threshold also disarms it.
    await touch('touchStart');await touch('touchMove',x,y+80);await touch('touchMove',x,y+25);
    assert.equal(await page.evaluate(()=>pullRefreshReady),false,'retreat disarms refresh');
    await touch('touchEnd');await page.waitForFunction(()=>pullRefreshStatus.hidden);
    assert.equal(await page.evaluate(()=>window.refreshGestureCalls),1,'short pull does not refresh');
    await touch('touchStart');await touch('touchMove',x+90,y+8);await touch('touchEnd');
    assert.equal(await page.evaluate(()=>!pullRefreshStart && !pullRefreshReady),true,'horizontal swipe does not arm refresh');
    assert.equal(await page.evaluate(()=>window.refreshGestureCalls),1);
    await page.evaluate(()=>closeAllSwipes());
    await page.emulateMedia({reducedMotion:'reduce'});
    await touch('touchStart');await touch('touchMove',x,y+25);await touch('touchEnd');
    await page.waitForFunction(()=>pullRefreshStatus.hidden);
    // Multiple input samples within one display frame coalesce into one
    // paint. The icon continues moving between sparse touch samples.
    const batched=await page.evaluate(async()=>{
      const target=$('list');
      const send=(type,y)=>target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[new Touch({identifier:9,target,clientX:10,clientY:y})]}));
      let writes=0;const observer=new MutationObserver(records=>{writes+=records.filter(record=>record.attributeName==='style').length;});
      observer.observe(pullRefreshStatus,{attributes:true});
      send('touchstart',10);for(let y=20;y<=70;y++)send('touchmove',y);
      await Promise.resolve();const beforeFrame=writes;
      await new Promise(requestAnimationFrame);await Promise.resolve();const first=pullRefreshMotion.offset,afterFrame=writes;
      await new Promise(requestAnimationFrame);const second=pullRefreshMotion.offset;
      observer.disconnect();send('touchend',70);
      return {beforeFrame,afterFrame,continues:second>first};
    });
    assert.equal(batched.beforeFrame,0,'touch samples do not write styles outside display frames');
    assert.ok(batched.afterFrame<=2,'a burst of touch input paints once per display frame');
    assert.equal(batched.continues,true,'drag interpolates smoothly between input samples');
    await page.waitForFunction(()=>pullRefreshStatus.hidden);
    assert.deepEqual(errors,[]);console.log('PASS session start/stop/discard/value/auto/conflict, denied DND, busy intervals, catchup independence/navigation, refresh concurrency/offline/gesture cancellation');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
