import test from "node:test";
import assert from "node:assert/strict";
import { description, down, up, version } from "./20260723_09_commercial_profile_materialization.js";

test("migration da inteligência comercial é versionada e adiciona apenas colunas compatíveis", async () => {
  const columns = [];
  const indexes = [];
  await up({
    addColumnIfMissing: async (table, column, definition) => columns.push({ table, column, definition }),
    addIndexIfMissing: async (table, index, definition) => indexes.push({ table, index, definition }),
  });

  assert.equal(version, "20260723_09_commercial_profile_materialization");
  assert.match(description, /Materializa/);
  assert.equal(columns.length, 13);
  assert.ok(columns.every((entry) => entry.table === "leads"));
  assert.ok(columns.some((entry) => entry.column === "lead_priority_score"));
  assert.ok(columns.some((entry) => entry.column === "commercial_profile_version" && /DEFAULT 0/.test(entry.definition)));
  assert.deepEqual(indexes.map((entry) => entry.index), ["idx_leads_commercial_profile_version"]);
});

test("rollback existe mas é explícito e não destrói dados sem chamada manual", async () => {
  const statements = [];
  await down({ execute: async (sql) => { statements.push(sql); } });
  assert.ok(statements[0].includes("DROP INDEX"));
  assert.ok(statements.some((sql) => sql.includes("DROP COLUMN `commercial_profile_version`")));
});
