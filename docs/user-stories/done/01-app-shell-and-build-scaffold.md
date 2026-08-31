---
story: App Shell and Build Scaffold
created: 2026-08-31
---

## Description

Stand up the Vue 3 + Vite + Pinia project so every later story has somewhere to land. This
is the skeleton only — a shell, a router with one route, and a green test run. No task data
yet.

The stack and layout are fixed by `CLAUDE.md` §2 and §3. Mirror `../contacts` where it is
silent.

## Acceptance Criteria

- `package.json` is `"type": "module"`, `"private": true`, with `vue`, `vue-router` and
  `pinia` as the only runtime dependencies; `vite`, `vitest`, `@vitejs/plugin-vue`,
  `@vue/test-utils` and `jsdom` as devDependencies.
- Scripts exist for `dev`, `build`, `preview` and `test` (`vitest run`).
- `vite.config.js` aliases `@` → `./src`, defines `__APP_VERSION__` from `version.json`, and
  proxies `/api` to `VITE_SERVER_URL` (default `http://127.0.0.1:8040`).
- `vitest.config.js` mirrors the alias and the `__APP_VERSION__` define, uses
  `environment: 'jsdom'`, `globals: false`, and includes `tests/**/*.test.js`.
- `.env.example` documents `VITE_SERVER_URL` and states it is development-only.
- `src/main.js` creates the app, installs Pinia and the router, and mounts it.
- `src/App.vue` is the shell: semantic `<nav>` / `<main>` and a `<RouterView/>`, no `<style>`
  block.
- `src/router.js` exports a router with at least the tasks list route; navigation is history
  mode.
- A test asserts the app mounts and renders the router view.
- A test asserts the router resolves the root path to the tasks list route.
- `npm test` and `npm run build` both pass.
