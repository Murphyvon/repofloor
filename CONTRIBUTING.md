# Contributing to Repofloor

Thanks for stopping by the office. Everything here is MIT and built in public; the office on
our Pages site is literally the people in this file's git log.

## Quick start

```bash
git clone https://github.com/repofloor/repofloor
cd repofloor
pnpm install
pnpm build        # builds packages, demo, and the action bundle
pnpm dev          # demo with a simulated team at http://localhost:5173
pnpm test
```

Node ≥ 20 and pnpm ≥ 9. No other tooling.

## Where things live

| I want to… | Look in |
|---|---|
| change how a GitHub event affects someone's status | `packages/reducer/src/index.ts` (+ a test in `tests/`) |
| support a new webhook | `packages/reducer/src/github.ts` |
| add an animation, prop, room style | `packages/engine/src/avatar.ts`, `renderer.ts`, `layout.ts` |
| change what Lite collects | `apps/lite-action/src/collect.ts` |
| add a field to the data model | `packages/protocol/src/index.ts` → bump `PROTOCOL_VERSION` if breaking |
| work on the hosted mode | `docs/ARCHITECTURE.md` first, then `apps/api`, `apps/realtime`, `apps/web` |

## Pull requests

- Small PRs. One behaviour per PR.
- Reducer changes need a test. Engine changes need a screenshot (or short GIF) of `pnpm dev`.
- Run `pnpm build` before committing if you touched `apps/lite-action` or anything it bundles
  (`packages/*`, `apps/demo`); CI fails if `apps/lite-action/dist/index.js` is stale.
- Conventional commit prefixes are welcome but not enforced: `feat:`, `fix:`, `docs:`, `chore:`.

## Good first issues

Labelled [`good first issue`](https://github.com/repofloor/repofloor/labels/good%20first%20issue).
Starter list in [`docs/GOOD_FIRST_ISSUES.md`](docs/GOOD_FIRST_ISSUES.md) — if one isn't opened as an issue yet, open it and claim it.

## Design principles (read before a big PR)

1. **The engine never knows the data source.** Lite and Full must not fork.
2. **Reducer is pure.** No I/O, no `Date.now()`; time comes from events.
3. **Procedural first.** The default look needs no assets; skins are optional layers.
4. **Mirror GitHub permissions.** Never invent a second ACL.
5. **Not a surveillance tool.** Detail levels are per-user settings; we show *what*, not *how long*.

## Code of conduct

Be kind, assume good intent, keep it welcoming to first-time contributors. We follow the
[Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
