import { desc, eq, sql } from "drizzle-orm";

import { generateSlug } from "@/lib/slug";
import { isValidSlug, parseTargetUrl } from "@/lib/validation";

import type { Db } from "./db/client";
import { links } from "./db/schema";
import { consumeRateLimit, pruneRateLimitEvents } from "./rate-limit";

export class RateLimitedError extends Error {
  constructor(readonly retryAfter: number) {
    super("rate limited");
    this.name = "RateLimitedError";
  }
}

export class SlugExhaustedError extends Error {
  constructor() {
    super("could not allocate a unique slug");
    this.name = "SlugExhaustedError";
  }
}

export type CreateLinkDeps = {
  db: Db;
  ownerId: string;
  now: number;
  generate?: () => string;
};

export async function createLink(
  { db, ownerId, now, generate = generateSlug }: CreateLinkDeps,
  targetUrl: string,
): Promise<{ slug: string }> {
  const decision = await consumeRateLimit(db, ownerId, now);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfter);

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = generate();
    try {
      await db.insert(links).values({
        id: crypto.randomUUID(),
        slug,
        targetUrl,
        ownerId,
        clicks: 0,
        createdAt: now,
      });
      await pruneRateLimitEvents(db, ownerId, now);
      return { slug };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // The quota was consumed before the loop: fail closed, never fail open.
  throw new SlugExhaustedError();
}

export async function listLinks(db: Db, ownerId: string) {
  const rows = await db
    .select({
      id: links.id,
      slug: links.slug,
      targetUrl: links.targetUrl,
      clicks: links.clicks,
      createdAt: links.createdAt,
    })
    .from(links)
    .where(eq(links.ownerId, ownerId))
    .orderBy(desc(links.createdAt), desc(links.id))
    .limit(51);

  return { items: rows.slice(0, 50), hasMore: rows.length > 50 };
}

export async function resolveAndCount(db: Db, slug: string): Promise<string | null> {
  const rows = await db
    .update(links)
    .set({ clicks: sql`${links.clicks} + 1` })
    .where(eq(links.slug, slug))
    .returning({ targetUrl: links.targetUrl });

  return rows[0]?.targetUrl ?? null;
}

export type RedirectResult =
  | { status: 302; location: string }
  | { status: 404 }
  | { status: 500 };

export async function handleRedirect(db: Db, slug: string): Promise<RedirectResult> {
  // Shape check first: malformed slugs never reach the database.
  if (!isValidSlug(slug)) return { status: 404 };

  const target = await resolveAndCount(db, slug);
  if (target === null) return { status: 404 };

  // Defence in depth for a corrupted/tampered row.
  if (parseTargetUrl(target) === null) return { status: 500 };

  return { status: 302, location: target };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
