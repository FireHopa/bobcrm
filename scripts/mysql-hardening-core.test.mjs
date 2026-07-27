import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHardeningRecommendations,
  buildSafeMyCnfCandidate,
  calculateMysqlMetrics,
  diffStatus,
  formatBytes,
  statusMap,
} from "./mysql-hardening-core.mjs";

test("statusMap normaliza SHOW GLOBAL STATUS", () => {
  assert.deepEqual(statusMap([{ Variable_name: "Threads_connected", Value: "7" }]), { Threads_connected: "7" });
});

test("diffStatus calcula taxas sem valores negativos", () => {
  const result = diffStatus({ Questions: 100, Slow_queries: 2 }, { Questions: 160, Slow_queries: 3 }, 10);
  assert.equal(result.Questions, 60);
  assert.equal(result.Questions_per_second, 6);
  assert.equal(result.Slow_queries_per_second, 0.1);
});

test("calculateMysqlMetrics calcula pressão, tmp disk e hit ratio", () => {
  const metrics = calculateMysqlMetrics({
    variables: { max_connections: 100, innodb_buffer_pool_size: 4 * 1024 ** 3 },
    status: {
      Max_used_connections: 80,
      Threads_connected: 10,
      Threads_running: 2,
      Connections: 1000,
      Threads_created: 20,
      Created_tmp_tables: 1000,
      Created_tmp_disk_tables: 200,
      Innodb_buffer_pool_reads: 100,
      Innodb_buffer_pool_read_requests: 100000,
      Slow_queries: 10,
      Questions: 100000,
      Uptime: 1000,
    },
    os: { totalMemoryBytes: 8 * 1024 ** 3 },
  });
  assert.equal(metrics.connectionUtilizationPct, 80);
  assert.equal(metrics.tempDiskTablePct, 20);
  assert.equal(metrics.bufferPoolHitPct, 99.9);
  assert.equal(metrics.bufferPoolToRamPct, 50);
});

test("recomendações não aumentam max_connections cegamente", () => {
  const recommendations = buildHardeningRecommendations({
    variables: { max_connections: 100, slow_query_log: "OFF", long_query_time: 10, innodb_buffer_pool_size: 1024 ** 3 },
    status: { Max_used_connections: 90, Connections: 1000, Threads_created: 5 },
    os: { totalMemoryBytes: 8 * 1024 ** 3, freeMemoryBytes: 4 * 1024 ** 3 },
    metrics: { connectionUtilizationPct: 90, bufferPoolHitPct: 99.9, tempDiskTablePct: 0, threadCacheMissPct: 0 },
  });
  const pressure = recommendations.find((item) => item.id === "connection-pressure");
  assert.ok(pressure);
  assert.match(pressure.action, /Não aumente max_connections automaticamente/);
});

test("my.cnf candidato só ativa mudanças seguras e deixa memória comentada", () => {
  const text = buildSafeMyCnfCandidate({
    variables: { max_connections: 151, innodb_buffer_pool_size: 1073741824, tmp_table_size: 16777216, max_heap_table_size: 16777216 },
    recommendations: [{ id: "slow-query-log" }],
  });
  assert.match(text, /slow_query_log = ON/);
  assert.match(text, /# innodb_buffer_pool_size/);
  assert.doesNotMatch(text, /^innodb_buffer_pool_size\s*=/m);
});

test("formatBytes formata footprint", () => {
  assert.equal(formatBytes(1024 ** 3), "1.00 GB");
});
