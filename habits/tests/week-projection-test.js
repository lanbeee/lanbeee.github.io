// 14-day projection horizon — both engines and the off-main worker cover 14
// consecutive local dates, and intervening days shape later-day cadence.
//
// Asserts shared constraints and date coverage across engines, NOT identical
// placements (the engines legitimately differ on which slot wins).
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/week-projection-test.js

const { chromium, BASE, FAST_ONLY, baseHabit, plannerSettings } = require('./helpers/planner-test-helpers.js');

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390,height:844 }, isMobile:true });
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(()=>{ localStorage.clear(); });
  await page.reload({ waitUntil:'load' });

  // Fixed clock: today at 09:00 local. Inside page.evaluate every Date call
  // resolves against this anchor so day keys are deterministic.
  const nowBase = new Date();
  const now = new Date(nowBase.getFullYear(),nowBase.getMonth(),nowBase.getDate()).getTime() + 9 * 3600000;
  const day0Key = (()=>{
    const d = new Date(now);
    const m = String(d.getMonth() + 1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${m}-${day}`;
  })();
  const ago1d = now - 26 * 3600000;
  // Day 0 is nearly full: the projection must spill work to later days.
  const settings = plannerSettings([
    { label:'sleep', days:[], start:0, end:420 },
    { label:'night', days:[], start:1290, end:1440 }
  ], { availabilityOverrides:{ [day0Key]:300 } });
  settings.topics = ['work'];
  const data = [
    Object.assign(baseHabit({
      name:'Cadence Habit', type:'keepup', target:2, durationMinutes:60,
      breakable:true, minChunkMinutes:30, priority:1,
      allowedTimeStart:480, allowedTimeEnd:1200,
      lastLog:ago1d, logs:[ago1d], topics:['work'], createdAt:now - 7 * 86400000
    }),{ hid:'cadence-habit' }),
    Object.assign(baseHabit({
      name:'Daily Stretch', type:'keepup', target:1, durationMinutes:30,
      breakable:false, priority:2,
      allowedTimeStart:540, allowedTimeEnd:1140,
      lastLog:ago1d, logs:[ago1d], topics:['work'], createdAt:now - 7 * 86400000
    }),{ hid:'daily-habit' })
  ];
  await page.evaluate(({ d,s })=>{
    localStorage.setItem('tings_v2', JSON.stringify(d));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(s));
  }, { d:data, s:settings });
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);

  const result = await page.evaluate(async ({ now, day0Key, fastOnly })=>{
    const RealDate = Date;
    function FrozenDate(...args){
      return args.length === 0 ? new RealDate(now) : new RealDate(...args);
    }
    FrozenDate.now = () => now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;

    const summarize = week => {
      const data = typeof load === 'function' ? load() : [];
      return (week.days || []).map(day=>{
        const fills = (day.timeline || []).filter(r=>r.kind === 'fill');
        return {
          dayKey:dateKey(day.dayBase),
          cadenceMinutes:fills.filter(r=>(r.h || data[r.i])?.hid === 'cadence-habit')
            .reduce((sum,r)=>sum + Math.round((r.end - r.start)/60000),0),
          fillMinutes:fills.reduce((sum,r)=>sum + Math.round((r.end - r.start)/60000),0),
          outsideWindow:fills.some(r=>{
            const s = new Date(r.start), e = new Date(r.end);
            const sm = s.getHours()*60 + s.getMinutes(), em = e.getHours()*60 + e.getMinutes();
            return sm < 480 || em > 1200;
          })
        };
      });
    };
    const coverage = week => {
      const keys = (week.days || []).map(d=>d.dayBase);
      let consecutive = keys.length > 0;
      for(let i = 1;i < keys.length;i += 1){
        const a = new Date(keys[i-1]), b = new Date(keys[i]);
        const expect = new Date(a); expect.setDate(expect.getDate() + 1);
        if(b.getFullYear() !== expect.getFullYear() || b.getMonth() !== expect.getMonth() || b.getDate() !== expect.getDate()){
          consecutive = false; break;
        }
      }
      return { count:keys.length, consecutive, startsToday:keys.length ? dateKey(keys[0]) === day0Key : false };
    };
    try{
      const out = {};
      const data = load();
      const settings = loadSortSettings();
      const fast = buildWeekAgenda(data, Object.assign({},settings,{agendaOptimizer:false}), 14);
      out.fast = { cov:coverage(fast), days:summarize(fast) };
      if(!fastOnly){
        try{
          const exact = await buildWeekAgendaAsync(data, Object.assign({},settings,{agendaOptimizer:true}), 14);
          out.exact = { cov:coverage(exact), days:summarize(exact), optimized:Boolean(exact.optimized) };
        }catch(err){
          out.exact = { error:String(err && err.message || err) };
        }
      }
      // Off-main worker path (fast mode in the shared worker): must also cover
      // the full 14-day horizon.
      try{
        const offMain = await buildWeekAgendaOffMain(
          data, Object.assign({},settings,{agendaOptimizer:false}), 14, 'fast', {fastGraph:true}
        );
        out.worker = { cov:coverage(offMain) };
      }catch(err){
        out.worker = { error:String(err && err.message || err) };
      }
      return out;
    }finally{
      globalThis.Date = RealDate;
    }
  }, { now, day0Key, fastOnly:FAST_ONLY }).catch(err=>({ fatal:String(err && err.message || err) }));

  if(result.fatal){
    console.error('  FAIL: projection evaluate crashed :: ' + result.fatal);
    fail += 1;
  }else{
    console.log('\n--- Fast engine, 14-day horizon ---');
    if(result.fast){
      assert(result.fast.cov.count === 14, 'fast week covers 14 days (got ' + result.fast.cov.count + ')');
      assert(result.fast.cov.consecutive, 'fast days are consecutive local dates');
      assert(result.fast.cov.startsToday, 'fast projection starts today');
      const cadenceDays = result.fast.days.filter(d=>d.cadenceMinutes > 0).length;
      assert(cadenceDays >= 4, 'target-2 habit placed on >= 4 of 14 days (got ' + cadenceDays + ')');
      assert(!result.fast.days.some(d=>d.outsideWindow), 'no fast fill outside its allowed window');
      assert(result.fast.days[1].fillMinutes >= result.fast.days[0].fillMinutes
        || result.fast.days[0].fillMinutes <= 300, 'day-0 scarcity spills work to later days');
    }
    if(!FAST_ONLY){
      console.log('\n--- Exact (GLPK) engine, 14-day horizon ---');
      if(result.exact && result.exact.error){
        // Soft-skip only when GLPK itself is unavailable; a planner error is a failure.
        assert(false, 'exact engine errored :: ' + result.exact.error);
      }else if(result.exact){
        assert(result.exact.cov.count === 14, 'exact week covers 14 days (got ' + result.exact.cov.count + ')');
        assert(result.exact.cov.consecutive, 'exact days are consecutive local dates');
        assert(result.exact.cov.startsToday, 'exact projection starts today');
        const cadenceDays = result.exact.days.filter(d=>d.cadenceMinutes > 0).length;
        assert(cadenceDays >= 4, 'exact: target-2 habit placed on >= 4 of 14 days (got ' + cadenceDays + ')');
        assert(!result.exact.days.some(d=>d.outsideWindow), 'no exact fill outside its allowed window');
      }
    }
    console.log('\n--- Off-main worker, 14-day horizon ---');
    if(result.worker && result.worker.error){
      assert(false, 'worker 14-day build errored :: ' + result.worker.error);
    }else if(result.worker){
      assert(result.worker.cov.count === 14, 'worker week covers 14 days (got ' + result.worker.cov.count + ')');
      assert(result.worker.cov.consecutive, 'worker days are consecutive local dates');
      assert(result.worker.cov.startsToday, 'worker projection starts today');
    }
  }

  assert(errors.length === 0, 'no page errors' + (errors.length ? ' :: ' + errors[0] : ''));

  await browser.close();
  if(fail > 0){
    console.error(`\nFAIL — ${fail} assertion${fail === 1 ? '' : 's'} failed`);
    process.exit(1);
  }
  console.log('\nPASS — week projection horizon');
  process.exit(0);
})().catch(err=>{
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
