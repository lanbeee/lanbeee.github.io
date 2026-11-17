const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.addInitScript(()=>{
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
  });
  await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
  const initial=await page.evaluate(()=>{
   localStorage.clear();sortSettings=loadSortSettings();
   const start=Date.now()+86400000,end=start+3600000;
   const event={subject:'Review meeting',start,end};
   save(normalize([{hid:'local-event',name:event.subject,type:'task',eventTime:start,durationMinutes:60}]));
   applyCalendarImport([{...event,id:'ics:review'}],{source:'ics'});
   applyCalendarImport([event],{source:'pdf'});
   renderCalendarDuplicateReview();
   return {groups:calendarDuplicateGroups(load(),loadSortSettings()).length,buttons:[...document.querySelectorAll('#calendar-duplicate-review button')].map(x=>x.textContent)};
  });
  assert.equal(initial.groups,1);assert.deepEqual(initial.buttons,['Keep Tings copy','Keep ICS import copy','Keep PDF import copy']);
  await page.locator('#open-about').click();
  await page.locator('#settings-calendar-head').click();
  await page.locator('#calendar-duplicate-review summary').click();
  await page.getByRole('button',{name:'Keep Tings copy',exact:true}).click();
  const hidden=await page.evaluate(()=>({visible:load().filter(h=>!isCalendarIgnored(h)).map(h=>h.hid),ignores:loadSortSettings().calendarIgnores.length}));
  assert.deepEqual(hidden.visible,['local-event']);assert.equal(hidden.ignores,2);
  await page.evaluate(()=>{const h=load().find(x=>x.source==='ics');applyCalendarImport([{id:h.externalId,subject:h.name,start:h.eventTime,end:h.calendarEnd}],{source:'ics'});});
  assert.equal(await page.evaluate(()=>load().filter(h=>!isCalendarIgnored(h)).length),1,'reimport keeps hidden copy hidden');
  await page.evaluate(()=>restoreCalendarIgnored(loadSortSettings().calendarIgnores[0]));
  assert.equal(await page.evaluate(()=>load().filter(h=>!isCalendarIgnored(h)).length),2,'hidden copy can be restored');
  const edgeCases=await page.evaluate(()=>{
    localStorage.clear();sortSettings=loadSortSettings();
    const start=Date.now()+86400000;
    const base={name:'Same meeting',type:'task',eventTime:start,durationMinutes:60,source:'device',externalId:'device:7:20',calendarStart:start,calendarEnd:start+3600000,calendarId:'7'};
    save(normalize([{...base,hid:'phone-a',calendarDeviceId:'1111111111111111'}, {...base,hid:'phone-b',calendarDeviceId:'2222222222222222'}, {...base,hid:'different-time',eventTime:start+3600000,calendarEnd:start+7200000}]));
    const groups=calendarDuplicateGroups(load(),loadSortSettings());
    const kept=reconcileCalendarDuplicateGroup('phone-a',['phone-a','phone-b']);
    const visible=load().filter(h=>!isCalendarIgnored(h)).map(h=>h.hid);
    const backup=buildBackup();restoreBackup(backup);sortSettings=loadSortSettings();
    const restoredVisible=load().filter(h=>!isCalendarIgnored(h)).map(h=>h.hid);
    restoreCalendarIgnored(loadSortSettings().calendarIgnores[0]);
    const data=load();data.find(h=>h.hid==='phone-b').eventTime+=60000;save(data);
    const stale=reconcileCalendarDuplicateGroup('phone-a',['phone-a','phone-b']);
    const staleIgnores=loadSortSettings().calendarIgnores.length;
    // Reconciliation must also be able to keep an import and hide a local copy.
    save(normalize([{...base,hid:'imported'}, {...base,hid:'local',source:null,externalId:null}]));
    const localHidden=reconcileCalendarDuplicateGroup('imported',['imported','local']);
    return {groups:groups.map(g=>g.length),kept,visible,restoredVisible,stale,staleIgnores,localHidden,localIgnored:isCalendarIgnored(load().find(h=>h.hid==='local'))};
  });
  assert.deepEqual(edgeCases.groups,[2],'different intervals are not suggested');
  assert.equal(edgeCases.kept,true);
  assert.deepEqual(edgeCases.visible,['phone-a','different-time'],'shared provider IDs cannot hide the kept phone copy');
  assert.deepEqual(edgeCases.restoredVisible,edgeCases.visible,'reconciliation survives backup restore');
  assert.equal(edgeCases.stale,false);assert.equal(edgeCases.staleIgnores,0,'stale review cannot hide changed events');
  assert.equal(edgeCases.localHidden,true);assert.equal(edgeCases.localIgnored,true);
  console.log('Calendar duplicate review passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
