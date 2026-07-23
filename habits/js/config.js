// App-wide constants and UI state. Loaded before every other script.

const KEY = 'tings_v2';
const SORT_SETTINGS_KEY = 'tings_app_settings_v2';
const MAX_LOGS = 500;
const MAX_TINGS = 300;
const QUOTA_WARN_KB = 4096;
const QUOTA_HARD_KB = 4800;
const PUSH_WORKER_URL = 'https://habits-push.YOUR-ACCOUNT.workers.dev';
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';

// ── Locations / travel-time ──
const MAPS_API_KEY = 'YOUR_MAPS_API_KEY_HERE';   // optional Google provider; 'YOUR_' prefix => disabled (see mapsConfigured())
const OSRM_BASE = 'https://router.project-osrm.org';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE = 'https://photon.komoot.io';
const MAX_LOCATIONS = 32;
const MAX_TRAVEL_EDGES = 1024;                     // 32² upper bound
const TRAVEL_TTL_MS = 30 * 86400000;               // cached edges revalidate after 30 days
const TRAVEL_FETCH_TIMEOUT_MS = 3000;              // hard cap on travel routing calls
const GEOCODE_FETCH_TIMEOUT_MS = 8000;             // address search / reverse can be slower
const DEFAULT_LOCATION_RADIUS_M = 75;              // geofence radius for "you are here" matching
const TRAVEL_MODES = ['driving','walking','bicycling','transit'];
const DEFAULT_TRAVEL_MODE = 'driving';

// ── Prayer times (dynamic habit windows) ──
// Prayer-time anchors a habit's allowed/preferred time endpoint can be tied to.
// 'maghrib' is the same moment as sunset; both keys are accepted as aliases.
const PRAYER_ANCHORS = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
const PRAYER_ANCHOR_LABELS = {
  fajr:'Fajr', sunrise:'Sunrise', dhuhr:'Dhuhr',
  asr:'Asr', maghrib:'Maghrib (sunset)', isha:'Isha'
};
// Calculation methods exposed in Settings. Keys mirror adhan.CalculationMethod
// factory names; labels are the friendly strings users recognise. The default
// matches the user's request: North American (ISNA).
const PRAYER_METHODS = [
  {key:'NorthAmerica',  label:'North America (ISNA)'},
  {key:'MuslimWorldLeague', label:'Muslim World League'},
  {key:'Egyptian',      label:'Egyptian General Authority'},
  {key:'Karachi',       label:'University of Karachi'},
  {key:'UmmAlQura',     label:'Umm al-Qura (Makkah)'},
  {key:'Dubai',         label:'Dubai'},
  {key:'MoonsightingCommittee', label:'Moonsighting Committee Worldwide'},
  {key:'Kuwait',        label:'Kuwait'},
  {key:'Qatar',         label:'Qatar'},
  {key:'Singapore',     label:'Singapore'},
  {key:'Tehran',        label:'Tehran'},
  {key:'Turkey',        label:'Turkey (Diyanet)'},
  {key:'Other',         label:'Other'}
];
const DEFAULT_PRAYER_METHOD = 'NorthAmerica';
// Madhab affects only Asr time. Shafi = standard; Hanafi = later Asr.
const PRAYER_MADHABS = [
  {key:'shafi',  label:'Shafi (standard)'},
  {key:'hanafi', label:'Hanafi (later Asr)'}
];
const DEFAULT_PRAYER_MADHAB = 'shafi';
// Cap on the offset (signed minutes) a user can attach to an anchor. ±12 h is
// well past any sane "sunrise + a few hours" / "isha - 30 min" use case but
// keeps typos from producing nonsense like 99999.
const PRAYER_OFFSET_MAX_MIN = 720;

const MAX_RHYTHM_DAYS = 183;
const MIN_RHYTHM_DAYS = 0.5;
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_MIN_CHUNK_MINUTES = 30;
const DEFAULT_FLEXIBILITY_DAYS = 0;
const TIME_PICKER_STEP_MINUTES = 15;
const MAX_NOTE_CHARS = 200;
/** Soft location preference among allowed places. */
const LOCATION_PREF_LEVELS = ['avoid','little','high'];
const LOCATION_PREF_SCORE = {avoid:-40, little:12, high:36};
const DEFAULT_PRIORITY = 2; // P0 (critical) .. P5 (someday); new items default to P2
const PRIORITY_LABELS = ['P0','P1','P2','P3','P4','P5'];
const DEFAULT_AVAILABILITY_MINUTES = [240,90,90,90,90,90,240];
const DEFAULT_BLOCKED_TIMES = [
  {label:'sleep',days:[0,1,2,3,4,5,6],start:0,end:420},
  {label:'breakfast',days:[0,1,2,3,4,5,6],start:480,end:510},
  {label:'work',days:[1,2,3,4,5],start:540,end:1020},
  {label:'lunch',days:[0,1,2,3,4,5,6],start:720,end:780},
  {label:'dinner',days:[0,1,2,3,4,5,6],start:1080,end:1140}
];
const WEEKDAY_LABELS = ['sun','mon','tue','wed','thu','fri','sat'];
const SWIPE_THRESHOLD = 60;
const SWIPE_ACTION_WIDTH = 68;
const TAP_DELAY = 310;
const SNAP_TRANSITION = 'transform 190ms cubic-bezier(.3,.7,.2,1)';
const WIDTH_TRANSITION = 'width 190ms cubic-bezier(.3,.7,.2,1)';
const SORT_PRESETS = {
  balanced:{
    focus:'balanced',plansFirst:true,planWindowDays:3,
    planWeight:100,dueWeight:100,progressWeight:70,trendWeight:55,rhythmWeight:55,
    buildWeight:100,limitWeight:70,stopWeight:130,newWeight:90,
    newBuildMode:'gentle',dueMode:'relative',buildLookAheadDays:3,buildRiseAt:75,limitMode:'overdue',stopMode:'watch',rhythmBias:0,locationWeight:70
  },
  build:{
    focus:'build',plansFirst:true,planWindowDays:3,
    planWeight:95,dueWeight:135,progressWeight:105,trendWeight:75,rhythmWeight:60,
    buildWeight:140,limitWeight:50,stopWeight:12,newWeight:125,
    newBuildMode:'rise',dueMode:'relative',buildLookAheadDays:7,buildRiseAt:65,limitMode:'quiet',stopMode:'quiet',rhythmBias:12,locationWeight:60
  },
  planned:{
    focus:'balanced',plansFirst:true,planWindowDays:7,
    planWeight:175,dueWeight:85,progressWeight:55,trendWeight:40,rhythmWeight:40,
    buildWeight:95,limitWeight:65,stopWeight:35,newWeight:70,
    newBuildMode:'gentle',dueMode:'date',buildLookAheadDays:3,buildRiseAt:80,limitMode:'overdue',stopMode:'recent',rhythmBias:0,locationWeight:75
  },
  todayFirst:{
    focus:'balanced',plansFirst:true,planWindowDays:3,
    planWeight:120,dueWeight:140,progressWeight:60,trendWeight:50,rhythmWeight:50,
    buildWeight:110,limitWeight:80,stopWeight:110,newWeight:100,
    newBuildMode:'gentle',dueMode:'relative',buildLookAheadDays:3,buildRiseAt:70,limitMode:'overdue',stopMode:'watch',rhythmBias:0,locationWeight:80
  }
};
const DEFAULT_SORT_SETTINGS = {
  ...SORT_PRESETS.todayFirst,
  preset:'todayFirst',
  showSnoozed:false,
  showSampleOnCards:true,
  showPinnedOnCards:true,
  showTaskDateOnCards:true,
  showPlansOnCards:true,
  showDayScheduleOnCards:true,
  showTimeWindowOnCards:false,
  showSnoozedUntilOnCards:true,
  showDurationOnCards:false,
  showRepetitionOnCards:true,
  showFlexibilityOnCards:false,
  showTopicsOnCards:false,
  showLocationOnCards:false,

  showScheduledTasksInAgenda:true,
  showDueTasksInAgenda:true,
  showPlannedItemsInAgenda:true,
  showDueHabitsInAgenda:true,
  showWeekOnHome:true,
  // Exact ILP packer for tight windows (lazy-loads GLPK). This is the default
  // planner; the scarcity-first heuristic remains the explicit fast fallback.
  agendaOptimizer:true,
  // Unified agenda placement score (lower = better). All soft signals share
  // one comparable scale — no special-case overrides for due/near/tonight.
  //   travel       — per second of commute for this placement
  //   cluster      — per unit of on-site / co-locate savings
  //   day          — multiplier on day-offset (ASAP / on-time) penalty
  //   asap         — per minute later than the earliest fit that day
  //   scarce       — per ms overlapping a scarce allowed window
  //   preference   — multiplier on soft preferred time/place/weekday penalty
  agendaScoreWeights:{
    travel:1,
    cluster:1,
    day:1,
    // Within-day clock delay — weak vs preference/scarce; day-offset carries ASAP.
    asap:0.12,
    scarce:0.05,
    preference:1.5
  },
  // How blocked times + travel between places appear on home:
  //   'cards'     → card surfaces for the whole day (default)
  //   'cards12h'  → same cards, but only for the next 12 hours
  //   'text12h'   → plain muted background lines for the next 12 hours
  homeExtraMode:'cards12h',
  reachAssist:true,
  reminders:false,
  pushDetailed:false,
  defaultType:'keepup',
  defaultTarget:7,
  topics:[],
  locations:[],
  travel:{},
  defaultTravelMode:DEFAULT_TRAVEL_MODE,
  prayerMethod:DEFAULT_PRAYER_METHOD,           // adhan.CalculationMethod key
  prayerMadhab:DEFAULT_PRAYER_MADHAB,           // 'shafi' | 'hanafi'
  lastKnownLocationId:null,
  locationOptIn:false,           // user granted geolocation (coords never persisted)
  pinnedLocationId:null,         // a manually-pinned "I am at" id; takes precedence over auto detection
  availabilityMinutes:DEFAULT_AVAILABILITY_MINUTES,
  availabilityOverrides:{},
  blockedTimes:DEFAULT_BLOCKED_TIMES,
  /** Per-day cancelled block instances: {'YYYY-MM-DD':['label|start|end', ...]} */
  cancelledBlocks:{},
  /** Per-day clock edits for one block instance: {'YYYY-MM-DD':{'label|start|end':{start,end}}} */
  blockedTimeOverrides:{},
  /** Breakable habit that receives imported calendar minutes as progress (null = off). */
  calendarCreditHabitId:null,
  /** All-day calendar rows: 'skip' (default) or 'tasks' (dated untimed). */
  calendarAllDayMode:'skip'
};
const LIMIT_MODE_POLICY = {
  quiet:{readyAt:1.8,threshold:2.1,ceiling:54,base:8,earlyBase:0,earlyRise:1,progress:0.08,progressEarly:0.01,trend:0.08,trendEarly:0},
  overdue:{readyAt:1,threshold:1.25,ceiling:66,base:14,earlyBase:0,earlyRise:2,progress:0.16,progressEarly:0.02,trend:0.22,trendEarly:0.02},
  near:{readyAt:0.8,threshold:1,ceiling:74,base:18,earlyBase:4,earlyRise:12,progress:0.38,progressEarly:0.12,trend:0.42,trendEarly:0.14},
  active:{readyAt:0.45,threshold:0.7,ceiling:86,base:26,earlyBase:12,earlyRise:22,progress:0.62,progressEarly:0.3,trend:0.68,trendEarly:0.34}
};
const STOP_MODE_POLICY = {
  quiet:{steps:[[1,12],[3,8],[7,4]],fallback:0,progress:0.08,mix:{due:0.38,progress:0.12,trend:0.12},cap:12,offset:-16,focus:1},
  watch:{steps:[[1,34],[2,24],[4,14],[7,6]],fallback:1,progress:0.18,mix:{due:0.62,progress:0.22,trend:0.22},focus:1},
  recent:{steps:[[1,58],[2,44],[4,28],[7,14]],fallback:3,progress:0.34,mix:{due:0.78,progress:0.28,trend:0.3},focus:1},
  active:{steps:[[1,92],[2,78],[4,58],[7,34]],fallback:8,progress:0.62,mix:{due:1.5,progress:0.85,trend:0.65},focus:1}
};
const BASE_SORT_MIX = {now:0.82,plan:1.45,due:1.35,progress:0.72,trend:0.7,rhythm:1,newness:1,location:0.85};
const FOCUS_TYPE_SCALE = {
  balanced:{keepup:1,reduce:1,zero:1,task:1},
  build:{keepup:1.22,reduce:0.78,zero:1,task:0.92},
  space:{keepup:0.88,reduce:1.22,zero:1.12,task:0.92}
};

const $ = id => document.getElementById(id);

// TRUE when a Google Maps API key has been configured. Mirrors pushConfigured()
// in push-client.js: the 'YOUR_' prefix is the disabled sentinel.
function mapsConfigured(){
  return Boolean(MAPS_API_KEY) && !MAPS_API_KEY.includes('YOUR_');
}

// "Is the layout wide enough to mount sheets in side panes?"  True whenever
// the viewport can fit 2+ panes (>= 960px). Driven by body[data-pane-count]
// which viewport.js keeps in sync with the window size.
function paneTierActive() {
  const count = document.body && document.body.dataset ? document.body.dataset.paneCount : '';
  return count === '2' || count === '3';
}

function isThreePaneTier() {
  return document.body && document.body.dataset && document.body.dataset.paneCount === '3';
}

function isTwoPaneTier() {
  return document.body && document.body.dataset && document.body.dataset.paneCount === '2';
}

let detailIdx = null;
let snoozeIdx = null;
let snoozeFromDetail = false;
let activityIdx = null;
let detailMonthOffset = 0;
let overviewMonthOffset = 0;
let overviewRecentOffset = 0;
let overviewTopicFilter = 'all';
let overviewLocationFilter = 'all';
let overviewRangeFilter = 'recent';
let homeTopicFilter = 'all';
let homeLocationFilter = 'all';
let dayLogsKey = null;
let selectedType = 'keepup';
let sortSettings = null;
let searchQuery = '';

let swipeOpenCard = null;
let tapTimer = null;
let lastTap = {idx:-1,time:0};
let toastTimer = null;
let actionToastTimer = null;
let navSuppressTimer = null;
let pendingAction = null;
let reachTimer = null;
let reachHoldTimer = null;
let lastScrollY = 0;
let headerHidden = false;
let headerRevealPull = 0;
let topTouchY = 0;
let topTouchX = 0;
let topTouchStartedAtTop = false;
let reachArmed = false;
let buttonPointer = null;
let suppressNativeButton = null;
let settingsPointer = null;
let detailTuneOriginal = null;
let detailScheduleView = 'allowed';
let calendarPointer = null;
let cardPointer = null;
let suppressCardClick = null;
let searchDismissPointer = null;
