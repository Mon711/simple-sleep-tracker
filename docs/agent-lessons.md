# Agent lessons

## Confirm the checkout before treating it as a repository

The target project folder was empty. The public remote had no commits, and cloning into the project folder failed because the sandbox denied writes to `.git`. A temporary clone verified the empty remote without blocking prototype work. Before staging for release, use a writable checkout connected to the verified remote and inspect its status and staged content. The current project folder contains source files and has no Git metadata.

## Keep the visible button label in its accessible name

The design preview initially showed “Log now” while naming the button “Log bedtime now” for assistive technology. The accessibility scan flagged the missing literal match. The name now begins with “Log now” and adds the check-in for context. This lets a voice-control user say the words on screen. Keep that check when implementing the production controls.

## Test same-origin forms in Chrome, especially sign-in

The first synthetic sign-in returned HTTP 403 for a valid click. Chrome provided an opaque form-post origin under the initial no-referrer policy. Keeping referrers same-origin restored the browser form while suppressing referrers to other sites. The server still requires the exact origin, and the browser suite checks sign-in and sign-out through the real buttons.

## Revisions alone do not survive a move and replacement

Moving a check-in makes its old night available. A replacement can start at revision one, which is also the version an older editor might remember. Edits now match the stored random check-in ID as well as owner, original night, kind, and revision. A regression test moves an entry, creates a replacement, then verifies the stale editor cannot change it.

## Use a disposable non-incognito profile for installation checks

Regular Playwright contexts were incognito. Chrome reported that environment as the sole installability error even after the manifest and service worker were active. The browser suite uses a disposable persistent test profile and checks its installability errors, keeps the offline cache to two static files, and disposes of the profile after testing.

## Rerun the real D1 integration after updating test tools

The first audit found advisories in esbuild and Miniflare’s transitive dependencies. The patched Miniflare version changed its Worker configuration shape. The local smoke now loads the built module through that shape and applies the actual SQL statements in temporary D1. The browser and D1 checks matter even when the package audit is clean.
