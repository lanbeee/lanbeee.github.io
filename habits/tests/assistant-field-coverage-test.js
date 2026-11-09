// Field-by-field language coverage. Live mode uses unmodified pinned Needle WASM.
// Scripted mode selects only intended evidence; it checks host normalization,
// applicability, persistence and recovery, not model language accuracy.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const fs=require('fs');
const day=s=>new Date(`${s}T00:00:00-05:00`).getTime();
const span=(a,b)=>{const out=[];for(let n=a;n<=b;n+=1)out.push(n);return out;};
const monthRules=(ordinals,weekdays)=>ordinals.flatMap(ordinal=>weekdays.map(weekday=>({ordinal,weekday})));
const cases=[
  ...['Start with a tap','Enable tap to start','Start a session by tapping the item'].map((prompt,i)=>[
    'tapStartsSession',prompt,true,{id:`minimal-tap-on-${i}`,selectAll:true}]),
  ...['Turn off start with a tap','Disable tap to start',"Don't start a session by tapping"].map((prompt,i)=>[
    'tapStartsSession',prompt,false,{id:`minimal-tap-off-${i}`,seed:{tapStartsSession:true},selectAll:true}]),
  ...['Enable DND during this session','Turn on Do Not Disturb during the session','Silence my phone during this habit'].map((prompt,i)=>[
    'reminderDnd',prompt,true,{id:`minimal-dnd-on-${i}`,native:true,selectAll:true}]),
  ...['Disable DND during this session','Turn off Do Not Disturb during the session',"Don't silence my phone during this habit"].map((prompt,i)=>[
    'reminderDnd',prompt,false,{id:`minimal-dnd-off-${i}`,native:true,reminderSeed:{dnd:true},selectAll:true}]),
  ...['Only when conditions fit','Make this a when conditions fit habit','Use opportunity recurrence'].map((prompt,i)=>[
    'repeatMode',prompt,'opportunity',{id:`minimal-conditions-mode-${i}`,selectAll:true}]),
  ...['Use a regular rhythm','Switch back to routine','Use routine recurrence'].map((prompt,i)=>[
    'repeatMode',prompt,'routine',{id:`minimal-routine-${i}`,seed:{repeatMode:'opportunity'},selectAll:true}]),
  ...['Trigger this by the weather','Use weather as the trigger',"Only when the weather matches"].map((prompt,i)=>[
    'conditionTrigger',prompt,'weather',{id:`minimal-weather-trigger-${i}`,seed:{repeatMode:'opportunity',conditionTrigger:'location'},selectAll:true}]),
  ...['Trigger this when I am near a place','Use location as the trigger','Set the trigger to location'].map((prompt,i)=>[
    'conditionTrigger',prompt,'location',{id:`minimal-place-trigger-${i}`,seed:{repeatMode:'opportunity'},selectAll:true}]),
  ...['Set the proximity radius to 300 meters','Within 300 metres of the place','Use a 300 meter radius'].map((prompt,i)=>[
    'conditionRadiusM',prompt,300,{id:`minimal-radius-${i}`,seed:{repeatMode:'opportunity',conditionTrigger:'location'},selectAll:true}]),
  ...['Use the Dry weather profile','Apply Dry weather','Set the weather profile to Dry'].map((prompt,i)=>[
    'weatherProfile',prompt,{mode:'profile',profileId:'dry'},{id:`minimal-weather-profile-${i}`,seed:{repeatMode:'opportunity'},selectAll:true}]),
  ...['Only at Home','Set the place to Home','Use Home as the location'].map((prompt,i)=>[
    'places',prompt,['home'],{id:`minimal-places-${i}`,seed:{repeatMode:'opportunity',conditionTrigger:'location'},selectAll:true}]),
  ...['The start time should be exact, not flexible','Use a fixed start','Pin the start time'].map((prompt,i)=>[
    'allowedTimeFixedStart',prompt,true,{id:`minimal-fixed-start-${i}`,seed:{allowedTimeStart:540,allowedTimeEnd:1020},record:{allowedTimeStart:540,allowedTimeEnd:null},selectAll:true}]),
  ...['The start time should be flexible','Use a flexible start','The start should not be exact'].map((prompt,i)=>[
    'allowedTimeFixedStart',prompt,false,{id:`minimal-flexible-start-${i}`,seed:{allowedTimeStart:540,allowedTimeFixedStart:true},selectAll:true}]),
  ...[
    ['reminderStart','Notify me when it starts','notification'],
    ['reminderStart','Use a ringing alarm at the start','alarm'],
    ['reminderStart','Turn off the start reminder','off'],
    ['reminderEnd','Notify me when it ends','notification'],
    ['reminderEnd','Use a ringing alarm at the end','alarm'],
    ['reminderEnd','Turn off the end reminder','off'],
    ['reminderTravelStart','Notify me when to leave','notification'],
    ['reminderTravelEnd','Notify me on arrival','notification'],
    ['reminderMissed','Warn me if I miss it','notification'],
    ['reminderTravelLead','Give me a quarter hour warning before leaving',15],
    ['reminderMissedLead','Give me 15 minutes of missed warning',15]
  ].map(([field,prompt,value],i)=>[field,prompt,value,{id:`minimal-phone-reminder-${i}`,native:true,selectAll:true}]),
  ['allowedWeekdays','Monday to Friday and make it 20 minutes',[1,2,3,4,5],{id:'minimal-compound-days-duration',extra:{durationMinutes:20},selectAll:true}],
  ['allowedWeekdays','Actually, Monday through Thursday',[1,2,3,4],{id:'minimal-followup-days',historySteps:['All days except Friday'],selectAll:true}],
  ...['Start exactly at 9am','Use a fixed start at 09:00','Start at 9am sharp'].map((prompt,i)=>[
    'allowedWindow',prompt,null,{id:`minimal-fixed-clock-${i}`,extra:{allowedTimeFixedStart:true},record:{allowedTimeStart:540,allowedTimeEnd:null,allowedTimeFixedStart:true},selectAll:true}]),
  ['dueTime','Start exactly at 9am',540,{id:'minimal-task-fixed-clock',kind:'task',selectAll:true}],
  // Minimal-mode controls: daily fixtures and unfamiliar ordinary wording.
  ...[
    ['Change it from daily to Monday to Friday',[1,2,3,4,5]],
    ["Change this daily habit to all day's except Friday",[0,1,2,3,4,6]],
    ['Monday through Friday',[1,2,3,4,5]],
    ['Mon-Fri',[1,2,3,4,5]],
    ['Only on Monday–Friday',[1,2,3,4,5]],
    ['Friday through Monday',[0,1,5,6]],
    ['All days except Friday',[0,1,2,3,4,6]],
    ['Any day apart from Fridays',[0,1,2,3,4,6]],
    ['Weekdays except Wednesday',[1,2,4,5]],
    ['Monday to Saturday excluding Tuesday and Thursday',[1,3,5,6]],
    ['Weekends only',[0,6]],
    ['Only Tuesdays and Thursdays',[2,4]],
    ['Do not schedule it on Fridays',[0,1,2,3,4,6]],
    ['Never on weekends',[1,2,3,4,5]],
    ['Every day except Friday',[0,1,2,3,4,6],{extra:{timesPerPeriod:1,periodDays:1}}],
    ['Every Monday to Friday',[1,2,3,4,5],{extra:{timesPerPeriod:5,periodDays:7}}]
  ].map(([prompt,value,opts],i)=>['allowedWeekdays',prompt,value,{id:`minimal-days-${i}`,selectAll:true,seed:{target:1,rhythm:{timesPerPeriod:1,periodDays:1}},...opts}]),
  ...[
    ['Make it daily',1,1],['Do this every other day',1,2],['Twice a week',2,7],
    ['Repeat once every two weeks',1,14],['Three times in seven days',3,7],['Change from daily to weekly',1,7]
  ].map(([prompt,times,days],i)=>['frequency',prompt,times,{id:`minimal-frequency-${i}`,extra:{periodDays:days},selectAll:true}]),
  ...['Make each session 20 minutes','It should take half an hour','Change the duration from 30 minutes to 45 minutes'].map((prompt,i)=>[
    'durationMinutes',prompt,[20,30,45][i],{id:`minimal-duration-${i}`,selectAll:true}]),
  ...[
    ['Only between 9am and 5pm',{allowedTimeStart:540,allowedTimeEnd:1020}],
    ['After 6pm',{allowedTimeStart:1080,allowedTimeEnd:null}],
    ['Finish before 10pm',{allowedTimeStart:null,allowedTimeEnd:1320}],
    ['From 10pm until 2am',{allowedTimeStart:1320,allowedTimeEnd:120}],
    ['From sunrise to sunset',{allowedTimeStartAnchor:'sunrise',allowedTimeEndAnchor:'maghrib'}]
  ].map(([prompt,record],i)=>['allowedWindow',prompt,null,{id:`minimal-hours-${i}`,record,selectAll:true}]),
  ...['No time restrictions','Any time of day','Remove the allowed hours'].map((prompt,i)=>[
    'allowedWindow',prompt,null,{id:`minimal-clear-hours-${i}`,op:'clear',seed:{allowedTimeStart:540,allowedTimeEnd:1020},record:{allowedTimeStart:null,allowedTimeEnd:null},selectAll:true}]),
  ...['Any day of the week','Remove the day restrictions','Go back to all days'].map((prompt,i)=>[
    'allowedWeekdays',prompt,null,{id:`minimal-clear-days-${i}`,op:'clear',seed:{allowedWeekdays:[1,3]},record:{allowedWeekdays:[]},selectAll:true}]),
  ...['Make this a task','Convert this task to a habit'].map((prompt,i)=>[
    'kind',prompt,i?'habit':'task',{id:`minimal-kind-${i}`,kind:i?'task':'habit',selectAll:true}]),
  ...['Build this habit','I want to limit this habit','I want to stop this habit'].map((prompt,i)=>[
    'habitKind',prompt,['keepup','reduce','zero'][i],{id:`minimal-habit-mode-${i}`,selectAll:true}]),
  ...['Rename this to Evening Walk','Call it Evening Walk','The name should be Evening Walk'].map((prompt,i)=>[
    'name',prompt,'Evening Walk',{id:`minimal-title-${i}`,selectAll:true}]),
  ...['Use 🌿 as the icon','Change the emoji to 🌿','Set the icon to 🌿'].map((prompt,i)=>[
    'emoji',prompt,'🌿',{id:`minimal-emoji-${i}`,selectAll:true}]),
  ...['Make the background blue','Set the color to blue','Use blue for the background'].map((prompt,i)=>[
    'emojiBgColor',prompt,'blue',{id:`minimal-color-${i}`,selectAll:true}]),
  ...['Due tomorrow','Move the due date to November 9th','The deadline is 2026-11-09'].map((prompt,i)=>[
    'dueDate',prompt,day(i?'2026-11-09':'2026-11-02'),{id:`minimal-due-${i}`,kind:'task',selectAll:true}]),
  ...['Start at 9am','Set the start time to 3:30pm','Move the start time to 18:00'].map((prompt,i)=>[
    'dueTime',prompt,[540,930,1080][i],{id:`minimal-task-clock-${i}`,kind:'task',selectAll:true}]),
  ...['Clear the due date','Remove the deadline'].map((prompt,i)=>[
    'dueDate',prompt,null,{id:`minimal-clear-due-${i}`,kind:'task',op:'clear',selectAll:true}]),
  ...['Clear the start time','Remove the start time'].map((prompt,i)=>[
    'dueTime',prompt,null,{id:`minimal-clear-clock-${i}`,kind:'task',op:'clear',selectAll:true}]),
  ['allowedWindow','from whichever is earlier: 7am or sunrise, until 9am',null,{id:'window-combined-earlier',record:{allowedTimeStart:420,allowedTimeStartCombine:'earlier',allowedTimeStartAnchor2:'sunrise',allowedTimeEnd:540}}],
  ['allowedWindow','6pm to 8pm',null,{id:'window-bare-clock-range',record:{allowedTimeStart:1080,allowedTimeEnd:1200}}],
  ['allowedWindow','18:00–20:00',null,{id:'window-24h-range',record:{allowedTimeStart:1080,allowedTimeEnd:1200}}],
  ['allowedWindow','11:30pm to 12:30am',null,{id:'window-overnight-range',record:{allowedTimeStart:1410,allowedTimeEnd:30}}],
  ['allowedWindow','sunset to two hours after sunset',null,{id:'window-bare-solar-range',record:{allowedTimeStartAnchor:'maghrib',allowedTimeStartOffsetMin:0,allowedTimeEndAnchor:'maghrib',allowedTimeEndOffsetMin:120}}],
  ['allowedWindow','from sunrise - 15 minutes to 8am',null,{id:'window-minus-offset',record:{allowedTimeStartAnchor:'sunrise',allowedTimeStartOffsetMin:-15,allowedTimeEnd:480}}],
  ['allowedWindow','after sunrise until noon',null,{id:'window-noon-clock',record:{allowedTimeStartAnchor:'sunrise',allowedTimeEnd:720,allowedTimeEndAnchor:null}}],
  ['allowedWindow','No later than 10pm',null,{id:'window-positive-upper-bound',record:{allowedTimeStart:null,allowedTimeEnd:1320}}],
  ['preferredWindow','preferred 7pm to 7:30pm',null,{id:'window-preferred-bare-range',record:{preferredTimeStart:1140,preferredTimeEnd:1170,allowedTimeStart:null,allowedTimeEnd:null}}],
  ['priority','Priority 1',1,{id:'priority-number-label'}],
  ['priority','High priority',1,{id:'priority-word-label'}],
  ['allowedMonthDays','On the 1st of the month',[1],{id:'calendar-monthday-ordinal-label'}],
  ['name','Rename it Evening Walk','Evening Walk'],
  ['kind','Change it to a task','task'],
  ['habitKind','Limit this habit','reduce'],
  ['frequency','Three times a week',3,{extra:{periodDays:7},covers:['timesPerPeriod','periodDays']}],
  ['emoji','Use the 🌟 emoji','🌟'],['emojiBgColor','Set the background color to blue','blue'],
  ['priority','Set priority P3',3],
  ['repeatMode','Use opportunity recurrence','opportunity'],
  ['conditionTrigger','Set trigger to location','location',{seed:{repeatMode:'opportunity'}}],
  ['conditionRadiusM','Set radius to 300 meters',300,{seed:{repeatMode:'opportunity'}}],
  ['dueDate','Change plan by to 1/7/2027',day('2027-01-07'),{kind:'task',prelude:['Plan this for first week of 2027','Plan by'],record:{eventTime:day('2027-01-07')+9*3600000,hardDue:true}}],
  ['dueDate','Set due date to January 7, 2027',day('2027-01-07'),{kind:'task'}],
  ...["Let's plan for tomorrow",'Set due date to tomorrow','Move the due date to tonight'].map((prompt,index)=>
    ['dueDate',prompt,index===2?new Date('2026-11-01T00:00:00-04:00').getTime():day('2026-11-02'),{id:`language-date-prefix-${index+1}`,kind:'task',seed:{hardDue:true},record:{name:'Apply premium',durationMinutes:30,hardDue:true,eventTime:new Date(`${index===2?'2026-11-01':'2026-11-02'}T09:00:00-05:00`).getTime()}}]),
  ['planByDate','Plan by tomorrow',day('2026-11-02'),{id:'language-date-prefix-habit'}],
  ['appointmentStartDate','Set date to tomorrow','2026-11-02',{id:'language-date-prefix-event',kind:'event'}],
  ['appointmentUntil','Repeat until tomorrow','2026-11-02',{id:'language-date-prefix-until',kind:'event'}],
  ...['Astrology','Topography','Itinerary'].map((topic,index)=>['topics',`Tag ${topic}`,[topic],{id:`language-label-prefix-${index+1}`}]),
  ['topics','Topic:Astrology',['Astrology'],{id:'language-label-prefix-colon'}],
  ['emojiBgColor','Color:blue','blue',{id:'language-label-prefix-color'}],
  ['dueTime','Start at 10am',600,{kind:'task'}],
  ['hardDue','Make it a hard deadline',true,{kind:'task',seed:{delayAllowanceDays:2}}],
  ['planByDate','Plan by 2027-01-07',day('2027-01-07')],
  ['planByDate','Can you plan this by next week',day('2026-11-08'),{seed:{name:'Pay rent',durationMinutes:7,target:28},record:{name:'Pay rent',durationMinutes:7,target:28}}],
  ['planByDate','Use that date again',day('2027-01-07'),{historySteps:[{prompt:'Plan by',ready:false},'1/7/2027'],reuse:'1/7/2027'}],
  ['durationMinutes','Use the first duration I mentioned earlier',40,{historySteps:['Make it 40 minutes long','Make it 60 minutes long'],reuse:'40 minutes long'}],
  ['earlyWindowDays','Allow 3 days early',3],['delayAllowanceDays','Allow a delay of 2 days',2,{kind:'task'}],
  ['allowedWeekdays','Only on Monday and Wednesday',[1,3]],
  ['allowedMonthDays','Allow month days 1 and 15',[1,15]],
  ['allowedOrdinalWeekdays','Only on the last Friday of every month',[{ordinal:-1,weekday:5}]],
  ['allowedOrdinalWeekdays','Only on the first Monday and third Monday of each month',[{ordinal:1,weekday:1},{ordinal:3,weekday:1}],{id:'monthly-weekday-list'}],
  ['allowedOrdinalWeekdays','Only on the first and third Monday of each month',[{ordinal:1,weekday:1},{ordinal:3,weekday:1}],{id:'monthly-weekday-shared-day'}],
  ['allowedWindow','Only between 6pm and 8pm',null,{record:{allowedTimeStart:1080,allowedTimeEnd:1200}}],
  ['allowedWindow','After sunset to two hours after sunset',null,{id:'basics-window-bounded-solar',record:{allowedTimeStartAnchor:'maghrib',allowedTimeStartOffsetMin:0,allowedTimeEndAnchor:'maghrib',allowedTimeEndOffsetMin:120}}],
  ['allowedWindow','One hour before sunrise until sunrise',null,{id:'basics-window-bounded-offset',record:{allowedTimeStartAnchor:'sunrise',allowedTimeStartOffsetMin:-60,allowedTimeEndAnchor:'sunrise',allowedTimeEndOffsetMin:0}}],
  ['preferredWindow','Prefer after sunset until one hour after isha',null,{id:'basics-window-bounded-preference',record:{preferredTimeStartAnchor:'maghrib',preferredTimeStartOffsetMin:0,preferredTimeEndAnchor:'isha',preferredTimeEndOffsetMin:60}}],
  ['allowedTimeFixedStart','Use a fixed start time',true],
  ['preferredWeekdays','Prefer Monday and Wednesday',[1,3]],
  ['preferredWeekdays','Prefer Mondays',[1],{id:'calendar-preferred-plural-weekday'}],
  ['preferredMonthDays','Prefer month days 1 and 15',[1,15]],
  ['preferredOrdinalWeekdays','Prefer the second Tuesday of each month',[{ordinal:2,weekday:2}]],
  ['preferredWindow','Prefer before sunset',null,{record:{preferredTimeEndAnchor:'maghrib',allowedTimeEndAnchor:null}}],
  ['durationMinutes','Make it 40 minutes long',40],
  ['durationMinutes','Double the duration',60,{id:'duration-relative-double'}],
  ['breakable','Allow splitting into chunks',true],
  ['minChunkMinutes','Set minimum chunk to 15 minutes',15,{seed:{breakable:true}}],
  ['minGapMinutes','Set a 20 minute gap between sessions',20],
  ['timerAutoStopMinutes','Stop timer automatically after 30 minutes',30],
  ['autoMarkMinutes','Automatically mark done after 5 minutes',5],
  ['trackValue','Track a value',true],
  ['places','Set place to Home',['home']],
  ['places','At Home',['home'],{id:'place-locative-saved-name'}],
  ['locationPrefs','Prefer Home',{home:'high'},{id:'place-preference-saved-name'}],['anywhereAllowed','Allow anywhere',true,{seed:{anywhereAllowed:false}}],
  ['locationPrefs','Prefer Home as the place',{home:'high'}],
  ['weatherProfile','Use weather profile Dry',{mode:'profile',profileId:'dry'}],
  ['weatherRules','Temperature above 10 C',null,{rule:true}],
  ['showWeather','Show weather',true],
  ['showWeatherAtLocation','Show weather at this place',true],
  ['weatherLocationId','Set weather in Home','home'],
  ['scheduleOptions','Add an option Monday from 6pm to 8pm at Home',null,{option:true}],
  ['scheduleLinks','Immediately after Meeting',null,{order:true}],
  ['topics','Tag it Fitness',['Fitness']],['pinned','Pin it',true],
  ['snoozedUntil','Snooze until tomorrow',day('2026-11-02')],
  ['sharedDisplay','Set shared display to view only','view'],
  ['links','Add link https://example.com/study',null,{link:'https://example.com/study'}],
  ['appointmentRepeat','Repeat weekly','weekly',{kind:'event'}],
  ['appointmentStartDate','Set start date to 2027-01-07','2027-01-07',{kind:'event'}],
  ['appointmentWeekdays','Repeat on Monday and Wednesday',[1,3],{kind:'event'}],
  ['appointmentUntil','Repeat until 2027-02-01','2027-02-01',{kind:'event'}],
  ['appointmentStartMinute','Start at 10am',600,{kind:'event'}],
  ['appointmentStartMinute','Start at 10am',600,{kind:'event',scope:'occurrence',covers:['exceptionTime']}],
  ['durationMinutes','Make it 40 minutes long',40,{kind:'event',scope:'occurrence',covers:['exceptionDuration']}],
  ['emoji','Use the 🌟 emoji','🌟',{kind:'event',scope:'occurrence',covers:['exceptionEmoji']}],
  ['emojiBgColor','Set color to blue','blue',{kind:'event',scope:'occurrence',covers:['exceptionColor']}],
  ['exceptionCancelled','Cancel this occurrence',true,{kind:'event',scope:'occurrence'}],
  ['exceptionReset','Reset this occurrence',true,{kind:'event',scope:'occurrence',exception:{startMinute:660}}],
  ['reminderStart','Set start reminder to alarm','alarm',{native:true}],
  ['reminderEnd','Set end reminder to off','off',{native:true}],
  ['reminderTravelStart','Set travel start reminder to notification','notification',{native:true}],
  ['reminderTravelEnd','Set travel end reminder to off','off',{native:true}],
  ['reminderMissed','Set missed warning to notification','notification',{native:true}],
  ['reminderTravelLead','Remind me 15 minutes before departure',15,{native:true}],
  ['reminderStartLead','Remind me 15 minutes before start',15,{native:true,kind:'event'}],
  ['reminderMissedLead','Set missed warning lead to 15 minutes',15,{native:true}],
  ['reminderReset','Reset reminders to defaults',true,{native:true,reminderSeed:{start:'alarm',end:'notification',travelLeadMinutes:60,dates:{'2026-11-09':{start:'notification'}}}}],
  ['frequency','I want to do this every third day',1,{id:'language-frequency-third',extra:{periodDays:3},seed:{name:'Sample: go for a walk',durationMinutes:20},record:{name:'Sample: go for a walk',durationMinutes:20}}],
  ['frequency','Repeat every 3rd day',1,{id:'language-frequency-digit-ordinal',extra:{periodDays:3}}],
  ['frequency','Repeat each fourth day',1,{id:'language-frequency-each',extra:{periodDays:4}}],
  ['frequency','Repeat every twenty-one days',1,{id:'language-frequency-compound',extra:{periodDays:21}}],
  ['frequency','Repeat every two weeks',1,{id:'language-frequency-weeks',extra:{periodDays:14}}],
  ['frequency','Twice every three weeks',2,{id:'language-frequency-count-period',extra:{periodDays:21}}],
  ['frequency','Once every other week',1,{id:'language-frequency-other-week',extra:{periodDays:14}}],
  ['frequency','Twenty-one times in thirty days',21,{id:'language-frequency-large-count',extra:{periodDays:30}}],
  ['frequency','Every third day',1,{id:'language-frequency-correction',extra:{periodDays:3},prelude:['Repeat every zero days']}],
  ['frequency','Use the first frequency I mentioned earlier',1,{id:'language-frequency-history',extra:{periodDays:3},historySteps:['Every third day','Every fourth day'],reuse:'Every third day'}],
  ['allowedMonthDays','Only on the first and fifteenth of each month',[1,15],{id:'language-monthdays-words'}],
  ['preferredMonthDays','Prefer the second and twenty-first of each month',[2,21],{id:'language-monthdays-preference'}],
  ['earlyWindowDays','Allow one week early',7,{id:'language-early-week'}],
  ['delayAllowanceDays','Allow a delay of two weeks',14,{id:'language-delay-weeks',kind:'task'}],
  ['conditionRadiusM','Set radius to half a kilometer',500,{id:'language-radius-kilometer',seed:{repeatMode:'opportunity'}}],
  ['durationMinutes','Make it twenty-five minutes long',25,{id:'language-duration-compound'}],
  ['durationMinutes','Change it to one and a half hour long',90,{id:'language-duration-mixed-fraction'}],
  ['durationMinutes','Change it to one and a half hour long',90,{id:'language-duration-task-fraction',kind:'task'}],
  ['durationMinutes','Change it to one and a half hour long',90,{id:'language-duration-occurrence-fraction',kind:'event',scope:'occurrence',covers:['exceptionDuration']}],
  ['durationMinutes','Make it two and a half hours long',150,{id:'language-duration-two-fraction'}],
  ['durationMinutes','Make it one and a quarter hour long',75,{id:'language-duration-quarter'}],
  ['durationMinutes','Make it an hour and a quarter long',75,{id:'language-duration-post-unit-fraction'}],
  ['durationMinutes','Make it one and a half hours and fifteen minutes long',105,{id:'language-duration-fraction-mixed-units'}],
  ['durationMinutes','Make it 1½ hours long',90,{id:'language-duration-vulgar-fraction'}],
  ['durationMinutes','Make it ¾ hour long',45,{id:'language-duration-standalone-vulgar-fraction'}],
  ['minChunkMinutes','Set minimum chunk to one and a half hours',90,{id:'language-chunk-mixed-fraction',seed:{breakable:true,durationMinutes:180}}],
  ['minGapMinutes','Set a one and a half hour gap between sessions',90,{id:'language-gap-mixed-fraction'}],
  ['minGapMinutes','Set a ¾ hour gap between sessions',45,{id:'language-gap-vulgar-fraction'}],
  ['timerAutoStopMinutes','Stop timer automatically after one and a half hours',90,{id:'language-timer-mixed-fraction'}],
  ['autoMarkMinutes','Automatically mark done after one and a half hours',90,{id:'language-auto-mixed-fraction'}],
  ['minChunkMinutes','Set minimum chunk to twenty-five minutes',25,{id:'language-chunk-compound',seed:{breakable:true}}],
  ['minGapMinutes','Set a quarter hour gap between sessions',15,{id:'language-gap-fraction'}],
  ['timerAutoStopMinutes','Stop timer automatically after half an hour',30,{id:'language-timer-fraction'}],
  ['autoMarkMinutes','Automatically mark done after a quarter hour',15,{id:'language-auto-fraction'}],
  ['reminderTravelLead','Remind me half an hour before departure',30,{id:'language-reminder-fraction',native:true}],
  ['reminderStartLead','Remind me one hour before start',60,{id:'language-reminder-hour',native:true,kind:'event'}],
  ['reminderMissedLead','Set missed warning lead to a quarter hour',15,{id:'language-warning-fraction',native:true}],
  ...["Let's do this tomorrow",'Tomorrow instead, please','Can you set the due date to tomorrow','Due tomorrow please','Tomorrow  instead'].map((prompt,index)=>
    ['dueDate',prompt,day('2026-11-02'),{id:`basics-date-${index+1}`,kind:'task'}]),
  ['dueTime','Start at 6pm instead',1080,{id:'basics-clock-correction',kind:'task'}],
  ['dueTime',"Let's start at noon",720,{id:'basics-clock-noon',kind:'task'}],
  ['durationMinutes','Half an hour, please',30,{id:'basics-duration-polite'}],
  ['durationMinutes','Make it an hour',60,{id:'basics-duration-hour'}],
  ['durationMinutes',"I'd like this to take 45 minutes",45,{id:'basics-duration-natural'}],
  ['frequency',"I'd like this twice weekly",2,{id:'basics-frequency-weekly',extra:{periodDays:7}}],
  ['frequency','Can we do this every other day?',1,{id:'basics-frequency-question',extra:{periodDays:2}}],
  ['name','Call it Evening Walk','Evening Walk',{id:'basics-name-call'}],
  ['name','Can you rename it to Fresh Start?','Fresh Start',{id:'basics-name-question'}],
  ['topics','Put this under Health',['Health'],{id:'basics-topic-natural'}],
  ['topics','Tag this Personal',['Personal'],{id:'basics-topic-pronoun'}],
  ['pinned','Keep it pinned please',true,{id:'basics-pin-polite'}],
  ['pinned','Unpin this',false,{id:'basics-unpin'}],
  ['allowedWindow','Only before sunset, please',null,{id:'basics-window-polite',record:{allowedTimeEndAnchor:'maghrib'}}],
  ['allowedWeekdays','Weekdays only, please',[1,2,3,4,5],{id:'basics-weekdays-polite'}],
  ['emojiBgColor','Use a blue background please','blue',{id:'basics-color-polite'}],
  ['dueDate','Actually Friday instead',day('2026-11-06'),{id:'basics-date-followup',kind:'task',historySteps:['Set due date to tomorrow']}],
  ['dueTime','Make that 10am',600,{id:'basics-clock-followup',kind:'task',historySteps:['Start at 9am']}],
  ['durationMinutes','45 minutes instead',45,{id:'basics-duration-followup',historySteps:['Make it an hour long']}],
  ['frequency','Actually make it three times per week',3,{id:'basics-frequency-followup',extra:{periodDays:7},historySteps:['Every other day']}],
  ['name','Call it Tomorrow','Tomorrow',{id:'basics-name-date-word',kind:'task',record:{dueDate:new Date('2026-10-17T00:00:00-04:00').getTime()}}],
  ['name','Rename it Blue Sky','Blue Sky',{id:'basics-name-color-word'}],
  ['name','Call it Daily Bread','Daily Bread',{id:'basics-name-frequency-word'}],
  ['name','Call it Please','Please',{id:'basics-name-dialogue-word'}],
  ['name','Call it Carry On','Carry On',{id:'basics-name-trailing-connector'}],
  ['name','Call it Not at Night','Not at Night',{id:'basics-name-negated-daypart'}],
  ['name','Call it Read After Meeting','Read After Meeting',{id:'basics-name-order-words'}],
  ['topics','Tag it Instead',['Instead'],{id:'basics-topic-dialogue-word'}],
  ['dueDate','Set the due date to the day after tomorrow',day('2026-11-03'),{id:'basics-date-relative-day',kind:'task'}],
  ['dueDate','Actually Friday instead, pin it',day('2026-11-06'),{id:'basics-date-followup-sibling',kind:'task',extra:{pinned:true},historySteps:['Set due date to tomorrow']}],
  ['dueDate','Clear the due date',null,{id:'basics-clear-date',kind:'task',op:'clear',record:{dueDate:null,eventTime:null}}],
  ['dueTime','Clear the start time',null,{id:'basics-clear-clock',kind:'task',op:'clear',record:{eventTime:null}}],
  ['allowedWeekdays','Clear allowed weekdays',null,{id:'basics-clear-weekdays',op:'clear',seed:{allowedWeekdays:[1,2]},record:{allowedWeekdays:[]}}],
  ['allowedWindow','Clear allowed hours',null,{id:'basics-clear-window',op:'clear',seed:{allowedTimeStart:540,allowedTimeEnd:1020},record:{allowedTimeStart:null,allowedTimeEnd:null}}],
  ['topics','Clear topics',null,{id:'basics-clear-topics',op:'clear',seed:{topics:['Work']},record:{topics:[]}}],
  ['places','Clear places',null,{id:'basics-clear-places',op:'clear',seed:{locationIds:['home']},record:{locationIds:[]}}],
  ['weatherProfile','Clear weather profile',null,{id:'basics-clear-weather',op:'clear',seed:{weatherProfileMode:'profile',weatherProfileId:'dry'},record:{weatherProfileId:null,weatherProfileMode:'none'}}],
  ['links','Clear links',null,{id:'basics-clear-links',op:'clear',seed:{links:[{id:'guide',type:'url',label:'Guide',value:'https://example.com'}]},record:{links:[]}}],
  ['topics','Tag it Clear',['Clear'],{id:'basics-topic-clear-word'}],
  ['pinned','Pin it instead',true,{id:'basics-explicit-setting-followup',kind:'task',extra:{dueDate:day('2026-11-02')},historySteps:['Set due date to tomorrow']}],
  ['reminderStartLead','Set the start alert advance time to a quarter hour',15,{id:'basics-alert-advance-fraction',kind:'event',native:true,selectAll:true}],
  ['reminderStart','The start alert should ring','alarm',{id:'basics-alert-repeat',native:true,selectAll:true,historySteps:['The start alert should ring']}],
  ['reminderEnd','The end alert should ring','alarm',{id:'basics-alert-end-ring',native:true,selectAll:true}],
  ...['The start time should be exact, not flexible','Pin the allowed start time exactly','Use an exact start instead of a flexible window','Do not slide its start time around','Make the allowed start non-flexible'].map((prompt,i)=>[
    'allowedTimeFixedStart',prompt,true,{id:`basics-fixed-policy-${i}`,kind:'task',selectAll:true}]),
  ['allowedTimeFixedStart','Allow a flexible start time',false,{id:'basics-flexible-policy',seed:{allowedTimeFixedStart:true},selectAll:true}],
  ['durationMinutes','Just this time, make it 90 min',90,{id:'basics-occurrence-duration-scope',kind:'event',scope:'occurrence',covers:['exceptionDuration'],selectAll:true}],
  ...['For this occurrence only, start at 12:00 am','Just this time, start at 6:05am','Only this date, start at noon'].map((prompt,i)=>[
    'appointmentStartMinute',prompt,[0,365,720][i],{id:`basics-occurrence-clock-${i}`,kind:'event',scope:'occurrence',covers:['exceptionTime'],selectAll:true}]),
  ...['9am sharp','18.30','1830 hours','9 a.m.','half past three in the afternoon'].map((time,i)=>[
    'dueTime',`Set start time to ${time}`,[540,1110,1110,540,930][i],{id:`basics-clock-format-${i}`,kind:'task'}]),
  ...['November ninth','the ninth of November 2026','Nov. 9th','in eight days'].map((date,i)=>[
    'dueDate',`Set due date to ${date}`,day('2026-11-09'),{id:`basics-date-format-${i}`,kind:'task'}]),
  ...['Begin the event series on November ninth','Set the event series start day to 11/09/2026','The first date of the series is now Nov 9','The series should begin on the ninth of November 2026'].map((prompt,i)=>[
    'appointmentStartDate',prompt,'2026-11-09',{id:`basics-series-date-${i}`,kind:'event'}]),
  ...['Use December first as the series end date','The recurrence end date should be December 1, 2026','The series should stop after December 1','Set the last date for repeats to 2026-12-01'].map((prompt,i)=>[
    'appointmentUntil',prompt,'2026-12-01',{id:`basics-series-until-${i}`,kind:'event'}]),
  ...['Hide it until tomorrow','Snooze this task to November 2','Put this on hold until tomorrow','Do not show this again until 2026-11-02','Pause showing this until the next day'].map((prompt,i)=>[
    'snoozedUntil',prompt,day('2026-11-02'),{id:`basics-snooze-phrase-${i}`,kind:'task',selectAll:true}]),
  ...[
    ['dueDate','This task should have no due date',{}, {dueDate:null,eventTime:null,hardDue:false}],
    ['dueDate','Get rid of its deadline',{}, {dueDate:null,eventTime:null,hardDue:false}],
    ['dueTime',"Remove the task's clock time",{}, {eventTime:null}],
    ['dueTime','Clear the start-time field',{}, {eventTime:null}],
    ['dueTime','This task no longer has a start time',{}, {eventTime:null}],
    ['allowedWeekdays','All days are fine',{allowedWeekdays:[1,3]},{allowedWeekdays:[]}],
    ['allowedMonthDays','Remove the day-of-month restrictions',{allowedMonthDays:[1,15]},{allowedMonthDays:[]}],
    ['allowedMonthDays','Any date in the month is fine',{allowedMonthDays:[1,15]},{allowedMonthDays:[]}],
    ['allowedOrdinalWeekdays','Clear the allowed monthly weekday rules',{allowedOrdinalWeekdays:[{ordinal:1,weekday:1}]},{allowedOrdinalWeekdays:[]}],
    ['preferredOrdinalWeekdays','Drop all ordinal weekday preferences',{preferredOrdinalWeekdays:[{ordinal:2,weekday:2}]},{preferredOrdinalWeekdays:[]}],
    ['preferredWeekdays','I have no preferred days of the week',{preferredWeekdays:[1,3]},{preferredWeekdays:[]}],
    ['locationPrefs','Remove my location preferences',{locationPrefs:{home:'high'}},{locationPrefs:{}}],
    ['minGapMinutes','No minimum spacing between sessions',{minGapMinutes:20},{minGapMinutes:0}],
    ['timerAutoStopMinutes','Disable the automatic timer stop',{timerAutoStopMinutes:30},{timerAutoStopMinutes:null}],
    ['timerAutoStopMinutes','Let the timer run without an automatic cutoff',{timerAutoStopMinutes:30},{timerAutoStopMinutes:null}],
    ['autoMarkMinutes','Do not mark this done automatically anymore',{autoMarkMinutes:10},{autoMarkMinutes:null}],
    ['scheduleOptions','Clear all schedule alternatives',{scheduleOptions:[{weekdays:[1],start:540,end:600}]},{scheduleOptions:[]}],
    ['scheduleLinks','Clear the schedule links',{scheduleLinks:[{anchorHid:'meeting',relation:'after',adjacency:'direct'}]},{scheduleLinks:[]}],
    ['weatherLocationId','Unset the weather forecast place',{weatherLocationId:'home'},{weatherLocationId:null}],
    ['snoozedUntil','Unsnooze it',{snoozedUntil:day('2026-11-04')},{snoozedUntil:null}]
  ].map(([field,prompt,seed,record],i)=>[field,prompt,null,{id:`basics-clear-natural-${i}`,op:'clear',kind:['dueDate','dueTime'].includes(field)?'task':'habit',seed,record,selectAll:true}]),
  ['appointmentUntil','Let the series repeat without an end date',null,{id:'basics-clear-series-until',op:'clear',kind:'event',seed:{appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'2026-12-01'}}}],
  ...['The deadline must be strict','Make the due date non-negotiable','Do not allow this task to slip past its due date','Treat the deadline as hard','It must be completed by the deadline with no delay'].map((prompt,i)=>[
    'hardDue',prompt,true,{id:`everyday-deadline-strict-${i}`,kind:'task',selectAll:true}]),
  ...['Use a soft deadline','Make the deadline flexible','The deadline is not strict'].map((prompt,i)=>[
    'hardDue',prompt,false,{id:`everyday-deadline-soft-${i}`,kind:'task',seed:{hardDue:true},selectAll:true}]),
  ['dueDate','Set a strict deadline for tomorrow',day('2026-11-02'),{id:'everyday-deadline-date',kind:'task',extra:{hardDue:true}}],
  ...['Permit doing it at any location','This does not require a particular place','There should be no geographic restriction','I can do this wherever I am','Allow it regardless of location'].map((prompt,i)=>[
    'anywhereAllowed',prompt,true,{id:`everyday-anywhere-${i}`,seed:{anywhereAllowed:false,locationIds:['home']},record:{locationIds:['home']},selectAll:true}]),
  ['anywhereAllowed','Allow only at saved places',false,{id:'everyday-only-saved-places',seed:{locationIds:['home']},selectAll:true}],
  ['anywhereAllowed','Let me do it anywhere, not just at a saved place',true,{id:'everyday-anywhere-restatement',seed:{anywhereAllowed:false,locationIds:['home']},selectAll:true}],
  ...['Ask me for a number whenever I log this','I want to enter a numeric result when I check it off','Capture a numeric reading with every check-in','Turn on recording a value for each log','Enable a number field for logging this habit'].map((prompt,i)=>[
    'trackValue',prompt,true,{id:`everyday-track-number-${i}`,selectAll:true}]),
  ...['Show the weather at the activity location',"Use this item's place for its displayed forecast",'Display weather for the assigned place','Make the forecast follow wherever this item takes place','Use the item location when showing weather'].map((prompt,i)=>[
    'showWeatherAtLocation',prompt,true,{id:`everyday-weather-place-${i}`,selectAll:true}]),
  ...['Use the first Monday in every month',"Only allow the month's first Monday",'The monthly rule should be first Monday'].map((prompt,i)=>[
    'allowedOrdinalWeekdays',prompt,[{ordinal:1,weekday:1}],{id:`everyday-monthly-monday-${i}`,selectAll:true}]),
  ...['Prefer the monthly date 5','My preferred monthly day is the fifth','The fifth of the month works best'].map((prompt,i)=>[
    'preferredMonthDays',prompt,[5],{id:`everyday-monthly-preferred-${i}`,selectAll:true}]),
  ...['9 November 2026','9th of November','November ninth, 2026'].map((date,i)=>[
    'dueDate',`Set due date to ${date}`,day('2026-11-09'),{id:`everyday-date-order-${i}`,kind:'task',selectAll:true}]),
  // Saved edit-v2 failures. Scripted runs verify host boundaries only; the same
  // cases can use real assets without changing evidence or expectations.
  ...['Set the start time to 3:30pm','Start time 15:30','Set it to start at half past three in the afternoon'].map(prompt=>['dueTime',prompt,930,{id:`edit-v2-clock-${prompt}`,kind:'task'}]),
  ['appointmentStartMinute','Move the start time to 2:30pm',870,{id:'edit-v2-event-clock',kind:'event'}],
  ['appointmentStartMinute','Start time 14:30',870,{id:'edit-v2-event-clock-label',kind:'event'}],
  ['appointmentStartMinute','Move this occurrence to 4pm',960,{id:'edit-v2-occurrence-clock',kind:'event',scope:'occurrence',covers:['exceptionTime']}],
  ['appointmentStartMinute','For this one occurrence, 4pm instead',960,{id:'edit-v2-occurrence-clock-framing',kind:'event',scope:'occurrence'}],
  ['appointmentStartMinute','This date only: move it to four in the afternoon',960,{id:'edit-v2-occurrence-clock-spoken',kind:'event',scope:'occurrence'}],
  ['appointmentWeekdays','Repeat on Tuesdays and Thursdays instead',[2,4],{id:'edit-v2-plural-event-days',kind:'event'}],
  ['appointmentRepeat','Make it a one-time event','once',{id:'edit-v2-event-once',kind:'event'}],
  ['appointmentRepeat','Change the series to a single event','once',{id:'edit-v2-event-single',kind:'event'}],
  ['name','From now on call it "Evening Stroll"','Evening Stroll',{id:'edit-v2-quoted-name'}],
  ['name','The name should be Evening Stroll','Evening Stroll',{id:'edit-v2-name-framing'}],
  ['name','Name it Should Be Ready','Should Be Ready',{id:'edit-v2-name-literal-verb'}],
  ['emoji','Use the 🇺🇸 emoji','🇺🇸',{id:'edit-v2-flag-emoji'}],
  ['emojiBgColor','Use purple for the card background','purple',{id:'edit-v2-card-background'}],
  ['kind','I want it as a task instead of a habit','task',{id:'edit-v2-kind-conversion'}],
  ['conditionTrigger','Only when I am at a location','location',{id:'edit-v2-location-trigger',seed:{repeatMode:'opportunity'}}],
  ['hardDue','This cannot slip past its due date',true,{id:'edit-v2-hard-deadline',kind:'task',seed:{delayAllowanceDays:2}}],
  ['allowedMonthDays','Only on the 1st and the 15th of each month',[1,15],{id:'edit-v2-month-list'}],
  ['allowedMonthDays','Only on the 1st or the 15th',[1,15],{id:'edit-v2-month-list-or'}],
  ['allowedWeekdays','This can only happen on Tuesday or Thursday',[2,4],{id:'edit-v2-weekday-list-or'}],
  ['frequency','Schedule it for three sessions weekly',3,{id:'edit-v2-counted-sessions',extra:{periodDays:7}}],
  ['earlyWindowDays','Allow starting 2 days early',2,{id:'edit-v2-flexibility-alias',record:{earlyWindowDays:2,flexibilityDays:2}}],
  ['earlyWindowDays','It can start two days before',2,{id:'edit-v2-early-before'}],
  ['earlyWindowDays','Enable a 2 day early window',2,{id:'edit-v2-early-window'}],
  ['delayAllowanceDays','Give it a 3 day grace period',3,{id:'edit-v2-grace-period'}],
  ['dueDate','Change the deadline to 11/04/2026',day('2026-11-04'),{id:'edit-v2-deadline-prefix',kind:'task'}],
  ['planByDate','I should have this planned by November 8',day('2026-11-08'),{id:'edit-v2-planned-by'}],
  ['planByDate','Plan-by date: Nov 8',day('2026-11-08'),{id:'edit-v2-plan-by-label'}],
  ['autoMarkMinutes','Mark it done automatically after 10 minutes',10,{id:'edit-v2-auto-completion'}],
  ['showWeatherAtLocation','Show the forecast at the place',true,{id:'edit-v2-forecast-at-place'}],
  ['weatherLocationId','Show the weather forecast for Home','home',{id:'edit-v2-forecast-place'}],
  ['weatherProfile','Use the Dry weather profile',{mode:'profile',profileId:'dry'},{id:'edit-v2-saved-weather-profile'}],
  ['snoozedUntil','Snooze until tomorrow',day('2026-11-02'),{id:'edit-v2-snooze-date',kind:'task'}],
  ['sharedDisplay','Show it on the shared display','complete',{id:'edit-v2-show-shared-display'}],
  ['scheduleLinks','Do it right after Meeting on the same day',null,{id:'edit-v2-order-normalization',order:true}],
  ['preferredWeekdays',"I'd like it on Mondays and Wednesdays if possible",[1,3],{id:'edit-v2-preferred-weekdays'}],
  ['preferredOrdinalWeekdays','Ideally the second Tuesday every month',[{ordinal:2,weekday:2}],{id:'edit-v2-preferred-ordinal'}],
  ['preferredMonthDays','Prefer the fifth when possible',[5],{id:'edit-v2-preferred-monthday'}],
  ['allowedWindow','Keep it between six and eight in the evening',null,{id:'edit-v2-spoken-window',record:{allowedTimeStart:1080,allowedTimeEnd:1200}}],
  ['preferredWindow','If possible, fit it between 7 and 8 pm',null,{id:'edit-v2-preferred-window',record:{preferredTimeStart:1140,preferredTimeEnd:1200,allowedTimeStart:null,allowedTimeEnd:null}}],
  ...['Give me a 15 minute heads-up before leaving','Departure lead time 15 min'].map((prompt,i)=>['reminderTravelLead',prompt,15,{id:`edit-v2-departure-lead-${i}`,native:true,selectAll:true}]),
  ['reminderStartLead','Alert me 15 minutes before it begins',15,{id:'edit-v2-event-lead',kind:'event',native:true,selectAll:true}],
  ['reminderStartLead','Start reminder lead: 15 minutes',15,{id:'edit-v2-event-lead-label',kind:'event',native:true,selectAll:true}],
  ['reminderTravelEnd','Remind me on arrival','notification',{id:'edit-v2-arrival-reminder',native:true}],
  ['reminderStart','Alarm me when it starts','alarm',{id:'edit-v2-start-alarm',native:true}],
  ['reminderEnd','Notify me when it ends','notification',{id:'edit-v2-end-notification',native:true}],
  ...['Chunks should be at least 15 minutes','Split it in 15 minute pieces minimum','Keep chunks no shorter than a quarter hour'].map((prompt,i)=>
    ['minChunkMinutes',prompt,15,{id:`robust-edit-chunk-${i}`,seed:{breakable:true,durationMinutes:90},extra:{breakable:true},selectAll:true,record:{durationMinutes:90,minChunkMinutes:15}}]),
  ...['Leave at least 20 minutes between sessions','A 20 minute break is needed between two sessions','Keep sessions twenty minutes apart'].map((prompt,i)=>
    ['minGapMinutes',prompt,20,{id:`robust-edit-gap-${i}`,selectAll:true,record:{durationMinutes:30,minGapMinutes:20}}]),
  ...['The timer should stop on its own after half an hour','Auto-stop the timer at 30 min'].map((prompt,i)=>
    ['timerAutoStopMinutes',prompt,30,{id:`robust-edit-timer-${i}`,selectAll:true,record:{durationMinutes:30,type:'keepup',target:7}}]),
  ...['After ten minutes consider it done','Auto-complete once 10 minutes are logged'].map((prompt,i)=>
    ['autoMarkMinutes',prompt,10,{id:`robust-edit-complete-${i}`,selectAll:true,record:{durationMinutes:30}}]),
  ['breakable','Make it splittable',true,{id:'robust-edit-splittable',selectAll:true}],
  ...['Log a number each time','Enable value tracking'].map((prompt,i)=>['trackValue',prompt,true,{id:`robust-edit-value-${i}`,selectAll:true}]),
  ['places','Restrict it to the Home location',['home'],{id:'robust-edit-restrict-place',selectAll:true}],
  ['anywhereAllowed','No location restriction needed',true,{id:'robust-edit-anywhere',seed:{anywhereAllowed:false},selectAll:true}],
  ['locationPrefs','Home works best for me',{home:'high'},{id:'robust-edit-preferred-place',selectAll:true}],
  ...["Only when it's warmer than 80 degrees",'Skip it unless the temperature is over eighty degrees'].map((prompt,i)=>
    ['weatherRules',prompt,null,{id:`robust-edit-weather-rule-${i}`,ruleMin:80,selectAll:true}]),
  ...['Include the forecast on this card','I want to see the weather on it'].map((prompt,i)=>['showWeather',prompt,true,{id:`robust-edit-forecast-${i}`,selectAll:true}]),
  ['weatherLocationId','Use Home for the forecast','home',{id:'robust-edit-forecast-place',selectAll:true}],
  ...['Alternatively it can run Mondays 6 to 8 pm','Add a Monday evening 18:00 to 20:00 alternative'].map((prompt,i)=>
    ['scheduleOptions',prompt,null,{id:`robust-edit-alternative-${i}`,optionClocks:true,selectAll:true}]),
  ...['Schedule it right after my Meeting workout, same day','It must come directly after Meeting'].map((prompt,i)=>
    ['scheduleLinks',prompt,null,{id:`robust-edit-order-${i}`,order:true,selectAll:true,orderSameDay:true}]),
  ...['Put it in the Fitness topic','Categorize it under Fitness'].map((prompt,i)=>['topics',prompt,['Fitness'],{id:`robust-edit-topic-${i}`,selectAll:true}]),
  ...['Push it back to tomorrow','Snooze this until November 2'].map((prompt,i)=>['snoozedUntil',prompt,day('2026-11-02'),{id:`robust-edit-snooze-${i}`,kind:'task',selectAll:true}]),
  ...['It should appear on the shared display','Make it visible on the shared screen'].map((prompt,i)=>
    ['sharedDisplay',prompt,'view',{id:`robust-edit-shared-${i}`,seed:{showOnSharedDisplay:false,allowSharedDisplayCompletion:false},selectAll:true,record:{showOnSharedDisplay:true,allowSharedDisplayCompletion:false}}]),
  ['allowedWeekdays','Allow any weekday',null,{id:'robust-edit-any-weekday',op:'clear',seed:{allowedWeekdays:[1,3]},record:{allowedWeekdays:[]},selectAll:true}],
  ['reminderReset','Reset the reminders to the usual settings',true,{id:'robust-edit-reminder-reset',native:true,reminderSeed:{start:'alarm',dates:{'2026-11-09':{start:'notification'}}},selectAll:true}],
  ['appointmentStartDate','The series starts on November 9 now','2026-11-09',{id:'robust-edit-event-date',kind:'event',selectAll:true}],
  ['appointmentWeekdays','Repeat weekly on Tuesday and Thursday',[2,4],{id:'robust-edit-event-weekdays',kind:'event',selectAll:true}],
  ['appointmentWeekdays','Repeat weekly on Tuesday and Thursday',[2,4],{id:'robust-edit-once-to-weekly',kind:'event',selectAll:true,extra:{appointmentRepeat:'weekly'},seed:{appointment:{repeat:'once',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'',exceptions:{}}}}],
  ...['Move its start clock to 3:30 pm','I want a 3.30pm start time','Change the time to three thirty in the afternoon','Its start time should read 15:30'].map((prompt,i)=>
    ['dueTime',prompt,930,{id:`everyday-clock-${i}`,kind:'task',selectAll:true}]),
  ...['This task is due on the fourth of November 2026','I need this finished by Nov 4','Set its deadline date to 2026-11-04','The due day should be 11/04/2026','Change the date it is due to November fourth'].map((prompt,i)=>
    ['dueDate',prompt,day('2026-11-04'),{id:`everyday-date-${i}`,kind:'task',selectAll:true}]),
  ...['Keep it within 18:00 to 20:00','Fit this between 18:00 and 20:00 only','Do not place it outside the 6 to 8 pm window'].map((prompt,i)=>
    ['allowedWindow',prompt,null,{id:`everyday-hours-${i}`,record:{allowedTimeStart:1080,allowedTimeEnd:1200},selectAll:true}]),
  ...['Any time of day is fine','Remove all restrictions on the time of day','Leave the allowed time window empty'].map((prompt,i)=>
    ['allowedWindow',prompt,null,{id:`everyday-clear-hours-${i}`,op:'clear',seed:{allowedTimeStart:540,allowedTimeEnd:1020},record:{allowedTimeStart:null,allowedTimeEnd:null},selectAll:true}]),
  ...['Mondays and Wednesdays work best, but other days are fine','Favour Mon and Wed without restricting other days','Give Monday and Wednesday higher scheduling preference'].map((prompt,i)=>
    ['preferredWeekdays',prompt,[1,3],{id:`everyday-preferred-days-${i}`,selectAll:true,record:{allowedWeekdays:[],preferredWeekdays:[1,3]}}]),
  ['allowedWeekdays','Do not schedule it outside Tuesday and Thursday',[2,4],{id:'everyday-restricted-days',selectAll:true}],
  ...['Use a 0.25-hour session','Block out three quarters of an hour for each session','can u make it three quarters of an hour pls'].map((prompt,i)=>
    ['durationMinutes',prompt,i===0?15:45,{id:`everyday-length-${i}`,selectAll:true}]),
  ['breakable','This does not need one uninterrupted session',true,{id:'everyday-split-negation',selectAll:true}],
  ...['Three occurrences in every week','Make the weekly frequency three','Repeat 3x/week','Repeat 3/week'].map((prompt,i)=>
    ['frequency',prompt,3,{id:`everyday-frequency-${i}`,extra:{periodDays:7},selectAll:true}]),
  ['minGapMinutes','Allow at least one third of an hour between sessions',20,{id:'everyday-gap-third',selectAll:true}],
  ['minGapMinutes','Separate any two sessions by twenty minutes',20,{id:'everyday-gap-separate',selectAll:true}],
  ...['The smallest block of work should be a quarter hour','Minimum time per piece is 0.25 hours','Keep the minimum block size at 15 min','Do not split it into pieces shorter than 15 minutes'].map((prompt,i)=>
    ['minChunkMinutes',prompt,15,{id:`everyday-chunk-${i}`,seed:{breakable:true,durationMinutes:90},record:{breakable:true,durationMinutes:90,minChunkMinutes:15},selectAll:true}]),
  ['appointmentStartMinute','Move the whole series to a 14:30 start',870,{id:'everyday-event-start',kind:'event',selectAll:true}],
  ...[
    ['emoji','Remove the emoji',{emoji:'🌙'},{emoji:''}],
    ['emoji','Get rid of the emoji',{emoji:'🌙'},{emoji:''}],
    ['emojiBgColor','Remove the background color',{emojiBgColor:'blue'},{emojiBgColor:''}],
    ['dueDate','No due date anymore',{}, {dueDate:null,eventTime:null,hardDue:false}],
    ['dueTime','Remove the start time',{}, {eventTime:null}],
    ['allowedWeekdays','Any day is fine',{allowedWeekdays:[1,3]},{allowedWeekdays:[]}],
    ['preferredWindow','Drop the preferred hours',{preferredTimeStart:540,preferredTimeEnd:600},{preferredTimeStart:null,preferredTimeEnd:null}],
    ['topics','Remove the topic tags',{topics:['Work']},{topics:[]}],
    ['places','Remove the place',{locationIds:['home']},{locationIds:[]}],
    ['weatherProfile',"Don't use a weather profile",{weatherProfileMode:'profile',weatherProfileId:'dry'},{weatherProfileMode:'none',weatherProfileId:null}],
    ['weatherProfile','Stop using a weather profile',{weatherProfileMode:'profile',weatherProfileId:'dry'},{weatherProfileMode:'none',weatherProfileId:null}],
    ['links','Take the link off',{links:[{id:'guide',type:'url',label:'Guide',value:'https://example.com'}]},{links:[]}]
  ].map(([field,prompt,seed,record],i)=>[field,prompt,null,{id:`edit-v2-clear-${i}`,op:'clear',kind:['dueDate','dueTime'].includes(field)?'task':'habit',seed,record}]),
  ['allowedMonthDays','Only allowed this in the first week of every month',span(1,7),{id:'calendar-first-week',selectAll:true,record:{target:7}}],
  ['allowedMonthDays','Only on the 1st to the 5th of every month',span(1,5),{id:'calendar-date-range',selectAll:true,record:{target:7}}],
  ['allowedMonthDays','From the first through the fifth of each month',span(1,5),{id:'calendar-spoken-range',selectAll:true}],
  ['allowedMonthDays','Only on the 1st-5th and the 15th of every month',[...span(1,5),15],{id:'calendar-range-and-day',selectAll:true}],
  ['allowedMonthDays','The first five days of every month',span(1,5),{id:'calendar-first-n-days',selectAll:true}],
  ['allowedMonthDays','The first two weeks of each month',span(1,14),{id:'calendar-first-n-weeks',selectAll:true}],
  ['allowedMonthDays','The second and fourth weeks of every month',[...span(8,14),...span(22,28)],{id:'calendar-week-list',selectAll:true}],
  ['allowedMonthDays','Only during the first half of every month',span(1,15),{id:'calendar-first-half',selectAll:true}],
  ['allowedMonthDays','Only during the second half of each month',span(16,31),{id:'calendar-second-half',selectAll:true}],
  ['allowedMonthDays','Only in the first fortnight of every month',span(1,14),{id:'calendar-fortnight',selectAll:true}],
  ['allowedMonthDays','Only on odd days of the month',span(1,31).filter(n=>n%2),{id:'calendar-odd-days',selectAll:true}],
  ['allowedMonthDays','Only on even dates of every month',span(1,31).filter(n=>n%2===0),{id:'calendar-even-days',selectAll:true}],
  ['allowedMonthDays','Only on odd weeks of every month',[...span(1,7),...span(15,21),...span(29,31)],{id:'calendar-odd-weeks',selectAll:true}],
  ['allowedMonthDays','Only after the 20th of every month',span(21,31),{id:'calendar-after',selectAll:true}],
  ['allowedMonthDays','Only before the 5th of the month',[1,2,3,4],{id:'calendar-before',selectAll:true}],
  ['allowedMonthDays','Only on or before the 10th of each month',span(1,10),{id:'calendar-on-or-before',selectAll:true}],
  ['allowedMonthDays','No earlier than the 20th of every month',span(20,31),{id:'calendar-no-earlier',selectAll:true}],
  ['allowedMonthDays','Only after the 5th and before the 10th of every month',[6,7,8,9],{id:'calendar-between-bounds',selectAll:true}],
  ['allowedMonthDays','Every day of the month except the 31st',span(1,30),{id:'calendar-except-date',selectAll:true,record:{target:7}}],
  ['allowedMonthDays','Never on the 13th of the month',span(1,31).filter(n=>n!==13),{id:'calendar-never-date',selectAll:true}],
  ['allowedMonthDays','Only on days 1 through 5 except the 3rd of the month',[1,2,4,5],{id:'calendar-range-except',selectAll:true}],
  ['allowedMonthDays','Only between the 10th and the 12th of the month',[10,11,12],{id:'calendar-between',selectAll:true}],
  ['allowedMonthDays','Change it from daily to the 1st through the 5th of each month',span(1,5),{id:'calendar-from-daily',selectAll:true,seed:{target:1,rhythm:{timesPerPeriod:1,periodDays:1}},record:{target:1}}],
  ['preferredMonthDays','Prefer the first week of every month',span(1,7),{id:'calendar-prefer-week',selectAll:true,record:{allowedMonthDays:[]}}],
  ['allowedMonthDays','Only on the 1st, the 15th, and the 28th of every month',[1,15,28],{id:'calendar-comma-list',selectAll:true}],
  ['allowedMonthDays','Only during week 1 of every month',span(1,7),{id:'calendar-week-number',selectAll:true}],
  ['allowedMonthDays','Only during the fifth week of every month',[29,30,31],{id:'calendar-fifth-week',selectAll:true}],
  ['allowedMonthDays','Only from the 28th through the 31st of the month',[28,29,30,31],{id:'calendar-month-end',selectAll:true}],
  ['allowedMonthDays','Skip the 1st of every month',span(2,31),{id:'calendar-skip-date',selectAll:true}],
  ['allowedMonthDays','Do not schedule it outside the first week of every month',span(1,7),{id:'calendar-outside-week',selectAll:true}],
  ['allowedMonthDays','The 1st to the 5th of every month and make it 20 minutes',span(1,5),{id:'calendar-range-duration',selectAll:true,extra:{durationMinutes:20}}],
  ['allowedOrdinalWeekdays','Only allowed in the last week of every month',monthRules([-1],[0,1,2,3,4,5,6]),{id:'calendar-last-week',selectAll:true,record:{target:7}}],
  ['allowedOrdinalWeekdays','Only on the first through third Monday of every month',monthRules([1,2,3],[1]),{id:'calendar-ordinal-span',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on the first Monday through Friday of every month',monthRules([1],[1,2,3,4,5]),{id:'calendar-weekday-span',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on Mondays in the first week of every month',[{ordinal:1,weekday:1}],{id:'calendar-day-in-week',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on weekdays in the first week of every month',monthRules([1],[1,2,3,4,5]),{id:'calendar-weekdays-in-week',selectAll:true}],
  ['allowedOrdinalWeekdays','Only the first week of every month except Friday',monthRules([1],[0,1,2,3,4,6]),{id:'calendar-week-except-day',selectAll:true}],
  ['allowedOrdinalWeekdays','Only the last week of every month except weekends',monthRules([-1],[1,2,3,4,5]),{id:'calendar-last-except-weekend',selectAll:true}],
  ['allowedOrdinalWeekdays','Every Monday except the first Monday of each month',monthRules([2,3,4,5],[1]),{id:'calendar-except-first',selectAll:true,record:{target:7}}],
  ['allowedOrdinalWeekdays','Only on weekdays except the first week of the month',monthRules([2,3,4,5],[1,2,3,4,5]),{id:'calendar-except-week',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on the first or third Monday of each month',monthRules([1,3],[1]),{id:'calendar-ordinal-or',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on the first, third, and last Friday of every month',monthRules([-1,1,3],[5]),{id:'calendar-ordinal-comma',selectAll:true}],
  ['preferredOrdinalWeekdays','Prefer the last week of every month',monthRules([-1],[0,1,2,3,4,5,6]),{id:'calendar-prefer-last-week',selectAll:true,record:{allowedOrdinalWeekdays:[]}}],
  ['allowedOrdinalWeekdays','Only on the second Monday through Wednesday of each month',monthRules([2],[1,2,3]),{id:'calendar-second-span',selectAll:true}],
  ['allowedOrdinalWeekdays','Only on the first Friday through Monday of every month',monthRules([1],[0,1,5,6]),{id:'calendar-wrap-span',selectAll:true}],
  ['allowedOrdinalWeekdays','Do not schedule it outside the last week of every month',monthRules([-1],[0,1,2,3,4,5,6]),{id:'calendar-outside-last-week',selectAll:true}],
  ['allowedWeekdays','Tuesday plus Thursday',[2,4],{id:'weekday-plus',selectAll:true}],
  ['allowedWeekdays','Tuesdays and Thursdays are the only days I can do it',[2,4],{id:'weekday-sentence',selectAll:true}],
  ['preferredWeekdays','My preferred days are Monday and Wednesday',[1,3],{id:'weekday-preferred-sentence',selectAll:true,record:{allowedWeekdays:[],preferredWeekdays:[1,3]}}],
  ['appointmentWeekdays','Tuesday plus Thursday',[2,4],{id:'weekday-event-plus',kind:'event',selectAll:true}],
  ['reminderStart','Change start reminders to alarm mode','alarm',{id:'reminder-alarm-mode',native:true,selectAll:true}],
  ['tapStartsSession','Tapping this card should begin a session instead of checking it off',true,{id:'tap-instead-of-checkoff',selectAll:true}],
  ['reminderDnd','Stop silencing my phone during this session',false,{id:'dnd-stop-silencing',native:true,reminderSeed:{dnd:true},record:{type:'keepup'},selectAll:true}]
].map(([field,prompt,value,opts={}],index)=>({id:`${field}-${index+1}`,field,prompt,value,kind:'habit',...opts}));
const guards=[
  {field:'hardDue',kind:'task',prompt:'Make the deadline strict and flexible',id:'everyday-deadline-conflict',selectAll:true},
  {field:'hardDue',kind:'task',prompt:'Do not make the deadline strict',id:'everyday-deadline-negation',selectAll:true},
  ...["Don't convert this habit to a task",'Do not make this a habit or task'].map((prompt,i)=>({field:'kind',kind:'habit',prompt,id:`minimal-kind-guard-${i}`,selectAll:true})),
  ...["Don't stop this habit",'Do not limit this habit'].map((prompt,i)=>({field:'habitKind',kind:'habit',prompt,id:`minimal-mode-guard-${i}`,selectAll:true})),
  ...['All days except all days','Monday except Monday','Weekdays except Blursday','Monday to Blursday','Not only Monday','Clear weekdays except Monday'].map((prompt,i)=>({field:'allowedWeekdays',kind:'habit',prompt,id:`minimal-days-guard-${i}`,seed:{allowedWeekdays:[1,3]},selectAll:true})),
  {field:'allowedMonthDays',kind:'habit',prompt:'Allow month days -1 and 15',id:'month-signed-day',seed:{allowedMonthDays:[10]},selectAll:true},
  {field:'anywhereAllowed',kind:'habit',prompt:'Allow anywhere and only at saved places',id:'everyday-anywhere-conflict',selectAll:true},
  {field:'anywhereAllowed',kind:'habit',prompt:'Allow anywhere except Home',id:'everyday-anywhere-exclusion',selectAll:true},
  {field:'dueDate',kind:'task',prompt:'Set due date to 31 November 2026',id:'everyday-invalid-day-first',selectAll:true},
  ...['Set priority to high','Make this event urgent'].map((prompt,i)=>({field:'priority',kind:'event',prompt,id:`basics-event-priority-guard-${i}`,selectAll:true})),
  {field:'dueTime',kind:'task',prompt:'Set start time to 1860 hours',id:'basics-clock-invalid-military'},
  {field:'dueDate',kind:'task',prompt:'Set due date to November thirty-first',id:'basics-date-invalid-spoken'},
  {field:'allowedWeekdays',kind:'habit',prompt:'Clear weekdays except Monday',seed:{allowedWeekdays:[1,3]},id:'basics-clear-partial-guard',selectAll:true},
  {field:'allowedTimeFixedStart',kind:'task',prompt:'Make the start time exact and flexible',id:'basics-fixed-conflict-guard',selectAll:true},
  ...[
    ['timerAutoStopMinutes',"Don't auto-stop the timer at 30 minutes"],
    ['minGapMinutes','Not a 20 minute gap between sessions'],
    ['weatherRules','Not warmer than eighty degrees'],
    ['weatherRules','Skip it when the temperature is over eighty degrees'],
    ['sharedDisplay','Do not make it visible on the shared display']
  ].map(([field,prompt],i)=>({field,prompt,kind:'habit',id:`robust-negative-${i}`,selectAll:true})),
  {field:'priority',kind:'habit',prompt:'Priority 12'},
  {field:'priority',kind:'habit',prompt:'Not high priority'},
  {field:'frequency',kind:'habit',prompt:'Minus 2 times per week'},
  {field:'allowedWindow',kind:'habit',prompt:'Allowed time is 15 minutes after Sunset walk'},
  ...['after sunset to','after sunset until sometime','from sunset to 99pm'].map(prompt=>({field:'allowedWindow',kind:'habit',prompt,seed:{allowedTimeStartAnchor:'maghrib',allowedTimeStartOffsetMin:30,allowedTimeEndAnchor:'isha',allowedTimeEndOffsetMin:0}})),
  {field:'name',kind:'habit',prompt:'Do not rename it Tomorrow'},
  {field:'topics',kind:'habit',prompt:"Don't tag it Work"},
  ...['Not tomorrow instead','Tomorrow or Friday please','After tomorrow instead'].map(prompt=>({field:'dueDate',kind:'task',prompt})),
  ...['tomorrowland','tonightly','onward'].map(value=>({field:'dueDate',kind:'task',prompt:`Set due date to ${value}`})),
  {field:'dueDate',kind:'task',prompt:'Set due date to 2027-02-30'},
  {field:'dueDate',kind:'task',prompt:'Change plan by to 2/30/2027'},
  {field:'planByDate',kind:'habit',prompt:'Plan by the first week of 2027'},
  {field:'earlyWindowDays',kind:'habit',prompt:'Allow 3 or 5 days early'},
  {field:'conditionRadiusM',kind:'habit',prompt:'Set radius to -300 meters',seed:{repeatMode:'opportunity'}},
  {field:'durationMinutes',kind:'habit',prompt:'Use the duration I mentioned earlier',historySteps:['Make it 40 minutes long','Make it 60 minutes long']},
  ...['every zero days','every -3 days','every 184 days','every third Monday','every three or four days','every 2.5 days','every three days and every five days'].map(phrase=>({field:'frequency',kind:'habit',prompt:`Repeat ${phrase}`})),
  {field:'allowedMonthDays',kind:'habit',prompt:'Allow month days 1 and 32'},
  {field:'allowedOrdinalWeekdays',kind:'habit',prompt:'Only on the sixth Friday of every month'},
  {field:'allowedMonthDays',kind:'habit',prompt:'Only on the last day of every month',id:'calendar-guard-last-day',selectAll:true},
  {field:'allowedMonthDays',kind:'habit',prompt:'Only on the last three days of the month',id:'calendar-guard-last-days',selectAll:true},
  {field:'allowedOrdinalWeekdays',kind:'habit',prompt:'Only on the second to last Friday of every month',id:'calendar-guard-penultimate',selectAll:true},
  {field:'allowedOrdinalWeekdays',kind:'habit',prompt:'Every day except the last week of every month',id:'calendar-guard-except-last-week',selectAll:true},
  {field:'allowedOrdinalWeekdays',kind:'habit',prompt:'Only on the first weekday of every month',id:'calendar-guard-first-weekday',selectAll:true},
  {field:'allowedMonthDays',kind:'habit',prompt:'Only from the 5th to the 1st of the month',id:'calendar-guard-backwards',selectAll:true},
  {field:'earlyWindowDays',kind:'habit',prompt:'Allow a day and a half early'},
  {field:'reminderStartLead',kind:'event',prompt:'Remind me two hours before start',native:true},
  {field:'conditionRadiusM',kind:'habit',prompt:'Set radius to 300 feet',seed:{repeatMode:'opportunity'}},
  {field:'durationMinutes',kind:'habit',prompt:'Make it -30 minutes long'},
  {field:'durationMinutes',kind:'habit',prompt:'Make it thirteen hours long'},
  {field:'durationMinutes',kind:'habit',prompt:'Make it twelve and a half hours long'},
  {field:'durationMinutes',kind:'habit',prompt:'Make it one and a half hours or two hours long'},
  {field:'durationMinutes',kind:'habit',prompt:'Make it -one and a half hours long'},
  {field:'timerAutoStopMinutes',kind:'habit',prompt:'Stop timer after -30 minutes'},
  {field:'autoMarkMinutes',kind:'habit',prompt:'Automatically mark done after 5 or 15 minutes'},
  {field:'autoMarkMinutes',kind:'habit',prompt:'Automatically mark done'},
  {field:'durationMinutes',kind:'habit',prompt:'Set duration to three times a week'},
  {field:'frequency',kind:'habit',prompt:'Set frequency to 30 minutes'},
  {field:'minGapMinutes',kind:'habit',prompt:'Set minimum gap to three times a week'},
  {field:'timerAutoStopMinutes',kind:'habit',prompt:'Set timer target to three times a week'},
  {field:'emoji',kind:'habit',prompt:'Use a friendly emoji'},
  ...['Give me a 20 minute heads-up before leaving','Departure lead time 20 min'].map(prompt=>({field:'reminderTravelLead',kind:'habit',prompt,native:true,selectAll:true}))
].map((row,index)=>({...row,id:row.id||`guard-${row.field}-${index+1}`}));
let passed=0;
function assert(ok,msg){if(!ok)throw Error(msg);passed++;console.log(`  ok: ${msg}`);}
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  const live=Boolean(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH);
  const report=process.env.FIELD_REPORT||`test-results/needle-field-coverage-${live?'live':'scripted'}.json`;
  const results=[],failures=[],errors=[];
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York'});
    page.on('pageerror',e=>errors.push(e.message));
    if(live)await page.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async isLive=>{
      if(isLive){patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});await assistantNeedleDownload();}
      window.coverageOptions=test=>isLive?{}:{rank:async()=>({rankings:[]}),extract:async spec=>{
        let args={};
        if(spec.family==='families')args={evidence:'',outside:''};
        else if(spec.family==='completeness')args={missing:''};
        else if(spec.family==='reference')args={field:spec.tool.parameters.properties.field.enum[0]};
        else{const key=Object.keys(spec.tool.parameters.properties)[0],choices=spec.tool.parameters.properties[key].enum||[];args={[key]:test.selectAll||spec.jobId===test.field||Object.hasOwn(test.extra||{},spec.jobId)?(choices.includes(test.reuse)?test.reuse:choices[0]):''};}
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }};
      window.coverageSeed=test=>{
        window.TingsNative={isNative:Boolean(test.native),quiet:{status:async()=>({granted:true})},notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
        window.reconcileNativeQuiet=async()=>{};window.reconcileNativeReminders=async()=>{};window.reconcileNativeRemindersNow=async()=>{};window.refreshOpenViews=()=>{};
        localStorage.removeItem(ASSISTANT_FOCUS_REMINDER_KEY);
        if(test.reminderSeed)localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY,JSON.stringify({version:4,enabled:true,items:{'item:target':test.reminderSeed}}));
        saveSortSettings({...loadSortSettings(),locations:[{id:'home',name:'Home',lat:40,lng:-74}],weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation',max:1}]}]});
        const row={hid:'target',name:'Apply premium',type:test.kind==='task'?'task':'keepup',target:7,durationMinutes:30,logs:[{ts:1}],priority:2,earlyWindowDays:0,delayAllowanceDays:0,
          ...(test.kind==='task'?{dueDate:new Date('2026-10-17T00:00:00-04:00').getTime(),eventTime:new Date('2026-10-17T09:00:00-04:00').getTime()}:{}),
          ...(test.kind==='event'?{appointment:{repeat:'weekly',startDate:'2026-11-02',startMinute:540,weekdays:[1],until:'',exceptions:test.exception?{'2026-11-09':test.exception}:{}}}:{}),...test.seed};
        save([row,{hid:'meeting',name:'Meeting',type:'keepup',target:7,durationMinutes:30,logs:[]}]);
        const s=assistantFocusOpen({operation:'edit',kind:test.kind,targetId:'target',occurrenceDate:'2026-11-09',now:new Date('2026-11-01T12:00:00-05:00').getTime()});
        if(test.kind==='event')assistantFocusSetScope(s,test.scope||'series','2026-11-09');
        return s;
      };
    },live);
    const coverage=await page.evaluate(rows=>{
      const covered=new Set(rows.flatMap(r=>r.covers||[r.field]));
      return ASSISTANT_FOCUS_FIELDS.filter(f=>!covered.has(f.id)).map(f=>f.id);
    },cases);
    assert(!coverage.length,`every registered field has a predefined language case (${coverage.join(', ')})`);
    const chosen=cases.filter(t=>!process.env.FIELD_CASE||new RegExp(process.env.FIELD_CASE).test(t.id));
    for(const test of chosen){
      const result=await page.evaluate(async test=>{
        const s=coverageSeed(test),before=JSON.stringify(load());
        const history=[];
        for(const step of test.historySteps||[]){
          const prompt=typeof step==='string'?step:step.prompt;
          await assistantFocusTurn(s,prompt,coverageOptions(test));
          assistantFocusApprove(s);
          history.push({prompt,ready:assistantFocusCanSave(s)===(typeof step==='string'||step.ready!==false),questions:assistantFocusClone(s.unresolved)});
        }
        const clarification=[];
        for(const prompt of test.prelude||[]){
          await assistantFocusTurn(s,prompt,coverageOptions(test));
          clarification.push({prompt,blocked:!assistantFocusCanSave(s),unchanged:JSON.stringify(assistantFocusMaterialize(s))===JSON.stringify(s.source),questions:assistantFocusClone(s.unresolved)});
        }
        await assistantFocusTurn(s,test.prompt,coverageOptions(test));
        const r=assistantFocusMaterialize(s),change=s.changes.find(c=>c.field===test.field);
        const expectedFields=Object.keys(test.extra||{}).concat(test.field==='frequency'?['timesPerPeriod']:test.field);
        const values={...test.extra,[test.field==='frequency'?'timesPerPeriod':test.field]:test.value};
        const matched=Object.entries(values).every(([field,value])=>value===null?s.changes.some(c=>c.field===field&&(!test.op||c.op===test.op)):s.changes.some(c=>c.field===field&&JSON.stringify(c.value)===JSON.stringify(value)));
        const recordOK=Object.entries(test.record||{}).every(([k,v])=>JSON.stringify(r[k]??null)===JSON.stringify(v));
        const advancedOK=(!test.rule||s.dependencies.weatherProfile?.rules?.some(rule=>rule.metric==='temperature_2m'&&rule.min===10))
          &&(test.ruleMin==null||s.dependencies.weatherProfile?.rules?.some(rule=>rule.metric==='temperature_2m'&&rule.min===test.ruleMin&&rule.hard===true))
          &&(!test.optionClocks||r.scheduleOptions?.length===1&&r.scheduleOptions[0].start===1080&&r.scheduleOptions[0].end===1200&&r.scheduleOptions[0].weekdays.join()==='1')
          &&(!test.orderSameDay||r.scheduleLinks?.every(link=>link.requireSameDay===true))
          &&(!test.option||r.scheduleOptions?.some(o=>o.start===1080&&o.end===1200&&o.locationId==='home'&&o.weekdays.join()==='1'))
          &&(!test.order||r.scheduleLinks?.some(o=>o.anchorHid==='meeting'&&o.adjacency==='direct'))
          &&(!test.link||r.links?.some(l=>l.value===test.link));
        const extras=s.changes.filter(c=>!expectedFields.includes(c.field));
        const unchanged=before===JSON.stringify(load());assistantFocusApprove(s);
        const ready=assistantFocusCanSave(s);let commit=null;
        if(matched&&recordOK&&advancedOK&&!extras.length&&ready)commit=await assistantFocusCommit(s);
        const saved=load().find(r=>r.hid==='target');
        const expectedSaved=normalize([r,...load().filter(row=>row.hid!==r.hid)]).find(row=>row.hid===r.hid);
        const persistedKeys=s.changes.filter(c=>!c.field.startsWith('reminder')).map(c=>assistantFocusField(c.field)?.persist).filter(Boolean);
        const persisted=commit?.ok&&JSON.stringify(r)===JSON.stringify(expectedSaved)&&JSON.stringify(saved.logs)===JSON.stringify(JSON.parse(before)[0].logs)
          &&persistedKeys.every(key=>JSON.stringify(saved[key])===JSON.stringify(expectedSaved[key]));
        const occurrenceOK=test.scope!=='occurrence'||(JSON.stringify(saved?.appointment?.exceptions['2026-11-09']||null)===JSON.stringify(r.appointment.exceptions['2026-11-09']||null)&&saved?.durationMinutes===30&&saved?.appointment.startMinute===540);
        const reminderKeys={reminderDnd:'dnd',reminderStart:'start',reminderEnd:'end',reminderTravelStart:'travelStart',reminderTravelEnd:'travelEnd',reminderMissed:'missed',reminderTravelLead:'travelLeadMinutes',reminderStartLead:'startLeadMinutes',reminderMissedLead:'missedLeadMinutes'};
        const reminders=JSON.parse(localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)||'null')?.items?.['item:target'];
        const remindersOK=!test.native||(test.field==='reminderReset'
          ?reminders&&Object.values(reminderKeys).filter(key=>key!=='dnd').every(key=>!Object.hasOwn(reminders,key))&&JSON.stringify(reminders.dates)===JSON.stringify(test.reminderSeed.dates)
          :reminders?.[reminderKeys[test.field]]===test.value);
        return {matched,recordOK,advancedOK,extras,unchanged,ready,commit,persisted,occurrenceOK,reminders,remindersOK,clarification,history,changes:s.changes,unresolved:s.unresolved,pending:s.pendingFamilies,record:r,saved,trace:s.trace,jobs:s.jobs.map(j=>({id:j.id,status:j.status,spans:j.spans,error:j.error}))};
      },test);
      results.push({...test,...result});fs.writeFileSync(report,JSON.stringify(results,null,2));
      const ok=result.matched&&result.recordOK&&result.advancedOK&&!result.extras.length&&result.unchanged&&result.ready&&result.persisted&&result.occurrenceOK&&result.remindersOK&&!result.unresolved.length&&!result.pending.length&&result.history.every(row=>row.ready)&&result.clarification.every(r=>r.blocked&&r.unchanged&&r.questions.some(q=>q.field===test.field||(test.field==='frequency'&&q.field==='timesPerPeriod')));
      if(ok)assert(true,`${live?'live Needle':'host'}: ${test.id}`);
      else{failures.push(test.id);console.error(`  FAIL ${test.id}: ${JSON.stringify({matched:result.matched,record:result.recordOK,advanced:result.advancedOK,extras:result.extras,ready:result.ready,commit:result.commit,changes:result.changes,questions:result.unresolved})}`);}
    }
    for(const test of guards.filter(t=>!process.env.FIELD_CASE||new RegExp(process.env.FIELD_CASE).test(t.id))){
      const result=await page.evaluate(async test=>{
        const s=coverageSeed(test),before=JSON.stringify(load());
        for(const prompt of test.historySteps||[])await assistantFocusTurn(s,prompt,coverageOptions(test));
        const kept=JSON.stringify(assistantFocusMaterialize(s));
        await assistantFocusTurn(s,test.prompt,coverageOptions(test));
        return {blocked:!assistantFocusCanSave(s),kept:kept===JSON.stringify(assistantFocusMaterialize(s)),unchanged:before===JSON.stringify(load()),questions:s.unresolved,changes:s.changes,trace:s.trace};
      },test);
      results.push({...test,...result});fs.writeFileSync(report,JSON.stringify(results,null,2));
      if(result.blocked&&result.kept&&result.unchanged&&result.questions.some(q=>q.field===test.field||(test.field==='frequency'&&q.field==='timesPerPeriod')))assert(true,`${live?'live Needle':'host'}: ${test.id} asks without changing values`);
      else{failures.push(test.id);console.error(`  FAIL ${test.id}: ${JSON.stringify(result)}`);}
    }
    assert(!errors.length,`no page errors (${errors.join('; ')})`);
    assert(!failures.length,`${chosen.length} language cases; failures: ${failures.join(', ')}`);
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
