
# System Documentation

This file is maintained by `/agile:wrap-sprint`. Read this to understand the system without reading all the code.

## What this is

A Vue 3 SPA for managing tasks against the [coevta server](../server). Pure API client — the
app ships no backend and no database.

It is **offline-first and installable**. The device is the source of truth for reads; every
write is applied locally and queued, and the network is a background concern. It installs on
Android as a standalone app. See "Decisions" below — this reverses the position the project
started from.

## Stack

Vue 3 (`<script setup>` only), Vue Router 4, Pinia (setup stores), Vite, Vitest +
`@vue/test-utils` on jsdom. No Tailwind, no CSS framework, no component library. Tabs for
indentation everywhere.

`version.json` holds the version, injected as `__APP_VERSION__` by a Vite `define` that
`vitest.config.js` mirrors so tests resolve it identically.

## Layers

```
views/  →  stores/tasks.js  →  lib/offlineStore.js  →  lib/{kv,outbox,sync}.js  →  lib/tasksRemote.js
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

### The offline layer — `lib/{kv,outbox,sync,offlineStore}.js`

Ported from `../contacts` and extended for the one way tasks differ: completion is its own
endpoint, so it needs its own operations.

**`kv.js`** — storage narrowed to six methods: `get/set/del/all/keys/clear`. Two adapters
satisfy it, IndexedDB and a plain `Map`, which is why every layer above is unit-tested
without a DOM. It hands back clones in both directions, so a view that edits what it
rendered cannot rewrite the cache behind the store's back. It falls back to memory rather
than throwing: a private window should still get a working app for the session. Both object
stores are created on the one upgrade — creating the second lazily would need a version bump
on a database the first had already opened.

**`outbox.js`** — the durable, ordered queue. Coalescing happens **at enqueue**, while both
operations are still in hand: eight offline edits to one task are one request. Five types —
`create`, `update`, `delete`, `complete`, `reopen`.

- `delete` cancels everything queued for the record, and cancels itself too when the record
  was only ever created locally — the server never heard of it.
- `update` folds into a pending `create`, or merges into a pending `update`. **Merged, not
  replaced** — unlike contacts, whose payload is a full `PUT` body. Ours is a `PATCH` body,
  so a narrower second edit must not drop the keys the first carried.
- `complete`/`reopen` fold into a pending `create` by setting `completed_at` in its payload;
  otherwise they replace any pending completion for that record, so ticking and unticking a
  box converges on one call.
- An operation flagged `sending` is never coalesced into. Its payload has already left.
- The sequence lives in storage, not in a counter in memory — a reload must continue it
  rather than restart it and reorder the queue.

**`sync.js`** — the drain, behind a single in-flight promise, because start-up and the
`online` event routinely fire together. Failure policy: `401` stops and keeps the queue;
`404` on anything but a create reconciles locally; `422` is dropped **and reported**, because
a poison operation would otherwise block everything behind it forever; anything else stops
rather than skips, so ordering holds.

**`offlineStore.js`** — the device as source of truth. `local-` ids for records created
offline, remapped when the create syncs so an edit made in flight does not 404. `refresh()`
skips records with queued work **in both directions**: upserting one would overwrite an
offline edit with the server's stale copy, and deleting one would remove a record the server
has never heard of.

Two rules specific to tasks:

- **An `update` payload never carries `completed_at`.** `withoutCompletion()` strips it. This
  is the sharp edge of the whole design: an edit that mentions the field will reopen a
  finished task the moment it coalesces with an earlier one.
- **Completing offline stamps the moment the box was ticked**, not the moment a connection
  returned — that is when the user finished the task, and it keeps the list in a sensible
  order meanwhile. The stamp is a placeholder; the server writes its own on sync and that one
  wins.

### `stores/tasks.js`

The reactive layer over the offline store, which is **injected** through `useOfflineStore()`,
never imported — that seam is what lets tests hand it a fake and never touch IndexedDB.
`useRemote()` enters the same seam one layer lower, wrapping a fake remote in the real
durable layer over throwaway memory.

State: `tasks`, `loading`, `loaded`, `syncing`, `error`, `notice`, `unauthorized`,
`pendingCount`, `pendingIds`, `now`. Derived: `open`, `completed`, `visible`, `isPending`.

- `load()` reads the device. `syncNow()` **pushes before it pulls** — the other order would
  refresh away an edit that has not left the device yet.
- **`error` and `notice` are different things.** An error is a change the server refused and
  dropped, which the user made and deserves to hear about. A notice is "no connection" — the
  app working as designed, in the same voice as everything else.
- `loading` starts **true** — starting false flashes "no tasks yet" for a frame.
- A `401` raises `unauthorized` rather than throwing. `App.vue` watches it, so it is handled
  once for every view rather than per view: any screen can be showing when a background sync
  meets an expired token.
- **`forget()`** empties the cache *and the queue*, on sign-out and on a `401`. This device is
  shared.
- `fetchOne(id)` prefers what is already held, so opening a task from the list costs nothing;
  it syncs only for a deep link that arrived before this browser ever read the list.
- The store does **not** auto-push after each write. Syncing happens at defined moments — on
  mount, on returning to the tab, on `online`, after a list action, and from the menu. An
  automatic push per write would send eight requests for eight edits and defeat the outbox's
  coalescing entirely.

Known gap: `now` refreshes on load and on sync, not on a timer. A tab left open past midnight
keeps yesterday's tasks under "today" until the next sync.

### `lib/dueFields.js`

Moves a due date between the API's single `due_at` string and the form's two inputs — a date
and an optional time. Two inputs rather than one `datetime-local`, because the granularity is
the user's to choose and `datetime-local` cannot express "this day, no particular time".

`joinDue()` drops a time given without a date rather than rejecting the save: a time alone is
not a due date, and refusing the whole save over it would be the "computer says no" this app
avoids. Nothing here converts zones — the wall-clock fields are sent exactly as typed, with a
`Z` appended because that is what the server expects.

### `components/ConfirmModal.vue`

The one destructive-action gate. A labelled `role="dialog"`, focus moved to **Cancel** on open
(this dialog only appears for things that cannot be undone, so the safe option is under the
user's hands), Escape and click-outside both close, Tab swaps between the two buttons, and
focus returns to whatever opened it on unmount — without that last part a keyboard user is
dumped back at the top of the document.

### `composables/useCompletedShown.js`

Whether the completed section is open, remembered in `localStorage`. Every access is wrapped:
the API throws outright in some private-browsing modes, and a stored value can be anything
once a user has poked at it. Both failures fall back to hidden — a preference is never worth
an exception.

### `lib/durationField.js`

Moves `duration` between the API's integer minutes and the string an input holds. It never
refuses: a duration is an estimate the user volunteered, and losing the rest of a save
because it was typed oddly would be exactly the "computer says no" the project rules out.
Junk, blank, zero and negatives all read as `null`; a decimal rounds; the first number in the
string is taken, so "45 minutes" is 45.

Zero maps to `null` rather than being stored: a 0 in the box claims the task takes no time,
which is not what the user said.

### `views/TaskFormView.vue`

Serves both create and edit. It never sends `completed_at` — completion has its own
operations, and mentioning the field in an edit is how a completed task gets silently
reopened. `duration` is **always present** in the body, never omitted: an absent key leaves a
`PATCH` field untouched, so clearing the box has to send an explicit `null`.

Saving writes to the device and returns to the list immediately. There is no spinner on a
round-trip that may never happen, and no per-field server errors — a local save cannot be
refused. A change the server later rejects is reported on the list instead.

### `public/sw.js` and the manifest

Hand-written, not generated. The worker precaches a **literal** list of shell assets and
`addAll` is atomic, so one stale entry fails the whole install and costs all offline support:
adding an asset means adding it to `SHELL` *and* bumping `CACHE`. `/api/` is never served
from the HTTP cache — that data belongs to the offline layer, which would have no way to know
it was being handed a stale list.

Any navigation falls back to `index.html`, which is what makes a refresh on `/tasks/new` or
`/tasks/{id}/edit` work offline under `createWebHistory()`.

`vite.config.js` turns off content hashing and emits a single chunk, because a filename the
hand-written list cannot predict is a route that fails offline. The worker is registered only
under `import.meta.env.PROD` — the dev server has no `/assets/index.js`, so the atomic
precache would fail there. Offline behaviour is tested against a real build.

Icons are derived from `docs/tasks.svg`. Two things were changed and both matter: the glyph
is a path rather than text, so it does not depend on a font being installed on the device;
and the canvas is opaque Onyx rather than transparent, because a launcher composites an icon
onto its own wallpaper. `icon-maskable-512.png` draws the mark at ~56% of the canvas so it
survives Android cropping it to a circle.

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

Tests live in `/tests` mirroring `src/`, never beside the source. `tests/support/server.js`
holds a small in-memory server shared by the tests that drive a whole sync — a bag of
unrelated stubs stops working once the app pushes and pulls in one operation, because a
`listAll` that ignored the `create` it had just accepted would make every round-trip
assertion lie. Vitest with
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
trade-offs, and offline-first widens the window in which they happen.

`duration` is an optional integer number of minutes, `null` when unknown. `replace()` carries
it, because a `PUT` body that omits it wipes it.

## Decisions

**Offline-first and installable (2026-09-01).** Reverses the original "online-only" decision
below, on instruction. The seam left in for exactly this took the offline store without any
view being rewritten around it — the views' change was about *showing* sync state, not about
where their data comes from.

*Superseded — kept for the reasoning:* "Online-only, with the seam left in. The sibling
contacts app is offline-first. This one is not, because nothing asked for it." The seam was
built anyway, and that is the only reason this landed as an addition rather than a rewrite.

**`useOnline`, `.conn*` and `.badge--pending` are carried over after all.** They signal sync
state, which this client now has.

**Completion is its own outbox operation, not an update.** Two reasons:
`POST /tasks/{id}/complete` takes no body and lets the server stamp the authoritative time,
and an `update` carrying `completed_at` would reopen a finished task the moment it coalesced
with an earlier edit.

**The checkbox no longer needs its DOM re-synced by hand.** The old online version had to put
the box back after a failed write, because Vue will not re-patch a prop it believes is
unchanged. A local write always changes the record, so the binding always changes with it.

**`duration` was built to the agreed contract, not to what the API returns today.** The
server column was being added in parallel. Unknown fields are ignored rather than rejected,
so nothing breaks in the meantime.

**No auto-push after a write.** See `stores/tasks.js` above — it would defeat the outbox's
coalescing.

**Fonts from `fonts.bunny.net` are not precached**, being cross-origin. Offline, the body
face falls back to the system sans; the wordmark face is vendored and precached, so the brand
type survives.

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

### Managing Tasks (2026-08-31)

The writes: complete and reopen from the list, a create/edit form, confirmed delete, and a
persisted completed section. This closes the first working version. 228 tests.

The completion checkbox is bound to `completed_at` rather than to the event, so which way a
click goes is decided by the record — a double click cannot complete twice.

One design change fell out of the form: the store now rethrows a `422` alongside a `401`.
Folding it into a general error message stripped the field detail and left the user guessing
which input was wrong.

No new CSS class was added in this sprint. The form, the modal and the completed section are
built entirely from the inventory laid down in sprint 1, which is what that ordering was for.

A second review ran after this sprint was committed and found eight issues, all fixed. The
worst was a data-loss path: when the edit form failed to load its task it rendered blank and
still submittable, so pressing Save PATCHed empty fields over the real record — one transient
network failure could wipe a task's title, notes and due date. The form now refuses to save a
record it never read.

Three more came from the 422 rethrow itself, which had been widened past the form: `complete`,
`reopen` and `remove` have no `catch`, so a 422 there became an unhandled rejection and a click
that did nothing. The rethrow is now opt-in per action. The other fixes: every write path in
both views catches the rethrown 401 and ends the session instead of leaving the user on a
screen that still looks signed in; the completion checkbox binds to the record rather than a
literal, and is re-synced by hand after a failure, because Vue will not re-patch a prop it
believes is unchanged — without that a failed complete left a ticked box permanently claiming
the task was done; and `toggle` now uses `isOpen` rather than its own narrower `=== null` test.
