import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const backend = read("server/index.js");
const schema = read("server/schema.mysql.sql");
const api = read("src/utils/api.ts");
const handoffPolicy = read("server/leadHandoffPolicy.js");
const handoffDialog = read("src/components/LeadHandoffDialog.tsx");
const kanban = read("src/components/KanbanBoard.tsx");
const pkg = JSON.parse(read("package.json"));

test("Fase 3 registra migration e tabela de recibos idempotentes", () => {
  assert.match(backend, /20260727_15_integrity_concurrency_phase3/);
  assert.match(backend, /runIntegrityConcurrencyPhase3Migration/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS mutation_receipts/);
  assert.match(schema, /response_json JSON/);
});

test("tarefas críticas são serializadas e criação/conclusão usam recibos", () => {
  assert.match(backend, /SELECT t\.id FROM tasks t WHERE t\.id = \?[^`]+FOR UPDATE/);
  assert.match(backend, /operation: "task:create"/);
  assert.match(backend, /operation: "task:complete"/);
  assert.match(backend, /task\?\.status === "completed"/);
  assert.match(backend, /idempotentReplay: true/);
  assert.match(backend, /completeMutationReceipt\(\{ execute, client, receipt, response: completed/);
  assert.match(backend, /SELECT id FROM tasks WHERE source_key = \? LIMIT 1 FOR UPDATE/);
  assert.match(backend, /error\?\.code !== "ER_DUP_ENTRY"/);
});

test("criação/edição de lead e movimento Kanban são idempotentes e protegem escrita concorrente", () => {
  assert.match(backend, /operation: "lead:create"/);
  assert.match(api, /mutationKey\("lead:create"/);
  assert.match(backend, /assertResourceFresh\(rawLead\.updatedAt, before\?\.updatedAt, "lead"\)/);
  assert.match(backend, /assertResourceFresh\(body\.expectedUpdatedAt, lead\?\.updatedAt, "lead"\)/);
  assert.match(backend, /operation: "lead:update"/);
  assert.match(backend, /operation: "kanban:move"/);
  assert.match(kanban, /expectedUpdatedAt: sourceCard\.updatedAt/);
});

test("handoff protege contra lead alterado enquanto diálogo estava aberto", () => {
  assert.match(handoffPolicy, /expectedUpdatedAt/);
  assert.match(handoffDialog, /expectedUpdatedAt: lead\.updatedAt/);
  assert.match(backend, /assertResourceFresh\(handoff\.expectedUpdatedAt, before\.updatedAt, "lead"\)/);
});

test("frontend mantém request id estável durante retry e limpa após sucesso", () => {
  assert.match(api, /pendingMutationIds/);
  assert.match(api, /pendingMutationIds\.size >= 500/);
  assert.match(api, /stableMutationId/);
  assert.match(api, /mutationKey\("task:create"/);
  assert.match(api, /mutationKey\(`task:complete:/);
  assert.match(api, /mutationKey\("kanban:move"/);
  assert.match(api, /mutationKey\("lead:update"/);
  assert.match(api, /finishMutation\(key\)/);
});

test("jobs duplicados e retries não repetem efeitos já confirmados", () => {
  assert.match(backend, /const importHash = createHash\("sha256"\)/);
  assert.match(backend, /dedupeKey: importDedupeKey/);
  assert.match(backend, /if \(!queued\.created\) await removeJobArtifact/);
  assert.match(backend, /dedupeKey: `export:\$\{currentUser\.id\}:\$\{format\}`/);
  assert.match(backend, /createManualBackup\(actor, job\.id\)/);
  assert.match(backend, /const backupId = operationId \|\| randomUUID\(\)/);
  assert.match(backend, /id: `export:\$\{job\.id\}`/);
});

test("scripts de auditoria e reparo explícito fazem parte da Fase 3", () => {
  assert.equal(pkg.scripts["integrity:check"], "node scripts/operational-integrity.mjs");
  assert.equal(pkg.scripts["integrity:repair"], "node scripts/operational-integrity.mjs --repair");
});
