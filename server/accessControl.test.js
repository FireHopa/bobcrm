import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadAccessSql,
  describeLeadScope,
  enforceLeadAssignmentForUser,
  getDefaultLeadAccessScopeForRole,
  getEffectiveLeadAccessScope,
  leadMatchesAccessScope,
  normalizeLeadSort,
} from "./accessControl.js";

const seller = { id: "u1", name: "Ana Souza", email: "ana@example.com", role: "consultor_vendas", leadAccessScope: "own" };
const colleague = { id: "u2", name: "Bruno Lima", email: "bruno@example.com", role: "consultor_vendas", leadAccessScope: "own" };

test("consultores recebem escopo próprio e pré-venda recebe base completa", () => {
  assert.equal(getDefaultLeadAccessScopeForRole("consultor_vendas"), "own");
  assert.equal(getDefaultLeadAccessScopeForRole("pre_venda"), "all");
});

test("escopo próprio aceita responsável por id ou compatibilidade legada por nome", () => {
  assert.equal(leadMatchesAccessScope({ responsibleUserId: "u1" }, seller), true);
  assert.equal(leadMatchesAccessScope({ responsible: "  ANA SOUZA " }, seller), true);
  assert.equal(leadMatchesAccessScope({ responsibleUserId: "u2" }, seller), false);
  assert.equal(leadMatchesAccessScope({ responsible: "" }, seller), false);
});

test("pré-venda tem base completa e consultor não consegue ampliar o próprio escopo", () => {
  const preSales = { id: "m1", name: "Pré-venda", email: "pre@example.com", role: "pre_venda", leadAccessScope: "team" };
  assert.equal(leadMatchesAccessScope({ responsibleUserId: "u9" }, preSales, [seller, colleague]), true);
  assert.equal(getEffectiveLeadAccessScope({ ...seller, leadAccessScope: "all" }), "own");
  assert.equal(leadMatchesAccessScope({ responsibleUserId: "u2" }, { ...seller, leadAccessScope: "all" }), false);
});

test("atribuição própria força carteira do vendedor e bloqueia outro responsável", () => {
  assert.deepEqual(
    enforceLeadAssignmentForUser({ name: "Lead" }, seller),
    { name: "Lead", responsibleUserId: "u1", responsible: "Ana Souza" },
  );
  assert.throws(
    () => enforceLeadAssignmentForUser({ name: "Lead", responsibleUserId: "u2", responsible: "Bruno Lima" }, seller),
    /própria carteira/i,
  );
});

test("SQL da carteira própria usa somente responsible_user_id indexável", () => {
  const result = buildLeadAccessSql(seller, [], "l");
  assert.equal(result.clause, "l.responsible_user_id = ?");
  assert.deepEqual(result.params, ["u1"]);
  assert.doesNotMatch(result.clause, /TRIM|LOWER|COALESCE|\sOR\s/i);
});

test("metadado de escopo é explícito", () => {
  assert.equal(describeLeadScope(seller).label, "Minha carteira");
  assert.equal(describeLeadScope({ ...seller, leadAccessScope: "all" }).label, "Minha carteira");
});


test("vendedor não acessa lead atribuído a outro vendedor", () => {
  const seller = { id: "u1", name: "Ana", email: "ana@empresa.com", role: "consultor_vendas", leadAccessScope: "own" };
  const otherLead = { responsibleUserId: "u2", responsible: "Bruno" };
  assert.equal(leadMatchesAccessScope(otherLead, seller), false);
});

test("ordenação aceita somente colunas e direções permitidas", () => {
  assert.deepEqual(normalizeLeadSort("company", "asc"), { key: "company", column: "company", direction: "ASC" });
  assert.deepEqual(normalizeLeadSort("DROP TABLE leads", "sideways"), { key: "updatedAt", column: "updated_at", direction: "DESC" });
});
