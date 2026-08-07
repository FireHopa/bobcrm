import { randomUUID, createHash } from "node:crypto";

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}
function envInt(name, fallback, min, max) { const n = Number.parseInt(String(process.env[name] || ""), 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function nowIso() { return new Date().toISOString(); }
function parseJson(value, fallback = {}) { if (!value) return fallback; if (typeof value === "object") return value; try { return JSON.parse(value); } catch { return fallback; } }
function semanticStage(row) {
  const explicit = String(row.semantic_key || "").trim();
  if (explicit) return explicit;
  if (row.stage_type === "won") return "won";
  if (row.stage_type === "lost") return "lost";
  const name = String(row.stage_name || row.status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/proposta|orcamento/.test(name)) return "proposal";
  if (/reuniao|diagnostico|agend/.test(name)) return "meeting";
  if (/qualific/.test(name)) return "qualified";
  if (/contato|resposta|atendimento/.test(name)) return "contacted";
  if (/negocia/.test(name)) return "negotiation";
  return "new";
}
function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value || "").replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
function entityVersion(row) {
  const timestamp = Date.parse(String(row.updated_at || row.created_at || ""));
  if (Number.isFinite(timestamp)) return Math.max(1, timestamp);
  return Number.parseInt(createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 12), 16);
}
function retryDelay(attempt) { return Math.min(6 * 60 * 60_000, Math.max(10_000, 10_000 * (2 ** Math.max(0, attempt - 1)))); }

export function createZapeBidirectionalSyncRuntime({ queryRows, execute, logger = console }) {
  const config = {
    enabled: envBool("ZAPE_REVERSE_SYNC_ENABLED", false),
    baseUrl: String(process.env.ZAPE_REVERSE_SYNC_URL || process.env.ZAPE_MONITOR_URL || "").trim().replace(/\/+$/, ""),
    key: String(process.env.ZAPE_REVERSE_SYNC_KEY || "").trim(),
    scanIntervalMs: envInt("ZAPE_REVERSE_SYNC_SCAN_INTERVAL_MS", 10_000, 2_000, 3_600_000),
    workerIntervalMs: envInt("ZAPE_REVERSE_SYNC_WORKER_INTERVAL_MS", 5_000, 1_000, 300_000),
    timeoutMs: envInt("ZAPE_REVERSE_SYNC_TIMEOUT_MS", 10_000, 1_000, 120_000),
    maxAttempts: envInt("ZAPE_REVERSE_SYNC_MAX_ATTEMPTS", 8, 1, 30),
    batchSize: envInt("ZAPE_REVERSE_SYNC_BATCH_SIZE", 100, 1, 1000),
    staleSendingMs: envInt("ZAPE_REVERSE_SYNC_SENDING_STALE_MS", 300_000, 60_000, 86_400_000),
    publicCrmUrl: String(process.env.CRM_PUBLIC_URL || process.env.CORS_ORIGIN || "").trim().replace(/\/+$/, ""),
  };
  let scanTimer = null, workerTimer = null, scanning = false, working = false, stopped = false;
  const telemetry = { running: false, lastScanAt: "", lastScanCount: 0, lastDeliveryAt: "", lastError: "", delivered: 0, failed: 0 };

  async function getCursor() {
    const rows = await queryRows("SELECT state_value FROM zape_reverse_sync_state WHERE state_key='lead_scan_cursor' LIMIT 1");
    const value = parseJson(rows[0]?.state_value, {});
    return { updatedAt: String(value.updatedAt || ""), leadId: String(value.leadId || "") };
  }
  async function saveCursor(updatedAt, leadId) {
    await execute(`INSERT INTO zape_reverse_sync_state (state_key,state_value,updated_at) VALUES ('lead_scan_cursor',?,NOW(3))
      ON DUPLICATE KEY UPDATE state_value=VALUES(state_value),updated_at=VALUES(updated_at)`, [JSON.stringify({ updatedAt, leadId })]);
  }
  async function buildSnapshot(row) {
    const semantic = semanticStage(row);
    const version = entityVersion(row);
    const customFields = parseJson(row.custom_fields, {});
    const tags = Array.isArray(customFields?.tags) ? customFields.tags : [];
    const expectedValue = Number(row.expected_value || 0) || numericValue(row.estimated_budget);
    const closedValue = Number(row.closed_value || 0) || (semantic === "won" ? expectedValue : 0);
    const occurredAt = String(row.updated_at || nowIso());
    return {
      eventType: "crm.lead.snapshot",
      eventKey: `crm.lead.snapshot:${row.id}:${row.tenant_id}:${version}`.slice(0, 255),
      leadId: String(row.id),
      zapeLeadId: String(row.external_lead_id || ""),
      tenantId: String(row.tenant_id || ""),
      occurredAt,
      entityVersion: version,
      data: {
        leadId: String(row.id), zapeLeadId: String(row.external_lead_id || ""),
        name: String(row.name || ""), email: String(row.email || ""), phone: String(row.phone || ""), company: String(row.company || ""),
        responsibleUserId: String(row.responsible_user_id || ""), responsible: String(row.responsible || ""),
        pipelineId: String(row.pipeline_id || ""), pipelineName: String(row.pipeline_name || ""),
        stageId: String(row.pipeline_stage_id || ""), stageName: String(row.stage_name || ""), semanticStage: semantic,
        status: String(row.status || ""), isLost: Boolean(Number(row.is_lost || 0) || semantic === "lost"),
        temperature: String(row.temperature || ""), priority: String(customFields?.priority || customFields?.prioridade || ""), tags,
        expectedValue, closedValue, wonAt: row.won_at ? new Date(row.won_at).toISOString() : "", lostAt: row.lost_at ? new Date(row.lost_at).toISOString() : "",
        updatedAt: occurredAt,
        bobcrmUrl: config.publicCrmUrl ? `${config.publicCrmUrl}/?lead=${encodeURIComponent(String(row.id))}` : "",
      },
    };
  }
  async function materializeOutcome(row) {
    const semantic = semanticStage(row);
    const expected = Number(row.expected_value || 0) || numericValue(row.estimated_budget);
    if (semantic === "won" && !row.won_at) {
      await execute("UPDATE leads SET won_at=NOW(3), lost_at=NULL, closed_value=IF(closed_value>0,closed_value,?) WHERE id=?", [expected, row.id]);
      row.won_at = new Date(); row.closed_value = Number(row.closed_value || expected); row.lost_at = null;
    } else if (semantic === "lost" && !row.lost_at) {
      await execute("UPDATE leads SET lost_at=NOW(3), won_at=NULL WHERE id=?", [row.id]);
      row.lost_at = new Date(); row.won_at = null;
    } else if (!["won", "lost"].includes(semantic) && (row.won_at || row.lost_at)) {
      await execute("UPDATE leads SET won_at=NULL, lost_at=NULL WHERE id=?", [row.id]);
      row.won_at = null; row.lost_at = null;
    }
  }
  async function scan() {
    if (!config.enabled || scanning || stopped) return;
    scanning = true;
    try {
      const cursor = await getCursor();
      const params = [];
      let cursorClause = "";
      const syncTimestampSql = "COALESCE(NULLIF(l.updated_at,''),NULLIF(l.created_at,''),'1970-01-01T00:00:00.000Z')";
      if (cursor.updatedAt) {
        cursorClause = `AND (${syncTimestampSql} > ? OR (${syncTimestampSql} = ? AND l.id > ?))`;
        params.push(cursor.updatedAt, cursor.updatedAt, cursor.leadId || "");
      }
      params.push(config.batchSize);
      const rows = await queryRows(`SELECT l.*,${syncTimestampSql} AS sync_updated_at,leo.tenant_id,leo.external_lead_id,kp.name AS pipeline_name,ks.name AS stage_name,ks.stage_type,ks.semantic_key
        FROM leads l
        JOIN lead_external_origins leo ON leo.lead_id=l.id AND leo.provider='zape'
        LEFT JOIN kanban_pipelines kp ON kp.id=l.pipeline_id
        LEFT JOIN kanban_stages ks ON ks.id=l.pipeline_stage_id
        WHERE l.deleted_at='' AND leo.tenant_id<>'' ${cursorClause}
        ORDER BY sync_updated_at ASC,l.id ASC LIMIT ?`, params);
      let maxUpdated = cursor.updatedAt;
      let maxLeadId = cursor.leadId;
      for (const row of rows) {
        await materializeOutcome(row);
        const payload = await buildSnapshot(row);
        await execute(`INSERT IGNORE INTO zape_reverse_sync_outbox
          (id,event_key,event_type,lead_id,tenant_id,entity_version,payload_json,status,attempts,next_attempt_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'pending',0,NOW(3),NOW(3),NOW(3))`,
          [randomUUID(), payload.eventKey, payload.eventType, payload.leadId, payload.tenantId, payload.entityVersion, JSON.stringify(payload)]);
        const parsedUpdatedAt = new Date(row.sync_updated_at || row.updated_at || row.created_at || 0);
        const rowUpdatedAt = Number.isNaN(parsedUpdatedAt.getTime()) ? "1970-01-01T00:00:00.000Z" : parsedUpdatedAt.toISOString();
        const rowLeadId = String(row.id || "");
        if (!maxUpdated || rowUpdatedAt > maxUpdated || (rowUpdatedAt === maxUpdated && rowLeadId > maxLeadId)) {
          maxUpdated = rowUpdatedAt;
          maxLeadId = rowLeadId;
        }
      }
      if (maxUpdated) await saveCursor(maxUpdated, maxLeadId);
      telemetry.lastScanAt = nowIso(); telemetry.lastScanCount = rows.length; telemetry.lastError = "";
    } catch (error) { telemetry.lastError = String(error?.message || error); logger.warn("Falha no scanner BobCRM → Zape:", telemetry.lastError); }
    finally { scanning = false; }
  }
  async function postEvent(payload) {
    if (!config.baseUrl || !config.key) throw Object.assign(new Error("Configure ZAPE_REVERSE_SYNC_URL e ZAPE_REVERSE_SYNC_KEY."), { permanent: true });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}/api/integrations/bobcrm/events`, { method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1000) }; }
      if (!response.ok) { const error = new Error(data.error || data.message || `Zape respondeu HTTP ${response.status}.`); error.statusCode = response.status; error.permanent = [400,401,403,404,422].includes(response.status); error.response = data; throw error; }
      return { data, status: response.status };
    } finally { clearTimeout(timer); }
  }
  async function work() {
    if (!config.enabled || working || stopped) return;
    working = true;
    try {
      const staleBefore = new Date(Date.now() - config.staleSendingMs);
      await execute(`UPDATE zape_reverse_sync_outbox SET status='failed',next_attempt_at=NOW(3),last_error='Processamento interrompido; evento recuperado automaticamente.',updated_at=NOW(3)
        WHERE status='sending' AND updated_at<?`, [staleBefore]);
      const rows = await queryRows(`SELECT * FROM zape_reverse_sync_outbox WHERE status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW(3)) ORDER BY created_at ASC LIMIT ?`, [Math.min(50, config.batchSize)]);
      for (const row of rows) {
        const claimed = await execute("UPDATE zape_reverse_sync_outbox SET status='sending',last_attempt_at=NOW(3),updated_at=NOW(3) WHERE id=? AND status IN ('pending','failed')", [row.id]);
        if (!Number(claimed.affectedRows || 0)) continue;
        const attempts = Number(row.attempts || 0) + 1;
        try {
          const result = await postEvent(parseJson(row.payload_json, {}));
          await execute("UPDATE zape_reverse_sync_outbox SET status='delivered',attempts=?,last_http_status=?,last_error='',response_json=?,delivered_at=NOW(3),updated_at=NOW(3) WHERE id=?", [attempts, result.status, JSON.stringify(result.data), row.id]);
          telemetry.lastDeliveryAt = nowIso(); telemetry.delivered += 1; telemetry.lastError = "";
        } catch (error) {
          const permanent = Boolean(error.permanent || attempts >= config.maxAttempts);
          const next = new Date(Date.now() + retryDelay(attempts));
          await execute("UPDATE zape_reverse_sync_outbox SET status=?,attempts=?,last_http_status=?,last_error=?,response_json=?,next_attempt_at=?,updated_at=NOW(3) WHERE id=?", [permanent ? "failed_permanent" : "failed", attempts, Number(error.statusCode || 0), String(error.message || error).slice(0, 4000), JSON.stringify(error.response || null), next, row.id]);
          telemetry.failed += 1; telemetry.lastError = String(error.message || error);
        }
      }
    } catch (error) { telemetry.lastError = String(error?.message || error); logger.warn("Falha no worker BobCRM → Zape:", telemetry.lastError); }
    finally { working = false; }
  }
  return {
    config, telemetry,
    start() {
      if (!config.enabled || telemetry.running) return;
      stopped = false; telemetry.running = true;
      void scan(); void work();
      scanTimer = setInterval(() => void scan(), config.scanIntervalMs); scanTimer.unref?.();
      workerTimer = setInterval(() => void work(), config.workerIntervalMs); workerTimer.unref?.();
    },
    async stop() { stopped = true; telemetry.running = false; if (scanTimer) clearInterval(scanTimer); if (workerTimer) clearInterval(workerTimer); scanTimer = null; workerTimer = null; },
    scanNow: scan, workNow: work,
  };
}
