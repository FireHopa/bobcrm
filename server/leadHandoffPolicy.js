import { normalizeUserRole, USER_ROLES } from "./rolePolicy.js";
import { assertTaskPayload } from "./taskPolicy.js";
import { normalizeHandoffRequestId } from "./operationalIntegrity.js";

export function assertLeadHandoffAllowed(user) {
  const role = normalizeUserRole(user?.role);
  if (role !== USER_ROLES.ADMIN && role !== USER_ROLES.PRE_SALES) {
    const error = new Error("Somente administrador ou pré-venda pode encaminhar leads para consultores.");
    error.statusCode = 403;
    throw error;
  }
}

export function assertLeadHandoffPayload(payload = {}) {
  const consultantUserId = String(payload.consultantUserId || payload.responsibleUserId || "").trim();
  const pipelineId = String(payload.pipelineId || "").trim();
  const stageId = String(payload.stageId || "").trim();

  if (!consultantUserId) {
    const error = new Error("Selecione o consultor responsável.");
    error.statusCode = 400;
    throw error;
  }
  if (!pipelineId) {
    const error = new Error("Selecione o funil de destino.");
    error.statusCode = 400;
    throw error;
  }
  if (!stageId) {
    const error = new Error("Selecione a etapa inicial.");
    error.statusCode = 400;
    throw error;
  }

  const requestId = normalizeHandoffRequestId(payload.requestId || payload.idempotencyKey);

  return {
    consultantUserId,
    pipelineId,
    stageId,
    requestId,
    task: assertTaskPayload(payload.task || {}),
  };
}
