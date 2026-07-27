import assert from "node:assert/strict";
import test from "node:test";
import { description, up, version } from "./20260724_10_parallel_datetime_columns.js";

test("migration Fase 8 cria colunas paralelas, índices focados e triggers de bridge", async () => {
  const columns = [];
  const indexes = [];
  const statements = [];
  await up({
    addColumnIfMissing: async (...args) => columns.push(args),
    addIndexIfMissing: async (...args) => indexes.push(args),
    execute: async (sql) => statements.push(sql),
  });

  assert.match(version, /20260724_10/);
  assert.match(description, /DATETIME/);
  for (const name of ["next_contact_at_dt", "expected_close_at_dt", "created_at_dt", "updated_at_dt"]) {
    assert.equal(columns.some(([table, column]) => table === "leads" && column === name), true, `leads.${name}`);
  }
  for (const name of ["due_at_dt", "completed_at_dt", "created_at_dt", "updated_at_dt"]) {
    assert.equal(columns.some(([table, column]) => table === "tasks" && column === name), true, `tasks.${name}`);
  }
  assert.equal(indexes.some(([table, name]) => table === "tasks" && name === "idx_tasks_status_due_dt"), true);
  assert.equal(indexes.some(([table, name]) => table === "leads" && name === "idx_leads_stalled_dt"), true);
  assert.equal(statements.filter((sql) => /CREATE TRIGGER/i.test(sql)).length, 4);
  assert.equal(statements.some((sql) => /NEW\.due_at_dt/i.test(sql)), true);
  assert.equal(statements.some((sql) => /NEW\.next_contact_at_dt/i.test(sql)), true);
});
