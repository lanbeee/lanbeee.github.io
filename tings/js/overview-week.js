// Week view — a readable week over the planner, opened from the Overview
// calendar's "week" button. Display controls never write saved items or
// replace Home's mounted week; explicit completion uses the shared log flow.
//
// Default is the list: elastic time, so a 15-minute habit and a 5-minute
// trip stay readable, and free gaps compress. Grid is the opt-in proportional
// time grid. Every screen offers 1–3 days or a full week, plus the shared
// monthly calendar from the display sidebar.
//
// The sheet scrolls freely across a strip of days. Today through thirteen
// days ahead come from the planner (the mounted week, then a fast 14-day
// projection on the dedicated preview worker). Days outside that horizon
// still draw busy time and fixed appointments. The second week stays
// provisional: earlier completions can reshuffle it.
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
  const eventDeltas = new Int32Array(minutes.length);
  const busyDeltas = new Int32Array(minutes.length);
  segments.forEach(seg=>{
    const start = indices.get(seg.topMin);
    const end = indices.get(seg.botMin);
    const deltas = seg.kind === 'busy' ? busyDeltas : eventDeltas;
    deltas[start] += 1;
    deltas[end] -= 1;
    const sized = weekViewElasticItemHeight(seg,0.9,48,38);
    if(!incoming.has(end))incoming.set(end,[]);
    incoming.get(end).push({start,height:sized.h + 4});
  });
  // Compress only spans that are free across ALL visible days. Busy-only
  // time eases off; an event on any day restores enough space for its card.
  // Sweep boundaries once instead of scanning every item at each boundary.
  const spans = [];
  let eventCount = 0, busyCount = 0;
  for(let i = 1;i < minutes.length;i += 1){
    eventCount += eventDeltas[i-1];
    busyCount += busyDeltas[i-1];
    const start = minutes[i-1], end = minutes[i];
    const kind = eventCount > 0 ? 'event' : busyCount > 0 ? 'busy' : 'free';
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
  // Card layout and scroll restoration ask for hundreds of positions. Keep
  // those lookups logarithmic even when a dense fortnight has many boundaries.
  const firstAtOrAfter = (values,target)=>{
    let lo = 0, hi = values.length;
    while(lo < hi){
      const mid = Math.floor((lo + hi) / 2);
      if(values[mid] < target)lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const timeToY = minute=>{
    const min = Math.max(0,Math.min(1440,minute));
    const i = firstAtOrAfter(minutes,min);
    if(i <= 0)return positions[0];
    return positions[i-1] + (min - minutes[i-1]) / (minutes[i] - minutes[i-1]) * (positions[i] - positions[i-1]);
  };
  const yToTime = y=>{
    const i = firstAtOrAfter(positions,y);
    if(i === 0)return 0;
    if(i === positions.length)return 1440;
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

function weekViewAlignedColumnHtml(day,rows,axis,todayKey,visibleCount){
  const wide = (visibleCount || 1) <= 1;
  const flat = (visibleCount || 1) <= 3;
  const pos = row=>`top:${axis.timeToY(row.topMin)}px;height:${Math.max(2,axis.timeToY(row.botMin)-axis.timeToY(row.topMin)-4)}px;`;
  const events = weekViewAssignLanes(rows.events.map(row=>({...row}))).map(ev=>{
    const height = Math.max(2,axis.timeToY(ev.botMin)-axis.timeToY(ev.topMin)-4);
    const shared = (ev.lanes || 1) > 1 && (ev.span || 1) < (ev.lanes || 1);
    const box = {
      y:axis.timeToY(ev.topMin),h:height,fill:100,startMin:ev.topMin,endMin:ev.botMin,
      showMeta:wide && height >= 48,
      showDur:wide && height >= 36,
      showClock:!wide && height >= 28,
      wide,flat,narrow:shared,brief:height < 40
    };
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
    const route = `${leg.mins}m · ${leg.toName || 'travel'}`;
    const travelText = flat && !wide ? `${leg.mins}m` : route;
    return `<button type="button" class="wv-travel" data-wv-travel="${escapeHtml(leg.id)}" style="${pos(leg)}left:3px;right:3px;" aria-label="${escapeHtml(`${leg.mins} minutes, ${leg.fromName} to ${leg.toName}`)}"><i class="ti ti-route" aria-hidden="true"></i><span>${escapeHtml(travelText)}</span></button>`;
  }).join('');
  const now = day.dayKey === todayKey ? `<div class="wv-nowline" data-wv-elastic-now="${day.dayKey}" style="top:${axis.timeToY(weekViewMinuteOfDay(Date.now()))}px"><i></i></div>` : '';
  return `<div class="wv-col is-aligned${day.dayKey === todayKey ? ' is-today' : ''}" data-wv-daycol="${day.dayKey}"><div class="wv-list" style="height:${axis.height}px">${busy}${travel}${events}${now}</div></div>`;
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
      if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h))return;
      if(raw.occurrenceKey && typeof isPlanLog === 'function' && typeof logOccurrenceKey === 'function'){
        const logs = typeof normalizeLogs === 'function' ? normalizeLogs(h.logs) : [];
        if(logs.some(log=>!isPlanLog(log) && logOccurrenceKey(log) === raw.occurrenceKey))return;
      }
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
        occurrenceKey:raw.occurrenceKey || '',
        scheduleOptionId:raw.scheduleOptionId || '',
        dayKey,
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
          occurrenceKey:'',
          scheduleOptionId:'',
          dayKey,
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

// The planner will place items from today through thirteen days ahead.
// Anything else is still drawn, from busy time and fixed appointments.
const WEEK_VIEW_HORIZON = 14;

function weekViewDayOffset(dayKey){
  const dayBase = dayStart(new Date(`${dayKey}T12:00:00`).getTime());
  const today = dayStart(Date.now());
  if(!Number.isFinite(dayBase))return 0;
  return Math.round((dayBase - today) / 86400000);
}

function weekViewStripDays(){
  const days = [];
  for(let i = 0;i < _weekViewSpan;i += 1){
    const offset = _weekViewAnchor + i;
    const dayBase = offsetCalendarDay(Date.now(),offset);
    days.push({dayBase,dayKey:dateKey(dayBase),offset});
  }
  return days;
}

// A day the planner did not pack. Busy blocks and untimed markers are added
// later by weekCalendarRows; fixed appointments keep the clock time the user
// already saved.
function weekViewRoughSource(dayBase,data){
  const dayEnd = offsetCalendarDay(dayBase,1);
  const dayKey = dateKey(dayBase);
  const timeline = [];
  const push = (h,i,start,end,occurrenceKey)=>{
    if(!Number.isFinite(start) || !(end > dayBase && start < dayEnd))return;
    timeline.push({kind:'scheduled',h,i,start,end,occurrenceKey,chunkIndex:0});
  };
  (data || []).forEach((h,i)=>{
    if(!h || (typeof isCalendarIgnored === 'function' && isCalendarIgnored(h)))return;
    if(isLocalAppointment(h)){
      for(const key of [dateKey(offsetCalendarDay(dayBase,-1)),dayKey]){
        const occurrence = appointmentOccurrence(h,key);
        if(occurrence)push({...h,emoji:occurrence.emoji,emojiBgColor:occurrence.emojiBgColor},i,occurrence.start,occurrence.end,occurrence.occurrenceKey);
      }
      return;
    }
    if(!isFixedTimedTask(h) || isTaskDone(h))return;
    const start = Number(h.eventTime);
    const mins = typeof clampDuration === 'function' ? clampDuration(h.durationMinutes) : (Number(h.durationMinutes) || 30);
    push(h,i,start,start + Math.max(1,mins) * 60000,`rough|${h.hid || i}`);
  });
  timeline.sort((a,b)=>a.start - b.start || a.i - b.i);
  return {dayBase,dayKey,timeline,agendaItems:[]};
}

function weekViewPickSource(day,data,initialWeek,horizonWeek){
  const from = week=>week && Array.isArray(week.days) ? week.days.find(row=>dateKey(row.dayBase) === day.dayKey) : null;
  if(day.offset >= 0 && day.offset < 7){
    const home = from(initialWeek);
    if(home)return home;
  }
  if(day.offset >= 0 && day.offset < WEEK_VIEW_HORIZON){
    return from(horizonWeek) || from(initialWeek) || weekViewRoughSource(day.dayBase,data);
  }
  return weekViewRoughSource(day.dayBase,data);
}

function weekViewSubtitle(days){
  if(!days.length)return '';
  const offsets = days.map(day=>day.offset);
  if(offsets.some(offset=>offset < 0 || offset >= WEEK_VIEW_HORIZON))return 'Rough picture · busy time and fixed appointments';
  if(offsets.every(offset=>offset >= 7))return 'Preview · placements may change';
  if(offsets.some(offset=>offset >= 7))return 'Later days may still move';
  return '';
}

function weekViewCancelAlign(){
  _weekViewAlignToken += 1;
  _weekViewAligning = false;
  _weekViewAlignTarget = null;
}

// The measured day-column pitch, cached by weekViewSizeBoard so scroll math
// (settle, align, nudge) never forces a layout read after the board's style
// writes. `board` guards staleness: a re-render builds a fresh board.
let _weekViewColStep = null;

function weekViewSizeBoard(scroller){
  const board = scroller && scroller.querySelector('.wv-board');
  if(!board || !scroller.clientWidth)return;
  const visible = Number(board.dataset.visible) || 1;
  const span = Number(board.dataset.span) || visible;
  const gutter = scroller.parentElement && scroller.parentElement.querySelector('.wv-rail .wv-gutter');
  const gutterW = gutter ? gutter.getBoundingClientRect().width : 13;
  const gap = parseFloat(getComputedStyle(board).getPropertyValue('--wv-col-gap')) || 0;
  const area = Math.max(1,scroller.clientWidth - gutterW);
  const col = Math.max(1,(area - gap * Math.max(0,visible - 1)) / visible);
  const template = `repeat(${span},${col}px)`;
  const width = gutterW + col * span + gap * Math.max(0,span - 1);
  const widthPx = `${width}px`;
  // Writes only when a value actually changed: this runs on every resize
  // tick, and redundant style writes force a full board recalc each time.
  if(board.style.width !== widthPx)board.style.width = widthPx;
  const yscroll = scroller.querySelector('.wv-yscroll');
  if(yscroll && yscroll.style.width !== widthPx)yscroll.style.width = widthPx;
  board.querySelectorAll('.wv-cols,.wv-days-head,.wv-marker-grid').forEach(el=>{
    if(el.style.gridTemplateColumns !== template)el.style.gridTemplateColumns = template;
  });
  _weekViewColStep = {board,step:col + gap};
  weekViewSyncRail();
}

function weekViewColumnStep(scroller){
  if(_weekViewColStep && _weekViewColStep.board && _weekViewColStep.board.isConnected){
    return _weekViewColStep.step;
  }
  const cols = scroller.querySelectorAll('.wv-col');
  if(cols.length >= 2)return cols[1].getBoundingClientRect().left - cols[0].getBoundingClientRect().left;
  return cols[0] ? cols[0].getBoundingClientRect().width : 1;
}

// The ease just finished (or was replaced); the strip sits on its day now.
function weekViewAlignLanded(){
  _weekViewAligning = false;
  _weekViewAlignTarget = null;
}

function weekViewYScroller(scroller){
  return scroller ? scroller.querySelector('.wv-yscroll') : null;
}

// The hour rail and the head corner are painted outside the scrollers, so
// they follow the clock's vertical scroll with one composited transform.
// Runs rAF-batched; safe to call from every scroll and scroll write.
function weekViewSyncRail(){
  if(_weekViewRailRaf)return;
  _weekViewRailRaf = requestAnimationFrame(()=>{
    _weekViewRailRaf = 0;
    const host = document.querySelector('#week-view-body .wv-clock');
    if(!host)return;
    const y = host.querySelector('.wv-yscroll');
    const rail = host.querySelector('.wv-rail');
    const track = host.querySelector('.wv-rail .wv-gutter');
    const cover = host.querySelector('.wv-corner-cover');
    const headH = host.querySelector('.wv-board-head')?.offsetHeight || 0;
    if(rail)rail.style.top = `${headH}px`;
    if(cover)cover.style.height = `${headH}px`;
    // The now tag overhangs the gutter onto the clock, so it rides in its own
    // unclipped layer next to the clipped hour labels.
    const nowrail = host.querySelector('.wv-nowrail');
    const nowtrack = host.querySelector('.wv-nowtrack');
    if(nowrail){nowrail.style.top = `${headH}px`;}
    if(y && nowtrack)nowtrack.style.transform = `translateY(${-y.scrollTop}px)`;
    if(y && track)track.style.transform = `translateY(${-y.scrollTop}px)`;
  });
}

// Update the date title after the strip settles, without touching the day
// cards during a swipe. The debounce covers engines without scrollend.
function weekViewQueueSettle(scroller){
  clearTimeout(_weekViewSettleTimer);
  if(!scroller || !scroller.isConnected)return;
  _weekViewSettleTimer = setTimeout(()=>{
    _weekViewSettleTimer = null;
    weekViewOnScrollSettled(document.querySelector('#week-view-body .wv-scroller'));
  },150);
}

function weekViewOnScrollSettled(scroller){
  clearTimeout(_weekViewSettleTimer);
  _weekViewSettleTimer = null;
  if(!scroller || !scroller.isConnected)return;
  // A finger pausing mid-gesture stops the scroll events without ending the
  // touch, so a settle fired now would yank the strip sideways under the
  // finger. Defer it to touch end instead.
  if(_weekViewTouchActive){_weekViewSettlePending = true;return;}
  _weekViewSettlePending = false;
  weekViewAlignDays(scroller);
  // Paint from where the strip is heading: mid-ease the live offset still
  // reads the old day, and waiting for the ease to land would drag the title
  // behind a continuing fling.
  weekViewPaintSelection();
}

function weekViewCancelScroll(){
  clearTimeout(_weekViewSettleTimer);
  _weekViewSettleTimer = null;
  weekViewCancelAlign();
}

// A free horizontal drag may stop mid-column. Once it settles, ease to the
// nearest day so a column is not left cut off. The native snap does this for
// a finger drag; this covers a stop that is still between days.
function weekViewAlignDays(scroller){
  if(!scroller || !scroller.isConnected || _weekViewAligning)return;
  const step = weekViewColumnStep(scroller);
  if(!(step > 1))return;
  const max = Math.max(0,scroller.scrollWidth - scroller.clientWidth);
  let target = Math.round(scroller.scrollLeft / step) * step;
  if(target > max)target = Math.floor((max + 0.5) / step) * step;
  target = Math.max(0,Math.min(max,target));
  const delta = target - scroller.scrollLeft;
  if(Math.abs(delta) < 1.5)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    scroller.scrollLeft = target;
    return;
  }
  const token = ++_weekViewAlignToken;
  _weekViewAligning = true;
  _weekViewAlignTarget = target;
  const start = scroller.scrollLeft;
  const t0 = performance.now();
  let written = start;
  const tick = now=>{
    if(token !== _weekViewAlignToken || !scroller.isConnected){
      if(token === _weekViewAlignToken)weekViewAlignLanded();
      return;
    }
    if(Math.abs(scroller.scrollLeft - written) > 2){
      // Something else moved the strip mid-ease; restart from where it is.
      // The deferred paint stays armed and runs when the restart lands.
      _weekViewAligning = false;
      _weekViewAlignTarget = null;
      weekViewAlignDays(scroller);
      return;
    }
    const p = Math.min(1,(now - t0) / 160);
    written = start + delta * (1 - Math.pow(1 - p,3));
    scroller.scrollLeft = written;
    if(p < 1)requestAnimationFrame(tick);
    else weekViewAlignLanded();
  };
  requestAnimationFrame(tick);
}

function weekViewScrollToDay(scroller,key){
  const cols = [...scroller.querySelectorAll('.wv-col')];
  const index = cols.findIndex(el=>el.dataset.wvDaycol === key);
  if(index < 0)return;
  scroller.scrollLeft = index * weekViewColumnStep(scroller);
}

// Measure the clock below the sticky date/marker header, so changing the
// layout or zoom keeps the same time in the middle of the usable viewport.
function weekViewViewportMinute(scroller){
  const y = weekViewYScroller(scroller) || scroller;
  const head = scroller.querySelector('.wv-board-head')?.offsetHeight || 0;
  const mid = y.scrollTop + (y.clientHeight - head) / 2;
  return scroller.closest('.wv-body').classList.contains('is-list') && _weekViewSharedAxis
    ? _weekViewSharedAxis.yToTime(mid) : mid * 60 / _weekViewZoom;
}

function weekViewRestoreMinute(scroller,minute){
  const y = weekViewYScroller(scroller) || scroller;
  const head = scroller.querySelector('.wv-board-head')?.offsetHeight || 0;
  const py = _weekViewMode === 'list' && _weekViewSharedAxis
    ? _weekViewSharedAxis.timeToY(minute) : minute * _weekViewZoom / 60;
  y.scrollTop = Math.max(0,py - (y.clientHeight - head) / 2);
  weekViewSyncRail();
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

// One Intl format per wall-clock minute, not per event: a 14-day board asks
// for the same clock hundreds of times per render, and toLocaleTimeString
// construction dominated the open cost on phone-class CPUs.
const _weekViewTimeLabels = new Map();
function weekViewTimeLabel(ts){
  const d = new Date(ts);
  const key = d.getHours() * 60 + d.getMinutes();
  let label = _weekViewTimeLabels.get(key);
  if(label === undefined){
    label = d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    if(_weekViewTimeLabels.size >= 1440)_weekViewTimeLabels.clear();
    _weekViewTimeLabels.set(key,label);
  }
  return label;
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
  if(!weekPreviewWorkerAvailable())return null;
  if(_weekPreviewWorker)return _weekPreviewWorker;
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

// Fast 14-day projection on the dedicated preview worker, so days past the
// mounted week still have an agenda and Home's planner is left alone.
// A newer request invalidates an older one; the shared worker is never used.
function weekViewHorizonKey(data){
  return weekViewCacheKey(`${dateKey(Date.now())}|horizon`,'fast',homePlannerDirtyKey(data));
}

function weekViewEnsureHorizonWeek(data,gen){
  const key = weekViewHorizonKey(data);
  if(_weekViewCache.has(key))return null;
  if(_weekViewPending.has(key))return _weekViewPending.get(key);
  const seq = ++_weekHorizonSeq;
  const promise = weekPreviewRequest(data,sortSettings,WEEK_VIEW_HORIZON,'fast',homePlannerDirtyKey(data))
    .then(week=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      if(seq !== _weekHorizonSeq || gen !== weekViewGen || !weekSheetOpen())return null;
      if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,data);
      weekViewCachePut(key,week);
      return week;
    })
    .catch(err=>{
      if(_weekViewPending.get(key) === promise)_weekViewPending.delete(key);
      if(seq !== _weekHorizonSeq || gen !== weekViewGen || !weekSheetOpen())return null;
      throw err;
    });
  _weekViewPending.set(key,promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER. One normalized model drives both layouts, with a single clock across
// visible columns. Phones default to three days and desktop defaults to seven.
// ─────────────────────────────────────────────────────────────────────────
let _weekViewCtx = new Map();          // element id → original row for actions
let _weekViewDirtyKey = '';
let _weekViewTodayKey = '';
let _weekViewLayout = 'phone';
let _weekViewBound = false;
let _weekViewTimer = null;
let _weekViewScrollReset = true;
let _weekViewResize = null;
let _weekViewError = '';
let _weekViewMode = 'list';          // 'list' (elastic) or 'grid' (proportional)
let _weekViewOpenGaps = new Set();   // expanded long-gap ids, while the sheet is open
let _weekViewDetailLayout = null;    // selected day's elastic layout, for the now line
let _weekViewColumnLayouts = new Map();
let _weekViewRenderedDay = '';
let _weekViewPhoneDays = 3;
let _weekViewWideDays = 7;
let _weekViewZoom = 144;
let _weekViewColor = 'topic';
let _weekViewSharedAxis = null;
let _weekViewReturnFocus = null;
let _weekViewOpener = null;
let _weekViewWindowStart = 0;
let _weekViewOptionsOpen = false;
let _weekViewFiltersHtml = '';
let _weekViewAnchor = 0;
let _weekViewSpan = WEEK_VIEW_HORIZON;
let _weekViewMonthOpen = false;
let _weekViewMonthOffset = 0;
let _weekViewScrollLeft = 0;
let _weekViewScrollTop = 0;
let _weekViewScrollToKey = '';
let _weekViewAlignToken = 0;
let _weekViewAligning = false;
let _weekViewAlignTarget = null;
let _weekViewSettleTimer = null;
let _weekViewSettlePending = false;
let _weekViewRailRaf = 0;
let _weekViewStrip = [];
let _weekViewRowsByDay = new Map();
let _weekHorizonSeq = 0;
let _weekViewTouchActive = false;
let _weekViewScrollAt = 0;
let _weekViewScrollAxis = '';        // 'x' (day strip) or 'y' (clock), last scrolled
let _weekViewRefreshTimer = null;
const WEEK_VIEW_PREFS_KEY = 'tings_week_view_v1';

// A worker result must not replace the native scroller under a finger or
// during momentum. Keep the result cached and paint it after scrolling ends.
function weekViewRequestRefresh(){
  clearTimeout(_weekViewRefreshTimer);
  _weekViewRefreshTimer = null;
  if(!weekSheetOpen())return;
  if(_weekViewTouchActive || Date.now() - _weekViewScrollAt < 180){
    _weekViewRefreshTimer = setTimeout(weekViewRequestRefresh,180);
    return;
  }
  renderWeekView();
}

function weekViewLoadPreferences(){
  try{
    const prefs = JSON.parse(localStorage.getItem(WEEK_VIEW_PREFS_KEY) || '{}');
    if(['grid','list'].includes(prefs.mode))_weekViewMode = prefs.mode;
    if([1,2,3,7].includes(prefs.days))_weekViewPhoneDays = prefs.days;
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
  // Keep separate phone and desktop day-count preferences when resizing.
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

// Keep the meridiem even on narrow cards; the compressed clock can put
// morning and evening close together.
function weekViewCompactTime(ts){
  return weekViewRailClock(weekViewMinuteOfDay(ts));
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

function weekViewGutterHtml(hourStep){
  const cells = [];
  for(let h = 0;h < 24;h += hourStep){
    cells.push(`<span class="wv-hour" style="top:calc(${h * 60} * var(--wv-hour-h) / 60);">${escapeHtml(weekViewRailClock(h * 60))}</span>`);
  }
  return cells.join('');
}

// Equal-width columns make two- and three-day comparisons readable.
function weekViewGridColumns(days){
  return `repeat(${days.length},minmax(0,1fr))`;
}

function weekViewDayColHtml(day,rows,todayKey,selectedKey,showNow){
  const isToday = day.dayKey === todayKey;
  const busy = rows.busy.map(weekViewBusyHtml).join('');
  const travel = rows.travel.map(weekViewTravelHtml).join('');
  const events = rows.events.map(weekViewEventHtml).join('');
  const nowMin = weekViewMinuteOfDay(Date.now());
  const now = isToday && showNow
    ? `<div class="wv-nowline" data-wv-now style="top:calc(${nowMin} * var(--wv-hour-h) / 60);"><i></i></div>`
    : '';
  return `<div class="wv-col${isToday ? ' is-today' : ''}" data-wv-daycol="${escapeHtml(day.dayKey)}">`
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

function weekViewHeadSummary(layout,wide){
  if(!layout || layout.empty)return '';
  const planned = layout.plannedMin > 0 ? weekViewSpanPhrase(layout.plannedMin) : '';
  if(!wide)return planned;
  const tight = layout.status === 'overlap' || layout.status === 'tight';
  if(tight && planned)return `${planned} · ${weekViewStatusLabel(layout.status).toLowerCase()}`;
  if(planned && layout.freeMin >= 45)return `${planned} · ${weekViewFreePhrase(layout.freeMin)}`;
  if(planned)return planned;
  return layout.freeMin >= 45 ? weekViewFreePhrase(layout.freeMin) : '';
}

function weekViewDaysHeadHtml(days,todayKey,selectedKey,layoutByDay,visibleCount){
  const wide = (visibleCount || 1) <= 1;
  return days.map(day=>{
    const d = new Date(day.dayBase);
    const layout = layoutByDay && layoutByDay.get(day.dayKey);
    const load = weekViewHeadSummary(layout,wide);
    const hot = Boolean(layout && (layout.ratio >= 0.85 || layout.status === 'tight' || layout.status === 'overlap'));
    const full = d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    return `<button type="button" class="wv-day-head${day.dayKey === todayKey ? ' is-today' : ''}" data-wv-dayhead="${escapeHtml(day.dayKey)}" aria-label="${escapeHtml(load ? `${full}, ${load}, open day details` : `${full}, open day details`)}">`
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

function weekViewDurCompact(mins){
  return weekViewSpanPhrase(mins);
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

function weekViewCanMarkDone(ev){
  const h = ev && ev.h;
  if(!h || ev.status === 'active')return false;
  if(typeof isEventItem === 'function' && isEventItem(h))return false;
  if(h.type === 'zero')return false;
  return true;
}

function weekViewListHabitHtml(ev,box,rail){
  _weekViewCtx.set(ev.id,ev);
  const when = `${weekViewTimeLabel(ev.start)} – ${weekViewTimeLabel(ev.end)}`;
  const statusCls = ev.status === 'active' ? ' is-active' : ev.status === 'past' ? ' is-past' : '';
  const full = box.fill >= 99 ? ' is-full' : '';
  const meta = box.showMeta ? `<span class="wv-event-meta">${escapeHtml(weekViewHabitMeta(ev))}</span>` : '';
  const dur = box.showDur === false ? '' : `<span class="wv-event-dur">${escapeHtml(weekViewDurCompact(box.endMin - box.startMin))}</span>`;
  const title = `<span class="wv-event-title">${!box.flat && ev.emoji ? `<span class="wv-event-emoji">${escapeHtml(ev.emoji)}</span>` : ''}<span class="wv-event-clock">${escapeHtml(weekViewCompactTime(ev.start))}</span><span class="wv-event-name">${escapeHtml(ev.title)}</span></span>`;
  const body = `<span class="wv-event-line">${title}${dur}</span>${meta}${ev.status === 'active' ? '<span class="wv-event-flag">now</span>' : ''}`;
  const style = `${weekViewListPos(box,rail)}${weekViewTokenVars(ev.token)};--wv-fill:${box.fill || 0}%;`;
  const fit = `${box.narrow ? ' is-narrow' : ''}${box.brief ? ' is-brief' : ''}`;
  if(box.flat && !box.wide){
    const mark = weekViewCanMarkDone(ev)
      ? `<button type="button" class="wv-event-mark" data-wv-done="${escapeHtml(ev.id)}" aria-label="${escapeHtml(`Mark ${ev.title} done`)}">${ev.emoji ? escapeHtml(ev.emoji) : '<i class="ti ti-check" aria-hidden="true"></i>'}</button>`
      : (ev.emoji ? `<span class="wv-event-emoji" aria-hidden="true">${escapeHtml(ev.emoji)}</span>` : '');
    const clock = box.showClock ? `<span class="wv-event-clock">${escapeHtml(weekViewCompactTime(ev.start))}</span>` : '';
    return `<div class="wv-event${statusCls}${full}${fit}${mark ? ' has-mark' : ''}" style="${style}">`
      + `<span class="wv-event-fill" aria-hidden="true"></span>${mark}`
      + `<button type="button" class="wv-event-main" data-wv-event="${escapeHtml(ev.id)}" data-wv-hid="${escapeHtml(ev.hid || '')}" aria-label="${escapeHtml(`${when}, ${ev.title}`)}"><span class="wv-event-name">${escapeHtml(ev.title)}</span>${clock}</button>`
      + `</div>`;
  }
  if(!box.flat){
    return `<button type="button" class="wv-event${statusCls}${full}" data-wv-event="${escapeHtml(ev.id)}" data-wv-hid="${escapeHtml(ev.hid || '')}" style="${style}" aria-label="${escapeHtml(`${when}, ${ev.title}`)}">`
      + `<span class="wv-event-fill" aria-hidden="true"></span>${body}</button>`;
  }
  const mark = weekViewCanMarkDone(ev)
    ? `<button type="button" class="wv-event-mark" data-wv-done="${escapeHtml(ev.id)}" aria-label="${escapeHtml(ev.emoji ? `Mark ${ev.title} done` : `Mark ${ev.title} done`)}">${ev.emoji ? escapeHtml(ev.emoji) : '<i class="ti ti-check" aria-hidden="true"></i>'}</button>`
    : (ev.emoji ? `<span class="wv-event-emoji" aria-hidden="true">${escapeHtml(ev.emoji)}</span>` : '');
  return `<div class="wv-event${statusCls}${full}${mark ? ' has-mark' : ''}" style="${style}">`
    + `<span class="wv-event-fill" aria-hidden="true"></span>${mark}`
    + `<button type="button" class="wv-event-main" data-wv-event="${escapeHtml(ev.id)}" data-wv-hid="${escapeHtml(ev.hid || '')}" aria-label="${escapeHtml(`${when}, ${ev.title}`)}">${body}</button>`
    + `</div>`;
}

function weekViewSyncModeButton(){
  weekViewPaintTodayButton();
  document.querySelectorAll('[data-wv-mode]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.wvMode === _weekViewMode));
  });
  const desktop = _weekViewLayout === 'desktop';
  const choices = [1,2,3,7];
  const count = desktop ? _weekViewWideDays : _weekViewPhoneDays;
  const days = $('week-view-days');
  if(days){
    if(days.dataset.layout !== _weekViewLayout){
      days.innerHTML = choices.map(value=>`<button type="button" data-wv-days="${value}" aria-pressed="false">${value === 7 ? 'Week' : `${value} day${value === 1 ? '' : 's'}`}</button>`).join('')
        + '<button type="button" id="week-view-month-view" data-wv-calendar="month"><i class="ti ti-calendar-month" aria-hidden="true"></i>Month</button>';
      days.dataset.layout = _weekViewLayout;
    }
    days.querySelectorAll('[data-wv-days]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.wvDays) === count)));
  }
  $('week-view-options').hidden = !_weekViewOptionsOpen;
  $('week-view-options-backdrop').hidden = !_weekViewOptionsOpen;
  $('week-view-display-options').setAttribute('aria-expanded',String(_weekViewOptionsOpen));
  $('week-view-color').querySelectorAll('[data-wv-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.wvColor === _weekViewColor)));
  $('week-view-zoom').hidden = _weekViewMode !== 'grid';
  $('week-view-zoom-label').textContent = `${Math.round(_weekViewZoom / 96 * 100)}%`;
  $('week-view-zoom-out').disabled = _weekViewZoom === WEEK_VIEW_ZOOM_STEPS[0];
  $('week-view-zoom-in').disabled = _weekViewZoom === WEEK_VIEW_ZOOM_STEPS[WEEK_VIEW_ZOOM_STEPS.length-1];
  const minimal = isMinimalMode();
  const selection = overviewFilterSelection();
  const activeCount = ['topic','location','type','when','priority'].filter(kind=>selection[kind] !== 'all').length;
  $('week-view-filter-section').hidden = minimal;
  $('week-view-filter-title').textContent = activeCount ? `Filters (${activeCount})` : 'Filters';
  $('week-view-filters-reset').disabled = !activeCount;
}

// Opening a menu must not rebuild the clock or replace a native scroller.
// The panel overlays the calendar; each choice applies immediately.
function weekViewSetOptionsOpen(open,restoreFocus = true){
  _weekViewOptionsOpen = open;
  if(open){
    _weekViewMonthOpen = false;
    weekViewRenderMonth();
    weekViewRenderOptionsContent();
  }
  weekViewSyncModeButton();
  const panel = $('week-view-options');
  // Keep the calendar out of the accessibility tree while its drawer is modal.
  [...panel.parentElement.children].forEach(el=>{
    if(el !== panel && el.id !== 'week-view-options-backdrop')el.inert = open;
  });
  if(open){
    panel.scrollTop = 0;
    $('week-view-options-close').focus({preventScroll:true});
  }else if(restoreFocus)$('week-view-display-options').focus({preventScroll:true});
}

function weekViewRenderOptionsContent(data = load()){
  const visibleHids = weekViewVisibleHids(data);
  const legend = $('week-view-legend');
  legend.innerHTML = weekViewLegendHtml(data,visibleHids,weekViewTopicTokenMap(sortSettings));
  legend.hidden = !legend.innerHTML;
  const minimal = typeof isMinimalMode === 'function' && isMinimalMode();
  const groups = $('week-view-filter-groups');
  const html = minimal ? '' : libraryFilterView({
    prefix:'week-view-filter',attrPrefix:'wvfilter',items:data.filter(h=>!isCalendarIgnored(h)),
    selection:overviewFilterSelection(),
    topicChoices:overviewTopicChoices(data),locationChoices:overviewLocationChoices(data)
  }).groupsHtml;
  // Preserve focused filter controls when a background preview arrives.
  if(_weekViewFiltersHtml !== html){
    groups.innerHTML = html;
    _weekViewFiltersHtml = html;
  }
  $('week-view-filter-empty').hidden = Boolean(html);
}

// The header's mini-calendar button always shows the real current date, so it
// stays honest across midnight (the day-change tick repaints the header).
function weekViewPaintTodayButton(){
  const button = $('week-view-today');
  if(!button)return;
  const now = new Date();
  const dow = button.querySelector('.wv-today-cal-dow');
  const day = button.querySelector('.wv-today-cal-day');
  if(dow)dow.textContent = now.toLocaleDateString(undefined,{weekday:'short'});
  if(day)day.textContent = String(now.getDate());
  button.setAttribute('aria-label',`jump to today, ${now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}`);
}

function renderWeekViewHeader(label,sub){
  const text = $('week-view-label-text');
  const labelEl = $('week-view-label');
  const subEl = $('week-view-sub');
  if(text)text.textContent = label || '';
  if(labelEl){
    labelEl.disabled = false;
    delete labelEl.dataset.wvDayhead;
    labelEl.setAttribute('aria-expanded',String(_weekViewMonthOpen));
    labelEl.setAttribute('aria-label',label ? `${label}, choose a date` : 'choose a date');
  }
  if(subEl)subEl.textContent = sub || '';
  weekViewSyncModeButton();
}

function renderWeekViewStatus(loading){
  const status = $('week-view-status');
  if(!status)return;
  if(_weekViewError){
    status.innerHTML = `The full plan couldn’t be loaded. <button type="button" class="mini-text-btn" data-wv-retry="1">Try again</button>`;
    return;
  }
  status.textContent = loading ? 'Planning the next days…' : '';
}

function weekViewFocusMinute(day,rows){
  if(!day)return 8 * 60;
  if(day.dayKey === dateKey(Date.now()))return weekViewMinuteOfDay(Date.now());
  const events = rows && rows.events || [];
  if(events.length)return Math.max(0,Math.min(...events.map(ev=>ev.topMin)) - 30);
  return 8 * 60;
}

function weekViewVisibleDays(days,scroller,slOverride){
  const count = Number(scroller && scroller.dataset.visible) || 1;
  const step = scroller ? weekViewColumnStep(scroller) : 1;
  const maxStart = Math.max(0,days.length - count);
  const sl = slOverride != null ? slOverride : (scroller && scroller.scrollLeft) || 0;
  const start = Math.max(0,Math.min(maxStart,Math.round(sl / Math.max(1,step))));
  return days.slice(start,start + count);
}

function weekViewPaintSelection(){
  const days = _weekViewStrip;
  const scroller = document.querySelector('#week-view-body .wv-scroller');
  if(!days.length || !scroller)return;
  const visible = weekViewVisibleDays(days,scroller,_weekViewAligning ? _weekViewAlignTarget : null);
  const selected = visible[0];
  if(!selected)return;
  const changed = weekViewDaySel !== selected.dayKey;
  weekViewDaySel = selected.dayKey;
  weekViewOffset = selected.offset;
  const label = visible.length === 1
    ? new Date(selected.dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})
    : weekViewRangeLabel(visible);
  renderWeekViewHeader(label,weekViewSubtitle(visible));
  if(!changed)return;
  const host = $('week-view-body');
  if(!host)return;
  const existing = host.querySelector('.wv-unplaced');
  const next = weekViewUnplacedHtml(_weekViewRowsByDay.get(selected.dayKey),selected.dayKey);
  if(existing){
    if(next)existing.outerHTML = next;
    else existing.remove();
  }else if(next)host.insertAdjacentHTML('beforeend',next);
}

function weekViewBoardHtml(days,rowsByDay,layoutByDay,todayKey,listMode,axis,visibleCount){
  const columns = weekViewGridColumns(days);
  const desktop = _weekViewLayout === 'desktop';
  const flat = listMode && visibleCount <= 3;
  const head = `<div class="wv-days-head${desktop ? '' : ' is-split'}" style="grid-template-columns:${columns}">${weekViewDaysHeadHtml(days,todayKey,weekViewDaySel,layoutByDay,visibleCount)}</div>`;
  const dayCells = days.map(day=>({day,rows:rowsByDay.get(day.dayKey)}));
  const markers = dayCells.some(cell=>cell.rows.markers.length)
    ? `<div class="wv-marker-grid" style="--wv-days:${days.length};grid-template-columns:${columns}">${weekViewMarkersRowHtml(dayCells)}</div>`
    : '';
  const nowMin = days.some(day=>day.dayKey === todayKey) ? weekViewMinuteOfDay(Date.now()) : null;
  const gutter = listMode
    ? axis.ticks.map(tick=>`<span class="wv-hour" style="top:${tick.y}px">${escapeHtml(tick.label)}</span>`).join('')
    : weekViewGutterHtml(1);
  const nowtag = nowMin == null ? ''
    : `<span class="wv-nowtag" data-wv-nowtag style="top:${listMode ? `${axis.timeToY(nowMin)}px` : `calc(${nowMin} * var(--wv-hour-h) / 60)`};">${escapeHtml(weekViewRailClock(nowMin))}</span>`;
  const cols = listMode
    ? days.map(day=>weekViewAlignedColumnHtml(day,rowsByDay.get(day.dayKey),axis,todayKey,visibleCount)).join('')
    : days.map(day=>weekViewDayColHtml(day,rowsByDay.get(day.dayKey),todayKey,weekViewDaySel,true)).join('');
  const trackHeight = listMode ? `${axis.height}px` : 'calc(1440 * var(--wv-hour-h) / 60)';
  // Axis-locked scrolling: the outer scroller pans the day strip (x only) and
  // the inner one scrolls the clock (y only), so the browser locks every
  // touch drag to one axis instead of sliding both. The hour rail and the
  // head corner are painted from outside the scrollers — sticky-left cannot
  // pin inside the inner scroller — and follow the clock via weekViewSyncRail.
  return `<div class="wv-clock"><div class="wv-scroller" data-visible="${visibleCount}"><div class="wv-yscroll"><div class="wv-board${listMode && !flat ? ' is-aligned-grid' : ''}${flat ? ' is-flat' : ''}" data-visible="${visibleCount}" data-span="${days.length}"><div class="wv-board-head"><div class="wv-corner" aria-hidden="true"></div><div class="wv-board-head-main">${head}${markers}</div></div><div class="wv-cols" style="height:${trackHeight};grid-template-columns:${columns}">${cols}</div></div></div></div><div class="wv-rail" aria-hidden="true"><div class="wv-gutter" style="height:${trackHeight}">${gutter}</div></div><div class="wv-nowrail" aria-hidden="true"><div class="wv-nowtrack" style="height:${trackHeight}">${nowtag}</div></div><div class="wv-corner-cover" aria-hidden="true"></div></div>`;
}

function renderWeekView(){
  const body = $('week-view-body');
  const markersEl = $('week-view-markers');
  if(!body)return;
  if(_weekViewTouchActive){weekViewRequestRefresh();return;}
  // Capture before updating controls: hiding grid zoom or wrapping a legend
  // can resize the viewport, especially on small phones.
  const prior = body.querySelector('.wv-scroller');
  const priorMinute = prior && !_weekViewScrollReset ? weekViewViewportMinute(prior) : null;
  if(prior && !_weekViewScrollReset){
    // Mid-settle the strip is between days; restore the settle target so a
    // re-render cannot park it on a cut column.
    _weekViewScrollLeft = (_weekViewAligning && _weekViewAlignTarget != null)
      ? _weekViewAlignTarget : prior.scrollLeft;
    _weekViewScrollTop = prior.scrollTop;
  }
  const data = typeof load === 'function' ? load() : [];
  const settings = sortSettings || loadSortSettings();
  settleCalendarFilterChoices(data);
  const dirtyKey = homePlannerDirtyKey(data);
  const revisionChanged = Boolean(_weekViewDirtyKey) && dirtyKey !== _weekViewDirtyKey;
  _weekViewDirtyKey = dirtyKey;
  const todayKey = dateKey(Date.now());
  if(_weekViewTodayKey && todayKey !== _weekViewTodayKey){
    // Midnight crossed while open: anchors and cached weeks are all stale.
    _weekViewTodayKey = todayKey;
    weekViewOffset = 0;
    weekViewDaySel = todayKey;
    _weekViewAnchor = 0;
    _weekViewSpan = WEEK_VIEW_HORIZON;
    _weekViewCache.clear();
    _weekViewError = '';
    weekViewGen += 1;
    _weekHorizonSeq += 1;
  }else if(!_weekViewTodayKey){
    _weekViewTodayKey = todayKey;
  }
  if(revisionChanged){
    // Edits/deletions landed while open: cached weeks and in-flight preview
    // requests are stale; regenerate under a fresh generation.
    _weekViewCache.clear();
    _weekViewError = '';
    weekViewGen += 1;
    _weekHorizonSeq += 1;
  }
  if(!weekViewDaySel)weekViewDaySel = todayKey;

  const days = weekViewStripDays();
  _weekViewStrip = days;
  const topicMap = weekViewTopicTokenMap(settings);
  const visibleHids = weekViewVisibleHids(data);
  const desktop = weekViewDesktopLayout() === 'desktop';
  if(desktop !== (_weekViewLayout === 'desktop')){
    _weekViewScrollReset = false;
    _weekViewScrollToKey = weekViewDaySel;
  }
  _weekViewLayout = desktop ? 'desktop' : 'phone';

  const gen = weekViewGen;
  const initial = weekViewInitialWeek(data);
  let horizon = _weekViewCache.get(weekViewHorizonKey(data)) || null;
  let pendingPromise = null;
  if(!horizon && !_weekViewError)pendingPromise = weekViewEnsureHorizonWeek(data,gen);
  if(pendingPromise){
    pendingPromise.then(resolved=>{
      if(resolved && gen === weekViewGen && weekSheetOpen())weekViewRequestRefresh();
    }).catch(err=>{
      if(!weekSheetOpen() || gen !== weekViewGen)return;
      if(!err || err.message === 'week view closed')return;
      _weekViewError = err;
      weekViewRequestRefresh();
    });
  }
  const loading = !initial && !horizon && Boolean(pendingPromise);

  if(!days.some(day=>day.dayKey === weekViewDaySel))weekViewDaySel = days[0].dayKey;
  const selectedKey = _weekViewScrollToKey || weekViewDaySel;
  const selectedDay = days.find(day=>day.dayKey === selectedKey) || days[0];
  const listMode = _weekViewMode !== 'grid';
  const visibleCount = desktop ? _weekViewWideDays : _weekViewPhoneDays;
  const guessStart = Math.max(0,days.findIndex(day=>day.dayKey === selectedDay.dayKey));
  const guess = days.slice(guessStart,guessStart + visibleCount);
  renderWeekViewHeader(
    guess.length === 1 ? new Date(guess[0].dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}) : weekViewRangeLabel(guess),
    weekViewSubtitle(guess)
  );
  if(_weekViewOptionsOpen)weekViewRenderOptionsContent(data);

  const active = document.activeElement;
  const focusAttr = ['data-wv-dayhead','data-wv-event','data-wv-busy','data-wv-travel','data-wv-gap','data-wv-marker','data-wv-unplaced'].find(attr=>active && active.hasAttribute(attr));
  const focusValue = focusAttr ? active.getAttribute(focusAttr) : '';

  const rowsByDay = new Map();
  const layoutByDay = new Map();
  days.forEach(day=>{
    const src = weekViewPickSource(day,data,initial,horizon);
    const rows = weekCalendarRows(src,data,settings,topicMap,visibleHids);
    rowsByDay.set(day.dayKey,rows);
    layoutByDay.set(day.dayKey,weekViewLayoutFor(rows,day.dayKey,day.dayBase,settings,null));
  });
  _weekViewRowsByDay = rowsByDay;

  _weekViewSharedAxis = null;
  _weekViewCtx = new Map();
  _weekViewColumnLayouts = new Map();
  _weekViewDetailLayout = null;

  if(markersEl){
    markersEl.innerHTML = '';
    markersEl.hidden = true;
  }

  const axis = listMode ? weekViewSharedTimeAxis(days.map(day=>rowsByDay.get(day.dayKey))) : null;
  _weekViewSharedAxis = axis;
  body.style.setProperty('--wv-agenda-lines',axis ? `linear-gradient(to bottom,${axis.ticks.flatMap(tick=>[
    `transparent ${tick.y}px`,`var(--border) ${tick.y}px`,`var(--border) ${tick.y + 1}px`,`transparent ${tick.y + 1}px`
  ]).join(',')})` : 'none');
  if(listMode && axis && days.some(day=>day.dayKey === todayKey))_weekViewColumnLayouts.set(todayKey,axis);

  body.style.setProperty('--wv-hour-h',`${weekViewHourPx()}px`);
  body.classList.toggle('is-list',listMode);
  body.classList.toggle('is-grid',!listMode);
  body.classList.toggle('is-multi',visibleCount > 1);
  body.classList.toggle('is-flat',listMode && visibleCount <= 3);
  body.dataset.days = String(visibleCount);
  body.innerHTML = weekViewBoardHtml(days,rowsByDay,layoutByDay,todayKey,listMode,axis,visibleCount)
    + weekViewUnplacedHtml(rowsByDay.get(selectedDay.dayKey),selectedDay.dayKey);
  body.setAttribute('aria-busy',String(loading));
  // The old scroller is gone: an ease aimed at it must not steer selection
  // painting on the new board.
  weekViewCancelAlign();
  renderWeekViewStatus(loading);
  body.classList.toggle('is-loading',loading && !_weekViewError);

  const scroller = body.querySelector('.wv-scroller');
  if(scroller){
    weekViewSizeBoard(scroller);
    const y = weekViewYScroller(scroller);
    if(_weekViewScrollToKey){
      weekViewScrollToDay(scroller,_weekViewScrollToKey);
      _weekViewScrollToKey = '';
    }else if(_weekViewScrollReset){
      weekViewScrollToDay(scroller,weekViewDaySel);
    }else scroller.scrollLeft = _weekViewScrollLeft;
    if(_weekViewScrollReset){
      const minute = weekViewFocusMinute(selectedDay,rowsByDay.get(selectedDay.dayKey));
      if(listMode && axis && y)y.scrollTop = Math.max(0,axis.timeToY(minute) - 72);
      else weekViewScrollSeed(scroller,rowsByDay.get(selectedDay.dayKey),selectedDay.dayKey);
    }else if(Number.isFinite(priorMinute)){
      weekViewRestoreMinute(scroller,priorMinute);
    }else if(y){
      y.scrollTop = _weekViewScrollTop;
      weekViewSyncRail();
    }
    weekViewPaintSelection();
  }
  if(focusAttr){
    const restored = [...document.querySelectorAll(`#week-sheet [${focusAttr}]`)].find(el=>el.getAttribute(focusAttr) === focusValue);
    restored?.focus({preventScroll:true});
  }
  _weekViewScrollReset = false;
  _weekViewRenderedDay = weekViewDaySel;
  weekViewRenderMonth();
}

function weekViewScrollSeed(scroller,rows,dayKey){
  const y = weekViewYScroller(scroller) || scroller;
  const todayKey = dateKey(Date.now());
  const nowMin = weekViewMinuteOfDay(Date.now());
  let targetMin;
  if(dayKey === todayKey)targetMin = Math.max(0,nowMin - 90);
  else if(rows && rows.events.length){
    targetMin = Math.max(0,Math.min(...rows.events.map(ev=>ev.topMin)) - 60);
  }else targetMin = 8 * 60;
  const hourPx = weekViewHourPx();
  const max = Math.max(0,24 * hourPx - y.clientHeight + 40);
  y.scrollTop = Math.min(targetMin * hourPx / 60,max);
  weekViewSyncRail();
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
  tag.style.top = _weekViewMode === 'list' && _weekViewSharedAxis
    ? `${_weekViewSharedAxis.timeToY(nowMin)}px` : top;
  tag.textContent = weekViewRailClock(nowMin);
}

function weekViewTick(){
  if(!weekSheetOpen())return;
  const todayKey = dateKey(Date.now());
  const data = typeof load === 'function' ? load() : [];
  if(todayKey !== _weekViewTodayKey || homePlannerDirtyKey(data) !== _weekViewDirtyKey){
    weekViewRequestRefresh();
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

function weekViewMarkDone(ev){
  if(!ev || !weekViewCanMarkDone(ev))return;
  const data = typeof load === 'function' ? load() : [];
  const i = data.findIndex(h=>h && h.hid === ev.hid);
  if(i < 0)return;
  const opts = {};
  if(ev.occurrenceKey)opts.occurrenceKey = ev.occurrenceKey;
  if(ev.scheduleOptionId)opts.scheduleOptionId = ev.scheduleOptionId;
  if(ev.dayKey)opts.scheduledDay = ev.dayKey;
  if(ev.chunkMinutes)opts.minutes = ev.chunkMinutes;
  if(ev.start && ev.start <= Date.now())opts.at = ev.start;
  const after = ()=>{
    if(typeof refreshOpenViews === 'function')refreshOpenViews();
    else renderWeekView();
  };
  if(typeof requestLogTing === 'function')requestLogTing(i,after,opts);
  else if(typeof logTing === 'function' && logTing(i,opts))after();
}

function weekViewSetMode(mode){
  if(_weekViewMode === mode)return;
  _weekViewMode = mode;
  _weekViewScrollReset = false;
  weekViewSavePreferences();
  renderWeekView();
}

function weekViewChangeZoom(direction){
  const index = WEEK_VIEW_ZOOM_STEPS.indexOf(_weekViewZoom);
  const next = WEEK_VIEW_ZOOM_STEPS[Math.max(0,Math.min(WEEK_VIEW_ZOOM_STEPS.length-1,index + direction))];
  if(next === _weekViewZoom)return;
  const scroller = $('week-view-body').querySelector('.wv-scroller');
  const minute = scroller ? weekViewViewportMinute(scroller) : 480;
  _weekViewZoom = next;
  weekViewSavePreferences();
  renderWeekView();
  const restored = $('week-view-body').querySelector('.wv-scroller');
  if(restored)weekViewRestoreMinute(restored,minute);
}

function weekViewActivate(event){
  const target = event && event.target;
  if(!target || !target.closest)return;
  if(target.closest('#week-view-label')){weekViewToggleMonth();return;}
  if(target.closest('#week-view-month-prev')){_weekViewMonthOffset -= 1;weekViewRenderMonth();return;}
  if(target.closest('#week-view-month-next')){_weekViewMonthOffset += 1;weekViewRenderMonth();return;}
  if(target.closest('#week-view-month-today')){weekViewGoToday();return;}
  const monthDay = target.closest('[data-wv-month-day]');
  if(monthDay){weekViewGoToDay(monthDay.dataset.wvMonthDay);return;}
  if(target.closest('select,.wv-zoom,#week-view-create,#week-view-display-options,#week-view-overview,.wv-nav,#week-view-close'))return;
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
  const doneEl = target.closest('[data-wv-done]');
  if(doneEl){
    weekViewMarkDone(_weekViewCtx.get(doneEl.dataset.wvDone));
    return;
  }
  const evEl = target.closest('[data-wv-event]') || (target.closest('.wv-event') && target.closest('.wv-event').querySelector('[data-wv-event]'));
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

function weekViewNudge(dir){
  const scroller = document.querySelector('#week-view-body .wv-scroller');
  if(!scroller)return;
  weekViewCancelAlign();
  const step = weekViewColumnStep(scroller);
  const max = Math.max(0,scroller.scrollWidth - scroller.clientWidth);
  const index = Math.round(scroller.scrollLeft / step) + dir;
  scroller.scrollLeft = Math.max(0,Math.min(max,index * step));
}

function weekViewToggleMonth(){
  if(_weekViewOptionsOpen)weekViewSetOptionsOpen(false,false);
  _weekViewMonthOpen = !_weekViewMonthOpen;
  if(_weekViewMonthOpen){
    const key = weekViewDaySel || dateKey(Date.now());
    const picked = new Date(`${key}T12:00:00`);
    const now = new Date();
    _weekViewMonthOffset = (picked.getFullYear() - now.getFullYear()) * 12 + (picked.getMonth() - now.getMonth());
  }
  weekViewRenderMonth();
  if(_weekViewMonthOpen)$('week-view-month-grid')?.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
}

function weekViewRenderMonth(focusKey){
  const panel = $('week-view-month');
  if(!panel)return;
  panel.hidden = !_weekViewMonthOpen;
  $('week-view-label')?.setAttribute('aria-expanded',String(_weekViewMonthOpen));
  if(!_weekViewMonthOpen)return;
  focusKey = focusKey || (panel.contains(document.activeElement) && document.activeElement.dataset.wvMonthDay) || '';
  if(typeof monthFrame !== 'function')return;
  const frame = monthFrame(_weekViewMonthOffset);
  const label = $('week-view-month-label');
  if(label)label.textContent = frame.label;
  const data = (typeof load === 'function' ? load() : []).filter(h=>{
    if(!h)return false;
    if(typeof isCalendarIgnored === 'function' && isCalendarIgnored(h))return false;
    if(typeof matchesOverviewFilters === 'function' && !matchesOverviewFilters(h))return false;
    return true;
  });
  const tally = typeof buildDayTally === 'function'
    ? buildDayTally(data,ts=>{
      const d = new Date(ts);
      return d.getFullYear() === frame.year && d.getMonth() === frame.month;
    })
    : {map:new Map()};
  const heads = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<div class="wv-cal-head" aria-hidden="true">${day}</div>`).join('');
  const blanks = Array.from({length:frame.first.getDay()},()=>'<div class="wv-cal-blank"></div>').join('');
  const todayKey = dateKey(Date.now());
  const selectedDate = focusKey || weekViewDaySel;
  const tabKey = selectedDate?.startsWith(`${frame.year}-${String(frame.month + 1).padStart(2,'0')}-`)
    ? selectedDate : dateKey(frame.first.getTime());
  const cells = Array.from({length:frame.last.getDate()},(_,i)=>{
    const date = new Date(frame.year,frame.month,i + 1);
    const key = dateKey(date.getTime());
    const count = (tally.map.get(key) || []).length;
    const density = count >= 3 ? ' is-dense' : count ? ' has-entry' : '';
    const flags = `${key === todayKey ? ' is-today' : ''}${key === weekViewDaySel ? ' is-selected' : ''}`;
    const spoken = date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    return `<button type="button" class="wv-cal-day${density}${flags}" data-wv-month-day="${key}" tabindex="${key === tabKey ? 0 : -1}"${key === todayKey ? ' aria-current="date"' : ''} aria-pressed="${key === weekViewDaySel}" aria-label="${escapeHtml(count ? `${spoken}, ${count} items` : spoken)}"><b>${i + 1}</b>${count ? '<i></i>' : ''}</button>`;
  }).join('');
  const grid = $('week-view-month-grid');
  if(grid)grid.innerHTML = heads + blanks + cells;
  if(focusKey)grid?.querySelector(`[data-wv-month-day="${focusKey}"]`)?.focus({preventScroll:true});
  const note = $('week-view-month-note');
  if(note)note.textContent = 'The next two weeks are planned. Other days show busy time and fixed appointments.';
}

function weekViewGoToDay(key){
  if(!appointmentDateKey(key))return;
  const offset = weekViewDayOffset(key);
  const end = _weekViewAnchor + _weekViewSpan;
  const count = weekViewDesktopLayout() === 'desktop' ? _weekViewWideDays : _weekViewPhoneDays;
  if(offset < _weekViewAnchor || offset + count > end){
    // Keep the chosen day at the left edge, including the final planned day.
    // Browsing years into the past must not create thousands of columns.
    _weekViewAnchor = offset;
    _weekViewSpan = WEEK_VIEW_HORIZON;
  }
  weekViewDaySel = key;
  weekViewOffset = offset;
  _weekViewScrollToKey = key;
  _weekViewScrollReset = true;
  _weekViewMonthOpen = false;
  renderWeekView();
  $('week-view-label')?.focus({preventScroll:true});
}

function weekViewHasCoveringSheet(){
  return ['detail-sheet','block-edit-sheet','travel-edit-sheet','add-sheet','settings-sheet','calendar-filter-sheet','day-logs-sheet'].some(id=>{
    const el = $(id);
    return el && el.classList.contains('open');
  });
}

function weekViewRetry(){
  _weekViewError = '';
  weekViewGen += 1;
  _weekHorizonSeq += 1;
  _weekViewCache.clear();
  renderWeekView();
}

function weekViewSetOffset(offset){
  if(offset === 0){
    _weekViewAnchor = 0;
    _weekViewSpan = WEEK_VIEW_HORIZON;
  }
  weekViewGoToDay(dateKey(offsetCalendarDay(Date.now(),offset)));
}

function weekViewGoToday(){
  _weekViewAnchor = 0;
  _weekViewSpan = WEEK_VIEW_HORIZON;
  _weekViewMonthOpen = false;
  weekViewGoToDay(dateKey(Date.now()));
}

function weekViewSuspend(){
  clearTimeout(_weekViewRefreshTimer);
  _weekViewRefreshTimer = null;
  _weekViewTouchActive = false;
  if(_weekViewTimer){
    clearInterval(_weekViewTimer);
    _weekViewTimer = null;
  }
  weekViewGen += 1;
  terminateWeekPreviewWorker();
  _weekViewPending.clear();
}

function weekViewCleanup(){
  weekViewSetOptionsOpen(false,false);
  weekViewCancelScroll();
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
  _weekViewAnchor = 0;
  _weekViewSpan = WEEK_VIEW_HORIZON;
  _weekViewMonthOpen = false;
  _weekViewMonthOffset = 0;
  _weekViewScrollLeft = 0;
  _weekViewScrollTop = 0;
  _weekViewScrollToKey = '';
  _weekViewStrip = [];
  _weekViewRowsByDay = new Map();
  _weekViewScrollAt = 0;
  _weekHorizonSeq += 1;
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
  bindTap(sheetInner,weekViewActivate,{ignoreSelector:'#week-view-options,#week-view-options-backdrop,#week-view-create,#week-view-display-options,#week-view-overview,.wv-nav,#week-view-close,.wv-gutter,.wv-hour'});
  sheetInner.addEventListener('click',event=>{
    if(!_weekViewMonthOpen || event.target.closest('#week-view-month,#week-view-label'))return;
    _weekViewMonthOpen = false;
    weekViewRenderMonth();
  });
  body.addEventListener('scroll',event=>{
    const cls = event.target.classList;
    if(!cls || (!cls.contains('wv-scroller') && !cls.contains('wv-yscroll')))return;
    _weekViewScrollAt = Date.now();
    // The strip and the clock scroll on separate axes now: only the strip
    // settles onto a day; the clock just keeps the hour rail in step.
    if(cls.contains('wv-scroller')){
      _weekViewScrollAxis = 'x';
      weekViewQueueSettle(event.target);
    }else{
      _weekViewScrollAxis = 'y';
      weekViewSyncRail();
    }
  },{passive:true,capture:true});
  body.addEventListener('scrollend',event=>{
    const cls = event.target.classList;
    if(!cls || !cls.contains('wv-scroller'))return;
    weekViewOnScrollSettled(event.target);
  },{capture:true});
  body.addEventListener('pointerdown',event=>{
    if(event.target.closest && event.target.closest('.wv-scroller'))weekViewCancelScroll();
  },{capture:true});
  body.addEventListener('touchstart',()=>{_weekViewTouchActive = true;},{capture:true,passive:true});
  const endTouch = event=>{
    _weekViewTouchActive = event.touches.length > 0;
    // Only a horizontal gesture asks the strip to settle on a day — a
    // vertical fling must never pull it. A settle deferred because a finger
    // paused mid-gesture still runs here, and while a fling keeps scrolling
    // every frame re-arms the debounce, so release never snaps it early.
    if(!_weekViewTouchActive && (_weekViewSettlePending
      || (_weekViewScrollAxis === 'x' && Date.now() - _weekViewScrollAt < 400))){
      weekViewOnScrollSettled(document.querySelector('#week-view-body .wv-scroller'));
    }
  };
  window.addEventListener('touchend',endTouch,{capture:true,passive:true});
  window.addEventListener('touchcancel',endTouch,{capture:true,passive:true});

  sheet.addEventListener('click',e=>{
    if(e.target === e.currentTarget && !sheetBackdropArmed('week-sheet'))closeSheet('week-sheet');
  });
  $('week-view-close')?.addEventListener('click',()=>closeSheet('week-sheet'));
  const openMonth = ()=>openCalendarOverview({range:'month',dayKey:weekViewDaySel});
  $('week-view-overview')?.addEventListener('click',openMonth);
  $('week-view-today')?.addEventListener('click',()=>weekViewGoToday());
  $('week-view-display-options').addEventListener('click',()=>weekViewSetOptionsOpen(true));
  $('week-view-options-close').addEventListener('click',()=>weekViewSetOptionsOpen(false));
  $('week-view-options-backdrop').addEventListener('click',()=>weekViewSetOptionsOpen(false));
  $('week-view-options').addEventListener('click',event=>{
    if(event.target.closest('[data-wv-calendar="month"]')){
      weekViewSetOptionsOpen(false,false);
      openMonth();
      return;
    }
    const mode = event.target.closest('[data-wv-mode]');
    const days = event.target.closest('[data-wv-days]');
    const color = event.target.closest('[data-wv-color]');
    const filter = event.target.closest('#week-view-filter-groups button');
    if(mode){weekViewSetMode(mode.dataset.wvMode);}
    else if(days){
      const count = Number(days.dataset.wvDays);
      if(_weekViewLayout === 'desktop')_weekViewWideDays = count;
      else _weekViewPhoneDays = count;
      _weekViewScrollToKey = weekViewDaySel;
      _weekViewScrollReset = false;
      weekViewSavePreferences();
      renderWeekView();
    }else if(color){
      _weekViewColor = color.dataset.wvColor;
      weekViewSavePreferences();
      renderWeekView();
    }else if(filter){
      for(const kind of ['topic','location','type','when','priority']){
        const value = filter.getAttribute(`data-wvfilter-${kind}`);
        if(value !== null)setSharedFilter(kind,value);
      }
      dayLogsKey = null;
      renderWeekView();
      syncSharedFilterSurfaces('both');
    }else return;
    weekViewSetOptionsOpen(false);
  });
  $('week-view-zoom-out').addEventListener('click',()=>weekViewChangeZoom(-1));
  $('week-view-zoom-in').addEventListener('click',()=>weekViewChangeZoom(1));
  $('week-view-create').addEventListener('click',()=>{
    _weekViewReturnFocus = $('week-view-create');
    weekViewOpenAdd(weekViewDaySel);
  });
  $('week-view-filters-reset').addEventListener('click',()=>{
    clearSharedFilters();
    dayLogsKey = null;
    renderWeekView();
    syncSharedFilterSurfaces('both');
    weekViewSetOptionsOpen(false);
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
    if(_weekViewOptionsOpen && !weekViewHasCoveringSheet()){
      if(e.key === 'Escape'){
        e.preventDefault();
        e.stopImmediatePropagation();
        weekViewSetOptionsOpen(false);
      }else if(e.key === 'Tab'){
        const buttons = [...$('week-view-options').querySelectorAll('button')].filter(el=>!el.disabled && el.getClientRects().length);
        const first = buttons[0], last = buttons[buttons.length-1];
        if(e.shiftKey && e.target === first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey && e.target === last){e.preventDefault();first?.focus();}
      }
      return;
    }
    if(e.key === 'Tab' && !weekViewHasCoveringSheet()){
      const buttons = [...sheet.querySelectorAll('button,select,[tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length-1];
      if(e.shiftKey && (e.target === first || !sheet.contains(e.target))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey && (e.target === last || !sheet.contains(e.target))){e.preventDefault();first?.focus();}
      return;
    }
    if(e.key === 'Escape' && _weekViewMonthOpen && !weekViewHasCoveringSheet()){
      e.preventDefault();
      e.stopImmediatePropagation();
      _weekViewMonthOpen = false;
      weekViewRenderMonth();
      $('week-view-label')?.focus({preventScroll:true});
      return;
    }
    if(_weekViewMonthOpen && !weekViewHasCoveringSheet()){
      const cell = e.target.closest?.('[data-wv-month-day]');
      const steps = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      if(cell && (e.key in steps || ['Home','End','PageUp','PageDown'].includes(e.key))){
        e.preventDefault();
        const date = new Date(`${cell.dataset.wvMonthDay}T12:00:00`);
        if(e.key in steps)date.setDate(date.getDate() + steps[e.key]);
        else if(e.key === 'Home')date.setDate(date.getDate() - date.getDay());
        else if(e.key === 'End')date.setDate(date.getDate() + 6 - date.getDay());
        else {
          const day = date.getDate();
          date.setDate(1);
          date.setMonth(date.getMonth() + (e.key === 'PageDown' ? 1 : -1));
          date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));
        }
        const now = new Date();
        _weekViewMonthOffset = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
        weekViewRenderMonth(dateKey(date.getTime()));
      }
      return;
    }
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')return;
    if(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey)return;
    const target = e.target;
    const tag = target && target.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable))return;
    if(weekViewHasCoveringSheet())return;
    e.preventDefault();
    weekViewNudge(e.key === 'ArrowRight' ? 1 : -1);
  },true);

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
      if(next !== _weekViewLayout){
        _weekViewScrollToKey = weekViewDaySel;
        _weekViewScrollReset = false;
        renderWeekView();
        return;
      }
      const scroller = body.querySelector('.wv-scroller');
      if(!scroller)return;
      const y = weekViewYScroller(scroller);
      const top = y ? y.scrollTop : 0;
      weekViewSizeBoard(scroller);
      weekViewScrollToDay(scroller,weekViewDaySel);
      if(y)y.scrollTop = top;
      weekViewSyncRail();
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
