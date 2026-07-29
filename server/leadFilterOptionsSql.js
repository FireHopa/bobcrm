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
