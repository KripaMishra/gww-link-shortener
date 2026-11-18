import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";
import { handleRedirect } from "@/server/links";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const result = await handleRedirect(await getDb(), slug);

  if (result.status === 302) {
    return NextResponse.redirect(result.location, 302);
  }

  return new Response(result.status === 404 ? "Not found" : "Bad target", {
    status: result.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
