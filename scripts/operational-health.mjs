import mysql from "mysql2/promise";
import { buildOperationalDatabaseSnapshot, resolveOperationalSettings } from "../server/operationalObservability.js";
import { loadProjectEnv, mysqlConfigFromEnv } from "./operational-cli-core.mjs";

loadProjectEnv();
const config = mysqlConfigFromEnv();
const settings = resolveOperationalSettings(process.env);
const pool = mysql.createPool(config);
const queryRows = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
};

try {
  const database = await buildOperationalDatabaseSnapshot({ queryRows, databaseName: config.database, staleJobMs: settings.staleJobMs });
  const history = await queryRows(
    `SELECT process_role, status, rss_mb, heap_used_mb, cpu_pct, event_loop_p95_ms,
            pool_connections, pool_free, pool_pending, pool_limit, active_requests, active_jobs, captured_at
     FROM operational_health_snapshots ORDER BY captured_at DESC LIMIT 12`,
  ).catch(() => []);
  console.log(JSON.stringify({ ok: true, database, recentRuntime: history, retention: settings }, null, 2));
  if (database.staleRunningJobs > 0) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code || "OPS_CHECK_FAILED", message: error?.message || "Falha operacional" }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
