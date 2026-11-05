// Semantic field scheduler tests. Scripted adapters exercise failures and trust
// boundaries; optional pinned assets exercise actual Needle inference separately.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
const fs=require('fs');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log(`  ok: ${message}`);}
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  try{
    const page=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York',viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(()=>{
      window.fieldTest={
        seed(){save([{hid:'gym',name:'Gym',type:'keepup',target:7,durationMinutes:45,priority:2,emoji:'🏋️',logs:[{ts:1}],topics:['Original'],pinned:false,breakable:false}]);},
        open(operation='edit',kind='habit'){return assistantFocusOpen({operation,kind,targetId:operation==='edit'?'gym':null,now:new Date('2026-11-01T12:00:00-05:00').getTime()});},
        reply(spec){
          if(spec.family==='families')return {confidence:0.95,function_calls:[{arguments:{evidence:'',outside:''}}]};
          if(spec.family==='completeness')return {confidence:0.95,function_calls:[{arguments:{missing:''}}]};
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          return {confidence:0.95,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
        },
        options(extra={}){return {extract:async spec=>fieldTest.reply(spec),rank:async()=>({rankings:[]}),...extra};}
      };
    });
    const compound=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open('create');let active=0,max=0;const completed=[];
      const extract=async spec=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,spec.jobId==='name'?20:2));active--;completed.push(spec.jobId||spec.family);return t.reply(spec);};
      const before=JSON.stringify(load());await assistantFocusTurn(s,'Create a habit called Walk, every other day for 30 minutes, weekdays only before sunset. Set priority P1, pin it, use the 🚶 emoji and tag it Health.',t.options({extract}));
      const r=assistantFocusMaterialize(s),parts=rhythmParts(r.target);
      return {r,parts,max,completed,unresolved:s.unresolved,pending:s.pendingFamilies,unchanged:before===JSON.stringify(load()),oneTool:s.trace.filter(x=>x.jobId).every(x=>x.calls.length===1)};
    });
    const opening=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();let html='';
      await assistantFocusTurn(s,'Make this 30 minutes',t.options({onProgress(){if(!html)html=assistantFocusReviewHtml(s);}}));
      return html.includes('focus-progress')&&html.includes('Reading')&&!html.includes('data-focus-choice="resume"');
    });
    assert(opening,'the first progress paint shows the meter instead of Continue');
    const editScope=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();
      const seen=[];
      await assistantFocusTurn(s,'Pin it.',t.options({extract:async spec=>{seen.push(spec);return t.reply(spec);}}));
      const jobs=seen.filter(spec=>spec.jobId);
      const isolated=jobs.length===1&&jobs[0].jobId==='pinned'&&jobs[0].system.includes('Edit only Gym.')&&jobs[0].system.includes('Read only Pinned:');
      const task={...load()[0],type:'task',dueDate:new Date('2026-10-17T00:00:00-04:00').getTime()};save([task]);
      const date=t.open('edit','task'),before=JSON.stringify(load());
      await assistantFocusTurn(date,"Let's plan for tomorrow",t.options({rank:async()=>({rankings:[['weatherLocationId','links','topics','reminderTravelLead'].map(id=>({id,score:1}))]})}));
      return isolated&&assistantFocusMaterialize(date).name==='Gym'&&date.changes.length===1&&date.changes[0].field==='dueDate'
        &&!date.unresolved.length&&before===JSON.stringify(load());
    });
    assert(editScope,'Edit reads nominated settings with the focused identity; unrelated retrieval guesses cannot add sibling changes');
    const assignmentOwnership=await page.evaluate(async()=>{
      const t=fieldTest;
      for(const [request,field,correction,value] of [
        ['Set duration to three times a week','durationMinutes','Set duration to 20 minutes',20],
        ['Set frequency to 30 minutes','timesPerPeriod','Set frequency to three times a week',3],
        ['Set minimum gap to three times a week','minGapMinutes','Set minimum gap to 15 minutes',15],
        ['Set timer target to three times a week','timerAutoStopMinutes','Set timer target to 25 minutes',25]
      ]){
        t.seed();const s=t.open(),before=JSON.stringify(load()),baseline=JSON.stringify(assistantFocusMaterialize(s));
        await assistantFocusTurn(s,request,t.options());
        if(assistantFocusCanSave(s)||JSON.stringify(assistantFocusMaterialize(s))!==baseline||!s.unresolved.some(q=>q.field===field))return {request,changes:s.changes,questions:s.unresolved};
        await assistantFocusTurn(s,correction,t.options());
        if(!assistantFocusCanSave(s)||s.changes.some(c=>c.field!==field && !(field==='timesPerPeriod'&&c.field==='periodDays'))||s.changes.find(c=>c.field===field)?.value!==value||before!==JSON.stringify(load()))return {request,correction,changes:s.changes,questions:s.unresolved};
      }
      return true;
    });
    assert(assignmentOwnership===true,`incompatible values stay with their named field; corrections cannot retain an unintended sibling patch (${JSON.stringify(assignmentOwnership)})`);
    const adjacentFields=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();save([{...load()[0],type:'task',dueDate:new Date('2026-11-02T00:00:00-05:00').getTime()}]);const s=t.open('edit','task');
      await assistantFocusTurn(s,'Set duration to 20 minutes at 6pm',t.options());const r=assistantFocusMaterialize(s);
      return assistantFocusCanSave(s)&&r.durationMinutes===20&&new Date(r.eventTime).getHours()===18&&s.changes.length===2;
    });
    assert(adjacentFields,'a complete assigned quantity leaves a following clock available without requiring a conjunction');
    const clockBoundaries=await page.evaluate(async()=>{
      const t=fieldTest,results=[];
      for(const [kind,prompt,minute,duration] of [
        ['task','Go to park today at 12 pm and this will be for one and a half hours',720,90],
        ['task','Go to park today at 12 pm and stay for 90 minutes',720,90],
        ['event','Create an event called Park, today at 2 pm and this will be for 45 minutes',840,45]
      ]){
        t.seed();const s=t.open('create',kind),before=JSON.stringify(load());
        await assistantFocusTurn(s,prompt,t.options());const r=assistantFocusMaterialize(s);
        const time=kind==='task'?new Date(r.eventTime).getHours()*60+new Date(r.eventTime).getMinutes():r.appointment?.startMinute;
        const allowed=new Set(['name','dueDate','dueTime','durationMinutes','appointmentStartDate','appointmentStartMinute','appointmentRepeat']);
        const ready=assistantFocusCanSave(s),untouched=before===JSON.stringify(load());
        const unwanted=s.changes.filter(c=>!allowed.has(c.field));
        const saved=ready&&!unwanted.length?await assistantFocusCommit(s):null;
        results.push({kind,time,duration:r.durationMinutes,ready,untouched,unwanted,questions:s.unresolved,saved:saved?.ok,expected:time===minute&&r.durationMinutes===duration});
      }
      return results;
    });
    assert(clockBoundaries.every(r=>r.expected&&r.ready&&r.untouched&&!r.unwanted.length&&r.saved),`clock and duration evidence stay separate through confirmed create (${JSON.stringify(clockBoundaries)})`);
    const competingClocks=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();save([{...load()[0],type:'task'}]);const s=t.open('edit','task');
      await assistantFocusTurn(s,'Start at 12 pm or 1 pm for 90 minutes',t.options());
      return !assistantFocusCanSave(s)&&!s.changes.some(c=>c.field==='dueTime')&&s.unresolved.some(q=>q.field==='dueTime');
    });
    assert(competingClocks,'bounding clock evidence never drops a competing time to manufacture a valid scalar');
    const missingClockDate=await page.evaluate(async()=>{
      const t=fieldTest,results=[];
      for(const operation of ['create','edit']){
        t.seed();save([{...load()[0],type:'task',dueDate:null,eventTime:null}]);const s=t.open(operation,'task');
        const before=JSON.stringify(load());
        await assistantFocusTurn(s,operation==='create'?'Call mom at 10am':'Start at 10am',t.options());
        const blocked=!assistantFocusCanSave(s)&&s.unresolved.some(q=>q.field==='dueDate')&&!(await assistantFocusCommit(s)).ok;
        await assistantFocusTurn(s,'Tomorrow',t.options());const r=assistantFocusMaterialize(s);
        const ready=assistantFocusCanSave(s),time=new Date(r.eventTime);
        results.push(blocked&&ready&&time.getHours()===10&&time.getMinutes()===0&&before===JSON.stringify(load())&&(await assistantFocusCommit(s)).ok);
      }
      return results.every(Boolean);
    });
    assert(missingClockDate,'create and edit ask for the missing date instead of saving a clock proposal that cannot persist');
    const continuedCreate=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open('create','task');
      await assistantFocusTurn(s,'Call mom tomorrow at 10am for 20 minutes',t.options());
      const first=await assistantFocusCommit(s),repeated=await assistantFocusCommit(s);
      if(!first.ok||!repeated.idempotent)return {first,repeated};
      const data=load(),created=data.find(row=>row.hid===first.hid);
      created.logs=[{ts:Date.now()-1000}];created.priority=0;save(data);
      await assistantFocusTurn(s,'Make it 30 minutes long',t.options());
      const preview=assistantFocusMaterialize(s),second=await assistantFocusCommit(s),after=load();
      return second.ok&&s.operation==='edit'&&preview.hid===first.hid&&after.length===2&&after.filter(r=>r.hid===first.hid).length===1
        &&after.find(r=>r.hid===first.hid).durationMinutes===30&&after.find(r=>r.hid===first.hid).priority===0&&after.find(r=>r.hid===first.hid).logs.length===1
        &&after.find(r=>r.hid==='gym').durationMinutes===45;
    });
    assert(continuedCreate===true,`a follow-up after creating an item edits that same saved identity and preserves later logs (${JSON.stringify(continuedCreate)})`);
    const referenceDecision=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();save([{...load()[0],type:'task'}]);const s=t.open('edit','task');
      await assistantFocusTurn(s,'Plan this for tomorrow',t.options());
      const before=JSON.stringify(assistantFocusMaterialize(s));
      await assistantFocusTurn(s,'Actually Friday instead',t.options({extract:async spec=>spec.family==='reference'
        ?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{field:'Another setting'}}]}:t.reply(spec)}));
      return !assistantFocusCanSave(s)&&s.unresolved.some(issue=>issue.field==='request')
        &&JSON.stringify(assistantFocusMaterialize(s))===before&&!s.changes.some(change=>change.field==='allowedWeekdays');
    });
    assert(referenceDecision,'a declined model reference decision asks for scope without a parser fallback or a sibling edit');
    assert(compound.r.name==='Walk'&&compound.parts.times===1&&compound.parts.days===2&&compound.r.durationMinutes===30&&compound.r.allowedTimeEndAnchor==='maghrib'
      &&compound.r.allowedWeekdays.join()==='1,2,3,4,5'&&compound.r.priority===1&&compound.r.pinned&&compound.r.emoji==='🚶'&&compound.r.topics.join()==='Health'
      &&!compound.unresolved.length&&!compound.pending.length&&compound.unchanged&&compound.max===3&&compound.oneTool,'one shared pipeline fills a complex draft, uses one tool per job and caps active work at three');
    const createDefaults=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const settings=loadSortSettings();
      try{
        saveSortSettings({...settings,defaultTarget:2,defaultDurationMinutes:35,taskDefaults:{...settings.taskDefaults,durationMinutes:20}});
        const habit=t.open('create'),task=t.open('create','task');
        const form=assistantFocusOpen({operation:'create',kind:'habit',addForm:{record:{target:3,durationMinutes:50}}});
        const invalidForm=assistantFocusOpen({operation:'create',kind:'habit',addForm:{record:{target:null,durationMinutes:null}}});
        saveSortSettings({...loadSortSettings(),defaultTarget:7,defaultDurationMinutes:90});
        await assistantFocusTurn(habit,'Walk',t.options());
        await assistantFocusTurn(task,'Call mom',t.options());
        await assistantFocusTurn(form,'Read',t.options());
        await assistantFocusTurn(invalidForm,'Stretch',t.options());
        const h=assistantFocusMaterialize(habit),f=assistantFocusMaterialize(form),bad=assistantFocusMaterialize(invalidForm);
        const review=assistantFocusReviewModel(habit);
        const shown=['durationMinutes','timesPerPeriod','periodDays'].every(id=>review.rows.some(r=>r.id===id&&r.origin==='default'));
        const good=h.name==='Walk'&&h.durationMinutes===35&&h.target===2&&assistantFocusCanSave(habit)&&shown
          &&assistantFocusMaterialize(task).name==='Call mom'&&assistantFocusMaterialize(task).durationMinutes===20&&assistantFocusCanSave(task)
          &&f.target===3&&f.durationMinutes===50&&assistantFocusCanSave(form)
          &&bad.target===2&&bad.durationMinutes===35&&assistantFocusCanSave(invalidForm);
        const saved=await assistantFocusCommit(habit);
        return good&&saved.ok&&load().find(row=>row.hid===habit.draftId)?.durationMinutes===35;
      }finally{saveSortSettings(settings);}
    });
    assert(createDefaults,'name-only create uses stable kind-specific defaults, form values win, and essential defaults are reviewed and saved');
    const summaryCard=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();
      const create=t.open('create');
      await assistantFocusTurn(create,'Walk every other day before sunset',t.options());
      const createHtml=assistantFocusReviewHtml(create);
      const quiet=t.open('create');
      await assistantFocusTurn(quiet,'Walk',t.options());
      const quietHtml=assistantFocusReviewHtml(quiet);
      const formed=assistantFocusOpen({operation:'create',kind:'habit',addForm:{record:{
        type:'keepup',emoji:'🚶',priority:2,earlyWindowDays:1,delayAllowanceDays:0,breakable:false,
        minGapMinutes:0,locationIds:[],anywhereAllowed:true,weatherProfileMode:'inherit',showWeather:false,
        showWeatherAtLocation:false,allowSharedDisplayCompletion:true,durationMinutes:45,target:7
      }}});
      await assistantFocusTurn(formed,'Walk for 45 minutes every fourth day just after sunrise',t.options());
      const formedHtml=assistantFocusReviewHtml(formed);
      const edit=t.open();
      await assistantFocusTurn(edit,'Pin it.',t.options());
      const editHtml=assistantFocusReviewHtml(edit);
      const formNoise=/<small>add form<\/small>|<small>default<\/small>|Priority ·|Emoji ·|Shared display|Early allowance|Splitting ·|Minimum gap|Weather profile|Places ·/;
      return {
        create:createHtml.includes('assistant-preview-name')&&createHtml.includes('assistant-chip')&&createHtml.includes('Walk')&&createHtml.includes('1× / 2d')&&createHtml.includes('Allowed hours')&&createHtml.includes('Unmentioned settings')&&!formNoise.test(createHtml)&&!createHtml.includes('focus-rows')&&!createHtml.includes('focus-origin'),
        quiet:quietHtml.includes('Walk')&&!quietHtml.includes('assistant-chip')&&!formNoise.test(quietHtml)&&quietHtml.includes('Unmentioned settings'),
        formed:formedHtml.includes('Walk')&&formedHtml.includes('45 min')&&formedHtml.includes('1× / 4d')&&/sunrise/i.test(formedHtml)&&!formNoise.test(formedHtml),
        edit:editHtml.includes('45 min')&&/pinned/i.test(editHtml)&&!editHtml.includes('Shared display')&&!editHtml.includes('Links')&&!editHtml.includes('focus-rows')
      };
    });
    assert(summaryCard.create&&summaryCard.quiet&&summaryCard.formed&&summaryCard.edit,'the review lists what the request set; add-form defaults stay on the draft and off the summary');
    const essentialFailures=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open('create');
      await assistantFocusTurn(s,'Walk every other day for 40 minutes.',t.options({extract:async spec=>{
        if(['frequency','durationMinutes'].includes(spec.jobId)){
          const key=Object.keys(spec.tool.parameters.properties)[0];
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:''}}]};
        }return t.reply(spec);
      }}));
      const blocked=!assistantFocusCanSave(s)&&s.unresolved.some(r=>r.field==='timesPerPeriod')&&s.unresolved.some(r=>r.field==='durationMinutes');
      const missing=t.open('create');await assistantFocusTurn(missing,'30 minutes long.',t.options({extract:async spec=>{
        if(spec.jobId==='name')return {confidence:1,function_calls:[]};return t.reply(spec);
      }}));
      const edit=t.open();await assistantFocusTurn(edit,'Pin it.',t.options());const r=assistantFocusMaterialize(edit);
      return blocked&&!assistantFocusCanSave(missing)&&missing.unresolved.some(r=>r.field==='name')
        &&r.name==='Gym'&&r.durationMinutes===45&&r.target===7&&r.pinned&&assistantFocusCanSave(edit);
    });
    assert(essentialFailures,'explicit create extraction failures and missing names block Save; edit omission preserves existing essentials');
    const followupRecovery=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();
      await assistantFocusTurn(s,'Make it 40 minutes long.',t.options());
      await assistantFocusTurn(s,'Okay, something else.',t.options());
      const blocked=!assistantFocusCanSave(s)&&s.unresolved.some(row=>row.field==='request')&&assistantFocusMaterialize(s).durationMinutes===40&&load()[0].durationMinutes===45;
      await assistantFocusTurn(s,'Make it 60 minutes long.',t.options());
      const recovered=assistantFocusCanSave(s)&&!s.unresolved.length&&assistantFocusMaterialize(s).durationMinutes===60;
      const reference='Use the first duration I mentioned earlier';
      await assistantFocusTurn(s,reference,t.options({extract:async spec=>spec.family==='completeness'
        ?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{missing:`effort: ${reference}`}}]}:t.reply(spec)}));
      const referred=assistantFocusCanSave(s)&&assistantFocusMaterialize(s).durationMinutes===40&&!s.unresolved.length;
      const poisoned=t.open();
      await assistantFocusTurn(poisoned,'Make it 40 minutes long.',t.options({extract:async spec=>spec.jobId==='durationMinutes'
        ?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{duration:'keep the current duration'}}]}:t.reply(spec)}));
      const rejected=poisoned.unresolved.some(row=>row.field==='durationMinutes')&&assistantFocusMaterialize(poisoned).durationMinutes===45;
      await assistantFocusTurn(poisoned,'Keep the current duration.',t.options());
      const preserved=!poisoned.unresolved.length&&assistantFocusMaterialize(poisoned).durationMinutes===45;
      const rhythm=t.open();
      await assistantFocusTurn(rhythm,'Three times a week.',t.options({extract:async spec=>spec.jobId==='frequency'
        ?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{frequency:''}}]}:t.reply(spec)}));
      const asked=rhythm.unresolved.some(row=>row.field==='timesPerPeriod');
      await assistantFocusTurn(rhythm,'Use that pattern again.',t.options());
      return blocked&&recovered&&referred&&rejected&&preserved&&asked&&!rhythm.unresolved.length&&rhythmParts(assistantFocusMaterialize(rhythm).target).times===3;
    });
    assert(followupRecovery,'an unanswered follow-up blocks the existing draft, a correction recovers, and only grounded preservation clears a field question');
    const separation=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();
      await assistantFocusTurn(s,'60 minutes each, split into chunks of at least 15 minutes, with a gap of 30 minutes.',t.options());
      const r=assistantFocusMaterialize(s);return {r,unresolved:s.unresolved};
    });
    assert(separation.r.durationMinutes===60&&separation.r.breakable&&separation.r.minChunkMinutes===15&&separation.r.minGapMinutes===30&&!separation.unresolved.length,'session length, chunk length and gap never borrow each other’s values');
    const preferences=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'Three times a week for 30 minutes, weekdays only between 6pm and 9pm, preferably on Monday and Wednesday, preferably before sunset.',t.options());
      const r=assistantFocusMaterialize(s);return {r,unresolved:s.unresolved};
    });
    assert(preferences.r.allowedTimeStart===1080&&preferences.r.allowedTimeEnd===1260&&!preferences.r.allowedTimeEndAnchor&&preferences.r.preferredTimeEndAnchor==='maghrib'
      &&preferences.r.allowedWeekdays.join()==='1,2,3,4,5'&&preferences.r.preferredWeekdays.join()==='1,3'&&!preferences.unresolved.length,'hard restrictions and preferences retain separate weekdays and windows');
    const trust=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();
      await assistantFocusTurn(s,'Make it 30 minutes long, only before sunset.',t.options({extract:async spec=>spec.jobId==='durationMinutes'?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{duration:''}}]}:t.reply(spec)}));
      const omitted=assistantFocusMaterialize(s).durationMinutes===45&&s.unresolved.some(r=>r.field==='durationMinutes')&&!assistantFocusCanSave(s);
      const poisoned=t.open();await assistantFocusTurn(poisoned,'Do not pin it, 30 minutes long.',t.options({extract:async spec=>spec.jobId==='pinned'?{confidence:1,function_calls:[{name:spec.tool.name,arguments:{pinned:'pin'}}]}:t.reply(spec)}));
      return {omitted,poisoned:poisoned.changes.some(c=>c.field==='pinned'),blocked:!assistantFocusCanSave(poisoned),fields:poisoned.unresolved.map(r=>r.field)};
    });
    assert(trust.omitted&&!trust.poisoned&&trust.blocked&&trust.fields.includes('pinned'),'parsers never fill an omitted field, and shortened evidence cannot drop a negation');
    const negative=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'Do not pin it, do not split it, 30 minutes long.',t.options());const r=assistantFocusMaterialize(s);
      return !r.pinned&&!r.breakable&&r.durationMinutes===30&&!s.unresolved.length&&r.name==='Gym'&&r.emoji==='🏋️'&&r.topics.join()==='Original'&&r.logs.length===1;
    });
    assert(negative,'quoted negation is preserved and unrelated identity, topics and logs survive');
    const recovery=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open(),counts={};let fail=true;
      const extract=async spec=>{counts[spec.jobId||spec.family]=(counts[spec.jobId||spec.family]||0)+1;if(spec.jobId==='allowedWindow'&&fail){fail=false;throw new Error('Interrupted inference');}return t.reply(spec);};
      const opts=t.options({extract});await assistantFocusTurn(s,'30 minutes long, only before sunset.',opts);
      const partial=assistantFocusMaterialize(s).durationMinutes===30&&!assistantFocusCanSave(s)&&s.pendingFamilies.length>0;
      await assistantFocusTurn(s,'',{...opts,resume:true});const r=assistantFocusMaterialize(s);
      return partial&&r.durationMinutes===30&&r.allowedTimeEndAnchor==='maghrib'&&counts.durationMinutes===1&&counts.allowedWindow===2&&!s.pendingFamilies.length&&assistantFocusCanSave(s)&&load()[0].durationMinutes===45;
    });
    assert(recovery,'Continue retains completed fields and retries only interrupted work without saving');
    const stale=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();let release,entered;
      const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
      const extract=async spec=>{if(spec.jobId==='durationMinutes'&&spec.request.includes('30 minutes')){entered();await gate;}return t.reply(spec);};
      const first=assistantFocusTurn(s,'30 minutes long.',t.options({extract}));await ready;
      await assistantFocusTurn(s,'60 minutes long.',t.options({extract}));release();const old=await first;
      return old.cancelled&&assistantFocusMaterialize(s).durationMinutes===60;
    });
    assert(stale,'late replies cannot overwrite a newer field correction');
    const frozen=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();let once=true;const inputs=[];
      const extract=async spec=>{if(spec.jobId==='allowedWindow'){inputs.push(spec.request);if(once){once=false;throw new Error('Interrupted');}}return t.reply(spec);};
      await assistantFocusTurn(s,'30 minutes long, only before sunset.',t.options({extract}));
      await assistantFocusTurn(s,'60 minutes long.',t.options({extract}));const r=assistantFocusMaterialize(s);
      return r.durationMinutes===60&&r.allowedTimeEndAnchor==='maghrib'&&inputs.every(x=>x.includes('before sunset'))&&!s.pendingFamilies.length;
    });
    assert(frozen,'a follow-up retains unrelated unfinished jobs with their original source text');
    const compoundLength=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'one hour and 30 minutes long.',t.options());
      return assistantFocusMaterialize(s).durationMinutes===90&&!s.unresolved.length;
    });
    assert(compoundLength,'the existing joined hour-and-minute normalizer remains supported');
    const ambiguous=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'30 minutes or 60 minutes long.',t.options());
      return assistantFocusMaterialize(s).durationMinutes===45&&!assistantFocusCanSave(s)&&s.unresolved.some(r=>r.field==='durationMinutes');
    });
    assert(ambiguous,'conflicting lengths ask for clarification instead of choosing the first number');
    const suffix=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'30 minutes with a 20 minute gap.',t.options());const r=assistantFocusMaterialize(s);
      return r.durationMinutes===30&&r.minGapMinutes===20&&!s.unresolved.length;
    });
    assert(suffix,'retrieval keeps a number before its field label attached to that setting');
    const negativeWindow=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'Not before sunset, not every day.',t.options());const r=assistantFocusMaterialize(s);
      return !r.allowedTimeEndAnchor&&rhythmParts(r.target).days===7&&!assistantFocusCanSave(s)&&s.unresolved.length>=2;
    });
    assert(negativeWindow,'unsupported negated windows and frequencies stay unresolved instead of reversing their meaning');
    const controls=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();await assistantFocusTurn(s,'Make it a habit, build this habit, use opportunity recurrence, trigger location, radius 300 meters.',t.options());
      const r=assistantFocusMaterialize(s);return {r,pending:s.pendingFamilies,unresolved:s.unresolved};
    });
    assert(controls.r.repeatMode==='opportunity'&&controls.r.conditionTrigger==='location'&&controls.r.conditionRadiusM===300&&!controls.pending.length&&!controls.unresolved.length,'kind, habit mode and recurrence dependencies form a finite ordered graph');
    const collisions=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();saveSortSettings({...loadSortSettings(),weatherProfiles:[{id:'dry',name:'Dry',rules:[]}]});
      for(const slow of ['weatherProfile','weatherRules']){
        const s=t.open();await assistantFocusTurn(s,'Use weather profile Dry, temperature above 10 C.',t.options({extract:async spec=>{if(spec.jobId===slow)await new Promise(r=>setTimeout(r,15));return t.reply(spec);}}));
        if(assistantFocusCanSave(s)||!s.unresolved.some(r=>r.field==='weatherRules'))return false;
        if(!assistantFocusChoose(s,'weatherRules','use-profile').ok||s.changes.some(c=>c.field==='weatherRules')||!assistantFocusCanSave(s))return false;
      }return true;
    });
    assert(collisions,'competing proposals for a saved weather profile and custom rules require clarification');
    const longInput=await page.evaluate(async()=>{
      const t=fieldTest;t.seed();const s=t.open();const background=Array(180).fill('background context').join(' ');
      const request=background+'; 60 minutes long; '+background+'; only before sunset; priority P1.';let max=0,ranked=0;
      const extract=async spec=>{max=Math.max(max,spec.request.length);return t.reply(spec);};
      await assistantFocusTurn(s,request,t.options({extract,rank:async payload=>{ranked+=payload.queries.length;return {rankings:[]};}}));const r=assistantFocusMaterialize(s);
      return {duration:r.durationMinutes,end:r.allowedTimeEndAnchor,priority:r.priority,max,ranked,pending:s.pendingFamilies,unresolved:s.unresolved};
    });
    assert(longInput.duration===60&&longInput.end==='maghrib'&&longInput.priority===1&&longInput.max<1300&&longInput.ranked>13&&!longInput.pending.length&&!longInput.unresolved.length,'long requests retain trailing settings while routing and extraction receive bounded original contexts');
    assert(!errors.length,`scripted field jobs have no page errors (${errors.join('; ')})`);
    await page.close();
    if(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH){
      const live=await browser.newPage({serviceWorkers:'block',timezoneId:'America/New_York',viewport:{width:390,height:844}});
      live.on('pageerror',e=>errors.push(e.message));
      await live.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
      await live.goto(BASE);await waitForAssistant(live);
      await live.evaluate(async()=>{patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});await assistantNeedleDownload();});
      const cases=[
        {id:'create-habit-nine-settings',operation:'create',kind:'habit',prompt:'Create a habit called Walk, every other day for 30 minutes, weekdays only before sunset. Set priority P1, pin it, use the 🚶 emoji and tag it Health.',expected:{name:'Walk',durationMinutes:30,allowedWeekdays:[1,2,3,4,5],allowedTimeEndAnchor:'maghrib',priority:1,pinned:true,emoji:'🚶',topics:['Health']},rhythm:[1,2]},
        {id:'create-ordinal-frequency',operation:'create',kind:'habit',prompt:'Create a habit called Walk, every third day for twenty-five minutes, only before sunset. Set priority P1 and pin it.',expected:{name:'Walk',durationMinutes:25,allowedTimeEndAnchor:'maghrib',priority:1,pinned:true},rhythm:[1,3]},
        {id:'create-count-and-week-period',operation:'create',kind:'habit',prompt:'Create a habit called Study, twice every three weeks for half an hour. Tag it Learning and use the 📚 emoji.',expected:{name:'Study',durationMinutes:30,topics:['Learning'],emoji:'📚'},rhythm:[2,21]},
        {id:'create-mixed-fraction-lengths',operation:'create',kind:'habit',prompt:'Create a habit called Study, every third day for one and a half hours, split into chunks of at least a quarter hour, with a gap of half an hour. Set priority P1 and pin it.',expected:{name:'Study',durationMinutes:90,breakable:true,minChunkMinutes:15,minGapMinutes:30,priority:1,pinned:true},rhythm:[1,3]},
        {id:'create-task-eight-settings',operation:'create',kind:'task',prompt:'Create a task called Submit report, due 2026-11-10 at 9am, for 45 minutes. Set priority P0, pin it, tag it Work and use a blue color.',expected:{name:'Submit report',dueDate:1794286800000,eventTime:1794319200000,durationMinutes:45,priority:0,pinned:true,topics:['Work'],emojiBgColor:'blue'}},
        {id:'edit-habit-nine-settings',operation:'edit',kind:'habit',prompt:'Rename it Strength, four times a week, 45 minutes each, weekdays after 6pm. Set priority P1, pin it, use the 💪 emoji and tag it Fitness.',expected:{name:'Strength',durationMinutes:45,allowedWeekdays:[1,2,3,4,5],allowedTimeStart:1080,priority:1,pinned:true,emoji:'💪',topics:['Fitness']},rhythm:[4,7]},
        {id:'create-chunks-and-gap',operation:'create',kind:'habit',prompt:'Read daily for 60 minutes, split into chunks of at least 15 minutes, with a gap of 30 minutes. Set priority P2 and pin it.',expected:{name:'Read',durationMinutes:60,breakable:true,minChunkMinutes:15,minGapMinutes:30,priority:2,pinned:true},rhythm:[1,1]},
        {id:'create-natural-task',operation:'create',kind:'task',prompt:'Remind me to call mom tomorrow at 10am for 20 minutes, priority P1, pin it.',expected:{name:'call mom',dueDate:1793595600000,eventTime:1793631600000,durationMinutes:20,priority:1,pinned:true}},
        {id:'create-feedback-clock-and-duration',operation:'create',kind:'task',prompt:'Go to park today at 12 pm and this will be for one and a half hours',expected:{name:'Go to park',dueDate:1793505600000,eventTime:1793552400000,durationMinutes:90}},
        {id:'create-clock-with-duration-clause',operation:'create',kind:'task',prompt:'Go to park today at 12 pm and stay for 90 minutes',expected:{name:'Go to park',dueDate:1793505600000,eventTime:1793552400000,durationMinutes:90}},
        {id:'edit-duration-and-priority',operation:'edit',kind:'habit',prompt:'Set duration to 20 minutes and priority to P1',expected:{name:'Gym',durationMinutes:20,priority:1},rhythm:[1,7]},
        {id:'edit-duration-following-clock',operation:'edit',kind:'task',seed:{type:'task',target:null,dueDate:1793595600000,eventTime:null},prompt:'Set duration to 20 minutes at 6pm',expected:{name:'Gym',durationMinutes:20,dueDate:1793595600000,eventTime:1793660400000}},
        {id:'create-event',operation:'create',kind:'event',prompt:'Create an event called Dentist, on 2026-11-10 at 2pm, for 45 minutes. Use the 🦷 emoji, a blue color, and tag it Health.',expected:{name:'Dentist',durationMinutes:45,emoji:'🦷',emojiBgColor:'blue',topics:['Health']},appointment:{startDate:'2026-11-10',startMinute:840}},
        {id:'edit-duration-and-sunset',operation:'edit',kind:'habit',prompt:'Make it 30 minutes long, only before sunset',expected:{name:'Gym',durationMinutes:30,allowedTimeEndAnchor:'maghrib',priority:2,emoji:'🏋️',topics:['Original']}},
        {id:'edit-hard-and-preferred',operation:'edit',kind:'habit',prompt:'Three times a week for 30 minutes, weekdays only between 6pm and 9pm, preferably on Monday and Wednesday, preferably before sunset.',expected:{name:'Gym',durationMinutes:30,allowedWeekdays:[1,2,3,4,5],allowedTimeStart:1080,allowedTimeEnd:1260,allowedTimeEndAnchor:null,preferredWeekdays:[1,3],preferredTimeEndAnchor:'maghrib'},rhythm:[3,7]},
        {id:'create-many-controls',operation:'create',kind:'habit',prompt:'Create a habit called Study, every day for 60 minutes, weekdays only between 7pm and 9pm, split into chunks of at least 15 minutes, with a gap of 30 minutes. Set priority P1, pin it, use the 📚 emoji, a purple color, tag it Learning, at Home, use weather profile Dry, add link https://example.com/study.',expected:{name:'Study',durationMinutes:60,allowedWeekdays:[1,2,3,4,5],allowedTimeStart:1140,allowedTimeEnd:1260,breakable:true,minChunkMinutes:15,minGapMinutes:30,priority:1,pinned:true,emoji:'📚',emojiBgColor:'purple',topics:['Learning'],locationIds:['home'],weatherProfileId:'dry'},rhythm:[1,1],link:'https://example.com/study'},
        {id:'edit-negation',operation:'edit',kind:'habit',prompt:'Do not pin it, do not split it, 30 minutes long.',expected:{name:'Gym',pinned:false,breakable:false,durationMinutes:30,priority:2,emoji:'🏋️',topics:['Original']}},
        {id:'create-name-only-defaults',operation:'create',kind:'habit',prompt:'Walk',expected:{name:'Walk',durationMinutes:35},rhythm:[1,2],settings:{defaultDurationMinutes:35,defaultTarget:2}},
        {id:'create-frequency-default-duration',operation:'create',kind:'habit',prompt:'Walk every other day before sunset',expected:{name:'Walk',durationMinutes:35,allowedTimeEndAnchor:'maghrib'},rhythm:[1,2]},
        {id:'create-task-default-duration',operation:'create',kind:'task',prompt:'Call mom',expected:{name:'Call mom',durationMinutes:20},settings:{taskDefaults:{durationMinutes:20}}},
        {id:'edit-defaults-do-not-overwrite',operation:'edit',kind:'habit',prompt:'Pin it.',expected:{name:'Gym',durationMinutes:45,pinned:true},rhythm:[1,7]}
      ];
      const results=[],failures=[];
      for(const test of cases){
        const result=await live.evaluate(async test=>{
          save([{hid:'gym',name:'Gym',type:'keepup',target:7,durationMinutes:45,priority:2,emoji:'🏋️',logs:[{ts:1}],topics:['Original'],pinned:false,breakable:false,...test.seed}]);
          saveSortSettings({...loadSortSettings(),...test.settings,locations:[{id:'home',name:'Home',lat:40,lng:-74}],weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation',max:1}]}]});
          const before=JSON.stringify(load());const s=assistantFocusOpen({operation:test.operation,kind:test.kind,targetId:test.operation==='edit'?'gym':null,now:new Date('2026-11-01T12:00:00-05:00').getTime()});
          await assistantFocusTurn(s,test.prompt);const r=assistantFocusMaterialize(s);
          const baseline=JSON.parse(before)[0];
          const preserved=test.operation!=='edit'||(r.hid===baseline.hid&&JSON.stringify(r.logs)===JSON.stringify(baseline.logs)&&r.createdAt===baseline.createdAt);
          const unchanged=before===JSON.stringify(load());const initialCanSave=assistantFocusCanSave(s);assistantFocusApprove(s);
          const ready=assistantFocusCanSave(s);let committed=null;
          // Only commit a preview after all predefined semantic expectations match.
          const matches=Object.entries(test.expected).every(([key,value])=>JSON.stringify(r[key]??null)===JSON.stringify(value));
          const fieldForKey=key=>key==='eventTime'?'dueTime':key==='locationIds'?'places':key==='weatherProfileId'?'weatherProfile'
            :key.startsWith('allowedTime')?'allowedWindow':key.startsWith('preferredTime')?'preferredWindow':key;
          const allowed=new Set(Object.keys(test.expected).map(fieldForKey));
          if(test.rhythm){allowed.add('timesPerPeriod');allowed.add('periodDays');}
          if(test.link)allowed.add('links');
          for(const key of Object.keys(test.appointment||{}))allowed.add('appointment'+key[0].toUpperCase()+key.slice(1));
          const extras=s.changes.filter(change=>!allowed.has(change.field));
          const rhythm=rhythmParts(r.target),rhythmOK=!test.rhythm||(rhythm.times===test.rhythm[0]&&rhythm.days===test.rhythm[1]);
          const linkOK=!test.link||r.links.some(link=>link.value===test.link);
          const appointmentOK=linkOK&&(!test.appointment||Object.entries(test.appointment).every(([k,v])=>r.appointment?.[k]===v));
          if(matches&&rhythmOK&&appointmentOK&&ready&&!extras.length)committed=await assistantFocusCommit(s);
          return {record:r,preserved,extras,changes:s.changes,unresolved:s.unresolved,pending:s.pendingFamilies,trace:s.trace,jobs:s.jobs.map(j=>({id:j.id,status:j.status,attempts:j.attempts,spans:j.spans,error:j.error})),timing:s.timing,unchanged,initialCanSave,ready,matches,rhythmOK,appointmentOK,committed,saved:load()};
        },test);
        results.push({...test,...result});fs.writeFileSync('test-results/needle-field-jobs-live.json',JSON.stringify(results,null,2));
        const okay=result.matches&&result.rhythmOK&&result.appointmentOK&&!result.extras.length&&!result.unresolved.length&&!result.pending.length&&result.unchanged&&result.preserved&&result.ready&&result.committed?.ok;
        if(okay)assert(true,`live Needle: ${test.id} fills every expected field and saves only after confirmation`);
        else {failures.push(test.id);console.error(`  FAIL live ${test.id}: ${JSON.stringify({changes:result.changes,unresolved:result.unresolved,pending:result.pending,ready:result.ready})}`);}
      }
      assert(!failures.length,`live complex requests: ${failures.length} failures (${failures.join(', ')})`);
      assert(!errors.length,`live field jobs have no page errors (${errors.join('; ')})`);await live.close();
    }else console.log('  skip: live field jobs (set NEEDLE_MODEL_PATH and NEEDLE_WASM_PATH)');
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
