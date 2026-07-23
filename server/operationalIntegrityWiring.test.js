import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backend = await readFile(new URL("./index.js", import.meta.url), "utf8");
const schema = await readFile(new URL("./schema.mysql.sql", import.meta.url), "utf8");
const handoffDialog = await readFile(new URL("../src/components/LeadHandoffDialog.tsx", import.meta.url), "utf8");
const leadForm = await readFile(new URL("../src/components/LeadForm.tsx", import.meta.url), "utf8");
const importLeads = await readFile(new URL("../src/components/ImportLeads.tsx", import.meta.url), "utf8");
const importModel = await readFile(new URL("../src/features/import/importModel.ts", import.meta.url), "utf8");

test("encaminhamento usa idempotência, cancela tarefas antigas e rejeita etapa final", () => {
  assert.match(backend, /buildHandoffTaskSourceKey\(leadId, handoff\.requestId\)/);
  assert.match(backend, /existingHandoffTask/);
  assert.match(backend, /cancelPendingTasksForLead\([\s\S]*lead foi encaminhado/);
  assert.doesNotMatch(backend, /previousResponsibleUserId: before\.responsibleUserId/);
  assert.match(backend, /assertHandoffTargetStage\(stage\)/);
  assert.match(handoffDialog, /crypto\.randomUUID\(\)/);
  assert.match(handoffDialog, /stage\.stageType === "open"/);
});

test("cadastro e edição comuns não atribuem consultor", () => {
  assert.match(backend, /assertAssignmentUsesHandoff\(\{ isNew: !before/);
  assert.match(backend, /assertAssignmentUsesHandoff\(\{ changedFields, lead \}\)/);
  assert.doesNotMatch(leadForm, /<span>Responsável<\/span>[\s\S]{0,300}<select/);
  assert.match(leadForm, /use “Encaminhar para consultor”/);
});

test("mesclagem transfere tarefas, notas, origens e integrações", () => {
  assert.match(backend, /UPDATE tasks SET lead_id = \?/);
  assert.match(backend, /UPDATE lead_notes SET lead_id = \?/);
  assert.match(backend, /INSERT INTO lead_external_origins/);
  assert.match(backend, /UPDATE integration_events SET lead_id = \?/);
  assert.match(backend, /merged_into_lead_id = \?/);
  assert.match(backend, /refreshLeadNextContactFromTasks\(primaryLeadId, client\)/);
  assert.match(schema, /merged_into_lead_id VARCHAR\(64\)/);
});

test("lixeira, encerramento e exclusão definitiva reconciliam tarefas", () => {
  assert.match(backend, /Tarefa cancelada porque o lead foi enviado para a lixeira/);
  assert.match(backend, /reconcileLeadTasksForLifecycle\(result, currentUser, client\)/);
  assert.match(backend, /DELETE FROM tasks WHERE lead_id = \?/);
  assert.match(backend, /DELETE FROM lead_notes WHERE lead_id = \?/);
  assert.match(backend, /DELETE FROM lead_external_origins WHERE lead_id = \?/);
  assert.match(backend, /SELECT id FROM leads WHERE merged_into_lead_id = \?/);
  assert.match(backend, /DELETE FROM leads WHERE merged_into_lead_id = \?/);
});

test("consultor não pode ser desativado com carteira ativa", () => {
  assert.match(backend, /assertConsultantOperationallyClear\(existing, role, Boolean\(isActive\), client\)/);
  assert.match(backend, /assertConsultantOperationallyClear\(userRow, userRow\.role, false, client\)/);
});


test("importação sempre entra sem consultor e reconcilia o ciclo de vida", () => {
  assert.match(backend, /const unassignedLeads = leads\.map/);
  assert.match(backend, /responsibleUserId: ""/);
  assert.match(backend, /await reconcileLeadTasksForLifecycle\(savedLead, currentUser, client\)/);
  assert.match(importLeads, /Importação sem responsável/);
  assert.match(importModel, /responsible: ""/);
  assert.doesNotMatch(importLeads, /Responsável padrão/);
});
