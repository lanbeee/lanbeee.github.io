const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,plannerSettings} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    for(const layout of ['mobile','desktop']){
    const page = await browser.newPage(layout === 'mobile'
      ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
      : {viewport:{width:1280,height:900}});
    const settle = ()=>page.evaluate(async()=>Promise.race([
      waitForHomeAgendaRender(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error(JSON.stringify({
        pending:Boolean(_optimizerHomeRequestKey),buffering:_homeAgendaUpdateStarted != null,
        revealing:Boolean(_homeAgendaReveal),pointers:[..._homeAgendaPointers],
        focused:document.activeElement?.id,hidden:document.hidden
      }))),12000))
    ]));
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_v2','[]');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
    });
    await page.goto(BASE,{waitUntil:'load'});
    await settle();
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
      window.bufferPlanner = buildWeekAgendaOffMain;
    },{habits:[
      baseHabit({hid:'first',name:'First',type:'task',dueDate:now,createdAt:now-86400000}),
      baseHabit({hid:'second',name:'Second',type:'task',dueDate:now,createdAt:now-86400000})
    ],settings:plannerSettings([],{agendaOptimizer:false,minimalMode:false})});
    // Fixture population can reveal Calendar; measure navigation after that
    // initial appearance has settled, before exercising the log transition.
    await page.waitForTimeout(220);

    await page.evaluate(()=>{
      const list = $('list');
      window.beforeBufferNode = list.querySelector('.swipe-row');
      // A resting reorder grip occupies space even though it is transparent.
      // Exercise it on every layout, including cards without a natural grip.
      const card = window.beforeBufferNode.querySelector('.ting-card');
      if(!card.querySelector('.agenda-drag-handle')){
        const grip = document.createElement('button');
        grip.className = 'agenda-drag-handle';
        card.prepend(grip);
      }
      window.beforeBufferHeight = list.getBoundingClientRect().height;
      window.beforeShell = (document.body.dataset.paneCount === '1'
        ? ['open-about','open-overview','open-add'] : ['open-about','bar-open-search']).map(id=>{
        const rect = $(id).getBoundingClientRect();
        return {id,x:rect.x,y:rect.y};
      });
      // Observe the end of the real click task: feedback and protection must
      // already be in place, without waiting for a second refresh timer.
      list.querySelector('[data-pulse="0"]').addEventListener('click',()=>{
        window.bufferTapSettled = list.inert && list.classList.contains('is-agenda-updating')
          && $('action-toast').classList.contains('show');
      },{once:true});
    });
    const logButton = page.locator('#list [data-pulse="0"]').first();
    if(layout === 'mobile')await logButton.tap();
    else await logButton.click();
    const pending = await page.evaluate(()=>{
      const list = $('list');
      // Repeated presentation calls must not uncover the intermediate plan.
      renderHomePresentationOnly();
      refreshOpenViews();
      return {inert:list.inert,busy:list.getAttribute('aria-busy'),
        immediate:window.bufferTapSettled,
        shellStable:window.beforeShell.every(({id,x,y})=>{
          const rect = $(id).getBoundingClientRect();
          return Math.abs(rect.x-x)<1 && Math.abs(rect.y-y)<1 && !$(id).closest('[inert]');
        }),
        masked:list.classList.contains('is-agenda-updating'),
        sameNode:window.beforeBufferNode === list.querySelector('.swipe-row'),
        delta:list.getBoundingClientRect().height-window.beforeBufferHeight};
    });
    assert(pending.immediate,'a real log tap gives feedback, starts planning and protects stale controls in the same turn');
    assert(pending.shellStable,'page navigation stays in place and usable during the update');
    assert(pending.inert && pending.busy === 'true' && pending.masked,'replanning visibly covers and disables old controls');
    assert(pending.sameNode && Math.abs(pending.delta)<1,'buffer preserves mounted rows and list height');
    const slots = await page.locator('#list .swipe-row').first().evaluate(row=>{
      const face = row.querySelector('.agenda-skeleton-face');
      const rect = row.getBoundingClientRect();
      const shapes = [...face.querySelectorAll('.agenda-skeleton-part')];
      const grip = row.querySelector('.agenda-drag-handle').getBoundingClientRect();
      return {icon:shapes.some(shape=>shape.dataset.part === 'icon'),
        phantomGrip:shapes.some(shape=>{
          const slot = shape.getBoundingClientRect();
          return shape.dataset.part === 'icon' && slot.left < grip.right && slot.right > grip.left;
        }),
        text:shapes.some(shape=>shape.dataset.part === 'text'),
        fits:shapes.every(shape=>{
          const slot = shape.getBoundingClientRect();
          return slot.left >= rect.left-1 && slot.right <= rect.right+1
            && slot.top >= rect.top-1 && slot.bottom <= rect.bottom+1;
        })};
    });
    assert(slots.icon && slots.text && slots.fits,'minimal placeholders trace real card slots without overflowing');
    assert(!slots.phantomGrip,'the invisible reorder grip does not create a shape beside the emoji');
    assert(await page.locator('#list .section-header-label').first().isVisible(),
      'day headings remain visible so the loading state preserves orientation');
    assert(await page.evaluate(()=>$('home-agenda-update-status').textContent === 'Updating agenda…'
      && !$('home-agenda-update-status').closest('[inert]')),
      'refresh status remains available to assistive technology outside the inert list');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#list .agenda-skeleton-face').first().evaluate(face=>
      getComputedStyle(face,'::after').animationName),'none','reduced motion keeps static placeholders');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForTimeout(220);
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
    await page.waitForFunction(()=>$('list').classList.contains('is-agenda-revealing'));
    assert(await page.evaluate(()=>$('list').inert && $('list').getAttribute('aria-busy') === 'true'
      && Boolean(document.querySelector('.home-agenda-transition'))),
      'the old skeleton and incoming cards overlap while controls remain protected');
    await settle();
    await page.evaluate(()=>$('buffer-closed-editor').remove());
    assert.equal(await page.locator('#list .swipe-row[data-hid="first"]').count(),0,'completed task leaves only when the finished plan appears');
    assert(await page.evaluate(()=>!$('list').inert && !$('list').hasAttribute('aria-busy')
      && !$('list').classList.contains('is-agenda-updating')),'the finished agenda restores interaction');
    assert.equal(await page.locator('#home-agenda-update-status').textContent(),'Agenda ready.',
      'completion is announced when the agenda becomes usable');
    assert.equal(await page.locator('.home-agenda-transition,.agenda-skeleton-face').count(),0,
      'the crossfade leaves no stale decorative layer');
    assert(await page.evaluate(()=>window.beforeShell.every(({id,x,y})=>{
      const rect = $(id).getBoundingClientRect();
      return Math.abs(rect.x-x)<1 && Math.abs(rect.y-y)<1;
    })),'revealing Search after the first completion keeps existing navigation targets in place');
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
    await settle();
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
    await settle();
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
    await settle();
    const afterTop = await page.locator(`#list .swipe-row[data-hid="${anchor.hid}"]`).first()
      .evaluate(row=>row.getBoundingClientRect().top);
    assert(Math.abs(afterTop-anchor.top)<2,'removing a row above the viewport preserves the visible reading position');
    console.log('ok: scrolled agenda keeps the visible item in place after logging');

    const survivor = await page.evaluate(()=>{
      const list = $('list');
      const snapshot = captureHomeReadingPosition(list);
      const row = [...list.children].find(el=>homeReadingElementKey(el) === snapshot.key);
      const next = row.nextElementSibling;
      const survivor = {hid:next.dataset.hid,top:next.getBoundingClientRect().top};
      quickLog(Number(row.dataset.realIdx),row.querySelector('.ting-card'));
      window.finishBufferSolve();
      return survivor;
    });
    await settle();
    const survivorTop = await page.locator(`#list .swipe-row[data-hid="${survivor.hid}"]`).first()
      .evaluate(row=>row.getBoundingClientRect().top);
    assert(Math.abs(survivorTop-survivor.top)<2,
      'completing the first visible item keeps its visible neighbor in place instead of jumping to the heading');
    await page.evaluate(()=>{beginHomeAgendaUpdate();finishHomeAgendaUpdate();});
    await page.waitForFunction(()=>_homeAgendaReveal?.started);
    await page.evaluate(async()=>{
      const host = homeReadingScrollHost($('list'));
      if(host)host.scrollTop += 30;
      else window.scrollBy({top:30,behavior:'instant'});
      await new Promise(requestAnimationFrame);
    });
    assert(await page.evaluate(()=>_homeAgendaReveal?.cover
      && _homeAgendaReveal.cover.firstElementChild.style.transform === 'translateY(-30px)'),
      'the decorative reveal follows scrolling without locking the page');
    await page.evaluate(()=>cancelHomeAgendaReveal());
    assert(await page.evaluate(()=>!$('list').inert && !$('list').hasAttribute('aria-busy')
      && !$('empty').inert && !$('home-week-plan').inert && !document.querySelector('.home-agenda-transition')),
      'an interrupted reveal releases all controls and removes its layer');
    console.log('ok: completing the visible anchor, scrolling during reveal and interrupted cleanup');

    await page.evaluate(()=>{
      buildWeekAgendaOffMain = ()=>Promise.reject(new Error('test solve failure'));
      _optimizerHomeReadyKey = '';
      render({__skipFreshnessGate:true});
    });
    await page.waitForFunction(()=>_optimizerHomeRequestKey === '' && !_homeAgendaReveal);
    assert(await page.evaluate(()=>!$('list').inert && !$('list').classList.contains('is-agenda-updating')
      && Boolean($('list').querySelector('.ting-card'))),'a failed solve restores usable controls');
    assert.deepEqual(errors,[]);
    console.log('ok: failed solve releases buffer');

    const rich = await page.evaluate(({habits})=>{
      _optimizerHomeRenderError = null;
      save(normalize(habits));
      setDoingNow('reading',Date.now()-300000,dayStart(Date.now()),{
        completionMode:'auto',sessionMinutes:30,targetAt:Date.now()+1500000
      });
      const data = load();
      render({__optimizedWeek:buildWeekAgenda(data,sortSettings,7)});
      adoptHomeAgendaReadyState(_homeRenderedWeek,data,true);
      const before = $('list').getBoundingClientRect().height;
      beginHomeAgendaUpdate();
      return {session:Boolean($('list').querySelector('.session-progress')),
        crown:Boolean($('list').querySelector('.breakable-crown')),
        tracks:$('list').querySelectorAll('.agenda-skeleton-part[data-part="progress"]').length,
        delta:$('list').getBoundingClientRect().height-before};
    },{habits:[
      baseHabit({hid:'reading',name:'Read a chapter and write a few notes',target:1,
        emoji:'📖',durationMinutes:30,createdAt:now-86400000}),
      baseHabit({hid:'report',name:'Work on the report',target:1,emoji:'📝',
        durationMinutes:90,breakable:true,minChunkMinutes:15,createdAt:now-86400000})
    ]});
    assert(rich.session && rich.crown && rich.tracks >= 3 && Math.abs(rich.delta)<1,
      'timer labels, progress tracks, crown controls and wrapped titles retain their card geometry');
    await page.waitForTimeout(220);
    await page.screenshot({path:`test-results/home-buffer-rich-${layout}.png`,animations:'disabled'});
    await page.evaluate(()=>finishHomeAgendaUpdate());
    assert(await page.evaluate(()=>Boolean(_homeAgendaReveal) && $('list').inert),
      'a rich card also reveals under a protected crossfade');
    const deferred = await page.evaluate(()=>{
      const row = $('list').querySelector('.swipe-row');
      sortSettings.showCueOnCards = false;
      renderHomePresentationOnly();renderHomePresentationOnly();
      return row === $('list').querySelector('.swipe-row') && $('list').inert;
    });
    assert(deferred,'presentation changes coalesce while the incoming list is still covered');
    await settle();
    assert.equal(await page.locator('#list .ting-cue').count(),0,
      'a presentation change requested during the fade is applied when it completes');
    await page.evaluate(()=>{beginHomeAgendaUpdate();finishHomeAgendaUpdate();});
    await page.evaluate(()=>beginHomeAgendaUpdate());
    assert(await page.evaluate(()=>!_homeAgendaReveal && $('list').inert
      && !document.querySelector('.home-agenda-transition')),
      'an update arriving during a reveal retires the old layer and keeps controls covered');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{finishHomeAgendaUpdate();clearDoingNow('reading');});
    assert(await page.evaluate(()=>!_homeAgendaReveal && !$('list').inert
      && !document.querySelector('.home-agenda-transition,.agenda-skeleton-face')),
      'reduced motion restores the complete card immediately without a transitional layer');
    console.log('ok: rich cards, superseded crossfades and reduced motion');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(({habits})=>{
      buildWeekAgendaOffMain = window.bufferPlanner;
      save(normalize(habits));
      const data = load();
      render({__optimizedWeek:buildWeekAgenda(data,sortSettings,7)});
      adoptHomeAgendaReadyState(_homeRenderedWeek,data,true);
    },{habits:[baseHabit({hid:'last-task',name:'Last task',type:'task',dueDate:now,createdAt:now-86400000})]});
    const lastButton = page.locator('#list [data-pulse="0"]').first();
    if(layout === 'mobile')await lastButton.tap();
    else await lastButton.click();
    await page.evaluate(()=>window.finishBufferSolve());
    await page.waitForFunction(()=>$('list').classList.contains('is-agenda-revealing'));
    assert(await page.evaluate(()=>$('empty').textContent.includes('all clear') && $('empty').inert
      && getComputedStyle($('empty')).animationName === 'home-agenda-reveal'),
      'completing the final task reveals the empty state within the same protected transition');
    await settle();
    assert(await page.evaluate(()=>!$('empty').inert && !$('home-week-plan').inert && !$('list').inert),
      'all home content becomes usable when the transition finishes');
    assert.deepEqual(errors,[]);
    console.log('ok: actual final-item tap transitions into the empty state');

    for(const minimal of [true,false]){
      await page.evaluate(({habits,minimal})=>{
        sortSettings = {...sortSettings,minimalMode:minimal};
        save(normalize(habits));
        const data = load();
        render({__optimizedWeek:buildWeekAgenda(data,sortSettings,7)});
        adoptHomeAgendaReadyState(_homeRenderedWeek,data,true);
      },{minimal,habits:Array.from({length:16},(_,i)=>baseHabit({hid:`header-${i}`,
        name:`Header check ${i}`,type:'task',durationMinutes:10,dueDate:now,createdAt:now-86400000}))});
      for(const sticky of [false,true]){
        const heading = await page.evaluate(sticky=>{
          const pane = $('list').closest('.pane-list');
          if(document.body.dataset.paneCount === '1')window.scrollTo({top:sticky ? 260 : 0,behavior:'instant'});
          else pane.scrollTop = sticky ? 260 : 0;
          updateStuckSectionHeaders();
          const measure = el=>{
            const range = document.createRange();range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
          };
          const before = measure($('list').querySelector('.section-header-label'));
          beginHomeAgendaUpdate();finishHomeAgendaUpdate();
          const copy = measure(document.querySelector('.home-agenda-transition-heading .section-header-label'));
          return {before,copy};
        },sticky);
        for(const property of ['x','y','width','height']){
          assert(Math.abs(heading.before[property]-heading.copy[property])<0.02,
            `${minimal ? 'minimal' : 'full'} ${sticky ? 'sticky' : 'unscrolled'} day label keeps its actual text ${property} during the fade`);
        }
        await page.evaluate(()=>_homeAgendaRevealPromise);
      }
    }
    assert.deepEqual(errors,[]);
    console.log('ok: day-header text stays aligned in minimal/full and sticky/unscrolled layouts');
    await page.close();
    console.log(`ok: ${layout} update flow`);
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
