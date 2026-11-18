import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";
import { handleRedirect, type RedirectResult } from "@/server/links";

function toResponse(result: RedirectResult, head: boolean): Response {
  if (result.status === 302) {
    return head
      ? new Response(null, { status: 302, headers: { location: result.location } })
      : NextResponse.redirect(result.location, 302);
  }

  if (head) return new Response(null, { status: result.status });

  return new Response(result.status === 404 ? "Not found" : "Bad target", {
    status: result.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return toResponse(await handleRedirect(await getDb(), slug), false);
}

// Previews, scanners, and link unfurlers use HEAD. Resolve without counting.
export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return toResponse(await handleRedirect(await getDb(), slug, { count: false }), true);
}
