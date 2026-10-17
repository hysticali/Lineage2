CREATE TABLE trees (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  root_person_id uuid,
  source_gedcom_version text,
  default_language text,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE entities (
  id uuid PRIMARY KEY,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'PERSON', 'NAME', 'FAMILY', 'FACT', 'PLACE', 'NOTE', 'SOURCE',
    'REPOSITORY', 'CITATION', 'MEDIA_OBJECT', 'EXTENSION'
  )),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX entities_tree_type_idx ON entities(tree_id, entity_type);

CREATE TABLE persons (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  sex text CHECK (sex IS NULL OR sex IN ('M', 'F', 'X', 'U')),
  created_from_import_id uuid
);

ALTER TABLE trees
  ADD CONSTRAINT trees_root_person_fk
  FOREIGN KEY (root_person_id) REFERENCES persons(id) ON DELETE SET NULL;

CREATE TABLE person_names (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  name_type text,
  full_text text NOT NULL,
  prefix text,
  given_names text,
  nickname text,
  surname_prefix text,
  surname text,
  suffix text,
  language_tag text,
  is_primary boolean NOT NULL DEFAULT false
);

CREATE INDEX person_names_person_idx ON person_names(person_id, position);
CREATE UNIQUE INDEX person_names_one_primary_idx
  ON person_names(person_id) WHERE is_primary;

CREATE TABLE families (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  label text,
  created_from_import_id uuid
);

CREATE TABLE family_partners (
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  role text NOT NULL DEFAULT 'PARTNER' CHECK (role IN ('PARTNER', 'HUSB', 'WIFE')),
  PRIMARY KEY (family_id, person_id)
);

CREATE INDEX family_partners_person_idx ON family_partners(person_id);

CREATE TABLE family_children (
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  pedigree text NOT NULL DEFAULT 'UNKNOWN' CHECK (pedigree IN (
    'BIRTH', 'ADOPTED', 'FOSTER', 'SEALING', 'UNKNOWN'
  )),
  relationship_status text,
  is_preferred boolean NOT NULL DEFAULT false,
  PRIMARY KEY (family_id, person_id)
);

CREATE INDEX family_children_person_idx ON family_children(person_id);

CREATE TABLE places (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  jurisdiction_format text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE facts (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  person_id uuid REFERENCES persons(id) ON DELETE CASCADE,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  fact_kind text NOT NULL CHECK (fact_kind IN ('EVENT', 'ATTRIBUTE')),
  gedcom_tag text NOT NULL,
  type_text text,
  value_text text,
  date_original text,
  date_calendar text,
  date_modifier text,
  date_start_year integer,
  date_start_month smallint CHECK (date_start_month IS NULL OR date_start_month BETWEEN 1 AND 12),
  date_start_day smallint CHECK (date_start_day IS NULL OR date_start_day BETWEEN 1 AND 31),
  date_end_year integer,
  date_end_month smallint CHECK (date_end_month IS NULL OR date_end_month BETWEEN 1 AND 12),
  date_end_day smallint CHECK (date_end_day IS NULL OR date_end_day BETWEEN 1 AND 31),
  sort_date_original text,
  place_id uuid REFERENCES places(id) ON DELETE SET NULL,
  CHECK ((person_id IS NOT NULL) <> (family_id IS NOT NULL))
);

CREATE INDEX facts_person_idx ON facts(person_id, gedcom_tag, position);
CREATE INDEX facts_family_idx ON facts(family_id, gedcom_tag, position);
CREATE INDEX facts_date_range_idx ON facts(date_start_year, date_end_year);

CREATE TABLE notes (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  person_id uuid REFERENCES persons(id) ON DELETE CASCADE,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  fact_id uuid REFERENCES facts(id) ON DELETE CASCADE,
  text_value text NOT NULL,
  mime_type text NOT NULL DEFAULT 'text/plain',
  language_tag text,
  is_shared boolean NOT NULL DEFAULT false,
  CHECK (
    (CASE WHEN person_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN family_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN fact_id IS NULL THEN 0 ELSE 1 END) <= 1
  )
);

CREATE TABLE repositories (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  address_text text,
  website_uri text
);

CREATE TABLE sources (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text,
  publication_text text,
  abbreviation text,
  repository_id uuid REFERENCES repositories(id) ON DELETE SET NULL
);

CREATE TABLE citations (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  page_text text,
  event_type text,
  role text,
  data_text text,
  quality smallint CHECK (quality IS NULL OR quality BETWEEN 0 AND 3)
);

CREATE INDEX citations_target_idx ON citations(target_entity_id);

CREATE TABLE media_objects (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title text,
  description text
);

CREATE TABLE media_files (
  id uuid PRIMARY KEY,
  media_object_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  file_reference text NOT NULL,
  mime_type text,
  checksum_sha256 text,
  storage_key text,
  UNIQUE (media_object_id, position)
);

CREATE TABLE identifiers (
  id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('UID', 'REFN', 'EXID')),
  value text NOT NULL,
  authority_uri text,
  UNIQUE (entity_id, identifier_type, value),
  CHECK (identifier_type <> 'EXID' OR authority_uri IS NOT NULL)
);

CREATE UNIQUE INDEX identifiers_uid_unique_idx
  ON identifiers(value) WHERE identifier_type = 'UID';
CREATE INDEX identifiers_lookup_idx
  ON identifiers(identifier_type, value);

CREATE TABLE restrictions (
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  restriction text NOT NULL CHECK (restriction IN ('CONFIDENTIAL', 'LOCKED', 'PRIVACY')),
  PRIMARY KEY (entity_id, restriction)
);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY,
  tree_id uuid REFERENCES trees(id) ON DELETE SET NULL,
  source_filename text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('JSON', 'GEDCOM', 'GEDZIP')),
  gedcom_version text,
  checksum_sha256 text,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE import_xrefs (
  import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  xref text NOT NULL,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (import_job_id, xref)
);

CREATE TABLE extension_nodes (
  id uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  parent_entity_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  parent_extension_id uuid REFERENCES extension_nodes(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  tag text NOT NULL,
  tag_uri text,
  payload text,
  CHECK ((parent_entity_id IS NOT NULL) <> (parent_extension_id IS NOT NULL))
);

CREATE INDEX extension_nodes_parent_entity_idx
  ON extension_nodes(parent_entity_id, position);
CREATE INDEX extension_nodes_parent_extension_idx
  ON extension_nodes(parent_extension_id, position);

ALTER TABLE persons
  ADD CONSTRAINT persons_import_job_fk
  FOREIGN KEY (created_from_import_id) REFERENCES import_jobs(id) ON DELETE SET NULL;

ALTER TABLE families
  ADD CONSTRAINT families_import_job_fk
  FOREIGN KEY (created_from_import_id) REFERENCES import_jobs(id) ON DELETE SET NULL;
