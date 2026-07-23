import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const drawerPath = path.resolve(currentDir, "../src/components/LeadDetailsDrawer.tsx");

test("compositor de tarefas não cria formulário aninhado no drawer", async () => {
  const source = await readFile(drawerPath, "utf8");
  assert.doesNotMatch(source, /<form\s+className="drawerTaskComposerV42"/);
  assert.match(source, /<div\s+className="drawerTaskComposerV42"/);
});
