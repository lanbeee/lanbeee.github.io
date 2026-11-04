const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // The native bridge runs before config.js in both packaged entry pages.
    await page.addInitScript(()=>{window.Capacitor={isNativePlatform:()=>true};window.TingsNative={isNative:true,platform:'android',notifications:{
      permissions:async()=>({display:'denied'}),exactAlarmPermission:async()=>({exact_alarm:'denied'}),pending:async()=>({notifications:[]})
    }};});
    await page.route(/habits-share.*workers\.dev/,r=>r.fulfill({json:{}}));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const result=await page.evaluate(async()=>{
      const pairing=await shareNewAgendaPairingRequest();
      const href=agendaPairingOwnerHref(pairing),parsed=parseHouseholdAgendaPairingUrl(href);
      const altered=new URL(href);altered.hostname='example.test';
      const path=new URL(href);path.pathname='/other/';
      const query=new URL(href);query.search='?redirect=1';
      const credentials=new URL(href);credentials.username='fake';
      return {configured:shareConfigured(),worker:shareWorkerBaseUrl(),href,accepted:parsed?.pairingId===pairing.pairingId,
        rejected:[altered,path,query,credentials].every(url=>parseHouseholdAgendaPairingUrl(url.href)===null),
        localApp:shareAppDirectoryUrl().origin===location.origin,
        join:document.getElementById('settings-agenda-join')?.getAttribute('href')};
    });
    assert.equal(result.worker,'https://habits-share.contactnabilkhan.workers.dev','Android uses the production relay even on localhost');
    assert(result.configured,'real Capacitor devices must be able to pair and sync');
    assert(result.href.startsWith('https://lanbeee.github.io/habits/#agendaPair='));
    assert(result.accepted && result.rejected,'native pairing accepts only the canonical public URL');
    assert(result.localApp,'the full app stays inside the native local origin');
    assert.equal(result.join,'./agenda-display.html');
    assert.deepEqual(errors,[]);
    console.log('Android clone pairing: production relay, canonical QR validation, native-local navigation and join control passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
