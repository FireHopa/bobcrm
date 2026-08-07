export const version = "20260806_20_bidirectional_sync_attribution_phase5";
export const description = "Sincronização bidirecional Zape, atribuição por conta e métricas comerciais";

export async function up({ execute, addColumnIfMissing, addIndexIfMissing }) {
  await addColumnIfMissing("leads", "expected_value", "DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER estimated_budget");
  await addColumnIfMissing("leads", "closed_value", "DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER expected_value");
  await addColumnIfMissing("leads", "won_at", "DATETIME(3) NULL AFTER closed_value");
  await addColumnIfMissing("leads", "lost_at", "DATETIME(3) NULL AFTER won_at");
  await addColumnIfMissing("kanban_stages", "semantic_key", "VARCHAR(32) NOT NULL DEFAULT '' AFTER status_key");

  await execute(`CREATE TABLE IF NOT EXISTS lead_whatsapp_attributions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    lead_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(120) NOT NULL DEFAULT '',
    channel VARCHAR(80) NOT NULL DEFAULT 'WhatsApp',
    first_seen_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    first_inbound_at DATETIME(3) NULL,
    first_outbound_at DATETIME(3) NULL,
    last_inbound_at DATETIME(3) NULL,
    last_outbound_at DATETIME(3) NULL,
    first_response_ms BIGINT UNSIGNED NULL,
    interaction_count INT UNSIGNED NOT NULL DEFAULT 0,
    inbound_count INT UNSIGNED NOT NULL DEFAULT 0,
    outbound_count INT UNSIGNED NOT NULL DEFAULT 0,
    is_first_touch TINYINT(1) NOT NULL DEFAULT 0,
    is_last_touch TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_lead_whatsapp_attribution (lead_id, tenant_id),
    INDEX idx_whatsapp_attr_tenant_first (tenant_id, first_seen_at),
    INDEX idx_whatsapp_attr_tenant_last (tenant_id, last_seen_at),
    INDEX idx_whatsapp_attr_lead_touch (lead_id, is_first_touch, is_last_touch)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS lead_whatsapp_activity (
    id CHAR(36) NOT NULL PRIMARY KEY,
    event_key VARCHAR(255) NOT NULL,
    lead_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(120) NOT NULL DEFAULT '',
    direction VARCHAR(16) NOT NULL DEFAULT 'inbound',
    channel VARCHAR(80) NOT NULL DEFAULT 'WhatsApp',
    message_id VARCHAR(191) NOT NULL DEFAULT '',
    conversation_id VARCHAR(191) NOT NULL DEFAULT '',
    message_preview VARCHAR(500) NOT NULL DEFAULT '',
    occurred_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_whatsapp_activity_event (event_key),
    INDEX idx_whatsapp_activity_lead_time (lead_id, occurred_at),
    INDEX idx_whatsapp_activity_tenant_time (tenant_id, occurred_at),
    INDEX idx_whatsapp_activity_direction_time (direction, occurred_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS zape_reverse_sync_outbox (
    id CHAR(36) NOT NULL PRIMARY KEY,
    event_key VARCHAR(255) NOT NULL,
    event_type VARCHAR(120) NOT NULL DEFAULT 'crm.lead.snapshot',
    lead_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(120) NOT NULL DEFAULT '',
    entity_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    payload_json JSON NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NULL,
    last_attempt_at DATETIME(3) NULL,
    last_error TEXT NULL,
    last_http_status INT NOT NULL DEFAULT 0,
    response_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    delivered_at DATETIME(3) NULL,
    UNIQUE KEY uq_zape_reverse_sync_event (event_key),
    INDEX idx_zape_reverse_sync_due (status, next_attempt_at, created_at),
    INDEX idx_zape_reverse_sync_lead (lead_id, tenant_id, created_at),
    INDEX idx_zape_reverse_sync_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`CREATE TABLE IF NOT EXISTS zape_reverse_sync_state (
    state_key VARCHAR(120) NOT NULL PRIMARY KEY,
    state_value JSON NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await execute(`UPDATE kanban_stages SET semantic_key = CASE
    WHEN stage_type = 'won' THEN 'won'
    WHEN stage_type = 'lost' THEN 'lost'
    WHEN LOWER(name) REGEXP 'proposta|or[cç]amento' THEN 'proposal'
    WHEN LOWER(name) REGEXP 'reuni[aã]o|diagn[oó]stico|agend' THEN 'meeting'
    WHEN LOWER(name) REGEXP 'qualific' THEN 'qualified'
    WHEN LOWER(name) REGEXP 'contato|resposta|atendimento' THEN 'contacted'
    WHEN LOWER(name) REGEXP 'negocia' THEN 'negotiation'
    ELSE 'new' END
    WHERE semantic_key = ''`);

  await execute(`INSERT IGNORE INTO lead_whatsapp_attributions (
    id, lead_id, tenant_id, channel, first_seen_at, last_seen_at,
    interaction_count, inbound_count, outbound_count, is_first_touch, is_last_touch, created_at, updated_at
  )
  SELECT UUID(), leo.lead_id, leo.tenant_id, 'WhatsApp',
         COALESCE(STR_TO_DATE(LEFT(leo.first_seen_at, 23), '%Y-%m-%dT%H:%i:%s.%f'), NOW(3)),
         COALESCE(STR_TO_DATE(LEFT(leo.last_seen_at, 23), '%Y-%m-%dT%H:%i:%s.%f'), NOW(3)),
         GREATEST(1, leo.occurrences), GREATEST(1, leo.occurrences), 0, 0, 0, NOW(3), NOW(3)
  FROM lead_external_origins leo
  WHERE leo.provider = 'zape' AND leo.tenant_id <> ''`);

  await execute(`UPDATE lead_whatsapp_attributions a
    JOIN (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY first_seen_at ASC, id ASC) AS first_rank,
        ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY last_seen_at DESC, id DESC) AS last_rank
      FROM lead_whatsapp_attributions
    ) ranked ON ranked.id=a.id
    SET a.is_first_touch=IF(ranked.first_rank=1,1,0),
        a.is_last_touch=IF(ranked.last_rank=1,1,0)`);

  await addIndexIfMissing("leads", "idx_leads_won_at", "INDEX idx_leads_won_at (won_at, pipeline_stage_id)");
  await addIndexIfMissing("leads", "idx_leads_lost_at", "INDEX idx_leads_lost_at (lost_at, pipeline_stage_id)");
  await addIndexIfMissing("kanban_stages", "idx_kanban_stages_semantic", "INDEX idx_kanban_stages_semantic (semantic_key, pipeline_id)");
}
