# coevta Tasks

A standalone SPA front end for tasks in Vue. Pure API client against the
[coevta server](../server) — all data lives there, this repo ships no backend.

Sibling app and reference implementation: [`../contacts`](../contacts). When a question is
not answered here, read `../contacts/docs/conventions.md` and the code under
`../contacts/src/` before inventing an answer. `docs/system.md` records decisions taken in
*this* project and wins where the two disagree.

---

## 1. Non-negotiables

These are the constraints the project was set up under. Do not relitigate them.

- **Vue 3** — Composition API, `<script setup>` exclusively.
- **Pinia** for state. Setup stores, not options stores.
- **No Tailwind.** No CSS framework, no CSS-in-JS, no component library.
- **Tests are part of the work.** Vitest + `@vue/test-utils`. Tests first (TDD), never
  skipped, never left failing.
- **Generic, reusable CSS classes.** See §5 — this is the rule most likely to be broken by
  accident.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Vue 3, Composition API, `<script setup>` |
| Routing | Vue Router 4 |
| State | Pinia — setup stores, the reactive layer over `lib/` |
| Build | Vite |
| Tests | Vitest + `@vue/test-utils`, `environment: 'jsdom'`, `globals: false` |
| Styling | Hand-written CSS, central, split by function |
| Auth | Sanctum bearer token in `localStorage` |

`package.json` is `"type": "module"` and `"private": true`. Dependencies stay minimal:
`vue`, `vue-router`, `pinia` in `dependencies`; everything else a devDependency.

Version lives in `version.json` at the project root, injected into the build as
`__APP_VERSION__` via a Vite `define`. The Vitest config mirrors that define so tests
resolve it the same way.

Dev server runs on port **8043** (`strictPort`), and proxies `/api` to the coevta server
(`http://127.0.0.1:8040` by default — `composer dev` in `../server`), overridable with
`VITE_SERVER_URL` in `.env.local`.

**The API base is a build-time value, not a fixed relative path.** `API_BASE` in
`lib/api.js` reads `VITE_API_BASE_URL` and falls back to `/api/v1`:

- **Development** — leave it unset. Calls go to `/api/v1/*` relatively and the proxy above
  answers, which also keeps the browser same-origin.
- **Production** — the API lives on its own host, so set it for the build, version segment
  included and no trailing slash:
  `VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build`.

It is baked into the bundle, so a different API host means a different build. The client
authenticates with a bearer token rather than a cookie, so a cross-origin API needs CORS on
the server (`Authorization` among the allowed headers) but not credentialed requests.

The build output is `dist/`. A web server points its document root there and needs an SPA
fallback to `index.html` — the router uses `createWebHistory()`, so `/tasks/new` and
`/tasks/{id}/edit` have no file behind them and a refresh on either 404s without it.

---

## 3. Project structure

```
tasks/
├── index.html                  # static app shell
├── version.json
├── vite.config.js
├── vitest.config.js
├── public/
│   └── css/                    # see §5
├── src/
│   ├── main.js                 # app entry
│   ├── App.vue                 # shell: <RouterView/>
│   ├── router.js               # routes + auth guard
│   ├── views/                  # one per route, ends in View.vue
│   ├── components/             # reusable, presentational, props in
│   ├── composables/            # cross-cutting reactive concerns
│   ├── stores/                 # Pinia — reactive layer over lib/
│   └── lib/                    # framework-free logic
└── tests/                      # mirrors src/, see §6
```

**Rules:**

- `lib/` imports **no Vue and no Pinia**. Plain JavaScript, testable without a DOM. This is
  what keeps the API and data logic unit-testable.
- `stores/` wraps `lib/`; it does not replace it. The remote/data layer is **injected into**
  the Pinia store, not imported by it — that seam is what lets view tests hand it a fake.
- `views/` read a Pinia store. `components/` take props and stay presentational. A view
  never constructs the data layer itself.
- One responsibility per file.

---

## 4. Coding conventions

### Formatting

- **Tabs for indentation.** Everywhere — JS, Vue, CSS, JSON.
- Single quotes in JS. Semicolons. Trailing commas in multi-line literals.

### Naming

- **`snake_case` for all data keys** — anything crossing the wire or persisted:
  `due_at`, `completed_at`.
- **`camelCase` for JS locals, functions, props, composables**: `pendingCount`, `useOnline`.
- **The server leads on field names.** If a component and the API disagree, fix the
  component.
- Components `PascalCase.vue`; views end `View.vue`; composables `useThing.js`; factories
  `createThing({ ...deps })`.

### Vue

- `<script setup>` always. Order in an SFC: `<script setup>`, then `<template>`.
  **No `<style>` block** — see §5.
- `defineProps` with explicit types and defaults.
- Pinia setup stores: `export const useTasksStore = defineStore('tasks', () => { … });`
- Navigate with `router.push` / `router.replace` / `<router-link>` — never `<a href>` for
  in-app routes.

### Comments

Explain the **decision, not the mechanics**: why a branch exists, what breaks without it,
what trade-off was accepted. Never `// increment the counter`.

### Design principle: minimize "computer says no"

Inherited from the server. Prefer a sensible default over a refusal; normalize and coerce
input rather than reject it where a reasonable reading exists. Here that means: never lose
the user's typing to a validation modal, and always show what was saved.

---

## 5. CSS conventions

**Hand-written CSS. No Tailwind. No scoped `<style>` blocks in SFCs.**

The devilsberg-brand plugin is the stylesheet. Its `css/` and `fonts/` are copied verbatim
into `public/css/` and `public/fonts/` — `tests/css.test.js` fails if any of the seven brand
sheets differs from the plugin. **Never edit them here**; re-copy when the plugin changes.

```
main.css  →  fonts → tokens → base → layout → components → utilities   (brand, read-only)
app.css   →  everything this app adds or overrides                     (the only editable sheet)
```

`index.html` links `main.css` then `app.css`. Read the plugin's `css/README.md` and
`example.html` before styling anything.

### The rules that matter

1. **No hex or rgba outside `tokens.css`** — the one exception is the `:root` token block at
   the top of `app.css`, for colours the brand palette does not have.
2. **Semantic tokens only** (`--bg`, `--fg`, `--border`, `--error`, `--action`), never palette
   names (`--onyx`, `--hot-fuchsia`) — that is what keeps `.theme-light` a one-block override.
3. **Reuse a brand class before writing anything.** Every surface is `.card`, every control is
   `.btn`, every input is `.field__input`. No `.task-card`. Add a modifier only for a real
   visual variant.
4. **Every block in `app.css` is labelled `ADDITION` or `OVERRIDE`** and says why. An override
   is a candidate to push back into the brand; an addition is a candidate brand component.
5. When a pattern appears a **second** time, extract it to `app.css` immediately.

### Naming — BEM

`.block`, `.block__element`, `.block--modifier`; state classes `.is-*`.

### Colour semantics

Focus is a white ring (`--focus`) — never red. `--error` is Hot Fuchsia, `--success` is Sea
Green, `--action` → `--action-hover` is Blue Slate → Sea Green. Row state colours
(`--row-overdue` dark red, `--row-today` amber, `--row-upcoming` green, `--row-undated`,
`--row-completed`) are app tokens in `app.css`.

### Brand

Devilsberg dark — Onyx canvas, Ghost White text. Load the `devilsberg-brands:devilsberg-brand`
skill when producing copy or design.

Voice: direct, concise, first person. Say what happened, then stop.

---

## 6. Testing conventions

TDD is mandatory — tests first, then implement.

- **Vitest**, `environment: 'jsdom'`, `globals: false` — import `describe`, `it`, `expect`,
  `vi`, `beforeEach` explicitly.
- `@vue/test-utils` for components: `mount`, `flushPromises`.
- Alias `@` → `./src`. `npm test` runs `vitest run`.
- Tests live in `/tests`, mirroring the `src/` tree — **not** beside the source.

### Structure

- `describe` per unit of behaviour, usually one per public function.
- `it` names state the **behaviour and the reason**, not the mechanics:
  `it('shows a task as overdue when due_at is in the past and completed_at is null')`.
- Arrange / act / assert separated by blank lines.
- Small factory helpers at the top of the file:
  `const task = (id, title) => ({ id, title, notes: null, due_at: null, completed_at: null })`.
- `beforeEach` resets shared state; `afterEach` calls `vi.unstubAllGlobals()` and
  `vi.restoreAllMocks()` where globals were stubbed.

### What gets mocked

- The **remote** is a hand-rolled fake built from `vi.fn()` — assert on calls *and* on the
  resulting state.
- **Component tests get a fresh Pinia per test** with the fake data layer injected. No
  state leaks between tests.
- **Store tests call the Pinia store directly** with `setActivePinia(createPinia())` — do
  not mount a component to test state.
- `vue-router` mocked via `vi.hoisted` so `push`/`replace` are assertable.
- Network via `vi.stubGlobal('fetch', …)`.

### What must be covered

- Every API failure status the app can meet: `401`, `404`, `422`, `5xx`, network drop.
- Completion round-trip, including that `POST /complete` is sent **without a body**.
- The PUT-is-replacement trap in §7 — a save must send a complete body.
- `due_at` granularity: a date-only value stays date-only, a datetime stays a datetime.
- Overdue / open / completed classification and ordering.
- Every offline path: create, edit, complete, reopen and delete with no connection; the
  queue surviving a reload; coalescing; and each failure policy in §8.
- That an edit never carries `completed_at`, in the store *and* on the wire.

Tests share `tests/support/server.js` — a small in-memory server rather than a bag of
stubs, because a sync pushes and pulls in one operation and a `listAll` that ignored its own
`create` would make every round-trip assertion lie.

---

## 7. API contract — tasks

Base `/api/v1`, bearer token in `Authorization`. Full detail in `../server/docs/api.md`;
the server is authoritative.

| Verb | Path | Result |
|---|---|---|
| GET | `/tasks` | `200` the whole list in one response — **no pagination** |
| POST | `/tasks` | `201` created task — an empty body is valid |
| GET | `/tasks/{id}` | `200`; `404` if unknown |
| PUT | `/tasks/{id}` | `200` **full replacement** |
| PATCH | `/tasks/{id}` | `200` partial update — safe on a completed task |
| POST | `/tasks/{id}/complete` | `200`, **no body**; stamps `completed_at = now()`. Idempotent |
| DELETE | `/tasks/{id}` | `204`; `404` if unknown |

**Fields**

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID v7) | response only |
| `title` | string | max 255; blank/missing → `"Untitled task"` |
| `notes` | string\|null | |
| `due_at` | date or datetime \| null | echoed in the granularity given — `YYYY-MM-DD` or ISO 8601 UTC |
| `duration` | integer\|null | minutes the task is expected to take. Optional; `null` = no estimate |
| `completed_at` | datetime\|null | ISO 8601 UTC; **`null` = open**. There is no `status` field |

Auth: `POST /login` → `{ token }`; `POST /logout` revokes only the token used;
`POST /forgot-password` and `POST /reset-password` are public and rate-limited. The reset
page belongs to the client — the server links to `{FRONTEND_URL}/reset-password?token=…&email=…`.

### Due dates are wall-clock, not instants

**Whatever time is registered is the time that is shown.** A `due_at` is a commitment —
"Friday at 14:30" — not a point on a global timeline. Nothing in the app converts a due date
between time zones: the calendar and clock fields are read literally off the string by
`parseDue()` and rebuilt in local time, and any offset the server appends is ignored rather
than applied.

Never hand a due date to `new Date(string)`. It converts: `'2026-08-30'` becomes UTC midnight
— the evening of the 29th in the Americas — and `'…T14:30:00Z'` displays as whatever hour the
viewer's zone makes of it. Both are wrong here.

`completed_at` is different: it is a real instant stamped by the server, and it is only ever
compared, never re-displayed as a wall-clock promise.

### Consequences to design around

- **PUT is a full replacement, and omitting `completed_at` reopens the task.** Always build
  a complete body from the whole record. Prefer PATCH for partial edits.
- **No version, ETag or `updated_at`** — a client cannot detect that a record changed
  underneath it. Conflict resolution is last-write-wins and loses data by design.
- **No idempotency key** — a create whose response is lost will be resent and duplicate.
- Tasks carry **no timestamps** other than `due_at` and `completed_at`.

---

## 8. Offline first — decided

**This app works with no connection, and installs on Android.** Decided 2026-09-01,
reversing the "plain online client" position this project started from.

The device is the source of truth for reads. Every write is applied locally and queued;
nothing in a view ever waits on the network. The machinery mirrors `../contacts`:

```
views/ → stores/tasks.js → lib/offlineStore.js → lib/{kv,outbox,sync}.js → lib/tasksRemote.js
```

- **`lib/kv.js`** — storage narrowed to six methods. IndexedDB in the browser, a `Map` in
  tests; falls back to memory rather than throwing.
- **`lib/outbox.js`** — the durable ordered queue, coalescing at enqueue. Five operation
  types: `create`, `update`, `delete`, `complete`, `reopen`.
- **`lib/sync.js`** — the drain. One in-flight promise; `401` stops and keeps the queue,
  `404` on a non-create reconciles locally, `422` is dropped and reported, anything else
  stops rather than skips so ordering holds.
- **`lib/offlineStore.js`** — `local-` ids, remapped when a create syncs.

**The rule that keeps completion safe: an `update` payload must never carry
`completed_at`.** Completion has its own two operations and its own endpoint. An edit that
mentions `completed_at` will reopen a finished task the moment the outbox coalesces it with
an earlier one.

Installability lives in `public/manifest.webmanifest` and the hand-written `public/sw.js`.
The worker precaches a **literal** list of shell assets and `addAll` is atomic — adding an
asset means adding it to `SHELL`. `CACHE` is never bumped by hand: `build/swVersion.js`
stamps it with the `version.json` version on every build, so each deploy installs a fresh
worker (the browser only installs one when `sw.js` changes). That is also why `vite.config.js`
turns off content hashing and emits a single chunk: a filename the list cannot predict is a
route that fails offline. `/api/` is never served from the HTTP cache — that data belongs to
the offline layer.

The worker is registered only in `import.meta.env.PROD`; the dev server has no
`/assets/index.js`, so the atomic precache would fail. Test offline behaviour against a real
build: `npm run build && npm run preview`.

---

## 9. Quality gates

Before finishing any unit of work:

```bash
npm test          # vitest run — must be green
npm run build     # must succeed
```

No commit with failing or skipped tests.

---

## Workflow — the Memrego hub

Requests, stories, sprints and work packages live in the Memrego hub, project `coevta`, reached
through the `hub` plugin (`hub@memrego`). **The local agile workflow is retired** (2026-10-24):
nothing new goes into `docs/user-stories/` or `docs/sprints/`, and the `/agile:shape`,
`/agile:execute` and `/agile:wrap-sprint` commands are not used here. `docs/user-stories/done/`
stays as the record of the sprints before the switch.

The connection is set in `.env` (`AGILE_AGENTIC_API_URL`, `AGILE_AGENTIC_ACCESS_TOKEN`,
`AGILE_AGENTIC_PROJECT=coevta`), which is gitignored. Never print or log the token. Run hub
commands from the repo root. If a hub call fails with exit code 2, 3 or 6, run `hub:setup`.

### Flow

```
1. Requests: bugs and feature requests        → hub:requests
        anyone files one; the product owner triages it
2. Stories: written for a request, attached to it → hub:backlog
        slug NN-kebab-name, title, description, acceptance criteria
3. Sprint planning: one activity, not two      → hub:backlog + hub:work
        create the sprint from shaped stories AND split every story into
        work packages, so the plan put up for approval is complete
        STOP: the human approves the sprint in the dashboard
4. Work packages: claimed, done                → hub:work
        developer implements (TDD: tests first, then implement)
        STOP: the human verifies and sends the sprint to review
5. Acceptance: the product owner accepts each story against the Definition of Done
        and closes the sprint in the dashboard
6. Commit only when the human asks
```

### Rules

- Never start building without an approved, running sprint in the hub.
- Triage (attach, detach, decline, reopen a request) is the product owner's call: propose it,
  do it only when asked.
- A story written for a request is attached to that request (`submissions attach`).
- An agent never sets a story or sprint to `done`, never starts a sprint, and never moves a sprint
  into or out of `review` while `whoami` reports `human_sends_to_review: true`. Report the work as
  finished and stop.
- Developer writes tests first, then implements — never skip writing tests.
- Tests live in a separate directory structure in the project root `/tests`.
- Defects found in review become new requests in the hub.
- Decisions and outcomes worth keeping still go into `docs/system.md`.
- Do not make changes outside the project directory.

### Human gates

1. Approving a sprint — in the hub dashboard, before any work starts.
2. Reviewing the work — a human verifies it and sends the sprint to review.
3. Accepting stories and closing the sprint — the product owner, in the dashboard.
