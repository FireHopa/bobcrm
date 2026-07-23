import { setTimeout as sleepTimer } from "node:timers/promises";

const CONNECTION_RETRY_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_TOO_MANY_USER_CONNECTIONS",
]);

const TRANSACTION_RETRY_CODES = new Set([
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

export function isRetryableMysqlConnectionError(error) {
  return CONNECTION_RETRY_CODES.has(String(error?.code || "").trim());
}

export function isRetryableMysqlTransactionError(error) {
  return TRANSACTION_RETRY_CODES.has(String(error?.code || "").trim());
}

export function isRetryableMysqlOperationError(error) {
  if (isRetryableMysqlTransactionError(error)) return true;
  return Boolean(error?.mysqlRetrySafe) && isRetryableMysqlConnectionError(error);
}

export function calculateBackoffDelay(attempt, {
  baseDelayMs = 100,
  maxDelayMs = 3000,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  const normalizedAttempt = Math.max(1, Number(attempt || 1));
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (normalizedAttempt - 1)));
  const jitter = exponential * Math.max(0, jitterRatio) * Math.max(0, Math.min(1, Number(random())));
  return Math.max(0, Math.round(exponential + jitter));
}

export async function withMysqlRetry(operation, {
  maxAttempts = 4,
  baseDelayMs = 100,
  maxDelayMs = 3000,
  jitterRatio = 0.2,
  shouldRetry = isRetryableMysqlConnectionError,
  sleep = sleepTimer,
  onRetry = () => undefined,
  signal,
} = {}) {
  const attempts = Math.max(1, Number(maxAttempts || 1));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) {
      const error = new Error("Operação MySQL cancelada durante o encerramento do servidor.");
      error.code = "MYSQL_RETRY_ABORTED";
      throw error;
    }

    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const delayMs = calculateBackoffDelay(attempt, { baseDelayMs, maxDelayMs, jitterRatio });
      onRetry({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await sleep(delayMs, undefined, signal ? { signal } : undefined);
    }
  }

  throw lastError;
}

export async function withMysqlTransactionRetry(pool, operation, {
  maxAttempts = 3,
  baseDelayMs = 80,
  maxDelayMs = 1200,
  isolationLevel = "READ COMMITTED",
  jitterRatio = 0.2,
  sleep = sleepTimer,
  onRetry = () => undefined,
  signal,
} = {}) {
  return withMysqlRetry(async () => {
    const connection = await withMysqlRetry(() => pool.getConnection(), {
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      shouldRetry: isRetryableMysqlConnectionError,
      jitterRatio,
      sleep,
      onRetry,
      signal,
    });

    const completionCallbacks = [];
    const transactionContext = {
      afterCompletion(callback) {
        if (typeof callback === "function") completionCallbacks.push(callback);
      },
    };
    let transactionStarted = false;
    let commitStarted = false;
    let connectionBroken = false;

    try {
      if (isolationLevel) {
        await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      }
      await connection.beginTransaction();
      transactionStarted = true;
      const result = await operation(connection, transactionContext);
      commitStarted = true;
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      connectionBroken = isRetryableMysqlConnectionError(error);
      if (transactionStarted && !connectionBroken) {
        await connection.rollback().catch(() => undefined);
      }

      // Uma queda antes do COMMIT é segura para retry porque o MySQL desfaz a
      // transação ao perder a conexão. Durante o COMMIT o resultado é ambíguo,
      // portanto não repetimos silenciosamente a operação.
      if (connectionBroken && !commitStarted && error && typeof error === "object") {
        error.mysqlRetrySafe = true;
      }
      if (connectionBroken && commitStarted && error && typeof error === "object") {
        error.code = "MYSQL_COMMIT_OUTCOME_UNKNOWN";
        error.statusCode = 503;
      }
      throw error;
    } finally {
      for (const callback of completionCallbacks.reverse()) {
        try {
          await callback();
        } catch {
          connectionBroken = true;
        }
      }
      if (connectionBroken) connection.destroy?.();
      else connection.release();
    }
  }, {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    shouldRetry: isRetryableMysqlOperationError,
    jitterRatio,
    sleep,
    onRetry,
    signal,
  });
}

export function buildMysqlPoolOptions(options = {}) {
  return {
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    charset: "utf8mb4",
    ...options,
  };
}
