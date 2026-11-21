const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_app_settings_v2', JSON.stringify({
        agendaOptimizer:false, showWeekOnHome:false, preset:'todayFirst',
        topics:['Home','Work','Health'],
        locations:[
          {id:'desk', name:'Desk', lat:40, lng:-73},
          {id:'gym', name:'Gym', lat:40.01, lng:-73.01}
        ]
      }));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof save === 'function' && typeof itemFilterStatus === 'function');
    const classified = await page.evaluate(()=>{
      const today = dayStart(Date.now());
      const day = n => today + n * 86400000;
      save([
        {hid:'overdue-task', name:'Pay bill', type:'task', dueDate:day(-1), eventTime:null, lastLog:null, logs:[], priority:0, topics:['Home'], locationIds:['desk'], pinned:false, durationMinutes:10},
        {hid:'week-task', name:'Old bill', type:'task', dueDate:offsetCalendarDay(today, -10), eventTime:null, lastLog:null, logs:[], priority:2, topics:['Work'], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'month-task', name:'Ancient bill', type:'task', dueDate:offsetCalendarDay(today, -40), eventTime:null, lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:45},
        {hid:'today-task', name:'Write note', type:'task', dueDate:today, eventTime:null, lastLog:null, logs:[], priority:2, topics:['Work'], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'tomorrow-task', name:'Call bank', type:'task', dueDate:day(1), eventTime:null, lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:15},
        {hid:'two-day-task', name:'Renew license', type:'task', dueDate:day(2), eventTime:null, lastLog:null, logs:[], priority:3, topics:[], locationIds:[], pinned:false, durationMinutes:75},
        {hid:'soon-task', name:'Book flight', type:'task', dueDate:day(3), eventTime:null, lastLog:null, logs:[], priority:4, topics:['Home'], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'later-task', name:'Learn piano', type:'task', dueDate:day(20), eventTime:null, lastLog:null, logs:[], priority:5, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'someday', name:'Someday idea', type:'task', dueDate:null, eventTime:null, lastLog:null, logs:[], priority:5, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-overdue', name:'Meditate', type:'keepup', target:1, lastLog:day(-3), logs:[day(-3)], priority:2, topics:['Health'], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-week', name:'Skip rope', type:'keepup', target:1, lastLog:offsetCalendarDay(today, -10), logs:[offsetCalendarDay(today, -10)], priority:2, topics:['Health'], locationIds:['gym'], pinned:false, durationMinutes:15},
        {hid:'habit-plan', name:'Plan garden', type:'keepup', target:7, lastLog:today, logs:[today], planByDate:offsetCalendarDay(today, -40), priority:2, topics:['Home'], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-today', name:'Vitamins', type:'keepup', target:1, lastLog:day(-1), logs:[day(-1)], priority:2, topics:['Health'], locationIds:[], pinned:false, durationMinutes:10},
        {hid:'habit-tomorrow', name:'Water plants', type:'keepup', target:2, lastLog:day(-1), logs:[day(-1)], priority:2, topics:['Home'], locationIds:[], pinned:false, durationMinutes:10},
        {hid:'habit-ok', name:'Stretch', type:'keepup', target:7, lastLog:today, logs:[today], priority:1, topics:['Health'], locationIds:['gym'], pinned:true, breakable:true, durationMinutes:15},
        {hid:'limit-overdue', name:'Plan coffee', type:'reduce', target:1, planByDate:day(-2), lastLog:today, logs:[today], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:10},
        {hid:'stop', name:'Soda', type:'zero', lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false},
        {hid:'event-today', name:'Standup', type:'keepup', appointment:{repeat:'once', startDate:dateKey(today), until:'', weekdays:[], ordinalWeekdays:[], startMinute:9*60, exceptions:{}}, durationMinutes:30, priority:2, topics:['Work'], locationIds:[], logs:[], lastLog:null, pinned:false}
      ]);
      clearHomeFilters();
      render();
      const byName = name => load().find(h=>h.name === name);
      const status = name => itemFilterStatus(byName(name));
      const kind = name => itemFilterKind(byName(name));
      return {
        status:{
          pay:status('Pay bill'), old:status('Old bill'), ancient:status('Ancient bill'),
          note:status('Write note'), bank:status('Call bank'), license:status('Renew license'), flight:status('Book flight'),
          piano:status('Learn piano'), someday:status('Someday idea'), meditate:status('Meditate'),
          rope:status('Skip rope'), garden:status('Plan garden'),
          vitamins:status('Vitamins'), plants:status('Water plants'), stretch:status('Stretch'), coffee:status('Plan coffee'),
          soda:status('Soda'), standup:status('Standup')
        },
        due:{
          note:itemDueInDays(byName('Write note')),
          bank:itemDueInDays(byName('Call bank')),
          license:itemDueInDays(byName('Renew license')),
          flight:itemDueInDays(byName('Book flight')),
          piano:itemDueInDays(byName('Learn piano')),
          pay:itemDueInDays(byName('Pay bill')),
          vitamins:itemDueInDays(byName('Vitamins')),
          plants:itemDueInDays(byName('Water plants')),
          stretch:itemDueInDays(byName('Stretch')),
          standup:itemDueInDays(byName('Standup'))
        },
        days:{
          pay:itemOverdueDays(byName('Pay bill')),
          old:itemOverdueDays(byName('Old bill')),
          ancient:itemOverdueDays(byName('Ancient bill')),
          meditate:itemOverdueDays(byName('Meditate')),
          rope:itemOverdueDays(byName('Skip rope')),
          garden:itemOverdueDays(byName('Plan garden')),
          coffee:itemOverdueDays(byName('Plan coffee')),
          stretch:itemOverdueDays(byName('Stretch')),
          standup:itemOverdueDays(byName('Standup'))
        },
        kind:{
          meditate:kind('Meditate'), coffee:kind('Plan coffee'), soda:kind('Soda'),
          pay:kind('Pay bill'), standup:kind('Standup'), note:kind('Write note')
        },
        priority:{
          pay:itemFilterPriority(byName('Pay bill')),
          stretch:itemFilterPriority(byName('Stretch')),
          flight:itemFilterPriority(byName('Book flight')),
          note:itemFilterPriority(byName('Write note'))
        },
        standup:byName('Standup') && byName('Standup').appointment
      };
    });
    assert.deepEqual(classified.status, {
      pay:'overdue', old:'overdue', ancient:'overdue', note:'today', bank:'soon', license:'soon', flight:'soon', piano:'later', someday:'later',
      meditate:'overdue', rope:'overdue', garden:'overdue', vitamins:'today', plants:'soon', stretch:'later', coffee:'overdue',
      soda:'later', standup:'today'
    }, JSON.stringify(classified));
    assert.deepEqual(classified.due, {
      note:0, bank:1, license:2, flight:3, piano:20, pay:null,
      vitamins:0, plants:1, stretch:7, standup:0
    });
    assert.equal(classified.days.pay, 1);
    assert.ok(classified.days.old >= 7 && classified.days.old < 30, `old ${classified.days.old}`);
    assert.ok(classified.days.ancient >= 30, `ancient ${classified.days.ancient}`);
    assert.equal(classified.days.meditate, 2);
    assert.ok(classified.days.rope >= 7 && classified.days.rope < 30, `rope ${classified.days.rope}`);
    assert.ok(classified.days.garden >= 30, `garden ${classified.days.garden}`);
    assert.equal(classified.days.coffee, 2);
    assert.equal(classified.days.stretch, 0);
    assert.equal(classified.days.standup, 0);
    assert.deepEqual(classified.kind, {
      meditate:'habit', coffee:'limit', soda:'stop', pay:'task', standup:'event', note:'task'
    });
    assert.deepEqual(classified.priority, {pay:'p0', stretch:'p1', flight:'p4', note:'p2'});
    assert.ok(classified.standup, 'standup kept its appointment');

    const names = ()=>page.evaluate(()=>{
      const data = load();
      return filteredVisibleIndices(data).map(i=>data[i].name).sort();
    });
    await page.waitForSelector('[data-open-home-filters]', {timeout:8000});
    await page.locator('[data-open-home-filters]').click();
    await page.waitForSelector('#home-filter-sheet.open');

    // Full-page sheet geometry on phone: fills viewport edge-to-edge with no border-radius.
    const fullPageGeom = await page.evaluate(()=>{
      const sheet = document.querySelector('#home-filter-sheet .home-filter-sheet');
      const r = sheet.getBoundingClientRect();
      return {
        top: r.top, left: r.left, width: r.width, height: r.height,
        vw: window.innerWidth, vh: window.innerHeight,
        radius: getComputedStyle(sheet).borderRadius,
        resetDisabled: document.getElementById('home-filter-reset').disabled,
        doneText: document.getElementById('home-filter-done').textContent.trim()
      };
    });
    assert.ok(fullPageGeom.width >= fullPageGeom.vw - 2 && fullPageGeom.height >= fullPageGeom.vh - 2, `filter sheet should be full-page on phone: ${JSON.stringify(fullPageGeom)}`);
    assert.equal(fullPageGeom.radius, '0px', 'full-page filter sheet has square corners');
    assert.equal(fullPageGeom.resetDisabled, true, 'Reset is disabled when no filters are active');
    assert.match(fullPageGeom.doneText, /Show all \(18\)/, `live total on primary button: ${fullPageGeom.doneText}`);

    const groupOrder = await page.locator('#home-filter-groups .home-filter-group-head > span').allTextContents();
    assert.deepEqual(groupOrder, ['When','Type','Priority','Place','Topic','Length','Details'], groupOrder.join(' > '));
    const whenLabels = await page.locator('#home-filter-groups [data-home-when] b').allTextContents();
    assert.deepEqual(whenLabels, ['Any time','Overdue','Due today','Today or tomorrow','Next 7 days','7+ days overdue','30+ days overdue','Coming up','Not due yet','No deadline']);

    // All 6 real priorities (P0-P5) always show in Priority, even if a priority has 0 items.
    const priorityLabels = await page.locator('#home-filter-groups [data-home-priority] b').allTextContents();
    assert.deepEqual(priorityLabels, ['Any priority','P0 · Critical','P1 · High','P2 · Normal','P3 · Flexible','P4 · Low','P5 · Someday']);

    // Multi-select within Priority: pick P0 + P1 together (OR within group).
    await page.locator('#home-filter-groups [data-home-priority="p0"]').click();
    assert.deepEqual(await names(), ['Pay bill']);
    await page.locator('#home-filter-groups [data-home-priority="p1"]').click();
    assert.deepEqual(await names(), ['Pay bill','Stretch']);
    assert.deepEqual(await page.evaluate(()=>homePriorityFilter), ['p0','p1']);
    assert.equal((await page.locator('#home-filter-done').textContent()).trim(), 'Show 2 items');
    assert.equal(await page.locator('#home-filter-active [data-sheet-clear-home-priority]').count(), 2, 'pinned active strip shows both selected priorities');
    // Tapping an already-selected priority toggles just that one off.
    await page.locator('#home-filter-groups [data-home-priority="p0"]').click();
    assert.deepEqual(await names(), ['Stretch']);
    assert.equal(await page.evaluate(()=>homePriorityFilter), 'p1');
    await page.locator('#home-filter-groups [data-home-priority="all"]').click();
    assert.equal(await page.evaluate(()=>homePriorityFilter), 'all');

    // Multi-select within Topics (2 topics simultaneously) + stable order + individual chip removal.
    const topicsBefore = await page.locator('#home-filter-groups [data-home-topic] b').allTextContents();
    await page.locator('#home-filter-groups [data-home-topic="Work"]').click();
    await page.locator('#home-filter-groups [data-home-topic="Health"]').click();
    const topicsAfter = await page.locator('#home-filter-groups [data-home-topic] b').allTextContents();
    assert.deepEqual(topicsAfter, topicsBefore, 'tapping topics keeps order stable so multi-select never jumps under the finger');
    assert.deepEqual(await page.evaluate(()=>homeTopicFilter), ['Work','Health']);
    assert.deepEqual(await names(), ['Meditate','Old bill','Skip rope','Standup','Stretch','Vitamins','Write note']);
    // Removing one topic chip from the pinned active bar keeps the other topic active.
    await page.locator('#home-filter-active [data-sheet-clear-home-topic="Work"]').click();
    assert.equal(await page.evaluate(()=>homeTopicFilter), 'Health');
    assert.deepEqual(await names(), ['Meditate','Skip rope','Stretch','Vitamins']);
    // Per-group Clear button resets just that group.
    await page.locator('#home-filter-groups [data-clear-home-group="topic"]').click();
    assert.equal(await page.evaluate(()=>homeTopicFilter), 'all');

    // Multi-select within Places (Desk + Gym).
    await page.locator('#home-filter-groups [data-home-location="desk"]').click();
    await page.locator('#home-filter-groups [data-home-location="gym"]').click();
    assert.deepEqual(await names(), ['Pay bill','Skip rope','Stretch']);
    await page.locator('#home-filter-reset').click();

    // Filter search narrows visible groups/options and clears cleanly.
    await page.locator('#home-filter-search').fill('someday');
    const searchVisiblePrios = await page.locator('#home-filter-groups [data-home-priority] b').allTextContents();
    assert.deepEqual(searchVisiblePrios, ['P5 · Someday']);
    await page.locator('#home-filter-search-clear').click();
    assert.equal(await page.locator('#home-filter-groups [data-home-priority]').count(), 7);

    // Duration & Details filters work and combine cleanly.
    await page.locator('#home-filter-groups [data-home-duration="long"]').click();
    assert.deepEqual(await names(), ['Renew license']);
    await page.locator('#home-filter-groups [data-home-duration="all"]').click();
    await page.locator('#home-filter-groups [data-home-trait="pinned"]').click();
    assert.deepEqual(await names(), ['Stretch']);
    await page.locator('#home-filter-reset').click();

    // Cross-group combination + When slices.
    await page.locator('#home-filter-groups [data-home-when="overdue"]').click();
    assert.deepEqual(await names(), ['Ancient bill','Meditate','Old bill','Pay bill','Plan coffee','Plan garden','Skip rope']);
    const habitCount = (await page.locator('#home-filter-groups [data-home-type="habit"] small').textContent()).trim();
    assert.equal(habitCount, '3 items', 'habit count respects the overdue filter');
    await page.locator('#home-filter-groups [data-home-type="habit"]').click();
    assert.deepEqual(await names(), ['Meditate','Plan garden','Skip rope']);
    assert.equal(await page.locator('#home-tag-filter [data-clear-home-when]').count(), 1);
    assert.equal(await page.locator('#home-tag-filter [data-clear-home-type]').count(), 1);
    const chipFit = await page.evaluate(()=>{
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      return [...document.querySelectorAll('#home-tag-filter .home-active-filter')].map(button=>{
        const rect = button.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= bar.right + 1 && rect.bottom <= bar.bottom + 1;
      });
    });
    assert.deepEqual(chipFit, [true, true], 'active filters stay inside the header');
    await page.locator('#home-filter-reset').click();
    assert.deepEqual(await page.evaluate(()=>[homeWhenFilter, homeTypeFilter, homePriorityFilter, homeLocationFilter, homeTopicFilter, homeDurationFilter, homeTraitFilter]),
      ['all','all','all','all','all','all','all']);
    await page.locator('#home-filter-groups [data-home-when="soon"]').click();
    assert.deepEqual(await names(), ['Book flight','Call bank','Renew license','Water plants']);
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="soon48"]').click();
    assert.deepEqual(await names(), ['Call bank','Standup','Vitamins','Water plants','Write note']);
    assert.equal((await page.locator('#home-tag-filter [data-clear-home-when] span').textContent()).trim(), 'Today or tomorrow');
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="soon7"]').click();
    assert.deepEqual(await names(), ['Book flight','Call bank','Renew license','Standup','Stretch','Vitamins','Water plants','Write note']);
    assert.equal((await page.locator('#home-tag-filter [data-clear-home-when] span').textContent()).trim(), 'Next 7 days');
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="overdue7"]').click();
    assert.deepEqual(await names(), ['Ancient bill','Old bill','Plan garden','Skip rope']);
    assert.equal((await page.locator('#home-tag-filter [data-clear-home-when] span').textContent()).trim(), '7+ days overdue');
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="overdue30"]').click();
    assert.deepEqual(await names(), ['Ancient bill','Plan garden']);
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="overdue"]').click();
    await page.locator('#home-filter-groups [data-home-type="stop"]').click();
    assert.deepEqual(await names(), []);
    assert.equal((await page.locator('#home-filter-done').textContent()).trim(), 'No matching items');
    await page.locator('#home-filter-done').click();
    await page.waitForFunction(()=>{
      const empty = document.getElementById('empty');
      return empty && /nothing matches/i.test(empty.innerText) && /overdue/i.test(empty.innerText) && /stop/i.test(empty.innerText);
    }, {timeout:8000});
    await page.locator('#empty').click();
    assert.deepEqual(await page.evaluate(()=>[homeWhenFilter, homeTypeFilter]), ['all','all']);
    assert.ok((await names()).length > 1, 'clearing the empty state restores the list');

    // Calendar filter sheet: full-page, multi-select, shared sync with Home.
    await page.locator('#open-overview').click();
    await page.waitForSelector('#overview-sheet.open');
    await page.locator('#overview-filter [data-open-overview-filters]').click();
    await page.waitForSelector('#calendar-filter-sheet.open');
    const calFullPage = await page.evaluate(()=>{
      const sheet = document.querySelector('#calendar-filter-sheet .home-filter-sheet');
      const r = sheet.getBoundingClientRect();
      return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
    });
    assert.ok(calFullPage, 'calendar filter sheet is also full-page on phone');
    const calendarGroups = await page.locator('#calendar-filter-groups .home-filter-group-head > span').allTextContents();
    assert.ok(calendarGroups.indexOf('When') !== -1 && calendarGroups.indexOf('When') < calendarGroups.indexOf('Type'), calendarGroups.join(' > '));
    assert.ok(calendarGroups.indexOf('Place') !== -1 && calendarGroups.indexOf('Topic') === calendarGroups.indexOf('Place') + 1);
    assert.equal(await page.locator('#calendar-filter-groups [data-overview-priority]').count(), 7, 'calendar shows all 6 priorities + Any');
    await page.locator('#calendar-filter-groups [data-overview-when="today"]').click();
    assert.equal(await page.evaluate(()=>overviewWhenFilter), 'today');
    await page.locator('#calendar-filter-groups [data-overview-when="overdue30"]').click();
    assert.deepEqual(await page.evaluate(()=>overviewWhenFilter), ['today','overdue30'], 'calendar supports multi-select within When');
    assert.deepEqual(await page.evaluate(()=>load().filter(h=>matchesOverviewFilters(h)).map(h=>h.name).sort()), ['Ancient bill','Plan garden','Standup','Vitamins','Write note']);
    await page.locator('#calendar-filter-reset').click();
    assert.deepEqual(await page.evaluate(()=>[overviewWhenFilter, overviewTypeFilter, overviewPriorityFilter, overviewLocationFilter, overviewTopicFilter, overviewDurationFilter, overviewTraitFilter]),
      ['all','all','all','all','all','all','all']);
    const place = page.locator('#calendar-filter-groups [data-overview-location="desk"]');
    await place.click();
    assert.equal(await place.getAttribute('aria-pressed'),'true');
    assert.deepEqual(await page.evaluate(()=>[homeLocationFilter,overviewLocationFilter]),['desk','desk']);
    await page.evaluate(()=>{
      save(load().filter(h=>h.hid !== 'overdue-task'));
      renderOverview();
    });
    assert.deepEqual(await page.evaluate(()=>[homeLocationFilter,overviewLocationFilter]),['all','all'],'removing the final item at a place clears its filter');
    await page.locator('#calendar-filter-groups [data-overview-type="task"]').click();
    await page.locator('#calendar-filter-done').click();
    await page.locator('#overview-head-close').click();
    await page.evaluate(()=>setMinimalMode(true));
    assert.deepEqual(await page.evaluate(()=>[homeTypeFilter,overviewTypeFilter]),['all','all']);
    assert.ok((await names()).length > 1,'enabling Minimal Mode clears filters before hiding their controls');
    assert.deepEqual(errors, []);
    console.log('PASS home filter dimensions, all priorities, multi-select, search, and full-page UI');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
