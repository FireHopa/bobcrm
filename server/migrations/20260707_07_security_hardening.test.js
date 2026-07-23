import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260707_07_security_hardening.js";

test("migração de segurança é incremental, reexecutável e não apaga sessões", async () => {
  const calls = [];
  await up({
    addColumnIfMissing: async (...args) => calls.push(["column", ...args]),
    addIndexIfMissing: async (...args) => calls.push(["index", ...args]),
    execute: async (sql) => calls.push(["sql", String(sql).replace(/\s+/g, " ").trim()]),
  });

  assert.equal(version, "20260707_07_security_hardening");
  assert.match(description, /token hash/i);
  assert.equal(calls.some((item) => item.join(" ").includes("csrf_token_hash")), true);
  assert.equal(calls.some((item) => item.join(" ").includes("token_format != 'sha256'")), true);
  assert.equal(calls.some((item) => item.join(" ").includes("CREATE TABLE IF NOT EXISTS rate_limits")), true);
  assert.equal(calls.some((item) => /\b(?:DROP|TRUNCATE|DELETE FROM sessions)\b/i.test(item.join(" "))), false);
});
