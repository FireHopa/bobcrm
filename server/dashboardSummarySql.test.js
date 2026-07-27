import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadDashboardSummarySql, mapLeadDashboardSummaryRow } from "./dashboardSummarySql.js";

test("dashboard consolidado produz resumo e oportunidades em um único scan", () => {
  const sql = buildLeadDashboardSummarySql({
    where: "l.responsible_user_id = ?",
    activeWhere: "l.deleted_at = '' AND l.is_lost = 0 AND l.status != 'Perdido' AND l.status != 'Fechado'",
    alias: "l",
  });

  assert.equal((sql.match(/FROM\s+leads/gi) || []).length, 1);
  assert.match(sql, /metric_high_priority/);
  assert.match(sql, /opportunity_priority/);
  assert.match(sql, /l\.lead_priority_score/);
  assert.match(sql, /l\.opportunity_score/);
  assert.doesNotMatch(sql, /JSON_EXTRACT/);
  assert.match(sql, /l\.responsible_user_id = \?/);
});

test("dashboard consolidado mantém fallback legado durante backfill", () => {
  const sql = buildLeadDashboardSummarySql({ useMaterialized: false });
  assert.match(sql, /JSON_EXTRACT/);
  assert.match(sql, /metric_total/);
  assert.match(sql, /opportunity_total/);
});

test("mapeamento consolidado preserva contratos das duas APIs", () => {
  const result = mapLeadDashboardSummaryRow({
    metric_total: 20,
    metric_active: 15,
    metric_due_follow_ups: 3,
    metric_high_priority: 4,
    metric_without_owner: 2,
    metric_without_next_step: 5,
    metric_hot_leads: 6,
    metric_agency_opportunities: 7,
    metric_needs_mapping: 8,
    metric_expansion_opportunities: 9,
    metric_deleted: 1,
    opportunity_total: 20,
    opportunity_expansion: 9,
    opportunity_migration: 3,
    opportunity_mapping: 5,
    opportunity_priority: 4,
    opportunity_agency: 7,
    opportunity_without_diagnosis: 2,
    opportunity_mapping_critical: 1,
    services_casa: 30,
    services_agency: 12,
    services_not_done: 18,
    services_unknown: 9,
  });

  assert.equal(result.summary.total, 20);
  assert.equal(result.summary.deleted, 1);
  assert.equal(result.opportunitySummary.total, 20);
  assert.equal(result.opportunitySummary.expansion, 9);
  assert.equal(result.opportunitySummary.serviceStatuses["Casa do Ads"], 30);
});
