import test from "node:test";
import assert from "node:assert/strict";
import {
  USER_ROLES,
  assertKanbanMoveAllowed,
  assertLeadFieldUpdateAllowed,
  getFixedLeadAccessScopeForRole,
  getPermissionsForRole,
  normalizeUserRole,
  isCanonicalUserRole,
} from "./rolePolicy.js";

test("papéis legados são normalizados para os três papéis oficiais", () => {
  assert.equal(normalizeUserRole("admin"), USER_ROLES.ADMIN);
  assert.equal(normalizeUserRole("gerente"), USER_ROLES.PRE_SALES);
  assert.equal(normalizeUserRole("vendedor"), USER_ROLES.SALES_CONSULTANT);
});

test("consultor sempre recebe carteira própria e pré-venda recebe base completa", () => {
  assert.equal(getFixedLeadAccessScopeForRole("consultor_vendas"), "own");
  assert.equal(getFixedLeadAccessScopeForRole("pre_venda"), "all");
});

test("pré-venda pode criar, atribuir e mover entre funis sem administrar estrutura", () => {
  const permissions = getPermissionsForRole("pre_venda");
  assert.equal(permissions.has("create_leads"), true);
  assert.equal(permissions.has("assign_leads"), true);
  assert.equal(permissions.has("move_lead_pipeline"), true);
  assert.equal(permissions.has("manage_pipelines"), false);
  assert.equal(permissions.has("manage_all_tasks"), true);
  assert.equal(permissions.has("assign_tasks"), true);
});

test("consultor altera dados principais e campos comerciais autorizados", () => {
  const user = { role: "consultor_vendas" };
  const permissions = getPermissionsForRole("consultor_vendas");
  assert.equal(permissions.has("manage_own_tasks"), true);
  assert.equal(permissions.has("assign_tasks"), false);
  assert.doesNotThrow(() => assertLeadFieldUpdateAllowed(user, [
    "name", "email", "phone", "company", "website", "instagram", "temperature", "expectedCloseAt",
  ]));
  assert.throws(() => assertLeadFieldUpdateAllowed(user, ["responsibleUserId"]), /só podem alterar/i);
  assert.throws(() => assertLeadFieldUpdateAllowed(user, ["status"]), /só podem alterar/i);
  assert.throws(() => assertLeadFieldUpdateAllowed(user, ["source"]), /só podem alterar/i);
});

test("consultor só movimenta etapas dentro do funil atual", () => {
  const user = { role: "consultor_vendas" };
  const lead = { pipelineId: "pipeline-vendas" };
  assert.doesNotThrow(() => assertKanbanMoveAllowed(user, lead, "pipeline-vendas"));
  assert.throws(() => assertKanbanMoveAllowed(user, lead, "pipeline-eventos"), /funil atual/i);
});


test("somente os três papéis oficiais são aceitos em cadastros novos", () => {
  assert.equal(isCanonicalUserRole("admin"), true);
  assert.equal(isCanonicalUserRole("pre_venda"), true);
  assert.equal(isCanonicalUserRole("consultor_vendas"), true);
  assert.equal(isCanonicalUserRole("gerente"), false);
  assert.equal(isCanonicalUserRole("vendedor"), false);
  assert.equal(isCanonicalUserRole("outro"), false);
});
