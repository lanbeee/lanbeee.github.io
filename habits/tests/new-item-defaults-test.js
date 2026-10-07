// Creation profiles: migration, persistence, explicit overrides and draft navigation.
const { chromium } = require('playwright');
const url = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
let pass = 0, fail = 0;
function check(ok,label){
  if(ok){pass++;console.log('  ok: ' + label);}
  else{fail++;console.error('  not ok: ' + label);}
}
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-10-07T12:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','1');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,topics:['Health','Work'],locations:[{id:'home',name:'Home',lat:40,lng:-74}],blockedTimes:[]}));
    });
    await page.goto(url,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof applyAddDefaults === 'function');
    const migration = await page.evaluate(()=>{
      Storage.write(SORT_SETTINGS_KEY,{defaultTarget:7/3,defaultDurationMinutes:45,defaultPriority:1,defaultAutoMarkMinutes:12,defaultBreakable:true,defaultTopics:['Health']});
      const old = loadSortSettings();
      saveSortSettings(old);
      const first = loadSortSettings();
      saveSortSettings({...first,defaultDurationMinutes:90,defaultTopics:['Work']});
      const second = loadSortSettings();
      return {habit:newItemDefaults(second,'keepup'),task:newItemDefaults(second,'task'),first};
    });
    check(migration.first.defaultAutoMarkMode === 'minutes' && migration.task.autoMarkMinutes === 12,'legacy automatic completion migrates with its minute value');
    check(migration.habit.durationMinutes === 90 && migration.task.durationMinutes === 45 && migration.task.topics[0] === 'Health','legacy shared choices seed independent profiles');
    check(Math.abs(migration.habit.target - 7/3) < 1e-9,'fractional rhythms survive profile normalization');
    await page.evaluate(()=>{
      saveSortSettings({...loadSortSettings(),defaultType:'keepup',defaultBreakable:false,defaultDurationMinutes:30,defaultAutoMarkMode:'manual',defaultAutoMarkMinutes:null,defaultTarget:7,defaultTopics:['Health'],
        topics:['Health','Work'],locations:[{id:'home',name:'Home',lat:40,lng:-74}],
        taskDefaults:{priority:1,durationMinutes:45,dueDateMode:'today',autoMarkMode:'duration',topics:['Work'],allowedWeekdays:[3],allowedTimeStart:480,allowedTimeEnd:1200,locationIds:['home'],anywhereAllowed:false}});
      syncSettingsControls();
    });
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill('Keep my draft');
    await page.locator('#type-seg [data-v="task"]').click();
    check(await page.locator('#add-title').textContent() === 'new task' && await page.locator('#ting-due-date').inputValue() === '2026-10-07','task branch starts due today with its own heading');
    await page.locator('#add-more-toggle').click();
    check(await page.locator('#ting-duration').inputValue() === '45' && await page.locator('#ting-completion-mode').inputValue() === 'duration','task effort uses task profile');
    await page.locator('#ting-due-date').fill('2026-10-09');
    await page.locator('#ting-duration').fill('60');
    await page.locator('#type-seg [data-v="keepup"]').click();
    check(await page.locator('#ting-duration').inputValue() === '30' && await page.locator('#ting-completion-mode').inputValue() === 'manual','habit branch retains independent effort');
    await page.locator('#ting-times').fill('3');
    await page.locator('#type-seg [data-v="task"]').click();
    check(await page.locator('#ting-due-date').inputValue() === '2026-10-09' && await page.locator('#ting-duration').inputValue() === '60','switching branches restores task edits');
    await page.locator('#add-open-defaults').click();
    check(await page.locator('#settings-defaults-body').isVisible() && await page.locator('#default-due-row').isVisible() && !(await page.locator('#default-rhythm-row').isVisible()),'defaults shortcut opens matching task controls');
    await page.locator('#setting-default-due').selectOption('tomorrow');
    await page.locator('#setting-default-duration').fill('90');
    await page.locator('#setting-default-duration').blur();
    await page.locator('#default-priority-seg [data-default-priority="3"]').click();
    await page.locator('#settings-close').click();
    check(await page.locator('#ting-message').inputValue() === 'Keep my draft' && await page.locator('#ting-due-date').inputValue() === '2026-10-09' && await page.locator('#ting-duration').inputValue() === '60','defaults round trip preserves explicit draft edits');
    check(await page.locator('#ting-priority-seg [data-priority="3"]').getAttribute('class').then(c=>c.includes('on')),'untouched draft fields receive changed defaults');
    await page.locator('#add-open-busy').click();
    check(await page.locator('#settings-blocked-body').isVisible(),'busy-time shortcut opens busy-time editor');
    await page.locator('#blocked-time-add').click();
    await page.locator('[data-blocked-label="0"]').fill('Lunch');
    await page.locator('[data-blocked-label="0"]').dispatchEvent('change');
    await page.locator('#settings-close').click();
    check(await page.locator('#ting-message').inputValue() === 'Keep my draft' && await page.locator('#ting-duration').inputValue() === '60','adding busy time returns to preserved item draft');
    await page.locator('#add-open-defaults').click();
    await page.keyboard.press('Escape');
    check(await page.locator('#add-sheet').getAttribute('class').then(c=>c.includes('open')) && await page.locator('#ting-message').inputValue() === 'Keep my draft','Escape returns from defaults to the preserved draft');
    await page.locator('#do-save').click();
    const saved = await page.evaluate(()=>({item:load().find(h=>h.name === 'Keep my draft'),settings:loadSortSettings()}));
    check(saved.item.type === 'task' && saved.item.durationMinutes === 60 && saved.item.autoMarkMinutes === 60,'after-duration completion uses the actual creation duration');
    check(saved.item.priority === 3 && saved.item.topics.length === 1 && saved.item.topics[0] === 'Work','task topic and priority settings do not leak habit defaults');
    check(saved.item.allowedTimeStart === 480 && saved.item.allowedTimeEnd === 1200 && saved.item.allowedWeekdays.join() === '3' && saved.item.locationIds.join() === 'home' && !saved.item.anywhereAllowed,'creation persists allowed days, time and place');
    check(saved.settings.blockedTimes.some(b=>b.label === 'Lunch'),'busy time is saved independently of the task');
    await page.evaluate(()=>{closeSheet('detail-sheet');applyAddDefaults();openSheet('add-sheet');switchAddType('task');});
    check(await page.locator('#ting-due-date').inputValue() === '2026-10-08','tomorrow default resolves on each new creation');
    await page.locator('#add-more-toggle').click();
    await page.locator('#ting-message').fill('Manual override');
    await page.locator('#ting-due-date').fill('');
    await page.locator('#ting-completion-mode').selectOption('manual');
    await page.locator('#ting-tag-chips [data-topic="Work"]').click();
    await page.locator('#do-save').click();
    const manual = await page.evaluate(()=>load().find(h=>h.name === 'Manual override'));
    check(manual.autoMarkMinutes === null && manual.dueDate === null && manual.earlyWindowDays === 0,'manual completion and cleared date override automatic defaults');
    check(manual.topics.length === 0,'removing a default topic remains removed when saved');
    const dataBefore = await page.evaluate(()=>JSON.stringify(load()));
    await page.evaluate(()=>{
      closeSheet('detail-sheet');
      defaultProfileKind = 'habit';
      updateDefaultProfile({target:7/3,durationMinutes:75,breakable:true,minChunkMinutes:20,autoMarkMode:'minutes',autoMarkMinutes:0,allowedWeekdays:[1,2],allowedTimeStart:600,allowedTimeEnd:960,topics:['Health']});
      applyAddDefaults();openSheet('add-sheet');
    });
    check(await page.locator('#ting-times').inputValue() === '3' && await page.locator('#ting-days').inputValue() === '7','habit defaults support times per period');
    await page.locator('#ting-message').fill('Habit defaults');
    await page.locator('#do-save').click();
    const habit = await page.evaluate(()=>load().find(h=>h.name === 'Habit defaults'));
    check(habit.target === 7/3 && habit.breakable && habit.minChunkMinutes === 20 && habit.autoMarkMinutes === 0 && habit.durationMinutes === 75,'habit profile applies rhythm, splitting and zero-minute completion');
    const untouched = await page.evaluate(()=>JSON.stringify(load().filter(h=>h.name !== 'Habit defaults')));
    check(untouched === dataBefore,'changing defaults does not edit existing saved items');
    await page.evaluate(()=>{
      closeSheet('detail-sheet');
      defaultProfileKind = 'task';updateDefaultProfile({dueDateMode:'none'});
      applyAddDefaults();switchAddType('task');
    });
    check(await page.locator('#ting-due-date').inputValue() === '','no-date default remains available');
    const persistence = await page.evaluate(()=>{
      const settings = loadSortSettings();
      return {habit:newItemDefaults(settings,'keepup'),task:newItemDefaults(settings,'task')};
    });
    check(persistence.task.dueDateMode === 'none' && persistence.task.durationMinutes === 90 && persistence.habit.durationMinutes === 75,'both profiles persist independently');
    await page.evaluate(()=>syncDefaultProfileControls());
    await page.evaluate(()=>$('default-time-clear').click());
    check(await page.locator('#setting-default-time-start').inputValue() === '' && await page.locator('#setting-default-time-end').inputValue() === '', 'cleared allowed-time inputs stay blank rather than displaying midnight');
    check(errors.length === 0,'no page errors: ' + errors.join('; '));
    console.log(`\n${pass} passed, ${fail} failed`);
    if(fail)process.exitCode = 1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode = 1;});
