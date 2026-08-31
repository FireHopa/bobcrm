import test from "node:test";
import assert from "node:assert/strict";
import { buildRoleReadiness, findMissingWorkerTables, getProcessRoleCapabilities, normalizeProcessRole, PROCESS_ROLES } from "./runtimeRole.js";

test("PROCESS_ROLE preserva modo combinado e separa API/worker", () => {
  assert.equal(normalizeProcessRole("API"), PROCESS_ROLES.API);
  assert.equal(normalizeProcessRole("worker"), PROCESS_ROLES.WORKER);
  assert.equal(normalizeProcessRole("invalido"), PROCESS_ROLES.COMBINED);
  assert.deepEqual(getProcessRoleCapabilities(PROCESS_ROLES.API), { role: "api", runsHttpServer: true, runsJobWorker: false, managesSchema: true });
  assert.deepEqual(getProcessRoleCapabilities(PROCESS_ROLES.WORKER), { role: "worker", runsHttpServer: false, runsJobWorker: true, managesSchema: false });
});

test("worker exige schema mínimo e readiness da API exige heartbeat externo fresco", () => {
  assert.deepEqual(findMissingWorkerTables([{ table_name: "async_jobs" }, { table_name: "leads" }, { table_name: "users" }]), ["backups"]);
  assert.deepEqual(buildRoleReadiness({ database: true, localWorkerRunning: false, externalWorkerReady: true, capabilities: getProcessRoleCapabilities("api") }), {
    ok: true, reason: "ready", worker: true, workerMode: "external",
  });
  assert.deepEqual(buildRoleReadiness({ database: true, localWorkerRunning: false, externalWorkerReady: false, capabilities: getProcessRoleCapabilities("api") }), {
    ok: false, reason: "worker_not_ready", worker: false, workerMode: "external",
  });
  assert.equal(buildRoleReadiness({ database: true, localWorkerRunning: false, capabilities: getProcessRoleCapabilities("worker") }).ok, false);
});
