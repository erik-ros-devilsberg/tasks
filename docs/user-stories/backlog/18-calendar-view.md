---
story: Calendar View
created: 2026-09-17
---

## Description

A calendar view beside the list. It shows events from the server's `GET /events` and the
tasks that have a `due_at`, on one calendar, in day, week and month views.

Events are fixed: they sit at their `start_at` and their height is `end_at - start_at`.
Tasks are projected: a task has a date but never a time, so the calendar plans the tasks of
a day in sequence starting at **08:00**, each taking its `duration` (60 minutes when there is
no estimate). Tasks are never planned over events — an event from 10:00 to 11:00 means tasks
fill 08:00–10:00 and resume after the event ends.

Everything is in one time zone. Event timestamps are read the same way as `due_at` — literally,
never converted.

## Acceptance Criteria

**Events**

- Events come from `GET /events` as it is: `title`, `start_at`, `end_at`, `all_day`. The app
  does not assume the list holds only future events — historic ones are shown when present.
- Events are read-only in this app. Tapping one does nothing.
- Events are cached on the device like tasks so the calendar renders offline from the last
  pull. There is no outbox for events; nothing is ever written to `/events`.
- `start_at` and `end_at` are read literally, without time-zone conversion — the same rule
  `parseDue()` applies to `due_at`.
- There are no all-day events. `all_day` is ignored; every event sits on the hour grid at
  its `start_at`.

**Task projection**

- Only tasks with a `due_at` appear. `due_at` is treated as a date; if a value carries a
  time, only the date part is used.
- Every task is `duration` minutes long, 60 minutes when `duration` is `null`.
- Open tasks are projected forward from 08:00 in list order. A task never overlaps an
  event: when the next slot collides with an event, the task starts when that event ends.
  An open task never starts before 08:00.
- Completed tasks are projected backward from 08:00 — they are in the past, so they sit
  before the working day, the last completed one ending at 08:00. They are shown struck
  through, in the completed row colour.
- Tasks that run past midnight stay fully visible: the day column grows past the 24:00 line
  to fit them, and the day is marked as overloaded. This is the calendar's main signal —
  it must never be clipped or hidden.
- Tapping a task opens its edit form (`/tasks/{id}/edit`). Saving or deleting there returns
  to the calendar, and the projection reflects the change.

**Views**

- Three views: day, week, month. Week is the default. The last used view is remembered on
  the device and restored on the next visit.
- Day and week views have an hour grid. Entry height is proportional to duration for both
  events and tasks. Entry top is the start time.
- Month view lists the entries per day cell, in time order, without heights.
- Every view has previous / next / today navigation. Week starts on Monday.
- Overlapping entries in day and week view are stacked: the entry that starts later is drawn
  on top (higher z-order). No side-by-side columns.
- Today is visually marked in every view.

**Navigation**

- New route `/calendar`, behind the auth guard, with an entry in the nav menu. The list and
  the calendar link to each other.

**Offline**

- The calendar renders from local data and never waits on the network. Tasks created,
  edited, completed or deleted offline appear in the projection immediately.

**Styling**

- Brand classes and semantic tokens only, per §5. Row state colours reuse the app tokens
  (`--row-overdue`, `--row-today`, `--row-upcoming`, `--row-completed`). Additions in
  `app.css`, labelled.

**Tests**

- Projection is pure logic in `lib/` and is unit-tested: ordering, default duration, event
  avoidance, 08:00 start, completed tasks backward from 08:00, overflow past midnight,
  date-only handling of a datetime `due_at`.
- Events remote covers `401`, `5xx` and network drop; the calendar still renders from cache.
- View tests cover: default week view, the remembered view, tapping a task navigates to its
  form, struck-through completed tasks, z-order of overlapping entries, an overloaded day
  showing its overflow.
