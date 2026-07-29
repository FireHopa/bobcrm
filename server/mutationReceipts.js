import { createHash } from "node:crypto";

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeMutationRequestId(value) {
  const requestId = normalizeText(value, 120);
  if (!requestId) return "";
  if (!/^[a-zA-Z0-9:_-]{12,120}$/.test(requestId)) {
    const error = new Error("Identificador da operação inválido. Atualize a página e tente novamente.");
    error.statusCode = 400;
    throw error;
  }
  return requestId;
}

export function buildMutationReceiptId({ actorId, operation, requestId }) {
  const normalizedRequestId = normalizeMutationRequestId(requestId);
  if (!normalizedRequestId) return "";
  return createHash("sha256")
    .update(`${normalizeText(actorId, 64)}\n${normalizeText(operation, 64)}\n${normalizedRequestId}`)
    .digest("hex");
}

function parseResponse(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export async function claimMutationReceipt({ execute, queryRows, client = null, actorId, operation, requestId, resourceId = "", nowIso }) {
  const receiptId = buildMutationReceiptId({ actorId, operation, requestId });
  if (!receiptId) return { enabled: false, replay: false, receiptId: "", response: null };
  const at = nowIso();
  let inserted = false;
  try {
    const result = await execute(
      `INSERT INTO mutation_receipts
       (id, actor_id, operation, request_id, resource_id, status, response_json, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'started', NULL, ?, ?, '')`,
      [receiptId, normalizeText(actorId, 64), normalizeText(operation, 64), normalizeMutationRequestId(requestId), normalizeText(resourceId, 64), at, at],
      client,
    );
    inserted = Number(result?.affectedRows || 0) === 1;
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
  }

  const rows = await queryRows("SELECT * FROM mutation_receipts WHERE id = ? LIMIT 1 FOR UPDATE", [receiptId], client);
  const receipt = rows[0];
  if (!receipt) {
    const error = new Error("Não foi possível confirmar a operação idempotente.");
    error.code = "MUTATION_RECEIPT_MISSING";
    error.statusCode = 503;
    throw error;
  }
  if (String(receipt.actor_id || "") !== normalizeText(actorId, 64) || String(receipt.operation || "") !== normalizeText(operation, 64)) {
    const error = new Error("Este identificador de operação já foi utilizado em outro contexto.");
    error.statusCode = 409;
    throw error;
  }
  if (!inserted && receipt.status === "completed") {
    return { enabled: true, replay: true, receiptId, response: parseResponse(receipt.response_json) };
  }
  if (!inserted && receipt.status !== "started") {
    const error = new Error("A operação anterior não está em um estado reutilizável.");
    error.statusCode = 409;
    throw error;
  }
  return { enabled: true, replay: false, receiptId, response: null };
}

export async function completeMutationReceipt({ execute, client = null, receipt, response, nowIso }) {
  if (!receipt?.enabled || !receipt.receiptId) return;
  const at = nowIso();
  const result = await execute(
    `UPDATE mutation_receipts
     SET status = 'completed', response_json = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'started'`,
    [JSON.stringify(response ?? null), at, at, receipt.receiptId],
    client,
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    const error = new Error("A operação perdeu o recibo de idempotência antes do commit.");
    error.code = "MUTATION_RECEIPT_LOST";
    throw error;
  }
}

export function assertResourceFresh(expectedUpdatedAt, actualUpdatedAt, label = "registro") {
  const expected = String(expectedUpdatedAt || "").trim();
  const actual = String(actualUpdatedAt || "").trim();
  if (!expected || !actual || expected === actual) return;
  const error = new Error(`Este ${label} foi alterado por outro usuário. Recarregue os dados antes de salvar novamente.`);
  error.statusCode = 409;
  error.code = "STALE_WRITE_CONFLICT";
  throw error;
}
