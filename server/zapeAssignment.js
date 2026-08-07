export function normalizeAssignmentIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

export function parseAssignmentCandidates(value) {
  if (Array.isArray(value)) return value.map(normalizeAssignmentIdentifier).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(normalizeAssignmentIdentifier)
    .filter(Boolean);
}

export function parseTenantAssignmentMap(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error('ZAPE_WHATSAPP_ASSIGNMENT_TENANT_MAP contém JSON inválido.');
    wrapped.code = 'ZAPE_ASSIGNMENT_TENANT_MAP_INVALID';
    wrapped.cause = error;
    throw wrapped;
  }
  const out = {};
  for (const [tenantId, candidates] of Object.entries(parsed || {})) {
    const tenant = normalizeAssignmentIdentifier(tenantId).replace(/[^a-z0-9_-]/g, '');
    const normalized = parseAssignmentCandidates(candidates);
    if (tenant && normalized.length) out[tenant] = normalized;
  }
  return out;
}

export function getAssignmentCandidatesForTenant({ tenantId, globalCandidates = [], tenantMap = {} } = {}) {
  const tenant = normalizeAssignmentIdentifier(tenantId).replace(/[^a-z0-9_-]/g, '');
  const scoped = Array.isArray(tenantMap?.[tenant]) ? tenantMap[tenant] : [];
  return scoped.length ? [...new Set(scoped)] : [...new Set(parseAssignmentCandidates(globalCandidates))];
}

export function matchAssignmentUsers(users = [], identifiers = []) {
  const orderedIdentifiers = parseAssignmentCandidates(identifiers);
  if (!orderedIdentifiers.length) return [];
  const activeUsers = (Array.isArray(users) ? users : [])
    .filter((user) => user && Number(user.is_active ?? user.isActive ?? 1) === 1);
  const selected = [];
  const selectedIds = new Set();
  for (const identifier of orderedIdentifiers) {
    const user = activeUsers.find((candidate) => {
      const identities = [candidate.id, candidate.name, candidate.email]
        .map(normalizeAssignmentIdentifier)
        .filter(Boolean);
      return identities.includes(identifier);
    });
    if (user && !selectedIds.has(String(user.id))) {
      selected.push(user);
      selectedIds.add(String(user.id));
    }
  }
  return selected;
}

export function nextRoundRobinUser(users = [], lastUserId = '') {
  const candidates = Array.isArray(users) ? users : [];
  if (!candidates.length) return null;
  const lastIndex = candidates.findIndex((user) => String(user.id) === String(lastUserId || ''));
  return candidates[(lastIndex + 1 + candidates.length) % candidates.length] || candidates[0];
}
