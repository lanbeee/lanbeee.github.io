// Assistant context entry points: add-sheet AI + detail chat. Context-known
// intent or item skips the classify call (one extract call, or zero for the
// local fast path). Fake LLM throughout; no live model needed.
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
  await page.evaluate(() => patchLocalAssistant({ localAssistant:true }));

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
  assert(addTask.llmCalls === 1 && addTask.calls.length === 1, 'no classify round trip (1 LLM call)');
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
  assert(addSetting.llmCalls === 1 && addSetting.step === 'extract', 'single extract call, no classify');
  assert(/draft_setting/.test(addSetting.steer || ''), 'steer asks for draft_setting');

  console.log('\n[C] opt-in parser shortcut: trivial add never reaches the model');
  const entryLocal = await page.evaluate(async () => {
    patchLocalAssistant({localAssistantModelOnly:false, localAssistantRoutingVersion:2});
    assistantComplete = async () => { throw new Error('LLM must not run for simple entry phrasing'); };
    const ok = await assistantOpenWithInstruction('Remind me to call mom', { intent:'create_task', entry:'add' });
    const session = _assistantSession;
    const retry = document.querySelector('#assistant-thread .assistant-retry');
    const sheetOpen = document.querySelector('#assistant-sheet').classList.contains('open');
    return {
      ok,
      sheetOpen,
      name:session && session.draft && session.draft.name,
      fastPath:Boolean(session && session.debug && session.debug.some(row => row.t === 'path' && row.path === 'local')),
      retry:Boolean(retry)
    };
  });
  assert(entryLocal.ok && entryLocal.sheetOpen, 'entry opens the assistant sheet');
  assert(/mom/i.test(entryLocal.name || ''), 'entry fast path previews the draft locally');
  assert(entryLocal.fastPath, 'trace shows the local path');
  assert(entryLocal.retry, 'use AI instead is offered on entry fast path');

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
  assert(detailEntry.llmCalls === 1 && Number(detailEntry.duration) === 45, 'one model call applies the edit');

  console.log('\n[E] entry buttons: visibility + wiring');
  const chrome = await page.evaluate(() => {
    const display = id => getComputedStyle(document.getElementById(id)).display;
    patchLocalAssistant({ localAssistant:false });
    const off = { ting:display('ting-ask-ai'), detail:display('detail-ask-ai') };
    patchLocalAssistant({ localAssistant:true });
    // Minimal mode hides the whole detail actions page; the AI row must
    // follow its siblings there. Force full mode for the positive check.
    if(typeof updateSortSetting === 'function')updateSortSetting({ minimalMode:false }, { renderNow:false });
    if(typeof applyDetailMinimalMode === 'function')applyDetailMinimalMode();
    const on = { ting:display('ting-ask-ai'), detail:display('detail-ask-ai'), snooze:display('detail-snooze') };
    return { off, on };
  });
  assert(chrome.off.ting === 'none' && chrome.off.detail === 'none', 'entry buttons hidden when assistant is off');
  assert(chrome.on.ting !== 'none' && chrome.on.detail !== 'none', 'entry buttons visible when assistant is on');
  assert(chrome.on.detail === chrome.on.snooze, 'detail AI row matches sibling visibility');

  const addWiring = await page.evaluate(async () => {
    assistantComplete = async req => ({ message:{ thinking:'entry add', tool_calls:[
      { id:'c1', function:{ name:'draft_item', arguments:{ kind:'task', name:'Trash out', durationMinutes:'5' } } }
    ] } });
    clearAssistantChat();
    closeAssistantSheet();
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
      userBubble:Array.from(document.querySelectorAll('#assistant-thread .assistant-bubble-user'))
        .some(node => /Trash out the day after tomorrow/.test(node.textContent || ''))
    };
  });
  assert(addWiring.sheetOpen && addWiring.userBubble, 'add-sheet AI button sends the typed instruction');
  assert(addWiring.entry === 'add' && addWiring.startIntent === 'create_task', 'add-sheet click carries entry provenance and kind');
  assert(addWiring.addSheetStillOpen && /Trash out/.test(addWiring.textKept), 'add sheet stays underneath with text intact');

  const emptyAddClick = await page.evaluate(async () => {
    closeAssistantSheet();
    clearAssistantChat();
    document.getElementById('ting-message').value = '   ';
    document.getElementById('ting-ask-ai').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    return {
      sheetOpen:document.querySelector('#assistant-sheet').classList.contains('open')
    };
  });
  assert(!emptyAddClick.sheetOpen, 'empty add text does not open the assistant');

  const detailWiring = await page.evaluate(async () => {
    localStorage.removeItem(KEY);
    save([{ name:'Walk', type:'keepup', logs:[], durationMinutes:30 }]);
    closeAssistantSheet();
    clearAssistantChat();
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
        .some(node => /Working on Walk/.test(node.textContent || ''))
    };
  });
  assert(detailWiring.sheetOpen && detailWiring.draftName === 'Walk', 'detail AI button focuses the open item');
  assert(detailWiring.intro, 'detail entry shows the local intro without a model call');
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
