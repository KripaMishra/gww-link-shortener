// Derive the D1 binding type from Drizzle rather than pulling in the Workers
// globals, which conflict with the DOM types Next.js already uses.
type D1Binding = Parameters<typeof import("drizzle-orm/d1").drizzle>[0];

declare global {
  interface CloudflareEnv {
    DB: D1Binding;
  }
}

export {};
