const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  const browser = await chromium.launch();
  try{
    for(const theme of ['light','dark']){
      const context = await browser.newContext({viewport:{width:390,height:844},
        colorScheme:theme === 'light' ? 'dark' : 'light',serviceWorkers:'block'});
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*',route=>{
        if(new URL(route.request().url()).origin !== new URL(BASE).origin){
          external.push(route.request().url());return route.abort();
        }
        return route.continue();
      });
      await page.addInitScript(theme=>{
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({themeMode:theme}));
        localStorage.setItem('tings_coach_essentials_v2','1');
        localStorage.setItem('tings_v2',JSON.stringify([{hid:'launch-test',name:'A quiet start',
          type:'task',durationMinutes:20,priority:2,logs:[],createdAt:Date.now()}]));
      },theme);
      let releaseCore, releasePlanner, releaseFont;
      const coreGate = new Promise(resolve=>{releaseCore = resolve;});
      const plannerGate = new Promise(resolve=>{releasePlanner = resolve;});
      const fontGate = new Promise(resolve=>{releaseFont = resolve;});
      await page.route('**/js/config.js',async route=>{await coreGate;await route.continue();});
      await page.route('**/js/agenda-planner-worker.js?*',async route=>{await plannerGate;await route.continue();});
      await page.route('**/fonts/tabler-icons.woff2',async route=>{await fontGate;await route.continue();});
      const navigation = page.goto(BASE,{waitUntil:'load'});
      await page.waitForSelector('#launch-screen svg');
      assert.equal(await page.locator('#launch-screen').evaluate(el=>getComputedStyle(el).backgroundColor),
        theme === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(242, 241, 237)','saved theme wins before core scripts');
      assert.equal(await page.locator('.app').evaluate(el=>el.inert),true);
      assert.equal(await page.locator('.bottom-nav').isVisible(),false);
      // The cover remains steady while core scripts, then planning, are held.
      releaseCore();
      await page.waitForFunction(()=>typeof render === 'function' && document.querySelector('#list .home-loading'));
      assert.equal(await page.locator('#launch-screen').isVisible(),true);
      assert.equal(await page.locator('.bottom-nav').isVisible(),false);
      releasePlanner();
      await page.waitForFunction(()=>document.querySelector('#list .ting-card'));
      assert.equal(await page.locator('#launch-screen').isVisible(),true,'cover stays until icon font is ready');
      releaseFont();
      await navigation;
      await page.waitForSelector('#launch-screen',{state:'detached',timeout:20000});
      assert.ok(await page.locator('#list .ting-card').count(),'agenda mounted before reveal');
      assert.equal(await page.locator('.app').evaluate(el=>el.inert),false);
      assert.equal(await page.locator('.bottom-nav').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.fonts.check('16px "tabler-icons"')),true);
      assert.equal(await page.evaluate(()=>typeof L.map),'function');
      assert.deepEqual(external,[],'opening has no network dependency outside the app');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`test-results/launch-${theme}-ready.png`});
      await page.evaluate(()=>render());
      assert.equal(await page.locator('#launch-screen').count(),0,'later renders do not replay launch');
      await context.close();
    }

    // A missing core script must expose the retry screen, with reduced motion.
    const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
    await page.route('**/js/config.js',route=>route.abort());
    await page.goto(BASE,{waitUntil:'load'});
    await page.evaluate(()=>{
      // A script can fail after clearing the skeleton but before finishing UI.
      document.getElementById('list').innerHTML = '<p>unfinished render</p>';
      window.tingsRecoverHomeBoot();
    });
    await page.waitForSelector('#launch-screen',{state:'detached'});
    assert.equal(await page.locator('.home-boot-recovery button').isVisible(),true);
    await page.close();

    // First use reveals its empty state before any onboarding UI opens.
    const empty = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    await empty.goto(BASE,{waitUntil:'load'});
    await empty.waitForSelector('#launch-screen',{state:'detached'});
    assert.equal(await empty.locator('#empty').isVisible(),true);
    assert.equal(await empty.locator('.app').evaluate(el=>el.inert),false);
    await empty.close();

    // The real native window may commit after the agenda has rendered.
    const native = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
    await native.addInitScript(()=>{
      new MutationObserver((_,observer)=>{
        if(!document.documentElement)return;
        document.documentElement.dataset.nativeInsets = 'pending';
        observer.disconnect();
      }).observe(document,{childList:true});
      localStorage.setItem('tings_coach_essentials_v2','1');
    });
    await native.goto(BASE,{waitUntil:'load'});
    await native.waitForFunction(()=>typeof render === 'function' && !document.querySelector('#list .home-loading'));
    assert.equal(await native.locator('.app').evaluate(el=>el.inert),true,'agenda waits for native insets');
    await native.evaluate(()=>{
      window.launchCalls = [];
      window.TingsNative = {isNative:true,finishLaunch:async reduced=>{launchCalls.push(reduced);}};
      document.documentElement.dataset.nativeInsets = 'ready';
    });
    await native.waitForSelector('#launch-screen',{state:'detached'});
    assert.deepEqual(await native.evaluate(()=>launchCalls),[true],'native owns one reveal and receives reduced motion');
    assert.equal(await native.locator('.app').evaluate(el=>el.inert),false);
    await native.close();
    console.log('PASS steady vector launch, saved themes, ready agenda, local assets, recovery, reduced motion and first use');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
