import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRateLimitDecision,
  cleanupExpiredRateLimits,
  consumeMysqlRateLimit,
  createRateLimitBucket,
  createRateLimitError,
} from "./mysqlRateLimit.js";

test("chave do rate limit não armazena IP ou e-mail em texto puro", () => {
  const bucket = createRateLimitBucket("login-ip", "198.51.100.2");
  assert.match(bucket, /^login-ip:[a-f0-9]{64}$/);
  assert.equal(bucket.includes("198.51.100.2"), false);
});

test("decisão expõe restante e Retry-After sem permitir valor negativo", () => {
  const decision = calculateRateLimitDecision({ count: 11, resetAt: 25_000, limit: 10, now: 20_000 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.remaining, 0);
  assert.equal(decision.retryAfterSeconds, 5);
  const error = createRateLimitError("bloqueado", decision);
  assert.equal(error.statusCode, 429);
  assert.equal(error.retryAfterSeconds, 5);
});

test("store MySQL usa upsert atômico e consulta o contador compartilhado", async () => {
  const calls = [];
  const decision = await consumeMysqlRateLimit({
    execute: async (sql, params) => calls.push(["execute", sql, params]),
    statementFirstRow: async (sql, params) => {
      calls.push(["select", sql, params]);
      return { request_count: 4, reset_at: 80_000 };
    },
    bucketKey: "login:hash",
    limit: 5,
    windowMs: 60_000,
    now: 20_000,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 1);
  assert.match(calls[0][1], /ON DUPLICATE KEY UPDATE/);
  assert.match(calls[1][1], /FROM rate_limits/);
});

test("limpeza remove somente buckets expirados em lote limitado", async () => {
  let capturedSql = "";
  let capturedParams = [];
  const removed = await cleanupExpiredRateLimits({
    execute: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { affectedRows: 7 };
    },
    now: 12345,
    batchSize: 500,
  });
  assert.equal(removed, 7);
  assert.match(capturedSql, /expires_at <= \?/);
  assert.match(capturedSql, /LIMIT 500/);
  assert.deepEqual(capturedParams, [12345]);
});
