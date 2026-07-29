import { buildCommercialSqlExpressions } from "./opportunityRules.js";
import { mapLeadSummaryRow } from "./leadSummarySql.js";
import { mapOpportunitySummaryRow } from "./opportunityRules.js";
import { buildDateMissingPredicate, buildDatePresentPredicate } from "./dateColumns.js";

const DEFAULT_ACTIVE_WHERE = "deleted_at = '' AND is_lost = 0 AND status != 'Perdido' AND status != 'Fechado'";

function column(alias, name) {
  return alias ? `${alias}.${name}` : name;
}

/**
 * Builds the shared aggregate used by lead summary and opportunity summary.
 * The goal is one scan of the authorized lead scope instead of one scan per widget.
 */
export function buildLeadDashboardSummarySql({
  where = "1 = 1",
  activeWhere = DEFAULT_ACTIVE_WHERE,
  alias = "",
  useMaterialized = true,
  useDateColumns = false,
} = {}) {
  const commercial = buildCommercialSqlExpressions(alias, { useMaterialized });
  const deletedAt = column(alias, "deleted_at");
  const responsible = column(alias, "responsible");
  const responsibleUserId = column(alias, "responsible_user_id");
  const nextContactAt = column(alias, "next_contact_at");
  const nextContactAtDt = column(alias, "next_contact_at_dt");
  const temperature = column(alias, "temperature");
  const status = column(alias, "status");
  const isLost = column(alias, "is_lost");
  const contactMadeAt = column(alias, "contact_made_at");
  const updatedAt = column(alias, "updated_at");
  const updatedAtDt = column(alias, "updated_at_dt");
  const from = alias ? `leads ${alias}` : "leads";
  const active = activeWhere || DEFAULT_ACTIVE_WHERE;
  const notDeleted = `${deletedAt} = ''`;

  return `SELECT
      SUM(CASE WHEN ${notDeleted} THEN 1 ELSE 0 END) AS metric_total,
      SUM(CASE WHEN ${active} THEN 1 ELSE 0 END) AS metric_active,
      SUM(CASE WHEN ${active} AND ${buildDatePresentPredicate(alias, 'next_contact_at', 'next_contact_at_dt', useDateColumns)} AND ${useDateColumns ? `${nextContactAtDt} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)` : `LEFT(${nextContactAt}, 10) <= DATE_FORMAT(CURDATE(), '%Y-%m-%d')`} THEN 1 ELSE 0 END) AS metric_due_follow_ups,
      SUM(CASE WHEN ${active} AND (${commercial.leadPriority}) >= 70 THEN 1 ELSE 0 END) AS metric_high_priority,
      SUM(CASE WHEN ${active} AND TRIM(COALESCE(${responsible}, '')) = '' AND TRIM(COALESCE(${responsibleUserId}, '')) = '' THEN 1 ELSE 0 END) AS metric_without_owner,
      SUM(CASE WHEN ${active} AND ${buildDateMissingPredicate(alias, 'next_contact_at', 'next_contact_at_dt', useDateColumns)} THEN 1 ELSE 0 END) AS metric_without_next_step,
      SUM(CASE WHEN ${active} AND ${temperature} = 'Quente' THEN 1 ELSE 0 END) AS metric_hot_leads,
      SUM(CASE WHEN ${notDeleted} AND ${isLost} = 0 AND ${status} = 'Novo lead' AND TRIM(COALESCE(${contactMadeAt}, '')) = '' THEN 1 ELSE 0 END) AS metric_awaiting_first_contact,
      SUM(CASE WHEN ${active} AND ${useDateColumns ? `${updatedAtDt} < DATE_SUB(CURDATE(), INTERVAL 7 DAY)` : `LEFT(${updatedAt}, 10) < DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d')`} THEN 1 ELSE 0 END) AS metric_stalled,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.agency} THEN 1 ELSE 0 END) AS metric_agency_opportunities,
      SUM(CASE WHEN ${active} AND ${commercial.leadMapping} THEN 1 ELSE 0 END) AS metric_needs_mapping,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.leadExpansion} THEN 1 ELSE 0 END) AS metric_expansion_opportunities,
      SUM(CASE WHEN ${deletedAt} != '' THEN 1 ELSE 0 END) AS metric_deleted,
      SUM(CASE WHEN ${notDeleted} THEN 1 ELSE 0 END) AS opportunity_total,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.expansion} THEN 1 ELSE 0 END) AS opportunity_expansion,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.migration} THEN 1 ELSE 0 END) AS opportunity_migration,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.mapping} THEN 1 ELSE 0 END) AS opportunity_mapping,
      SUM(CASE WHEN ${notDeleted} AND (${commercial.opportunityScore}) >= 70 THEN 1 ELSE 0 END) AS opportunity_priority,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.agency} THEN 1 ELSE 0 END) AS opportunity_agency,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.withoutDiagnosis} THEN 1 ELSE 0 END) AS opportunity_without_diagnosis,
      SUM(CASE WHEN ${notDeleted} AND ${commercial.mappingCritical} THEN 1 ELSE 0 END) AS opportunity_mapping_critical,
      SUM(CASE WHEN ${notDeleted} THEN ${commercial.casaCount} ELSE 0 END) AS services_casa,
      SUM(CASE WHEN ${notDeleted} THEN ${commercial.agencyCount} ELSE 0 END) AS services_agency,
      SUM(CASE WHEN ${notDeleted} THEN ${commercial.notDoneCount} ELSE 0 END) AS services_not_done,
      SUM(CASE WHEN ${notDeleted} THEN ${commercial.unknownCount} ELSE 0 END) AS services_unknown
    FROM ${from}
    WHERE ${where}`;
}

export function mapLeadDashboardSummaryRow(row = {}) {
  return {
    summary: mapLeadSummaryRow(row),
    opportunitySummary: mapOpportunitySummaryRow(row),
    operationalMetrics: {
      awaitingFirstContact: Number(row.metric_awaiting_first_contact || 0),
      withoutOwner: Number(row.metric_without_owner || 0),
      withoutNextStep: Number(row.metric_without_next_step || 0),
      stalled: Number(row.metric_stalled || 0),
    },
  };
}
