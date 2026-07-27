import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LEAD_DUPLICATE_FIELDS,
  LEAD_KANBAN_FIELDS,
  LEAD_LIST_FIELDS,
  LEAD_OPPORTUNITY_FIELDS,
  LEAD_TRASH_FIELDS,
  getLeadListProjection,
} from "./domains/leads/leadProjections.js";

const [serverSource, kanbanSqlSource, appSource, apiSource, settingsSource] = await Promise.all([
  readFile(new URL("./index.js", import.meta.url), "utf8"),
  readFile(new URL("./kanbanBoardSql.js", import.meta.url), "utf8"),
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/utils/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/SettingsCenter.tsx", import.meta.url), "utf8"),
]);

const HEAVY_LIST_FIELDS = [
  "commercial_notes",
  "pain",
  "service_interests",
  "service_status_map",
  "custom_fields",
  "search_text",
];

test("listagem padrão usa projeção enxuta sem campos pesados", () => {
  for (const field of HEAVY_LIST_FIELDS) assert.equal(LEAD_LIST_FIELDS.includes(field), false, field);
  assert.match(getLeadListProjection(), /id, name, email, phone, company/);
  assert.doesNotMatch(getLeadListProjection(), /commercial_notes|search_text|service_status_map/);
});

test("mapa de oportunidades recebe somente o contexto comercial necessário", () => {
  for (const field of ["pain", "service_interests", "service_status_map", "custom_fields"]) {
    assert.equal(LEAD_OPPORTUNITY_FIELDS.includes(field), true, field);
  }
  for (const field of ["commercial_notes", "search_text"]) {
    assert.equal(LEAD_OPPORTUNITY_FIELDS.includes(field), false, field);
  }
});

test("kanban e lixeira não carregam MEDIUMTEXT nem JSON comercial", () => {
  for (const fields of [LEAD_KANBAN_FIELDS, LEAD_TRASH_FIELDS]) {
    for (const field of HEAVY_LIST_FIELDS) assert.equal(fields.includes(field), false, field);
  }
});

test("administração de duplicados não transporta o lead completo", () => {
  for (const field of ["commercial_notes", "service_interests", "service_status_map", "custom_fields", "search_text"]) {
    assert.equal(LEAD_DUPLICATE_FIELDS.includes(field), false, field);
  }
  assert.match(serverSource, /select: qualifyLeadFields\(LEAD_DUPLICATE_FIELDS, "l"\)/);
});

test("rotas críticas usam projeções e detalhe por id continua completo", () => {
  assert.match(serverSource, /SELECT \$\{leadProjection\} FROM leads/);
  assert.match(kanbanSqlSource, /\$\{LEAD_KANBAN_SELECT\}/);
  assert.match(serverSource, /SELECT \$\{LEAD_TRASH_SELECT\} FROM leads/);
  assert.match(serverSource, /SELECT \* FROM leads WHERE id = \? \$\{whereDeleted\} LIMIT 1/);
  assert.doesNotMatch(serverSource, /async function getAllLeads/);
});

test("frontend aborta listagens obsoletas e hidrata o detalhe ao abrir lead", () => {
  assert.match(appSource, /leadListRequestController\.current\?\.abort\(\)/);
  assert.match(appSource, /fetchLeadPageFromServer\(normalizedParams, \{ signal: controller\.signal \}\)/);
  assert.match(appSource, /const lead = await fetchLeadByIdFromServer\(leadId\)/);
  assert.match(apiSource, /options: \{ signal\?: AbortSignal \} = \{\}/);
  assert.match(appSource, /const currentLead = await fetchLeadByIdFromServer\(updatedLead\.id\)/);
});

test("lixeira usa paginação server-side e load more", () => {
  assert.match(serverSource, /getDeletedLeadsPageFromRequest/);
  assert.match(serverSource, /LIMIT \? OFFSET \?/);
  assert.match(apiSource, /fetchDeletedLeadsFromServer\(params: \{ limit\?: number; offset\?: number \} = \{\}\)/);
  assert.match(settingsSource, /deletedPagination\.hasMore/);
  assert.match(settingsSource, /loadDeletedPage\(deletedLeads\.length, true\)/);
});
