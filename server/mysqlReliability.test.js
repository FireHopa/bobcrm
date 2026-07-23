import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMysqlPoolOptions,
  calculateBackoffDelay,
  isRetryableMysqlConnectionError,
  isRetryableMysqlOperationError,
  isRetryableMysqlTransactionError,
  withMysqlRetry,
  withMysqlTransactionRetry,
} from "./mysqlReliability.js";

test("backoff cresce de forma limitada e aceita jitter determinístico", () => {
  assert.equal(calculateBackoffDelay(1, { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0, random: () => 0 }), 100);
  assert.equal(calculateBackoffDelay(3, { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0, random: () => 0 }), 400);
  assert.equal(calculateBackoffDelay(8, { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0, random: () => 0 }), 500);
});

test("retry distingue falha de conexão de conflito transacional", () => {
  assert.equal(isRetryableMysqlConnectionError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableMysqlConnectionError({ code: "ER_PARSE_ERROR" }), false);
  assert.equal(isRetryableMysqlTransactionError({ code: "ER_LOCK_DEADLOCK" }), true);
  assert.equal(isRetryableMysqlTransactionError({ code: "PROTOCOL_CONNECTION_LOST" }), false);
  assert.equal(isRetryableMysqlOperationError({ code: "ECONNRESET", mysqlRetrySafe: true }), true);
  assert.equal(isRetryableMysqlOperationError({ code: "ECONNRESET" }), false);
});

test("withMysqlRetry repete somente falhas transitórias", async () => {
  let calls = 0;
  const waits = [];
  const result = await withMysqlRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("temporário"), { code: "ECONNRESET" });
    return "ok";
  }, {
    maxAttempts: 4,
    jitterRatio: 0,
    sleep: async (delay) => waits.push(delay),
  });

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("transação inteira é refeita após deadlock e sempre libera conexão", async () => {
  let attempts = 0;
  let releases = 0;
  let rollbacks = 0;
  const pool = {
    async getConnection() {
      return {
        query: async () => undefined,
        beginTransaction: async () => undefined,
        commit: async () => undefined,
        rollback: async () => { rollbacks += 1; },
        release: () => { releases += 1; },
      };
    },
  };

  const result = await withMysqlTransactionRetry(pool, async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    return 42;
  }, { sleep: async () => undefined, jitterRatio: 0 });

  assert.equal(result, 42);
  assert.equal(attempts, 2);
  assert.equal(rollbacks, 1);
  assert.equal(releases, 2);
});



test("transação inteira é refeita após queda de conexão antes do commit", async () => {
  let attempts = 0;
  let releases = 0;
  let destroys = 0;
  const pool = {
    async getConnection() {
      return {
        query: async () => undefined,
        beginTransaction: async () => undefined,
        commit: async () => undefined,
        rollback: async () => undefined,
        release: () => { releases += 1; },
        destroy: () => { destroys += 1; },
      };
    },
  };

  const result = await withMysqlTransactionRetry(pool, async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("conexão reiniciada"), { code: "ECONNRESET" });
    return "ok";
  }, { sleep: async () => undefined, jitterRatio: 0 });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.equal(destroys, 1);
  assert.equal(releases, 1);
});

test("queda durante commit não é repetida por resultado transacional ambíguo", async () => {
  let attempts = 0;
  const pool = {
    async getConnection() {
      return {
        query: async () => undefined,
        beginTransaction: async () => undefined,
        commit: async () => { throw Object.assign(new Error("conexão reiniciada no commit"), { code: "ECONNRESET" }); },
        rollback: async () => undefined,
        release: () => undefined,
        destroy: () => undefined,
      };
    },
  };

  await assert.rejects(
    () => withMysqlTransactionRetry(pool, async () => { attempts += 1; return "ok"; }, { sleep: async () => undefined, jitterRatio: 0 }),
    (error) => error.code === "MYSQL_COMMIT_OUTCOME_UNKNOWN" && error.statusCode === 503,
  );
  assert.equal(attempts, 1);
});

test("opções do pool habilitam keepalive sem sobrescrever configuração explícita", () => {
  const options = buildMysqlPoolOptions({ connectionLimit: 17, connectTimeout: 2500 });
  assert.equal(options.enableKeepAlive, true);
  assert.equal(options.connectionLimit, 17);
  assert.equal(options.connectTimeout, 2500);
});

test("callbacks de conclusão executam após commit e após rollback antes de liberar a conexão", async () => {
  const events = [];
  let call = 0;
  const pool = {
    async getConnection() {
      call += 1;
      const attempt = call;
      return {
        query: async () => events.push(`isolation:${attempt}`),
        beginTransaction: async () => events.push(`begin:${attempt}`),
        commit: async () => events.push(`commit:${attempt}`),
        rollback: async () => events.push(`rollback:${attempt}`),
        release: () => events.push(`release:${attempt}`),
        destroy: () => events.push(`destroy:${attempt}`),
      };
    },
  };

  const result = await withMysqlTransactionRetry(pool, async (_connection, context) => {
    const attempt = call;
    context.afterCompletion(async () => events.push(`cleanup:${attempt}`));
    if (attempt === 1) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    return "ok";
  }, { sleep: async () => undefined, jitterRatio: 0 });

  assert.equal(result, "ok");
  assert.deepEqual(events, [
    "isolation:1", "begin:1", "rollback:1", "cleanup:1", "release:1",
    "isolation:2", "begin:2", "commit:2", "cleanup:2", "release:2",
  ]);
});
