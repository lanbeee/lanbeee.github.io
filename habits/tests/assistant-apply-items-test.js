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

  console.log('\n[apply] a saved place past the old cap is reused, then every dental item gets it');
  const ubSouth = await page.evaluate(async () => {
    const locations = [];
    for(let i = 0; i < 12; i += 1){
      locations.push({id:'p' + i, name:'Place ' + i, address:'Somewhere', lat:43, lng:-78});
    }
    locations.push({id:'ub-south', name:'UB South', address:'Main St', lat:43, lng:-78.7});
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations
    });
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental appointment', durationMinutes:30}),
      assistantTestHabit({hid:'walk', name:'Walk', durationMinutes:30})
    ]);
    const catalog = assistantCatalog(load(), loadSortSettings(), Date.now());
    const envelope = JSON.parse(assistantUserEnvelope(
      'Can you change the location of all the Dental appointments to UB South',
      catalog,
      null,
      null,
      {compact:true}
    ));
    const listed = (envelope.catalog.places || []).map(row => row.name);
    let calls = 0;
    const out = await runAssistantTurn('Can you change the location of all the Dental appointments to UB South', {
      context:assistantBuildContext(),
      complete:async () => {
        calls += 1;
        if(calls === 1){
          return {message:{thinking:'missing from the short list', tool_calls:[
            {function:{name:'draft_setting', arguments:{
              kind:'location',
              name:'UB South',
              address:'University at Buffalo South Campus, Buffalo, NY'
            }}}
          ]}};
        }
        if(calls === 2){
          return {message:{thinking:'apply the saved place', tool_calls:[
            {function:{name:'apply_items', arguments:{search:'dental', placeNames:['UB South']}}}
          ]}};
        }
        return {message:{content:'Those dental changes are ready to save.'}};
      }
    });
    const drafts = Array.isArray(out.drafts) ? out.drafts : [];
    const saved = out.type === 'preview' ? assistantCommitDrafts(drafts) : {ok:false};
    const after = load();
    const places = loadSortSettings().locations || [];
    const dental = after.filter(row => /dental/i.test(row.name || ''));
    const walk = after.find(row => row.name === 'Walk');
    return {
      catalogHas:catalog.places.some(row => row.name === 'UB South'),
      catalogCount:catalog.places.length,
      envelopeHas:listed.includes('UB South'),
      calls,
      type:out.type,
      kinds:drafts.map(row => row && row.kind),
      names:drafts.map(row => row && row.name),
      placeIds:drafts.filter(row => row && row.kind !== 'location').map(row => row.places && row.places.ids),
      savedOk:saved.ok === true,
      placeCount:places.length,
      ubCount:places.filter(row => row && row.name === 'UB South').length,
      dentalIds:dental.map(row => row.locationIds),
      walkIds:walk && walk.locationIds
    };
  });
  assert(ubSouth.catalogHas && ubSouth.catalogCount === 13 && ubSouth.envelopeHas,
    'UB South stays in the catalog and the model envelope (' + ubSouth.catalogCount + ')');
  assert(ubSouth.calls === 3 && ubSouth.type === 'preview'
    && JSON.stringify(ubSouth.kinds) === JSON.stringify(['task', 'task'])
    && ubSouth.names.every(name => /dental/i.test(name)),
    'drafting the existing place continues into the dental change (' + ubSouth.calls + ' ' + ubSouth.type + ' ' + ubSouth.kinds.join(',') + ')');
  assert(ubSouth.savedOk && ubSouth.placeCount === 13 && ubSouth.ubCount === 1
    && ubSouth.dentalIds.every(ids => JSON.stringify(ids) === JSON.stringify(['ub-south']))
    && !(ubSouth.walkIds || []).length,
    'confirming uses the saved UB South and leaves Walk alone');

  console.log('\n[apply] a missing place is created and the item change still runs');
  const clinic = await page.evaluate(async () => {
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home', name:'Home', address:'1 Road', lat:43, lng:-78}]
    });
    save([
      assistantTestHabit({hid:'den-1', name:'Dental cleaning', durationMinutes:45}),
      assistantTestHabit({hid:'den-2', name:'Dental appointment', durationMinutes:30})
    ]);
    let calls = 0;
    const out = await runAssistantTurn('Change the location of all the Dental appointments to Clinic', {
      context:assistantBuildContext(),
      complete:async () => {
        calls += 1;
        if(calls === 1){
          return {message:{tool_calls:[
            {function:{name:'draft_setting', arguments:{kind:'location', name:'Clinic', address:'100 Clinic St'}}}
          ]}};
        }
        if(calls === 2){
          return {message:{tool_calls:[
            {function:{name:'apply_items', arguments:{search:'dental', placeNames:['Clinic']}}}
          ]}};
        }
        return {message:{content:'Clinic is staged and the dental items are ready.'}};
      }
    });
    const drafts = Array.isArray(out.drafts) ? out.drafts : [];
    const saved = out.type === 'preview' ? assistantCommitDrafts(drafts) : {ok:false};
    const places = (loadSortSettings().locations || []).filter(row => row && row.name === 'Clinic');
    const dental = load().filter(row => /dental/i.test(row.name || ''));
    const clinicId = places[0] && places[0].id;
    return {
      calls,
      type:out.type,
      kinds:drafts.map(row => row && row.kind + ':' + row.name),
      savedOk:saved.ok === true,
      clinicCount:places.length,
      dentalIds:dental.map(row => row.locationIds),
      clinicId
    };
  });
  assert(clinic.calls === 3 && clinic.type === 'preview'
    && clinic.kinds.includes('location:Clinic')
    && clinic.kinds.filter(row => row.startsWith('task:')).length === 2,
    'a new place stays staged while the dental change continues (' + clinic.kinds.join(', ') + ')');
  assert(clinic.savedOk && clinic.clinicCount === 1
    && clinic.dentalIds.every(ids => JSON.stringify(ids) === JSON.stringify([clinic.clinicId])),
    'confirming saves Clinic once and points both dental items at it');

  console.log('\n[apply] adding a place by itself still finishes on that draft');
  const library = await page.evaluate(async () => {
    saveSortSettings({...DEFAULT_SORT_SETTINGS, localAssistant:true, locations:[]});
    save([]);
    let calls = 0;
    const out = await runAssistantTurn('Add a place called Library', {
      context:assistantBuildContext(),
      complete:async () => {
        calls += 1;
        if(calls === 1){
          return {message:{tool_calls:[
            {function:{name:'draft_setting', arguments:{kind:'location', name:'Library', address:'Library'}}}
          ]}};
        }
        return {message:{content:'That place is the whole request.'}};
      }
    });
    return {calls, type:out.type, kind:out.draft && out.draft.kind, name:out.draft && out.draft.name};
  });
  assert(library.calls === 2 && library.type === 'preview' && library.kind === 'location' && library.name === 'Library',
    'a place-only request finishes when the model stops, without a phrase check (' + library.calls + ' ' + library.type + ')');

  console.log('\n[apply] a glitching model stops inside the follow-up cap');
  const glitch = await page.evaluate(async () => {
    saveSortSettings({...DEFAULT_SORT_SETTINGS, localAssistant:true, locations:[]});
    save([]);
    let drafts = 0;
    const drafted = await runAssistantTurn('Add a walk', {
      context:assistantBuildContext(),
      complete:async () => {
        drafts += 1;
        return {message:{tool_calls:[
          {function:{name:'draft_item', arguments:{kind:'task', name:'Walk ' + drafts, due:'today'}}}
        ]}};
      }
    });
    let reads = 0;
    const reread = await runAssistantTurn('What is on today?', {
      context:assistantBuildContext(),
      complete:async () => {
        reads += 1;
        return {message:{tool_calls:[
          {function:{name:'answer_schedule', arguments:{query:'day', date:reads === 1 ? 'today' : 'tomorrow', limit:reads}}}
        ]}};
      }
    });
    return {
      followups:ASSISTANT_MAX_FOLLOWUPS,
      maxCalls:ASSISTANT_MAX_LLM_CALLS,
      drafts,
      draftType:drafted.type,
      draftName:drafted.draft && drafted.draft.name,
      reads,
      readType:reread.type,
      readText:reread.text
    };
  });
  assert(glitch.followups === 2 && glitch.maxCalls === 4, 'follow-ups are capped at two and the turn at four model calls');
  assert(glitch.drafts === 3 && glitch.draftType === 'preview' && /Walk/.test(glitch.draftName || ''),
    'a new draft on every reply stops at the cap and keeps the staged item (' + glitch.drafts + ' ' + glitch.draftType + ' ' + glitch.draftName + ')');
  assert(glitch.reads === 3 && glitch.readType === 'say' && glitch.readText,
    'a repeated schedule read with new arguments stops at the cap (' + glitch.reads + ' ' + glitch.readType + ')');

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
