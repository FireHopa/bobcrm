import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/utils/api.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/components/SettingsCenter.tsx", import.meta.url), "utf8");

test("fase 3 usa snapshot compartilhado para resumo e oportunidades", () => {
  assert.match(serverSource, /getLeadDashboardSummaryCached/);
  assert.match(serverSource, /scopedDashboardSummary\.summary/);
  assert.match(serverSource, /scopedDashboardSummary\.opportunitySummary/);
  assert.match(serverSource, /filteredDashboardSummary = hasActiveFilters/);
  assert.match(serverSource, /const total = filteredDashboardSummary/);
});

test("fase 3 preserva endpoints individuais usando o mesmo cache", () => {
  assert.match(serverSource, /getLeadSummaryCached\([\s\S]*getLeadDashboardSummaryCached/);
  assert.match(serverSource, /getOpportunitySummaryCached\([\s\S]*getLeadDashboardSummaryCached/);
});

test("overview administrativo permite evitar contagem duplicada de grupos", () => {
  assert.match(serverSource, /includeDuplicates: requestUrl\.searchParams\.get\("includeDuplicates"\) !== "0"/);
  assert.match(apiSource, /includeDuplicates === false/);
  assert.match(settingsSource, /fetchAdminLeadOverviewFromServer\(\{ includeDuplicates: false \}\)/);
  assert.match(settingsSource, /duplicateGroups: result\.pagination\.total/);
});
