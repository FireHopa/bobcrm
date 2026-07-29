import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createPerformanceMonitor,
  describeSqlOperation,
  getPoolSnapshot,
  normalizeEndpointPath,
} from "./performanceMetrics.js";

test("normalizes dynamic endpoint identifiers without exposing ids", () => {
  assert.equal(normalizeEndpointPath("/api/leads/12345"), "/api/leads/:id");
  assert.equal(normalizeEndpointPath("/api/leads/550e8400-e29b-41d4-a716-446655440000/notes"), "/api/leads/:id/notes");
  assert.equal(normalizeEndpointPath("/api/leads/summary"), "/api/leads/summary");
});

test("describes SQL without logging query text or parameters", () => {
  assert.equal(describeSqlOperation("SELECT name, email FROM leads WHERE email = ?"), "SELECT leads");
  assert.equal(describeSqlOperation("UPDATE leads SET name = ? WHERE id = ?"), "UPDATE leads");
  assert.equal(describeSqlOperation("INSERT INTO audit_log (id) VALUES (?)"), "INSERT audit_log");
});

test("reads mysql2 pool internals defensively", () => {
  const pool = { pool: { _allConnections: { length: 10 }, _freeConnections: { length: 6 }, _connectionQueue: { length: 3 } } };
  assert.deepEqual(getPoolSnapshot(pool), { connections: 10, free: 6, pending: 3, limit: 0, utilizationPct: 0 });
  assert.deepEqual(getPoolSnapshot(null), { connections: 0, free: 0, pending: 0, limit: 0, utilizationPct: 0 });
});

test("attributes SQL time and query count to the active request", async () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  const monitor = createPerformanceMonitor({
    env: {
      PERF_OBSERVABILITY_ENABLED: "1",
      PERF_REQUEST_SAMPLE_RATE: "1",
      PERF_SLOW_SQL_MS: "1",
      PERF_RUNTIME_INTERVAL_MS: "300000",
    },
    logger,
    random: () => 0,
  });
  const response = new EventEmitter();
  response.statusCode = 200;

  await monitor.runRequest(
    { request: { method: "GET" }, response, pathname: "/api/leads/550e8400-e29b-41d4-a716-446655440000" },
    async () => {
      await monitor.measureSql("SELECT * FROM leads WHERE id = ?", async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return [[{ id: "secret-id" }], []];
      });
    },
  );
  response.emit("finish");
  monitor.stop();

  const requestLine = lines.find((line) => line.startsWith("[perf.request]"));
  assert.ok(requestLine);
  const payload = JSON.parse(requestLine.slice(requestLine.indexOf("{") ));
  assert.equal(payload.endpoint, "/api/leads/:id");
  assert.equal(payload.queries, 1);
  assert.ok(payload.sqlMs >= 1);
  assert.doesNotMatch(requestLine, /secret-id/);
});

test("background work does not inherit request attribution", async () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  const monitor = createPerformanceMonitor({
    env: {
      PERF_OBSERVABILITY_ENABLED: "1",
      PERF_REQUEST_SAMPLE_RATE: "1",
      PERF_SLOW_SQL_MS: "1",
      PERF_RUNTIME_INTERVAL_MS: "300000",
    },
    logger,
    random: () => 0,
  });
  const response = new EventEmitter();
  response.statusCode = 202;

  await monitor.runRequest(
    { request: { method: "POST" }, response, pathname: "/api/leads/import" },
    async () => {
      await monitor.runBackground(() => monitor.measureSql("SELECT * FROM async_jobs", async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return [[{}], []];
      }));
    },
  );
  response.emit("finish");
  monitor.stop();

  const sqlLine = lines.find((line) => line.startsWith("[perf.sql]"));
  assert.ok(sqlLine);
  const sqlPayload = JSON.parse(sqlLine.slice(sqlLine.indexOf("{")));
  assert.equal(sqlPayload.endpoint, "background");
});


test("keeps bounded endpoint/sql rankings and operational alerts", async () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  const monitor = createPerformanceMonitor({
    env: {
      PERF_OBSERVABILITY_ENABLED: "1",
      PERF_REQUEST_SAMPLE_RATE: "1",
      PERF_SLOW_SQL_MS: "1",
      PERF_ALERT_SQL_MS: "100",
      PERF_ALERT_REQUEST_MS: "100",
      PERF_ALERT_COOLDOWN_MS: "1000",
      PERF_RUNTIME_INTERVAL_MS: "300000",
    },
    logger,
    random: () => 0,
  });
  const response = new EventEmitter();
  response.statusCode = 200;
  await monitor.runRequest({ request: { method: "GET" }, response, pathname: "/api/leads" }, async () => {
    await monitor.measureSql("SELECT * FROM leads", async () => {
      await new Promise((resolve) => setTimeout(resolve, 110));
      return [[{}], []];
    });
  });
  response.emit("finish");
  const snapshot = monitor.getSnapshot();
  monitor.stop();
  assert.equal(snapshot.topEndpoints[0].name, "GET /api/leads");
  assert.equal(snapshot.topSql[0].name, "SELECT leads");
  assert.ok(snapshot.alerts.length >= 1);
  assert.ok(lines.some((line) => line.startsWith("[ops.alert]")));
});
