// Runs before any application script. Meta CSP cannot set frame-ancestors, so
// GitHub Pages needs an explicit frame-bust for both owner and display pages.
(function(){
  let framed = false;
  try{ framed = window.top !== window.self; }
  catch(_){ framed = true; }
  if(framed){
    document.documentElement.replaceChildren();
    try{ window.stop(); }catch(_){}
    throw new Error('page_not_framable');
  }

  // This script runs before every deferred application script. It is the one
  // place that can recover if a core file fails to download or evaluate before
  // main-runtime starts the normal planner fallback timer.
  function recoverHomeBoot(){
    const list = document.getElementById('list');
    if(!list || !list.querySelector('.home-loading'))return false;
    try{
      if(typeof window.render === 'function'){
        window.render({deferAgenda:true});
        if(!list.querySelector('.home-loading'))return true;
      }
    }catch(_){ }
    list.innerHTML = '<div class="home-boot-recovery" role="alert"><strong>Tings could not finish opening.</strong><span>Your data is still on this device.</span><button type="button">try again</button></div>';
    const retry = list.querySelector('button');
    if(retry)retry.addEventListener('click',()=>location.reload());
    return true;
  }
  window.tingsRecoverHomeBoot = recoverHomeBoot;
  setTimeout(recoverHomeBoot,15 * 1000);
})();
