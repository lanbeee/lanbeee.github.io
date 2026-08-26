// Local storage, normalization, quota pruning, and date/text helpers.
//
// ─────────────────────────────────────────────────────────────────────────
// DATA SCHEMAS — JSDoc typedefs
// Source of truth for Habit and Settings shapes. Mirrors the normalize()
// output below. When porting to React Native, these become TypeScript
// interfaces in src/types/ with no field changes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single log entry. Either a bare timestamp (ms) for an actual occurrence,
 * a planned-future entry, or an enriched actual with optional numeric value
 * (e.g. weight), minutes (chunk progress on breakable items), and/or a
 * free-form text note. Day plans may carry `timed` (hard clock) and
 * `locationId` (one-day place override); plan-by (`planByDate`) is separate.
 * @typedef {(number|{ts:number,plan:true,timed?:true,locationId?:string}|{ts:number,value?:number,minutes?:number,note?:string})} LogEntry
 */

/**
 * A habit. Stored in the habits array under the `tings_v2` localStorage key.
 * The same record shape expresses all four item kinds via `type`; the fields
 * below marked with TaskFields only carry meaning for that type.
 * @typedef {Object} Habit
 * @property {string} hid                     — stable opaque id (crypto.randomUUID()), never user-displayed. Used by other habits' time anchors. Generated on first normalize; legacy records get one transparently.
 * @property {string} name                    — display name (max 60 chars)
 * @property {'keepup'|'reduce'|'zero'|'task'} type  — build / limit / stop / one-off
 * @property {number|null} target             — rhythm in days (may be fractional, e.g. 3.5 = 2×/7d); null when type in zero/task
 * @property {LogEntry[]} logs                — sorted actual + planned entries (max 500)
 * @property {string} emoji                   — grapheme cluster(s), '' means default icon
 * @property {string} emojiBgColor            — curated token for emoji icon background: ''|teal|amber|red|purple|blue|green
 * @property {boolean} pinned                 — stays above auto-sorted habits
 * @property {boolean} sample                 — true if created by the sort-lab sample builder
 * @property {number|null} snoozedUntil       — ms timestamp; habit hidden on home until then
 * @property {string[]} topics                — user-defined tags (max 24, each max 32 chars)
 * @property {number[]} allowedWeekdays       — 0=Sun … 6=Sat; empty means every day
 * @property {number[]} allowedMonthDays      — 1-31; empty means every day
 * @property {number[]} preferredWeekdays     — like allowedWeekdays, but for the "preferred" set
 * @property {number[]} preferredMonthDays    — like allowedMonthDays, but for the "preferred" set
 * @property {number|null} allowedTimeStart   — minutes since midnight; null = unrestricted
 * @property {number|null} allowedTimeEnd     — minutes since midnight; null = unrestricted
 * @property {number|null} preferredTimeStart — minutes since midnight; null = unrestricted
 * @property {number|null} preferredTimeEnd   — minutes since midnight; null = unrestricted
 *
 * — Prayer-time anchors (optional; mutually exclusive per-endpoint with the fixed minutes above) —
 * When `*Anchor` is set it overrides the matching fixed-minutes field for that endpoint, and the
 * resolved minute is computed from the habit's location for the current day (see js/prayer-times.js).
 * @property {string|null} allowedTimeStartAnchor   — 'fajr'|'sunrise'|'dhuhr'|'asr'|'maghrib'|'isha'|'habit'|null
 * @property {number}      allowedTimeStartOffsetMin — signed minutes vs the anchor (e.g. +60 = an hour after)
 * @property {string|null} allowedTimeEndAnchor
 * @property {number}      allowedTimeEndOffsetMin
 * @property {string|null} preferredTimeStartAnchor
 * @property {number}      preferredTimeStartOffsetMin
 * @property {string|null} preferredTimeEndAnchor
 * @property {number}      preferredTimeEndOffsetMin
 *
 * — Persistent planner order (optional; recurring, unlike drag reorder) —
 * @property {ScheduleLink[]} scheduleLinks   — OR list of before/after relationships; any number
 *
 * — Habit-relative anchors (optional; only meaningful when *Anchor = 'habit') —
 * When an anchor field is set to 'habit', the matching *AnchorHabitId references another habit's
 * stable `hid`. The endpoint resolves to that habit's most-recent log time + the signed offset,
 * with one rule that prevents re-firing: if THIS habit's own last log is on/after the anchor
 * habit's last log, the window collapses (the anchor has already been "consumed"). See js/prayer-times.js.
 * @property {string|null} allowedTimeStartAnchorHabitId
 * @property {string|null} allowedTimeEndAnchorHabitId
 * @property {string|null} preferredTimeStartAnchorHabitId
 * @property {string|null} preferredTimeEndAnchorHabitId
 *
 * — Combined expressions (optional; "later of" / "earlier of" two anchors) —
 * When `*Combine` is 'later' or 'earlier' and `*Anchor2` is set, the endpoint resolves to
 * max/min of the primary and secondary expressions. `*DayOffset` / `*DayOffset2` are 0 or 1
 * (next calendar day) so "sunrise − 8h +1d" means tonight relative to tomorrow's sunrise.
 * @property {'later'|'earlier'|null} allowedTimeStartCombine
 * @property {string|null} allowedTimeStartAnchor2
 * @property {number}      allowedTimeStartOffsetMin2
 * @property {string|null} allowedTimeStartAnchorHabitId2
 * @property {number|null} allowedTimeStartFixedMin2 — minutes 0..1439 when Anchor2 === 'fixed'
 * @property {number}      allowedTimeStartDayOffset
 * @property {number}      allowedTimeStartDayOffset2
 * @property {'later'|'earlier'|null} allowedTimeEndCombine
 * @property {string|null} allowedTimeEndAnchor2
 * @property {number}      allowedTimeEndOffsetMin2
 * @property {string|null} allowedTimeEndAnchorHabitId2
 * @property {number|null} allowedTimeEndFixedMin2
 * @property {number}      allowedTimeEndDayOffset
 * @property {number}      allowedTimeEndDayOffset2
 * @property {'later'|'earlier'|null} preferredTimeStartCombine
 * @property {string|null} preferredTimeStartAnchor2
 * @property {number}      preferredTimeStartOffsetMin2
 * @property {string|null} preferredTimeStartAnchorHabitId2
 * @property {number|null} preferredTimeStartFixedMin2
 * @property {number}      preferredTimeStartDayOffset
 * @property {number}      preferredTimeStartDayOffset2
 * @property {'later'|'earlier'|null} preferredTimeEndCombine
 * @property {string|null} preferredTimeEndAnchor2
 * @property {number}      preferredTimeEndOffsetMin2
 * @property {string|null} preferredTimeEndAnchorHabitId2
 * @property {number|null} preferredTimeEndFixedMin2
 * @property {number}      preferredTimeEndDayOffset
 * @property {number}      preferredTimeEndDayOffset2
 * @property {number} flexibilityDays         — buffer added to (or subtracted from) target; 0-60. For tasks: days-before-due it starts surfacing.
 * @property {number} durationMinutes         — planned session length; 1-720
 * @property {boolean} breakable              — when true, planner may split work across sessions; prefers one continuous run of remaining duration, and never schedules a split piece below minChunkMinutes (except a finish-up when remaining < min). Keepup/reduce: fresh duration budget each rhythm day. Tasks: one-shot pool across the week until logged minutes cover duration.
 * @property {number} minChunkMinutes         — hard minimum session length when splitting a breakable item; 15-720. Not a preferred/suggested chunk size.
 * @property {number|null} timerAutoStopMinutes — optional manual-session target (legacy field name; null = use durationMinutes)
 * @property {number|null} autoMarkMinutes — null = manual. Non-breakables complete after their trigger plus this delay; breakables reconcile captured agenda chunks after their end plus this delay.
 * @property {boolean} trackValue             — when true, logging offers a free-form numeric value field
 * @property {number} priority                — 0 (P0 critical) .. 5 (P5 someday). Manual; drives who claims today's agenda capacity first.
 * @property {number|null} lastLog            — derived: most recent actual log timestamp
 * @property {number|null} createdAt          — ms timestamp set at creation; secondary sort key + "added Nd ago" copy. null on legacy records.
 * @property {number|null} planByDate         — keepup/reduce only: one-off soft "do by" day (ms day-start). Week planner may place it any day on/before this date; cleared on the next actual log. null = none.
 * @property {string|null} externalId         — stable id from an external calendar/PDF import; null for Tings-native items. Used to de-dupe on re-import.
 * @property {'pdf'|'msgraph'|'gcal'|null} source — which importer produced this row; null for Tings-native items.
 * @property {number|null} importedAt         — ms timestamp of last import overwrite; null when not imported.
 *
 * — TaskFields (additional semantics when type === 'task') —
 * @property {number|null} dueDate            — ms day-level timestamp, or null for a "someday" task
 * @property {number|null} eventTime          — ms timestamp at the exact minute when this task is scheduled; null = no fixed time (dated or someday)
 * @property {boolean} hardDue                — computed: true when dueDate is set and flexibilityDays is 0 (firm deadline, escalates urgency past it)
 *
 * — LocationFields (optional, on every type) —
 * @property {string[]} locationIds           — selected allowed/preferred Location ids
 * @property {boolean} anywhereAllowed         — may also be done outside selected places
 * @property {Object<string,'avoid'|'little'|'high'>} locationPrefs — soft preference among allowed ids
 * @property {string|null} preferredLocationId — legacy single preferred (migrated into locationPrefs.high); kept for reads
 * @property {{weekdays:number[],start:number,end:number,locationId:string|null}[]} scheduleOptions — alternative habit-level weekday/time/place windows; duplicate locations are allowed
 *
 * — LinkFields (optional, on every type) —
 * @property {{kind:'phone'|'whatsapp'|'facetime'|'app'|'link',value:string,label?:string}[]} links — things to launch when doing this; app shortcuts may have a custom label; links[0] is primary and fires on card double tap
 */

/**
 * A recurring planner relationship, stored from the subject habit's point of
 * view. Direct links allow required travel/fixed blocks, but no movable card.
 * Multiple links on one subject are OR'd: plan with whichever partner lands
 * that day. A subject may be right-after several anchors; one anchor may have
 * only one right-after successor.
 * `requireSameDay` means must-do on days with the partner (pull + require when
 * the partner is present); other days stay unconstrained.
 * @typedef {Object} ScheduleLink
 * @property {string} anchorHid
 * @property {'before'|'after'} direction
 * @property {'sometime'|'direct'} adjacency
 * @property {boolean} requireSameDay
 */

/**
 * App-wide sort/display settings. Stored under `tings_app_settings_v2`.
 * Composed from SORT_PRESETS[preset] plus the fields below.
 * @typedef {Object} Settings
 * @property {'balanced'|'build'|'planned'|'todayFirst'|'custom'} preset
 * @property {'balanced'|'build'|'space'} focus                 — inherited from the preset
 * @property {boolean} plansFirst                              — let planned habits rise
 * @property {number} planWindowDays                           — 1-14, look-ahead for plan signal
 * @property {number} planWeight                               — 0-200, multiplies plan signal
 * @property {number} dueWeight                                — 0-200
 * @property {number} progressWeight                           — 0-200
 * @property {number} trendWeight                              — 0-200
 * @property {number} rhythmWeight                             — 0-200
 * @property {number} buildWeight                              — 0-200, scales build-type habits
 * @property {number} limitWeight                              — 0-200, scales limit-type habits
 * @property {number} stopWeight                               — 0-200, scales stop-type habits
 * @property {number} newWeight                                — 0-200, scales never-logged habits
 * @property {'quiet'|'gentle'|'rise'} newBuildMode            — handling for new build habits
 * @property {'relative'|'date'|'short'} dueMode               — how build-habit urgency is computed
 * @property {number} buildLookAheadDays                       — 1-14
 * @property {number} buildRiseAt                              — 40-110, urgency % where build habits rise
 * @property {'quiet'|'overdue'|'near'|'active'} limitMode    — limit-habit policy selector
 * @property {'quiet'|'watch'|'recent'|'active'} stopMode      — stop-habit policy selector
 * @property {number} rhythmBias                               — -100 to 100, favours shorter or longer rhythms
 * @property {boolean} showSnoozed                             — render snoozed habits faded on home
 * @property {boolean} showSampleOnCards                       — show sample marker chip on home cards
 * @property {boolean} showPinnedOnCards                       — show pinned chip on home cards
 * @property {boolean} showTaskDateOnCards                     — show task due/scheduled chip on home cards
 * @property {boolean} showPlansOnCards                        — show planned-entry chip on home cards
 * @property {boolean} showDayScheduleOnCards                  — show weekday/monthday schedule chip on home cards
 * @property {boolean} showTimeWindowOnCards                   — show time-window chip on home cards
 * @property {boolean} showSnoozedUntilOnCards                 — show snoozed-until chip on home cards
 * @property {boolean} showDurationOnCards                     — show duration chip on home cards
 * @property {boolean} showRepetitionOnCards                   — show rhythm chip on home cards
 * @property {boolean} showFlexibilityOnCards                  — show flexibility chip on home cards
 * @property {boolean} showTopicsOnCards                       — show topic labels on home cards
 * @property {boolean} showLocationOnCards                     — show location pin labels on home cards
 * @property {string} showAgendaTimesOnCards                   — agenda time on home cards: 'time' | 'icon' | 'hide'
 * @property {boolean} showTrailOnCards                        — show two-week activity dots on home cards
 * @property {boolean} showCueOnCards                          — show one-line status on home cards
 * @property {boolean} showOrderPillsOnCards                   — show before/after, doing-now, linked marks on home cards
 * @property {boolean} minimalMode                             — visual-only: emoji/title/cue/repetition on cards; stripped detail & overview
 * @property {boolean} showScheduledTasksInAgenda              — include fixed-time tasks in Today agenda
 * @property {boolean} showDueTasksInAgenda                    — include untimed tasks due today in Today agenda
 * @property {boolean} showPlannedItemsInAgenda                — include planned-today items in Today agenda
 * @property {boolean} showDueHabitsInAgenda                   — include ready habits in Today agenda
 * @property {boolean} showWeekOnHome                          — day-by-day week plan on home
 * @property {boolean} agendaOptimizer                         — default ILP packer for tight windows (lazy GLPK)
 * @property {{travel:number,cluster:number,day:number,asap:number,scarce:number,preference:number}} agendaScoreWeights — unified placement score weights
 * @property {boolean} reachAssist                             — pull-down-at-top gesture lowers first cards
 * @property {'keepup'|'reduce'|'zero'} defaultType            — type prefilled in the add-habit sheet
 * @property {number} defaultTarget                            — rhythm prefilled in the add-habit sheet
 * @property {string[]} topics                                 — master topic list (max 24)
 * @property {Location[]} locations                            — master location registry (max 32)
 * @property {Object<string,TravelEdge>} travel                — cached travel edges, keyed "idA|idB" (lexically ordered)
 * @property {'driving'|'walking'|'bicycling'|'transit'} defaultTravelMode — mode used for travel-time lookups
 * @property {string} prayerMethod                          — adhan.CalculationMethod key (default 'NorthAmerica')
 * @property {'shafi'|'hanafi'} prayerMadhab                — Asr school (default 'shafi')
 * @property {string|null} lastKnownLocationId                 — matched location id from the last geolocation fix (never stores raw coords)
 * @property {boolean} locationOptIn                           — user granted geolocation; used to resume watch on launch
 * @property {string|null} pinnedLocationId                    — manually-pinned "I am at" id; takes precedence over auto detection so a manual pick isn't immediately overwritten by the next GPS fix
 * @property {number[]} availabilityMinutes                    — legacy weekly minutes (Sun-Sat); unused for packing (default is full day / overrides)
 * @property {Object<string,number>} availabilityOverrides     — 'YYYY-MM-DD' -> minutes; wins over weekly
 * @property {{label:string,days:number[],start:number,end:number,locationId:?string,startAnchor:?string,startOffsetMin:number,startCombine:?string,startAnchor2:?string,startOffsetMin2:number,startFixedMin2:?number,startDayOffset:number,startDayOffset2:number,endAnchor:?string,endOffsetMin:number,endCombine:?string,endAnchor2:?string,endOffsetMin2:number,endFixedMin2:?number,endDayOffset:number,endDayOffset2:number}[]} blockedTimes — recurring unavailable blocks. Anchor fields mirror habits (prayer + fixed secondary; later/earlier-of + +1d supported).
 * @property {Object<string,string[]>} cancelledBlocks — day-key → cancelled block signatures for that date only
 * @property {string|null} calendarCreditHabitId — breakable habit hid that receives imported meeting minutes as progress credit; null = none
 * @property {'skip'|'tasks'} calendarAllDayMode — how PDF/calendar all-day events are imported: skip them, or land as dated untimed tasks
 * @property {2|3|7} completedTaskRetentionDays — auto-delete completed tasks older than this many days
 * @property {0|12|30|60} habitLogKeepCount — keep newest N actual logs per non-task habit (0 = off)
 * @property {number} lastRetentionCleanupAt — ms timestamp of last monthly auto cleanup (0 = never)
 */

/**
 * Day-of-week + day-of-month schedule pair returned by scheduledDays()/preferredDays().
 * Empty arrays mean "no restriction in this dimension".
 * @typedef {Object} DaySchedule
 * @property {number[]} weekdays    — 0=Sun … 6=Sat
 * @property {number[]} monthDays   — 1-31
 */

/**
 * A physical location. Entries live in the `locations` array on Settings.
 * Habits reference these by `id` via their `locationIds` field. The hours
 * fields reuse the exact encoding habits already use (minutes-from-midnight;
 * `allowedTimeEnd <= allowedTimeStart` means an overnight wrap). A location
 * with no hours fields is treated as open 24h every day.
 * @typedef {Object} Location
 * @property {string} id                    — stable opaque id, never user-displayed
 * @property {string} name                  — display name ("Home"), max 48 chars
 * @property {string} address               — optional human address, max 120 chars ('' when none)
 * @property {number} lat                   — WGS84 latitude, -90..90
 * @property {number} lng                   — WGS84 longitude, -180..180
 * @property {number} radiusM               — geofence radius in metres for "you are here" matching
 * @property {string} emoji                 — optional pin emoji ('' when none)
 * @property {number|null} allowedTimeStart — minutes-from-midnight, open-window start (null = no window / 24h)
 * @property {number|null} allowedTimeEnd   — minutes-from-midnight, open-window end (null = no window / 24h)
 * @property {number|null} preferredTimeStart — soft hint: best arrival-time start
 * @property {number|null} preferredTimeEnd   — soft hint: best arrival-time end
 * @property {number[]} closedDays          — weekday numbers (0=Sun..6=Sat) entirely closed, [] = none
 * @property {Object<string,{start:number,end:number}|null>} hoursByDay — per-weekday override {0..6:{start,end}|null}; absent day falls back to the default window
 */

/**
 * Cached travel time + distance between two locations. Stored in the `travel`
 * map on Settings, keyed `"${a}|${b}"` with the two ids lexically ordered so
 * A→B and B→A hit the same edge (routing is assumed symmetric in v1).
 * @typedef {Object} TravelEdge
 * @property {string} a          — location id (lexically smaller of the pair)
 * @property {string} b          — location id (lexically larger of the pair)
 * @property {number} seconds    — travel time in seconds
 * @property {number} metres     — travel distance in metres
 * @property {'osrm'|'google'|'haversine'|'manual'} provider — which provider produced this edge (manual = user override)
 * @property {number} fetchedAt  — ms timestamp of the fetch (used for TTL)
 */
