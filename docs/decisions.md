# Decisions

## 001 · One data model, two hosting boundaries

**Status** — Implemented and verified with synthetic fixtures. No hosted release approved.

React, TypeScript, Vite, and plain CSS provide a small browser app. A Workers-compatible request handler serves the interface and MCP together. The production bundle embeds named browser assets in the Worker, which keeps packaging independent of a platform-specific asset binding. Sites connects D1 and provides ChatGPT identity. The local Node server implements the same narrow database interface using built-in SQLite. Manual SQL avoids a second migration and mapping system. [Sites runtime and limits](https://learn.chatgpt.com/docs/sites)

A static site cannot provide private shared data and MCP on its own. A second managed database would add separate accounts and setup. The official Vinext starter adds server rendering which the selected SPA does not use. The Worker build is exercised through Miniflare’s local Cloudflare runtime and D1. The SQLite fallback needs a trusted computer and private network access through Tailscale Serve. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

## 002 · Keep optional wellness fields private by default

**Status** — Enforced. Revisit only with specific, current guidance before expanding Sites collection.

The Sites Terms prohibit HIPAA-defined Protected Health Information and set obligations around other sensitive data. OpenAI’s Help Center uses broader wording around sensitive data. Neither source expressly clears this personal tracker’s mood, nightmare, rested, or bedtime difficulty fields. The Sites build rejects these fields on write and withholds them on read, including MCP and exports. Until the intended real-data scope is confirmed, a Sites smoke test should contain synthetic schedule and goal records only. All four wellness fields are implemented in the private profile. [Sites Terms, section 3.3](https://openai.com/policies/chatgpt-sites-terms/) · [Sites Help Center](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)

The private MCP server works over authenticated HTTP. Desktop Codex can connect privately from the same device network. OpenAI documents full custom remote MCP for Business and Enterprise/Edu, while Sites has its own personal-plugin workflow. Full private-server reads and goal writes from ChatGPT Plus remain a release limitation. Data intentionally retrieved into any chat is subject to that surface’s data controls. [Custom MCP in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) · [Sites MCP](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)

Sites hosting is currently included in Plus. OpenAI proposes 125 monthly Plus hosting credits starting January 1, 2027, with a roughly 25-credit base charge per database Site plus usage. Check plan policy and allowance again after release approval. [Plus hosting FAQ](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) · [Proposed rates](https://learn.chatgpt.com/docs/sites#hosting-usage-rates)

## 003 · Use Midnight Calm and promote the next check-in

**Status** — Approved by the user in Phase 1 and implemented.

The dark palette and large first action are carried forward. A recent unpaired bedtime promotes Morning, regardless of hour. An empty tracker defaults to Evening and still presents Morning. Before local noon, a new bedtime normally belongs to the previous night until that night has a wake check-in. The date shown on each card makes the suggested association visible. Editors allow an explicit date change. One tap captures the server’s current timestamp and returns a visible confirmation.

## 004 · Keep records off the offline cache

**Status** — Implemented.

The Android installation path uses a manifest with the app name, icons, and standalone window setting. The service worker caches only the static offline screen and stylesheet. Sending offline saves later would require retaining personal records on the device and could create a misleading timestamp. V1 requires a connection before reading or saving records.

## 005 · Hosting review for real personal records

**Status** — Historical research. The owner chose ChatGPT Sites for daily schedule tracking. No alternative has been implemented or provisioned.

Cloudflare Workers and D1 could reuse the app's data model but would add separate sign-in, deployment, and backup work. Supabase would also require adapting the database code to Postgres, and its free projects can pause after inactivity. Full direct external MCP read/write access from ChatGPT Plus was unverified for either option. The existing Sites plugin already passed real read and goal-write tests on Plus. [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) · [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/) · [Supabase free-plan pausing](https://supabase.com/docs/guides/platform/free-project-pausing) · [Custom MCP availability](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

## 006 · Keep the private Sites release focused on schedules and goals

Section 3.3 expressly prohibits HIPAA-defined protected health information and places other sensitive information under applicable privacy obligations. HHS says data entered in an independent app for personal use generally falls outside HIPAA. OpenAI’s broader Help Center wording leaves the intended use of the four diary fields unclear. The existing restrictions stay in effect for entry writes, exports, and MCP. The owner's intended daily-use scope covers bedtime, wake time, and goals. [Sites Terms](https://openai.com/policies/chatgpt-sites-terms/) · [Sites Help Center](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) · [HHS guidance on personal apps](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/cell-phone-hipaa/index.html)
