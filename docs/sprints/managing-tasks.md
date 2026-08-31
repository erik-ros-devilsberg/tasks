---
sprint: Managing Tasks
stories:
  - 07-complete-and-reopen-a-task
  - 08-create-and-edit-a-task
  - 09-delete-a-task
  - 10-completed-tasks
status: planned
created: 2026-08-31
---

## Goal

The list is read-only. This sprint makes it a task app: tick something off, write something
down, change your mind, throw it away, and look back at what you finished. It closes the
first working version.

Every write path already exists in `lib/tasksRemote.js` and `stores/tasks.js` — this sprint is
mostly the views that drive them, plus the one genuinely new piece of behaviour: a
confirmation modal that is properly keyboard-accessible.

## Acceptance Criteria

- [ ] Each row carries a checkbox that completes the task, with an accessible name including
      the task title.
- [ ] Completing sends no request body, and a double click neither errors nor changes the
      outcome.
- [ ] Reopening sends `PATCH { completed_at: null }` — never a field-dropping `PUT`.
- [ ] The store holds the server's returned record after either action, not a locally guessed
      one; a completed row leaves the open list.
- [ ] A failed complete or reopen leaves the row as it was and shows a message.
- [ ] `TaskFormView` serves both the create and the edit route, built from `.form` / `.field`.
- [ ] Fields are `title` (max 255), `notes` (multi-line), `due_at` (optional).
- [ ] The due date accepts a date alone or a date with a time, and sends the granularity
      chosen — a date-only entry is never promoted to a midnight datetime.
- [ ] Clearing the due date sends `null`.
- [ ] A blank title saves, and the server's "Untitled task" is what comes back and is shown.
      No client-side refusal.
- [ ] An unparseable date is treated as no date rather than blocking the save.
- [ ] Editing a completed task does not reopen it.
- [ ] After create the view returns to the list with the task present; after edit it returns
      with the change visible.
- [ ] A `422` shows the server's field messages against the fields, with the user's input
      still in the form.
- [ ] A network failure keeps the form populated so the user can retry.
- [ ] Delete is reachable from the row and the edit form, and opens the shared `.modal`
      naming the task — not a bare `confirm()`.
- [ ] The modal traps focus, closes on Escape and on a click outside, and returns focus to
      whatever opened it.
- [ ] `204` and `404` are both success for a delete; any other failure keeps the task and
      shows a message.
- [ ] Completed tasks are hidden by default, revealed by a real `<button>` whose accessible
      name reflects its state.
- [ ] Completed tasks render in their own section, `completed_at` descending, with the
      completion date shown, visually distinct by more than colour.
- [ ] A completed task can be reopened, edited and deleted from that section, reusing the same
      store actions — no second implementation.
- [ ] The show/hide preference survives a reload; a missing or corrupt stored value falls back
      to hidden rather than throwing.
- [ ] The views add no new CSS class beyond the shared inventory unless a pattern is genuinely
      absent.
- [ ] `npm test` and `npm run build` both pass.

## Tasks

- [ ] Write tests for completing and reopening from the list, including the double click and
      both failure rollbacks
- [ ] Implement the completion toggle in `TasksListView`
- [ ] Write tests for `TaskFormView`: create, blank title, both due granularities, clearing a
      date, unparseable date, editing a completed task without reopening it, `422` field
      errors, network failure retaining input
- [ ] Implement `src/views/TaskFormView.vue` and its two routes
- [ ] Write tests for `ConfirmModal`: Escape, click-outside, focus trap, focus restored
- [ ] Implement `src/components/ConfirmModal.vue`
- [ ] Write tests for delete from the row and from the form, covering `204`, `404` and `5xx`
- [ ] Wire delete into both views
- [ ] Write tests for the completed section: hidden by default, ordering, preference
      persistence, corrupt stored value, reopening from there
- [ ] Implement the completed section and its persisted preference

## Risks and Open Questions

- **The `due_at` granularity round-trip is the subtlest thing here.** `<input type="date">`
  and `<input type="datetime-local">` produce different strings, and a datetime-local value is
  local wall-clock time that must be converted to UTC before sending — while a date-only value
  must be sent through untouched. Two inputs with a toggle is clearer than one input guessing.
- A `422` on `title` is unlikely given the server defaults blank titles, but `max:255` can
  still reject. The field-error path must exist even if it is rarely hit.
- Focus restoration after the modal closes needs a real element reference; jsdom will report
  `document.activeElement` correctly, so this is testable rather than hand-waved.
- `localStorage` can throw in private browsing. The preference read must be wrapped, per the
  "corrupt value falls back to hidden" criterion.
