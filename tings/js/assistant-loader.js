// The assistant is experimental and must never participate in critical boot.
// Core scripts already called render() before this deferred file runs, so the
// home list is not waiting on these downloads.
(function(){
  const sources = [
    './js/assistant-schema.js',
    './js/assistant-parse.js',
    './js/assistant-tools.js',
    './js/assistant-harness.js',
    './js/assistant-client.js',
    './js/assistant-ui.js'
  ];
  let loadPromise = null;

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const script = document.createElement('script');
      script.src = src;
      script.onload = ()=>resolve();
      script.onerror = ()=>reject(new Error(`assistant_script_unavailable:${src}`));
      document.body.appendChild(script);
    });
  }

  function loadAssistantBundle(){
    if(loadPromise)return loadPromise;
    loadPromise = (async()=>{
      for(const src of sources)await loadScript(src);
      return true;
    })().catch(error=>{
      // Core Tings is already running. Keep the optional feature off rather
      // than allowing a partial assistant bundle to affect the app shell.
      console.warn('[tings assistant] optional bundle unavailable',error);
      loadPromise = null;
      return false;
    });
    return loadPromise;
  }

  async function ensureAssistantThen(run){
    const ok = await loadAssistantBundle();
    if(ok && typeof run === 'function')run();
  }

  document.addEventListener('click',event=>{
    const open = event.target.closest('#open-assistant, #bar-open-assistant');
    const toggle = event.target.closest('#setting-local-assistant');
    if(!open && !toggle)return;
    if(typeof window.openAssistantSheet === 'function')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(open){
      void ensureAssistantThen(()=>{
        if(typeof window.openAssistantSheet === 'function')window.openAssistantSheet();
      });
      return;
    }
    void ensureAssistantThen(()=>{
      if(typeof window.patchLocalAssistant === 'function'){
        window.patchLocalAssistant({localAssistant:true});
      }
    });
  },true);

  window.tingsLoadAssistant = loadAssistantBundle;
  void loadAssistantBundle();
})();
