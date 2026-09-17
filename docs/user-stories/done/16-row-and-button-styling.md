---
story: Row and Button Styling
created: 2026-09-17
---

## Description

The brand-stylesheet adoption (`ae8f3d7`) handed every surface to the brand's defaults, and
three of them are wrong for a task list on a phone: the rows and controls sit too tight,
the icon buttons wear a thin grey outline that reads as a mistake, and the completion tick
is the browser's stock checkbox. This story fixes them in `app.css` as labelled OVERRIDE and
ADDITION blocks — the brand sheets stay untouched.

The delete control on a row is not restyled here: it disappears with story 17 (delete
mode). Only the tick, the row and the remaining icon buttons (hamburger, FAB) are in scope.

## Acceptance Criteria

- A list row has visibly more breathing room than today on a phone: more vertical padding
  and more space between the tick and the name. The values are spacing tokens, not
  literals.
- The completion tick is a custom control: a rounded box with a drawn check when ticked,
  sized for a thumb, in the row's ink colour so it stays readable on every row background.
  It is still an `<input type="checkbox">` underneath — keyboard, screen reader and the
  existing tests keep working.
- The tick shows the white focus ring, never a red one.
- No icon button in normal mode (hamburger, `+` FAB) shows the brand's grey outline. The
  hamburger is borderless; the FAB is filled `--action`, hover `--action-hover`.
- The version in the footer is centred, so the FAB never covers it.
- Every new block in `app.css` is labelled OVERRIDE or ADDITION and says why.
- `tests/css.test.js` still passes — no brand sheet was edited.
