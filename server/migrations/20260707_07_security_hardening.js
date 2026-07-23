export const version = "20260707_07_security_hardening";
export const description = "Sessões com token hash, proteção CSRF e rate limit compartilhado no MySQL";

export async function up({ addColumnIfMissing, addIndexIfMissing, execute }) {
  await addColumnIfMissing("sessions", "token_format", "VARCHAR(20) NOT NULL DEFAULT 'legacy_plaintext' AFTER token");
  await addColumnIfMissing("sessions", "csrf_token_hash", "CHAR(64) NOT NULL DEFAULT '' AFTER user_id");
  await addIndexIfMissing("sessions", "idx_sessions_token_format", "INDEX idx_sessions_token_format (token_format)");

  await execute(`
    UPDATE sessions
       SET token = LOWER(SHA2(token, 256)),
           token_format = 'sha256'
     WHERE token_format != 'sha256'
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket_key VARCHAR(191) NOT NULL PRIMARY KEY,
      request_count INT UNSIGNED NOT NULL DEFAULT 0,
      reset_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
      INDEX idx_rate_limits_expires (expires_at),
      INDEX idx_rate_limits_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
