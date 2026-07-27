import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const audit = readFileSync(path.join(root, "scripts", "mysql-hardening-audit.mjs"), "utf8");
const core = readFileSync(path.join(root, "scripts", "mysql-hardening-core.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const env = readFileSync(path.join(here, ".env.example"), "utf8");

test("Fase 12 possui auditor MySQL somente leitura e amostra dinâmica", () => {
  assert.match(audit, /SHOW GLOBAL VARIABLES/);
  assert.match(audit, /SHOW GLOBAL STATUS/);
  assert.match(audit, /events_statements_summary_by_digest/);
  assert.match(audit, /table_io_waits_summary_by_index_usage/);
  assert.match(audit, /SAMPLE_SECONDS/);
  assert.doesNotMatch(audit, /SET GLOBAL|ALTER INSTANCE|CREATE INDEX|DROP INDEX|UPDATE leads|DELETE FROM/i);
});

test("Fase 12 não recomenda aumentar conexões ou memória cegamente", () => {
  assert.match(core, /Não aumente max_connections automaticamente/);
  assert.match(core, /NÃO APLICAR AUTOMATICAMENTE/i);
  assert.match(core, /# innodb_buffer_pool_size/);
  assert.match(core, /# max_connections/);
});

test("Fase 12 expõe scripts reproduzíveis e limites de auditoria", () => {
  assert.equal(packageJson.scripts["mysql:hardening"], "node scripts/mysql-hardening-audit.mjs");
  assert.match(env, /MYSQL_HARDENING_SAMPLE_SECONDS=5/);
  assert.match(env, /MYSQL_HARDENING_MAX_DIGESTS=20/);
});
