import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { desc } from "drizzle-orm";

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    targetUrl: text("target_url").notNull(),
    clicks: integer("clicks").notNull().default(0),
    ownerId: text("owner_id").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("links_owner_created_idx").on(
      table.ownerId,
      desc(table.createdAt),
      desc(table.id),
    ),
  ],
);

export const rateLimitEvents = sqliteTable(
  "rate_limit_events",
  {
    ownerId: text("owner_id").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("rate_limit_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);

export type LinkRow = typeof links.$inferSelect;
