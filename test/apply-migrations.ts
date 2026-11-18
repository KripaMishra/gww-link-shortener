import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file, before the tests, against the migrated baseline.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
