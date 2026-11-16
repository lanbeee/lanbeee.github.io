# Week calendar behavior

The calendar reads the shared planner output. Viewing it, changing its display,
filtering, and canceling an editor do not reschedule or change saved items.
The planning horizon is today through thirteen days ahead. The second week is
labeled Preview because earlier completions can change its placements.

## Display

Phones offer one, two, or three equally wide days. Wide screens also offer a
seven-day week. There is one row of dates for the visible columns; single-day
view puts its date in the title. Today returns to the current day and scrolls
to the current time. Arrows advance the displayed days within the horizon.
Horizontal swipes and left/right keys move the selected day. Vertical gestures
scroll without selecting or creating anything.

Agenda compresses quiet hours. When multiple days are visible, every column
uses the same elastic clock: the same time always has the same vertical
position. Short rows on any visible day reserve readable space on the common
scale. Overlapping events occupy separate lanes rather than hiding each other.
Single-day agenda can expand a long free gap to show its duration at full scale.
Grid uses a proportional 24-hour clock and starts at 150% zoom. Display options
include zoom in/out; changing zoom keeps the time at the viewport center stable.

Display options also include Color by: topic, location, type, when due, or
priority. Type, timing, and priority use the same classifiers as Filters. When
due is relative to today. Topic and location use the first saved value; items
without one use a neutral group. The legend explains the current grouping.
Colors, view, zoom, and phone/desktop day counts are remembered on this device.
Filters remain shared with the calendar overview. Busy time remains visible.

## Taps and return behavior

| Target | Result |
| --- | --- |
| Habit, task, or event | Open the saved item's detail screen. A planned occurrence does not complete or move just because it was tapped. |
| Busy block | Open its existing editor, with the existing occurrence/series choices. |
| Travel between saved places | Open the existing travel editor. |
| Travel from live GPS | Open directions to its destination. |
| Deadline or plan-by marker | Open the saved item's detail screen. |
| Not scheduled item | Open its detail screen without inventing a start time. |
| Date header | Open day details and actions without repeating the agenda shown in the calendar. |
| Empty space in Grid or a multi-day Agenda | Stage a new task at that date and time, rounded to the nearest 15 minutes. Save remains explicit and opens the new task’s schedule, following the existing add flow. |
| Add | Stage a new task on the selected day, with its start time left open. |
| Long free gap in single-day Agenda | Expand or collapse the gap; do not create an item. |
| Display options | Reveal color, filter, and grid zoom controls without using schedule space while closed. |

Closing an editor returns to the same calendar, date selection, scroll position,
and tapped control where it still exists. Escape/Back closes the top editor
before the calendar. Closing the calendar releases its preview worker and timer. Leaving for
directions suspends background work; returning preserves the selected day and
resumes clock updates.
Unavailable previews show a retry action and stop the loading state.
Reopening restores display preferences, starts on today, and continues to react
to phone/desktop resizing.

The calendar switch opens the other calendar view. Closing either view returns to
Home; the calendar button reopens the last view used on this device.
