import assert from "node:assert/strict";
import test from "node:test";
import { description, up, version } from "./20260727_14_scalability_phase2.js";

test("migration da fase 2 cria índices dos caminhos de leitura escaláveis", async () => {
  const calls = [];
  await up({ addIndexIfMissing: async (...args) => calls.push(args) });
  assert.equal(version, "20260727_14_scalability_phase2");
  assert.match(description, /Escalabilidade/i);
  const names = calls.map((call) => call[1]);
  for (const name of [
    "idx_leads_active_updated_id",
    "idx_leads_status_updated_id",
    "idx_leads_temperature_updated_id",
    "idx_leads_priority_score_updated",
    "idx_leads_mapping_score_updated",
    "idx_leads_agency_updated",
    "idx_leads_expansion_updated",
    "idx_tasks_status_due_dt_owner",
    "idx_integration_events_status_updated",
  ]) assert.ok(names.includes(name), `${name} ausente`);
});
