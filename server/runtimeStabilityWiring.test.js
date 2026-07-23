import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [serverSource, reliabilitySource, mainSource, appSource, apiSource, kanbanHookSource, tableSource, envSource, uxCss] = await Promise.all([
  readFile(new URL("./index.js", import.meta.url), "utf8"),
  readFile(new URL("./mysqlReliability.js", import.meta.url), "utf8"),
  readFile(new URL("../src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/utils/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/kanban/useKanbanBoardData.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/LeadTable.tsx", import.meta.url), "utf8"),
  readFile(new URL("./.env.example", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/phase5-ux.css", import.meta.url), "utf8"),
]);

test("ECONNRESET antes do commit pode repetir a transação inteira com segurança", () => {
  assert.match(reliabilitySource, /isRetryableMysqlOperationError/);
  assert.match(reliabilitySource, /error\.mysqlRetrySafe = true/);
  assert.match(reliabilitySource, /MYSQL_COMMIT_OUTCOME_UNKNOWN/);
  assert.match(reliabilitySource, /connection\.destroy/);
});

test("encerramento não transforma pool fechado em cascata de INTERNAL_ERROR", () => {
  assert.match(serverSource, /MYSQL_POOL_UNAVAILABLE/);
  assert.match(serverSource, /SERVER_SHUTTING_DOWN/);
  assert.match(serverSource, /isExpectedShutdownError/);
  assert.match(serverSource, /waitForActiveRequests/);
  assert.match(serverSource, /if \(statusCode >= 500 && !shutdownFailure\)/);
});

test("modo de desenvolvimento evita efeitos duplicados do StrictMode", () => {
  assert.doesNotMatch(mainSource, /StrictMode/);
  assert.match(mainSource, /render\(<App \/>\)/);
});

test("carga inicial usa paginação menor e reconstrução de índice é opt-in", () => {
  assert.match(appSource, /const LEADS_PAGE_SIZE = 150/);
  assert.match(apiSource, /const DEFAULT_LEAD_PAGE_SIZE = 150/);
  assert.match(tableSource, /const MAX_RENDERED_LEADS = 150/);
  assert.match(serverSource, /DEFAULT_LEADS_PAGE_LIMIT", 150/);
  assert.match(serverSource, /SEARCH_INDEX_REBUILD_ON_START = process\.env\.SEARCH_INDEX_REBUILD_ON_START === "1"/);
  assert.match(envSource, /^DEFAULT_LEADS_PAGE_LIMIT=150$/m);
  assert.match(envSource, /^SEARCH_INDEX_REBUILD_ON_START=0$/m);
});

test("Kanban cancela requisições antigas e não recarrega por identidade de objeto", () => {
  assert.match(apiSource, /fetchKanbanBoard\([\s\S]*signal\?: AbortSignal/);
  assert.match(kanbanHookSource, /boardRequestController\.current\?\.abort\(\)/);
  assert.match(kanbanHookSource, /controller\.signal/);
  assert.match(kanbanHookSource, /filters\.search, filters\.status, filters\.temperature, filters\.responsible, filters\.quickFilter/);
});

test("listas extensas usam renderização progressiva quando suportada", () => {
  assert.match(uxCss, /@supports \(content-visibility: auto\)/);
  assert.match(uxCss, /\.kanbanCardV40/);
  assert.match(uxCss, /contain-intrinsic-size/);
});
