// Setting chips stay above the composer. A tap fills the draft and does not
// send. Sending the setting alone re-reads the previous request; typed detail wins.
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');

let passed = 0;
function assert(ok, message){
  if(!ok)throw new Error(message);
  passed++;
  console.log('  ok: ' + message);
}

(async () => {
  let browser;
  try{ browser = await chromium.launch({headless:true, channel:'chrome'}); }
  catch(_){ browser = await chromium.launch({headless:true}); }
  const page = await browser.newPage({viewport:{width:390, height:844}, serviceWorkers:'block'});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try{
    await page.addInitScript(() => {
      localStorage.setItem('tings_app_settings_v2', JSON.stringify({
        minimalMode:false, localAssistant:true, localAssistantProvider:'needle', showWeekOnHome:false
      }));
      localStorage.setItem('tings_coach_install_v2', 'done');
      localStorage.setItem('tings_coach_essentials_v2', 'done');
    });
    await page.goto(BASE, {waitUntil:'load'});
    await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'}).catch(() => {});

    const logic = await page.evaluate(() => {
      const habit = () => assistantFocusOpen({
        operation:'edit', kind:'habit', targetId:'gym', now:new Date('2026-11-01T12:00:00-05:00').getTime()
      });
      save([{hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, priority:2, emoji:'🏋️', logs:[], topics:[], pinned:false, breakable:false}]);
      const habitSession = habit();
      const task = assistantFocusOpen({operation:'edit', kind:'task', targetId:'gym', now:Date.now()});
      const event = assistantFocusOpen({operation:'edit', kind:'event', targetId:'gym', now:Date.now()});
      const ids = text => assistantGuideSuggestions(habitSession, text).map(row => row.id);
      const labels = (session, text) => assistantGuideSuggestions(session, text).map(row => row.label);
      return {
        empty:ids(''),
        weekdays:ids('Tuesday plus Thursday'),
        duration:ids('for 30 minutes'),
        task:labels(task, ''),
        event:labels(event, ''),
        eventPriority:labels(event, 'make this high priority').includes('Priority'),
        composeEmpty:assistantGuideCompose('', 'Duration', habitSession),
        composeToggle:assistantGuideCompose('Duration: ', 'Duration', habitSession),
        composeSwitch:assistantGuideCompose('Duration: ', 'Frequency', habitSession),
        composePrefix:assistantGuideCompose('Tuesday plus Thursday', 'Allowed weekdays', habitSession),
        composeRetarget:assistantGuideCompose('Allowed weekdays: Tuesday plus Thursday', 'Preferred weekdays', habitSession),
        composeRemove:assistantGuideCompose('Preferred weekdays: Tuesday plus Thursday', 'Preferred weekdays', habitSession),
        looseTyped:assistantGuideParse('Allowed weekdays Friday', habitSession),
        colon:assistantGuideParse('Allowed weekdays: Friday', habitSession),
        bareOut:assistantGuideOutgoing('Allowed weekdays:', habitSession),
        detailOut:assistantGuideOutgoing('Allowed weekdays: Friday', habitSession),
        browserDays:assistantGuideBrowse(habitSession,'best days').map(def=>def.id),
        browserNative:assistantGuideBrowse(habitSession,'reminder').some(def=>def.family==='reminders'),
        help:assistantGuideHelp('preferredWeekdays'),
        dnd:assistantGuideParse('Do Not Disturb during session', habitSession)
      };
    });
    assert(logic.empty.join() === 'frequency,durationMinutes,allowedWeekdays,allowedWindow,places,priority',
      'an empty habit draft leads with frequency, duration, and weekdays, then hours, place, and priority');
    assert(logic.weekdays[0] === 'allowedWeekdays' && logic.weekdays.indexOf('preferredWeekdays') === 1
      && logic.weekdays.indexOf('frequency') > logic.weekdays.indexOf('preferredWeekdays')
      && logic.weekdays.length > 3 && logic.weekdays.length <= 6,
      `a weekday sentence leads with the named days, then nearby day settings, then more general ones (${logic.weekdays.join()})`);
    assert(logic.duration[0] === 'durationMinutes' && logic.duration.indexOf('frequency') === 1
      && logic.duration.indexOf('frequency') < logic.duration.indexOf('allowedWeekdays')
      && logic.duration.length > 3 && logic.duration.length <= 6,
      `a length leads with duration, then frequency, then more general settings (${logic.duration.join()})`);
    assert(logic.task.join() === 'Due date,Duration,Start time,Hard deadline,Places,Priority',
      'a task leads with its date, length, and time, then deadline, place, and priority');
    assert(logic.event.slice(0, 3).join() === 'Start date,Start time,Repeats' && logic.eventPriority === false
      && logic.event.indexOf('Repeat weekdays') > 2 && logic.event.length <= 6,
      `an event leads with its date, time, and repeat, and does not offer priority (${logic.event.join()})`);
    assert(logic.composeEmpty === 'Duration' && logic.composeToggle === '' && logic.composeSwitch === 'Frequency',
      'a tap inserts a setting, the same tap removes it, and another tap replaces it');
    assert(logic.composePrefix === 'Allowed weekdays: Tuesday plus Thursday'
      && logic.composeRetarget === 'Preferred weekdays: Tuesday plus Thursday'
      && logic.composeRemove === 'Tuesday plus Thursday',
      'tapping a setting keeps words already in the box and can hand them to another setting');
    assert(logic.looseTyped == null && logic.colon && logic.colon.rest === 'Friday'
      && logic.bareOut === 'Allowed weekdays' && logic.detailOut === 'Allowed weekdays: Friday'
      && logic.dnd && logic.dnd.rest === '' && logic.dnd.id === 'reminderDnd',
      'only a setting name, or a name with its own detail, steers the request');
    assert(logic.browserDays.includes('preferredWeekdays') && !logic.browserNative
      && logic.help.description.includes('other allowed days'),
      'search explains preferences in ordinary words and keeps Android reminders out of the PWA');
    const blockedGuides=await page.evaluate(()=>{
      const session=assistantFocusOpen({operation:'edit',kind:'habit',targetId:'gym'});
      session.currentRequest='Pin it';
      session.unresolved=[{field:'periodDays',family:'recurrence',question:'How often?'},{field:'preferredWindow',family:'schedule',question:'What hours?'}];
      return assistantGuideSuggestions(session,session.currentRequest).map(def=>def.id);
    });
    assert(blockedGuides[0]==='frequency'&&blockedGuides[1]==='preferredWindow',
      'settings blocking Save appear before the last request’s already-understood setting');

    const guided = await page.evaluate(async () => {
      const decline = spec => {
        if(spec.family === 'families')return {confidence:1, function_calls:[{arguments:{evidence:'', outside:''}}]};
        if(spec.family === 'completeness')return {confidence:1, function_calls:[{arguments:{missing:''}}]};
        if(spec.family === 'family-routing')return {confidence:1, function_calls:[{arguments:{family:'conversation'}}]};
        if(spec.family === 'field-routing')return {confidence:1, function_calls:[{arguments:{field:''}}]};
        const key = Object.keys(spec.tool.parameters.properties)[0];
        return {confidence:1, function_calls:[{name:spec.tool.name, arguments:{[key]:''}}]};
      };
      const quote = spec => {
        if(['families','completeness','family-routing','field-routing'].includes(spec.family) || String(spec.jobId || '').startsWith('$'))return decline(spec);
        const [key, property] = Object.entries(spec.tool.parameters.properties)[0];
        return {confidence:0.95, function_calls:[{name:spec.tool.name, arguments:{[key]:(property.enum || [])[0] || ''}}]};
      };
      const open = () => {
        save([{hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, priority:2, emoji:'🏋️', logs:[], topics:[], pinned:false, breakable:false, reminders:{}}]);
        return assistantFocusOpen({operation:'edit', kind:'habit', targetId:'gym', now:new Date('2026-11-01T12:00:00-05:00').getTime()});
      };
      const turn = async (session, text, extract) => {
        const before = JSON.stringify(load());
        const enums = [];
        await assistantFocusTurn(session, text, {
          extract: async spec => {
            if(spec.jobId && !String(spec.jobId).startsWith('$')){
              const property = Object.values(spec.tool.parameters.properties)[0];
              enums.push({job:spec.jobId, enum:property && property.enum || []});
            }
            return extract(spec);
          },
          rank: async () => ({rankings:[]})
        });
        return {
          saved:before === JSON.stringify(load()),
          changes:session.changes.map(change => ({field:change.field, value:change.value})),
          questions:session.unresolved.map(item => item.question),
          canSave:assistantFocusCanSave(session),
          enums
        };
      };
      const cases = [];
      const named = open();
      cases.push({name:'literal name',...await turn(named,'Name: Every day',quote)});
      const kind = open();
      cases.push({name:'literal kind',...await turn(kind,'Habit or task: task',quote)});
      const weekdays = open();
      cases.push({name:'declined weekdays', ...await turn(weekdays, 'Tuesday plus Thursday', decline)});
      cases.push({name:'bare allowed', ...await turn(weekdays, 'Allowed weekdays', quote)});
      const friday = open();
      await turn(friday, 'Tuesday plus Thursday', decline);
      cases.push({name:'typed friday', ...await turn(friday, 'Allowed weekdays: Friday', quote)});
      const preferred = open();
      cases.push({name:'preferred friday', ...await turn(preferred, 'Preferred weekdays: Friday', quote)});
      const duration = open();
      await turn(duration, 'for 30 minutes', decline);
      cases.push({name:'bare duration', ...await turn(duration, 'Duration', quote)});
      const rhythm = open();
      await turn(rhythm, 'three times a week', decline);
      cases.push({name:'bare frequency', ...await turn(rhythm, 'Frequency', quote)});
      const dnd = open();
      await turn(dnd, 'Stop silencing my phone', decline);
      cases.push({name:'bare dnd', ...await turn(dnd, 'Do Not Disturb during session', quote)});
      const places = open();
      await turn(places, 'Pin it.', quote);
      cases.push({name:'unrelated places', ...await turn(places, 'Places', quote)});
      const repeated = open();
      await turn(repeated, 'Tuesday plus Thursday', decline);
      await turn(repeated, 'Allowed weekdays', decline);
      cases.push({name:'repeated guide', ...await turn(repeated, 'Allowed weekdays', quote)});
      const correction = open();
      await turn(correction, 'Pin it', quote);
      const earlier=assistantFocusClone(correction.changes);
      await turn(correction, 'Tag it Health', quote);
      const rewind=assistantGuideRevise(correction);
      cases.push({name:'rewind',ok:rewind==='Tag it Health'
        && JSON.stringify(correction.changes)===JSON.stringify(earlier)
        && !correction.dependencies.topics.length
        && correction.requests.join()==='Pin it'
        && !assistantGuideCanRevise(correction)});
      return cases;
    });
    const byName = name => guided.find(row => row.name === name);
    assert(!byName('literal name').changes.length&&!byName('literal name').canSave
      &&byName('literal name').questions.some(q=>q.includes('detail editor')),
      `a Name guide cannot rename or reinterpret the title as recurrence (${JSON.stringify(byName('literal name'))})`);
    assert(byName('literal kind').changes.some(change=>change.field==='kind'&&change.value==='task'),
      'an explicit Habit or task guide accepts the selected kind as its value');
    const week = byName('bare allowed');
    const weekChange = week.changes.find(change => change.field === 'allowedWeekdays');
    assert(byName('declined weekdays').saved && week.saved && weekChange && weekChange.value.join() === '2,4'
      && !week.changes.some(change => change.field === 'allowedWeekdays' && change.value.join() === '1,2,3,4,5')
      && week.canSave,
      `naming Allowed weekdays uses Tuesday and Thursday from the previous request (${JSON.stringify(week)})`);
    const typed = byName('typed friday');
    const typedDays = typed.changes.find(change => change.field === 'allowedWeekdays');
    assert(typed.saved && typedDays && typedDays.value.join() === '5' && typed.canSave,
      `detail typed after the setting replaces the previous days (${JSON.stringify(typed)})`);
    const prefer = byName('preferred friday');
    const preferDays = prefer.changes.find(change => change.field === 'preferredWeekdays');
    assert(prefer.saved && preferDays && preferDays.value.join() === '5'
      && !prefer.changes.some(change => change.field === 'allowedWeekdays') && prefer.canSave,
      `Preferred weekdays keeps the typed day as a preference (${JSON.stringify(prefer)})`);
    const length = byName('bare duration');
    assert(length.saved && length.changes.some(change => change.field === 'durationMinutes' && change.value === 30) && length.canSave,
      `naming Duration uses the previous length (${JSON.stringify(length)})`);
    const rhythm = byName('bare frequency');
    assert(rhythm.saved && rhythm.changes.some(change => change.field === 'timesPerPeriod' && change.value === 3)
      && rhythm.changes.some(change => change.field === 'periodDays' && change.value === 7) && rhythm.canSave,
      `naming Frequency uses the previous rhythm (${JSON.stringify(rhythm)})`);
    const dnd = byName('bare dnd');
    assert(dnd.saved && dnd.changes.some(change => change.field === 'reminderDnd' && change.value === false) && dnd.canSave,
      `naming Do Not Disturb keeps “stop silencing” off (${JSON.stringify(dnd)})`);
    const places = byName('unrelated places');
    assert(places.saved && places.changes.some(change => change.field === 'pinned' && change.value === true)
      && !places.changes.some(change => change.field === 'places'),
      `a setting the previous sentence does not mention is not invented (${JSON.stringify(places)})`);
    assert(byName('repeated guide').changes.some(change=>change.field==='allowedWeekdays'&&change.value.join()==='2,4'),
      'trying the same guide again retains the original request as evidence');
    assert(byName('rewind').ok,'fixing a request removes its draft and new topic dependency while retaining earlier edits');

    await page.evaluate(() => {
      save([{hid:'gym', name:'Gym', type:'keepup', target:7, durationMinutes:45, priority:2, emoji:'🏋️', logs:[], topics:[], pinned:false, breakable:false}]);
      assistantOpenForItem('gym', 'home');
      assistantNeedleCanSend = () => true;
      const real = assistantFocusTurn;
      window.__guideSent = [];
      assistantFocusTurn = async (session, text) => {
        session.requests.push(text);
        session.currentRequest = text;
        window.__guideSent.push(text);
        return {type:'focus', cancelled:true, session};
      };
      window.__guideRealTurn = real;
      assistantSyncSend();
      assistantRenderGuides();
    });

    const guides = page.locator('#assistant-guides-row .assistant-guide');
    await guides.first().waitFor({state:'visible'});
    const opening = await guides.allTextContents();
    const guideScroll = await page.evaluate(() => {
      const row = document.getElementById('assistant-guides-row');
      return {count:row.querySelectorAll('.assistant-guide').length, scroll:row.scrollWidth, client:row.clientWidth};
    });
    assert(guideScroll.count === 6 && guideScroll.scroll > guideScroll.client,
      `six opening chips stay in one horizontal row (${JSON.stringify(guideScroll)})`);
    assert(opening.slice(0, 3).join() === 'Frequency,Duration,Allowed weekdays'
      && opening.join() === 'Frequency,Duration,Allowed weekdays,Allowed hours,Places,Priority',
      'the opening chips put the most likely habit settings on the left');
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('best days');
    const browserChoice=page.locator('#assistant-guide-results [data-assistant-guide="preferredWeekdays"]');
    assert(await browserChoice.isVisible() && (await browserChoice.textContent()).includes('other allowed days'),
      'All settings finds a field by everyday language and explains it');
    await browserChoice.click();
    const tagged = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      mention:document.getElementById('assistant-mention-label').textContent,
      hidden:document.getElementById('assistant-mention').hidden,
      draft:assistantComposerDraft()
    }));
    assert(tagged.mention === 'Preferred weekdays' && tagged.hidden === false && tagged.value === ''
      && tagged.draft === 'Preferred weekdays: '
      && !(await page.locator('#assistant-guide-browser').isVisible())
      && (await page.locator('#assistant-guide-hint').textContent()).includes('Example:'),
      'choosing a search result tags only its name, closes the browser, and shows an example');
    await page.locator('#assistant-mention-remove').click();
    const bubblesBefore = await page.locator('.assistant-bubble-user').count();
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Duration', exact:true}).click();
    const drafted = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      mention:document.getElementById('assistant-mention-label').textContent,
      hidden:document.getElementById('assistant-mention').hidden,
      placeholder:document.getElementById('assistant-input').placeholder,
      pressed:document.querySelector('[data-assistant-guide="durationMinutes"]')?.getAttribute('aria-pressed'),
      focused:document.activeElement === document.getElementById('assistant-input'),
      sent:window.__guideSent.slice(),
      bubbles:document.querySelectorAll('.assistant-bubble-user').length
    }));
    assert(drafted.mention === 'Duration' && drafted.hidden === false && drafted.value === ''
      && drafted.placeholder === 'Add details, or send' && drafted.pressed === 'true',
      'a tap tags the setting and leaves the box for the value');
    assert(drafted.focused && drafted.sent.length === 0 && drafted.bubbles === bubblesBefore, 'a tap does not send');
    assert(await page.locator('#assistant-send').isEnabled(), 'the draft can be sent immediately');
    await page.keyboard.type('45 minutes');
    const beside = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      mention:document.getElementById('assistant-mention-label').textContent,
      draft:assistantComposerDraft()
    }));
    assert(beside.value === '45 minutes' && beside.mention === 'Duration' && beside.draft === 'Duration: 45 minutes',
      'typing continues beside the setting tag');
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Duration', exact:true}).click();
    assert((await page.locator('#assistant-input').inputValue()).trim() === '45 minutes'
      && await page.locator('#assistant-mention').isHidden(),
      'tapping the same setting removes the tag and keeps the typed detail');
    await page.locator('#assistant-input').fill('Tuesday plus Thursday');
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Allowed weekdays', exact:true}).click();
    let moved = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      mention:document.getElementById('assistant-mention-label').textContent
    }));
    assert(moved.mention === 'Allowed weekdays' && moved.value === 'Tuesday plus Thursday',
      'a tap keeps a sentence already in the box');
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Preferred weekdays', exact:true}).click();
    moved = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      mention:document.getElementById('assistant-mention-label').textContent
    }));
    assert(moved.mention === 'Preferred weekdays' && moved.value === 'Tuesday plus Thursday',
      'another tap moves those words to the other setting');
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Preferred weekdays', exact:true}).click();
    assert(await page.locator('#assistant-input').inputValue() === 'Tuesday plus Thursday'
      && await page.locator('#assistant-mention').isHidden(),
      'removing the setting restores the sentence');

    await page.locator('#assistant-input').fill('Tuesday plus Thursday');
    await page.locator('#assistant-send').click();
    await page.locator('.assistant-bubble-user').last().waitFor({state:'visible'});
    const afterSend = await page.evaluate(() => ({
      chips:[...document.querySelectorAll('#assistant-guides-row .assistant-guide')].map(button => button.textContent),
      visible:!document.getElementById('assistant-guides').hidden,
      input:document.getElementById('assistant-input').value,
      bubble:[...document.querySelectorAll('.assistant-bubble-user')].at(-1)?.textContent
    }));
    assert(afterSend.bubble === 'Tuesday plus Thursday' && afterSend.input === '' && afterSend.visible
      && afterSend.chips[0] === 'Allowed weekdays' && afterSend.chips.includes('Preferred weekdays'),
      `chips stay available after a message and follow that request (${JSON.stringify(afterSend)})`);
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Allowed weekdays', exact:true}).click();
    await page.locator('#assistant-send').click();
    const sentGuide = await page.evaluate(() => window.__guideSent.slice());
    assert(sentGuide.at(-1) === 'Allowed weekdays'
      && (await page.locator('.assistant-bubble-user').last().textContent()) === 'Allowed weekdays',
      'sending the setting alone delivers that name, ready to use the previous request');
    await page.locator('#assistant-guides-row').getByRole('button', {name:'Allowed weekdays', exact:true}).click();
    await page.keyboard.type('Friday');
    await page.locator('#assistant-send').click();
    const sentDetail = await page.evaluate(() => window.__guideSent.at(-1));
    assert(sentDetail === 'Allowed weekdays: Friday', 'extra typed detail is sent with the setting');

    await page.evaluate(() => assistantShowBusy(true));
    assert(await page.locator('#assistant-guides-row .assistant-guide').first().isDisabled(), 'chips wait while a reply is in progress');
    const locked = await page.locator('#assistant-input').inputValue();
    await page.locator('#assistant-guides-row .assistant-guide').first().click({force:true});
    assert(await page.locator('#assistant-input').inputValue() === locked, 'a busy chip cannot change the draft');
    await page.evaluate(() => assistantShowBusy(false));

    await page.evaluate(() => clearAssistantChat());
    assert((await guides.count()) === 6 && await guides.first().isVisible(), 'clearing the chat keeps the setting choices');

    const dockBottom = () => page.evaluate(() => {
      const input = document.getElementById('assistant-input').getBoundingClientRect();
      const send = document.getElementById('assistant-send').getBoundingClientRect();
      return {input:input.bottom, send:send.bottom, height:input.height};
    });
    await page.locator('#assistant-input').fill('keep this');
    const beforeSearch = await dockBottom();
    await page.locator('#assistant-guide-more').click();
    const opened = await page.evaluate(() => ({
      browser:!document.getElementById('assistant-guide-browser').hidden,
      sameBox:!document.getElementById('assistant-guide-search'),
      value:document.getElementById('assistant-input').value,
      label:document.getElementById('assistant-input').getAttribute('aria-label')
    }));
    const duringSearch = await dockBottom();
    assert(opened.browser && opened.sameBox && opened.value === 'keep this' && opened.label === 'Find a setting or ask',
      'find a setting uses the message box and keeps what was already written');
    assert(Math.abs(duringSearch.input - beforeSearch.input) <= 2 && Math.abs(duringSearch.send - beforeSearch.send) <= 2
      && duringSearch.height <= 46,
      `the message box stays put when search opens (${JSON.stringify({beforeSearch, duringSearch})})`);
    const scrollLock = await page.evaluate(() => {
      const sheet = document.querySelector('.assistant-sheet');
      const input = document.getElementById('assistant-input');
      const before = input.getBoundingClientRect().bottom;
      sheet.scrollTop = 400;
      document.documentElement.scrollTop = 400;
      document.body.scrollTop = 400;
      const after = input.getBoundingClientRect().bottom;
      return {
        moved:Math.abs(after - before),
        sheetTop:sheet.scrollTop,
        pageTop:document.documentElement.scrollTop || document.body.scrollTop,
        overflow:getComputedStyle(sheet).overflowY
      };
    });
    assert(scrollLock.moved <= 1 && scrollLock.sheetTop === 0 && scrollLock.pageTop === 0 && scrollLock.overflow === 'hidden',
      `the page has nothing to scroll, so the message box stays put (${JSON.stringify(scrollLock)})`);
    const keyboard = await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--keyboard-viewport-bottom', '520px');
      root.style.setProperty('--keyboard-lift', '324px');
      const input = document.getElementById('assistant-input').getBoundingClientRect();
      const sheet = document.querySelector('.assistant-sheet').getBoundingClientRect();
      const placed = {inputBottom:input.bottom, sheetBottom:sheet.bottom};
      root.style.removeProperty('--keyboard-viewport-bottom');
      root.style.removeProperty('--keyboard-lift');
      return placed;
    });
    assert(Math.abs(keyboard.sheetBottom - 520) <= 2 && Math.abs(keyboard.inputBottom - keyboard.sheetBottom) <= 2,
      `the message box stays on the visible edge when the keyboard opens (${JSON.stringify(keyboard)})`);
    await page.locator('#assistant-input').fill('days');
    const chosen = await page.evaluate(() => {
      const input = document.getElementById('assistant-input');
      const label = document.querySelector('#assistant-guide-results [data-assistant-guide]')?.dataset.guideLabel || '';
      const before = window.__guideSent.length;
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
      return {
        label,
        draft:assistantComposerDraft(),
        sent:window.__guideSent.length - before,
        browser:document.getElementById('assistant-guide-browser').hidden,
        focused:document.activeElement === input
      };
    });
    assert(chosen.browser && chosen.focused && chosen.sent === 0 && chosen.label && chosen.draft === `${chosen.label}: keep this`,
      `Enter chooses the setting and keeps the message from before the search (${JSON.stringify(chosen)})`);
    await page.locator('#assistant-mention-remove').click();
    await page.locator('#assistant-input').fill('keep this');
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('zzzz-not-a-setting');
    await page.locator('#assistant-input').press('Enter');
    const asked = await page.evaluate(() => ({
      sent:window.__guideSent.at(-1),
      browser:document.getElementById('assistant-guide-browser').hidden,
      input:document.getElementById('assistant-input').value
    }));
    assert(asked.sent === 'zzzz-not-a-setting' && asked.browser && asked.input === '',
      `Enter sends the question when no setting matches (${JSON.stringify(asked)})`);
    await page.locator('#assistant-input').fill('restore me');
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('days');
    await page.locator('#assistant-guide-clear').click();
    const cleared = await page.evaluate(() => document.querySelectorAll('#assistant-guide-results [data-assistant-guide]').length);
    assert(cleared > 3 && await page.locator('#assistant-input').inputValue() === '',
      'clearing the search shows every setting and leaves the box empty');
    await page.locator('#assistant-input').press('Escape');
    const restored = await page.evaluate(() => ({
      value:document.getElementById('assistant-input').value,
      browser:document.getElementById('assistant-guide-browser').hidden,
      sheet:document.getElementById('assistant-sheet').classList.contains('open')
    }));
    assert(restored.value === 'restore me' && restored.browser && restored.sheet,
      `Escape closes search, puts the message back, and leaves the assistant open (${JSON.stringify(restored)})`);
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('weekdays');
    await page.locator('#assistant-input').press('ArrowDown');
    await page.keyboard.press('Enter');
    const fromList = await page.evaluate(() => ({
      mention:document.getElementById('assistant-mention-label').textContent,
      value:document.getElementById('assistant-input').value,
      sent:window.__guideSent.at(-1)
    }));
    assert(fromList.mention.length > 0 && fromList.value === 'restore me' && fromList.sent === 'zzzz-not-a-setting',
      `arrowing into the list chooses that setting without sending (${JSON.stringify(fromList)})`);
    await page.locator('#assistant-mention-remove').click();
    const parkedBottom = await dockBottom();
    await page.locator('#assistant-input').fill('ask from the button');
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('days');
    await page.locator('#assistant-send').click();
    const sentVisible = await page.evaluate(() => ({
      sent:window.__guideSent.at(-1),
      browser:document.getElementById('assistant-guide-browser').hidden
    }));
    const sentBox = await dockBottom();
    assert(sentVisible.sent === 'days' && sentVisible.browser
      && Math.abs(sentBox.input - parkedBottom.input) <= 2,
      `send asks with the text in the box and the box stays put (${JSON.stringify({sentVisible, parkedBottom, sentBox})})`);

    const fit = async width => {
      await page.setViewportSize({width, height:844});
      const box = await page.evaluate(() => {
        const sheet = document.querySelector('.assistant-sheet').getBoundingClientRect();
        const guides = document.getElementById('assistant-guides').getBoundingClientRect();
        const input = document.getElementById('assistant-input').getBoundingClientRect();
        const send = document.getElementById('assistant-send').getBoundingClientRect();
        return {
          sheetWidth:sheet.width, sheetRight:sheet.right,
          guidesRight:guides.right, guidesLeft:guides.left, guidesBottom:guides.bottom, guidesTop:guides.top,
          inputTop:input.top, inputBottom:input.bottom, inputRight:input.right,
          sendTop:send.top, sendBottom:send.bottom, sendLeft:send.left,
          scroll:document.documentElement.scrollWidth, client:document.documentElement.clientWidth
        };
      });
      assert(box.guidesLeft >= 0 && box.guidesRight <= box.sheetRight + 1 && box.scroll <= box.client + 1,
        `the choices fit a ${width}px screen`);
      assert(box.guidesBottom <= box.inputTop + 1 && box.sendLeft >= box.inputRight - 2
        && Math.abs(box.sendBottom - box.inputBottom) < 12,
        `the choices sit above the message and send stays beside it at ${width}px`);
    };
    await fit(390);
    await fit(320);
    await page.setViewportSize({width:320,height:460});
    const rested = await dockBottom();
    await page.locator('#assistant-guide-more').click();
    await page.locator('#assistant-input').fill('days');
    const shortScreen=await page.evaluate(()=>{
      const input=document.getElementById('assistant-input').getBoundingClientRect();
      const send=document.getElementById('assistant-send').getBoundingClientRect();
      const result=document.querySelector('#assistant-guide-results .assistant-guide').getBoundingClientRect();
      const toggle=document.getElementById('assistant-guide-more').getBoundingClientRect();
      return {inputTop:input.top,inputBottom:input.bottom,sendBottom:send.bottom,toggleLeft:toggle.left,resultTop:result.top,resultBottom:result.bottom,resultHeight:result.height,height:innerHeight,width:document.documentElement.scrollWidth};
    });
    await page.screenshot({path:'/tmp/assistant-guides-short-phone.png'});
    assert(shortScreen.inputBottom<=shortScreen.height&&shortScreen.sendBottom<=shortScreen.height
      &&shortScreen.toggleLeft>=0&&shortScreen.width<=320,
      `the message box and send stay on a shortened phone viewport (${JSON.stringify(shortScreen)})`);
    assert(shortScreen.resultHeight>=40&&shortScreen.resultBottom<=shortScreen.inputTop+1,
      'at least one complete setting stays visible above the message box');
    assert(Math.abs(shortScreen.inputBottom-rested.input)<=2, 'opening search on a short screen does not move the message box');
    await page.locator('#assistant-input').press('Escape');
    await page.setViewportSize({width:1280, height:844});
    await page.waitForFunction(() => paneTierActive());
    await fit(1280);
    await page.screenshot({path:'/tmp/assistant-guides.png'});
    assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`\n${passed} passed`);
  }finally{
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
