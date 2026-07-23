export const version = "20260706_03_commercial_roles_notes";
export const description = "Papéis comerciais oficiais, data prevista de fechamento e notas do lead";

export async function up({ addColumnIfMissing, addIndexIfMissing, execute }) {
  await addColumnIfMissing("leads", "expected_close_at", "VARCHAR(40) NOT NULL DEFAULT '' AFTER next_contact_at");
  await addIndexIfMissing("leads", "idx_leads_expected_close", "INDEX idx_leads_expected_close (deleted_at, expected_close_at, responsible_user_id)");

  await execute(`
    CREATE TABLE IF NOT EXISTS lead_notes (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      lead_id VARCHAR(64) NOT NULL,
      body MEDIUMTEXT NOT NULL,
      created_by VARCHAR(64) NOT NULL DEFAULT '',
      created_by_name VARCHAR(255) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_lead_notes_lead (lead_id, created_at),
      INDEX idx_lead_notes_author (created_by, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute("UPDATE users SET role = 'consultor_vendas', lead_access_scope = 'own' WHERE role = 'vendedor'");
  await execute("UPDATE users SET role = 'pre_venda', lead_access_scope = 'all' WHERE role = 'gerente'");
  await execute("UPDATE users SET role = 'consultor_vendas', lead_access_scope = 'none', is_active = 0 WHERE role = 'leitura'");
  await execute("UPDATE users SET lead_access_scope = 'all' WHERE role IN ('admin', 'pre_venda')");
  await execute("UPDATE users SET lead_access_scope = 'own' WHERE role = 'consultor_vendas' AND lead_access_scope != 'none'");
}
