"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { trpc } from "@/lib/trpc";

export function CreateLinkForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now);

  useEffect(() => {
    if (retryAt === null) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAt) {
        setRetryAt(null);
        setError(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const remaining = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - clock) / 1000));

  const create = trpc.links.create.useMutation({
    onSuccess: ({ slug }) => {
      setUrl("");
      setError(null);
      setCreated(slug);
      setCopied(false);
      setRetryAt(null);
      // The list is a Server Component; refresh re-runs links.list.
      router.refresh();
    },
    onError: (mutationError) => {
      setError(mutationError.message);
      const retryAfter = (mutationError.data as { retryAfter?: number | null } | undefined)
        ?.retryAfter;
      if (typeof retryAfter === "number") {
        setRetryAt(Date.now() + retryAfter * 1000);
        setClock(Date.now());
      }
    },
  });

  async function copyShortUrl() {
    if (!created || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${created}`);
      setCopied(true);
    } catch {
      // Permission denied; the slug stays visible and selectable.
    }
  }

  const busy = create.isPending;
  const blocked = remaining > 0;

  return (
    <section className="card" aria-labelledby="create-heading">
      <h2 id="create-heading">Shorten a link</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          create.mutate({ url });
        }}
      >
        <label htmlFor="url">Long URL</label>
        <div className="row">
          <input
            id="url"
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/a/very/long/path"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
            required
          />
          <button type="submit" disabled={busy || blocked || url.trim() === ""}>
            {busy ? "Creating…" : blocked ? `Try again in ${remaining}s` : "Shorten"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {created ? (
        <p className="created" role="status">
          <a href={`/${created}`}>/{created}</a>
          <button type="button" className="link-button" onClick={copyShortUrl}>
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : null}
    </section>
  );
}
