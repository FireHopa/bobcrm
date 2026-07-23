export const version = "20260707_08_async_jobs";
export const description = "Fila persistente de jobs assíncronos, artifacts temporários e recuperação após interrupção";

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS async_jobs (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      type VARCHAR(64) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'queued',
      payload_json JSON NULL,
      result_json JSON NULL,
      progress_current BIGINT UNSIGNED NOT NULL DEFAULT 0,
      progress_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
      progress_message VARCHAR(255) NOT NULL DEFAULT '',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
      run_after VARCHAR(40) NOT NULL DEFAULT '',
      locked_by VARCHAR(191) NOT NULL DEFAULT '',
      locked_at VARCHAR(40) NOT NULL DEFAULT '',
      heartbeat_at VARCHAR(40) NOT NULL DEFAULT '',
      created_by VARCHAR(64) NOT NULL DEFAULT '',
      created_by_name VARCHAR(255) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      started_at VARCHAR(40) NOT NULL DEFAULT '',
      completed_at VARCHAR(40) NOT NULL DEFAULT '',
      failed_at VARCHAR(40) NOT NULL DEFAULT '',
      expires_at VARCHAR(40) NOT NULL DEFAULT '',
      payload_storage_key VARCHAR(1024) NOT NULL DEFAULT '',
      artifact_storage_key VARCHAR(1024) NOT NULL DEFAULT '',
      artifact_file_name VARCHAR(255) NOT NULL DEFAULT '',
      artifact_content_type VARCHAR(160) NOT NULL DEFAULT '',
      artifact_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      artifact_sha256 CHAR(64) NOT NULL DEFAULT '',
      error_code VARCHAR(80) NOT NULL DEFAULT '',
      error_message VARCHAR(1000) NOT NULL DEFAULT '',
      dedupe_key VARCHAR(191) NULL,
      UNIQUE KEY idx_async_jobs_dedupe (dedupe_key),
      INDEX idx_async_jobs_claim (status, run_after, created_at),
      INDEX idx_async_jobs_worker (status, heartbeat_at),
      INDEX idx_async_jobs_creator (created_by, created_at),
      INDEX idx_async_jobs_expiry (status, expires_at),
      INDEX idx_async_jobs_type_status (type, status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
