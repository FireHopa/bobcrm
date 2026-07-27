import { LEAD_KANBAN_SELECT } from "./domains/leads/leadProjections.js";


export function buildKanbanPipelinesSql(accessClause) {
  const scopedAccess = String(accessClause || "1 = 1");
  return `WITH stage_counts AS (
    SELECT pipeline_id, pipeline_stage_id, COUNT(*) AS stage_total
    FROM leads
    WHERE deleted_at = '' AND ${scopedAccess}
    GROUP BY pipeline_id, pipeline_stage_id
  ),
  pipeline_counts AS (
    SELECT pipeline_id, SUM(stage_total) AS pipeline_total
    FROM stage_counts
    GROUP BY pipeline_id
  )
  SELECT
    p.id AS __pipeline_id,
    p.name AS __pipeline_name,
    p.is_default AS __pipeline_is_default,
    p.is_archived AS __pipeline_is_archived,
    p.position AS __pipeline_position,
    p.created_at AS __pipeline_created_at,
    p.updated_at AS __pipeline_updated_at,
    COALESCE(pc.pipeline_total, 0) AS __pipeline_card_count,
    s.id,
    s.pipeline_id,
    s.name,
    s.color,
    s.position,
    s.stage_type,
    s.status_key,
    s.wip_limit,
    s.is_archived,
    s.created_at,
    s.updated_at,
    COALESCE(sc.stage_total, 0) AS __stage_card_count
  FROM kanban_pipelines p
  LEFT JOIN kanban_stages s
    ON s.pipeline_id = p.id
   AND s.is_archived = 0
  LEFT JOIN stage_counts sc
    ON sc.pipeline_id = p.id
   AND sc.pipeline_stage_id = s.id
  LEFT JOIN pipeline_counts pc
    ON pc.pipeline_id = p.id
  WHERE p.is_archived = 0
  ORDER BY p.position ASC, p.created_at ASC, s.position ASC, s.created_at ASC`;
}
export function buildKanbanBoardMetadataSql(accessClause) {
  const scopedAccess = String(accessClause || "1 = 1");
  return `WITH selected_pipeline AS (
    SELECT id, name, is_default, is_archived, position, created_at, updated_at
    FROM kanban_pipelines
    WHERE is_archived = 0
    ORDER BY
      CASE
        WHEN ? <> '' AND id = ? THEN 0
        WHEN is_default = 1 THEN 1
        ELSE 2
      END,
      position ASC,
      created_at ASC
    LIMIT 1
  ),
  stage_counts AS (
    SELECT l.pipeline_stage_id, COUNT(*) AS total
    FROM leads l
    INNER JOIN selected_pipeline p ON p.id = l.pipeline_id
    WHERE l.deleted_at = '' AND ${scopedAccess}
    GROUP BY l.pipeline_stage_id
  ),
  pipeline_count AS (
    SELECT COALESCE(SUM(total), 0) AS total
    FROM stage_counts
  )
  SELECT
    p.id AS __pipeline_id,
    p.name AS __pipeline_name,
    p.is_default AS __pipeline_is_default,
    p.is_archived AS __pipeline_is_archived,
    p.position AS __pipeline_position,
    p.created_at AS __pipeline_created_at,
    p.updated_at AS __pipeline_updated_at,
    pc.total AS __pipeline_card_count,
    s.id,
    s.pipeline_id,
    s.name,
    s.color,
    s.position,
    s.stage_type,
    s.status_key,
    s.wip_limit,
    s.is_archived,
    s.created_at,
    s.updated_at,
    COALESCE(sc.total, 0) AS __stage_card_count
  FROM selected_pipeline p
  CROSS JOIN pipeline_count pc
  LEFT JOIN kanban_stages s
    ON s.pipeline_id = p.id
   AND s.is_archived = 0
  LEFT JOIN stage_counts sc
    ON sc.pipeline_stage_id = s.id
  ORDER BY s.position ASC, s.created_at ASC`;
}

export function buildKanbanInitialCardsSql(where) {
  const scopedWhere = String(where || "1 = 1");
  return `WITH ranked_cards AS (
    SELECT
      ${LEAD_KANBAN_SELECT},
      COUNT(*) OVER (PARTITION BY pipeline_stage_id) AS __filtered_card_count,
      ROW_NUMBER() OVER (
        PARTITION BY pipeline_stage_id
        ORDER BY kanban_position ASC, updated_at DESC, created_at DESC, id ASC
      ) AS __row_num
    FROM leads
    WHERE ${scopedWhere} AND pipeline_id = ?
  )
  SELECT
    ${LEAD_KANBAN_SELECT},
    __filtered_card_count,
    __row_num
  FROM ranked_cards
  WHERE __row_num <= ?
  ORDER BY pipeline_stage_id ASC, __row_num ASC`;
}

export function buildKanbanStagePageSql(where) {
  const scopedWhere = String(where || "1 = 1");
  return `SELECT
    ${LEAD_KANBAN_SELECT},
    COUNT(*) OVER () AS __filtered_card_count
  FROM leads
  WHERE ${scopedWhere}
  ORDER BY kanban_position ASC, updated_at DESC, created_at DESC, id ASC
  LIMIT ? OFFSET ?`;
}
