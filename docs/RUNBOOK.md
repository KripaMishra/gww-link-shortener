# Manual runbook

Run `pnpm install && pnpm db:migrate && pnpm dev`, then open http://localhost:3000.

Reset local data at any point:

```bash
pnpm db:reset
```

## UF-1 create

Paste `https://example.com/a/b`, submit. Expect the slug to appear under the form, the input to
clear, and a new row with `0` clicks at the top of the table.

## UF-2 validation

Submit `javascript:alert(1)`: it passes the browser's `type="url"` check and reaches the server.
Expect the inline error and no new row. `not a url` never reaches the app — native validation
stops it first, which is intentional. Bad input must not consume quota: three invalid attempts,
then five valid creates still succeed.

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
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/<slug>
```

Expect `302` and the target URL. Note the clicks value before and after. A `HEAD` request resolves
without counting:

```bash
curl -sI http://localhost:3000/<slug> | sed -n '1p;/^location:/Ip'
```

Run it and confirm `clicks` did not change. Reload the list: GET increments by one per visit.

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

The counter is incremented before the target is rejected because resolution and counting are one
statement. This row is tampered, not app-produced; run `pnpm db:reset` afterwards.

## Automated equivalent

`pnpm test` covers the ship set from `docs/TEST-PLAN.md` in workerd with a real D1 binding.
