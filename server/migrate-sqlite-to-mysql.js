  import { readFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import mysql from "mysql2/promise";
import { calculateLeadCommercialProfile, commercialProfileToDbParams } from "./domains/leads/leadCommercialProfile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(__dirname, ".env"));

const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = sanitizeIdentifier(process.env.MYSQL_DATABASE || "crm_casa_ads");
const SQLITE_FILE = path.resolve(projectRoot, process.env.SQLITE_FILE || path.join("server", "data", "crm.sqlite"));
const MIGRATION_OVERWRITE_EXISTING = process.env.MIGRATION_OVERWRITE_EXISTING === "1";
const MIGRATION_BACKUP_CONFIRMED = process.env.MIGRATION_BACKUP_CONFIRMED === "1";

// Quantidade lida do SQLite por vez. Pode ser alta porque ainda será quebrada em INSERTs menores.
const SQLITE_READ_BATCH_SIZE = Math.max(50, Number(process.env.MIGRATION_READ_BATCH_SIZE || process.env.MIGRATION_BATCH_SIZE || 1000));

// Segurança extra para evitar erro "Got a packet bigger than max_allowed_packet".
// O script também consulta @@max_allowed_packet e calcula automaticamente um limite seguro.
const INSERT_ROWS_LIMIT = Math.max(1, Number(process.env.MIGRATION_INSERT_ROWS_LIMIT || 100));
const ENV_INSERT_PAYLOAD_LIMIT = Number(process.env.MIGRATION_INSERT_PAYLOAD_BYTES || 0);
const MIN_INSERT_PAYLOAD_LIMIT = 64 * 1024;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function sanitizeIdentifier(value) {
  const safe = String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
  return safe || "crm_casa_ads";
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeEmailKey(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeNameCompanyKey(row) {
  const name = normalizeSearchText(row.name || "");
  const company = normalizeSearchText(row.company || "");
  return name && company ? `${name}|${company}` : "";
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sqliteRows(db, sql, params = []) {
  const rows = [];
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

async function initializeMysql() {
  const bootstrapPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4",
    multipleStatements: true,
  });
  await bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrapPool.end();

  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
    multipleStatements: true,
  });

  const schema = await readFile(path.join(__dirname, "schema.mysql.sql"), "utf8");
  await pool.query(schema);
  return pool;
}

async function getMysqlMaxAllowedPacket(pool) {
  try {
    const [rows] = await pool.query("SELECT @@max_allowed_packet AS max_allowed_packet");
    const value = Number(rows?.[0]?.max_allowed_packet || 0);
    return value > 0 ? value : 1024 * 1024;
  } catch {
    return 1024 * 1024;
  }
}

function calculateSafePayloadLimit(maxAllowedPacket) {
  if (ENV_INSERT_PAYLOAD_LIMIT > 0) return Math.max(MIN_INSERT_PAYLOAD_LIMIT, ENV_INSERT_PAYLOAD_LIMIT);

  // Usa uma margem conservadora porque o pacote final do MySQL é maior que o JSON estimado em JS.
  const automaticLimit = Math.floor(Number(maxAllowedPacket || 1024 * 1024) * 0.35);
  return Math.max(MIN_INSERT_PAYLOAD_LIMIT, automaticLimit);
}

function buildLeadInsertSql() {
  const insertMode = MIGRATION_OVERWRITE_EXISTING ? "INSERT" : "INSERT IGNORE";
  const duplicateClause = MIGRATION_OVERWRITE_EXISTING ? `
  ON DUPLICATE KEY UPDATE
    name = VALUES(name), email = VALUES(email), email_key = VALUES(email_key), phone = VALUES(phone), phone_key = VALUES(phone_key),
    company = VALUES(company), name_company_key = VALUES(name_company_key), website = VALUES(website), instagram = VALUES(instagram),
    advertises_on_meta = VALUES(advertises_on_meta), advertises_on_google = VALUES(advertises_on_google), does_not_advertise = VALUES(does_not_advertise),
    does_not_advertise_on_meta = VALUES(does_not_advertise_on_meta), does_not_advertise_on_google = VALUES(does_not_advertise_on_google),
    last_contact_at = VALUES(last_contact_at), contact_made_at = VALUES(contact_made_at), next_contact_at = VALUES(next_contact_at), estimated_budget = VALUES(estimated_budget),
    is_lost = VALUES(is_lost), lost_reason = VALUES(lost_reason), commercial_notes = VALUES(commercial_notes), status = VALUES(status), responsible = VALUES(responsible),
    temperature = VALUES(temperature), pain = VALUES(pain), source = VALUES(source), service_interests = VALUES(service_interests), service_status_map = VALUES(service_status_map),
    custom_fields = VALUES(custom_fields), created_at = VALUES(created_at), updated_at = VALUES(updated_at), deleted_at = VALUES(deleted_at), deleted_by = VALUES(deleted_by),
    restored_at = VALUES(restored_at), restored_by = VALUES(restored_by),
    commercial_profile_version = VALUES(commercial_profile_version), commercial_profile_updated_at = VALUES(commercial_profile_updated_at),
    commercial_potential_score = VALUES(commercial_potential_score), mapping_urgency_score = VALUES(mapping_urgency_score),
    lead_priority_score = VALUES(lead_priority_score), opportunity_score = VALUES(opportunity_score),
    service_casa_count = VALUES(service_casa_count), service_agency_count = VALUES(service_agency_count),
    service_missing_count = VALUES(service_missing_count), service_unknown_count = VALUES(service_unknown_count),
    has_expansion_opportunity = VALUES(has_expansion_opportunity), has_migration_opportunity = VALUES(has_migration_opportunity),
    has_external_agency = VALUES(has_external_agency)` : "";

  return `${insertMode} INTO leads (
    id, name, email, email_key, phone, phone_key, company, name_company_key, website, instagram,
    advertises_on_meta, advertises_on_google, does_not_advertise, does_not_advertise_on_meta, does_not_advertise_on_google,
    last_contact_at, contact_made_at, next_contact_at, estimated_budget,
    is_lost, lost_reason, commercial_notes, status, responsible, temperature,
    pain, source, service_interests, service_status_map, custom_fields, created_at, updated_at,
    deleted_at, deleted_by, restored_at, restored_by,
    commercial_profile_version, commercial_profile_updated_at, commercial_potential_score, mapping_urgency_score,
    lead_priority_score, opportunity_score, service_casa_count, service_agency_count, service_missing_count, service_unknown_count,
    has_expansion_opportunity, has_migration_opportunity, has_external_agency
  ) VALUES ?${duplicateClause}`;
}

const leadInsertSql = buildLeadInsertSql();

function leadRowValues(row) {
  const serviceInterests = parseJsonValue(row.service_interests, []);
  const serviceStatusMap = parseJsonValue(row.service_status_map, {});
  const customFields = parseJsonValue(row.custom_fields, {});
  const createdAt = normalizeDate(row.created_at);
  const updatedAt = normalizeDate(row.updated_at || createdAt);
  const commercialProfile = calculateLeadCommercialProfile({
    website: row.website || "",
    advertisesOnMeta: Boolean(Number(row.advertises_on_meta || 0)),
    advertisesOnGoogle: Boolean(Number(row.advertises_on_google || 0)),
    estimatedBudget: row.estimated_budget || "",
    responsible: row.responsible || "",
    responsibleUserId: row.responsible_user_id || "",
    temperature: row.temperature || "",
    pain: row.pain || "",
    source: row.source || "",
    nextContactAt: row.next_contact_at || "",
    serviceStatusMap,
  });

  return [
    row.id || randomUUID(),
    row.name || "",
    row.email || "",
    normalizeEmailKey(row.email),
    row.phone || "",
    normalizePhoneKey(row.phone),
    row.company || "",
    normalizeNameCompanyKey(row),
    row.website || "",
    row.instagram || "",
    Number(row.advertises_on_meta || 0),
    Number(row.advertises_on_google || 0),
    Number(row.does_not_advertise || 0),
    Number(row.does_not_advertise_on_meta ?? row.does_not_advertise ?? 0),
    Number(row.does_not_advertise_on_google ?? row.does_not_advertise ?? 0),
    row.last_contact_at || "",
    row.contact_made_at || "",
    row.next_contact_at || "",
    row.estimated_budget || "",
    Number(row.is_lost || 0),
    row.lost_reason || "",
    row.commercial_notes || "",
    row.status || "Novo lead",
    row.responsible || "",
    row.temperature || "",
    row.pain || "",
    row.source || "",
    JSON.stringify(serviceInterests),
    JSON.stringify(serviceStatusMap),
    JSON.stringify(customFields),
    createdAt,
    updatedAt,
    row.deleted_at || "",
    row.deleted_by || "",
    row.restored_at || "",
    row.restored_by || "",
    ...commercialProfileToDbParams(commercialProfile, updatedAt),
  ];
}

function estimateMysqlPayloadBytes(values) {
  // Estimativa conservadora para não chegar perto do max_allowed_packet.
  return Buffer.byteLength(JSON.stringify(values), "utf8") + values.length * 64 + 512;
}

function chunkRowsForMysql(valueRows, safePayloadLimit) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  for (const values of valueRows) {
    const rowBytes = estimateMysqlPayloadBytes(values);

    if (current.length && (current.length >= INSERT_ROWS_LIMIT || currentBytes + rowBytes > safePayloadLimit)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(values);
    currentBytes += rowBytes;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

async function insertLeadRows(pool, valueRows, safePayloadLimit) {
  const chunks = chunkRowsForMysql(valueRows, safePayloadLimit);

  for (const chunk of chunks) {
    try {
      await pool.query(leadInsertSql, [chunk]);
    } catch (error) {
      if (error?.code !== "ER_NET_PACKET_TOO_LARGE" || chunk.length === 1) throw error;

      // Fallback extra: se mesmo o chunk calculado estourar, divide recursivamente.
      const middle = Math.ceil(chunk.length / 2);
      await insertLeadRows(pool, chunk.slice(0, middle), safePayloadLimit);
      await insertLeadRows(pool, chunk.slice(middle), safePayloadLimit);
    }
  }
}

async function insertGenericRows(pool, tableName, rows, columns, keyColumn = "id") {
  if (!rows.length) return;
  const escapedColumns = columns.map((column) => `\`${column}\``);
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== keyColumn)
    .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
    .join(", ");
  const insertMode = MIGRATION_OVERWRITE_EXISTING ? "INSERT" : "INSERT IGNORE";
  const duplicateClause = MIGRATION_OVERWRITE_EXISTING ? ` ON DUPLICATE KEY UPDATE ${updates}` : "";
  const sql = `${insertMode} INTO \`${tableName}\` (${escapedColumns.join(", ")}) VALUES (${placeholders})${duplicateClause}`;

  for (const row of rows) {
    await pool.execute(sql, columns.map((column) => {
      const value = row[column] ?? "";
      if (column === "changes_json" && !String(value).trim()) return "{}";
      return value;
    }));
  }
}

async function main() {
  if (MIGRATION_OVERWRITE_EXISTING && !MIGRATION_BACKUP_CONFIRMED) {
    throw new Error("MIGRATION_OVERWRITE_EXISTING=1 exige MIGRATION_BACKUP_CONFIRMED=1 após um backup validado do MySQL.");
  }

  if (!existsSync(SQLITE_FILE)) {
    console.error(`SQLite não encontrado em: ${SQLITE_FILE}`);
    process.exit(1);
  }

  await mkdir(path.dirname(SQLITE_FILE), { recursive: true }).catch(() => undefined);
  const SQL = await initSqlJs({ locateFile: (file) => path.join(projectRoot, "node_modules", "sql.js", "dist", file) });
  const sqliteBytes = await readFile(SQLITE_FILE);
  const sqliteDb = new SQL.Database(sqliteBytes);
  const pool = await initializeMysql();

  const maxAllowedPacket = await getMysqlMaxAllowedPacket(pool);
  const safePayloadLimit = calculateSafePayloadLimit(maxAllowedPacket);

  const [destinationCountRows] = await pool.query("SELECT COUNT(*) AS total FROM leads");
  const destinationLeadCountBefore = Number(destinationCountRows?.[0]?.total || 0);

  console.log(`Migrando SQLite para MySQL: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
  console.log(`Modo: ${MIGRATION_OVERWRITE_EXISTING ? "sobrescrita explícita" : "seguro, somente novos registros"}`);
  console.log(`max_allowed_packet detectado: ${maxAllowedPacket} bytes`);
  console.log(`Limite seguro por INSERT: ${safePayloadLimit} bytes | Máximo de linhas por INSERT: ${INSERT_ROWS_LIMIT}`);

  const leadCount = sqliteRows(sqliteDb, "SELECT COUNT(*) AS total FROM leads")[0]?.total || 0;
  let offset = 0;
  let migratedLeads = 0;

  while (offset < leadCount) {
    const rows = sqliteRows(sqliteDb, "SELECT * FROM leads ORDER BY created_at ASC LIMIT ? OFFSET ?", [SQLITE_READ_BATCH_SIZE, offset]);
    if (!rows.length) break;

    const valueRows = rows.map(leadRowValues);
    await insertLeadRows(pool, valueRows, safePayloadLimit);

    migratedLeads += rows.length;
    offset += rows.length;
    console.log(`Leads migrados: ${migratedLeads}/${leadCount}`);
  }

  const users = sqliteRows(sqliteDb, "SELECT * FROM users ORDER BY created_at ASC");
  await insertGenericRows(pool, "users", users, ["id", "name", "email", "role", "password_hash", "is_active", "created_at", "updated_at", "last_login_at"]);

  const audit = sqliteRows(sqliteDb, "SELECT * FROM audit_log ORDER BY created_at ASC");
  for (let i = 0; i < audit.length; i += SQLITE_READ_BATCH_SIZE) {
    await insertGenericRows(pool, "audit_log", audit.slice(i, i + SQLITE_READ_BATCH_SIZE), ["id", "entity_type", "entity_id", "action", "actor_id", "actor_name", "changes_json", "summary", "created_at"]);
  }

  const backups = sqliteRows(sqliteDb, "SELECT * FROM backups ORDER BY created_at ASC");
  await insertGenericRows(pool, "backups", backups, ["id", "file_name", "file_path", "type", "size_bytes", "created_at"]);

  const [destinationAfterRows] = await pool.query("SELECT COUNT(*) AS total FROM leads");
  const destinationLeadCountAfter = Number(destinationAfterRows?.[0]?.total || 0);
  if (destinationLeadCountAfter < destinationLeadCountBefore) {
    throw new Error("Validação falhou: a quantidade de leads no MySQL diminuiu durante a migração.");
  }

  await pool.end();
  console.log(`Validação de contagem: SQLite=${leadCount}, MySQL antes=${destinationLeadCountBefore}, MySQL depois=${destinationLeadCountAfter}.`);
  console.log("Migração concluída sem redução da quantidade de leads no destino.");
}

main().catch((error) => {
  console.error("Erro ao migrar:", error);

  if (error?.code === "ER_NET_PACKET_TOO_LARGE") {
    console.error("\nCorreção rápida: o pacote enviado ao MySQL ficou maior que o permitido.");
    console.error("Este script já tenta dividir automaticamente. Para forçar pacotes ainda menores, adicione no server/.env:");
    console.error("MIGRATION_INSERT_ROWS_LIMIT=25");
    console.error("MIGRATION_INSERT_PAYLOAD_BYTES=131072");
    console.error("Depois rode novamente: npm run migrate:sqlite:mysql\n");
  }

  process.exit(1);
});
