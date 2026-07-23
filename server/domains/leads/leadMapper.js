import { randomUUID } from "node:crypto";

export const customFieldLabels = [
  "Datas Imersão",
  "Possui website?",
  "Indicado por",
];

const customFieldAliases = {
  "Possui website?": ["Já possui Website?"],
};

export function nowIso() {
  return new Date().toISOString();
}

export function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeDateToIso(value) {
  if (!value) return nowIso();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
}

export function normalizeEmailKey(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizePhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeNameCompanyKey(lead) {
  const name = normalizeSearchText(lead.name);
  const company = normalizeSearchText(lead.company);
  return name && company ? `${name}|${company}` : "";
}

function getFirstFilledCustomFieldValue(source, labels) {
  for (const label of labels) {
    const value = String(source[label] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function normalizeCustomFields(customFields = {}) {
  const normalized = {};
  const source = customFields && typeof customFields === "object" ? customFields : {};

  customFieldLabels.forEach((field) => {
    normalized[field] = getFirstFilledCustomFieldValue(source, [field, ...(customFieldAliases[field] || [])]);
  });

  return normalized;
}

export function normalizeBooleanText(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return ["sim", "s", "yes", "y", "true", "1", "ok", "ativo", "anuncia", "x"].includes(normalized);
}

export function normalizeLead(lead = {}) {
  const status = lead.status || (lead.isLost ? "Perdido" : "Novo lead");
  const serviceInterests = Array.isArray(lead.serviceInterests) ? lead.serviceInterests : [];
  const serviceStatusMap = lead.serviceStatusMap && typeof lead.serviceStatusMap === "object" ? lead.serviceStatusMap : {};
  const rawCustomFields = lead.customFields && typeof lead.customFields === "object" ? lead.customFields : {};
  const customFields = normalizeCustomFields(rawCustomFields);
  const legacyWebsite = String(rawCustomFields["Coloque seu site"] ?? "").trim();
  const legacyGoogleAds = String(rawCustomFields["Já anuncia no Google ADS? - 2"] ?? "").trim();
  const createdAt = normalizeDateToIso(lead.createdAt);

  return {
    id: lead.id || randomUUID(),
    name: String(lead.name || ""),
    email: String(lead.email || ""),
    phone: String(lead.phone || ""),
    company: String(lead.company || ""),
    website: String(lead.website || legacyWebsite || ""),
    advertisesOnMeta: Boolean(lead.advertisesOnMeta),
    advertisesOnGoogle: Boolean(lead.advertisesOnGoogle) || normalizeBooleanText(legacyGoogleAds),
    doesNotAdvertise: Boolean(lead.doesNotAdvertise),
    lastContactAt: String(lead.lastContactAt || ""),
    contactMadeAt: String(lead.contactMadeAt || ""),
    nextContactAt: String(lead.nextContactAt || ""),
    expectedCloseAt: String(lead.expectedCloseAt || lead.expected_close_at || ""),
    estimatedBudget: String(lead.estimatedBudget || ""),
    isLost: Boolean(lead.isLost || status === "Perdido"),
    lostReason: String(lead.lostReason || ""),
    commercialNotes: String(lead.commercialNotes || ""),
    status: String(status),
    responsible: String(lead.responsible || ""),
    responsibleUserId: String(lead.responsibleUserId || lead.responsible_user_id || ""),
    temperature: String(lead.temperature || ""),
    pain: String(lead.pain || ""),
    source: String(lead.source || ""),
    serviceInterests,
    serviceStatusMap,
    customFields,
    createdAt,
    updatedAt: normalizeDateToIso(lead.updatedAt || createdAt),
    deletedAt: String(lead.deletedAt || ""),
    deletedBy: String(lead.deletedBy || ""),
    restoredAt: String(lead.restoredAt || ""),
    restoredBy: String(lead.restoredBy || ""),
    pipelineId: String(lead.pipelineId || ""),
    pipelineStageId: String(lead.pipelineStageId || ""),
    kanbanPosition: Number(lead.kanbanPosition || 0),
    pipelineEnteredAt: String(lead.pipelineEnteredAt || ""),
  };
}

export function buildLeadSearchText(lead = {}) {
  const normalizedLead = normalizeLead(lead);
  const customFieldsText = Object.entries(normalizedLead.customFields || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const serviceStatusText = Object.entries(normalizedLead.serviceStatusMap || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");

  const rawText = [
    normalizedLead.name,
    normalizedLead.email,
    normalizedLead.phone,
    normalizePhoneKey(normalizedLead.phone),
    normalizedLead.company,
    normalizedLead.website,
    normalizedLead.source,
    normalizedLead.expectedCloseAt,
    normalizedLead.estimatedBudget,
    normalizedLead.status,
    normalizedLead.responsible,
    normalizedLead.responsibleUserId,
    normalizedLead.temperature,
    normalizedLead.pain,
    normalizedLead.lostReason,
    normalizedLead.commercialNotes,
    (normalizedLead.serviceInterests || []).join(" "),
    serviceStatusText,
    customFieldsText,
  ].join(" ");

  return normalizeSearchText(rawText);
}

export function buildLeadSearchTextFromRow(row = {}) {
  return buildLeadSearchText(rowToLeadInput(row));
}

export function buildBooleanFullTextQuery(search) {
  return normalizeSearchText(search)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 10)
    .map((token) => `+${token}*`)
    .join(" ");
}

function rowToLeadInput(row = {}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    website: row.website,
    advertisesOnMeta: Boolean(Number(row.advertises_on_meta)),
    advertisesOnGoogle: Boolean(Number(row.advertises_on_google)),
    doesNotAdvertise: Boolean(Number(row.does_not_advertise)),
    lastContactAt: row.last_contact_at,
    contactMadeAt: row.contact_made_at,
    nextContactAt: row.next_contact_at,
    expectedCloseAt: row.expected_close_at || "",
    estimatedBudget: row.estimated_budget,
    isLost: Boolean(Number(row.is_lost)),
    lostReason: row.lost_reason,
    commercialNotes: row.commercial_notes || "",
    status: row.status,
    responsible: row.responsible,
    responsibleUserId: row.responsible_user_id || "",
    temperature: row.temperature,
    pain: row.pain || "",
    source: row.source,
    serviceInterests: parseJsonValue(row.service_interests, []),
    serviceStatusMap: parseJsonValue(row.service_status_map, {}),
    customFields: parseJsonValue(row.custom_fields, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    deletedAt: row.deleted_at || "",
    deletedBy: row.deleted_by || "",
    restoredAt: row.restored_at || "",
    restoredBy: row.restored_by || "",
    pipelineId: row.pipeline_id || "",
    pipelineStageId: row.pipeline_stage_id || "",
    kanbanPosition: Number(row.kanban_position || 0),
    pipelineEnteredAt: row.pipeline_entered_at || "",
  };
}

export function rowToLead(row) {
  return normalizeLead(rowToLeadInput(row));
}

export function leadToDbParams(lead, options = {}) {
  const normalizedLead = normalizeLead(lead);
  const updatedAt = options.updatedAt || nowIso();
  const emailKey = normalizeEmailKey(normalizedLead.email);
  const phoneKey = normalizePhoneKey(normalizedLead.phone);
  const nameCompanyKey = normalizeNameCompanyKey(normalizedLead);
  const searchText = buildLeadSearchText(normalizedLead);

  return [
    normalizedLead.id,
    normalizedLead.name,
    normalizedLead.email,
    emailKey,
    normalizedLead.phone,
    phoneKey,
    normalizedLead.company,
    nameCompanyKey,
    normalizedLead.website,
    normalizedLead.advertisesOnMeta ? 1 : 0,
    normalizedLead.advertisesOnGoogle ? 1 : 0,
    normalizedLead.doesNotAdvertise ? 1 : 0,
    normalizedLead.lastContactAt,
    normalizedLead.contactMadeAt,
    normalizedLead.nextContactAt,
    normalizedLead.expectedCloseAt,
    normalizedLead.estimatedBudget,
    normalizedLead.isLost ? 1 : 0,
    normalizedLead.lostReason,
    normalizedLead.commercialNotes,
    normalizedLead.status,
    normalizedLead.responsible,
    normalizedLead.responsibleUserId,
    normalizedLead.temperature,
    normalizedLead.pain,
    normalizedLead.source,
    JSON.stringify(normalizedLead.serviceInterests || []),
    JSON.stringify(normalizedLead.serviceStatusMap || {}),
    JSON.stringify(normalizedLead.customFields || {}),
    searchText,
    normalizedLead.createdAt,
    updatedAt,
    normalizedLead.deletedAt,
    normalizedLead.deletedBy,
    normalizedLead.restoredAt,
    normalizedLead.restoredBy,
    normalizedLead.pipelineId,
    normalizedLead.pipelineStageId,
    normalizedLead.kanbanPosition,
    normalizedLead.pipelineEnteredAt,
  ];
}
