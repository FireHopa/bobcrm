import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (file) => readFileSync(resolve(root, file), "utf8");

test("Administração usa métricas e duplicados globais do servidor", () => {
  const source = read("src/components/SettingsCenter.tsx");

  assert.match(source, /fetchAdminLeadOverviewFromServer/);
  assert.match(source, /fetchDuplicateGroupsFromServer/);
  assert.doesNotMatch(source, /getDuplicateGroups\s*\(/);
  assert.doesNotMatch(source, /const total = leads\.length/);
  assert.doesNotMatch(source, /leads\.filter\s*\(/);
  assert.match(source, /group\.isTruncated/);
});

test("Mapa envia os filtros comerciais exatos ao backend", () => {
  const source = read("src/components/ServiceOpportunityMap.tsx");

  assert.match(source, /quickFilter,\s*\n\s*includeOpportunitySummary: true/);
  assert.match(source, /"expansion", "migration", "mapping", "priority", "agency", "diagnosis", "mapping-critical"/);
  assert.doesNotMatch(source, /migration[^\n]{0,80}agency\s*\?/i);
});

test("rotas globais exigem permissão e reaplicam o escopo autorizado", () => {
  const source = read("server/index.js");

  assert.match(source, /pathname === "\/api\/leads\/opportunities\/summary"[\s\S]{0,220}requirePermission\(currentUser, "read_leads"\)/);
  assert.match(source, /pathname === "\/api\/admin\/leads\/overview"[\s\S]{0,220}requirePermission\(currentUser, "manage_users"\)/);
  assert.match(source, /pathname === "\/api\/leads\/duplicates"[\s\S]{0,220}requirePermission\(currentUser, "manage_users"\)/);
  assert.match(source, /buildAliasedLeadAccess\(accessContext, "l"\)/);
  assert.match(source, /buildDuplicateGroupsCountSql/);
});

test("ações administrativas abrem o módulo correspondente com filtro aplicado", () => {
  const app = read("src/App.tsx");
  const settings = read("src/components/SettingsCenter.tsx");

  assert.match(app, /setRequestedLeadQuickFilter\(filter\)/);
  assert.match(app, /setOpportunityQuickFilter\(filter\)/);
  assert.match(app, /setActiveTab\("leads"\)/);
  assert.match(app, /setActiveTab\("opportunity-map"\)/);
  assert.match(settings, /onOpenLeadFilter\("owner"\)/);
  assert.match(settings, /onOpenOpportunityFilter\("diagnosis"\)/);
  assert.match(settings, /onOpenOpportunityFilter\("mapping-critical"\)/);
});
