import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadOwnerOptionsSql } from "./leadFilterOptionsSql.js";

test("opções de responsável agrupam pela chave canônica e evitam funções na coluna de filtro", () => {
  const sql = buildLeadOwnerOptionsSql("l.responsible_user_id IN (?, ?)");
  assert.match(sql, /GROUP BY l\.responsible_user_id/);
  assert.match(sql, /l\.responsible_user_id != ''/);
  assert.match(sql, /LEFT JOIN users u ON u\.id = l\.responsible_user_id/);
  assert.doesNotMatch(sql, /GROUP BY\s+TRIM|LOWER\(TRIM/i);
});
