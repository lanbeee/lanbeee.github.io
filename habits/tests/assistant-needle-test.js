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
    assert(await page.evaluate(()=>assistantSettings().provider === 'needle' && assistantSettings().on),'fresh settings default to on-device Needle');
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
    await page.evaluate(()=>{
      save([{hid:'needle-gate',name:'Walk',type:'keepup',target:7,durationMinutes:20,logs:[]}]);
      patchLocalAssistant({localAssistant:true});
    });
    assert(await page.locator('#open-assistant').isHidden() && await page.locator('#bar-open-assistant').isHidden(),'Needle hides standalone chat buttons');
    assert(await page.evaluate(()=>openAssistantSheet()) === false,'Needle does not open a general chat');
    assert(downloads === 0,'enabling the assistant does not download');
    assert(await page.evaluate(()=>assistantOpenForItem('needle-gate','home')) === true,'Edit with AI opens the focused sheet');
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
    assert(await page.locator('#assistant-sheet [data-needle-panel]').isHidden(),'ready chat hides the downloaded note');
    assert(/downloaded/i.test(await page.locator('#settings-assistant-body [data-needle-status]').textContent()),'settings still says Needle is downloaded');
    const beforeReuse = downloads;
    await page.evaluate(()=>assistantNeedleCheckDownload());
    await page.evaluate(()=>assistantNeedleDownload());
    assert(downloads === beforeReuse,'cached assets require no second download');

    const faults = await page.evaluate(async()=>{
      const OriginalWorker=Worker,originalTimer=setTimeout;
      let terminated=0;
      globalThis.Worker=class{
        postMessage(data){if(data.type==='load')queueMicrotask(()=>this.onmessage({data:{id:data.id,result:true}}));}
        terminate(){terminated++;}
      };
      try{
        const rows=[];
        for(const mode of ['crash','timeout']){
          await assistantNeedleEnsureReady();
          const generation=_assistantNeedleGeneration;
          let expire;
          if(mode==='timeout')globalThis.setTimeout=(fn,ms,...args)=>{
            if(ms===180000){expire=fn;return originalTimer(()=>{},180000);}
            return originalTimer(fn,ms,...args);
          };
          const pending=assistantNeedleRequest('complete',{}).catch(error=>error.message);
          if(mode==='crash')_assistantNeedleWorker.onerror();else expire();
          rows.push({mode,error:await pending,preserved:generation===_assistantNeedleGeneration,
            reset:!_assistantNeedleReady && !_assistantNeedleWorker && !_assistantNeedlePending.size});
          globalThis.setTimeout=originalTimer;
        }
        await assistantNeedleEnsureReady();
        const generation=_assistantNeedleGeneration;
        const pending=assistantNeedleRequest('complete',{}).catch(error=>error.name);
        assistantNeedleStop();
        return {rows,terminated,cancelled:(await pending)==='AbortError' && generation!==_assistantNeedleGeneration};
      }finally{assistantNeedleStop();globalThis.Worker=OriginalWorker;globalThis.setTimeout=originalTimer;}
    });
    for(const row of faults.rows)assert(row.preserved && row.reset && /retry/i.test(row.error),
      `${row.mode} releases the runtime and requests without cancelling staged work`);
    assert(faults.terminated===3 && faults.cancelled,'failed runtimes restart and an explicit stop still cancels');

    const pool = await page.evaluate(async()=>{
      const OriginalWorker = Worker, instances = [];
      let active = 0, maximum = 0, terminated = 0;
      globalThis.Worker = class {
        constructor(){this.index = instances.length;instances.push(this);}
        postMessage(data){
          if(data.type === 'load'){queueMicrotask(()=>this.onmessage({data:{id:data.id,result:true}}));return;}
          active++;maximum = Math.max(maximum, active);
          setTimeout(()=>{
            active--;
            if(data.crash)this.onerror();
            else this.onmessage({data:{id:data.id,result:{nonce:data.nonce,function_calls:[]}}});
          },20);
        }
        terminate(){terminated++;}
      };
      try{
        const results = await Promise.all(Array.from({length:6},(_,nonce)=>assistantNeedleFocusRequest({nonce})));
        const capacity = {maximum, workers:instances.length, lanes:[...new Set(results.map(row=>row._workerLane))],
          ordered:results.every((row,index)=>row.nonce === index)};
        const isolated = await Promise.allSettled([
          assistantNeedleFocusRequest({nonce:'first'}), assistantNeedleFocusRequest({crash:true}), assistantNeedleFocusRequest({nonce:'third'})
        ]);
        const restarted = await Promise.all(Array.from({length:3},(_,nonce)=>assistantNeedleFocusRequest({nonce:'restart-'+nonce})));
        const restartCount = instances.length;
        const waiting = Array.from({length:6},()=>assistantNeedleFocusRequest({}).catch(error=>error.name));
        await new Promise(resolve=>setTimeout(resolve,0));
        assistantNeedleStop();
        const cancelled = await Promise.all(waiting);
        return {capacity, statuses:isolated.map(row=>row.status), restarted:restarted.every((row,index)=>row.nonce==='restart-'+index), restartCount,
          cancelled:cancelled.every(name=>name==='AbortError'), empty:!_assistantNeedleFocusLanes.length && !_assistantNeedleFocusWaiting.length,
          terminated};
      }finally{assistantNeedleStop();globalThis.Worker = OriginalWorker;}
    });
    assert(pool.capacity.maximum === 3 && pool.capacity.workers === 3 && pool.capacity.lanes.length === 3 && pool.capacity.ordered,
      'three independent focus workers bound concurrency and keep queued replies matched to their jobs');
    assert(pool.statuses.join() === 'fulfilled,rejected,fulfilled' && pool.restarted && pool.restartCount === 4,
      'a failed focus worker leaves its siblings running and later requests can restart');
    assert(pool.cancelled && pool.empty && pool.terminated >= 3,
      'stopping inference rejects active and queued focus jobs and releases all three workers');

    const memoryFallback = await page.evaluate(async()=>{
      const OriginalWorker = Worker;let created = 0;
      globalThis.Worker = class {
        constructor(){this.index = created++;}
        postMessage(data){queueMicrotask(()=>this.onmessage({data:{id:data.id,
          ...(data.type==='load' && this.index ? {error:'Not enough memory to load Needle 3.'}
            : {result:data.type==='load' ? true : {nonce:data.nonce}})}}));}
        terminate(){}
      };
      try{
        const results = await Promise.allSettled(Array.from({length:5},(_,nonce)=>assistantNeedleFocusRequest({nonce})));
        const after = await assistantNeedleFocusRequest({nonce:'after'});
        return results.filter(row=>row.status==='fulfilled').length===3 && results.filter(row=>row.status==='rejected').length===2
          && _assistantNeedleFocusLanes.filter(lane=>lane.disabled).length===2 && after.nonce==='after' && after._workerLane===0;
      }finally{assistantNeedleStop();globalThis.Worker=OriginalWorker;}
    });
    assert(memoryFallback,'extra-worker allocation failures release queued work onto the surviving worker');

    const transport = await page.evaluate(async()=>{
      const OriginalWorker = Worker;
      const sent = [];
      let terminated = false;
      let reply = {success:true,confidence:0.9,
        function_calls:[{name:'add_task',arguments:{name:'Mom'}}],
        suppressed_calls:[{name:'import_calendar',arguments:{subject:'calendar'}}]};
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
        reply = {success:true,function_calls:[{name:'change_frequency',arguments:{name:'Concentricity check',frequency:'3 times a week'}}]};
        const frequency = await assistantComplete({...req,messages:[{role:'user',content:JSON.stringify({request:'Change Concentricity check to 3 times a week',catalog:{date:{iso:'2026-11-01'}}})}]});
        const feedback = 'You thought but did not call a tool. Call the matching tool now.';
        await assistantComplete({...req,think:false,messages:[...req.messages,{role:'user',content:feedback}]});
        const repair = sent[sent.length - 1];
        const invalidTurn = assistantNeedleTurn({...req,think:false,messages:[...req.messages,{role:'user',
          content:'That tool call was invalid (The repetition phrase could not be validated.). Think again, then call classify_intent with valid arguments.'}]});
        reply = {success:true,function_calls:[],suppressed_calls:[{name:'add_habit',arguments:{name:'Walk',frequency:'every day'}}]};
        const habitReq={...req,messages:[{role:'user',content:JSON.stringify({request:'Add a Walk habit every day',catalog:{date:{iso:'2026-11-01'}}})}]};
        const held = await assistantComplete(habitReq);
        const continued = await assistantComplete({...habitReq,messages:[...habitReq.messages,{role:'tool',content:'{"ok":true,"preview":"Walk"}'}]});
        reply = {success:true,function_calls:[{name:'add_task',arguments:{name:'Invented',durationMinutes:90}}],validation:{ungrounded:['add_task.durationMinutes']}};
        const ungrounded = await assistantComplete(req);
        reply = {success:true,function_calls:[{name:'change_duration',arguments:{durationMinutes:90}}],validation:{ungrounded:['change_duration.durationMinutes']}};
        const converted = await assistantComplete({...req,messages:[{role:'user',content:JSON.stringify({request:'Change the duration to 1.5 hours',currentDraft:{name:'Walk',kind:'habit'},catalog:{date:{iso:'2026-11-01',weekday:'Sun'}}})}]});
        reply = {success:true,function_calls:[{name:'change_duration',arguments:{durationMinutes:'two hours'}}]};
        const words = await assistantComplete({...req,messages:[{role:'user',content:JSON.stringify({request:'Change the duration to two hours',currentDraft:{name:'Walk',kind:'habit'},catalog:{date:{iso:'2026-11-01',weekday:'Sun'}}})}]});
        reply={success:true,confidence:0.8,function_calls:[{name:'import_calendar',arguments:{subject:'calendar'}}]};
        const feature=await assistantComplete({...req,messages:[{role:'user',content:JSON.stringify({request:'Import my calendar',catalog:{date:{iso:'2026-11-01'}}})}]});
        assistantAbortInFlight();
        return {feature:feature.message.tool_calls,calls:result.message.tool_calls,held:held.message.tool_calls,continued:continued.message.tool_calls,
          frequency:frequency.message.tool_calls,repair,invalidTurn,
          ungrounded:ungrounded.message.tool_calls,
          converted:converted.message.tool_calls,words:words.message.tool_calls,
          system:sent.find(m=>m.type === 'complete').system,terminated};
      }finally{ globalThis.Worker = OriginalWorker; }
    });
    assert(transport.calls.length === 1 && transport.calls[0].function.name === 'draft_item',
      'an unrelated capability candidate cannot accompany an ordinary task without a quoted feature in the request');
    assert(transport.feature.length===1 && transport.feature[0].function.name==='answer_settings'
      && transport.feature[0].function.arguments.kind==='calendar' && !('subject' in transport.feature[0].function.arguments),
      'an explicitly named feature routes to verified facts and keeps extraction evidence out of app arguments');
    assert(transport.calls[0].function.arguments.kind === 'task' && transport.calls[0].function.arguments.create,'task alias retains its model-selected kind');
    assert(transport.frequency[0].function.name === 'draft_item' && transport.frequency[0].function.arguments.create === false
      && transport.frequency[0].function.arguments.kind === 'habit' && transport.frequency[0].function.arguments.rhythm === '3 times a week',
      'frequency tool stages an existing habit edit, including task-to-habit conversion');
    assert(JSON.parse(transport.repair.repair).error === 'No valid tool call was returned.'
      && JSON.parse(transport.repair.repair).request === transport.repair.request && transport.repair.request === 'Remind me to call mom',
      'repair facts reach the worker with the original instruction and no unavailable canonical tool names');
    assert(JSON.parse(transport.invalidTurn.repair).error === 'The repetition phrase could not be validated.'
      && !transport.invalidTurn.repair.includes('classify_intent'),'validation repair keeps the actual error and drops server-only steering');
    assert(transport.held.length === 1 && transport.held[0].function.arguments.kind === 'habit','a held write can stage a confirmation preview');
    assert(!transport.continued.length && !transport.ungrounded.length,'held continuations and ungrounded arguments cannot stage extra actions');
    assert(transport.converted.length === 1 && transport.converted[0].function.arguments.durationMinutes === 90
      && transport.words.length === 1 && transport.words[0].function.arguments.durationMinutes === 'two hours',
      'a minute count is kept when it is the length the user spoke, and the spoken words pass through');
    assert(transport.system.includes('date: 2026-11-01') && !transport.system.includes('[object Object]'),'Needle receives the real ISO date');
    assert(transport.terminated,'cancel stops the inference worker');

    const workerScope = vm.createContext({importScripts:()=>{},self:{},prompts:[]});
    vm.runInContext(fs.readFileSync(require.resolve('../js/assistant-needle-worker.js'),'utf8'),workerScope);
    vm.runInContext(`
      needleInit=()=>{};needleEmbedding=()=>[1];needleSimilarity=()=>1;
      needleComplete=text=>{prompts.push(text);return {function_calls:[]};};
      needleSelectTools=data=>data.tools;
      needleRouteTools=data=>({tools:data.tools});
      var retryData={request:'Can you make Concentricity check 3 times a week',system:'date: 2026-11-01',
        tools:[{name:'change_frequency',canonical:'draft_item'}],results:[]};
      needleRun(retryData);
      prompts.length=0;
      needleRun({...retryData,repair:'Call the matching tool now.'});
      needleRun({...retryData,repair:'Call the matching tool now.'});
    `,workerScope);
    assert(JSON.stringify(workerScope.prompts) === JSON.stringify(['Call the matching tool now.','Call the matching tool now.']),
      'successive no-tool repairs continue inference with feedback instead of replaying the same failed prompt');

    const runtimeMessages=[];
    const runtimeScope=vm.createContext({importScripts:()=>{},self:{postMessage:value=>runtimeMessages.push(value)}});
    vm.runInContext(fs.readFileSync(require.resolve('../js/assistant-needle-worker.js'),'utf8'),runtimeScope);
    vm.runInContext(`engine={};needleRun=()=>{throw new Error('tool call truncated: token budget exhausted');};
      self.onmessage({data:{type:'complete',id:7}});`,runtimeScope);
    await vm.runInContext('queue',runtimeScope);
    assert(runtimeMessages[0]?.result?.function_calls?.[0]?.name === 'ask_user'
      && runtimeMessages[0].result._needleIssue.includes('token budget'),
      'a runtime budget failure becomes a short clarification while retaining its diagnostic reason');
    const nativeMessages=[];
    const nativeScope=vm.createContext({importScripts:()=>{},self:{postMessage:value=>nativeMessages.push(value)}});
    vm.runInContext(fs.readFileSync(require.resolve('../js/assistant-needle-worker.js'),'utf8'),nativeScope);
    vm.runInContext(`engine={ccall:()=>1,UTF8ToString:()=>JSON.stringify({success:false,error:'tool call truncated: token budget exhausted'})};
      needleRun=()=>needleComplete('Add a daily habit');
      self.onmessage({data:{type:'complete',id:8}});`,nativeScope);
    await vm.runInContext('queue',nativeScope);
    assert(nativeMessages[0]?.result?.function_calls?.[0]?.name === 'ask_user'
      && nativeMessages[0].result._needleIssue.includes('token budget'),
      'native JSON budget failures use the same clarification path as thrown failures');

    const selectionScope = vm.createContext({importScripts:()=>{},self:{}});
    vm.runInContext(fs.readFileSync(require.resolve('../js/assistant-needle-worker.js'),'utf8'),selectionScope);
    vm.runInContext(`
      needleEmbedding=()=>[1];
      needleSimilarity=(_query,text)=>{
        const s=String(text);
        if(s.includes('weekdays'))return 5;
        if(s.includes('schedule'))return 4;
        if(s.includes('add a habit'))return 3;
        if(s.includes('priority'))return 2;
        if(s.includes('repeats'))return 0.2;
        return 0;
      };
      const closed=name=>({name,description:name==='change_availability'?'which weekdays or clock hours':name==='change_frequency'?'how many times it repeats':'how long it lasts',
        closed:true,canonical:'draft_item',core:['name'],parameters:{type:'object',properties:{name:{type:'string',description:'title'}},required:[]}});
      const open=name=>({name,description:name==='get_schedule'?'schedule for a day':name==='change_item'?'priority topics weather':'add a habit',canonical:name==='get_schedule'?'answer_schedule':'draft_item',
        core:['name'],parameters:{type:'object',properties:{name:{type:'string',description:'title'}},required:[]}});
      const tools=[closed('change_availability'),closed('change_frequency'),closed('change_duration'),open('get_schedule'),open('add_habit'),open('change_item'),
        {name:'ask_user',description:'ask',core:['question'],parameters:{type:'object',properties:{question:{type:'string',description:'question'}},required:['question']}}];
      grouped=needleSelectTools({request:'seven times in ten days',tools},tools.filter(tool=>tool.closed)).map(tool=>tool.name);
      const readTools=tools.map(tool=>tool.closed?{...tool,description:'unrelated control'}:tool);
      reads=needleSelectTools({request:'what is on my schedule',tools:readTools},readTools.filter(tool=>tool.name === 'get_schedule')).map(tool=>tool.name);
    `,selectionScope);
    assert(selectionScope.grouped.includes('change_frequency') && selectionScope.grouped.includes('change_duration')
      && selectionScope.grouped.includes('change_availability') && !selectionScope.grouped.includes('get_schedule'),
      'the model-selected control menu keeps its fields without gaining unrelated tools');
    assert(!selectionScope.reads.includes('change_frequency') && selectionScope.reads.includes('get_schedule')
      && selectionScope.reads.includes('ask_user'),
      'a read does not gain edit controls when none of them rank');

    const repairs=await page.evaluate(async()=>{
      const original=assistantNeedleRequest,requests=[];
      const tools=assistantNeedleTools(assistantOllamaTools(['draft_item','ask_user']));
      const raw=(name,args,extra={})=>({success:true,confidence:0.8,function_calls:[{name,arguments:args}],...extra});
      let responses={};
      assistantNeedleRequest=async(type,payload)=>{
        requests.push({type,...payload});
        if(type==='complete')return responses.create;
        return responses[payload.field] || raw(payload.field,{[payload.field]:'unrelated value'});
      };
      const turn=request=>({request,system:'synthetic facts',results:[],repair:'',hasItemContext:false});
      try{
        responses={duration:raw('duration',{duration:'20 minutes'},{confidence:0.2})};
        const habit=await assistantNeedleRepairBasicFields(raw('add_habit',{name:'Stretch',frequency:'every day'}),turn('Add a daily Stretch habit lasting twenty minutes'),tools);
        responses={name:raw('name',{name:'Read'}),frequency:raw('frequency',{frequency:'twice a week'})};
        const frequency=await assistantNeedleRepairBasicFields(raw('change_frequency',{frequency:'daily'}),turn('Make Read twice a week instead'),tools);
        responses={time:raw('time',{time:'15:00'})};
        const timed=await assistantNeedleRepairBasicFields(raw('add_task',{name:'Send invoice',date:'tomorrow'}),turn('Add Send invoice tomorrow at 3pm'),tools);
        responses={duration:raw('duration',{duration:'90 minutes'})};
        const rejected=await assistantNeedleRepairBasicFields(raw('add_habit',{name:'Stretch',frequency:'every day'}),turn('Add a daily Stretch habit lasting twenty minutes'),tools);
        const typed=await assistantNeedleRepairBasicFields(raw('change_frequency',{name:'Walk',frequency:'50 minutes'},
          {validation:{ungrounded:['change_frequency.frequency'],negation:false}}),turn('Make Walk last fifty minutes'),tools);
        const combined=await assistantNeedleRepairBasicFields(raw('change_frequency',{name:'Gym',frequency:'3 times a week'}),
          turn('Change Gym to 3 times a week for 30 minutes'),tools);
        const snake=assistantNeedleGroundedArguments({name:'change_duration',arguments:{durationMinutes:'120'}},"Set Read's session length to two hours",['change_duration.duration_minutes']);
        const invented=assistantNeedleGroundedArguments({name:'change_duration',arguments:{durationMinutes:'90'}},"Set Read's session length to two hours",['change_duration.duration_minutes']);
        const catalog=JSON.parse(assistantUserEnvelope('What habits do I have?',{habits:Array.from({length:24},(_,i)=>({name:'Habit '+i,type:'habit'}))},null,null,{})).catalog.habits.length;
        responses={create:raw('create_reminder',{name:'Call mom',date:'tomorrow'},{confidence:0.9})};
        const reconsidered=await assistantNeedleRepairBasicFields({success:true,confidence:0.1,function_calls:[],
          suppressed_calls:[{name:'add_habit',arguments:{name:'Call mom',frequency:'daily',durationMinutes:'tomorrow'}}]},turn('Remind me to call mom tomorrow'),tools);
        const count=requests.length;
        const negated=await assistantNeedleRepairBasicFields(raw('change_duration',{name:'Walk',durationMinutes:'45'},{validation:{negation:true}}),turn("Don't change Walk to 45 minutes"),tools);
        const continued=await assistantNeedleRepairBasicFields(raw('change_frequency',{frequency:'daily'}),{...turn('Make Read twice a week'),results:['done']},tools);
        return {habit,frequency,timed,rejected,typed,combined,snake,invented,catalog,reconsidered,requests,untouched:requests.length===count,negated,continued};
      }finally{assistantNeedleRequest=original;}
    });
    const repairedArgs=row=>row.function_calls[0].arguments;
    assert(repairedArgs(repairs.habit).name==='Stretch' && repairedArgs(repairs.habit).frequency==='every day'
      && repairedArgs(repairs.habit).durationMinutes==='20 minutes' && repairs.habit.confidence===0.2,
      'isolated duration extraction fills an omission while preserving the target, frequency and lower confidence');
    assert(repairedArgs(repairs.frequency).name==='Read' && repairedArgs(repairs.frequency).frequency==='twice a week',
      'model-extracted name and frequency repair an incomplete edit without changing its operation');
    assert(repairedArgs(repairs.timed).time==='15:00' && repairedArgs(repairs.timed).date==='tomorrow',
      'a clock conversion is accepted only as the same requested start time');
    assert(repairs.rejected.function_calls[0].name==='ask_user' && !repairs.rejected.suppressed_calls.length,
      'a wrong repair becomes a focused question instead of a partial preview');
    assert(repairs.typed.function_calls[0].name==='change_duration' && repairedArgs(repairs.typed).durationMinutes==='50 minutes'
      && repairedArgs(repairs.typed).name==='Walk' && repairs.typed._basicRepairs[0].validation.ungrounded[0]==='change_frequency.frequency',
      'typed edit normalization preserves the model value, saved target and original validation evidence');
    assert(repairs.snake && !repairs.invented,'native snake-case diagnostics permit equivalent units and still reject a wrong quantity');
    assert(repairs.combined.function_calls[0].name==='ask_user' && !repairs.combined.suppressed_calls.length,
      'a combined frequency and duration edit asks for separate requests instead of offering a partial change');
    assert(repairs.catalog===24,'Needle receives the full bounded saved-name catalogue');
    assert(repairs.reconsidered.function_calls[0].name==='create_reminder' && repairs.reconsidered.confidence===0.1
      && repairs.reconsidered._basicNeedsConfirmation && JSON.stringify(repairs.reconsidered).includes('item-reconsider'),
      'create reconsideration retains uncertainty and serializable diagnostic evidence');
    assert(repairs.untouched && repairs.negated.validation.negation && repairedArgs(repairs.continued).frequency==='daily',
      'negated actions and post-tool continuations do not run basic field repairs');
    assert(repairs.requests.every(r=>r.request && r.system==='synthetic facts')
      && repairs.requests.filter(r=>r.type==='complete').every(r=>r.tools.every(t=>['add_habit','create_reminder','change_frequency','change_duration','ask_user'].includes(t.name))),
      'field extraction retains the literal original request and never receives parser-supplied values');

    const choices=await page.evaluate(async()=>{
      const tools=assistantNeedleTools(assistantOllamaTools(['draft_item','complete_item','ask_user']));
      const narrowed=assistantNeedleEntryTools(tools,null,'change_duration');
      const done=assistantNeedleEntryTools(tools,null,'complete_item').find(t=>t.name==='complete_item');
      let invalid=false;try{assistantNeedleEntryTools(tools,null,'delete_everything');}catch(_){invalid=true;}
      const before=JSON.stringify(load()),original=runAssistantTurn,captured=[];
      runAssistantTurn=async(text,opts)=>{captured.push({text,action:opts.needleAction});return {type:'say',text:'Test response',session:opts.session};};
      try{
        const session=assistantCreateSession();
        await handleAssistantOutcome({type:'ask',question:'What would you like to do?',session},{request:'Practice piano should happen every three days.'});
        const select=document.querySelector('#assistant-thread select[data-assistant-action]');
        const button=select?.parentElement.querySelector('button');
        select.value='change_frequency';select.dispatchEvent(new Event('change'));button.click();
        await new Promise(resolve=>setTimeout(resolve,30));
        const retired=select.disabled&&button.disabled;
        select.value='add_task';select.dispatchEvent(new Event('change'));button.click();
        await new Promise(resolve=>setTimeout(resolve,30));
        return {narrowed:narrowed.map(t=>t.name),done,invalid,captured,retired,unchanged:before===JSON.stringify(load())};
      }finally{runAssistantTurn=original;}
    });
    assert(choices.narrowed.join(',')==='change_duration,ask_user' && choices.invalid,
      'an explicit action choice exposes only that action and clarification, with unknown choices rejected');
    assert(choices.done.fixed.action==='log' && !choices.done.parameters.properties.action,
      'the user-selected Mark done action cannot turn into undo');
    assert(choices.captured.length===1 && choices.captured[0].action==='change_frequency'
      && choices.captured[0].text==='Practice piano should happen every three days.' && choices.retired && choices.unchanged,
      'action recovery retries the unchanged request, retires old controls and saves nothing');

    const basics = await page.evaluate(async()=>{
      const tools = assistantNeedleTools(assistantOllamaTools(['draft_item']));
      const by = Object.fromEntries(tools.map(tool=>[tool.name, tool]));
      const keys = name => Object.keys(by[name].parameters.properties).sort();
      const schemas = {
        frequency:keys('change_frequency'),
        duration:keys('change_duration'),
        durationType:by.change_duration.parameters.properties.durationMinutes.type,
        addDurationType:by.add_habit.parameters.properties.durationMinutes.type,
        availability:keys('change_availability'),
        rename:keys('rename_item'),
        type:keys('change_type'),
        kind:keys('change_kind'),
        deadline:keys('change_deadline'),
        edit:keys('change_item')
      };
      const OriginalWorker = Worker;
      const mapped = {};
      const replies = [
        ['change_frequency',{frequency:'3 times in 7 days'}],
        ['change_duration',{durationMinutes:'30 minutes'}],
        ['change_availability',{weekdays:'Tuesday and Thursday',windowText:'between 5pm and 7pm'}],
        ['rename_item',{newName:'Morning exercise'}],
        ['change_type',{kind:'task'}],
        ['change_kind',{habitKind:'limit'}],
        ['change_deadline',{due:'tomorrow',dueTime:'3pm'}]
      ];
      const prompts={change_frequency:'Change outside exercise to 3 times in 7 days',change_duration:'Change outside exercise to 30 minutes',
        change_availability:'Allow outside exercise Tuesday and Thursday between 5pm and 7pm',rename_item:'Rename outside exercise to Morning exercise',
        change_type:'Make outside exercise a task',change_kind:'Make outside exercise a limit habit',change_deadline:'Move outside exercise to tomorrow at 3pm'};
      let reply = {success:true,function_calls:[]};
      globalThis.Worker = class {
        postMessage(data){
          const result = data.type === 'load' ? true : reply;
          queueMicrotask(()=>this.onmessage({data:{id:data.id,result}}));
        }
        terminate(){}
      };
      try{
        for(const [name,args] of replies){
          const req = {messages:[{role:'user',content:JSON.stringify({request:prompts[name],currentDraft:{name:'outside exercise',kind:'habit'},catalog:{date:{iso:'2026-11-01'}}})}],
            tools:assistantOllamaTools(['draft_item']),step:'extract'};
          reply = {success:true,function_calls:[{name,arguments:args}]};
          const out = await assistantComplete(req);
          const call = out.message.tool_calls[0];
          mapped[name] = call ? {name:call.function.name,arguments:call.function.arguments} : null;
        }
      }finally{ globalThis.Worker = OriginalWorker; }
      const now = Date.parse('2026-11-01T15:00:00');
      save([
        {hid:'ex',name:'outside exercise',type:'keepup',target:7,durationMinutes:45,logs:[],allowedWeekdays:[2]},
        {hid:'limit-ex',name:'outside exercise',type:'reduce',target:7,durationMinutes:45,logs:[],allowedWeekdays:[2]},
        {hid:'task',name:'Call mom',type:'task',durationMinutes:15,logs:[]}
      ]);
      const context = assistantBuildContext(now);
      const run = (hid,args)=>{
        const items = load();
        const index = items.findIndex(item=>item.hid === hid);
        const session = assistantCreateSession();
        session.draft = assistantHabitToDraft(items[index],index,loadSortSettings());
        const out = assistantExecuteTool('draft_item',args,session,context);
        const draft = out.draft || {};
        return {ok:out.ok,error:out.error,hid:draft.hid,name:draft.name,kind:draft.kind,habitKind:draft.habitKind,
          times:draft.timesPerPeriod,days:draft.periodDays,duration:draft.durationMinutes,
          weekdays:draft.allowedWeekdays || [],
          start:draft.window && draft.window.start && draft.window.start.minutes,
          end:draft.window && draft.window.end && draft.window.end.minutes,
          due:draft.dueDate,dueTime:draft.dueTime};
      };
      return {schemas,mapped,applied:{
        daily:run('ex',{create:false,kind:'habit',rhythm:'daily'}),
        weekly:run('ex',{create:false,kind:'habit',rhythm:'weekly'}),
        week:run('ex',{create:false,kind:'habit',rhythm:'3 times a week'}),
        custom:run('ex',{create:false,kind:'habit',rhythm:'3 times in 7 days'}),
        everyTwo:run('ex',{create:false,kind:'habit',rhythm:'every two days'}),
        seven:run('ex',{create:false,kind:'habit',rhythm:'seven times in ten days'}),
        empty:run('ex',{create:false}),
        duration:run('ex',{create:false,durationMinutes:'30 minutes'}),
        fractional:run('ex',{create:false,durationMinutes:'1.5 hours'}),
        wordDuration:run('ex',{create:false,durationMinutes:'two and a half hours'}),
        days:run('ex',{create:false,weekdays:'weekdays'}),
        namedDays:run('ex',{create:false,weekdays:'Tuesday and Thursday'}),
        hours:run('ex',{create:false,windowText:'between 5pm and 7pm'}),
        both:run('ex',{create:false,weekdays:'Tuesday and Thursday',windowText:'between 5pm and 7pm'}),
        rename:run('ex',{create:false,newName:'Morning exercise'}),
        task:run('ex',{create:false,kind:'task'}),
        limit:run('ex',{create:false,kind:'habit',habitKind:'limit'}),
        stop:run('ex',{create:false,kind:'habit',habitKind:'stop'}),
        build:run('limit-ex',{create:false,kind:'habit',habitKind:'build'}),
        deadline:run('task',{create:false,due:'tomorrow',dueTime:'3pm'})
      },expectedDue:assistantParseDue('tomorrow',now)};
    });
    const sameKeys = (name, expected)=>JSON.stringify(basics.schemas[name]) === JSON.stringify(expected.slice().sort());
    assert(basics.schemas.durationType === 'string' && basics.schemas.addDurationType === 'string',
      'Needle duration fields accept the user\'s words instead of an integer minute count');
    assert(sameKeys('frequency',['name','frequency']) && sameKeys('duration',['durationMinutes','name'])
      && sameKeys('availability',['name','weekdays','windowText']) && sameKeys('rename',['name','newName'])
      && sameKeys('type',['kind','name']) && sameKeys('kind',['habitKind','name'])
      && sameKeys('deadline',['due','dueTime','name']),
      'each minimal-mode control has its own closed Needle fields');
    assert(!basics.schemas.edit.some(key=>['rhythm','timesPerPeriod','periodDays','durationMinutes','windowText','weekdays','newName','habitKind','kind','due','dueTime'].includes(key))
      && basics.schemas.edit.includes('priority') && basics.schemas.edit.includes('placeNames'),
      'the general edit alias keeps advanced settings and no longer offers the basic fields');
    const mappedArgs = name => basics.mapped[name] && basics.mapped[name].arguments;
    assert(basics.mapped.change_frequency.name === 'draft_item' && mappedArgs('change_frequency').create === false
      && mappedArgs('change_frequency').kind === 'habit' && mappedArgs('change_frequency').rhythm === '3 times in 7 days'
      && mappedArgs('change_duration').durationMinutes === '30 minutes' && mappedArgs('change_duration').create === false
      && !mappedArgs('change_duration').rhythm
      && mappedArgs('change_availability').weekdays === 'Tuesday and Thursday'
      && mappedArgs('change_availability').windowText === 'between 5pm and 7pm'
      && mappedArgs('rename_item').newName === 'Morning exercise'
      && mappedArgs('change_type').kind === 'task' && mappedArgs('change_type').create === false
      && mappedArgs('change_kind').habitKind === 'limit' && mappedArgs('change_kind').kind === 'habit'
      && mappedArgs('change_deadline').due === 'tomorrow' && mappedArgs('change_deadline').dueTime === '3pm'
      && !mappedArgs('change_deadline').kind,
      'basic aliases stage one draft_item change and do not invent neighboring fields');
    const applied = basics.applied;
    for(const [name,times,days] of [['daily',1,1],['weekly',1,7],['week',3,7],['custom',3,7],['everyTwo',1,2],['seven',7,10]]){
      assert(applied[name].ok && applied[name].hid === 'ex' && applied[name].times === times && applied[name].days === days
        && applied[name].duration === 45,`how often "${name}" updates the focused habit (${JSON.stringify(applied[name])})`);
    }
    assert(!applied.empty.ok && applied.empty.hid == null, `a call with no new value is not a preview (${JSON.stringify(applied.empty)})`);
    assert(applied.duration.ok && applied.duration.hid === 'ex' && applied.duration.duration === 30
      && applied.duration.times === 1 && applied.duration.days === 7,
      `duration accepts 30 minutes without changing how often (${JSON.stringify(applied.duration)})`);
    assert(applied.fractional.ok && applied.fractional.duration === 90
      && applied.wordDuration.ok && applied.wordDuration.duration === 150,
      `spoken lengths convert to minutes (${JSON.stringify(applied.fractional)} ${JSON.stringify(applied.wordDuration)})`);
    assert(applied.days.ok && JSON.stringify(applied.days.weekdays) === JSON.stringify([1,2,3,4,5])
      && applied.days.times === 1 && applied.days.days === 7 && applied.days.duration === 45,
      `weekdays sets allowed days only (${JSON.stringify(applied.days)})`);
    assert(applied.namedDays.ok && JSON.stringify(applied.namedDays.weekdays) === JSON.stringify([2,4])
      && applied.hours.ok && applied.hours.start === 17 * 60 && applied.hours.end === 19 * 60
      && JSON.stringify(applied.hours.weekdays) === JSON.stringify([2])
      && applied.both.ok && JSON.stringify(applied.both.weekdays) === JSON.stringify([2,4])
      && applied.both.start === 17 * 60 && applied.both.end === 19 * 60,
      `allowed hours can be set alone or with days (${JSON.stringify({hours:applied.hours,both:applied.both})})`);
    assert(applied.rename.ok && applied.rename.hid === 'ex' && applied.rename.name === 'Morning exercise'
      && applied.rename.duration === 45,
      `rename keeps the same item (${JSON.stringify(applied.rename)})`);
    assert(applied.task.ok && applied.task.hid === 'ex' && applied.task.kind === 'task'
      && applied.limit.ok && applied.limit.kind === 'habit' && applied.limit.habitKind === 'reduce'
      && applied.stop.habitKind === 'zero' && applied.build.habitKind === 'keepup',
      `habit, task, build, limit, and stop stage on the focused item (${JSON.stringify({task:applied.task,limit:applied.limit,stop:applied.stop,build:applied.build})})`);
    assert(applied.deadline.ok && applied.deadline.hid === 'task' && applied.deadline.kind === 'task'
      && applied.deadline.due === basics.expectedDue && applied.deadline.dueTime === '15:00',
      `a task due date and start time stage together (${JSON.stringify(applied.deadline)})`);

    const focusLock = await page.evaluate(()=>{
      patchLocalAssistant({localAssistant:true, localAssistantProvider:'needle'});
      save([{hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, emoji:'🏋️', logs:[]}]);
      const opened = assistantOpenForItem('gym', 'home');
      const reviewText = () => {
        const review = document.querySelector('[data-focus-review]');
        return {
          kicker:review && review.querySelector('.focus-kicker') && review.querySelector('.focus-kicker').textContent,
          name:review && review.querySelector('.assistant-preview-name') && review.querySelector('.assistant-preview-name').textContent,
          cards:document.querySelectorAll('[data-focus-card]').length,
          save:Boolean(review && review.querySelector('[data-focus-save]')),
          edit:Boolean(review && review.querySelector('[data-focus-edit]'))
        };
      };
      const done = document.getElementById('assistant-focus-done');
      const before = {hidden:done.hidden, barHidden:document.getElementById('assistant-focus').hidden, review:reviewText(), intro:/Working on Gym/i.test(document.getElementById('assistant-thread').textContent || ''), hid:_assistantSession.focus && _assistantSession.focus.targetId};
      done.click();
      const afterDone = {review:reviewText(), hid:_assistantSession.focus && _assistantSession.focus.targetId, barHidden:document.getElementById('assistant-focus').hidden, alive:assistantFocusAlive(_assistantSession.focus)};
      clearAssistantChat();
      const afterClear = {review:reviewText(), intro:/Working on/i.test(document.getElementById('assistant-thread').textContent || ''), hid:_assistantSession.focus && _assistantSession.focus.targetId, alive:assistantFocusAlive(_assistantSession.focus), doneHidden:document.getElementById('assistant-focus-done').hidden, barHidden:document.getElementById('assistant-focus').hidden};
      const staged = assistantFocusCorrect(_assistantSession.focus, 'durationMinutes', '40 minutes');
      assistantShowFocusReview(_assistantSession.focus);
      const afterStage = reviewText();
      closeAssistantSheet();
      return {opened, before, afterDone, afterClear, staged:Boolean(staged && staged.ok), afterStage};
    });
    assert(focusLock.opened && focusLock.before.hidden && focusLock.before.barHidden && focusLock.before.hid === 'gym'
      && focusLock.before.review.cards === 1 && /Edit habit/i.test(focusLock.before.review.kicker || '')
      && focusLock.before.review.name === 'Gym' && !focusLock.before.intro
      && !focusLock.before.review.save && !focusLock.before.review.edit
      && focusLock.afterDone.alive && focusLock.afterDone.hid === 'gym' && focusLock.afterDone.barHidden
      && focusLock.afterDone.review.name === 'Gym' && !focusLock.afterDone.review.save && !focusLock.afterDone.review.edit,
      'Needle opens on the Edit summary and keeps the focused item');
    assert(focusLock.afterClear.alive && focusLock.afterClear.hid === 'gym' && focusLock.afterClear.doneHidden
      && focusLock.afterClear.barHidden && focusLock.afterClear.review.cards === 1
      && focusLock.afterClear.review.name === 'Gym' && /Edit habit/i.test(focusLock.afterClear.review.kicker || '')
      && !focusLock.afterClear.intro && !focusLock.afterClear.review.save && !focusLock.afterClear.review.edit,
      'clearing the Needle chat stays on the same Edit summary');
    assert(focusLock.staged && focusLock.afterStage.save && focusLock.afterStage.edit,
      'Save and Edit appear once a change is staged');

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
      const focused = await live.evaluate(async()=>{
        save([]);
        const summarize = session => {
          const record = assistantFocusMaterialize(session);
          return {
            name:record.name,
            duration:record.durationMinutes,
            target:record.target,
            changes:session.changes.map(change => ({field:change.field, value:change.value, source:change.source})),
            unresolved:session.unresolved.map(item => item.field),
            passes:(session.timing.passes || []).map(pass => pass.family)
          };
        };
        const created = assistantFocusOpen({operation:'create', kind:'habit', entry:'add'});
        await assistantFocusTurn(created, 'Add a 20 minute Walk habit every day');
        const preview = summarize(created);
        const nameOk = /walk/i.test(preview.name) && preview.name.split(/\s+/).length <= 3;
        if(nameOk && preview.duration === 20 && created.needsInterpretation)assistantFocusApprove(created);
        const commit = assistantFocusCanSave(created) ? await assistantFocusCommit(created) : {ok:false, alive:assistantFocusAlive(created), pending:created.pendingFamilies, correction:created.correctionError, needs:created.needsInterpretation, unresolved:created.unresolved.map(item => item.field)};
        const saved = load();
        const edit = saved[0] ? assistantFocusOpen({operation:'edit', kind:'habit', targetId:saved[0].hid, entry:'home'}) : null;
        if(!edit){
          return {preview, commit, savedCount:saved.length, edited:{name:preview.name, duration:null, changes:preview.changes}, afterName:null, afterDuration:null, afterCount:saved.length, questionChanges:[], questionBlocked:true, questionUntouched:true};
        }
        await assistantFocusTurn(edit, 'Make this 45 minutes');
        const edited = summarize(edit);
        if(edited.duration === 45 && edited.name === preview.name && !edited.changes.some(change => change.field === 'name')){
          if(edit.needsInterpretation)assistantFocusApprove(edit);
          if(assistantFocusCanSave(edit))await assistantFocusCommit(edit);
        }
        const afterEdit = load();
        const question = assistantFocusOpen({operation:'edit', kind:'habit', targetId:afterEdit[0] && afterEdit[0].hid, entry:'home'});
        const beforeQuestion = JSON.stringify(load());
        await assistantFocusTurn(question, 'What is on my schedule today?');
        return {
          preview, commit, edited,
          savedCount:saved.length,
          afterName:afterEdit[0] && afterEdit[0].name,
          afterDuration:afterEdit[0] && afterEdit[0].durationMinutes,
          afterCount:afterEdit.length,
          questionChanges:question.changes.map(change => change.field),
          questionBlocked:!assistantFocusCanSave(question) || question.unresolved.length > 0,
          questionUntouched:beforeQuestion === JSON.stringify(load())
        };
      });
      assert(focused.preview && /walk/i.test(focused.preview.name) && focused.preview.name.split(/\s+/).length <= 3
        && focused.preview.duration === 20 && focused.commit.ok && focused.savedCount === 1,
        `real Needle creates only the Walk habit (${JSON.stringify(focused.preview)} ${JSON.stringify(focused.commit)})`);
      assert(focused.edited.duration === 45 && focused.afterDuration === 45 && focused.afterCount === 1
        && focused.afterName === focused.preview.name
        && !focused.edited.changes.some(change => change.field === 'name'),
        `real Needle edits only that habit's duration (${JSON.stringify(focused.edited)})`);
      assert(focused.questionUntouched && focused.questionBlocked, `a schedule question does not change the open habit (${JSON.stringify(focused.questionChanges)})`);
      await live.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
      await live.context().setOffline(true);
      await live.reload({waitUntil:'load'});
      await waitForAssistant(live);
      const offline = await live.evaluate(async()=>{
        const session = assistantFocusOpen({operation:'create', kind:'task', entry:'add'});
        await assistantFocusTurn(session, 'Remind me to call mom tomorrow');
        const record = assistantFocusMaterialize(session);
        return {name:record.name, passes:(session.timing.passes || []).map(pass => pass.family), changes:session.changes.map(change => change.field)};
      });
      assert(/mom/i.test(offline.name) && offline.passes.length > 0, `real Needle still reads one new task offline (${JSON.stringify(offline)})`);
      assert(fetches === 2,'real model is downloaded once and reused after reload');
      await live.close();
    }else console.log('  skip: real Needle checks (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');
    console.log(`\n${passed} passed`);
  }finally{ await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode = 1;});
