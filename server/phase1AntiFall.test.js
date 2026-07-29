import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMysqlPoolOptions, isMysqlPoolQueueLimitError, markMysqlCapacityError } from "./mysqlReliability.js";
import { resolveInteractiveSqlTimeout, withMaxExecutionTimeHint } from "./sqlExecutionGuard.js";

const backend = await readFile(new URL("./index.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/components/SettingsCenter.tsx", import.meta.url), "utf8");
const kanbanWrites = await readFile(new URL("./kanbanWriteService.js", import.meta.url), "utf8");

test("pool usa fila finita e transforma saturação em 503", () => {
  assert.equal(buildMysqlPoolOptions({ connectionLimit: 8 }).queueLimit, 32);
  assert.equal(buildMysqlPoolOptions({ queueLimit: 7 }).queueLimit, 7);
  const error = new Error("Queue limit reached.");
  assert.equal(isMysqlPoolQueueLimitError(error), true);
  markMysqlCapacityError(error);
  assert.equal(error.statusCode, 503);
});

test("SELECT interativo recebe timeout e background fica livre", () => {
  assert.equal(resolveInteractiveSqlTimeout({ method: "GET", endpoint: "/api/leads" }, { defaultMs: 8000 }), 8000);
  assert.equal(resolveInteractiveSqlTimeout({ method: "GET", endpoint: "/api/admin/leads/overview" }, { defaultMs: 8000, adminMs: 10000 }), 10000);
  assert.equal(resolveInteractiveSqlTimeout(null), 0);
  assert.match(withMaxExecutionTimeHint("SELECT * FROM leads", 8000), /MAX_EXECUTION_TIME\(8000\)/);
});

test("backend aplica migration, fila, timeout global e serialização de jobs pesados", () => {
  assert.match(backend, /antiFallPhase1MigrationVersion/);
  assert.match(backend, /MYSQL_API_QUEUE_LIMIT/);
  assert.match(backend, /resolveInteractiveSqlTimeout\(context/);
  assert.match(backend, /runHeavyJobSerially\(job/);
  assert.match(backend, /idx_leads_stage_active_position|runAntiFallPhase1Migration/);
  assert.match(backend, /GROUP BY identity_key HAVING COUNT\(DISTINCT user_id\) = 1/);
  assert.doesNotMatch(backend, /for \(const \[identity, userIds\] of identityOwners\.entries\(\)\)/);
});

test("Kanban em lote e rebalanceamento usam operações em lote", () => {
  assert.match(backend, /kanbanWriteService\.assignCardsInBulk/);
  assert.match(kanbanWrites, /kanban_position = CASE id \$\{positionCases\}/);
  assert.match(kanbanWrites, /cancelPendingTasksForLeadIds/);
  assert.match(kanbanWrites, /const batchSize = 500/);
  assert.match(kanbanWrites, /UPDATE leads SET kanban_position = CASE id \$\{cases\}/);
});

test("handoff posterga recálculos e consolida refresh ao final", () => {
  assert.match(backend, /excludeSourceKey: handoffSourceKey, deferLeadRefresh: true/);
  assert.match(backend, /leadAccessValidated: true/);
  assert.match(backend, /resolvedResponsible: consultant/);
  assert.match(backend, /Consolida next_contact_at \+ perfil comercial uma única vez/);
});

test("frontend elimina rajada inicial e carrega filtros/duplicados sob demanda", () => {
  assert.match(app, /await loadLeadsFromServer\(\{ includeSummary: true \}/);
  assert.match(app, /activeTab !== "leads"/);
  assert.match(app, /window\.setTimeout\(\(\) => void refreshAssignableUsers\(\), 1200\)/);
  assert.doesNotMatch(settings, /tasks\.push\(fetchDuplicateGroupsFromServer/);
  assert.match(settings, /activeAdminTab !== "duplicates" \|\| duplicatesLoaded/);
});
