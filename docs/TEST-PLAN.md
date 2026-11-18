# Test Plan

Traces to requirements in `SPEC.md`. The ship set is deliberately small: one case per graded
behaviour, run against real D1 in workerd. Everything else is designed and marked as not run, not
silently dropped.

## Strategy

| Layer | Runs on | Covers |
|---|---|---|
| Unit | Vitest, no DB | URL policy, slug shape, `retryAfter` math, error formatter |
| Integration | `@cloudflare/vitest-plugin`, real D1 in workerd | limiter, create, list, redirect decision |
| Manual | Browser + curl | form states, browser redirect, empty state (see `docs/RUNBOOK.md`) |

Determinism: context carries an injected `clock`, and the create service takes an optional
`generate` function, so window rollover and collisions do not depend on wall time or module
mocking. The integration cases pass a fixed clock through the same context the app uses.

Isolation: the plugin advertises per-test storage, but a module-scoped Drizzle client persisted
writes across tests in this version (a later test saw ten rows and a stale window). The suite
therefore applies the real migration SQL once in `test/apply-migrations.ts` and deletes both
tables in `beforeEach`. Green tests after the reset are the evidence.

## Ship set — 9 cases

| ID | Covers | Case | Expected |
|---|---|---|---|
| T-01 | FR-6 | Slug format over 1 000 generations | Always `/^[A-Za-z0-9]{7}$/` |
| T-03 | FR-5 | Accept `http://a.co`, `https://example.com/a?b=c#d`, padded whitespace | Parsed, trimmed, canonical |
| T-04 | FR-5 | Reject empty, `not a url`, `//example.com`, `javascript:alert(1)`, `data:text/html,x`, `file:///etc/passwd`, `ftp://x`, 2 049 chars, `https://example.com@evil.com` | All rejected (credentials rejected to avoid host spoofing) |
| T-07 | FR-4 | 5 creates in one window, then a 6th | 5 succeed; 6th is `TOO_MANY_REQUESTS` with `cause.retryAfter` in 1…60 |
| T-08 | FR-4 | After T-07's rejection | `links` count still 5; limiter count still 5 — the rejection wrote nothing |
| T-12 | FR-1, FR-7 | Create `https://example.com/a` at a fixed clock | `ownerId=user_demo`, `clicks=0`, canonical URL, 7-char slug, `createdAt` equals the clock, no `Date` object |
| T-13 | FR-5 | 3 invalid inputs, then 5 valid creates | All 5 succeed — invalid attempts consumed no quota |
| T-17 | FR-3 | `handleRedirect` for a valid slug | `302` with the target; `clicks` +1 |
| T-18 | FR-3 | `handleRedirect` for `/aaaaaaa` (valid shape, no row) and `/foo.bar` (malformed) | Both `404`; the malformed path touches no DB |

T-18's malformed case passes a throwing DB proxy, so "no DB access" is asserted rather than
assumed.

Manual smoke also verified the HTTP surface: the sixth create returns **429** with
`data.retryAfter`, the valid redirect returns **302** with the right `Location`, and the counter
increments through the real route handler.

## Designed, not run

| ID | Case | Why deferred |
|---|---|---|
| T-09 | Event exactly 60 000 ms old | Covered by the strict `>` in the statement; boundary run is redundant at this scope |
| T-10 | Per-owner isolation | Second-owner path is not demoed; SQL is scoped by `owner_id` |
| T-11 | 10 parallel creates → exactly 5 | Depends on D1 serialization inside the simulator; timeboxed, fallback is `links == limiter rows ≤ 5` |
| T-14 | Slug collision retry / exhaustion | Requires the `generate` seam; P1 only if the seam exists by minute 40 |
| T-15 | List owner isolation, DESC order, shape | Cheap to add after the ship set is green |
| T-16 | 51 rows → 50 + `hasMore` | Cap behaviour, not correctness of the query |
| T-21 | Corrupt stored target → 500 | App cannot produce the state; defence in depth is code-reviewed |
| — | Limiter throws → no link row | Fail-closed is by construction: the insert runs only after the limiter returns a row |
| — | Empty-state render | Manual smoke UF-5 |

## Explicitly not covered

| Gap | Reason |
|---|---|
| Auth / cross-tenant access | No auth in scope; `ownerId` is a constant seam |
| Multi-colo consistency | Local single-node D1; documented in `ARCHITECTURE.md` |
| Browser cache / real 302 | Manual smoke asserts the status and header |
| Load and latency | Not meaningful at this volume; no queue/cache in scope |
| Pagination | Out of scope; T-16 covers the cap only |

## Green gate

`pnpm typecheck`, `pnpm lint`, `pnpm build`, and the ship set are green **or** a failure is named
and explained. The walkthrough ships regardless: stopping to record a good explanation beats
finishing a case nobody asked about.
