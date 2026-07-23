export const version = "20260706_02_lead_scope_teams";
export const description = "Escopo de carteira, equipes e vínculo estruturado de responsável";

export async function up({
  addColumnIfMissing,
  addIndexIfMissing,
  backfillLeadResponsibleUserIds,
}) {
  await addColumnIfMissing("leads", "responsible_user_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER responsible");
  await addColumnIfMissing("users", "team_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER role");
  await addColumnIfMissing("users", "lead_access_scope", "VARCHAR(20) NOT NULL DEFAULT 'all' AFTER team_id");
  await addIndexIfMissing("leads", "idx_leads_responsible_user", "INDEX idx_leads_responsible_user (deleted_at, responsible_user_id, updated_at)");
  await addIndexIfMissing("users", "idx_users_team", "INDEX idx_users_team (team_id, is_active)");
  await addIndexIfMissing("users", "idx_users_lead_scope", "INDEX idx_users_lead_scope (lead_access_scope, is_active)");
  await backfillLeadResponsibleUserIds();
}
