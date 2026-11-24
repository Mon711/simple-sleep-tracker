# Architecture

## Components

| Part | Responsibility |
| --- | --- |
| `src/client/` | React screens for Today, History, and Goals, plus native date inputs and dialogs. Vite builds the browser files. |
| `src/shared/` | Day and clock calculations in Asia/Kolkata, TypeScript types and Zod input/output checks. |
| `src/server/http.ts` and `mcp.ts` | Authenticate requests, enforce browser origins, limit request body size, validate parameters, and route commands. |
| `src/server/tracker.ts` | Decide the next check-in, validate night dates and timestamps, build summaries, and manage goal history and exports. |
| `src/server/store.ts` and `drizzle/` | Owner-filtered SQL queries and database rules. D1 on Sites and SQLite in the local server use the same schema and statements. |
| `src/server/sites.ts` and `local/server.ts` | Trusted Sites sign-in on the hosted path and separate synthetic or Tailscale Serve identity on the local path. |
| `public/` | Installation metadata, app icons, and a browser service worker that caches only the static offline screen and stylesheet. |

## Movements of data

1. The browser requests Today. The server gets the owner from the active hosting profile and returns recent check-ins for that account. It gives Morning priority when the latest usable event is a bedtime without a wake check-in. Both actions show their night date. If there is no usable open night, Evening is primary and the default dates are suggestions.
2. **Log now** sends the event kind and chosen night. The server uses the instant when it receives the request. The store inserts only when that owner and night are missing the event. A retry returns the already stored check-in with its original timestamp.
3. The editor can change the night, recorded date and time, and applicable optional choices. It supplies the original record ID and revision. The database rejects a stale editor, a move onto an existing event, or a wake time earlier than bedtime for a paired night. Edits that keep the displayed minute preserve the saved seconds and milliseconds.
4. History reads a bounded range for the same owner. Graphs use a clock scale that wraps around midnight and show the last target revision effective for each night. Grouped bedtime observations require at least three matched bedtime/wake pairs in each nightmare group before showing averages. Individual rows remain available below the charts.
5. The first check-in starts a seven-calendar-day baseline using its night date. After that, a manual action can start a plan. Each change appends a new revision with its own effective date and precise time. After a weekly or monthly period, the proposed move can be confirmed. It never takes effect by itself. A new proposal is scheduled from the day a change is confirmed or manually made.
6. MCP uses the same store and tracker service as the browser. It registers five read tools and three goal mutation tools. Inputs and outputs are validated. Tool discovery and use both require authentication. The service validates revision numbers and explicit proposal confirmation.
7. Export reads both owner-scoped tables as one snapshot. It includes the original timestamp, selected night, optional allowed fields, IDs, and goal revisions. CSV cells are quoted and guarded against spreadsheet formula interpretation.

## Boundaries

- Every private query filters by owner. The hosting profile resolves that owner before calling the store. The Sites Worker is intended only for OpenAI’s dispatch, which supplies the trusted identity header. The local real-data profile binds to loopback and trusts Tailscale Serve as its only network entry point.
- Sites requests cannot save any nonblank optional wellness values. Sites reads and exports also withhold those values. Local synthetic and private profiles support the structured choices. There is no free-text notes field in V1.
- Server responses with records use `Cache-Control: private, no-store`. Browser writes require the tracker’s origin. Browser-origin MCP requests are denied. The app has no analytics, private-content logging, or third-party asset requests.
- V1 pairs events that fall on the chosen night’s calendar date or the following date. Manual night selection is available for unusual schedules. No sleep-duration field is calculated.
- The local server manages migrations with SQLite’s schema version. Sites packaging includes the corresponding SQL migration and journal under its deployment metadata path. Append a new migration for any change after release.
