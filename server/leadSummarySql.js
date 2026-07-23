import { buildOpportunitySqlExpressions } from "./opportunityRules.js";

const DEFAULT_ACTIVE_WHERE = "deleted_at = '' AND is_lost = 0 AND status != 'Perdido' AND status != 'Fechado'";

export function buildLeadSummarySql({ where = "1 = 1", activeWhere = DEFAULT_ACTIVE_WHERE } = {}) {
  const commercial = buildOpportunitySqlExpressions();
  return `SELECT
       SUM(CASE WHEN deleted_at = '' THEN 1 ELSE 0 END) AS metric_total,
       SUM(CASE WHEN ${activeWhere} THEN 1 ELSE 0 END) AS metric_active,
       SUM(CASE WHEN ${activeWhere} AND TRIM(COALESCE(next_contact_at, '')) != '' AND LEFT(next_contact_at, 10) <= DATE_FORMAT(CURDATE(), '%Y-%m-%d') THEN 1 ELSE 0 END) AS metric_due_follow_ups,
       SUM(CASE WHEN ${activeWhere} AND (${commercial.leadPriority}) >= 70 THEN 1 ELSE 0 END) AS metric_high_priority,
       SUM(CASE WHEN ${activeWhere} AND TRIM(COALESCE(responsible, '')) = '' AND TRIM(COALESCE(responsible_user_id, '')) = '' THEN 1 ELSE 0 END) AS metric_without_owner,
       SUM(CASE WHEN ${activeWhere} AND TRIM(COALESCE(next_contact_at, '')) = '' THEN 1 ELSE 0 END) AS metric_without_next_step,
       SUM(CASE WHEN ${activeWhere} AND temperature = 'Quente' THEN 1 ELSE 0 END) AS metric_hot_leads,
       SUM(CASE WHEN deleted_at = '' AND ${commercial.agency} THEN 1 ELSE 0 END) AS metric_agency_opportunities,
       SUM(CASE WHEN ${activeWhere} AND ${commercial.leadMapping} THEN 1 ELSE 0 END) AS metric_needs_mapping,
       SUM(CASE WHEN deleted_at = '' AND ${commercial.leadExpansion} THEN 1 ELSE 0 END) AS metric_expansion_opportunities,
       SUM(CASE WHEN deleted_at != '' THEN 1 ELSE 0 END) AS metric_deleted
     FROM leads
     WHERE ${where}`;
}

export function mapLeadSummaryRow(row = {}) {
  return {
    total: Number(row.metric_total || 0),
    active: Number(row.metric_active || 0),
    dueFollowUps: Number(row.metric_due_follow_ups || 0),
    highPriority: Number(row.metric_high_priority || 0),
    withoutOwner: Number(row.metric_without_owner || 0),
    withoutNextStep: Number(row.metric_without_next_step || 0),
    hotLeads: Number(row.metric_hot_leads || 0),
    agencyOpportunities: Number(row.metric_agency_opportunities || 0),
    needsMapping: Number(row.metric_needs_mapping || 0),
    expansionOpportunities: Number(row.metric_expansion_opportunities || 0),
    deleted: Number(row.metric_deleted || 0),
  };
}
