const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({timezoneId:'America/New_York',viewport:{width:412,height:915}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const result = await page.evaluate(()=>{
      const RealDate=Date,now=new RealDate('2026-10-26T10:00:00').getTime();
      window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      try{
        const base=dayStart(now),at=(h,m=0)=>base+(h*60+m)*60000;
        const data=normalize([
          {hid:'read',name:'Read',type:'keepup',target:1,logs:[makeActualLog(at(8))]},
          {hid:'split',name:'Study',type:'keepup',target:1,breakable:true,durationMinutes:60,logs:[makeActualLog(at(9),{minutes:15})]},
          {hid:'repeat',name:'Stretch',type:'keepup',target:0.5,logs:[makeActualLog(at(9))]},
          {hid:'task',name:'Send report',type:'task',logs:[]},
          {hid:'plan',name:'Planned only',type:'keepup',target:1,logs:[makePlanLog(at(18))]},
          {hid:'appt',name:'Class',type:'keepup',appointment:{repeat:'once',startDate:dateKey(base),startMinute:720},logs:[]}
        ]);
        const row=(i,h,m,endh,endm=0,extra={})=>({kind:'fill',i,hid:data[i].hid,start:at(h,m),end:at(endh,endm),...extra});
        const timeline=[row(0,10,0,10,30),row(1,11,40,12),row(2,12,0,12,20),row(3,12,20,13),row(4,16,0,16,30),row(5,13,0,14),
          {kind:'travel',start:at(11,20),end:at(11,40),toName:'Library'},
          {kind:'blocked',start:at(13),end:at(16),label:'Busy'}];
        const settings={...loadSortSettings(),blockedTimes:normalizeBlockedTimes([{id:'morning',label:'Morning',days:[0,1,2,3,4,5,6],start:0,end:630},
          {id:'evening',label:'Evening',days:[0,1,2,3,4,5,6],start:1080,end:1440}]),blockedTimeOverrides:{},blockedTimeExceptions:{}};
        const week={days:[{dayBase:base,dayKey:dateKey(base),timeline}]};
        const before=localStorage.getItem(KEY),project=compileNativeWidgetSnapshot(week,data,settings,now);
        const day=project.days[0],partial=day.progress.items.find(h=>h.hid==='split');
        const invalid=compileNativeWidgetSnapshot(null,data,settings,now).days[0];
        // A row's stable ID wins over a stale array index after delete/reorder.
        const reordered=compileNativeWidgetSnapshot(week,[data[3],data[2],data[0],data[1],data[4],data[5]],settings,now);
        return {version:project.version,zone:project.timeZone,rows:day.rows,progress:day.progress,
          partial,invalidReady:invalid.ready,invalidGaps:invalid.gaps,
          gaps:day.gaps.map(g=>[(g.start-base)/60000,(g.end-base)/60000]),
          reorderedNames:reordered.days[0].rows.map(row=>row.title),unchanged:before===localStorage.getItem(KEY)};
      }finally{window.Date=RealDate;}
    });
    assert.equal(result.version,1);assert.equal(result.zone,'America/New_York');
    assert(!result.rows.some(row=>row.hid==='read'),'completed rows disappear');
    assert(result.rows.some(row=>row.title==='Travel to Library'),'travel remains occupied');
    assert(result.rows.find(row=>row.hid==='task').completion,'tasks expose an explicit completion action');
    assert.equal(result.rows.find(row=>row.hid==='split').completion.minutes,20,'split action logs just the scheduled chunk');
    assert(!result.rows.find(row=>row.hid==='appt').completion,'events have no completion action');
    assert(!result.rows.find(row=>row.kind==='travel').completion,'travel cannot complete its destination');
    assert.equal(result.progress.done,1,'only fully completed habits count');
    assert(result.progress.items.some(h=>h.hid==='task'),'tasks join the completion summary');
    assert(!result.progress.items.some(h=>h.hid==='appt'),'events are separate from items with a completion action');
    assert.deepEqual(result.progress.events,{total:1,upcoming:1},'event clock status is visible without assuming attendance');
    assert.equal(result.partial.detail,'15/60 min','partial split habit shows its real progress');
    assert(!result.partial.done,'partial split habit stays due');
    assert(!result.progress.items.find(h=>h.hid==='repeat').done,'one of two daily occurrences stays due');
    assert(!result.progress.items.find(h=>h.hid==='plan').done,'a plan log is not a completion');
    assert.deepEqual(result.gaps,[[630,680],[990,1080],[1439,1440]],'busy time, travel and all active work shape the free gaps');
    assert.deepEqual(result.reorderedNames,result.rows.map(row=>row.title),'stable IDs survive array reorder');
    assert.equal(result.invalidReady,false);assert.deepEqual(result.invalidGaps,[],'stale agenda never advertises free time');
    assert(result.unchanged,'projection never writes planner data');
    console.log('✓ Widget projection: saved agenda, travel/busy gaps, completion budgets, repeated habits, stable IDs, stale data and no writes');

    const missed=await page.evaluate(()=>{
      const now=Date.now(),base=dayStart(now),key=dateKey(now);
      const data=normalize([
        {hid:'miss',name:'Missed task',type:'task',dueDate:base,createdAt:base-86400000,logs:[]},
        {hid:'hidden',name:'Hidden habit',type:'keepup',createdAt:base-86400000,logs:[]},
        {hid:'done-task',name:'Completed task',type:'task',logs:[makeActualLog(now-3600000)]}
      ]);
      // A previously displayed commitment that no longer fits today's saved
      // plan is exactly the Home pill's evidence. Hide only one dated row.
      const snap={day:key,hids:{miss:{first:now-3600000},hidden:{first:now-3600000}},
        expectations:{[key]:{hids:['miss','hidden'],occurrences:[]}}};
      Storage.write(TODAY_SUGGESTED_KEY,snap);
      hideMissedRow({hid:'hidden',expectedDay:key},now);
      const week={days:[{dayBase:base,timeline:[],homeDisplayedTimeline:[]}]};
      const before=JSON.stringify([...Array(localStorage.length)].map((_,i)=>{const k=localStorage.key(i);return [k,localStorage.getItem(k)];}).sort());
      const progress=compileNativeWidgetSnapshot(week,data,loadSortSettings(),now).days[0].progress;
      const home=partitionDroppedItems(collectMissedFromSnapshot(data,[],loadTodaySuggested(),{},now),now);
      const after=JSON.stringify([...Array(localStorage.length)].map((_,i)=>{const k=localStorage.key(i);return [k,localStorage.getItem(k)];}).sort());
      const tomorrow=base+86400000+1;
      return {progress,homeVisible:home.visible.map(row=>row.hid),homeHidden:home.hidden.length,unchanged:before===after,
        expired:!missedHideIsActive({hid:'hidden',expectedDay:key},tomorrow)};
    });
    assert.equal(missed.progress.done,1,'a completed task today counts as done');
    assert.equal(missed.progress.missed,missed.homeVisible.length,'widget missed count matches Home');
    assert.equal(missed.progress.hidden,missed.homeHidden,'widget respects Home hidden items');
    assert.deepEqual(missed.progress.missedItems.map(row=>row.hid),missed.homeVisible);
    assert.equal(missed.progress.missedItems[0].expectedDay,new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}));
    assert(missed.unchanged,'missed projection writes no storage at all');assert(missed.expired,'the same hide expires at midnight');
    console.log('✓ Generic Progress: completed tasks, separate events, exact Home missed/hidden rows and no projection writes');

    const native=await browser.newPage({viewport:{width:412,height:915}});
    native.on('pageerror',error=>errors.push(error.message));
    await native.addInitScript(()=>{
      const RealDate=Date,now=new RealDate('2026-10-26T10:00:00').getTime();
      window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
      window.widgetLaunches=[{kind:'add'}];window.widgetReady=false;
      window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:'denied'})},widgets:{
        addListener:async(_,listener)=>{window.widgetListener=listener;},
        ready:async()=>{window.widgetReady=true;},
        takeLaunchRequest:async()=>({request:window.widgetLaunches.shift()})
      }};
    });
    await native.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await native.waitForSelector('#add-sheet.open');
    assert.equal(await native.locator('#type-seg [data-v="task"]').getAttribute('aria-pressed'),'true');
    assert.equal(await native.evaluate(()=>document.activeElement.id),'ting-message','widget plus focuses task name');
    assert.equal(await native.evaluate(()=>localStorage.getItem(KEY)),null,'opening quick add does not create an item');
    await native.evaluate(()=>{
      save(normalize([{hid:'first',name:'First',type:'task',logs:[]},{hid:'target',name:'Target',type:'keepup',logs:[]}]));
      window.widgetLaunches.push({kind:'item',hid:'target'});window.widgetListener();
    });
    await native.waitForSelector('#detail-sheet.open');
    assert.equal(await native.locator('#detail-name').textContent(),'Target','widget row opens the current matching item');
    assert.equal(await native.locator('#add-sheet').evaluate(el=>el.classList.contains('open')),false,'old task form is closed');
    await native.evaluate(()=>{window.widgetLaunches.push({kind:'today'});window.widgetListener();});
    await native.waitForFunction(()=>!document.querySelector('.sheet-wrap.open'));
    assert.equal(await native.evaluate(()=>window.widgetReady),true);
    await native.evaluate(()=>{
      save(normalize([{hid:'do-task',name:'Finish task',type:'task',logs:[]}]));
      window.widgetLaunches.push({kind:'done',completion:{hid:'do-task',dayKey:dateKey(Date.now()),operationId:'a'.repeat(32)}});window.widgetListener();
    });
    await native.waitForFunction(()=>isTaskDone(load()[0]));
    assert.equal(await native.evaluate(()=>normalizeLogs(load()[0].logs)[0].source),'native_widget','widget completion saves through canonical logs');
    await native.locator('#action-undo').click();
    assert.equal(await native.evaluate(()=>isTaskDone(load()[0])),false,'normal Undo reverses widget Done');
    await native.evaluate(()=>{
      save(normalize([{hid:'do-split',name:'Study session',type:'keepup',target:1,breakable:true,durationMinutes:60,logs:[]}]));
      window.splitWidgetAction={kind:'done',completion:{hid:'do-split',dayKey:dateKey(Date.now()),minutes:20,operationId:'b'.repeat(32)}};
      window.widgetLaunches.push(window.splitWidgetAction);window.widgetListener();
    });
    await native.waitForFunction(()=>breakableProgressMinutes(load()[0],dayStart(Date.now()))===20);
    await native.evaluate(()=>{window.widgetLaunches.push(window.splitWidgetAction);window.widgetListener();});
    await native.waitForFunction(()=>!window.widgetLaunches.length);
    assert.equal(await native.evaluate(()=>breakableProgressMinutes(load()[0],dayStart(Date.now()))),20,'a repeated chunk tap is idempotent');
    await native.evaluate(()=>{
      save(normalize([{hid:'do-value',name:'Record value',type:'task',trackValue:true,logs:[]}]));
      window.widgetLaunches.push({kind:'done',completion:{hid:'do-value',dayKey:dateKey(Date.now()),operationId:'c'.repeat(32)}});window.widgetListener();
    });
    await native.waitForSelector('#value-log-sheet.open');
    assert.equal(await native.evaluate(()=>isTaskDone(load()[0])),false,'value tracking waits for the normal prompt');
    await native.locator('#value-log-input').fill('3');await native.locator('#value-log-save').click();
    await native.waitForFunction(()=>isTaskDone(load()[0]));
    assert.equal(await native.evaluate(()=>logValue(normalizeLogs(load()[0].logs)[0])),3);
    const valueBefore=await native.evaluate(()=>localStorage.getItem(KEY));
    await native.evaluate(()=>completeNativeWidgetItem({hid:'do-value',dayKey:'2026-10-25',operationId:'d'.repeat(32)}));
    assert.equal(await native.evaluate(()=>localStorage.getItem(KEY)),valueBefore,'stale dated actions cannot change data');
    console.log('✓ Wide Agenda Done: canonical task completion, Undo, exact split minutes, duplicate protection and value prompts');
    await native.evaluate(()=>{
      closeSheet('detail-sheet');
      const now=Date.now();
      save(normalize([{hid:'expired',name:'Missed morning item',type:'keepup',target:1,
        allowedTimeStart:360,allowedTimeEnd:540,durationMinutes:15,createdAt:now-30*86400000,logs:[now-2*86400000]}]));
      sortSettings={...loadSortSettings(),showWeekOnHome:true,agendaOptimizer:false,blockedTimes:[],locations:[]};
      render({__optimizedWeek:buildWeekAgenda(load(),sortSettings,7)});
      window.widgetLaunches.push({kind:'missed'});window.widgetListener();
    });
    await native.waitForSelector('#slipped-sheet.open .dropped-item:not(.is-hidden)');
    const unchangedBefore=await native.evaluate(()=>localStorage.getItem(KEY));
    await native.evaluate(()=>{window.widgetLaunches.push({kind:'hide',hid:'expired',expectedDay:dateKey(Date.now()),occurrenceKey:''});window.widgetListener();});
    await native.waitForSelector('#slipped-sheet.open .dropped-item.is-hidden');
    assert.equal(await native.evaluate(()=>localStorage.getItem(KEY)),unchangedBefore,'hide does not edit or snooze the task');
    await native.locator('#action-undo').click();
    await native.waitForSelector('#slipped-sheet.open .dropped-item:not(.is-hidden)');
    assert.equal(await native.evaluate(()=>loadMissedHides()['expired::'+dateKey(Date.now())]),undefined,'ordinary Undo restores a widget hide');
    console.log('✓ Widget missed actions: opens the Home list, hides until tonight and supports normal Undo');
    assert.deepEqual(errors,[]);
    console.log('✓ Widget navigation: cold quick add, task type, keyboard focus, stable item link and return to plan without assistant access');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
