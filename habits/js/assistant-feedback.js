// Feedback stays on this device until the user opens the prefilled Google Form.
// Never include the saved library, whole settings, or the model's context envelope.
const ASSISTANT_FEEDBACK_ENTRY = 'entry.1563652333'; // What's confusing or in the way?
const ASSISTANT_FEEDBACK_URL_MAX = 7500;

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
    version:1,
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
  return assistantFeedbackRedact(JSON.stringify(report, null, 2));
}

function assistantFeedbackPrefill(report){
  const url = new URL(FEEDBACK_FORM_URL);
  url.search = '';
  url.searchParams.set('usp', 'pp_url');
  const prefix = 'Assistant feedback — please describe what you expected here.\n\nDiagnostics:\n';
  const setReport = text => {
    url.searchParams.set(ASSISTANT_FEEDBACK_ENTRY, prefix + text);
    return url.href;
  };
  const full = setReport(report);
  if(full.length <= ASSISTANT_FEEDBACK_URL_MAX)return {url:full,truncated:false};
  // Google and browser URL limits vary. Keep both the context and final error;
  // the complete report remains available to review and copy beside the link.
  const marker = '\n\n[Report shortened to fit the form link. Copy all diagnostics in Tings and paste here for the full report.]\n\n';
  let low=0, high=report.length;
  while(low < high){
    const length=Math.ceil((low+high)/2);
    const sample=report.slice(0,Math.ceil(length/2)) + marker + report.slice(-Math.floor(length/2) || report.length);
    if(setReport(sample).length <= ASSISTANT_FEEDBACK_URL_MAX)low=length;
    else high=length-1;
  }
  return {url:setReport(report.slice(0,Math.ceil(low/2)) + marker + report.slice(-Math.floor(low/2) || report.length)),truncated:true};
}

function assistantAppendFeedback(out, context){
  if(!feedbackFormConfigured() || out.text === 'Cancelled.')return;
  const bubble = assistantThreadEl()?.lastElementChild;
  if(!bubble || bubble.querySelector('.assistant-feedback'))return;
  // Snapshot now: an old failure must keep its own request and trace after retry.
  const report = assistantFeedbackReport(out, context);
  const prefill = assistantFeedbackPrefill(report);
  const details = document.createElement('details');
  details.className = 'assistant-feedback';
  const summary = document.createElement('summary');
  summary.textContent = out.type === 'error' || out.gaveUp ? 'send feedback' : 'report a problem';
  const hint = document.createElement('p');
  hint.textContent = 'Includes your request, assistant response, model trace and device details. These may contain personal information. Review below, then open Google Forms to edit and submit if you choose.';
  const preview = document.createElement('details');
  const label = document.createElement('summary');
  label.textContent = 'review diagnostics';
  const log = document.createElement('pre');
  log.textContent = report;
  preview.append(label,log);
  const actions = document.createElement('div');
  actions.className = 'btn-row';
  const link = document.createElement('a');
  link.className = 'btn';
  link.textContent = 'open feedback form';
  link.href = prefill.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = 'copy all diagnostics';
  copy.addEventListener('click',()=>void assistantCopyText(report, 'diagnostics copied'));
  actions.append(link,copy);
  details.append(summary,hint,preview);
  if(prefill.truncated){
    const note=document.createElement('p');
    note.textContent='This report is too long for a form link. The form includes a shortened report. Copy all diagnostics and paste them into the form to include everything.';
    details.append(note);
  }
  details.append(actions);
  bubble.append(details);
}
