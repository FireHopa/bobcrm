export const USER_ROLES = Object.freeze({
  ADMIN: "admin",
  PRE_SALES: "pre_venda",
  SALES_CONSULTANT: "consultor_vendas",
});

const LEGACY_ROLE_ALIASES = Object.freeze({
  gerente: USER_ROLES.PRE_SALES,
  vendedor: USER_ROLES.SALES_CONSULTANT,
});

export const ROLE_LABELS = Object.freeze({
  [USER_ROLES.ADMIN]: "Administrador",
  [USER_ROLES.PRE_SALES]: "Pré-venda",
  [USER_ROLES.SALES_CONSULTANT]: "Consultor de vendas",
});

export const PERMISSIONS_BY_ROLE = Object.freeze({
  [USER_ROLES.ADMIN]: new Set([
    "read_leads",
    "create_leads",
    "edit_leads_full",
    "assign_leads",
    "move_lead_stage",
    "move_lead_pipeline",
    "bulk_move_leads",
    "add_lead_note",
    "read_tasks",
    "manage_all_tasks",
    "assign_tasks",
    "delete_leads",
    "restore_leads",
    "permanent_delete_leads",
    "merge_leads",
    "import_leads",
    "export_leads",
    "backup_database",
    "read_audit",
    "manage_users",
    "manage_pipelines",
  ]),
  [USER_ROLES.PRE_SALES]: new Set([
    "read_leads",
    "create_leads",
    "edit_leads_full",
    "assign_leads",
    "move_lead_stage",
    "move_lead_pipeline",
    "bulk_move_leads",
    "add_lead_note",
    "read_tasks",
    "manage_all_tasks",
    "assign_tasks",
  ]),
  [USER_ROLES.SALES_CONSULTANT]: new Set([
    "read_leads",
    "edit_lead_sales_fields",
    "move_lead_stage",
    "add_lead_note",
    "read_tasks",
    "manage_own_tasks",
  ]),
});

export const CONSULTANT_EDITABLE_LEAD_FIELDS = Object.freeze(new Set([
  "email",
  "temperature",
  "expectedCloseAt",
]));


export function isCanonicalUserRole(role) {
  return Object.values(USER_ROLES).includes(String(role || "").trim().toLowerCase());
}

export function normalizeUserRole(role, fallback = USER_ROLES.SALES_CONSULTANT) {
  const normalized = String(role || "").trim().toLowerCase();
  if (Object.values(USER_ROLES).includes(normalized)) return normalized;
  if (LEGACY_ROLE_ALIASES[normalized]) return LEGACY_ROLE_ALIASES[normalized];
  return fallback;
}

export function getRoleLabel(role) {
  const normalized = normalizeUserRole(role);
  return ROLE_LABELS[normalized] || normalized;
}

export function getPermissionsForRole(role) {
  return PERMISSIONS_BY_ROLE[normalizeUserRole(role)] || new Set();
}

export function hasRolePermission(user, permission) {
  return Boolean(user && getPermissionsForRole(user.role).has(permission));
}

export function getFixedLeadAccessScopeForRole(role) {
  const normalized = normalizeUserRole(role);
  if (normalized === USER_ROLES.SALES_CONSULTANT) return "own";
  return "all";
}

export function getChangedLeadFields(beforeLead = {}, afterLead = {}, fields = []) {
  return fields.filter((field) => JSON.stringify(beforeLead?.[field] ?? "") !== JSON.stringify(afterLead?.[field] ?? ""));
}

export function assertLeadFieldUpdateAllowed(user, changedFields = []) {
  const role = normalizeUserRole(user?.role);
  if (role === USER_ROLES.ADMIN || role === USER_ROLES.PRE_SALES) return;

  const forbiddenFields = changedFields.filter((field) => !CONSULTANT_EDITABLE_LEAD_FIELDS.has(field));
  if (forbiddenFields.length) {
    const error = new Error(`Consultores de vendas só podem alterar e-mail, termômetro e data prevista de fechamento. Campos bloqueados: ${forbiddenFields.join(", ")}.`);
    error.statusCode = 403;
    throw error;
  }
}

export function assertKanbanMoveAllowed(user, lead, targetPipelineId) {
  const role = normalizeUserRole(user?.role);
  if (role !== USER_ROLES.SALES_CONSULTANT) return;

  const currentPipelineId = String(lead?.pipelineId || lead?.pipeline_id || "").trim();
  const requestedPipelineId = String(targetPipelineId || "").trim();
  if (!currentPipelineId || currentPipelineId !== requestedPipelineId) {
    const error = new Error("Consultores de vendas só podem mudar etapas dentro do funil atual do próprio lead.");
    error.statusCode = 403;
    throw error;
  }
}
