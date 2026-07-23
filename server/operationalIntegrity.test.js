import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAssignmentUsesHandoff,
  assertConsultantCanBeDeactivated,
  assertHandoffTargetStage,
  buildHandoffTaskSourceKey,
  isClosedLead,
} from "./operationalIntegrity.js";

test("atribuição manual exige o fluxo de encaminhamento", () => {
  assert.throws(() => assertAssignmentUsesHandoff({ isNew: true, lead: { responsibleUserId: "u1" } }), /Encaminhar para consultor/);
  assert.throws(() => assertAssignmentUsesHandoff({ changedFields: ["responsibleUserId"] }), /Encaminhar para consultor/);
  assert.doesNotThrow(() => assertAssignmentUsesHandoff({ changedFields: ["email"] }));
});

test("encaminhamento aceita somente etapas abertas", () => {
  assert.doesNotThrow(() => assertHandoffTargetStage({ stage_type: "open", status_key: "Em contato" }));
  assert.throws(() => assertHandoffTargetStage({ stage_type: "won" }), /etapa aberta/i);
  assert.throws(() => assertHandoffTargetStage({ stage_type: "open", status_key: "Perdido" }), /etapa aberta/i);
});

test("chave idempotente de encaminhamento é estável", () => {
  assert.equal(buildHandoffTaskSourceKey("lead-1", "request-123456"), "lead-handoff:lead-1:request-123456");
});

test("lead fechado ou excluído é reconhecido", () => {
  assert.equal(isClosedLead({ status: "Fechado" }), true);
  assert.equal(isClosedLead({ deletedAt: "2026-07-07" }), true);
  assert.equal(isClosedLead({ status: "Em contato" }), false);
});

test("consultor com carteira ou tarefas não pode ser desativado", () => {
  assert.throws(() => assertConsultantCanBeDeactivated({ existingRole: "consultor_vendas", nextRole: "consultor_vendas", nextIsActive: false, activeLeadCount: 2 }), /Redistribua/);
  assert.doesNotThrow(() => assertConsultantCanBeDeactivated({ existingRole: "consultor_vendas", nextRole: "consultor_vendas", nextIsActive: false }));
});
