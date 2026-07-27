const MB = 1024 * 1024;
const GB = 1024 * MB;

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ratio(numerator, denominator, fallback = 0) {
  const den = toNumber(denominator, 0);
  if (den <= 0) return fallback;
  return toNumber(numerator, 0) / den;
}

export function pct(numerator, denominator, digits = 1) {
  return Number((ratio(numerator, denominator) * 100).toFixed(digits));
}

export function formatBytes(bytes) {
  const value = toNumber(bytes, 0);
  if (value >= GB) return `${(value / GB).toFixed(value >= 10 * GB ? 1 : 2)} GB`;
  if (value >= MB) return `${(value / MB).toFixed(value >= 10 * MB ? 1 : 2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function statusMap(rows = []) {
  const output = {};
  for (const row of rows) {
    const key = row?.Variable_name ?? row?.variable_name ?? row?.name;
    if (!key) continue;
    output[String(key)] = row?.Value ?? row?.value ?? row?.VALUE ?? null;
  }
  return output;
}

export function variableMap(rows = []) {
  return statusMap(rows);
}

export function diffStatus(before = {}, after = {}, seconds = 1) {
  const elapsed = Math.max(0.001, toNumber(seconds, 1));
  const fields = [
    "Questions",
    "Queries",
    "Connections",
    "Slow_queries",
    "Com_select",
    "Com_insert",
    "Com_update",
    "Com_delete",
    "Created_tmp_tables",
    "Created_tmp_disk_tables",
    "Innodb_data_reads",
    "Innodb_data_writes",
    "Innodb_buffer_pool_reads",
    "Innodb_buffer_pool_read_requests",
    "Innodb_row_lock_waits",
    "Bytes_received",
    "Bytes_sent",
  ];
  const output = { seconds: elapsed };
  for (const field of fields) {
    const delta = Math.max(0, toNumber(after[field], 0) - toNumber(before[field], 0));
    output[field] = delta;
    output[`${field}_per_second`] = delta / elapsed;
  }
  return output;
}

export function calculateMysqlMetrics({ variables = {}, status = {}, os = {}, sample = {} } = {}) {
  const maxConnections = toNumber(variables.max_connections, 0);
  const maxUsedConnections = toNumber(status.Max_used_connections, 0);
  const threadsConnected = toNumber(status.Threads_connected, 0);
  const threadsRunning = toNumber(status.Threads_running, 0);
  const connections = toNumber(status.Connections, 0);
  const threadsCreated = toNumber(status.Threads_created, 0);
  const tmpTables = toNumber(status.Created_tmp_tables, 0);
  const tmpDiskTables = toNumber(status.Created_tmp_disk_tables, 0);
  const bufferReads = toNumber(status.Innodb_buffer_pool_reads, 0);
  const bufferReadRequests = toNumber(status.Innodb_buffer_pool_read_requests, 0);
  const slowQueries = toNumber(status.Slow_queries, 0);
  const questions = toNumber(status.Questions, 0);
  const uptime = toNumber(status.Uptime, 0);
  const bufferPoolSize = toNumber(variables.innodb_buffer_pool_size, 0);
  const totalRam = toNumber(os.totalMemoryBytes, 0);

  return {
    connectionUtilizationPct: pct(maxUsedConnections, maxConnections, 1),
    currentConnectionUtilizationPct: pct(threadsConnected, maxConnections, 1),
    runningConnectionUtilizationPct: pct(threadsRunning, maxConnections, 1),
    threadCacheMissPct: pct(threadsCreated, connections, 2),
    tempDiskTablePct: pct(tmpDiskTables, tmpTables, 1),
    bufferPoolHitPct: bufferReadRequests > 0
      ? Number(((1 - (bufferReads / bufferReadRequests)) * 100).toFixed(3))
      : 100,
    slowQueryPct: pct(slowQueries, questions, 4),
    averageQpsSinceStart: uptime > 0 ? questions / uptime : 0,
    sampleQps: toNumber(sample.Questions_per_second, 0),
    sampleSlowQps: toNumber(sample.Slow_queries_per_second, 0),
    sampleTmpDiskTablesPerSecond: toNumber(sample.Created_tmp_disk_tables_per_second, 0),
    bufferPoolToRamPct: totalRam > 0 ? pct(bufferPoolSize, totalRam, 1) : null,
    bufferDirtyPct: pct(status.Innodb_buffer_pool_pages_dirty, status.Innodb_buffer_pool_pages_total, 2),
    bufferFreePct: pct(status.Innodb_buffer_pool_pages_free, status.Innodb_buffer_pool_pages_total, 2),
    tableOpenCacheMissPct: pct(status.Table_open_cache_misses, toNumber(status.Table_open_cache_hits, 0) + toNumber(status.Table_open_cache_misses, 0), 2),
    abortedConnectPct: pct(status.Aborted_connects, status.Connections, 3),
  };
}

function recommendation(id, severity, title, detail, action, evidence = {}) {
  return { id, severity, title, detail, action, evidence };
}

export function buildHardeningRecommendations({ variables = {}, status = {}, os = {}, metrics = {}, tableSummary = {} } = {}) {
  const recommendations = [];
  const maxConnections = toNumber(variables.max_connections, 0);
  const maxUsed = toNumber(status.Max_used_connections, 0);
  const bufferPoolSize = toNumber(variables.innodb_buffer_pool_size, 0);
  const totalRam = toNumber(os.totalMemoryBytes, 0);
  const freeRam = toNumber(os.freeMemoryBytes, 0);
  const tmpTableSize = toNumber(variables.tmp_table_size, 0);
  const maxHeapTableSize = toNumber(variables.max_heap_table_size, 0);
  const slowLog = String(variables.slow_query_log || "OFF").toUpperCase();
  const longQueryTime = toNumber(variables.long_query_time, 10);
  const bufferHit = toNumber(metrics.bufferPoolHitPct, 100);
  const tempDiskPct = toNumber(metrics.tempDiskTablePct, 0);
  const connectionPct = toNumber(metrics.connectionUtilizationPct, 0);
  const threadCacheMissPct = toNumber(metrics.threadCacheMissPct, 0);
  const tableDataBytes = toNumber(tableSummary.dataBytes, 0);
  const tableIndexBytes = toNumber(tableSummary.indexBytes, 0);

  if (slowLog !== "ON") {
    recommendations.push(recommendation(
      "slow-query-log",
      "high",
      "Ativar Slow Query Log",
      "O slow query log está desligado. Isso reduz a capacidade de confirmar gargalos reais depois das otimizações de aplicação.",
      "Habilitar de forma controlada no my.cnf, preferencialmente com long_query_time entre 0,5s e 1s e rotação de logs.",
      { slow_query_log: variables.slow_query_log, long_query_time: variables.long_query_time },
    ));
  } else if (longQueryTime > 1) {
    recommendations.push(recommendation(
      "slow-query-threshold",
      "medium",
      "Reduzir long_query_time",
      `O slow query log está ativo, mas long_query_time=${longQueryTime}s pode esconder consultas perceptivelmente lentas para um CRM.`,
      "Avaliar 0,5s a 1s durante a fase de observação, acompanhando volume e rotação do arquivo.",
      { long_query_time: longQueryTime },
    ));
  }

  if (connectionPct >= 80) {
    recommendations.push(recommendation(
      "connection-pressure",
      "high",
      "Pressão alta de conexões MySQL",
      `O pico observado utilizou ${connectionPct}% de max_connections.`,
      "Não aumente max_connections automaticamente. Primeiro confirme filas do pool, queries lentas e duração média das conexões; aumente somente com RAM suficiente e evidência de saturação legítima.",
      { max_connections: maxConnections, max_used_connections: maxUsed },
    ));
  } else if (maxConnections > 0 && maxUsed > 0 && connectionPct < 25 && maxConnections >= 300) {
    recommendations.push(recommendation(
      "excessive-max-connections",
      "low",
      "max_connections parece superdimensionado",
      `O pico histórico foi ${maxUsed} de ${maxConnections} conexões (${connectionPct}%).`,
      "Não é urgente reduzir, mas evite usar max_connections alto como solução de performance. O BobCRM atualmente reserva poucos pools de aplicação.",
      { max_connections: maxConnections, max_used_connections: maxUsed },
    ));
  }

  if (bufferHit < 99.5) {
    recommendations.push(recommendation(
      "buffer-pool-hit",
      bufferHit < 98 ? "high" : "medium",
      "Buffer pool com miss rate relevante",
      `O hit ratio estimado do InnoDB Buffer Pool é ${bufferHit}%.`,
      "Verifique working set, RAM disponível e leituras físicas antes de aumentar innodb_buffer_pool_size. Em VPS compartilhada com Node, preserve memória para sistema e processos da aplicação.",
      { hit_pct: bufferHit, buffer_pool_size: bufferPoolSize, total_ram: totalRam },
    ));
  }

  if (totalRam > 0 && bufferPoolSize > 0) {
    const poolRamPct = bufferPoolSize / totalRam;
    const databaseFootprint = tableDataBytes + tableIndexBytes;
    if (poolRamPct < 0.25 && databaseFootprint > bufferPoolSize * 1.2 && freeRam > Math.max(GB, bufferPoolSize * 0.5)) {
      recommendations.push(recommendation(
        "buffer-pool-small",
        "medium",
        "Buffer pool pequeno para o footprint observado",
        `innodb_buffer_pool_size representa ${(poolRamPct * 100).toFixed(1)}% da RAM e é menor que o footprint de dados+índices observado.`,
        "Avaliar aumento gradual, em passos pequenos, observando RSS do Node, swap, OOM e latência. Não aplicar 70% da RAM automaticamente em uma VPS que também hospeda API/worker.",
        { buffer_pool_size: bufferPoolSize, database_footprint: databaseFootprint, total_ram: totalRam, free_ram: freeRam },
      ));
    }
    if (poolRamPct > 0.7 && String(os.mysqlAppearsLocal ?? true) !== "false") {
      recommendations.push(recommendation(
        "buffer-pool-large-shared-host",
        "medium",
        "Buffer pool agressivo para host compartilhado",
        `innodb_buffer_pool_size consome ${(poolRamPct * 100).toFixed(1)}% da RAM total do host.`,
        "Se API e worker rodam na mesma VPS, confirme ausência de swap/OOM. Em host compartilhado, reserve folga para Node, kernel, filesystem cache e jobs.",
        { buffer_pool_size: bufferPoolSize, total_ram: totalRam },
      ));
    }
  }

  if (tempDiskPct >= 20 && toNumber(status.Created_tmp_tables, 0) >= 100) {
    recommendations.push(recommendation(
      "disk-temp-tables",
      tempDiskPct >= 40 ? "high" : "medium",
      "Muitas temporary tables indo para disco",
      `${tempDiskPct}% das temporary tables contabilizadas foram criadas em disco.`,
      "Primeiro identifique as queries responsáveis. Só depois avalie tmp_table_size/max_heap_table_size; aumentar esses limites multiplica consumo potencial por conexão.",
      { tmp_table_size: tmpTableSize, max_heap_table_size: maxHeapTableSize, disk_temp_pct: tempDiskPct },
    ));
  }

  if (threadCacheMissPct > 5 && toNumber(status.Connections, 0) > 100) {
    recommendations.push(recommendation(
      "thread-cache",
      "low",
      "Criação frequente de threads",
      `${threadCacheMissPct}% das conexões históricas exigiram criação de thread.`,
      "Verifique thread_cache_size e churn de conexões. Como o BobCRM usa pool persistente, churn alto também pode indicar reconexões ou instabilidade.",
      { thread_cache_size: variables.thread_cache_size, threads_created: status.Threads_created, connections: status.Connections },
    ));
  }

  if (toNumber(status.Innodb_row_lock_waits, 0) > 0 && toNumber(status.Innodb_row_lock_time, 0) > 0) {
    recommendations.push(recommendation(
      "row-locks",
      "medium",
      "Há espera por locks de linha",
      `Foram registrados ${status.Innodb_row_lock_waits} waits, totalizando ${status.Innodb_row_lock_time} ms desde o início da instância.`,
      "Correlacione com importações, merges, tarefas e queries do slow log. Evite compensar lock contention aumentando conexões.",
      { waits: status.Innodb_row_lock_waits, wait_time_ms: status.Innodb_row_lock_time },
    ));
  }

  const disks = Array.isArray(os.disks) ? os.disks : [];
  const pressuredDisk = disks.find((disk) => toNumber(disk?.usedPct, 0) >= 85);
  if (pressuredDisk) {
    recommendations.push(recommendation(
      "disk-capacity",
      toNumber(pressuredDisk.usedPct, 0) >= 92 ? "high" : "medium",
      "Disco com pouca folga",
      `O filesystem ${pressuredDisk.path || "monitorado"} está com ${pressuredDisk.usedPct}% de uso.`,
      "Crie margem antes de crescer logs, backups e tabelas. Revise retenção de backups, rotação do slow log e crescimento do datadir.",
      { path: pressuredDisk.path, used_pct: pressuredDisk.usedPct },
    ));
  }

  if (toNumber(metrics.tableOpenCacheMissPct, 0) > 5 && toNumber(status.Table_open_cache_misses, 0) > 100) {
    recommendations.push(recommendation(
      "table-open-cache",
      "low",
      "Misses relevantes no table_open_cache",
      `${metrics.tableOpenCacheMissPct}% dos acessos contabilizados ao cache de tabelas foram misses.`,
      "Correlacione Opened_tables e quantidade de tabelas antes de aumentar table_open_cache; valide também open_files_limit.",
      { table_open_cache: variables.table_open_cache, misses: status.Table_open_cache_misses, hits: status.Table_open_cache_hits },
    ));
  }

  if (!recommendations.length) {
    recommendations.push(recommendation(
      "no-critical-change",
      "info",
      "Nenhum ajuste agressivo recomendado automaticamente",
      "Os indicadores coletados não justificam alteração estrutural imediata nos parâmetros analisados.",
      "Mantenha os valores atuais, rode a auditoria em horário de pico e compare com slow query log e EXPLAIN ANALYZE da Fase 9.",
      {},
    ));
  }

  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  recommendations.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  return recommendations;
}

export function buildSafeMyCnfCandidate({ variables = {}, recommendations = [] } = {}) {
  const ids = new Set(recommendations.map((item) => item.id));
  const lines = [
    "# CANDIDATO DE CONFIGURAÇÃO — NÃO APLICAR AUTOMATICAMENTE",
    "# Gere novamente em horário de pico e valide RAM/IO antes de editar my.cnf.",
    "[mysqld]",
  ];

  if (ids.has("slow-query-log")) {
    lines.push("slow_query_log = ON");
    lines.push("long_query_time = 0.5");
  } else if (ids.has("slow-query-threshold")) {
    lines.push("long_query_time = 0.5");
  }

  if (String(variables.log_output || "FILE").toUpperCase() !== "FILE") {
    lines.push("# Considere manter log_output=FILE para evitar carga adicional na tabela mysql.slow_log.");
  }

  lines.push("");
  lines.push("# NÃO alterado automaticamente:");
  lines.push(`# innodb_buffer_pool_size = ${variables.innodb_buffer_pool_size ?? "<medir>"}`);
  lines.push(`# max_connections = ${variables.max_connections ?? "<medir>"}`);
  lines.push(`# tmp_table_size = ${variables.tmp_table_size ?? "<medir>"}`);
  lines.push(`# max_heap_table_size = ${variables.max_heap_table_size ?? "<medir>"}`);
  lines.push("# Esses parâmetros dependem da evidência coletada e da RAM disponível no host.");
  return `${lines.join("\n")}\n`;
}
