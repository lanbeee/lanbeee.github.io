// Feedback is opt-in, snapshots the failed turn, and prefills the real form's
// free-text field without inventing survey answers or submitting anything.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log('  ok: '+message);}
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[],external=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await context.route('https://docs.google.com/**',route=>{
      external.push({url:route.request().url(),method:route.request().method()});
      return route.fulfill({status:200,contentType:'text/html',body:'<p>Feedback form preview</p>'});
    });
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(BASE);await waitForAssistant(page);
    const failed=await page.evaluate(async()=>{
      patchLocalAssistant({localAssistant:true,localAssistantProvider:'ollama',localAssistantDebug:false,
        localAssistantUrl:'http://private-server:11434',localAssistantModel:'test-model'});
      save([{hid:'private-item',name:'UNRELATED PRIVATE HABIT',type:'task',logs:[]}]);
      openAssistantSheet();
      const out=await runAssistantTurn('Add café ☕ & tea tomorrow',{
        session:assistantCreateSession(),
        complete:async()=>{throw new Error('Runtime unavailable');}
      });
      await handleAssistantOutcome(out,{request:'Add café ☕ & tea tomorrow'});
      const details=document.querySelector('.assistant-feedback');
      const url=new URL(details.querySelector('a').href);
      const report=details.querySelector('pre').textContent;
      const general=new URL(feedbackFormHref());
      window.feedbackSnapshot=report;
      return {type:out.type,report,href:url.href,entry:url.searchParams.get(ASSISTANT_FEEDBACK_ENTRY),
        keys:[...new Set(url.searchParams.keys())],
        uses:url.searchParams.getAll(FEEDBACK_FORM_ENTRIES.uses),
        tenure:url.searchParams.get(FEEDBACK_FORM_ENTRIES.tenure),
        fix:url.searchParams.get(FEEDBACK_FORM_ENTRIES.fixNext),
        rating:url.searchParams.get('entry.402961364'),
        email:url.searchParams.get(FEEDBACK_FORM_ENTRIES.email),
        plan:url.searchParams.get(FEEDBACK_FORM_ENTRIES.plan),
        generalUses:general.searchParams.getAll(FEEDBACK_FORM_ENTRIES.uses),
        generalConfusing:general.searchParams.get(FEEDBACK_FORM_ENTRIES.confusing),
        filled:details.textContent,
        closed:!details.open,label:details.querySelector('summary').textContent,
        target:details.querySelector('a').target,rel:details.querySelector('a').rel};
    });
    assert(failed.type==='error' && failed.label==='send feedback','a model failure offers feedback with diagnostics off');
    assert(failed.closed && external.length===0,'diagnostics stay local until the user chooses to open the form');
    assert(failed.uses.join('|')==='Tasks & Deadlines' && !failed.tenure
      && failed.fix==='The assistant failed on my last request. I expected it to: '
      && failed.rating==null && failed.email==null && failed.plan==null,
      'known planning kind and a rewriteable expectation are filled; rating, email, and tenure stay blank when unknown');
    assert(failed.generalUses.join('|')==='Tasks & Deadlines' && failed.generalConfusing==null,
      'About feedback fills the same planning answers without the assistant report');
    assert(failed.filled.includes('Tasks & Deadlines') && !failed.filled.includes('UNRELATED PRIVATE HABIT'),
      'the chat shows the filled answers and not the item name');
    const report=JSON.parse(failed.report);
    assert(report.request==='Add café ☕ & tea tomorrow' && report.environment.model==='test-model',
      'report preserves the literal request, Unicode, provider and model');
    assert(report.trace.some(row=>row.t==='error' && row.error.includes('Runtime unavailable')),
      'report includes the actual runtime error and routing trace');
    assert(!failed.report.includes('UNRELATED PRIVATE HABIT') && !failed.report.includes('private-server'),
      'report excludes unrelated saved items and server configuration');
    assert(failed.entry.endsWith(failed.report) && failed.href.includes('/1FAIpQLSdsyYNO66PKY-lVV1rWoXZM3oBLoVWA10cKtjUQ1_CTxiH_mA/viewform'),
      'the supplied form receives the complete report in its confusing-or-in-the-way field');
    assert(failed.keys.join(',')==='usp,entry.593100343,entry.1988333965,entry.1563652333',
      'the form link carries usage, the editable expectation, and diagnostics, and leaves the rating for the user');
    assert(failed.target==='_blank' && failed.rel.includes('noreferrer'),'form opens separately without a referrer');
    await page.locator('.assistant-feedback > summary').click();
    await page.locator('.assistant-feedback details > summary').click();
    const mobile=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
      preview:document.querySelector('.assistant-feedback pre').getBoundingClientRect().width
    }));
    assert(mobile.scroll<=mobile.width && mobile.preview<=mobile.width,'expanded diagnostics fit a phone viewport');
    assert(external.length===0,'reviewing diagnostics does not contact Google');
    const popupPromise=page.waitForEvent('popup');
    await page.locator('.assistant-feedback a').click();
    const popup=await popupPromise;await popup.waitForLoadState();
    assert(external.length===1 && external[0].method==='GET' && external[0].url===failed.href,
      'opening feedback navigates to a prefilled form without submitting it');
    await popup.close();
    const followup=await page.evaluate(async()=>{
      await handleAssistantOutcome({type:'say',text:'A later answer',session:{requestText:'A different request',debug:[]}});
      const cards=[...document.querySelectorAll('.assistant-feedback')];
      return {first:cards[0].querySelector('pre').textContent,latest:cards.at(-1).querySelector('summary').textContent};
    });
    assert(followup.first===failed.report && followup.latest==='report a problem',
      'later turns preserve old reports and allow reporting an incorrect successful reply');
    const unexpected=await page.evaluate(async()=>{
      const run=runAssistantTurn,canSend=assistantNeedleCanSend;
      assistantNeedleCanSend=()=>true;
      runAssistantTurn=async()=>{throw new Error('Unexpected UI failure');};
      try{
        await sendAssistantMessage('Original failed request');
        const cards=[...document.querySelectorAll('.assistant-feedback')];
        return JSON.parse(cards.at(-1).querySelector('pre').textContent);
      }finally{runAssistantTurn=run;assistantNeedleCanSend=canSend;}
    });
    assert(unexpected.request==='Original failed request' && unexpected.outcome.error.includes('Unexpected UI failure'),
      'unexpected thrown failures retain the original request and stack');
    const workflow=await page.evaluate(async()=>{
      const ready=assistantNeedleEnsureReady,request=assistantNeedleRequest;
      assistantNeedleEnsureReady=async()=>true;
      assistantNeedleRequest=async()=>({steps:['Add Alpha.','Show schedule.']});
      try{
        const out=await assistantRunNeedleWorkflow('Add Alpha. Show schedule.',{
          session:assistantCreateSession(),complete:async req=>{
            const literal=JSON.parse(req.messages.find(m=>m.role==='user').content).request;
            if(literal==='Show schedule.')throw new Error('Second part failed');
            return {message:{content:'',tool_calls:req.messages.some(m=>m.role==='tool') ? [] : [
              {function:{name:'draft_item',arguments:{name:'Alpha',kind:'task',create:true}}}
            ]}};
          }
        });
        await handleAssistantOutcome(out);
        const cards=[...document.querySelectorAll('.assistant-feedback')];
        return JSON.parse(cards.at(-1).querySelector('pre').textContent);
      }finally{assistantNeedleEnsureReady=ready;assistantNeedleRequest=request;}
    });
    assert(workflow.outcome.partial && workflow.request==='Add Alpha. Show schedule.'
      && workflow.trace.filter(row=>row.t==='part').length===2
      && workflow.trace.some(row=>row.t==='tool' && row.name==='draft_item')
      && workflow.trace.some(row=>row.t==='error' && row.error.includes('Second part failed')),
      'partial workflow failure reports both the completed and failed parts with the whole request');
    await context.setOffline(true);
    const offline=await page.evaluate(async()=>{
      await handleAssistantOutcome({type:'error',text:'Offline failure',session:{requestText:'Offline request'}});
      const cards=[...document.querySelectorAll('.assistant-feedback')];
      return JSON.parse(cards.at(-1).querySelector('pre').textContent);
    });
    assert(offline.request==='Offline request' && offline.environment.online===false,
      'offline failures can prepare feedback locally without an external request');
    await context.setOffline(false);
    const large=await page.evaluate(()=>{
      const text='Long request 🚀 & details?\n'.repeat(1200)+'FINAL RUNTIME ERROR';
      const prefill=assistantFeedbackPrefill(text);
      const body=new URL(prefill.url).searchParams.get(ASSISTANT_FEEDBACK_ENTRY);
      return {truncated:prefill.truncated,length:prefill.url.length,limit:ASSISTANT_FEEDBACK_URL_MAX,
        marker:body.includes('Report shortened'),tail:body.endsWith('FINAL RUNTIME ERROR'),head:body.includes('Long request')};
    });
    assert(large.truncated && large.length<=large.limit && large.marker && large.head && large.tail,
      'oversized Unicode reports fit the URL budget and explicitly retain context plus the final error');
    const copy=await page.evaluate(async()=>{
      let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
      const report='Full diagnostics '+ 'x'.repeat(20000);
      await handleAssistantOutcome({type:'error',text:report,session:{}});
      const cards=[...document.querySelectorAll('.assistant-feedback')],last=cards.at(-1);
      last.querySelector('button').click();
      await Promise.resolve();
      return {copied,full:last.querySelector('pre').textContent,note:last.textContent.includes('too long for a form link')};
    });
    assert(copy.copied===copy.full && copy.note,'long reports keep a complete local preview and copy action with a visible form-limit explanation');
    const redacted=await page.evaluate(()=>assistantFeedbackRedact(
      'https://name:secret@localhost/path?api_key=abc&next=yes Authorization: Bearer token-value password=hunter2'));
    assert(!/secret|abc|token-value|hunter2/.test(redacted),'diagnostics redact recognizable credentials');
    const inferred=await page.evaluate(()=>{
      const old=Date.now()-40*86400000;
      const recent=Date.now()-2*86400000;
      const weeks=Date.now()-14*86400000;
      const settings={locations:[{id:'home',name:'Family home',lat:40,lng:-73}],
        blockedTimes:[{label:'focus',days:[1,2,3,4,5],start:540,end:1020}]};
      const items=[
        {type:'keepup',name:'Secret walk',createdAt:old,logs:[old],breakable:true,locationIds:['home'],allowedTimeStartAnchor:'fajr'},
        {type:'task',name:'Call',dueDate:Date.now(),logs:[]}
      ];
      localStorage.setItem(AGENDA_DISPLAY_KEY,JSON.stringify({syncMode:'glance'}));
      const uses=feedbackUseChoices(items,settings);
      localStorage.removeItem(AGENDA_DISPLAY_KEY);
      const named=feedbackUseChoices([{type:'keepup',name:'Secret sleep plan',logs:[]}],{blockedTimes:DEFAULT_BLOCKED_TIMES});
      return {uses,named,
        tenure:feedbackTenureChoice(items),
        days:feedbackTenureChoice([{createdAt:recent,logs:[]}]),
        weeks:feedbackTenureChoice([{createdAt:weeks,logs:[]}]),
        looking:feedbackTenureChoice([]),
        undated:feedbackTenureChoice([{type:'task',logs:[]}]),
        defaults:feedbackUseChoices([{type:'task',name:'Call',logs:[]}],loadSortSettings())};
    });
    assert(inferred.uses.join('|')==='Daily Habits|Tasks & Deadlines|Work/Tasks that splits across the day|Places and travel|Prayer-time windows|Shared Display|Sleep and routine planning'
      && !inferred.uses.join(' ').includes('Secret') && !inferred.uses.join(' ').includes('Family'),
      'usage answers follow what is on the device and never include names or places');
    assert(inferred.named.join('|')==='Daily Habits|Sleep and routine planning' && !inferred.named.join(' ').includes('Secret'),
      'a sleep item checks the routine answer without sending its name');
    assert(inferred.tenure==='A month or more' && inferred.days==='A few days' && inferred.weeks==='A few weeks'
      && inferred.looking==='Just looking around' && inferred.undated==='' && inferred.defaults.join('|')==='Tasks & Deadlines',
      'tenure follows the oldest item, and the factory sleep block is not treated as a choice');
    const needleFeedback = await page.evaluate(()=>{
      _assistantSession = assistantCreateSession();
      _assistantSession.focus = {
        operation:'edit', entry:'home', requestText:'make it weekly', requests:['make it weekly'],
        source:{name:'SECRET ITEM', hid:'private-item', notes:'keep this off the form'},
        changes:[{field:'periodDays', op:'set', value:7}],
        unresolved:[],
        trace:[{family:'recurrence', args:{periodDays:7}, confidence:0.4, calls:['recurrence'], reasoning:'weekly means seven days'}],
        timing:{total:900, passes:[{}]}
      };
      syncLocalAssistantControls();
      return {secret:_assistantSession.focus.source.name};
    });
    await page.locator('#assistant-feedback').click();
    const sheetFeedback = await page.evaluate(()=>{
      const panel = document.getElementById('assistant-feedback-panel');
      const link = panel.querySelector('a');
      const body = new URL(link.href).searchParams.get(ASSISTANT_FEEDBACK_ENTRY);
      return {
        open:!panel.hidden && Boolean(panel.querySelector('.assistant-feedback-card')),
        diagnosticsOpen:Boolean(panel.querySelector('details') && panel.querySelector('details').open),
        label:link.textContent,
        lead:panel.querySelector('.assistant-feedback-lead')?.textContent || '',
        body,
        fix:new URL(link.href).searchParams.get(ASSISTANT_FEEDBACK_FIX)
      };
    });
    assert(sheetFeedback.open && !sheetFeedback.diagnosticsOpen && sheetFeedback.label === 'open feedback form'
      && sheetFeedback.lead.length < 160
      && sheetFeedback.body.includes('make it weekly') && sheetFeedback.body.includes('recurrence')
      && sheetFeedback.body.includes('periodDays') && sheetFeedback.body.includes('weekly means seven days')
      && !sheetFeedback.body.includes(needleFeedback.secret) && !sheetFeedback.body.includes('keep this off the form'),
      'Ask Tings feedback opens a short card and prefills the form without the saved item');
    assert(sheetFeedback.fix === 'The assistant reply was not what I wanted. I expected it to: ',
      'a completed Needle turn still leaves the expectation note editable');
    await page.locator('#assistant-feedback').click();
    const feedbackClosed = await page.evaluate(()=>({
      hidden:document.getElementById('assistant-feedback-panel').hidden,
      expanded:document.getElementById('assistant-feedback').getAttribute('aria-expanded')
    }));
    assert(feedbackClosed.hidden && feedbackClosed.expanded === 'false', 'tapping feedback again closes the card');
    const reveal = await page.evaluate(()=>{
      const title = document.getElementById('assistant-title');
      const button = document.getElementById('assistant-debug-toggle');
      const before = button.hidden;
      title.click();
      title.click();
      const afterTwo = button.hidden;
      title.click();
      return {before, afterTwo, afterThree:button.hidden};
    });
    assert(reveal.before && reveal.afterTwo && !reveal.afterThree, 'debug stays hidden until ask Tings is tapped three times');
    await page.locator('#assistant-debug-toggle').click();
    const debugOpen = await page.evaluate(()=>{
      const dock = document.getElementById('assistant-debug-dock');
      const log = dock && dock.querySelector('.assistant-debug-log');
      const btn = document.getElementById('assistant-debug-toggle');
      return {
        shown:Boolean(dock && !dock.hidden),
        open:btn.classList.contains('is-open') && btn.getAttribute('aria-expanded') === 'true',
        compact:Boolean(dock && dock.classList.contains('is-compact')),
        text:log ? log.textContent : '',
        hidden:btn.hidden,
        inThread:Boolean(document.querySelector('.assistant-bubble-debug.is-sheet'))
      };
    });
    assert(debugOpen.shown && debugOpen.open && !debugOpen.compact && !debugOpen.hidden && !debugOpen.inThread
      && debugOpen.text.includes('recurrence') && debugOpen.text.includes('make it weekly')
      && !debugOpen.text.includes(needleFeedback.secret),
      'debug opens the Needle trace in a tray instead of a leftover chat card');
    await page.locator('#assistant-debug-fold').click();
    const debugCompact = await page.evaluate(()=>{
      const dock = document.getElementById('assistant-debug-dock');
      const log = document.getElementById('assistant-debug-log');
      return {
        compact:dock.classList.contains('is-compact'),
        logHidden:getComputedStyle(log).display === 'none',
        stillOpen:document.getElementById('assistant-debug-toggle').classList.contains('is-open')
      };
    });
    assert(debugCompact.compact && debugCompact.logHidden && debugCompact.stillOpen,
      'the trace bar compacts the log and leaves the tray open');
    await page.locator('#assistant-debug-toggle').click();
    const debugClosed = await page.evaluate(()=>{
      const dock = document.getElementById('assistant-debug-dock');
      const btn = document.getElementById('assistant-debug-toggle');
      return {hidden:dock.hidden, open:btn.classList.contains('is-open'), expanded:btn.getAttribute('aria-expanded')};
    });
    assert(debugClosed.hidden && !debugClosed.open && debugClosed.expanded === 'false',
      'tapping debug again closes the tray');
    assert(errors.length===0,'feedback flow has no page errors');
    console.log(`\n${passed} assistant feedback assertions passed`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
