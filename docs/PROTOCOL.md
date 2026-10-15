# Protocol

Source of truth: [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts). Current version: **1.0.0**.

## Status model

| `ActivityStatus` | Derived from | Rendered as |
|---|---|---|
| `offline` | no event in 2h, or `actor.leave` | dimmed, no icon |
| `idle` | present, no activity in 20 min | slow bob |
| `coding` | push, PR opened/updated, agent edits | typing |
| `reviewing` | review requested / submitted | 🔍 |
| `discussing` | issue/PR comment | 💬 |
| `building` | CI running / agent running tests | ⚙️ spinning |
| `blocked` | CI failed, changes requested | ❗ bouncing + bubble |
| `celebrating` | PR merged (30 s) | jumping + confetti |
| `in_room` | moved into a room / chatted | sits in the room |
| `focus` | moved into a focus room | 🎧, dimmed |

Priority (higher wins while the current status is fresh):
`offline < idle < in_room < discussing < reviewing < coding < building < blocked < focus < celebrating`.

## Event ids

Must be unique and stable per upstream fact so redelivery is idempotent:
- Webhooks: `<X-GitHub-Delivery>:<suffix>`
- Lite REST: `c:<sha>`, `pr:<n>:open|merged`, `i:<n>`, `run:<id>`
- Agents: `<session>:<seq>`

## Versioning

`protocolVersion` is semver. Minor = additive fields (consumers ignore unknown fields).
Major = anything else; consumers reject a different major (`assertOfficeState`).
