import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [serverSource, schemaSource, apiSource, settingsSource, restoreSource] = await Promise.all([
  readFile(new URL("./index.js", import.meta.url), "utf8"),
  readFile(new URL("./schema.mysql.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/utils/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/SettingsCenter.tsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/restore-backup.mjs", import.meta.url), "utf8"),
]);

test("backend não usa mais backup JSON parcial", () => {
  assert.doesNotMatch(serverSource, /JSON\.stringify\(\{ exportedAt: nowIso\(\), storage: "mysql"/);
  assert.match(serverSource, /createEncryptedMysqlBackup/);
  assert.match(serverSource, /verifyEncryptedMysqlBackup/);
  assert.match(serverSource, /status = 'expired'/);
});

test("rota legada mantém compatibilidade com depreciação explícita", () => {
  assert.match(serverSource, /pathname === "\/api\/backup\/sqlite"/);
  assert.match(serverSource, /setHeader\("Deprecation", "true"\)/);
  assert.match(serverSource, /setHeader\("Sunset", "Thu, 01 Oct 2026 00:00:00 GMT"\)/);
  assert.match(serverSource, /enqueuePersistentJob/);
  assert.match(serverSource, /sendJson\(response, 202/);
  assert.match(serverSource, /pathname === "\/api\/backups" && method === "POST"/);
});

test("schema de backup registra criptografia, hash, verificação e retenção", () => {
  for (const column of ["storage_provider", "storage_key", "status", "sha256", "encryption", "verified_at", "retention_expires_at", "expired_at"]) {
    assert.match(schemaSource, new RegExp(`\\b${column}\\b`), `coluna ausente: ${column}`);
  }
});

test("frontend usa rota canônica e formato criptografado", () => {
  assert.match(apiSource, /const backup = await createBackupOnServer\(\)/);
  assert.match(apiSource, /\.cadbkp/);
  assert.doesNotMatch(apiSource, /downloadFile\("\/api\/backup\/sqlite"/);
  assert.match(settingsSource, /Criar e baixar/);
  assert.match(settingsSource, /AES-256-GCM/);
});

test("restauração operacional bloqueia banco ocupado e exige confirmação reforçada", () => {
  assert.match(restoreSource, /O banco de destino não está vazio/);
  assert.match(restoreSource, /BACKUP_RESTORE_ALLOW_ANY_TARGET/);
  assert.match(restoreSource, /BACKUP_RESTORE_CONFIRM_DATABASE/);
  assert.match(restoreSource, /A restauração no banco de origem é bloqueada/);
});
