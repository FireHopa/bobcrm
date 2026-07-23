import { performance } from "node:perf_hooks";
import mysql from "mysql2/promise";
import { createApiClient, startDisposableCrm } from "../server/integration/mysqlHarness.js";

const TARGET_LEADS = 133_000;
const BATCH_SIZE = 1_000;
const READ_REQUESTS = 240;
const READ_CONCURRENCY = 20;
const WRITE_REQUESTS = 60;
const WRITE_CONCURRENCY = 6;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function runLimited(items, concurrency, handler) {
  let cursor = 0;
  const results = [];
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await handler(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

if (process.argv.includes("--dry-run") || process.env.RUN_LOAD_TEST !== "1") {
  console.log(JSON.stringify({ mode: "dry-run", targetLeads: TARGET_LEADS, batchSize: BATCH_SIZE, readRequests: READ_REQUESTS, writeRequests: WRITE_REQUESTS }, null, 2));
  process.exit(0);
}

const crm = await startDisposableCrm({ prefix: "crm_phase6_load", timeoutMs: 90_000 });
let connection;
try {
  connection = await mysql.createConnection({ ...crm.sandbox.config, database: crm.sandbox.database });
  const seedStarted = performance.now();
  const now = new Date().toISOString();
  for (let start = 0; start < TARGET_LEADS; start += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, TARGET_LEADS - start);
    const rows = Array.from({ length: count }, (_, offset) => {
      const index = start + offset;
      const id = `load-${String(index).padStart(7, "0")}`;
      const email = `load.${index}@example.test`;
      return [id, `Lead carga ${index}`, email, email, `119${String(index).padStart(8, "0").slice(-8)}`, `119${String(index).padStart(8, "0").slice(-8)}`, `Empresa ${index % 5000}`, `lead carga ${index}|empresa ${index % 5000}`, index % 3 === 0 ? "Quente" : index % 3 === 1 ? "Morno" : "Frio", "Novo lead", `lead carga ${index} ${email} empresa ${index % 5000}`, now, now];
    });
    await connection.query(
      `INSERT INTO leads (id, name, email, email_key, phone, phone_key, company, name_company_key, temperature, status, search_text, created_at, updated_at) VALUES ?`,
      [rows],
    );
  }
  const seedMs = performance.now() - seedStarted;
  const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM leads WHERE deleted_at = ''");
  const total = Number(countRows[0].total);
  if (total < TARGET_LEADS) throw new Error(`Seed incompleto: ${total}/${TARGET_LEADS}`);

  const api = createApiClient(crm.baseUrl);
  await api.login(crm.adminEmail, crm.adminPassword);
  const readDurations = await runLimited(Array.from({ length: READ_REQUESTS }, (_, index) => index), READ_CONCURRENCY, async (index) => {
    const started = performance.now();
    const query = index % 4 === 0
      ? `/api/leads?limit=50&offset=${(index % 20) * 50}`
      : index % 4 === 1
        ? "/api/leads/summary"
        : index % 4 === 2
          ? "/api/leads/opportunities/summary"
          : `/api/leads?search=${encodeURIComponent(`Lead carga ${index * 11}`)}&limit=20`;
    const result = await api.request(query);
    if (!result.response.ok || result.response.status >= 500) throw new Error(`Leitura falhou: ${result.response.status} ${query}`);
    return performance.now() - started;
  });

  const writeDurations = await runLimited(Array.from({ length: WRITE_REQUESTS }, (_, index) => index), WRITE_CONCURRENCY, async (index) => {
    const started = performance.now();
    const result = await api.request("/api/leads", {
      method: "POST",
      body: { name: `Lead escrita carga ${index}`, email: `write.load.${index}.${Date.now()}@example.test`, phone: `118${String(index).padStart(8, "0")}`, company: "Carga escrita", status: "Novo lead" },
    });
    if (result.response.status !== 201) throw new Error(`Escrita falhou: ${result.response.status} ${JSON.stringify(result.body)}`);
    return performance.now() - started;
  });

  const report = {
    targetLeads: TARGET_LEADS,
    seededLeads: total,
    seedSeconds: Number((seedMs / 1000).toFixed(2)),
    reads: { total: readDurations.length, concurrency: READ_CONCURRENCY, p50Ms: Number(percentile(readDurations, 0.5).toFixed(1)), p95Ms: Number(percentile(readDurations, 0.95).toFixed(1)), maxMs: Number(Math.max(...readDurations).toFixed(1)) },
    writes: { total: writeDurations.length, concurrency: WRITE_CONCURRENCY, p50Ms: Number(percentile(writeDurations, 0.5).toFixed(1)), p95Ms: Number(percentile(writeDurations, 0.95).toFixed(1)), maxMs: Number(Math.max(...writeDurations).toFixed(1)) },
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.reads.p95Ms > 10_000) throw new Error(`p95 de leitura excedeu 10 s: ${report.reads.p95Ms} ms`);
  if (report.writes.p95Ms > 15_000) throw new Error(`p95 de escrita excedeu 15 s: ${report.writes.p95Ms} ms`);
} finally {
  await connection?.end().catch(() => undefined);
  await crm.stop();
}
