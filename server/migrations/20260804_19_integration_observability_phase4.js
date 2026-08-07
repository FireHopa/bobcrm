export const version = "20260804_19_integration_observability_phase4";
export const description = "Histórico permanente, incidentes e índices da integração Zape";

export async function up({ execute, addIndexIfMissing }) {
  await execute(`CREATE TABLE IF NOT EXISTS integration_health_snapshots (
    id CHAR(36) NOT NULL PRIMARY KEY,
    provider VARCHAR(40) NOT NULL DEFAULT 'zape',
    health_status VARCHAR(24) NOT NULL DEFAULT 'healthy',
    zape_online TINYINT(1) NOT NULL DEFAULT 0,
    worker_running TINYINT(1) NOT NULL DEFAULT 0,
    worker_processing TINYINT(1) NOT NULL DEFAULT 0,
    queue_storage VARCHAR(24) NOT NULL DEFAULT '',
    pending_count INT UNSIGNED NOT NULL DEFAULT 0,
    sending_count INT UNSIGNED NOT NULL DEFAULT 0,
    delivered_count INT UNSIGNED NOT NULL DEFAULT 0,
    failed_count INT UNSIGNED NOT NULL DEFAULT 0,
    oldest_pending_at VARCHAR(40) NOT NULL DEFAULT '',
    last_delivered_at VARCHAR(40) NOT NULL DEFAULT '',
    latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    delivery_rate DECIMAL(7,2) NOT NULL DEFAULT 0,
    average_delivery_ms INT UNSIGNED NOT NULL DEFAULT 0,
    reasons_json JSON NULL,
    payload_json JSON NULL,
    captured_at DATETIME(3) NOT NULL,
    INDEX idx_integration_health_provider_captured (provider, captured_at),
    INDEX idx_integration_health_status_captured (health_status, captured_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS integration_incidents (
    id CHAR(36) NOT NULL PRIMARY KEY,
    provider VARCHAR(40) NOT NULL DEFAULT 'zape',
    fingerprint VARCHAR(191) NOT NULL DEFAULT '',
    incident_type VARCHAR(80) NOT NULL DEFAULT '',
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    tenant_id VARCHAR(120) NOT NULL DEFAULT '',
    title VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NULL,
    occurrences INT UNSIGNED NOT NULL DEFAULT 1,
    first_seen_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    acknowledged_at DATETIME(3) NULL,
    acknowledged_by VARCHAR(64) NOT NULL DEFAULT '',
    resolved_at DATETIME(3) NULL,
    resolved_by VARCHAR(64) NOT NULL DEFAULT '',
    resolution_note TEXT NULL,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_integration_incidents_provider_status (provider, status, last_seen_at),
    INDEX idx_integration_incidents_fingerprint (provider, fingerprint, status),
    INDEX idx_integration_incidents_tenant (tenant_id, status, last_seen_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await addIndexIfMissing("integration_events", "idx_integration_events_provider_created", "INDEX idx_integration_events_provider_created (provider, created_at)");
  await addIndexIfMissing("integration_events", "idx_integration_events_tenant_created", "INDEX idx_integration_events_tenant_created (tenant_id, created_at)");
}
