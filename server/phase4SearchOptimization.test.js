import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./schema.mysql.sql", import.meta.url), "utf8");
const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");

test("fase 4 usa probe rápido e fallback somente sem resultado primário", () => {
  assert.match(serverSource, /async function resolveLeadSearchClause/);
  assert.match(serverSource, /SELECT 1 AS found FROM/);
  assert.match(serverSource, /chooseLeadSearchPlan\(plan, primaryHasMatches\)/);
  assert.match(serverSource, /await buildLeadsPageQuery/);
});

test("fase 4 remove CAST de JSON do caminho de busca", () => {
  assert.doesNotMatch(serverSource, /CAST\(custom_fields AS CHAR\)/i);
  assert.doesNotMatch(serverSource, /CAST\(service_status_map AS CHAR\)/i);
});

test("busca de inclusão no Kanban reutiliza o mesmo planejador", () => {
  const routeStart = serverSource.indexOf('pathname === "/api/kanban/leads/search"');
  const routeEnd = serverSource.indexOf('pathname === "/api/kanban/pipelines" && method === "POST"', routeStart);
  const routeSource = serverSource.slice(routeStart, routeEnd);
  assert.match(routeSource, /resolveLeadSearchClause/);
  assert.doesNotMatch(routeSource, /LOWER\(COALESCE\(l\.search_text/);
});

test("schema mantém índices dedicados para telefone, email e FULLTEXT", () => {
  assert.match(schemaSource, /idx_leads_search_email \(deleted_at, email_key\)/);
  assert.match(schemaSource, /idx_leads_search_phone \(deleted_at, phone_key\)/);
  assert.match(schemaSource, /FULLTEXT INDEX ft_leads_search_text \(search_text\)/);
});

test("rebuild de search_text possui comandos explícitos de backfill e verificação", () => {
  assert.match(packageSource, /search-index:backfill/);
  assert.match(packageSource, /search-index:verify/);
  assert.match(serverSource, /buildLeadSearchIndexBatchUpdate/);
});
