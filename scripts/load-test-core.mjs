export const PERFORMANCE_TARGETS_MS = Object.freeze({
  leads_list: 400,
  lead_detail: 300,
  search: 800,
  kanban: 900,
  dashboard: 800,
  summary: 500,
  create_lead: 700,
  edit_lead: 700,
});

export const DEFAULT_CONCURRENCY_LEVELS = Object.freeze([10, 25, 50, 100]);
export const DEFAULT_DATABASE_SIZES = Object.freeze([10_000, 50_000, 133_000, 300_000]);

export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function fixed(value, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : 0;
}

export function parseNumberList(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
  return items.length ? [...new Set(items)] : [...fallback];
}

export function summarizeSamples(samples = []) {
  const valid = samples.filter((item) => item && Number.isFinite(Number(item.durationMs)));
  const durations = valid.map((item) => Number(item.durationMs));
  const errors = valid.filter((item) => item.ok === false || Number(item.status || 0) >= 500).length;
  return {
    requests: valid.length,
    errors,
    errorRatePct: fixed((errors / Math.max(1, valid.length)) * 100, 2),
    p50Ms: fixed(percentile(durations, 0.50)),
    p95Ms: fixed(percentile(durations, 0.95)),
    p99Ms: fixed(percentile(durations, 0.99)),
    maxMs: fixed(Math.max(...durations, 0)),
    avgMs: fixed(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)),
  };
}

export function evaluateScenario({ name, samples, targetMs, maxErrorRatePct = 1 }) {
  const summary = summarizeSamples(samples);
  const threshold = Number(targetMs || PERFORMANCE_TARGETS_MS[name] || 0);
  const latencyPass = threshold <= 0 || summary.p95Ms <= threshold;
  const errorsPass = summary.errorRatePct <= maxErrorRatePct;
  return {
    name,
    targetMs: threshold,
    ...summary,
    pass: latencyPass && errorsPass,
    latencyPass,
    errorsPass,
  };
}

export function evaluateImportImpact({ baselineP95Ms, importP95Ms, maxDegradationRatio = 2 }) {
  const baseline = Math.max(0, Number(baselineP95Ms || 0));
  const active = Math.max(0, Number(importP95Ms || 0));
  const ratio = baseline > 0 ? active / baseline : 0;
  return {
    baselineP95Ms: fixed(baseline),
    importP95Ms: fixed(active),
    degradationRatio: fixed(ratio, 2),
    maxDegradationRatio,
    pass: baseline <= 0 || ratio <= maxDegradationRatio,
  };
}

export function makeRunPlan({ profile = "standard", databaseSizes, concurrencyLevels, requestsPerScenario } = {}) {
  const normalizedProfile = String(profile || "standard").trim().toLowerCase();
  const presets = {
    smoke: { databaseSizes: [10_000], concurrencyLevels: [10], requestsPerScenario: 30, importLeads: 1_000 },
    ci: { databaseSizes: [133_000], concurrencyLevels: [10, 25, 50, 100], requestsPerScenario: 60, importLeads: 3_000 },
    standard: { databaseSizes: [133_000], concurrencyLevels: [10, 25, 50, 100], requestsPerScenario: 100, importLeads: 5_000 },
    full: { databaseSizes: DEFAULT_DATABASE_SIZES, concurrencyLevels: DEFAULT_CONCURRENCY_LEVELS, requestsPerScenario: 120, importLeads: 10_000 },
  };
  const preset = presets[normalizedProfile] || presets.standard;
  return {
    profile: presets[normalizedProfile] ? normalizedProfile : "standard",
    databaseSizes: parseNumberList(databaseSizes, preset.databaseSizes),
    concurrencyLevels: parseNumberList(concurrencyLevels, preset.concurrencyLevels),
    requestsPerScenario: Math.max(20, Number.parseInt(String(requestsPerScenario || preset.requestsPerScenario), 10) || preset.requestsPerScenario),
    importLeads: preset.importLeads,
  };
}

function statusIcon(pass) {
  return pass ? "PASS" : "FAIL";
}

export function buildLoadTestMarkdown(report) {
  const lines = [
    "# BobCRM Load Test Report",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Perfil: ${report.profile}`,
    `Modo: ${report.mode}`,
    "",
    "## Metas",
    "",
    "| Cenário | p95 alvo |",
    "| --- | ---: |",
  ];
  for (const [name, target] of Object.entries(PERFORMANCE_TARGETS_MS)) {
    lines.push(`| ${name} | ${target} ms |`);
  }

  for (const base of report.bases || []) {
    lines.push(
      "",
      `## Base: ${base.leads.toLocaleString("en-US")} leads`,
      "",
      `Seed: ${fixed(base.seedSeconds, 2)} s`,
    );
    for (const run of base.runs || []) {
      lines.push(
        "",
        `### Concorrência: ${run.concurrency}`,
        "",
        "| Cenário | Req. | Erros | p50 | p95 | p99 | Alvo | Status |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      );
      for (const result of run.results || []) {
        lines.push(`| ${result.name} | ${result.requests} | ${result.errors} | ${result.p50Ms} ms | ${result.p95Ms} ms | ${result.p99Ms} ms | ${result.targetMs} ms | ${statusIcon(result.pass)} |`);
      }
    }
  }

  if (report.importScenario) {
    const item = report.importScenario;
    lines.push(
      "",
      "## Importação ativa + navegação",
      "",
      `Leads importados no job: ${item.importLeads}`,
      `Usuários concorrentes: ${item.concurrency}`,
      `Status do job: ${item.jobStatus}`,
      "",
      "| Métrica | Baseline | Durante importação | Degradação | Limite | Status |",
      "| --- | ---: | ---: | ---: | ---: | --- |",
      `| Navegação mista p95 | ${item.impact.baselineP95Ms} ms | ${item.impact.importP95Ms} ms | ${item.impact.degradationRatio}x | ${item.impact.maxDegradationRatio}x | ${statusIcon(item.impact.pass)} |`,
    );
  }

  lines.push(
    "",
    "## Resultado final",
    "",
    report.pass ? "**PASS**: todas as metas obrigatórias foram atendidas." : "**FAIL**: uma ou mais metas obrigatórias não foram atendidas.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
