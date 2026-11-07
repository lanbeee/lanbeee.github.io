// Real summary buttons -> unsaved detail editor. Stage structured proposals
// directly: navigation must work independently of any model or download.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,localAssistantProvider:'needle',showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(h=>save([h,{...h,hid:'task',name:'Visit',type:'task',target:null,dueDate:new Date('2026-12-01T12:00:00').getTime()},
      {...h,hid:'event',name:'Class',appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:600,weekdays:[1],until:'',exceptions:{}}}]),
    baseHabit({hid:'walk',name:'Walk',durationMinutes:20}));
    const before=await page.evaluate(()=>load());
    const open=async(hid,changes=[],extra={})=>{
      await page.evaluate(({hid,changes,extra})=>{
        closeAssistantSheet();
        if(detailIdx!==null)restoreDetailTune();
        assistantOpenForItem(hid,'home',extra);
        if(hid==='event')assistantFocusSetScope(_assistantSession.focus,extra.occurrenceDate ? 'occurrence' : 'series',extra.occurrenceDate);
        for(const [field,value] of changes)assistantFocusStage(_assistantSession.focus,{field,value,origin:'correction'});
        assistantShowFocusReview(_assistantSession.focus);
      },{hid,changes,extra});
    };
    const jump=async(field,selector)=>{
      await page.locator(`[data-focus-field="${field}"]`).click();
      await page.waitForFunction(selector=>document.querySelector(selector)?.classList.contains('detail-search-hit'),selector);
      assert.ok(await page.locator(selector).isVisible(),`${field} lands on a visible detail control`);
      // Numeric inputs clear while focused and restore untouched values on blur.
      await page.locator(selector).blur();
      assert.equal(await page.locator('#assistant-sheet').evaluate(el=>el.classList.contains('open')),false,'chat closes');
      assert.deepEqual(await page.evaluate(()=>load()),before,'navigation never saves');
    };
    for(const [width,minimal] of [[390,false],[1440,false],[390,true]]){
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(width=>paneTierActive()===(width>1000),width);
      await page.evaluate(minimal=>{closeAssistantSheet();setMinimalMode(minimal);},minimal);
      await open('walk');
      await jump('durationMinutes','#detail-duration');
      assert.equal(await page.locator('#detail-duration').inputValue(),'20','opening summary links works before any request');

      await open('walk',[['durationMinutes',35],['preferredWeekdays',[2,4]],['breakable',true]]);
      await jump('preferredWeekdays','#detail-preferred-weekday-chips');
      assert.equal(await page.evaluate(()=>detailScheduleView),'preferred','preferred chip opens preferred schedule');
      assert.equal(await page.locator('#detail-duration').inputValue(),'35','other staged changes travel with the tapped field');
      assert.equal(await page.locator('#detail-breakable').getAttribute('aria-pressed'),'true');
      assert.equal(await page.evaluate(()=>isMinimalMode()),minimal,'navigation preserves the mode preference');

      await open('walk',[['breakable',true],['minChunkMinutes',15]]);
      await jump('minChunkMinutes','#detail-min-chunk');
      assert.equal(await page.locator('#detail-min-chunk').inputValue(),'15','advanced fields reveal their planning section');
      await page.evaluate(()=>restoreDetailTune());
      if(minimal){
        assert.equal(await page.locator('#detail-breakable').isVisible(),false,'temporary advanced section resets on cancel');
        assert.equal(await page.locator('[data-detail-nav="effort"]').getAttribute('hidden'),'');
      }

      await open('walk');
      await jump('rhythm','#detail-frequency-presets');
      await open('walk',[['name','Evening walk']]);
      // Keyboard activation uses the same button path as a tap.
      await page.locator('[data-focus-field="name"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>$('detail-habit-message').classList.contains('detail-search-hit'));
      assert.equal(await page.locator('#detail-habit-message').inputValue(),'Evening walk');
      assert.deepEqual(await page.evaluate(()=>load()),before);
    }
    await page.evaluate(()=>{restoreDetailTune();setMinimalMode(false);});
    await open('task',[['dueTime',540]]);
    await jump('dueTime','#detail-due-time');
    await open('event',[['durationMinutes',50]]);
    await jump('durationMinutes','#detail-appt-duration');
    assert.equal(await page.locator('#detail-appt-duration').inputValue(),'50','events use their own duration editor');
    await open('event',[['appointmentStartMinute',660]]);
    await jump('appointmentStartMinute','#detail-appt-time');
    assert.equal(await page.locator('#detail-appt-time').inputValue(),'11:00');
    await open('event',[['exceptionDuration',25]],{occurrenceDate:'2026-11-09'});
    await jump('exceptionDuration','#detail-appt-duration');
    assert.equal(await page.locator('#detail-appt-scope').inputValue(),'date','occurrence edits retain this-date scope');
    assert.equal(await page.locator('#detail-appt-occurrence').inputValue(),'2026-11-09');
    assert.equal(await page.locator('#detail-appt-duration').inputValue(),'25');

    await open('walk',[['durationMinutes',35]]);
    await page.evaluate(()=>{_assistantSession.focus._focusInFlight=true;assistantShowFocusReview(_assistantSession.focus);});
    assert.equal(await page.locator('[data-focus-field="durationMinutes"]').isDisabled(),true,'partial reads cannot open a competing edit');
    await page.evaluate(()=>{_assistantSession.focus._focusInFlight=false;assistantShowFocusReview(_assistantSession.focus);});
    await page.locator('[data-focus-save]').click();
    await page.waitForFunction(()=>load()[0].durationMinutes===35);
    assert.equal(await page.locator('[data-focus-field="durationMinutes"]').isEnabled(),true,'saved summaries remain navigable');
    await page.locator('[data-focus-field="durationMinutes"]').click();
    await page.waitForFunction(()=>$('detail-duration').classList.contains('detail-search-hit'));
    await page.locator('#detail-duration').blur();
    assert.equal(await page.locator('#detail-duration').inputValue(),'35');
    assert.deepEqual(errors,[]);
    console.log('PASS interactive summaries: mobile/desktop/minimal, keyboard, staged edits, events, occurrence scope and read/save states');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
