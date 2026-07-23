import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [serverSource, reliabilitySource, jobQueueSource, schemaSource, envSource, apiSource, appSource, packageSource, staticAssetsSource] = await Promise.all([
  readFile(new URL("./index.js", import.meta.url), "utf8"),
  readFile(new URL("./mysqlReliability.js", import.meta.url), "utf8"),
  readFile(new URL("./jobQueue.js", import.meta.url), "utf8"),
  readFile(new URL("./schema.mysql.sql", import.meta.url), "utf8"),
  readFile(new URL("./.env.example", import.meta.url), "utf8"),
  readFile(new URL("../src/utils/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("./http/staticAssets.js", import.meta.url), "utf8"),
]);

test("fila global de gravação foi removida e transações continuam isoladas", () => {
  assert.doesNotMatch(serverSource, /queueDatabaseWrite|let isWriting|writeQueue/);
  assert.match(serverSource, /withMysqlTransactionRetry/);
  assert.match(reliabilitySource, /SET TRANSACTION ISOLATION LEVEL/);
  assert.match(serverSource, /GET_LOCK\(\?, \?\)/);
  assert.match(serverSource, /FOR UPDATE/);
});

test("operações pesadas usam jobs persistentes e respostas 202", () => {
  for (const jobType of ["backup_mysql", "import_leads", "export_leads_csv", "export_leads_xlsx", "rebuild_search_index"]) {
    assert.match(jobQueueSource, new RegExp(jobType));
  }
  for (const route of ["/api/exports/leads", "/api/leads/import", "/api/backups"]) {
    assert.match(serverSource, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(serverSource, /const jobMatch = pathname\.match/);
  assert.match(serverSource, /const jobDownloadMatch = pathname\.match/);
  assert.match(serverSource, /sendJson\(response, 202/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS async_jobs/);
  assert.match(schemaSource, /idx_async_jobs_claim/);
  assert.match(schemaSource, /dedupe_key/);
});

test("exportações são paginadas e gravadas por streaming", () => {
  assert.match(serverSource, /writeCsvExport/);
  assert.match(serverSource, /writeXlsxExport/);
  assert.match(serverSource, /nextCursor/);
  assert.doesNotMatch(serverSource, /buildLeadsXlsxBuffer|exportAllLeadsCsvStream/);
});

test("health checks e encerramento gracioso estão conectados ao ciclo de vida", () => {
  assert.match(serverSource, /pathname === "\/health\/live"/);
  assert.match(serverSource, /pathname === "\/health\/ready"/);
  assert.match(serverSource, /buildReadinessReport/);
  assert.match(serverSource, /process\.once\("SIGTERM"/);
  assert.match(serverSource, /process\.once\("SIGINT"/);
  assert.match(serverSource, /closeIdleConnections/);
  assert.match(serverSource, /jobWorker\?\.stop/);
  assert.match(serverSource, /pool\?\.end/);
});

test("artifacts, retry e timeouts possuem configuração explícita", () => {
  for (const variable of [
    "MYSQL_RETRY_ATTEMPTS",
    "MYSQL_TRANSACTION_RETRY_ATTEMPTS",
    "LEAD_IDENTITY_LOCK_TIMEOUT_SECONDS",
    "JOB_ARTIFACT_DIR",
    "JOB_WORKER_CONCURRENCY",
    "JOB_STALE_AFTER_MS",
    "GRACEFUL_SHUTDOWN_TIMEOUT_MS",
    "HTTP_REQUEST_TIMEOUT_MS",
  ]) {
    assert.match(envSource, new RegExp(`^${variable}=`, "m"), `variável ausente: ${variable}`);
  }
});

test("frontend acompanha jobs e usa package.json como fonte de versão", () => {
  assert.match(apiSource, /waitForJob/);
  assert.match(apiSource, /\/api\/jobs\/\$\{encodeURIComponent\(job\.id\)\}/);
  assert.match(apiSource, /\/api\/jobs\/\$\{encodeURIComponent\(completed\.id\)\}\/download/);
  assert.match(appSource, /import packageMetadata from "\.\.\/package\.json"/);
  assert.match(appSource, /CRM Casa do Ads v\{APP_VERSION\}/);
  assert.doesNotMatch(appSource, /CRM Casa do Ads V42/);
  assert.match(packageSource, /"test:phase4"/);
});

test("caminhos estáticos inseguros são rejeitados antes do fallback SPA", () => {
  assert.match(staticAssetsSource, /path\.relative/);
  assert.match(staticAssetsSource, /if \(!isPathInsideDirectory\(distDir, candidatePath\)\)/);
  assert.match(staticAssetsSource, /Recurso estático não encontrado/);
});
