import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCsrfToken,
  createSessionSecrets,
  deriveCsrfToken,
  createTrustedProxyPolicy,
  getCookieValue,
  hashOpaqueToken,
  resolveClientIp,
  resolveRequestProtocol,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./sessionSecurity.js";

test("sessão gera token opaco e persiste somente hashes SHA-256", () => {
  const secrets = createSessionSecrets();
  assert.notEqual(secrets.sessionToken, secrets.sessionTokenHash);
  assert.equal(secrets.sessionTokenHash, hashOpaqueToken(secrets.sessionToken));
  assert.equal(secrets.csrfToken, deriveCsrfToken(secrets.sessionToken));
  assert.equal(secrets.csrfTokenHash, hashOpaqueToken(secrets.csrfToken));
  assert.match(secrets.sessionTokenHash, /^[a-f0-9]{64}$/);
});

test("cookie de sessão usa HttpOnly, SameSite, escopo /api e Secure configurável", () => {
  const cookie = serializeSessionCookie({ name: "crm_session", token: "abc", maxAgeSeconds: 3600, secure: true, sameSite: "Strict" });
  assert.match(cookie, /^crm_session=abc;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
  assert.match(cookie, /Secure/);
  assert.match(serializeClearedSessionCookie({ name: "crm_session" }), /Max-Age=0/);
});

test("leitura de cookie não depende de Authorization ou localStorage", () => {
  const request = { headers: { cookie: "other=1; crm_session=opaque%20token" } };
  assert.equal(getCookieValue(request, "crm_session"), "opaque token");
});

test("CSRF é obrigatório somente para métodos mutáveis", () => {
  const csrf = "csrf-secret";
  assert.doesNotThrow(() => assertCsrfToken({ method: "GET", providedToken: "", expectedHash: "" }));
  assert.doesNotThrow(() => assertCsrfToken({ method: "POST", providedToken: csrf, expectedHash: hashOpaqueToken(csrf) }));
  assert.throws(
    () => assertCsrfToken({ method: "DELETE", providedToken: "wrong", expectedHash: hashOpaqueToken(csrf) }),
    (error) => error.statusCode === 403 && error.code === "CSRF_VALIDATION_FAILED",
  );
});

test("x-forwarded-for só é usado quando o socket pertence a proxy confiável", () => {
  const policy = createTrustedProxyPolicy({ enabled: true, addresses: "127.0.0.1,10.0.0.0/8", hops: 1 });
  const trustedRequest = {
    headers: { "x-forwarded-for": "198.51.100.20", "x-forwarded-proto": "https" },
    socket: { remoteAddress: "127.0.0.1", encrypted: false },
  };
  assert.equal(resolveClientIp(trustedRequest, policy), "198.51.100.20");
  assert.equal(resolveRequestProtocol(trustedRequest, policy), "https");

  const untrustedRequest = {
    headers: { "x-forwarded-for": "198.51.100.20", "x-forwarded-proto": "https" },
    socket: { remoteAddress: "203.0.113.5", encrypted: false },
  };
  assert.equal(resolveClientIp(untrustedRequest, policy), "203.0.113.5");
  assert.equal(resolveRequestProtocol(untrustedRequest, policy), "http");
});

test("cadeia encaminhada usa o salto confiável a partir da direita", () => {
  const policy = createTrustedProxyPolicy({ enabled: true, addresses: "127.0.0.1", hops: 1 });
  const request = {
    headers: { "x-forwarded-for": "192.0.2.9, 198.51.100.44" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(resolveClientIp(request, policy), "198.51.100.44");
});

test("proxy habilitado exige allowlist validada", () => {
  assert.throws(() => createTrustedProxyPolicy({ enabled: true, addresses: "" }), /TRUST_PROXY_ADDRESSES/);
  assert.throws(() => createTrustedProxyPolicy({ enabled: true, addresses: "invalid" }), /endereço inválido/);
});
