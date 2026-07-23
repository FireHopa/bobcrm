import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import net from "node:net";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const VALID_SAME_SITE = new Set(["Strict", "Lax", "None"]);

export function hashOpaqueToken(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function deriveCsrfToken(sessionToken) {
  return createHmac("sha256", String(sessionToken || ""))
    .update("crm-casa-ads-csrf-v1", "utf8")
    .digest("base64url");
}

export function createSessionSecrets() {
  const sessionToken = randomBytes(32).toString("base64url");
  const csrfToken = deriveCsrfToken(sessionToken);
  return {
    sessionToken,
    sessionTokenHash: hashOpaqueToken(sessionToken),
    csrfToken,
    csrfTokenHash: hashOpaqueToken(csrfToken),
  };
}

export function safeTokenHashEquals(rawToken, expectedHash) {
  const actual = Buffer.from(hashOpaqueToken(rawToken), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

export function parseCookieHeader(headerValue) {
  const cookies = new Map();
  String(headerValue || "")
    .split(";")
    .forEach((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return;
      const name = part.slice(0, separator).trim();
      const rawValue = part.slice(separator + 1).trim();
      if (!name) return;
      try {
        cookies.set(name, decodeURIComponent(rawValue));
      } catch {
        cookies.set(name, rawValue);
      }
    });
  return cookies;
}

export function getCookieValue(request, cookieName) {
  return parseCookieHeader(request?.headers?.cookie).get(cookieName) || "";
}

export function normalizeSameSite(value, fallback = "Lax") {
  const normalized = String(value || "").trim().toLowerCase();
  const candidate = normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : fallback;
  return VALID_SAME_SITE.has(candidate) ? candidate : fallback;
}

export function serializeSessionCookie({
  name,
  token,
  maxAgeSeconds,
  secure = false,
  sameSite = "Lax",
  path = "/api",
}) {
  const attributes = [
    `${name}=${encodeURIComponent(String(token || ""))}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${normalizeSameSite(sameSite)}`,
    `Max-Age=${Math.max(0, Math.floor(Number(maxAgeSeconds) || 0))}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function serializeClearedSessionCookie({ name, secure = false, sameSite = "Lax", path = "/api" }) {
  return serializeSessionCookie({ name, token: "", maxAgeSeconds: 0, secure, sameSite, path });
}

export function isUnsafeHttpMethod(method) {
  return !SAFE_HTTP_METHODS.has(String(method || "GET").toUpperCase());
}

export function assertCsrfToken({ method, providedToken, expectedHash }) {
  if (!isUnsafeHttpMethod(method)) return;
  if (!providedToken || !expectedHash || !safeTokenHashEquals(providedToken, expectedHash)) {
    const error = new Error("Validação de segurança da sessão falhou. Atualize a página e tente novamente.");
    error.statusCode = 403;
    error.code = "CSRF_VALIDATION_FAILED";
    throw error;
  }
}

function normalizeIpAddress(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("::ffff:") && net.isIP(raw.slice(7)) === 4) return raw.slice(7);
  return raw;
}

function addTrustedProxyEntry(blockList, value) {
  const entry = normalizeIpAddress(value);
  if (!entry) return;
  const slash = entry.lastIndexOf("/");
  if (slash > 0) {
    const address = entry.slice(0, slash);
    const prefix = Number.parseInt(entry.slice(slash + 1), 10);
    const family = net.isIP(address);
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : 0;
    if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`TRUST_PROXY_ADDRESSES contém CIDR inválido: ${value}`);
    }
    blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    return;
  }
  const family = net.isIP(entry);
  if (!family) throw new Error(`TRUST_PROXY_ADDRESSES contém endereço inválido: ${value}`);
  blockList.addAddress(entry, family === 4 ? "ipv4" : "ipv6");
}

export function createTrustedProxyPolicy({ enabled = false, addresses = "", hops = 1 } = {}) {
  const normalizedHops = Number.parseInt(String(hops || 1), 10);
  if (!Number.isInteger(normalizedHops) || normalizedHops < 1 || normalizedHops > 10) {
    throw new Error("TRUST_PROXY_HOPS deve estar entre 1 e 10.");
  }

  const entries = String(addresses || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (enabled && entries.length === 0) {
    throw new Error("TRUST_PROXY=1 exige TRUST_PROXY_ADDRESSES com os endereços ou redes dos proxies confiáveis.");
  }

  const blockList = new net.BlockList();
  entries.forEach((entry) => addTrustedProxyEntry(blockList, entry));
  return { enabled: Boolean(enabled), hops: normalizedHops, blockList, entries };
}

export function isRequestFromTrustedProxy(request, policy) {
  if (!policy?.enabled) return false;
  const address = normalizeIpAddress(request?.socket?.remoteAddress);
  const family = net.isIP(address);
  if (!family) return false;
  return policy.blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

function parseForwardedValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveClientIp(request, policy) {
  const directAddress = normalizeIpAddress(request?.socket?.remoteAddress) || "local";
  if (!isRequestFromTrustedProxy(request, policy)) return directAddress;

  const forwarded = parseForwardedValues(request?.headers?.["x-forwarded-for"]);
  if (!forwarded.length || forwarded.some((address) => net.isIP(normalizeIpAddress(address)) === 0)) {
    return directAddress;
  }

  const clientIndex = forwarded.length - policy.hops;
  if (clientIndex < 0) return directAddress;
  return normalizeIpAddress(forwarded[clientIndex]);
}

export function resolveRequestProtocol(request, policy) {
  const directProtocol = request?.socket?.encrypted ? "https" : "http";
  if (!isRequestFromTrustedProxy(request, policy)) return directProtocol;

  const forwarded = parseForwardedValues(request?.headers?.["x-forwarded-proto"]);
  const protocolIndex = forwarded.length - policy.hops;
  const candidate = protocolIndex >= 0 ? forwarded[protocolIndex].toLowerCase() : "";
  return candidate === "https" || candidate === "http" ? candidate : directProtocol;
}
