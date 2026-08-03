export const HEAVY_JOB_TYPES = Object.freeze(new Set([
  "backup_mysql",
  "import_leads",
  "rebuild_search_index",
  "archive_cold_leads",
  "export_archived_leads_csv",
]));

export function createHeavyJobSerialExecutor({ heavyTypes = HEAVY_JOB_TYPES } = {}) {
  let tail = Promise.resolve();

  return async function run(job, operation) {
    if (!heavyTypes.has(String(job?.type || ""))) return operation();

    let release;
    const previous = tail.catch(() => undefined);
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  };
}
