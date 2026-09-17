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

**The field**

- `order` is an integer `>= 0` or `null`. Nothing else reaches the server.
- `order` never appears on the create/edit form. A new task is created with `order: null`.
- `tasksRemote.replace()` sends `order` in its complete body, so a full replacement cannot
  silently clear it. A save from the form leaves `order` exactly as it was.
- Completing, reopening or editing a task does not disturb its `order`.

**Sorting**

- Open tasks sort by due date first, soonest first, undated last — unchanged from today.
  `order` is the second key: within one date, tasks with an `order` come first, ascending;
  tasks without one follow, by title.
- The undated tail sorts the same way: `order` ascending, then title.
- Row colouring is unaffected: an overdue task stays red wherever `order` puts it.
- Completed tasks keep sorting by `completed_at`; `order` plays no part there.

**Dragging**

- Every open task row carries a drag handle at its right end, after the trash control. It
  is the only part of the row that starts a drag — the name still opens the form and the
  checkbox still completes.
- Dragging works with a mouse and with touch, since the app is installed on Android.
- Completed rows have no handle, cannot be dragged, and a drag cannot be dropped between
  them.
- While dragging, the list shows where the task will land. Dropping it outside the list, or
  pressing Escape, puts it back where it was and changes nothing.

**What a drop does**

- Dropped among tasks of its own date, the task takes its new position; `due_at` is untouched.
- Dropped among tasks of another date, the task takes that date.
- Dropped into the undated tail, a dated task loses its `due_at` (`null`).
- Dropped among dated tasks, an undated task gains that date.
- After the drop, the tasks of the destination date (or the undated tail) are renumbered
  `0..n` in the sequence shown. Every task whose number changed is saved with a `PATCH`
  of `order`; the dragged task's `PATCH` also carries `due_at` when its date changed.
- No `PATCH` from a drop ever carries `completed_at`.

**Offline and reconciliation**

- A drop applies to the device immediately and the list re-sorts without waiting on the
  network; the writes queue in the outbox as `update` operations and survive a reload.
- Dragging the same task twice offline coalesces to one queued update for that task.
- The user sees the order they made. The app reconciles with the server whenever it can,
  like every other write; after a pull the list shows what the server holds, so a reorder
  made on another device shows up here.
