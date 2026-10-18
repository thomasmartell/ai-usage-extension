# AI Usage Tracker

[![CI](https://github.com/cupcakedev/ai-usage-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/cupcakedev/ai-usage-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A Chrome extension (Manifest V3) that tracks your **Claude** and **Codex** usage
limits — including 5-hour session and 7-day weekly windows when the providers
return them — and surfaces them in a popup and the toolbar icon.

## Features

- **Live limits** for Claude and Codex: percentage used, raw counts, and time to reset.
  Codex windows are labelled from the duration returned by the service rather than
  assuming fixed primary and secondary periods.
- **GitHub allowances** (optional): sign in with GitHub's device code to see this
  month's Actions minutes against your plan's included minutes, and spend against
  each organization budget, for your account and every organization whose billing
  you can read. The allowance comes from the plan (Free 2,000, Pro and Team 3,000,
  Enterprise 50,000 minutes), since GitHub's billing API does not report it.
  Sign-in asks for `read:org` and `user`, which covers your personal billing.
  GitHub's org billing endpoints only accept `admin:org` from an OAuth token, so
  for an organization choose **Use a token instead** and paste a fine-grained
  token owned by the organization with read-only **Administration** and **Plan**
  access, plus the organization's login (fine-grained tokens cannot list orgs).
  The card also shows how much of your hourly GitHub API allowance is used. That
  allowance is shared with `gh` and anything else acting as you, so it shows when
  something is close to running it out.
- **Netlify credits** (optional): paste a Netlify personal access token to see
  each team's monthly plan credits and purchased add-on credits. Teams on
  legacy plans see build minutes and bandwidth for the billing cycle instead.
- **Full view**: the expand button opens the dashboard in its own tab, free of
  the 800×600 popup limit. Claude and Codex sit beside GitHub and Netlify in one
  row of four on a wide screen, or as a 2×2 grid on a narrower window.
- **Toolbar icon** with one bar per connected service, each filled to the figure its
  card leads with and coloured amber or red as it nears the limit.
- **Background refresh** via `chrome.alarms`: Claude and Codex every 5 minutes,
  Netlify every 15 and GitHub every 30, since billing figures change slowly and
  GitHub's hourly request allowance is shared with everything else using your
  account. The refresh button fetches everything at once.
- **Private by design**: usage is read from your own authenticated sessions with
  Claude and OpenAI, and from GitHub's API with a token only you grant. No external
  servers, no accounts, no tracking.

## Install

The extension is not distributed through npm. For normal use, install a packaged
release from the GitHub releases page or load a local build in Chrome.

To load a local build:

```bash
corepack enable
pnpm install
pnpm build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` directory.
4. Sign in to `claude.ai` and `chatgpt.com`, then open the popup and refresh.

## Architecture

The extension is split into isolated contexts that communicate through a typed
messaging layer:

```text
src/
  background/   # Service worker: scheduling, fetching, badge updates
    services/   # UsageService — fetches & parses provider APIs
  sidepanel/    # Popup UI (React)
    components/ # Presentational components
    hooks/      # useUsageData — owns the popup's data lifecycle
  shared/       # Cross-context layer — no context-specific imports
    constants  # Storage keys, alarm name, thresholds
    hooks      # Framework hooks (useNow)
    messaging  # Typed message helpers (readUsageState, requestUsageRefresh)
    types      # Domain & messaging types
    utils      # clampPercent, getUsageTone, formatReset, formatRelativeTime
```

**Data flow:** the background worker fetches usage, writes a `UsageState` snapshot to
`chrome.storage.local`, and updates the toolbar icon. The popup reads that snapshot
and subscribes to `chrome.storage.onChanged`, so it stays in sync.

## Getting Started

### Requirements

- Node.js 20 or newer
- pnpm 9.15.0 via Corepack
- Chrome or another Chromium browser that supports Manifest V3 extensions

### Install dependencies

```bash
corepack enable
pnpm install
```

### Develop

```bash
pnpm dev
```

Builds to `dist/` and watches for changes.

### Verify

```bash
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

## Scripts

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `pnpm dev`           | Build and watch for development.              |
| `pnpm bump`          | Bump `package.json` and `manifest.json` patch versions. |
| `pnpm build`         | Type-check, then produce a production build.  |
| `pnpm release`       | Test, build, and package `dist/` into `release/*.zip`. |
| `pnpm typecheck`     | Run `tsc` with no emit.                       |
| `pnpm test`          | Run regression and store metadata checks.     |
| `pnpm lint`          | Lint `src/` with ESLint.                      |
| `pnpm format`        | Format `src/` with Prettier.                  |

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
before opening a larger change.

## Security

Please do not open public issues for suspected vulnerabilities. Follow
[SECURITY.md](./SECURITY.md) instead.

## License

MIT
