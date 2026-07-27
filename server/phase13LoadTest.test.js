import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loadTestSource = await readFile(new URL("../scripts/load-test.mjs", import.meta.url), "utf8");
const coreSource = await readFile(new URL("../scripts/load-test-core.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("phase13 substitui limites antigos de 10s/15s pelas metas do CRM", () => {
  assert.doesNotMatch(loadTestSource, /10_000[^\n]*p95|15_000[^\n]*p95/);
  assert.match(coreSource, /leads_list:\s*400/);
  assert.match(coreSource, /lead_detail:\s*300/);
  assert.match(coreSource, /search:\s*800/);
  assert.match(coreSource, /kanban:\s*900/);
  assert.match(coreSource, /dashboard:\s*800/);
  assert.match(coreSource, /summary:\s*500/);
  assert.match(coreSource, /create_lead:\s*700/);
  assert.match(coreSource, /edit_lead:\s*700/);
});

test("phase13 cobre os quatro níveis obrigatórios de concorrência", () => {
  assert.match(coreSource, /10,\s*25,\s*50,\s*100/);
});

test("phase13 full cobre 10k, 50k, 133k e 300k", () => {
  for (const size of ["10_000", "50_000", "133_000", "300_000"]) assert.match(coreSource, new RegExp(size));
});

test("phase13 usa API e worker separados no cluster descartável", () => {
  assert.match(loadTestSource, /PROCESS_ROLE:\s*"api"/);
  assert.match(loadTestSource, /PROCESS_ROLE:\s*"worker"/);
  assert.match(loadTestSource, /MYSQL_API_CONNECTION_LIMIT:\s*"8"/);
  assert.match(loadTestSource, /MYSQL_WORKER_CONNECTION_LIMIT:\s*"2"/);
});

test("phase13 mede navegação durante importação ativa com 20 usuários", () => {
  assert.match(loadTestSource, /IMPORT_NAV_CONCURRENCY\s*=\s*20/);
  assert.match(loadTestSource, /\/api\/leads\/import/);
  assert.match(loadTestSource, /evaluateImportImpact/);
});

test("phase13 gera relatórios markdown e json", () => {
  assert.match(loadTestSource, /LOAD_TEST_REPORT\.md/);
  assert.match(loadTestSource, /LOAD_TEST_REPORT\.json/);
});

test("phase13 oferece smoke e full sem remover test:load", () => {
  assert.ok(packageJson.scripts["test:load"]);
  assert.ok(packageJson.scripts["test:load:smoke"]);
  assert.ok(packageJson.scripts["test:load:full"]);
  assert.ok(packageJson.scripts["test:phase13-performance"]);
});
