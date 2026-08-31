---
story: Complete and Reopen a Task
created: 2026-08-31
---

## Description

Ticking something off is the whole point of a task app, so it has to be one click from the
list. Completing uses the server's dedicated no-body endpoint; reopening clears
`completed_at` via a partial update.

The list updates immediately and reconciles with the server's response — a user who cannot
tell whether the tick landed will click it twice.

## Acceptance Criteria

- Each row in the task list carries a checkbox or toggle that completes the task, with an
  accessible name that includes the task title.
- Completing calls `POST /tasks/{id}/complete` with **no request body**.
- Completing is idempotent — a double click does not error and does not create a second
  request that changes the result.
- Reopening sends `PATCH` with `completed_at: null`. It must not send a `PUT` that omits
  fields.
- The row leaves the open list as soon as the server confirms, and the store holds the
  server's returned record rather than a locally guessed one.
- A failed complete or reopen restores the previous state and shows a non-fatal message — the
  user is never left looking at a tick that did not save.
- A `401` during either action clears the session and routes to login.
- Tests cover: the complete request carries no body, double completion is safe, reopen sends
  `completed_at: null` via `PATCH`, the store takes the server's record, failure rolls the
  state back and surfaces a message, and `401` routes to login.
