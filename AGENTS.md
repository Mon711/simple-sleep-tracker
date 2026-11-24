# Working on Simple Sleep Tracker

- Read [architecture](docs/architecture.md) for boundaries and data flow. Read [decisions](docs/decisions.md) before changing night pairing, wellness fields, goal history, MCP, or hosting.
- Use synthetic records for all development, tests, logs, exports, and screenshots. `npm ci`, `npm run build`, and `npm start` open the local synthetic app. `src/client/` holds the UI, `src/server/` the shared request rules and Sites entry point, and `local/` the SQLite server and its separate identity checks.
- Keep authorization on the server and all data access scoped to the authenticated owner. MCP may write goals only. The Sites build must reject optional wellness fields pending policy clarification. Treat the night date separately from the actual recorded timestamp.
- Run lint, type checks, Vitest, the built Worker and private server tests, Playwright, a build, and a dependency audit before release. Browser checks must exercise saves at mobile and desktop widths. Record actual results and gaps.
- Keep credentials, databases, backups, exports, and private artifacts outside Git. Inspect status and the exact staged diff and scan the staged files and history for secrets. Stop and report sensitive material in history.
- Get explicit approval before pushing to GitHub, uploading or deploying to Sites, broadening access, or incurring charges. Release approval is separate from design approval.
- Keep README, architecture, decisions, changelog, and release checks current. Add verified, reusable lessons to [agent lessons](docs/agent-lessons.md).
