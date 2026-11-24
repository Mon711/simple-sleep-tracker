# Release and hosting

Phase 2 is complete locally. Gate 2 is the separate approval for any push, Sites upload or deployment, access change, credential setup, or charge. The proposed public repository contains source and synthetic tests only.

## Verified on 23 November 2026

| Check | Local result |
| --- | --- |
| `npm ci` | Recreated the locked dependencies from scratch in a disposable directory. |
| `npm run lint` and `npm run typecheck` | Both passed. |
| `npm test` | 19 passed. Covered exact timestamps, midnight and leap dates, chronology, concurrency and stale edits, optional fields, goal calculations and revisions, isolation, authorization, JSON/CSV, and the eight MCP tools. A SQLite backup was opened and its synthetic check-in and goal were read back. |
| `npm run build` | React browser build and Worker ES module built. Browser JavaScript was about 77 kB compressed. |
| `npm run test:worker` | Ran the built Worker against temporary D1 in Miniflare. Verified the real migration, static assets, denied anonymous access, separated two owners, checked wellness redaction, verified chronology, read an export, and ran MCP reads and a goal write. |
| `npm run test:private` | Verified the loopback private server with synthetic proxy identity. Checked denied unknown identity, a wrong host, a separate MCP credential, cross-site requests, the saved check-in, and private database file permissions. |
| Playwright in Chrome | Three passes at 360×800, 390×824, and 1280×900. The installed Chrome channel used disposable test profiles. |
| `npm audit --audit-level=low` and production-only audit | Both reported zero known vulnerabilities after upgrading build and test tooling. The beta Miniflare version is pinned for the local test suite and is absent from production. |
| Sites archive rehearsal | Ran the installed Sites package helper against a local copy with a fictional project ID. The archive contained the Worker, migration, and manifest and excluded databases, credentials, logs, and test output. |

Playwright exercised sign-in and sign-out, honest empty states, both quick check-ins, priority changing from Evening to Morning, persistence on reload, editing a saved time, optional fields, backdating, all three history ranges, creating, editing and pausing a plan, downloading and reading both export formats, and authenticated MCP. Chromium reported no installability errors in non-incognito test profiles. The offline screen loaded from its two static cache files. The test shortened the mobile viewport with the editor open and confirmed the Save control could be brought into view. Automated accessibility scans on Today, expanded editor, History, and Goals reported zero violations. No unexpected browser console errors or third-party requests occurred.

## Security review

- Authentication runs before every records, export, and MCP route. The server resolves the owner and every SQL operation scopes to that owner. Cross-account test reads returned empty. The production Worker excludes the synthetic sign-in server.
- The browser requires the same origin for writes and rejects cross-site private requests. Browser-origin MCP is denied. Private instance bearer credentials are accepted only for MCP. The browser’s content policy allows only same-origin assets and network requests. Responses with records use `private, no-store`.
- Inputs have strict shapes and a size limit. Records use fixed optional choices, bound SQL parameters, and database constraints. Immutable record IDs and revisions prevent an old editor from overwriting a replacement. Conflicts produce a safe error without exposing SQL statements or records.
- The Sites runtime rejects any nonblank optional wellness fields. It also withholds those values from reads, exports, and MCP if they are present in an isolated test database. The private SQLite file is restricted to its OS owner. Private hosting relies on a trusted computer and Tailscale Serve’s authenticating proxy.
- The browser does not persist private records in browser storage or offline caches. The app contains no analytics, third-party fonts, or remote image requests.

## Remaining verification

- No live Site exists for this project. Verify owner-only access, denial of spoofed anonymous identity, platform sign-in, migration, real Android installation, export, and connected ChatGPT MCP with synthetic data after explicit approval. Worker simulation verifies app behavior and cannot verify OpenAI’s dispatch or your account’s plugin.
- A physical Android device and real Tailscale HTTPS sessions were not available to this local check. Chrome mobile emulation does not open the Android system keyboard or install a real home-screen icon.
- Sites Terms prohibit HIPAA-defined Protected Health Information. Public guidance leaves the optional wellness fields unclear. Any Sites release is limited to a synthetic schedule/goal trial until the real-data scope is confirmed. The private version includes all fields, but full private-server MCP in ChatGPT Plus is unverified. Desktop Codex is the private connectivity option.
- V1 requires a connection to log or view records. The local host must be awake. App exports are portable files. The app has no importer, and the fallback database is protected by private file permissions and the host’s disk security.

## Exact source intended for the first GitHub push

- Root config and docs: `.env.example`, `.gitignore`, `AGENTS.md`, `CHANGELOG.md`, `README.md`, `eslint.config.mjs`, `index.html`, `package-lock.json`, `package.json`, `playwright.config.ts`, `tsconfig.json`, `vite.config.ts`.
- Sites and schema: `.openai/hosting.json`, `drizzle/0000_tracker.sql`, `drizzle/meta/_journal.json`, `scripts/build-worker.mjs`.
- Browser and install assets: `src/client/{EntryEditor,Goals,History,Modal,Today,Trend,main}.tsx`, `src/client/api.ts`, `src/client/styles.css`, `public/{icon-192.png,icon-512.png,manifest.webmanifest,offline.css,offline.html,sw.js}`.
- Data and server: `src/shared/{options,schemas,time}.ts`, `src/server/{errors,http,mcp,sites,store,tracker}.ts`, `src/server/assets.d.ts`, `local/{assets.mjs,assets.d.mts,server.ts,sqlite.ts}`.
- Verification and project docs: `tests/tracker.test.ts`, `tests/worker.mjs`, `tests/private.mjs`, `tests/e2e/tracker.e2e.ts`, `docs/{agent-lessons,architecture,decisions,release}.md`.

The GitHub target is the empty public repository `Mon711/simple-sleep-tracker`, branch `main`. The project directory cannot write its own `.git` metadata under the current sandbox. The 53 source files were staged for inspection in a writable temporary clone. Gitleaks reported no secrets in the staged diff and no reachable history to scan. The stage excludes build output, credentials, local databases and exports, unused design variants, and browser test artifacts. Recheck the remote and inspect the staged changes again before pushing.

## Release options after approval

### GitHub source

Confirm the remote and staged contents. Repeat the secret scan if the stage changes. Make the first local commit in the writable checkout, push to `main`, then verify the published commit matches the reviewed stage.

### Private real-data setup

Use a trusted, regularly patched computer as the host. Put values from `.env.example` in a private file outside the checkout. Set the profile to `private`, the origin to the exact HTTPS Serve URL, the owner login to the verified Tailnet account, and the database to a private absolute path outside source control. A Tailnet is a private network connecting authorized devices.

From the project folder, after building, start Node with the private settings file:

```sh
node --env-file=/absolute/private/tracker.env --experimental-transform-types local/server.ts
```

The first flag loads the private settings. The second lets this version of Node run the small TypeScript server. It creates a private database if needed and prints the loopback address. It does not publish the app. Keep the settings file and database accessible only to the host account.

Point Tailscale Serve at the configured local port using its documented HTTPS procedure. Verify the Serve URL is restricted to authorized devices and stays out of public Funnel mode. Connect from the owner’s Android and desktop, verify that another account is denied, then test the home-screen shortcut with synthetic data before starting a separate real database. If connecting Codex, keep an optional MCP bearer token in a local secret source and use an environment-variable reference in the client. Do not paste tokens into chat or commit them. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) · [Codex MCP configuration](https://developers.openai.com/codex/mcp)

Use a consistent SQLite backup, such as one made with SQLite's backup command, and store it in a protected location outside the repository. To recover, stop the server, keep the current database as a separate copy, and reopen the tested backup at a new path before switching over. The test suite verifies the equivalent SQLite backup operation with disposable data.

### Optional owner-only Sites trial

1. After explicit Sites approval, recheck Plus hosting allowance and the limits of the intended data. If proceeding with a trial, create a Site with audience **Only me**. Keep the default HTTPS hostname and use no paid add-ons.
2. Put the assigned Site ID into the private Sites source checkout’s manifest. Build and package with the installed Sites workflow. Review the output and migration. Use the native owner-private deployment path only. Sites applies migrations before it uploads the Worker, so resolve any uncertain migration state before retrying.
3. Sign in as the owner in a regular browser and on Android. Check anonymous and alternate-account denials. Verify browser writes, no private response caching, precise export bytes, and no wellness fields. Use only synthetic records during this trial.
4. Install the personal plugin created by Sites. Check MCP read tools and one explicitly authorized goal change against the same synthetic database. Check that daily-entry writes are absent. If the hosted plugin can’t connect, keep the Site owner-private and report the failure.

Sites does not document a combined database/files restore to a new Site. Keep private exports. Links for operational checks are in the [Sites Help Center](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) and [Sites plugin guide](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites).
