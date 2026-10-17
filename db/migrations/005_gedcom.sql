CREATE TABLE gedcom_documents (
  import_job_id uuid PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
  source_text text NOT NULL CHECK (octet_length(source_text) <= 20971520),
  header jsonb NOT NULL
);

-- Keep each imported structure alongside its relational assertion. Export can
-- update edited fields while retaining unsupported substructures and pointers.
CREATE TABLE gedcom_nodes (
  entity_id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  node jsonb NOT NULL,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_record boolean NOT NULL DEFAULT false
);

CREATE TABLE gedcom_import_receipts (
  request_id uuid PRIMARY KEY,
  request_hash text NOT NULL,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

ALTER TABLE media_links DROP CONSTRAINT media_links_pkey;
ALTER TABLE media_links ADD PRIMARY KEY (media_object_id, target_entity_id);
