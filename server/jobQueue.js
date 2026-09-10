import { randomUUID } from "node:crypto";

export const JOB_STATUSES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
});

export const JOB_TYPES = Object.freeze({
  BACKUP: "backup_mysql",
  IMPORT_LEADS: "import_leads",
  EXPORT_LEADS_CSV: "export_leads_csv",
  EXPORT_LEADS_XLSX: "export_leads_xlsx",
  REBUILD_SEARCH_INDEX: "rebuild_search_index",
  ARCHIVE_COLD_LEADS: "archive_cold_leads",
  EXPORT_ARCHIVED_LEADS_CSV: "export_archived_leads_csv",
  IMPORT_ACTIVE_CAMPAIGN_NOTES: "import_activecampaign_notes",
});

function nowIso(now = new Date()) {
  return now.toISOString();
}

function futureIso(delayMs, now = Date.now()) {
  return new Date(now + Math.max(0, Number(delayMs || 0))).toISOString();
}

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function rowToJob(row = {}) {
  return {
    id: String(row.id || ""),
    type: String(row.type || ""),
    status: String(row.status || JOB_STATUSES.QUEUED),
    payload: parseJson(row.payload_json, {}),
    result: parseJson(row.result_json, {}),
    progressCurrent: Number(row.progress_current || 0),
    progressTotal: Number(row.progress_total || 0),
    progressMessage: String(row.progress_message || ""),
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 1),
    runAfter: String(row.run_after || ""),
    lockedBy: String(row.locked_by || ""),
    lockedAt: String(row.locked_at || ""),
    heartbeatAt: String(row.heartbeat_at || ""),
    createdBy: String(row.created_by || ""),
    createdByName: String(row.created_by_name || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    startedAt: String(row.started_at || ""),
    completedAt: String(row.completed_at || ""),
    failedAt: String(row.failed_at || ""),
    expiresAt: String(row.expires_at || ""),
    payloadStorageKey: String(row.payload_storage_key || ""),
    artifactStorageKey: String(row.artifact_storage_key || ""),
    artifactFileName: String(row.artifact_file_name || ""),
    artifactContentType: String(row.artifact_content_type || ""),
    artifactSizeBytes: Number(row.artifact_size_bytes || 0),
    artifactSha256: String(row.artifact_sha256 || ""),
    errorCode: String(row.error_code || ""),
    errorMessage: String(row.error_message || ""),
    dedupeKey: String(row.dedupe_key || ""),
  };
}

export async function enqueueJob({
  execute,
  queryRows,
  type,
  payload = {},
  payloadStorageKey = "",
  actor = {},
  dedupeKey = "",
  maxAttempts = 3,
  runAfter = "",
  expiresAt = "",
  id = randomUUID(),
  now = new Date(),
}) {
  const at = nowIso(now);
  const normalizedDedupeKey = String(dedupeKey || "").trim();

  if (normalizedDedupeKey) {
    const existing = await queryRows(
      `SELECT * FROM async_jobs
       WHERE dedupe_key = ? AND status IN ('queued', 'running')
       ORDER BY created_at ASC LIMIT 1`,
      [normalizedDedupeKey],
    );
    if (existing[0]) return { job: rowToJob(existing[0]), created: false };
  }

  try {
    await execute(
      `INSERT INTO async_jobs (
        id, type, status, payload_json, result_json, progress_current, progress_total,
        progress_message, attempts, max_attempts, run_after, locked_by, locked_at,
        heartbeat_at, created_by, created_by_name, created_at, updated_at, started_at,
        completed_at, failed_at, expires_at, payload_storage_key, artifact_storage_key,
        artifact_file_name, artifact_content_type, artifact_size_bytes, artifact_sha256,
        error_code, error_message, dedupe_key
      ) VALUES (?, ?, 'queued', ?, NULL, 0, 0, '', 0, ?, ?, '', '', '', ?, ?, ?, ?, '', '', '', ?, ?, '', '', '', 0, '', '', '', ?)`,
      [
        id,
        type,
        JSON.stringify(payload || {}),
        Math.max(1, Number(maxAttempts || 1)),
        runAfter || at,
        String(actor.id || ""),
        String(actor.name || actor.email || ""),
        at,
        at,
        expiresAt || "",
        payloadStorageKey || "",
        normalizedDedupeKey || null,
      ],
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY" || !normalizedDedupeKey) throw error;
    const existing = await queryRows(
      `SELECT * FROM async_jobs
       WHERE dedupe_key = ? AND status IN ('queued', 'running')
       ORDER BY created_at ASC LIMIT 1`,
      [normalizedDedupeKey],
    );
    if (existing[0]) return { job: rowToJob(existing[0]), created: false };
    throw error;
  }

  const rows = await queryRows("SELECT * FROM async_jobs WHERE id = ? LIMIT 1", [id]);
  return { job: rowToJob(rows[0] || { id, type, status: "queued", created_at: at, updated_at: at }), created: true };
}

export async function claimNextJob({ execute, queryRows, workerId, allowedTypes, now = new Date() }) {
  const types = Array.from(new Set((allowedTypes || []).filter(Boolean)));
  if (!types.length) return null;
  const claimToken = `${workerId}:${randomUUID()}`;
  const at = nowIso(now);
  const placeholders = types.map(() => "?").join(", ");

  const result = await execute(
    `UPDATE async_jobs
     SET status = 'running', locked_by = ?, locked_at = ?, heartbeat_at = ?,
         started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END,
         attempts = attempts + 1, updated_at = ?, error_code = '', error_message = ''
     WHERE status = 'queued'
       AND (run_after = '' OR run_after <= ?)
       AND attempts < max_attempts
       AND type IN (${placeholders})
     ORDER BY created_at ASC
     LIMIT 1`,
    [claimToken, at, at, at, at, at, ...types],
  );

  if (!Number(result?.affectedRows || 0)) return null;
  const rows = await queryRows("SELECT * FROM async_jobs WHERE locked_by = ? AND status = 'running' LIMIT 1", [claimToken]);
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function heartbeatJob({ execute, jobId, lockToken, now = new Date() }) {
  return execute(
    `UPDATE async_jobs SET heartbeat_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [nowIso(now), nowIso(now), jobId, lockToken],
  );
}

export async function requestJobCancellation({ execute, queryRows, jobId, requestedBy = "", now = new Date() }) {
  const rows = await queryRows("SELECT * FROM async_jobs WHERE id = ? LIMIT 1", [jobId]);
  if (!rows[0]) return null;

  const current = rowToJob(rows[0]);
  if ([JOB_STATUSES.COMPLETED, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELED].includes(current.status)) {
    return current;
  }

  const at = nowIso(now);
  const result = {
    ...(current.result || {}),
    cancellationRequested: true,
    cancellationRequestedAt: at,
    cancellationRequestedBy: String(requestedBy || ""),
  };

  if (current.status === JOB_STATUSES.QUEUED) {
    await execute(
      `UPDATE async_jobs
       SET status = 'canceled', result_json = ?, progress_message = 'Cancelado pelo usuário',
           updated_at = ?, heartbeat_at = ?, locked_by = '', locked_at = '', dedupe_key = NULL,
           error_code = 'JOB_CANCELED_BY_USER', error_message = 'Importação cancelada pelo usuário.'
       WHERE id = ? AND status = 'queued'`,
      [JSON.stringify(result), at, at, jobId],
    );
  } else if (current.status === JOB_STATUSES.RUNNING) {
    await execute(
      `UPDATE async_jobs
       SET result_json = ?, progress_message = 'Cancelamento solicitado. Finalizando a etapa atual...',
           error_code = 'JOB_CANCEL_REQUESTED', error_message = '', updated_at = ?
       WHERE id = ? AND status = 'running'`,
      [JSON.stringify(result), at, jobId],
    );
  }

  const updated = await queryRows("SELECT * FROM async_jobs WHERE id = ? LIMIT 1", [jobId]);
  return updated[0] ? rowToJob(updated[0]) : current;
}

export async function isJobCancellationRequested({ queryRows, jobId, lockToken = "" }) {
  const rows = await queryRows(
    "SELECT status, result_json, locked_by, error_code FROM async_jobs WHERE id = ? LIMIT 1",
    [jobId],
  );
  const row = rows[0];
  if (!row) return true;
  if (String(row.status || "") === JOB_STATUSES.CANCELED) return true;
  if (String(row.status || "") !== JOB_STATUSES.RUNNING) return true;
  if (lockToken && String(row.locked_by || "") !== String(lockToken)) return true;
  if (String(row.error_code || "") === "JOB_CANCEL_REQUESTED") return true;
  const result = parseJson(row.result_json, {});
  return result?.cancellationRequested === true;
}

export async function finalizeCanceledJob({ execute, queryRows, jobId, lockToken, message = "Importação cancelada pelo usuário.", now = new Date() }) {
  const rows = await queryRows("SELECT result_json FROM async_jobs WHERE id = ? LIMIT 1", [jobId]);
  const existingResult = parseJson(rows[0]?.result_json, {});
  const at = nowIso(now);
  const result = {
    ...(existingResult || {}),
    cancellationRequested: true,
    canceledAt: at,
  };

  await execute(
    `UPDATE async_jobs
     SET status = 'canceled', result_json = ?, progress_message = 'Cancelado pelo usuário',
         updated_at = ?, heartbeat_at = ?, locked_by = '', locked_at = '', dedupe_key = NULL,
         error_code = 'JOB_CANCELED_BY_USER', error_message = ?
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [JSON.stringify(result), at, at, String(message || "Importação cancelada pelo usuário.").slice(0, 1000), jobId, lockToken],
  );
}

export async function updateJobProgress({ execute, jobId, lockToken, current = 0, total = 0, message = "", data, now = new Date() }) {
  const progressCurrent = Math.max(0, Number(current || 0));
  const progressTotal = Math.max(0, Number(total || 0));
  const progressMessage = String(message || "").slice(0, 255);
  const at = nowIso(now);

  if (data === undefined) {
    return execute(
      `UPDATE async_jobs
       SET progress_current = ?, progress_total = ?, progress_message = ?, heartbeat_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
      [progressCurrent, progressTotal, progressMessage, at, at, jobId, lockToken],
    );
  }

  return execute(
    `UPDATE async_jobs
     SET progress_current = ?, progress_total = ?, progress_message = ?, result_json = ?, heartbeat_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [progressCurrent, progressTotal, progressMessage, JSON.stringify({ progress: data || {} }), at, at, jobId, lockToken],
  );
}

export async function completeJob({
  execute,
  jobId,
  lockToken,
  result = {},
  artifact = {},
  expiresAt = "",
  now = new Date(),
}) {
  const at = nowIso(now);
  const update = await execute(
    `UPDATE async_jobs
     SET status = 'completed', result_json = ?, progress_message = 'Concluído',
         completed_at = ?, updated_at = ?, heartbeat_at = ?, locked_by = '', locked_at = '',
         dedupe_key = NULL, artifact_storage_key = ?, artifact_file_name = ?,
         artifact_content_type = ?, artifact_size_bytes = ?, artifact_sha256 = ?,
         expires_at = ?, error_code = '', error_message = ''
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [
      JSON.stringify(result || {}),
      at,
      at,
      at,
      String(artifact.storageKey || ""),
      String(artifact.fileName || ""),
      String(artifact.contentType || ""),
      Math.max(0, Number(artifact.sizeBytes || 0)),
      String(artifact.sha256 || ""),
      expiresAt || "",
      jobId,
      lockToken,
    ],
  );
  if (!Number(update?.affectedRows || 0)) {
    const error = new Error("O job perdeu o lock antes de concluir.");
    error.code = "JOB_LOCK_LOST";
    throw error;
  }
}

export async function failJob({
  execute,
  job,
  error,
  retry = false,
  retryDelayMs = 0,
  now = new Date(),
}) {
  const at = nowIso(now);
  const canRetry = retry && Number(job.attempts || 0) < Number(job.maxAttempts || 1);
  const status = canRetry ? JOB_STATUSES.QUEUED : JOB_STATUSES.FAILED;
  const runAfter = canRetry ? futureIso(retryDelayMs, now.getTime()) : job.runAfter || "";
  const message = String(error?.message || "Falha não identificada").slice(0, 1000);
  const code = String(error?.code || error?.name || "JOB_FAILED").slice(0, 80);

  await execute(
    `UPDATE async_jobs
     SET status = ?, run_after = ?, failed_at = ?, updated_at = ?, heartbeat_at = ?,
         locked_by = '', locked_at = '', dedupe_key = CASE WHEN ? = 'queued' THEN dedupe_key ELSE NULL END,
         error_code = ?, error_message = ?, progress_message = ?
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [status, runAfter, canRetry ? "" : at, at, at, status, code, message, canRetry ? "Nova tentativa agendada" : "Falhou", job.id, job.lockedBy],
  );

  return { status, runAfter, canRetry };
}

export async function recoverStaleJobs({ execute, staleBefore, now = new Date() }) {
  const at = nowIso(now);
  const recovered = await execute(
    `UPDATE async_jobs
     SET status = 'queued', run_after = ?, locked_by = '', locked_at = '', heartbeat_at = '',
         updated_at = ?, progress_message = 'Recuperado após interrupção do worker',
         error_code = 'JOB_WORKER_INTERRUPTED', error_message = 'O worker anterior deixou de atualizar o heartbeat.'
     WHERE status = 'running' AND heartbeat_at != '' AND heartbeat_at < ? AND attempts < max_attempts`,
    [at, at, staleBefore],
  );
  const failed = await execute(
    `UPDATE async_jobs
     SET status = 'failed', failed_at = ?, updated_at = ?, locked_by = '', locked_at = '',
         dedupe_key = NULL, progress_message = 'Falhou após interrupções repetidas',
         error_code = 'JOB_RETRY_EXHAUSTED', error_message = 'O limite de tentativas foi atingido após interrupção do worker.'
     WHERE status = 'running' AND heartbeat_at != '' AND heartbeat_at < ? AND attempts >= max_attempts`,
    [at, at, staleBefore],
  );
  return { recovered: Number(recovered?.affectedRows || 0), failed: Number(failed?.affectedRows || 0) };
}

export async function listExpiredJobs({ queryRows, now = new Date(), limit = 100 }) {
  return queryRows(
    `SELECT * FROM async_jobs
     WHERE status IN ('completed', 'failed', 'canceled') AND expires_at != '' AND expires_at < ?
     ORDER BY expires_at ASC LIMIT ?`,
    [nowIso(now), Math.max(1, Math.min(1000, Number(limit || 100)))],
  );
}

export async function deleteExpiredJob({ execute, jobId }) {
  return execute(
    "DELETE FROM async_jobs WHERE id = ? AND status IN ('completed', 'failed', 'canceled')",
    [jobId],
  );
}

function waitForPromises(promises, timeoutMs) {
  if (!promises.length) return Promise.resolve(true);
  return Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export function createJobWorker({
  workerId = `worker-${process.pid}-${randomUUID()}`,
  handlers,
  claim,
  complete,
  fail,
  cancel,
  heartbeat,
  concurrency = 2,
  pollIntervalMs = 750,
  heartbeatIntervalMs = 10000,
  shouldRetry = () => false,
  retryDelay = (attempts) => Math.min(30000, 500 * (2 ** Math.max(0, attempts - 1))),
  onError = (error) => console.error("Falha no worker de jobs", error),
  unrefTimers = true,
}) {
  const active = new Set();
  let running = false;
  let timer = null;
  let tickRunning = false;

  const schedule = (delay = pollIntervalMs) => {
    if (!running || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delay);
    if (unrefTimers) timer.unref?.();
  };

  const processJob = (job) => {
    const handler = handlers[job.type];
    const task = (async () => {
      const heartbeatTimer = setInterval(() => {
        heartbeat(job).catch((error) => {
          if (running) onError(error);
        });
      }, heartbeatIntervalMs);
      if (unrefTimers) heartbeatTimer.unref?.();

      try {
        if (!handler) {
          const error = new Error(`Tipo de job sem handler: ${job.type}`);
          error.code = "JOB_HANDLER_NOT_FOUND";
          throw error;
        }
        const outcome = await handler(job);
        await complete(job, outcome || {});
      } catch (error) {
        if (error?.code === "JOB_CANCELED" && cancel) {
          await cancel(job, error).catch(onError);
        } else {
          await fail(job, error, {
            retry: shouldRetry(error, job),
            retryDelayMs: retryDelay(job.attempts),
          }).catch(onError);
        }
      } finally {
        clearInterval(heartbeatTimer);
      }
    })();

    active.add(task);
    task.finally(() => {
      active.delete(task);
      if (running) schedule(0);
    });
  };

  const tick = async () => {
    if (!running || tickRunning) return;
    tickRunning = true;
    try {
      while (running && active.size < Math.max(1, concurrency)) {
        const job = await claim(workerId);
        if (!job) break;
        processJob(job);
      }
    } catch (error) {
      if (running) onError(error);
    } finally {
      tickRunning = false;
      if (running) schedule();
    }
  };

  return {
    workerId,
    start() {
      if (running) return;
      running = true;
      schedule(0);
    },
    wake() {
      if (!running) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule(0);
    },
    async stop({ timeoutMs = 30000 } = {}) {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      return waitForPromises([...active], timeoutMs);
    },
    get isRunning() {
      return running;
    },
    get activeCount() {
      return active.size;
    },
  };
}
