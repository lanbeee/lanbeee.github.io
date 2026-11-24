// Coverage for the field-aware help system: every user-facing item setting
// (assistantFocusCoverageLedger) plus every computed display and action
// control (ASSISTANT_FOCUS_EXTRA_HELP) must produce an explicit answer for
// what it means, what its value is (where this item exposes one), and how to
// change it (where editing is supported). A generic "I don't know" fallback
// fails the test, as does an answer built from the wrong entry. Pure Q&A:
// zero model passes, zero staged changes.
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log(`  ok: ${message}`);
}

(async()=>{
  let browser;
  try{browser = await chromium.launch({headless:true, channel:'chrome'});}
  catch(_){browser = await chromium.launch({headless:true});}
  try{
    const page = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block', timezoneId:'America/New_York'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(() => {
      window.reconcileNativeQuiet=async()=>{};window.reconcileNativeReminders=async()=>{};window.reconcileNativeRemindersNow=async()=>{};window.refreshOpenViews=()=>{};
      delete window.TingsNative;
      saveSortSettings({...loadSortSettings(), topics:['Fitness'],
        locations:[{id:'home',name:'Home',lat:40,lng:-74},{id:'gym-east',name:'Gym East',lat:40,lng:-74}]});
      const day = offset => Date.now() + offset * 86400000;
      save(normalize([
        {hid:'cov-habit',name:'Gym',type:'keepup',target:3,durationMinutes:30,priority:1,topics:['Fitness'],
          allowedWeekdays:[1,3],allowedTimeStart:1080,allowedTimeEnd:1200,earlyWindowDays:2,delayAllowanceDays:1,
          breakable:true,minChunkMinutes:15,minGapMinutes:60,locationIds:['home'],anywhereAllowed:false,
          logs:[day(-2),day(-3),day(-5)]},
        {hid:'cov-opp',name:'Walk',type:'keepup',target:1,repeatMode:'opportunity',conditionTrigger:'location',
          conditionRadiusM:300,durationMinutes:20,logs:[]},
        {hid:'cov-task',name:'File report',type:'task',target:null,durationMinutes:60,priority:2,logs:[],
          dueDate:day(3),earlyWindowDays:1,delayAllowanceDays:2,hardDue:false},
        {hid:'cov-nodue',name:'Call bank',type:'task',target:null,durationMinutes:20,earlyWindowDays:3,
          delayAllowanceDays:0,logs:[]},
        {hid:'cov-event',name:'Physio',type:'keepup',target:null,durationMinutes:45,logs:[],
          appointment:{repeat:'weekly',startDate:'2026-11-02',weekdays:[1],startMinute:1080,until:'',exceptions:{}}}
      ]));
    });
    const contexts = await page.evaluate(() => {
      const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const guideKey = id => (id === 'timesPerPeriod' || id === 'periodDays') ? 'frequency' : id;
      const contexts = [
        {name:'habit', open:{operation:'edit', kind:'habit', targetId:'cov-habit', now:Date.now()}},
        {name:'opportunity-habit', open:{operation:'edit', kind:'habit', targetId:'cov-opp', now:Date.now()}},
        {name:'task', native:true, open:{operation:'edit', kind:'task', targetId:'cov-task', now:Date.now()}},
        {name:'task-no-due', open:{operation:'edit', kind:'task', targetId:'cov-nodue', now:Date.now()}},
        {name:'event-series', native:true, open:{operation:'edit', kind:'event', targetId:'cov-event', now:Date.now()}},
        {name:'event-occurrence', native:true, open:{operation:'edit', kind:'event', targetId:'cov-event', now:Date.now()}}
      ];
      const out = [];
      for(const ctx of contexts){
        if(ctx.native)window.TingsNative = {isNative:true};
        else delete window.TingsNative;
        const s = assistantFocusOpen(ctx.open);
        if(ctx.name === 'event-series')s.eventScope = 'series';
        if(ctx.name === 'event-occurrence'){
          s.eventScope = 'occurrence';
          s.occurrenceDate = '2026-11-09';
        }
        const passesBefore = (s.timing.passes || []).length;
        const ask = text => {
          const intent = assistantFocusQuestionIntent(text, s);
          if(!intent)return {intent:null, text:'', label:null};
          const result = assistantFocusQuestionAnswer(intent, s, text);
          return {intent, text:(result && result.text) || '', label:(intent.entry && intent.entry.label) || null};
        };
        const rows = [];
        for(const row of assistantFocusCoverageLedger()){
          const help = ASSISTANT_GUIDE_HELP[guideKey(row.id)];
          const definition = ctx.name === 'opportunity-habit' && guideKey(row.id) === 'frequency'
            ? 'Repeat limit is the minimum' : help?.[0];
          const entry = {id:row.id, label:row.label,
            expected:norm(definition?.split(/\s+/).slice(0, 5).join(' ') || '')};
          const def = ask(`What does ${row.label} mean?`);
          entry.defIntent = def.intent && def.intent.kind || null;
          entry.def = def.text;
          // A shared label ("Start time") may resolve to the sibling that
          // applies here; the fingerprint then follows the resolved entry.
          entry.resolvedId = def.intent && def.intent.entry ? def.intent.entry.ids[0] : null;
          entry.expectedResolved = entry.resolvedId && entry.resolvedId !== row.id && guideKey(entry.resolvedId) !== guideKey(row.id)
            ? norm((ASSISTANT_GUIDE_HELP[guideKey(entry.resolvedId)] || [''])[0].split(/\s+/).slice(0, 5).join(' '))
            : '';
          entry.applies = assistantFocusFieldHelpApplies([row.id], s);
          if(entry.applies){
            const read = ask(`What’s my ${row.label}?`);
            entry.readIntent = read.intent && read.intent.kind || null;
            entry.readField = read.intent?.field;
            entry.read = read.text;
            const how = ask(`How do I change ${row.label}?`);
            entry.howIntent = how.intent && how.intent.kind || null;
            entry.how = how.text;
            entry.howLabel = how.label;
          }
          rows.push(entry);
        }
        if(ctx.name === 'habit'){
          const actions = {
            'detail-app-add':'action-add-app', 'detail-timer-toggle':'action-timer',
            'detail-export':'action-export', 'detail-share-item':'action-share', 'detail-ask-ai':'action-ask-ai',
            'detail-delete':'action-delete', 'detail-calendar':'computed-calendar-history',
            'detail-viz-seg':'computed-gap-history', 'detail-stats':'computed-progress-stats',
            'detail-order-block':'action-todays-order'
          };
          const extraFields = {'detail-times':['timesPerPeriod'], 'detail-days':['periodDays']};
          for(const [key, label] of ITEM_DETAIL_SEARCH_FIELDS){
            const answer = ask(`What does ${label} mean?`);
            const expected = actions[key] ? [actions[key]] : extraFields[key] || Object.entries(ASSISTANT_FIELD_SEARCH)
              .filter(([, target])=>target === key).map(([id])=>id);
            const ids = answer.intent?.entry?.ids || (answer.intent?.id ? [answer.intent.id] : []);
            rows.push({id:key, label, detailLabel:true, expected:expected.map(guideKey), ids:ids.map(guideKey), def:answer.text});
          }
        }
        for(const row of (window.ASSISTANT_FOCUS_EXTRA_HELP || []).filter(row => row.kinds.includes(s.kind))){
          const asked = ask(row.q);
          rows.push({id:row.id, label:row.label, extras:true,
            defIntent:asked.intent && asked.intent.kind || null, def:asked.text, probe:row.probe});
        }
        out.push({context:ctx.name, rows, zeroPasses:(s.timing.passes || []).length === passesBefore,
          changes:s.changes.length, unresolved:s.unresolved.length});
      }
      return out;
    });
    const decline = /don[’']t know/i;
    const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const DEFINITION_OVERRIDES = {anywhereAllowed:/saved places/i};
    for(const context of contexts){
      assert(context.zeroPasses, `${context.context}: the whole inventory answered with zero model passes`);
      assert(!context.changes && !context.unresolved, `${context.context}: answering staged nothing and asked nothing back`);
      for(const row of context.rows){
        const name = `${context.context} · ${row.label}`;
        const fail = detail => {throw new Error(`${name}: ${detail} — ${JSON.stringify(row).slice(0, 500)}`);};
        if(row.detailLabel){
          if(!row.expected.some(id => row.ids.includes(id)))fail('detail-search label has no matching field help');
          if(!row.def || decline.test(row.def))fail('detail-search label has no answer');
          passed++;
          continue;
        }
        if(row.extras){
          if(row.defIntent !== 'help')fail(`intent was ${row.defIntent}, not a help answer`);
          if(decline.test(row.def))fail('answered with the generic decline');
          if(!row.probe.test(row.def))fail(`answer misses its probe ${row.probe}`);
          passed++;
          continue;
        }
        // "What does Anywhere mean?" is answered by a curated explanation
        // entry that predates the field-help table; accept its copy instead
        // of the composer fingerprint.
        const override = DEFINITION_OVERRIDES[row.id];
        if(!override && row.defIntent !== 'definition')fail(`definition intent was ${row.defIntent}`);
        if(decline.test(row.def))fail('definition is the generic decline');
        if(override && !override.test(row.def))fail(`definition misses its curated copy probe ${override}`);
        const wanted = row.expectedResolved || row.expected;
        if(!override && wanted && !norm(row.def).includes(wanted))
          fail(`definition is not this entry's help text (wanted "${wanted}")`);
        if(!row.applies){passed++;continue;}
        if(row.readIntent !== 'field')fail(`value-read intent was ${row.readIntent}`);
        const expectedField = row.resolvedId || row.id;
        const sameRhythm = ['timesPerPeriod','periodDays'].includes(expectedField) && row.readField === 'timesPerPeriod';
        if(row.readField !== expectedField && !sameRhythm)fail(`value read selected ${row.readField} instead of ${expectedField}`);
        if(decline.test(row.read))fail('value read is the generic decline');
        if(!row.read.trim())fail('value read is empty');
        if(row.howIntent !== 'howChange')fail(`how-to-change intent was ${row.howIntent}`);
        if(decline.test(row.how))fail('how-to-change is the generic decline');
        if(!row.how.includes(row.label) && !(row.howLabel && row.how.includes(row.howLabel)))
          fail(`how-to-change names neither "${row.label}" nor its canonical entry`);
        passed++;
      }
    }
    assert(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
    console.log(`assistant-field-help-coverage-test: ${passed} assertions passed`);
    process.exit(0);
  }catch(error){
    console.error(`assistant-field-help-coverage-test FAILED after ${passed} assertions: ${error.message}`);
    process.exit(1);
  }finally{
    await browser.close().catch(() => {});
  }
})();
