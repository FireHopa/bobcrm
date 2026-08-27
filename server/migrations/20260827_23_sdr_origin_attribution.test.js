import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260827_23_sdr_origin_attribution.js";

test("migração cria colunas, índice e backfill seguro do SDR de origem", async () => {
  const columns = [];
  const indexes = [];
  const statements = [];
  await up({
    addColumnIfMissing: async (...args) => columns.push(args),
    addIndexIfMissing: async (...args) => indexes.push(args),
    execute: async (sql) => statements.push(sql),
  });

  assert.equal(version, "20260827_23_sdr_origin_attribution");
  assert.match(description, /SDR/i);
  assert.deepEqual(columns.map((item) => item[1]), ["sdr_responsible", "sdr_responsible_user_id"]);
  assert.deepEqual(indexes.map((item) => item[1]), ["idx_leads_sdr_responsible_user"]);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /action = 'lead_created'/);
  assert.match(statements[0], /role IN \('pre_venda', 'gerente'\)/);
  assert.match(statements[0], /sdr_responsible_user_id = a\.actor_id/);
});
