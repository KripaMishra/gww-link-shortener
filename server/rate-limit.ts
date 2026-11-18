import { sql } from "drizzle-orm";

import type { Db } from "./db/client";

export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60_000;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

/**
 * Sliding-window log. The count and the insert are one statement, so SQLite
 * takes the write lock before evaluating the subquery — there is no
 * read-then-write gap for a concurrent request to slip through. Rejected
 * attempts insert nothing.
 */
export async function consumeRateLimit(
  db: Db,
  ownerId: string,
  now: number,
): Promise<RateLimitDecision> {
  const inserted = await db.all<{ one: number }>(sql`
    INSERT INTO rate_limit_events (owner_id, created_at)
    SELECT ${ownerId}, ${now}
    WHERE (
      SELECT COUNT(*) FROM rate_limit_events
      WHERE owner_id = ${ownerId} AND created_at > ${now - RATE_WINDOW_MS}
    ) < ${RATE_LIMIT}
    RETURNING 1 AS one
  `);

  if (inserted.length === 1) return { allowed: true };

  const oldest = await db.get<{ oldest: number | null }>(sql`
    SELECT MIN(created_at) AS oldest
    FROM rate_limit_events
    WHERE owner_id = ${ownerId} AND created_at > ${now - RATE_WINDOW_MS}
  `);

  return { allowed: false, retryAfter: retryAfterSeconds(now, oldest?.oldest ?? null) };
}

export function retryAfterSeconds(now: number, oldestInWindow: number | null): number {
  if (oldestInWindow === null) return Math.ceil(RATE_WINDOW_MS / 1000);
  return Math.max(1, Math.ceil((oldestInWindow + RATE_WINDOW_MS - now) / 1000));
}

export async function pruneRateLimitEvents(db: Db, ownerId: string, now: number): Promise<void> {
  await db.run(sql`
    DELETE FROM rate_limit_events
    WHERE owner_id = ${ownerId} AND created_at <= ${now - RATE_WINDOW_MS}
  `);
}
