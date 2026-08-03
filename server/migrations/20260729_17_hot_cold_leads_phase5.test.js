import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260729_17_hot_cold_leads_phase5.js";

test("fase 5 cria arquivo frio e estatísticas sem mover leads durante migration", async () => {
  const statements = [];
  const columns = [];
  const indexes = [];
  await up({
    execute: async (sql) => statements.push(sql),
    addColumnIfMissing: async (table, name, definition) => columns.push({ table, name, definition }),
    addIndexIfMissing: async (table, name, definition) => indexes.push({ table, name, definition }),
  });
  assert.equal(version, "20260729_17_hot_cold_leads_phase5");
  assert.match(description, /Hot\/Cold/i);
  assert.match(statements.join("\n"), /CREATE TABLE IF NOT EXISTS leads_archive LIKE leads/i);
  assert.match(statements.join("\n"), /crm_statistics/i);
  assert.ok(columns.some((item) => item.table === "leads_archive" && item.name === "archived_at"));
  assert.ok(indexes.some((item) => item.name === "idx_leads_archive_archived"));
  assert.doesNotMatch(statements.join("\n"), /DELETE\s+FROM\s+leads/i);
});
