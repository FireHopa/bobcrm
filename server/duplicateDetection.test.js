import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDuplicateGroupsCountSql,
  buildDuplicateGroupsPageSql,
  buildDuplicateLeadLookup,
  mapDuplicateGroups,
  sortDuplicateLeadsForPrimary,
} from "./duplicateDetection.js";

test("detecção de duplicados agrupa a base autorizada completa no servidor", () => {
  const where = "l.deleted_at = '' AND l.responsible_user_id = ?";
  const countSql = buildDuplicateGroupsCountSql({ where, alias: "l" });
  const pageSql = buildDuplicateGroupsPageSql({ where, alias: "l" });
  assert.equal((countSql.match(/responsible_user_id = \?/g) || []).length, 3);
  assert.equal((pageSql.match(/responsible_user_id = \?/g) || []).length, 3);
  assert.match(pageSql, /GROUP BY l\.email_key/);
  assert.match(pageSql, /GROUP BY l\.phone_key/);
  assert.match(pageSql, /GROUP BY l\.name_company_key/);
  assert.match(pageSql, /LIMIT \? OFFSET \?/);
});

test("lookup de leads duplicados reaplica escopo e usa somente chaves selecionadas", () => {
  const lookup = buildDuplicateLeadLookup({
    where: "l.deleted_at = '' AND l.responsible_user_id = ?",
    alias: "l",
    groups: [
      { reason: "email", duplicateKey: "a@b.com" },
      { reason: "phone", duplicateKey: "5511999999999" },
    ],
  });
  assert.match(lookup.sql, /l\.responsible_user_id = \?/);
  assert.match(lookup.sql, /l\.email_key = \?/);
  assert.match(lookup.sql, /l\.phone_key = \?/);
  assert.deepEqual(lookup.params, ["a@b.com", "5511999999999"]);
});

test("principal sugerido prioriza cadastro mais completo e mantém ordem determinística", () => {
  const leads = sortDuplicateLeadsForPrimary([
    { id: "2", name: "Ana", createdAt: "2026-01-01" },
    { id: "1", name: "Ana", email: "ana@empresa.com", phone: "11999999999", createdAt: "2026-02-01" },
  ]);
  assert.equal(leads[0].id, "1");
});

test("grupos retornam os leads correspondentes sem misturar motivos", () => {
  const groups = mapDuplicateGroups(
    [{ reason: "email", duplicate_key: "a@b.com", lead_count: 2 }],
    [
      { id: "1", email_key: "a@b.com", name: "A" },
      { id: "2", email_key: "a@b.com", name: "B" },
      { id: "3", email_key: "x@y.com", name: "C" },
    ],
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].leads.map((lead) => lead.id).sort(), ["1", "2"]);
});
