import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHandoffDashboardAccess,
  buildHandoffDashboardFilter,
  mapHandoffRow,
  normalizeHandoffRangeDays,
} from "./handoffAudit.js";

test("normaliza janelas permitidas", () => {
  assert.equal(normalizeHandoffRangeDays("7"), 7);
  assert.equal(normalizeHandoffRangeDays("90"), 90);
  assert.equal(normalizeHandoffRangeDays("999"), 30);
});

test("SDR fica restrito ao próprio actor_user_id", () => {
  const filter = buildHandoffDashboardFilter({ id: "sdr-1", role: "pre_venda" }, { rangeDays: 30 }, new Date("2026-08-27T12:00:00.000Z"));
  assert.match(filter.where, /actor_user_id = \?/);
  assert.equal(filter.params.at(-1), "sdr-1");
});

test("admin pode filtrar outro encaminhador", () => {
  const filter = buildHandoffDashboardFilter({ id: "admin-1", role: "admin" }, { rangeDays: 7, actorUserId: "sdr-2" }, new Date("2026-08-27T12:00:00.000Z"));
  assert.match(filter.where, /actor_user_id = \?/);
  assert.equal(filter.params.at(-1), "sdr-2");
});

test("consultor não acessa dashboard de SDR", () => {
  assert.throws(() => assertHandoffDashboardAccess({ id: "seller", role: "consultor_vendas" }), /Somente administradores/);
});

test("mapeia registro normalizado", () => {
  const row = mapHandoffRow({ id: "h1", lead_id: "l1", actor_name: "SDR", to_user_name: "Vendedor", created_at: "2026-08-27T12:00:00.000Z" });
  assert.equal(row.leadId, "l1");
  assert.equal(row.actorName, "SDR");
  assert.equal(row.toUserName, "Vendedor");
});
