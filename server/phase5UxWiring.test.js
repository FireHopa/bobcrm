import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function listSourceFiles(directory) {
  const basePath = new URL(directory, root);
  const output = [];

  function visit(currentPath) {
    for (const entry of readdirSync(currentPath)) {
      const fullPath = join(currentPath, entry);
      if (statSync(fullPath).isDirectory()) visit(fullPath);
      else if (/\.(?:ts|tsx)$/.test(entry)) output.push(fullPath);
    }
  }

  visit(basePath.pathname);
  return output;
}

test("frontend não usa alert, confirm ou prompt nativos", () => {
  const violations = [];
  for (const filePath of listSourceFiles("src/")) {
    const source = readFileSync(filePath, "utf8");
    if (/\bwindow\.(?:alert|confirm|prompt)\s*\(/.test(source)) {
      violations.push(relative(new URL("src/", root).pathname, filePath));
    }
  }
  assert.deepEqual(violations, []);
});

test("diálogo reutilizável usa portal, focus trap, Escape e restauração de foco", () => {
  const source = read("src/components/ModalDialog.tsx");
  assert.match(source, /createPortal/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /previousActiveElementRef/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
});

test("conclusão de tarefa registra resultado e próximo follow-up com date picker", () => {
  const source = read("src/components/TaskCompletionDialog.tsx");
  assert.match(source, /Resultado da tarefa/);
  assert.match(source, /Criar próximo follow-up/);
  assert.match(source, /type="datetime-local"/);
  assert.match(source, /nextTask:/);
  assert.match(source, /role="alert"/);
});

test("busca global usa total real e remove texto fixo de 140 mil leads", () => {
  const source = read("src/components/Header.tsx");
  assert.match(source, /totalLeadsCount\.toLocaleString\("pt-BR"\)/);
  assert.doesNotMatch(source, /140 mil|140\.000|140000/i);
});

test("Próxima ação aparece antes dos indicadores na Tela Hoje", () => {
  const source = read("src/components/DailyOperation.tsx");
  const nextActionPosition = source.indexOf("nextActionPanelV42");
  const statsPosition = source.indexOf("operationStatsRailV42");
  assert.ok(nextActionPosition > 0);
  assert.ok(statsPosition > nextActionPosition);
});

test("formulários de lead possuem validação inline e campos acessíveis", () => {
  const createForm = read("src/components/LeadForm.tsx");
  const drawerForm = read("src/components/LeadDetailsDrawer.tsx");
  assert.match(createForm, /formValidationSummary/);
  assert.match(createForm, /aria-invalid=/);
  assert.match(createForm, /lead-name-error/);
  assert.match(createForm, /lead-email-error/);
  assert.match(createForm, /lead-lost-reason-error/);
  assert.match(drawerForm, /formValidationSummary/);
  assert.match(drawerForm, /drawer-identity-error/);
  assert.match(drawerForm, /drawer-email-error/);
  assert.match(drawerForm, /drawer-lost-reason-error/);
});

test("ações críticas usam nomenclatura padronizada", () => {
  const menus = read("src/components/LeadActionMenus.tsx");
  const drawer = read("src/components/LeadDetailsDrawer.tsx");
  const table = read("src/components/LeadTable.tsx");
  assert.match(menus, /label: "Abrir lead"/);
  assert.match(menus, /label: "Editar"/);
  assert.match(drawer, /label="Contatar"/);
  assert.match(drawer, />Editar<\/button>/);
  assert.match(drawer, />\s*Encaminhar\s*<\/button>/);
  assert.match(drawer, /triggerLabel="Mais ações"/);
  assert.match(table, />\s*Abrir lead\s*<\/button>/);
});

test("CSS cobre camadas e breakpoints operacionais sem largura estrutural fixa", () => {
  const css = `${read("src/styles.css")}\n${read("src/styles/phase5-ux.css")}`;
  assert.match(css, /\.crmDialogOverlayV5[\s\S]*z-index:\s*2147483647/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /overflow-x:\s*hidden\s*!important/);
  assert.match(css, /\.operationStatsRailV42[\s\S]*grid-template-columns:\s*repeat\(2/);
});
