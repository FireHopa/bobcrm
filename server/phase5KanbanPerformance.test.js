import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildKanbanBoardMetadataSql,
  buildKanbanInitialCardsSql,
  buildKanbanPipelinesSql,
  buildKanbanStagePageSql,
} from "./kanbanBoardSql.js";

const serverSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");

function sliceFunction(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} não encontrada`);
  const end = nextName ? source.indexOf(`\nasync function ${nextName}`, start + 1) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

test("lista de funis consolida pipelines, etapas e contagens em uma query", () => {
  const sql = buildKanbanPipelinesSql("responsible_user_id = ?");
  assert.match(sql, /WITH stage_counts AS/);
  assert.match(sql, /GROUP BY pipeline_id, pipeline_stage_id/);
  assert.match(sql, /pipeline_counts AS/);
  assert.match(sql, /LEFT JOIN kanban_stages/);
  assert.match(sql, /LEFT JOIN pipeline_counts/);
  assert.doesNotMatch(sql, /SELECT \*/);

  const fn = sliceFunction(serverSource, "getKanbanPipelines", "getKanbanBoardFromRequest");
  assert.match(fn, /buildKanbanPipelinesSql/);
  assert.equal((fn.match(/queryRows\(/g) || []).length, 1);
  assert.equal((fn.match(/scalar\(/g) || []).length, 0);
});

test("board inicial busca todas as colunas em uma única query ranqueada", () => {
  const sql = buildKanbanInitialCardsSql("deleted_at = '' AND status = ?");
  assert.match(sql, /ROW_NUMBER\(\) OVER \(\s*PARTITION BY pipeline_stage_id/);
  assert.match(sql, /COUNT\(\*\) OVER \(PARTITION BY pipeline_stage_id\)/);
  assert.match(sql, /WHERE __row_num <= \?/);
  assert.match(sql, /ORDER BY pipeline_stage_id ASC, __row_num ASC/);
  assert.doesNotMatch(sql, /OFFSET/);

  const fn = sliceFunction(serverSource, "getKanbanBoardFromRequest", "getKanbanStageCardsFromRequest");
  assert.match(fn, /buildKanbanBoardMetadataSql/);
  assert.match(fn, /buildKanbanInitialCardsSql/);
  assert.doesNotMatch(fn, /for \(const stage of stages\)/);
  assert.equal((fn.match(/scalar\(/g) || []).length, 0);
  assert.equal((fn.match(/queryRows\(/g) || []).length, 2);
});

test("metadados do board resolvem pipeline, etapas e contagens sem N+1", () => {
  const sql = buildKanbanBoardMetadataSql("1 = 1");
  assert.match(sql, /selected_pipeline AS/);
  assert.match(sql, /stage_counts AS/);
  assert.match(sql, /pipeline_count AS/);
  assert.match(sql, /WHEN \? <> '' AND id = \? THEN 0/);
  assert.match(sql, /WHEN is_default = 1 THEN 1/);
  assert.doesNotMatch(sql, /SELECT \*/);
});

test("load more usa uma consulta para cards e total filtrado", () => {
  const sql = buildKanbanStagePageSql("deleted_at = '' AND pipeline_stage_id = ?");
  assert.match(sql, /COUNT\(\*\) OVER \(\) AS __filtered_card_count/);
  assert.match(sql, /LIMIT \? OFFSET \?/);

  const start = serverSource.indexOf("async function getKanbanStageCardsFromRequest");
  const end = serverSource.indexOf("\nfunction getStageStatusUpdate", start);
  const fn = serverSource.slice(start, end);
  assert.match(fn, /buildKanbanStagePageSql/);
  assert.equal((fn.match(/scalar\(/g) || []).length, 0);
  assert.equal((fn.match(/queryRows\(/g) || []).length, 1);
});
