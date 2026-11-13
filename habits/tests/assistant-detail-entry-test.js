// Shared detail search -> Summary tab composer -> explicit save. Extraction is scripted;
// the entry, field pipeline, preview and commit use production code.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,localAssistantProvider:'needle',showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(h=>{
      save([h,{...h,hid:'read',name:'Read',durationMinutes:45}]);
      window.entryReads=[];
      window.entryCanSend=assistantNeedleCanSend;
      assistantNeedleCanSend=()=>true;
      window.entryFocusTurn=assistantFocusTurn;
      assistantFocusTurn=(session,text,options)=>{
        entryReads.push({target:session.targetId,text});
        return entryFocusTurn(session,text,{
          ...options,rank:async()=>({rankings:[]}),extract:async spec=>{
            if(spec.family==='families')return {confidence:.95,function_calls:[{arguments:{evidence:'',outside:''}}]};
            if(spec.family==='completeness')return {confidence:.95,function_calls:[{arguments:{missing:''}}]};
            const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
            return {confidence:.95,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
          }
        });
      };
      openDetail(0);
    },baseHabit({hid:'walk',name:'Walk',durationMinutes:20}));
    const search=async text=>{
      if(!await page.locator('#detail-search-panel').isVisible())await page.locator('#detail-search-toggle').click();
      await page.locator('#detail-search-input').fill(text);
    };
    const reads=()=>page.evaluate(()=>entryReads.length);
    await search('duration');
    assert.equal(await reads(),0,'typing and search never run inference');
    assert.ok(await page.locator('#detail-search-ask').isVisible(),'explicit Ask is available even with matching settings');
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#detail-duration').isVisible(),'Enter on matching search opens the setting');
    assert.equal(await reads(),0,'search navigation makes no model call');
    await page.locator('#detail-duration').blur();

    for(const [width,minimal] of [[390,false],[1440,false],[390,true]]){
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(width=>paneTierActive()===(width>1000),width);
      await page.evaluate(minimal=>{setMinimalMode(minimal);openDetail(0);},minimal);
      const before=await page.evaluate(()=>load());
      const beforeReads=await reads();
      await search('Make Walk 30 minutes');
      assert.ok(await page.locator('#detail-search-ask').isVisible());
      if(minimal)await page.keyboard.press('Enter');
      else await page.locator('#detail-search-ask').click();
      await page.waitForFunction(count=>entryReads.length>count && detailSummary.session?.currentRequest==='Make Walk 30 minutes' && !detailSummary.busy && !detailAssistantOpening,beforeReads);
      const staged=await page.evaluate(()=>({
        operation:detailSummary.session.operation,target:detailSummary.session.targetId,
        draft:assistantFocusMaterialize(detailSummary.session),onSummary:detailSummaryOnScreen(),
        thread:$('detail-summary-thread').textContent,query:$('detail-search-input').value
      }));
      assert.equal(staged.operation,'edit');assert.equal(staged.target,'walk');
      assert.equal(staged.onSummary,true,'Ask lands on the Summary tab');assert.equal(staged.draft.name,'Walk');
      assert.equal(staged.draft.durationMinutes,30,'focused instruction stages duration');
      assert.ok(staged.thread.includes('Make Walk 30 minutes'),'typed instruction appears in the summary thread');
      assert.equal(staged.query,'','sent search text clears');
      assert.deepEqual(await page.evaluate(()=>load()),before,'opening the composer and staging never write');
      await page.locator('#detail-summary-thread [data-focus-save]').click();
      await page.waitForFunction(()=>load()[0].durationMinutes===30);
      assert.deepEqual(await page.evaluate(()=>load()[1]),before[1],'other named item stays untouched');
      await page.evaluate(()=>{const items=load();items[0].durationMinutes=20;save(items);openDetail(0);});
    }

    await page.evaluate(()=>{
      const items=load();
      items.push({...items[0],hid:'task',name:'Book a visit',type:'task',target:null});
      items.push({...items[0],hid:'event',name:'Class',type:'keepup',durationMinutes:60,
        appointment:{repeat:'once',startDate:todayIso(),startMinute:600,weekdays:[],exceptions:{}}});
      save(items);setMinimalMode(false);
    });
    for(const [index,kind,hid] of [[2,'task','task'],[3,'event','event']]){
      await page.evaluate(index=>openDetail(index),index);
      const count=await reads(),before=await page.evaluate(()=>load());
      await search('Make it 35 minutes');await page.locator('#detail-search-ask').click();
      await page.waitForFunction(count=>entryReads.length>count && !detailSummary.busy,count);
      const focus=await page.evaluate(()=>({kind:detailSummary.session.kind,target:detailSummary.session.targetId,
        duration:assistantFocusMaterialize(detailSummary.session).durationMinutes}));
      assert.deepEqual(focus,{kind,target:hid,duration:35},'task and local event use the same focused entry');
      assert.deepEqual(await page.evaluate(()=>load()),before,'dismissing task or event previews leaves them untouched');
    }

    // Dirty fields must not silently fall out of the edit when asking Needle.
    await page.evaluate(()=>{setMinimalMode(false);openDetail(0);scrollDetailToNav('identity');});
    await page.locator('#detail-habit-message').fill('Manual draft');
    const count=await reads();
    assert.equal(await page.evaluate(()=>openDetailAssistant('Make it 40 minutes')),false);
    assert.equal(await reads(),count);
    assert.equal(await page.locator('#detail-habit-message').inputValue(),'Manual draft');
    assert.equal(await page.evaluate(()=>load()[0].name),'Walk');
    await page.evaluate(()=>restoreDetailTune());

    // Delayed optional loading must not deliver to a newly selected item.
    const stale=await page.evaluate(async()=>{
      openDetail(0);
      const original=tingsLoadAssistant;
      let release;tingsLoadAssistant=()=>new Promise(resolve=>{release=resolve;});
      const pending=openDetailAssistant('Make it 40 minutes');
      openDetail(1);release(true);
      const result=await pending;tingsLoadAssistant=original;
      return result;
    });
    assert.equal(stale,false);assert.equal(await reads(),count);
    await page.evaluate(()=>openDetail(0));
    await search('Make it 35 minutes');
    await page.locator('#detail-search-input').dispatchEvent('keydown',{key:'Enter',isComposing:true});
    assert.equal(await reads(),count,'IME composition cannot submit');
    await page.locator('#detail-search-clear').click();
    assert.equal(await page.locator('#detail-search-ask').isVisible(),false,'empty query has no Ask action');

    // Without downloaded assets the instruction waits in the Summary composer.
    await page.evaluate(()=>{
      assistantNeedleCanSend=()=>false;
      openDetail(0);
    });
    const longInstruction='Set duration to 35 minutes. '+ 'Keep the other settings unchanged. '.repeat(8);
    await search(longInstruction);await page.locator('#detail-search-ask').click();
    await page.waitForFunction(()=>!detailAssistantOpening);
    assert.equal(await page.locator('#detail-ask-input').inputValue(),longInstruction.trim(),'full instruction survives setup without search truncation');
    assert.equal(await reads(),count);

    await page.evaluate(()=>{patchLocalAssistant({localAssistant:false});openDetail(0);});
    await search('duration');
    assert.equal(await page.locator('#detail-search-ask').isVisible(),false,'assistant off preserves ordinary search');
    assert.ok(await page.locator('.detail-search-result').count());
    await page.evaluate(()=>{
      patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});
      const items=load();items[0].source='ics';save(items);openDetail(0);renderDetailSearch();
    });
    assert.equal(await page.locator('#detail-search-ask').isVisible(),false,'imported items stay outside focused editing');
    assert.deepEqual(errors,[]);
    console.log('PASS shared search, Summary composer, confirmation, mobile/desktop/minimal, unsaved edits, loading races, setup and off state');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
