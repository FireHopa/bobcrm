import { randomUUID } from "node:crypto";

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isoBeforeDays(days, now = new Date()) {
  return new Date(now.getTime() - Math.max(0, Number(days || 0)) * 86400000).toISOString();
}

function normalizeTableMetric(row = {}) {
  const dataBytes = Number(row.data_bytes || 0);
  const indexBytes = Number(row.index_bytes || 0);
  return {
    table: String(row.table_name || ""),
    estimatedRows: Number(row.table_rows || 0),
    dataMb: Number((dataBytes / 1024 / 1024).toFixed(1)),
    indexMb: Number((indexBytes / 1024 / 1024).toFixed(1)),
    totalMb: Number(((dataBytes + indexBytes) / 1024 / 1024).toFixed(1)),
  };
}

export function resolveOperationalSettings(env = process.env) {
  return {
    snapshotIntervalMs: clampInteger(env.OPS_SNAPSHOT_INTERVAL_MS, 5 * 60 * 1000, 60_000, 60 * 60 * 1000),
    maintenanceIntervalMs: clampInteger(env.OPS_MAINTENANCE_INTERVAL_MS, 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    auditRetentionDays: clampInteger(env.OPS_AUDIT_RETENTION_DAYS, 730, 90, 3650),
    integrationRetentionDays: clampInteger(env.OPS_INTEGRATION_RETENTION_DAYS, 365, 30, 3650),
    mutationReceiptRetentionDays: clampInteger(env.OPS_MUTATION_RECEIPT_RETENTION_DAYS, 30, 7, 365),
    snapshotRetentionDays: clampInteger(env.OPS_SNAPSHOT_RETENTION_DAYS, 14, 2, 90),
    cleanupBatchSize: clampInteger(env.OPS_CLEANUP_BATCH_SIZE, 1000, 100, 5000),
    staleJobMs: clampInteger(env.OPS_STALE_JOB_MS, 5 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
  };
}

export async function buildOperationalDatabaseSnapshot({ queryRows, databaseName, staleJobMs = 300000, now = new Date() }) {
  const tables = ["leads", "tasks", "audit_log", "integration_events", "async_jobs", "mutation_receipts"];
  const placeholders = tables.map(() => "?").join(", ");
  const [tableRows, jobRows, staleRows, integrationRows] = await Promise.all([
    queryRows(
      `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`,
      [databaseName, ...tables],
    ),
    queryRows("SELECT status, COUNT(*) AS total FROM async_jobs GROUP BY status"),
    queryRows(
      "SELECT COUNT(*) AS total FROM async_jobs WHERE status = 'running' AND heartbeat_at != '' AND heartbeat_at < ?",
      [new Date(now.getTime() - staleJobMs).toISOString()],
    ),
    queryRows(`SELECT
      (SELECT COUNT(*) FROM integration_events WHERE status = 'failed') AS failed,
      (SELECT COUNT(*) FROM integration_events WHERE status = 'processing') AS processing`),
  ]);

  const jobs = Object.fromEntries(jobRows.map((row) => [String(row.status || "unknown"), Number(row.total || 0)]));
  const integrations = { failed: Number(integrationRows[0]?.failed || 0), processing: Number(integrationRows[0]?.processing || 0) };
  return {
    capturedAt: now.toISOString(),
    tables: tableRows.map(normalizeTableMetric).sort((a, b) => b.totalMb - a.totalMb),
    jobs,
    staleRunningJobs: Number(staleRows[0]?.total || 0),
    integrations,
  };
}

async function deleteBatch(execute, table, column, cutoff, limit, extraWhere = "") {
  const result = await execute(`DELETE FROM ${table} WHERE ${column} != '' AND ${column} < ? ${extraWhere} ORDER BY ${column} ASC LIMIT ?`, [cutoff, limit]);
  return Number(result?.affectedRows || 0);
}

export async function cleanupOperationalHistory({ execute, settings, now = new Date() }) {
  const limit = settings.cleanupBatchSize;
  const deleted = {};
  deleted.auditLog = await deleteBatch(execute, "audit_log", "created_at", isoBeforeDays(settings.auditRetentionDays, now), limit);
  deleted.integrationEvents = await deleteBatch(execute, "integration_events", "updated_at", isoBeforeDays(settings.integrationRetentionDays, now), limit, "AND status = 'completed'");
  deleted.mutationReceipts = await deleteBatch(execute, "mutation_receipts", "updated_at", isoBeforeDays(settings.mutationReceiptRetentionDays, now), limit, "AND status = 'completed'");
  const snapshotResult = await execute(
    "DELETE FROM operational_health_snapshots WHERE captured_at < ? ORDER BY captured_at ASC LIMIT ?",
    [new Date(now.getTime() - settings.snapshotRetentionDays * 86400000), limit],
  );
  deleted.healthSnapshots = Number(snapshotResult?.affectedRows || 0);
  return { deleted, capturedAt: now.toISOString() };
}

export async function persistOperationalSnapshot({ execute, processRole, performanceSnapshot, databaseSnapshot, activeRequests = 0, activeJobs = 0, now = new Date() }) {
  const runtime = performanceSnapshot?.runtime || {};
  const pool = runtime.pool || {};
  const warnings = [
    ...(performanceSnapshot?.alerts || []).slice(0, 10),
    ...(databaseSnapshot?.staleRunningJobs ? [{ type: "stale_jobs", severity: "critical", value: databaseSnapshot.staleRunningJobs }] : []),
  ];
  await execute(
    `INSERT INTO operational_health_snapshots
      (id, process_role, status, rss_mb, heap_used_mb, cpu_pct, event_loop_p95_ms,
       pool_connections, pool_free, pool_pending, pool_limit, active_requests, active_jobs,
       warnings_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      String(processRole || "unknown"),
      warnings.some((item) => item.severity === "critical") ? "degraded" : "ok",
      Number(runtime.rssMb || 0),
      Number(runtime.heapUsedMb || 0),
      Number(runtime.cpuPct || 0),
      Number(runtime.eventLoopP95Ms || 0),
      Number(pool.connections || 0),
      Number(pool.free || 0),
      Number(pool.pending || 0),
      Number(pool.limit || 0),
      Number(activeRequests || 0),
      Number(activeJobs || 0),
      JSON.stringify(warnings),
      now,
    ],
  );
}

export function createOperationalRuntime({
  settings,
  queryRows,
  execute,
  databaseName,
  processRole,
  performanceMonitor,
  getActiveRequests = () => 0,
  getActiveJobs = () => 0,
  logger = console,
}) {
  let snapshotTimer = null;
  let maintenanceTimer = null;
  let lastDatabaseSnapshot = null;
  let lastMaintenance = null;
  let captureRunning = false;
  let maintenanceRunning = false;

  async function capture() {
    if (captureRunning) return lastDatabaseSnapshot;
    captureRunning = true;
    try {
      lastDatabaseSnapshot = await buildOperationalDatabaseSnapshot({
        queryRows,
        databaseName,
        staleJobMs: settings.staleJobMs,
      });
      await persistOperationalSnapshot({
        execute,
        processRole,
        performanceSnapshot: performanceMonitor.getSnapshot(),
        databaseSnapshot: lastDatabaseSnapshot,
        activeRequests: getActiveRequests(),
        activeJobs: getActiveJobs(),
      });
      return lastDatabaseSnapshot;
    } catch (error) {
      logger.warn?.("Falha ao registrar snapshot operacional", { code: error?.code || "OPS_SNAPSHOT_FAILED" });
      return lastDatabaseSnapshot;
    } finally {
      captureRunning = false;
    }
  }

  async function runMaintenance() {
    if (maintenanceRunning) return lastMaintenance;
    maintenanceRunning = true;
    try {
      lastMaintenance = await cleanupOperationalHistory({ execute, settings });
      const totalDeleted = Object.values(lastMaintenance.deleted).reduce((total, value) => total + Number(value || 0), 0);
      if (totalDeleted > 0) logger.log?.(`[ops.maintenance] ${JSON.stringify({ type: "retention", level: "log", ...lastMaintenance })}`);
      return lastMaintenance;
    } catch (error) {
      logger.warn?.("Falha na manutenção operacional", { code: error?.code || "OPS_MAINTENANCE_FAILED" });
      return lastMaintenance;
    } finally {
      maintenanceRunning = false;
    }
  }

  function start({ runMaintenanceHere = false } = {}) {
    if (!snapshotTimer) {
      snapshotTimer = setInterval(() => void performanceMonitor.runBackground(capture), settings.snapshotIntervalMs);
      snapshotTimer.unref?.();
      void performanceMonitor.runBackground(capture);
    }
    if (runMaintenanceHere && !maintenanceTimer) {
      maintenanceTimer = setInterval(() => void performanceMonitor.runBackground(runMaintenance), settings.maintenanceIntervalMs);
      maintenanceTimer.unref?.();
      void performanceMonitor.runBackground(runMaintenance);
    }
  }

  function stop() {
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    snapshotTimer = null;
    maintenanceTimer = null;
  }


  async function getHistory(limit = 48) {
    const boundedLimit = Math.max(1, Math.min(200, Number(limit || 48)));
    const rows = await queryRows(
      `SELECT process_role, status, rss_mb, heap_used_mb, cpu_pct, event_loop_p95_ms,
              pool_connections, pool_free, pool_pending, pool_limit, active_requests, active_jobs, warnings_json, captured_at
       FROM operational_health_snapshots ORDER BY captured_at DESC LIMIT ?`,
      [boundedLimit],
    );
    return rows.map((row) => { let warnings = row.warnings_json || []; if (typeof warnings === "string") { try { warnings = JSON.parse(warnings || "[]"); } catch { warnings = []; } } return { ...row, warnings }; });
  }

  function getSnapshot() {
    return {
      performance: performanceMonitor.getSnapshot(),
      database: lastDatabaseSnapshot,
      maintenance: lastMaintenance,
      retention: {
        auditDays: settings.auditRetentionDays,
        integrationDays: settings.integrationRetentionDays,
        mutationReceiptDays: settings.mutationReceiptRetentionDays,
        snapshotDays: settings.snapshotRetentionDays,
        cleanupBatchSize: settings.cleanupBatchSize,
      },
    };
  }

  return { start, stop, capture, runMaintenance, getSnapshot, getHistory };
}
