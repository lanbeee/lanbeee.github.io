// Focused Needle sessions edit one item or create one item.
// Scripted extracts prove staging. The live section runs only with the pinned model.
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
const fs = require('fs');
let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log(`  ok: ${message}`);
}

(async()=>{
  let browser;
  try{ browser = await chromium.launch({headless:true, channel:'chrome'}); }
  catch(_){ browser = await chromium.launch({headless:true}); }
  try{
    const page = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE, {waitUntil:'load'});
    await waitForAssistant(page);
    const gym = await page.evaluate(async()=>{
      save([{
        hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45,
        emoji:'🏋️', logs:[{ts:1}], priority:1, allowedWeekdays:[], allowedTimeStart:null
      }]);
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym', entry:'home'});
      const extract = async spec => {
        if(spec.family === 'families')return {confidence:0.92, function_calls:[{arguments:{
          evidence:'recurrence: Three times a week; effort: 30 minutes each; schedule: weekdays after 6pm'
        }}]};
        if(spec.family === 'recurrence')return {confidence:0.92, function_calls:[{arguments:{phrase:'Three times a week', times:'3', period:'a week'}}]};
        if(spec.family === 'effort')return {confidence:0.92, function_calls:[{arguments:{phrase:'30 minutes each', duration:'30 minutes'}}]};
        if(spec.family === 'schedule')return {confidence:0.92, function_calls:[{arguments:{phrase:'weekdays after 6pm', weekdays:'weekdays', window:'after 6pm'}}]};
        if(spec.family === 'completeness')return {function_calls:[{arguments:{missing:''}}]};
        return {function_calls:[{arguments:{}}]};
      };
      await assistantFocusTurn(session, 'Three times a week, 30 minutes each, weekdays after 6pm', {extract});
      const record = assistantFocusMaterialize(session);
      const parts = rhythmParts(record.target);
      return {
        name:record.name, emoji:record.emoji, logs:record.logs.length, priority:record.priority,
        times:parts.times, days:parts.days, duration:record.durationMinutes,
        weekdays:record.allowedWeekdays, start:record.allowedTimeStart,
        fields:session.changes.map(change => change.field),
        canSave:assistantFocusCanSave(session)
      };
    });
    assert(gym.times === 3 && gym.days === 7 && gym.duration === 30, `gym stages rhythm and duration (${JSON.stringify(gym)})`);
    assert(Array.isArray(gym.weekdays) && gym.weekdays.join() === '1,2,3,4,5' && gym.start === 18 * 60, `gym stages weekdays after 6pm (${JSON.stringify(gym)})`);
    assert(gym.name === 'Gym' && gym.emoji === '🏋️' && gym.logs === 1 && gym.priority === 1 && !gym.fields.includes('name'), 'gym keeps the name, emoji, logs, and priority');
    assert(gym.fields.every(field => ['timesPerPeriod','periodDays','durationMinutes','allowedWeekdays','allowedWindow'].includes(field)), `gym does not stage other settings (${gym.fields.join(',')})`);
    assert(gym.canSave, 'a complete gym edit can be saved');

    const duration = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym', entry:'home'});
      const extract = async spec => {
        if(spec.family === 'families')return {confidence:0.9, function_calls:[{arguments:{evidence:'effort: 45 minutes'}}]};
        if(spec.family === 'effort')return {confidence:0.4, function_calls:[{arguments:{phrase:'45 minutes', duration:'45 minutes', name:'Walk habit'}}]};
        if(spec.family === 'completeness')return {function_calls:[{arguments:{missing:''}}]};
        return {function_calls:[{arguments:{}}]};
      };
      await assistantFocusTurn(session, 'Make this 45 minutes', {extract});
      const record = assistantFocusMaterialize(session);
      return {name:record.name, duration:record.durationMinutes, fields:session.changes.map(change => change.field), uncertain:session.changes.some(change => change.uncertain)};
    });
    assert(duration.name === 'Gym' && duration.duration === 45 && duration.fields.join() === 'durationMinutes', `duration edit does not rename (${JSON.stringify(duration)})`);

    const named = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'create', kind:'habit', entry:'add'});
      const sentence = 'Please turn this whole long description into the habit name tomorrow morning';
      const extract = async spec => {
        if(spec.family === 'families')return {function_calls:[{arguments:{evidence:`identity: ${sentence}`}}]};
        if(spec.family === 'identity')return {function_calls:[{arguments:{phrase:sentence, name:sentence}}]};
        if(spec.family === 'completeness')return {function_calls:[{arguments:{missing:''}}]};
        return {function_calls:[{arguments:{}}]};
      };
      await assistantFocusTurn(session, sentence, {extract});
      return {canSave:assistantFocusCanSave(session), fields:session.changes.map(change => change.field), unresolved:session.unresolved.map(item => item.field)};
    });
    assert(!named.canSave && !named.fields.includes('name') && named.unresolved.includes('name'), `a long sentence is not saved as the name (${JSON.stringify(named)})`);

    const question = await page.evaluate(async()=>{
      const before = JSON.stringify(load());
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym', entry:'home'});
      const extract = async spec => {
        if(spec.family === 'families')return {function_calls:[{arguments:{evidence:'', outside:'question: What is on my schedule today?'}}]};
        return {function_calls:[{arguments:{}}]};
      };
      await assistantFocusTurn(session, 'What is on my schedule today?', {extract});
      return {canSave:assistantFocusCanSave(session), same:before === JSON.stringify(load()), unresolved:session.unresolved.map(item => item.field)};
    });
    assert(!question.canSave && question.same && question.unresolved.includes('question'), 'a question is not another action and writes nothing');

    const recovery = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym'});
      const tool = assistantFocusToolFor('schedule', session), seen = [];
      const call = await assistantFocusModel(session, {family:'schedule', tool, request:'before sunset'}, async spec => {
        const keys = Object.keys(spec.tool.parameters.properties);seen.push(keys);
        if(keys.length > 2)throw new Error('tool call truncated: token budget exhausted');
        return {confidence:0.9, function_calls:[{arguments:Object.fromEntries(keys.map(key => [key,key]))}]};
      });
      return {keys:Object.keys(call.args), expected:Object.keys(tool.parameters.properties), calls:seen.length,
        issue:call.raw._needleIssue, recovered:call.raw._recoveredBudget};
    });
    assert(recovery.recovered && !recovery.issue && recovery.keys.join() === recovery.expected.join() && recovery.calls <= 15,
      'budget recovery subdivides the schema with every field retained and bounded calls');

    const continuation = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym'});
      const before = JSON.stringify(load()), counts = {}, checkpoints = [];
      const extract = async spec => {
        counts[spec.family] = (counts[spec.family] || 0) + 1;
        if(spec.family === 'schedule' && counts.schedule === 1)throw new Error('Worker interrupted');
        const args = spec.family === 'families' ? {evidence:'effort: 30 minutes long; schedule: before sunset'}
          : spec.family === 'effort' ? {duration:'30 minutes'} : spec.family === 'schedule' ? {window:'before sunset'} : {missing:''};
        return {confidence:0.95, function_calls:[{arguments:args}]};
      };
      await assistantFocusTurn(session, 'Make it 30 minutes long, only before sunset', {extract, onProgress:info => {
        if(info.phase === 'staged')checkpoints.push(session.changes.map(row => row.field));
      }});
      const paused = {duration:assistantFocusMaterialize(session).durationMinutes, pending:session.pendingFamilies.slice(),
        canSave:assistantFocusCanSave(session), html:assistantFocusReviewHtml(session)};
      await assistantFocusTurn(session, '', {extract, resume:true});
      assistantFocusApprove(session);
      return {paused, counts, checkpoints, pending:session.pendingFamilies, canSave:assistantFocusCanSave(session),
        same:before === JSON.stringify(load()), end:assistantFocusMaterialize(session).allowedTimeEndAnchor,
        jobs:session.jobs.map(row=>({family:row.family,attempts:row.attempts,status:row.status}))};
    });
    assert(continuation.paused.duration === 30 && !continuation.paused.canSave
      && continuation.paused.pending.join() === 'schedule' && continuation.paused.html.includes('data-focus-choice="resume"')
      && continuation.checkpoints.some(fields=>fields.includes('durationMinutes')), 'an interrupted pass shows the completed draft and offers Continue');
    assert(continuation.counts.effort === 1 && continuation.jobs.find(row=>row.family==='schedule').attempts === 2 && continuation.counts.families === 1
      && !continuation.pending.length && continuation.canSave && continuation.same && continuation.end === 'maghrib',
      'Continue retries only unfinished work and never writes the habit before confirmation');

    const exhaustion = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym'});
      let calls = 0;
      const extract = async spec => {
        if(spec.family === 'families')return {function_calls:[{arguments:{evidence:'schedule: before sunset'}}]};
        calls++;throw new Error('tool call truncated: token budget exhausted');
      };
      await assistantFocusTurn(session, 'before sunset', {extract});
      const html = assistantFocusReviewHtml(session);
      return {calls, pending:session.pendingFamilies, canSave:assistantFocusCanSave(session),
        friendly:!html.includes('token budget exhausted') && html.includes('data-focus-choice="resume"')};
    });
    assert(exhaustion.calls <= 15 && exhaustion.pending.join() === 'schedule' && !exhaustion.canSave && exhaustion.friendly,
      'exhausted single-field reads retain a bounded, resumable draft with a useful message');

    const completenessRetry = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym'}), counts = {};
      const extract = async spec => {
        counts[spec.family] = (counts[spec.family] || 0) + 1;
        if(spec.family === 'completeness' && counts.completeness === 1)throw new Error('tool call truncated: token budget exhausted');
        return {confidence:0.95, function_calls:[{arguments:spec.family === 'families' ? {evidence:'effort: 30 minutes'}
          : spec.family === 'effort' ? {duration:'30 minutes'} : {missing:''}}]};
      };
      await assistantFocusTurn(session, '30 minutes', {extract});
      const blocked = !assistantFocusCanSave(session) && Boolean(session.continuationError);
      await assistantFocusTurn(session, '', {extract, resume:true});
      return blocked && assistantFocusCanSave(session) && counts.effort === 1 && counts.completeness === 2;
    });
    assert(completenessRetry, 'a failed final check resumes that check while retaining earlier results');

    const independent = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'create', kind:'habit'}), started = [];
      let release;const gate = new Promise(resolve=>{release = resolve;});
      const extract = async spec => {
        started.push(spec.family);
        if(['families','identity','recurrence'].includes(spec.family))await gate;
        return {confidence:0.95, function_calls:[{arguments:spec.family === 'families' ? {evidence:'identity: Walk; recurrence: every other day; schedule: before sunset'}
          : spec.family === 'identity' ? {name:'Walk'} : spec.family === 'recurrence' ? {times:'every other day',period:'every other day'}
          : spec.family === 'schedule' ? {window:'before sunset'} : {missing:''}}]};
      };
      const pending = assistantFocusTurn(session, 'Walk every other day before sunset', {extract});
      await new Promise(resolve=>setTimeout(resolve,0));
      const together = ['families','identity','recurrence'].every(family=>started.includes(family));
      release();await pending;
      return {together, name:assistantFocusMaterialize(session).name, jobs:session.jobs.map(row=>[row.family,row.attempts])};
    });
    assert(independent.together && independent.name === 'Walk' && independent.jobs.filter(row=>row[0]==='identity').length===1,
      'create starts name, frequency, and discovery independently without duplicate jobs');

    const stale = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit',kind:'habit',targetId:'gym'});
      let release, entered;const gate = new Promise(resolve=>{release = resolve;}), ready = new Promise(resolve=>{entered = resolve;});
      const extract = async spec => {
        const old = spec.request.includes('30 minutes');
        if(spec.family === 'effort' && old){entered();await gate;}
        return {confidence:0.95,function_calls:[{arguments:spec.family === 'families' ? {evidence:`effort: ${old ? 30 : 60} minutes`}
          : spec.family === 'effort' ? {duration:`${old ? 30 : 60} minutes`} : {missing:''}}]};
      };
      const first = assistantFocusTurn(session,'30 minutes',{extract});await ready;
      await assistantFocusTurn(session,'60 minutes',{extract});release();const retired = await first;
      return retired.cancelled && assistantFocusMaterialize(session).durationMinutes === 60;
    });
    assert(stale, 'a late result from an older request cannot overwrite the newer correction');

    const followup = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit',kind:'habit',targetId:'gym'}), inputs = [];
      let interrupted = false;
      const extract = async spec => {
        if(spec.family === 'schedule'){
          inputs.push(spec.request);
          if(!interrupted){interrupted = true;throw new Error('Interrupted extraction');}
        }
        return {confidence:0.95,function_calls:[{arguments:spec.family === 'families'
          ? {evidence:spec.request.includes('sunset') ? 'effort: 30 minutes long; schedule: before sunset' : 'effort: 60 minutes'}
          : spec.family === 'effort' ? {duration:spec.request.includes('60') ? '60 minutes' : '30 minutes'}
          : spec.family === 'schedule' ? {window:'before sunset'} : {missing:''}}]};
      };
      const original = '30 minutes long, only before sunset';
      await assistantFocusTurn(session,original,{extract});
      await assistantFocusTurn(session,'60 minutes',{extract});
      const record = assistantFocusMaterialize(session);
      return record.durationMinutes === 60 && record.allowedTimeEndAnchor === 'maghrib'
        && inputs.every(text=>text===original) && assistantFocusCanSave(session);
    });
    assert(followup, 'a new correction preserves unfinished work with its original input and grounding');

    const discoveryRetry = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'create',kind:'habit'}), counts = {};
      const extract = async spec => {
        counts[spec.family]=(counts[spec.family]||0)+1;
        if(spec.family==='families' && counts.families===1)throw new Error('Discovery interrupted');
        return {confidence:0.95,function_calls:[{arguments:spec.family==='families' ? {evidence:'identity: Walk; recurrence: every other day'}
          : spec.family==='identity' ? {name:'Walk'} : spec.family==='recurrence' ? {times:'every other day',period:'every other day'} : {missing:''}}]};
      };
      await assistantFocusTurn(session,'Walk every other day',{extract});
      const retained = Boolean(session.continuationError) && assistantFocusMaterialize(session).name==='Walk';
      await assistantFocusTurn(session,'',{extract,resume:true});
      return retained && counts.identity===1 && counts.recurrence===1 && counts.families===2 && assistantFocusCanSave(session);
    });
    assert(discoveryRetry, 'failed discovery resumes independently while keeping the completed name and frequency');

    const saveDuringRead = await page.evaluate(async()=>{
      const session = assistantFocusOpen({operation:'edit',kind:'habit',targetId:'gym'});
      let release, entered;const gate=new Promise(resolve=>{release=resolve;}), ready=new Promise(resolve=>{entered=resolve;});
      const extract = async spec => {
        if(spec.family==='completeness'){entered();await gate;}
        return {confidence:0.95,function_calls:[{arguments:spec.family==='families' ? {evidence:'effort: 30 minutes'}
          : spec.family==='effort' ? {duration:'30 minutes'} : {missing:''}}]};
      };
      const pending=assistantFocusTurn(session,'30 minutes',{extract});await ready;
      const blocked=!assistantFocusCanSave(session) && !(await assistantFocusCommit(session)).ok;
      release();await pending;
      return blocked && assistantFocusCanSave(session) && load()[0].durationMinutes===45;
    });
    assert(saveDuringRead, 'even direct Save calls stay blocked until the final inference finishes');

    assert(errors.length === 0, `no page errors (${errors.join('; ')})`);

    if(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH){
      const livePage = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block'});
      await livePage.route('https://huggingface.co/**', route => {
        return route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm') ? process.env.NEEDLE_WASM_PATH : process.env.NEEDLE_MODEL_PATH)});
      });
      await livePage.goto(BASE, {waitUntil:'load'});
      await waitForAssistant(livePage);
      const live = await livePage.evaluate(async()=>{
        patchLocalAssistant({localAssistant:true, localAssistantProvider:'needle'});
        await assistantNeedleDownload();
        save([{hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, emoji:'🏋️', logs:[{ts:1}], priority:1}]);
        const session = assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym', entry:'home'});
        await assistantFocusTurn(session, 'Three times a week, 30 minutes each, weekdays after 6pm');
        const record = assistantFocusMaterialize(session);
        const parts = rhythmParts(record.target);
        return {
          name:record.name, emoji:record.emoji, logs:record.logs.length, priority:record.priority,
          times:parts.times, days:parts.days, duration:record.durationMinutes,
          weekdays:record.allowedWeekdays, start:record.allowedTimeStart,
          fields:session.changes.map(change => ({field:change.field, source:change.source})),
          unresolved:session.unresolved,
          passes:session.timing.passes,
          trace:(session.trace || []).map(row => ({family:row.family, args:row.args, calls:row.calls, suppressed:row.suppressed, content:String(row.content || '').slice(0, 240), reasoning:String(row.reasoning || '').slice(0, 240)}))
        };
      });
      fs.writeFileSync('test-results/needle-focus-live.json', JSON.stringify(live, null, 2));
      assert(live.passes && live.passes.length > 0, 'live Needle ran');
      assert(live.times === 3 && live.days === 7 && live.duration === 30
        && (live.weekdays || []).join() === '1,2,3,4,5' && live.start === 18 * 60
        && live.name === 'Gym' && live.emoji === '🏋️' && live.logs === 1 && live.priority === 1,
        `live Needle stages only Gym's four settings (${JSON.stringify(live)})`);
      const addRuns = [];
      livePage.on('pageerror', error => errors.push(error.message));
      for(let attempt = 0; attempt < 2; attempt++){
        await livePage.evaluate(()=>{
          closeAssistantSheet();save([]);$('open-add').click();
          $('ting-message').value = 'Walk every other day before sunset';
          $('ting-ask-ai').click();
        });
        await livePage.waitForFunction(()=>_assistantSession?.focus?.currentRequest === 'Walk every other day before sunset' && !_assistantBusy, null, {timeout:120000});
        const added = await livePage.evaluate(async()=>{
          const session = _assistantSession.focus, record = assistantFocusMaterialize(session), rhythm = rhythmParts(record.target);
          const review = assistantThreadEl().querySelector('[data-focus-review]');
          const before = load().length;
          const approve = review?.querySelector('[data-focus-approve]');
          if(approve)await assistantHandleFocusClick(approve);
          const saveButton = assistantThreadEl().querySelector('[data-focus-save]');
          const ready = saveButton && !saveButton.disabled;
          if(ready)await assistantHandleFocusClick(saveButton);
          return {name:record.name, rhythm, end:record.allowedTimeEndAnchor, fixed:record.allowedTimeFixedStart,
            weekdays:record.allowedWeekdays, unresolved:session.unresolved, before, ready, saved:load().length,
            savedRecord:load()[0], addClosed:!$('add-sheet').classList.contains('open'),
            errorText:/tool call truncated|token budget exhausted/i.test(assistantThreadEl().textContent), trace:session.trace};
        });
        addRuns.push(added);
        fs.writeFileSync('test-results/needle-focus-sunset-add-live.json', JSON.stringify(addRuns, null, 2));
        assert(added.name === 'Walk' && added.rhythm.times === 1 && added.rhythm.days === 2 && added.end === 'maghrib'
          && !added.fixed && !added.weekdays.length && !added.unresolved.length && !added.errorText,
          `live add screen reads Walk every other day before sunset (attempt ${attempt + 1})`);
        assert(added.before === 0 && added.ready && added.saved === 1 && added.savedRecord.name === 'Walk'
          && added.savedRecord.allowedTimeEndAnchor === 'maghrib' && added.addClosed,
          `live add screen requires approval and saves the complete habit on confirmation (attempt ${attempt + 1})`);
        const intervals = added.trace.filter(row=>row.inference).map(row=>({...row.inference,lane:row.workerLane}));
        const lanes = new Set(intervals.map(row=>row.lane));
        const overlap = intervals.some((row,index)=>intervals.slice(index+1).some(other=>row.lane!==other.lane
          && row.startedAt < other.endedAt && other.startedAt < row.endedAt));
        assert(lanes.size === 3 && overlap, `live add screen uses three workers with overlapping inference (attempt ${attempt + 1})`);
      }
      const liveRecovery = await livePage.evaluate(async()=>{
        save([{hid:'recovery',name:'Walk',type:'keepup',target:7,durationMinutes:45,logs:[]}]);
        const session = assistantFocusOpen({operation:'edit',kind:'habit',targetId:'recovery'});
        const original = assistantNeedleLaneRequest;let injected = false;
        assistantNeedleLaneRequest = (lane,type,payload,transfer)=>{
          const pending = original(lane,type,payload,transfer);
          if(type==='focus' && payload.tools[0].name==='change_availability' && !injected){
            injected = true;
            setTimeout(()=>{const worker=lane.worker;if(worker){worker.terminate();worker.onerror();}},30);
          }
          return pending;
        };
        try{
          await assistantFocusTurn(session,'Three times a week, 30 minutes each, weekdays after 6pm');
          const record = assistantFocusMaterialize(session);
          return {injected,duration:record.durationMinutes,start:record.allowedTimeStart,pending:session.pendingFamilies,
            unresolved:session.unresolved,jobs:session.jobs.map(row=>({family:row.family,attempts:row.attempts,status:row.status})),trace:session.trace};
        }finally{assistantNeedleLaneRequest = original;}
      });
      fs.writeFileSync('test-results/needle-focus-worker-recovery-live.json',JSON.stringify(liveRecovery,null,2));
      assert(liveRecovery.injected && liveRecovery.duration===30 && liveRecovery.start===18*60
        && !liveRecovery.pending.length && !liveRecovery.unresolved.length
        && liveRecovery.jobs.find(row=>row.family==='effort')?.attempts===1
        && liveRecovery.jobs.find(row=>row.family==='schedule')?.attempts===2,
        `live model recovers a terminated worker without restarting its successful sibling (${JSON.stringify(liveRecovery.jobs)})`);
      assert(!errors.length, `live add screen has no page errors (${errors.join('; ')})`);
      await livePage.close();
    }else console.log('  skip: live focused Needle (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');
    console.log(`\n${passed} passed`);
  }finally{
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
