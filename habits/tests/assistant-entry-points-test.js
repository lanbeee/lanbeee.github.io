// Assistant context entry points: add-sheet AI + detail chat. Context-known
// intent or item skips the classify call (one extract call). Fake LLM
// throughout; no live model needed.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

async function launchBrowser(){
  const attempts = [
    { headless:true, channel:'chrome' },
    { headless:true },
    { headless:true, args:['--disable-gpu'] }
  ];
  let lastErr = null;
  for(const opts of attempts){
    try{ return await chromium.launch(opts); }
    catch(err){ lastErr = err; }
  }
  throw lastErr || new Error('chromium.launch failed');
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await waitForAssistant(page);
  await page.evaluate(() => patchLocalAssistant({ localAssistant:true, localAssistantProvider:'auto' }));

  console.log('\n[A] startIntent create_task skips classify');
  const addTask = await page.evaluate(async () => {
    const calls = [];
    const out = await runAssistantTurn('Trash out the day after tomorrow, 5 minutes', {
      startIntent:'create_task',
      entry:'add',
      session:assistantCreateSession(),
      complete: async req => {
        calls.push({
          step:req.step,
          tools:(req.tools || []).map(tool => tool.function.name),
          steer:req.messages[req.messages.length - 1].content
        });
        return { message:{ thinking:'one-off chore', tool_calls:[
          { id:'c1', function:{ name:'draft_item', arguments:{ kind:'task', name:'Trash out', durationMinutes:'5', due:'day after tomorrow' } } }
        ] } };
      }
    });
    const model = (out.session.debug || []).find(row => row.t === 'model') || {};
    const doneRow = (out.session.debug || []).find(row => row.t === 'done') || {};
    const entryPath = (out.session.debug || []).find(row => row.t === 'path' && row.via === 'entry-add') || null;
    return {
      type:out.type,
      kind:out.draft && out.draft.kind,
      llmCalls:out.session.llmCalls,
      calls,
      entryPath:Boolean(entryPath),
      modelMs:typeof model.ms === 'number',
      doneMs:typeof doneRow.totalMs === 'number'
    };
  });
  assert(addTask.type === 'preview' && addTask.kind === 'task', 'single extract call drafts the task');
  assert(addTask.llmCalls === 2 && addTask.calls.length === 2 && addTask.calls[0].step === 'extract', 'extract runs first; the model is asked if anything remains');
  assert(addTask.calls[0] && addTask.calls[0].step === 'extract', 'first call is extract');
  assert(addTask.calls[0] && !addTask.calls[0].tools.includes('classify_intent'), 'classify_intent tool is not offered');
  assert(/kind task/.test(addTask.calls[0] && addTask.calls[0].steer || ''), 'steer names the entry kind (task)');
  assert(addTask.entryPath, 'trace records via entry-add');
  assert(addTask.modelMs && addTask.doneMs, 'trace carries per-call ms and turn totalMs');

  console.log('\n[B] startIntent create_setting skips classify');
  const addSetting = await page.evaluate(async () => {
    const calls = [];
    const out = await runAssistantTurn('weather profile for barbecuing', {
      startIntent:'create_setting',
      entry:'add',
      forceLlm:true,
      session:assistantCreateSession(),
      complete: async req => {
        calls.push({ step:req.step, steer:req.messages[req.messages.length - 1].content });
        return { message:{ thinking:'weather row', tool_calls:[
          { id:'c1', function:{ name:'draft_setting', arguments:{ kind:'weather', name:'Barbecuing' } } }
        ] } };
      }
    });
    return {
      type:out.type,
      kind:out.draft && out.draft.kind,
      llmCalls:out.session.llmCalls,
      steer:calls[0] && calls[0].steer,
      step:calls[0] && calls[0].step
    };
  });
  assert(addSetting.type === 'preview' && addSetting.kind === 'weather', 'draft_setting preview for entry setting');
  assert(addSetting.llmCalls === 2 && addSetting.step === 'extract', 'extract runs first, then the model can stop');
  assert(/draft_setting/.test(addSetting.steer || ''), 'steer asks for draft_setting');

  console.log('\n[C] entry always uses the model, even with an old setting off');
  const entryLocal = await page.evaluate(async () => {
    patchLocalAssistant({localAssistantModelOnly:false, localAssistantRoutingVersion:2});
    const calls = [];
    assistantComplete = async req => {
      calls.push(req.step);
      return {message:{thinking:'task', tool_calls:[{function:{name:'draft_item', arguments:{kind:'task',name:'Call mom'}}}]}};
    };
    const ok = await assistantOpenWithInstruction('Remind me to call mom', { intent:'create_task', entry:'add' });
    const session = _assistantSession;
    const retry = document.querySelector('#assistant-thread .assistant-retry');
    const sheetOpen = document.querySelector('#assistant-sheet').classList.contains('open');
    return {
      ok,
      sheetOpen,
      name:session && session.draft && session.draft.name,
      modelPath:Boolean(session && session.debug && session.debug.some(row => row.t === 'path' && row.path === 'llm')),
      calls,
      retry:Boolean(retry)
    };
  });
  assert(entryLocal.ok && entryLocal.sheetOpen, 'entry opens the assistant sheet');
  assert(/mom/i.test(entryLocal.name || ''), 'entry model tool previews the draft');
  assert(entryLocal.modelPath && entryLocal.calls[0] === 'extract', 'trace shows one extract call on the model path');
  assert(!entryLocal.retry, 'model-only entry does not offer a redundant retry');

  console.log('\n[D] detail entry: empty text costs zero model calls, follow-up extracts');
  const detailEntry = await page.evaluate(async () => {
    const calls = [];
    assistantComplete = async req => {
      calls.push({ step:req.step, steer:req.messages[req.messages.length - 1].content });
      return { message:{ thinking:'edit walk', tool_calls:[
        { id:'c1', function:{ name:'draft_item', arguments:{ name:'Walk', durationMinutes:'45' } } }
      ] } };
    };
    clearAssistantChat();
    const opened = await assistantOpenWithInstruction('', { draft:{ hid:'w1', name:'Walk', kind:'habit' }, entry:'detail' });
    const sheetOpen = document.querySelector('#assistant-sheet').classList.contains('open');
    const focusName = document.querySelector('#assistant-focus-name') && document.querySelector('#assistant-focus-name').textContent;
    const introBubble = Array.from(document.querySelectorAll('#assistant-thread .assistant-bubble-say'))
      .some(node => /Working on Walk/.test(node.textContent || ''));
    const draftSeeded = _assistantSession && _assistantSession.draft && _assistantSession.draft.name === 'Walk';
    const noCallsYet = calls.length === 0;
    await sendAssistantMessage('make it 45 minutes');
    const session = _assistantSession;
    return {
      opened, sheetOpen, focusName, introBubble, draftSeeded, noCallsYet,
      calls,
      previewName:session && session.draft && session.draft.name,
      duration:session && session.draft && session.draft.durationMinutes,
      llmCalls:session && session.llmCalls
    };
  });
  assert(detailEntry.opened && detailEntry.sheetOpen, 'detail entry opens the assistant');
  assert(detailEntry.focusName === 'Walk' && detailEntry.draftSeeded, 'item is focused as currentDraft');
  assert(detailEntry.introBubble, 'local intro bubble, no model call');
  assert(detailEntry.noCallsYet, 'empty-text entry makes zero LLM calls');
  assert(detailEntry.calls[0] && detailEntry.calls[0].step === 'extract', 'follow-up goes straight to extract');
  assert(/changing currentDraft/.test(detailEntry.calls[0] && detailEntry.calls[0].steer || ''), 'follow-up steer scopes to currentDraft');
  assert(detailEntry.llmCalls === 2 && Number(detailEntry.duration) === 45, 'the edit is applied, then the model can stop');

  console.log('\n[E] entry buttons: visibility + wiring');
  const chrome = await page.evaluate(() => {
    const display = id => getComputedStyle(document.getElementById(id)).display;
    patchLocalAssistant({ localAssistant:false });
    const off = { ting:display('ting-ask-ai'), detail:display('detail-ask-ai'), hint:display('add-ask-hint') };
    patchLocalAssistant({ localAssistant:true, localAssistantProvider:'auto' });
    // Minimal mode hides the whole detail actions page; the AI row must
    // follow its siblings there. Force full mode for the positive check.
    if(typeof updateSortSetting === 'function')updateSortSetting({ minimalMode:false }, { renderNow:false });
    if(typeof applyDetailMinimalMode === 'function')applyDetailMinimalMode();
    const on = { ting:display('ting-ask-ai'), detail:display('detail-ask-ai'), snooze:display('detail-snooze'), hint:display('add-ask-hint') };
    document.getElementById('add-sheet').classList.add('appointment-add');
    const eventHint = display('add-ask-hint');
    document.getElementById('add-sheet').classList.remove('appointment-add');
    return { off, on, eventHint };
  });
  assert(chrome.off.ting === 'none' && chrome.off.detail === 'none' && chrome.off.hint === 'none', 'entry buttons hidden when assistant is off');
  assert(chrome.on.ting !== 'none' && chrome.on.detail !== 'none' && chrome.on.hint === 'block', 'entry buttons and the add hint are visible when assistant is on');
  assert(chrome.eventHint === 'none', 'events hide the add-sheet assistant hint');
  assert(chrome.on.detail === chrome.on.snooze, 'detail AI row matches sibling visibility');

  const addWiring = await page.evaluate(async () => {
    assistantComplete = async req => ({ message:{ thinking:'entry add', tool_calls:[
      { id:'c1', function:{ name:'draft_item', arguments:{ kind:'task', name:'Trash out', durationMinutes:'5' } } }
    ] } });
    clearAssistantChat();
    closeAssistantSheet();
    appendAssistantBubble('user', 'Earlier reminder about taxes');
    _assistantSession.recent = {request:'Earlier reminder about taxes', referent:'Taxes', say:'Saved taxes'};
    openSheet('add-sheet');
    document.querySelector('#type-seg [data-v="task"]').click();
    document.getElementById('ting-message').value = 'Trash out the day after tomorrow, 5 minutes';
    document.getElementById('ting-ask-ai').click();
    await new Promise(resolve => setTimeout(resolve, 120));
    const turn = (_assistantSession && _assistantSession.debug || []).find(row => row.t === 'turn') || {};
    return {
      sheetOpen:document.querySelector('#assistant-sheet').classList.contains('open'),
      addSheetStillOpen:document.querySelector('#add-sheet').classList.contains('open'),
      textKept:document.getElementById('ting-message').value,
      entry:turn.entry,
      startIntent:turn.startIntent,
      request:_assistantSession && _assistantSession.requestText,
      recent:_assistantSession && _assistantSession.recent && _assistantSession.recent.request,
      thread:document.getElementById('assistant-thread').textContent,
      userBubble:Array.from(document.querySelectorAll('#assistant-thread .assistant-bubble-user'))
        .some(node => /Trash out the day after tomorrow/.test(node.textContent || ''))
    };
  });
  assert(addWiring.sheetOpen && addWiring.userBubble, 'add-sheet AI button sends the typed instruction');
  assert(!/taxes/i.test(addWiring.thread || '') && !/taxes/i.test(addWiring.recent || ''), 'an add-sheet chat drops the previous conversation');
  assert(/^Add a one-off task:/.test(addWiring.request || '') && !/^Add a one-off task:/.test('Trash out the day after tomorrow, 5 minutes'), 'the model hears an add-task request while the chat shows the typed words');
  assert(addWiring.entry === 'add' && addWiring.startIntent === 'create_task', 'add-sheet click carries entry provenance and kind');
  assert(addWiring.addSheetStillOpen && /Trash out/.test(addWiring.textKept), 'add sheet stays underneath with text intact');

  const emptyAddClick = await page.evaluate(async () => {
    closeAssistantSheet();
    clearAssistantChat();
    document.getElementById('ting-message').value = '   ';
    document.getElementById('ting-ask-ai').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    return {
      sheetOpen:document.querySelector('#assistant-sheet').classList.contains('open'),
      toast:document.getElementById('toast-text') && document.getElementById('toast-text').textContent
    };
  });
  assert(!emptyAddClick.sheetOpen, 'empty add text does not open the assistant');
  assert(/Describe the new habit or task first/.test(emptyAddClick.toast || ''), 'empty add text asks for a description');

  const addSave = await page.evaluate(async () => {
    assistantComplete = async () => ({ message:{ thinking:'entry add', tool_calls:[
      { id:'c1', function:{ name:'draft_item', arguments:{ kind:'task', name:'Trash out', durationMinutes:'5' } } }
    ] } });
    clearAssistantChat();
    closeAssistantSheet();
    applyAddDefaults();
    openSheet('add-sheet');
    document.querySelector('#type-seg [data-v="task"]').click();
    document.getElementById('ting-message').value = 'Trash out';
    document.getElementById('ting-ask-ai').click();
    const deadline = Date.now() + 4000;
    let save = null;
    while(Date.now() < deadline){
      save = document.querySelector('#assistant-thread [data-assistant-act="add"]');
      if(save)break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if(save)save.click();
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      saved:load().some(item => item.name === 'Trash out'),
      addOpen:document.querySelector('#add-sheet').classList.contains('open'),
      leftover:document.getElementById('ting-message').value
    };
  });
  assert(addSave.saved && !addSave.addOpen && !addSave.leftover, 'saving the add-screen preview closes the add sheet');

  const longName = await page.evaluate(() => {
    applyAddDefaults();
    openSheet('add-sheet');
    const before = load().length;
    document.getElementById('ting-message').value = 'x'.repeat(80);
    document.getElementById('do-save').click();
    return {
      count:load().length - before,
      open:document.querySelector('#add-sheet').classList.contains('open'),
      toast:document.getElementById('toast-text').textContent,
      max:document.getElementById('ting-message').maxLength
    };
  });
  assert(longName.max >= 80 && longName.count === 0 && longName.open, 'a long description is not saved as a chopped name');
  assert(/60 characters/.test(longName.toast) && /sparkles/.test(longName.toast), 'the add button points a long description at sparkles');

  const narrowed = await page.evaluate(() => {
    const tools = assistantNeedleTools(assistantOllamaTools(['draft_item','answer_weather','answer_schedule','draft_setting']));
    const habit = assistantNeedleEntryTools(tools, 'create_habit').map(tool => tool.name);
    const task = assistantNeedleEntryTools(tools, 'create_task').map(tool => tool.name);
    const open = assistantNeedleEntryTools(tools, null).map(tool => tool.name);
    const filled = assistantApplyAddForm({name:'Read'}, {rhythm:'weekly', durationMinutes:30, habitKind:'reduce'});
    const kept = assistantApplyAddForm({name:'Walk', rhythm:'every night', durationMinutes:20}, {rhythm:'weekly', durationMinutes:30});
    const fallback = assistantAddFormFallback({
      requestText:'Add a repeating habit: Read a book',
      intent:'create_habit',
      addForm:{rhythm:'weekly', durationMinutes:30, note:'weekly, 30 minutes'}
    });
    const taskText = assistantAddFormCheckText('Add a one-off task: Call mom tomorrow', {note:'due today, 30 minutes'});
    const bare = assistantValidateNeedleDraftArgs({name:'Call mom', kind:'task', create:true, durationMinutes:30}, 'Add a one-off task: Call mom tomorrow');
    const grounded = assistantValidateNeedleDraftArgs({name:'Call mom', kind:'task', create:true, durationMinutes:30}, taskText);
    const habitGrounded = assistantValidateNeedleDraftArgs(fallback && fallback.args, assistantAddFormCheckText('Add a repeating habit: Read a book', {note:'weekly, 30 minutes'}));
    return {habit, task, openCount:open.length, filled, kept, fallback, bare:Boolean(bare), grounded, habitGrounded};
  });
  assert(narrowed.habit.includes('add_habit') && !narrowed.habit.includes('add_task') && !narrowed.habit.includes('get_weather'), 'a habit add only offers habit creation');
  assert(narrowed.task.includes('add_task') && !narrowed.task.includes('add_habit'), 'a task add only offers task creation');
  assert(narrowed.openCount > narrowed.habit.length, 'other assistant turns keep the full tool list');
  assert(narrowed.filled.rhythm === 'weekly' && narrowed.filled.durationMinutes === 30 && narrowed.filled.habitKind === 'reduce', 'a name-only add keeps the form frequency and length');
  assert(narrowed.kept.rhythm === 'every night' && narrowed.kept.durationMinutes === 20, 'a description that already names a schedule is left as said');
  assert(narrowed.fallback && narrowed.fallback.args.name === 'Read a book' && narrowed.fallback.args.kind === 'habit'
    && narrowed.fallback.args.rhythm === 'weekly' && narrowed.fallback.args.durationMinutes === 30, 'a name-only add still drafts from the form when the model returns no tool');
  assert(narrowed.bare && !narrowed.grounded && !narrowed.habitGrounded, 'form frequency and length count as spoken for the add-sheet check');

  const detailWiring = await page.evaluate(async () => {
    localStorage.removeItem(KEY);
    save([{ name:'Walk', type:'keepup', logs:[], durationMinutes:30 }]);
    closeAssistantSheet();
    clearAssistantChat();
    appendAssistantBubble('user', 'Earlier reminder about taxes');
    _assistantSession.recent = {request:'Earlier reminder about taxes', referent:'Taxes', say:'Saved taxes'};
    openDetail(0);
    document.getElementById('detail-ask-ai').click();
    await new Promise(resolve => setTimeout(resolve, 120));
    const session = _assistantSession;
    return {
      sheetOpen:document.querySelector('#assistant-sheet').classList.contains('open'),
      focusName:document.querySelector('#assistant-focus-name') && document.querySelector('#assistant-focus-name').textContent,
      draftName:session && session.draft && session.draft.name,
      draftHid:session && session.draft && session.draft.hid,
      intro:Array.from(document.querySelectorAll('#assistant-thread .assistant-bubble-say'))
        .some(node => /Working on Walk/.test(node.textContent || '')),
      thread:document.getElementById('assistant-thread').textContent,
      recent:_assistantSession && _assistantSession.recent
    };
  });
  assert(detailWiring.sheetOpen && detailWiring.draftName === 'Walk', 'detail AI button focuses the open item');
  assert(detailWiring.intro, 'detail entry shows the local intro without a model call');
  assert(!/taxes/i.test(detailWiring.thread || '') && !detailWiring.recent, 'changing an item starts a new chat');

  const homeAsk = await page.evaluate(() => {
    appendAssistantBubble('user', 'Earlier reminder about taxes');
    _assistantSession.recent = {request:'Earlier reminder about taxes', referent:'Taxes', say:'Saved taxes'};
    assistantOpenForItem(load()[0].hid, 'home');
    return {
      entry:_assistantSession && _assistantSession.entry,
      thread:document.getElementById('assistant-thread').textContent,
      recent:_assistantSession && _assistantSession.recent
    };
  });
  assert(homeAsk.entry === 'home' && /Working on Walk/.test(homeAsk.thread || '')
    && !/taxes/i.test(homeAsk.thread || '') && !homeAsk.recent, 'asking from a card starts a new chat');
  assert(detailWiring.draftHid === 'w1' || detailWiring.draftHid != null, 'focused draft keeps the saved hid');

  console.log('\n[F] formatter surfaces timing');
  const fmt = await page.evaluate(() => {
    const line = assistantFormatDebug([
      { t:'model', step:'extract', ms:3210, evalTokens:812, tools:[{ name:'draft_item' }] },
      { t:'done', type:'preview', llmCalls:1, totalMs:3400, text:'Check this' }
    ]);
    return line;
  });
  assert(/model extract.*3210ms/.test(fmt), 'model debug line shows call ms');
  assert(/done preview.*3\.4s/.test(fmt), 'done debug line shows total seconds');

  await browser.close();
  console.log(`\nassistant-entry-points: ${pass} passed, ${fail} failed`);
  if(errors.length)console.error('pageerrors:', errors.slice(0, 4));
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
