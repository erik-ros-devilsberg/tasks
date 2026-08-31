---
story: Completed Tasks
created: 2026-08-31
---

## Description

Finished work should leave the open list but stay reachable — to confirm something was done,
or to reopen it. The last piece of the first working version.

## Acceptance Criteria

- The task list has a control to show completed tasks, which are hidden by default.
- Completed tasks render in their own section, sorted by `completed_at` descending, with the
  completion date shown.
- Completed rows are visually distinct from open ones by more than colour alone.
- A completed task can be reopened from here, returning it to the open list (story 07's
  reopen path — no second implementation).
- A completed task can be edited and deleted like any other, without reopening it.
- The show/hide choice persists across a reload in `localStorage`, and a missing or corrupt
  stored value falls back to hidden rather than throwing.
- The control is a real `<button>` with an accessible name reflecting its current state.
- Tests cover: hidden by default, toggling reveals the section in `completed_at` descending
  order, the preference surviving a reload, a corrupt stored value falling back to hidden, and
  reopening from this section returning the task to the open list.
