// App-wide constants and UI state. Loaded before every other script.

const KEY = 'tings_v2';
const SORT_SETTINGS_KEY = 'tings_app_settings_v2';
const MAX_LOGS = 500;
const MAX_TINGS = 300;
const QUOTA_WARN_KB = 4096;
const QUOTA_HARD_KB = 4800;
const MAX_RHYTHM_DAYS = 183;
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_FLEXIBILITY_DAYS = 0;
const DEFAULT_AVAILABILITY_MINUTES = [240,90,90,90,90,90,240];
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
    newBuildMode:'gentle',dueMode:'relative',buildLookAheadDays:3,buildRiseAt:75,limitMode:'overdue',stopMode:'watch',rhythmBias:0
  },
  build:{
    focus:'build',plansFirst:true,planWindowDays:3,
    planWeight:95,dueWeight:135,progressWeight:105,trendWeight:75,rhythmWeight:60,
    buildWeight:140,limitWeight:50,stopWeight:12,newWeight:125,
    newBuildMode:'rise',dueMode:'relative',buildLookAheadDays:7,buildRiseAt:65,limitMode:'quiet',stopMode:'quiet',rhythmBias:12
  },
  planned:{
    focus:'balanced',plansFirst:true,planWindowDays:7,
    planWeight:175,dueWeight:85,progressWeight:55,trendWeight:40,rhythmWeight:40,
    buildWeight:95,limitWeight:65,stopWeight:35,newWeight:70,
    newBuildMode:'gentle',dueMode:'date',buildLookAheadDays:3,buildRiseAt:80,limitMode:'overdue',stopMode:'recent',rhythmBias:0
  },
  todayFirst:{
    focus:'balanced',plansFirst:true,planWindowDays:3,
    planWeight:120,dueWeight:140,progressWeight:60,trendWeight:50,rhythmWeight:50,
    buildWeight:110,limitWeight:80,stopWeight:110,newWeight:100,
    newBuildMode:'gentle',dueMode:'relative',buildLookAheadDays:3,buildRiseAt:70,limitMode:'overdue',stopMode:'watch',rhythmBias:0
  }
};
const DEFAULT_SORT_SETTINGS = {
  ...SORT_PRESETS.todayFirst,
  preset:'todayFirst',
  showSnoozed:false,
  showDurationOnCards:false,
  showRepetitionOnCards:true,
  showFlexibilityOnCards:false,
  showTopicsOnCards:false,
  reachAssist:true,
  autoOpenToday:true,
  reminders:false,
  defaultType:'keepup',
  defaultTarget:7,
  topics:[],
  availabilityMinutes:DEFAULT_AVAILABILITY_MINUTES,
  availabilityOverrides:{}
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
const BASE_SORT_MIX = {now:0.82,plan:1.45,due:1.35,progress:0.72,trend:0.7,rhythm:1,newness:1};
const FOCUS_TYPE_SCALE = {
  balanced:{keepup:1,reduce:1,zero:1,task:1,event:1},
  build:{keepup:1.22,reduce:0.78,zero:1,task:0.92,event:1},
  space:{keepup:0.88,reduce:1.22,zero:1.12,task:0.92,event:1}
};

const $ = id => document.getElementById(id);

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
let overviewTopicFilter = 'all';
let overviewRangeFilter = 'recent';
let homeTopicFilter = 'all';
let dayLogsKey = null;
let selectedType = 'keepup';
let sortSettings = null;
let searchQuery = '';

let swipeOpenCard = null;
let tapTimer = null;
let lastTap = {idx:-1,time:0};
let toastTimer = null;
let undoTimer = null;
let navSuppressTimer = null;
let pendingUndo = null;
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
