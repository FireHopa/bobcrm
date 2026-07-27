const joinFields = (fields) => fields.join(", ");

export const LEAD_LIST_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "company",
  "website",
  "advertises_on_meta",
  "advertises_on_google",
  "does_not_advertise",
  "last_contact_at",
  "contact_made_at",
  "next_contact_at",
  "expected_close_at",
  "estimated_budget",
  "is_lost",
  "status",
  "responsible",
  "responsible_user_id",
  "temperature",
  "source",
  "created_at",
  "updated_at",
  "pipeline_id",
  "pipeline_stage_id",
  "kanban_position",
  "pipeline_entered_at",
];

export const LEAD_OPPORTUNITY_FIELDS = [
  ...LEAD_LIST_FIELDS,
  "pain",
  "service_interests",
  "service_status_map",
  "custom_fields",
];

export const LEAD_KANBAN_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "company",
  "next_contact_at",
  "is_lost",
  "status",
  "responsible",
  "responsible_user_id",
  "temperature",
  "created_at",
  "updated_at",
  "pipeline_id",
  "pipeline_stage_id",
  "kanban_position",
  "pipeline_entered_at",
];

export const LEAD_TRASH_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "company",
  "status",
  "responsible",
  "responsible_user_id",
  "temperature",
  "created_at",
  "updated_at",
  "deleted_at",
  "deleted_by",
  "pipeline_id",
  "pipeline_stage_id",
  "kanban_position",
  "pipeline_entered_at",
];

export const LEAD_SEARCH_INDEX_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "company",
  "website",
  "expected_close_at",
  "estimated_budget",
  "status",
  "responsible",
  "responsible_user_id",
  "temperature",
  "pain",
  "lost_reason",
  "commercial_notes",
  "source",
  "service_interests",
  "service_status_map",
  "custom_fields",
];

export const LEAD_DUPLICATE_FIELDS = [
  "id",
  "name",
  "email",
  "email_key",
  "phone",
  "phone_key",
  "company",
  "name_company_key",
  "website",
  "responsible",
  "responsible_user_id",
  "temperature",
  "pain",
  "next_contact_at",
  "created_at",
  "updated_at",
];

export const LEAD_LIST_SELECT = joinFields(LEAD_LIST_FIELDS);
export const LEAD_OPPORTUNITY_SELECT = joinFields(LEAD_OPPORTUNITY_FIELDS);
export const LEAD_KANBAN_SELECT = joinFields(LEAD_KANBAN_FIELDS);
export const LEAD_TRASH_SELECT = joinFields(LEAD_TRASH_FIELDS);
export const LEAD_SEARCH_INDEX_SELECT = joinFields(LEAD_SEARCH_INDEX_FIELDS);

export function qualifyLeadFields(fields, alias = "l") {
  const safeAlias = String(alias || "").replace(/[^a-zA-Z0-9_]/g, "");
  return fields.map((field) => safeAlias ? `${safeAlias}.${field}` : field).join(", ");
}

export function getLeadListProjection({ includeCommercialContext = false } = {}) {
  return includeCommercialContext ? LEAD_OPPORTUNITY_SELECT : LEAD_LIST_SELECT;
}

export const LEAD_IMPORT_MERGE_FIELDS = [
  "id",
  "name",
  "email",
  "email_key",
  "phone",
  "phone_key",
  "company",
  "name_company_key",
  "website",
  "advertises_on_meta",
  "advertises_on_google",
  "does_not_advertise",
  "last_contact_at",
  "contact_made_at",
  "next_contact_at",
  "expected_close_at",
  "estimated_budget",
  "is_lost",
  "lost_reason",
  "commercial_notes",
  "status",
  "responsible",
  "responsible_user_id",
  "temperature",
  "pain",
  "source",
  "service_interests",
  "service_status_map",
  "custom_fields",
  "created_at",
  "updated_at",
  "deleted_at",
  "deleted_by",
  "restored_at",
  "restored_by",
  "pipeline_id",
  "pipeline_stage_id",
  "kanban_position",
  "pipeline_entered_at",
];

export const LEAD_IMPORT_MERGE_SELECT = joinFields(LEAD_IMPORT_MERGE_FIELDS);
