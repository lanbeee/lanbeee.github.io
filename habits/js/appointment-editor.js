// Event controls over the existing item/agenda model.
let addAppointmentMode=false;
function appointmentFields(prefix,a={repeat:'once',startDate:todayIso(),weekdays:[new Date().getDay()],startMinute:540,until:''}){
  return `<label class="planning-field">repeats<select id="${prefix}-repeat" class="settings-select"><option value="once"${a.repeat==='once'?' selected':''}>once</option><option value="weekly"${a.repeat==='weekly'?' selected':''}>every week</option></select></label>
    <label class="planning-field">starts<input type="date" id="${prefix}-date" class="plan-date-input" value="${a.startDate}" required></label>
    <div id="${prefix}-weekly"><span class="settings-sublabel">on these days</span><div class="schedule-chip-row" role="group" aria-label="Repeat weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name,d)=>`<button type="button" class="schedule-chip${a.weekdays.includes(d)?' on':''}" data-appointment-day="${d}" aria-pressed="${a.weekdays.includes(d)}">${name}</button>`).join('')}</div>
    <label class="planning-field"><span>until <small>(optional)</small></span><input type="date" id="${prefix}-until" class="plan-date-input" value="${a.until}" min="${a.startDate}"></label></div>
    <label class="planning-field">starts at<input type="time" id="${prefix}-time" class="plan-time-input" value="${minutesToTimeInput(a.startMinute)}" required></label>`;
}
function wireAppointmentFields(host,prefix){
  const sync=()=>{$(`${prefix}-weekly`).hidden=$(`${prefix}-repeat`).value!=='weekly';};
  host.addEventListener('click',e=>{const day=e.target.closest('[data-appointment-day]');if(day){const on=day.getAttribute('aria-pressed')!=='true';day.setAttribute('aria-pressed',String(on));day.classList.toggle('on',on);host.dispatchEvent(new Event('change',{bubbles:true}));}});
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
  if(!readAppointmentFields(prefix)){showToast('choose a date, time and at least one day');return false;}
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
  document.querySelectorAll('#type-seg [data-v]').forEach(el=>{const on=el.dataset.v===(active?'event':selectedType==='task'?'task':'keepup');el.classList.toggle('on',on);el.setAttribute('aria-pressed',String(on));});
  $('ting-duration').required=active;
  if(!active)return;
  const host=$('add-appointment-fields');
  if(!host.children.length){host.innerHTML=appointmentFields('add-appt')+eventHelpHtml('add-event-help');wireAppointmentFields(host,'add-appt');}
  $('add-title').textContent='new event';$('do-save').textContent='add event';
  document.querySelector('label[for="ting-message"]').textContent='What’s it called?';
  $('ting-message').placeholder='e.g. Biology class';$('add-duration-label').textContent='how long';
  $('add-frequency').hidden=true;$('task-due-row').hidden=true;$('add-conditions').hidden=true;
  $('add-minimal-effort').hidden=false;
}
function eventHelpHtml(id){
  return uiSettingsHelpHtml({id,title:'Other plans fit around this. It leaves the agenda when it ends.',labelClass:'field-hint',body:'<p>Events reserve their time. Tings does not record attendance. Set notifications or alarms under actions in the Android app.</p>'});
}
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
  if(h.appointment.startDate>todayIso())d.setTime(new Date(`${h.appointment.startDate}T12:00:00`).getTime());
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
  for(const nav of ['calendar','effort'])sheet.querySelector(`[data-detail-nav="${nav}"]`).hidden=isEventItem(h) || isMinimalMode();
  updateDetailPagerDots();
  if(!isLocalAppointment(h))return;
  const host=document.createElement('div');host.id='detail-appointment-editor';host.className='appointment-editor';
  host.innerHTML=`
    <label class="planning-field"${h.appointment.repeat==='once'?' hidden':''}>edit<select id="detail-appt-scope" class="settings-select"><option value="series">${h.appointment.repeat==='weekly'?'all dates':'this date'}</option>${h.appointment.repeat==='weekly'?'<option value="date">this date</option>':''}</select></label>
    <label class="planning-field" id="detail-appt-occurrence-row" hidden>date<input type="date" id="detail-appt-occurrence" class="plan-date-input" value="${nextAppointmentDate(h)}"></label>
    <div id="detail-appt-rule">${appointmentFields('detail-appt',h.appointment)}</div>
    <label class="planning-field">how long <span><input type="number" id="detail-appt-duration" class="mini-time-input" min="1" max="720" required value="${h.durationMinutes}"> min</span></label>
    <label class="planning-field" id="detail-appt-place-row"><span>place <small>(optional)</small></span><select id="detail-appt-place" class="settings-select"><option value="">no place</option>${(sortSettings.locations || []).map(loc=>`<option value="${escapeHtml(loc.id)}"${h.locationIds.includes(loc.id)?' selected':''}>${escapeHtml(loc.name)}</option>`).join('')}</select></label>
    <p class="field-hint" id="detail-appt-help"></p>
    <div id="detail-appt-date-actions" class="add-presets" hidden><button type="button" id="detail-appt-skip">cancel this date</button><button type="button" id="detail-appt-reset">use the usual time and icon</button></div>
    ${eventHelpHtml('detail-event-help')}`;
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
    $('detail-appt-help').textContent=one ? (patch.cancelled?'This date is cancelled.':'Time and icon changes apply to this date.') : Object.keys(h.appointment.exceptions).length ? 'Dates you changed individually keep their changes.' : '';
    $('detail-appt-help').hidden=!$('detail-appt-help').textContent;
    $('detail-appt-skip').textContent=patch.cancelled?'restore this date':'cancel this date';
    if(window.TingsNative?.isNative){
      const section=$('detail-native-reminders');
      if(section){
        section.replaceChildren();const title=document.createElement('summary');title.textContent='phone notifications & alarms';section.append(title);
        if(!one || appointmentOccursOn(h,key)){
          section.append(nativeItemReminderControls(`item:${h.hid}`,h.name,{meeting:true,hideMissed:true,dayKey:one?key:null}));
          if(one){const reset=document.createElement('button');reset.type='button';reset.className='mini-text-btn';reset.textContent='use the usual reminders for this date';
            reset.addEventListener('click',async()=>{await nativeResetReminderDate(`item:${h.hid}`,key);paint();showToast('reminders reset');});section.append(reset);}
        }else{const hint=document.createElement('p');hint.className='field-hint';hint.textContent='Choose a date in this schedule.';section.append(hint);}
      }
    }
  };
  $('detail-appt-scope').addEventListener('change',paint);$('detail-appt-occurrence').addEventListener('change',paint);
  host.addEventListener('input',()=>setDetailDirty(true));host.addEventListener('change',()=>setDetailDirty(true));
  const changeException=reset=>{
    const key=$('detail-appt-occurrence').value;
    if(!appointmentOccursOn(h,key)){showToast('choose a date in this schedule');return;}
    const data=load(),item=data[detailIdx],patch={...item.appointment.exceptions[key]};
    if(reset){for(const field of ['startMinute','durationMinutes','emoji','emojiBgColor'])delete patch[field];}
    else if(patch.cancelled)delete patch.cancelled;else patch.cancelled=true;
    if(Object.keys(patch).length)item.appointment.exceptions[key]=patch;else delete item.appointment.exceptions[key];
    if(save(data)){
      openDetail(detailIdx);
      $('detail-appt-scope').value='date';$('detail-appt-occurrence').value=key;
      $('detail-appt-scope').dispatchEvent(new Event('change'));
      setDetailDirty(false);render();showToast(reset?'time and icon reset':patch.cancelled?'date cancelled':'date restored');
    }
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
    if(!appointmentOccursOn(h,key) || minute==null){showToast('choose a date and start time');return;}
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
    const current=currentDetailTune();h.pinned=current.pinned;h.showOnSharedDisplay=current.showOnSharedDisplay;h.allowSharedDisplayCompletion=false;
  }
  if(save(data)){refreshDetailView();render();showToast('event saved');}
}

function renderEventDetailUi(h){
  const event=isEventItem(h),synced=isDeviceCalendarTask(h),sheet=getSheetInner('detail-sheet');
  for(const el of [sheet,$('detail-sheet')]){el.classList.toggle('event-detail',event);el.classList.toggle('phone-calendar-detail',synced);}
  for(const nav of ['calendar','effort'])sheet.querySelector(`[data-detail-nav="${nav}"]`).hidden=event || isMinimalMode();
  $('detail-mark').setAttribute('aria-label',event ? `edit icon for ${h.name}` : `add entry for ${h.name}`);
  $('detail-mark-log').hidden=event;
  const completion=$('detail-shared-display').querySelector('[data-shared-display-mode="complete"]');
  completion.hidden=event;completion.disabled=event;
  if(event && sharedDisplayModeForHabit(h)==='complete')setDetailSharedDisplayMode('view');
  $('detail-delete-question').textContent=`Remove this ${event?'event':h.type==='task'?'task':'habit'}?`;
  $('detail-name-disclosure').querySelector('summary').textContent=event?'name':'name & type';
  $('detail-priority-disclosure').querySelector('summary').textContent=event?'topics':'priority & topics';
  $('detail-emoji').setAttribute('aria-label',event?'event emoji, optional':'habit emoji, optional');
  updateDetailPagerDots();
}
