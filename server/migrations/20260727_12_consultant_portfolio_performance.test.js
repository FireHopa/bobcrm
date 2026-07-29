import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260727_12_consultant_portfolio_performance.js";

test("migração da carteira reaplica backfill e cria índice composto", async () => {
  const calls = [];
  await up({
    backfillLeadResponsibleUserIds: async () => calls.push(["backfill"]),
    addIndexIfMissing: async (...args) => calls.push(["index", ...args]),
  });

  assert.equal(version, "20260727_12_consultant_portfolio_performance");
  assert.match(description, /Carteira de consultor/i);
  assert.deepEqual(calls[0], ["backfill"]);
  assert.equal(calls[1][1], "leads");
  assert.equal(calls[1][2], "idx_leads_owner_updated_id");
  assert.match(calls[1][3], /deleted_at, responsible_user_id, updated_at, id/);
});
