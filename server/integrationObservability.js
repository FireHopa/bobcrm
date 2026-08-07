import { randomUUID } from "node:crypto";

function nowDate() { return new Date(); }
function safeJson(value, fallback = {}) { if (!value) return fallback; if (typeof value === "object") return value; try { return JSON.parse(value); } catch { return fallback; } }
function normalizeBaseUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }
function int(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback; }
function retentionDate(days) { return new Date(Date.now() - Math.max(1, Number(days || 1)) * 24 * 60 * 60_000); }

async function fetchZapeOverview({ monitorUrl, monitorKey, timeoutMs = 10000 }) {
  if (!monitorUrl || !monitorKey) throw Object.assign(new Error("Monitoramento do Zape não configurado."), { code: "ZAPE_MONITOR_NOT_CONFIGURED" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${normalizeBaseUrl(monitorUrl)}/api/integration-monitor/overview?limit=1&offset=0`, {
      headers: { Authorization: `Bearer ${monitorKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 1000) }; }
    if (!response.ok) throw Object.assign(new Error(data.error || `Zape respondeu HTTP ${response.status}.`), { code: data.code || "ZAPE_MONITOR_HTTP_ERROR", statusCode: response.status });
    return { data, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("Tempo limite ao consultar o Zape."), { code: "ZAPE_MONITOR_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timer); }
}

function deriveConditions(result, error) {
  if (error) return [{ fingerprint: "zape_unreachable", type: "zape_unreachable", severity: "critical", title: "Zape indisponível", description: error.message || "O BobCRM não conseguiu consultar o Zape.", metadata: { code: error.code || "ZAPE_UNREACHABLE" } }];
  const data = result?.data || {};
  const queue = data.queue || {};
  const worker = data.worker || {};
  const storage = data.storage || {};
  const conditions = [];
  if (storage.configuredMode === "mysql" && storage.activeMode !== "mysql") conditions.push({ fingerprint: "queue_storage_fallback", type: "queue_storage", severity: "critical", title: "Fila MySQL indisponível", description: storage.fallbackReason || "O Zape ativou fallback da fila.", metadata: storage });
  if (!worker.running) conditions.push({ fingerprint: "worker_stopped", type: "worker", severity: "critical", title: "Worker da integração parado", description: "O worker responsável por entregar leads ao CRM não está ativo.", metadata: worker });
  if (worker.lastCycleError) conditions.push({ fingerprint: "worker_error", type: "worker", severity: "critical", title: "Erro no worker da integração", description: String(worker.lastCycleError).slice(0, 2000), metadata: worker });
  const failed = int(queue?.counts?.failedPermanent);
  const failedTenants = Array.isArray(data.tenants) ? data.tenants.filter((tenant) => int(tenant.failedPermanent) > 0) : [];
  if (failedTenants.length) {
    for (const tenant of failedTenants) {
      const tenantId = String(tenant.tenantId || "unknown");
      const tenantFailed = int(tenant.failedPermanent);
      conditions.push({ fingerprint: `failed_permanent:${tenantId}`, type: "failed_events", severity: tenantFailed >= 5 ? "critical" : "warning", tenantId, title: `${tenantFailed} falha(s) na conta ${tenantId}`, description: "Existem eventos desta conta que esgotaram as tentativas e precisam ser reprocessados.", metadata: { failed: tenantFailed, tenantId } });
    }
  } else if (failed > 0) conditions.push({ fingerprint: "failed_permanent", type: "failed_events", severity: failed >= 5 ? "critical" : "warning", title: `${failed} falha(s) permanente(s)`, description: "Existem eventos que esgotaram as tentativas e precisam ser reprocessados.", metadata: { failed } });
  const pendingAge = Number(queue.pendingAgeMinutes || 0);
  if (pendingAge >= 5) conditions.push({ fingerprint: "queue_backlog", type: "backlog", severity: pendingAge >= 15 ? "critical" : "warning", title: "Fila de integração atrasada", description: `O evento pendente mais antigo está há ${Math.round(pendingAge)} minuto(s) na fila.`, metadata: { pendingAgeMinutes: pendingAge, pending: int(queue?.counts?.pending), sending: int(queue?.counts?.sending) } });
  return conditions;
}

async function syncIncidents({ queryRows, execute, conditions, capturedAt }) {
  const activeFingerprints = new Set(conditions.map((condition) => condition.fingerprint));
  for (const condition of conditions) {
    const existing = (await queryRows("SELECT * FROM integration_incidents WHERE provider='zape' AND fingerprint=? AND status IN ('open','acknowledged') ORDER BY first_seen_at DESC LIMIT 1", [condition.fingerprint]))[0];
    if (existing) {
      await execute(`UPDATE integration_incidents SET severity=?, title=?, description=?, occurrences=occurrences+1,
        last_seen_at=?, metadata_json=?, updated_at=? WHERE id=?`, [condition.severity, condition.title, condition.description, capturedAt, JSON.stringify(condition.metadata || {}), capturedAt, existing.id]);
    } else {
      await execute(`INSERT INTO integration_incidents (id,provider,fingerprint,incident_type,severity,status,tenant_id,title,description,occurrences,
        first_seen_at,last_seen_at,acknowledged_at,acknowledged_by,resolved_at,resolved_by,resolution_note,metadata_json,created_at,updated_at)
        VALUES (?,'zape',?,?,?,'open',?,?,?,1,?,?,NULL,'',NULL,'','',?,?,?)`,
      [randomUUID(), condition.fingerprint, condition.type, condition.severity, String(condition.tenantId || ''), condition.title, condition.description, capturedAt, capturedAt, JSON.stringify(condition.metadata || {}), capturedAt, capturedAt]);
    }
  }
  const openRows = await queryRows("SELECT id,fingerprint FROM integration_incidents WHERE provider='zape' AND status IN ('open','acknowledged')");
  for (const row of openRows) {
    if (!activeFingerprints.has(String(row.fingerprint))) {
      await execute("UPDATE integration_incidents SET status='resolved', resolved_at=?, resolved_by='system', resolution_note='Resolvido automaticamente após normalização.', updated_at=? WHERE id=?", [capturedAt, capturedAt, row.id]);
    }
  }
}

export async function captureIntegrationHealth({ queryRows, execute, monitorUrl, monitorKey, timeoutMs = 10000 }) {
  const capturedAt = nowDate();
  let result = null;
  let error = null;
  try { result = await fetchZapeOverview({ monitorUrl, monitorKey, timeoutMs }); } catch (caught) { error = caught; }
  const data = result?.data || {};
  const health = data.health || { status: "critical", reasons: [error?.message || "Zape indisponível"] };
  const queue = data.queue || {};
  const worker = data.worker || {};
  const storage = data.storage || {};
  await execute(`INSERT INTO integration_health_snapshots (id,provider,health_status,zape_online,worker_running,worker_processing,queue_storage,
    pending_count,sending_count,delivered_count,failed_count,oldest_pending_at,last_delivered_at,latency_ms,delivery_rate,average_delivery_ms,
    reasons_json,payload_json,captured_at) VALUES (?,'zape',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    randomUUID(), health.status || "critical", error ? 0 : 1, worker.running ? 1 : 0, worker.processing ? 1 : 0,
    storage.activeMode || storage.configuredMode || "", int(queue?.counts?.pending), int(queue?.counts?.sending), int(queue?.counts?.delivered), int(queue?.counts?.failedPermanent),
    queue.oldestPendingAt || "", queue.lastDeliveredAt || "", int(result?.latencyMs), Number(data.metrics?.deliveryRate || 0), int(data.metrics?.averageDeliveryMs),
    JSON.stringify(health.reasons || []), JSON.stringify(error ? { error: error.message, code: error.code || "" } : {
      generatedAt: data.generatedAt || "", configured: Boolean(data.configured), targetBaseUrl: data.targetBaseUrl || "",
      health: data.health || {}, worker: data.worker || {}, storage: data.storage || {}, queue: data.queue || {}, metrics: data.metrics || {},
      tenantFailures: Array.isArray(data.tenants) ? data.tenants.filter((tenant) => int(tenant.failedPermanent) > 0).map((tenant) => ({ tenantId: tenant.tenantId, failedPermanent: int(tenant.failedPermanent) })) : [],
    }), capturedAt,
  ]);
  const conditions = deriveConditions(result, error);
  await syncIncidents({ queryRows, execute, conditions, capturedAt });
  return { ok: !error, capturedAt: capturedAt.toISOString(), healthStatus: health.status || "critical", conditions: conditions.length, error: error?.message || "" };
}

export async function cleanupIntegrationHistory({ execute, snapshotRetentionDays = 730, incidentRetentionDays = 1095 }) {
  const snapshotCutoff = retentionDate(snapshotRetentionDays);
  const incidentCutoff = retentionDate(incidentRetentionDays);
  const snapshotResult = await execute("DELETE FROM integration_health_snapshots WHERE captured_at < ?", [snapshotCutoff]);
  const incidentResult = await execute("DELETE FROM integration_incidents WHERE status='resolved' AND resolved_at IS NOT NULL AND resolved_at < ?", [incidentCutoff]);
  return {
    snapshotsDeleted: Number(snapshotResult?.affectedRows || snapshotResult?.[0]?.affectedRows || 0),
    incidentsDeleted: Number(incidentResult?.affectedRows || incidentResult?.[0]?.affectedRows || 0),
  };
}

export async function listIntegrationSnapshots({ queryRows, from, to, bucket = "hour" }) {
  const format = bucket === "day" ? "%Y-%m-%d" : "%Y-%m-%d %H:00";
  return queryRows(`SELECT DATE_FORMAT(captured_at, '${format}') AS bucket,
    ROUND(AVG(pending_count),2) AS pending_avg, MAX(pending_count) AS pending_max,
    ROUND(AVG(failed_count),2) AS failed_avg, MAX(failed_count) AS failed_max,
    ROUND(AVG(latency_ms),0) AS latency_avg, ROUND(AVG(delivery_rate),2) AS delivery_rate_avg,
    SUM(CASE WHEN health_status='critical' THEN 1 ELSE 0 END) AS critical_samples,
    SUM(CASE WHEN health_status='attention' THEN 1 ELSE 0 END) AS attention_samples,
    COUNT(*) AS samples
    FROM integration_health_snapshots WHERE provider='zape' AND captured_at>=? AND captured_at<=?
    GROUP BY DATE_FORMAT(captured_at, '${format}') ORDER BY bucket ASC`, [new Date(from), new Date(to)]);
}

export async function listIntegrationIncidents({ queryRows, status = "", limit = 100 }) {
  const conditions = ["provider='zape'"];
  const params = [];
  if (status) { conditions.push("status=?"); params.push(status); }
  params.push(Math.max(1, Math.min(500, Number(limit || 100))));
  const rows = await queryRows(`SELECT * FROM integration_incidents WHERE ${conditions.join(" AND ")} ORDER BY FIELD(status,'open','acknowledged','resolved'), last_seen_at DESC LIMIT ?`, params);
  return rows.map((row) => ({
    id: row.id, fingerprint: row.fingerprint, type: row.incident_type, severity: row.severity, status: row.status, tenantId: row.tenant_id,
    title: row.title, description: row.description || "", occurrences: Number(row.occurrences || 0), firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at, acknowledgedAt: row.acknowledged_at || "", acknowledgedBy: row.acknowledged_by || "",
    resolvedAt: row.resolved_at || "", resolvedBy: row.resolved_by || "", resolutionNote: row.resolution_note || "", metadata: safeJson(row.metadata_json, {}),
  }));
}

export async function updateIntegrationIncident({ queryRows, execute, id, action, user, note = "" }) {
  const existing = (await queryRows("SELECT * FROM integration_incidents WHERE id=? LIMIT 1", [id]))[0];
  if (!existing) throw Object.assign(new Error("Incidente não encontrado."), { statusCode: 404 });
  const at = nowDate();
  const userId = String(user?.id || user?.email || "admin");
  if (action === "acknowledge") {
    await execute("UPDATE integration_incidents SET status='acknowledged', acknowledged_at=?, acknowledged_by=?, updated_at=? WHERE id=? AND status='open'", [at, userId, at, id]);
  } else if (action === "resolve") {
    await execute("UPDATE integration_incidents SET status='resolved', resolved_at=?, resolved_by=?, resolution_note=?, updated_at=? WHERE id=?", [at, userId, String(note || "").slice(0, 5000), at, id]);
  } else if (action === "reopen") {
    await execute("UPDATE integration_incidents SET status='open', resolved_at=NULL, resolved_by='', resolution_note='', updated_at=? WHERE id=?", [at, id]);
  } else throw Object.assign(new Error("Ação de incidente inválida."), { statusCode: 422 });
  return (await listIntegrationIncidents({ queryRows, limit: 500 })).find((item) => item.id === id);
}

export function createIntegrationHealthCollector(options) {
  const intervalMs = Math.max(30000, Number(options.intervalMs || 60000));
  const cleanupIntervalMs = Math.max(60 * 60_000, Number(options.cleanupIntervalMs || 24 * 60 * 60_000));
  let timer = null;
  let running = false;
  let lastCleanupAt = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await captureIntegrationHealth(options);
      if (Date.now() - lastCleanupAt >= cleanupIntervalMs) {
        await cleanupIntegrationHistory(options);
        lastCleanupAt = Date.now();
      }
    } catch (error) {
      console.warn("Falha ao persistir saúde da integração:", error.message);
    } finally { running = false; }
  };
  return {
    start() { if (timer) return; void run(); timer = setInterval(() => void run(), intervalMs); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    run,
  };
}

export const integrationObservabilityInternals = { deriveConditions, syncIncidents, fetchZapeOverview };
