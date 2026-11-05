// Field-by-field language coverage. Live mode uses unmodified pinned Needle WASM.
// Scripted mode selects only intended evidence; it checks host normalization,
// applicability, persistence and recovery, not model language accuracy.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const fs=require('fs');
const day=s=>new Date(`${s}T00:00:00-05:00`).getTime();
const cases=[
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
  ...["Let's plan for tomorrow",'Plan this for tomorrow','Set due date to tomorrow','Move the due date to tonight'].map((prompt,index)=>
    ['dueDate',prompt,index===3?new Date('2026-11-01T00:00:00-04:00').getTime():day('2026-11-02'),{id:`language-date-prefix-${index+1}`,kind:'task',seed:{hardDue:true},record:{name:'Apply premium',durationMinutes:30,hardDue:true,eventTime:new Date(`${index===3?'2026-11-01':'2026-11-02'}T09:00:00-05:00`).getTime()}}]),
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
  ['allowedTimeFixedStart','Use a fixed start time',true],
  ['preferredWeekdays','Prefer Monday and Wednesday',[1,3]],
  ['preferredMonthDays','Prefer month days 1 and 15',[1,15]],
  ['preferredOrdinalWeekdays','Prefer the second Tuesday of each month',[{ordinal:2,weekday:2}]],
  ['preferredWindow','Prefer before sunset',null,{record:{preferredTimeEndAnchor:'maghrib',allowedTimeEndAnchor:null}}],
  ['durationMinutes','Make it 40 minutes long',40],
  ['breakable','Allow splitting into chunks',true],
  ['minChunkMinutes','Set minimum chunk to 15 minutes',15,{seed:{breakable:true}}],
  ['minGapMinutes','Set a 20 minute gap between sessions',20],
  ['timerAutoStopMinutes','Stop timer automatically after 30 minutes',30],
  ['autoMarkMinutes','Automatically mark done after 5 minutes',5],
  ['trackValue','Track a value',true],
  ['places','Set place to Home',['home']],['anywhereAllowed','Allow anywhere',true,{seed:{anywhereAllowed:false}}],
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
  ...["Let's do this tomorrow",'Tomorrow instead, please','Can we plan it for tomorrow?','Due tomorrow please','Tomorrow  instead'].map((prompt,index)=>
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
  ['dueDate','Actually Friday instead',day('2026-11-06'),{id:'basics-date-followup',kind:'task',historySteps:['Plan this for tomorrow']}],
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
  ['dueDate','Plan this for the day after tomorrow',day('2026-11-03'),{id:'basics-date-relative-day',kind:'task'}],
  ['dueDate','Actually Friday instead, pin it',day('2026-11-06'),{id:'basics-date-followup-sibling',kind:'task',extra:{pinned:true},historySteps:['Plan this for tomorrow']}],
  ['dueDate','Clear the due date',null,{id:'basics-clear-date',kind:'task',op:'clear',record:{dueDate:null,eventTime:null}}],
  ['dueTime','Clear the start time',null,{id:'basics-clear-clock',kind:'task',op:'clear',record:{eventTime:null}}],
  ['allowedWeekdays','Clear allowed weekdays',null,{id:'basics-clear-weekdays',op:'clear',seed:{allowedWeekdays:[1,2]},record:{allowedWeekdays:[]}}],
  ['allowedWindow','Clear allowed hours',null,{id:'basics-clear-window',op:'clear',seed:{allowedTimeStart:540,allowedTimeEnd:1020},record:{allowedTimeStart:null,allowedTimeEnd:null}}],
  ['topics','Clear topics',null,{id:'basics-clear-topics',op:'clear',seed:{topics:['Work']},record:{topics:[]}}],
  ['places','Clear places',null,{id:'basics-clear-places',op:'clear',seed:{locationIds:['home']},record:{locationIds:[]}}],
  ['weatherProfile','Clear weather profile',null,{id:'basics-clear-weather',op:'clear',seed:{weatherProfileMode:'profile',weatherProfileId:'dry'},record:{weatherProfileId:null,weatherProfileMode:'none'}}],
  ['links','Clear links',null,{id:'basics-clear-links',op:'clear',seed:{links:[{id:'guide',type:'url',label:'Guide',value:'https://example.com'}]},record:{links:[]}}],
  ['topics','Tag it Clear',['Clear'],{id:'basics-topic-clear-word'}],
  ['pinned','Pin it instead',true,{id:'basics-explicit-setting-followup',kind:'task',extra:{dueDate:day('2026-11-02')},historySteps:['Plan this for tomorrow']}]
].map(([field,prompt,value,opts={}],index)=>({id:`${field}-${index+1}`,field,prompt,value,kind:'habit',...opts}));
const guards=[
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
  {field:'allowedOrdinalWeekdays',kind:'habit',prompt:'Only on the first or third Monday of each month'},
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
  {field:'timerAutoStopMinutes',kind:'habit',prompt:'Set timer target to three times a week'}
].map((row,index)=>({...row,id:`guard-${row.field}-${index+1}`}));
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
        else{const key=Object.keys(spec.tool.parameters.properties)[0],choices=spec.tool.parameters.properties[key].enum||[];args={[key]:spec.jobId===test.field||Object.hasOwn(test.extra||{},spec.jobId)?(choices.includes(test.reuse)?test.reuse:choices[0]):''};}
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }};
      window.coverageSeed=test=>{
        window.TingsNative={isNative:Boolean(test.native),notifications:{permissions:async()=>({display:'granted'}),exactAlarmPermission:async()=>({exact_alarm:'granted'})}};
        window.reconcileNativeReminders=async()=>{};window.reconcileNativeRemindersNow=async()=>{};window.refreshOpenViews=()=>{};
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
        const persisted=commit?.ok&&JSON.stringify(saved.logs)===JSON.stringify(JSON.parse(before)[0].logs)
          &&persistedKeys.every(key=>JSON.stringify(saved[key])===JSON.stringify(expectedSaved[key]));
        const occurrenceOK=test.scope!=='occurrence'||(JSON.stringify(saved?.appointment?.exceptions['2026-11-09']||null)===JSON.stringify(r.appointment.exceptions['2026-11-09']||null)&&saved?.durationMinutes===30&&saved?.appointment.startMinute===540);
        const reminderKeys={reminderStart:'start',reminderEnd:'end',reminderTravelStart:'travelStart',reminderTravelEnd:'travelEnd',reminderMissed:'missed',reminderTravelLead:'travelLeadMinutes',reminderStartLead:'startLeadMinutes',reminderMissedLead:'missedLeadMinutes'};
        const reminders=JSON.parse(localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)||'null')?.items?.['item:target'];
        const remindersOK=!test.native||(test.field==='reminderReset'
          ?reminders&&Object.values(reminderKeys).every(key=>!Object.hasOwn(reminders,key))&&JSON.stringify(reminders.dates)===JSON.stringify(test.reminderSeed.dates)
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
