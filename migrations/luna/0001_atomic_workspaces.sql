-- Explicit opt-in migration. Not auto-applied by the template build migrator.
-- Parameterized application queries always scope both tables by trusted workspace.
CREATE TABLE IF NOT EXISTS luna_workspaces (
  workspace_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS luna_command_receipts (
  workspace_id text NOT NULL REFERENCES luna_workspaces(workspace_id),
  request_id text NOT NULL,
  subject text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (workspace_id, request_id)
);
