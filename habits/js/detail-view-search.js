// Search navigates settings. Its explicit assistant action opens a focused edit
// (the Summary tab for Needle); typing alone never changes a setting or invokes
// the model.
const DETAIL_SEARCH_FIELDS = ITEM_DETAIL_SEARCH_FIELDS;

function resetDetailDisclosures(h){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  inner.querySelectorAll('.detail-disclosure').forEach(el=>{
    delete el.dataset.regularOpen;
    el.open = el.dataset.detailEssential === 'true';
  });
  const configured = {
    'detail-options-disclosure':Boolean(h.scheduleOptions?.length),
    'detail-order-disclosure':Boolean(h.scheduleLinks?.length),
    'detail-links-disclosure':Boolean(h.links?.length),
    'detail-native-reminders':typeof nativeReminderAnyOn === 'function' && nativeReminderAnyOn(`item:${h.hid}`)
  };
  Object.entries(configured).forEach(([id,open])=>{if($(id))$(id).open = open;});
}

const DETAIL_SEARCH_ASCII_WORD = /^[A-Za-z0-9]+$/;
function detailSearchNormalize(value){
  const str = String(value || '');
  if(DETAIL_SEARCH_ASCII_WORD.test(str))return str.toLowerCase();
  return str.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

// ---- Shared search primitives (detail + settings) ----

// Bounded Damerau-Levenshtein: insertion, deletion, substitution, and
// adjacent transposition. Fast zero-allocation path for maxEdits === 1.
function searchEditWithin(word,token,maxEdits){
  if(word === token)return true;
  const wl = word.length, tl = token.length;
  const diff = wl - tl;
  if(diff > maxEdits || diff < -maxEdits)return false;
  if(maxEdits === 1){
    if(diff === 0){
      let i = 0;
      while(i < wl && word.charCodeAt(i) === token.charCodeAt(i))i++;
      // Adjacent transposition or single substitution.
      if(i + 1 < wl && word.charCodeAt(i) === token.charCodeAt(i + 1)
        && word.charCodeAt(i + 1) === token.charCodeAt(i)){
        i += 2;
      }else{
        i += 1;
      }
      while(i < wl && word.charCodeAt(i) === token.charCodeAt(i))i++;
      return i === wl;
    }
    const longer = diff > 0 ? word : token;
    const shorter = diff > 0 ? token : word;
    const sl = shorter.length;
    let i = 0;
    while(i < sl && longer.charCodeAt(i) === shorter.charCodeAt(i))i++;
    while(i < sl && longer.charCodeAt(i + 1) === shorter.charCodeAt(i))i++;
    return i === sl;
  }
  let prev = new Array(tl + 1).fill(0).map((_,j)=>j);
  let prev2 = null;
  for(let i=1;i<=wl;i++){
    const cur = [i];
    for(let j=1;j<=tl;j++){
      let d = Math.min(prev[j] + 1,cur[j-1] + 1,prev[j-1] + (word[i-1] === token[j-1] ? 0 : 1));
      if(i > 1 && j > 1 && word[i-1] === token[j-2] && word[i-2] === token[j-1])d = Math.min(d,prev2[j-2] + 1);
      cur.push(d);
    }
    prev2 = prev;prev = cur;
  }
  return prev[tl] <= maxEdits;
}

// Conservative plural folding; the typed token always stays in the list.
function detailSearchTokenVariants(token){
  const stems = [token];
  if(token.length > 4 && token.endsWith('ies'))stems.push(token.slice(0,-3) + 'y');
  else if(token.length > 4 && token.endsWith('s'))stems.push(token.slice(0,-1));
  return stems;
}

// Per-kind weights per field. An exact curated alias outranks a fuzzy label
// coincidence; typo matches beat weak alias matches but never exact ones.
const SEARCH_FIELD_WEIGHTS = {
  label:{exact:100, prefix:80, plural:75, substring:60, fuzzy:38},
  alias:{exact:44, prefix:34, plural:40, substring:28, fuzzy:24},
  path:{exact:20, prefix:17, plural:19, substring:14, fuzzy:13},
  desc:{exact:12, prefix:10, plural:11, substring:8, fuzzy:7}
};
const SEARCH_FIELD_ORDER = ['label','alias','path','desc'];
// Detail accepts mid-word substrings and fuzzies from five letters. Settings
// supports typeahead from three letters in names and curated aliases; shared
// section paths and descriptions need five to avoid flooding sibling controls.
// Shorter words still match exactly; settings fuzzies start at seven letters.
const DETAIL_SEARCH_RULES = {prefixMin:1, substring:true, fuzzyMin:5};
const SETTINGS_SEARCH_RULES = {prefixMin:3, contextPrefixMin:5, substring:false, fuzzyMin:7};

// Where one query token best matched this entry: field + kind. Ranking and
// highlighting both decide from this evidence, so they can never disagree.
function searchTokenEvidence(entry,token,rules){
  const variants = detailSearchTokenVariants(token);
  let best = null,bestWeight = 0;
  for(const field of SEARCH_FIELD_ORDER){
    const text = entry[field + 'N'];
    if(!text)continue;
    const words = entry[field + 'W'] || (entry[field + 'W'] = text.split(' '));
    const weights = SEARCH_FIELD_WEIGHTS[field];
    const prefixMin = (field === 'path' || field === 'desc')
      ? (rules.contextPrefixMin ?? rules.prefixMin) : rules.prefixMin;
    let kind;
    if(words.some(word=>word === token))kind = 'exact';
    else if(words.some(word=>variants.some(v=>v !== token && word === v)))kind = 'plural';
    else if(token.length >= prefixMin && words.some(word=>word.startsWith(token)))kind = 'prefix';
    else if(rules.substring && words.some(word=>word.includes(token)))kind = 'substring';
    else if(token.length >= rules.fuzzyMin && words.some(word=>searchEditWithin(word,token,1)))kind = 'fuzzy';
    if(kind && weights[kind] > bestWeight){best = {field,kind};bestWeight = weights[kind];}
  }
  return best;
}

// Rank entries for a tokenized query. Every token must match. Whole-label
// equality leads, then a label starting with the whole query, then summed
// per-token evidence. Ties stay deterministic: label order when asked,
// otherwise the order entries were discovered in.
function searchRankEntries(entries,tokens,rules,labelTiebreak){
  const query = tokens.join(' ');
  tokens = [...new Set(tokens)];
  const scored = entries.map((entry,order)=>{
    let score = 0;
    const evidence = {};
    for(const token of tokens){
      const hit = searchTokenEvidence(entry,token,rules);
      evidence[token] = hit;
      if(hit)score += SEARCH_FIELD_WEIGHTS[hit.field][hit.kind];
    }
    if(query && entry.labelN === query)score += 1000;
    else if(query && entry.labelN.startsWith(query))score += 30;
    return {entry,order,evidence,score};
  }).filter(row=>tokens.every(token=>row.evidence[token]));
  return scored.sort((a,b)=>b.score - a.score
    || (labelTiebreak ? a.entry.label.localeCompare(b.entry.label) : 0)
    || a.order - b.order);
}

// Wrap the original words a token matched in this displayed field. Comparison
// is normalized; the original word node is kept, so accents and case survive.
// Alias-only hits leave the visible text unmarked.
function searchFieldPieces(entry,text,field){
  const key = field + 'Pieces';
  if(entry && entry[key])return entry[key];
  const out = [];
  for(const piece of String(text || '').split(/([\p{L}\p{N}\p{M}]+)/u)){
    if(!piece)continue;
    out.push({piece,word:detailSearchNormalize(piece)});
  }
  if(entry)entry[key] = out;
  return out;
}

function searchMarkedText(parent,text,evidence,field,entry = null){
  const raw = String(text || '');
  const tokens = Object.keys(evidence);
  let hasFieldHit = false;
  for(let i = 0;i < tokens.length;i++){
    const hit = evidence[tokens[i]];
    if(hit && hit.field === field){hasFieldHit = true;break;}
  }
  if(!hasFieldHit){
    parent.textContent = raw;
    return;
  }
  // Token boundaries mirror normalization, including punctuation inside a
  // label ("time-window") while retaining combining accents in the word.
  const pieces = searchFieldPieces(entry,raw,field);
  for(let i = 0;i < pieces.length;i++){
    const {piece,word} = pieces[i];
    const marked = Boolean(word) && tokens.some(token=>{
      const hit = evidence[token];
      if(!hit || hit.field !== field)return false;
      if(hit.kind === 'exact')return word === token;
      if(hit.kind === 'plural')return detailSearchTokenVariants(token).includes(word);
      if(hit.kind === 'prefix')return word.startsWith(token);
      if(hit.kind === 'substring')return word.includes(token);
      return searchEditWithin(word,token,1);
    });
    if(marked){
      const mark = document.createElement('mark');
      mark.textContent = piece;
      parent.append(mark);
    }else parent.append(document.createTextNode(piece));
  }
}

function searchResultButton(row,onPick){
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'detail-search-result';
  const label = document.createElement('b');
  searchMarkedText(label,row.entry.label,row.evidence,'label',row.entry);
  const path = document.createElement('small');
  searchMarkedText(path,row.entry.path,row.evidence,'path',row.entry);
  button.append(label,path);
  button.addEventListener('click',()=>onPick(row.entry));
  return button;
}

let _detailSearchStaticCache = null;
let _detailSearchLastRenderSig = '';
function invalidateDetailSearchCache(){
  _detailSearchStaticCache = null;
  _detailSearchLastRenderSig = '';
}

function detailSearchEntries(){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return [];
  const panelOpen = !$('detail-search-panel')?.hidden;
  const singleView = detailIsSingleView();
  const optional = $('detail-sheet').classList.contains('opportunity-mode');
  const staticKey = panelOpen
    ? `${detailIdx}|${typeof plannerDataRevision === 'function' ? plannerDataRevision() : 0}|${singleView?1:0}|${optional?1:0}|${$('detail-time-kind')?.value || ''}|${window.TingsNative?.sharingEnabled === false ? 0 : 1}|${typeof shareConfigured === 'function' && shareConfigured() ? 1 : 0}`
    : '';
  const hiddenFullOnly = new Map();
  const isFullOnlyHidden = target => {
    if(!singleView)return false;
    for(let section=target.closest('.detail-full-only');section;section=section.parentElement.closest('.detail-full-only')){
      let hidden = hiddenFullOnly.get(section);
      if(hidden === undefined){
        hidden = getComputedStyle(section).display === 'none';
        hiddenFullOnly.set(section,hidden);
      }
      if(hidden)return true;
    }
    return false;
  };
  const makeEntry = (target,label,aliases,desc,order,seenTargets)=>{
    const page = target?.closest('.detail-page');
    if(!page || page.hidden || (target.disabled && target.id !== 'detail-due-time'))return null;
    if(isFullOnlyHidden(target))return null;
    if(optional && (target.id === 'detail-times'
      || target.closest('#detail-flexibility-disclosure') || label === 'Place preferences'))return null;
    // Platform-only controls are deliberately absent, including native sharing.
    if(target.closest('.detail-shared-display-control') && window.TingsNative?.sharingEnabled === false)return null;
    if(target.id === 'detail-share-item' && typeof shareConfigured === 'function' && !shareConfigured())return null;
    if(target.id === 'detail-export' && target.hidden)return null;
    if(target.id === 'detail-order-block' && target.hidden)return null;
    const sections = [];
    for(let p=target.closest('details');p;p=p.parentElement.closest('details')){
      sections.unshift(p.querySelector(':scope > summary')?.textContent.trim());
    }
    const path = [detailPageLabel(page.dataset.detailNav),...sections].filter(Boolean).join(' › ');
    const labelN = detailSearchNormalize(label);
    if(!labelN)return null;
    if(seenTargets.has(target))return null;
    seenTargets.add(target);
    const aliasN = detailSearchNormalize(aliases);
    const pathN = detailSearchNormalize(path);
    const descN = detailSearchNormalize(desc);
    return {
      target,label,path,labelN,aliasN,pathN,descN,
      labelW:labelN ? labelN.split(' ') : [],
      aliasW:aliasN ? aliasN.split(' ') : [],
      pathW:pathN ? pathN.split(' ') : [],
      descW:descN ? descN.split(' ') : [],
      order
    };
  };

  let staticEntries;
  let seenTargets;
  if(panelOpen && _detailSearchStaticCache && _detailSearchStaticCache.key === staticKey){
    staticEntries = _detailSearchStaticCache.entries;
    seenTargets = new Set(staticEntries.map(e=>e.target));
  }else{
    staticEntries = [];
    seenTargets = new Set();
    const addStatic = (target,label,aliases='',desc='')=>{
      const entry = makeEntry(target,label,aliases,desc,staticEntries.length,seenTargets);
      if(entry)staticEntries.push(entry);
    };
    DETAIL_SEARCH_FIELDS.forEach(([id,label,aliases])=>{
      if(optional && id === 'detail-days'){
        label = 'Repeat limit';aliases += ' minimum days between occurrences at most maximum frequency';
      }
      if(id === 'detail-allowed-time-row' && $('detail-time-kind').value === 'fixed'){
        label = 'Fixed start time';aliases += ' exact start class appointment';
      }
      addStatic($(id),label,aliases);
    });
    inner.querySelectorAll('.detail-page details > summary').forEach(el=>addStatic(el,el.textContent.trim()));
    // Reminder edges are div.native-reminder-row; the DND control is a label.
    inner.querySelectorAll('#detail-native-reminders label, #detail-native-reminders .native-reminder-row, #detail-native-reminders .native-reminder-sound').forEach(row=>{
      if(row.closest('[hidden]'))return;
      const face = row.querySelector('.native-reminder-name')?.textContent || row.childNodes[0]?.textContent.trim();
      const edge = row.querySelector('select')?.dataset.reminderEdge;
      // Reminder rows show a timing face (“when you leave”); the searchable
      // name is the edge title (“travel: departure”) people actually type.
      const edgeTitle = typeof NATIVE_REMINDER_EDGES !== 'undefined'
        ? NATIVE_REMINDER_EDGES.find(([key])=>key === edge)?.[1] : '';
      const label = edgeTitle && edgeTitle !== face ? `${edgeTitle} (${face})` : (edgeTitle || face);
      let aliases = row.matches('.native-reminder-sound')
        ? 'notification sound tone chime ringtone audio custom phone sound'
        : 'phone reminder notification ringing alarm';
      if(edge === 'missed')aliases += ' before missed drop cutoff warning estimate';
      if(row.querySelector('[data-reminder-lead]'))aliases += ' travel departure lead time minutes';
      addStatic(row,label || 'Schedule option',aliases);
    });
    if(panelOpen)_detailSearchStaticCache = {key:staticKey,entries:staticEntries};
  }

  // Dynamic user rows (.habit-option-row, .schedule-link-editor, .link-row)
  // are few (usually 0-3) and read live selected state so visibility changes
  // stay accurate without re-walking the static field catalog.
  const dynamicRows = inner.querySelectorAll('.habit-option-row, .schedule-link-editor, .link-row');
  if(!dynamicRows.length)return staticEntries;
  const entries = staticEntries.slice();
  const rowSelectedText = row=>{
    const parts = [];
    row.querySelectorAll('.habit-option-field-label,.schedule-chip.on,.seg-opt.on').forEach(el=>{
      if(!el.closest('[hidden]'))parts.push(el.textContent);
    });
    row.querySelectorAll('select').forEach(select=>{
      if(select.closest('[hidden]'))return;
      const selected = select.querySelector('option:checked');
      if(selected)parts.push(selected.textContent);
    });
    row.querySelectorAll('input[type="text"],input:not([type]),input[type="url"],input[type="tel"]').forEach(input=>{
      if(input.closest('[hidden]'))return;
      if(input.value)parts.push(input.value);
    });
    return parts.join(' ');
  };
  dynamicRows.forEach(row=>{
    if(row.closest('[hidden]'))return;
    let label,aliases;
    if(row.matches('.schedule-link-editor')){
      label = `Item order: ${row.querySelector('.schedule-link-habit option:checked')?.textContent || 'choose a partner'}`;
      aliases = rowSelectedText(row);
    }else if(row.matches('.habit-option-row')){
      label = `${row.querySelector('.habit-option-number')?.textContent || 'Option'}: ${row.querySelector('.habit-option-location option:checked')?.textContent || 'anywhere'}`;
      aliases = rowSelectedText(row);
    }else{
      label = row.querySelector('.link-app-name')?.value || row.querySelector('.link-value')?.value || 'Link or call';
      aliases = rowSelectedText(row);
    }
    const entry = makeEntry(row,label || 'Schedule option',aliases,'',entries.length,seenTargets);
    if(entry)entries.push(entry);
  });
  return entries;
}

// Dock syncs and search labels ask this several times per detail paint, each
// read costing a full saved-list load. The answer only changes with the open
// item, a save, or the two assistant settings, so cache on those. `held` is
// the record the paint already loaded.
let _detailAssistantCheck = null;
function detailAssistantAvailable(held){
  const sig = `${detailIdx}|${plannerDataRevision()}|${sortSettings?.localAssistant ? 1 : 0}|${sortSettings?.localAssistantProvider}`;
  if(_detailAssistantCheck && _detailAssistantCheck.sig === sig)return _detailAssistantCheck.ok;
  const item = detailIdx === null ? null : (held || load()[detailIdx]);
  const ok = Boolean(sortSettings?.localAssistant && item
    && (sortSettings.localAssistantProvider !== 'needle'
      || !['device','pdf','ics','gcal','msgraph'].includes(item.source)));
  _detailAssistantCheck = {sig,ok};
  return ok;
}

function syncDetailSearchAssistant(h){
  const enabled = detailAssistantAvailable(h);
  const label = enabled ? 'Find or change a setting' : 'Find a setting';
  $('detail-search-input').placeholder = label;
  $('detail-search-input').setAttribute('aria-label',label);
  $('detail-search-ask').hidden = !enabled || !$('detail-search-input').value.trim();
  $('detail-search-ask-label').textContent = 'Ask assistant';
}

let detailAssistantOpening = false;
// Needle edits in the Summary tab; other providers keep the chat sheet.
async function openDetailAssistant(instruction = '',opts = {}){
  if(detailAssistantOpening || !detailAssistantAvailable())return false;
  const inner = getSheetInner('detail-sheet');
  if(inner?.classList.contains('tune-dirty')){
    showToast('Save or cancel your edits before asking for a change.');
    return false;
  }
  const item = load()[detailIdx];
  if(typeof tingsLoadAssistant !== 'function')return false;
  detailAssistantOpening = true;
  $('detail-search-ask').disabled = true;
  try{
    const loaded = await tingsLoadAssistant();
    // Loading the optional bundle must not move an instruction to another item
    // if the user has navigated away, changed settings, or begun a manual edit.
    if(!loaded){
      showToast('Assistant could not open. Try again.');
      return false;
    }
    const visible = $('detail-sheet').classList.contains('open') || getPane()?.dataset.activeSheet === 'detail-sheet';
    if(!detailAssistantAvailable() || load()[detailIdx]?.hid !== item.hid
      || !visible || inner?.classList.contains('tune-dirty'))return false;
    if(sortSettings.localAssistantProvider === 'needle'){
      setDetailSearchOpen(false,false);
      $('detail-search-input').value = '';
      syncDetailSearchAssistant();
      return detailSummaryStart(instruction,opts);
    }
    if(typeof assistantOpenForItem !== 'function')return false;
    const opened = await assistantOpenForItem(item.hid,'detail',{occurrenceDate:opts.occurrenceDate || ''});
    if(opened){
      setDetailSearchOpen(false,false);
      $('detail-search-input').value = '';
      syncDetailSearchAssistant();
      const text = String(instruction || '').trim();
      if(text)void sendAssistantMessage(text);
    }
    return opened;
  }catch(error){
    console.warn('[tings assistant] detail entry unavailable',error);
    showToast('Assistant could not open. Try again.');
    return false;
  }finally{
    detailAssistantOpening = false;
    $('detail-search-ask').disabled = false;
  }
}

function renderDetailSearch(){
  const input = $('detail-search-input');
  const query = detailSearchNormalize(input.value).slice(0,120);
  const tokens = query.split(' ').filter(Boolean);
  const ranked = searchRankEntries(detailSearchEntries(),tokens,DETAIL_SEARCH_RULES,false);
  const results = $('detail-search-results');
  const renderSig = `${query}|${ranked.map(r=>`${r.entry.order}:${r.entry.label}`).join(',')}`;
  if(_detailSearchLastRenderSig !== renderSig){
    _detailSearchLastRenderSig = renderSig;
    const frag = document.createDocumentFragment();
    ranked.forEach(row=>frag.append(searchResultButton(row,entry=>revealDetailSearchEntry(entry))));
    results.replaceChildren(frag);
  }
  syncDetailSearchAssistant();
  const assistant = detailAssistantAvailable();
  $('detail-search-status').textContent = !tokens.length
    ? (assistant ? 'Find a setting or describe a change.' : 'Browse settings, or search by name.')
    : ranked.length ? `${ranked.length} ${ranked.length === 1 ? 'match' : 'matches'}`
    : assistant ? 'No matching settings. Try another word or ask the assistant.'
    : 'No matching settings. Try “duration”, “weather”, “reminder” or “days”.';
  $('detail-search-clear').hidden = !input.value;
}

let detailSearchReturnNav = null;
let detailSearchReturnScroll = [];
function setDetailSearchOpen(open,focus = true){
  open = Boolean(open && !getSheetInner('detail-sheet')?.classList.contains('tune-dirty'));
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const wasOpen = inner.classList.contains('detail-search-open');
  if(open && !wasOpen){
    const pager = inner.querySelector('.detail-pager');
    const pages = visibleDetailPages(pager);
    detailSearchReturnNav = detailCurrentNav();
    detailSearchReturnScroll = [pager,...inner.querySelectorAll('.detail-minimal-settings'),...pages].map(page=>({page,top:page.scrollTop}));
  }
  inner.classList.toggle('detail-search-open',open);
  $('detail-search-panel').hidden = !open;
  const toggle = $('detail-search-toggle');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open ? 'focus detail search' : 'search detail settings');
  $('detail-cool').setAttribute('aria-label',open ? 'close detail search' : 'close details');
  inner.querySelector('.detail-search-field').hidden = !open;
  if(!open){
    invalidateDetailSearchCache();
    $('detail-search-input').blur();
    if(wasOpen){
      if(detailSearchReturnNav)scrollDetailToNav(detailSearchReturnNav,'auto');
      detailSearchReturnScroll.forEach(({page,top})=>{if(page.isConnected)page.scrollTop = top;});
    }
  }
  if(open){
    if(!wasOpen)invalidateDetailSearchCache();
    renderDetailSearch();
    updateKeyboardLift();
    if(focus)$('detail-search-input').focus({preventScroll:true});
  }else if(focus){
    $('detail-search-input').blur();
    toggle.focus({preventScroll:true});
  }
  if(typeof syncDetailSummaryDock === 'function')syncDetailSummaryDock();
}

let detailSearchHitTarget = null;
let detailSearchHitTimer = null;
function revealDetailSearchEntry(entry){
  if(!entry.target.isConnected)return;
  let target = entry.target;
  const original = target;
  setDetailSearchOpen(false,false);
  $('detail-search-input').blur();
  if(entry.revealHidden && detailIsSingleView()){
    // A chat summary may refer to an advanced setting hidden in minimal mode.
    // Reveal only its section for this visit, without changing the preference.
    target.closest('.detail-page').hidden = false;
    for(let p=target.closest('.detail-full-only');p;p=p.parentElement.closest('.detail-full-only'))p.classList.add('detail-field-revealed');
    if(target.closest('#detail-schedule-preferred'))$('detail-schedule-view-seg')?.classList.add('detail-field-revealed');
  }
  const preferred = target.closest('#detail-schedule-preferred') || entry.label === 'Place preferences';
  if(target.closest('[data-detail-nav="availability"]'))setScheduleView(preferred ? 'preferred' : 'allowed');
  if(target.id === 'detail-viz-seg'){
    detailVizMode = 'gaps';syncDetailVizMode();
  }else if(target.closest('.detail-calendar-page')){
    detailVizMode = 'calendar';syncDetailVizMode();
  }
  let message = '';
  if(target.closest('#detail-min-chunk-row') && $('detail-min-chunk-row').hidden){
    target = $('detail-breakable-row');message = 'Turn on “breakable into chunks” to set a minimum chunk.';
  }else if(target.closest('#detail-due-row') && $('detail-due-row').hidden){
    target = $('detail-rhythm-disclosure').querySelector('summary');message = 'Due dates and fixed times are available for tasks. Change the type in Identity first.';
  }else if(target.id === 'detail-due-time' && target.disabled){
    target = $('detail-due-date');message = 'Choose a due date before setting a start time.';
  }else if(target.closest('#detail-slider-row') && $('detail-slider-row').hidden){
    target = $('detail-rhythm-disclosure').querySelector('summary');
    message = currentDetailTune().type === 'zero'
      ? 'Choose build or limit in Identity to set a repeating frequency.'
      : 'Choose Habit in Identity to set a repeating frequency.';
  }else if(target.closest('#detail-mode-field') && $('detail-mode-field').hidden){
    target = $('detail-type-seg');message = 'Choose Habit to see build, limit and stop.';
  }else if(target.closest('#detail-weather-location-wrap') && $('detail-weather-location-wrap').hidden){
    target = $('detail-weather-profile');message = 'Choose the weather first. Then pick where to check it, if this isn’t tied to one place.';
  }else if(target.closest('#detail-show-weather-location-row') && $('detail-show-weather-location-row').hidden){
    target = $('detail-show-weather');message = 'Turn on “show weather” to choose its forecast place.';
  }
  for(let p=target.closest('details');p;p=p.parentElement.closest('details'))p.open = true;
  scrollDetailToNav(target.closest('.detail-page').dataset.detailNav,'auto');
  const navigationRevision = detailNavigationRevision;
  requestAnimationFrame(()=>{
    if(!target.isConnected || detailIdx === null || navigationRevision !== detailNavigationRevision)return;
    // Conditional fields can change after rendering; land on their nearest
    // visible section without turning on or altering any saved settings.
    if(!target.getClientRects().length)target = original.closest('details')?.querySelector('summary') || target;
    // Reveal only inside the selected panel. Scrolling every ancestor can
    // move the sheet/document while iOS is settling its viewport.
    const page = target.closest('.detail-page');
    const scroller = detailIsSingleView() ? page.closest('.detail-minimal-settings') || page : page;
    const rect = target.getBoundingClientRect(),bounds = scroller.getBoundingClientRect();
    scroller.scrollTo({top:scroller.scrollTop + rect.top - bounds.top
      - Math.max(0,(scroller.clientHeight - rect.height) / 2),behavior:'instant'});
    clearTimeout(detailSearchHitTimer);
    detailSearchHitTarget?.classList.remove('detail-search-hit');
    detailSearchHitTarget = target;
    target.classList.add('detail-search-hit');
    detailSearchHitTimer = setTimeout(()=>target.classList.remove('detail-search-hit'),2400);
    const focus = target.matches('input,select,button,summary') ? target : target.querySelector('input,select,button,summary');
    if(focus && entry.focus !== false)focus.focus({preventScroll:true});
    if(message)showToast(message,4500);
  });
}

$('detail-search-toggle').addEventListener('click',()=>setDetailSearchOpen(true));
// Show editing actions on field focus. Reclaim space for mobile, including native
// keyboards that resize the WebView itself rather than visualViewport.
// Search keeps its own keyboard layout, and Save/Cancel stay reachable.
let detailEditingPointerDown = false;
function syncDetailEditingChrome(){
  const inner = getSheetInner('detail-sheet');
  if(!inner)return;
  const active = document.activeElement;
  // updateKeyboardLift always writes this custom property inline before calling;
  // reading the inline style skips the whole-document computed-style pass that
  // a getComputedStyle read would force on a freshly repainted detail sheet.
  // The stylesheet default is 0px (tokens.css), so an unset inline value reads
  // the same through either path.
  const keyboardSpace = parseFloat(document.documentElement.style.getPropertyValue('--keyboard-lift')
    || getComputedStyle(document.documentElement).getPropertyValue('--keyboard-lift')) || 0;
  const virtualKeyboard = window.TingsNative?.isNative
    || matchMedia('(any-pointer:coarse)').matches
    || matchMedia('(pointer:coarse)').matches
    || matchMedia('(hover:none)').matches
    || keyboardSpace > 2;
  const editing = inner.contains(active) && active.closest('.detail-page')
    && active.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]')
    && !active.readOnly && !active.disabled;
  // Blurring the field on pointerdown must not move the intended button
  // before pointerup/click reaches it.
  if(!editing && detailEditingPointerDown)return;
  // Blur precedes the IME's closing resize. Keep the editing chrome until
  // that resize finishes, otherwise Search/X briefly appears above the
  // keyboard and then jumps to the bottom. Android already resizes the
  // layout, so its zero keyboard-lift is not evidence that the IME closed.
  const nativeResized = window.TingsNative?.isNative && window.TingsNative.platform === 'android'
    && Math.abs((window.visualViewport?.scale || 1) - 1) < 0.01;
  const keyboardVisible = nativeResized
    ? nativeKeyboardRestHeight - document.documentElement.clientHeight > 2 : keyboardSpace > 2;
  const closing = !inner.classList.contains('detail-search-open')
    && inner.classList.contains('detail-field-editing') && keyboardVisible;
  // Keep clean actions available when a hardware-keyboard user tabs from
  // the field to Cancel/Save. Only mobile editing needs to hide navigation.
  const actionFocused = inner.classList.contains('detail-editing')
    && inner.contains(active) && active.closest('.tune-actions');
  inner.classList.toggle('detail-editing',Boolean(editing || actionFocused || closing));
  // Home search's keyboard can still be closing when detail first opens.
  // Only compact navigation for a detail field's own editing session.
  inner.classList.toggle('detail-keyboard-open',Boolean(keyboardVisible && (editing || closing) && !inner.classList.contains('detail-search-open')));
  inner.classList.toggle('detail-field-editing',Boolean((editing && virtualKeyboard) || closing));
  if(typeof syncDetailSummaryTyping === 'function')syncDetailSummaryTyping(keyboardVisible);
}
document.addEventListener('pointerdown',event=>{
  detailEditingPointerDown = Boolean(event.target.closest('.detail-sheet'));
},true);
['pointerup','pointercancel'].forEach(type=>document.addEventListener(type,()=>{
  if(!detailEditingPointerDown)return;
  detailEditingPointerDown = false;
  setTimeout(syncDetailEditingChrome,250);
},true));
document.addEventListener('focusin',syncDetailEditingChrome);
document.addEventListener('focusout',()=>requestAnimationFrame(syncDetailEditingChrome));
$('detail-search-input').addEventListener('input',event=>{
  if(event.isComposing)return;
  renderDetailSearch();
});
$('detail-search-input').addEventListener('compositionend',renderDetailSearch);
$('detail-search-input').addEventListener('keydown',event=>{
  if(event.isComposing)return;
  const first = $('detail-search-results').querySelector('button')
    || (!$('detail-search-ask').hidden ? $('detail-search-ask') : null);
  if(event.key === 'ArrowDown'){
    event.preventDefault();first?.focus();
  }else if(event.key === 'Enter'){
    event.preventDefault();first?.click();
  }
});
$('detail-search-ask').addEventListener('click',()=>void openDetailAssistant($('detail-search-input').value));
$('detail-search-clear').addEventListener('click',()=>{
  $('detail-search-input').value='';renderDetailSearch();$('detail-search-input').focus();
});
$('detail-search-results').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const buttons = [...$('detail-search-results').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0,Math.min(buttons.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();buttons[next]?.focus();
});
document.addEventListener('keydown',event=>{
  if(event.key !== 'Escape' || $('detail-search-panel').hidden)return;
  // A nested modal must dismiss before the search underneath it.
  if([...document.querySelectorAll('.sheet-wrap.open')].some(el=>el.id !== 'detail-sheet' && (parseInt(getComputedStyle(el).zIndex,10)||0)>110))return;
  event.preventDefault();event.stopImmediatePropagation();setDetailSearchOpen(false);
},true);
