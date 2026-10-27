// External Android tools use the real validators/previews, without a model.
const assert = require('node:assert/strict');
const {chromium, BASE, waitForAssistant} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const pwa = await browser.newPage();
    await pwa.goto(BASE);
    await waitForAssistant(pwa);
    assert(await pwa.locator('#settings-android-assistant').isHidden(), 'native controls absent in PWA');
    assert.equal(await pwa.evaluate(()=>typeof window.tingsExternalAssistant),'undefined');
    await pwa.close();
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.clear();
      window.__nativeEnabled=false;
      window.__launch=null;
      window.TingsNative={isNative:true,notifications:{permissions:async()=>({display:"denied"})},assistant:{
        state:async()=>({enabled:window.__nativeEnabled}),
        setEnabled:async({enabled})=>{window.__nativeEnabled=enabled;},
        ready:async()=>{window.__externalReady=true;},
        addListener:async(event,listener)=>{window.__launchListener=listener;},
        takeLaunchRequest:async()=>{const request=window.__launch;window.__launch=null;return {request};}
      }};
    });
    await page.goto(BASE);
    await waitForAssistant(page);
    await page.waitForFunction(()=>window.__externalReady);
    const checks=await page.evaluate(async()=>{
      const results=[];
      const check=(value,label)=>results.push({value:Boolean(value),label});
      check(!assistantEnabled(),'local assistant remains off');
      const denied=await tingsExternalAssistant.read('answer_items',{query:'list'});
      check(denied.status==='disabled','off by default');
      window.__nativeEnabled=true;
      const direct=await tingsExternalAssistant.read('delete_item',{name:'anything'});
      check(direct.status==='error','read channel refuses writes');
      const unknown=await tingsExternalAssistant.read('answer_items',{query:'list',invented:true});
      check(unknown.status==='error','unknown arguments rejected');
      const wrong=await tingsExternalAssistant.read('answer_items',{query:42});
      check(wrong.status==='error','wrong argument types rejected');
      const proto=await tingsExternalAssistant.read('answer_items',JSON.parse('{"query":"list","__proto__":{}}'));
      check(proto.status==='error','prototype keys rejected');
      const take=TingsNative.assistant.takeLaunchRequest;
      let release;
      let taking=0;
      TingsNative.assistant.takeLaunchRequest=()=>++taking===1 ? new Promise(resolve=>{release=()=>resolve({});}) : take();
      const draining=tingsExternalAssistant.drain();
      window.__launch={kind:'capture',text:'External queued capture'};
      window.__launchListener();
      release();
      await draining;
      await new Promise(resolve=>setTimeout(resolve,0));
      check(_assistantPendingDraft?.name==='External queued capture','launch arriving during empty queue check is not stranded');
      check(!load().some(h=>h.name==='External queued capture'),'queued capture remains unsaved');
      TingsNative.assistant.takeLaunchRequest=take;
      closeAssistantSheet();
      globalThis.__assistantTestComplete=()=>{throw new Error('must never call a model');};
      const before=JSON.stringify(load());
      window.__launch={kind:'tool',tool:'draft_item',arguments:{kind:'task',create:true,name:'External test task',durationMinutes:15}};
      await tingsExternalAssistant.drain();
      check($('assistant-sheet').classList.contains('open'),'opens confirmation even with local model off');
      check(JSON.stringify(load())===before,'preview does not save');
      check(_assistantPendingDraft?.name==='External test task','uses existing draft validator');
      check($('assistant-input').parentElement.hidden,'no nonfunctional local model composer');
      await commitAssistantDraft(false);
      check(load().some(h=>h.name==='External test task'),'normal confirmation saves');
      closeAssistantSheet();
      const read=await tingsExternalAssistant.read('answer_items',{query:'list',search:'External test task'});
      check(read.status==='ok' && read.text.includes('External test task'),'reads live saved data');
      check(Object.keys(read).sort().join(',')==='status,text','does not expose raw records');
      const beforePlan=JSON.stringify(load());
      window.__launch={kind:'tool',tool:'plan_item',arguments:{name:'External test task',date:'tomorrow',time:'3pm'}};
      await tingsExternalAssistant.drain();
      check(Boolean(_assistantSession.pendingPlan),'one-day plan stages existing action');
      check(JSON.stringify(load())===beforePlan,'one-day plan waits for confirmation');
      commitAssistantPlan();
      check(JSON.stringify(load())!==beforePlan && !_assistantSession.pendingPlan,'confirmed one-day plan saves');
      closeAssistantSheet();
      const beforeBatch=JSON.stringify(load());
      window.__launch={kind:'tool',tool:'draft_batch',arguments:{items:[
        {kind:'task',create:true,name:'External batch alpha'},
        {kind:'task',create:true,name:'External batch beta'}
      ]}};
      await tingsExternalAssistant.drain();
      check(assistantPendingDrafts().length===2,'batch uses shared multi-item preview');
      check(JSON.stringify(load())===beforeBatch,'batch preview does not save');
      await commitAssistantDraft(false);
      check(load().filter(h=>h.name.startsWith('External batch')).length===2,'one batch confirmation saves both items');
      closeAssistantSheet();
      const beforeEdit=JSON.stringify(load());
      window.__launch={kind:'tool',tool:'apply_items',arguments:{names:['External batch alpha','External batch beta'],durationMinutes:45}};
      await tingsExternalAssistant.drain();
      check(assistantPendingDrafts().length===2,'filtered edit stages both matching items' + (assistantPendingDrafts().length===2 ? '' : ': '+assistantThreadEl().innerText));
      check(JSON.stringify(load())===beforeEdit,'filtered edit waits for confirmation');
      await commitAssistantDraft(false);
      check(load().filter(h=>h.name.startsWith('External batch')).every(h=>h.durationMinutes===45),'filtered edit confirmation updates both items');
      closeAssistantSheet();
      const beforeSetting=JSON.stringify(loadSortSettings());
      window.__launch={kind:'tool',tool:'draft_setting',arguments:{kind:'topic',name:'External topic'}};
      await tingsExternalAssistant.drain();
      check(_assistantPendingDraft?.kind==='topic','settings use shared draft preview');
      check(JSON.stringify(loadSortSettings())===beforeSetting,'setting preview does not save');
      await commitAssistantDraft(false);
      check(JSON.stringify(loadSortSettings())!==beforeSetting,'confirmed setting saves');
      closeAssistantSheet();
      const completionLogsBefore=load().find(h=>h.name==='External test task').logs.length;
      window.__launch={kind:'tool',tool:'complete_item',arguments:{name:'External test task'}};
      await tingsExternalAssistant.drain();
      check(Boolean(_assistantSession.pendingComplete),'completion stages existing action');
      check(load().find(h=>h.name==='External test task').logs.length===completionLogsBefore,'completion not saved before confirm');
      commitAssistantComplete();
      check(load().find(h=>h.name==='External test task').logs.length===completionLogsBefore+1,'confirmation logs exactly once');
      closeAssistantSheet();
      window.__launch={kind:'tool',tool:'delete_item',arguments:{name:'External test task'}};
      await tingsExternalAssistant.drain();
      check(Boolean(_assistantSession.pendingDelete),'delete stages existing action');
      check(load().some(h=>h.name==='External test task'),'delete waits for user');
      commitAssistantDelete();
      check(!load().some(h=>h.name==='External test task'),'confirmed delete uses normal storage path');
      closeAssistantSheet();
      window.__nativeEnabled=false;
      const revoked=await tingsExternalAssistant.read('answer_items',{query:'list'});
      check(revoked.status==='disabled','revocation takes effect without reload');
      window.__launch={kind:'tool',tool:'draft_item',arguments:{kind:'task',name:'Should wait'}};
      await tingsExternalAssistant.drain();
      check($('settings-sheet').classList.contains('open'),'disabled request opens setup');
      check(!load().some(h=>h.name==='Should wait'),'disabled request cannot write');
      return results;
    });
    for(const {value,label} of checks){assert(value,label);console.log('  ok:',label);}
    assert.deepEqual(errors,[],'no browser errors');
    await page.locator('#settings-android-assistant').scrollIntoViewIfNeeded();
    assert(await page.locator('#setting-android-assistant').isVisible(),'native setup toggle is visible');
    await page.screenshot({path:'test-results/assistant-external-settings.png'});
    console.log(`${checks.length+2} external assistant checks passed`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
