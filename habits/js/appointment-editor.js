// A creation shortcut and a focused editor over the existing item/agenda model.
let addAppointmentMode=false;
function appointmentFields(prefix,a={repeat:'weekly',startDate:todayIso(),weekdays:[new Date().getDay()],startMinute:540,until:''}){
  return `<label class="planning-field">Repeats<select id="${prefix}-repeat" class="settings-select"><option value="once"${a.repeat==='once'?' selected':''}>Does not repeat</option><option value="weekly"${a.repeat==='weekly'?' selected':''}>Every week</option></select></label>
    <label class="planning-field">Starts on<input type="date" id="${prefix}-date" class="plan-date-input" value="${a.startDate}" required></label>
    <div id="${prefix}-weekly"><span class="settings-sublabel">Repeat on</span><div class="add-presets" role="group" aria-label="Repeat weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name,d)=>`<button type="button" data-appointment-day="${d}" aria-pressed="${a.weekdays.includes(d)}">${name}</button>`).join('')}</div>
    <label class="planning-field">Ends on <small>(optional)</small><input type="date" id="${prefix}-until" class="plan-date-input" value="${a.until}" min="${a.startDate}"></label></div>
    <label class="planning-field">Start time<input type="time" id="${prefix}-time" class="plan-time-input" value="${minutesToTimeInput(a.startMinute)}" required></label>`;
}
function wireAppointmentFields(host,prefix){
  const sync=()=>{$(`${prefix}-weekly`).hidden=$(`${prefix}-repeat`).value!=='weekly';};
  host.addEventListener('click',e=>{const day=e.target.closest('[data-appointment-day]');if(day){day.setAttribute('aria-pressed',String(day.getAttribute('aria-pressed')!=='true'));host.dispatchEvent(new Event('change',{bubbles:true}));}});
  $(`${prefix}-repeat`).addEventListener('change',sync);
  $(`${prefix}-date`).addEventListener('change',()=>{$(`${prefix}-until`).min=$(`${prefix}-date`).value;});
  sync();
}
function readAppointmentFields(prefix,exceptions={}){
  return normalizeAppointment({repeat:$(`${prefix}-repeat`).value,startDate:$(`${prefix}-date`).value,
    until:$(`${prefix}-repeat`).value==='weekly' ? $(`${prefix}-until`).value : '',
    startMinute:timeInputToMinutes($(`${prefix}-time`).value),
    weekdays:[...$(`${prefix}-weekly`).querySelectorAll('[aria-pressed="true"]')].map(el=>Number(el.dataset.appointmentDay)),exceptions});
}
function validateAppointmentFields(prefix){
  const fields=[$(`${prefix}-date`),$(`${prefix}-time`)];
  if($(`${prefix}-repeat`).value==='weekly')fields.push($(`${prefix}-until`));
  for(const field of fields)if(!field.checkValidity()){field.reportValidity();return false;}
  if(prefix==='add-appt' && !$('ting-duration').checkValidity()){$('ting-duration').reportValidity();return false;}
  if(!readAppointmentFields(prefix)){showToast('Choose a start date, time and at least one repeat day.');return false;}
  return true;
}
function resetAppointmentShortcut(){
  addAppointmentMode=false;
  $('add-appointment-fields').replaceChildren();
  syncAppointmentShortcut();
}
function syncAppointmentShortcut(){
  const active=addAppointmentMode;
  $('add-sheet').classList.toggle('appointment-add',active);
  $('add-appointment-fields').hidden=!active;
  $('add-appointment-shortcut').setAttribute('aria-pressed',String(active));
  $('ting-duration').required=active;
  if(!active)return;
  $('add-title').textContent='new meeting or class';$('do-save').textContent='add appointment';
  $('ting-message').placeholder='e.g. Biology class';$('add-duration-label').textContent='Duration';
  $('add-frequency').hidden=true;$('task-due-row').hidden=true;$('add-conditions').hidden=true;
  $('add-minimal-effort').hidden=false;
  document.querySelectorAll('#type-seg [data-v]').forEach(el=>{el.classList.remove('on');el.setAttribute('aria-pressed','false');});
}
$('add-appointment-shortcut').addEventListener('click',()=>{
  if(addAppointmentMode){addAppointmentMode=false;syncAddTypeUi(selectedType);syncAppointmentShortcut();return;}
  switchAddType('keepup');addAppointmentMode=true;
  const host=$('add-appointment-fields');host.innerHTML=appointmentFields('add-appt');wireAppointmentFields(host,'add-appt');
  $('ting-duration').value=60;
  syncAppointmentShortcut();
});
function applyAppointmentToAddRecord(record){
  if(!addAppointmentMode)return record;
  record.appointment=readAppointmentFields('add-appt');
  record.type=record.appointment?.repeat==='once'?'task':'keepup';
  record.repeatMode='routine';record.target=record.type==='keepup'?1:null;
  record.breakable=false;record.autoMarkMinutes=null;record.weatherProfileMode='none';record.weatherProfileId=null;
  record.earlyWindowDays=0;record.delayAllowanceDays=0;record.allowedTimeFixedStart=true;
  record.allowedTimeStart=record.appointment?.startMinute ?? null;record.allowedTimeEnd=null;
  record.allowedWeekdays=record.appointment?.weekdays || [];record.allowSharedDisplayCompletion=false;
  return record;
}
function nextAppointmentDate(h){
  const d=new Date(`${todayIso()}T12:00:00`);
  if(h.appointment.startDate>todayIso())return h.appointment.startDate;
  for(let i=0;i<370;i++){const key=dateKey(d.getTime()),o=appointmentOccurrence(h,key);if(o && o.end>Date.now())return key;d.setDate(d.getDate()+1);}
  return h.appointment.startDate;
}
function renderLocalAppointmentDetail(h){
  const sheet=getSheetInner('detail-sheet');
  $('detail-sheet').classList.toggle('local-appointment',isLocalAppointment(h));
  sheet.classList.toggle('local-appointment',isLocalAppointment(h));
  $('detail-appointment-editor')?.remove();
  $('detail-habit-message').disabled=false;
  for(const id of ['detail-link-field','detail-topic-chips','detail-shared-display','detail-pinned'])$(id).inert=false;
  for(const nav of ['calendar','effort'])sheet.querySelector(`[data-detail-nav="${nav}"]`).hidden=isLocalAppointment(h) || isMinimalMode();
  updateDetailPagerDots();
  if(!isLocalAppointment(h))return;
  const host=document.createElement('div');host.id='detail-appointment-editor';host.className='appointment-editor';
  host.innerHTML=`<p class="field-hint">Fixed time · Created in Tings. Other items are planned around this appointment.</p>
    <label class="planning-field">Change<select id="detail-appt-scope" class="settings-select"><option value="series">${h.appointment.repeat==='weekly'?'Every occurrence':'This appointment'}</option>${h.appointment.repeat==='weekly'?'<option value="date">Only one occurrence</option>':''}</select></label>
    <label class="planning-field" id="detail-appt-occurrence-row" hidden>Occurrence date<input type="date" id="detail-appt-occurrence" class="plan-date-input" value="${nextAppointmentDate(h)}"></label>
    <div id="detail-appt-rule">${appointmentFields('detail-appt',h.appointment)}</div>
    <label class="planning-field">Duration <span><input type="number" id="detail-appt-duration" class="mini-time-input" min="1" max="720" required value="${h.durationMinutes}"> min</span></label>
    <label class="planning-field" id="detail-appt-place-row">Place <small>(optional)</small><select id="detail-appt-place" class="settings-select"><option value="">No place</option>${(sortSettings.locations || []).map(loc=>`<option value="${escapeHtml(loc.id)}"${h.locationIds.includes(loc.id)?' selected':''}>${escapeHtml(loc.name)}</option>`).join('')}</select></label>
    <p class="field-hint" id="detail-appt-help">Name, appearance, links and schedule changes apply to every occurrence. Reminders are under actions.</p>
    <div id="detail-appt-date-actions" class="add-presets" hidden><button type="button" id="detail-appt-skip">Cancel this occurrence</button><button type="button" id="detail-appt-reset">Reset time & appearance</button></div>
    <p class="field-hint">Appointments leave the agenda after they end. Attendance is not recorded automatically.</p>`;
  sheet.querySelector('[data-detail-nav="schedule"]').prepend(host);wireAppointmentFields(host,'detail-appt');
  const paint=()=>{
    const one=$('detail-appt-scope').value==='date',key=$('detail-appt-occurrence').value;
    const patch=one ? h.appointment.exceptions[key] || {} : {};
    $('detail-appt-occurrence-row').hidden=!one;
    for(const id of ['detail-appt-repeat','detail-appt-date'])$(id).closest('label').hidden=one;
    $('detail-appt-weekly').hidden=one || $('detail-appt-repeat').value!=='weekly';
    $('detail-appt-date-actions').hidden=!one;
    $('detail-appt-time').value=minutesToTimeInput(patch.startMinute ?? h.appointment.startMinute);
    $('detail-appt-duration').value=patch.durationMinutes ?? h.durationMinutes;
    $('detail-emoji').value=patch.emoji ?? h.emoji;
    renderEmojiBgSwatches('detail-emoji-bg',patch.emojiBgColor ?? h.emojiBgColor);
    $('detail-habit-message').disabled=one;
    $('detail-appt-place-row').hidden=one;
    for(const id of ['detail-link-field','detail-topic-chips','detail-shared-display','detail-pinned'])$(id).inert=one;
    $('detail-appt-help').textContent=one ? `${patch.cancelled?'This occurrence is cancelled. ':''}Time, duration and appearance changes apply only to this date. Name and links belong to the series.` : 'Name, appearance, links and schedule changes apply to every occurrence. Existing date overrides are kept. Reminders are under actions.';
    if(window.TingsNative?.isNative){
      const section=$('detail-native-reminders');
      if(section){
        section.replaceChildren();const title=document.createElement('summary');title.textContent='phone notifications & alarms';section.append(title);
        if(!one || appointmentOccursOn(h,key)){
          section.append(nativeItemReminderControls(`item:${h.hid}`,h.name,{meeting:true,hideMissed:true,dayKey:one?key:null}));
          if(one){const reset=document.createElement('button');reset.type='button';reset.className='mini-text-btn';reset.textContent='Use series reminders for this date';
            reset.addEventListener('click',async()=>{await nativeResetReminderDate(`item:${h.hid}`,key);paint();showToast('Series reminders restored.');});section.append(reset);}
        }else{const hint=document.createElement('p');hint.className='field-hint';hint.textContent='Choose a date in this repeating schedule to change its reminders.';section.append(hint);}
      }
    }
  };
  $('detail-appt-scope').addEventListener('change',paint);$('detail-appt-occurrence').addEventListener('change',paint);
  host.addEventListener('input',()=>setDetailDirty(true));host.addEventListener('change',()=>setDetailDirty(true));
  const changeException=reset=>{
    const key=$('detail-appt-occurrence').value;
    if(!appointmentOccursOn(h,key)){showToast('Choose a date in this repeating schedule.');return;}
    const data=load(),item=data[detailIdx];
    if(reset)delete item.appointment.exceptions[key];else item.appointment.exceptions[key]={...item.appointment.exceptions[key],cancelled:true};
    if(save(data)){openDetail(detailIdx);render();showToast(reset?'Occurrence restored.':'Occurrence cancelled.');}
  };
  $('detail-appt-skip').addEventListener('click',()=>changeException(false));$('detail-appt-reset').addEventListener('click',()=>changeException(true));
  paint();
}
function saveLocalAppointmentDetail(data,h){
  const one=$('detail-appt-scope').value==='date',duration=$('detail-appt-duration');
  if(!duration.checkValidity()){duration.reportValidity();return;}
  const emoji=cleanMark($('detail-emoji').value),emojiBgColor=selectedEmojiBgColor('detail-emoji-bg');
  if(one){
    const key=$('detail-appt-occurrence').value,minute=timeInputToMinutes($('detail-appt-time').value);
    if(!appointmentOccursOn(h,key) || minute==null){showToast('Choose an occurrence date and start time.');return;}
    const patch={...h.appointment.exceptions[key]};
    for(const [field,value,base] of [['startMinute',minute,h.appointment.startMinute],['durationMinutes',Number(duration.value),h.durationMinutes],['emoji',emoji,h.emoji],['emojiBgColor',emojiBgColor,h.emojiBgColor]]){
      if(value===base)delete patch[field];else patch[field]=value;
    }
    if(Object.keys(patch).length)h.appointment.exceptions[key]=patch;else delete h.appointment.exceptions[key];
  }else{
    if(!validateAppointmentFields('detail-appt'))return;
    const name=$('detail-habit-message').value.trim();if(!name){$('detail-habit-message').focus();return;}
    h.name=name.slice(0,60);h.emoji=emoji;h.emojiBgColor=emojiBgColor;h.links=normalizeLinks(currentDetailLinks());
    h.appointment=readAppointmentFields('detail-appt',h.appointment.exceptions);h.durationMinutes=Number(duration.value);
    h.locationIds=$('detail-appt-place').value ? [$('detail-appt-place').value] : [];h.topics=selectedTopicsFrom('detail-topic-chips');
    const current=currentDetailTune();h.pinned=current.pinned;h.showOnSharedDisplay=current.showOnSharedDisplay;h.allowSharedDisplayCompletion=current.allowSharedDisplayCompletion;
  }
  if(save(data)){closeDetail();render();showToast(one?'Occurrence saved.':'Appointment saved.');}
}
