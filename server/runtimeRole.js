export const PROCESS_ROLES = Object.freeze({ COMBINED: "combined", API: "api", WORKER: "worker" });
export const REQUIRED_WORKER_TABLES = Object.freeze(["async_jobs", "leads", "users", "backups"]);

export function normalizeProcessRole(value, fallback = PROCESS_ROLES.COMBINED) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(PROCESS_ROLES).includes(normalized) ? normalized : fallback;
}

export function getProcessRoleCapabilities(role) {
  const normalized = normalizeProcessRole(role);
  return {
    role: normalized,
    runsHttpServer: normalized !== PROCESS_ROLES.WORKER,
    runsJobWorker: normalized !== PROCESS_ROLES.API,
    managesSchema: normalized !== PROCESS_ROLES.WORKER,
  };
}

export function findMissingWorkerTables(rows = []) {
  const existing = new Set(rows.map((row) => String(row.table_name || row.TABLE_NAME || "")));
  return REQUIRED_WORKER_TABLES.filter((table) => !existing.has(table));
}

export function buildRoleReadiness({ database, localWorkerRunning, externalWorkerReady, capabilities }) {
  const localWorkerRequired = Boolean(capabilities?.runsJobWorker);
  const workerMode = localWorkerRequired ? "local" : "external";
  const worker = localWorkerRequired ? Boolean(localWorkerRunning) : Boolean(externalWorkerReady);
  const workerReady = Boolean(worker);
  return {
    ok: Boolean(database) && workerReady,
    reason: database ? (workerReady ? "ready" : "worker_not_ready") : "database_not_ready",
    worker,
    workerMode,
  };
}
