type D1Binding = Parameters<typeof import("drizzle-orm/d1").drizzle>[0];
type D1Migration = import("@cloudflare/vitest-plugin").D1Migration;

declare module "cloudflare:test" {
  export const env: {
    DB: D1Binding;
    TEST_MIGRATIONS: D1Migration[];
  };

  export function applyD1Migrations(
    db: D1Binding,
    migrations: D1Migration[],
    migrationsTableName?: string,
  ): Promise<void>;
}
