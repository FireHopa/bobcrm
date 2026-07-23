import { normalizeUserRole, USER_ROLES } from "./rolePolicy.js";

export const LEAD_ASSIGNMENT_FIELDS = Object.freeze(["responsible", "responsibleUserId"]);

export function assertAssignmentUsesHandoff({ isNew = false, changedFields = [], lead = {} } = {}) {
  const hasAssignment = String(lead.responsibleUserId || lead.responsible_user_id || "").trim()
    || String(lead.responsible || "").trim();
  const assignmentChanged = changedFields.some((field) => LEAD_ASSIGNMENT_FIELDS.includes(field));
  if ((isNew && hasAssignment) || assignmentChanged) {
    const error = new Error("Para atribuir ou trocar o consultor, use a ação ‘Encaminhar para consultor’. Ela garante funil, etapa e primeira tarefa.");
    error.statusCode = 409;
    throw error;
  }
}

export function assertHandoffTargetStage(stage = {}) {
  const stageType = String(stage.stage_type || stage.stageType || "open").trim().toLowerCase();
  const statusKey = String(stage.status_key || stage.statusKey || "").trim().toLowerCase();
  if (stageType === "won" || stageType === "lost" || statusKey === "fechado" || statusKey === "perdido") {
    const error = new Error("O encaminhamento deve iniciar em uma etapa aberta. Fechado e Perdido não podem ser etapas iniciais.");
    error.statusCode = 400;
    throw error;
  }
}

export function normalizeHandoffRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[a-zA-Z0-9:_-]{12,120}$/.test(requestId)) {
    const error = new Error("Identificador de encaminhamento inválido. Atualize a página e tente novamente.");
    error.statusCode = 400;
    throw error;
  }
  return requestId;
}

export function buildHandoffTaskSourceKey(leadId, requestId) {
  return `lead-handoff:${String(leadId || "").trim()}:${normalizeHandoffRequestId(requestId)}`.slice(0, 255);
}

export function isClosedLead(lead = {}) {
  const status = String(lead.status || "").trim().toLowerCase();
  return Boolean(lead.deletedAt || lead.deleted_at || lead.isLost || lead.is_lost || status === "fechado" || status === "perdido");
}

export function assertConsultantCanBeDeactivated({ existingRole, nextRole, nextIsActive, activeLeadCount = 0, pendingTaskCount = 0 } = {}) {
  const wasConsultant = normalizeUserRole(existingRole) === USER_ROLES.SALES_CONSULTANT;
  const remainsConsultant = normalizeUserRole(nextRole) === USER_ROLES.SALES_CONSULTANT;
  const leavesOperationalRole = wasConsultant && (!nextIsActive || !remainsConsultant);
  if (leavesOperationalRole && (Number(activeLeadCount) > 0 || Number(pendingTaskCount) > 0)) {
    const error = new Error(`Redistribua a carteira antes de desativar ou trocar o papel deste consultor. Leads ativos: ${Number(activeLeadCount)}. Tarefas pendentes: ${Number(pendingTaskCount)}.`);
    error.statusCode = 409;
    throw error;
  }
}
