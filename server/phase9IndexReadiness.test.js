import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeLeadSort } from "./accessControl.js";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema.mysql.sql", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const explainSource = readFileSync(new URL("../scripts/mysql-explain-analyze.mjs", import.meta.url), "utf8");

test("ordenação da lista não envolve coluna indexável em COALESCE", () => {
  assert.match(indexSource, /const orderExpression = sort\.column/);
  assert.doesNotMatch(indexSource, /const orderExpression = `COALESCE\(\$\{sort\.column\}/);
  assert.deepEqual(normalizeLeadSort("updatedAt", "desc"), { key: "updatedAt", column: "updated_at", direction: "DESC" });
});

test("fase 9 preserva índices existentes até existir evidência de EXPLAIN ANALYZE", () => {
  for (const index of [
    "idx_leads_updated_at",
    "idx_leads_pipeline_stage",
    "idx_leads_search_email",
    "idx_leads_search_phone",
    "ft_leads_search_text",
    "idx_tasks_responsible_due_dt",
    "idx_tasks_status_due_dt",
    "idx_tasks_completed_dt",
  ]) assert.match(schemaSource, new RegExp(index));
  assert.doesNotMatch(indexSource, /20260724_11_phase9/);
});

test("script de EXPLAIN possui proteção de tempo e não contém DDL/DML de aplicação", () => {
  assert.match(explainSource, /MAX_EXECUTION_TIME/);
  assert.match(explainSource, /EXPLAIN ANALYZE/);
  assert.match(explainSource, /--explain-only/);
  assert.doesNotMatch(explainSource, /ALTER TABLE|DROP INDEX|CREATE INDEX|UPDATE leads|DELETE FROM leads|INSERT INTO leads/i);
});

test("package expõe comandos operacionais da fase 9", () => {
  assert.equal(packageJson.scripts["mysql:explain"], "node scripts/mysql-explain-analyze.mjs");
  assert.equal(packageJson.scripts["mysql:explain:plan"], "node scripts/mysql-explain-analyze.mjs --explain-only");
  assert.match(packageJson.scripts["test:phase9-performance"], /mysql-explain-core\.test\.mjs/);
});
