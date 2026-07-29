import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");

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

const REPAIR = process.argv.includes("--repair");
const JSON_OUTPUT = process.argv.includes("--json");
const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = String(process.env.MYSQL_DATABASE || "crm_casa_ads").replace(/[^a-zA-Z0-9_]/g, "") || "crm_casa_ads";

async function scalar(pool, sql, params = []) {
  const [[row]] = await pool.execute(sql, params);
  return Number(row?.total || 0);
}

async function collect(pool) {
  const checks = {};
  checks.pendingTasksOnDeletedLeads = await scalar(pool, `SELECT COUNT(*) AS total FROM tasks t INNER JOIN leads l ON l.id = t.lead_id WHERE t.status = 'pending' AND l.deleted_at != ''`);
  checks.pendingTasksOnClosedLeads = await scalar(pool, `SELECT COUNT(*) AS total FROM tasks t INNER JOIN leads l ON l.id = t.lead_id WHERE t.status = 'pending' AND l.deleted_at = '' AND (l.is_lost = 1 OR l.status IN ('Fechado','Perdido'))`);
  checks.orphanTasks = await scalar(pool, `SELECT COUNT(*) AS total FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id WHERE t.lead_id != '' AND l.id IS NULL`);
  checks.leadsWithMissingOwner = await scalar(pool, `SELECT COUNT(*) AS total FROM leads l LEFT JOIN users u ON u.id = l.responsible_user_id WHERE l.deleted_at = '' AND l.responsible_user_id != '' AND u.id IS NULL`);
  checks.leadsWithInactiveOwner = await scalar(pool, `SELECT COUNT(*) AS total FROM leads l INNER JOIN users u ON u.id = l.responsible_user_id WHERE l.deleted_at = '' AND l.responsible_user_id != '' AND u.is_active = 0`);
  checks.pendingTasksWithMissingOwner = await scalar(pool, `SELECT COUNT(*) AS total FROM tasks t LEFT JOIN users u ON u.id = t.responsible_user_id WHERE t.status = 'pending' AND t.responsible_user_id != '' AND u.id IS NULL`);
  checks.pendingTasksWithInactiveOwner = await scalar(pool, `SELECT COUNT(*) AS total FROM tasks t INNER JOIN users u ON u.id = t.responsible_user_id WHERE t.status = 'pending' AND u.is_active = 0`);
  checks.duplicateKanbanPositions = await scalar(pool, `SELECT COUNT(*) AS total FROM (SELECT pipeline_stage_id, kanban_position FROM leads WHERE deleted_at = '' AND pipeline_stage_id != '' GROUP BY pipeline_stage_id, kanban_position HAVING COUNT(*) > 1) d`);
  checks.staleRunningJobs = await scalar(pool, `SELECT COUNT(*) AS total FROM async_jobs WHERE status = 'running' AND heartbeat_at != '' AND heartbeat_at < DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE), '%Y-%m-%dT%H:%i:%s.000Z')`);
  checks.nextContactMismatches = await scalar(pool, `SELECT COUNT(*) AS total FROM leads l LEFT JOIN (SELECT lead_id, MIN(due_at) AS next_due FROM tasks WHERE status = 'pending' AND lead_id != '' AND TRIM(COALESCE(due_at,'')) != '' GROUP BY lead_id) t ON t.lead_id = l.id WHERE l.deleted_at = '' AND COALESCE(l.next_contact_at,'') <> COALESCE(t.next_due,'')`);
  return checks;
}

async function repairSafeIssues(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const at = new Date().toISOString();
    const [closed] = await connection.execute(`UPDATE tasks t INNER JOIN leads l ON l.id = t.lead_id SET t.status = 'canceled', t.source_key = NULL, t.updated_at = ? WHERE t.status = 'pending' AND (l.deleted_at != '' OR l.is_lost = 1 OR l.status IN ('Fechado','Perdido'))`, [at]);
    const [nextContact] = await connection.execute(`UPDATE leads l LEFT JOIN (SELECT lead_id, MIN(due_at) AS next_due FROM tasks WHERE status = 'pending' AND lead_id != '' AND TRIM(COALESCE(due_at,'')) != '' GROUP BY lead_id) t ON t.lead_id = l.id SET l.next_contact_at = COALESCE(t.next_due,''), l.updated_at = CASE WHEN COALESCE(l.next_contact_at,'') <> COALESCE(t.next_due,'') THEN ? ELSE l.updated_at END WHERE l.deleted_at = '' AND COALESCE(l.next_contact_at,'') <> COALESCE(t.next_due,'')`, [at]);
    await connection.commit();
    return { canceledInvalidPendingTasks: Number(closed.affectedRows || 0), synchronizedNextContact: Number(nextContact.affectedRows || 0) };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function summarize(checks) {
  const total = Object.values(checks).reduce((sum, value) => sum + Number(value || 0), 0);
  const critical = checks.orphanTasks + checks.leadsWithMissingOwner + checks.pendingTasksWithMissingOwner;
  return { totalFindings: total, criticalFindings: critical, ok: total === 0 };
}

async function run() {
  const pool = mysql.createPool({ host: MYSQL_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DATABASE, waitForConnections: true, connectionLimit: 2, queueLimit: 4, charset: "utf8mb4" });
  try {
    await pool.query("SELECT 1");
    const before = await collect(pool);
    const repairs = REPAIR ? await repairSafeIssues(pool) : null;
    const after = REPAIR ? await collect(pool) : before;
    const result = { database: MYSQL_DATABASE, mode: REPAIR ? "repair" : "check", before, repairs, after, summary: summarize(after), checkedAt: new Date().toISOString() };
    if (JSON_OUTPUT) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Integridade operacional (${result.mode}) — ${MYSQL_DATABASE}`);
      for (const [name, count] of Object.entries(after)) console.log(`${String(count).padStart(7)}  ${name}`);
      if (repairs) console.log("Reparos seguros:", repairs);
      console.log(result.summary.ok ? "OK: nenhuma inconsistência detectada." : `Atenção: ${result.summary.totalFindings} ocorrência(s), ${result.summary.criticalFindings} crítica(s).`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Falha ao verificar integridade operacional:", error?.message || error);
  process.exitCode = 1;
});
