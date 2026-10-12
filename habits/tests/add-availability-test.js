// Fixed overlap guidance and optional, read-only draft previews.
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');
const assert = require('node:assert/strict');
const url = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-10-07T08:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','1');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({defaultType:'keepup',defaultDurationMinutes:30,blockedTimes:[],locations:[],topics:[]}));
    });
    await page.goto(url,{waitUntil:'load'});
    await page.locator('#open-add').click();
    assert.equal(await page.locator('#add-more-options').isVisible(),false);
    assert.equal(await page.locator('#add-conflict-note').isVisible(),false);
    assert.equal(await page.locator('#add-room-result').isVisible(),false);
    console.log('ok: fresh add stays quiet and options stay folded');

    const at = value=>new Date(`2026-10-07T${value}:00-04:00`).getTime();
    await page.evaluate(({item})=>{
      save([item]);
      saveSortSettings({...loadSortSettings(),blockedTimes:[{label:'Lunch',days:[],start:720,end:780}]});
    },{item:baseHabit({hid:'calendar-meeting',name:'Calendar meeting',type:'task',source:'gcal',dueDate:at('10:00'),eventTime:at('10:00'),durationMinutes:60})});
    await page.locator('#type-seg [data-v="task"]').click();
    await page.locator('#ting-message').fill('New appointment');
    await page.locator('#ting-due-date').fill('2026-10-07');
    await page.locator('#ting-due-time').fill('10:30');
    await page.waitForFunction(()=>$('add-conflict-note').textContent.includes('Calendar meeting'));
    assert.equal(await page.locator('#do-save').isEnabled(),true);
    assert.equal(await page.locator('#add-more-options').isVisible(),false);
    await page.locator('#ting-due-time').fill('11:00');
    await page.waitForFunction(()=>$('add-conflict-note').hidden);
    await page.locator('#ting-due-time').fill('12:00');
    await page.waitForFunction(()=>$('add-conflict-note').textContent.includes('Lunch'));
    await page.evaluate(()=>{
      saveSortSettings({...loadSortSettings(),blockedTimes:[]});
      refreshAddAvailability();
    });
    assert.equal(await page.locator('#add-conflict-note').isVisible(),false);
    await page.evaluate(()=>{
      saveSortSettings({...loadSortSettings(),blockedTimes:[{label:'Lunch',days:[],start:720,end:780}]});
      refreshAddAvailability();
    });
    assert.match(await page.locator('#add-conflict-note').textContent(),/Lunch/);
    await page.locator('#ting-due-time').fill('');
    await page.waitForFunction(()=>$('add-conflict-note').hidden);
    console.log('ok: imports and busy times warn inline, touching endpoints and flexible due dates do not');

    const edges = await page.evaluate(()=>{
      const at = value=>new Date(value).getTime();
      const base = normalize([{name:'Draft',type:'task',eventTime:at('2026-10-07T10:00:00-04:00'),durationMinutes:120,breakable:true,minChunkMinutes:20}])[0];
      const settings = {...loadSortSettings(),blockedTimes:[{label:'Break',days:[],start:630,end:660}]};
      const firstSessionClear = addFixedConflict(base,[],settings) === null;
      const fullConflict = addFixedConflict({...base,breakable:false},[],settings)?.name;
      const longerFirstSession = addFixedConflict({...base,minChunkMinutes:45},[],settings)?.name;
      const midnight = {...base,eventTime:at('2026-10-07T23:45:00-04:00'),durationMinutes:60,breakable:false};
      const overnight = addFixedConflict(midnight,[],{...settings,blockedTimes:[{label:'Sleep',days:[4],start:0,end:360}]})?.name;
      const previous = normalize([{name:'Late meeting',type:'task',eventTime:at('2026-10-06T23:45:00-04:00'),durationMinutes:60}]);
      const previousConflict = addFixedConflict({...base,eventTime:at('2026-10-07T00:15:00-04:00')},previous,{...settings,blockedTimes:[]})?.name;
      const plans = normalize([{name:'Timed habit',type:'keepup',target:1,durationMinutes:30,logs:[{ts:base.eventTime,plan:true,timed:true}]}]);
      const timedHabit = addFixedConflict(base,plans,{...settings,blockedTimes:[]})?.name;
      const dayKey = dateKey(base.eventTime);
      const signature = blockedInstanceKey('Break',630,660);
      const whole = {...base,breakable:false};
      const cancelled = addFixedConflict(whole,[],{...settings,cancelledBlocks:{[dayKey]:[signature]}}) === null;
      const adjusted = addFixedConflict(whole,[],{...settings,blockedTimeOverrides:{[dayKey]:{[signature]:{start:780,end:840}}}}) === null;
      const completed = addFixedConflict(base,normalize([{name:'Done',type:'task',eventTime:base.eventTime,logs:[Date.now() - 60000]}]),{...settings,blockedTimes:[]}) === null;
      return {firstSessionClear,fullConflict,longerFirstSession,overnight,previousConflict,timedHabit,cancelled,adjusted,completed};
    });
    assert.deepEqual(edges,{firstSessionClear:true,fullConflict:'Break',longerFirstSession:'Break',overnight:'Sleep',previousConflict:'Late meeting',timedHabit:'Timed habit',cancelled:true,adjusted:true,completed:true});
    console.log('ok: minimum first sessions, duration edits, overnight dates and timed habit plans match planner reservations');

    await page.locator('#ting-due-time').fill('12:00');
    await page.locator('#do-save').click();
    assert.equal(await page.evaluate(()=>load().filter(h=>h.name === 'New appointment').length),1);
    console.log('ok: warned item still saves with one tap');

    await page.evaluate(()=>{
      closeSheet('detail-sheet');
      save([]);
      saveSortSettings({...loadSortSettings(),defaultType:'keepup',defaultTarget:1,defaultEarlyWindowDays:0,defaultDelayAllowanceDays:0,
        defaultAllowedWeekdays:[],defaultAllowedTimeStart:null,defaultAllowedTimeEnd:null,defaultDurationMinutes:30,
        defaultBreakable:false,blockedTimes:[],availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440]});
      applyAddDefaults();openSheet('add-sheet');
    });
    await page.locator('#ting-message').fill('New daily habit');
    await page.locator('#add-more-toggle').click();
    const storageBefore = await page.evaluate(()=>localStorage.getItem(KEY));
    await page.locator('#add-check-room').click();
    await page.waitForFunction(()=>$('add-check-room').textContent === 'preview schedule',null,{timeout:65000});
    assert.match(await page.locator('#add-room-result').textContent(),/Preview:.*next 7 days/);
    assert.equal(await page.evaluate(()=>localStorage.getItem(KEY)),storageBefore);
    assert.equal(await page.locator('#ting-message').inputValue(),'New daily habit');
    console.log('ok: actual worker checks habitual room without saving the draft');

    await page.evaluate(()=>{
      saveSortSettings({...loadSortSettings(),blockedTimes:[{label:'Unavailable',days:[],start:0,end:1439}]});
      refreshAddAvailability();
    });
    assert.equal(await page.locator('#add-room-result').isVisible(),false);
    await page.locator('#add-check-room').click();
    await page.waitForFunction(()=>$('add-check-room').textContent === 'preview schedule',null,{timeout:65000});
    assert.match(await page.locator('#add-room-result').textContent(),/No room found/);
    assert.equal(await page.locator('#do-save').isEnabled(),true);
    await page.locator('#ting-times').fill('2');
    assert.equal(await page.locator('#add-room-result').isVisible(),false);
    await page.locator('#add-check-room').click();
    await page.locator('#ting-message').fill('Changed draft');
    await page.waitForFunction(()=>_addRoomRun === null);
    assert.equal(await page.locator('#add-room-result').isVisible(),false);
    await page.locator('#add-check-room').click();
    await page.locator('#do-cancel').click();
    assert.equal(await page.evaluate(()=>_addRoomRun === null),true);
    console.log('ok: full days warn without blocking; edits and cancellation discard draft checks');

    await page.evaluate(async()=>{
      applyAddDefaults();openSheet('add-sheet');
      const available = agendaPlannerWorkerAvailable;
      try{
        agendaPlannerWorkerAvailable = ()=>false;
        await checkAddRoom();
      }finally{agendaPlannerWorkerAvailable = available;}
    });
    assert.match(await page.locator('#add-room-result').textContent(),/Couldn’t check room.*still add/);
    assert.equal(await page.locator('#do-save').isEnabled(),true);
    assert.equal(await page.locator('#add-check-room').isEnabled(),true);
    console.log('ok: unavailable worker restores the check control and keeps Add usable');

    const impact = await page.evaluate(()=>{
      const week = (rows)=>({days:[{timeline:rows}]});
      const row = (i,minutes)=>({kind:'fill',i,start:0,end:minutes * 60000});
      return addRoomPreviewCopy(week([row(0,60)]),week([row(0,30),row(1,20)]),[{name:'Work'}],{type:'task',durationMinutes:60});
    });
    assert.equal(impact.tone,'warning');
    assert.match(impact.text,/of 1h.*Work may lose planned time/);
    assert.deepEqual(errors,[]);
    console.log('ok: partial task previews and displaced work are described as warnings; no page errors');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
