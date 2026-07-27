import { buildLeadSearchTextFromRow } from "./leadMapper.js";

export function buildLeadSearchIndexBatchUpdate(rows, { onlyMissing = true } = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.id);
  if (!normalizedRows.length) return { sql: "", params: [] };

  const fragments = normalizedRows.map((_, index) => index === 0
    ? "SELECT ? AS id, ? AS search_text"
    : "SELECT ?, ?");
  const params = [];
  for (const row of normalizedRows) {
    params.push(String(row.id), buildLeadSearchTextFromRow(row));
  }

  return {
    sql: `UPDATE leads l\n      INNER JOIN (\n        ${fragments.join("\n        UNION ALL\n        ")}\n      ) p ON p.id = l.id\n      SET l.search_text = p.search_text${onlyMissing ? "\n      WHERE l.search_text IS NULL OR l.search_text = ''" : ""}`,
    params,
  };
}
