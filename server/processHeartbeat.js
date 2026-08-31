function parseDate(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function writeProcessHeartbeat({ execute, role, instanceId, metadata = {}, now = new Date() }) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedRole) throw new Error("Role do heartbeat não informado.");
  const normalizedInstanceId = String(instanceId || "").trim().slice(0, 64);
  await execute(`INSERT INTO runtime_process_heartbeats (role,instance_id,heartbeat_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE instance_id=VALUES(instance_id),heartbeat_at=VALUES(heartbeat_at),metadata_json=VALUES(metadata_json),updated_at=VALUES(updated_at)`, [
    normalizedRole,
    normalizedInstanceId,
    now,
    JSON.stringify(metadata || {}),
    now,
    now,
  ]);
  return { role: normalizedRole, instanceId: normalizedInstanceId, heartbeatAt: now.toISOString() };
}

export async function readProcessHeartbeat({ queryRows, role, ttlMs = 30_000, now = Date.now() }) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const rows = await queryRows("SELECT role,instance_id,heartbeat_at,metadata_json FROM runtime_process_heartbeats WHERE role=? LIMIT 1", [normalizedRole]);
  const row = rows[0] || null;
  if (!row) return { role: normalizedRole, present: false, fresh: false, ageMs: null, instanceId: "", heartbeatAt: "", metadata: {} };
  const heartbeatMs = parseDate(row.heartbeat_at);
  const ageMs = heartbeatMs ? Math.max(0, Number(now) - heartbeatMs) : Number.POSITIVE_INFINITY;
  let metadata = {};
  try { metadata = typeof row.metadata_json === "object" && row.metadata_json !== null ? row.metadata_json : JSON.parse(String(row.metadata_json || "{}")); } catch { metadata = {}; }
  return {
    role: normalizedRole,
    present: true,
    fresh: Number.isFinite(ageMs) && ageMs <= Math.max(1000, Number(ttlMs || 30_000)),
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    instanceId: String(row.instance_id || ""),
    heartbeatAt: heartbeatMs ? new Date(heartbeatMs).toISOString() : "",
    metadata,
  };
}

export function createProcessHeartbeatRuntime({ execute, role, instanceId, intervalMs = 10_000, getMetadata = () => ({}) }) {
  const safeIntervalMs = Math.max(1000, Number(intervalMs || 10_000));
  let timer = null;
  let running = false;
  const beat = async () => {
    if (running) return null;
    running = true;
    try {
      return await writeProcessHeartbeat({ execute, role, instanceId, metadata: getMetadata() });
    } finally {
      running = false;
    }
  };
  return {
    async start() {
      if (timer) return;
      timer = setInterval(() => { void beat().catch((error) => console.warn("Falha ao gravar heartbeat do processo:", error.message)); }, safeIntervalMs);
      timer.unref?.();
      return beat();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    beat,
  };
}
