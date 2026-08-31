---
story: CSS Foundation and Brand Tokens
created: 2026-08-31
---

## Description

Lay the stylesheet down once, up front, so no later story is tempted to invent a bespoke
class. Hand-written CSS under `public/css/`, split by function, imported by a single
`main.css` in cascade order. Devilsberg dark: Onyx canvas, Ghost White text.

The generic-class rule in `CLAUDE.md` §5 is the point of this story. The shared classes are
written here, before the views that use them exist, and later stories reuse them rather than
adding their own.

## Acceptance Criteria

- `public/css/main.css` `@import`s, in this order: `tokens.css`, `base.css`, `layout.css`,
  `components.css`, `utilities.css`. `index.html` links `main.css` only.
- `tokens.css` holds every colour, font and layout custom property — the Devilsberg palette
  copied verbatim from `../contacts/docs/conventions.md` §8. No hardcoded hex exists in any
  other file.
- `components.css` provides the shared, generic classes the app will use — at minimum
  `.card`, `.list` + `.list__row` / `.list__primary` / `.list__secondary`, `.btn` +
  `.btn--primary` / `.btn--ghost` / `.btn--sm`, `.field` + `.field__error`, `.modal` +
  `.modal__dialog` / `.modal__actions`, `.error`, `.notice`, `.is-overdue`.
- Class names follow BEM: `.block`, `.block__element`, `.block--modifier`.
- No SFC in the project contains a `<style>` block, and no Tailwind or CSS framework is
  present in `package.json`.
- Every interactive element has a visible focus ring — not a background-colour change alone.
- Transitions honour `prefers-reduced-motion`.
- The layout is single-column at `max-width: 768px` and readable down to 400px.
- A test reads `public/css/main.css` and asserts each part is imported in cascade order.
- A test asserts no CSS file other than `tokens.css` contains a hex colour literal.
