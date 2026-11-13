// iPhone X touch walkthrough. WebKit uses real tap events; viewport events
// simulate the OS keyboard because desktop Playwright cannot open an iOS IME.
// Set both NEEDLE asset paths for real inference, otherwise test host behavior.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webkit,devices}=require('playwright');
const {BASE,baseHabit,waitForAssistant}=require('./helpers/planner-test-helpers');
const live=Boolean(process.env.NEEDLE_MODEL_PATH && process.env.NEEDLE_WASM_PATH);

(async()=>{
  const browser=await webkit.launch();
  const out=`test-results/summary-iphonex/${live?'live':'scripted'}`;
  fs.mkdirSync(out,{recursive:true});
  const report={engine:'WebKit',device:'iPhone X',viewport:{width:375,height:812},keyboard:'simulated',inference:live?'real Needle':'scripted host',steps:[]};
  try{
    const page=await browser.newPage({...devices['iPhone X'],serviceWorkers:'block',timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const feedbackPosts=[];
    await page.route('https://docs.google.com/**',route=>{
      feedbackPosts.push(route.request().postData() || '');
      return route.fulfill({status:200,body:'test feedback received'});
    });
    if(live)await page.route('https://huggingface.co/**',r=>r.fulfill({body:fs.readFileSync(r.request().url().endsWith('.wasm')?process.env.NEEDLE_WASM_PATH:process.env.NEEDLE_MODEL_PATH)}));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({localAssistant:true,localAssistantProvider:'needle',minimalMode:false,agendaOptimizer:false,showWeekOnHome:false}));
      for(const key of ['tings_coach_install_v2','tings_coach_essentials_v2'])localStorage.setItem(key,'done');
      const viewport=new EventTarget();Object.assign(viewport,{width:375,height:812,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
      document.addEventListener('DOMContentLoaded',()=>{
        document.documentElement.style.setProperty('--safe-area-inset-top','44px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
      });
    });
    await page.goto(BASE);await waitForAssistant(page);
    await page.locator('#launch-screen').waitFor({state:'hidden'});
    await page.evaluate(h=>{save([h,{...h,hid:'read',name:'Read'},
      ...Array.from({length:18},(_,i)=>({...h,type:'zero',hid:`background-${i}`,name:`Background ${i}`}))]);render();},baseHabit({hid:'gym',name:'Gym workout',durationMinutes:60}));
    await page.locator('#list .ting-name').filter({hasText:'Gym workout'}).first().tap();
    await page.waitForFunction(()=>detailSummaryOnScreen());
    assert.match(await page.locator('#detail-summary').innerText(),/Download Needle 3/);
    if(live){
      await page.locator('#detail-summary-setup [data-needle-download]').tap();
      await page.waitForFunction(()=>assistantNeedleCanSend(),null,{timeout:180000});
    }else await page.evaluate(()=>{
      assistantNeedleCanSend=()=>true;
      const turn=assistantFocusTurn;
      assistantFocusTurn=(s,text,opts)=>turn(s,text,{...opts,rank:async()=>({rankings:[]}),extract:async spec=>{
        const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
        const args=spec.family==='families'?{evidence:'',outside:''}:spec.family==='completeness'?{missing:''}
          :spec.family==='family-routing'?{family:''}:spec.family==='field-routing'?{field:''}
          :{[key]:property.enum?.[0]||''};
        return {confidence:1,function_calls:[{name:spec.tool.name,arguments:args}]};
      }});
      renderDetailSummaryOverview();syncDetailSummaryDock();
    });
    const input=page.locator('#detail-ask-input');
    const active='#detail-summary-thread [data-detail-proposal]:not(.is-retired)';
    const keyboard=async(open,offset=0)=>{
      for(const height of open?[700,600,477]:[600,700,812])await page.evaluate(async ({height,offset})=>{
        // Sample each paint, not just the settled state. The cover must stay
        // in place even when viewport pan/resize arrive on different frames.
        const checkFrame=async()=>{
          await new Promise(requestAnimationFrame);
          const cover=$('detail-sheet');
          if(!cover.classList.contains('open'))return;
          if(cover.getBoundingClientRect().top!==0
            || !document.elementFromPoint(20,20)?.closest('#detail-sheet,#feedback-sheet'))throw Error('Keyboard frame exposes Home');
          window.scrollTo({top:220,behavior:'instant'});
          if(scrollY!==0)throw Error('iPhone focus can still scroll the background document');
        };
        visualViewport.offsetTop=height===812?0:offset;
        visualViewport.dispatchEvent(new Event('scroll'));
        await checkFrame();
        visualViewport.height=height;
        visualViewport.dispatchEvent(new Event('resize'));
        for(let frame=0;frame<3;frame++)await checkFrame();
      },{height,offset});
    };
    const snapshot=async name=>{
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const geometry=await page.evaluate(()=>{
        const inner=getSheetInner('detail-sheet');
        const dock=inner.querySelector('.sheet-search-dock').getBoundingClientRect();
        const head=$('detail-head-card').getBoundingClientRect();
        const page=inner.querySelector('.detail-summary-page');
        const scroller=detailIsSingleView()?page.closest('.detail-pager'):page;
        const text=scroller.getBoundingClientRect();
        return {visibleTop:visualViewport.offsetTop,visibleHeight:visualViewport.height,
          headerTop:head.top,headerBottom:head.bottom,composerTop:dock.top,composerBottom:dock.bottom,
          contentTop:text.top,contentBottom:text.bottom,shadow:getComputedStyle(inner.querySelector('.sheet-search-dock')).boxShadow,
          thread:$('detail-summary-thread').innerText};
      });
      assert.equal(geometry.shadow,'none','the composer is not a floating second card');
      assert.ok(await page.locator('#detail-name').isVisible(),'the item name remains visible');
      assert.ok(geometry.headerTop>=geometry.visibleTop,'header stays inside the visible screen');
      assert.ok(geometry.contentBottom<=geometry.composerTop+1,'content has real space above the composer');
      assert.ok(geometry.composerTop>=geometry.headerBottom,'composer never overlaps the item header');
      assert.ok(geometry.composerBottom<=geometry.visibleTop+geometry.visibleHeight+1,'composer stays above the keyboard');
      await page.screenshot({path:`${out}/${name}.png`,scale:'css',clip:{x:0,y:geometry.visibleTop,width:375,height:geometry.visibleHeight}});
      report.steps.push({name,...geometry});
    };
    const send=async text=>{
      await input.tap();await keyboard(true);
      await input.fill(text);
      const count=await page.locator('#detail-summary-thread .assistant-bubble-user').count();
      await page.locator('#detail-ask-send').tap();
      await page.waitForFunction(count=>document.querySelectorAll('#detail-summary-thread .assistant-bubble-user').length>count,count,{timeout:10000});
      await page.waitForFunction(()=>!detailSummary.busy,null,{timeout:180000});
    };
    for(const minimal of [false,true]){
      const mode=minimal?'minimal':'full';
      const homeScroll=await page.evaluate(async minimal=>{
        hideActionToast();closeDetail();setMinimalMode(minimal);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        window.scrollTo({top:300,behavior:'instant'});
        const scroll=scrollY;
        openDetail(0);detailSummaryReset(detailSummary.hid);
        return scroll;
      },minimal);
      assert.ok(homeScroll>200,'open Summary from a scrolled Home feed');
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed','iPhone locks focus-driven page scroll');
      assert.equal(await page.locator('#detail-summary-feedback').isVisible(),false,'feedback stays out of an empty Summary');
      await snapshot(`${mode}-01-summary`);
      await page.locator('#detail-summary [data-summary-field="durationMinutes"]').tap();
      await page.waitForFunction(()=>$('detail-duration').classList.contains('detail-search-hit'));
      assert.notEqual(await page.evaluate(()=>document.activeElement.id),'detail-duration','overview pills reveal a field without opening its keyboard');
      await page.locator('.detail-page-tab[aria-label="summary"]').tap();
      await page.waitForFunction(()=>detailSummaryOnScreen());
      await page.locator('#detail-search-toggle').tap();
      await page.locator('#detail-search-input').fill('duration');
      await page.locator('.detail-search-result').filter({has:page.locator('b',{hasText:'Duration'})}).first().tap();
      await page.waitForFunction(()=>document.activeElement.id==='detail-duration');
      await page.locator('#detail-duration').blur();await keyboard(false);
      await page.locator('.detail-page-tab[aria-label="summary"]').tap();
      await page.waitForFunction(()=>detailSummaryOnScreen());
      const idleHeight=await page.locator('.detail-bottom-bar').evaluate(el=>el.getBoundingClientRect().height);
      await input.tap();
      assert.equal(await page.locator('#detail-ask-guides').isVisible(),false,'empty focus shows no new suggestions layer');
      assert.equal(await page.locator('.detail-bottom-bar').evaluate(el=>el.getBoundingClientRect().height),idleHeight,'empty focus keeps the same composer height');
      await keyboard(true,32);await snapshot(`${mode}-02-keyboard`);
      await input.fill('Please make this change\nwith a longer message\nthat fills several lines\nwhile I review the item\nand decide what to send.');
      await snapshot(`${mode}-02b-multiline`);
      await input.fill('');
      await send('make it 40 minutes');
      assert.match(await page.locator(active).innerText(),/Duration · 60 min → 40 min/);
      assert.equal(await page.evaluate(()=>load()[0].durationMinutes),60,'proposal is unsaved');
      await snapshot(`${mode}-03-proposal`);
      await page.locator(`${active} [data-focus-save]`).tap();await keyboard(false);
      await page.waitForFunction(()=>load()[0].durationMinutes===40);
      await snapshot(`${mode}-04-saved`);
      assert.equal(await page.locator('#detail-summary-feedback').isEnabled(),true,'a saved reply can still be reported after its edit session ends');
      const confirmationClear=await page.evaluate(()=>{
        const confirmation=[...detailSummaryThread().children].at(-1).getBoundingClientRect();
        const scroller=detailIsSingleView()?document.querySelector('.detail-pager'):document.querySelector('.detail-summary-page');
        return {bottom:confirmation.bottom,top:$('action-toast').getBoundingClientRect().top,scroll:scroller.scrollTop,height:scroller.scrollHeight,client:scroller.clientHeight,padding:getComputedStyle(scroller).paddingBottom};
      });
      assert.ok(confirmationClear.bottom<=confirmationClear.top,`undo toast leaves the saved confirmation visible: ${JSON.stringify(confirmationClear)}`);
      await page.locator('#action-undo').first().tap();
      await page.waitForFunction(()=>load()[0].durationMinutes===60);
      await page.evaluate(()=>hideActionToast());
      await send('change it');
      assert.equal(await page.locator(`${active} [data-focus-save]`).count(),0,'vague requests do not save');
      await input.fill('My next unsent request');
      const feedbackBefore=await page.evaluate(()=>({items:JSON.stringify(load()),session:detailSummary.session.id,
        reply:detailSummaryThread().innerText,head:document.querySelector('.detail-summary-chat-head').getBoundingClientRect().height}));
      await page.evaluate(()=>{
        // A separate chat's transcript must never leak into Summary feedback.
        $('assistant-thread').textContent='UNRELATED PRIVATE CHAT';
      });
      await page.locator('#detail-summary-feedback').tap();await keyboard(false);
      await page.waitForSelector('#feedback-sheet.open');
      const feedback=JSON.parse(await page.locator('#feedback-context').textContent());
      assert.ok(feedback.needle.requests.includes('change it'),'feedback includes the misunderstood request and Needle diagnostics');
      assert.ok(feedback.transcript.some(turn=>turn.role==='assistant' && /setting|detail/i.test(turn.text)),'feedback includes the actual clarification shown in Summary');
      assert.ok(!JSON.stringify(feedback).includes('UNRELATED PRIVATE CHAT'),'feedback uses only this Summary conversation');
      assert.equal(await page.locator('#feedback-note').getAttribute('required'),null,'explaining what went wrong is optional');
      assert.equal(await page.locator('#feedback-context-details').getAttribute('open'),null,'diagnostics stay collapsed');
      assert.equal(feedbackPosts.length,0,'opening feedback sends nothing');
      await page.screenshot({path:`${out}/${mode}-04b-feedback.png`,scale:'css'});
      await page.locator('#feedback-cancel').tap();
      assert.equal(await input.inputValue(),'My next unsent request','cancelling feedback retains the unsent message');
      assert.equal(await page.evaluate(()=>JSON.stringify(load())),feedbackBefore.items,'feedback never changes the saved item');
      assert.equal(await page.locator('.detail-summary-chat-head').evaluate(el=>el.getBoundingClientRect().height),feedbackBefore.head,'feedback adds no new header row');
      await input.fill('');
      await page.locator('#detail-ask-guides-row [data-detail-guide="durationMinutes"]').tap();
      assert.equal(await page.locator('#detail-ask-tag').isVisible(),true,'touching a guide selects its setting');
      await page.locator('#detail-ask-tag-remove').tap();
      assert.equal(await page.locator('#detail-ask-tag').isVisible(),false,'touching the remove control removes the setting tag');
      await page.locator('#detail-ask-guides-row [data-detail-guide="durationMinutes"]').tap();
      await send('40 minutes');
      assert.equal(await page.evaluate(()=>detailSummary.session.unresolved.length),0,'a guided reply resolves the original request');
      await snapshot(`${mode}-05-clarified`);
      await page.locator('#detail-cool').tap();await keyboard(false);
      assert.equal(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),false,'Close remains available with the keyboard');
      assert.equal(await page.evaluate(()=>scrollY),homeScroll,'closing Summary restores the original Home position');
      assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed','closing releases the iPhone page lock');
      await page.locator('#list .ting-name').filter({hasText:'Gym workout'}).first().tap();
      assert.match(await page.locator(active).innerText(),/40 min/,'reopening keeps the unsaved proposal');
      await page.locator(`${active} [data-focus-edit]`).tap();
      await keyboard(true);
      await page.waitForFunction(()=>$('detail-duration').classList.contains('detail-search-hit'));
      await page.locator('#detail-duration').blur();await keyboard(false);
      assert.equal(await page.locator('#detail-duration').inputValue(),'40');
      assert.equal(await page.evaluate(()=>load()[0].durationMinutes),60,'Adjust opens an unsaved manual edit');
      await page.locator('#detail-close').tap();
      await page.evaluate(()=>scrollDetailToNav('summary','auto'));
      await snapshot(`${mode}-06-cancelled`);
      await page.evaluate(()=>closeDetail());
    }
    assert.deepEqual(errors,[]);
    report.errors=errors;report.passed=true;
    console.log(`PASS iPhone X WebKit touch walkthrough (${live?'real Needle':'scripted host'}): inline composer, keyboard, Send, Save/Undo, clarification guides, tag removal, draft retention and Adjust/Cancel in full/minimal mode`);
  }finally{
    fs.writeFileSync(`${out}/report-${live?'live':'scripted'}.json`,JSON.stringify(report,null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exit(1);});
