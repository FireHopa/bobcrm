export const version = "20260707_06_backup_integrity";
export const description = "Metadados de backup MySQL criptografado, verificável e com retenção";

export async function up({ addColumnIfMissing, addIndexIfMissing }) {
  await addColumnIfMissing("backups", "storage_provider", "VARCHAR(40) NOT NULL DEFAULT 'legacy_local' AFTER type");
  await addColumnIfMissing("backups", "storage_key", "VARCHAR(1024) NOT NULL DEFAULT '' AFTER storage_provider");
  await addColumnIfMissing("backups", "status", "VARCHAR(40) NOT NULL DEFAULT 'legacy_unverified' AFTER storage_key");
  await addColumnIfMissing("backups", "sha256", "CHAR(64) NOT NULL DEFAULT '' AFTER size_bytes");
  await addColumnIfMissing("backups", "encryption", "VARCHAR(80) NOT NULL DEFAULT '' AFTER sha256");
  await addColumnIfMissing("backups", "compression", "VARCHAR(40) NOT NULL DEFAULT '' AFTER encryption");
  await addColumnIfMissing("backups", "format_version", "INT NOT NULL DEFAULT 0 AFTER compression");
  await addColumnIfMissing("backups", "database_name", "VARCHAR(128) NOT NULL DEFAULT '' AFTER format_version");
  await addColumnIfMissing("backups", "created_by", "VARCHAR(64) NOT NULL DEFAULT '' AFTER database_name");
  await addColumnIfMissing("backups", "verified_at", "VARCHAR(40) NOT NULL DEFAULT '' AFTER created_at");
  await addColumnIfMissing("backups", "verification_status", "VARCHAR(40) NOT NULL DEFAULT '' AFTER verified_at");
  await addColumnIfMissing("backups", "retention_expires_at", "VARCHAR(40) NOT NULL DEFAULT '' AFTER verification_status");
  await addColumnIfMissing("backups", "expired_at", "VARCHAR(40) NOT NULL DEFAULT '' AFTER retention_expires_at");
  await addColumnIfMissing("backups", "error_message", "VARCHAR(1000) NOT NULL DEFAULT '' AFTER expired_at");
  await addIndexIfMissing("backups", "idx_backups_status_created", "INDEX idx_backups_status_created (status, created_at)");
  await addIndexIfMissing("backups", "idx_backups_retention", "INDEX idx_backups_retention (expired_at, retention_expires_at)");
}
