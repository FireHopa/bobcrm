import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTaskAssignmentAllowed,
  assertTaskPayload,
  buildTaskAccessSql,
  buildCompletedTaskAccessSql,
  getTaskBucketWhere,
  normalizeTaskPriority,
  normalizeTaskType,
} from "./taskPolicy.js";

test("payload de tarefa exige título e data válidos", () => {
  assert.throws(() => assertTaskPayload({ title: "Oi", dueAt: "2026-07-07" }), /pelo menos 3/);
  assert.throws(() => assertTaskPayload({ title: "Ligar para cliente", dueAt: "invalida" }), /data válida/);
  const task = assertTaskPayload({ title: "  Ligar   para cliente ", dueAt: "2026-07-07", priority: "alta", type: "ligacao" });
  assert.equal(task.title, "Ligar para cliente");
  assert.equal(task.priority, "alta");
  assert.equal(task.type, "ligacao");
});

test("consultor só atribui tarefas a si mesmo", () => {
  const consultant = { id: "u1", role: "consultor_vendas" };
  assert.equal(assertTaskAssignmentAllowed(consultant, ""), "u1");
  assert.throws(() => assertTaskAssignmentAllowed(consultant, "u2"), /a si mesmos/);
  assert.equal(assertTaskAssignmentAllowed({ id: "p1", role: "pre_venda" }, "u2"), "u2");
});

test("escopo de tarefas do consultor é a própria responsabilidade", () => {
  const ownScope = buildTaskAccessSql({ id: "u1", name: "João", email: "joao@empresa.com", role: "consultor_vendas" });
  assert.match(ownScope.clause, /t\.responsible_user_id = \?/);
  assert.match(ownScope.clause, /EXISTS/);
  assert.deepEqual(ownScope.params, ["u1", "u1", "joão", "joao@empresa.com"]);
  assert.deepEqual(buildTaskAccessSql({ id: "a1", role: "admin" }), { clause: "1 = 1", params: [] });
});

test("histórico concluído do consultor usa quem realmente concluiu a tarefa", () => {
  const consultant = { id: "u1", role: "consultor_vendas" };
  assert.deepEqual(buildCompletedTaskAccessSql(consultant), { clause: "t.completed_by = ?", params: ["u1"] });
  assert.deepEqual(buildCompletedTaskAccessSql({ id: "a1", role: "admin" }), { clause: "1 = 1", params: [] });
});

test("filtros de tarefa distinguem atrasadas, hoje e próximas", () => {
  assert.match(getTaskBucketWhere("overdue"), /due_at/);
  assert.match(getTaskBucketWhere("today"), /= DATE_FORMAT/);
  assert.match(getTaskBucketWhere("upcoming"), /> DATE_FORMAT/);
  assert.match(getTaskBucketWhere("completed"), /status = 'completed'/);
  assert.equal(normalizeTaskType("x"), "follow_up");
  assert.equal(normalizeTaskPriority("x"), "normal");
});
