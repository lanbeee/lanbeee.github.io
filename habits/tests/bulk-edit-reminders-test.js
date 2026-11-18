// Bulk edit of device-local phone reminders, plus the same-batch due date
// that makes a deadline reminder apply. The PWA hides every native-only row.
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');

(async()=>{
  const browser = await (process.env.TEST_BROWSER === 'webkit' ? webkit : chromium).launch();
  try{
    const context = await browser.newContext({viewport:{width:1200,height:850},timezoneId:'America/New_York',serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-11-02T09:00:00-05:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        agendaOptimizer:false,
        locations:[{id:'desk',name:'Desk',lat:40,lng:-73}]
      }));
      const base = {emoji:'•',durationMinutes:30,priority:2,locationIds:[],anywhereAllowed:true,logs:[],active:true};
      localStorage.setItem('tings_v2',JSON.stringify([
        {...base,hid:'walk',name:'Walk',type:'keepup',target:7,locationIds:['desk']},
        {...base,hid:'pay',name:'Pay bill',type:'task',target:null,dueDate:Date.parse('2026-11-12T00:00:00-05:00')},
        {...base,hid:'meet',name:'Standup',type:'keepup',target:7,appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'',exceptions:{}}},
        {...base,hid:'errand',name:'Errand',type:'keepup',target:7,repeatMode:'opportunity',conditionTrigger:'location',locationIds:['desk']},
        {...base,hid:'quit',name:'Quit',type:'zero',target:null},
        {...base,hid:'someday',name:'Someday',type:'task',target:null},
        {...base,hid:'keep',name:'Keep',type:'keepup',target:7}
      ]));
      localStorage.setItem('tings_native_reminders_v1',JSON.stringify({
        version:4,enabled:false,
        items:{'item:walk':{start:'notification',dates:{'2026-11-03':{start:'alarm',end:'notification'}}}}
      }));
      window.TingsNative = {
        isNative:true,platform:'android',
        notifications:{
          permissions:async()=>({display:'granted'}),
          requestPermissions:async()=>({display:'granted'}),
          exactAlarmPermission:async()=>({exact_alarm:'granted'}),
          requestExactAlarmPermission:async()=>({exact_alarm:'granted'}),
          pending:async()=>({notifications:[]}),
          replaceAgenda:async()=>{}
        },
        alarms:{replaceAgenda:async()=>{},status:async()=>({pending:0,fullScreen:true}),completions:async()=>({actions:[]}),acknowledge:async()=>{}},
        quiet:{status:async()=>({granted:true}),reconcile:async()=>{},openSettings:async()=>{}},
        background:{status:async()=>({enabled:false,notificationChannelEnabled:true}),snapshot:async()=>{},publish:async()=>{}}
      };
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(()=>{
      window.reconcileNativeReminders = async()=>{};
      window.reconcileNativeQuiet = ()=>{};
      window.queueNativeBackgroundSnapshot = ()=>{};
    });
    const recordsBefore = await page.evaluate(()=>JSON.stringify(load()));
    const remindersBefore = await page.evaluate(()=>nativeReminderPreferences());

    await page.evaluate(()=>{TingsNative.isNative = false;});
    const openBulk = async names=>{
      await page.locator('#app-bar-filters').click();
      await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
      for(const name of names)await page.locator('#bulk-rows .bulk-row').filter({hasText:name}).locator('input').check();
      await page.locator('#bulk-edit-continue').click();
    };
    await openBulk(['Walk']);
    assert.equal(await page.locator('[data-bulk-op="reminderStart"]').count(),0,'the PWA hides phone reminders');
    assert.equal(await page.locator('[data-bulk-op="reminderDnd"]').count(),0,'the PWA hides Do Not Disturb');
    assert.equal(await page.locator('[data-bulk-op="planBy"]').count(),1,'plan-by stays available in the PWA');
    assert.equal(await page.locator('[data-bulk-op="conditionTrigger"]').count(),1);
    assert.equal(await page.locator('[data-bulk-op="snooze"]').count(),1);
    await page.locator('#bulk-edit-close').click();
    await page.locator('#bulk-edit-confirm-yes').click();
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    await page.evaluate(()=>{TingsNative.isNative = true;});

    const edited = [];
    const set = async(id,op)=>{
      const select = page.locator(`[data-bulk-op="${id}"]`);
      await select.evaluate(el=>{const group = el.closest('details');if(group)group.open = true;});
      await select.selectOption(op);
      edited.push(id);
      return page.locator(`[data-bulk-op-row="${id}"]`);
    };
    await openBulk(['Walk','Pay bill','Standup','Errand','Quit','Someday']);
    await page.locator('#bulk-settings-search').fill('alarm');
    assert.equal(await page.locator('[data-bulk-op="reminderStart"]').count(),1,'alarm search finds reminder rows');
    assert.equal(await page.locator('[data-bulk-op="duration"]').count(),0,'alarm search hides unrelated rows');
    await page.locator('#bulk-settings-search').fill('');

    await set('reminderAll','notification');
    await set('reminderStart','alarm');
    await set('reminderEnd','alarm');
    await set('reminderDue','alarm');
    await (async()=>{
      const row = await set('reminderDueWhen','set');
      await row.locator('[data-bulk-due-part="days"]').selectOption('1');
      await row.locator('[data-bulk-due-part="time"]').fill('');
      await page.locator('#bulk-settings-search').fill('due-date reminder time');
      assert.equal(await row.locator('[data-bulk-due-part="time"]').inputValue(),'','re-rendering an empty time preserves the empty value');
      await row.locator('[data-bulk-due-part="time"]').fill('08:30');
      await page.locator('#bulk-settings-search').fill('');
    })();
    await set('reminderSecond','alarm');
    const lead = async(id,minutes)=>{
      const row = await set(id,'set');
      await row.locator('select[data-bulk-kind="choice"]').selectOption(String(minutes));
    };
    await lead('reminderStartLead',60);
    await lead('reminderSecondLead',30);
    await set('reminderTravelStart','notification');
    await set('reminderTravelEnd','off');
    await lead('reminderTravelLead',15);
    await set('reminderMissed','alarm');
    await lead('reminderMissedLead',5);
    await set('reminderDnd','on');
    assert.deepEqual(edited.sort(),await page.evaluate(()=>BULK_FIELD_OPS.filter(op=>op.nativeOnly).map(op=>op.id).sort()),'every phone-reminder field exercised');

    const missed = await page.locator('[data-bulk-applies="reminderMissed"]').innerText();
    assert.match(missed,/Applies to 3 of 6/);
    assert.match(missed,/planned only if conditions fit: 1/);
    assert.match(missed,/stop items have no phone reminders: 1/);
    const due = await page.locator('[data-bulk-applies="reminderDue"]').innerText();
    assert.match(due,/Applies to 1 of 6/);
    assert.match(due,/needs a due date: 1/);

    await page.locator('#bulk-review-continue').click();
    const review = await page.locator('#bulk-review-lines').innerText();
    assert.match(review,/Every reminder → all notifications: 5 items/);
    assert.match(review,/When it starts → alarm: 5 items/);
    assert.match(review,/On the due date → alarm: 1 item/);
    assert.match(review,/1 needs a due date/);
    assert.match(review,/If it may not fit → alarm: 3 items/);
    assert.match(review,/Silence the phone → on: 4 items/);
    assert.match(await page.locator('#bulk-review-items').textContent(),/replaces overrides on 1 date/);
    assert.equal(await page.locator('.bulk-problem-error').count(),0);
    assert.equal(await page.locator('#bulk-review-summary').innerText(),'6 selected · 5 will change');
    await page.locator('#bulk-apply').click();
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>JSON.stringify(load())),recordsBefore,'reminder edits do not rewrite habit records');

    const saved = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(saved.enabled,true,'turning a reminder on enables phone reminders');
    assert.deepEqual(saved.items['item:walk'],{
      start:'alarm',end:'alarm',travelStart:'notification',travelEnd:'off',travelLeadMinutes:15,
      missed:'alarm',missedLeadMinutes:5,dnd:true
    },'a one-date exception is replaced by the bulk choice');
    assert.deepEqual(saved.items['item:meet'],{
      start:'alarm',startSecond:'alarm',end:'alarm',startLeadMinutes:60,secondStartLeadMinutes:30
    },'an event keeps start and end reminders only');
    assert.equal(saved.items['item:pay'].due,'alarm');
    assert.equal(saved.items['item:pay'].dueDaysBefore,1);
    assert.equal(saved.items['item:pay'].dueMinute,510);
    assert.equal(saved.items['item:pay'].missedLeadMinutes,5);
    assert.equal(saved.items['item:pay'].dnd,true);
    assert.equal(saved.items['item:errand'].missed,undefined,'an opportunity habit has no drop warning');
    assert.equal(saved.items['item:errand'].dnd,true);
    assert.equal(saved.items['item:errand'].start,'alarm');
    assert.equal(saved.items['item:someday'].due,undefined,'a task without a due date skips the deadline reminder');
    assert.equal(saved.items['item:someday'].start,'alarm');
    assert.equal(saved.items['item:quit'],undefined,'a stop item stores no phone reminder');
    assert.equal(saved.items['item:keep'],undefined,'an unselected item is left alone');

    await page.locator('#action-undo').click();
    const restored = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(restored.enabled,false);
    assert.deepEqual(restored.items['item:walk'],remindersBefore.items['item:walk'],'undo restores the one-date exception');
    for(const hid of ['pay','meet','errand','someday','quit','keep'])assert.equal(restored.items[`item:${hid}`],undefined,`${hid} reminder removed`);

    await openBulk(['Someday']);
    await page.locator('[data-bulk-op="dueDate"]').evaluate(el=>{const group = el.closest('details');if(group)group.open = true;});
    await page.locator('[data-bulk-op="dueDate"]').selectOption('set');
    await page.locator('input[data-bulk-field="dueDate"]').fill('2026-11-12');
    await page.locator('[data-bulk-op="reminderDue"]').evaluate(el=>{const group = el.closest('details');if(group)group.open = true;});
    await page.locator('[data-bulk-op="reminderDue"]').selectOption('alarm');
    assert.match(await page.locator('[data-bulk-applies="reminderDue"]').innerText(),/Applies to 1 of 1/);
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/On the due date → alarm: 1 item/);
    await page.locator('#bulk-apply').click();
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid === 'someday').dueDate),Date.parse('2026-11-12T00:00:00-05:00'));
    const withDue = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(withDue.items['item:someday'].due,'alarm','a due date chosen in the same batch unlocks the deadline reminder');
    assert.equal(withDue.enabled,true);
    await page.locator('#action-undo').click();
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid === 'someday').dueDate),null);
    const undoneDue = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(undoneDue.items['item:someday'],undefined);
    assert.equal(undoneDue.enabled,false,'undo turns phone reminders back off when this batch turned them on');

    await page.evaluate(()=>{
      TingsNative.notifications.permissions = async()=>({display:'denied'});
      TingsNative.notifications.requestPermissions = async()=>({display:'denied'});
    });
    await openBulk(['Walk']);
    await page.locator('[data-bulk-op="priority"]').selectOption('set');
    await page.locator('[data-bulk-field="priority"]').selectOption('0');
    await page.locator('[data-bulk-op="reminderStart"]').evaluate(el=>{const group = el.closest('details');if(group)group.open = true;});
    await page.locator('[data-bulk-op="reminderStart"]').selectOption('alarm');
    await page.locator('#bulk-review-continue').click();
    await page.locator('#bulk-apply').click();
    await page.locator('#toast.show').waitFor();
    assert.match(await page.locator('#toast-text').innerText(),/Nothing was saved/);
    assert.equal(await page.locator('#bulk-edit-sheet.open').count(),1,'a denied permission leaves the review open');
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid === 'walk').priority),JSON.parse(recordsBefore).find(h=>h.hid === 'walk').priority,'the paired priority edit is not saved');
    const denied = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(denied.enabled,false);
    assert.deepEqual(denied.items['item:walk'],remindersBefore.items['item:walk']);

    // Permission screens can return after other records and reminder owners
    // changed. Apply must merge into the latest state for both stores.
    await page.evaluate(()=>{
      TingsNative.notifications.permissions = ()=>new Promise(resolve=>{window.finishBulkPermission = resolve;});
    });
    await page.locator('#bulk-apply').click();
    await page.waitForFunction(()=>typeof window.finishBulkPermission === 'function');
    await page.evaluate(()=>{
      const data = load();
      data.find(h=>h.hid === 'keep').priority = 4;
      save(data);
      nativeSaveReminderPatch(nativeReminderPreferences(),'item:keep',{start:'notification'});
      window.finishBulkPermission({display:'granted'});
    });
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid === 'keep').priority),4,'apply preserves a record edited during the permission prompt');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:keep'].start),'notification','apply preserves a separate reminder added during the prompt');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:walk'].start),'alarm');

    await page.evaluate(()=>{
      nativeSaveReminderPatch(nativeReminderPreferences(),'item:walk',{travelStart:'notification'});
      nativeSaveReminderPatch(nativeReminderPreferences(),'item:walk',{end:'alarm'},'2026-11-03');
    });
    await page.locator('#action-undo').click();
    const merged = await page.evaluate(()=>nativeReminderPreferences());
    assert.equal(merged.enabled,true,'undo keeps reminders enabled after a newer reminder edit');
    assert.deepEqual(merged.items['item:walk'],{
      start:'notification',travelStart:'notification',dates:{'2026-11-03':{start:'alarm',end:'alarm'}}
    },'undo merges reminder fields and date overrides individually');
    assert.equal(merged.items['item:keep'].start,'notification');

    await page.evaluate(()=>{
      const prefs = nativeReminderPreferences();
      prefs.enabled = false;
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
      TingsNative.notifications.permissions = async()=>({display:'granted'});
    });
    await openBulk(['Keep']);
    await set('reminderStart','notification');
    await page.locator('#bulk-review-continue').click();
    assert.match(await page.locator('#bulk-review-lines').innerText(),/Enable phone reminders/);
    await page.locator('#bulk-apply').click();
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().enabled),true,'choosing the existing mode can turn reminders back on');
    await page.locator('#action-undo').click();
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().enabled),false);

    await page.evaluate(()=>{
      const prefs = nativeReminderPreferences();
      prefs.items['item:keep'].end = 'alarm';
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
      TingsNative.notifications.permissions = async()=>({display:'denied'});
    });
    await openBulk(['Keep']);
    await set('reminderStart','off');
    await page.locator('#bulk-review-continue').click();
    await page.locator('#bulk-apply').click();
    await page.locator('#bulk-edit-sheet.open').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:keep'].start),'off','turning off one edge skips permission checks for a different alarm');
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:keep'].end),'alarm');

    const rollback = await page.evaluate(()=>{
      const original = localStorage.getItem(NATIVE_REMINDERS_KEY);
      const originalSave = window.save;
      const next = nativeReminderPreferences();
      next.enabled = true;
      window.save = ()=>false;
      try{
        return !bulkSaveWithReminders(load(),next) && localStorage.getItem(NATIVE_REMINDERS_KEY) === original;
      }finally{window.save = originalSave;}
    });
    assert.equal(rollback,true,'failed item persistence restores the original reminder settings');
    assert.deepEqual(errors,[],'no page errors');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exit(1);});
