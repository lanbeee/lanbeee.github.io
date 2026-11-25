// Exercise every Bulk Edit field through its actual control, then verify the
// normalized saved records and the combined undo. Choose dependent fields
// before their prerequisites to catch operations applied in selection order.
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');

(async()=>{
  const browser = await (process.env.TEST_BROWSER === 'webkit' ? webkit : chromium).launch();
  try{
    const context = await browser.newContext({viewport:{width:1200,height:850},timezoneId:'America/New_York',serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-30T08:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        agendaOptimizer:false,
        topics:['existing'],
        locations:[{id:'desk',name:'Desk',lat:40,lng:-73},{id:'park',name:'Park',lat:40.01,lng:-73}],
        weatherProfiles:[{id:'fair',name:'Fair weather',rules:[]}]
      }));
      localStorage.setItem('tings_v2',JSON.stringify([
        {hid:'audit-habit',name:'Audit habit',type:'keepup',target:1,durationMinutes:20,priority:2,
          locationIds:['desk'],locationPrefs:{desk:'high'},anywhereAllowed:false,
          snoozedUntil:Date.now()+8*86400000,planByDate:Date.now()+6*86400000,
          allowedTimeStartAnchor:'sunrise',allowedTimeStartOffsetMin:30,allowedTimeEnd:600,
          preferredTimeStartAnchor:'maghrib',preferredTimeStartOffsetMin:-30,preferredTimeEnd:1200},
        {hid:'audit-task',name:'Audit task',type:'task',durationMinutes:20,priority:4},
        {hid:'untouched',name:'Untouched',type:'keepup',target:7,durationMinutes:10,priority:1}
      ]));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    const before = await page.evaluate(()=>load());
    assert.equal(before[0].allowedTimeStartAnchor,'sunrise');
    assert.equal(before[0].preferredTimeStartAnchor,'maghrib');

    const editedIds = [];
    const set = async(id,op)=>{
      const select = page.locator(`[data-bulk-op="${id}"]`);
      await select.evaluate(el=>{const group=el.closest('details');if(group)group.open=true;});
      await select.selectOption(op);
      editedIds.push(id);
      return page.locator(`[data-bulk-op-row="${id}"]`);
    };
    const fill = async(id,op,value)=>{
      await set(id,op);
      await page.locator(`input[data-bulk-field="${id}"]`).fill(value);
    };
    const selectValue = async(id,op,value)=>{
      await set(id,op);
      await page.locator(`select[data-bulk-field="${id}"]`).selectOption(value);
    };
    const chooseItems = async(names)=>{
      await page.locator('#app-bar-filters').click();
      await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
      if(names.includes('Audit habit')){
        await page.locator('#bulk-filter-summary').click();
        await page.locator('#bulk-show-snoozed').click();
      }
      for(const name of names)await page.locator('#bulk-rows .bulk-row').filter({hasText:name}).locator('input').check();
      await page.locator('#bulk-edit-continue').click();
    };
    const window = async(id,op,start,end)=>{
      const row = await set(id,op);
      await row.locator('[data-bulk-window-part="start"]').fill(start);
      await row.locator('[data-bulk-window-part="end"]').fill(end);
    };
    const ordinal = async(id,week,day)=>{
      const row = await set(id,'replace');
      await row.locator('[data-bulk-ordinal-part="ordinal"]').selectOption(week);
      await row.locator('[data-bulk-ordinal-part="weekday"]').selectOption(day);
      await row.locator('[data-bulk-add-ordinal]').click();
    };

    await chooseItems(['Audit habit','Audit task']);
    await selectValue('priority','set','0');
    await fill('emoji','set','🌿');
    await selectValue('color','set','purple');
    const topics = await set('topics','add');
    await topics.locator('[data-bulk-new-topic]').fill('new topic');
    await topics.locator('[data-bulk-add-topic]').click();
    await topics.locator('[data-bulk-value="existing"]').click();
    assert.equal(await topics.locator('[data-bulk-value="new topic"]').getAttribute('aria-pressed'),'true');
    await set('pinned','on');
    await set('breakable','on');
    await fill('minChunk','set','25');
    await fill('duration','set','75');
    await fill('minGap','set','10');
    await fill('eventTime','set','02:30');
    await fill('dueDate','set','2026-11-01');
    assert.match(await page.locator('[data-bulk-applies="eventTime"]').innerText(),/Applies to 1 of 2/);
    await fill('earlyWindow','set','5');
    await fill('delayAllowance','set','3');
    const allowedDays = await set('allowedWeekdays','replace');
    await allowedDays.locator('[data-bulk-value="0"]').click();
    const preferredDays = await set('preferredWeekdays','replace');
    await preferredDays.locator('[data-bulk-value="2"]').click();
    await fill('allowedMonthDays','replace','1, 15');
    await fill('preferredMonthDays','replace','7, 21');
    await ordinal('allowedOrdinals','-1','0');
    await ordinal('preferredOrdinals','2','3');
    await window('allowedTime','fixed','00:00','07:00');
    await window('preferredTime','replace','01:00','03:00');
    const placePref = await set('placePref','set');
    await placePref.locator('[data-bulk-pref-part="locationId"]').selectOption('park');
    await placePref.locator('[data-bulk-pref-part="level"]').selectOption('little');
    const places = await set('places','replace');
    await places.locator('[data-bulk-value="park"]').click();
    const placeTypes = await set('locationTypes','replace');
    await placeTypes.locator('[data-bulk-value="env:indoor"]').click();
    assert.match(await page.locator('[data-bulk-applies="placePref"]').innerText(),/Applies to 2 of 2/);
    await selectValue('weatherProfile','replace','fair');
    await selectValue('weatherLocation','set','park');
    await set('showWeather','on');
    await set('showWeatherAtLocation','on');
    const rhythm = await set('rhythm','set');
    await rhythm.locator('[data-bulk-rhythm-part="times"]').fill('1');
    await rhythm.locator('[data-bulk-rhythm-part="days"]').fill('4');
    await set('repeatMode','opportunity');
    await fill('planBy','set','2026-11-20');
    await set('conditionTrigger','location');
    await fill('conditionRadius','set','350');
    await fill('autoMark','set','0');
    await fill('sessionTarget','set','35');
    await set('tapSession','on');
    await set('autoCompleteOnVisit','on');
    await set('trackValue','on');
    await set('snooze','clear');
    await set('sharedDisplay','off');
    await set('sharedCompletion','off');
    assert.deepEqual(editedIds.sort(),await page.evaluate(()=>BULK_FIELD_OPS.filter(bulkOpVisible).map(op=>op.id).sort()),'every exposed field exercised');

    await page.locator('#bulk-review-continue').click();
    assert.equal(await page.locator('#bulk-review-summary').innerText(),'2 selected · 2 will change');
    const review = await page.locator('#bulk-review-lines').innerText();
    assert.match(review,/Priority → P0: 2 items/);
    assert.match(review,/Place types → Indoor/);
    assert.match(review,/Allowed weekdays → Sun: 2 items/i);
    assert.match(review,/Allowed monthly weekdays → last Sun: 2 items/i);
    assert.equal(await page.locator('.bulk-problem-error').count(),0);
    const preview = await page.evaluate(()=>bulkReview.next);
    await page.locator('#bulk-apply').click();
    const saved = await page.evaluate(()=>load());
    assert.deepEqual(saved,preview,'Review matches what is saved');
    assert.deepEqual(saved[2],before[2],'unselected item untouched');
    const shared = {
      priority:0,emoji:'🌿',emojiBgColor:'purple',topics:['existing','new topic'],pinned:true,
      breakable:true,minChunkMinutes:25,durationMinutes:75,minGapMinutes:10,earlyWindowDays:5,
      allowedWeekdays:[0],preferredWeekdays:[2],allowedMonthDays:[1,15],preferredMonthDays:[7,21],
      allowedOrdinalWeekdays:[{ordinal:-1,weekday:0}],preferredOrdinalWeekdays:[{ordinal:2,weekday:3}],
      allowedTimeStart:0,allowedTimeEnd:420,allowedTimeFixedStart:true,allowedTimeStartAnchor:null,allowedTimeStartOffsetMin:0,
      preferredTimeStart:60,preferredTimeEnd:180,preferredTimeStartAnchor:null,preferredTimeStartOffsetMin:0,
      locationIds:['park'],locationPrefs:{park:'little'},preferredLocationId:'park',
      locationTypes:['env:indoor'],anywhereAllowed:false,
      weatherProfileMode:'profile',weatherProfileId:'fair',weatherLocationId:'park',showWeather:true,showWeatherAtLocation:true,
      autoMarkMinutes:0,timerAutoStopMinutes:35,tapStartsSession:true,trackValue:true,showOnSharedDisplay:false,allowSharedDisplayCompletion:false
    };
    for(const item of saved.slice(0,2)){
      for(const [field,value] of Object.entries(shared))assert.deepEqual(item[field],value,`${item.name} saves ${field}`);
    }
    assert.equal(saved[0].snoozedUntil,null);
    assert.equal(saved[0].planByDate,null);
    assert.equal(saved[0].repeatMode,'opportunity');
    assert.equal(saved[0].conditionTrigger,'location');
    assert.equal(saved[0].conditionRadiusM,350);
    assert.equal(saved[1].conditionRadiusM,before[1].conditionRadiusM,'a task keeps its own distance');
    assert.equal(saved[0].target,4);
    assert.equal(saved[1].delayAllowanceDays,3);
    assert.equal(saved[1].dueDate,Date.parse('2026-11-01T00:00:00-04:00'));
    assert.equal(saved[1].eventTime,Date.parse('2026-11-01T02:30:00-05:00'),'start time uses the local clock across DST');
    await page.locator('#action-undo').click();
    assert.deepEqual(await page.evaluate(()=>load()),before,'one undo restores coupled fields, including the old anchors and places');

    await chooseItems(['Audit habit','Audit task']);
    await set('autoCompleteOnVisit','on');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/Mark done on visit → on: 2 items/);
    await page.locator('#bulk-apply').click();
    assert.deepEqual(await page.evaluate(()=>load().map(h=>h.autoCompleteOnVisit)),[true,true,false],
      'visit completion enables only the selected items');
    await page.locator('#action-undo').click();
    assert.deepEqual(await page.evaluate(()=>load()),before,'undo restores the visit-completion settings');

    await chooseItems(['Audit habit']);
    await set('planBy','set');
    const planBy = page.locator('input[data-bulk-field="planBy"]');
    assert.equal(await planBy.inputValue(),await page.evaluate(()=>dateKey(load()[0].planByDate)));
    await set('planBy','clear');
    assert.equal(await planBy.count(),0,'clearing a plan-by date does not require a date field');
    await set('planBy','set');
    await planBy.fill('2026-11-20');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/Plan-by date/);
    await page.locator('#bulk-apply').click();
    assert.equal(await page.evaluate(()=>load()[0].planByDate),Date.parse('2026-11-20T00:00:00-05:00'),'plan-by date uses the local day');
    await page.locator('#action-undo').click();

    await chooseItems(['Audit habit']);
    const snooze = await set('snooze','until');
    await snooze.locator('[data-bulk-when-part="date"]').fill('2026-11-20');
    await snooze.locator('[data-bulk-when-part="time"]').fill('09:30');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/Snooze → hide until/);
    await page.locator('#bulk-apply').click();
    assert.equal(await page.evaluate(()=>load()[0].snoozedUntil),Date.parse('2026-11-20T09:30:00-05:00'),'snooze until uses the local clock');
    await page.locator('#action-undo').click();
    assert.equal((await page.evaluate(()=>load()))[0].snoozedUntil,before[0].snoozedUntil,'undo restores the previous snooze');

    await chooseItems(['Audit habit']);
    const regularRhythm = await set('rhythm','set');
    await regularRhythm.locator('[data-bulk-rhythm-part="times"]').fill('3');
    await regularRhythm.locator('[data-bulk-rhythm-part="days"]').fill('7');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/3× every 7 days/);
    await page.locator('#bulk-apply').click();
    assert.equal(await page.evaluate(()=>load()[0].target),7/3,'a regular habit stores days per completion');
    await page.locator('#action-undo').click();

    await chooseItems(['Audit habit']);
    const addPlaces = await set('places','add');
    await addPlaces.locator('[data-bulk-value="park"]').click();
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/Add place Park: 1 item/);
    await page.locator('#bulk-apply').click();
    assert.deepEqual(await page.evaluate(()=>load()[0].locationIds),['desk','park'],'adding a place keeps the existing one');
    await page.locator('#action-undo').click();

    await chooseItems(['Audit habit']);
    await set('repeatMode','opportunity');
    await set('conditionTrigger','weather');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-problems').innerText(),/add weather guidance before using weather/);
    assert.equal(await page.locator('#bulk-apply').isDisabled(),true,'a place cannot satisfy an explicit weather trigger');
    await page.locator('#bulk-edit-close').click();
    await page.locator('#bulk-edit-confirm-yes').click();
    assert.equal(await page.evaluate(()=>bulkWhen({date:'2027-03-14',time:'02:30'})),null,'a snooze cannot silently shift across the daylight saving gap');

    await chooseItems(['Audit task']);
    await set('dueDate','set');
    await selectValue('priority','set','0');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-problems').innerText(),/Due date: pick a date/);
    assert.equal(await page.locator('#bulk-apply').isDisabled(),true,'a missing value blocks the batch even when it would be a no-op');
    assert.deepEqual(await page.evaluate(()=>load()),before,'invalid review writes nothing');
    assert.deepEqual(errors,[]);
    console.log('PASS all Bulk Edit fields, normalized save, dependencies, validation and undo');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
