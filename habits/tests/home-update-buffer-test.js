const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,plannerSettings} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    for(const layout of ['mobile','desktop']){
    const page = await browser.newPage(layout === 'mobile'
      ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
      : {viewport:{width:1280,height:900}});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_v2','[]');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
    });
    await page.goto(BASE,{waitUntil:'load'});
    await page.evaluate(()=>waitForHomeAgendaRender());
    const now = Date.now();
    await page.evaluate(({habits,settings})=>{
      cancelHomeAgendaRefinement('buffer test');
      sortSettings = settings;
      save(normalize(habits));
      const data = load();
      render({__optimizedWeek:buildWeekAgenda(data,settings,7)});
      adoptHomeAgendaReadyState(_homeRenderedWeek,data,true);
      window.originalPlanner = buildWeekAgendaOffMain;
      buildWeekAgendaOffMain = (data,cfg,count)=>new Promise((resolve,reject)=>{
        const week = buildWeekAgenda(data,cfg,count);
        window.bufferWeek = week;
        window.finishBufferSolve = (replacement=week)=>resolve(replacement);
        window.failBufferSolve = ()=>reject(new Error('test solve failure'));
      });
    },{habits:[
      baseHabit({hid:'first',name:'First',type:'task',dueDate:now,createdAt:now-86400000}),
      baseHabit({hid:'second',name:'Second',type:'task',dueDate:now,createdAt:now-86400000})
    ],settings:plannerSettings([],{agendaOptimizer:false,minimalMode:false})});

    const pending = await page.evaluate(()=>{
      const list = $('list');
      window.beforeBufferNode = list.querySelector('.swipe-row');
      const beforeHeight = list.getBoundingClientRect().height;
      logTing(0,{feedback:false});
      refreshOpenViews();
      // Repeated presentation calls must not uncover the intermediate plan.
      renderHomePresentationOnly();
      refreshOpenViews();
      return {inert:list.inert,busy:list.getAttribute('aria-busy'),
        masked:list.classList.contains('is-agenda-updating'),
        sameNode:window.beforeBufferNode === list.querySelector('.swipe-row'),
        delta:list.getBoundingClientRect().height-beforeHeight};
    });
    assert(pending.inert && pending.busy === 'true' && pending.masked,'replanning visibly covers and disables old controls');
    assert(pending.sameNode && Math.abs(pending.delta)<1,'buffer preserves mounted rows and list height');
    assert(await page.locator('#list .section-header-label').first().isVisible(),
      'day headings remain visible so the loading state preserves orientation');
    assert(await page.evaluate(()=>$('home-agenda-update-status').textContent === 'Updating agenda…'
      && !$('home-agenda-update-status').closest('[inert]')),
      'refresh status remains available to assistive technology outside the inert list');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#list .swipe-row').first().evaluate(row=>
      getComputedStyle(row,'::after').animationName),'none','reduced motion keeps static placeholders');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.screenshot({path:`test-results/home-buffer-${layout}.png`,animations:'disabled'});
    const box = await page.locator('#list .swipe-row').first().boundingBox();
    await page.mouse.click(box.x+30,box.y+box.height/2);
    assert.equal(await page.evaluate(()=>actualLogs(load()[0].logs).length),1,'a tap on the covered row cannot log it again');

    await page.evaluate(()=>{
      const field = document.createElement('input');
      field.id = 'buffer-note';
      document.body.appendChild(field);
      field.focus();
      field.value = 'draft';
      window.finishBufferSolve();
    });
    await page.waitForTimeout(800);
    assert(await page.evaluate(()=>$('list').inert && document.activeElement.id === 'buffer-note'
      && $('buffer-note').value === 'draft'),'a finished solve waits while a field has focus');
    await page.evaluate(()=>{
      $('buffer-note').blur();$('buffer-note').remove();
      const closed = document.createElement('div');
      closed.id = 'buffer-closed-editor';
      closed.className = 'sheet-wrap';
      closed.innerHTML = '<input aria-label="closed editor">';
      document.body.appendChild(closed);
      closed.querySelector('input').focus();
    });
    await page.evaluate(()=>waitForHomeAgendaRender());
    await page.evaluate(()=>$('buffer-closed-editor').remove());
    assert.equal(await page.locator('#list .swipe-row[data-hid="first"]').count(),0,'completed task leaves only when the finished plan appears');
    assert(await page.evaluate(()=>!$('list').inert && !$('list').hasAttribute('aria-busy')
      && !$('list').classList.contains('is-agenda-updating')),'the finished agenda restores interaction');
    assert.equal(await page.locator('#home-agenda-update-status').textContent(),'Agenda ready.',
      'completion is announced when the agenda becomes usable');
    console.log('ok: log buffer, fixed geometry, covered taps and focused drafts');

    const superseded = await page.evaluate(()=>{
      const data = load();
      data[1].name = 'Intermediate title';
      save(data);render();
      const oldResult = window.finishBufferSolve;
      data[1].name = 'Final title';
      save(data);render();
      window.latestBufferSolve = window.finishBufferSolve;
      oldResult();
      return $('list').inert;
    });
    assert(superseded,'rapid edits retain the loading cover');
    await page.waitForTimeout(400);
    assert(await page.evaluate(()=>$('list').inert && !$('list').textContent.includes('Intermediate title')),
      'an obsolete worker result cannot uncover or repaint the old revision');
    await page.evaluate(()=>window.latestBufferSolve());
    await page.evaluate(()=>waitForHomeAgendaRender());
    assert.equal(await page.locator('#list .ting-name').first().textContent(),'Final title','only the latest edit becomes visible');
    console.log('ok: rapid edits discard obsolete results without uncovering the list');

    // Deliver a changed background plan while a finger is still down. The
    // original node must survive the gesture and its follow-up click window.
    await page.mouse.move(2,300);
    await page.mouse.down();
    await page.evaluate(()=>{
      window.backgroundNode = $('list').querySelector('.swipe-row');
      _optimizerHomeReadyKey = '';
      queueOptimizedHomeRender(load(),{__backgroundRefresh:true,__forceReplan:true});
      const week = window.bufferWeek;
      const row = week.days[0].timeline.find(row=>row.kind === 'fill');
      row.start += 60000;
      row.end += 60000;
      window.finishBufferSolve(week);
    });
    await page.waitForTimeout(750);
    assert(await page.evaluate(()=>window.backgroundNode === $('list').querySelector('.swipe-row')
      && !$('list').inert),'background result waits for the held gesture with the original controls intact');
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert(await page.evaluate(()=>window.backgroundNode === $('list').querySelector('.swipe-row')),'the released gesture gets a quiet interval before replacement');
    await page.evaluate(()=>waitForHomeAgendaRender());
    assert(await page.evaluate(()=>!$('list').inert && window.backgroundNode !== $('list').querySelector('.swipe-row')),'changed background plan appears after the gesture and loading buffer');
    console.log('ok: background changes wait for gestures and a quiet interval');

    await page.evaluate(({habits})=>{
      save(normalize(habits));
      const data = load();
      render({__optimizedWeek:buildWeekAgenda(data,sortSettings,7)});
      adoptHomeAgendaReadyState(_homeRenderedWeek,data,true);
      $('list').querySelectorAll('.swipe-row')[7].scrollIntoView({block:'start'});
    },{habits:Array.from({length:18},(_,i)=>baseHabit({hid:`scroll-${i}`,name:`Review item ${i+1}`,
      type:'task',durationMinutes:10,dueDate:now,createdAt:now-86400000}))});
    await page.waitForTimeout(700);
    const anchor = await page.evaluate(()=>{
      const row = [...$('list').querySelectorAll('.swipe-row')].find(row=>{
        const rect = row.getBoundingClientRect();
        return rect.top >= 80 && rect.top < 500;
      });
      const anchor = {hid:row.dataset.hid,top:row.getBoundingClientRect().top};
      logTing(0,{feedback:false});
      refreshOpenViews();
      window.finishBufferSolve();
      return anchor;
    });
    await page.evaluate(()=>waitForHomeAgendaRender());
    const afterTop = await page.locator(`#list .swipe-row[data-hid="${anchor.hid}"]`).first()
      .evaluate(row=>row.getBoundingClientRect().top);
    assert(Math.abs(afterTop-anchor.top)<2,'removing a row above the viewport preserves the visible reading position');
    console.log('ok: scrolled agenda keeps the visible item in place after logging');

    await page.evaluate(()=>{
      buildWeekAgendaOffMain = ()=>Promise.reject(new Error('test solve failure'));
      _optimizerHomeReadyKey = '';
      render({__skipFreshnessGate:true});
    });
    await page.waitForFunction(()=>_optimizerHomeRequestKey === '');
    assert(await page.evaluate(()=>!$('list').inert && !$('list').classList.contains('is-agenda-updating')
      && Boolean($('list').querySelector('.ting-card'))),'a failed solve restores usable controls');
    assert.deepEqual(errors,[]);
    console.log('ok: failed solve releases buffer');
    await page.close();
    console.log(`ok: ${layout} update flow`);
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
