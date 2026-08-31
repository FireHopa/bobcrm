import { createHash } from "node:crypto";

const DEFAULT_DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const DANGEROUS_SPREADSHEET_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;
const DEFAULT_ADMIN_EMAIL = "admin@casadoads.local";
const INSECURE_DOCUMENTED_PASSWORD_SHA256 = "3d54c6b8bc2b4994eba004830df3e8a49ff2a0eaa703690e420701aefa08bd32";

export function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function sanitizeSpreadsheetCell(value) {
  const text = String(value ?? "");
  return DANGEROUS_SPREADSHEET_PREFIX.test(text) ? `'${text}` : text;
}

export function sanitizeDownloadFileName(value, fallback = "download") {
  const normalized = String(value || fallback)
    .replace(/[\r\n]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || fallback;
}

export const PASSWORD_POLICY = Object.freeze({
  minLength: 12,
  maxLength: 256,
  requireLowercase: true,
  requireUppercase: true,
  requireNumber: true,
  requireSpecial: true,
});

export function validatePasswordStrength(value) {
  const password = String(value || "");
  const errors = [];

  if (password.length < PASSWORD_POLICY.minLength) errors.push(`A senha deve possuir pelo menos ${PASSWORD_POLICY.minLength} caracteres.`);
  if (password.length > PASSWORD_POLICY.maxLength) errors.push(`A senha deve possuir no máximo ${PASSWORD_POLICY.maxLength} caracteres.`);
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) errors.push("A senha deve conter letra minúscula.");
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) errors.push("A senha deve conter letra maiúscula.");
  if (PASSWORD_POLICY.requireNumber && !/\d/.test(password)) errors.push("A senha deve conter número.");
  if (PASSWORD_POLICY.requireSpecial && !/[^A-Za-z0-9]/.test(password)) errors.push("A senha deve conter caractere especial.");

  return errors;
}

export function validateBootstrapAdminConfig({ email, password, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  const normalizedName = String(name || "").trim();
  const errors = [];

  if (!normalizedName) errors.push("Defina CRM_ADMIN_NAME.");
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.push("Defina um CRM_ADMIN_EMAIL válido.");
  }
  if (normalizedEmail === DEFAULT_ADMIN_EMAIL) {
    errors.push("CRM_ADMIN_EMAIL ainda usa o valor padrão documentado.");
  }
  if (!normalizedPassword) {
    errors.push("Defina CRM_ADMIN_PASSWORD.");
  } else {
    errors.push(...validatePasswordStrength(normalizedPassword));
  }
  const passwordDigest = normalizedPassword
    ? createHash("sha256").update(normalizedPassword).digest("hex")
    : "";
  if (passwordDigest === INSECURE_DOCUMENTED_PASSWORD_SHA256) {
    errors.push("CRM_ADMIN_PASSWORD ainda usa uma senha padrão conhecida.");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      email: normalizedEmail,
      password: normalizedPassword,
      name: normalizedName,
    },
  };
}

export function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export function evaluateCorsOrigin({ origin, requestOrigin, configuredOrigins, isProduction }) {
  const normalizedOrigin = String(origin || "").trim().replace(/\/$/, "");
  if (!normalizedOrigin) return { allowed: true, headers: {} };

  const allowList = parseAllowedOrigins(configuredOrigins);
  const normalizedRequestOrigin = String(requestOrigin || "").trim().replace(/\/$/, "");
  const allowed = normalizedOrigin === normalizedRequestOrigin
    || allowList.has(normalizedOrigin)
    || (!isProduction && DEFAULT_DEVELOPMENT_ORIGINS.has(normalizedOrigin));

  return {
    allowed,
    headers: allowed
      ? {
          "Access-Control-Allow-Origin": normalizedOrigin,
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        }
      : { Vary: "Origin" },
  };
}

export function buildSecurityHeaders({ isHttps = false } = {}) {
  return {
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ...(isHttps ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}
