---
story: Task Order
created: 2026-09-16
---

## Description

A task can carry an explicit position. The server has an `order` field in the task
resource — an optional integer, `null` when the task has no explicit position.

`order` becomes the second sort key for open tasks, behind `due_at`. Most tasks will never
get one, so the existing due-date ordering must keep working untouched for everything
without it. The order of tasks within a date will be changed by the user. When a user 
drags a task to a position higher then a task with an earlier due date, the dragged task's due 
date will automatically update, same when moving the task down.

unlike `duration`, the field is NOT captured on the create/edit form. Instead, it will be 
updated by the user dragging the item up or down. The handle for the dragging are at the right 
end of the task row.

## Acceptance Criteria

- `order` is an integer or `null`. Nothing else reaches the server.
- Open tasks sort in three bands, in this sequence:
  1. tasks with an `order`, ascending — the lowest number first;
  2. tasks without an `order` but with a `due_at`, soonest first — unchanged from today;
  3. tasks with neither, last.
