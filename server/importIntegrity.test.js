import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("todos os módulos locais importados pelo backend existem na entrega", () => {
  const indexPath = path.join(__dirname, "index.js");
  const source = readFileSync(indexPath, "utf8");
  const imports = Array.from(source.matchAll(/from\s+["'](\.\/[^"']+)["']/g), (match) => match[1]);
  assert.ok(imports.length > 0, "Nenhum import local foi encontrado para validar.");

  const missing = imports.filter((relativePath) => !existsSync(path.resolve(__dirname, relativePath)));
  assert.deepEqual(missing, [], `Módulos locais ausentes: ${missing.join(", ")}`);
});
