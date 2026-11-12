// The feedback form lives in Tings. Known answers are filled in, the note and
// email are optional, and Send posts the whole report to the Google Form.
// A link cannot carry a Needle chat, so long reports go in numbered parts.

function feedbackFormResponseUrl(){
  return String(typeof FEEDBACK_FORM_URL === 'string' ? FEEDBACK_FORM_URL : '').replace(/\/viewform(?:\?[^#]*)?$/i, '/formResponse');
}

function feedbackSplitText(text, maxBytes){
  const value = String(text || '');
  const budget = Math.max(128, (maxBytes || FEEDBACK_TEXT_BYTES) - 48);
  if(!value)return [];
  const slices = [];
  let start = 0;
  while(start < value.length){
    let end = start;
    let bytes = 0;
    while(end < value.length){
      const code = value.charCodeAt(end);
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : (code >= 0xD800 && code <= 0xDBFF ? 4 : 3);
      if(bytes + size > budget)break;
      end += size === 4 ? 2 : 1;
      bytes += size;
    }
    if(end <= start)end = Math.min(value.length, start + 1);
    slices.push(value.slice(start, end));
    start = end;
  }
  if(slices.length < 2)return slices;
  return slices.map((part, index) => `Part ${index + 1} of ${slices.length}\n${part}`);
}

function feedbackEnvironment(){
  return {
    page:location.origin + location.pathname,
    browser:navigator.userAgent,
    language:navigator.language,
    timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    online:navigator.onLine,
    native:Boolean(window.TingsNative?.isNative),
    viewport:{width:window.innerWidth, height:window.innerHeight}
  };
}

function feedbackDeviceReport(){
  const items = typeof load === 'function' ? load() : [];
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  return JSON.stringify({
    report:'Tings feedback',
    version:2,
    capturedAt:new Date().toISOString(),
    environment:feedbackEnvironment(),
    known:{
      tenure:typeof feedbackTenureChoice === 'function' ? feedbackTenureChoice(items) : '',
      uses:typeof feedbackUseChoices === 'function' ? feedbackUseChoices(items, settings) : []
    }
  }, null, 2);
}

function feedbackKnownLines(){
  const items = typeof load === 'function' ? load() : [];
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const tenure = typeof feedbackTenureChoice === 'function' ? feedbackTenureChoice(items) : '';
  const uses = typeof feedbackUseChoices === 'function' ? feedbackUseChoices(items, settings) : [];
  return [
    ['How long', tenure || 'Not sure yet'],
    ['In use', uses.length ? uses.join(', ') : FEEDBACK_USE_NONE]
  ];
}

function feedbackReportEntry(){
  const entries = typeof FEEDBACK_FORM_ENTRIES === 'object' && FEEDBACK_FORM_ENTRIES ? FEEDBACK_FORM_ENTRIES : {};
  const diagnostics = String(entries.diagnostics || '');
  return /^entry\.\d+$/.test(diagnostics) ? diagnostics : entries.confusing;
}

function feedbackBaseRows(){
  const items = typeof load === 'function' ? load() : [];
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const rows = [];
  const tenure = typeof feedbackTenureChoice === 'function' ? feedbackTenureChoice(items) : '';
  if(tenure)rows.push([FEEDBACK_FORM_ENTRIES.tenure, tenure]);
  if(typeof feedbackUseAnswerRows === 'function')rows.push(...feedbackUseAnswerRows(items, settings));
  return rows;
}

function feedbackOptionalText(value){
  const text = String(value || '');
  return text.trim() ? text.replace(/^\s+/, '') : '';
}

function feedbackFormParts(opts){
  opts = opts || {};
  const note = feedbackOptionalText(opts.note);
  const email = String(opts.email || '').trim();
  let context = String(opts.context || '');
  if(note)context = `Note:\n${note}\n\n${context}`;
  const chunks = feedbackSplitText(context);
  const bodies = chunks.length ? chunks : [''];
  const noteChunks = note ? feedbackSplitText(note) : [];
  const reportEntry = feedbackReportEntry();
  return bodies.map((chunk, index) => {
    const rows = feedbackBaseRows();
    if(noteChunks[index])rows.push([FEEDBACK_FORM_ENTRIES.fixNext, noteChunks[index]]);
    if(index === 0 && email)rows.push([FEEDBACK_FORM_ENTRIES.email, email]);
    if(chunk)rows.push([reportEntry, chunk]);
    return rows;
  });
}

async function feedbackSubmitParts(parts){
  const endpoint = feedbackFormResponseUrl();
  for(const rows of parts || []){
    const body = new URLSearchParams();
    for(const pair of rows || []){
      if(!pair || pair[1] == null || pair[1] === '')continue;
      body.append(String(pair[0]), String(pair[1]));
    }
    await fetch(endpoint, {method:'POST', mode:'no-cors', body});
  }
}

let feedbackContextText = '';

function openFeedbackForm(opts){
  opts = opts || {};
  feedbackContextText = String(opts.context || feedbackDeviceReport());
  const note = $('feedback-note');
  if(note)note.value = opts.note || '';
  const email = $('feedback-email');
  if(email)email.value = '';
  const status = $('feedback-status');
  if(status){ status.hidden = true; status.textContent = ''; }
  const send = $('feedback-send');
  if(send)send.disabled = false;
  const known = $('feedback-known');
  if(known){
    known.replaceChildren();
    for(const [label, value] of feedbackKnownLines()){
      const row = document.createElement('p');
      row.className = 'feedback-known-row';
      const name = document.createElement('span');
      name.textContent = label;
      const text = document.createElement('strong');
      text.textContent = value;
      row.append(name, text);
      known.append(row);
    }
  }
  const pre = $('feedback-context');
  if(pre)pre.textContent = feedbackContextText;
  const lead = $('feedback-lead');
  if(lead){
    lead.textContent = opts.assistant
      ? 'Filled in from this device, with the Ask Tings chat included in full. A note is optional.'
      : 'Filled in from this device. A note is optional.';
  }
  if(typeof openSheet === 'function')openSheet('feedback-sheet');
}

async function sendFeedbackForm(){
  const send = $('feedback-send');
  const status = $('feedback-status');
  if(send)send.disabled = true;
  if(status)status.hidden = true;
  try{
    await feedbackSubmitParts(feedbackFormParts({
      context:feedbackContextText,
      note:$('feedback-note')?.value || '',
      email:$('feedback-email')?.value || ''
    }));
    if(typeof showToast === 'function')showToast('feedback sent');
    if(typeof closeSheet === 'function')closeSheet('feedback-sheet');
  }catch(_){
    if(send)send.disabled = false;
    if(status){
      status.hidden = false;
      status.textContent = 'Could not send. Check the connection and try again.';
    }
  }
}

for(const id of ['open-feedback', 'home-open-feedback', 'bar-open-feedback']){
  $(id)?.addEventListener('click', event => {
    event.preventDefault();
    openFeedbackForm();
  });
}
$('feedback-close')?.addEventListener('click', () => { if(typeof closeSheet === 'function')closeSheet('feedback-sheet'); });
$('feedback-cancel')?.addEventListener('click', () => { if(typeof closeSheet === 'function')closeSheet('feedback-sheet'); });
$('feedback-send')?.addEventListener('click', () => { void sendFeedbackForm(); });
$('feedback-sheet')?.addEventListener('click', event => {
  if(event.target === event.currentTarget && typeof closeSheet === 'function')closeSheet('feedback-sheet');
});
