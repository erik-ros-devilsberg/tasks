---
story: Service Worker Cache Stamped at Build
created: 2026-09-16
---

## Description

Installed phones kept running the previous build after the styling rework was deployed.
The worker is cache-first and a browser only installs a new worker when `sw.js` is
byte-different, so a deploy that did not hand-bump `CACHE` changed nothing on the device.
The footer version could not tell the builds apart either — the commit had bypassed
`/agile:commit`, which is what bumps `version.json`.

Remove the manual step: the build stamps the worker's cache name with the app version, so
every build is a new worker and every deploy reaches installed devices.

Written after the fact — this was built as a direct fix in the session that found the
problem, without a shaped sprint. Recorded here so the decision has the same paper trail as
everything else.

## Acceptance Criteria

- `npm run build` writes `dist/sw.js` with `const CACHE = 'coevta-tasks-<version>'`, where
  `<version>` is the value in `version.json`.
- The source `public/sw.js` is not modified by the build and ships a name (`coevta-tasks-dev`)
  that no built worker ever carries.
- The stamped name keeps the `coevta-tasks-` prefix the activate handler uses to delete old
  caches.
- Stamping fails the build loudly if the `CACHE` line is missing rather than silently shipping
  the source name.
- The pure stamping function is unit-tested; `npm test` and `npm run build` are green.
- `CLAUDE.md` §8 and `docs/system.md` no longer instruct anyone to bump `CACHE` by hand.
