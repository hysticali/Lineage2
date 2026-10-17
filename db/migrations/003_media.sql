ALTER TABLE media_objects ADD COLUMN provenance text;

CREATE TABLE media_links (
  media_object_id uuid PRIMARY KEY REFERENCES media_objects(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX media_links_target_idx ON media_links(target_entity_id);

-- Keeping the bytes in PostgreSQL makes attachment writes transactional and
-- keeps ordinary database backups complete without a second storage service.
CREATE TABLE media_blobs (
  media_file_id uuid PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
  content bytea NOT NULL CHECK (octet_length(content) <= 10485760)
);
