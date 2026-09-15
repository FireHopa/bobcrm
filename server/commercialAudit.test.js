import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialAuditAnalytics, expandCommercialAuditRow } from "./commercialAudit.js";

function context() {
  return {
    tasks: new Map([
      ["task-1", { id: "task-1", lead_id: "lead-1", title: "Ligar para cliente", responsible_user_id: "user-2", responsible_name: "Consultor Atual", result: "Contato realizado", source: "manual" }],
    ]),
    leads: new Map([
      ["lead-1", { id: "lead-1", name: "Empresa Alfa", company: "Alfa Ltda", source: "WhatsApp", responsible_user_id: "user-2", responsible: "Consultor Atual", pipeline_id: "pipe-1", pipeline_stage_id: "stage-won", lost_reason: "" }],
    ]),
    pipelines: new Map([["pipe-1", "Funil Comercial Atual"]]),
    stages: new Map([
      ["stage-open", "Reunião Agendada Atual"],
      ["stage-won", "Contrato Fechado Atual"],
      ["stage-lost", "Sem Interesse Atual"],
    ]),
    stageTypes: new Map([["stage-open", "open"], ["stage-won", "won"], ["stage-lost", "lost"]]),
    users: new Map([["user-1", "SDR"], ["user-2", "Consultor Atual"]]),
  };
}

function row(overrides = {}) {
  return {
    id: "audit-1",
    entity_type: "lead",
    entity_id: "lead-1",
    action: "kanban_card_moved",
    actor_id: "user-1",
    actor_name: "SDR",
    summary: "Movimentou lead",
    created_at: "2026-09-14T12:00:00.000Z",
    changes_json: JSON.stringify({
      fromPipelineId: "pipe-1",
      fromPipelineName: "Funil padrão antigo",
      fromStageId: "stage-open",
      fromStageName: "Entrada antiga",
      fromStageType: "open",
      toPipelineId: "pipe-1",
      toPipelineName: "Funil padrão antigo",
      toStageId: "stage-won",
      toStageName: "Ganho antigo",
      toStageType: "won",
      status: { from: "Em negociação", to: "Fechado" },
      responsibleUserId: "user-2",
      responsibleName: "Consultor Atual",
    }),
    ...overrides,
  };
}

test("usa os nomes atuais do banco ao exibir origem e destino", () => {
  const events = expandCommercialAuditRow(row(), context());
  const movement = events.find((event) => event.eventType === "movement");
  assert.ok(movement);
  assert.equal(movement.fromPipelineName, "Funil Comercial Atual");
  assert.equal(movement.fromStageName, "Reunião Agendada Atual");
  assert.equal(movement.toPipelineName, "Funil Comercial Atual");
  assert.equal(movement.toStageName, "Contrato Fechado Atual");
});

test("movimento para etapa won gera movimentação e contrato fechado", () => {
  const events = expandCommercialAuditRow(row(), context());
  assert.deepEqual(events.map((event) => event.eventType), ["movement", "contract_closed"]);
});

test("reordenação dentro da mesma etapa não entra como movimentação comercial", () => {
  const events = expandCommercialAuditRow(row({ action: "kanban_card_reordered" }), context());
  assert.equal(events.length, 0);
});

test("lead atualizado com motivo Sem interesse gera evento comercial", () => {
  const events = expandCommercialAuditRow(row({
    action: "lead_updated",
    changes_json: JSON.stringify({
      lostReason: { from: "Preço", to: "Sem interesse" },
      status: { from: "Em negociação", to: "Perdido" },
      pipelineId: { from: "pipe-1", to: "pipe-1" },
      pipelineStageId: { from: "stage-open", to: "stage-lost" },
    }),
  }), context());
  assert.ok(events.some((event) => event.eventType === "no_interest"));
  assert.ok(events.some((event) => event.eventType === "movement"));
});


test("analytics agrupa destinos pelos nomes atuais e conta leads unicos sem inflar retornos", () => {
  const ctx = context();
  const first = expandCommercialAuditRow(row({ id: "audit-1", entity_id: "lead-1" }), ctx).find((event) => event.eventType === "movement");
  const repeated = { ...first, id: "audit-2:movement", sourceAuditId: "audit-2", occurredAt: "2026-09-14T13:00:00.000Z" };
  const analytics = buildCommercialAuditAnalytics([first, repeated]);
  assert.equal(analytics.byStage.length, 1);
  assert.equal(analytics.byStage[0].stageName, "Contrato Fechado Atual");
  assert.equal(analytics.byStage[0].pipelineName, "Funil Comercial Atual");
  assert.equal(analytics.byStage[0].movements, 2);
  assert.equal(analytics.byStage[0].uniqueLeads, 1);
  assert.equal(analytics.transitions[0].fromStageName, "Reunião Agendada Atual");
  assert.equal(analytics.transitions[0].toStageName, "Contrato Fechado Atual");
});

test("analytics gera serie diaria de entradas, movimentos, contratos e sem interesse", () => {
  const events = [
    { eventType: "lead_created", occurredAt: "2026-09-13T10:00:00.000Z" },
    { eventType: "movement", occurredAt: "2026-09-13T11:00:00.000Z", leadId: "lead-1", toStageName: "Contato", toPipelineName: "Comercial" },
    { eventType: "contract_closed", occurredAt: "2026-09-14T12:00:00.000Z" },
    { eventType: "no_interest", occurredAt: "2026-09-14T13:00:00.000Z" },
  ];
  const analytics = buildCommercialAuditAnalytics(events);
  assert.deepEqual(analytics.daily, [
    { date: "2026-09-13", leadCreated: 1, movements: 1, contractsClosed: 0, noInterest: 0 },
    { date: "2026-09-14", leadCreated: 0, movements: 0, contractsClosed: 1, noInterest: 1 },
  ]);
});
