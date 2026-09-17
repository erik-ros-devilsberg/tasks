---
sprint: Task Order — Drag to Reorder
stories:
  - 14-task-order
status: planned
created: 2026-09-17
---

<!--
  Second of two sprints for 14-task-order. Depends on task-order-field-sort-and-reorder
  having landed: it calls `tasks.reorder(draggedId, targetIndex)` and nothing else.
  Wrapping this sprint closes the story.
-->

## Goal

Put a handle on every open row and let the user drag it, with a mouse or a finger, to
where the task should sit. The list shows where it will land while dragging; a drop calls
the store once; Escape or a drop outside the list puts everything back. Hand-rolled on
Pointer Events so mouse and touch are one code path, it stays testable in jsdom, and the
dependency list stays where it is.

Decisions taken while shaping (2026-09-17):

- Pointer Events, not the HTML5 drag-and-drop API (Android Chrome does not start it from
  touch) and not a library.
- Keyboard reordering is a follow-up story, not this sprint.

## Acceptance Criteria

**The handle**

- [ ] Every open row carries a drag handle at its right end, after the name and any
      badge. It has an accessible name ("Reorder <title>").
- [ ] Completed rows have no handle.
- [ ] In delete mode the handle is not rendered; dragging and selecting never coexist.
- [ ] Pressing on the handle starts a drag. Pressing anywhere else on the row does what
      it does today: the name opens the form, the tick completes.

**Dragging**

- [ ] Works with a mouse and with touch (`pointerdown` → `pointermove` → `pointerup`;
      pointer capture on the handle; `touch-action: none` on the handle so the page does
      not scroll instead).
- [ ] The dragged row is marked (`.is-dragging`) and an indicator (`.list__drop`) shows the
      slot the task will land in, updating as the pointer moves.
- [ ] The indicator never lands between two completed rows or after the last completed
      row when completed tasks are shown; drop positions are computed over open rows only.
- [ ] Escape during a drag cancels: indicator gone, nothing saved.
- [ ] Releasing outside the list cancels the same way.
- [ ] Releasing on the slot the task already occupies changes nothing and calls nothing.

**The drop**

- [ ] Releasing on a slot calls `tasks.reorder(draggedId, targetIndex)` exactly once with
      the index among open rows, and the list re-sorts immediately from the store.
- [ ] The row's state colour follows the new date at once (an undated task dropped into
      today's group turns amber; a dated one dropped into the tail goes green).

**Styling** (`app.css`, brand classes first)

- [ ] The handle reuses a brand glyph/button class if one fits; otherwise `.list__handle`
      is an ADDITION drawn in `currentColor` like the tick, with a `grab`/`grabbing` cursor.
- [ ] `.is-dragging` and `.list__drop` are ADDITIONs with the reason stated.
- [ ] `tests/css.test.js` asserts `touch-action: none` on the handle.

## Tasks

- [ ] Write tests for `composables/useDragReorder.js`: start only from the handle, index
      tracking over open rows, skipping completed rows, Escape, release outside, release on
      own slot, one `reorder()` call per drop with the right index
- [ ] Implement `useDragReorder({ rows, isDraggable, onDrop })` on Pointer Events with
      capture and a document-level `keydown` for Escape
- [ ] Write tests for `TasksListView.vue`: handle presence per row state, absent in delete
      mode, name/tick untouched by a handle press, indicator rendering, store call on drop
- [ ] Implement the handle, `.is-dragging`, `.list__drop` in the list template
- [ ] Write CSS tests; add the `app.css` blocks
- [ ] Update `docs/system.md`: the list view's drag section, the composable
- [ ] Manual check on Android against a real build (`npm run build && npm run preview`)

## Risks and Open Questions

- jsdom has no layout, so slot computation from pointer `clientY` cannot be tested
  geometrically. The composable must take row bounds through an injectable
  `measure(row) → { top, bottom }` so tests can hand it numbers. Without that seam the
  core of the feature is untested.
- Pointer capture on the handle means `pointermove` fires on the handle, not on the row
  under the pointer; the slot must be computed from coordinates, not from event targets.
- Long lists: a drag near the viewport edge should auto-scroll. Not in the story; noted as
  a likely follow-up alongside keyboard reordering.
- Follow-up story to write: keyboard reordering (focus the handle, Up/Down moves, Enter
  commits, Escape cancels).
