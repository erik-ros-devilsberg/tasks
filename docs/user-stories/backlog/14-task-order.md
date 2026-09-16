---
story: Task Order
created: 2026-09-16
---

## Description

A task can carry an explicit position. The server is adding an `order` field to the task
resource — an optional integer, `null` when the task has no explicit position.

`order` becomes the first sort key for open tasks, ahead of `due_at`. Most tasks will never
get one, so the existing due-date ordering must keep working untouched for everything
without it: a handful of ordered tasks pinned to the top, the dated tail behind them exactly
as today, the undated remainder at the bottom.

Like `duration`, the field is captured on the create/edit form and has to be threaded
through every layer that carries `title`, `notes`, `due_at` and `duration` — in particular
`replace()`, since a `PUT` body that omits `order` wipes it.

## Acceptance Criteria

- `order` is an integer or `null`. Nothing else reaches the server.
- Open tasks sort in three bands, in this sequence:
  1. tasks with an `order`, ascending — the lowest number first;
  2. tasks without an `order` but with a `due_at`, soonest first — unchanged from today;
  3. tasks with neither, last.
- Within band 1, an equal `order` falls back to `due_at` (soonest first, undated last), then
  title. Within bands 2 and 3 the tie-breaks stay as they are.
- An ordered task with no due date still sits in band 1: `order` outranks `due_at`, so a
  missing date cannot demote it.
- An ordered task that is overdue keeps its overdue row colouring; the band only changes
  where it sits, not how it looks.
- The task form has an Order field that loads the stored value and saves the edited one. A
  blank field saves as `null`, and a task with no order renders the field blank rather than
  as `0`.
- Junk in the field does not block the save — it normalizes to `null`, per "minimize computer
  says no". A decimal rounds to the nearest integer.
- `tasksRemote.replace()` sends `order` in its complete body, so a full replacement cannot
  silently clear it.
- A create with an order, a PATCH that changes only the order, and a PATCH that clears it
  back to `null` all round-trip, online and through the outbox.
- Completing or reopening a task does not disturb its order. Completed tasks keep sorting by
  `completed_at`; `order` plays no part there.
