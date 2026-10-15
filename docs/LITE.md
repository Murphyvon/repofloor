# Repofloor Lite

The free, serverless office. A GitHub Action snapshots your repository's recent activity
and publishes a static office page to GitHub Pages.

## Setup

1. Add `.github/workflows/office.yml` (the minimal version is in the [README](../README.md);
   the fuller one with all triggers is this repo's own [office.yml](../.github/workflows/office.yml)).
2. **Settings → Pages → Source: GitHub Actions.**
3. Run the workflow once from the Actions tab (or push to `main`).

Your office lives at `https://<owner>.github.io/<repo>/`. Add it to the README:

```md
[![Office](https://img.shields.io/badge/🏢-visit%20our%20office-6d28d9)](https://<owner>.github.io/<repo>/)
```

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `token` | `${{ github.token }}` | Needs `contents:read`, `actions:read`, `pull-requests:read`, `issues:read` |
| `repository` | current repo | `owner/repo` to snapshot (another repo needs a token that can read it) |
| `hours` | `48` | Look-back window |
| `output-dir` | `repofloor-site` | Where `index.html` + `office-state.json` are written |

## What you get

- A desk for every contributor (top 30), avatar colours derived from their login.
- Status from the last `hours`: coding (commits / open PR), reviewing (review requested),
  blocked (changes requested), building (CI running), celebrating (merged recently),
  idle, offline.
- Open PRs and issues on the wall board; the CI lamp shows the default branch status.
- Hourly cron keeps idle/offline decay honest even when nobody pushes.
- A tab left open re-reads `office-state.json` every 15s (and whenever you come back to
  the tab), so it follows along without a reload: people walk to their new desk or room,
  the CI lamp changes, a fresh merge gets its confetti. The poll is conditional, so an
  unchanged snapshot answers 304. Between snapshots the page keeps ageing the one it
  has, so nobody looks busy an hour after they stopped.

### How fresh is it?

An event reaches the office in roughly **30-50 seconds**: the workflow takes ~30s from
trigger to published page (queue, snapshot, Pages deploy) and the open page notices
within 15s. That is the floor for a serverless setup — the Actions queue sets it, not
the page. Sub-second presence needs a webhook receiver, which is Full mode.
- A camera: drag to pan, scroll (or the +/- buttons) to zoom, double-click to fit the
  whole floor again. A hundred-person office stays readable — zoom in on one corner.

## What you don't get (needs Full mode)

Live presence, who is on the page right now, chat, rooms, emoji selection, agent
telemetry, cross-repo buildings.

## Privacy

The snapshot contains only what GitHub already shows to anyone who can see the repo:
logins, avatar URLs, commit/PR/issue titles and links. **If your repository is private,
your Pages site is public by default** (unless you're on GitHub Enterprise with private
Pages). Either keep Lite to public repos, or publish `repofloor-site/` somewhere access-controlled instead of Pages.

## Using the JSON yourself

`office-state.json` follows [`@repofloor/protocol`](../packages/protocol/src/index.ts).
Anything that can render that file is a valid Repofloor client — a terminal UI, a
Raspberry Pi display in your real office, a Slack bot.
