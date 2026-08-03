import test from "node:test";
import assert from "node:assert/strict";
import { createHotColdLeadService, resolveHotColdSettings, HOT_COLD_JOB_TYPES } from "./hotColdLeads.js";

test("fase 5 usa limite de 30 mil e batches conservadores por padrão", () => {
  const settings = resolveHotColdSettings({});
  assert.equal(settings.hotLimit, 30000);
  assert.equal(settings.batchSize, 250);
  assert.equal(settings.autoArchive, true);
  assert.equal(settings.allowAssignedClosed, false);
});

test("stats do arquivo são lidas da tabela pequena sem COUNT quando já existem", async () => {
  const seen = [];
  const service = createHotColdLeadService({
    queryRows: async (sql) => {
      seen.push(sql);
      if (sql.includes("crm_statistics")) return [
        { metric_key: "active_leads", metric_value: 30000, updated_at: new Date() },
        { metric_key: "archived_leads", metric_value: 100000, updated_at: new Date() },
        { metric_key: "archive_protected_overflow", metric_value: 0, updated_at: new Date() },
      ];
      if (sql.includes("ORDER BY archived_at")) return [{ archived_at: new Date("2026-07-29T12:00:00Z") }];
      return [];
    },
    execute: async () => ({ affectedRows: 1 }),
    scalar: async () => 0,
    withTransaction: async (fn) => fn({}),
    enqueuePersistentJob: async () => ({ job: { id: "job-1" } }),
    publicJob: (job) => job,
    requirePermission: () => undefined,
    readRequestBody: async () => ({}),
    sendJson: () => undefined,
    jobArtifactSettings: { storageRoot: "/tmp", artifactTtlHours: 1 },
    databaseName: "crm_test",
  });
  const stats = await service.getStats();
  assert.equal(stats.activeLeads, 30000);
  assert.equal(stats.archivedLeads, 100000);
  assert.equal(stats.overflow, 0);
  assert.equal(seen.some((sql) => /COUNT\(\*\).*leads/i.test(sql)), false);
});

test("auto archive só enfileira quando a base quente ultrapassa o limite", async () => {
  const queued = [];
  const baseDeps = {
    execute: async () => ({ affectedRows: 1 }), scalar: async () => 0,
    withTransaction: async (fn) => fn({}), publicJob: (job) => job,
    requirePermission: () => undefined, readRequestBody: async () => ({}), sendJson: () => undefined,
    jobArtifactSettings: { storageRoot: "/tmp", artifactTtlHours: 1 }, databaseName: "crm_test",
    enqueuePersistentJob: async (payload) => { queued.push(payload); return { job: { id: "job-1", type: payload.type } }; },
  };
  const queryRows = async (sql) => {
    if (sql.includes("crm_statistics")) return [
      { metric_key: "active_leads", metric_value: 45000, updated_at: new Date() },
      { metric_key: "archived_leads", metric_value: 85000, updated_at: new Date() },
    ];
    if (sql.includes("ORDER BY archived_at")) return [];
    return [];
  };
  const service = createHotColdLeadService({ ...baseDeps, queryRows });
  await service.queueAutoArchive({ id: "system", name: "Sistema" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, HOT_COLD_JOB_TYPES.ARCHIVE);
  assert.equal(queued[0].dedupeKey, "hot-cold:auto-archive");
});
