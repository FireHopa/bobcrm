import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import {
  COMMERCIAL_PROFILE_DB_FIELDS,
  COMMERCIAL_PROFILE_SOURCE_FIELDS,
  COMMERCIAL_PROFILE_VERSION,
  calculateLeadCommercialProfile,
  commercialProfileToDbParams,
  rowToCommercialProfileLead,
} from "../server/domains/leads/leadCommercialProfile.js";

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

const BATCH_SIZE = boundedInt(readArg("batch-size", process.env.COMMERCIAL_PROFILE_BACKFILL_BATCH_SIZE || "500"), 500, 50, 2000);
const PAUSE_MS = boundedInt(readArg("pause-ms", process.env.COMMERCIAL_PROFILE_BACKFILL_PAUSE_MS || "25"), 25, 0, 5000);
const MAX_ROWS = boundedInt(readArg("limit", "0"), 0, 0, 10_000_000);
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

async function assertSchema(pool) {
  const required = new Set([...COMMERCIAL_PROFILE_SOURCE_FIELDS, ...COMMERCIAL_PROFILE_DB_FIELDS]);
  const [rows] = await pool.execute(
    "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads'",
    [MYSQL_DATABASE],
  );
  const present = new Set(rows.map((row) => row.column_name));
  const missing = [...required].filter((column) => !present.has(column));
  if (missing.length) {
    throw new Error(`Migration da Fase 2 ainda não aplicada. Colunas ausentes: ${missing.join(", ")}`);
  }
}

async function getStatus(pool) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN commercial_profile_version = ? THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN commercial_profile_version <> ? THEN 1 ELSE 0 END) AS pending
       FROM leads`,
    [COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION],
  );
  return {
    total: Number(row?.total || 0),
    ready: Number(row?.ready || 0),
    pending: Number(row?.pending || 0),
  };
}

function buildBatchUpdate(rows) {
  const selectColumns = ["id", ...COMMERCIAL_PROFILE_DB_FIELDS];
  const selectFragments = rows.map((_, index) => {
    const placeholders = selectColumns.map((column, columnIndex) => {
      if (index === 0) return `? AS \`${column}\``;
      return "?";
    });
    return `SELECT ${placeholders.join(", ")}`;
  });

  const params = [];
  for (const row of rows) {
    const profile = calculateLeadCommercialProfile(rowToCommercialProfileLead(row));
    const profileUpdatedAt = new Date().toISOString();
    params.push(String(row.id), ...commercialProfileToDbParams(profile, profileUpdatedAt));
  }

  const assignments = COMMERCIAL_PROFILE_DB_FIELDS
    .map((field) => `l.\`${field}\` = p.\`${field}\``)
    .join(",\n      ");

  return {
    sql: `UPDATE leads l\n      INNER JOIN (\n        ${selectFragments.join("\n        UNION ALL\n        ")}\n      ) p ON p.id = l.id\n      SET ${assignments}`,
    params,
  };
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
    console.log("Backfill inteligência comercial", {
      database: MYSQL_DATABASE,
      version: COMMERCIAL_PROFILE_VERSION,
      batchSize: BATCH_SIZE,
      pauseMs: PAUSE_MS,
      forceAll: FORCE_ALL,
      before,
    });

    if (VERIFY_ONLY) {
      process.exitCode = before.pending === 0 ? 0 : 2;
      return;
    }

    let processed = 0;
    let batches = 0;
    let lastId = "";
    while (MAX_ROWS === 0 || processed < MAX_ROWS) {
      const remainingLimit = MAX_ROWS > 0 ? Math.min(BATCH_SIZE, MAX_ROWS - processed) : BATCH_SIZE;
      if (remainingLimit <= 0) break;
      const where = FORCE_ALL ? "id > ?" : "commercial_profile_version <> ?";
      const orderBy = FORCE_ALL ? "id ASC" : "commercial_profile_version ASC, id ASC";
      const params = FORCE_ALL ? [lastId, remainingLimit] : [COMMERCIAL_PROFILE_VERSION, remainingLimit];
      const [rows] = await pool.execute(
        `SELECT ${COMMERCIAL_PROFILE_SOURCE_FIELDS.join(", ")}
           FROM leads
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT ?`,
        params,
      );
      if (!rows.length) break;

      const batch = buildBatchUpdate(rows);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(batch.sql, batch.params);
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }

      processed += rows.length;
      batches += 1;
      if (FORCE_ALL) lastId = String(rows.at(-1)?.id || lastId);
      if (batches === 1 || batches % 10 === 0 || rows.length < remainingLimit) {
        console.log(`Processados ${processed} lead(s) em ${batches} batch(es).`);
      }
      await sleep(PAUSE_MS);

    }

    const after = await getStatus(pool);
    console.log("Backfill concluído", { processed, batches, after });
    process.exitCode = after.pending === 0 ? 0 : 2;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Falha no backfill da inteligência comercial:", error?.message || error);
  process.exitCode = 1;
});
