---
story: Delete Mode
created: 2026-09-17
---

## Description

A row currently carries its own trash control, and it earns its place badly: it is one more
thing to read past on every line, it is easy to hit by accident next to the name, and it
only ever deletes one task at a time.

Remove it. Deleting becomes a mode: the user chooses "Delete tasks" from the menu, the list
switches to selection, they tap the tasks they want gone, and one Delete removes the lot
after one confirmation. In normal mode a row is a tick and a name and nothing else.

## Acceptance Criteria

**Normal mode**

- A row has no delete control. The row is the tick and the name.
- The menu gains a "Delete tasks" item. It is only offered when the list has at least one
  task shown.

**Delete mode**

- Choosing "Delete tasks" puts the list in delete mode and closes the menu. Every task
  currently shown — completed ones included, if the Completed toggle is on — can be selected.
- Tapping anywhere on a row toggles its selection. In delete mode the name does not open the
  form and the tick does not complete or reopen; nothing but selection happens on the list.
- A selected row is visibly marked, in a way that survives every row background colour, and
  carries a screen-reader-only "selected".
- The `+` FAB is replaced by an action bar fixed to the bottom of the viewport with a count
  ("3 selected"), a Delete button in the danger style and a Cancel button. Delete is
  disabled at zero selected.
- Delete asks once for the whole batch through the existing confirm dialog ("Delete 3
  tasks?"), cancel first. Confirming removes every selected task from the list at once and
  leaves delete mode.
- Cancel, Escape, or a navigation away leaves delete mode with nothing deleted and the
  selection cleared.
- Leaving delete mode restores the FAB and normal row behaviour.

**Offline**

- The batch delete applies to the device immediately, queues one `delete` per task in the
  outbox, and survives a reload. A `local-` task that was never synced is simply dropped
  from the queue, as a single delete is today.
- Each queued delete follows the existing failure policy in `docs/system.md` — a `404` on
  sync reconciles locally, nothing else about sync changes.
