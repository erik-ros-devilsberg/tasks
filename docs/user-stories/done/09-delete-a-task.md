---
story: Delete a Task
created: 2026-08-31
---

## Description

Removing a task for good. Destructive and unrecoverable — the server keeps no trash — so it
is confirmed before it happens, but the confirmation is one keystroke to dismiss.

## Acceptance Criteria

- A delete action is reachable from the task row and from the edit form.
- Deleting opens the shared `.modal` confirmation naming the task, not a bare `confirm()`.
- The modal is keyboard-navigable: Escape closes, a click outside closes, and focus is
  trapped while it is open.
- Confirming calls `DELETE /tasks/{id}` and treats `204` as success.
- A `404` is treated as success — the task is already gone, and telling the user otherwise is
  a refusal with no purpose.
- Any other failure leaves the task in the list and shows a non-fatal message.
- After a successful delete the view returns to the list with the task absent.
- Tests cover: confirm-then-delete, cancel leaving the task untouched, Escape and
  click-outside closing the modal, `204` and `404` both treated as success, and a `5xx`
  retaining the task with a message.
