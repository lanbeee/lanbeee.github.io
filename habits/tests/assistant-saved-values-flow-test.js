// Saved-name edits through the mobile product entry, review, choices, Save and
// undo. Set both NEEDLE_*_PATH variables to use unmodified pinned inference.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,BASE,baseHabit,waitForAssistant}=require('./helpers/planner-test-helpers');
const live=Boolean(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH);
const results=[];
const cases=[
  {prompt:'Change the location to home',kind:'task',expected:{locationIds:['home'],anywhereAllowed:false},anywhere:'no',bounded:true},
  {prompt:'Change the location to home',expected:{locationIds:['home'],anywhereAllowed:true},anywhere:'yes',bounded:true},
  {prompt:'Please update its location to Home',restricted:true,expected:{locationIds:['home']},bounded:true},
  {prompt:'Switch the place to Wrok',restricted:true,expected:{locationIds:['work']},bounded:true},
  {prompt:'The location should be "Home"',restricted:true,expected:{locationIds:['home']}},
  {prompt:'Change the location to Home Annex',pick:['work'],anywhere:'no',expected:{locationIds:['work'],anywhereAllowed:false}},
  {prompt:'Change the location to LocationC',pick:['a'],anywhere:'no',expected:{locationIds:['a'],anywhereAllowed:false}},
  {prompt:'Change the topic to Health',expected:{topics:['Health']},bounded:true},
  {prompt:'Update the weather profile to Dry',expected:{weatherProfileMode:'profile',weatherProfileId:'dry'},bounded:true},
  {prompt:'Change the weather location to Home',expected:{weatherLocationId:'home'},bounded:true},
  {prompt:'Change the location to home and make it 20 minutes',restricted:true,expected:{locationIds:['home'],durationMinutes:20},bounded:true},
  {prompt:'Only at Home',expected:{locationIds:['home'],anywhereAllowed:false}}
];
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  const errors=[];
  try{
    const page=await browser.newPage({viewport:{width:411,height:826},serviceWorkers:'block',timezoneId:'America/New_York'});
    page.on('pageerror',error=>errors.push(error.message));
    if(live)await page.route('https://huggingface.co/**',route=>route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:true,localAssistant:true,localAssistantProvider:'needle',showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async isLive=>{
      if(isLive){if(!await assistantNeedleDownload())throw new Error('Needle download failed');return;}
      assistantNeedleCanSend=()=>true;
      const turn=assistantFocusTurn;
      assistantFocusTurn=(session,text,options)=>turn(session,text,{...options,rank:async()=>({rankings:[]}),extract:async spec=>{
        const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
        const args=spec.family==='families'?{evidence:'',outside:''}:spec.family==='completeness'?{missing:''}
          :spec.family==='family-routing'?{family:'conversation'}:{[key]:property.enum?.[0]||''};
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }});
    },live);
    for(const test of cases){
      await page.evaluate(({fixture,test})=>{
        saveSortSettings({...loadSortSettings(),locations:[
          {id:'home',name:'Home',lat:40,lng:-74},{id:'work',name:'Work',lat:41,lng:-74},
          {id:'a',name:'LocationA',lat:40,lng:-74},{id:'b',name:'LocationB',lat:41,lng:-74}
        ],topics:['Health','Work'],weatherProfiles:[{id:'dry',name:'Dry',rules:[{metric:'precipitation',max:1}]}]});
        save([{...fixture,hid:'target',type:test.kind==='task'?'task':'keepup',anywhereAllowed:!test.restricted,locationIds:['work'],topics:['Work']},
          {...fixture,hid:'other',name:'Other item',durationMinutes:45}]);
        openDetail(0);
      },{fixture:baseHabit({name:'Reading',logs:[{ts:1}],priority:1,preferredWeekdays:[2],minGapMinutes:10}),test});
      const before=await page.evaluate(()=>load());
      await page.locator('#detail-search-toggle').click();
      await page.locator('#detail-search-input').fill(test.prompt);
      await page.locator('#detail-search-ask').click();
      await page.waitForFunction(prompt=>detailSummary.session?.currentRequest===prompt&&!detailSummary.busy&&!detailAssistantOpening,test.prompt,{timeout:120000});
      const snapshot=()=>page.evaluate(()=>{
        const s=detailSummary.session;
        return {record:assistantFocusMaterialize(s),questions:s.unresolved,changes:s.changes,trace:s.trace,
          calls:s.trace.filter(row=>row.inference).length,ready:assistantFocusCanSave(s)};
      });
      const initial=await snapshot();
      const row={prompt:test.prompt,initial};results.push(row);
      assert.deepEqual(await page.evaluate(()=>load()),before,'reading must not write');
      const proposal=page.locator('[data-detail-proposal]:not(.is-retired)');
      if(test.pick){
        assert.equal(initial.changes.length,0,'unknown names cannot silently pick Home');
        assert(initial.questions.some(q=>q.field==='places'),'unknown or tied name asks for the place');
        assert(!initial.questions.find(q=>q.field==='places').question.includes(test.prompt),'question refers to the unmatched name, not the whole instruction');
        assert(!initial.questions.some(q=>q.placeFollowup),'place selection precedes Anywhere');
        assert.equal(await proposal.locator('[data-focus-picker="places"] [data-focus-option]').count(),4,'all saved places are selectable');
        for(const id of test.pick)await proposal.locator(`[data-focus-option="${id}"]`).click();
        await proposal.locator('[data-focus-pick]').click();
      }
      if(test.anywhere){
        const staged=await snapshot();
        assert.deepEqual(staged.record.locationIds,test.expected.locationIds,'place stages before the follow-up');
        assert(staged.questions.some(q=>q.placeFollowup),'plain assignment asks Anywhere');
        assert(await proposal.locator('[data-focus-save]').isDisabled(),'Save waits for the answer');
        await proposal.locator(`[data-focus-choice="anywhereAllowed"][data-focus-value="${test.anywhere}"]`).click();
      }
      const staged=await snapshot();row.staged=staged;
      assert.deepEqual(staged.questions,[],`${test.prompt}: every requested field is resolved`);
      for(const [key,value] of Object.entries(test.expected))assert.deepEqual(staged.record[key],value,`${test.prompt}: ${key}`);
      if(test.expected.locationIds?.includes('home')||test.expected.weatherLocationId==='home')assert((await proposal.textContent()).includes('Home'),'proposal displays the saved name with its original casing');
      assert.equal(staged.calls,initial.calls,'picking places and answering Anywhere require no inference');
      if(test.bounded){
        assert(initial.trace.some(row=>row.method==='closed-instructions'),'complete named assignments skip discovery and retrieval');
        if(live)assert.equal(initial.calls,test.expected.durationMinutes?2:1,'one model call per requested field');
      }
      assert.deepEqual(await page.evaluate(()=>load()),before,'choices must not write');
      await page.screenshot({path:`test-results/saved-values-${live?'live':'host'}-${results.length}.png`});
      await proposal.locator('[data-focus-save]').click();
      await page.waitForFunction(()=>!detailSummary.session&&$('detail-summary-thread').textContent.includes('Saved.'));
      const after=await page.evaluate(()=>load());row.after=after;
      assert.deepEqual(after[1],before[1],'other item survives');
      for(const [key,value] of Object.entries(test.expected))assert.deepEqual(after[0][key],value,'confirmed values persist');
      for(const key of Object.keys(before[0]))if(!(key in test.expected))assert.deepEqual(after[0][key],before[0][key],`preserves ${key}`);
      await page.locator('#action-undo').click();
      await page.waitForFunction(before=>JSON.stringify(load())===JSON.stringify(before),before);
      row.undo=true;
      console.log(`PASS ${live?'live Needle':'host'} saved value: ${test.prompt}`);
    }
    assert.deepEqual(errors,[]);
  }finally{
    fs.writeFileSync(`test-results/assistant-saved-values-${live?'live':'host'}.json`,JSON.stringify({live,results,errors},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
