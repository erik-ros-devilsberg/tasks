
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

### `lib/tasksRemote.js`

The only module that knows the shape of the task endpoints. `createTasksRemote({ api })`
returns `listAll`, `get`, `create`, `update`, `replace`, `complete`, `reopen`, `remove`.

It absorbs the server's sharp edges so callers never meet them: `update()` is a `PATCH`, so a
partial body cannot wipe omitted fields or reopen a completed task; `replace()` is the
explicit `PUT` that sends a complete record including `completed_at`; `complete()` posts **no
body at all**; `remove()` treats a `404` as success, because "already gone" is the outcome the
caller asked for.

`listAll()` accepts either a bare array or a `{ data }` envelope — the server's pagination
removal could land either way, and tolerating both means the app does not break mid-deploy.

### `lib/taskSort.js`

Ordering and grouping, framework-free. The server sends `due_at` and `completed_at` and
nothing else — **"overdue" and "today" are decisions this module makes, not fields it reads.**

Open tasks sort soonest-first with undated last and ties broken by title, so the order does
not shuffle between loads. Completed tasks sort most-recent-first. `groupOpen()` buckets into
Overdue / Today / Upcoming / No due date and drops empty groups. Sorting always returns a new
array; sorting in place would mutate store state from under the views.

A date-only task is late only once the *next* day begins — it has all day. A timed task is
late the moment its time passes.

### Due dates are wall-clock, not instants

**Whatever time is registered is the time that is shown.** A due date is a commitment, not a
point on a global timeline, so nothing converts it between zones. `parseDue()` reads the
calendar and clock fields literally off the string and rebuilds them in local time; an offset
the server appends is ignored rather than applied. `formatDue()` then only decides how to
print them, and prints a time only when one was registered — "Friday" and "Friday at 14:30"
are different commitments, and showing a time the user never entered invents precision.

Handing a due date to `new Date(string)` is the bug this exists to prevent: `'2026-08-30'`
becomes UTC midnight, which renders as the 29th anywhere west of Greenwich.

`completed_at` is the exception — a real instant stamped by the server, only ever compared.

### `stores/tasks.js`

The reactive layer. The remote is **injected** through `useRemote()`, never imported, which is
what lets view tests hand it a fake.

State: `tasks`, `loading`, `loaded`, `error`, `now`. Derived: `open`, `completed`, `groups`.

- `loading` starts **true** — starting false flashes "no tasks yet" for a frame before the
  first load resolves.
- `loaded` distinguishes "this account has no tasks" from "we never got an answer". Without
  it a failed first load renders an empty state that is a guess.
- `now` is state, refreshed on every load, rather than a `new Date()` inside the computed.
  That is what stops the grouping and the per-row overdue marker disagreeing — a row must
  never carry an "Overdue" badge while sitting under the "Today" heading.
- A **generation counter** discards responses that have been overtaken. Without it a slow
  first request landing after a fast second one puts the older list back on screen.
- **`forget()`** empties everything and is called on sign-out and on a `401`. This device is
  shared; without it the next person to sign in sees the previous account's tasks rendered
  from memory until their own load resolves.
- Writes go through `attempt()`, which reports success **separately** from the returned value
  — an empty `204` body is a success that otherwise looks identical to a failure. When a write
  succeeds without a body the store reloads rather than guessing, so a click can never
  silently do nothing.
- A failed write leaves the list exactly as it was. A failed `load()` keeps the last known
  tasks on screen with a warning.
- A `401` is rethrown by every action rather than folded into `error` — only the session layer
  can act on it.

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

### Tasks On Screen (2026-08-31)

The full stack from `lib/tasksRemote.js` through `stores/tasks.js` to a grouped, ordered list
replacing the placeholder view. 176 tests.

A code review ran at the end of this sprint and found six issues, all fixed before wrapping.
The two that mattered: the store was never cleared when a session ended, so a second user on
the same browser would see the first user's task titles until their own load resolved; and
`remove()` captured the task array *before* its await and wrote it back after, silently
reverting any refresh that landed during the round-trip. The rest — a contradictory empty
state on a cold failure, a frozen `now` in the grouping computed, `null` meaning both "204"
and "failed", and unguarded overlapping loads — are covered in the `stores/tasks.js` notes
above.

The wall-clock rule for due dates was set here, on instruction: whatever time is registered is
the time that is shown, with no zone conversion in either direction.

One remaining gap, accepted for now: `now` refreshes on load, not on a timer. A tab left open
past midnight keeps yesterday's tasks under "Today" until the next refresh.
