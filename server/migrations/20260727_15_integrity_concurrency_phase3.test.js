import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260727_15_integrity_concurrency_phase3.js";

test("Fase 3 cria recibos de mutação e índices operacionais sem remover dados", async () => {
  const statements = [];
  const indexes = [];
  await up({ execute: async (sql) => statements.push(sql), addIndexIfMissing: async (...args) => indexes.push(args) });
  assert.equal(version, "20260727_15_integrity_concurrency_phase3");
  assert.match(description, /Fase 3/i);
  assert.match(statements.join("\n"), /CREATE TABLE IF NOT EXISTS mutation_receipts/i);
  assert.match(statements.join("\n"), /response_json JSON/i);
  assert.ok(indexes.some(([, name]) => name === "idx_leads_active_owner_status"));
  assert.ok(indexes.some(([, name]) => name === "idx_tasks_pending_lead_owner"));
  assert.doesNotMatch(statements.join("\n"), /DROP\s+TABLE|DELETE\s+FROM/i);
});
