import test from "node:test";
import assert from "node:assert/strict";
import { integrationObservabilityInternals } from "./integrationObservability.js";

test("monitor ausente gera aviso de telemetria, não incidente crítico de entrega", () => {
  const conditions = integrationObservabilityInternals.deriveConditions(null, Object.assign(new Error("não configurado"), { code: "ZAPE_MONITOR_NOT_CONFIGURED" }));
  assert.equal(conditions.length, 1);
  assert.equal(conditions[0].severity, "warning");
  assert.equal(conditions[0].type, "monitor");
  assert.match(conditions[0].title, /Telemetria/);
});

test("erro antigo do worker é ignorado quando houve entrega posterior", () => {
  const conditions = integrationObservabilityInternals.deriveConditions({ data: {
    storage: { configuredMode: "mysql", activeMode: "mysql" },
    worker: { running: true, lastCycleError: "timeout antigo", lastFailureAt: "2026-08-27T12:00:00Z", lastDeliveryAt: "2026-08-27T12:05:00Z" },
    queue: { counts: { failedPermanent: 0, pending: 0, sending: 0 }, pendingAgeMinutes: 0 },
    tenants: [],
  } }, null);
  assert.equal(conditions.some((condition) => condition.fingerprint === "worker_error"), false);
});
