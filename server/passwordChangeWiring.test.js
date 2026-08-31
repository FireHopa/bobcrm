import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const securitySource = readFileSync(new URL("./security.js", import.meta.url), "utf8");


test("política de senha continua centralizada no backend", () => {
  assert.match(securitySource, /export const PASSWORD_POLICY/);
  assert.match(securitySource, /minLength:\s*12/);
  assert.match(securitySource, /maxLength:\s*256/);
  assert.match(securitySource, /validatePasswordStrength/);
});

test("usuário autenticado pode alterar somente a própria senha com validação e auditoria", () => {
  assert.match(indexSource, /\/api\/auth\/change-password/);
  assert.match(indexSource, /verifyPassword\(currentPassword, userRow\.password_hash\)/);
  assert.match(indexSource, /validatePasswordStrength\(newPassword\)/);
  assert.match(indexSource, /UPDATE users SET password_hash = \?, updated_at = \? WHERE id = \?/);
  assert.match(indexSource, /DELETE FROM sessions WHERE user_id = \? AND token <> \?/);
  assert.match(indexSource, /action:\s*"password_changed"/);
  assert.doesNotMatch(indexSource, /changes:\s*\{[^}]*newPassword/);
});
