// Week view — a readable week over the planner, opened from the Overview
// calendar's "week" button. Pure view layer: it never writes planner data
// and never replaces Home's mounted week or the shared overview snapshot.
//
// Default is the list: elastic time, so a 15-minute habit and a 5-minute
// trip stay readable, and free gaps compress. Grid is the opt-in proportional
// time grid. Phones show 1–3 days; wide screens also offer a full week.
//
// Ranges are rolling 7-day windows inside the existing 14-day planning
// horizon:
//   offset 0 — the planner week (today → +6), reused from the mounted week.
//   offset 7 — "Preview": days +7 → +13 of a fresh 14-day projection. The
//              projection runs in a dedicated planner worker instance so a
//              long solve never delays Home's foreground replans, and it is
//              treated as provisional: earlier completions can reshuffle it.
//
// Section map:
//   PURE row adapter   weekCalendarRows + lane/topic/segment helpers
//   Preview worker     ensureWeekPreviewWorker / weekPreviewRequest
//   Week resolution    weekViewInitialWeek / weekViewFillInitialWeek /
//                      weekViewEnsurePreviewWeek
//   ELASTIC LIST       weekViewElasticLayout / weekViewSharedTimeAxis
//   RENDER             renderWeekView / per-day builders
//   WIRE / lifecycle   bindWeekView / openWeekView / weekViewCleanup
//
// React Native port guide:
//   - PURE helpers    -> plain modules (no change needed).
//   - RENDER builders -> components returning JSX per day column.
//   - WIRE/lifecycle  -> effect setup + cleanup hooks.

// Vertical scale. Phone is taller per hour so a 15–30 minute block still has
// a line of type; desktop columns are wider, so they can stay slightly denser.
const WEEK_VIEW_ZOOM_STEPS = [48,72,96,120,144,192];
function weekViewHourPx(){
  return _weekViewZoom;
}

// ─────────────────────────────────────────────────────────────────────────
// PURE: wall-clock minutes. Local clock math keeps positions correct on
// 23-hour and 25-hour DST days, where raw ms-since-midnight drifts.
// ─────────────────────────────────────────────────────────────────────────
function weekViewMinuteOfDay(ts){
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

// PURE: clamp a row to one day; cross-midnight spans render per visible day
// while keeping the original identity/timestamps on the parent row.
function weekViewDaySegments(row,dayBase){
  const dayEnd = offsetCalendarDay(dayBase,1);
  const start = Math.max(row.start,dayBase);
  const end = Math.min(row.end,dayEnd);
  if(!(end > start))return [];
  return [{start,end}];
}

// PURE: day-local wall-clock bounds. An interval ENDING at midnight must map
// to minute 1440 (not 0) or overnight/late rows collapse to the day top.
function weekViewMinuteBounds(start,end,dayBase){
  const dayEnd = offsetCalendarDay(dayBase,1);
  const s = Math.max(start,dayBase);
  const e = Math.min(end,dayEnd);
  if(!(e > s))return null;
  return {
    start:s,
    end:e,
    topMin:s === dayBase ? 0 : weekViewMinuteOfDay(s),
    botMin:e === dayEnd ? 1440 : weekViewMinuteOfDay(e)
  };
}

// PURE: deterministic topic → color-token map built from the FULL saved
// catalog before any filtering, so colors stay stable as filters change.
// Topics missing from the catalog fall back to a string hash.
function weekViewTopicTokenMap(settings){
  const map = new Map();
  const catalog = (settings && Array.isArray(settings.topics)) ? settings.topics : [];
  catalog.forEach((topic,i)=>{
    const key = String(topic || '').trim().toLowerCase();
    if(key && !map.has(key))map.set(key,EMOJI_BG_COLOR_TOKENS[i % EMOJI_BG_COLOR_TOKENS.length]);
  });
  return map;
}

// Color groups reuse the filter classifiers, so their labels mean the same
// thing here and in Filters. "When due" is relative to today, not the column.
function weekViewColorGroup(h,topicMap,settings){
  if(_weekViewColor === 'priority'){
    const key = itemFilterPriority(h);
    return {key,label:{important:'Important',normal:'Normal',wait:'Can wait'}[key],token:{important:'red',normal:'blue',wait:'slate'}[key]};
  }
  if(_weekViewColor === 'type'){
    const key = itemFilterKind(h);
    return {key,label:(FILTER_TYPE_CHOICES.find(choice=>choice.key === key) || {}).label || key,token:{habit:'teal',limit:'amber',stop:'red',task:'blue',event:'purple'}[key] || 'slate'};
  }
  if(_weekViewColor === 'when'){
    const key = itemFilterStatus(h);
    return {key,label:{overdue:'Overdue',today:'Due today',soon:'Coming up',later:'Not due yet'}[key],token:{overdue:'red',today:'amber',soon:'blue',later:'slate'}[key]};
  }
  if(_weekViewColor === 'location'){
    const id = (h.locationIds || [])[0];
    const locations = settings && settings.locations || [];
    const place = locations.find(loc=>loc.id === id);
    const index = locations.findIndex(loc=>loc.id === id);
    return {key:id || 'none',label:place ? place.name : 'Anywhere',token:index >= 0 ? EMOJI_BG_COLOR_TOKENS[index % EMOJI_BG_COLOR_TOKENS.length] : 'slate'};
  }
  const topics = normalizeTopics(h.topics);
  const name = topics[0] || '';
  const key = name.trim().toLowerCase();
  return {key:key || 'none',label:name || 'No topic',token:key ? topicMap.get(key) || weekViewHashToken(key) : 'slate'};
}

function weekViewHashToken(key){
  let hash = 5381;
  for(let i = 0;i < key.length;i += 1)hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  return EMOJI_BG_COLOR_TOKENS[Math.abs(hash) % EMOJI_BG_COLOR_TOKENS.length];
}

// PURE: color for one habit — primary topic token, else its own emoji color,
// else slate. Kind distinctions (busy/travel/active) never ride on color
// alone; the renderer labels them separately.
function weekViewTokenFor(h,topicMap){
  const topics = typeof normalizeTopics === 'function' ? normalizeTopics(h && h.topics) : [];
  if(topics.length){
    const key = String(topics[0]).trim().toLowerCase();
    if(key)return topicMap.get(key) || weekViewHashToken(key);
  }
  return normalizeEmojiBgColor(h && h.emojiBgColor) || 'slate';
}

// PURE: greedy interval-graph lane assignment per overlap cluster. Order is
// deterministic (start, then end, then id) so identical input renders
// identically. Half-open intervals — an event ending when another starts does
// not overlap it (`row.topMin >= clusterEnd` below). Each event then expands
// rightward through columns it does not actually collide with, so a block is
// only as narrow as its real overlap. Busy blocks never consume event lanes;
// they render as a separate hatched layer.
function weekViewAssignLanes(rows){
  const sorted = [...rows].sort((a,b)=>a.topMin - b.topMin || a.botMin - b.botMin || (a.id < b.id ? -1 : 1));
  const out = [];
  let cluster = [];
  let active = []; // lane → botMin
  let clusterEnd = -1;
  const flush = ()=>{
    const lanes = Math.max(1,active.length);
    cluster.forEach(r=>{
      r.lanes = lanes;
      let span = 1;
      for(let col = r.lane + 1;col < lanes;col += 1){
        const blocked = cluster.some(o=>o !== r && o.lane === col && o.topMin < r.botMin && r.topMin < o.botMin);
        if(blocked)break;
        span += 1;
      }
      r.span = span;
      out.push(r);
    });
    cluster = [];
    active = [];
    clusterEnd = -1;
  };
  for(const row of sorted){
    if(cluster.length && row.topMin >= clusterEnd)flush();
    let lane = active.findIndex(bot=>bot <= row.topMin);
    if(lane < 0)lane = active.length;
    active[lane] = row.botMin;
    row.lane = lane;
    cluster.push(row);
    clusterEnd = Math.max(clusterEnd,row.botMin);
  }
  flush();
  return out;
}

// PURE: true when two laid-out rows paint in the same horizontal band.
// A row with no lane (travel) occupies the whole column.
function weekViewLanesShare(a,b){
  if(!a || !b)return false;
  if(a.lane == null || b.lane == null)return true;
  const spanOf = row=>{
    const lane = Math.max(0,row.lane || 0);
    const lanes = Math.max(lane + 1,row.lanes || 1);
    const span = Math.max(1,Math.min(row.span || 1,lanes - lane));
    return [lane,lane + span];
  };
  const [a0,a1] = spanOf(a);
  const [b0,b1] = spanOf(b);
  return a0 < b1 && b0 < a1;
}

// PURE: give a short block a little empty room so its title fits, and stop
// at the next event or travel that shares its columns. Never draw across a
// neighbor, and never shorten an interval that really does overlap.
function weekViewFitVisualEnds(events,obstacles,minMinutes){
  const min = Number.isFinite(minMinutes) ? minMinutes : 16;
  const extras = Array.isArray(obstacles) ? obstacles : [];
  (events || []).forEach(ev=>{
    if(!ev || !Number.isFinite(ev.topMin) || !Number.isFinite(ev.botMin))return;
    const trueEnd = ev.botMin;
    let end = ev.topMin + Math.max(trueEnd - ev.topMin,min);
    const blocks = [];
    (events || []).forEach(other=>{ if(other && other !== ev)blocks.push(other); });
    extras.forEach(other=>{ if(other)blocks.push(other); });
    blocks.forEach(other=>{
      if(!Number.isFinite(other.topMin) || !weekViewLanesShare(ev,other))return;
      if(other.topMin > ev.topMin && other.topMin < end && other.topMin >= trueEnd){
        end = Math.min(end,other.topMin);
      }
    });
    ev.visBotMin = Math.max(trueEnd,end);
  });
  return events;
}

// ─────────────────────────────────────────────────────────────────────────
// PURE elastic list. Readable height wins over a straight minute→pixel map.
// Short travel is a fixed-height connector. Gaps give up the space.
// Identical input (including which long gaps are open) lays out identically.
// ─────────────────────────────────────────────────────────────────────────
const WEEK_VIEW_LIST_SCALE = 1.2;
const WEEK_VIEW_RAIL_PX = 64;

function weekViewSpanPhrase(mins){
  const m = Math.max(0,Math.round(mins));
  if(m < 60)return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function weekViewHoursLabel(mins){
  const m = Math.max(0,mins);
  if(m <= 0)return '0h';
  const h = m / 60;
  if(h < 10)return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

function weekViewLoadLabel(mins){
  const h = Math.max(0,mins) / 60;
  const rounded = Math.round(h * 10) / 10;
  if(rounded <= 0)return '0h';
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

function weekViewFreePhrase(mins){
  const m = Math.max(0,Math.round(mins));
  if(m < 60)return `${m} min free`;
  return `${weekViewSpanPhrase(m)} free`;
}

// The rail is one narrow column. "10:45 AM" wraps there, so the rail uses
// a compact clock and the card keeps the full range when it has the room.
function weekViewRailClock(min){
  const whole = Math.max(0,Math.round(min));
  const hour24 = Math.floor(whole / 60) % 24;
  const minute = whole % 60;
  const hour = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? 'a' : 'p';
  return minute ? `${hour}:${String(minute).padStart(2,'0')}${suffix}` : `${hour}${suffix}`;
}

function weekViewMinuteLabel(min){
  const whole = Math.max(0,Math.round(min));
  const hour = Math.floor(whole / 60) % 24;
  const minute = whole % 60;
  return new Date(2026,0,1,hour,minute).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

function weekViewPlaceName(locationId,settings){
  if(!locationId || !settings || !Array.isArray(settings.locations))return '';
  const loc = settings.locations.find(row=>row && row.id === locationId);
  return loc && loc.name ? String(loc.name).trim() : '';
}

function weekViewSegmentsFromRows(rows){
  const out = [];
  if(!rows)return out;
  (rows.events || []).forEach(ev=>{
    if(ev && ev.botMin > ev.topMin)out.push({id:ev.id,kind:'habit',topMin:ev.topMin,botMin:ev.botMin});
  });
  (rows.busy || []).forEach(b=>{
    if(b && b.botMin > b.topMin)out.push({id:b.id,kind:'busy',topMin:b.topMin,botMin:b.botMin});
  });
  (rows.travel || []).forEach(tr=>{
    if(tr && tr.botMin > tr.topMin)out.push({
      id:tr.id,kind:'travel',topMin:tr.topMin,botMin:tr.botMin,
      mins:tr.mins
    });
  });
  return out;
}

function weekViewElasticItemHeight(seg,scale,minHabit,minBusy){
  const dur = Math.max(0,seg.botMin - seg.topMin);
  if(seg.kind === 'travel'){
    const mins = Number.isFinite(seg.mins) && seg.mins > 0 ? seg.mins : dur;
    if(mins <= 10)return {h:24,tier:'short'};
    if(mins <= 30)return {h:32,tier:'mid'};
    return {h:Math.max(52,Math.round(dur * scale)),tier:'long'};
  }
  if(seg.kind === 'busy'){
    // Overnight blocks like sleep are many hours. Past 90 minutes they ease
    // off so the block stays obviously long without filling the screen.
    const linear = Math.round(dur * scale);
    if(dur <= 90)return {h:Math.max(minBusy,linear),tier:'block'};
    const eased = Math.round(90 * scale + Math.log2(dur / 90) * 28);
    return {h:Math.min(148,Math.max(minBusy,eased)),tier:'block'};
  }
  return {h:Math.max(minHabit,Math.round(dur * scale)),tier:'block'};
}

function weekViewGapSpec(mins,scale,open){
  const m = Math.max(0,mins);
  if(m <= 0)return {h:2,kind:'seam',label:''};
  if(m < 5)return {h:6,kind:'tight',label:''};
  if(m <= 30)return {h:Math.max(20,Math.round(m * scale * 0.6)),kind:'short',label:`${Math.round(m)} min free`};
  if(m <= 90){
    return {
      h:Math.max(28,Math.round(28 + Math.log2(m / 30) * 24)),
      kind:'mid',
      label:`${weekViewSpanPhrase(m)} free`
    };
  }
  if(!open)return {h:44,kind:'collapsed',label:`${weekViewSpanPhrase(m)} free`};
  return {h:Math.max(44,Math.round(m * scale)),kind:'open',label:`${weekViewSpanPhrase(m)} free`};
}

function weekViewClusterSegments(segments){
  const sorted = [...segments].filter(seg=>seg && seg.botMin > seg.topMin).sort((a,b)=>{
    return a.topMin - b.topMin || a.botMin - b.botMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const blocks = [];
  let cur = null;
  const flush = ()=>{ if(cur){blocks.push(cur);cur = null;} };
  sorted.forEach(seg=>{
    if(!cur){
      cur = {start:seg.topMin,end:seg.botMin,items:[seg]};
      return;
    }
    if(seg.topMin >= cur.end){
      flush();
      cur = {start:seg.topMin,end:seg.botMin,items:[seg]};
      return;
    }
    cur.items.push(seg);
    cur.end = Math.max(cur.end,seg.botMin);
  });
  flush();
  return blocks;
}

function weekViewGapTicks(startMin,endMin,y,h){
  if(!(h >= 28) || !(endMin > startMin))return [];
  const ticks = [];
  const firstHour = Math.floor(startMin / 60) + 1;
  for(let hour = firstHour;hour * 60 < endMin;hour += 1){
    const min = hour * 60;
    if(min <= startMin || min >= endMin)continue;
    const tickY = y + (min - startMin) / (endMin - startMin) * h;
    if(tickY < y + 14 || tickY > y + h - 14)continue;
    if(ticks.length && tickY - ticks[ticks.length - 1].y < 18)continue;
    ticks.push({y:Math.round(tickY),label:weekViewRailClock(hour * 60)});
  }
  return ticks;
}

// PURE: lay a day's segments out so nothing paints over its neighbor.
// `openGaps` is a Set of gap ids the user has expanded to true scale.
function weekViewElasticLayout(segments,options){
  const opts = options || {};
  const scale = Number.isFinite(opts.scale) ? opts.scale : WEEK_VIEW_LIST_SCALE;
  const minHabit = Number.isFinite(opts.minHabit) ? opts.minHabit : 52;
  const minBusy = Number.isFinite(opts.minBusy) ? opts.minBusy : 44;
  const openGaps = opts.openGaps && typeof opts.openGaps.has === 'function' ? opts.openGaps : null;
  const prefix = opts.gapPrefix || '';
  const capacityMin = Number.isFinite(opts.capacityMin) && opts.capacityMin > 0 ? opts.capacityMin : 16 * 60;
  const blocks = weekViewClusterSegments(segments || []);
  const empty = ()=>({
    height:88,items:[],chains:[],plannedMin:0,freeMin:0,status:'light',
    chainCount:0,conflictCount:0,blockCount:0,ratio:0,empty:true,timeToY:()=>8
  });
  if(!blocks.length)return empty();

  const sizeOf = seg=>weekViewElasticItemHeight(seg,scale,minHabit,minBusy);
  const items = [];
  const anchors = [];
  let y = 8;
  let freeMin = 0;
  let conflictCount = 0;

  const pushSpan = (startMin,endMin,y0,y1)=>{
    anchors.push({min:startMin,y:y0});
    anchors.push({min:endMin,y:y1});
  };

  blocks.forEach((block,index)=>{
    if(index > 0){
      const prev = blocks[index - 1];
      const gapMin = Math.max(0,block.start - prev.end);
      const id = `gap|${prefix}|${prev.end}|${block.start}`;
      const spec = weekViewGapSpec(gapMin,scale,Boolean(openGaps && openGaps.has(id)));
      const gap = {
        type:'gap',id,kind:spec.kind,label:spec.label,mins:gapMin,
        y,h:spec.h,startMin:prev.end,endMin:block.start,ticks:[]
      };
      if(spec.label && spec.h >= 28)gap.ticks = weekViewGapTicks(gap.startMin,gap.endMin,gap.y,gap.h);
      items.push(gap);
      pushSpan(gap.startMin,gap.endMin,gap.y,gap.y + gap.h);
      freeMin += gapMin;
      y += gap.h;
    }
    if(block.items.length === 1){
      const seg = block.items[0];
      const sized = sizeOf(seg);
      const dur = Math.max(0,seg.botMin - seg.topMin);
      const type = seg.kind === 'busy' ? 'busy' : seg.kind === 'travel' ? 'travel' : 'habit';
      const item = {
        type,id:seg.id,y,h:sized.h,tier:sized.tier,
        startMin:seg.topMin,endMin:seg.botMin,mins:seg.mins,
        showMeta:type === 'habit' && sized.h >= 68,
        fill:type === 'habit' ? Math.round(Math.max(0,Math.min(100,dur / 120 * 100))) : 0
      };
      items.push(item);
      pushSpan(item.startMin,item.endMin,item.y,item.y + item.h);
      y += item.h;
      return;
    }
    conflictCount += 1;
    const header = 22;
    const padB = 6;
    const innerGap = 4;
    let cy = y + header;
    const children = block.items.map((seg,childIndex)=>{
      const sized = sizeOf(seg);
      const dur = Math.max(0,seg.botMin - seg.topMin);
      const type = seg.kind === 'busy' ? 'busy' : seg.kind === 'travel' ? 'travel' : 'habit';
      const child = {
        type,id:seg.id,y:cy,h:sized.h,tier:sized.tier,
        startMin:seg.topMin,endMin:seg.botMin,mins:seg.mins,
        showMeta:type === 'habit' && sized.h >= 68,
        fill:type === 'habit' ? Math.round(Math.max(0,Math.min(100,dur / 120 * 100))) : 0
      };
      cy += sized.h;
      if(childIndex < block.items.length - 1)cy += innerGap;
      return child;
    });
    const item = {
      type:'conflict',id:`cf|${block.items.map(seg=>seg.id).join('|')}`,
      y,h:cy + padB - y,startMin:block.start,endMin:block.end,children
    };
    items.push(item);
    pushSpan(item.startMin,item.endMin,item.y,item.y + item.h);
    y += item.h;
  });

  const blocksOnly = items.filter(item=>item.type !== 'gap');
  blocksOnly.forEach((item,index)=>{
    const next = blocksOnly[index + 1];
    item.nextStart = next ? next.startMin : null;
    if(item.children)item.children.forEach(child=>{ child.nextStart = item.nextStart; });
  });

  const chains = [];
  let run = null;
  const closeRun = ()=>{
    if(run && run.count >= 2){
      const span = run.endMin - run.startMin;
      chains.push({
        y:run.y,
        h:Math.max(0,run.bottom - run.y),
        startMin:run.startMin,
        endMin:run.endMin,
        label:span >= 60 ? `${weekViewSpanPhrase(span)} nonstop` : ''
      });
    }
    run = null;
  };
  items.forEach(item=>{
    if(item.type === 'gap'){
      if(item.mins > 0)closeRun();
      return;
    }
    if(item.type === 'travel' || item.type === 'conflict'){
      closeRun();
      return;
    }
    if(!run){
      run = {y:item.y,bottom:item.y + item.h,startMin:item.startMin,endMin:item.endMin,count:1};
      return;
    }
    run.bottom = item.y + item.h;
    run.endMin = item.endMin;
    run.count += 1;
  });
  closeRun();

  let plannedMin = 0;
  (segments || []).forEach(seg=>{
    if(seg && seg.kind === 'habit')plannedMin += Math.max(0,seg.botMin - seg.topMin);
  });
  const blockCount = blocksOnly.length;
  let status = '';
  if(conflictCount > 0)status = 'overlap';
  else if(blockCount >= 2 && (freeMin < 30 || chains.length >= 3))status = 'tight';
  else if(plannedMin < 180)status = 'light';
  const ratio = blockCount >= 2
    ? plannedMin / Math.max(1,plannedMin + freeMin)
    : plannedMin / Math.max(1,capacityMin);

  const timeToY = min=>{
    if(!anchors.length)return 8;
    if(min <= anchors[0].min)return anchors[0].y;
    for(let i = 1;i < anchors.length;i += 1){
      const a = anchors[i - 1];
      const b = anchors[i];
      if(min > b.min)continue;
      if(b.min <= a.min)continue;
      const t = (min - a.min) / (b.min - a.min);
      return a.y + t * (b.y - a.y);
    }
    return anchors[anchors.length - 1].y;
  };

  return {
    height:y + 16,
    items,chains,plannedMin,freeMin,status,
    chainCount:chains.length,conflictCount,blockCount,ratio,
    empty:false,timeToY
  };
}

// A single elastic clock for every visible day. Boundary positions form a
// forward graph: time always increases, and every row adds a minimum-height
// constraint. Solving it once prevents each day's gaps from drifting apart.
function weekViewSharedTimeAxis(dayRows){
  const segments = dayRows.flatMap(rows=>weekViewSegmentsFromRows(rows));
  const boundaries = new Set([0,1440]);
  for(let minute = 0;minute <= 1440;minute += 60)boundaries.add(minute);
  segments.forEach(seg=>{boundaries.add(seg.topMin);boundaries.add(seg.botMin);});
  const minutes = [...boundaries].sort((a,b)=>a-b);
  const indices = new Map(minutes.map((minute,i)=>[minute,i]));
  const incoming = new Map();
  segments.forEach(seg=>{
    const end = indices.get(seg.botMin);
    const sized = weekViewElasticItemHeight(seg,0.9,48,38);
    if(!incoming.has(end))incoming.set(end,[]);
    incoming.get(end).push({start:indices.get(seg.topMin),height:sized.h + 4});
  });
  // Compress only spans that are free across ALL visible days. Busy-only
  // time eases off; an event on any day restores enough space for its card.
  const spans = [];
  for(let i = 1;i < minutes.length;i += 1){
    const start = minutes[i-1], end = minutes[i];
    const active = segments.filter(seg=>seg.topMin < end && seg.botMin > start);
    const kind = active.some(seg=>seg.kind !== 'busy') ? 'event' : active.length ? 'busy' : 'free';
    const last = spans[spans.length - 1];
    if(last && last.kind === kind)last.end = end;
    else spans.push({start,end,kind});
  }
  const positions = [8];
  let spanIndex = 0;
  for(let i = 1;i < minutes.length;i += 1){
    while(spans[spanIndex].end < minutes[i])spanIndex += 1;
    const span = spans[spanIndex];
    const duration = span.end - span.start;
    const height = span.kind === 'free' ? Math.min(72,Math.max(24,duration * 0.35))
      : span.kind === 'busy' ? Math.min(148,Math.max(38,duration * 0.45)) : duration * 0.9;
    let y = positions[i-1] + (minutes[i] - minutes[i-1]) * height / duration;
    (incoming.get(i) || []).forEach(edge=>{y = Math.max(y,positions[edge.start] + edge.height);});
    positions.push(y);
  }
  const timeToY = minute=>{
    const min = Math.max(0,Math.min(1440,minute));
    let i = minutes.findIndex(boundary=>boundary >= min);
    if(i <= 0)return positions[0];
    return positions[i-1] + (min - minutes[i-1]) / (minutes[i] - minutes[i-1]) * (positions[i] - positions[i-1]);
  };
  const yToTime = y=>{
    const i = positions.findIndex(position=>position >= y);
    if(i <= 0)return i === 0 ? 0 : 1440;
    return minutes[i-1] + (y - positions[i-1]) / (positions[i] - positions[i-1]) * (minutes[i] - minutes[i-1]);
  };
  // Keep labels at least 28px apart in compressed gaps.
  let lastY = -Infinity;
  const ticks = minutes.filter(minute=>minute % 60 === 0 && minute < 1440).flatMap(minute=>{
    const y = timeToY(minute);
    if(y - lastY < 28)return [];
    lastY = y;
    return [{minute,y,label:weekViewRailClock(minute)}];
  });
  return {height:positions[positions.length-1]+12,timeToY,yToTime,ticks};
}

function weekViewAlignedColumnHtml(day,rows,axis,todayKey){
  const pos = row=>`top:${axis.timeToY(row.topMin)}px;height:${Math.max(2,axis.timeToY(row.botMin)-axis.timeToY(row.topMin)-4)}px;`;
  const events = weekViewAssignLanes(rows.events.map(row=>({...row}))).map(ev=>{
    const box = {y:axis.timeToY(ev.topMin),h:axis.timeToY(ev.botMin)-axis.timeToY(ev.topMin)-4,fill:100,startMin:ev.topMin,endMin:ev.botMin,showMeta:true};
    const html = weekViewListHabitHtml(ev,box,false);
    const lanes = ev.lanes || 1;
    return html.replace('left:1px;right:1px;',`left:calc(${ev.lane} * 100% / ${lanes} + 2px);width:calc(${ev.span} * 100% / ${lanes} - 4px);`);
  }).join('');
  const busy = rows.busy.map(block=>{
    _weekViewCtx.set(block.id,block);
    return `<button type="button" class="wv-busy" data-wv-busy="${escapeHtml(block.id)}" style="${pos(block)}left:2px;right:2px;" aria-label="${escapeHtml(`busy, ${block.label}, ${weekViewTimeLabel(block.start)} – ${weekViewTimeLabel(block.end)}`)}"><span class="wv-busy-label"><i class="ti ti-lock" aria-hidden="true"></i><span>${escapeHtml(block.label)}</span></span></button>`;
  }).join('');
  const travel = rows.travel.map(leg=>{
    _weekViewCtx.set(leg.id,leg);
    return `<button type="button" class="wv-travel" data-wv-travel="${escapeHtml(leg.id)}" style="${pos(leg)}left:3px;right:3px;" aria-label="${escapeHtml(`${leg.mins} minutes, ${leg.fromName} to ${leg.toName}`)}"><i class="ti ti-route" aria-hidden="true"></i><span>${leg.mins}m · ${escapeHtml(leg.toName || 'travel')}</span></button>`;
  }).join('');
  const lines = axis.ticks.map(tick=>`<i class="wv-line" style="top:${tick.y}px"></i>`).join('');
  const now = day.dayKey === todayKey ? `<div class="wv-nowline" data-wv-elastic-now="${day.dayKey}" style="top:${axis.timeToY(weekViewMinuteOfDay(Date.now()))}px"><i></i></div>` : '';
  return `<div class="wv-col is-aligned${day.dayKey === todayKey ? ' is-today' : ''}${day.dayKey === weekViewDaySel ? ' is-selected' : ''}" data-wv-daycol="${day.dayKey}"><div class="wv-list" style="height:${axis.height}px">${lines}${busy}${travel}${events}${now}</div></div>`;
}

function weekViewCapacityMinutes(dayBase,settings,rows){
  const dow = new Date(dayBase).getDay();
  let avail = 16 * 60;
  if(settings && Array.isArray(settings.availabilityMinutes)){
    const value = Number(settings.availabilityMinutes[dow]);
    if(Number.isFinite(value) && value > 0)avail = value;
  }
  const busy = (rows && rows.busy || []).reduce((sum,block)=>sum + Math.max(0,(block.botMin || 0) - (block.topMin || 0)),0);
  return Math.max(60,avail - busy);
}

function weekViewLayoutFor(rows,dayKey,dayBase,settings,opts){
  return weekViewElasticLayout(weekViewSegmentsFromRows(rows),Object.assign({
    gapPrefix:dayKey || '',
    openGaps:_weekViewOpenGaps,
    capacityMin:weekViewCapacityMinutes(dayBase,settings,rows)
  },opts || {}));
}

// ─────────────────────────────────────────────────────────────────────────
// PURE row adapter: one planner day → renderable events / busy / travel /
// markers / unplaced. Works on copies; never mutates the cached week.
// ─────────────────────────────────────────────────────────────────────────
function weekCalendarRows(day,data,settings,topicMap,visibleHids){
  const out = {events:[],busy:[],travel:[],markers:[],unplaced:[]};
  if(!day || !Number.isFinite(day.dayBase))return out;
  const now = Date.now();
  const dayKey = dateKey(day.dayBase);
  const placed = new Set();

  // Travel legs + habit rows reuse home's sequence on a copied day. The copy
  // guarantees Home's cached timeline/homeDisplayedTimeline stay untouched;
  // its doing-now reorder is harmless because layout positions by time.
  const seq = typeof homeDaySequence === 'function'
    ? homeDaySequence({...day,timeline:[...(day.timeline || [])]},settings,{})
    : [...(day.timeline || [])];

  seq.forEach((raw,idx)=>{
    if(raw.kind === 'fill' || raw.kind === 'scheduled'){
      const h = raw.h || data[raw.i] || null;
      if(h && h.hid)placed.add(h.hid);
      if(!h || (visibleHids && !visibleHids.has(h.hid)))return;
      const bounds = weekViewMinuteBounds(raw.start,raw.end,day.dayBase);
      if(!bounds)return;
      out.events.push({
        id:`ev|${h.hid}|${raw.occurrenceKey || ''}|${raw.chunkIndex || 0}|${bounds.start}`,
        kind:raw.kind,
        hid:h.hid,
        i:raw.i,
        h,
        title:h.name || 'habit',
        emoji:h.emoji || '',
        token:weekViewColorGroup(h,topicMap,settings).token,
        start:bounds.start,
        end:bounds.end,
        status:raw.end <= now ? 'past' : 'planned',
        chunkMinutes:raw.chunkMinutes || null,
        place:weekViewPlaceName(raw.locationId,settings),
        spansNext:raw.end > offsetCalendarDay(day.dayBase,1),
        rawEnd:raw.end,
        topMin:bounds.topMin,
        botMin:bounds.botMin
      });
    }
  });

  // Travel legs come from two places: the planner's committed rows inside
  // day.timeline (worker weeks / homeDisplayedTimeline) and the legs
  // homeDaySequence generates for location changes. The generated set is the
  // superset check for visibility; both are merged and deduped by identity.
  const legs = [];
  const pushLeg = raw=>{
    if(!raw)return;
    const id = `tr|${raw.from || ''}|${raw.to || ''}|${raw.start}|${raw.end}`;
    if(legs.some(leg=>leg.id === id))return;
    // Show a leg only when the habit row it leads into survives filtering.
    // Today's home sequence clamps a past leave-by up to "now", which puts
    // start after end. The arrival (`end`) is still the real destination, so
    // seek from whichever edge is earlier and draw the planned window.
    const rawStart = Number(raw.start);
    const rawEnd = Number(raw.end);
    const seek = Number.isFinite(rawStart) && Number.isFinite(rawEnd) ? Math.min(rawStart,rawEnd) : rawStart;
    let nextH = null;
    for(let k = 0;k < seq.length;k += 1){
      const r = seq[k];
      if(r && (r.kind === 'fill' || r.kind === 'scheduled') && r.start >= seek){
        nextH = r.h || data[r.i] || null;
        break;
      }
    }
    if(!nextH || (visibleHids && !(nextH.hid && visibleHids.has(nextH.hid))))return;
    let travelStart = rawStart;
    let travelEnd = rawEnd;
    if(!(travelEnd > travelStart) && Number(raw.seconds) > 0 && Number.isFinite(travelEnd)){
      travelStart = travelEnd - Number(raw.seconds) * 1000;
    }
    const bounds = weekViewMinuteBounds(travelStart,travelEnd,day.dayBase);
    if(!bounds)return;
    legs.push({
      id,
      fromId:raw.from || '',
      toId:raw.to || '',
      fromName:raw.fromName || '',
      toName:raw.toName || '',
      seconds:raw.seconds || 0,
      start:bounds.start,
      end:bounds.end,
      fromCurrent:Boolean(raw.fromCurrentCoord),
      dayKey,
      topMin:bounds.topMin,
      botMin:bounds.botMin,
      mins:Math.max(1,Math.round((raw.seconds || 0) / 60))
    });
  };
  (day.timeline || []).forEach(row=>{ if(row && row.kind === 'travel')pushLeg(row); });
  seq.forEach(row=>{ if(row && row.kind === 'travel')pushLeg(row); });
  legs.sort((a,b)=>a.start - b.start || (a.id < b.id ? -1 : 1));
  out.travel = legs;

  // Busy time stays visible regardless of filters — it still reserves real
  // capacity. Unclipped so the grid shows the whole day (unlike the home
  // list, which hides past-finished blocks on today).
  (typeof blockedTimelineRows === 'function'
    ? blockedTimelineRows(dayKey,settings,day.dayBase,{})
    : []).forEach(b=>{
    const bounds = weekViewMinuteBounds(b.start,b.end,day.dayBase);
    if(!bounds)return;
    out.busy.push({
      id:`busy|${b.blockSignature}|${b.start}`,
      label:b.label || 'busy',
      start:bounds.start,
      end:bounds.end,
      row:b,
      topMin:bounds.topMin,
      botMin:bounds.botMin
    });
  });

  // Active session: represented distinctly, replacing the matching planned
  // row rather than duplicating it.
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  if(doing && doing.hid && dayStart(Number(doing.startedAt) || now) === day.dayBase){
    const h = data.find(item=>item && item.hid === doing.hid);
    if(h && (!visibleHids || visibleHids.has(h.hid))){
      const start = Number(doing.startedAt) || now;
      const end = Number(doing.targetAt) || start + Math.max(1,Number(doing.sessionMinutes) || 30) * 60000;
      const live = out.events.find(ev=>ev.hid === h.hid);
      const bounds = weekViewMinuteBounds(start,end,day.dayBase);
      if(live && bounds){
        live.status = 'active';
        live.start = bounds.start;
        live.end = bounds.end;
        live.spansNext = end > day.dayBase + 86400000;
        live.rawEnd = end;
        live.topMin = bounds.topMin;
        live.botMin = bounds.botMin;
      }else if(bounds){
        out.events.push({
          id:`ev|${h.hid}|active|${start}`,
          kind:'active',
          hid:h.hid,
          i:data.indexOf(h),
          h,
          title:h.name || 'habit',
          emoji:h.emoji || '',
          token:weekViewColorGroup(h,topicMap,settings).token,
          start:bounds.start,
          end:bounds.end,
          status:'active',
          chunkMinutes:null,
          place:'',
          spansNext:end > day.dayBase + 86400000,
          rawEnd:end,
          topMin:bounds.topMin,
          botMin:bounds.botMin
        });
      }
    }
  }

  // Untimed date markers (due / deadline / plan-by). habitPlanMarkers also
  // returns timed 'scheduled' markers — those are grid rows already, so only
  // untimed kinds go on the strip. A due marker may coexist with a timed
  // session for the same habit: they say different things.
  if(typeof habitPlanMarkers === 'function'){
    data.forEach(h=>{
      if(!h || (visibleHids && !visibleHids.has(h.hid)))return;
      habitPlanMarkers(h).forEach(marker=>{
        if(marker.kind === 'scheduled')return;
        if(dateKey(marker.ts) !== dayKey)return;
        const id = `mk|${h.hid}|${marker.kind}|${marker.ts}`;
        if(out.markers.some(m=>m.id === id))return;
        out.markers.push({
          id,
          hid:h.hid,
          i:data.indexOf(h),
          kind:marker.kind,
          ts:marker.ts,
          title:h.name || 'habit',
          token:weekViewColorGroup(h,topicMap,settings).token
        });
      });
    });
  }

  // Unplaced candidates for this day stay visible ("Not scheduled") — never
  // dropped silently, never given invented times.
  (day.agendaItems || []).forEach(item=>{
    const h = item && item.h;
    if(!h || !h.hid || placed.has(h.hid))return;
    if(visibleHids && !visibleHids.has(h.hid))return;
    if(out.unplaced.some(u=>u.hid === h.hid))return;
    out.unplaced.push({
      hid:h.hid,
      i:data.indexOf(h),
      title:h.name || 'habit',
      emoji:h.emoji || '',
      token:weekViewColorGroup(h,topicMap,settings).token
    });
  });

  weekViewAssignLanes(out.events);
  weekViewFitVisualEnds(out.events,out.travel,16);
  return out;
}

// PURE: local date arithmetic — rolling windows must cross midnight and DST
// by calendar days, never by raw millisecond offsets.
function weekViewRangeDays(offset){
  const days = [];
  const start = offsetCalendarDay(Date.now(),offset);
  for(let i = 0;i < 7;i += 1){
    const dayBase = offsetCalendarDay(start,i);
    days.push({dayBase,dayKey:dateKey(dayBase)});
  }
  return days;
}

// PURE: "Nov 15 – 21"
function weekViewRangeLabel(days){
  const start = new Date(days[0].dayBase), end = new Date(days[days.length-1].dayBase);
  const fmt = date=>date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
    ? `${fmt(start)}–${end.getDate()}` : `${fmt(start)}–${fmt(end)}`;
}

function weekViewMarkerLabel(kind){
  if(kind === 'deadline')return 'Deadline';
  if(kind === 'planBy')return 'Plan by';
  return 'Due';
}

function weekViewTimeLabel(ts){
  return new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

// PURE: inline custom properties resolving a color token to its theme vars.
// Emitting var() references keeps dark mode and palettes automatic.
function weekViewTokenVars(token){
  const safe = /^[a-z]+$/.test(token) ? token : 'slate';
  return `--wv-token-bg:var(--${safe}-bg);--wv-token-icon:var(--${safe}-icon);--wv-token-text:var(--${safe}-text);`;
}

// ─────────────────────────────────────────────────────────────────────────
// Preview worker: same script as the foreground planner worker, but a
// dedicated instance. The shared worker serializes every request and keeps
// planner memo state, so a long preview must never travel through it.
// ─────────────────────────────────────────────────────────────────────────
let _weekPreviewWorker = null;
let _weekPreviewSeq = 0;
const _weekPreviewRequests = new Map();

function weekPreviewWorkerAvailable(){
  if(typeof Worker !== 'function')return false;
  if(typeof agendaPlannerWorkerAvailable === 'function')return agendaPlannerWorkerAvailable();
  return true;
}

function ensureWeekPreviewWorker(){
  if(_weekPreviewWorker)return _weekPreviewWorker;
  if(!weekPreviewWorkerAvailable())return null;
  let worker;
  try{
    worker = new Worker(`./js/agenda-planner-worker.js?${AGENDA_PLANNER_WORKER_ASSET_VERSION}`);
  }catch(err){
    console.warn('[overview-week] preview worker unavailable',err && err.message || err);
    return null;
  }
  worker.addEventListener('message',event=>{
    const message = event.data || {};
    const request = _weekPreviewRequests.get(message.id);
    if(!request)return;
    _weekPreviewRequests.delete(message.id);
    clearTimeout(request.timeoutId);
    if(message.error)request.reject(new Error(message.error));
    else if(message.week)request.resolve(message.week);
    else request.reject(new Error('preview planner returned no week'));
  });
  worker.addEventListener('error',error=>{
    const pending = [..._weekPreviewRequests.values()];
    _weekPreviewRequests.clear();
    _weekPreviewWorker = null;
    pending.forEach(request=>{
      clearTimeout(request.timeoutId);
      request.reject(new Error(error && error.message || 'preview worker failed'));
    });
  });
  _weekPreviewWorker = worker;
  return worker;
}

// Terminate preview-owned work only — Home's worker is never touched.
function terminateWeekPreviewWorker(){
  const pending = [..._weekPreviewRequests.values()];
  _weekPreviewRequests.clear();
  pending.forEach(request=>{
    clearTimeout(request.timeoutId);
    request.reject(new Error('week view closed'));
  });
  if(_weekPreviewWorker){
    const worker = _weekPreviewWorker;
    _weekPreviewWorker = null;
    try{worker.terminate();}catch(_){}
  }
}

function weekPreviewRequest(data,settings,numDays,mode,dirtyKey){
  const worker = ensureWeekPreviewWorker();
  if(!worker)return Promise.reject(new Error('preview planner unavailable'));
  const id = ++_weekPreviewSeq;
  return new Promise((resolve,reject)=>{
    const timeoutId = setTimeout(()=>{
      if(!_weekPreviewRequests.has(id))return;
      _weekPreviewRequests.delete(id);
      reject(new Error('preview planner timed out'));
    },AGENDA_PLANNER_WORKER_REQUEST_TIMEOUT_MS);
    _weekPreviewRequests.set(id,{resolve,reject,timeoutId});
    try{
      worker.postMessage({
        id,
        data,
        settings,
        numDays,
        mode,
        dirtyKey:dirtyKey || '',
        storage:plannerWorkerStorageSnapshot()
      });
    }catch(err){
      clearTimeout(timeoutId);
      _weekPreviewRequests.delete(id);
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Week resolution. Cache key = local start date + effective engine + planner
// dirty key. Overview filters affect rendering only, never planning.
// ─────────────────────────────────────────────────────────────────────────
const _weekViewCache = new Map();        // cacheKey → week
const _weekViewPending = new Map();      // cacheKey → Promise
const WEEK_VIEW_CACHE_MAX = 4;

function weekViewEffectiveMode(){
  const s = sortSettings || {};
  return Boolean(s.agendaOptimizer) && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())
    ? 'exact' : 'fast';
}

function weekViewCacheKey(startKey,mode,dirtyKey){
  return `${startKey}|${mode}|${dirtyKey}`;
}

function weekViewCachePut(key,week){
  if(_weekViewCache.has(key))_weekViewCache.delete(key);
  _weekViewCache.set(key,week);
  while(_weekViewCache.size > WEEK_VIEW_CACHE_MAX){
    const oldest = _weekViewCache.keys().next().value;
    _weekViewCache.delete(oldest);
  }
}

// Initial range: reuse Home's mounted week only when it actually covers
// today; the shared snapshot only when its revision key still matches.
// Presence alone establishes neither freshness nor coverage.
function weekViewInitialWeek(data){
  const todayKey = dateKey(Date.now());
  if(typeof weekForOverviewDay === 'function'){
    const covered = weekForOverviewDay(data,todayKey);
    if(covered && Array.isArray(covered.days) && covered.days.length)return covered;
  }
  if(typeof cachedOverviewWeek === 'function' && typeof overviewWeekCoversKey === 'function'){
    const cached = cachedOverviewWeek(data);
    if(cached && Array.isArray(cached.days) && cached.days.length && overviewWeekCoversKey(cached,todayKey))return cached;
  }
  return _weekViewCache.get(weekViewCacheKey(todayKey,'fast',homePlannerDirtyKey(data))) || null;
}

// Off-main fast fill for the initial range when neither source is usable.
// Same cost as the day sheet's fill; the shared snapshot is NOT overwritten.
function weekViewFillInitialWeek(data,gen){
  const key = weekViewCacheKey(dateKey(Date.now()),'fast',homePlannerDirtyKey(data));
  if(_weekViewCache.has(key))return null;
  if(_weekViewPending.has(key))return _weekViewPending.get(key);
  const promise = buildWeekAgendaOffMain(data,sortSettings,7,'fast',{fastGraph:true})
    .then(week=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      if(gen !== weekViewGen || !weekSheetOpen())return null;
      const live = typeof load === 'function' ? load() : data;
      if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,live);
      weekViewCachePut(key,week);
      return week;
    })
    .catch(err=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      throw err;
    });
  _weekViewPending.set(key,promise);
  return promise;
}

// Preview: fresh 14-day projection from the real current clock; days 7..13
// are displayed. Provisional by construction — never stored anywhere shared.
function weekViewEnsurePreviewWeek(data,gen){
  const mode = weekViewEffectiveMode();
  const startKey = dateKey(offsetCalendarDay(Date.now(),7));
  const key = weekViewCacheKey(startKey,mode,homePlannerDirtyKey(data));
  if(_weekViewCache.has(key))return null;
  if(_weekViewPending.has(key))return _weekViewPending.get(key);
  const promise = weekPreviewRequest(data,sortSettings,14,mode,homePlannerDirtyKey(data))
    .then(week=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      if(gen !== weekViewGen || !weekSheetOpen())return null;
      // Worker results arrive with habit references stripped; rebind against
      // the exact data snapshot that was planned so indices line up.
      if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,data);
      weekViewCachePut(key,week);
      return week;
    })
    .catch(err=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      throw err;
    });
  _weekViewPending.set(key,promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER. One normalized model drives both layouts, with a single clock across
// visible columns. Phones show 1–3 days; wide screens also offer seven.
// ─────────────────────────────────────────────────────────────────────────
let _weekViewCtx = new Map();          // element id → original row for actions
let _weekViewDirtyKey = '';
let _weekViewTodayKey = '';
let _weekViewLayout = 'phone';
let _weekViewBound = false;
let _weekViewTimer = null;
let _weekViewSwipeAt = 0;
let _weekViewScrollReset = true;
let _weekViewResize = null;
let _weekViewError = '';
let _weekViewMode = 'list';          // 'list' (elastic) or 'grid' (proportional)
let _weekViewOpenGaps = new Set();   // expanded long-gap ids, while the sheet is open
let _weekViewDetailLayout = null;    // selected day's elastic layout, for the now line
let _weekViewColumnLayouts = new Map();
let _weekViewRenderedDay = '';
let _weekViewPhoneDays = 1;
let _weekViewWideDays = 7;
let _weekViewZoom = 144;
let _weekViewColor = 'topic';
let _weekViewSharedAxis = null;
let _weekViewReturnFocus = null;
let _weekViewOpener = null;
let _weekViewWindowStart = 0;
let _weekViewOptionsOpen = false;
const WEEK_VIEW_PREFS_KEY = 'tings_week_view_v1';

function weekViewLoadPreferences(){
  try{
    const prefs = JSON.parse(localStorage.getItem(WEEK_VIEW_PREFS_KEY) || '{}');
    if(['grid','list'].includes(prefs.mode))_weekViewMode = prefs.mode;
    if([1,2,3].includes(prefs.days))_weekViewPhoneDays = prefs.days;
    if([1,2,3,7].includes(prefs.wideDays))_weekViewWideDays = prefs.wideDays;
    if(WEEK_VIEW_ZOOM_STEPS.includes(prefs.zoom))_weekViewZoom = prefs.zoom;
    if(['topic','location','type','when','priority'].includes(prefs.color))_weekViewColor = prefs.color;
  }catch(_){}
}

function weekViewSavePreferences(){
  try{localStorage.setItem(WEEK_VIEW_PREFS_KEY,JSON.stringify({mode:_weekViewMode,days:_weekViewPhoneDays,wideDays:_weekViewWideDays,zoom:_weekViewZoom,color:_weekViewColor}));}catch(_){}
}


function weekSheetOpen(){
  const sheet = $('week-sheet');
  return Boolean(sheet && sheet.classList.contains('open'));
}

function weekViewLayoutForWidth(width){
  // The split week (seven elastic columns + the selected day) needs real
  // width. Narrower windows, including a phone, keep one full-width day.
  return width >= 1100 ? 'desktop' : 'phone';
}

function weekViewDesktopLayout(){
  const sheet = document.querySelector('#week-sheet .week-view-sheet');
  return weekViewLayoutForWidth((sheet && sheet.clientWidth) || window.innerWidth);
}

function weekViewVisibleHids(data){
  const set = new Set();
  data.forEach(h=>{
    if(h && h.hid && typeof matchesOverviewFilters === 'function' && matchesOverviewFilters(h))set.add(h.hid);
  });
  return set;
}

function weekViewFiltersActive(){
  return overviewTopicFilter !== 'all' || overviewLocationFilter !== 'all'
    || overviewTypeFilter !== 'all' || overviewWhenFilter !== 'all' || overviewPriorityFilter !== 'all';
}

// Pixel height of a minute span at the current layout's hour scale.
function weekViewSpanPx(topMin,botMin){
  return Math.max(0,botMin - topMin) * weekViewHourPx() / 60;
}

// How much type a block can hold. Decided from the painted height, not the
// scheduled length, so a short item that grew into a gap can use the room
// and a tight neighbor never gets a second line it cannot fit.
function weekViewDensityClass(topMin,botMin){
  const px = weekViewSpanPx(topMin,botMin);
  if(px < 12)return 'is-micro';
  if(px < 44)return 'is-snug';
  if(px < 92)return 'is-regular';
  return 'is-tall';
}

// Leave a pixel of the column between back-to-back blocks so same-colored
// neighbors don't fuse. Below this, keep every pixel for the label.
function weekViewBandStyle(topMin,botMin){
  const durMin = Math.max(0,botMin - topMin);
  const gap = weekViewSpanPx(topMin,botMin) >= 18 ? 1 : 0;
  return `top:calc(${topMin} * var(--wv-hour-h) / 60);height:max(2px,calc(${durMin} * var(--wv-hour-h) / 60 - ${gap}px));`;
}

function weekViewLaneStyle(ev){
  const topMin = ev.topMin;
  const botMin = ev.visBotMin == null ? ev.botMin : ev.visBotMin;
  const lanes = Math.max(1,ev.lanes || 1);
  const lane = Math.max(0,Math.min(ev.lane || 0,lanes - 1));
  const span = Math.max(1,Math.min(ev.span || 1,lanes - lane));
  return `${weekViewBandStyle(topMin,botMin)}left:calc(${lane} * 100% / ${lanes} + 1px);width:calc(${span} * 100% / ${lanes} - 3px);`;
}

function weekViewEventTimeText(ev){
  const dur = Math.max(0,ev.botMin - ev.topMin);
  if(dur >= 75)return `${weekViewTimeLabel(ev.start)} – ${weekViewTimeLabel(ev.end)}`;
  return weekViewTimeLabel(ev.start);
}

// Snug rows put the clock on the same line as the name. Drop AM/PM so a
// long title keeps the width; the gutter and the tooltip still say which.
function weekViewCompactTime(ts){
  const d = new Date(ts);
  const hour = d.getHours() % 12 || 12;
  return `${hour}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function weekViewEventHtml(ev){
  const visBot = ev.visBotMin == null ? ev.botMin : ev.visBotMin;
  const density = weekViewDensityClass(ev.topMin,visBot);
  const narrow = (ev.span || 1) / Math.max(1,ev.lanes || 1) <= 0.5 ? ' is-narrow' : '';
  const statusCls = ev.status === 'active' ? ' is-active' : ev.status === 'past' ? ' is-past' : '';
  const when = `${weekViewTimeLabel(ev.start)} – ${weekViewTimeLabel(ev.end)}`;
  const label = `${when}, ${ev.title}`;
  _weekViewCtx.set(ev.id,ev);
  return `<button type="button" class="wv-event ${density}${narrow}${statusCls}" data-wv-event="${escapeHtml(ev.id)}" data-wv-hid="${escapeHtml(ev.hid || '')}" style="${weekViewTokenVars(ev.token)}${weekViewLaneStyle(ev)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(`${when} · ${ev.title}`)}">`
    + `<span class="wv-event-title">${ev.emoji ? `<span class="wv-event-emoji">${escapeHtml(ev.emoji)}</span>` : ''}<span class="wv-event-name">${escapeHtml(ev.title)}</span></span>`
    + `<span class="wv-event-time"><span class="wv-event-time-full">${escapeHtml(weekViewEventTimeText(ev))}</span><span class="wv-event-time-short">${escapeHtml(weekViewCompactTime(ev.start))}</span></span>`
    + (ev.status === 'active' ? '<span class="wv-event-flag">now</span>' : '')
    + `</button>`;
}

function weekViewBusyHtml(b){
  _weekViewCtx.set(b.id,b);
  const when = `${weekViewTimeLabel(b.start)} – ${weekViewTimeLabel(b.end)}`;
  const label = `${b.label}, ${when}`;
  const density = weekViewDensityClass(b.topMin,b.botMin);
  const text = density === 'is-tall' || density === 'is-regular' ? `${b.label} · ${weekViewTimeLabel(b.start)}` : b.label;
  return `<div class="wv-busy ${density}" data-wv-busy="${escapeHtml(b.id)}" role="button" tabindex="0" aria-label="${escapeHtml(`busy, ${label}`)}" title="${escapeHtml(label)}" style="${weekViewBandStyle(b.topMin,b.botMin)}left:1px;width:calc(100% - 2px);"><span class="wv-busy-label">${escapeHtml(text)}</span></div>`;
}

function weekViewTravelHtml(tr){
  _weekViewCtx.set(tr.id,tr);
  const label = `${tr.mins}m travel, ${tr.fromName || 'here'} to ${tr.toName || 'destination'}`;
  const density = weekViewDensityClass(tr.topMin,tr.botMin);
  return `<button type="button" class="wv-travel ${density}" data-wv-travel="${escapeHtml(tr.id)}" style="${weekViewBandStyle(tr.topMin,tr.botMin)}left:4px;width:calc(100% - 8px);" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><i class="ti ti-route" aria-hidden="true"></i><span>${tr.mins}m</span></button>`;
}

function weekViewGutterHtml(hourStep,nowMin){
  const cells = [];
  for(let h = 0;h < 24;h += hourStep){
    const label = h === 0 ? '' : new Date(2026,0,1,h).toLocaleTimeString(undefined,{hour:'numeric'});
    cells.push(`<span class="wv-hour" style="top:calc(${h * 60} * var(--wv-hour-h) / 60);">${escapeHtml(label)}</span>`);
  }
  if(nowMin != null){
    cells.push(`<span class="wv-nowtag" data-wv-nowtag style="top:calc(${nowMin} * var(--wv-hour-h) / 60);">${escapeHtml(weekViewRailClock(nowMin))}</span>`);
  }
  return cells.join('');
}

// Equal-width columns make two- and three-day comparisons readable.
function weekViewGridColumns(days){
  return `repeat(${days.length},minmax(0,1fr))`;
}

function weekViewDayColHtml(day,rows,todayKey,selectedKey,showNow){
  const isToday = day.dayKey === todayKey;
  const isSelected = day.dayKey === selectedKey;
  const hours = [];
  for(let h = 0;h < 24;h += 1){
    if(h > 0)hours.push(`<i class="wv-line" style="top:calc(${h * 60} * var(--wv-hour-h) / 60);"></i>`);
    hours.push(`<i class="wv-line is-half" style="top:calc(${h * 60 + 30} * var(--wv-hour-h) / 60);"></i>`);
  }
  const busy = rows.busy.map(weekViewBusyHtml).join('');
  const travel = rows.travel.map(weekViewTravelHtml).join('');
  const events = rows.events.map(weekViewEventHtml).join('');
  const nowMin = weekViewMinuteOfDay(Date.now());
  const now = isToday && showNow
    ? `<div class="wv-nowline" data-wv-now style="top:calc(${nowMin} * var(--wv-hour-h) / 60);"><i></i></div>`
    : '';
  return `<div class="wv-col${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}" data-wv-daycol="${escapeHtml(day.dayKey)}">`
    + `<div class="wv-lines">${hours.join('')}</div>`
    + `<div class="wv-layer wv-busy-layer">${busy}</div>`
    + `<div class="wv-layer wv-travel-layer">${travel}</div>`
    + `<div class="wv-layer wv-events-layer">${events}</div>`
    + now
    + `</div>`;
}

function weekViewMarkerChipHtml(m){
  _weekViewCtx.set(m.id,m);
  return `<button type="button" class="wv-marker-chip" data-wv-marker="${escapeHtml(m.id)}" style="${weekViewTokenVars(m.token)}" aria-label="${escapeHtml(`${weekViewMarkerLabel(m.kind)}: ${m.title}`)}"><i aria-hidden="true"></i><b>${escapeHtml(weekViewMarkerLabel(m.kind))}</b><span>${escapeHtml(m.title)}</span></button>`;
}

function weekViewStatusLabel(status){
  if(status === 'overlap')return 'Overlap';
  if(status === 'tight')return 'Tight';
  if(status === 'light')return 'Light';
  return '';
}

function weekViewDayMeta(layout){
  if(!layout || layout.empty)return 'Nothing planned';
  const parts = [`${weekViewHoursLabel(layout.plannedMin)} planned`];
  const labeled = (layout.chains || []).filter(chain=>chain.label);
  if(labeled.length === 1)parts.push(labeled[0].label);
  else if(labeled.length > 1)parts.push(`${labeled.length} nonstop runs`);
  if(layout.freeMin >= 5)parts.push(weekViewFreePhrase(layout.freeMin));
  else if((layout.blockCount || 0) >= 2)parts.push('no gap');
  return parts.join(' · ');
}

function weekViewDaybarHtml(day,layout){
  const flag = layout && !layout.empty ? weekViewStatusLabel(layout.status) : '';
  return `<div class="wv-daybar"><div class="wv-daybar-text"><small>${escapeHtml(weekViewDayMeta(layout))}</small></div>`
    + (flag ? `<span class="wv-flag is-${layout.status}">${escapeHtml(flag)}</span>` : '')
    + `</div>`;
}

function weekViewDaysHeadHtml(days,todayKey,selectedKey,layoutByDay){
  return days.map(day=>{
    const d = new Date(day.dayBase);
    const on = day.dayKey === selectedKey;
    const layout = layoutByDay && layoutByDay.get(day.dayKey);
    const load = layout ? weekViewLoadLabel(layout.plannedMin) : '';
    const hot = Boolean(layout && layout.ratio >= 0.85);
    const full = d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    return `<button type="button" class="wv-day-head${day.dayKey === todayKey ? ' is-today' : ''}${on ? ' is-selected' : ''}" data-wv-dayhead="${escapeHtml(day.dayKey)}" aria-label="${escapeHtml(load ? `${full}, ${load} planned, open day details` : `${full}, open day details`)}">`
      + `<span>${escapeHtml(WEEKDAY_LABELS[d.getDay()] || '')}</span><b>${d.getDate()}</b>`
      + (load ? `<em class="wv-load${hot ? ' is-hot' : ''}">${escapeHtml(load)}</em>` : '')
      + `</button>`;
  }).join('');
}

function weekViewMarkersRowHtml(dayCells){
  return dayCells.map(({rows})=>{
    const chips = rows.markers.map(weekViewMarkerChipHtml).join('');
    return `<div class="wv-marker-cell"><div class="wv-marker-chips">${chips}</div></div>`;
  }).join('');
}

function weekViewUnplacedHtml(rows,selectedKey){
  if(!rows || !rows.unplaced.length || !selectedKey)return '';
  const items = rows.unplaced.map(u=>{
    const id = `up|${u.hid}`;
    _weekViewCtx.set(id,u);
    return `<button type="button" class="wv-unplaced-item" data-wv-unplaced="${escapeHtml(id)}" style="${weekViewTokenVars(u.token)}" aria-label="${escapeHtml(`not scheduled: ${u.title}`)}"><i aria-hidden="true"></i><span>${u.emoji ? escapeHtml(u.emoji) + ' ' : ''}${escapeHtml(u.title)}</span></button>`;
  }).join('');
  const d = new Date(new Date(`${selectedKey}T12:00:00`).getTime());
  return `<div class="wv-unplaced"><p class="wv-unplaced-title">Not scheduled · ${escapeHtml(d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}))}</p><div class="wv-unplaced-list">${items}</div></div>`;
}

function weekViewLegendHtml(data,visibleHids,topicMap){
  const groups = new Map();
  data.forEach(h=>{
    if(!h || !h.hid || !visibleHids.has(h.hid))return;
    const group = weekViewColorGroup(h,topicMap,sortSettings);
    if(!groups.has(group.key))groups.set(group.key,group);
  });
  return [...groups.values()].map(group=>`<span class="wv-legend-chip"><i style="${weekViewTokenVars(group.token)}" aria-hidden="true"></i>${escapeHtml(group.label)}</span>`).join('');
}

function weekViewIndexRows(rows){
  const map = new Map();
  if(!rows)return map;
  (rows.events || []).forEach(ev=>map.set(ev.id,ev));
  (rows.busy || []).forEach(block=>map.set(block.id,block));
  (rows.travel || []).forEach(leg=>map.set(leg.id,leg));
  return map;
}

function weekViewDurCompact(mins){
  return weekViewSpanPhrase(mins);
}

function weekViewTravelText(leg,tier,depart,leaveNow){
  if(leaveNow)return 'Leave now';
  const leave = weekViewTimeLabel(leg.start);
  const mins = leg.mins || 1;
  if(depart)return `Leave by ${leave} · ${mins} min`;
  if(tier === 'short')return `${mins} min · leave ${leave}`;
  const route = `${leg.fromName || 'here'} → ${leg.toName || 'there'}`;
  if(tier === 'mid')return `${mins} min · ${route} · leave ${leave}`;
  return `${route} · ${weekViewDurCompact(mins)}`;
}

function weekViewHabitMeta(ev){
  const parts = [`${weekViewTimeLabel(ev.start)}–${weekViewTimeLabel(ev.end)}`];
  if(ev.place)parts.push(ev.place);
  if(ev.spansNext && ev.rawEnd)parts.push(`→ ${weekViewTimeLabel(ev.rawEnd)} next day`);
  return parts.join(' · ');
}

function weekViewListPos(item,rail){
  const left = item && item.nested ? 8 : (rail ? WEEK_VIEW_RAIL_PX : 1);
  return `top:${Math.round(item.y)}px;height:${Math.round(item.h)}px;left:${left}px;right:1px;`;
}

function weekViewListHabitHtml(ev,box,rail){
  _weekViewCtx.set(ev.id,ev);
  const when = `${weekViewTimeLabel(ev.start)} – ${weekViewTimeLabel(ev.end)}`;
  const statusCls = ev.status === 'active' ? ' is-active' : ev.status === 'past' ? ' is-past' : '';
  const full = box.fill >= 99 ? ' is-full' : '';
  const meta = box.showMeta ? `<span class="wv-event-meta">${escapeHtml(weekViewHabitMeta(ev))}</span>` : '';
  return `<button type="button" class="wv-event${statusCls}${full}" data-wv-event="${escapeHtml(ev.id)}" data-wv-hid="${escapeHtml(ev.hid || '')}" style="${weekViewListPos(box,rail)}${weekViewTokenVars(ev.token)};--wv-fill:${box.fill || 0}%;" aria-label="${escapeHtml(`${when}, ${ev.title}`)}">`
    + `<span class="wv-event-fill" aria-hidden="true"></span>`
    + `<span class="wv-event-line"><span class="wv-event-title">${ev.emoji ? `<span class="wv-event-emoji">${escapeHtml(ev.emoji)}</span>` : ''}<span class="wv-event-clock">${escapeHtml(weekViewCompactTime(ev.start))}</span><span class="wv-event-name">${escapeHtml(ev.title)}</span></span>`
    + `<span class="wv-event-dur">${escapeHtml(weekViewDurCompact(box.endMin - box.startMin))}</span></span>`
    + meta
    + (ev.status === 'active' ? '<span class="wv-event-flag">now</span>' : '')
    + `</button>`;
}

function weekViewListBusyHtml(block,box,rail){
  _weekViewCtx.set(block.id,block);
  const when = `${weekViewTimeLabel(block.start)} – ${weekViewTimeLabel(block.end)}`;
  return `<button type="button" class="wv-busy" data-wv-busy="${escapeHtml(block.id)}" style="${weekViewListPos(box,rail)}" aria-label="${escapeHtml(`busy, ${block.label}, ${when}`)}">`
    + `<span class="wv-busy-label"><i class="ti ti-lock" aria-hidden="true"></i><span>${escapeHtml(block.label)} · ${escapeHtml(weekViewMinuteLabel(box.startMin))}–${escapeHtml(weekViewMinuteLabel(box.endMin))}</span></span>`
    + `</button>`;
}

function weekViewListTravelHtml(leg,box,rail,nowMin,depart){
  _weekViewCtx.set(leg.id,leg);
  const leaveNow = nowMin != null && box.nextStart != null && nowMin >= box.startMin && nowMin < box.nextStart;
  const text = weekViewTravelText(leg,box.tier,depart && !leaveNow,leaveNow);
  const cls = `wv-travel is-${box.tier || 'short'}${leaveNow ? ' is-leave-now' : ''}${depart && !leaveNow ? ' is-depart' : ''}`;
  return `<button type="button" class="${cls}" data-wv-travel="${escapeHtml(leg.id)}" style="${weekViewListPos(box,rail)}" aria-label="${escapeHtml(text)}"><i class="ti ti-route" aria-hidden="true"></i><span>${escapeHtml(text)}</span></button>`;
}

function weekViewListPieceHtml(box,byId,rail,nowMin,state){
  if(box.type === 'gap'){
    if(!box.label)return '';
    const toggle = box.kind === 'collapsed' || box.kind === 'open';
    const mark = box.kind === 'collapsed' ? ' ▾' : box.kind === 'open' ? ' ▴' : '';
    const cls = `wv-gap is-${box.kind}${toggle ? ' is-toggle' : ''}`;
    const style = weekViewListPos(box,rail);
    if(!toggle)return `<div class="${cls}" style="${style}"><span>${escapeHtml(box.label)}</span></div>`;
    const expanded = box.kind === 'open' ? 'true' : 'false';
    return `<button type="button" class="${cls}" data-wv-gap="${escapeHtml(box.id)}" aria-expanded="${expanded}" style="${style}"><span>${escapeHtml(box.label + mark)}</span></button>`;
  }
  if(box.type === 'conflict'){
    const kids = (box.children || []).map(child=>{
      const rel = Object.assign({},child,{y:child.y - box.y,nested:true});
      return weekViewListPieceHtml(rel,byId,false,nowMin,state);
    }).join('');
    const label = `Overlap · ${weekViewMinuteLabel(box.startMin)}–${weekViewMinuteLabel(box.endMin)}`;
    return `<div class="wv-conflict" style="${weekViewListPos(box,rail)}"><p class="wv-conflict-label">${escapeHtml(label)}</p>${kids}</div>`;
  }
  const src = byId.get(box.id);
  if(!src)return '';
  if(box.type === 'busy')return weekViewListBusyHtml(src,box,rail);
  if(box.type === 'travel'){
    const depart = !state.sawTravel;
    state.sawTravel = true;
    return weekViewListTravelHtml(src,box,rail,nowMin,depart);
  }
  return weekViewListHabitHtml(src,box,rail);
}

function weekViewListHtml(layout,rows,opts){
  const rail = !opts || opts.rail !== false;
  const compact = Boolean(opts && opts.compact);
  const dayKey = opts && opts.dayKey || '';
  const showNow = Boolean(opts && opts.showNow);
  const byId = weekViewIndexRows(rows);
  const nowMin = showNow ? weekViewMinuteOfDay(Date.now()) : null;
  if(!layout || layout.empty){
    return `<div class="wv-list is-empty${compact ? ' is-compact' : ''}" data-wv-day="${escapeHtml(dayKey)}">`
      + `<div class="wv-empty"><p>Nothing planned</p><span>Free day</span>`
      + (compact ? '' : `<button type="button" class="wv-empty-add" data-wv-add="${escapeHtml(dayKey)}">Add a task</button>`)
      + `</div></div>`;
  }
  const state = {sawTravel:false};
  const pieces = layout.items.map(item=>weekViewListPieceHtml(item,byId,rail,nowMin,state)).join('');
  const times = rail ? layout.items.map(item=>{
    if(item.type === 'gap' || item.type === 'travel')return '';
    if(item.type === 'conflict'){
      return (item.children || []).filter(child=>child.type !== 'travel').map(child=>{
        return `<span class="wv-time" style="top:${Math.round(child.y)}px">${escapeHtml(weekViewRailClock(child.startMin))}</span>`;
      }).join('');
    }
    return `<span class="wv-time" style="top:${Math.round(item.y)}px">${escapeHtml(weekViewRailClock(item.startMin))}</span>`;
  }).join('') : '';
  const ticks = rail ? layout.items.filter(item=>item.type === 'gap' && item.ticks && item.ticks.length).map(item=>{
    return item.ticks.map(tick=>`<span class="wv-tick" style="top:${tick.y}px">${escapeHtml(tick.label)}</span>`).join('');
  }).join('') : '';
  const chains = compact ? '' : (layout.chains || []).filter(chain=>chain.h > 8).map(chain=>{
    const title = chain.label ? ` title="${escapeHtml(chain.label)}"` : '';
    return `<div class="wv-chain" style="top:${Math.round(chain.y)}px;height:${Math.round(chain.h)}px"${title}></div>`;
  }).join('');
  let now = '';
  if(showNow && typeof layout.timeToY === 'function'){
    const y = Math.max(0,Math.min(layout.height - 2,layout.timeToY(nowMin)));
    const key = opts.nowKey || 'detail';
    now = `<div class="wv-nowline" data-wv-elastic-now="${escapeHtml(key)}" style="top:${Math.round(y)}px"><i></i><span>now</span></div>`;
  }
  return `<div class="wv-list${compact ? ' is-compact' : ''}" data-wv-day="${escapeHtml(dayKey)}" style="height:${Math.round(layout.height)}px">`
    + chains + times + ticks + pieces + now
    + `</div>`;
}

function weekViewSyncModeButton(){
  document.querySelectorAll('[data-wv-mode]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.wvMode === _weekViewMode));
  });
  const desktop = _weekViewLayout === 'desktop';
  const choices = desktop ? [1,2,3,7] : [1,2,3];
  const count = desktop ? _weekViewWideDays : _weekViewPhoneDays;
  const days = $('week-view-days');
  if(days){
    if(days.dataset.layout !== _weekViewLayout){
      days.innerHTML = choices.map(value=>`<option value="${value}">${value === 7 ? 'Week' : `${value} day${value === 1 ? '' : 's'}`}</option>`).join('');
      days.dataset.layout = _weekViewLayout;
    }
    days.value = String(count);
  }
  $('week-view-options').hidden = !_weekViewOptionsOpen;
  $('week-view-display-options').setAttribute('aria-expanded',String(_weekViewOptionsOpen));
  $('week-view-color').value = _weekViewColor;
  $('week-view-zoom').hidden = _weekViewMode !== 'grid';
  $('week-view-zoom-label').textContent = `${Math.round(_weekViewZoom / 96 * 100)}%`;
  $('week-view-zoom-out').disabled = _weekViewZoom === WEEK_VIEW_ZOOM_STEPS[0];
  $('week-view-zoom-in').disabled = _weekViewZoom === WEEK_VIEW_ZOOM_STEPS[WEEK_VIEW_ZOOM_STEPS.length-1];
  $('week-view-filters').classList.toggle('has-active',weekViewFiltersActive());
}

function renderWeekViewHeader(label,sub,offset,selectedKey){
  const labelEl = $('week-view-label');
  const subEl = $('week-view-sub');
  const prev = $('week-view-prev');
  const next = $('week-view-next');
  const today = $('week-view-today');
  if(labelEl){
    labelEl.textContent = label;
    const count = _weekViewLayout === 'desktop' ? _weekViewWideDays : _weekViewPhoneDays;
    labelEl.disabled = count !== 1;
    if(count === 1)labelEl.dataset.wvDayhead = selectedKey;
    else delete labelEl.dataset.wvDayhead;
    labelEl.setAttribute('aria-label',count === 1 ? `${label}, open day details` : label);
  }
  if(subEl)subEl.textContent = sub;
  if(prev){
    prev.disabled = offset === 0 && _weekViewWindowStart === 0;
    prev.setAttribute('aria-disabled',String(prev.disabled));
    prev.setAttribute('aria-label','previous days');
  }
  if(next){
    const count = _weekViewLayout === 'desktop' ? _weekViewWideDays : _weekViewPhoneDays;
    next.disabled = offset === 7 && _weekViewWindowStart + count >= 7;
    next.setAttribute('aria-disabled',String(next.disabled));
    next.setAttribute('aria-label','next days');
  }
  if(today)today.disabled = false;
  weekViewSyncModeButton();
}

function renderWeekViewStatus(loading){
  const status = $('week-view-status');
  if(!status)return;
  if(_weekViewError){
    status.innerHTML = `These days couldn’t be loaded. <button type="button" class="mini-text-btn" data-wv-retry="1">Try again</button>`;
    return;
  }
  status.textContent = loading
    ? (weekViewOffset === 0 ? 'Planning the week…' : 'Planning the preview week…')
    : (weekViewFiltersActive() ? 'Filters on · busy time shown' : '');
}

function renderWeekView(){
  const body = $('week-view-body');
  const markersEl = $('week-view-markers');
  if(!body)return;
  const data = typeof load === 'function' ? load() : [];
  const settings = sortSettings || loadSortSettings();
  const dirtyKey = homePlannerDirtyKey(data);
  const revisionChanged = Boolean(_weekViewDirtyKey) && dirtyKey !== _weekViewDirtyKey;
  _weekViewDirtyKey = dirtyKey;
  const todayKey = dateKey(Date.now());
  if(_weekViewTodayKey && todayKey !== _weekViewTodayKey){
    // Midnight crossed while open: anchors and cached weeks are all stale.
    _weekViewTodayKey = todayKey;
    weekViewOffset = 0;
    weekViewDaySel = todayKey;
    _weekViewCache.clear();
    _weekViewError = '';
    weekViewGen += 1;
  }else if(!_weekViewTodayKey){
    _weekViewTodayKey = todayKey;
  }
  if(revisionChanged){
    // Edits/deletions landed while open: cached weeks and in-flight preview
    // requests are stale; regenerate under a fresh generation.
    _weekViewCache.clear();
    _weekViewError = '';
    weekViewGen += 1;
  }
  if(!weekViewDaySel)weekViewDaySel = todayKey;

  const days = weekViewRangeDays(weekViewOffset);
  const topicMap = weekViewTopicTokenMap(settings);
  const visibleHids = weekViewVisibleHids(data);
  const desktop = weekViewDesktopLayout() === 'desktop';
  if(desktop !== (_weekViewLayout === 'desktop'))_weekViewScrollReset = true;
  _weekViewLayout = desktop ? 'desktop' : 'phone';


  const gen = weekViewGen;
  const previewKey = weekViewCacheKey(dateKey(days[0].dayBase),weekViewEffectiveMode(),dirtyKey);
  let week = null;
  let pendingPromise = null;
  if(weekViewOffset === 0){
    week = weekViewInitialWeek(data);
    if(!week && !_weekViewError)pendingPromise = weekViewFillInitialWeek(data,gen);
  }else{
    week = _weekViewCache.get(previewKey) || null;
    // Only ask the worker when the cache missed — resolving a cached week as
    // a promise that re-renders would loop forever.
    if(!week && !_weekViewError)pendingPromise = weekViewEnsurePreviewWeek(data,gen);
  }
  if(pendingPromise){
    pendingPromise.then(resolved=>{
      if(resolved && gen === weekViewGen && weekSheetOpen())renderWeekView();
    }).catch(err=>{
      if(!weekSheetOpen() || gen !== weekViewGen)return;
      if(err && err.message === 'week view closed')return;
      _weekViewError = err;
      renderWeekView();
    });
  }
  const loading = !week && Boolean(pendingPromise);

  if(!days.some(day=>day.dayKey === weekViewDaySel))weekViewDaySel = days[0].dayKey;
  const selectedDay = days.find(day=>day.dayKey === weekViewDaySel) || days[0];
  const listMode = _weekViewMode !== 'grid';
  const visibleCount = desktop ? _weekViewWideDays : _weekViewPhoneDays;
  const selIdx = Math.max(0,days.findIndex(day=>day.dayKey === weekViewDaySel));
  let startIdx = Math.min(_weekViewWindowStart,7 - visibleCount);
  if(selIdx < startIdx)startIdx = selIdx;
  if(selIdx >= startIdx + visibleCount)startIdx = selIdx - visibleCount + 1;
  _weekViewWindowStart = startIdx;
  const visibleDays = days.slice(startIdx,startIdx + visibleCount);
  const multiDay = visibleCount > 1;
  renderWeekViewHeader(
    visibleCount === 1 ? new Date(visibleDays[0].dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}) : weekViewRangeLabel(visibleDays),
    weekViewOffset === 0 ? '' : 'Preview · placements may change',
    weekViewOffset,
    weekViewDaySel
  );
  const legend = $('week-view-legend');
  if(legend){
    const legendHtml = weekViewLegendHtml(data,visibleHids,topicMap);
    legend.innerHTML = legendHtml;
    legend.hidden = !legendHtml || !_weekViewOptionsOpen;
  }

  const active = document.activeElement;
  const focusAttr = ['data-wv-dayhead','data-wv-event','data-wv-busy','data-wv-travel','data-wv-gap','data-wv-marker','data-wv-unplaced'].find(attr=>active && active.hasAttribute(attr));
  const focusValue = focusAttr ? active.getAttribute(focusAttr) : '';

  const rowsByDay = new Map();
  const layoutByDay = new Map();
  const findByKey = dayKey=>{
    if(!(week && Array.isArray(week.days)))return null;
    return week.days.find(d=>dateKey(d.dayBase) === dayKey) || null;
  };
  const blankRows = ()=>({events:[],busy:[],travel:[],markers:[],unplaced:[]});
  days.forEach(day=>{
    const src = findByKey(day.dayKey);
    const rows = src ? weekCalendarRows(src,data,settings,topicMap,visibleHids) : blankRows();
    rowsByDay.set(day.dayKey,rows);
    layoutByDay.set(day.dayKey,weekViewLayoutFor(rows,day.dayKey,day.dayBase,settings,null));
  });

  const detailScroller = body.querySelector('.wv-detail-scroll');
  const gridScroller = body.querySelector('.wv-scroller');
  const savedDetail = detailScroller ? detailScroller.scrollTop : (gridScroller ? gridScroller.scrollTop : 0);
  const detailDayChanged = _weekViewRenderedDay !== weekViewDaySel;
  const previousAxis = _weekViewSharedAxis;
  _weekViewSharedAxis = null;

  _weekViewCtx = new Map();
  _weekViewColumnLayouts = new Map();
  _weekViewDetailLayout = null;


  const selectedRows = rowsByDay.get(selectedDay.dayKey) || blankRows();
  const selectedLayout = layoutByDay.get(selectedDay.dayKey);
  const selectedMarkers = selectedRows.markers.map(weekViewMarkerChipHtml).join('');

  if(markersEl){
    if(multiDay || !listMode){
      const dayCells = visibleDays.map(day=>({day,rows:rowsByDay.get(day.dayKey)}));
      const gridColumns = weekViewGridColumns(visibleDays,weekViewDaySel,desktop);
      const headHtml = !multiDay ? '' : `<div class="wv-days-head${desktop ? '' : ' is-split'}" style="grid-template-columns:${gridColumns}">${weekViewDaysHeadHtml(visibleDays,todayKey,weekViewDaySel,layoutByDay)}</div>`;
      const anyMarkers = dayCells.some(cell=>cell.rows.markers.length);
      const rowHtml = anyMarkers
        ? `<div class="wv-marker-grid" style="--wv-days:${visibleDays.length};grid-template-columns:${gridColumns}">${weekViewMarkersRowHtml(dayCells)}</div>`
        : '';
      markersEl.innerHTML = headHtml + rowHtml;
      markersEl.hidden = !headHtml && !rowHtml;
    }else if(selectedMarkers){
      markersEl.innerHTML = `<div class="wv-marker-chips">${selectedMarkers}</div>`;
      markersEl.hidden = false;
    }else{
      markersEl.innerHTML = '';
      markersEl.hidden = true;
    }
  }

  body.style.setProperty('--wv-hour-h',`${weekViewHourPx()}px`);
  body.classList.toggle('is-list',listMode);
  body.classList.toggle('is-grid',!listMode);

  body.classList.toggle('is-multi',multiDay);
  body.dataset.days = String(visibleCount);
  if(listMode && multiDay){
    const axis = weekViewSharedTimeAxis(visibleDays.map(day=>rowsByDay.get(day.dayKey)));
    _weekViewSharedAxis = axis;
    if(visibleDays.some(day=>day.dayKey === todayKey))_weekViewColumnLayouts.set(todayKey,axis);
    const ticks = axis.ticks.map(tick=>`<span class="wv-hour" style="top:${tick.y}px">${escapeHtml(tick.label)}</span>`).join('');
    body.innerHTML = `<div class="wv-scale-note">Shared time scale · quiet hours compressed</div><div class="wv-scroller wv-detail-scroll"><div class="wv-grid is-aligned-grid" style="height:${axis.height}px">`
      + `<div class="wv-gutter">${ticks}</div><div class="wv-cols" style="height:${axis.height}px;grid-template-columns:${weekViewGridColumns(visibleDays)}">`
      + visibleDays.map(day=>weekViewAlignedColumnHtml(day,rowsByDay.get(day.dayKey),axis,todayKey)).join('')
      + `</div></div></div>${weekViewUnplacedHtml(selectedRows,selectedDay.dayKey)}`;
  }else if(listMode){
    const showNow = selectedDay.dayKey === todayKey;
    _weekViewDetailLayout = selectedLayout;
    body.innerHTML = weekViewDaybarHtml(selectedDay,selectedLayout)
      + `<div class="wv-scroller wv-detail-scroll">${loading || _weekViewError ? '' : weekViewListHtml(selectedLayout,selectedRows,{rail:true,dayKey:selectedDay.dayKey,showNow,nowKey:'detail'})}</div>`
      + weekViewUnplacedHtml(selectedRows,selectedDay.dayKey);
  }else{
    const todayVisible = visibleDays.some(day=>day.dayKey === todayKey);
    const gridBar = multiDay ? '' : weekViewDaybarHtml(selectedDay,selectedLayout);
    body.innerHTML = `${gridBar}<div class="wv-scroller wv-detail-scroll"><div class="wv-grid">`
      + `<div class="wv-gutter">${weekViewGutterHtml(1,todayVisible ? weekViewMinuteOfDay(Date.now()) : null)}</div>`
      + `<div class="wv-cols" style="--wv-days:${visibleDays.length};grid-template-columns:${weekViewGridColumns(visibleDays)}">${visibleDays.map(day=>weekViewDayColHtml(day,rowsByDay.get(day.dayKey),todayKey,weekViewDaySel,true)).join('')}</div>`
      + `</div></div>${weekViewUnplacedHtml(selectedRows,selectedDay.dayKey)}`;
  }
  body.setAttribute('aria-busy',String(loading));

  renderWeekViewStatus(loading);
  body.classList.toggle('is-loading',loading && !_weekViewError);

  const nextDetail = body.querySelector('.wv-detail-scroll');
  if(nextDetail){
    if(_weekViewScrollReset || (detailDayChanged && !multiDay)){
      if(!listMode)weekViewScrollSeed(nextDetail,selectedRows,selectedDay.dayKey);
      else if(multiDay){
        const minute = visibleDays.some(day=>day.dayKey === todayKey) ? weekViewMinuteOfDay(Date.now()) : 8 * 60;
        nextDetail.scrollTop = Math.max(0,_weekViewSharedAxis.timeToY(minute) - 72);
      }else weekViewElasticScroll(nextDetail,selectedLayout,selectedDay.dayKey);
    }else if(previousAxis && _weekViewSharedAxis){
      nextDetail.scrollTop = Math.max(0,_weekViewSharedAxis.timeToY(previousAxis.yToTime(savedDetail + 32)) - 32);
    }else nextDetail.scrollTop = savedDetail;
  }
  if(focusAttr){
    const restored = [...document.querySelectorAll(`#week-sheet [${focusAttr}]`)].find(el=>el.getAttribute(focusAttr) === focusValue);
    restored?.focus({preventScroll:true});
  }
  _weekViewScrollReset = false;
  _weekViewRenderedDay = weekViewDaySel;
}

function weekViewElasticScroll(scroller,layout,dayKey){
  if(!scroller)return;
  const todayKey = dateKey(Date.now());
  let y = 0;
  if(layout && dayKey === todayKey && typeof layout.timeToY === 'function'){
    y = layout.timeToY(weekViewMinuteOfDay(Date.now())) - 72;
  }
  const max = Math.max(0,scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0,Math.min(y,max));
}

function weekViewScrollSeed(scroller,rows,dayKey){
  const todayKey = dateKey(Date.now());
  const nowMin = weekViewMinuteOfDay(Date.now());
  let targetMin;
  if(dayKey === todayKey)targetMin = Math.max(0,nowMin - 90);
  else if(rows && rows.events.length){
    targetMin = Math.max(0,Math.min(...rows.events.map(ev=>ev.topMin)) - 60);
  }else targetMin = 8 * 60;
  const hourPx = weekViewHourPx();
  const max = Math.max(0,24 * hourPx - scroller.clientHeight + 40);
  scroller.scrollTop = Math.min(targetMin * hourPx / 60,max);
}

function updateWeekViewNowLine(){
  const nowMin = weekViewMinuteOfDay(Date.now());
  document.querySelectorAll('#week-view-body [data-wv-elastic-now]').forEach(el=>{
    const key = el.dataset.wvElasticNow;
    const layout = key === 'detail' ? _weekViewDetailLayout : _weekViewColumnLayouts.get(key);
    if(!layout || typeof layout.timeToY !== 'function')return;
    const y = Math.max(0,Math.min(layout.height - 2,layout.timeToY(nowMin)));
    el.style.top = `${Math.round(y)}px`;
  });
  const top = `calc(${nowMin} * var(--wv-hour-h) / 60)`;
  document.querySelectorAll('#week-view-body .wv-nowline:not([data-wv-elastic-now])').forEach(line=>{
    line.style.top = top;
  });
  const tag = document.querySelector('#week-view-body .wv-nowtag');
  if(!tag)return;
  tag.style.top = top;
  tag.textContent = weekViewRailClock(nowMin);
}

function weekViewTick(){
  if(!weekSheetOpen())return;
  const todayKey = dateKey(Date.now());
  const data = typeof load === 'function' ? load() : [];
  if(todayKey !== _weekViewTodayKey || homePlannerDirtyKey(data) !== _weekViewDirtyKey){
    renderWeekView();
    return;
  }
  updateWeekViewNowLine();
}

// ─────────────────────────────────────────────────────────────────────────
// WIRE + lifecycle. One delegated bindTap on the view body; every dismissal
// path funnels through weekViewCleanup via a class observer on the sheet.
// ─────────────────────────────────────────────────────────────────────────
function weekViewOpenDetail(hid){
  if(!hid)return;
  const data = typeof load === 'function' ? load() : [];
  const idx = data.findIndex(h=>h && h.hid === hid);
  if(idx >= 0 && typeof openDetail === 'function'){
    openDetail(idx);
  }
}

function weekViewOpenAdd(dayKey,minute){
  applyAddDefaults();
  switchAddType('task');
  const due = $('ting-due-date');
  if(due && dayKey)due.value = dayKey;
  if(Number.isFinite(minute)){
    const rounded = Math.max(0,Math.min(1425,Math.round(minute / 15) * 15));
    $('ting-due-time').value = `${String(Math.floor(rounded / 60)).padStart(2,'0')}:${String(rounded % 60).padStart(2,'0')}`;
  }
  syncTaskDueUi();
  openSheet('add-sheet');
  $('ting-message')?.focus({preventScroll:true});
}

function weekViewSetMode(mode){
  if(_weekViewMode === mode)return;
  _weekViewMode = mode;
  _weekViewScrollReset = true;
  weekViewSavePreferences();
  renderWeekView();
}

function weekViewChangeZoom(direction){
  const index = WEEK_VIEW_ZOOM_STEPS.indexOf(_weekViewZoom);
  const next = WEEK_VIEW_ZOOM_STEPS[Math.max(0,Math.min(WEEK_VIEW_ZOOM_STEPS.length-1,index + direction))];
  if(next === _weekViewZoom)return;
  const scroller = $('week-view-body').querySelector('.wv-scroller');
  const center = scroller ? scroller.clientHeight / 2 : 0;
  const minute = scroller ? (scroller.scrollTop + center) * 60 / _weekViewZoom : 480;
  _weekViewZoom = next;
  weekViewSavePreferences();
  renderWeekView();
  const restored = $('week-view-body').querySelector('.wv-scroller');
  if(restored)restored.scrollTop = Math.max(0,minute * _weekViewZoom / 60 - center);
}

function weekViewActivate(event){
  if(Date.now() - _weekViewSwipeAt < 450)return; // swipe's trailing tap
  const target = event && event.target;
  if(!target || !target.closest)return;
  if(target.closest('select,.wv-zoom,#week-view-create,#week-view-display-options,#week-view-filters,#week-view-overview,.wv-nav,#week-view-close'))return;
  const mode = target.closest('[data-wv-mode]');
  if(mode){weekViewSetMode(mode.dataset.wvMode);return;}
  const retry = target.closest('[data-wv-retry]');
  if(retry){
    weekViewRetry();
    return;
  }
  const gapEl = target.closest('[data-wv-gap]');
  if(gapEl){
    const id = gapEl.dataset.wvGap;
    if(id){
      if(_weekViewOpenGaps.has(id))_weekViewOpenGaps.delete(id);
      else _weekViewOpenGaps.add(id);
      renderWeekView();
    }
    return;
  }
  const addEl = target.closest('[data-wv-add]');
  if(addEl){
    weekViewOpenAdd(addEl.dataset.wvAdd || '');
    return;
  }
  const dayHead = target.closest('[data-wv-dayhead]');
  if(dayHead){
    const key = dayHead.dataset.wvDayhead;
    if(key){
      weekViewDaySel = key;
      _weekViewReturnFocus = dayHead;
      openDayLogsAfterCalendarGesture(key,{hideAgenda:true});
    }
    return;
  }
  const evEl = target.closest('[data-wv-event]');
  if(evEl){
    _weekViewReturnFocus = evEl;
    weekViewOpenDetail(evEl.dataset.wvHid);
    return;
  }
  const markerEl = target.closest('[data-wv-marker]');
  if(markerEl){
    const ctx = _weekViewCtx.get(markerEl.dataset.wvMarker);
    if(ctx){_weekViewReturnFocus = markerEl;weekViewOpenDetail(ctx.hid);}
    return;
  }
  const unplacedEl = target.closest('[data-wv-unplaced]');
  if(unplacedEl){
    const ctx = _weekViewCtx.get(unplacedEl.dataset.wvUnplaced);
    if(ctx){_weekViewReturnFocus = unplacedEl;weekViewOpenDetail(ctx.hid);}
    return;
  }
  const busyEl = target.closest('[data-wv-busy]');
  if(busyEl){
    const ctx = _weekViewCtx.get(busyEl.dataset.wvBusy);
    _weekViewReturnFocus = busyEl;
    if(ctx && typeof openBlockEditSheet === 'function')openBlockEditSheet(ctx.row);
    return;
  }
  const travelEl = target.closest('[data-wv-travel]');
  if(travelEl){
    const ctx = _weekViewCtx.get(travelEl.dataset.wvTravel);
    if(!ctx)return;
    _weekViewReturnFocus = travelEl;
    // Ephemeral live-GPS legs have no saved origin: open directions like the
    // home card does. Saved-place legs open the travel editor.
    if(ctx.fromCurrent && typeof openTravelLegInMaps === 'function'){
      openTravelLegInMaps(ctx.toId);
    }else if(typeof openTravelEditSheet === 'function'){
      openTravelEditSheet(ctx.fromId,ctx.toId,ctx.start,ctx.toName,ctx.dayKey);
    }
    return;
  }
  const column = target.closest('[data-wv-daycol]');
  if(column && event && Number.isFinite(event.clientY)){
    const y = event.clientY - column.getBoundingClientRect().top;
    const minute = _weekViewMode === 'grid' ? y * 60 / weekViewHourPx() : _weekViewSharedAxis?.yToTime(y);
    if(Number.isFinite(minute)){
      weekViewDaySel = column.dataset.wvDaycol;
      _weekViewReturnFocus = $('week-view-create');
      weekViewOpenAdd(weekViewDaySel,minute);
    }
  }
}

function weekViewShiftDay(dir,opts){
  const days = weekViewRangeDays(weekViewOffset);
  const idx = days.findIndex(d=>d.dayKey === weekViewDaySel);
  const nextIdx = (idx < 0 ? 0 : idx) + dir;
  if(nextIdx < 0 || nextIdx > 6){
    const offset = weekViewOffset + (nextIdx < 0 ? -7 : 7);
    if(offset < 0 || offset > 7)return;
    weekViewOffset = offset;
    const nextDays = weekViewRangeDays(offset);
    weekViewDaySel = nextDays[nextIdx < 0 ? 6 : 0].dayKey;
  }else weekViewDaySel = days[nextIdx].dayKey;
  // Phone changes which columns are on screen, so reopen near that day's
  // events. Desktop keeps the scroll the user already chose.
  if(!opts || opts.keepScroll !== true)_weekViewScrollReset = true;
  renderWeekView();
}

function weekViewHasCoveringSheet(){
  return ['detail-sheet','block-edit-sheet','travel-edit-sheet','add-sheet','settings-sheet','calendar-filter-sheet','day-logs-sheet'].some(id=>{
    const el = $(id);
    return el && el.classList.contains('open');
  });
}

function weekViewBindSwipe(){
  // Delegated on the persistent body container — the scroller element is
  // recreated on every render.
  const bodyEl = $('week-view-body');
  if(!bodyEl)return;
  let startX = 0,startY = 0,intent = null;
  bodyEl.addEventListener('touchstart',e=>{
    if(Date.now() - _weekViewSwipeAt < 450){intent = null;return;}
    if(e.touches.length !== 1){intent = null;return;}
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    intent = null;
  },{passive:true});
  bodyEl.addEventListener('touchmove',e=>{
    if(intent != null || !e.touches.length)return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Horizontal intent only, so vertical scrolling and edge-back survive.
    if(Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5)intent = dx > 0 ? -1 : 1;
    else if(Math.abs(dy) > 48)intent = 0;
  },{passive:true});
  bodyEl.addEventListener('touchend',()=>{
    if(intent && _weekViewLayout === 'phone'){
      _weekViewSwipeAt = Date.now(); // suppress the swipe's trailing tap
      weekViewShiftDay(intent);
    }
    intent = null;
  },{passive:true});
}

function weekViewRetry(){
  _weekViewError = '';
  weekViewGen += 1;
  _weekViewCache.clear();
  renderWeekView();
}

function weekViewNavigate(direction){
  const count = _weekViewLayout === 'desktop' ? _weekViewWideDays : _weekViewPhoneDays;
  let start = _weekViewWindowStart + direction * count;
  if(start < 0){
    if(weekViewOffset === 0)return;
    weekViewOffset = 0;
    start = 7 - count;
  }else if(start >= 7 || (direction > 0 && _weekViewWindowStart === 7 - count)){
    if(weekViewOffset === 7)return;
    weekViewOffset = 7;
    start = 0;
  }
  _weekViewWindowStart = Math.max(0,Math.min(7-count,start));
  weekViewDaySel = weekViewRangeDays(weekViewOffset)[_weekViewWindowStart].dayKey;
  _weekViewScrollReset = true;
  renderWeekView();
}

function weekViewSetOffset(offset){
  if(offset !== 0 && offset !== 7)return;
  if(offset === weekViewOffset)return;
  weekViewOffset = offset;
  const days = weekViewRangeDays(offset);
  weekViewDaySel = offset === 0 ? dateKey(Date.now()) : days[0].dayKey;
  _weekViewScrollReset = true;
  _weekViewError = '';
  renderWeekView();
}

function weekViewGoToday(){
  const todayKey = dateKey(Date.now());
  weekViewOffset = 0;
  weekViewDaySel = todayKey;
  _weekViewScrollReset = true;
  renderWeekView();
}

function weekViewSuspend(){
  if(_weekViewTimer){
    clearInterval(_weekViewTimer);
    _weekViewTimer = null;
  }
  weekViewGen += 1;
  terminateWeekPreviewWorker();
  _weekViewPending.clear();
}

function weekViewCleanup(){
  weekViewSuspend();
  _weekViewCache.clear();
  _weekViewCtx = new Map();
  _weekViewError = '';
  _weekViewDirtyKey = '';
  _weekViewTodayKey = '';
  weekViewOffset = 0;
  weekViewDaySel = null;
  _weekViewScrollReset = true;
  _weekViewOpenGaps = new Set();
  _weekViewDetailLayout = null;
  _weekViewColumnLayouts = new Map();
  _weekViewRenderedDay = '';
  _weekViewSharedAxis = null;
  _weekViewWindowStart = 0;
  _weekViewOptionsOpen = false;
}

function openWeekView(){
  if(typeof rememberCalendarView === 'function')rememberCalendarView('week');
  if($('overview-sheet')?.classList.contains('open'))closeSheet('overview-sheet');
  weekViewCleanup();
  _weekViewOpener = document.activeElement;
  weekViewLoadPreferences();
  weekViewGen += 1;
  renderWeekView();
  openSheet('week-sheet');
  $('week-view-close').focus({preventScroll:true});
  if(!_weekViewTimer)_weekViewTimer = setInterval(weekViewTick,60000);
}

function bindWeekView(){
  if(_weekViewBound)return;
  const body = $('week-view-body');
  const sheet = $('week-sheet');
  if(!body || !sheet)return;
  _weekViewBound = true;

  // The sheet container is the persistent surface — chips, day heads, the
  // marker strip, and the grid are re-rendered inside it on every pass.
  const sheetInner = sheet.querySelector('.week-view-sheet');
  bindTap(sheetInner,weekViewActivate,{ignoreSelector:'select,.wv-zoom,#week-view-create,#week-view-display-options,#week-view-filters,#week-view-overview,.wv-nav,#week-view-close,.wv-gutter,.wv-hour'});
  weekViewBindSwipe();

  sheet.addEventListener('click',e=>{
    if(e.target === e.currentTarget && !sheetBackdropArmed('week-sheet'))closeSheet('week-sheet');
  });
  $('week-view-close')?.addEventListener('click',()=>closeSheet('week-sheet'));
  $('week-view-overview')?.addEventListener('click',()=>openCalendarOverview());
  $('week-view-prev')?.addEventListener('click',()=>weekViewNavigate(-1));
  $('week-view-next')?.addEventListener('click',()=>weekViewNavigate(1));
  $('week-view-today')?.addEventListener('click',()=>weekViewGoToday());
  $('week-view-display-options').addEventListener('click',()=>{
    _weekViewOptionsOpen = !_weekViewOptionsOpen;
    renderWeekView();
  });
  $('week-view-days').addEventListener('change',event=>{
    const count = Number(event.target.value);
    if(_weekViewLayout === 'desktop')_weekViewWideDays = count;
    else _weekViewPhoneDays = count;
    _weekViewScrollReset = true;
    weekViewSavePreferences();
    renderWeekView();
  });
  $('week-view-color').addEventListener('change',event=>{
    _weekViewColor = event.target.value;
    weekViewSavePreferences();
    renderWeekView();
  });
  $('week-view-zoom-out').addEventListener('click',()=>weekViewChangeZoom(-1));
  $('week-view-zoom-in').addEventListener('click',()=>weekViewChangeZoom(1));
  $('week-view-create').addEventListener('click',()=>{
    _weekViewReturnFocus = $('week-view-create');
    weekViewOpenAdd(weekViewDaySel);
  });
  $('week-view-filters').addEventListener('click',()=>{
    _weekViewReturnFocus = $('week-view-filters');
    renderOverviewFilters(load());
    openSheet('calendar-filter-sheet');
  });
  // Return from every editor to this same day, scroll position and control.
  const coverObserver = new MutationObserver(records=>{
    if(!weekSheetOpen() || weekViewHasCoveringSheet())return;
    if(!records.some(record=>!record.target.classList.contains('open')))return;
    const previous = _weekViewReturnFocus;
    const attr = ['data-wv-dayhead','data-wv-event','data-wv-busy','data-wv-travel','data-wv-marker','data-wv-unplaced'].find(key=>previous?.hasAttribute(key));
    const value = attr ? previous.getAttribute(attr) : '';
    renderWeekView();
    const restored = attr ? [...sheet.querySelectorAll(`[${attr}]`)].find(el=>el.getAttribute(attr) === value) : previous;
    (restored || $('week-view-create'))?.focus({preventScroll:true});
    _weekViewReturnFocus = null;
  });
  ['detail-sheet','block-edit-sheet','travel-edit-sheet','add-sheet','calendar-filter-sheet','day-logs-sheet'].forEach(id=>{
    coverObserver.observe($(id),{attributes:true,attributeFilter:['class']});
  });


  // Left and right move the selected day. Up and down still scroll the grid.
  document.addEventListener('keydown',e=>{
    if(!weekSheetOpen())return;
    if(e.key === 'Tab' && !weekViewHasCoveringSheet()){
      const buttons = [...sheet.querySelectorAll('button,select,[tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length-1];
      if(e.shiftKey && (e.target === first || !sheet.contains(e.target))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey && (e.target === last || !sheet.contains(e.target))){e.preventDefault();first?.focus();}
      return;
    }
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')return;
    if(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey)return;
    const target = e.target;
    const tag = target && target.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable))return;
    if(weekViewHasCoveringSheet())return;
    e.preventDefault();
    weekViewShiftDay(e.key === 'ArrowRight' ? 1 : -1,{keepScroll:_weekViewLayout === 'desktop'});
  });

  // Keyboard activation for busy blocks (role=button divs).
  body.addEventListener('keydown',e=>{
    if(e.key !== 'Enter' && e.key !== ' ')return;
    const busyEl = e.target && e.target.closest && e.target.closest('[data-wv-busy]');
    if(!busyEl)return;
    e.preventDefault();
    weekViewActivate({target:busyEl});
  });

  // Layout cross (phone ⇄ desktop column count) re-renders; same layout is
  // ignored so resizes never reset the user's scroll position.
  if(typeof ResizeObserver === 'function' && sheetInner){
    _weekViewResize = new ResizeObserver(()=>{
      if(!weekSheetOpen())return;
      const next = weekViewDesktopLayout();
      if(next !== _weekViewLayout)renderWeekView();
    });
    _weekViewResize.observe(sheetInner);
  }

  // Any close path (button, Escape, backdrop, browser back, tier reset) must
  // release preview work — observe the open class instead of hooking each.
  const observer = new MutationObserver(()=>{
    if(!sheet.classList.contains('open') && (_weekViewTodayKey || _weekViewTimer || _weekPreviewWorker)){
      weekViewCleanup();
      _weekViewOpener?.focus({preventScroll:true});
      _weekViewOpener = null;
    }
  });
  observer.observe(sheet,{attributes:true,attributeFilter:['class']});

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState === 'visible' && weekSheetOpen())weekViewTick();
  });
  window.addEventListener('pagehide',weekViewSuspend);
  window.addEventListener('pageshow',()=>{
    if(!weekSheetOpen())return;
    renderWeekView();
    if(!_weekViewTimer)_weekViewTimer = setInterval(weekViewTick,60000);
  });
  document.addEventListener('tierchange',()=>{
    if(!weekSheetOpen())return;
    renderWeekView();
  });
}

bindWeekView();
