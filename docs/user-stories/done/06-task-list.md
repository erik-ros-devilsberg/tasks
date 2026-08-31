---
story: Task List
created: 2026-08-31
---

## Description

The app's home screen and the first thing that makes it feel real: the signed-in user's open
tasks, grouped by due date, with overdue work visibly urgent. Read-only in this story —
completing, editing and deleting arrive next.

Built entirely from the shared classes written in story 02. No new bespoke class per row.

## Acceptance Criteria

- `views/TasksListView.vue` is the route target at `/`, reads `useTasksStore()`, and calls
  `load()` on mount.
- Open tasks render grouped under Overdue, Today, Upcoming and No due date headers, in that
  order, using the rules from story 05. Empty groups are not rendered.
- Each row shows the title, the due date when there is one, and a note indicator when `notes`
  is non-empty.
- A date-only `due_at` renders as a date; a datetime `due_at` renders with its time. The two
  are visually distinguishable.
- Overdue rows carry `.is-overdue` and are marked by more than colour alone — a label or icon
  with text, so the state survives a colourblind reader.
- While loading, a loading state shows; it is replaced by the list or by the empty state, and
  never persists after a failure.
- With no open tasks, an empty state invites the user to add one rather than showing a blank
  page.
- A failed load shows a non-fatal `.error` message in the app's voice — direct, first person,
  no exclamation marks — with any previously loaded tasks still on screen.
- The view uses only classes defined in `public/css/`; the story adds no new component-specific
  class unless it is a genuinely unique layout need, and any pattern used twice is extracted to
  the shared sheet.
- Tests mount the view with a fresh Pinia and a fake remote and cover: grouping and order,
  empty groups omitted, both `due_at` granularities, the overdue marker, loading → loaded,
  loading → error with the cached list retained, and the empty state.
