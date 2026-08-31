
# System Documentation

This file is maintained by `/agile:wrap-sprint`. Read this to understand the system without reading all the code.

## What this is

A Vue 3 SPA for managing tasks against the [coevta server](../server). Pure API client — the
app ships no backend and no database. It is an **online** client: every read and write goes
to the server as it happens. The offline layer the sibling contacts app has (IndexedDB,
outbox, sync drain) is deliberately not built here; see "Decisions" below.

## Stack

Vue 3 (`<script setup>` only), Vue Router 4, Pinia (setup stores), Vite, Vitest +
`@vue/test-utils` on jsdom. No Tailwind, no CSS framework, no component library. Tabs for
indentation everywhere.

`version.json` holds the version, injected as `__APP_VERSION__` by a Vite `define` that
`vitest.config.js` mirrors so tests resolve it identically.

## Layers

```
views/  →  stores/  →  lib/
```

- **`lib/`** is framework-free — no Vue, no Pinia imports. Unit-testable without a DOM.
- **`stores/`** is the reactive layer over `lib/`. Dependencies are *injected*, not imported,
  so tests hand a store a fake and never touch the network.
- **`views/`** are route targets that read a Pinia store. `components/` take props and stay
  presentational.

### `lib/api.js`

The single HTTP client. Prefixes `/api/v1`, sets `Accept: application/json`, attaches the
bearer token when one is held, and sets `Content-Type` only when there is a body — the
server's `POST /tasks/{id}/complete` takes none.

Failures are `ApiError` carrying `status`, `message` and the server payload. **A dropped
connection is reported as status 0, not as a thrown `TypeError`** — "offline" and "the server
said no" produce very different messages for the user, and every layer above branches on
`status`. A non-JSON error body (an HTML error page) parses to `null` rather than throwing,
leaving the status branch in charge of the message.

Exposes `get`, `post`, `put`, `patch`, `del`.

### `stores/session.js`

The one place that knows whether we are signed in.

The token lives in `localStorage` under `coevta-tasks.token` — its own key prefix, clear of
the sibling apps. It is there rather than in Pinia alone because Pinia dies on reload and the
router guard must answer synchronously before any async work has run.

One `api` instance is constructed here with an `onUnauthorized` hook, so a `401` from
*anywhere* clears the token and raises `expired` in exactly one place. `login()` maps the
server's empty-bodied `429` to an actionable throttle message. **`logout()` clears locally
even when `POST /logout` fails** — a dead network must not trap a user in a session.

### `router.js`

`authGuard(to)` is pure: it returns `true` to allow or a path to redirect to, so it is tested
without driving a router. Signed-out visitors go to `/login`; signed-in visitors are pushed
off it. Routes are lazy-loaded. `/` is `tasks`; `/login` carries `meta.public`.

## CSS

Hand-written, central, under `public/css/`. `main.css` contains **imports only** — the file
order *is* the cascade order:

```
tokens.css → base.css → layout.css → components.css → utilities.css
```

Every colour, font and layout value is a custom property in `tokens.css`; no other CSS file
contains a hex or `rgba()` literal, and a test enforces that. Devilsberg dark — Onyx canvas,
Ghost White text.

The rule that matters: **views reuse the shared generic classes rather than minting their
own.** There is no `.task-card`. A test asserts the shared inventory still exists, because
losing one silently pushes a view into bespoke CSS. No SFC has a `<style>` block — also
enforced by a test.

Accessibility floor, enforced or reviewed: a visible focus *ring* (not a background tint), a
skip-to-content link, semantic landmarks, and `prefers-reduced-motion` honoured.

## Testing

Tests live in `/tests` mirroring `src/`, never beside the source. Vitest with
`environment: 'jsdom'` and `globals: false` — everything imported explicitly. `vue-router` is
mocked with `vi.hoisted` so `push`/`replace` are assertable; the network is stubbed with
`vi.stubGlobal('fetch', …)`. Store tests call the Pinia store directly with
`setActivePinia(createPinia())` rather than mounting a component.

`it` names state the behaviour *and the reason* — `it('signs out locally even when the
request fails — a dead network must not trap the user')`.

Quality gates before any work is called done: `npm test` and `npm run build`, both green.

## API contract

Base `/api/v1`, Sanctum bearer token. The server leads on field names; if a component and the
API disagree, the component is wrong. Full detail in `../server/docs/api.md`.

Completion is `completed_at` alone — **there is no `status` field** and nothing in the app may
invent one. `GET /tasks` returns the whole list in one response (pagination was removed
server-side on 2026-08-31). `PUT` is a full replacement and **omitting `completed_at` reopens
the task**, so partial edits use `PATCH`. There is no version, ETag or idempotency key:
conflict resolution is last-write-wins and duplicate creates are possible — accepted
trade-offs.

## Decisions

**Online-only, with the seam left in.** The sibling contacts app is offline-first. This one is
not, because nothing asked for it. The injection seam between `stores/` and `lib/` is built
anyway, so an offline store can slot in later without rewriting the views.

**No `useOnline` composable.** Its only use here would be a "you need a connection" banner on
the login screen, and a failed request already says "No connection to the server."

**`.conn*` and `.badge-pending` are not carried over.** They signal sync state, which an
online client has none of. `CLAUDE.md`'s class inventory was trimmed to match what actually
exists.

**Token in `localStorage` is readable by any XSS on the origin.** Accepted: it matches the
sibling app, and the server's token endpoint offers no httpOnly-cookie alternative.

## Sprints

### App Foundation and Sign-In (2026-08-31)

Build scaffold, the complete stylesheet, and token-based authentication. The stylesheet
landed *before* any view existed — deliberately, so later stories reuse its classes instead of
inventing their own.

Delivered `package.json`, `vite.config.js`, `vitest.config.js`, `index.html`, `.env.example`,
`public/css/*`, `src/lib/api.js`, `src/stores/session.js`, `src/router.js`, `src/App.vue`,
`src/views/LoginView.vue`, and a placeholder `TasksListView.vue` so the guard and the
post-login redirect have a real target. 80 tests.

`api.patch()` was added here rather than in a later sprint — stories 07 and 08 both need it,
and adding it now avoided a second pass over the client.
