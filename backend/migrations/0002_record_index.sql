CREATE TABLE record_index (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(kind, id)
);
CREATE INDEX request_limits_expiry ON request_limits(expires);
