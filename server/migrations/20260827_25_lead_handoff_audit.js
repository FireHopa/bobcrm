export const version = "20260827_25_lead_handoff_audit";
export const description = "historico normalizado e auditavel de encaminhamentos de leads";

function jsonText(path) {
  return `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.changes_json, '${path}')), 'null'), '')`;
}

export async function up({ execute }) {
  await execute(`CREATE TABLE IF NOT EXISTS lead_handoffs (
    id VARCHAR(64) NOT NULL,
    lead_id VARCHAR(64) NOT NULL,
    lead_name VARCHAR(255) NOT NULL DEFAULT '',
    lead_company VARCHAR(255) NOT NULL DEFAULT '',
    from_user_id VARCHAR(64) NOT NULL DEFAULT '',
    from_user_name VARCHAR(255) NOT NULL DEFAULT '',
    actor_user_id VARCHAR(64) NOT NULL DEFAULT '',
    actor_name VARCHAR(255) NOT NULL DEFAULT '',
    actor_role VARCHAR(40) NOT NULL DEFAULT '',
    to_user_id VARCHAR(64) NOT NULL DEFAULT '',
    to_user_name VARCHAR(255) NOT NULL DEFAULT '',
    to_user_role VARCHAR(40) NOT NULL DEFAULT '',
    pipeline_id VARCHAR(64) NOT NULL DEFAULT '',
    pipeline_name VARCHAR(160) NOT NULL DEFAULT '',
    stage_id VARCHAR(64) NOT NULL DEFAULT '',
    stage_name VARCHAR(160) NOT NULL DEFAULT '',
    request_id VARCHAR(128) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    INDEX idx_lead_handoffs_actor_created (actor_user_id, created_at),
    INDEX idx_lead_handoffs_target_created (to_user_id, created_at),
    INDEX idx_lead_handoffs_lead_created (lead_id, created_at),
    INDEX idx_lead_handoffs_role_created (actor_role, created_at),
    INDEX idx_lead_handoffs_created (created_at),
    INDEX idx_lead_handoffs_request (request_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Backfill best-effort dos encaminhamentos que já estavam registrados no audit_log.
  // O INSERT IGNORE torna a migration idempotente e preserva eventos já normalizados.
  await execute(`INSERT IGNORE INTO lead_handoffs (
      id, lead_id, lead_name, lead_company,
      from_user_id, from_user_name,
      actor_user_id, actor_name, actor_role,
      to_user_id, to_user_name, to_user_role,
      pipeline_id, pipeline_name, stage_id, stage_name,
      request_id, created_at
    )
    SELECT
      a.id,
      a.entity_id,
      COALESCE(l.name, ''),
      COALESCE(l.company, ''),
      ${jsonText("$.responsibleUserId.from")},
      ${jsonText("$.responsible.from")},
      a.actor_id,
      a.actor_name,
      COALESCE(actor.role, ''),
      ${jsonText("$.responsibleUserId.to")},
      ${jsonText("$.responsible.to")},
      COALESCE(target.role, ''),
      ${jsonText("$.pipelineId.to")},
      COALESCE(p.name, ''),
      ${jsonText("$.pipelineStageId.to")},
      COALESCE(s.name, ''),
      ${jsonText("$.requestId")},
      a.created_at
    FROM audit_log a
    LEFT JOIN leads l ON l.id = a.entity_id
    LEFT JOIN users actor ON actor.id = a.actor_id
    LEFT JOIN users target ON target.id = ${jsonText("$.responsibleUserId.to")}
    LEFT JOIN kanban_pipelines p ON p.id = ${jsonText("$.pipelineId.to")}
    LEFT JOIN kanban_stages s ON s.id = ${jsonText("$.pipelineStageId.to")}
    WHERE a.entity_type = 'lead'
      AND a.action = 'lead_handed_off'
      AND JSON_VALID(a.changes_json)`);
}
