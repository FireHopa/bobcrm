import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260727_13_anti_fall_phase1.js";

test("migration anti-queda faz backfill set-based e cria índice de etapa", async () => {
  const executed = [];
  const indexes = [];
  await up({
    execute: async (sql, params = []) => { executed.push({ sql, params }); return { affectedRows: 0 }; },
    addIndexIfMissing: async (...args) => { indexes.push(args); },
  });
  assert.equal(version, "20260727_13_anti_fall_phase1");
  assert.match(description, /anti-queda|Proteções/i);
  assert.equal(executed.length, 1);
  assert.match(executed[0].sql, /UPDATE leads l/i);
  assert.match(executed[0].sql, /GROUP BY identity_key/i);
  assert.match(executed[0].sql, /HAVING COUNT\(DISTINCT user_id\) = 1/i);
  assert.deepEqual(indexes[0], [
    "leads",
    "idx_leads_stage_active_position",
    "INDEX idx_leads_stage_active_position (pipeline_stage_id, deleted_at, kanban_position, id)",
  ]);
});
