export const version = '20260804_18_zape_phase2_assignment';
export const description = 'Fase 2 da integração Zape com distribuição round-robin persistente';

export async function up({ execute }) {
  await execute(`CREATE TABLE IF NOT EXISTS integration_round_robin_state (
    scope_key VARCHAR(191) NOT NULL PRIMARY KEY,
    last_user_id VARCHAR(64) NOT NULL DEFAULT '',
    rotation_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at VARCHAR(40) NOT NULL DEFAULT '',
    INDEX idx_integration_round_robin_updated (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
