import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const requestStorage = new AsyncLocalStorage();

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

export function normalizeEndpointPath(pathname = "/") {
  const normalized = String(pathname || "/").split("?")[0] || "/";
  const segments = normalized.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
    if (/^[A-Za-z0-9_-]{20,}$/.test(segment)) return ":id";
    return segment;
  });
  return segments.join("/") || "/";
}

export function describeSqlOperation(sql = "") {
  const compact = String(sql || "").replace(/\s+/g, " ").trim();
  const verb = compact.match(/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|WITH)\b/i)?.[1]?.toUpperCase() || "SQL";
  const table = compact.match(/\b(?:FROM|INTO|UPDATE|TABLE|JOIN)\s+`?([A-Za-z0-9_]+)/i)?.[1] || "query";
  return `${verb} ${table}`;
}

export function getPoolSnapshot(pool) {
  const internal = pool?.pool || pool;
  const count = (value) => {
    if (!value) return 0;
    if (Number.isFinite(value.length)) return Number(value.length);
    if (Number.isFinite(value.size)) return Number(value.size);
    return 0;
  };
  const connections = count(internal?._allConnections);
  const free = count(internal?._freeConnections);
  const pending = count(internal?._connectionQueue);
  const limit = Number(internal?.config?.connectionLimit || pool?.config?.connectionLimit || 0);
  const busy = Math.max(0, connections - free);
  return {
    connections,
    free,
    pending,
    limit,
    utilizationPct: limit > 0 ? Number(((busy / limit) * 100).toFixed(1)) : 0,
  };
}

function percentile(values = [], pct = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[index] || 0;
}

function recordRollingStat(map, key, durationMs, { error = false, sqlMs = 0, maxSamples = 60, maxKeys = 500 } = {}) {
  if (!map.has(key) && map.size >= maxKeys) map.delete(map.keys().next().value);
  const current = map.get(key) || { count: 0, errors: 0, totalMs: 0, totalSqlMs: 0, maxMs: 0, samples: [] };
  current.count += 1;
  current.errors += error ? 1 : 0;
  current.totalMs += durationMs;
  current.totalSqlMs += sqlMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.samples.push(durationMs);
  if (current.samples.length > maxSamples) current.samples.splice(0, current.samples.length - maxSamples);
  map.set(key, current);
}

function summarizeStats(map, limit = 10) {
  return [...map.entries()].map(([name, stat]) => ({
    name,
    count: stat.count,
    errors: stat.errors,
    avgMs: Number((stat.totalMs / Math.max(1, stat.count)).toFixed(1)),
    p95Ms: Number(percentile(stat.samples, 0.95).toFixed(1)),
    maxMs: Number(stat.maxMs.toFixed(1)),
    avgSqlMs: Number((stat.totalSqlMs / Math.max(1, stat.count)).toFixed(1)),
  })).sort((a, b) => b.p95Ms - a.p95Ms || b.maxMs - a.maxMs).slice(0, limit);
}

function rowCountFromResult(result) {
  const first = Array.isArray(result) ? result[0] : result;
  if (Array.isArray(first)) return first.length;
  if (first && Number.isFinite(Number(first.affectedRows))) return Number(first.affectedRows);
  return 0;
}

function logJson(logger, prefix, payload) {
  const method = payload.level === "error" ? "error" : payload.level === "warn" ? "warn" : "log";
  logger?.[method]?.(`${prefix} ${JSON.stringify(payload)}`);
}

export function createPerformanceMonitor({ env = process.env, logger = console, random = Math.random } = {}) {
  const enabled = envBoolean(env.PERF_OBSERVABILITY_ENABLED, true);
  const sampleRate = boundedNumber(env.PERF_REQUEST_SAMPLE_RATE, 1, 0, 1);
  const slowSqlMs = boundedNumber(env.PERF_SLOW_SQL_MS, 200, 1, 60_000);
  const runtimeIntervalMs = boundedNumber(env.PERF_RUNTIME_INTERVAL_MS, 30_000, 5_000, 300_000);
  const logAllRequests = envBoolean(env.PERF_LOG_ALL_REQUESTS, true);
  const requestWarnMs = boundedNumber(env.PERF_REQUEST_WARN_MS, 800, 1, 300_000);
  const requestAlertMs = boundedNumber(env.PERF_ALERT_REQUEST_MS, 5000, 100, 300_000);
  const sqlAlertMs = boundedNumber(env.PERF_ALERT_SQL_MS, 2000, 100, 300_000);
  const poolAlertPct = boundedNumber(env.PERF_ALERT_POOL_UTIL_PCT, 75, 10, 100);
  const eventLoopAlertMs = boundedNumber(env.PERF_ALERT_EVENT_LOOP_P95_MS, 100, 10, 5000);
  const rssAlertMb = boundedNumber(env.PERF_ALERT_RSS_MB, 800, 64, 65536);
  const alertCooldownMs = boundedNumber(env.PERF_ALERT_COOLDOWN_MS, 60000, 1000, 3600000);
  const alertActiveMs = boundedNumber(env.PERF_ALERT_ACTIVE_MS, 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
  const statsLimit = boundedNumber(env.PERF_STATS_LIMIT, 20, 5, 100);
  const eventLoop = enabled ? monitorEventLoopDelay({ resolution: 20 }) : null;
  eventLoop?.enable();
  let runtimeTimer = null;
  let previousCpu = process.cpuUsage();
  const endpointStats = new Map();
  const sqlStats = new Map();
  const alertLastSeen = new Map();
  const recentAlerts = [];
  let lastRuntime = null;

  function emitAlert({ key, type, severity = "warn", message, value = 0 }) {
    const now = Date.now();
    const previous = alertLastSeen.get(key) || 0;
    if (now - previous < alertCooldownMs) return;
    alertLastSeen.set(key, now);
    const alert = { type, severity, message, value, at: new Date(now).toISOString() };
    recentAlerts.unshift(alert);
    if (recentAlerts.length > 50) recentAlerts.length = 50;
    logJson(logger, "[ops.alert]", { ...alert, level: severity === "critical" ? "warn" : "log" });
  }

  function currentRequest() {
    return requestStorage.getStore() || null;
  }

  async function measureSql(sql, operation) {
    if (!enabled) return operation();
    const started = performance.now();
    let result;
    let error;
    try {
      result = await operation();
      return result;
    } catch (caughtError) {
      error = caughtError;
      throw caughtError;
    } finally {
      const durationMs = performance.now() - started;
      const context = currentRequest();
      if (context) {
        context.sqlMs += durationMs;
        context.queryCount += 1;
        context.maxSqlMs = Math.max(context.maxSqlMs, durationMs);
      }
      const sqlOperation = describeSqlOperation(sql);
      recordRollingStat(sqlStats, sqlOperation, durationMs, { error: Boolean(error) });
      if (durationMs >= sqlAlertMs || error) {
        emitAlert({
          key: `sql:${sqlOperation}:${error?.code || "slow"}`,
          type: "sql",
          severity: error || durationMs >= sqlAlertMs * 2 ? "critical" : "warn",
          message: error ? `Falha em ${sqlOperation}` : `${sqlOperation} excedeu o limite operacional`,
          value: Number(durationMs.toFixed(1)),
        });
      }

      if (durationMs >= slowSqlMs || error) {
        const severity = error ? "error" : durationMs >= 1000 ? "critical" : durationMs >= 500 ? "very_slow" : "slow";
        logJson(logger, "[perf.sql]", {
          type: "sql",
          level: error ? "error" : durationMs >= 1000 ? "warn" : "log",
          severity,
          operation: sqlOperation,
          durationMs: Number(durationMs.toFixed(1)),
          rows: rowCountFromResult(result),
          endpoint: context?.endpoint || "background",
          method: context?.method || "BACKGROUND",
          requestId: context?.requestId || "",
          errorCode: error?.code || "",
        });
      }
    }
  }

  function runRequest({ request, response, pathname }, operation) {
    if (!enabled || random() > sampleRate) return operation();

    const started = performance.now();
    const memoryStart = process.memoryUsage();
    const cpuStart = process.cpuUsage();
    const context = {
      requestId: randomUUID(),
      method: String(request?.method || "GET").toUpperCase(),
      endpoint: normalizeEndpointPath(pathname),
      sqlMs: 0,
      queryCount: 0,
      maxSqlMs: 0,
      finalized: false,
    };

    const finalize = (reason) => {
      if (context.finalized) return;
      context.finalized = true;
      const totalMs = performance.now() - started;
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(cpuStart);
      const statusCode = Number(response?.statusCode || 0);
      const endpointKey = `${context.method} ${context.endpoint}`;
      recordRollingStat(endpointStats, endpointKey, totalMs, { error: statusCode >= 500, sqlMs: context.sqlMs });
      if (totalMs >= requestAlertMs || statusCode >= 500) {
        emitAlert({
          key: `request:${endpointKey}:${statusCode >= 500 ? "5xx" : "slow"}`,
          type: "request",
          severity: statusCode >= 500 || totalMs >= requestAlertMs * 2 ? "critical" : "warn",
          message: statusCode >= 500 ? `${endpointKey} respondeu ${statusCode}` : `${endpointKey} excedeu o limite operacional`,
          value: Number(totalMs.toFixed(1)),
        });
      }
      if (!logAllRequests && totalMs < requestWarnMs && statusCode < 500) return;

      logJson(logger, "[perf.request]", {
        type: "request",
        level: statusCode >= 500 || totalMs >= requestWarnMs ? "warn" : "log",
        requestId: context.requestId,
        method: context.method,
        endpoint: context.endpoint,
        status: statusCode,
        reason,
        totalMs: Number(totalMs.toFixed(1)),
        sqlMs: Number(context.sqlMs.toFixed(1)),
        sqlSharePct: totalMs > 0 ? Number(((context.sqlMs / totalMs) * 100).toFixed(1)) : 0,
        queries: context.queryCount,
        maxSqlMs: Number(context.maxSqlMs.toFixed(1)),
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        heapDeltaKb: Number(((memory.heapUsed - memoryStart.heapUsed) / 1024).toFixed(1)),
        cpuUserMs: Number((cpu.user / 1000).toFixed(1)),
        cpuSystemMs: Number((cpu.system / 1000).toFixed(1)),
      });
    };

    response?.once?.("finish", () => finalize("finish"));
    response?.once?.("close", () => finalize("close"));
    return requestStorage.run(context, operation);
  }

  function runBackground(operation) {
    return requestStorage.run(null, operation);
  }

  function startRuntimeSampler(getPool) {
    if (!enabled || runtimeTimer) return;
    runtimeTimer = setInterval(() => {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(previousCpu);
      previousCpu = process.cpuUsage();
      const pool = getPoolSnapshot(typeof getPool === "function" ? getPool() : getPool);
      const elapsedSeconds = runtimeIntervalMs / 1000;
      const cpuPct = elapsedSeconds > 0
        ? ((cpu.user + cpu.system) / 1_000_000 / elapsedSeconds) * 100
        : 0;
      const eventLoopMeanMs = eventLoop && Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1e6 : 0;
      const eventLoopP95Ms = eventLoop ? eventLoop.percentile(95) / 1e6 : 0;
      const eventLoopMaxMs = eventLoop && Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : 0;

      lastRuntime = {
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
        cpuPct: Number(cpuPct.toFixed(1)),
        eventLoopMeanMs: Number(eventLoopMeanMs.toFixed(2)),
        eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(2)),
        eventLoopMaxMs: Number(eventLoopMaxMs.toFixed(2)),
        pool,
        capturedAt: new Date().toISOString(),
      };
      if (pool.pending > 0 || pool.utilizationPct >= poolAlertPct) emitAlert({ key: "runtime:pool", type: "pool", severity: pool.pending > 0 || pool.utilizationPct >= 95 ? "critical" : "warn", message: "Pool MySQL próximo da saturação", value: pool.utilizationPct });
      if (eventLoopP95Ms >= eventLoopAlertMs) emitAlert({ key: "runtime:event-loop", type: "event_loop", severity: eventLoopP95Ms >= eventLoopAlertMs * 2 ? "critical" : "warn", message: "Event loop com latência elevada", value: Number(eventLoopP95Ms.toFixed(1)) });
      if (lastRuntime.rssMb >= rssAlertMb) emitAlert({ key: "runtime:rss", type: "memory", severity: lastRuntime.rssMb >= rssAlertMb * 1.15 ? "critical" : "warn", message: "Memória RSS acima do limite de observação", value: lastRuntime.rssMb });
      logJson(logger, "[perf.runtime]", { type: "runtime", level: "log", ...lastRuntime });
      eventLoop?.reset();
    }, runtimeIntervalMs);
    runtimeTimer.unref?.();
  }

  function stop() {
    if (runtimeTimer) clearInterval(runtimeTimer);
    runtimeTimer = null;
    eventLoop?.disable();
  }

  function getSnapshot() {
    return {
      enabled,
      runtime: lastRuntime,
      topEndpoints: summarizeStats(endpointStats, statsLimit),
      topSql: summarizeStats(sqlStats, statsLimit),
      alerts: recentAlerts.filter((alert) => Date.now() - Date.parse(alert.at) <= alertActiveMs).slice(0, statsLimit),
    };
  }

  return {
    enabled,
    currentRequest,
    measureSql,
    runRequest,
    runBackground,
    startRuntimeSampler,
    stop,
    getPoolSnapshot,
    getSnapshot,
  };
}
