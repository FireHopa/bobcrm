import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { createApiClient, startDisposableCrm } from "./mysqlHarness.js";

const enabled = process.env.RUN_MYSQL_INTEGRATION === "1";
const integration = enabled ? test : test.skip;

integration("migrations, HTTP, permissões, tarefas, Kanban, duplicados e restauração funcionam em MySQL descartável", { timeout: 180_000 }, async (t) => {
  const crm = await startDisposableCrm({ prefix: "crm_phase6_http" });
  let restarted = null;
  t.after(async () => {
    await restarted?.stop({ dropDatabase: false });
    await crm.stop({ dropDatabase: false });
    await crm.sandbox.drop();
  });
  const admin = createApiClient(crm.baseUrl);
  const adminSession = await admin.login(crm.adminEmail, crm.adminPassword);
  assert.equal(adminSession.user.role, "admin");

  const lead = await admin.expect("/api/leads", {
    method: "POST",
    body: { name: "Lead Integração Fase 6", email: "lead.phase6@example.test", phone: "11999990001", company: "Empresa Fase 6", status: "Novo lead", temperature: "Quente" },
  }, 201);
  assert.ok(lead.id);

  const updated = await admin.expect(`/api/leads/${lead.id}`, {
    method: "PUT",
    body: { ...lead, pain: "Precisa melhorar aquisição", expectedCloseAt: "2026-08-31" },
  });
  assert.equal(updated.pain, "Precisa melhorar aquisição");

  const task = await admin.expect("/api/tasks", {
    method: "POST",
    body: { leadId: lead.id, title: "Follow-up integração", dueAt: "2026-08-01T10:00", type: "follow_up", priority: "alta" },
  }, 201);
  const completed = await admin.expect(`/api/tasks/${task.id}/complete`, {
    method: "POST",
    body: {
      result: "Contato realizado",
      nextTask: { leadId: lead.id, title: "Novo follow-up", dueAt: "2026-08-02T10:00", type: "follow_up", priority: "normal" },
    },
  });
  assert.equal(completed.task.status, "completed");
  assert.equal(completed.nextTask.status, "pending");

  const consultantPassword = `${crm.adminPassword}C1!`;
  const consultant = await admin.expect("/api/users", {
    method: "POST",
    body: { name: "Consultor Fase 6", email: "consultor.phase6@example.test", password: consultantPassword, role: "consultor_vendas" },
  }, 201);
  const preSalesPassword = `${crm.adminPassword}P1!`;
  const preSales = await admin.expect("/api/users", {
    method: "POST",
    body: { name: "Pré-venda Fase 6", email: "prevenda.phase6@example.test", password: preSalesPassword, role: "pre_venda" },
  }, 201);
  assert.equal(consultant.leadAccessScope, "own");
  assert.equal(preSales.leadAccessScope, "all");

  const pipelines = await admin.expect("/api/kanban/pipelines");
  const board = await admin.expect(`/api/kanban/board?pipelineId=${encodeURIComponent(pipelines[0].id)}`);
  const openStages = board.stages.filter((stage) => stage.stageType === "open");
  assert.ok(openStages.length >= 2);

  const handoff = await admin.expect(`/api/leads/${lead.id}/handoff`, {
    method: "POST",
    body: {
      requestId: `phase6-${Date.now()}`,
      consultantUserId: consultant.id,
      pipelineId: pipelines[0].id,
      stageId: openStages[0].id,
      task: { title: "Primeiro contato", dueAt: "2026-08-01T11:00", type: "follow_up", priority: "alta" },
    },
  });
  assert.equal(handoff.lead.responsibleUserId, consultant.id);

  const moved = await admin.expect("/api/kanban/cards/move", {
    method: "POST",
    body: { leadId: lead.id, pipelineId: pipelines[0].id, stageId: openStages[1].id },
  });
  assert.equal(moved.pipelineStageId, openStages[1].id);

  const consultantApi = createApiClient(crm.baseUrl);
  await consultantApi.login("consultor.phase6@example.test", consultantPassword);
  const ownPage = await consultantApi.expect("/api/leads?limit=20");
  assert.ok(ownPage.leads.some((item) => item.id === lead.id));
  const forbidden = await consultantApi.request("/api/users");
  assert.equal(forbidden.response.status, 403);

  const connection = await mysql.createConnection({ ...crm.sandbox.config, database: crm.sandbox.database });
  t.after(() => connection.end());
  const [rows] = await connection.query("SELECT * FROM leads WHERE id = ?", [lead.id]);
  const duplicate = { ...rows[0], id: `dup-${lead.id}`, name: `${rows[0].name} duplicado`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await connection.query("INSERT INTO leads SET ?", duplicate);

  const duplicatePage = await admin.expect("/api/leads/duplicates?limit=20&offset=0");
  const group = duplicatePage.groups.find((item) => item.leads.some((candidate) => candidate.id === lead.id));
  assert.ok(group);
  await admin.expect("/api/leads/merge", { method: "POST", body: { primaryLeadId: lead.id, duplicateLeadIds: [duplicate.id] } });

  await admin.expect(`/api/leads/${lead.id}`, { method: "DELETE" });
  const trash = await admin.expect("/api/leads/deleted");
  assert.ok(trash.some((item) => item.id === lead.id));
  const restored = await admin.expect(`/api/leads/${lead.id}/restore`, { method: "POST" });
  assert.equal(restored.deletedAt, "");

  for (const filter of ["expansion", "migration", "mapping", "priority", "agency", "withoutDiagnosis", "mappingCritical"]) {
    const page = await admin.expect(`/api/leads?quickFilter=${filter}&limit=10&offset=0`);
    assert.equal(typeof page.pagination.total, "number");
  }

  const beforeRestart = await connection.query("SELECT COUNT(*) AS total FROM schema_migrations");
  await crm.stop({ dropDatabase: false });
  restarted = await startDisposableCrm({ sandbox: crm.sandbox, prefix: "crm_phase6_restart", adminEmail: crm.adminEmail, adminPassword: crm.adminPassword });
  const afterRestartApi = createApiClient(restarted.baseUrl);
  await afterRestartApi.login(crm.adminEmail, crm.adminPassword);
  const preserved = await afterRestartApi.expect(`/api/leads/${lead.id}`);
  assert.equal(preserved.id, lead.id);
  const [afterRestart] = await connection.query("SELECT COUNT(*) AS total FROM schema_migrations");
  assert.equal(Number(afterRestart[0].total), Number(beforeRestart[0][0].total));
});
