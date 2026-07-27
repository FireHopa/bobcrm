import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { createPerformanceMonitor } from "./performanceMetrics.js";
import { createTtlCache } from "./runtimeCache.js";
import { normalizeZapePayload, phoneKeyVariants, safeSecretEquals } from "./zapeIntegration.js";
import {
  description as leadScopeMigrationDescription,
  up as runLeadScopeMigration,
  version as leadScopeMigrationVersion,
} from "./migrations/20260706_02_lead_scope_teams.js";
import {
  description as commercialRolesMigrationDescription,
  up as runCommercialRolesMigration,
  version as commercialRolesMigrationVersion,
} from "./migrations/20260706_03_commercial_roles_notes.js";
import {
  description as tasksTodayMigrationDescription,
  up as runTasksTodayMigration,
  version as tasksTodayMigrationVersion,
} from "./migrations/20260706_04_tasks_today.js";
import {
  description as operationalIntegrityMigrationDescription,
  up as runOperationalIntegrityMigration,
  version as operationalIntegrityMigrationVersion,
} from "./migrations/20260707_05_operational_integrity.js";
import {
  description as backupIntegrityMigrationDescription,
  up as runBackupIntegrityMigration,
  version as backupIntegrityMigrationVersion,
} from "./migrations/20260707_06_backup_integrity.js";
import {
  description as securityHardeningMigrationDescription,
  up as runSecurityHardeningMigration,
  version as securityHardeningMigrationVersion,
} from "./migrations/20260707_07_security_hardening.js";
import {
  description as asyncJobsMigrationDescription,
  up as runAsyncJobsMigration,
  version as asyncJobsMigrationVersion,
} from "./migrations/20260707_08_async_jobs.js";
import {
  description as commercialProfileMigrationDescription,
  up as runCommercialProfileMigration,
  version as commercialProfileMigrationVersion,
} from "./migrations/20260723_09_commercial_profile_materialization.js";
import { description as datetimeColumnsMigrationDescription, up as runDatetimeColumnsMigration, version as datetimeColumnsMigrationVersion } from "./migrations/20260724_10_parallel_datetime_columns.js";
import {
  createEncryptedMysqlBackup,
  removeBackupArtifact,
  resolveBackupSettings,
  resolveStoragePath,
  selectBackupsForRetention,
  verifyEncryptedMysqlBackup,
} from "./backup/mysqlBackup.js";
import {
  buildLeadAccessSql,
  describeLeadScope,
  enforceLeadAssignmentForUser,
  normalizeLeadSort,
} from "./accessControl.js";
import {
  ROLE_LABELS,
  USER_ROLES,
  assertKanbanMoveAllowed,
  assertLeadFieldUpdateAllowed,
  getChangedLeadFields,
  getFixedLeadAccessScopeForRole,
  getPermissionsForRole,
  hasRolePermission,
  normalizeUserRole,
  isCanonicalUserRole,
} from "./rolePolicy.js";
import {
  assertTaskAssignmentAllowed,
  assertTaskPayload,
  buildTaskAccessSql,
  canManageAllTasks,
  getTaskBucketWhere,
  normalizeTaskPriority,
  normalizeTaskStatus,
  normalizeTaskType,
} from "./taskPolicy.js";
import { assertLeadHandoffAllowed, assertLeadHandoffPayload } from "./leadHandoffPolicy.js";
import {
  assertAssignmentUsesHandoff,
  assertConsultantCanBeDeactivated,
  assertHandoffTargetStage,
  buildHandoffTaskSourceKey,
  isClosedLead,
} from "./operationalIntegrity.js";
import { buildLeadDashboardSummarySql, mapLeadDashboardSummaryRow } from "./dashboardSummarySql.js";
import {
  buildAdminLeadOverviewSql,
  buildOpportunityQuickFilterSql,
  mapAdminLeadOverviewRow,
} from "./opportunityRules.js";
import {
  buildDuplicateGroupsCountSql,
  buildDuplicateGroupsPageSql,
  buildDuplicateLeadLookup,
  mapDuplicateGroups,
} from "./duplicateDetection.js";
import {
  buildSecurityHeaders,
  evaluateCorsOrigin,
  parseBoundedInteger as parseSecurityBoundedInteger,
  sanitizeDownloadFileName,
  sanitizeSpreadsheetCell,
  validateBootstrapAdminConfig,
  validatePasswordStrength,
} from "./security.js";
import {
  assertCsrfToken,
  createSessionSecrets,
  deriveCsrfToken,
  createTrustedProxyPolicy,
  getCookieValue,
  hashOpaqueToken,
  normalizeSameSite,
  resolveClientIp,
  resolveRequestProtocol,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./sessionSecurity.js";
import {
  cleanupExpiredRateLimits,
  consumeMysqlRateLimit,
  createRateLimitBucket,
  createRateLimitError,
} from "./mysqlRateLimit.js";
import {
  buildMysqlPoolOptions,
  isRetryableMysqlConnectionError,
  isRetryableMysqlTransactionError,
  withMysqlRetry,
  withMysqlTransactionRetry,
} from "./mysqlReliability.js";
import {
  JOB_TYPES,
  claimNextJob,
  completeJob,
  createJobWorker,
  deleteExpiredJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  listExpiredJobs,
  recoverStaleJobs,
  rowToJob,
  updateJobProgress,
} from "./jobQueue.js";
import {
  createJobStorageKey,
  describeJobArtifact,
  ensureJobArtifactStorage,
  jobArtifactExpiryIso,
  jobRecordExpiryIso,
  prepareJobStoragePath,
  readJsonJobPayload,
  removeJobArtifact,
  resolveJobArtifactSettings,
  resolveJobStoragePath,
  writeJsonJobPayload,
} from "./jobArtifacts.js";
import { writeCsvExport, writeXlsxExport } from "./leadExport.js";
import { sendBufferResponse } from "./httpCompression.js";
import { createStaticAssetsHandler } from "./http/staticAssets.js";
import {
  customFieldLabels,
  leadToDbParams,
  normalizeEmailKey,
  normalizeLead,
  normalizeBooleanText,
  normalizeCustomFields,
  normalizeNameCompanyKey,
  normalizePhoneKey,
  nowIso,
  parseJsonValue,
  rowToLead,
} from "./domains/leads/leadMapper.js";
import {
  LEAD_DUPLICATE_FIELDS,
  LEAD_KANBAN_SELECT,
  LEAD_SEARCH_INDEX_SELECT,
  LEAD_TRASH_SELECT,
  getLeadListProjection,
  qualifyLeadFields,
} from "./domains/leads/leadProjections.js";
import { UPSERT_LEAD_SQL } from "./domains/leads/leadPersistenceSql.js";
import {
  addLeadToImportDuplicateIndex,
  buildImportDuplicateLookup,
  buildLeadBatchUpsert,
  buildNewLeadFollowUpTaskInsert,
  createImportDuplicateIndex,
  findImportDuplicateLead,
  getImportPrimaryKey,
  persistImportLeadBatch,
} from "./domains/leads/importBatch.js";
import { buildLeadSearchPlan, chooseLeadSearchPlan } from "./domains/leads/leadSearchSql.js";
import { buildLeadSearchIndexBatchUpdate } from "./domains/leads/leadSearchIndex.js";
import { buildKanbanBoardMetadataSql, buildKanbanInitialCardsSql, buildKanbanPipelinesSql, buildKanbanStagePageSql } from "./kanbanBoardSql.js";
import { COMMERCIAL_PROFILE_VERSION } from "./domains/leads/leadCommercialProfile.js";
import { createCommercialProfileRuntime } from "./domains/leads/commercialProfileRuntime.js";
import { createDateColumnRuntime, sqlDateColumn } from "./dateColumns.js";
import { buildTodayTemporalSql } from "./todayTemporalSql.js";
import { buildRoleReadiness, findMissingWorkerTables, getProcessRoleCapabilities, normalizeProcessRole, PROCESS_ROLES, REQUIRED_WORKER_TABLES } from "./runtimeRole.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const APP_VERSION = String(packageMetadata.version || "0.0.0");

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(__dirname, ".env"));

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const configuredProcessRole = String(process.env.PROCESS_ROLE || PROCESS_ROLES.COMBINED).trim().toLowerCase();
const PROCESS_ROLE = normalizeProcessRole(configuredProcessRole);
if (configuredProcessRole && configuredProcessRole !== PROCESS_ROLE) console.warn(`PROCESS_ROLE inválido (${configuredProcessRole}); usando ${PROCESS_ROLE}.`);
const PROCESS_CAPABILITIES = getProcessRoleCapabilities(PROCESS_ROLE);
const TRUST_PROXY_ENABLED = process.env.TRUST_PROXY === "1";

function readBoundedEnvironmentInteger(name, fallback, min, max) {
  const rawValue = process.env[name];
  const parsedValue = parseSecurityBoundedInteger(rawValue, fallback, min, max);
  if (rawValue !== undefined && Number.parseInt(rawValue, 10) !== parsedValue) {
    console.warn(`${name} foi limitado para ${parsedValue} por segurança operacional.`);
  }
  return parsedValue;
}

const PORT = readBoundedEnvironmentInteger("SERVER_PORT", Number(process.env.PORT || 3001), 1, 65535);
const SESSION_TTL_HOURS = readBoundedEnvironmentInteger("SESSION_TTL_HOURS", 12, 1, 168);
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || "crm_casa_ads_session").trim() || "crm_casa_ads_session";
const SESSION_COOKIE_SECURE = IS_PRODUCTION || process.env.SESSION_COOKIE_SECURE === "1";
const SESSION_COOKIE_SAME_SITE = normalizeSameSite(process.env.SESSION_COOKIE_SAME_SITE || "Lax");
const TRUST_PROXY_POLICY = createTrustedProxyPolicy({
  enabled: TRUST_PROXY_ENABLED,
  addresses: process.env.TRUST_PROXY_ADDRESSES || "",
  hops: readBoundedEnvironmentInteger("TRUST_PROXY_HOPS", 1, 1, 10),
});
const LOGIN_RATE_LIMIT_WINDOW_MS = readBoundedEnvironmentInteger("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX_IP = readBoundedEnvironmentInteger("LOGIN_RATE_LIMIT_MAX_IP", 20, 3, 500);
const LOGIN_RATE_LIMIT_MAX_EMAIL = readBoundedEnvironmentInteger("LOGIN_RATE_LIMIT_MAX_EMAIL", 10, 3, 200);
const INTEGRATION_RATE_LIMIT_WINDOW_MS = readBoundedEnvironmentInteger("INTEGRATION_RATE_LIMIT_WINDOW_MS", 60 * 1000, 10 * 1000, 60 * 60 * 1000);
const INTEGRATION_RATE_LIMIT_MAX = readBoundedEnvironmentInteger("INTEGRATION_RATE_LIMIT_MAX", 300, 10, 10000);
const RATE_LIMIT_CLEANUP_INTERVAL_MS = readBoundedEnvironmentInteger("RATE_LIMIT_CLEANUP_INTERVAL_MS", 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const MAX_BODY_BYTES = readBoundedEnvironmentInteger("MAX_BODY_BYTES", 16 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
const EXPORT_PAGE_SIZE = readBoundedEnvironmentInteger("EXPORT_PAGE_SIZE", 5000, 100, 5000);
const MAX_LEADS_PAGE_LIMIT = readBoundedEnvironmentInteger("MAX_LEADS_PAGE_LIMIT", 1000, 1, 1000);
const DEFAULT_LEADS_PAGE_LIMIT = readBoundedEnvironmentInteger("DEFAULT_LEADS_PAGE_LIMIT", 150, 1, MAX_LEADS_PAGE_LIMIT);
const MAX_LEADS_OFFSET = readBoundedEnvironmentInteger("MAX_LEADS_OFFSET", 10000, 1000, 100000);
const LEAD_SUMMARY_CACHE_MS = readBoundedEnvironmentInteger("LEAD_SUMMARY_CACHE_MS", 15000, 1000, 300000);
const METADATA_CACHE_MS = readBoundedEnvironmentInteger("METADATA_CACHE_MS", 30000, 1000, 300000);
const FILTER_OPTIONS_CACHE_MS = readBoundedEnvironmentInteger("FILTER_OPTIONS_CACHE_MS", 15000, 1000, 120000);
const COMMERCIAL_PROFILE_READINESS_CHECK_MS = readBoundedEnvironmentInteger("COMMERCIAL_PROFILE_READINESS_CHECK_MS", 30000, 5000, 300000);
const DATETIME_COLUMNS_READINESS_CHECK_MS = readBoundedEnvironmentInteger("DATETIME_COLUMNS_READINESS_CHECK_MS", 30000, 5000, 300000);
const SEARCH_INDEX_REBUILD_BATCH_SIZE = readBoundedEnvironmentInteger("SEARCH_INDEX_REBUILD_BATCH_SIZE", 750, 50, 5000);
const IMPORT_DB_BATCH_SIZE = readBoundedEnvironmentInteger("IMPORT_DB_BATCH_SIZE", 500, 100, 1000);
const SEARCH_INDEX_REBUILD_ON_START = process.env.SEARCH_INDEX_REBUILD_ON_START === "1";
const ZAPE_INTEGRATION_KEY = String(process.env.ZAPE_INTEGRATION_KEY || "").trim();
const INTEGRATION_MAX_BODY_BYTES = readBoundedEnvironmentInteger("INTEGRATION_MAX_BODY_BYTES", 512 * 1024, 16 * 1024, 2 * 1024 * 1024);
const MYSQL_CONNECT_TIMEOUT_MS = readBoundedEnvironmentInteger("MYSQL_CONNECT_TIMEOUT_MS", 10000, 1000, 60000);
const MYSQL_RETRY_ATTEMPTS = readBoundedEnvironmentInteger("MYSQL_RETRY_ATTEMPTS", 4, 1, 10);
const MYSQL_RETRY_BASE_DELAY_MS = readBoundedEnvironmentInteger("MYSQL_RETRY_BASE_DELAY_MS", 150, 10, 5000);
const MYSQL_RETRY_MAX_DELAY_MS = readBoundedEnvironmentInteger("MYSQL_RETRY_MAX_DELAY_MS", 3000, 100, 30000);
const MYSQL_TRANSACTION_RETRY_ATTEMPTS = readBoundedEnvironmentInteger("MYSQL_TRANSACTION_RETRY_ATTEMPTS", 3, 1, 6);
const LEAD_IDENTITY_LOCK_TIMEOUT_SECONDS = readBoundedEnvironmentInteger("LEAD_IDENTITY_LOCK_TIMEOUT_SECONDS", 10, 1, 60);
const JOB_WORKER_CONCURRENCY = readBoundedEnvironmentInteger("JOB_WORKER_CONCURRENCY", 2, 1, 8);
const JOB_POLL_INTERVAL_MS = readBoundedEnvironmentInteger("JOB_POLL_INTERVAL_MS", 1500, 100, 10000);
const JOB_HEARTBEAT_INTERVAL_MS = readBoundedEnvironmentInteger("JOB_HEARTBEAT_INTERVAL_MS", 10000, 1000, 60000);
const JOB_STALE_AFTER_MS = readBoundedEnvironmentInteger("JOB_STALE_AFTER_MS", 120000, 30000, 3600000);
const JOB_CLEANUP_INTERVAL_MS = readBoundedEnvironmentInteger("JOB_CLEANUP_INTERVAL_MS", 15 * 60 * 1000, 60000, 24 * 60 * 60 * 1000);
const MYSQL_POOL_CONNECTION_LIMIT = PROCESS_ROLE === PROCESS_ROLES.API
  ? readBoundedEnvironmentInteger("MYSQL_API_CONNECTION_LIMIT", 8, 1, 100)
  : PROCESS_ROLE === PROCESS_ROLES.WORKER
    ? readBoundedEnvironmentInteger("MYSQL_WORKER_CONNECTION_LIMIT", 2, 1, 50)
    : readBoundedEnvironmentInteger("MYSQL_CONNECTION_LIMIT", 10, 1, 100);
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = readBoundedEnvironmentInteger("GRACEFUL_SHUTDOWN_TIMEOUT_MS", 30000, 5000, 120000);
const HTTP_REQUEST_TIMEOUT_MS = readBoundedEnvironmentInteger("HTTP_REQUEST_TIMEOUT_MS", 120000, 10000, 600000);
const HTTP_HEADERS_TIMEOUT_MS = readBoundedEnvironmentInteger("HTTP_HEADERS_TIMEOUT_MS", 65000, 5000, 120000);
const HTTP_KEEP_ALIVE_TIMEOUT_MS = readBoundedEnvironmentInteger("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5000, 1000, 30000);

const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = sanitizeIdentifier(process.env.MYSQL_DATABASE || "crm_casa_ads");
const legacyBackupDir = path.resolve(projectRoot, process.env.BACKUP_DIR || path.join("server", "backups"));
const backupSettings = resolveBackupSettings({ env: process.env, projectRoot, isProduction: IS_PRODUCTION });
const jobArtifactSettings = resolveJobArtifactSettings({ env: process.env, projectRoot, isProduction: IS_PRODUCTION });
const mysqlBackupDatabase = {
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
};
const schemaFile = path.join(__dirname, "schema.mysql.sql");

const roleLabels = ROLE_LABELS;

const DEFAULT_KANBAN_STAGES = [
  { name: "Novo lead", color: "#2563EB", stageType: "open", statusKey: "Novo lead" },
  { name: "Contato feito", color: "#0EA5E9", stageType: "open", statusKey: "Contato feito" },
  { name: "Sem resposta", color: "#64748B", stageType: "open", statusKey: "Sem resposta" },
  { name: "Reunião marcada", color: "#8B5CF6", stageType: "open", statusKey: "Reunião marcada" },
  { name: "Diagnóstico realizado", color: "#6366F1", stageType: "open", statusKey: "Diagnóstico realizado" },
  { name: "Proposta enviada", color: "#F59E0B", stageType: "open", statusKey: "Proposta enviada" },
  { name: "Em negociação", color: "#F97316", stageType: "open", statusKey: "Em negociação" },
  { name: "Fechado", color: "#16A34A", stageType: "won", statusKey: "Fechado" },
  { name: "Perdido", color: "#DC2626", stageType: "lost", statusKey: "Perdido" },
];
const OPEN_KANBAN_STATUS_KEYS = new Set([
  "",
  "Novo lead",
  "Contato feito",
  "Sem resposta",
  "Reunião marcada",
  "Diagnóstico realizado",
  "Proposta enviada",
  "Em negociação",
]);

let pool;
let httpServer = null;
let jobWorker = null;
let securityCleanupTimer = null;
let jobCleanupTimer = null;
let commercialProfileReadinessTimer = null;
let datetimeColumnsReadinessTimer = null;
let databaseReady = false;
let isShuttingDown = false;
let activeRequestCount = 0;
const openSockets = new Set();
const shutdownController = new AbortController();
const RESPONSE_REQUEST = Symbol("responseRequest");
const EXPECTED_SHUTDOWN_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ERR_SERVER_NOT_RUNNING",
  "MYSQL_RETRY_ABORTED",
  "MYSQL_POOL_UNAVAILABLE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "SERVER_SHUTTING_DOWN",
]);

function isExpectedShutdownError(error) {
  return Boolean(isShuttingDown && EXPECTED_SHUTDOWN_ERROR_CODES.has(String(error?.code || error?.name || "")));
}

function createDatabaseUnavailableError() {
  const error = new Error(isShuttingDown
    ? "Servidor em encerramento gracioso. Tente novamente em instantes."
    : "Banco de dados temporariamente indisponível. Tente novamente em instantes.");
  error.statusCode = 503;
  error.code = isShuttingDown ? "SERVER_SHUTTING_DOWN" : "MYSQL_POOL_UNAVAILABLE";
  return error;
}

function requireDatabaseClient(client) {
  if (client) return client;
  throw createDatabaseUnavailableError();
}

const leadDashboardSummaryCache = createTtlCache({ ttlMs: LEAD_SUMMARY_CACHE_MS, maxEntries: 100 });
const metadataCache = createTtlCache({ ttlMs: METADATA_CACHE_MS, maxEntries: 250 });
const filterOptionsCache = createTtlCache({ ttlMs: FILTER_OPTIONS_CACHE_MS, maxEntries: 100 });
let leadSearchFullTextEnabled = false;
let defaultKanbanCache = null;
const performanceMonitor = createPerformanceMonitor();
const commercialProfileRuntime = createCommercialProfileRuntime({
  queryFirst: (sql, params, client) => statementFirstRow(sql, params, client),
  execute: (sql, params, client) => execute(sql, params, client),
  nowIso,
});
const dateColumnRuntime = createDateColumnRuntime({ queryFirst: (sql, params, client) => statementFirstRow(sql, params, client) });
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");

    if (!process.env[key]) process.env[key] = value;
  });
}

function sanitizeIdentifier(value) {
  const safe = String(value || "").replace(/[^a-zA-Z0-9_]/g, "");
  return safe || "crm_casa_ads";
}

async function initializeDatabase({ manageSchema = true } = {}) {
  databaseReady = false;
  const retryOptions = {
    maxAttempts: MYSQL_RETRY_ATTEMPTS,
    baseDelayMs: MYSQL_RETRY_BASE_DELAY_MS,
    maxDelayMs: MYSQL_RETRY_MAX_DELAY_MS,
    shouldRetry: isRetryableMysqlConnectionError,
    onRetry: ({ nextAttempt, delayMs, error }) => {
      console.warn("MySQL indisponível; nova tentativa de conexão agendada.", {
        nextAttempt,
        delayMs,
        code: error?.code || "MYSQL_CONNECTION_ERROR",
      });
    },
  };

  if (manageSchema) {
    const bootstrapPool = mysql.createPool(buildMysqlPoolOptions({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      connectionLimit: 5,
      connectTimeout: MYSQL_CONNECT_TIMEOUT_MS,
      multipleStatements: true,
    }));

    try {
      await withMysqlRetry(
        () => bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`),
        retryOptions,
      );
    } finally {
      await bootstrapPool.end().catch(() => undefined);
    }
  }

  pool = mysql.createPool(buildMysqlPoolOptions({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    connectionLimit: MYSQL_POOL_CONNECTION_LIMIT,
    connectTimeout: MYSQL_CONNECT_TIMEOUT_MS,
    multipleStatements: true,
  }));

  try {
    await withMysqlRetry(() => pool.query("SELECT 1 AS ready"), retryOptions);
    await Promise.all([
      mkdir(backupSettings.storageRoot, { recursive: true }),
      ensureJobArtifactStorage(jobArtifactSettings.storageRoot),
    ]);
    if (manageSchema) {
      const schemaSql = await readFile(schemaFile, "utf8");
      await pool.query(schemaSql);
      await runSchemaMigrations();
      await seedDefaultAdminUser();
      await seedDefaultKanban();
      await commercialProfileRuntime.refreshReadiness({ logTransition: true });
      await dateColumnRuntime.refreshReadiness({ logTransition: true });
    } else {
      const placeholders = REQUIRED_WORKER_TABLES.map(() => "?").join(", ");
      const requiredTables = await queryRows(`SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, [MYSQL_DATABASE, ...REQUIRED_WORKER_TABLES]);
      const missingTables = findMissingWorkerTables(requiredTables);
      if (missingTables.length) throw Object.assign(new Error(`Worker aguardando schema da API. Tabelas ausentes: ${missingTables.join(", ")}.`), { code: "WORKER_SCHEMA_NOT_READY" });
    }
    databaseReady = true;
  } catch (error) {
    databaseReady = false;
    await pool.end().catch(() => undefined);
    pool = null;
    throw error;
  }
}

async function getTableColumns(tableName) {
  const rows = await queryRows(
    `SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [MYSQL_DATABASE, tableName],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const columns = await getTableColumns(tableName);
  if (!columns.has(columnName)) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnName} ${definition}`);
  }
}

async function getTableIndexes(tableName) {
  const rows = await queryRows(
    `SELECT INDEX_NAME AS index_name FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [MYSQL_DATABASE, tableName],
  );
  return new Set(rows.map((row) => row.index_name));
}

async function addIndexIfMissing(tableName, indexName, definition) {
  const indexes = await getTableIndexes(tableName);
  if (!indexes.has(indexName)) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`);
  }
}

async function runVersionedMigration(version, description, operation) {
  const applied = await statementFirstRow("SELECT version FROM schema_migrations WHERE version = ? LIMIT 1", [version]);
  if (applied) return false;
  await operation();
  await execute(
    "INSERT IGNORE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
    [version, description, nowIso()],
  );
  return true;
}

async function backfillLeadResponsibleUserIds(client = pool) {
  const users = await queryRows("SELECT id, name, email FROM users", [], client);
  const identityOwners = new Map();

  users.forEach((user) => {
    [user.name, user.email].forEach((identity) => {
      const key = String(identity || "").trim().toLowerCase();
      if (!key) return;
      const current = identityOwners.get(key) || new Set();
      current.add(user.id);
      identityOwners.set(key, current);
    });
  });

  for (const [identity, userIds] of identityOwners.entries()) {
    if (userIds.size !== 1) continue;
    const [userId] = userIds;
    await execute(
      "UPDATE leads SET responsible_user_id = ? WHERE responsible_user_id = '' AND LOWER(TRIM(responsible)) = ?",
      [userId, identity],
      client,
    );
  }
}

async function runSchemaMigrations() {
  await addColumnIfMissing("leads", "email_key", "VARCHAR(255) NOT NULL DEFAULT '' AFTER email");
  await addColumnIfMissing("leads", "phone_key", "VARCHAR(80) NOT NULL DEFAULT '' AFTER phone");
  await addColumnIfMissing("leads", "name_company_key", "VARCHAR(512) NOT NULL DEFAULT '' AFTER company");
  await addColumnIfMissing("leads", "custom_fields", "JSON NULL AFTER service_status_map");
  await addColumnIfMissing("leads", "search_text", "MEDIUMTEXT NULL AFTER custom_fields");
  await addColumnIfMissing("leads", "deleted_at", "VARCHAR(40) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "deleted_by", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "restored_at", "VARCHAR(40) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "restored_by", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "pipeline_id", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "pipeline_stage_id", "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("leads", "kanban_position", "DECIMAL(30,10) NOT NULL DEFAULT 0");
  await addColumnIfMissing("leads", "pipeline_entered_at", "VARCHAR(40) NOT NULL DEFAULT ''");

  await pool.query("UPDATE leads SET email_key = LOWER(TRIM(email)) WHERE email_key = '' AND email != ''");
  await pool.query("UPDATE leads SET phone_key = REGEXP_REPLACE(phone, '[^0-9]', '') WHERE phone_key = '' AND phone != ''").catch(() => undefined);
  await addIndexIfMissing("leads", "idx_leads_search_email", "INDEX idx_leads_search_email (deleted_at, email_key)").catch(() => undefined);
  await addIndexIfMissing("leads", "idx_leads_search_phone", "INDEX idx_leads_search_phone (deleted_at, phone_key)").catch(() => undefined);
  await addIndexIfMissing("leads", "idx_leads_pipeline_stage", "INDEX idx_leads_pipeline_stage (deleted_at, pipeline_id, pipeline_stage_id, kanban_position)").catch(() => undefined);
  await runVersionedMigration(
    leadScopeMigrationVersion,
    leadScopeMigrationDescription,
    () => runLeadScopeMigration({
      addColumnIfMissing,
      addIndexIfMissing,
      backfillLeadResponsibleUserIds,
    }),
  );
  await runVersionedMigration(
    commercialRolesMigrationVersion,
    commercialRolesMigrationDescription,
    () => runCommercialRolesMigration({
      addColumnIfMissing,
      addIndexIfMissing,
      execute,
    }),
  );
  await runVersionedMigration(
    tasksTodayMigrationVersion,
    tasksTodayMigrationDescription,
    () => runTasksTodayMigration({ execute }),
  );
  await runVersionedMigration(
    operationalIntegrityMigrationVersion,
    operationalIntegrityMigrationDescription,
    () => runOperationalIntegrityMigration({ addColumnIfMissing, addIndexIfMissing }),
  );
  await runVersionedMigration(
    backupIntegrityMigrationVersion,
    backupIntegrityMigrationDescription,
    () => runBackupIntegrityMigration({ addColumnIfMissing, addIndexIfMissing }),
  );
  await runVersionedMigration(
    securityHardeningMigrationVersion,
    securityHardeningMigrationDescription,
    () => runSecurityHardeningMigration({ addColumnIfMissing, addIndexIfMissing, execute }),
  );
  await runVersionedMigration(
    asyncJobsMigrationVersion,
    asyncJobsMigrationDescription,
    () => runAsyncJobsMigration({ execute }),
  );

  await runVersionedMigration(
    commercialProfileMigrationVersion,
    commercialProfileMigrationDescription,
    () => runCommercialProfileMigration({ addColumnIfMissing, addIndexIfMissing }),
  );

  await runVersionedMigration(datetimeColumnsMigrationVersion, datetimeColumnsMigrationDescription,
    () => runDatetimeColumnsMigration({ addColumnIfMissing, addIndexIfMissing, execute }));

  try {
    await addIndexIfMissing("leads", "ft_leads_search_text", "FULLTEXT INDEX ft_leads_search_text (search_text)");
    leadSearchFullTextEnabled = true;
  } catch {
    leadSearchFullTextEnabled = false;
  }
}

async function seedDefaultAdminUser() {
  const existingUserCount = Number(await scalar("SELECT COUNT(*) AS total FROM users") || 0);
  if (existingUserCount > 0) return;

  const bootstrapAdmin = validateBootstrapAdminConfig({
    email: process.env.CRM_ADMIN_EMAIL,
    password: process.env.CRM_ADMIN_PASSWORD,
    name: process.env.CRM_ADMIN_NAME,
  });

  if (!bootstrapAdmin.valid) {
    const error = new Error(`Nenhum usuário existe no banco. Corrija as variáveis do administrador inicial: ${bootstrapAdmin.errors.join(" ")}`);
    error.code = "INSECURE_BOOTSTRAP_ADMIN";
    throw error;
  }

  const { email, password, name } = bootstrapAdmin.value;
  const at = nowIso();

  await execute(
    `INSERT INTO users (id, name, email, role, password_hash, is_active, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
    [randomUUID(), name, email, "admin", hashPassword(password), 1, at, at],
  );
}

async function seedDefaultKanban() {
  let pipeline = await statementFirstRow(
    "SELECT * FROM kanban_pipelines WHERE is_default = 1 AND is_archived = 0 ORDER BY position ASC LIMIT 1",
  );

  if (!pipeline) {
    pipeline = await statementFirstRow(
      "SELECT * FROM kanban_pipelines WHERE is_archived = 0 ORDER BY position ASC, created_at ASC LIMIT 1",
    );
  }

  const at = nowIso();
  if (!pipeline) {
    const pipelineId = randomUUID();
    await execute(
      `INSERT INTO kanban_pipelines (id, name, is_default, is_archived, position, created_by, created_at, updated_at)
       VALUES (?, 'Funil Comercial', 1, 0, 1000, 'system', ?, ?)`,
      [pipelineId, at, at],
    );
    pipeline = await statementFirstRow("SELECT * FROM kanban_pipelines WHERE id = ?", [pipelineId]);
  } else if (!Number(pipeline.is_default)) {
    await execute("UPDATE kanban_pipelines SET is_default = 0");
    await execute("UPDATE kanban_pipelines SET is_default = 1, updated_at = ? WHERE id = ?", [at, pipeline.id]);
    pipeline.is_default = 1;
  }

  let stages = await queryRows(
    "SELECT * FROM kanban_stages WHERE pipeline_id = ? AND is_archived = 0 ORDER BY position ASC",
    [pipeline.id],
  );

  if (!stages.length) {
    for (let index = 0; index < DEFAULT_KANBAN_STAGES.length; index += 1) {
      const stage = DEFAULT_KANBAN_STAGES[index];
      await execute(
        `INSERT INTO kanban_stages (id, pipeline_id, name, color, position, stage_type, status_key, wip_limit, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [randomUUID(), pipeline.id, stage.name, stage.color, (index + 1) * 1000, stage.stageType, stage.statusKey, at, at],
      );
    }
    stages = await queryRows(
      "SELECT * FROM kanban_stages WHERE pipeline_id = ? AND is_archived = 0 ORDER BY position ASC",
      [pipeline.id],
    );
  }

  const fallbackStage = stages.find((stage) => stage.stage_type === "open") || stages[0];
  const byStatus = new Map(stages.filter((stage) => stage.status_key).map((stage) => [stage.status_key, stage]));

  for (const [status, stage] of byStatus.entries()) {
    await execute(
      `UPDATE leads
       SET pipeline_id = ?, pipeline_stage_id = ?, pipeline_entered_at = COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), ?),
           kanban_position = CASE WHEN kanban_position = 0 THEN UNIX_TIMESTAMP() * 1000000 + MOD(CRC32(id), 1000000) ELSE kanban_position END
       WHERE deleted_at = '' AND (pipeline_id = '' OR pipeline_stage_id = '') AND status = ?`,
      [pipeline.id, stage.id, at, status],
    );
  }

  if (fallbackStage) {
    await execute(
      `UPDATE leads
       SET pipeline_id = ?, pipeline_stage_id = ?, pipeline_entered_at = COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), ?),
           kanban_position = CASE WHEN kanban_position = 0 THEN UNIX_TIMESTAMP() * 1000000 + MOD(CRC32(id), 1000000) ELSE kanban_position END
       WHERE deleted_at = '' AND (pipeline_id = '' OR pipeline_stage_id = '')`,
      [pipeline.id, fallbackStage.id, at],
    );
  }

  defaultKanbanCache = {
    pipelineId: pipeline.id,
    fallbackStageId: fallbackStage?.id || "",
    stagesByStatus: Object.fromEntries(Array.from(byStatus.entries()).map(([status, stage]) => [status, stage.id])),
  };
}

async function withTransaction(operation) {
  const activePool = requireDatabaseClient(pool);
  return withMysqlTransactionRetry(activePool, (client, transactionContext) => operation(client, transactionContext), {
    maxAttempts: MYSQL_TRANSACTION_RETRY_ATTEMPTS, baseDelayMs: MYSQL_RETRY_BASE_DELAY_MS, maxDelayMs: MYSQL_RETRY_MAX_DELAY_MS,
    signal: shutdownController.signal,
    onRetry: ({ nextAttempt, delayMs, error }) => {
      if (!isShuttingDown) console.warn("Transação MySQL refeita após falha transitória segura.", { nextAttempt, delayMs, code: error?.code || "MYSQL_TRANSACTION_RETRY" });
    },
  });
}

async function execute(sql, params = [], client = null) {
  const activeClient = requireDatabaseClient(client || pool);
  const [result] = await performanceMonitor.measureSql(sql, () => activeClient.execute(sql, params));
  return result;
}

async function queryRows(sql, params = [], client = null) {
  const usingPool = !client || client === pool;
  const activeClient = requireDatabaseClient(client || pool);
  const run = async () => {
    const [rows] = await performanceMonitor.measureSql(sql, () => activeClient.execute(sql, params));
    return Array.isArray(rows) ? rows : [];
  };

  if (!usingPool) return run();
  return withMysqlRetry(run, {
    maxAttempts: MYSQL_RETRY_ATTEMPTS,
    baseDelayMs: MYSQL_RETRY_BASE_DELAY_MS,
    maxDelayMs: MYSQL_RETRY_MAX_DELAY_MS,
    shouldRetry: isRetryableMysqlConnectionError,
    signal: shutdownController.signal,
  });
}

async function statementFirstRow(sql, params = [], client = null) {
  const rows = await queryRows(sql, params, client);
  return rows[0] || null;
}

async function scalar(sql, params = [], client = null) {
  const row = await statementFirstRow(sql, params, client);
  if (!row) return null;
  const firstKey = Object.keys(row)[0];
  return row[firstKey];
}

function getRequestProtocol(request) {
  return resolveRequestProtocol(request, TRUST_PROXY_POLICY);
}

function getRequestOrigin(request) {
  return `${getRequestProtocol(request)}://${request.headers.host || `localhost:${PORT}`}`;
}

function applySecurityHeaders(request, response) {
  const headers = buildSecurityHeaders({ isHttps: getRequestProtocol(request) === "https" });
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
}

function applyCorsHeaders(request, response) {
  const result = evaluateCorsOrigin({
    origin: request.headers.origin,
    requestOrigin: getRequestOrigin(request),
    configuredOrigins: process.env.CORS_ORIGIN || "",
    isProduction: IS_PRODUCTION,
  });

  Object.entries(result.headers).forEach(([name, value]) => response.setHeader(name, value));
  if (!result.allowed) {
    const error = new Error("Origem não autorizada para acessar a API.");
    error.statusCode = 403;
    throw error;
  }
}

function sendJson(response, statusCode, payload) {
  sendBufferResponse({
    request: response[RESPONSE_REQUEST],
    response,
    statusCode,
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sendTextDownload(response, statusCode, content, fileName, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${sanitizeDownloadFileName(fileName)}"`,
    "Cache-Control": "no-store",
  });
  response.end(content);
}

function sendBinaryDownload(response, statusCode, buffer, fileName, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${sanitizeDownloadFileName(fileName)}"`,
    "Cache-Control": "no-store",
  });
  response.end(buffer);
}

async function sendFileDownload(response, filePath, fileName, contentType, extraHeaders = {}) {
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Content-Disposition": `attachment; filename="${sanitizeDownloadFileName(fileName)}"`,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once("error", reject);
    response.once("close", resolve);
    response.once("finish", resolve);
    stream.pipe(response);
  });
}

async function readRequestBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error("Corpo da requisição muito grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    const error = new Error("JSON inválido no corpo da requisição.");
    error.statusCode = 400;
    throw error;
  }
}

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isActiveWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}deleted_at = '' AND ${prefix}is_lost = 0 AND ${prefix}status != 'Perdido' AND ${prefix}status != 'Fechado'`;
}

function invalidateDirectoryCaches() {
  metadataCache.deletePrefix("team-members:");
  metadataCache.deletePrefix("teams:");
  metadataCache.deletePrefix("users:");
  leadDashboardSummaryCache.deletePrefix("team:");
  filterOptionsCache.clear();
}

function invalidateKanbanCountsCache() { metadataCache.deletePrefix("kanban-pipelines:"); }
function invalidateKanbanMetadataCache() { defaultKanbanCache = null; invalidateKanbanCountsCache(); }

async function getLeadAccessContext(user, client = pool) {
  const leadAccessScope = getFixedLeadAccessScopeForRole(user?.role);
  const scopedUser = { ...user, leadAccessScope };
  let teamMembers = [];
  if (leadAccessScope === "team" && user?.teamId) {
    teamMembers = await metadataCache.getOrLoad(`team-members:${user.teamId}`, async () => {
      const rows = await queryRows("SELECT * FROM users WHERE team_id = ? AND is_active = 1 ORDER BY name ASC", [user.teamId], client);
      return rows.map((row) => rowToUser(row));
    });
  }
  return { user: scopedUser, teamMembers, accessSql: buildLeadAccessSql(scopedUser, teamMembers), scope: describeLeadScope(scopedUser, teamMembers) };
}

function addLeadAccessClause(whereParts, params, accessContext, alias = "") {
  const accessSql = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, alias);
  whereParts.push(accessSql.clause);
  params.push(...accessSql.params);
}

async function assertLeadAccess(user, leadId, options = {}, client = pool) {
  const accessContext = options.accessContext || await getLeadAccessContext(user, client);
  const includeDeleted = Boolean(options.includeDeleted);
  const deletedClause = includeDeleted ? "" : "AND deleted_at = ''";
  const lockClause = options.forUpdate && client !== pool ? " FOR UPDATE" : "";
  const row = await statementFirstRow(
    `SELECT id FROM leads WHERE id = ? ${deletedClause} AND ${accessContext.accessSql.clause} LIMIT 1${lockClause}`,
    [leadId, ...accessContext.accessSql.params],
    client,
  );

  if (!row) {
    const error = new Error("Lead não encontrado ou fora da sua carteira autorizada.");
    error.statusCode = 404;
    throw error;
  }

  return accessContext;
}

async function getLeadDashboardSummary(query = {}, client = pool) {
  const where = query.where || "1 = 1";
  const params = query.params || [];
  const alias = query.alias || "";
  const row = await statementFirstRow(
    buildLeadDashboardSummarySql({
      where,
      activeWhere: isActiveWhere(alias),
      alias,
      useMaterialized: commercialProfileRuntime.isReady(),
      useDateColumns: dateColumnRuntime.isReady(),
    }),
    params,
    client,
  );

  return mapLeadDashboardSummaryRow(row);
}

function leadDashboardCacheKey(accessContextOrUser) {
  const user = accessContextOrUser?.user || accessContextOrUser;
  const scope = accessContextOrUser?.scope?.scope || (user ? getFixedLeadAccessScopeForRole(user.role) : "all");
  if (scope === "team") return `team:${user?.teamId || "none"}`;
  if (scope === "own") return `own:${user?.id || "none"}`;
  if (scope === "none") return `none:${user?.id || "none"}`;
  return "all";
}

function invalidateLeadSummaryCache(accessContext = null) {
  leadDashboardSummaryCache.deleteKey("all");
  if (accessContext) leadDashboardSummaryCache.deleteKey(leadDashboardCacheKey(accessContext));
  filterOptionsCache.deleteKey(accessContext ? `owners:${leadDashboardCacheKey(accessContext)}` : "owners:all");
}

async function getLeadDashboardSummaryCached(options = {}) {
  const { force = false, accessContext, client = pool } = options;
  const query = accessContext ? { where: accessContext.accessSql.clause, params: accessContext.accessSql.params } : {};
  return leadDashboardSummaryCache.getOrLoad(leadDashboardCacheKey(accessContext), () => getLeadDashboardSummary(query, client), { force });
}

async function getLeadSummaryCached(options = {}) {
  return (await getLeadDashboardSummaryCached(options)).summary;
}

async function getOpportunitySummaryCached(options = {}) {
  return (await getLeadDashboardSummaryCached(options)).opportunitySummary;
}

function repeatSqlParams(params, times) {
  return Array.from({ length: times }, () => params).flat();
}

async function getDuplicateGroupCount(accessContext, client = pool) {
  const accessSql = buildAliasedLeadAccess(accessContext, "l");
  const where = `l.deleted_at = '' AND ${accessSql.clause}`;
  return Number(await scalar(
    buildDuplicateGroupsCountSql({ where, alias: "l" }),
    repeatSqlParams(accessSql.params, 3),
    client,
  ) || 0);
}

async function getAdminLeadOverview(accessContext, client = pool, options = {}) {
  const accessSql = buildAliasedLeadAccess(accessContext, "l");
  const where = `l.deleted_at = '' AND ${accessSql.clause}`;
  const row = await statementFirstRow(
    buildAdminLeadOverviewSql({ where, alias: "l", useMaterialized: commercialProfileRuntime.isReady() }),
    accessSql.params,
    client,
  );
  const overview = mapAdminLeadOverviewRow(row);
  const includeDuplicates = options.includeDuplicates !== false;
  const duplicateGroups = includeDuplicates ? await getDuplicateGroupCount(accessContext, client) : 0;
  return {
    ...overview,
    duplicateGroups,
    scope: accessContext.scope,
    generatedAt: nowIso(),
  };
}

async function getDuplicateGroupsPage(accessContext, options = {}, client = pool) {
  const limit = parseBoundedInteger(options.limit, 20, 1, 40);
  const offset = parseBoundedInteger(options.offset, 0, 0, MAX_LEADS_OFFSET);
  const accessSql = buildAliasedLeadAccess(accessContext, "l");
  const where = `l.deleted_at = '' AND ${accessSql.clause}`;
  const repeatedAccessParams = repeatSqlParams(accessSql.params, 3);
  const total = Number(await scalar(
    buildDuplicateGroupsCountSql({ where, alias: "l" }),
    repeatedAccessParams,
    client,
  ) || 0);
  const groupRows = await queryRows(
    buildDuplicateGroupsPageSql({ where, alias: "l" }),
    [...repeatedAccessParams, limit, offset],
    client,
  );
  const lookup = buildDuplicateLeadLookup({
    groups: groupRows,
    where,
    alias: "l",
    select: qualifyLeadFields(LEAD_DUPLICATE_FIELDS, "l"),
  });
  const maxLeadRows = 2000;
  const leadRows = lookup.sql
    ? await queryRows(`${lookup.sql} LIMIT ?`, [...accessSql.params, ...lookup.params, maxLeadRows], client)
    : [];
  const groups = mapDuplicateGroups(groupRows, leadRows, rowToLead).map((group) => ({
    ...group,
    isTruncated: group.leads.length < group.total,
  }));

  return {
    groups,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + groupRows.length < total,
    },
    scope: accessContext.scope,
  };
}

async function resolveLeadSearchClause({ search, baseWhere, baseParams, alias = "", client = pool }) {
  const plan = buildLeadSearchPlan(search, { alias, fullTextEnabled: leadSearchFullTextEnabled });
  if (!plan || plan.mode === "none") return null;
  if (!plan.primary || !plan.requiresProbe) return chooseLeadSearchPlan(plan, false);

  const tableAlias = String(alias || "").replace(/[^a-zA-Z0-9_]/g, "");
  const fromClause = tableAlias ? `leads ${tableAlias}` : "leads";
  const primaryHasMatches = Boolean(await scalar(
    `SELECT 1 AS found FROM ${fromClause} WHERE ${baseWhere} AND ${plan.primary.clause} LIMIT 1`,
    [...baseParams, ...plan.primary.params],
    client,
  ));
  return chooseLeadSearchPlan(plan, primaryHasMatches);
}

function addLeadQuickFilterClause(whereParts, quickFilter, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const activeWhere = `${prefix}is_lost = 0 AND ${prefix}status != 'Perdido' AND ${prefix}status != 'Fechado'`;

  if (quickFilter === "owner") {
    whereParts.push(`${activeWhere} AND TRIM(COALESCE(${prefix}responsible, '')) = '' AND TRIM(COALESCE(${prefix}responsible_user_id, '')) = ''`);
  } else if (quickFilter === "next") {
    whereParts.push(`${activeWhere} AND TRIM(COALESCE(${prefix}next_contact_at, '')) = ''`);
  } else {
    const commercialClause = buildOpportunityQuickFilterSql(quickFilter, alias, { useMaterialized: commercialProfileRuntime.isReady() });
    if (!commercialClause) return;
    if (["lead-priority", "lead-mapping"].includes(quickFilter)) {
      whereParts.push(`${activeWhere} AND ${commercialClause}`);
    } else {
      whereParts.push(commercialClause);
    }
  }
}

async function buildLeadsPageQuery(params = {}, accessContext = null, alias = "", client = pool) {
  const prefix = alias ? `${alias}.` : "";
  const whereParts = [`${prefix}deleted_at = ''`];
  const sqlParams = [];

  if (accessContext) addLeadAccessClause(whereParts, sqlParams, accessContext, alias);

  if (params.status) {
    whereParts.push(`${prefix}status = ?`);
    sqlParams.push(params.status);
  }

  if (params.temperature) {
    whereParts.push(`${prefix}temperature = ?`);
    sqlParams.push(params.temperature);
  }

  if (params.responsible) {
    whereParts.push(`${prefix}responsible = ?`);
    sqlParams.push(params.responsible);
  }

  addLeadQuickFilterClause(whereParts, params.quickFilter, alias);

  const baseWhere = whereParts.join(" AND ");
  const baseParams = [...sqlParams];
  const searchClause = await resolveLeadSearchClause({
    search: params.search,
    baseWhere,
    baseParams,
    alias,
    client,
  });
  if (searchClause?.clause) {
    whereParts.push(searchClause.clause);
    sqlParams.push(...searchClause.params);
  }

  return {
    where: whereParts.join(" AND "),
    params: sqlParams,
    searchMode: searchClause?.mode || "none",
  };
}

function encodeLeadCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeLeadCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed && parsed.v === 1 && parsed.id ? parsed : null;
  } catch {
    const error = new Error("Cursor de paginação inválido.");
    error.statusCode = 400;
    throw error;
  }
}

async function getLeadsPageFromRequest(requestUrl, currentUser) {
  const searchParams = requestUrl.searchParams;
  const limit = parseBoundedInteger(searchParams.get("limit"), DEFAULT_LEADS_PAGE_LIMIT, 1, MAX_LEADS_PAGE_LIMIT);
  const offset = parseBoundedInteger(searchParams.get("offset"), 0, 0, MAX_LEADS_OFFSET);
  const cursor = decodeLeadCursor(searchParams.get("cursor"));
  const includeSummary = searchParams.get("summary") !== "0";
  const includeOpportunitySummary = searchParams.get("opportunitySummary") === "1";
  const leadProjection = getLeadListProjection({ includeCommercialContext: includeOpportunitySummary });
  const sort = normalizeLeadSort(searchParams.get("sortBy"), searchParams.get("sortDirection"));
  const accessContext = await getLeadAccessContext(currentUser);
  const filters = {
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    temperature: searchParams.get("temperature") || "",
    responsible: searchParams.get("responsible") || "",
    quickFilter: searchParams.get("quickFilter") || "",
  };
  const { where, params } = await buildLeadsPageQuery(filters, accessContext);
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const needsDashboardSummary = includeSummary || includeOpportunitySummary;
  let scopedDashboardSummary = null;
  let filteredDashboardSummary = null;

  if (needsDashboardSummary) {
    scopedDashboardSummary = await getLeadDashboardSummaryCached({ accessContext });
    filteredDashboardSummary = hasActiveFilters
      ? await getLeadDashboardSummary({ where, params })
      : scopedDashboardSummary;
  }

  const total = filteredDashboardSummary
    ? Number(filteredDashboardSummary.summary.total || 0)
    : Number(await scalar(`SELECT COUNT(*) AS total FROM leads WHERE ${where}`, params) || 0);
  const pageWhere = [where];
  const pageParams = [...params];
  const orderExpression = sort.column;

  if (cursor) {
    if (cursor.sortBy !== sort.key || cursor.sortDirection !== sort.direction) {
      const error = new Error("O cursor não corresponde à ordenação atual.");
      error.statusCode = 400;
      throw error;
    }
    const comparator = sort.direction === "ASC" ? ">" : "<";
    pageWhere.push(`(${orderExpression} ${comparator} ? OR (${orderExpression} = ? AND id ${comparator} ?))`);
    pageParams.push(String(cursor.value || ""), String(cursor.value || ""), String(cursor.id));
  }

  const paginationSql = cursor ? "LIMIT ?" : "LIMIT ? OFFSET ?";
  const paginationParams = cursor ? [limit] : [limit, offset];
  const rows = await queryRows(
    `SELECT ${leadProjection} FROM leads WHERE ${pageWhere.join(" AND ")} ORDER BY ${orderExpression} ${sort.direction}, id ${sort.direction} ${paginationSql}`,
    [...pageParams, ...paginationParams],
  );
  const lastRow = rows.at(-1);
  const nextCursor = lastRow && rows.length === limit
    ? encodeLeadCursor({
        v: 1,
        sortBy: sort.key,
        sortDirection: sort.direction,
        value: String(lastRow[sort.column] || ""),
        id: String(lastRow.id),
      })
    : "";
  const hasMore = cursor ? Boolean(nextCursor) : offset + rows.length < total;

  const response = {
    leads: rows.map(rowToLead),
    pagination: {
      total,
      limit,
      offset: cursor ? 0 : offset,
      hasMore,
      nextCursor,
      sortBy: sort.key,
      sortDirection: sort.direction.toLowerCase(),
    },
    scope: accessContext.scope,
    filterScope: {
      kind: hasActiveFilters ? "filtro_atual" : accessContext.scope.kind,
      label: hasActiveFilters ? "Filtro atual" : accessContext.scope.label,
      total,
    },
  };

  if (includeSummary && scopedDashboardSummary && filteredDashboardSummary) {
    response.summary = scopedDashboardSummary.summary;
    response.filteredSummary = filteredDashboardSummary.summary;
  }

  if (includeOpportunitySummary && scopedDashboardSummary && filteredDashboardSummary) {
    response.opportunitySummary = {
      ...scopedDashboardSummary.opportunitySummary,
      scope: accessContext.scope,
      generatedAt: nowIso(),
    };
    response.filteredOpportunitySummary = {
      ...filteredDashboardSummary.opportunitySummary,
      scope: response.filterScope,
      generatedAt: nowIso(),
    };
  }

  return response;
}

async function getLeadById(leadId, options = {}, client = pool) {
  const { includeDeleted = false, forUpdate = false } = options;
  const whereDeleted = includeDeleted ? "" : "AND deleted_at = ''";
  const lockClause = forUpdate && client !== pool ? " FOR UPDATE" : "";
  const row = await statementFirstRow(`SELECT * FROM leads WHERE id = ? ${whereDeleted} LIMIT 1${lockClause}`, [leadId], client);
  return row ? rowToLead(row) : null;
}

async function getDeletedLeadsPageFromRequest(requestUrl, accessContext, client = pool) {
  const limit = parseBoundedInteger(requestUrl.searchParams.get("limit"), 100, 1, 200);
  const offset = parseBoundedInteger(requestUrl.searchParams.get("offset"), 0, 0, MAX_LEADS_OFFSET);
  const where = `deleted_at != '' AND ${accessContext.accessSql.clause}`;
  const params = accessContext.accessSql.params;
  const total = Number(await scalar(`SELECT COUNT(*) AS total FROM leads WHERE ${where}`, params, client) || 0);
  const rows = await queryRows(
    `SELECT ${LEAD_TRASH_SELECT} FROM leads
     WHERE ${where}
     ORDER BY deleted_at DESC, updated_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    client,
  );
  return {
    leads: rows.map(rowToLead),
    pagination: { total, limit, offset, hasMore: offset + rows.length < total },
  };
}

function sanitizeKanbanName(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 160);
}

function sanitizeKanbanColor(value) {
  const color = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : "#64748B";
}

function normalizeKanbanStageType(value) {
  return value === "won" || value === "lost" ? value : "open";
}

function normalizeOpenKanbanStatusKey(value) {
  const statusKey = String(value || "").trim().slice(0, 80);
  return OPEN_KANBAN_STATUS_KEYS.has(statusKey) ? statusKey : "";
}

function normalizeKanbanWipLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1000000, Math.trunc(number)));
}

async function assertUniqueKanbanPipelineName(name, excludedPipelineId = "", client = pool) {
  const clauses = ["is_archived = 0", "LOWER(name) = LOWER(?)"];
  const params = [name];
  if (excludedPipelineId) {
    clauses.push("id != ?");
    params.push(excludedPipelineId);
  }
  const duplicate = Number(await scalar(`SELECT COUNT(*) AS total FROM kanban_pipelines WHERE ${clauses.join(" AND ")}`, params, client) || 0);
  if (duplicate > 0) {
    const error = new Error("Já existe um funil ativo com esse nome.");
    error.statusCode = 409;
    throw error;
  }
}

async function assertUniqueKanbanStageName(pipelineId, name, excludedStageId = "", client = pool) {
  const clauses = ["pipeline_id = ?", "is_archived = 0", "LOWER(name) = LOWER(?)"];
  const params = [pipelineId, name];
  if (excludedStageId) {
    clauses.push("id != ?");
    params.push(excludedStageId);
  }
  const duplicate = Number(await scalar(`SELECT COUNT(*) AS total FROM kanban_stages WHERE ${clauses.join(" AND ")}`, params, client) || 0);
  if (duplicate > 0) {
    const error = new Error("Já existe uma etapa ativa com esse nome neste funil.");
    error.statusCode = 409;
    throw error;
  }
}

async function assertUniqueKanbanStageStatus(pipelineId, statusKey, excludedStageId = "", client = pool) {
  if (!statusKey) return;
  const clauses = ["pipeline_id = ?", "is_archived = 0", "status_key = ?"];
  const params = [pipelineId, statusKey];
  if (excludedStageId) {
    clauses.push("id != ?");
    params.push(excludedStageId);
  }
  const duplicate = Number(await scalar(`SELECT COUNT(*) AS total FROM kanban_stages WHERE ${clauses.join(" AND ")}`, params, client) || 0);
  if (duplicate > 0) {
    const error = new Error(`O status “${statusKey}” já está vinculado a outra etapa deste funil.`);
    error.statusCode = 409;
    throw error;
  }
}

function rowToKanbanStage(row, cardCount = 0) {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    color: row.color || "#64748B",
    position: Number(row.position || 0),
    stageType: normalizeKanbanStageType(row.stage_type),
    statusKey: row.status_key || "",
    wipLimit: Number(row.wip_limit || 0),
    isArchived: Boolean(Number(row.is_archived)),
    cardCount: Number(cardCount || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function rowToKanbanPipeline(row, stages = [], cardCount = 0) {
  return {
    id: row.id,
    name: row.name,
    isDefault: Boolean(Number(row.is_default)),
    isArchived: Boolean(Number(row.is_archived)),
    position: Number(row.position || 0),
    cardCount: Number(cardCount || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    stages,
  };
}

async function getKanbanStageById(stageId, client = pool, options = {}) {
  const archivedClause = options.includeArchived ? "" : "AND s.is_archived = 0 AND p.is_archived = 0";
  const lockClause = options.forUpdate && client !== pool ? " FOR UPDATE" : "";
  return statementFirstRow(
    `SELECT s.*, p.name AS pipeline_name, p.is_default AS pipeline_is_default
     FROM kanban_stages s
     INNER JOIN kanban_pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ? ${archivedClause}
     LIMIT 1${lockClause}`,
    [stageId],
    client,
  );
}

async function getKanbanPipelineById(pipelineId, client = pool, options = {}) {
  const archivedClause = options.includeArchived ? "" : "AND is_archived = 0";
  return statementFirstRow(
    `SELECT * FROM kanban_pipelines WHERE id = ? ${archivedClause} LIMIT 1`,
    [pipelineId],
    client,
  );
}

async function getKanbanStages(pipelineId, client = pool, options = {}) {
  const archivedClause = options.includeArchived ? "" : "AND is_archived = 0";
  return queryRows(
    `SELECT * FROM kanban_stages WHERE pipeline_id = ? ${archivedClause} ORDER BY position ASC, created_at ASC`,
    [pipelineId],
    client,
  );
}

async function loadDefaultKanbanCache(client = pool) {
  const pipeline = await statementFirstRow(
    "SELECT * FROM kanban_pipelines WHERE is_default = 1 AND is_archived = 0 ORDER BY position ASC LIMIT 1",
    [],
    client,
  );
  if (!pipeline) return null;

  const stages = await getKanbanStages(pipeline.id, client);
  const fallbackStage = stages.find((stage) => stage.stage_type === "open") || stages[0];
  defaultKanbanCache = {
    pipelineId: pipeline.id,
    fallbackStageId: fallbackStage?.id || "",
    stagesByStatus: Object.fromEntries(stages.filter((stage) => stage.status_key).map((stage) => [stage.status_key, stage.id])),
  };
  return defaultKanbanCache;
}

async function ensureLeadKanbanAssignment(lead, client = pool) {
  const normalizedLead = normalizeLead(lead);
  if (normalizedLead.pipelineId && normalizedLead.pipelineStageId) {
    return {
      ...normalizedLead,
      kanbanPosition: normalizedLead.kanbanPosition || Date.now() * 1000 + Math.floor(Math.random() * 1000),
      pipelineEnteredAt: normalizedLead.pipelineEnteredAt || nowIso(),
    };
  }

  const cache = defaultKanbanCache || await loadDefaultKanbanCache(client);
  if (!cache?.pipelineId || !cache?.fallbackStageId) return normalizedLead;

  return {
    ...normalizedLead,
    pipelineId: cache.pipelineId,
    pipelineStageId: cache.stagesByStatus[normalizedLead.status] || cache.fallbackStageId,
    kanbanPosition: normalizedLead.kanbanPosition || Date.now() * 1000 + Math.floor(Math.random() * 1000),
    pipelineEnteredAt: normalizedLead.pipelineEnteredAt || nowIso(),
  };
}

async function getKanbanPipelines(currentUser = null, client = pool) {
  const accessContext = currentUser ? await getLeadAccessContext(currentUser, client) : null;
  const accessClause = accessContext?.accessSql.clause || "1 = 1";
  const accessParams = accessContext?.accessSql.params || [];
  const rows = await queryRows(buildKanbanPipelinesSql(accessClause), accessParams, client);
  const pipelines = new Map();

  for (const row of rows) {
    const pipelineId = row.__pipeline_id;
    if (!pipelineId) continue;
    if (!pipelines.has(pipelineId)) {
      pipelines.set(pipelineId, {
        row: {
          id: pipelineId,
          name: row.__pipeline_name,
          is_default: row.__pipeline_is_default,
          is_archived: row.__pipeline_is_archived,
          position: row.__pipeline_position,
          created_at: row.__pipeline_created_at,
          updated_at: row.__pipeline_updated_at,
        },
        cardCount: Number(row.__pipeline_card_count || 0),
        stages: [],
      });
    }
    if (row.id) {
      pipelines.get(pipelineId).stages.push(rowToKanbanStage(row, Number(row.__stage_card_count || 0)));
    }
  }

  return Array.from(pipelines.values()).map((pipeline) => rowToKanbanPipeline(
    pipeline.row,
    pipeline.stages,
    pipeline.cardCount,
  ));
}

function getKanbanFiltersFromUrl(requestUrl) {
  return {
    search: requestUrl.searchParams.get("search") || "",
    status: requestUrl.searchParams.get("status") || "",
    temperature: requestUrl.searchParams.get("temperature") || "",
    responsible: requestUrl.searchParams.get("responsible") || "",
    quickFilter: requestUrl.searchParams.get("quickFilter") || "",
  };
}

async function getKanbanBoardFromRequest(requestUrl, currentUser) {
  const requestedPipelineId = requestUrl.searchParams.get("pipelineId") || "";
  const limitPerStage = parseBoundedInteger(requestUrl.searchParams.get("limitPerStage"), 50, 10, 100);
  const filters = getKanbanFiltersFromUrl(requestUrl);
  const accessContext = await getLeadAccessContext(currentUser);

  const metadataRows = await queryRows(
    buildKanbanBoardMetadataSql(accessContext.accessSql.clause),
    [requestedPipelineId, requestedPipelineId, ...accessContext.accessSql.params],
  );
  if (!metadataRows.length || !metadataRows[0].__pipeline_id) {
    const error = new Error("Nenhum funil ativo foi encontrado.");
    error.statusCode = 404;
    throw error;
  }

  const firstMetadataRow = metadataRows[0];
  const pipelineRow = {
    id: firstMetadataRow.__pipeline_id,
    name: firstMetadataRow.__pipeline_name,
    is_default: firstMetadataRow.__pipeline_is_default,
    is_archived: firstMetadataRow.__pipeline_is_archived,
    position: firstMetadataRow.__pipeline_position,
    created_at: firstMetadataRow.__pipeline_created_at,
    updated_at: firstMetadataRow.__pipeline_updated_at,
  };
  const stageRows = metadataRows.filter((row) => row.id);
  const stageCardCountMap = new Map(stageRows.map((row) => [row.id, Number(row.__stage_card_count || 0)]));
  const pipelineCardCount = Number(firstMetadataRow.__pipeline_card_count || 0);

  const { where, params } = await buildLeadsPageQuery(filters, accessContext);
  const cardRows = stageRows.length
    ? await queryRows(
        buildKanbanInitialCardsSql(where),
        [...params, pipelineRow.id, limitPerStage],
      )
    : [];

  const cardsByStage = new Map();
  const filteredCountByStage = new Map();
  for (const row of cardRows) {
    const stageId = row.pipeline_stage_id;
    if (!cardsByStage.has(stageId)) cardsByStage.set(stageId, []);
    cardsByStage.get(stageId).push(rowToLead(row));
    if (!filteredCountByStage.has(stageId)) {
      filteredCountByStage.set(stageId, Number(row.__filtered_card_count || 0));
    }
  }

  let filtersTotal = 0;
  const columns = stageRows.map((stage) => {
    const cards = cardsByStage.get(stage.id) || [];
    const filteredCardCount = filteredCountByStage.get(stage.id) || 0;
    filtersTotal += filteredCardCount;
    return {
      ...rowToKanbanStage(stage, stageCardCountMap.get(stage.id) || 0),
      filteredCardCount,
      cards,
      hasMore: cards.length < filteredCardCount,
    };
  });

  return {
    pipeline: rowToKanbanPipeline(
      pipelineRow,
      columns.map(({ cards, hasMore, filteredCardCount, ...stage }) => stage),
      pipelineCardCount,
    ),
    stages: columns,
    filtersTotal,
    limitPerStage,
  };
}

async function getKanbanStageCardsFromRequest(stageId, requestUrl, currentUser) {
  const stage = await getKanbanStageById(stageId);
  if (!stage) {
    const error = new Error("Etapa não encontrada.");
    error.statusCode = 404;
    throw error;
  }

  const offset = parseBoundedInteger(requestUrl.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = parseBoundedInteger(requestUrl.searchParams.get("limit"), 50, 1, 100);
  const accessContext = await getLeadAccessContext(currentUser);
  const { where, params } = await buildLeadsPageQuery(getKanbanFiltersFromUrl(requestUrl), accessContext);
  const stageWhere = `${where} AND pipeline_id = ? AND pipeline_stage_id = ?`;
  const stageParams = [...params, stage.pipeline_id, stage.id];
  const rows = await queryRows(
    buildKanbanStagePageSql(stageWhere),
    [...stageParams, limit, offset],
  );
  const total = rows.length ? Number(rows[0].__filtered_card_count || 0) : offset;

  return { cards: rows.map(rowToLead), total, hasMore: offset + rows.length < total };
}

function getStageStatusUpdate(stage, currentStatus = "Novo lead") {
  const stageType = normalizeKanbanStageType(stage.stage_type);
  if (stageType === "won") return { status: "Fechado", isLost: 0 };
  if (stageType === "lost") return { status: "Perdido", isLost: 1 };
  if (stage.status_key) return { status: stage.status_key, isLost: stage.status_key === "Perdido" ? 1 : 0 };
  if (currentStatus === "Fechado" || currentStatus === "Perdido") return { status: "Novo lead", isLost: 0 };
  return { status: currentStatus || "Novo lead", isLost: 0 };
}

async function rebalanceKanbanStagePositions(stageId, client = pool) {
  const rows = await queryRows(
    "SELECT id FROM leads WHERE pipeline_stage_id = ? AND deleted_at = '' ORDER BY kanban_position ASC, updated_at DESC, created_at DESC",
    [stageId],
    client,
  );
  for (let index = 0; index < rows.length; index += 1) {
    await execute("UPDATE leads SET kanban_position = ? WHERE id = ?", [(index + 1) * 1000, rows[index].id], client);
  }
}

async function calculateKanbanPosition({ leadId, stageId, beforeLeadId, afterLeadId }, client = pool, canRebalance = true) {
  async function positionFor(candidateId) {
    if (!candidateId || candidateId === leadId) return null;
    const row = await statementFirstRow(
      "SELECT kanban_position FROM leads WHERE id = ? AND pipeline_stage_id = ? AND deleted_at = '' LIMIT 1",
      [candidateId, stageId],
      client,
    );
    return row ? Number(row.kanban_position || 0) : null;
  }

  async function nearestPosition(operator, position, direction) {
    const row = await statementFirstRow(
      `SELECT kanban_position FROM leads
       WHERE pipeline_stage_id = ? AND deleted_at = '' AND id != ? AND kanban_position ${operator} ?
       ORDER BY kanban_position ${direction} LIMIT 1`,
      [stageId, leadId, position],
      client,
    );
    return row ? Number(row.kanban_position || 0) : null;
  }

  function midpoint(lowerPosition, upperPosition) {
    return lowerPosition + (upperPosition - lowerPosition) / 2;
  }

  async function rebalanceAndRetry() {
    if (!canRebalance) return null;
    await rebalanceKanbanStagePositions(stageId, client);
    return calculateKanbanPosition({ leadId, stageId, beforeLeadId, afterLeadId }, client, false);
  }

  const beforePosition = await positionFor(beforeLeadId);
  const afterPosition = await positionFor(afterLeadId);

  if (beforePosition !== null && afterPosition !== null) {
    const lowerPosition = Math.min(beforePosition, afterPosition);
    const upperPosition = Math.max(beforePosition, afterPosition);
    if (upperPosition - lowerPosition < 0.0001) {
      const rebalancedPosition = await rebalanceAndRetry();
      if (rebalancedPosition !== null) return rebalancedPosition;
    }
    return midpoint(lowerPosition, upperPosition);
  }

  if (beforePosition !== null) {
    const previousPosition = await nearestPosition("<", beforePosition, "DESC");
    if (previousPosition !== null) {
      if (beforePosition - previousPosition < 0.0001) {
        const rebalancedPosition = await rebalanceAndRetry();
        if (rebalancedPosition !== null) return rebalancedPosition;
      }
      return midpoint(previousPosition, beforePosition);
    }
    return beforePosition - 1000;
  }

  if (afterPosition !== null) {
    const nextPosition = await nearestPosition(">", afterPosition, "ASC");
    if (nextPosition !== null) {
      if (nextPosition - afterPosition < 0.0001) {
        const rebalancedPosition = await rebalanceAndRetry();
        if (rebalancedPosition !== null) return rebalancedPosition;
      }
      return midpoint(afterPosition, nextPosition);
    }
    return afterPosition + 1000;
  }

  const maxPosition = Number(await scalar(
    "SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ? AND deleted_at = '' AND id != ?",
    [stageId, leadId],
    client,
  ) || 0);
  return maxPosition + 1000;
}

async function findDuplicateLead(lead, client = pool, accessContext = null) {
  const normalizedLead = normalizeLead(lead);
  const emailKey = normalizeEmailKey(normalizedLead.email);
  const phoneKey = normalizePhoneKey(normalizedLead.phone);
  const nameCompanyKey = normalizeNameCompanyKey(normalizedLead);
  const accessClause = accessContext ? ` AND ${accessContext.accessSql.clause}` : "";
  const accessParams = accessContext ? accessContext.accessSql.params : [];

  if (emailKey) {
    const row = await statementFirstRow(
      `SELECT * FROM leads WHERE deleted_at = '' AND email_key = ?${accessClause} LIMIT 1`,
      [emailKey, ...accessParams],
      client,
    );
    if (row) return rowToLead(row);
  }

  const phoneVariants = phoneKeyVariants(phoneKey);
  if (phoneVariants.length) {
    const placeholders = phoneVariants.map(() => "?").join(", ");
    const row = await statementFirstRow(
      `SELECT * FROM leads WHERE deleted_at = '' AND phone_key IN (${placeholders})${accessClause} LIMIT 1`,
      [...phoneVariants, ...accessParams],
      client,
    );
    if (row) return rowToLead(row);
  }

  if (nameCompanyKey) {
    const row = await statementFirstRow(
      `SELECT * FROM leads WHERE deleted_at = '' AND name_company_key = ?${accessClause} LIMIT 1`,
      [nameCompanyKey, ...accessParams],
      client,
    );
    if (row) return rowToLead(row);
  }

  return null;
}

function shouldReplaceValue(currentValue, incomingValue) {
  return !String(currentValue || "").trim() && String(incomingValue || "").trim();
}

function mergeServiceStatusMaps(currentMap = {}, incomingMap = {}) {
  const mergedMap = { ...currentMap };
  Object.entries(incomingMap || {}).forEach(([service, status]) => {
    if (!status || status === "Não sabemos") return;
    if (!mergedMap[service] || mergedMap[service] === "Não sabemos") mergedMap[service] = status;
  });
  return mergedMap;
}

function mergeCustomFields(currentFields = {}, incomingFields = {}) {
  const mergedFields = normalizeCustomFields(currentFields);
  const normalizedIncomingFields = normalizeCustomFields(incomingFields);
  Object.entries(normalizedIncomingFields).forEach(([field, value]) => {
    if (!String(mergedFields[field] || "").trim() && String(value || "").trim()) mergedFields[field] = value;
  });
  return mergedFields;
}

function mergeLeadData(currentLead, incomingLead) {
  const mergedStatus = currentLead.status === "Novo lead" && incomingLead.status !== "Novo lead" ? incomingLead.status : currentLead.status;
  const isLost = currentLead.isLost || incomingLead.isLost || mergedStatus === "Perdido";
  const mergedServiceStatusMap = mergeServiceStatusMaps(currentLead.serviceStatusMap, incomingLead.serviceStatusMap);
  const mergedServiceInterests = Array.from(new Set([...(currentLead.serviceInterests || []), ...(incomingLead.serviceInterests || []), ...Object.keys(mergedServiceStatusMap)]));

  return normalizeLead({
    ...currentLead,
    name: shouldReplaceValue(currentLead.name, incomingLead.name) ? incomingLead.name : currentLead.name,
    email: shouldReplaceValue(currentLead.email, incomingLead.email) ? incomingLead.email : currentLead.email,
    phone: shouldReplaceValue(currentLead.phone, incomingLead.phone) ? incomingLead.phone : currentLead.phone,
    company: shouldReplaceValue(currentLead.company, incomingLead.company) ? incomingLead.company : currentLead.company,
    website: shouldReplaceValue(currentLead.website, incomingLead.website) ? incomingLead.website : currentLead.website,
    advertisesOnMeta: currentLead.advertisesOnMeta || incomingLead.advertisesOnMeta,
    advertisesOnGoogle: currentLead.advertisesOnGoogle || incomingLead.advertisesOnGoogle,
    doesNotAdvertise: currentLead.doesNotAdvertise || incomingLead.doesNotAdvertise,
    lastContactAt: shouldReplaceValue(currentLead.lastContactAt, incomingLead.lastContactAt) ? incomingLead.lastContactAt : currentLead.lastContactAt,
    contactMadeAt: shouldReplaceValue(currentLead.contactMadeAt, incomingLead.contactMadeAt) ? incomingLead.contactMadeAt : currentLead.contactMadeAt,
    nextContactAt: shouldReplaceValue(currentLead.nextContactAt, incomingLead.nextContactAt) ? incomingLead.nextContactAt : currentLead.nextContactAt,
    expectedCloseAt: shouldReplaceValue(currentLead.expectedCloseAt, incomingLead.expectedCloseAt) ? incomingLead.expectedCloseAt : currentLead.expectedCloseAt,
    estimatedBudget: shouldReplaceValue(currentLead.estimatedBudget, incomingLead.estimatedBudget) ? incomingLead.estimatedBudget : currentLead.estimatedBudget,
    isLost,
    lostReason: shouldReplaceValue(currentLead.lostReason, incomingLead.lostReason) ? incomingLead.lostReason : currentLead.lostReason,
    commercialNotes: [currentLead.commercialNotes, incomingLead.commercialNotes].filter(Boolean).join(currentLead.commercialNotes && incomingLead.commercialNotes ? "\n" : ""),
    status: isLost ? "Perdido" : mergedStatus,
    responsible: shouldReplaceValue(currentLead.responsible, incomingLead.responsible) ? incomingLead.responsible : currentLead.responsible,
    responsibleUserId: shouldReplaceValue(currentLead.responsibleUserId, incomingLead.responsibleUserId) ? incomingLead.responsibleUserId : currentLead.responsibleUserId,
    temperature: shouldReplaceValue(currentLead.temperature, incomingLead.temperature) ? incomingLead.temperature : currentLead.temperature,
    pain: shouldReplaceValue(currentLead.pain, incomingLead.pain) ? incomingLead.pain : currentLead.pain,
    source: shouldReplaceValue(currentLead.source, incomingLead.source) ? incomingLead.source : currentLead.source,
    serviceInterests: mergedServiceInterests,
    serviceStatusMap: mergedServiceStatusMap,
    customFields: mergeCustomFields(currentLead.customFields, incomingLead.customFields),
  });
}

async function alignLeadKanbanStageWithStatus(lead, existingLead, client = pool) {
  const normalizedLead = normalizeLead(lead);
  if (!existingLead || existingLead.status === normalizedLead.status) return normalizedLead;

  const statusConsistentLead = {
    ...normalizedLead,
    isLost: normalizedLead.status === "Perdido",
  };
  if (!normalizedLead.pipelineId) return statusConsistentLead;

  const targetStage = await statementFirstRow(
    `SELECT id, stage_type, status_key FROM kanban_stages
     WHERE pipeline_id = ? AND is_archived = 0 AND status_key = ?
     ORDER BY position ASC, created_at ASC LIMIT 1 FOR UPDATE`,
    [normalizedLead.pipelineId, normalizedLead.status],
    client,
  );
  if (!targetStage) return statusConsistentLead;

  const stageStatus = getStageStatusUpdate(targetStage, normalizedLead.status);
  if (targetStage.id === normalizedLead.pipelineStageId) {
    return { ...statusConsistentLead, status: stageStatus.status, isLost: Boolean(stageStatus.isLost) };
  }

  const maxPosition = Number(await scalar(
    "SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ? AND deleted_at = '' AND id != ?",
    [targetStage.id, normalizedLead.id],
    client,
  ) || 0);

  return {
    ...statusConsistentLead,
    status: stageStatus.status,
    isLost: Boolean(stageStatus.isLost),
    pipelineStageId: targetStage.id,
    kanbanPosition: maxPosition + 1000,
    pipelineEnteredAt: nowIso(),
  };
}

async function resolveLeadResponsibleLink(lead, client = pool) {
  const normalizedLead = normalizeLead(lead);
  if (normalizedLead.responsibleUserId) {
    const user = await statementFirstRow(
      "SELECT id, name, email FROM users WHERE id = ? AND is_active = 1 LIMIT 1",
      [normalizedLead.responsibleUserId],
      client,
    );
    if (!user) return { ...normalizedLead, responsibleUserId: "" };
    return { ...normalizedLead, responsible: user.name || user.email || normalizedLead.responsible };
  }

  const responsible = String(normalizedLead.responsible || "").trim();
  if (!responsible) return normalizedLead;
  const matches = await queryRows(
    `SELECT id, name, email FROM users
     WHERE is_active = 1 AND (LOWER(TRIM(name)) = LOWER(TRIM(?)) OR LOWER(TRIM(email)) = LOWER(TRIM(?)))
     LIMIT 2`,
    [responsible, responsible],
    client,
  );
  if (matches.length !== 1) return normalizedLead;
  return { ...normalizedLead, responsibleUserId: matches[0].id, responsible: matches[0].name || matches[0].email || responsible };
}

async function validateLeadAssignmentForActor(lead, actor, client = pool) {
  const role = normalizeUserRole(actor?.role);
  if (role === USER_ROLES.SALES_CONSULTANT) return lead;

  const resolvedLead = await resolveLeadResponsibleLink(lead, client);
  const responsibleUserId = String(resolvedLead.responsibleUserId || "").trim();
  const responsible = String(resolvedLead.responsible || "").trim();
  if (!responsibleUserId && !responsible) return resolvedLead;

  if (!responsibleUserId) {
    const error = new Error("Selecione um consultor de vendas válido para atribuir o lead.");
    error.statusCode = 400;
    throw error;
  }

  const targetUser = await statementFirstRow("SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1", [responsibleUserId], client);
  if (!targetUser || !Number(targetUser.is_active)) {
    const error = new Error("O responsável selecionado não está ativo.");
    error.statusCode = 400;
    throw error;
  }

  if (role === USER_ROLES.PRE_SALES && normalizeUserRole(targetUser.role) !== USER_ROLES.SALES_CONSULTANT) {
    const error = new Error("Pré-venda só pode transferir leads para consultores de vendas ativos.");
    error.statusCode = 403;
    throw error;
  }

  return {
    ...resolvedLead,
    responsibleUserId: targetUser.id,
    responsible: targetUser.name || targetUser.email || resolvedLead.responsible,
  };
}

const LEAD_IDENTITY_LOCK_NAME = `crm:${createHash("sha256").update(MYSQL_DATABASE).digest("hex").slice(0, 40)}:lead-identity`;

async function acquireLeadIdentityMutationLock(client, transactionContext) {
  if (!transactionContext?.afterCompletion || client === pool) {
    const error = new Error("A alteração de identidade do lead exige uma transação dedicada.");
    error.code = "LEAD_IDENTITY_TRANSACTION_REQUIRED";
    throw error;
  }

  const acquired = Number(await scalar(
    "SELECT GET_LOCK(?, ?) AS acquired",
    [LEAD_IDENTITY_LOCK_NAME, LEAD_IDENTITY_LOCK_TIMEOUT_SECONDS],
    client,
  ));
  if (acquired !== 1) {
    const error = new Error("Outra importação ou alteração de contato está em andamento. Tente novamente em instantes.");
    error.statusCode = 409;
    error.code = "LEAD_IDENTITY_LOCK_TIMEOUT";
    throw error;
  }

  transactionContext.afterCompletion(async () => {
    await scalar("SELECT RELEASE_LOCK(?) AS released", [LEAD_IDENTITY_LOCK_NAME], client);
  });
}

async function saveLead(lead, client = pool) {
  const linkedLead = await resolveLeadResponsibleLink(lead, client);
  const normalizedLead = await ensureLeadKanbanAssignment(linkedLead, client);
  const updatedAt = nowIso();
  await execute(UPSERT_LEAD_SQL, leadToDbParams({ ...normalizedLead, updatedAt }, { updatedAt }), client);
  invalidateLeadSummaryCache();
  invalidateKanbanCountsCache();
  return { ...normalizedLead, updatedAt };
}

async function saveLeadWithDuplicateProtection(lead, client = pool, accessContext = null, transactionContext = null) {
  await acquireLeadIdentityMutationLock(client, transactionContext);
  const normalizedLead = normalizeLead(lead);
  const duplicateLead = await findDuplicateLead(normalizedLead, client, accessContext);

  if (duplicateLead && duplicateLead.id !== normalizedLead.id) {
    const mergedLead = mergeLeadData(duplicateLead, { ...normalizedLead, id: duplicateLead.id });
    return { lead: await saveLead(mergedLead, client), action: "merged", duplicatedLeadId: duplicateLead.id };
  }

  return { lead: await saveLead(normalizedLead, client), action: "created_or_updated", duplicatedLeadId: "" };
}


function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, originalHash] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !originalHash) return false;

  const computedHash = scryptSync(String(password), salt, 64);
  const storedBuffer = Buffer.from(originalHash, "hex");
  if (storedBuffer.length !== computedHash.length) return false;
  return timingSafeEqual(storedBuffer, computedHash);
}

function rowToUser(row, includePermissions = true) {
  const role = normalizeUserRole(row.role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    roleLabel: roleLabels[role] || role,
    teamId: row.team_id || "",
    teamName: row.team_name || "",
    leadAccessScope: getFixedLeadAccessScopeForRole(role),
    isActive: Boolean(Number(row.is_active)),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    lastLoginAt: row.last_login_at || "",
    permissions: includePermissions ? Array.from(getPermissionsForRole(role)) : [],
  };
}

async function getUserById(userId, client = pool) {
  const row = await statementFirstRow("SELECT * FROM users WHERE id = ? LIMIT 1", [userId], client);
  return row ? rowToUser(row) : null;
}

async function getUserByEmail(email, client = pool) {
  return statementFirstRow("SELECT * FROM users WHERE email = ? LIMIT 1", [normalizeEmailKey(email)], client);
}

function hasPermission(user, permission) {
  return hasRolePermission(user, permission);
}

function requireAnyPermission(user, permissions) {
  if (!permissions.some((permission) => hasPermission(user, permission))) {
    const error = new Error("Você não tem permissão para executar esta ação.");
    error.statusCode = 403;
    throw error;
  }
}

function requirePermission(user, permission) {
  if (!hasPermission(user, permission)) {
    const error = new Error("Você não tem permissão para executar esta ação.");
    error.statusCode = 403;
    throw error;
  }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function getSessionToken(request) {
  return getCookieValue(request, SESSION_COOKIE_NAME);
}

function setSessionCookie(response, sessionToken) {
  response.setHeader("Set-Cookie", serializeSessionCookie({
    name: SESSION_COOKIE_NAME,
    token: sessionToken,
    maxAgeSeconds: SESSION_TTL_HOURS * 60 * 60,
    secure: SESSION_COOKIE_SECURE,
    sameSite: SESSION_COOKIE_SAME_SITE,
  }));
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", serializeClearedSessionCookie({
    name: SESSION_COOKIE_NAME,
    secure: SESSION_COOKIE_SECURE,
    sameSite: SESSION_COOKIE_SAME_SITE,
  }));
}

async function createSession(userId, client = pool) {
  const secrets = createSessionSecrets();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await execute(
    "INSERT INTO sessions (token, token_format, user_id, csrf_token_hash, created_at, expires_at) VALUES (?, 'sha256', ?, ?, ?, ?)",
    [secrets.sessionTokenHash, userId, secrets.csrfTokenHash, nowIso(), expiresAt],
    client,
  );
  return { sessionToken: secrets.sessionToken, csrfToken: secrets.csrfToken, expiresAt };
}

async function authenticateRequest(request) {
  const sessionToken = getSessionToken(request);
  if (!sessionToken) return null;
  const sessionTokenHash = hashOpaqueToken(sessionToken);

  const row = await statementFirstRow(
    `SELECT users.*, sessions.token AS session_token_hash, sessions.csrf_token_hash
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
        AND sessions.token_format = 'sha256'
        AND sessions.expires_at > ?
        AND users.is_active = 1
      LIMIT 1`,
    [sessionTokenHash, nowIso()],
  );

  if (!row) return null;
  return {
    user: rowToUser(row),
    sessionToken,
    sessionTokenHash: row.session_token_hash,
    csrfTokenHash: row.csrf_token_hash || "",
  };
}

async function cleanupExpiredSessions() {
  const result = await execute("DELETE FROM sessions WHERE expires_at <= ?", [nowIso()]);
  return Number(result?.affectedRows || 0);
}

async function enforceRateLimit(namespace, identity, limit, windowMs, message) {
  const decision = await consumeMysqlRateLimit({
    execute,
    statementFirstRow,
    bucketKey: createRateLimitBucket(namespace, identity),
    limit,
    windowMs,
  });
  if (!decision.allowed) throw createRateLimitError(message, decision);
  return decision;
}

async function assertLoginRateLimit(request, email) {
  const clientIp = resolveClientIp(request, TRUST_PROXY_POLICY);
  await enforceRateLimit(
    "login-ip",
    clientIp,
    LOGIN_RATE_LIMIT_MAX_IP,
    LOGIN_RATE_LIMIT_WINDOW_MS,
    "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
  );
  await enforceRateLimit(
    "login-email",
    normalizeEmailKey(email) || "empty",
    LOGIN_RATE_LIMIT_MAX_EMAIL,
    LOGIN_RATE_LIMIT_WINDOW_MS,
    "Muitas tentativas para esta conta. Aguarde alguns minutos e tente novamente.",
  );
}

async function recordAudit({ entityType = "lead", entityId = "", action, actor = null, changes = {}, summary = "" }, client = pool) {
  await execute(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_name, changes_json, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), entityType, entityId, action, actor?.id || "system", actor?.name || "Sistema", JSON.stringify(changes || {}), summary, nowIso()],
    client,
  );
}

async function recordAuditOnce({ id, entityType = "lead", entityId = "", action, actor = null, changes = {}, summary = "" }, client = pool) {
  const auditId = String(id || "").trim();
  if (!auditId) return recordAudit({ entityType, entityId, action, actor, changes, summary }, client);
  await execute(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_name, changes_json, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [auditId, entityType, entityId, action, actor?.id || "system", actor?.name || "Sistema", JSON.stringify(changes || {}), summary, nowIso()],
    client,
  );
}

async function assertZapeIntegrationAccess(request) {
  if (!ZAPE_INTEGRATION_KEY) {
    const error = new Error("Integração Zape não configurada no CRM.");
    error.statusCode = 503;
    throw error;
  }

  const token = getBearerToken(request);
  if (!safeSecretEquals(token, ZAPE_INTEGRATION_KEY)) {
    const error = new Error("Chave de integração inválida.");
    error.statusCode = 401;
    throw error;
  }

  const clientIp = resolveClientIp(request, TRUST_PROXY_POLICY);
  await enforceRateLimit(
    "integration-zape",
    clientIp,
    INTEGRATION_RATE_LIMIT_MAX,
    INTEGRATION_RATE_LIMIT_WINDOW_MS,
    "Limite temporário da integração excedido.",
  );
}

async function cleanupSecurityState() {
  await Promise.all([
    cleanupExpiredSessions(),
    cleanupExpiredRateLimits({ execute }),
  ]);
}

async function getZapeIntegrationCatalog(client = pool) {
  const pipelines = await getKanbanPipelines(null, client);
  return {
    configured: Boolean(ZAPE_INTEGRATION_KEY),
    defaultPipelineId: pipelines.find((pipeline) => pipeline.isDefault)?.id || pipelines[0]?.id || "",
    pipelines: pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      stages: (pipeline.stages || []).map((stage) => ({
        id: stage.id,
        name: stage.name,
        stageType: stage.stageType,
        statusKey: stage.statusKey,
      })),
    })),
  };
}

async function resolveZapeKanbanTarget(target, client = pool) {
  const requestedPipelineId = String(target?.pipelineId || "");
  const requestedStageId = String(target?.stageId || "");

  if (requestedPipelineId && requestedStageId) {
    const stage = await statementFirstRow(
      `SELECT s.* FROM kanban_stages s
       INNER JOIN kanban_pipelines p ON p.id = s.pipeline_id
       WHERE s.id = ? AND s.pipeline_id = ? AND s.is_archived = 0 AND p.is_archived = 0
       LIMIT 1`,
      [requestedStageId, requestedPipelineId],
      client,
    );
    if (!stage) {
      const error = new Error("Funil ou etapa configurados para a integração não existem mais.");
      error.statusCode = 422;
      throw error;
    }
    return { pipelineId: requestedPipelineId, stageId: requestedStageId };
  }

  const cache = defaultKanbanCache || await loadDefaultKanbanCache(client);
  if (!cache?.pipelineId || !cache?.fallbackStageId) {
    const error = new Error("O CRM não possui funil e etapa padrão disponíveis.");
    error.statusCode = 422;
    throw error;
  }

  return {
    pipelineId: cache.pipelineId,
    stageId: cache.stagesByStatus?.["Novo lead"] || cache.fallbackStageId,
  };
}

async function upsertLeadExternalOrigin(leadId, payload, client = pool) {
  const at = nowIso();
  const metadata = {
    eventKey: payload.eventKey,
    externalLeadId: payload.externalLeadId,
    payloadType: payload.webhook.payloadType,
    tags: payload.lead.tags,
    ...payload.metadata,
  };

  await execute(
    `INSERT INTO lead_external_origins (
       id, lead_id, provider, tenant_id, webhook_id, webhook_name, source,
       first_seen_at, last_seen_at, occurrences, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       webhook_name = IF(VALUES(webhook_name) != '', VALUES(webhook_name), webhook_name),
       source = VALUES(source),
       last_seen_at = VALUES(last_seen_at),
       occurrences = occurrences + 1,
       metadata_json = VALUES(metadata_json)`,
    [
      randomUUID(),
      leadId,
      payload.provider,
      payload.tenantId,
      payload.webhook.id,
      payload.webhook.name,
      payload.target.source,
      at,
      at,
      JSON.stringify(metadata),
    ],
    client,
  );
}

async function processZapeLeadIntegration(body, client = pool, transactionContext = null) {
  await acquireLeadIdentityMutationLock(client, transactionContext);
  const payload = normalizeZapePayload(body);
  const previousEvent = await statementFirstRow(
    "SELECT * FROM integration_events WHERE event_key = ? LIMIT 1 FOR UPDATE",
    [payload.eventKey],
    client,
  );

  if (previousEvent) {
    return {
      ...parseJsonValue(previousEvent.response_json, { ok: true, leadId: previousEvent.lead_id }),
      idempotentReplay: true,
    };
  }

  const at = nowIso();
  await execute(
    `INSERT INTO integration_events (
       event_key, provider, tenant_id, external_lead_id, lead_id, status, response_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, '', 'processing', NULL, ?, ?)`,
    [payload.eventKey, payload.provider, payload.tenantId, payload.externalLeadId, at, at],
    client,
  );

  const target = await resolveZapeKanbanTarget(payload.target, client);
  const incomingLead = normalizeLead({
    id: randomUUID(),
    name: payload.lead.name,
    email: payload.lead.email,
    phone: payload.lead.phone,
    company: payload.lead.company,
    website: payload.lead.website,
    advertisesOnGoogle: payload.lead.advertisesOnGoogle || normalizeBooleanText(payload.lead.advertisesOnGoogleRaw),
    status: "Novo lead",
    source: payload.target.source,
    createdAt: payload.lead.createdAt || at,
    updatedAt: at,
    pipelineId: target.pipelineId,
    pipelineStageId: target.stageId,
    pipelineEnteredAt: at,
  });

  const existingLead = await findDuplicateLead(incomingLead, client);
  let savedLead;
  let action;
  let changes;

  if (existingLead) {
    const mergedLead = mergeLeadData(existingLead, { ...incomingLead, id: existingLead.id });
    savedLead = await saveLead(mergedLead, client);
    action = "updated";
    changes = {
      ...diffLeads(existingLead, savedLead),
      externalOrigin: {
        provider: payload.provider,
        tenantId: payload.tenantId,
        webhookId: payload.webhook.id,
        webhookName: payload.webhook.name,
      },
    };
  } else {
    savedLead = await saveLead(incomingLead, client);
    action = "created";
    changes = {
      externalOrigin: {
        provider: payload.provider,
        tenantId: payload.tenantId,
        webhookId: payload.webhook.id,
        webhookName: payload.webhook.name,
      },
    };
  }

  await upsertLeadExternalOrigin(savedLead.id, payload, client);

  const actor = { id: "integration-zape", name: "Integração WhatsApp" };
  const leadLabel = savedLead.name || savedLead.phone || savedLead.email || savedLead.id;
  await recordAudit({
    entityType: "lead",
    entityId: savedLead.id,
    action: action === "created" ? "lead_created_by_whatsapp_integration" : "lead_external_origin_received",
    actor,
    summary: action === "created"
      ? `Lead criado pela integração WhatsApp: ${leadLabel}`
      : `Lead existente recebeu nova origem via WhatsApp: ${leadLabel}`,
    changes,
  }, client);

  const responsePayload = {
    ok: true,
    action,
    leadId: savedLead.id,
    duplicateMatched: Boolean(existingLead),
    pipelineId: savedLead.pipelineId || "",
    stageId: savedLead.pipelineStageId || "",
    eventKey: payload.eventKey,
  };

  await execute(
    "UPDATE integration_events SET lead_id = ?, status = 'completed', response_json = ?, updated_at = ? WHERE event_key = ?",
    [savedLead.id, JSON.stringify(responsePayload), nowIso(), payload.eventKey],
    client,
  );

  return responsePayload;
}

function rowToExternalOrigin(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    provider: row.provider,
    tenantId: row.tenant_id,
    webhookId: row.webhook_id,
    webhookName: row.webhook_name,
    source: row.source,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrences: Number(row.occurrences || 0),
    metadata: parseJsonValue(row.metadata_json, {}),
  };
}

const auditableLeadFields = [
  "name",
  "email",
  "phone",
  "company",
  "website",
  "advertisesOnMeta",
  "advertisesOnGoogle",
  "doesNotAdvertise",
  "lastContactAt",
  "contactMadeAt",
  "nextContactAt",
  "expectedCloseAt",
  "estimatedBudget",
  "isLost",
  "lostReason",
  "commercialNotes",
  "status",
  "responsible",
  "responsibleUserId",
  "temperature",
  "pain",
  "source",
  "serviceInterests",
  "serviceStatusMap",
  "customFields",
  "pipelineId",
  "pipelineStageId",
];

function diffLeads(beforeLead, afterLead) {
  const changes = {};
  auditableLeadFields.forEach((field) => {
    const beforeValue = JSON.stringify(beforeLead?.[field] ?? "");
    const afterValue = JSON.stringify(afterLead?.[field] ?? "");
    if (beforeValue !== afterValue) changes[field] = { from: beforeLead?.[field] ?? "", to: afterLead?.[field] ?? "" };
  });
  return changes;
}

function rowToAudit(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    changes: parseJsonValue(row.changes_json, {}),
    summary: row.summary || "",
    createdAt: row.created_at,
  };
}

function rowToLeadNote(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    body: row.body || "",
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at || "",
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    type: normalizeTaskType(row.type),
    title: row.title || "",
    description: row.description || "",
    responsibleUserId: row.responsible_user_id || "",
    responsibleName: row.responsible_name || "",
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    leadId: row.lead_id || "",
    leadName: row.lead_name || "",
    leadCompany: row.lead_company || "",
    leadPhone: row.lead_phone || "",
    dueAt: row.due_at || "",
    priority: normalizeTaskPriority(row.priority),
    status: normalizeTaskStatus(row.status),
    result: row.result || "",
    completedAt: row.completed_at || "",
    completedBy: row.completed_by || "",
    nextTaskId: row.next_task_id || "",
    recurrence: row.recurrence || "",
    source: row.source || "manual",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

async function getTaskById(taskId, client = pool) {
  const row = await statementFirstRow(
    `SELECT t.*, l.name AS lead_name, l.company AS lead_company, l.phone AS lead_phone
     FROM tasks t
     LEFT JOIN leads l ON l.id = t.lead_id
     WHERE t.id = ?
     LIMIT 1`,
    [taskId],
    client,
  );
  return row ? rowToTask(row) : null;
}

async function assertTaskAccess(user, taskId, client = pool) {
  const accessSql = buildTaskAccessSql(user, "t");
  const row = await statementFirstRow(
    `SELECT t.id FROM tasks t WHERE t.id = ? AND ${accessSql.clause} LIMIT 1`,
    [taskId, ...accessSql.params],
    client,
  );
  if (!row) {
    const error = new Error("Tarefa não encontrada ou fora da sua responsabilidade.");
    error.statusCode = 404;
    throw error;
  }
}

async function resolveTaskResponsible(user, requestedUserId, fallbackLead = null, client = pool) {
  const requested = String(requestedUserId || fallbackLead?.responsibleUserId || user?.id || "").trim();
  const responsibleUserId = assertTaskAssignmentAllowed(user, requested);
  if (!responsibleUserId) {
    const error = new Error("Selecione o responsável pela tarefa.");
    error.statusCode = 400;
    throw error;
  }
  const responsible = await getUserById(responsibleUserId, client);
  if (!responsible || !responsible.isActive) {
    const error = new Error("O responsável selecionado não está ativo.");
    error.statusCode = 400;
    throw error;
  }
  return responsible;
}

async function refreshLeadNextContactFromTasks(leadId, client = pool) {
  const normalizedLeadId = String(leadId || "").trim();
  if (!normalizedLeadId) return "";
  const row = await statementFirstRow(
    "SELECT MIN(due_at) AS next_due_at FROM tasks WHERE lead_id = ? AND status = 'pending' AND TRIM(COALESCE(due_at, '')) != ''",
    [normalizedLeadId],
    client,
  );
  const nextDueAt = String(row?.next_due_at || "");
  await execute(
    "UPDATE leads SET next_contact_at = ?, updated_at = ? WHERE id = ?",
    [nextDueAt, nowIso(), normalizedLeadId],
    client,
  );
  await commercialProfileRuntime.refreshLead(normalizedLeadId, client);
  return nextDueAt;
}


async function cancelPendingTasksForLead(leadId, reason, actor, client = pool, options = {}) {
  const normalizedLeadId = String(leadId || "").trim();
  if (!normalizedLeadId) return 0;
  const clauses = ["lead_id = ?", "status = 'pending'"];
  const params = [normalizedLeadId];
  const previousResponsibleUserId = String(options.previousResponsibleUserId || "").trim();
  const previousResponsibleName = String(options.previousResponsibleName || "").trim().toLowerCase();
  if (previousResponsibleUserId || previousResponsibleName) {
    const ownershipClauses = [];
    if (previousResponsibleUserId) {
      ownershipClauses.push("responsible_user_id = ?");
      params.push(previousResponsibleUserId);
    }
    if (previousResponsibleName) {
      ownershipClauses.push("(TRIM(COALESCE(responsible_user_id, '')) = '' AND LOWER(TRIM(COALESCE(responsible_name, ''))) = ?)");
      params.push(previousResponsibleName);
    }
    clauses.push(`(${ownershipClauses.join(" OR ")})`);
  }
  if (options.excludeSourceKey) {
    clauses.push("COALESCE(source_key, '') != ?");
    params.push(String(options.excludeSourceKey));
  }
  const at = nowIso();
  const normalizedReason = String(reason || "Tarefa cancelada automaticamente pela regra de integridade operacional.").slice(0, 1000);
  const result = await execute(
    `UPDATE tasks
     SET status = 'canceled', source_key = NULL,
         result = CASE WHEN TRIM(COALESCE(result, '')) = '' THEN ? ELSE CONCAT(result, '\n', ?) END,
         updated_at = ?
     WHERE ${clauses.join(" AND ")}`,
    [normalizedReason, normalizedReason, at, ...params],
    client,
  );
  const affectedRows = Number(result?.affectedRows || 0);
  if (affectedRows > 0) {
    await recordAudit({
      entityType: "lead",
      entityId: normalizedLeadId,
      action: "lead_tasks_canceled",
      actor,
      summary: `Cancelou automaticamente ${affectedRows} tarefa(s) pendente(s)`,
      changes: { reason: normalizedReason, affectedRows },
    }, client);
  }
  await refreshLeadNextContactFromTasks(normalizedLeadId, client);
  return affectedRows;
}

async function cancelPendingTasksForClosedLeadsInStage(stageId, reason, actor, client = pool) {
  const normalizedStageId = String(stageId || "").trim();
  if (!normalizedStageId) return 0;
  const at = nowIso();
  const normalizedReason = String(reason || "Tarefa cancelada porque o lead foi encerrado.").slice(0, 1000);
  const result = await execute(
    `UPDATE tasks t
     INNER JOIN leads l ON l.id = t.lead_id
     SET t.status = 'canceled', t.source_key = NULL,
         t.result = CASE WHEN TRIM(COALESCE(t.result, '')) = '' THEN ? ELSE CONCAT(t.result, '\n', ?) END,
         t.updated_at = ?
     WHERE t.status = 'pending' AND l.deleted_at = '' AND l.pipeline_stage_id = ?
       AND (l.is_lost = 1 OR l.status IN ('Fechado', 'Perdido'))`,
    [normalizedReason, normalizedReason, at, normalizedStageId],
    client,
  );
  const affectedRows = Number(result?.affectedRows || 0);
  const nextMappingUrgencySql = "LEAST(100, mapping_urgency_score + CASE WHEN TRIM(COALESCE(next_contact_at, '')) != '' THEN 15 ELSE 0 END)";
  const nextLeadPrioritySql = `LEAST(100, GREATEST(0, ROUND(commercial_potential_score * 0.65 + (${nextMappingUrgencySql}) * 0.35)))`;
  const nextOpportunityScoreSql = `LEAST(100, ROUND((${nextLeadPrioritySql}) * 0.45 + service_agency_count * 10 + service_missing_count * 8 + service_unknown_count * 4 + service_casa_count * 2))`;
  await execute(
    `UPDATE leads SET
       mapping_urgency_score = CASE WHEN commercial_profile_version = ? THEN ${nextMappingUrgencySql} ELSE mapping_urgency_score END,
       lead_priority_score = CASE WHEN commercial_profile_version = ? THEN ${nextLeadPrioritySql} ELSE lead_priority_score END,
       opportunity_score = CASE WHEN commercial_profile_version = ? THEN ${nextOpportunityScoreSql} ELSE opportunity_score END,
       commercial_profile_updated_at = CASE WHEN commercial_profile_version = ? THEN ? ELSE commercial_profile_updated_at END,
       next_contact_at = '', updated_at = ?
     WHERE deleted_at = '' AND pipeline_stage_id = ? AND (is_lost = 1 OR status IN ('Fechado', 'Perdido'))`,
    [COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, at, at, normalizedStageId],
    client,
  );
  if (affectedRows > 0) {
    await recordAudit({
      entityType: "pipeline_stage",
      entityId: normalizedStageId,
      action: "stage_tasks_reconciled",
      actor,
      summary: `Cancelou ${affectedRows} tarefa(s) pendente(s) de leads encerrados na etapa`,
      changes: { reason: normalizedReason, affectedRows },
    }, client);
  }
  return affectedRows;
}

async function reconcileLeadTasksForLifecycle(lead, actor, client = pool) {
  if (!lead?.id || !isClosedLead(lead)) return 0;
  const reason = lead.deletedAt
    ? "Tarefa cancelada porque o lead foi enviado para a lixeira."
    : `Tarefa cancelada porque o lead foi marcado como ${lead.status || "encerrado"}.`;
  return cancelPendingTasksForLead(lead.id, reason, actor, client);
}

async function assertConsultantOperationallyClear(userRow, nextRole, nextIsActive, client = pool) {
  if (!userRow) return;
  const userId = String(userRow.id || "").trim();
  const identities = [userRow.name, userRow.email].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const legacyClause = identities.length
    ? `OR (TRIM(COALESCE(responsible_user_id, '')) = '' AND LOWER(TRIM(COALESCE(responsible, ''))) IN (${identities.map(() => "?").join(", ")}))`
    : "";
  const activeLeadCount = Number(await scalar(
    `SELECT COUNT(*) AS total FROM leads
     WHERE deleted_at = '' AND is_lost = 0 AND status NOT IN ('Fechado', 'Perdido')
       AND (responsible_user_id = ? ${legacyClause})`,
    [userId, ...identities],
    client,
  ) || 0);
  const pendingTaskCount = Number(await scalar(
    "SELECT COUNT(*) AS total FROM tasks WHERE responsible_user_id = ? AND status = 'pending'",
    [userId],
    client,
  ) || 0);
  assertConsultantCanBeDeactivated({
    existingRole: userRow.role,
    nextRole,
    nextIsActive,
    activeLeadCount,
    pendingTaskCount,
  });
}

async function mergeLeadRelations(primaryLead, duplicateLead, actor, client = pool) {
  const primaryLeadId = String(primaryLead?.id || "").trim();
  const duplicateLeadId = String(duplicateLead?.id || "").trim();
  if (!primaryLeadId || !duplicateLeadId || primaryLeadId === duplicateLeadId) return;
  const at = nowIso();
  const responsibleUserId = String(primaryLead.responsibleUserId || "").trim();
  const responsibleName = String(primaryLead.responsible || "").trim();

  if (responsibleUserId) {
    await execute(
      `UPDATE tasks SET lead_id = ?, responsible_user_id = ?, responsible_name = ?, source_key = NULL, updated_at = ?
       WHERE lead_id = ? AND status = 'pending'`,
      [primaryLeadId, responsibleUserId, responsibleName, at, duplicateLeadId],
      client,
    );
  } else {
    await cancelPendingTasksForLead(duplicateLeadId, "Tarefa cancelada durante mesclagem porque o lead principal não possui consultor responsável.", actor, client);
    await execute("UPDATE tasks SET lead_id = ?, source_key = NULL, updated_at = ? WHERE lead_id = ? AND status = 'pending'", [primaryLeadId, at, duplicateLeadId], client);
  }
  await execute("UPDATE tasks SET lead_id = ?, source_key = NULL, updated_at = ? WHERE lead_id = ? AND status != 'pending'", [primaryLeadId, at, duplicateLeadId], client);
  await execute("UPDATE lead_notes SET lead_id = ? WHERE lead_id = ?", [primaryLeadId, duplicateLeadId], client);
  await execute(
    `INSERT INTO lead_external_origins (
      id, lead_id, provider, tenant_id, webhook_id, webhook_name, source,
      first_seen_at, last_seen_at, occurrences, metadata_json
    )
    SELECT UUID(), ?, provider, tenant_id, webhook_id, webhook_name, source,
           first_seen_at, last_seen_at, occurrences, metadata_json
    FROM lead_external_origins WHERE lead_id = ?
    ON DUPLICATE KEY UPDATE
      occurrences = occurrences + VALUES(occurrences),
      first_seen_at = CASE
        WHEN first_seen_at = '' THEN VALUES(first_seen_at)
        WHEN VALUES(first_seen_at) = '' THEN first_seen_at
        ELSE LEAST(first_seen_at, VALUES(first_seen_at)) END,
      last_seen_at = CASE
        WHEN last_seen_at = '' THEN VALUES(last_seen_at)
        WHEN VALUES(last_seen_at) = '' THEN last_seen_at
        ELSE GREATEST(last_seen_at, VALUES(last_seen_at)) END,
      metadata_json = COALESCE(VALUES(metadata_json), metadata_json)`,
    [primaryLeadId, duplicateLeadId],
    client,
  );
  await execute("DELETE FROM lead_external_origins WHERE lead_id = ?", [duplicateLeadId], client);
  await execute("UPDATE integration_events SET lead_id = ?, updated_at = ? WHERE lead_id = ?", [primaryLeadId, at, duplicateLeadId], client);
  await execute(
    "UPDATE leads SET deleted_at = ?, deleted_by = ?, merged_into_lead_id = ?, updated_at = ? WHERE id = ?",
    [at, actor?.id || "system", primaryLeadId, at, duplicateLeadId],
    client,
  );
  await refreshLeadNextContactFromTasks(primaryLeadId, client);
}

async function createTaskRecord(payload, currentUser, client = pool, options = {}) {
  const validated = assertTaskPayload(payload);
  const leadId = String(payload.leadId || payload.lead_id || "").trim();
  let lead = null;
  if (leadId) {
    await assertLeadAccess(currentUser, leadId, { forUpdate: true }, client);
    lead = await getLeadById(leadId, {}, client);
  } else if (!canManageAllTasks(currentUser)) {
    const error = new Error("Consultores devem relacionar a tarefa a um lead da própria carteira.");
    error.statusCode = 400;
    throw error;
  }

  const responsible = await resolveTaskResponsible(currentUser, payload.responsibleUserId, lead, client);
  const id = options.id || randomUUID();
  const at = nowIso();
  const sourceKey = options.sourceKey || null;
  await execute(
    `INSERT INTO tasks (
      id, type, title, description, responsible_user_id, responsible_name,
      created_by, created_by_name, lead_id, due_at, priority, status,
      recurrence, source, source_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [
      id,
      validated.type,
      validated.title,
      validated.description,
      responsible.id,
      responsible.name || responsible.email,
      currentUser.id,
      currentUser.name || currentUser.email,
      leadId,
      validated.dueAt,
      validated.priority,
      String(payload.recurrence || "").slice(0, 80),
      options.source || "manual",
      sourceKey,
      at,
      at,
    ],
    client,
  );

  await recordAudit({
    entityType: "task",
    entityId: id,
    action: "task_created",
    actor: currentUser,
    summary: `Criou tarefa: ${validated.title}`,
    changes: { leadId, responsibleUserId: responsible.id, dueAt: validated.dueAt, priority: validated.priority },
  }, client);
  if (leadId) {
    await recordAudit({
      entityType: "lead",
      entityId: leadId,
      action: "lead_task_created",
      actor: currentUser,
      summary: `Criou tarefa: ${validated.title}`,
      changes: { taskId: id, dueAt: validated.dueAt },
    }, client);
    await refreshLeadNextContactFromTasks(leadId, client);
  }
  return getTaskById(id, client);
}

async function syncLeadNextContactTask(lead, actor, client = pool) {
  const leadId = String(lead?.id || "").trim();
  if (!leadId) return;
  const sourceKey = `lead-next-contact:${leadId}`;
  const dueAt = String(lead.nextContactAt || "").trim();
  const isClosed = lead.isLost || lead.status === "Perdido" || lead.status === "Fechado" || Boolean(lead.deletedAt);
  const existing = await statementFirstRow("SELECT * FROM tasks WHERE source_key = ? LIMIT 1", [sourceKey], client);

  if (!dueAt || isClosed) {
    if (existing) {
      await execute(
        "UPDATE tasks SET status = 'canceled', source_key = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
        [nowIso(), existing.id],
        client,
      );
    }
    await refreshLeadNextContactFromTasks(leadId, client);
    return;
  }

  const responsibleUserId = String(lead.responsibleUserId || actor?.id || "").trim();
  const responsibleName = String(lead.responsible || actor?.name || actor?.email || "").trim();
  const title = `Follow-up com ${lead.name || lead.company || lead.phone || "lead"}`.slice(0, 180);
  if (existing) {
    await execute(
      `UPDATE tasks
       SET title = ?, responsible_user_id = ?, responsible_name = ?, due_at = ?, status = 'pending',
           completed_at = '', completed_by = '', result = '', updated_at = ?
       WHERE id = ?`,
      [title, responsibleUserId, responsibleName, dueAt, nowIso(), existing.id],
      client,
    );
    await refreshLeadNextContactFromTasks(leadId, client);
    return;
  }

  const at = nowIso();
  await execute(
    `INSERT INTO tasks (
      id, type, title, description, responsible_user_id, responsible_name,
      created_by, created_by_name, lead_id, due_at, priority, status,
      source, source_key, created_at, updated_at
    ) VALUES (?, 'follow_up', ?, 'Sincronizada com o campo próximo contato do lead.', ?, ?, ?, ?, ?, ?, 'normal', 'pending', 'lead_next_contact', ?, ?, ?)`,
    [randomUUID(), title, responsibleUserId, responsibleName, actor?.id || "", actor?.name || actor?.email || "Sistema", leadId, dueAt, sourceKey, at, at],
    client,
  );
  await refreshLeadNextContactFromTasks(leadId, client);
}

async function listTasksForUser(currentUser, requestUrl, client = pool) {
  const bucket = String(requestUrl.searchParams.get("bucket") || "today");
  const limit = parseBoundedInteger(requestUrl.searchParams.get("limit"), 50, 1, 200);
  const accessSql = buildTaskAccessSql(currentUser, "t");
  const useDateColumns = dateColumnRuntime.isReady();
  const bucketWhere = getTaskBucketWhere(bucket, "t", { useDateColumns });
  const taskDueOrder = sqlDateColumn("t", "due_at", "due_at_dt", useDateColumns);
  const taskCreatedOrder = sqlDateColumn("t", "created_at", "created_at_dt", useDateColumns);
  const leadId = String(requestUrl.searchParams.get("leadId") || "").trim();
  const where = [accessSql.clause, bucketWhere];
  const params = [...accessSql.params];
  if (leadId) {
    await assertLeadAccess(currentUser, leadId, { includeDeleted: true }, client);
    where.push("t.lead_id = ?");
    params.push(leadId);
  }
  const rows = await queryRows(
    `SELECT t.*, l.name AS lead_name, l.company AS lead_company, l.phone AS lead_phone
     FROM tasks t
     LEFT JOIN leads l ON l.id = t.lead_id
     WHERE ${where.join(" AND ")}
     ORDER BY CASE t.status WHEN 'pending' THEN 1 ELSE 2 END,
              CASE t.priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
              ${taskDueOrder} ASC, ${taskCreatedOrder} ASC
     LIMIT ?`,
    [...params, limit],
    client,
  );
  return rows.map(rowToTask);
}

async function getTodayDashboard(currentUser, client = pool) {
  const accessContext = await getLeadAccessContext(currentUser, client);
  const taskAccess = buildTaskAccessSql(currentUser, "t");
  const useDateColumns = dateColumnRuntime.isReady();
  const temporalSql = buildTodayTemporalSql(useDateColumns);
  const countRow = await statementFirstRow(
    temporalSql.buildTaskCountSql(taskAccess.clause),
    taskAccess.params,
    client,
  );

  const taskLists = {};
  for (const bucket of ["overdue", "today", "upcoming"]) {
    const where = getTaskBucketWhere(bucket, "t", { useDateColumns });
    const rows = await queryRows(
      `SELECT t.*, l.name AS lead_name, l.company AS lead_company, l.phone AS lead_phone
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE ${taskAccess.clause} AND ${where}
       ORDER BY CASE t.priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                ${temporalSql.taskDueColumn} ASC
       LIMIT 12`,
      taskAccess.params,
      client,
    );
    taskLists[bucket] = rows.map(rowToTask);
  }

  const leadAccess = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, "l");
  const operationalRow = await statementFirstRow(
    temporalSql.buildOperationalSql(leadAccess.clause),
    leadAccess.params,
    client,
  );

  const role = normalizeUserRole(currentUser.role);
  const roleMetrics = {
    awaitingFirstContact: Number(operationalRow?.awaiting_first_contact || 0),
    withoutOwner: Number(operationalRow?.without_owner || 0),
    withoutNextStep: Number(operationalRow?.without_next_step || 0),
    stalled: Number(operationalRow?.stalled || 0),
  };

  let teamOverdue = [];
  let systemHealth = null;
  if (role === USER_ROLES.PRE_SALES || role === USER_ROLES.ADMIN) {
    const rows = await queryRows(
      temporalSql.teamOverdueSql,
      [],
      client,
    );
    teamOverdue = rows.map((row) => ({ responsibleName: row.responsible_name, total: Number(row.total || 0) }));
  }

  if (role === USER_ROLES.ADMIN) {
    const [activeUsers, failedIntegrations, latestBackup] = await Promise.all([
      scalar("SELECT COUNT(*) AS total FROM users WHERE is_active = 1", [], client),
      scalar("SELECT COUNT(*) AS total FROM integration_events WHERE status = 'failed'", [], client),
      statementFirstRow("SELECT created_at FROM backups WHERE status = 'verified' AND expired_at = '' ORDER BY created_at DESC LIMIT 1", [], client),
    ]);
    systemHealth = {
      activeUsers: Number(activeUsers || 0),
      failedIntegrations: Number(failedIntegrations || 0),
      latestBackupAt: latestBackup?.created_at || "",
    };
  }

  return {
    role,
    roleLabel: roleLabels[role] || role,
    scope: accessContext.scope,
    generatedAt: nowIso(),
    taskSummary: {
      overdue: Number(countRow?.overdue || 0),
      today: Number(countRow?.today || 0),
      upcoming: Number(countRow?.upcoming || 0),
      meetingsToday: Number(countRow?.meetings_today || 0),
      completedToday: Number(countRow?.completed_today || 0),
    },
    tasks: taskLists,
    roleMetrics,
    teamOverdue,
    systemHealth,
  };
}

async function getRecentAudit(limit = 80) {
  const rows = await queryRows(
    "SELECT id, entity_type, entity_id, action, actor_id, actor_name, summary, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToAudit);
}

const LEAD_EXPORT_HEADERS = [
  "Nome",
  "Email",
  "Telefone",
  "Empresa",
  "Website",
  "Status",
  "Responsavel",
  "Temperatura",
  "Dor",
  "Origem",
  "Proximo contato",
  "Fechamento previsto",
  "Ultimo contato",
  "Contato feito em",
  "Orcamento estimado",
  "Anuncia Google",
  "Anuncia Meta",
  "Nao anuncia",
  "Motivo perda",
  "Observacao comercial",
  "Servicos",
  "Mapa de servicos",
  ...customFieldLabels,
  "Criado em",
  "Atualizado em",
];

function buildLeadExportRow(lead) {
  return [
    lead.name,
    lead.email,
    lead.phone,
    lead.company,
    lead.website,
    lead.status,
    lead.responsible,
    lead.temperature,
    lead.pain,
    lead.source,
    lead.nextContactAt,
    lead.expectedCloseAt,
    lead.lastContactAt,
    lead.contactMadeAt,
    lead.estimatedBudget,
    lead.advertisesOnGoogle ? "Sim" : "Não",
    lead.advertisesOnMeta ? "Sim" : "Não",
    lead.doesNotAdvertise ? "Sim" : "Não",
    lead.lostReason,
    lead.commercialNotes,
    (lead.serviceInterests || []).join(" | "),
    JSON.stringify(lead.serviceStatusMap || {}),
    ...customFieldLabels.map((field) => lead.customFields?.[field] || ""),
    lead.createdAt,
    lead.updatedAt,
  ].map(sanitizeSpreadsheetCell);
}

function todayFileStamp() {
  return new Date().toISOString().slice(0, 10);
}

let activeBackupPromise = null;

async function enforceBackupRetention() {
  const rows = await queryRows(
    `SELECT id, storage_key, status, created_at, retention_expires_at, expired_at
     FROM backups
     WHERE storage_key != '' AND expired_at = ''
     ORDER BY created_at DESC`,
  );
  const expired = selectBackupsForRetention(rows, { retentionCount: backupSettings.retentionCount });
  for (const backup of expired) {
    await removeBackupArtifact({ storageRoot: backupSettings.storageRoot, storageKey: backup.storage_key });
    await execute(
      "UPDATE backups SET status = 'expired', expired_at = ?, error_message = '' WHERE id = ?",
      [nowIso(), backup.id],
    );
  }
  return expired.length;
}

async function createManualBackup(actor) {
  if (activeBackupPromise) {
    const error = new Error("Já existe um backup em execução. Aguarde a conclusão antes de iniciar outro.");
    error.statusCode = 409;
    error.code = "BACKUP_ALREADY_RUNNING";
    throw error;
  }

  activeBackupPromise = (async () => {
    await mkdir(backupSettings.storageRoot, { recursive: true });
    const versionRow = await statementFirstRow("SELECT VERSION() AS version");
    const artifact = await createEncryptedMysqlBackup({
      settings: backupSettings,
      database: mysqlBackupDatabase,
      serverVersion: versionRow?.version || "unknown",
    });

    const verification = await verifyEncryptedMysqlBackup({
      filePath: artifact.filePath,
      encryptionKey: backupSettings.encryptionKey,
    }).catch(async (error) => {
      await removeBackupArtifact({ storageRoot: backupSettings.storageRoot, storageKey: artifact.storageKey }).catch(() => undefined);
      throw error;
    });
    const backupId = randomUUID();
    try {
      await execute(
        `INSERT INTO backups (
          id, file_name, file_path, type, storage_provider, storage_key, status,
          size_bytes, sha256, encryption, compression, format_version, database_name,
          created_by, created_at, verified_at, verification_status,
          retention_expires_at, expired_at, error_message
        ) VALUES (?, ?, '', 'manual', ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, '', '')`,
        [
          backupId,
          artifact.fileName,
          artifact.storageProvider,
          artifact.storageKey,
          artifact.sizeBytes,
          artifact.sha256,
          artifact.encryption,
          artifact.compression,
          artifact.formatVersion,
          artifact.databaseName,
          actor.id,
          artifact.createdAt,
          verification.verifiedAt,
          artifact.retentionExpiresAt,
        ],
      );
    } catch (error) {
      await removeBackupArtifact({ storageRoot: backupSettings.storageRoot, storageKey: artifact.storageKey }).catch(() => undefined);
      throw error;
    }
    await recordAudit({
      entityType: "backup",
      entityId: backupId,
      action: "backup_created_verified",
      actor,
      summary: `Backup MySQL completo, criptografado e verificado: ${artifact.fileName}`,
    }).catch((error) => {
      console.error("Backup criado sem registro de auditoria", { code: error.code, name: error.name });
    });
    await enforceBackupRetention().catch(async (error) => {
      console.error("Falha ao aplicar retenção de backups", { code: error.code, name: error.name });
      await recordAudit({
        entityType: "backup",
        entityId: backupId,
        action: "backup_retention_failed",
        actor,
        summary: "Backup criado, mas a retenção automática falhou e exige verificação operacional.",
      }).catch(() => undefined);
    });
    return statementFirstRow("SELECT * FROM backups WHERE id = ? LIMIT 1", [backupId]);
  })();

  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
}

function rowToBackup(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    type: row.type,
    status: row.status || "legacy_unverified",
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256 || "",
    encryption: row.encryption || "",
    compression: row.compression || "",
    storageProvider: row.storage_provider || "legacy_local",
    createdAt: row.created_at,
    verifiedAt: row.verified_at || "",
    verificationStatus: row.verification_status || "",
    retentionExpiresAt: row.retention_expires_at || "",
    expiredAt: row.expired_at || "",
  };
}

function resolveLegacyBackupFilePath(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  const relative = path.relative(legacyBackupDir, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Caminho de backup legado inválido.");
    error.statusCode = 400;
    throw error;
  }
  return resolvedPath;
}

function resolveBackupRecordPath(backup) {
  if (backup.storage_key) return resolveStoragePath(backupSettings.storageRoot, backup.storage_key);
  return resolveLegacyBackupFilePath(backup.file_path);
}

function backupContentType(backup) {
  return backup.storage_key
    ? "application/vnd.casaads.mysql-backup"
    : "application/json; charset=utf-8";
}

function rowToTeam(row) {
  return {
    id: row.id,
    name: row.name || "",
    managerUserId: row.manager_user_id || "",
    isActive: Boolean(Number(row.is_active)),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

async function validateTeamReference(teamId, client = pool) {
  if (!teamId) return;
  const team = await statementFirstRow("SELECT id FROM teams WHERE id = ? AND is_active = 1 LIMIT 1", [teamId], client);
  if (!team) {
    const error = new Error("Equipe informada não existe ou está inativa.");
    error.statusCode = 400;
    throw error;
  }
}

async function createTeam(payload, actor, client = pool) {
  const name = String(payload.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const managerUserId = String(payload.managerUserId || "").trim();
  if (name.length < 2) {
    const error = new Error("Informe um nome válido para a equipe.");
    error.statusCode = 400;
    throw error;
  }
  const duplicate = await statementFirstRow("SELECT id FROM teams WHERE LOWER(name) = LOWER(?) LIMIT 1", [name], client);
  if (duplicate) {
    const error = new Error("Já existe uma equipe com esse nome.");
    error.statusCode = 409;
    throw error;
  }
  if (managerUserId && !(await getUserById(managerUserId, client))) {
    const error = new Error("Gestor da equipe não encontrado.");
    error.statusCode = 400;
    throw error;
  }
  const id = randomUUID();
  const at = nowIso();
  await execute(
    "INSERT INTO teams (id, name, manager_user_id, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    [id, name, managerUserId, at, at],
    client,
  );
  const row = await statementFirstRow("SELECT * FROM teams WHERE id = ? LIMIT 1", [id], client);
  await recordAudit({ entityType: "team", entityId: id, action: "team_created", actor, summary: `Equipe criada: ${name}`, changes: { name, managerUserId } }, client);
  return rowToTeam(row);
}

async function updateTeam(teamId, payload, actor, client = pool) {
  const existing = await statementFirstRow("SELECT * FROM teams WHERE id = ? LIMIT 1", [teamId], client);
  if (!existing) {
    const error = new Error("Equipe não encontrada.");
    error.statusCode = 404;
    throw error;
  }
  const name = String(payload.name ?? existing.name).replace(/\s+/g, " ").trim().slice(0, 160);
  const managerUserId = String(payload.managerUserId ?? existing.manager_user_id ?? "").trim();
  const isActive = payload.isActive === undefined ? Number(existing.is_active) : payload.isActive ? 1 : 0;
  if (name.length < 2) {
    const error = new Error("Informe um nome válido para a equipe.");
    error.statusCode = 400;
    throw error;
  }
  const duplicate = await statementFirstRow("SELECT id FROM teams WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1", [name, teamId], client);
  if (duplicate) {
    const error = new Error("Já existe outra equipe com esse nome.");
    error.statusCode = 409;
    throw error;
  }
  if (managerUserId && !(await getUserById(managerUserId, client))) {
    const error = new Error("Gestor da equipe não encontrado.");
    error.statusCode = 400;
    throw error;
  }
  const at = nowIso();
  await execute(
    "UPDATE teams SET name = ?, manager_user_id = ?, is_active = ?, updated_at = ? WHERE id = ?",
    [name, managerUserId, isActive, at, teamId],
    client,
  );
  const row = await statementFirstRow("SELECT * FROM teams WHERE id = ? LIMIT 1", [teamId], client);
  await recordAudit({ entityType: "team", entityId: teamId, action: "team_updated", actor, summary: `Equipe atualizada: ${name}`, changes: { name, managerUserId, isActive } }, client);
  return rowToTeam(row);
}

function validateCanonicalRoleInput(role) {
  if (isCanonicalUserRole(role)) return;
  const error = new Error("Papel inválido. Use administrador, pré-venda ou consultor de vendas.");
  error.statusCode = 400;
  throw error;
}

async function updateUser(userId, payload, actor, client = pool) {
  const existing = await statementFirstRow("SELECT * FROM users WHERE id = ? LIMIT 1", [userId], client);
  if (!existing) {
    const error = new Error("Usuário não encontrado.");
    error.statusCode = 404;
    throw error;
  }

  const name = String(payload.name ?? existing.name).trim();
  const email = normalizeEmailKey(payload.email ?? existing.email);
  if (payload.role !== undefined) validateCanonicalRoleInput(payload.role);
  const role = normalizeUserRole(payload.role ?? existing.role);
  const teamId = String(payload.teamId ?? existing.team_id ?? "").trim();
  const leadAccessScope = getFixedLeadAccessScopeForRole(role);
  const isActive = payload.isActive === undefined ? Number(existing.is_active) : payload.isActive ? 1 : 0;
  await validateTeamReference(teamId, client);
  await assertConsultantOperationallyClear(existing, role, Boolean(isActive), client);
  if (payload.password) {
    const passwordErrors = validatePasswordStrength(payload.password);
    if (passwordErrors.length) {
      const error = new Error(passwordErrors.join(" "));
      error.statusCode = 400;
      throw error;
    }
  }
  const passwordHash = payload.password ? hashPassword(payload.password) : existing.password_hash;
  const at = nowIso();

  await execute(
    "UPDATE users SET name = ?, email = ?, role = ?, team_id = ?, lead_access_scope = ?, is_active = ?, password_hash = ?, updated_at = ? WHERE id = ?",
    [name, email, role, teamId, leadAccessScope, isActive, passwordHash, at, userId],
    client,
  );
  const updated = await statementFirstRow("SELECT * FROM users WHERE id = ? LIMIT 1", [userId], client);
  await recordAudit({ entityType: "user", entityId: userId, action: "user_updated", actor, summary: `Usuário atualizado: ${updated.email}`, changes: { name, email, role, teamId, leadAccessScope, isActive } }, client);
  return rowToUser(updated);
}

async function createUser(payload, actor, client = pool) {
  const name = String(payload.name || "").trim();
  const email = normalizeEmailKey(payload.email || "");
  const password = String(payload.password || "");
  validateCanonicalRoleInput(payload.role);
  const role = normalizeUserRole(payload.role);
  const teamId = String(payload.teamId || "").trim();
  const leadAccessScope = getFixedLeadAccessScopeForRole(role);

  if (!name || !email || !password) {
    const error = new Error("Nome, e-mail e senha são obrigatórios para criar usuário.");
    error.statusCode = 400;
    throw error;
  }

  const passwordErrors = validatePasswordStrength(password);
  if (passwordErrors.length) {
    const error = new Error(passwordErrors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  await validateTeamReference(teamId, client);

  if (await getUserByEmail(email, client)) {
    const error = new Error("Já existe um usuário com este e-mail.");
    error.statusCode = 409;
    throw error;
  }

  const id = randomUUID();
  const at = nowIso();
  await execute(
    "INSERT INTO users (id, name, email, role, team_id, lead_access_scope, password_hash, is_active, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, '')",
    [id, name, email, role, teamId, leadAccessScope, hashPassword(password), at, at],
    client,
  );

  const created = await statementFirstRow("SELECT * FROM users WHERE id = ? LIMIT 1", [id], client);
  await recordAudit({ entityType: "user", entityId: id, action: "user_created", actor, summary: `Usuário criado: ${email}`, changes: { name, email, role, teamId, leadAccessScope } }, client);
  return rowToUser(created);
}


function publicJob(jobRow) {
  const job = jobRow?.progressCurrent !== undefined ? jobRow : rowToJob(jobRow);
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    progressMessage: job.progressMessage,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    result: job.result,
    artifact: job.artifactStorageKey ? {
      fileName: job.artifactFileName,
      contentType: job.artifactContentType,
      sizeBytes: job.artifactSizeBytes,
      sha256: job.artifactSha256,
      expiresAt: job.expiresAt,
    } : null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    expiresAt: job.expiresAt,
  };
}

async function getJobRow(jobId) {
  return statementFirstRow("SELECT * FROM async_jobs WHERE id = ? LIMIT 1", [jobId]);
}

function assertJobAccess(jobRow, currentUser) {
  const isOwner = String(jobRow?.created_by || "") === String(currentUser?.id || "");
  if (!isOwner && normalizeUserRole(currentUser?.role) !== USER_ROLES.ADMIN) {
    const error = new Error("Você não tem acesso a este processamento.");
    error.statusCode = 403;
    throw error;
  }
}

async function getActiveJobActor(job) {
  const actor = await getUserById(job.createdBy);
  if (!actor || !actor.isActive) {
    const error = new Error("O usuário que iniciou o processamento não está mais ativo.");
    error.code = "JOB_ACTOR_INACTIVE";
    throw error;
  }
  return actor;
}

async function enqueuePersistentJob(options) {
  const queued = await enqueueJob({
    execute,
    queryRows,
    expiresAt: options.expiresAt || jobRecordExpiryIso(jobArtifactSettings.jobRetentionDays),
    ...options,
  });
  performanceMonitor.runBackground(() => jobWorker?.wake());
  return queued;
}

async function performImportLeadsJob(job) {
  const actor = await getActiveJobActor(job);
  const currentUser = actor;
  requirePermission(currentUser, "import_leads");
  const payload = await readJsonJobPayload({
    storageRoot: jobArtifactSettings.storageRoot,
    storageKey: job.payloadStorageKey,
    maxBytes: MAX_BODY_BYTES * 4,
  });
  const leads = Array.isArray(payload.leads) ? payload.leads : [];
  const checkpoint = job.result?.checkpoint || {};
  const savedReport = job.result?.report || {};
  const checkpointIndex = Math.max(0, Math.min(leads.length, Number(checkpoint.nextIndex || 0)));
  const canResume = checkpointIndex > 0 && checkpointIndex === Number(job.progressCurrent || 0);
  let nextIndex = canResume ? checkpointIndex : 0;
  let report = canResume ? {
    received: leads.length,
    created: Number(savedReport.created || 0),
    merged: Number(savedReport.merged || 0),
    ignoredInsideFile: Number(savedReport.ignoredInsideFile || 0),
  } : { received: leads.length, created: 0, merged: 0, ignoredInsideFile: 0 };
  const accessContext = await getLeadAccessContext(currentUser);
  const unassignedLeads = leads.map((lead) => ({ ...lead, responsible: "", responsibleUserId: "", responsible_user_id: "" }));
  const seenPrimaryKeys = new Set();
  for (let index = 0; index < nextIndex; index += 1) {
    seenPrimaryKeys.add(getImportPrimaryKey(leads[index]));
  }

  await updateJobProgress({
    execute,
    jobId: job.id,
    lockToken: job.lockedBy,
    current: nextIndex,
    total: leads.length,
    message: nextIndex > 0 ? `Retomando importação a partir de ${nextIndex} lead(s)` : "Validando e importando em batches",
  });

  while (nextIndex < leads.length) {
    const batchStart = nextIndex;
    const batchEnd = Math.min(leads.length, batchStart + IMPORT_DB_BATCH_SIZE);
    const sourceBatch = unassignedLeads.slice(batchStart, batchEnd);
    const assignedBatch = sourceBatch.map((lead) => enforceLeadAssignmentForUser(lead, accessContext.user, accessContext.teamMembers));

    const outcome = await withTransaction(async (client, transactionContext) => {
      const batchResult = await persistImportLeadBatch({
        leads: assignedBatch,
        client,
        accessSql: accessContext.accessSql,
        transactionContext,
        seenPrimaryKeys,
        acquireIdentityLock: acquireLeadIdentityMutationLock, queryRows, mergeLeadData, resolveLeadResponsibleLink,
        ensureLeadKanbanAssignment, execute, nowIso, invalidateLeadSummaryCache: () => invalidateLeadSummaryCache(accessContext),
      });

      const newFollowUps = buildNewLeadFollowUpTaskInsert(batchResult.newLeads, currentUser, nowIso());
      if (newFollowUps.sql) await execute(newFollowUps.sql, newFollowUps.params, client);

      // Leads já existentes podem possuir tarefas manuais/legadas. Neles mantemos
      // a reconciliação completa para preservar exatamente as regras atuais.
      for (const savedLead of batchResult.existingLeads) {
        if (savedLead?.nextContactAt) await syncLeadNextContactTask(savedLead, currentUser, client);
        await reconcileLeadTasksForLifecycle(savedLead, currentUser, client);
      }

      const nextReport = {
        received: leads.length,
        created: report.created + batchResult.report.created,
        merged: report.merged + batchResult.report.merged,
        ignoredInsideFile: report.ignoredInsideFile + batchResult.report.ignoredInsideFile,
      };
      const at = nowIso();
      const checkpointResult = await execute(
        `UPDATE async_jobs
         SET progress_current = ?, progress_total = ?, progress_message = ?, result_json = ?, heartbeat_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
        [
          batchEnd,
          leads.length,
          `Importados ${batchEnd} de ${leads.length}`,
          JSON.stringify({ report: nextReport, checkpoint: { nextIndex: batchEnd, batchSize: IMPORT_DB_BATCH_SIZE } }),
          at,
          at,
          job.id,
          job.lockedBy,
        ],
        client,
      );
      if (Number(checkpointResult?.affectedRows || 0) !== 1) {
        const error = new Error("O job perdeu o lock durante o checkpoint da importação.");
        error.code = "JOB_LOCK_LOST";
        throw error;
      }

      return { batchResult, nextReport };
    });

    outcome.batchResult.keysToCommit.forEach((key) => seenPrimaryKeys.add(key));
    report = outcome.nextReport;
    nextIndex = batchEnd;
  }

  await recordAuditOnce({
    id: `import:${job.id}`,
    entityType: "import",
    entityId: job.id,
    action: "leads_imported",
    actor: currentUser,
    summary: `Importou ${report.received} lead(s). Criados: ${report.created}. Mesclados: ${report.merged}. Ignorados: ${report.ignoredInsideFile}.`,
    changes: report,
  });

  await updateJobProgress({
    execute,
    jobId: job.id,
    lockToken: job.lockedBy,
    current: report.received,
    total: report.received,
    message: "Importação concluída",
  });
  return { result: { report }, expiresAt: job.expiresAt };
}

async function createLeadExportPageFetcher(actor) {
  const accessContext = await getLeadAccessContext(actor);
  const scopedAccess = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, "l");
  const total = Number(await scalar(
    `SELECT COUNT(*) AS total FROM leads l WHERE l.deleted_at = '' AND ${scopedAccess.clause}`,
    scopedAccess.params,
  ) || 0);

  return async ({ cursor, limit }) => {
    const cursorClause = cursor
      ? ` AND (
          l.updated_at < ?
          OR (l.updated_at = ? AND l.created_at < ?)
          OR (l.updated_at = ? AND l.created_at = ? AND l.id < ?)
        )`
      : "";
    const cursorParams = cursor
      ? [cursor.updatedAt, cursor.updatedAt, cursor.createdAt, cursor.updatedAt, cursor.createdAt, cursor.id]
      : [];
    const rows = await queryRows(
      `SELECT l.*
       FROM leads l
       WHERE l.deleted_at = '' AND ${scopedAccess.clause}${cursorClause}
       ORDER BY l.updated_at DESC, l.created_at DESC, l.id DESC
       LIMIT ?`,
      [...scopedAccess.params, ...cursorParams, limit],
    );
    const last = rows.at(-1);
    return {
      records: rows,
      total,
      nextCursor: rows.length === limit && last ? {
        updatedAt: last.updated_at || "",
        createdAt: last.created_at || "",
        id: last.id,
      } : null,
    };
  };
}

async function performLeadExportJob(job, format) {
  const actor = await getActiveJobActor(job);
  requirePermission(actor, "export_leads");
  const extension = format === "xlsx" ? "xlsx" : "csv";
  const contentType = format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv; charset=utf-8";
  const storageKey = createJobStorageKey(`leads-export-${format}`, extension);
  const filePath = await prepareJobStoragePath(jobArtifactSettings.storageRoot, storageKey);
  const fileName = `crm-casa-do-ads-leads-${todayFileStamp()}.${extension}`;
  const fetchPage = await createLeadExportPageFetcher(actor);
  const onProgress = ({ current, total, message }) => updateJobProgress({
    execute,
    jobId: job.id,
    lockToken: job.lockedBy,
    current,
    total,
    message,
  });

  try {
    const exportResult = format === "xlsx"
      ? await writeXlsxExport({
          filePath,
          headers: LEAD_EXPORT_HEADERS,
          fetchPage,
          mapRow: (row) => buildLeadExportRow(rowToLead(row)),
          pageSize: Math.min(2000, EXPORT_PAGE_SIZE),
          onProgress,
        })
      : await writeCsvExport({
          filePath,
          headers: LEAD_EXPORT_HEADERS,
          fetchPage,
          mapRow: (row) => buildLeadExportRow(rowToLead(row)),
          pageSize: EXPORT_PAGE_SIZE,
          onProgress,
        });

    const artifact = await describeJobArtifact({
      storageRoot: jobArtifactSettings.storageRoot,
      storageKey,
      fileName,
      contentType,
    });
    await recordAudit({
      entityType: "export",
      entityId: job.id,
      action: `export_${format}`,
      actor,
      summary: `Exportou ${exportResult.total} lead(s) em ${format.toUpperCase()} por job assíncrono.`,
    });
    return {
      result: { format, total: exportResult.total },
      artifact,
      expiresAt: jobArtifactExpiryIso(jobArtifactSettings.artifactTtlHours),
    };
  } catch (error) {
    await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey }).catch(() => undefined);
    throw error;
  }
}

async function performBackupJob(job) {
  const actor = await getActiveJobActor(job);
  requirePermission(actor, "backup_database");
  await updateJobProgress({ execute, jobId: job.id, lockToken: job.lockedBy, current: 0, total: 1, message: "Gerando dump MySQL criptografado" });
  const backup = await createManualBackup(actor);
  await updateJobProgress({ execute, jobId: job.id, lockToken: job.lockedBy, current: 1, total: 1, message: "Backup verificado" });
  return { result: { backup: rowToBackup(backup) }, expiresAt: job.expiresAt };
}

async function performSearchIndexRebuildJob(job) {
  let processed = 0;
  while (!isShuttingDown) {
    const rows = await queryRows(
      `SELECT ${LEAD_SEARCH_INDEX_SELECT} FROM leads WHERE search_text IS NULL OR search_text = '' ORDER BY id ASC LIMIT ?`,
      [SEARCH_INDEX_REBUILD_BATCH_SIZE],
    );
    if (!rows.length) break;

    await withTransaction(async (client) => {
      const batch = buildLeadSearchIndexBatchUpdate(rows, { onlyMissing: true });
      if (batch.sql) await execute(batch.sql, batch.params, client);
    });
    processed += rows.length;
    await updateJobProgress({
      execute,
      jobId: job.id,
      lockToken: job.lockedBy,
      current: processed,
      total: 0,
      message: `${processed.toLocaleString("pt-BR")} leads indexados`,
    });
  }

  if (isShuttingDown) {
    const error = new Error("Reconstrução pausada para encerramento gracioso.");
    error.code = "JOB_SHUTDOWN_INTERRUPTED";
    throw error;
  }
  return { result: { processed }, expiresAt: job.expiresAt };
}

async function cleanupExpiredJobArtifacts() {
  const expiredRows = await listExpiredJobs({ queryRows, limit: 200 });
  let removed = 0;
  for (const row of expiredRows) {
    const job = rowToJob(row);
    await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey: job.artifactStorageKey }).catch(() => undefined);
    await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey: job.payloadStorageKey }).catch(() => undefined);
    await deleteExpiredJob({ execute, jobId: job.id });
    removed += 1;
  }
  return removed;
}

async function startPersistentJobWorker() {
  const staleBefore = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();
  await recoverStaleJobs({ execute, staleBefore });
  const handlers = {
    [JOB_TYPES.BACKUP]: performBackupJob,
    [JOB_TYPES.IMPORT_LEADS]: performImportLeadsJob,
    [JOB_TYPES.EXPORT_LEADS_CSV]: (job) => performLeadExportJob(job, "csv"),
    [JOB_TYPES.EXPORT_LEADS_XLSX]: (job) => performLeadExportJob(job, "xlsx"),
    [JOB_TYPES.REBUILD_SEARCH_INDEX]: performSearchIndexRebuildJob,
  };

  jobWorker = createJobWorker({
    handlers,
    concurrency: JOB_WORKER_CONCURRENCY,
    pollIntervalMs: JOB_POLL_INTERVAL_MS,
    heartbeatIntervalMs: JOB_HEARTBEAT_INTERVAL_MS,
    claim: (workerId) => claimNextJob({
      execute,
      queryRows,
      workerId,
      allowedTypes: Object.values(JOB_TYPES),
    }),
    heartbeat: (job) => heartbeatJob({ execute, jobId: job.id, lockToken: job.lockedBy }),
    complete: async (job, outcome) => {
      await completeJob({
        execute,
        jobId: job.id,
        lockToken: job.lockedBy,
        result: outcome.result || {},
        artifact: outcome.artifact || {},
        expiresAt: outcome.expiresAt || job.expiresAt,
      });
      await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey: job.payloadStorageKey }).catch(() => undefined);
    },
    fail: async (job, error, retryOptions) => {
      const decision = await failJob({ execute, job, error, ...retryOptions });
      if (!decision.canRetry) {
        await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey: job.payloadStorageKey }).catch(() => undefined);
      }
    },
    shouldRetry: (error) => isRetryableMysqlConnectionError(error)
      || isRetryableMysqlTransactionError(error)
      || error?.code === "JOB_SHUTDOWN_INTERRUPTED"
      || error?.code === "LEAD_IDENTITY_LOCK_TIMEOUT",
    onError: (error) => {
      if (isExpectedShutdownError(error) || isShuttingDown) return;
      console.error("Falha operacional no worker de jobs", {
        code: error?.code || "JOB_WORKER_ERROR",
        name: error?.name || "Error",
      });
    },
    unrefTimers: PROCESS_ROLE !== PROCESS_ROLES.WORKER,
  });
  jobWorker.start();
}

async function enqueueSearchIndexRebuild() {
  if (!SEARCH_INDEX_REBUILD_ON_START) return null;
  const queued = await enqueuePersistentJob({
    type: JOB_TYPES.REBUILD_SEARCH_INDEX,
    payload: { reason: "startup" },
    actor: { id: "system", name: "Sistema" },
    dedupeKey: "search-index-rebuild",
    maxAttempts: 5,
  });
  return queued.job;
}


async function buildReadinessReport() {
  const startedAt = Date.now();
  if (isShuttingDown) {
    return { ok: false, reason: "shutting_down", database: false, worker: false, latencyMs: 0 };
  }
  if (!databaseReady || !pool) {
    return { ok: false, reason: "database_initializing", database: false, worker: Boolean(jobWorker?.isRunning), latencyMs: 0 };
  }

  let database = false;
  try {
    await Promise.race([
      pool.query("SELECT 1 AS ready"),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Health check MySQL excedeu o tempo limite."), { code: "HEALTH_TIMEOUT" })), 2000)),
    ]);
    database = true;
  } catch {
    database = false;
  }
  const roleReadiness = buildRoleReadiness({ database, localWorkerRunning: jobWorker?.isRunning, capabilities: PROCESS_CAPABILITIES });
  return { ...roleReadiness, database, processRole: PROCESS_ROLE, activeJobs: Number(jobWorker?.activeCount || 0), latencyMs: Date.now() - startedAt };
}

function buildLivenessReport() {
  return {
    ok: true,
    status: isShuttingDown ? "shutting_down" : "alive",
    version: APP_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    processRole: PROCESS_ROLE,
    activeRequests: activeRequestCount,
  };
}


async function handleApi(request, response, requestUrl) {
  const pathname = requestUrl.pathname;
  const method = request.method || "GET";

  applyCorsHeaders(request, response);

  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (pathname === "/api/health" && method === "GET") {
    const readiness = await buildReadinessReport();
    sendJson(response, readiness.ok ? 200 : 503, {
      ...readiness,
      storage: "mysql",
      version: APP_VERSION,
      authRequired: true,
    });
    return;
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    if (SESSION_COOKIE_SECURE && getRequestProtocol(request) !== "https") {
      const error = new Error("O login seguro exige HTTPS. Verifique TLS e a configuração do proxy reverso.");
      error.statusCode = 503;
      error.code = "HTTPS_REQUIRED";
      throw error;
    }
    const body = await readRequestBody(request);
    const email = normalizeEmailKey(body.email);
    const password = String(body.password || "");
    await assertLoginRateLimit(request, email);
    const userRow = await getUserByEmail(email);

    if (!userRow || !Number(userRow.is_active) || !verifyPassword(password, userRow.password_hash)) {
      const error = new Error("E-mail ou senha inválidos.");
      error.statusCode = 401;
      throw error;
    }

    const session = await withTransaction(async (client) => {
      const createdSession = await createSession(userRow.id, client);
      const at = nowIso();
      await execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", [at, at, userRow.id], client);
      await recordAudit({ entityType: "user", entityId: userRow.id, action: "login", actor: rowToUser(userRow), summary: `Login realizado: ${userRow.email}` }, client);
      return createdSession;
    });

    setSessionCookie(response, session.sessionToken);
    sendJson(response, 200, { csrfToken: session.csrfToken, expiresAt: session.expiresAt, user: rowToUser(userRow) });
    return;
  }

  if (pathname === "/api/integrations/zape/catalog" && method === "GET") {
    await assertZapeIntegrationAccess(request);
    sendJson(response, 200, await getZapeIntegrationCatalog());
    return;
  }

  if (pathname === "/api/integrations/zape/leads" && method === "POST") {
    await assertZapeIntegrationAccess(request);
    const body = await readRequestBody(request, INTEGRATION_MAX_BODY_BYTES);
    const result = await withTransaction((client, transactionContext) => processZapeLeadIntegration(body, client, transactionContext));
    sendJson(response, result.idempotentReplay ? 200 : result.action === "created" ? 201 : 200, result);
    return;
  }

  const authContext = await authenticateRequest(request);
  if (!authContext) {
    clearSessionCookie(response);
    sendJson(response, 401, { ok: false, message: "Sessão expirada ou não autenticada. Faça login novamente." });
    return;
  }
  const currentUser = authContext.user;

  if (pathname === "/api/auth/me" && method === "GET") {
    sendJson(response, 200, { user: currentUser, csrfToken: deriveCsrfToken(authContext.sessionToken) });
    return;
  }

  assertCsrfToken({
    method,
    providedToken: request.headers["x-csrf-token"],
    expectedHash: authContext.csrfTokenHash,
  });

  const jobDownloadMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/download$/);
  if (jobDownloadMatch && method === "GET") {
    const jobId = decodeURIComponent(jobDownloadMatch[1]);
    const jobRow = await getJobRow(jobId);
    if (!jobRow) {
      const error = new Error("Processamento não encontrado.");
      error.statusCode = 404;
      throw error;
    }
    assertJobAccess(jobRow, currentUser);
    const job = rowToJob(jobRow);
    if (job.status !== "completed" || !job.artifactStorageKey) {
      const error = new Error(job.status === "failed" ? job.errorMessage || "O processamento falhou." : "O arquivo ainda não está disponível.");
      error.statusCode = job.status === "failed" ? 422 : 409;
      throw error;
    }
    if (job.expiresAt && Date.parse(job.expiresAt) <= Date.now()) {
      const error = new Error("O arquivo expirou e foi removido por segurança.");
      error.statusCode = 410;
      throw error;
    }
    const filePath = resolveJobStoragePath(jobArtifactSettings.storageRoot, job.artifactStorageKey);
    if (!existsSync(filePath)) {
      const error = new Error("O arquivo do processamento não está mais disponível.");
      error.statusCode = 410;
      throw error;
    }
    await sendFileDownload(response, filePath, job.artifactFileName, job.artifactContentType || "application/octet-stream");
    return;
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && method === "GET") {
    const jobId = decodeURIComponent(jobMatch[1]);
    const jobRow = await getJobRow(jobId);
    if (!jobRow) {
      const error = new Error("Processamento não encontrado.");
      error.statusCode = 404;
      throw error;
    }
    assertJobAccess(jobRow, currentUser);
    sendJson(response, 200, publicJob(jobRow));
    return;
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    await withTransaction(async (client) => {
      await execute("DELETE FROM sessions WHERE token = ? AND token_format = 'sha256'", [authContext.sessionTokenHash], client);
      await recordAudit({ entityType: "user", entityId: currentUser.id, action: "logout", actor: currentUser, summary: `Logout realizado: ${currentUser.email}` }, client);
    });
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/today" && method === "GET") {
    requirePermission(currentUser, "read_tasks");
    sendJson(response, 200, await getTodayDashboard(currentUser));
    return;
  }

  if (pathname === "/api/tasks" && method === "GET") {
    requirePermission(currentUser, "read_tasks");
    sendJson(response, 200, await listTasksForUser(currentUser, requestUrl));
    return;
  }

  if (pathname === "/api/tasks" && method === "POST") {
    requireAnyPermission(currentUser, ["manage_all_tasks", "manage_own_tasks"]);
    const body = await readRequestBody(request);
    const task = await withTransaction((client) => createTaskRecord(body, currentUser, client));
    sendJson(response, 201, task);
    return;
  }

  const taskCompleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (taskCompleteMatch && method === "POST") {
    requireAnyPermission(currentUser, ["manage_all_tasks", "manage_own_tasks"]);
    const taskId = decodeURIComponent(taskCompleteMatch[1]);
    const body = await readRequestBody(request);
    const resultText = String(body.result || "").trim().slice(0, 5000);

    const result = await withTransaction(async (client) => {
      await assertTaskAccess(currentUser, taskId, client);
      const task = await getTaskById(taskId, client);
      if (!task || task.status !== "pending") {
        const error = new Error("A tarefa já foi concluída ou cancelada.");
        error.statusCode = 400;
        throw error;
      }

      const completedAt = nowIso();
      await execute(
        "UPDATE tasks SET status = 'completed', result = ?, completed_at = ?, completed_by = ?, source_key = NULL, updated_at = ? WHERE id = ?",
        [resultText, completedAt, currentUser.id, completedAt, taskId],
        client,
      );

      let nextTask = null;
      if (body.nextTask && typeof body.nextTask === "object") {
        nextTask = await createTaskRecord({
          ...body.nextTask,
          leadId: body.nextTask.leadId || task.leadId,
          responsibleUserId: body.nextTask.responsibleUserId || task.responsibleUserId,
        }, currentUser, client, {
          source: "follow_up_chain",
          sourceKey: task.leadId ? `lead-next-contact:${task.leadId}` : null,
        });
        await execute("UPDATE tasks SET next_task_id = ?, updated_at = ? WHERE id = ?", [nextTask.id, nowIso(), taskId], client);
      }

      if (task.leadId) {
        await assertLeadAccess(currentUser, task.leadId, { forUpdate: true }, client);
        await execute(
          `UPDATE leads
           SET last_contact_at = ?,
               contact_made_at = CASE WHEN TRIM(COALESCE(contact_made_at, '')) = '' THEN ? ELSE contact_made_at END,
               updated_at = ?
           WHERE id = ?`,
          [completedAt.slice(0, 10), completedAt.slice(0, 10), completedAt, task.leadId],
          client,
        );
        await refreshLeadNextContactFromTasks(task.leadId, client);
        await recordAudit({
          entityType: "lead",
          entityId: task.leadId,
          action: "lead_task_completed",
          actor: currentUser,
          summary: `Concluiu tarefa: ${task.title}`,
          changes: { taskId, result: resultText, nextTaskId: nextTask?.id || "" },
        }, client);
      }

      await recordAudit({
        entityType: "task",
        entityId: taskId,
        action: "task_completed",
        actor: currentUser,
        summary: `Concluiu tarefa: ${task.title}`,
        changes: { result: resultText, nextTaskId: nextTask?.id || "" },
      }, client);
      return { task: await getTaskById(taskId, client), nextTask };
    });
    invalidateLeadSummaryCache(currentUser);
    sendJson(response, 200, result);
    return;
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === "PUT") {
    requireAnyPermission(currentUser, ["manage_all_tasks", "manage_own_tasks"]);
    const taskId = decodeURIComponent(taskMatch[1]);
    const body = await readRequestBody(request);
    const task = await withTransaction(async (client) => {
      await assertTaskAccess(currentUser, taskId, client);
      const before = await getTaskById(taskId, client);
      if (!before || before.status !== "pending") {
        const error = new Error("Somente tarefas pendentes podem ser editadas.");
        error.statusCode = 400;
        throw error;
      }
      const validated = assertTaskPayload({ ...before, ...body });
      const responsible = await resolveTaskResponsible(currentUser, body.responsibleUserId || before.responsibleUserId, null, client);
      await execute(
        `UPDATE tasks SET type = ?, title = ?, description = ?, responsible_user_id = ?, responsible_name = ?,
         due_at = ?, priority = ?, recurrence = ?, updated_at = ? WHERE id = ?`,
        [validated.type, validated.title, validated.description, responsible.id, responsible.name || responsible.email, validated.dueAt, validated.priority, String(body.recurrence ?? before.recurrence).slice(0, 80), nowIso(), taskId],
        client,
      );
      if (before.leadId && before.source.includes("lead")) {
        await refreshLeadNextContactFromTasks(before.leadId, client);
      } else if (before.leadId) {
        await refreshLeadNextContactFromTasks(before.leadId, client);
      }
      await recordAudit({ entityType: "task", entityId: taskId, action: "task_updated", actor: currentUser, summary: `Atualizou tarefa: ${validated.title}`, changes: body }, client);
      return getTaskById(taskId, client);
    });
    sendJson(response, 200, task);
    return;
  }

  if (taskMatch && method === "DELETE") {
    requireAnyPermission(currentUser, ["manage_all_tasks", "manage_own_tasks"]);
    const taskId = decodeURIComponent(taskMatch[1]);
    await withTransaction(async (client) => {
      await assertTaskAccess(currentUser, taskId, client);
      const task = await getTaskById(taskId, client);
      if (!task || task.status !== "pending") {
        const error = new Error("Somente tarefas pendentes podem ser canceladas.");
        error.statusCode = 400;
        throw error;
      }
      await execute("UPDATE tasks SET status = 'canceled', source_key = NULL, updated_at = ? WHERE id = ?", [nowIso(), taskId], client);
      if (task.leadId) await refreshLeadNextContactFromTasks(task.leadId, client);
      await recordAudit({ entityType: "task", entityId: taskId, action: "task_canceled", actor: currentUser, summary: `Cancelou tarefa: ${task.title}` }, client);
    });
    invalidateLeadSummaryCache(currentUser);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/kanban/pipelines" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const accessContext = await getLeadAccessContext(currentUser);
    const key = `kanban-pipelines:${leadDashboardCacheKey(accessContext)}`;
    sendJson(response, 200, await metadataCache.getOrLoad(key, () => getKanbanPipelines(currentUser), { ttlMs: 5000 }));
    return;
  }

  if (pathname === "/api/kanban/board" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    sendJson(response, 200, await getKanbanBoardFromRequest(requestUrl, currentUser));
    return;
  }

  if (pathname === "/api/kanban/leads/search" && method === "GET") {
    requirePermission(currentUser, "assign_leads");
    const pipelineId = String(requestUrl.searchParams.get("pipelineId") || "");
    const search = String(requestUrl.searchParams.get("search") || "").trim();
    const limit = parseBoundedInteger(requestUrl.searchParams.get("limit"), 40, 1, 100);
    const params = [pipelineId];
    const clauses = ["l.deleted_at = ''", "l.pipeline_id != ?"];
    const accessContext = await getLeadAccessContext(currentUser);
    const scopedAccess = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, "l");
    clauses.push(scopedAccess.clause);
    params.push(...scopedAccess.params);

    if (search) {
      const baseWhere = clauses.join(" AND ");
      const searchClause = await resolveLeadSearchClause({
        search,
        baseWhere,
        baseParams: [...params],
        alias: "l",
      });
      if (searchClause?.clause) {
        clauses.push(searchClause.clause);
        params.push(...searchClause.params);
      }
    }

    const rows = await queryRows(
      `SELECT l.id, l.name, l.email, l.phone, l.company,
              l.pipeline_id, l.pipeline_stage_id, l.created_at, l.updated_at,
              p.name AS pipeline_name, s.name AS stage_name
       FROM leads l
       LEFT JOIN kanban_pipelines p ON p.id = l.pipeline_id
       LEFT JOIN kanban_stages s ON s.id = l.pipeline_stage_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY l.updated_at DESC, l.created_at DESC
       LIMIT ?`,
      [...params, limit],
    );
    sendJson(response, 200, rows.map((row) => ({
      ...rowToLead(row),
      pipelineName: row.pipeline_name || "Sem funil",
      stageName: row.stage_name || "Sem etapa",
    })));
    return;
  }

  if (pathname === "/api/kanban/pipelines" && method === "POST") {
    requirePermission(currentUser, "manage_pipelines");
    const body = await readRequestBody(request);
    const name = sanitizeKanbanName(body.name);
    const sourcePipelineId = String(body.sourcePipelineId || "");
    if (name.length < 2) {
      const error = new Error("Informe um nome com pelo menos 2 caracteres para o funil.");
      error.statusCode = 400;
      throw error;
    }

    const pipelineId = await withTransaction(async (client) => {
      await assertUniqueKanbanPipelineName(name, "", client);
      const at = nowIso();
      const maxPosition = Number(await scalar("SELECT COALESCE(MAX(position), 0) AS max_position FROM kanban_pipelines", [], client) || 0);
      const newPipelineId = randomUUID();
      await execute(
        `INSERT INTO kanban_pipelines (id, name, is_default, is_archived, position, created_by, created_at, updated_at)
         VALUES (?, ?, 0, 0, ?, ?, ?, ?)`,
        [newPipelineId, name, maxPosition + 1000, currentUser.id, at, at],
        client,
      );

      let sourceStages = sourcePipelineId ? await getKanbanStages(sourcePipelineId, client) : [];
      if (!sourceStages.length) {
        sourceStages = [
          { name: "Entrada", color: "#2563EB", stage_type: "open", status_key: "", wip_limit: 0 },
          { name: "Em andamento", color: "#F59E0B", stage_type: "open", status_key: "", wip_limit: 0 },
          { name: "Ganho", color: "#16A34A", stage_type: "won", status_key: "Fechado", wip_limit: 0 },
          { name: "Perdido", color: "#DC2626", stage_type: "lost", status_key: "Perdido", wip_limit: 0 },
        ];
      }

      for (let index = 0; index < sourceStages.length; index += 1) {
        const sourceStage = sourceStages[index];
        const sourceStageType = normalizeKanbanStageType(sourceStage.stage_type || sourceStage.stageType);
        const sourceStatusKey = sourceStageType === "open"
          ? normalizeOpenKanbanStatusKey(sourceStage.status_key || sourceStage.statusKey)
          : sourceStageType === "won" ? "Fechado" : "Perdido";
        await execute(
          `INSERT INTO kanban_stages (id, pipeline_id, name, color, position, stage_type, status_key, wip_limit, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            randomUUID(),
            newPipelineId,
            sanitizeKanbanName(sourceStage.name, `Etapa ${index + 1}`),
            sanitizeKanbanColor(sourceStage.color),
            (index + 1) * 1000,
            sourceStageType,
            sourceStatusKey,
            normalizeKanbanWipLimit(sourceStage.wip_limit || sourceStage.wipLimit),
            at,
            at,
          ],
          client,
        );
      }

      await recordAudit({
        entityType: "pipeline",
        entityId: newPipelineId,
        action: "pipeline_created",
        actor: currentUser,
        summary: `Criou o funil: ${name}`,
        changes: { name, sourcePipelineId },
      }, client);
      return newPipelineId;
    });

    const createdPipeline = (await getKanbanPipelines(currentUser)).find((pipeline) => pipeline.id === pipelineId);
    sendJson(response, 201, createdPipeline);
    return;
  }

  const pipelineStagesReorderMatch = pathname.match(/^\/api\/kanban\/pipelines\/([^/]+)\/stages\/reorder$/);
  if (pipelineStagesReorderMatch && method === "PUT") {
    requirePermission(currentUser, "manage_pipelines");
    const pipelineId = decodeURIComponent(pipelineStagesReorderMatch[1]);
    const body = await readRequestBody(request);
    const stageIds = Array.isArray(body.stageIds) ? body.stageIds.map(String) : [];

    await withTransaction(async (client) => {
      const pipeline = await getKanbanPipelineById(pipelineId, client);
      if (!pipeline) {
        const error = new Error("Funil não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const stages = await getKanbanStages(pipelineId, client);
      const activeIds = new Set(stages.map((stage) => stage.id));
      if (stageIds.length !== stages.length || stageIds.some((stageId) => !activeIds.has(stageId))) {
        const error = new Error("A ordem enviada não contém todas as etapas ativas do funil.");
        error.statusCode = 400;
        throw error;
      }
      for (let index = 0; index < stageIds.length; index += 1) {
        await execute("UPDATE kanban_stages SET position = ?, updated_at = ? WHERE id = ? AND pipeline_id = ?", [(index + 1) * 1000, nowIso(), stageIds[index], pipelineId], client);
      }
      await recordAudit({ entityType: "pipeline", entityId: pipelineId, action: "pipeline_stages_reordered", actor: currentUser, summary: "Reordenou as etapas do funil", changes: { stageIds } }, client);
    });

    invalidateKanbanMetadataCache();
    sendJson(response, 200, { ok: true });
    return;
  }

  const pipelineStagesMatch = pathname.match(/^\/api\/kanban\/pipelines\/([^/]+)\/stages$/);
  if (pipelineStagesMatch && method === "POST") {
    requirePermission(currentUser, "manage_pipelines");
    const pipelineId = decodeURIComponent(pipelineStagesMatch[1]);
    const body = await readRequestBody(request);
    const name = sanitizeKanbanName(body.name);
    if (name.length < 2) {
      const error = new Error("Informe um nome válido para a etapa.");
      error.statusCode = 400;
      throw error;
    }

    const stageId = await withTransaction(async (client) => {
      const pipeline = await getKanbanPipelineById(pipelineId, client);
      if (!pipeline) {
        const error = new Error("Funil não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const at = nowIso();
      const maxPosition = Number(await scalar("SELECT COALESCE(MAX(position), 0) AS max_position FROM kanban_stages WHERE pipeline_id = ? AND is_archived = 0", [pipelineId], client) || 0);
      const stageType = normalizeKanbanStageType(body.stageType);
      const statusKey = stageType === "won" ? "Fechado" : stageType === "lost" ? "Perdido" : normalizeOpenKanbanStatusKey(body.statusKey);
      await assertUniqueKanbanStageName(pipelineId, name, "", client);
      await assertUniqueKanbanStageStatus(pipelineId, statusKey, "", client);
      const newStageId = randomUUID();
      await execute(
        `INSERT INTO kanban_stages (id, pipeline_id, name, color, position, stage_type, status_key, wip_limit, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [newStageId, pipelineId, name, sanitizeKanbanColor(body.color), maxPosition + 1000, stageType, statusKey, normalizeKanbanWipLimit(body.wipLimit), at, at],
        client,
      );
      await recordAudit({ entityType: "pipeline_stage", entityId: newStageId, action: "pipeline_stage_created", actor: currentUser, summary: `Criou a etapa: ${name}`, changes: { pipelineId, name, stageType } }, client);
      return newStageId;
    });

    invalidateKanbanMetadataCache();
    const stage = await getKanbanStageById(stageId);
    sendJson(response, 201, rowToKanbanStage(stage, 0));
    return;
  }

  const pipelineMatch = pathname.match(/^\/api\/kanban\/pipelines\/([^/]+)$/);
  if (pipelineMatch && method === "PUT") {
    requirePermission(currentUser, "manage_pipelines");
    const pipelineId = decodeURIComponent(pipelineMatch[1]);
    const body = await readRequestBody(request);

    await withTransaction(async (client) => {
      const pipeline = await getKanbanPipelineById(pipelineId, client);
      if (!pipeline) {
        const error = new Error("Funil não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const updates = [];
      const params = [];
      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        const name = sanitizeKanbanName(body.name);
        if (name.length < 2) {
          const error = new Error("Informe um nome válido para o funil.");
          error.statusCode = 400;
          throw error;
        }
        await assertUniqueKanbanPipelineName(name, pipelineId, client);
        updates.push("name = ?");
        params.push(name);
      }
      if (body.isDefault === true) {
        await execute("UPDATE kanban_pipelines SET is_default = 0 WHERE is_archived = 0", [], client);
        updates.push("is_default = 1");
      }
      updates.push("updated_at = ?");
      params.push(nowIso(), pipelineId);
      await execute(`UPDATE kanban_pipelines SET ${updates.join(", ")} WHERE id = ?`, params, client);
      await recordAudit({ entityType: "pipeline", entityId: pipelineId, action: "pipeline_updated", actor: currentUser, summary: "Atualizou o funil", changes: body }, client);
    });
    invalidateKanbanMetadataCache();
    const updatedPipeline = (await getKanbanPipelines(currentUser)).find((pipeline) => pipeline.id === pipelineId);
    sendJson(response, 200, updatedPipeline);
    return;
  }

  if (pipelineMatch && method === "DELETE") {
    requirePermission(currentUser, "manage_pipelines");
    const pipelineId = decodeURIComponent(pipelineMatch[1]);

    await withTransaction(async (client) => {
      const pipeline = await getKanbanPipelineById(pipelineId, client);
      if (!pipeline) {
        const error = new Error("Funil não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      if (Number(pipeline.is_default)) {
        const error = new Error("Defina outro funil como padrão antes de arquivar este.");
        error.statusCode = 400;
        throw error;
      }
      const defaultPipeline = await statementFirstRow("SELECT * FROM kanban_pipelines WHERE is_default = 1 AND is_archived = 0 LIMIT 1", [], client);
      const targetStages = defaultPipeline ? await getKanbanStages(defaultPipeline.id, client) : [];
      const fallbackStage = targetStages.find((stage) => stage.stage_type === "open") || targetStages[0];
      if (!defaultPipeline || !fallbackStage) {
        const error = new Error("O funil padrão precisa ter ao menos uma etapa ativa.");
        error.statusCode = 400;
        throw error;
      }
      const at = nowIso();
      for (const targetStage of targetStages.filter((stage) => stage.status_key)) {
        await execute(
          `UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, pipeline_entered_at = ?, updated_at = ?
           WHERE deleted_at = '' AND pipeline_id = ? AND status = ?`,
          [defaultPipeline.id, targetStage.id, at, at, pipelineId, targetStage.status_key],
          client,
        );
      }
      await execute(
        `UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, pipeline_entered_at = ?, updated_at = ?
         WHERE deleted_at = '' AND pipeline_id = ?`,
        [defaultPipeline.id, fallbackStage.id, at, at, pipelineId],
        client,
      );
      await execute("UPDATE kanban_stages SET is_archived = 1, updated_at = ? WHERE pipeline_id = ?", [at, pipelineId], client);
      await execute("UPDATE kanban_pipelines SET is_archived = 1, updated_at = ? WHERE id = ?", [at, pipelineId], client);
      await recordAudit({ entityType: "pipeline", entityId: pipelineId, action: "pipeline_archived", actor: currentUser, summary: `Arquivou o funil: ${pipeline.name}` }, client);
    });

    invalidateKanbanMetadataCache();
    invalidateLeadSummaryCache(currentUser);
    sendJson(response, 200, { ok: true });
    return;
  }

  const stageCardsMatch = pathname.match(/^\/api\/kanban\/stages\/([^/]+)\/cards$/);
  if (stageCardsMatch && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const stageId = decodeURIComponent(stageCardsMatch[1]);
    sendJson(response, 200, await getKanbanStageCardsFromRequest(stageId, requestUrl, currentUser));
    return;
  }

  const stageMatch = pathname.match(/^\/api\/kanban\/stages\/([^/]+)$/);
  if (stageMatch && method === "PUT") {
    requirePermission(currentUser, "manage_pipelines");
    const stageId = decodeURIComponent(stageMatch[1]);
    const body = await readRequestBody(request);

    const updatedStageId = await withTransaction(async (client) => {
      const stage = await getKanbanStageById(stageId, client);
      if (!stage) {
        const error = new Error("Etapa não encontrada.");
        error.statusCode = 404;
        throw error;
      }
      const name = Object.prototype.hasOwnProperty.call(body, "name") ? sanitizeKanbanName(body.name) : stage.name;
      if (name.length < 2) {
        const error = new Error("Informe um nome válido para a etapa.");
        error.statusCode = 400;
        throw error;
      }
      const stageType = Object.prototype.hasOwnProperty.call(body, "stageType") ? normalizeKanbanStageType(body.stageType) : normalizeKanbanStageType(stage.stage_type);
      const requestedStatusKey = Object.prototype.hasOwnProperty.call(body, "statusKey") ? normalizeOpenKanbanStatusKey(body.statusKey) : normalizeOpenKanbanStatusKey(stage.status_key);
      const statusKey = stageType === "won" ? "Fechado" : stageType === "lost" ? "Perdido" : requestedStatusKey;
      const color = Object.prototype.hasOwnProperty.call(body, "color") ? sanitizeKanbanColor(body.color) : stage.color;
      const wipLimit = Object.prototype.hasOwnProperty.call(body, "wipLimit") ? normalizeKanbanWipLimit(body.wipLimit) : normalizeKanbanWipLimit(stage.wip_limit);
      await assertUniqueKanbanStageName(stage.pipeline_id, name, stageId, client);
      await assertUniqueKanbanStageStatus(stage.pipeline_id, statusKey, stageId, client);
      const previousStageType = normalizeKanbanStageType(stage.stage_type);
      const at = nowIso();
      await execute(
        "UPDATE kanban_stages SET name = ?, color = ?, stage_type = ?, status_key = ?, wip_limit = ?, updated_at = ? WHERE id = ?",
        [name, color, stageType, statusKey, wipLimit, at, stageId],
        client,
      );
      if (stageType !== "open" || statusKey) {
        const statusUpdate = getStageStatusUpdate({ stage_type: stageType, status_key: statusKey });
        await execute(
          "UPDATE leads SET status = ?, is_lost = ?, updated_at = ? WHERE deleted_at = '' AND pipeline_stage_id = ?",
          [statusUpdate.status, statusUpdate.isLost, at, stageId],
          client,
        );
        if (statusUpdate.isLost || statusUpdate.status === "Fechado" || statusUpdate.status === "Perdido") {
          await cancelPendingTasksForClosedLeadsInStage(stageId, `Tarefa cancelada porque a etapa ${name} encerra o lead.`, currentUser, client);
        }
      } else if (previousStageType !== "open") {
        await execute(
          "UPDATE leads SET status = 'Novo lead', is_lost = 0, updated_at = ? WHERE deleted_at = '' AND pipeline_stage_id = ?",
          [at, stageId],
          client,
        );
      }
      await recordAudit({ entityType: "pipeline_stage", entityId: stageId, action: "pipeline_stage_updated", actor: currentUser, summary: `Atualizou a etapa: ${name}`, changes: body }, client);
      return stageId;
    });

    invalidateKanbanMetadataCache();
    invalidateLeadSummaryCache(currentUser);
    const updatedStage = await getKanbanStageById(updatedStageId);
    const count = Number(await scalar("SELECT COUNT(*) AS total FROM leads WHERE deleted_at = '' AND pipeline_stage_id = ?", [updatedStageId]) || 0);
    sendJson(response, 200, rowToKanbanStage(updatedStage, count));
    return;
  }

  if (stageMatch && method === "DELETE") {
    requirePermission(currentUser, "manage_pipelines");
    const stageId = decodeURIComponent(stageMatch[1]);
    const body = await readRequestBody(request);
    const targetStageId = String(body.targetStageId || "");

    await withTransaction(async (client) => {
      const stage = await getKanbanStageById(stageId, client);
      if (!stage) {
        const error = new Error("Etapa não encontrada.");
        error.statusCode = 404;
        throw error;
      }
      const stages = await getKanbanStages(stage.pipeline_id, client);
      if (stages.length <= 1) {
        const error = new Error("O funil precisa manter ao menos uma etapa ativa.");
        error.statusCode = 400;
        throw error;
      }
      const cardCount = Number(await scalar("SELECT COUNT(*) AS total FROM leads WHERE deleted_at = '' AND pipeline_stage_id = ?", [stageId], client) || 0);
      let targetStage = null;
      if (cardCount > 0) {
        targetStage = targetStageId ? await getKanbanStageById(targetStageId, client) : null;
        if (!targetStage || targetStage.pipeline_id !== stage.pipeline_id || targetStage.id === stageId) {
          const error = new Error("Escolha outra etapa do mesmo funil para receber os cards antes de remover esta etapa.");
          error.statusCode = 400;
          throw error;
        }
        const at = nowIso();
        const maxPosition = Number(await scalar("SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ?", [targetStage.id], client) || 0);
        if (targetStage.stage_type === "open" && !targetStage.status_key) {
          await execute(
            `UPDATE leads SET pipeline_stage_id = ?, kanban_position = ? + MOD(CRC32(id), 1000000) / 1000,
             pipeline_entered_at = ?, status = CASE WHEN status IN ('Fechado', 'Perdido') THEN 'Novo lead' ELSE status END,
             is_lost = 0, updated_at = ?
             WHERE deleted_at = '' AND pipeline_stage_id = ?`,
            [targetStage.id, maxPosition + 1000, at, at, stageId],
            client,
          );
        } else {
          const statusUpdate = getStageStatusUpdate(targetStage);
          await execute(
            `UPDATE leads SET pipeline_stage_id = ?, kanban_position = ? + MOD(CRC32(id), 1000000) / 1000,
             pipeline_entered_at = ?, status = ?, is_lost = ?, updated_at = ?
             WHERE deleted_at = '' AND pipeline_stage_id = ?`,
            [targetStage.id, maxPosition + 1000, at, statusUpdate.status, statusUpdate.isLost, at, stageId],
            client,
          );
        }
        const targetStatus = getStageStatusUpdate(targetStage);
        if (targetStatus.isLost || targetStatus.status === "Fechado" || targetStatus.status === "Perdido") {
          await cancelPendingTasksForClosedLeadsInStage(targetStage.id, `Tarefa cancelada porque os leads foram movidos para ${targetStage.name}.`, currentUser, client);
        }
      }
      await execute("UPDATE kanban_stages SET is_archived = 1, updated_at = ? WHERE id = ?", [nowIso(), stageId], client);
      await recordAudit({ entityType: "pipeline_stage", entityId: stageId, action: "pipeline_stage_archived", actor: currentUser, summary: `Removeu a etapa: ${stage.name}`, changes: { targetStageId, movedCards: cardCount } }, client);
    });

    invalidateKanbanMetadataCache();
    invalidateLeadSummaryCache(currentUser);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/kanban/cards/move" && method === "POST") {
    requirePermission(currentUser, "move_lead_stage");
    const body = await readRequestBody(request);
    const leadId = String(body.leadId || "");
    const pipelineId = String(body.pipelineId || "");
    const stageId = String(body.stageId || "");
    if (!leadId || !pipelineId || !stageId) {
      const error = new Error("Informe o card, o funil e a etapa de destino.");
      error.statusCode = 400;
      throw error;
    }

    const movedLead = await withTransaction(async (client) => {
      const accessContext = await assertLeadAccess(currentUser, leadId, { forUpdate: true }, client);
      const lead = await getLeadById(leadId, {}, client);
      const stage = await getKanbanStageById(stageId, client, { forUpdate: true });
      if (!lead) {
        const error = new Error("Lead não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      if (!stage || stage.pipeline_id !== pipelineId) {
        const error = new Error("Etapa de destino inválida para este funil.");
        error.statusCode = 400;
        throw error;
      }
      assertKanbanMoveAllowed(currentUser, lead, pipelineId);
      const position = await calculateKanbanPosition({
        leadId,
        stageId,
        beforeLeadId: String(body.beforeLeadId || ""),
        afterLeadId: String(body.afterLeadId || ""),
      }, client);
      const stageChanged = lead.pipelineStageId !== stageId || lead.pipelineId !== pipelineId;
      const at = nowIso();
      const statusUpdate = getStageStatusUpdate(stage, lead.status);
      await execute(
        `UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, kanban_position = ?,
         pipeline_entered_at = ?, status = ?, is_lost = ?, updated_at = ?
         WHERE id = ? AND deleted_at = ''`,
        [pipelineId, stageId, position, stageChanged ? at : lead.pipelineEnteredAt || at, statusUpdate.status, statusUpdate.isLost, at, leadId],
        client,
      );
      const result = await getLeadById(leadId, {}, client);
      await reconcileLeadTasksForLifecycle(result, currentUser, client);
      await recordAudit({
        entityType: "lead",
        entityId: leadId,
        action: "kanban_card_moved",
        actor: currentUser,
        summary: `Moveu ${result?.name || leadId} para ${stage.name}`,
        changes: { fromPipelineId: lead.pipelineId, fromStageId: lead.pipelineStageId, toPipelineId: pipelineId, toStageId: stageId },
      }, client);
      return result;
    });

    invalidateLeadSummaryCache(currentUser);
    invalidateKanbanCountsCache();
    sendJson(response, 200, movedLead);
    return;
  }

  if (pathname === "/api/kanban/cards/bulk-assign" && method === "POST") {
    requirePermission(currentUser, "bulk_move_leads");
    const body = await readRequestBody(request);
    const leadIds = Array.isArray(body.leadIds) ? Array.from(new Set(body.leadIds.map(String).filter(Boolean))).slice(0, 200) : [];
    const pipelineId = String(body.pipelineId || "");
    const stageId = String(body.stageId || "");
    if (!leadIds.length) {
      const error = new Error("Selecione pelo menos um lead.");
      error.statusCode = 400;
      throw error;
    }

    const assignedLeads = await withTransaction(async (client) => {
      const stage = await getKanbanStageById(stageId, client, { forUpdate: true });
      if (!stage || stage.pipeline_id !== pipelineId) {
        const error = new Error("Etapa de destino inválida.");
        error.statusCode = 400;
        throw error;
      }
      let nextPosition = Number(await scalar("SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ?", [stageId], client) || 0) + 1000;
      const results = [];
      const accessContext = await getLeadAccessContext(currentUser, client);
      for (const leadId of leadIds) {
        await assertLeadAccess(currentUser, leadId, { accessContext, forUpdate: true }, client);
        const lead = await getLeadById(leadId, {}, client);
        if (!lead) continue;
        const statusUpdate = getStageStatusUpdate(stage, lead.status);
        const at = nowIso();
        await execute(
          `UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, kanban_position = ?, pipeline_entered_at = ?,
           status = ?, is_lost = ?, updated_at = ? WHERE id = ? AND deleted_at = ''`,
          [pipelineId, stageId, nextPosition, at, statusUpdate.status, statusUpdate.isLost, at, leadId],
          client,
        );
        nextPosition += 1000;
        const savedLead = await getLeadById(leadId, {}, client);
        if (savedLead) {
          await reconcileLeadTasksForLifecycle(savedLead, currentUser, client);
          results.push(savedLead);
        }
      }
      await recordAudit({ entityType: "pipeline", entityId: pipelineId, action: "kanban_cards_bulk_assigned", actor: currentUser, summary: `Moveu ${results.length} card(s) para ${stage.name}`, changes: { leadIds: results.map((lead) => lead.id), stageId } }, client);
      return results;
    });

    invalidateLeadSummaryCache(currentUser);
    invalidateKanbanCountsCache();
    sendJson(response, 200, assignedLeads);
    return;
  }

  if (pathname === "/api/leads/filter-options" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const accessContext = await getLeadAccessContext(currentUser);
    const scopedAccess = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, "l");
    const cacheKey = `owners:${leadDashboardCacheKey(accessContext)}`;
    const owners = await filterOptionsCache.getOrLoad(cacheKey, async () => {
      const rows = await queryRows(
        `SELECT TRIM(l.responsible) AS name, COUNT(*) AS total FROM leads l
         WHERE l.deleted_at = '' AND TRIM(COALESCE(l.responsible, '')) != '' AND ${scopedAccess.clause}
         GROUP BY TRIM(l.responsible) ORDER BY name ASC LIMIT 500`, scopedAccess.params);
      return rows.map((row) => ({ name: String(row.name || ""), total: Number(row.total || 0) }));
    });
    sendJson(response, 200, { owners, scope: accessContext.scope });
    return;
  }

  if (pathname === "/api/leads/summary" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const accessContext = await getLeadAccessContext(currentUser);
    const summary = await getLeadSummaryCached({
      force: requestUrl.searchParams.get("force") === "1",
      accessContext,
    });
    sendJson(response, 200, {
      ...summary,
      scope: accessContext.scope,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/leads/opportunities/summary" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const accessContext = await getLeadAccessContext(currentUser);
    const summary = await getOpportunitySummaryCached({
      force: requestUrl.searchParams.get("force") === "1",
      accessContext,
    });
    sendJson(response, 200, {
      ...summary,
      scope: accessContext.scope,
      generatedAt: nowIso(),
    });
    return;
  }

  if (pathname === "/api/admin/leads/overview" && method === "GET") {
    requirePermission(currentUser, "manage_users");
    const accessContext = await getLeadAccessContext(currentUser);
    sendJson(response, 200, await getAdminLeadOverview(accessContext, pool, {
      includeDuplicates: requestUrl.searchParams.get("includeDuplicates") !== "0",
    }));
    return;
  }

  if (pathname === "/api/leads/duplicates" && method === "GET") {
    requirePermission(currentUser, "manage_users");
    const accessContext = await getLeadAccessContext(currentUser);
    sendJson(response, 200, await getDuplicateGroupsPage(accessContext, {
      limit: requestUrl.searchParams.get("limit"),
      offset: requestUrl.searchParams.get("offset"),
    }));
    return;
  }

  if (pathname === "/api/leads" && method === "GET") {
    requirePermission(currentUser, "read_leads");
    sendJson(response, 200, await getLeadsPageFromRequest(requestUrl, currentUser));
    return;
  }

  if (pathname === "/api/leads/deleted" && method === "GET") {
    requirePermission(currentUser, "restore_leads");
    const accessContext = await getLeadAccessContext(currentUser);
    sendJson(response, 200, await getDeletedLeadsPageFromRequest(requestUrl, accessContext));
    return;
  }

  if (pathname === "/api/leads/merge" && method === "POST") {
    requirePermission(currentUser, "merge_leads");
    const body = await readRequestBody(request);
    const primaryLeadId = String(body.primaryLeadId || "");
    const duplicateLeadIds = Array.isArray(body.duplicateLeadIds) ? body.duplicateLeadIds.map(String).filter(Boolean) : [];

    if (!primaryLeadId || !duplicateLeadIds.length) {
      const error = new Error("Informe o lead principal e pelo menos um duplicado para mesclar.");
      error.statusCode = 400;
      throw error;
    }

    const mergedLead = await withTransaction(async (client, transactionContext) => {
      await acquireLeadIdentityMutationLock(client, transactionContext);
      const accessContext = await getLeadAccessContext(currentUser, client);
      const mergeLeadIds = Array.from(new Set([primaryLeadId, ...duplicateLeadIds])).sort();
      for (const mergeLeadId of mergeLeadIds) {
        await assertLeadAccess(currentUser, mergeLeadId, { accessContext, forUpdate: true }, client);
      }
      let primaryLead = await getLeadById(primaryLeadId, {}, client);
      if (!primaryLead) {
        const error = new Error("Lead principal não encontrado.");
        error.statusCode = 404;
        throw error;
      }

      const mergedIds = [];
      for (const duplicateLeadId of duplicateLeadIds) {
        const duplicateLead = await getLeadById(duplicateLeadId, {}, client);
        if (!duplicateLead || duplicateLead.id === primaryLead.id) continue;
        primaryLead = mergeLeadData(primaryLead, duplicateLead);
        primaryLead.id = primaryLeadId;
        await mergeLeadRelations(primaryLead, duplicateLead, currentUser, client);
        mergedIds.push(duplicateLead.id);
      }

      const saved = await saveLead(primaryLead, client);
      await reconcileLeadTasksForLifecycle(saved, currentUser, client);
      await recordAudit({ entityType: "lead", entityId: primaryLeadId, action: "leads_merged", actor: currentUser, summary: `Mesclou ${mergedIds.length} duplicado(s) em ${saved.name || saved.company || saved.id}`, changes: { primaryLeadId, mergedIds } }, client);
      return saved;
    });

    sendJson(response, 200, mergedLead);
    return;
  }

  if (pathname === "/api/exports/leads" && method === "POST") {
    requirePermission(currentUser, "export_leads");
    const body = await readRequestBody(request);
    const format = String(body.format || "csv").toLowerCase();
    if (!['csv', 'xlsx'].includes(format)) {
      const error = new Error("Formato de exportação inválido. Use CSV ou XLSX.");
      error.statusCode = 400;
      throw error;
    }
    const type = format === "xlsx" ? JOB_TYPES.EXPORT_LEADS_XLSX : JOB_TYPES.EXPORT_LEADS_CSV;
    const queued = await enqueuePersistentJob({
      type,
      payload: { format },
      actor: currentUser,
      maxAttempts: 3,
    });
    sendJson(response, 202, publicJob(queued.job));
    return;
  }

  if ((pathname === "/api/export/leads.csv" || pathname === "/api/export/leads.xlsx") && method === "GET") {
    requirePermission(currentUser, "export_leads");
    const format = pathname.endsWith(".xlsx") ? "xlsx" : "csv";
    const queued = await enqueuePersistentJob({
      type: format === "xlsx" ? JOB_TYPES.EXPORT_LEADS_XLSX : JOB_TYPES.EXPORT_LEADS_CSV,
      payload: { format, compatibilityRoute: pathname },
      actor: currentUser,
      maxAttempts: 3,
    });
    response.setHeader("Deprecation", "true");
    response.setHeader("Link", '</api/exports/leads>; rel="successor-version"');
    response.setHeader("Warning", '299 - "Exportação direta descontinuada; acompanhe o job retornado"');
    sendJson(response, 202, publicJob(queued.job));
    return;
  }

  if (pathname === "/api/backup/sqlite" && method === "GET") {
    requirePermission(currentUser, "backup_database");
    const queued = await enqueuePersistentJob({
      type: JOB_TYPES.BACKUP,
      payload: { compatibilityRoute: pathname },
      actor: currentUser,
      dedupeKey: "backup:mysql:manual",
      maxAttempts: 2,
    });
    response.setHeader("Deprecation", "true");
    response.setHeader("Sunset", "Thu, 01 Oct 2026 00:00:00 GMT");
    response.setHeader("Link", '</api/backups>; rel="successor-version"');
    response.setHeader("Warning", '299 - "Rota /api/backup/sqlite descontinuada; o backup agora é assíncrono"');
    sendJson(response, 202, publicJob(queued.job));
    return;
  }

  if (pathname === "/api/backups" && method === "GET") {
    requirePermission(currentUser, "backup_database");
    const rows = await queryRows("SELECT * FROM backups ORDER BY created_at DESC LIMIT 60");
    sendJson(response, 200, rows.map(rowToBackup));
    return;
  }

  if (pathname === "/api/backups" && method === "POST") {
    requirePermission(currentUser, "backup_database");
    const queued = await enqueuePersistentJob({
      type: JOB_TYPES.BACKUP,
      payload: { requestedAt: nowIso() },
      actor: currentUser,
      dedupeKey: "backup:mysql:manual",
      maxAttempts: 2,
    });
    sendJson(response, 202, publicJob(queued.job));
    return;
  }

  const backupDownloadMatch = pathname.match(/^\/api\/backups\/([^/]+)\/download$/);
  if (backupDownloadMatch && method === "GET") {
    requirePermission(currentUser, "backup_database");
    const backupId = decodeURIComponent(backupDownloadMatch[1]);
    const backup = await statementFirstRow("SELECT * FROM backups WHERE id = ? LIMIT 1", [backupId]);

    if (!backup) {
      const error = new Error("Backup não encontrado.");
      error.statusCode = 404;
      throw error;
    }
    if (backup.status === "expired" || backup.expired_at) {
      const error = new Error("Este backup foi removido pela política de retenção.");
      error.statusCode = 410;
      throw error;
    }

    const filePath = resolveBackupRecordPath(backup);
    if (!existsSync(filePath)) {
      const error = new Error("Arquivo do backup não está disponível no armazenamento configurado.");
      error.statusCode = 404;
      throw error;
    }

    await sendFileDownload(response, filePath, backup.file_name, backupContentType(backup));
    return;
  }

  if (pathname === "/api/audit" && method === "GET") {
    requirePermission(currentUser, "read_audit");
    sendJson(response, 200, await getRecentAudit());
    return;
  }

  if (pathname === "/api/teams" && method === "GET") {
    requirePermission(currentUser, "manage_users");
    const teams = await metadataCache.getOrLoad("teams:all", async () => (await queryRows("SELECT * FROM teams ORDER BY is_active DESC, name ASC")).map(rowToTeam));
    sendJson(response, 200, teams);
    return;
  }

  if (pathname === "/api/teams" && method === "POST") {
    requirePermission(currentUser, "manage_users");
    const body = await readRequestBody(request);
    const team = await withTransaction((client) => createTeam(body, currentUser, client));
    invalidateDirectoryCaches();
    sendJson(response, 201, team);
    return;
  }

  const teamMatch = pathname.match(/^\/api\/teams\/([^/]+)$/);
  if (teamMatch && method === "PUT") {
    requirePermission(currentUser, "manage_users");
    const teamId = decodeURIComponent(teamMatch[1]);
    const body = await readRequestBody(request);
    const team = await withTransaction((client) => updateTeam(teamId, body, currentUser, client));
    invalidateDirectoryCaches();
    sendJson(response, 200, team);
    return;
  }

  if (pathname === "/api/users/assignable" && method === "GET") {
    requirePermission(currentUser, "assign_leads");
    const users = await metadataCache.getOrLoad("users:assignable", async () => (await queryRows(
      `SELECT u.*, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.is_active = 1 AND u.role IN ('consultor_vendas', 'vendedor') ORDER BY u.name ASC, u.email ASC`,
    )).map((row) => rowToUser(row, false)));
    sendJson(response, 200, users);
    return;
  }

  if (pathname === "/api/users" && method === "GET") {
    requirePermission(currentUser, "manage_users");
    const users = await metadataCache.getOrLoad("users:all", async () => (await queryRows(
      `SELECT u.*, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.created_at ASC`,
    )).map((row) => rowToUser(row)));
    sendJson(response, 200, users);
    return;
  }

  if (pathname === "/api/users" && method === "POST") {
    requirePermission(currentUser, "manage_users");
    const body = await readRequestBody(request);
    const user = await withTransaction((client) => createUser(body, currentUser, client));
    invalidateDirectoryCaches();
    sendJson(response, 201, user);
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "PUT") {
    requirePermission(currentUser, "manage_users");
    const userId = decodeURIComponent(userMatch[1]);
    const body = await readRequestBody(request);
    const user = await withTransaction((client) => updateUser(userId, body, currentUser, client));
    invalidateDirectoryCaches();
    sendJson(response, 200, user);
    return;
  }

  if (userMatch && method === "DELETE") {
    requirePermission(currentUser, "manage_users");
    const userId = decodeURIComponent(userMatch[1]);
    if (userId === currentUser.id) {
      const error = new Error("Você não pode desativar o próprio usuário logado.");
      error.statusCode = 400;
      throw error;
    }

    await withTransaction(async (client) => {
      const userRow = await statementFirstRow("SELECT * FROM users WHERE id = ? LIMIT 1", [userId], client);
      if (!userRow) {
        const error = new Error("Usuário não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      await assertConsultantOperationallyClear(userRow, userRow.role, false, client);
      await execute("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?", [nowIso(), userId], client);
      await recordAudit({ entityType: "user", entityId: userId, action: "user_deactivated", actor: currentUser, summary: "Usuário desativado" }, client);
    });
    invalidateDirectoryCaches();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/leads" && method === "POST") {
    requirePermission(currentUser, "create_leads");
    const body = await readRequestBody(request);
    const lead = body.lead || body;

    const savedLead = await withTransaction(async (client, transactionContext) => {
      const accessContext = await getLeadAccessContext(currentUser, client);
      const before = lead.id ? await getLeadById(lead.id, { forUpdate: true }, client) : null;
      if (before) {
        requirePermission(currentUser, "edit_leads_full");
        await assertLeadAccess(currentUser, lead.id, { accessContext, forUpdate: true }, client);
      }
      const normalizedInput = normalizeLead(lead);
      const changedFields = before ? getChangedLeadFields(before, normalizedInput, auditableLeadFields) : [];
      assertAssignmentUsesHandoff({ isNew: !before, changedFields, lead: normalizedInput });
      const assignedLead = enforceLeadAssignmentForUser(normalizedInput, accessContext.user, accessContext.teamMembers);
      const result = await saveLeadWithDuplicateProtection(assignedLead, client, accessContext, transactionContext);
      const changes = before ? diffLeads(before, result.lead) : result.lead;
      await recordAudit({ entityType: "lead", entityId: result.lead.id, action: before ? "lead_updated" : result.action === "merged" ? "lead_merged_on_create" : "lead_created", actor: currentUser, summary: before ? `Atualizou lead: ${result.lead.name}` : `Criou lead: ${result.lead.name}`, changes }, client);
      await syncLeadNextContactTask(result.lead, currentUser, client);
      await reconcileLeadTasksForLifecycle(result.lead, currentUser, client);
      return result.lead;
    });
    invalidateLeadSummaryCache(currentUser);

    sendJson(response, 201, savedLead);
    return;
  }

  if (pathname === "/api/leads/import" && method === "POST") {
    requirePermission(currentUser, "import_leads");
    const body = await readRequestBody(request);
    const leads = Array.isArray(body.leads) ? body.leads : [];
    if (!leads.length) {
      const error = new Error("Nenhum lead válido foi recebido para importação.");
      error.statusCode = 400;
      throw error;
    }

    const payloadArtifact = await writeJsonJobPayload({
      storageRoot: jobArtifactSettings.storageRoot,
      payload: { leads },
    });
    try {
      const queued = await enqueuePersistentJob({
        type: JOB_TYPES.IMPORT_LEADS,
        payload: { received: leads.length },
        payloadStorageKey: payloadArtifact.storageKey,
        actor: currentUser,
        maxAttempts: 3,
      });
      sendJson(response, 202, publicJob(queued.job));
    } catch (error) {
      await removeJobArtifact({ storageRoot: jobArtifactSettings.storageRoot, storageKey: payloadArtifact.storageKey }).catch(() => undefined);
      throw error;
    }
    return;
  }

  const leadHandoffMatch = pathname.match(/^\/api\/leads\/([^/]+)\/handoff$/);
  if (leadHandoffMatch && method === "POST") {
    requirePermission(currentUser, "assign_leads");
    requirePermission(currentUser, "move_lead_pipeline");
    requirePermission(currentUser, "assign_tasks");
    assertLeadHandoffAllowed(currentUser);

    const leadId = decodeURIComponent(leadHandoffMatch[1]);
    const body = await readRequestBody(request);
    const handoff = assertLeadHandoffPayload(body);

    const result = await withTransaction(async (client) => {
      await assertLeadAccess(currentUser, leadId, { forUpdate: true }, client);
      const before = await getLeadById(leadId, {}, client);
      if (!before) {
        const error = new Error("Lead não encontrado.");
        error.statusCode = 404;
        throw error;
      }

      const handoffSourceKey = buildHandoffTaskSourceKey(leadId, handoff.requestId);
      const existingHandoffTask = await statementFirstRow("SELECT id FROM tasks WHERE source_key = ? LIMIT 1", [handoffSourceKey], client);
      if (existingHandoffTask) {
        return { lead: before, task: await getTaskById(existingHandoffTask.id, client), idempotentReplay: true };
      }

      const consultant = await getUserById(handoff.consultantUserId, client);
      if (!consultant || !consultant.isActive || normalizeUserRole(consultant.role) !== USER_ROLES.SALES_CONSULTANT) {
        const error = new Error("Selecione um consultor de vendas ativo.");
        error.statusCode = 400;
        throw error;
      }

      const pipeline = await getKanbanPipelineById(handoff.pipelineId, client);
      const stage = await getKanbanStageById(handoff.stageId, client, { forUpdate: true });
      if (!pipeline || !stage || stage.pipeline_id !== pipeline.id) {
        const error = new Error("O funil ou a etapa inicial selecionada não é válida.");
        error.statusCode = 400;
        throw error;
      }
      assertHandoffTargetStage(stage);

      const at = nowIso();
      const canceledPreviousTasks = await cancelPendingTasksForLead(
        leadId,
        `Tarefa cancelada porque o lead foi encaminhado para ${consultant.name || consultant.email}.`,
        currentUser,
        client,
        { excludeSourceKey: handoffSourceKey },
      );
      const nextPosition = Number(await scalar(
        "SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ? AND deleted_at = ''",
        [stage.id],
        client,
      ) || 0) + 1000;
      const statusUpdate = getStageStatusUpdate(stage, before.status);

      await execute(
        `UPDATE leads
         SET responsible = ?, responsible_user_id = ?, pipeline_id = ?, pipeline_stage_id = ?,
             kanban_position = ?, pipeline_entered_at = ?, status = ?, is_lost = ?, updated_at = ?
         WHERE id = ? AND deleted_at = ''`,
        [
          consultant.name || consultant.email,
          consultant.id,
          pipeline.id,
          stage.id,
          nextPosition,
          at,
          statusUpdate.status,
          statusUpdate.isLost,
          at,
          leadId,
        ],
        client,
      );
      await commercialProfileRuntime.refreshLead(leadId, client);

      const task = await createTaskRecord({
        ...handoff.task,
        leadId,
        responsibleUserId: consultant.id,
      }, currentUser, client, { source: "lead_handoff", sourceKey: handoffSourceKey });

      const savedLead = await getLeadById(leadId, {}, client);
      await recordAudit({
        entityType: "lead",
        entityId: leadId,
        action: "lead_handed_off",
        actor: currentUser,
        summary: `Encaminhou ${savedLead?.name || before.name || leadId} para ${consultant.name || consultant.email}`,
        changes: {
          responsibleUserId: { from: before.responsibleUserId || "", to: consultant.id },
          responsible: { from: before.responsible || "", to: consultant.name || consultant.email },
          pipelineId: { from: before.pipelineId || "", to: pipeline.id },
          pipelineStageId: { from: before.pipelineStageId || "", to: stage.id },
          firstTaskId: task.id,
          requestId: handoff.requestId,
          canceledPreviousTasks,
        },
      }, client);

      return { lead: savedLead, task };
    });

    invalidateLeadSummaryCache(currentUser);
    sendJson(response, 200, result);
    return;
  }

  const leadExternalOriginsMatch = pathname.match(/^\/api\/leads\/([^/]+)\/external-origins$/);
  if (leadExternalOriginsMatch && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const leadId = decodeURIComponent(leadExternalOriginsMatch[1]);
    await assertLeadAccess(currentUser, leadId);
    const rows = await queryRows(
      "SELECT * FROM lead_external_origins WHERE lead_id = ? ORDER BY last_seen_at DESC, first_seen_at DESC",
      [leadId],
    );
    sendJson(response, 200, rows.map(rowToExternalOrigin));
    return;
  }

  const leadNotesMatch = pathname.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (leadNotesMatch && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const leadId = decodeURIComponent(leadNotesMatch[1]);
    await assertLeadAccess(currentUser, leadId, { includeDeleted: true });
    const rows = await queryRows(
      "SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 200",
      [leadId],
    );
    sendJson(response, 200, rows.map(rowToLeadNote));
    return;
  }

  if (leadNotesMatch && method === "POST") {
    requirePermission(currentUser, "add_lead_note");
    const leadId = decodeURIComponent(leadNotesMatch[1]);
    const body = await readRequestBody(request);
    const noteBody = String(body.body || "").replace(/\r\n/g, "\n").trim();
    if (!noteBody) {
      const error = new Error("Escreva a nota antes de salvar.");
      error.statusCode = 400;
      throw error;
    }
    if (noteBody.length > 5000) {
      const error = new Error("A nota pode ter no máximo 5.000 caracteres.");
      error.statusCode = 400;
      throw error;
    }

    const note = await withTransaction(async (client) => {
      await assertLeadAccess(currentUser, leadId, {}, client);
      const id = randomUUID();
      const createdAt = nowIso();
      await execute(
        "INSERT INTO lead_notes (id, lead_id, body, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, leadId, noteBody, currentUser.id, currentUser.name || currentUser.email || "Usuário", createdAt],
        client,
      );
      await recordAudit({
        entityType: "lead",
        entityId: leadId,
        action: "lead_note_added",
        actor: currentUser,
        summary: "Adicionou uma nota comercial",
        changes: { noteId: id },
      }, client);
      return rowToLeadNote({
        id,
        lead_id: leadId,
        body: noteBody,
        created_by: currentUser.id,
        created_by_name: currentUser.name || currentUser.email || "Usuário",
        created_at: createdAt,
      });
    });
    sendJson(response, 201, note);
    return;
  }

  const leadAuditMatch = pathname.match(/^\/api\/leads\/([^/]+)\/audit$/);
  if (leadAuditMatch && method === "GET") {
    requirePermission(currentUser, "read_audit");
    const leadId = decodeURIComponent(leadAuditMatch[1]);
    await assertLeadAccess(currentUser, leadId, { includeDeleted: true });
    const mergedRows = await queryRows("SELECT id FROM leads WHERE merged_into_lead_id = ?", [leadId]);
    const auditEntityIds = [leadId, ...mergedRows.map((row) => row.id)].filter(Boolean);
    const rows = await queryRows(
      `SELECT * FROM audit_log WHERE entity_type = 'lead' AND entity_id IN (${auditEntityIds.map(() => "?").join(", ")}) ORDER BY created_at DESC LIMIT 200`,
      auditEntityIds,
    );
    sendJson(response, 200, rows.map(rowToAudit));
    return;
  }

  const restoreMatch = pathname.match(/^\/api\/leads\/([^/]+)\/restore$/);
  if (restoreMatch && method === "POST") {
    requirePermission(currentUser, "restore_leads");
    const leadId = decodeURIComponent(restoreMatch[1]);

    const restoredLead = await withTransaction(async (client) => {
      await assertLeadAccess(currentUser, leadId, { includeDeleted: true, forUpdate: true }, client);
      const lead = await getLeadById(leadId, { includeDeleted: true }, client);
      if (!lead || !lead.deletedAt) {
        const error = new Error("Lead excluído não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const mergedIntoLeadId = String(await scalar("SELECT merged_into_lead_id FROM leads WHERE id = ? LIMIT 1", [leadId], client) || "").trim();
      if (mergedIntoLeadId) {
        const error = new Error("Este registro foi mesclado em outro lead e não pode ser restaurado separadamente.");
        error.statusCode = 409;
        throw error;
      }

      const restoredAt = nowIso();
      await execute("UPDATE leads SET deleted_at = '', deleted_by = '', restored_at = ?, restored_by = ?, updated_at = ? WHERE id = ?", [restoredAt, currentUser.id, restoredAt, leadId], client);
      let result = await getLeadById(leadId, {}, client);
      const currentStage = result?.pipelineStageId ? await getKanbanStageById(result.pipelineStageId, client) : null;
      if (result && (!currentStage || currentStage.pipeline_id !== result.pipelineId)) {
        const cache = defaultKanbanCache || await loadDefaultKanbanCache(client);
        if (cache?.pipelineId && cache?.fallbackStageId) {
          const targetStageId = cache.stagesByStatus[result.status] || cache.fallbackStageId;
          await execute(
            "UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, kanban_position = ?, pipeline_entered_at = ?, updated_at = ? WHERE id = ?",
            [cache.pipelineId, targetStageId, Date.now() * 1000 + Math.floor(Math.random() * 1000), restoredAt, restoredAt, leadId],
            client,
          );
          result = await getLeadById(leadId, {}, client);
        }
      }
      await recordAudit({ entityType: "lead", entityId: leadId, action: "lead_restored", actor: currentUser, summary: `Restaurou lead: ${result?.name || leadId}` }, client);
      return result;
    });

    sendJson(response, 200, restoredLead);
    return;
  }

  const permanentDeleteMatch = pathname.match(/^\/api\/leads\/([^/]+)\/permanent$/);
  if (permanentDeleteMatch && method === "DELETE") {
    requirePermission(currentUser, "permanent_delete_leads");
    const leadId = decodeURIComponent(permanentDeleteMatch[1]);

    await withTransaction(async (client) => {
      await assertLeadAccess(currentUser, leadId, { includeDeleted: true, forUpdate: true }, client);
      const deletedLead = await getLeadById(leadId, { includeDeleted: true }, client);
      if (!deletedLead || !deletedLead.deletedAt) {
        const error = new Error("Lead excluído não encontrado.");
        error.statusCode = 404;
        throw error;
      }
      const mergedChildren = await queryRows("SELECT id FROM leads WHERE merged_into_lead_id = ?", [leadId], client);
      const relatedLeadIds = [leadId, ...mergedChildren.map((row) => String(row.id || "").trim()).filter(Boolean)];
      for (const relatedLeadId of relatedLeadIds) {
        await execute("DELETE FROM tasks WHERE lead_id = ?", [relatedLeadId], client);
        await execute("DELETE FROM lead_notes WHERE lead_id = ?", [relatedLeadId], client);
        await execute("DELETE FROM lead_external_origins WHERE lead_id = ?", [relatedLeadId], client);
        await execute("UPDATE integration_events SET lead_id = '', updated_at = ? WHERE lead_id = ?", [nowIso(), relatedLeadId], client);
      }
      if (mergedChildren.length) {
        await execute("DELETE FROM leads WHERE merged_into_lead_id = ? AND deleted_at != ''", [leadId], client);
      }
      await execute("DELETE FROM leads WHERE id = ? AND deleted_at != ''", [leadId], client);
      await recordAudit({ entityType: "lead", entityId: leadId, action: "lead_permanently_deleted", actor: currentUser, summary: "Apagou lead e registros operacionais relacionados definitivamente" }, client);
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  const leadMatch = pathname.match(/^\/api\/leads\/([^/]+)$/);
  if (leadMatch && method === "GET") {
    requirePermission(currentUser, "read_leads");
    const leadId = decodeURIComponent(leadMatch[1]);
    await assertLeadAccess(currentUser, leadId, { includeDeleted: true });
    const lead = await getLeadById(leadId, { includeDeleted: true });
    if (!lead) {
      const error = new Error("Lead não encontrado.");
      error.statusCode = 404;
      throw error;
    }
    sendJson(response, 200, lead);
    return;
  }

  if (leadMatch && method === "PUT") {
    requireAnyPermission(currentUser, ["edit_leads_full", "edit_lead_sales_fields"]);
    const leadId = decodeURIComponent(leadMatch[1]);
    const body = await readRequestBody(request);
    const lead = normalizeLead({ ...(body.lead || body), id: leadId });

    const savedLead = await withTransaction(async (client, transactionContext) => {
      await acquireLeadIdentityMutationLock(client, transactionContext);
      const accessContext = await assertLeadAccess(currentUser, leadId, { includeDeleted: true, forUpdate: true }, client);
      const before = await getLeadById(leadId, { includeDeleted: true }, client);
      const changedFields = getChangedLeadFields(before, lead, auditableLeadFields);
      assertLeadFieldUpdateAllowed(currentUser, changedFields);
      assertAssignmentUsesHandoff({ changedFields, lead });
      const assignedLead = enforceLeadAssignmentForUser(lead, accessContext.user, accessContext.teamMembers);
      const alignedLead = await alignLeadKanbanStageWithStatus(assignedLead, before, client);
      const result = await saveLead(alignedLead, client);
      const changes = before ? diffLeads(before, result) : result;
      await recordAudit({ entityType: "lead", entityId: leadId, action: before ? "lead_updated" : "lead_created", actor: currentUser, summary: before ? `Atualizou lead: ${result.name}` : `Criou lead: ${result.name}`, changes }, client);
      await syncLeadNextContactTask(result, currentUser, client);
      await reconcileLeadTasksForLifecycle(result, currentUser, client);
      return result;
    });
    invalidateLeadSummaryCache(currentUser);

    sendJson(response, 200, savedLead);
    return;
  }

  if (leadMatch && method === "DELETE") {
    requirePermission(currentUser, "delete_leads");
    const leadId = decodeURIComponent(leadMatch[1]);

    await withTransaction(async (client) => {
      await assertLeadAccess(currentUser, leadId, { forUpdate: true }, client);
      const lead = await getLeadById(leadId, {}, client);
      const deletedAt = nowIso();
      await execute("UPDATE leads SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?", [deletedAt, currentUser.id, deletedAt, leadId], client);
      await cancelPendingTasksForLead(leadId, "Tarefa cancelada porque o lead foi enviado para a lixeira.", currentUser, client);
      await recordAudit({ entityType: "lead", entityId: leadId, action: "lead_deleted", actor: currentUser, summary: `Moveu para lixeira: ${lead?.name || leadId}` }, client);
    });
    invalidateLeadSummaryCache(currentUser);
    invalidateKanbanCountsCache();

    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, message: "Rota da API não encontrada." });
}

const handleStatic = createStaticAssetsHandler({ distDir, sendJson });

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  return performanceMonitor.runRequest(
    { request, response, pathname: requestUrl.pathname },
    () => handleRequestInstrumented(request, response, requestUrl),
  );
}

async function handleRequestInstrumented(request, response, requestUrl) {
  activeRequestCount += 1;
  response[RESPONSE_REQUEST] = request;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    activeRequestCount = Math.max(0, activeRequestCount - 1);
  };
  response.once("finish", finalize);
  response.once("close", finalize);

  applySecurityHeaders(request, response);

  try {
    if (requestUrl.pathname === "/health/live" && (request.method || "GET") === "GET") {
      sendJson(response, 200, buildLivenessReport());
      return;
    }
    if (requestUrl.pathname === "/health/ready" && (request.method || "GET") === "GET") {
      const readiness = await buildReadinessReport();
      sendJson(response, readiness.ok ? 200 : 503, { ...readiness, version: APP_VERSION });
      return;
    }
    if (isShuttingDown) {
      response.setHeader("Connection", "close");
      sendJson(response, 503, { ok: false, message: "Servidor em encerramento gracioso. Tente novamente em instantes." });
      return;
    }
    if (requestUrl.pathname.startsWith("/api")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    await handleStatic(request, response, requestUrl);
  } catch (caughtError) {
    if (response.headersSent) {
      response.destroy(caughtError instanceof Error ? caughtError : undefined);
      return;
    }
    const shutdownFailure = isExpectedShutdownError(caughtError) || isShuttingDown;
    const statusCode = shutdownFailure ? 503 : Number(caughtError?.statusCode || 500);
    if (statusCode === 429 && Number(caughtError?.retryAfterSeconds) > 0) {
      response.setHeader("Retry-After", String(Math.ceil(Number(caughtError.retryAfterSeconds))));
    }
    const publicMessage = shutdownFailure
      ? "Servidor em encerramento gracioso. Tente novamente em instantes."
      : statusCode >= 500
        ? "Erro interno no servidor. Tente novamente e, se o problema continuar, contate o administrador."
        : caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a solicitação.";

    if (statusCode >= 500 && !shutdownFailure) {
      console.error("Falha interna no CRM", {
        method: request.method || "GET",
        pathname: requestUrl.pathname,
        code: caughtError?.code || "INTERNAL_ERROR",
        name: caughtError?.name || "Error",
        databaseReady,
      });
    }

    if (!response.destroyed && !response.writableEnded) {
      sendJson(response, statusCode, { ok: false, message: publicMessage });
    }
  }
}

async function closeHttpServer(timeoutMs) {
  if (!httpServer) return true;
  const closed = new Promise((resolve) => {
    httpServer.close((error) => resolve(!error));
    httpServer.closeIdleConnections?.();
  });
  return Promise.race([
    closed,
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function waitForActiveRequests(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (activeRequestCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return activeRequestCount === 0;
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  databaseReady = false;
  console.log(`Encerramento gracioso iniciado por ${signal}.`);

  if (securityCleanupTimer) clearInterval(securityCleanupTimer);
  if (jobCleanupTimer) clearInterval(jobCleanupTimer);
  if (commercialProfileReadinessTimer) clearInterval(commercialProfileReadinessTimer);
  if (datetimeColumnsReadinessTimer) clearInterval(datetimeColumnsReadinessTimer);
  performanceMonitor.stop();
  shutdownController.abort();

  const [httpClosed, jobsDrained] = await Promise.all([
    closeHttpServer(GRACEFUL_SHUTDOWN_TIMEOUT_MS),
    jobWorker?.stop({ timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS }) ?? true,
  ]);
  const requestsDrained = await waitForActiveRequests(Math.min(5000, GRACEFUL_SHUTDOWN_TIMEOUT_MS));

  if (!httpClosed || !jobsDrained || !requestsDrained) {
    for (const socket of openSockets) socket.destroy();
    console.warn("Encerramento atingiu o tempo limite; conexões remanescentes foram finalizadas.", {
      httpClosed,
      jobsDrained,
      requestsDrained,
      activeRequests: activeRequestCount,
    });
  }

  await pool?.end().catch((error) => {
    if (!isExpectedShutdownError(error)) console.error("Falha ao fechar pool MySQL", { code: error?.code || "MYSQL_POOL_CLOSE_FAILED" });
  });
  pool = null;
  console.log("Encerramento gracioso concluído.");
}

async function startRuntime() {
  await initializeDatabase({ manageSchema: PROCESS_CAPABILITIES.managesSchema });

  if (PROCESS_CAPABILITIES.runsJobWorker) {
    await startPersistentJobWorker();
  }
  performanceMonitor.startRuntimeSampler(() => pool);

  if (PROCESS_CAPABILITIES.runsHttpServer) {
    securityCleanupTimer = setInterval(() => {
      cleanupSecurityState().catch((error) => console.warn("Não foi possível limpar sessões ou rate limits expirados:", error.message));
    }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
    securityCleanupTimer.unref?.();

    commercialProfileReadinessTimer = setInterval(() => {
      commercialProfileRuntime.refreshReadiness({ logTransition: true }).catch((error) => {
        console.warn("Não foi possível verificar prontidão da inteligência comercial materializada:", error.message);
      });
    }, COMMERCIAL_PROFILE_READINESS_CHECK_MS);
    commercialProfileReadinessTimer.unref?.();

    datetimeColumnsReadinessTimer = setInterval(() => {
      dateColumnRuntime.refreshReadiness({ logTransition: true }).catch((error) => {
        console.warn("Não foi possível verificar prontidão das colunas DATETIME(3):", error.message);
      });
    }, DATETIME_COLUMNS_READINESS_CHECK_MS);
    datetimeColumnsReadinessTimer.unref?.();

    await Promise.allSettled([cleanupSecurityState()]);
  }

  if (PROCESS_CAPABILITIES.runsJobWorker) {
    jobCleanupTimer = setInterval(() => {
      cleanupExpiredJobArtifacts().catch((error) => console.warn("Não foi possível aplicar retenção dos jobs:", error.message));
    }, JOB_CLEANUP_INTERVAL_MS);
    jobCleanupTimer.unref?.();

    await Promise.allSettled([
      cleanupExpiredJobArtifacts(),
      enqueueSearchIndexRebuild(),
    ]);
  }

  if (PROCESS_CAPABILITIES.runsHttpServer) {
    httpServer = createServer((request, response) => {
      void handleRequest(request, response);
    });
    httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
    httpServer.headersTimeout = Math.min(HTTP_HEADERS_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS);
    httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
    httpServer.on("connection", (socket) => {
      openSockets.add(socket);
      socket.once("close", () => openSockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(PORT, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });

    console.log(`CRM Casa do Ads v${APP_VERSION} API rodando em http://localhost:${PORT}`);
  } else {
    console.log(`CRM Casa do Ads v${APP_VERSION} worker iniciado sem servidor HTTP.`);
  }

  console.log(`Process role: ${PROCESS_ROLE}; MySQL: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}; pool: ${MYSQL_POOL_CONNECTION_LIMIT}`);
  if (PROCESS_CAPABILITIES.runsHttpServer) console.log(`Backups criptografados em: ${backupSettings.storageRoot}`);
  if (PROCESS_CAPABILITIES.runsJobWorker) {
    console.log(`Artifacts temporários de jobs em: ${jobArtifactSettings.storageRoot}`);
    console.log(`Worker persistente: concorrência ${JOB_WORKER_CONCURRENCY}`);
  }
  if (PROCESS_CAPABILITIES.runsHttpServer) {
    console.log(`Proxy confiável: ${TRUST_PROXY_POLICY.enabled ? "configurado" : "desativado"}`);
  }
}

process.once("SIGTERM", () => {
  void gracefulShutdown("SIGTERM").finally(() => process.exit());
});
process.once("SIGINT", () => {
  void gracefulShutdown("SIGINT").finally(() => process.exit());
});

try {
  await startRuntime();
} catch (error) {
  console.error("Falha ao iniciar o CRM", {
    code: error?.code || "STARTUP_FAILED",
    name: error?.name || "Error",
  });
  await gracefulShutdown("STARTUP_FAILURE").catch(() => undefined);
  process.exitCode = 1;
}
