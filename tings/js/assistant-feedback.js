// Feedback stays on this device until the user sends the form.
// Never include the saved library, whole settings, or the model's context envelope.

function assistantFeedbackRedact(text){
  return String(text || '')
    .replace(/\bBearer\s+[^\s"'&,}]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|password)["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi, '$1[redacted]');
}

function assistantFeedbackReport(out, context = {}){
  const session = out.session || {};
  const settings = assistantSettings();
  const trace = out.debug || session.debug || [];
  const request = context.request ?? session.needleWorkflow?.request ?? session.requestText
    ?? trace.find(row=>row.t === 'turn')?.text ?? '';
  const report = {
    report:'Tings assistant feedback',
    version:2,
    capturedAt:new Date().toISOString(),
    environment:{
      page:location.origin + location.pathname,
      browser:navigator.userAgent,
      language:navigator.language,
      timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      online:navigator.onLine,
      native:Boolean(window.TingsNative?.isNative),
      viewport:{width:window.innerWidth,height:window.innerHeight},
      provider:settings.provider,
      model:settings.provider === 'needle' ? 'Needle 3' : settings.model,
      modelAssets:settings.provider === 'needle' ? ASSISTANT_NEEDLE_BASE : undefined,
      reasoning:settings.reasoning,
      debugVisible:settings.debug
    },
    request,
    outcome:{
      type:out.type,
      response:out.text || out.question || out.summary || '',
      partial:Boolean(out.partial),
      gaveUp:Boolean(out.gaveUp),
      unfinished:out.unfinished || [],
      error:out.diagnosticError || null
    },
    runtime:{
      entry:context.entry || session.entry || null,
      modelCalls:session.llmCalls || 0,
      repairs:session.repairs || 0,
      retries:session.modelRetries || 0,
      contextUsed:session.contextUsed || 0,
      contextLimit:session.contextLimit || 0
    },
    trace
  };
  const focus = context.focus || (typeof _assistantSession !== 'undefined' && _assistantSession && _assistantSession.focus) || null;
  if(focus)report.needle = assistantFeedbackFocusRecord(focus);
  const transcript = assistantFeedbackTranscript(context.thread);
  const spoken = transcript.filter(turn => turn.role === 'user').map(turn => turn.text);
  const extra = [];
  const remember = text => {
    const line = String(text || '');
    if(!line.trim() || extra.includes(line) || spoken.some(row => row.includes(line)))return;
    extra.push(line);
  };
  remember(request);
  for(const line of (focus && focus.requests) || [])remember(line);
  if(extra.length)transcript.unshift(...extra.map(text => ({role:'user', text})));
  if(transcript.length)report.transcript = transcript;
  if(typeof feedbackTenureChoice === 'function'){
    const items = typeof load === 'function' ? load() : [];
    const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
    report.known = {
      tenure:feedbackTenureChoice(items),
      uses:typeof feedbackUseChoices === 'function' ? feedbackUseChoices(items, settings) : []
    };
  }
  return assistantFeedbackRedact(JSON.stringify(report, null, 2));
}

function assistantFeedbackExpectation(out){
  if(out && out.partial)return 'The assistant only finished part of my request. I expected it to: ';
  if(out && (out.type === 'error' || out.gaveUp))return 'The assistant failed on my last request. I expected it to: ';
  return 'The assistant reply was not what I wanted. I expected it to: ';
}

// The saved item stays out of the report. Needle's trace, the typed requests,
// and the staged edits are the turn the person can choose to send.
function assistantFeedbackFocusTrace(focus){
  if(!focus)return [];
  const events = [];
  const requests = Array.isArray(focus.requests) && focus.requests.length
    ? focus.requests.filter(row => typeof row === 'string' && row.trim())
    : [];
  const request = focus.originalRequest || focus.requestText || requests.join('\n');
  if(request)events.push({t:'turn', text:request, focus:focus.operation || '', entry:focus.entry || ''});
  (focus.trace || []).forEach(row => {
    if(!row)return;
    const problem = row.error || row.issue || '';
    events.push({
      t:'tool',
      name:row.family || row.jobId || 'focus',
      step:row.jobId || row.family || '',
      args:{
        context:row.context || '',
        args:row.args,
        confidence:row.confidence,
        calls:row.calls,
        suppressed:row.suppressed,
        issue:row.issue || '',
        recoveredBudget:row.recoveredBudget,
        workerLane:row.workerLane
      }
    });
    if(problem)events.push({t:'error', step:row.family || 'focus', error:problem});
    const thought = row.reasoning || row.content || '';
    if(thought)events.push({
      t:'model',
      step:row.family || 'focus',
      tools:(row.calls || []).map(name => ({name})),
      thinking:thought
    });
  });
  (focus.changes || []).forEach(change => {
    if(!change)return;
    const value=change.value;
    events.push({
      t:'result',
      name:change.field || 'change',
      ok:!change.uncertain,
      status:'staged',
      uncertain:Boolean(change.uncertain),
      value,
      preview:[change.op || 'set',value!=null&&typeof value==='object'?JSON.stringify(value):value].filter(part => part != null && part !== '').join(' ')
    });
  });
  (focus.unresolved || []).forEach((item, index) => {
    if(item && item.question)events.push({t:'ask', n:index + 1, question:item.question, required:true});
  });
  if(!events.length && !focus.continuationError)return [];
  events.push({
    t:'done',
    type:'focus',
    text:focus.continuationError || '',
    totalMs:focus.timing && focus.timing.total,
    llmCalls:Array.isArray(focus.timing && focus.timing.passes) ? focus.timing.passes.length : (focus.trace || []).length
  });
  return events;
}

function assistantFeedbackFocusRecord(focus){
  if(!focus)return null;
  const trace = [];
  for(const row of focus.trace || []){
    if(!row || typeof row !== 'object')continue;
    const copy = {};
    for(const key of Object.keys(row)){
      if(key === 'source' || typeof row[key] === 'function')continue;
      copy[key] = row[key];
    }
    trace.push(copy);
  }
  return {
    operation:focus.operation || '',
    kind:focus.kind || '',
    entry:focus.entry || '',
    requests:(focus.requests || []).filter(row => typeof row === 'string'),
    currentRequest:typeof focus.currentRequest === 'string' ? focus.currentRequest : '',
    changes:Array.isArray(focus.changes) ? focus.changes : [],
    unresolved:(focus.unresolved || []).map(item => ({
      question:item && item.question || '',
      field:item && item.field || ''
    })).filter(item => item.question || item.field),
    continuationError:focus.continuationError || '',
    correctionError:focus.correctionError || '',
    pendingFamilies:Array.isArray(focus.pendingFamilies) ? focus.pendingFamilies : [],
    timing:focus.timing || null,
    trace
  };
}

function assistantFeedbackTranscript(thread = document.getElementById('assistant-thread')){
  if(!thread)return [];
  const turns = [];
  for(const bubble of thread.querySelectorAll('.assistant-bubble')){
    if(bubble.classList.contains('assistant-bubble-debug'))continue;
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll('.assistant-feedback').forEach(node => node.remove());
    const text = (clone.innerText || '').replace(/[ \t]+\n/g, '\n').trim();
    if(!text)continue;
    turns.push({
      role:bubble.classList.contains('assistant-bubble-user') ? 'user' : 'assistant',
      text
    });
  }
  return turns;
}

function assistantFeedbackOpenButton(report, expectation, className){
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className || 'btn';
  button.dataset.feedbackOpen = 'true';
  button.textContent = 'open feedback form';
  button.addEventListener('click', () => {
    if(typeof openFeedbackForm !== 'function')return;
    openFeedbackForm({note:expectation || '', context:report, assistant:true});
  });
  return button;
}

function assistantFocusFeedbackSummary(focus){
  if(!focus)return '';
  if(focus.continuationError)return focus.continuationError;
  const pending = (focus.unresolved || []).map(item => item && item.question).filter(Boolean);
  if(pending.length)return pending.join(' ');
  const fields = (focus.changes || []).map(change => change && change.field).filter(Boolean);
  if(fields.length)return `Staged ${fields.join(', ')}. Nothing is saved until you confirm.`;
  return 'No change was staged.';
}

function assistantFeedbackFromFocus(focus){
  const requests = Array.isArray(focus && focus.requests) ? focus.requests.filter(row => typeof row === 'string') : [];
  const request = focus && (focus.originalRequest || focus.requestText) || requests.join('\n');
  const debug = assistantFeedbackFocusTrace(focus);
  const failed = Boolean(focus && (focus.continuationError || (focus.trace || []).some(row => row && row.error)));
  return {
    out:{
      type:failed ? 'error' : 'focus',
      text:assistantFocusFeedbackSummary(focus),
      partial:Boolean(focus && (focus.continuationError || (focus.unresolved || []).length)),
      gaveUp:false,
      debug,
      session:{
        debug,
        requestText:request,
        entry:focus && focus.entry || null,
        llmCalls:Array.isArray(focus && focus.timing && focus.timing.passes) ? focus.timing.passes.length : (focus && focus.trace || []).length,
        repairs:0,
        contextUsed:0,
        contextLimit:0
      }
    },
    context:{request, entry:focus && focus.entry || null, focus}
  };
}

function assistantActiveFeedback(){
  const session = typeof _assistantSession !== 'undefined' ? _assistantSession : null;
  if(session && session.focus)return assistantFeedbackFromFocus(session.focus);
  const request = session && (session.needleWorkflow && session.needleWorkflow.request || session.requestText) || '';
  return {
    out:{type:'say', text:'', session:session || {debug:[]}},
    context:{request, entry:session && session.entry || null}
  };
}

function assistantFeedbackDetails(out, context){
  // Snapshot now: an old failure must keep its own request and trace after retry.
  const report = assistantFeedbackReport(out, context);
  const known = typeof feedbackKnownAnswers === 'function' ? feedbackKnownAnswers() : [];
  const expectation = assistantFeedbackExpectation(out);
  const details = document.createElement('details');
  details.className = 'assistant-feedback';
  const summary = document.createElement('summary');
  summary.textContent = out.type === 'error' || out.gaveUp ? 'send feedback' : 'report a problem';
  const hint = document.createElement('p');
  hint.textContent = 'This chat is included in full. The form is already filled in. Add a note if you want, then send.';
  const filledText = typeof feedbackKnownSummary === 'function' ? feedbackKnownSummary(known) : '';
  const filled = document.createElement('p');
  if(filledText)filled.textContent = filledText;
  const preview = document.createElement('details');
  const label = document.createElement('summary');
  label.textContent = 'review diagnostics';
  const log = document.createElement('pre');
  log.textContent = report;
  preview.append(label,log);
  const actions = document.createElement('div');
  actions.className = 'btn-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.dataset.feedbackCopy = 'true';
  copy.textContent = 'copy all diagnostics';
  copy.addEventListener('click',()=>void assistantCopyText(report, 'diagnostics copied'));
  actions.append(assistantFeedbackOpenButton(report, expectation), copy);
  details.append(summary, hint, ...(filledText ? [filled] : []), preview, actions);
  return details;
}

// The composer control opens a short card. Diagnostics stay folded until asked.
function assistantFeedbackSheet(out, context){
  const report = assistantFeedbackReport(out, context);
  const known = typeof feedbackKnownAnswers === 'function' ? feedbackKnownAnswers() : [];
  const expectation = assistantFeedbackExpectation(out);
  const card = document.createElement('div');
  card.className = 'assistant-feedback-card';
  const head = document.createElement('div');
  head.className = 'assistant-feedback-card-head';
  const title = document.createElement('span');
  title.textContent = out && (out.type === 'error' || out.gaveUp) ? 'Send feedback' : 'Report a problem';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'assistant-feedback-dismiss';
  close.setAttribute('aria-label', 'close feedback');
  close.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
  close.addEventListener('click', () => {
    if(typeof assistantToggleFeedbackPanel === 'function')assistantToggleFeedbackPanel();
  });
  head.append(title, close);
  const lead = document.createElement('p');
  lead.className = 'assistant-feedback-lead';
  lead.textContent = 'Opens a form filled in with this chat. A note is optional.';
  const filledText = typeof feedbackKnownSummary === 'function' ? feedbackKnownSummary(known) : '';
  const filled = document.createElement('p');
  filled.className = 'assistant-feedback-known';
  if(filledText)filled.textContent = filledText;
  const actions = document.createElement('div');
  actions.className = 'assistant-feedback-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.dataset.feedbackCopy = 'true';
  copy.textContent = 'copy';
  copy.addEventListener('click', () => void assistantCopyText(report, 'diagnostics copied'));
  actions.append(assistantFeedbackOpenButton(report, expectation, 'btn primary'), copy);
  const preview = document.createElement('details');
  preview.className = 'assistant-feedback-diagnostics';
  const label = document.createElement('summary');
  label.textContent = 'diagnostics';
  const log = document.createElement('pre');
  log.textContent = report;
  preview.append(label, log);
  card.append(head, lead, ...(filledText ? [filled] : []), actions, preview);
  return card;
}

function assistantAppendFeedback(out, context){
  if(!feedbackFormConfigured() || !out || out.text === 'Cancelled.')return;
  const bubble = assistantThreadEl()?.lastElementChild;
  if(!bubble || bubble.querySelector('.assistant-feedback'))return;
  bubble.append(assistantFeedbackDetails(out, context));
}
