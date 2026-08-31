import {
  CORE_MAPPING_SERVICES,
  PAID_TRAFFIC_SERVICES,
  SERVICE_OPTIONS,
  SERVICE_PROVIDER_STATUSES,
  calculateLeadCommercialProfile,
  getServiceCounts,
} from "./domains/leads/leadCommercialProfile.js";

export {
  CORE_MAPPING_SERVICES,
  PAID_TRAFFIC_SERVICES,
  SERVICE_OPTIONS,
  SERVICE_PROVIDER_STATUSES,
  getServiceCounts,
};

const OPPORTUNITY_FILTERS = new Set([
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
]);

export function getCommercialScores(lead = {}) {
  return calculateLeadCommercialProfile(lead);
}

export function matchesOpportunityFilter(lead, quickFilter) {
  const filter = normalizeOpportunityFilter(quickFilter);
  if (!filter) return true;
  const metrics = getCommercialScores(lead);
  if (filter === "expansion") return metrics.expansion;
  if (filter === "migration") return metrics.migration;
  if (filter === "mapping") return metrics.mapping;
  if (filter === "priority") return metrics.opportunityScore >= 70;
  if (filter === "agency") return metrics.agency;
  if (filter === "diagnosis") return metrics.withoutDiagnosis;
  if (filter === "mapping-critical") return metrics.mappingCritical;
  if (filter === "lead-priority") return metrics.leadPriority >= 70;
  if (filter === "lead-mapping") return metrics.leadMapping;
  if (filter === "lead-expansion") return metrics.leadExpansion;
  return true;
}

export function normalizeOpportunityFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return OPPORTUNITY_FILTERS.has(normalized) ? normalized : "";
}

function column(alias, name) {
  return `${alias ? `${alias}.` : ""}${name}`;
}

function escapeJsonPathMember(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "''");
}

function buildRawServiceStatusSql(service, alias = "") {
  const mapColumn = column(alias, "service_status_map");
  const path = `$."${escapeJsonPathMember(service)}"`;
  return `JSON_UNQUOTE(JSON_EXTRACT(${mapColumn}, '${path}'))`;
}

export function buildServiceStatusSql(service, alias = "") {
  const extracted = buildRawServiceStatusSql(service, alias);
  return `CASE ${extracted}
    WHEN 'Casa do Ads' THEN 'Casa do Ads'
    WHEN 'Outra agência' THEN 'Outra agência'
    WHEN 'Não é feito' THEN 'Não é feito'
    WHEN 'Não sabemos' THEN 'Não sabemos'
    ELSE 'Não sabemos' END`;
}

export function buildServiceCountSql(status, alias = "", services = SERVICE_OPTIONS) {
  const safeStatus = String(status).replace(/'/g, "''");
  if (status === "Não sabemos") {
    return `(${services.map((service) => `CASE WHEN ${buildRawServiceStatusSql(service, alias)} IN ('Casa do Ads', 'Outra agência', 'Não é feito') THEN 0 ELSE 1 END`).join(" + ")})`;
  }
  return `(${services.map((service) => `CASE WHEN ${buildRawServiceStatusSql(service, alias)} = '${safeStatus}' THEN 1 ELSE 0 END`).join(" + ")})`;
}

export function buildOpportunitySqlExpressions(alias = "") {
  const casaCount = buildServiceCountSql("Casa do Ads", alias);
  const agencyCount = buildServiceCountSql("Outra agência", alias);
  const notDoneCount = buildServiceCountSql("Não é feito", alias);
  const unknownCount = buildServiceCountSql("Não sabemos", alias);
  const coreUnknownCount = buildServiceCountSql("Não sabemos", alias, CORE_MAPPING_SERVICES);
  const paidTrafficCount = `(${PAID_TRAFFIC_SERVICES.map((service) => `CASE WHEN ${buildServiceStatusSql(service, alias)} IN ('Casa do Ads', 'Outra agência') THEN 1 ELSE 0 END`).join(" + ")})`;

  const temperature = column(alias, "temperature");
  const estimatedBudget = column(alias, "estimated_budget");
  const pain = column(alias, "pain");
  const website = column(alias, "website");
  const responsible = column(alias, "responsible");
  const responsibleUserId = column(alias, "responsible_user_id");
  const source = column(alias, "source");
  const nextContactAt = column(alias, "next_contact_at");
  const advertisesGoogle = column(alias, "advertises_on_google");
  const advertisesMeta = column(alias, "advertises_on_meta");

  const withoutDiagnosis = `((${casaCount}) + (${agencyCount}) + (${notDoneCount}) = 0)`;
  const commercialPotentialRaw = `(
    CASE WHEN ${temperature} = 'Quente' THEN 22 WHEN ${temperature} = 'Morno' THEN 12 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${estimatedBudget}, '')) REGEXP '[1-9]' THEN 16 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${pain}, '')) != '' THEN 12 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${website}, '')) != '' THEN 8 ELSE 0 END
    + LEAST(25, (${agencyCount}) * 8)
    + LEAST(20, (${notDoneCount}) * 5)
    + CASE WHEN (${casaCount}) > 0 THEN 10 ELSE 0 END
    + CASE WHEN ${advertisesGoogle} = 1 OR ${advertisesMeta} = 1 OR (${paidTrafficCount}) > 0 THEN 10 ELSE 0 END
  )`;
  const commercialPotential = `LEAST(100, GREATEST(0, ROUND(${commercialPotentialRaw})))`;
  const mappingUrgencyRaw = `(
    CASE WHEN TRIM(COALESCE(${responsible}, '')) = '' AND TRIM(COALESCE(${responsibleUserId}, '')) = '' THEN 15 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${source}, '')) = '' THEN 8 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${temperature}, '')) = '' THEN 10 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${pain}, '')) = '' THEN 10 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${nextContactAt}, '')) = '' THEN 15 ELSE 0 END
    + CASE WHEN TRIM(COALESCE(${website}, '')) = '' THEN 8 ELSE 0 END
    + LEAST(28, (${coreUnknownCount}) * 7)
    + LEAST(20, (${unknownCount}) * 2)
    + CASE WHEN ${withoutDiagnosis} THEN 15 ELSE 0 END
  )`;
  const mappingUrgency = `LEAST(100, GREATEST(0, ROUND(${mappingUrgencyRaw})))`;
  const leadPriority = `LEAST(100, GREATEST(0, ROUND((${commercialPotential}) * 0.65 + (${mappingUrgency}) * 0.35)))`;
  const opportunityScore = `LEAST(100, ROUND((${leadPriority}) * 0.45 + (${agencyCount}) * 10 + (${notDoneCount}) * 8 + (${unknownCount}) * 4 + (${casaCount}) * 2))`;
  const expansion = `((${casaCount}) > 0 AND ((${agencyCount}) > 0 OR (${notDoneCount}) > 0 OR (${unknownCount}) > 0))`;
  const migration = `((${agencyCount}) > 0 AND NOT ${expansion})`;

  return {
    casaCount,
    agencyCount,
    notDoneCount,
    unknownCount,
    coreUnknownCount,
    paidTrafficCount,
    commercialPotential,
    mappingUrgency,
    leadPriority,
    opportunityScore,
    expansion,
    migration,
    mapping: `((${unknownCount}) > 0)`,
    agency: `((${agencyCount}) > 0)`,
    withoutDiagnosis,
    mappingCritical: `((${mappingUrgency}) >= 70)`,
    leadMapping: `((${mappingUrgency}) >= 55)`,
    leadExpansion: `((${casaCount}) > 0 AND ((${notDoneCount}) + (${unknownCount})) > 0)`,
  };
}

export function buildMaterializedOpportunitySqlExpressions(alias = "") {
  const casaCount = column(alias, "service_casa_count");
  const agencyCount = column(alias, "service_agency_count");
  const notDoneCount = column(alias, "service_missing_count");
  const unknownCount = column(alias, "service_unknown_count");
  const commercialPotential = column(alias, "commercial_potential_score");
  const mappingUrgency = column(alias, "mapping_urgency_score");
  const leadPriority = column(alias, "lead_priority_score");
  const opportunityScore = column(alias, "opportunity_score");
  const expansion = `(${column(alias, "has_expansion_opportunity")} = 1)`;
  const migration = `(${column(alias, "has_migration_opportunity")} = 1)`;
  const agency = `(${column(alias, "has_external_agency")} = 1)`;

  return {
    casaCount,
    agencyCount,
    notDoneCount,
    unknownCount,
    commercialPotential,
    mappingUrgency,
    leadPriority,
    opportunityScore,
    expansion,
    migration,
    mapping: `((${unknownCount}) > 0)`,
    agency,
    withoutDiagnosis: `((${casaCount}) + (${agencyCount}) + (${notDoneCount}) = 0)`,
    mappingCritical: `((${mappingUrgency}) >= 70)`,
    leadMapping: `((${mappingUrgency}) >= 55)`,
    leadExpansion: `((${casaCount}) > 0 AND ((${notDoneCount}) + (${unknownCount})) > 0)`,
  };
}

export function buildCommercialSqlExpressions(alias = "", { useMaterialized = true } = {}) {
  return useMaterialized ? buildMaterializedOpportunitySqlExpressions(alias) : buildOpportunitySqlExpressions(alias);
}

export function buildOpportunityQuickFilterSql(quickFilter, alias = "", { useMaterialized = true } = {}) {
  const filter = normalizeOpportunityFilter(quickFilter);
  if (!filter) return "";
  const expressions = buildCommercialSqlExpressions(alias, { useMaterialized });
  if (filter === "lead-priority") return `((${expressions.leadPriority}) >= 70)`;
  if (filter === "priority") return `((${expressions.opportunityScore}) >= 70)`;
  if (filter === "diagnosis") return expressions.withoutDiagnosis;
  return expressions[filter.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] || "";
}

export function buildOpportunitySummarySql({ where = "1 = 1", alias = "l", useMaterialized = true } = {}) {
  const expressions = buildCommercialSqlExpressions(alias, { useMaterialized });
  return `SELECT
      COUNT(*) AS opportunity_total,
      SUM(CASE WHEN ${expressions.expansion} THEN 1 ELSE 0 END) AS opportunity_expansion,
      SUM(CASE WHEN ${expressions.migration} THEN 1 ELSE 0 END) AS opportunity_migration,
      SUM(CASE WHEN ${expressions.mapping} THEN 1 ELSE 0 END) AS opportunity_mapping,
      SUM(CASE WHEN (${expressions.opportunityScore}) >= 70 THEN 1 ELSE 0 END) AS opportunity_priority,
      SUM(CASE WHEN ${expressions.agency} THEN 1 ELSE 0 END) AS opportunity_agency,
      SUM(CASE WHEN ${expressions.withoutDiagnosis} THEN 1 ELSE 0 END) AS opportunity_without_diagnosis,
      SUM(CASE WHEN ${expressions.mappingCritical} THEN 1 ELSE 0 END) AS opportunity_mapping_critical,
      SUM(${expressions.casaCount}) AS services_casa,
      SUM(${expressions.agencyCount}) AS services_agency,
      SUM(${expressions.notDoneCount}) AS services_not_done,
      SUM(${expressions.unknownCount}) AS services_unknown
    FROM leads ${alias}
    WHERE ${where}`;
}

export function mapOpportunitySummaryRow(row = {}) {
  return {
    total: Number(row.opportunity_total || 0),
    expansion: Number(row.opportunity_expansion || 0),
    migration: Number(row.opportunity_migration || 0),
    mapping: Number(row.opportunity_mapping || 0),
    priority: Number(row.opportunity_priority || 0),
    agency: Number(row.opportunity_agency || 0),
    withoutDiagnosis: Number(row.opportunity_without_diagnosis || 0),
    mappingCritical: Number(row.opportunity_mapping_critical || 0),
    serviceStatuses: {
      "Casa do Ads": Number(row.services_casa || 0),
      "Outra agência": Number(row.services_agency || 0),
      "Não é feito": Number(row.services_not_done || 0),
      "Não sabemos": Number(row.services_unknown || 0),
    },
  };
}

export function buildAdminLeadCoreOverviewSql({ where = "1 = 1", alias = "l" } = {}) {
  const responsible = column(alias, "responsible");
  const responsibleUserId = column(alias, "responsible_user_id");
  const temperature = column(alias, "temperature");
  const pain = column(alias, "pain");
  const nextContactAt = column(alias, "next_contact_at");
  const website = column(alias, "website");

  return `SELECT
      COUNT(*) AS overview_total,
      SUM(CASE WHEN TRIM(COALESCE(${responsible}, '')) != '' OR TRIM(COALESCE(${responsibleUserId}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_owner,
      SUM(CASE WHEN TRIM(COALESCE(${temperature}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_temperature,
      SUM(CASE WHEN TRIM(COALESCE(${pain}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_pain,
      SUM(CASE WHEN TRIM(COALESCE(${nextContactAt}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_next_contact,
      SUM(CASE WHEN TRIM(COALESCE(${website}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_website
    FROM leads ${alias}
    WHERE ${where}`;
}

export function buildAdminLeadCommercialOverviewSql({ where = "1 = 1", alias = "l", useMaterialized = true } = {}) {
  const expressions = buildCommercialSqlExpressions(alias, { useMaterialized });
  return `SELECT
      SUM(CASE WHEN ${expressions.withoutDiagnosis} THEN 1 ELSE 0 END) AS overview_without_diagnosis,
      SUM(CASE WHEN ${expressions.mappingCritical} THEN 1 ELSE 0 END) AS overview_mapping_critical
    FROM leads ${alias}
    WHERE ${where}`;
}

// Compatibilidade com consumidores e testes antigos. O endpoint administrativo novo
// executa o núcleo e as métricas comerciais separadamente para permitir degradação parcial.
export function buildAdminLeadOverviewSql({ where = "1 = 1", alias = "l", useMaterialized = true } = {}) {
  const expressions = buildCommercialSqlExpressions(alias, { useMaterialized });
  const responsible = column(alias, "responsible");
  const responsibleUserId = column(alias, "responsible_user_id");
  const temperature = column(alias, "temperature");
  const pain = column(alias, "pain");
  const nextContactAt = column(alias, "next_contact_at");
  const website = column(alias, "website");

  return `SELECT
      COUNT(*) AS overview_total,
      SUM(CASE WHEN TRIM(COALESCE(${responsible}, '')) != '' OR TRIM(COALESCE(${responsibleUserId}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_owner,
      SUM(CASE WHEN TRIM(COALESCE(${temperature}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_temperature,
      SUM(CASE WHEN TRIM(COALESCE(${pain}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_pain,
      SUM(CASE WHEN TRIM(COALESCE(${nextContactAt}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_next_contact,
      SUM(CASE WHEN TRIM(COALESCE(${website}, '')) != '' THEN 1 ELSE 0 END) AS overview_with_website,
      SUM(CASE WHEN ${expressions.withoutDiagnosis} THEN 1 ELSE 0 END) AS overview_without_diagnosis,
      SUM(CASE WHEN ${expressions.mappingCritical} THEN 1 ELSE 0 END) AS overview_mapping_critical
    FROM leads ${alias}
    WHERE ${where}`;
}

export function mapAdminLeadCoreOverviewRow(row = {}) {
  const total = Number(row.overview_total || 0);
  const withOwner = Number(row.overview_with_owner || 0);
  return {
    total,
    withOwner,
    withTemperature: Number(row.overview_with_temperature || 0),
    withPain: Number(row.overview_with_pain || 0),
    withNextContact: Number(row.overview_with_next_contact || 0),
    withWebsite: Number(row.overview_with_website || 0),
    withoutOwner: Math.max(0, total - withOwner),
  };
}

export function mapAdminLeadCommercialOverviewRow(row = {}) {
  return {
    withoutConfirmedDiagnosis: Number(row.overview_without_diagnosis || 0),
    highMappingUrgency: Number(row.overview_mapping_critical || 0),
  };
}

export function mapAdminLeadOverviewRow(row = {}) {
  return {
    ...mapAdminLeadCoreOverviewRow(row),
    ...mapAdminLeadCommercialOverviewRow(row),
  };
}
