import test from "node:test";
import assert from "node:assert/strict";
import { up, version } from "./20260707_05_operational_integrity.js";

test("migração de integridade é aditiva e versionada", async () => {
  const columns = [];
  const indexes = [];
  await up({
    addColumnIfMissing: async (...args) => columns.push(args),
    addIndexIfMissing: async (...args) => indexes.push(args),
  });
  assert.equal(version, "20260707_05_operational_integrity");
  assert.equal(columns.some((item) => item[1] === "merged_into_lead_id"), true);
  assert.equal(indexes.some((item) => item[1] === "idx_leads_merged_into"), true);
});
