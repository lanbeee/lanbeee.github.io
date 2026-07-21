/**
 * Hidden day-capacity scorecard: selected-day math, triple-tap trigger, and
 * responsive overlay layout.
 *
 * Run:
 *   python3 -m http.server 4181
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/day-capacity-scorecard-e2e.js
 */

const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(condition,message){
  if(!condition)throw new Error(message);
}

function task(name,dueDate,priority = 1){
  return {
    name,type:'task',target:null,flexibilityDays:0,durationMinutes:60,
    breakable:false,minChunkMinutes:30,allowedTimeStart:null,allowedTimeEnd:null,
    preferredTimeStart:null,preferredTimeEnd:null,lastLog:null,logs:[],emoji:'',
    pinned:false,sample:false,snoozedUntil:null,topics:[],allowedWeekdays:[],
    allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],dueDate,
    eventTime:null,hardDue:false,markDone:true,createdAt:dueDate - 86400000,
    locationIds:[],priority
  };
}

(async()=>{
  const real = new Date();
  real.setHours(15,0,0,0);
  const clockTs = real.getTime();
  const todayBase = new Date(clockTs).setHours(0,0,0,0);
  const tomorrowBase = todayBase + 86400000;
  const data = [
    task('Today one',todayBase,0),
    task('Today two',todayBase,1),
    task('Today three',todayBase,2),
    task('Tomorrow one',tomorrowBase,0),
    task('Tomorrow two',tomorrowBase,1),
    task('Tomorrow three',tomorrowBase,2)
  ];
  const settings = {
    preset:'todayFirst',focus:'balanced',showWeekOnHome:true,
    availabilityMinutes:[90,90,90,90,90,90,90],availabilityOverrides:{},
    blockedTimes:[
      {label:'sleep',days:[],start:0,end:420},
      {label:'work',days:[],start:540,end:1020},
      {label:'dinner',days:[],start:1080,end:1140}
    ],
    showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
    showTaskDateOnCards:true,showPlansOnCards:true,showTimeWindowOnCards:true,
    agendaOptimizer:false,topics:[],locations:[],travel:{},defaultTravelMode:'driving'
  };

  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));
  page.on('console',message=>{ if(message.type() === 'error')errors.push(`console: ${message.text()}`); });
  await page.addInitScript(clock=>{
    if(navigator.serviceWorker){
      navigator.serviceWorker.register = ()=>Promise.resolve({update:()=>Promise.resolve()});
    }
    const RealDate = window.Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(clock); }
    FrozenDate.now = ()=>clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
  },clockTs);
  await page.goto(BASE,{waitUntil:'networkidle'});
  await page.evaluate(({data,settings})=>{
    localStorage.clear();
    localStorage.setItem('tings_v2',JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
  },{data,settings});
  await page.reload({waitUntil:'networkidle'});
  await page.waitForSelector('#list:not(.is-progressive)');
  await page.waitForSelector('#list .section-header[data-capacity-day]');

  const model = await page.evaluate(({todayBase,tomorrowBase})=>{
    const d = load();
    const s = sortSettings || loadSortSettings();
    const today = buildDayCapacityScorecard(d,s,todayBase,Date.now(),{weekMode:true});
    const tomorrow = buildDayCapacityScorecard(d,s,tomorrowBase,Date.now(),{weekMode:true});
    const auditState = createDayPlacementState({
      scheduled:[],totalMinutes:120,
      slots:[{start:Date.now() + 3600000,end:Date.now() + 3 * 3600000}],
      dayBase:todayBase,weekday:new Date(todayBase).getDay(),isToday:true
    },s,{dayBase:todayBase,now:Date.now()});
    const emptyAudit = buildPlacementDiagnostics([{h:d[0],i:0}],auditState);
    return {
      today:{
        total:today.totalCapacity,blocked:today.blockedMinutes,net:today.netAvailable,
        unplaced:today.unplacedItems.length,rows:today.agendaRows.length,
        missed:today.missedOpportunityCount,budgetCapped:today.budgetCappedGapCount,
        gapStatuses:today.placementGaps.map(gap=>gap.status)
      },
      tomorrow:{total:tomorrow.totalCapacity,blocked:tomorrow.blockedMinutes,net:tomorrow.netAvailable,unplaced:tomorrow.unplacedItems.length},
      syntheticMissed:emptyAudit.gapAudit.gaps.some(gap=>gap.feasibleCandidateIndices.includes(0))
    };
  },{todayBase,tomorrowBase});
  assert(model.today.total === 540,`Today clock capacity ${model.today.total}, expected 540`);
  assert(model.today.blocked === 180,`Today blocked ${model.today.blocked}, expected 180`);
  assert(model.today.net === 360,`Today net ${model.today.net}, expected 360`);
  assert(model.tomorrow.total === 1440,`Tomorrow clock capacity ${model.tomorrow.total}, expected 1440`);
  assert(model.tomorrow.blocked === 960,`Tomorrow blocked ${model.tomorrow.blocked}, expected 960`);
  assert(model.tomorrow.net === 480,`Tomorrow net ${model.tomorrow.net}, expected 480`);
  assert(model.today.unplaced > 0,'Today should expose at least one unplaced eligible item');
  assert(model.tomorrow.unplaced > 0,'Tomorrow should expose at least one unplaced eligible item');
  assert(model.today.rows > 0,'Scorecard should expose the actual agenda output rows');
  assert(model.today.missed === 0,`Budget-capped gaps must not be reported as scheduler misses: ${JSON.stringify(model.today)}`);
  assert(model.today.budgetCapped > 0 && model.today.gapStatuses.includes('budget-capped'),
    `Expected an obvious clock gap explained by the agenda budget: ${JSON.stringify(model.today)}`);
  assert(model.syntheticMissed,'Gap audit failed to flag an eligible item that still fits an empty final gap');

  async function tripleTap(selector){
    const header = page.locator(selector);
    await header.waitFor({state:'visible'});
    await header.tap();
    await header.tap();
    await header.tap();
    await page.waitForTimeout(100);
    const opened = await page.locator('#day-capacity-sheet').evaluate(el=>el.classList.contains('open'));
    if(!opened){
      const debug = await page.evaluate(()=>({
        title:document.querySelector('#day-capacity-title')?.textContent,
        content:document.querySelector('#day-capacity-content')?.textContent,
        builder:typeof buildDayCapacityScorecard,
        opener:typeof openDayCapacityScorecard
      }));
      throw new Error(`Triple tap did not open scorecard: ${JSON.stringify(debug)}\n${errors.join('\n')}`);
    }
    await page.waitForSelector('#day-capacity-sheet.open');
  }

  const todayKey = new Date(todayBase).toISOString().slice(0,10);
  const tomorrowKey = new Date(tomorrowBase).toISOString().slice(0,10);
  await tripleTap(`#list .section-header[data-capacity-day="${todayKey}"]`);
  assert(await page.locator('#day-capacity-title').textContent() === 'today agenda audit','Today overlay title mismatch');
  assert(await page.locator('#day-capacity-content').getByText('9h',{exact:true}).count() === 1,'Today overlay missing 9h capacity');
  assert(await page.locator('[data-capacity-gap-status="budget-capped"]').count() > 0,'Overlay did not explain the obvious unused gap');
  assert(await page.locator('.capacity-agenda-row').count() > 0,'Overlay did not render the agenda builder output');
  await page.screenshot({path:'/private/tmp/habits-day-capacity-mobile.png',fullPage:true});
  await page.locator('#day-capacity-close').click();

  await tripleTap(`#list .section-header[data-capacity-day="${tomorrowKey}"]`);
  assert(await page.locator('#day-capacity-content').getByText('24h',{exact:true}).count() === 1,'Tomorrow overlay must use the full day');
  assert(await page.locator('#day-capacity-sheet').getAttribute('data-day-key') === tomorrowKey,'Tomorrow overlay used the wrong date');
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'/private/tmp/habits-day-capacity-desktop.png',fullPage:true});
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1,`Scorecard caused ${overflow}px horizontal overflow`);
  assert(errors.length === 0,errors.join('\n'));

  await browser.close();
  console.log(`Day capacity scorecard passed: ${JSON.stringify(model)}`);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
