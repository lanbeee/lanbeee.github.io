// Bulk add: queue items with "add & next", review the batch, then save the
// whole valid batch in one operation. Settings carry forward because the add
// form itself is never reset between items; every queued record is an
// independent deep copy, so adjusting the next item can never change an
// earlier one. Nothing here writes localStorage before the final commit.

let bulkBatchMode = false;
let bulkBatchItems = []; // queued raw records; identity is minted by save()
let bulkUnfinishedChoice = null; // null asks again; 'skip' hides the offer
let bulkDupIndex = null; // queued index currently being named for a copy
let bulkEmojiChosen = false; // an explicitly typed emoji survives carry-forward
let bulkDraftContext = null; // {record} while the detail editor holds a queued draft

function bulkBatchActive(){
  return bulkBatchMode;
}

function openBulkBatchFlow(){
  if(bulkBatchMode || (typeof isMinimalMode === 'function' && isMinimalMode()))return;
  bulkBatchMode = true;
  bulkUnfinishedChoice = null;
  updateBulkBatchChrome();
  // The form already holds the user's first configuration — keep it.
  $('ting-message').focus({preventScroll:true});
}

function exitBulkBatchMode(){
  bulkBatchMode = false;
  bulkBatchItems = [];
  bulkUnfinishedChoice = null;
  bulkDupIndex = null;
  bulkEmojiChosen = false;
  if($('add-batch-confirm'))$('add-batch-confirm').hidden = true;
  updateBulkBatchChrome();
}

// Footer, chip and hint state for batch mode. #do-save keeps its own label
// management; batch mode hides it and shows #do-batch-next instead.
function updateBulkBatchChrome(){
  $('add-sheet')?.classList.toggle('bulk-add-mode',bulkBatchMode);
  const count = bulkBatchItems.length;
  const status = $('add-batch-status');
  if(status){
    status.hidden = !bulkBatchMode || count === 0;
    status.textContent = `${count} item${count === 1 ? '' : 's'} in batch · review`;
  }
  const hint = $('add-batch-hint');
  if(hint)hint.hidden = !bulkBatchMode;
  const bar = $('add-batch-bar');
  if(bar)bar.hidden = !bulkBatchMode;
}

// One summary line per queued row: type, effort, rhythm or date, places.
function bulkSummaryFor(record){
  const parts = [];
  parts.push(record.appointment ? 'event' : habitTypeLabel(record.type));
  if(record.durationMinutes)parts.push(`${record.durationMinutes} min`);
  if(record.type === 'task')parts.push(bulkDueLabel(record) || 'no date');
  else parts.push(bulkRhythmLabel(record));
  const places = Array.isArray(record.locationIds) ? record.locationIds.length : 0;
  if(places)parts.push(`${places} place${places === 1 ? '' : 's'}`);
  else if(record.anywhereAllowed)parts.push('anywhere');
  if(record.priority != null && record.priority !== DEFAULT_PRIORITY)parts.push(PRIORITY_LABELS[clampPriority(record.priority)]);
  return parts.filter(Boolean).join(' · ');
}

// Queue the current form as the next batch item. Mirrors the single-item
// save validations, then keeps every setting for the item after it.
function bulkQueueCurrent(){
  if(!bulkBatchMode)return false;
  const name = $('ting-message').value.trim();
  if(!name){$('ting-message').focus();return false;}
  if(name.length > 60){
    $('ting-message').focus();
    if(typeof showToast === 'function')showToast('Names stop at 60 characters.');
    return false;
  }
  if(!bulkEmojiChosen && typeof applyAutoEmoji === 'function')applyAutoEmoji();
  if(addAppointmentMode && !validateAppointmentFields('add-appt'))return false;
  const data = load();
  const capacity = typeof MAX_TINGS === 'number' ? MAX_TINGS : 300;
  if(data.length + bulkBatchItems.length >= capacity){
    showToast(`${capacity} habits max`);
    return false;
  }
  const record = readAddRecord();
  if(isOpportunityHabit(record) && !record.locationIds.length
    && typeof weatherHabitHasActiveGuidance === 'function'
    && !weatherHabitHasActiveGuidance(record,sortSettings)){
    if(typeof refreshAddAvailability === 'function')refreshAddAvailability();
    $('ting-weather-profile').focus();
    return false;
  }
  // Independent deep copy: later form edits must never reach a queued item.
  bulkBatchItems.push(bulkClone(record));
  bulkUnfinishedChoice = null;
  bulkDupIndex = null;
  updateBulkBatchChrome();
  // Fresh identity for the next item: clear the name, recalculate the
  // automatic emoji, and remember an explicitly chosen one.
  $('ting-message').value = '';
  if(bulkEmojiChosen && $('ting-emoji').value.trim()){
    if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
    // Re-mark the kept emoji as user-chosen so the next name keeps it.
    $('ting-emoji').dispatchEvent(new Event('input',{bubbles:true}));
    if(typeof updateEmojiPreview === 'function')updateEmojiPreview();
  }else{
    if(typeof selectAddEmojiColor === 'function')selectAddEmojiColor('');
    if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
    if(typeof updateEmojiPreview === 'function')updateEmojiPreview();
  }
  $('ting-message').focus({preventScroll:true});
  return true;
}

function openBulkBatchReview(){
  renderBulkBatchReview();
  openSheet('bulk-batch-sheet');
}

// Renders the queued list plus validation context. Assumes the add sheet is
// open underneath and untouched.
function renderBulkBatchReview(){
  const rows = $('bulk-batch-rows');
  if(!rows)return;
  const count = bulkBatchItems.length;
  const title = $('bulk-batch-title');
  if(title)title.textContent = `review batch · ${count} item${count === 1 ? '' : 's'}`;
  const addBtn = $('bulk-batch-add');
  if(addBtn)addBtn.textContent = count ? `Add ${count} item${count === 1 ? '' : 's'}` : 'Add items';
  if(addBtn)addBtn.disabled = count === 0;
  const back = $('bulk-batch-back');
  if(back)back.textContent = count ? 'keep editing' : 'back';
  // An unfinished item with a name is never silently included or discarded.
  const offer = $('bulk-batch-offer');
  const pendingName = $('ting-message')?.value.trim() || '';
  if(offer){
    offer.hidden = !(pendingName && bulkUnfinishedChoice !== 'skip');
    const label = $('bulk-batch-offer-name');
    if(label)label.textContent = `“${pendingName.slice(0,60)}” is not in the batch yet.`;
  }
  // Whole-batch capacity against the existing MAX_TINGS limit.
  const error = $('bulk-batch-error');
  const capacity = typeof MAX_TINGS === 'number' ? MAX_TINGS : 300;
  let errorText = '';
  if(load().length + count > capacity)errorText = `${capacity} habits max — remove items or queue fewer.`;
  if(error){
    error.hidden = !errorText;
    error.textContent = errorText;
  }
  if(addBtn)addBtn.disabled = count === 0 || Boolean(errorText);
  // Duplicate names are allowed but flagged beside the affected item.
  const seen = {};
  for(const item of bulkBatchItems){
    const key = String(item.name || '').trim().toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
  }
  rows.innerHTML = bulkBatchItems.map((item,index)=>{
    const name = String(item.name || '').trim();
    const dup = name && seen[name.toLowerCase()] > 1;
    if(index === bulkDupIndex){
      return `<li class="bulk-batch-row bulk-batch-dup-row" data-bulk-row="${index}">
        <div class="bulk-batch-name-edit">
          <input type="text" id="bulk-batch-dup-name" maxlength="60" placeholder="name the copy" aria-label="name for the copied item" />
          <div class="btn-row">
            <button type="button" class="btn primary" data-bulk-dup-confirm="${index}">add copy</button>
            <button type="button" class="btn" data-bulk-dup-cancel>cancel</button>
          </div>
        </div>
      </li>`;
    }
    return `<li class="bulk-batch-row" data-bulk-row="${index}">
      <div class="bulk-batch-row-main">
        <span class="bulk-batch-row-emoji" aria-hidden="true">${escapeHtml(item.emoji || '•')}</span>
        <span class="bulk-batch-row-copy">
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(bulkSummaryFor(item))}</small>
          ${dup ? '<small class="bulk-batch-warn">same name as another item — kept anyway</small>' : ''}
        </span>
      </div>
      <div class="bulk-batch-row-actions">
        <button type="button" class="mini-text-btn" data-bulk-edit="${index}">edit</button>
        <button type="button" class="mini-text-btn" data-bulk-duplicate="${index}">duplicate</button>
        <button type="button" class="mini-text-btn" data-bulk-remove="${index}">remove</button>
      </div>
    </li>`;
  }).join('');
  if(bulkDupIndex != null){
    const input = $('bulk-batch-dup-name');
    if(input){
      input.value = `${String(bulkBatchItems[bulkDupIndex]?.name || '').trim()} copy`;
      input.focus({preventScroll:true});
      input.select();
    }
  }
}

function bulkRemoveQueued(index){
  if(index < 0 || index >= bulkBatchItems.length)return;
  bulkBatchItems.splice(index,1);
  if(bulkDupIndex === index)bulkDupIndex = null;
  else if(bulkDupIndex != null && bulkDupIndex > index)bulkDupIndex -= 1;
  updateBulkBatchChrome();
  renderBulkBatchReview();
}

function bulkStartDuplicate(index){
  bulkDupIndex = index;
  renderBulkBatchReview();
}

function bulkConfirmDuplicate(){
  if(bulkDupIndex == null)return;
  const source = bulkBatchItems[bulkDupIndex];
  const name = String($('bulk-batch-dup-name')?.value || '').trim();
  if(!name){$('bulk-batch-dup-name')?.focus();return;}
  if(name.length > 60){showToast('Names stop at 60 characters.');return;}
  const copy = bulkClone(source);
  copy.name = name;
  copy.createdAt = Date.now();
  bulkBatchItems.splice(bulkDupIndex + 1,0,copy);
  bulkDupIndex = null;
  updateBulkBatchChrome();
  renderBulkBatchReview();
}

function bulkCommitBatch(){
  const items = bulkBatchItems;
  if(!items.length)return;
  for(const item of items){
    if(!String(item.name || '').trim()){renderBulkBatchReview();return;}
  }
  const data = load();
  const capacity = typeof MAX_TINGS === 'number' ? MAX_TINGS : 300;
  if(data.length + items.length > capacity){
    renderBulkBatchReview();
    return;
  }
  data.push(...items);
  if(!save(data)){
    // Keep the drafts and the review so the user can retry.
    renderBulkBatchReview();
    showToast('could not save — try again');
    return;
  }
  const startIndex = data.length - items.length;
  const hids = load().slice(startIndex).map(h=>h.hid);
  const usesWeather = items.some(h=>h.weatherProfileMode !== 'none' || h.showWeather);
  showActionToast(`Added ${items.length} item${items.length === 1 ? '' : 's'}`,{type:'bulk-add',hids,openAction:false,undoLabel:'undo'});
  closeSheet('bulk-batch-sheet');
  exitBulkBatchMode();
  closeSheet('add-sheet');
  applyAddDefaults();
  render();
  if(usesWeather && typeof refreshWeatherForecast === 'function')void refreshWeatherForecast();
}

// ─────────────────────────────────────────────────────────────────────────
// Draft-edit context: the detail editor works on a queued record in memory.
// "Save to batch" writes only the in-memory draft — never localStorage.
// ─────────────────────────────────────────────────────────────────────────
function bulkDraftEditActive(){
  return Boolean(bulkDraftContext);
}

function beginBulkDraftEdit(record){
  if(!record || !String(record.name || '').trim())return false;
  bulkDraftContext = {record};
  if(!openDetailUnsavedCreate(record)){
    bulkDraftContext = null;
    return false;
  }
  getSheetInner('detail-sheet')?.classList.add('detail-batch-draft');
  $('detail-save').textContent = 'save to batch';
  return true;
}

function cancelBulkDraftEdit(){
  if(!bulkDraftContext)return;
  bulkDraftContext = null;
  getSheetInner('detail-sheet')?.classList.remove('detail-batch-draft');
  $('detail-save').textContent = 'save';
}

// Called from the #detail-save handler while a queued draft is open.
// Returns true when the draft path handled the click (including errors).
function bulkCommitQueuedDraft(){
  if(!bulkDraftContext)return false;
  const record = bulkDraftContext.record;
  if(record.appointment){
    // Series-level event editing, mirroring saveLocalAppointmentDetail's
    // series branch — without any persistence.
    if(!validateAppointmentFields('detail-appt'))return true;
    const name = $('detail-habit-message').value.trim();
    if(!name){$('detail-habit-message').focus();return true;}
    record.name = name.slice(0,60);
    record.emoji = cleanMark($('detail-emoji').value);
    record.emojiBgColor = selectedEmojiBgColor('detail-emoji-bg');
    record.links = normalizeLinks(currentDetailLinks());
    record.appointment = readAppointmentFields('detail-appt',record.appointment.exceptions);
    record.durationMinutes = Number($('detail-appt-duration').value);
    record.locationIds = $('detail-appt-place').value ? [$('detail-appt-place').value] : [];
    record.topics = selectedTopicsFrom('detail-topic-chips');
    const current = currentDetailTune();
    record.pinned = current.pinned;
    record.showOnSharedDisplay = current.showOnSharedDisplay !== false;
  }else{
    // Validation problems surface themselves (toast, validity, hint); false
    // means stay open so the user can fix the draft.
    if(!applyDetailTuneToRecord(record,load()))return true;
  }
  cancelBulkDraftEdit();
  closeDetail();
  renderBulkBatchReview();
  showToast('saved to batch');
  return true;
}

// Discard confirm for leaving the flow with queued work. Back, Escape,
// backdrop and cancel all route through cancelAdd, so they share this.
function bulkHandleCancelAdd(){
  if(!bulkBatchMode || !bulkBatchItems.length)return false;
  const confirm = $('add-batch-confirm');
  if(confirm && confirm.hidden){
    confirm.hidden = false;
    const label = $('add-batch-confirm-label');
    if(label)label.textContent = `Discard ${bulkBatchItems.length} queued item${bulkBatchItems.length === 1 ? '' : 's'}?`;
    confirm.scrollIntoView({block:'nearest'});
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Wiring.
// ─────────────────────────────────────────────────────────────────────────
$('add-batch-entry')?.addEventListener('click',openBulkBatchFlow);
$('do-batch-next')?.addEventListener('click',()=>{bulkQueueCurrent();});
$('add-batch-status')?.addEventListener('click',openBulkBatchReview);
$('add-batch-confirm-yes')?.addEventListener('click',()=>{
  if($('add-batch-confirm'))$('add-batch-confirm').hidden = true;
  exitBulkBatchMode();
  cancelAdd();
});
$('add-batch-confirm-no')?.addEventListener('click',()=>{
  if($('add-batch-confirm'))$('add-batch-confirm').hidden = true;
});
$('bulk-batch-close')?.addEventListener('click',()=>closeSheet('bulk-batch-sheet'));
$('bulk-batch-back')?.addEventListener('click',()=>closeSheet('bulk-batch-sheet'));
$('bulk-batch-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeSheet('bulk-batch-sheet');
});
$('bulk-batch-add')?.addEventListener('click',bulkCommitBatch);
$('bulk-batch-offer-add')?.addEventListener('click',()=>{
  if(bulkQueueCurrent())renderBulkBatchReview();
});
$('bulk-batch-offer-skip')?.addEventListener('click',()=>{
  bulkUnfinishedChoice = 'skip';
  renderBulkBatchReview();
});
$('bulk-batch-rows')?.addEventListener('click',e=>{
  const edit = e.target.closest('[data-bulk-edit]');
  if(edit){
    beginBulkDraftEdit(bulkBatchItems[Number(edit.dataset.bulkEdit)]);
    return;
  }
  const duplicate = e.target.closest('[data-bulk-duplicate]');
  if(duplicate){
    bulkStartDuplicate(Number(duplicate.dataset.bulkDuplicate));
    return;
  }
  const remove = e.target.closest('[data-bulk-remove]');
  if(remove){
    bulkRemoveQueued(Number(remove.dataset.bulkRemove));
    return;
  }
  const dupConfirm = e.target.closest('[data-bulk-dup-confirm]');
  if(dupConfirm){
    bulkConfirmDuplicate();
    return;
  }
  if(e.target.closest('[data-bulk-dup-cancel]')){
    bulkDupIndex = null;
    renderBulkBatchReview();
  }
});
// A typed emoji is "explicitly chosen": it survives the carry-forward reset.
$('ting-emoji')?.addEventListener('input',()=>{
  bulkEmojiChosen = Boolean($('ting-emoji').value.trim());
});
// A new name re-arms the unfinished-item offer.
$('ting-message')?.addEventListener('input',()=>{
  bulkUnfinishedChoice = null;
});
