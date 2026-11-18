# Link Shortener — Feature Spec

Status: implementation sign-off · Owner: `user_demo` (hard-coded) · Runtime target: Cloudflare Workers (stateless edge)

## 1. Context and constraints

The feature runs on a stateless edge runtime: no long-lived process, no shared in-process
memory, no timers surviving a request. Every cross-request invariant therefore lives in the
database. The app is Next.js App Router + tRPC + Drizzle, and the code must be Workers-shaped
even though this build runs locally.

- Internal calls go through tRPC. There are no hand-written REST endpoints.
- `/[slug]` is a public redirect route handler, not an internal API.
- Auth is out of scope; identity comes from `getUserId()` returning `"user_demo"`.
- Database: D1 in the deployed shape (`wrangler.jsonc` binding), SQLite semantics everywhere.
- Server Actions are deliberately unused: the task mandates tRPC for internal calls, and a
  second mutation transport would duplicate validation and error mapping.

## 2. Scope

**In scope**

| ID | Requirement |
|---|---|
| FR-1 | Create a short link from a pasted URL via a tRPC mutation. |
| FR-2 | List the current user's links via tRPC, rendered by a Server Component. |
| FR-3 | `GET /[slug]` resolves the target, increments clicks, redirects. |
| FR-4 | At most 5 link creations per rolling 60 seconds per user. |
| FR-5 | Reject non-http(s) URLs, malformed URLs, and URLs over 2048 characters. |
| FR-6 | Generate unique, non-sequential 7-character slugs. |
| FR-7 | Every read and write is scoped to the current user. |
| FR-8 | Every rejection is a typed, human-readable error surfaced in the form. |

**Deliberately out of scope** (with the scale-up path documented in `ARCHITECTURE.md`):
real auth, custom/vanity slugs, edit/delete, pagination (the list is capped at the latest 50),
click history (counter only), queues/Redis/Durable Objects, edge caching, URL safety scanning,
deployment.

## 3. Data model

```sql
CREATE TABLE links (
  id          TEXT    PRIMARY KEY,              -- crypto.randomUUID()
  slug        TEXT    NOT NULL UNIQUE,          -- 7 chars, [A-Za-z0-9]
  target_url  TEXT    NOT NULL,                 -- canonical http(s) URL
  clicks      INTEGER NOT NULL DEFAULT 0,
  owner_id    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL                  -- epoch ms
);

CREATE INDEX links_owner_created_idx ON links (owner_id, created_at DESC, id DESC);

CREATE TABLE rate_limit_events (
  owner_id    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL                  -- epoch ms, one row per successful create
);

CREATE INDEX rate_limit_owner_created_idx ON rate_limit_events (owner_id, created_at);
```

`links_owner_created_idx` serves the list query and its ordering. `rate_limit_events` needs no
primary key; the index covers both the window count and the cleanup delete.

`migrations/0001_init.sql` is the source of truth for the DDL; the Drizzle schema mirrors it.
`created_at` uses `mode: "number"` (epoch ms), so no `Date` objects cross the tRPC boundary.

## 4. Surface

| Call | Kind | Input | Output | Errors |
|---|---|---|---|---|
| `links.create` | tRPC mutation | `{ url: string }` | `{ slug: string }` | `BAD_REQUEST`, `TOO_MANY_REQUESTS` (with `data.retryAfter`), `INTERNAL_SERVER_ERROR` |
| `links.list` | tRPC query | — | `{ items: Link[], hasMore: boolean }` | `INTERNAL_SERVER_ERROR` |
| `GET /[slug]` | Route handler | path param | `302 Location: <target>` | `404`, `500` |

`Link` = `{ id, slug, targetUrl, clicks, createdAt }`, with `createdAt` as epoch ms (no Date
serialization config needed).

The short URL is assembled client-side as `window.location.origin + "/" + slug`. A Server
Component can call `headers()` and a route handler has `request.url`, so the server *can* know
its origin; the browser's origin is used because it is exactly what the user sees, and it keeps
`headers()` out of the RSC path. tRPC maps a single `TOO_MANY_REQUESTS` mutation to HTTP 429;
a mixed-status batch returns 207, so the transport claim only holds for single calls.

## 5. Behaviour rules

### 5.1 URL validation (FR-5)
1. Trim surrounding whitespace; reject empty.
2. Reject longer than 2048 characters.
3. Must parse as an absolute URL with a host.
4. Protocol allowlist: `http:` and `https:` only. `javascript:`, `data:`, `file:`, `ftp:`, and
   protocol-relative (`//host`) inputs are rejected.
5. Store `URL.toString()` (canonical form), not the raw input.

### 5.2 Slug (FR-6)
7 characters from `[A-Za-z0-9]`, generated with `crypto.getRandomValues` (Web Crypto, available
on Workers). 62^7 ≈ 3.5 × 10^12 keys; the space is large enough that enumeration is impractical.
Insert relies on the unique index; on a collision retry up to 3 times, then fail with
`INTERNAL_SERVER_ERROR`. No custom slugs.

### 5.3 Rate limit (FR-4)
Sliding-window log, 5 successful creations per rolling 60 s per owner. One atomic statement
decides and records:

```sql
INSERT INTO rate_limit_events (owner_id, created_at)
SELECT ?1, ?2
WHERE (SELECT COUNT(*) FROM rate_limit_events
       WHERE owner_id = ?1 AND created_at > ?2 - 60000) < 5
RETURNING 1;
```

- One row returned → allowed. Zero rows → rejected.
- The window boundary is strict: an event exactly 60 000 ms old no longer counts.
- Count and insert are in **one statement**, so SQLite takes the write lock before evaluating the
  subquery. There is no read-then-write gap to race. This relies on D1 serializing writes on a
  single primary; on a multi-primary or eventually-consistent store, the decision needs a
  Durable Object instead.
- Only **successful** creations are recorded. Rejected attempts write nothing, so an attacker
  cannot grow the table by hammering the endpoint, and a blocked user cannot extend their own
  block.
- Validation runs **before** the limiter, so malformed requests never consume quota.
- On rejection, `retryAfter` (seconds, rounded up, minimum 1) is computed from the oldest event
  still inside the window, returned as `data.retryAfter` via `TRPCError.cause` and an
  `errorFormatter`, and repeated in the human-readable message.
- On success, events for that owner at or before `now - 60000` are deleted, keeping the table at
  roughly 5 rows per active user without a cron job.
- Limiter and link insert are separate statements. If the link insert ultimately fails, the
  quota is consumed — fail-closed, never fail-open. Documented tradeoff.
- `now` is injected at the service boundary so window rollover is testable without fake timers.

### 5.4 Create (FR-1, FR-6, FR-7)
Validate → consume quota → generate slug → insert link → prune old limiter rows → return slug.
`ownerId` always comes from the session seam, never from client input. Client double-submit is
prevented with a disabled pending state; there is no idempotency key in this scope (two tabs can
legitimately create two links, consuming two of five).

On success the client calls `router.refresh()` so the Server Component re-reads the list; without
it the mutation succeeds and the table stays stale.

### 5.5 List (FR-2)
Server Component calls the tRPC router through a server-side caller (no HTTP hop). The page
exports `dynamic = "force-dynamic"`: a Drizzle read is not a Next.js dynamic API, so without it
the list would be prerendered at build time and never change.
Order `created_at DESC, id DESC`. Fetch 51 rows; return 50 and `hasMore` when the 51st exists,
so the UI can say "showing latest 50" without a second count query. Only the owner's rows.
Empty state renders a message, form remains usable.

### 5.6 Redirect and count (FR-3)
1. Reject slugs that do not match `^[A-Za-z0-9]{7}$` with 404 before touching the database.
2. One atomic statement resolves and counts:

```sql
UPDATE links SET clicks = clicks + 1 WHERE slug = ? RETURNING target_url;
```

3. Re-validate the stored target's protocol (`http`/`https`) as defence in depth; a corrupt row
   returns 500 rather than redirecting somewhere unsafe.
4. Respond `302` with `Location: <target>`. Never `301`: a permanent redirect is cached by the
   browser and click counting silently stops, and stored targets could never be corrected.
5. The increment is awaited before responding. `waitUntil` (best-effort) and queue batching are
   documented alternatives; exactness wins at this volume.

### 5.7 Server vs Client components

| Piece | Kind | Reason |
|---|---|---|
| `app/page.tsx` | Server | Reads links per request; no client state |
| `LinksTable` (in the page) | Server | Pure render of `links.list`; zero JS shipped |
| Date formatting | Server | Explicit locale and UTC, deterministic |
| `CreateLinkForm` | Client | Input state, pending state, `useMutation`, `router.refresh()` |
| Error alert | Client | Renders validation text and `data.retryAfter` |
| `app/error.tsx` | Client | Catches a `links.list` failure instead of Next's default page |

The form is the only component that must ship JavaScript. The table and the page stay on the
server.

## 6. User flows

| ID | Flow | Expected |
|---|---|---|
| UF-1 | Open `/`, paste `https://example.com/a/b`, submit | Slug shown, form clears, list shows the link with 0 clicks, newest first |
| UF-2 | Submit empty, `not a url`, `javascript:alert(1)`, or a >2048-char URL | Inline validation error, no link row, **no quota consumed** |
| UF-3 | Create 5 links in under 60 s, then a 6th | 6th shows "5 links per minute — try again in Ns" from typed `data.retryAfter`; no 6th row |
| UF-4 | Wait out the window and submit again | Creation succeeds; older events have been pruned |
| UF-5 | Open `/` with no links | Empty-state message; form still works |
| UF-6 | Visit `/<valid-slug>` | 302 to the target, `clicks` +1; a second visit increments again |
| UF-7 | Visit `/doesnotexist` or `/foo.bar` | 404, no counter change, malformed slug never hits the DB |
| UF-8 | Two rapid submits | Pending state disables the button; at most the limiter's allowance is created |
| UF-9 | Stored target is corrupt/unsafe (simulated) | 500, no redirect |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | No module-level mutable state, no `setInterval`, no Node-only APIs in request paths. |
| NFR-2 | Redirect path = one indexed write. Create happy path ≤ 4 statements; a rejection adds one `MIN()` aggregate, and collision retries add at most three inserts. |
| NFR-3 | Slug shape validated before any query; no `Location` header injection. |
| NFR-4 | Fail closed on limiter/DB errors; never create without a quota decision. |
| NFR-5 | One structured log line per create and per rate-limit rejection (event, ownerId, slug where available; no URL contents). |
| NFR-6 | Form has a label, `role="alert"` error text, and keyboard-only operation; table uses real `table` semantics. Dates render with an explicit locale and UTC to stay deterministic across server environments. |

## 8. Acceptance

The feature ships when the nine-case ship set in `TEST-PLAN.md` is green (or a case is explicitly
deferred and named as deferred), `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass, and a
clean-clone run through `README.md` works. UF-1…UF-9 are verified manually via `docs/RUNBOOK.md`.
The walkthrough ships even if a non-ship-set case is still open.

## 9. Walkthrough outline (5–10 min)

| Segment | Time | Uses |
|---|---|---|
| Demo | 0:00–1:30 | UF-1…UF-7: create, list, click, 6th-attempt rejection |
| Architecture + component split | 1:30–3:00 | §4, §5.5, §5.7, tRPC server caller vs client mutation |
| Rate limiting | 3:00–5:00 | §5.3, single-statement lock, D1 single-primary caveat, `ARCHITECTURE.md` alternatives |
| AI correction | 5:00–6:30 | `DECISIONS.md` D-1 or D-2: what was suggested, why wrong, what changed, how verified |
| Tests + least confident | 6:30–8:00 | Ship set and what it protects; the D1 serialization assumption and the Durable Object mitigation |
