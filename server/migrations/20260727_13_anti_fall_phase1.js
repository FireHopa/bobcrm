export const version = "20260727_13_anti_fall_phase1";
export const description = "Proteções anti-queda: índice de etapa e backfill set-based de responsáveis";

export async function up({ addIndexIfMissing, execute }) {
  // Repara vínculos legados em uma única passagem pela tabela, evitando um UPDATE por usuário.
  await execute(`
    UPDATE leads l
    INNER JOIN (
      SELECT identity_key, MIN(user_id) AS user_id
      FROM (
        SELECT id AS user_id, LOWER(TRIM(name)) AS identity_key
        FROM users
        WHERE TRIM(COALESCE(name, '')) != ''
        UNION ALL
        SELECT id AS user_id, LOWER(TRIM(email)) AS identity_key
        FROM users
        WHERE TRIM(COALESCE(email, '')) != ''
      ) identities
      GROUP BY identity_key
      HAVING COUNT(DISTINCT user_id) = 1
    ) resolved ON resolved.identity_key = LOWER(TRIM(l.responsible))
    SET l.responsible_user_id = resolved.user_id
    WHERE l.responsible_user_id = ''
      AND TRIM(COALESCE(l.responsible, '')) != ''
  `);

  // Cobre MAX/ORDER/rebalance por etapa sem exigir pipeline_id no predicado.
  await addIndexIfMissing(
    "leads",
    "idx_leads_stage_active_position",
    "INDEX idx_leads_stage_active_position (pipeline_stage_id, deleted_at, kanban_position, id)",
  );
}
