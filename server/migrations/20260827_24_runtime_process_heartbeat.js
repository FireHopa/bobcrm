export const version = "20260827_24_runtime_process_heartbeat";
export const description = "heartbeat compartilhado dos processos API/worker";

export async function up({ execute }) {
  await execute(`CREATE TABLE IF NOT EXISTS runtime_process_heartbeats (
    role VARCHAR(32) NOT NULL,
    instance_id VARCHAR(64) NOT NULL DEFAULT '',
    heartbeat_at DATETIME(3) NOT NULL,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (role),
    INDEX idx_runtime_process_heartbeats_at (heartbeat_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
