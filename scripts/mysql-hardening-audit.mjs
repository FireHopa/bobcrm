import { existsSync, readFileSync, statfsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  buildHardeningRecommendations,
  buildSafeMyCnfCandidate,
  calculateMysqlMetrics,
  diffStatus,
  formatBytes,
  statusMap,
  variableMap,
} from "./mysql-hardening-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(projectRoot, "server", ".env"));

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function sanitizeIdentifier(value) {
  return String(value || "crm_casa_ads").replace(/[^a-zA-Z0-9_]/g, "") || "crm_casa_ads";
}

const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = sanitizeIdentifier(process.env.MYSQL_DATABASE || "crm_casa_ads");
const SAMPLE_SECONDS = boundedInt(readArg("sample-seconds", process.env.MYSQL_HARDENING_SAMPLE_SECONDS || "5"), 5, 1, 30);
const MAX_DIGESTS = boundedInt(readArg("max-digests", process.env.MYSQL_HARDENING_MAX_DIGESTS || "20"), 20, 5, 50);
const OUTPUT = path.resolve(projectRoot, readArg("output", "MYSQL_HARDENING_REPORT.md"));
const CANDIDATE_OUTPUT = path.resolve(projectRoot, readArg("candidate-output", "MYSQL_HARDENING_CANDIDATE.cnf"));

const VARIABLE_NAMES = [
  "version", "version_comment", "hostname", "port", "datadir",
  "innodb_buffer_pool_size", "innodb_buffer_pool_instances", "innodb_redo_log_capacity",
  "innodb_flush_log_at_trx_commit", "innodb_flush_method", "innodb_io_capacity", "innodb_io_capacity_max",
  "max_connections", "max_user_connections", "thread_cache_size", "table_open_cache", "open_files_limit",
  "tmp_table_size", "max_heap_table_size", "temptable_max_ram", "internal_tmp_mem_storage_engine",
  "slow_query_log", "slow_query_log_file", "long_query_time", "log_output", "log_queries_not_using_indexes",
  "performance_schema", "sync_binlog", "binlog_format", "skip_name_resolve",
];

const STATUS_NAMES = [
  "Uptime", "Questions", "Queries", "Slow_queries", "Connections", "Aborted_connects", "Aborted_clients",
  "Threads_connected", "Threads_running", "Threads_cached", "Threads_created", "Max_used_connections",
  "Created_tmp_tables", "Created_tmp_disk_tables", "Created_tmp_files",
  "Innodb_buffer_pool_reads", "Innodb_buffer_pool_read_requests", "Innodb_buffer_pool_wait_free",
  "Innodb_buffer_pool_pages_total", "Innodb_buffer_pool_pages_data", "Innodb_buffer_pool_pages_free", "Innodb_buffer_pool_pages_dirty",
  "Innodb_data_reads", "Innodb_data_writes", "Innodb_data_fsyncs", "Innodb_data_pending_reads", "Innodb_data_pending_writes",
  "Innodb_row_lock_waits", "Innodb_row_lock_time", "Innodb_row_lock_current_waits",
  "Com_select", "Com_insert", "Com_update", "Com_delete", "Bytes_received", "Bytes_sent",
  "Table_open_cache_hits", "Table_open_cache_misses", "Opened_tables", "Open_tables",
];

function sqlQuotedList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}

async function collectVariables(connection) {
  const [rows] = await connection.query(`SHOW GLOBAL VARIABLES WHERE Variable_name IN (${sqlQuotedList(VARIABLE_NAMES)})`);
  return variableMap(rows);
}

async function collectStatus(connection) {
  const [rows] = await connection.query(`SHOW GLOBAL STATUS WHERE Variable_name IN (${sqlQuotedList(STATUS_NAMES)})`);
  return statusMap(rows);
}

async function collectTables(connection) {
  const [rows] = await connection.execute(`SELECT TABLE_NAME AS table_name,
      TABLE_ROWS AS table_rows,
      DATA_LENGTH AS data_bytes,
      INDEX_LENGTH AS index_bytes,
      DATA_FREE AS data_free_bytes
    FROM information_schema.tables
    WHERE table_schema = ?
    ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`, [MYSQL_DATABASE]);
  return rows.map((row) => ({
    table: String(row.table_name || ""),
    rows: Number(row.table_rows || 0),
    dataBytes: Number(row.data_bytes || 0),
    indexBytes: Number(row.index_bytes || 0),
    dataFreeBytes: Number(row.data_free_bytes || 0),
  }));
}

async function collectStatementDigests(connection) {
  try {
    const [rows] = await connection.execute(`SELECT
        DIGEST_TEXT AS digest_text,
        COUNT_STAR AS count_star,
        ROUND(SUM_TIMER_WAIT / 1000000000000, 3) AS total_seconds,
        ROUND(AVG_TIMER_WAIT / 1000000000, 3) AS avg_ms,
        SUM_ROWS_EXAMINED AS rows_examined,
        SUM_ROWS_SENT AS rows_sent,
        SUM_NO_INDEX_USED AS no_index_used,
        SUM_NO_GOOD_INDEX_USED AS no_good_index_used,
        FIRST_SEEN AS first_seen,
        LAST_SEEN AS last_seen
      FROM performance_schema.events_statements_summary_by_digest
      WHERE SCHEMA_NAME = ? AND DIGEST_TEXT IS NOT NULL
      ORDER BY SUM_TIMER_WAIT DESC
      LIMIT ${MAX_DIGESTS}`, [MYSQL_DATABASE]);
    return rows.map((row) => ({
      digestText: String(row.digest_text || "").replace(/\s+/g, " ").trim().slice(0, 1000),
      count: Number(row.count_star || 0),
      totalSeconds: Number(row.total_seconds || 0),
      avgMs: Number(row.avg_ms || 0),
      rowsExamined: Number(row.rows_examined || 0),
      rowsSent: Number(row.rows_sent || 0),
      noIndexUsed: Number(row.no_index_used || 0),
      noGoodIndexUsed: Number(row.no_good_index_used || 0),
      firstSeen: row.first_seen ? String(row.first_seen) : "",
      lastSeen: row.last_seen ? String(row.last_seen) : "",
    }));
  } catch (error) {
    return [{ unavailable: true, reason: String(error?.code || error?.message || error) }];
  }
}

async function collectIndexUsage(connection) {
  try {
    const [rows] = await connection.execute(`SELECT OBJECT_NAME AS table_name,
        INDEX_NAME AS index_name,
        COUNT_READ AS reads,
        COUNT_WRITE AS writes,
        ROUND(SUM_TIMER_READ / 1000000000000, 3) AS read_seconds,
        ROUND(SUM_TIMER_WRITE / 1000000000000, 3) AS write_seconds
      FROM performance_schema.table_io_waits_summary_by_index_usage
      WHERE OBJECT_SCHEMA = ?
      ORDER BY COUNT_READ DESC`, [MYSQL_DATABASE]);
    return rows.map((row) => ({
      table: String(row.table_name || ""), index: row.index_name == null ? "<no-index>" : String(row.index_name),
      reads: Number(row.reads || 0), writes: Number(row.writes || 0),
      readSeconds: Number(row.read_seconds || 0), writeSeconds: Number(row.write_seconds || 0),
    }));
  } catch (error) {
    return [{ unavailable: true, reason: String(error?.code || error?.message || error) }];
  }
}

function collectFilesystem(targetPath) {
  try {
    const stats = statfsSync(targetPath);
    const blockSize = Number(stats.bsize || 0);
    const total = Number(stats.blocks || 0) * blockSize;
    const available = Number(stats.bavail || stats.bfree || 0) * blockSize;
    return { path: targetPath, totalBytes: total, availableBytes: available, usedPct: total > 0 ? Number((((total - available) / total) * 100).toFixed(1)) : null };
  } catch {
    return null;
  }
}

function collectLinuxMemory() {
  if (os.platform() !== "linux" || !existsSync("/proc/meminfo")) return {};
  try {
    const values = {};
    for (const line of readFileSync("/proc/meminfo", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
      if (match) values[match[1]] = Number(match[2]) * 1024;
    }
    return {
      availableMemoryBytes: values.MemAvailable || 0,
      swapTotalBytes: values.SwapTotal || 0,
      swapFreeBytes: values.SwapFree || 0,
    };
  } catch {
    return {};
  }
}

function collectOs(variables) {
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const mysqlAppearsLocal = localHosts.has(String(MYSQL_HOST).toLowerCase());
  const datadir = String(variables.datadir || "");
  const disks = [collectFilesystem(projectRoot)];
  if (mysqlAppearsLocal && datadir && existsSync(datadir)) disks.push(collectFilesystem(datadir));
  const linuxMemory = collectLinuxMemory();
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: linuxMemory.availableMemoryBytes || os.freemem(),
    swapTotalBytes: linuxMemory.swapTotalBytes || 0,
    swapFreeBytes: linuxMemory.swapFreeBytes || 0,
    uptimeSeconds: os.uptime(),
    mysqlAppearsLocal,
    disks: disks.filter(Boolean),
  };
}

function tableSummary(tables) {
  return tables.reduce((acc, table) => {
    acc.dataBytes += Number(table.dataBytes || 0);
    acc.indexBytes += Number(table.indexBytes || 0);
    acc.dataFreeBytes += Number(table.dataFreeBytes || 0);
    return acc;
  }, { dataBytes: 0, indexBytes: 0, dataFreeBytes: 0 });
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_Sem dados._";
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown(report) {
  const { variables, status, os: osInfo, metrics, sample, tables, digests, indexUsage, recommendations, summary } = report;
  const topTables = tables.slice(0, 15);
  const usableDigests = digests.filter((item) => !item.unavailable);
  const noIndex = indexUsage.filter((item) => !item.unavailable && item.index === "<no-index>" && item.reads > 0).slice(0, 10);

  return `# MYSQL HARDENING REPORT — FASE 12\n\nGerado em: ${report.generatedAt}\n\n> Auditoria somente leitura. Nenhum parâmetro MySQL foi alterado automaticamente.\n\n## 1. Ambiente\n\n${markdownTable(["Item", "Valor"], [
    ["MySQL", `${variables.version || "?"} ${variables.version_comment || ""}`.trim()],
    ["Banco", MYSQL_DATABASE],
    ["Host MySQL", `${MYSQL_HOST}:${MYSQL_PORT}`],
    ["MySQL parece local", osInfo.mysqlAppearsLocal ? "sim" : "não"],
    ["CPU", `${osInfo.cpuCount} vCPU`],
    ["RAM total", formatBytes(osInfo.totalMemoryBytes)],
    ["RAM disponível no snapshot", formatBytes(osInfo.freeMemoryBytes)],
    ["Swap em uso", osInfo.swapTotalBytes > 0 ? formatBytes(osInfo.swapTotalBytes - osInfo.swapFreeBytes) : "0 B"],
    ["Load average", osInfo.loadAverage.join(" / ")],
    ["Footprint dados", formatBytes(summary.dataBytes)],
    ["Footprint índices", formatBytes(summary.indexBytes)],
  ])}\n\n## 2. Configuração crítica\n\n${markdownTable(["Variável", "Valor"], [
    ["innodb_buffer_pool_size", `${variables.innodb_buffer_pool_size || "?"} (${formatBytes(variables.innodb_buffer_pool_size)})`],
    ["buffer pool / RAM", metrics.bufferPoolToRamPct == null ? "n/a" : `${metrics.bufferPoolToRamPct}%`],
    ["max_connections", variables.max_connections || "?"],
    ["tmp_table_size", `${variables.tmp_table_size || "?"} (${formatBytes(variables.tmp_table_size)})`],
    ["max_heap_table_size", `${variables.max_heap_table_size || "?"} (${formatBytes(variables.max_heap_table_size)})`],
    ["slow_query_log", variables.slow_query_log || "?"],
    ["long_query_time", `${variables.long_query_time || "?"}s`],
    ["thread_cache_size", variables.thread_cache_size || "?"],
    ["table_open_cache", variables.table_open_cache || "?"],
    ["performance_schema", variables.performance_schema || "?"],
    ["innodb_flush_log_at_trx_commit", variables.innodb_flush_log_at_trx_commit || "?"],
    ["sync_binlog", variables.sync_binlog || "?"],
  ])}\n\n## 3. Indicadores\n\n${markdownTable(["Indicador", "Resultado"], [
    ["Buffer pool hit ratio", `${metrics.bufferPoolHitPct}%`],
    ["Buffer pool páginas dirty", `${metrics.bufferDirtyPct}%`],
    ["Buffer pool páginas livres", `${metrics.bufferFreePct}%`],
    ["Pico de conexões / max_connections", `${metrics.connectionUtilizationPct}% (${status.Max_used_connections || 0}/${variables.max_connections || 0})`],
    ["Conexões atuais", `${status.Threads_connected || 0}`],
    ["Threads rodando", `${status.Threads_running || 0}`],
    ["Thread cache miss histórico", `${metrics.threadCacheMissPct}%`],
    ["Table open cache miss", `${metrics.tableOpenCacheMissPct}%`],
    ["Aborted connects", `${metrics.abortedConnectPct}%`],
    ["Temporary tables em disco", `${metrics.tempDiskTablePct}%`],
    ["Slow queries / Questions", `${metrics.slowQueryPct}%`],
    ["QPS médio desde startup", metrics.averageQpsSinceStart.toFixed(2)],
    ["QPS durante amostra", metrics.sampleQps.toFixed(2)],
    ["Slow QPS durante amostra", metrics.sampleSlowQps.toFixed(3)],
    ["InnoDB data reads/s", Number(sample.Innodb_data_reads_per_second || 0).toFixed(2)],
    ["InnoDB data writes/s", Number(sample.Innodb_data_writes_per_second || 0).toFixed(2)],
    ["InnoDB buffer physical reads/s", Number(sample.Innodb_buffer_pool_reads_per_second || 0).toFixed(2)],
    ["Temporary tables disco/s", Number(sample.Created_tmp_disk_tables_per_second || 0).toFixed(2)],
    ["Rede recebida/s", `${formatBytes(sample.Bytes_received_per_second || 0)}/s`],
    ["Rede enviada/s", `${formatBytes(sample.Bytes_sent_per_second || 0)}/s`],
    ["Row lock waits", status.Innodb_row_lock_waits || 0],
    ["Row lock time", `${status.Innodb_row_lock_time || 0} ms`],
  ])}\n\nAmostra dinâmica: ${sample.seconds}s.\n\n## 4. Disco\n\n${markdownTable(["Path", "Total", "Disponível", "Uso"], osInfo.disks.map((disk) => [disk.path, formatBytes(disk.totalBytes), formatBytes(disk.availableBytes), `${disk.usedPct}%`]))}\n\n## 5. Maiores tabelas\n\n${markdownTable(["Tabela", "Rows estimadas", "Dados", "Índices", "Data free"], topTables.map((table) => [table.table, table.rows, formatBytes(table.dataBytes), formatBytes(table.indexBytes), formatBytes(table.dataFreeBytes)]))}\n\n## 6. Top statements por tempo acumulado\n\n${usableDigests.length ? markdownTable(["Digest normalizado", "Execuções", "Total s", "Média ms", "Rows examined", "Rows sent", "No index"], usableDigests.map((item) => [item.digestText, item.count, item.totalSeconds, item.avgMs, item.rowsExamined, item.rowsSent, item.noIndexUsed])) : `_Performance Schema indisponível: ${digests[0]?.reason || "sem dados"}._`}\n\n## 7. Leituras sem índice observadas pelo Performance Schema\n\n${noIndex.length ? markdownTable(["Tabela", "Reads", "Read s"], noIndex.map((item) => [item.table, item.reads, item.readSeconds])) : "_Nenhuma leitura sem índice foi observada neste snapshot, ou o Performance Schema não disponibilizou a métrica._"}\n\n## 8. Recomendações\n\n${recommendations.map((item, index) => `### ${index + 1}. [${item.severity.toUpperCase()}] ${item.title}\n\n${item.detail}\n\n**Ação:** ${item.action}`).join("\n\n")}\n\n## 9. Regra de aplicação\n\nNão aplicar alterações de memória/conexões apenas com este snapshot. Rode esta auditoria em horário de pico e compare com:\n\n1. \`MYSQL_EXPLAIN_ANALYZE_REPORT.md\` da Fase 9.\n2. Slow query log.\n3. Métricas \`[perf.runtime]\` e \`[perf.sql]\` da Fase 0.\n4. Uso de RAM/swap e disco da VPS.\n\nO arquivo \`MYSQL_HARDENING_CANDIDATE.cnf\` é apenas um candidato revisável. Ele deliberadamente NÃO altera automaticamente buffer pool, max_connections ou limites de temporary tables.\n`;
}

async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const connection = await mysql.createConnection({
    host: MYSQL_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE, charset: "utf8mb4", connectTimeout: 10000,
  });

  try {
    const variables = await collectVariables(connection);
    const before = await collectStatus(connection);
    await sleep(SAMPLE_SECONDS * 1000);
    const after = await collectStatus(connection);
    const sample = diffStatus(before, after, SAMPLE_SECONDS);
    const tables = await collectTables(connection);
    const summary = tableSummary(tables);
    const osInfo = collectOs(variables);
    const metrics = calculateMysqlMetrics({ variables, status: after, os: osInfo, sample });
    const recommendations = buildHardeningRecommendations({ variables, status: after, os: osInfo, metrics, tableSummary: summary });
    const [digests, indexUsage] = await Promise.all([collectStatementDigests(connection), collectIndexUsage(connection)]);
    const report = {
      generatedAt: new Date().toISOString(), variables, status: after, sample, os: osInfo,
      metrics, tables, summary, digests, indexUsage, recommendations,
    };
    const markdown = buildMarkdown(report);
    await writeFile(OUTPUT, markdown, "utf8");
    await writeFile(CANDIDATE_OUTPUT, buildSafeMyCnfCandidate({ variables, recommendations }), "utf8");
    process.stdout.write(markdown);
    console.log(`\nRelatório salvo em: ${OUTPUT}`);
    console.log(`Candidato de configuração salvo em: ${CANDIDATE_OUTPUT}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
