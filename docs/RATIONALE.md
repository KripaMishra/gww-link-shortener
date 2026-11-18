# Design rationale

`SPEC.md` defines what the feature does. This document records why it is built this way: the
runtime assumptions, the tradeoffs, the rejected alternatives, and the known limits.

## Architecture and the component split

The page and the links table are Server Components. `links.list` is called through a server-side
tRPC caller (`createCaller`), not over HTTP, so the list ships no data-fetching client. The form is
the only client component: it owns input state, calls the `links.create` mutation, and then calls
`router.refresh()` so the Server Component re-reads the list.

Server Actions are deliberately unused. The task mandates tRPC for internal calls, and adding a
second mutation transport would duplicate validation and error mapping.

The page exports `dynamic = "force-dynamic"`. A Drizzle read is not a Next.js dynamic API, so
without it the list would be prerendered at build time and never change. This was reproduced both
ways: with the export removed, `pnpm build` marks `/` as `○` (static); with it, `/` is `ƒ`
(dynamic). See `DECISIONS.md` D-1.

A `links.list` failure is caught in the page and rendered as an inline alert with the
`pnpm db:migrate` hint. The error boundary cannot paint before hydration, so relying on it alone
would leave a fresh clone with a blank 500.

## Create flow

1. Validate at the tRPC boundary: http/https only, at most 2048 characters, a host, and no
   credentials (`https://example.com@evil.com` is rejected to avoid display spoofing). The stored
   value is the canonical `URL.toString()`.
2. Consume one rate-limit slot. Validation runs first, so invalid input never burns quota.
3. Generate a 7-character base62 slug from `crypto.getRandomValues` with rejection sampling (no
   modulo bias), insert against the unique index, and retry up to three times on collision.
4. Prune limiter events at or before `now - 60s` for this user and return `{ slug }`.

If the link insert ultimately fails, the quota is already consumed: fail closed, never fail open.
There is no idempotency key in scope; the pending state disables the button, but two tabs can
legitimately create two links and consume two slots.

## Rate limiting

Sliding-window log: at most five **successful** creations per rolling 60 seconds per owner. The
count and the insert are one statement:

```sql
INSERT INTO rate_limit_events (owner_id, created_at)
SELECT ?, ?
WHERE (SELECT COUNT(*) FROM rate_limit_events
       WHERE owner_id = ? AND created_at > ? - 60000) < 5
RETURNING 1;
```

- One row returned means allowed; zero rows means rejected.
- SQLite takes the write lock before evaluating the subquery, so there is no read-then-write gap
  for a concurrent request to slip through.
- Rejected attempts insert nothing: an attacker cannot grow the table by hammering the endpoint,
  and a blocked user cannot extend their own block.
- The boundary is strict: an event exactly 60 000 ms old no longer counts.
- On success, older events for that user are deleted, so the table stays at roughly 5 rows per
  active user with no cron.
- On rejection, the oldest in-window event produces `retryAfter` (seconds, ceil, minimum 1). It is
  returned as typed `data.retryAfter` via `TRPCError.cause` and the error formatter, and the form
  disables the button and counts down from it.

### Rejected designs

| Design | Why it loses here |
|---|---|
| In-memory `Map` | Per-isolate and reset on eviction; no global limit on Workers |
| Cloudflare Rate Limiting binding | Per-colo counters; undercounts when traffic spreads across colos |
| KV | Eventually consistent; no atomic increment |
| Fixed window | A 60 s bucket permits 10 across a boundary (5 at 0:59, 5 at 1:00) |
| Token bucket / GCRA | Capacity 5 drains at t=0, refills one token at t=12 s, so the 6th is accepted inside the same minute — it enforces a sustained rate, not a rolling cap |
| Durable Object | Correct and fast at high volume, but extra infrastructure for 5 creations/min |

The arithmetic that rejects the token bucket: five requests at t=0 empty the bucket; at t=12 s one
token refills and request six is accepted; by t=48 s, nine requests have been accepted inside the
first minute. The requirement is a rolling cap, not a sustained rate.

### The single-primary assumption

The limiter is correct **because D1 serializes writes on a single primary**. The SQL is atomic,
but atomicity is a property of the deployment, not the statement alone. On a multi-primary or
eventually-consistent store the same decision needs a Durable Object (or a Redis Lua script). A
DO per active user is also the upgrade that removes the DB round trip at high check rates. This is
the design's main known risk, not a hidden one.

## Redirect and click counting

`GET /[slug]` validates the shape (`^[A-Za-z0-9]{7}$`) before touching the database, then runs one
statement:

```sql
UPDATE links SET clicks = clicks + 1 WHERE slug = ? RETURNING target_url;
```

It responds `302`, never `301`: a permanent redirect is cached by the browser and click counting
stops, and stored targets could never be corrected.

`HEAD` uses the same validation but resolves the target without the `UPDATE`, so link previews,
mail scanners, and unfurlers do not count as clicks. A corrupt target is counted once before the
route returns 500; targets are immutable, so only a direct DB edit can reach that path.

The increment is awaited before responding, trading a few milliseconds for exact counts.
`waitUntil` (best-effort) and queue-batched counting (above roughly 10³ writes/s, or when one link
goes viral and the row becomes a contention point) are the documented alternatives.

## Test coverage

Ten cases run inside workerd against a real D1 binding (`pnpm test`):

| Case | Protects against |
|---|---|
| Slug shape over 1 000 generations | Charset/length drift |
| URL policy, including `https://example.com@evil.com` | XSS/open-redirect payloads, spoofed hosts |
| 6th create rejected with `retryAfter` | Off-by-one, wrong error contract |
| Rejection writes neither a link nor a limiter event | Partial writes, self-extending blocks |
| Create shape (`ownerId`, `clicks = 0`, canonical URL, numeric `createdAt`) | Schema/serialization drift |
| Invalid input consumes no quota | Validation ordering |
| 302 + increment | Wrong status, lost counts |
| HEAD does not increment | Preview/scanner inflation |
| Missing valid-shaped slug → 404 | The common 404 |
| Malformed slug → 404 without a query | Needlessly hitting the DB |

The two that matter most are the sixth-attempt rejection and the no-write assertion: one proves
the cap, the other proves a rejected request leaves no trace.

Deliberately deferred, and named in `TEST-PLAN.md`: the 10-parallel race (depends on D1
serialization inside the simulator), slug-collision retry, list owner isolation, the 51-row
`hasMore` path, and the corrupt-target 500. The HTTP 429 was verified manually against the running
app, not in the suite.

Test-harness finding: the Workers Vitest plugin's per-test storage isolation did not cover a
module-scoped Drizzle client in this version. Writes survived between tests (ten rows, a stale
window). The suite resets both tables in `beforeEach`; the exact-count assertions are the evidence.
See `DECISIONS.md` D-5.

## Corrections and review findings

Five are documented with verification in `DECISIONS.md`; three changed the design materially:

- **D-1, the list would freeze.** The draft assumed a Server Component reading D1 renders per
  request. Next would prerender it. Fixed with `force-dynamic`; reproduced `○` → `ƒ`.
- **D-3, `retryAfter` was prose.** The first version put "try again in 42s" in the message string
  and the test parsed it. Replaced with `TRPCError.cause` → `data.retryAfter`, asserted by the
  test and consumed by the form's countdown.
- **D-6, HEAD counted as a click.** Exporting only `GET` lets Next route HEAD to it. Every preview
  or scanner incremented `clicks`, and the runbook's own `curl -sI` inflated the number. Fixed
  with an explicit HEAD that resolves without counting; T-23 covers it.

D-4 (pinning `vitest` to the plugin's peer range and replacing the deprecated pool package) and
D-5 (the test-harness isolation finding) are also recorded.

## Future work

1. Move the limiter to a Durable Object and add a multi-colo/multi-primary test — the current
   correctness rests on D1's single-writer assumption.
2. Add the 10-parallel create test, then the slug-collision test; those are the two branches most
   likely to degrade silently.
3. Cursor pagination beyond the latest 50 links.
4. URL safety scanning before a link activates; the redirect is an open redirect by product
   definition.
5. A real D1 deployment (the committed `database_id` is a placeholder) and a load test of the
   redirect path.

## Deliberate limits

No auth (`user_demo` is a single seam), no custom/vanity slugs, no edit/delete, no pagination
beyond the latest 50, no click history (counter only), no queues/Redis/Durable Objects, no edge
caching, no URL scanning. Each has a threshold or upgrade path in `ARCHITECTURE.md`; none is
justified at 5 creations/min.

## References

- `SPEC.md` — requirements, data model, behaviour rules, user flows, component split
- `TEST-PLAN.md` — ship set, deferred cases, explicit non-coverage
- `ARCHITECTURE.md` — D1 assumptions, rejected limiter designs, scale thresholds
- `DECISIONS.md` — corrections with verification
- `RUNBOOK.md` — manual smoke, including the HEAD and 429 checks
