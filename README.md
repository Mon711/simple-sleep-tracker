# Simple Sleep Tracker

A private, mobile-first tracker for the time you go to bed and the time you wake up. A check-in records a clock time. The app does not estimate how long you slept.

## What it does

- **Today** gives the next check-in the larger button. When a recent bedtime has no paired wake time, Morning moves to the top. **Log now** saves the server’s exact current time and confirms the save without opening a form.
- **History** shows 7-, 30-, and 180-night views with adjustable end dates. It plots recorded times and historical targets, shows recorded detail counts when available, and lets you add or edit earlier check-ins. JSON and CSV downloads include all your records and goal revisions.
- **Goals** starts with seven calendar days of baseline time after the first logged night. Set one or both target times when ready. Choose weekly or monthly review and a shift of 1–60 minutes earlier or later. Accept proposals explicitly, edit a plan manually, or pause it.
- **Android** can open the app from its home screen when served over HTTPS. The offline screen explains how to reconnect. A connection is required to see or save records.

Example for developers only: a bedtime recorded at 12:10 am on 19 May can be assigned to the night of 18 May. The app stores the night date and exact timestamp separately. The initial and only display timezone in V1 is Asia/Kolkata.

## Run locally with synthetic data

Use a current patched Node.js release with Node 22.20 or newer. All commands in this section run from the project folder.

| Command | Effect and expected result |
| --- | --- |
| `npm ci` | Installs the locked dependency versions into `node_modules/` and prints a package count. Use this once after cloning and again when the lockfile changes. |
| `npm run build` | Creates ignored output under `dist/`. Expect a Vite build summary and a generated Worker at `dist/server/index.js`. |
| `npm start` | Starts the built app on this computer only at `http://127.0.0.1:4175`. It creates an ignored synthetic SQLite database under `data/synthetic/` if needed. |

Open that address in a browser and choose **Open synthetic tracker**. Use fictional times and details. Stop the local server with Control-C in the terminal. The synthetic profile deliberately has an easy sign-in for testing.

## Test

Run from the project folder. Each test writes only isolated, fictional data. Browser screenshots are local and ignored by Git.

| Command | What it checks |
| --- | --- |
| `npm run lint` | Checks code rules. Success exits with no findings. |
| `npm run typecheck` | Checks TypeScript data types. Success exits with no diagnostics. |
| `npm test` | Runs time, storage, data isolation, goal, export, and MCP tests in Vitest. Expect a passing test count. |
| `npm run test:worker` | Runs the built Sites Worker against a temporary D1 database using Miniflare. Build first. |
| `npm run test:private` | Runs the built private server on loopback with synthetic proxy headers and data. Build first. |
| `npm run test:browser` | Drives the full browser flow at two Android-size viewports and desktop. Build first. Uses separate temporary Chrome profiles and databases. |
| `npm audit --audit-level=low` | Checks the lockfile for known dependency advisories, including build and test dependencies. Success reports zero vulnerabilities. |

For the browser tests, set `PLAYWRIGHT_CHROME_CHANNEL=chrome` when Google Chrome is already installed. Otherwise `npx playwright install chromium` downloads the test browser to Playwright’s cache. Expect a browser download summary. That command installs a test browser separately from your normal browser.

## Hosting and install

The Sites build supports schedules and goals. It **rejects and withholds** mood, bedtime difficulties, rested feeling, and nightmare fields on the server while the platform guidance remains unclear for those fields. The private profile supports all optional fields and keeps them in the local SQLite database. It runs behind Tailscale Serve, which authenticates devices on your private network and passes the verified account name. The host computer must be awake and connected.

See [Release and hosting](docs/release.md) for the approval requirements, setup, and post-release checks. On Android, open the approved private HTTPS address in Chrome and use the browser’s install or Add to Home screen option. Launch it from the icon and verify a synthetic check-in survives reopening. [Chrome web app help](https://support.google.com/chrome/answer/9658361)

## MCP from ChatGPT or Codex

Model Context Protocol (MCP) lets an authorized chat call tracker operations by name. The five read tools list check-ins, open a specific check-in, summarize a week or month, show plans, or count optional details where supported. The three write tools create, edit, or pause goals. Use `get_sleep_goals` to get the current revision number before a write. Daily check-ins can be changed only in the tracker itself.

- **Sites** creates a personal ChatGPT plugin after an approved owner-private deployment. Connect through the plugin card, then check the read tools and goal changes with synthetic data.
- **Private server** exposes the same tools at the private HTTPS address followed by `/mcp`. Desktop Codex can use a Streamable HTTP server, which sends requests over the web connection. Use an owner-authenticated Tailnet device or supply a separately configured random bearer token through an environment variable. Connecting a privately hosted full read/write server directly to ChatGPT Plus is not currently verified.

Examples for connected chats: “Show my last seven nights of check-ins” and “Read my current plan and ask me before moving the wake target 10 minutes earlier.” Data returned by a chat tool may be included in the conversation. [Codex MCP configuration](https://developers.openai.com/codex/mcp) · [Sites plugin setup](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

## Storage and backups

Access to saved records, exports, and MCP is checked on the server. The app has no telemetry or third-party assets. The browser’s offline cache contains only the offline message and its stylesheet. JSON exports are versioned and preserve precise timestamps, night dates, timezone and goal history. CSV is formatted for spreadsheets. Downloaded files should be kept private.

The exports are portable copies. V1 has no in-app importer. The private profile can restore its SQLite database from a consistent SQLite backup. The local tests read an isolated backup with both records and goals. Sites documents no built-in operation to restore a database and files into a new Site together. Regular exports are important for either profile. [Sites storage and backup guidance](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)

[Architecture](docs/architecture.md) · [Decisions](docs/decisions.md) · [Changelog](CHANGELOG.md)
