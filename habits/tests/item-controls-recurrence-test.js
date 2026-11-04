const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York',isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('tings_coach_essentials_v2','done');localStorage.setItem('tings_coach_install_v2','done');});
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const result=await page.evaluate(async()=>{
      const RealDate=Date,now=new RealDate(2026,10,26,8).getTime();
      globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      const at=(y,m,d)=>new Date(y,m-1,d,12).getTime(),lastFriday=[{ordinal:-1,weekday:5}];
      const normalized=normalizeOrdinalWeekdays([...lastFriday,...lastFriday,{ordinal:6,weekday:0},{ordinal:1,weekday:7}]);
      const h=normalize([{hid:'ordinal-habit',name:'Monthly',type:'keepup',target:1,durationMinutes:30,allowedOrdinalWeekdays:lastFriday,logs:[]}])[0];
      const checks=[
        matchesOrdinalWeekdays(lastFriday,at(2026,11,27)),!matchesOrdinalWeekdays([{ordinal:5,weekday:5}],at(2026,11,27)),
        matchesOrdinalWeekdays([{ordinal:5,weekday:5}],at(2027,1,29)),matchesOrdinalWeekdays([{ordinal:-1,weekday:4}],at(2024,2,29)),
        matchesOrdinalWeekdays([{ordinal:-1,weekday:4}],at(2026,12,31)),matchesOrdinalWeekdays([{ordinal:2,weekday:0}],at(2026,3,8)),
        matchesOrdinalWeekdays([{ordinal:1,weekday:0}],at(2026,11,1)),isDateEligibleForHabit(h,at(2026,11,27)),!isDateEligibleForHabit(h,at(2026,11,20)),
        !isDateEligibleForHabit({...h,allowedMonthDays:[26]},at(2026,11,27)),!isDateEligibleForHabit({...h,allowedWeekdays:[4]},at(2026,11,27)),
        isPreferredDay({...h,preferredOrdinalWeekdays:lastFriday},at(2026,11,27)),!isPreferredDay({...h,preferredOrdinalWeekdays:lastFriday},at(2026,11,20)),
        dateKey(nextEligibleDate({...h,allowedOrdinalWeekdays:[{ordinal:2,weekday:0}]},at(2026,3,7)))==='2026-03-08'
      ];
      const option=normalize([{...h,allowedOrdinalWeekdays:[],scheduleOptions:[{weekdays:[],ordinalWeekdays:lastFriday,start:540,end:600,locationId:null}]}])[0];
      checks.push(!isDateEligibleForHabit(option,at(2026,11,20)),isDateEligibleForHabit(option,at(2026,11,27)));
      const alternative={...option,allowedWeekdays:[4]};checks.push(isDateEligibleForHabit(alternative,at(2026,11,26)),isDateEligibleForHabit(alternative,at(2026,11,27)));
      const settings={...loadSortSettings(),locations:[],travel:{},blockedTimes:[],blockedTimeOverrides:{},cancelledBlocks:{},availabilityMinutes:Array(7).fill(1440),agendaOptimizer:true};
      sortSettings=settings;saveSortSettings(settings);save([h]);
      const pair=[];
      for(const week of [buildWeekAgenda([h],settings,7),await buildWeekAgendaAsync([h],settings,7,{nativeLimitSeconds:4})])pair.push(week.days.filter(d=>d.timeline.some(r=>r.kind==='fill')).map(d=>dateKey(d.dayBase)));
      const appointment=normalize([{hid:'monthly-event',name:'Class',durationMinutes:45,appointment:{repeat:'monthly',startDate:'2026-01-01',startMinute:600,ordinalWeekdays:lastFriday,exceptions:{}}}])[0];
      checks.push(Boolean(appointmentOccurrence(appointment,'2026-11-27')),!appointmentOccurrence(appointment,'2026-11-20'));
      const busy={label:'Sleep',days:[],start:600,end:660,ordinalWeekdays:lastFriday,reminderId:'sleep'};
      checks.push(agendaBlockedIntervals('2026-11-27',{...settings,blockedTimes:[busy]},at(2026,11,27)-12*3600000,at(2026,11,28)-12*3600000).length===1,
        agendaBlockedIntervals('2026-11-20',{...settings,blockedTimes:[busy]},at(2026,11,20)-12*3600000,at(2026,11,21)-12*3600000).length===0);
      const rate=scheduledOpportunityRate(h),fifthRate=scheduledOpportunityRate({...h,allowedOrdinalWeekdays:[{ordinal:5,weekday:5}]});
      openDetail(0);const editorPresent=Boolean($('detail-ordinal-rules'));const copyRules=readOrdinalWeekdays($('detail-ordinal-rules'));closeDetail();
      const event={id:'ignore-event',calendarSeriesId:'ics:series',source:'ics',subject:'Meeting',start:now+3600000,end:now+7200000};
      applyCalendarImport([event],{source:'ics'});const item=load().find(x=>x.externalId===event.id);
      const ignores=[{scope:'series',id:item.calendarSeriesId,name:item.name}];saveSortSettings({...settings,calendarIgnores:ignores});sortSettings=loadSortSettings();
      applyCalendarImport([{...event,start:event.start+86400000,end:event.end+86400000}],{source:'ics'});
      const moved=load().find(x=>x.externalId===event.id),ignoreSettings=loadSortSettings();
      const ignoredChecks=[isCalendarIgnored(moved),!visibleIndices(load()).some(i=>load()[i].hid===moved.hid),!calendarImportedEvents(load()).length,
        !collectScheduledAgendaEvents(load(),dateKey(moved.eventTime),ignoreSettings).some(r=>r.h.hid===moved.hid),!matchesOverviewFilters(moved)];
      const rawPrefs={enabled:true,items:{[`item:${moved.hid}`]:{start:'notification'}}};
      const staleWeek={days:[{dayBase:dayStart(moved.eventTime),dayKey:dateKey(moved.eventTime),timeline:[{kind:'travel',start:moved.eventTime-600000,end:moved.eventTime,to:'meeting-place'},
        {kind:'scheduled',h:moved,locationId:'meeting-place',start:moved.eventTime,end:moved.eventTime+3600000}]}]};
      ignoredChecks.push(!nativeReminderEvents(staleWeek,load(),ignoreSettings,rawPrefs,now).length,
        !compileNativeWidgetSnapshot(staleWeek,load(),ignoreSettings,now).days.some(d=>d.rows.some(r=>r.hid===moved.hid || r.kind==='travel')),
        !weekAgendaByDay(staleWeek,load()).size,!overviewDayAgendaHabitHtml(staleWeek.days[0].timeline[1],load()));
      const backup=buildBackup();restoreCalendarIgnored(ignores[0]);ignoredChecks.push(!isCalendarIgnored(moved),backup.settings.calendarIgnores.length===1);
      return {normalized,checks,pair,rate,fifthRate,editorPresent,copyRules,ignoredChecks};
    });
    assert.deepEqual(result.normalized,[{ordinal:-1,weekday:5}]);assert.ok(result.checks.every(Boolean),JSON.stringify(result.checks));
    for(const placed of result.pair){assert.ok(placed.length);assert.ok(placed.every(d=>d==='2026-11-27'),JSON.stringify(placed));}
    assert.ok(Math.abs(result.rate-4800/146097)<1e-12);assert.ok(result.fifthRate>0 && result.fifthRate<result.rate);
    assert.equal(result.editorPresent,true);assert.deepEqual(result.copyRules,[{ordinal:-1,weekday:5}]);assert.ok(result.ignoredChecks.every(Boolean),JSON.stringify(result.ignoredChecks));
    const credits=await page.evaluate(()=>{
      buildWeekAgendaOffMain=async(data,settings,count,opts)=>buildWeekAgenda(data,settings,count,opts);
      const data=load(),item=data.find(h=>h.source==='ics');data.push(normalize([{hid:'ignore-credit',name:'Work credit',type:'keepup',target:1,durationMinutes:120,logs:[]}])[0]);
      saveSortSettings({...loadSortSettings(),calendarCreditHabitId:'ignore-credit'});sortSettings=loadSortSettings();rebuildCalendarCredits(data,'ignore-credit');save(data);
      const minutes=()=>normalizeLogs(load().find(h=>h.hid==='ignore-credit').logs).filter(isCalendarCreditLog).reduce((n,l)=>n+l.minutes,0);
      const before=minutes(),source=JSON.stringify(load().find(h=>h.hid===item.hid));setCalendarIgnored(item,'series');
      const ignored=minutes()===0 && isCalendarIgnored(item) && JSON.stringify(load().find(h=>h.hid===item.hid))===source;
      executeUndo();
      renderOverviewLists(load().filter(h=>h.hid==='ignore-credit'),()=>1);
      const index=Number(document.querySelector('[data-open-overview-item]')?.dataset.openOverviewItem);
      return {before,ignored,restored:minutes()===before && !isCalendarIgnored(item),stableIndex:load()[index]?.hid==='ignore-credit'};
    });
    assert.ok(credits.before>0);assert.equal(credits.ignored,true);assert.equal(credits.restored,true);assert.equal(credits.stableIndex,true);
    // Duplication remains a draft until Save, including imported ownership cleanup.
    const duplicated=await page.evaluate(()=>{
      const item=load().find(h=>h.source==='ics');openDetail(load().findIndex(h=>h.source==='ics'));
      $('detail-duplicate').click();const draft=detailUnsavedCreate,before=load().length;
      const clean=draft && draft.hid!==item.hid && !draft.source && !draft.externalId && !draft.calendarSeriesId && !draft.logs.length && Boolean(draft.appointment);
      $('detail-close').click();const cancelled=load().length===before && !detailUnsavedCreate && !$('detail-sheet').classList.contains('open');
      openDetail(load().findIndex(h=>h.source==='ics'));$('detail-duplicate').click();const id=detailUnsavedCreate.hid;$('detail-habit-message').value='Edited meeting copy';$('detail-habit-message').dispatchEvent(new Event('input',{bubbles:true}));setDetailDirty();$('detail-save').click();
      const saved=load().find(h=>h.hid===id);return {clean,cancelled,saved:Boolean(saved),independent:saved?.hid!==item.hid,name:saved?.name};
    });
    assert.equal(duplicated.clean,true);assert.equal(duplicated.cancelled,true);assert.equal(duplicated.saved,true);assert.equal(duplicated.independent,true);assert.match(duplicated.name,/ copy$/);
    const controls=await page.evaluate(()=>{
      buildWeekAgendaOffMain=async(data,settings,count,opts)=>buildWeekAgenda(data,settings,count,opts);
      closeDetail();openDetail(0);
      const allowed=$('detail-ordinal-rules'),preferred=$('detail-preferred-ordinal-rules');
      allowed.querySelector('[data-ordinal-pick="1"]').click();allowed.querySelector('[data-ordinal-day="1"]').click();
      preferred.querySelector('[data-ordinal-pick="2"]').click();preferred.querySelector('[data-ordinal-day="3"]').click();
      $('detail-save').click();const stored=load()[0];
      const persisted=stored.allowedOrdinalWeekdays.some(r=>r.ordinal===-1&&r.weekday===5)
        && stored.allowedOrdinalWeekdays.some(r=>r.ordinal===1&&r.weekday===1)
        && stored.preferredOrdinalWeekdays.length===1
        && stored.preferredOrdinalWeekdays[0].ordinal===2&&stored.preferredOrdinalWeekdays[0].weekday===3;
      closeDetail();
      const now=Date.now(),data=normalize([{hid:'event-icon',name:'Meeting icon',type:'task',source:'ics',externalId:'icon-event',eventTime:now+3600000,dueDate:dayStart(now),durationMinutes:30,logs:[]},
        {hid:'task-icon',name:'Task icon',type:'task',dueDate:dayStart(now),durationMinutes:10,logs:[]}]);save(data);
      const layouts=[],badges=[];
      const badge=el=>el && {
        tick:getComputedStyle(el,'::before').display,
        circle:getComputedStyle(el,'::after').display,
        content:getComputedStyle(el,'::after').content,
        color:getComputedStyle(el,'::after').backgroundColor
      };
      for(const source of ['device','ics','pdf','gcal','msgraph'])for(const minimalMode of [false,true]){
        data[0].source=source;save(data);
        saveSortSettings({...loadSortSettings(),minimalMode,blockedTimes:[],locations:[],availabilityMinutes:Array(7).fill(1440)});sortSettings=loadSortSettings();
        render({__fromOptimizer:true,__optimizedWeek:buildWeekAgenda(load(),sortSettings,1)});
        const event=document.querySelector('.ting-card[data-real="0"]'),task=document.querySelector('.ting-card[data-real="1"]');
        layouts.push(Boolean(event?.querySelector('.ti-calendar-time')) && !event?.querySelector('[data-pulse]') && Boolean(task?.querySelector('[data-pulse]')));
        const eventBadge=badge(event?.querySelector('.pulse-btn')),taskBadge=badge(task?.querySelector('.pulse-btn'));
        openDetail(0);const detailBadge=badge($('detail-mark'));
        closeDetail();openDetail(1);const taskDetailBadge=badge($('detail-mark'));closeDetail();
        badges.push({source,minimalMode,eventBadge,taskBadge,detailBadge,taskDetailBadge});
      }
      openDetail(0);const noCompletion=$('detail-mark-log').hidden && Boolean($('detail-mark').querySelector('.ti-calendar-time'));closeDetail();
      return {persisted,layouts,noCompletion,badges};
    });
    assert.equal(controls.persisted,true);assert.ok(controls.layouts.every(Boolean),JSON.stringify(controls.layouts));assert.equal(controls.noCompletion,true);
    for(const {source,minimalMode,eventBadge,taskBadge,detailBadge,taskDetailBadge} of controls.badges){
      const context=`${source}, minimal=${minimalMode}`;
      for(const b of [eventBadge,detailBadge]){
        assert.equal(b?.tick,'none',`calendar tick hidden: ${context}`);
        assert.notEqual(b.circle,'none',`priority circle remains: ${context}`);
        assert.equal(b.content,'""',`priority circle has no tick text: ${context}`);
        assert.equal(b.color,taskBadge.color,`priority color preserved: ${context}`);
        assert.notEqual(b.color,'rgba(0, 0, 0, 0)',`priority circle is visible: ${context}`);
      }
      assert.notEqual(taskBadge.tick,'none',`task tick remains: ${context}`);
      assert.notEqual(taskDetailBadge.tick,'none',`task detail tick remains: ${context}`);
    }
    assert.deepEqual(errors,[]);console.log('PASS ordinal dates, both planners, editor persistence, alternatives, ignore/reimport/restore/credits/reminders/widgets and duplication Save/Cancel');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
