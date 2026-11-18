import { TRPCError } from "@trpc/server";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { generateSlug } from "../lib/slug";
import { isValidSlug, parseTargetUrl } from "../lib/validation";
import type { Db } from "../server/db/client";
import * as schema from "../server/db/schema";
import { handleRedirect } from "../server/links";
import { createCaller } from "../server/routers";
import { retryAfterFromError } from "../server/trpc";

const db = drizzle(env.DB, { schema });

// The plugin's storage isolation did not cover a module-scoped Drizzle client
// in this version (writes survived between tests), so the suite resets the two
// tables explicitly. Verified by the exact-count assertions below.
beforeEach(async () => {
  await db.delete(schema.rateLimitEvents);
  await db.delete(schema.links);
});

function callerAt(now: number) {
  return createCaller({ db, userId: "user_demo", clock: () => now });
}

describe("slug", () => {
  it("always produces a 7-character alphanumeric slug", () => {
    for (let i = 0; i < 1_000; i++) {
      expect(isValidSlug(generateSlug())).toBe(true);
    }
  });
});

describe("target URL policy", () => {
  it("accepts and canonicalises http(s) URLs", () => {
    expect(parseTargetUrl("http://a.co")).toBe("http://a.co/");
    expect(parseTargetUrl("  https://example.com/a?b=c#d  ")).toBe(
      "https://example.com/a?b=c#d",
    );
  });

  it("rejects unsafe, malformed, and spoofed URLs", () => {
    const invalid = [
      "",
      "   ",
      "not a url",
      "//example.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://x",
      `https://example.com/${"a".repeat(2048)}`,
      "https://example.com@evil.com",
    ];

    for (const input of invalid) {
      expect(parseTargetUrl(input), input.slice(0, 40)).toBeNull();
    }
  });
});

describe("rate limit", () => {
  it("allows five creations and rejects the sixth without writing", async () => {
    const now = 1_000_000;
    const caller = callerAt(now);

    for (let i = 0; i < 5; i++) {
      await caller.links.create({ url: `https://example.com/${i}` });
    }

    let failure: unknown;
    try {
      await caller.links.create({ url: "https://example.com/six" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TRPCError);
    expect((failure as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect((failure as TRPCError).cause).toMatchObject({ retryAfter: 60 });

    expect(await db.select().from(schema.links)).toHaveLength(5);
    expect(await db.select().from(schema.rateLimitEvents)).toHaveLength(5);
  });

  it("does not consume quota for invalid URLs", async () => {
    const caller = callerAt(2_000_000);

    for (const bad of ["", "not a url", "javascript:alert(1)"]) {
      await expect(caller.links.create({ url: bad })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }

    for (let i = 0; i < 5; i++) {
      await caller.links.create({ url: `https://example.com/ok-${i}` });
    }

    expect(await db.select().from(schema.links)).toHaveLength(5);
  });

  it("exposes the retry window as a typed field", () => {
    const error = new TRPCError({
      code: "TOO_MANY_REQUESTS",
      cause: { retryAfter: 42 },
    });

    expect(retryAfterFromError(error)).toBe(42);
    expect(retryAfterFromError(new TRPCError({ code: "BAD_REQUEST" }))).toBeNull();
  });
});

describe("create", () => {
  it("persists the link shape with a numeric timestamp", async () => {
    const now = 1_234_567;
    const { slug } = await callerAt(now).links.create({
      url: "https://example.com/a",
    });

    const [row] = await db
      .select()
      .from(schema.links)
      .where(eq(schema.links.slug, slug));

    expect(row).toMatchObject({
      slug,
      targetUrl: "https://example.com/a",
      clicks: 0,
      ownerId: "user_demo",
      createdAt: now,
    });
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("redirect", () => {
  it("returns 302 with the target and increments the counter", async () => {
    const { slug } = await callerAt(3_000_000).links.create({
      url: "https://example.com/target",
    });

    await expect(handleRedirect(db, slug)).resolves.toEqual({
      status: 302,
      location: "https://example.com/target",
    });

    const [row] = await db
      .select()
      .from(schema.links)
      .where(eq(schema.links.slug, slug));

    expect(row?.clicks).toBe(1);
  });

  it("returns 404 for a missing slug and for a malformed slug without a query", async () => {
    await expect(handleRedirect(db, "aaaaaaa")).resolves.toEqual({ status: 404 });

    const unreachable = new Proxy(
      {},
      {
        get() {
          throw new Error("database was touched");
        },
      },
    ) as unknown as Db;

    await expect(handleRedirect(unreachable, "foo.bar")).resolves.toEqual({
      status: 404,
    });
  });

  it("does not increment for a HEAD/preview lookup", async () => {
    const { slug } = await callerAt(4_000_000).links.create({
      url: "https://example.com/head",
    });

    await expect(handleRedirect(db, slug, { count: false })).resolves.toEqual({
      status: 302,
      location: "https://example.com/head",
    });

    const [afterHead] = await db
      .select()
      .from(schema.links)
      .where(eq(schema.links.slug, slug));
    expect(afterHead?.clicks).toBe(0);

    await handleRedirect(db, slug);
    const [afterGet] = await db
      .select()
      .from(schema.links)
      .where(eq(schema.links.slug, slug));
    expect(afterGet?.clicks).toBe(1);
  });
});
