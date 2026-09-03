export function buildLeadOwnerOptionsSql(accessClause = "1 = 1") {
  return `SELECT
      l.responsible_user_id AS responsible_user_id,
      COALESCE(NULLIF(MAX(u.name), ''), NULLIF(MAX(u.email), ''), NULLIF(MAX(l.responsible), '')) AS name,
      COUNT(*) AS total
    FROM leads l
    LEFT JOIN users u ON u.id = l.responsible_user_id
    WHERE l.deleted_at = ''
      AND l.responsible_user_id != ''
      AND ${accessClause}
    GROUP BY l.responsible_user_id
    HAVING name IS NOT NULL AND name != ''
    ORDER BY name ASC
    LIMIT 500`;
}

export function buildLeadSourceOptionsSql(accessClause = "1 = 1") {
  return `WITH scoped_leads AS (
      SELECT l.id, l.source
      FROM leads l
      WHERE l.deleted_at = ''
        AND ${accessClause}
    ), origin_options AS (
      SELECT sl.id AS lead_id, sl.source AS name
      FROM scoped_leads sl
      WHERE TRIM(COALESCE(sl.source, '')) != ''

      UNION ALL

      SELECT sl.id AS lead_id, leo.webhook_name AS name
      FROM scoped_leads sl
      INNER JOIN lead_external_origins leo ON leo.lead_id = sl.id
      WHERE leo.provider = 'zape'
        AND TRIM(COALESCE(leo.webhook_name, '')) != ''
    )
    SELECT name, COUNT(DISTINCT lead_id) AS total
    FROM origin_options
    GROUP BY name
    ORDER BY name ASC
    LIMIT 500`;
}
