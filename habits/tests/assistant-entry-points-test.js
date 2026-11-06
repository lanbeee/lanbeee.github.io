// Focused detail and home entries, plus retained low-level create adapters.
// Scripted model replies; no live model needed.
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

  console.log('\n[E] creation stays in the form; details own assistant entry');
  const addForm = await page.evaluate(() => {
    closeAssistantSheet();
    patchLocalAssistant({ localAssistant:true, localAssistantProvider:'needle' });
    updateSortSetting({ minimalMode:false }, { renderNow:false });
    applyAddDefaults();openSheet('add-sheet');
    switchAddType('keepup');
    const placeholder = $('ting-message').placeholder;
    const before = load().length;
    $('ting-message').value = 'Read before sunset';
    $('ting-times').value = '3';$('ting-days').value = '7';$('ting-duration').value = '20';
    $('do-save').click();
    const record = load().at(-1);
    return {
      removed:!$('ting-ask-ai') && !$('add-ask-hint'), placeholder,
      added:load().length-before, name:record.name, rhythm:rhythmParts(record.target), duration:record.durationMinutes,
      addClosed:!$('add-sheet').classList.contains('open'),
      detailOpen:$('detail-sheet').classList.contains('open'),
      focused:load()[detailIdx]?.hid===record.hid,
      chatOpen:$('assistant-sheet').classList.contains('open')
    };
  });
  assert(addForm.removed && addForm.placeholder === 'e.g. Read a book', 'Add has a literal name and no assistant control or hint');
  assert(addForm.added === 1 && addForm.name === 'Read before sunset'
    && addForm.rhythm.times === 3 && addForm.rhythm.days === 7 && addForm.duration === 20, 'Add saves exactly the entered name and essential form values');
  assert(addForm.addClosed && addForm.detailOpen && addForm.focused && !addForm.chatOpen, 'Add leads to the saved item in details without starting a chat');

  const longName = await page.evaluate(() => {
    closeDetail();applyAddDefaults();openSheet('add-sheet');
    const before = load().length;
    $('ting-message').value = 'x'.repeat(80);
    $('do-save').click();
    const result={count:load().length-before,open:$('add-sheet').classList.contains('open'),
      toast:$('toast-text').textContent,max:$('ting-message').maxLength};
    cancelAdd();patchLocalAssistant({localAssistantProvider:'auto'});
    return result;
  });
  assert(longName.max === 60 && longName.count === 0 && longName.open, 'Add limits names to 60 characters and validates programmatic overflow');
  assert(/60 characters/.test(longName.toast) && !/sparkles/.test(longName.toast), 'name validation describes the limit without directing creation to AI');

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
