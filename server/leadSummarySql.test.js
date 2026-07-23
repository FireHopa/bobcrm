import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadSummarySql, mapLeadSummaryRow } from "./leadSummarySql.js";

test("resumo de leads não usa HIGH_PRIORITY como alias SQL", () => {
  const sql = buildLeadSummarySql();
  assert.doesNotMatch(sql, /\bAS\s+high_priority\b/i);
  assert.match(sql, /\bAS\s+metric_high_priority\b/i);
});

test("aliases do resumo usam prefixo seguro e único", () => {
  const sql = buildLeadSummarySql();
  const aliases = Array.from(sql.matchAll(/\bAS\s+(metric_[a-z_]+)/gi), (match) => match[1].toLowerCase());
  assert.equal(aliases.length, 11);
  assert.equal(new Set(aliases).size, aliases.length);
});

test("mapeamento do resumo mantém o contrato da API", () => {
  assert.deepEqual(mapLeadSummaryRow({
    metric_total: "10",
    metric_active: 8,
    metric_due_follow_ups: 3,
    metric_high_priority: 4,
    metric_without_owner: 2,
    metric_without_next_step: 5,
    metric_hot_leads: 1,
    metric_agency_opportunities: 6,
    metric_needs_mapping: 7,
    metric_expansion_opportunities: 9,
    metric_deleted: 2,
  }), {
    total: 10,
    active: 8,
    dueFollowUps: 3,
    highPriority: 4,
    withoutOwner: 2,
    withoutNextStep: 5,
    hotLeads: 1,
    agencyOpportunities: 6,
    needsMapping: 7,
    expansionOpportunities: 9,
    deleted: 2,
  });
});
