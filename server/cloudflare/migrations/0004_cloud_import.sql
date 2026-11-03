CREATE TABLE cloud_import_state (
  migration_id TEXT PRIMARY KEY NOT NULL,
  source_origin TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('importing', 'completed')),
  feedback_count INTEGER NOT NULL,
  drawing_count INTEGER NOT NULL,
  revision_count INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
