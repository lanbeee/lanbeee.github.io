// One recurring habit with several ways to complete it: a flexible Home
// window plus explicit, strongly preferred in-person rows at exact times
// (Dhuhr at home or in jamaat at the masjid; self-study at home or with a
// tutor). Product expectation: on a genuinely light day the nearby strongly
// preferred away option wins when the full trip fits; a clock conflict,
// venue hours, travel overhead, or competing due work makes Home the better
// choice, keeping a full-duration occurrence inside the valid Home window.
// Fixed appointments and compatible due work stay intact.
//
// The matrix runs every case, prints selected rows and solve provenance for
// failures, and exits nonzero if either engine fails a case.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/alternative-time-place-context-test.js
const {
  chromium, BASE, baseHabit, plannerSettings, glpkAvailable, FAST_ONLY
} = require('./helpers/planner-test-helpers');

const TZ = 'America/New_York';
const HID = 'prayer-case';
const STUDY_HID = 'study-case';
const DAY_MS = 86400000;

// Browser-derived local midnights (Playwright page runs in TZ), so every
// fixture timestamp is computed against the same calendar the planner sees.
let T0 = 0, W0 = 0;
const at = min => T0 + min * 60000;          // Tuesday 2026-11-17 local
const wedAt = min => W0 + min * 60000;       // Wednesday 2026-11-18 local
const nyDate = ts => new Intl.DateTimeFormat('en-CA',{
  timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(ts));

let pass = 0, fail = 0;
const matrix = [];
function assert(cond,msg,detail){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else{
    fail += 1;
    console.error('  FAIL: ' + msg);
    if(detail)console.error(String(detail).split('\n').map(line=>'        ' + line).join('\n'));
  }
}

function fmt(ts){
  if(!Number.isFinite(ts))return String(ts);
  const m = Math.round((ts - T0) / 60000);
  const day = Math.floor(m / 1440);
  const clock = `${String(Math.floor((m % 1440) / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
  return day ? `D+${day} ${clock}` : clock;
}

// ---- fixtures ------------------------------------------------------------

function location(id,name,lat,lng,hoursByDay = {}){
  return {id,name,address:'',lat,lng,radiusM:75,emoji:'',
    allowedTimeStart:null,allowedTimeEnd:null,preferredTimeStart:null,preferredTimeEnd:null,
    closedDays:[],hoursByDay};
}
const homeLoc = ()=>location('home','Home',40,-74);
const masjidLoc = (hoursByDay = {})=>location('masjid','Masjid',40.01,-74,hoursByDay);
const tutorLoc = ()=>location('tutor','Tutor',40.02,-74);

function travelSettings({blockedTimes = [],seed = 'home',homeTutor = 12,masjid = null} = {}){
  const now = at(480);
  return plannerSettings(blockedTimes,{
    lastKnownLocationId:seed,defaultTravelMode:'driving',
    locations:[homeLoc(),masjidLoc(masjid || {}),tutorLoc()],
    travel:Object.fromEntries([
      ['home','masjid',10],['home','tutor',homeTutor],['masjid','tutor',12]
    ].map(([a,b,minutes])=>[[a,b].sort().join('|'),{
      a,b,seconds:minutes*60,metres:1000,provider:'manual',fetchedAt:now
    }]))
  });
}

function prayerHabit(){
  return baseHabit({
    hid:HID,name:'Dhuhr',type:'keepup',target:1,priority:0,
    createdAt:at(0) - DAY_MS,durationMinutes:15,breakable:false,
    logs:[],lastLog:null,anywhereAllowed:false,locationIds:['home'],
    allowedWeekdays:[],allowedMonthDays:[],
    allowedTimeStart:660,allowedTimeEnd:840,
    preferredTimeStart:null,preferredTimeEnd:null,
    scheduleOptions:[{
      id:'jamaat',locationId:'masjid',weekdays:[2],start:737,fixedStart:true,
      sameDayMode:'alternative',pref:'high'
    }]
  });
}

function prayerOptionsOnly(){
  const h = prayerHabit();
  h.allowedTimeStart = null;
  h.allowedTimeEnd = null;
  h.locationIds = ['masjid'];
  return h;
}

function prayerBlockedHome(){
  const h = prayerHabit();
  h.allowedTimeStart = 660;
  h.allowedTimeEnd = 675;
  return h;
}

function studyHabit({tutorPref = 'high',window = [780,1050]} = {}){
  return baseHabit({
    hid:STUDY_HID,name:'Self-study',type:'keepup',target:1,priority:0,
    createdAt:at(0) - DAY_MS,durationMinutes:45,breakable:false,
    logs:[],lastLog:null,anywhereAllowed:false,locationIds:['home'],
    allowedWeekdays:[],allowedMonthDays:[],
    allowedTimeStart:window[0],allowedTimeEnd:window[1],
    preferredTimeStart:null,preferredTimeEnd:null,
    scheduleOptions:[{
      id:'in-person',locationId:'tutor',weekdays:[2],start:907,fixedStart:true,
      sameDayMode:'alternative',...(tutorPref ? {pref:tutorPref} : {})
    }]
  });
}

function studyOptionsOnly(){
  const h = studyHabit();
  h.allowedTimeStart = null;
  h.allowedTimeEnd = null;
  h.locationIds = ['tutor'];
  return h;
}

function studyFlexHabit(tutorEnd = 975){
  const h = studyHabit();
  h.allowedTimeStart = 780;
  h.allowedTimeEnd = 825;
  h.scheduleOptions = [{
    id:'flex-tutor',locationId:'tutor',weekdays:[2],start:900,end:tutorEnd,
    sameDayMode:'alternative',pref:'high'
  }];
  return h;
}

function studyRankedHabit({laterPref = 'high',reversed = false} = {}){
  const rows = [
    {id:'earlier',locationId:'tutor',weekdays:[2],start:907,fixedStart:true,
      sameDayMode:'alternative',pref:'little'},
    {id:'later-tutor',locationId:'tutor',weekdays:[2],start:970,fixedStart:true,
      sameDayMode:'alternative'}
  ];
  if(laterPref)rows[1].pref = laterPref;
  if(reversed)rows.reverse();
  return baseHabit({
    hid:'rank-study',name:'Ranked study',type:'keepup',target:1,priority:0,
    createdAt:at(0) - DAY_MS,durationMinutes:45,breakable:false,
    logs:[],lastLog:null,anywhereAllowed:false,locationIds:['tutor'],
    locationPrefs:{tutor:'avoid'},
    allowedWeekdays:[],allowedMonthDays:[],
    allowedTimeStart:null,allowedTimeEnd:null,
    preferredTimeStart:null,preferredTimeEnd:null,
    scheduleOptions:rows
  });
}

// Fixed Home commitment: published rows are kind 'scheduled'.
function homeAppt(hid,startMin,endMin,name = 'Home commitment'){
  return baseHabit({
    hid,name,type:'task',target:null,
    eventTime:at(startMin),durationMinutes:endMin - startMin,
    createdAt:at(0) - DAY_MS,anywhereAllowed:false,locationIds:['home']
  });
}

function dueTask(){
  return baseHabit({
    hid:'due-work',name:'Due work',type:'task',target:null,
    dueDate:at(0),hardDue:true,priority:0,durationMinutes:85,breakable:false,
    createdAt:at(0) - DAY_MS,anywhereAllowed:false,locationIds:['home'],
    allowedTimeStart:865,allowedTimeEnd:985
  });
}

// ---- row-aware dual-engine wrapper ---------------------------------------

async function runEngines(page,{data,settings,now,numDays = 1,withLogs = false}){
  return page.evaluate(async ({data,settings,now,numDays,fastOnly,withLogs})=>{
    const RealDate = Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    const previousSettings = sortSettings;
    sortSettings = settings;
    const rowFields = row=>({
      kind:row.kind,
      i:row.i ?? null,
      hid:(row.h && row.h.hid) ?? (data[row.i] && data[row.i].hid) ?? null,
      start:row.start ?? null,
      end:row.end ?? null,
      locationId:row.locationId ?? null,
      scheduleOptionId:row.scheduleOptionId ?? null,
      occurrenceKey:row.occurrenceKey ?? null,
      scheduledDay:row.scheduledDay ?? null,
      from:row.from ?? null,
      to:row.to ?? null,
      seconds:row.seconds ?? null,
      score:Number.isFinite(row.plannerScore) ? row.plannerScore : null,
      scoreTerms:row.plannerScoreTerms || null
    });
    const serialize = week=>({
      optimized:Boolean(week.optimized),
      solve:week.plannerSolveStatus || null,
      daySolves:(week.daySolves || []).map(s=>({
        day:s.dayKey ?? null,phase:s.phase ?? null,
        status:s.status ?? null,selection:s.selectionStatus ?? null
      })),
      days:(week.days || []).map(day=>({
        dayBase:day.dayBase ?? null,
        rows:(day.timeline || []).map(rowFields)
      })),
      home:(week.days || []).map(day=>((typeof homeDaySequence === 'function'
        ? homeDaySequence(day,settings)
        : (day.timeline || []))).map(rowFields))
    });
    try{
      const out = {};
      if(!fastOnly){
        try{
          out.glpk = serialize(await buildWeekAgendaAsync(
            JSON.parse(JSON.stringify(data)),{...settings,agendaOptimizer:true},numDays));
        }catch(error){ out.glpk = {error:String(error && error.message || error)}; }
      }
      try{
        out.fast = serialize(buildWeekAgenda(
          JSON.parse(JSON.stringify(data)),{...settings,agendaOptimizer:false},numDays));
      }catch(error){ out.fast = {error:String(error && error.message || error)}; }
      if(withLogs)out.logs = normalizeLogs((data[0] && data[0].logs) || []);
      return out;
    }finally{
      globalThis.Date = RealDate;
      sortSettings = previousSettings;
    }
  },{data,settings,now,numDays,fastOnly:FAST_ONLY,withLogs});
}

// ---- plan accessors and dump helpers --------------------------------------

const dayRows = (plan,n = 0)=>((plan.days || [])[n] || {}).rows || [];
const fillsFor = (plan,hid,n = 0)=>dayRows(plan,n).filter(r=>r.kind === 'fill' && r.hid === hid);
const totalFills = (plan,n = 0)=>dayRows(plan,n).filter(r=>r.kind === 'fill');
const scheduledFor = (plan,hid,n = 0)=>dayRows(plan,n).filter(r=>r.kind === 'scheduled' && r.hid === hid);

const dumpRows = rows=>rows.map(r=>{
  if(r.kind === 'travel')return `  travel ${fmt(r.start)}–${fmt(r.end)} ${r.from}→${r.to} ${r.seconds}s`;
  const extras = r.kind === 'fill' && r.scoreTerms
    ? ` score=${r.score != null ? Math.round(r.score * 100) / 100 : '-'} terms=${JSON.stringify(r.scoreTerms)}` : '';
  return `  ${r.kind} ${fmt(r.start)}–${fmt(r.end)} ${r.hid || r.i} @${r.locationId || '-'}`
    + ` opt=${r.scheduleOptionId || '-'} key=${r.occurrenceKey || '-'}${extras}`;
}).join('\n') || '  (no rows)';

const dumpPlan = plan=>['status: optimized=' + plan.optimized + ' solve=' + plan.solve
    + (plan.daySolves && plan.daySolves.length
      ? ' daySolves=' + plan.daySolves.map(s=>`${s.day}:${s.phase}:${s.status}`).join(',') : ''),
  ...(plan.days || []).map((day,n)=>`day ${n} (base ${day.dayBase}):\n${dumpRows(day.rows)}`)].join('\n');

// ---- expectation helpers ---------------------------------------------------

function expectOccurrence(chk,plan,hid,{option,place,start,end,window,day = 0,duration,label = 'habit'}){
  const fills = fillsFor(plan,hid,day);
  chk(fills.length === 1,`${label} places exactly one occurrence on day ${day} (got ${fills.length})`,dumpFills(fills));
  const f = fills[0];
  if(!f)return null;
  if(option != null)chk(f.scheduleOptionId === option,
    `${label} uses the ${option} option (got ${f.scheduleOptionId})`,dumpFills(fills));
  if(place != null)chk(f.locationId === place,
    `${label} is at ${place} (got ${f.locationId})`,dumpFills(fills));
  if(start != null)chk(f.start === start,
    `${label} starts at ${fmt(start)} (got ${fmt(f.start)})`,dumpFills(fills));
  if(end != null)chk(f.end === end,
    `${label} ends at ${fmt(end)} (got ${fmt(f.end)})`,dumpFills(fills));
  if(window)chk(f.start >= window[0] && f.end <= window[1],
    `${label} keeps a full occurrence inside ${fmt(window[0])}–${fmt(window[1])}`,dumpFills(fills));
  if(duration != null)chk(f.end - f.start === duration * 60000,
    `${label} keeps its full ${duration}-minute duration`,dumpFills(fills));
  return f;
}

function dumpFills(fills){
  return fills.length ? dumpRows(fills) : '  (no fills for the focal habit)';
}

function checkLeg(chk,plan,spec,surface = 'rows',required = true){
  const rows = surface === 'rows' ? dayRows(plan) : (plan.home || [])[0] || [];
  const legs = rows.filter(r=>r.kind === 'travel' && r.from === spec.from && r.to === spec.to);
  const where = surface === 'rows' ? 'timeline' : 'home sequence';
  const match = legs.find(r=>spec.seconds == null || r.seconds === spec.seconds);
  if(required)chk(legs.length >= 1,
    `${where} has a ${spec.from}→${spec.to} travel leg`,dumpRows(rows));
  if(!match)return null;
  if(spec.seconds != null)chk(match.seconds === spec.seconds,
    `${where} ${spec.from}→${spec.to} leg costs ${spec.seconds}s (got ${match.seconds})`,dumpRows(rows));
  if(spec.start != null)chk(match.start === spec.start,
    `${where} ${spec.from}→${spec.to} leg departs at ${fmt(spec.start)} (got ${fmt(match.start)})`,dumpRows(rows));
  if(spec.end != null)chk(match.end === spec.end,
    `${where} ${spec.from}→${spec.to} leg arrives at ${fmt(spec.end)} (got ${fmt(match.end)})`,dumpRows(rows));
  return match;
}

function checkNoTravelOverlap(chk,plan,day = 0){
  const rows = dayRows(plan,day);
  const legs = rows.filter(r=>r.kind === 'travel');
  const rest = rows.filter(r=>r.kind !== 'travel');
  for(const leg of legs){
    chk(rest.every(r=>leg.end <= r.start || leg.start >= r.end),
      `travel ${fmt(leg.start)}–${fmt(leg.end)} overlaps no work or busy time`,dumpRows(rows));
  }
}

function checkScheduled(chk,plan,hid,startMin,endMin,locId = 'home',day = 0){
  const rows = scheduledFor(plan,hid,day);
  chk(rows.length === 1,`fixed commitment ${hid} stays published once (got ${rows.length})`,dumpRows(rows));
  const r = rows[0];
  if(!r)return null;
  chk(r.start === at(startMin) && r.end === at(endMin),
    `fixed commitment ${hid} keeps ${fmt(at(startMin))}–${fmt(at(endMin))} (got ${fmt(r.start)}–${fmt(r.end)})`,dumpRows(rows));
  if(locId)chk(r.locationId === locId,`fixed commitment ${hid} stays at ${locId}`,dumpRows(rows));
  return r;
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  let editorPage = null;
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},timezoneId:TZ,locale:'en-US'});
    const errors = [];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(BASE,{waitUntil:'networkidle'});
    ({tuesday:T0,wednesday:W0} = await page.evaluate(()=>({
      tuesday:new Date(2026,10,17).getTime(),
      wednesday:new Date(2026,10,18).getTime()
    })));
    await page.waitForFunction(()=>typeof buildWeekAgendaAsync === 'function');
    const glpkOk = FAST_ONLY ? false : await glpkAvailable(page);
    if(FAST_ONLY)console.log('planner mode: Fast only (HABITS_PLANNER_MODE=fast)');
    else if(!glpkOk)console.log('SKIP: GLPK WASM unavailable — running Fast only');
    const engines = FAST_ONLY || !glpkOk ? ['fast'] : ['glpk','fast'];

    async function runCase(page,def){
      const plans = await runEngines(page,def);
      const row = {label:def.label,glpk:'-',fast:'-'};
      matrix.push(row);
      for(const engine of engines){
        const plan = plans[engine];
        if(!plan){ row[engine] = 'skip'; continue; }
        if(plan.error){
          row[engine] = 'FAIL';
          assert(false,`${def.label} [${engine}] planner builds`,plan.error);
          continue;
        }
        let failed = false;
        const chk = (cond,msg,detail)=>{
          if(cond)assert(true,`${def.label} [${engine}] ${msg}`);
          else{ failed = true; assert(false,`${def.label} [${engine}] ${msg}`,detail); }
        };
        if(engine === 'glpk'){
          if(def.expectPlacement === false){
            console.log(`  note: ${def.label} [glpk] provenance optimized=${plan.optimized} solve=${plan.solve}`);
          }else{
            chk(plan.optimized === true && (plan.solve === 'optimal' || plan.solve === 'feasible'),
              `publishes an optimized GLPK incumbent (status ${plan.solve})`,
              `optimized=${plan.optimized} solve=${plan.solve}`);
          }
        }
        def.expect(plan,chk,engine);
        row[engine] = failed ? 'FAIL' : 'PASS';
        if(failed)console.error(`  ---- ${def.label} [${engine}] rows:\n${dumpPlan(plan)}`);
      }
    }

    console.log('\n[fixtures] option-mode context');
    {
      const probes = await page.evaluate(({prayerOnly,studyOnly,prayer,study})=>({
        prayerOnly:hasGeneralAllowedSchedule(prayerOnly),
        studyOnly:hasGeneralAllowedSchedule(studyOnly),
        prayer:hasGeneralAllowedSchedule(prayer),
        study:hasGeneralAllowedSchedule(study)
      }),{
        prayerOnly:prayerOptionsOnly(),studyOnly:studyOptionsOnly(),
        prayer:prayerHabit(),study:studyHabit()
      });
      assert(probes.prayerOnly === false,'options-only prayer fixture has no general fallback');
      assert(probes.studyOnly === false,'options-only study fixture has no general fallback');
      assert(probes.prayer === true && probes.study === true,'main fixtures keep a real general Home window');
    }

    // ---- A. one occurrence with home and exact away alternatives ----------
    console.log('\n[A] prayer: Home window 11:00–14:00 or jamaat at the masjid 12:17');

    await runCase(page,{label:'A1 light day takes the strongly preferred jamaat',
      data:[prayerHabit()],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,HID,{option:'jamaat',place:'masjid',start:at(737),end:at(752)});
        if(!f)return;
        checkLeg(chk,plan,{from:'home',to:'masjid',seconds:600,start:at(727),end:at(737)});
        checkLeg(chk,plan,{from:'home',to:'masjid',seconds:600,start:at(727),end:at(737)},'home');
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A2 clock conflict falls back to Home',
      data:[prayerHabit(),homeAppt('appt-a2',734,751)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,HID,{option:'general',place:'home',window:[at(660),at(840)],duration:15});
        checkScheduled(chk,plan,'appt-a2',734,751);
        if(f)chk(f.end <= at(734) || f.start >= at(751),
          'Home occurrence does not overlap the fixed commitment',dumpFills([f]));
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A3 inbound travel conflict falls back to Home',
      data:[prayerHabit(),homeAppt('appt-a3',712,732)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,HID,{option:'general',place:'home',window:[at(660),at(840)],duration:15});
        checkScheduled(chk,plan,'appt-a3',712,732);
        if(f)chk(f.end <= at(712) || f.start >= at(732),
          'Home occurrence does not overlap the fixed commitment',dumpFills([f]));
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A4 outbound travel conflict falls back to Home',
      data:[prayerHabit(),homeAppt('appt-a4',757,787)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,HID,{option:'general',place:'home',window:[at(660),at(840)],duration:15});
        checkScheduled(chk,plan,'appt-a4',757,787);
        if(f)chk(f.end <= at(757) || f.start >= at(787),
          'Home occurrence does not overlap the fixed commitment',dumpFills([f]));
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A5 venue closes early falls back to Home',
      data:[prayerHabit()],settings:travelSettings({masjid:{2:{start:660,end:745}}}),
      now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,HID,{option:'general',place:'home',window:[at(660),at(840)],duration:15});
      }
    });

    await runCase(page,{label:'A6 exact start already passed falls back to Home',
      data:[prayerHabit()],settings:travelSettings(),now:at(738),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,HID,{option:'general',place:'home',window:[at(738),at(840)],duration:15});
      }
    });

    await runCase(page,{label:'A7 option closed on Wednesday falls back to Home',
      data:[prayerHabit()],settings:travelSettings(),now:wedAt(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,HID,{option:'general',place:'home',
          window:[wedAt(660),wedAt(840)],duration:15});
        if(f)chk(f.scheduledDay === nyDate(W0),
          `occurrence is stamped for Wednesday (${nyDate(W0)})`,dumpFills([f]));
      }
    });

    await runCase(page,{label:'A8 all alternatives blocked places nothing',
      data:[prayerHabit()],
      settings:travelSettings({blockedTimes:[{label:'tuesday busy',days:[2],start:660,end:840}]}),
      now:at(480),numDays:1,expectPlacement:false,
      expect(plan,chk){
        chk(fillsFor(plan,HID).length === 0,'places zero fills for the habit',dumpPlan(plan));
      }
    });

    await runCase(page,{label:'A-boundary inbound: exact departure edge is feasible',
      data:[prayerOptionsOnly(),homeAppt('appt-b1',707,727)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,HID,{option:'jamaat',place:'masjid',start:at(737),end:at(752)});
        checkLeg(chk,plan,{from:'home',to:'masjid',seconds:600,start:at(727),end:at(737)},'home');
        checkLeg(chk,plan,{from:'home',to:'masjid',seconds:600,start:at(727),end:at(737)});
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A-boundary inbound: one minute short places nothing',
      data:[prayerOptionsOnly(),homeAppt('appt-b1',707,728)],
      settings:travelSettings(),now:at(480),numDays:1,expectPlacement:false,
      expect(plan,chk){
        chk(fillsFor(plan,HID).length === 0,'places zero fills when the appointment ends one minute too late',dumpPlan(plan));
      }
    });

    await runCase(page,{label:'A-boundary outbound: exact return edge is feasible',
      data:[prayerOptionsOnly(),homeAppt('appt-b2',762,792)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,HID,{option:'jamaat',place:'masjid',start:at(737),end:at(752)});
        checkScheduled(chk,plan,'appt-b2',762,792);
        checkLeg(chk,plan,{from:'masjid',to:'home',seconds:600,start:at(752),end:at(762)},'home');
        checkLeg(chk,plan,{from:'masjid',to:'home',seconds:600,start:at(752),end:at(762)},'rows',false);
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'A-boundary outbound: one minute short places nothing',
      data:[prayerOptionsOnly(),homeAppt('appt-b2',761,791)],
      settings:travelSettings(),now:at(480),numDays:1,expectPlacement:false,
      expect(plan,chk){
        chk(fillsFor(plan,HID).length === 0,'places zero fills when the return trip overlaps the appointment',dumpPlan(plan));
      }
    });

    // ---- B. agenda and travel context change the tutor choice -------------
    console.log('\n[B] study: Home window 13:00–17:30 or tutor session 15:07');

    await runCase(page,{label:'B1 light day takes the strongly preferred tutor session',
      data:[studyHabit()],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,STUDY_HID,{option:'in-person',place:'tutor',start:at(907),end:at(952)});
        if(!f)return;
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:720,start:at(895),end:at(907)});
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:720,start:at(895),end:at(907)},'home');
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'B2-control due task alone fills its window',
      data:[dueTask()],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,'due-work',{place:'home',window:[at(865),at(985)],duration:85,label:'due task'});
      }
    });

    await runCase(page,{label:'B2-control tutor alone takes the fixed session',
      data:[studyOptionsOnly()],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'in-person',place:'tutor',start:at(907),end:at(952)});
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:720,start:at(895),end:at(907)});
      }
    });

    await runCase(page,{label:'B2 competing due work keeps Home study and the task',
      data:[studyHabit(),dueTask()],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'general',place:'home',window:[at(780),at(1050)],duration:45});
        expectOccurrence(chk,plan,'due-work',{place:'home',window:[at(865),at(985)],duration:85,label:'due task'});
        chk(totalFills(plan).length === 2,'same-day schedule keeps exactly the two fills',dumpPlan(plan));
        const s = fillsFor(plan,STUDY_HID)[0],d = fillsFor(plan,'due-work')[0];
        if(s && d)chk(d.end <= s.start || d.start >= s.end,'study and due work do not overlap',dumpPlan(plan));
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'B3 long trip prefers the Home fallback',
      data:[studyHabit()],settings:travelSettings({homeTutor:150}),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'general',place:'home',window:[at(780),at(1050)],duration:45});
      }
    });

    await runCase(page,{label:'B3 long trip and later start prefer Home before an evening commitment',
      data:[studyHabit(),homeAppt('appt-b3',1020,1050)],
      settings:travelSettings({homeTutor:60}),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'general',place:'home',window:[at(780),at(1050)],duration:45});
        checkScheduled(chk,plan,'appt-b3',1020,1050);
        chk(dayRows(plan).every(row=>row.kind !== 'travel'),'staying Home needs no travel',dumpPlan(plan));
      }
    });

    await runCase(page,{label:'B3-control options-only tutor still crosses the long route',
      data:[studyOptionsOnly()],settings:travelSettings({homeTutor:150}),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'in-person',place:'tutor',start:at(907),end:at(952)});
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:9000,start:at(907) - 9000000,end:at(907)});
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'B4 already at the venue takes the session without a trip',
      data:[studyHabit()],settings:travelSettings({homeTutor:150,seed:'tutor'}),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'in-person',place:'tutor',start:at(907),end:at(952)});
        chk(dayRows(plan).filter(r=>r.kind === 'travel').length === 0,
          'no inbound trip when already at the venue',dumpPlan(plan));
      }
    });

    await runCase(page,{label:'B5 avoided option yields to Home',
      data:[studyHabit({tutorPref:'avoid'})],settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'general',place:'home',window:[at(780),at(1050)],duration:45});
      }
    });

    await runCase(page,{label:'B6 avoided option still works when Home is blocked',
      data:[studyHabit({tutorPref:'avoid',window:[780,825]}),homeAppt('appt-b6',780,825)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        expectOccurrence(chk,plan,STUDY_HID,{option:'in-person',place:'tutor',start:at(907),end:at(952)});
        checkScheduled(chk,plan,'appt-b6',780,825);
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:720,start:at(895),end:at(907)});
        checkNoTravelOverlap(chk,plan);
      }
    });

    // ---- C. sliding windows and preference levels --------------------------
    console.log('\n[C] sliding tutor window and controlled preference ranks');

    await runCase(page,{label:'C1 sliding tutor window starts at the earliest arrival',
      data:[studyFlexHabit(),homeAppt('c1-morning',780,825),homeAppt('c1-early',900,910)],
      settings:travelSettings(),now:at(480),numDays:1,
      expect(plan,chk){
        const f = expectOccurrence(chk,plan,STUDY_HID,{option:'flex-tutor',place:'tutor',duration:45});
        if(!f)return;
        chk(f.start >= at(922) && f.start <= at(930) && f.end <= at(975),
          `session starts 15:22–15:30 and ends by 16:15 (got ${fmt(f.start)}–${fmt(f.end)})`,dumpFills([f]));
        checkLeg(chk,plan,{from:'home',to:'tutor',seconds:720,start:f.start - 720000,end:f.start});
        chk(dayRows(plan).filter(r=>r.kind === 'travel').every(r=>r.start >= at(910)),
          'commute leaves only after the 15:00–15:10 Home commitment',dumpRows(dayRows(plan)));
        checkNoTravelOverlap(chk,plan);
      }
    });

    await runCase(page,{label:'C1 negative shortened tutor window places nothing',
      data:[studyFlexHabit(966),homeAppt('c1-morning',780,825),homeAppt('c1-early',900,910)],
      settings:travelSettings(),now:at(480),numDays:1,expectPlacement:false,
      expect(plan,chk){
        chk(fillsFor(plan,STUDY_HID).length === 0,'places zero fills when the window cannot cover the earliest arrival',dumpPlan(plan));
      }
    });

    async function rankedCase(label,{laterPref,reversed,expectOption,expectStart}){
      await runCase(page,{label,
        data:[studyRankedHabit({laterPref,reversed})],
        settings:travelSettings({seed:'tutor'}),now:at(480),numDays:1,
        expect(plan,chk){
          expectOccurrence(chk,plan,'rank-study',{option:expectOption,place:'tutor',start:expectStart,duration:45});
          chk(dayRows(plan).filter(r=>r.kind === 'travel').length === 0,
            'zero approach travel from the tutor seed',dumpPlan(plan));
        }
      });
    }
    await rankedCase('C2 strong row outranks soft row at the same place',
      {laterPref:'high',expectOption:'later-tutor',expectStart:at(970)});
    await rankedCase('C2 cleared strong row falls back to the soft row',
      {laterPref:null,expectOption:'earlier',expectStart:at(907)});
    await rankedCase('C2 row order does not decide the rank',
      {laterPref:'high',reversed:true,expectOption:'later-tutor',expectStart:at(970)});

    // ---- D. completion belongs to the habit occurrence ---------------------
    console.log('\n[D] completion identity across alternatives');

    // D1a: a real selected Home row completes the Tuesday occurrence.
    {
      console.log('\n[D1] forced-Home completion');
      const harvest = await runEngines(page,{data:[prayerHabit(),homeAppt('appt-d1a',734,751)],
        settings:travelSettings(),now:at(480),numDays:1});
      const label = 'D1 Home completion suppresses a second session';
      const row = {label,glpk:'-',fast:'-'};
      matrix.push(row);
      for(const engine of engines){
        const plan = harvest[engine];
        if(!plan || plan.error){ row[engine] = plan && plan.error ? 'FAIL' : 'skip'; continue; }
        const chk = (cond,msg,detail)=>{
          if(cond)assert(true,`${label} [${engine}] ${msg}`);
          else{ row[engine] = 'FAIL'; assert(false,`${label} [${engine}] ${msg}`,detail); }
        };
        const f = fillsFor(plan,HID)[0];
        chk(f && f.scheduleOptionId === 'general' && f.locationId === 'home',
          'forced-Home case selects the general row',dumpPlan(plan));
        if(!f || f.scheduleOptionId !== 'general')continue;
        chk(f.end <= at(720),'completion precedes the replan clock',dumpFills([f]));
        const meta = {occurrenceKey:f.occurrenceKey,scheduleOptionId:f.scheduleOptionId,scheduledDay:f.scheduledDay};
        const log = await page.evaluate(({ts,metadata})=>makeActualLog(ts,metadata),{ts:f.end,metadata:meta});
        const replan = await runEngines(page,{
          data:[{...prayerHabit(),logs:[log],lastLog:f.end}],
          settings:travelSettings(),now:at(720),numDays:1,withLogs:true});
        const normalized = replan.logs || [];
        chk(normalized.length === 1,'exactly one actual completion after normalization',JSON.stringify(normalized));
        const entry = normalized[0];
        if(entry)chk(entry.plan !== true
          && entry.occurrenceKey === meta.occurrenceKey
          && entry.scheduleOptionId === meta.scheduleOptionId
          && entry.scheduledDay === meta.scheduledDay,
          'normalization preserves the completion identity',JSON.stringify(normalized));
        const rp = replan[engine];
        if(!rp || rp.error){ row[engine] = 'FAIL'; chk(false,'replan builds',rp && rp.error); continue; }
        chk(fillsFor(rp,HID).length === 0,'no second pending session on the completed day',dumpPlan(rp));
        row[engine] = 'PASS';
      }
    }

    // D1b: a real selected jamaat row (exact-boundary control) completes it.
    {
      console.log('\n[D1] jamaat completion in the exact-boundary control');
      const harvest = await runEngines(page,{data:[prayerOptionsOnly(),homeAppt('appt-d1b',707,727)],
        settings:travelSettings(),now:at(480),numDays:1});
      const label = 'D1 jamaat completion suppresses a second session';
      const row = {label,glpk:'-',fast:'-'};
      matrix.push(row);
      for(const engine of engines){
        const plan = harvest[engine];
        if(!plan || plan.error){ row[engine] = plan && plan.error ? 'FAIL' : 'skip'; continue; }
        const chk = (cond,msg,detail)=>{
          if(cond)assert(true,`${label} [${engine}] ${msg}`);
          else{ row[engine] = 'FAIL'; assert(false,`${label} [${engine}] ${msg}`,detail); }
        };
        const f = fillsFor(plan,HID)[0];
        chk(f && f.scheduleOptionId === 'jamaat' && f.start === at(737),
          'exact-boundary control selects the jamaat row',dumpPlan(plan));
        if(!f || f.scheduleOptionId !== 'jamaat')continue;
        const meta = {occurrenceKey:f.occurrenceKey,scheduleOptionId:f.scheduleOptionId,scheduledDay:f.scheduledDay};
        const log = await page.evaluate(({ts,metadata})=>makeActualLog(ts,metadata),{ts:f.end,metadata:meta});
        const replan = await runEngines(page,{
          data:[{...prayerOptionsOnly(),logs:[log],lastLog:f.end}],
          settings:travelSettings(),now:at(753),numDays:1,withLogs:true});
        const normalized = replan.logs || [];
        chk(normalized.length === 1,'exactly one actual completion after normalization',JSON.stringify(normalized));
        const entry = normalized[0];
        if(entry)chk(entry.plan !== true
          && entry.occurrenceKey === meta.occurrenceKey
          && entry.scheduleOptionId === meta.scheduleOptionId
          && entry.scheduledDay === meta.scheduledDay,
          'normalization preserves the completion identity',JSON.stringify(normalized));
        const rp = replan[engine];
        if(!rp || rp.error){ row[engine] = 'FAIL'; chk(false,'replan builds',rp && rp.error); continue; }
        chk(fillsFor(rp,HID).length === 0,'no second pending session on the completed day',dumpPlan(rp));
        row[engine] = 'PASS';
      }
    }

    // D2a: the away completion carries over; Wednesday may take the Home path.
    {
      console.log('\n[D2] away completion carries to Wednesday');
      const harvest = await runEngines(page,{data:[prayerBlockedHome(),homeAppt('home-block',660,675)],
        settings:travelSettings(),now:at(480),numDays:1});
      const label = 'D2 away completion stays done; Wednesday takes Home';
      const row = {label,glpk:'-',fast:'-'};
      matrix.push(row);
      for(const engine of engines){
        const plan = harvest[engine];
        if(!plan || plan.error){ row[engine] = plan && plan.error ? 'FAIL' : 'skip'; continue; }
        const chk = (cond,msg,detail)=>{
          if(cond)assert(true,`${label} [${engine}] ${msg}`);
          else{ row[engine] = 'FAIL'; assert(false,`${label} [${engine}] ${msg}`,detail); }
        };
        const f = fillsFor(plan,HID)[0];
        chk(f && f.scheduleOptionId === 'jamaat' && f.start === at(737) && f.end === at(752),
          'blocked-Home combined fixture places the away row',dumpPlan(plan));
        if(!f || f.scheduleOptionId !== 'jamaat')continue;
        const meta = {occurrenceKey:f.occurrenceKey,scheduleOptionId:f.scheduleOptionId,scheduledDay:f.scheduledDay};
        const log = await page.evaluate(({ts,metadata})=>makeActualLog(ts,metadata),{ts:f.end,metadata:meta});
        // Remove the blocking commitment, restore the full Home window, and
        // replan from a clock inside the otherwise available Home window.
        const replan = await runEngines(page,{
          data:[{...prayerHabit(),logs:[log],lastLog:f.end}],
          settings:travelSettings(),now:at(765),numDays:2,withLogs:true});
        const rp = replan[engine];
        if(!rp || rp.error){ row[engine] = 'FAIL'; chk(false,'replan builds',rp && rp.error); continue; }
        chk(fillsFor(rp,HID,0).length === 0,'Tuesday stays completed',dumpPlan(rp));
        const wed = fillsFor(rp,HID,1);
        chk(wed.length === 1,'Wednesday schedules exactly one Home occurrence',dumpPlan(rp));
        const w = wed[0];
        if(w){
          chk(w.scheduleOptionId === 'general' && w.locationId === 'home',
            'Wednesday uses the general Home path',dumpFills(wed));
          chk(w.start >= wedAt(660) && w.end <= wedAt(840) && w.end - w.start === 15 * 60000,
            'Wednesday occurrence is full-length inside the Home window',dumpFills(wed));
          chk(w.scheduledDay === nyDate(W0),'Wednesday occurrence is stamped for Wednesday',dumpFills(wed));
        }
        if(engine === 'glpk'){
          chk(rp.optimized === true && (rp.solve === 'optimal' || rp.solve === 'feasible'),
            `two-day replan keeps a GLPK incumbent (status ${rp.solve})`,
            `optimized=${rp.optimized} solve=${rp.solve}`);
        }
        row[engine] = 'PASS';
      }
    }

    // D2b: the Home completion suppresses the still-future jamaat row.
    {
      console.log('\n[D2] Home completion suppresses the future jamaat row');
      const harvest = await runEngines(page,{data:[prayerHabit(),homeAppt('appt-d2b',734,751)],
        settings:travelSettings(),now:at(480),numDays:1});
      const label = 'D2 Home completion leaves no pending jamaat row';
      const row = {label,glpk:'-',fast:'-'};
      matrix.push(row);
      for(const engine of engines){
        const plan = harvest[engine];
        if(!plan || plan.error){ row[engine] = plan && plan.error ? 'FAIL' : 'skip'; continue; }
        const chk = (cond,msg,detail)=>{
          if(cond)assert(true,`${label} [${engine}] ${msg}`);
          else{ row[engine] = 'FAIL'; assert(false,`${label} [${engine}] ${msg}`,detail); }
        };
        const f = fillsFor(plan,HID)[0];
        chk(f && f.scheduleOptionId === 'general','forced-Home case selects the general row',dumpPlan(plan));
        if(!f || f.scheduleOptionId !== 'general')continue;
        chk(f.end <= at(736),'Home completion happens before 12:17',dumpFills([f]));
        const meta = {occurrenceKey:f.occurrenceKey,scheduleOptionId:f.scheduleOptionId,scheduledDay:f.scheduledDay};
        const log = await page.evaluate(({ts,metadata})=>makeActualLog(ts,metadata),{ts:f.end,metadata:meta});
        // Remove the busy constraint; the jamaat row is still in the future.
        const replan = await runEngines(page,{
          data:[{...prayerHabit(),logs:[log],lastLog:f.end}],
          settings:travelSettings(),now:at(720),numDays:1});
        const rp = replan[engine];
        if(!rp || rp.error){ row[engine] = 'FAIL'; chk(false,'replan builds',rp && rp.error); continue; }
        chk(fillsFor(rp,HID).length === 0,'no pending jamaat row after the Home completion',dumpPlan(rp));
        row[engine] = 'PASS';
      }
    }

    // ---- E. detail editor and storage round trip ---------------------------
    console.log('\n[E] detail editor round trip');
    editorPage = await browser.newPage({viewport:{width:390,height:844},timezoneId:TZ,locale:'en-US'});
    const editorErrors = [];
    editorPage.on('pageerror',error=>editorErrors.push(String(error)));
    const seedHabit = baseHabit({
      hid:'editor-prayer',name:'Dhuhr',type:'keepup',target:1,priority:0,
      createdAt:at(0) - DAY_MS,durationMinutes:15,breakable:false,
      logs:[],lastLog:null,anywhereAllowed:false,locationIds:['home'],
      allowedWeekdays:[],allowedMonthDays:[],
      allowedTimeStart:null,allowedTimeEnd:null,
      preferredTimeStart:null,preferredTimeEnd:null
    });
    const editorSettings = {...travelSettings(),minimalMode:false};
    await editorPage.clock.setFixedTime(at(480));
    await editorPage.goto(BASE,{waitUntil:'networkidle'});
    await editorPage.waitForFunction(()=>typeof openDetail === 'function' && typeof load === 'function');
    await editorPage.evaluate(({habit,settings})=>{
      localStorage.setItem('tings_v2',JSON.stringify([habit]));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
    },{habit:seedHabit,settings:editorSettings});
    await editorPage.reload({waitUntil:'networkidle'});
    await editorPage.waitForFunction(()=>typeof openDetail === 'function');
    await editorPage.evaluate(()=>openDetail(0));
    // The save button stays hidden until the form is dirty; wait for the
    // availability pane, make the edits, then click save (auto-waited).
    await editorPage.evaluate(()=>scrollDetailToNav('availability'));
    await editorPage.waitForSelector('[data-detail-nav="availability"] #detail-time-start',{state:'visible',timeout:15000});
    await editorPage.waitForTimeout(250);
    await editorPage.locator('[data-schedule-view="allowed"]').click();

    const homeChip = editorPage.locator('#detail-place-chips [data-location-id="home"]');
    if(!(await homeChip.getAttribute('class').then(v=>String(v).includes('on'))))await homeChip.click();
    const anywhereChip = editorPage.locator('#detail-place-chips [data-anywhere]');
    if(await anywhereChip.evaluate(el=>el.classList.contains('on')))await anywhereChip.click();
    assert(await homeChip.getAttribute('class').then(v=>String(v).includes('on')),
      'Home is the only selected general place');
    assert(!(await anywhereChip.evaluate(el=>el.classList.contains('on'))),'Anywhere stays off');

    await editorPage.locator('#detail-time-start').fill('11:00');
    await editorPage.locator('#detail-time-end').fill('14:00');
    assert(await editorPage.locator('#detail-time-start').inputValue() === '11:00'
      && await editorPage.locator('#detail-time-end').inputValue() === '14:00',
      'general window controls accept 11:00–14:00');

    if(!await editorPage.locator('#detail-options-disclosure').evaluate(el=>el.open))
      await editorPage.locator('#detail-options-disclosure summary').click();
    await editorPage.locator('#detail-habit-option-add').click();
    const optionRow = editorPage.locator('#detail-habit-option-list .habit-option-row').first();
    await optionRow.waitFor({state:'visible'});
    await optionRow.locator('.habit-option-location').selectOption('masjid');
    await optionRow.locator('.habit-option-time-kind').selectOption('fixed');

    const dayButtons = optionRow.locator('[data-habit-option-day]');
    assert(await dayButtons.count() === 7,'the option row exposes one chip per weekday');
    const tuesday = optionRow.locator('[data-habit-option-day="2"]');
    assert(await tuesday.getAttribute('aria-pressed') === 'true','Tuesday starts selected on a daily habit');
    // The editor snaps an all-off row back to every day ("empty means all"),
    // so deselect the other six while Tuesday stays on.
    for(const d of [0,1,3,4,5,6]){
      const btn = optionRow.locator(`[data-habit-option-day="${d}"]`);
      if((await btn.getAttribute('aria-pressed')) === 'true')await btn.click();
    }
    assert(await tuesday.getAttribute('aria-pressed') === 'true','Tuesday stays selected');
    for(const d of [0,1,3,4,5,6]){
      assert(await optionRow.locator(`[data-habit-option-day="${d}"]`).getAttribute('aria-pressed') === 'false',
        `weekday ${d} chip stays off`);
    }

    await optionRow.locator('.habit-option-start').fill('12:17');
    const prefButton = optionRow.locator('.habit-option-pref');
    await prefButton.click();
    assert(await prefButton.getAttribute('data-pref') === 'little','preference first click reaches soft');
    await prefButton.click();
    assert(await prefButton.getAttribute('data-pref') === 'high','preference second click reaches strong');

    await editorPage.locator('#detail-save').click();
    await editorPage.waitForTimeout(400);
    await editorPage.reload({waitUntil:'networkidle'});
    await editorPage.waitForFunction(()=>typeof load === 'function');
    const saved = await editorPage.evaluate(()=>load()[0]);
    assert(saved && saved.hid === 'editor-prayer','saved item keeps its habit id');
    assert(saved && saved.durationMinutes === 15,'saved item keeps its duration');
    assert(saved && saved.allowedTimeStart === 660 && saved.allowedTimeEnd === 840,
      'saved general allowed window is 11:00–14:00');
    assert(saved && JSON.stringify(saved.locationIds) === JSON.stringify(['home'])
      && saved.anywhereAllowed === false,'saved general place stays Home only');
    assert(saved && Array.isArray(saved.scheduleOptions) && saved.scheduleOptions.length === 1,
      'saved item carries exactly one explicit row');
    const opt = saved && saved.scheduleOptions && saved.scheduleOptions[0] || {};
    assert(/^[A-Za-z0-9_-]{6,64}$/.test(String(opt.id)),'explicit row keeps a stable valid id');
    assert(JSON.stringify(opt.weekdays) === JSON.stringify([2]),'explicit row is restricted to Tuesday');
    assert(opt.locationId === 'masjid','explicit row place is the masjid');
    assert(opt.start === 737,'explicit row start is minute 737 (12:17)');
    assert(opt.fixedStart === true,'explicit row saved with a fixed start');
    assert(opt.sameDayMode === 'alternative','explicit row saved as an alternative time');
    assert(opt.pref === 'high','explicit row saved with strong preference');
    assert(opt.end === null || opt.end === 840,'fixed row end is null (duration sets the finish) or the seeded window end');

    await editorPage.evaluate(()=>openDetail(0));
    // The save button stays hidden until the form is dirty; wait for the
    // availability pane, make the edits, then click save (auto-waited).
    await editorPage.evaluate(()=>scrollDetailToNav('availability'));
    await editorPage.waitForSelector('[data-detail-nav="availability"] #detail-time-start',{state:'visible',timeout:15000});
    await editorPage.waitForTimeout(250);
    await editorPage.locator('[data-schedule-view="allowed"]').click();
    assert(await editorPage.locator('#detail-time-start').inputValue() === '11:00'
      && await editorPage.locator('#detail-time-end').inputValue() === '14:00',
      'reopened controls reflect the saved general window');
    assert(await editorPage.locator('#detail-place-chips [data-location-id="home"]')
      .getAttribute('class').then(v=>String(v).includes('on')),'reopened place chips reflect Home');
    const reopenedRow = editorPage.locator('#detail-habit-option-list .habit-option-row').first();
    assert(await reopenedRow.locator('.habit-option-location').inputValue() === 'masjid',
      'reopened row place reflects the masjid');
    assert(await reopenedRow.locator('.habit-option-time-kind').inputValue() === 'fixed',
      'reopened row time kind reflects fixed start');
    assert(await reopenedRow.locator('.habit-option-start').inputValue() === '12:17',
      'reopened row start reflects 12:17');
    assert(await reopenedRow.locator('[data-habit-option-day="2"]').getAttribute('aria-pressed') === 'true',
      'reopened row reflects Tuesday');
    assert(await reopenedRow.locator('.habit-option-pref').getAttribute('data-pref') === 'high',
      'reopened row preference reflects strong');

    // Replan from the saved configuration: light day and inbound conflict.
    if(saved && saved.scheduleOptions && saved.scheduleOptions.length === 1){
      const savedId = opt.id;
      await runCase(editorPage,{label:'E saved config light day takes the saved row',
        data:[saved],settings:editorSettings,now:at(480),numDays:1,
        expect(plan,chk){
          const f = expectOccurrence(chk,plan,'editor-prayer',
            {option:savedId,place:'masjid',start:at(737),end:at(752)});
          if(!f)return;
          checkLeg(chk,plan,{from:'home',to:'masjid',seconds:600,start:at(727),end:at(737)});
          checkNoTravelOverlap(chk,plan);
        }
      });
      await runCase(editorPage,{label:'E saved config inbound conflict falls back to Home',
        data:[saved,homeAppt('appt-e',712,732)],settings:editorSettings,now:at(480),numDays:1,
        expect(plan,chk){
          expectOccurrence(chk,plan,'editor-prayer',
            {option:'general',place:'home',window:[at(660),at(840)],duration:15});
          checkScheduled(chk,plan,'appt-e',712,732);
          checkNoTravelOverlap(chk,plan);
        }
      });
    }

    assert(errors.length === 0,`planner pages generate no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    assert(editorErrors.length === 0,`editor flow generates no page errors${editorErrors.length ? ': ' + editorErrors.join(' | ') : ''}`);

    console.log('\n==== per-engine matrix ====');
    for(const row of matrix){
      console.log(`  ${row.label.padEnd(60)} glpk=${String(row.glpk).padEnd(6)} fast=${row.fast}`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close();
    if(fail)process.exit(1);
  }finally{
    if(editorPage)await editorPage.close().catch(()=>{});
  }
})().catch(error=>{ console.error(error); process.exit(1); });
