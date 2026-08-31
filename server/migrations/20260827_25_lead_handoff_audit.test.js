import test from "node:test";
import assert from "node:assert/strict";
import { up, version } from "./20260827_25_lead_handoff_audit.js";

test("migration cria tabela e backfill de encaminhamentos", async () => {
  const statements = [];
  await up({ execute: async (sql) => { statements.push(sql); } });
  assert.equal(version, "20260827_25_lead_handoff_audit");
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS lead_handoffs/);
  assert.match(statements[0], /idx_lead_handoffs_actor_created/);
  assert.match(statements[1], /INSERT IGNORE INTO lead_handoffs/);
  assert.match(statements[1], /lead_handed_off/);
});
