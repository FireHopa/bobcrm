import mysql from "mysql2/promise";
import { cleanupOperationalHistory, resolveOperationalSettings } from "../server/operationalObservability.js";
import { loadProjectEnv, mysqlConfigFromEnv } from "./operational-cli-core.mjs";

loadProjectEnv();
const apply = process.argv.includes("--apply");
const settings = resolveOperationalSettings(process.env);
const config = mysqlConfigFromEnv();
const pool = mysql.createPool(config);
const execute = async (sql, params = []) => (await pool.execute(sql, params))[0];
const scalar = async (sql, params = []) => Number((await pool.execute(sql, params))[0]?.[0]?.total || 0);
const before = (days) => new Date(Date.now() - days * 86400000).toISOString();

try {
  const candidates = {
    auditLog: await scalar("SELECT COUNT(*) AS total FROM audit_log WHERE created_at != '' AND created_at < ?", [before(settings.auditRetentionDays)]),
    integrationEvents: await scalar("SELECT COUNT(*) AS total FROM integration_events WHERE status = 'completed' AND updated_at != '' AND updated_at < ?", [before(settings.integrationRetentionDays)]),
    mutationReceipts: await scalar("SELECT COUNT(*) AS total FROM mutation_receipts WHERE status = 'completed' AND updated_at != '' AND updated_at < ?", [before(settings.mutationReceiptRetentionDays)]),
    healthSnapshots: await scalar("SELECT COUNT(*) AS total FROM operational_health_snapshots WHERE captured_at < ?", [new Date(Date.now() - settings.snapshotRetentionDays * 86400000)]).catch(() => 0),
  };
  if (!apply) {
    console.log(JSON.stringify({ ok: true, dryRun: true, candidates, settings, next: "Use npm run ops:maintenance -- --apply para aplicar um lote limitado." }, null, 2));
  } else {
    const result = await cleanupOperationalHistory({ execute, settings });
    console.log(JSON.stringify({ ok: true, dryRun: false, candidatesBefore: candidates, result }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code || "OPS_MAINTENANCE_FAILED", message: error?.message || "Falha na manutenção" }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
