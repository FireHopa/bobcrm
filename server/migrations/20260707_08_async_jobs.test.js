import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260707_08_async_jobs.js";

test("migração de jobs é aditiva, idempotente e não altera tabelas existentes", async () => {
  const statements = [];
  await up({ execute: async (sql) => statements.push(String(sql).replace(/\s+/g, " ").trim()) });
  assert.equal(version, "20260707_08_async_jobs");
  assert.match(description, /jobs assíncronos/i);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS async_jobs/);
  assert.match(statements[0], /UNIQUE KEY idx_async_jobs_dedupe/);
  assert.match(statements[0], /INDEX idx_async_jobs_claim/);
  assert.doesNotMatch(statements[0], /\b(?:DROP|TRUNCATE|ALTER TABLE leads|DELETE FROM)\b/i);
});
