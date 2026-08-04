import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addLeadToImportDuplicateIndex,
  applyImportKanbanTarget,
  buildImportDuplicateLookup,
  buildLeadBatchUpsert,
  buildNewLeadFollowUpTaskInsert,
  createImportDuplicateIndex,
  findImportDuplicateLead,
  resolveImportDbBatchSize,
} from "./domains/leads/importBatch.js";
import { LEAD_PERSISTENCE_COLUMNS } from "./domains/leads/leadPersistenceSql.js";
import { leadToDbParams } from "./domains/leads/leadMapper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function lead(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    name: "Empresa Teste",
    email: "contato@empresa.com",
    phone: "(11) 99999-0000",
    company: "Empresa",
    status: "Novo lead",
    serviceInterests: [],
    serviceStatusMap: {},
    customFields: {},
    createdAt: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

test("batch size da importação fica entre 100 e 1000", () => {
  assert.equal(resolveImportDbBatchSize("50"), 100);
  assert.equal(resolveImportDbBatchSize("500"), 500);
  assert.equal(resolveImportDbBatchSize("5000"), 1000);
});

test("lookup de duplicados consulta somente identidades do lote e respeita escopo", () => {
  const lookup = buildImportDuplicateLookup([
    lead({ id: "lead-1", email: "A@EXAMPLE.COM", phone: "+55 11 99999-0000" }),
    lead({ id: "lead-2", email: "b@example.com", phone: "" }),
  ], { clause: "responsible_user_id = ?", params: ["user-1"] });

  assert.match(lookup.sql, /email_key IN/);
  assert.match(lookup.sql, /phone_key IN/);
  assert.match(lookup.sql, /id IN/);
  assert.match(lookup.sql, /responsible_user_id = \?/);
  assert.doesNotMatch(lookup.sql, /SELECT \*/);
  assert.equal(lookup.params[0], "user-1");
  assert.ok(lookup.params.includes("a@example.com"));
});

test("índice em memória detecta duplicado adicionado dentro do próprio batch", () => {
  const index = createImportDuplicateIndex([]);
  const first = lead({ id: "new-1", email: "primeiro@example.com", phone: "11988887777" });
  addLeadToImportDuplicateIndex(index, first);

  assert.equal(findImportDuplicateLead(index, lead({ id: "new-2", email: "outro@example.com", phone: "11988887777" }))?.lead.id, "new-1");
});

test("upsert em batch usa uma instrução para várias linhas", () => {
  const leads = [lead({ id: "1" }), lead({ id: "2", email: "dois@example.com" })];
  const batch = buildLeadBatchUpsert(leads, "2026-07-23T15:00:00.000Z");
  assert.match(batch.sql, /INSERT INTO leads/);
  assert.match(batch.sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(batch.params.length, LEAD_PERSISTENCE_COLUMNS.length * 2);
  assert.equal(leadToDbParams(leads[0]).length, LEAD_PERSISTENCE_COLUMNS.length);
});

test("follow-ups de leads novos são gerados em INSERT único", () => {
  const batch = buildNewLeadFollowUpTaskInsert([
    lead({ id: "1", nextContactAt: "2026-07-30", responsibleUserId: "u1", responsible: "Ana" }),
    lead({ id: "2", nextContactAt: "" }),
    lead({ id: "3", nextContactAt: "2026-07-31", status: "Fechado" }),
  ], { id: "admin", name: "Admin" }, "2026-07-23T15:00:00.000Z");

  assert.equal(batch.count, 1);
  assert.match(batch.sql, /INSERT INTO tasks/);
  assert.match(batch.sql, /ON DUPLICATE KEY UPDATE/);
  assert.ok(batch.params.includes("lead-next-contact:1"));
});

test("destino escolhido na importação define funil, etapa e status do lead", () => {
  const targeted = applyImportKanbanTarget(lead({
    id: "lead-target",
    status: "Novo lead",
    pipelineId: "pipeline-antigo",
    pipelineStageId: "stage-antigo",
  }), {
    pipelineId: "pipeline-eventos",
    stageId: "stage-inscricao",
    stageType: "open",
    statusKey: "Contato feito",
    kanbanPosition: 5000,
  }, "2026-08-03T15:00:00.000Z");

  assert.equal(targeted.pipelineId, "pipeline-eventos");
  assert.equal(targeted.pipelineStageId, "stage-inscricao");
  assert.equal(targeted.status, "Contato feito");
  assert.equal(targeted.isLost, false);
  assert.equal(targeted.kanbanPosition, 5000);
  assert.equal(targeted.pipelineEnteredAt, "2026-08-03T15:00:00.000Z");
});

test("etapa perdida escolhida na importação encerra o lead corretamente", () => {
  const targeted = applyImportKanbanTarget(lead({ id: "lead-lost", status: "Em negociação" }), {
    pipelineId: "pipeline-vendas",
    stageId: "stage-perdido",
    stageType: "lost",
  }, "2026-08-03T15:00:00.000Z");

  assert.equal(targeted.status, "Perdido");
  assert.equal(targeted.isLost, true);
});

test("wiring da fase 7 usa batches transacionais e checkpoint atômico", () => {
  const source = readFileSync(path.join(__dirname, "index.js"), "utf8");
  const targetSource = readFileSync(path.join(__dirname, "domains/leads/importKanbanTarget.js"), "utf8");
  const importWiring = `${source}\n${targetSource}`;
  assert.match(source, /IMPORT_DB_BATCH_SIZE/);
  assert.match(source, /persistImportLeadBatch\(/);
  assert.match(importWiring, /resolveImportKanbanTarget\(/);
  assert.match(importWiring, /targetPipelineId/);
  assert.match(importWiring, /targetStageId/);
  assert.match(source, /progress_current = \?, progress_total = \?, progress_message = \?, result_json = \?/);
  assert.doesNotMatch(source, /buildDuplicateIndex\(/);
  assert.doesNotMatch(source, /saveLeadsWithBatchDuplicateProtection\(/);
});
