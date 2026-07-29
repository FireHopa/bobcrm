export const version = "20260727_12_consultant_portfolio_performance";
export const description = "Carteira de consultor indexável e rebinding de responsáveis legados";

export async function up({ addIndexIfMissing, backfillLeadResponsibleUserIds }) {
  // Reaplica o backfill porque podem existir leads legados criados antes do
  // usuário atual ou registros que ainda possuam apenas o nome do responsável.
  await backfillLeadResponsibleUserIds();

  // Cobre o filtro da carteira e a ordenação padrão da listagem/cursor.
  await addIndexIfMissing(
    "leads",
    "idx_leads_owner_updated_id",
    "INDEX idx_leads_owner_updated_id (deleted_at, responsible_user_id, updated_at, id)",
  );
}
