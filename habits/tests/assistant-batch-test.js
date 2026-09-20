// Multi-item assistant turns: the model (not a local parser) extracts items.
// A structured class schedule is one example; vague relative lists are the
// general case.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

const CALENDAR = `Add my entire school calendar:
EAS 199SL UB Seminar
Class Nbr 22351 - Section 0 SEM
08/24/2026 - 12/07/2026
Days: Monday Wednesday Friday
Times: 12:00PM to 12:50PM
To be Announced
Class Nbr 22352 - Section 00 LAB
08/24/2026 - 12/07/2026
Schedule: To be Announced
EAS 200LR EE Concepts for Non-Majors
Class Nbr 16168 - Section A LEC
Days: Monday Wednesday Friday
Knox 14
Times: 9:00AM to 9:50AM
Class Nbr 16169 - Section A2 REC
Days: Friday
Times: 1:00PM to 1:50PM
Clemen 322
HON 214SEM Honors Seminar
Class Nbr 15362 - Section CAR SEM
Days: Tuesday
Times: 9:30AM to 10:20AM
Capen 109
MTH 241LR College Calculus 3
Class Nbr 12011 - Section C LEC
Days: Monday Wednesday Friday
Times: 2:00PM to 2:50PM
Nsc 218
Class Nbr 14833 - Section C3 REC
Days: Monday
Times: 8:00AM to 8:50AM
Norton 210`;

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
  page.on('pageerror', e => console.error('pageerror', String(e)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await waitForAssistant(page);

  console.log('\n[batch] composer accepts a long paste');
  const composer = await page.evaluate(paste => {
    saveSortSettings({ ...loadSortSettings(), localAssistant:true });
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    openAssistantSheet();
    const input = document.getElementById('assistant-input');
    input.value = paste;
    if(typeof assistantResizeComposer === 'function')assistantResizeComposer();
    return {
      max:Number(input.maxLength),
      kept:input.value.length,
      height:parseFloat(input.style.height || '0')
    };
  }, CALENDAR);
  assert(composer.max >= CALENDAR.length, 'composer max is at least the calendar paste (' + composer.max + ')');
  assert(composer.kept === CALENDAR.length, 'the pasted calendar is not clipped');
  assert(composer.height > 44, 'composer grows for a long paste');

  const VAGUE = 'Set up my week: a walk after maghrib tonight, remind me to call the dentist the day after tomorrow around lunch, and stretching every other day starting two days after that at the new Aldi.';
  const MESSY = 'I need a walk after sunset tomorrow night, kettlebells the day after tomorrow if it is not raining, and a grocery run two days after that.';

  console.log('\n[batch] complicated requests skip the fast-path parser');
  const detect = await page.evaluate(({paste, vague, messy}) => {
    const andAlso = 'Add a walk after sunset and also add a 45 minute kettlebells habit every Tuesday';
    return {
      calendarNeeds:assistantRequestNeedsModel(paste),
      calendarHeavy:assistantRequestIsHeavy(paste),
      andAlso:assistantLooksLikeMultiItem(andAlso),
      vague:assistantLooksLikeMultiItem(vague),
      messyMulti:assistantLooksLikeMultiItem(messy),
      messyRisk:assistantFastPathRisk(messy, {intent:'create_task', text:messy}),
      vagueRisk:assistantFastPathRisk(vague, {intent:'create_habit', text:vague}),
      single:assistantRequestNeedsModel('Remind me to call mom')
    };
  }, {paste:CALENDAR, vague:VAGUE, messy:MESSY});
  assert(detect.calendarNeeds && detect.calendarHeavy, 'a long schedule paste is a model request');
  assert(detect.andAlso === true, '"and also add" is several items');
  assert(detect.vague === true && detect.vagueRisk === 'multi-item', 'set-up-my-week is several items for the model');
  assert(detect.messyMulti !== true && detect.messyRisk === 'relative-date', 'a vague list with relative dates is not a local parse');
  assert(detect.single === false, 'a short one-off is not forced through the model');

  console.log('\n[batch] draft_batch previews classes and dummy places');
  const turn = await page.evaluate(async paste => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[],
      weatherProfiles:[],
      homeCityLat:43.0008,
      homeCityLng:-78.789
    });
    save([]);
    const calls = [];
    const out = await runAssistantTurn(paste, {
      forceLlm:true,
      complete:async req => {
        const firstUser = (req.messages || []).find(m => m && m.role === 'user');
        calls.push({
          step:req.step,
          tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean),
          predict:req.maxPredict,
          lastUser:String((req.messages || []).filter(m => m && m.role === 'user').slice(-1)[0] && (req.messages || []).filter(m => m && m.role === 'user').slice(-1)[0].content || '').slice(0, 220),
          envelope:String(firstUser && firstUser.content || '')
        });
        return {message:{thinking:'calendar', tool_calls:[{function:{name:'draft_batch', arguments:{
          places:[
            {name:'Knox 14', address:'Knox 14, University at Buffalo'},
            {name:'Clemen 322'},
            {name:'Capen 109'},
            {name:'Nsc 218'},
            {name:'Norton 210'},
            {name:'To be Announced'}
          ],
          items:[
            {kind:'habit', name:'EAS 199 Seminar', weekdays:'Monday Wednesday Friday', windowText:'from 12:00PM to 12:50PM', durationMinutes:50, placeNames:'To be Announced', delayDays:0},
            {kind:'habit', name:'EAS 199 Lab', windowText:'To be Announced'},
            {kind:'habit', name:'EAS 200 Lecture', weekdays:'Monday Wednesday Friday', windowText:'from 9:00AM to 9:50AM', durationMinutes:50, placeNames:'Knox 14', delayDays:0},
            {kind:'habit', name:'EAS 200 Recitation', weekdays:'Friday', windowText:'from 1:00PM to 1:50PM', durationMinutes:50, placeNames:'Clemen 322', delayDays:0},
            {kind:'habit', name:'HON 214 Seminar', weekdays:'Tuesday', windowText:'from 9:30AM to 10:20AM', durationMinutes:50, placeNames:'Capen 109', delayDays:0},
            {kind:'habit', name:'MTH 241 Lecture', weekdays:'Monday Wednesday Friday', windowText:'from 2:00PM to 2:50PM', durationMinutes:50, placeNames:'Nsc 218', delayDays:0},
            {kind:'habit', name:'MTH 241 Recitation', weekdays:'Monday', windowText:'from 8:00AM to 8:50AM', durationMinutes:50, placeNames:'Norton 210', delayDays:0}
          ]
        }}}]}};
      }
    });
    const drafts = out.drafts || [];
    const items = drafts.filter(row => row.kind === 'habit' || row.kind === 'task');
    const places = drafts.filter(row => row.kind === 'location');
    const lecture = items.find(row => /EAS 200 Lecture/i.test(row.name));
    const rec = items.find(row => /EAS 200 Recitation/i.test(row.name));
    const lab = items.find(row => /Lab/i.test(row.name));
    const knox = places.find(row => /Knox/i.test(row.name));
    return {
      type:out.type,
      steps:calls.map(row => row.step),
      hasBatchTool:calls.some(row => (row.tools || []).includes('draft_batch')),
      predict:calls[0] && calls[0].predict,
      steer:/draft_batch/i.test((calls[0] && calls[0].lastUser) || ''),
      itemNames:items.map(row => row.name),
      placeNames:places.map(row => row.name),
      skippedLab:!lab,
      lectureDays:lecture && lecture.allowedWeekdays,
      lectureDur:lecture && lecture.durationMinutes,
      lecturePlace:lecture && lecture.places && lecture.places.names,
      recDays:rec && rec.allowedWeekdays,
      knoxAddress:knox && knox.address,
      knoxLat:knox && Number.isFinite(Number(knox.lat)),
      placeholder:places.every(row => row.placeholder === true),
      hasFacts:calls.some(row => /"extractedFacts":\{/.test(row.envelope || ''))
    };
  }, CALENDAR);
  assert(turn.type === 'preview', 'batch turn previews (got ' + turn.type + ')');
  assert(turn.steps[0] === 'extract' && turn.steps.length === 1, 'batch skips classify and extracts once');
  assert(turn.hasBatchTool && turn.steer, 'extract offers and steers draft_batch');
  assert(turn.hasFacts !== true, 'parser facts are withheld so the model reads the paste');
  assert(turn.predict > 6000, 'batch extract gets a larger tool budget');
  assert(turn.itemNames.length === 6, 'six scheduled meetings, not the TBA lab (' + turn.itemNames.join(', ') + ')');
  assert(turn.skippedLab, 'unscheduled TBA lab is dropped');
  assert(JSON.stringify(turn.lectureDays) === JSON.stringify([1,3,5]), 'EAS 200 lecture is Mon/Wed/Fri');
  assert(turn.lectureDur === 50, 'lecture duration is 50 minutes');
  assert(turn.lecturePlace && turn.lecturePlace.some(name => /Knox/i.test(name)), 'lecture is at Knox 14');
  assert(JSON.stringify(turn.recDays) === JSON.stringify([5]), 'recitation is Friday');
  assert(turn.placeNames.length >= 5, 'rooms become placeholder places');
  assert(turn.knoxLat && /placeholder/i.test(turn.knoxAddress || ''), 'Knox 14 has dummy coords and a placeholder address');
  assert(turn.placeholder, 'places are marked placeholder');

  console.log('\n[batch] save all writes places then habits');
  const saved = await page.evaluate(async paste => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[],
      weatherProfiles:[],
      homeCityLat:43.0008,
      homeCityLng:-78.789
    });
    save([]);
    const out = await runAssistantTurn(paste, {
      forceLlm:true,
      complete:async () => {
        return {message:{thinking:'calendar', tool_calls:[{function:{name:'draft_batch', arguments:{
          places:[{name:'Knox 14'}, {name:'Norton 210'}],
          items:[
            {kind:'habit', name:'EAS 200 Lecture', weekdays:'Monday Wednesday Friday', windowText:'from 9:00AM to 9:50AM', durationMinutes:50, placeNames:'Knox 14', delayDays:0},
            {kind:'habit', name:'MTH 241 Recitation', weekdays:'Monday', windowText:'from 8:00AM to 8:50AM', durationMinutes:50, placeNames:'Norton 210', delayDays:0}
          ]
        }}}]}};
      }
    });
    await handleAssistantOutcome(out);
    const preview = document.querySelector('.assistant-bubble-preview');
    const saveLabel = preview && preview.textContent;
    await commitAssistantDraft(false);
    const settings = loadSortSettings();
    const data = load();
    const lecture = data.find(row => /EAS 200 Lecture/i.test(row && row.name));
    const knox = (settings.locations || []).find(row => /Knox/i.test(row && row.name));
    return {
      saveLabel,
      locCount:(settings.locations || []).length,
      habitCount:data.length,
      knoxAddr:knox && knox.address,
      knoxId:knox && knox.id,
      lectureLoc:lecture && lecture.locationIds && lecture.locationIds[0],
      lectureStart:lecture && lecture.allowedTimeStart,
      lectureEnd:lecture && lecture.allowedTimeEnd,
      focusHidden:document.getElementById('assistant-focus')?.hidden
    };
  }, CALENDAR);
  assert(/save all/i.test(saved.saveLabel || ''), 'preview offers save all');
  assert(saved.locCount >= 2 && saved.habitCount === 2, 'commit writes 2 places and 2 habits');
  assert(/placeholder/i.test(saved.knoxAddr || ''), 'saved Knox address is still a placeholder');
  assert(saved.lectureLoc && saved.lectureLoc === saved.knoxId, 'lecture locationId matches saved Knox 14');
  assert(saved.lectureStart === 9 * 60 && saved.lectureEnd === 9 * 60 + 50, 'lecture window is 9:00–9:50');
  assert(saved.focusHidden, 'focus bar clears after a batch save');

  console.log('\n[batch] vague relative lists are the model\'s job');
  const vague = await page.evaluate(async prompt => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home', lat:43, lng:-78}],
      weatherProfiles:[]
    });
    save([]);
    const RealDate = Date;
    const frozen = Date.parse('2026-09-17T13:24:00');
    globalThis.Date = class extends RealDate{
      constructor(...args){ return args.length ? new RealDate(...args) : new RealDate(frozen); }
      static now(){ return frozen; }
    };
    const calls = [];
    const out = await runAssistantTurn(prompt, {
      complete:async req => {
        const firstUser = (req.messages || []).find(m => m && m.role === 'user');
        calls.push({
          step:req.step,
          tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean),
          envelope:String(firstUser && firstUser.content || '')
        });
        return {message:{thinking:'week', tool_calls:[{function:{name:'draft_batch', arguments:{
          places:[{name:'Aldi'}],
          items:[
            {kind:'habit', name:'Walk', windowText:'after maghrib'},
            {kind:'task', name:'Call dentist', due:'2026-09-19', dueTime:'12:00'},
            {kind:'habit', name:'Stretching', rhythm:'every other day', placeNames:['Aldi']}
          ]
        }}}]}};
      }
    });
    globalThis.Date = RealDate;
    const drafts = out.drafts || [];
    const items = drafts.filter(row => row.kind === 'habit' || row.kind === 'task');
    const walk = items.find(row => /Walk/i.test(row.name));
    const dentist = items.find(row => /dentist/i.test(row.name));
    const stretch = items.find(row => /Stretch/i.test(row.name));
    const aldi = drafts.find(row => row.kind === 'location' && /Aldi/i.test(row.name));
    const dueKey = row => row && row.dueDate != null && typeof dateKey === 'function' ? dateKey(row.dueDate) : null;
    const pathEv = (out.debug || []).find(ev => ev.t === 'path') || {};
    return {
      type:out.type,
      fastPath:out.fastPath === true,
      via:pathEv.via,
      steps:calls.map(row => row.step),
      hasBatchTool:calls.some(row => (row.tools || []).includes('draft_batch')),
      hasFacts:calls.some(row => /"extractedFacts":\{/.test(row.envelope || '')),
      names:items.map(row => row.name),
      walkAnchor:walk && walk.window && walk.window.start && walk.window.start.anchor,
      dentistDue:dueKey(dentist),
      dentistAnchor:dentist && dentist.window && dentist.window.start && dentist.window.start.anchor,
      stretchPlace:stretch && stretch.places && stretch.places.names,
      walkPlace:walk && walk.places && walk.places.names,
      aldiPlaceholder:Boolean(aldi && aldi.placeholder)
    };
  }, VAGUE);
  assert(vague.type === 'preview' && vague.fastPath !== true, 'vague week setup previews from the model');
  assert(vague.via === 'multi-item' && vague.hasFacts !== true, 'parser facts are not copied into a multi-item turn');
  assert(vague.steps[0] === 'extract' && vague.hasBatchTool, 'extract offers draft_batch');
  assert(vague.names.length === 3, 'three items: ' + (vague.names || []).join(', '));
  assert(vague.walkAnchor === 'maghrib', 'walk window is maghrib from the model');
  assert(vague.dentistDue === '2026-09-19', 'day after tomorrow is the model due, not a parser guess (' + vague.dentistDue + ')');
  assert(!vague.dentistAnchor, 'dentist does not inherit the walk window from the utterance parser');
  assert(vague.stretchPlace && vague.stretchPlace.some(name => /Aldi/i.test(name)), 'stretching is at the new Aldi');
  assert(!(vague.walkPlace || []).some(name => /Aldi/i.test(name)), 'walk does not inherit Aldi from the batch utterance');
  assert(vague.aldiPlaceholder, 'unknown Aldi becomes a placeholder place');

  console.log('\n[batch] relative list without add-verbs still uses the LLM');
  const messy = await page.evaluate(async prompt => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[],
      weatherProfiles:[]
    });
    save([]);
    const calls = [];
    const out = await runAssistantTurn(prompt, {
      complete:async req => {
        const firstUser = (req.messages || []).find(m => m && m.role === 'user');
        calls.push({
          step:req.step,
          tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean),
          envelope:String(firstUser && firstUser.content || '')
        });
        return {message:{thinking:'list', tool_calls:[{function:{name:'draft_batch', arguments:{
          items:[
            {kind:'habit', name:'Walk', windowText:'after sunset'},
            {kind:'habit', name:'Kettlebells', weatherText:'not raining'},
            {kind:'task', name:'Grocery run', due:'2026-09-21'}
          ]
        }}}]}};
      }
    });
    const items = (out.drafts || []).filter(row => row.kind === 'habit' || row.kind === 'task');
    const grocery = items.find(row => /Grocery/i.test(row.name));
    const dueKey = row => row && row.dueDate != null && typeof dateKey === 'function' ? dateKey(row.dueDate) : null;
    const pathEv = (out.debug || []).find(ev => ev.t === 'path') || {};
    return {
      type:out.type,
      fastPath:out.fastPath === true,
      via:pathEv.via,
      risk:pathEv.risk,
      steps:calls.map(row => row.step),
      hasBatchTool:calls.some(row => (row.tools || []).includes('draft_batch')),
      hasFacts:calls.some(row => /"extractedFacts":\{/.test(row.envelope || '')),
      names:items.map(row => row.name),
      groceryDue:dueKey(grocery)
    };
  }, MESSY);
  assert(messy.type === 'preview' && messy.fastPath !== true, 'messy relative list is not a local fast-path create');
  assert(messy.via === 'parser-risk' && messy.risk === 'relative-date', 'relative dates send the whole request to the model');
  assert(messy.steps[0] === 'classify' && messy.hasBatchTool, 'classify still offers draft_batch');
  assert(messy.hasFacts !== true, 'untrusted relative-date facts are withheld');
  assert(messy.names.length === 3, 'model returns three items, not the first clause only');
  assert(messy.groceryDue === '2026-09-21', 'relative dues come from the model (' + messy.groceryDue + ')');

  console.log('\n[batch] invented places on a single draft_item still ask');
  const invented = await page.evaluate(async () => {
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home', lat:43, lng:-78}],
      weatherProfiles:[]
    });
    save([]);
    const out = await runAssistantTurn('Create a weekly barbecue habit', {
      forceLlm:true,
      complete:async req => {
        if(req.step === 'classify'){
          return {message:{thinking:'habit', tool_calls:[{function:{name:'classify_intent', arguments:{intent:'create_habit'}}}]}};
        }
        return {message:{thinking:'draft', tool_calls:[{function:{name:'draft_item', arguments:{
          kind:'habit', name:'Weekly Barbecue', durationMinutes:120, rhythm:'weekly', placeNames:['backyard']
        }}}]}};
      }
    });
    return {type:out.type, ask:out.question || '', name:out.draft && out.draft.name};
  });
  assert(invented.type === 'ask' && /saved place/i.test(invented.ask), 'single-item invented place still asks');
  assert(invented.name === 'Weekly Barbecue', 'the barbecue draft is kept');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
