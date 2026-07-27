import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadSearchPlan, chooseLeadSearchPlan, LEAD_SEARCH_MODES } from "./leadSearchSql.js";

test("telefone usa prefixo indexável antes de contains", () => {
  const plan = buildLeadSearchPlan("+55 (11) 98888-7777");
  assert.equal(plan.mode, LEAD_SEARCH_MODES.PHONE_PREFIX);
  assert.match(plan.primary.clause, /phone_key LIKE \?/);
  assert.equal(plan.primary.params[0], "5511988887777%");
  assert.equal(plan.fallback.params[0], "%5511988887777%");
});

test("email usa prefixo indexável e fallback somente quando necessário", () => {
  const plan = buildLeadSearchPlan("cliente@exemplo.com", { alias: "l" });
  assert.equal(plan.mode, LEAD_SEARCH_MODES.EMAIL_PREFIX);
  assert.match(plan.primary.clause, /l\.email_key LIKE \?/);
  assert.equal(chooseLeadSearchPlan(plan, true).mode, LEAD_SEARCH_MODES.EMAIL_PREFIX);
  assert.equal(chooseLeadSearchPlan(plan, false).mode, LEAD_SEARCH_MODES.FALLBACK);
});

test("texto normal usa FULLTEXT como caminho principal", () => {
  const plan = buildLeadSearchPlan("Clínica São Paulo", { fullTextEnabled: true });
  assert.equal(plan.mode, LEAD_SEARCH_MODES.FULLTEXT);
  assert.match(plan.primary.clause, /MATCH\(search_text\) AGAINST/);
  assert.equal(plan.primary.params[0], "+clinica* +sao* +paulo*");
});

test("fallback amplo não converte JSON em CHAR", () => {
  const plan = buildLeadSearchPlan("ab", { fullTextEnabled: true });
  assert.equal(plan.mode, LEAD_SEARCH_MODES.FALLBACK);
  assert.match(plan.fallback.clause, /search_text LIKE/);
  assert.doesNotMatch(plan.fallback.clause, /CAST\(/i);
  assert.doesNotMatch(plan.fallback.clause, /custom_fields|service_status_map/);
});
