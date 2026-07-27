import { readFile, writeFile } from "node:fs/promises";

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value, digits = 1) {
  return Number(number(value).toFixed(digits));
}

export function parsePerformanceLog(content) {
  const requests = [];
  const sql = [];
  const runtime = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/\[perf\.(request|sql|runtime)\]\s+(\{.*\})\s*$/);
    if (!match) continue;
    try {
      const payload = JSON.parse(match[2]);
      if (match[1] === "request") requests.push(payload);
      else if (match[1] === "sql") sql.push(payload);
      else runtime.push(payload);
    } catch {
      // Linha parcial ou corrompida: ignorar sem interromper o relatório.
    }
  }
  return { requests, sql, runtime };
}

export function buildPerformanceReport(parsed) {
  const groups = new Map();
  for (const item of parsed.requests || []) {
    const key = `${item.method || "GET"} ${item.endpoint || "/"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const endpoints = [...groups.entries()].map(([endpoint, items]) => {
    const totals = items.map((item) => number(item.totalMs));
    const sqlTotals = items.map((item) => number(item.sqlMs));
    const queryCounts = items.map((item) => number(item.queries));
    return {
      endpoint,
      requests: items.length,
      errors: items.filter((item) => number(item.status) >= 500).length,
      p50Ms: fixed(percentile(totals, 0.50)),
      p95Ms: fixed(percentile(totals, 0.95)),
      p99Ms: fixed(percentile(totals, 0.99)),
      sqlP95Ms: fixed(percentile(sqlTotals, 0.95)),
      queriesAvg: fixed(queryCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, queryCounts.length), 2),
      queriesP95: fixed(percentile(queryCounts, 0.95), 0),
      maxMs: fixed(Math.max(...totals, 0)),
    };
  }).sort((a, b) => b.p95Ms - a.p95Ms);

  const slowOperations = new Map();
  for (const item of parsed.sql || []) {
    const key = `${item.operation || "SQL query"} @ ${item.endpoint || "background"}`;
    if (!slowOperations.has(key)) slowOperations.set(key, []);
    slowOperations.get(key).push(item);
  }
  const slowSql = [...slowOperations.entries()].map(([operation, items]) => ({
    operation,
    occurrences: items.length,
    p95Ms: fixed(percentile(items.map((item) => number(item.durationMs)), 0.95)),
    maxMs: fixed(Math.max(...items.map((item) => number(item.durationMs)), 0)),
  })).sort((a, b) => b.maxMs - a.maxMs).slice(0, 20);

  const runtime = parsed.runtime || [];
  const runtimeSummary = {
    samples: runtime.length,
    maxRssMb: fixed(Math.max(...runtime.map((item) => number(item.rssMb)), 0)),
    maxHeapUsedMb: fixed(Math.max(...runtime.map((item) => number(item.heapUsedMb)), 0)),
    maxCpuPct: fixed(Math.max(...runtime.map((item) => number(item.cpuPct)), 0)),
    maxEventLoopP95Ms: fixed(Math.max(...runtime.map((item) => number(item.eventLoopP95Ms)), 0), 2),
    maxPoolPending: fixed(Math.max(...runtime.map((item) => number(item.pool?.pending)), 0), 0),
    maxPoolConnections: fixed(Math.max(...runtime.map((item) => number(item.pool?.connections)), 0), 0),
  };

  return { generatedAt: new Date().toISOString(), endpoints, slowSql, runtime: runtimeSummary };
}

export function reportToMarkdown(report) {
  const lines = [
    "# BobCRM Performance Runtime Report",
    "",
    `Gerado em: ${report.generatedAt}`,
    "",
    "## Endpoints",
    "",
    "| Endpoint | Requests | Erros 5xx | p50 | p95 | p99 | SQL p95 | Queries avg | Queries p95 | Max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.endpoints) {
    lines.push(`| ${item.endpoint} | ${item.requests} | ${item.errors} | ${item.p50Ms}ms | ${item.p95Ms}ms | ${item.p99Ms}ms | ${item.sqlP95Ms}ms | ${item.queriesAvg} | ${item.queriesP95} | ${item.maxMs}ms |`);
  }
  if (!report.endpoints.length) lines.push("| Sem dados | 0 | 0 | - | - | - | - | - | - | - |");

  lines.push("", "## Queries lentas", "", "| Operação | Ocorrências | p95 | Max |", "| --- | ---: | ---: | ---: |");
  for (const item of report.slowSql) lines.push(`| ${item.operation} | ${item.occurrences} | ${item.p95Ms}ms | ${item.maxMs}ms |`);
  if (!report.slowSql.length) lines.push("| Sem ocorrências acima do limiar | 0 | - | - |");

  lines.push(
    "",
    "## Runtime",
    "",
    `- Amostras: ${report.runtime.samples}`,
    `- RSS máximo: ${report.runtime.maxRssMb} MB`,
    `- Heap usado máximo: ${report.runtime.maxHeapUsedMb} MB`,
    `- CPU máxima aproximada: ${report.runtime.maxCpuPct}%`,
    `- Event loop p95 máximo: ${report.runtime.maxEventLoopP95Ms} ms`,
    `- Fila máxima do pool: ${report.runtime.maxPoolPending}`,
    `- Conexões máximas observadas: ${report.runtime.maxPoolConnections}`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const outputValueIndex = outputIndex >= 0 ? outputIndex + 1 : -1;
  const outputPath = outputValueIndex >= 0 ? args[outputValueIndex] : "";
  const inputPath = args.find((arg, index) => !arg.startsWith("--") && index !== outputValueIndex) || "";
  const content = inputPath ? await readFile(inputPath, "utf8") : await readStdin();
  const report = buildPerformanceReport(parsePerformanceLog(content));
  const markdown = reportToMarkdown(report);
  if (outputPath) await writeFile(outputPath, markdown, "utf8");
  process.stdout.write(markdown);
}

if (process.argv[1]?.endsWith("performance-report.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
