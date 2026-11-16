// Week calendar layout primitives — row normalization, overlap lanes,
// cross-midnight split, DST wall-clock positioning, marker dedup, and topic
// token stability. Exercises js/overview-week.js helpers directly.
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/week-view-layout-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390,height:844 }, isMobile:true, timezoneId:'America/New_York' });
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.goto(BASE, { waitUntil:'load' });

  const results = await page.evaluate(()=>{
    const out = { checks:[] };
    const check = (name,cond,detail)=>out.checks.push({name,cond: Boolean(cond),detail: detail || ''});
    try{
      const today = dayStart(Date.now());
      const dayKey = dateKey(today);
      const at = (base,minute)=>base + minute * 60000;

      // ── DST: wall-clock minutes, never raw ms-since-midnight ──
      // US spring-forward 2026-03-08 has no 02:00; 03:00 local is minute 180.
      check('DST spring: 03:00 local = minute 180',
        weekViewMinuteOfDay(new Date(2026,2,8,3,0).getTime()) === 180,
        String(weekViewMinuteOfDay(new Date(2026,2,8,3,0).getTime())));
      // US fall-back 2026-11-01 repeats 01:00–02:00; wall clock still maps 90.
      check('DST fall: 01:30 local = minute 90',
        weekViewMinuteOfDay(new Date(2026,10,1,1,30).getTime()) === 90,
        String(weekViewMinuteOfDay(new Date(2026,10,1,1,30).getTime())));

      // ── Rolling range uses local calendar arithmetic ──
      const range = weekViewRangeDays(0);
      check('range covers 7 days', range.length === 7, String(range.length));
      let consecutive = true;
      for(let i = 1;i < range.length;i += 1){
        const a = new Date(range[i-1].dayBase), b = new Date(range[i].dayBase);
        const expect = new Date(a); expect.setDate(expect.getDate() + 1);
        if(b.getDate() !== expect.getDate() || b.getMonth() !== expect.getMonth())consecutive = false;
      }
      check('range days are consecutive calendar days', consecutive);
      check('range starts today', range[0].dayKey === dateKey(Date.now()));

      // ── Cross-midnight split keeps bounds and identity ──
      const row = { start:at(today,23*60), end:at(today,24*60 + 90) }; // 23:00 → next-day 01:30
      const segs = weekViewDaySegments(row,today);
      check('cross-midnight row clamps to one day segment', segs.length === 1, String(segs.length));
      check('segment end clamps at midnight', segs[0] && segs[0].end === today + 86400000);
      const pastRow = { start:today - 3600000, end:today + 3600000 };
      const clamped = weekViewDaySegments(pastRow,today);
      check('earlier-day start clamps to day start', clamped[0] && clamped[0].start === today);

      // ── Lanes: overlap clusters, half-open intervals, determinism ──
      const mk = (id,top,bot)=>({id,topMin:top,botMin:bot});
      const lanes1 = weekViewAssignLanes([mk('a',540,600),mk('b',600,660)]);
      check('half-open: back-to-back events do not overlap',
        lanes1.every(r=>r.lanes === 1), lanes1.map(r=>r.lanes).join(','));
      const lanes2 = weekViewAssignLanes([mk('a',540,660),mk('b',600,720)]);
      check('overlapping events share a cluster with 2 lanes',
        lanes2.every(r=>r.lanes === 2), lanes2.map(r=>r.lanes).join(','));
      const lanes3 = weekViewAssignLanes([
        mk('c',540,600),mk('a',540,600),mk('b',660,720)
      ]);
      check('lane order deterministic by (start,id)',
        lanes3[0].id === 'a' && lanes3[1].id === 'c', lanes3.map(r=>r.id).join(','));
      const chain = weekViewAssignLanes([mk('a',540,660),mk('b',600,720),mk('c',700,780)]);
      check('chain cluster reports max concurrent lanes',
        chain.every(r=>r.lanes === 2) || chain.every(r=>r.lanes === 3), chain.map(r=>`${r.id}:${r.lanes}`).join(','));

      // A block expands through columns it does not actually collide with.
      const widen = weekViewAssignLanes([
        mk('c',540,560),mk('b',540,580),mk('a',540,700),mk('d',600,640)
      ]);
      const widened = widen.find(r=>r.id === 'd');
      check('event expands into a free neighboring column',
        widened && widened.lane === 0 && widened.span === 2 && widened.lanes === 3,
        widen.map(r=>`${r.id}:L${r.lane}/${r.lanes}x${r.span}`).join(','));
      const overlapped = widen.find(r=>r.id === 'c');
      check('a real overlap stays one column wide',
        overlapped && overlapped.span === 1, overlapped && String(overlapped.span));

      // Short blocks grow into empty space and stop at the next neighbor.
      const tight = [mk('a',540,550),mk('b',550,558)];
      weekViewAssignLanes(tight);
      weekViewFitVisualEnds(tight,[],16);
      const tightA = tight.find(r=>r.id === 'a');
      const tightB = tight.find(r=>r.id === 'b');
      check('back-to-back block does not paint over the next one',
        tightA && tightA.visBotMin === 550, tightA && String(tightA.visBotMin));
      check('a short block with room after it grows toward a readable height',
        tightB && tightB.visBotMin === 566, tightB && String(tightB.visBotMin));
      const gap = [mk('a',540,545)];
      weekViewAssignLanes(gap);
      weekViewFitVisualEnds(gap,[{topMin:550,botMin:560}],16);
      check('growth stops at the next travel gap',
        gap[0] && gap[0].visBotMin === 550, gap[0] && String(gap[0].visBotMin));
      const alone = [mk('a',540,545)];
      weekViewAssignLanes(alone);
      weekViewFitVisualEnds(alone,[],16);
      check('an isolated short block grows into the empty minutes after it',
        alone[0] && alone[0].visBotMin === 556, alone[0] && String(alone[0].visBotMin));

      // ── Topic tokens ──
      const tokens = ['teal','amber','red','purple','blue','green','pink','orange','indigo','cyan','lime','slate'];
      check('token catalog maps in order',
        tokens.every((t,i)=>weekViewTopicTokenMap({topics:tokens.slice(0,i + 1)}).get(tokens[i]) === t));
      const wrapped = weekViewTopicTokenMap({topics:[...tokens,'extra']}).get('extra');
      check('catalog wraps by its actual length', wrapped === 'teal', wrapped);
      const unknown = weekViewHashToken('ghost-topic');
      check('unknown topic hash is deterministic', weekViewHashToken('ghost-topic') === unknown);
      check('untopiced habit uses its emoji color',
        weekViewTokenFor({topics:[],emojiBgColor:'purple'},new Map()) === 'purple');
      check('untopiced without emoji color falls back to slate',
        weekViewTokenFor({topics:[]},new Map()) === 'slate');

      // ── weekCalendarRows: busy survival, filters, markers, unplaced, travel ──
      const settings = {
        preset:'todayFirst', locations:[], travel:{}, defaultTravelMode:'walking',
        availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],
        blockedTimes:[{label:'sleep',days:[],start:0,end:300},{label:'focus block',days:[],start:600,end:660}],
        topics:['work','health']
      };
      const hA = { hid:'a', name:'Alpha', type:'keepup', target:1, emoji:'🅰️', topics:['work'], durationMinutes:30, logs:[], lastLog:null, dueDate:null, eventTime:null, hardDue:false, planByDate:at(today,15*60) };
      const hB = { hid:'b', name:'Beta', type:'task', target:null, emoji:'🅱️', topics:[], durationMinutes:30, logs:[], lastLog:null, dueDate:at(today,12*60), eventTime:null, hardDue:false, planByDate:at(today,15*60) };
      const data = [hA,hB];
      const day = {
        dayBase:today, dayKey, isToday:false,
        timeline:[
          { kind:'fill', i:0, h:hA, start:at(today,540), end:at(today,570), occurrenceKey:'a1', chunkIndex:0, chunkMinutes:30, locationId:null, hard:false },
          { kind:'travel', from:'loc-1', to:'loc-2', fromName:'Home', toName:'Office', seconds:600, start:at(today,510), end:at(today,540), provider:'manual' }
        ],
        agendaItems:[{ h:hA },{ h:hB }]
      };
      const all = weekCalendarRows(day,data,settings,weekViewTopicTokenMap(settings),null);
      check('busy blocks survive normalization (homeDisplayedTimeline omits them)',
        all.busy.length === 2 && all.busy.some(b=>b.label === 'sleep') && all.busy.some(b=>b.label === 'focus block'),
        all.busy.map(b=>b.label).join(','));
      check('busy rows carry the original block row for the editor',
        all.busy.every(b=>b.row && b.row.blockSignature != null || b.row && b.row.label != null));
      check('placed habit row becomes an event with stable identity',
        all.events.length === 1 && all.events[0].hid === 'a' && all.events[0].id.startsWith('ev|a|'));
      check('travel leg kept when its destination row is visible',
        all.travel.length === 1 && all.travel[0].mins === 10, JSON.stringify(all.travel));
      check('due marker lands on the untimed strip, plan-by too, timed excluded',
        all.markers.length === 2 && all.markers.some(m=>m.kind === 'due') && all.markers.some(m=>m.kind === 'planBy'),
        all.markers.map(m=>m.kind).join(','));
      check('marker ids dedupe by (hid,kind,ts)',
        new Set(all.markers.map(m=>m.id)).size === all.markers.length);
      check('unplaced candidate (Beta) stays visible without invented times',
        all.unplaced.length === 1 && all.unplaced[0].hid === 'b' && all.unplaced[0].token != null);

      // Filter out hA: its event + travel vanish, busy stays.
      const filtered = weekCalendarRows(day,data,settings,weekViewTopicTokenMap(settings),new Set(['b']));
      check('filters drop hidden habit events', filtered.events.length === 0);
      check('filters drop travel whose destination row is hidden', filtered.travel.length === 0);
      check('filters keep busy time visible (capacity signal)', filtered.busy.length === 2);
      check('filtered row keeps hid identity (index resolved later from hid)',
        filtered.unplaced[0] && filtered.unplaced[0].hid === 'b');

      // Cross-midnight event renders segments per visible day (two-day pair).
      const lateTask = { hid:'late', name:'Late', type:'task', emoji:'', topics:[], durationMinutes:150, logs:[], lastLog:null, dueDate:null, eventTime:null, hardDue:false };
      const lateDay = {
        dayBase:today, dayKey, isToday:false,
        timeline:[{ kind:'scheduled', i:0, h:lateTask, start:at(today,23*60), end:at(today,26*60), hard:true, occurrenceKey:'l1', chunkIndex:0, locationId:null }],
        agendaItems:[]
      };
      const lateRows = weekCalendarRows(lateDay,[lateTask],settings,weekViewTopicTokenMap(settings),null);
      check('cross-midnight scheduled row clamps into its day column',
        lateRows.events.length === 1 && lateRows.events[0].botMin === 1440,
        lateRows.events.map(e=>`${e.topMin}-${e.botMin}`).join(','));

      // Active session replaces the matching planned row.
      const doingDay = {
        dayBase:today, dayKey, isToday:true,
        timeline:[{ kind:'fill', i:0, h:hA, start:at(today,540), end:at(today,570), occurrenceKey:'a2', chunkIndex:0, chunkMinutes:30, locationId:null, hard:false }],
        agendaItems:[]
      };
      const fakeNow = at(today,550);
      const RealNow = Date.now;
      const RealDoing = typeof getDoingNow === 'function' ? getDoingNow : null;
      Date.now = ()=>fakeNow;
      window.getDoingNow = ()=>({ hid:'a', startedAt:at(today,550), targetAt:at(today,610), sessionMinutes:60, dayBase:today });
      try{
        const activeRows = weekCalendarRows(doingDay,data,settings,weekViewTopicTokenMap(settings),null);
        const active = activeRows.events.find(ev=>ev.hid === 'a');
        check('active session marked distinctly, not duplicated',
          activeRows.events.filter(ev=>ev.hid === 'a').length === 1 && active && active.status === 'active');
      }finally{
        Date.now = RealNow;
        if(RealDoing)window.getDoingNow = RealDoing;
      }

      // ── Elastic list: readable height, compressed gaps, no painted overlap ──
      const seg = (id,kind,top,bot,mins)=>({id,kind,topMin:top,botMin:bot,mins});
      const chainLayout = weekViewElasticLayout([
        seg('a','habit',540,570), seg('b','habit',570,600)
      ], {scale:1.2});
      const chainHabits = chainLayout.items.filter(item=>item.type === 'habit');
      const chainSeam = chainLayout.items.find(item=>item.type === 'gap');
      check('back-to-back habits stay in one lane of time and do not overlap',
        chainHabits.length === 2 && chainHabits[1].y >= chainHabits[0].y + chainHabits[0].h - 0.01,
        chainHabits.map(item=>`${item.y}+${item.h}`).join(','));
      check('a zero-minute join is a 2px seam',
        chainSeam && chainSeam.kind === 'seam' && chainSeam.h === 2, chainSeam && `${chainSeam.kind}:${chainSeam.h}`);
      check('an hour of back-to-back work is labeled nonstop',
        chainLayout.chains.length === 1 && /nonstop/.test(chainLayout.chains[0].label || ''),
        chainLayout.chains.map(item=>item.label).join(','));
      check('a 30-minute habit uses the 52px minimum',
        chainHabits[0] && chainHabits[0].h === 52, chainHabits[0] && String(chainHabits[0].h));

      const longHabit = weekViewElasticLayout([seg('long','habit',540,660)], {scale:1.2});
      check('a two-hour habit grows with duration',
        longHabit.items[0] && longHabit.items[0].h === 144, longHabit.items[0] && String(longHabit.items[0].h));
      const sleep = weekViewElasticLayout([seg('sleep','busy',0,420)], {scale:1.2});
      check('a seven-hour busy block eases off instead of filling the screen',
        sleep.items[0] && sleep.items[0].h === 148, sleep.items[0] && String(sleep.items[0].h));

      const trip = weekViewElasticLayout([
        seg('a','habit',540,570),
        seg('t','travel',570,575,5),
        seg('b','habit',575,605)
      ], {scale:1.2});
      const tripLeg = trip.items.find(item=>item.type === 'travel');
      check('a five-minute trip is a 24px connector',
        tripLeg && tripLeg.tier === 'short' && tripLeg.h === 24, tripLeg && `${tripLeg.tier}:${tripLeg.h}`);
      check('travel between habits is not a nonstop chain', trip.chains.length === 0, String(trip.chains.length));
      const midTrip = weekViewElasticLayout([seg('t','travel',600,618,18)], {scale:1.2});
      check('an 18-minute trip is a 32px connector',
        midTrip.items[0] && midTrip.items[0].h === 32 && midTrip.items[0].tier === 'mid',
        midTrip.items[0] && `${midTrip.items[0].tier}:${midTrip.items[0].h}`);
      const longTrip = weekViewElasticLayout([seg('t','travel',600,640,40)], {scale:1.2});
      check('a trip longer than 30 minutes becomes a card',
        longTrip.items[0] && longTrip.items[0].tier === 'long' && longTrip.items[0].h >= 52,
        longTrip.items[0] && `${longTrip.items[0].tier}:${longTrip.items[0].h}`);

      const gapLayout = weekViewElasticLayout([
        seg('a','habit',540,570), seg('b','habit',750,780)
      ], {scale:1.2});
      const collapsed = gapLayout.items.find(item=>item.type === 'gap');
      check('a three-hour gap collapses to a 44px band',
        collapsed && collapsed.kind === 'collapsed' && collapsed.h === 44 && /free/.test(collapsed.label),
        collapsed && `${collapsed.kind}:${collapsed.h}:${collapsed.label}`);
      const opened = collapsed ? weekViewElasticLayout([
        seg('a','habit',540,570), seg('b','habit',750,780)
      ], {scale:1.2, openGaps:new Set([collapsed.id])}) : {items:[]};
      const openGap = collapsed && opened.items.find(item=>item.id === collapsed.id);
      check('opening a long gap restores true scale',
        openGap && openGap.kind === 'open' && openGap.h >= 200, openGap && `${openGap.kind}:${openGap.h}`);

      const overlap = weekViewElasticLayout([
        seg('a','habit',840,885), seg('b','habit',855,870)
      ], {scale:1.2});
      const group = overlap.items.find(item=>item.type === 'conflict');
      check('overlapping habits stack in one group instead of side by side',
        overlap.conflictCount === 1 && group && group.children.length === 2, JSON.stringify(overlap.items.map(item=>item.type)));
      check('stacked overlap cards do not paint on each other',
        group && group.children[1].y >= group.children[0].y + group.children[0].h,
        group && group.children.map(child=>`${child.y}+${child.h}`).join(','));

      const packed = weekViewElasticLayout([
        seg('a','habit',480,495), seg('b','habit',495,510), seg('c','habit',510,525), seg('d','habit',525,540)
      ], {scale:1.2});
      let separated = true;
      for(let i = 1;i < packed.items.length;i += 1){
        const prev = packed.items[i - 1];
        if(packed.items[i].y < prev.y + prev.h - 0.01)separated = false;
      }
      check('a run of 15-minute cards never overlaps the next row', separated);

      const sample = weekViewElasticLayout([
        seg('a','habit',540,600), seg('t','travel',600,605,5), seg('b','habit',780,840)
      ], {scale:1.2});
      let prevY = -1;
      let monotonic = true;
      for(let minute = 0;minute <= 1440;minute += 1){
        const y = sample.timeToY(minute);
        if(y + 0.01 < prevY)monotonic = false;
        prevY = y;
      }
      check('elastic time stays monotonic across the day', monotonic);

      // Shared elastic clock: different gaps and short cards on any day must
      // expand the SAME axis, without hiding the neighbor or moving a peer.
      const sharedRows = [
        {events:[{id:'one',topMin:540,botMin:555},{id:'two',topMin:555,botMin:570}],busy:[],travel:[]},
        {events:[{id:'peer',topMin:540,botMin:600},{id:'late',topMin:900,botMin:930}],busy:[],travel:[]}
      ];
      const axis = weekViewSharedTimeAxis(sharedRows);
      check('shared axis reserves a readable height for back-to-back 15-minute rows',axis.timeToY(555)-axis.timeToY(540) >= 52 && axis.timeToY(570)-axis.timeToY(555) >= 52);
      check('shared axis compresses quiet hours',axis.timeToY(900)-axis.timeToY(600) < 120);
      check('shared clock is strictly increasing and invertible',Array.from({length:1440},(_,minute)=>minute).every(minute=>axis.timeToY(minute+1)>axis.timeToY(minute) && Math.abs(axis.yToTime(axis.timeToY(minute))-minute)<0.001));
      const reverseAxis = weekViewSharedTimeAxis([...sharedRows].reverse());
      check('shared scale does not depend on column order',Array.from({length:25},(_,hour)=>hour*60).every(minute=>axis.timeToY(minute) === reverseAxis.timeToY(minute)));
      const emptyAxis = weekViewSharedTimeAxis([{events:[],busy:[],travel:[]}]);
      check('empty multi-day axis stays usable',emptyAxis.height > 0 && Number.isFinite(emptyAxis.yToTime(50)));
      for(const [year,month,date,hours] of [[2026,2,8,23],[2026,10,1,25]]){
        const base = new Date(year,month,date).getTime();
        const end = new Date(year,month,date+1).getTime();
        const bounds = weekViewMinuteBounds(new Date(year,month,date,23,30).getTime(),end,base);
        check(`${hours}-hour DST day ends at local midnight`,bounds && bounds.botMin === 1440 && bounds.topMin === 1410 && weekViewDaySegments({start:base,end:end+3600000},base)[0].end === end);
      }

      // Deterministic render: same input → same lane output twice.
      const again = weekCalendarRows(day,data,settings,weekViewTopicTokenMap(settings),null);
      check('adapter is deterministic across calls',
        JSON.stringify(again.events.map(e=>[e.id,e.lane,e.lanes])) === JSON.stringify(all.events.map(e=>[e.id,e.lane,e.lanes])));
    }catch(err){
      check('adapter suite completed without throwing', false, String(err && err.stack || err));
    }
    return out;
  });

  for(const c of results.checks)assert(c.cond,c.name + (c.cond ? '' : ' :: ' + c.detail));
  assert(errors.length === 0,'no page errors' + (errors.length ? ' :: ' + errors[0] : ''));

  await browser.close();
  if(fail > 0){
    console.error(`\nFAIL — ${fail} assertion${fail === 1 ? '' : 's'} failed`);
    process.exit(1);
  }
  console.log('\nPASS — week view layout primitives');
  process.exit(0);
})().catch(err=>{
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
