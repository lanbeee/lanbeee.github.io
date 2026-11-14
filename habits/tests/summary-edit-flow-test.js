// Summary recovery and proposal review, using real controls and synthetic data.
// Optional pinned Needle assets exercise the same sends with actual inference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium,BASE,baseHabit,waitForAssistant} = require('./helpers/planner-test-helpers');
const live = Boolean(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH);
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(live)await page.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,localAssistant:true,localAssistantProvider:'needle',showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(h=>save([h,{...h,hid:'read',name:'Read'},
      {...h,hid:'task',name:'Renew passport',type:'task',target:null,dueDate:new Date('2026-11-27T12:00:00').getTime()},
      {...h,hid:'event',name:'Piano lesson',appointment:{repeat:'weekly',startDate:'2026-11-03',startMinute:1050,weekdays:[2],exceptions:{}}}]),
      baseHabit({hid:'gym',name:'Gym workout',durationMinutes:60}));
    const open=async hid=>{
      await page.evaluate(hid=>openDetail(load().findIndex(h=>h.hid===hid)),hid);
      await page.locator('.detail-page-tab[aria-label="summary"]').click();
      await page.waitForFunction(()=>detailSummaryOnScreen());
    };
    await open('gym');
    assert.match(await page.locator('#detail-summary').innerText(),/Download the assistant/);
    if(live){await page.evaluate(()=>assistantNeedleDownload());await page.waitForFunction(()=>assistantNeedleCanSend());}
    else await page.evaluate(()=>{
      assistantNeedleCanSend=()=>true;
      const turn=assistantFocusTurn;window.summaryRealTurn=turn;
      assistantFocusTurn=(s,text,opts)=>turn(s,text,{...opts,rank:async()=>({rankings:[]}),extract:async spec=>{
        const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
        const args=spec.family==='families'?{evidence:'',outside:''}:spec.family==='completeness'?{missing:''}
          :spec.family==='family-routing'?{family:''}:spec.family==='field-routing'?{field:''}
          :{[key]:property.enum?.[0]||''};
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }});
      renderDetailSummaryOverview();syncDetailSummaryDock();
    });
    const before=await page.evaluate(()=>load());
    // Overview links reveal the field without activating a text keyboard.
    await page.locator('#detail-summary [data-summary-field="durationMinutes"]').click();
    await page.waitForFunction(()=>$('detail-duration').classList.contains('detail-search-hit'));
    assert.equal(await page.evaluate(()=>document.activeElement.id==='detail-duration'),false);
    assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').classList.contains('detail-editing')),false);
    await page.evaluate(()=>scrollDetailToNav('summary'));
    const ask=async text=>{
      await page.locator('#detail-ask-input').fill(text);
      await page.locator('#detail-ask-input').press('Enter');
      await page.waitForFunction(()=>!detailSummary.busy,null,{timeout:180000});
    };
    const active='#detail-summary-thread [data-detail-proposal]:not(.is-retired)';
    await ask('change it');
    assert.equal(await page.locator(`${active} [data-focus-save]`).count(),0,'a question cannot save or claim to open staged edits');
    assert.equal(await page.locator('#detail-ask-guides-row button').first().innerText(),'Frequency','common settings lead the suggestions');
    await page.locator('#detail-ask-guides-row [data-detail-guide="durationMinutes"]').click();
    await ask('40 minutes');
    assert.equal(await page.evaluate(()=>detailSummary.session.unresolved.length),0,'a guided answer clears the original question');
    assert.equal(await page.locator(`${active} [data-focus-save]`).isEnabled(),true);
    assert.match(await page.locator(active).innerText(),/Duration · 60 min → 40 min/);
    assert.deepEqual(await page.evaluate(()=>load()),before,'review never writes data');
    await page.evaluate(()=>closeDetail());
    await open('read');await open('gym');
    assert.equal(await page.locator(`${active} [data-focus-save]`).isEnabled(),true,'closing and switching items preserves the proposal');
    assert.match(await page.locator(active).innerText(),/40 min/);
    await page.locator(`${active} [data-focus-save]`).click();
    await page.waitForFunction(()=>load()[0].durationMinutes===40);
    await page.waitForTimeout(300);
    const clear=await page.evaluate(()=>{
      const bubble=[...detailSummaryThread().children].at(-1).getBoundingClientRect();
      const toast=$('action-toast').getBoundingClientRect();
      return bubble.bottom<=toast.top || bubble.left>=toast.right || bubble.right<=toast.left;
    });
    assert(clear,'undo toast leaves the confirmation visible');
    await page.locator('#action-undo').first().click();
    await page.waitForFunction(()=>load()[0].durationMinutes===60);
    const stage=async (changes,issue=null)=>page.evaluate(({changes,issue})=>{
      detailSummaryReset(detailSummary.hid);const s=detailSummaryEnsureSession();
      changes.forEach(([field,value])=>assistantFocusStage(s,{field,value,origin:'correction'}));
      if(issue)assistantFocusUnresolve(s,issue);
      detailSummaryShowProposal();
    },{changes,issue});
    await stage([['durationMinutes',40]],{field:'allowedWindow',question:'Which hours?'});
    assert.equal(await page.locator(`${active} [data-focus-save]`).isDisabled(),true);
    assert(Number(await page.locator(`${active} [data-focus-save]`).evaluate(e=>getComputedStyle(e).opacity))<1,'blocked Save looks disabled');
    await stage([['name','Strength training'],['durationMinutes',40]]);
    assert.match(await page.locator(active).innerText(),/Name · Gym workout → Strength training/);
    await page.locator(`${active} [data-focus-drop="durationMinutes"]`).click();
    assert.deepEqual(await page.evaluate(()=>detailSummary.session.changes.map(c=>c.field)),['name']);
    await page.locator(`${active} [data-focus-save]`).click();
    await page.waitForFunction(()=>load()[0].name==='Strength training');
    assert.equal(await page.evaluate(()=>load()[0].durationMinutes),60,'dropping a chip preserves that saved setting');
    await page.evaluate(()=>hideActionToast());
    await stage([['durationMinutes',35]]);
    assert.equal(await page.locator(`${active} [data-focus-edit]`).innerText(),'adjust in editor');
    await page.locator(`${active} [data-focus-edit]`).click();
    await page.waitForFunction(()=>$('detail-duration').classList.contains('detail-search-hit'));
    await page.locator('#detail-duration').blur();
    assert.equal(await page.locator('#detail-duration').inputValue(),'35');
    assert.equal(await page.evaluate(()=>getSheetInner('detail-sheet').classList.contains('tune-dirty')),true);
    assert.equal(await page.evaluate(()=>load()[0].durationMinutes),60,'Adjust opens unsaved values');
    await page.evaluate(()=>restoreDetailTune());
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.evaluate(()=>scrollDetailToNav('summary'));
    await page.waitForFunction(()=>detailSummaryOnScreen());
    await stage([]);
    await ask('make Read 10 minutes');
    assert.match(await page.locator(active).innerText(),/DIFFERENT ITEM/);
    assert.equal(await page.locator(`${active} [data-focus-edit]`).count(),0);
    assert.equal(await page.locator('#detail-ask-guides-row button:visible').count(),0,'another item does not suggest this item’s settings');
    await page.locator(`${active} [data-focus-open-item="read"]`).click();
    assert.equal(await page.evaluate(()=>detailSummary.hid),'read');
    assert.equal(await page.locator('#detail-ask-input').inputValue(),'make Read 10 minutes','switching items lets the user review the request before sending');
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid==='read').durationMinutes),60);
    await page.evaluate(()=>detailSummaryReset(detailSummary.hid));
    await ask('how many times did I go this month?');
    assert.match(await page.locator(active).innerText(),/can’t answer questions/);
    await page.locator(`${active} [data-focus-open-nav="calendar"]`).click();
    await page.waitForFunction(()=>detailCurrentNav()==='calendar');
    await open('task');
    await ask('push it to next Friday');
    assert.deepEqual(await page.evaluate(()=>detailSummary.session.changes.map(c=>c.field)),['dueDate'],'a single due date cannot restrict repeating weekdays');
    assert.match(await page.locator(active).innerText(),/Due date · Fri, Nov 27 →/);
    await open('event');
    assert.doesNotMatch(await page.locator('#detail-summary').innerText(),/Shared display · mark done/);
    await ask('move it to 6pm');
    assert.equal(await page.evaluate(()=>detailSummary.session.changes.find(c=>c.field==='appointmentStartMinute')?.value),1080);
    assert.equal(await page.locator(`${active} [data-focus-save]`).isDisabled(),true,'recurring events need scope before Save');
    await page.locator(`${active} [data-focus-choice="eventScope"][data-focus-value="series"]`).click();
    assert.equal(await page.locator(`${active} [data-focus-save]`).isEnabled(),true);
    await open('read');await page.evaluate(()=>detailSummaryReset(detailSummary.hid));
    await ask('pause it for two weeks');
    assert.deepEqual(await page.evaluate(()=>detailSummary.session.changes.map(c=>c.field)),['snoozedUntil']);
    assert.equal(await page.locator(`${active} [data-focus-save]`).isEnabled(),true);
    await page.evaluate(()=>detailSummaryReset(detailSummary.hid));
    await ask('I did it yesterday');
    assert.match(await page.locator(active).innerText(),/CONFIRM/);
    await page.locator(`${active} [data-focus-choice="item-action"]`).click();
    assert.equal(await page.locator(active).count(),0,'completed log retires the confirmation without an empty proposal');
    assert.doesNotMatch(await page.locator('#detail-summary-thread').innerText(),/Nothing to change yet/);
    assert.match(await page.locator('#detail-summary-thread').innerText(),/Logged/);
    assert.equal(await page.evaluate(()=>load().find(h=>h.hid==='read').logs.length),1);
    if(!live){
      await open('gym');await page.evaluate(()=>{
        hideActionToast();detailSummaryReset(detailSummary.hid);
        const session=detailSummaryEnsureSession();
        const gate=new Promise(resolve=>window.summaryRelease=resolve);
        assistantFocusTurn=summaryRealTurn;
        window.summaryPending=detailSummaryRead(session,'make it 25 minutes',{
          rank:async()=>({rankings:[]}),extract:async spec=>{
            window.summaryReading=true;await gate;
            const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
            return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
          }
        });
      });
      await page.waitForFunction(()=>window.summaryReading);
      await page.evaluate(()=>closeDetail());await open('gym');
      await page.evaluate(async()=>{summaryRelease();await summaryPending;});
      assert.equal(await page.evaluate(()=>detailSummary.session.changes.length),0,'late extraction cannot modify a reopened draft');
      assert.match(await page.locator(active).innerText(),/Request paused/);
      assert.equal(await page.locator(`${active} [data-focus-choice="resume"]`).isEnabled(),true);
      await page.evaluate(()=>{
        assistantFocusTurn=(session,text,opts)=>summaryRealTurn(session,text,{...opts,rank:async()=>({rankings:[]}),extract:async spec=>{
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:property.enum?.[0]||''}}]};
        }});
      });
      await page.locator(`${active} [data-focus-choice="resume"]`).click();
      await page.waitForFunction(()=>!detailSummary.busy);
      assert.equal(await page.evaluate(()=>detailSummary.session.changes.find(c=>c.field==='durationMinutes')?.value),25);
      assert.equal(await page.locator(`${active} [data-focus-save]`).isEnabled(),true,'paused reads finish after Continue');
    }
    for(const [width,height,minimal] of [[320,568,true],[390,844,false],[1440,900,false]]){
      await page.setViewportSize({width,height});
      await page.waitForFunction(width=>paneTierActive()===(width>1000),width);
      await page.evaluate(minimal=>setMinimalMode(minimal),minimal);
      await open('gym');
      await stage([['durationMinutes',40],['name','Strength training'],['allowedWeekdays',[5]]]);
      await page.locator(`${active} [data-focus-save]`).click({trial:true});
      await page.screenshot({path:`test-results/summary-review-${width}.png`});
      if(minimal){
        await stage([],{field:'request',notice:'question',openNav:'calendar',question:'Open History to see your logs.'});
        await page.locator(`${active} [data-focus-open-nav="calendar"]`).click();
        assert.equal(await page.locator('#detail-calendar').isVisible(),true,'History remains reachable from a minimal-mode question');
        assert.equal(await page.evaluate(()=>isMinimalMode()),true);
      }
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS Summary edit flow (${live?'real Needle':'scripted host'}): clarification, save/undo, retained proposals, chip removal, notices, history, dates, event scope and snooze`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
