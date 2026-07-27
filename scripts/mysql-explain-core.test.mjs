import assert from "node:assert/strict";
import test from "node:test";
import { buildPhase9Scenarios, parseExplainAnalyzePlan, evaluateScenario, buildExplainMarkdown } from "./mysql-explain-core.mjs";

test("catálogo da fase 9 cobre as queries críticas e não contém writes", () => {
  const scenarios = buildPhase9Scenarios({
    pipelineId: "pipe-1",
    responsibleUserId: "user-1",
    emailKey: "cliente@example.com",
    phoneKey: "5511999999999",
    searchSeed: "Empresa Premium",
  });
  const ids = new Set(scenarios.map((item) => item.id));
  for (const required of ["lead_list_default", "lead_priority_filter", "kanban_pipelines", "kanban_initial_cards", "dashboard_summary", "tasks_today_counts", "tasks_overdue_list", "tasks_owner_today", "search_email_prefix", "search_phone_prefix", "search_fulltext"]) {
    assert.ok(ids.has(required), `cenário ausente: ${required}`);
  }
  for (const scenario of scenarios) {
    assert.match(scenario.sql.trim(), /^(WITH|SELECT)/i);
    assert.doesNotMatch(scenario.sql, /\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  }
});

test("parser identifica scan, sort, índice, actual time e work rows", () => {
  const plan = `-> Limit: 50 row(s)  (cost=100 rows=50) (actual time=2.1..2.9 rows=50 loops=1)\n    -> Sort: leads.updated_at_dt DESC  (actual time=2.0..2.5 rows=50 loops=1)\n        -> Index range scan on leads using idx_leads_list_updated_dt over (deleted_at = '')  (actual time=0.1..1.8 rows=120 loops=1)`;
  const parsed = parseExplainAnalyzePlan(plan);
  assert.equal(parsed.rootActualEndMs, 2.9);
  assert.equal(parsed.rootActualRows, 50);
  assert.equal(parsed.indexRangeScan, true);
  assert.equal(parsed.sort, true);
  assert.deepEqual(parsed.indexesUsed, ["idx_leads_list_updated_dt"]);
  assert.equal(parsed.accessWorkRows, 120);
});

test("avaliação marca table scan volumoso para revisão", () => {
  const scenario = buildPhase9Scenarios()[0];
  const evaluation = evaluateScenario(scenario, {
    indexesUsed: [], tableScan: true, accessWorkRows: 133000, rootActualEndMs: 220, maxActualEndMs: 220,
  });
  assert.equal(evaluation.status, "review");
  assert.match(evaluation.reason, /table scan/);
});

test("relatório markdown não expõe parâmetros das queries", () => {
  const markdown = buildExplainMarkdown({
    generatedAt: "2026-07-24T12:00:00.000Z",
    database: "crm",
    mysqlVersion: "8.0.40",
    maxExecutionTimeMs: 5000,
    tables: [], indexes: [], indexUsage: [],
    scenarios: [{ label: "Busca", recommendation: "medir", plan: "Index lookup", summary: {}, evaluation: { status: "ok", reason: "ok" } }],
  });
  assert.match(markdown, /EXPLAIN ANALYZE/);
  assert.doesNotMatch(markdown, /cliente@example\.com/);
});
