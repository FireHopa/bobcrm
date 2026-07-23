import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260706_03_commercial_roles_notes.js";

test("migração dos papéis comerciais é versionada, aditiva e preserva usuários legados com regra segura", async () => {
  const calls = [];
  await up({
    addColumnIfMissing: async (...args) => calls.push(["column", ...args]),
    addIndexIfMissing: async (...args) => calls.push(["index", ...args]),
    execute: async (sql) => calls.push(["sql", String(sql).replace(/\s+/g, " ").trim()]),
  });

  assert.equal(version, "20260706_03_commercial_roles_notes");
  assert.match(description, /Papéis comerciais/i);
  assert.equal(calls.some((call) => call.join(" ").includes("expected_close_at")), true);
  assert.equal(calls.some((call) => call.join(" ").includes("CREATE TABLE IF NOT EXISTS lead_notes")), true);
  assert.equal(calls.some((call) => call.join(" ").includes("role = 'consultor_vendas'")), true);
  assert.equal(calls.some((call) => call.join(" ").includes("is_active = 0 WHERE role = 'leitura'")), true);
  assert.equal(calls.some((call) => call.join(" ").match(/\b(?:DROP|DELETE|TRUNCATE)\b/i)), false);
});
