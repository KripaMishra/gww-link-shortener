import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes the `DB` D1 binding from wrangler.jsonc available to `next dev`
// through getCloudflareContext(), so local dev uses the same driver as Workers.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // The home directory contains another lockfile; pin the tracing root to this project.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
