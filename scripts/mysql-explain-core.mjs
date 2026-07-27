import { LEAD_LIST_SELECT } from "../server/domains/leads/leadProjections.js";
import { buildKanbanInitialCardsSql, buildKanbanPipelinesSql } from "../server/kanbanBoardSql.js";
import { buildLeadDashboardSummarySql } from "../server/dashboardSummarySql.js";
import { buildTodayTemporalSql } from "../server/todayTemporalSql.js";

export const PHASE9_TABLES = Object.freeze(["leads", "tasks", "kanban_pipelines", "kanban_stages"]);

function safePrefix(value, length) {
  return String(value || "").trim().slice(0, length);
}

function firstSearchWord(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((token) => token.length >= 4) || "";
}

export function buildPhase9Scenarios(samples = {}) {
  const scenarios = [
    {
      id: "lead_list_default",
      label: "Lista de leads - ordenação padrão",
      family: "leads",
      sql: `SELECT ${LEAD_LIST_SELECT}, updated_at AS __sort_value
        FROM leads
        WHERE deleted_at = ''
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`,
      params: [50],
      expectedIndexes: ["idx_leads_updated_at"],
      recommendation: "Se o índice simples exigir muitas linhas filtradas ou filesort, validar em staging o candidato (deleted_at, updated_at, id) antes de criar migration.",
    },
    {
      id: "lead_priority_filter",
      label: "Lista de leads - prioridade comercial alta",
      family: "leads",
      sql: `SELECT id, name, company, responsible_user_id, lead_priority_score, updated_at_dt
        FROM leads
        WHERE deleted_at = ''
          AND is_lost = 0
          AND status != 'Perdido'
          AND status != 'Fechado'
          AND lead_priority_score >= 70
        ORDER BY updated_at_dt DESC, id DESC
        LIMIT ?`,
      params: [50],
      expectedIndexes: [],
      recommendation: "Não criar índice de score automaticamente; medir seletividade e rows examined primeiro.",
    },
    {
      id: "kanban_pipelines",
      label: "Kanban - pipelines, etapas e contagens",
      family: "kanban",
      sql: buildKanbanPipelinesSql("1 = 1"),
      params: [],
      expectedIndexes: ["idx_leads_pipeline_stage", "idx_kanban_pipelines_active", "idx_kanban_stages_pipeline"],
      recommendation: "Esperado aproveitar índices de pipeline/etapa; revisar temporary/sort somente se o custo real justificar.",
    },
    {
      id: "dashboard_summary",
      label: "Dashboard consolidado de leads",
      family: "dashboard",
      sql: buildLeadDashboardSummarySql({
        where: "1 = 1",
        activeWhere: "l.deleted_at = '' AND l.is_lost = 0 AND l.status != 'Perdido' AND l.status != 'Fechado'",
        alias: "l",
        useMaterialized: true,
        useDateColumns: true,
      }),
      params: [],
      expectedIndexes: [],
      recommendation: "Aggregate global pode exigir scan; decidir pelo actual time/rows e pelo cache, não por aparência.",
    },
    {
      id: "tasks_today_counts",
      label: "Dashboard Hoje - contadores de tarefas",
      family: "tasks",
      sql: buildTodayTemporalSql(true).buildTaskCountSql("1 = 1"),
      params: [],
      expectedIndexes: ["idx_tasks_status_due_dt", "idx_tasks_completed_dt"],
      recommendation: "Se o aggregate continuar varrendo tasks inteiro, avaliar separar agregados somente após medir custo real.",
    },
    {
      id: "tasks_overdue_list",
      label: "Dashboard Hoje - tarefas atrasadas",
      family: "tasks",
      sql: `SELECT t.id, t.responsible_user_id, t.status, t.priority, t.due_at_dt, t.created_at_dt
        FROM tasks t
        WHERE t.status = 'pending' AND t.due_at_dt < CURDATE()
        ORDER BY CASE t.priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                 t.due_at_dt ASC
        LIMIT 12`,
      params: [],
      expectedIndexes: ["idx_tasks_status_due_dt"],
      recommendation: "Range por status/due_at_dt deve evitar full scan; sort por prioridade pode continuar exigindo sort pequeno.",
    },
  ];

  if (samples.pipelineId) {
    scenarios.push({
      id: "kanban_initial_cards",
      label: "Kanban - cards iniciais do pipeline representativo",
      family: "kanban",
      sql: buildKanbanInitialCardsSql("deleted_at = ''"),
      params: [samples.pipelineId, 50],
      expectedIndexes: ["idx_leads_pipeline_stage"],
      recommendation: "Observar rows, loops e Sort dentro da window function antes de ampliar o índice do Kanban.",
    });
  }

  const emailPrefix = safePrefix(samples.emailKey, 12);
  if (emailPrefix) {
    scenarios.push({
      id: "search_email_prefix",
      label: "Busca - prefixo de e-mail",
      family: "search",
      sql: "SELECT id FROM leads WHERE deleted_at = '' AND email_key LIKE ? LIMIT 50",
      params: [`${emailPrefix}%`],
      expectedIndexes: ["idx_leads_search_email"],
      recommendation: "Deve usar range no índice de e-mail; table scan indica regressão de busca.",
    });
  }

  const phonePrefix = safePrefix(samples.phoneKey, 8);
  if (phonePrefix) {
    scenarios.push({
      id: "search_phone_prefix",
      label: "Busca - prefixo de telefone",
      family: "search",
      sql: "SELECT id FROM leads WHERE deleted_at = '' AND phone_key LIKE ? LIMIT 50",
      params: [`${phonePrefix}%`],
      expectedIndexes: ["idx_leads_search_phone"],
      recommendation: "Deve usar range no índice de telefone; table scan indica regressão de busca.",
    });
  }

  const fullTextToken = firstSearchWord(samples.searchSeed || samples.name || samples.company);
  if (fullTextToken) {
    scenarios.push({
      id: "search_fulltext",
      label: "Busca - FULLTEXT",
      family: "search",
      sql: "SELECT id FROM leads WHERE deleted_at = '' AND MATCH(search_text) AGAINST (? IN BOOLEAN MODE) LIMIT 50",
      params: [`+${fullTextToken}*`],
      expectedIndexes: ["ft_leads_search_text"],
      recommendation: "A busca textual principal deve usar FULLTEXT; não aceitar table scan como caminho normal.",
    });
  }

  if (samples.responsibleUserId) {
    scenarios.push({
      id: "tasks_owner_today",
      label: "Tarefas - agenda do responsável",
      family: "tasks",
      sql: `SELECT t.id, t.status, t.priority, t.due_at_dt
        FROM tasks t
        WHERE t.responsible_user_id = ?
          AND t.status = 'pending'
          AND t.due_at_dt >= CURDATE()
          AND t.due_at_dt < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        ORDER BY t.due_at_dt ASC
        LIMIT 50`,
      params: [samples.responsibleUserId],
      expectedIndexes: ["idx_tasks_responsible_due_dt"],
      recommendation: "Deve usar o índice responsável/status/data; full scan aqui é sinal claro de problema.",
    });
  }

  return scenarios;
}

function planLines(plan) {
  return String(plan || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseExplainAnalyzePlan(plan) {
  const lines = planLines(plan);
  const accessLines = lines.filter((line) => /(scan on|lookup on|search on)/i.test(line));
  const actuals = [];
  const indexes = new Set();
  let rootActualRows = null;
  let rootActualEndMs = null;

  for (const line of lines) {
    const actual = line.match(/actual time=([0-9.]+)\.\.([0-9.]+) rows=([0-9.]+) loops=([0-9.]+)/i);
    if (actual) {
      const entry = {
        startMs: Number(actual[1]),
        endMs: Number(actual[2]),
        rows: Number(actual[3]),
        loops: Number(actual[4]),
      };
      actuals.push(entry);
      if (rootActualRows === null) {
        rootActualRows = entry.rows;
        rootActualEndMs = entry.endMs;
      }
    }
    const indexMatch = line.match(/using\s+(?:covering\s+)?index\s+([`A-Za-z0-9_]+)/i)
      || line.match(/index\s+(?:lookup|range scan)[^\n]*?using\s+([`A-Za-z0-9_]+)/i);
    if (indexMatch) indexes.add(indexMatch[1].replace(/`/g, ""));
  }

  const accessWorkRows = accessLines.reduce((sum, line) => {
    const match = line.match(/actual time=[0-9.]+\.\.[0-9.]+ rows=([0-9.]+) loops=([0-9.]+)/i);
    return match ? sum + Number(match[1]) * Number(match[2]) : sum;
  }, 0);

  return {
    rootActualEndMs,
    rootActualRows,
    maxActualEndMs: actuals.length ? Math.max(...actuals.map((item) => item.endMs)) : null,
    accessWorkRows,
    tableScan: lines.some((line) => /table scan on/i.test(line)),
    indexScan: lines.some((line) => /index scan on/i.test(line)),
    indexLookup: lines.some((line) => /index lookup on/i.test(line)),
    indexRangeScan: lines.some((line) => /index range scan on/i.test(line)),
    sort: lines.some((line) => /(^|->\s*)sort:/i.test(line) || /filesort/i.test(line)),
    temporary: lines.some((line) => /temporary/i.test(line)),
    indexesUsed: [...indexes],
    planLines: lines.length,
  };
}

export function evaluateScenario(scenario, planSummary) {
  const expected = scenario.expectedIndexes || [];
  const expectedIndexUsed = expected.length === 0 || expected.some((index) => planSummary.indexesUsed.includes(index));
  const severeScan = planSummary.tableScan && Number(planSummary.accessWorkRows || 0) >= 10000;
  const slow = Number(planSummary.rootActualEndMs || planSummary.maxActualEndMs || 0) >= 500;
  const status = severeScan || slow ? "review" : expectedIndexUsed ? "ok" : "review";
  return {
    status,
    expectedIndexUsed,
    reason: severeScan
      ? "table scan com volume relevante"
      : slow
        ? "actual time acima de 500ms"
        : expectedIndexUsed
          ? "plano compatível com a expectativa"
          : "índice esperado não apareceu no plano",
  };
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function buildExplainMarkdown(report) {
  const lines = [
    "# BobCRM MySQL EXPLAIN ANALYZE Report",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Banco: ${report.database}`,
    `MySQL: ${report.mysqlVersion || "desconhecido"}`,
    `max_execution_time: ${report.maxExecutionTimeMs}ms`,
    "",
    "## Tabelas",
    "",
    "| Tabela | Rows estimadas | Data MB | Index MB |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const table of report.tables || []) {
    lines.push(`| ${markdownCell(table.table)} | ${table.rows} | ${table.dataMb} | ${table.indexMb} |`);
  }

  lines.push(
    "",
    "## Cenários",
    "",
    "| Cenário | Status | Actual | Rows saída | Work rows aprox. | Table scan | Sort | Índices usados |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- |",
  );
  for (const item of report.scenarios || []) {
    const summary = item.summary || {};
    lines.push(`| ${markdownCell(item.label)} | ${item.evaluation?.status || item.status || "-"} | ${summary.rootActualEndMs == null ? "-" : `${summary.rootActualEndMs}ms`} | ${summary.rootActualRows ?? "-"} | ${summary.accessWorkRows ?? "-"} | ${summary.tableScan ? "sim" : "não"} | ${summary.sort ? "sim" : "não"} | ${markdownCell((summary.indexesUsed || []).join(", ") || "-")} |`);
  }

  lines.push("", "## Recomendações por cenário", "");
  for (const item of report.scenarios || []) {
    lines.push(`### ${item.label}`, "", `- Resultado: ${item.evaluation?.reason || item.error || "sem análise"}`, `- Diretriz: ${item.recommendation}`, "");
    if (item.plan) lines.push("```text", item.plan, "```", "");
  }

  lines.push("## Índices atuais", "", "| Tabela | Índice | Colunas | Cardinalidade | Tipo |", "| --- | --- | --- | ---: | --- |");
  for (const index of report.indexes || []) {
    lines.push(`| ${markdownCell(index.table)} | ${markdownCell(index.index)} | ${markdownCell(index.columns)} | ${index.cardinality ?? "-"} | ${markdownCell(index.type)} |`);
  }

  if (report.indexUsage?.length) {
    lines.push("", "## Uso de índices desde o último restart do MySQL", "", "| Tabela | Índice | Reads | Writes |", "| --- | --- | ---: | ---: |");
    for (const item of report.indexUsage) lines.push(`| ${item.table} | ${item.index || "NULL"} | ${item.reads} | ${item.writes} |`);
  }

  lines.push(
    "",
    "## Regra de decisão",
    "",
    "Não remover índice apenas porque apareceu com zero reads neste relatório. Performance Schema reinicia contadores quando o MySQL reinicia e workloads raros podem não ter ocorrido na janela analisada.",
    "",
    "Não aplicar automaticamente os candidatos. Use os planos acima para decidir uma migration pequena e reversível.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
