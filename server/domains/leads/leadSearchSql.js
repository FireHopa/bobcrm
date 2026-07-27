import {
  buildBooleanFullTextQuery,
  normalizeEmailKey,
  normalizePhoneKey,
  normalizeSearchText,
} from "./leadMapper.js";

export const LEAD_SEARCH_MODES = Object.freeze({
  NONE: "none",
  PHONE_PREFIX: "phone_prefix",
  EMAIL_PREFIX: "email_prefix",
  FULLTEXT: "fulltext",
  FALLBACK: "fallback",
});

function safeAliasPrefix(alias = "") {
  const normalized = String(alias || "").replace(/[^a-zA-Z0-9_]/g, "");
  return normalized ? `${normalized}.` : "";
}

function escapeLikeTerm(value) {
  return String(value ?? "").replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isPhoneLike(rawTerm) {
  return /^[+\d\s().\-/]+$/.test(rawTerm) && normalizePhoneKey(rawTerm).length >= 3;
}

function isEmailLike(rawTerm) {
  const value = String(rawTerm || "").trim();
  return value.includes("@") && !/\s/.test(value);
}

function buildFallbackPlan(rawTerm, alias = "") {
  const prefix = safeAliasPrefix(alias);
  const normalizedText = normalizeSearchText(rawTerm);
  const phoneTerm = normalizePhoneKey(rawTerm);
  const emailTerm = normalizeEmailKey(rawTerm);

  if (isPhoneLike(rawTerm) && phoneTerm) {
    return {
      mode: LEAD_SEARCH_MODES.FALLBACK,
      kind: "phone_contains",
      clause: `${prefix}phone_key LIKE ? ESCAPE '\\\\'`,
      params: [`%${escapeLikeTerm(phoneTerm)}%`],
    };
  }

  if (isEmailLike(rawTerm) && emailTerm) {
    return {
      mode: LEAD_SEARCH_MODES.FALLBACK,
      kind: "email_contains",
      clause: `${prefix}email_key LIKE ? ESCAPE '\\\\'`,
      params: [`%${escapeLikeTerm(emailTerm)}%`],
    };
  }

  const likeTerm = `%${escapeLikeTerm(normalizedText || String(rawTerm || "").toLowerCase())}%`;
  const directLikeTerm = `%${escapeLikeTerm(String(rawTerm || "").trim().toLowerCase())}%`;
  const directColumns = ["name", "company", "email", "source", "responsible"];
  const directClauses = directColumns.map((column) => `LOWER(COALESCE(${prefix}${column}, '')) LIKE ? ESCAPE '\\\\'`);

  return {
    mode: LEAD_SEARCH_MODES.FALLBACK,
    kind: "text_contains",
    clause: `(
      ${prefix}search_text LIKE ? ESCAPE '\\\\'
      OR (
        (${prefix}search_text IS NULL OR ${prefix}search_text = '')
        AND (${directClauses.join(" OR ")})
      )
    )`,
    params: [likeTerm, ...directColumns.map(() => directLikeTerm)],
  };
}

export function buildLeadSearchPlan(search, { alias = "", fullTextEnabled = true } = {}) {
  const rawTerm = String(search || "").trim();
  if (!rawTerm) {
    return {
      mode: LEAD_SEARCH_MODES.NONE,
      primary: null,
      fallback: null,
      requiresProbe: false,
    };
  }

  const prefix = safeAliasPrefix(alias);
  const phoneTerm = normalizePhoneKey(rawTerm);
  const emailTerm = normalizeEmailKey(rawTerm);
  const fullTextQuery = buildBooleanFullTextQuery(rawTerm);
  const fallback = buildFallbackPlan(rawTerm, alias);

  if (isPhoneLike(rawTerm) && phoneTerm) {
    return {
      mode: LEAD_SEARCH_MODES.PHONE_PREFIX,
      primary: {
        mode: LEAD_SEARCH_MODES.PHONE_PREFIX,
        clause: `${prefix}phone_key LIKE ? ESCAPE '\\\\'`,
        params: [`${escapeLikeTerm(phoneTerm)}%`],
      },
      fallback,
      requiresProbe: true,
    };
  }

  if (isEmailLike(rawTerm) && emailTerm) {
    return {
      mode: LEAD_SEARCH_MODES.EMAIL_PREFIX,
      primary: {
        mode: LEAD_SEARCH_MODES.EMAIL_PREFIX,
        clause: `${prefix}email_key LIKE ? ESCAPE '\\\\'`,
        params: [`${escapeLikeTerm(emailTerm)}%`],
      },
      fallback,
      requiresProbe: true,
    };
  }

  if (fullTextEnabled && fullTextQuery) {
    return {
      mode: LEAD_SEARCH_MODES.FULLTEXT,
      primary: {
        mode: LEAD_SEARCH_MODES.FULLTEXT,
        clause: `MATCH(${prefix}search_text) AGAINST (? IN BOOLEAN MODE)`,
        params: [fullTextQuery],
      },
      fallback,
      requiresProbe: true,
    };
  }

  return {
    mode: LEAD_SEARCH_MODES.FALLBACK,
    primary: null,
    fallback,
    requiresProbe: false,
  };
}

export function chooseLeadSearchPlan(plan, primaryHasMatches) {
  if (!plan || plan.mode === LEAD_SEARCH_MODES.NONE) return null;
  if (plan.primary && primaryHasMatches) return plan.primary;
  return plan.fallback;
}
