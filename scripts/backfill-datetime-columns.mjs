import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { DATETIME_TABLE_FIELDS, buildIsoToMysqlDateExpression } from "../server/dateColumns.js";

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

const BATCH_SIZE = boundedInt(readArg("batch-size", process.env.DATETIME_BACKFILL_BATCH_SIZE || "500"), 500, 50, 2000);
const PAUSE_MS = boundedInt(readArg("pause-ms", process.env.DATETIME_BACKFILL_PAUSE_MS || "25"), 25, 0, 5000);
const VERIFY_ONLY = process.argv.includes("--verify-only");
const FORCE_ALL = process.argv.includes("--force-all");

const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = sanitizeIdentifier(process.env.MYSQL_DATABASE || "crm_casa_ads");

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function pendingClause(fields, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return fields.map(([legacy, datetime]) => `(TRIM(COALESCE(${prefix}${legacy}, '')) != '' AND ${prefix}${datetime} IS NULL)`).join(" OR ");
}

async function assertSchema(pool) {
  for (const [table, fields] of Object.entries(DATETIME_TABLE_FIELDS)) {
    const [rows] = await pool.execute(
      "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
      [MYSQL_DATABASE, table],
    );
    const present = new Set(rows.map((row) => row.column_name));
    const required = new Set(fields.flat());
    const missing = [...required].filter((column) => !present.has(column));
    if (missing.length) throw new Error(`Migration da Fase 8 ainda não aplicada em ${table}. Colunas ausentes: ${missing.join(", ")}`);
  }
}

async function tableStatus(pool, table, fields) {
  const fieldMetrics = fields.map(([legacy, datetime]) =>
    `SUM(CASE WHEN TRIM(COALESCE(${legacy}, '')) != '' AND ${datetime} IS NULL THEN 1 ELSE 0 END) AS pending_${datetime}`,
  );
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ${pendingClause(fields)} THEN 1 ELSE 0 END) AS pending_rows,
            ${fieldMetrics.join(",\n            ")}
       FROM ${table}`,
  );
  const pendingByField = {};
  for (const [, datetime] of fields) pendingByField[datetime] = Number(row?.[`pending_${datetime}`] || 0);
  return {
    total: Number(row?.total || 0),
    pendingRows: Number(row?.pending_rows || 0),
    pendingByField,
  };
}

async function getStatus(pool) {
  return {
    leads: await tableStatus(pool, "leads", DATETIME_TABLE_FIELDS.leads),
    tasks: await tableStatus(pool, "tasks", DATETIME_TABLE_FIELDS.tasks),
  };
}

async function sampleInvalid(pool, table, fields, limit = 10) {
  const [rows] = await pool.execute(
    `SELECT id, ${fields.map(([legacy]) => legacy).join(", ")}
       FROM ${table}
      WHERE ${pendingClause(fields)}
      ORDER BY id ASC
      LIMIT ?`,
    [limit],
  );
  return rows;
}

async function backfillTable(pool, table, fields) {
  let processed = 0;
  let batches = 0;
  let lastId = "";
  while (true) {
    const pending = FORCE_ALL ? "1 = 1" : pendingClause(fields);
    const [rows] = await pool.execute(
      `SELECT id FROM ${table}
        WHERE id > ? AND (${pending})
        ORDER BY id ASC
        LIMIT ?`,
      [lastId, BATCH_SIZE],
    );
    if (!rows.length) break;

    const ids = rows.map((row) => String(row.id));
    const assignments = fields.map(([legacy, datetime]) => `${datetime} = ${buildIsoToMysqlDateExpression(legacy)}`);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE ${table}
            SET ${assignments.join(",\n                ")}
          WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }

    lastId = ids.at(-1) || lastId;
    processed += ids.length;
    batches += 1;
    if (batches === 1 || batches % 10 === 0 || ids.length < BATCH_SIZE) {
      console.log(`${table}: ${processed} registro(s) processados em ${batches} batch(es).`);
    }
    await sleep(PAUSE_MS);
  }
  return { processed, batches };
}

async function run() {
  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 10,
    charset: "utf8mb4",
  });

  try {
    await pool.query("SELECT 1");
    await assertSchema(pool);
    const before = await getStatus(pool);
    console.log("Backfill DATETIME(3)", { database: MYSQL_DATABASE, batchSize: BATCH_SIZE, pauseMs: PAUSE_MS, forceAll: FORCE_ALL, before });

    if (!VERIFY_ONLY) {
      const results = {};
      results.leads = await backfillTable(pool, "leads", DATETIME_TABLE_FIELDS.leads);
      results.tasks = await backfillTable(pool, "tasks", DATETIME_TABLE_FIELDS.tasks);
      console.log("Processamento concluído", results);
    }

    const after = await getStatus(pool);
    const pending = after.leads.pendingRows + after.tasks.pendingRows;
    console.log("Validação DATETIME(3)", after);
    if (pending > 0) {
      const invalid = {
        leads: await sampleInvalid(pool, "leads", DATETIME_TABLE_FIELDS.leads),
        tasks: await sampleInvalid(pool, "tasks", DATETIME_TABLE_FIELDS.tasks),
      };
      console.error("Existem datas legadas não convertidas. Corrija os valores inválidos antes de ativar os filtros DATETIME.", invalid);
      process.exitCode = 2;
      return;
    }
    process.exitCode = 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Falha no backfill DATETIME(3):", error?.message || error);
  process.exitCode = 1;
});
