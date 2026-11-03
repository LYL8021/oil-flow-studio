CREATE TABLE drawing_snapshot_objects (
  object_key TEXT PRIMARY KEY NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0 AND byte_length <= 25165824),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 1 AND chunk_count <= 1024),
  created_at INTEGER NOT NULL
);

CREATE TABLE drawing_snapshot_chunks (
  object_key TEXT NOT NULL REFERENCES drawing_snapshot_objects (object_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 1048576),
  PRIMARY KEY (object_key, chunk_index)
);
