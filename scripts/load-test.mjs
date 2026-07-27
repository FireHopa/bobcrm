import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  PERFORMANCE_TARGETS_MS,
  buildLoadTestMarkdown,
  evaluateImportImpact,
  evaluateScenario,
  makeRunPlan,
  percentile,
} from "./load-test-core.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_BATCH_SIZE = 1_000;
const CI_REFERENCE_LEADS = 133_000; // contrato histórico do job de carga do CI
const IMPORT_NAV_CONCURRENCY = 20;
const IMPORT_MAX_DEGRADATION_RATIO = 2;
const IMPORT_ABSOLUTE_P95_MS = 2_000;

async function findAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function createDisposableDatabase(mysql) {
  const config = {
    host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || "root",
    password: process.env.MYSQL_TEST_PASSWORD || "",
  };
  const database = `crm_phase13_load_${Date.now()}_${randomUUID().slice(0, 8)}`.replace(/[^a-zA-Z0-9_]/g, "_");
  const connection = await mysql.createConnection({ ...config, multipleStatements: false });
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  return {
    config,
    database,
    connection,
    async drop() {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
      await connection.end().catch(() => undefined);
    },
  };
}

function mergeSetCookie(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = values.length ? values : [headers.get("set-cookie") || ""];
  return source.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function createApiClient(baseUrl) {
  let cookie = "";
  let csrfToken = "";
  return {
    async request(pathname, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
      if (options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        method,
        headers,
        body: options.body === undefined || typeof options.body === "string" ? options.body : JSON.stringify(options.body),
      });
      const nextCookie = mergeSetCookie(response.headers);
      if (nextCookie) cookie = nextCookie;
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { response, body };
    },
    async login(email, password) {
      const result = await this.request("/api/auth/login", { method: "POST", body: { email, password } });
      if (!result.response.ok) throw new Error(`Login falhou (${result.response.status}): ${JSON.stringify(result.body)}`);
      csrfToken = result.body.csrfToken;
      return result.body;
    },
  };
}

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLimited(count, concurrency, handler) {
  let cursor = 0;
  const results = new Array(count);
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      results[index] = await handler(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => worker()));
  return results;
}

async function waitForHttpReady(baseUrl, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API de carga encerrou com código ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = new Error(`readiness HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`API de carga não ficou pronta: ${lastError?.message || "sem resposta"}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(12_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startDisposableCluster(mysql) {
  const sandbox = await createDisposableDatabase(mysql);
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const storageRoot = path.join(os.tmpdir(), `bobcrm-phase13-${randomUUID()}`);
  const jobsDir = path.join(storageRoot, "jobs");
  const backupsDir = path.join(storageRoot, "backups");
  await mkdir(jobsDir, { recursive: true });
  await mkdir(backupsDir, { recursive: true });

  const adminEmail = `phase13.${randomUUID().slice(0, 8)}@example.test`;
  const adminPassword = `Aa1!${randomBytes(18).toString("base64url")}`;
  const commonEnv = {
    ...process.env,
    NODE_ENV: "test",
    MYSQL_HOST: sandbox.config.host,
    MYSQL_PORT: String(sandbox.config.port),
    MYSQL_USER: sandbox.config.user,
    MYSQL_PASSWORD: sandbox.config.password,
    MYSQL_DATABASE: sandbox.database,
    CRM_ADMIN_EMAIL: adminEmail,
    CRM_ADMIN_PASSWORD: adminPassword,
    CRM_ADMIN_NAME: "Administrador Fase 13",
    SESSION_COOKIE_SECURE: "0",
    SEARCH_INDEX_REBUILD_ON_START: "0",
    BACKUP_EXTERNAL_DIR: backupsDir,
    BACKUP_REQUIRE_EXTERNAL_STORAGE: "0",
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    JOB_ARTIFACT_DIR: jobsDir,
    JOB_POLL_INTERVAL_MS: "75",
    JOB_HEARTBEAT_INTERVAL_MS: "1000",
    JOB_STALE_AFTER_MS: "30000",
    RATE_LIMIT_CLEANUP_INTERVAL_MS: "60000",
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: "10000",
    TRUST_PROXY: "0",
    PERF_LOG_ENABLED: "1",
    PERF_RUNTIME_INTERVAL_MS: "1000",
    MYSQL_API_CONNECTION_LIMIT: "8",
    MYSQL_WORKER_CONNECTION_LIMIT: "2",
    JOB_WORKER_CONCURRENCY: "2",
    IMPORT_DB_BATCH_SIZE: "500",
  };

  const apiLogs = [];
  const api = spawn(process.execPath, ["server/index.js"], {
    cwd: PROJECT_ROOT,
    env: { ...commonEnv, PROCESS_ROLE: "api", SERVER_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", (chunk) => apiLogs.push(chunk.toString()));
  api.stderr.on("data", (chunk) => apiLogs.push(chunk.toString()));

  try {
    await waitForHttpReady(baseUrl, api);
  } catch (error) {
    await stopChild(api);
    await sandbox.drop();
    await rm(storageRoot, { recursive: true, force: true });
    throw new Error(`${error.message}\n${apiLogs.join("").slice(-5000)}`);
  }

  const workerLogs = [];
  const worker = spawn(process.execPath, ["server/index.js"], {
    cwd: PROJECT_ROOT,
    env: { ...commonEnv, PROCESS_ROLE: "worker" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", (chunk) => workerLogs.push(chunk.toString()));
  worker.stderr.on("data", (chunk) => workerLogs.push(chunk.toString()));
  await sleep(750);
  if (worker.exitCode !== null) {
    await stopChild(api);
    await sandbox.drop();
    await rm(storageRoot, { recursive: true, force: true });
    throw new Error(`Worker de carga encerrou no startup.\n${workerLogs.join("").slice(-5000)}`);
  }

  return {
    sandbox,
    apiProcess: api,
    workerProcess: worker,
    baseUrl,
    adminEmail,
    adminPassword,
    apiLogs,
    workerLogs,
    storageRoot,
    async stop() {
      await Promise.all([stopChild(worker), stopChild(api)]);
      await sandbox.drop().catch(() => undefined);
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

function mysqlDatetime(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

async function getSeedMetadata(connection) {
  const [pipelines] = await connection.query("SELECT id FROM kanban_pipelines WHERE is_archived = 0 ORDER BY is_default DESC, position ASC LIMIT 1");
  const pipelineId = String(pipelines[0]?.id || "");
  const [stages] = pipelineId
    ? await connection.query("SELECT id FROM kanban_stages WHERE pipeline_id = ? AND is_archived = 0 ORDER BY position ASC", [pipelineId])
    : [[]];
  return { pipelineId, stageIds: stages.map((row) => String(row.id || "")).filter(Boolean) };
}

async function seedToTarget(connection, currentCount, targetCount, metadata) {
  if (targetCount <= currentCount) return { count: currentCount, seedSeconds: 0 };
  const seedStarted = performance.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowDt = mysqlDatetime(now);
  const stages = metadata.stageIds.length ? metadata.stageIds : [""];

  for (let start = currentCount; start < targetCount; start += SEED_BATCH_SIZE) {
    const count = Math.min(SEED_BATCH_SIZE, targetCount - start);
    const rows = Array.from({ length: count }, (_, offset) => {
      const index = start + offset;
      const id = `load-${String(index).padStart(7, "0")}`;
      const email = `load.${index}@example.test`;
      const phone = `119${String(index).padStart(8, "0").slice(-8)}`;
      const company = `Empresa ${index % 5000}`;
      const stageId = stages[index % stages.length];
      const score = (index * 17) % 101;
      return [
        id,
        `Lead carga ${index}`,
        email,
        email,
        phone,
        phone,
        company,
        `lead carga ${index}|${company.toLowerCase()}`,
        index % 3 === 0 ? "Quente" : index % 3 === 1 ? "Morno" : "Frio",
        "Novo lead",
        `lead carga ${index} ${email} ${company}`,
        nowIso,
        nowDt,
        nowIso,
        nowDt,
        metadata.pipelineId,
        stageId,
        index + 1,
        1,
        nowIso,
        score,
        score,
        score,
        score,
        index % 4,
        index % 3,
        index % 2,
        index % 5,
        index % 4 === 0 ? 1 : 0,
        index % 7 === 0 ? 1 : 0,
        index % 11 === 0 ? 1 : 0,
      ];
    });
    await connection.query(
      `INSERT INTO leads (
        id, name, email, email_key, phone, phone_key, company, name_company_key,
        temperature, status, search_text,
        created_at, created_at_dt, updated_at, updated_at_dt,
        pipeline_id, pipeline_stage_id, kanban_position,
        commercial_profile_version, commercial_profile_updated_at,
        commercial_potential_score, mapping_urgency_score, lead_priority_score, opportunity_score,
        service_casa_count, service_agency_count, service_missing_count, service_unknown_count,
        has_expansion_opportunity, has_migration_opportunity, has_external_agency
      ) VALUES ?`,
      [rows],
    );
  }
  return { count: targetCount, seedSeconds: (performance.now() - seedStarted) / 1000 };
}

async function timedRequest(api, pathname, options) {
  const started = performance.now();
  try {
    const result = await api.request(pathname, options);
    return {
      durationMs: performance.now() - started,
      status: result.response.status,
      ok: result.response.ok,
      body: result.body,
    };
  } catch (error) {
    return { durationMs: performance.now() - started, status: 0, ok: false, error: error?.message || String(error) };
  }
}

function scenarioDefinitions(context, allowWrites) {
  const { pipelineId, maxLeadIndex, runToken } = context;
  const leadIdAt = (index) => context.externalLeadIds?.length
    ? String(context.externalLeadIds[index % context.externalLeadIds.length])
    : `load-${String(index % Math.max(1, maxLeadIndex)).padStart(7, "0")}`;
  const defs = [
    {
      name: "leads_list",
      request: (index) => [`/api/leads?limit=50&offset=${(index % 20) * 50}`],
    },
    {
      name: "lead_detail",
      request: (index) => [`/api/leads/${encodeURIComponent(leadIdAt(index))}`],
    },
    {
      name: "search",
      request: (index) => [`/api/leads?search=${encodeURIComponent(`Lead carga ${(index * 97) % Math.max(1, maxLeadIndex)}`)}&limit=20`],
    },
    {
      name: "kanban",
      request: () => [`/api/kanban/board?pipelineId=${encodeURIComponent(pipelineId)}&limitPerStage=30`],
    },
    {
      name: "dashboard",
      request: () => ["/api/admin/leads/overview?includeDuplicates=0"],
    },
    {
      name: "summary",
      request: (index) => [index % 2 === 0 ? "/api/leads/summary" : "/api/leads/opportunities/summary"],
    },
  ];

  if (allowWrites) {
    defs.push({
      name: "create_lead",
      request: (index) => ["/api/leads", {
        method: "POST",
        body: {
          name: `Carga create ${runToken}-${index}`,
          email: `phase13.create.${runToken}.${index}@example.test`,
          phone: `118${String(index).padStart(8, "0").slice(-8)}`,
          company: "Carga Fase 13",
          status: "Novo lead",
        },
      }],
    });
    if (!context.externalLeadIds?.length) defs.push({
      name: "edit_lead",
      request: (index) => {
        const leadIndex = index % Math.max(1, maxLeadIndex);
        const padded = String(leadIndex).padStart(7, "0");
        return ["/api/leads", {
          method: "POST",
          body: {
            id: `load-${padded}`,
            name: `Lead carga ${leadIndex}`,
            email: `load.${leadIndex}@example.test`,
            phone: `119${String(leadIndex).padStart(8, "0").slice(-8)}`,
            company: `Empresa ${leadIndex % 5000}`,
            status: "Novo lead",
            temperature: leadIndex % 2 === 0 ? "Quente" : "Morno",
          },
        }];
      },
    });
  }
  return defs;
}

async function warmScenario(api, definition) {
  const [pathname, options] = definition.request(0);
  const result = await timedRequest(api, pathname, options);
  if (!result.ok) throw new Error(`Warm-up falhou em ${definition.name}: HTTP ${result.status}`);
}

async function runScenario(api, definition, { concurrency, requests }) {
  await warmScenario(api, definition);
  const samples = await runLimited(requests, concurrency, async (index) => {
    const [pathname, options] = definition.request(index);
    return timedRequest(api, pathname, options);
  });
  return evaluateScenario({ name: definition.name, samples });
}

function mixedNavigationDefinition(context) {
  const defs = scenarioDefinitions(context, false);
  return {
    name: "mixed_navigation",
    request(index) {
      const definition = defs[index % defs.length];
      return definition.request(index);
    },
  };
}

async function runMixedNavigation(api, context, { concurrency = IMPORT_NAV_CONCURRENCY, requests = 120 } = {}) {
  const definition = mixedNavigationDefinition(context);
  const samples = await runLimited(requests, concurrency, async (index) => {
    const [pathname, options] = definition.request(index);
    return timedRequest(api, pathname, options);
  });
  const durations = samples.filter((item) => item.ok).map((item) => item.durationMs);
  const errors = samples.filter((item) => !item.ok).length;
  return {
    samples,
    requests: samples.length,
    errors,
    p95Ms: durations.length ? percentile(durations, 0.95) : 0,
  };
}

function buildImportPayload(count, runToken) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Import phase13 ${runToken} ${index}`,
    email: `phase13.import.${runToken}.${index}@example.test`,
    phone: `117${String(index).padStart(8, "0").slice(-8)}`,
    company: `Importação Fase 13 ${index % 100}`,
    status: "Novo lead",
    temperature: index % 3 === 0 ? "Quente" : "Morno",
  }));
}

async function waitForJob(api, jobId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const result = await api.request(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!result.response.ok) throw new Error(`Consulta do job falhou: HTTP ${result.response.status}`);
    last = result.body;
    if (["completed", "failed", "canceled"].includes(last.status)) return last;
    await sleep(150);
  }
  throw new Error(`Job ${jobId} não terminou em ${timeoutMs}ms. Último status: ${last?.status || "desconhecido"}`);
}

async function runImportScenario(api, context, importLeads) {
  const baseline = await runMixedNavigation(api, context, { concurrency: IMPORT_NAV_CONCURRENCY, requests: 120 });
  const payload = buildImportPayload(importLeads, context.runToken);
  const enqueue = await api.request("/api/leads/import", { method: "POST", body: { leads: payload } });
  if (enqueue.response.status !== 202 || !enqueue.body?.id) {
    throw new Error(`Não foi possível iniciar importação: HTTP ${enqueue.response.status} ${JSON.stringify(enqueue.body)}`);
  }

  let jobDone = false;
  const jobPromise = waitForJob(api, enqueue.body.id).finally(() => { jobDone = true; });
  const samples = [];
  const definition = mixedNavigationDefinition(context);
  let cursor = 0;
  async function virtualUser() {
    while (!jobDone || samples.length < 40) {
      const index = cursor++;
      const [pathname, options] = definition.request(index);
      const sample = await timedRequest(api, pathname, options);
      samples.push(sample);
      if (samples.length >= 600) return;
    }
  }
  await Promise.all([
    jobPromise,
    ...Array.from({ length: IMPORT_NAV_CONCURRENCY }, () => virtualUser()),
  ]);
  const job = await jobPromise;
  const duringDurations = samples.filter((item) => item.ok).map((item) => item.durationMs);
  const importP95Ms = duringDurations.length ? percentile(duringDurations, 0.95) : 0;
  const impact = evaluateImportImpact({
    baselineP95Ms: baseline.p95Ms,
    importP95Ms,
    maxDegradationRatio: IMPORT_MAX_DEGRADATION_RATIO,
  });
  const errorRatePct = (samples.filter((item) => !item.ok).length / Math.max(1, samples.length)) * 100;
  const absolutePass = importP95Ms <= IMPORT_ABSOLUTE_P95_MS && errorRatePct <= 1;
  return {
    importLeads,
    concurrency: IMPORT_NAV_CONCURRENCY,
    baselineRequests: baseline.requests,
    activeRequests: samples.length,
    activeErrors: samples.filter((item) => !item.ok).length,
    activeErrorRatePct: Number(errorRatePct.toFixed(2)),
    jobStatus: job.status,
    jobProgressCurrent: job.progressCurrent,
    jobProgressTotal: job.progressTotal,
    impact,
    absoluteP95TargetMs: IMPORT_ABSOLUTE_P95_MS,
    absolutePass,
    pass: job.status === "completed" && impact.pass && absolutePass,
  };
}

async function discoverExternalContext(api) {
  const leads = await api.request("/api/leads?limit=20&offset=0");
  if (!leads.response.ok) throw new Error(`Não foi possível descobrir leads externos: HTTP ${leads.response.status}`);
  const rows = Array.isArray(leads.body?.leads) ? leads.body.leads : Array.isArray(leads.body) ? leads.body : [];
  const pipelines = await api.request("/api/kanban/pipelines");
  if (!pipelines.response.ok) throw new Error(`Não foi possível descobrir pipelines externos: HTTP ${pipelines.response.status}`);
  const pipelineRows = Array.isArray(pipelines.body) ? pipelines.body : pipelines.body?.pipelines || [];
  return {
    pipelineId: String(pipelineRows[0]?.id || ""),
    maxLeadIndex: Math.max(1, rows.length),
    externalLeadIds: rows.map((row) => row.id).filter(Boolean),
  };
}

async function main() {
  const plan = makeRunPlan({
    profile: readArg("profile", process.env.LOAD_TEST_PROFILE || "standard"),
    databaseSizes: readArg("target-leads", process.env.LOAD_TEST_TARGET_LEADS || ""),
    concurrencyLevels: readArg("concurrency", process.env.LOAD_TEST_CONCURRENCY || ""),
    requestsPerScenario: readArg("requests", process.env.LOAD_TEST_REQUESTS || ""),
  });
  const outputPath = readArg("output", process.env.LOAD_TEST_OUTPUT || "LOAD_TEST_REPORT.md");
  const jsonOutputPath = readArg("json-output", process.env.LOAD_TEST_JSON_OUTPUT || "LOAD_TEST_REPORT.json");
  const externalBaseUrl = String(readArg("base-url", process.env.LOAD_TEST_BASE_URL || "")).replace(/\/$/, "");
  const allowWrites = process.env.LOAD_TEST_ALLOW_WRITES === "1" || hasFlag("allow-writes");

  if (hasFlag("dry-run") || (process.env.RUN_LOAD_TEST !== "1" && !externalBaseUrl)) {
    console.log(JSON.stringify({ mode: "dry-run", ...plan, ciReferenceLeads: CI_REFERENCE_LEADS, targetsMs: PERFORMANCE_TARGETS_MS, importConcurrency: IMPORT_NAV_CONCURRENCY }, null, 2));
    return;
  }

  let cluster = null;
  let connection = null;
  let mysqlClient = null;
  let baseUrl = externalBaseUrl;
  let adminEmail = readArg("email", process.env.LOAD_TEST_EMAIL || "");
  let adminPassword = readArg("password", process.env.LOAD_TEST_PASSWORD || "");
  const mode = externalBaseUrl ? "external" : "disposable";

  try {
    if (!externalBaseUrl) {
      const mysqlModule = await import("mysql2/promise");
      mysqlClient = mysqlModule.default || mysqlModule;
      cluster = await startDisposableCluster(mysqlClient);
      baseUrl = cluster.baseUrl;
      adminEmail = cluster.adminEmail;
      adminPassword = cluster.adminPassword;
      connection = await mysqlClient.createConnection({ ...cluster.sandbox.config, database: cluster.sandbox.database });
    } else if (!adminEmail || !adminPassword) {
      throw new Error("Modo externo exige LOAD_TEST_EMAIL e LOAD_TEST_PASSWORD (ou --email/--password).");
    }

    const api = createApiClient(baseUrl);
    await api.login(adminEmail, adminPassword);
    const runToken = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    let metadata;
    let currentSeedCount = 0;
    if (connection) metadata = await getSeedMetadata(connection);
    else metadata = await discoverExternalContext(api);
    if (!metadata.pipelineId) throw new Error("Nenhum pipeline ativo disponível para o teste de Kanban.");

    const report = {
      generatedAt: new Date().toISOString(),
      profile: plan.profile,
      mode,
      plan,
      targetsMs: PERFORMANCE_TARGETS_MS,
      bases: [],
      importScenario: null,
      pass: true,
    };

    const sizes = mode === "external" ? [Number(readArg("external-leads", "0")) || 0] : plan.databaseSizes;
    for (const targetLeads of sizes) {
      let seedSeconds = 0;
      if (connection) {
        const seeded = await seedToTarget(connection, currentSeedCount, targetLeads, metadata);
        currentSeedCount = seeded.count;
        seedSeconds = seeded.seedSeconds;
        const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM leads WHERE deleted_at = ''");
        if (Number(countRows[0]?.total || 0) < targetLeads) throw new Error(`Seed incompleto: ${countRows[0]?.total}/${targetLeads}`);
      }

      const context = {
        pipelineId: metadata.pipelineId,
        maxLeadIndex: mode === "external" ? Math.max(1, metadata.externalLeadIds?.length || 1) : Math.max(1, targetLeads),
        externalLeadIds: mode === "external" ? metadata.externalLeadIds : null,
        runToken: `${runToken}-${targetLeads}`,
      };
      const baseReport = { leads: targetLeads, seedSeconds, runs: [] };

      for (const concurrency of plan.concurrencyLevels) {
        const definitions = scenarioDefinitions(context, mode === "disposable" || allowWrites);
        const run = { concurrency, results: [] };
        for (const definition of definitions) {
          const requestCount = Math.max(plan.requestsPerScenario, concurrency);
          const result = await runScenario(api, definition, { concurrency, requests: requestCount });
          run.results.push(result);
          if (!result.pass) report.pass = false;
        }
        baseReport.runs.push(run);
      }
      report.bases.push(baseReport);
    }

    if (mode === "disposable" || allowWrites) {
      const maxLeads = connection ? currentSeedCount : Math.max(1, metadata.externalLeadIds?.length || 1);
      report.importScenario = await runImportScenario(api, {
        pipelineId: metadata.pipelineId,
        maxLeadIndex: maxLeads,
        externalLeadIds: mode === "external" ? metadata.externalLeadIds : null,
        runToken: `${runToken}-import`,
      }, plan.importLeads);
      if (!report.importScenario.pass) report.pass = false;
    }

    const markdown = buildLoadTestMarkdown(report);
    await Promise.all([
      writeFile(outputPath, markdown, "utf8"),
      writeFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    ]);
    process.stdout.write(markdown);
    console.log(`Relatórios: ${outputPath} | ${jsonOutputPath}`);
    if (!report.pass) process.exitCode = 1;
  } finally {
    await connection?.end().catch(() => undefined);
    await cluster?.stop().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
