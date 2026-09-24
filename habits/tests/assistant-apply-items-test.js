// Set edits: one topic or name query can change, snooze, or delete many
// saved items, and groups can give different subsets different changes.
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
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await waitForAssistant(page);
  await page.evaluate(() => {
    window.assistantTestHabit = props => Object.assign({
      type:'task',
      logs:[],
      durationMinutes:60,
      priority:2,
      topics:[],
      dueDate:Date.now()
    }, props);
  });

  console.log('\n[apply] the model can call apply_items on the first pass');
  const offered = await page.evaluate(() => ({
    classify:assistantStepTools('classify').includes('apply_items'),
    answer:assistantStepTools('answer').includes('apply_items'),
    prompt:/apply_items/.test(assistantSystemPrompt())
  }));
  assert(offered.classify && offered.answer, 'classify and answer both offer apply_items');
  assert(offered.prompt, 'the system prompt tells the model to use apply_items for a set');

  console.log('\n[apply] topic and name search changes every match, then save writes them');
  const changed = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', topics:['health'], durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30}),
      assistantTestHabit({hid:'clean', name:'Cleaning', topics:['Dental'], durationMinutes:20}),
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30, topics:['fitness']})
    ]);
    const session = assistantCreateSession();
    const preview = assistantExecuteTool('apply_items', {
      search:'dental',
      durationMinutes:'3 hours'
    }, session, assistantBuildContext());
    const before = load().map(item => ({name:item.name, duration:item.durationMinutes}));
    const saved = preview.ok ? assistantCommitDrafts(preview.drafts) : null;
    const after = load().map(item => ({name:item.name, duration:item.durationMinutes, topics:item.topics}));
    return {
      ok:preview.ok,
      count:(preview.drafts || []).length,
      names:(preview.drafts || []).map(row => row.name),
      ask:preview.ask || null,
      before,
      savedOk:Boolean(saved && saved.ok),
      after
    };
  });
  assert(changed.ok && changed.count === 3, 'three dental items are staged (' + changed.names.join(', ') + ')');
  assert(changed.before.every(row => row.duration !== 180), 'preview does not write durations');
  assert(changed.savedOk, 'confirming the preview saves the set');
  const dentalAfter = changed.after.filter(row => row.name !== 'Walk');
  const walk = changed.after.find(row => row.name === 'Walk');
  assert(dentalAfter.length === 3 && dentalAfter.every(row => row.duration === 180), 'topic and name matches become three hours');
  assert(walk && walk.duration === 30, 'Walk is left alone');

  console.log('\n[apply] groups can change part of the set and snooze the rest');
  const split = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30}),
      assistantTestHabit({hid:'den-3', name:'Dental xray', durationMinutes:20}),
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30})
    ]);
    const session = assistantCreateSession();
    const preview = assistantExecuteTool('apply_items', {
      search:'dental',
      groups:[
        {names:['Dental cleaning', 'Dental filling'], durationMinutes:180},
        {rest:true, action:'snooze', snooze:'3 days'}
      ]
    }, session, assistantBuildContext());
    const saved = preview.ok ? assistantCommitDrafts(preview.drafts) : null;
    const rows = load();
    const byName = name => rows.find(item => item.name === name);
    return {
      ok:preview.ok,
      ask:preview.ask || preview.error || null,
      names:(preview.drafts || []).map(row => row.name + (row.snoozedUntil ? ' snoozed' : ' ' + row.durationMinutes)),
      savedOk:Boolean(saved && saved.ok),
      clean:byName('Dental cleaning') && byName('Dental cleaning').durationMinutes,
      fill:byName('Dental filling') && byName('Dental filling').durationMinutes,
      xray:byName('Dental xray') && byName('Dental xray').snoozedUntil,
      xrayDuration:byName('Dental xray') && byName('Dental xray').durationMinutes,
      walk:byName('Walk') && byName('Walk').durationMinutes,
      walkSnooze:byName('Walk') && byName('Walk').snoozedUntil
    };
  });
  assert(split.ok && split.savedOk, 'split preview saves (' + (split.ask || split.names.join(', ')) + ')');
  assert(split.clean === 180 && split.fill === 180, 'the named half becomes three hours');
  assert(split.xray > Date.now() && split.xrayDuration === 20, 'the rest is snoozed and keeps its duration');
  assert(split.walk === 30 && !split.walkSnooze, 'items outside the search are untouched');

  console.log('\n[apply] a previous list can be changed without touching the rest of the library');
  const recent = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30}),
      assistantTestHabit({hid:'den-3', name:'Dental xray', durationMinutes:20})
    ]);
    const session = assistantCreateSession();
    session.recent = {items:[{name:'Dental cleaning', hid:'den-1'}, {name:'Dental xray', hid:'den-3'}]};
    const preview = assistantExecuteTool('apply_items', {
      fromRecent:true,
      priority:0
    }, session, assistantBuildContext());
    const saved = preview.ok ? assistantCommitDrafts(preview.drafts) : null;
    const rows = load();
    return {
      ok:preview.ok,
      names:(preview.drafts || []).map(row => row.name),
      savedOk:Boolean(saved && saved.ok),
      priorities:rows.map(item => item.name + ':' + item.priority)
    };
  });
  assert(recent.ok && recent.names.length === 2 && !recent.names.includes('Dental filling'),
    'fromRecent stages only the previous list (' + recent.names.join(', ') + ')');
  assert(recent.savedOk && recent.priorities.filter(row => row.endsWith(':0')).length === 2
    && recent.priorities.includes('Dental filling:2'),
    'only those two priorities change (' + recent.priorities.join(', ') + ')');

  console.log('\n[apply] explicit names are exact and stale previews cannot overwrite newer edits');
  const guardedEdits = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30}),
      assistantTestHabit({hid:'evening-walk', name:'Evening Walk', durationMinutes:45}),
      assistantTestHabit({hid:'walk-dog', name:'Walk dog', durationMinutes:20})
    ]);
    const exact = assistantExecuteTool('apply_items', {
      names:['Walk'],
      durationMinutes:90
    }, assistantCreateSession(), assistantBuildContext());
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30})
    ]);
    const ambiguous = assistantExecuteTool('apply_items', {
      names:['Dental'],
      priority:0
    }, assistantCreateSession(), assistantBuildContext());
    const stale = assistantExecuteTool('apply_items', {
      search:'dental',
      priority:0
    }, assistantCreateSession(), assistantBuildContext());
    const changed = load();
    changed[1].durationMinutes = 95;
    save(changed);
    const committed = assistantCommitDrafts(stale.drafts);
    const after = load();
    return {
      exactOk:exact.ok,
      exactNames:(exact.drafts || []).map(row => row.name),
      ambiguousOk:ambiguous.ok,
      ambiguousAsk:ambiguous.ask,
      staleOk:stale.ok,
      commitOk:Boolean(committed && committed.ok),
      commitError:committed && committed.error,
      rows:after.map(row => ({name:row.name, duration:row.durationMinutes, priority:row.priority}))
    };
  });
  assert(guardedEdits.exactOk && JSON.stringify(guardedEdits.exactNames) === JSON.stringify(['Walk']),
    'the exact title Walk does not expand to other walk titles');
  assert(!guardedEdits.ambiguousOk && /more than one saved item/i.test(guardedEdits.ambiguousAsk || ''),
    'an ambiguous partial title asks instead of changing every partial match');
  assert(guardedEdits.staleOk && !guardedEdits.commitOk && /changed after this preview/i.test(guardedEdits.commitError || ''),
    'a changed row invalidates the whole bulk confirmation');
  assert(guardedEdits.rows.every(row => row.priority === 2)
    && guardedEdits.rows.find(row => row.name === 'Dental filling').duration === 95,
    'stale confirmation writes none of the selected rows');

  console.log('\n[apply] overdue status includes recurring habits');
  const overdueHabits = await page.evaluate(() => {
    const now = Date.now();
    const old = now - 4 * 86400000;
    save([
      assistantTestHabit({hid:'late-habit', name:'Late habit', type:'keepup', target:1, logs:[old], lastLog:old}),
      assistantTestHabit({hid:'fresh-habit', name:'Fresh habit', type:'keepup', target:1, logs:[now], lastLog:now})
    ]);
    const context = assistantBuildContext(now);
    const answer = assistantAnswerItems({query:'list', kind:'habit', status:'overdue'}, context);
    const preview = assistantExecuteTool('apply_items', {
      kind:'habit',
      status:'overdue',
      priority:0
    }, assistantCreateSession(), context);
    return {
      answerNames:(answer.items || []).map(row => row.name),
      applyNames:(preview.drafts || []).map(row => row.name)
    };
  });
  assert(JSON.stringify(overdueHabits.answerNames) === JSON.stringify(['Late habit']),
    'answer_items overdue finds the late recurring habit');
  assert(JSON.stringify(overdueHabits.applyNames) === JSON.stringify(['Late habit']),
    'apply_items uses the same overdue semantics');

  console.log('\n[apply] delete confirms, removes the set, and undo restores it');
  const removed = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning'}),
      assistantTestHabit({hid:'den-2', name:'Dental filling'}),
      assistantTestHabit({hid:'walk', name:'Walk'})
    ]);
    const session = assistantCreateSession();
    const blocked = assistantExecuteTool('apply_items', {action:'delete'}, session, assistantBuildContext());
    const still = load().map(item => item.name);
    const preview = assistantExecuteTool('apply_items', {
      action:'delete',
      search:'dental'
    }, session, assistantBuildContext());
    const beforeCommit = load().length;
    const result = preview.ok ? assistantCommitDelete(preview.pendingDelete) : null;
    const after = load().map(item => item.name);
    if(typeof executeUndo === 'function')executeUndo();
    const restored = load().map(item => item.name);
    return {
      blocked:blocked.ok,
      blockedAsk:blocked.ask || '',
      still,
      ok:preview.ok,
      summary:preview.summary || preview.pendingDelete && preview.pendingDelete.summary,
      beforeCommit,
      removedOk:Boolean(result && result.ok),
      count:result && result.count,
      after,
      restored
    };
  });
  assert(!removed.blocked && /every saved item|topic|title/i.test(removed.blockedAsk),
    'deleting with no filter asks instead of wiping the library');
  assert(removed.still.length === 3, 'the refused delete writes nothing');
  assert(removed.ok && /Dental cleaning/.test(removed.summary || '') && /Dental filling/.test(removed.summary || ''),
    'delete preview names the matched items');
  assert(removed.beforeCommit === 3 && removed.removedOk && removed.count === 2
    && removed.after.length === 1 && removed.after[0] === 'Walk',
    'confirming removes only the dental items');
  assert(removed.restored.length === 3 && removed.restored.includes('Walk')
    && removed.restored.includes('Dental cleaning') && removed.restored.includes('Dental filling'),
    'undo restores the removed set (' + removed.restored.join(', ') + ')');

  console.log('\n[apply] a stale delete confirmation removes nothing');
  const staleDelete = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning'}),
      assistantTestHabit({hid:'den-2', name:'Dental filling'}),
      assistantTestHabit({hid:'walk', name:'Walk'})
    ]);
    const preview = assistantExecuteTool('apply_items', {
      action:'delete',
      search:'dental'
    }, assistantCreateSession(), assistantBuildContext());
    const changed = load();
    changed.find(row => row.hid === 'den-2').durationMinutes = 95;
    save(changed);
    const result = assistantCommitDelete(preview.pendingDelete);
    return {
      previewOk:preview.ok,
      resultOk:Boolean(result && result.ok),
      error:result && result.error,
      names:load().map(row => row.name)
    };
  });
  assert(staleDelete.previewOk && !staleDelete.resultOk && /changed after this preview/i.test(staleDelete.error || ''),
    'a changed target invalidates the delete confirmation');
  assert(staleDelete.names.includes('Dental cleaning') && staleDelete.names.includes('Dental filling')
    && staleDelete.names.includes('Walk'),
    'every item remains after a stale delete');

  console.log('\n[apply] show clears a snooze, overlap asks, and a miss does not create');
  const edges = await page.evaluate(() => {
    const until = Date.now() + 3 * 86400000;
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', snoozedUntil:until}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', snoozedUntil:until}),
      assistantTestHabit({hid:'walk', name:'Walk'})
    ]);
    const shown = assistantExecuteTool('apply_items', {
      search:'dental',
      action:'show'
    }, assistantCreateSession(), assistantBuildContext());
    const showSaved = shown.ok ? assistantCommitDrafts(shown.drafts) : null;
    const snoozes = load().map(item => item.name + ':' + (item.snoozedUntil || 'shown'));
    const overlap = assistantExecuteTool('apply_items', {
      search:'dental',
      groups:[
        {names:['Dental cleaning'], durationMinutes:90},
        {names:['Dental cleaning'], priority:1}
      ]
    }, assistantCreateSession(), assistantBuildContext());
    const overlapCount = load().length;
    const miss = assistantExecuteTool('apply_items', {
      search:'orthodontist',
      durationMinutes:15
    }, assistantCreateSession(), assistantBuildContext());
    return {
      showOk:shown.ok,
      showSaved:Boolean(showSaved && showSaved.ok),
      snoozes,
      overlapOk:overlap.ok,
      overlapAsk:overlap.ask || '',
      overlapCount,
      missOk:miss.ok,
      missAsk:miss.ask || '',
      count:load().length
    };
  });
  assert(edges.showOk && edges.showSaved && edges.snoozes.filter(row => row.endsWith(':shown')).length === 3,
    'show clears the dental snoozes (' + edges.snoozes.join(', ') + ')');
  assert(!edges.overlapOk && /more than one change/i.test(edges.overlapAsk) && edges.overlapCount === 3,
    'overlapping groups ask instead of applying both');
  assert(!edges.missOk && /no saved items/i.test(edges.missAsk) && edges.count === 3,
    'a search miss does not create a replacement');

  console.log('\n[apply] one set can change some items and delete others');
  const mixed = await page.evaluate(() => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30}),
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30})
    ]);
    const thread = document.getElementById('assistant-thread');
    if(thread)thread.innerHTML = '';
    const session = assistantCreateSession();
    const preview = assistantExecuteTool('apply_items', {
      search:'dental',
      groups:[
        {names:['Dental cleaning'], durationMinutes:180},
        {names:['Dental filling'], action:'delete'}
      ]
    }, session, assistantBuildContext());
    const out = {
      type:'apply',
      drafts:preview.drafts,
      draft:preview.draft,
      summary:(preview.drafts || []).map(row => row.name).join('\n'),
      pendingDelete:preview.pendingDelete,
      deleteText:preview.pendingDelete && preview.pendingDelete.summary,
      session
    };
    handleAssistantOutcome(out);
    const buttons = [...document.querySelectorAll('#assistant-thread [data-assistant-act]')].map(node => node.textContent.trim());
    const text = document.getElementById('assistant-thread').textContent;
    const saved = assistantCommitDrafts(preview.drafts);
    const removed = assistantCommitDelete(session.pendingDelete);
    const left = load().map(item => item.name + ':' + item.durationMinutes);
    return {
      ok:preview.ok,
      buttons,
      mentionsDelete:/Dental filling/.test(text) && /Remove/.test(text),
      savedOk:Boolean(saved && saved.ok),
      removedOk:Boolean(removed && removed.ok),
      left
    };
  });
  assert(mixed.ok && mixed.buttons.includes('save changes') && mixed.buttons.includes('remove'),
    'a split change and delete shows both confirmations (' + mixed.buttons.join(', ') + ')');
  assert(mixed.mentionsDelete, 'the delete confirmation names the item being removed');
  assert(mixed.savedOk && mixed.removedOk && mixed.left.includes('Dental cleaning:180')
    && mixed.left.includes('Walk:30') && !mixed.left.some(row => row.startsWith('Dental filling')),
    'save updates one item and remove deletes the other (' + mixed.left.join(', ') + ')');

  console.log('\n[apply] a turn previews the set and save-all is the confirmation');
  const turn = await page.evaluate(async () => {
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental filling', durationMinutes:30}),
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30})
    ]);
    const thread = document.getElementById('assistant-thread');
    if(thread)thread.innerHTML = '';
    const out = await runAssistantTurn('Change all the dental appointments durations to three hours', {
      forceLlm:true,
      complete:async () => ({message:{thinking:'set', tool_calls:[{function:{name:'apply_items', arguments:{
        search:'dental',
        durationMinutes:180
      }}}]}})
    });
    if(typeof handleAssistantOutcome === 'function')handleAssistantOutcome(out);
    const buttons = [...document.querySelectorAll('#assistant-thread [data-assistant-act]')].map(node => node.textContent.trim());
    const say = [...document.querySelectorAll('#assistant-thread .assistant-bubble-say')].map(node => node.textContent).join(' ');
    return {
      type:out.type,
      names:(out.drafts || []).map(row => row.name),
      buttons,
      say
    };
  });
  assert(turn.type === 'preview' && turn.names.length === 2, 'the turn stages both dental items (' + turn.type + ')');
  assert(/save all/i.test(turn.buttons.join(' ')) && /changes/i.test(turn.say),
    'the preview asks to save the changes (' + turn.buttons.join(', ') + ')');

  if(errors.length){
    fail += 1;
    console.error('  not ok: page errors\n' + errors.join('\n'));
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
