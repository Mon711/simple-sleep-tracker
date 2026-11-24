# Changelog

## Unreleased

- Fixed the owner-only Sites trial's ChatGPT tool calls by accepting the protocol's request metadata. Goal and data permissions continue to come from the authenticated session. This fix is live on the private trial.
- Removed the trial hosting notice from the daily interface and prepared an owner-only Sites rollout with a clean history.

## 0.1.0

- Built the Midnight Calm tracker with state-aware check-ins, one-tap exact timestamps, clear saved feedback, and optional private check-in details.
- Added explicit night dates, manual backdating, editing, and duplicate prevention, including check-ins after midnight.
- Added history trends and exports, a seven-day baseline, and a reviewable goal plan with revision history and pause support.
- Implemented eight authenticated MCP tools. Goal tools can make changes, while daily check-ins remain read-only through MCP.
- Added a home-screen manifest, icons, a static offline screen, and a private SQLite hosting option. The Sites runtime restricts optional wellness fields.
