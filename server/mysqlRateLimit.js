import { createHash } from "node:crypto";

export function createRateLimitBucket(namespace, identity) {
  const digest = createHash("sha256").update(String(identity || "unknown"), "utf8").digest("hex");
  return `${String(namespace || "request").slice(0, 40)}:${digest}`;
}

export function calculateRateLimitDecision({ count, resetAt, limit, now = Date.now() }) {
  const normalizedCount = Math.max(0, Number(count || 0));
  const normalizedResetAt = Math.max(now, Number(resetAt || now));
  return {
    allowed: normalizedCount <= limit,
    count: normalizedCount,
    remaining: Math.max(0, limit - normalizedCount),
    resetAt: normalizedResetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((normalizedResetAt - now) / 1000)),
  };
}

export async function consumeMysqlRateLimit({
  execute,
  statementFirstRow,
  bucketKey,
  limit,
  windowMs,
  now = Date.now(),
}) {
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const normalizedWindowMs = Math.max(1000, Math.floor(Number(windowMs) || 1000));
  const resetAt = now + normalizedWindowMs;
  const expiresAt = resetAt + normalizedWindowMs;

  await execute(
    `INSERT INTO rate_limits (bucket_key, request_count, reset_at, expires_at, updated_at)
     VALUES (?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       request_count = IF(reset_at <= ?, 1, request_count + 1),
       expires_at = IF(reset_at <= ?, ?, expires_at),
       reset_at = IF(reset_at <= ?, ?, reset_at),
       updated_at = ?`,
    [bucketKey, resetAt, expiresAt, now, now, now, expiresAt, now, resetAt, now],
  );

  const row = await statementFirstRow(
    "SELECT request_count, reset_at FROM rate_limits WHERE bucket_key = ? LIMIT 1",
    [bucketKey],
  );

  return calculateRateLimitDecision({
    count: row?.request_count,
    resetAt: row?.reset_at,
    limit: normalizedLimit,
    now,
  });
}

export async function cleanupExpiredRateLimits({ execute, now = Date.now(), batchSize = 10000 }) {
  const normalizedBatchSize = Math.min(50000, Math.max(100, Math.floor(Number(batchSize) || 10000)));
  const result = await execute(
    `DELETE FROM rate_limits WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ${normalizedBatchSize}`,
    [now],
  );
  return Number(result?.affectedRows || 0);
}

export function createRateLimitError(message, decision) {
  const error = new Error(message);
  error.statusCode = 429;
  error.code = "RATE_LIMIT_EXCEEDED";
  error.retryAfterSeconds = decision.retryAfterSeconds;
  return error;
}
