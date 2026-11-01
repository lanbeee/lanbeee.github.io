// Browser download lifecycle and transport boundary. Tiny verified fixtures
// exercise real Cache Storage and fetch without downloading weights in CI.
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
const fs = require('fs');
const vm = require('vm');
let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log(`  ok: ${message}`);
}

(async()=>{
  let browser;
  try{ browser = await chromium.launch({headless:true,channel:'chrome'}); }
  catch(_){ browser = await chromium.launch({headless:true}); }
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    let downloads = 0;
    let failModel = false;
    let slow = false;
    await page.route('https://huggingface.co/**',async route=>{
      downloads++;
      if(slow)await new Promise(resolve=>setTimeout(resolve,150));
      const model = route.request().url().endsWith('.cact');
      await route.fulfill({status:failModel && model ? 503 : 200,
        body:Buffer.from(model ? 'model-fixture' : 'wasm-fixture')}).catch(()=>{});
    });
    await page.goto(BASE,{waitUntil:'load'});
    await waitForAssistant(page);
    assert(downloads === 0,'normal boot does not fetch model assets');
    assert(await page.evaluate(()=>assistantSettings().provider === 'needle' && !assistantSettings().on),'fresh settings default to optional Needle');
    const migration = await page.evaluate(()=>{
      Storage.write(SORT_SETTINGS_KEY,{localAssistantProvider:'auto',localAssistant:false});
      const unused = loadSortSettings().localAssistantProvider;
      Storage.write(SORT_SETTINGS_KEY,{localAssistantProvider:'auto',localAssistant:true});
      const active = loadSortSettings().localAssistantProvider;
      saveSortSettings({...DEFAULT_SORT_SETTINGS,localAssistantProvider:'auto'});
      const explicit = loadSortSettings().localAssistantProvider;
      saveSortSettings({...DEFAULT_SORT_SETTINGS});
      sortSettings = loadSortSettings();
      return {unused,active,explicit};
    });
    assert(migration.unused === 'needle' && migration.active === 'auto' && migration.explicit === 'auto','unused legacy defaults migrate, while active servers and later choices survive');
    await page.evaluate(()=>patchLocalAssistant({localAssistant:true}));
    await page.evaluate(()=>openAssistantSheet());
    assert(downloads === 0,'enabling and opening the assistant does not download');
    assert(await page.locator('#assistant-sheet [data-needle-download]').isVisible(),'first-use sheet offers the download');
    await page.locator('#assistant-input').fill('Remind me to call mom');
    assert(await page.locator('#assistant-send').isDisabled(),'sending waits for an explicit download');
    await page.evaluate(()=>sendAssistantMessage('Keep this instruction'));
    assert(await page.locator('#assistant-input').inputValue() === 'Keep this instruction','first-use entry retains the instruction');
    await page.evaluate(async()=>{
      for(const asset of ASSISTANT_NEEDLE_ASSETS){
        const bytes = new TextEncoder().encode(asset.path.endsWith('.cact') ? 'model-fixture' : 'wasm-fixture');
        asset.size = bytes.length;
        const hash = await crypto.subtle.digest('SHA-256',bytes);
        asset.sha = Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      }
    });
    failModel = true;
    await page.locator('#assistant-sheet [data-needle-download]').click();
    await page.waitForFunction(()=>assistantNeedleState().phase === 'error');
    assert(/503/.test(await page.locator('#assistant-sheet [data-needle-status]').textContent()),'failed download shows a useful retry error');
    failModel = false;
    const beforeRetry = downloads;
    assert(await page.evaluate(()=>assistantNeedleDownload()),'retry completes the missing asset');
    assert(downloads === beforeRetry + 1,'retry reuses the already verified runtime');
    assert(await page.evaluate(()=>assistantNeedleHasDownload()),'both verified assets are cached');
    assert(await page.locator('#assistant-send').isEnabled(),'download completion enables sending');
    const beforeReuse = downloads;
    await page.evaluate(()=>assistantNeedleCheckDownload());
    await page.evaluate(()=>assistantNeedleDownload());
    assert(downloads === beforeReuse,'cached assets require no second download');

    const transport = await page.evaluate(async()=>{
      const OriginalWorker = Worker;
      const sent = [];
      let terminated = false;
      let reply = {success:true,confidence:0.9,
        function_calls:[{name:'add_task',arguments:{name:'Mom'}}],
        suppressed_calls:[{name:'import_calendar',arguments:{}}]};
      globalThis.Worker = class {
        postMessage(data){
          sent.push(data);
          const result = data.type === 'load' ? true : reply;
          queueMicrotask(()=>this.onmessage({data:{id:data.id,result}}));
        }
        terminate(){terminated = true;}
      };
      try{
        const req = {messages:[{role:'user',content:JSON.stringify({request:'Remind me to call mom',catalog:{date:{iso:'2026-11-01',weekday:'Sun'}}})}],
          tools:assistantOllamaTools(['draft_item','answer_schedule','answer_settings']),step:'extract'};
        const result = await assistantComplete(req);
        reply = {success:true,function_calls:[],suppressed_calls:[{name:'add_habit',arguments:{name:'Walk',rhythm:'every day'}}]};
        const held = await assistantComplete(req);
        const continued = await assistantComplete({...req,messages:[...req.messages,{role:'tool',content:'{"ok":true,"preview":"Walk"}'}]});
        reply = {success:true,function_calls:[{name:'add_task',arguments:{name:'Invented',durationMinutes:90}}],validation:{ungrounded:['add_task.durationMinutes']}};
        const ungrounded = await assistantComplete(req);
        assistantAbortInFlight();
        return {calls:result.message.tool_calls,held:held.message.tool_calls,continued:continued.message.tool_calls,
          ungrounded:ungrounded.message.tool_calls,system:sent.find(m=>m.type === 'complete').system,terminated};
      }finally{ globalThis.Worker = OriginalWorker; }
    });
    assert(transport.calls.length === 2 && transport.calls[0].function.name === 'draft_item' && transport.calls[1].function.name === 'answer_settings','transport maps writes to previews and grounded held reads to app facts');
    assert(transport.calls[0].function.arguments.kind === 'task' && transport.calls[0].function.arguments.create,'task alias retains its model-selected kind');
    assert(transport.held.length === 1 && transport.held[0].function.arguments.kind === 'habit','a held write can stage a confirmation preview');
    assert(!transport.continued.length && !transport.ungrounded.length,'held continuations and ungrounded arguments cannot stage extra actions');
    assert(transport.system.includes('date: 2026-11-01') && !transport.system.includes('[object Object]'),'Needle receives the real ISO date');
    assert(transport.terminated,'cancel stops the inference worker');

    await page.evaluate(()=>patchLocalAssistant({localAssistantProvider:'lmstudio',localAssistantUrl:'http://localhost:1234',localAssistantModel:'existing'}));
    assert(await page.evaluate(()=>assistantSettings().provider === 'lmstudio' && assistantSettings().model === 'existing'),'server configurations still save');
    assert(!(await page.locator('#assistant-sheet [data-needle-download]').isVisible()),'server mode hides the download controls');
    await page.evaluate(()=>patchLocalAssistant({localAssistantProvider:'needle'}));
    await page.evaluate(()=>assistantNeedleRemove());
    assert(!(await page.evaluate(()=>assistantNeedleHasDownload())),'remove clears both optional assets');
    slow = true;
    await page.evaluate(()=>{ void assistantNeedleDownload(); });
    await page.waitForFunction(()=>assistantNeedleState().phase === 'downloading');
    await page.evaluate(()=>assistantNeedleCancelDownload());
    await page.waitForFunction(()=>assistantNeedleState().phase === 'missing');
    assert(!(await page.evaluate(()=>assistantNeedleHasDownload())),'cancelled download is not marked ready');

    // Exercise the actual activation handler: app updates preserve the model.
    const handlers = {}, removed = [];
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{
      self:{addEventListener:(name,fn)=>{handlers[name] = fn;},clients:{claim:async()=>{}}},
      caches:{keys:async()=>['tings-v1','tings-needle-v1','tings-maps-v3','tings-v685'],delete:async key=>removed.push(key)}
    });
    let activation;
    handlers.activate({waitUntil:promise=>{activation = promise;}});
    await activation;
    assert(removed.includes('tings-v1') && !removed.includes('tings-needle-v1'),'app-shell upgrade preserves the model cache');
    assert(errors.length === 0,`no page errors (${errors.join('; ')})`);
    if(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH){
      const live = await browser.newPage({viewport:{width:390,height:844}});
      let fetches = 0;
      await live.route('https://huggingface.co/**',route=>{
        fetches++;
        return route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm') ? process.env.NEEDLE_WASM_PATH : process.env.NEEDLE_MODEL_PATH)});
      });
      await live.goto(BASE,{waitUntil:'load'});
      await waitForAssistant(live);
      await live.evaluate(()=>patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'}));
      assert(await live.evaluate(()=>assistantNeedleDownload()),'real pinned model and WASM pass integrity checks');
      const outcomes = await live.evaluate(async()=>{
        const task = await runAssistantTurn('Remind me to call mom tomorrow');
        const habit = await runAssistantTurn('Add a 20 minute Walk habit every day');
        const commit = habit.draft ? assistantCommitDraft(habit.draft) : {ok:false};
        const edit = await runAssistantTurn('Change Walk to 45 minutes');
        const schedule = await runAssistantTurn('What is on my schedule today?');
        return {task:{type:task.type,kind:task.draft?.kind,name:task.draft?.name},
          habit:{type:habit.type,kind:habit.draft?.kind,duration:habit.draft?.durationMinutes,times:habit.draft?.timesPerPeriod,period:habit.draft?.periodDays},
          commit:commit.ok,edit:{type:edit.type,name:edit.draft?.name,duration:edit.draft?.durationMinutes},
          schedule:{type:schedule.type,text:schedule.text}};
      });
      assert(outcomes.task.type === 'preview' && outcomes.task.kind === 'task' && /mom/i.test(outcomes.task.name),`real Needle creates a task preview (${JSON.stringify(outcomes.task)})`);
      assert(outcomes.habit.type === 'preview' && outcomes.habit.kind === 'habit' && outcomes.habit.duration === 20 && outcomes.habit.times === 1 && outcomes.habit.period === 1,'real Needle creates a daily habit with its duration');
      assert(outcomes.commit && outcomes.edit.type === 'preview' && outcomes.edit.name === 'Walk' && outcomes.edit.duration === 45,`real Needle edits the saved habit (${JSON.stringify(outcomes.edit)})`);
      assert(outcomes.schedule.type === 'say' && outcomes.schedule.text,'real Needle answers from the actual schedule tool');
      const compound=await live.evaluate(async()=>{
        const out=await runAssistantTurn('Remind me to call mom tomorrow. Add a task to buy milk tomorrow. What is on my schedule tomorrow?');
        return {type:out.type,names:out.drafts?.map(d=>d.name),kinds:out.drafts?.map(d=>d.kind),answer:out.alsoText,text:out.text};
      });
      assert(compound.type === 'preview' && compound.names?.length === 2 && compound.kinds.every(k=>k === 'task') && compound.answer,
        `real Needle handles two task requests and a schedule question (${JSON.stringify(compound)})`);
      const features=await live.evaluate(async()=>{
        const calendar=await runAssistantTurn('Import my meetings from an ICS calendar file');
        const display=await runAssistantTurn('How do I pair a glance display?');
        return {calendar:{type:calendar.type,nav:calendar.navigation},display:{type:display.type,nav:display.navigation}};
      });
      assert(features.calendar.type === 'say' && features.calendar.nav?.[0]?.section === 'settings-calendar-body','real Needle discovers calendar import');
      assert(features.display.type === 'say' && features.display.nav?.[0]?.section === 'settings-agenda-body','real Needle discovers display pairing');
      // Make sure the shell has installed before taking the device offline.
      await live.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
      await live.context().setOffline(true);
      await live.reload({waitUntil:'load'});
      await waitForAssistant(live);
      const offline = await live.evaluate(async()=>{
        const out = await runAssistantTurn('Remind me to call mom tomorrow');
        return {type:out.type,name:out.draft?.name,text:out.text};
      });
      assert(offline.type === 'preview' && /mom/i.test(offline.name),`real Needle works after an offline page reload (${JSON.stringify(offline)})`);
      assert(fetches === 2,'real model is downloaded once and reused after reload');
      await live.close();
    }else console.log('  skip: real Needle checks (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');
    console.log(`\n${passed} passed`);
  }finally{ await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode = 1;});
