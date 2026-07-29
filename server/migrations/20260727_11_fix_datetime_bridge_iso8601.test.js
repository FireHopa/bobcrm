import assert from "node:assert/strict";
import test from "node:test";
import { description, up, version } from "./20260727_11_fix_datetime_bridge_iso8601.js";

test("migração recria bridges sem carregar o Z do ISO para STR_TO_DATE", async () => {
  const statements = [];
  await up({ execute: async (sql) => statements.push(sql) });

  assert.equal(version, "20260727_11_fix_datetime_bridge_iso8601");
  assert.match(description, /ISO-8601/);
  assert.equal(statements.filter((sql) => /CREATE TRIGGER/i.test(sql)).length, 4);
  assert.equal(statements.filter((sql) => /DROP TRIGGER/i.test(sql)).length, 4);
  assert.ok(statements.every((sql) => !/SUBSTRING\([^\n]+, 1, 26\)/.test(sql)));
  assert.ok(statements.some((sql) => /SUBSTRING\([^\n]+, 1, 23\)/.test(sql)));
});
