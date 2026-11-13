// Actual minimal detail -> Ask Needle on Summary -> review -> Save -> reload -> undo.
// Optional pinned assets use real inference; otherwise only evidence selection
// is scripted. Synthetic fixtures never replace the user's saved library.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,BASE,baseHabit,waitForAssistant}=require('./helpers/planner-test-helpers');
const live=Boolean(process.env.NEEDLE_MODEL_PATH&&process.env.NEEDLE_WASM_PATH);
const report=process.env.MINIMAL_REPORT||`test-results/needle-minimal-ui-${live?'live':'scripted'}.json`;
const cases=[
  ['Change it from daily to Monday to Friday',{allowedWeekdays:[1,2,3,4,5]}],
  ["Change this daily habit to all day's except Friday",{allowedWeekdays:[0,1,2,3,4,6]}],
  ['Monday through Friday',{allowedWeekdays:[1,2,3,4,5]}],
  ['All days except Friday',{allowedWeekdays:[0,1,2,3,4,6]}],
  ['Only between 9am and 5pm',{allowedTimeStart:540,allowedTimeEnd:1020}],
  ['Make each session 20 minutes',{durationMinutes:20}],
  ['Enable tap to start',{tapStartsSession:true}],
  ['Convert this task to a habit',{type:'keepup'},'task'],
  ['Set the start time to 3:30pm',{clock:930},'task']
];
(async()=>{
  const browser=await chromium.launch({headless:true});
  const results=[],errors=[];
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    page.on('pageerror',error=>errors.push(error.message));
    if(live)await page.route('https://huggingface.co/**',route=>route.fulfill({body:fs.readFileSync(route.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:true,localAssistant:true,localAssistantProvider:'needle',showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(async isLive=>{
      if(isLive){await assistantNeedleDownload();return;}
      assistantNeedleCanSend=()=>true;
      const turn=assistantFocusTurn;
      assistantFocusTurn=(session,text,options)=>turn(session,text,{...options,rank:async()=>({rankings:[]}),extract:async spec=>{
        const key=Object.keys(spec.tool.parameters.properties)[0];
        const args=spec.family==='families'?{evidence:'',outside:''}:spec.family==='completeness'?{missing:''}:{[key]:spec.tool.parameters.properties[key].enum?.[0]||''};
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }});
    },live);
    // Audit the actual visible controls, including conditional minimal layouts.
    // A newly exposed input must have a focused field before this test passes.
    const inventory=await page.evaluate(fixture=>{
      saveSortSettings({...loadSortSettings(),locations:[{id:'home',name:'Home',lat:40,lng:-74}],weatherProfiles:[{id:'dry',name:'Dry',rules:[]}]});
      const rows=[];
      for(const [layout,extra] of [['habit',{}],['task',{type:'task',target:null}],['stop',{type:'zero'}],['weather',{repeatMode:'opportunity',conditionTrigger:'weather'}],['location',{repeatMode:'opportunity',conditionTrigger:'location',locationIds:['home']} ]]){
        save([{...fixture,hid:'inventory',...extra}]);openDetail(0);showDetailMinimalTab('settings');
        document.querySelectorAll('#detail-sheet details').forEach(el=>{el.open=true;});
        const special={'detail-times':'timesPerPeriod','detail-days':'periodDays','detail-place-chips':'places'};
        const inputs=[...document.querySelectorAll('#detail-sheet .detail-pager input:not([type="search"]),#detail-sheet .detail-pager select,#detail-sheet .detail-pager .setting-switch')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        for(const el of inputs){
          const field=special[el.id]||Object.entries(ASSISTANT_FIELD_SEARCH).find(([,id])=>el.closest(`#${id}`))?.[0];
          rows.push({layout,control:el.id,field:field||null});
        }
      }
      return rows;
    },baseHabit({name:'Inventory'}));
    assert.deepEqual(inventory.filter(row=>!row.field),[],'all editable inputs exposed in minimal mode have an assistant field');
    for(const [prompt,expected,kind] of cases){
      await page.evaluate(({fixture,kind})=>{
        save([{...fixture,hid:'target',type:kind==='task'?'task':'keepup',target:kind==='task'?null:1,
          rhythm:kind==='task'?null:{timesPerPeriod:1,periodDays:1},
          dueDate:kind==='task'?new Date('2026-11-09T00:00:00-05:00').getTime():null,
          eventTime:kind==='task'?new Date('2026-11-09T09:00:00-05:00').getTime():null},
          {...fixture,hid:'other',name:'Other daily item',durationMinutes:45}]);
        openDetail(0);
      },{fixture:baseHabit({name:'Morning stretch',logs:[{ts:1}],priority:1,preferredWeekdays:[2],minGapMinutes:10}),kind});
      const before=await page.evaluate(()=>load());
      await page.locator('#detail-search-toggle').click();
      await page.locator('#detail-search-input').fill(prompt);
      await page.locator('#detail-search-ask').click();
      await page.waitForFunction(prompt=>detailSummary.session?.currentRequest===prompt&&!detailSummary.busy&&!detailAssistantOpening,prompt,{timeout:120000});
      const staged=await page.evaluate(()=>({record:assistantFocusMaterialize(detailSummary.session),questions:detailSummary.session.unresolved,trace:detailSummary.session.trace}));
      assert.deepEqual(await page.evaluate(()=>load()),before,'review does not write');
      assert.deepEqual(staged.questions,[],prompt);
      for(const [key,value] of Object.entries(expected)){
        if(key==='clock'){
          const d=new Date(staged.record.eventTime);assert.equal(d.getHours()*60+d.getMinutes(),value,prompt);
        }else assert.deepEqual(staged.record[key],value,prompt);
      }
      await page.locator('#detail-summary-thread [data-focus-save]').click();
      await page.waitForFunction(()=>!detailSummary.session&&$('detail-summary-thread').textContent.includes('Saved.'));
      const after=await page.evaluate(()=>load());
      assert.deepEqual(after[1],before[1],'other item is untouched');
      const allowed=new Set([...Object.keys(expected).filter(key=>key!=='clock'),...(expected.clock!=null?['eventTime']:[]),...(expected.type?['target','rhythm','dueDate','eventTime','hardDue']:[])]);
      for(const key of Object.keys(before[0]))if(!allowed.has(key))assert.deepEqual(after[0][key],before[0][key],`${prompt}: preserves ${key}`);
      await page.evaluate(()=>{openDetail(0);showDetailMinimalTab('settings');});
      if(expected.allowedWeekdays){
        await page.locator('#detail-availability-disclosure > summary').click();
        assert.deepEqual(await page.evaluate(()=>selectedWeekdaysFrom('detail-weekday-chips')),expected.allowedWeekdays,'saved weekday chips reflect the request');
      }
      await page.locator('#action-undo').click();
      await page.waitForFunction(before=>JSON.stringify(load())===JSON.stringify(before),before);
      assert.deepEqual(await page.evaluate(()=>load()),before,'undo restores the item');
      results.push({prompt,expected,before,staged,after,undo:true});
      fs.writeFileSync(report,JSON.stringify({live,inventory,results},null,2));
      console.log(`PASS ${live?'live Needle':'host'} minimal detail: ${prompt}`);
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
