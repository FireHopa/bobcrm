import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260706_02_lead_scope_teams.js";

test("migração de escopo é versionada e somente aditiva", async () => {
  const calls = [];
  await up({
    addColumnIfMissing: async (...args) => calls.push(["column", ...args]),
    addIndexIfMissing: async (...args) => calls.push(["index", ...args]),
    backfillLeadResponsibleUserIds: async () => calls.push(["backfill"]),
  });

  assert.equal(version, "20260706_02_lead_scope_teams");
  assert.match(description, /Escopo de carteira/);
  assert.equal(calls.filter(([type]) => type === "column").length, 3);
  assert.equal(calls.filter(([type]) => type === "index").length, 3);
  assert.deepEqual(calls.at(-1), ["backfill"]);
  assert.equal(calls.some((call) => call.join(" ").match(/\b(?:DROP|DELETE|TRUNCATE)\b/i)), false);
});
