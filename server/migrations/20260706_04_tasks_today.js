export const version = "20260706_04_tasks_today";
export const description = "Tarefas comerciais reais e compatibilidade com próximo contato";

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      type VARCHAR(40) NOT NULL DEFAULT 'follow_up',
      title VARCHAR(180) NOT NULL DEFAULT '',
      description MEDIUMTEXT NULL,
      responsible_user_id VARCHAR(64) NOT NULL DEFAULT '',
      responsible_name VARCHAR(255) NOT NULL DEFAULT '',
      created_by VARCHAR(64) NOT NULL DEFAULT '',
      created_by_name VARCHAR(255) NOT NULL DEFAULT '',
      lead_id VARCHAR(64) NOT NULL DEFAULT '',
      due_at VARCHAR(40) NOT NULL DEFAULT '',
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      result MEDIUMTEXT NULL,
      completed_at VARCHAR(40) NOT NULL DEFAULT '',
      completed_by VARCHAR(64) NOT NULL DEFAULT '',
      next_task_id VARCHAR(64) NOT NULL DEFAULT '',
      recurrence VARCHAR(80) NOT NULL DEFAULT '',
      source VARCHAR(40) NOT NULL DEFAULT 'manual',
      source_key VARCHAR(255) NULL,
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      UNIQUE KEY idx_tasks_source_key_unique (source_key),
      INDEX idx_tasks_responsible_due (responsible_user_id, status, due_at),
      INDEX idx_tasks_lead (lead_id, status, due_at),
      INDEX idx_tasks_status_due (status, due_at),
      INDEX idx_tasks_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    INSERT IGNORE INTO tasks (
      id, type, title, description, responsible_user_id, responsible_name,
      created_by, created_by_name, lead_id, due_at, priority, status,
      source, source_key, created_at, updated_at
    )
    SELECT
      UUID(), 'follow_up',
      CONCAT('Follow-up com ', COALESCE(NULLIF(TRIM(l.name), ''), NULLIF(TRIM(l.company), ''), NULLIF(TRIM(l.phone), ''), 'lead')),
      'Tarefa criada a partir do campo legado de próximo contato.',
      COALESCE(l.responsible_user_id, ''), COALESCE(l.responsible, ''),
      '', 'Migração do CRM', l.id, l.next_contact_at, 'normal', 'pending',
      'legacy_next_contact', CONCAT('lead-next-contact:', l.id), COALESCE(NULLIF(l.updated_at, ''), NULLIF(l.created_at, ''), NOW()), COALESCE(NULLIF(l.updated_at, ''), NULLIF(l.created_at, ''), NOW())
    FROM leads l
    WHERE l.deleted_at = ''
      AND l.is_lost = 0
      AND l.status NOT IN ('Perdido', 'Fechado')
      AND TRIM(COALESCE(l.next_contact_at, '')) != ''
  `);
}
