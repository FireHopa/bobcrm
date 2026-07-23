import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

test("encaminhamento é controlado no App e não fica empilhado dentro do drawer", async () => {
  const [appSource, drawerSource] = await Promise.all([
    readProjectFile("src/App.tsx"),
    readProjectFile("src/components/LeadDetailsDrawer.tsx"),
  ]);

  assert.match(appSource, /const LeadHandoffDialog = lazy/);
  assert.match(appSource, /\{!handoffLead \? \(/);
  assert.match(appSource, /\{handoffLead \? \(/);
  assert.doesNotMatch(drawerSource, /import \{ LeadHandoffDialog \}/);
  assert.doesNotMatch(drawerSource, /handoffOpen/);
  assert.match(drawerSource, /onRequestHandoff\?\.\(lead\)/);
});

test("modal usa portal, trava foco e fica acima das camadas legadas", async () => {
  const [dialogSource, stylesSource] = await Promise.all([
    readProjectFile("src/components/LeadHandoffDialog.tsx"),
    readProjectFile("src/styles.css"),
  ]);

  assert.match(dialogSource, /createPortal/);
  assert.match(dialogSource, /document\.body/);
  assert.match(dialogSource, /focusableSelector/);
  assert.match(stylesSource, /\.leadHandoffOverlayV44[\s\S]*z-index:\s*2147483646\s*!important/);
});

test("lead sem responsável possui ação direta de encaminhamento na tabela", async () => {
  const tableSource = await readProjectFile("src/components/LeadTable.tsx");

  assert.match(tableSource, /isUnassigned/);
  assert.match(tableSource, /handoffTableActionV44/);
  assert.match(tableSource, />\s*Encaminhar\s*<\/button>/);
  assert.match(tableSource, /Trocar consultor ou funil/);
});
