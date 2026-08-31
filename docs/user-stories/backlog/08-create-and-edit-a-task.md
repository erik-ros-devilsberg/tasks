---
story: Create and Edit a Task
created: 2026-08-31
---

## Description

One form for both, since the fields are identical: title, notes, due date. Creating posts;
editing updates in place.

The design principle here is the server's — minimize "computer says no". A blank title is not
an error, it is "Untitled task". An unparseable date is not a modal, it is no date. The user's
typing is never lost to validation.

## Acceptance Criteria

- `views/TaskFormView.vue` serves both create and edit routes, built from the shared `.form`
  and `.field` classes.
- Fields: `title` (max 255), `notes` (multi-line, optional), `due_at` (optional).
- The due date input allows a date alone or a date with a time, and the chosen granularity is
  what gets sent — a date-only entry must not be promoted to midnight datetime.
- Clearing the due date sends `null`.
- Saving a blank title is allowed and the server's "Untitled task" is what comes back and is
  displayed. No client-side refusal.
- An unparseable date is treated as no date rather than blocking the save.
- Editing sends `PATCH` with only the changed fields, or a `PUT` carrying a **complete** body
  including `completed_at`. Editing a completed task must not reopen it — this is the trap in
  `CLAUDE.md` §7 and needs its own test.
- After create, the view returns to the list with the new task present.
- After edit, the view returns to where the user came from with the change visible.
- A `422` shows the server's field messages against the fields, with everything the user typed
  still in the form.
- A network failure shows a non-fatal message and keeps the form populated so the user can
  retry.
- Tests cover: create with a full body, create with a blank title, both `due_at`
  granularities, clearing a due date, editing a completed task without reopening it, `422`
  field errors with input retained, and a network failure retaining input.
