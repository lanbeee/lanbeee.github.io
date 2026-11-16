// Bulk add: "add & next" carry-forward, independent queued drafts, review
// (edit / duplicate / remove), whole-batch validation, capacity, storage
// failure, draft-aware cancellation, and the untouched single-item flow.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    await context.clock.setFixedTime(new Date('2026-10-31T12:00:00-04:00'));
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

    // ── Batch mode entry and queue with carry-forward ──
    await page.locator('#open-add').click();
    assert.equal(await page.locator('#add-batch-entry').isVisible(),true,'add several visible in the add sheet');
    await page.locator('#add-batch-entry').click();
    assert.equal(await page.locator('#do-batch-next').isVisible(),true);
    assert.equal(await page.locator('#do-save').isVisible(),false,'single save hidden in batch mode');
    assert.equal(await page.locator('#add-batch-hint').textContent(),'Settings carry forward to the next item.');
    await page.locator('#ting-message').fill('Read');
    await page.locator('[data-add-rhythm="1,1"]').click();
    await page.locator('#ting-duration').fill('20');
    await page.locator('#add-more-toggle').click();
    await page.locator('#ting-priority-seg [data-priority="1"]').click();
    // Explicitly chosen emoji survives the carry-forward reset.
    await page.locator('#ting-emoji-preview').click();
    await page.locator('#ting-emoji').fill('📕');
    await page.locator('#do-batch-next').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'1 item in batch · review');
    assert.equal(await page.locator('#ting-message').inputValue(),'','name cleared for the next item');
    // Settings carried forward, including the adjustment made for this item.
    assert.equal(await page.locator('[data-add-rhythm="1,1"]').getAttribute('aria-pressed'),'true','rhythm carried forward');
    assert.equal(await page.locator('#ting-duration').inputValue(),'20','duration carried forward');
    assert.equal(await page.evaluate(()=>readAddRecord().priority),1,'priority carried forward');
    // Explicitly chosen emoji kept, not re-suggested.
    assert.equal(await page.locator('#ting-emoji').inputValue(),'📕','chosen emoji preserved');
    const queued = await page.evaluate(()=>bulkBatchItems[0]);
    assert.equal(queued.emoji,'📕');
    assert.ok(!queued.hid,'queued record has no identity before save');
    assert.deepEqual(queued.logs,[],'no history copied');

    // Second item: start from carried settings, adjust only duration.
    await page.locator('#ting-message').fill('Stretch');
    await page.locator('#ting-duration').fill('10');
    await page.locator('#do-batch-next').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'2 items in batch · review');
    // Queued drafts are independent deep copies.
    const independence = await page.evaluate(()=>({first:bulkBatchItems[0],second:bulkBatchItems[1]}));
    assert.equal(independence.first.durationMinutes,20,'first draft keeps its own duration');
    assert.equal(independence.second.durationMinutes,10,'second draft got the adjustment');
    // The third item keeps the most recently queued configuration (10 min).
    assert.equal(await page.locator('#ting-duration').inputValue(),'10','most recent configuration carried');
    await page.locator('#ting-message').fill('Journal');
    await page.locator('#do-batch-next').click();

    // Empty name cannot be queued.
    await page.locator('#do-batch-next').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'3 items in batch · review');
    assert.ok(await page.locator('#ting-message').evaluate(el=>el === document.activeElement),'focus returns to the name field');

    // ── Review: edit a queued draft through the detail editor ──
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator('#bulk-batch-sheet').evaluate(el=>el.classList.contains('open')),'review sheet opens over the add form');
    const rowText = await page.locator('#bulk-batch-rows').textContent();
    assert.ok(rowText.includes('Read') && rowText.includes('Stretch') && rowText.includes('Journal'),'rows list queued names');
    assert.ok(rowText.includes('20 min') && rowText.includes('10 min'),'rows summarize settings');
    await page.locator('[data-bulk-edit="1"]').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#detail-save').textContent(),'save to batch','draft editor relabels save');
    await page.locator('#detail-duration').fill('45');
    await page.locator('#detail-save').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#add-batch-status').textContent(),'3 items in batch · review','draft edit stayed in memory');
    const edited = await page.evaluate(()=>bulkBatchItems[1]);
    assert.equal(edited.durationMinutes,45,'queued draft updated in memory');
    assert.equal(await page.evaluate(()=>load().length),0,'no persistence while editing drafts');
    assert.ok(await page.locator('#bulk-batch-sheet').evaluate(el=>el.classList.contains('open')),'review visible after draft save');

    // ── Duplicate asks for a name; remove drops the row ──
    await page.locator('[data-bulk-duplicate="0"]').click();
    assert.ok(await page.locator('#bulk-batch-dup-name').isVisible(),'duplicate asks for a name');
    await page.locator('#bulk-batch-dup-name').fill('');
    await page.locator('[data-bulk-dup-confirm="0"]').click();
    assert.equal(await page.locator('#bulk-batch-status, #add-batch-status').count(),1,'still 3 items after empty duplicate name');
    await page.locator('#bulk-batch-dup-name').fill('Read more');
    await page.locator('[data-bulk-dup-confirm="0"]').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'4 items in batch · review');
    const copy = await page.evaluate(()=>bulkBatchItems[1]);
    assert.equal(copy.name,'Read more');
    assert.equal(copy.durationMinutes,20,'duplicate carries configuration');
    await page.locator('[data-bulk-remove="2"]').click();
    assert.equal(await page.evaluate(()=>bulkBatchItems.map(h=>h.name).join('|')),'Read|Read more|Journal','remove dropped the right row');

    // Unfinished item with a name: never silently included or discarded.
    await page.locator('#bulk-batch-back').click();
    await page.waitForTimeout(200);
    await page.locator('#ting-message').fill('Maybe later');
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#bulk-batch-offer').isVisible(),'unfinished item offer shows');
    assert.ok((await page.locator('#bulk-batch-offer-name').textContent()).includes('Maybe later'));
    await page.locator('#bulk-batch-offer-skip').click();
    assert.equal(await page.locator('#bulk-batch-offer').isVisible(),false,'leave-it-out keeps it out');
    await page.locator('#bulk-batch-back').click();
    await page.waitForTimeout(150);
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#bulk-batch-offer').isVisible(),false,'offer stays dismissed while the name is unchanged');
    await page.locator('#bulk-batch-back').click();
    await page.waitForTimeout(150);
    await page.locator('#ting-message').fill('Maybe later today');
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-batch-offer').isVisible(),'a changed name re-arms the offer');
    await page.locator('#bulk-batch-offer-add').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'4 items in batch · review','offer queues the unfinished item');

    // ── Capacity against MAX_TINGS ──
    await page.evaluate(()=>{window._realSave = save;});
    await page.evaluate(()=>{
      const data = load();
      while(data.length < 297)data.push({...bulkBatchItems[0],name:'filler '+data.length,hid:undefined,logs:[]});
      save(data.map(h=>{const c={...h};delete c.hid;return c;}));
      render();
    });
    await page.locator('#bulk-batch-back').click();
    await page.waitForTimeout(150);
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-batch-error').isVisible(),'capacity problem shown beside the batch');
    assert.ok((await page.locator('#bulk-batch-error').textContent()).includes('300'),'capacity message names the limit');
    assert.equal(await page.locator('#bulk-batch-add').isDisabled(),true,'commit disabled over capacity');
    await page.evaluate(()=>{save = window._realSave;});

    // ── Storage failure keeps the draft and allows retry ──
    await page.evaluate(()=>{const real = window._realSave; window.save = ()=>false; window._restored = real;});
    // Trim the batch to fit capacity first (297 saved + 4 queued → drop one).
    await page.locator('[data-bulk-remove="0"]').click();
    assert.equal(await page.locator('#bulk-batch-error').isVisible(),false,'capacity clear after trimming');
    await page.locator('#bulk-batch-add').click();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>load().length),297,'failed save wrote nothing');
    assert.ok(await page.locator('#bulk-batch-sheet').evaluate(el=>el.classList.contains('open')),'review stays open on storage failure');
    assert.equal(await page.evaluate(()=>bulkBatchItems.length),3,'drafts retained for retry');
    await page.evaluate(()=>{save = window._restored;});
    await page.locator('#bulk-batch-add').click();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>load().length),300,'retry saves the whole batch');
    assert.equal(await page.evaluate(()=>new Set(load().map(h=>h.hid)).size),await page.evaluate(()=>load().length),'every batch item got its own identity');
    assert.ok(await page.locator('#action-undo').isVisible(),'undo offered after success');
    assert.ok(await page.locator('#add-sheet').evaluate(el=>!el.classList.contains('open')),'back on Home, no detail sheets');

    // ── Undo removes unchanged new items; activity keeps them ──
    await page.evaluate(()=>{
      const data = load();
      const target = data.find(h=>h.name === 'Read more');
      target.logs = [{ts:Date.now()}];
      target.lastLog = Date.now();
      save(data);
    });
    await page.locator('#action-undo').click();
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(()=>load());
    assert.equal(afterUndo.length,298,'undo removed untouched new items only');
    assert.equal(afterUndo.filter(h=>h.name === 'Read more').length,1,'item with new activity survived');
    assert.equal(afterUndo.filter(h=>h.name === 'Journal').length,0,'untouched item was removed');
    assert.ok((await page.evaluate(()=>document.getElementById('toast-text').textContent)).includes('kept'),'undo explains what it kept');

    // ── Draft-aware cancel: ask only when there is queued work ──
    await page.locator('#open-add').click();
    await page.locator('#add-batch-entry').click();
    await page.locator('#ting-message').fill('Solo');
    await page.locator('#do-batch-next').click();
    // Escape shows the same confirm as cancel; keep editing from there.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#add-batch-confirm').isVisible(),'Escape with queued items asks first');
    await page.locator('#add-batch-confirm-no').click();
    assert.ok(await page.locator('#add-sheet').evaluate(el=>el.classList.contains('open')),'keep editing stays in the flow');
    await page.locator('#do-cancel').click();
    assert.ok(await page.locator('#add-batch-confirm').isVisible(),'cancel with queued items asks too');
    await page.locator('#add-batch-confirm-no').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#add-sheet').evaluate(el=>el.classList.contains('open')),'still editing');
    await page.locator('#do-cancel').click();
    await page.locator('#add-batch-confirm-yes').click();
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#add-sheet').evaluate(el=>!el.classList.contains('open')),'discard leaves the flow');
    assert.equal(await page.evaluate(()=>bulkBatchMode),false,'batch mode reset');

    // Escape on the review sheet returns to the add form without discarding.
    await page.locator('#open-add').click();
    await page.locator('#add-batch-entry').click();
    await page.locator('#ting-message').fill('Esc');
    await page.locator('#do-batch-next').click();
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#add-sheet').evaluate(el=>el.classList.contains('open')),'Escape returns from review');
    assert.equal(await page.evaluate(()=>bulkBatchItems.length),1,'batch intact after review Escape');
    await page.locator('#do-cancel').click();
    await page.locator('#add-batch-confirm-yes').click();
    await page.waitForTimeout(150);

    // ── Single-item flow unchanged ──
    await page.locator('#open-add').click();
    assert.equal(await page.locator('#do-save').isVisible(),true,'single save back for a fresh open');
    assert.equal(await page.locator('#do-batch-next').isVisible(),false);
    await page.locator('#ting-message').fill('Plain add');
    await page.locator('#do-save').click();
    await page.waitForTimeout(300);
    const single = await page.evaluate(()=>load().find(h=>h.name === 'Plain add'));
    assert.ok(single,'single-item add persisted');
    await page.evaluate(()=>closeDetail());

    // ── Minimal mode: batch flow reachable, chrome intact ──
    await page.evaluate(()=>setMinimalMode(true));
    await page.locator('#open-add').click();
    assert.ok(await page.locator('#add-batch-entry').isVisible(),'add several visible in minimal mode');
    await page.locator('#add-batch-entry').click();
    assert.ok(await page.locator('#do-batch-next').isVisible(),'add & next visible in minimal mode');
    await page.locator('#ting-message').fill('Minimal item');
    await page.locator('#do-batch-next').click();
    assert.equal(await page.locator('#add-batch-status').textContent(),'1 item in batch · review');
    await page.locator('#add-batch-status').click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#bulk-batch-sheet').evaluate(el=>el.classList.contains('open')),'review opens in minimal mode');
    await page.locator('#bulk-batch-add').click();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>load().some(h=>h.name === 'Minimal item')),true,'minimal batch committed');
    await page.evaluate(()=>setMinimalMode(false));

    // Narrow phone: footer controls stay visible and inside the sheet.
    await page.evaluate(()=>{ // free capacity headroom for the queue below
      const data = load();
      while(data.length > 250){
        const idx = data.findIndex(h=>String(h.name).startsWith('filler '));
        if(idx < 0)break;
        data.splice(idx,1);
      }
      save(data);
    });
    await page.setViewportSize({width:320,height:700});
    await page.waitForTimeout(250);
    await page.locator('#open-add').click();
    await page.locator('#add-batch-entry').click();
    await page.locator('#ting-message').fill('Narrow');
    await page.locator('#do-batch-next').click();
    for(const id of ['do-batch-next','do-cancel','add-batch-status']){
      const control = page.locator('#'+id);
      assert.ok(await control.isVisible(),`${id} visible at 320`);
      const fits = await control.evaluate(el=>{
        const box = el.getBoundingClientRect();
        const sheet = el.closest('.add-sheet').getBoundingClientRect();
        return box.left >= sheet.left && box.right <= sheet.right + 1;
      });
      assert.ok(fits,`${id} fits at 320`);
    }
    await page.locator('#do-cancel').click();

    assert.deepEqual(errors,[]);
    console.log('PASS bulk add: carry-forward, independent drafts, review, capacity, storage retry, guarded cancel/undo, minimal mode');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
