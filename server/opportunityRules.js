export const SERVICE_OPTIONS = Object.freeze([
  "Criação de Website",
  "Mentorias em Google Ads",
  "Mentorias em Meta Ads",
  "Mentorias em LinkedIn Ads",
  "Mentorias em Canva",
  "Mentorias em CapCut",
  "Mentorias AEO",
  "Gerenciamento Google",
  "Gerenciamento Meta",
  "Gerenciamento LinkedIn Ads",
  "Social Media",
  "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site",
]);

export const CORE_MAPPING_SERVICES = Object.freeze([
  "Gerenciamento Google",
  "Gerenciamento Meta",
  "Criação de Website",
  "Mentorias AEO",
]);

export const PAID_TRAFFIC_SERVICES = Object.freeze([
  "Gerenciamento Google",
  "Mentorias em Google Ads",
  "Gerenciamento Meta",
  "Mentorias em Meta Ads",
  "Gerenciamento LinkedIn Ads",
  "Mentorias em LinkedIn Ads",
]);

export const SERVICE_PROVIDER_STATUSES = Object.freeze([
  "Casa do Ads",
  "Outra agência",
  "Não é feito",
  "Não sabemos",
]);

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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function meaningfulBudget(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return Boolean(digits && Number(digits) > 0);
}

function normalizeStatus(value) {
  return SERVICE_PROVIDER_STATUSES.includes(value) ? value : "Não sabemos";
}

export function getServiceCounts(lead = {}) {
  const map = lead.serviceStatusMap && typeof lead.serviceStatusMap === "object" ? lead.serviceStatusMap : {};
  const counts = {
    "Casa do Ads": 0,
    "Outra agência": 0,
    "Não é feito": 0,
    "Não sabemos": 0,
  };

  for (const service of SERVICE_OPTIONS) counts[normalizeStatus(map[service])] += 1;
  return counts;
}

export function getCommercialScores(lead = {}) {
  const counts = getServiceCounts(lead);
  const casa = counts["Casa do Ads"];
  const agency = counts["Outra agência"];
  const notDone = counts["Não é feito"];
  const unknown = counts["Não sabemos"];
  const map = lead.serviceStatusMap && typeof lead.serviceStatusMap === "object" ? lead.serviceStatusMap : {};

  let commercialPotential = 0;
  if (lead.temperature === "Quente") commercialPotential += 22;
  else if (lead.temperature === "Morno") commercialPotential += 12;
  if (meaningfulBudget(lead.estimatedBudget)) commercialPotential += 16;
  if (String(lead.pain || "").trim()) commercialPotential += 12;
  if (String(lead.website || "").trim()) commercialPotential += 8;
  commercialPotential += Math.min(25, agency * 8);
  commercialPotential += Math.min(20, notDone * 5);
  if (casa > 0) commercialPotential += 10;

  const hasPaidTraffic = Boolean(lead.advertisesOnGoogle || lead.advertisesOnMeta || PAID_TRAFFIC_SERVICES.some((service) => {
    const status = normalizeStatus(map[service]);
    return status === "Casa do Ads" || status === "Outra agência";
  }));
  if (hasPaidTraffic) commercialPotential += 10;

  let mappingUrgency = 0;
  if (!String(lead.responsible || "").trim()) mappingUrgency += 15;
  if (!String(lead.source || "").trim()) mappingUrgency += 8;
  if (!String(lead.temperature || "").trim()) mappingUrgency += 10;
  if (!String(lead.pain || "").trim()) mappingUrgency += 10;
  if (!String(lead.nextContactAt || "").trim()) mappingUrgency += 15;
  if (!String(lead.website || "").trim()) mappingUrgency += 8;

  const coreUnknown = CORE_MAPPING_SERVICES.filter((service) => normalizeStatus(map[service]) === "Não sabemos").length;
  mappingUrgency += Math.min(28, coreUnknown * 7);
  mappingUrgency += Math.min(20, unknown * 2);
  const withoutDiagnosis = casa + agency + notDone === 0;
  if (withoutDiagnosis) mappingUrgency += 15;

  const normalizedCommercialPotential = clampScore(commercialPotential);
  const normalizedMappingUrgency = clampScore(mappingUrgency);
  const leadPriority = clampScore(normalizedCommercialPotential * 0.65 + normalizedMappingUrgency * 0.35);
  const opportunityScore = Math.min(100, Math.round(leadPriority * 0.45 + agency * 10 + notDone * 8 + unknown * 4 + casa * 2));
  const expansion = casa > 0 && (agency > 0 || notDone > 0 || unknown > 0);

  return {
    counts,
    commercialPotential: normalizedCommercialPotential,
    mappingUrgency: normalizedMappingUrgency,
    leadPriority,
    opportunityScore,
    expansion,
    migration: agency > 0 && !expansion,
    mapping: unknown > 0,
    agency: agency > 0,
    withoutDiagnosis,
    mappingCritical: normalizedMappingUrgency >= 70,
    leadMapping: normalizedMappingUrgency >= 55,
    leadExpansion: casa > 0 && notDone + unknown > 0,
  };
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

export function buildOpportunityQuickFilterSql(quickFilter, alias = "") {
  const filter = normalizeOpportunityFilter(quickFilter);
  if (!filter) return "";
  const expressions = buildOpportunitySqlExpressions(alias);
  if (filter === "lead-priority") return `((${expressions.leadPriority}) >= 70)`;
  if (filter === "priority") return `((${expressions.opportunityScore}) >= 70)`;
  if (filter === "diagnosis") return expressions.withoutDiagnosis;
  return expressions[filter.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] || "";
}

export function buildOpportunitySummarySql({ where = "1 = 1", alias = "l" } = {}) {
  const expressions = buildOpportunitySqlExpressions(alias);
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

export function buildAdminLeadOverviewSql({ where = "1 = 1", alias = "l" } = {}) {
  const expressions = buildOpportunitySqlExpressions(alias);
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

export function mapAdminLeadOverviewRow(row = {}) {
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
    withoutConfirmedDiagnosis: Number(row.overview_without_diagnosis || 0),
    highMappingUrgency: Number(row.overview_mapping_critical || 0),
  };
}
