// Test-only adapter: import the canonical worker unchanged, freeze its clock,
// and inspect its result. No production assets or page localStorage are written.
const auditConfig = self.__plannerQualityConfig;
const AuditRealDate = Date;
self.Date = class extends AuditRealDate {
  constructor(...args){super(...(args.length ? args : [auditConfig.now]));}
  static now(){return auditConfig.now;}
};
const auditImports = self.importScripts.bind(self);
self.importScripts = (...paths)=>auditImports(...paths.map(path=>new URL(path,auditConfig.workerUrl).href));
try{self.importScripts(auditConfig.workerUrl);}catch(error){
  self.postMessage({error:'planner audit import: '+(error.stack || error.message || String(error))});
  throw error;
}
glpkCandidateUrls = ()=>[new URL('../lib/js/glpk.mjs',auditConfig.workerUrl).href];
// Every travel edge is synthetic/manual. Fail visibly on unexpected external IO.
const auditFetch = self.fetch.bind(self);
self.fetch = (url,options)=>{
  if(new URL(typeof url === 'string' ? url : url.url,auditConfig.workerUrl).origin
    !== new URL(auditConfig.workerUrl).origin)throw new Error('quality audit attempted external fetch');
  return auditFetch(url,options);
};
const auditPost = self.postMessage.bind(self);
self.postMessage = message=>{
  if(message.week){
    const week = message.week, data = load(), violations = [], rows = [];
    const totals = {}, priorityMinutes = Array(6).fill(0);
    let workMinutes = 0, travelMinutes = 0, weatherPenalty = 0;
    for(let offset=0;offset<week.days.length;offset++){
      const day = week.days[offset];
      const timeline = (day.timeline || []).filter(row=>['fill','scheduled','travel'].includes(row.kind))
        .slice().sort((a,b)=>a.start-b.start || a.end-b.end);
      for(let i=1;i<timeline.length;i++)if(timeline[i].start<timeline[i-1].end-1)
        violations.push(`overlap:${offset}:${timeline[i-1].kind}:${timeline[i].kind}`);
      if(day.usedMinutes>day.totalMinutes+0.01)violations.push(`capacity:${offset}`);
      for(const row of timeline){
        const minutes=(row.end-row.start)/60000;
        if(!Number.isFinite(minutes) || minutes<=0)violations.push(`duration:${offset}`);
        if(row.kind==='travel'){
          travelMinutes+=minutes;
          if(row.end-row.start+1<(row.seconds || 0)*1000)violations.push(`short-travel:${offset}`);
          rows.push({day:offset,kind:'travel',start:row.start,end:row.end,from:row.from,to:row.to,seconds:row.seconds});
          continue;
        }
        const h=data[row.i];
        if(!h)continue; // Busy times do not have an item index.
        const hid=h.hid;
        workMinutes+=minutes;
        totals[hid]=(totals[hid] || 0)+minutes;
        priorityMinutes[h.priority == null ? 2 : h.priority]+=minutes;
        const windows=fillDayWindows(h,day.dayBase,row.locationId) || [];
        // Shared-fitter audit complements the independent raw-fixture checks.
        if(row.kind==='fill' && windows.length && !windows.some(w=>row.start>=w.start-1 && row.end<=w.end+1))
          violations.push(`resolved-window:${offset}:${hid}`);
        const location=(sortSettings.locations || []).find(l=>l.id===row.locationId);
        if(location){
          const win=resolveLocationWindow(location,new Date(day.dayBase).getDay());
          const start=(row.start-day.dayBase)/60000,end=(row.end-day.dayBase)/60000;
          if(!win || (win.start<=win.end && (start<win.start || end>win.end)))
            violations.push(`location-hours:${offset}:${hid}`);
        }
        if(row.kind==='fill')weatherPenalty+=weatherPenaltyForFit({h,i:row.i},
          {placeStart:row.start,placeEnd:row.end,locId:row.locationId},
          {dayBase:day.dayBase,seedLocId:sortSettings.lastKnownLocationId,registry:sortSettings.locations},sortSettings) || 0;
        rows.push({day:offset,kind:row.kind,hid,start:row.start,end:row.end,
          locationId:row.locationId || null,optionId:row.scheduleOptionId || null});
      }
    }
    let directGapMinutes=0;
    for(const h of data)for(const link of h.scheduleLinks || [])if(link.adjacency==='direct'){
      for(const row of rows.filter(r=>r.hid===h.hid)){
        const partner=rows.find(r=>r.day===row.day && r.hid===link.anchorHid);
        if(partner)directGapMinutes+=Math.max(0,(link.direction==='after'?row.start-partner.end:partner.start-row.end)/60000);
      }
    }
    message.summary={directGapMinutes,optimized:Boolean(week.optimized),status:week.plannerSolveStatus || 'fast',
      daySolves:week.plannerDiagnostics && week.plannerDiagnostics.daySolves,
      algorithm:week.fastPlannerAlgorithm,graph:week.fastGraphDiagnostics,weekGraph:week.fastWeekGraphDiagnostics,selection:week.fastSelectionDiagnostics,todayChoices:week.fastTodayChoiceDiagnostics,
      workMinutes,travelMinutes,weatherPenalty,priorityMinutes,totals,rows,violations,
      days:week.days.map(d=>({dayBase:d.dayBase,totalMinutes:d.totalMinutes,usedMinutes:d.usedMinutes}))};
    delete message.week;
  }
  auditPost(message);
};
auditPost({ready:true});
