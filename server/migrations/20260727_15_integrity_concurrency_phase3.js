export const version = "20260727_15_integrity_concurrency_phase3";
export const description = "Fase 3: recibos idempotentes, concorrência segura e índices de integridade operacional";

export async function up({ execute, addIndexIfMissing }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS mutation_receipts (
      id CHAR(64) NOT NULL PRIMARY KEY,
      actor_id VARCHAR(64) NOT NULL DEFAULT '',
      operation VARCHAR(64) NOT NULL DEFAULT '',
      request_id VARCHAR(120) NOT NULL DEFAULT '',
      resource_id VARCHAR(64) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'started',
      response_json JSON NULL,
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      completed_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_mutation_receipts_actor_created (actor_id, created_at),
      INDEX idx_mutation_receipts_status_updated (status, updated_at),
      INDEX idx_mutation_receipts_resource (resource_id, operation, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing("leads", "idx_leads_active_owner_status", "INDEX idx_leads_active_owner_status (deleted_at, responsible_user_id, status, id)");
  await addIndexIfMissing("tasks", "idx_tasks_pending_lead_owner", "INDEX idx_tasks_pending_lead_owner (status, lead_id, responsible_user_id, due_at)");
}
