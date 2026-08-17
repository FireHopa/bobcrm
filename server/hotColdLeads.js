import { randomUUID } from "node:crypto";
import { writeCsvExport } from "./leadExport.js";
import { customFieldLabels, rowToLead } from "./domains/leads/leadMapper.js";
import { sanitizeSpreadsheetCell } from "./security.js";
import {
  createJobStorageKey,
  prepareJobStoragePath,
  describeJobArtifact,
  jobArtifactExpiryIso,
  removeJobArtifact,
} from "./jobArtifacts.js";
import { updateJobProgress } from "./jobQueue.js";

export const HOT_COLD_JOB_TYPES = Object.freeze({
  ARCHIVE: "archive_cold_leads",
  EXPORT_CSV: "export_archived_leads_csv",
});

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function quoteIdentifier(value) {
  return `\`${String(value || "").replace(/`/g, "``")}\``;
}

function archiveRowToLead(row = {}) {
  return {
    ...rowToLead(row),
    archivedAt: row.archived_at instanceof Date ? row.archived_at.toISOString() : String(row.archived_at || ""),
    archivedBy: String(row.archived_by || ""),
    archiveReason: String(row.archive_reason || ""),
    archiveBatchId: String(row.archive_batch_id || ""),
  };
}

function archiveCsvRow(row = {}) {
  const lead = archiveRowToLead(row);
  return [
    lead.name, lead.email, lead.phone, lead.company, lead.website, lead.instagram || "", lead.status, lead.responsible,
    lead.temperature, lead.pain, lead.source, lead.nextContactAt, lead.expectedCloseAt, lead.lastContactAt,
    lead.contactMadeAt, lead.estimatedBudget, lead.advertisesOnGoogle ? "Sim" : "Não",
    lead.advertisesOnMeta ? "Sim" : "Não", lead.doesNotAdvertiseOnGoogle ? "Sim" : "Não",
    lead.doesNotAdvertiseOnMeta ? "Sim" : "Não", lead.doesNotAdvertise ? "Sim" : "Não", lead.lostReason,
    lead.commercialNotes, (lead.serviceInterests || []).join(" | "), JSON.stringify(lead.serviceStatusMap || {}),
    ...customFieldLabels.map((field) => lead.customFields?.[field] || ""),
    lead.createdAt, lead.updatedAt, lead.archivedAt, lead.archiveReason,
  ].map(sanitizeSpreadsheetCell);
}

const ARCHIVE_CSV_HEADERS = [
  "Nome", "Email", "Telefone", "Empresa", "Website", "Instagram", "Status", "Responsavel", "Temperatura", "Dor", "Origem",
  "Proximo contato", "Fechamento previsto", "Ultimo contato", "Contato feito em", "Orcamento estimado", "Anuncia Google",
  "Anuncia Meta", "Nao anuncia Google", "Nao anuncia Meta", "Nao anuncia", "Motivo perda", "Observacao comercial", "Servicos", "Mapa de servicos",
  ...customFieldLabels, "Criado em", "Atualizado em", "Arquivado em", "Motivo do arquivo",
];

export function resolveHotColdSettings(env = process.env) {
  return Object.freeze({
    hotLimit: boundedInt(env.HOT_LEADS_LIMIT, 30000, 1000, 1000000),
    batchSize: boundedInt(env.HOT_LEADS_ARCHIVE_BATCH_SIZE, 250, 25, 1000),
    batchPauseMs: boundedInt(env.HOT_LEADS_ARCHIVE_PAUSE_MS, 75, 0, 5000),
    closedInactiveDays: boundedInt(env.HOT_LEADS_CLOSED_INACTIVE_DAYS, 30, 7, 3650),
    unassignedInactiveDays: boundedInt(env.HOT_LEADS_UNASSIGNED_INACTIVE_DAYS, 120, 30, 3650),
    allowAssignedClosed: String(env.HOT_LEADS_ARCHIVE_ASSIGNED_CLOSED || "0") === "1",
    autoArchive: String(env.HOT_LEADS_AUTO_ARCHIVE || "1") !== "0",
  });
}

export function createHotColdLeadService({
  queryRows,
  execute,
  scalar,
  withTransaction,
  enqueuePersistentJob,
  publicJob,
  requirePermission,
  readRequestBody,
  sendJson,
  recordAudit,
  recordAuditOnce,
  invalidateLeadCaches = () => undefined,
  jobArtifactSettings,
  databaseName,
  nowIso = () => new Date().toISOString(),
  env = process.env,
} = {}) {
  const settings = resolveHotColdSettings(env);
  let leadColumnsPromise = null;

  async function getLeadColumns(client = null) {
    if (!leadColumnsPromise) {
      leadColumnsPromise = queryRows(
        `SELECT COLUMN_NAME AS column_name
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads'
         ORDER BY ORDINAL_POSITION ASC`,
        [databaseName],
        client,
      ).then((rows) => rows.map((row) => String(row.column_name || "")).filter(Boolean));
    }
    return leadColumnsPromise;
  }

  async function setMetric(key, value, client = null) {
    await execute(
      `INSERT INTO crm_statistics (metric_key, metric_value, updated_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE metric_value = VALUES(metric_value), updated_at = VALUES(updated_at)`,
      [String(key), Math.max(0, Number(value || 0))],
      client,
    );
  }

  async function adjustStats({ activeDelta = 0, archiveDelta = 0 } = {}) {
    if (activeDelta) {
      const result = await execute("UPDATE crm_statistics SET metric_value = GREATEST(0, metric_value + ?), updated_at = NOW(3) WHERE metric_key = 'active_leads'", [Number(activeDelta)]);
      if (!Number(result?.affectedRows || 0)) await refreshStats();
    }
    if (archiveDelta) {
      const result = await execute("UPDATE crm_statistics SET metric_value = GREATEST(0, metric_value + ?), updated_at = NOW(3) WHERE metric_key = 'archived_leads'", [Number(archiveDelta)]);
      if (!Number(result?.affectedRows || 0)) await refreshStats();
    }
  }

  async function readMetrics(client = null) {
    const rows = await queryRows(
      `SELECT metric_key, metric_value, updated_at
       FROM crm_statistics
       WHERE metric_key IN ('active_leads', 'archived_leads', 'archive_protected_overflow')`,
      [],
      client,
    );
    const metrics = new Map(rows.map((row) => [String(row.metric_key || ""), row]));
    return {
      activeLeads: Number(metrics.get("active_leads")?.metric_value || 0),
      archivedLeads: Number(metrics.get("archived_leads")?.metric_value || 0),
      protectedOverflow: Number(metrics.get("archive_protected_overflow")?.metric_value || 0),
      updatedAt: metrics.get("active_leads")?.updated_at || metrics.get("archived_leads")?.updated_at || "",
    };
  }

  async function refreshStats(client = null) {
    const [activeLeads, archivedLeads] = await Promise.all([
      scalar("SELECT COUNT(*) AS total FROM leads WHERE deleted_at = ''", [], client),
      scalar("SELECT COUNT(*) AS total FROM leads_archive", [], client),
    ]);
    await setMetric("active_leads", Number(activeLeads || 0), client);
    await setMetric("archived_leads", Number(archivedLeads || 0), client);
    return readMetrics(client);
  }

  async function getStats({ refresh = false } = {}) {
    let metrics = await readMetrics();
    if (refresh || (!metrics.updatedAt && metrics.activeLeads === 0 && metrics.archivedLeads === 0)) {
      metrics = await refreshStats();
    }
    const lastArchive = await queryRows("SELECT archived_at FROM leads_archive ORDER BY archived_at DESC, id DESC LIMIT 1");
    return {
      ...metrics,
      hotLimit: settings.hotLimit,
      overflow: Math.max(0, metrics.activeLeads - settings.hotLimit),
      lastArchiveAt: lastArchive[0]?.archived_at || "",
      autoArchive: settings.autoArchive,
      batchSize: settings.batchSize,
    };
  }

  async function selectArchiveCandidates(client, limit) {
    const assignedClause = settings.allowAssignedClosed ? "" : "AND TRIM(COALESCE(l.responsible_user_id, '')) = ''";
    const closedCutoff = new Date(Date.now() - settings.closedInactiveDays * 86400000).toISOString();
    const inactiveCutoff = new Date(Date.now() - settings.unassignedInactiveDays * 86400000).toISOString();
    const common = `l.deleted_at = ''
      AND TRIM(COALESCE(l.updated_at, '')) != ''
      AND TRIM(COALESCE(l.next_contact_at, '')) = ''
      AND NOT EXISTS (SELECT 1 FROM leads_archive a WHERE a.id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.status = 'pending')`;

    const closed = await queryRows(
      `SELECT l.id, 'closed_or_lost' AS archive_reason
       FROM leads l
       WHERE ${common}
         ${assignedClause}
         AND (l.is_lost = 1 OR l.status IN ('Fechado', 'Perdido', 'Sem interesse', 'Descartado', 'Inativo'))
         AND l.updated_at < ?
       ORDER BY l.updated_at ASC, l.id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [closedCutoff, limit],
      client,
    );
    if (closed.length >= limit) return closed;

    const remaining = limit - closed.length;
    const excludedIds = closed.map((row) => String(row.id || "")).filter(Boolean);
    const exclusion = excludedIds.length ? `AND l.id NOT IN (${placeholders(excludedIds)})` : "";
    const inactive = await queryRows(
      `SELECT l.id, 'inactive_unassigned' AS archive_reason
       FROM leads l
       WHERE ${common}
         AND TRIM(COALESCE(l.responsible_user_id, '')) = ''
         AND TRIM(COALESCE(l.responsible, '')) = ''
         AND TRIM(COALESCE(l.expected_close_at, '')) = ''
         AND l.opportunity_score = 0
         AND l.lead_priority_score <= 30
         AND l.updated_at < ?
         ${exclusion}
       ORDER BY l.updated_at ASC, l.id ASC
       LIMIT ? FOR UPDATE SKIP LOCKED`,
      [inactiveCutoff, ...excludedIds, remaining],
      client,
    );
    return [...closed, ...inactive];
  }

  async function moveCandidateBatch(job, requestedLimit) {
    return withTransaction(async (client) => {
      const candidates = await selectArchiveCandidates(client, requestedLimit);
      if (!candidates.length) return { moved: 0, byReason: {} };
      const columns = await getLeadColumns(client);
      const columnSql = columns.map(quoteIdentifier).join(", ");
      const ids = candidates.map((row) => String(row.id || "")).filter(Boolean);
      const byReason = Object.fromEntries(candidates.map((row) => [String(row.id), String(row.archive_reason || "inactive") ]));
      const archivedAt = new Date();
      let moved = 0;

      for (const reason of Array.from(new Set(Object.values(byReason)))) {
        const reasonIds = ids.filter((id) => byReason[id] === reason);
        if (!reasonIds.length) continue;
        const values = placeholders(reasonIds);
        const inserted = await execute(
          `INSERT IGNORE INTO leads_archive (${columnSql}, archived_at, archived_by, archive_reason, archive_batch_id)
           SELECT ${columns.map((column) => `l.${quoteIdentifier(column)}`).join(", ")}, ?, ?, ?, ?
           FROM leads l WHERE l.id IN (${values})`,
          [archivedAt, String(job.createdBy || "system"), reason, String(job.id || randomUUID()), ...reasonIds],
          client,
        );
        moved += Number(inserted?.affectedRows || 0);
      }

      if (moved > 0) {
        await execute(
          `DELETE l FROM leads l
           INNER JOIN leads_archive a ON a.id = l.id AND a.archive_batch_id = ?
           WHERE l.id IN (${placeholders(ids)})`,
          [String(job.id || ""), ...ids],
          client,
        );
      }
      return { moved, byReason };
    });
  }

  async function performArchiveJob(job) {
    const initial = await refreshStats();
    const overflow = Math.max(0, initial.activeLeads - settings.hotLimit);
    if (!overflow) {
      await setMetric("archive_protected_overflow", 0);
      return { result: { archived: 0, activeLeads: initial.activeLeads, archivedLeads: initial.archivedLeads, hotLimit: settings.hotLimit } };
    }

    let archived = 0;
    let stalled = false;
    await updateJobProgress({ execute, jobId: job.id, lockToken: job.lockedBy, current: 0, total: overflow, message: `Arquivando excedente acima de ${settings.hotLimit.toLocaleString("pt-BR")}` });

    while (archived < overflow) {
      const requested = Math.min(settings.batchSize, overflow - archived);
      const batch = await moveCandidateBatch(job, requested);
      if (!batch.moved) { stalled = true; break; }
      archived += batch.moved;
      await updateJobProgress({ execute, jobId: job.id, lockToken: job.lockedBy, current: archived, total: overflow, message: `${archived.toLocaleString("pt-BR")} leads movidos para o arquivo frio` });
      if (settings.batchPauseMs) await sleep(settings.batchPauseMs);
    }

    const finalStats = await refreshStats();
    const protectedOverflow = Math.max(0, finalStats.activeLeads - settings.hotLimit);
    await setMetric("archive_protected_overflow", stalled ? protectedOverflow : 0);
    invalidateLeadCaches();
    if (recordAuditOnce && archived > 0) {
      await recordAuditOnce({
        id: `hot-cold:${job.id}`,
        entityType: "lead_archive",
        entityId: String(job.id),
        action: "leads_archived_cold",
        actor: { id: job.createdBy || "system", name: job.createdByName || "Sistema" },
        summary: `Arquivou ${archived} lead(s) inativos. Base operacional: ${finalStats.activeLeads}.`,
        changes: { archived, activeLeads: finalStats.activeLeads, archivedLeads: finalStats.archivedLeads, hotLimit: settings.hotLimit, protectedOverflow },
      });
    }
    return { result: { archived, activeLeads: finalStats.activeLeads, archivedLeads: finalStats.archivedLeads, hotLimit: settings.hotLimit, protectedOverflow } };
  }

  async function performArchiveCsvExportJob(job) {
    const storageKey = createJobStorageKey("archived-leads-export-csv", "csv");
    const filePath = await prepareJobStoragePath(jobArtifactSettings.storageRoot, storageKey);
    const stats = await getStats();
    const fetchPage = async ({ cursor, limit }) => {
      const cursorClause = cursor ? "WHERE (archived_at < ? OR (archived_at = ? AND id < ?))" : "";
      const params = cursor ? [cursor.archivedAt, cursor.archivedAt, cursor.id, limit] : [limit];
      const rows = await queryRows(
        `SELECT * FROM leads_archive ${cursorClause} ORDER BY archived_at DESC, id DESC LIMIT ?`,
        params,
      );
      const last = rows.at(-1);
      return {
        records: rows,
        total: stats.archivedLeads,
        nextCursor: rows.length === limit && last ? { archivedAt: last.archived_at, id: last.id } : null,
      };
    };
    const onProgress = ({ current, total, message }) => updateJobProgress({ execute, jobId: job.id, lockToken: job.lockedBy, current, total, message });

    try {
      const exportResult = await writeCsvExport({ filePath, headers: ARCHIVE_CSV_HEADERS, fetchPage, mapRow: archiveCsvRow, pageSize: 5000, onProgress });
      const fileName = `crm-casa-do-ads-leads-arquivados-${new Date().toISOString().slice(0, 10)}.csv`;
      const artifact = await describeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey, fileName, contentType: "text/csv; charset=utf-8" });
      return { result: { format: "csv", total: exportResult.total, archived: true }, artifact, expiresAt: jobArtifactExpiryIso(jobArtifactSettings.artifactTtlHours) };
    } catch (error) {
      await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey }).catch(() => undefined);
      throw error;
    }
  }

  async function queueAutoArchive(actor = { id: "system", name: "Sistema" }) {
    if (!settings.autoArchive || !enqueuePersistentJob) return null;
    const stats = await getStats();
    if (stats.activeLeads <= settings.hotLimit) return null;
    const queued = await enqueuePersistentJob({
      type: HOT_COLD_JOB_TYPES.ARCHIVE,
      payload: { reason: "hot_limit", hotLimit: settings.hotLimit },
      actor,
      dedupeKey: "hot-cold:auto-archive",
      maxAttempts: 5,
    });
    return queued.job;
  }

  async function listArchived(requestUrl) {
    const limit = boundedInt(requestUrl.searchParams.get("limit"), 100, 1, 200);
    const offset = boundedInt(requestUrl.searchParams.get("offset"), 0, 0, 500000);
    const search = String(requestUrl.searchParams.get("search") || "").trim().slice(0, 160);
    const where = [];
    const params = [];
    if (search) {
      const like = `%${search}%`;
      where.push("(name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR responsible LIKE ?)");
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = search
      ? Number(await scalar(`SELECT COUNT(*) AS total FROM leads_archive ${whereSql}`, params) || 0)
      : (await getStats()).archivedLeads;
    const rows = await queryRows(
      `SELECT * FROM leads_archive ${whereSql} ORDER BY archived_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { leads: rows.map(archiveRowToLead), pagination: { total, limit, offset, hasMore: offset + rows.length < total } };
  }

  async function restoreArchivedLead(leadId, currentUser) {
    const restored = await withTransaction(async (client) => {
      const columns = await getLeadColumns(client);
      const columnSql = columns.map(quoteIdentifier).join(", ");
      const archiveRow = (await queryRows("SELECT * FROM leads_archive WHERE id = ? LIMIT 1 FOR UPDATE", [leadId], client))[0];
      if (!archiveRow) {
        const error = new Error("Lead arquivado não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const active = (await queryRows("SELECT id FROM leads WHERE id = ? LIMIT 1 FOR UPDATE", [leadId], client))[0];
      if (active) {
        const error = new Error("Já existe um lead ativo com este identificador.");
        error.statusCode = 409;
        throw error;
      }
      await execute(
        `INSERT INTO leads (${columnSql}) SELECT ${columns.map((column) => quoteIdentifier(column)).join(", ")} FROM leads_archive WHERE id = ?`,
        [leadId],
        client,
      );
      const at = nowIso();
      await execute("UPDATE leads SET restored_at = ?, restored_by = ?, updated_at = ? WHERE id = ?", [at, currentUser.id, at, leadId], client);
      await execute("DELETE FROM leads_archive WHERE id = ?", [leadId], client);
      if (recordAudit) {
        await recordAudit({ entityType: "lead", entityId: leadId, action: "lead_restored_from_archive", actor: currentUser, summary: `Restaurou lead do arquivo frio: ${archiveRow.name || archiveRow.company || leadId}` }, client);
      }
      const row = (await queryRows("SELECT * FROM leads WHERE id = ? LIMIT 1", [leadId], client))[0];
      return rowToLead(row || archiveRow);
    });
    await refreshStats();
    invalidateLeadCaches();
    await queueAutoArchive(currentUser).catch(() => undefined);
    return restored;
  }

  async function handleApi({ pathname, method, request, requestUrl, response, currentUser }) {
    if (pathname === "/api/leads/archive/stats" && method === "GET") {
      requirePermission(currentUser, "manage_users");
      sendJson(response, 200, await getStats({ refresh: requestUrl.searchParams.get("refresh") === "1" }));
      return true;
    }
    if (pathname === "/api/leads/archive" && method === "GET") {
      requirePermission(currentUser, "manage_users");
      sendJson(response, 200, await listArchived(requestUrl));
      return true;
    }
    if (pathname === "/api/leads/archive/run" && method === "POST") {
      requirePermission(currentUser, "manage_users");
      await readRequestBody(request).catch(() => ({}));
      const queued = await enqueuePersistentJob({ type: HOT_COLD_JOB_TYPES.ARCHIVE, payload: { reason: "manual", hotLimit: settings.hotLimit }, actor: currentUser, dedupeKey: "hot-cold:auto-archive", maxAttempts: 5 });
      sendJson(response, 202, publicJob(queued.job));
      return true;
    }
    if (pathname === "/api/exports/leads-archive" && method === "POST") {
      requirePermission(currentUser, "manage_users");
      requirePermission(currentUser, "export_leads");
      const queued = await enqueuePersistentJob({ type: HOT_COLD_JOB_TYPES.EXPORT_CSV, payload: { format: "csv" }, actor: currentUser, dedupeKey: `export-archive:${currentUser.id}`, maxAttempts: 3 });
      sendJson(response, 202, publicJob(queued.job));
      return true;
    }
    const restoreMatch = pathname.match(/^\/api\/leads\/archive\/([^/]+)\/restore$/);
    if (restoreMatch && method === "POST") {
      requirePermission(currentUser, "manage_users");
      const leadId = decodeURIComponent(restoreMatch[1]);
      sendJson(response, 200, await restoreArchivedLead(leadId, currentUser));
      return true;
    }
    return false;
  }

  return {
    settings,
    getStats,
    refreshStats,
    adjustStats,
    queueAutoArchive,
    performArchiveJob,
    performArchiveCsvExportJob,
    restoreArchivedLead,
    handleApi,
  };
}
