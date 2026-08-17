const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';

function atTime(hour, minute = 0){
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function baseHabit(props){
  return Object.assign({
    name:'item', type:'keepup', target:7, flexibilityDays:0, durationMinutes:30,
    allowedTimeStart:null, allowedTimeEnd:null, preferredTimeStart:null, preferredTimeEnd:null,
    allowedTimeStartAnchor:null, allowedTimeEndAnchor:null,
    lastLog:null, logs:[], emoji:'', pinned:false, sample:false, snoozedUntil:null,
    topics:[], allowedWeekdays:[], allowedMonthDays:[], preferredWeekdays:[], preferredMonthDays:[],
    dueDate:null, eventTime:null, hardDue:false, createdAt:Date.now(),
    breakable:false, minChunkMinutes:30, planByDate:null, anywhereAllowed:true,
    locationIds:[]
  }, props);
}

function plannerSettings(blockedTimes, extra){
  return Object.assign({
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440], availabilityOverrides:{},
    showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
    locations:[], travel:{}, defaultTravelMode:'walking', blockedTimes
  }, extra || {});
}

function openEveningSettings(extra){
  return plannerSettings([
    {label:'sleep',days:[],start:0,end:540},
    {label:'night',days:[],start:1320,end:1440},
    {label:'lunch',days:[],start:780,end:810}
  ], extra);
}

function windowedSettings(extra){
  return plannerSettings([
    {label:'sleep',days:[],start:0,end:540},
    {label:'evening',days:[],start:1125,end:1440},
    {label:'lunch',days:[],start:720,end:750}
  ], extra);
}

async function glpkAvailable(page){
  if(FAST_ONLY)return false;
  return page.evaluate(async () => {
    if(typeof ensureGlpk !== 'function')return false;
    try{
      const glpk = await ensureGlpk();
      return Boolean(glpk && typeof glpk.solve === 'function');
    }catch(_){
      return false;
    }
  });
}

async function runPlannerPair(page, data, settings, now, numDays = 7){
  return page.evaluate(async ({data, settings, now, numDays, fastOnly}) => {
    const RealDate = Date;
    function FrozenDate(...args){
      return args.length === 0 ? new RealDate(now) : new RealDate(...args);
    }
    FrozenDate.now = () => now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;

    const summarize = week => (week.days || []).map(day => {
      const byName = {};
      for(const fill of (day.timeline || []).filter(row => row.kind === 'fill')){
        const minutes = Math.round((fill.end - fill.start) / 60000);
        byName[fill.h.name] = (byName[fill.h.name] || 0) + minutes;
      }
      return byName;
    });

    try{
      let glpk = null;
      let fast = null;
      if(!fastOnly){
        try{
          const week = await buildWeekAgendaAsync(
            data, Object.assign({}, settings, {agendaOptimizer:true}), numDays
          );
          glpk = {optimized:Boolean(week.optimized), days:summarize(week)};
        }catch(error){
          glpk = {error:String(error && error.message || error)};
        }
      }
      try{
        const week = buildWeekAgenda(
          data, Object.assign({}, settings, {agendaOptimizer:false}), numDays
        );
        fast = {days:summarize(week)};
      }catch(error){
        fast = {error:String(error && error.message || error)};
      }
      return {glpk, fast};
    }finally{
      globalThis.Date = RealDate;
    }
  }, {data, settings, now, numDays, fastOnly:FAST_ONLY});
}

function minutesOnDay(result, offset, name){
  const day = (result && result.days && result.days[offset]) || {};
  return day[name] || 0;
}

function placedAnywhere(result, name){
  return ((result && result.days) || []).reduce((sum, day) => sum + (day[name] || 0), 0);
}

module.exports = {
  chromium,
  BASE,
  FAST_ONLY,
  atTime,
  baseHabit,
  openEveningSettings,
  windowedSettings,
  glpkAvailable,
  runPlannerPair,
  minutesOnDay,
  placedAnywhere
};
