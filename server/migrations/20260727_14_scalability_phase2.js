export const version = "20260727_14_scalability_phase2";
export const description = "Escalabilidade: índices compostos para listagem, filtros comerciais, tarefas e integrações";

export async function up({ addIndexIfMissing }) {
  await addIndexIfMissing(
    "leads",
    "idx_leads_active_updated_id",
    "INDEX idx_leads_active_updated_id (deleted_at, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_status_updated_id",
    "INDEX idx_leads_status_updated_id (deleted_at, status, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_temperature_updated_id",
    "INDEX idx_leads_temperature_updated_id (deleted_at, temperature, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_owner_name_updated_id",
    "INDEX idx_leads_owner_name_updated_id (deleted_at, responsible, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_priority_score_updated",
    "INDEX idx_leads_priority_score_updated (deleted_at, is_lost, status, lead_priority_score, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_mapping_score_updated",
    "INDEX idx_leads_mapping_score_updated (deleted_at, is_lost, status, mapping_urgency_score, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_agency_updated",
    "INDEX idx_leads_agency_updated (deleted_at, has_external_agency, updated_at, id)",
  );
  await addIndexIfMissing(
    "leads",
    "idx_leads_expansion_updated",
    "INDEX idx_leads_expansion_updated (deleted_at, has_expansion_opportunity, updated_at, id)",
  );
  await addIndexIfMissing(
    "tasks",
    "idx_tasks_status_due_dt_owner",
    "INDEX idx_tasks_status_due_dt_owner (status, due_at_dt, responsible_user_id, priority)",
  );
  await addIndexIfMissing(
    "integration_events",
    "idx_integration_events_status_updated",
    "INDEX idx_integration_events_status_updated (status, updated_at)",
  );
}
