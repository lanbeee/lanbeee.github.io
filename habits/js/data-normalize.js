// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION — PURE (no I/O). Validates and coerces raw parsed JSON into
// the canonical Habit / Settings shapes declared above.
// ─────────────────────────────────────────────────────────────────────────

// ── Habit links ──────────────────────────────────────────────────────────
// Whatever you launch when you actually do the habit: a phone or WhatsApp
// number, a FaceTime call, an app shortcut, or a meeting/web link (Zoom,
// Teams, Meet, Webex, or anything else). Any habit can carry a few. The first
// one is primary — it is what a double tap on the card opens, right after
// logging.

const LINK_KINDS = ['phone','whatsapp','facetime','app','link'];
const MAX_HABIT_LINKS = 4;

/** PURE: 'phone' | 'whatsapp' | 'facetime' | 'app' | 'link'. */
function normalizeLinkKind(value){
  return LINK_KINDS.includes(value) ? value : 'link';
}

/** PURE: compact user-facing name for an app shortcut. */
function normalizeLinkLabel(value){
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,30);
}

/** PURE: kinds whose value is a phone number rather than a URL. */
function linkKindIsNumber(kind){
  return kind === 'phone' || kind === 'whatsapp' || kind === 'facetime';
}

/**
 * PURE: keep a dialable number — digits with an optional leading '+'.
 * Spaces, dashes and brackets are stripped so tel:, wa.me and facetime: all
 * accept it. Returns '' when there aren't enough digits to dial.
 */
function normalizePhoneValue(value){
  if(typeof value !== 'string' && typeof value !== 'number')return '';
  const raw = String(value).trim();
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g,'').slice(0,15);
  if(digits.length < 4)return '';
  return (plus ? '+' : '') + digits;
}

/**
 * PURE: keep a launchable URL. A bare host ("meet.google.com/abc") gets https,
 * app schemes (zoommtg://, msteams://) pass through, and script-ish schemes are
 * dropped so a pasted link can never execute anything.
 */
function normalizeUrlValue(value){
  const raw = String(value ?? '').trim();
  if(!raw)return '';
  if(/^(javascript|data|vbscript|file):/i.test(raw))return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;
  try{
    const url = new URL(candidate);
    // A web URL needs a host; app schemes (zoommtg:, msteams:) carry their
    // payload in the opaque part instead.
    const webish = /^https?:$/i.test(url.protocol);
    if(webish && !url.hostname)return '';
    return url.href.slice(0,600);
  }catch{
    return '';
  }
}

/** PURE: normalize one link's value for its kind. '' means unusable. */
function normalizeLinkValue(kind,value){
  return linkKindIsNumber(normalizeLinkKind(kind))
    ? normalizePhoneValue(value)
    : normalizeUrlValue(value);
}

/** PURE: clean a habit's link list — drops unusable and duplicate entries. */
function normalizeLinks(raw){
  if(!Array.isArray(raw))return [];
  const out = [];
  for(const item of raw){
    if(!item || typeof item !== 'object')continue;
    const kind = normalizeLinkKind(item.kind);
    const value = normalizeLinkValue(kind,item.value);
    if(!value)continue;
    if(out.some(l => l.kind === kind && l.value === value))continue;
    const label = kind === 'app' ? normalizeLinkLabel(item.label) : '';
    out.push(label ? {kind,value,label} : {kind,value});
    if(out.length >= MAX_HABIT_LINKS)break;
  }
  return out;
}

// Hosts worth naming on the button. Anything unlisted falls back to its own
// hostname, so a self-hosted room still reads as something recognisable.
const LINK_PROVIDERS = [
  {host:/(^|\.)zoom\.us$/i, label:'zoom'},
  {host:/(^|\.)teams\.(microsoft|live)\.com$/i, label:'teams'},
  {host:/^meet\.google\.com$/i, label:'meet'},
  {host:/(^|\.)webex\.com$/i, label:'webex'},
  {host:/(^|\.)whatsapp\.com$/i, label:'whatsapp'},
  {host:/(^|\.)meet\.jit\.si$/i, label:'jitsi'},
  {host:/(^|\.)discord\.(gg|com)$/i, label:'discord'},
  {host:/(^|\.)slack\.com$/i, label:'slack'},
  {host:/(^|\.)skype\.com$/i, label:'skype'},
  {host:/^mail\.google\.com$/i, label:'gmail'},
  {host:/(^|\.)outlook\.(live|office)\.com$/i, label:'outlook'},
  {host:/(^|\.)facebook\.com$/i, label:'facebook'},
  {host:/(^|\.)instagram\.com$/i, label:'instagram'},
  {host:/(^|\.)(youtube\.com|youtu\.be)$/i, label:'youtube'},
  {host:/(^|\.)reddit\.com$/i, label:'reddit'},
  {host:/(^|\.)linkedin\.com$/i, label:'linkedin'},
  {host:/(^|\.)(x\.com|twitter\.com)$/i, label:'x'}
];

/** PURE: short name for a URL — the meeting service, else its host. */
function linkProviderLabel(url){
  const clean = normalizeUrlValue(url);
  if(!clean)return 'link';
  let parsed;
  try{ parsed = new URL(clean); }catch{ return 'link'; }
  const host = (parsed.hostname || '').replace(/^www\./i,'');
  if(!host){
    // App scheme (zoommtg:, msteams:) — name it after the scheme.
    const scheme = parsed.protocol.replace(':','').toLowerCase();
    if(scheme.startsWith('zoom'))return 'zoom';
    if(scheme.startsWith('msteams'))return 'teams';
    return scheme || 'link';
  }
  const match = LINK_PROVIDERS.find(p => p.host.test(host));
  return match ? match.label : host;
}

/** PURE: button/label text for a link. */
function linkLabel(link){
  if(!link)return 'link';
  if(link.kind === 'phone')return 'call';
  if(link.kind === 'whatsapp')return 'whatsapp';
  if(link.kind === 'facetime')return 'facetime';
  if(link.kind === 'app')return normalizeLinkLabel(link.label) || linkProviderLabel(link.value) || 'app';
  return linkProviderLabel(link.value);
}

// Meeting services share the video icon; everything else is a plain link.
const VIDEO_PROVIDERS = ['zoom','teams','meet','webex','jitsi','discord','skype'];
const APP_PROVIDER_ICONS = {
  gmail:'ti-brand-gmail',
  outlook:'ti-mail',
  facebook:'ti-brand-facebook',
  instagram:'ti-brand-instagram',
  youtube:'ti-brand-youtube',
  reddit:'ti-brand-reddit',
  linkedin:'ti-brand-linkedin',
  x:'ti-brand-x'
};

/** PURE: Tabler icon class for a link. */
function linkIconClass(link){
  if(!link)return 'ti-link';
  if(link.kind === 'phone')return 'ti-phone';
  if(link.kind === 'whatsapp')return 'ti-brand-whatsapp';
  if(link.kind === 'facetime')return 'ti-video';
  const provider = linkProviderLabel(link.value);
  if(APP_PROVIDER_ICONS[provider])return APP_PROVIDER_ICONS[provider];
  if(link.kind === 'app')return 'ti-apps';
  return VIDEO_PROVIDERS.includes(provider) ? 'ti-video' : 'ti-link';
}

/**
 * PURE: the URL a link opens.
 * WhatsApp has no public "place a call" link, so wa.me opens the chat with
 * that contact — its call buttons are one tap away from there.
 */
function linkLaunchUrl(link){
  if(!link)return '';
  const kind = normalizeLinkKind(link.kind);
  const value = normalizeLinkValue(kind,link.value);
  if(!value)return '';
  if(kind === 'phone')return `tel:${value}`;
  if(kind === 'whatsapp')return `https://wa.me/${value.replace(/\D/g,'')}`;
  if(kind === 'facetime')return `facetime://${value}`;
  return value;
}

/**
 * PURE: true when the URL hands off to an OS handler rather than opening a
 * page. Those must replace the location — window.open leaves a blank tab.
 */
function linkHandsOffToOs(url){
  return /^(tel:|facetime:|facetime-audio:|sms:|mailto:)/i.test(String(url || ''))
    || (/^[a-z][a-z0-9+.-]*:/i.test(String(url || '')) && !/^https?:/i.test(String(url || '')));
}

/** PURE: the link a double tap fires — the first one. */
function habitPrimaryLink(h){
  const links = normalizeLinks(h && h.links);
  return links.length ? links[0] : null;
}

/**
 * PURE: migrate the earlier call-only fields (callNumber + callApp) into links.
 * 'ask' meant "show both buttons", so it becomes two links.
 */
function legacyCallLinks(raw){
  const number = normalizePhoneValue(raw && raw.callNumber);
  if(!number)return [];
  const app = raw.callApp;
  if(app === 'whatsapp')return [{kind:'whatsapp',value:number}];
  if(app === 'ask')return [{kind:'phone',value:number},{kind:'whatsapp',value:number}];
  return [{kind:'phone',value:number}];
}

function normalize(items){
  const normalized = items.map(raw => {
    // Tasks and legacy events are now a single one-off type. Legacy 'event' records
    // migrate to 'task' with eventTime preserved (a timed task = appointment).
    let type = raw.type || 'keepup';
    const wasEvent = type === 'event';
    if(wasEvent)type = 'task';
    const eventTime = type === 'task' ? clampTimestamp(raw.eventTime) : null;
    let dueDate = type === 'task' ? clampDayTimestamp(raw.dueDate) : null;
    if(wasEvent && eventTime !== null && dueDate === null)dueDate = clampDayTimestamp(eventTime);
    const flexibilityDays = clampFlexibility(raw.flexibilityDays);
    // hardDue is now inferred: a task with a due date and no flexibility is a
    // firm deadline (escalates urgency past it and fires reminders). Any
    // flexibility > 0 means the deadline is soft.
    const hardDue = type === 'task' && dueDate !== null && flexibilityDays === 0;
    // autoMarkMinutes replaces the legacy markDone toggle. null/empty = manual;
    // a number = automatic logging with this delay. Breakables use planner
    // chunk ends; other items use their scheduled trigger. Legacy
    // markDone:false maps to 0 (auto at the trigger); legacy events do too.
    const legacyAuto = wasEvent || raw.markDone === false;
    const autoMarkMinutes = raw.autoMarkMinutes != null
      ? normalizeAutoMark(raw.autoMarkMinutes)
      : (legacyAuto ? 0 : null);
    const logs = normalizeLogs(raw.logs);
    // A past legacy event has already happened — record it as a completed entry so it
    // fades into history instead of nagging as an overdue task.
    if(wasEvent && eventTime !== null && eventTime < Date.now() && !logs.some(l=>logTime(l) === eventTime)){
      logs.push(eventTime);
    }
    // Location ids are de-duped here; the dangling-id sweep (dropping ids no
    // longer present in the registry) happens once at startup via
    // reconcileLocations(), after both habits and settings have loaded.
    const optionLocationState = typeof habitScheduleOptionLocationState === 'function'
      ? habitScheduleOptionLocationState(raw.scheduleOptions)
      : {options:[],locationIds:[],anywhereAllowed:false};
    const scheduleOptions = optionLocationState.options;
    const locationIds = scheduleOptions.length
      ? optionLocationState.locationIds
      : normalizeLocationIds(raw.locationIds);
    const anywhereAllowed = scheduleOptions.length
      ? optionLocationState.anywhereAllowed
      : (raw.anywhereAllowed == null ? locationIds.length === 0 : Boolean(raw.anywhereAllowed));
    const locationPrefs = normalizeLocationPrefs(raw.locationPrefs, locationIds, raw.preferredLocationId);
    const preferredLocationId = primaryPreferredLocationId(locationPrefs, locationIds);
    const isRhythmHabit = type === 'keepup' || type === 'reduce';
    const breakable = Boolean(raw.breakable);
    // Stable habit id. Used by other habits' time anchors ("habit B's window opens
    // when habit A is logged"). Generated once on first normalize; legacy records
    // get one transparently so the feature can opt-in on any habit.
    const hid = cleanHabitId(raw.hid) || generateHabitId();
    const scheduleLinkMigration = normalizeScheduleLinksWithMigration(raw,hid);
    const h = {
      hid,
      name: raw.name || '',
      type,
      target: (type === 'zero' || type === 'task')
        ? null
        : clampRhythmValue(raw.target || 7),
      dueDate,
      hardDue,
      autoMarkMinutes,
      eventTime,
      planByDate: isRhythmHabit ? clampDayTimestamp(raw.planByDate) : null,
      createdAt: raw.createdAt || null,
      logs,
      emoji: raw.emoji || '',
      emojiBgColor:normalizeEmojiBgColor(raw.emojiBgColor),
      pinned:Boolean(raw.pinned),
      showOnSharedDisplay:raw.showOnSharedDisplay !== false,
      allowSharedDisplayCompletion:raw.allowSharedDisplayCompletion !== false,
      sample:Boolean(raw.sample),
      snoozedUntil: raw.snoozedUntil || null,
      topics:normalizeTopics(raw.topics),
      allowedWeekdays:normalizeAllowedWeekdays(raw.allowedWeekdays),
      allowedMonthDays:normalizeAllowedMonthDays(raw.allowedMonthDays),
      preferredWeekdays:normalizeAllowedWeekdays(raw.preferredWeekdays),
      preferredMonthDays:normalizeAllowedMonthDays(raw.preferredMonthDays),
      allowedTimeStart:normalizeTimeMinutes(raw.allowedTimeStart),
      allowedTimeEnd:normalizeTimeMinutes(raw.allowedTimeEnd),
      preferredTimeStart:normalizeTimeMinutes(raw.preferredTimeStart),
      preferredTimeEnd:normalizeTimeMinutes(raw.preferredTimeEnd),
      // cleanAnchor accepts prayer keys AND 'habit'. Falls back to cleanPrayerAnchor
      // only if prayer-times.js hasn't loaded yet (shouldn't happen at runtime).
      allowedTimeStartAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.allowedTimeStartAnchor) : cleanPrayerAnchor(raw.allowedTimeStartAnchor),
      allowedTimeStartOffsetMin:normalizePrayerOffset(raw.allowedTimeStartOffsetMin),
      allowedTimeEndAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.allowedTimeEndAnchor) : cleanPrayerAnchor(raw.allowedTimeEndAnchor),
      allowedTimeEndOffsetMin:normalizePrayerOffset(raw.allowedTimeEndOffsetMin),
      preferredTimeStartAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.preferredTimeStartAnchor) : cleanPrayerAnchor(raw.preferredTimeStartAnchor),
      preferredTimeStartOffsetMin:normalizePrayerOffset(raw.preferredTimeStartOffsetMin),
      preferredTimeEndAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.preferredTimeEndAnchor) : cleanPrayerAnchor(raw.preferredTimeEndAnchor),
      preferredTimeEndOffsetMin:normalizePrayerOffset(raw.preferredTimeEndOffsetMin),
      // Habit-id refs only stick when the matching anchor is actually 'habit'.
      allowedTimeStartAnchorHabitId:(raw.allowedTimeStartAnchor === 'habit' ? cleanHabitId(raw.allowedTimeStartAnchorHabitId) : '') || null,
      allowedTimeEndAnchorHabitId:(raw.allowedTimeEndAnchor === 'habit' ? cleanHabitId(raw.allowedTimeEndAnchorHabitId) : '') || null,
      preferredTimeStartAnchorHabitId:(raw.preferredTimeStartAnchor === 'habit' ? cleanHabitId(raw.preferredTimeStartAnchorHabitId) : '') || null,
      preferredTimeEndAnchorHabitId:(raw.preferredTimeEndAnchor === 'habit' ? cleanHabitId(raw.preferredTimeEndAnchorHabitId) : '') || null,
      scheduleLinks:scheduleLinkMigration.links,
      // Combined expressions (later/earlier of two) + optional +1d day shift.
      ...normalizeCombineFields(raw, 'allowedTimeStart'),
      ...normalizeCombineFields(raw, 'allowedTimeEnd'),
      ...normalizeCombineFields(raw, 'preferredTimeStart'),
      ...normalizeCombineFields(raw, 'preferredTimeEnd'),
      flexibilityDays,
      durationMinutes:clampDuration(raw.durationMinutes),
      breakable,
      minChunkMinutes:clampMinChunk(raw.minChunkMinutes),
      timerAutoStopMinutes:normalizeTimerAutoStop(raw.timerAutoStopMinutes),
      trackValue:Boolean(raw.trackValue),
      priority:clampPriority(raw.priority),
      locationIds,
      anywhereAllowed,
      locationPrefs,
      preferredLocationId,
      scheduleOptions,
      links:normalizeLinks(Array.isArray(raw.links) && raw.links.length ? raw.links : legacyCallLinks(raw)),
      externalId: typeof raw.externalId === 'string' ? raw.externalId.slice(0,256) || null : null,
      source: (raw.source === 'pdf' || raw.source === 'msgraph' || raw.source === 'gcal') ? raw.source : null,
      importedAt: Number.isFinite(Number(raw.importedAt)) ? Number(raw.importedAt) : null
    };
    // Option mode owns the complete hard day/time/place schedule. Discard
    // hidden simple-mode constraints during normalization so imported/test
    // data cannot carry two contradictory sources of truth.
    if(scheduleOptions.length){
      h.allowedWeekdays = [];
      h.allowedMonthDays = [];
      h.allowedTimeStart = null;
      h.allowedTimeEnd = null;
      for(const field of ['allowedTimeStart','allowedTimeEnd']){
        h[field + 'Anchor'] = null;
        h[field + 'OffsetMin'] = 0;
        h[field + 'AnchorHabitId'] = null;
        h[field + 'Combine'] = null;
        h[field + 'Anchor2'] = null;
        h[field + 'OffsetMin2'] = 0;
        h[field + 'AnchorHabitId2'] = null;
        h[field + 'FixedMin2'] = null;
        h[field + 'DayOffset'] = 0;
        h[field + 'DayOffset2'] = 0;
      }
    }
    // Only zero-offset, uncombined start anchors have an exact planner-order
    // equivalent. Move those out of Dynamic timing; preserve all other habit
    // expressions as explicit legacy completion-trigger timing.
    for(const field of scheduleLinkMigration.migratedFields){
      h[field + 'Anchor'] = null;
      h[field + 'OffsetMin'] = 0;
      h[field + 'AnchorHabitId'] = null;
      h[field + 'Combine'] = null;
      h[field + 'Anchor2'] = null;
      h[field + 'OffsetMin2'] = 0;
      h[field + 'AnchorHabitId2'] = null;
      h[field + 'FixedMin2'] = null;
      h[field + 'DayOffset'] = 0;
      h[field + 'DayOffset2'] = 0;
    }
    // Migration: a degenerate 0/0 fixed window with no anchor is the signature
    // of the Number(null)===0 render bug in detail-view.js (an empty time
    // input rendered as "00:00" and got saved back as 0/0). hasTimeWindow
    // treated 0/0 as a valid 24h window, which silently shadowed rhythm
    // placement for affected habits. Collapse it back to "no window set".
    if(h.allowedTimeStart === 0 && h.allowedTimeEnd === 0
      && !h.allowedTimeStartAnchor && !h.allowedTimeEndAnchor){
      h.allowedTimeStart = null;
      h.allowedTimeEnd = null;
    }
    if(h.preferredTimeStart === 0 && h.preferredTimeEnd === 0
      && !h.preferredTimeStartAnchor && !h.preferredTimeEndAnchor){
      h.preferredTimeStart = null;
      h.preferredTimeEnd = null;
    }
    h.lastLog = latestActualLog(h.logs);
    return h;
  });
  const validHids = new Set(normalized.map(h=>h.hid));
  for(const h of normalized){
    h.scheduleLinks = normalizeScheduleLinks(h.scheduleLinks,h.hid)
      .filter(link=>validHids.has(link.anchorHid));
  }
  return normalized;
}

// PURE: true when this item has automatic logging enabled. Breakables use each
// captured agenda chunk end; other items keep their event/day trigger.
function isAutoMark(h){
  return Boolean(h) && h.autoMarkMinutes !== null;
}

// PURE: the effective "when" for a one-off task — its fixed time if set, else its due date. null = someday.
function taskWhen(h){
  if(h.type !== 'task')return null;
  return h.eventTime !== null ? h.eventTime : h.dueDate;
}
// PURE: a task with a fixed clock time (an appointment), as opposed to dated/someday.
function isTimedTask(h){
  return h.type === 'task' && h.eventTime !== null;
}
// PURE: one-off soft "plan by" date on a rhythm habit (keepup/reduce).
function habitPlanByDate(h){
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return null;
  return h.planByDate != null ? clampDayTimestamp(h.planByDate) : null;
}
// PURE: Sunday (or today if already Sunday) — handy "end of this week" preset.
function endOfWeekDate(now = Date.now()){
  const base = dayStart(now);
  const weekday = new Date(base).getDay();
  const add = weekday === 0 ? 0 : 7 - weekday;
  return base + add * 86400000;
}
// HYBRID-safe: clear a habit's one-off plan-by after an actual log fulfills it.
function clearPlanByDateOnLog(h){
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return;
  if(h.planByDate != null)h.planByDate = null;
}

function save(data){
  try{
    let next = normalize(data);
    let str = JSON.stringify(next);
    const kb = Math.round((str.length * 2) / 1024);
    if(kb >= QUOTA_HARD_KB){
      next = pruneForStorage(next,QUOTA_HARD_KB - 120);
      str = JSON.stringify(next);
    }
    Storage.writeRaw(KEY, str);
    bumpPlannerDataRevision();
    updateQuotaBar(sizeKb(next));
    return true;
  }catch(e){
    try{
      const pruned = pruneForStorage(normalize(data),QUOTA_HARD_KB - 360);
      const str = JSON.stringify(pruned);
      Storage.writeRaw(KEY, str);
      bumpPlannerDataRevision();
      updateQuotaBar(sizeKb(pruned));
      showToast('old dense activity compacted');
      return true;
    }catch{
      alert('storage full - remove some habits first');
      return false;
    }
  }
}
