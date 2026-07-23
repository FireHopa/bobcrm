import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("frontend não persiste token de autenticação reutilizável", async () => {
  const api = await read("src/utils/api.ts");
  assert.equal(/localStorage\.setItem\([^\n]*Token/i.test(api), false);
  assert.equal(/Authorization\s*=|Bearer \$\{token\}/.test(api), false);
  assert.match(api, /credentials:\s*"include"/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /localStorage\.removeItem\(LEGACY_TOKEN_KEY\)/);
});

test("backend usa cookie HttpOnly, hash de sessão e validação CSRF", async () => {
  const index = await read("server/index.js");
  const schema = await read("server/schema.mysql.sql");
  assert.match(index, /serializeSessionCookie/);
  assert.match(index, /hashOpaqueToken\(sessionToken\)/);
  assert.match(index, /assertCsrfToken/);
  assert.match(index, /token_format = 'sha256'/);
  assert.match(schema, /csrf_token_hash CHAR\(64\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS rate_limits/);
});

test("proxy, rate limit e arquivos estáticos usam as proteções da Fase 3", async () => {
  const index = await read("server/index.js");
  const staticAssets = await read("server/http/staticAssets.js");
  assert.match(index, /resolveClientIp\(request, TRUST_PROXY_POLICY\)/);
  assert.match(index, /consumeMysqlRateLimit/);
  assert.match(index, /cleanupExpiredRateLimits/);
  assert.match(staticAssets, /path\.relative\(path\.resolve\(parentDirectory\), path\.resolve\(candidatePath\)\)/);
  assert.equal(/request\.headers\["x-forwarded-for"\]\s*\|\|/.test(index), false);
});

test("dependências e CI removem xlsx vulnerável e executam auditoria", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const ci = await read(".github/workflows/ci.yml");
  const importer = await read("src/components/ImportLeads.tsx");
  const importerModel = await read("src/features/import/importModel.ts");
  assert.equal(packageJson.dependencies.xlsx, undefined);
  assert.equal(packageJson.dependencies.exceljs, "^4.4.0");
  assert.match(packageJson.devDependencies.vite, /^\^8\./);
  assert.match(ci, /npm run security:scan/);
  assert.match(ci, /npm run security:audit/);
  assert.match(importerModel, /spreadsheetParser\.worker\.ts/);
  assert.match(importerModel, /XLS legado foi desativado por segurança/);
});
