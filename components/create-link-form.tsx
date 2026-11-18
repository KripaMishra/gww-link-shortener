"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

export function CreateLinkForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.links.create.useMutation({
    onSuccess: ({ slug }) => {
      setUrl("");
      setError(null);
      setCreated(slug);
      setCopied(false);
      // The list is a Server Component; refresh re-runs links.list.
      router.refresh();
    },
    onError: (mutationError) => {
      setCreated(null);
      setError(mutationError.message);
    },
  });

  async function copyShortUrl() {
    if (!created || !navigator.clipboard) return;
    await navigator.clipboard.writeText(`${window.location.origin}/${created}`);
    setCopied(true);
  }

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
            disabled={create.isPending}
            required
          />
          <button type="submit" disabled={create.isPending || url.trim() === ""}>
            {create.isPending ? "Creating…" : "Shorten"}
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
