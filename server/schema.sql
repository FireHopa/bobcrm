CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  advertises_on_meta INTEGER NOT NULL DEFAULT 0,
  advertises_on_google INTEGER NOT NULL DEFAULT 0,
  does_not_advertise INTEGER NOT NULL DEFAULT 0,
  does_not_advertise_on_meta INTEGER NOT NULL DEFAULT 0,
  does_not_advertise_on_google INTEGER NOT NULL DEFAULT 0,
  last_contact_at TEXT NOT NULL DEFAULT '',
  contact_made_at TEXT NOT NULL DEFAULT '',
  next_contact_at TEXT NOT NULL DEFAULT '',
  expected_close_at TEXT NOT NULL DEFAULT '',
  estimated_budget TEXT NOT NULL DEFAULT '',
  is_lost INTEGER NOT NULL DEFAULT 0,
  lost_reason TEXT NOT NULL DEFAULT '',
  commercial_notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Novo lead',
  responsible TEXT NOT NULL DEFAULT '',
  temperature TEXT NOT NULL DEFAULT '',
  pain TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  service_interests TEXT DEFAULT '[]',
  service_status_map TEXT DEFAULT '{}',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  restored_at TEXT NOT NULL DEFAULT '',
  restored_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'consultor_vendas',
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL DEFAULT 'lead',
  entity_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  changes_json TEXT DEFAULT '{}',
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS lead_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'follow_up',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  responsible_user_id TEXT NOT NULL DEFAULT '',
  responsible_name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  completed_by TEXT NOT NULL DEFAULT '',
  next_task_id TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tasks_responsible_due ON tasks(responsible_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'manual',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS integration_events (
  event_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'zape',
  tenant_id TEXT NOT NULL DEFAULT '',
  external_lead_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'processing',
  response_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lead_external_origins (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'zape',
  tenant_id TEXT NOT NULL DEFAULT '',
  webhook_id TEXT NOT NULL DEFAULT '',
  webhook_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'WhatsApp',
  first_seen_at TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  occurrences INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT DEFAULT '{}',
  UNIQUE (lead_id, provider, tenant_id, webhook_id)
);


CREATE TABLE IF NOT EXISTS mutation_receipts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'started',
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mutation_receipts_actor_created ON mutation_receipts(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mutation_receipts_status_updated ON mutation_receipts(status, updated_at);
