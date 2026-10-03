// Serializable browser function, also usable through Android WebView CDP.
// A fresh isolated canonical worker per scenario keeps cold/warm comparisons
// honest and allows synthetic doing-now/reorder state without touching the app.
async function runPlannerQualityScenario({scenario,workerSource,repeat=true,engines=['fast','exact'],timeoutMs=75000}){
  const workerUrl=new URL('./js/agenda-planner-worker.js',location.href).href;
  const prefix=`self.__plannerQualityConfig=${JSON.stringify({now:scenario.now,workerUrl})};\n`;
  const blobUrl=URL.createObjectURL(new Blob([prefix,workerSource],{type:'text/javascript'}));
  const bootStart=performance.now();
  const worker=new Worker(blobUrl);
  let sequence=0, waiting=null;
  const send=message=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting=null;reject(new Error(`quality worker timeout after ${timeoutMs}ms`));},timeoutMs);
    waiting={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
    if(message)worker.postMessage({...message,id:++sequence});
  });
  worker.onmessage=event=>{const message=event.data;
    if(!waiting)return;
    const current=waiting;waiting=null;
    if(message.error)current.reject(new Error(message.error));else current.resolve(message);
  };
  worker.onerror=error=>{if(waiting){const current=waiting;waiting=null;current.reject(new Error(error.message));}};
  try{
    await send(null);
    const bootMs=performance.now()-bootStart;
    const results={bootMs,engines:{}};
    for(const engine of engines){
      const runs=[];
      for(let run=0;run<(repeat?2:1);run++){
        let previous=performance.now(),maxMainDelayMs=0,ticks=0;
        const timer=setInterval(()=>{const t=performance.now();maxMainDelayMs=Math.max(maxMainDelayMs,t-previous-50);previous=t;ticks++;},50);
        const started=performance.now();
        try{
          const message=await send({data:scenario.data,settings:{...scenario.settings,agendaOptimizer:engine==='exact'},
            numDays:scenario.days,mode:engine,storage:scenario.storage || {},glpkLimitSeconds:4});
          const summary=message.summary;
          if(!summary)throw new Error('missing quality summary');
          runs.push({...summary,elapsedMs:performance.now()-started,maxMainDelayMs,timerTicks:ticks});
        }finally{clearInterval(timer);}
      }
      results.engines[engine]=runs;
    }
    return results;
  }finally{worker.terminate();URL.revokeObjectURL(blobUrl);}
}
module.exports={runPlannerQualityScenario};
