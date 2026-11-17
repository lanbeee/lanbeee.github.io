const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch();
  try{
  const page = await browser.newPage({timezoneId:'America/New_York'});
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    const result = await page.evaluate(()=>{
      localStorage.clear(); sortSettings=loadSortSettings();
      const start=dayStart(Date.now())+86400000+9*3600000;
      const h=normalize([{hid:'roundtrip',name:'Meeting',type:'task',eventTime:start,durationMinutes:60}])[0];
      save([h]);
      const one=icsForHabit(h),realNow=Date.now;
      let two;
      try{Date.now=()=>realNow()+1000;two=icsForHabit(h);}finally{Date.now=realNow;}
      const uid=s=>s.match(/UID:([^\r\n]+)/)[1];
      const events=parseCalendarIcsText(one,{from:dayStart(Date.now()),to:offsetCalendarDay(start,2)}).events;
      applyCalendarImport(events,{source:'ics'});
      const overnight=calendarCreditMinutesByDay([{start:dayStart(start)+23*3600000,end:dayStart(start)+26*3600000}]);
      localStorage.setItem(DEVICE_CALENDARS_KEY,JSON.stringify({enabled:true,calendarIds:['ABC-123']}));
      const ios=normalize([{...h,source:'device',calendarId:'ABC-123',calendarSeriesId:'device:ABC-123:event-uuid'}])[0];
      return {same:uid(one)===uid(two),count:load().length,minutes:overnight.map(x=>x.minutes),ids:deviceCalendarPreferences().calendarIds,series:ios.calendarSeriesId};
    });
    assert.equal(result.same,true);
    assert.equal(result.count,1);
    assert.deepEqual(result.minutes,[60,120]);
    assert.deepEqual(result.ids,['ABC-123']);
    assert.equal(result.series,'device:ABC-123:event-uuid');
    const creditUndo=await page.evaluate(()=>{
      localStorage.clear();sortSettings=loadSortSettings();
      save([{hid:'work',name:'Work',type:'keepup',target:1,durationMinutes:420,breakable:true}]);
      saveSortSettings({...loadSortSettings(),calendarCreditHabitId:'work'});sortSettings=loadSortSettings();
      const start=dayStart(Date.now())+86400000+9*3600000;
      applyCalendarImport([{id:'ics:undo-credit',subject:'Meeting',start,end:start+3600000}],{source:'ics'});
      const minutes=()=>normalizeLogs(load().find(h=>h.hid==='work').logs).filter(isCalendarCreditLog).reduce((sum,l)=>sum+l.minutes,0);
      const before=minutes();doNuke(load().findIndex(h=>h.source==='ics'));const removed=minutes();executeUndo();
      const dstStart=new Date(2026,2,7,23).getTime(),dstEnd=new Date(2026,2,8,4).getTime();
      return {before,removed,restored:minutes(),dst:calendarCreditMinutesByDay([{start:dstStart,end:dstEnd}]).map(x=>x.minutes)};
    });
    assert.deepEqual(creditUndo,{before:60,removed:0,restored:60,dst:[60,180]},'delete/undo restores credit and midnight splitting respects DST');
    console.log('Calendar roundtrip regressions passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
