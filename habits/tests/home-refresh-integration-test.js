// Exercise real fetch/cache/import/planner code. Only remote weather responses
// and the Android bridge are fixtures; refresh orchestration is never mocked.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'America/New_York'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let temperature=17,failAir=false,failForecast=false,delayForecast=0;const requests=[];
  await page.route('https://**.open-meteo.com/**',async route=>{
   const url=new URL(route.request().url());requests.push(url);
   const air=url.hostname.startsWith('air-');
   if((air&&failAir)||(!air&&failForecast))return route.fulfill({status:503,body:'unavailable'});
   if(!air&&delayForecast)await new Promise(resolve=>setTimeout(resolve,delayForecast));
   const base=new Date('2026-11-03T00:00:00-05:00').getTime()/1000;
   const time=Array.from({length:7*24},(_,i)=>base+i*3600),count=(url.searchParams.get('latitude')||'').split(',').length;
   const payload={timezone:'America/New_York',hourly:{time,temperature_2m:time.map(()=>temperature),apparent_temperature:time.map(()=>temperature),precipitation_probability:time.map(()=>10),weather_code:time.map(()=>1),us_aqi:time.map(()=>20)},daily:{time:Array.from({length:7},(_,i)=>base+i*86400),weather_code:Array(7).fill(1),temperature_2m_min:Array(7).fill(temperature-2),temperature_2m_max:Array(7).fill(temperature+2)}};
   await route.fulfill({json:count>1?Array.from({length:count},()=>payload):payload});
  });
  await page.addInitScript(()=>{localStorage.setItem('tings_coach_essentials_v2','done');localStorage.setItem('tings_coach_install_v2','done');});
  await page.goto(process.env.HABITS_URL||'http://127.0.0.1:4181/',{waitUntil:'load'});
  await page.evaluate(async()=>{
   const RealDate=Date,now=new RealDate('2026-11-03T08:00:00-05:00').getTime();
   globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   if(typeof stopHomeAgendaRefinement==='function')stopHomeAgendaRefinement();
   const profile={id:'air',name:'Outdoor',rules:[{metric:'us_aqi',max:100,hard:false,relative:'none'}]};
   saveSortSettings({...DEFAULT_SORT_SETTINGS,preset:'todayFirst',agendaOptimizer:!new URLSearchParams(location.search).has('planner'),blockedTimes:[],availabilityMinutes:Array(7).fill(1440),homeCityName:'Home',homeCityLat:40.7,homeCityLng:-74,weatherProfiles:[profile],locations:[]});
   sortSettings=loadSortSettings();weatherCacheWrite({});
   save(normalize([{hid:'outdoor',name:'Outdoor',type:'keepup',target:1,durationMinutes:30,weatherProfileMode:'profile',weatherProfileId:'air',logs:[]} ]));
   window.refreshTestCalendarStart=dayStart(now)+10*3600000;
   window.refreshTestCalendarReads=0;window.refreshTestNativeUpdates=[];
   localStorage.setItem(DEVICE_CALENDARS_KEY,JSON.stringify({enabled:true,calendarIds:['7']}));
   window.TingsNative={isNative:true,calendars:{read:async ids=>{
    window.refreshTestCalendarReads++;
    if(window.refreshTestBadCalendar)return {complete:false};
    return {complete:true,calendarIds:ids,from:dayStart(now),to:dayStart(now)+14*86400000,events:[{id:'device:7:20',calendarId:'7',seriesId:'device:7:series',subject:'Meeting '+window.refreshTestCalendarReads,start:window.refreshTestCalendarStart,end:window.refreshTestCalendarStart+3600000,isAllDay:false}]};
   }}};
   // Delivery is Android-owned. Assert it observes the newly published plan.
   reconcileNativeReminders=async()=>{window.refreshTestNativeUpdates.push({dirty:_optimizerHomeReadyDirtyKey,current:homePlannerDirtyKey(load()),start:_homeRenderedWeek?.days.flatMap(day=>day.timeline).find(row=>row.hid==='device:7:20'||row.h?.hid==='device:7:20')?.start});};
   await refreshHomeAgenda();
  });
  const state=()=>page.evaluate(()=>({calendarReads:refreshTestCalendarReads,event:load().find(h=>h.externalId==='device:7:20')?.calendarStart,forecast:weatherCacheRead().weekly?.samples?.[0]?.temperature_2m,airError:weatherCacheRead().lastError,ready:_optimizerHomeReadyDirtyKey===homePlannerDirtyKey(load()),pending:!!_optimizerHomeRequestKey,native:refreshTestNativeUpdates.at(-1),busy:!!pullRefreshPromise,hidden:pullRefreshStatus.hidden,toast:$('toast-text').textContent}));
  let first=await state();assert.equal(first.calendarReads,1);assert.equal(first.forecast,17);assert.equal(first.ready,true);assert.equal(first.pending,false);assert.equal(first.busy,false);assert.equal(first.hidden,true);assert.equal(first.native.current,first.native.dirty);assert.equal(first.native.start,first.event);
  assert.ok(requests.some(url=>url.hostname.startsWith('air-')),'refresh includes needed air quality');
  temperature=23;const before=requests.length;
  await page.evaluate(async()=>{window.refreshTestCalendarStart+=2*3600000;await refreshHomeAgenda();});
  let moved=await state();assert.equal(moved.calendarReads,2);assert.equal(moved.forecast,23);assert.ok(requests.length>before,'force refresh bypasses fresh forecast cache');assert.equal(moved.native.start,moved.event);assert.notEqual(moved.event,first.event);assert.equal(moved.ready,true);
  // A partial air-quality outage must not erase a successful new forecast or
  // silently announce a complete refresh. An invalid calendar keeps its data.
  failAir=true;temperature=26;
  await page.evaluate(async()=>{window.refreshTestBadCalendar=true;await refreshHomeAgenda();});
  const partial=await state();assert.equal(partial.event,moved.event);assert.equal(partial.forecast,26);assert.ok(partial.airError);assert.match(partial.toast,/Cached content was kept/);assert.equal(partial.ready,true);
  failForecast=true;
  await page.evaluate(()=>refreshHomeAgenda());const offline=await state();assert.equal(offline.event,moved.event);assert.equal(offline.forecast,26);assert.equal(offline.hidden,true);assert.equal(offline.busy,false);
  // Force refresh waits for an already-running periodic weather fetch, then
  // performs its own fresh request instead of reusing the periodic result.
  failAir=false;failForecast=false;delayForecast=100;
  const beforeOverlap=requests.filter(url=>!url.hostname.startsWith('air-')).length;
  await page.evaluate(async()=>{window.refreshTestBadCalendar=false;weatherCacheWrite({});const periodic=refreshWeatherForecast();await refreshHomeAgenda();await periodic;});
  const afterOverlap=requests.filter(url=>!url.hostname.startsWith('air-')).length;
  assert.ok(afterOverlap-beforeOverlap>=2,'manual refresh issues a forced forecast after the in-flight periodic fetch');
  // Two callers still share one whole refresh, through source reads and the
  // real agenda publication rather than just the spinner's visible lifetime.
  const readsBefore=await page.evaluate(()=>refreshTestCalendarReads);
  await page.evaluate(()=>Promise.all([refreshHomeAgenda(),refreshHomeAgenda()]));
  assert.equal(await page.evaluate(()=>refreshTestCalendarReads),readsBefore+1);
  // A failed planner retains the mounted agenda, reports the failure, clears
  // the loading state, and permits the next refresh to recover.
  const plannerFailure=await page.evaluate(async()=>{
   const original=buildWeekAgendaOffMain,previous=_homeRenderedWeek;
   buildWeekAgendaOffMain=()=>Promise.reject(new Error('worker unavailable'));
   try{await refreshHomeAgenda();return {kept:_homeRenderedWeek===previous,hidden:pullRefreshStatus.hidden,busy:!!pullRefreshPromise,toast:$('toast-text').textContent};}
   finally{buildWeekAgendaOffMain=original;}
  });
  assert.equal(plannerFailure.kept,true);assert.equal(plannerFailure.hidden,true);assert.equal(plannerFailure.busy,false);assert.match(plannerFailure.toast,/Couldn’t finish refreshing/);
  await page.evaluate(()=>refreshHomeAgenda());assert.equal((await state()).ready,true);
  assert.deepEqual(errors,[]);
  console.log('PASS refresh real calendar merge, weather/air fetch and cache bypass, agenda publication, native ordering, partial/offline recovery, in-flight fetch');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
