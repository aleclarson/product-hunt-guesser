This repository contains a single Tampermonkey userscript (`src/userscript.ts`) that runs on Product Hunt launch pages. These notes capture the behaviors and pitfalls an AI agent should know before editing the script.

## Behavior Overview

- Trigger: only on URLs matching `/products/[product.slug]/launches/[slug]`.
- Page readiness: the script waits for `section[data-test="post-archived-review-card"]` to exist; if it does not appear within 15s, setup aborts.
- Pre-load cleanup: a requestAnimationFrame loop removes all elements matching `[data-test^="post-item-"]` until setup completes.
- UI insertion: the guess UI is inserted immediately before the archived section, then that section and all following siblings are removed.
- Vote button: `button[data-test="vote-button"]` is removed after reading its numeric text. The score is adjusted by subtracting 25 if above 25 to counter suspected fake votes.
- Guess options: six options are generated from predefined ranges by dropping whichever end range is farthest from the launch’s range. Options are rerolled with `Math.random` until each value is at least 2× the previous; the correct (adjusted) score is kept in-range.
- Next button: after a guess, a “Next” button jumps to a random launch chosen from the weekly leaderboard API. Year is 2022–current, week uses `getWeek(new Date())` for the current year, page is 1–15 but fetch caps at 10.
- Caching: leaderboard pages are cached for 24h in IndexedDB via `idb-kv` under keys like `leaderboard:year:week:page`.
- GraphQL: uses the persisted query hash `74a5405972fc0b6a8e704d6970968116d8fb6021db27d95bad59f376bbba12d4`; cursor starts empty.
- Media tweaks: `section.snap-x img` sources are upgraded to `w=1100&h=658&dpr=2`; hovering shows a fullscreen, pointer-events-none overlay; badge images (`img[src*="ph-static.imgix.net/badges"]`) are removed.

## Dev Notes & Constraints

- TypeScript target is bundled; `tsconfig.json` uses `"moduleResolution": "bundler"` with DOM libs. The userscript header lives only in the built output.
- Do not run tests or live API requests in this repo (per user instruction); reason about changes instead.
- Preserve the 2× spacing rule for options and the “drop farthest range” approach when touching option logic.
- Keep the initial hiding/removal of `[data-test^="post-item-"]` to avoid revealing content before the custom UI appears.
- Any DOM selectors or timing changes must still honor waiting for the archived review card before proceeding.

## Editing This File
- Keep this file concise and scoped to what future agents need to know before changing the userscript.
- Update sections in place; prefer bullets over prose.
- Record new behaviors, selectors, caches, or timing expectations whenever they change.
- Note any user instructions or constraints (e.g., “do not run tests/requests”) that should persist.
- Avoid duplicating code; link to file paths or selectors instead.
