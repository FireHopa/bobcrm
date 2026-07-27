import test from "node:test";
import assert from "node:assert/strict";
import {
  PERFORMANCE_TARGETS_MS,
  buildLoadTestMarkdown,
  evaluateImportImpact,
  evaluateScenario,
  makeRunPlan,
  parseNumberList,
  percentile,
  summarizeSamples,
} from "./load-test-core.mjs";

test("phase13 percentile calcula p95 de forma determinística", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  assert.equal(percentile([], 0.95), 0);
});

test("phase13 sumariza latência e taxa de erro", () => {
  const summary = summarizeSamples([
    { durationMs: 100, ok: true, status: 200 },
    { durationMs: 200, ok: true, status: 200 },
    { durationMs: 300, ok: false, status: 500 },
  ]);
  assert.equal(summary.requests, 3);
  assert.equal(summary.errors, 1);
  assert.equal(summary.maxMs, 300);
  assert.ok(summary.errorRatePct > 30);
});

test("phase13 aplica metas específicas por cenário", () => {
  const result = evaluateScenario({
    name: "leads_list",
    samples: Array.from({ length: 20 }, () => ({ durationMs: 350, ok: true, status: 200 })),
  });
  assert.equal(result.targetMs, PERFORMANCE_TARGETS_MS.leads_list);
  assert.equal(result.pass, true);

  const slow = evaluateScenario({
    name: "lead_detail",
    samples: Array.from({ length: 20 }, () => ({ durationMs: 450, ok: true, status: 200 })),
  });
  assert.equal(slow.pass, false);
});

test("phase13 mede degradação durante importação", () => {
  assert.equal(evaluateImportImpact({ baselineP95Ms: 400, importP95Ms: 700 }).pass, true);
  assert.equal(evaluateImportImpact({ baselineP95Ms: 400, importP95Ms: 900 }).pass, false);
});

test("phase13 plano standard inclui 10,25,50,100 usuários", () => {
  const plan = makeRunPlan({ profile: "standard" });
  assert.deepEqual(plan.databaseSizes, [133000]);
  assert.deepEqual(plan.concurrencyLevels, [10, 25, 50, 100]);
  assert.ok(plan.requestsPerScenario >= 20);
});

test("phase13 plano full inclui 10k, 50k, 133k e 300k", () => {
  const plan = makeRunPlan({ profile: "full" });
  assert.deepEqual(plan.databaseSizes, [10000, 50000, 133000, 300000]);
});

test("phase13 aceita listas CLI customizadas sem duplicar números", () => {
  assert.deepEqual(parseNumberList("10000,50000,10000", []), [10000, 50000]);
});

test("phase13 relatório markdown mostra concorrência e resultado", () => {
  const markdown = buildLoadTestMarkdown({
    generatedAt: "2026-07-24T00:00:00.000Z",
    profile: "smoke",
    mode: "disposable",
    bases: [{ leads: 10000, seedSeconds: 1.2, runs: [{ concurrency: 10, results: [{ name: "leads_list", requests: 30, errors: 0, p50Ms: 100, p95Ms: 200, p99Ms: 220, targetMs: 400, pass: true }] }] }],
    pass: true,
  });
  assert.match(markdown, /10,000 leads/);
  assert.match(markdown, /Concorrência: 10/);
  assert.match(markdown, /PASS/);
});
