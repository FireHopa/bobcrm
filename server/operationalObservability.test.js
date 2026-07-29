import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalDatabaseSnapshot, cleanupOperationalHistory, resolveOperationalSettings } from "./operationalObservability.js";

test("operational snapshot aggregates table sizes, job status and stale jobs", async () => {
  let call = 0;
  const snapshot = await buildOperationalDatabaseSnapshot({
    databaseName: "crm",
    now: new Date("2026-07-27T18:00:00.000Z"),
    staleJobMs: 300000,
    queryRows: async () => {
      call += 1;
      if (call === 1) return [{ table_name: "leads", table_rows: 140000, data_bytes: 104857600, index_bytes: 52428800 }];
      if (call === 2) return [{ status: "queued", total: 2 }, { status: "running", total: 1 }];
      if (call === 3) return [{ total: 1 }];
      return [{ failed: 3, processing: 1 }];
    },
  });
  assert.equal(snapshot.tables[0].table, "leads");
  assert.equal(snapshot.tables[0].totalMb, 150);
  assert.equal(snapshot.jobs.queued, 2);
  assert.equal(snapshot.staleRunningJobs, 1);
  assert.equal(snapshot.integrations.failed, 3);
});

test("maintenance deletes only bounded batches using conservative retention", async () => {
  const calls = [];
  const settings = resolveOperationalSettings({ OPS_CLEANUP_BATCH_SIZE: "500" });
  const result = await cleanupOperationalHistory({
    settings,
    now: new Date("2026-07-27T18:00:00.000Z"),
    execute: async (sql, params) => { calls.push({ sql, params }); return { affectedRows: 7 }; },
  });
  assert.equal(result.deleted.auditLog, 7);
  assert.equal(result.deleted.healthSnapshots, 7);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.params.at(-1) === 500));
  assert.match(calls[0].sql, /DELETE FROM audit_log/);
});
