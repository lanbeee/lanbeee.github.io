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
