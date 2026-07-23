import { getFixedLeadAccessScopeForRole, normalizeUserRole, USER_ROLES } from "./rolePolicy.js";

export const LEAD_ACCESS_SCOPES = Object.freeze(["all", "team", "own", "none"]);

export function normalizeLeadAccessScope(value, fallback = "all") {
  const normalized = String(value || "").trim().toLowerCase();
  return LEAD_ACCESS_SCOPES.includes(normalized) ? normalized : fallback;
}

export function getDefaultLeadAccessScopeForRole(role) {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === USER_ROLES.SALES_CONSULTANT && String(role || "").toLowerCase() === "leitura") return "none";
  return getFixedLeadAccessScopeForRole(normalizedRole);
}

export function getEffectiveLeadAccessScope(user) {
  const rawRole = String(user?.role || "").trim().toLowerCase();
  if (rawRole === "leitura") return "none";
  return getFixedLeadAccessScopeForRole(rawRole);
}

export function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueUsers(users = []) {
  const byId = new Map();
  users.forEach((user) => {
    const id = String(user?.id || "").trim();
    if (id && !byId.has(id)) byId.set(id, user);
  });
  return Array.from(byId.values());
}

export function getUsersAllowedByScope(user, teamMembers = []) {
  const scope = getEffectiveLeadAccessScope(user);
  if (scope === "all") return [];
  if (scope === "none") return [];
  if (scope === "own") return user?.id ? [user] : [];
  return uniqueUsers([user, ...teamMembers]);
}

export function buildLeadAccessSql(user, teamMembers = [], alias = "") {
  const scope = getEffectiveLeadAccessScope(user);
  const prefix = alias ? `${alias}.` : "";

  if (scope === "all") {
    return { clause: "1 = 1", params: [], scope };
  }

  if (scope === "none") {
    return { clause: "1 = 0", params: [], scope };
  }

  const allowedUsers = getUsersAllowedByScope(user, teamMembers);
  if (!allowedUsers.length) {
    return { clause: "1 = 0", params: [], scope };
  }

  const ids = allowedUsers.map((item) => String(item.id || "").trim()).filter(Boolean);
  const legacyIdentities = Array.from(new Set(allowedUsers.flatMap((item) => [
    normalizeIdentity(item.name),
    normalizeIdentity(item.email),
  ]).filter(Boolean)));

  const clauses = [];
  const params = [];

  if (ids.length) {
    clauses.push(`${prefix}responsible_user_id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
  }

  if (legacyIdentities.length) {
    clauses.push(`(TRIM(COALESCE(${prefix}responsible_user_id, '')) = '' AND LOWER(TRIM(COALESCE(${prefix}responsible, ''))) IN (${legacyIdentities.map(() => "?").join(", ")}))`);
    params.push(...legacyIdentities);
  }

  return {
    clause: clauses.length ? `(${clauses.join(" OR ")})` : "1 = 0",
    params,
    scope,
  };
}

export function leadMatchesAccessScope(lead, user, teamMembers = []) {
  const scope = getEffectiveLeadAccessScope(user);
  if (scope === "all") return true;
  if (scope === "none") return false;

  const allowedUsers = getUsersAllowedByScope(user, teamMembers);
  const allowedIds = new Set(allowedUsers.map((item) => String(item.id || "").trim()).filter(Boolean));
  const responsibleUserId = String(lead?.responsibleUserId || lead?.responsible_user_id || "").trim();
  if (responsibleUserId) return allowedIds.has(responsibleUserId);

  const legacyResponsible = normalizeIdentity(lead?.responsible);
  if (!legacyResponsible) return false;

  return allowedUsers.some((item) => {
    return legacyResponsible === normalizeIdentity(item.name) || legacyResponsible === normalizeIdentity(item.email);
  });
}

export function enforceLeadAssignmentForUser(lead, user, teamMembers = []) {
  const scope = getEffectiveLeadAccessScope(user);
  const normalizedLead = { ...lead };

  if (scope === "all") return normalizedLead;
  if (scope === "none") {
    const error = new Error("Seu usuário não possui carteira habilitada para criar ou alterar leads.");
    error.statusCode = 403;
    throw error;
  }

  const allowedUsers = getUsersAllowedByScope(user, teamMembers);
  const targetId = String(normalizedLead.responsibleUserId || normalizedLead.responsible_user_id || "").trim();
  const targetLegacy = normalizeIdentity(normalizedLead.responsible);
  const selectedUser = targetId
    ? allowedUsers.find((item) => String(item.id || "") === targetId)
    : targetLegacy
      ? allowedUsers.find((item) => targetLegacy === normalizeIdentity(item.name) || targetLegacy === normalizeIdentity(item.email))
      : user;

  if (!selectedUser) {
    const error = new Error(scope === "own"
      ? "Vendedores só podem atribuir leads à própria carteira."
      : "O responsável informado não pertence à equipe autorizada.");
    error.statusCode = 403;
    throw error;
  }

  return {
    ...normalizedLead,
    responsibleUserId: String(selectedUser.id || ""),
    responsible: String(selectedUser.name || selectedUser.email || normalizedLead.responsible || ""),
  };
}

export function describeLeadScope(user, teamMembers = []) {
  const scope = getEffectiveLeadAccessScope(user);
  if (scope === "all") return { kind: "base_complete", label: "Base completa", scope };
  if (scope === "team") return { kind: "equipe", label: "Equipe", scope, memberCount: getUsersAllowedByScope(user, teamMembers).length };
  if (scope === "own") return { kind: "carteira_usuario", label: "Minha carteira", scope };
  return { kind: "sem_acesso", label: "Sem acesso a leads", scope };
}

export function normalizeLeadSort(sortBy, sortDirection) {
  const allowedColumns = {
    updatedAt: "updated_at",
    createdAt: "created_at",
    name: "name",
    company: "company",
    status: "status",
    temperature: "temperature",
    responsible: "responsible",
    nextContactAt: "next_contact_at",
    lastContactAt: "last_contact_at",
  };
  const key = Object.prototype.hasOwnProperty.call(allowedColumns, sortBy) ? sortBy : "updatedAt";
  const direction = String(sortDirection || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  return { key, column: allowedColumns[key], direction };
}
