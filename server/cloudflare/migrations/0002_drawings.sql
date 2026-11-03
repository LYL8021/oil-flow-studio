CREATE TABLE drawings (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  operation_count INTEGER NOT NULL,
  object_key TEXT NOT NULL
);

CREATE INDEX drawings_newest ON drawings (updated_at DESC, id DESC);

CREATE TABLE drawing_revisions (
  drawing_id TEXT NOT NULL REFERENCES drawings (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  operation_count INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  PRIMARY KEY (drawing_id, revision)
);
