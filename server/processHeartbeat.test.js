import test from "node:test";
import assert from "node:assert/strict";
import { readProcessHeartbeat, writeProcessHeartbeat } from "./processHeartbeat.js";

test("heartbeat do processo grava UPSERT com role e metadados", async () => {
  const calls = [];
  const now = new Date("2026-08-27T15:00:00.000Z");
  const result = await writeProcessHeartbeat({
    execute: async (sql, params) => { calls.push({ sql, params }); },
    role: "worker",
    instanceId: "worker-1",
    metadata: { activeJobs: 2 },
    now,
  });
  assert.equal(result.role, "worker");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[0].params[0], "worker");
  assert.equal(calls[0].params[1], "worker-1");
});

test("heartbeat externo fica stale após TTL", async () => {
  const queryRows = async () => [{ role: "worker", instance_id: "worker-1", heartbeat_at: "2026-08-27T14:59:20.000Z", metadata_json: '{"activeJobs":0}' }];
  const heartbeat = await readProcessHeartbeat({ queryRows, role: "worker", ttlMs: 30_000, now: Date.parse("2026-08-27T15:00:00.000Z") });
  assert.equal(heartbeat.present, true);
  assert.equal(heartbeat.fresh, false);
  assert.equal(heartbeat.ageMs, 40_000);
  assert.deepEqual(heartbeat.metadata, { activeJobs: 0 });
});
