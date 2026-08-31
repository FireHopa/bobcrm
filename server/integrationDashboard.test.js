import test from "node:test";
import assert from "node:assert/strict";
import { integrationDashboardInternals } from "./integrationDashboard.js";

test("falha técnica do Zape vira entregue quando CRM confirmou o mesmo eventKey", () => {
  const [event] = integrationDashboardInternals.mergeEventData([
    { eventKey: "evt-1", status: "failed_permanent", tenantId: "conta-1", lastError: "ACK perdido" },
  ], [
    { eventKey: "evt-1", crmStatus: "completed", crmLeadId: "lead-1", tenantId: "conta-1" },
  ]);
  assert.equal(event.technicalStatus, "failed_permanent");
  assert.equal(event.status, "delivered");
  assert.equal(event.effectiveStatus, "delivered");
  assert.equal(event.reconciled, true);
});

test("falha sem confirmação local permanece falha efetiva", () => {
  const event = integrationDashboardInternals.reconcileEvent({ eventKey: "evt-2", status: "failed_permanent" }, null);
  assert.equal(event.status, "failed_permanent");
  assert.equal(event.reconciled, false);
});

test("indisponibilidade do monitor não classifica automaticamente a integração como crítica", () => {
  const health = integrationDashboardInternals.consolidatedHealth(null, Object.assign(new Error("sem monitor"), { code: "ZAPE_MONITOR_NOT_CONFIGURED" }), { statuses: { processing: 0 } }, 0);
  assert.equal(health.status, "attention");
  assert.match(health.reasons[0], /Telemetria/);
});
