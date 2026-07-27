import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { LEAD_SEARCH_INDEX_FIELDS } from "../server/domains/leads/leadProjections.js";
import { buildLeadSearchIndexBatchUpdate } from "../server/domains/leads/leadSearchIndex.js";

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

const BATCH_SIZE = boundedInt(readArg("batch-size", process.env.SEARCH_INDEX_BACKFILL_BATCH_SIZE || "250"), 250, 25, 1000);
const PAUSE_MS = boundedInt(readArg("pause-ms", process.env.SEARCH_INDEX_BACKFILL_PAUSE_MS || "25"), 25, 0, 5000);
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
  const [columns] = await pool.execute(
    "SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads'",
    [MYSQL_DATABASE],
  );
  const present = new Set(columns.map((row) => row.column_name));
  const required = new Set([...LEAD_SEARCH_INDEX_FIELDS, "search_text"]);
  const missing = [...required].filter((column) => !present.has(column));
  if (missing.length) throw new Error(`Colunas necessárias para busca ausentes: ${missing.join(", ")}`);

  const [[indexRow]] = await pool.execute(
    `SELECT COUNT(*) AS total
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads' AND INDEX_NAME = 'ft_leads_search_text' AND INDEX_TYPE = 'FULLTEXT'`,
    [MYSQL_DATABASE],
  );
  if (Number(indexRow?.total || 0) < 1) {
    throw new Error("Índice FULLTEXT ft_leads_search_text não encontrado. Reinicie a aplicação para aplicar o schema antes do backfill.");
  }
}

async function getStatus(pool) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN search_text IS NULL OR search_text = '' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN search_text IS NOT NULL AND search_text <> '' THEN 1 ELSE 0 END) AS ready
       FROM leads`,
  );
  return {
    total: Number(row?.total || 0),
    ready: Number(row?.ready || 0),
    pending: Number(row?.pending || 0),
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
    console.log("Backfill índice de busca", {
      database: MYSQL_DATABASE,
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
      const limit = MAX_ROWS > 0 ? Math.min(BATCH_SIZE, MAX_ROWS - processed) : BATCH_SIZE;
      if (limit <= 0) break;
      const pendingClause = FORCE_ALL ? "" : "AND (search_text IS NULL OR search_text = '')";
      const [rows] = await pool.execute(
        `SELECT ${LEAD_SEARCH_INDEX_FIELDS.join(", ")}
           FROM leads
          WHERE id > ? ${pendingClause}
          ORDER BY id ASC
          LIMIT ?`,
        [lastId, limit],
      );
      if (!rows.length) break;

      const batch = buildLeadSearchIndexBatchUpdate(rows, { onlyMissing: !FORCE_ALL });
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

      lastId = String(rows.at(-1)?.id || lastId);
      processed += rows.length;
      batches += 1;
      if (batches === 1 || batches % 10 === 0 || rows.length < limit) {
        console.log(`Processados ${processed} lead(s) em ${batches} batch(es).`);
      }
      await sleep(PAUSE_MS);
    }

    const after = await getStatus(pool);
    console.log("Backfill do índice de busca concluído", { processed, batches, after });
    process.exitCode = after.pending === 0 ? 0 : 2;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Falha no backfill do índice de busca:", error?.message || error);
  process.exitCode = 1;
});
