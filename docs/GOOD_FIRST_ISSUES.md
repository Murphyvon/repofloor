# Good first issues (starter list)

Open any of these as a GitHub issue with the `good first issue` label, claim it in a comment, go.

## Engine (visual, fun, low risk)
1. **Plants grow with issue count** — more open issues, bigger plant. `renderer.ts` props.
2. **Door opens when a new actor enters** — swap the door graphic for ~600 ms. `renderer.ts` setState.
3. **Idle people drink coffee** — if `status === "idle"` and near the coffee machine, show ☕ in hand. `avatar.ts`.
4. **Night mode** — tint the floor by the viewer's local hour (22–06 darker, lamps glow). `renderer.ts`.
5. **Walking avoids desks** — simple A* on the tile grid instead of straight lines. `avatar.ts` + `layout.ts`.
6. **Celebrating gets a party hat** — tiny triangle above the head while `celebrating`.
7. **Agent robots differ per provider** — different antenna/visor for `claude-code`, `codex`, `gemini-cli`. `avatar.ts`, `paletteFor`.

## Reducer / protocol
8. **`pr.draft` handling** — draft PRs should not pull reviewers in. Add a test.
9. **Issue assignment → `discussing`** — currently assignment only registers the actor. Decide and test.
10. **Status priority table in docs** — document `PRIORITY` in `docs/PROTOCOL.md` with examples.

## Lite action
11. **Keep last 24 snapshots** — write `history/<timestamp>.json` and a `history.json` index for a future timeline.
12. **`exclude-bots` input** — drop `[bot]` actors from the snapshot.
13. **Badge** — emit `badge.json` in shields.io endpoint format: "N active".

## Demo / docs
14. **Turkish and English UI strings** — pull the demo's labels into a tiny i18n map.
15. **Text alternative** — render "Ali is coding on feat/rooms, Ayşe is reviewing #12…" under the canvas for screen readers.
16. **Screenshot workflow** — a GitHub Action that runs Playwright on `apps/demo` and uploads a PNG on every PR.
