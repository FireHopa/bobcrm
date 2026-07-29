import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema.mysql.sql", import.meta.url), "utf8");
const envSource = readFileSync(new URL("./.env.example", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("phase 4 is wired into migrations, runtime, shutdown and admin diagnostics", () => {
  assert.match(indexSource, /20260727_16_observability_maintenance_phase4/);
  assert.match(indexSource, /createOperationalRuntime/);
  assert.match(indexSource, /operationalRuntime\.start/);
  assert.match(indexSource, /operationalRuntime\?\.stop/);
  assert.match(indexSource, /\/api\/admin\/observability/);
  assert.match(indexSource, /requirePermission\(currentUser, "read_audit"\)/);
});

test("phase 4 persists bounded health history in schema", () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS operational_health_snapshots/);
  assert.match(schemaSource, /idx_ops_health_captured/);
  assert.match(schemaSource, /idx_ops_health_role_captured/);
});

test("phase 4 exposes explicit operational thresholds and safe retention configuration", () => {
  for (const key of [
    "PERF_ALERT_SQL_MS",
    "PERF_ALERT_REQUEST_MS",
    "PERF_ALERT_POOL_UTIL_PCT",
    "OPS_SNAPSHOT_INTERVAL_MS",
    "OPS_AUDIT_RETENTION_DAYS",
    "OPS_INTEGRATION_RETENTION_DAYS",
    "OPS_MUTATION_RECEIPT_RETENTION_DAYS",
  ]) assert.match(envSource, new RegExp(`^${key}=`, "m"));
});

test("phase 4 ships operational check and maintenance commands", () => {
  assert.equal(packageJson.scripts["ops:check"], "node scripts/operational-health.mjs");
  assert.equal(packageJson.scripts["ops:maintenance"], "node scripts/operational-maintenance.mjs");
  assert.match(packageJson.scripts["test:phase4-observability"], /phase4ObservabilityMaintenance20260727\.test\.js/);
});

test("main backend stays within the architectural line limit", () => {
  assert.ok(indexSource.split(/\r?\n/).length <= 5600);
});
