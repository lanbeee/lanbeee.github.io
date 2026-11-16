// Bulk edit: hid-based picker, selection persistence across filters,
// explicit operations (nothing changes until chosen), mixed-value context,
// applicability, review counts, staleness re-inspection, and guarded
// field-level undo that preserves later activity.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-11-01T12:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,defaultType:'keepup',defaultTarget:7}));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.waitForTimeout(600);
    await page.evaluate(()=>{
      const now = Date.now();
      const base = {type:'keepup',repeatMode:'routine',lastLog:null,logs:[],emoji:'',emojiBgColor:'teal',pinned:false,showOnSharedDisplay:true,allowSharedDisplayCompletion:true,priority:2,topics:[],locationIds:[],anywhereAllowed:true,locationPrefs:{},weatherProfileMode:'inherit',weatherProfileId:null,weatherLocationId:null,showWeather:false,showWeatherAtLocation:false,allowedWeekdays:[],allowedTimeStart:null,allowedTimeEnd:null,minGapMinutes:0,createdAt:now,earlyWindowDays:0,delayAllowanceDays:0,target:7,durationMinutes:20,breakable:false,minChunkMinutes:null};
      const data = [
        {...base,name:'Read',topics:['health'],target:1},
        {...base,name:'Stretch',topics:['health','evening'],target:3/7,type:'reduce'},
        {...base,name:'Inbox zero',type:'task',target:null,dueDate:now+86400000,eventTime:null,priority:1},
        {...base,name:'Filed taxes',type:'task',target:null,dueDate:now-86400000,logs:[{ts:now-3600000}],lastLog:now-3600000},
        {...base,name:'Snoozed gym',snoozedUntil:now+7*86400000,target:3},
        {...base,name:'Device meeting',type:'task',target:null,source:'device',calendarDeviceId:'abc123',calendarSeriesId:'device:1:2',calendarId:'cal',externalId:'ext-1',importedAt:now,dueDate:now+3600000,eventTime:now+3600000,showOnSharedDisplay:false,allowSharedDisplayCompletion:false,name:'Device meeting'},
        {...base,name:'Local event',appointment:{repeat:'once',startDate:'2026-11-05',until:'',startMinute:600,weekdays:[4],ordinalWeekdays:[],exceptions:{}},type:'task',target:null,dueDate:now+4*86400000,eventTime:now+4*86400000+600*60000,allowedTimeFixedStart:true,allowedTimeStart:600,breakable:false,autoMarkMinutes:null,earlyWindowDays:0,delayAllowanceDays:0,weatherProfileMode:'none'}
      ];
      save(data);
      render();
    });
    await page.waitForTimeout(400);

    // ── Picker over saved items, keyed by hid ──
    await page.locator('[data-open-home-filters]').click();
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#home-filter-sheet [data-open-bulk-edit]').isVisible(),'bulk edit entry in the filters sheet');
    await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
    await page.waitForTimeout(300);
    assert.ok(await page.locator('#bulk-edit-sheet').evaluate(el=>el.classList.contains('open')),'picker opens');
    // One row per saved hid: seven rows, plus the device item locked.
    const rowNames = await page.evaluate(()=>[...document.querySelectorAll('#bulk-rows strong')].map(el=>el.textContent));
    assert.equal(new Set(rowNames).size,rowNames.length,'one row per saved item — no duplicates');
    assert.ok(rowNames.includes('Read') && rowNames.includes('Inbox zero'),'saved items listed regardless of today’s agenda');
    assert.ok(rowNames.includes('Device meeting'),'device item listed');
    const lockedRow = page.locator('.bulk-row.locked');
    assert.equal(await lockedRow.count(),1,'device item shown unavailable');
    assert.ok((await lockedRow.first().textContent()).includes('managed by your phone calendar'),'device item explains why');
    assert.equal(await page.locator('.bulk-row.locked input').count(),0,'device item has no checkbox');

    // Completed and snoozed items are hidden until explicitly shown.
    await page.locator('#bulk-show-completed').click();
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#bulk-rows').textContent()).includes('Filed taxes'),'completed visible after toggle');
    await page.locator('#bulk-show-snoozed').click();
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#bulk-rows').textContent()).includes('Snoozed gym'),'snoozed visible after toggle');

    // ── Selection retained across search and filters ──
    await page.locator('#bulk-search').fill('read');
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#bulk-rows').textContent()).includes('Read'),'search narrows results');
    await page.locator('[data-bulk-check]').first().check();
    await page.waitForTimeout(120);
    await page.locator('#bulk-search').fill('');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#bulk-count').textContent(),'1 selected','selection survives clearing search');
    await page.locator('[data-bulk-filter="type"][data-bulk-filter-value="task"]').click();
    await page.waitForTimeout(150);
    assert.ok((await page.locator('#bulk-rows').textContent()).includes('Inbox zero'),'type filter works in the picker');
    await page.locator('[data-bulk-check]').first().check();
    await page.waitForTimeout(120);
    await page.locator('[data-bulk-filter="type"][data-bulk-filter-value="all"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#bulk-count').textContent(),'2 selected','selection retained across filter changes');
    // Outside-count: select everything visible, then hide completed — the
    // selected hidden item is reported as outside the current results.
    await page.locator('#bulk-select-all').click();
    await page.waitForTimeout(150);
    const allCount = await page.evaluate(()=>bulkSelected.size);
    assert.ok(allCount >= 6,'select all results adds shown items');
    await page.locator('#bulk-show-completed').click();
    await page.waitForTimeout(150);
    const outsideText = await page.locator('#bulk-outside-count').textContent();
    assert.ok(outsideText.includes('1 selected not in these results'),'outside count reported');
    // Filter chips render real labels (priority choices are objects).
    await page.evaluate(()=>renderBulkPicker());
    const chipText = await page.locator('[data-bulk-filter="priority"]').allTextContents();
    assert.ok(chipText.some(t=>t.includes('Important')),'priority chips show labels');

    // Dedupe: checking a visible row twice cannot double-count one hid.
    await page.locator('#bulk-clear-selection').click();
    await page.waitForTimeout(100);
    const firstHid = await page.locator('[data-bulk-check]').first().getAttribute('data-bulk-check');
    await page.locator(`[data-bulk-check="${firstHid}"]`).check();
    await page.evaluate(()=>{const hid=document.querySelector('[data-bulk-check]').dataset.bulkCheck;bulkSelected.add(hid);});
    assert.equal(await page.evaluate(()=>bulkSelected.size),1,'a hid is never counted twice');

    // ── Choose changes: nothing changes until explicitly chosen ──
    await page.evaluate(hid=>{bulkSelected.clear();bulkSelected.add(hid);},firstHid);
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(250);
    const before = await page.evaluate(()=>load().find(h=>h.name==='Read'));
    await page.locator('#bulk-review-continue').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#bulk-review-summary').textContent(),'1 selected · 0 will change','keep unchanged applies nothing');
    assert.equal(await page.locator('#bulk-apply').isDisabled(),true,'apply disabled without changes');
    await page.locator('#bulk-edit-back').click();
    await page.waitForTimeout(150);

    const openGroup = async(name)=>{
      await page.evaluate(group=>{
        const details = [...document.querySelectorAll('#bulk-edit-rows details.bulk-group')]
          .find(el=>el.querySelector('summary').textContent.trim() === group);
        if(details)details.open = true;
      },name);
      await page.waitForTimeout(80);
    };

    const openPicker = async()=>{
      await page.locator('[data-open-home-filters]').click();
      await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
      await page.waitForTimeout(200);
    };
    const selectByName = async(name)=>{
      await page.evaluate(n=>{
        bulkSelected.clear();
        bulkPending = [];
        const item = load().find(h=>h.name===n);
        bulkSelected.add(item.hid);
        renderBulkPicker();
      },name);
      await page.waitForTimeout(100);
    };

    // Mixed context: select a habit and a limit; priority shows a common value.
    await page.locator('#bulk-edit-back').click();
    await page.waitForTimeout(150);
    await page.evaluate(()=>{
      bulkSelected.clear();
      const data = load();
      bulkSelected.add(data.find(h=>h.name==='Read').hid);
      bulkSelected.add(data.find(h=>h.name==='Stretch').hid);
    });
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(250);
    const priorityContext = await page.evaluate(()=>{
      renderBulkEditStep();
      return document.querySelector('[data-bulk-op-row="priority"] .bulk-op-context').textContent;
    });
    assert.ok(priorityContext.includes('now:'),'common value shown as context only');
    // Repeat rhythm applies to habits; tasks would be excluded.
    await openGroup('Repeat and dates');
    await page.locator('[data-bulk-op="repeatMode"]').selectOption('opportunity');
    await page.waitForTimeout(120);
    const appliesLine = await page.locator('[data-bulk-applies="repeatMode"]').textContent();
    assert.ok(appliesLine.includes('2 of 2'),'applicability counts habits');
    await page.locator('#bulk-review-continue').click();
    await page.waitForTimeout(200);
    const summaryLines = await page.locator('#bulk-review-lines').textContent();
    assert.ok(summaryLines.includes('2 items'),'review lists the change with a count');
    await page.locator('#bulk-edit-back').click();
    await page.waitForTimeout(150);

    // ── Applicability and dependency handling ──
    await page.locator('#bulk-edit-back').click(); // change → pick
    await page.waitForTimeout(150);
    await page.evaluate(()=>{
      bulkSelected.clear();
      const data = load();
      bulkSelected.add(data.find(h=>h.name==='Read').hid);
      bulkSelected.add(data.find(h=>h.name==='Inbox zero').hid);
      bulkSelected.add(data.find(h=>h.name==='Local event').hid);
      renderBulkPicker();
    });
    await page.waitForTimeout(100);
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(250);
    await openGroup('Repeat and dates');
    // 'routine' needs no trigger, so only applicability is under test here.
    await page.locator('[data-bulk-op="repeatMode"]').selectOption('routine');
    await page.waitForTimeout(120);
    assert.ok((await page.locator('[data-bulk-applies="repeatMode"]').textContent()).includes('owned by its event schedule'),'appointment excluded with a reason');
    await openGroup('Repeat and dates');
    await page.locator('[data-bulk-op="dueDate"]').selectOption('clear');
    await page.waitForTimeout(120);
    await page.locator('#bulk-review-continue').click();
    await page.waitForTimeout(200);
    const taskRow = await page.evaluate(()=>{
      const review = bulkComputeReview();
      const item = review.perItem.find(entry=>entry.name==='Inbox zero');
      return {changes:item.changes.map(c=>c.label)};
    });
    assert.ok(taskRow.changes.some(label=>label.includes('Due date')),'task due date change listed');
    await page.locator('#bulk-apply').click();
    await page.waitForTimeout(300);
    const applied = await page.evaluate(()=>load());
    const inbox = applied.find(h=>h.name==='Inbox zero');
    assert.equal(inbox.dueDate,null,'due date cleared');
    assert.equal(inbox.eventTime,null,'dependent start time cleared with the date');
    const localEvent = applied.find(h=>h.name==='Local event');
    assert.notEqual(localEvent.dueDate,null,'appointment-owned date untouched');
    assert.ok(await page.locator('#action-undo').isVisible(),'undo offered after bulk edit');

    // ── Guarded undo: restores only the batch's fields, preserves later edits ──
    await page.evaluate(()=>{
      const data = load();
      const read = data.find(h=>h.name==='Read');
      read.topics.push('post-batch-topic'); // later unrelated edit
      save(data);
    });
    await page.locator('#action-undo').click();
    await page.waitForTimeout(300);
    const undone = await page.evaluate(()=>load());
    assert.notEqual(undone.find(h=>h.name==='Inbox zero').dueDate,null,'undo restored the due date');
    assert.ok(undone.find(h=>h.name==='Read').topics.includes('post-batch-topic'),'undo preserved the later unrelated edit');
    assert.ok(undone.find(h=>h.name==='Read').repeatMode === 'routine','undo restored repeat mode');
    assert.ok(undone.find(h=>h.name==='Local event').repeatMode === 'routine','appointment kept its own repeat mode');

    // ── Conflict: a change re-edited after apply is kept, reported ──
    await openPicker();
    await selectByName('Read');
    // Re-run a small batch through the UI.
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(200);
    await page.locator('[data-bulk-op="priority"]').selectOption('set');
    await page.waitForTimeout(100);
    await page.locator('[data-bulk-field="priority"]').selectOption('1');
    await page.waitForTimeout(100);
    await page.locator('#bulk-review-continue').click();
    await page.waitForTimeout(200);
    await page.locator('#bulk-apply').click();
    await page.waitForTimeout(250);
    await page.evaluate(()=>{
      const data = load();
      const read = data.find(h=>h.name==='Read');
      read.priority = 4; // newer manual edit after the batch
      save(data);
    });
    await page.locator('#action-undo').click();
    await page.waitForTimeout(300);
    const conflict = await page.evaluate(()=>load().find(h=>h.name==='Read').priority);
    assert.equal(conflict,4,'newer edit wins over undo');
    assert.ok((await page.evaluate(()=>document.getElementById('toast-text').textContent)).includes('kept'),'conflict reported');

    // ── Staleness: a reviewed setting changed before apply forces a re-look ──
    await openPicker();
    await selectByName('Read');
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(200);
    await page.locator('[data-bulk-op="duration"]').selectOption('set');
    await page.waitForTimeout(100);
    await page.locator('[data-bulk-field="duration"][data-bulk-kind="number"]').fill('30');
    await page.waitForTimeout(100);
    await page.locator('#bulk-review-continue').click();
    await page.waitForTimeout(200);
    await page.evaluate(()=>{
      const data = load();
      data.find(h=>h.name==='Read').durationMinutes = 25; // concurrent edit under review
      save(data);
    });
    await page.locator('#bulk-apply').click();
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#bulk-review-notice').isVisible(),'staleness notice shown');
    assert.equal(await page.locator('#bulk-apply').isDisabled(),true,'apply gated until re-inspected');
    assert.ok(await page.locator('#bulk-review-confirm').isVisible(),'re-inspection control offered');
    await page.locator('#bulk-review-confirm').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#bulk-apply').isDisabled(),false,'apply re-enabled after inspection');
    await page.locator('#bulk-apply').click();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>load().find(h=>h.name==='Read').durationMinutes),30,'applied after re-inspection');

    // ── Close guard: ask before discarding real work ──
    await openPicker();
    await selectByName('Read');
    await page.locator('#bulk-edit-continue').click();
    await page.waitForTimeout(200);
    await page.locator('[data-bulk-op="color"]').selectOption('set');
    await page.waitForTimeout(100);
    await page.locator('#bulk-edit-close').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-edit-confirm').isVisible(),'close with chosen changes asks first');
    await page.locator('#bulk-edit-confirm-yes').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-edit-sheet').evaluate(el=>!el.classList.contains('open')),'discard leaves the flow');
    assert.equal(await page.evaluate(()=>bulkPending.length),0,'chosen changes cleared');

    // Reopening starts clean.
    await page.locator('[data-open-home-filters]').click();
    await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#bulk-count').textContent(),'0 selected','fresh picker selection');
    // Escape closes the empty picker without a prompt.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-edit-sheet').evaluate(el=>!el.classList.contains('open')),'empty picker closes silently');

    // Picker filters never leak into Home filters.
    await page.evaluate(()=>{homeTypeFilter = 'task';});
    await page.evaluate(()=>renderHomeTagFilter(load()));
    await page.locator('[data-open-home-filters]').click();
    await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>bulkFilters.type),'task','picker copied Home filters on open');
    await page.locator('[data-bulk-filter="type"][data-bulk-filter-value="all"]').click();
    await page.waitForTimeout(100);
    await page.locator('#bulk-edit-close').click();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>homeTypeFilter),'task','changing picker filters left Home filters alone');

    assert.deepEqual(errors,[]);
    console.log('PASS bulk edit: picker, selection persistence, explicit ops, applicability, review, staleness, guarded undo, close guard');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
