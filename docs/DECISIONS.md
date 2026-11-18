# Decisions and corrections

Each entry is a change made to AI-assisted output: what was suggested, why it was wrong for
this stack, what replaced it, and how the replacement was checked. This is the artifact behind
the walkthrough segment the brief asks for.

## D-1 — The list page would have been frozen at build time

**Suggested.** A Server Component calls the tRPC server caller and reads D1; the draft assumed
that made the page render per request.

**Why wrong.** A Drizzle/D1 read is not a Next.js dynamic API. App Router prerenders the route at
build time, so the list would be a build-time snapshot. Creating a link would then call
`router.refresh()` and re-render the same snapshot — the demo would show a successful form and a
table that never changes.

**Instead.** `export const dynamic = "force-dynamic"` on the page, so the RSC reads per request.
The form mutation calls `router.refresh()` after success, which now actually re-renders.

**Verified.** `pnpm build` route table marks `/` as dynamic (`ƒ`), and the manual smoke run shows
a new row after submit + refresh.

## D-2 — "The server does not know its public origin" was false

**Suggested.** The spec claimed the short URL must be assembled client-side because the server
cannot know its origin.

**Why wrong.** A Server Component can call `headers()`, and a route handler has `request.url`.
The server can know. The real reasons to use the browser origin are narrower: `headers()` opts
the page into dynamic rendering (needed anyway, see D-1), and a proxy can rewrite `Host`, so the
origin the browser actually used is the honest value to display.

**Instead.** The client assembles `${window.location.origin}/${slug}`, and the spec states the
real reason instead of a false premise.

**Verified.** Next.js `headers()` is documented as a dynamic API; the page already declares
`force-dynamic`, so the choice is about proxy correctness, not capability.

## D-3 — `retryAfter` was a sentence, not a field

**Suggested.** The rate-limit error put "try again in 42s" inside the message string; the test
asserted the string contained a number.

**Why wrong.** That makes the client parse prose. Any copy change breaks the UI and the test, and
there is no typed contract between the router and the form.

**Instead.** `TRPCError({ code: "TOO_MANY_REQUESTS", cause: { retryAfter } })`, with an
`errorFormatter` that exposes `data.retryAfter`; the message stays human-readable and the test
asserts the typed field.

**Verified.** The formatter is unit-tested with a synthetic error, and the integration case
asserts `error.cause.retryAfter` on the server caller.

## D-4 — `vitest` latest broke the Workers test plugin

**Suggested.** `pnpm add -D vitest` (unpinned) resolved to 5.1.1.

**Why wrong.** The Cloudflare Workers test plugin peer-requires `vitest ^4.1.0`; the suite would
not run in workerd.

**Instead.** Pinned `vitest@^4.1.0` (4.1.12 resolved). Also replaced the deprecated
`@cloudflare/vitest-pool-workers` with its successor `@cloudflare/vitest-plugin` after the
package README said it had been renamed.

**Verified.** `pnpm ls vitest` reports 4.1.12; the plugin's exports load and the test suite runs.

## D-5 — Per-test storage isolation did not cover a module-scoped client

**Suggested.** Rely on the Workers Vitest plugin's documented per-test storage isolation, apply
migrations once in a setup file, and skip cleanup entirely.

**Why wrong (empirically).** With a module-scoped Drizzle client, writes survived between tests:
the quota test saw ten rows from an earlier test, and a later test hit a stale rate-limit window
and was rejected with `retryAfter: 826`. The isolation did not apply to the captured binding in
this plugin version.

**Instead.** Keep migrations in the setup file and delete both tables in `beforeEach`.

**Verified.** Before the reset the suite failed with `expected length 5 but got 10`; after the
reset, 9/9 pass. This is a test-harness constraint, not a product behaviour.
