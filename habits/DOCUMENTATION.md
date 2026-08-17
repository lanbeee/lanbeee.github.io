# Tings Documentation Comprehensive Tree

> **Purpose:** Complete documentation skeleton covering every field, symbol, and UI element. Markings: 👤 = User docs, 👨‍💻 = Developer docs, 👤👨‍💻 = Both.

---

## TABLE OF CONTENTS

> **Audience markers:** 👤 user · 👨‍💻 developer · 👤👨‍💻 both. Each section heading carries its own marker.

- [I. Introduction](#i-introduction) 👤👨‍💻
- [II. The Dashboard (Home Screen)](#ii-the-dashboard-home-screen) 👤
- [III. Habit Types & How They Work](#iii-habit-types--how-they-work) 👤
- [IV. Detailed Field Reference](#iv-detailed-field-reference) 👤👨‍💻
- [V. Visual Symbols & Indicators](#v-visual-symbols--indicators) 👤
- [VI. Home Page Day Headers & Pills](#vi-home-page-day-headers--pills) 👤
- [VII. Search & Filtering](#vii-search--filtering) 👤
- [VIII. The Add Habit Sheet](#viii-the-add-habit-sheet) 👤
- [IX. The Detail Sheet](#ix-the-detail-sheet) 👤👨‍💻
- [X. Contextual Sheets (Right-Swipe / Drag Actions)](#x-contextual-sheets-right-swipe--drag-actions) 👤
- [XI. Toasts & Action Toasts](#xi-toasts--action-toasts) 👤
- [XII. Settings Overview](#xii-settings-overview) 👤👨‍💻
- [XIII. Detailed Field Explanations](#xiii-detailed-field-explanations) 👤
- [XIV. Agenda & Planning Algorithms](#xiv-agenda--planning-algorithms) 👨‍💻
- [XV. Minimal Mode vs Regular Mode](#xv-minimal-mode-vs-regular-mode) 👤
- [XVI. Glossary](#xvi-glossary)
- [XVII. Complete Default Settings](#xvii-complete-default-settings) 👨‍💻
- [XVIII. Gestures & Interactions](#xviii-gestures--interactions) 👤👨‍💻
- [XIX. File Structure & Modules](#xix-file-structure--modules) 👨‍💻
- [XX. Minimal Mode Detailed Behavior](#xx-minimal-mode-detailed-behavior) 👤👨‍💻
- [XXI. Complete Settings Field Reference](#xxi-complete-settings-field-reference) 👤👨‍💻
- [XXII. Sort Presets Detailed](#xxii-sort-presets-detailed) 👤
- [XXIII. Focus Modes Detailed](#xxiii-focus-modes-detailed) 👤
- [XXIV. Calendar Import Providers](#xxiv-calendar-import-providers) 👤
- [XXV. Location Features Detailed](#xxv-location-features-detailed) 👤👨‍💻
- [XXVI. Error Handling & Limits](#xxvi-error-handling--limits) 👤👨‍💻
- [XXVII. External Services](#xxvii-external-services) 👨‍💻
- [XXVIII. How to Context](#xxviii-how-to-context) 👤👨‍💻

---

## Coverage Checklist ✅

Everything below is covered in this skeleton:

### ✅ All Habit Object Fields
- Core: hid, name, emoji, sample, type, target, createdAt, logs, lastLog, snoozedUntil
- Priority & Ranking: priority
- Time Window: allowedWeekdays, allowedMonthDays, preferredWeekdays, preferredMonthDays
- Time Start/End: allowedTimeStart, allowedTimeEnd, preferredTimeStart, preferredTimeEnd
- Prayer Anchors: 8 anchor fields + combine + offset + habit linking
- Flexibility: flexibilityDays
- Duration: durationMinutes, breakable, minChunkMinutes
- Timers: timerAutoStopMinutes (legacy), autoMarkMinutes
- Tracking: trackValue
- Schedule Links: scheduleLinks array
- Topics: topics array
- Locations: locationIds, anywhereAllowed, locationPrefs, preferredLocationId
- Links: links array (kind, value)
- Task-specific: dueDate, eventTime, hardDue, flexibilityDays
- Calendar import: externalId, source, importedAt

### ✅ All Settings Fields (40+ fields)
- Display/UI: preset, minimalMode, themeMode, fontScale, compactMode, etc.
- Card Display: All 17+ show...OnCards fields with defaults
- Sort Weights: All 10 weight fields + algorithm settings
- Agenda: optimizer, show...InAgenda settings, score weights
- Availability, Blocked Times, Topics, Locations
- Prayer Times, Calendar Import, Reminders/Push
- Retention, Default Values, Internal caching

### ✅ All Visual Symbols
- Card colors: red/amber/teal/purple/gray borders
- Status text: run, overdue, on track, etc.
- Progress circles, activity trail dots
- Priority badges P0-P5
- Topic chips, location pins
- Order markers, early indicators
- All card display toggle symbols (💡 📍 📌 🧪 📅 ⏱️ 🕐 🌅)

### ✅ All Gestures & Interactions
- Tap, double tap, long press, swipe
- All swipe actions (left: pin, keep, activity, timer; right: snooze, remove)
- Minimal mode swipe restrictions
- Keyboard shortcuts (search + single char typing)
- Agenda drag handles

### ✅ All UI Components
- App bar elements
- Week plan strip
- Home sections (Today, Overdue, Coming Up)
- Home day headers with pills (missed, open time)
- Add habit sheet (all fields)
- Detail sheet (6 tabs: identity, schedule, effort, insight, calendar, actions)
- Activity sheet (log history)
- Settings sections (16 sections)
- Calendar overview (heatmap, week strip, 3 panes)
- Today agenda (events, habits, tasks, planned items)
- Contextual sheets: slipped, free time, snooze, value log, order link, doing now, presence, location picker, travel edit, busy time, day logs, home/calendar filters
- Toasts & action toasts
- Day agenda audit (triple-tap debug)

### ✅ All Data Models
- Habit object structure (full JSDoc typedef style)
- LogEntry types (3 variants)
- Settings object (complete breakdown)
- Location object structure
- TravelEdge object structure
- BlockedTime, ScheduleLink structures

### ✅ System Limits & Constraints
- Storage limits: MAX_LOGS, MAX_TINGS, MAX_LOCATIONS, MAX_TRAVEL_EDGES
- Quota: QUOTA_WARN_KB, QUOTA_HARD_KB
- Input limits: name, emoji, notes, topics, etc.
- External service config: all API URLs, API key fields

### ✅ External Services
- Maps: OSRM, Google Maps, Nominatim, Photon
- Push notifications: worker URL, VAPID key
- Calendar: Microsoft Graph, Google Calendar
- Prayer times: adhan library methods

---

## I. INTRODUCTION

### 1.1 What is Tings? 👤👨‍💻
- Single-page web application (PWA) for habit tracking and task management
- Alternative to: Calendars, to-do lists, traditional habit trackers
- Platform: Works on desktop, mobile, installable as PWA

### 1.2 Philosophy & Core Concepts 👤
- **Rhythm-based planning:** Target + flexibilityDays instead of rigid deadlines
- **Adjustable rigidness:** From completely rigid (calendar-like events) to completely flexible — and everything in between.  
- **Capacity-based scheduling:** availabilityMinutes - durationMinutes
- **Progressive urgency:** No hard deadlines by default, with the ability to add.
- **Privacy-first:** All data stored locally, never transmitted

### 1.3 Who is Tings For? 👤
- People managing recurring routines
- Those who find rigid due dates anxiety-provoking
- Users who want realistic daily planning
- Privacy-conscious individuals (no cloud sync)

### 1.4 Core Data Types 👤👨‍💻
| Type | Purpose | Example | Target Required? |
|------|---------|---------|------------------|
| `keepup` | Build positive habits | Exercise, Meditate | Yes |
| `reduce` | Reduce negative habits | Smoke, Drink | Yes |
| `zero` | Stop doing completely | Delete social media | No |
| `task` | One-off items with due date | Call dentist, Pay bill | No |

### 1.5 Quick Start Guide 👤
```
1. Open the app
2. Tap "+" to add habit
3. Name it, choose emoji
4. Set type (habit) and rhythm (e.g. 1× in 7d)
5. Set priority (P2 default)
6. Done! Log it daily
```

---

## II. THE DASHBOARD (HOME SCREEN)

### 2.1 App Bar 👤
| Element | Location | Symbol | Action |
|---------|----------|--------|--------|
| Logo/Title | Left | Tings icon + text | Opens About/Info sheet |
| Search Bar | Center | 🔍 | Search habits |
| Calendar | Right | 🗓️ | Opens Calendar Overview |
| "+" Add | Right | ➕ | Opens Add Habit sheet |
| Search Toggle | Right | 🔎 | Shows/hides search |

### 2.2 Week Plan Strip 👤
- Appears at top when `showWeekOnHome: true`
- Shows 7-day schedule preview
- Color-coded by habit type
- Tap to navigate to calendar

### 2.3 TODAY SECTION 👤
#### 2.3.1 Section Header
- Label: "TODAY"
- Date display: "Monday, Aug 11"

#### 2.3.2 Agenda Items
Items appear in this order:
1. **Fixed Events** (sorted by time)
2. **Ready Habits** (by priority/urgency)
3. **Due Tasks** (today's tasks)
4. **Planned Items** (future logs for today)

#### 2.3.3 Habit Card in Today 👤
```
┌─────────────────────────────────────┐
│ 🔴 Habit Name                       │  Emoji + Color-coded border
│ Due: 3d ago                         │  Status: "run", "overdue", "on track"
│ 12:00 PM - 1:00 PM ⏱️  P2 🔵        │  Time window, Duration, Priority, Topic chips
│ 💪 cardio 💪                         │  Topics shown if showTopicsOnCards
│ ┌─────┐                             │  
│ │  ●  │ Progress circle (0-100%)   │  Trail dots for recent activity
│ └─────┘                             │
└─────────────────────────────────────┘
```

#### 2.3.4 Status Indicators 👤
| Status | Color | Meaning |
|--------|-------|---------|
| 🔴 Red | Overdue | Days since last log > target |
| 🟠 Amber | Near due | Approaching target rhythm |
| 🟢 Teal | On track | Within target window |
| 🟣 Purple | Zero type | Days not done (grows over time) |
| ⚪ Gray | Quiet/New | Never logged |

### 2.4 OVERDUE SECTION 👤
- Items not done in last target cycle
- Sorted by urgency (most overdue first)
- Badge shows "X days overdue"

### 2.5 COMING UP SECTION 👤
- Future due items not yet urgent
- Sorted by due date
- Shows "Due in X days"

### 2.6 Visual Card Fields 👤
| Field | Show Condition | Description |
|-------|----------------|-------------|
| `showPinnedOnCards` | Always (when enabled) | 📌 pin icon for manually pinned |
| `showSampleOnCards` | Always | 🧪 sample marker for sort lab |
| `showDurationOnCards` | When enabled | ⏱️ 30min duration |
| `showTimeWindowOnCards` | When enabled | 🕐 9am-5pm time window |
| `showTopicsOnCards` | When enabled | 💡 topic chips at bottom |
| `showLocationOnCards` | When enabled | 📍 location pin label |
| `showTrailOnCards` | When enabled | ●●●●● activity dots |
| `showCueOnCards` | Always | Status text below title |
| `showOrderPillsOnCards` | Always | ↗️ ↘️ order markers |
| `showEarlyOnCards` | Always | 🌅 early indicator |

### 2.7 Priority Badges (P0-P5) 👤
- P0: 🔴 Critical - First in agenda
- P1: 🟠 High - Second priority
- P2: 🟡 Medium - Default for new items
- P3: 🟢 Low
- P4: 🔵 Lower
- P5: ⚪ Someday - Drop first when capacity full

### 2.8 Time Window Display 👤
When `showTimeWindowOnCards: true`:
```
🕐 9am-5pm
```
- Shows allowed time window
- Preferred time shown as solid, allowed as outline
- No window = no display

---

## III. HABIT TYPES & HOW THEY WORK

### 3.1 KEEPUP HABITS (Recurring - Build) 👤
#### Scoring Logic:
```
days = daysSince(lastLog)
ratio = days / target
if ratio < 0.75: score += teal (on track)
if 0.75 ≤ ratio < 1.1: score += amber (warning)
if ratio ≥ 1.1: score += red (overdue)
```

#### Example: Exercise 3× per week (target=7 days)
- Done day 5: ratio = 0.71 → teal (on track)
- Done day 10: ratio = 1.43 → red (overdue)

### 3.2 REDUCE HABITS (Recurring - Limit) 👤
#### Scoring Logic:
```
days = daysSince(lastLog)
if days ≥ target: score += teal (achieved goal)
if target*0.65 ≤ days < target: score += amber (close)
if days < target*0.65: score += red (need to reduce)
```

#### Example: No alcohol 7× per week (target=7 days)
- Not drunk day 5: ratio = 0.71 → amber (close)
- Not drunk day 10: ratio = 1.43 → teal (goal met)

### 3.3 ZERO HABITS (Stop Doing) 👤
#### Scoring Logic:
```
days = daysSince(lastLog)
if days > 14: score += teal (well done)
if 4 ≤ days ≤ 14: score += amber (progressing)
if days < 4: score += red (keep going)
```

- No target needed - just keeps getting better the longer you wait
- Last log is when you last did the bad thing

### 3.4 TASK TYPE (One-off Items) 👤
#### Fields:
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `dueDate` | number\|null | null | Soft deadline (day-level) |
| `eventTime` | number\|null | null | Fixed time appointment |
| `hardDue` | boolean | false | Hard deadline (escalates urgency) |
| `flexibilityDays` | number | 1 | Days before due date it starts surfacing |

#### Due Score Calculation:
```
daysLeft = daysUntil(dueDate)
window = max(1, flexibilityDays)
if daysLeft ≤ 0:
  overdueBoost = hardDue ? 1.4 : 1
  score = (1 + min(0.75, abs(daysLeft)/window)) * overdueBoost
else:
  score = max(0, 1 - daysLeft/window)
```

---

## IV. DETAILED FIELD REFERENCE

### 4.1 Habit Object Structure 👤👨‍💻

```js
/**
 * @typedef {Object} Habit
 */
{
  // ─── CORE IDENTITY ───────────────────────────────────────
  hid: string,              // 👨‍💻 Internal stable ID (UUID, never shown)
  name: string,             // 👤 Display name (max 60 chars)
  emoji: string,            // 👤 Grapheme cluster(s), max 4 chars, "" = default icon
  emojiBgColor: string,     // 👤 Background color token: ''|teal|amber|red|purple|blue|green
  sample: boolean,          // 👨‍💻 Created by sort lab? (🧪 marker)
  
  // ─── TYPE & SCHEDULE ─────────────────────────────────────
  type: 'keepup'|'reduce'|'zero'|'task',  // 👤 habit type
  target: number|null,       // 👤 Rhythm: times in N days (0.5-183), null for zero/task
  createdAt: number|null,    // 👨‍💻 Creation timestamp (ms), for ordering
  
  // ─── LOGS & HISTORY ─────────────────────────────────────
  logs: LogEntry[],        // 👤 Sorted logs (actual + planned)
  lastLog: number|null,    // 👤 Most recent timestamp (derived)
  planByDate: number|null, // 👤 Keepup/reduce only: soft "do by" day (ms)
  snoozedUntil: number|null, // 👤 Hidden until this timestamp
  
  // ─── PRIORITY & RANKING ─────────────────────────────────
  priority: number,          // 👤 0-5 (P0 critical -> P5 someday)
  
  // ─── TIME WINDOW ────────────────────────────────────────
  allowedWeekdays: number[], // 👤 0=Sun..6=Sat, empty = all days
  allowedMonthDays: number[], // 👤 1-31, empty = all dates
  preferredWeekdays: number[], // 👤 Soft preference for scheduling
  preferredMonthDays: number[], // 👤 Soft preference for scheduling
  
  allowedTimeStart: number|null,  // 👤 Minutes from midnight (0-1440)
  allowedTimeEnd: number|null,    // 👤 Minutes from midnight (0-1440)
  preferredTimeStart: number|null, // 👤 Soft hint for scheduling
  preferredTimeEnd: number|null,   // 👤 Soft hint for scheduling
  
  // ─── PRAYER TIME ANCHORS ─────────────────────────────────
  allowedTimeStartAnchor: 'fajr'|'sunrise'|...|'habit'|null,
  allowedTimeStartOffsetMin: number,
  allowedTimeEndAnchor: ...,
  allowedTimeEndOffsetMin: number,
  preferredTimeStartAnchor: ...,
  preferredTimeStartOffsetMin: number,
  preferredTimeEndAnchor: ...,
  preferredTimeEndOffsetMin: number,
  
  // ─── ANCHOR TO OTHER HABITS ─────────────────────────────--
  allowedTimeStartAnchorHabitId: string|null,  // Link to another habit
  ...                        // Same for other anchor fields
  
  // ─── COMBINED WINDOWS ───────────────────────────────────
  allowedTimeStartCombine: 'later'|'earlier'|null,
  allowedTimeStartAnchor2: ...,
  allowedTimeStartOffsetMin2: number,
  allowedTimeStartAnchorHabitId2: string|null,
  allowedTimeStartFixedMin2: number|null,
  allowedTimeStartDayOffset: number,
  allowedTimeStartDayOffset2: number,
  ...  // Same pattern for end fields
  
  // ─── FLEXIBILITY & DURATION ───────────────────────────────
  flexibilityDays: number,   // 👤 Buffer days (tasks), 0-60
  durationMinutes: number,   // 👤 Planned session length (1-720)
  breakable: boolean,        // 👤 Can split across sessions
  minChunkMinutes: number,   // 👤 Minimum split size (15-720)
  
  // ─── TIMERS & AUTO-MARK ──────────────────────────────────
  timerAutoStopMinutes: number|null,  // Legacy field
  autoMarkMinutes: number|null,       // 👤 Minutes to auto-complete
  trackValue: boolean,                // 👤 Log numeric values?
  
  // ─── DEPENDENCIES ───────────────────────────────────────
  scheduleLinks: ScheduleLink[],      // 👤 Before/after relationships
  
  // ─── TOPICS & LOCATIONS ──────────────────────────────────
  topics: string[],           // 👤 Tags for filtering/search
  locationIds: string[],      // 👤 Allowed locations
  anywhereAllowed: boolean,   // 👨‍💻 Legacy: may be done anywhere
  locationPrefs: Object<string, 'avoid'|'little'|'high'>, // 👤 Soft preferences
  preferredLocationId: string|null, // 👤 Legacy preferred location
  
  // ─── LINKS & ACTIONS ─────────────────────────────────────
  links: {kind, value}[],    // 👤 Phone, WhatsApp, FaceTime, URL
  
  // ─── TASK & IMPORT FIELDS ───────────────────────────────
  dueDate: number|null,      // 👤 Task only: deadline
  eventTime: number|null,    // 👤 Task only: fixed time
  hardDue: boolean,          // 👤 Task only: hard deadline
  externalId: string|null,   // 👤 Imported from calendar
  source: 'pdf'|'msgraph'|'gcal'|null, // 👤 Import source
  importedAt: number|null,   // 👤 Import timestamp
}
```

### 4.2 LogEntry Types 👤👨‍💻
```js
/**
 * @typedef {number|{ts:number,plan:true,timed?:true,locationId?:string}|
 *          {ts:number,value?:number,minutes?:number,note?:string}} LogEntry
 */

// Type 1: Number (timestamp)
1609459200000  // 👤 Simple timestamp

// Type 2: Planned entry
{
  ts: 1609459200000,     // 👤 Timestamp
  plan: true,            // 👤 This is a planned entry
  timed: true?,          // 👤 Has fixed time
  locationId: "abc-123"  // 👤 Override location one day
}

// Type 3: Actual entry with data
{
  ts: 1609459200000,     // 👤 Timestamp
  value: 5.5,            // 👤 Weight or measurement
  minutes: 25,           // 👤 Duration for breakables
  note: "felt good"      // 👤 Free-form note (max 200 chars)
}
```

### 4.3 Settings Object Structure 👤👨‍💻

Key sections with all fields:

#### 4.3.1 Sort Presets 👤
```js
preset: 'balanced'|'build'|'planned'|'todayFirst'|'custom',
focus: 'balanced'|'build'|'space',
plansFirst: boolean,
planWindowDays: number,  // 1-14, look-ahead for plan signal

// Weight sliders (0-200 each):
planWeight, dueWeight, progressWeight, trendWeight, rhythmWeight,
buildWeight, limitWeight, stopWeight, newWeight,
```

#### 4.3.2 Scoring Weights 👤
```js
agendaScoreWeights: {
  travel: number,      // 👤 Minute cost of travel
  cluster: number,     // 👤 Benefit of grouping same location
  day: number,         // 👤 Penalty for later in week
  asap: number,        // 👤 Penalty for clock delay
  scarce: number,      // 👤 Penalty for tight time windows
  preference: number   // 👤 Penalty for non-preferred times/locations
}
```

#### 4.3.3 Card Display Options 👤
```js
showSnoozed: boolean,              // 👤 Fade out snoozed items
showSampleOnCards: boolean,        // 👤 Show 🧪 marker
showPinnedOnCards: boolean,        // 👤 Show 📌 marker
showTaskDateOnCards: boolean,      // 👤 Show due/scheduled date
showPlansOnCards: boolean,         // 👤 Show planned marker
showDayScheduleOnCards: boolean,   // 👤 Show schedule chips
showTimeWindowOnCards: boolean,    // 👤 Show 🕐 time window
showSnoozedUntilOnCards: boolean,  // 👤 Show snooze countdown
showDurationOnCards: boolean,      // 👤 Show ⏱️ duration
showRepetitionOnCards: boolean,    // 👤 Show rhythm (e.g., 1×)
showFlexibilityOnCards: boolean,   // 👤 Show flexibility days
showTopicsOnCards: boolean,        // 👤 Show 💡 topic chips
showLocationOnCards: boolean,      // 👤 Show 📍 location
showAgendaTimesOnCards: 'time'|'icon'|'hide',
showTrailOnCards: boolean,         // 👤 Show activity dots
showCueOnCards: boolean,           // 👤 Show status text
showOrderPillsOnCards: boolean,    // 👤 Show ↗️ ↘️ markers
showStatusOnCards: boolean,        // 👤 Show status word ("run", "overdue", etc.)
```

#### 4.3.4 Minimal Mode 👤
```js
minimalMode: boolean,  // 👤 Simplified UI for new users

// In minimal mode:
// - Home groups: Today / Overdue / Coming Up
// - Calendar view stripped
// - Detail view simplified
// - Settings hidden behind advanced toggle
```

#### 4.3.5 Mode & Theme 👤
```js
compactMode: boolean,      // 👤 Square cards
fontScale: 'small'|'medium'|'large',
themeMode: 'light'|'dark'|'system',
```

#### 4.3.6 Locations & Travel 👤👨‍💻
```js
topics: string[],           // 👤 Master topic registry
locations: Location[],    // 👤 Location registry
travel: { [key: string]: TravelEdge },  // 👤 Cached travel times
defaultTravelMode: 'driving'|'walking'|'bicycling'|'transit',
lastKnownLocationId: string|null,  // Auto-detected location
locationOptIn: boolean,     // 👤 Geolocation permission
pinnedLocationId: string|null,    // Manual location pin
```

#### 4.3.7 Availability & Blocking 👤
```js
availabilityMinutes: number[7],         // Daily minutes (Sun-Sat)
availabilityOverrides: { 'YYYY-MM-DD': number },  // Date overrides
blockedTimes: BlockedTime[],            // Recurring unavailable blocks
cancelledBlocks: { 'YYYY-MM-DD': string[] },       // Cancelled instances
blockedTimeOverrides: { 'YYYY-MM-DD': object },    // One-time edits

// Defaults:
// availabilityMinutes: [400, 200, 200, 200, 200, 200, 400] (sleep 10pm-6am)
// blockedTimes: [{label:'sleep',days:[0-6],start:1380,end:300}]
```

#### 4.3.8 Prayer Times (Islamic) 👤
```js
homeCityName: string,           // 👤 Location for prayer times
homeCityLat: number|null,       // 👤 Latitude
homeCityLng: number|null,       // 👤 Longitude
prayerMethod: string,           // Calculation method
prayerMadhab: 'shafi'|'hanafi', // Asr calculation
prayerIslamicNames: boolean,    // 👤 Use Islamic names for prayer times
```

#### 4.3.9 Reminders & Calendar 👤
```js
reminders: boolean,             // Enable notifications
pushDetailed: boolean,          // 👤 Rich notification content
reachable: boolean,             // 👨‍💻 Device can receive push
showScheduledTasksInAgenda: boolean,   // Scheduled (eventTime) tasks in agenda
showDueTasksInAgenda: boolean,         // Due date tasks in agenda
showPlannedItemsInAgenda: boolean,     // Future planned logs in agenda
showDueHabitsInAgenda: boolean,       // Habit due-rhythm items in agenda
showWeekOnHome: boolean,             // Week plan strip on home
agendaOptimizer: boolean,       // Use ILP planner

homeExtraMode: 'cards'|'cards12h'|'text12h',  // 👤 How blocked times appear on home
reachAssist: boolean,           // 👤 Pull-down navigation enabled

calendarCreditHabitId: string|null,  // 👨‍💻 Breakable habit for meeting minutes
calendarAllDayMode: 'skip'|'tasks', // How to import all-day events
```

#### 4.3.10 Default Values 👨‍💻
```js
defaultType:'keepup',                  // New habit default type
defaultTarget:7,                      // Default target cycle (days)
defaultPriority:2,                   // Default priority (P2)
defaultDurationMinutes:30,           // Default session length
defaultFlexibilityDays:1,            // Default flexibility for tasks
defaultBreakable:false,             // Default breakable setting
defaultMinChunkMinutes:30,          // Default minimum chunk for breakables
```

#### 4.3.11 Retention & Cleanup 👤
```js
completedTaskRetentionDays: 2|3|7,  // Auto-delete completed tasks
habitLogKeepCount: 0|12|30|60,      // Keep N logs per habit
lastRetentionCleanupAt: number,     // Timestamp of last cleanup
```

### 4.4 Location Object Structure 👤👨‍💻
```js
/**
 * @typedef {Object} Location
 */
{
  id: string,              // 👨‍💻 Internal UUID
  name: string,            // 👤 Display name (max 48 chars)
  address: string,         // 👤 Human address (max 120 chars)
  lat: number,             // WGS84 latitude (-90 to 90)
  lng: number,             // WGS84 longitude (-180 to 180)
  radiusM: number,         // 👤 Geofence radius (default 75m)
  emoji: string,           // 👤 Optional pin emoji
  
  // Hours (optional, default = 24/7)
  allowedTimeStart: number|null,  // Minutes from midnight
  allowedTimeEnd: number|null,    // Minutes from midnight
  preferredTimeStart: number|null, // Soft hint
  preferredTimeEnd: number|null,   // Soft hint
  closedDays: number[],            // 0=Sun..6=Sat, open all when empty
  hoursByDay: { [day: number]: {start, end}|null }  // Per-day override
}
```

### 4.5 TravelEdge Object Structure 👤👨‍💻
```js
/**
 * @typedef {Object} TravelEdge
 */
{
  a: string,              // 👤 Location id A (lexically smaller)
  b: string,              // 👤 Location id B (lexically larger)
  seconds: number,        // 👤 Travel time in seconds
  metres: number,         // 👤 Travel distance in metres
  provider: 'osrm'|'google'|'haversine'|'manual',  // 👤 Source
  fetchedAt: number       // 👤 Timestamp fetched (ms)
}
```

---

## V. VISUAL SYMBOLS & INDICATORS

### 5.1 Card Symbols 👤

| Symbol | Meaning | When Seen |
|--------|---------|-----------|
| 🔴 Red border | Overdue habit | Days overdue > target |
| 🟠 Amber border | Warning/near due | Approaching target rhythm |
| 🟢 Teal border | On track | Within target window |
| 🟣 Purple border | Zero habit | Days counting up (not done) |
| ⚪ Gray border | Quiet/New | Never logged or pinned |

### 5.2 Status Text (Cue) 👤
The one-line cue under each item name comes from `currentRun()` in `scoring.js`. It returns a label (and usually a count) describing where the item stands right now:

| Cue label | Example shown | When it appears |
|-----------|---------------|-----------------|
| `run` | "3 run" / "run" | Keepup habit — current on-track streak count; or just "run" when never logged or overdue |
| `clear` | "5 clear" | Reduce/Zero habit — days since you last logged it |
| `since done` | "2 since done" | Task that has already been completed |
| `someday` | "someday" | Task with no due date set |
| `when` | "when" | Task whose due date can't be resolved |
| `days ago` | "3 days ago" | Task past its due date (count = days overdue) |
| `today` | "today" | Timed task due today |
| `due` | "due" | Untimed task due today |
| `days away` | "5 days away" | Task due in the future (count = days until) |

> The card **border color** is separate from this cue — see §5.1 for the `tone()` color mapping (teal / amber / red / purple / quiet).

### 5.3 Progress Circle (●) 👤
Shows completion percentage:
- Fill level = logs / (days in cycle)
- Color based on tone function

### 5.4 Activity Trail Dots 👤
Two-week history under habit card:
- ● Black dot: Logged
- ○ Light dot: Planned
- ◯ Empty circle: Cycle day

### 5.5 Time Window Display 👤
When enabled: `🕐 9am-5pm`
- Solid: Preferred time
- Outline: Allowed time

### 5.6 Priority Badges 👤
| P0 | 🔴 Critical | First in agenda |
| P1 | 🟠 High | Second priority |
| P2 | 🟡 Medium | Default for new |
| P3 | 🟢 Low | Lower priority |
| P4 | 🔵 Lower | Even lower |
| P5 | ⚪ Someday | Dropped first |

### 5.7 Topic Chips 💡 👤
- Displayed when `showTopicsOnCards: true`
- Max 6 displayable per card
- Color-coded by topic
- Tap to filter

### 5.8 Location Pin 📍 👤
When `showLocationOnCards: true`:
- Small pin icon
- Color by location
- Tap for location info

### 5.9 Order Markers ↗️ ↘️ 👤
When `showOrderPillsOnCards: true`:
- ↘️ "After" - This habit goes after
- ↗️ "Before" - This habit goes before
- Help visualize schedule links

### 5.10 Early Indicator 🌅 👤
When `showEarlyOnCards: true`:
- Appears for habits ready early
- Shows they've been working ahead

### 5.11 Planned Marker 📅 👤
When `showPlansOnCards: true`:
- Calendar date chip
- Shows planned future log date

### 5.12 Sample Marker 🧪 👤
When `showSampleOnCards: true`:
- "sample" chip
- For habits created in Sort Lab

### 5.13 Pin Marker 📌 👤
When `showPinnedOnCards: true`:
- Pin icon
- Stays at top of lists

### 5.14 Status Display 👤
When `showStatusOnCards: true`:
- Shows status word ("run", "overdue", "on track", etc.)
- Default: ON for all new users
- Toggle in Settings > Display > Card Customization

### 5.15 Location Display 📍 👤
When `showLocationOnCards: true`:
- Shows location pin and name
- Color-coded by location emoji
- Default: OFF in minimal mode, ON in regular mode

---

### 5.16 Complete Card Settings Field List (19 total) 👤

These are the actual default values from `config.js DEFAULT_SORT_SETTINGS`:

| Field | Default | Description |
|-------|---------|-------------|
| showSnoozed | **false** | Show snoozed items (faded) |
| showSampleOnCards | **true** | 🧪 sample marker (Sort Lab) |
| showPinnedOnCards | **true** | 📌 pinned habits marker |
| showTaskDateOnCards | **true** | Due/scheduled date for tasks |
| showPlansOnCards | **true** | 📅 planned future log date |
| showDayScheduleOnCards | **true** | Schedule link chips |
| showTimeWindowOnCards | **false** | 🕐 time window display |
| showSnoozedUntilOnCards | **true** | Snooze countdown |
| showDurationOnCards | **false** | ⏱️ session length |
| showRepetitionOnCards | **true** | 1× rhythm display |
| showFlexibilityOnCards | **false** | Flexibility days |
| showTopicsOnCards | **false** | 💡 topic chips |
| showLocationOnCards | **false** | 📍 location pin |
| showStatusOnCards | **true** | Status word ("run", etc.) |
| showAgendaTimesOnCards | **'time'** | Time display in agenda |
| showTrailOnCards | **true** | Activity dots (recent logs) |
| showCueOnCards | **true** | Status text below name |
| showOrderPillsOnCards | **true** | ↗️↘️ schedule link markers |
| showEarlyOnCards | **true** | 🌅 ready early indicator |

---

## VI. HOME PAGE DAY HEADERS & PILLS 👤

### 6.1 Day Section Headers
In regular mode, home groups habits into collapsible day-by-day sections. In minimal mode, items are grouped by category:

```
Regular mode (showWeekOnHome: true):
├── Today
├── Tomorrow  
├── Wed, Thu, Fri... (day headers)
└── The Rest (untimed)

Minimal mode (always):
├── Pinned (if any pinned)
├── Today
├── Overdue
├── Coming Up
├── The Rest
```

Each day section header can have two dynamic **pills**:

### 6.2 Missed Pills (🔴 "N missed")
- Appears on "Today" header when habits didn't make it into today's agenda
- Tap to open the **Slipped Sheet** (see §X.1)
- Shows items in reverse snooze order
- Each item can be tapped to review → opens detail
- Each item has a **log button** (colored tile + "+") for one-tap clearing
- When you log from this sheet, the pill count updates immediately

### 6.3 Open Time Pills (🕒 "N open")
- Appears on day headers when there are free time stretches ≥ 10 minutes
- Tap to open the **Free Time Sheet** (see §X.2)
- Shows a visual strip of free/busy time blocks
- Free blocks are tappable to select a time for scheduling
- Includes tick marks at clean hour intervals
- Legend: busy (gray) vs open (teal)

### 6.4 Day Agenda Audit (Triple-Tap) 👨‍💻
- Triple-tap any day section header (regular mode only)
- Opens the **Day Agenda Audit** sheet (see §IX.B)
- Shows detailed capacity planning: clock/blocked/net minutes, eligible work, work placed, missed gaps, scheduler time
- Copy or export week placement data
- For developer/debugging use

### 6.5 Home Filter Bar
- Appears above the habit list when there are topics or locations
- Two filter types: **Topic chips** and **Location chips**
- `__none__` sentinel for "no topic" / "anywhere" habits
- Presence indicator (👤 "today's place") — shows current location with GPS signal
- Tap presence to open **Presence Picker** (§X.7)

---

## VII. SEARCH & FILTERING

### 7.1 Search Bar 🔍
- Case-insensitive
- Searches: habit names, topics, location names
- Clears with ✕ button

### 7.2 Topic Filter
- Chip row above habit list
- `__none__` sentinel for habits with no topics
- Tap to toggle

### 7.3 Location Filter
- Chip row alongside topics
- `__none__` for anywhere habits
- Travel time computed between locations

---

## VIII. THE ADD HABIT SHEET

### 8.1 Sheet Structure
```
┌─────────────────────────────────────┐
│ ✕ new habit                         │
├─────────────────────────────────────┤
│ [Input] Name     [Emoji] 🎯          │
│ [Emoji picker: quick picks + colors]│
│                                     │
│ Type: [habit] [task]                │
│                                     │
│ (habit) How often: [1] × in [7] d   │
│ (task)  Due: [date] [time]          │
│ ─────────────────────────────────   │
│ [more options ▼]                    │
│ ┌───────────────────────────────┐  │
│ │ Priority: P0 P1 P2 P3 P4 P5   │  │
│ │ Auto mark done: [ — ] min     │  │
│ │ Topics & places               │  │
│ └───────────────────────────────┘  │
│                                     │
│ [add] [cancel]                      │
└─────────────────────────────────────┘
```

### 8.2 Field: Habit Name 👤
- Text input, max 60 characters
- Auto-focus on open
- `enterkeyhint="done"` for mobile keyboards
- Autocapitalization: sentences

### 8.3 Field: Emoji 👤
- Optional, max 4 grapheme clusters
- Default: 💡 (lightbulb) for habits
- Emoji preview button next to name
- Quick-pick chip row for common emojis
- Background color swatches: teal, amber, red, purple, blue, green
- Info tooltip: "Optional. An emoji like 🏃 or 📚 is suggested from the name; no match? Tap any quick-pick chip. Blank uses the default habit icon."

### 8.4 Field: Type Selector 👤
| Button | Type | Shows Rhythm | Shows Due Date |
|--------|------|-------------|----------------|
| habit | keepup | ✅ Yes (times × days) | ❌ No |
| task | task | ❌ No | ✅ Yes (date + time) |

**Note:** reduce and zero types are NOT available in the add sheet. They are accessed by changing the "kind" in the detail sheet after creation. New users start with `keepup` as default.

### 8.5 Field: Rhythm (Times × Days) 👤
Visible when type = habit (keepup):
```
[1] × in [7] d
```
- Left input: Times per cycle (1-183)
- Right input: Days per cycle (0.5-183)
- Hint: "How often — times in N days (e.g. 2× in 7d)."
- Help text changes by type:
  - keepup: "How often — times in N days."
  - reduce: "Times in N days — e.g. 1× in 3d."
  - zero: "Something to avoid. Log it each time it happens; the aim is longer gaps."

### 8.6 Field: Task Due Date 👤
Visible when type = task:
- **Date input:** Calendar picker (day-level)
- **Time input:** Time picker (makes it a fixed-time event)
- Hint: "add a time to make this a fixed appointment"
- Default time: Next clean hour

### 8.7 More Options Fields 👤

| Field | UI Element | Default | Description |
|-------|-----------|---------|-------------|
| Priority | P0-P5 segmented control | P2 | P0 claims time first, P5 dropped first |
| Auto Mark Done | Number input | — (manual) | Minutes before auto-complete |
| Topics | Chip row | Inherits from defaults | Tags for filtering |

### 8.8 Buttons 👤
| Button | Action |
|--------|--------|
| add | Creates the habit and closes sheet |
| cancel | Discards changes and closes sheet |

---

## IX. THE DETAIL SHEET

### 9.1 Sheet Structure
```
┌─────────────────────────────────────┐
│ ✕ habit name                       │
├─────────────────────────────────────┤
│ Tab: identity  schedule  effort     │
│        insight  calendar  actions  │
│ (minimal hides: calendar, insight,  │
│  effort - folded into schedule)   │
│                                     │
│ [Tab content area]                  │
└─────────────────────────────────────┘
```

### 9.2 Detail Page Tabs (6 total) 👤👨‍💻

| Tab | Icon | Key | Description |
|-----|------|-----|-------------|
| `identity` | 🎫 (id) | Identity info | Name, emoji, type, priority, pinned |
| `schedule` | 📅 | Time windows, rhythm, days |
| `effort` | 📊 | Duration, breakable, min chunk |
| `insight` | 📈 | Stats, streaks, progress graph |
| `calendar` | 🗓️ | Activity heatmap, month view |
| `actions` | ⋮ | Links (phone, web, etc.) |

**Minimal Mode Hidden Tabs:** `calendar`, `insight`, `effort` (folded into `schedule`)

### 9.3 Identity Tab 👤

Fields shown (always visible, even in minimal mode):
- **Name** (text input, max 60 chars, auto-focus)
- **Emoji** (emoji picker, max 4 graphemes, with quick-pick + background color)
- **Type** (segment: `habit` / `task`)
  - When `habit`: Shows **Kind** sub-segment (build/limit/stop)
    - `build` = keepup (build positive habits)
    - `limit` = reduce (reduce negative habits)  
    - `stop` = zero (completely stop doing)
  - When `task`: No kind sub-segment
- **Priority** (P0-P5 segmented control, with info tooltip)
- **Links** (links & calls section with star for primary)
- **Topics & Places** (topic chips + location chips)
- **Delete** button (🗑️ with confirmation)

### 9.4 Schedule Tab Details 👤

#### Rhythm Section
- **Target times:** How many times per cycle (default 1, range 1-183)
- **Cycle days:** Days per cycle (default 7, range 0.5-183)
- For `habit` type only — visible as `[N] × in [N] d`

#### Days Section
- **Allowed Weekdays:** Mon Tue Wed Thu Fri Sat Sun (0-6)
  - Empty = all days
- **Allowed Month Days:** Dates 1-31
  - Empty = all dates
- **Preferred Weekdays/Month Days:** Soft hints for sorting

#### Time Window Section
```
[allowed] Mon Tue Wed Thu Fri Sat Sun
time: | 9am | — | 9am | — | 9am | — |
      | — | 5pm | — | 5pm | — | 5pm |

[x] open 24h
[ ] closed days: [Sun]
```
- Time fields: Minutes from midnight (0-1440)
- End ≤ Start = overnight window (e.g., 1380→300 = 11pm-5am)

#### Time Anchor Section
- **Anchors:** `fajr`, `sunrise`, `dhuhr`, `asr`, `maghrib`, `isha`, or another habit
- **Offset:** ±720 minutes (±12 hours)
- **Combine:** `later` / `earlier` of two expressions

#### Schedule Links Section
- Before/After relationships with other habits
- `requireSameDay` option
- Visual timeline showing order

### 9.5 Effort Tab 👤

#### Duration Section
- **Duration (minutes):** Planned session length
  - Input range: 1-720 minutes
  - Default: 30 min
  - HTML input: `detail-duration`

#### Flexibility Section (full mode only) 👤
- **Flexibility (days):** Buffer added to target for planning
  - Input range: 0-60
  - Default: 0
  - Tooltip: "Adds a buffer to your target for planning purposes."

#### Breakable Section 👤
- **Breakable into chunks:** Toggle switch
  - Allows splitting work across sessions
  - Default: false (off)

#### Min Chunk Section (show when breakable = true) 👤
- **Shortest session (minutes):** Minimum split size
  - Input range: 15-720
  - Default: 30 min
  - Tooltip: "Smallest piece when work must be split. Prefer one continuous session when time allows — this is a floor, not a suggested chunk size."

#### Track Value Section 👤
- **Log a value or note (e.g. weight):** Toggle switch
  - When on, logging offers a free-form numeric value field
  - Default: false

#### Auto Mark Done Section 👤
- **Auto mark done (minutes):** Input field
  - Placeholder: —
  - Blank = manual completion (default)
  - Number = auto-complete after N minutes
  - Tooltip: "Blank keeps scheduled completion manual. For breakable items, each planned agenda chunk is credited after it ends. This setting never completes a manual session."

#### Timer Section (full mode only) 👤
- **Start session** button (toggle, `detail-timer-toggle`)
- **Timer display:** Shows elapsed time (0:00 format)
- **Session target:** Optional target minutes (uses duration if blank)

#### Task Due Section (visible for tasks only) 👤
- **Due date:** Date picker (`detail-due-date`)
- **Due time:** Time picker (`detail-due-time`, makes it a fixed appointment)
- Hint: "add a time to make this a fixed appointment"

### 9.6 Insight Tab 👤

#### Progress Graph
- Shows last 30 days of logging
- Each bar represents a day
- Height = number of logs that day
- Color = success status (teal/amber/red)

#### Statistics
- **Record Streak:** Longest consecutive success streak
- **Current Streak:** Active streak count
- **Total Logs:** Lifetime log count
- **Success Rate:** Percentage of on-track days
- **Average Interval:** Days between logs

### 9.7 Calendar Tab 👤

#### Month View
- Heatmap of activity across the month
- Dots show days with logs
- Tap any date to plan a log

#### Activity Heatmap
- Color intensity = log frequency
- Darker = more activity

### 9.8 Actions Tab 👤

#### Links Section
Each link row has:
- **Kind selector:** Phone, WhatsApp, FaceTime, Link
- **Value:** The phone number, URL, or ID
- **Star:** Marks as primary link (double tap uses this)

| Link Kind | Icon | Format | Example |
|-----------|------|--------|---------|
| Link | 🔗 | Full URL | `https://zoom.us/j/123` |
| Phone | 📞 | Phone number | `+1234567890` |
| WhatsApp | 💬 | Phone number | `+1234567890` |
| FaceTime | 🎥 | Email or phone | `user@example.com` |

#### Notes Section
- Free-form text field
- Max 200 characters (`MAX_NOTE_CHARS`)
- Visible in detail view
- Not used in scoring

### 9.9 Value Logging 👤
When `trackValue: true`:
- Log entry shows value input
- Value can be:
  - Weight (lbs/kg)
  - Count/reps
  - Score/rating
  - Any numeric metric
- Value stored in log entry as `value` field

### 9.10 Planned Logs 👤
- Planned entries (marked with `plan: true`)
- Show as future commitments
- Can be cancelled or rescheduled
- Appear on calendar heatmap

### 9.11 Session Timer 👤
- Starts/stops timer for current session
- Shows elapsed time (0:00 format)
- Auto-stops at `timerAutoStopMinutes` if set
- When stopped, prompts to log the session
- Uses `habitTimer` global state object

### 9.12 Doing Now Feature 👤👨‍💻
Tracks the currently active habit session:
- `DoingNowState` object: `hid`, `startedAt`, `dayBase`, `sessionMinutes`, `targetAt`, `endsAt`, `completionMode`
- Only one habit can be "in progress" at a time
- `completionMode`: 'manual' or 'auto'
- `oneShotAutoMark`: compatibility flag
- Visible on the home card as a running timer
- Auto-completes at `endsAt` or when `timerAutoStopMinutes` is reached

---

## IX.A. ACTIVITY SHEET (LOG HISTORY) 👤

### Sheet Structure
```
┌─────────────────────────────────────┐
│ Habit Name                          │
│ Activity and plans.                 │
├─────────────────────────────────────┤
│ [Calendar button]           [Done] │
├─────────────────────────────────────┤
│ Summary: streak, record, stats     │
├─────────────────────────────────────┤
│ Activity list:                      │
│ ● Today 9:30 AM  logged             │
│ ○ Tomorrow 10:00 AM  planned        │
│ ● Aug 3 8:00 AM  logged             │
└─────────────────────────────────────┘
```

### Tabs/Filters
- **Activity tab:** Shows actual log entries
- **Calendar tab:** Day-level calendar view for planning

### Entry Types
| Type | Display | Icon |
|------|---------|------|
| Actual log | "● Today 9:30 AM logged" | ● filled dot |
| Planned log | "○ Tomorrow 10:00 AM planned" | ○ hollow dot |
| Value log | "● Today 9:30 AM logged · +5.5" | ● with value |

### Actions (in activity list)
- Tap entry: Edit or delete
- Calendar view: Tap day to plan/cancel logs

---

## IX.B. DAY AGENDA AUDIT (Triple-Tap Debug) 👨‍💻

### Sheet Structure
```
┌─────────────────────────────────────┐
│ Day Agenda Audit                    │
│ [Date]                              │
├─────────────────────────────────────┤
│ [Copy] [Download] [Close]          │
├─────────────────────────────────────┤
│ Capacity: 240 minutes               │
│ Used: 120 minutes                   │
│ Free: 120 minutes                   │
├─────────────────────────────────────┤
│ [List of agenda placements]        │
└─────────────────────────────────────┘
```

**Access:** Triple-tap a day section header on the overview/calendar

### Features
- Copy week placements (to clipboard)
- Download week placements (as JSON file)
- Shows all agenda item placements for debugging

---

## X. CONTEXTUAL SHEETS (Right-Swipe / Drag Actions)

### 10.1 Slipped Sheet (Missed Habits) 👤

```
┌─────────────────────────────────────┐
│ ←  needs a next step                │
│ missed · today                     │
│ Open an item to reschedule it,     │
│   log it, or adjust its rhythm.    │
├─────────────────────────────────────┤
│ [Emoji tile] Habit Name     ● 2h  │
│                                 📅 │
│ [Emoji tile] Another Habit  ○ 3d  │
│                                 📍 │
└─────────────────────────────────────┘
```

- **Access:** Tap "N missed" pill on a day header, or right-swipe a card → "missed" action
- Lists habits that were due but didn't fit in the agenda
- Each item has a colored **pulse tile** (+ badge) for one-tap logging
- Tap the item row to open detail for rescheduling
- Items show snooze tags or day labels (behind/today/tomorrow)

### 10.2 Free Time Sheet (Open Gaps) 👤

```
┌─────────────────────────────────────┐
│ ⏱  room in your day                │
│ open time · today                  │
│ See the stretches that can still    │
│   hold a habit or task.            │
├─────────────────────────────────────┤
│ [Free day strip: busy/free blocks] │
│ Free blocks are tappable           │
└─────────────────────────────────────┘
```

- **Access:** Tap "N open" pill on a day header
- Visual timeline of free vs busy blocks
- `formatFreeDuration` shows total free time ("3h" / "45m")
- Largest gap highlighted
- Free blocks can be selected to schedule a habit/task into that window

### 10.3 Snooze Sheet 👤

```
┌─────────────────────────────────────┐
│ Habit Name                         │
│ Choose how long to hide this habit. │
├─────────────────────────────────────┤
│ [1d] [3d] [7d] [14d]               │
│ [1 time] [2 times]                 │
├─────────────────────────────────────┤
│ [cancel]                           │
└─────────────────────────────────────┘
```

- **Access:** Left-swipe card → snooze, or from card actions
- Time-based snooze: 1d, 3d, 7d, 14d
- Repetition-based snooze: 1 time, 2 times (hides for N completions of another habit)
- Hidden from list but still appears in search

### 10.4 Value Log Sheet 👤

```
┌─────────────────────────────────────┐
│ log value                          │
│ Optional number for this entry.     │
├─────────────────────────────────────┤
│ [_______]     ← number input        │
│ [_______]     ← note input          │
├─────────────────────────────────────┤
│ [log] [skip] [cancel]              │
└─────────────────────────────────────┘
```

- **Access:** When a habit has `trackValue: true`, logging opens this sheet
- Enter a numeric value (e.g. weight, reps, pages)
- Optional note field (max 200 chars)
- "Skip" logs without a value

### 10.5 Order Link Sheet (Temporary Reorder) 👤

```
┌─────────────────────────────────────┐
│ Reorder?                           │
│ Just for today. Clears when done.   │
├─────────────────────────────────────┤
│ Habit A  [after] [sometime] [off]  │
│ Habit B  [before] [sometime] [off] │
├─────────────────────────────────────┤
│ [cancel] [clear] [save]            │
└─────────────────────────────────────┘
```

- **Access:** Drag a card to a new position in agenda view
- Sets temporary "before"/"after" ordering links (`ScheduleLink` with `temp:true`)
- "After" / "Before" / "Sometime" adjacency options
- Links clear at end of day
- Only available in regular mode (not minimal)

### 10.6 Doing Now Sheet 👤

```
┌─────────────────────────────────────┐
│ Do this now?                       │
│ Keeps this on top and logs it      │
│   automatically after 30m.         │
├─────────────────────────────────────┤
│ Habit Name                          │
│ [before] [after] [off]              │
├─────────────────────────────────────┤
│ [cancel] [start & auto-complete]   │
└─────────────────────────────────────┘
```

- **Access:** Drag a card to the very top of today's agenda
- Puts the habit on top with a running timer
- Automatically logs after the duration passes
- Shows "doing now — logs automatically at the end" pill
- Manual session mode continues until you stop

### 10.7 Presence Picker 👤

```
┌─────────────────────────────────────┐
│ 📍  today's context                │
│ where are you?                      │
│ This sets today's starting place.   │
├─────────────────────────────────────┤
│ [🏠 Home]  [🏢 Gym]  [🏪 Store]     │
│ [cancel]                            │
└─────────────────────────────────────┘
```

- **Access:** Tap the "today's place" presence bar on home filter
- Select which location you're at today
- Sets the starting point for agenda placement
- Different from location filter: doesn't filter the list, just sets context

### 10.8 Location Permission Sheet 👤

```
┌─────────────────────────────────────┐
│ use your location?                  │
│ Tings uses your location to mark    │
│   where you are and shape today's   │
│   plan. Coordinates stay on device. │
├─────────────────────────────────────┤
│ [allow location] [not now]         │
└─────────────────────────────────────┘
```

- **Access:** When geolocation needed but not yet granted
- iOS/PWA: must come from a user gesture to trigger `getCurrentPosition`
- Coordinates never leave the device

### 10.9 Location Picker Sheet (Map) 👤

```
┌─────────────────────────────────────┐
│ add place                           │
│ Search or drag the map. Pin stays   │
│   in the center.                    │
├─────────────────────────────────────┤
│ [name _______]                      │
│ [search address _______] [search]   │
│                                     │
│           [🗺️ MAP WITH PIN]        │
│              [My location]          │
│                                     │
│           [enter coordinates ▼]    │
│           [save place] [cancel]   │
└─────────────────────────────────────┘
```

- **Access:** Settings → Locations → "add place", or from detail → places
- Search by address via Nominatim/Photon
- Search combines Photon and Nominatim results, removes duplicate pins, and accepts `latitude, longitude`
- Saved places are shown in alphabetical/natural order across settings, habit forms, presence, and filters
- A place created from a new/edit habit returns to that form already selected
- Drag map to position pin (stays centered)
- GPS button: "My location"
- Coordinate input (lat/lng) via details disclosure
- Save or cancel

### 10.10 Travel Time Editor Sheet 👤

```
┌─────────────────────────────────────┐
│ 🚗  agenda connection               │
│ travel time                         │
│ Home → Gym                          │
├─────────────────────────────────────┤
│ [−] [60] minutes [+]              │
│ Estimated from distance + mode      │
├─────────────────────────────────────┤
│ [save] [open in maps] [reset] [cancel] │
└─────────────────────────────────────┘
```

- **Access:** Tap a travel row in detail schedule, or from locations
- Override estimated travel time between two places
- Travel modes: driving, walking, bicycling, transit
- "Open in maps" opens external maps app
- "Reset to estimate" reverts to calculated time

### 10.11 Busy Time Editor Sheet 👤

```
┌─────────────────────────────────────┐
│ 🔒  busy time                       │
│ Busy time                           │
├─────────────────────────────────────┤
│ starts: [08:00]  →  ends: [09:00]  │
│ Change for this date or series      │
├─────────────────────────────────────┤
│ [save this date] [update recurring] │
│ [cancel]                           │
└─────────────────────────────────────┘
```

- **Access:** Settings → Busy Times → "add busy time", or tap existing block
- Set start/end time (15-min increments)
- Choose days of week
- "Save this date" vs "Update recurring" (modifies one instance vs the series)

### 10.12 Day Logs Sheet (Multi-Step) 👤

```
Step 1: LIST
┌─────────────────────────────────────┐
│ ←  [Date]  ✕                        │
│                         [subtext]   │
├─────────────────────────────────────┤
│ [List of scheduled items]          │
│ [Add] [Done]                        │
└─────────────────────────────────────┘

Step 2: ITEM (tap an item)
┌─────────────────────────────────────┐
│ ←  [Item Name]  ✕                   │
├─────────────────────────────────────┤
│ [Schedule details]                 │
│ [Log] [Plan] [Cancel]              │
└─────────────────────────────────────┘

Step 3: ADD (new plan)
┌─────────────────────────────────────┐
│ ←  [Item Name]  ✕                   │
├─────────────────────────────────────┤
│ [Date] [Time]                       │
│ [Save] [Cancel]                     │
└─────────────────────────────────────┘

Step 4: AVAIL (availability)
┌─────────────────────────────────────┐
│ ←  [Date]  ✕                        │
├─────────────────────────────────────┤
│ [Availability details]             │
│ [Save] [Cancel]                     │
└─────────────────────────────────────┘
```

- **Access:** Tap a day in the calendar view, or tap "open time" on a day header
- Multi-step flow via `dayLogsStep`: 'list' → 'item' → 'add' → 'avail'
- Step 1: List all items scheduled for that day
- Step 2: Item detail (edit schedule, log, or plan)
- Step 3: Add new plan for the item
- Step 4: Set availability overrides for the day
- Back button navigates to previous step

### 10.13 Home Filter Sheet 👤

```
┌─────────────────────────────────────┐
│ filter home                        │
│ Choose a place or topic.           │
├─────────────────────────────────────┤
│ [Topic group: work, health, etc.]  │
│ [Place group: home, gym, etc.]     │
├─────────────────────────────────────┤
│ [reset] [show results]            │
└─────────────────────────────────────┘
```

- **Access:** Tap the filter trigger on home
- Filter habits by topic and/or location
- Reset to clear all filters
- "Show results" applies and closes

### 10.14 Calendar Filter Sheet 👤

Same as Home Filter Sheet but for the calendar view:
- Filters apply to the calendar overview's day headers and agenda items
- Separate state from home filters

---

## XI. TOASTS & ACTION TOASTS 👤

### Toast System
- Transient messages at the bottom of the screen (`aria-live="polite"`)
- Regular toasts (`#toast`): informational feedback only
- Action toasts (`#action-toast`): offer immediate next steps with buttons

### Action Toast Buttons
The action toast (`#action-toast`) contains:
- **#action-text** — message describing the completed action
- **#action-open** (hidden by default) — "open" button to open the affected habit
- **#action-plan** (hidden by default) — "action" button for quick next-step
- **#snooze-until-planned** (hidden by default) — "snooze until planned" button
- **#action-undo** — always available undo button

### Toast Triggers
Toasts appear after:
- Logging a habit (pulse tap on card)
- Snoozing a habit
- Removing a habit (nuke)
- Completing a task
- Planning a future item
- Timer auto-completion

### Guided Coaches
- A fresh, empty install offers the **install guide** first when it runs in a
  browser: numbered, iconified per-platform steps (iOS Share → Add to Home
  Screen; Android menu → Install app; desktop address-bar install) connected by
  arrows, or a native **Install** button on Chrome-based browsers where a
  `beforeinstallprompt` gesture was captured (declined prompts fall back to the
  manual steps). The guide ends by handing over to the guided start; a user
  already running the installed (standalone) app is offered the guided start
  directly. About → **install app** replays the guide on demand, and About's
  install button tells already-installed users where the guided start lives.
- A fresh, empty install offers the **guided start** after first paint. It follows
  the real add, detail, home, and calendar surfaces instead of using a simulator.
- The guided start branches between a repeating habit and a one-off task. It
  teaches times-in-days rhythms or optional task dates/times, then covers
  duration, auto-mark, card logging, Home groups, and the minimal calendar.
  After the card intro it makes the user **log (or complete) the Ting they just
  created** with the real pulse button — with an “I’ll log later” escape — so the
  daily loop is practiced, not just described; the replay refresher never logs.
- **Every step gates the whole experience.** Locked (required-action) steps
  intercept taps outside the highlighted control with an amber warning; guided
  (read-and-continue) steps block outside taps silently while the bubble’s
  Next/Back advance the tour. Wheel scrolling outside the spotlight is blocked
  too. When a step has no visible target (e.g. the welcome), the guards cover
  the full screen so only the coach bubble is usable — there is no open window
  between stages.
- The coach decides which page is on screen: each stage declares the sheets it
  may keep open (add/detail/settings/overview plus their pickers and
  inspectors), and any other sheet that appears — stray tap, system navigation,
  async open — is closed automatically. If an expected sheet is dismissed, the
  coach returns to the matching safe step.
- Skipping is a two-tap action (the button arms for 2.5 s) so a stray tap
  cannot discard a tour; Escape still ends it immediately.
- The name step uses the visual viewport while the keyboard is open. Enter moves
  to the habit/task choice rather than saving early, and the keyboard is closed
  before teaching controls farther down the add sheet.
- About → **guided start** replays a non-destructive refresher for an existing
  user.
- Guided start finishes with the **install guide**: iOS learns
  Share → Add to Home Screen, Android/desktop learns the menu or address-bar
  install, and Chrome-based browsers with a captured `beforeinstallprompt`
  gesture get a native Install button (with a Not-now escape and a manual-steps
  fallback if the prompt is declined). The step is skipped when Tings already
  runs standalone, and About → **install app** replays the same guide as a
  one-step tour on demand.
- About → **advanced coach** teaches the full, non-minimal surface: rich cards,
  swipe/card actions, agenda ordering and audit, every major detail area,
  calendar analysis and filters, home display, backup, calendar import, topics,
  locations/travel, busy times, defaults, appearance, and smarter packing. When
  minimal mode is on, the user turns it off from the real Settings control.
- Coach assets live in `onboarding/` and are loaded on demand. Completion is
  versioned in `tings_coach_essentials_v2` / `tings_coach_advanced_v2`.

---

## XII. SETTINGS OVERVIEW 👤👨‍💻

### 12.1 Accessing Settings
- Bottom nav: ⚙️ settings button
- Or: About sheet → settings button
- On wide screens: settings can open as a side pane

### 12.2 Settings Sections

The actual settings sections (in order of appearance):

```
Settings sections (actual order):
├── display
│   └── minimal mode toggle
├── home page
│   ├── bring planned items up
│   ├── fixed-time tasks in agenda
│   ├── tasks due today in agenda
│   ├── planned for today in agenda
│   ├── habits ready today in agenda
│   ├── week by day (full mode only)
│   └── busy blocks & travel display
├── backup
│   ├── export backup
│   └── import backup
├── cleanup
│   ├── completed task retention (2/3/7 days)
│   ├── habit history (keep N logs: 12/30/60/off)
│   └── clean now button
├── schedule & places (group)
│   ├── calendar import
│   │   ├── PDF import
│   │   ├── calendar credit habit
│   │   └── all-day event handling
│   ├── topics
│   ├── locations
│   │   ├── live location (geolocation toggle)
│   │   ├── city (for prayer/sunrise times)
│   │   ├── add place button
│   │   └── default travel mode
│   └── busy times
├── look & new habits (group)
│   ├── what shows on each item (card display toggles)
│   ├── new habit defaults
│   │   ├── default type (build/limit/stop/task)
│   │   ├── how often (rhythm)
│   │   ├── importance (priority)
│   │   ├── duration
│   │   ├── can do early (flexibility)
│   │   ├── allow splitting (breakable)
│   │   └── default topics
│   ├── appearance
│   │   ├── compact mode
│   │   ├── font size (small/medium/large)
│   │   └── theme (light/dark/system)
│   ├── prayer times
│   │   ├── islamic names toggle
│   │   ├── calculation method
│   │   └── asr school (shafi/hanafi)
│   └── advanced
│       └── smarter packing (ILP optimizer)
└── start over (reset settings)
```

```
sortable settings sections:
├── sort presets
├── focus mode
├── availability
├── blocked times
├── topics
├── locations
├── display
├── prayer times
├── calendar import
├── reminders
├── retention
└── sort lab
```

---

## XIII. DETAILED FIELD EXPLANATIONS

### 13.1 Priority (P0-P5) 👤
Controls ordering in agenda and home list:
- **P0 (Critical):** Claims agenda capacity first
- **P5 (Someday):** Dropped when day overflows

### 13.2 Duration (minutes) 👤
How long a habit session takes:
- Minimum: 1 minute
- Maximum: 720 minutes (12 hours)
- Used by agenda for capacity planning

### 13.3 Flexibility Days 👤
Only for Task type:
- Days before `dueDate` when task starts being relevant
- Example: due on 15th, flexibility 3 → starts appearing on 12th

### 13.4 Auto Mark Done (minutes) 👤
- Blank: Manual completion (tap the pulse button)
- Number: Automatically completes after N minutes
- Used for: Timed sessions, pomodoro tracking

### 13.5 Breakable 👤
- Off: Must complete in one session
- On: Planner may split across multiple sessions
- Session split minimum: `minChunkMinutes`

### 13.6 Allowed Days 👤
- Weekdays: 0=Sun through 6=Sat
- Empty array = all days
- Affects when habit can be done

### 13.7 Allowed Time Window 👤
- Start/End: Minutes from midnight (0-1440)
- End ≤ Start = overnight window (e.g., 1380→300 = 11pm-5am)
- Null = unrestricted

### 13.8 Topics 👤
- Tags for habits
- Used in search and filters
- Max 24 topics, 32 chars each
- Case-sensitive

### 13.9 Locations 👤
Physical places with travel time:
- Geofenced (default 75m radius)
- Travel time computed between locations
- Agenda minimizes travel distance

### 13.10 Links 👤
Actions when habit is done:
- Phone: Dial number
- WhatsApp: Open chat
- FaceTime: Start video call
- Link: Open URL (Zoom, etc.)
- Double tap on card launches primary link

---

## XIV. AGENDA & PLANNING ALGORITHMS

### 14.1 Attention Score Calculation 👨‍💻
Primary ranking algorithm:

```
baseScore = 
  planWeight × planSignal +
  dueWeight × dueScore +
  progressWeight × progressScore +
  trendWeight × trendScore +
  rhythmWeight × rhythmScore +
  buildWeight × buildScore +
  limitWeight × limitScore +
  stopWeight × stopScore +
  newWeight × newScore
```

### 14.2 Event Types & Scoring

| Type | Scoring | Agenda Placement |
|------|---------|------------------|
| Event | No scoring | By literal time |
| Task | Due score only | Priority after events |
| Habit | Full attention score | By score after events |
| Plan | Part of habit logs | N/A |

---

## XV. MINIMAL MODE vs REGULAR MODE

### 15.1 Minimal Mode (Default for New Users) 👤

**What Changes:**
| Feature | Regular | Minimal |
|---------|---------|---------|
| Home view | All sections | Today/Overdue/Coming Up |
| Calendar | Full view | Simplified week strip |
| Detail view | Full tabs | Condensed |
| Settings | All visible | Advanced hidden |
| Card elements | All fields | Essential only |

**Why Minimal:**
- Reduces cognitive load
- Simplifies onboarding
- Focuses on core feedback loop
- Users can unlock full features anytime

**How to Exit:**
Settings > Display > Minimal Mode (toggle off)

---

## XVI. GLOSSARY

| Term | Definition |
|------|------------|
| **Target** | Rhythm: times per N days |
| **Flexibility** | Days before deadline for tasks |
| **Attendance Score** | Urgency based on overdue/on-track status |
| **Agenda** | Today's scheduled timeline |
| **Plan Signal** | Future logs marked "planned" |
| **Progress Score** | Based on completion streak |
| **Trend Score** | Recent performance trend |
| **Rhythm Score** | Based on target achievement |
| **Breakable** | Can be split across sessions |
| **Hard Due** | Firm deadline (no slack after) |
| **Event Time** | Fixed appointment time |
| **ILP Solver** | Integer Linear Programming for optimal packing |
| **Scarce Window** | Tight allowed time window |
| **ASAP** | Clock delay penalty |

---

## XVII. COMPLETE DEFAULT SETTINGS 👨‍💻

### 17.1 Full Default Settings Object

Full snapshot of `DEFAULT_SORT_SETTINGS` from `config.js`:

```js
{
  // From SORT_PRESETS.todayFirst (the default preset)
  focus: 'balanced',
  plansFirst: true,
  planWindowDays: 3,
  planWeight: 120,
  dueWeight: 140,
  progressWeight: 60,
  trendWeight: 50,
  rhythmWeight: 50,
  buildWeight: 110,
  limitWeight: 80,
  stopWeight: 110,
  newWeight: 100,
  newBuildMode: 'gentle',
  dueMode: 'relative',
  buildLookAheadDays: 3,
  buildRiseAt: 70,
  limitMode: 'overdue',
  stopMode: 'watch',
  rhythmBias: 0,
  locationWeight: 80,

  // Explicit defaults
  preset: 'todayFirst',
  showSnoozed: false,
  showSampleOnCards: true,
  showPinnedOnCards: true,
  showTaskDateOnCards: true,
  showPlansOnCards: true,
  showDayScheduleOnCards: true,
  showTimeWindowOnCards: false,
  showSnoozedUntilOnCards: true,
  showDurationOnCards: false,
  showRepetitionOnCards: true,
  showFlexibilityOnCards: false,
  showTopicsOnCards: false,
  showLocationOnCards: false,
  showStatusOnCards: true,
  showAgendaTimesOnCards: 'time',
  showTrailOnCards: true,
  showCueOnCards: true,
  showOrderPillsOnCards: true,
  showEarlyOnCards: true,

  // Agenda settings
  showScheduledTasksInAgenda: true,
  showDueTasksInAgenda: true,
  showPlannedItemsInAgenda: true,
  showDueHabitsInAgenda: true,
  showWeekOnHome: true,
  homeExtraMode: 'cards12h',
  reachAssist: true,
  agendaOptimizer: true,
  agendaScoreWeights: {
    travel: 1,
    cluster: 1,
    day: 1,
    asap: 0.12,
    scarce: 0.05,
    preference: 1.5
  },

  // Reminders
  reminders: false,
  pushDetailed: false,

  // Defaults for new habits
  defaultType: 'keepup',
  defaultTarget: 7,
  defaultPriority: 2,
  defaultDurationMinutes: 30,
  defaultFlexibilityDays: 1,
  defaultBreakable: false,
  defaultMinChunkMinutes: 30,

  // New habit defaults (continued from config.js)
  defaultTopics: [],
  defaultAutoMarkMinutes: null,

  // Display & mode
  minimalMode: true,
  compactMode: true,
  fontScale: 'medium',
  themeMode: 'system',
  homeExtraMode: 'cards12h',
  reachAssist: true
}
```

### System Constants 👨‍💻

| Constant | Value | Purpose |
|----------|-------|---------|
| `KEY` | `'tings_v2'` | localStorage key for habits |
| `SORT_SETTINGS_KEY` | `'tings_app_settings_v2'` | localStorage key for settings |
| `MAX_LOGS` | 500 | Max logs per habit |
| `MAX_TINGS` | 300 | Max habits total |
| `MAX_LOCATIONS` | 32 | Max locations in registry |
| `MAX_TRAVEL_EDGES` | 1024 | Max cached travel edges (32²) |
| `QUOTA_WARN_KB` | 4096 | Warn at ~4MB localStorage |
| `QUOTA_HARD_KB` | 4800 | Hard limit |
| `DEFAULT_LOCATION_RADIUS_M` | 75 | Geofence radius |
| `DEFAULT_TRAVEL_MODE` | `'driving'` | Default travel mode |
| `TRAVEL_TTL_MS` | 30 × 86400000 | Travel cache TTL (30 days) |
| `TRAVEL_FETCH_TIMEOUT_MS` | 3000 | Routing call timeout |
| `GEOCODE_FETCH_TIMEOUT_MS` | 8000 | Geocoding timeout |
| `MAX_RHYTHM_DAYS` | 183 | Max cycle length |
| `MIN_RHYTHM_DAYS` | 0.5 | Min cycle length |
| `DEFAULT_DURATION_MINUTES` | 30 | Default session length |
| `DEFAULT_MIN_CHUNK_MINUTES` | 30 | Default min chunk when breakable |
| `DEFAULT_FLEXIBILITY_DAYS` | 1 | Default flexibility for tasks |
| `TIME_PICKER_STEP_MINUTES` | 15 | Time picker granularity |
| `MAX_NOTE_CHARS` | 200 | Max free-form notes |
| `DEFAULT_PRIORITY` | 2 | Default priority (P2) |
| `DEFAULT_PRAYER_METHOD` | `'NorthAmerica'` | Islamic prayer method |
| `DEFAULT_PRAYER_MADHAB` | `'shafi'` | Asr calculation |
| `PRAYER_OFFSET_MAX_MIN` | 720 | Max offset (±12h) |

### Prayer Time Calculation Methods 👤

| Key | Label | Region |
|-----|-------|--------|
| `NorthAmerica` | North America (ISNA) | North America (default) |
| `MuslimWorldLeague` | Muslim World League | Global |
| `Egyptian` | Egyptian General Authority | Egypt/Africa |
| `Karachi` | University of Karachi | Pakistan |
| `UmmAlQura` | Umm al-Qura (Makkah) | Saudi Arabia |
| `Dubai` | Dubai | UAE |
| `MoonsightingCommittee` | Moonsighting Committee Worldwide | Global |
| `Kuwait` | Kuwait | Kuwait |
| `Qatar` | Qatar | Qatar |
| `Singapore` | Singapore | Singapore |
| `Tehran` | Tehran | Iran |
| `Turkey` | Turkey (Diyanet) | Turkey |

### Madhab Options 👤

| Key | Label | Asr Time |
|-----|-------|----------|
| `shafi` | Shafi (standard) | Earlier Asr |
| `hanafi` | Hanafi (later Asr) | Later Asr |

### Location Preferences 👤

| Level | Score | Description |
|-------|-------|-------------|
| `avoid` | -40 | Avoid this location when possible |
| `little` | +12 | Slight preference |
| `high` | +36 | Strong preference |

### Priority Levels 👤

| Level | Label | Usage |
|-------|-------|-------|
| 0 | P0 | Critical - claims agenda first |
| 1 | P1 | High |
| 2 | P2 | Medium (default) |
| 3 | P3 | Low |
| 4 | P4 | Lower |
| 5 | P5 | Someday - dropped first |

### 17.2 JSON Schema Examples 👨‍💻

**Sample Habit:**
```json
{
  "hid": "a1b2c3d4-e5f6-7890",
  "name": "Morning Yoga",
  "type": "keepup",
  "target": 7,
  "logs": [1609459200000, 1609545600000],
  "emoji": "🧘",
  "pinned": false,
  "snoozedUntil": null,
  "topics": ["health", "wellness"],
  "allowedWeekdays": [0, 1, 2, 3, 4],
  "allowedTimeStart": 360,
  "allowedTimeEnd": 420,
  "durationMinutes": 30,
  "breakable": true,
  "preferredTimeStart": 360,
  "preferredTimeEnd": 390,
  "priority": 2,
  "lastLog": 1609545600000,
  "createdAt": 1609372800000
}
```

**Sample Settings (Minimal):**
```json
{
  "preset": "todayFirst",
  "minimalMode": true,
  "showTopicsOnCards": false,
  "showLocationOnCards": false,
  "showDurationOnCards": false,
  "availabilityMinutes": [400,200,200,200,200,200,400],
  "blockedTimes": [{"label":"sleep","days":[0,1,2,3,4,5,6],"start":1380,"end":300}],
  "topics": ["health","wellness"],
  "locations": [],
  "agendaOptimizer": true,
  "agendaScoreWeights": {"travel":1,"cluster":1,"day":1,"asap":0.12,"scarce":0.05,"preference":1.5},
  "defaultType": "keepup",
  "defaultTarget": 7,
  "defaultDurationMinutes": 30
}
```

---

## XVIII. GESTURES & INTERACTIONS

### 18.1 Home Screen Card Gestures 👤
| Gesture | Action | Description |
|---------|--------|-------------|
| Tap | Primary action | Log the habit (if ready) |
| Double Tap | Link action | Open primary link (phone, URL) |
| Long Press | Edit | Opens Detail sheet |
| Swipe Left/Right | Actions row | Shows pin, snooze, delete |

### 18.2 Swipe Actions 👤
When you swipe a card left or right, the following action buttons appear:

**Left Swipe Actions:**

| Icon | Action | Key | Condition | Description |
|------|--------|-----|-----------|-------------|
| 📌 | Pin/Unpin | `pin` | Non-minimal mode | Stays at top of lists |
| 🧪✅ | Keep | `keep` | When `sample: true` | Confirms sample habit |
| 🕒 | Activity | `activity` | Non-minimal mode | View log history |
| ▶️/⏹️ | Session | `timer` | Non-minimal mode | Start/stop timer |

**Right Swipe Actions:**

| Icon | Action | Key | Condition | Description |
|------|--------|-----|-----------|-------------|
| 🌙 | Snooze | `snooze` | Non-minimal mode | Hide until chosen time |
| 🗑️ | Remove | `nuke` | Always | Delete habit (with confirm) |

**Minimal Mode Differences:**
- Pin, snooze, activity buttons are **disabled**
- Only `keep` (samples) and `remove` are available
- Timer is also disabled in minimal mode

**Tap vs Double Tap:**
- Single tap: Log the habit (pulse button)
- Double tap: If habit has a link, trigger primary link action

### 18.3 Main Tap Actions (Pulse Button) 👤

| Habit Type | Tap Does | Double Tap Does |
|------------|----------|-----------------|
| keepup | Add log entry | Open link if present |
| reduce | Add log entry | Open link if present |
| zero | Reset timer (avoid doing) | Open link if present |
| task | Mark complete | Open link if present |

### 18.4 Agenda Drag Handle 👨‍💻
- Appears as ⋮⋮ (grip icon) on agenda cards
- Only in non-minimal mode
- Allows manual reordering within agenda
- Uses `isAgendaFillDraggable()` check

### 18.5 Swiper Mechanics 👨‍💻
| Constant | Value | Description |
|----------|-------|-------------|
| `SWIPE_THRESHOLD` | 60px | Minimum drag distance before reveal |
| `SWIPE_ACTION_WIDTH` | 68px | Width of each action button |
| `TAP_DELAY` | 310ms | Double-tap detection window |

### 18.6 Reach Assist 👤
- Pull down on the screen to scroll to top
- `reachAssist: true` by default
- Helps users reach cards at the bottom of long lists

### 18.7 Keyboard Shortcuts 👤
| Key | Action | Notes |
|-----|--------|-------|
| `/` | Focus search | Type while search open |
| Any single char | Add to search | When search is open and focused |
| `Enter` | Save form | In add/edit sheets |
| `Enter` | Complete task | In add sheet |
| `Tab` | Next field | Standard form navigation |
| `Shift+Tab` | Previous field | Standard form navigation |

**Note:** This is a PWA with limited shortcuts. Most interactions are touch-based.

---

## XIX. FILE STRUCTURE & MODULES

### 19.1 JavaScript Modules (js/)

| File | Lines | Purpose |
|------|-------|---------|
| **config.js** | 324 | Constants, sort presets, default settings |
| **data.js** | 3554 | Data models (JSDoc typedefs), storage, normalization |
| **scoring.js** | 908 | Attention score, urgency, tone/color mapping |
| **main.js** | 3100 | App initialization, state management, event handling |
| **list-view.js** | 5680 | Home screen rendering, habit card list |
| **detail-view.js** | 1881 | Detail sheet with tabs (about, insight, schedule, etc.) |
| **today-view.js** | 5685 | Today agenda rendering & timeline |
| **overview-view.js** | 1213 | Calendar heatmap and week views |
| **settings.js** | 2312 | Settings sheet, form rendering, preferences |
| **locations.js** | 1059 | Location registry, geolocation, travel time |
| **reminders.js** | 256 | Local reminder scheduling |
| **push-client.js** | 139 | Web Push subscription management |
| **calendar-import.js** | 548 | Microsoft Graph & Google Calendar import |
| **prayer-times.js** | 549 | Islamic prayer time calculation |
| **agenda-optimizer.js** | 1756 | ILP optimizer (lazy-loads GLPK) |
| **agenda-order.js** | 774 | Agenda packing algorithm |
| **agenda-planner-worker.js** | 209 | Web Worker for planning |
| **emoji-suggest.js** | 702 | Emoji suggestions from habit names |
| **shell-ui.js** | 1163 | Sheet/tab navigation, UI shell |
| **storage.js** | 48 | localStorage wrapper |
| **viewport.js** | 110 | Responsive layout breakpoints |

### 19.2 HTML Structure (index.html)
Main sheet containers:
- `#add-sheet` - New habit creation
- `#detail-sheet` - Habit editing
- Today sheet (added dynamically)
- Settings sections

---

## XX. MINIMAL MODE DETAILED BEHAVIOR

### 20.1 Home Screen Changes
When `minimalMode: true`:

**Regular Home:**
```
[ All Sections: Today | Overdue | Coming Up ]
- Calendar strip (14 days)
- All agenda items
- Status indicators
- Time windows
- Topics chips
- Order pills
```

**Minimal Home:**
```
[ Grouped Sections ]
- Today (only items due/planning today)
- Overdue (items behind schedule)  
- Coming Up (future due items)
- Hidden: Calendar, detailed scheduling
```

### 20.2 Agenda Changes
Same agenda logic, but simplified display:
- Events at times
- Habits fill remaining slots
- Less visual detail per item

### 20.3 Calendar Changes
- No full month heatmap
- No day-by-day planning
- Week strip only

### 20.4 Detail Sheet Changes
- Fewer tabs visible
- Simplified scheduling UI
- Basic info only

---

## XXI. COMPLETE SETTINGS FIELD REFERENCE

### 21.1 All Settings Fields (100+ total) 👤👨‍💻

#### Display & UI Settings 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `preset` | string | 'todayFirst' | Active sort preset name |
| `minimalMode` | boolean | true | Simplified UI for new users |
| `themeMode` | string | 'system' | light/dark/system |
| `fontScale` | string | 'medium' | small/medium/large |
| `compactMode` | boolean | true | Square card layout |
| `showWeekOnHome` | boolean | true | Week plan strip on home |
| `homeExtraMode` | string | 'cards12h' | How blocked times display on home |
| `reachAssist` | boolean | true | Pull-down to scroll to top |

#### Card Display Options (17 settings) 👤
| Field | Default | Description | Symbol |
|-------|---------|-------------|--------|
| showSnoozed | false | Show snoozed items (faded) | Dimmed card |
| showSampleOnCards | true | 🧪 sample marker | 🧪 |
| showPinnedOnCards | true | 📌 pinned marker | 📌 |
| showPlansOnCards | true | 📅 planned future log | 📅 |
| showTaskDateOnCards | true | Due date for tasks | Date chip |
| showDayScheduleOnCards | true | Schedule link chips | ↗️↘️ chips |
| showTimeWindowOnCards | false | 🕐 time window | 🕐 |
| showSnoozedUntilOnCards | true | Snooze countdown | "2h left" text |
| showDurationOnCards | false | ⏱️ session length | ⏱️ |
| showRepetitionOnCards | true | 1× rhythm display | "1×" text |
| showFlexibilityOnCards | false | Flexibility days | "±2d" text |
| showTopicsOnCards | false | 💡 topic chips | 💡 tags |
| showLocationOnCards | false | 📍 location pin | 📍 |
| showStatusOnCards | true | Status word | "run", "great", etc. |
| showAgendaTimesOnCards | **'time'** | 'show time' / 'symbol only' / 'hide' |
| showTrailOnCards | true | Activity dots history | ●●●●● dots |
| showCueOnCards | true | Status text below name | Colored text |

*Note: 2 card settings are controlled by tab visibility, not boolean toggles: `showOrderPillsOnCards` (depends on schedule links) and `showEarlyOnCards` (depends on agenda state).*

#### Sort Weights 👤
| Field | Type | Default | Preset-specific | Purpose |
|-------|------|---------|-----------------|---------|
| `focus` | string | 'balanced' | Yes | Focus mode (balanced/build/space) |
| `plansFirst` | boolean | true | Yes | Show planned items first |
| `planWindowDays` | number | 3 | Yes | Lookahead days for plan signals |
| `planWeight` | number | 120 | Yes | Weight for planned items |
| `dueWeight` | number | 140 | Yes | Weight for due urgency |
| `progressWeight` | number | 60 | Yes | Weight for progress score |
| `trendWeight` | number | 50 | Yes | Weight for trend score |
| `rhythmWeight` | number | 50 | Yes | Weight for rhythm score |
| `buildWeight` | number | 110 | Yes | Weight for build habits (keepup) |
| `limitWeight` | number | 80 | Yes | Weight for reduce habits |
| `stopWeight` | number | 110 | Yes | Weight for zero/stop habits |
| `newWeight` | number | 100 | Yes | Bonus for new habits |
| `locationWeight` | number | 80 | Yes | Location preference in scoring |

#### Sort Algorithm Settings 👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `newBuildMode` | string | 'gentle' | Build rise strategy |
| `dueMode` | string | 'relative' | Due calculation mode |
| `buildLookAheadDays` | number | 3 | Build anticipation window |
| `buildRiseAt` | number | 70 | Threshold to start rising |
| `limitMode` | string | 'overdue' | Reduce display mode |
| `stopMode` | string | 'watch' | Zero display mode |
| `rhythmBias` | number | 0 | Rhythm score adjustment |

#### Agenda Settings 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `agendaOptimizer` | boolean | true | Use ILP optimizer |
| `showScheduledTasksInAgenda` | boolean | true | Show event-timed tasks in agenda |
| `showDueTasksInAgenda` | boolean | true | Show due-date tasks in agenda |
| `showPlannedItemsInAgenda` | boolean | true | Show planned future logs |
| `showDueHabitsInAgenda` | boolean | true | Show due-rhythm habits |

#### Agenda Score Weights 👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `travel` | number | 1 | Per second of travel time |
| `cluster` | number | 1 | Per unit of co-location savings |
| `day` | number | 1 | Day-offset multiplier |
| `asap` | number | 0.12 | Per minute of clock delay |
| `scarce` | number | 0.05 | Per ms of scarce window overlap |
| `preference` | number | 1.5 | Multiplier on soft preferences |

#### Availability Settings 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `availabilityMinutes` | number[] | [400,200,200,200,200,200,400] | Daily capacity (Sun-Sat) |
| `availabilityOverrides` | object | {} | Date-specific capacity overrides |

#### Blocked Times 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `blockedTimes` | object[] | [{label:'sleep',days:[0-6],start:1380,end:300}] | Recurring unavailable blocks |
| `cancelledBlocks` | object | {} | Cancelled instances by date key |
| `blockedTimeOverrides` | object | {} | Modified capacity by date key |

#### Topics 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `topics` | string[] | [] | Master topic registry |

#### Locations 👤👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `locations` | Location[] | [] | Location registry |
| `travel` | object | {} | Cached travel time edges |
| `defaultTravelMode` | string | 'driving' | Default routing mode |
| `lastKnownLocationId` | string\|null | null | Auto-detected location ID |
| `locationOptIn` | boolean | false | Geolocation permission granted |
| `pinnedLocationId` | string\|null | null | Manually pinned location |

#### Prayer Times 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `homeCityName` | string | '' | City name for prayer times |
| `homeCityLat` | number\|null | null | Latitude |
| `homeCityLng` | number\|null | null | Longitude |
| `prayerMethod` | string | 'NorthAmerica' | Calculation method |
| `prayerMadhab` | string | 'shafi' | Asr calculation school |
| `prayerIslamicNames` | boolean | false | Use Islamic name labels |

#### Calendar Import 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `calendarCreditHabitId` | string\|null | null | Auto-log habit for meetings |
| `calendarAllDayMode` | string | 'skip' | All-day event handling |
| `importWindowDays` | number | 14 | Days ahead to import |
| `msGraphAuth` | object\|null | null | Microsoft auth state |
| `googleCalendarAuth` | object\|null | null | Google auth state |

#### Reminders & Push 👤👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `reminders` | boolean | false | Enable local notifications |
| `pushDetailed` | boolean | false | Rich notification content |
| `reachable` | boolean | false | 👨‍💻 Device has push subscription |

#### Retention 👤
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `completedTaskRetentionDays` | number | 7 | Days to keep done tasks |
| `habitLogKeepCount` | number | 30 | Max logs per habit (0=unlimited) |
| `lastRetentionCleanupAt` | number | 0 | Timestamp of last cleanup |

#### Default Habit Values 👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `defaultType` | string | 'keepup' | Type prefilled in add sheet (build/limit/stop/task) |
| `defaultTarget` | number | 7 | Default rhythm cycle (days) |
| `defaultPriority` | number | 2 | Default priority (P2) |
| `defaultDurationMinutes` | number | 30 | Default session length |
| `defaultFlexibilityDays` | number | 1 | Default flexibility for tasks |
| `defaultBreakable` | boolean | false | Default breakable setting |
| `defaultMinChunkMinutes` | number | 30 | Default minimum chunk |
| `defaultAutoMarkMinutes` | number\|null | null | Default auto-mark timeout |
| `defaultTopics` | string[] | [] | Topics applied to new habits |

#### Internal/Caching 👨‍💻
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `lastKnownLocationId` | string\|null | null | Auto-detected location |
| `_plannerRevision` | number | 0 | Planner cache busting |

---

## XXII. SORT PRESETS DETAILED

### 22.1 Today First (Default) 👤
- **Focus:** balanced
- **Plans First:** true
- **Plan Window:** 3 days
- Emphasizes items due today and recently planned

### 22.2 Balanced 👤
- **Focus:** balanced  
- **Plans First:** true
- **Plan Window:** 3 days
- Even mix of all score types

### 22.3 Build 👤
- **Focus:** build
- **Plans First:** true
- **Plan Window:** 3 days
- Emphasizes starting/maintaining build momentum

### 22.4 Planned 👤
- **Focus:** balanced
- **Plans First:** true
- **Plan Window:** 7 days
- Heavily emphasizes planned items

---

## XXIII. FOCUS MODES DETAILED

### 23.1 Balanced 👤
- Balanced focus on all habit types
- Standard urgency escalation
- Default recommendation

### 23.2 Build 👤
- Emphasizes habits that need starting/building
- Higher `buildWeight`, lower `limitWeight`
- Faster rise for build habits

### 23.3 Space 👤
- Emphasizes habits that create room (stop/reduce)
- Lower `buildWeight`, higher `stopWeight`
- Focus on making space in schedule

---

## XXIV. CALENDAR IMPORT PROVIDERS

### 24.1 Microsoft Graph (Outlook/M365) 👤
- Requires Microsoft account authentication
- Uses Microsoft Graph API v1.0
- Imports: Subject, Start/End times, All-day flag
- Updates: Pulls changes every app load
- Calendar sync is one-way (read-only)

### 24.2 Google Calendar 👤
- Requires Google account authentication
- Uses Google Calendar API v3
- Imports: Summary, Start/End times, All-day flag
- Same update cycle as Microsoft

### 24.3 Import Handling 👤
- Events become `task` type habits with `eventTime`
- All-day events: controlled by `calendarAllDayMode`
  - `skip`: Ignored
  - `tasks`: Converted to date-only tasks
- Imported habits get `externalId` from provider
- `source` field set to 'msgraph' or 'gcal'
- `importedAt` timestamp recorded

---

## XXV. LOCATION FEATURES DETAILED

### 25.1 Location Types 👤
| Type | Description |
|------|-------------|
| Manual | User-added addresses |
| Geofenced | Auto-detected via GPS |
| Pinned | User's current location pin |
| Home | `homeCityName` for prayer times |

### 25.2 Travel Modes 👤
| Mode | Distance | Use Case |
|------|----------|----------|
| driving | Longest | Car travel |
| walking | Moderate | On foot |
| bicycling | Shorter | Bike |
| transit | Variable | Public transport |

### 25.3 Location Fields in Habit 👤
| Field | Type | Purpose |
|-------|------|---------|
| `locationIds` | string[] | Allowed locations for habit |
| `locationPrefs` | object | Per-location preference (avoid/little/high) |
| `anywhereAllowed` | boolean | Can be done anywhere |
| `preferredLocationId` | string\|null | Preferred single location |

### 25.4 Location Preferences 👤
| Level | Score Modifier | Meaning |
|-------|----------------|---------|
| `avoid` | -40 | Penalize in scoring |
| `little` | +12 | Mild preference |
| `high` | +36 | Strong preference |

### 25.5 Travel Edge Cache 👨‍💻
- Key: `${a}:${b}:${mode}` where a < b lexicographically
- TTL: 30 days (`TRAVEL_TTL_MS`)
- Fallback: Haversine distance if routing fails
- Max: 1024 cached edges (`MAX_TRAVEL_EDGES`)

---

## XXVI. ERROR HANDLING & LIMITS

### 26.1 Storage Limits 👨‍💻
| Limit | Value | Error Message |
|-------|-------|---------------|
| Max habits | 300 (`MAX_TINGS`) | "300 habits max" |
| Max logs per habit | 500 (`MAX_LOGS`) | Logs truncated |
| Max locations | 32 (`MAX_LOCATIONS`) | Cannot add more |
| Max travel edges | 1024 | LRU eviction |
| localStorage quota warn | 4096 KB | Warning shown |
| localStorage quota hard | 4800 KB | App may break |

### 26.2 Input Limits 👤
| Field | Max Length |
|-------|-----------|
| Habit name | 60 characters |
| Emoji | 4 grapheme clusters |
| Notes | 200 characters |
| Topics | 24 total, 32 chars each |
| Location name | 48 characters |
| Location address | 120 characters |
| Rhythm times | 183 |
| Rhythm days | 183 |
| Flexibility days | 60 |
| Duration | 720 minutes |
| Min chunk | 720 minutes |
| Prayer offset | ±720 minutes |

---

## XXVII. EXTERNAL SERVICES

### 27.1 Maps & Routing 👨‍💻
| Service | URL | API Key Required |
|---------|-----|-----------------|
| OSRM (default) | `https://router.project-osrm.org` | No |
| Google Maps | Configurable | Yes (`MAPS_API_KEY`) |
| Nominatim (geocoding) | `https://nominatim.openstreetmap.org` | No |
| Photon (geocoding fallback) | `https://photon.komoot.io` | No |

### 27.2 Push Notifications 👨‍💻
| Service | URL | Description |
|---------|-----|-------------|
| Push Worker | `https://habits-push.YOUR-ACCOUNT.workers.dev` | Worker managing VAPID keys |
| VAPID Key | `YOUR_VAPID_PUBLIC_KEY_HERE` | Public key for push auth |

### 27.3 Calendar Providers 👨‍💻
| Provider | API | Auth Method |
|----------|-----|-------------|
| Microsoft Graph | Graph v1.0 | OAuth2 |
| Google Calendar | Calendar API v3 | OAuth2 |

### 27.4 Prayer Times Library 👨‍💻
- Uses `adhan` package for calculations
- Methods: `adhan.CalculationMethod` factory names
- Supports all major Islamic prayer time conventions

---

## XXVIII. HOW TO CONTEXT

### 28.1 User-Facing Language Style 👤
- Avoids technical terms (no "JSDoc", "ILP", "WGS84")
- Uses everyday metaphors ("today's bucket", "coming up")
- Focus on outcomes: "What will this do for me?"
- Action-oriented: "Tap", "Set", "Choose"

### 28.2 Developer Terminology 👨‍💻
- Full data model exposure with field names
- API contracts and storage keys documented
- Constants and limits explicitly listed
- Code comments and inline annotations

### 28.3 Marking Convention
- 👤 = User documentation only
- 👨‍💻 = Developer documentation only
- 👤👨‍💻 = Both user and developer audiences

---

*This skeleton covers all fields, symbols, and features. Each section marked with 👤/👨‍💻 indicates intended audience.*

---
**End of Skeleton Document**
