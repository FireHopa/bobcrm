import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMERCIAL_PROFILE_VERSION } from "../server/domains/leads/leadCommercialProfile.js";
import { buildExplainMarkdown, buildPhase9Scenarios, evaluateScenario, parseExplainAnalyzePlan, PHASE9_TABLES } from "./mysql-explain-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(projectRoot, "server", ".env"));

function sanitizeIdentifier(value) {
  const safe = String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
  return safe || "crm_casa_ads";
}

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = sanitizeIdentifier(process.env.MYSQL_DATABASE || "crm_casa_ads");
const MAX_EXECUTION_TIME_MS = boundedInt(readArg("max-ms", process.env.EXPLAIN_MAX_EXECUTION_TIME_MS || "5000"), 5000, 500, 30000);
const OUTPUT = path.resolve(projectRoot, readArg("output", "MYSQL_EXPLAIN_ANALYZE_REPORT.md"));
const EXPLAIN_ONLY = process.argv.includes("--explain-only");
const ALLOW_INCOMPLETE = process.argv.includes("--allow-incomplete");

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getReadiness(connection) {
  const datetime = await queryOne(connection, `SELECT
    EXISTS(
      SELECT 1 FROM leads
       WHERE (TRIM(COALESCE(next_contact_at, '')) != '' AND next_contact_at_dt IS NULL)
          OR (TRIM(COALESCE(expected_close_at, '')) != '' AND expected_close_at_dt IS NULL)
          OR (TRIM(COALESCE(created_at, '')) != '' AND created_at_dt IS NULL)
          OR (TRIM(COALESCE(updated_at, '')) != '' AND updated_at_dt IS NULL)
      LIMIT 1
    ) AS lead_pending,
    EXISTS(
      SELECT 1 FROM tasks
       WHERE (TRIM(COALESCE(due_at, '')) != '' AND due_at_dt IS NULL)
          OR (TRIM(COALESCE(completed_at, '')) != '' AND completed_at_dt IS NULL)
          OR (TRIM(COALESCE(created_at, '')) != '' AND created_at_dt IS NULL)
          OR (TRIM(COALESCE(updated_at, '')) != '' AND updated_at_dt IS NULL)
      LIMIT 1
    ) AS task_pending`);
  const commercial = await queryOne(connection,
    "SELECT EXISTS(SELECT 1 FROM leads WHERE commercial_profile_version <> ? LIMIT 1) AS pending",
    [COMMERCIAL_PROFILE_VERSION],
  );
  return {
    datetimeReady: !Number(datetime?.lead_pending || 0) && !Number(datetime?.task_pending || 0),
    commercialReady: !Number(commercial?.pending || 0),
  };
}

async function collectSamples(connection) {
  const pipeline = await queryOne(connection,
    "SELECT id FROM kanban_pipelines WHERE is_archived = 0 ORDER BY is_default DESC, position ASC, created_at ASC LIMIT 1");
  const lead = await queryOne(connection, `SELECT email_key, phone_key, name, company, search_text, responsible_user_id
      FROM leads
      WHERE deleted_at = ''
      ORDER BY updated_at_dt DESC, id DESC
      LIMIT 1`);
  const owner = lead?.responsible_user_id
    ? lead
    : await queryOne(connection, `SELECT responsible_user_id
        FROM leads
        WHERE deleted_at = '' AND TRIM(COALESCE(responsible_user_id, '')) != ''
        LIMIT 1`);
  return {
    pipelineId: String(pipeline?.id || ""),
    emailKey: String(lead?.email_key || ""),
    phoneKey: String(lead?.phone_key || ""),
    name: String(lead?.name || ""),
    company: String(lead?.company || ""),
    searchSeed: String(lead?.search_text || ""),
    responsibleUserId: String(owner?.responsible_user_id || ""),
  };
}

async function collectTableStats(connection) {
  const placeholders = PHASE9_TABLES.map(() => "?").join(", ");
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows, DATA_LENGTH, INDEX_LENGTH
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME`,
    [MYSQL_DATABASE, ...PHASE9_TABLES],
  );
  return rows.map((row) => ({
    table: row.table_name,
    rows: Number(row.table_rows || 0),
    dataMb: Number((Number(row.DATA_LENGTH || 0) / 1024 / 1024).toFixed(2)),
    indexMb: Number((Number(row.INDEX_LENGTH || 0) / 1024 / 1024).toFixed(2)),
  }));
}

async function collectIndexes(connection) {
  const placeholders = PHASE9_TABLES.map(() => "?").join(", ");
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, INDEX_TYPE AS index_type,
            SEQ_IN_INDEX AS seq_in_index, COLUMN_NAME AS column_name, CARDINALITY
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [MYSQL_DATABASE, ...PHASE9_TABLES],
  );
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.table_name}:${row.index_name}`;
    if (!grouped.has(key)) grouped.set(key, {
      table: row.table_name,
      index: row.index_name,
      type: row.index_type,
      cardinality: Number(row.CARDINALITY || 0),
      columns: [],
    });
    grouped.get(key).columns.push(row.column_name || "<expression>");
    grouped.get(key).cardinality = Math.max(grouped.get(key).cardinality, Number(row.CARDINALITY || 0));
  }
  return [...grouped.values()].map((item) => ({ ...item, columns: item.columns.join(", ") }));
}

async function collectIndexUsage(connection) {
  try {
    const placeholders = PHASE9_TABLES.map(() => "?").join(", ");
    const [rows] = await connection.execute(
      `SELECT OBJECT_NAME AS object_name, INDEX_NAME AS index_name, COUNT_READ, COUNT_WRITE
         FROM performance_schema.table_io_waits_summary_by_index_usage
        WHERE OBJECT_SCHEMA = ? AND OBJECT_NAME IN (${placeholders})
        ORDER BY OBJECT_NAME, INDEX_NAME`,
      [MYSQL_DATABASE, ...PHASE9_TABLES],
    );
    return rows.map((row) => ({
      table: row.object_name,
      index: row.index_name,
      reads: Number(row.COUNT_READ || 0),
      writes: Number(row.COUNT_WRITE || 0),
    }));
  } catch {
    return [];
  }
}

async function runExplain(connection, scenario) {
  const prefix = EXPLAIN_ONLY ? "EXPLAIN FORMAT=TREE " : "EXPLAIN ANALYZE ";
  const [rows] = await connection.execute(`${prefix}${scenario.sql}`, scenario.params || []);
  return rows.map((row) => String(row.EXPLAIN ?? Object.values(row)[0] ?? "")).join("\n");
}

async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const connection = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    charset: "utf8mb4",
  });

  try {
    const versionRow = await queryOne(connection, "SELECT VERSION() AS version");
    const readiness = await getReadiness(connection);
    if (!ALLOW_INCOMPLETE && (!readiness.datetimeReady || !readiness.commercialReady)) {
      throw new Error(`Pré-requisitos incompletos: datetimeReady=${readiness.datetimeReady}, commercialReady=${readiness.commercialReady}. Execute os verify/backfills das Fases 2 e 8 ou use --allow-incomplete apenas para diagnóstico consciente.`);
    }

    await connection.query(`SET SESSION MAX_EXECUTION_TIME = ${MAX_EXECUTION_TIME_MS}`);
    const samples = await collectSamples(connection);
    const scenarios = buildPhase9Scenarios(samples);
    const results = [];

    for (const scenario of scenarios) {
      try {
        const plan = await runExplain(connection, scenario);
        const summary = EXPLAIN_ONLY ? {
          rootActualEndMs: null,
          rootActualRows: null,
          accessWorkRows: null,
          tableScan: /table scan on/i.test(plan),
          sort: /(^|->\s*)sort:/im.test(plan) || /filesort/i.test(plan),
          temporary: /temporary/i.test(plan),
          indexesUsed: [...new Set([...plan.matchAll(/using\s+(?:covering\s+)?index\s+([`A-Za-z0-9_]+)/gi)].map((match) => match[1].replace(/`/g, "")))],
        } : parseExplainAnalyzePlan(plan);
        const evaluation = EXPLAIN_ONLY
          ? { status: "explain-only", reason: "plano estimado; rode sem --explain-only para actual time/rows" }
          : evaluateScenario(scenario, summary);
        results.push({ ...scenario, params: undefined, plan, summary, evaluation });
      } catch (error) {
        results.push({
          ...scenario,
          params: undefined,
          plan: "",
          summary: {},
          evaluation: { status: "error", reason: error?.code === "ER_QUERY_TIMEOUT" ? `timeout > ${MAX_EXECUTION_TIME_MS}ms` : "erro ao executar EXPLAIN" },
          error: String(error?.message || error),
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      database: MYSQL_DATABASE,
      mysqlVersion: String(versionRow?.version || ""),
      maxExecutionTimeMs: MAX_EXECUTION_TIME_MS,
      explainOnly: EXPLAIN_ONLY,
      readiness,
      tables: await collectTableStats(connection),
      indexes: await collectIndexes(connection),
      indexUsage: await collectIndexUsage(connection),
      scenarios: results,
    };

    const markdown = buildExplainMarkdown(report);
    await writeFile(OUTPUT, markdown, "utf8");
    process.stdout.write(markdown);
    console.log(`\nRelatório salvo em: ${OUTPUT}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
