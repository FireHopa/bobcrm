import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const lineCount = (source) => source.split(/\r?\n/).length;

test("backend extrai mapeamento de leads e serviço de assets sem alterar as rotas", () => {
  const index = read("server/index.js");
  const mapper = read("server/domains/leads/leadMapper.js");
  const staticAssets = read("server/http/staticAssets.js");
  assert.match(index, /from "\.\/domains\/leads\/leadMapper\.js"/);
  assert.match(index, /from "\.\/http\/staticAssets\.js"/);
  assert.match(index, /createStaticAssetsHandler\(\{ distDir, sendJson \}\)/);
  assert.match(mapper, /export function normalizeLead/);
  assert.match(staticAssets, /export function createStaticAssetsHandler/);
  assert.ok(lineCount(index) < 5600, `server/index.js ainda possui ${lineCount(index)} linhas`);
});

test("componentes grandes delegam regras a módulos menores", () => {
  const importer = read("src/components/ImportLeads.tsx");
  const importerModel = read("src/features/import/importModel.ts");
  const kanban = read("src/components/KanbanBoard.tsx");
  const kanbanHook = read("src/features/kanban/useKanbanBoardData.ts");
  const drawer = read("src/components/LeadDetailsDrawer.tsx");
  const drawerModel = read("src/features/leads/leadDrawerModel.ts");
  const drawerPanels = read("src/features/leads/LeadDetailsPanels.tsx");

  assert.match(importer, /from "\.\.\/features\/import\/importModel"/);
  assert.match(importerModel, /export async function parseSpreadsheetInWorker/);
  assert.ok(lineCount(importer) < 650);
  assert.match(kanban, /useKanbanBoardData/);
  assert.match(kanbanHook, /export function useKanbanBoardData/);
  assert.match(drawer, /leadDrawerModel/);
  assert.match(drawer, /LeadDetailsPanels/);
  assert.match(drawerModel, /validateLeadDrawerForm/);
  assert.match(drawerPanels, /CommercialRecommendationPanel/);
  assert.ok(lineCount(drawer) < 750);
});

test("módulos pesados usam carregamento dinâmico e CSS da Fase 5 foi separado por bloco completo", () => {
  const app = read("src/App.tsx");
  const table = read("src/components/LeadTable.tsx");
  const main = read("src/main.tsx");
  const phase5Css = read("src/styles/phase5-ux.css");
  assert.match(app, /lazy\(\(\) => import\("\.\/components\/ImportLeads"\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/components\/SettingsCenter"\)/);
  assert.match(table, /lazy\(\(\) => import\("\.\/KanbanBoard"\)/);
  assert.match(app, /<Suspense/);
  assert.match(main, /import "\.\/styles\/phase5-ux\.css"/);
  assert.match(phase5Css, /Fase 5/);
});

test("CI contém MySQL descartável, integração HTTP, E2E e carga de 133 mil leads", () => {
  const ci = read(".github/workflows/ci.yml");
  const playwright = read("playwright.config.ts");
  const loadTest = read("scripts/load-test.mjs");
  const integration = read("server/integration/http.mysql.test.js");
  assert.match(ci, /mysql-integration:/);
  assert.match(ci, /e2e:/);
  assert.match(ci, /load-test:/);
  assert.match(ci, /mysql:8\.4/);
  assert.match(ci, /npm run test:mysql/);
  assert.match(ci, /npm run test:e2e/);
  assert.match(ci, /npm run test:load/);
  assert.match(playwright, /testDir: "\.\/e2e"/);
  assert.match(loadTest, /133_000/);
  assert.match(integration, /RUN_MYSQL_INTEGRATION/);
});

test("suíte E2E cobre login, lead, encaminhamento, tarefa, Kanban, filtros, importação, duplicados e lixeira", () => {
  const sources = [
    read("e2e/auth-responsive.spec.ts"),
    read("e2e/lead-lifecycle.spec.ts"),
    read("e2e/operations-admin.spec.ts"),
  ].join("\n");
  for (const term of ["login", "criação e edição", "encaminhamento", "follow-up", "Kanban", "filtros", "importação", "duplicados", "lixeira", "teclado"]) {
    assert.match(sources, new RegExp(term, "i"), `cenário ausente: ${term}`);
  }
});
