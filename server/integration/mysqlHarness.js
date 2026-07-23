import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function safeIdentifier(value) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

export async function findAvailablePort() {
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

export function getMysqlTestConfig() {
  return {
    host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || "root",
    password: process.env.MYSQL_TEST_PASSWORD || "",
  };
}

export async function createDisposableDatabase(prefix = "crm_phase6") {
  const config = getMysqlTestConfig();
  const database = safeIdentifier(`${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`);
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

async function waitForReady(baseUrl, child, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Servidor de teste encerrou com código ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = new Error(`readiness retornou HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor não ficou pronto em ${timeoutMs} ms: ${lastError?.message || "sem resposta"}`);
}

export async function startDisposableCrm(options = {}) {
  const sandbox = options.sandbox || await createDisposableDatabase(options.prefix || "crm_phase6");
  const port = options.port || await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const storageRoot = path.join(os.tmpdir(), `crm-phase6-storage-${randomUUID()}`);
  await mkdir(path.join(storageRoot, "jobs"), { recursive: true });
  await mkdir(path.join(storageRoot, "backups"), { recursive: true });

  const adminEmail = options.adminEmail || `admin.${randomUUID().slice(0, 8)}@example.test`;
  const adminPassword = options.adminPassword || `Aa1!${randomBytes(18).toString("base64url")}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SERVER_PORT: String(port),
    MYSQL_HOST: sandbox.config.host,
    MYSQL_PORT: String(sandbox.config.port),
    MYSQL_USER: sandbox.config.user,
    MYSQL_PASSWORD: sandbox.config.password,
    MYSQL_DATABASE: sandbox.database,
    MYSQL_CONNECTION_LIMIT: "8",
    MYSQL_CONNECT_TIMEOUT_MS: "5000",
    CRM_ADMIN_EMAIL: adminEmail,
    CRM_ADMIN_PASSWORD: adminPassword,
    CRM_ADMIN_NAME: "Administrador Fase 6",
    SESSION_COOKIE_SECURE: "0",
    SEARCH_INDEX_REBUILD_ON_START: "0",
    BACKUP_EXTERNAL_DIR: path.join(storageRoot, "backups"),
    BACKUP_REQUIRE_EXTERNAL_STORAGE: "0",
    BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    JOB_ARTIFACT_DIR: path.join(storageRoot, "jobs"),
    JOB_POLL_INTERVAL_MS: "100",
    JOB_HEARTBEAT_INTERVAL_MS: "1000",
    JOB_STALE_AFTER_MS: "30000",
    RATE_LIMIT_CLEANUP_INTERVAL_MS: "60000",
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: "10000",
    TRUST_PROXY: "0",
  };

  const logs = [];
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    await waitForReady(baseUrl, child, options.timeoutMs);
  } catch (error) {
    child.kill("SIGTERM");
    await sandbox.drop();
    await rm(storageRoot, { recursive: true, force: true });
    throw new Error(`${error.message}\n${logs.join("").slice(-4000)}`);
  }

  return {
    sandbox,
    child,
    baseUrl,
    adminEmail,
    adminPassword,
    logs,
    async stop({ dropDatabase = true } = {}) {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 12_000)),
        ]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      await rm(storageRoot, { recursive: true, force: true });
      if (dropDatabase) await sandbox.drop();
    },
  };
}

function mergeSetCookie(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = values.length ? values : [headers.get("set-cookie") || ""];
  return source.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

export function createApiClient(baseUrl) {
  let cookie = "";
  let csrfToken = "";
  return {
    get cookie() { return cookie; },
    get csrfToken() { return csrfToken; },
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
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      return { response, body };
    },
    async login(email, password) {
      const result = await this.request("/api/auth/login", { method: "POST", body: { email, password } });
      if (!result.response.ok) throw new Error(`Login falhou (${result.response.status}): ${JSON.stringify(result.body)}`);
      csrfToken = result.body.csrfToken;
      return result.body;
    },
    async expect(pathname, options = {}, expectedStatus = 200) {
      const result = await this.request(pathname, options);
      if (result.response.status !== expectedStatus) {
        throw new Error(`${options.method || "GET"} ${pathname} retornou ${result.response.status}, esperado ${expectedStatus}: ${JSON.stringify(result.body)}`);
      }
      return result.body;
    },
  };
}

export function deterministicKey(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
