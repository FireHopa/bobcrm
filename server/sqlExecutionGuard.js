export function withMaxExecutionTimeHint(sql, timeoutMs = 0) {
  const normalizedSql = String(sql || "");
  const parsed = Number.parseInt(String(timeoutMs || 0), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return normalizedSql;
  const bounded = Math.max(250, Math.min(60000, parsed));
  if (/MAX_EXECUTION_TIME\s*\(/i.test(normalizedSql)) return normalizedSql;
  return normalizedSql.replace(/^(\s*)SELECT\b/i, `$1SELECT /*+ MAX_EXECUTION_TIME(${bounded}) */`);
}

export function isMysqlStatementTimeout(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const errno = Number(error?.errno || 0);
  return code === "ER_QUERY_TIMEOUT"
    || code === "ER_STATEMENT_TIMEOUT"
    || errno === 3024
    || errno === 1969;
}


export function resolveInteractiveSqlTimeout(context, {
  defaultMs = 8000,
  adminMs = 10000,
} = {}) {
  if (!context || String(context.method || "").toUpperCase() === "BACKGROUND") return 0;
  const endpoint = String(context.endpoint || "").toLowerCase();
  const normalizedDefault = Math.max(1000, Math.min(60000, Number(defaultMs || 8000)));
  const normalizedAdmin = Math.max(normalizedDefault, Math.min(60000, Number(adminMs || 10000)));
  if (endpoint.startsWith("/api/admin/") || endpoint.includes("/duplicates")) return normalizedAdmin;
  return normalizedDefault;
}
