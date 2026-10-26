const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_essentials_v2','done');localStorage.setItem('tings_coach_install_v2','done');
      const RealDate=Date,now=new RealDate(2026,9,26,8).getTime();
      globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.evaluate(()=>{
      sortSettings={...loadSortSettings(),locations:[],blockedTimes:[],availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],showStatusOnCards:true};
      save(normalize([
        {hid:'class',name:'Biology',type:'keepup',durationMinutes:60,appointment:{repeat:'weekly',startDate:'2026-10-26',weekdays:[1,3],startMinute:540,exceptions:{}},links:[{kind:'link',value:'https://meet.google.com/abc-defg-hij'}]},
        {hid:'meeting',source:'device',externalId:'device:1:2',name:'Phone meeting',type:'task',eventTime:Date.now()+2*3600000,durationMinutes:60,breakable:false,autoMarkMinutes:60},
        {hid:'task',name:'Timed task',type:'task',eventTime:Date.now()+3*3600000,durationMinutes:30},
        {hid:'all-day',name:'All-day task',source:'device',externalId:'device:1:3',type:'task',dueDate:dayStart(Date.now())}
      ]));render();
    });
    await page.waitForSelector('.swipe-row[data-hid="class"]');
    for(const hid of ['class','meeting']){
      const row=page.locator(`.swipe-row[data-hid="${hid}"]`).first();
      assert.equal(await row.locator('[data-action="activity"],[data-action="plan"],[data-action="snooze"],[data-action="timer"],[data-pulse]').count(),0,'events have no habit or completion actions');
      assert.equal(await row.getByText('Fixed time',{exact:true}).count(),0,'no duplicate fixed-time pill');
      assert.equal(await row.getByText('new',{exact:true}).count(),0,'events have no progress status');
    }
    assert.equal(await page.locator('.swipe-row[data-hid="class"] [data-action="open-link"]').count()>0,true,'meeting link stays available');
    assert.equal(await page.locator('.swipe-row[data-hid="task"] [data-pulse]').count()>0,true,'ordinary timed tasks keep completion');
    assert.equal(await page.locator('.swipe-row[data-hid="all-day"] [data-pulse]').count()>0,true,'all-day calendar tasks keep completion');
    await page.locator('.swipe-row[data-hid="class"] .pulse-btn').first().click();
    await page.waitForFunction(()=>detailIdx===0 && $('detail-sheet').classList.contains('open'));
    await page.locator('#detail-mark').click();
    assert.equal(await page.locator('#detail-mark-menu').isVisible(),false,'event icon opens its editor directly');
    assert.equal(await page.locator('#detail-mark').getAttribute('aria-label'),'edit icon for Biology');
    await page.getByLabel('event emoji, optional',{exact:true}).fill('📚');await page.locator('#detail-save').click();
    assert.equal(await page.evaluate(()=>load()[0].emoji),'📚');
    assert.ok(await page.locator('#detail-sheet.open').count(),'saving an event keeps detail open');
    await page.evaluate(()=>closeDetail());
    await page.waitForFunction(()=>!appBackHistoryCleaning);
    await page.evaluate(()=>{applyAddDefaults();openSheet('add-sheet');});
    await page.fill('#ting-duration','25');
    await page.locator('#type-seg [data-v="task"]').click();await page.fill('#ting-duration','35');
    await page.locator('#type-seg [data-v="event"]').click();await page.fill('#ting-duration','45');await page.selectOption('#add-appt-repeat','weekly');await page.fill('#add-appt-time','14:30');
    await page.locator('#type-seg [data-v="task"]').click();assert.equal(await page.inputValue('#ting-duration'),'35');
    await page.locator('#type-seg [data-v="keepup"]').click();assert.equal(await page.inputValue('#ting-duration'),'25');
    await page.locator('#type-seg [data-v="event"]').click();assert.equal(await page.inputValue('#ting-duration'),'45');
    assert.equal(await page.inputValue('#add-appt-time'),'14:30');assert.equal(await page.inputValue('#add-appt-repeat'),'weekly');
    await page.locator('#type-seg [data-v="event"]').click();assert.equal(await page.inputValue('#ting-duration'),'45','reselecting event preserves the draft');
    assert.equal(await page.locator('#type-seg [aria-pressed="true"]').count(),1);
    await page.locator('[data-settings-help-target="add-event-help"]').click();
    assert.equal(await page.locator('#add-event-help').isVisible(),true,'event explanations open on demand');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-event-help').isVisible(),false);
    await page.waitForTimeout(500);await page.screenshot({path:'test-results/event-creation.png'});
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>{closeSheet('add-sheet');openDetail(1);});
    assert.equal(await page.locator('#detail-habit-message').isEnabled(),false,'phone title stays provider-owned');
    assert.equal(await page.locator('#detail-appearance-disclosure').isVisible(),true,'phone icon editor works in desktop pane');
    await page.evaluate(()=>openDetail(2));
    assert.equal(await page.locator('#detail-habit-message').isEnabled(),true,'ordinary task editing is restored');
    assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').querySelector('[data-detail-nav="schedule"]').hidden),false);
    assert.deepEqual(errors,[]);console.log('PASS event UX: clear creation choices, preserved drafts, useful actions, icon taps, ordinary tasks, desktop restoration');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
