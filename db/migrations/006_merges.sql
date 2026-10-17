ALTER TABLE persons ADD COLUMN display_reference text;
ALTER TABLE notes ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position >= 0);

CREATE TABLE gedcom_fragments (
  id uuid PRIMARY KEY,
  owner_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  node jsonb NOT NULL
);
