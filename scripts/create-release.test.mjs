import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { buildRelease, collectAllowedFiles, findSecrets } from "./create-release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenPatterns = [
  /(^|\/)\.env(?:$|\.(?!example$))/, 
  /(^|\/)(?:node_modules|dist|backups|data|logs|release)(?:\/|$)/,
  /\.(?:sqlite|sqlite3|db|bak|backup|dump|log|pem|key|p12|pfx)$/i,
];

test("allowlist inclui fontes necessárias e exclui artefatos sensíveis", async () => {
  const files = await collectAllowedFiles(projectRoot);
  assert.ok(files.includes("package.json"));
  assert.ok(files.includes("server/.env.example"));
  assert.ok(files.includes("server/index.js"));
  assert.ok(files.includes("src/App.tsx"));
  assert.ok(files.includes("scripts/create-release.mjs"));
  assert.equal(files.some((file) => forbiddenPatterns.some((pattern) => pattern.test(file))), false);
});

test("scanner identifica padrões de segredo e aceita placeholders", () => {
  assert.ok(findSecrets("test.env", `API_KEY=${"AI" + "zaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456"}\n`).length > 0);
  assert.ok(findSecrets("test.env", "CRM_ADMIN_PASSWORD=senha-real-123\n").length > 0);
  assert.deepEqual(findSecrets("server/.env.example", "CRM_ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_PASSWORD\n"), []);
});

test("ZIP gerado contém somente a allowlist e manifesto verificável", async () => {
  const release = await buildRelease(projectRoot);
  const entries = unzipSync(release.zip);
  const names = Object.keys(entries).sort();

  assert.ok(names.includes("RELEASE_MANIFEST.json"));
  assert.ok(names.includes("server/.env.example"));
  assert.equal(names.some((file) => forbiddenPatterns.some((pattern) => pattern.test(file))), false);
  assert.equal(names.some((file) => file.startsWith("/") || file.includes("../")), false);

  const manifest = JSON.parse(Buffer.from(entries["RELEASE_MANIFEST.json"]).toString("utf8"));
  assert.equal(manifest.policy, "explicit-allowlist");
  assert.equal(manifest.files.length, release.files.length);

  const packageJson = await readFile(path.join(projectRoot, "package.json"), "utf8");
  assert.equal(Buffer.from(entries["package.json"]).toString("utf8"), packageJson);
});
