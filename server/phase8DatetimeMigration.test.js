import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLeadDashboardSummarySql } from "./dashboardSummarySql.js";
import { buildLeadSummarySql } from "./leadSummarySql.js";
import { getTaskBucketWhere } from "./taskPolicy.js";
import { buildTodayTemporalSql } from "./todayTemporalSql.js";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema.mysql.sql", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("resumos deixam de aplicar função LEFT na coluna temporal após readiness", () => {
  const leadSql = buildLeadSummarySql({ useDateColumns: true });
  const dashboardSql = buildLeadDashboardSummarySql({ alias: "l", activeWhere: "l.deleted_at = ''", useDateColumns: true });
  assert.match(leadSql, /next_contact_at_dt < DATE_ADD/);
  assert.doesNotMatch(leadSql, /LEFT\(next_contact_at/);
  assert.match(dashboardSql, /l\.next_contact_at_dt/);
  assert.doesNotMatch(dashboardSql, /LEFT\(l\.next_contact_at/);
});

test("filtros de tarefa usam range DATETIME indexável após readiness", () => {
  const today = getTaskBucketWhere("today", "t", { useDateColumns: true });
  const overdue = getTaskBucketWhere("overdue", "t", { useDateColumns: true });
  const upcoming = getTaskBucketWhere("upcoming", "t", { useDateColumns: true });
  assert.match(today, /t\.due_at_dt >= CURDATE\(\)/);
  assert.match(today, /t\.due_at_dt < DATE_ADD/);
  assert.equal(overdue, "t.status = 'pending' AND t.due_at_dt < CURDATE()");
  assert.match(upcoming, /t\.due_at_dt >= DATE_ADD/);
  assert.doesNotMatch(`${today} ${overdue} ${upcoming}`, /LEFT\(/);
});

test("dashboard de hoje remove LEFT das comparações críticas quando DATETIME está ativo", () => {
  const temporal = buildTodayTemporalSql(true);
  const sql = `${temporal.buildTaskCountSql("1 = 1")} ${temporal.buildOperationalSql("1 = 1")} ${temporal.teamOverdueSql}`;
  assert.match(sql, /due_at_dt/);
  assert.match(sql, /updated_at_dt/);
  assert.match(sql, /completed_at_dt/);
  assert.doesNotMatch(sql, /LEFT\(/);
});

test("servidor possui migration, readiness e fallback automático", () => {
  assert.match(indexSource, /20260724_10_parallel_datetime_columns/);
  assert.match(indexSource, /dateColumnRuntime\.refreshReadiness/);
  assert.match(indexSource, /useDateColumns: dateColumnRuntime\.isReady\(\)/);
  assert.match(indexSource, /getTaskBucketWhere\(bucket, "t", \{ useDateColumns \}\)/);
});

test("schema e scripts de operação incluem a transição DATETIME", () => {
  assert.match(schemaSource, /next_contact_at_dt DATETIME\(3\)/);
  assert.match(schemaSource, /due_at_dt DATETIME\(3\)/);
  assert.equal(packageJson.scripts["datetime:backfill"], "node scripts/backfill-datetime-columns.mjs");
  assert.equal(packageJson.scripts["datetime:verify"], "node scripts/backfill-datetime-columns.mjs --verify-only");
});

test("Tela Hoje consolida as três listas de tarefas em uma query ranqueada", () => {
  const temporal = buildTodayTemporalSql(true);
  const sql = temporal.buildTaskListsSql("t.responsible_user_id = ?");
  assert.match(sql, /WITH classified AS/);
  assert.match(sql, /ROW_NUMBER\(\) OVER/);
  assert.match(sql, /PARTITION BY __bucket/);
  assert.match(sql, /__row_num <= 12/);
  assert.match(sql, /t\.due_at_dt/);
});
