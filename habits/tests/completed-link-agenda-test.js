// Logs beat plans in the agenda, and finishing one step of an order link must
// not erase the rest of the chain. Runs every scenario on both planner paths.
// HABITS_URL=http://127.0.0.1:4182/ node tests/completed-link-agenda-test.js

const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4182/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';
let pass = 0;
let fail = 0;
function assert(value,message){
  if(value){ pass += 1; console.log('  ok: ' + message); }
  else { fail += 1; console.error('  not ok: ' + message); }
}

async function runScenarios(page,useGlpk){
  return page.evaluate(async(useGlpk)=>{
    localStorage.removeItem('tings_order_constraints_v1');
    const base = dayStart(Date.now());
    const now = base + 9 * 3600000;        // it is 09:00 today
    const morning = base + 6 * 3600000;    // ...and this happened at 06:00

    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:useGlpk,
      availabilityMinutes:Array(7).fill(300),
      availabilityOverrides:{},
      blockedTimes:[],
      locations:[],
      travel:{},
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showScheduledTasksInAgenda:true,
      showPlannedItemsInAgenda:true
    };
    for(let offset = 0;offset < 7;offset += 1){
      settings.availabilityOverrides[dateKey(base + offset * 86400000)] = 300;
    }
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);

    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;

    const todayFills = async()=>{
      const week = useGlpk
        ? await buildWeekAgendaAsync(load(),loadSortSettings(),3)
        : buildWeekAgenda(load(),loadSortSettings(),3);
      const day = week.days[0];
      return ((day && day.timeline) || [])
        .filter(row=>row.kind === 'fill' || row.kind === 'scheduled')
        .map(row=>row.h && row.h.hid);
    };
    const logAt = (hid,ts)=>{
      const data = load();
      const h = data.find(item=>item.hid === hid);
      h.logs = normalizeLogs([...(h.logs || []),makeActualLog(ts)]);
      h.lastLog = latestActualLog(h.logs);
      save(data);
    };

    const result = {};
    try{
      // ── Anchor first, follow-up second: finish the anchor early ───────
      const chain = (adjacency)=>[
        {
          hid:'shower',name:'Shower',type:'keepup',target:2,
          logs:[base - 5 * 86400000],
          durationMinutes:15,priority:1,flexibilityDays:0
        },
        {
          hid:'exercise',name:'Exercise',type:'keepup',target:2,
          logs:[base - 5 * 86400000],
          durationMinutes:30,priority:1,flexibilityDays:0,
          scheduleLinks:[
            {anchorHid:'shower',direction:'after',adjacency,requireSameDay:true}
          ]
        }
      ];
      save(chain('direct'));
      result.chainBefore = await todayFills();
      logAt('shower',morning);
      result.chainAfterDirect = await todayFills();

      save(chain('sometime'));
      logAt('shower',morning);
      result.chainAfterSometime = await todayFills();

      // ── Same link, but the *later* habit gets done first ──────────────
      const reverse = (adjacency)=>[
        {
          hid:'shower',name:'Shower',type:'keepup',target:2,
          logs:[base - 5 * 86400000],
          durationMinutes:15,priority:1,flexibilityDays:0,
          scheduleLinks:[
            {anchorHid:'exercise',direction:'before',adjacency,requireSameDay:true}
          ]
        },
        {
          hid:'exercise',name:'Exercise',type:'keepup',target:2,
          logs:[base - 5 * 86400000],
          durationMinutes:30,priority:1,flexibilityDays:0
        }
      ];
      save(reverse('sometime'));
      logAt('exercise',morning);
      result.reverseSometime = await todayFills();

      save(reverse('direct'));
      logAt('exercise',morning);
      result.reverseDirect = await todayFills();

      // ── The done habit is the subject that pulled its anchor onto today ─
      save([
        {
          hid:'shower',name:'Shower',type:'keepup',target:2,
          logs:[base - 5 * 86400000],
          durationMinutes:15,priority:1,flexibilityDays:0,
          scheduleLinks:[
            {anchorHid:'exercise',direction:'after',adjacency:'sometime',requireSameDay:true}
          ]
        },
        {
          hid:'exercise',name:'Exercise',type:'keepup',target:7,
          logs:[base - 6 * 86400000],
          durationMinutes:30,priority:1,flexibilityDays:1
        }
      ]);
      result.pullBefore = await todayFills();
      logAt('shower',morning);
      result.pullAfter = await todayFills();

      // ── Logged habit that still carries plan entries for today ────────
      save([{
        hid:'bath',name:'Bath',type:'keepup',target:7,
        logs:[
          base - 5 * 86400000,
          {ts:base + 10 * 3600000,plan:true},
          {ts:base + 18 * 3600000,plan:true}
        ],
        durationMinutes:20,priority:1,flexibilityDays:0
      }]);
      result.planBefore = await todayFills();
      logAt('bath',morning);
      result.planAfter = await todayFills();
      result.planLeftover = plannedLogs(load().find(h=>h.hid === 'bath').logs).length;

      // ── A partly-done breakable keeps the rest of its budget ──────────
      save([{
        hid:'study',name:'Study',type:'keepup',target:1,
        logs:[base - 86400000],
        durationMinutes:120,minChunkMinutes:30,breakable:true,
        priority:1,flexibilityDays:0
      }]);
      logAt('study',morning);
      const study = load().find(h=>h.hid === 'study');
      study.logs = normalizeLogs(study.logs.map(log=>
        logTime(log) === morning ? {ts:morning,minutes:30} : log
      ));
      save([study]);
      result.breakableAfterChunk = await todayFills();
    }finally{
      globalThis.Date = originalDate;
    }
    return result;
  },useGlpk);
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#open-add');

  for(const useGlpk of FAST_ONLY ? [false] : [false,true]){
    const label = useGlpk ? 'GLPK' : 'Fast';
    console.log(`\n[${label}] completed work vs order links`);
    const out = await runScenarios(page,useGlpk);

    assert(out.chainBefore.includes('shower') && out.chainBefore.includes('exercise'),
      `${label}: both steps of the chain are planned to begin with`);
    assert(!out.chainAfterDirect.includes('shower'),
      `${label}: the finished anchor leaves the agenda`);
    assert(out.chainAfterDirect.includes('exercise'),
      `${label}: a right-after follow-up survives its anchor being logged`);
    assert(out.chainAfterSometime.includes('exercise'),
      `${label}: a same-day follow-up survives its anchor being logged`);

    assert(out.reverseSometime.includes('shower'),
      `${label}: a "sometime before" step survives its anchor being done first`);
    // "Right before X" expires once X is over, so this one is still dropped.
    assert(!out.reverseDirect.includes('shower'),
      `${label}: a "right before" step is omitted once its anchor is done`);

    assert(out.pullBefore.includes('shower') && out.pullBefore.includes('exercise'),
      `${label}: a subject pulls its anchor onto today`);
    assert(out.pullAfter.includes('exercise'),
      `${label}: the pulled anchor stays after the subject is logged`);

    assert(out.planBefore.includes('bath'),
      `${label}: a planned habit is on the agenda`);
    assert(out.planLeftover > 0,
      `${label}: the habit still carries a plan entry for today`);
    assert(!out.planAfter.includes('bath'),
      `${label}: a logged habit leaves the agenda despite leftover plan entries`);

    assert(out.breakableAfterChunk.includes('study'),
      `${label}: a partly-done breakable keeps the rest of its budget`);
  }

  for(const error of errors)console.error('  pageerror: ' + error);
  await browser.close();
  console.log(`\n# ${pass} ok, ${fail} not ok`);
  process.exit(fail || errors.length ? 1 : 0);
})();
