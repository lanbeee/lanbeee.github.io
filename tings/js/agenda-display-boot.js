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

  // Keep first paint in the saved theme, before deferred settings/UI load.
  const root = document.documentElement;
  try{
    const mode = JSON.parse(localStorage.getItem('tings_app_settings_v2'))?.themeMode;
    if(mode === 'light' || mode === 'dark')root.dataset.theme = mode;
  }catch(_){ }

  let launchRequested = false;
  let launchRevealing = false;
  let resolveLaunch;
  window.tingsWhenLaunched = new Promise(resolve=>{resolveLaunch = resolve;});
  function revealLaunch(){
    if(!launchRequested || launchRevealing || root.dataset.nativeInsets === 'pending')return;
    const screen = document.getElementById('launch-screen');
    if(!screen){insetsObserver.disconnect();resolveLaunch();return;}
    launchRevealing = true;
    // Let the completed render, header artwork and native geometry settle
    // before removing the cover. This adds frames, never a minimum dwell.
    const artwork = [...document.querySelectorAll('[data-header-brand]')]
      .map(img=>img.decode().catch(()=>{}));
    Promise.all([document.fonts.load('16px "tabler-icons"').catch(()=>{}),document.fonts.ready,...artwork]).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      root.dataset.launchState = 'ready';
      document.querySelector('.app')?.removeAttribute('inert');
      insetsObserver.disconnect();
      const done = ()=>{screen.remove();resolveLaunch();};
      if(window.TingsNative?.isNative && window.TingsNative.finishLaunch){
        // Android owns the single fade. Its splash still covers this frame.
        done();
        void window.TingsNative.finishLaunch(matchMedia('(prefers-reduced-motion: reduce)').matches).catch(()=>{});
      }else if(matchMedia('(prefers-reduced-motion: reduce)').matches){
        done();
      }else{
        screen.classList.add('is-leaving');
        setTimeout(done,180);
      }
    })));
  }
  const insetsObserver = new MutationObserver(revealLaunch);
  insetsObserver.observe(root,{attributes:true,attributeFilter:['data-native-insets']});
  // Called only after the agenda, empty state, or recovery UI has mounted.
  window.tingsFinishLaunch = ()=>{launchRequested = true;revealLaunch();};

  // This script runs before every deferred application script. It is the one
  // place that can recover if a core file fails to download or evaluate before
  // main-runtime starts the normal planner fallback timer.
  function recoverHomeBoot(){
    const list = document.getElementById('list');
    if(!list || (!list.querySelector('.home-loading') && root.dataset.launchState !== 'loading'))return false;
    try{
      if(typeof window.render === 'function'){
        window.render({deferAgenda:true});
        if(!list.querySelector('.home-loading')){window.tingsFinishLaunch();return true;}
      }
    }catch(_){ }
    list.innerHTML = '<div class="home-boot-recovery" role="alert"><strong>Tings could not finish opening.</strong><span>Your data is still on this device.</span><button type="button">try again</button></div>';
    const retry = list.querySelector('button');
    if(retry)retry.addEventListener('click',()=>location.reload());
    window.tingsFinishLaunch();
    return true;
  }
  window.tingsRecoverHomeBoot = recoverHomeBoot;
  setTimeout(recoverHomeBoot,15 * 1000);
})();
