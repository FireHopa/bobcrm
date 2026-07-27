import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMERCIAL_PROFILE_VERSION,
  SERVICE_OPTIONS,
  calculateLeadCommercialProfile,
} from "./domains/leads/leadCommercialProfile.js";
import { leadToDbParams } from "./domains/leads/leadMapper.js";
import {
  buildAdminLeadOverviewSql,
  buildOpportunityQuickFilterSql,
  buildOpportunitySummarySql,
} from "./opportunityRules.js";
import { buildLeadSummarySql } from "./leadSummarySql.js";

const root = resolve(process.cwd());
const read = (file) => readFileSync(resolve(root, file), "utf8");

function sampleLead(overrides = {}) {
  return {
    id: "lead-phase2",
    name: "Empresa Exemplo",
    temperature: "Quente",
    estimatedBudget: "5000",
    pain: "Precisa vender mais",
    website: "https://example.com",
    responsible: "Consultor",
    responsibleUserId: "user-1",
    source: "Google",
    nextContactAt: "2026-07-30T10:00:00.000Z",
    advertisesOnGoogle: true,
    advertisesOnMeta: false,
    serviceStatusMap: {
      [SERVICE_OPTIONS[0]]: "Casa do Ads",
      [SERVICE_OPTIONS[1]]: "Outra agência",
      [SERVICE_OPTIONS[2]]: "Não é feito",
    },
    ...overrides,
  };
}

test("perfil comercial é determinístico e versionado", () => {
  const profile = calculateLeadCommercialProfile(sampleLead());
  assert.equal(profile.version, COMMERCIAL_PROFILE_VERSION);
  assert.equal(profile.counts["Casa do Ads"], 1);
  assert.equal(profile.counts["Outra agência"], 1);
  assert.equal(profile.counts["Não é feito"], 1);
  assert.equal(profile.counts["Não sabemos"], SERVICE_OPTIONS.length - 3);
  assert.equal(profile.expansion, true);
  assert.equal(profile.migration, false);
  assert.ok(profile.leadPriority >= 0 && profile.leadPriority <= 100);
  assert.ok(profile.opportunityScore >= 0 && profile.opportunityScore <= 100);
});

test("persistência normal de lead grava perfil materializado junto com o upsert", () => {
  const params = leadToDbParams(sampleLead(), { updatedAt: "2026-07-23T12:00:00.000Z" });
  assert.equal(params.length, 53);
  assert.equal(params[40], COMMERCIAL_PROFILE_VERSION);
  assert.equal(params[41], "2026-07-23T12:00:00.000Z");
});

test("resumos e filtros materializados não contêm JSON_EXTRACT", () => {
  const sqls = [
    buildLeadSummarySql(),
    buildOpportunitySummarySql({ alias: "l" }),
    buildAdminLeadOverviewSql({ alias: "l" }),
    buildOpportunityQuickFilterSql("lead-priority", "l"),
    buildOpportunityQuickFilterSql("migration", "l"),
  ];
  for (const sql of sqls) assert.doesNotMatch(sql, /JSON_EXTRACT/);
  assert.match(sqls[0], /lead_priority_score/);
  assert.match(sqls[1], /opportunity_score/);
  assert.match(sqls[4], /has_migration_opportunity/);
});

test("modo legado permanece disponível até o backfill completar", () => {
  const sql = buildOpportunitySummarySql({ alias: "l", useMaterialized: false });
  assert.match(sql, /JSON_EXTRACT\(l\.service_status_map/);
});

test("schema e boot incluem migration e chave de prontidão", () => {
  const schema = read("server/schema.mysql.sql");
  const index = read("server/index.js");
  assert.match(schema, /commercial_profile_version SMALLINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(schema, /lead_priority_score TINYINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(schema, /idx_leads_commercial_profile_version/);
  assert.match(index, /commercialProfileRuntime\.refreshReadiness/);
  assert.match(index, /useMaterialized: commercialProfileRuntime\.isReady\(\)/);
  assert.match(index, /runCommercialProfileMigration/);
});

test("backfill é paginado em batches e não usa OFFSET", () => {
  const source = read("scripts/backfill-commercial-profile.mjs");
  assert.match(source, /BATCH_SIZE/);
  assert.match(source, /commercial_profile_version <> \?/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /commit\(\)/);
  assert.doesNotMatch(source, /\bOFFSET\b/);
  assert.doesNotMatch(source, /SELECT \*/);
});
