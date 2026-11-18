import { initTRPC } from "@trpc/server";

import type { Context } from "./context";

/**
 * Pulls the machine-readable retry window out of the error cause so the client
 * gets `data.retryAfter` instead of having to parse the message string.
 */
export function retryAfterFromError(error: { cause?: unknown }): number | null {
  const cause = error.cause;
  if (cause && typeof cause === "object" && "retryAfter" in cause) {
    const value = (cause as { retryAfter?: unknown }).retryAfter;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        retryAfter: retryAfterFromError(error),
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
