// Feedback is opt-in. The form is filled in, a note is optional, and Send posts
// the whole report. Nothing is sent until the user taps send.
const {chromium,BASE,waitForAssistant}=require('./helpers/planner-test-helpers');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log('  ok: '+message);}
function decodeForm(body){return decodeURIComponent(String(body||'').replace(/\+/g,' '));}
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[],external=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await context.route('https://docs.google.com/**',route=>{
      external.push({url:route.request().url(),method:route.request().method(),body:route.request().postData()||''});
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
      const report=details.querySelector('pre').textContent;
      const rowsOf=parts=>parts[0]||[];
      const value=(rows,key)=>rows.filter(pair=>pair[0]===key).map(pair=>pair[1]);
      const assistantRows=rowsOf(feedbackFormParts({context:report, note:assistantFeedbackExpectation(out), email:''}));
      const generalRows=rowsOf(feedbackFormParts({context:feedbackDeviceReport(), note:'', email:''}));
      window.feedbackSnapshot=report;
      return {type:out.type,report,
        uses:value(assistantRows, FEEDBACK_FORM_ENTRIES.uses),
        tenure:value(assistantRows, FEEDBACK_FORM_ENTRIES.tenure)[0]||'',
        fix:value(assistantRows, FEEDBACK_FORM_ENTRIES.fixNext)[0]||'',
        rating:value(assistantRows, 'entry.402961364')[0]||'',
        email:value(assistantRows, FEEDBACK_FORM_ENTRIES.email)[0]||'',
        plan:value(assistantRows, FEEDBACK_FORM_ENTRIES.plan)[0]||'',
        planDetail:value(assistantRows, FEEDBACK_FORM_ENTRIES.planDetail)[0]||'',
        generalUses:value(generalRows, FEEDBACK_FORM_ENTRIES.uses),
        generalConfusing:value(generalRows, feedbackReportEntry())[0]||'',
        generalFix:value(generalRows, FEEDBACK_FORM_ENTRIES.fixNext)[0]||'',
        filled:details.textContent,
        closed:!details.open,label:details.querySelector('summary').textContent,
        openLabel:details.querySelector('[data-feedback-open]').textContent};
    });
    assert(failed.type==='error' && failed.label==='send feedback','a model failure offers feedback with diagnostics off');
    assert(failed.closed && external.length===0,'diagnostics stay local until the user chooses to send');
    assert(failed.uses.join('|')==='Tasks & Deadlines' && !failed.tenure
      && failed.fix==='The assistant failed on my last request. I expected it to: '
      && !failed.rating && !failed.email && !failed.plan && !failed.planDetail,
      'known planning kind and a rewriteable expectation are filled; rating, email, tenure, and the day-plan questions stay blank when unknown');
    assert(failed.generalUses.join('|')==='Tasks & Deadlines' && !failed.generalFix
      && failed.generalConfusing.includes('Tings feedback') && !failed.generalConfusing.includes('Add café'),
      'About feedback fills the same planning answers without the assistant report');
    assert(failed.filled.includes('Tasks & Deadlines') && !failed.filled.includes('UNRELATED PRIVATE HABIT'),
      'the chat shows the filled answers and not the item name');
    const report=JSON.parse(failed.report);
    assert(report.request==='Add café ☕ & tea tomorrow' && report.environment.model==='test-model',
      'report preserves the literal request, Unicode, provider and model');
    assert(report.trace.some(row=>row.t==='error' && row.error.includes('Runtime unavailable')),
      'report includes the actual runtime error and routing trace');
    assert(report.transcript.some(turn=>turn.role==='user' && turn.text.includes('Add café')),
      'the report keeps the visible chat, not only a shortened trace');
    assert(!failed.report.includes('UNRELATED PRIVATE HABIT') && !failed.report.includes('private-server'),
      'report excludes unrelated saved items and server configuration');
    assert(failed.openLabel==='open feedback form','the card opens the in-app form');
    await page.locator('.assistant-feedback > summary').click();
    await page.locator('.assistant-feedback details > summary').click();
    const mobile=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
      preview:document.querySelector('.assistant-feedback pre').getBoundingClientRect().width
    }));
    assert(mobile.scroll<=mobile.width && mobile.preview<=mobile.width,'expanded diagnostics fit a phone viewport');
    assert(external.length===0,'reviewing diagnostics does not contact Google');
    await page.locator('.assistant-feedback [data-feedback-open]').click();
    await page.waitForSelector('#feedback-sheet.open');
    const ready=await page.evaluate(()=>({
      note:document.getElementById('feedback-note').value,
      noteRequired:document.getElementById('feedback-note').required,
      emailRequired:document.getElementById('feedback-email').required,
      sendDisabled:document.getElementById('feedback-send').disabled
    }));
    assert(!ready.noteRequired && !ready.emailRequired && !ready.sendDisabled
      && ready.note==='The assistant failed on my last request. I expected it to: ',
      'the form can be sent without typing, and the expectation stays editable');
    assert(external.length===0,'opening the form does not contact Google');
    await page.locator('#feedback-note').fill('');
    await page.locator('#feedback-send').click();
    await page.waitForFunction(()=>!document.getElementById('feedback-sheet').classList.contains('open'));
    const posted=external.map(row=>decodeForm(row.body)).join('\n');
    assert(external.length>=1 && external.every(row=>row.method==='POST' && row.url.includes('/1FAIpQLSdsyYNO66PKY-lVV1rWoXZM3oBLoVWA10cKtjUQ1_CTxiH_mA/formResponse')),
      'sending posts the filled form');
    assert(posted.includes('Runtime unavailable') && posted.includes('Add café')
      && posted.includes('entry.1567617731') && !posted.includes('entry.1563652333')
      && !posted.includes('entry.402961364') && !posted.includes('entry.247866906')
      && !posted.includes('UNRELATED PRIVATE HABIT') && !posted.includes('private-server'),
      'the post puts the full report in Diagnostics and leaves the rating, day-plan, and confusing questions unset');
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
      const parts=feedbackFormParts({context:text, note:'', email:''});
      const joined=parts.map(rows=>{
        const chunk=(rows.find(pair=>pair[0]===feedbackReportEntry())||[])[1]||'';
        return chunk.replace(/^Part \d+ of \d+\n/,'');
      }).join('');
      const middle=text.slice(Math.floor(text.length/2), Math.floor(text.length/2)+24);
      return {parts:parts.length, whole:joined===text, middle:joined.includes(middle),
        tail:joined.endsWith('FINAL RUNTIME ERROR'), head:joined.startsWith('Long request'),
        plan:parts.every(rows=>!rows.some(pair=>pair[0]===FEEDBACK_FORM_ENTRIES.planDetail))};
    });
    assert(large.parts>1 && large.whole && large.middle && large.head && large.tail && large.plan,
      'a long report is sent whole, including the middle, and the day-plan question stays blank');
    const copy=await page.evaluate(async()=>{
      let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
      const report='Full diagnostics '+ 'x'.repeat(20000);
      await handleAssistantOutcome({type:'error',text:report,session:{}});
      const cards=[...document.querySelectorAll('.assistant-feedback')],last=cards.at(-1);
      last.querySelector('[data-feedback-copy]').click();
      await Promise.resolve();
      const full=last.querySelector('pre').textContent;
      const parts=feedbackFormParts({context:full, note:'', email:''});
      const joined=parts.map(rows=>{
        const chunk=(rows.find(pair=>pair[0]===feedbackReportEntry())||[])[1]||'';
        return chunk.replace(/^Part \d+ of \d+\n/,'');
      }).join('');
      return {copied, full, covered:joined===full, parts:parts.length, note:last.textContent.includes('too long for a form link')};
    });
    assert(copy.copied===copy.full && !copy.note && copy.covered && copy.parts>1,'long reports stay complete locally and are sent whole, in parts when one answer is not enough');
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
      const open = panel.querySelector('[data-feedback-open]');
      const body = panel.querySelector('pre').textContent;
      open.click();
      return {
        open:!panel.hidden && Boolean(panel.querySelector('.assistant-feedback-card')),
        diagnosticsOpen:Boolean(panel.querySelector('details') && panel.querySelector('details').open),
        label:open.textContent,
        lead:panel.querySelector('.assistant-feedback-lead')?.textContent || '',
        body,
        fix:document.getElementById('feedback-note').value,
        formOpen:document.getElementById('feedback-sheet').classList.contains('open')
      };
    });
    assert(sheetFeedback.open && sheetFeedback.formOpen && !sheetFeedback.diagnosticsOpen && sheetFeedback.label === 'open feedback form'
      && sheetFeedback.lead.length < 160
      && sheetFeedback.body.includes('make it weekly') && sheetFeedback.body.includes('recurrence')
      && sheetFeedback.body.includes('periodDays') && sheetFeedback.body.includes('weekly means seven days')
      && !sheetFeedback.body.includes(needleFeedback.secret) && !sheetFeedback.body.includes('keep this off the form'),
      'Ask Tings feedback opens a short card and fills the form without the saved item');
    assert(sheetFeedback.fix === 'The assistant reply was not what I wanted. I expected it to: ',
      'a completed Needle turn still leaves the expectation note editable');
    await page.locator('#feedback-close').click();
    const fullNeedle=await page.evaluate(()=>{
      const reasoning='NEEDLE-CONTEXT-START '+ 'q'.repeat(2500)+' NEEDLE-CONTEXT-END';
      const report=assistantFeedbackReport({type:'focus', text:'ok', session:{debug:[]}}, {
        request:'full needle',
        focus:{
          requests:['full needle'],
          trace:[{family:'recurrence', reasoning, content:reasoning, context:'earlier user message 1: '+reasoning, args:{periodDays:7}}],
          changes:[], unresolved:[], source:{name:'SECRET ITEM', notes:'keep this off the form'}
        }
      });
      return {
        start:report.includes('NEEDLE-CONTEXT-START'),
        end:report.includes('NEEDLE-CONTEXT-END'),
        count:(report.split('q').length-1)>=2500,
        secret:report.includes('SECRET ITEM')||report.includes('keep this off the form')
      };
    });
    assert(fullNeedle.start && fullNeedle.end && fullNeedle.count && !fullNeedle.secret,
      'Needle context is kept in full and the saved item stays out');
    const structured=await page.evaluate(()=>{
      const value={start:{kind:'anchor',anchor:'maghrib',offsetMin:0},end:{kind:'anchor',anchor:'maghrib',offsetMin:120}};
      const trace=assistantFeedbackFocusTrace({changes:[{field:'allowedWindow',value,op:'set',uncertain:true}]});
      return trace.find(row=>row.t==='result');
    });
    assert(structured.status==='staged'&&structured.uncertain&&structured.value.start.offsetMin===0&&structured.value.end.offsetMin===120
      &&structured.preview.includes('120')&&!structured.preview.includes('[object Object]'),
      'feedback retains actual window endpoints and distinguishes staged values from confidence');
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
