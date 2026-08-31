import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVICE_OPTIONS,
  buildAdminLeadCommercialOverviewSql,
  buildAdminLeadCoreOverviewSql,
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
  assert.match(buildOpportunityQuickFilterSql("migration", "l", { useMaterialized: false }), /Outra agência/);
  assert.match(buildOpportunityQuickFilterSql("diagnosis", "l", { useMaterialized: false }), /Não é feito/);
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

test("SQL legado continua disponível durante o backfill sem aproximar migração por texto", () => {
  const sql = buildOpportunitySummarySql({ where: "l.deleted_at = '' AND l.responsible_user_id = ?", alias: "l", useMaterialized: false });
  assert.match(sql, /JSON_EXTRACT\(l\.service_status_map/);
  assert.match(sql, /ELSE 'Não sabemos' END/);
  assert.match(sql, /opportunity_migration/);
  assert.match(sql, /opportunity_expansion/);
  assert.doesNotMatch(sql, /LIKE '%outra ag%'/i);
  assert.match(sql, /l\.responsible_user_id = \?/);
});

test("consultas materializadas eliminam JSON_EXTRACT quando o backfill está pronto", () => {
  const summarySql = buildOpportunitySummarySql({ where: "l.deleted_at = ''", alias: "l" });
  assert.match(summarySql, /l\.opportunity_score/);
  assert.match(summarySql, /l\.service_casa_count/);
  assert.doesNotMatch(summarySql, /JSON_EXTRACT/);
});

test("overview administrativo calcula qualidade sobre consulta global autorizada", () => {
  const sql = buildAdminLeadOverviewSql({ where: "l.deleted_at = '' AND l.responsible_user_id = ?", alias: "l" });
  assert.match(sql, /overview_with_owner/);
  assert.match(sql, /overview_without_diagnosis/);
  assert.match(sql, /overview_mapping_critical/);
  assert.match(sql, /l\.responsible_user_id = \?/);
});


test("overview administrativo separa núcleo leve das métricas comerciais", () => {
  const coreSql = buildAdminLeadCoreOverviewSql({ where: "l.deleted_at = ''", alias: "l" });
  const commercialSql = buildAdminLeadCommercialOverviewSql({ where: "l.deleted_at = ''", alias: "l", useMaterialized: true });

  assert.match(coreSql, /overview_total/);
  assert.match(coreSql, /overview_with_owner/);
  assert.doesNotMatch(coreSql, /overview_without_diagnosis/);
  assert.doesNotMatch(coreSql, /JSON_EXTRACT/);

  assert.match(commercialSql, /overview_without_diagnosis/);
  assert.match(commercialSql, /overview_mapping_critical/);
  assert.match(commercialSql, /commercial_potential_score|mapping_urgency_score|service_casa_count/);
  assert.doesNotMatch(commercialSql, /JSON_EXTRACT/);
});
