import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDateMissingPredicate,
  buildDatePredicate,
  buildDatePresentPredicate,
  buildIsoToMysqlDateExpression,
  createDateColumnRuntime,
} from "./dateColumns.js";

test("predicados temporais usam VARCHAR antes do backfill e DATETIME depois", () => {
  assert.match(buildDatePredicate("t", "due_at", "due_at_dt", "<", "CURDATE()", false), /LEFT\(t\.due_at, 10\)/);
  assert.equal(buildDatePredicate("t", "due_at", "due_at_dt", "<", "CURDATE()", true), "t.due_at_dt < CURDATE()");
  assert.equal(buildDatePresentPredicate("l", "next_contact_at", "next_contact_at_dt", true), "l.next_contact_at_dt IS NOT NULL");
  assert.equal(buildDateMissingPredicate("l", "next_contact_at", "next_contact_at_dt", true), "l.next_contact_at_dt IS NULL");
});

test("conversão SQL aceita data, ISO com e sem milissegundos e rejeita formato desconhecido", () => {
  const expression = buildIsoToMysqlDateExpression("NEW.updated_at");
  assert.match(expression, /%Y-%m-%d/);
  assert.match(expression, /%Y-%m-%d %H:%i:%s\.%f/);
  assert.match(expression, /%Y-%m-%d %H:%i:%s/);
  assert.match(expression, /ELSE NULL/);
});

test("runtime só ativa DATETIME quando não há legado pendente", async () => {
  const calls = [];
  let pending = { id: "1", source: "leads" };
  const runtime = createDateColumnRuntime({
    queryFirst: async (sql) => {
      calls.push(sql);
      return pending;
    },
    logger: { log() {} },
  });

  assert.equal(await runtime.refreshReadiness(), false);
  pending = null;
  assert.equal(await runtime.refreshReadiness(), true);
  assert.equal(runtime.isReady(), true);
  assert.equal(await runtime.refreshReadiness(), true);
  assert.equal(calls.length, 2, "depois de pronto não deve fazer scan periódico novamente");
});
