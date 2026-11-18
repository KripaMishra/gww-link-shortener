"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="container">
      <section className="card" role="alert">
        <h1>Something went wrong</h1>
        <p className="muted">The link list could not be loaded.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
