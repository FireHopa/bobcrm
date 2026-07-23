import { normalizeUserRole, USER_ROLES } from "./rolePolicy.js";

export const TASK_TYPES = Object.freeze(["ligacao", "whatsapp", "email", "reuniao", "follow_up", "outro"]);
export const TASK_PRIORITIES = Object.freeze(["baixa", "normal", "alta", "urgente"]);
export const TASK_STATUSES = Object.freeze(["pending", "completed", "canceled"]);

export function normalizeTaskType(value, fallback = "follow_up") {
  const normalized = String(value || "").trim().toLowerCase();
  return TASK_TYPES.includes(normalized) ? normalized : fallback;
}

export function normalizeTaskPriority(value, fallback = "normal") {
  const normalized = String(value || "").trim().toLowerCase();
  return TASK_PRIORITIES.includes(normalized) ? normalized : fallback;
}

export function normalizeTaskStatus(value, fallback = "pending") {
  const normalized = String(value || "").trim().toLowerCase();
  return TASK_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeTaskDueAt(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text.length === 10 ? `${text}T12:00:00` : text);
  return Number.isNaN(date.getTime()) ? "" : text;
}

export function assertTaskPayload(payload = {}) {
  const title = String(payload.title || "").replace(/\s+/g, " ").trim();
  const dueAt = normalizeTaskDueAt(payload.dueAt || payload.due_at);
  if (title.length < 3) {
    const error = new Error("Informe um título de tarefa com pelo menos 3 caracteres.");
    error.statusCode = 400;
    throw error;
  }
  if (title.length > 180) {
    const error = new Error("O título da tarefa pode ter no máximo 180 caracteres.");
    error.statusCode = 400;
    throw error;
  }
  if (!dueAt) {
    const error = new Error("Informe uma data válida para a tarefa.");
    error.statusCode = 400;
    throw error;
  }
  const description = String(payload.description || "").trim();
  if (description.length > 5000) {
    const error = new Error("A descrição da tarefa pode ter no máximo 5.000 caracteres.");
    error.statusCode = 400;
    throw error;
  }
  return {
    title,
    dueAt,
    description,
    type: normalizeTaskType(payload.type),
    priority: normalizeTaskPriority(payload.priority),
  };
}

export function canManageAllTasks(user) {
  const role = normalizeUserRole(user?.role);
  return role === USER_ROLES.ADMIN || role === USER_ROLES.PRE_SALES;
}

export function assertTaskAssignmentAllowed(user, responsibleUserId) {
  if (canManageAllTasks(user)) return String(responsibleUserId || "").trim();
  const ownId = String(user?.id || "").trim();
  const targetId = String(responsibleUserId || ownId).trim();
  if (!ownId || targetId !== ownId) {
    const error = new Error("Consultores só podem criar ou alterar tarefas atribuídas a si mesmos.");
    error.statusCode = 403;
    throw error;
  }
  return ownId;
}

export function buildTaskAccessSql(user, alias = "t") {
  if (canManageAllTasks(user)) return { clause: "1 = 1", params: [] };
  const userId = String(user?.id || "").trim();
  if (!userId) return { clause: "1 = 0", params: [] };
  const identities = [user?.name, user?.email]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const legacyClause = identities.length
    ? `OR (TRIM(COALESCE(task_lead.responsible_user_id, '')) = '' AND LOWER(TRIM(COALESCE(task_lead.responsible, ''))) IN (${identities.map(() => "?").join(", ")}))`
    : "";
  return {
    clause: `(${alias}.responsible_user_id = ? AND (${alias}.lead_id = '' OR EXISTS (
      SELECT 1 FROM leads task_lead
      WHERE task_lead.id = ${alias}.lead_id
        AND task_lead.deleted_at = ''
        AND (task_lead.responsible_user_id = ? ${legacyClause})
    )))`,
    params: [userId, userId, ...identities],
  };
}

export function getTaskBucketWhere(bucket, alias = "t") {
  const prefix = alias ? `${alias}.` : "";
  const normalized = String(bucket || "today").trim().toLowerCase();
  if (normalized === "overdue") return `${prefix}status = 'pending' AND LEFT(${prefix}due_at, 10) < DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  if (normalized === "upcoming") return `${prefix}status = 'pending' AND LEFT(${prefix}due_at, 10) > DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  if (normalized === "completed") return `${prefix}status = 'completed'`;
  if (normalized === "all") return `${prefix}status != 'canceled'`;
  return `${prefix}status = 'pending' AND LEFT(${prefix}due_at, 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
}
