# Security Policy

## Supported versions

Repofloor is pre-1.0 and ships from `main`. Only the latest commit on `main` — and the
`apps/lite-action` bundle published from it — receives security fixes. Pin the action to a tag
or commit SHA if you need a stable target.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/repofloor/repofloor/security/advisories/new).
If that is not available to you, contact [@aliosmanmho](https://github.com/aliosmanmho)
privately via the contact details on that profile.

Please include what you can: affected component (`protocol`, `reducer`, `engine`, `demo`,
`lite-action`), reproduction steps, and the impact you see. We aim to acknowledge a report
within 72 hours and to agree on a fix and disclosure timeline with you.

## What is in scope

- `apps/lite-action` — the Action that runs in *your* workflow with *your* `GITHUB_TOKEN`:
  token handling, command injection, anything it writes into the published site.
- `packages/*` — the protocol, reducer and renderer shipped to the published page.
- The published office page itself (for example, injection through repository or user content
  that ends up rendered in `office-state.json`).

Out of scope: GitHub itself, GitHub Pages infrastructure, and findings that require an already
compromised token or runner.

## What Lite publishes

The Lite action reads your repository through the GitHub REST API with the token you give it
(the default `GITHUB_TOKEN` is enough for a public repo) and writes `office-state.json` next to
a static page. That file contains **public repository activity only**: logins, avatar URLs,
counts, branch and CI status, PR and issue titles.

It never writes secrets, and it needs no secrets beyond the token. On a private repository,
remember that anything the action publishes to GitHub Pages inherits the visibility of your
Pages site — check that setting before pointing the action at a private repo.
