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

Central, split by function under `public/css/`, with a single `main.css` importing in
cascade order:

```
tokens.css → base.css → layout.css → components.css → utilities.css
```

### The rules that matter

1. **All tokens live in `tokens.css`. No hardcoded hex anywhere else** — colours and
   `--font-title` / `--font-body` included.
2. **Reuse generic shared classes. Do not mint a bespoke class per component.** Every
   card/panel surface is the one shared `.card`. No `.task-card`, no `.detail-panel`. Add a
   **modifier** only for a real visual variant.
3. **Prefer extending an existing rule over adding a new block.**
4. When a pattern appears a **second** time, extract it to the global sheet immediately —
   do not wait for the third.
5. Component-specific CSS is minimal and only for genuinely unique layout.

### Naming — BEM

`.block`, `.block__element`, `.block--modifier`.

### Class inventory to reuse first

Carried over from `../contacts` — reach for these before writing anything new:

**Layout/shell:** `.container` `.app-main` `.app-view` `.nav` `.nav__inner` `.nav__brand`
`.nav__links` `.nav__version` `.toolbar` `.toolbar__actions` `.wordmark` `.skip-link`
**Surfaces:** `.card` `.card--flush`
**Lists:** `.list` `.list__header` `.list__row` `.list__primary` `.list__secondary`
**Forms & actions:** `.form` `.form__actions` `.field` `.field__error` `.field--inline`
`.btn` `.btn--primary` `.btn--ghost` `.btn--danger` `.btn--sm` `.modal` `.modal__dialog`
`.modal__actions`
**State:** `.error` `.notice` `.is-overdue` `.badge` `.badge--overdue` `.badge--pending`
`.conn` `.conn--offline`
**Utilities:** `.text-muted` `.text-meta` `.text-preline` `.visually-hidden` `.mt-2`
`.stack`

### Brand

Devilsberg dark — Onyx canvas, Ghost White text. Tokens, typography scale, motion rules,
accessibility floor and voice are specified in `../contacts/docs/conventions.md` §8; copy
the token block verbatim rather than re-deriving it. Load the
`devilsberg-brands:devilsberg-brand` skill when producing copy or design.

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
asset means adding it to `SHELL` *and* bumping `CACHE`. That is also why `vite.config.js`
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

## Agile Workflow

This project uses the agile plugin. Follow these rules when building features.

### Flow

```
1. Human writes user stories to docs/user-stories/backlog/
2. /agile:shape <story-slug> [<story-slug2> ...]
        → product-manager reads stories and shapes a sprint plan → saved to docs/sprints/
        STOP: human reviews and approves plan
3. /agile:execute docs/sprints/<sprint-slug>.md
        → developer implements (TDD: tests first, then implement)
        STOP: human reviews the work
4. /agile:review (optional, ad-hoc)
        → reviewer reports findings inline
        → human fixes defects now or creates new user stories
5. /agile:wrap-sprint
        → documents sprint in docs/system.md
        → moves user stories to docs/user-stories/done/
        → deletes sprint plan
6. /agile:commit → commit and push
```

### Rules

- Never start building without an approved sprint plan in `docs/sprints/`
- Sprint plans are the single source of truth for the sprint — update them as execution progresses
- Developer writes tests first, then implements — never skip writing tests
- Tests live in a seperate directory structure in the project root /tests
- Review is user invoked — trigger it with `/agile:review`
- Defects found in review become new user stories
- Do not make changes outside project directory

### Directory structure

- `docs/user-stories/backlog/` — pending user stories (human-written)
- `docs/user-stories/done/` — completed user stories (moved here by `/agile:wrap-sprint`)
- `docs/sprints/` — active sprint plans (deleted after `/agile:wrap-sprint`)
- `docs/system.md` — cumulative decisions and outcomes

### User story format

File naming: `NN-story-name.md` — use a two-digit number prefix to control ordering (e.g. `01-user-authentication.md`, `02-password-reset.md`).

```markdown
---
story: <Story Name>
created: YYYY-MM-DD
---

## Description

<What needs to be built and why>

## Acceptance Criteria

- <criterion 1 — specific and testable>
- <criterion 2>
```

### Human gates

1. After `/agile:shape` — approve the sprint plan before executing
2. After `/agile:execute` — review the work and decide whether to run `/agile:review`
