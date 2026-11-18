import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

/**
 * One D1 client per request. There is deliberately no module-level cache: a
 * Workers isolate can be recycled between requests and must not hold state.
 */
export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
}

export type Db = Awaited<ReturnType<typeof getDb>>;
