---
story: Authentication and Session
created: 2026-08-31
---

## Description

Nothing in the app works without a Sanctum bearer token, so sign-in comes before any task
data. A login view exchanges credentials for a token, the token is held in `localStorage`,
every API call carries it, and a `401` anywhere returns the user to login with the session
cleared.

Registration and password reset stay on the server — the login view links out to
forgot-password rather than owning a copy.

## Acceptance Criteria

- `lib/api.js` is a framework-free fetch wrapper: prefixes `/api/v1`, sets
  `Authorization: Bearer <token>` when a token is held, sets `Accept: application/json`, and
  surfaces the HTTP status to callers rather than throwing on non-2xx.
- `stores/session.js` is a Pinia setup store exposing the token, the signed-in state,
  `login(email, password)` and `logout()`.
- `POST /login` returning `200` stores the token in `localStorage` and routes to the task
  list.
- `401` on login shows the server's message ("These credentials do not match our records.")
  without clearing what the user typed.
- `429` on login shows a "too many attempts, try again shortly" notice — the endpoint is
  throttled 6/min.
- `logout()` calls `POST /logout`, clears the token from `localStorage` and Pinia, and routes
  to login. It clears locally even when the request fails — a dead network must not trap the
  user in a session.
- A `401` from any other endpoint clears the session and `router.replace`s to login.
- The router guard sends an unauthenticated visitor to `/login` and an authenticated one away
  from it.
- The login view links out to the server's forgot-password flow.
- Tests cover: token persisted on success, token read back on reload, `401` and `429`
  handling, logout clearing locally despite a failed request, and the guard in both
  directions.
