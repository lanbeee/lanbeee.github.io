// Utterance parsers for the local assistant. Qwen names the intent and the
// item; Tings fills clocks, dates, duration, places, and rhythm from the
// words the user typed so messy phrasing still becomes a valid draft.

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
  s = s.replace(/\b(?:today|tomorrow|tommorow|tmrw|tonight|this (?:morning|afternoon|evening)|next week)\b/g, ' ');
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
  const cut = s.search(/\b(?:to be done|only if|if it(?:'s| is) not|if it(?:'s| is)|using\b|every\b|twice\b|thrice\b|(?:once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten)\s+times?\b|\d+\s*x\b|\d+\s+times?\b|after\b|before\b|between\b|tomorrow\b|today\b|tonight\b|this (?:morning|afternoon|evening)|next\b|at \d|for \d|urgent\b|someday\b|and only)\b/);
  if(cut > 2)return s.slice(0, cut).trim();
  return s;
}

function assistantParseWeatherHints(text){
  const s = assistantNormText(text);
  const notRaining = /\b(?:not raining|no rain|isn'?t raining|if it(?:'s| is) not raining|only if(?: it(?:'s| is))? (?:dry|not raining)|unless(?: it(?:'s| is))? raining|skip(?: the)? rain)\b/.test(s);
  const notFreezing = /\b(?:not freezing|above freezing|if it(?:'s| is) not freezing|isn'?t freezing|no freeze|not too cold)\b/.test(s);
  const notSnowing = /\b(?:not snowing|no snow)\b/.test(s);
  const dryNamed = /\b(?:dry weather|using dry)\b/.test(s);
  return {
    mentioned:notRaining || notFreezing || notSnowing || dryNamed,
    notRaining:notRaining || dryNamed,
    notFreezing,
    notSnowing
  };
}

function assistantGuessItemName(text){
  const raw = assistantNormText(text).replace(/^(?:please |can you |could you |hey |ok |okay )+/g, '');
  const patterns = [
    /^(?:i(?:'ve| have)? (?:already )?(?:did|done|finished|logged)|mark(?:ed)?|check(?:ed)? off|log)\s+(?:the )?(.+?)(?:\s+(?:as )?(?:done|complete|finished))?$/,
    /^(?:i already did|already did|done with|finished)\s+(?:the )?(.+)$/,
    /^(?:when is|where's|where is|did i (?:do|finish)|do i have|is there)\s+(?:the )?(.+?)(?:\s+today)?$/,
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
  return /^(it|this|that|this one|the habit|the task|the ting|the item)(?:\s+to)?$/.test(assistantNormText(name));
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

function assistantLooksLikeEdit(text){
  const s = assistantNormText(text);
  if(!s)return false;
  if(/\b(?:remind me|don't forget|dont forget|add:?|create |new task|new habit)\b/.test(s)
    && !/\b(?:make it|change it|update it|rename it|add \d)/.test(s)){
    return false;
  }
  return /\b(?:change|update|edit|rename)\b/.test(s)
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

function assistantHasPatchFields(parsed){
  if(!parsed)return false;
  if(parsed.window)return true;
  if(parsed.durationMinutes != null)return true;
  if(parsed.rhythm)return true;
  if(parsed.priority != null)return true;
  if(parsed.places && parsed.places.length)return true;
  if(parsed.weather)return true;
  if(parsed.weatherHints && parsed.weatherHints.mentioned)return true;
  if(parsed.due || parsed.dueTime)return true;
  if(parsed.newName)return true;
  return false;
}

function assistantHasActionablePatch(parsed, draft){
  if(!parsed)return false;
  if(parsed.rhythm)return true;
  if(parsed.durationMinutes != null)return true;
  if(parsed.window)return true;
  if(parsed.priority != null)return true;
  if(parsed.places && parsed.places.length)return true;
  if(parsed.weather)return true;
  if(parsed.weatherHints && parsed.weatherHints.mentioned)return true;
  if(parsed.newName)return true;
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
  if(!parsed || (parsed.intent !== 'create_task' && parsed.intent !== 'create_habit'))return false;
  if(!parsed.itemName || assistantIsPronounName(parsed.itemName))return false;
  if(assistantLooksLikeEdit(parsed.text))return false;
  if(!draft || !draft.name)return true;
  return assistantNormText(parsed.itemName) !== assistantNormText(draft.name);
}

function assistantIsFollowupOnFocus(text, parsed, draft){
  if(!draft || !draft.name || !parsed)return false;
  if(parsed.intent === 'ask_today' && parsed.confident)return false;
  if(parsed.intent === 'unsupported' && parsed.confident)return false;
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

function assistantParseEndpointPhrase(phrase){
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

function assistantParseWindowFromText(text){
  let s = assistantNormText(text);
  s = s.replace(/^(?:please |can you |could you )?(?:change|update|edit|make)(?: it| this| that| this one)?(?: to(?: be)?)?\s+/, '');
  s = s.replace(/^allowed(?: to be)?\s+/, '');
  const clockRange = s.match(/\b(?:between|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:and|to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/);
  if(clockRange){
    const start = assistantParseClock(clockRange[1]);
    const end = assistantParseClock(clockRange[2]);
    if(start != null && end != null){
      return {
        start:{kind:'clock', minutes:start, clock:assistantClockLabel(start)},
        end:{kind:'clock', minutes:end, clock:assistantClockLabel(end)}
      };
    }
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
    if(start != null){
      const end = Math.min(1440, start + 60);
      return {
        start:{kind:'clock', minutes:start, clock:assistantClockLabel(start)},
        end:{kind:'clock', minutes:end, clock:assistantClockLabel(end)}
      };
    }
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
  if(/\bthis evening\b|\bin the evening\b|\bevening\b/.test(s) && !/\bevery evening\b/.test(s)){
    return {
      start:{kind:'clock', minutes:17 * 60, clock:'17:00'},
      end:{kind:'clock', minutes:21 * 60, clock:'21:00'}
    };
  }
  if(/\bthis morning\b|\bin the morning\b/.test(s) && !/\bevery morning\b/.test(s)){
    return {
      start:{kind:'clock', minutes:6 * 60, clock:'06:00'},
      end:{kind:'clock', minutes:12 * 60, clock:'12:00'}
    };
  }
  if(/\bthis afternoon\b|\bin the afternoon\b/.test(s)){
    return {
      start:{kind:'clock', minutes:12 * 60, clock:'12:00'},
      end:{kind:'clock', minutes:17 * 60, clock:'17:00'}
    };
  }
  if(/\bevery morning\b/.test(s)){
    return {
      start:{kind:'clock', minutes:6 * 60, clock:'06:00'},
      end:{kind:'clock', minutes:12 * 60, clock:'12:00'}
    };
  }
  if(/\bevery night\b|\bevery evening\b/.test(s)){
    return {
      start:{kind:'clock', minutes:18 * 60, clock:'18:00'},
      end:{kind:'clock', minutes:22 * 60, clock:'22:00'}
    };
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

function assistantGuessIntent(text){
  const s = assistantNormText(text);
  if(!s)return {intent:'unclear', confident:false};
  if(/\b(delete everything|wipe my list|reschedule .{0,24}week|hack the)\b/.test(s)){
    return {intent:'unsupported', confident:true};
  }
  if(/\b(i (?:already )?(?:did|done|finished)|already did|mark .{0,40} done|check(?:ed)? off|log .{0,40}(?:done)?|done with|finished)\b/.test(s)
    && !/\b(remind me|don't forget|dont forget|add |create |every day|daily)\b/.test(s)){
    return {intent:'complete_item', confident:true};
  }
  if(/\b(when is|where(?:'| i)?s|did i (?:do|finish)|do i have|is .{0,40} (?:today|done|on (?:the )?(?:list|plan|agenda)))\b/.test(s)){
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
  if(['complete_item', 'lookup_item', 'ask_today'].includes(guessed.intent) && guessed.confident){
    return guessed.intent;
  }
  if(guessed.intent === 'edit_item' && guessed.confident){
    if(model === 'create_task' || model === 'create_habit')return model;
    if(model === 'unclear' || model === 'unsupported')return 'create_habit';
  }
  if((guessed.intent === 'create_task' || guessed.intent === 'create_habit') && guessed.confident
    && (model === 'unclear' || model === 'unsupported' || modelIntent === 'edit_item')){
    return guessed.intent;
  }
  if(model === 'unclear' && guessed.intent !== 'unclear' && guessed.intent !== 'edit_item')return guessed.intent;
  if(model === 'unsupported' && guessed.confident && guessed.intent !== 'unsupported')return guessed.intent;
  return model;
}

function assistantParseUtterance(text, catalog, now){
  const raw = String(text || '').trim();
  const s = assistantNormText(raw);
  const guessed = assistantGuessIntent(s);
  let itemName = assistantGuessItemName(raw);
  if(assistantIsPronounName(itemName))itemName = null;
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
  if(/\btomorrow\b|\btommorow\b|\btmrw\b/.test(s))due = assistantParseDue('tomorrow', now);
  else if(/\bnext week\b/.test(s))due = assistantParseDue('next week', now);
  else if(iso)due = assistantParseDue(iso[1], now);
  else if(slash)due = assistantParseDue(slash[1], now);
  else if(/\btonight\b|\btoday\b/.test(s))due = assistantParseDue('today', now);
  else if(!assistantParseWeekdaySchedule(s)){
    const dayMatch = s.match(/\b(next )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
    if(dayMatch)due = assistantParseDue(`${dayMatch[1] || ''}${dayMatch[2]}`, now);
  }
  if(!due && guessed.intent === 'create_task')due = assistantDayBase(now != null ? now : Date.now());
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
  const places = assistantMatchCatalogNames((catalog && catalog.places) || [], s);
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
    newName
  };
}

function assistantEnrichDraft(draft, parsed, catalog, settings){
  if(!draft || !parsed)return draft;
  if(draft.durationMinutes == null && parsed.durationMinutes != null){
    draft.durationMinutes = typeof clampDuration === 'function'
      ? clampDuration(parsed.durationMinutes)
      : parsed.durationMinutes;
  }
  if(draft.kind === 'task'){
    if(draft.dueDate == null && parsed.dueTs != null)draft.dueDate = parsed.dueTs;
    if(draft.dueTime == null && parsed.dueTime)draft.dueTime = parsed.dueTime;
  }
  if(draft.kind === 'habit' && parsed.rhythm){
    if(draft.timesPerPeriod == null)draft.timesPerPeriod = parsed.rhythm.timesPerPeriod;
    if(draft.periodDays == null)draft.periodDays = parsed.rhythm.periodDays;
    if(parsed.rhythm.weekdays && draft.allowedWeekdays == null){
      draft.allowedWeekdays = parsed.rhythm.weekdays.slice();
    }
  }
  if(draft.priority == null && parsed.priority != null)draft.priority = parsed.priority;
  if(!draft.window && parsed.window){
    draft.window = parsed.window;
    draft.windowMentioned = true;
  }
  if(!draft.places && parsed.places && parsed.places.length){
    const applied = assistantApplyPlace(draft, {names:parsed.places, anywhere:false}, catalog);
    if(applied && applied.ok)Object.assign(draft, applied.draft);
  }
  if(typeof assistantAttachParsedWeather === 'function'){
    assistantAttachParsedWeather(draft, parsed, catalog, settings);
  }else if(!draft.weather && parsed.weather){
    const applied = assistantApplyWeather(draft, {mode:'profile', profile:parsed.weather}, catalog);
    if(applied && applied.ok)Object.assign(draft, applied.draft);
  }
  if(draft.kind === 'task' && draft.dueDate == null){
    draft.dueDate = parsed.dueTs != null ? parsed.dueTs : assistantDayBase(Date.now());
  }
  if(!draft.name && parsed.itemName)draft.name = parsed.itemName.slice(0, ASSISTANT_NAME_MAX);
  return draft;
}
