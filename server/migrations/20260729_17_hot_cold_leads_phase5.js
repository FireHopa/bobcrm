export const version = "20260729_17_hot_cold_leads_phase5";
export const description = "Fase 5 Hot/Cold Leads com arquivo operacional, estatísticas e índices de arquivamento";

export async function up({ execute, addColumnIfMissing, addIndexIfMissing }) {
  await execute("CREATE TABLE IF NOT EXISTS leads_archive LIKE leads");
  await addColumnIfMissing("leads_archive", "archived_at", "DATETIME(3) NULL");
  await addColumnIfMissing("leads_archive", "archived_by", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads_archive", "archive_reason", "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads_archive", "archive_batch_id", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addIndexIfMissing("leads_archive", "idx_leads_archive_archived", "INDEX idx_leads_archive_archived (archived_at, id)");
  await addIndexIfMissing("leads_archive", "idx_leads_archive_reason", "INDEX idx_leads_archive_reason (archive_reason, archived_at)");
  await addIndexIfMissing("leads_archive", "idx_leads_archive_updated", "INDEX idx_leads_archive_updated (updated_at_dt, id)");

  await execute(`CREATE TABLE IF NOT EXISTS crm_statistics (
    metric_key VARCHAR(80) NOT NULL PRIMARY KEY,
    metric_value BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_crm_statistics_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`INSERT INTO crm_statistics (metric_key, metric_value, updated_at)
    SELECT 'active_leads', COUNT(*), NOW(3) FROM leads WHERE deleted_at = ''
    ON DUPLICATE KEY UPDATE metric_value = VALUES(metric_value), updated_at = VALUES(updated_at)`);
  await execute(`INSERT INTO crm_statistics (metric_key, metric_value, updated_at)
    SELECT 'archived_leads', COUNT(*), NOW(3) FROM leads_archive
    ON DUPLICATE KEY UPDATE metric_value = VALUES(metric_value), updated_at = VALUES(updated_at)`);
  await execute(`INSERT INTO crm_statistics (metric_key, metric_value, updated_at)
    VALUES ('archive_protected_overflow', 0, NOW(3))
    ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`);
}
