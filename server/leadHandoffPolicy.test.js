import test from "node:test";
import assert from "node:assert/strict";
import { assertLeadHandoffAllowed, assertLeadHandoffPayload } from "./leadHandoffPolicy.js";

test("somente admin e pré-venda podem encaminhar leads", () => {
  assert.doesNotThrow(() => assertLeadHandoffAllowed({ role: "admin" }));
  assert.doesNotThrow(() => assertLeadHandoffAllowed({ role: "pre_venda" }));
  assert.throws(() => assertLeadHandoffAllowed({ role: "consultor_vendas" }), /Somente administrador ou pré-venda/);
});

test("encaminhamento exige consultor, funil, etapa e primeira tarefa", () => {
  assert.throws(() => assertLeadHandoffPayload({}), /consultor responsável/);
  assert.throws(() => assertLeadHandoffPayload({ consultantUserId: "u1" }), /funil de destino/);
  assert.throws(() => assertLeadHandoffPayload({ consultantUserId: "u1", pipelineId: "p1" }), /etapa inicial/);
  assert.throws(() => assertLeadHandoffPayload({ consultantUserId: "u1", pipelineId: "p1", stageId: "s1", requestId: "request-123456", task: {} }), /título de tarefa/);

  const result = assertLeadHandoffPayload({
    consultantUserId: "u1",
    pipelineId: "p1",
    stageId: "s1",
    requestId: "request-123456",
    task: {
      title: "Realizar primeiro contato",
      dueAt: "2026-07-08T10:00",
      type: "ligacao",
      priority: "alta",
    },
  });

  assert.equal(result.consultantUserId, "u1");
  assert.equal(result.pipelineId, "p1");
  assert.equal(result.stageId, "s1");
  assert.equal(result.task.title, "Realizar primeiro contato");
});
