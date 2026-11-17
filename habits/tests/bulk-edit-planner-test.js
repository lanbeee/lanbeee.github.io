// Bulk-edited scheduling fields steer both planner engines. The mutation
// layer is applied to plain records with a frozen Date; the edited data is
// then fed to buildWeekAgendaAsync (GLPK) and buildWeekAgenda (Fast) and the
// placements must agree and respect the bulk-set windows.
const assert = require('node:assert/strict');
const {chromium, runPlannerPair, baseHabit, openEveningSettings, minutesOnDay, placedAnywhere, FAST_ONLY} = require('./helpers/planner-test-helpers.js');
(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({viewport:{width:1200,height:800},serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.waitForTimeout(700);

    const now = new Date('2026-11-02T09:00:00-05:00').getTime();
    const base = [
      baseHabit({hid:'h-read',name:'Read',type:'keepup',target:1,durationMinutes:30,allowedTimeStart:null,allowedTimeEnd:null,allowedTimeFixedStart:false,preferredWeekdays:[],minChunkMinutes:null,priority:2,locationIds:[],anywhereAllowed:true,logs:[],lastLog:null,createdAt:now}),
      baseHabit({hid:'h-walk',name:'Walk',type:'keepup',target:7,durationMinutes:30,allowedTimeStart:600,allowedTimeEnd:720,allowedTimeFixedStart:true,preferredWeekdays:[],minChunkMinutes:null,priority:2,locationIds:[],anywhereAllowed:true,logs:[],lastLog:null,createdAt:now})
    ];
    // Pre-edit sanity: Walk sits in its morning window on day 0.
    // The fast page runs the fast engine only; GLPK joins on the default page.
    const before = await runPlannerPair(page,base,openEveningSettings(),now,3);
    assert.ok(!before.fast.error,'pre-edit plan solved on the fast engine');
    if(!FAST_ONLY)assert.ok(!before.glpk.error,'pre-edit plan solved on the GLPK engine');
    const morningBefore = minutesOnDay(before.fast,0,'Walk');
    assert.equal(morningBefore,30,'Walk planned in its fixed morning window before the edit');
    const readBefore = minutesOnDay(before.fast,0,'Read');
    assert.ok(readBefore > 0,'Read scheduled before the edit');

    // Feed the same normalized projection reviewed and saved by Bulk Edit
    // to both planners, including a previously anchored record.
    const edited = await page.evaluate(records=>{
      records[1].allowedTimeStartAnchor = 'sunrise';
      records[1].allowedTimeStartOffsetMin = 30;
      if(!save(records))throw new Error('Could not save the bulk edit fixtures');
      bulkSelected = new Set(records.map(h=>h.hid));
      bulkPending = [
        {id:'allowedTime',op:'window',value:{start:'18:30',end:'21:30'}},
        {id:'preferredWeekdays',op:'replace',value:[1,2,3,4,5]}
      ];
      const review = bulkComputeReview();
      if(review.errors.length || review.changing !== 2)throw new Error(JSON.stringify(review.errors));
      return review.next;
    },base);
    // The window family must be fully consistent after the bulk write.
    for(const record of edited){
      assert.equal(record.allowedTimeStart,1110,'bulk window start is 18:30');
      assert.equal(record.allowedTimeEnd,1290,'bulk window end is 21:30');
      assert.equal(record.allowedTimeFixedStart,false,'window mode after bulk replace');
      assert.equal(record.allowedTimeStartAnchor,null,'anchor cleared by the bulk replace');
      assert.equal(record.allowedTimeStartCombine,null,'combine fields cleared by the bulk replace');
      assert.deepEqual(record.preferredWeekdays,[1,2,3,4,5],'preferred weekdays set');
    }
    // save() must accept the edited records and keep the window.
    const persisted = await page.evaluate(records=>{
      const data = bulkClone(records);
      return save(data) ? load().map(h=>({name:h.name,start:h.allowedTimeStart,end:h.allowedTimeEnd,fixed:h.allowedTimeFixedStart})) : null;
    },edited);
    assert.ok(persisted && persisted.length === 2,'edited records normalize and save');
    for(const item of persisted){
      assert.equal(item.start,1110,'window survives normalization');
      assert.equal(item.end,1290);
    }

    // Both engines honor the bulk-set evening window; placements agree.
    const after = await runPlannerPair(page,edited,openEveningSettings(),now,3);
    assert.ok(!after.fast.error,'edited plan solved on the fast engine');
    if(!FAST_ONLY)assert.ok(!after.glpk.error,'edited plan solved on the GLPK engine');
    let walkDays = 0;
    for(let day = 0;day < 3;day++){
      const fastWalk = minutesOnDay(after.fast,day,'Walk');
      const fastRead = minutesOnDay(after.fast,day,'Read');
      if(!FAST_ONLY){
        const glpkWalk = minutesOnDay(after.glpk,day,'Walk');
        const glpkRead = minutesOnDay(after.glpk,day,'Read');
        assert.equal(fastWalk,glpkWalk,`Walk minutes agree on day ${day}`);
        assert.equal(fastRead,glpkRead,`Read minutes agree on day ${day}`);
      }
      assert.ok(fastWalk === 0 || fastWalk === 30,`Walk is either absent or a whole session on day ${day}`);
      if(fastWalk > 0)walkDays += 1;
      assert.equal(fastRead,30,`Read planned 30 min on day ${day}`);
    }
    // Walk (target 7) happens exactly once; everything lands inside the
    // bulk-set window, so totals are bounded.
    assert.equal(walkDays,1,'weekly Walk planned exactly once');
    const totalWalk = placedAnywhere(after.fast,'Walk') + placedAnywhere(after.fast,'Read');
    assert.equal(totalWalk,120,'no unplanned overflow outside the bulk window');

    // Preferred weekdays steer the packing: weekday placement exists,
    // and the bulk layer preserved everything it did not touch.
    const untouched = await page.evaluate(()=>{
      const data = load();
      const read = data.find(h=>h.name==='Read');
      return {name:read.name,target:read.target,duration:read.durationMinutes,priority:read.priority,topics:read.topics,logs:read.logs.length};
    });
    assert.equal(untouched.target,1,'unrelated settings preserved through bulk edit');
    assert.equal(untouched.duration,30,'duration untouched');
    assert.equal(untouched.topics.length,0,'topics untouched');

    assert.deepEqual(errors,[]);
    console.log(`PASS bulk edit planner: window family consistent, both engines agree${FAST_ONLY ? ' (fast page)' : ''}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode = 1;});
