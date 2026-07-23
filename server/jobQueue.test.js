import test from "node:test";
import assert from "node:assert/strict";
import {
  JOB_STATUSES,
  claimNextJob,
  completeJob,
  createJobWorker,
  enqueueJob,
  failJob,
  recoverStaleJobs,
  rowToJob,
} from "./jobQueue.js";

test("rowToJob normaliza JSON, progresso e artefato", () => {
  const job = rowToJob({ id: "1", payload_json: '{"a":1}', result_json: '{"ok":true}', progress_current: "2", artifact_size_bytes: "9" });
  assert.deepEqual(job.payload, { a: 1 });
  assert.deepEqual(job.result, { ok: true });
  assert.equal(job.progressCurrent, 2);
  assert.equal(job.artifactSizeBytes, 9);
});

test("enqueue reutiliza job ativo com a mesma chave de deduplicação", async () => {
  let inserts = 0;
  const existing = { id: "existing", type: "backup_mysql", status: "running", dedupe_key: "backup" };
  const result = await enqueueJob({
    execute: async () => { inserts += 1; },
    queryRows: async (sql) => sql.includes("dedupe_key") ? [existing] : [],
    type: "backup_mysql",
    actor: { id: "u1" },
    dedupeKey: "backup",
  });
  assert.equal(result.created, false);
  assert.equal(result.job.id, "existing");
  assert.equal(inserts, 0);
});

test("claim usa update atômico por token e limita tipos conhecidos", async () => {
  const calls = [];
  const jobRow = { id: "j1", type: "import_leads", status: "running", locked_by: "token" };
  const job = await claimNextJob({
    execute: async (sql, params) => { calls.push({ sql, params }); return { affectedRows: 1 }; },
    queryRows: async () => [jobRow],
    workerId: "worker-a",
    allowedTypes: ["import_leads", "backup_mysql"],
    now: new Date("2026-07-07T12:00:00.000Z"),
  });
  assert.equal(job.id, "j1");
  assert.match(calls[0].sql, /UPDATE async_jobs/);
  assert.match(calls[0].sql, /ORDER BY created_at ASC/);
  assert.match(calls[0].sql, /LIMIT 1/);
  assert.equal(calls[0].params.slice(-2).join(","), "import_leads,backup_mysql");
});

test("complete limpa chave de deduplicação e registra artefato", async () => {
  let captured;
  await completeJob({
    execute: async (sql, params) => { captured = { sql, params }; return { affectedRows: 1 }; },
    jobId: "j1",
    lockToken: "w:1",
    result: { total: 3 },
    artifact: { storageKey: "exports/a.csv", fileName: "a.csv", contentType: "text/csv", sizeBytes: 10, sha256: "a".repeat(64) },
  });
  assert.match(captured.sql, /dedupe_key = NULL/);
  assert.match(captured.sql, /artifact_storage_key/);
  assert.equal(JSON.parse(captured.params[0]).total, 3);
});

test("falha transitória volta para fila e falha final libera dedupe", async () => {
  const updates = [];
  const job = { id: "j1", lockedBy: "w:1", attempts: 1, maxAttempts: 3, runAfter: "" };
  const retry = await failJob({
    execute: async (sql, params) => { updates.push({ sql, params }); return { affectedRows: 1 }; },
    job,
    error: Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }),
    retry: true,
    retryDelayMs: 1000,
    now: new Date("2026-07-07T12:00:00.000Z"),
  });
  assert.equal(retry.status, JOB_STATUSES.QUEUED);
  assert.equal(retry.canRetry, true);

  const failed = await failJob({
    execute: async () => ({ affectedRows: 1 }),
    job: { ...job, attempts: 3 },
    error: new Error("fim"),
    retry: true,
  });
  assert.equal(failed.status, JOB_STATUSES.FAILED);
  assert.equal(failed.canRetry, false);
});

test("recuperação distingue job órfão recuperável de tentativas esgotadas", async () => {
  const sqls = [];
  const result = await recoverStaleJobs({
    execute: async (sql) => { sqls.push(sql); return { affectedRows: sqls.length }; },
    staleBefore: "2026-07-07T11:00:00.000Z",
  });
  assert.equal(result.recovered, 1);
  assert.equal(result.failed, 2);
  assert.match(sqls[0], /attempts < max_attempts/);
  assert.match(sqls[1], /attempts >= max_attempts/);
});

test("worker respeita concorrência, conclui jobs e drena no encerramento", async () => {
  const queue = [
    { id: "1", type: "ok", attempts: 1, lockedBy: "w:1" },
    { id: "2", type: "ok", attempts: 1, lockedBy: "w:2" },
  ];
  const completed = [];
  const worker = createJobWorker({
    handlers: { ok: async (job) => ({ id: job.id }) },
    claim: async () => queue.shift() || null,
    complete: async (job, result) => completed.push([job.id, result.id]),
    fail: async () => undefined,
    heartbeat: async () => undefined,
    concurrency: 2,
    pollIntervalMs: 5,
    heartbeatIntervalMs: 5,
    onError: (error) => { throw error; },
  });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const drained = await worker.stop({ timeoutMs: 1000 });
  assert.equal(drained, true);
  assert.deepEqual(completed.sort(), [["1", "1"], ["2", "2"]]);
  assert.equal(worker.activeCount, 0);
});
