if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    // Pull the newest worker immediately so hard-refresh isn't required to
    // escape a stale optimizer/toast build.
    try{ reg.update(); }catch(_){}
  }).catch(()=>{});
}
