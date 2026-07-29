import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema.mysql.sql", import.meta.url), "utf8");

function functionSlice(name, nextName) {
  const start = serverSource.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} não encontrada`);
  const end = nextName ? serverSource.indexOf(`\nasync function ${nextName}`, start + 1) : -1;
  return serverSource.slice(start, end === -1 ? serverSource.length : end);
}

test("resumo usa snapshot stale-while-revalidate em vez de invalidar valor útil", () => {
  assert.match(serverSource, /LEAD_SUMMARY_STALE_MS/);
  assert.match(serverSource, /staleTtlMs: LEAD_SUMMARY_STALE_MS/);
  assert.match(serverSource, /leadDashboardSummaryCache\.markStale\("all"\)/);
  assert.match(serverSource, /staleWhileRevalidate: true/);
});

test("Tela Hoje reaproveita snapshot de leads e consolida listas de tarefas", () => {
  const fn = functionSlice("getTodayDashboard", "getRecentAudit");
  assert.match(fn, /getLeadDashboardSummaryCached/);
  assert.match(fn, /buildTaskListsSql/);
  assert.doesNotMatch(fn, /buildOperationalSql/);
  assert.equal((fn.match(/for \(const bucket/g) || []).length, 0);
});

test("cursor reutiliza total e plano de busca nas páginas seguintes", () => {
  const fn = functionSlice("getLeadsPageFromRequest", "getLeadById");
  assert.match(fn, /cursorTotal/);
  assert.match(fn, /preferredSearchMode: cursor\?\.searchMode/);
  assert.match(fn, /total,\s*filterKey,\s*searchMode/);
});

test("schema da fase 2 cobre listagem, filtros comerciais, tarefas e integrações", () => {
  for (const indexName of [
    "idx_leads_active_updated_id",
    "idx_leads_priority_score_updated",
    "idx_leads_mapping_score_updated",
    "idx_leads_agency_updated",
    "idx_leads_expansion_updated",
    "idx_tasks_status_due_dt_owner",
    "idx_integration_events_status_updated",
  ]) assert.match(schemaSource, new RegExp(indexName));
  assert.match(serverSource, /runScalabilityPhase2Migration/);
});
