CREATE TABLE feedback (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('idea', 'bug', 'ui', 'other')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX feedback_newest ON feedback (created_at DESC, id DESC);
