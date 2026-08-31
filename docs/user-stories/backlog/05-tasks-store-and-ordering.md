---
story: Tasks Store and Ordering
created: 2026-08-31
---

## Description

The Pinia layer the views read, plus the ordering rules that decide what a task list looks
like. The store wraps `lib/tasksRemote.js` rather than importing it directly — the remote is
injected, which is the seam that keeps view tests fast and network-free.

Ordering is its own framework-free module so it can be tested without mounting anything. The
server returns tasks; deciding what "overdue" and "today" mean is the client's job.

## Acceptance Criteria

- `lib/taskSort.js` is framework-free and exports the ordering and grouping rules.
- A task is **open** when `completed_at` is `null` and **completed** otherwise. There is no
  `status` field — nothing in the app may invent one.
- A task is **overdue** when it is open and `due_at` is strictly in the past. A date-only
  `due_at` is overdue only after that whole day has passed, not from midnight UTC.
- Open tasks sort by `due_at` ascending, with undated tasks last and ties broken by `title`
  case-insensitively.
- Completed tasks sort by `completed_at` descending — most recently finished first.
- Grouping buckets open tasks into Overdue, Today, Upcoming and No due date, in that order.
  Empty buckets are omitted.
- `stores/tasks.js` is a Pinia setup store exposing `tasks`, `loading`, `error`, and the
  actions `load()`, `create()`, `update()`, `complete()`, `reopen()`, `remove()`.
- The remote is injected via a `useRemote(remote)` seam, not imported by the store. Views
  call `useTasksStore()` and never construct the remote themselves.
- `load()` sets `loading` before the request and clears it in a `finally`, so a failure never
  leaves a permanent spinner.
- A failed `load()` sets `error` and leaves any previously loaded tasks on screen rather than
  blanking the list.
- Tests call the store directly with `setActivePinia(createPinia())` and an injected fake
  remote — no component is mounted to test state.
- Tests cover every ordering and bucketing rule above, including the date-only overdue
  boundary and the undated-last tiebreak.
