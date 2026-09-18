// Reliability suite for every draft_item setting: parsers, apply+commit,
// clear/none, invalid no-clobber, combined windows, and round-trips.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

const FROZEN = Date.parse('2026-09-17T13:24:00'); // Thursday

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

function report(rows, prefix){
  for(const row of rows || []){
    const extra = row.extra == null ? '' : ' (' + JSON.stringify(row.extra) + ')';
    assert(row.ok, (prefix ? prefix + ' ' : '') + row.name + extra);
  }
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

  console.log('\n[P] parsers');
  const parsers = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    check('bool true/yes/on', assistantParseBool('yes') === true && assistantParseBool('on') === true);
    check('bool false/off', assistantParseBool('no') === false && assistantParseBool('off') === false);
    check('bool garbage', assistantParseBool('maybe') == null);
    check('habitKind build/limit/stop', assistantParseHabitKind('build') === 'keepup' && assistantParseHabitKind('limit') === 'reduce' && assistantParseHabitKind('stop') === 'zero');
    check('habitKind garbage', assistantParseHabitKind('chore') == null);
    check('month days 1, 15', JSON.stringify(assistantParseMonthDays('1, 15')) === JSON.stringify([1,15]));
    check('month days the 1st', JSON.stringify(assistantParseMonthDays('the 1st')) === JSON.stringify([1]));
    check('month days any', JSON.stringify(assistantParseMonthDays('any')) === JSON.stringify([]));
    check('month days garbage', assistantParseMonthDays('asdf') == null);
    check('topics csv', JSON.stringify(assistantParseTopicsArg('health, fitness')) === JSON.stringify(['health','fitness']));
    check('topics none', JSON.stringify(assistantParseTopicsArg('none')) === JSON.stringify([]));
    check('emoji color amber/none/garbage', assistantParseEmojiColor('amber') === 'amber' && assistantParseEmojiColor('none') === '' && assistantParseEmojiColor('chartreuse') == null);
    check('emoji none', assistantParseEmoji('none') === '');
    check('breakable split 20', JSON.stringify(assistantParseBreakable('split into 20 minutes')) === JSON.stringify({breakable:true, minChunkMinutes:20}));
    check('breakable one session', JSON.stringify(assistantParseBreakable('one session')) === JSON.stringify({breakable:false}));
    check('auto-mark manual', assistantParseAutoMark('manual') === null);
    check('flex none', assistantParseFlexDays('none') === 0);
    check('flex 3', assistantParseFlexDays(3) === 3);
    const snooze2h = assistantParseSnoozeUntil('2 hours', now);
    check('snooze 2 hours', snooze2h === now + 2 * 3600000, snooze2h);
    check('snooze off', assistantParseSnoozeUntil('off', now) === null);
    const phone = assistantParseLinkText('call 5551234567');
    check('link call', phone && phone.kind === 'phone' && /5551234567/.test(phone.value));
    check('links none', JSON.stringify(assistantParseLinksArg('none')) === JSON.stringify([]));
    check('links garbage', assistantParseLinksArg('javascript:alert(1)') == null);
    const order = assistantParseOrderText('right after Walk, same day');
    check('order direct after same day', order && order.links && order.links[0].direction === 'after' && order.links[0].adjacency === 'direct' && order.links[0].requireSameDay === true && order.links[0].name === 'walk');
    check('order none', assistantParseOrderText('none') && assistantParseOrderText('none').clear === true);
    const prefs = assistantParsePlacePrefsText('Home high, Gym avoid');
    check('place prefs', prefs && prefs[0].name === 'Home' && prefs[0].level === 'high' && prefs[1].name === 'Gym' && prefs[1].level === 'avoid');
    check('priority urgent/someday', assistantParsePriority('urgent') === 0 && assistantParsePriority('someday') === 5);
    check('duration half an hour', assistantParseDuration('half an hour') === 30);
    check('packed name dump', assistantNameLooksLikeSettingsDump('limit kettlebells topics health and fitness'));
    check('packed later-of name', assistantNameLooksLikeSettingsDump('maghrib stroll allowed later of 6pm and sunset until isha'));
    check('short title ok', assistantNameLooksLikeSettingsDump('Kettlebells') !== true && assistantNameLooksLikeSettingsDump('hike habit') !== true);
    check('short title from dump', assistantShortTitleFromDump('limit kettlebells topics health and fitness') === 'kettlebells');
    const laterPeriod = assistantParseWindowFromText('later of 6pm and sunset until isha.');
    check('later-of trailing period', laterPeriod && laterPeriod.end && laterPeriod.end.anchor === 'isha');
    const prefsLoose = assistantParsePlacePrefsLoose('prefer Home high and avoid Gym');
    check('loose place prefs', prefsLoose && prefsLoose[0].name === 'Home' && prefsLoose[0].level === 'high' && prefsLoose[1].name === 'Gym' && prefsLoose[1].level === 'avoid');
    check('prefer Tuesday is not a place', assistantParsePlacePrefsLoose('prefer Tuesday') == null);
    check('preferred window is not a place', assistantParsePlacePrefsLoose('Give Strength a preferred window between 5pm and 7pm') == null);
    const orderLoose = assistantParseOrderFromLooseText('Add Stretch at Home, right after Walk the same day.');
    check('loose order after Walk', orderLoose && orderLoose.links && orderLoose.links[0].name === 'walk' && orderLoose.links[0].requireSameDay === true);
    check('after sunset is not an order', assistantParseOrderFromLooseText('walk after sunset') == null);
    check('day after tomorrow is not an order', assistantParseOrderFromLooseText('meeting for day after tomorrow at 1pm') == null);
    check('firm due day', assistantParseHardDueText('That due day is firm, no late days') === true);
    const locCat = {places:[{id:'home-1', name:'Sample Home'}, {id:'gym-1', name:'Gym'}]};
    const addLoc = assistantParseUtterance('Add the location home.', locCat, now);
    check('add location is edit', addLoc.intent === 'edit_item' && addLoc.itemName == null);
    check('add location matches Sample Home', addLoc.places && addLoc.places[0] === 'Sample Home');
    const salvagedPlace = assistantSalvageDraftArgs({kind:'habit', name:'Study'}, 'Add the location home.');
    check('salvage placeNames from add-location', /home/i.test(String(salvagedPlace.placeNames || '')));
    const salvaged = assistantSalvageDraftArgs({
      kind:'task',
      name:'maghrib stroll allowed later of 6pm and sunset until isha',
      window:{start:{kind:'clock', minutes:1080, clock:'18:00', combine:'later', second:{kind:'anchor', anchor:'maghrib', offsetMin:0}}, end:{kind:'unset'}}
    }, 'Add a 30 minute Maghrib stroll allowed later of 6pm and sunset until isha.');
    check('salvage fills unset window end', salvaged.window && salvaged.window.end && salvaged.window.end.anchor === 'isha');
    return rows;
  }, {now:FROZEN});
  report(parsers);

  console.log('\n[W] window text');
  const windows = await page.evaluate(() => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    const later = assistantParseWindowFromText('later of 6pm and sunset until isha');
    check('later-of start clock', later && later.start && later.start.kind === 'clock' && later.start.minutes === 18 * 60);
    check('later-of combine', later && later.start && later.start.combine === 'later' && later.start.second && later.start.second.anchor === 'maghrib');
    check('later-of end isha', later && later.end && later.end.anchor === 'isha');
    const earlier = assistantParseWindowFromText('earlier of 6pm and sunset until isha');
    check('earlier-of combine', earlier && earlier.start && earlier.start.combine === 'earlier');
    const hyphen = assistantParseWindowFromText('9am-11am');
    check('hyphen am/pm', hyphen && hyphen.start.minutes === 9 * 60 && hyphen.end.minutes === 11 * 60);
    const dash24 = assistantParseWindowFromText('09:00-11:00');
    check('hyphen 24h', dash24 && dash24.start.minutes === 9 * 60 && dash24.end.minutes === 11 * 60);
    const between24 = assistantParseWindowFromText('between 17:00 and 19:00');
    check('between 24h', between24 && between24.start.minutes === 17 * 60 && between24.end.minutes === 19 * 60);
    const none = assistantParseWindowFromText('none');
    check('none clears', none && none.start.kind === 'unset' && none.end.kind === 'unset');
    const sunset = assistantParseWindowFromText('after sunset');
    check('after sunset', sunset && sunset.start.anchor === 'maghrib');
    const studyWin = assistantParseWindowFromText('from 15 min before sunrise to 2 hours after sunrise or 9 AM whichever is earlier');
    check('sunrise-15 start', studyWin && studyWin.start && studyWin.start.anchor === 'sunrise' && studyWin.start.offsetMin === -15);
    check('sunrise+2h earlier-of 9am end', studyWin && studyWin.end && studyWin.end.anchor === 'sunrise' && studyWin.end.offsetMin === 120 && studyWin.end.combine === 'earlier' && studyWin.end.second && studyWin.end.second.minutes === 9 * 60, studyWin && studyWin.end);
    return rows;
  });
  report(windows);

  console.log('\n[F] each setting applies and saves');
  const fields = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});

    function world(){
      localStorage.removeItem(KEY);
      saveSortSettings({
        ...DEFAULT_SORT_SETTINGS,
        localAssistant:true,
        defaultDurationMinutes:30,
        defaultBreakable:false,
        defaultTopics:['inbox'],
        locations:[
          {id:'home-1', name:'Home', lat:51.5, lng:-0.12},
          {id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}
        ],
        weatherProfiles:[{id:'dry-1', name:'Dry'}]
      });
      const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
        {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
        {
          name:'outside exercise', type:'reduce', target:7/3, durationMinutes:30, logs:[], lastLog:null,
          topics:['health'], breakable:true, minChunkMinutes:15, earlyWindowDays:2, delayAllowanceDays:1,
          emoji:'🏃', emojiBgColor:'teal', pinned:true, allowedWeekdays:[2], allowedMonthDays:[10],
          preferredWeekdays:[6], preferredMonthDays:[20], links:[{kind:'link', value:'https://keep.example'}]
        }
      ]);
      save(seed);
      const context = assistantBuildContext(now);
      const found = assistantFindHabit(load(), 'outside exercise');
      const session = assistantCreateSession();
      assistantFocusHabit(session, found, context);
      return {session, context};
    }

    function apply(args){
      const {session, context} = world();
      const tool = assistantExecuteTool('draft_item', args, session, context);
      const commit = tool.ok ? assistantCommitDraft(tool.draft) : {ok:false, error:tool.error};
      const habit = commit.ok ? load()[commit.index] : null;
      return {tool, commit, habit, walk:load().find(item => item && item.name === 'Walk')};
    }

    let r = apply({habitKind:'build'});
    check('habitKind build', r.habit && r.habit.type === 'keepup');
    r = apply({habitKind:'stop'});
    check('habitKind stop', r.habit && r.habit.type === 'zero');
    r = apply({newName:'Strength work'});
    check('newName', r.habit && r.habit.name === 'Strength work');
    r = apply({emoji:'💪', emojiColor:'purple'});
    check('emoji+color', r.habit && r.habit.emoji === '💪' && r.habit.emojiBgColor === 'purple');
    r = apply({durationMinutes:'45 minutes'});
    check('duration 45m', r.habit && r.habit.durationMinutes === 45);
    r = apply({priority:'someday'});
    check('priority someday', r.habit && r.habit.priority === 5);
    r = apply({topics:'wellness'});
    check('topics', r.habit && JSON.stringify(r.habit.topics) === JSON.stringify(['wellness']));
    r = apply({weekdays:'weekdays'});
    check('weekdays', r.habit && JSON.stringify(r.habit.allowedWeekdays) === JSON.stringify([1,2,3,4,5]));
    r = apply({monthDays:'the 1st and the 15th'});
    check('monthDays', r.habit && JSON.stringify(r.habit.allowedMonthDays) === JSON.stringify([1,15]));
    r = apply({preferredWeekdays:'Monday'});
    check('preferredWeekdays', r.habit && JSON.stringify(r.habit.preferredWeekdays) === JSON.stringify([1]));
    r = apply({preferredMonthDays:[1, 15]});
    check('preferredMonthDays', r.habit && JSON.stringify(r.habit.preferredMonthDays) === JSON.stringify([1,15]));
    r = apply({windowText:'between 5pm and 7pm'});
    check('windowText', r.habit && r.habit.allowedTimeStart === 17 * 60 && r.habit.allowedTimeEnd === 19 * 60);
    r = apply({preferredWindowText:'after 8am'});
    check('preferredWindowText', r.habit && r.habit.preferredTimeStart === 8 * 60);
    r = apply({earlyDays:4, delayDays:'none'});
    check('early/delay', r.habit && r.habit.earlyWindowDays === 4 && r.habit.delayAllowanceDays === 0);
    r = apply({breakable:'one session'});
    check('unbreakable', r.habit && r.habit.breakable === false);
    r = apply({minChunkMinutes:25});
    check('min chunk', r.habit && r.habit.minChunkMinutes === 25);
    r = apply({autoMarkMinutes:15});
    check('auto-mark 15', r.habit && r.habit.autoMarkMinutes === 15);
    r = apply({trackValue:'yes'});
    check('track value', r.habit && r.habit.trackValue === true);
    r = apply({pinned:'no'});
    check('unpin', r.habit && r.habit.pinned === false);
    r = apply({showWeather:true, weatherAtPlace:true, weatherPlace:'Gym'});
    check('weather card', r.habit && r.habit.showWeather === true && r.habit.showWeatherAtLocation === true && r.habit.weatherLocationId === 'gym-1');
    r = apply({weatherProfile:'Dry'});
    check('weather profile', r.habit && r.habit.weatherProfileMode === 'profile' && r.habit.weatherProfileId === 'dry-1');
    r = apply({weatherProfile:'Barbecuing', weatherText:'only if it is not raining'});
    const bbq = (loadSortSettings().weatherProfiles || []).find(profile => /barbecu/i.test(profile && profile.name));
    check('unknown weather profile is created', r.habit && bbq && r.habit.weatherProfileId === bbq.id && r.habit.weatherProfileMode === 'profile');
    check('created profile has rain cap', bbq && (bbq.rules || []).some(rule => rule.metric === 'precipitation_probability' && rule.max === 20));
    r = apply({placeNames:'Gym'});
    check('placeNames', r.habit && JSON.stringify(r.habit.locationIds) === JSON.stringify(['gym-1']));
    r = apply({placePrefs:'Home high, Gym avoid'});
    check('placePrefs', r.habit && r.habit.locationPrefs['home-1'] === 'high' && r.habit.locationPrefs['gym-1'] === 'avoid');
    r = apply({placeNames:'Gym', anywhere:true});
    check('place+anywhere', r.habit && JSON.stringify(r.habit.locationIds) === JSON.stringify(['gym-1']) && r.habit.anywhereAllowed === true);
    r = apply({before:'Walk'});
    check('before Walk', r.habit && r.habit.scheduleLinks && r.habit.scheduleLinks[0] && r.habit.scheduleLinks[0].direction === 'before' && r.habit.scheduleLinks[0].anchorHid === r.walk.hid);
    r = apply({order:'right after Walk, same day'});
    check('order link', r.habit && r.habit.scheduleLinks[0].direction === 'after' && r.habit.scheduleLinks[0].adjacency === 'direct' && r.habit.scheduleLinks[0].requireSameDay === true);
    r = apply({links:'https://example.com/a'});
    check('url link', r.habit && r.habit.links && r.habit.links[0] && /example\.com\/a/.test(r.habit.links[0].value));
    r = apply({links:'call 5551234567'});
    check('phone link', r.habit && r.habit.links && r.habit.links[0] && r.habit.links[0].kind === 'phone' && r.habit.links[0].value === '5551234567');
    r = apply({option:'Tue 09:00-11:00 at Gym'});
    check('option 24h dash', r.habit && r.habit.scheduleOptions && r.habit.scheduleOptions[0] && r.habit.scheduleOptions[0].locationId === 'gym-1' && r.habit.scheduleOptions[0].start === 9 * 60 && JSON.stringify(r.habit.scheduleOptions[0].weekdays) === JSON.stringify([2]));
    r = apply({planBy:'tomorrow'});
    const tomorrow = typeof dayStart === 'function' ? dayStart(now) + 86400000 : now + 86400000;
    check('planBy tomorrow', r.habit && r.habit.planByDate === tomorrow, r.habit && r.habit.planByDate);

    const {session, context} = world();
    const task = assistantExecuteTool('draft_item', {
      kind:'task', name:'File taxes', due:'tomorrow', dueTime:'7pm', hardDue:'yes',
      snooze:'2 hours', sharedDisplay:'no', sharedComplete:false
    }, assistantCreateSession(), context);
    const taskCommit = task.ok ? assistantCommitDraft(task.draft) : {ok:false};
    const taskHabit = taskCommit.ok ? load()[taskCommit.index] : null;
    check('task due+time', taskHabit && taskHabit.type === 'task' && taskHabit.hardDue === true && taskHabit.delayAllowanceDays === 0);
    check('task snooze', taskHabit && taskHabit.snoozedUntil === now + 2 * 3600000, taskHabit && taskHabit.snoozedUntil);
    check('task shared off', taskHabit && taskHabit.showOnSharedDisplay === false && taskHabit.allowSharedDisplayCompletion === false);
    const event = taskHabit && taskHabit.eventTime != null ? new Date(taskHabit.eventTime) : null;
    check('task dueTime 19:00', event && event.getHours() === 19 && event.getMinutes() === 0);

    const keys = Object.keys(ASSISTANT_TOOL_DEFS.draft_item.parameters.properties);
    const needed = ['habitKind','newName','emoji','emojiColor','topics','monthDays','preferredWeekdays','preferredMonthDays','hardDue','planBy','preferredWindowText','earlyDays','delayDays','breakable','minChunkMinutes','autoMarkMinutes','trackValue','pinned','snooze','sharedDisplay','sharedComplete','showWeather','weatherAtPlace','weatherPlace','placePrefs','before','after','order','links','option','anywhere','weatherText','windowText'];
    const missing = needed.filter(key => !keys.includes(key));
    check('schema covers settings', missing.length === 0, missing);
    r = apply({name:'limit kettlebells topics health and fitness', durationMinutes:45});
    check('packed name shortened', r.habit && /kettlebell/i.test(r.habit.name) && !/topics/i.test(r.habit.name));
    return rows;
  }, {now:FROZEN});
  report(fields);

  console.log('\n[C] none/clear restores defaults');
  const clears = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home', lat:51.5, lng:-0.12},{id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
      {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
      {
        name:'outside exercise', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null,
        emoji:'🏃', emojiBgColor:'teal', topics:['health'], allowedWeekdays:[2], allowedMonthDays:[10],
        preferredWeekdays:[6], preferredMonthDays:[20], allowedTimeStart:17*60, allowedTimeEnd:19*60,
        preferredTimeStart:8*60, preferredTimeEnd:10*60, links:[{kind:'link', value:'https://keep.example'}],
        scheduleOptions:[{weekdays:[2], start:9*60, end:11*60, locationId:'gym-1', sameDayMode:'alternative', weatherProfileMode:'inherit', weatherProfileId:null}],
        weatherLocationId:'home-1', showWeather:true, pinned:true, snoozedUntil:now+3600000
      }
    ]);
    const walkHid = seed.find(item => item.name === 'Walk').hid;
    const exercise = seed.find(item => item.name === 'outside exercise');
    exercise.scheduleLinks = [{anchorHid:walkHid, direction:'after', adjacency:'direct', requireSameDay:true}];
    save(seed);
    const context = assistantBuildContext(now);
    const found = assistantFindHabit(load(), 'outside exercise');
    const session = assistantCreateSession();
    assistantFocusHabit(session, found, context);
    const tool = assistantExecuteTool('draft_item', {
      emoji:'none',
      emojiColor:'none',
      topics:'none',
      weekdays:'any',
      monthDays:'any',
      preferredWeekdays:'none',
      preferredMonthDays:'none',
      windowText:'none',
      preferredWindowText:'none',
      links:'none',
      option:'none',
      order:'none',
      weatherPlace:'none',
      snooze:'off'
    }, session, context);
    const commit = tool.ok ? assistantCommitDraft(tool.draft) : {ok:false, error:tool.error};
    const habit = commit.ok ? load()[commit.index] : null;
    check('tool ok', tool.ok && commit.ok, tool.error || commit.error);
    check('emoji cleared', habit && habit.emoji === '' && habit.emojiBgColor === '');
    check('topics cleared', habit && Array.isArray(habit.topics) && habit.topics.length === 0);
    check('weekdays any', habit && Array.isArray(habit.allowedWeekdays) && habit.allowedWeekdays.length === 0);
    check('month days any', habit && Array.isArray(habit.allowedMonthDays) && habit.allowedMonthDays.length === 0);
    check('pref days cleared', habit && habit.preferredWeekdays.length === 0 && habit.preferredMonthDays.length === 0);
    check('windows cleared', habit && habit.allowedTimeStart == null && habit.allowedTimeEnd == null && habit.preferredTimeStart == null);
    check('links cleared', habit && Array.isArray(habit.links) && habit.links.length === 0);
    check('options cleared', habit && Array.isArray(habit.scheduleOptions) && habit.scheduleOptions.length === 0);
    check('order cleared', habit && Array.isArray(habit.scheduleLinks) && habit.scheduleLinks.length === 0);
    check('weather place cleared', habit && !habit.weatherLocationId);
    check('snooze cleared', habit && (habit.snoozedUntil == null));
    return rows;
  }, {now:FROZEN});
  report(clears);

  console.log('\n[X] invalid values do not clobber');
  const clobber = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home', lat:51.5, lng:-0.12},{id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
      {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
      {
        name:'outside exercise', type:'reduce', target:7/3, durationMinutes:30, logs:[], lastLog:null,
        topics:['health'], emoji:'🏃', emojiBgColor:'teal', pinned:true, allowedWeekdays:[2],
        preferredWeekdays:[6], preferredMonthDays:[20], allowedMonthDays:[10],
        links:[{kind:'link', value:'https://keep.example'}],
        scheduleOptions:[{weekdays:[2], start:9*60, end:11*60, locationId:'gym-1', sameDayMode:'alternative', weatherProfileMode:'inherit', weatherProfileId:null}]
      }
    ]);
    save(seed);
    const context = assistantBuildContext(now);
    const found = assistantFindHabit(load(), 'outside exercise');
    const session = assistantCreateSession();
    assistantFocusHabit(session, found, context);
    const before = load().find(item => item.name === 'outside exercise');
    const tool = assistantExecuteTool('draft_item', {
      habitKind:'chore',
      preferredWeekdays:'asdf',
      preferredMonthDays:'nope',
      links:'javascript:alert(1)',
      option:['totally garbage'],
      emojiColor:'chartreuse'
    }, session, context);
    const commit = tool.ok ? assistantCommitDraft(tool.draft) : {ok:false, error:tool.error};
    const habit = commit.ok ? load()[commit.index] : null;
    check('invalid call still previews', tool.ok && commit.ok, tool.error || commit.error);
    check('type stays reduce', habit && habit.type === 'reduce');
    check('pref weekdays stay Sat', habit && JSON.stringify(habit.preferredWeekdays) === JSON.stringify([6]));
    check('pref month days stay 20', habit && JSON.stringify(habit.preferredMonthDays) === JSON.stringify([20]));
    check('links stay', habit && habit.links && /keep\.example/.test(habit.links[0].value));
    check('options stay', habit && habit.scheduleOptions && habit.scheduleOptions[0] && habit.scheduleOptions[0].locationId === 'gym-1');
    check('emoji color stays teal', habit && habit.emojiBgColor === 'teal');
    check('topics stay', habit && JSON.stringify(habit.topics) === JSON.stringify(['health']));
    const badPlace = assistantExecuteTool('draft_item', {weatherPlace:'Mars'}, session, {
      ...assistantBuildContext(now),
      data:load(),
      catalog:assistantCatalog(load(), loadSortSettings(), now)
    });
    check('unknown place asks', badPlace.ok === false && /place/i.test(String(badPlace.ask || badPlace.error || '')));
    const afterFail = load().find(item => item.name === 'outside exercise');
    check('failed place does not save', afterFail && afterFail.weatherLocationId == null);
    const invented = assistantApplyDraftItem({
      kind:'habit',
      name:'Weekly Barbecue',
      durationMinutes:120,
      rhythm:'weekly',
      placeNames:['backyard', 'rooftop']
    }, assistantEmptyDraft(), assistantCatalog([], loadSortSettings(), now), now, loadSortSettings(), []);
    check('unknown placeNames keep the draft', invented.ok && invented.ask && invented.draft && invented.draft.name === 'Weekly Barbecue' && invented.draft.durationMinutes === 120);
    check('unknown placeNames stay off the draft', !invented.draft.places || !invented.draft.places.ids || !invented.draft.places.ids.length);
    const mapped = assistantApplyPlace(
      {kind:'habit', name:'Weekly Barbecue'},
      {names:['home', "mom's house"]},
      {places:[
        {id:'home-1', name:'Sample Home'},
        {id:'mom-1', name:"Sample Mom's house"}
      ]}
    );
    check('catalog match maps home and mom\'s house', mapped.ok && mapped.draft.places.ids.join(',') === 'home-1,mom-1');
    const badPartner = assistantExecuteTool('draft_item', {after:'Missing Partner'}, session, assistantBuildContext(now));
    check('unknown partner asks', badPartner.ok === false && /list|see/i.test(String(badPartner.ask || badPartner.error || '')));
    void before;
    return rows;
  }, {now:FROZEN});
  report(clobber);

  console.log('\n[L] later-of window persists and round-trips');
  const later = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home', lat:51.5, lng:-0.12}],
      weatherProfiles:[]
    });
    const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
      {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
      {name:'outside exercise', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null}
    ]);
    save(seed);
    const context = assistantBuildContext(now);
    const found = assistantFindHabit(load(), 'outside exercise');
    const session = assistantCreateSession();
    assistantFocusHabit(session, found, context);
    const tool = assistantExecuteTool('draft_item', {windowText:'later of 6pm and sunset until isha'}, session, context);
    const commit = tool.ok ? assistantCommitDraft(tool.draft) : {ok:false, error:tool.error};
    const habit = commit.ok ? load()[commit.index] : null;
    check('saved start clock', habit && habit.allowedTimeStart === 18 * 60);
    check('saved combine later', habit && habit.allowedTimeStartCombine === 'later');
    check('saved second maghrib', habit && habit.allowedTimeStartAnchor2 === 'maghrib');
    check('saved end isha', habit && habit.allowedTimeEndAnchor === 'isha');
    const draft = assistantHabitToDraft(habit, commit.index, loadSortSettings(), load());
    check('draft combine', draft.window && draft.window.start && draft.window.start.combine === 'later' && draft.window.start.second && draft.window.start.second.anchor === 'maghrib');
    const again = assistantCommitDraft(draft);
    const round = again.ok ? load()[again.index] : null;
    check('round-trip combine', round && round.allowedTimeStart === 18 * 60 && round.allowedTimeStartCombine === 'later' && round.allowedTimeStartAnchor2 === 'maghrib' && round.allowedTimeEndAnchor === 'isha');

    const nestedSession = assistantCreateSession();
    assistantFocusHabit(nestedSession, assistantFindHabit(load(), 'outside exercise'), assistantBuildContext(now));
    const nested = assistantExecuteTool('draft_item', {
      window:{
        start:{kind:'clock', clock:'18:00', combine:'later', anchor2:'sunset'},
        end:{kind:'anchor', anchor:'isha'}
      }
    }, nestedSession, assistantBuildContext(now));
    const nestedCommit = nested.ok ? assistantCommitDraft(nested.draft) : {ok:false};
    const nestedHabit = nestedCommit.ok ? load()[nestedCommit.index] : null;
    check('nested clock2/anchor2', nestedHabit && nestedHabit.allowedTimeStartCombine === 'later' && nestedHabit.allowedTimeStartAnchor2 === 'maghrib');

    const habitWin = assistantExecuteTool('draft_item', {
      window:{start:{kind:'habit', habit:'Walk', offsetMin:15}, end:{kind:'unset'}}
    }, nestedSession, assistantBuildContext(now));
    const habitCommit = habitWin.ok ? assistantCommitDraft(habitWin.draft) : {ok:false, error:habitWin.error};
    const habitHabit = habitCommit.ok ? load()[habitCommit.index] : null;
    const walk = load().find(item => item.name === 'Walk');
    check('habit-anchored window', habitWin.ok && habitHabit && habitHabit.allowedTimeStartAnchor === 'habit' && habitHabit.allowedTimeStartOffsetMin === 15 && habitHabit.allowedTimeStartAnchorHabitId === (walk && walk.hid));
    const zeroSession = assistantCreateSession();
    assistantFocusHabit(zeroSession, assistantFindHabit(load(), 'outside exercise'), assistantBuildContext(now));
    const zeroWin = assistantExecuteTool('draft_item', {
      window:{start:{kind:'habit', habit:'Walk'}, end:{kind:'unset'}}
    }, zeroSession, assistantBuildContext(now));
    const zeroCommit = zeroWin.ok ? assistantCommitDraft(zeroWin.draft) : {ok:false};
    const zeroHabit = zeroCommit.ok ? load()[zeroCommit.index] : null;
    const afterWalk = zeroHabit && Array.isArray(zeroHabit.scheduleLinks) && zeroHabit.scheduleLinks.some(link => link.direction === 'after' && link.anchorHid === (walk && walk.hid));
    check('zero-offset habit start becomes after-order', afterWalk);
    const missing = assistantExecuteTool('draft_item', {
      window:{start:{kind:'habit', habit:'No Such Thing'}, end:{kind:'unset'}}
    }, nestedSession, assistantBuildContext(now));
    check('unknown habit anchor asks', missing.ok === false);
    return rows;
  }, {now:FROZEN});
  report(later);

  console.log('\n[S] salvage omitted LLM fields');
  const salvage = await page.evaluate(({now}) => {
    const rows = [];
    const check = (name, cond, extra) => rows.push({name, ok:Boolean(cond), extra});
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[
        {id:'home-1', name:'Home', lat:51.5, lng:-0.12},
        {id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}
      ],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
      {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
      {name:'Strength', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null}
    ]);
    save(seed);
    const context = assistantBuildContext(now);
    function run(args, request){
      const session = assistantCreateSession();
      session.parsed = {text:request || '', factsTrusted:false, intent:'create_task'};
      return assistantExecuteTool('draft_item', args, session, context);
    }
    const later = run({
      kind:'task',
      name:'maghrib stroll allowed later of 6pm and sunset until isha',
      durationMinutes:30,
      window:{
        start:{kind:'clock', minutes:1080, clock:'18:00', combine:'later', second:{kind:'anchor', anchor:'maghrib', offsetMin:0}},
        end:{kind:'unset'}
      }
    }, 'Add a 30 minute Maghrib stroll allowed later of 6pm and sunset until isha.');
    check('later-of end salvaged', later.ok && later.draft && later.draft.window && later.draft.window.end && later.draft.window.end.anchor === 'isha', later.error);
    check('later-of start kept', later.draft && later.draft.window && later.draft.window.start && later.draft.window.start.combine === 'later');
    const taxes = run({
      kind:'task',
      name:'file taxes on that due day is firm no late days priority',
      due:'2026-09-20',
      priority:0
    }, 'Remind me to file taxes on 2026-09-20. That due day is firm, no late days. Priority urgent.');
    check('hard due salvaged', taxes.ok && taxes.draft && taxes.draft.hardDue === true && taxes.draft.delayAllowanceDays === 0, taxes.error);
    const stretch = run({
      kind:'task',
      name:'stretch prefer home high and avoid gym',
      durationMinutes:20,
      place:{names:['Home', 'Gym'], anywhere:false},
      weather:{mode:'profile', profile:'Dry'}
    }, 'Add a 20 minute Stretch at Home, prefer Home high and avoid Gym, using Dry weather, right after Walk the same day.');
    check('place prefs salvaged', stretch.ok && stretch.draft && stretch.draft.locationPrefs && stretch.draft.locationPrefs['home-1'] === 'high' && stretch.draft.locationPrefs['gym-1'] === 'avoid', stretch.error || stretch.ask);
    check('order salvaged', stretch.draft && stretch.draft.scheduleLinks && stretch.draft.scheduleLinks[0] && /walk/i.test(stretch.draft.scheduleLinks[0].name) && stretch.draft.scheduleLinks[0].requireSameDay === true);
    const weekdayPref = run({
      name:'Strength',
      monthDays:['1', '15'],
      preferredWeekdays:['Tuesday']
    }, 'Change Strength so it is only on the 1st and 15th, and prefer Tuesday.');
    check('prefer Tuesday does not ask for a place', weekdayPref.ok && !weekdayPref.ask, weekdayPref.ask);
    const prefWin = run({
      name:'Strength',
      preferredWindowText:'between 5pm and 7pm'
    }, 'Give Strength a preferred window between 5pm and 7pm.');
    check('preferred window does not ask for a place', prefWin.ok && !prefWin.ask, prefWin.ask);
    check('preferred window salvaged', prefWin.draft && prefWin.draft.preferredWindow && prefWin.draft.preferredWindow.start && prefWin.draft.preferredWindow.start.minutes === 17 * 60);
    const snooze = run({
      kind:'task',
      name:'call the bank',
      durationMinutes:120,
      due:'2026-09-17'
    }, 'Remind me to call the bank today, snooze it for 2 hours, and keep it off the shared display.');
    check('snooze salvaged', snooze.ok && snooze.draft && snooze.draft.snoozedUntil === now + 2 * 3600000, snooze.error);
    check('shared display off salvaged', snooze.draft && snooze.draft.showOnSharedDisplay === false);
    check('snooze hours are not duration', snooze.draft && snooze.draft.durationMinutes !== 120);
    const option = run({
      kind:'habit',
      name:'gym visit',
      durationMinutes:30,
      timesPerPeriod:1,
      periodDays:7,
      weekdays:[2],
      window:{start:{kind:'clock', minutes:540, clock:'09:00'}, end:{kind:'clock', minutes:660, clock:'11:00'}},
      place:{names:['Gym'], anywhere:false}
    }, 'Add a 30 minute Gym visit every Tuesday from 9am to 11am at Gym.');
    check('schedule option salvaged', option.ok && option.draft && option.draft.scheduleOptions && option.draft.scheduleOptions[0] && option.draft.scheduleOptions[0].locationId === 'gym-1' && option.draft.scheduleOptions[0].start === 9 * 60, option.error);
    const weatherCard = run({
      name:'Strength',
      placeNames:['Home'],
      showWeather:true,
      weatherAtPlace:true
    }, 'Show the forecast on Strength and use the Home place for that forecast.');
    check('weather place salvaged', weatherCard.ok && weatherCard.draft && weatherCard.draft.weatherLocationId === 'home-1', weatherCard.error || weatherCard.ask);
    const study = run({
      kind:'habit',
      name:'Study',
      durationMinutes:60,
      rhythm:'five times a week',
      window:{start:{kind:'anchor', anchor:'sunrise', offsetMin:-15}, end:{kind:'anchor', anchor:'sunrise', offsetMin:0}}
    }, 'Create a 5 times a week Study habit (1 hour long) which will be from 15 min before sunrise to 2 hours after sunrise or 9 AM whichever is earlier');
    check('study end combine salvaged', study.ok && study.draft && study.draft.window && study.draft.window.end && study.draft.window.end.combine === 'earlier' && study.draft.window.end.second && study.draft.window.end.second.minutes === 9 * 60, study.error);
    check('study start kept', study.draft && study.draft.window && study.draft.window.start && study.draft.window.start.offsetMin === -15);
    check('study rhythm 5×/week', study.draft && study.draft.timesPerPeriod === 5 && study.draft.periodDays === 7);
    return rows;
  }, {now:FROZEN});
  report(salvage);

  console.log('\n[T] stringified tool-call args');
  const toolCall = await page.evaluate(() => {
    const parsed = assistantParseReply({
      message:{
        thinking:'fill',
        tool_calls:[{
          function:{
            name:'draft_item',
            arguments:JSON.stringify({kind:'habit', name:'Swim', rhythm:'every Tuesday', breakable:'split into 20 minutes', windowText:'9am-11am'})
          }
        }]
      }
    });
    const call = parsed.toolCalls[0];
    return {
      name:call && call.name,
      rhythm:call && call.args && call.args.rhythm,
      breakable:call && call.args && call.args.breakable,
      window:call && call.args && call.args.windowText
    };
  });
  assert(toolCall.name === 'draft_item' && toolCall.rhythm === 'every Tuesday', 'JSON string args parse into draft_item');
  assert(toolCall.breakable === 'split into 20 minutes' && toolCall.window === '9am-11am', 'string args keep new setting fields');

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
