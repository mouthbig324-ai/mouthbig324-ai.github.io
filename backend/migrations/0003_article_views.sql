CREATE TABLE article_views (
  path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE view_visits (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX view_visits_expiry ON view_visits(expires);
