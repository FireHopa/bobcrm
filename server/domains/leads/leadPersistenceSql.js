export const LEAD_PERSISTENCE_COLUMNS = Object.freeze([
  "id", "name", "email", "email_key", "phone", "phone_key", "company", "name_company_key", "website",
  "advertises_on_meta", "advertises_on_google", "does_not_advertise",
  "last_contact_at", "contact_made_at", "next_contact_at", "expected_close_at", "estimated_budget",
  "is_lost", "lost_reason", "commercial_notes", "status", "responsible", "responsible_user_id", "temperature",
  "pain", "source", "service_interests", "service_status_map", "custom_fields", "search_text", "created_at", "updated_at",
  "deleted_at", "deleted_by", "restored_at", "restored_by",
  "pipeline_id", "pipeline_stage_id", "kanban_position", "pipeline_entered_at",
  "commercial_profile_version", "commercial_profile_updated_at", "commercial_potential_score", "mapping_urgency_score",
  "lead_priority_score", "opportunity_score", "service_casa_count", "service_agency_count", "service_missing_count", "service_unknown_count",
  "has_expansion_opportunity", "has_migration_opportunity", "has_external_agency",
]);

export const LEAD_PERSISTENCE_UPDATE_COLUMNS = Object.freeze([
  "name", "email", "email_key", "phone", "phone_key", "company", "name_company_key", "website",
  "advertises_on_meta", "advertises_on_google", "does_not_advertise",
  "last_contact_at", "contact_made_at", "next_contact_at", "expected_close_at", "estimated_budget",
  "is_lost", "lost_reason", "commercial_notes", "status", "responsible", "responsible_user_id", "temperature",
  "pain", "source", "service_interests", "service_status_map", "custom_fields", "search_text",
  "pipeline_id", "pipeline_stage_id", "kanban_position", "pipeline_entered_at",
  "commercial_profile_version", "commercial_profile_updated_at", "commercial_potential_score", "mapping_urgency_score",
  "lead_priority_score", "opportunity_score", "service_casa_count", "service_agency_count", "service_missing_count", "service_unknown_count",
  "has_expansion_opportunity", "has_migration_opportunity", "has_external_agency", "updated_at",
]);

export function buildLeadUpsertSql(rowCount = 1) {
  const count = Math.max(1, Math.floor(Number(rowCount || 1)));
  const rowPlaceholders = `(${LEAD_PERSISTENCE_COLUMNS.map(() => "?").join(", ")})`;
  const valuesSql = Array.from({ length: count }, () => rowPlaceholders).join(",\n    ");
  const updateAssignments = LEAD_PERSISTENCE_UPDATE_COLUMNS
    .map((column) => `${column} = VALUES(${column})`)
    .join(",\n    ");

  return `
  INSERT INTO leads (
    ${LEAD_PERSISTENCE_COLUMNS.join(", ")}
  ) VALUES
    ${valuesSql}
  ON DUPLICATE KEY UPDATE
    ${updateAssignments},
    deleted_at = '',
    deleted_by = '',
    restored_at = '',
    restored_by = ''
`;
}

export const UPSERT_LEAD_SQL = buildLeadUpsertSql(1);
