import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVICE_OPTIONS,
  buildAdminLeadOverviewSql,
  buildOpportunityQuickFilterSql,
  buildOpportunitySummarySql,
  getCommercialScores,
  matchesOpportunityFilter,
  normalizeOpportunityFilter,
} from "./opportunityRules.js";

function leadWithStatuses(statuses = {}, overrides = {}) {
  return {
    responsible: "",
    responsibleUserId: "",
    source: "",
    temperature: "",
    pain: "",
    nextContactAt: "",
    website: "",
    estimatedBudget: "",
    advertisesOnGoogle: false,
    advertisesOnMeta: false,
    serviceStatusMap: statuses,
    ...overrides,
  };
}

test("classificação comercial preserva precedência de expansão sobre migração", () => {
  const expansion = getCommercialScores(leadWithStatuses({
    [SERVICE_OPTIONS[0]]: "Casa do Ads",
    [SERVICE_OPTIONS[1]]: "Outra agência",
  }));
  const migration = getCommercialScores(leadWithStatuses({
    [SERVICE_OPTIONS[0]]: "Outra agência",
    ...Object.fromEntries(SERVICE_OPTIONS.slice(1).map((service) => [service, "Não é feito"])),
  }));

  assert.equal(expansion.expansion, true);
  assert.equal(expansion.migration, false);
  assert.equal(migration.expansion, false);
  assert.equal(migration.migration, true);
});

test("status ausente ou inválido é tratado como não sabemos", () => {
  const metrics = getCommercialScores(leadWithStatuses({
    [SERVICE_OPTIONS[0]]: "valor legado inválido",
    [SERVICE_OPTIONS[1]]: "Casa do Ads",
  }));

  assert.equal(metrics.counts["Casa do Ads"], 1);
  assert.equal(metrics.counts["Não sabemos"], SERVICE_OPTIONS.length - 1);
});

test("filtros de mapa distinguem migração, outra agência, diagnóstico e mapeamento crítico", () => {
  const lead = leadWithStatuses({ [SERVICE_OPTIONS[0]]: "Outra agência" });
  assert.equal(matchesOpportunityFilter(lead, "agency"), true);
  assert.equal(matchesOpportunityFilter(lead, "migration"), true);
  assert.equal(matchesOpportunityFilter(lead, "mapping"), true);
  assert.equal(matchesOpportunityFilter(lead, "diagnosis"), false);
  assert.equal(matchesOpportunityFilter(lead, "mapping-critical"), true);
});

test("filtro inválido não é interpolado no SQL", () => {
  assert.equal(normalizeOpportunityFilter("anything' OR 1=1"), "");
  assert.equal(buildOpportunityQuickFilterSql("anything' OR 1=1", "l"), "");
  assert.match(buildOpportunityQuickFilterSql("migration", "l"), /Outra agência/);
  assert.match(buildOpportunityQuickFilterSql("diagnosis", "l"), /Não é feito/);
});

test("todos os filtros comerciais suportados geram cláusula SQL", () => {
  for (const filter of [
    "expansion",
    "migration",
    "mapping",
    "priority",
    "agency",
    "diagnosis",
    "mapping-critical",
    "lead-priority",
    "lead-mapping",
    "lead-expansion",
  ]) {
    assert.ok(buildOpportunityQuickFilterSql(filter, "l").length > 0, `Filtro sem SQL: ${filter}`);
  }
});

test("SQL global usa JSON_EXTRACT por serviço e não aproxima migração por texto", () => {
  const sql = buildOpportunitySummarySql({ where: "l.deleted_at = '' AND l.responsible_user_id = ?", alias: "l" });
  assert.match(sql, /JSON_EXTRACT\(l\.service_status_map/);
  assert.match(sql, /ELSE 'Não sabemos' END/);
  assert.match(sql, /opportunity_migration/);
  assert.match(sql, /opportunity_expansion/);
  assert.doesNotMatch(sql, /LIKE '%outra ag%'/i);
  assert.match(sql, /l\.responsible_user_id = \?/);
});

test("overview administrativo calcula qualidade sobre consulta global autorizada", () => {
  const sql = buildAdminLeadOverviewSql({ where: "l.deleted_at = '' AND l.responsible_user_id = ?", alias: "l" });
  assert.match(sql, /overview_with_owner/);
  assert.match(sql, /overview_without_diagnosis/);
  assert.match(sql, /overview_mapping_critical/);
  assert.match(sql, /l\.responsible_user_id = \?/);
});
