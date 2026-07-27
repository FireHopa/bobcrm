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
  return {
    connections: count(internal?._allConnections),
    free: count(internal?._freeConnections),
    pending: count(internal?._connectionQueue),
  };
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
  const eventLoop = enabled ? monitorEventLoopDelay({ resolution: 20 }) : null;
  eventLoop?.enable();
  let runtimeTimer = null;
  let previousCpu = process.cpuUsage();

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

      if (durationMs >= slowSqlMs || error) {
        const severity = error ? "error" : durationMs >= 1000 ? "critical" : durationMs >= 500 ? "very_slow" : "slow";
        logJson(logger, "[perf.sql]", {
          type: "sql",
          level: error ? "error" : durationMs >= 1000 ? "warn" : "log",
          severity,
          operation: describeSqlOperation(sql),
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

      logJson(logger, "[perf.runtime]", {
        type: "runtime",
        level: "log",
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
        cpuPct: Number(cpuPct.toFixed(1)),
        eventLoopMeanMs: Number(eventLoopMeanMs.toFixed(2)),
        eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(2)),
        eventLoopMaxMs: Number(eventLoopMaxMs.toFixed(2)),
        pool,
      });
      eventLoop?.reset();
    }, runtimeIntervalMs);
    runtimeTimer.unref?.();
  }

  function stop() {
    if (runtimeTimer) clearInterval(runtimeTimer);
    runtimeTimer = null;
    eventLoop?.disable();
  }

  return {
    enabled,
    measureSql,
    runRequest,
    runBackground,
    startRuntimeSampler,
    stop,
    getPoolSnapshot,
  };
}
