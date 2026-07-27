const DUPLICATE_REASON_ORDER = Object.freeze(["email", "phone", "nameCompany"]);

function prefixed(alias, column) {
  return `${alias ? `${alias}.` : ""}${column}`;
}

export function normalizeDuplicateReason(value) {
  return DUPLICATE_REASON_ORDER.includes(value) ? value : "";
}

export function getDuplicateReasonLabel(reason) {
  if (reason === "email") return "E-mail";
  if (reason === "phone") return "Telefone";
  return "Nome + empresa";
}

export function getDuplicateGroupLabel(reason, key) {
  if (reason === "email") return `E-mail: ${key}`;
  if (reason === "phone") return `Telefone: ${key}`;
  return "Nome + empresa iguais";
}

export function buildDuplicateGroupsUnionSql({ where = "1 = 1", alias = "l" } = {}) {
  const emailKey = prefixed(alias, "email_key");
  const phoneKey = prefixed(alias, "phone_key");
  const nameCompanyKey = prefixed(alias, "name_company_key");
  const updatedAt = prefixed(alias, "updated_at");

  return [
    `SELECT 'email' AS reason, ${emailKey} AS duplicate_key, COUNT(*) AS lead_count, MAX(${updatedAt}) AS latest_at
     FROM leads ${alias}
     WHERE ${where} AND TRIM(COALESCE(${emailKey}, '')) != ''
     GROUP BY ${emailKey}
     HAVING COUNT(*) > 1`,
    `SELECT 'phone' AS reason, ${phoneKey} AS duplicate_key, COUNT(*) AS lead_count, MAX(${updatedAt}) AS latest_at
     FROM leads ${alias}
     WHERE ${where} AND CHAR_LENGTH(${phoneKey}) >= 8
     GROUP BY ${phoneKey}
     HAVING COUNT(*) > 1`,
    `SELECT 'nameCompany' AS reason, ${nameCompanyKey} AS duplicate_key, COUNT(*) AS lead_count, MAX(${updatedAt}) AS latest_at
     FROM leads ${alias}
     WHERE ${where} AND TRIM(COALESCE(${nameCompanyKey}, '')) != ''
     GROUP BY ${nameCompanyKey}
     HAVING COUNT(*) > 1`,
  ].join("\nUNION ALL\n");
}

export function buildDuplicateGroupsCountSql(options = {}) {
  return `SELECT COUNT(*) AS total FROM (${buildDuplicateGroupsUnionSql(options)}) duplicate_groups`;
}

export function buildDuplicateGroupsPageSql(options = {}) {
  return `SELECT reason, duplicate_key, lead_count, latest_at
    FROM (${buildDuplicateGroupsUnionSql(options)}) duplicate_groups
    ORDER BY lead_count DESC, latest_at DESC, reason ASC, duplicate_key ASC
    LIMIT ? OFFSET ?`;
}

export function buildDuplicateLeadLookup({ groups = [], where = "1 = 1", alias = "l", select = "" } = {}) {
  const clauses = [];
  const params = [];
  const emailKey = prefixed(alias, "email_key");
  const phoneKey = prefixed(alias, "phone_key");
  const nameCompanyKey = prefixed(alias, "name_company_key");

  for (const group of groups) {
    const reason = normalizeDuplicateReason(group.reason);
    const key = String(group.duplicateKey || group.duplicate_key || "").trim();
    if (!reason || !key) continue;
    if (reason === "email") clauses.push(`${emailKey} = ?`);
    else if (reason === "phone") clauses.push(`${phoneKey} = ?`);
    else clauses.push(`${nameCompanyKey} = ?`);
    params.push(key);
  }

  if (!clauses.length) return { sql: "", params: [] };
  const selectClause = String(select || "").trim() || `${alias}.*`;
  return {
    sql: `SELECT ${selectClause} FROM leads ${alias}
      WHERE ${where} AND (${clauses.join(" OR ")})
      ORDER BY ${updatedOrdering(alias)}`,
    params,
  };
}

function updatedOrdering(alias) {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}updated_at DESC, ${prefix}created_at ASC, ${prefix}id ASC`;
}

function duplicateLeadCompleteness(lead) {
  return [
    lead.name,
    lead.email,
    lead.phone,
    lead.company,
    lead.website,
    lead.responsible,
    lead.temperature,
    lead.pain,
    lead.nextContactAt,
  ].reduce((score, value) => score + (String(value || "").trim() ? 1 : 0), 0);
}

export function sortDuplicateLeadsForPrimary(leads = []) {
  return [...leads].sort((first, second) => {
    const completeness = duplicateLeadCompleteness(second) - duplicateLeadCompleteness(first);
    if (completeness !== 0) return completeness;
    const created = String(first.createdAt || "").localeCompare(String(second.createdAt || ""));
    if (created !== 0) return created;
    return String(first.id || "").localeCompare(String(second.id || ""));
  });
}

export function mapDuplicateGroups(groupRows = [], leadRows = [], mapLead = (row) => row) {
  return groupRows.map((group) => {
    const reason = normalizeDuplicateReason(group.reason);
    const duplicateKey = String(group.duplicate_key || group.duplicateKey || "");
    const matchingRows = leadRows.filter((row) => {
      if (reason === "email") return String(row.email_key || "") === duplicateKey;
      if (reason === "phone") return String(row.phone_key || "") === duplicateKey;
      return String(row.name_company_key || "") === duplicateKey;
    });
    const leads = sortDuplicateLeadsForPrimary(matchingRows.map(mapLead));

    return {
      key: `${reason}:${duplicateKey}`,
      duplicateKey,
      label: getDuplicateGroupLabel(reason, duplicateKey),
      reason,
      total: Number(group.lead_count || group.total || leads.length),
      leads,
    };
  }).filter((group) => group.reason && group.leads.length > 1);
}
