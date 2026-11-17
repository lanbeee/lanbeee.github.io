// Summary tab overview: header subtext (factual cue only), dynamic recent-
// activity buckets (day/week/month/period from the saved rhythm), compact
// grouped settings, weekday range chip, window strip, option rows, and the
// fallback rule that every replaced pill keeps its information and editor
// route. Pure presentation — no planner work, no added storage reads.
const assert = require('node:assert/strict');
const { chromium, webkit, devices } = require('playwright');
const { BASE, baseHabit, waitForAssistant } = require('./helpers/planner-test-helpers');

const DAY = 86400000;

function fixtureItems(){
  const now = Date.now();
  const day = (n,h = 9) => { const d = new Date(); d.setHours(h,0,0,0); return d.getTime() - n * DAY; };
  return [
    // 3-day rhythm on subset weekdays, fixed window + preferred, places + prefs.
    baseHabit({hid:'sum-gym',name:'Gym',target:3,createdAt:now - 120 * DAY,
      allowedWeekdays:[1,3,5],allowedTimeStart:1080,allowedTimeEnd:1200,
      preferredTimeStart:1080,preferredTimeEnd:1140,durationMinutes:30,
      locationIds:['loc-gym'],anywhereAllowed:false,locationPrefs:{'loc-gym':'high'},
      lastLog:day(2),logs:[day(2),day(4),day(6)]}),
    // Prayer-anchored window like the Zuhr card; overdue by a rounded week.
    baseHabit({hid:'sum-zuhr',name:'Zuhr',createdAt:now - 90 * DAY,
      allowedTimeStartAnchor:'dhuhr',allowedTimeStartOffsetMin:0,
      allowedTimeEndAnchor:'asr',allowedTimeEndOffsetMin:-10,
      preferredTimeStartAnchor:'dhuhr',preferredTimeStartOffsetMin:0,
      preferredTimeEndAnchor:'dhuhr',preferredTimeEndOffsetMin:120,
      durationMinutes:5,priority:0,locationIds:['loc-city'],
      lastLog:day(16),logs:[day(16),day(23),day(30)]}),
    // Habit-anchored window already consumed: own log is newer than the anchor's.
    baseHabit({hid:'sum-consumed',name:'Consumed Anchor',createdAt:now - 30 * DAY,
      allowedTimeStartAnchor:'habit',allowedTimeStartAnchorHabitId:'sum-zuhr',allowedTimeStartOffsetMin:15,
      allowedTimeEndAnchor:'habit',allowedTimeEndAnchorHabitId:'sum-zuhr',allowedTimeEndOffsetMin:75,
      lastLog:day(1),logs:[day(1)]}),
    // Preferred-only window (no allowed window configured).
    baseHabit({hid:'sum-pref',name:'Preferred Only',createdAt:now - 40 * DAY,
      preferredTimeStart:600,preferredTimeEnd:720,lastLog:day(3),logs:[day(3)]}),
    // Preferred outside allowed: bands must keep their true positions.
    baseHabit({hid:'sum-apart',name:'Far Apart',createdAt:now - 40 * DAY,
      allowedTimeStart:480,allowedTimeEnd:600,preferredTimeStart:700,preferredTimeEnd:780,
      lastLog:day(3),logs:[day(3)]}),
    // Fixed start: exact marker with duration, not a flexible band.
    baseHabit({hid:'sum-fixed',name:'Fixed Start',createdAt:now - 40 * DAY,
      allowedTimeFixedStart:true,allowedTimeStart:660,durationMinutes:45,
      lastLog:day(2),logs:[day(2)]}),
    // Overnight clock window (end before start): two day-bounded pieces.
    baseHabit({hid:'sum-overnight',name:'Overnight',createdAt:now - 40 * DAY,
      allowedTimeStart:1320,allowedTimeEnd:120,lastLog:day(2),logs:[day(2)]}),
    // Equal endpoints: canonical semantics read as a full day — strip hides.
    baseHabit({hid:'sum-fullday',name:'Full Day',createdAt:now - 40 * DAY,
      allowedTimeStart:540,allowedTimeEnd:540,lastLog:day(2),logs:[day(2)]}),
    // Deleted habit-anchor target: unresolved expression keeps the pill.
    baseHabit({hid:'sum-deleted',name:'Deleted Anchor',createdAt:now - 40 * DAY,
      allowedTimeStartAnchor:'habit',allowedTimeStartAnchorHabitId:'missing-hid',allowedTimeStartOffsetMin:15,
      allowedTimeEndAnchor:'habit',allowedTimeEndAnchorHabitId:'missing-hid',allowedTimeEndOffsetMin:75,
      lastLog:day(2),logs:[day(2)]}),
    // Options rows: days → time → place stay together, one pref, one anywhere.
    baseHabit({hid:'sum-options',name:'Rotating',createdAt:now - 60 * DAY,
      scheduleOptions:[
        {id:'opt-a',weekdays:[1,3],start:480,end:540,locationId:'loc-gym'},
        {id:'opt-b',weekdays:[6],fixedStart:true,start:660,durationMinutes:30,locationId:null},
        {id:'opt-c',weekdays:[0],startAnchor:'sunrise',startOffsetMin:30,end:600,locationId:'loc-home',pref:'little'}
      ],
      locationIds:['loc-home'],anywhereAllowed:false,
      lastLog:day(3),logs:[day(3)]}),
    // Sparse 20-day rhythm: the habit's own period drives the buckets.
    baseHabit({hid:'sum-sparse',name:'Sparse',type:'keepup',target:20,
      createdAt:now - 80 * DAY,lastLog:day(20),logs:[day(20),day(45)]}),
    // Every-other-day: day buckets, one entry fills a day's dot.
    baseHabit({hid:'sum-eod',name:'Every Other Day',target:2,
      createdAt:now - 60 * DAY,lastLog:day(1),logs:[day(1),day(3),day(5)]}),
    // 2×/week without fixed days: fractional rhythm reads as weeks.
    baseHabit({hid:'sum-xpw',name:'X Per Week',target:3.5,
      createdAt:now - 20 * DAY,lastLog:day(1),logs:[day(1),day(4)]}),
    // Month-day schedule: month buckets.
    baseHabit({hid:'sum-month',name:'Monthly',allowedMonthDays:[1,15],
      createdAt:now - 300 * DAY,lastLog:day(10),logs:[day(10),day(100)]}),
    // Two entries on one day: the day preview counts entries, not days.
    baseHabit({hid:'sum-twice',name:'Twice Daily',target:0.5,
      createdAt:now - 60 * DAY,lastLog:day(1),logs:[day(1,8),day(1,20),day(3,9)]}),
    // Plans only: planned buckets stay hollow, never counted as activity.
    baseHabit({hid:'sum-plans',name:'Plans Only',createdAt:now - 30 * DAY,
      lastLog:null,logs:[{ts:day(-1,13),plan:true,timed:true},{ts:day(2,9),plan:true}]}),
    // Reduce habit: neutral wording ("wait N days"), its own period buckets.
    baseHabit({hid:'sum-reduce',name:'Less Coffee',type:'reduce',target:14,
      createdAt:now - 90 * DAY,lastLog:day(6),logs:[day(6),day(20)]}),
    // Zero habit: no activity preview at all.
    baseHabit({hid:'sum-zero',name:'No Screens',type:'zero',createdAt:now - 40 * DAY,
      lastLog:day(1),logs:[day(1)]}),
    // Task: no activity preview, cue in the header subtext.
    baseHabit({hid:'sum-task',name:'Pay Rent',type:'task',dueDate:day(-2),lastLog:null,logs:[]}),
    // Recurring appointment in its normalized shape (keepup + appointment).
    baseHabit({hid:'sum-appt',name:'Team Sync',createdAt:now - 200 * DAY,
      appointment:{repeat:'weekly',weekdays:[1,3,5],start:540,end:600,startDate:'2026-01-05'},
      allowedTimeFixedStart:true,allowedTimeStart:540,durationMinutes:60,logs:[],lastLog:null}),
    // New item: first-entry state, no empty history pushed into view.
    baseHabit({hid:'sum-new',name:'Brand New',createdAt:now,logs:[]}),
    // Heavy logs for the one-scan contract.
    baseHabit({hid:'sum-heavy',name:'Heavy',createdAt:now - 800 * DAY,
      lastLog:day(1),logs:Array.from({length:500},(_,k)=>day(k + 1,k % 10 + 7))})
  ];
}

// One browser session per engine; assertions run in-page against live globals.
async function runSuite(engine,label,profile){
  const browser = await engine.launch();
  const failures = [];
  const check = (name,fn) => { failures.push({name,fn}); };
  try{
    const page = await browser.newPage({...profile,serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(items=>{
      localStorage.setItem('tings_v2',JSON.stringify(items));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        localAssistant:true,localAssistantProvider:'needle',minimalMode:false,
        agendaOptimizer:false,showWeekOnHome:false,
        locations:[
          {id:'loc-home',name:'Home',lat:51.5074,lng:-0.1278},
          {id:'loc-gym',name:'Gym',lat:51.51,lng:-0.13},
          {id:'loc-city',name:'City',lat:51.5074,lng:-0.1278}
        ],
        lastKnownLocation:{lat:51.5074,lng:-0.1278}
      }));
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
    },fixtureItems());
    await page.goto(BASE);
    await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    // Service-worker caches only revalidate once; open with fresh scripts.
    await page.reload();
    await page.locator('#launch-screen').waitFor({state:'hidden'});

    const grab = await page.evaluate(names=>{
      const items = load();
      const out = {};
      for(const name of names){
        const i = items.findIndex(h=>h.name === name);
        openDetail(i);
        out[name] = {
          html:$('detail-summary').innerHTML,
          sub:(document.getElementById('detail-sub') || {textContent:null}).textContent,
          // The authoritative chip inventory for the all-fields-preserved check.
          chipIds:[...(assistantFocusItemSummary(items[i],{items}).essentials),
            ...(assistantFocusItemSummary(items[i],{items}).custom)].map(c=>c.id),
          pills:[...document.querySelectorAll('#detail-summary .assistant-chip[data-summary-field]')]
            .map(b=>({aria:b.getAttribute('aria-label') || '',
              text:(b.querySelector('.focus-field-text') || {}).textContent || ''}))
        };
        closeSheet('detail-sheet');
      }
      return out;
    },['Gym','Zuhr','Consumed Anchor','Preferred Only','Far Apart','Fixed Start','Overnight','Full Day','Deleted Anchor','Rotating','Sparse','Every Other Day','X Per Week','Monthly','Twice Daily','Plans Only','Less Coffee','No Screens','Pay Rent','Team Sync','Brand New','Heavy']);

    const strip = html => {
      const windowBlock = html.match(/<div class="detail-window"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || null;
      return {
        html,
        activity:html.includes('data-summary-history'),
        activityDots:(html.match(/class="detail-activity-dot[^"]*"/g) || [])
          .filter(c=>!c.includes('detail-activity-dots')),
        caption:html.match(/detail-activity-caption"[^>]*>([^<]+)</)?.[1] || null,
        weekChip:html.match(/class="assistant-chip detail-week-text"[^>]*aria-label="([^"]+)"/)?.[1] || null,
        weekChipText:html.match(/detail-week-text[^>]*><span class="focus-field-text">([^<]+)</)?.[1]
          ?.replace(/&amp;/g,'&') || null,
        window:windowBlock ? windowBlock.match(/data-summary-field="([^"]+)"/)?.[1] || true : null,
        windowText:windowBlock ? windowBlock.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() : '',
        bands:(html.match(/class="detail-track-allowed" style="left:([\d.]+)%;width:([\d.]+)%"/g) || []),
        prefBands:(html.match(/class="detail-track-preferred" style="left:([\d.]+)%;width:([\d.]+)%"/g) || []),
        planBands:(html.match(/class="detail-track-plan"/g) || []).length,
        optionRows:(html.match(/class="detail-option-row"/g) || []).length,
        fields:[...html.matchAll(/data-summary-field="([^"]+)"/g)].map(m=>m[1]),
        groupLabels:(html.match(/detail-group-label[^>]*>([^<]+)</g) || [])
          .map(s=>s.split('>')[1].split('<')[0].replace('&amp;','&'))
      };
    };
    const views = {};
    for(const [name,data] of Object.entries(grab))views[name] = strip(data.html);

    // ── Gym: full grouped layout ──
    check('gym groups in stable order',()=>{
      assert.deepEqual(views['Gym'].groupLabels,['Activity','Schedule','When & where','Places']);
    });
    check('header subtext: cue + last done; pills stay bare',()=>{
      assert.match(grab['Gym'].sub,/^Due tomorrow · last done /);
      for(const pill of grab['Gym'].pills){
        const value = pill.aria.match(/^Open [^:]+: (.+)$/s)?.[1];
        if(!value){ assert.ok(pill.aria.length > 0,'descriptive accessible name present'); continue; }
        if(/^(?:on|off|yes|no|none|enabled|disabled)$/i.test(value.trim())){
          assert.ok(pill.text.includes(' · '),`ambiguous value keeps its label ("${pill.text}")`);
        }else{
          assert.equal(pill.text,value,`pill shows the bare value ("${pill.text}")`);
        }
      }
    });
    check('gym activity: 8 week dots, current marked, week caption',()=>{
      assert.equal(views['Gym'].activityDots.length,8);
      assert.match(views['Gym'].caption,/^last 8 weeks/);
      assert.ok(views['Gym'].activityDots.some(c=>c.includes('current')),'current week identified');
      assert.ok(views['Gym'].activityDots.every(c=>!/adher|hit|warn|miss/.test(c)),'no grading classes');
    });
    check('gym weekday range chip: compact text, full accessible names',()=>{
      assert.match(views['Gym'].weekChip,/Allowed days: Monday, Wednesday, Friday/);
      assert.equal(views['Gym'].weekChipText,'mon & wed & fri');
    });
    check('gym window strip: allowed + preferred geometry',()=>{
      assert.ok(views['Gym'].bands.length === 1,'one allowed band');
      assert.ok(views['Gym'].prefBands.length === 1,'one preferred band');
      const [,left,width] = views['Gym'].bands[0].match(/left:([\d.]+)%;width:([\d.]+)%/);
      // The track crops to the waking day — the default sleep block (23:00–05:00,
      // detected structurally as a ≥4h block wrapping midnight) leaves 05:00–23:00
      // — so 18:00 sits at (1080−300)/1080 = 72.22% and spans 11.11% of the view.
      assert.ok(Math.abs(+left - 72.22) < 0.1,`allowed starts at 18:00 (72.22% of waking view), got ${left}`);
      assert.ok(Math.abs(+width - 11.11) < 0.1,`allowed spans 2h (11.11% of waking view), got ${width}`);
      assert.match(views['Gym'].windowText,/allowed/);
      assert.match(views['Gym'].windowText,/preferred/,'caption names both bands');
    });
    check('gym fields: replaced pills keep their routes via visuals',()=>{
      // allowedWeekdays/allowedWindow/preferredWindow chips are replaced by the
      // visuals, and place preferences ride the place chips' dots (the places
      // editor owns ranking); every other assistant chip must survive as a pill.
      const chipIds = grab['Gym'].chipIds;
      const visual = new Set(['allowedWeekdays','allowedWindow','preferredWindow']);
      const rendered = new Set(views['Gym'].fields);
      for(const id of chipIds){
        if(visual.has(id))assert.ok(rendered.has(id) || views['Gym'].weekChip || views['Gym'].window,`${id} carried by a visual`);
        else if(id === 'locationPrefs')assert.ok(/detail-pref /.test(views['Gym'].html),'preferences carried by the place chips\' dots');
        else assert.ok(rendered.has(id),`${id} pill survives`);
      }
    });
    check('gym places: chips + pref dots, no separate preferences pill',()=>{
      assert.match(views['Gym'].html,/detail-pref high/,'high preference dot');
      assert.match(views['Gym'].html,/only the saved places/,'anywhere-off wording preserved');
      assert.ok(!/data-summary-field="locationPrefs"/.test(views['Gym'].html),'preferences are not a standalone pill');
    });

    // ── Zuhr: anchored window resolves with inline rule text ──
    check('zuhr anchored window strip: resolved clocks + inline rule',()=>{
      assert.ok(views['Zuhr'].window,'strip renders');
      assert.equal(views['Zuhr'].window,'allowedWindow');
      assert.match(views['Zuhr'].windowText,/allowed .* · /,'saved rule preserved inline after the clocks');
      assert.match(views['Zuhr'].windowText,/→/,'endpoint rule chain survives');
      assert.match(views['Zuhr'].windowText,/preferred/,'preferred band captioned');
      const [,left] = views['Zuhr'].bands[0].match(/left:([\d.]+)%/);
      assert.ok(+left > 0 && +left < 100,'band sits inside the day axis');
    });
    check('zuhr header subtext carries the overdue cue + last done',()=>{
      assert.match(grab['Zuhr'].sub,/^1 week overdue · last done /);
    });

    // ── Fallbacks: unresolved or unhelpful geometry keeps the pills ──
    check('consumed habit anchor: pill retained, no strip',()=>{
      assert.equal(views['Consumed Anchor'].window,null);
      assert.ok(views['Consumed Anchor'].fields.includes('allowedWindow'),'editable rule text stays');
    });
    check('deleted habit anchor: pill retained, no strip',()=>{
      assert.equal(views['Deleted Anchor'].window,null);
      assert.ok(views['Deleted Anchor'].fields.includes('allowedWindow'));
    });
    check('equal endpoints read as a full day: strip hidden, pill kept',()=>{
      assert.equal(views['Full Day'].window,null);
      assert.ok(views['Full Day'].fields.includes('allowedWindow'));
    });
    check('overnight window: two truthful day-bounded pieces',()=>{
      assert.ok(views['Overnight'].bands.length === 2,'midnight split renders both pieces');
      assert.ok(views['Overnight'].fields.includes('allowedWindow') || views['Overnight'].window,'route exists');
    });
    check('fixed start: exact marker wording',()=>{
      assert.ok(views['Fixed Start'].window,'strip renders');
      assert.match(views['Fixed Start'].windowText,/fixed start/);
    });
    check('preferred-only window renders without an allowed restriction',()=>{
      assert.ok(views['Preferred Only'].window,'strip renders');
      assert.equal(views['Preferred Only'].bands.length,0,'no invented allowed band');
      assert.ok(views['Preferred Only'].prefBands.length === 1);
      assert.equal(views['Preferred Only'].window,'preferredWindow');
    });
    check('preferred outside allowed keeps true positions',()=>{
      const aLeft = +views['Far Apart'].bands[0].match(/left:([\d.]+)%/)[1];
      const pLeft = +views['Far Apart'].prefBands[0].match(/left:([\d.]+)%/)[1];
      assert.ok(pLeft > aLeft + 10,'preferred band stays outside the allowed band');
    });

    // ── Option rows ──
    check('option rows keep days, time, place together',()=>{
      assert.equal(views['Rotating'].optionRows,3,'every configured option renders');
      assert.ok(!/assistant-chip[^>]*data-summary-field="scheduleOptions"/.test(views['Rotating'].html),'scheduleOptions pill replaced');
      assert.match(views['Rotating'].html,/detail-pref little/,'option preference dot');
      assert.match(views['Rotating'].html,/anywhere/,'anywhere option names itself');
    });
    check('options-only item: no weekday chip from option weekdays',()=>{
      assert.equal(views['Rotating'].weekChip,null,'general mask only drives the chip');
    });

    // ── Recent activity: dynamic buckets from the saved rhythm ──
    check('sparse 20-day habit: the habit period drives the buckets',()=>{
      assert.equal(views['Sparse'].activityDots.length,8);
      assert.match(views['Sparse'].caption,/^every 20 days/);
      const filled = views['Sparse'].activityDots.filter(c=>!/(empty|unavailable)/.test(c)).length;
      assert.ok(filled <= 3,`sparse history shows few active windows, got ${filled}`);
    });
    check('every-other-day rhythm: day buckets, one entry fills a day',()=>{
      assert.match(views['Every Other Day'].caption,/^last 8 days/);
      assert.equal(views['Every Other Day'].activityDots.length,8);
      const filled = views['Every Other Day'].activityDots.filter(c=>/(mid|high)/.test(c)).length;
      assert.ok(filled >= 2,`logged days read dense, got ${filled}`);
    });
    check('fractional weekly rhythm without fixed days: week buckets',()=>{
      assert.match(views['X Per Week'].caption,/^last 8 weeks/);
      assert.equal(views['X Per Week'].weekChip,null,'no weekday chip without a saved mask');
      assert.ok(views['X Per Week'].activityDots.some(c=>c.includes('unavailable')),'buckets before creation stay unavailable');
      assert.ok(views['X Per Week'].activityDots.some(c=>!c.includes('unavailable')),'live buckets still render');
    });
    check('month-day schedule: month buckets',()=>{
      assert.match(views['Monthly'].caption,/^last 8 months/);
      assert.equal(views['Monthly'].activityDots.length,8);
    });
    check('multiple entries on one day count separately',()=>{
      assert.match(views['Twice Daily'].caption,/^last 8 days/);
      const high = views['Twice Daily'].activityDots.filter(c=>/high/.test(c)).length;
      assert.ok(high >= 1,'a two-entry day reads denser than single-entry days');
    });
    check('plans never count as activity',()=>{
      assert.ok(views['Plans Only'].activity,'row renders (plans exist)');
      assert.ok(views['Plans Only'].activityDots.every(c=>/(empty|planned|unavailable)/.test(c)),'no filled dots from plans');
    });
    check('new item: no activity row, first-entry state',()=>{
      assert.equal(views['Brand New'].activity,false);
      assert.match(grab['Brand New'].sub,/Ready to start|Ready for first entry/i);
    });
    check('zero habit: no activity preview',()=>{
      assert.equal(views['No Screens'].activity,false);
    });
    check('task: no activity preview, cue in the header',()=>{
      assert.equal(views['Pay Rent'].activity,false);
      assert.match(grab['Pay Rent'].sub,/Due/);
    });
    check('reduce: neutral wait wording, its own period buckets',()=>{
      assert.match(grab['Less Coffee'].sub,/^Wait 8 days · last entry /);
      assert.ok(!/last done/i.test(grab['Less Coffee'].sub),'no completion language for reduce');
      assert.match(views['Less Coffee'].caption,/^every 14 days/);
    });
    check('recurring appointment: no activity preview',()=>{
      assert.equal(views['Team Sync'].activity,false);
    });

    // ── Interaction routing ──
    const routing = await page.evaluate(()=>{
      const items = load();
      const i = items.findIndex(h=>h.name === 'Gym');
      const calls = {reveal:[],nav:[]};
      const originalReveal = window.detailSummaryReveal;
      const originalNav = window.scrollDetailToNav;
      window.detailSummaryReveal = (field,session,focus)=>{calls.reveal.push(field);};
      window.scrollDetailToNav = (key,behavior)=>{calls.nav.push(key);};
      try{
        openDetail(i);
        document.querySelector('[data-summary-field="allowedWeekdays"]').click();
        document.querySelector('.detail-window-track[data-summary-field]').click();
        document.querySelector('.detail-window-line[data-summary-field="preferredWindow"]').click();
        document.querySelector('[data-summary-field="places"]').click();
        document.querySelector('[data-summary-history]').click();
        closeSheet('detail-sheet');
      }finally{
        window.detailSummaryReveal = originalReveal;
        window.scrollDetailToNav = originalNav;
      }
      return calls;
    });
    check('strips and chips route to their existing editors',()=>{
      assert.ok(routing.reveal.includes('allowedWeekdays'),'week chip opens weekday editor');
      assert.ok(routing.reveal.includes('allowedWindow'),'window strip opens window editor');
      assert.ok(routing.reveal.includes('preferredWindow'),'preferred caption opens preferred hours directly');
      assert.ok(routing.reveal.includes('places'),'place chip opens places editor');
      assert.ok(routing.nav.includes('calendar'),'activity row opens the history tab');
    });

    // ── Performance contract ──
    const perf = await page.evaluate(()=>{
      const items = load();
      const heavy = items.findIndex(h=>h.name === 'Heavy');
      const originalLoad = window.load;
      const originalNormalize = window.normalizeLogs;
      const originalPrayer = window.prayerTimesFor;
      const originalResolve = window.resolveHabitExprMinutes;
      const originalAgenda = window.buildWeekAgenda;
      const originalAgendaAsync = window.buildWeekAgendaAsync;
      let reads = 0,normalize = 0,prayer = 0,habitResolves = 0,agenda = 0;
      window.load = (...a)=>{reads++;return originalLoad.apply(this,a);};
      window.normalizeLogs = (...a)=>{normalize++;return originalNormalize.apply(this,a);};
      window.prayerTimesFor = (...a)=>{prayer++;return originalPrayer.apply(this,a);};
      window.resolveHabitExprMinutes = (...a)=>{habitResolves++;return originalResolve.apply(this,a);};
      window.buildWeekAgenda = ()=>{agenda++;return originalAgenda.apply(this,arguments);};
      window.buildWeekAgendaAsync = ()=>{agenda++;return originalAgendaAsync.apply(this,arguments);};
      try{
        clearPrayerTimesCache();
        openDetail(heavy); // full open primes the prayer caches like a real tap
        const timings = [];
        let lastCounts = null;
        for(let k = 0;k < 12;k++){
          clearPrayerTimesCache();
          const before = {reads,normalize,prayer,habitResolves,agenda};
          const t0 = performance.now();
          renderDetailSummary(items[heavy],items);
          timings.push(performance.now() - t0);
          lastCounts = {
            reads:reads - before.reads,
            normalize:normalize - before.normalize,
            prayer:prayer - before.prayer,
            habitResolves:habitResolves - before.habitResolves,
            agenda:agenda - before.agenda
          };
        }
        return {
          timings:timings.slice(1),
          perCall:lastCounts
        };
      }finally{
        window.load = originalLoad;
        window.normalizeLogs = originalNormalize;
        window.prayerTimesFor = originalPrayer;
        window.resolveHabitExprMinutes = originalResolve;
        window.buildWeekAgenda = originalAgenda;
        window.buildWeekAgendaAsync = originalAgendaAsync;
        closeSheet('detail-sheet');
      }
    });
    check('overview adds zero storage reads and zero planner starts',()=>{
      assert.equal(perf.perCall.reads,0,`no load() calls (${perf.perCall.reads})`);
      assert.equal(perf.perCall.agenda,0,'no planner builds');
    });
    check('overview stays within one logs walk plus bounded resolution',()=>{
      assert.ok(perf.perCall.normalize <= 3,`normalizeLogs budget (baseline 2 + tone fallback): ${perf.perCall.normalize}`);
      assert.ok(perf.perCall.prayer <= 4,`bounded endpoint resolution: ${perf.perCall.prayer}`);
    });
    const sorted = [...perf.timings].sort((a,b)=>a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    check('overview median stays in the agreed ~+1ms budget',()=>{
      assert.ok(median < 5,`warm median ${median.toFixed(2)}ms (p95 ${p95.toFixed(2)}ms) — investigate regressions`);
    });

    // ── Parity: interval tone caption reuses the shared classifier ──
    const parity = await page.evaluate(()=>{
      const items = load();
      const habit = items.find(h=>h.name === 'Less Coffee');
      const canonical = intervalToneSummary(habit).label;
      const intervals = [];
      const actual = actualLogs(habit.logs);
      for(let i = 1;i < actual.length;i++)intervals.push(Math.max(1,Math.round((actual[i] - actual[i - 1]) / 86400000)));
      intervals.push(Math.max(1,daysSince(actual[actual.length - 1]) || 1));
      const fromSnapshot = intervalToneSummary(habit,intervals).label;
      return {canonical,fromSnapshot};
    });
    check('interval caption parity with intervalValues semantics',()=>{
      assert.equal(parity.fromSnapshot,parity.canonical);
    });

    // ── buildCue pluralization ──
    const cue = await page.evaluate(()=>{
      const items = load();
      const h = items.find(r=>r.name === 'Zuhr');
      const days = daysSince(h.lastLog); // 16 days since last entry, target 7
      return {days,one:buildCue(h,days),boundary:buildCue(h,14),oneWeek:buildCue(h,15),two:buildCue(h,18)};
    });
    check('rounded weeks singularize (9 overdue days → 1 week)',()=>{
      const overdueDays = cue.days - 7;
      assert.ok(overdueDays > 7,`fixture is past the week boundary (${overdueDays}d)`);
      assert.match(cue.one,/1 week overdue/);
      assert.match(cue.boundary,/7 days overdue/,'the day branch still owns ≤7 overdue days');
      assert.match(cue.oneWeek,/1 week overdue/,'8 overdue days round to one week');
      assert.match(cue.two,/2 weeks overdue/);
    });

    check('no page errors',()=>{
      assert.deepEqual(errors,[],`page errors: ${errors.join(' | ')}`);
    });

    if(!process.env.SKIP_UI_SCREENSHOTS){
      await page.evaluate(()=>openDetail(load().findIndex(h=>h.name === 'Zuhr')));
      await page.waitForTimeout(400);
      await page.screenshot({path:`test-results/detail-summary-strip/${label}-zuhr.png`,fullPage:false});
      await page.evaluate(()=>{closeSheet('detail-sheet');openDetail(load().findIndex(h=>h.name === 'Rotating'));});
      await page.waitForTimeout(400);
      await page.screenshot({path:`test-results/detail-summary-strip/${label}-rotating.png`,fullPage:false});
      await page.evaluate(()=>closeSheet('detail-sheet'));
    }
  }finally{
    await browser.close();
  }
  return failures;
}

(async()=>{
  const fs = require('node:fs');
  fs.mkdirSync('test-results/detail-summary-strip',{recursive:true});
  let failed = 0;
  for(const [engine,label,profile] of [
    [chromium,'chromium',{viewport:{width:412,height:892}}],
    [webkit,'webkit',{...devices['iPhone 13'],viewport:{width:393,height:852}}]
  ]){
    const failures = await runSuite(engine,label,profile);
    for(const {name,fn} of failures){
      try{ await fn(); console.log(`  ok  ${label}: ${name}`); }
      catch(error){ failed++; console.error(`FAIL ${label}: ${name}\n  ${error.message.split('\n')[0]}`); }
    }
  }
  if(failed){ console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log('\ndetail-summary-strip: all assertions passed');
})();
