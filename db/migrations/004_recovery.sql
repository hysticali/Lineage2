ALTER TABLE tree_changes ADD COLUMN before_snapshot jsonb;
ALTER TABLE tree_changes ADD COLUMN after_snapshot jsonb;

CREATE TABLE restored_backups (
  request_id uuid PRIMARY KEY,
  request_hash text NOT NULL,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
