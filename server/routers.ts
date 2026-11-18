import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseTargetUrl } from "@/lib/validation";

import { createLink, listLinks, RateLimitedError, SlugExhaustedError } from "./links";
import { createCallerFactory, publicProcedure, router } from "./trpc";

export const linksRouter = router({
  create: publicProcedure
    .input(z.object({ url: z.string().max(2048, "URL is too long.") }))
    .mutation(async ({ ctx, input }) => {
      const targetUrl = parseTargetUrl(input.url);
      if (targetUrl === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paste a valid http(s) URL.",
        });
      }

      try {
        return await createLink(
          { db: ctx.db, ownerId: ctx.userId, now: ctx.clock() },
          targetUrl,
        );
      } catch (error) {
        if (error instanceof RateLimitedError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `5 links per minute — try again in ${error.retryAfter}s.`,
            cause: { retryAfter: error.retryAfter },
          });
        }
        if (error instanceof SlugExhaustedError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not allocate a unique slug. Try again.",
          });
        }
        throw error;
      }
    }),

  list: publicProcedure.query(({ ctx }) => listLinks(ctx.db, ctx.userId)),
});

export const appRouter = router({ links: linksRouter });

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
