# Manual runbook

Run `pnpm install && pnpm db:migrate && pnpm dev`, then open http://localhost:3000.

Reset local data at any point:

```bash
pnpm exec wrangler d1 execute DB --local --command "DELETE FROM links; DELETE FROM rate_limit_events;"
```

## UF-1 create

Paste `https://example.com/a/b`, submit. Expect the slug to appear under the form, the input to
clear, and a new row with `0` clicks at the top of the table.

## UF-2 validation

Submit `not a url`, then `javascript:alert(1)`. Expect an inline error and no new row. Both
requests must not consume quota: after three invalid attempts, five valid creates still succeed.

## UF-3 rate limit

Create five links within a minute, then a sixth. Expect:

> 5 links per minute — try again in Ns.

No sixth row appears. The rejection writes no limiter event, so the block does not extend itself.

## UF-4 recovery

Wait for the oldest event to age out of the 60 s window, then submit again. Expect success.

## UF-5 empty state

Reset local data and reload. Expect "No links yet." with the form still usable.

## UF-6 redirect and count

Click a slug, or:

```bash
curl -sI http://localhost:3000/<slug> | sed -n '1p;/^location:/Ip'
```

Expect `HTTP/1.1 302 Found` and a `location:` header equal to the target. Reload the list: clicks
incremented by one per visit.

## UF-7 not found

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/aaaaaaa   # 404, valid shape
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/foo.bar   # 404, malformed
```

Neither changes a click count. The malformed path is rejected before any query.

## UF-8 double submit

Click Shorten twice quickly. The button disables while the mutation is pending; only one request
is sent from that tab.

## UF-9 corrupt target

Insert a row with a `javascript:` target directly, then visit it:

```bash
pnpm exec wrangler d1 execute DB --local --command "INSERT INTO links VALUES ('corrupt','corrupt','javascript:alert(1)',0,'user_demo',0);"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/corrupt   # 500
curl -sI http://localhost:3000/corrupt | grep -i '^location:' || echo "no redirect"
```

## Automated equivalent

`pnpm test` covers the ship set from `docs/TEST-PLAN.md` in workerd with a real D1 binding.
