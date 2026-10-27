import { normalizeLead } from "./leadMapper.js";
import { assertResourceFresh } from "../../mutationReceipts.js";

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_LEAD_PATCH";
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Merge only explicitly editable fields into the FULL row locked by the caller.
// Absence never means deletion. Empty strings still allow intentional clearing.
export function prepareLeadPatch(before, body, editableFields) {
  if (!before) {
    const error = new Error("Lead nao encontrado.");
    error.statusCode = 404;
    throw error;
  }
  if (!isRecord(body) || !isRecord(body.changes)) badRequest("Envie as alteracoes do lead em changes.");
  if (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt.trim()) {
    badRequest("A versao do cadastro e obrigatoria. Reabra o lead antes de salvar.");
  }
  assertResourceFresh(body.expectedUpdatedAt, before.updatedAt, "lead");
  const allowed = new Set(editableFields.filter((key) => !["pipelineId", "pipelineStageId"].includes(key)));
  const changes = {};
  for (const [key, value] of Object.entries(body.changes)) {
    if (!allowed.has(key)) badRequest(`Campo nao permitido nesta operacao: ${key}.`);
    if (["serviceStatusMap", "customFields"].includes(key)) {
      if (!isRecord(value)) badRequest(`Valor invalido para ${key}.`);
      if (Object.keys(value).some((item) => ["__proto__", "constructor", "prototype"].includes(item))) {
        badRequest(`Chave invalida em ${key}.`);
      }
      if (Object.values(value).some((item) => typeof item !== "string")) badRequest(`Valor invalido em ${key}.`);
      changes[key] = { ...before[key], ...value };
    } else {
      const booleanFields = ["advertisesOnMeta", "advertisesOnGoogle", "doesNotAdvertiseOnMeta", "doesNotAdvertiseOnGoogle", "doesNotAdvertise", "isLost"];
      const valid = key === "serviceInterests"
        ? Array.isArray(value) && value.every((item) => typeof item === "string")
        : typeof value === (booleanFields.includes(key) ? "boolean" : "string");
      if (!valid) badRequest(`Valor invalido para ${key}. Use um valor explicito.`);
      changes[key] = value;
    }
  }
  return normalizeLead({ ...before, ...changes, id: before.id });
}
