export const version = "20260827_23_sdr_origin_attribution";
export const description = "Persiste o SDR de origem do lead e recupera atribuições históricas auditáveis";

export async function up({ addColumnIfMissing, addIndexIfMissing, execute }) {
  await addColumnIfMissing("leads", "sdr_responsible", "VARCHAR(255) NOT NULL DEFAULT '' AFTER responsible_user_id");
  await addColumnIfMissing("leads", "sdr_responsible_user_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER sdr_responsible");
  await addIndexIfMissing(
    "leads",
    "idx_leads_sdr_responsible_user",
    "INDEX idx_leads_sdr_responsible_user (deleted_at, sdr_responsible_user_id, updated_at)",
  );

  // Recupera somente casos em que existe evidência explícita no audit_log de que
  // o lead foi criado por um usuário que hoje corresponde ao papel Pré-venda/SDR.
  // Não tenta inferir SDR por responsável, carteira ou nome, evitando atribuições falsas.
  await execute(`UPDATE leads l
    INNER JOIN audit_log a
      ON a.entity_type = 'lead'
     AND a.entity_id = l.id
     AND a.action = 'lead_created'
    INNER JOIN users u
      ON u.id = a.actor_id
     AND u.role IN ('pre_venda', 'gerente')
    LEFT JOIN audit_log earlier
      ON earlier.entity_type = 'lead'
     AND earlier.entity_id = a.entity_id
     AND earlier.action = 'lead_created'
     AND (earlier.created_at < a.created_at OR (earlier.created_at = a.created_at AND earlier.id < a.id))
    SET l.sdr_responsible_user_id = a.actor_id,
        l.sdr_responsible = COALESCE(NULLIF(TRIM(a.actor_name), ''), NULLIF(TRIM(u.name), ''), u.email, '')
    WHERE TRIM(COALESCE(l.sdr_responsible_user_id, '')) = ''
      AND earlier.id IS NULL`);
}
