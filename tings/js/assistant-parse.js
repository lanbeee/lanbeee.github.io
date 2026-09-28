// Legacy parsing helpers retained for deterministic normalization tests and
// compatibility. Natural-language assistant routing does not call them.

const ASSISTANT_WEEKDAY_NAMES = {
  sunday:0, sun:0,
  monday:1, mon:1,
  tuesday:2, tue:2, tues:2,
  wednesday:3, wed:3,
  thursday:4, thu:4, thurs:4,
  friday:5, fri:5,
  saturday:6, sat:6
};
const ASSISTANT_WEEKDAY_TOKEN = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?';

const ASSISTANT_MONTH_NAMES = {
  january:0, jan:0,
  february:1, feb:1,
  march:2, mar:2,
  april:3, apr:3,
  may:4,
  june:5, jun:5,
  july:6, jul:6,
  august:7, aug:7,
  september:8, sep:8, sept:8,
  october:9, oct:9,
  november:10, nov:10,
  december:11, dec:11
};

function assistantNormText(value){
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\b(\d{1,2})\s*([ap])\.?\s?m\.?(?![a-z])/g, '$1$2m')
    .replace(/\s+/g, ' ')
    .trim();
}

function assistantDayBase(ts){
  return typeof dayStart === 'function'
    ? dayStart(ts)
    : new Date(new Date(ts).setHours(0, 0, 0, 0)).getTime();
}

function assistantClockLabel(minutes){
  if(!Number.isFinite(minutes))return '';
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function assistantFriendlyClock(minutes){
  if(!Number.isFinite(minutes))return '';
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const ap = h24 >= 12 ? 'pm' : 'am';
  let h = h24 % 12;
  if(h === 0)h = 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}

function assistantParseClock(value){
  const s = assistantNormText(value).replace(/\./g, '');
  if(!s)return null;
  if(s === 'noon' || s === 'midday')return 12 * 60;
  if(s === 'midnight')return 0;
  let match = s.match(/^(\d{1,2}):(\d{2})$/);
  if(match){
    const h = Number(match[1]);
    const min = Number(match[2]);
    if(h >= 0 && h <= 23 && min >= 0 && min <= 59)return h * 60 + min;
  }
  match = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)$/);
  if(match){
    let h = Number(match[1]);
    const min = match[2] ? Number(match[2]) : 0;
    const ap = match[3][0];
    if(h === 12)h = 0;
    if(ap === 'p')h += 12;
    if(h >= 0 && h <= 23 && min >= 0 && min <= 59)return h * 60 + min;
  }
  match = s.match(/^(\d{1,2})(a|am|p|pm)$/);
  if(match){
    return assistantParseClock(`${match[1]} ${match[2]}`);
  }
  return typeof timeInputToMinutes === 'function' ? timeInputToMinutes(s) : null;
}

function assistantParseDuration(value){
  if(value == null || value === '')return null;
  if(typeof value === 'number' && Number.isFinite(value)){
    const n = Math.round(value);
    return n >= 1 ? n : null;
  }
  const s = assistantNormText(value);
  if(!s)return null;
  if(/\bhour and a half\b/.test(s) || /\b1\.5\s*h/.test(s))return 90;
  if(/\bhalf an hour\b/.test(s) || /\bhalf hour\b/.test(s) || s === '30m' || s === '½ hour')return 30;
  if(/\bquarter(?: of)?(?: an)? hour\b/.test(s))return 15;
  if(/\ban hour\b/.test(s) || s === '1h' || s === '1 hr' || s === 'one hour')return 60;
  const hm = s.match(/\b(\d+)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b/);
  if(hm)return Number(hm[1]) * 60 + Number(hm[2]);
  const hours = s.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if(hours){
    const n = Math.round(Number(hours[1]) * 60);
    return n >= 1 ? n : null;
  }
  const mins = s.match(/\b(\d+)\s*(?:minutes?|mins?|m)\b/) || s.match(/^(\d+)$/);
  if(mins){
    const n = Number(mins[1]);
    return n >= 1 ? n : null;
  }
  return null;
}

function assistantParsePriority(value){
  if(value == null || value === '')return null;
  if(typeof value === 'number' && Number.isFinite(value)){
    return typeof clampPriority === 'function' ? clampPriority(value) : Math.max(0, Math.min(5, Math.round(value)));
  }
  const s = assistantNormText(value);
  if(/p0|critical|urgent|asap/.test(s))return 0;
  if(/p1|important|high/.test(s))return 1;
  if(/p2|normal|medium/.test(s))return 2;
  if(/p3/.test(s))return 3;
  if(/p4|low/.test(s))return 4;
  if(/p5|someday|whenever|later/.test(s))return 5;
  const n = parseInt(s, 10);
  if(Number.isFinite(n))return typeof clampPriority === 'function' ? clampPriority(n) : Math.max(0, Math.min(5, n));
  return null;
}

const ASSISTANT_NUMBER_WORDS = {
  a:1, an:1, one:1, two:2, three:3, four:4, five:5,
  six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12,
  once:1, twice:2, thrice:3
};
const ASSISTANT_COUNT_WORD = 'once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

function assistantParseCount(value, min, max){
  const lo = min == null ? 1 : min;
  const hi = max == null ? 30 : max;
  if(value == null || value === '')return null;
  if(typeof value === 'number' && Number.isFinite(value)){
    return Math.max(lo, Math.min(hi, Math.round(value)));
  }
  const s = assistantNormText(value);
  if(!s)return null;
  if(Object.prototype.hasOwnProperty.call(ASSISTANT_NUMBER_WORDS, s)){
    return Math.max(lo, Math.min(hi, ASSISTANT_NUMBER_WORDS[s]));
  }
  const n = parseInt(s, 10);
  if(!Number.isFinite(n))return null;
  return Math.max(lo, Math.min(hi, n));
}

function assistantWeekdayIndex(token){
  const raw = assistantNormText(token);
  if(!raw)return null;
  const candidates = [raw, raw.replace(/s$/, ''), raw.replace(/days?$/, '')];
  for(let i = 0; i < candidates.length; i += 1){
    if(Object.prototype.hasOwnProperty.call(ASSISTANT_WEEKDAY_NAMES, candidates[i])){
      return ASSISTANT_WEEKDAY_NAMES[candidates[i]];
    }
  }
  return null;
}

function assistantCollectWeekdays(text){
  const s = assistantNormText(text);
  if(!s)return [];
  const days = [];
  const re = new RegExp(`\\b(${ASSISTANT_WEEKDAY_TOKEN})s?\\b`, 'g');
  let match;
  while((match = re.exec(s))){
    const before = s.slice(Math.max(0, match.index - 6), match.index);
    if(/\bnext\s+$/.test(before))continue;
    const idx = assistantWeekdayIndex(match[1]);
    if(idx != null && days.indexOf(idx) < 0)days.push(idx);
  }
  return days.sort((a, b) => a - b);
}

function assistantLooksLikeWeekdaySchedule(text, days){
  const s = assistantNormText(text);
  if(/\b(?:every\s+)?weekends?\b/.test(s) || /\b(?:every\s+)?weekdays?\b/.test(s))return true;
  if(!days || !days.length)return false;
  if(/\bnext (?:sun|mon|tue|wed|thu|fri|sat)/.test(s) && !/\bevery\b/.test(s) && days.length === 1)return false;
  if(/\bevery\b/.test(s))return true;
  if(/\bonly on\b/.test(s))return true;
  if(days.length > 1)return true;
  if(new RegExp(`\\b(?:${ASSISTANT_WEEKDAY_TOKEN})s\\b`).test(s))return true;
  if(/\bweekly\b|\bevery week\b|\btimes? a week\b/.test(s))return true;
  if(typeof assistantLooksLikeEdit === 'function' && assistantLooksLikeEdit(s)
    && /\b(?:sun|mon|tue|wed|thu|fri|sat|weekend|weekday)/.test(s))return true;
  return false;
}

function assistantParseWeekdaySchedule(text){
  const s = assistantNormText(text);
  if(!s)return null;
  if(/\b(?:every\s+)?weekends?\b/.test(s) || /\bon the weekends?\b/.test(s))return [0, 6];
  if((/\b(?:every\s+)?weekdays?\b/.test(s) || /\bon weekdays\b/.test(s)) && !/\bweekend/.test(s)){
    return [1, 2, 3, 4, 5];
  }
  const days = assistantCollectWeekdays(s);
  if(!days.length)return null;
  if(!assistantLooksLikeWeekdaySchedule(s, days))return null;
  return days;
}

function assistantNormalizeWeekdaysArg(value){
  if(value == null || value === '')return null;
  if(typeof value === 'number'){
    if(Number.isInteger(value) && value >= 0 && value <= 6)return [value];
    return null;
  }
  if(typeof value === 'string'){
    const s = assistantNormText(value);
    if(/^(any|all|none|everyday|every day|daily)$/.test(s))return [];
    const scheduled = assistantParseWeekdaySchedule(s);
    if(scheduled)return scheduled;
    const days = assistantCollectWeekdays(s);
    return days.length ? days : null;
  }
  if(Array.isArray(value)){
    const days = [];
    for(let i = 0; i < value.length; i += 1){
      const nested = assistantNormalizeWeekdaysArg(value[i]);
      if(!nested)continue;
      for(let j = 0; j < nested.length; j += 1){
        if(days.indexOf(nested[j]) < 0)days.push(nested[j]);
      }
    }
    return days.sort((a, b) => a - b);
  }
  return null;
}

function assistantParseBool(value){
  if(typeof value === 'boolean')return value;
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  if(/^(true|yes|on|y|1)$/.test(s))return true;
  if(/^(false|no|off|n|0)$/.test(s))return false;
  return null;
}

function assistantParseHabitKind(value){
  if(value == null || value === '')return null;
  // The draft_item schema documents the slash pairs the model copies
  // ("keepup/build", "reduce/limit", "zero/stop"). Take the first known word.
  const tokens = assistantNormText(value).split(/[^a-z]+/).filter(Boolean);
  for(let i = 0; i < tokens.length; i += 1){
    const token = tokens[i];
    if(/^(keepup|build|building)$/.test(token))return 'keepup';
    if(/^(reduce|limit|limiting)$/.test(token))return 'reduce';
    if(/^(zero|stop|stopping)$/.test(token))return 'zero';
  }
  return null;
}

function assistantParseMonthDays(value){
  if(value == null || value === '')return null;
  if(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31)return [value];
  if(Array.isArray(value)){
    const days = [];
    for(let i = 0; i < value.length; i += 1){
      const nested = assistantParseMonthDays(value[i]);
      if(!nested)continue;
      for(let j = 0; j < nested.length; j += 1){
        if(days.indexOf(nested[j]) < 0)days.push(nested[j]);
      }
    }
    return days.sort((a, b) => a - b);
  }
  const s = assistantNormText(value);
  if(!s)return null;
  if(/^(any|all|none|everyday|every day|daily)$/.test(s))return [];
  const days = [];
  const re = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/g;
  let match;
  while((match = re.exec(s))){
    const n = Number(match[1]);
    if(n >= 1 && n <= 31 && days.indexOf(n) < 0)days.push(n);
  }
  return days.length ? days.sort((a, b) => a - b) : null;
}

function assistantParseTopicsArg(value){
  if(value == null || value === '')return null;
  const s = typeof value === 'string' ? assistantNormText(value) : '';
  if(s && /^(none|off|clear)$/.test(s))return [];
  if(typeof normalizeTopics === 'function')return normalizeTopics(value);
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map(item => String(item || '').trim()).filter(Boolean).slice(0, 24);
}

function assistantParseEmojiColor(value){
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  if(/^(none|off|clear|default)$/.test(s))return '';
  if(typeof normalizeEmojiBgColor === 'function'){
    const token = normalizeEmojiBgColor(s);
    if(token)return token;
    return null;
  }
  return s;
}

function assistantParseEmoji(value){
  if(value == null)return null;
  const raw = String(value).trim();
  if(!raw || /^(none|off|clear|default)$/i.test(raw))return '';
  return typeof cleanMark === 'function' ? cleanMark(raw) : raw.slice(0, 8);
}

function assistantParseBreakable(value){
  if(typeof value === 'boolean')return {breakable:value};
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  const bool = assistantParseBool(s);
  if(bool != null)return {breakable:bool};
  if(/\b(?:unbreakable|one session|don'?t split|do not split|no split)\b/.test(s)){
    return {breakable:false};
  }
  if(/\b(?:split|breakable|chunks?)\b/.test(s)){
    const mins = typeof assistantParseDuration === 'function' ? assistantParseDuration(s) : null;
    return mins != null ? {breakable:true, minChunkMinutes:mins} : {breakable:true};
  }
  return null;
}

function assistantParseAutoMark(value){
  if(value == null || value === '')return undefined;
  if(typeof value === 'number' && Number.isFinite(value)){
    return typeof normalizeAutoMark === 'function' ? normalizeAutoMark(value) : Math.max(0, Math.round(value));
  }
  const s = assistantNormText(value);
  if(/^(manual|off|none|blank)$/.test(s))return null;
  if(typeof normalizeAutoMark === 'function')return normalizeAutoMark(s);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function assistantParseFlexDays(value){
  if(value == null || value === '')return null;
  if(typeof value === 'number' && Number.isFinite(value)){
    return Math.max(0, Math.min(60, Math.round(value)));
  }
  const s = assistantNormText(value);
  if(/^(none|off|no)$/.test(s))return 0;
  const n = typeof assistantParseCount === 'function' ? assistantParseCount(s, 0, 60) : parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : null;
}

function assistantParseSnoozeUntil(value, now){
  if(value == null || value === '')return undefined;
  const ts = now != null ? Number(now) : Date.now();
  if(typeof value === 'number' && Number.isFinite(value) && value > 1e11)return Math.round(value);
  const s = assistantNormText(value);
  if(/^(off|none|clear|show|unsnooze)$/.test(s))return null;
  if(/\buntil (?:the )?end of (?:the )?day\b|\beod\b/.test(s)){
    const start = typeof dayStart === 'function' ? dayStart(ts) : ts;
    return start + 86400000;
  }
  const hours = s.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/) || s.match(/\b(?:for )?(\d+)\s*hours?\b/);
  if(hours){
    const n = Math.min(72, Math.max(1, Math.round(Number(hours[1]))));
    return ts + n * 3600000;
  }
  const days = s.match(/\b(\d+)\s*d(?:ays?)?\b/) || s.match(/\b(?:for )?(\d+)\s*days?\b/);
  if(days){
    const n = Math.min(60, Math.max(1, Number(days[1])));
    return ts + n * 86400000;
  }
  if(/\buntil tomorrow\b|\btomorrow\b/.test(s)){
    const start = typeof dayStart === 'function' ? dayStart(ts) : ts;
    return start + 86400000;
  }
  const due = typeof assistantParseDue === 'function' ? assistantParseDue(s, ts) : null;
  if(due != null)return due;
  return undefined;
}

function assistantParseLinkText(value){
  const raw = String(value || '').trim();
  if(!raw)return null;
  const s = assistantNormText(raw);
  if(/^(none|off|clear)$/.test(s))return {clear:true};
  if(/^(tel:|sms:)/i.test(raw) || /\bcall\b/.test(s) || /^\+?\d[\d\s().-]{3,}$/.test(raw)){
    return {kind:'phone', value:raw.replace(/^(?:call|phone|tel:)\s*/i, '')};
  }
  if(/\bwhatsapp\b/.test(s) || /wa\.me/i.test(raw))return {kind:'whatsapp', value:raw};
  if(/\bfacetime\b/.test(s))return {kind:'facetime', value:raw};
  if(/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)){
    return {kind:'app', value:raw};
  }
  return {kind:'link', value:raw};
}

function assistantParseLinksArg(value){
  if(value == null || value === '')return null;
  if(typeof value === 'string' && /^(none|off|clear)$/i.test(value.trim()))return [];
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  for(const item of items){
    if(item && typeof item === 'object' && item.value){
      out.push(item);
      continue;
    }
    const parsed = assistantParseLinkText(item);
    if(!parsed)continue;
    if(parsed.clear)return [];
    out.push(parsed);
  }
  const normalized = typeof normalizeLinks === 'function' ? normalizeLinks(out) : out;
  if(!normalized.length && out.length)return null;
  return normalized;
}

function assistantParseOrderModifiers(text){
  const s = assistantNormText(text);
  return {
    adjacency:/\b(?:right|direct(?:ly)?|immediately|straight)\b/.test(s) ? 'direct' : 'sometime',
    requireSameDay:/\bsame day\b/.test(s)
  };
}

function assistantParseOrderName(text){
  let s = assistantNormText(text);
  s = s.replace(/^(?:it |this |that )?(?:should |must |needs to )?(?:go |be |sit |come )?/, '');
  s = s.replace(/\b(?:right|directly|immediately|straight)\s+/g, '');
  s = s.replace(/\b(?:same day|on the same day)\b/g, '');
  s = s.replace(/^(?:after|before)\s+/, '');
  s = s.replace(/[.,].*$/, '');
  s = s.replace(/\s+\b(?:the|a|an)\b\s*$/, '');
  s = s.replace(/^(?:the|a|an)\s+/, '');
  s = s.replace(/\s+/g, ' ').trim();
  if(!s || /^(none|off|clear|it|this|that)$/.test(s))return null;
  return s.slice(0, ASSISTANT_NAME_MAX);
}

function assistantParseOrderText(value){
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  if(/^(none|off|clear)$/.test(s))return {clear:true};
  const mods = assistantParseOrderModifiers(s);
  const direction = /\bbefore\b/.test(s) ? 'before' : (/\bafter\b/.test(s) ? 'after' : null);
  const name = assistantParseOrderName(s);
  if(!direction || !name)return {modifiers:mods};
  return {links:[{name, direction, adjacency:mods.adjacency, requireSameDay:mods.requireSameDay}]};
}

function assistantParsePlacePrefsText(value){
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  if(/^(none|off|clear)$/.test(s))return [];
  const parts = String(value).split(/[,;]|\band\b/i);
  const out = [];
  for(const part of parts){
    const chunk = String(part || '').trim();
    if(!chunk)continue;
    const norm = assistantNormText(chunk);
    const level = /\bavoid\b/.test(norm) ? 'avoid'
      : (/\bhigh|prefer(?:red)?|favourite|favorite\b/.test(norm) ? 'high'
        : (/\blittle|low\b/.test(norm) ? 'little' : 'high'));
    const name = chunk.replace(/\b(?:avoid|high|prefer(?:red)?|favourite|favorite|little|low)\b/ig, '').trim();
    if(name)out.push({name, level});
  }
  return out.length ? out : null;
}

function assistantWindowToOptionTimes(window){
  if(!window || typeof window !== 'object')return null;
  const start = window.start || {};
  const end = window.end || {};
  const out = {};
  if(start.kind === 'clock')out.start = start.minutes;
  else if(start.kind === 'anchor'){
    out.startAnchor = start.anchor;
    out.startOffsetMin = start.offsetMin || 0;
  }else return null;
  if(end.kind === 'clock')out.end = end.minutes;
  else if(end.kind === 'anchor'){
    out.endAnchor = end.anchor;
    out.endOffsetMin = end.offsetMin || 0;
  }else if(start.kind === 'clock'){
    out.end = Math.min(1439, start.minutes + 60);
  }else return null;
  return out;
}

function assistantParseScheduleOptionText(value, catalog){
  if(value == null || value === '')return null;
  const s = assistantNormText(value);
  if(/^(none|off|clear)$/.test(s))return {clear:true};
  const window = typeof assistantParseWindowFromText === 'function' ? assistantParseWindowFromText(s) : null;
  const times = assistantWindowToOptionTimes(window);
  if(!times)return null;
  const weekdays = typeof assistantNormalizeWeekdaysArg === 'function' ? assistantNormalizeWeekdaysArg(s) : [];
  const places = typeof assistantMatchCatalogNames === 'function'
    ? assistantMatchCatalogNames((catalog && catalog.places) || [], s)
    : [];
  const anywhere = /\banywhere\b/.test(s);
  const pref = /\bavoid\b/.test(s) ? 'avoid'
    : (/\bhigh|prefer\b/.test(s) ? 'high'
      : (/\blittle\b/.test(s) ? 'little' : null));
  const option = {
    weekdays:Array.isArray(weekdays) ? weekdays : [],
    locationId:anywhere ? null : (places[0] && places[0].id) || null,
    sameDayMode:/\bseparate\b/.test(s) ? 'separate' : 'alternative',
    weatherProfileMode:'inherit',
    weatherProfileId:null,
    ...times
  };
  if(pref)option.pref = pref;
  return {option};
}

function assistantParseRhythm(text){
  const s = assistantNormText(text);
  if(!s)return null;
  let timesPerPeriod = null;
  let periodDays = null;
  if(/\bevery other day\b/.test(s)){
    timesPerPeriod = 1;
    periodDays = 2;
  }else if(/\bevery day\b|\beach day\b|\bdaily\b|\bevery morning\b|\bevery night\b|\bevery evening\b/.test(s)){
    timesPerPeriod = 1;
    periodDays = 1;
  }else{
    const inPeriod = s.match(new RegExp(`\\b(${ASSISTANT_COUNT_WORD}|\\d+)\\s*(?:x|times?)\\s+(?:in|every|per)\\s+(${ASSISTANT_COUNT_WORD}|\\d+)\\s+days?\\b`));
    if(inPeriod){
      timesPerPeriod = assistantParseCount(inPeriod[1], 1, 30);
      periodDays = assistantParseCount(inPeriod[2], 1, 183);
    }else{
      const short = s.match(/\b(once|twice|thrice)\s+(?:a\s+|per\s+|each\s+)?(week|day)s?\b/);
      if(short){
        timesPerPeriod = assistantParseCount(short[1], 1, 30);
        periodDays = short[2] === 'day' ? 1 : 7;
      }else{
        const times = s.match(new RegExp(`\\b(${ASSISTANT_COUNT_WORD}|\\d+)\\s*(?:x|times?)\\s+(?:a\\s+|per\\s+|each\\s+|every\\s+)(week|day)s?\\b`));
        if(times){
          timesPerPeriod = assistantParseCount(times[1], 1, 30);
          periodDays = times[2] === 'day' ? 1 : 7;
        }else{
          const everyN = s.match(new RegExp(`\\bevery\\s+(${ASSISTANT_COUNT_WORD}|\\d+)\\s+days?\\b`));
          if(everyN){
            timesPerPeriod = 1;
            periodDays = assistantParseCount(everyN[1], 1, 183);
          }else if(/\bonce a week\b|\bevery week\b|\bweekly\b/.test(s)){
            timesPerPeriod = 1;
            periodDays = 7;
          }
        }
      }
    }
  }
  const weekdays = assistantParseWeekdaySchedule(s);
  if(timesPerPeriod == null && periodDays == null && !weekdays)return null;
  const out = {};
  if(weekdays){
    out.weekdays = weekdays;
    if(timesPerPeriod == null){
      const weekendOnce = weekdays.length === 2 && weekdays[0] === 0 && weekdays[1] === 6 && /\bweekend/.test(s);
      timesPerPeriod = weekendOnce ? 1 : weekdays.length;
    }
    if(periodDays == null)periodDays = 7;
  }
  if(timesPerPeriod != null)out.timesPerPeriod = timesPerPeriod;
  if(periodDays != null)out.periodDays = periodDays;
  return out;
}

function assistantUpcomingWeekday(want, now, skipToday){
  const base = assistantDayBase(now);
  const cur = new Date(base).getDay();
  let delta = want - cur;
  if(skipToday){
    if(delta <= 0)delta += 7;
  }else if(delta < 0){
    delta += 7;
  }
  return base + delta * 86400000;
}

function assistantParseDue(value, now){
  const ts = now != null ? Number(now) : Date.now();
  const base = assistantDayBase(ts);
  const s = assistantNormText(value);
  if(!s)return null;
  if(s === 'today' || s === 'tonight' || s === 'this evening' || s === 'this afternoon' || s === 'this morning')return base;
  if(s === 'tomorrow' || s === 'tommorow' || s === 'tmrw')return base + 86400000;
  if(s === 'day after tomorrow' || s === 'day after tommorow' || s === 'day after tmrw')return base + 2 * 86400000;
  if(s === 'next week')return base + 7 * 86400000;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const parsed = new Date(`${s}T00:00:00`).getTime();
    return Number.isFinite(parsed) ? assistantDayBase(parsed) : null;
  }
  const md = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if(md){
    const month = Number(md[1]) - 1;
    const day = Number(md[2]);
    let year = md[3] ? Number(md[3]) : new Date(base).getFullYear();
    if(year < 100)year += 2000;
    const parsed = new Date(year, month, day).getTime();
    if(Number.isFinite(parsed) && month >= 0 && month <= 11 && day >= 1 && day <= 31)return assistantDayBase(parsed);
  }
  const named = s.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if(named){
    const month = ASSISTANT_MONTH_NAMES[named[1]];
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : new Date(base).getFullYear();
    if(month != null)return assistantDayBase(new Date(year, month, day).getTime());
  }
  const nextDay = s.match(/^next\s+(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)$/);
  if(nextDay){
    const want = ASSISTANT_WEEKDAY_NAMES[nextDay[1]];
    if(want != null)return assistantUpcomingWeekday(want, ts, true);
  }
  const day = s.match(/^(?:this\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)$/);
  if(day){
    const want = ASSISTANT_WEEKDAY_NAMES[day[1]];
    if(want != null)return assistantUpcomingWeekday(want, ts, false);
  }
  return null;
}

function assistantLevenshtein(a, b){
  const s = String(a || '');
  const t = String(b || '');
  if(s === t)return 0;
  if(!s.length)return t.length;
  if(!t.length)return s.length;
  const rows = Array.from({length:t.length + 1}, (_, i) => i);
  for(let i = 1; i <= s.length; i += 1){
    let prev = i - 1;
    rows[0] = i;
    for(let j = 1; j <= t.length; j += 1){
      const cur = rows[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return rows[t.length];
}

function assistantFuzzyLimit(len){
  if(len >= 8)return 2;
  if(len >= 4)return 1;
  return 0;
}

function assistantStripNameJunk(text){
  let s = assistantNormText(text);
  s = s.replace(/^(?:please |can you |could you |hey |ok |okay )+/g, '');
  s = s.replace(/^(?:remind me(?: to)?|don't forget(?: to)?|dont forget(?: to)?|remember to|i (?:need|have|gotta|got)(?: to)?|i should|i want to|i wanna)\s+/g, '');
  s = s.replace(/\b(?:day after )?(?:today|tomorrow|tommorow|tmrw|tonight|this (?:morning|afternoon|evening)|next week)\b/g, ' ');
  s = s.replace(/\bin\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)\s+(?:day|week)s?\b/g, ' ');
  s = s.replace(/\b(?:next )?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/g, ' ');
  s = s.replace(/\b(?:after|before|at|around)\s+(?:sunset|sunrise|fajr|dhuhr|zuhr|asr|maghrib|isha|noon|dawn)\b/g, ' ');
  s = s.replace(/\b(?:at|around|by|after|before)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g, ' ');
  s = s.replace(/\bbetween\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g, ' ');
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  s = s.replace(/\bon\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, ' ');
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:minutes?|mins?|m|hours?|hrs?|h)\b/g, ' ');
  s = s.replace(/\b(?:half an hour|an hour|hour and a half)\b/g, ' ');
  s = s.replace(/^(?:add:?|create|make|new(?: task| habit)?)\s+(?:a |an |the )?/g, '');
  s = s.replace(/\b(?:every day|daily|weekly|every morning|every night|once a week|twice a week|thrice a week|(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+times? (?:a|in|every|per) (?:week|day)s?|\d+\s*x a (?:week|day)|every other day|every (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) days?|every weekend|weekends?|weekdays?|to be done)\b/g, ' ');
  s = s.replace(/\bonly if\b[\s\S]*$/g, ' ');
  s = s.replace(/\band if it(?:'s| is) not\b[\s\S]*$/g, ' ');
  s = s.replace(/\bif it(?:'s| is) not\b[\s\S]*$/g, ' ');
  s = s.replace(/\b(?:at|using)\s+[a-z][a-z0-9]+(?:\s+[a-z]+)?(?:\s+weather)?\b/g, ' ');
  s = s.replace(/\b(?:urgent|someday|asap|please|thanks|thank you|for me)\b/g, ' ');
  s = s.replace(/\b(?:habit|task) (?:called|named)\b/g, ' ');
  s = s.replace(/\bfor\b/g, ' ');
  s = s.replace(/[?.!,]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function assistantCutNameTail(text){
  const s = assistantNormText(text);
  const cut = s.search(/\b(?:to be done|only if|if it(?:'s| is) not|if it(?:'s| is)|using\b|every\b|twice\b|thrice\b|(?:once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten)\s+times?\b|\d+\s*x\b|\d+\s+times?\b|day after\b|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:days?|weeks?)\b|after\b|before\b|between\b|tomorrow\b|today\b|tonight\b|this (?:morning|afternoon|evening)|next\b|at \d|for \d|in (?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|urgent\b|someday\b|and only)\b/);
  if(cut > 2)return s.slice(0, cut).trim();
  return s;
}

function assistantParseWeatherHints(text){
  const s = assistantNormText(text);
  const notRaining = /\b(?:not raining|no rain|isn'?t raining|if it(?:'s| is) not raining|only if(?: it(?:'s| is))? (?:dry|not raining)|unless(?: it(?:'s| is))? raining|skip(?: the)? rain)\b/.test(s);
  const notFreezing = /\b(?:not freezing|above freezing|if it(?:'s| is) not freezing|isn'?t freezing|no freeze|not too cold)\b/.test(s);
  const notSnowing = /\b(?:not snowing|no snow)\b/.test(s);
  const dryNamed = /\b(?:dry weather|using dry)\b/.test(s);
  const notWindy = /\b(?:not too windy|skip wind|calm(?: wind)?|no (?:strong )?wind)\b/.test(s);
  return {
    mentioned:notRaining || notFreezing || notSnowing || dryNamed || notWindy,
    notRaining:notRaining || dryNamed,
    notFreezing,
    notSnowing,
    notWindy
  };
}

function assistantTitleName(value, max){
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if(!raw)return '';
  const cap = max != null ? max : 32;
  if(/^[A-Z0-9]{2,8}$/.test(raw))return raw.slice(0, cap);
  return raw.replace(/\b([a-z])/g, ch => ch.toUpperCase()).slice(0, cap);
}

function assistantWeatherStoreValue(metric, n, unitRaw){
  const unit = assistantNormText(unitRaw).replace(/[°\s]/g, '');
  if(metric === 'temperature_2m' || metric === 'apparent_temperature'){
    if(unit === 'f' || unit === 'fahrenheit')return (n - 32) * 5 / 9;
    if(unit === 'c' || unit === 'celsius' || unit === 'deg' || unit === 'degree' || unit === 'degrees')return n;
  }
  if((metric === 'wind_speed_10m' || metric === 'wind_gusts_10m') && unit === 'mph'){
    return n / 0.621371;
  }
  if((metric === 'precipitation' || metric === 'snowfall') && (unit === 'in' || unit === 'inch' || unit === 'inches')){
    return metric === 'snowfall' ? n * 2.54 : n * 25.4;
  }
  return typeof weatherMetricValueToStored === 'function' ? weatherMetricValueToStored(metric, n) : n;
}

function assistantPushWeatherRule(rules, metric, patch){
  const i = rules.findIndex(rule => rule && rule.metric === metric);
  const next = i >= 0
    ? Object.assign({}, rules[i])
    : {metric, min:null, max:null, hard:false, relative:'none'};
  next.metric = metric;
  const extra = patch && typeof patch === 'object' ? patch : {};
  if(extra.min != null)next.min = extra.min;
  if(extra.max != null)next.max = extra.max;
  if(extra.relative === 'high' || extra.relative === 'low')next.relative = extra.relative;
  else if(extra.relativeExplicit)next.relative = extra.relative === 'high' || extra.relative === 'low' ? extra.relative : 'none';
  if(typeof extra.hard === 'boolean' && (extra.min != null || extra.max != null || extra.hard === true)){
    next.hard = extra.hard;
  }
  if(i >= 0)rules[i] = next;
  else rules.push(next);
}

function assistantParseWeatherRelativeFromText(s, rules){
  const t = String(s || '');
  const tempHigh = /\bprefer(?:s|ring)? (?:higher|warm|hot|warmer|hotter)\b/.test(t)
    || /\b(?:higher|warmer|hotter) (?:temp(?:erature)?|temps)\b/.test(t)
    || /\btemp(?:erature)?.{0,48}(?:preference )?(?:towards |to )?(?:higher|warmer|hotter)\b/.test(t)
    || /\b(?:towards |to )(?:higher|warmer|hotter).{0,24}temp/.test(t)
    || /\bpreference towards (?:higher|warmer|hotter)\b/.test(t)
    || /\b(?:temp(?:erature)?|feels like)[^\n.]{0,48}prefer(?:ring)? higher\b/.test(t)
    || (/\bprefer(?:s|ring)? higher\b/.test(t) && !/\b(?:rain|wind|gust)\b/.test(t));
  const tempLow = /\bprefer(?:s|ring)? (?:lower|cool|cold|cooler|colder)\b/.test(t)
    || /\b(?:lower|cooler|colder) (?:temp(?:erature)?|temps)\b/.test(t)
    || /\btemp(?:erature)?.{0,48}(?:preference )?(?:towards |to )?(?:lower|cooler|colder)\b/.test(t)
    || /\bpreference towards (?:lower|cooler|colder)\b/.test(t)
    || /\b(?:temp(?:erature)?|feels like)[^\n.]{0,48}prefer(?:ring)? lower\b/.test(t);
  if(tempHigh)assistantPushWeatherRule(rules, 'temperature_2m', {relative:'high'});
  else if(tempLow)assistantPushWeatherRule(rules, 'temperature_2m', {relative:'low'});
  if(/\bprefer(?:s|ring)? (?:dry|drier|lower rain)\b/.test(t)
    || /\brain[^\n.]{0,32}prefer(?:ring)? lower\b/.test(t)
    || /\bprefer(?:ring)? lower[^\n.]{0,24}rain\b/.test(t)){
    assistantPushWeatherRule(rules, 'precipitation_probability', {relative:'low'});
  }
  if(/\bprefer(?:s|ring)? (?:calm|calmer|lower wind)\b/.test(t)
    || /\bwind[^\n.]{0,32}prefer(?:ring)? lower\b/.test(t)){
    assistantPushWeatherRule(rules, 'wind_speed_10m', {relative:'low'});
  }
}

function assistantParseWeatherRulesFromText(text){
  const s = assistantNormText(text);
  const hints = assistantParseWeatherHints(s);
  const rules = [];
  if(hints.notWindy)assistantPushWeatherRule(rules, 'wind_speed_10m', {max:20, relative:'low', hard:false});
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const unit = '(?:\\s*(°?\\s*c|°?\\s*f|celsius|fahrenheit|degrees?|km\\/?h|kmh|mph|%|mm|cm|in(?:ches)?)?)';
  const take = (re, metric, which, hard) => {
    const match = s.match(re);
    if(!match)return;
    const n = Number(match[1]);
    if(!Number.isFinite(n))return;
    const stored = assistantWeatherStoreValue(metric, n, match[2]);
    const patch = {hard:hard !== false};
    patch[which] = stored;
    assistantPushWeatherRule(rules, metric, patch);
  };
  take(new RegExp('\\b(?:wind(?: speed)?|gusts?)\\s*(?:≤|<=|<|under|below|max(?:imum)?|less than|at most)\\s*' + num + unit), /gust/.test(s) ? 'wind_gusts_10m' : 'wind_speed_10m', 'max');
  take(new RegExp('\\brain chance\\s*(?:≤|<=|<|under|below|max(?:imum)?|less than|at most)\\s*' + num), 'precipitation_probability', 'max');
  take(new RegExp('\\b(?:temp(?:erature)?|feels like)\\s*(?:≥|>=|>|above|over|at least|min(?:imum)?)\\s*' + num + unit), 'temperature_2m', 'min');
  take(new RegExp('\\b(?:temp(?:erature)?|feels like)\\s*(?:≤|<=|<|below|under|at most|max(?:imum)?)\\s*' + num + unit), 'temperature_2m', 'max');
  if(!/\bfreezing\b/.test(s)){
    take(new RegExp('\\b(?:above|over|at least|min(?:imum)?)\\s+' + num + '\\s*(°?\\s*c|°?\\s*f|celsius|fahrenheit|degrees?)'), 'temperature_2m', 'min');
    take(new RegExp('\\b(?:below|under|at most|max(?:imum)?)\\s+' + num + '\\s*(°?\\s*c|°?\\s*f|celsius|fahrenheit|degrees?)'), 'temperature_2m', 'max');
  }
  assistantParseWeatherRelativeFromText(s, rules);
  return {hints, rules, mentioned:hints.mentioned || rules.length > 0};
}

function assistantParseSettingCreate(text){
  const s = assistantNormText(text);
  if(!s)return null;
  if(/\b(?:habit|task|remind me)\b/.test(s))return null;
  const cutName = blob => {
    let name = String(blob || '').replace(/^(?:called|named|for|to)\s+/, '');
    name = name.split(/\b(?:only if|not raining|skip rain|wind |temp(?:erature)? |above |below |with |from |between |every )\b/)[0];
    name = typeof assistantStripNameJunk === 'function'
      ? assistantStripNameJunk(typeof assistantCutNameTail === 'function' ? assistantCutNameTail(name) : name)
      : name.trim();
    return name;
  };
  if(/\bweather profile\b/.test(s) && /\b(?:create|add|make|new)\b/.test(s)){
    const m = s.match(/\bweather profile\s+(?:called|named|for|to)\s+(.+)$/)
      || s.match(/\b(?:create|add|make|new)\s+(?:a |an |the )?weather profile\s+(.+)$/);
    const name = cutName(m && m[1]) || 'Outdoor';
    return {kind:'weather', name:assistantTitleName(name, 32)};
  }
  if(/\b(?:busy time|blocked time)\b/.test(s) && /\b(?:create|add|make|new)\b/.test(s)){
    const m = s.match(/\b(?:busy time|blocked time)\s+(?:called|named|for)\s+(.+)$/)
      || s.match(/\b(?:create|add|make|new)\s+(?:a |an |the )?(?:busy time|blocked time)\s+(.+)$/);
    const name = cutName(m && m[1]) || 'Busy';
    return {kind:'busy', name:assistantTitleName(name, 24)};
  }
  if(/\b(?:create|add|make|new)\s+(?:a |an |the )?topics?\b/.test(s)
    && !/\b(?:habit|task|location|place|weather|window|duration|priority|emoji)\b/.test(s)){
    const m = s.match(/\btopics?\s+(?:called|named|for)?\s*(.+)$/);
    const name = cutName(m && m[1]);
    if(!name)return null;
    return {kind:'topic', name:assistantTitleName(name, 32)};
  }
  if(/\b(?:create|make)\s+(?:a |an |the )?(?:new )?(?:location|place)\b/.test(s)
    || /\badd\s+(?:a |an )?(?:new )(?:location|place)\b/.test(s)
    || /\badd\s+(?:a |an )?(?:location|place)\s+(?:called|named)\b/.test(s)
    || /\bnew (?:location|place)\b/.test(s)){
    const named = s.match(/\b(?:called|named)\s+(.+?)(?:\s+(?:at|address)\s+(.+))?$/);
    const at = s.match(/\b(?:location|place)\s+(.+?)\s+at\s+(.+)$/);
    let name = '';
    let address = '';
    if(named){
      name = cutName(named[1]);
      address = String(named[2] || '').trim();
    }else if(at){
      name = cutName(at[1]);
      address = String(at[2] || '').trim();
    }else{
      const m = s.match(/\b(?:location|place)\s+(.+)$/);
      name = cutName(m && m[1]) || 'Place';
    }
    if(!name)name = 'Place';
    return {kind:'location', name:assistantTitleName(name, 48), address:address.slice(0, 120)};
  }
  return null;
}

function assistantGuessItemName(text){
  const raw = assistantNormText(text).replace(/^(?:please |can you |could you |hey |ok |okay )+/g, '').replace(/[?.!]+$/g, '');
  const patterns = [
    /^(?:i(?:'ve| have)? (?:already )?(?:did|done|finished|logged)|mark(?:ed)?|check(?:ed)? off|log)\s+(?:the )?(.+?)(?:\s+(?:as )?(?:done|complete|finished))?$/,
    /^(?:i already did|already did|done with|finished)\s+(?:the )?(.+)$/,
    /^(?:when am i supposed to|when should i|when (?:do|did|will) i(?: last)?|when is|when's|where's|where is|did i (?:do|finish)|do i have|is there)\s+(?:the )?(.+?)(?:\s+(?:next|last|today|again))?$/,
    /^(?:remind me to|don't forget to|dont forget to|remember to|i (?:need|have|gotta|got)(?: to)?|i should|i want to|i wanna|add:?|create|make)\s+(?:a |an |the )?(.+)$/,
    /^(?:new )?(?:task|habit|ting|item):\s*(.+)$/,
    /(?:habit|task) (?:called |named )(.+)$/
  ];
  for(const re of patterns){
    const match = raw.match(re);
    if(!match)continue;
    const cleaned = assistantStripNameJunk(assistantCutNameTail(match[1]));
    if(cleaned && cleaned.length >= 2 && cleaned.length <= ASSISTANT_NAME_MAX)return cleaned;
  }
  return null;
}

const ASSISTANT_ANCHOR_WORD = 'sunset|sunrise|dawn|fajr|dhuhr|zuhr|noon|asr|maghrib|maghreb|isha|dusk';

function assistantIsPronounName(name){
  return /^(it|this|that|this one|that one|the one|the habit|the task|the ting|the item)(?:\s+to)?$/.test(assistantNormText(name));
}

function assistantNamesMatch(a, b){
  const na = assistantNormText(a);
  const nb = assistantNormText(b);
  if(!na || !nb)return false;
  if(na === nb)return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if(short.length >= 4 && long.includes(short) && (short.length >= 8 || short.length >= long.length - 2))return true;
  if(typeof assistantLevenshtein !== 'function')return false;
  const limit = Math.max(
    typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(na.length) : 0,
    typeof assistantFuzzyLimit === 'function' ? assistantFuzzyLimit(nb.length) : 0
  );
  return limit > 0 && assistantLevenshtein(na, nb) <= limit;
}

// Direct-object setting patches: "add the location home", "the place is …",
// "keep it at home". These are edits even when phrased with a create verb,
// unlike descriptive weather/place clauses inside a create request.
function assistantLooksLikeSettingObjectPatch(text){
  const s = assistantNormText(text);
  if(!s)return false;
  if(/\b(?:add(?:ing)?|set|use|put)\s+(?:the\s+|its\s+|a\s+)?(?:location|place|venue|window|weather|duration|priority|topics?|emoji)\b/.test(s))return true;
  if(/^(?:the\s+)?(?:location|place|venue)\s+(?:is\s+|to\s+|at\s+)?\S/.test(s))return true;
  if(/\b(?:make it|keep it|have it|do it)\s+(?:at|from)\b/.test(s))return true;
  return false;
}

function assistantLooksLikeSettingFollowup(text){
  const s = assistantNormText(text);
  if(!s)return false;
  if(assistantLooksLikeSettingObjectPatch(s))return true;
  if(/\b(?:change|update|edit|make|set|prefer)\b/.test(s)
    && /\b(?:weather|temperature|wind|rain chance|prefer (?:higher|lower|warm|hot|cool|cold))\b/.test(s)){
    return true;
  }
  return false;
}

function assistantParseLocationClause(text){
  const s = assistantNormText(text);
  if(!s)return null;
  const match = s.match(/\b(?:add(?:ing)?|set|use|put)\s+(?:the\s+|its\s+|a\s+)?(?:location|place|venue)\s+(?:to\s+|as\s+|at\s+)?(.+)$/)
    || s.match(/^(?:the\s+)?(?:location|place|venue)\s+(?:is\s+|to\s+|at\s+)?(.+)$/);
  if(!match)return null;
  let ref = String(match[1] || '').trim();
  ref = ref.replace(/^(?:to|as|at|the)\s+/i, '');
  ref = ref.replace(/\s+(?:on|for|to)\s+(?:it|this|that|the (?:habit|task|item|ting))\s*$/i, '');
  ref = ref.replace(/[?.!,;:]+$/g, '').trim();
  if(!ref || /^(?:it|this|that)$/i.test(ref))return null;
  return ref;
}

function assistantMatchPlacesFromRef(places, ref){
  const want = assistantNormText(ref);
  if(!want)return [];
  const list = places || [];
  if(typeof assistantMatchByName === 'function'){
    const match = assistantMatchByName(list, ref);
    if(match && match.ok && match.item)return [match.item];
  }
  const exact = list.filter(item => assistantNormText(item && item.name) === want);
  if(exact.length === 1)return exact;
  const part = list.filter(item => {
    const name = assistantNormText(item && item.name);
    return name && (name.includes(want) || want.includes(name));
  });
  if(part.length === 1)return part;
  return typeof assistantMatchCatalogNames === 'function' ? assistantMatchCatalogNames(list, ref) : [];
}

function assistantLooksLikeEdit(text){
  const s = assistantNormText(text);
  if(!s)return false;
  // Direct-object setting patches stay edits even with a create verb:
  // "Add the location home." patches currentDraft, it does not add a task.
  if(assistantLooksLikeSettingObjectPatch(s))return true;
  // Create phrasing is never an edit, even when it names weather or a place
  // ("Add a Stretch at Home, prefer Home high, using Dry weather"). The
  // prefer+weather patch rule below is for follow-ups on an existing draft.
  if(/\b(?:remind me|don't forget|dont forget|add:?|create |new task|new habit)\b/.test(s)
    && !/\b(?:make it|change it|update it|rename it|add \d)/.test(s)){
    return false;
  }
  return assistantLooksLikeSettingFollowup(s)
    || /\b(?:change|update|edit|rename)\b/.test(s)
    || /\bmake it\b/.test(s)
    || /\bset (?:the |its |it )/.test(s)
    || /\b(?:put it|keep it|have it)\b/.test(s)
    || /\b(?:make|set) (?:the )?(?:window|duration|time|place|weather)\b/.test(s)
    || /\ballowed(?: to be)? (?:between|from|after|before|till|until)\b/.test(s)
    || /\b(?:to be )?allowed between\b/.test(s)
    || /\bonly between\b/.test(s)
    || (/\b(?:also|instead|actually)\b/.test(s) && /\b(?:it|window|weather|place|minutes?|hours?)\b/.test(s));
}

function assistantParseRename(text){
  const s = assistantNormText(text);
  const match = s.match(/\brename (?:it|this|that|this one)(?: to)?\s+(.+)$/)
    || s.match(/\b(?:change|update) (?:the )?name to\s+(.+)$/);
  if(!match)return null;
  const name = assistantStripNameJunk(assistantCutNameTail(match[1]));
  if(!name || name.length < 2 || assistantIsPronounName(name))return null;
  return name.slice(0, ASSISTANT_NAME_MAX);
}

function assistantGuessEditTarget(text){
  const s = assistantNormText(text).replace(/^(?:please |can you |could you )+/, '');
  let body = null;
  const change = s.match(/^(?:change|update|edit)\s+(?:the )?(?:habit |task |ting |item )?(.+)$/);
  if(change){
    body = change[1];
    body = body.replace(/\s+(?:to be allowed|to be|so it|so that|into)\b[\s\S]*$/, '');
    body = body.replace(new RegExp(`\\s+to\\s+(?:every|on |only |just |weekdays?|weekends?|\\d+|a |an |half |after|before|between|allowed|tomorrow|today|tonight|next |p\\d|urgent|someday|once|twice|thrice|${ASSISTANT_COUNT_WORD}|(?:${ASSISTANT_WEEKDAY_TOKEN}))\\b[\\s\\S]*$`), '');
    body = body.replace(/\s+to$/, '');
    body = assistantCutNameTail(body);
  }else{
    const make = s.match(/^(?:make)\s+(?:the )?(?:habit |task |ting |item )?(.+?)\s+(?:\d|a |an |half |after|before|between|allowed|at |urgent|someday|p\d)/);
    if(make)body = make[1];
  }
  const cleaned = assistantStripNameJunk(body);
  if(!cleaned || cleaned.length < 2 || assistantIsPronounName(cleaned))return null;
  return cleaned.slice(0, ASSISTANT_NAME_MAX);
}

function assistantHasPatchFields(parsed, draft){
  if(!parsed)return false;
  if(parsed.window || parsed.rhythm || parsed.newName)return true;
  if(parsed.durationMinutes != null || parsed.priority != null)return true;
  if(parsed.places && parsed.places.length)return true;
  if(parsed.weather || (parsed.weatherHints && parsed.weatherHints.mentioned))return true;
  if(parsed.habitKind || parsed.emoji != null || parsed.topics || parsed.monthDays)return true;
  if(parsed.breakable != null || parsed.pinned != null || parsed.hardDue != null)return true;
  if(parsed.earlyWindowDays != null || parsed.delayAllowanceDays != null)return true;
  if(parsed.due || parsed.dueTime)return !draft || draft.kind === 'task';
  return false;
}

function assistantMentionsFocus(text, parsed, draft){
  const s = assistantNormText(text).replace(/\bthis (?:morning|afternoon|evening)\b/g, ' ');
  if(/\bit\b/.test(s) || /\bthis one\b/.test(s) || /\bthe (?:habit|task|ting|item)\b/.test(s))return true;
  if(/\b(?:this|that)\b/.test(s) && assistantLooksLikeEdit(s))return true;
  if(parsed && parsed.itemName && draft && draft.name && assistantNormText(parsed.itemName) === assistantNormText(draft.name))return true;
  if(draft && draft.name && s.includes(assistantNormText(draft.name)))return true;
  return false;
}

function assistantIsNewCreate(parsed, draft){
  if(parsed && parsed.intent === 'create_setting'){
    if(assistantLooksLikeSettingFollowup(parsed.text) && draft && typeof assistantIsItemKind === 'function' && assistantIsItemKind(draft.kind))return false;
    return true;
  }
  if(!parsed || (parsed.intent !== 'create_task' && parsed.intent !== 'create_habit'))return false;
  if(assistantLooksLikeSettingFollowup(parsed.text))return false;
  if(!parsed.itemName || assistantIsPronounName(parsed.itemName))return false;
  if(assistantLooksLikeEdit(parsed.text))return false;
  if(!draft || !draft.name)return true;
  return assistantNormText(parsed.itemName) !== assistantNormText(draft.name);
}

function assistantIsFollowupOnFocus(text, parsed, draft){
  if(!draft || !draft.name || !parsed)return false;
  if(parsed.intent === 'ask_today' && parsed.confident)return false;
  if(parsed.intent === 'unsupported' && parsed.confident)return false;
  if(assistantLooksLikeSettingFollowup(text))return true;
  if(assistantIsNewCreate(parsed, draft))return false;
  const named = parsed.itemName && !assistantIsPronounName(parsed.itemName) ? parsed.itemName : null;
  const sameName = named && assistantNamesMatch(named, draft.name);
  if(parsed.intent === 'complete_item' || parsed.intent === 'lookup_item'){
    return assistantMentionsFocus(text, parsed, draft) && (!named || sameName);
  }
  if(named && !sameName && parsed.intent === 'edit_item' && !assistantMentionsFocus(text, parsed, draft)){
    return false;
  }
  if(parsed.intent === 'edit_item')return true;
  if(assistantLooksLikeEdit(text) || assistantMentionsFocus(text, parsed, draft)){
    return assistantHasPatchFields(parsed) || assistantLooksLikeEdit(text);
  }
  if(assistantHasPatchFields(parsed) && !parsed.itemName && !parsed.confident)return true;
  return false;
}

function assistantParseOffsetMinutes(num, unit, special){
  if(special === 'half')return 30;
  if(special === 'hour')return 60;
  const n = Number(num);
  if(!Number.isFinite(n))return null;
  if(/^h/.test(String(unit || '')))return Math.round(n * 60);
  return Math.round(n);
}

function assistantParseSimpleEndpointPhrase(phrase){
  let s = assistantNormText(phrase);
  if(!s)return null;
  s = s.replace(/^(?:till|until|to|by)\s+/, '');
  const off = s.match(new RegExp(`^(?:(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h|minutes?|mins?|m)|(an hour)|(half an hour|a half hour))\\s+(before|after)\\s+(${ASSISTANT_ANCHOR_WORD})$`));
  if(off){
    let minutes = off[3] ? 60 : off[4] ? 30 : assistantParseOffsetMinutes(off[1], off[2]);
    if(minutes == null)return null;
    if(off[5] === 'before')minutes = -minutes;
    const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(off[6]) : off[6];
    if(anchor)return {kind:'anchor', anchor, offsetMin:minutes};
  }
  const rel = s.match(new RegExp(`^(?:before|after)\\s+(${ASSISTANT_ANCHOR_WORD})$`));
  if(rel){
    const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(rel[1]) : rel[1];
    if(anchor)return {kind:'anchor', anchor, offsetMin:0};
  }
  const only = s.match(new RegExp(`^(${ASSISTANT_ANCHOR_WORD})$`));
  if(only){
    const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(only[1]) : only[1];
    if(anchor)return {kind:'anchor', anchor, offsetMin:0};
  }
  const clock = assistantParseClock(s);
  if(clock != null)return {kind:'clock', minutes:clock, clock:assistantClockLabel(clock)};
  return null;
}

function assistantParseCombinedEndpointParts(text){
  const s = assistantNormText(text);
  if(!s)return null;
  const whichever = s.match(/^(.+?)\s+or\s+(.+?)\s*,?\s*whichever is (later|earlier)$/);
  if(whichever)return {a:whichever[1], b:whichever[2], combine:whichever[3]};
  const ofAnd = s.match(/^(?:the )?(later|earlier)\s+of\s+(.+?)\s+and\s+(.+)$/);
  if(ofAnd)return {a:ofAnd[2], b:ofAnd[3], combine:ofAnd[1]};
  return null;
}

function assistantParseEndpointPhrase(phrase){
  const parts = assistantParseCombinedEndpointParts(phrase);
  if(parts){
    const primary = assistantParseSimpleEndpointPhrase(parts.a);
    const second = assistantParseSimpleEndpointPhrase(parts.b);
    if(primary && second){
      primary.combine = parts.combine;
      primary.second = second;
      return primary;
    }
  }
  return assistantParseSimpleEndpointPhrase(phrase);
}

function assistantAttachCombine(window, combine, second){
  if(!window || !window.start || !combine || !second)return window;
  window.start.combine = combine;
  window.start.second = second;
  return window;
}

function assistantWindowFromClocks(start, end){
  if(start == null || end == null)return null;
  return {
    start:{kind:'clock', minutes:start, clock:assistantClockLabel(start)},
    end:{kind:'clock', minutes:end, clock:assistantClockLabel(end)}
  };
}

function assistantParseWindowFromText(text){
  let s = assistantNormText(text);
  s = s.replace(/[.?!,;:]+$/g, '').trim();
  s = s.replace(/^(?:please |can you |could you )?(?:change|update|edit|make)(?: it| this| that| this one)?(?: to(?: be)?)?\s+/, '');
  s = s.replace(/^(?:allowed|preferred)(?: to be)?\s+/, '');
  const endBit = `(?:${ASSISTANT_ANCHOR_WORD}|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`;
  const combineRange = s.match(new RegExp(`\\b(later|earlier)\\s+of\\s+(.+?)\\s+and\\s+(.+?)(?:\\s+(?:until|till|to)\\s+(${endBit}))?(?=\\s*[.?!,;:]|$)`));
  if(combineRange){
    const combine = combineRange[1] === 'earlier' ? 'earlier' : 'later';
    const start = assistantParseEndpointPhrase(combineRange[2]);
    const second = assistantParseEndpointPhrase(combineRange[3]);
    const end = combineRange[4] ? assistantParseEndpointPhrase(combineRange[4]) : {kind:'unset'};
    if(start && second)return assistantAttachCombine({start, end:end || {kind:'unset'}}, combine, second);
  }
  const whicheverRange = s.match(/\b(?:from|between)\s+(.+?)\s+(?:to|until|till|and)\s+(.+?)\s+or\s+(.+?)\s*,?\s*whichever is (later|earlier)\b/);
  if(whicheverRange){
    const start = assistantParseSimpleEndpointPhrase(whicheverRange[1]);
    const end = assistantParseSimpleEndpointPhrase(whicheverRange[2]);
    const second = assistantParseSimpleEndpointPhrase(whicheverRange[3]);
    if(start && end && second){
      end.combine = whicheverRange[4];
      end.second = second;
      return {start, end};
    }
  }
  if(/^(any|all day|none|open|24h|all day long)$/.test(s)){
    return {start:{kind:'unset'}, end:{kind:'unset'}};
  }
  const clockRange = s.match(/\b(?:between|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:and|to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/)
    || s.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/)
    || s.match(/\b(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\b/);
  if(clockRange){
    const ranged = assistantWindowFromClocks(assistantParseClock(clockRange[1]), assistantParseClock(clockRange[2]));
    if(ranged)return ranged;
  }
  const between = s.match(/\b(?:(?:to be )?allowed(?: to be)? )?(?:between|from)\s+(.+?)\s+(?:and|to)\s+(?:(?:till|until|to|by)\s+)?(.+?)(?:[.!?]|$)/);
  if(between){
    const start = assistantParseEndpointPhrase(between[1]);
    const end = assistantParseEndpointPhrase(between[2]);
    if(start && end)return {start, end};
  }
  const tillRange = s.match(new RegExp(`\\b((?:\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?|h|minutes?|mins?|m)|an hour|half an hour)\\s+(?:before|after)\\s+(?:${ASSISTANT_ANCHOR_WORD}))\\s+(?:till|until|to)\\s+(${ASSISTANT_ANCHOR_WORD})\\b`));
  if(tillRange){
    const start = assistantParseEndpointPhrase(tillRange[1]);
    const end = assistantParseEndpointPhrase(tillRange[2]);
    if(start && end)return {start, end};
  }
  const afterClock = s.match(/\bafter\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  if(afterClock){
    const start = assistantParseClock(afterClock[1]);
    if(start != null)return {start:{kind:'clock', minutes:start, clock:assistantClockLabel(start)}, end:{kind:'unset'}};
  }
  const beforeClock = s.match(/\bbefore\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  if(beforeClock){
    const end = assistantParseClock(beforeClock[1]);
    if(end != null)return {start:{kind:'unset'}, end:{kind:'clock', minutes:end, clock:assistantClockLabel(end)}};
  }
  const atClock = s.match(/\b(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  if(atClock){
    const start = assistantParseClock(atClock[1]);
    if(start != null)return assistantWindowFromClocks(start, Math.min(1440, start + 60));
  }
  const offsetAnchor = s.match(new RegExp(`\\b(?:(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h|minutes?|mins?|m)|(an hour)|(half an hour))\\s+(before|after)\\s+(${ASSISTANT_ANCHOR_WORD})\\b`));
  if(offsetAnchor){
    const start = assistantParseEndpointPhrase(offsetAnchor[0]);
    if(start){
      const end = offsetAnchor[5] === 'before'
        ? {kind:'anchor', anchor:start.anchor, offsetMin:0}
        : {kind:'unset'};
      return {start, end};
    }
  }
  const afterAnchor = s.match(new RegExp(`\\bafter\\s+(${ASSISTANT_ANCHOR_WORD})`));
  if(afterAnchor){
    const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(afterAnchor[1]) : afterAnchor[1];
    if(anchor){
      const end = afterAnchor[1] === 'sunset' || afterAnchor[1] === 'maghrib' || afterAnchor[1] === 'dusk'
        ? {kind:'anchor', anchor:'sunrise', offsetMin:0}
        : {kind:'unset'};
      return {start:{kind:'anchor', anchor, offsetMin:0}, end};
    }
  }
  const beforeAnchor = s.match(new RegExp(`\\bbefore\\s+(${ASSISTANT_ANCHOR_WORD})`));
  if(beforeAnchor){
    const anchor = typeof assistantCleanAnchor === 'function' ? assistantCleanAnchor(beforeAnchor[1]) : beforeAnchor[1];
    if(anchor)return {start:{kind:'unset'}, end:{kind:'anchor', anchor, offsetMin:0}};
  }
  if(/\b(?:this evening|in the evening)\b/.test(s) || (/\bevening\b/.test(s) && !/\bevery evening\b/.test(s))){
    return assistantWindowFromClocks(17 * 60, 21 * 60);
  }
  if(/\b(?:this morning|in the morning|every morning)\b/.test(s)){
    return assistantWindowFromClocks(6 * 60, 12 * 60);
  }
  if(/\bthis afternoon\b|\bin the afternoon\b/.test(s)){
    return assistantWindowFromClocks(12 * 60, 17 * 60);
  }
  if(/\bevery night\b|\bevery evening\b/.test(s)){
    return assistantWindowFromClocks(18 * 60, 22 * 60);
  }
  return null;
}

function assistantMatchCatalogNames(list, text){
  const s = assistantNormText(text);
  const hits = [];
  for(const item of list || []){
    const name = assistantNormText(item && item.name);
    if(!name || name.length < 2)continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if(re.test(s))hits.push(item);
  }
  return hits;
}

function assistantLooksLikeMissedQuestion(text){
  const s = assistantNormText(text);
  if(!s)return false;
  if(/\bmiss(?:ing)? anything\b/.test(s) || /\bif i (?:add|block|put)\b/.test(s))return false;
  return /\b(?:what(?:'| )?d(?:id|o) i miss|what have i missed|what(?:'| i)?s missed|anything i miss(?:ed)?|did i miss(?: anything)?|show (?:me )?(?:the )?missed|missed (?:today|so far|this morning)|what i missed)\b/.test(s)
    || (/\bmissed\b/.test(s) && /\b(?:today|list|header|pill|button)\b/.test(s) && /\b(?:what|which|show|list)\b/.test(s));
}

function assistantLooksLikeListAnalysis(text){
  const s = assistantNormText(text);
  if(!s)return false;
  return /\b(?:most (?:important|urgent|critical|frequent|often|common)|highest priority|least (?:important|frequent)|longest|shortest|which (?:one|of them)|among (?:them|those|these)|busiest)\b/.test(s);
}

function assistantGuessIntent(text){
  const s = assistantNormText(text);
  if(!s)return {intent:'unclear', confident:false};
  if(/\b(delete everything|wipe my list|reschedule .{0,24}week|hack the)\b/.test(s)){
    return {intent:'unsupported', confident:true};
  }
  if(assistantLooksLikeMissedQuestion(s)
    || (assistantLooksLikeListAnalysis(s) && /\b(?:miss(?:ed)?|agenda|tomorrow|today)\b/.test(s))){
    return {intent:'ask_schedule', confident:true};
  }
  const setting = assistantParseSettingCreate(s);
  if(setting){
    return {intent:'create_setting', confident:true, settingKind:setting.kind, name:setting.name, address:setting.address || ''};
  }
  if(/\b(i (?:already )?(?:did|done|finished)|already did|mark .{0,40} done|check(?:ed)? off|log .{0,40}(?:done)?|done with|finished)\b/.test(s)
    && !/\b(remind me|don't forget|dont forget|add |create |every day|daily)\b/.test(s)){
    return {intent:'complete_item', confident:true};
  }
  if(/\b(when is|when'?s|when am i|when should i|when (?:do|did|will) i|where(?:'| i)?s|did i (?:do|finish)|do i have|is .{0,40} (?:today|done|on (?:the )?(?:list|plan|agenda))|last time i|how often|why (?:isn'?t|is not|wasn'?t))\b/.test(s)){
    return {intent:'lookup_item', confident:true};
  }
  if(/\b(what(?:'| i)?s (?:on )?(?:today|next|due|left)|what do i (?:have|need)|what(?:'| i)?s left|what should i do|show (?:me )?today|today'?s plan|anything due)\b/.test(s)){
    return {intent:'ask_today', confident:true};
  }
  if(assistantLooksLikeEdit(s)){
    return {intent:'edit_item', confident:true};
  }
  const rhythm = assistantParseRhythm(s);
  if(rhythm || /\b(habit|repeating|recurring)\b/.test(s)){
    return {intent:'create_habit', confident:Boolean(rhythm) || /\bhabit\b/.test(s)};
  }
  if(/\b(remind me|don't forget|dont forget|remember to|i (?:need|have|gotta|got|should|want to|wanna)|add:?|create |new task|todo|to-do|to do)\b/.test(s)){
    return {intent:'create_task', confident:true};
  }
  if(/\b(walk|call|buy|pick up|email|pay|book|visit|pharmacy|errand)\b/.test(s)){
    return {intent:'create_task', confident:false};
  }
  return {intent:'unclear', confident:false};
}

function assistantPreferIntent(modelIntent, guessed){
  const model = ASSISTANT_INTENTS.includes(modelIntent) ? modelIntent : 'unclear';
  if(!guessed || !guessed.intent)return model;
  // The model's query/action intents win even over a confident local ask_today —
  // "what habits do I have" and "what should I do given the weather" parse like
  // ask_today, but the model picked the grounded list/weather/schedule tool.
  if(model === 'ask_weather' || model === 'ask_schedule' || model === 'ask_items' || model === 'ask_settings')return model;
  if(model === 'plan_item' || model === 'delete_item')return model;
  if(['complete_item', 'lookup_item', 'ask_today'].includes(guessed.intent) && guessed.confident){
    return guessed.intent;
  }
  if(guessed.intent === 'edit_item' && guessed.confident){
    if(model === 'create_task' || model === 'create_habit')return model;
    if(model === 'unclear' || model === 'unsupported')return 'create_habit';
  }
  if(guessed.intent === 'create_setting' && guessed.confident
    && (model === 'unclear' || model === 'unsupported' || model === 'create_task' || model === 'create_habit' || modelIntent === 'edit_item')){
    return 'create_setting';
  }
  if((guessed.intent === 'create_task' || guessed.intent === 'create_habit') && guessed.confident
    && (model === 'unclear' || model === 'unsupported' || modelIntent === 'edit_item')){
    return guessed.intent;
  }
  if(model === 'unclear' && guessed.intent !== 'unclear' && guessed.intent !== 'edit_item')return guessed.intent;
  if(model === 'unsupported' && guessed.confident && guessed.intent !== 'unsupported')return guessed.intent;
  return model;
}

const ASSISTANT_WEEKDAY_LABELS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// Relative date math beyond the trivial set is never trusted to the regex
// parser — "day after tomorrow", "two days after tomorrow", "in two weeks",
// "a day before day after tomorrow" — there is always another phrasing.
// Window phrasing ("every day after sunset") is not date math: an anchor word
// later in the sentence opts out.
const ASSISTANT_COMPLEX_DATE_RES = [
  /\b(?:days?|weeks?|months?|years?)\s+(?:after|before|from|out)\b(?![^,.!?]*\b(?:sunset|sunrise|dawn|fajr|dhuhr|zuhr|noon|asr|maghrib|isha|dusk)\b)/,
  /\b(?:after|before|eve)\s+(?:tomorrow|tommorow|tmrw|today|tonight|yesterday|next week)\b/,
  /\bday after (?:tomorrow|tommorow|tmrw)\b/,
  /\bin\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)\s+(?:day|week|month)s?\b/
];

// Structural vocabulary. If any of it survives in the residue after every
// exact parser consumption is stripped, the local parse guessed somewhere —
// route the whole utterance to the model instead of saving a guess.
const ASSISTANT_FAST_RISK_RE = new RegExp(
  '\\b(?:'
  + 'am|pm|a\\.m|p\\.m'
  + '|today|tomorrow|tommorow|tmrw|tonight|yesterday|next|last|every|each'
  + '|day|days|week|weeks|weekend|weekends|weekday|weekdays|month|months|year|years'
  + '|morning|afternoon|evening|night|noon|midnight'
  + '|' + ASSISTANT_ANCHOR_WORD
  + '|after|before|between|until|till|weekly|daily'
  + '|hour|hours|hr|hrs|minute|minutes|min|mins'
  + '|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'
  + '|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen'
  + '|twenty|thirty|forty|fifty|sixty|ninety|hundred'
  + '|quarter|half|past|o\'clock'
  + '|raining|rain|freezing|freeze|snow|snowing|weather'
  + ')\\b'
  + '|\\d|:'
);

// True only when a local parse is allowed to fill missing draft_item fields.
// Default is trusted; FastPathRisk / forceLlm set factsTrusted = false.
function assistantTrustParsedFacts(parsed){
  return Boolean(parsed) && parsed.factsTrusted !== false;
}

// True when the model pasted the request into name instead of using fields.
function assistantNameLooksLikeSettingsDump(name){
  const s = typeof assistantNormText === 'function' ? assistantNormText(name) : String(name || '').trim().toLowerCase();
  if(!s)return false;
  const words = s.split(/\s+/).filter(Boolean);
  if(words.length >= 7)return true;
  return /\b(?:topics?|priority|urgent|someday|allowed|later of|until|prefer|avoid|no late|hard due|split into|every (?:tue|wed|fri|weekend)|limit habit|right after)\b/.test(s);
}

function assistantShortTitleFromDump(name){
  let s = String(name || '').trim();
  if(!s)return '';
  s = s.replace(/^(?:a|an|the)\s+/i, '');
  s = s.replace(/^(?:limit|build|stop|reduce|keepup|habit|task|ting)\s+/i, '');
  s = s.split(/\b(?:topics?|priority|urgent|allowed|later of|prefer|avoid|no late|until|every|right after|due day|firm)\b/i)[0].trim();
  const words = s.split(/\s+/).filter(Boolean).slice(0, 3);
  return words.join(' ') || String(name || '').trim().split(/\s+/).slice(0, 2).join(' ');
}

function assistantLooksLikeWindowText(text){
  const s = assistantNormText(text);
  if(!s)return false;
  return /\b(?:later of|earlier of|whichever is (?:earlier|later)|until|till|between\b|from \d|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–]|after (?:sunset|sunrise|dawn|dusk|fajr|dhuhr|zuhr|noon|asr|maghrib|isha)|before (?:sunset|sunrise|dawn|dusk|fajr|dhuhr|zuhr|noon|asr|maghrib|isha))\b/.test(s);
}

function assistantWindowHasBound(window){
  if(!window || typeof window !== 'object')return false;
  const start = window.start && window.start.kind && window.start.kind !== 'unset';
  const end = window.end && window.end.kind && window.end.kind !== 'unset';
  return Boolean(start || end);
}

function assistantBestWindowFromTexts(texts){
  let best = null;
  for(const text of texts || []){
    if(!text || !assistantLooksLikeWindowText(text))continue;
    const parsed = assistantParseWindowFromText(text);
    if(!assistantWindowHasBound(parsed))continue;
    best = best ? assistantMergePartialWindow(best, parsed) : parsed;
  }
  return best;
}

function assistantMergePartialWindow(existing, parsed){
  if(!assistantWindowHasBound(parsed))return existing || parsed || null;
  if(!existing || typeof existing !== 'object')return parsed;
  const startUnset = !existing.start || existing.start.kind === 'unset';
  const endUnset = !existing.end || existing.end.kind === 'unset';
  const start = startUnset && parsed.start && parsed.start.kind !== 'unset' ? parsed.start : existing.start;
  const end = endUnset && parsed.end && parsed.end.kind !== 'unset' ? parsed.end : existing.end;
  return {start:start || {kind:'unset'}, end:end || {kind:'unset'}};
}

function assistantEndpointHasCombine(end){
  return Boolean(end && end.combine && end.second && end.second.kind && end.second.kind !== 'unset');
}

function assistantWindowHasCombine(window){
  return assistantEndpointHasCombine(window && window.start) || assistantEndpointHasCombine(window && window.end);
}

function assistantParseHardDueText(value){
  if(value == null || value === '')return null;
  if(typeof assistantParseBool === 'function'){
    const asBool = assistantParseBool(value);
    if(asBool != null)return asBool;
  }
  const s = assistantNormText(value);
  if(/\b(?:hard due|due day is firm|that due day is firm|firm(?: due)?(?: day)?|no late days|no delay(?: days)?|cannot (?:be )?late)\b/.test(s))return true;
  return null;
}

function assistantLooksLikeScheduleOption(text){
  const s = assistantNormText(text);
  if(!s)return false;
  const days = typeof assistantCollectWeekdays === 'function' ? assistantCollectWeekdays(s) : [];
  return days.length > 0 && /\b(?:from|between)\b/.test(s) && /\b(?:at|@)\b/.test(s);
}

function assistantParseSharedDisplayText(text){
  const s = assistantNormText(text);
  if(!s || !/\bshared display\b/.test(s))return null;
  if(/\b(?:off|hide|hidden|not on|keep (?:it )?off|leave (?:it )?off)\b/.test(s))return false;
  if(/\b(?:on|show|include|keep (?:it )?on)\b/.test(s))return true;
  return null;
}

function assistantParseSnoozeClause(text){
  const raw = String(text || '');
  const match = raw.match(/\bsnooze(?:\s+it)?\s+(?:for\s+)?([^.,;]+)/i);
  return match ? match[1].trim() : null;
}

function assistantParseWeatherPlaceClause(text){
  const raw = String(text || '');
  const match = raw.match(/\b(?:use|at|from)\s+(?:the\s+)?([A-Za-z][\w']+)\s+place\b/i)
    || raw.match(/\bforecast\b[\s\S]{0,48}?\b(?:at|from|use)\s+(?:the\s+)?([A-Za-z][\w']+)/i);
  return match ? match[1].trim() : null;
}

function assistantParsePlacePrefsLoose(text){
  const raw = String(text || '');
  if(!raw.trim())return null;
  const out = [];
  const seen = new Set();
  const add = (name, level) => {
    const n = String(name || '').replace(/\b(?:high|low|little|preferred|favourite|favorite)\b/ig, '').trim();
    const key = n.toLowerCase();
    if(!n || seen.has(key))return;
    if(ASSISTANT_WEEKDAY_NAMES[key] != null || ASSISTANT_MONTH_NAMES[key] != null)return;
    if(/^(?:it|this|that|high|low|morning|evening|afternoon|weekend|weekdays?|sunset|sunrise|dawn|dusk)$/.test(key))return;
    seen.add(key);
    out.push({name:n, level});
  };
  raw.replace(/\bprefer(?:red)?\s+(?!window\b|weekdays?\b|month(?:\s*days?)?\b|time\b)([A-Za-z][\w' -]{0,32}?)(?:\s+(?:high|favourite|favorite))?(?=\s+and\b|\s+avoid\b|[.,;]|$)/gi, (_, name) => {
    add(name, 'high');
    return _;
  });
  raw.replace(/\bavoid\s+([A-Za-z][\w' -]{0,32}?)(?=\s+and\b|[.,;]|$)/gi, (_, name) => {
    add(name, 'avoid');
    return _;
  });
  return out.length ? out : null;
}

function assistantParseOrderFromLooseText(text){
  const raw = String(text || '');
  const re = /\b((?:right|directly|immediately|straight)\s+)?(before|after)\s+[^.]*/gi;
  let match;
  while((match = re.exec(raw))){
    const around = raw.slice(Math.max(0, match.index - 8), match.index + match[0].length);
    if(/\b(?:day|days)\s+after\b/i.test(around))continue;
    const clause = match[0].trim();
    const tail = assistantNormText(clause.replace(/^\s*(?:right|directly|immediately|straight)\s+/i, '').replace(/^(?:before|after)\s+/i, ''));
    if(/^(?:today|tomorrow|tonight|yesterday|now)\b/.test(tail))continue;
    const anchorWord = typeof ASSISTANT_ANCHOR_WORD === 'string' ? ASSISTANT_ANCHOR_WORD : 'fajr|sunrise|dhuhr|asr|maghrib|isha|sunset|dawn|dusk|noon';
    if(new RegExp('^(?:' + anchorWord + '|\\d)').test(tail))continue;
    if(/\b(?:sunset|sunrise|dawn|dusk|noon|midnight|maghrib|isha|fajr|asr|dhuhr)\b/.test(tail) && !/\bsame day\b/.test(tail))continue;
    const parsed = typeof assistantParseOrderText === 'function' ? assistantParseOrderText(clause) : null;
    if(parsed && parsed.links && parsed.links.length)return parsed;
  }
  return null;
}

function assistantSalvageDraftArgs(args, requestText){
  const out = Object.assign({}, args || {});
  const blobs = [out.windowText, out.name, requestText].filter(value => typeof value === 'string' && value.trim());
  if(!blobs.length)return out;
  const parsedWindow = typeof assistantBestWindowFromTexts === 'function'
    ? assistantBestWindowFromTexts(blobs)
    : null;
  if(parsedWindow){
    if(!out.window || typeof out.window !== 'object' || Array.isArray(out.window))out.window = parsedWindow;
    else if(typeof assistantWindowHasCombine === 'function'
      && assistantWindowHasCombine(parsedWindow)
      && !assistantWindowHasCombine(out.window))out.window = parsedWindow;
    else out.window = assistantMergePartialWindow(out.window, parsedWindow);
  }
  const blob = blobs.join('. ');
  if((out.placePrefs == null || out.placePrefs === '') && typeof assistantParsePlacePrefsLoose === 'function'){
    const prefs = assistantParsePlacePrefsLoose(blob);
    if(prefs)out.placePrefs = prefs.map(row => `${row.name} ${row.level}`).join(', ');
  }
  if((out.placeNames == null || out.placeNames === '' || (Array.isArray(out.placeNames) && !out.placeNames.length))
    && typeof assistantParseLocationClause === 'function'){
    const loc = assistantParseLocationClause(requestText || blob);
    if(loc)out.placeNames = loc;
  }
  if(out.order == null && out.after == null && out.before == null){
    const order = assistantParseOrderFromLooseText(blob);
    if(order && order.links && order.links.length){
      const clause = blob.match(/\b((?:right|directly|immediately|straight)\s+)?(before|after)\s+[^.]*/i);
      out.order = clause ? clause[0].trim() : blob;
    }
  }
  if(out.order && requestText && /\bsame day\b/i.test(requestText) && !/\bsame day\b/i.test(String(out.order))){
    out.order = `${String(out.order).trim()}, same day`;
  }
  if(out.hardDue == null){
    const hard = assistantParseHardDueText(blob);
    if(hard != null)out.hardDue = hard;
  }
  if(out.snooze == null){
    const snooze = assistantParseSnoozeClause(blob);
    if(snooze)out.snooze = snooze;
  }
  if(out.sharedDisplay == null){
    const shared = assistantParseSharedDisplayText(blob);
    if(shared != null)out.sharedDisplay = shared;
  }
  if((out.weatherPlace == null || out.weatherPlace === '') && (out.showWeather === true || /\bforecast\b/i.test(blob))){
    const place = assistantParseWeatherPlaceClause(blob);
    if(place)out.weatherPlace = place;
    else if(out.weatherAtPlace && out.placeNames){
      out.weatherPlace = Array.isArray(out.placeNames) ? out.placeNames[0] : out.placeNames;
    }
  }
  if(out.option == null && assistantLooksLikeScheduleOption(blob))out.option = blob;
  if(out.snooze && out.durationMinutes != null && !(args && args.snooze != null)){
    const hours = assistantNormText(out.snooze).match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/);
    const requestHasDuration = /\b(?:\d+\s*(?:minutes?|mins?|m)|half an hour|an hour)\b/i.test(requestText || '');
    if(hours && !requestHasDuration && Number(out.durationMinutes) === Math.round(Number(hours[1]) * 60)){
      delete out.durationMinutes;
    }
  }
  if((out.weatherText == null || out.weatherText === '') && requestText && typeof assistantParseWeatherHints === 'function'
    && assistantParseWeatherHints(requestText).mentioned){
    out.weatherText = requestText;
  }
  if((out.habitKind == null || out.habitKind === '') && typeof assistantParseHabitKind === 'function'){
    const kindHit = blob.match(/\b(limit|build|stop|reduce|keepup|zero)\s+habit\b/i);
    const kind = kindHit ? assistantParseHabitKind(kindHit[1]) : null;
    if(kind)out.habitKind = kind;
  }
  if(out.priority == null || out.priority === ''){
    const priHit = blob.match(/\bpriority\s+(urgent|asap|critical|someday|p[0-5]|[0-5])\b/i)
      || blob.match(/,\s*(urgent|asap|someday)\s*\.?$/i);
    if(priHit && typeof assistantParsePriority === 'function')out.priority = priHit[1];
  }
  if((out.topics == null || out.topics === '' || (Array.isArray(out.topics) && !out.topics.length))){
    const topicHit = blob.match(/\btopics?\s+([a-z][\w\s]{0,48}?)(?=\s*,\s*(?:every|priority|urgent)|,|\.|$)/i);
    if(topicHit){
      const names = topicHit[1].split(/\s*(?:,|&|and)\s*/i).map(part => part.trim()).filter(Boolean);
      if(names.length)out.topics = names;
    }
  }
  return out;
}

// Null when the local fast path may answer, else why it must go to the LLM.
function assistantFastPathRisk(text, parsed){
  const raw = assistantNormText(text);
  if(typeof assistantLooksLikeMultiItem === 'function' && assistantLooksLikeMultiItem(text))return 'multi-item';
  if(typeof assistantRequestIsHeavy === 'function' && assistantRequestIsHeavy(text))return 'long-request';
  if(/\b(?:did not|didn't|didnt|never|not done|haven't|have not|hasn't|has not)\b/.test(raw))return 'negation';
  for(const re of ASSISTANT_COMPLEX_DATE_RES){
    if(re.test(raw))return 'relative-date';
  }
  let s = raw;
  const cut = re => { s = s.replace(re, ' '); };
  // Scaffolding the intent rules consume.
  cut(/^(?:please |can you |could you |hey |ok |okay )+/g);
  cut(/^(?:remind me(?: to)?|don't forget(?: to)?|dont forget(?: to)?|remember to|i (?:need|have|gotta|got)(?: to)?|i should|i want to|i wanna)\s+/g);
  cut(/^(?:add:?|create|make|new(?: task| habit)?)\s+(?:a |an |the )?/g);
  cut(/^(?:new )?(?:task|habit|ting|item):\s*/g);
  if(parsed && parsed.intent === 'create_setting'){
    cut(/\b(?:weather profile|busy time|blocked time|location|place|topics?)\b/g);
    cut(/\b(?:called|named|for|to|at|address)\b/g);
    if(parsed.itemName)cut(new RegExp(String(parsed.itemName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    if(parsed.address)cut(new RegExp(String(parsed.address).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  }
  cut(/^(?:when am i supposed to|when should i|when (?:do|did|will) i(?: last)?|when is|when's|where's|where is|did i (?:do|finish)|do i have|is there)\s+/g);
  cut(/^(?:i (?:already )?)?(?:already )?(?:did|done|finished|logged)\s+/);
  cut(/^(?:done with|finished|mark|check(?:ed)? off|log)\s+/);
  // Weather clauses trail the utterance; consume to the end.
  cut(/\b(?:only if|unless|not raining|no rain|not freezing|no freeze|not too cold|not too windy|not snowing|no snow|dry weather|using dry|skip(?: the)? rain|skip wind)\b[\s\S]*$/g);
  // Consumed structure — mirrors assistantParseUtterance exactly.
  // NOTE: weekday/anchor token lists are bare alternations; always wrap them
  // in (?:…) or the surrounding pattern only binds the first branch.
  cut(/\bday after (?:tomorrow|tommorow|tmrw)\b/g);
  cut(/\bin\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)\s+(?:day|week)s?\b/g);
  cut(/\b(?:today|tomorrow|tommorow|tmrw|tonight|this (?:morning|afternoon|evening)|next week)\b/g);
  cut(new RegExp('\\b(?:(?:next|this|every|each|on|and)\\s+)?\\s*(?:' + ASSISTANT_WEEKDAY_TOKEN + ')\\b', 'g'));
  cut(/\b\d{4}-\d{2}-\d{2}\b/g);
  cut(/\bon\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g);
  cut(/\b(?:at|by|around)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/g);
  cut(/\b(?:between|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g);
  const anchor = '(?:' + ASSISTANT_ANCHOR_WORD + ')';
  cut(new RegExp('\\b(?:\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?|h|minutes?|mins?|m)|an hour|half an hour)\\s+(?:before|after)\\s+' + anchor + '\\s+(?:till|until|to)\\s+' + anchor + '\\b', 'g'));
  cut(new RegExp('\\b(?:\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?|h|minutes?|mins?|m)|an hour|half an hour)\\s+(?:before|after)\\s+' + anchor + '\\b', 'g'));
  cut(new RegExp('\\b(?:after|before)\\s+' + anchor + '\\b', 'g'));
  cut(/\b(?:every day|each day|daily|every other day|every (?:morning|night|evening)|weekly|every week)\b/g);
  cut(/\b(?:once|twice|thrice)\s+(?:a\s+|per\s+|each\s+)?(?:day|week)s?\b/g);
  cut(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+times?\s+(?:a|per|each|every)\s+(?:week|day)s?\b/g);
  cut(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+days?\b/g);
  cut(/\b(?:every weekend|weekends?|weekdays?|to be done)\b/g);
  cut(/\b(?:\d+(?:\.\d+)?\s*(?:minutes?|mins?|m|hours?|hrs?|h)|an hour|half an hour)\b/g);
  cut(/\b(?:p[0-5]|urgent|asap|critical|important|high|normal|medium|low|someday|whenever|later)\b/g);
  for(const place of (parsed && parsed.places) || []){
    cut(new RegExp(String(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  }
  if(/\b(?:habit|repeating|recurring)\b/.test(s) && !(parsed && parsed.rhythm))return 'vague-rhythm';
  if(/\b(?:at|in|on)\s+(?:the|my|a|an|his|her|their)\b/.test(s))return 'place-phrase';
  const risk = s.match(ASSISTANT_FAST_RISK_RE);
  if(risk)return 'token:' + String(risk[0]).trim();
  if(parsed && (parsed.intent === 'complete_item' || parsed.intent === 'lookup_item') && parsed.durationMinutes != null)return 'minutes';
  return null;
}

function assistantParseUtterance(text, catalog, now){
  const raw = String(text || '').trim();
  const s = assistantNormText(raw);
  const guessed = assistantGuessIntent(s);
  let itemName = assistantGuessItemName(raw);
  if(assistantIsPronounName(itemName))itemName = null;
  if(guessed.intent === 'create_setting')itemName = guessed.name || itemName;
  if(!itemName && guessed.intent === 'edit_item')itemName = assistantGuessEditTarget(raw);
  const newName = assistantParseRename(raw);
  if(!itemName && (guessed.intent === 'create_habit' || guessed.intent === 'create_task')){
    const lead = assistantCutNameTail(s.split(/\b(?:every|daily|weekly|twice|three|thrice|\d+\s+times?|to be done|only if|after|before|at|for|tomorrow|today|tonight|next)\b/)[0]);
    const cleaned = assistantStripNameJunk(lead);
    if(cleaned && cleaned.length >= 2 && cleaned.length <= 40 && !/^(add|create|make|remind|please|it|this|that)$/.test(cleaned)){
      itemName = cleaned;
    }
  }
  let due = null;
  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const slash = s.match(/\bon\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/);
  const inRel = s.match(/\bin\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)\s+(day|week)s?\b/);
  if(/\bday after (?:tomorrow|tommorow|tmrw)\b/.test(s))due = assistantParseDue('day after tomorrow', now);
  else if(inRel){
    const n = /^\d+$/.test(inRel[1]) ? Number(inRel[1]) : (inRel[1] === 'a' ? 1 : assistantParseCount(inRel[1], 1, 364));
    if(n != null)due = assistantParseDue('today', now) + n * (inRel[2] === 'week' ? 7 : 1) * 86400000;
  }
  else if(/\btomorrow\b|\btommorow\b|\btmrw\b/.test(s))due = assistantParseDue('tomorrow', now);
  else if(/\bnext week\b/.test(s))due = assistantParseDue('next week', now);
  else if(iso)due = assistantParseDue(iso[1], now);
  else if(slash)due = assistantParseDue(slash[1], now);
  else if(/\btonight\b|\btoday\b/.test(s))due = assistantParseDue('today', now);
  else if(!assistantParseWeekdaySchedule(s)){
    const dayMatch = s.match(/\b(next )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
    if(dayMatch)due = assistantParseDue(`${dayMatch[1] || ''}${dayMatch[2]}`, now);
  }
  if(!due && guessed.intent === 'create_task')due = assistantDayBase(now != null ? now : Date.now());
  if(guessed.intent === 'create_setting')due = null;
  const dueTime = (() => {
    const at = s.match(/\b(?:at|by|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
    return at ? assistantParseClock(at[1]) : null;
  })();
  const window = assistantParseWindowFromText(s);
  const rhythm = assistantParseRhythm(s);
  if(rhythm && rhythm.weekdays && rhythm.weekdays.length)due = null;
  const priority = assistantParsePriority(s);
  const durationText = s.replace(/\b(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)|an hour|half an hour)\s+(?:before|after)\b/g, ' ');
  const duration = assistantParseDuration(durationText);
  let places = assistantMatchCatalogNames((catalog && catalog.places) || [], s);
  if(!places.length){
    const locRef = assistantParseLocationClause(raw);
    if(locRef)places = assistantMatchPlacesFromRef((catalog && catalog.places) || [], locRef);
  }
  if(assistantLooksLikeSettingFollowup(s))itemName = null;
  const weather = assistantMatchCatalogNames((catalog && catalog.weather) || [], s);
  const weatherHints = assistantParseWeatherHints(s);
  return {
    text:raw,
    intent:guessed.intent,
    confident:Boolean(guessed.confident),
    durationMinutes:duration,
    due:due != null ? (typeof dateKey === 'function' ? dateKey(due) : null) : null,
    dueTs:due,
    dueTime:dueTime != null ? assistantClockLabel(dueTime) : null,
    dueTimeMinutes:dueTime,
    window,
    rhythm,
    priority,
    places:places.map(item => item.name),
    placeIds:places.map(item => item.id).filter(Boolean),
    weather:weather[0] ? weather[0].name : null,
    weatherId:weather[0] ? weather[0].id : null,
    weatherHints,
    itemName,
    newName,
    settingKind:guessed.settingKind || null,
    address:guessed.address || null
  };
}
