import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformanceReport, parsePerformanceLog, reportToMarkdown } from "./performance-report.mjs";

test("agrega requests, SQL lento e runtime sem depender de dados sensíveis", () => {
  const parsed = parsePerformanceLog([
    '[perf.request] {"method":"GET","endpoint":"/api/leads","status":200,"totalMs":300,"sqlMs":200,"queries":4}',
    '[perf.request] {"method":"GET","endpoint":"/api/leads","status":500,"totalMs":500,"sqlMs":350,"queries":5}',
    '[perf.sql] {"operation":"SELECT leads","durationMs":350,"endpoint":"/api/leads"}',
    '[perf.runtime] {"rssMb":200,"heapUsedMb":80,"cpuPct":20,"eventLoopP95Ms":12,"pool":{"pending":2,"connections":10}}',
    'linha irrelevante',
  ].join("\n"));

  const report = buildPerformanceReport(parsed);
  assert.equal(report.endpoints.length, 1);
  assert.equal(report.endpoints[0].endpoint, "GET /api/leads");
  assert.equal(report.endpoints[0].requests, 2);
  assert.equal(report.endpoints[0].errors, 1);
  assert.equal(report.endpoints[0].p95Ms, 500);
  assert.equal(report.endpoints[0].queriesP95, 5);
  assert.equal(report.slowSql[0].operation, "SELECT leads @ /api/leads");
  assert.equal(report.runtime.maxPoolPending, 2);

  const markdown = reportToMarkdown(report);
  assert.match(markdown, /GET \/api\/leads/);
  assert.match(markdown, /SELECT leads @ \/api\/leads/);
});
