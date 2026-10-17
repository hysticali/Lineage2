CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE auth_failures (
  key_hash text PRIMARY KEY,
  failures integer NOT NULL,
  window_start timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE tree_memberships (
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (tree_id, user_id)
);
CREATE TABLE tree_invitations (
  id uuid PRIMARY KEY,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  invitee_username text NOT NULL,
  role text NOT NULL CHECK (role IN ('EDITOR', 'VIEWER')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE tree_share_links (
  id uuid PRIMARY KEY,
  tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE security_events (
  id uuid PRIMARY KEY,
  tree_id uuid REFERENCES trees(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE INDEX security_events_tree_idx ON security_events(tree_id, created_at);
ALTER TABLE persons ADD COLUMN living_status text NOT NULL DEFAULT 'UNKNOWN'
  CHECK (living_status IN ('UNKNOWN', 'LIVING', 'DECEASED'));
ALTER TABLE persons ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE persons ADD CONSTRAINT persons_public_deceased CHECK (NOT is_public OR living_status = 'DECEASED');
ALTER TABLE tree_changes ADD COLUMN actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE tree_changes ADD COLUMN actor_label text NOT NULL DEFAULT 'Local user';
