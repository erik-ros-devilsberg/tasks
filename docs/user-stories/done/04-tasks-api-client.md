---
story: Tasks API Client
created: 2026-08-31
---

## Description

A framework-free `lib/tasksRemote.js` over the server's task endpoints. No Vue, no Pinia —
plain JavaScript, unit-testable without a DOM. This is the only module that knows the shape
of the wire.

`GET /tasks` returns the whole list in one response — there is no pagination. The behaviour
that does have to be handled here rather than left to the views is that `PUT` is a full
replacement, and reopens a task when `completed_at` is omitted.

## Acceptance Criteria

- Exports `createTasksRemote({ api })` returning `listAll`, `get`, `create`, `update`,
  `complete`, `remove`.
- `listAll()` issues a single `GET /tasks` and resolves to a flat array of every task. The
  endpoint returns the complete list — no page walking, no `page` parameter.
- `create(body)` posts to `/tasks` and returns the created task; an empty body is a valid
  create (the server defaults the title to "Untitled task").
- `update(id, body)` uses `PATCH` for partial edits. Where `PUT` is used it sends a complete
  body built from the whole record, `completed_at` included — a test must prove a save on a
  completed task does not reopen it.
- `complete(id)` posts to `/tasks/{id}/complete` with **no body**, and is safe to call twice.
- `remove(id)` deletes and treats `204` as success.
- `due_at` round-trips at the granularity given: a date-only `YYYY-MM-DD` stays date-only, a
  datetime stays an ISO 8601 UTC datetime. The client never silently promotes one to the
  other.
- Non-2xx responses are reported to the caller with their status — `401`, `404`, `422` and
  `5xx` are distinguishable.
- Tests stub `fetch` with `vi.stubGlobal` and cover: `listAll` returning the whole list from
  one request, the no-body complete, the complete-body save, `due_at` granularity both ways,
  and each failure status.
