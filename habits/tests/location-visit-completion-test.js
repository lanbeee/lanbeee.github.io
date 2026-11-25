const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({timezoneId:'America/New_York'});
  await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
  await page.waitForFunction(()=>typeof locationVisitEligibility === 'function' && typeof buildWeekAgendaAsync === 'function');
  const result = await page.evaluate(async()=>{
    const RealDate = Date;
    const now = new RealDate(2026,10,25,19).getTime();
    globalThis.Date = class extends RealDate {constructor(...args){super(...(args.length ? args : [now]));}static now(){return now;}};
    const checks=[];
    const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
    const place={id:'gym',name:'Gym',lat:40,lng:-74,radiusM:100};
    const settings={...loadSortSettings(),locationOptIn:true,locations:[place]};
    sortSettings=settings;saveSortSettings(settings);
    const tomorrow=offsetCalendarDay(now,1), yesterday=offsetCalendarDay(now,-1);
    const make=(patch={})=>normalize([{hid:'visit_item',name:'Workout',type:'keepup',target:2,autoCompleteOnVisit:true,
      locationIds:['gym'],anywhereAllowed:false,allowedTimeStart:1080,allowedTimeEnd:1260,earlyWindowDays:1,
      logs:[yesterday],lastLog:yesterday,...patch}])[0];
    const eligible=h=>locationVisitEligibility(h,place,now,settings);
    check(eligible(make()),'rhythm due tomorrow allows one day early');
    check(!eligible(make({earlyWindowDays:0})),'rhythm with zero early allowance waits');
    check(eligible(make({type:'task',dueDate:tomorrow,logs:[],lastLog:null})),'task due tomorrow allows one day early');
    check(!eligible(make({type:'task',dueDate:tomorrow,logs:[],lastLog:null,earlyWindowDays:0})),'task with zero early allowance waits');
    check(!eligible(make({allowedTimeStart:1200})),'wrong hours rejected');
    check(!eligible(make({locationIds:[],anywhereAllowed:true})),'Anywhere supplies no visit permission');
    check(!eligible(make({snoozedUntil:now+60000})),'snooze respected');
    check(!eligible(make({breakable:true})),'split work excluded');
    check(!eligible(make({trackValue:true})),'quantity work excluded');
    check(!eligible(make({allowedWeekdays:[0]})),'wrong weekday rejected');
    const assessWeather=weatherFitAssessment;weatherFitAssessment=()=>({hardFail:true});
    check(!eligible(make()),'hard weather gate respected');weatherFitAssessment=assessWeather;
    check(!eligible(make({target:0.5,logs:[now-30*60000],minGapMinutes:60})),'minimum completion gap respected');
    check(!eligible(make({allowedTimeStart:null,allowedTimeEnd:null,
      scheduleOptions:[{id:'morning',locationId:'gym',start:600,end:660}]})),'option-only places cannot borrow other hours');
    check(!eligible(make({allowedTimeEnd:1140})),'closing boundary is excluded');
    check(eligible(make({allowedTimeStart:1140})),'opening boundary is included');
    for(const [month,day] of [[2,8],[10,1]]){
      const visit=new RealDate(2026,month,day,19).getTime();
      const previous=offsetCalendarDay(visit,-1);
      check(locationVisitEligibility(make({logs:[previous],lastLog:previous}),place,visit,settings),`DST ${month+1}/${day} uses local clock hours`);
    }
    const state={},fix={lat:40,lng:-74,accuracy:10,at:now};
    check(!observeLocationVisit({...fix,at:now-121000},settings,{}),'stale fix rejected');
    check(!observeLocationVisit({...fix,accuracy:150},settings,{}),'inaccurate fix rejected');
    const futureState={};
    check(!locationVisitActions([make()],{...fix,at:now+1000},settings,futureState).length
      && !Object.keys(futureState).length,'future fix cannot consume the visit without completing');
    check(locationVisitActions([make()],fix,settings,futureState).length===1,'valid fix still completes after future evidence is ignored');
    save([make({locationIds:[],anywhereAllowed:true})]);
    check(!nativeBackgroundSnapshot().visitEnabledIds.length,'no allowed saved place means no visit-only background work');
    save([make()]);
    check(nativeBackgroundSnapshot().visitEnabledIds.includes('visit_item'),'an allowed saved place enables background visits');
    const task=make({type:'task',dueDate:tomorrow,logs:[{ts:tomorrow,plan:true,timed:true,locationId:'gym'}],lastLog:null});
    const actions=locationVisitActions([task],fix,settings,state);
    check(actions.length===1,'one matching task visit');
    const before=JSON.stringify(task.logs);
    const applied=applyLocationVisitCompletion(task,actions[0]);
    check(applied && !task.logs.some(isPlanLog),'early visit consumes future occurrence plan');
    check(logTime(applied.entry)===now,'history preserves exact visit time');
    check(normalizeLogs(task.logs)[0].source==='location_visit','visit provenance survives normalization');
    check(!applyLocationVisitCompletion(task,actions[0]),'replay idempotent');
    check(!locationVisitActions([make()],fix,settings,state).length,'same stay survives item state changes');
    save([task]);localStorage.setItem(LOCATION_VISIT_STATE_KEY,JSON.stringify(state));
    undoLocationVisit([{hid:task.hid,action:actions[0],...applied}]);
    check(JSON.stringify(load()[0].logs)===before,'undo restores full timed plan and venue');
    check(!locationVisitActions(load(),fix,settings,locationVisitState()).length,'undo suppresses same stay');
    const afterExit=locationVisitState();observeLocationVisit({...fix,lat:41},settings,afterExit);
    check(locationVisitActions(load(),fix,settings,afterExit).length===1,'credible departure allows re-entry');
    const overlap={...settings,locations:[place,{...place,id:'other'}]};
    check(!observeLocationVisit(fix,overlap,{}),'ambiguous overlapping fences rejected');
    // Exercise the ordinary foreground callback and durable persistence.
    save([make({type:'task',dueDate:tomorrow,logs:[],lastLog:null})]);
    localStorage.removeItem(LOCATION_VISIT_STATE_KEY);
    await queueLocationVisit({coords:{latitude:40,longitude:-74,accuracy:10},timestamp:now});
    check(isTaskDone(load()[0]),'foreground GPS marks task done through normal persistence');
    check(!logTing(0),'a pending manual confirmation cannot double-credit the visit');
    executeUndo();check(!isTaskDone(load()[0]),'foreground toast Undo restores task');
    const h=make();save([h]);
    const action=locationVisitActions([h],fix,settings,{})[0];
    applyNativeCompletion([h],action);
    check(normalizeLogs(h.logs).some(log=>log.operationId===action.id),'native replay preserves shared visit identity');
    check(!applyNativeCompletion([h],action),'native repeated delivery is harmless');
    const linkedTask=make({type:'task',dueDate:tomorrow,logs:[],lastLog:null});
    const partner=make({hid:'partner',autoCompleteOnVisit:false});save([linkedTask,partner]);
    const edge=upsertOrderConstraint({dayBase:dayStart(tomorrow),beforeHid:linkedTask.hid,afterHid:partner.hid,adjacency:'direct'});
    const linkedAction=locationVisitActions([linkedTask],fix,settings,{})[0];
    const linkedResult=applyLocationVisitCompletion(linkedTask,linkedAction);save([linkedTask,partner]);
    check(!loadOrderConstraintStore().edges.some(e=>e.id===edge.id),'completion prunes fulfilled task order edges');
    undoLocationVisit([{hid:linkedTask.hid,action:linkedAction,...linkedResult}]);
    check(loadOrderConstraintStore().edges.some(e=>e.id===edge.id),'Undo restores the affected direct order edge');
    const plannerSettings={...settings,blockedTimes:[],availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440]};
    const fast = buildWeekAgenda([h],plannerSettings,4);
    check(!(fast.days[1].timeline || []).some(row=>row.h?.hid===h.hid || row.hid===h.hid),'Fast removes the satisfied tomorrow occurrence');
    if(await ensureGlpk()){
      const exact = await buildWeekAgendaAsync([h],plannerSettings,4);
      check(!(exact.days[1].timeline || []).some(row=>row.h?.hid===h.hid || row.hid===h.hid),'GLPK removes the satisfied tomorrow occurrence');
    }
    await window.tingsLoadAssistant();
    save([make()]);
    const session=assistantFocusOpen({operation:'edit',kind:'habit',targetId:'visit_item'});
    const parsed=assistantFocusNormalize('autoCompleteOnVisit','yes',session);
    check(parsed.ok && parsed.value===true,'assistant validates visit toggle');
    assistantFocusStage(session,{field:'autoCompleteOnVisit',op:'set',value:false});
    check(assistantFocusMaterialize(session).autoCompleteOnVisit===false,'assistant stages visit edits');
    const intent=assistantFocusQuestionIntent('What’s my Mark done on visit?',session);
    check(intent?.field==='autoCompleteOnVisit','assistant reads visit setting without treating it as Done');
    return checks;
  });
  await page.evaluate(()=>{
    openDetail(0);
    document.querySelectorAll('[data-detail-nav="availability"] details').forEach(el=>el.open=true);
    scrollDetailToNav('availability','instant');
  });
  await page.locator('#detail-auto-visit').click();
  await page.locator('#detail-save').click();
  assert.equal(await page.evaluate(()=>load()[0].autoCompleteOnVisit),false,'detail switch saves through the normal editor');
  result.push('detail switch saves through the normal editor');
  result.forEach(label=>console.log('PASS '+label));
  console.log(`${result.length} visit completion checks passed`);
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
