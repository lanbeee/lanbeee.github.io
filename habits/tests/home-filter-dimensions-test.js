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
        topics:['Home'],
        locations:[{id:'desk', name:'Desk', lat:40, lng:-73}]
      }));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof save === 'function' && typeof itemFilterStatus === 'function');
    const classified = await page.evaluate(()=>{
      const today = dayStart(Date.now());
      const day = n => today + n * 86400000;
      save([
        {hid:'overdue-task', name:'Pay bill', type:'task', dueDate:day(-1), eventTime:null, lastLog:null, logs:[], priority:0, topics:['Home'], locationIds:['desk'], pinned:false, durationMinutes:20},
        {hid:'week-task', name:'Old bill', type:'task', dueDate:offsetCalendarDay(today, -10), eventTime:null, lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'month-task', name:'Ancient bill', type:'task', dueDate:offsetCalendarDay(today, -40), eventTime:null, lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'today-task', name:'Write note', type:'task', dueDate:today, eventTime:null, lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'soon-task', name:'Book flight', type:'task', dueDate:day(3), eventTime:null, lastLog:null, logs:[], priority:4, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'later-task', name:'Learn piano', type:'task', dueDate:day(20), eventTime:null, lastLog:null, logs:[], priority:5, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'someday', name:'Someday idea', type:'task', dueDate:null, eventTime:null, lastLog:null, logs:[], priority:5, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-overdue', name:'Meditate', type:'keepup', target:1, lastLog:day(-3), logs:[day(-3)], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-week', name:'Skip rope', type:'keepup', target:1, lastLog:offsetCalendarDay(today, -10), logs:[offsetCalendarDay(today, -10)], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:15},
        {hid:'habit-plan', name:'Plan garden', type:'keepup', target:7, lastLog:today, logs:[today], planByDate:offsetCalendarDay(today, -40), priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:20},
        {hid:'habit-today', name:'Vitamins', type:'keepup', target:1, lastLog:day(-1), logs:[day(-1)], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:10},
        {hid:'habit-ok', name:'Stretch', type:'keepup', target:7, lastLog:today, logs:[today], priority:1, topics:[], locationIds:[], pinned:true, durationMinutes:15},
        {hid:'limit-overdue', name:'Plan coffee', type:'reduce', target:1, planByDate:day(-2), lastLog:today, logs:[today], priority:2, topics:[], locationIds:[], pinned:false, durationMinutes:10},
        {hid:'stop', name:'Soda', type:'zero', lastLog:null, logs:[], priority:2, topics:[], locationIds:[], pinned:false},
        {hid:'event-today', name:'Standup', type:'keepup', appointment:{repeat:'once', startDate:dateKey(today), until:'', weekdays:[], ordinalWeekdays:[], startMinute:9*60, exceptions:{}}, durationMinutes:30, priority:2, topics:[], locationIds:[], logs:[], lastLog:null, pinned:false}
      ]);
      clearHomeFilters();
      render();
      const byName = name => load().find(h=>h.name === name);
      const status = name => itemFilterStatus(byName(name));
      const kind = name => itemFilterKind(byName(name));
      return {
        status:{
          pay:status('Pay bill'), old:status('Old bill'), ancient:status('Ancient bill'),
          note:status('Write note'), flight:status('Book flight'),
          piano:status('Learn piano'), someday:status('Someday idea'), meditate:status('Meditate'),
          rope:status('Skip rope'), garden:status('Plan garden'),
          vitamins:status('Vitamins'), stretch:status('Stretch'), coffee:status('Plan coffee'),
          soda:status('Soda'), standup:status('Standup')
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
      pay:'overdue', old:'overdue', ancient:'overdue', note:'today', flight:'soon', piano:'later', someday:'later',
      meditate:'overdue', rope:'overdue', garden:'overdue', vitamins:'today', stretch:'later', coffee:'overdue',
      soda:'later', standup:'today'
    }, JSON.stringify(classified));
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
    assert.deepEqual(classified.priority, {pay:'important', stretch:'important', flight:'wait', note:'normal'});
    assert.ok(classified.standup, 'standup kept its appointment');

    const names = ()=>page.evaluate(()=>{
      const data = load();
      return filteredVisibleIndices(data).map(i=>data[i].name).sort();
    });
    await page.waitForSelector('[data-open-home-filters]', {timeout:8000});
    await page.locator('[data-open-home-filters]').click();
    await page.waitForSelector('#home-filter-sheet.open');
    const groupOrder = await page.locator('#home-filter-groups .home-filter-group-head span').allTextContents();
    assert.deepEqual(groupOrder, ['When','Type','Priority','Place','Topic'], groupOrder.join(' > '));
    const whenLabels = await page.locator('#home-filter-groups [data-home-when] b').allTextContents();
    assert.deepEqual(whenLabels, ['Any time','Overdue','Due today','7+ days overdue','30+ days overdue','Coming up','Not due yet']);
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
    assert.deepEqual(await page.evaluate(()=>[homeWhenFilter, homeTypeFilter, homePriorityFilter, homeLocationFilter, homeTopicFilter]),
      ['all','all','all','all','all']);
    await page.locator('#home-filter-groups [data-home-when="soon"]').click();
    assert.deepEqual(await names(), ['Book flight']);
    await page.locator('#home-filter-groups [data-home-when="all"]').click();
    await page.locator('#home-filter-groups [data-home-priority="important"]').click();
    assert.deepEqual(await names(), ['Pay bill','Stretch']);
    await page.locator('#home-filter-groups [data-home-priority="all"]').click();
    await page.locator('#home-filter-groups [data-home-when="overdue7"]').click();
    assert.deepEqual(await names(), ['Ancient bill','Old bill','Plan garden','Skip rope']);
    assert.equal((await page.locator('#home-tag-filter [data-clear-home-when] span').textContent()).trim(), '7+ days overdue');
    await page.locator('#home-filter-groups [data-home-when="overdue30"]').click();
    assert.deepEqual(await names(), ['Ancient bill','Plan garden']);
    await page.locator('#home-filter-groups [data-home-when="overdue"]').click();
    await page.locator('#home-filter-groups [data-home-type="stop"]').click();
    assert.deepEqual(await names(), []);
    await page.locator('#home-filter-done').click();
    await page.waitForFunction(()=>{
      const empty = document.getElementById('empty');
      return empty && /nothing matches/i.test(empty.innerText) && /overdue/i.test(empty.innerText) && /stop/i.test(empty.innerText);
    }, {timeout:8000});
    await page.locator('#empty').click();
    assert.deepEqual(await page.evaluate(()=>[homeWhenFilter, homeTypeFilter]), ['all','all']);
    assert.ok((await names()).length > 1, 'clearing the empty state restores the list');

    await page.locator('#open-overview').click();
    await page.waitForSelector('#overview-sheet.open');
    await page.locator('#overview-filter [data-open-overview-filters]').click();
    await page.waitForSelector('#calendar-filter-sheet.open');
    const calendarGroups = await page.locator('#calendar-filter-groups .home-filter-group-head span').allTextContents();
    assert.ok(calendarGroups.indexOf('When') !== -1 && calendarGroups.indexOf('When') < calendarGroups.indexOf('Type'), calendarGroups.join(' > '));
    assert.ok(calendarGroups.indexOf('Place') !== -1 && calendarGroups.indexOf('Topic') === calendarGroups.indexOf('Place') + 1);
    await page.locator('#calendar-filter-groups [data-overview-when="today"]').click();
    assert.equal(await page.evaluate(()=>overviewWhenFilter), 'today');
    await page.locator('#calendar-filter-groups [data-overview-when="overdue30"]').click();
    assert.deepEqual(await page.evaluate(()=>load().filter(h=>matchesOverviewFilters(h)).map(h=>h.name).sort()), ['Ancient bill','Plan garden']);
    await page.locator('#calendar-filter-reset').click();
    assert.deepEqual(await page.evaluate(()=>[overviewWhenFilter, overviewTypeFilter, overviewPriorityFilter, overviewLocationFilter, overviewTopicFilter]),
      ['all','all','all','all','all']);
    assert.deepEqual(errors, []);
    console.log('PASS home filter when, type, and priority');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
