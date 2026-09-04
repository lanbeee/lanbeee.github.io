// Runs before any application script. Meta CSP cannot set frame-ancestors, so
// GitHub Pages needs an explicit frame-bust for both owner and display pages.
(function(){
  let framed = false;
  try{ framed = window.top !== window.self; }
  catch(_){ framed = true; }
  if(!framed) return;
  document.documentElement.replaceChildren();
  try{ window.stop(); }catch(_){}
  throw new Error('page_not_framable');
})();
