# Week calendar behavior

The calendar reads the shared planner output. Viewing it, changing its display,
filtering, and canceling an editor do not reschedule or change saved items.
The planning horizon is today through thirteen days ahead. The second week is
labeled Preview because earlier completions can change its placements.

## Display

All screens offer one, two, or three equally wide days, or a seven-day Week.
Phones default to three days and desktop defaults to Week.
The sidebar also offers Month, opening the shared monthly overview at the
month being viewed and retaining the active filters. The calendar button
remembers Month when reopened. On desktop, the week calendar fills the browser
window, including the area normally occupied by the app bar.
That day count is how many days fit on screen. The days themselves
sit in one horizontal strip, so the user can scroll freely across them. When
that scroll settles, the strip lines up on a day, so a column is not left cut
in half. Today through thirteen days ahead are in that strip when it opens.
Date jumps place the chosen day at the left edge, including the end of the
planning horizon. Jumps into past years keep a bounded fourteen-day strip.
Today returns to
the current day and scrolls to the current time. Left and right keys move one
day. A touch drag locks to one axis: it either pans the day strip or scrolls
the clock, never both, so a diagonal swipe cannot slide the days while
scrolling time. When a horizontal drag settles, the strip eases onto
the nearest day, and only then does the date title update. Columns are not
highlighted; today is identified by its date and the current-time line. Background
preview updates wait for touch and momentum scrolling to settle before replacing
the board, so a late worker reply cannot interrupt a swipe.

Agenda compresses quiet hours. Every column uses the same elastic clock, including
when only one day fits on screen: the same time always has the same vertical
position. Hour labels and compact card times keep a meridiem (7a, 8p).
Day summaries use minutes and hours, such as “45m” or “2h 30m”. Marking an item done
rebuilds that clock and redraws the hour labels. Overlapping events occupy
separate lanes rather than hiding each other.
One, two, and three agenda days use flat cards. The card's own color carries
the group, so there is no side stripe. The emoji is the mark-done control.
On two or three days the name sits above the start time, and the time stays
even on a short block. Each day header adds one
short summary. A single day can also show free time, or that the day is tight.
A seven-day week stays compact.
Grid uses a proportional 24-hour clock and starts at 150% zoom. The Agenda/Grid
switch, the day count, color, filters, and grid zoom all live in the display
sidebar; changing zoom or switching layouts keeps the time at the
center of the usable viewport stable, accounting for the sticky date header.
Hour lines sit behind cards in both layouts. The left clock labels use 13px
text and a wider gutter for readability. Lines are painted as shared backgrounds
rather than individual elements per hour and day.
At the start or end of the clock, normal scroll limits still apply.

The date title opens a floating month picker without reducing schedule space.
Arrow keys move by day or week; Home/End move within the week, and Page Up/Down
change month. Escape closes the picker and returns focus to its title. Choosing
a date returns focus there too. Outside the planning horizon, recurring
appointments still respect date exceptions and continue across midnight.

The sidebar also includes Color by: topic, location, type, when due, or
priority. Type, timing, and priority use the same classifiers as Filters. When
due is relative to today. Topic and location use the first saved value; items
without one use a neutral group. The legend explains the current grouping.
Colors, view, zoom, and phone/desktop day counts are remembered on this device.
Filters remain shared with the calendar overview. Busy time remains visible.

## Taps and return behavior

| Target | Result |
| --- | --- |
| Emoji on an agenda card | Mark that planned habit or task done, then redraw the compressed clock. An appointment keeps its emoji and does not log. |
| Rest of a habit, task, or event | Open the saved item's detail screen. A planned occurrence does not complete or move just because the card was tapped. |
| Busy block | Open its existing editor, with the existing occurrence/series choices. |
| Travel between saved places | Open the existing travel editor. |
| Travel from live GPS | Open directions to its destination. |
| Deadline or plan-by marker | Open the saved item's detail screen. |
| Not scheduled item | Open its detail screen without inventing a start time. |
| Date title | Drop down a month. Choosing a day scrolls to it. The next two weeks use the planner. Other days show busy time and fixed appointments. |
| Date header | Open day details and actions without repeating the agenda shown in the calendar. |
| Empty space in Grid or a multi-day Agenda | Stage a new task at that date and time, rounded to the nearest 15 minutes. Save remains explicit and opens the new task’s schedule, following the existing add flow. |
| Add | Stage a new task on the selected day, with its start time left open. |
| Calendar options (menu) | Open an overlay sidebar without rebuilding or resizing the clock. Tap a view, day count, color, or filter directly to apply it and return to the calendar. Zoom stays open for repeated adjustments. Escape, system Back, the close button, and the backdrop dismiss the sidebar and restore menu focus. |
| Today (mini calendar in the header) | Return to the current day and scroll to the current time. The button always shows today's date. |

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
