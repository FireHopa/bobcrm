import { normalizeUserRole, USER_ROLES } from "./rolePolicy.js";

const ALLOWED_RANGE_DAYS = new Set([7, 30, 90, 180, 365]);

export function normalizeHandoffRangeDays(value, fallback = 30) {
  const parsed = Number(value || fallback);
  return ALLOWED_RANGE_DAYS.has(parsed) ? parsed : fallback;
}

export function assertHandoffDashboardAccess(user) {
  const role = normalizeUserRole(user?.role);
  if (role !== USER_ROLES.ADMIN && role !== USER_ROLES.PRE_SALES) {
    const error = new Error("Somente administradores e usuários de pré-venda podem consultar o painel de encaminhamentos.");
    error.statusCode = 403;
    throw error;
  }
  return role;
}

export function buildHandoffDashboardFilter(user, options = {}, now = new Date()) {
  const role = assertHandoffDashboardAccess(user);
  const rangeDays = normalizeHandoffRangeDays(options.rangeDays, 30);
  const conditions = ["1 = 1"];
  const params = [];

  const cutoff = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  conditions.push("created_at >= ?");
  params.push(cutoff);

  if (role === USER_ROLES.PRE_SALES) {
    conditions.push("actor_user_id = ?");
    params.push(String(user.id || ""));
  } else if (String(options.actorUserId || "").trim()) {
    conditions.push("actor_user_id = ?");
    params.push(String(options.actorUserId).trim());
  }

  return {
    role,
    rangeDays,
    where: conditions.join(" AND "),
    params,
  };
}

export function buildHandoffTimeOnlyFilter(options = {}, now = new Date()) {
  const rangeDays = normalizeHandoffRangeDays(options.rangeDays, 30);
  const cutoff = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  return { rangeDays, where: "created_at >= ?", params: [cutoff] };
}

export function mapHandoffRow(row = {}) {
  return {
    id: String(row.id || ""),
    leadId: String(row.lead_id || ""),
    leadName: String(row.lead_name || ""),
    leadCompany: String(row.lead_company || ""),
    fromUserId: String(row.from_user_id || ""),
    fromUserName: String(row.from_user_name || ""),
    actorUserId: String(row.actor_user_id || ""),
    actorName: String(row.actor_name || ""),
    actorRole: String(row.actor_role || ""),
    toUserId: String(row.to_user_id || ""),
    toUserName: String(row.to_user_name || ""),
    toUserRole: String(row.to_user_role || ""),
    pipelineId: String(row.pipeline_id || ""),
    pipelineName: String(row.pipeline_name || ""),
    stageId: String(row.stage_id || ""),
    stageName: String(row.stage_name || ""),
    requestId: String(row.request_id || ""),
    createdAt: String(row.created_at || ""),
  };
}

export function mapHandoffActorMetric(row = {}) {
  return {
    userId: String(row.actor_user_id || ""),
    name: String(row.actor_name || ""),
    role: String(row.actor_role || ""),
    total: Number(row.total || 0),
    uniqueLeads: Number(row.unique_leads || 0),
    destinations: Number(row.destinations || 0),
  };
}

export function mapHandoffTargetMetric(row = {}) {
  return {
    userId: String(row.to_user_id || ""),
    name: String(row.to_user_name || ""),
    total: Number(row.total || 0),
    uniqueLeads: Number(row.unique_leads || 0),
  };
}

export function mapHandoffDailyMetric(row = {}) {
  return {
    date: String(row.day || ""),
    total: Number(row.total || 0),
  };
}
