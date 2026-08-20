function sortSampleCount(){
  return load().filter(h=>h.sample).length;
}

// PURE: prayer demo samples use stable hids
function isPrayerSample(h){
  return Boolean(h && h.sample && String(h.hid || '').startsWith('sample-prayer-'));
}
function isFeatureSample(h){
  return Boolean(h && h.sample && !String(h.hid || '').startsWith('sample-prayer-'));
}

// RENDER: update sample count label + remove button on sample sheet
function updateSortSampleCount(){
  const n = sortSampleCount();
  const label = $('sort-sample-count');
  if(label)label.textContent = n
    ? `${n} tagged sample${n === 1 ? '' : 's'} on home · remove drops the rest`
    : 'No tagged samples on home.';
  const btn = $('remove-sort-samples');
  if(btn)btn.disabled = n === 0;
}

// PURE: display name without Sample: prefix
function sampleDisplayName(h){
  if(!h || typeof h.name !== 'string')return '';
  return h.name.startsWith('Sample: ') ? h.name.slice('Sample: '.length) : h.name;
}

// PURE: whether a catalog sample is already on home (by hid, or legacy name match)
function sampleAlreadyOnHome(hid, displayName){
  const data = load();
  if(hid && data.some(h => h.hid === hid))return true;
  if(displayName){
    const full = `Sample: ${displayName}`;
    if(data.some(h => h.name === full || h.name === displayName))return true;
  }
  return false;
}

// PURE: blurbs for feature-tour rows (keys match buildSortSamples hids)
function featureSamplePreviews(){
  return [
    {hid:'sample-feature-stretch', emoji:'🌅', title:'stretch after sunrise', blurb:'Window from sunrise +10m', place:''},
    {hid:'sample-feature-night-work', emoji:'🌙', title:'night deep work', blurb:'Evening window after Isha', place:'Home'},
    {hid:'sample-feature-report', emoji:'📝', title:'write report in chunks', blurb:'Breakable — split across sessions', place:'Home'},
    {hid:'sample-feature-timed-run', emoji:'🏃', title:'timed run', blurb:'Timer + session progress bar', place:'Park'},
    {hid:'sample-feature-dentist', emoji:'🦷', title:'dentist (auto)', blurb:'Timed task that auto-completes', place:''},
    {hid:'sample-feature-weigh-in', emoji:'⚖️', title:'weigh-in', blurb:'Log a number with each entry', place:'Home'},
    {hid:'sample-feature-park-walk', emoji:'🌳', title:'walk to the park', blurb:'Place + travel on today’s list', place:'Park'},
    {hid:'sample-feature-do-early', emoji:'🧺', title:'do early because Tuesday is packed', blurb:'Do it early while the week is open', place:'Home'},
    {hid:'sample-feature-gym', emoji:'💪', title:'gym session', blurb:'Place-gated workout', place:'Gym'},
    {hid:'sample-feature-stretch-gym', emoji:'🤸', title:'stretch at gym or home', blurb:'Multi-place habit', place:'Gym · Home'},
    {hid:'sample-feature-family', emoji:'☎️', title:'call family', blurb:'Home or Mom’s', place:'Home · Mom’s'},
    {hid:'sample-feature-coffee', emoji:'☕', title:'coffee on office days', blurb:'Limit · Office or Cafe', place:'Office · Cafe'},
    {hid:'sample-feature-water', emoji:'💧', title:'drink water', blurb:'Simple daily habit', place:''},
    {hid:'sample-feature-snacks', emoji:'🍪', title:'less late snacks', blurb:'Limit how often', place:'Home'},
    {hid:'sample-feature-soda', emoji:'🥤', title:'quit soda', blurb:'Stop habit', place:''}
  ];
}

// PURE: prayer preview rows
function prayerSamplePreviews(){
  const label = (key)=>{
    if(typeof PRAYER_ANCHOR_LABELS !== 'undefined' && PRAYER_ANCHOR_LABELS[key]){
      return String(PRAYER_ANCHOR_LABELS[key]).replace(/\s*\([^)]*\)\s*$/,'').trim();
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };
  return [
    {key:'fajr', emoji:'🌅', tint:'indigo', blurb:'Until sunrise −10m'},
    {key:'dhuhr', emoji:'☀️', tint:'amber', blurb:'Until Asr −15m'},
    {key:'asr', emoji:'🌤️', tint:'cyan', blurb:'Until Maghrib −15m'},
    {key:'maghrib', emoji:'🌇', tint:'orange', blurb:'Until sunset +1h or Isha −15m'},
    {key:'isha', emoji:'🌙', tint:'purple', blurb:'Until next Fajr −30m'}
  ].map(row=>({
    hid:`sample-prayer-${row.key}`,
    emoji:row.emoji,
    emojiBgColor:row.tint,
    title:label(row.key),
    blurb:row.blurb,
    place:''
  }));
}

// RENDER: one sample row with per-item add. `onHome` overrides the default
// habits-only check (busy-time samples are "added" when the block is on the
// schedule, not when a habit exists).
function renderSampleHabitRow(row, onHome){
  const added = onHome != null ? onHome : sampleAlreadyOnHome(row.hid, row.title);
  return `
    <div class="sample-habit-row${added ? ' is-on-home' : ''}" data-sample-hid="${escapeHtml(row.hid)}">
      <span class="sample-habit-emoji${row.emojiBgColor ? ' tinted' : ''}" aria-hidden="true"${row.emojiBgColor ? ` style="--sample-tint-bg:var(--${escapeHtml(row.emojiBgColor)}-bg);--sample-tint-icon:var(--${escapeHtml(row.emojiBgColor)}-icon);"` : ''}>${row.emoji}</span>
      <div class="sample-habit-copy">
        <b>${escapeHtml(row.title)}</b>
        <small>${escapeHtml(row.blurb)}${row.place ? ` · ${escapeHtml(row.place)}` : ''}</small>
      </div>
      <button type="button" class="btn sample-habit-add" data-add-sample="${escapeHtml(row.hid)}"${added ? ' disabled' : ''}>
        ${added ? 'added' : 'add'}
      </button>
    </div>
  `;
}

// RENDER: fill sample-habits sheet feature list
function renderSampleHabitsPreview(){
  const host = $('sample-habits-preview');
  if(!host)return;
  host.innerHTML = featureSamplePreviews().map(row => renderSampleHabitRow(row)).join('');
}

// RENDER: fill daily prayers list on sample sheet
function renderPrayerSamplesPreview(){
  const host = $('sample-prayers-preview');
  if(!host)return;
  host.innerHTML = prayerSamplePreviews().map(row => renderSampleHabitRow(row)).join('');
}

// ── Sample busy times ─────────────────────────────────────────────────────
// The demo sleep block is a Settings busy time (not a habit): it replaces the
// default fixed 11pm–5am sleep with a sun-based window — start at the later of
// Isha +15m and 8h before the next sunrise, end 40m before sunrise. Anchors
// resolve against the home city (no place needed), same as the prayers.

// PURE: the dynamic sleep block the sample installs.
function buildSampleSleepBlock(){
  return {
    label:'sleep',
    days:[0,1,2,3,4,5,6],
    start:1380, end:300,           // fixed fallback while no city/place is set
    startAnchor:'isha', startOffsetMin:15,
    startCombine:'later',
    startAnchor2:'sunrise', startOffsetMin2:-480, startDayOffset2:1,
    endAnchor:'sunrise', endOffsetMin:-40
  };
}

// PURE: busy-time preview rows (keys match buildSampleSleepBlock)
function blockSamplePreviews(){
  return [
    {
      hid:'sample-block-sleep',
      emoji:'😴',
      emojiBgColor:'slate',
      title:'sleep',
      blurb:'Later of Isha +15m · next sunrise −8h, until sunrise −40m',
      place:''
    }
  ];
}

// PURE: true when the sun-based sleep block is already on the schedule
// (a 'sleep' block with any prayer anchor).
function sampleSleepBlockAdded(){
  const blocks = typeof normalizeBlockedTimes === 'function'
    ? normalizeBlockedTimes(sortSettings && sortSettings.blockedTimes)
    : (Array.isArray(sortSettings && sortSettings.blockedTimes) ? sortSettings.blockedTimes : []);
  return blocks.some(b =>
    String(b.label || '').toLowerCase() === 'sleep'
    && (cleanPrayerAnchor(b.startAnchor) || cleanPrayerAnchor(b.endAnchor))
  );
}

// RENDER: fill sample busy-time list on sample sheet
function renderBlockSamplesPreview(){
  const host = $('sample-blocks-preview');
  if(!host)return;
  host.innerHTML = blockSamplePreviews().map(row => renderSampleHabitRow(row, sampleSleepBlockAdded())).join('');
}

// HANDLER: install the sun-based sleep busy time (home city required first).
// Replaces the existing 'sleep' block (usually the default fixed one) so the
// schedule never ends up with two overlapping sleep spans.
function addBlockSample(){
  if(!ensureHomeCityForDynamicSamples())return false;
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  const idx = blocks.findIndex(b => String(b.label || '').toLowerCase() === 'sleep');
  const next = blocks.slice();
  const sampleBlock = buildSampleSleepBlock();
  if(idx >= 0)next[idx] = sampleBlock;
  else next.push(sampleBlock);
  updateSortSetting({blockedTimes:normalizeBlockedTimes(next)},{renderNow:false});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  renderBlockedTimeControls();
  renderBlockSamplesPreview();
  if(typeof render === 'function')render();
  if(typeof showToast === 'function')showToast('added · sun-based sleep busy time');
  return true;
}

// RENDER: refresh the preview lists on the sample sheet
function refreshSampleHabitsSheet(){
  renderSampleHabitsPreview();
  renderPrayerSamplesPreview();
  renderBlockSamplesPreview();
}

// HYBRID: open sample habits sheet from About
function openSampleHabitsSheet(){
  refreshSampleHabitsSheet();
  updateSortSampleCount();
  const prayersBody = $('sample-prayers-body');
  const prayersHead = $('sample-prayers-head');
  if(prayersBody)prayersBody.hidden = true;
  if(prayersHead)prayersHead.setAttribute('aria-expanded','false');
  closeSheet('about-sheet');
  openSheet('sample-habits-sheet');
}

// PURE: build a sample habit object
function sortSampleHabit(name,type,target,logs,options = {}){
  const locationIds = Array.isArray(options.locationIds) ? options.locationIds.map(cleanLocationId).filter(Boolean) : [];
  const raw = {
    name:`Sample: ${name}`,
    type,
    target:(type === 'zero' || type === 'task') ? null : target,
    dueDate:type === 'task' ? (options.dueDate ?? null) : null,
    hardDue:type === 'task' ? Boolean(options.hardDue) : false,
    eventTime:type === 'task' ? (options.eventTime ?? null) : null,
    planByDate:(type === 'keepup' || type === 'reduce') ? (options.planByDate ?? null) : null,
    createdAt:options.createdAt || Date.now(),
    logs,
    emoji:options.emoji || '',
    emojiBgColor:normalizeEmojiBgColor(options.emojiBgColor),
    pinned:Boolean(options.pinned),
    sample:true,
    snoozedUntil:options.snoozedUntil || null,
    topics:normalizeTopics(options.topics),
    locationIds,
    preferredLocationId:normalizePreferredLocation(options.preferredLocationId,locationIds),
    allowedWeekdays:normalizeAllowedWeekdays(options.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(options.allowedMonthDays),
    preferredWeekdays:normalizeAllowedWeekdays(options.preferredWeekdays),
    preferredMonthDays:normalizeAllowedMonthDays(options.preferredMonthDays),
    allowedTimeStart:normalizeTimeMinutes(options.allowedTimeStart),
    allowedTimeEnd:normalizeTimeMinutes(options.allowedTimeEnd),
    preferredTimeStart:normalizeTimeMinutes(options.preferredTimeStart),
    preferredTimeEnd:normalizeTimeMinutes(options.preferredTimeEnd),
    allowedTimeStartAnchor:options.allowedTimeStartAnchor ?? null,
    allowedTimeStartOffsetMin:options.allowedTimeStartOffsetMin ?? 0,
    allowedTimeEndAnchor:options.allowedTimeEndAnchor ?? null,
    allowedTimeEndOffsetMin:options.allowedTimeEndOffsetMin ?? 0,
    allowedTimeStartDayOffset:options.allowedTimeStartDayOffset ?? 0,
    allowedTimeEndDayOffset:options.allowedTimeEndDayOffset ?? 0,
    allowedTimeStartCombine:options.allowedTimeStartCombine ?? null,
    allowedTimeStartAnchor2:options.allowedTimeStartAnchor2 ?? null,
    allowedTimeStartOffsetMin2:options.allowedTimeStartOffsetMin2 ?? 0,
    allowedTimeStartDayOffset2:options.allowedTimeStartDayOffset2 ?? 0,
    allowedTimeEndCombine:options.allowedTimeEndCombine ?? null,
    allowedTimeEndAnchor2:options.allowedTimeEndAnchor2 ?? null,
    allowedTimeEndOffsetMin2:options.allowedTimeEndOffsetMin2 ?? 0,
    allowedTimeEndDayOffset2:options.allowedTimeEndDayOffset2 ?? 0,
    preferredTimeStartCombine:options.preferredTimeStartCombine ?? null,
    preferredTimeStartAnchor2:options.preferredTimeStartAnchor2 ?? null,
    preferredTimeStartOffsetMin2:options.preferredTimeStartOffsetMin2 ?? 0,
    preferredTimeStartDayOffset2:options.preferredTimeStartDayOffset2 ?? 0,
    preferredTimeEndCombine:options.preferredTimeEndCombine ?? null,
    preferredTimeEndAnchor2:options.preferredTimeEndAnchor2 ?? null,
    preferredTimeEndOffsetMin2:options.preferredTimeEndOffsetMin2 ?? 0,
    preferredTimeEndDayOffset2:options.preferredTimeEndDayOffset2 ?? 0,
    flexibilityDays:clampFlexibility(options.flexibilityDays),
    durationMinutes:clampDuration(options.durationMinutes),
    breakable:Boolean(options.breakable),
    minChunkMinutes:options.minChunkMinutes != null ? clampMinChunk(options.minChunkMinutes) : undefined,
    autoMarkMinutes:options.autoMarkMinutes != null ? normalizeAutoMark(options.autoMarkMinutes) : null,
    timerAutoStopMinutes:options.timerAutoStopMinutes != null ? normalizeTimerAutoStop(options.timerAutoStopMinutes) : null,
    trackValue:Boolean(options.trackValue),
    priority:options.priority != null ? clampPriority(options.priority) : undefined,
    hid:options.hid || undefined
  };
  return raw;
}

// PURE: NYC-area sample places — close enough that travel is visible but short.
// Stable ids so re-adding samples doesn't orphan habit references.
function buildSampleLocations(){
  return [
    {
      id:'sample-home', name:'Sample Home', address:'West Village, NYC',
      lat:40.7359, lng:-74.0036, radiusM:100,
      emoji:'🏠'
    },
    {
      id:'sample-office', name:'Sample Office', address:'Midtown, NYC',
      lat:40.7549, lng:-73.9840, radiusM:80,
      emoji:'🏢',
      allowedTimeStart:540, allowedTimeEnd:1080, // 9a–6p
      closedDays:[0,6]
    },
    {
      id:'sample-gym', name:'Sample Gym', address:'Chelsea, NYC',
      lat:40.7465, lng:-73.9972, radiusM:75,
      emoji:'🏋️',
      allowedTimeStart:360, allowedTimeEnd:1320, // 6a–10p
      closedDays:[0],
      preferredTimeStart:420, preferredTimeEnd:540 // best early
    },
    {
      id:'sample-cafe', name:'Sample Cafe', address:'East Village, NYC',
      lat:40.7265, lng:-73.9815, radiusM:60,
      emoji:'☕',
      allowedTimeStart:480, allowedTimeEnd:1020, // 8a–5p
      preferredTimeStart:840, preferredTimeEnd:960, // 2–4p off-peak
      hoursByDay:{6:{start:540,end:900}} // Sat 9a–3p
    },
    {
      id:'sample-moms', name:"Sample Mom's house", address:'Park Slope, Brooklyn',
      lat:40.6701, lng:-73.9778, radiusM:90,
      emoji:'🏡',
      allowedTimeStart:660, allowedTimeEnd:1020 // 11a–5p
    },
    {
      // 24h second anchor so travel between places is visible even late at night.
      id:'sample-park', name:'Sample Park', address:'Washington Square Park, NYC',
      lat:40.7308, lng:-73.9973, radiusM:120,
      emoji:'🌳'
    }
  ];
}

// PURE: curated feature-tour samples (no five daily prayers)
function buildSortSamples(){
  const H = 'sample-home';
  const O = 'sample-office';
  const G = 'sample-gym';
  const C = 'sample-cafe';
  const M = 'sample-moms';
  const P = 'sample-park';
  return [
    sortSampleHabit('stretch after sunrise','keepup',1,[],{
      emoji:'🌅', topics:['health'], durationMinutes:15, pinned:true, priority:1,
      hid:'sample-feature-stretch',
      allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:10,
      allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:40
    }),
    sortSampleHabit('night deep work','keepup',1,[],{
      emoji:'🌙', topics:['focus'], durationMinutes:45, priority:2,
      hid:'sample-feature-night-work',
      allowedTimeStartAnchor:'isha', allowedTimeStartOffsetMin:15,
      allowedTimeEndAnchor:'isha', allowedTimeEndOffsetMin:150,
      locationIds:[H]
    }),
    sortSampleHabit('write report in chunks','task',null,[],{
      emoji:'📝', topics:['work'], durationMinutes:90, minChunkMinutes:20,
      hid:'sample-feature-report',
      breakable:true, dueDate:sampleActual(0), priority:1, locationIds:[H]
    }),
    sortSampleHabit('timed run','keepup',2,sampleLogs([5,3]),{
      emoji:'🏃', topics:['health'], durationMinutes:30, timerAutoStopMinutes:30,
      hid:'sample-feature-timed-run',
      locationIds:[P], preferredLocationId:P, priority:1
    }),
    sortSampleHabit('dentist (auto)','task',null,[],{
      emoji:'🦷', topics:['health'], durationMinutes:45,
      hid:'sample-feature-dentist',
      eventTime:Date.now() + 3 * 3600000, dueDate:dayStart(Date.now()),
      autoMarkMinutes:45, priority:0
    }),
    sortSampleHabit('weigh-in','keepup',7,sampleLogs([14,7]),{
      emoji:'⚖️', topics:['health'], durationMinutes:5, trackValue:true,
      hid:'sample-feature-weigh-in', locationIds:[H]
    }),
    sortSampleHabit('walk to the park','task',null,[],{
      emoji:'🌳', topics:['health','rest'], durationMinutes:20,
      hid:'sample-feature-park-walk',
      dueDate:sampleActual(0), locationIds:[H,P], preferredLocationId:P, priority:0, pinned:true
    }),
    sortSampleHabit('do early because Tuesday is packed','keepup',2,sampleLogs([0]),{
      emoji:'🧺', topics:['home'], durationMinutes:50, flexibilityDays:2,
      hid:'sample-feature-do-early', locationIds:[H], priority:2
    }),
    sortSampleHabit('gym session','keepup',2,sampleLogs([5,3]),{
      emoji:'💪', topics:['health'], durationMinutes:35,
      hid:'sample-feature-gym', locationIds:[G], priority:1
    }),
    sortSampleHabit('stretch at gym or home','keepup',7,sampleLogs([32,20,11,5,1]),{
      emoji:'🤸', topics:['health'], durationMinutes:15,
      hid:'sample-feature-stretch-gym',
      locationIds:[G,H], preferredLocationId:G
    }),
    sortSampleHabit('call family','keepup',7,sampleLogs([34,21,14,6]),{
      emoji:'☎️', topics:['relationships'], durationMinutes:20,
      hid:'sample-feature-family',
      locationIds:[H,M], preferredLocationId:M, priority:1
    }),
    sortSampleHabit('coffee on office days','reduce',2,sampleLogs([6,4,2]),{
      emoji:'☕', topics:['health'], durationMinutes:5,
      hid:'sample-feature-coffee',
      allowedWeekdays:[1,3], locationIds:[O,C], preferredLocationId:O
    }),
    sortSampleHabit('drink water','keepup',1,sampleLogs([2,1]),{
      emoji:'💧', topics:['health'], durationMinutes:2, pinned:true,
      hid:'sample-feature-water'
    }),
    sortSampleHabit('less late snacks','reduce',5,sampleLogs([9,6,3]),{
      emoji:'🍪', topics:['food'], hid:'sample-feature-snacks', locationIds:[H]
    }),
    sortSampleHabit('quit soda','zero',null,sampleLogs([35,18]),{
      emoji:'🥤', topics:['health'], hid:'sample-feature-soda'
    })
  ];
}

// PURE: five daily prayer demos (optional pack). No sample places — windows
// resolve from Settings home city (homeCityLat/Lng). Always use Islamic names
// (Fajr–Isha), independent of Settings prayerIslamicNames.
function buildPrayerSamples(){
  const label = (key)=>{
    if(typeof PRAYER_ANCHOR_LABELS !== 'undefined' && PRAYER_ANCHOR_LABELS[key]){
      // Drop parentheticals like "Maghrib (sunset)" for habit titles
      return String(PRAYER_ANCHOR_LABELS[key]).replace(/\s*\([^)]*\)\s*$/,'').trim();
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };
  const rows = [
    // Start at the prayer's own time, end before the next prayer (Fajr stops
    // 10m before sunrise; Maghrib ends at the earlier of sunset +1h or Isha −15m).
    {key:'fajr', emoji:'🌅', tint:'indigo', start:['fajr',0], end:['sunrise',-10], endDay:0},
    {key:'dhuhr', emoji:'☀️', tint:'amber', start:['dhuhr',0], end:['asr',-15], endDay:0},
    {key:'asr', emoji:'🌤️', tint:'cyan', start:['asr',0], end:['maghrib',-15], endDay:0},
    {key:'maghrib', emoji:'🌇', tint:'orange', start:['maghrib',0], end:['maghrib',60], end2:['isha',-15], endDay:0},
    {key:'isha', emoji:'🌙', tint:'purple', start:['isha',0], end:['fajr',-30], endDay:1}
  ];
  return rows.map(row=>sortSampleHabit(label(row.key),'keepup',1,[],{
    emoji:row.emoji,
    emojiBgColor:row.tint,
    topics:['prayer'],
    durationMinutes:8,
    priority:1,
    hid:`sample-prayer-${row.key}`,
    allowedTimeStartAnchor:row.start[0],
    allowedTimeStartOffsetMin:row.start[1],
    allowedTimeEndAnchor:row.end[0],
    allowedTimeEndOffsetMin:row.end[1],
    allowedTimeEndDayOffset:row.endDay,
    allowedTimeEndCombine:row.end2 ? 'earlier' : null,
    allowedTimeEndAnchor2:row.end2 ? row.end2[0] : null,
    allowedTimeEndOffsetMin2:row.end2 ? row.end2[1] : null
  }));
}

// PURE: sample place ids referenced by habits about to be added.
function sampleLocationIdsReferenced(samples){
  const ids = new Set();
  (samples || []).forEach(h=>{
    if(!h)return;
    (Array.isArray(h.locationIds) ? h.locationIds : []).forEach(id=>{
      const clean = cleanLocationId(id);
      if(clean)ids.add(clean);
    });
    const pref = cleanLocationId(h.preferredLocationId);
    if(pref)ids.add(pref);
    if(h.locationPrefs && typeof h.locationPrefs === 'object'){
      Object.keys(h.locationPrefs).forEach(id=>{
        const clean = cleanLocationId(id);
        if(clean)ids.add(clean);
      });
    }
  });
  return ids;
}

// HYBRID: merge sample places + topics into settings (shared by feature / prayer add).
// Only seeds sample locations referenced by the habits being added — prayer-only
// packs seed topics and never touch the place registry or lastKnownLocationId.
function seedSamplePlacesAndTopics(samples,{setPresence = true} = {}){
  const neededIds = sampleLocationIdsReferenced(samples);
  const existing = normalizeLocationRegistry(sortSettings.locations);
  const byId = new Map(existing.map(l=>[l.id,l]));
  const sampleLocs = buildSampleLocations().filter(loc => neededIds.has(loc.id));
  sampleLocs.forEach(loc=>{ if(!byId.has(loc.id))byId.set(loc.id,loc); });
  const locations = normalizeLocationRegistry([...byId.values()]);
  const existingTopics = new Set(normalizeTopics(sortSettings.topics || []));
  (samples || []).forEach(h=>(h.topics || []).forEach(t=>{ if(t)existingTopics.add(t); }));
  const topics = normalizeTopics([...existingTopics]);
  const patch = {
    topics,
    showSampleOnCards:true
  };
  if(neededIds.size){
    const BLOCK_LOCATION = {
      sleep:'sample-home', breakfast:'sample-home', dinner:'sample-home',
      work:'sample-office', lunch:'sample-office'
    };
    const patchedBlocks = normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>{
      const label = (b.label || '').toLowerCase();
      const loc = BLOCK_LOCATION[label];
      if(loc && !b.locationId && byId.has(loc))return {...b,locationId:loc};
      return b;
    });
    patch.locations = locations;
    patch.showLocationOnCards = true;
    patch.defaultTravelMode = sortSettings.defaultTravelMode || 'walking';
    patch.blockedTimes = patchedBlocks;
    if(setPresence && !sortSettings.lastKnownLocationId){
      if(neededIds.has('sample-home') || byId.has('sample-home')){
        patch.lastKnownLocationId = 'sample-home';
      }else{
        const first = [...neededIds][0];
        if(first)patch.lastKnownLocationId = first;
      }
    }
  }
  updateSortSetting(patch,{renderNow:false,sync:false});
  return {locations, topics, seededLocationIds:[...neededIds]};
}

// PURE: look up a catalog sample by hid
function findCatalogSample(hid){
  const id = String(hid || '');
  if(!id)return null;
  return [...buildSortSamples(), ...buildPrayerSamples()].find(h => h.hid === id) || null;
}

// HANDLER: commit one or more catalog samples onto home
function commitSampleHabits(samples,{setPresence = true, closeSheets = false, toast = ''} = {}){
  const list = (samples || []).filter(Boolean);
  if(!list.length)return false;
  const data = load();
  const have = new Set(data.map(h => h.hid).filter(Boolean));
  const fresh = list.filter(h => h.hid && !have.has(h.hid));
  if(!fresh.length){
    if(typeof showToast === 'function')showToast('already on home');
    refreshSampleHabitsSheet();
    return false;
  }
  if(data.length + fresh.length > MAX_TINGS){
    alert(`${MAX_TINGS} habits max`);
    return false;
  }
  seedSamplePlacesAndTopics(fresh,{setPresence});
  const next = [...data, ...fresh.map(h=>({...h,lastLog:latestActualLog(h.logs)}))];
  if(!save(next))return false;
  updateSortSampleCount();
  syncSettingsControls();
  if(closeSheets){
    closeSheet('settings-sheet');
    closeSheet('sample-habits-sheet');
    closeSheet('about-sheet');
  }else{
    refreshSampleHabitsSheet();
  }
  if(typeof render === 'function')render();
  if(toast){
    const hids = fresh.map(h => h.hid).filter(Boolean);
    if(typeof showActionToast === 'function' && hids.length){
      showActionToast(toast,{type:'add-samples',hids,openAction:false});
    }else if(typeof showToast === 'function'){
      showToast(toast);
    }
  }
  return true;
}

// PURE: home city has usable coords for prayer timing.
function hasHomeCityCoords(settings){
  const s = settings || sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  return Number.isFinite(s.homeCityLat) && Number.isFinite(s.homeCityLng);
}

// HYBRID: open Settings → Locations with the city field focused (prayer sample gate).
function openHomeCitySettings(){
  closeSheet('sample-habits-sheet');
  closeSheet('about-sheet');
  if(typeof resetSettingsSheetState === 'function')resetSettingsSheetState();
  if(typeof syncSettingsControls === 'function')syncSettingsControls();
  openSheet('settings-sheet');
  const head = $('settings-locations-head');
  const body = $('settings-locations-body');
  if(body)body.hidden = false;
  if(head)head.setAttribute('aria-expanded','true');
  const input = $('home-city-input');
  if(input){
    try{ input.focus({preventScroll:false}); }catch(_){ input.focus(); }
    if(typeof input.scrollIntoView === 'function')input.scrollIntoView({block:'center', behavior:'smooth'});
  }
}

// PURE: a sample habit needs the home city when any endpoint uses a
// prayer/dynamic anchor (sunrise/sunset/Fajr/etc.) — those windows resolve
// against the general location, same as the daily prayers.
function sampleUsesDynamicTimes(h){
  return typeof habitUsesPrayerAnchors === 'function' && habitUsesPrayerAnchors(h);
}

// HYBRID: dynamic-time samples need a home city before add. Opens the city
// flow when missing.
function ensureHomeCityForDynamicSamples(){
  if(hasHomeCityCoords())return true;
  if(typeof showToast === 'function'){
    showToast('set your city in Settings → Locations first');
  }
  openHomeCitySettings();
  return false;
}

// HANDLER: add a single feature or prayer sample (sheet stays open)
function addOneSample(hid){
  const sample = findCatalogSample(hid);
  if(!sample)return false;
  const isPrayer = String(hid || '').startsWith('sample-prayer-');
  if(sampleUsesDynamicTimes(sample) && !ensureHomeCityForDynamicSamples())return false;
  sample.sample = false;
  if(typeof sample.name === 'string' && sample.name.startsWith('Sample: ')){
    sample.name = sample.name.slice('Sample: '.length);
  }
  const label = sampleDisplayName(sample) || 'sample';
  return commitSampleHabits([sample],{
    setPresence:!isPrayer,
    closeSheets:false,
    toast:`added · ${label}`
  });
}

// HANDLER: add feature-tour sample habits (+ seed sample locations)
function addSortSamples({closeSheets = true} = {}){
  const have = new Set(load().map(h => h.hid).filter(Boolean));
  const samples = buildSortSamples().filter(h => !have.has(h.hid));
  if(!samples.length){
    if(typeof showToast === 'function')showToast('feature demos already on home');
    refreshSampleHabitsSheet();
    return;
  }
  if(samples.some(sampleUsesDynamicTimes) && !ensureHomeCityForDynamicSamples())return;
  commitSampleHabits(samples,{
    setPresence:true,
    closeSheets,
    toast: closeSheets
      ? `samples added · keep any you want · sample tag`
      : `${samples.length} demos added`
  });
}

// HANDLER: add optional daily prayer samples (home city required; no sample places)
function addPrayerSamples({closeSheets = true} = {}){
  if(!ensureHomeCityForDynamicSamples())return;
  const have = new Set(load().map(h => h.hid).filter(Boolean));
  const samples = buildPrayerSamples().filter(h => !have.has(h.hid));
  if(!samples.length){
    if(typeof showToast === 'function')showToast('prayer samples already on home');
    refreshSampleHabitsSheet();
    return;
  }
  commitSampleHabits(samples,{
    setPresence:false,
    closeSheets,
    toast: closeSheets
      ? 'prayer samples added · keep any you want'
      : `${samples.length} prayers added`
  });
}

// HANDLER: adopt a sample as a real habit
function keepSampleHabit(idx){
  const data = load();
  const h = data[idx];
  if(!h || !h.sample)return false;
  h.sample = false;
  if(typeof h.name === 'string' && h.name.startsWith('Sample: ')){
    h.name = h.name.slice('Sample: '.length);
  }
  if(!save(data))return false;
  if(typeof showToast === 'function')showToast('kept · now one of yours');
  updateSortSampleCount();
  if(typeof detailIdx === 'number' && detailIdx === idx && typeof openDetail === 'function')openDetail(idx);
  if(typeof render === 'function')render();
  return true;
}

// HYBRID: drop unused sample-* places/travel from settings; return reconciled habits
function pruneUnusedSamplePlaces(habits){
  const next = habits || [];
  const usedIds = new Set();
  next.forEach(h=>(h.locationIds || []).forEach(id=>{ if(id)usedIds.add(id); }));
  next.forEach(h=>{ if(h.preferredLocationId)usedIds.add(h.preferredLocationId); });
  const locations = normalizeLocationRegistry(sortSettings.locations)
    .filter(loc=>{
      const id = loc.id || '';
      if(!id.startsWith('sample-'))return true;
      return usedIds.has(id);
    });
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    const a = String(edge.a || '');
    const b = String(edge.b || '');
    if(a.startsWith('sample-') && !usedIds.has(a))continue;
    if(b.startsWith('sample-') && !usedIds.has(b))continue;
    travel[key] = edge;
  }
  const lastKnown = (sortSettings.lastKnownLocationId || '').startsWith('sample-')
    && !usedIds.has(sortSettings.lastKnownLocationId)
    ? null
    : sortSettings.lastKnownLocationId;
  updateSortSetting({locations,travel,lastKnownLocationId:lastKnown},{renderNow:false,sync:false});
  return reconcileLocations(next,{...sortSettings,locations,travel}).data;
}

// HANDLER: remove remaining sample habits (+ drop unused sample-* locations)
function removeSortSamples(){
  const current = load();
  const next = current.filter(h=>!h.sample);
  if(next.length === current.length){
    if(typeof showToast === 'function')showToast('no samples');
    updateSortSampleCount();
    return;
  }
  const reconciled = pruneUnusedSamplePlaces(next);
  if(save(reconciled)){
    updateSortSampleCount();
    syncSettingsControls();
    if(typeof refreshSampleHabitsSheet === 'function')refreshSampleHabitsSheet();
    if(typeof render === 'function')render();
    if(typeof showToast === 'function')showToast('samples removed');
  }
}

// RENDER: sync range field value and label
function syncSettingRange(name,value,suffix){
  const field = $(`setting-${name}`);
  const label = $(`setting-${name}-label`);
  if(!field || !label)return;
  field.value = value;
  if(name === 'rhythm-bias'){
    const num = parseInt(value,10) || 0;
    label.textContent = num === 0 ? 'even' : num > 0 ? `short +${num}` : `long +${Math.abs(num)}`;
  }else{
    label.textContent = `${value}${suffix}`;
  }
}

// WIRE: attach input and change listeners to range
function bindSettingRange(name,key,suffix,options = {}){
  const field = $(`setting-${name}`);
  if(!field)return;
  field.addEventListener('input',e=>{
    const value = parseInt(e.target.value,10);
    syncSettingRange(name,value,suffix);
    const patch = {[key]:value};
    if(options.custom !== false && isSortSettingKey(key))patch.preset = 'custom';
    updateSortSetting(patch,{sync:false,renderNow:false});
  });
  field.addEventListener('change',()=>{
    render();
  });
}

