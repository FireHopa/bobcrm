import { randomUUID } from "node:crypto";
import { phoneKeyVariants } from "../../zapeIntegration.js";
import {
  leadToDbParams,
  normalizeEmailKey,
  normalizeLead,
  normalizeNameCompanyKey,
  normalizePhoneKey,
  rowToLead,
} from "./leadMapper.js";
import { buildLeadUpsertSql } from "./leadPersistenceSql.js";
import { LEAD_IMPORT_MERGE_SELECT } from "./leadProjections.js";

export const DEFAULT_IMPORT_DB_BATCH_SIZE = 500;
export const MIN_IMPORT_DB_BATCH_SIZE = 100;
export const MAX_IMPORT_DB_BATCH_SIZE = 1000;

export function resolveImportDbBatchSize(value, fallback = DEFAULT_IMPORT_DB_BATCH_SIZE) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_IMPORT_DB_BATCH_SIZE, Math.max(MIN_IMPORT_DB_BATCH_SIZE, parsed));
}

export function sliceImportBatch(items, startIndex, batchSize) {
  const start = Math.max(0, Number(startIndex || 0));
  const size = resolveImportDbBatchSize(batchSize);
  return items.slice(start, start + size);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function collectImportIdentityKeys(leads = []) {
  const ids = [];
  const emails = [];
  const phones = [];
  const nameCompanies = [];

  for (const rawLead of leads) {
    const lead = normalizeLead(rawLead);
    if (lead.id) ids.push(lead.id);
    const emailKey = normalizeEmailKey(lead.email);
    if (emailKey) emails.push(emailKey);
    const phoneKey = normalizePhoneKey(lead.phone);
    phones.push(...phoneKeyVariants(phoneKey));
    const nameCompanyKey = normalizeNameCompanyKey(lead);
    if (nameCompanyKey) nameCompanies.push(nameCompanyKey);
  }

  return {
    ids: unique(ids),
    emails: unique(emails),
    phones: unique(phones),
    nameCompanies: unique(nameCompanies),
  };
}

function appendInClause(column, values, clauses, params) {
  if (!values.length) return;
  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

export function buildImportDuplicateLookup(leads, accessSql = { clause: "1 = 1", params: [] }) {
  const keys = collectImportIdentityKeys(leads);
  const identityClauses = [];
  const identityParams = [];
  appendInClause("id", keys.ids, identityClauses, identityParams);
  appendInClause("email_key", keys.emails, identityClauses, identityParams);
  appendInClause("phone_key", keys.phones, identityClauses, identityParams);
  appendInClause("name_company_key", keys.nameCompanies, identityClauses, identityParams);

  if (!identityClauses.length) {
    return { sql: "", params: [], keys };
  }

  return {
    sql: `SELECT ${LEAD_IMPORT_MERGE_SELECT} FROM leads WHERE deleted_at = '' AND ${accessSql.clause || "1 = 1"} AND (${identityClauses.join(" OR ")})`,
    params: [...(accessSql.params || []), ...identityParams],
    keys,
  };
}

export function createImportDuplicateIndex(rows = []) {
  const index = {
    byId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
    byNameCompany: new Map(),
  };
  for (const row of rows) addLeadToImportDuplicateIndex(index, rowToLead(row), row);
  return index;
}

export function addLeadToImportDuplicateIndex(index, lead, rawKeys = {}) {
  const normalizedLead = normalizeLead(lead);
  const id = String(normalizedLead.id || "").trim();
  if (!id) return;
  index.byId.set(id, normalizedLead);

  const emailKey = String(rawKeys.email_key || normalizeEmailKey(normalizedLead.email));
  const phoneKey = String(rawKeys.phone_key || normalizePhoneKey(normalizedLead.phone));
  const nameCompanyKey = String(rawKeys.name_company_key || normalizeNameCompanyKey(normalizedLead));

  if (emailKey) index.byEmail.set(emailKey, id);
  for (const variant of phoneKeyVariants(phoneKey)) index.byPhone.set(variant, id);
  if (nameCompanyKey) index.byNameCompany.set(nameCompanyKey, id);
}

export function findImportDuplicateLead(index, rawLead) {
  const lead = normalizeLead(rawLead);
  const exact = index.byId.get(lead.id);
  if (exact) return { lead: exact, matchedBy: "id" };

  const emailKey = normalizeEmailKey(lead.email);
  if (emailKey && index.byEmail.has(emailKey)) {
    const id = index.byEmail.get(emailKey);
    return { lead: index.byId.get(id), matchedBy: "email" };
  }

  const phoneKey = normalizePhoneKey(lead.phone);
  for (const variant of phoneKeyVariants(phoneKey)) {
    if (!index.byPhone.has(variant)) continue;
    const id = index.byPhone.get(variant);
    return { lead: index.byId.get(id), matchedBy: "phone" };
  }

  const nameCompanyKey = normalizeNameCompanyKey(lead);
  if (nameCompanyKey && index.byNameCompany.has(nameCompanyKey)) {
    const id = index.byNameCompany.get(nameCompanyKey);
    return { lead: index.byId.get(id), matchedBy: "name_company" };
  }

  return null;
}

export function getImportPrimaryKey(rawLead) {
  const lead = normalizeLead(rawLead);
  const emailKey = normalizeEmailKey(lead.email);
  if (emailKey) return `email:${emailKey}`;
  const phoneKey = normalizePhoneKey(lead.phone);
  if (phoneKey.length >= 8) return `phone:${phoneKey}`;
  const nameCompanyKey = normalizeNameCompanyKey(lead);
  if (nameCompanyKey) return `name:${nameCompanyKey}`;
  return `id:${lead.id}`;
}

export function applyImportKanbanTarget(rawLead, target = {}, enteredAt = new Date().toISOString()) {
  const lead = normalizeLead(rawLead);
  const pipelineId = String(target.pipelineId || target.pipeline_id || "").trim();
  const stageId = String(target.stageId || target.stage_id || target.pipelineStageId || "").trim();
  if (!pipelineId || !stageId) return lead;

  const stageType = String(target.stageType || target.stage_type || "open").trim().toLowerCase();
  const statusKey = String(target.statusKey || target.status_key || "").trim();
  let status = lead.status || "Novo lead";
  let isLost = false;

  if (stageType === "won") {
    status = "Fechado";
  } else if (stageType === "lost") {
    status = "Perdido";
    isLost = true;
  } else if (statusKey) {
    status = statusKey;
    isLost = statusKey === "Perdido";
  } else if (status === "Fechado" || status === "Perdido") {
    status = "Novo lead";
  }

  const sameStage = lead.pipelineId === pipelineId && lead.pipelineStageId === stageId;
  const requestedPosition = Number(target.kanbanPosition || 0);

  return normalizeLead({
    ...lead,
    pipelineId,
    pipelineStageId: stageId,
    status,
    isLost,
    kanbanPosition: sameStage && lead.kanbanPosition
      ? lead.kanbanPosition
      : requestedPosition || Date.now() * 1000 + Math.floor(Math.random() * 1000),
    pipelineEnteredAt: sameStage && lead.pipelineEnteredAt ? lead.pipelineEnteredAt : enteredAt,
  });
}

export function buildLeadBatchUpsert(leads = [], updatedAt) {
  if (!leads.length) return { sql: "", params: [] };
  const params = leads.flatMap((lead) => leadToDbParams(lead, { updatedAt }));
  return { sql: buildLeadUpsertSql(leads.length), params };
}

export function buildNewLeadFollowUpTaskInsert(leads = [], actor = {}, at = new Date().toISOString()) {
  const eligible = leads.filter((lead) => {
    const dueAt = String(lead?.nextContactAt || "").trim();
    const closed = Boolean(lead?.isLost || lead?.deletedAt || lead?.status === "Perdido" || lead?.status === "Fechado");
    return dueAt && !closed;
  });
  if (!eligible.length) return { sql: "", params: [], count: 0 };

  const columns = [
    "id", "type", "title", "description", "responsible_user_id", "responsible_name",
    "created_by", "created_by_name", "lead_id", "due_at", "priority", "status",
    "source", "source_key", "created_at", "updated_at",
  ];
  const rowSql = `(${columns.map(() => "?").join(", ")})`;
  const params = [];

  for (const lead of eligible) {
    const leadId = String(lead.id || "");
    const responsibleUserId = String(lead.responsibleUserId || actor?.id || "").trim();
    const responsibleName = String(lead.responsible || actor?.name || actor?.email || "").trim();
    params.push(
      randomUUID(),
      "follow_up",
      `Follow-up com ${lead.name || lead.company || lead.phone || "lead"}`.slice(0, 180),
      "Sincronizada com o campo próximo contato do lead.",
      responsibleUserId,
      responsibleName,
      actor?.id || "",
      actor?.name || actor?.email || "Sistema",
      leadId,
      String(lead.nextContactAt || "").trim(),
      "normal",
      "pending",
      "lead_next_contact",
      `lead-next-contact:${leadId}`,
      at,
      at,
    );
  }

  return {
    sql: `INSERT INTO tasks (${columns.join(", ")}) VALUES ${eligible.map(() => rowSql).join(", ")}
      ON DUPLICATE KEY UPDATE
        title = VALUES(title), responsible_user_id = VALUES(responsible_user_id), responsible_name = VALUES(responsible_name),
        due_at = VALUES(due_at), status = 'pending', completed_at = '', completed_by = '', result = '', updated_at = VALUES(updated_at)`,
    params,
    count: eligible.length,
  };
}

export async function persistImportLeadBatch({
  leads,
  client,
  accessSql,
  transactionContext,
  seenPrimaryKeys = new Set(),
  acquireIdentityLock,
  queryRows,
  mergeLeadData,
  resolveLeadResponsibleLink,
  ensureLeadKanbanAssignment,
  execute,
  nowIso,
  importKanbanTarget = null,
  invalidateLeadSummaryCache = () => undefined,
}) {
  await acquireIdentityLock(client, transactionContext);
  const lookup = buildImportDuplicateLookup(leads, accessSql);
  const existingRows = lookup.sql ? await queryRows(lookup.sql, lookup.params, client) : [];
  const duplicateIndex = createImportDuplicateIndex(existingRows);
  const existingIds = new Set(existingRows.map((row) => String(row.id || "")).filter(Boolean));
  const localSeenKeys = new Set(seenPrimaryKeys);
  const keysToCommit = [];
  const finalLeadsById = new Map();
  const report = { received: leads.length, created: 0, merged: 0, ignoredInsideFile: 0 };

  for (const rawLead of leads) {
    const normalizedLead = normalizeLead(rawLead);
    const primaryKey = getImportPrimaryKey(normalizedLead);
    if (localSeenKeys.has(primaryKey)) {
      report.ignoredInsideFile += 1;
      continue;
    }
    localSeenKeys.add(primaryKey);
    keysToCommit.push(primaryKey);

    const duplicateMatch = findImportDuplicateLead(duplicateIndex, normalizedLead);
    let preparedLead;
    if (duplicateMatch?.lead && duplicateMatch.lead.id !== normalizedLead.id) {
      const mergedLead = mergeLeadData(duplicateMatch.lead, { ...normalizedLead, id: duplicateMatch.lead.id });
      preparedLead = await ensureLeadKanbanAssignment(await resolveLeadResponsibleLink(mergedLead, client), client);
      report.merged += 1;
    } else {
      preparedLead = await ensureLeadKanbanAssignment(normalizedLead, client);
      report.created += 1;
    }

    if (importKanbanTarget) {
      preparedLead = applyImportKanbanTarget(preparedLead, importKanbanTarget, nowIso());
    }

    finalLeadsById.set(preparedLead.id, preparedLead);
    addLeadToImportDuplicateIndex(duplicateIndex, preparedLead);
  }

  const results = Array.from(finalLeadsById.values());
  if (results.length) {
    const updatedAt = nowIso();
    const batchUpsert = buildLeadBatchUpsert(results, updatedAt);
    await execute(batchUpsert.sql, batchUpsert.params, client);
    for (const lead of results) lead.updatedAt = updatedAt;
  }

  invalidateLeadSummaryCache();
  return {
    results,
    report,
    keysToCommit,
    newLeads: results.filter((lead) => !existingIds.has(lead.id)),
    existingLeads: results.filter((lead) => existingIds.has(lead.id)),
  };
}
