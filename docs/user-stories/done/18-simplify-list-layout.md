---
story: Simplify the list layout
created: 2026-09-30
---

## Description

On the phone the floating new-task button sometimes disappears off screen, and the task
rows do not always stay where they belong. Both come from layout tricks the app does not
need: fixed-position controls, maths on `50vw`, a negative margin that pulls the list out
of its container, and markup that is never seen.

Replace the tricks with plain, in-flow layout. The new-task button sits inline at the top
of the list. Nothing on the list page is positioned against the viewport.

## Acceptance Criteria

- The new-task button sits inline at the top of the list, in normal document flow. It is
  never `position: fixed`.
- The delete-mode action bar (count, Cancel, Delete) takes the button's place at the top
  of the list, also inline. It is never `position: fixed`.
- `.btn--fab`, `--fab-size` and the extra `padding-bottom` on `.app-main` are removed from
  `app.css`.
- The `.list` negative margin (`margin: 0 calc(var(--container-pad) * -1)`) is removed.
  Rows sit inside the container like everything else.
- The row hover `filter: brightness(…)` is removed. On a phone it sticks after a tap.
- The `.actionbar` `left`/`right` `50vw` maths is removed along with its fixed positioning.
- `<h1 class="visually-hidden">Tasks</h1>` is removed from the list view.
- `<a class="skip-link" href="#main">Skip to content</a>` is removed from `App.vue`, and
  so are the `tabindex="-1"` on `<main>` and the `.app-main:focus` rule that only existed
  for it.
- Row colours reach the edge of the screen on a phone and the edge of the container on a
  desktop, without negative margins.
- The screen-reader text stays: the hidden state word on each row, "Selected" in delete
  mode, the icon buttons' `aria-label`s and the `aria-live` count. Only the hidden `<h1>`
  and the skip link go, because they add nothing.
- On a phone-width viewport (360px) the list page has no horizontal scroll.
- Tests that asserted the removed behaviour (FAB class, fixed positioning, safe-area
  padding, skip link) are replaced by tests for the new behaviour. `npm test` and
  `npm run build` pass.
