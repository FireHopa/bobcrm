import test from "node:test";
import assert from "node:assert/strict";
import { up, version } from "./20260707_06_backup_integrity.js";

test("migração de backup é incremental, idempotente pelo executor e não remove dados", async () => {
  const columns = [];
  const indexes = [];
  await up({
    addColumnIfMissing: async (...args) => columns.push(args),
    addIndexIfMissing: async (...args) => indexes.push(args),
  });
  assert.equal(version, "20260707_06_backup_integrity");
  for (const required of ["storage_provider", "storage_key", "status", "sha256", "verified_at", "retention_expires_at", "expired_at"]) {
    assert.equal(columns.some((item) => item[1] === required), true, `coluna ausente: ${required}`);
  }
  assert.equal(indexes.some((item) => item[1] === "idx_backups_retention"), true);
});
