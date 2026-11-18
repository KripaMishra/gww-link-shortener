import { CreateLinkForm } from "@/components/create-link-form";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers";

// A Drizzle read is not a Next.js dynamic API. Without this the list would be
// prerendered at build time and never change.
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export default async function HomePage() {
  const caller = createCaller(await createContext());
  const { items, hasMore } = await caller.links.list();

  return (
    <main className="container">
      <header className="header">
        <h1>Link shortener</h1>
        <p className="muted">Paste a URL, get a slug. Five links per rolling minute.</p>
      </header>

      <CreateLinkForm />

      <section className="card" aria-labelledby="links-heading">
        <div className="section-heading">
          <h2 id="links-heading">Your links</h2>
          <span className="muted">{items.length} shown</span>
        </div>

        {items.length === 0 ? (
          <p className="empty">No links yet. Shorten your first URL above.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Slug</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="numeric">
                    Clicks
                  </th>
                  <th scope="col">Created (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((link) => (
                  <tr key={link.id}>
                    <td>
                      <a className="slug" href={`/${link.slug}`}>
                        /{link.slug}
                      </a>
                    </td>
                    <td className="target" title={link.targetUrl}>
                      {link.targetUrl}
                    </td>
                    <td className="numeric">{link.clicks}</td>
                    <td className="muted">{dateFormat.format(new Date(link.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore ? <p className="muted">Showing the latest 50 links.</p> : null}
      </section>
    </main>
  );
}
