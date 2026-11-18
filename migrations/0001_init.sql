-- 0001_init.sql — initial schema for the link shortener.
-- Applied locally with `pnpm db:migrate`; remotely with `wrangler d1 migrations apply DB --remote`.

CREATE TABLE links (
  id          TEXT    PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  target_url  TEXT    NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  owner_id    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX links_owner_created_idx
  ON links (owner_id, created_at DESC, id DESC);

CREATE TABLE rate_limit_events (
  owner_id    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX rate_limit_owner_created_idx
  ON rate_limit_events (owner_id, created_at);
