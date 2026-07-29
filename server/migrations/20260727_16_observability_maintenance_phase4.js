export const version = "20260727_16_observability_maintenance_phase4";
export const description = "Observabilidade operacional persistente e retenção segura de histórico";

export async function up({ execute, addIndexIfMissing }) {
  await execute(`CREATE TABLE IF NOT EXISTS operational_health_snapshots (
    id CHAR(36) NOT NULL PRIMARY KEY,
    process_role VARCHAR(24) NOT NULL DEFAULT 'unknown',
    status VARCHAR(24) NOT NULL DEFAULT 'ok',
    rss_mb DECIMAL(12,2) NOT NULL DEFAULT 0,
    heap_used_mb DECIMAL(12,2) NOT NULL DEFAULT 0,
    cpu_pct DECIMAL(8,2) NOT NULL DEFAULT 0,
    event_loop_p95_ms DECIMAL(12,2) NOT NULL DEFAULT 0,
    pool_connections INT UNSIGNED NOT NULL DEFAULT 0,
    pool_free INT UNSIGNED NOT NULL DEFAULT 0,
    pool_pending INT UNSIGNED NOT NULL DEFAULT 0,
    pool_limit INT UNSIGNED NOT NULL DEFAULT 0,
    active_requests INT UNSIGNED NOT NULL DEFAULT 0,
    active_jobs INT UNSIGNED NOT NULL DEFAULT 0,
    warnings_json JSON NULL,
    captured_at DATETIME(3) NOT NULL,
    INDEX idx_ops_health_captured (captured_at),
    INDEX idx_ops_health_role_captured (process_role, captured_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await addIndexIfMissing("audit_log", "idx_audit_actor_created", "INDEX idx_audit_actor_created (actor_id, created_at)");
  await addIndexIfMissing("mutation_receipts", "idx_mutation_receipts_updated", "INDEX idx_mutation_receipts_updated (updated_at)");
}
