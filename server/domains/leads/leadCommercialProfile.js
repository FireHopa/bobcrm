export const COMMERCIAL_PROFILE_VERSION = 1;

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

export const COMMERCIAL_PROFILE_DB_FIELDS = Object.freeze([
  "commercial_profile_version",
  "commercial_profile_updated_at",
  "commercial_potential_score",
  "mapping_urgency_score",
  "lead_priority_score",
  "opportunity_score",
  "service_casa_count",
  "service_agency_count",
  "service_missing_count",
  "service_unknown_count",
  "has_expansion_opportunity",
  "has_migration_opportunity",
  "has_external_agency",
]);

export const COMMERCIAL_PROFILE_SOURCE_FIELDS = Object.freeze([
  "id",
  "website",
  "advertises_on_meta",
  "advertises_on_google",
  "estimated_budget",
  "responsible",
  "responsible_user_id",
  "temperature",
  "pain",
  "source",
  "next_contact_at",
  "service_status_map",
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

/**
 * Fonte única da verdade para a inteligência comercial persistida.
 * Toda escrita/backfill deve passar por esta função antes de atualizar as colunas materializadas.
 */
export function calculateLeadCommercialProfile(lead = {}) {
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
  if (!String(lead.responsible || "").trim() && !String(lead.responsibleUserId || "").trim()) mappingUrgency += 15;
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
    version: COMMERCIAL_PROFILE_VERSION,
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

export function commercialProfileToDbParams(profile, updatedAt) {
  return [
    Number(profile.version || COMMERCIAL_PROFILE_VERSION),
    String(updatedAt || new Date().toISOString()),
    Number(profile.commercialPotential || 0),
    Number(profile.mappingUrgency || 0),
    Number(profile.leadPriority || 0),
    Number(profile.opportunityScore || 0),
    Number(profile.counts?.["Casa do Ads"] || 0),
    Number(profile.counts?.["Outra agência"] || 0),
    Number(profile.counts?.["Não é feito"] || 0),
    Number(profile.counts?.["Não sabemos"] || 0),
    profile.expansion ? 1 : 0,
    profile.migration ? 1 : 0,
    profile.agency ? 1 : 0,
  ];
}

export function rowToCommercialProfileLead(row = {}) {
  let serviceStatusMap = row.service_status_map || {};
  if (typeof serviceStatusMap !== "object") {
    try {
      serviceStatusMap = serviceStatusMap ? JSON.parse(serviceStatusMap) : {};
    } catch {
      serviceStatusMap = {};
    }
  }

  return {
    website: String(row.website || ""),
    advertisesOnMeta: Boolean(Number(row.advertises_on_meta || 0)),
    advertisesOnGoogle: Boolean(Number(row.advertises_on_google || 0)),
    estimatedBudget: String(row.estimated_budget || ""),
    responsible: String(row.responsible || ""),
    responsibleUserId: String(row.responsible_user_id || ""),
    temperature: String(row.temperature || ""),
    pain: String(row.pain || ""),
    source: String(row.source || ""),
    nextContactAt: String(row.next_contact_at || ""),
    serviceStatusMap,
  };
}
