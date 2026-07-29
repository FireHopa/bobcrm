import test from "node:test";
import assert from "node:assert/strict";
import { assertResourceFresh, buildMutationReceiptId, claimMutationReceipt, completeMutationReceipt, normalizeMutationRequestId } from "./mutationReceipts.js";

test("request id de mutação é validado e gera recibo estável por ator/operação", () => {
  const requestId = normalizeMutationRequestId("req_1234567890_abcd");
  const a = buildMutationReceiptId({ actorId: "u1", operation: "task:create", requestId });
  const b = buildMutationReceiptId({ actorId: "u1", operation: "task:create", requestId });
  const c = buildMutationReceiptId({ actorId: "u1", operation: "task:complete", requestId });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("conflito otimista rejeita atualização sobre versão já alterada", () => {
  assert.doesNotThrow(() => assertResourceFresh("2026-01-01T10:00:00Z", "2026-01-01T10:00:00Z", "lead"));
  assert.throws(() => assertResourceFresh("2026-01-01T10:00:00Z", "2026-01-01T10:00:01Z", "lead"), (error) => error.statusCode === 409 && error.code === "STALE_WRITE_CONFLICT");
});

test("recibo concluído devolve replay sem repetir efeito", async () => {
  const rows = new Map();
  const execute = async (sql, params) => {
    if (sql.includes("INSERT INTO mutation_receipts")) {
      if (rows.has(params[0])) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
      rows.set(params[0], { id: params[0], actor_id: params[1], operation: params[2], request_id: params[3], resource_id: params[4], status: "started", response_json: null });
      return { affectedRows: 1 };
    }
    if (sql.includes("UPDATE mutation_receipts")) {
      const row = rows.get(params[3]);
      row.status = "completed";
      row.response_json = params[0];
      return { affectedRows: 1 };
    }
    throw new Error(`SQL inesperado: ${sql}`);
  };
  const queryRows = async (_sql, params) => [rows.get(params[0])].filter(Boolean);
  const nowIso = () => "2026-07-27T18:00:00.000Z";
  const input = { execute, queryRows, actorId: "u1", operation: "task:create", requestId: "req_1234567890_abcd", resourceId: "lead1", nowIso };
  const first = await claimMutationReceipt(input);
  assert.equal(first.replay, false);
  await completeMutationReceipt({ execute, receipt: first, response: { id: "task1" }, nowIso });
  const replay = await claimMutationReceipt(input);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.response, { id: "task1" });
});
