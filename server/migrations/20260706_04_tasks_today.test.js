import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260706_04_tasks_today.js";

test("migração de tarefas é versionada, aditiva e faz backfill idempotente", async () => {
  const statements = [];
  await up({ execute: async (sql) => statements.push(String(sql)) });
  assert.equal(version, "20260706_04_tasks_today");
  assert.match(description, /Tarefas/);
  assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS tasks/i.test(sql)));
  assert.ok(statements.some((sql) => /INSERT IGNORE INTO tasks/i.test(sql)));
  assert.ok(statements.every((sql) => !/^\s*(DROP|TRUNCATE)\b/i.test(sql)));
});
