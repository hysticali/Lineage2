ALTER TABLE trees ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE family_partners ADD COLUMN parent_slot text
  CHECK (parent_slot IS NULL OR parent_slot IN ('mother', 'father'));

CREATE TABLE mutation_receipts (
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (tree_id, request_id)
);

CREATE TABLE tree_changes (
  id uuid PRIMARY KEY,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  action text NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (tree_id, revision)
);
