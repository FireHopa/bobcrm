import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const env = readFileSync(new URL("./.env.example", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const next = source.indexOf("\nasync function ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

test("fase 10 remove invalidação global implícita de toda transação", () => {
  const body = functionBody("withTransaction");
  assert.doesNotMatch(body, /invalidateLeadSummaryCache/);
  assert.match(source, /invalidateLeadSummaryCache\(currentUser\)/);
});

test("resumo usa TTL cache com deduplicação de carga e chaves por escopo", () => {
  assert.match(source, /createTtlCache\(\{ ttlMs: LEAD_SUMMARY_CACHE_MS/);
  assert.match(source, /leadDashboardSummaryCache\.getOrLoad/);
  assert.match(source, /return `team:\$\{user\?\.teamId/);
  assert.match(source, /return `own:\$\{user\?\.id/);
  assert.doesNotMatch(source, /scopedLeadDashboardSummaryCache\.clear/);
});

test("metadados estáveis são cacheados e possuem invalidação por domínio", () => {
  assert.match(source, /metadataCache\.getOrLoad\("teams:all"/);
  assert.match(source, /metadataCache\.getOrLoad\("users:assignable"/);
  assert.match(source, /metadataCache\.getOrLoad\("users:all"/);
  assert.match(source, /metadataCache\.getOrLoad\(`team-members:/);
  assert.match(source, /invalidateDirectoryCaches\(\)/);
  assert.match(source, /metadataCache\.deletePrefix\("team-members:"\)/);
});

test("opções de responsáveis e catálogo do kanban recebem TTL curto", () => {
  assert.match(source, /filterOptionsCache\.getOrLoad\(cacheKey/);
  assert.match(source, /kanban-pipelines:\$\{leadDashboardCacheKey\(accessContext\)\}/);
  assert.match(source, /ttlMs: 5000/);
  assert.match(source, /invalidateKanbanCountsCache/);
});

test("TTL da fase 10 é configurável sem permitir cache eterno", () => {
  assert.match(env, /METADATA_CACHE_MS=30000/);
  assert.match(env, /FILTER_OPTIONS_CACHE_MS=15000/);
  assert.match(source, /METADATA_CACHE_MS.*30000.*1000.*300000/);
  assert.match(source, /FILTER_OPTIONS_CACHE_MS.*15000.*1000.*120000/);
});
