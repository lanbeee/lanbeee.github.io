// Retained home plans must follow habit IDs through deletion, undo, and reorder
// without giving another item the removed row's automatic completion clock.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,plannerSettings,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE,{waitUntil:'networkidle'});
    const legacy = await page.evaluate(()=>{
      const raw = [{name:'Legacy habit',type:'keepup',logs:[123],custom:'retained'},{hid:'existing-id',name:'Existing habit'}];
      Storage.write(KEY,raw);
      const before = plannerDataRevision();
      const first = load().map(h=>h.hid);
      const migratedRevision = plannerDataRevision();
      const second = load().map(h=>h.hid);
      const stored = Storage.read(KEY);
      const {hid,...originalFields} = stored[0];
      return {first,second,hid,raw,originalFields,existing:stored[1],migrated:migratedRevision > before,stableRevision:plannerDataRevision() === migratedRevision};
    });
    assert.deepEqual(legacy.first,legacy.second,'legacy habit IDs remain stable across loads');
    assert.ok(legacy.hid,'the legacy ID is persisted');
    assert.deepEqual(legacy.originalFields,legacy.raw[0],'ID migration preserves all other raw fields');
    assert.deepEqual(legacy.existing,legacy.raw[1],'existing IDs and records stay intact');
    assert.ok(legacy.migrated && legacy.stableRevision,'migration invalidates old planner caches once');
    const glpkOk = await glpkAvailable(page);
    if(!glpkOk)console.log('SKIP: GLPK unavailable; retaining Fast identity coverage');
    for(const exact of glpkOk ? [false,true] : [false]){
      const result = await page.evaluate(async({exact,habits,settings})=>{
        const RealDate = Date;
        let now = new RealDate(2026,6,22,8).getTime();
        class FrozenDate extends RealDate{
          constructor(...args){super(...(args.length ? args : [now]));}
          static now(){return now;}
        }
        globalThis.Date = FrozenDate;
        const originalBuild = buildWeekAgendaOffMain;
        const originalCache = cachedHomeAgenda;
        try{
          cancelAgendaPlannerWorkerRequests('identity regression setup');
          _optimizerHomeRequestToken += 1;
          _optimizerHomeRequestKey = '';
          _optimizerHomeReadyKey = '';
          _optimizerHomeReadyWeek = null;
          _optimizerHomeReadyDirtyKey = '';
          sortSettings = {...sortSettings,...settings,agendaOptimizer:exact};
          saveSortSettings(sortSettings);
          habits.forEach(h=>{h.dueDate = now;});
          habits[0].eventTime = now + 60 * 60000;
          save(habits);
          saveAutoChunkPlans({groups:{}});
          const build = data=>exact ? buildWeekAgendaAsync(data,sortSettings,1) : buildWeekAgenda(data,sortSettings,1);
          const week = await build(load());
          render({__fromOptimizer:true,__optimizedWeek:week});
          const rows = ()=>_homeRenderedWeek.days[0].timeline.filter(row=>row.i != null);
          const kept = rows().find(row=>row.h?.hid === 'identity-work');
          const removed = rows().find(row=>row.h?.hid === 'identity-appointment');
          if(!kept || !removed)throw new Error('identity fixture was not placed');
          const expected = {start:kept.start,end:kept.end};
          now = new RealDate(2026,6,22,9,15).getTime();
          // Hold the foreground worker so assertions inspect the retained
          // agenda during the deletion's pending solve, including deduped paint.
          buildWeekAgendaOffMain = ()=>new Promise(()=>{});
          cachedHomeAgenda = ()=>null;
          doNuke(0);
          render();
          renderHomePresentationOnly();
          const afterDelete = rows().map(row=>({hid:row.h?.hid,i:row.i,start:row.start,end:row.end}));
          const chunks = loadAutoChunkPlans().groups['task:identity-work']?.rows || [];
          const agendaIndices = _homeRenderedWeek.days[0].agendaItems.map(row=>row.i);
          const cardIndex = document.querySelector('#list .swipe-row[data-hid="identity-work"] .ting-card')?.dataset.real;
          const fresh = await build(load());
          syncAutoMarkChunkPlans(load(),fresh);
          const refreshedChunks = loadAutoChunkPlans().groups['task:identity-work']?.rows || [];
          sweepAutoMarkedBreakableChunks(removed.end,{feedback:false});
          const prematureMinutes = breakableProgressMinutes(load()[0],dayStart(now));
          executeUndo();
          const afterUndo = rows().map(row=>({hid:row.h?.hid,i:row.i,start:row.start,end:row.end}));
          const restored = load();
          save([restored[1],restored[0]]);
          render();
          const afterReorder = rows().map(row=>({hid:row.h?.hid,i:row.i,start:row.start,end:row.end}));
          const replacement = load();
          replacement[0].hid = 'identity-replacement';
          save(replacement);
          render();
          render();
          renderHomePresentationOnly();
          const replacementChunks = loadAutoChunkPlans().groups['task:identity-replacement']?.rows || [];
          const replacedRows = rows().map(row=>row.h?.hid);
          return {expected,afterDelete,chunks,agendaIndices,cardIndex,refreshedChunks,prematureMinutes,afterUndo,afterReorder,replacementChunks,replacedRows};
        }finally{
          buildWeekAgendaOffMain = originalBuild;
          cachedHomeAgenda = originalCache;
          _optimizerHomeRequestToken += 1;
          _optimizerHomeRequestKey = '';
          globalThis.Date = RealDate;
        }
      },{
        exact,
        habits:[
          baseHabit({hid:'identity-appointment',name:'Appointment',type:'task',durationMinutes:30}),
          baseHabit({hid:'identity-work',name:'Work',type:'task',durationMinutes:90,breakable:true,autoMarkMinutes:0,allowedTimeStart:570,allowedTimeEnd:660})
        ],
        settings:plannerSettings([])
      });
      const expectedRow = {hid:'identity-work',i:0,...result.expected};
      assert.deepEqual(result.afterDelete,[expectedRow],'deletion drops the removed row and retains the survivor clocks');
      assert.deepEqual(result.agendaIndices,[0],'agenda items use the survivor index too');
      assert.equal(result.cardIndex,'0','the retained card acts on the survivor');
      for(const chunks of [result.chunks,result.refreshedChunks]){
        assert.deepEqual(chunks.map(({start,end})=>({start,end})),[result.expected],'automatic logs retain only the survivor clocks');
      }
      assert.equal(result.prematureMinutes,0,'the removed appointment end cannot credit the survivor');
      assert.deepEqual(result.afterUndo,[{...expectedRow,i:1}],'undo restores the survivor index without assigning another clock');
      assert.deepEqual(result.afterReorder,[expectedRow],'reordering preserves habit identity and clocks');
      assert.deepEqual(result.replacementChunks,[],'a replacement with the same card face cannot inherit automatic log clocks');
      assert.deepEqual(result.replacedRows,[],'the removed identity leaves the retained agenda');
      console.log(`PASS: ${exact ? 'GLPK' : 'Fast'} retained agenda identities and automatic logs`);
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
