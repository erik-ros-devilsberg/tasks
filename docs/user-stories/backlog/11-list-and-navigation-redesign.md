---
story: List and Navigation Redesign
created: 2026-08-31
---

## Description

The task list and the app chrome carry more furniture than they earn. "Tasks" is printed
twice, the build version sits in the header where it competes with navigation, and every
row hands the user four controls plus two badges to read past.

Strip it back. The nav keeps one wordmark and one hamburger button; everything that used to
be a toolbar button moves into the menu behind it. A row becomes what a task actually is —
a tick, a name, and a way to throw it away — and the state the badges used to spell out is
carried by the row's background colour instead. Group headings go: one list, one order.

Refreshing stops being a chore the user performs. The list reloads on mount and whenever the
tab is looked at again; nothing polls, because nothing changes underneath a user working
alone. A manual Refresh stays in the menu for the case where they know better.

## Acceptance Criteria

**Navigation**

- "Tasks" appears once in the interface, not twice.
- The build version is shown in a footer, not in the header.
- The header's Sign out button is replaced by a hamburger button that opens an overlay menu.
- The menu contains: Refresh, a Completed item that toggles completed tasks on and off, and
  Sign out.
- The menu closes on Escape, on a click outside it, and after any item is chosen.
- The hamburger and the menu appear only when there is a session.

**The list**

- The list reloads automatically on mount and when the tab becomes visible or focused again.
  There is no polling timer.
- No Refresh button and no Show/Hide completed button remain in the view.
- The New task control is a `+`, with an accessible name that still says "New task".
- There are no group headings. Every task lives in one list, ordered soonest due first,
  undated last, ties broken by title.
- Completed tasks, when toggled on, sit in that same list in that same order — not in a
  separate section.
- The "Completed" preference still survives a reload.

**A row**

- A row is a checkbox, the task name, and a delete (trash) control. Nothing else.
- No due date text, no Overdue badge, no Done badge, no notes indicator on the row.
- Clicking the name opens the task form for that task.
- The trash control still asks for confirmation before deleting.
- Ticking the box completes the task; unticking a completed one reopens it.

**Row colour**

- Completed rows have a slightly lighter background.
- Overdue rows have a red background.
- Rows due today have an orange background.
- Rows due later have a bright green background.
- Rows with no due date have a faded green background.
- Every colour is a token in `tokens.css`; no hardcoded colour anywhere else.
- Text on every row background meets the contrast floor, and the state is never signalled by
  colour alone — each row carries a screen-reader-only word naming its state.
