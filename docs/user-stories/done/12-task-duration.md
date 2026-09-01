---
story: Task Duration
created: 2026-09-01
---

## Description

A task can carry an estimate of how long it will take. The server is adding a `duration`
field to the task resource — an optional integer number of minutes, `null` when unknown.

The field is captured on the create/edit form only. The list is not changing in this story;
the list and navigation redesign is a separate backlog item.

The field has to be threaded through every layer that already carries `title`, `notes` and
`due_at`, and in particular through `replace()` — `PUT` is a full replacement, so a body that
omits `duration` wipes it.

## Acceptance Criteria

- `duration` is an integer number of minutes, or `null`. Nothing else reaches the server.
- The task form has a Duration field, labelled in minutes, that loads the stored value and
  saves the edited one.
- A blank field saves as `null`, and a task with no duration renders the field blank rather
  than as `0`.
- Junk in the field does not block the save — it normalizes to `null`, per the project's
  "minimize computer says no" rule. A decimal rounds to the nearest minute; a negative value
  reads as no duration.
- `tasksRemote.replace()` sends `duration` in its complete body, so a full replacement cannot
  silently clear it.
- A create with a duration, a PATCH that changes only the duration, and a PATCH that clears
  it back to `null` all round-trip.
- Completing a task does not disturb its duration.
