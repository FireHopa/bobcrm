const DATE_PRESETS = new Set(["", "overdue", "today", "tomorrow", "next7", "next30", "thisMonth", "noDate", "hasDate", "custom"]);
const FIELD_STATE_VALUES = new Set(["", "any", "filled", "empty"]);
const BOOLEAN_FILTER_VALUES = new Set(["", "any", "yes", "no"]);
const TASK_PRESENCE_VALUES = new Set(["", "any", "has", "none", "pending", "completed", "overdue", "today"]);
const LEAD_BASES = new Set(["active", "deleted", "archived"]);

const LEAD_DATE_COLUMNS = Object.freeze({
  createdAt: "created_at",
  updatedAt: "updated_at",
  nextContactAt: "next_contact_at",
  expectedCloseAt: "expected_close_at",
  lastContactAt: "last_contact_at",
  contactMadeAt: "contact_made_at",
  wonAt: "won_at",
  lostAt: "lost_at",
  pipelineEnteredAt: "pipeline_entered_at",
});

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 100, maxLength = 255) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function cleanNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeDateFilter(value = {}) {
  if (!value || typeof value !== "object") return { preset: "", from: "", to: "" };
  const preset = cleanText(value.preset, 20);
  return {
    preset: DATE_PRESETS.has(preset) ? preset : "",
    from: cleanDate(value.from),
    to: cleanDate(value.to),
  };
}

function normalizeChoice(value, allowed, fallback = "") {
  const text = cleanText(value, 30);
  return allowed.has(text) ? text : fallback;
}

function normalizeFieldStates(value = {}) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const key of ["responsible", "temperature", "source", "pain", "nextStep", "website", "instagram", "commercialNotes", "email", "phone", "company"]) {
    const normalized = normalizeChoice(value[key], FIELD_STATE_VALUES);
    if (normalized && normalized !== "any") result[key] = normalized;
  }
  return result;
}

function normalizeAdvertising(value = {}) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const key of ["google", "meta", "none"]) {
    const normalized = normalizeChoice(value[key], BOOLEAN_FILTER_VALUES);
    if (normalized && normalized !== "any") result[key] = normalized;
  }
  return result;
}

function normalizeTaskFilter(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    presence: normalizeChoice(value.presence, TASK_PRESENCE_VALUES),
    responsibleUserIds: cleanList(value.responsibleUserIds),
    types: cleanList(value.types),
    priorities: cleanList(value.priorities),
    statuses: cleanList(value.statuses),
    due: normalizeDateFilter(value.due),
  };
}

function normalizeHandoffFilter(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    actorUserIds: cleanList(value.actorUserIds),
    fromUserIds: cleanList(value.fromUserIds),
    toUserIds: cleanList(value.toUserIds),
    pipelineIds: cleanList(value.pipelineIds),
    stageIds: cleanList(value.stageIds),
    created: normalizeDateFilter(value.created),
  };
}

function normalizeAuditFilter(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    actorUserIds: cleanList(value.actorUserIds),
    actions: cleanList(value.actions),
    created: normalizeDateFilter(value.created),
  };
}

function normalizeExternalOriginFilter(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    providers: cleanList(value.providers),
    sources: cleanList(value.sources),
    webhookNames: cleanList(value.webhookNames),
  };
}

export function normalizeLeadFilterPayload(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const dates = {};
  for (const key of Object.keys(LEAD_DATE_COLUMNS)) {
    const dateFilter = normalizeDateFilter(input.dates?.[key]);
    if (dateFilter.preset || dateFilter.from || dateFilter.to) dates[key] = dateFilter;
  }

  const base = cleanText(input.base, 20);
  const customFields = {};
  if (input.customFields && typeof input.customFields === "object") {
    for (const [key, rawValue] of Object.entries(input.customFields)) {
      const fieldKey = cleanText(key, 120);
      const fieldValue = cleanText(rawValue, 500);
      if (fieldKey && fieldValue) customFields[fieldKey] = fieldValue;
    }
  }

  return {
    base: LEAD_BASES.has(base) ? base : "active",
    search: cleanText(input.search, 500),
    status: cleanText(input.status, 80),
    temperature: cleanText(input.temperature, 40),
    responsible: cleanText(input.responsible, 255),
    source: cleanText(input.source, 120),
    quickFilter: cleanText(input.quickFilter, 80),
    statuses: cleanList(input.statuses, 50, 80),
    temperatures: cleanList(input.temperatures, 20, 40),
    responsibleUserIds: cleanList(input.responsibleUserIds),
    responsibleNames: cleanList(input.responsibleNames),
    sdrResponsibleUserIds: cleanList(input.sdrResponsibleUserIds),
    sdrResponsibleNames: cleanList(input.sdrResponsibleNames),
    sources: cleanList(input.sources, 100, 120),
    lostReasons: cleanList(input.lostReasons, 50, 120),
    pipelineIds: cleanList(input.pipelineIds),
    stageIds: cleanList(input.stageIds),
    stageTypes: cleanList(input.stageTypes, 10, 20).filter((item) => ["open", "won", "lost"].includes(item)),
    dates,
    fieldStates: normalizeFieldStates(input.fieldStates),
    advertising: normalizeAdvertising(input.advertising),
    serviceInterests: cleanList(input.serviceInterests, 100, 180),
    serviceStatuses: cleanList(input.serviceStatuses, 20, 80),
    customFields,
    estimatedBudgetContains: cleanText(input.estimatedBudgetContains, 120),
    expectedValueMin: cleanNumber(input.expectedValueMin),
    expectedValueMax: cleanNumber(input.expectedValueMax),
    closedValueMin: cleanNumber(input.closedValueMin),
    closedValueMax: cleanNumber(input.closedValueMax),
    task: normalizeTaskFilter(input.task),
    handoff: normalizeHandoffFilter(input.handoff),
    audit: normalizeAuditFilter(input.audit),
    externalOrigin: normalizeExternalOriginFilter(input.externalOrigin),
  };
}

export function getLeadBaseTable(base = "active") {
  return base === "archived" ? "leads_archive" : "leads";
}

function placeholders(items) {
  return items.map(() => "?").join(", ");
}

function addInFilter(whereParts, sqlParams, column, values) {
  if (!values?.length) return;
  whereParts.push(`${column} IN (${placeholders(values)})`);
  sqlParams.push(...values);
}

function dateExpression(column) {
  return `LEFT(CAST(${column} AS CHAR), 10)`;
}

export function addDateFilterClause(whereParts, sqlParams, column, filter = {}) {
  const normalized = normalizeDateFilter(filter);
  const expr = dateExpression(column);
  const filled = `TRIM(COALESCE(CAST(${column} AS CHAR), '')) <> ''`;
  const empty = `TRIM(COALESCE(CAST(${column} AS CHAR), '')) = ''`;

  if (normalized.preset === "noDate") {
    whereParts.push(empty);
    return;
  }
  if (normalized.preset === "hasDate") {
    whereParts.push(filled);
    return;
  }
  if (normalized.preset === "overdue") {
    whereParts.push(`${filled} AND ${expr} < CURDATE()`);
    return;
  }
  if (normalized.preset === "today") {
    whereParts.push(`${filled} AND ${expr} = DATE_FORMAT(CURDATE(), '%Y-%m-%d')`);
    return;
  }
  if (normalized.preset === "tomorrow") {
    whereParts.push(`${filled} AND ${expr} = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d')`);
    return;
  }
  if (normalized.preset === "next7") {
    whereParts.push(`${filled} AND ${expr} >= DATE_FORMAT(CURDATE(), '%Y-%m-%d') AND ${expr} < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d')`);
    return;
  }
  if (normalized.preset === "next30") {
    whereParts.push(`${filled} AND ${expr} >= DATE_FORMAT(CURDATE(), '%Y-%m-%d') AND ${expr} < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 30 DAY), '%Y-%m-%d')`);
    return;
  }
  if (normalized.preset === "thisMonth") {
    whereParts.push(`${filled} AND LEFT(${expr}, 7) = DATE_FORMAT(CURDATE(), '%Y-%m')`);
    return;
  }

  if (normalized.from) {
    whereParts.push(`${filled} AND ${expr} >= ?`);
    sqlParams.push(normalized.from);
  }
  if (normalized.to) {
    whereParts.push(`${filled} AND ${expr} <= ?`);
    sqlParams.push(normalized.to);
  }
}

function addTextState(whereParts, column, state) {
  if (state === "filled") whereParts.push(`TRIM(COALESCE(${column}, '')) <> ''`);
  if (state === "empty") whereParts.push(`TRIM(COALESCE(${column}, '')) = ''`);
}

function addBooleanFilter(whereParts, column, value) {
  if (value === "yes") whereParts.push(`${column} = 1`);
  if (value === "no") whereParts.push(`${column} = 0`);
}

function addExistsFilter(whereParts, sqlParams, { table, alias, leadIdColumn = "lead_id", leadRef, parts, params, negate = false }) {
  if (!parts.length) return;
  const prefix = negate ? "NOT " : "";
  whereParts.push(`${prefix}EXISTS (SELECT 1 FROM ${table} ${alias} WHERE ${alias}.${leadIdColumn} = ${leadRef} AND ${parts.join(" AND ")})`);
  sqlParams.push(...params);
}

function addTaskFilter(whereParts, sqlParams, filter, leadRef) {
  const task = normalizeTaskFilter(filter);
  const parts = [];
  const params = [];

  addInFilter(parts, params, "task_filter.responsible_user_id", task.responsibleUserIds);
  addInFilter(parts, params, "task_filter.type", task.types);
  addInFilter(parts, params, "task_filter.priority", task.priorities);
  addInFilter(parts, params, "task_filter.status", task.statuses);
  if (task.due?.preset || task.due?.from || task.due?.to) addDateFilterClause(parts, params, "task_filter.due_at", task.due);

  if (task.presence === "pending") parts.push("task_filter.status = 'pending'");
  if (task.presence === "completed") parts.push("task_filter.status = 'completed'");
  if (task.presence === "overdue") parts.push("task_filter.status = 'pending' AND TRIM(COALESCE(task_filter.due_at, '')) <> '' AND LEFT(task_filter.due_at, 10) < CURDATE()");
  if (task.presence === "today") parts.push("task_filter.status = 'pending' AND LEFT(task_filter.due_at, 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d')");

  const hasSpecificFilter = parts.length > 0 || task.presence === "has" || task.presence === "none";
  if (!hasSpecificFilter) return;
  if (!parts.length) parts.push("1 = 1");
  addExistsFilter(whereParts, sqlParams, {
    table: "tasks",
    alias: "task_filter",
    leadRef,
    parts,
    params,
    negate: task.presence === "none",
  });
}

function addHandoffFilter(whereParts, sqlParams, filter, leadRef) {
  const handoff = normalizeHandoffFilter(filter);
  const parts = [];
  const params = [];
  addInFilter(parts, params, "handoff_filter.actor_user_id", handoff.actorUserIds);
  addInFilter(parts, params, "handoff_filter.from_user_id", handoff.fromUserIds);
  addInFilter(parts, params, "handoff_filter.to_user_id", handoff.toUserIds);
  addInFilter(parts, params, "handoff_filter.pipeline_id", handoff.pipelineIds);
  addInFilter(parts, params, "handoff_filter.stage_id", handoff.stageIds);
  if (handoff.created?.preset || handoff.created?.from || handoff.created?.to) addDateFilterClause(parts, params, "handoff_filter.created_at", handoff.created);
  if (!parts.length) return;
  addExistsFilter(whereParts, sqlParams, { table: "lead_handoffs", alias: "handoff_filter", leadRef, parts, params });
}

function addAuditFilter(whereParts, sqlParams, filter, leadRef) {
  const audit = normalizeAuditFilter(filter);
  const parts = ["audit_filter.entity_type = 'lead'"];
  const params = [];
  addInFilter(parts, params, "audit_filter.actor_id", audit.actorUserIds);
  addInFilter(parts, params, "audit_filter.action", audit.actions);
  if (audit.created?.preset || audit.created?.from || audit.created?.to) addDateFilterClause(parts, params, "audit_filter.created_at", audit.created);
  if (parts.length === 1) return;
  addExistsFilter(whereParts, sqlParams, { table: "audit_log", alias: "audit_filter", leadIdColumn: "entity_id", leadRef, parts, params });
}

function addExternalOriginFilter(whereParts, sqlParams, filter, leadRef) {
  const origin = normalizeExternalOriginFilter(filter);
  const parts = [];
  const params = [];
  addInFilter(parts, params, "origin_filter.provider", origin.providers);
  addInFilter(parts, params, "origin_filter.source", origin.sources);
  addInFilter(parts, params, "origin_filter.webhook_name", origin.webhookNames);
  if (!parts.length) return;
  addExistsFilter(whereParts, sqlParams, { table: "lead_external_origins", alias: "origin_filter", leadRef, parts, params });
}

export function addLeadFilterClauses(whereParts, sqlParams, filters = {}, { alias = "", includeRelations = true, customFieldLabels = [] } = {}) {
  const normalized = normalizeLeadFilterPayload(filters);
  const prefix = alias ? `${alias}.` : "";
  const leadRef = `${prefix}id`;

  if (normalized.status) {
    whereParts.push(`${prefix}status = ?`);
    sqlParams.push(normalized.status);
  }
  if (normalized.temperature) {
    whereParts.push(`${prefix}temperature = ?`);
    sqlParams.push(normalized.temperature);
  }
  if (normalized.responsible) {
    whereParts.push(`${prefix}responsible = ?`);
    sqlParams.push(normalized.responsible);
  }
  if (normalized.source) {
    whereParts.push(`(${prefix}source = ? OR EXISTS (SELECT 1 FROM lead_external_origins source_filter WHERE source_filter.lead_id = ${leadRef} AND source_filter.provider = 'zape' AND (source_filter.webhook_name = ? OR source_filter.source = ?)))`);
    sqlParams.push(normalized.source, normalized.source, normalized.source);
  }

  addInFilter(whereParts, sqlParams, `${prefix}status`, normalized.statuses);
  addInFilter(whereParts, sqlParams, `${prefix}temperature`, normalized.temperatures);
  if (normalized.responsibleUserIds.length || normalized.responsibleNames.length) {
    const responsibleParts = [];
    if (normalized.responsibleUserIds.length) {
      const ids = placeholders(normalized.responsibleUserIds);
      responsibleParts.push(`(${prefix}responsible_user_id IN (${ids}) OR (TRIM(COALESCE(${prefix}responsible_user_id, '')) = '' AND ${prefix}responsible IN (SELECT legacy_owner.name FROM users legacy_owner WHERE legacy_owner.id IN (${ids}))))`);
      sqlParams.push(...normalized.responsibleUserIds, ...normalized.responsibleUserIds);
    }
    if (normalized.responsibleNames.length) {
      responsibleParts.push(`${prefix}responsible IN (${placeholders(normalized.responsibleNames)})`);
      sqlParams.push(...normalized.responsibleNames);
    }
    whereParts.push(`(${responsibleParts.join(" OR ")})`);
  }
  if (normalized.sdrResponsibleUserIds.length || normalized.sdrResponsibleNames.length) {
    const sdrParts = [];
    if (normalized.sdrResponsibleUserIds.length) {
      const ids = placeholders(normalized.sdrResponsibleUserIds);
      sdrParts.push(`(${prefix}sdr_responsible_user_id IN (${ids}) OR (TRIM(COALESCE(${prefix}sdr_responsible_user_id, '')) = '' AND ${prefix}sdr_responsible IN (SELECT legacy_sdr.name FROM users legacy_sdr WHERE legacy_sdr.id IN (${ids}))))`);
      sqlParams.push(...normalized.sdrResponsibleUserIds, ...normalized.sdrResponsibleUserIds);
    }
    if (normalized.sdrResponsibleNames.length) {
      sdrParts.push(`${prefix}sdr_responsible IN (${placeholders(normalized.sdrResponsibleNames)})`);
      sqlParams.push(...normalized.sdrResponsibleNames);
    }
    whereParts.push(`(${sdrParts.join(" OR ")})`);
  }
  if (normalized.sources.length) {
    const sourcePlaceholders = placeholders(normalized.sources);
    whereParts.push(`(${prefix}source IN (${sourcePlaceholders}) OR EXISTS (SELECT 1 FROM lead_external_origins source_multi_filter WHERE source_multi_filter.lead_id = ${leadRef} AND source_multi_filter.provider = 'zape' AND (source_multi_filter.webhook_name IN (${sourcePlaceholders}) OR source_multi_filter.source IN (${sourcePlaceholders}))))`);
    sqlParams.push(...normalized.sources, ...normalized.sources, ...normalized.sources);
  }
  addInFilter(whereParts, sqlParams, `${prefix}lost_reason`, normalized.lostReasons);
  addInFilter(whereParts, sqlParams, `${prefix}pipeline_id`, normalized.pipelineIds);
  addInFilter(whereParts, sqlParams, `${prefix}pipeline_stage_id`, normalized.stageIds);

  if (normalized.stageTypes.length) {
    whereParts.push(`EXISTS (SELECT 1 FROM kanban_stages stage_filter WHERE stage_filter.id = ${prefix}pipeline_stage_id AND stage_filter.stage_type IN (${placeholders(normalized.stageTypes)}))`);
    sqlParams.push(...normalized.stageTypes);
  }

  for (const [key, filter] of Object.entries(normalized.dates)) {
    const column = LEAD_DATE_COLUMNS[key];
    if (column) addDateFilterClause(whereParts, sqlParams, `${prefix}${column}`, filter);
  }

  const fieldStateColumns = {
    responsible: `${prefix}responsible`,
    temperature: `${prefix}temperature`,
    source: `${prefix}source`,
    pain: `${prefix}pain`,
    nextStep: `${prefix}next_contact_at`,
    website: `${prefix}website`,
    instagram: `${prefix}instagram`,
    commercialNotes: `${prefix}commercial_notes`,
    email: `${prefix}email`,
    phone: `${prefix}phone`,
    company: `${prefix}company`,
  };
  for (const [key, state] of Object.entries(normalized.fieldStates)) addTextState(whereParts, fieldStateColumns[key], state);

  addBooleanFilter(whereParts, `${prefix}advertises_on_google`, normalized.advertising.google);
  addBooleanFilter(whereParts, `${prefix}advertises_on_meta`, normalized.advertising.meta);
  addBooleanFilter(whereParts, `${prefix}does_not_advertise`, normalized.advertising.none);

  if (normalized.serviceInterests.length) {
    const interestParts = normalized.serviceInterests.map(() => `JSON_CONTAINS(COALESCE(${prefix}service_interests, JSON_ARRAY()), JSON_QUOTE(?))`);
    whereParts.push(`(${interestParts.join(" OR ")})`);
    sqlParams.push(...normalized.serviceInterests);
  }
  if (normalized.serviceStatuses.length) {
    const statusParts = normalized.serviceStatuses.map(() => `JSON_SEARCH(COALESCE(${prefix}service_status_map, JSON_OBJECT()), 'one', ?) IS NOT NULL`);
    whereParts.push(`(${statusParts.join(" OR ")})`);
    sqlParams.push(...normalized.serviceStatuses);
  }

  const allowedCustomFields = new Set(customFieldLabels.map((item) => String(item)));
  for (const [key, value] of Object.entries(normalized.customFields)) {
    if (!allowedCustomFields.has(key)) continue;
    whereParts.push(`LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${prefix}custom_fields, ?)), '')) LIKE ?`);
    sqlParams.push(`$.${JSON.stringify(key)}`, `%${value.toLowerCase()}%`);
  }

  if (normalized.estimatedBudgetContains) {
    whereParts.push(`LOWER(COALESCE(${prefix}estimated_budget, '')) LIKE ?`);
    sqlParams.push(`%${normalized.estimatedBudgetContains.toLowerCase()}%`);
  }
  if (normalized.expectedValueMin !== null) {
    whereParts.push(`${prefix}expected_value >= ?`);
    sqlParams.push(normalized.expectedValueMin);
  }
  if (normalized.expectedValueMax !== null) {
    whereParts.push(`${prefix}expected_value <= ?`);
    sqlParams.push(normalized.expectedValueMax);
  }
  if (normalized.closedValueMin !== null) {
    whereParts.push(`${prefix}closed_value >= ?`);
    sqlParams.push(normalized.closedValueMin);
  }
  if (normalized.closedValueMax !== null) {
    whereParts.push(`${prefix}closed_value <= ?`);
    sqlParams.push(normalized.closedValueMax);
  }

  if (includeRelations) {
    addTaskFilter(whereParts, sqlParams, normalized.task, leadRef);
    addHandoffFilter(whereParts, sqlParams, normalized.handoff, leadRef);
    addAuditFilter(whereParts, sqlParams, normalized.audit, leadRef);
    addExternalOriginFilter(whereParts, sqlParams, normalized.externalOrigin, leadRef);
  }

  return normalized;
}

export function buildLeadBaseWhere(filters = {}, { alias = "l" } = {}) {
  const normalized = normalizeLeadFilterPayload(filters);
  const prefix = alias ? `${alias}.` : "";
  if (normalized.base === "deleted") return `${prefix}deleted_at <> ''`;
  if (normalized.base === "archived") return "1 = 1";
  return `${prefix}deleted_at = ''`;
}

export const leadDateFilterKeys = Object.freeze(Object.keys(LEAD_DATE_COLUMNS));
