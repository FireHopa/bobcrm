import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260727_16_observability_maintenance_phase4.js";

test("phase 4 creates bounded operational snapshot storage and retention indexes", async () => {
  const statements = [];
  const indexes = [];
  await up({
    execute: async (sql) => statements.push(sql),
    addIndexIfMissing: async (table, name, definition) => indexes.push({ table, name, definition }),
  });
  assert.equal(version, "20260727_16_observability_maintenance_phase4");
  assert.match(description, /Observabilidade operacional/i);
  assert.match(statements.join("\n"), /operational_health_snapshots/i);
  assert.ok(indexes.some((item) => item.name === "idx_audit_actor_created"));
  assert.ok(indexes.some((item) => item.name === "idx_mutation_receipts_updated"));
});
