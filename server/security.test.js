import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSecurityHeaders,
  evaluateCorsOrigin,
  parseBoundedInteger,
  sanitizeDownloadFileName,
  sanitizeSpreadsheetCell,
  validateBootstrapAdminConfig,
  validatePasswordStrength,
} from "./security.js";

test("parseBoundedInteger limita valores fora da faixa", () => {
  assert.equal(parseBoundedInteger("200000", 500, 1, 1000), 1000);
  assert.equal(parseBoundedInteger("0", 500, 1, 1000), 1);
  assert.equal(parseBoundedInteger("invalido", 500, 1, 1000), 500);
});

test("sanitizeSpreadsheetCell neutraliza fórmulas e preserva texto comum", () => {
  assert.equal(sanitizeSpreadsheetCell("=HYPERLINK(\"https://example.com\")"), "'=HYPERLINK(\"https://example.com\")");
  assert.equal(sanitizeSpreadsheetCell(" +SUM(A1:A2)"), "' +SUM(A1:A2)");
  assert.equal(sanitizeSpreadsheetCell("@comando"), "'@comando");
  assert.equal(sanitizeSpreadsheetCell("Cliente Casa do Ads"), "Cliente Casa do Ads");
});

test("validateBootstrapAdminConfig rejeita configuração administrativa insegura", () => {
  const result = validateBootstrapAdminConfig({
    email: "admin@casadoads.local",
    password: "senha-fraca",
    name: "Administrador",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("valor padrão")));
  assert.ok(result.errors.some((message) => message.includes("12 caracteres")));
});

test("validatePasswordStrength exige senha robusta", () => {
  assert.ok(validatePasswordStrength("fraca").length > 0);
  assert.deepEqual(validatePasswordStrength("SenhaMuitoForte@2026"), []);
});

test("evaluateCorsOrigin permite mesma origem e bloqueia origem desconhecida", () => {
  const sameOrigin = evaluateCorsOrigin({
    origin: "https://crm.exemplo.com",
    requestOrigin: "https://crm.exemplo.com",
    configuredOrigins: "",
    isProduction: true,
  });
  assert.equal(sameOrigin.allowed, true);
  assert.equal(sameOrigin.headers["Access-Control-Allow-Credentials"], "true");
  assert.match(sameOrigin.headers["Access-Control-Allow-Headers"], /X-CSRF-Token/);

  assert.equal(evaluateCorsOrigin({
    origin: "https://malicioso.exemplo",
    requestOrigin: "https://crm.exemplo.com",
    configuredOrigins: "https://painel.exemplo.com",
    isProduction: true,
  }).allowed, false);
});

test("sanitizeDownloadFileName impede quebra de cabeçalho", () => {
  assert.equal(sanitizeDownloadFileName("arquivo\r\nmalicioso.json"), "arquivomalicioso.json");
});


test("buildSecurityHeaders libera microfone e mídia somente para o próprio CRM", () => {
  const headers = buildSecurityHeaders({ isHttps: true });
  assert.match(headers["Permissions-Policy"], /microphone=\(self\)/);
  assert.match(headers["Content-Security-Policy"], /media-src 'self' data: blob:/);
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});
