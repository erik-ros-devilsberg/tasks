---
story: Offline First and Android Install
created: 2026-09-01
---

## Description

The app must be fully functional with no connection, and must install on Android as a
standalone app.

This reverses the decision recorded in `CLAUDE.md` §8 and in `docs/system.md` ("Online-only,
with the seam left in"). The sibling contacts app already solves this — IndexedDB behind a
narrow `kv` interface, a durable coalescing outbox, a serialized sync drain, `local-`
temporary ids — and that machinery is ported here rather than reinvented.

Tasks differ from contacts in one way that matters: completion is its own endpoint and its
own pair of operations. The outbox has to carry `complete` and `reopen` alongside `create`,
`update` and `delete`, and an `update` must never carry `completed_at` — that is how a queued
edit silently reopens a finished task.

Installing on Android additionally needs a web app manifest, a service worker that precaches
the shell, and icons.

## Acceptance Criteria

### Working offline

- Every read comes from the device. The task list renders with the connection off, from a
  cold start, including after the browser has been closed and reopened.
- Creating, editing, completing, reopening and deleting a task all work offline and are
  visible immediately.
- Writes made offline are queued durably, survive a reload, and are sent in order when a
  connection returns.
- Repeated edits to the same task while offline send one request, not one per edit.
- A task created offline and then edited or deleted before it ever syncs does not produce a
  request against an id the server has never issued.
- The queue drains once, not twice, when start-up and the `online` event fire together.
- A `401` during sync keeps the queue and sends the user to sign in. A `404` on an update or
  delete reconciles locally. A `422` is dropped and reported rather than left to block
  everything behind it. Anything transient stops the drain rather than skipping ahead.
- A refresh from the server never overwrites a record with work still queued against it.
- Signing out clears the cached tasks and the queue — the device is shared.

### Showing the state

- The user can see when they are offline, and how many changes are waiting to be sent.
- A task with unsent work is marked as such in the list.
- Changes rejected by the server are reported rather than swallowed.

### Installing on Android

- The app is installable from Chrome on Android and launches standalone, with no browser
  chrome, its own icon and its own splash screen.
- A cold start with no connection loads the app shell, not the browser's offline page.
- A refresh on `/tasks/new` or `/tasks/{id}/edit` works offline as well as online.
- API responses are never served from the HTTP cache — the offline layer owns that data.
- A new version tells the user rather than reloading the page under whatever they are typing.
